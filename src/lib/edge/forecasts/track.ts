/**
 * A model's track record from its resolved forecasts: Brier score against the Brier of the base rates it
 * showed beside each forecast, Brier skill with a 90% bootstrap interval, the reliability diagram's bins,
 * the expected calibration error, and n. Every Track record panel is this summary. Pure.
 */
import { bootstrapCi, brier, ece, reliabilityBins, type Bin } from "../calib/score";

export type TrackSummary = {
  n: number; positives: number;
  brier: number | null; baseBrier: number | null; skill: number | null; skillCi: [number, number] | null;
  ece: number | null; bins: Bin[];
  /** How the skill reads in words, honestly, including "not enough resolved forecasts yet". */
  verdict: string;
};

/** The minimum resolved forecasts before a skill figure is worth printing. */
export const MIN_SCORED = 30;

export function trackSummary(rows: { probability: number; baseRate: number | null; outcome: number }[]): TrackSummary {
  const p = rows.map((r) => r.probability), y = rows.map((r) => r.outcome);
  const base = rows.map((r) => r.baseRate ?? NaN);
  const n = rows.length, positives = y.filter((v) => v >= 0.5).length;
  if (!n) return { n, positives, brier: null, baseBrier: null, skill: null, skillCi: null, ece: null, bins: [], verdict: "Nothing has resolved yet. Forecasts are scored when their window closes." };
  const haveBase = base.every((b) => Number.isFinite(b));
  const refOf = (ps: number[], ys: number[], bs: number[]) => (haveBase ? bs : ys.map(() => ys.reduce((a, b) => a + b, 0) / ys.length));
  const b = brier(p, y), bb = brier(refOf(p, y, base), y);
  const skill = bb > 0 ? 1 - b / bb : null;
  // The interval resamples forecasts with their own base rates, so the reference moves with the sample.
  const idx = rows.map((_, i) => i);
  const skillCi = n >= 10 ? bootstrapCi((ii) => { const ps = ii.map((i) => p[i]), ys = ii.map((i) => y[i]), bs = ii.map((i) => base[i]); const r = brier(refOf(ps, ys, bs), ys); return r > 0 ? 1 - brier(ps, ys) / r : NaN; }, idx, idx, { draws: 400, seed: 13 }) : null;
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  const verdict = n < MIN_SCORED
    ? `${n} resolved so far; skill is printed from ${MIN_SCORED}.`
    : skill === null ? "No variation in outcomes yet, so skill cannot be measured."
      : skillCi && skillCi[0] > 0 ? `Better than the base rate: Brier skill ${pct(skill)} (90% interval ${pct(skillCi[0])} to ${pct(skillCi[1])}) on ${n} resolved forecasts.`
        : skillCi && skillCi[1] < 0 ? `Worse than simply stating the base rate: Brier skill ${pct(skill)} (90% interval ${pct(skillCi[0])} to ${pct(skillCi[1])}) on ${n} resolved forecasts.`
          : `Not distinguishable from the base rate yet: Brier skill ${pct(skill)}${skillCi ? ` (90% interval ${pct(skillCi[0])} to ${pct(skillCi[1])})` : ""} on ${n} resolved forecasts.`;
  return { n, positives, brier: b, baseBrier: bb, skill, skillCi, ece: ece(p, y), bins: reliabilityBins(p, y), verdict };
}
