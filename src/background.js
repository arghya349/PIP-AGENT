// Pip's background service worker: the one place that holds the room.
//
//   chat tabs ──port "pip-agent"──▶ seats ──▶ engine ──▶ conductor + brain + tools
//   room page ──port "pip-room"───▶ commands; gets the live state back
//
// Chrome may stop this worker whenever it's idle, so everything that matters
// (room, brain, the turn in progress) is saved to chrome.storage.local and
// loaded again on wake-up; the tabs reconnect on their own. The tabs' heartbeat
// keeps the worker awake during a mission, and an alarm wakes it as a backstop.
import { createBrain } from "./core/brain.js";
import { createConductor } from "./core/conductor.js";
import { createEngine } from "./core/engine.js";
import { createToolbox } from "./core/tools.js";
import { SEATS, seatBySite, seatByName } from "./core/roles.js";
import { PROTOCOL } from "./core/protocol.js";

const KEY = "pip.v1";
const ROOM_PAGE = chrome.runtime.getURL("src/room/room.html");

// ---- log (kept for the room page's diagnostics) -----------------------------------
const logs = [];
function log(...a) {
  const line = `${new Date().toISOString().slice(11, 19)} ${a.join(" ")}`;
  logs.push(line);
  if (logs.length > 300) logs.shift();
  console.log("[pip]", ...a);
}

// ---- tabs and seats -------------------------------------------------------------
// every chat tab with Pip in it: tabId -> { port, site, name, joined, visible, url, seen }
const tabs = new Map();
const roomPorts = new Set();

// the tab that holds an agent's seat: the most recently joined tab of its site
function seatTab(name) {
  let best = null;
  for (const [id, t] of tabs) if (t.name === name && t.joined && (!best || t.joinedAt > best[1].joinedAt)) best = [id, t];
  return best;
}
const isLive = (name) => !!seatTab(name);

function post(port, msg) { try { port.postMessage(msg); return true; } catch { return false; } }

const transport = {
  connected: isLive,
  send(name, msg) {
    const s = seatTab(name);
    if (!s) return false;
    if (msg.op === "ask") front(s[0]); // a hidden tab doesn't finish rendering its replies
    return post(s[1].port, msg);
  },
};

async function front(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    const win = await chrome.windows.get(tab.windowId);
    if (win.state === "minimized") await chrome.windows.update(tab.windowId, { state: "normal" });
  } catch (e) { log("front failed:", e.message); }
}

// ---- state ------------------------------------------------------------------------
let brain, conductor, engine;
const toolbox = createToolbox(["core"]);
const ready = (async () => {
  let saved = {};
  try { saved = (await chrome.storage.local.get(KEY))[KEY] || {}; } catch (e) { log("load failed:", e.message); }
  brain = createBrain(saved.brain, { onChange: changed });
  conductor = createConductor(saved.room, { brain, isLive, onChange: changed });
  engine = createEngine(saved.engine, { conductor, brain, toolbox, transport, onChange: changed, log });
  if (conductor.state.status === "running") log(`resumed mission "${conductor.state.topic}" at turn ${conductor.state.turn + 1}`);
})();

let saveTimer = 0, dirty = false;
function changed() { dirty = true; if (!saveTimer) saveTimer = setTimeout(save, 250); scheduleBroadcast(); }
async function save() {
  clearTimeout(saveTimer); saveTimer = 0;
  if (!dirty || !engine) return;
  dirty = false;
  try { await chrome.storage.local.set({ [KEY]: { v: 1, room: conductor.toJSON(), brain: brain.toJSON(), engine: engine.toJSON() } }); }
  catch (e) { log("save failed:", e.message); dirty = true; }
}

// ---- what the room page and the tabs see ------------------------------------------
function seatsView() {
  return SEATS.map((s) => {
    const seat = seatTab(s.name);
    const open = [...tabs.values()].some((t) => t.name === s.name);
    return {
      name: s.name, role: s.role, site: s.site,
      state: seat ? "joined" : open ? "open" : "closed",
      tabId: seat ? seat[0] : null, visible: seat ? seat[1].visible : null,
    };
  });
}
function fullView() {
  return { type: "state", protocol: PROTOCOL, room: conductor.snapshot(), brain: brain.snapshot(), engine: engine.snapshot(), seats: seatsView() };
}
// the small view Pip shows in each chat tab
function pipView(name, joined) {
  const r = conductor.snapshot(), e = engine.snapshot();
  return {
    status: r.status, topic: r.topic, turn: r.turn, maxTurns: r.maxTurns, phase: r.phase, speaker: r.speaker,
    work: e?.work || null, you: name, joined, seats: seatsView().map((s) => ({ name: s.name, state: s.state })),
    last: r.messages.filter((m) => m.from !== "Room").slice(-1)[0] || null, ended: r.status === "done" ? r.messages.at(-1)?.text : null,
  };
}
let bTimer = 0;
function scheduleBroadcast() { if (!bTimer) bTimer = setTimeout(broadcast, 200); }
function broadcast() {
  bTimer = 0;
  if (!engine) return;
  const v = fullView();
  for (const p of roomPorts) post(p, v);
  for (const t of tabs.values()) post(t.port, { op: "room", view: pipView(t.name, t.joined) });
}

// ---- the clock ----------------------------------------------------------------------
function tick() {
  if (!engine) return;
  try { engine.tick(); } catch (e) { log("tick error:", e.stack || e.message); }
}
setInterval(tick, 1000);
chrome.alarms.create("pip-wake", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === "pip-wake") { await ready; tick(); } });

// ---- chat tabs ----------------------------------------------------------------------
chrome.runtime.onConnect.addListener(async (port) => {
  if (port.name === "pip-room") return roomConnected(port);
  if (port.name !== "pip-agent") return port.disconnect();
  const tabId = port.sender?.tab?.id;
  const seat = seatBySite(new URL(port.sender?.url || "about:blank").hostname);
  if (tabId == null || !seat) return port.disconnect();
  const entry = { port, site: seat.site, name: seat.name, joined: false, joinedAt: 0, visible: true, url: port.sender.url, seen: Date.now() };
  tabs.set(tabId, entry);
  port.onDisconnect.addListener(() => {
    if (tabs.get(tabId)?.port === port) { tabs.delete(tabId); log(`${seat.name} tab ${tabId} disconnected`); scheduleBroadcast(); }
  });
  port.onMessage.addListener(async (msg) => {
    await ready;
    try { onTabMessage(tabId, entry, msg); } catch (e) { log("tab message error:", e.stack || e.message); }
  });
  await ready;
  scheduleBroadcast();
});

async function onTabMessage(tabId, t, msg) {
  if (!msg || typeof msg.type !== "string") return;
  t.seen = Date.now();
  switch (msg.type) {
    case "hello": {
      t.visible = msg.visible !== false; t.url = msg.url || t.url;
      const pending = (await chrome.storage.session.get("pendingJoin")).pendingJoin || {};
      if (pending[tabId]) { delete pending[tabId]; await chrome.storage.session.set({ pendingJoin: pending }); post(t.port, { op: "join" }); }
      else if (msg.joined) seatJoin(tabId, t, Number(msg.joinedAt) || Date.now());
      // only the seated tab's view of the job counts
      if (seatTab(t.name)?.[0] === tabId) engine.onMessage(t.name, msg);
      break;
    }
    case "beat": t.visible = msg.visible !== false; return; // just keeps the worker awake
    case "join": seatJoin(tabId, t, Number(msg.joinedAt) || Date.now()); log(`${t.name} joined (tab ${tabId})`); break;
    case "leave": t.joined = false; log(`${t.name} left the room`); break;
    case "front": front(tabId); return;
    case "openRoom": openRoom(); return;
    case "steer": return reply(t, () => conductor.steer({ text: msg.text }));
    case "stop": return reply(t, () => conductor.stop());
    case "job": case "reply":
      // only the seated tab speaks for its agent
      if (seatTab(t.name)?.[0] !== tabId) { if (msg.type === "reply") post(t.port, { op: "ack", id: msg.id }); return; }
      engine.onMessage(t.name, msg);
      if (msg.type === "reply") await save(); // a processed reply must not be processed twice after a restart
      break;
    default: return;
  }
  tick();
  scheduleBroadcast();
}

// one seat per agent: the tab that joined last holds it, the others step down.
// joinedAt comes from the tab, so the same tab wins again after a worker restart.
function seatJoin(tabId, t, joinedAt) {
  const rival = [...tabs].find(([id, o]) => id !== tabId && o.name === t.name && o.joined);
  if (rival && rival[1].joinedAt > joinedAt) { t.joined = false; post(t.port, { op: "seat", seated: false }); return; }
  if (rival) { rival[1].joined = false; post(rival[1].port, { op: "seat", seated: false }); }
  t.joined = true;
  t.joinedAt = joinedAt;
}

function reply(t, fn) {
  try { fn(); tick(); } catch (e) { post(t.port, { op: "notice", text: e.message, err: true }); }
  scheduleBroadcast();
}

// ---- past missions: the last 10, with their brains, for export -----------------------------
const ARCHIVE = "pip.v1.archive";
// anything beyond the mission notes themselves (the room page uses the same rule)
function brainHasWork() {
  const b = brain.toJSON();
  return b.observations.length + b.hypotheses.length + b.findings.length + b.tasks.length + b.notes.filter((n) => n.kind !== "mission").length > 0;
}
async function readArchive() {
  try { return (await chrome.storage.local.get(ARCHIVE))[ARCHIVE] || []; } catch { return []; }
}
async function archive() {
  const room = conductor.toJSON();
  if (!room.topic) return;
  const list = await readArchive();
  list.unshift({ at: Date.now(), room: structuredClone(room), brain: brain.snapshot() });
  await chrome.storage.local.set({ [ARCHIVE]: list.slice(0, 10) });
}

// ---- the room page -------------------------------------------------------------------
async function roomConnected(port) {
  if (port.sender?.url?.split("#")[0].split("?")[0] !== ROOM_PAGE) return port.disconnect();
  roomPorts.add(port);
  port.onDisconnect.addListener(() => roomPorts.delete(port));
  port.onMessage.addListener(async (msg) => {
    await ready;
    let res;
    try { res = { ok: true, result: await roomCommand(msg, port) }; }
    catch (e) { res = { ok: false, error: e.message }; }
    if (msg?.rid) post(port, { type: "res", rid: msg.rid, ...res });
    tick();
    scheduleBroadcast();
  });
  await ready;
  post(port, fullView());
}

async function roomCommand(msg, port) {
  switch (msg?.cmd) {
    case "start": {
      if (conductor.state.status === "running") throw new Error("A mission is already running. Stop it first.");
      // a new mission starts with an empty brain unless asked to continue; the old one is archived
      if (!msg.keepBrain && brainHasWork()) { await archive(); brain.reset(); }
      return conductor.start({ topic: msg.topic, maxTurns: msg.maxTurns, first: msg.first });
    }
    case "archive": return (await readArchive()).map((a, i) => ({ i, topic: a.room.topic, at: a.at, turns: a.room.turn, maxTurns: a.room.maxTurns, findings: a.brain.findings.length, observations: a.brain.observations.length }));
    case "exportArchived": {
      const a = (await readArchive())[msg.i];
      if (!a) throw new Error("That mission isn't in the archive.");
      return { room: { ...a.room, phase: "conclude", phaseIndex: 4, messages: a.room.messages }, brain: a.brain };
    }
    case "steer": return conductor.steer({ text: msg.text });
    case "stop": return conductor.stop();
    case "resetBrain":
      if (conductor.state.status === "running") throw new Error("Stop the mission first.");
      await archive();
      brain.reset();
      return true;
    case "connectAll": return connectAll(msg.area, port.sender?.tab);
    case "arrange": return arrange(msg.area, port.sender?.tab);
    case "openSeat": return openSeat(msg.name, msg.area);
    case "leaveSeat": {
      const s = seatTab(msg.name);
      if (s) { s[1].joined = false; post(s[1].port, { op: "seat", seated: false }); }
      return true;
    }
    case "export": return { room: { ...conductor.snapshot(), messages: conductor.state.messages }, brain: brain.snapshot() };
    case "logs": return logs.slice(-200);
    case "state": return fullView();
    default: throw new Error("Unknown command");
  }
}

async function openRoom() {
  for (const p of roomPorts) {
    const tab = p.sender?.tab;
    if (!tab) continue;
    try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); return; } catch {}
  }
  await chrome.tabs.create({ url: ROOM_PAGE });
}

// ---- windows: the room and three chats side by side, all visible ----------------------
// slot 0 = room page (top left), then Gemini, ChatGPT, Claude
function slots(area) {
  const a = sanitizeArea(area);
  const w = Math.floor(a.width / 2), h = Math.floor(a.height / 2);
  return [0, 1, 2, 3].map((i) => ({ left: a.left + (i % 2) * w, top: a.top + Math.floor(i / 2) * h, width: w, height: h }));
}
function sanitizeArea(a) {
  const n = (v, d) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : d);
  return { left: n(a?.left, 0), top: n(a?.top, 0), width: Math.max(800, n(a?.width, 1440)), height: Math.max(600, n(a?.height, 900)) };
}
async function placeTab(tabId, rect) {
  const tab = await chrome.tabs.get(tabId);
  const others = (await chrome.tabs.query({ windowId: tab.windowId })).length > 1;
  if (others) await chrome.windows.create({ tabId, ...rect, focused: false });
  else {
    const win = await chrome.windows.get(tab.windowId);
    if (win.state !== "normal") await chrome.windows.update(win.id, { state: "normal" });
    await chrome.windows.update(win.id, rect);
  }
}
async function arrange(area, roomTab) {
  const s = slots(area), done = [];
  const jobs = [];
  if (roomTab?.id != null) jobs.push(placeTab(roomTab.id, s[0]).then(() => done.push("room")));
  SEATS.forEach((seat, i) => {
    const t = seatTab(seat.name) || [...tabs].find(([, x]) => x.name === seat.name);
    if (t) jobs.push(placeTab(t[0], s[i + 1]).then(() => done.push(seat.name)));
  });
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") log("arrange:", r.reason?.message);
  return done;
}
async function openSeat(name, area) {
  const seat = seatByName(name);
  if (!seat) throw new Error("No such seat");
  const have = seatTab(name) || [...tabs].find(([, x]) => x.name === name);
  if (have) { await front(have[0]); if (!have[1].joined) post(have[1].port, { op: "join" }); return "focused"; }
  const i = SEATS.indexOf(seat) + 1;
  const win = await chrome.windows.create({ url: seat.home, focused: false, ...slots(area)[i] });
  await markPendingJoin(win.tabs[0].id);
  return "opened";
}
async function markPendingJoin(tabId) {
  const pending = (await chrome.storage.session.get("pendingJoin")).pendingJoin || {};
  pending[tabId] = true;
  await chrome.storage.session.set({ pendingJoin: pending });
}
async function connectAll(area, roomTab) {
  for (const seat of SEATS) {
    const t = seatTab(seat.name) || [...tabs].find(([, x]) => x.name === seat.name);
    if (t) { if (!t[1].joined) post(t[1].port, { op: "join" }); }
    else await openSeat(seat.name, area);
  }
  await arrange(area, roomTab);
  return seatsView();
}

// ---- install: Pip appears in chats that are already open, and the room opens once --------
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const files = chrome.runtime.getManifest().content_scripts[0].js;
  const open = await chrome.tabs.query({ url: SEATS.map((s) => `https://${s.site}/*`) });
  for (const tab of open) {
    if (tab.discarded) continue;
    chrome.scripting.executeScript({ target: { tabId: tab.id }, files }).catch((e) => log(`inject into tab ${tab.id}:`, e.message));
  }
  if (reason === "install") chrome.tabs.create({ url: ROOM_PAGE + "#welcome" });
});
chrome.action.onClicked.addListener(() => openRoom());
