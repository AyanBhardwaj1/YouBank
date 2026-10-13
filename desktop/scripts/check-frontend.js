// Syntax-checks the app's own screens (plain ES modules, no build step) and makes sure every
// command they call is one the Rust side registers and the local capability allows.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

const src = new URL("../src/", import.meta.url);
const files = readdirSync(src).filter((f) => f.endsWith(".js"));
for (const f of files) execFileSync(process.execPath, ["--check", new URL(f, src).pathname], { stdio: "inherit" });

const called = new Set();
for (const f of files) for (const m of readFileSync(new URL(f, src), "utf8").matchAll(/(?:invoke|run)\("([a-z_]+)"/g)) called.add(m[1]);
const build = readFileSync(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
const lib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const local = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/local.json", import.meta.url), "utf8")).permissions;
const missing = [...called].filter((c) => !build.includes(`"${c}"`) || !lib.includes(`commands::${c},`) || !local.includes(`allow-${c.replace(/_/g, "-")}`));
if (missing.length) {
  console.error(`Commands called by the pages but not registered and allowed: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`${files.length} scripts parse; ${called.size} commands, all registered and allowed.`);
