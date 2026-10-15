/**
 * QF2: regressions the factor lab and the risk model use. Pure.
 * - ols: multiple regression with a constant, classical and Newey-West (HAC, Bartlett kernel) standard errors,
 *   R² and t statistics. The Newey-West covariance has no small-sample factor, as statsmodels' HAC default,
 *   so its answers are the tests' known values.
 * - wls: weighted least squares (the cross-sectional risk model weights by √(market cap)).
 * - simplexLs: least squares with weights >= 0 that sum to 1 (which mix of factor index funds tracks a
 *   portfolio), by accelerated projected gradient with an exact projection onto the simplex.
 */
import { tCdf } from "./core";
import { inverse, matmul, transpose, type Mat } from "./linalg";

export type OlsFit = {
  coef: number[]; se: number[]; seNw: number[]; t: number[]; tNw: number[]; pNw: number[];
  r2: number; adjR2: number; resid: number[]; fitted: number[]; n: number; k: number; nwLags: number; residSd: number;
};

/** The Newey-West lag rule of thumb, floor(4·(T/100)^(2/9)). */
export const nwLags = (T: number) => Math.floor(4 * Math.pow(T / 100, 2 / 9));

/**
 * y = X·b + e. `X` rows are observations; set `constant` to prepend a column of ones (its coefficient is first).
 */
export function ols(X: Mat, y: number[], opts: { constant?: boolean; lags?: number } = {}): OlsFit {
  const Z = opts.constant === false ? X : X.map((r) => [1, ...r]);
  const n = Z.length, k = Z[0]?.length ?? 0;
  if (n <= k) throw new Error("More regressors than observations");
  const Zt = transpose(Z);
  const inv = inverse(matmul(Zt, Z));
  if (!inv) throw new Error("The regressors are collinear");
  const Zty = Zt.map((r) => r.reduce((s, v, i) => s + v * y[i], 0));
  const coef = inv.map((r) => r.reduce((s, v, j) => s + v * Zty[j], 0));
  const fitted = Z.map((r) => r.reduce((s, v, j) => s + v * coef[j], 0));
  const resid = y.map((v, i) => v - fitted[i]);
  const sse = resid.reduce((s, e) => s + e * e, 0);
  const ym = y.reduce((s, v) => s + v, 0) / n;
  const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
  const sigma2 = sse / (n - k);
  const se = inv.map((r, i) => Math.sqrt(Math.max(0, sigma2 * r[i])));
  // Newey-West: meat = Σ_l w_l Σ_t (x_t e_t)(x_{t-l} e_{t-l})' (both directions), w_l = 1 - l/(L+1).
  const L = opts.lags ?? nwLags(n);
  const g = Z.map((r, t) => r.map((v) => v * resid[t]));
  const meat: Mat = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let l = 0; l <= L; l++) {
    const w = l === 0 ? 1 : 1 - l / (L + 1);
    for (let t = l; t < n; t++) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) {
      const v = g[t][i] * g[t - l][j];
      meat[i][j] += w * v;
      if (l > 0) meat[j][i] += w * v;
    }
  }
  const nw = matmul(matmul(inv, meat), inv);
  const seNw = nw.map((r, i) => Math.sqrt(Math.max(0, r[i])));
  const tNw = coef.map((c, i) => (seNw[i] > 0 ? c / seNw[i] : 0));
  const r2 = sst > 0 ? 1 - sse / sst : 0;
  return {
    coef, se, seNw, t: coef.map((c, i) => (se[i] > 0 ? c / se[i] : 0)), tNw, pNw: tNw.map((t) => 2 * (1 - tCdf(Math.abs(t), n - k))),
    r2, adjR2: 1 - ((1 - r2) * (n - 1)) / (n - k), resid, fitted, n, k, nwLags: L, residSd: Math.sqrt(sigma2),
  };
}

/** Weighted least squares: minimise Σ w_i (y_i - x_i·b)². No constant is added. */
export function wls(X: Mat, y: number[], w: number[]): { coef: number[]; resid: number[] } {
  const sw = w.map((v) => Math.sqrt(Math.max(v, 0)));
  const Xw = X.map((r, i) => r.map((v) => v * sw[i])), yw = y.map((v, i) => v * sw[i]);
  const Xt = transpose(Xw);
  const XtX = matmul(Xt, Xw);
  // A tiny ridge keeps dummy-heavy cross-sections solvable when an industry is empty on a day.
  for (let i = 0; i < XtX.length; i++) XtX[i][i] += 1e-10;
  const inv = inverse(XtX);
  if (!inv) throw new Error("The regressors are collinear");
  const Xty = Xt.map((r) => r.reduce((s, v, i) => s + v * yw[i], 0));
  const coef = inv.map((r) => r.reduce((s, v, j) => s + v * Xty[j], 0));
  return { coef, resid: X.map((r, i) => y[i] - r.reduce((s, v, j) => s + v * coef[j], 0)) };
}

/** Euclidean projection onto the probability simplex (Duchi, Shalev-Shwartz, Singer and Chandra 2008). */
export function projectSimplex(v: number[]): number[] {
  const u = [...v].sort((a, b) => b - a);
  let css = 0, rho = 0, theta = 0;
  for (let i = 0; i < u.length; i++) { css += u[i]; const t = (css - 1) / (i + 1); if (u[i] - t > 0) { rho = i; theta = t; } }
  void rho;
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * min ||y - X·w||² subject to w >= 0, Σw = 1. Returns the weights, the residuals and R² (share of y's variance
 * the mix tracks) and the tracking error (residual standard deviation).
 */
export function simplexLs(X: Mat, y: number[], iters = 4000): { weights: number[]; r2: number; trackingSd: number; resid: number[] } {
  const k = X[0]?.length ?? 0;
  const Xt = transpose(X);
  const Q = matmul(Xt, X);
  const c = Xt.map((r) => r.reduce((s, v, i) => s + v * y[i], 0));
  // Step 1/L with L the largest eigenvalue bound (Gershgorin) of 2Q.
  const Lc = 2 * Math.max(...Q.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)), 1e-12);
  let w = new Array<number>(k).fill(1 / k), z = [...w], tk = 1;
  for (let it = 0; it < iters; it++) {
    const grad = Q.map((r, i) => 2 * (r.reduce((s, v, j) => s + v * z[j], 0) - c[i]));
    const next = projectSimplex(z.map((v, i) => v - grad[i] / Lc));
    const tn = (1 + Math.sqrt(1 + 4 * tk * tk)) / 2;
    z = next.map((v, i) => v + ((tk - 1) / tn) * (v - w[i]));
    if (next.every((v, i) => Math.abs(v - w[i]) < 1e-13)) { w = next; break; }
    w = next; tk = tn;
  }
  const resid = y.map((v, i) => v - X[i].reduce((s, x, j) => s + x * w[j], 0));
  const ym = y.reduce((s, v) => s + v, 0) / y.length;
  const sst = y.reduce((s, v) => s + (v - ym) ** 2, 0), rm = resid.reduce((s, v) => s + v, 0) / resid.length;
  const sse = resid.reduce((s, v) => s + (v - rm) ** 2, 0);
  return { weights: w, r2: sst > 0 ? 1 - sse / sst : 0, trackingSd: Math.sqrt(sse / Math.max(1, resid.length - 1)), resid };
}
