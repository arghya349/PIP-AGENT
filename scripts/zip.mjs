// Packs the extension (manifest, icons, src) into dist/pip-ai-room-<version>.zip
import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
const out = path.join(root, "dist", `pip-ai-room-${version}.zip`);
mkdirSync(path.dirname(out), { recursive: true });
rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "manifest.json", "icons", "src", "-x", "*.DS_Store"], { cwd: root, stdio: "inherit" });
console.log("✓ " + path.relative(root, out));
