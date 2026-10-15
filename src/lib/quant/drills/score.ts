/**
 * Q14: scoring a person's calibration. Pure.
 * - intervalScore: Gneiting and Raftery's (2007) interval score for a central (1 - α) interval, which rewards
 *   narrow intervals that still contain the answer: (u - l) + (2/α)(l - x)·1{x < l} + (2/α)(x - u)·1{x > u}.
 * - Brier score, reliability bins and over- or under-confidence for true-or-false answers with a confidence.
 */
import { brier, brierSkill, reliabilityBins, type Bin } from "@/lib/edge/calib/score";
import { T } from "../words";

export function intervalScore(lo: number, hi: number, x: number, alpha = 0.1): number {
  const l = Math.min(lo, hi), u = Math.max(lo, hi);
  return u - l + (x < l ? (2 / alpha) * (l - x) : 0) + (x > u ? (2 / alpha) * (x - u) : 0);
}

/** An interval score scaled by the answer's size, so questions in different units can be averaged. */
export const relativeIntervalScore = (lo: number, hi: number, x: number, alpha = 0.1) => intervalScore(lo, hi, x, alpha) / Math.max(Math.abs(x), 1e-9);

export type IntervalSummary = { n: number; hits: number; hitRate: number; target: number; meanRelativeScore: number; read: string };

export function summariseIntervals(rows: { lo: number; hi: number; answer: number }[], level = 0.9): IntervalSummary {
  const hits = rows.filter((r) => r.answer >= Math.min(r.lo, r.hi) && r.answer <= Math.max(r.lo, r.hi)).length;
  const n = rows.length, hitRate = n ? hits / n : 0;
  const read = !n ? "Answer a set to see your calibration." : hitRate < level - 0.15 ? `Your ${Math.round(level * 100)}% intervals caught the answer ${hits} times in ${n}: they are too narrow, a common sign of overconfidence.` : hitRate > Math.min(1, level + 0.08) && n >= 10 ? `Your intervals caught the answer ${hits} times in ${n}: well calibrated or a little wide; try narrowing them.` : `Your intervals caught the answer ${hits} times in ${n}, close to the ${Math.round(level * 100)}% you aimed for.`;
  return { n, hits, hitRate, target: level, meanRelativeScore: n ? rows.reduce((s, r) => s + relativeIntervalScore(r.lo, r.hi, r.answer, 1 - level), 0) / n : 0, read };
}

export type ProbabilitySummary = { n: number; brier: number; skill: number | null; overconfidence: number; bins: Bin[]; read: string };

/** True-or-false answers with a confidence (0.5 to 1) in the answer chosen. */
export function summariseProbabilities(rows: { confidence: number; correct: boolean }[]): ProbabilitySummary {
  const p = rows.map((r) => r.confidence), y: number[] = rows.map((r) => (r.correct ? 1 : 0));
  const n = rows.length;
  const over = n ? p.reduce((s, v) => s + v, 0) / n - y.reduce((s, v) => s + v, 0) / n : 0;
  return { n, brier: n ? brier(p, y) : 0, skill: n >= 5 ? brierSkill(p, y, 0.5) : null, overconfidence: over, bins: n ? reliabilityBins(p, y, 5) : [], read: n ? T.calibrationRead(over) : "Answer a set to see your calibration." };
}
