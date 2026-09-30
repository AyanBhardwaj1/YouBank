/**
 * The statistics the scenario engine stands on: a seeded random source (every synthetic number can be
 * regenerated from its recipe and seed), moments, quantiles, correlation and its Cholesky factor,
 * least squares, and the realism check that sets synthetic data beside the real thing. Pure.
 */

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
