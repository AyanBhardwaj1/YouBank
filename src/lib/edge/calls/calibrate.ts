/**
 * Call Desk's (E5) model maths: a three-class softmax regression fitted on Edge's own labelled Q&A pairs,
 * temperature scaling, then per-class isotonic regression (one against the rest, renormalised), as the spec
 * asks; macro-F1 and a multi-class expected calibration error for the scorecard; and the call-level
 * Beta-binomial posterior with the probability that a call's evasion rate rose against the company's last
 * calls. Pure, tested in scripts/test-edge-next.ts.
 */
import { isotonicAt, isotonicFit, softmax, temperatureFit, type Isotonic } from "../calib";
import { ibeta, ibetaInv, lgamma } from "../scen/stats";

export const CLASSES = ["direct", "intermediate", "evasive"] as const;
export type EvasionClass = (typeof CLASSES)[number];

export type Softmax = { features: string[]; mean: number[]; sd: number[]; W: number[][]; b: number[]; l2: number };

/** Fit a K-class softmax regression with L2 (standardised features, full-batch gradient descent). Pure. */
export function softmaxFit(X: number[][], y: number[], features: string[], opts: { K?: number; l2?: number; iters?: number; lr?: number } = {}): Softmax {
  const K = opts.K ?? 3, l2 = opts.l2 ?? 0.01, iters = opts.iters ?? 600, lr = opts.lr ?? 0.5;
  const F = features.length, N = X.length;
  const mean = Array.from({ length: F }, (_, j) => X.reduce((s, r) => s + r[j], 0) / Math.max(1, N));
  const sd = Array.from({ length: F }, (_, j) => Math.sqrt(X.reduce((s, r) => s + (r[j] - mean[j]) ** 2, 0) / Math.max(1, N - 1)) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - mean[j]) / sd[j]));
  const W = Array.from({ length: K }, () => new Array<number>(F).fill(0)), b = new Array<number>(K).fill(0);
  for (let it = 0; it < iters; it++) {
    const gW = Array.from({ length: K }, () => new Array<number>(F).fill(0)), gb = new Array<number>(K).fill(0);
    for (let i = 0; i < N; i++) {
      const p = softmax(W.map((w, k) => b[k] + w.reduce((s, v, j) => s + v * Z[i][j], 0)));
      for (let k = 0; k < K; k++) { const e = p[k] - (y[i] === k ? 1 : 0); gb[k] += e; for (let j = 0; j < F; j++) gW[k][j] += e * Z[i][j]; }
    }
    for (let k = 0; k < K; k++) { b[k] -= (lr * gb[k]) / N; for (let j = 0; j < F; j++) W[k][j] -= lr * (gW[k][j] / N + l2 * W[k][j]); }
  }
  return { features, mean, sd, W, b, l2 };
}

/** Raw logits of one feature row. Pure. */
export function softmaxLogits(m: Softmax, x: number[]): number[] {
  const z = x.map((v, j) => (v - m.mean[j]) / (m.sd[j] || 1));
  return m.W.map((w, k) => m.b[k] + w.reduce((s, v, j) => s + v * (z[j] ?? 0), 0));
}

export type Calibrator = { temperature: number; isotonic: Isotonic[] | null };

/** Fit temperature on held-out logits, then one isotonic map per class on the tempered probabilities. Pure. */
export function fitCalibrator(logits: number[][], y: number[], opts: { isotonic?: boolean } = {}): Calibrator {
  const temperature = temperatureFit(logits, y);
  if (opts.isotonic === false || logits.length < 30) return { temperature, isotonic: null };
  const P = logits.map((l) => softmax(l, temperature));
  const isotonic = CLASSES.map((_, k) => isotonicFit(P.map((p) => p[k]), y.map((v) => (v === k ? 1 : 0))));
  return { temperature, isotonic };
}

/** Calibrated class probabilities: tempered softmax, then the per-class isotonic maps renormalised. Pure. */
export function calibrated(c: Calibrator, logits: number[]): number[] {
  const p = softmax(logits, c.temperature);
  if (!c.isotonic) return p;
  const q = p.map((v, k) => Math.max(1e-4, isotonicAt(c.isotonic![k], v)));
  const s = q.reduce((a, v) => a + v, 0);
  return s > 0 ? q.map((v) => v / s) : p;
}

export const argmax = (p: number[]) => p.reduce((best, v, i) => (v > p[best] ? i : best), 0);

/** Macro-averaged F1 over the classes. Pure. */
export function macroF1(pred: number[], y: number[], K = 3): number {
  let sum = 0;
  for (let k = 0; k < K; k++) {
    const tp = pred.filter((p, i) => p === k && y[i] === k).length, fp = pred.filter((p, i) => p === k && y[i] !== k).length, fn = pred.filter((p, i) => p !== k && y[i] === k).length;
    sum += tp ? (2 * tp) / (2 * tp + fp + fn) : 0;
  }
  return sum / K;
}

/** Expected calibration error of the top-class probability (10 bins). Pure. */
export function multiclassEce(P: number[][], y: number[], bins = 10): number {
  const conf = P.map((p) => Math.max(...p)), hit = P.map((p, i) => (argmax(p) === y[i] ? 1 : 0));
  let e = 0;
  for (let b = 0; b < bins; b++) {
    const idx = conf.map((c, i) => (c >= b / bins && (c < (b + 1) / bins || (b === bins - 1 && c <= 1)) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    const mc = idx.reduce((s, i) => s + conf[i], 0) / idx.length, acc = idx.reduce((s, i) => s + hit[i], 0) / idx.length;
    e += (idx.length / P.length) * Math.abs(mc - acc);
  }
  return e;
}

/* ---------------- The call level: a Beta-binomial posterior ---------------- */

export type Beta = { a: number; b: number };
/** A weak prior on the share of fully evasive answers: Beta(1, 4), a 20% mean worth five answers. */
export const EVASION_PRIOR: Beta = { a: 1, b: 4 };

/** The posterior of a call's evasion rate from its pairs' evasive probabilities (expected count over n). Pure. */
export function ratePosterior(pEvasive: number[], prior: Beta = EVASION_PRIOR): Beta & { n: number; expected: number; mean: number; low: number; high: number } {
  const n = pEvasive.length, expected = pEvasive.reduce((s, p) => s + p, 0);
  const a = prior.a + expected, b = prior.b + n - expected;
  return { a, b, n, expected, mean: a / (a + b), low: ibetaInv(0.1, a, b), high: ibetaInv(0.9, a, b) };
}

const betaLogPdf = (x: number, a: number, b: number) => (a - 1) * Math.log(x) + (b - 1) * Math.log(1 - x) - (lgamma(a) + lgamma(b) - lgamma(a + b));

/** P(rate now > rate before) for two Beta posteriors, by quadrature of f_now · F_before. Pure. */
export function probRose(now: Beta, before: Beta, steps = 2000): number {
  let s = 0;
  for (let i = 0; i < steps; i++) {
    const x = (i + 0.5) / steps;
    s += Math.exp(betaLogPdf(x, now.a, now.b)) * ibeta(x, before.a, before.b);
  }
  return Math.max(0, Math.min(1, s / steps));
}

/** The pooled posterior of earlier calls (each an expected evasive count over its pairs). Pure. */
export function pooled(calls: { expected: number; n: number }[], prior: Beta = EVASION_PRIOR): Beta {
  return { a: prior.a + calls.reduce((s, c) => s + c.expected, 0), b: prior.b + calls.reduce((s, c) => s + c.n - c.expected, 0) };
}

/** The line a call's card states: only "rose" at a posterior probability of 0.9 or more. Pure. */
export function roseSentence(p: number, now: { mean: number; low: number; high: number }, before: Beta, calls: number): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const prev = before.a / (before.a + before.b);
  const base = `About ${pct(now.mean)} of answers on this call did not answer the question asked (80% interval ${pct(now.low)} to ${pct(now.high)}), against ${pct(prev)} on the company's last ${calls} call${calls === 1 ? "" : "s"}.`;
  return p >= 0.9 ? `${base} The probability that the rate rose is ${p.toFixed(2)}.` : `${base} That is not a clear rise (probability ${p.toFixed(2)}; Edge says "rose" from 0.90).`;
}
