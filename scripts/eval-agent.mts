/**
 * The finance eval harness (B1): run a frozen question set through the chat agent k times and report
 * pass@1, pass^k, the figure check's match rate and time, next to the previous run of the same set.
 *   pnpm exec tsx --env-file=.env.local scripts/eval-agent.mts <set.json> [--k 3] [--model ID] [--effort low|medium|high] [--baseline] [--limit N]
 * --baseline runs the "free EDGAR connector" comparison: filing search and text only (FILING_TEXT_ONLY).
 * Results go to scripts/fixtures/eval-agent/results/. Cost is in the usage ledger under feature "eval-agent".
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { FILING_TEXT_ONLY, runQuestion } from "../src/lib/ai/evals/run";
import { passes, stable, summarize, wilson, type Question, type RunScore } from "../src/lib/ai/evals/score";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const setPath = args.find((a) => a.endsWith(".json"));
if (!setPath) throw new Error("usage: eval-agent.mts <set.json> [--k 3] [--model ID] [--effort ...] [--baseline] [--limit N]");
const k = Math.max(1, Math.min(5, Number(flag("k")) || 3));
const model = flag("model");
const effort = flag("effort") as "low" | "medium" | "high" | undefined;
const baseline = args.includes("--baseline");
const set = JSON.parse(readFileSync(setPath, "utf8")) as { questions: Question[] };
const questions = set.questions.slice(0, Number(flag("limit")) || set.questions.length);
const label = `${setPath.split("/").pop()!.replace(/\.json$/, "")}${baseline ? "-filing-text-only" : ""}${model ? `-${model}` : ""}`;

const scores: RunScore[] = [];
const runs: unknown[] = [];
let figures = 0, matched = 0;
for (const q of questions) {
  const results: boolean[] = [];
  for (let i = 0; i < k; i++) {
    const r = await runQuestion(q, { model, effort, tools: baseline ? FILING_TEXT_ONLY : undefined });
    const p = passes(r.text, q);
    results.push(p.pass);
    if (r.figures) { figures += r.figures.checkable; matched += r.figures.matched + r.figures.computed; }
    runs.push({ id: q.id, run: i, pass: p.pass, missing: p.missing, ms: r.ms, model: r.model, errors: r.errors, figures: r.figures && { checkable: r.figures.checkable, matched: r.figures.matched, noMatch: r.figures.noMatch, textOnly: r.figures.textOnly, uncited: r.figures.uncited }, text: r.text });
  }
  scores.push({ id: q.id, runs: results });
  console.log(`${q.id.padEnd(44)} ${results.map((x) => (x ? "✓" : "✗")).join("")}`);
}
const s = summarize(scores);
const ci = wilson(Math.round(s.pass1 * s.n), s.n);
console.log(`\n${label}: n=${s.n}, k=${s.k}`);
console.log(`pass@1 ${(s.pass1 * 100).toFixed(1)}% (95% CI ${(ci.lo * 100).toFixed(1)}–${(ci.hi * 100).toFixed(1)}), pass^${s.k} ${(s.passK * 100).toFixed(1)}%, mean ${(s.mean * 100).toFixed(1)}%`);
console.log(`figures from data that match their cited source: ${matched} of ${figures}`);

const dir = "scripts/fixtures/eval-agent/results";
const previous = readdirSync(dir).filter((f) => f.startsWith(`${label}--`)).sort().pop();
if (previous) {
  const prev = JSON.parse(readFileSync(`${dir}/${previous}`, "utf8")) as { summary: { pass1: number; n: number } };
  const st = stable({ pass: s.pass1, n: s.n }, { pass: prev.summary.pass1, n: prev.summary.n });
  console.log(`vs ${previous}: pass@1 ${(prev.summary.pass1 * 100).toFixed(1)}% → ${(s.pass1 * 100).toFixed(1)}% (gap ${(st.gap * 100).toFixed(1)} pts, noise limit ${(st.limit * 100).toFixed(1)}): ${st.ok ? "within noise" : "outside noise"}`);
}
const out = `${dir}/${label}--${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(out, JSON.stringify({ set: setPath, model: model ?? "default", baseline, k, summary: s, figures: { checkable: figures, matched }, runs }, null, 2));
console.log(`results: ${out}`);
process.exit(0);
