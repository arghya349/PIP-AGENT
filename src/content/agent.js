// Pip in a chat tab. Two jobs:
//  1. The agent: a port to the background. When the room gives this chat a
//     job (a prompt, tool results, a repair request) it types it in through
//     the driver, watches the reply until it's finished, and sends the reply
//     back, again and again until the background acknowledges it. The job is
//     kept in sessionStorage, so a page reload or a background restart loses
//     nothing.
//  2. Pip: the mascot in the corner, which shows what's going on and offers
//     the next step. It never decides anything; the room does.
(() => {
  const SITE = globalThis.PipSites?.[location.hostname];
  if (!SITE || !globalThis.PipDriver || !globalThis.PipDock) return;
  const AI = SITE.name;
  const HOST_ID = "agent-pip-host";
  document.getElementById(HOST_ID)?.remove(); // an older copy of Pip (the extension was updated or reloaded)

  const SETTLE_MS = 3000;      // a reply must stop changing this long before it counts as finished
  const RESEND_MS = 75_000;    // nothing at all came back: type the message once more
  const REPLY_RESEND_MS = 8000; // re-send an unacknowledged reply this often
  const driver = globalThis.PipDriver(SITE);
  const store = {
    get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
    set(k, v) { try { v == null ? sessionStorage.removeItem(k) : sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  let alive = true;
  let port = null, backoff = 500;
  let joined = store.get("pip.joined"); // { at } while this tab holds a seat
  let job = store.get("pip.job");       // the job in progress, see ask()
  let delivering = null;                // id of the job being typed right now
  let view = null;                      // the room, as the background last described it
  const timers = [];
  const saveJob = () => store.set("pip.job", job ? { ...job, lastText: undefined } : null);

  // ---- the port -------------------------------------------------------------------
  function connect() {
    if (!alive) return;
    try { port = chrome.runtime.connect({ name: "pip-agent" }); } catch { return dispose(); }
    port.onMessage.addListener((m) => { backoff = 500; try { onOp(m); } catch (e) { console.warn("[pip]", e); } });
    port.onDisconnect.addListener(() => {
      port = null;
      void chrome.runtime.lastError;
      if (!chrome.runtime?.id) return dispose(); // the extension was removed or reloaded
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 5000);
    });
    hello();
  }
  function send(msg) {
    if (!port) return false;
    try { port.postMessage(msg); return true; } catch { return false; }
  }
  function hello() {
    send({ type: "hello", site: location.hostname, joined: !!joined, joinedAt: joined?.at || 0, visible: !document.hidden, url: location.href, job: job ? { id: job.id, state: job.state } : null });
    if (job?.reply) send({ type: "reply", id: job.id, ...job.reply });
  }

  function onOp(m) {
    switch (m?.op) {
      case "ask": return void ask(m.job);
      case "ack": if (job && job.id === m.id) { job = null; saveJob(); } return;
      case "cancel": if (job) { job = null; saveJob(); ui.cancelled(); } return;
      case "join": return setJoined(true);
      case "seat": if (!m.seated && joined) { setJoined(false, true); ui.seatLost(); } return;
      case "room": view = m.view; return ui.room(view);
      case "tools": return ui.tools(m.items || []);
      case "notice": return ui.notice(m.text, m.err);
    }
  }

  function setJoined(on, quiet = false) {
    if (on) {
      if (!joined) joined = { at: Date.now() };
      store.set("pip.joined", joined);
      send({ type: "join", joinedAt: joined.at });
      ui.joined();
    } else {
      joined = null;
      store.set("pip.joined", null);
      if (!quiet) send({ type: "leave" });
    }
  }

  // ---- a job: type it in, then watch for the finished reply ------------------------------
  async function ask(j) {
    if (!j?.id || typeof j.text !== "string") return;
    if (job && job.id === j.id) {
      // offered again (our answer got lost): repeat where we are
      if (job.state === "sent") send({ type: "job", id: job.id, state: "sent" });
      if (job.reply) send({ type: "reply", id: job.id, ...job.reply });
      if (job.state !== "typing" || delivering === j.id) return;
      // "typing" but nobody is typing: the page reloaded mid-way, so start over
    }
    if (delivering) return; // one at a time; the room offers it again
    delivering = j.id;
    job = { id: j.id, kind: j.kind, text: j.text, state: "typing", at: Date.now() };
    saveJob();
    send({ type: "job", id: j.id, state: "typing" });
    ui.typing(j.kind);
    let r;
    try { r = await driver.send(j.text); } catch (e) { r = { ok: false, error: String(e.message || e) }; }
    delivering = null;
    if (!job || job.id !== j.id) return; // cancelled while typing
    if (!r.ok) {
      job = null; saveJob();
      send({ type: "job", id: j.id, state: "failed", error: r.error });
      ui.deliverFailed(r.error);
      return;
    }
    Object.assign(job, { state: "sent", baseline: r.baseline, url: location.href, sentAt: Date.now(), resent: false, stableAt: 0, lastText: "" });
    saveJob();
    send({ type: "job", id: j.id, state: "sent" });
    ui.sent();
  }

  let lastNote = "", lastFront = 0;
  function progress(note) {
    if (note === lastNote || !job) return;
    lastNote = note;
    send({ type: "job", id: job.id, state: "progress", note });
  }

  async function watch() {
    if (!job || job.state !== "sent" || delivering) return;
    const now = Date.now();
    if (job.reply) {
      if (now - (job.replyAt || 0) > REPLY_RESEND_MS) { job.replyAt = now; send({ type: "reply", id: job.id, ...job.reply }); }
      return;
    }
    if (document.hidden && now - lastFront > 15_000) { lastFront = now; send({ type: "front" }); progress(`${AI}'s tab is hidden: bringing it forward`); }
    const list = driver.replies(), n = list.length;
    // fewer replies than when we sent AND a different (or empty) chat: it was switched or lost
    // its history. (A long thread that only re-renders keeps its address, so it's left alone.)
    if (n < job.baseline && (n === 0 || location.href !== job.url)) { job.baseline = n; job.url = location.href; saveJob(); }
    if (n <= job.baseline) {
      if (driver.isGenerating()) return progress("thinking");
      if (!job.resent && now - job.sentAt > RESEND_MS) {
        const ed = driver.findEditor();
        if (ed && !driver.editorText(ed)) {
          job.resent = true; saveJob();
          progress("no reply yet: sending again");
          delivering = job.id;
          const r = await driver.send(job.text).catch(() => ({ ok: false }));
          delivering = null;
          if (job && r.ok) { job.sentAt = Date.now(); job.baseline = r.baseline; job.url = location.href; saveJob(); }
        }
      } else if (now - job.sentAt > 30_000) progress("no reply yet");
      return;
    }
    if (driver.isGenerating()) { job.stableAt = 0; return progress(job.kind === "prompt" ? "writing" : "working"); }
    const { text, blocks } = driver.read(list[n - 1]);
    if (!text.trim()) return;
    if (text !== job.lastText) { job.lastText = text; job.stableAt = now; return; }
    if (now - job.stableAt < SETTLE_MS) return;
    job.reply = { text, blocks };
    job.replyAt = now;
    saveJob();
    send({ type: "reply", id: job.id, text, blocks });
    lastNote = "";
  }

  timers.push(setInterval(watch, 600));
  timers.push(setInterval(() => send({ type: "beat", visible: !document.hidden }), 20_000)); // keeps the background awake
  const onVis = () => send({ type: "beat", visible: !document.hidden });
  document.addEventListener("visibilitychange", onVis);

  function dispose() {
    if (!alive) return;
    alive = false;
    timers.forEach(clearInterval);
    document.removeEventListener("visibilitychange", onVis);
    ui.dispose();
  }

  // ---- Pip ----------------------------------------------------------------------------
  const ui = (() => {
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    const base = document.createElement("style");
    base.textContent = ":host { all: initial; }";
    shadow.append(base);
    document.documentElement.append(host);
    let side = store.get("pip.side") === "left" ? "left" : "right";
    const dock = globalThis.PipDock(shadow, { onTap: () => tap(), side });
    const any = (xs) => xs[Math.floor(Math.random() * xs.length)];
    const say = (text, o = {}) => dock.show({ text, prio: 1, ...o });
    const oops = (text, o = {}) => dock.show({ text, prio: 4, err: true, kicker: "Uh oh", anim: "dizzy", ttl: 10_000, ...o });
    const openRoom = () => { send({ type: "openRoom" }); dock.play("point"); };
    const running = () => view?.status === "running";
    const myTurn = () => running() && view.speaker === AI;
    let wasRunning = false, lastLive = "";

    function greet() {
      if (joined || store.get("pip.greeted")) return;
      store.set("pip.greeted", true);
      dock.show({
        key: "greet", prio: 3, anim: "hello", kicker: "Pip AI Room",
        text: `Hi! I'm Pip. I can bring ${AI} into a research room with ${["Gemini", "ChatGPT", "Claude"].filter((n) => n !== AI).join(" and ")}.`,
        choices: [
          { label: "Join the room", pick: () => { setJoined(true); } },
          { label: "Not now", hot: false, pick: () => { dock.play("wave"); } },
        ],
      });
    }

    const menu = (text, choices, o = {}) => ({ key: "menu", prio: 5, loose: true, text, choices, ...o });
    function tap() {
      if (dock.isOpen("menu")) return dock.close("menu");
      dock.play("nod");
      if (!joined) return dock.show(menu(`${AI} isn't in the room yet.`, [
        { label: "Join the room", pick: () => { setJoined(true); } },
        { label: "Open the room", hot: false, pick: openRoom },
        { label: side === "right" ? "Move left" : "Move right", hot: false, pick: flipSide },
      ]));
      if (running()) return dock.show(menu(`A mission is running: turn ${Math.min(view.turn + 1, view.maxTurns)} of ${view.maxTurns}.`, [
        { label: "Open the room", pick: openRoom },
        { label: "Steer…", hot: false, pick: steerQ },
        { label: "Stop", hot: false, pick: stopQ },
      ]));
      dock.show(menu(`${AI} is in the room.`, [
        { label: "Open the room", pick: openRoom },
        { label: "Leave the room", hot: false, pick: () => { setJoined(false); say(`${AI} left the room.`, { anim: "wave" }); } },
        { label: side === "right" ? "Move left" : "Move right", hot: false, pick: flipSide },
      ]));
    }
    function flipSide() { side = side === "right" ? "left" : "right"; store.set("pip.side", side); dock.setSide(side); dock.play("jump"); }
    const steerQ = () => ({
      key: "menu", prio: 5, kicker: "Steer the team", text: "What should they do differently? @mention someone to give them the next turn.",
      input: { placeholder: "@Claude check o3's source first…", button: "Send", submit: (text) => { send({ type: "steer", text }); say("Passed it on.", { anim: "nod" }); } },
    });
    const stopQ = () => menu("Stop the mission?", [
      { label: "Stop", pick: () => { send({ type: "stop" }); } },
      { label: "Keep going", hot: false },
    ], { loose: false });

    function mood() {
      const gen = driver.isGenerating();
      dock.setBase(myTurn() ? (gen ? "think" : "read") : running() ? "watch" : "idle");
    }
    timers.push(setInterval(mood, 500));

    return {
      dispose() { host.remove(); },
      joined() {
        dock.close("greet");
        dock.show({ key: "joined", prio: 3, loose: true, anim: "celebrate", kicker: "In the room", text: `${AI} joined! Open the room to start a mission.`, choices: [{ label: "Open the room", pick: openRoom }] });
      },
      sent() { dock.close("deliver"); },
      seatLost() { say(`Another ${AI} tab took this seat, so this one left the room.`, { prio: 3, anim: "shake", ttl: 9000 }); },
      cancelled() { dock.setLive(null); },
      typing(kind) { if (kind === "prompt") say(`${AI}'s turn! Typing the brief…`, { key: "turn", anim: "read", ttl: 4000 }); },
      // keyed, so retries update the same card instead of popping a new one each time
      deliverFailed(err) { oops(`I couldn't type into ${AI}: ${err}. I'll keep trying.`, { key: "deliver" }); },
      tools(items) {
        const bad = items.filter((x) => !x.ok).length;
        dock.show({
          key: "tools", prio: bad ? 2 : 1, ttl: bad ? 9000 : 5000, err: false, anim: bad ? "dizzy" : "nod", kicker: `${AI} → brain`,
          text: bad ? `${bad} of ${items.length} didn't work. ${AI} will see why.` : any(["Saved to the brain!", "Got it, it's in the brain.", "Noted!"]),
          list: items.map((x) => ({ text: x.label + (x.ok ? "" : ` – ${String(x.error || "failed").slice(0, 70)}`), cls: x.ok ? "ok" : "bad" })),
        });
      },
      notice(text, err) { err ? oops(text) : say(text); },
      room(v) {
        if (!v) return;
        // a mission started: setup cards are old news, the live status takes over
        if (v.status === "running" && !wasRunning) for (const k of ["greet", "joined", "done", "menu"]) dock.close(k);
        if (v.status === "running") {
          const who = v.speaker === AI ? `${AI}'s turn: ${v.work || "working"}` : v.speaker ? `${v.speaker}: ${v.work || "on it"}` : "picking who's next";
          const sig = `${v.turn}|${v.phase}|${who}|${v.joined}`;
          if (sig !== lastLive) {
            lastLive = sig;
            dock.setLive({
              kicker: `Room · turn ${Math.min(v.turn + 1, v.maxTurns)}/${v.maxTurns} · ${v.phase}`,
              text: v.joined ? who : `${who}\n(${AI} in this tab isn't in the room)`,
              choices: [{ label: "Open the room", hot: false, pick: openRoom }],
            });
          }
        } else if (lastLive) { lastLive = ""; dock.setLive(null); }
        if (wasRunning && v.status === "done") {
          dock.close("joined");
          dock.show({ key: "done", prio: 3, loose: true, anim: "celebrate", kicker: "Mission finished", text: v.ended || "The team is done.", choices: [{ label: "See the report", pick: openRoom }] });
        }
        wasRunning = v.status === "running";
      },
      greet,
    };
  })();

  connect();
  setTimeout(() => ui.greet(), 1200);
})();
