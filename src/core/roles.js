// Who is in the room. Each chatbot site gets one seat with a fixed role; the
// conductor and the prompts read everything about seats from here.
export const SEATS = [
  {
    name: "Gemini",
    site: "gemini.google.com",
    home: "https://gemini.google.com/app",
    role: "Scout",
    lane: "Find evidence in the world: Google Search and News, primary sources, data. Record each piece with brain_observe (a one-sentence claim, a short verbatim quote, the real source). Prefer dated, specific, checkable sources.",
  },
  {
    name: "ChatGPT",
    site: "chatgpt.com",
    home: "https://chatgpt.com/",
    role: "Analyst",
    lane: "Numbers and method: quantify what the evidence says, use your code tool for any calculation, compare alternatives, write the analysis with brain_note (kind analysis) and back hypotheses with numbers via brain_stance. Never guess a number you can compute.",
  },
  {
    name: "Claude",
    site: "claude.ai",
    home: "https://claude.ai/new",
    role: "Reviewer",
    lane: "Reasoning and evidence quality: open other agents' sources and brain_check them, propose hypotheses (brain_hypothesis), challenge weak ones, resolve disagreements, and write findings (brain_finding) a decision-maker could act on. Keep everyone honest.",
  },
];

export const AGENTS = SEATS.map((s) => s.name);
export const seatByName = (name) => SEATS.find((s) => s.name === name) || null;
export const seatBySite = (site) => SEATS.find((s) => s.site === site) || null;
