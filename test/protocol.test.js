import { test } from "node:test";
import assert from "node:assert/strict";
import { parseReply, findCallObjects, lenientParse, proseOf, formatResults, MAX_CALLS } from "../src/core/protocol.js";

const block = (calls) => JSON.stringify({ calls });

test("reads calls from a rendered code block", () => {
  const b = block([{ tool: "brain_note", args: { kind: "plan", text: "x" } }]);
  const p = parseReply({ text: `I'll plan.\npip\n${b}`, blocks: [b] });
  assert.equal(p.found, true);
  assert.deepEqual(p.calls, [{ tool: "brain_note", args: { kind: "plan", text: "x" } }]);
  assert.deepEqual(p.errors, []);
  assert.equal(p.prose, "I'll plan.");
});

test("falls back to the reply text when there's no code block", () => {
  const p = parseReply({ text: `Done. {"calls": [{"tool": "room_say", "args": {"text": "hi @Claude"}}]}` });
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].args.text, "hi @Claude");
  assert.equal(p.prose, "Done.");
});

test("no block at all", () => {
  const p = parseReply({ text: "Just chatting." });
  assert.equal(p.found, false);
  assert.equal(p.calls.length, 0);
  assert.equal(p.prose, "Just chatting.");
});

test("curly quotes inside a straight-quoted string survive", () => {
  const raw = `{"calls":[{"tool":"brain_observe","args":{"claim":"the mayor said “no”","source":{"url":"https://a.b/c"}}}]}`;
  const p = parseReply({ blocks: [raw] });
  assert.equal(p.errors.length, 0);
  assert.equal(p.calls[0].args.claim, "the mayor said “no”");
});

test("a block written entirely with curly quotes is repaired", () => {
  const raw = `{“calls”: [{“tool”: “brain_note”, “args”: {“text”: “plan”}}]}`;
  const p = parseReply({ text: raw });
  assert.equal(p.errors.length, 0, p.errors.join());
  assert.equal(p.calls[0].tool, "brain_note");
});

test("trailing commas and raw newlines inside strings are repaired", () => {
  const raw = `{"calls":[{"tool":"brain_note","args":{"text":"line one\nline two",},},]}`;
  const p = parseReply({ blocks: [raw] });
  assert.deepEqual(p.errors, []);
  assert.equal(p.calls[0].args.text, "line one\nline two");
});

test("a cut-off block is reported as incomplete", () => {
  const p = parseReply({ text: `{"calls":[{"tool":"brain_note","args":{"text":"half` });
  assert.equal(p.found, true);
  assert.equal(p.incomplete, true);
  assert.equal(p.calls.length, 0);
});

test("invalid JSON is an error, not a crash", () => {
  const p = parseReply({ blocks: [`{"calls": [{"tool": brain_note}]}`] });
  assert.equal(p.found, true);
  assert.equal(p.calls.length, 0);
  assert.match(p.errors[0], /isn't valid JSON/);
});

test("several blocks run in order; the same block twice runs once", () => {
  const a = block([{ tool: "brain_note", args: { text: "a" } }]);
  const b = block([{ tool: "brain_note", args: { text: "b" } }]);
  const p = parseReply({ blocks: [a, b, a] });
  assert.deepEqual(p.calls.map((c) => c.args.text), ["a", "b"]);
});

test("blocks win over text, so the same JSON isn't read twice", () => {
  const a = block([{ tool: "brain_note", args: { text: "a" } }]);
  const p = parseReply({ text: `x ${a}`, blocks: [a] });
  assert.equal(p.calls.length, 1);
});

test("bad calls are reported, good ones kept", () => {
  const p = parseReply({ blocks: [JSON.stringify({ calls: [{ args: {} }, { tool: "x", args: [] }, { tool: "ok" }] })] });
  assert.deepEqual(p.calls, [{ tool: "ok", args: {} }]);
  assert.equal(p.errors.length, 2);
});

test("at most MAX_CALLS calls", () => {
  const calls = Array.from({ length: MAX_CALLS + 3 }, (_, i) => ({ tool: "brain_note", args: { text: String(i) } }));
  const p = parseReply({ blocks: [block(calls)] });
  assert.equal(p.calls.length, MAX_CALLS);
  assert.match(p.errors.at(-1), /only the first/);
});

test("wrong shape", () => {
  const p = parseReply({ blocks: ['{"calls": {"tool": "x"}}'] });
  assert.equal(p.calls.length, 0);
  assert.match(p.errors[0], /must be/);
});

test("braces and escaped quotes inside strings don't confuse the scanner", () => {
  const raw = JSON.stringify({ calls: [{ tool: "brain_note", args: { text: 'a } b { "c" \\ d' } }] });
  const objs = findCallObjects(`before ${raw} after`);
  assert.equal(objs.length, 1);
  assert.equal(objs[0].raw, raw);
  assert.equal(lenientParse(objs[0].raw).value.calls[0].args.text, 'a } b { "c" \\ d');
});

test("prose drops chat UI chrome lines", () => {
  assert.equal(proseOf("Hello\nCopy code\njson\nWorld"), "Hello\nWorld");
});

test("results are compact and capped", () => {
  const big = { tool: "brain_read", ok: true, result: { observations: Array.from({ length: 40 }, (_, i) => ({ id: "o" + i, claim: "x".repeat(900) })) } };
  const s = formatResults([big], { max: 5000 });
  assert.ok(s.length <= 5000 + 10);
  assert.match(s, /…/);
});
