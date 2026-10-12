// A fake chat site for the harness. ?site=gemini.google.com | chatgpt.com |
// claude.ai builds a page whose structure matches that site's selectors in
// src/content/sites.js, with a scripted bot that streams replies (a stop
// button while it writes, like the real thing). The bots follow the pip
// protocol, with a few deliberate mistakes so the repair paths get exercised.
(() => {
  const site = new URLSearchParams(location.search).get("site");
  const NAME = { "gemini.google.com": "Gemini", "chatgpt.com": "ChatGPT", "claude.ai": "Claude" }[site];
  document.title = `fake ${NAME}`;
  const css = document.createElement("style");
  css.textContent = `body{margin:0;font:13px/1.45 system-ui;background:#f6f6f4;color:#222;display:flex;flex-direction:column;height:100vh}
  #thread{flex:1;overflow:auto;padding:10px 12px 120px} .u{background:#e8e6ff;padding:6px 8px;border-radius:8px;margin:6px 0 6px 30%;white-space:pre-wrap;max-height:80px;overflow:hidden}
  .a{background:#fff;padding:6px 8px;border-radius:8px;margin:6px 30% 6px 0;border:1px solid #ddd} .a p{margin:0 0 4px;white-space:pre-wrap} pre{background:#222;color:#eee;padding:6px;border-radius:6px;white-space:pre-wrap;word-break:break-all}
  form{display:flex;gap:6px;padding:8px;border-top:1px solid #ddd;background:#fff} [contenteditable]{flex:1;min-height:34px;border:1px solid #aaa;border-radius:6px;padding:6px;outline:none;white-space:pre-wrap;max-height:90px;overflow:auto}
  h1{font-size:12px;margin:0;padding:6px 12px;background:#333;color:#fff}`;
  document.head.append(css);

  // ---- the page, shaped like the real site ------------------------------------------------
  const H = (tag, attrs = {}, text) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };
  const title = H("h1", {}, `${NAME} (fake, for the harness)`);
  const thread = H("div", { id: "thread" });
  const form = H("form");
  let editor, sendBtn, stopBtn;
  if (site === "gemini.google.com") {
    const rt = H("rich-textarea");
    editor = H("div", { class: "ql-editor", contenteditable: "true", role: "textbox" });
    rt.append(editor);
    form.append(rt);
    sendBtn = H("button", { type: "button", "aria-label": "Send message", class: "send-button" }, "Send");
    stopBtn = H("button", { type: "button", "aria-label": "Stop response" }, "Stop");
  } else if (site === "chatgpt.com") {
    editor = H("div", { id: "prompt-textarea", class: "ProseMirror", contenteditable: "true" });
    form.append(editor);
    sendBtn = H("button", { type: "button", "data-testid": "send-button", "aria-label": "Send prompt" }, "Send");
    stopBtn = H("button", { type: "button", "data-testid": "stop-button", "aria-label": "Stop streaming" }, "Stop");
  } else {
    editor = H("div", { class: "ProseMirror", contenteditable: "true" });
    form.append(editor);
    sendBtn = H("button", { type: "button", "aria-label": "Send message" }, "Send");
    stopBtn = H("button", { type: "button", "aria-label": "Stop response" }, "Stop");
  }
  form.append(sendBtn);
  document.body.append(title, thread, form);
  const refresh = () => { sendBtn.disabled = !editor.innerText.trim() || generating; };
  editor.addEventListener("input", refresh);
  // ProseMirror boxes take pasted text from the clipboard event
  if (site !== "gemini.google.com") editor.addEventListener("paste", (e) => { e.preventDefault(); editor.textContent += e.clipboardData.getData("text/plain"); editor.dispatchEvent(new Event("input", { bubbles: true })); });
  editor.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  sendBtn.addEventListener("click", submit);
  form.addEventListener("submit", (e) => { e.preventDefault(); submit(); });
  let generating = false;
  refresh();

  function submit() {
    const text = editor.innerText.trim();
    if (!text || generating) return;
    editor.textContent = "";
    refresh();
    const u = site === "gemini.google.com" ? H("user-query", { class: "u" }) : site === "chatgpt.com" ? H("div", { "data-message-author-role": "user", class: "u" }) : H("div", { "data-testid": "user-message", class: "u" });
    u.textContent = text;
    thread.append(u);
    window.__fake.received.push(text);
    stream(bot(text));
  }

  // ---- streaming a reply ---------------------------------------------------------------
  function render(el, raw) {
    el.replaceChildren();
    const parts = raw.split(/```([a-z]*)\n([\s\S]*?)(?:```|$)/);
    for (let i = 0; i < parts.length; i += 3) {
      if (parts[i].trim()) el.append(H("p", {}, parts[i].trim()));
      if (i + 2 < parts.length) {
        const lang = parts[i + 1], code = parts[i + 2];
        const pre = H("pre");
        pre.append(H("div", { class: "lang" }, lang || "code"), H("code", {}, code), H("button", { type: "button" }, "Copy code"));
        if (site === "gemini.google.com") { const cb = H("code-block"); cb.append(pre); el.append(cb); } else el.append(pre);
      }
    }
  }
  function stream(raw) {
    generating = true;
    refresh();
    sendBtn.replaceWith(stopBtn);
    const a = site === "gemini.google.com" ? H("model-response", { class: "a" }) : site === "chatgpt.com" ? H("div", { "data-message-author-role": "assistant", class: "a" }) : H("div", { "data-is-streaming": "true", class: "a" });
    thread.append(a);
    let n = 0;
    const step = Math.max(20, Math.ceil(raw.length / 12));
    const timer = setInterval(() => {
      n = Math.min(raw.length, n + step);
      render(a, raw.slice(0, n));
      thread.scrollTop = thread.scrollHeight;
      if (n >= raw.length) {
        clearInterval(timer);
        if (site === "claude.ai") a.setAttribute("data-is-streaming", "false");
        generating = false;
        stopBtn.replaceWith(sendBtn);
        refresh();
      }
    }, 110);
  }

  // ---- the scripted bot -------------------------------------------------------------------
  const mem = (window.__fake = { received: [], turns: 0, quirks: { malformed: NAME === "Gemini", mixedSay: NAME === "Claude", prose: NAME === "ChatGPT" } });
  const pip = (calls) => "```pip\n" + JSON.stringify({ calls }) + "\n```";
  const next = { Gemini: "ChatGPT", ChatGPT: "Claude", Claude: "Gemini" }[NAME];
  let n = 0;
  const uid = () => `${NAME.toLowerCase()}-${Date.now().toString(36)}-${++n}`;

  function bot(msg) {
    if (msg.startsWith("[pip room")) return roomTurn(msg);
    if (msg.startsWith("[pip results")) {
      const r = /\[pip results[^\]]*\]\n(.*)\n/.exec(msg);
      const bad = r ? (r[1].match(/"ok":false/g) || []).length : 0;
      return `Thanks. ${bad ? `${bad} call(s) failed; noted.` : "All saved."}\n` + pip([{ tool: "room_say", args: { text: `${NAME} turn done (${bad ? bad + " failed" : "all ok"}). @${next} can you check what I added and take it further?` } }]);
    }
    if (msg.startsWith("[pip] I couldn't run")) return "Sorry, fixed:\n" + pip([{ tool: "brain_note", args: { kind: "note", text: `${NAME} resent a broken block` } }]);
    if (msg.startsWith("[pip] Your turn isn't finished")) return pip([{ tool: "room_say", args: { text: `${NAME}: nothing to add this time. @${next} over to you.` } }]);
    return `Hi, I'm a fake ${NAME}.`;
  }

  function roomTurn(msg) {
    mem.turns++;
    const phase = (/phase ([A-Z]+)\]/.exec(msg) || [])[1] || "SCOPE";
    const unchecked = ((/Unchecked by anyone[^:]*: ([o\d, ]+)/.exec(msg) || [])[1] || "").split(/[ ,]+/).filter(Boolean);
    const latest = [...((/Latest observations: (.*)/.exec(msg) || [])[1] || "").matchAll(/\b(o\d+)\b/g)].map((m) => m[1]);
    const hyps = [...((/Hypotheses: (.*)/.exec(msg) || [])[1] || "").matchAll(/\b(h\d+) \[/g)].map((m) => m[1]);
    const finds = [...((/Findings: (.*)/.exec(msg) || [])[1] || "").matchAll(/\b(f\d+) /g)].map((m) => m[1]);
    const tasks = [...((/Your open tasks: (.*)/.exec(msg) || [])[1] || "").matchAll(/\b(t\d+)\b/g)].map((m) => m[1]);
    const calls = tasks.slice(0, 2).map((t) => ({ tool: "task_done", args: { task_id: t, result: "handled" } }));

    if (NAME === "Gemini") {
      if (phase === "SCOPE") calls.push({ tool: "brain_note", args: { kind: "plan", text: "Question: what drives the effect? Evidence: dated news and data. Answer: ranked causes." } });
      for (let i = 0; i < 2; i++) { const id = uid(); calls.push({ tool: "brain_observe", args: { claim: `Report ${id} shows drains overflowed after heavy rain`, source: { url: `https://news-${id}.example.org/story`, title: `Story ${id}`, published: "2026-09-01" }, quote: "drains overflowed within an hour", date: "2026-09-01", confidence: "medium" } }); }
      if (mem.quirks.malformed) { mem.quirks.malformed = false; return "Here is what I found.\n```pip\n{\"calls\": [{\"tool\": \"brain_observe\", \"args\": {claim: oops}}]}\n```"; }
    } else if (NAME === "ChatGPT") {
      for (const o of unchecked.slice(0, 2)) calls.push({ tool: "brain_check", args: { observation_id: o, verdict: "confirmed", note: "dates match" } });
      calls.push({ tool: "brain_note", args: { kind: "analysis", text: `Across ${latest.length} recent observations the rate is ${latest.length * 12}% (computed).` } });
      if (hyps.length) calls.push({ tool: "brain_stance", args: { hypothesis_id: hyps.at(-1), stance: "agree", reason: `${latest.slice(-2).join(" and ") || "the data"} support it`, evidence: latest.slice(-2) } });
      for (const f of finds) calls.push({ tool: "brain_endorse", args: { finding_id: f } });
      // writes the block as plain prose with curly quotes, like a chat UI that "smartens" text
      if (mem.quirks.prose) { mem.quirks.prose = false; return "I checked the numbers. " + ("{\"calls\": " + JSON.stringify(calls) + "}").replace(/"/g, String.fromCharCode(0x201d)); }
    } else {
      for (const o of unchecked.slice(0, 2)) calls.push({ tool: "brain_check", args: { observation_id: o, verdict: "confirmed" } });
      if (latest.length >= 2 && (!hyps.length || phase === "HYPOTHESISE")) calls.push({ tool: "brain_hypothesis", args: { claim: `Drain capacity, not rainfall alone, explains the overflow (${uid()})`, evidence_for: latest.slice(-3) } });
      if (hyps.length && (phase === "CHALLENGE" || phase === "CONCLUDE")) calls.push({ tool: "brain_finding", args: { title: "Drain capacity is the bottleneck", text: "Multiple independent reports show overflow within an hour of heavy rain.", hypotheses: hyps.slice(-1), confidence: "medium", actions: ["Desilt main drains before monsoon", "Add pump capacity"] } });
      for (const f of finds) calls.push({ tool: "brain_endorse", args: { finding_id: f } });
      if (mem.quirks.mixedSay) { mem.quirks.mixedSay = false; calls.push({ tool: "room_say", args: { text: "too early" } }); }
    }
    if (!calls.length) calls.push({ tool: "brain_note", args: { kind: "note", text: `${NAME} had nothing new in ${phase}` } });
    return `${NAME} here, phase ${phase}. Recording my work.\n` + pip(calls);
  }
})();
