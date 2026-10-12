// A stand-in for the chrome.* APIs, so the real background.js, room page and
// content scripts can run together in one ordinary web page (no extension).
// The parent page gets `chrome` for the background; iframes call
// parent.__pipHub to get their own `chrome.runtime.connect`.
(() => {
  const onConnect = [];
  const storage = { local: {}, session: {} };
  const events = []; // what the background asked the browser to do: front, windows ...
  const ROOM_URL = location.origin + "/src/room/room.html";
  const tabsById = new Map(); // tabId -> { frame, url }

  function portPair(name, sender) {
    const mk = () => ({ name, sender, _msg: [], _disc: [], closed: false,
      onMessage: { addListener(f) { this._p._msg.push(f); } }, onDisconnect: { addListener(f) { this._p._disc.push(f); } } });
    const a = mk(), b = mk();
    a.onMessage._p = a; a.onDisconnect._p = a; b.onMessage._p = b; b.onDisconnect._p = b;
    const wire = (from, to) => {
      from.postMessage = (m) => {
        if (from.closed) throw new Error("Attempting to use a disconnected port object");
        const copy = structuredClone(m);
        setTimeout(() => { if (!to.closed) to._msg.forEach((f) => f(copy, to)); }, 0);
      };
      from.disconnect = () => {
        if (from.closed) return;
        from.closed = to.closed = true;
        setTimeout(() => to._disc.forEach((f) => f(to)), 0);
      };
    };
    wire(a, b); wire(b, a);
    return [a, b];
  }

  const get = (area) => async (keys) => {
    const s = storage[area];
    if (keys == null) return structuredClone(s);
    const list = typeof keys === "string" ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
    const out = {};
    for (const k of list) if (k in s) out[k] = structuredClone(s[k]);
    return out;
  };
  const set = (area) => async (obj) => { Object.assign(storage[area], structuredClone(obj)); };

  globalThis.chrome = {
    runtime: {
      id: "harness",
      lastError: undefined,
      onConnect: { addListener: (f) => onConnect.push(f) },
      onInstalled: { addListener() {} },
      getURL: (p) => location.origin + "/" + p,
      getManifest: () => ({ content_scripts: [{ js: [] }] }),
    },
    storage: { local: { get: get("local"), set: set("local") }, session: { get: get("session"), set: set("session") } },
    alarms: { create() {}, onAlarm: { addListener() {} } },
    action: { onClicked: { addListener() {} } },
    scripting: { executeScript: async () => [] },
    tabs: {
      async update(id, props) { events.push({ kind: "tabs.update", id, props }); hub.onFront?.(id); return { id, windowId: id }; },
      async get(id) { return { id, windowId: id }; },
      async query() { return []; },
      async create(props) { events.push({ kind: "tabs.create", props }); return { id: 900 + events.length, windowId: 900 }; },
    },
    windows: {
      async get(id) { return { id, state: "normal" }; },
      async update(id, props) { events.push({ kind: "windows.update", id, props }); return { id }; },
      async create(props) { events.push({ kind: "windows.create", props }); return { id: 800 + events.length, tabs: [{ id: props.tabId ?? 800 + events.length }] }; },
    },
  };

  const hub = {
    ROOM_URL, storage, events, tabsById,
    // an iframe asks for a port; the background sees a normal extension port
    connect(name, tabId, url) {
      const [child, bg] = portPair(name, { tab: { id: tabId, windowId: tabId }, url });
      hub._ports.push(() => bg.disconnect());
      setTimeout(() => onConnect.forEach((f) => f(bg)), 0);
      return child;
    },
    // simulate the background service worker being killed: every port drops
    dropAllPorts() { const fs = hub._ports.splice(0); for (const f of fs) f(); },
    _ports: [],
  };
  globalThis.__pipHub = hub;
})();
