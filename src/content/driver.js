// The driver: Pip's hands in a chat page. It types a message into the chat
// box and makes sure it really went, tells whether the bot is still replying,
// and reads a finished reply (its text and its rendered code blocks). All the
// site knowledge comes from sites.js.
(() => {
  globalThis.PipDriver = function createDriver(SITE) {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pick = (sels) => { for (const q of sels) { const el = document.querySelector(q); if (el) return el; } return null; };

    const findEditor = () => pick(SITE.editor);
    const editorText = (ed) => (ed.tagName === "TEXTAREA" ? ed.value : ed.innerText || "").trim();
    const findSend = () => pick(SITE.send);
    const isGenerating = () => !!pick(SITE.stop);
    const sendEnabled = () => { const b = findSend(); return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true"; };
    const replies = () => document.querySelectorAll(SITE.reply);
    const userCount = () => (SITE.user ? document.querySelectorAll(SITE.user).length : 0);

    // put the text in the box: the box's own input path first, so the site's editor state follows
    async function fill(ed, text) {
      const enough = () => editorText(ed).length >= Math.min(40, text.length / 2) || sendEnabled(); // a long paste may become an attachment
      if (ed.tagName === "TEXTAREA") {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(ed, text);
        ed.dispatchEvent(new Event("input", { bubbles: true }));
        return enough();
      }
      for (const how of SITE.paste ? ["paste", "insert"] : ["insert", "paste"]) {
        if (how === "paste") {
          const dt = new DataTransfer();
          dt.setData("text/plain", text);
          ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        } else document.execCommand("insertText", false, text);
        for (let i = 0; i < 8 && !enough(); i++) await sleep(100);
        if (enough()) return true;
      }
      ed.textContent = text;
      ed.dispatchEvent(new InputEvent("input", { bubbles: true }));
      await sleep(200);
      return enough();
    }

    /**
     * Type `text` and send it. Never overwrites a draft the person is typing.
     * Resolves { ok: true, baseline } (how many replies existed before), or
     * { ok: false, error, busy } (busy: try again later).
     */
    async function send(text, { waitIdleMs = 60_000 } = {}) {
      for (let t = 0; isGenerating(); t += 500) {
        if (t > waitIdleMs) return { ok: false, busy: true, error: `${SITE.name} is still writing its last reply` };
        await sleep(500);
      }
      const ed = findEditor();
      if (!ed) return { ok: false, busy: true, error: `can't find ${SITE.name}'s message box (is the page loaded and signed in?)` };
      if (editorText(ed)) return { ok: false, busy: true, error: `there's a draft in ${SITE.name}'s message box: send or clear it` };
      const baseline = replies().length;
      const users0 = userCount();
      ed.focus();
      if (!(await fill(ed, text))) return { ok: false, busy: true, error: `couldn't type into ${SITE.name}'s message box` };
      // it went if: the bot started, a new user message appeared, or the box emptied
      const went = async (ms) => {
        for (let t = 0; t < ms; t += 150) {
          await sleep(150);
          const e = findEditor();
          if (isGenerating() || userCount() > users0 || replies().length > baseline || (e && !editorText(e) && !sendEnabled())) return true;
        }
        return false;
      };
      // 1. the send button
      for (let i = 0; i < 20 && !sendEnabled(); i++) await sleep(150);
      if (sendEnabled()) { findSend().click(); if (await went(4000)) return { ok: true, baseline }; }
      // 2. Enter in the box
      const e2 = findEditor() || ed;
      e2.focus();
      e2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (await went(3000)) return { ok: true, baseline };
      // 3. the form
      const form = e2.closest("form");
      if (form) { try { form.requestSubmit(); } catch {} if (await went(3000)) return { ok: true, baseline }; }
      return { ok: false, busy: true, error: `typed the message but ${SITE.name} didn't send it (send button missing or disabled)` };
    }

    // innerText keeps line breaks; textContent works when a hidden tab hasn't laid the reply out
    const textOf = (el) => { const a = el.innerText || "", b = el.textContent || ""; return a.trim().length >= b.trim().length * 0.6 ? a : b; };

    // the code blocks in a reply, outermost only, as plain text
    function blocksOf(el) {
      const out = [], taken = [];
      for (const b of el.querySelectorAll(SITE.code)) {
        if (taken.some((t) => t.contains(b))) continue;
        taken.push(b);
        const code = b.querySelector("code") || b;
        out.push(code.textContent || "");
      }
      return out;
    }

    function read(el) { return { text: textOf(el), blocks: blocksOf(el) }; }

    return { send, read, replies, isGenerating, findEditor, editorText, textOf };
  };
})();
