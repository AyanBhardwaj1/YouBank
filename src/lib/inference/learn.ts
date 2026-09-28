/**
 * Small supervised models: logistic regression (batch, by gradient descent with L2), Platt scaling and
 * the Brier score for calibration, and a Beta-Binomial rate with a credible interval. Used for reply
 * likelihood in the email agent and anywhere a calibrated probability beats a heuristic score.
 */
import { quantile } from "./stats";

const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

export type Logistic = { weights: number[]; bias: number; means: number[]; sds: number[]; n: number };

/** Fit y in {0,1} on standardized features; L2 keeps small samples sane. */
export function fitLogistic(X: number[][], y: number[], opts: { l2?: number; epochs?: number; lr?: number } = {}): Logistic {
  const n = X.length, k = X[0]?.length ?? 0;
  const means = Array.from({ length: k }, (_, j) => X.reduce((a, r) => a + r[j], 0) / Math.max(1, n));
  const sds = Array.from({ length: k }, (_, j) => Math.sqrt(X.reduce((a, r) => a + (r[j] - means[j]) ** 2, 0) / Math.max(1, n - 1)) || 1);
  const Z = X.map((r) => r.map((v, j) => (v - means[j]) / sds[j]));
  const w = Array(k).fill(0);
  const base = y.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let b = Math.log(Math.max(1e-3, base) / Math.max(1e-3, 1 - base));
  const l2 = opts.l2 ?? 1, lr = opts.lr ?? 0.1, epochs = opts.epochs ?? 300;
  for (let e = 0; e < epochs; e++) {
    const gw = Array(k).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const err = sigmoid(b + Z[i].reduce((a, v, j) => a + v * w[j], 0)) - y[i];
      gb += err;
      for (let j = 0; j < k; j++) gw[j] += err * Z[i][j];
    }
    b -= (lr * gb) / Math.max(1, n);
    for (let j = 0; j < k; j++) w[j] -= lr * ((gw[j] + l2 * w[j]) / Math.max(1, n));
  }
  return { weights: w, bias: b, means, sds, n };
}

export function predictLogistic(m: Logistic, x: number[]): number {
  return sigmoid(m.bias + x.reduce((a, v, j) => a + ((v - m.means[j]) / m.sds[j]) * m.weights[j], 0));
}

/** Platt scaling: p' = sigmoid(a * logit(p) + b), fitted on held-out predictions. */
export function fitPlatt(p: number[], y: number[]): (p: number) => number {
  const logit = (q: number) => Math.log(Math.min(1 - 1e-6, Math.max(1e-6, q)) / (1 - Math.min(1 - 1e-6, Math.max(1e-6, q))));
  const m = fitLogistic(p.map((q) => [logit(q)]), y, { l2: 0.01, epochs: 500 });
  return (q: number) => predictLogistic(m, [logit(q)]);
}

/** Brier score: mean squared error of probabilities (0 is perfect; 0.25 is a coin flip). */
export const brier = (p: number[], y: number[]) => p.reduce((a, q, i) => a + (q - y[i]) ** 2, 0) / Math.max(1, p.length);

/** Reliability table: predicted vs observed rates in probability bins. */
export function reliability(p: number[], y: number[], bins = 5): { bin: string; predicted: number; observed: number; n: number }[] {
  const out: { bin: string; predicted: number; observed: number; n: number }[] = [];
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const idx = p.map((q, i) => (q >= lo && (q < hi || (b === bins - 1 && q <= 1)) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    out.push({ bin: `${Math.round(lo * 100)}–${Math.round(hi * 100)}%`, predicted: idx.reduce((a, i) => a + p[i], 0) / idx.length, observed: idx.reduce((a, i) => a + y[i], 0) / idx.length, n: idx.length });
  }
  return out;
}

/** A rate with a Beta(a0, b0) prior: posterior mean and a central credible interval (by sampling the Beta's normal approximation, clipped). */
export function betaRate(successes: number, trials: number, a0 = 1, b0 = 1, level = 0.8): { mean: number; lo: number; hi: number } {
  const a = a0 + successes, b = b0 + trials - successes;
  const mean = a / (a + b), v = (a * b) / ((a + b) ** 2 * (a + b + 1));
  const z = level === 0.8 ? 1.2816 : level === 0.9 ? 1.6449 : 1.96;
  return { mean, lo: Math.max(0, mean - z * Math.sqrt(v)), hi: Math.min(1, mean + z * Math.sqrt(v)) };
}

export { quantile };
