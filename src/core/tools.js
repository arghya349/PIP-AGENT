// The tools a chatbot can call from a ```pip block. A tool is a name, a
// one-line description, typed arguments and a run(ctx, args) function. Tools
// come in packs: "core" (the shared brain) ships with v1; domain packs (e.g.
// FloodSafe) add their own later without touching anything else.
//
// Every call is validated here before it runs, and the same definitions are
// written into the turn prompt, so the chatbots never need to be taught.
import { AGENTS } from "./roles.js";

// argument specs
const str = (desc, o = {}) => ({ type: "string", desc, max: 600, ...o });
const num = (desc, o = {}) => ({ type: "number", desc, ...o });
const oneOf = (values, desc, o = {}) => ({ type: "enum", values, desc: desc || values.join(" | "), ...o });
const ids = (desc, o = {}) => ({ type: "ids", desc, ...o });
const list = (desc, o = {}) => ({ type: "list", desc, ...o });
const obj = (desc, shape, o = {}) => ({ type: "object", desc, shape, ...o });
const req = { required: true };

const CORE = {
  brain_read: {
    label: "read brain",
    desc: "Read the shared memory: the digest, or one section in full.",
    args: { section: oneOf(["digest", "observations", "hypotheses", "findings", "tasks", "notes"]), limit: num("how many, newest first (default 15)", { min: 1, max: 50 }) },
    run: ({ brain }, a) => brain.api.read(a),
  },
  brain_observe: {
    label: "add evidence",
    desc: "Record one piece of evidence from a real page you opened.",
    args: {
      claim: str("what the source shows, one sentence", { ...req, max: 400 }),
      source: obj("{url, title, outlet, published}: the real page", { url: str("http(s) link", req), title: str("page title"), outlet: str("publisher"), published: str("YYYY-MM-DD") }, req),
      quote: str("verbatim, at most 30 words", { max: 400 }),
      date: str("when it happened, YYYY-MM-DD", { max: 10 }),
      topic: str("short tag", { max: 60 }),
      confidence: oneOf(["low", "medium", "high"]),
    },
    run: ({ brain, agent }, a) => brain.api.observe({ ...a, agent }),
  },
  brain_check: {
    label: "check source",
    desc: "Open another agent's source and confirm or dispute it.",
    args: { observation_id: str("e.g. o3", req), verdict: oneOf(["confirmed", "disputed"], null, req), note: str("why", { max: 300 }) },
    run: ({ brain, agent }, a) => brain.api.check({ ...a, agent }),
  },
  brain_hypothesis: {
    label: "hypothesis",
    desc: "Propose an explanation the evidence might support.",
    args: { claim: str("the hypothesis", { ...req, max: 400 }), evidence_for: ids("observation ids"), evidence_against: ids("observation ids"), topic: str("short tag", { max: 60 }) },
    run: ({ brain, agent }, a) => brain.api.hypothesis({ ...a, agent }),
  },
  brain_stance: {
    label: "stance",
    desc: "Agree, disagree or say you're unsure about a hypothesis, with a reason.",
    args: { hypothesis_id: str("e.g. h2", req), stance: oneOf(["agree", "disagree", "unsure"], null, req), reason: str("name the observation or number", { ...req, max: 300 }), evidence: ids("observation ids") },
    run: ({ brain, agent }, a) => brain.api.stance({ ...a, agent }),
  },
  brain_finding: {
    label: "finding",
    desc: "Write a conclusion the team can act on.",
    args: { title: str("short title", { ...req, max: 140 }), text: str("the finding", { ...req, max: 1500 }), hypotheses: ids("hypothesis ids it rests on"), confidence: oneOf(["low", "medium", "high"]), actions: list("concrete next steps") },
    run: ({ brain, agent }, a) => brain.api.finding({ ...a, agent }),
  },
  brain_endorse: {
    label: "endorse",
    desc: "Agree with another agent's finding.",
    args: { finding_id: str("e.g. f1", req) },
    run: ({ brain, agent }, a) => brain.api.endorse({ ...a, agent }),
  },
  brain_note: {
    label: "note",
    desc: "Leave a note: a plan, an analysis, a method, a caveat.",
    args: { text: str("the note", { ...req, max: 1200 }), kind: oneOf(["plan", "analysis", "caveat", "note"]) },
    run: ({ brain, agent }, a) => brain.api.note({ ...a, agent }),
  },
  task_create: {
    label: "task",
    desc: "Ask a teammate to do something.",
    args: { for: oneOf(AGENTS, AGENTS.join(" | "), req), title: str("what to do", { ...req, max: 240 }) },
    run: ({ brain, agent }, a) => brain.api.task_create({ ...a, agent }),
  },
  task_done: {
    label: "task done",
    desc: "Close a task you did.",
    args: { task_id: str("e.g. t4", req), result: str("what came of it", { max: 400 }) },
    run: ({ brain, agent }, a) => brain.api.task_done({ ...a, agent }),
  },
  // handled by the engine (it ends the turn), never by run()
  room_say: {
    label: "end turn",
    desc: "End your turn with a message to the team. Must be the ONLY call in its block.",
    args: { text: str("under 150 words: what you did (ids), what you found, who should act next (@Gemini, @ChatGPT, @Claude)", { ...req, max: 1500 }) },
    run: null,
  },
};

export const PACKS = { core: CORE };

export function createToolbox(packNames = ["core"]) {
  const tools = {};
  for (const p of packNames) {
    if (!PACKS[p]) throw new Error(`Unknown tool pack "${p}"`);
    for (const [name, t] of Object.entries(PACKS[p])) {
      if (tools[name]) throw new Error(`Tool "${name}" is defined twice`);
      tools[name] = t;
    }
  }
  const names = Object.keys(tools);

  // a short "did you mean" for misspelt tool names
  function closest(name) {
    const n = String(name).toLowerCase();
    return names.find((x) => x === n) || names.find((x) => x.includes(n) || n.includes(x)) || null;
  }

  function validate(name, args) {
    const t = tools[name];
    if (!t) {
      const near = closest(name);
      throw new Error(`Unknown tool "${name}".${near ? ` Did you mean ${near}?` : ""} Tools: ${names.join(", ")}`);
    }
    if (args == null) args = {};
    if (typeof args !== "object" || Array.isArray(args)) throw new Error(`${name}: args must be a JSON object`);
    const unknown = Object.keys(args).filter((k) => !(k in t.args));
    const out = {};
    for (const [k, spec] of Object.entries(t.args)) out[k] = coerce(name, k, spec, args[k]);
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return { args: out, ignored: unknown };
  }

  function coerce(tool, key, spec, v) {
    const where = `${tool}: ${key}`;
    const empty = v == null || v === "" || (Array.isArray(v) && !v.length);
    if (empty) {
      if (spec.required) throw new Error(`${where} is required (${spec.desc})`);
      return undefined;
    }
    switch (spec.type) {
      case "string": {
        if (typeof v === "object") throw new Error(`${where} must be text`);
        const s = String(v).trim();
        if (!s && spec.required) throw new Error(`${where} is required (${spec.desc})`);
        return s.slice(0, spec.max);
      }
      case "number": {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${where} must be a number`);
        return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, n));
      }
      case "enum": {
        const s = String(v).trim();
        const hit = spec.values.find((x) => x.toLowerCase() === s.toLowerCase());
        if (!hit) throw new Error(`${where} must be one of ${spec.values.join(", ")}`);
        return hit;
      }
      case "ids": {
        const arr = Array.isArray(v) ? v : String(v).split(/[\s,]+/);
        return arr.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z]\d{1,6}$/.test(x)).slice(0, 20);
      }
      case "list": {
        const arr = Array.isArray(v) ? v : [v];
        return arr.map((x) => String(x ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 8);
      }
      case "object": {
        if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${where} must be an object: ${spec.desc}`);
        const o = {};
        for (const [k, s] of Object.entries(spec.shape)) {
          const x = coerce(tool, `${key}.${k}`, s, v[k]);
          if (x !== undefined) o[k] = x;
        }
        return o;
      }
    }
    throw new Error(`${where}: unsupported type`);
  }

  // one line per tool, for the turn prompt: "- name {a, b?}: description"
  function reference() {
    return names.map((name) => {
      const t = tools[name];
      const args = Object.entries(t.args).map(([k, s]) => k + (s.required ? "" : "?")).join(", ");
      return `- ${name} {${args}}: ${t.desc}`;
    }).join("\n");
  }

  // run one validated call; room_say is the engine's, not ours
  function run(ctx, name, rawArgs) {
    const { args, ignored } = validate(name, rawArgs);
    if (!tools[name].run) throw new Error(`${name} can't be run here`);
    const result = tools[name].run(ctx, args);
    return ignored.length ? { ...result, ignored_args: ignored } : result;
  }

  const label = (name) => tools[name]?.label || name;
  return { names, validate, reference, run, label, has: (n) => !!tools[n] };
}
