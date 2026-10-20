/**
 * What a route's first-load JavaScript is made of, by package (or by our own folder), from the Turbopack
 * analyzer's output. Run `pnpm next experimental-analyze --output` after a build first.
 *
 *   node scripts/perf/bundle-breakdown.mjs /app/algo [--all] [--top 25]
 * --all counts the route's lazily loaded chunks too (dynamic imports), not only what the page boots with.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = process.argv[2] ?? "/app";
const all = process.argv.includes("--all");
const ti = process.argv.indexOf("--top");
const top = ti > 0 ? Number(process.argv[ti + 1]) : 25;
const dist = process.env.NEXT_DIST_DIR || ".next";

const file = join(dist, "diagnostics/analyze/data", route === "/" ? "" : route.replace(/^\//, ""), "analyze.data");
const buf = readFileSync(file);
const n = buf.readUInt32BE(0);
const head = JSON.parse(buf.subarray(4, 4 + n).toString());

// The route's first-load files, from the client reference manifest (same as route-js.mjs).
const first = new Set();
{
  const build = JSON.parse(readFileSync(join(dist, "build-manifest.json"), "utf8"));
  for (const f of build.rootMainFiles) first.add(f.replace(/^static\//, ""));
  globalThis.__RSC_MANIFEST = {};
  const m = join(dist, "server/app", route === "/" ? "" : route.replace(/^\//, ""), "page_client-reference-manifest.js");
  new Function("globalThis", readFileSync(m, "utf8"))(globalThis);
  const [[, man]] = Object.entries(globalThis.__RSC_MANIFEST);
  for (const list of Object.values(man.entryJSFiles)) for (const f of list) first.add(f.replace(/^static\//, ""));
}

const fullPath = (i) => { const parts = []; let s = head.sources[i]; let guard = 0; while (s && guard++ < 200) { parts.unshift(s.path); s = s.parent_source_index === undefined || s.parent_source_index === null ? null : head.sources[s.parent_source_index]; } return parts.join(""); };
const bucket = (p) => {
  const nm = p.lastIndexOf("node_modules/");
  if (nm >= 0) { const rest = p.slice(nm + 13).split("/"); return rest[0].startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0]; }
  const src = p.indexOf("src/");
  if (src >= 0) return p.slice(src).split("/").slice(0, 3).join("/");
  return p.split("/").slice(0, 2).join("/");
};

const totals = new Map();
let sum = 0;
for (const part of head.chunk_parts) {
  const out = head.output_files[part.output_file_index].filename;
  if (!out.includes("/static/chunks/") || !out.endsWith(".js")) continue;
  const name = out.slice(out.indexOf("static/chunks/") + 7);
  if (!all && first.size && !first.has(name) && !process.env.NO_MATCH) continue;
  const b = bucket(fullPath(part.source_index));
  totals.set(b, (totals.get(b) ?? 0) + part.compressed_size);
  sum += part.compressed_size;
}
console.log(`${route}: ${(sum / 1024).toFixed(1)} KB gzip (module-level estimate, ${all ? "all chunks" : "first load"})`);
for (const [k, v] of [...totals].sort((a, b) => b[1] - a[1]).slice(0, top)) console.log(`  ${(v / 1024).toFixed(1).padStart(7)} KB  ${k}`);
