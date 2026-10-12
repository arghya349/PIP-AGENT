// The brain: one shared memory for the whole team. Each turn an agent reads a
// short digest of it and writes evidence, hypotheses, stances, findings, tasks
// and notes. Pure data + functions: the background saves toJSON() to storage.
import { AGENTS } from "./roles.js";

const STANCES = ["agree", "disagree", "unsure"];
const CONFIDENCE = ["low", "medium", "high"];
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
const clip = (s, n) => String(s ?? "").trim().slice(0, n);
const words = (s) => String(s).trim().split(/\s+/).filter(Boolean).length;

export function freshBrain() {
  return { v: 1, observations: [], hypotheses: [], findings: [], tasks: [], notes: [], seq: { o: 0, h: 0, f: 0, t: 0, n: 0 }, writes: 0 };
}

export function createBrain(saved = null, { onChange = () => {}, now = Date.now } = {}) {
  let b = load(saved);

  function load(s) {
    const f = freshBrain();
    if (!s || typeof s !== "object") return f;
    return { ...f, ...s, seq: { ...f.seq, ...(s.seq || {}) } };
  }
  function changed() { b.writes++; onChange(); }

  const author = (a) => {
    if (AGENTS.includes(a) || a === "Host") return a;
    throw new Error(`Unknown author "${a}"`);
  };
  const idList = (x) => (Array.isArray(x) ? [...new Set(x.map((s) => String(s).toLowerCase()))].slice(0, 20) : []);
  // keep only ids that exist; say which didn't
  function known(list, ids, what) {
    const ok = [], missing = [];
    for (const id of idList(ids)) (list.some((x) => x.id === id) ? ok : missing).push(id);
    return { ok, warning: missing.length ? `ignored unknown ${what} id(s): ${missing.join(", ")}` : null };
  }
  const withWarnings = (res, ...ws) => { const w = ws.filter(Boolean); return w.length ? { ...res, warning: w.join("; ") } : res; };

  function sourceOf(s) {
    const url = clip(s?.url, 600);
    if (!/^https?:\/\/[^\s/]+\.[^\s]+/i.test(url)) throw new Error("source.url must be the real http(s) link of the page you read.");
    return { title: clip(s.title, 160), url, outlet: clip(s.outlet, 60).toLowerCase() || hostOf(url), published: clip(s.published, 20) || null };
  }

  const api = {
    // one piece of evidence: a claim, a short verbatim quote and the real source
    observe(a) {
      const agent = author(a.agent);
      const claim = clip(a.claim, 400);
      if (!claim) throw new Error("claim is required: what this source shows, in one sentence.");
      const source = sourceOf(a.source);
      const quote = clip(a.quote, 400);
      if (words(quote) > 30) throw new Error("quote must be at most 30 words, verbatim from the source.");
      const dup = b.observations.find((o) => o.source.url === source.url && o.claim.toLowerCase() === claim.toLowerCase());
      if (dup) {
        if (dup.added_by !== agent && !dup.checked_by.includes(agent)) { dup.checked_by.push(agent); changed(); }
        return { id: dup.id, note: "Already recorded; counted as your confirmation." };
      }
      const o = {
        id: "o" + ++b.seq.o, claim, topic: clip(a.topic, 60) || null, date: clip(a.date, 10) || null, quote, source,
        added_by: agent, confidence: CONFIDENCE.includes(a.confidence) ? a.confidence : "medium",
        checked_by: [], disputed_by: [], check_notes: [], at: now(),
      };
      b.observations.push(o);
      changed();
      return { id: o.id };
    },
    check({ agent, observation_id, verdict, note }) {
      agent = author(agent);
      const o = b.observations.find((x) => x.id === String(observation_id).toLowerCase());
      if (!o) throw new Error(`No observation ${observation_id}.`);
      if (o.added_by === agent) throw new Error("You added this observation: another agent has to check it.");
      if (!["confirmed", "disputed"].includes(verdict)) throw new Error("verdict must be confirmed or disputed");
      o.checked_by = o.checked_by.filter((x) => x !== agent);
      o.disputed_by = o.disputed_by.filter((x) => x !== agent);
      (verdict === "disputed" ? o.disputed_by : o.checked_by).push(agent);
      if (note) { o.check_notes = (o.check_notes || []).filter((n) => n.by !== agent); o.check_notes.push({ by: agent, verdict, note: clip(note, 300) }); }
      changed();
      return { id: o.id, checked_by: o.checked_by, disputed_by: o.disputed_by };
    },
    hypothesis(a) {
      const agent = author(a.agent);
      const claim = clip(a.claim, 400);
      if (!claim) throw new Error("claim is required.");
      const dup = b.hypotheses.find((h) => h.claim.toLowerCase() === claim.toLowerCase());
      if (dup) return { id: dup.id, status: dup.status, note: "Already proposed; use brain_stance on it." };
      const ef = known(b.observations, a.evidence_for, "observation"), ea = known(b.observations, a.evidence_against, "observation");
      const h = {
        id: "h" + ++b.seq.h, claim, topic: clip(a.topic, 60) || null,
        evidence_for: ef.ok, evidence_against: ea.ok,
        status: "proposed", stances: { [agent]: { stance: "agree", reason: "proposed it" } }, created_by: agent, at: now(),
      };
      h.status = statusOf(h);
      b.hypotheses.push(h);
      changed();
      return withWarnings({ id: h.id, status: h.status }, ef.warning, ea.warning);
    },
    stance({ agent, hypothesis_id, stance, reason, evidence = [] }) {
      agent = author(agent);
      const h = b.hypotheses.find((x) => x.id === String(hypothesis_id).toLowerCase());
      if (!h) throw new Error(`No hypothesis ${hypothesis_id}.`);
      if (!STANCES.includes(stance)) throw new Error(`stance must be ${STANCES.join(", ")}`);
      if (!clip(reason, 300)) throw new Error("Give a reason (name the observation or number).");
      const ev = known(b.observations, evidence, "observation");
      h.stances[agent] = { stance, reason: clip(reason, 300) };
      const into = stance === "disagree" ? h.evidence_against : stance === "agree" ? h.evidence_for : null;
      if (into) for (const id of ev.ok) if (!into.includes(id)) into.push(id);
      h.status = statusOf(h);
      changed();
      return withWarnings({ id: h.id, status: h.status, stances: h.stances }, ev.warning);
    },
    finding(a) {
      const agent = author(a.agent);
      const hy = known(b.hypotheses, a.hypotheses, "hypothesis");
      const f = {
        id: "f" + ++b.seq.f, title: clip(a.title, 140), text: clip(a.text, 1500), hypotheses: hy.ok,
        confidence: CONFIDENCE.includes(a.confidence) ? a.confidence : "medium",
        actions: (Array.isArray(a.actions) ? a.actions : []).map((x) => clip(x, 200)).filter(Boolean).slice(0, 8), agreed_by: [agent], by: agent, at: now(),
      };
      if (!f.title || !f.text) { b.seq.f--; throw new Error("title and text are required."); }
      b.findings.push(f);
      changed();
      return withWarnings({ id: f.id, note: "Others agree with brain_endorse." }, hy.warning);
    },
    endorse({ agent, finding_id }) {
      agent = author(agent);
      const f = b.findings.find((x) => x.id === String(finding_id).toLowerCase());
      if (!f) throw new Error(`No finding ${finding_id}.`);
      if (!f.agreed_by.includes(agent)) { f.agreed_by.push(agent); changed(); }
      return { id: f.id, agreed_by: f.agreed_by };
    },
    task_create({ agent, for: to, title, auto = false }) {
      const by = author(agent);
      if (!AGENTS.includes(to)) throw new Error(`for must be one of ${AGENTS.join(", ")}`);
      const t0 = clip(title, 240);
      if (!t0) throw new Error("title is required.");
      const open = b.tasks.find((t) => t.status === "open" && t.for === to && t.title === t0);
      if (open) return { id: open.id, note: "already open" };
      const t = { id: "t" + ++b.seq.t, for: to, from: by, title: t0, status: "open", result: null, at: now(), ...(auto ? { auto: true } : {}) };
      b.tasks.push(t);
      changed();
      return { id: t.id };
    },
    task_done({ agent, task_id, result }) {
      agent = author(agent);
      const t = b.tasks.find((x) => x.id === String(task_id).toLowerCase());
      if (!t) throw new Error(`No task ${task_id}.`);
      if (t.status === "done") return { id: t.id, status: "done", note: "was already done" };
      t.status = "done"; t.result = clip(result, 400) || null; t.doneBy = agent; t.doneAt = now();
      changed();
      return { id: t.id, status: "done" };
    },
    note({ agent, text, kind = "note" }) {
      const n = { id: "n" + ++b.seq.n, kind: clip(kind, 20) || "note", by: author(agent), text: clip(text, 1200), at: now() };
      if (!n.text) { b.seq.n--; throw new Error("text is required."); }
      b.notes.push(n);
      if (b.notes.length > 300) b.notes.shift();
      changed();
      return { id: n.id };
    },
    read({ section = "digest", limit = 15 } = {}) {
      const n = Math.max(1, Math.min(50, Number(limit) || 15));
      if (["observations", "hypotheses", "findings", "tasks", "notes"].includes(section)) return { [section]: b[section].slice(-n) };
      return { digest: digest(null) };
    },
  };

  function statusOf(h) {
    const st = Object.values(h.stances).map((s) => s.stance);
    const dis = st.filter((s) => s === "disagree").length;
    if (dis >= 2) return "refuted";
    if (dis) return "challenged";
    const outlets = new Set(h.evidence_for.map((id) => b.observations.find((o) => o.id === id)?.source.outlet).filter(Boolean));
    if (st.filter((s) => s === "agree").length >= 2 && outlets.size >= 2) return "supported";
    return "proposed";
  }

  // the short summary every turn starts from
  function digest(agent) {
    const lines = [];
    lines.push(`Brain: ${b.observations.length} observations, ${b.hypotheses.length} hypotheses, ${b.findings.length} findings.`);
    if (agent) {
      const mine = b.tasks.filter((t) => t.status === "open" && t.for === agent);
      lines.push(mine.length ? `Your open tasks: ${mine.slice(0, 4).map((t) => `${t.id} (from ${t.from}) ${t.title.slice(0, 140)}`).join(" | ")}` : "Your open tasks: none.");
      const others = b.tasks.filter((t) => t.status === "open" && t.for !== agent).slice(-4);
      if (others.length) lines.push(`Others' open tasks: ${others.map((t) => `${t.id} ${t.for}: ${t.title.slice(0, 70)}`).join(" | ")}`);
    }
    const plan = [...b.notes].reverse().find((n) => n.kind === "plan");
    if (plan) lines.push(`Plan (${plan.by}): ${plan.text.slice(0, 300)}`);
    const hy = b.hypotheses.filter((h) => h.status !== "refuted").slice(-6);
    if (hy.length) lines.push("Hypotheses: " + hy.map((h) => `${h.id} [${h.status}] ${h.claim.slice(0, 90)} {${Object.entries(h.stances).map(([a, s]) => a + ":" + s.stance).join(",")}}`).join(" | "));
    const fi = b.findings.slice(-3);
    if (fi.length) lines.push("Findings: " + fi.map((f) => `${f.id} ${f.title} (agreed ${f.agreed_by.join(",")})`).join(" | "));
    const recent = b.observations.slice(-6);
    if (recent.length) lines.push("Latest observations: " + recent.map((o) => `${o.id} ${o.claim.slice(0, 80)} (${o.source.outlet}${o.date ? ", " + o.date : ""}, by ${o.added_by}${o.checked_by.length ? ", checked " + o.checked_by.join("+") : ""}${o.disputed_by.length ? ", DISPUTED" : ""})`).join(" | "));
    if (agent) {
      const unchecked = b.observations.filter((o) => !o.checked_by.length && !o.disputed_by.length && o.added_by !== agent).slice(-3);
      if (unchecked.length) lines.push(`Unchecked by anyone (open the source and brain_check): ${unchecked.map((o) => o.id).join(", ")}`);
    }
    let s = lines.join("\n");
    if (s.length > 2800) s = s.slice(0, 2800) + " …";
    return s;
  }

  function counts() {
    return {
      writes: b.writes,
      observations: b.observations.length,
      checked: b.observations.filter((o) => o.checked_by.length || o.disputed_by.length).length,
      hypotheses: b.hypotheses.length, findings: b.findings.length,
      withStances: b.hypotheses.filter((h) => Object.keys(h.stances).length >= 2).length,
      openChallenges: b.hypotheses.filter((h) => h.status === "challenged").length,
      plan: b.notes.some((n) => n.kind === "plan"),
      tasks: b.tasks.length,
    };
  }
  const openTasks = () => b.tasks.filter((t) => t.status === "open");
  function reset() { b = freshBrain(); onChange(); }
  const toJSON = () => b;
  const snapshot = () => structuredClone(b);
  return { api, digest, counts, openTasks, reset, toJSON, snapshot };
}
