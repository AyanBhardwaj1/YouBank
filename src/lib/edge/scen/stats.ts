/**
 * The statistics the scenario engine stands on: a seeded random source (every synthetic number can be
 * regenerated from its recipe and seed), moments, quantiles, correlation and its Cholesky factor,
 * least squares, and the realism check that sets synthetic data beside the real thing; then the
 * distributions the newer models need (Student's t, the incomplete beta and gamma functions, chi-squared,
 * Gamma draws) and rank tools (Kendall's tau, pseudo-observations). Pure.
 */
import type { Check } from "./realism";

/** A seeded uniform source (mulberry32): the same seed always gives the same numbers. */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal draws from a uniform source (Box-Muller, the spare kept). */
export function normals(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let a = 0, b = 0;
    while (a <= 1e-12) a = u();
    b = u();
    const r = Math.sqrt(-2 * Math.log(a)), th = 2 * Math.PI * b;
    spare = r * Math.sin(th);
    return r * Math.cos(th);
  };
}

/** A Student-t draw with `df` degrees of freedom, scaled to unit variance (for fat tails). */
export function studentT(n: () => number, df: number): number {
  let chi = 0;
  for (let i = 0; i < df; i++) { const z = n(); chi += z * z; }
  return (n() / Math.sqrt(chi / df)) * Math.sqrt((df - 2) / df);
}

export const mean = (x: number[]) => (x.length ? x.reduce((s, v) => s + v, 0) / x.length : 0);
export function std(x: number[]): number { const m = mean(x); return x.length > 1 ? Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1)) : 0; }
export function skew(x: number[]): number { const m = mean(x), s = std(x); return s > 0 ? x.reduce((a, v) => a + ((v - m) / s) ** 3, 0) / x.length : 0; }
/** Excess kurtosis (0 for a normal distribution). */
export function kurtosis(x: number[]): number { const m = mean(x), s = std(x); return s > 0 ? x.reduce((a, v) => a + ((v - m) / s) ** 4, 0) / x.length - 3 : 0; }
export function autocorr(x: number[], lag = 1): number {
  const m = mean(x);
  let num = 0, den = 0;
  for (let i = 0; i < x.length; i++) { den += (x[i] - m) ** 2; if (i >= lag) num += (x[i] - m) * (x[i - lag] - m); }
  return den > 0 ? num / den : 0;
}

/** The q-quantile (0..1) of already sorted numbers, interpolated. */
export function quantileSorted(s: number[], q: number): number {
  if (!s.length) return NaN;
  const p = (s.length - 1) * Math.min(1, Math.max(0, q)), lo = Math.floor(p), hi = Math.ceil(p);
  return s[lo] + (s[hi] - s[lo]) * (p - lo);
}
export const quantile = (x: number[], q: number) => quantileSorted([...x].sort((a, b) => a - b), q);

/** Pearson correlation matrix of columns (rows are observations). */
export function correlation(rows: number[][]): number[][] {
  const n = rows[0]?.length ?? 0;
  const cols = Array.from({ length: n }, (_, j) => rows.map((r) => r[j]));
  const m = cols.map(mean), s = cols.map(std);
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    if (i === j) return 1;
    if (!s[i] || !s[j]) return 0;
    let c = 0;
    for (let t = 0; t < rows.length; t++) c += (cols[i][t] - m[i]) * (cols[j][t] - m[j]);
    return c / ((rows.length - 1) * s[i] * s[j]);
  }));
}

/** Lower Cholesky factor; a small ridge keeps a nearly singular matrix usable. */
export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a[i][j] + (i === j ? 1e-9 : 0);
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-12)) : s / L[j][j];
    }
  }
  return L;
}

/** Least squares with an intercept: coefficients (intercept first), residuals and R². A ridge keeps it stable. */
export function ols(y: number[], X: number[][], ridge = 1e-6): { beta: number[]; resid: number[]; r2: number } {
  const n = y.length, k = (X[0]?.length ?? 0) + 1;
  const A = Array.from({ length: k }, () => new Array(k).fill(0)), b = new Array(k).fill(0);
  for (let t = 0; t < n; t++) {
    const row = [1, ...X[t]];
    for (let i = 0; i < k; i++) { b[i] += row[i] * y[t]; for (let j = 0; j < k; j++) A[i][j] += row[i] * row[j]; }
  }
  for (let i = 1; i < k; i++) A[i][i] += ridge * n;
  // Gaussian elimination with partial pivoting.
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < k; c++) {
    let p = c;
    for (let r = c + 1; r < k; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < k; r++) if (r !== c) { const f = M[r][c] / d; for (let j = c; j <= k; j++) M[r][j] -= f * M[c][j]; }
  }
  const beta = M.map((r, i) => r[k] / (r[i] || 1e-12));
  const resid = y.map((v, t) => v - [1, ...X[t]].reduce((s, x, i) => s + x * beta[i], 0));
  const my = mean(y), sst = y.reduce((s, v) => s + (v - my) ** 2, 0), sse = resid.reduce((s, v) => s + v * v, 0);
  return { beta, resid, r2: sst > 0 ? 1 - sse / sst : 0 };
}

/** Two-sample Kolmogorov-Smirnov statistic: the largest gap between the two distributions. */
export function ks(a: number[], b: number[]): number {
  const x = [...a].sort((p, q) => p - q), y = [...b].sort((p, q) => p - q);
  let i = 0, j = 0, d = 0;
  while (i < x.length && j < y.length) {
    const v = Math.min(x[i], y[j]);
    while (i < x.length && x[i] <= v) i++;
    while (j < y.length && y[j] <= v) j++;
    d = Math.max(d, Math.abs(i / x.length - j / y.length));
  }
  return d;
}

export type Moments = { mean: number; std: number; skew: number; kurtosis: number; acf1: number; acfAbs1: number };
export const moments = (x: number[]): Moments => ({ mean: mean(x), std: std(x), skew: skew(x), kurtosis: kurtosis(x), acf1: autocorr(x, 1), acfAbs1: autocorr(x.map(Math.abs), 1) });

export type Realism = {
  score: number;
  columns: { name: string; real: Moments; synthetic: Moments; ks: number }[];
  correlationGap: number;
  warnings: string[];
  /** Realism v2 (realism.ts): stylised facts against block-bootstrap bands; `score` is then v2's and `v1` the score above. */
  version?: 2; checks?: Check[]; bands?: { resamples: number; block: number; days: number; paths: number }; v1?: number;
};

/**
 * Real against synthetic, column by column: moments side by side, the distance between the
 * distributions, and how far the correlations drifted; folded into a score out of 100 with plain
 * warnings for what is off.
 */
export function realism(names: string[], real: number[][], synth: number[][]): Realism {
  const warnings: string[] = [];
  const columns = names.map((name, j) => {
    const r = real.map((row) => row[j]).filter(Number.isFinite), s = synth.map((row) => row[j]).filter(Number.isFinite);
    return { name, real: moments(r), synthetic: moments(s), ks: ks(r, s) };
  });
  let penalty = 0;
  for (const c of columns) {
    const vol = c.real.std > 0 ? Math.abs(c.synthetic.std / c.real.std - 1) : 0;
    penalty += Math.min(30, c.ks * 60) + Math.min(20, vol * 40) + Math.min(10, Math.abs(c.synthetic.kurtosis - c.real.kurtosis) / 2) + Math.min(10, Math.abs(c.synthetic.acfAbs1 - c.real.acfAbs1) * 20);
    if (vol > 0.25) warnings.push(`${c.name}: synthetic volatility is ${Math.round((c.synthetic.std / c.real.std) * 100)}% of the real.`);
    if (c.ks > 0.15) warnings.push(`${c.name}: the synthetic distribution differs from the real (KS ${c.ks.toFixed(2)}).`);
    if (c.real.kurtosis > 2 && c.synthetic.kurtosis < c.real.kurtosis / 3) warnings.push(`${c.name}: tails are thinner than the real ones.`);
  }
  const cr = real.length > 2 && names.length > 1 ? correlation(real) : [], cs = synth.length > 2 && names.length > 1 ? correlation(synth) : [];
  let gap = 0, pairs = 0;
  for (let i = 0; i < cr.length; i++) for (let j = i + 1; j < cr.length; j++) { gap += Math.abs(cr[i][j] - cs[i][j]); pairs++; }
  const correlationGap = pairs ? gap / pairs : 0;
  if (correlationGap > 0.15) warnings.push(`Correlations drift by ${correlationGap.toFixed(2)} on average.`);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty / Math.max(1, columns.length) - correlationGap * 60)));
  return { score, columns, correlationGap: Math.round(correlationGap * 1000) / 1000, warnings };
}

/** The standard normal distribution function (Abramowitz and Stegun 7.1.26, error under 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/** Its inverse (Acklam's rational approximation, relative error under 1.2e-9). */
export function normInv(p: number): number {
  const q = Math.min(1 - 1e-12, Math.max(1e-12, p));
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  if (q < 0.02425) { const r = Math.sqrt(-2 * Math.log(q)); return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  if (q > 1 - 0.02425) { const r = Math.sqrt(-2 * Math.log(1 - q)); return -(((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1); }
  const r = q - 0.5, s = r * r;
  return (((((a[0] * s + a[1]) * s + a[2]) * s + a[3]) * s + a[4]) * s + a[5]) * r / (((((b[0] * s + b[1]) * s + b[2]) * s + b[3]) * s + b[4]) * s + 1);
}

/** log Γ(x) (Lanczos, g = 7, nine terms; about 15 digits), with the reflection formula below one half. */
export function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  const y = x - 1, t = y + 7.5;
  let a = c[0];
  for (let i = 1; i < 9; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction of the incomplete beta function (modified Lentz). */
function betacf(x: number, a: number, b: number): number {
  const tiny = 1e-300, qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  d = 1 / (Math.abs(d) < tiny ? tiny : d);
  let h = d;
  for (let m = 1; m <= 400; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d); c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; d = 1 / (Math.abs(d) < tiny ? tiny : d); c = 1 + aa / c; if (Math.abs(c) < tiny) c = tiny;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h;
}

/** The regularised incomplete beta function I_x(a, b). */
export function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

/** Its inverse in x (Numerical Recipes' starting guess, then Halley steps). */
export function ibetaInv(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let x: number;
  if (a >= 1 && b >= 1) {
    const pp = p < 0.5 ? p : 1 - p, t = Math.sqrt(-2 * Math.log(pp));
    let z = (2.30753 + t * 0.27061) / (1 + t * (0.99229 + t * 0.04481)) - t;
    if (p < 0.5) z = -z;
    const al = (z * z - 3) / 6, h = 2 / (1 / (2 * a - 1) + 1 / (2 * b - 1));
    const w = (z * Math.sqrt(al + h)) / h - (1 / (2 * b - 1) - 1 / (2 * a - 1)) * (al + 5 / 6 - 2 / (3 * h));
    x = a / (a + b * Math.exp(2 * w));
  } else {
    const t = Math.exp(a * Math.log(a / (a + b))) / a, u = Math.exp(b * Math.log(b / (a + b))) / b, w = t + u;
    x = p < t / w ? Math.pow(a * w * p, 1 / a) : 1 - Math.pow(b * w * (1 - p), 1 / b);
  }
  const afac = -lgamma(a) - lgamma(b) + lgamma(a + b), a1 = a - 1, b1 = b - 1;
  for (let j = 0; j < 12; j++) {
    if (x <= 0 || x >= 1) return Math.min(1, Math.max(0, x));
    const err = ibeta(x, a, b) - p, t = Math.exp(a1 * Math.log(x) + b1 * Math.log(1 - x) + afac), u = err / t;
    const step = u / (1 - 0.5 * Math.min(1, u * (a1 / x - b1 / (1 - x))));
    x -= step;
    if (x <= 0) x = 0.5 * (x + step);
    if (x >= 1) x = 0.5 * (x + step + 1);
    if (Math.abs(step) < 1e-12 * x && j > 0) break;
  }
  return x;
}

/** Student's t distribution function with `df` degrees of freedom. */
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * ibeta(df / (df + t * t), df / 2, 0.5);
  return t >= 0 ? 1 - tail : tail;
}

/** Its log density. */
export const tLogPdf = (t: number, df: number) => lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (t * t) / df);

/** Its quantile: through the tail's incomplete beta in the tails, through |T|'s near the middle (where 1 - x loses digits). */
export function tInv(p: number, df: number): number {
  const q = Math.min(1 - 1e-15, Math.max(1e-15, p));
  if (q > 0.25 && q < 0.75) { const y = ibetaInv(Math.abs(2 * q - 1), 0.5, df / 2); return Math.sign(q - 0.5) * Math.sqrt((df * y) / Math.max(1e-300, 1 - y)); }
  const x = ibetaInv(2 * Math.min(q, 1 - q), df / 2, 0.5);
  return (q < 0.5 ? -1 : 1) * Math.sqrt((df * (1 - x)) / Math.max(1e-300, x));
}

/** The regularised lower incomplete gamma function P(a, x) (series below a + 1, continued fraction above). */
export function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lead = -x + a * Math.log(x) - lgamma(a);
  if (x < a + 1) {
    let ap = a, del = 1 / a, sum = del;
    for (let i = 0; i < 1000; i++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return Math.min(1, sum * Math.exp(lead));
  }
  const tiny = 1e-300;
  let b = x + 1 - a, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a); b += 2;
    d = an * d + b; d = 1 / (Math.abs(d) < tiny ? tiny : d); c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    const del = d * c; h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.max(0, 1 - Math.exp(lead) * h);
}

/** The chi-squared distribution function with k degrees of freedom. */
export const chi2Cdf = (x: number, k: number) => gammaP(k / 2, x / 2);

/** A Gamma(shape, 1) draw (Marsaglia and Tsang); twice a Gamma(df / 2) is a chi-squared with df degrees of freedom. */
export function gammaDraw(u: () => number, n: () => number, shape: number): number {
  if (shape < 1) return gammaDraw(u, n, shape + 1) * Math.pow(Math.max(u(), 1e-300), 1 / shape);
  const d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let z = n(), v = 1 + c * z;
    while (v <= 0) { z = n(); v = 1 + c * z; }
    v = v * v * v;
    const w = u();
    if (w < 1 - 0.0331 * z ** 4 || Math.log(Math.max(w, 1e-300)) < 0.5 * z * z + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Kendall's rank correlation (tau-a; quadratic, fine for a few thousand points). */
export function kendall(a: number[], b: number[]): number {
  let s = 0, pairs = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) { const v = Math.sign(a[i] - a[j]) * Math.sign(b[i] - b[j]); if (v) { s += v; pairs++; } }
  return pairs ? s / pairs : 0;
}

/** Ranks scaled into (0, 1) (rank / (n + 1)): the pseudo-observations a copula is fitted to. Ties keep their order. */
export function pseudoObs(x: number[]): number[] {
  const order = x.map((_, i) => i).sort((p, q) => x[p] - x[q]), out = new Array<number>(x.length);
  order.forEach((i, r) => { out[i] = (r + 1) / (x.length + 1); });
  return out;
}

/** A correlation matrix nudged toward the identity until its Cholesky factor exists without clamping (rank estimates need not be positive definite). */
export function nearPd(R: number[][]): { R: number[][]; L: number[][] } {
  const n = R.length;
  for (const d of [0, 0.01, 0.03, 0.1, 0.2, 0.35, 0.5, 0.7, 1]) {
    const S = R.map((row, i) => row.map((v, j) => (i === j ? 1 : (1 - d) * v)));
    const L = Array.from({ length: n }, () => new Array(n).fill(0));
    let ok = true;
    for (let i = 0; i < n && ok; i++) for (let j = 0; j <= i; j++) {
      let s = S[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      if (i === j) { if (s < 1e-6) { ok = false; break; } L[i][i] = Math.sqrt(s); } else L[i][j] = s / L[j][j];
    }
    if (ok) return { R: S, L };
  }
  return { R: R.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))), L: R.map((row, i) => row.map((_, j) => (i === j ? 1 : 0))) };
}

/** Solve L y = b for a lower triangular L (forward substitution). */
export function forwardSolve(L: number[][], b: number[]): number[] {
  const y = new Array<number>(b.length).fill(0);
  for (let i = 0; i < b.length; i++) { let s = b[i]; for (let k = 0; k < i; k++) s -= L[i][k] * y[k]; y[i] = s / L[i][i]; }
  return y;
}

/** Solve A x = b for a small symmetric positive definite A (through its Cholesky factor). */
export function solveSpd(A: number[][], b: number[]): number[] {
  const L = cholesky(A), y = forwardSolve(L, b), n = b.length, x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k]; x[i] = s / L[i][i]; }
  return x;
}
