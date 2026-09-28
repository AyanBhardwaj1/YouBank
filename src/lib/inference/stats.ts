/**
 * Statistics for the inference layer: descriptive statistics, robust scores, regression, volatility
 * models (EWMA, GARCH(1,1)), drawdown and value at risk. Plain TypeScript, no dependencies, so the
 * same code runs in a route handler, in the browser and in the Studio agent.
 */

export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : NaN);

/** Sample variance (n - 1). */
export function variance(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
}
export const stdev = (xs: number[]) => Math.sqrt(variance(xs));

/** Quantile by linear interpolation between order statistics (Hyndman-Fan type 7, Excel's PERCENTILE.INC). */
export function quantile(xs: number[], p: number): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const h = (s.length - 1) * Math.min(1, Math.max(0, p));
  const lo = Math.floor(h), hi = Math.ceil(h);
  return s[lo] + (h - lo) * (s[hi] - s[lo]);
}
export const median = (xs: number[]) => quantile(xs, 0.5);

/** Median absolute deviation, unscaled. */
export function mad(xs: number[]): number {
  const m = median(xs);
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Robust z-score (Iglewicz and Hoaglin): 0.6745 (x - median) / MAD. |z| > 3.5 is the usual outlier cut. */
export function robustZ(x: number, xs: number[]): number {
  const m = median(xs), d = mad(xs);
  if (!Number.isFinite(d) || d === 0) return x === m ? 0 : Math.sign(x - m) * Infinity;
  return (0.6745 * (x - m)) / d;
}

/** Share of the values at or below x (a percentile rank from 0 to 1). */
export function percentRank(x: number, xs: number[]): number {
  const v = xs.filter(Number.isFinite);
  if (!v.length) return NaN;
  return v.filter((y) => y <= x).length / v.length;
}

/** Simple (or log) returns of a price series, oldest first. */
export function returns(prices: number[], log = false): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const a = prices[i - 1], b = prices[i];
    if (a > 0 && b > 0) out.push(log ? Math.log(b / a) : b / a - 1);
  }
  return out;
}

/* ---------------- The normal distribution ---------------- */

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 via erf; error below 1.5e-7). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

/** Inverse standard normal CDF (Acklam's rational approximation, relative error below 1.2e-9). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425, hi = 1 - lo;
  if (p < lo) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  if (p > hi) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  const q = p - 0.5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/* ---------------- Regression ---------------- */

export type Ols = { alpha: number; beta: number; r2: number; seBeta: number; seAlpha: number; residualSd: number; n: number; t: number };

/** Simple regression y = alpha + beta x, with standard errors. */
export function ols(x: number[], y: number[]): Ols {
  const n = Math.min(x.length, y.length);
  const xs = x.slice(0, n), ys = y.slice(0, n);
  const mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); syy += (ys[i] - my) ** 2; }
  const beta = sxx ? sxy / sxx : NaN, alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += (ys[i] - alpha - beta * xs[i]) ** 2;
  const s2 = n > 2 ? sse / (n - 2) : NaN;
  const seBeta = Math.sqrt(s2 / sxx), seAlpha = Math.sqrt(s2 * (1 / n + (mx * mx) / sxx));
  return { alpha, beta, r2: syy ? 1 - sse / syy : NaN, seBeta, seAlpha, residualSd: Math.sqrt(s2), n, t: beta / seBeta };
}

/** Multiple regression by the normal equations (small k), with an intercept added first. */
export function olsMulti(X: number[][], y: number[]): { coef: number[]; r2: number; se: number[] } {
  const rows = X.map((r) => [1, ...r]);
  const k = rows[0]?.length ?? 0, n = rows.length;
  const xtx = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => rows.reduce((a, r) => a + r[i] * r[j], 0)));
  const xty = Array.from({ length: k }, (_, i) => rows.reduce((a, r, t) => a + r[i] * y[t], 0));
  const inv = invert(xtx);
  if (!inv) return { coef: Array(k).fill(NaN), r2: NaN, se: Array(k).fill(NaN) };
  const coef = inv.map((row) => row.reduce((a, v, j) => a + v * xty[j], 0));
  const fit = rows.map((r) => r.reduce((a, v, j) => a + v * coef[j], 0));
  const my = mean(y);
  const sse = y.reduce((a, v, t) => a + (v - fit[t]) ** 2, 0), sst = y.reduce((a, v) => a + (v - my) ** 2, 0);
  const s2 = n > k ? sse / (n - k) : NaN;
  return { coef, r2: sst ? 1 - sse / sst : NaN, se: inv.map((row, i) => Math.sqrt(s2 * row[i])) };
}

/** Gauss-Jordan inverse with partial pivoting; null when singular. */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
    if (Math.abs(a[p][c]) < 1e-12) return null;
    [a[c], a[p]] = [a[p], a[c]];
    const d = a[c][c];
    for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = a[r][c]; if (f) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j]; }
  }
  return a.map((r) => r.slice(n));
}

export function correlation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

/* ---------------- Volatility ---------------- */

/** RiskMetrics EWMA variance: s2_t = lambda s2_{t-1} + (1 - lambda) r_{t-1}^2, seeded with the sample variance. Returns the variance after the last return. */
export function ewmaVariance(rets: number[], lambda = 0.94): number {
  if (rets.length < 2) return NaN;
  let v = variance(rets.slice(0, Math.min(30, rets.length)));
  for (const r of rets) v = lambda * v + (1 - lambda) * r * r;
  return v;
}

export type Garch = { omega: number; alpha: number; beta: number; persistence: number; longRunVariance: number; lastVariance: number; logLik: number };

/**
 * GARCH(1,1) by variance targeting (omega = long-run variance x (1 - alpha - beta)) and a grid search
 * of the Gaussian likelihood over alpha and beta. Robust and fast; returns null on short series.
 */
export function garch11(rets: number[]): Garch | null {
  const r = rets.filter(Number.isFinite);
  if (r.length < 120) return null;
  const m = mean(r), e = r.map((x) => x - m), lr = variance(e);
  let best: Garch | null = null;
  for (let a = 0.02; a <= 0.2; a += 0.01) {
    for (let b = 0.6; b <= 0.98; b += 0.01) {
      if (a + b >= 0.999) continue;
      const omega = lr * (1 - a - b);
      let v = lr, ll = 0;
      for (const x of e) { ll += -0.5 * (Math.log(2 * Math.PI) + Math.log(v) + (x * x) / v); v = omega + a * x * x + b * v; }
      if (!best || ll > best.logLik) best = { omega, alpha: a, beta: b, persistence: a + b, longRunVariance: lr, lastVariance: v, logLik: ll };
    }
  }
  return best;
}

/** GARCH(1,1) variance forecast h steps ahead: long run + (a + b)^(h - 1) (next - long run). */
export function garchForecast(g: Garch, h: number): number {
  return g.longRunVariance + Math.pow(g.persistence, Math.max(0, h - 1)) * (g.lastVariance - g.longRunVariance);
}

/* ---------------- Drawdown and value at risk ---------------- */

export function maxDrawdown(prices: number[]): { mdd: number; peak: number; trough: number } {
  let peak = 0, mdd = 0, pk = 0, tr = 0;
  for (let i = 0; i < prices.length; i++) {
    if (prices[i] > prices[peak]) peak = i;
    const dd = prices[i] / prices[peak] - 1;
    if (dd < mdd) { mdd = dd; pk = peak; tr = i; }
  }
  return { mdd, peak: pk, trough: tr };
}

export type VaR = { level: number; historical: number; historicalEs: number; parametric: number; parametricEs: number; cornishFisher: number; skew: number; kurtosis: number };

/**
 * One-period value at risk and expected shortfall, as positive loss fractions: historical, Gaussian,
 * and Cornish-Fisher (adjusted for skew and excess kurtosis).
 */
export function valueAtRisk(rets: number[], level = 0.95): VaR {
  const r = rets.filter(Number.isFinite);
  const m = mean(r), s = stdev(r), n = r.length;
  const skew = r.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / n;
  const kurt = r.reduce((a, x) => a + ((x - m) / s) ** 4, 0) / n - 3;
  const q = quantile(r, 1 - level);
  const tail = r.filter((x) => x <= q);
  const z = normInv(1 - level);
  const zcf = z + ((z * z - 1) * skew) / 6 + ((z ** 3 - 3 * z) * kurt) / 24 - ((2 * z ** 3 - 5 * z) * skew * skew) / 36;
  return {
    level, historical: -q, historicalEs: tail.length ? -mean(tail) : -q,
    parametric: -(m + z * s), parametricEs: -(m - (s * normPdf(z)) / (1 - level)),
    cornishFisher: -(m + zcf * s), skew, kurtosis: kurt,
  };
}

/** Annualized Sharpe and Sortino ratios from periodic returns (risk-free per period subtracted). */
export function sharpeSortino(rets: number[], periodsPerYear = 252, rfPerPeriod = 0): { sharpe: number; sortino: number } {
  const ex = rets.map((r) => r - rfPerPeriod);
  const m = mean(ex), s = stdev(ex);
  const down = Math.sqrt(mean(ex.map((r) => Math.min(0, r) ** 2)));
  return { sharpe: (m / s) * Math.sqrt(periodsPerYear), sortino: down ? (m / down) * Math.sqrt(periodsPerYear) : NaN };
}

/** Deterministic pseudo-random numbers (mulberry32), so simulations are reproducible. */
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

/** Standard normal draws from a uniform generator (Box-Muller). */
export function normalSampler(u: () => number): () => number {
  let spare: number | null = null;
  return () => {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let a = 0, b = 0;
    while (a === 0) a = u();
    while (b === 0) b = u();
    const r = Math.sqrt(-2 * Math.log(a)), t = 2 * Math.PI * b;
    spare = r * Math.sin(t);
    return r * Math.cos(t);
  };
}

/**
 * Welch's slope-winsorized, age-decayed beta ("Simply Better Market Betas", 2022). Each stock return is
 * clipped to the band between -2 and +4 times the day's market return (which tames the jumps that
 * wreck OLS betas), then a weighted regression gives recent days more say: weights exp(-2/252 x age),
 * a half-life of about 87 trading days. It predicts future betas better than OLS, Blume or Vasicek.
 * `x` is the market's returns and `y` the stock's, aligned and oldest first.
 */
export function welchBeta(x: number[], y: number[], decay = 2 / 252): { beta: number; se: number; n: number } | null {
  const n = Math.min(x.length, y.length);
  if (n < 60) return null;
  const xs = x.slice(-n), ys = y.slice(-n).map((r, i) => { const m = xs[i]; const lo = Math.min(-2 * m, 4 * m), hi = Math.max(-2 * m, 4 * m); return Math.min(hi, Math.max(lo, r)); });
  const w = xs.map((_, i) => Math.exp(-decay * (n - 1 - i)));
  const sw = w.reduce((a, b) => a + b, 0), sw2 = w.reduce((a, b) => a + b * b, 0);
  const mx = xs.reduce((a, v, i) => a + w[i] * v, 0) / sw, my = ys.reduce((a, v, i) => a + w[i] * v, 0) / sw;
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += w[i] * (xs[i] - mx) ** 2; sxy += w[i] * (xs[i] - mx) * (ys[i] - my); }
  if (!sxx) return null;
  const beta = sxy / sxx, alpha = my - beta * mx;
  let sse = 0;
  for (let i = 0; i < n; i++) sse += w[i] * (ys[i] - alpha - beta * xs[i]) ** 2;
  const nEff = (sw * sw) / sw2;
  const s2 = (sse / sw) * (nEff / Math.max(1, nEff - 2));
  return { beta, se: Math.sqrt(s2 / ((sxx / sw) * nEff)), n };
}

/**
 * Kupiec's proportion-of-failures test for a value-at-risk model: with `exceptions` losses beyond VaR
 * in `n` days at coverage level `level`, the likelihood ratio against the expected rate and its
 * p-value (chi-squared, one degree of freedom). A small p-value says the model is miscalibrated.
 */
export function kupiec(exceptions: number, n: number, level: number): { lr: number; pValue: number; expected: number } {
  const p = 1 - level, x = exceptions, phat = x / n;
  const ll = (q: number) => (n - x) * Math.log(1 - q) + (x ? x * Math.log(q) : 0);
  const lr = x === 0 ? -2 * n * Math.log(1 - p) : x === n ? -2 * ll(p) : -2 * (ll(p) - ll(phat));
  return { lr, pValue: 2 * (1 - normCdf(Math.sqrt(Math.max(0, lr)))), expected: n * p };
}

/**
 * Annualized volatility from one year's high and low (Parkinson 1980): ln(H/L) / sqrt(4 ln 2). Far
 * noisier than daily returns, and biased up when the stock trended, so it errs on the cautious side;
 * used only when daily prices are not available.
 */
export function parkinsonVol(high: number | null | undefined, low: number | null | undefined): number | null {
  if (!high || !low || !(high > low) || !(low > 0)) return null;
  return Math.log(high / low) / Math.sqrt(4 * Math.LN2);
}
