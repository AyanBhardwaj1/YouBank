/**
 * QF2: how much a backtest's Sharpe ratio can be trusted, given its length, its fat tails and how many
 * strategies were tried to find it. Pure; every function is checked against a known answer in
 * scripts/test-quant.ts.
 *
 * - psr: the probabilistic Sharpe ratio (Bailey and López de Prado 2012).
 * - expectedMaxSharpe and dsr: the deflated Sharpe ratio (Bailey and López de Prado 2014).
 * - minTrl: the minimum track record length (Bailey and López de Prado 2012).
 * - effectiveTrials: the number of independent trials behind a set of correlated ones.
 * - haircutSharpe: Harvey and Liu (2015) multiple-testing haircuts, and the t-above-3 rule (Harvey, Liu
 *   and Zhu 2016).
 * All Sharpe ratios here are per period (daily for daily returns) unless a name says annual.
 */
import { corr, EULER_GAMMA, moments, normCdf, normInv, normSf, tCdf, type Moments } from "./core";
import { bonferroni, bhy, holm } from "./multiple";

/** The standard error term of the Sharpe ratio under non-normal returns: 1 - γ3·SR + (γ4 - 1)/4·SR². */
const sharpeVarianceTerm = (sr: number, skew: number, kurt: number) => Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr);

/**
 * PSR(SR*) = Φ((SR - SR*)·√(n - 1) / √(1 - γ3·SR + (γ4 - 1)/4·SR²)): the probability that the true per-period
 * Sharpe ratio exceeds `srStar`, given the observed one, the sample size, skewness and (non-excess) kurtosis.
 */
export function psrFromStats(sr: number, n: number, skew: number, kurt: number, srStar = 0): number {
  if (!(n > 1) || !Number.isFinite(sr)) return NaN;
  return normCdf(((sr - srStar) * Math.sqrt(n - 1)) / Math.sqrt(sharpeVarianceTerm(sr, skew, kurt)));
}

export function psr(returns: ArrayLike<number>, srStar = 0): number {
  const m = moments(returns);
  return psrFromStats(m.mean / m.std, m.n, m.skew, m.kurt, srStar);
}

/**
 * The Sharpe ratio the best of N independent trials would reach by luck alone:
 * √V·((1 - γ)·Φ⁻¹(1 - 1/N) + γ·Φ⁻¹(1 - 1/(N·e))), γ the Euler-Mascheroni constant, V the variance of the
 * trials' Sharpe ratios (in the same units as the result).
 */
export function expectedMaxSharpe(trials: number, sharpeVariance: number): number {
  if (!(trials > 1) || !(sharpeVariance > 0)) return 0;
  return Math.sqrt(sharpeVariance) * ((1 - EULER_GAMMA) * normInv(1 - 1 / trials) + EULER_GAMMA * normInv(1 - 1 / (trials * Math.E)));
}

export type Dsr = { dsr: number; srStar: number; sr: number; n: number; trials: number; sharpeVariance: number };

/**
 * The deflated Sharpe ratio: PSR against SR* = expectedMaxSharpe(N, V). `sr` and the variance are per period.
 * With one trial there is nothing to deflate, so DSR equals PSR against zero.
 */
export function dsrFromStats(sr: number, n: number, skew: number, kurt: number, trials: number, sharpeVariance: number): Dsr {
  const srStar = trials > 1 ? expectedMaxSharpe(trials, sharpeVariance) : 0;
  return { dsr: psrFromStats(sr, n, skew, kurt, srStar), srStar, sr, n, trials, sharpeVariance };
}

/** DSR of a return series, given the per-period Sharpe ratios of every trial in its family (itself included). */
export function dsr(returns: ArrayLike<number>, trialSharpes: number[], effectiveN?: number): Dsr {
  const m = moments(returns);
  const xs = trialSharpes.filter(Number.isFinite);
  const mu = xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
  const v = xs.length > 1 ? xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1) : 0;
  return dsrFromStats(m.mean / m.std, m.n, m.skew, m.kurt, effectiveN ?? xs.length, v);
}

/**
 * Minimum track record length in periods: 1 + (1 - γ3·SR + (γ4 - 1)/4·SR²)·(Φ⁻¹(1 - α) / (SR - SR*))².
 * Infinite when the observed Sharpe ratio does not exceed SR*. At n = minTrl, PSR(SR*) = 1 - α exactly.
 */
export function minTrlFromStats(sr: number, skew: number, kurt: number, srStar = 0, alpha = 0.05): number {
  if (!(sr > srStar)) return Infinity;
  return 1 + sharpeVarianceTerm(sr, skew, kurt) * (normInv(1 - alpha) / (sr - srStar)) ** 2;
}

export function minTrl(returns: ArrayLike<number>, srStar = 0, alpha = 0.05): number {
  const m = moments(returns);
  return minTrlFromStats(m.mean / m.std, m.skew, m.kurt, srStar, alpha);
}

/* ---------------- Effective number of trials ---------------- */

export type EffectiveTrials = { raw: number; effective: number; clusters: number[][]; silhouette: number | null; threshold: number };

/**
 * N for the DSR when trials are correlated: average-linkage hierarchical clustering of the trials' return
 * correlations, cut where clusters stop being correlated above `threshold` (0.5), with distance √(½(1 - ρ)).
 * The silhouette (Rousseeuw 1987) of the result says how well separated the clusters are; it is reported
 * beside both N's. The effective N never exceeds the raw count.
 * `series` are the trials' return series, aligned (same dates, same length).
 */
export function effectiveTrials(series: number[][], threshold = 0.5): EffectiveTrials {
  const n = series.length;
  if (n <= 1) return { raw: n, effective: n, clusters: n ? [[0]] : [], silhouette: null, threshold };
  const R: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const c = corr(series[i], series[j]); R[i][j] = R[j][i] = Number.isFinite(c) ? c : 0; }
  return effectiveTrialsFromCorrelation(R, threshold);
}

export function effectiveTrialsFromCorrelation(R: number[][], threshold = 0.5): EffectiveTrials {
  const n = R.length;
  const D = R.map((r) => r.map((c) => Math.sqrt(Math.max(0, 0.5 * (1 - c)))));
  const cut = Math.sqrt(0.5 * (1 - threshold));
  let clusters = Array.from({ length: n }, (_, i) => [i]);
  for (;;) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      let s = 0;
      for (const a of clusters[i]) for (const b of clusters[j]) s += D[a][b];
      const d = s / (clusters[i].length * clusters[j].length);
      if (d < best) { best = d; bi = i; bj = j; }
    }
    if (bi < 0 || best > cut) break;
    clusters = [...clusters.filter((_, k) => k !== bi && k !== bj), [...clusters[bi], ...clusters[bj]]];
  }
  clusters = clusters.map((c) => c.sort((a, b) => a - b)).sort((a, b) => a[0] - b[0]);
  return { raw: n, effective: Math.min(n, clusters.length), clusters, silhouette: silhouette(D, clusters), threshold };
}

/** Mean silhouette width of a clustering under a distance matrix; null when it is undefined (one cluster, or all singletons). */
export function silhouette(D: number[][], clusters: number[][]): number | null {
  if (clusters.length < 2 || clusters.length === D.length) return null;
  const of = new Map<number, number>();
  clusters.forEach((c, k) => c.forEach((i) => of.set(i, k)));
  let total = 0;
  for (let i = 0; i < D.length; i++) {
    const own = clusters[of.get(i)!];
    if (own.length === 1) continue; // s(i) = 0 by convention
    const a = own.filter((j) => j !== i).reduce((s, j) => s + D[i][j], 0) / (own.length - 1);
    let b = Infinity;
    clusters.forEach((c, k) => { if (k !== of.get(i)) b = Math.min(b, c.reduce((s, j) => s + D[i][j], 0) / c.length); });
    total += (b - a) / Math.max(a, b, 1e-12);
  }
  return total / D.length;
}

/* ---------------- Multiple-testing haircuts ---------------- */

export type Haircut = { method: "bonferroni" | "holm" | "bhy"; pSingle: number; pAdjusted: number; sharpeAdjusted: number; haircut: number; tStat: number };

/**
 * Harvey and Liu (2015): the annualised Sharpe ratio `sr` over `years` has t = SR·√years; its single-test
 * p-value is adjusted for `trials` tests, then turned back into a Sharpe ratio. Only the best strategy's
 * p-value is known here, so the others are taken as no more significant (Holm then equals Bonferroni for
 * the best; BHY uses the c(M) = Σ 1/i correction). Returns the adjusted Sharpe and the haircut (share lost).
 */
export function haircutSharpe(sr: number, years: number, trials: number, method: Haircut["method"] = "bhy"): Haircut {
  const t = sr * Math.sqrt(Math.max(years, 0));
  const pSingle = Math.min(1, 2 * normSf(Math.abs(t)));
  const m = Math.max(1, Math.round(trials));
  const ps = [pSingle, ...new Array<number>(m - 1).fill(1)];
  const pAdjusted = method === "bonferroni" ? bonferroni(ps)[0] : method === "holm" ? holm(ps)[0] : bhy(ps)[0];
  const tAdj = pAdjusted >= 1 ? 0 : normInv(1 - pAdjusted / 2);
  const sharpeAdjusted = Math.sign(sr) * Math.min(Math.abs(sr), years > 0 ? tAdj / Math.sqrt(years) : 0);
  return { method, pSingle, pAdjusted, sharpeAdjusted, haircut: sr !== 0 ? 1 - sharpeAdjusted / sr : 0, tStat: t };
}

/** The "t above 3" rule for a newly tried factor or strategy (Harvey, Liu and Zhu 2016). */
export const passesT3 = (annualSharpe: number, years: number) => annualSharpe * Math.sqrt(years) > 3;

/* ---------------- Sharpe ratio intervals and the trials curve ---------------- */

/** The asymptotic standard error of a per-period Sharpe ratio (Mertens 2002, as used by the PSR). */
export const sharpeSe = (m: Pick<Moments, "n" | "skew" | "kurt">, sr: number) => Math.sqrt(sharpeVarianceTerm(sr, m.skew, m.kurt) / Math.max(1, m.n - 1));

/**
 * The curve "the best of N random strategies would show this Sharpe by chance", annualised, for a strategy
 * family whose trials have per-period Sharpe variance `v` (default: the variance of a zero-skill Sharpe over
 * n periods, 1/(n - 1)).
 */
export function bestOfNCurve(nObs: number, periodsPerYear = 252, v?: number, points = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]): { trials: number; sharpe: number }[] {
  const variance = v ?? 1 / Math.max(1, nObs - 1);
  return points.map((k) => ({ trials: k, sharpe: expectedMaxSharpe(Math.max(k, 1), variance) * Math.sqrt(periodsPerYear) }));
}

/** Two-sided p-value of a mean being zero from a t statistic with n - 1 degrees of freedom. */
export const meanPValue = (t: number, n: number) => 2 * (1 - tCdf(Math.abs(t), Math.max(1, n - 1)));
