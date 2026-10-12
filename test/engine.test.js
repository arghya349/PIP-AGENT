import { test } from "node:test";
import assert from "node:assert/strict";
import { makeWorld, pip, say } from "./world.js";
import { TIMING } from "../src/core/engine.js";

const src = (n) => ({ url: `https://site${n}.example.org/p`, title: "P" + n });

// a well-behaved team: each bot does one tool step, then ends its turn
function goodBots() {
  let n = 0;
  const step = (name, tool) => (job) => {
    if (job.kind === "prompt") return "Working on it.\n" + pip(tool());
    return say(`${name} done, see the brain. @${name === "Gemini" ? "ChatGPT" : name === "ChatGPT" ? "Claude" : "Gemini"} your turn.`);
  };
  return {
    Gemini: step("Gemini", () => ["brain_observe", { claim: "fact " + ++n, source: src(n) }]),
    ChatGPT: step("ChatGPT", () => ["brain_note", { kind: "analysis", text: "numbers " + ++n }]),
    Claude: step("Claude", () => ["brain_note", { kind: "plan", text: "plan " + ++n }]),
  };
}

test("a full mission runs to the end with no help", () => {
  const w = makeWorld({ bots: goodBots() });
  w.conductor.start({ topic: "Why do drains fail?", maxTurns: 12, first: "Gemini" });
  w.pump();
  const r = w.conductor.snapshot();
  assert.equal(r.status, "done");
  assert.equal(r.turn, 12);
  const said = r.messages.filter((m) => ["Gemini", "ChatGPT", "Claude"].includes(m.from));
  assert.equal(said.length, 12);
  assert.ok(said.every((m) => m.wrote), "every turn wrote to the brain");
  assert.deepEqual(said.slice(0, 3).map((m) => m.from), ["Gemini", "ChatGPT", "Claude"], "@mentions hand the turn over");
  assert.ok(r.messages.some((m) => /Phase: CONCLUDE/.test(m.text)), "phases advance");
  assert.equal(w.engine.snapshot(), null);
});

test("the prompt carries mission, role, digest, tools and the turn rules", () => {
  const w = makeWorld({ bots: { Gemini: () => null } });
  w.conductor.start({ topic: "Topic X", first: "Gemini" });
  w.pump();
  const ask = w.sent.find((s) => s.msg.op === "ask").msg.job;
  assert.equal(ask.kind, "prompt");
  for (const re of [/Topic X/, /You are Gemini, the Scout/, /brain digest/, /- brain_observe \{/, /END YOUR TURN/, /turn 1 of 18/]) assert.match(ask.text, re);
  assert.ok(ask.text.length < 7000, `prompt is ${ask.text.length} chars`);
});

test("unreadable block -> repair request; then it works", () => {
  let tries = 0;
  const w = makeWorld({
    bots: {
      Gemini: (job) => {
        if (job.kind === "prompt") return '```pip\n{"calls": [{"tool": brain_note}]}\n```';
        if (job.kind === "repair") { tries++; return pip(["brain_note", { text: "fixed" }]); }
        return say("ok");
      },
    },
    connected: ["Gemini", "ChatGPT"],
  });
  w.conductor.start({ topic: "t", maxTurns: 4, first: "Gemini" });
  w.pump();
  assert.equal(tries, 1);
  const asks = w.sent.filter((s) => s.agent === "Gemini" && s.msg.op === "ask").map((s) => s.msg.job);
  assert.match(asks[1].text, /couldn't run your pip block/);
  assert.equal(w.conductor.snapshot().messages.find((m) => m.from === "Gemini").text, "ok");
});

test("repairs are limited; then the prose is used", () => {
  const w = makeWorld({ bots: { Gemini: () => 'Here you go {"calls": [nope]}' }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  const repairs = w.sent.filter((s) => s.msg.op === "ask" && s.msg.job.kind === "repair");
  assert.equal(repairs.length, TIMING.maxRepairs);
  assert.equal(w.conductor.snapshot().messages.find((m) => m.from === "Gemini").text, "Here you go");
});

test("a reply with no block gets one nudge, then counts as the message", () => {
  const w = makeWorld({ bots: { Gemini: () => "I think drains are old." }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  assert.equal(w.sent.filter((s) => s.msg.op === "ask" && s.msg.job.kind === "nudge").length, 1);
  const m = w.conductor.snapshot().messages.find((m) => m.from === "Gemini");
  assert.equal(m.text, "I think drains are old.");
  assert.equal(m.wrote, false);
});

test("room_say mixed with tools is held back until the results are read", () => {
  const w = makeWorld({
    bots: {
      Gemini: (job) => (job.kind === "prompt" ? pip(["brain_note", { text: "n" }], ["room_say", { text: "early" }]) : say("after results")),
    },
    connected: ["Gemini", "Claude"],
  });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  const results = w.sent.find((s) => s.msg.op === "ask" && s.msg.job.kind === "results").msg.job.text;
  assert.match(results, /room_say must be the ONLY call/);
  assert.equal(w.conductor.snapshot().messages.find((m) => m.from === "Gemini").text, "after results");
});

test("tool errors go back to the chatbot, the turn continues", () => {
  const w = makeWorld({
    bots: { Gemini: (job) => (job.kind === "prompt" ? pip(["brain_check", { observation_id: "o42", verdict: "confirmed" }], ["made_up", {}]) : say("noted")) },
    connected: ["Gemini", "Claude"],
  });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  const results = w.sent.find((s) => s.msg.op === "ask" && s.msg.job.kind === "results").msg.job.text;
  assert.match(results, /No observation o42/);
  assert.match(results, /Unknown tool \\"made_up\\"/);
});

test("tool steps are capped per turn", () => {
  const w = makeWorld({ bots: { Gemini: () => pip(["brain_note", { text: "again" }]) }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  const results = w.sent.filter((s) => s.msg.op === "ask" && s.msg.job.kind === "results");
  assert.equal(results.length, TIMING.maxSteps);
  assert.match(results.at(-1).msg.job.text, /last tool step/);
  assert.equal(w.conductor.snapshot().messages.filter((m) => m.from === "Gemini").length, 1);
});

test("a chatbot that never replies is skipped after the reply timeout", () => {
  const w = makeWorld({ bots: { Gemini: () => null, Claude: () => say("here") }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  assert.equal(w.engine.snapshot().stage, "sent");
  w.advance(TIMING.replyMs + 1000);
  const r = w.conductor.snapshot();
  assert.ok(r.messages.some((m) => /Gemini didn't finish replying/.test(m.text)));
  assert.ok(w.sent.some((s) => s.agent === "Gemini" && s.msg.op === "cancel"));
  assert.ok(r.messages.some((m) => m.from === "Claude"), "Claude took the next turn");
});

test("a speaker whose tab is gone is skipped after the grace period", () => {
  const w = makeWorld({ bots: { Claude: () => say("hi") }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.online.delete("Gemini");
  w.pump();
  assert.equal(w.engine.snapshot().work, "waiting for its tab to connect");
  w.advance(TIMING.seatGraceMs + 1000);
  assert.ok(w.conductor.snapshot().messages.some((m) => /Gemini isn't connected/.test(m.text)));
});

test("a speaker whose tab closes after the prompt went in is skipped after the grace period", () => {
  const w = makeWorld({ bots: { Gemini: () => null, Claude: () => say("hi") }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  assert.equal(w.engine.snapshot().stage, "sent");
  w.online.delete("Gemini");
  w.advance(1000);
  assert.equal(w.engine.snapshot().work, "waiting for its tab to connect");
  w.online.add("Gemini"); // a reload: back in time, nothing lost
  w.advance(TIMING.seatGraceMs - 5000);
  w.online.delete("Gemini");
  w.advance(1000); // noticed gone again: the grace period starts over
  w.advance(TIMING.seatGraceMs - 5000);
  assert.equal(w.conductor.snapshot().speaker, "Gemini", "the grace period restarts after it came back");
  w.advance(10_000);
  assert.ok(w.conductor.snapshot().messages.some((m) => /Gemini isn't connected/.test(m.text)));
});

test("a tab that doesn't acknowledge is offered the job again, then skipped", () => {
  const w = makeWorld({ bots: {}, connected: ["Gemini", "Claude"] });
  w.transport.send = (agent, msg) => { w.sent.push({ agent, msg }); return true; }; // swallow everything
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  for (let i = 0; i < 20; i++) w.advance(TIMING.offerAckMs + 1);
  const offers = w.sent.filter((s) => s.msg.op === "ask").length;
  assert.ok(offers >= 3, `offered ${offers} times`);
  assert.ok(w.conductor.snapshot().messages.some((m) => /couldn't take the message/.test(m.text)));
});

test("a failed delivery is retried after a pause", () => {
  const w = makeWorld({ bots: {}, connected: ["Gemini", "Claude"] });
  let n = 0;
  w.transport.send = (agent, msg) => {
    w.sent.push({ agent, msg });
    if (msg.op === "ask" && ++n === 1) w.inbox.push({ agent, msg: { type: "job", id: msg.job.id, state: "failed", error: "message box has a draft" } });
    else if (msg.op === "ask") { w.inbox.push({ agent, msg: { type: "job", id: msg.job.id, state: "sent" } }); w.inbox.push({ agent, msg: { type: "reply", id: msg.job.id, text: say("made it") } }); }
    return true;
  };
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  assert.equal(w.engine.snapshot().work, "message box has a draft");
  w.advance(TIMING.retryMs);
  assert.equal(w.conductor.snapshot().messages.find((m) => m.from === "Gemini").text, "made it");
});

test("stale and duplicate replies are acknowledged but ignored", () => {
  let jobId = null;
  const w = makeWorld({ bots: { Gemini: (job) => { jobId = job.id; return null; } }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  w.engine.onMessage("Gemini", { type: "reply", id: "m0.t0.j1", text: say("stale") });
  w.engine.onMessage("Claude", { type: "reply", id: jobId, text: say("wrong tab") });
  assert.equal(w.conductor.snapshot().messages.filter((m) => m.from !== "Room").length, 0);
  assert.equal(w.sent.filter((s) => s.msg.op === "ack").length, 2);
  w.engine.onMessage("Gemini", { type: "reply", id: jobId, text: say("real") });
  w.engine.onMessage("Gemini", { type: "reply", id: jobId, text: say("real again") });
  w.pump();
  assert.deepEqual(w.conductor.snapshot().messages.filter((m) => m.from === "Gemini").map((m) => m.text), ["real"]);
});

test("a tab that reloads mid-turn gets the job again", () => {
  const w = makeWorld({ bots: { Gemini: () => null }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  const before = w.sent.filter((s) => s.msg.op === "ask").length;
  w.engine.onMessage("Gemini", { type: "hello", job: null });
  w.advance(TIMING.retryMs);
  assert.equal(w.sent.filter((s) => s.msg.op === "ask").length, before + 1);
});

test("the whole state survives a restart mid-turn (service worker killed)", () => {
  const bots = goodBots();
  let hold = true;
  const gem = bots.Gemini;
  bots.Gemini = (job, world) => (hold ? null : gem(job, world));
  const w1 = makeWorld({ bots, connected: ["Gemini", "ChatGPT", "Claude"] });
  w1.conductor.start({ topic: "restart", maxTurns: 6, first: "Gemini" });
  w1.pump();
  const jobId = w1.engine.snapshot() && w1.sent.filter((s) => s.msg.op === "ask").at(-1).msg.job.id;
  const saved = w1.save();

  hold = false;
  const w2 = makeWorld({ bots, saved });
  w2.setClock(w1.now());
  // the tab still has the reply for the job it was given before the restart
  w2.engine.onMessage("Gemini", { type: "reply", id: jobId, text: pip(["brain_note", { text: "after restart" }]) });
  w2.pump();
  const r = w2.conductor.snapshot();
  assert.equal(r.status, "done");
  assert.equal(r.turn, 6);
  assert.ok(w2.brain.snapshot().notes.some((n) => n.text === "after restart"));
});

test("the host can steer: @mention picks the next speaker and the message is in the prompt", () => {
  const w = makeWorld({ bots: goodBots() });
  w.conductor.start({ topic: "t", maxTurns: 8, first: "Gemini" });
  w.conductor.steer({ text: "@Claude look at o1 first" });
  w.pump();
  const r = w.conductor.snapshot();
  const order = r.messages.filter((m) => ["Gemini", "ChatGPT", "Claude"].includes(m.from)).map((m) => m.from);
  assert.equal(order[1], "Claude");
  const claudePrompt = w.sent.find((s) => s.agent === "Claude" && s.msg.op === "ask").msg.job.text;
  assert.match(claudePrompt, /HOST \(top priority\):\n@Claude look at o1 first/);
});

test("stop cancels the current job", () => {
  const w = makeWorld({ bots: { Gemini: () => null }, connected: ["Gemini", "Claude"] });
  w.conductor.start({ topic: "t", first: "Gemini" });
  w.pump();
  w.conductor.stop();
  w.pump();
  assert.ok(w.sent.some((s) => s.agent === "Gemini" && s.msg.op === "cancel"));
  assert.equal(w.engine.snapshot(), null);
  assert.equal(w.conductor.snapshot().status, "done");
});

test("three failed turns in a row end the mission instead of spinning", () => {
  const w = makeWorld({ bots: {}, connected: ["Gemini", "ChatGPT", "Claude"] });
  w.conductor.start({ topic: "t", maxTurns: 30, first: "Gemini" });
  w.pump();
  for (let i = 0; i < 10 && w.conductor.snapshot().status === "running"; i++) w.advance(TIMING.replyMs + 1000);
  const r = w.conductor.snapshot();
  assert.equal(r.status, "done");
  assert.match(r.messages.at(-1).text, /Three turns in a row failed/);
});
