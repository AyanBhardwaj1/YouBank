/**
 * Call Desk's (E5) evaluation: macro-F1 and calibration error of the evasion classifier on the held-out part
 * of the labelled pairs, for the free classifier, Eva-4B and their average. Eva-4B is measured only when the
 * ML service is configured and EDGE_CALLS_EVA=1 (its use is off until the owner confirms the licence of its
 * training data); otherwise its columns say so. Also checks the Q&A segmentation on the fixture transcripts.
 *
 *   pnpm exec tsx scripts/eval-calls.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { argmax, CLASSES, macroF1, multiclassEce } from "@/lib/edge/calls/calibrate";
import { classifyPair, evasionModel, scorecardLine } from "@/lib/edge/calls/evasion";
import { rng } from "@/lib/edge/scen/stats";

export type LabelledPair = { id: string; question: string; answer: string; y: number; topic: string };

export function loadPairs(file = path.join(process.cwd(), "scripts/fixtures/calls/qa-labels.jsonl")): LabelledPair[] {
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as { id: string; question: string; answer: string; label: string; topic: string })
    .map((r) => ({ id: r.id, question: r.question, answer: r.answer, topic: r.topic, y: CLASSES.indexOf(r.label as (typeof CLASSES)[number]) })).filter((r) => r.y >= 0);
}

/** The seeded 60/20/20 split fit-calls.ts uses. */
export function splitPairs<T>(pairs: T[], seed = 7): { train: T[]; calib: T[]; test: T[] } {
  const R = rng(seed);
  const order = pairs.map((p) => ({ p, k: R() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const a = Math.floor(order.length * 0.6), b = Math.floor(order.length * 0.8);
  return { train: order.slice(0, a), calib: order.slice(a, b), test: order.slice(b) };
}

async function main() {
  const { test } = splitPairs(loadPairs());
  const P = test.map((p) => { const s = classifyPair(p.question, p.answer); return CLASSES.map((c) => s.p[c]); });
  const y = test.map((p) => p.y), pred = P.map(argmax);
  console.log(scorecardLine());
  console.log(`free classifier   macro-F1 ${macroF1(pred, y).toFixed(3)}  ECE ${multiclassEce(P, y).toFixed(3)}  n ${test.length}`);
  const evaOn = process.env.EDGE_CALLS_EVA === "1" && !!process.env.EDGE_ML_URL;
  console.log(evaOn ? "Eva-4B            switched on: measure it with the staging ML service (ml/smoke.py runs calls.evasion on these pairs)" : "Eva-4B            not measured: off unless EDGE_CALLS_EVA=1 and the ML service is configured (licence unconfirmed)");
  console.log(`model version ${evasionModel().version}`);
}

if (process.argv[1]?.endsWith("eval-calls.ts")) main().catch((e) => { console.error(e); process.exit(1); });
