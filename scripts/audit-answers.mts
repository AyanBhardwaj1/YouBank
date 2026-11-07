/**
 * B0, the real-answer audit: run typical questions through the chat agent once each, keep every tool
 * call's raw output, and write a worksheet with one row per figure for a person to label.
 *   pnpm exec tsx --env-file=.env.local scripts/audit-answers.mts [questions.json] [--model ID] [--limit N]
 * Writes scripts/fixtures/eval-agent/audit/<stamp>.json (answers and payloads) and <stamp>.csv (the worksheet).
 * Label columns: correct (y/n); error_type (perturbed | wrong_field | wrong_period | scale | arithmetic |
 * filing_text | other); origin (payload | calc | derivation | filing_text | unknown). Then run audit-summary.mts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { leavesOf } from "../src/lib/ai/figures";
import { runQuestion } from "../src/lib/ai/evals/run";
import type { Question } from "../src/lib/ai/evals/score";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a) => a.endsWith(".json")) ?? "scripts/fixtures/eval-agent/audit-questions.json";
const all = (JSON.parse(readFileSync(file, "utf8")) as { questions: Question[] }).questions;
const questions = all.slice(0, Number(flag("limit")) || all.length);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const csv = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""').replace(/\s+/g, " ")}"`;
const rows = [["answer_id", "question", "figure", "sentence", "cites", "matcher_status", "matched_field", "period", "cited_source_values", "correct", "error_type", "origin", "notes"].join(",")];
const answers = [];
for (const q of questions) {
  const r = await runQuestion(q, { model: flag("model") });
  answers.push({ question: q, ...r });
  const leaves = r.records.flatMap(leavesOf);
  for (const f of r.figures?.figures ?? []) {
    const start = Math.max(0, r.text.lastIndexOf(".", f.index) + 1);
    const end = r.text.indexOf(". ", f.index);
    const sentence = r.text.slice(start, end < 0 ? undefined : end + 1).trim();
    const near = leaves.filter((l) => l.unit === f.unit && l.sources.some((s) => f.cites.includes(s))).slice(0, 12).map((l) => `${l.label}=${l.value}`).join("; ");
    rows.push([q.id, q.question, f.raw, sentence, f.cites.join(" "), f.status, f.field ?? "", f.period ?? "", near, "", "", "", ""].map(csv).join(","));
  }
  console.log(`${q.id}: ${r.figures?.figures.length ?? 0} figures, ${r.errors.length ? `errors: ${r.errors.join(" | ")}` : "ok"}`);
}
const base = `scripts/fixtures/eval-agent/audit/${stamp}`;
writeFileSync(`${base}.json`, JSON.stringify({ file, model: flag("model") ?? "default", answers }, null, 2));
writeFileSync(`${base}.csv`, rows.join("\n") + "\n");
console.log(`\n${rows.length - 1} figures to label: ${base}.csv`);
process.exit(0);
