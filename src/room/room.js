// The room page: shows the team, the mission, the conversation and the shared
// brain, live, and sends the host's commands to the background. It holds no
// state of its own beyond what's on screen: the background is the truth.
import { toMarkdown } from "../core/report.js";

const $ = (id) => document.getElementById(id);
const AGENTS = ["Gemini", "ChatGPT", "Claude"];
const PHASE_LABEL = { scope: "Scope", collect: "Collect", hypothesise: "Hypothesise", challenge: "Challenge", conclude: "Conclude" };
let state = null;

// ---- talking to the background ----------------------------------------------------------
let port = null, rid = 0;
const pending = new Map();
function connect() {
  try { port = chrome.runtime.connect({ name: "pip-room" }); } catch { $("conn").hidden = false; return; }
  port.onMessage.addListener((m) => {
    if (m.type === "res") {
      const p = pending.get(m.rid);
      if (p) { pending.delete(m.rid); m.ok ? p.resolve(m.result) : p.reject(new Error(m.error)); }
      return;
    }
    if (m.type === "state") { $("conn").hidden = true; state = m; render(); }
  });
  port.onDisconnect.addListener(() => {
    port = null;
    void chrome.runtime.lastError;
    $("conn").hidden = false;
    for (const p of pending.values()) p.reject(new Error("Lost the connection to Pip. Try again."));
    pending.clear();
    setTimeout(connect, 800);
  });
}
function cmd(c, args = {}) {
  return new Promise((resolve, reject) => {
    if (!port) return reject(new Error("Not connected to Pip yet."));
    const id = ++rid;
    pending.set(id, { resolve, reject });
    port.postMessage({ rid: id, cmd: c, ...args });
    setTimeout(() => { if (pending.delete(id)) reject(new Error("Pip didn't answer.")); }, 45_000);
  });
}
// where the windows go: this screen's usable area
const area = () => ({ left: screen.availLeft ?? 0, top: screen.availTop ?? 0, width: screen.availWidth, height: screen.availHeight });

// ---- small DOM helpers ----------------------------------------------------------------
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
const ago = (ms) => { const s = Math.round((Date.now() - ms) / 1000); return s < 60 ? `${s}s` : `${Math.round(s / 60)} min`; };
async function busy(btn, fn) {
  btn.disabled = true;
  try { return await fn(); } finally { btn.disabled = false; render(); }
}

// ids in text (o3, h2, f1, t4, n5) become buttons that open that item in the brain
function withRefs(text) {
  const frag = document.createDocumentFragment();
  const known = new Set(state ? [...state.brain.observations, ...state.brain.hypotheses, ...state.brain.findings, ...state.brain.tasks, ...state.brain.notes].map((x) => x.id) : []);
  let last = 0;
  for (const m of String(text).matchAll(/\b([ohftn]\d{1,4})\b/g)) {
    if (!known.has(m[1])) continue;
    frag.append(text.slice(last, m.index));
    frag.append(h("button", { type: "button", class: "ref", text: m[1], title: `Show ${m[1]} in the brain`, onclick: () => showItem(m[1]) }));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

// ---- render ---------------------------------------------------------------------------
function render() {
  if (!state) return;
  const { room, engine, seats } = state;
  const running = room.status === "running";
  const joined = seats.filter((s) => s.state === "joined").length;

  // seats
  $("seats").replaceChildren(...seats.map((s) => {
    const speaking = running && room.speaker === s.name;
    let line = s.state === "closed" ? "Not open" : s.state === "open" ? "Open, not in the room" : speaking ? (engine?.work || "on it") : running ? "Waiting for its turn" : "Ready";
    const warn = s.state === "joined" && s.visible === false;
    if (warn) line = "Window hidden: keep it on screen";
    const act = s.state === "closed" ? ["Open", () => cmd("openSeat", { name: s.name, area: area() })]
      : s.state === "open" ? ["Join", () => cmd("openSeat", { name: s.name, area: area() })]
        : ["Leave", () => cmd("leaveSeat", { name: s.name })];
    const btn = h("button", { type: "button", class: s.state === "joined" ? "ghost" : "", text: act[0] });
    btn.addEventListener("click", () => busy(btn, act[1]).catch((e) => hint(e.message, true)));
    return h("article", { class: `seat who-${s.name}${speaking ? " speaking" : ""}`, "aria-label": `${s.name}, ${s.role}` },
      h("div", { class: "seat-head" }, h("span", { class: "seat-name", text: s.name }), h("span", { class: "seat-role", text: s.role }), h("span", { class: `dot ${s.state}`, title: s.state })),
      h("div", { class: `seat-state${warn ? " warn" : ""}`, text: line }),
      btn);
  }));
  $("connectAll").textContent = joined === 3 ? "All three connected" : "Connect all three";
  $("connectAll").disabled = joined === 3;

  // mission form vs live view
  $("startForm").hidden = running;
  $("live").hidden = room.status === "idle";
  $("steerForm").hidden = !running;
  $("startBtn").disabled = joined < 2;
  const b = state.brain, known = b.observations.length + b.hypotheses.length + b.findings.length + b.tasks.length + b.notes.filter((n) => n.kind !== "mission").length;
  $("keepWrap").hidden = running || !known;
  $("keepWhat").textContent = known ? `(${b.observations.length} evidence, ${b.hypotheses.length} hypotheses, ${b.findings.length} findings; otherwise they're archived)` : "";
  if (!running && !$("startHint").classList.contains("err")) {
    hint(joined < 2 ? `Connect at least two chats to start (${joined} connected).` : `${joined} chats connected. Keep their windows visible while they work.`);
  }
  if (room.status !== "idle") {
    const p = room.phaseIndex;
    $("phaseName").textContent = running ? PHASE_LABEL[room.phase] : room.status === "done" ? "Finished" : room.status;
    $("turnNo").textContent = running ? `turn ${Math.min(room.turn + 1, room.maxTurns)} of ${room.maxTurns}` : `${room.turn} turns`;
    $("topicView").textContent = room.topic;
    $("phases").replaceChildren(...room.phases.map((id, i) => h("li", { class: i < p || room.status === "done" ? "done" : i === p ? "now" : "", text: PHASE_LABEL[id] })));
    const now = $("now");
    now.replaceChildren();
    if (running && room.speaker) {
      now.className = `now who-${room.speaker}`;
      now.append(h("b", { text: room.speaker }), ` · ${engine?.work || "getting ready"}`, engine?.steps ? ` · ${engine.steps} tool step${engine.steps > 1 ? "s" : ""}` : "", engine?.startedAt ? ` · ${ago(engine.startedAt)}` : "");
    } else if (room.status === "done") now.append("The mission is over. Export the report below, or start a new one.");
  }
  document.title = running ? `● ${room.speaker || "…"} · turn ${Math.min(room.turn + 1, room.maxTurns)}/${room.maxTurns} · Pip AI Room` : "Pip AI Room";

  renderFeed();
  renderBrain();
  $("proto").textContent = state.protocol;
  pipMood(running ? (room.speaker ? "watch" : "think") : room.status === "done" ? "cheer" : "idle");
}

let feedKey = "";
function renderFeed() {
  const { room } = state;
  const msgs = room.messages;
  const key = `${room.missionId}|${msgs.length ? msgs.at(-1).seq : 0}|${state.brain.writes}`;
  if (key === feedKey) return;
  feedKey = key;
  const feed = $("feed");
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 80;
  if (!msgs.length) feed.replaceChildren(h("li", { class: "empty", text: "No mission yet. Connect the chats and give the team something to research." }));
  else feed.replaceChildren(...msgs.map((m) => h("li", { class: `${m.from} who-${m.from}` },
    h("div", { class: "who" }, m.from, m.turn ? h("span", { class: "meta", text: `turn ${m.turn} · ${m.phase}` }) : null, m.wrote === false ? h("span", { class: "meta quiet", text: "added nothing to the brain" }) : null),
    h("p", { class: "text" }, withRefs(m.text)))));
  if (atBottom && room.status === "running") window.scrollTo({ top: document.body.scrollHeight });
}

// ---- the brain ---------------------------------------------------------------------------
const TABS = [
  ["findings", "Findings"], ["hypotheses", "Hypotheses"], ["observations", "Evidence"], ["tasks", "Tasks"], ["notes", "Notes"],
];
let tab = "findings", brainKey = "";
function renderBrain() {
  const b = state.brain;
  const n = { findings: b.findings.length, hypotheses: b.hypotheses.length, observations: b.observations.length, tasks: b.tasks.filter((t) => t.status === "open").length, notes: b.notes.filter((x) => x.kind !== "mission").length };
  $("brainCount").textContent = `${n.observations}·${n.hypotheses}·${n.findings}`;
  $("brainTabs").replaceChildren(...TABS.map(([id, label]) => h("button", { type: "button", role: "tab", "aria-selected": String(tab === id), onclick: () => { tab = id; brainKey = ""; renderBrain(); } }, `${label} `, h("span", { class: "count", text: String(n[id]) }))));
  const key = `${tab}|${b.writes}|${b.observations.length}`;
  if (key === brainKey) return;
  brainKey = key;
  const body = $("brainBody");
  const items = tab === "notes" ? b.notes.filter((x) => x.kind !== "mission") : b[tab];
  if (!items.length) return body.replaceChildren(h("p", { class: "empty", text: EMPTY[tab] }));
  body.replaceChildren(...[...items].reverse().map(RENDER[tab]));
}
const EMPTY = {
  findings: "No findings yet. The team writes them in the last phase.",
  hypotheses: "No hypotheses yet.",
  observations: "No evidence yet. The Scout collects it first.",
  tasks: "No tasks.",
  notes: "No notes yet.",
};
const badge = (cls, text) => h("span", { class: `badge ${cls}`, text: text || cls });
const by = (name) => h("span", { class: `who-${name}`, style: "color: var(--who)", text: name });
const RENDER = {
  findings: (f) => h("div", { class: "item", id: `item-${f.id}` },
    h("div", { class: "item-head" }, h("span", { class: "id", text: f.id }), h("b", { text: f.title }), badge(f.confidence)),
    h("p", {}, withRefs(f.text)),
    f.actions.length ? h("ul", {}, f.actions.map((a) => h("li", { text: a }))) : null,
    h("p", { class: "sub" }, "by ", by(f.by), ` · agreed by ${f.agreed_by.join(", ")}`, f.hypotheses.length ? ` · rests on ${f.hypotheses.join(", ")}` : "")),
  hypotheses: (x) => h("div", { class: "item", id: `item-${x.id}` },
    h("div", { class: "item-head" }, h("span", { class: "id", text: x.id }), badge(x.status), h("span", { class: "sub" }, "by ", by(x.created_by))),
    h("p", {}, withRefs(x.claim)),
    h("div", { class: "stances" }, Object.entries(x.stances).map(([a, s]) => h("span", { class: `stance who-${a}`, title: s.reason }, h("b", { text: a }), ` ${s.stance}`))),
    x.evidence_for.length || x.evidence_against.length ? h("p", { class: "sub" }, withRefs(`for: ${x.evidence_for.join(", ") || "none"} · against: ${x.evidence_against.join(", ") || "none"}`)) : null),
  observations: (o) => h("div", { class: "item", id: `item-${o.id}` },
    h("div", { class: "item-head" }, h("span", { class: "id", text: o.id }),
      o.disputed_by.length ? badge("disputed", `disputed · ${o.disputed_by.join(", ")}`) : o.checked_by.length ? badge("confirmed", `checked · ${o.checked_by.join(", ")}`) : badge("unchecked"),
      h("span", { class: "sub" }, "by ", by(o.added_by), o.date ? ` · ${o.date}` : "")),
    h("p", { text: o.claim }),
    o.quote ? h("p", { class: "sub", text: `“${o.quote}”` }) : null,
    h("p", { class: "sub" }, h("a", { href: o.source.url, target: "_blank", rel: "noopener noreferrer", text: o.source.title || o.source.url }), ` · ${o.source.outlet}`, o.source.published ? ` · ${o.source.published}` : ""),
    (o.check_notes || []).map((c) => h("p", { class: "sub" }, by(c.by), ` ${c.verdict}: ${c.note}`))),
  tasks: (t) => h("div", { class: "item", id: `item-${t.id}` },
    h("div", { class: "item-head" }, h("span", { class: "id", text: t.id }), badge(t.status), h("span", { class: "sub" }, "for ", by(t.for), " · from ", t.from === "Host" ? "Host" : by(t.from))),
    h("p", {}, withRefs(t.title)),
    t.result ? h("p", { class: "sub" }, "→ ", withRefs(t.result)) : null),
  notes: (n) => h("div", { class: "item", id: `item-${n.id}` },
    h("div", { class: "item-head" }, h("span", { class: "id", text: n.id }), badge("proposed", n.kind), h("span", { class: "sub" }, "by ", n.by === "Host" ? "Host" : by(n.by))),
    h("p", {}, withRefs(n.text))),
};
function showItem(id) {
  tab = { o: "observations", h: "hypotheses", f: "findings", t: "tasks", n: "notes" }[id[0]];
  brainKey = "";
  setView("brain");
  renderBrain();
  const el = $(`item-${id}`);
  if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash"); }
}

// ---- narrow screens: one pane at a time --------------------------------------------------
function setView(v) {
  document.body.dataset.view = v;
  for (const b of document.querySelectorAll(".switch button")) b.setAttribute("aria-pressed", String(b.dataset.view === v));
}
for (const b of document.querySelectorAll(".switch button")) b.addEventListener("click", () => setView(b.dataset.view));
setView("talk");

// ---- actions ------------------------------------------------------------------------------
function hint(text, err = false) { const el = $("startHint"); el.textContent = text; el.classList.toggle("err", err); }
$("startForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const topic = $("topic").value.trim();
  if (!topic) return hint("Write the mission first.", true), $("topic").focus();
  hint("Starting…");
  busy($("startBtn"), () => cmd("start", { topic, maxTurns: Number($("turns").value), keepBrain: $("keepBrain").checked }))
    .then(() => { $("topic").value = ""; $("keepBrain").checked = false; hint(""); feedKey = ""; brainKey = ""; })
    .catch((err) => hint(err.message, true));
});
$("topic").addEventListener("input", () => { if ($("startHint").classList.contains("err")) hint(""); });
$("steerForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = $("steer").value.trim();
  if (!text) return;
  cmd("steer", { text }).then(() => { $("steer").value = ""; }).catch((err) => alert(err.message));
});
$("stop").addEventListener("click", () => { if (confirm("Stop the mission? The brain keeps everything found so far.")) cmd("stop").catch((e) => alert(e.message)); });
$("connectAll").addEventListener("click", (e) => busy(e.currentTarget, () => cmd("connectAll", { area: area() })).catch((err) => hint(err.message, true)));
$("arrange").addEventListener("click", (e) => busy(e.currentTarget, () => cmd("arrange", { area: area() })).catch((err) => hint(err.message, true)));

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const fileName = (ext) => `pip-room-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
$("exportMd").addEventListener("click", () => cmd("export").then((x) => download(fileName("md"), toMarkdown(x.room, x.brain), "text/markdown")).catch((e) => alert(e.message)));
$("exportJson").addEventListener("click", () => cmd("export").then((x) => download(fileName("json"), JSON.stringify(x, null, 1), "application/json")).catch((e) => alert(e.message)));
$("resetBrain").addEventListener("click", () => {
  if (!confirm("Clear the brain? Its evidence, hypotheses, findings, tasks and notes move to Past missions.")) return;
  cmd("resetBrain").catch((e) => alert(e.message));
});
$("diag").addEventListener("click", async () => {
  const logs = await cmd("logs").catch((e) => [e.message]);
  const seats = state ? state.seats.map((s) => `${s.name}: ${s.state}${s.visible === false ? " (hidden)" : ""}`).join("\n") : "";
  openDialog("Diagnostics", `${state?.protocol || ""}\n${seats}\n\nengine: ${JSON.stringify(state?.engine || null)}\n\n${logs.join("\n")}`);
});
function openDialog(title, body, list = null) {
  $("dlgTitle").textContent = title;
  $("dlgBody").textContent = body;
  $("dlgBody").hidden = !body;
  $("dlgCopy").hidden = !body;
  $("dlgList").hidden = !list;
  $("dlgList").replaceChildren(...(list || []));
  $("dlg").showModal();
}
$("past").addEventListener("click", async () => {
  const items = await cmd("archive").catch((e) => { alert(e.message); return null; });
  if (!items) return;
  if (!items.length) return openDialog("Past missions", "No past missions yet. A mission is archived when the next one starts with an empty brain, or when you clear the brain.");
  openDialog("Past missions", "", items.map((a) => h("li", {},
    h("div", {}, h("b", { text: a.topic }), h("br"), h("span", { text: `${new Date(a.at).toLocaleString()} · ${a.turns}/${a.maxTurns} turns · ${a.observations} evidence · ${a.findings} findings` })),
    h("button", { type: "button", class: "ghost small", text: "Export", onclick: () => cmd("exportArchived", { i: a.i }).then((x) => download(fileName("md"), toMarkdown(x.room, x.brain), "text/markdown")).catch((e) => alert(e.message)) }))));
});
$("dlgCopy").addEventListener("click", () => navigator.clipboard.writeText($("dlgBody").textContent).catch(() => {}));

// first visit: the three steps
const dismissed = (() => { try { return localStorage.getItem("pip.welcome") === "1"; } catch { return false; } })();
$("welcome").hidden = dismissed && location.hash !== "#welcome";
$("welcomeClose").addEventListener("click", () => { $("welcome").hidden = true; try { localStorage.setItem("pip.welcome", "1"); } catch {} history.replaceState(null, "", location.pathname); });

// ---- Pip in the header ---------------------------------------------------------------------
const P = globalThis.PipEngine;
let mood = "idle", moodAt = performance.now(), seed = Math.random() * 1000;
function pipMood(m) { if (m !== mood && P?.ANIMS[m]) { mood = m; moodAt = performance.now(); seed = Math.random() * 1000; } }
if (P) {
  const canvas = $("pip"), ctx = canvas.getContext("2d");
  const dpr = Math.min(3, devicePixelRatio || 1), px = 2;
  canvas.width = canvas.height = P.GRID * px * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let lastFrame = -1;
  (function frame(now) {
    const a = P.ANIMS[mood] || P.ANIMS.idle;
    let t = (now - moodAt) / 1000;
    if (a.duration && t >= a.duration) { if (mood === "cheer") pipMood("idle"); t = a.duration - 0.001; }
    const f = Math.floor(t * 12);
    if (f !== lastFrame) { lastFrame = f; P.paint(ctx, P.compose(a.frame(still ? 0 : f / 12, seed)), px); }
    requestAnimationFrame(frame);
  })(performance.now());
}

connect();
