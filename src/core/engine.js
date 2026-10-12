// The engine runs one turn at a time, as a small state machine:
//
//   job queued ─offer─▶ offered ─"typing"─▶ typing ─"sent"─▶ sent ─reply─▶ replied
//        ▲                 │ no answer            │ stuck                │
//        └──── retry ◀─────┴──────────────────────┘                     ▼
//                                              parse ─▶ run tools ─▶ next job (results)
//                                                    └▶ room_say ─▶ conductor.say ─▶ next turn
//
// A "job" is one message Pip types into a chat (the turn prompt, tool results,
// a repair request) and the reply it waits for. Job ids are unique per mission,
// turn and step, so a late or repeated message from a tab can never be applied
// twice or to the wrong turn. Every stage has a timeout; nothing waits forever.
// No timers or browser APIs in here: the background calls tick() every second
// and passes tab messages to onMessage(); the state is plain JSON it saves.
import { parseReply, formatResults } from "./protocol.js";

export const TIMING = {
  seatGraceMs: 45_000,      // the speaker's tab isn't connected: wait this long before skipping
  offerAckMs: 15_000,       // a tab must acknowledge an offered job this fast, or it's offered again
  typingMs: 60_000,         // typing must finish (or fail) within this
  retryMs: 5_000,           // wait between delivery retries (box busy, draft in the way)
  deliverMs: 2.5 * 60_000,  // give up delivering a job after this long
  replyMs: 6 * 60_000,      // a chatbot must finish a reply within this
  turnMs: 12 * 60_000,      // a whole turn, all steps
  maxSteps: 8,              // tool rounds per turn
  maxRepairs: 2,            // unreadable blocks we ask to be resent
  maxNudges: 1,             // replies without any block we push back on
};

export function createEngine(saved, { conductor, brain, toolbox, transport, now = Date.now, onChange = () => {}, log = () => {}, timing = {} } = {}) {
  const T = { ...TIMING, ...timing };
  let t = saved && typeof saved === "object" && saved.turnId ? saved : null; // the turn in progress
  const changed = () => onChange();

  const room = () => conductor.state;
  const work = (s) => { if (t && t.work !== s) { t.work = s; changed(); } };

  function startTurn() {
    const r = room();
    t = {
      missionId: r.missionId, turnId: r.turnId, agent: r.speaker, startedAt: now(), jobN: 0, job: null,
      steps: 0, repairs: 0, nudges: 0, delivered: false, work: "getting ready", lastProse: "", runs: [],
    };
    queue("prompt", conductor.promptFor(t.agent, toolbox.reference()));
    log(`turn ${r.turnId}: ${t.agent}`);
  }

  function queue(kind, text) {
    t.jobN++;
    t.job = { id: `m${t.missionId}.t${t.turnId}.j${t.jobN}`, kind, text, state: "queued", createdAt: now(), offeredAt: 0, tries: 0, sentAt: 0, error: null };
    changed();
  }

  function offer() {
    const j = t.job;
    j.state = "offered"; j.offeredAt = now(); j.tries++;
    transport.send(t.agent, { op: "ask", job: { id: j.id, kind: j.kind, text: j.text } });
    work(j.kind === "prompt" ? "typing the prompt" : j.kind === "results" ? "sending tool results" : "asking again");
  }

  function skip(why) {
    const a = t.agent;
    log(`turn ${t.turnId}: skip ${a}: ${why}`);
    transport.send(a, { op: "cancel" });
    t = null;
    conductor.skip(a, why);
    changed();
  }

  function end(text) {
    const a = t.agent;
    t = null;
    // the host may have stopped the mission while this reply was being read
    if (room().status === "running" && room().speaker === a) conductor.say(a, text);
    changed();
  }

  // ---- the clock ------------------------------------------------------------
  function tick() {
    const r = room();
    if (r.status !== "running") {
      if (t) { transport.send(t.agent, { op: "cancel" }); t = null; changed(); }
      return;
    }
    if (!t || t.turnId !== r.turnId || t.missionId !== r.missionId || t.agent !== r.speaker) startTurn();
    const n = now(), j = t.job;
    if (n - t.startedAt > T.turnMs) return skip(`ran out of time (${Math.round(T.turnMs / 60000)} min)`);
    // the speaker's tab is gone (closed, reloading, left the room): give it a grace period, at any stage
    if (!transport.connected(t.agent)) {
      t.goneAt ||= n;
      if (n - t.goneAt > T.seatGraceMs) return skip("isn't connected (its tab was closed or left the room)");
      return work("waiting for its tab to connect");
    }
    if (t.goneAt) { t.goneAt = 0; changed(); }
    switch (j.state) {
      case "queued": {
        if (j.tries && n - j.createdAt > T.deliverMs) return skip(`couldn't take the message (${j.error || "chat box busy"})`);
        if (!j.offeredAt || n - j.offeredAt >= T.retryMs) offer();
        return;
      }
      case "offered":
        if (n - j.offeredAt > T.offerAckMs) { j.state = "queued"; j.error = j.error || "the tab didn't answer"; changed(); }
        return;
      case "typing":
        if (n - j.offeredAt > T.typingMs) { j.state = "queued"; j.error = "typing took too long"; changed(); }
        return;
      case "sent":
        if (n - j.sentAt > T.replyMs) return skip(`didn't finish replying in ${Math.round(T.replyMs / 60000)} min`);
        return;
    }
  }

  // ---- messages from the tabs ------------------------------------------------------
  function onMessage(agent, msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "reply") return onReply(agent, msg);
    if (!t || agent !== t.agent) return;
    const j = t.job;
    if (msg.type === "hello") {
      // the tab (re)connected: if it has no record of our job, offer it again
      const has = msg.job && msg.job.id === j.id;
      if (!has && (j.state === "offered" || j.state === "typing")) { j.state = "queued"; j.offeredAt = 0; changed(); }
      if (!has && j.state === "sent") { j.state = "queued"; j.offeredAt = 0; j.error = "the tab reloaded"; changed(); }
      return;
    }
    if (msg.type !== "job" || msg.id !== j.id) return;
    switch (msg.state) {
      case "typing":
        if (j.state === "offered" || j.state === "queued") { j.state = "typing"; changed(); }
        work(j.kind === "prompt" ? "typing the prompt" : "typing");
        return;
      case "sent":
        if (j.state === "sent" || j.state === "replied") return;
        j.state = "sent"; j.sentAt = now(); j.error = null;
        if (j.kind === "prompt" && !t.delivered) { t.delivered = true; conductor.delivered(agent); }
        work(t.steps ? `working (step ${t.steps + 1})` : "thinking");
        return;
      case "failed":
        if (j.state === "sent" || j.state === "replied") return;
        j.state = "queued"; j.error = String(msg.error || "couldn't type").slice(0, 160);
        work(j.error);
        return;
      case "progress":
        if (j.state === "sent" && msg.note) work(String(msg.note).slice(0, 80));
        return;
    }
  }

  function onReply(agent, msg) {
    // always acknowledge, so the tab stops re-sending it, even when it's stale
    transport.send(agent, { op: "ack", id: msg.id });
    if (!t || agent !== t.agent || msg.id !== t.job.id || t.job.state === "replied") return;
    // a reply can arrive before "sent" if the tab's ack got lost
    if (t.job.kind === "prompt" && !t.delivered) { t.delivered = true; conductor.delivered(agent); }
    t.job.state = "replied";
    handleReply({ text: String(msg.text || "").slice(0, 60_000), blocks: Array.isArray(msg.blocks) ? msg.blocks.slice(0, 20).map((b) => String(b).slice(0, 30_000)) : [] });
  }

  // ---- one reply ------------------------------------------------------------------
  function handleReply(reply) {
    const p = parseReply(reply);
    if (p.prose) t.lastProse = p.prose.slice(0, 1500);

    if (!p.found) {
      if (t.nudges < T.maxNudges) { t.nudges++; return queue("nudge", nudgeMessage()); }
      return end(p.prose || t.lastProse);
    }
    if (!p.calls.length) {
      if (t.repairs < T.maxRepairs) { t.repairs++; return queue("repair", repairMessage(p.errors)); }
      return end(p.prose || t.lastProse || "(my tool block couldn't be read)");
    }

    const says = p.calls.filter((c) => c.tool === "room_say");
    const others = p.calls.filter((c) => c.tool !== "room_say");
    if (!others.length) {
      const text = String(says[0].args?.text ?? "").trim();
      if (!text) {
        if (t.repairs < T.maxRepairs) { t.repairs++; return queue("repair", repairMessage(['room_say needs "text": your message to the team'])); }
        return end(p.prose || t.lastProse);
      }
      return end(text);
    }

    // run the tools in order
    const results = [];
    for (const c of others) {
      try {
        const result = toolbox.run({ brain, agent: t.agent }, c.tool, c.args);
        results.push({ tool: c.tool, ok: true, result });
      } catch (e) {
        results.push({ tool: c.tool, ok: false, error: String(e.message || e).slice(0, 300) });
      }
    }
    if (says.length) results.push({ tool: "room_say", ok: false, error: "Not run: room_say must be the ONLY call in its block, sent after you've read these results. Send it again on its own." });
    for (const e of p.errors) results.push({ ok: false, error: e });
    t.steps++;
    t.runs.push(...results.map((x) => ({ tool: x.tool || "block", ok: x.ok, error: x.error || null })));
    transport.send(t.agent, { op: "tools", items: results.map((x) => ({ label: x.tool ? toolbox.label(x.tool) : "block", ok: x.ok, error: x.error || null })) });
    log(`turn ${t.turnId}: ${t.agent} step ${t.steps}: ${results.map((x) => `${x.tool}${x.ok ? "" : "✗"}`).join(", ")}`);

    if (t.steps > T.maxSteps) return end(t.lastProse || "(I ran out of tool steps this turn.)");
    queue("results", resultsMessage(results, t.steps >= T.maxSteps));
  }

  // ---- what Pip types back ------------------------------------------------------------
  const sayExample = '{"calls":[{"tool":"room_say","args":{"text":"..."}}]}';
  function resultsMessage(results, lastStep) {
    return [
      `[pip results · turn ${room().turn + 1} · step ${t.steps}]`,
      formatResults(results),
      lastStep
        ? `That was your last tool step this turn. Now END THE TURN: reply with a pip block whose ONLY call is room_say: ${sayExample}`
        : `Continue your turn from these results. Call more tools with another pip block, or end the turn with a pip block whose ONLY call is room_say: ${sayExample}`,
    ].join("\n");
  }
  function repairMessage(errors) {
    return `[pip] I couldn't run your pip block: ${errors.slice(0, 3).join("; ") || "no valid calls"}. Send it again as ONE fenced code block, language pip, holding ONE line of valid JSON: {"calls":[{"tool":"name","args":{...}}]} with straight double quotes, no comments and no trailing commas.`;
  }
  function nudgeMessage() {
    return `[pip] Your turn isn't finished: your reply had no pip block, so nothing reached the brain or the team. Record what you found with the tools if you can, then END THE TURN with a pip block whose ONLY call is room_say: ${sayExample}`;
  }

  function snapshot() {
    if (!t) return null;
    return { agent: t.agent, turnId: t.turnId, stage: t.job?.state || null, kind: t.job?.kind || null, work: t.work, steps: t.steps, startedAt: t.startedAt, runs: t.runs.slice(-12), error: t.job?.error || null };
  }

  return { tick, onMessage, snapshot, toJSON: () => t, timing: T };
}
