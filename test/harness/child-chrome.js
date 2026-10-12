// In a harness iframe: a chrome.runtime that connects to the parent's hub.
// ?tab=<id>&url=<what the background should think this page is>
(() => {
  const q = new URLSearchParams(location.search);
  const hub = parent.__pipHub;
  const tabId = Number(q.get("tab")) || 1;
  const url = q.get("url") || hub.ROOM_URL;
  globalThis.chrome = {
    runtime: {
      id: "harness",
      lastError: undefined,
      connect: ({ name }) => hub.connect(name, tabId, url),
    },
  };
})();
