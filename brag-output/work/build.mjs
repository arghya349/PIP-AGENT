// Builds composition/index.html (SFX schedule + audio data) from template.html.
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const len = {};
const dur = (f) => (len[f] ??= Math.ceil((parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", `../composition/assets/sfx/${f}`]).toString()) + 0.02) * 100) / 100);
const C = "../composition";
const key = (i) => `keypress-0${["03", "07", "12", "18", "24", "29"][i % 6]}.wav`;
const sfx = [];
const add = (t, file, vol) => sfx.push({ t: +t.toFixed(2), file, vol });

// hook: soft key ticks while the two lines type
for (let i = 0; i < 9; i++) add(0.24 + i * 0.115, key(i), 0.22);
for (let i = 0; i < 6; i++) add(1.52 + i * 0.125, key(i + 3), 0.22);
add(3.52, "impactSoft_medium_001.ogg", 0.5);               // cut to the reveal
[5.03, 5.53, 6.03].forEach((t) => add(t, "click_003.ogg", 0.45)); // pills snap together
add(7.02, "impactSoft_medium_000.ogg", 0.32);              // cut to the room
[8.02, 8.52, 9.02].forEach((t) => add(t, "click_002.ogg", 0.42)); // seats arrive
add(9.52, "click_005.ogg", 0.6);                           // Connect all three
add(9.58, "bong_001.ogg", 0.28);                           // all green
for (let i = 0; i < 13; i++) add(10.1 + i * 0.123, key(i + 1), 0.2); // mission typing
add(12.45, "click_005.ogg", 0.6);                          // Start the mission
add(13.01, "impactSoft_medium_000.ogg", 0.32);             // mission running
[13.51, 14.52, 15.52, 16.52].forEach((t) => add(t, "click_003.ogg", 0.45)); // messages
[14.02, 15.02, 16.02, 17.02].forEach((t) => add(t, "click_002.ogg", 0.28)); // phases
add(17.52, "impactSoft_medium_001.ogg", 0.55);             // No server.
add(18.52, "impactSoft_medium_001.ogg", 0.5);              // No API keys.
add(20.02, "impactBell_heavy_000.ogg", 0.5);               // logo

const tags = sfx.map((s, i) => `  <audio id="sfx${i}" src="assets/sfx/${s.file}" data-start="${s.t}" data-duration="${dur(s.file)}" data-track-index="${10 + (i % 8)}" data-volume="${s.vol}"></audio>`).join("\n");
const html = readFileSync("template.html", "utf8").replace("<!--SFX-->", tags);
writeFileSync(`${C}/index.html`, html);

const d = JSON.parse(readFileSync("audio-data.json", "utf8"));
const bass = d.frames.map((f) => Math.round(f.bands[0] * 100) / 100);
writeFileSync(`${C}/assets/audio-data.js`, `var AUDIO_DATA = { fps: ${d.fps}, bass: ${JSON.stringify(bass)} };\n`);
console.log(`wrote index.html with ${sfx.length} sfx, ${bass.length} audio frames`);
