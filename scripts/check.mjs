// Pre-flight for the extension: every file the manifest names exists, every
// script parses, HTML pages only load local files, and no invisible
// line-separator characters hide in the source (they break regexes in Chrome).
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rel = (p) => path.relative(root, p);
const problems = [];
const LINE_SEP = new RegExp("[" + String.fromCharCode(0x2028, 0x2029) + "]");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));

const named = [
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((c) => c.js),
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
];
for (const f of named) if (!existsSync(path.join(root, f))) problems.push(`manifest names a missing file: ${f}`);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(path.join(root, "src"));
for (const f of files.filter((f) => f.endsWith(".js"))) {
  const src = readFileSync(f, "utf8");
  if (LINE_SEP.test(src)) problems.push(`${rel(f)}: contains a raw U+2028/U+2029 character`);
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); }
  catch (e) { problems.push(`${rel(f)}: ${String(e.stderr).split("\n").slice(0, 5).join(" ")}`); }
}
for (const f of files.filter((f) => f.endsWith(".html"))) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (/^(https?:)?\/\//.test(m[1])) problems.push(`${rel(f)}: loads a remote file (${m[1]}), not allowed in an extension page`);
    else if (!existsSync(path.join(path.dirname(f), m[1]))) problems.push(`${rel(f)}: missing ${m[1]}`);
  }
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(src)) problems.push(`${rel(f)}: inline <script> is blocked by the extension CSP`);
}
// background imports resolve
for (const f of files.filter((f) => f.endsWith(".js"))) {
  for (const m of readFileSync(f, "utf8").matchAll(/^import .* from "(\.[^"]+)";$/gm)) {
    if (!existsSync(path.resolve(path.dirname(f), m[1]))) problems.push(`${rel(f)}: import not found ${m[1]}`);
  }
}

if (problems.length) { console.error("✗ " + problems.join("\n✗ ")); process.exit(1); }
console.log(`✓ manifest v${manifest.version}: ${named.length} referenced files present, ${files.length} source files parse, pages load only local files`);
