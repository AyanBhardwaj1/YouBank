/**
 * The numeric core of the quant statistics kit (QF2): moments, the normal and Student t distributions with
 * accurate tails, Sharpe ratios and a seeded random source. Pure; built on src/lib/edge/scen/stats.ts
 * (incomplete beta and gamma, Acklam's inverse normal) rather than copying it.
 */
import { chi2Cdf as chi2CdfBase, gammaP, lgamma, normInv as normInvBase, tCdf as tCdfBase, tInv as tInvBase } from "@/lib/edge/scen/stats";

export { lgamma, gammaP };

export const sum = (x: ArrayLike<number>) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i]; return s; };
export const mean = (x: ArrayLike<number>) => (x.length ? sum(x) / x.length : NaN);

/** Sample variance (n - 1 in the denominator). */
export function variance(x: ArrayLike<number>): number {
  const n = x.length;
  if (n < 2) return NaN;
  const m = mean(x);
  let s = 0;
  for (let i = 0; i < n; i++) s += (x[i] - m) ** 2;
  return s / (n - 1);
}
export const std = (x: ArrayLike<number>) => Math.sqrt(variance(x));

export type Moments = { n: number; mean: number; std: number; skew: number; kurt: number };

/**
 * Mean, sample standard deviation (n - 1), and the skewness and kurtosis the Sharpe-ratio statistics use:
 * the standardised third and fourth central moments with n in the denominator, kurtosis not in excess
 * (a normal distribution has 3), as in Bailey and López de Prado (2012, 2014).
 */
export function moments(x: ArrayLike<number>): Moments {
  const n = x.length, m = mean(x);
  let m2 = 0, m3 = 0, m4 = 0;
  for (let i = 0; i < n; i++) { const d = x[i] - m, d2 = d * d; m2 += d2; m3 += d2 * d; m4 += d2 * d2; }
  m2 /= n; m3 /= n; m4 /= n;
  return { n, mean: m, std: n > 1 ? Math.sqrt((m2 * n) / (n - 1)) : NaN, skew: m2 > 0 ? m3 / m2 ** 1.5 : 0, kurt: m2 > 0 ? m4 / (m2 * m2) : 3 };
}

/** The per-period Sharpe ratio, mean over sample standard deviation (returns in excess of the risk-free rate). */
export function sharpe(x: ArrayLike<number>): number {
  const s = std(x);
  return s > 0 ? mean(x) / s : NaN;
}

export const annualise = (perPeriodSharpe: number, periodsPerYear = 252) => perPeriodSharpe * Math.sqrt(periodsPerYear);
export const perPeriod = (annualSharpe: number, periodsPerYear = 252) => annualSharpe / Math.sqrt(periodsPerYear);

/**
 * The complementary error function with relative error under 1.2e-7 everywhere (Numerical Recipes' erfcc,
 * a Chebyshev fit), so far-tail probabilities keep their digits, unlike 1 - erf.
 */
export function erfc(x: number): number {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}

/** Standard normal distribution function, accurate in both tails. */
export const normCdf = (x: number) => 0.5 * erfc(-x / Math.SQRT2);
/** Upper tail P(Z > x). */
export const normSf = (x: number) => 0.5 * erfc(x / Math.SQRT2);
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Inverse normal: Acklam's approximation, polished by one Halley step against normCdf. */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  let x = normInvBase(p);
  const e = normCdf(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
  x = x - u / (1 + (x * u) / 2);
  return x;
}

export const tCdf = tCdfBase;
export const tInv = tInvBase;
export const chi2Cdf = chi2CdfBase;
/** Two-sided p-value of a t statistic. */
export const tPValue = (t: number, df: number) => 2 * (1 - tCdf(Math.abs(t), df));

/** Deterministic uniform draws (mulberry32), the same generator inference/stats.ts uses. */
export function rng(seed = 42): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws from a uniform source (Box-Muller, both values used). */
export function normals(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let a = 0;
    while (a === 0) a = u();
    const r = Math.sqrt(-2 * Math.log(a)), t = 2 * Math.PI * u();
    spare = r * Math.sin(t);
    return r * Math.cos(t);
  };
}

/** Quantile with linear interpolation between order statistics (type 7, R's and NumPy's default). */
export function quantile(x: ArrayLike<number>, p: number): number {
  const s = Array.from(x).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = (s.length - 1) * Math.min(1, Math.max(0, p)), lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]) - s[lo]);
}

/** Pearson correlation of two equal-length series. */
export function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return NaN;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
}

/** Compounded growth of a return series, as a path starting at 1. */
export function wealth(r: ArrayLike<number>): number[] {
  const out = new Array<number>(r.length + 1);
  out[0] = 1;
  for (let i = 0; i < r.length; i++) out[i + 1] = out[i] * (1 + r[i]);
  return out;
}

/** Largest fall from a running peak of a wealth path, as a positive fraction. */
export function maxDrawdown(path: ArrayLike<number>): number {
  let peak = -Infinity, worst = 0;
  for (let i = 0; i < path.length; i++) { if (path[i] > peak) peak = path[i]; if (peak > 0) worst = Math.max(worst, 1 - path[i] / peak); }
  return worst;
}

/** n choose k as a float (exact for the sizes used here). */
export function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const EULER_GAMMA = 0.5772156649015329;
