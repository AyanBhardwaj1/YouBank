/**
 * Fit Call Desk's (E5) free evasion classifier on the labelled fixture and write src/lib/edge/calls/model.json:
 * a three-class softmax regression on 60% of the pairs, temperature scaling and per-class isotonic maps on the
 * next 20%, and macro-F1 and calibration error measured on the last 20%, which neither step saw. The split is
 * seeded, so the model is reproducible.
 *
 *   pnpm exec tsx scripts/fit-calls.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { argmax, calibrated, fitCalibrator, macroF1, multiclassEce, softmaxFit, softmaxLogits } from "@/lib/edge/calls/calibrate";
import { FEATURES, pairFeatures } from "@/lib/edge/calls/evasion";
import { loadPairs, splitPairs } from "./eval-calls";

const pairs = loadPairs();
const { train, calib, test } = splitPairs(pairs);
const X = (s: typeof pairs) => s.map((p) => pairFeatures(p.question, p.answer));
const y = (s: typeof pairs) => s.map((p) => p.y);
const sm = softmaxFit(X(train), y(train), [...FEATURES], { l2: 0.02, iters: 800 });
const cal = fitCalibrator(X(calib).map((x) => softmaxLogits(sm, x)), y(calib));
const P = X(test).map((x) => calibrated(cal, softmaxLogits(sm, x)));
const pred = P.map(argmax), truth = y(test);
const metrics = { macroF1: round(macroF1(pred, truth)), ece: round(multiclassEce(P, truth)), n: test.length, accuracy: round(pred.filter((p, i) => p === truth[i]).length / test.length), heldOut: "the last 20% of the seeded split" };
const model = {
  version: `evasion-lr-${new Date().toISOString().slice(0, 10)}`, ...sm, ...cal,
  set: { name: "calls template set", version: "v1", n: pairs.length, note: "The labelled set is a template set until real filed transcripts are labelled, so these scores describe the templates, not live calls." },
  metrics,
};
writeFileSync(path.join(process.cwd(), "src/lib/edge/calls/model.json"), `${JSON.stringify(model, (_, v) => (typeof v === "number" ? round(v) : v))}\n`);
console.log("wrote src/lib/edge/calls/model.json", metrics, "temperature", round(cal.temperature));
function round(v: number) { return Math.round(v * 1e6) / 1e6; }
