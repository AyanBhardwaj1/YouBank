/**
 * The combiner (E2): a claim's features through a logistic regression (the raw score), then isotonic
 * regression (the support probability), both fitted on the labelled calibration set by
 * scripts/eval-claims.ts, which also picks Strict's lines at 2%, 5% and 10% and measures what they achieve
 * on the held-out half. Everything the reader is told about the verifier comes from that one JSON file
 * (model.json): its version, its calibration set and the measured rates.
 *
 * The NLI checker joins the features only in a model that was fitted with it (its `features` list names
 * "nli"). Until eval-claims has been run against the deployed `docs.verify`, the shipped model leaves it
 * out and says so, rather than weighting an untested signal. Pure.
 */
import { isotonicAt, isotonicFit, logisticAt, logisticFit, logisticLogit, type Isotonic, type Logistic } from "../calib/fit";
import { auroc, bootstrapCi, ece } from "../calib/score";
import { ALPHAS, rateAbove, strictThreshold } from "./conformal";
import type { FeatureName, Features } from "./features";

export type LineReport = { alpha: number; tau: number | null; heldOut: { n: number; unsupported: number; rate: number; ci: [number, number] | null } };

export type CombinerModel = {
  version: string;
  /** The calibration set this was fitted on, and when. */
  set: { name: string; version: string; claims: number; supported: number; fittedAt: string; note: string };
  features: FeatureName[];
  logistic: Logistic;
  isotonic: Isotonic;
  lines: LineReport[];
  quality: { auroc: number; ece: number; heldOut: number };
};

export const vector = (f: Features, names: readonly FeatureName[]) => names.map((n) => f[n]);

/** A claim's support probability under a fitted combiner. Pure. */
export function supportOf(m: CombinerModel, f: Features): number {
  const raw = logisticAt(m.logistic, vector(f, m.features));
  const p = isotonicAt(m.isotonic, raw);
  return Number.isFinite(p) ? p : raw;
}

/** The raw score (log odds) a combiner gives, for ranking. Pure. */
export const rawOf = (m: CombinerModel, f: Features) => logisticLogit(m.logistic, vector(f, m.features));

export type Labelled = { features: Features; supported: number; split: "fit" | "held" };

/**
 * Fit a combiner on the "fit" half (logistic on half of it, isotonic on the other half so the calibration
 * is not fitted on the scores it calibrates), choose Strict's lines on the fit half, and report each line's
 * unsupported rate on the held-out half with a 90% bootstrap interval. Pure.
 */
export function fitCombiner(rows: Labelled[], features: FeatureName[], set: CombinerModel["set"], version: string): CombinerModel {
  const fit = rows.filter((r) => r.split === "fit"), held = rows.filter((r) => r.split === "held");
  const a = fit.filter((_, i) => i % 2 === 0), b = fit.filter((_, i) => i % 2 === 1);
  const logistic = logisticFit(a.map((r) => vector(r.features, features)), a.map((r) => r.supported), features, { l2: 1 });
  const isotonic = isotonicFit(b.map((r) => logisticAt(logistic, vector(r.features, features))), b.map((r) => r.supported));
  const m: CombinerModel = { version, set, features, logistic, isotonic, lines: [], quality: { auroc: NaN, ece: NaN, heldOut: held.length } };
  const pFit = b.map((r) => supportOf(m, r.features)), yFit = b.map((r) => r.supported);
  const pHeld = held.map((r) => supportOf(m, r.features)), yHeld = held.map((r) => r.supported);
  m.lines = ALPHAS.map((alpha) => {
    const tau = strictThreshold(pFit, yFit, alpha);
    if (tau === null) return { alpha, tau, heldOut: { n: 0, unsupported: 0, rate: NaN, ci: null } };
    const r = rateAbove(pHeld, yHeld, tau);
    const idx = pHeld.map((_, i) => i);
    const ci = r.n >= 20 ? bootstrapCi((ii) => { const ab = ii.filter((i) => pHeld[i] >= tau); return ab.length ? ab.filter((i) => yHeld[i] < 0.5).length / ab.length : NaN; }, idx, idx, { seed: 17 }) : null;
    return { alpha, tau, heldOut: { ...r, ci } };
  });
  m.quality = { auroc: auroc(pHeld, yHeld), ece: ece(pHeld, yHeld), heldOut: held.length };
  return m;
}

/** The line for a Strict level, falling back to the strictest line that exists. Pure. */
export function lineFor(m: CombinerModel, alpha: number): LineReport | null {
  return m.lines.find((l) => l.alpha === alpha && l.tau !== null) ?? null;
}

/** The footer every Strict answer carries, from the model's own measured numbers. Pure. */
export function strictFooter(m: CombinerModel, alpha: number): string {
  const l = lineFor(m, alpha);
  const pc = (v: number) => `${(v * 100).toFixed(1)}%`;
  if (!l) return `Strict could not set a ${Math.round(alpha * 100)}% line: the calibration set (${m.set.name} ${m.set.version}) is too small for it.`;
  const h = l.heldOut;
  return `Shown claims meet a ${Math.round(alpha * 100)}% unsupported-claim target. On ${h.n} held-out claims, ${Number.isFinite(h.rate) ? pc(h.rate) : "none"}${h.ci ? ` (90% CI ${pc(h.ci[0])} to ${pc(h.ci[1])})` : ""} of claims above this line were unsupported. Calibration set ${m.set.name} ${m.set.version}, ${m.set.fittedAt.slice(0, 10)}.`;
}

/** The colour of a claim's dot: green from 0.9, amber from 0.6, red below. Pure. */
export const dotOf = (p: number): "high" | "mid" | "low" => (p >= 0.9 ? "high" : p >= 0.6 ? "mid" : "low");
