# Pip AI Room

One Chrome extension. Install it and Pip, a small pink mascot, appears in **Gemini,
ChatGPT and Claude**. Connect the three and they research one question together as
a team: Gemini the **Scout**, ChatGPT the **Analyst**, Claude the **Reviewer**. They
share one memory, the **brain**: evidence, hypotheses, stances, findings and tasks.
You watch it live on one page, steer with an @mention, and export the report.

No server, no API keys: the extension drives the chat pages you're already signed in to.

## Install (unpacked, for now)

1. Open `chrome://extensions`, switch on **Developer mode** (top right).
2. **Load unpacked** → choose this folder (the one with `manifest.json`).
3. The room page opens. Pip appears in any Gemini, ChatGPT or Claude tab.

After you change the code, press the reload icon on the extension's card. Open chat
tabs pick up the new version by themselves.

## Use

1. **Sign in** to gemini.google.com, chatgpt.com and claude.ai.
2. In the room page, press **Connect all three**. Pip opens each chat in its own
   window and arranges all four windows in a grid. You can also click Pip in a chat
   and choose **Join the room**.
3. Write a **mission**, pick a length, press **Start the mission**.
4. **Keep the chat windows visible.** Gemini doesn't finish writing in a hidden tab;
   Pip warns you and brings the speaker's tab forward on its turn.
5. **Steer** from the room page or from Pip: `@Claude check o3's source first` gives
   Claude the next turn and puts your words at the top of its brief.
6. At the end, **Export report** (Markdown) or **Export data** (JSON).

A mission runs through five phases: **scope → collect → hypothesise → challenge →
conclude**. A phase ends when its goal is met, or when its share of the turns is used.

## How it works

```
 chat tabs (Pip + driver)              background service worker                room page
 ┌───────────────┐   port            ┌──────────────────────────────┐   port   ┌─────────────┐
 │ Gemini  Scout │◀── pip-agent ────▶│ engine   turn state machine  │◀────────▶│ live view   │
 │ ChatGPT Analyst│                  │ conductor phases, who's next │ pip-room │ + controls  │
 │ Claude Reviewer│                  │ brain    shared memory       │          └─────────────┘
 └───────────────┘                   │ tools    validated pip calls │
                                     └───────────────┬──────────────┘
                                                     ▼
                                          chrome.storage.local (everything)
```

One turn: the **conductor** picks the speaker (host @mention → @mention → open task →
lane order) and writes its brief. The **engine** has Pip type it into that chat and
waits for the finished reply. A ```` ```pip ```` block in the reply runs through the
**tools** into the **brain**, and the results go back to the same chatbot. A block
whose only call is `room_say` ends the turn. Details, limits and every message are
in [docs/PROTOCOL.md](docs/PROTOCOL.md).

Built to survive real life:

- **Nothing is lost when Chrome stops the background.** Room, brain and the turn in
  progress are saved after every change and reloaded on wake-up.
- **A chat tab that reloads keeps its job.** The job lives in sessionStorage.
  Replies are re-sent until the background confirms them.
- **Job ids make every message idempotent.** A late, repeated or wrong-tab reply
  changes nothing.
- **Every stage has a timeout.** A stuck chatbot is skipped. Three failures in a
  row stop the mission instead of spinning.
- **Pip never types over your draft.** It waits and tells you why.
- **Messy JSON is repaired**: curly quotes, trailing commas, line breaks, a block
  pasted as plain text. A block that can't be read is asked for again, at most twice.

## Files

| Path | What |
|---|---|
| `manifest.json` | the extension (MV3) |
| `src/background.js` | service worker: tabs, seats, windows, saving, the room page's commands |
| `src/core/` | the logic, pure JS with no browser APIs: `engine`, `conductor`, `brain`, `tools`, `protocol`, `roles`, `report` |
| `src/content/sites.js` | **the only file that knows each chat site's page**: fix selectors here when a site changes |
| `src/content/driver.js` | types into a chat, checks it sent, reads a finished reply |
| `src/content/agent.js` | the port, the job lifecycle, Pip's behaviour |
| `src/pip/` | Pip's sprite engine and speech-bubble dock |
| `src/room/` | the room page |
| `test/*.test.js` | Node tests: protocol, tools, brain, conductor, and full simulated missions |
| `test/harness/` | the real background, room page and content scripts running together on fake chat sites |

## Develop

```bash
npm test          # 54 tests, no dependencies
npm run check     # manifest files exist, every script parses, pages load only local files
npm run zip       # dist/pip-ai-room-<version>.zip
```

Full-system harness: run `python3 -m http.server 8790` in this folder and open
<http://127.0.0.1:8790/test/harness/>. The real `background.js`, room page and
content scripts run against three fake chat sites. Their scripted bots make
deliberate mistakes: a broken JSON block, curly quotes, `room_say` mixed with
other tools. Press **Connect all three**, start a mission, and watch it run.

### When a chat site changes its page

Pip stops at "can't find the message box", or replies never finish. Open the site,
inspect the message box, send button, stop button and a bot reply, and update that
site's selectors in `src/content/sites.js`. Nothing else knows about the page.

## Adding a domain (e.g. FloodSafe)

Write a tool pack in `src/core/tools.js` (`PACKS.floodsafe = {…}`), load it in
`src/background.js` (`createToolbox(["core", "floodsafe"])`), and adjust the roles'
lanes in `src/core/roles.js`. The prompt, validation and results all follow from
the definitions.

## Limits

- The chat sites' terms may not allow automated use. Use your own accounts, and
  watch what runs.
- Free plans have message limits; a long mission sends ~2–3 messages per turn.
- The bots can only cite pages they can actually open. The rules in every brief
  tell them never to invent sources, but check the evidence table before you rely
  on a finding.
