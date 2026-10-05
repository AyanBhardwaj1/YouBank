/**
 * Calibration maps: turning a model's raw score into a probability that means what it says. Every
 * probability Edge states about the future (F3), every claim's support (E2) and every deal's sale odds
 * (E4) goes through one of these, fitted on held-out data:
 * - isotonic regression (pool-adjacent-violators): monotone and free of shape assumptions, the default
 *   once a few hundred labelled cases exist;
 * - Platt scaling: a logistic curve on the score, for small sets where isotonic would overfit;
 * - temperature scaling: one divisor on multi-class logits (Call Desk's three evasion classes);
 * - Venn-Abers: a lower and an upper calibrated probability for one new case, which is the interval Edge
 *   shows ("14% (11-18%)"); its width says how much the calibration set can vouch for that score;
 * - logistic regression with an L2 penalty (Newton's method), the combiner for claim support and the
 *   Palepu-style baseline and fallback for sale odds.
 * Pure, deterministic, and tested on synthetic data with known probabilities (scripts/test-edge-next.ts).
 */
import { solveSpd } from "../scen/stats";

const clamp01 = (p: number) => Math.min(1, Math.max(0, p));
const sigmoid = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

/* ---------------- Isotonic regression ---------------- */

/** A fitted isotonic map: knots (score, probability), non-decreasing in both, read by linear interpolation. */
export type Isotonic = { x: number[]; y: number[]; n: number };

type Block = { sum: number; w: number; lo: number; hi: number };

/** Pool-adjacent-violators over values already in score order: the blocks of a non-decreasing fit. Pure. */
function pav(ys: number[], ws: number[], xs: number[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < ys.length; i++) {
    blocks.push({ sum: ys[i] * ws[i], w: ws[i], lo: xs[i], hi: xs[i] });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.w <= b.sum / b.w) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, w: a.w + b.w, lo: a.lo, hi: b.hi });
    }
  }
  return blocks;
}

/** Sort cases by score (ties by label, so equal scores pool), keeping weights. */
function sorted(scores: number[], labels: number[], weights?: number[]) {
  const idx = scores.map((_, i) => i).filter((i) => Number.isFinite(scores[i]) && Number.isFinite(labels[i]));
  idx.sort((a, b) => scores[a] - scores[b] || labels[a] - labels[b]);
  return { xs: idx.map((i) => scores[i]), ys: idx.map((i) => labels[i]), ws: idx.map((i) => weights?.[i] ?? 1) };
}

/** Fit isotonic regression of labels (0 to 1) on scores. Equal scores always share a value. Pure. */
export function isotonicFit(scores: number[], labels: number[], weights?: number[]): Isotonic {
  const { xs, ys, ws } = sorted(scores, labels, weights);
  if (!xs.length) return { x: [], y: [], n: 0 };
  // Tied scores are pooled first, so the fit is a function of the score.
  const ux: number[] = [], uy: number[] = [], uw: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (ux.length && xs[i] === ux[ux.length - 1]) { const k = ux.length - 1; uy[k] = (uy[k] * uw[k] + ys[i] * ws[i]) / (uw[k] + ws[i]); uw[k] += ws[i]; }
    else { ux.push(xs[i]); uy.push(ys[i]); uw.push(ws[i]); }
  }
  const blocks = pav(uy, uw, ux);
  const x: number[] = [], y: number[] = [];
  for (const b of blocks) {
    const v = clamp01(b.sum / b.w);
    x.push(b.lo); y.push(v);
    if (b.hi !== b.lo) { x.push(b.hi); y.push(v); }
  }
  return { x, y, n: xs.length };
}

/** The isotonic map at a score: linear between knots, flat beyond the ends. Pure. */
export function isotonicAt(m: Isotonic, s: number): number {
  const { x, y } = m;
  if (!x.length) return NaN;
  if (s <= x[0]) return y[0];
  if (s >= x[x.length - 1]) return y[y.length - 1];
  let lo = 0, hi = x.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (x[mid] <= s) lo = mid; else hi = mid; }
  const t = x[hi] === x[lo] ? 0 : (s - x[lo]) / (x[hi] - x[lo]);
  return y[lo] + t * (y[hi] - y[lo]);
}

/* ---------------- Platt scaling ---------------- */

export type Platt = { a: number; b: number };

/**
 * Platt scaling: p = sigmoid(a * score + b), fitted by Newton's method with Platt's smoothed targets
 * ((positives + 1) / (positives + 2) and 1 / (negatives + 2)), which keeps a separable set from running to
 * infinite slopes. Pure.
 */
export function plattFit(scores: number[], labels: number[]): Platt {
  const n = scores.length;
  const pos = labels.filter((l) => l >= 0.5).length, neg = n - pos;
  const hiT = (pos + 1) / (pos + 2), loT = 1 / (neg + 2);
  const t = labels.map((l) => (l >= 0.5 ? hiT : loT));
  let a = 0, b = Math.log((pos + 1) / (neg + 1));
  for (let it = 0; it < 100; it++) {
    let g1 = 0, g2 = 0, h11 = 1e-12, h22 = 1e-12, h12 = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * scores[i] + b), d = p - t[i], w = p * (1 - p);
      g1 += d * scores[i]; g2 += d; h11 += w * scores[i] * scores[i]; h22 += w; h12 += w * scores[i];
    }
    const det = h11 * h22 - h12 * h12;
    if (!(Math.abs(det) > 1e-18)) break;
    const da = (h22 * g1 - h12 * g2) / det, db = (h11 * g2 - h12 * g1) / det;
    a -= da; b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-10) break;
  }
  return { a, b };
}

export const plattAt = (m: Platt, s: number) => sigmoid(m.a * s + m.b);

/* ---------------- Temperature scaling ---------------- */

/** Softmax of logits divided by a temperature. Pure. */
export function softmax(logits: number[], temperature = 1): number[] {
  const z = logits.map((v) => v / temperature), m = Math.max(...z);
  const e = z.map((v) => Math.exp(v - m)), s = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / s);
}

/** The temperature (between 0.05 and 20) that minimises the log loss of multi-class logits, by golden-section search on its log. Pure. */
export function temperatureFit(logits: number[][], labels: number[]): number {
  const nll = (T: number) => logits.reduce((s, l, i) => s - Math.log(Math.max(1e-12, softmax(l, T)[labels[i]] ?? 1e-12)), 0);
  let lo = Math.log(0.05), hi = Math.log(20);
  const g = (Math.sqrt(5) - 1) / 2;
  let c = hi - g * (hi - lo), d = lo + g * (hi - lo);
  for (let i = 0; i < 80; i++) {
    if (nll(Math.exp(c)) < nll(Math.exp(d))) hi = d; else lo = c;
    c = hi - g * (hi - lo); d = lo + g * (hi - lo);
  }
  return Math.exp((lo + hi) / 2);
}

/* ---------------- Venn-Abers ---------------- */

/** A calibration set prepared once for Venn-Abers: cases sorted by score. */
export type VennAbersSet = { xs: number[]; ys: number[] };

export function vennAbersSet(scores: number[], labels: number[]): VennAbersSet {
  const { xs, ys } = sorted(scores, labels.map((l) => (l >= 0.5 ? 1 : 0)));
  return { xs, ys };
}

/** The isotonic value at the test case after adding it to the calibration set with this label. */
function withCase(set: VennAbersSet, s: number, label: 0 | 1): number {
  // Insert in score order (ties: the new case after equal scores, then pooled with them below).
  let at = 0;
  while (at < set.xs.length && set.xs[at] <= s) at++;
  const xs = [...set.xs.slice(0, at), s, ...set.xs.slice(at)];
  const ys = [...set.ys.slice(0, at), label, ...set.ys.slice(at)];
  const m = isotonicFit(xs, ys);
  return isotonicAt(m, s);
}

/**
 * Inductive Venn-Abers (Vovk and Petej 2014): the isotonic fit with the new case labelled 0 gives p0, with
 * it labelled 1 gives p1, and the truth is guaranteed (under exchangeability) to be calibrated within
 * [p0, p1]. The point estimate is p1 / (1 - p0 + p1), which minimises log loss over the two. Pure.
 */
export function vennAbers(set: VennAbersSet, s: number): { p: number; low: number; high: number } {
  if (!set.xs.length) return { p: NaN, low: 0, high: 1 };
  const p0 = withCase(set, s, 0), p1 = withCase(set, s, 1);
  const low = Math.min(p0, p1), high = Math.max(p0, p1);
  return { p: clamp01(high / (1 - low + high)), low, high };
}

/* ---------------- Logistic regression ---------------- */

/** A fitted logistic model on standardised features: p = sigmoid(intercept + sum(w_j * (x_j - mean_j) / sd_j)). */
export type Logistic = { features: string[]; mean: number[]; sd: number[]; w: number[]; intercept: number; l2: number; n: number };

/**
 * Logistic regression by Newton's method (iteratively reweighted least squares) with an L2 penalty on the
 * weights (not the intercept), on standardised features so the penalty treats them alike. Missing values
 * (NaN) are set to the feature's mean. Pure.
 */
export function logisticFit(X: number[][], y: number[], features: string[], opts: { l2?: number; iters?: number; weights?: number[] } = {}): Logistic {
  const n = X.length, k = features.length, l2 = opts.l2 ?? 1;
  const mean = new Array(k).fill(0), sd = new Array(k).fill(1);
  for (let j = 0; j < k; j++) {
    const col = X.map((r) => r[j]).filter((v) => Number.isFinite(v));
    const m = col.length ? col.reduce((a, b) => a + b, 0) / col.length : 0;
    const v = col.length > 1 ? col.reduce((a, b) => a + (b - m) ** 2, 0) / (col.length - 1) : 0;
    mean[j] = m; sd[j] = Math.sqrt(v) > 1e-12 ? Math.sqrt(v) : 1;
  }
  const Z = X.map((r) => r.map((v, j) => (Number.isFinite(v) ? (v - mean[j]) / sd[j] : 0)));
  const sw = opts.weights ?? new Array(n).fill(1);
  const beta = new Array(k + 1).fill(0);
  const pos = y.reduce((s, v, i) => s + v * sw[i], 0), tot = sw.reduce((a, b) => a + b, 0);
  beta[0] = Math.log(Math.max(1e-6, pos) / Math.max(1e-6, tot - pos));
  for (let it = 0; it < (opts.iters ?? 50); it++) {
    const H = Array.from({ length: k + 1 }, () => new Array(k + 1).fill(0)), g = new Array(k + 1).fill(0);
    for (let i = 0; i < n; i++) {
      let z = beta[0];
      for (let j = 0; j < k; j++) z += beta[j + 1] * Z[i][j];
      const p = sigmoid(z), w = Math.max(1e-9, p * (1 - p)) * sw[i], d = (y[i] - p) * sw[i];
      g[0] += d;
      for (let a = 0; a < k; a++) g[a + 1] += d * Z[i][a];
      H[0][0] += w;
      for (let a = 0; a < k; a++) { H[0][a + 1] += w * Z[i][a]; for (let b = a; b < k; b++) H[a + 1][b + 1] += w * Z[i][a] * Z[i][b]; }
    }
    for (let a = 0; a <= k; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    for (let a = 1; a <= k; a++) { H[a][a] += l2; g[a] -= l2 * beta[a]; }
    H[0][0] += 1e-9;
    let step: number[];
    try { step = solveSpd(H, g); } catch { break; }
    let moved = 0;
    for (let a = 0; a <= k; a++) { beta[a] += step[a]; moved += Math.abs(step[a]); }
    if (moved < 1e-9) break;
  }
  return { features, mean, sd, w: beta.slice(1), intercept: beta[0], l2, n };
}

/** The model's linear score (log odds) for one row. Pure. */
export function logisticLogit(m: Logistic, x: number[]): number {
  let z = m.intercept;
  for (let j = 0; j < m.w.length; j++) z += m.w[j] * (Number.isFinite(x[j]) ? (x[j] - m.mean[j]) / m.sd[j] : 0);
  return z;
}

export const logisticAt = (m: Logistic, x: number[]) => sigmoid(logisticLogit(m, x));

/** Each feature's contribution to one row's log odds against an average row: the logistic model's own "reasons". Pure. */
export function logisticContrib(m: Logistic, x: number[]): { feature: string; contrib: number; value: number }[] {
  return m.features.map((f, j) => ({ feature: f, value: x[j], contrib: Number.isFinite(x[j]) ? (m.w[j] * (x[j] - m.mean[j])) / m.sd[j] : 0 }));
}

export { sigmoid };
