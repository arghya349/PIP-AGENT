import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrain } from "../src/core/brain.js";
import { createConductor, PHASES } from "../src/core/conductor.js";
import { toMarkdown } from "../src/core/report.js";

function setup(online = ["Gemini", "ChatGPT", "Claude"]) {
  const live = new Set(online);
  const brain = createBrain();
  const c = createConductor(null, { brain, isLive: (n) => live.has(n) });
  return { brain, c, live };
}

test("a mission needs a topic and two connected chats", () => {
  const { c } = setup(["Gemini"]);
  assert.throws(() => c.start({ topic: "" }), /topic/);
  assert.throws(() => c.start({ topic: "x" }), /Connect at least two/);
});

test("can't start twice; turns are clamped", () => {
  const { c } = setup();
  const s = c.start({ topic: "x", maxTurns: 999 });
  assert.equal(s.maxTurns, 40);
  assert.throws(() => c.start({ topic: "y" }), /already running/);
});

test("only the speaker can say; lane order without mentions", () => {
  const { c } = setup();
  c.start({ topic: "x", first: "ChatGPT" });
  assert.throws(() => c.say("Gemini", "hi"), /isn't Gemini's turn/);
  c.say("ChatGPT", "done");
  assert.equal(c.snapshot().speaker, "Claude");
  c.say("Claude", "done");
  assert.equal(c.snapshot().speaker, "Gemini");
});

test("@mention hands over and becomes a task; the answer closes it", () => {
  const { c, brain } = setup();
  c.start({ topic: "x", first: "Gemini" });
  c.say("Gemini", "Found o1. @Claude can you check o1?");
  assert.equal(c.snapshot().speaker, "Claude");
  const t = brain.openTasks()[0];
  assert.equal(t.for, "Claude");
  assert.match(t.title, /check o1/);
  c.say("Claude", "Checked.");
  assert.equal(brain.openTasks().length, 0);
});

test("ping-pong guard brings in the third agent", () => {
  const { c } = setup();
  c.start({ topic: "x", first: "Gemini" });
  c.say("Gemini", "@Claude go");
  c.say("Claude", "@Gemini go");
  c.say("Gemini", "@Claude go");
  c.say("Claude", "@Gemini go");
  assert.equal(c.snapshot().speaker, "ChatGPT");
});

test("an offline agent is never picked", () => {
  const { c, live } = setup();
  c.start({ topic: "x", first: "Gemini" });
  live.delete("ChatGPT");
  c.say("Gemini", "@ChatGPT compute this");
  assert.equal(c.snapshot().speaker, "Claude");
});

test("phases move on by exit test or by share of turns; the mission ends at maxTurns", () => {
  const { c, brain } = setup();
  c.start({ topic: "x", maxTurns: 10, first: "Gemini" });
  brain.api.note({ agent: "Gemini", kind: "plan", text: "plan" });
  c.say("Gemini", "planned");
  assert.equal(c.snapshot().phase, "collect", "scope ends when a plan exists");
  for (let i = 0; i < 9; i++) c.say(c.snapshot().speaker, "turn");
  const s = c.snapshot();
  assert.equal(s.status, "done");
  assert.equal(s.turn, 10);
  assert.equal(s.phase, PHASES.at(-1).id);
});

test("prompt budget: each message is capped, history after a long absence is trimmed, newest kept", () => {
  const { c, live } = setup();
  c.start({ topic: "x", first: "Gemini" });
  c.say("Gemini", "first");
  live.delete("Gemini"); // away for a while: ChatGPT and Claude keep talking
  for (let i = 0; i < 8; i++) c.say(c.snapshot().speaker, `message ${i} ` + "w ".repeat(600));
  live.add("Gemini");
  const p = c.promptFor("Gemini", "- tools");
  assert.match(p, /message 7/);
  assert.doesNotMatch(p, /message 0 /);
  assert.match(p, /earlier messages omitted/);
  assert.match(p, /w\s+…/);
  assert.ok(p.length < 7500, `prompt ${p.length}`);
});

test("steer needs a running mission; the report renders", () => {
  const { c, brain } = setup();
  assert.throws(() => c.steer({ text: "hi" }), /No mission/);
  c.start({ topic: "Drains | floods", first: "Gemini" });
  brain.api.observe({ agent: "Gemini", claim: "a|b", source: { url: "https://x.org/a" } });
  brain.api.finding({ agent: "Claude", title: "T", text: "X", actions: ["do"] });
  c.say("Gemini", "hello");
  const md = toMarkdown(c.snapshot(), brain.snapshot());
  assert.match(md, /^# Drains \| floods/);
  assert.match(md, /### f1 · T/);
  assert.match(md, /a\\\|b/);
  assert.match(md, /\*\*Gemini\*\* · turn 1/);
});
