/**
 * First-load JavaScript per route, read from a production build's output (.next): the scripts every
 * page boots with (rootMainFiles) plus the chunks its segments (layouts, page, loading and error
 * boundaries) list in the route's client reference manifest. Sizes are gzip, as sent over the wire.
 *
 *   node scripts/perf/route-js.mjs [--dir .next] [--json out.json] [--routes /app,/app/news]
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg("dir", process.env.NEXT_DIST_DIR || ".next");

const sizes = new Map();
const gz = (file) => {
  if (!sizes.has(file)) { const p = join(dir, file.replace(/^\/_next\//, "")); sizes.set(file, existsSync(p) ? gzipSync(readFileSync(p)).length : 0); }
  return sizes.get(file);
};

/** Every page's client reference manifest under server/app, keyed by its route ("/app/news"). */
function manifests(root) {
  const out = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (n === "page_client-reference-manifest.js") out.push(p);
    }
  };
  walk(root);
  return out;
}

export function routeSizes(distDir = dir) {
  const build = JSON.parse(readFileSync(join(distDir, "build-manifest.json"), "utf8"));
  const root = build.rootMainFiles ?? [];
  const rows = [];
  for (const file of manifests(join(distDir, "server", "app"))) {
    globalThis.__RSC_MANIFEST = {};
    new Function("globalThis", readFileSync(file, "utf8"))(globalThis);
    const [[key, m]] = Object.entries(globalThis.__RSC_MANIFEST);
    const route = key.replace(/\/page$/, "") || "/";
    const files = new Set(root);
    for (const list of Object.values(m.entryJSFiles ?? {})) for (const f of list) files.add(f);
    const total = [...files].reduce((s, f) => s + gz(f), 0);
    const shared = root.reduce((s, f) => s + gz(f), 0);
    rows.push({ route, kb: +(total / 1024).toFixed(1), sharedKb: +(shared / 1024).toFixed(1), chunks: files.size });
  }
  return rows.sort((a, b) => a.route.localeCompare(b.route));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = arg("routes", "")?.split(",").filter(Boolean);
  const rows = routeSizes().filter((r) => !only?.length || only.includes(r.route));
  for (const r of rows) console.log(`${r.route.padEnd(34)} ${String(r.kb).padStart(7)} KB  (${r.chunks} chunks)`);
  const out = arg("json", "");
  if (out) writeFileSync(out, JSON.stringify(rows, null, 2));
}
