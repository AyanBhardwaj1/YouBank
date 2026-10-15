/**
 * QF2: unit roots and cointegration, for pairs and baskets whose gap tends to close (Q10) and for checking
 * that a residual is stationary before trusting a half-life. Pure. The procedures follow statsmodels
 * (adfuller, coint, coint_johansen) step by step, so its answers serve as known values in the tests.
 *
 * - adf: the augmented Dickey-Fuller t statistic with p lagged differences; p-values by MacKinnon's (1994)
 *   response surfaces and critical values by MacKinnon (2010).
 * - engleGranger: the residual ADF of y on x (no constant in the ADF), with N = 2 critical values.
 * - johansen: trace and maximum-eigenvalue statistics with Osterwald-Lenum critical values (constant case).
 * - halfLife: -ln 2 / ln(1 + θ) from Δε_t = θ·ε_{t-1} + u_t.
 * - hurst: the slope of log std(x_{t+τ} - x_t) on log τ (0.5 for a random walk, below it for mean reversion).
 */
import { normCdf } from "./core";
import { cholesky, eigSym, inverse, matmul, transpose, type Mat } from "./linalg";

/** OLS of y on the columns of X (no constant added): coefficients, residuals and the coefficients' standard errors. */
export function olsFit(X: Mat, y: number[]): { beta: number[]; resid: number[]; se: number[]; sigma2: number } {
  const n = X.length, k = X[0]?.length ?? 0;
  const Xt = transpose(X);
  const XtX = matmul(Xt, X);
  const inv = inverse(XtX);
  if (!inv) throw new Error("The regressors are collinear");
  const Xty = Xt.map((r) => r.reduce((s, v, i) => s + v * y[i], 0));
  const beta = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  const resid = X.map((r, i) => y[i] - r.reduce((s, v, j) => s + v * beta[j], 0));
  const sigma2 = resid.reduce((s, e) => s + e * e, 0) / Math.max(1, n - k);
  return { beta, resid, se: inv.map((r, i) => Math.sqrt(Math.max(0, sigma2 * r[i]))), sigma2 };
}

/* ---------------- MacKinnon's tables (constant case "c" and no-constant "n"; N = number of I(1) series) ---------------- */

const TAU_STAR_C = [-1.61, -2.62, -3.13, -3.47, -3.78, -3.93];
const TAU_MIN_C = [-18.83, -18.86, -23.48, -28.07, -25.96, -23.27];
const TAU_MAX_C = [2.74, 0.92, 0.55, 0.61, 0.79, 1];
const TAU_C_SMALLP = [[2.1659, 1.4412, 3.8269], [2.92, 1.5012, 3.9796], [3.4699, 1.4856, 3.164], [3.9673, 1.4777, 2.6315], [4.5509, 1.5338, 2.9545], [5.1399, 1.6036, 3.4445]].map(([a, b, c]) => [a, b, c * 1e-2]);
const TAU_C_LARGEP = [[1.7339, 9.3202, -1.2745, -1.0368], [2.1945, 6.4695, -2.9198, -4.2377], [2.5893, 4.5168, -3.6529, -5.0074], [3.0387, 4.5452, -3.3666, -4.1921], [3.5049, 5.2098, -2.9158, -3.3468], [3.9489, 5.8933, -2.5359, -2.721]].map(([a, b, c, d]) => [a, b * 1e-1, c * 1e-1, d * 1e-2]);

/** MacKinnon (2010) critical-value coefficients, constant case, N = 1..4: [1%, 5%, 10%] x [β∞, β1, β2, β3]. */
const TAU_2010_C = [
  [[-3.43035, -6.5393, -16.786, -79.433], [-2.86154, -2.8903, -4.234, -40.04], [-2.56677, -1.5384, -2.809, 0]],
  [[-3.89644, -10.9519, -33.527, 0], [-3.33613, -6.1101, -6.823, 0], [-3.04445, -4.2412, -2.72, 0]],
  [[-4.29374, -14.4354, -33.195, 47.433], [-3.74066, -8.5632, -10.852, 27.982], [-3.45218, -6.2143, -3.718, 0]],
  [[-4.64332, -18.1031, -37.972, 0], [-4.096, -11.2349, -11.175, 0], [-3.8102, -8.3931, -4.137, 0]],
];

/** MacKinnon's (1994) approximate p-value for a Dickey-Fuller t statistic, constant case, N series. */
export function mackinnonP(tau: number, N = 1): number {
  const i = Math.min(Math.max(N, 1), 6) - 1;
  if (tau > TAU_MAX_C[i]) return 1;
  if (tau < TAU_MIN_C[i]) return 0;
  const c = tau <= TAU_STAR_C[i] ? TAU_C_SMALLP[i] : TAU_C_LARGEP[i];
  const z = c.reduce((s, v, k) => s + v * tau ** k, 0);
  return normCdf(z);
}

/** MacKinnon's (2010) finite-sample critical values at 1%, 5% and 10%, constant case, N = 1..4. */
export function mackinnonCrit(N = 1, nobs = Infinity): { "1%": number; "5%": number; "10%": number } {
  const t = TAU_2010_C[Math.min(Math.max(N, 1), 4) - 1];
  const at = (c: number[]) => (Number.isFinite(nobs) ? c[0] + c[1] / nobs + c[2] / nobs ** 2 + c[3] / nobs ** 3 : c[0]);
  return { "1%": at(t[0]), "5%": at(t[1]), "10%": at(t[2]) };
}

/* ---------------- ADF ---------------- */

export type Adf = { stat: number; pValue: number; lags: number; nobs: number; crit: { "1%": number; "5%": number; "10%": number }; gamma: number };

/**
 * Augmented Dickey-Fuller: Δy_t = γ·y_{t-1} + Σ_{i=1..p} φ_i·Δy_{t-i} (+ a constant when `constant`) + e_t.
 * The statistic is γ's t value; nobs = T - 1 - p. `pValueN` is the MacKinnon N to use for the p-value
 * (2 for an Engle-Granger residual).
 */
export function adf(y: number[], lags = 1, opts: { constant?: boolean; pValueN?: number } = {}): Adf {
  const constant = opts.constant ?? true;
  const dy = y.slice(1).map((v, i) => v - y[i]);
  const nobs = dy.length - lags;
  if (nobs < lags + 5) throw new Error("Too few observations for this many lags");
  const X: Mat = [], target: number[] = [];
  for (let t = lags; t < dy.length; t++) {
    const row = [y[t]];
    for (let i = 1; i <= lags; i++) row.push(dy[t - i]);
    if (constant) row.push(1);
    X.push(row); target.push(dy[t]);
  }
  const fit = olsFit(X, target);
  const stat = fit.beta[0] / fit.se[0];
  const N = opts.pValueN ?? 1;
  return { stat, pValue: mackinnonP(stat, N), lags, nobs, crit: mackinnonCrit(N, N === 1 ? nobs : nobs), gamma: fit.beta[0] };
}

/* ---------------- Engle-Granger ---------------- */

export type EngleGranger = { stat: number; pValue: number; crit: { "1%": number; "5%": number; "10%": number }; beta: number; alpha: number; resid: number[]; lags: number };

/** y = α + β·x + ε; then the ADF of ε without a constant, with N = 2 critical values (MacKinnon 2010). */
export function engleGranger(y: number[], x: number[], lags = 1): EngleGranger {
  const n = Math.min(y.length, x.length);
  const fit = olsFit(Array.from({ length: n }, (_, i) => [1, x[i]]), y.slice(0, n));
  const a = adf(fit.resid, lags, { constant: false, pValueN: 2 });
  return { stat: a.stat, pValue: a.pValue, crit: mackinnonCrit(2, n - 1), beta: fit.beta[1], alpha: fit.beta[0], resid: fit.resid, lags };
}

/* ---------------- Half-life and Hurst ---------------- */

/** Half-life of mean reversion in periods: -ln 2 / ln(1 + θ), θ from Δε_t = θ·ε_{t-1} + u_t. Infinite when θ >= 0. */
export function halfLife(e: number[]): { halfLife: number; theta: number } {
  let sxy = 0, sxx = 0;
  for (let t = 1; t < e.length; t++) { const d = e[t] - e[t - 1]; sxy += d * e[t - 1]; sxx += e[t - 1] * e[t - 1]; }
  const theta = sxx > 0 ? sxy / sxx : 0;
  return { theta, halfLife: theta < 0 && theta > -1 ? -Math.log(2) / Math.log(1 + theta) : theta <= -1 ? 0 : Infinity };
}

/** Hurst exponent from the scaling of lagged differences' spread over lags 2..maxLag. */
export function hurst(x: number[], maxLag = 20): number {
  const pts: [number, number][] = [];
  for (let tau = 2; tau <= Math.min(maxLag, Math.floor(x.length / 4)); tau++) {
    const d: number[] = [];
    for (let t = tau; t < x.length; t++) d.push(x[t] - x[t - tau]);
    const m = d.reduce((s, v) => s + v, 0) / d.length;
    const sd = Math.sqrt(d.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, d.length - 1));
    if (sd > 0) pts.push([Math.log(tau), Math.log(sd)]);
  }
  if (pts.length < 3) return NaN;
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxy = 0, sxx = 0;
  for (const [a, b] of pts) { sxy += (a - mx) * (b - my); sxx += (a - mx) ** 2; }
  return sxy / sxx;
}

/* ---------------- Johansen ---------------- */

/** Osterwald-Lenum critical values (90%, 95%, 99%), constant case, by the number of remaining relations (1..4). */
const JOHANSEN_TRACE = [[2.7055, 3.8415, 6.6349], [13.4294, 15.4943, 19.9349], [27.0669, 29.7961, 35.4628], [44.4929, 47.8545, 54.6815]];
const JOHANSEN_MAXEIG = [[2.7055, 3.8415, 6.6349], [12.2971, 14.2639, 18.52], [18.8928, 21.1314, 25.865], [25.1236, 27.5858, 32.7172]];

export type Johansen = { eigenvalues: number[]; trace: number[]; maxEig: number[]; traceCrit: number[][]; maxEigCrit: number[][]; rank95: number; vectors: number[][] };

const demean = (X: Mat): Mat => { const k = X[0]?.length ?? 0; const m = Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[j], 0) / X.length); return X.map((r) => r.map((v, j) => v - m[j])); };
const resid = (Y: Mat, Z: Mat): Mat => {
  if (!Z.length || !(Z[0]?.length)) return Y;
  const Zt = transpose(Z), inv = inverse(matmul(Zt, Z));
  if (!inv) return Y;
  const B = matmul(inv, matmul(Zt, Y));
  const fitted = matmul(Z, B);
  return Y.map((r, i) => r.map((v, j) => v - fitted[i][j]));
};

/**
 * Johansen's test for the number of cointegrating relations among the columns of Y (T x n, n <= 4), with
 * `lagDiff` lagged differences and a constant (statsmodels' det_order = 0). rank95 is the number of
 * relations the trace test accepts at 95%.
 */
export function johansen(Y: Mat, lagDiff = 1): Johansen {
  const n = Y[0]?.length ?? 0;
  if (n < 1 || n > 4) throw new Error("Johansen here handles one to four series");
  const X = demean(Y);
  const dx = X.slice(1).map((r, i) => r.map((v, j) => v - X[i][j]));
  const z: Mat = [];
  for (let t = lagDiff; t < dx.length; t++) z.push(Array.from({ length: lagDiff }, (_, l) => dx[t - 1 - l]).flat());
  const zd = lagDiff > 0 ? demean(z) : [];
  const dxs = demean(dx.slice(lagDiff));
  const r0 = resid(dxs, zd);
  const lx = demean(X.slice(1, X.length - lagDiff));
  const rk = resid(lx, zd);
  const T = r0.length;
  const S = (A: Mat, B: Mat) => matmul(transpose(A), B).map((r) => r.map((v) => v / T));
  const skk = S(rk, rk), sk0 = S(rk, r0), s00 = S(r0, r0);
  const s00inv = inverse(s00);
  if (!s00inv) throw new Error("The differences are collinear");
  const sig = matmul(sk0, matmul(s00inv, transpose(sk0)));
  const L = cholesky(skk);
  if (!L) throw new Error("The levels are collinear");
  const Li = inverse(L)!;
  const Msym = matmul(Li, matmul(sig, transpose(Li)));
  const sym = Msym.map((r, i) => r.map((v, j) => (v + Msym[j][i]) / 2));
  const { values, vectors } = eigSym(sym);
  const eigenvalues = values.map((v) => Math.min(Math.max(v, 0), 1 - 1e-12));
  const trace = eigenvalues.map((_, i) => -T * eigenvalues.slice(i).reduce((s, l) => s + Math.log(1 - l), 0));
  const maxEig = eigenvalues.map((l) => -T * Math.log(1 - l));
  const traceCrit = eigenvalues.map((_, i) => JOHANSEN_TRACE[n - i - 1]);
  const maxEigCrit = eigenvalues.map((_, i) => JOHANSEN_MAXEIG[n - i - 1]);
  let rank95 = 0;
  while (rank95 < n && trace[rank95] > traceCrit[rank95][1]) rank95++;
  const LiT = transpose(Li);
  return { eigenvalues, trace, maxEig, traceCrit, maxEigCrit, rank95, vectors: vectors.map((v) => LiT.map((r) => r.reduce((s, x, j) => s + x * v[j], 0))) };
}
