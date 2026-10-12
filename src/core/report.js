// The mission as a Markdown report: findings first, then the hypotheses with
// everyone's stance, the evidence with its sources, open tasks and the full
// conversation. Used by the room page's "Export" button.
const esc = (s) => String(s ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace("T", " ") : "");

export function toMarkdown(room, brain) {
  const L = [];
  L.push(`# ${room.topic || "Pip AI Room"}`, "");
  L.push(`Status: ${room.status}${room.startedAt ? ` · started ${day(room.startedAt)}` : ""}${room.endedAt ? ` · ended ${day(room.endedAt)}` : ""} · ${room.turn}/${room.maxTurns} turns · last phase ${room.phase}`, "");

  L.push("## Findings", "");
  if (!brain.findings.length) L.push("_No findings were written._", "");
  for (const f of brain.findings) {
    L.push(`### ${f.id} · ${f.title}`, "", f.text, "", `Confidence: ${f.confidence} · by ${f.by} · agreed by ${f.agreed_by.join(", ")}${f.hypotheses.length ? ` · rests on ${f.hypotheses.join(", ")}` : ""}`, "");
    if (f.actions.length) { L.push("Actions:"); for (const a of f.actions) L.push(`- ${a}`); L.push(""); }
  }

  L.push("## Hypotheses", "");
  if (!brain.hypotheses.length) L.push("_None._", "");
  for (const h of brain.hypotheses) {
    L.push(`- **${h.id}** [${h.status}] ${h.claim}`);
    for (const [a, s] of Object.entries(h.stances)) L.push(`  - ${a}: ${s.stance}: ${s.reason}`);
    if (h.evidence_for.length || h.evidence_against.length) L.push(`  - evidence for: ${h.evidence_for.join(", ") || "none"} · against: ${h.evidence_against.join(", ") || "none"}`);
  }
  L.push("");

  L.push("## Evidence", "");
  if (!brain.observations.length) L.push("_None._", "");
  else {
    L.push("| id | claim | source | by | checked |", "|---|---|---|---|---|");
    for (const o of brain.observations) {
      const check = [o.checked_by.length ? `✓ ${o.checked_by.join(", ")}` : "", o.disputed_by.length ? `✗ ${o.disputed_by.join(", ")}` : ""].filter(Boolean).join(" ") || "unchecked";
      L.push(`| ${o.id} | ${esc(o.claim)}${o.quote ? ` “${esc(o.quote)}”` : ""} | [${esc(o.source.title || o.source.outlet)}](${o.source.url})${o.source.published ? ` (${o.source.published})` : ""} | ${o.added_by} | ${check} |`);
    }
    L.push("");
  }

  const notes = brain.notes.filter((n) => n.kind !== "mission");
  if (notes.length) {
    L.push("## Notes", "");
    for (const n of notes) L.push(`- **${n.id}** (${n.kind}, ${n.by}) ${n.text}`);
    L.push("");
  }

  const open = brain.tasks.filter((t) => t.status === "open");
  if (open.length) {
    L.push("## Open tasks", "");
    for (const t of open) L.push(`- ${t.id} for ${t.for} (from ${t.from}): ${t.title}`);
    L.push("");
  }

  L.push("## Conversation", "");
  for (const m of room.messages) {
    if (m.from === "Room") L.push(`> _${m.text}_`, "");
    else L.push(`**${m.from}**${m.turn ? ` · turn ${m.turn} · ${m.phase}` : ""}`, "", m.text, "");
  }
  return L.join("\n");
}
