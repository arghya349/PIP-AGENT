import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrain } from "../src/core/brain.js";
import { createToolbox } from "../src/core/tools.js";

const tb = createToolbox();
const src = (n) => ({ url: `https://news${n}.example.com/story`, title: "Story " + n });
const run = (brain, agent, tool, args) => tb.run({ brain, agent }, tool, args);

test("validation: required, enums, unknown tool suggestion", () => {
  assert.throws(() => tb.validate("brain_note", {}), /text is required/);
  assert.throws(() => tb.validate("brain_check", { observation_id: "o1", verdict: "maybe" }), /verdict must be one of/);
  assert.throws(() => tb.validate("brain_notes", {}), /Did you mean brain_note/);
  assert.throws(() => tb.validate("brain_note", "text"), /args must be a JSON object/);
  assert.equal(tb.validate("brain_check", { observation_id: "o1", verdict: "CONFIRMED" }).args.verdict, "confirmed");
});

test("validation: ids accept strings and arrays, drop junk", () => {
  assert.deepEqual(tb.validate("brain_hypothesis", { claim: "c", evidence_for: "o1, O2 nonsense" }).args.evidence_for, ["o1", "o2"]);
  assert.deepEqual(tb.validate("brain_hypothesis", { claim: "c", evidence_for: ["o3"] }).args.evidence_for, ["o3"]);
});

test("validation: unknown args are reported, not fatal", () => {
  const brain = createBrain();
  const r = run(brain, "Gemini", "brain_note", { text: "hi", colour: "red" });
  assert.deepEqual(r.ignored_args, ["colour"]);
});

test("the reference lists every tool with required/optional args", () => {
  const ref = tb.reference();
  assert.match(ref, /- brain_observe \{claim, source, quote\?, date\?, topic\?, confidence\?\}/);
  assert.match(ref, /- room_say \{text\}/);
});

test("observe: needs a real url, short quote; duplicates count as confirmation", () => {
  const brain = createBrain();
  assert.throws(() => run(brain, "Gemini", "brain_observe", { claim: "c", source: { url: "not a url" } }), /real http/);
  assert.throws(() => run(brain, "Gemini", "brain_observe", { claim: "c", source: src(1), quote: Array(31).fill("w").join(" ") }), /30 words/);
  assert.equal(run(brain, "Gemini", "brain_observe", { claim: "Drains failed", source: src(1) }).id, "o1");
  const dup = run(brain, "Claude", "brain_observe", { claim: "drains failed", source: src(1) });
  assert.equal(dup.id, "o1");
  assert.deepEqual(brain.snapshot().observations[0].checked_by, ["Claude"]);
  assert.equal(brain.snapshot().observations[0].source.outlet, "news1.example.com");
});

test("check: not your own; re-checking replaces your verdict", () => {
  const brain = createBrain();
  run(brain, "Gemini", "brain_observe", { claim: "c", source: src(1) });
  assert.throws(() => run(brain, "Gemini", "brain_check", { observation_id: "o1", verdict: "confirmed" }), /another agent/);
  run(brain, "Claude", "brain_check", { observation_id: "O1", verdict: "confirmed" });
  run(brain, "Claude", "brain_check", { observation_id: "o1", verdict: "disputed", note: "wrong date" });
  const o = brain.snapshot().observations[0];
  assert.deepEqual(o.checked_by, []);
  assert.deepEqual(o.disputed_by, ["Claude"]);
  assert.equal(o.check_notes[0].note, "wrong date");
});

test("hypothesis status: proposed -> supported -> challenged -> refuted", () => {
  const brain = createBrain();
  run(brain, "Gemini", "brain_observe", { claim: "a", source: src(1) });
  run(brain, "Gemini", "brain_observe", { claim: "b", source: src(2) });
  const h = run(brain, "Claude", "brain_hypothesis", { claim: "H", evidence_for: ["o1", "o9"] });
  assert.equal(h.status, "proposed");
  assert.match(h.warning, /o9/);
  assert.equal(run(brain, "ChatGPT", "brain_stance", { hypothesis_id: "h1", stance: "agree", reason: "o2 too", evidence: ["o2"] }).status, "supported");
  assert.equal(run(brain, "Gemini", "brain_stance", { hypothesis_id: "h1", stance: "disagree", reason: "o1 is old" }).status, "challenged");
  assert.equal(run(brain, "ChatGPT", "brain_stance", { hypothesis_id: "h1", stance: "disagree", reason: "changed mind" }).status, "refuted");
  assert.equal(run(brain, "Claude", "brain_hypothesis", { claim: "h" }).id, "h1", "same claim is not proposed twice");
});

test("findings, endorsements, tasks", () => {
  const brain = createBrain();
  assert.throws(() => run(brain, "Claude", "brain_finding", { title: "t" }), /text is required/);
  const f = run(brain, "Claude", "brain_finding", { title: "T", text: "X", actions: "fix drains" });
  assert.equal(f.id, "f1");
  run(brain, "Gemini", "brain_endorse", { finding_id: "f1" });
  run(brain, "Gemini", "brain_endorse", { finding_id: "f1" });
  assert.deepEqual(brain.snapshot().findings[0].agreed_by, ["Claude", "Gemini"]);
  assert.deepEqual(brain.snapshot().findings[0].actions, ["fix drains"]);
  assert.throws(() => run(brain, "Claude", "task_create", { for: "Bard", title: "x" }), /must be one of/);
  assert.equal(run(brain, "Claude", "task_create", { for: "gemini", title: "find more" }).id, "t1");
  assert.equal(run(brain, "Claude", "task_create", { for: "Gemini", title: "find more" }).note, "already open");
  run(brain, "Gemini", "task_done", { task_id: "t1", result: "o5" });
  assert.equal(brain.openTasks().length, 0);
});

test("digest is short and personal; state round-trips through JSON", () => {
  const brain = createBrain();
  for (let i = 0; i < 30; i++) run(brain, "Gemini", "brain_observe", { claim: "claim ".repeat(30) + i, source: src(i) });
  run(brain, "Claude", "task_create", { for: "ChatGPT", title: "compute it" });
  const d = brain.digest("ChatGPT");
  assert.ok(d.length <= 2810);
  assert.match(d, /Your open tasks: t1/);
  const copy = createBrain(JSON.parse(JSON.stringify(brain.toJSON())));
  assert.equal(copy.counts().observations, 30);
  assert.equal(run(copy, "Gemini", "brain_observe", { claim: "new", source: src(99) }).id, "o31");
});

test("brain_read clamps and returns sections", () => {
  const brain = createBrain();
  for (let i = 0; i < 5; i++) run(brain, "Gemini", "brain_note", { text: "n" + i });
  assert.equal(run(brain, "Claude", "brain_read", { section: "notes", limit: 2 }).notes.length, 2);
  assert.ok(run(brain, "Claude", "brain_read", {}).digest);
});
