// A simulated room for tests: the real conductor, brain, toolbox and engine,
// with fake tabs whose "chatbots" are plain functions, and a manual clock.
import { createBrain } from "../src/core/brain.js";
import { createConductor } from "../src/core/conductor.js";
import { createEngine } from "../src/core/engine.js";
import { createToolbox } from "../src/core/tools.js";

export const pip = (...calls) => "```pip\n" + JSON.stringify({ calls: calls.map(([tool, args]) => ({ tool, args })) }) + "\n```";
export const say = (text) => pip(["room_say", { text }]);

/**
 * bots: { Gemini: (job, ctx) => replyText | null, ... } (null = never replies)
 * Each fake tab answers an "ask" with typing -> sent -> reply, like the content script.
 */
export function makeWorld({ bots = {}, connected = ["Gemini", "ChatGPT", "Claude"], timing = {}, saved = null } = {}) {
  let clock = 1_000_000;
  const now = () => clock;
  const online = new Set(connected);
  const sent = []; // every op the engine sent: {agent, msg}
  const inbox = []; // messages the tabs will deliver on the next pump
  const logs = [];
  const transport = {
    connected: (a) => online.has(a),
    send(agent, msg) {
      sent.push({ agent, msg });
      if (!online.has(agent)) return false;
      if (msg.op === "ask") {
        const bot = bots[agent];
        const job = msg.job;
        inbox.push({ agent, msg: { type: "job", id: job.id, state: "typing" } });
        inbox.push({ agent, msg: { type: "job", id: job.id, state: "sent" } });
        const text = bot ? bot(job, world) : null;
        if (text != null) inbox.push({ agent, msg: { type: "reply", id: job.id, text, blocks: blocksOf(text) } });
      }
      return true;
    },
  };
  const brain = createBrain(saved?.brain, { now });
  const conductor = createConductor(saved?.room, { brain, isLive: (n) => online.has(n), now });
  const toolbox = createToolbox();
  const engine = createEngine(saved?.engine, { conductor, brain, toolbox, transport, now, timing, log: (s) => logs.push(s) });

  // deliver queued tab messages and tick until nothing is left (bounded)
  function pump(max = 500) {
    for (let i = 0; i < max; i++) {
      engine.tick();
      if (!inbox.length) engine.tick(); // a skip or end inside tick starts the next turn on the next tick
      if (!inbox.length) return;
      const { agent, msg } = inbox.shift();
      engine.onMessage(agent, msg);
    }
    throw new Error("pump: too many steps (a loop?)");
  }
  const advance = (ms) => { clock += ms; pump(); };
  const save = () => JSON.parse(JSON.stringify({ room: conductor.toJSON(), brain: brain.toJSON(), engine: engine.toJSON() }));
  const world = { brain, conductor, engine, toolbox, transport, sent, inbox, logs, online, pump, advance, save, now, setClock: (c) => (clock = c) };
  return world;
}

// what the content script reports as "blocks": the inner text of each ``` fence
export function blocksOf(text) {
  return [...String(text).matchAll(/```[a-z]*\n([\s\S]*?)```/g)].map((m) => m[1]);
}
