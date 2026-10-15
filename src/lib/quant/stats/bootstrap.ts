/**
 * QF2: the stationary bootstrap (Politis and Romano 1994) for intervals on Sharpe ratios, drawdowns and
 * cumulative abnormal returns of serially dependent series; its automatic mean block length (Politis and
 * White 2004, with the Patton, Politis and White 2009 correction); and White's (2000) Reality Check for
 * data snooping across many strategies. Seeded, so every interval is reproducible. Pure.
 */
import { mean, quantile, rng as makeRng } from "./core";

/** Sample autocovariance at lag k (n in the denominator). */
function autocov(x: ArrayLike<number>, k: number, m: number): number {
  let s = 0;
  for (let t = k; t < x.length; t++) s += (x[t] - m) * (x[t - k] - m);
  return s / x.length;
}

/**
 * The optimal mean block length for the stationary bootstrap (Politis and White 2004; Patton, Politis and
 * White 2009). Picks the bandwidth m̂ as the first lag after which K_N consecutive autocorrelations are
 * insignificant (|ρ| < 2·√(log10 n / n)), M = 2m̂, then b = (2Ĝ² / D)^(1/3)·n^(1/3) with the flat-top kernel.
 * Bounded to [1, n/3]; 1 for a series with no detectable dependence.
 */
export function politisWhite(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 10) return 1;
  const m = mean(x);
  const g0 = autocov(x, 0, m);
  if (!(g0 > 0)) return 1;
  const kn = Math.max(5, Math.ceil(Math.sqrt(Math.log10(n))));
  const maxLag = Math.min(n - 1, Math.ceil(Math.sqrt(n)) + kn);
  const rho = Array.from({ length: maxLag + 1 }, (_, k) => autocov(x, k, m) / g0);
  const crit = 2 * Math.sqrt(Math.log10(n) / n);
  let mhat = maxLag - kn;
  for (let k = 1; k + kn - 1 <= maxLag; k++) {
    let quiet = true;
    for (let j = 0; j < kn; j++) if (Math.abs(rho[k + j]) >= crit) { quiet = false; break; }
    if (quiet) { mhat = k - 1; break; }
  }
  const M = Math.min(2 * Math.max(mhat, 1), maxLag);
  const lam = (s: number) => { const a = Math.abs(s); return a <= 0.5 ? 1 : a <= 1 ? 2 * (1 - a) : 0; };
  let G = 0, g = 0;
  for (let k = -M; k <= M; k++) { const w = lam(k / M), c = autocov(x, Math.abs(k), m); G += w * Math.abs(k) * c; g += w * c; }
  const D = 2 * g * g;
  if (!(D > 0) || G === 0) return 1;
  const b = Math.pow((2 * G * G) / D, 1 / 3) * Math.pow(n, 1 / 3);
  return Math.min(Math.max(1, b), Math.max(1, n / 3));
}

/**
 * One stationary-bootstrap resample's indices: blocks start at a uniform position, each block's length is
 * geometric with mean `block`, and indices wrap around the end.
 */
export function stationaryIndices(n: number, block: number, u: () => number): Int32Array {
  const out = new Int32Array(n);
  const p = 1 / Math.max(1, block);
  let i = Math.floor(u() * n);
  for (let t = 0; t < n; t++) {
    if (t > 0) i = u() < p ? Math.floor(u() * n) : (i + 1) % n;
    out[t] = i;
  }
  return out;
}

export type BootstrapCi = { estimate: number; low: number; high: number; level: number; draws: number; block: number; seed: number; samples: number[] };

/**
 * A percentile interval for `stat` of a series by the stationary bootstrap. `block` defaults to the
 * Politis-White length. The resampled statistics are returned for charts and probabilities.
 */
export function bootstrapCi(x: ArrayLike<number>, stat: (s: ArrayLike<number>) => number, opts: { draws?: number; level?: number; seed?: number; block?: number } = {}): BootstrapCi {
  const draws = opts.draws ?? 1000, level = opts.level ?? 0.9, seed = opts.seed ?? 7;
  const block = opts.block ?? politisWhite(x);
  const u = makeRng(seed), n = x.length, buf = new Float64Array(n), samples: number[] = [];
  for (let d = 0; d < draws; d++) {
    const idx = stationaryIndices(n, block, u);
    for (let t = 0; t < n; t++) buf[t] = x[idx[t]];
    const v = stat(buf);
    if (Number.isFinite(v)) samples.push(v);
  }
  return { estimate: stat(x), low: quantile(samples, (1 - level) / 2), high: quantile(samples, 1 - (1 - level) / 2), level, draws, block, seed, samples };
}

/**
 * The same, for a statistic of several aligned series resampled together (dates kept in step), such as an
 * equal-weighted cumulative abnormal return across events. `rows[t]` holds period t of every series.
 */
export function bootstrapRows<T>(rows: T[], stat: (s: T[]) => number, opts: { draws?: number; level?: number; seed?: number; block?: number } = {}): BootstrapCi {
  const draws = opts.draws ?? 1000, level = opts.level ?? 0.9, seed = opts.seed ?? 7, block = opts.block ?? 1;
  const u = makeRng(seed), n = rows.length, samples: number[] = [];
  for (let d = 0; d < draws; d++) {
    const idx = stationaryIndices(n, block, u);
    const v = stat(Array.from(idx, (i) => rows[i]));
    if (Number.isFinite(v)) samples.push(v);
  }
  return { estimate: stat(rows), low: quantile(samples, (1 - level) / 2), high: quantile(samples, 1 - (1 - level) / 2), level, draws, block, seed, samples };
}

export type RealityCheck = { pValue: number; statistic: number; best: number; draws: number; block: number };

/**
 * White's Reality Check: is the best of K strategies' mean excess return (over the benchmark, here zero) more
 * than data snooping would give? `M` is T x K (rows = periods). The statistic is max_k √T·mean_k; its null
 * distribution comes from the stationary bootstrap of the recentred means.
 */
export function realityCheck(M: number[][], opts: { draws?: number; seed?: number; block?: number } = {}): RealityCheck {
  const T = M.length, K = M[0]?.length ?? 0;
  if (T < 10 || K < 1) return { pValue: NaN, statistic: NaN, best: -1, draws: 0, block: 0 };
  const draws = opts.draws ?? 500, seed = opts.seed ?? 11;
  const means = Array.from({ length: K }, (_, k) => { let s = 0; for (let t = 0; t < T; t++) s += M[t][k]; return s / T; });
  const avg = M.map((r) => r.reduce((s, v) => s + v, 0) / K);
  const block = opts.block ?? politisWhite(avg);
  let best = 0;
  means.forEach((m, k) => { if (m > means[best]) best = k; });
  const statistic = Math.sqrt(T) * means[best];
  const u = makeRng(seed);
  let exceed = 0;
  for (let d = 0; d < draws; d++) {
    const idx = stationaryIndices(T, block, u);
    let vmax = -Infinity;
    for (let k = 0; k < K; k++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += M[idx[t]][k];
      vmax = Math.max(vmax, Math.sqrt(T) * (s / T - means[k]));
    }
    if (vmax >= statistic) exceed++;
  }
  return { pValue: exceed / draws, statistic, best, draws, block };
}
