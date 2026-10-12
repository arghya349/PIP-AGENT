# pip/1: the Pip language

How the chatbots ask Pip to do things, and how the extension's parts talk to
each other. Version `pip/1`. Anything not written here is not part of the protocol.

## 1. Chatbot → Pip: the pip block

A chatbot acts by ending its reply with **one fenced code block, language `pip`,
holding one line of JSON**:

````
```pip
{"calls":[{"tool":"brain_observe","args":{"claim":"…","source":{"url":"https://…"}}}]}
```
````

- `calls` is a list of up to **12** `{ "tool": name, "args": { … } }` objects, run in order.
- Every call is validated against the tool's argument spec (`src/core/tools.js`)
  before it runs. A bad call fails on its own; the others still run.
- Results come back as a message that starts with `[pip results · turn N · step K]`,
  followed by one line of JSON, `[{tool, ok, result | error}, …]`.
- **`room_say` ends the turn.** It must be the **only** call in its block. If it
  appears next to other tools, those tools run and `room_say` is held back, with an
  error telling the chatbot to send it again on its own after reading the results.

### What Pip forgives (`src/core/protocol.js`)

| The chatbot wrote | Pip does |
|---|---|
| The JSON without a code block, in the reply text | finds it anyway (`{"calls"` … balanced `}`) |
| Curly quotes (`“calls”`), trailing commas, raw line breaks inside strings | repairs and parses |
| The same block twice (rendered code + text) | runs it once |
| Several blocks in one reply | runs them in order |
| A block cut off before its closing brace | treats it as unreadable |

### When a reply can't be used (`src/core/engine.js`)

| Reply | Pip's answer | Limit |
|---|---|---|
| Unreadable block | `[pip] I couldn't run your pip block: …` (asks for it again) | 2 per turn, then the reply's prose is used as the message |
| No block at all | `[pip] Your turn isn't finished: …` | 1 per turn, then the prose is the message |
| More tool steps than allowed | warns on the last step, then ends the turn | 8 steps per turn |

## 2. Tools (core pack)

| Tool | Arguments (`?` = optional) | Does |
|---|---|---|
| `brain_read` | section?, limit? | the digest, or one section |
| `brain_observe` | claim, source{url, title?, outlet?, published?}, quote?, date?, topic?, confidence? | records evidence from a real page |
| `brain_check` | observation_id, verdict (confirmed\|disputed), note? | another agent confirms or disputes it |
| `brain_hypothesis` | claim, evidence_for?, evidence_against?, topic? | proposes an explanation |
| `brain_stance` | hypothesis_id, stance (agree\|disagree\|unsure), reason, evidence? | takes a position, with a reason |
| `brain_finding` | title, text, hypotheses?, confidence?, actions? | writes a conclusion |
| `brain_endorse` | finding_id | agrees with a finding |
| `brain_note` | text, kind? (plan\|analysis\|caveat\|note) | leaves a note |
| `task_create` | for (Gemini\|ChatGPT\|Claude), title | asks a teammate |
| `task_done` | task_id, result? | closes a task |
| `room_say` | text | ends the turn with a message to the team |

Hypothesis status is computed, never set: **refuted** (2+ disagree), **challenged**
(1 disagrees), **supported** (2+ agree and evidence from 2+ different outlets),
otherwise **proposed**.

New tools come as a **pack**: `PACKS.<name> = { tool: { label, desc, args, run(ctx, args) } }`
in `src/core/tools.js`, then `createToolbox(["core", "<name>"])` in `src/background.js`.
The prompt's tool list is generated from the same definitions.

## 3. Inside the extension

### Chat tab ⇄ background (port `pip-agent`)

Background → tab (`op`):

| op | fields | meaning |
|---|---|---|
| `ask` | job {id, kind, text} | type `text` into the chat and send the reply back. kind: prompt, results, repair, nudge |
| `ack` | id | the reply for job `id` arrived; forget it |
| `cancel` | | drop the current job |
| `join` / `seat` | seated | join the room / another tab took this seat |
| `room` | view | the room, for Pip's status bubble |
| `tools` | items | what just ran, for Pip |
| `notice` | text, err | something to tell the person |

Tab → background (`type`):

| type | fields | meaning |
|---|---|---|
| `hello` | joined, joinedAt, visible, url, job {id, state} | sent on every (re)connect |
| `beat` | visible | every 20 s; keeps the worker awake |
| `job` | id, state (typing\|sent\|failed\|progress), error?, note? | delivery progress |
| `reply` | id, text, blocks[] | the finished reply. Repeated every 8 s until `ack` |
| `join`, `leave`, `front`, `openRoom`, `steer`, `stop` | | the person's actions in Pip |

Job ids are `m<mission>.t<turn>.j<n>`. The engine applies a reply only when its id
is the current job's, and only once, so a late, repeated or misrouted reply is harmless.

### Room page ⇄ background (port `pip-room`)

The page sends `{rid, cmd, …}` and gets `{type: "res", rid, ok, result | error}`.
Commands: `start {topic, maxTurns}`, `steer {text}`, `stop`, `connectAll {area}`,
`arrange {area}`, `openSeat {name, area}`, `leaveSeat {name}`, `resetBrain`, `export`,
`logs`, `state`. The background pushes `{type: "state", room, brain, engine, seats}`
on every change.

## 4. Timeouts

| What | Limit | Then |
|---|---|---|
| Speaker's tab not connected | 45 s | skip the turn |
| Tab doesn't acknowledge a job | 15 s | offer it again |
| Typing | 60 s | offer it again |
| Delivering at all (draft in the box, page busy) | 2.5 min | skip the turn |
| Nothing comes back after sending | 75 s | the tab sends it once more |
| One reply | 6 min | skip the turn |
| One whole turn | 12 min | skip the turn |
| Three failed turns in a row | | the mission stops |
