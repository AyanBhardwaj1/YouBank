/**
 * The first-load JavaScript budget: fails (exit 1) when a route's first-load JS, gzip, grows past its
 * limit in scripts/perf/budget.json. Run it after `pnpm build`:
 *
 *   pnpm perf:budget            (or: node scripts/perf/budget.mjs [--dir .next])
 *
 * Limits are per route, with "*" as the default for routes not listed. When a change makes a route
 * legitimately bigger, raise its limit in budget.json in the same change, and say why in the commit.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { routeSizes } from "./route-js.mjs";

const i = process.argv.indexOf("--dir");
const dir = i > 0 ? process.argv[i + 1] : process.env.NEXT_DIST_DIR || ".next";
if (!existsSync(join(dir, "build-manifest.json"))) {
  console.error(`No production build in ${dir}: run \`pnpm build\` first.`);
  process.exit(2);
}
const budget = JSON.parse(readFileSync(new URL("./budget.json", import.meta.url), "utf8"));
const rows = routeSizes(dir);
let over = 0;
for (const r of rows) {
  const limit = budget.routes[r.route] ?? budget.routes["*"];
  const bad = r.kb > limit;
  if (bad) over++;
  console.log(`${bad ? "OVER" : " ok "}  ${r.route.padEnd(30)} ${String(r.kb).padStart(7)} KB / ${limit} KB`);
}
const shared = rows[0]?.sharedKb ?? 0;
if (shared > budget.shared) { over++; console.log(`OVER  shared runtime ${shared} KB / ${budget.shared} KB`); }
else console.log(` ok   shared runtime ${shared} KB / ${budget.shared} KB`);
if (over) { console.error(`\n${over} over budget (first-load JS, gzip). Make it smaller, load it lazily, or raise the limit in scripts/perf/budget.json with a reason.`); process.exit(1); }
console.log(`\nAll ${rows.length} routes within budget.`);
