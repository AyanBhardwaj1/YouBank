/**
 * Summarize a labelled B0 audit worksheet (scripts/audit-answers.mts): the natural error rate of figures,
 * the error mix with 95% intervals, and how the figure check's status lined up with the person's labels.
 *   pnpm exec tsx scripts/audit-summary.mts scripts/fixtures/eval-agent/audit/<stamp>.csv
 * B0 sets the base rate and the mix only. K2's thresholds were fixed beforehand and are tested on fresh answers.
 */
import { readFileSync } from "node:fs";
import { wilson } from "../src/lib/ai/evals/score";

const file = process.argv[2];
if (!file) throw new Error("usage: audit-summary.mts <labelled.csv>");
// A minimal CSV reader for the worksheet's own quoting (every field quoted, "" for a quote).
const parse = (line: string) => [...line.matchAll(/"((?:[^"]|"")*)"/g)].map((m) => m[1].replace(/""/g, '"'));
const [head, ...lines] = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const cols = head.split(",");
const rows = lines.map(parse).map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? ""])) as Record<string, string>);
const labelled = rows.filter((r) => /^[yn]/i.test(r.correct));
const wrong = labelled.filter((r) => /^n/i.test(r.correct));
const pct = (x: { p: number; lo: number; hi: number }) => `${(x.p * 100).toFixed(1)}% (95% CI ${(x.lo * 100).toFixed(1)}–${(x.hi * 100).toFixed(1)})`;
console.log(`${labelled.length} of ${rows.length} figures labelled, across ${new Set(rows.map((r) => r.answer_id)).size} answers`);
console.log(`Natural error rate: ${pct(wilson(wrong.length, labelled.length))}`);
console.log("\nError mix:");
for (const [t, n] of Object.entries(Object.groupBy(wrong, (r) => r.error_type || "unlabelled")).map(([t, v]) => [t, v?.length ?? 0] as const).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(14)} ${n}  ${pct(wilson(n, wrong.length))} of errors`);
}
console.log("\nOrigin of wrong figures:");
for (const [o, v] of Object.entries(Object.groupBy(wrong, (r) => r.origin || "unlabelled"))) console.log(`  ${o.padEnd(14)} ${v?.length ?? 0}`);
console.log("\nFigure check against the labels:");
const flagged = labelled.filter((r) => r.matcher_status === "no_match");
const checkedWrong = wrong.filter((r) => ["matched", "computed", "no_match"].includes(r.matcher_status));
console.log(`  "not found in the cited source" flags that were real errors: ${pct(wilson(flagged.filter((r) => /^n/i.test(r.correct)).length, flagged.length))} (n=${flagged.length})`);
console.log(`  wrong figures from data that the check flagged: ${pct(wilson(checkedWrong.filter((r) => r.matcher_status === "no_match").length, checkedWrong.length))} (n=${checkedWrong.length})`);
console.log(`  wrong figures it could not check (text only or uncited): ${wrong.length - checkedWrong.length}`);
