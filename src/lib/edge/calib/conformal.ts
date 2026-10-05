/**
 * Split conformal prediction: an interval around any point prediction whose coverage is guaranteed in
 * finite samples when the calibration cases and the new case are exchangeable. Scores are the absolute
 * errors of held-out cases; the interval is the prediction plus or minus their finite-sample quantile
 * (the same `conformalQuantile` the Terminal's forecasts use). `coverage` measures what an interval
 * actually achieved on later cases, which is the number Edge prints beside every band ("82% on 2024-25
 * deals"). Pure.
 */
import { conformalQuantile } from "@/lib/inference/forecast";

/** The half-width that covers at least 1 - alpha of new cases, or null when there are too few calibration cases for that level. Pure. */
export function splitConformal(calibrationErrors: number[], alpha: number): number | null {
  return conformalQuantile(calibrationErrors.filter((e) => Number.isFinite(e)).map((e) => Math.abs(e)), alpha);
}

/** A symmetric interval around a prediction. Pure. */
export const conformalInterval = (prediction: number, halfWidth: number): [number, number] => [prediction - halfWidth, prediction + halfWidth];

/** The share of cases whose truth fell inside its interval. Pure. */
export function coverage(intervals: [number, number][], truths: number[]): number {
  const pairs = intervals.map((iv, i) => [iv, truths[i]] as const).filter(([, t]) => Number.isFinite(t));
  return pairs.length ? pairs.filter(([[lo, hi], t]) => t >= lo && t <= hi).length / pairs.length : NaN;
}

/** The smallest calibration set that can support a level at all: the conformal quantile needs n >= 1/alpha - 1. Pure. */
export const minCalibration = (alpha: number) => Math.ceil(1 / alpha - 1);
