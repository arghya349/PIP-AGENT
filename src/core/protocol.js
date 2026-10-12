// pip/1: how a chatbot asks Pip to run tools.
//
// The chatbot ends a reply with a fenced code block, language "pip", holding
//   {"calls": [{"tool": "brain_note", "args": {"kind": "plan", "text": "..."}}]}
// The content script sends us the reply's text and the text of each rendered
// code block; parseReply() finds every {"calls": ...} object in them and
// returns the calls, what went wrong, and the reply's prose without the JSON.
export const PROTOCOL = "pip/1";
export const MAX_CALLS = 12;

// Every balanced {...} starting at a {"calls" key. `complete: false` when the
// text ends before the closing brace (a half-rendered or cut-off block).
export function findCallObjects(text) {
  const out = [];
  const re = /\{\s*["\u201c\u201d]calls["\u201c\u201d]\s*:/g;
  let m;
  while ((m = re.exec(text))) {
    const start = m.index;
    // a string opened with a straight quote only closes on one, so curly
    // quotes inside text ("the mayor said “no”") don't end it early
    let depth = 0, inStr = null, esc = false, end = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (inStr === '"' ? ch === '"' : ch === "\u201d" || ch === "\u201c") inStr = null;
        continue;
      }
      if (ch === '"') inStr = '"';
      else if (ch === "\u201c" || ch === "\u201d") inStr = "\u201c";
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) { end = i + 1; break; }
    }
    if (end < 0) { out.push({ raw: text.slice(start), start, end: text.length, complete: false }); break; }
    out.push({ raw: text.slice(start, end), start, end, complete: true });
    re.lastIndex = end;
  }
  return out;
}

// JSON.parse, then a few forgiving repairs for what chat UIs do to JSON
export function lenientParse(raw) {
  const space = (s) => s.replace(/[\u00a0\u200b\u2028\u2029]/g, " ");
  const commas = (s) => s.replace(/,\s*([}\]])/g, "$1");
  const quotes = (s) => s.replace(/[\u201c\u201d\u201e\u201f]/g, '"').replace(/[\u2018\u2019]/g, "'");
  // raw line breaks and tabs inside strings (a chatbot writing multi-line text)
  const ctrl = (s) => {
    let out = "", inStr = false, esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        else if (ch === "\n") { out += "\\n"; continue; }
        else if (ch === "\r") continue;
        else if (ch === "\t") { out += "\\t"; continue; }
      } else if (ch === '"') inStr = true;
      out += ch;
    }
    return out;
  };
  // gentlest first: curly quotes are only straightened when nothing else works,
  // because inside a string they're usually meant
  const tries = [[], [space], [ctrl], [commas], [space, ctrl, commas], [quotes], [space, ctrl, commas, quotes]];
  let firstErr = null;
  for (const fixes of tries) {
    try { return { value: JSON.parse(fixes.reduce((s, f) => f(s), raw)) }; } catch (e) { firstErr ||= e; }
  }
  return { error: firstErr?.message || "invalid JSON" };
}

function normaliseCalls(value) {
  const errors = [];
  if (!value || typeof value !== "object" || !Array.isArray(value.calls)) return { calls: [], errors: ['the block must be {"calls": [ ... ]}'] };
  const calls = [];
  value.calls.forEach((c, i) => {
    if (!c || typeof c !== "object" || typeof c.tool !== "string" || !c.tool.trim()) { errors.push(`call ${i + 1} has no "tool" name`); return; }
    const args = c.args == null ? {} : c.args;
    if (typeof args !== "object" || Array.isArray(args)) { errors.push(`call ${i + 1} (${c.tool}): "args" must be an object`); return; }
    calls.push({ tool: c.tool.trim().slice(0, 60), args });
  });
  return { calls, errors };
}

// lines chat UIs add around code blocks
const CHROME_LINE = /^\s*(pip|json|copy|copy code|code|edit|run|thought for .*|thinking.*|searching the web.*|show thinking|analysis|analyzed)\s*$/i;

/**
 * @param {{text?: string, blocks?: string[]}} reply
 * @returns {{found: boolean, calls: {tool:string,args:object}[], errors: string[], incomplete: boolean, prose: string}}
 *   found: the reply had at least one {"calls" object (valid or not)
 *   incomplete: a block was cut off before its closing brace
 */
export function parseReply({ text = "", blocks = [] } = {}) {
  text = String(text || "");
  const sources = (blocks || []).map(String).filter((b) => /["\u201c]calls["\u201d]/.test(b));
  // rendered code blocks are the most faithful copy; the reply text is the fallback
  const objs = [];
  for (const b of sources) objs.push(...findCallObjects(b));
  if (!objs.length) objs.push(...findCallObjects(text));

  const calls = [], errors = [];
  let incomplete = false, seen = new Set();
  for (const o of objs) {
    if (!o.complete) { incomplete = true; errors.push("a pip block was cut off before its closing brace"); continue; }
    const key = o.raw.replace(/\s+/g, "");
    if (seen.has(key)) continue; // the same block found twice
    seen.add(key);
    const p = lenientParse(o.raw);
    if (p.error) { errors.push(`a pip block isn't valid JSON (${p.error})`); continue; }
    const n = normaliseCalls(p.value);
    calls.push(...n.calls);
    errors.push(...n.errors);
  }
  if (calls.length > MAX_CALLS) errors.push(`only the first ${MAX_CALLS} calls ran (${calls.length} sent)`);

  return { found: objs.length > 0, calls: calls.slice(0, MAX_CALLS), errors, incomplete, prose: proseOf(text, blocks) };
}

// the reply without its JSON and the UI's code-block chrome
export function proseOf(text, blocks = []) {
  let t = String(text || "");
  for (const b of blocks || []) if (b && /calls/.test(b)) t = t.split(b.trim()).join("");
  const objs = findCallObjects(t);
  for (let i = objs.length - 1; i >= 0; i--) t = t.slice(0, objs[i].start) + t.slice(objs[i].end);
  return t.split("\n").filter((l) => !CHROME_LINE.test(l)).join("\n").replace(/```[a-z]*\s*```/gi, "").replace(/\n{3,}/g, "\n\n").trim();
}

// results go back as compact JSON; long values are trimmed so the message fits a chat box
export function formatResults(results, { max = 7000 } = {}) {
  const shrink = (v, depth = 0) => {
    if (Array.isArray(v)) {
      const cut = v.slice(0, 25).map((x) => shrink(x, depth + 1));
      if (v.length > 25) cut.push(`… ${v.length - 25} more`);
      return cut;
    }
    if (v && typeof v === "object") {
      if (depth > 6) return "…";
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shrink(x, depth + 1)]));
    }
    if (typeof v === "string" && v.length > 600) return v.slice(0, 600) + "…";
    return v;
  };
  let json = JSON.stringify(shrink(results));
  if (json.length > max) json = json.slice(0, max) + " …(cut)";
  return json;
}
