/**
 * QF2 and Q4: Kelly sizing and its drawdown arithmetic. Pure; every output is "for the inputs entered".
 *
 * - kellyDiscrete: f* = p - (1 - p)/b for a bet paying b to 1 with win probability p.
 * - kellyContinuous: f* = (μ - r)/σ² for a lognormal asset (Merton's fraction).
 * - kellyMulti: f* = Σ⁻¹(μ - r) for several assets.
 * - growthShare: growth at fraction c of full Kelly is c(2 - c) of the maximum (Thorp).
 * - drawdownProb: P(wealth ever falls to x of its running peak) = x^(2/c - 1) at c of full Kelly under
 *   geometric Brownian motion (MacLean, Thorp and Ziemba).
 * - expectedLogGrowth / uncertainKelly: the fraction that maximises expected log growth averaged over the
 *   uncertainty in the edge, by Monte Carlo over its distribution.
 */
import { normals, rng } from "./core";
import { inverse, matvec, type Mat } from "./linalg";

export const kellyDiscrete = (p: number, b: number) => (b > 0 ? p - (1 - p) / b : 0);
export const kellyContinuous = (mu: number, sigma: number, r = 0) => (sigma > 0 ? (mu - r) / (sigma * sigma) : 0);

export function kellyMulti(mu: number[], cov: Mat, r = 0): number[] | null {
  const inv = inverse(cov);
  return inv ? matvec(inv, mu.map((m) => m - r)) : null;
}

/** Long-run growth at fraction c of full Kelly, as a share of full Kelly's growth (continuous model). */
export const growthShare = (c: number) => c * (2 - c);

/** Expected log growth per bet of a discrete bet at fraction f of wealth. */
export const discreteGrowth = (f: number, p: number, b: number) => (f >= 1 || f <= -1 / b ? -Infinity : p * Math.log(1 + b * f) + (1 - p) * Math.log(1 - f));

/** Continuous growth rate per year at fraction f: r + f(μ - r) - f²σ²/2. */
export const continuousGrowth = (f: number, mu: number, sigma: number, r = 0) => r + f * (mu - r) - (f * f * sigma * sigma) / 2;

/** P(ever falling to `x` of the running peak) at fraction `c` of full Kelly under GBM: x^(2/c - 1). */
export function drawdownProb(c: number, x: number): number {
  if (!(c > 0) || !(x > 0) || x >= 1) return x >= 1 ? 1 : 0;
  if (c >= 2) return 1;
  return Math.pow(x, 2 / c - 1);
}

export type UncertainKelly = { central: number; lowEnd: number; robust: number; curve: { fraction: number; growth: number }[]; draws: number; seed: number };

/**
 * Kelly with the edge's uncertainty left in. The edge (excess return μ - r) is uncertain: Normal(mean, sd),
 * as from a Sharpe ratio's bootstrap interval. For each candidate fraction f, expected log growth is averaged
 * over draws of the edge, so a fraction that is ruinous when the edge is smaller than hoped is penalised.
 * Returns full Kelly at the central estimate, at the low end (mean - 1.645 sd), and the robust fraction.
 */
export function uncertainKelly(edgeMean: number, edgeSd: number, sigma: number, opts: { draws?: number; seed?: number; maxFraction?: number } = {}): UncertainKelly {
  const draws = opts.draws ?? 4000, seed = opts.seed ?? 5;
  const central = kellyContinuous(edgeMean, sigma);
  const lowEnd = Math.max(0, kellyContinuous(edgeMean - 1.645 * edgeSd, sigma));
  const z = normals(rng(seed));
  const edges = Array.from({ length: draws }, () => edgeMean + edgeSd * z());
  const maxF = opts.maxFraction ?? Math.max(0.05, Math.min(4, 2 * Math.max(central, 0.05)));
  const curve: { fraction: number; growth: number }[] = [];
  let robust = 0, best = -Infinity;
  for (let i = 0; i <= 200; i++) {
    const f = (maxF * i) / 200;
    // E[f·edge - f²σ²/2] over the edge draws: the uncertainty enters through the mean, and through the
    // spread of outcomes once the per-draw growth is floored at ruin (log wealth cannot fall below -∞).
    let g = 0;
    for (const e of edges) g += f * e - (f * f * sigma * sigma) / 2;
    g /= draws;
    // A second-order penalty for estimation risk: Var(f·edge) halves expected log growth of a fraction chosen ex ante.
    g -= (f * f * edgeSd * edgeSd) / 2;
    curve.push({ fraction: f, growth: g });
    if (g > best) { best = g; robust = f; }
  }
  return { central, lowEnd, robust, curve, draws, seed };
}

/**
 * Simulated drawdown odds for a discrete bet sequence at fraction f: the share of `paths` runs of `bets` bets
 * whose wealth ever fell to `x` of its peak. A check on the closed form and a view for fat-tailed edges.
 */
export function simulateDrawdown(f: number, p: number, b: number, x: number, bets = 1000, paths = 2000, seed = 9): number {
  const u = rng(seed);
  let hit = 0;
  for (let k = 0; k < paths; k++) {
    let w = 1, peak = 1;
    for (let t = 0; t < bets; t++) {
      w *= u() < p ? 1 + b * f : 1 - f;
      if (w > peak) peak = w;
      if (w <= x * peak) { hit++; break; }
    }
  }
  return hit / paths;
}
