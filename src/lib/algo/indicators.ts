/**
 * The indicators strategies are built from. Pure, and each takes only the history it is given, so a caller
 * that slices history to a date cannot leak the future into them. Arrays are oldest first; a value that
 * cannot be computed yet is NaN.
 *
 * - Moving averages (simple, exponential), Wilder's RSI, the rolling z-score of price against its mean.
 * - Realised volatility (annualised from daily log returns) and the covariance of a basket for volatility
 *   targeting.
 * - Momentum: total return over a lookback, skipping the most recent month (the 12-1 convention, which
 *   avoids the short-term reversal effect; Jegadeesh and Titman 1993).
 * - Engle–Granger cointegration for pairs: the hedge ratio by least squares, an augmented Dickey–Fuller
 *   test on the spread with MacKinnon's critical values for two variables, and the spread's mean-reversion
 *   half-life from an AR(1) fit.
 */
import { mean, ols, std } from "@/lib/edge/scen/stats";

export const TRADING_DAYS = 252;

export function sma(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < x.length; i++) {
    s += x[i];
    if (i >= n) s -= x[i - n];
    if (i >= n - 1) out[i] = s / n;
  }
  return out;
}

export function ema(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  const k = 2 / (n + 1);
  let e = NaN;
  for (let i = 0; i < x.length; i++) {
    if (i === n - 1) e = mean(x.slice(0, n));
    else if (i >= n) e = x[i] * k + e * (1 - k);
    if (i >= n - 1) out[i] = e;
  }
  return out;
}

/** Wilder's RSI (smoothed average gain over smoothed average loss), 0–100. */
export function rsi(x: number[], n = 14): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  if (x.length <= n) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) { const d = x[i] - x[i - 1]; if (d > 0) gain += d; else loss -= d; }
  gain /= n; loss /= n;
  const val = () => (loss === 0 ? (gain === 0 ? 50 : 100) : 100 - 100 / (1 + gain / loss));
  out[n] = val();
  for (let i = n + 1; i < x.length; i++) {
    const d = x[i] - x[i - 1];
    gain = (gain * (n - 1) + Math.max(d, 0)) / n;
    loss = (loss * (n - 1) + Math.max(-d, 0)) / n;
    out[i] = val();
  }
  return out;
}

/** (price − mean of the last n) / their standard deviation. */
export function zscore(x: number[], n: number): number[] {
  const out = new Array<number>(x.length).fill(NaN);
  for (let i = n - 1; i < x.length; i++) {
    const w = x.slice(i - n + 1, i + 1);
    const s = std(w);
    out[i] = s > 0 ? (x[i] - mean(w)) / s : 0;
  }
  return out;
}

export const logReturns = (x: number[]) => x.slice(1).map((v, i) => (x[i] > 0 && v > 0 ? Math.log(v / x[i]) : 0));

/** Annualised volatility of the last `n` daily log returns. */
export function realizedVol(x: number[], n = 63): number {
  const r = logReturns(x.slice(-(n + 1)));
  return r.length >= 2 ? std(r) * Math.sqrt(TRADING_DAYS) : NaN;
}

/** Total return from `lookback` days ago to `skip` days ago (12-1 momentum: 252 and 21). */
export function momentum(x: number[], lookback = 252, skip = 21): number {
  const end = x.length - 1 - skip, start = x.length - 1 - lookback;
  if (start < 0 || end <= start || !(x[start] > 0)) return NaN;
  return x[end] / x[start] - 1;
}

/** Sample covariance matrix of daily log returns over the last n days, annualised. */
export function covariance(series: number[][], n = 63): number[][] {
  const rets = series.map((x) => logReturns(x.slice(-(n + 1))));
  const len = Math.min(...rets.map((r) => r.length));
  const R = rets.map((r) => r.slice(-len));
  const mu = R.map((r) => mean(r));
  return R.map((a, i) => R.map((b, j) => (len > 1 ? (a.reduce((s, v, t) => s + (v - mu[i]) * (b[t] - mu[j]), 0) / (len - 1)) * TRADING_DAYS : 0)));
}

/** Ex-ante annualised volatility of weights `w` under covariance `S`. */
export const portfolioVol = (w: number[], S: number[][]) => Math.sqrt(Math.max(0, w.reduce((s, wi, i) => s + w.reduce((t, wj, j) => t + wi * wj * S[i][j], 0), 0)));

/* ---------------- Cointegration (pairs) ---------------- */

/** MacKinnon (2010) asymptotic critical values for the Engle–Granger test with two variables and a constant. */
export const EG_CRITICAL = { "1%": -3.9, "5%": -3.34, "10%": -3.04 } as const;

/**
 * Augmented Dickey–Fuller t-statistic on a series (constant, `lags` lagged differences): the more negative,
 * the stronger the evidence that it mean-reverts.
 */
export function adfT(y: number[], lags = 1): number {
  const dy = y.slice(1).map((v, i) => v - y[i]);
  const rows: number[][] = [], target: number[] = [];
  for (let t = lags; t < dy.length; t++) {
    rows.push([y[t], ...Array.from({ length: lags }, (_, k) => dy[t - 1 - k])]);
    target.push(dy[t]);
  }
  if (!rows.length || rows.length < rows[0].length + 6) return NaN;
  // ols adds the constant itself (coefficient 0); no ridge, so the test statistic is the textbook one.
  const { beta, resid } = ols(target, rows, 0);
  const full = rows.map((r) => [1, ...r]);
  const k = full[0].length, n = full.length;
  const s2 = resid.reduce((s, e) => s + e * e, 0) / (n - k);
  // Var(beta_1) = s2 * [(X'X)^-1]_11, X with the constant.
  const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => full.reduce((s, r) => s + r[i] * r[j], 0)));
  const inv = invert(XtX);
  if (!inv) return NaN;
  const se = Math.sqrt(s2 * inv[1][1]);
  return se > 0 ? beta[1] / se : NaN;
}

function invert(a: number[][]): number[][] | null {
  const n = a.length;
  const m = a.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(m[r][c]) > Math.abs(m[p][c])) p = r;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c];
    for (let j = 0; j < 2 * n; j++) m[c][j] /= d;
    for (let r = 0; r < n; r++) if (r !== c) { const f = m[r][c]; for (let j = 0; j < 2 * n; j++) m[r][j] -= f * m[c][j]; }
  }
  return m.map((r) => r.slice(n));
}

/** Half-life in days of a mean-reverting spread, from Δs_t = a + b·s_{t−1}: −ln 2 / ln(1 + b). Infinity when it does not revert. */
export function halfLife(s: number[]): number {
  const rows = s.slice(0, -1).map((v) => [v]);
  const dy = s.slice(1).map((v, i) => v - s[i]);
  if (rows.length < 10) return Infinity;
  const b = ols(dy, rows, 0).beta[1];
  return b < 0 && b > -1 ? -Math.log(2) / Math.log(1 + b) : Infinity;
}

export type Cointegration = { hedge: number; alpha: number; spread: number[]; adf: number; cointegrated: { "1%": boolean; "5%": boolean; "10%": boolean }; halfLife: number; z: number };

/** Engle–Granger on log prices: log a = α + β·log b + spread; the spread's ADF, half-life and its latest z-score. */
export function engleGranger(a: number[], b: number[]): Cointegration {
  const n = Math.min(a.length, b.length);
  const la = a.slice(-n).map(Math.log), lb = b.slice(-n).map(Math.log);
  const { beta } = ols(la, lb.map((v) => [v]), 0);
  const spread = la.map((v, i) => v - beta[0] - beta[1] * lb[i]);
  const adf = adfT(spread, 1);
  const sd = std(spread);
  return {
    hedge: beta[1], alpha: beta[0], spread, adf,
    cointegrated: { "1%": adf < EG_CRITICAL["1%"], "5%": adf < EG_CRITICAL["5%"], "10%": adf < EG_CRITICAL["10%"] },
    halfLife: halfLife(spread), z: sd > 0 ? (spread[n - 1] - mean(spread)) / sd : 0,
  };
}
