/**
 * Strict mode's line (E2): the support score above which shown claims meet a stated unsupported-claim
 * rate, chosen on held-out labelled claims (conformal factuality, after Mohri and Hashimoto 2024).
 *
 * The line is found by fixed-sequence testing from the top: walk down the calibration claims from the
 * highest score (starting once enough claims are above the line for the test to pass at all), and keep lowering the line while the 95% Clopper-Pearson upper bound on the unsupported
 * share above it stays at or under alpha; stop at the first failure. With probability at least 95% over the
 * calibration draw, the unsupported share above the line is at most alpha on new claims like these (the
 * guarantee assumes new claims resemble the calibration set, which is why the set and its version are
 * printed with every Strict answer). Pure.
 */
import { ibetaInv } from "../scen/stats";

/** The one-sided 95% (by default) Clopper-Pearson upper bound on a rate of k in n. Pure. */
export function upperBound(k: number, n: number, confidence = 0.95): number {
  if (n <= 0) return 1;
  if (k >= n) return 1;
  return ibetaInv(confidence, k + 1, n - k);
}

/**
 * The lowest score line that controls the unsupported share at alpha, or null when even the single
 * highest-scoring claims cannot (too few calibration claims for that alpha). Ties stay together. Pure.
 */
export function strictThreshold(scores: number[], supported: number[], alpha: number, confidence = 0.95): number | null {
  const xs = scores.map((s, i) => ({ s, ok: supported[i] >= 0.5 })).filter((x) => Number.isFinite(x.s)).sort((a, b) => b.s - a.s);
  // The sequence of tests starts at the first line with enough claims above it to pass at all (n0 claims, all
  // supported, meet the bound); lines above that are never tested, so they cannot end the walk early.
  const n0 = Math.ceil(Math.log(1 - confidence) / Math.log(1 - alpha));
  let tau: number | null = null, n = 0, bad = 0;
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j < xs.length && xs[j].s === xs[i].s) { n++; if (!xs[j].ok) bad++; j++; }
    if (n >= n0) {
      if (upperBound(bad, n, confidence) > alpha) break;
      tau = xs[i].s;
    }
    i = j;
  }
  return tau;
}

/** The share of claims at or above a line that were unsupported, with how many there were. Pure. */
export function rateAbove(scores: number[], supported: number[], tau: number): { n: number; unsupported: number; rate: number } {
  let n = 0, bad = 0;
  scores.forEach((s, i) => { if (s >= tau) { n++; if (supported[i] < 0.5) bad++; } });
  return { n, unsupported: bad, rate: n ? bad / n : NaN };
}

/** The levels Strict offers: 5% by default, with 2% and 10%. */
export const ALPHAS = [0.02, 0.05, 0.1] as const;
export type Alpha = (typeof ALPHAS)[number];
export const DEFAULT_ALPHA: Alpha = 0.05;
