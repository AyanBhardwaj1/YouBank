/**
 * QF2: a Gaussian hidden Markov model fitted by Baum-Welch (EM) from several seeded starts, keeping the fit
 * with the highest likelihood. Pure.
 *
 * Only filtered probabilities P(state at t | data up to t) may be shown as "now" or used in a backtest:
 * smoothed ones use the future. `hmmFilter` is the only reader the regime monitor and backtests use;
 * `hmmSmooth` exists for fitting and for the tests that prove the difference.
 * States are sorted by the variance of their first feature, so state 0 is always the calmest.
 */
import { rng } from "./core";
import { cholesky, inverse, type Mat } from "./linalg";

export type Hmm = { k: number; d: number; pi: number[]; A: Mat; means: number[][]; covs: Mat[]; logLik: number; iterations: number; starts: number };

const LOG2PI = Math.log(2 * Math.PI);

function logDensity(x: number[], mu: number[], cov: Mat): number {
  const d = x.length;
  const L = cholesky(cov);
  if (!L) return -1e12;
  // Solve L z = (x - mu); log|cov| = 2 Σ log L_ii.
  const z = new Array<number>(d);
  let logDet = 0;
  for (let i = 0; i < d; i++) {
    let s = x[i] - mu[i];
    for (let j = 0; j < i; j++) s -= L[i][j] * z[j];
    z[i] = s / L[i][i];
    logDet += 2 * Math.log(L[i][i]);
  }
  return -0.5 * (d * LOG2PI + logDet + z.reduce((a, v) => a + v * v, 0));
}

function emissions(m: Pick<Hmm, "k" | "means" | "covs">, X: number[][]): number[][] {
  return X.map((x) => Array.from({ length: m.k }, (_, s) => logDensity(x, m.means[s], m.covs[s])));
}

/** Scaled forward pass: filtered state probabilities and the log-likelihood. */
function forward(m: Pick<Hmm, "k" | "pi" | "A">, logB: number[][]): { alpha: number[][]; scale: number[]; logLik: number } {
  const T = logB.length, k = m.k;
  const alpha: number[][] = [], scale: number[] = [];
  let logLik = 0;
  for (let t = 0; t < T; t++) {
    const mx = Math.max(...logB[t]);
    const b = logB[t].map((v) => Math.exp(v - mx));
    const a = new Array<number>(k).fill(0);
    for (let j = 0; j < k; j++) {
      let s = 0;
      if (t === 0) s = m.pi[j];
      else for (let i = 0; i < k; i++) s += alpha[t - 1][i] * m.A[i][j];
      a[j] = s * b[j];
    }
    const c = a.reduce((x, y) => x + y, 0) || 1e-300;
    alpha.push(a.map((v) => v / c));
    scale.push(c);
    logLik += Math.log(c) + mx;
  }
  return { alpha, scale, logLik };
}

function backward(m: Pick<Hmm, "k" | "A">, logB: number[][], scale: number[]): number[][] {
  const T = logB.length, k = m.k;
  const beta: number[][] = Array.from({ length: T }, () => new Array<number>(k).fill(1));
  for (let t = T - 2; t >= 0; t--) {
    const mx = Math.max(...logB[t + 1]);
    const b = logB[t + 1].map((v) => Math.exp(v - mx));
    for (let i = 0; i < k; i++) {
      let s = 0;
      for (let j = 0; j < k; j++) s += m.A[i][j] * b[j] * beta[t + 1][j];
      beta[t][i] = s / scale[t + 1];
    }
  }
  return beta;
}

function colCov(X: number[][], w: number[], mu: number[], ridge: number): Mat {
  const d = mu.length, S: Mat = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  let wsum = 0;
  X.forEach((x, t) => { wsum += w[t]; for (let i = 0; i < d; i++) for (let j = i; j < d; j++) S[i][j] += w[t] * (x[i] - mu[i]) * (x[j] - mu[j]); });
  for (let i = 0; i < d; i++) for (let j = i; j < d; j++) { S[i][j] = S[i][j] / Math.max(wsum, 1e-12) + (i === j ? ridge : 0); S[j][i] = S[i][j]; }
  return S;
}

/** One EM run from a starting point. */
function em(X: number[][], init: Hmm, maxIter: number, tol: number, ridge: number): Hmm {
  let m = init, prev = -Infinity, it = 0;
  for (; it < maxIter; it++) {
    const logB = emissions(m, X);
    const { alpha, scale, logLik } = forward(m, logB);
    const beta = backward(m, logB, scale);
    const T = X.length, k = m.k;
    const gamma = alpha.map((a, t) => { const g = a.map((v, i) => v * beta[t][i]); const s = g.reduce((x, y) => x + y, 0) || 1; return g.map((v) => v / s); });
    const xi = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    for (let t = 0; t < T - 1; t++) {
      const mx = Math.max(...logB[t + 1]);
      const b = logB[t + 1].map((v) => Math.exp(v - mx));
      let s = 0;
      const tmp = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => { const v = alpha[t][i] * m.A[i][j] * b[j] * beta[t + 1][j]; s += v; return v; }));
      for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) xi[i][j] += tmp[i][j] / (s || 1);
    }
    const A = xi.map((r) => { const s = r.reduce((x, y) => x + y, 0) || 1; return r.map((v) => Math.max(v / s, 1e-8)); });
    const means = Array.from({ length: k }, (_, s) => { const w = gamma.map((g) => g[s]), ws = w.reduce((x, y) => x + y, 0) || 1; return X[0].map((_, j) => X.reduce((a, x, t) => a + w[t] * x[j], 0) / ws); });
    const covs = Array.from({ length: k }, (_, s) => colCov(X, gamma.map((g) => g[s]), means[s], ridge));
    m = { ...m, pi: gamma[0].map((v) => Math.max(v, 1e-8)), A, means, covs, logLik };
    if (Math.abs(logLik - prev) < tol * Math.max(1, Math.abs(logLik))) { it++; break; }
    prev = logLik;
  }
  const final = forward(m, emissions(m, X));
  return { ...m, logLik: final.logLik, iterations: it };
}

/**
 * Fit a k-state Gaussian HMM to rows of X (T x d) from `starts` seeded random starts (each picks k distinct
 * rows as means, the pooled covariance, and a sticky transition matrix). The best fit is returned with states
 * sorted by the variance of feature 0.
 */
export function hmmFit(X: number[][], k = 2, opts: { starts?: number; maxIter?: number; tol?: number; seed?: number } = {}): Hmm {
  const T = X.length, d = X[0]?.length ?? 0;
  if (T < 10 * k || d < 1) throw new Error("An HMM needs at least ten observations per state");
  const starts = opts.starts ?? 5, maxIter = opts.maxIter ?? 200, tol = opts.tol ?? 1e-7;
  const pooledMean = X[0].map((_, j) => X.reduce((a, x) => a + x[j], 0) / T);
  const pooled = colCov(X, new Array<number>(T).fill(1), pooledMean, 0);
  const ridge = 1e-6 * Math.max(...pooled.map((r, i) => r[i]), 1e-12);
  const u = rng(opts.seed ?? 3);
  let best: Hmm | null = null;
  for (let s = 0; s < starts; s++) {
    const picks = new Set<number>();
    while (picks.size < k) picks.add(Math.floor(u() * T));
    const scales = Array.from({ length: k }, (_, i) => 0.5 + (1.5 * i) / Math.max(1, k - 1));
    const init: Hmm = {
      k, d, pi: new Array<number>(k).fill(1 / k),
      A: Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 0.95 : 0.05 / Math.max(1, k - 1)))),
      means: [...picks].map((t) => [...X[t]]),
      covs: scales.map((c) => pooled.map((r, i) => r.map((v, j) => v * c + (i === j ? ridge : 0)))),
      logLik: -Infinity, iterations: 0, starts,
    };
    const fit = em(X, init, maxIter, tol, ridge);
    if (!best || fit.logLik > best.logLik) best = fit;
  }
  return sortStates(best!);
}

function sortStates(m: Hmm): Hmm {
  const order = m.covs.map((c, i) => [c[0][0], i] as const).sort((a, b) => a[0] - b[0]).map(([, i]) => i);
  return { ...m, pi: order.map((i) => m.pi[i]), A: order.map((i) => order.map((j) => m.A[i][j])), means: order.map((i) => m.means[i]), covs: order.map((i) => m.covs[i]) };
}

/** Filtered probabilities P(s_t | x_1..x_t) for every t: uses no data after t. */
export function hmmFilter(m: Hmm, X: number[][]): number[][] {
  return forward(m, emissions(m, X)).alpha;
}

/** Smoothed probabilities P(s_t | x_1..x_T): they use the future, so never for "now" or in backtests. */
export function hmmSmooth(m: Hmm, X: number[][]): number[][] {
  const logB = emissions(m, X);
  const { alpha, scale } = forward(m, logB);
  const beta = backward(m, logB, scale);
  return alpha.map((a, t) => { const g = a.map((v, i) => v * beta[t][i]); const s = g.reduce((x, y) => x + y, 0) || 1; return g.map((v) => v / s); });
}

/** Simulate a path from a model (for tests and synthetic stress): states and observations. */
export function hmmSample(m: Hmm, T: number, seed = 1): { states: number[]; X: number[][] } {
  const u = rng(seed);
  let spare: number | null = null;
  const z = () => { if (spare !== null) { const s = spare; spare = null; return s; } let a = 0; while (a === 0) a = u(); const r = Math.sqrt(-2 * Math.log(a)), t = 2 * Math.PI * u(); spare = r * Math.sin(t); return r * Math.cos(t); };
  const pick = (p: number[]) => { let r = u(), i = 0; for (; i < p.length - 1; i++) { r -= p[i]; if (r <= 0) break; } return i; };
  const Ls = m.covs.map((c) => cholesky(c) ?? c.map((r, i) => r.map((_, j) => (i === j ? Math.sqrt(Math.max(c[i][i], 0)) : 0))));
  const states: number[] = [], X: number[][] = [];
  let s = pick(m.pi);
  for (let t = 0; t < T; t++) {
    if (t > 0) s = pick(m.A[s]);
    const e = Array.from({ length: m.d }, () => z());
    X.push(m.means[s].map((mu, i) => mu + Ls[s][i].reduce((a, l, j) => a + l * e[j], 0)));
    states.push(s);
  }
  return { states, X };
}

/** The stationary distribution of the transition matrix (long-run share of time in each state). */
export function stationary(A: Mat): number[] {
  const k = A.length;
  // Solve π(A - I) = 0 with Σπ = 1: replace one equation by the sum constraint.
  const M = Array.from({ length: k }, (_, j) => Array.from({ length: k }, (_, i) => A[i][j] - (i === j ? 1 : 0)));
  M[k - 1] = new Array<number>(k).fill(1);
  const inv = inverse(M);
  if (!inv) return new Array<number>(k).fill(1 / k);
  return inv.map((r) => r[k - 1]);
}
