// The only file that knows each chat site's page. When a site changes its
// layout, fix the selectors here; nothing else needs to change.
//
//   editor  the message box (first match wins)
//   send    the send button          stop   only present while the bot is replying
//   reply   one element per bot reply (newest last)
//   user    one element per user message
//   code    rendered code blocks inside a reply
//   paste   true: put text in with a paste event first (ProseMirror boxes)
(() => {
  globalThis.PipSites = {
    "gemini.google.com": {
      name: "Gemini",
      editor: ['rich-textarea .ql-editor[contenteditable="true"]', 'div.ql-editor[contenteditable="true"]', 'div[contenteditable="true"][role="textbox"]'],
      send: ['button[aria-label*="Send" i]:not([aria-label*="Stop" i])', "button.send-button"],
      stop: ['button[aria-label*="Stop" i]'],
      reply: "model-response",
      user: "user-query",
      code: "code-block, pre",
      paste: false,
    },
    "chatgpt.com": {
      name: "ChatGPT",
      editor: ['#prompt-textarea[contenteditable="true"]', 'div.ProseMirror[contenteditable="true"]', "textarea#prompt-textarea"],
      send: ['button[data-testid="send-button"]', 'button[aria-label*="Send" i]'],
      stop: ['button[data-testid="stop-button"]', 'button[aria-label*="Stop" i]'],
      reply: '[data-message-author-role="assistant"]',
      user: '[data-message-author-role="user"]',
      code: "pre",
      paste: true,
    },
    "claude.ai": {
      name: "Claude",
      editor: ['div.ProseMirror[contenteditable="true"]', 'div[contenteditable="true"]'],
      send: ['button[aria-label="Send message"]', 'button[aria-label*="Send" i]'],
      stop: ['button[aria-label*="Stop" i]', '[data-is-streaming="true"]'],
      reply: "[data-is-streaming]",
      user: '[data-testid="user-message"]',
      code: "pre",
      paste: true,
    },
  };
})();
