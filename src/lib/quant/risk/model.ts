/**
 * Q2, the risk model and stress tests: pure maths over aligned daily returns.
 *
 * - covariance: a factor model Σ = B·F·Bᵀ + D (betas from each holding's regression on the factors, F with
 *   exponential weights, half-life 90 days, D the residual variances shrunk 30% toward their median), and
 *   Ledoit-Wolf shrinkage of the sample covariance for holdings without enough history for a factor fit.
 * - decompose: total volatility, each holding's and each factor's share of variance, and specific risk.
 * - var: one- and ten-day 95% and 99% VaR and ES by filtered historical simulation (EWMA-scaled history) and
 *   by Cornish-Fisher; the portfolio's own exceptions over two years with Kupiec's and Christoffersen's tests,
 *   and figures widened by observed over expected exceptions when the model fails its backtest.
 * - replay: a historical window's loss, actual where a holding traded then, otherwise through its factor
 *   betas plus resampled specific moves (the proxied holdings are named), as a range across paths.
 * - shock: stated factor moves fixed, the others filled by their conditional mean and spread given the stated
 *   ones, losses as a distribution across paths.
 * - reverse: the gentlest factor scenario (smallest Mahalanobis distance) that loses a chosen amount, in closed
 *   form for a linear factor model: f* = -L·S·b / (bᵀ·S·b).
 * - drawdownOdds: P(a 10%, 20%, 30% fall from peak within a year) from stationary-bootstrap years.
 * Every simulated figure states its seed and number of paths.
 */
import { stationaryIndices } from "../stats/bootstrap";
import { chi2Cdf, mean, moments, normInv, normals, quantile, rng } from "../stats/core";
import { cholesky, eigSym, inverse, matmul, matvec, transpose, type Mat } from "../stats/linalg";
import { ols } from "../stats/regress";
import { ledoitWolf } from "../stats/shrink";

export type Fit = { symbol: string; alpha: number; betas: number[]; residVar: number; r2: number; resid: number[] };

/** Exponentially weighted covariance (rows = days, oldest first). Pure. */
export function ewmaCov(R: number[][], halfLife = 90): Mat {
  const T = R.length, K = R[0]?.length ?? 0;
  const lam = Math.pow(0.5, 1 / halfLife);
  const w = R.map((_, t) => Math.pow(lam, T - 1 - t));
  const ws = w.reduce((a, b) => a + b, 0);
  const mu = Array.from({ length: K }, (_, k) => R.reduce((s, r, t) => s + w[t] * r[k], 0) / ws);
  return Array.from({ length: K }, (_, a) => Array.from({ length: K }, (_, b) => R.reduce((s, r, t) => s + w[t] * (r[a] - mu[a]) * (r[b] - mu[b]), 0) / ws));
}

/** Regress each holding on the factors. `Y` is days x holdings, `F` days x factors. Pure. */
export function fitHoldings(symbols: string[], Y: number[][], F: number[][]): Fit[] {
  return symbols.map((s, j) => {
    const y = Y.map((r) => r[j]);
    const f = ols(F, y, { lags: 0 });
    const resid = f.resid;
    return { symbol: s, alpha: f.coef[0], betas: f.coef.slice(1), residVar: resid.reduce((a, e) => a + e * e, 0) / Math.max(1, resid.length - F[0].length - 1), r2: f.r2, resid };
  });
}

export type CovModel = { cov: Mat; B: Mat; F: Mat; D: number[]; method: string; shrinkage: number };

/** The combined covariance: factor model where every holding has a fit, Ledoit-Wolf otherwise. Pure. */
export function covariance(Y: number[][], Fr: number[][] | null, symbols: string[]): CovModel {
  const lw = ledoitWolf(Y);
  if (!Fr || Fr.length < 120 || Fr.length !== Y.length) return { cov: lw.cov, B: [], F: [], D: lw.cov.map((r, i) => r[i]), method: `Ledoit-Wolf shrinkage of the sample covariance (intensity ${lw.shrinkage.toFixed(2)})`, shrinkage: lw.shrinkage };
  const fits = fitHoldings(symbols, Y, Fr);
  const F = ewmaCov(Fr, 90);
  const B = fits.map((f) => f.betas);
  const med = quantile(fits.map((f) => f.residVar), 0.5);
  const D = fits.map((f) => 0.7 * f.residVar + 0.3 * med);
  const BF = matmul(B, F);
  const cov = matmul(BF, transpose(B)).map((r, i) => r.map((v, j) => v + (i === j ? D[i] : 0)));
  if (!cholesky(cov)) return { cov: lw.cov, B: [], F: [], D: lw.cov.map((r, i) => r[i]), method: "Ledoit-Wolf (the factor model was not positive definite)", shrinkage: lw.shrinkage };
  return { cov, B, F, D, method: "Factor model: betas on the factors over the window, factor covariance with a 90-day half-life, specific variances shrunk 30% toward their median", shrinkage: 0.3 };
}

export type Decomposition = { volAnnual: number; holdings: { symbol: string; weight: number; share: number }[]; factors: { factor: string; exposure: number; share: number }[]; specificShare: number; top3Share: number };

/** Volatility and risk shares w_i(Σw)_i / wᵀΣw, factor shares from b = Bᵀw. Pure. */
export function decompose(symbols: string[], w: number[], m: CovModel, factorNames: string[]): Decomposition {
  const sw = matvec(m.cov, w);
  const v = w.reduce((s, wi, i) => s + wi * sw[i], 0);
  const holdings = symbols.map((s, i) => ({ symbol: s, weight: w[i], share: v > 0 ? (w[i] * sw[i]) / v : 0 }));
  let factors: Decomposition["factors"] = [], specificShare = 0;
  if (m.B.length) {
    const b = factorNames.map((_, k) => w.reduce((s, wi, i) => s + wi * m.B[i][k], 0));
    const Fb = matvec(m.F, b);
    factors = factorNames.map((f, k) => ({ factor: f, exposure: b[k], share: v > 0 ? (b[k] * Fb[k]) / v : 0 }));
    specificShare = v > 0 ? w.reduce((s, wi, i) => s + wi * wi * m.D[i], 0) / v : 0;
  }
  const top3Share = [...holdings].sort((a, b) => b.share - a.share).slice(0, 3).reduce((s, h) => s + h.share, 0);
  return { volAnnual: Math.sqrt(Math.max(v, 0) * 252), holdings, factors, specificShare, top3Share };
}

/* ---------------- Value at risk ---------------- */

/** Filtered historical simulation: returns rescaled by EWMA volatility then and now (λ = 0.94). Pure. */
export function fhsScenarios(r: number[], lambda = 0.94): { scaled: number[]; sigmaNow: number } {
  let v = r.slice(0, 20).reduce((s, x) => s + x * x, 0) / Math.min(20, r.length);
  const sig: number[] = [];
  for (const x of r) { sig.push(Math.sqrt(v)); v = lambda * v + (1 - lambda) * x * x; }
  const now = Math.sqrt(v);
  return { scaled: r.map((x, t) => (sig[t] > 0 ? (x / sig[t]) * now : x)), sigmaNow: now };
}

/** Cornish-Fisher VaR (a positive loss) at `level` from moments of daily returns. Pure. */
export function cornishFisherVar(r: number[], level: number, horizon = 1): number {
  const m = moments(r);
  const z = normInv(1 - level), s = m.skew, k = m.kurt - 3;
  const zc = z + ((z * z - 1) * s) / 6 + ((z ** 3 - 3 * z) * k) / 24 - ((2 * z ** 3 - 5 * z) * s * s) / 36;
  return -(m.mean * horizon + m.std * Math.sqrt(horizon) * zc);
}

/** Christoffersen's independence test on an exception sequence (1 = loss beyond VaR). p-value, chi-squared with 1 df. Pure. */
export function christoffersen(hits: number[]): { lr: number; pValue: number } {
  let n00 = 0, n01 = 0, n10 = 0, n11 = 0;
  for (let t = 1; t < hits.length; t++) { const a = hits[t - 1], b = hits[t]; if (!a && !b) n00++; else if (!a && b) n01++; else if (a && !b) n10++; else n11++; }
  const p01 = n01 / Math.max(1, n00 + n01), p11 = n11 / Math.max(1, n10 + n11), p = (n01 + n11) / Math.max(1, n00 + n01 + n10 + n11);
  const ll = (x: number, n: number) => (n > 0 && x > 0 ? n * Math.log(x) : 0);
  const l0 = ll(1 - p, n00 + n10) + ll(p, n01 + n11);
  const l1 = ll(1 - p01, n00) + ll(p01, n01) + ll(1 - p11, n10) + ll(p11, n11);
  const lr = Math.max(0, -2 * (l0 - l1));
  return { lr, pValue: 1 - chi2Cdf(lr, 1) };
}

/** Kupiec's proportion-of-failures test. Pure. */
export function kupiec(exceptions: number, n: number, level: number): { lr: number; pValue: number; expected: number } {
  const p = 1 - level, x = exceptions, phat = x / Math.max(1, n);
  const ll = (q: number) => (n - x > 0 ? (n - x) * Math.log(1 - q) : 0) + (x > 0 ? x * Math.log(q) : 0);
  const lr = Math.max(0, -2 * (ll(p) - (phat > 0 && phat < 1 ? ll(phat) : 0)));
  return { lr, pValue: 1 - chi2Cdf(lr, 1), expected: n * p };
}

export type VarRow = { horizon: 1 | 10; level: 0.95 | 0.99; varFhs: number; esFhs: number; varCf: number };
export type VarResult = { rows: VarRow[]; backtest: { days: number; exceptions: number; expected: number; kupiecP: number; christoffersenP: number; pass: boolean; widenedBy: number }; paths: number; seed: number };

/**
 * VaR and ES (positive losses) at 1 and 10 days, 95% and 99%, plus the 1-day 95% backtest over the last
 * `backtestDays` (each day's VaR from the 500 days before it). Pure.
 */
export function valueAtRisk(r: number[], opts: { paths?: number; seed?: number; backtestDays?: number; levels?: (0.95 | 0.99)[]; horizons?: (1 | 10)[] } = {}): VarResult {
  const paths = opts.paths ?? 2_000, seed = opts.seed ?? 31, bd = Math.min(opts.backtestDays ?? 500, Math.max(0, r.length - 250));
  const { scaled } = fhsScenarios(r);
  const u = rng(seed);
  const tenDay = Array.from({ length: paths }, () => { let s = 0; const idx = stationaryIndices(scaled.length, 5, u); for (let k = 0; k < 10; k++) s += scaled[idx[k]]; return s; });
  const levels = opts.levels ?? [0.95, 0.99], horizons = opts.horizons ?? [1, 10];
  const tail = (xs: number[], level: number) => { const q = quantile(xs, 1 - level); const t = xs.filter((x) => x <= q); return { v: -q, es: -(t.length ? mean(t) : q) }; };
  // Backtest: one-day 95% FHS VaR from the trailing 500 days, against the next day's return.
  const hits: number[] = [];
  for (let t = r.length - bd; t < r.length; t++) {
    const hist = r.slice(Math.max(0, t - 500), t);
    if (hist.length < 120) continue;
    const s = fhsScenarios(hist).scaled;
    hits.push(r[t] < quantile(s, 0.05) ? 1 : 0);
  }
  const exceptions = hits.reduce((a, b) => a + b, 0);
  const kp = kupiec(exceptions, hits.length, 0.95), cp = christoffersen(hits);
  const pass = !(kp.pValue < 0.05 && exceptions > kp.expected) && cp.pValue >= 0.01;
  const widenedBy = pass ? 1 : Math.max(1, exceptions / Math.max(1e-9, kp.expected));
  const rows: VarRow[] = [];
  for (const h of horizons) for (const l of levels) {
    const t = tail(h === 1 ? scaled : tenDay, l);
    rows.push({ horizon: h, level: l, varFhs: t.v * widenedBy, esFhs: t.es * widenedBy, varCf: cornishFisherVar(r, l, h) * widenedBy });
  }
  return { rows, backtest: { days: hits.length, exceptions, expected: kp.expected, kupiecP: kp.pValue, christoffersenP: cp.pValue, pass, widenedBy }, paths, seed };
}

/* ---------------- Stress ---------------- */

export type Replay = { key: string; label: string; from: string; to: string; note: string };
export const REPLAYS: Replay[] = [
  { key: "2008", label: "2008 financial crisis", from: "2008-09-02", to: "2008-11-20", note: "Lehman's failure to the November 2008 low" },
  { key: "2020", label: "March 2020", from: "2020-02-19", to: "2020-03-23", note: "The pandemic crash, peak to trough" },
  { key: "2022", label: "2022 rate shock", from: "2022-01-03", to: "2022-10-12", note: "The 10-year yield up about 2.5 points, stocks down a quarter" },
  { key: "2000", label: "2000-2002 technology bust", from: "2000-03-24", to: "2002-10-09", note: "The S&P 500's peak to its low" },
  { key: "2007q", label: "August 2007 quant quake", from: "2007-08-06", to: "2007-08-10", note: "Crowded quant equity positions unwound together" },
];

export type StressResult = { key: string; label: string; from: string; to: string; mid: number; low: number; high: number; proxied: string[]; actual: string[]; missing: string[]; paths: number; seed: number };

/**
 * One replay. `actual` maps a holding to its real cumulative return over the window; `proxy` gives, for
 * holdings without prices then, their betas on the factors available in the window and the factors'
 * cumulative returns, with daily residuals to resample. Losses are positive numbers. Pure.
 */
export function replayLoss(r: Replay, holdings: { symbol: string; weight: number }[], actual: Map<string, number>, proxy: Map<string, { betas: number[]; resid: number[] }>, factorMoves: number[], days: number, paths: number, seed: number): StressResult {
  const u = rng(seed);
  const outcomes: number[] = [];
  const proxied = holdings.filter((h) => !actual.has(h.symbol) && proxy.has(h.symbol)).map((h) => h.symbol);
  const missing = holdings.filter((h) => !actual.has(h.symbol) && !proxy.has(h.symbol)).map((h) => h.symbol);
  const wsum = holdings.filter((h) => !missing.includes(h.symbol)).reduce((s, h) => s + h.weight, 0) || 1;
  for (let p = 0; p < paths; p++) {
    let port = 0;
    for (const h of holdings) {
      if (missing.includes(h.symbol)) continue;
      let ret: number;
      const a = actual.get(h.symbol);
      if (a !== undefined) ret = a;
      else {
        const x = proxy.get(h.symbol)!;
        const sys = x.betas.reduce((s, b, k) => s + b * factorMoves[k], 0);
        let spec = 0;
        if (x.resid.length) { const idx = stationaryIndices(x.resid.length, 5, u); for (let k = 0; k < days; k++) spec += x.resid[idx[k % idx.length]]; }
        ret = Math.exp(sys + spec) - 1;
      }
      port += (h.weight / wsum) * ret;
    }
    outcomes.push(-port);
    if (!proxied.length) break; // deterministic when every holding traded then
  }
  return { key: r.key, label: r.label, from: r.from, to: r.to, mid: quantile(outcomes, 0.5), low: quantile(outcomes, 0.05), high: quantile(outcomes, 0.95), proxied, actual: [...actual.keys()].filter((s) => holdings.some((h) => h.symbol === s)), missing, paths: proxied.length ? paths : 1, seed };
}

export type ShockSpec = { text: string; moves: Record<string, number> };

/** Read "market -20%, rates +1, momentum -15%" into factor moves (rates in percentage points of yield). Pure. */
export function parseShock(text: string): { spec: ShockSpec; leftover: string[] } {
  const names: [RegExp, string][] = [[/^(market|s&p|stocks|spx|mkt)$/i, "MKT"], [/^(size|small|smb)$/i, "SMB"], [/^(value|hml)$/i, "HML"], [/^(momentum|mom)$/i, "MOM"], [/^(quality|qmj|profitability)$/i, "QMJ"], [/^(low ?vol(atility)?|lvol)$/i, "LVOL"], [/^(rates?|yields?|10-?year|treasur(y|ies))$/i, "RATES"]];
  const moves: Record<string, number> = {};
  const leftover: string[] = [];
  for (const part of text.split(/[,;]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = /^(.+?)\s*([+-]\s*\d+(?:\.\d+)?)\s*(%|pts?|points?|bp|bps)?$/i.exec(part);
    const hit = m && names.find(([re]) => re.test(m[1].trim()));
    if (!m || !hit) { leftover.push(part); continue; }
    const v = Number(m[2].replace(/\s+/g, ""));
    const unit = (m[3] ?? "").toLowerCase();
    if (hit[1] === "RATES") moves.RATES = unit.startsWith("bp") ? v / 100 : v; // percentage points of yield
    else moves[hit[1]] = v / 100;
  }
  return { spec: { text, moves }, leftover };
}

/** A yield change in points as the rates factor's return: a 7.5-year duration Treasury fund (IEF) minus bills. */
export const ratesToReturn = (points: number) => -0.075 * points;

export type ShockResult = { text: string; fixed: Record<string, number>; filled: Record<string, { mean: number; sd: number }>; mid: number; low: number; high: number; paths: number; seed: number; factorOnly: number };

/**
 * A hypothetical shock over `horizon` days: stated factors fixed (log moves), the others drawn from their
 * conditional distribution given them (Gaussian, from the factor covariance scaled to the horizon), each
 * holding's specific risk added. Losses positive. Pure.
 */
export function shockLoss(spec: ShockSpec, names: string[], Fdaily: Mat, B: Mat, D: number[], w: number[], horizon: number, paths: number, seed: number): ShockResult {
  const S = Fdaily.map((r) => r.map((v) => v * horizon));
  const stated = names.map((n, k) => (n in spec.moves ? k : -1)).filter((k) => k >= 0);
  const free = names.map((_, k) => k).filter((k) => !stated.includes(k));
  const x = names.map((n) => (n in spec.moves ? Math.log(1 + (n === "RATES" ? ratesToReturn(spec.moves[n]) : spec.moves[n])) : 0));
  // Conditional mean and covariance of the free factors: μ_f = S_fs S_ss⁻¹ x_s, Σ = S_ff - S_fs S_ss⁻¹ S_sf.
  const Sss = stated.map((i) => stated.map((j) => S[i][j])), Sfs = free.map((i) => stated.map((j) => S[i][j]));
  const inv = stated.length ? inverse(Sss) : [];
  const xs = stated.map((k) => x[k]);
  const invx = inv && stated.length ? matvec(inv, xs) : [];
  const muF = free.map((_, a) => Sfs[a].reduce((s, v, j) => s + v * (invx[j] ?? 0), 0));
  const condCov = free.map((i, a) => free.map((j, b) => S[i][j] - (inv ? Sfs[a].reduce((s, v, k) => s + v * inv[k].reduce((t, c, l) => t + c * Sfs[b][l], 0), 0) : 0)));
  const L = free.length ? cholesky(condCov.map((r, i) => r.map((v, j) => v + (i === j ? 1e-12 : 0)))) ?? condCov.map((r, i) => r.map((_, j) => (i === j ? Math.sqrt(Math.max(condCov[i][i], 0)) : 0))) : [];
  const z = normals(rng(seed));
  const outcomes: number[] = [];
  const b = names.map((_, k) => w.reduce((s, wi, i) => s + wi * (B[i]?.[k] ?? 0), 0));
  const fixedPart = stated.reduce((s, k) => s + b[k] * x[k], 0);
  const factorOnly = Math.exp(fixedPart + free.reduce((s, k, a) => s + b[k] * muF[a], 0)) - 1;
  for (let p = 0; p < paths; p++) {
    const e = free.map(() => z());
    const ff = free.map((_, a) => muF[a] + L[a].reduce((s, l, j) => s + l * e[j], 0));
    let port = 0;
    for (let i = 0; i < w.length; i++) {
      const sys = stated.reduce((s, k) => s + (B[i]?.[k] ?? 0) * x[k], 0) + free.reduce((s, k, a) => s + (B[i]?.[k] ?? 0) * ff[a], 0);
      port += w[i] * (Math.exp(sys + Math.sqrt(Math.max(D[i], 0) * horizon) * z()) - 1);
    }
    outcomes.push(-port);
  }
  return {
    text: spec.text, fixed: Object.fromEntries(stated.map((k) => [names[k], spec.moves[names[k]]])),
    filled: Object.fromEntries(free.map((k, a) => [names[k], { mean: Math.exp(muF[a]) - 1, sd: Math.sqrt(Math.max(condCov[a][a], 0)) }])),
    mid: quantile(outcomes, 0.5), low: quantile(outcomes, 0.05), high: quantile(outcomes, 0.95), paths, seed, factorOnly: -factorOnly,
  };
}

export type Reverse = { loss: number; horizon: number; moves: Record<string, number>; radius: number; percentile: number; verdict: "plausible" | "severe" | "extreme"; note: string };

/**
 * The gentlest factor scenario that loses `loss` (0.25 = 25%) over `horizon` days through the portfolio's
 * factor exposures b: minimise fᵀS⁻¹f subject to bᵀf = ln(1 - loss); f* = c·S·b / (bᵀ·S·b). Its Mahalanobis
 * radius gives how unusual it is (chi-squared percentile with as many degrees of freedom as factors). Pure.
 */
export function reverseStress(names: string[], Fdaily: Mat, b: number[], loss: number, horizon: number): Reverse | null {
  const S = Fdaily.map((r) => r.map((v) => v * horizon));
  const Sb = matvec(S, b);
  const q = b.reduce((s, v, k) => s + v * Sb[k], 0);
  if (!(q > 0)) return null;
  const c = Math.log(1 - loss);
  const f = Sb.map((v) => (c * v) / q);
  const radius = Math.sqrt((c * c) / q);
  const pct = chi2Cdf(radius * radius, names.length);
  const verdict = radius < 2 ? "plausible" : radius < 3.5 ? "severe" : "extreme";
  return { loss, horizon, moves: Object.fromEntries(names.map((n, k) => [n, Math.exp(f[k]) - 1])), radius, percentile: pct, verdict, note: "Factor moves only: the holdings' own news adds to (or offsets) this. The scenario is the closest to normal, in the factors' own covariance, that produces the loss." };
}

/** P(a fall of at least x from peak within a year) from stationary-bootstrap years of daily returns. Pure. */
export function drawdownOdds(r: number[], levels = [0.1, 0.2, 0.3], years = 2_000, seed = 19): { level: number; probability: number }[] {
  const u = rng(seed);
  const hits = levels.map(() => 0);
  for (let y = 0; y < years; y++) {
    const idx = stationaryIndices(r.length, 10, u);
    let w = 1, peak = 1, worst = 0;
    for (let d = 0; d < 252; d++) { w *= 1 + r[idx[d % idx.length]]; if (w > peak) peak = w; worst = Math.max(worst, 1 - w / peak); }
    levels.forEach((l, k) => { if (worst >= l) hits[k]++; });
  }
  return levels.map((l, k) => ({ level: l, probability: hits[k] / years }));
}

/** Days to exit a position at `participation` of average daily dollar volume. Pure. */
export const daysToExit = (positionUsd: number, advUsd: number, participation = 0.2) => (advUsd > 0 ? positionUsd / (participation * advUsd) : Infinity);

export { eigSym };
