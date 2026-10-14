/**
 * The multiple range for a target (E1): what similar deals paid, two ways.
 * - The retrieved set's trimmed median and interquartile range of EV/EBITDA (or EV/revenue), the banker's
 *   own way of reading a precedents table.
 * - A split-conformal 80% interval: k-nearest-neighbour regression of log EV/EBITDA on the retrieval score,
 *   calibrated on deals held out by year (each calibration deal predicted only from deals of earlier years),
 *   so the interval's coverage is a tested number, printed with the years it was tested on ("82% on
 *   2024-25 deals"). With too few deals the interval is not drawn and the page says why.
 * Pure, tested on synthetic data with known coverage.
 */
import { minCalibration, splitConformal } from "../calib";

export type MultipleDeal = { id: number; year: number; multiple: number };

const sorted = (xs: number[]) => [...xs].sort((a, b) => a - b);
const quantile = (s: number[], q: number) => {
  if (!s.length) return NaN;
  const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
};

/** Median and interquartile range after trimming the top and bottom `trim` share. Pure. */
export function trimmedStats(values: number[], trim = 0.1): { n: number; median: number; p25: number; p75: number; low: number; high: number } | null {
  const v = sorted(values.filter((x) => Number.isFinite(x) && x > 0));
  if (v.length < 3) return null;
  // A banker's trim: at least the highest and lowest once there are five or more.
  const k = v.length >= 5 ? Math.max(1, Math.floor(v.length * trim)) : 0;
  const t = v.slice(k, v.length - k);
  return { n: v.length, median: quantile(t, 0.5), p25: quantile(t, 0.25), p75: quantile(t, 0.75), low: t[0], high: t[t.length - 1] };
}

/** kNN prediction: the similarity-weighted mean of the k most similar deals' log multiples. Pure. */
export function knnPredict(neighbours: { score: number; multiple: number }[], k = 10): number | null {
  const top = neighbours.filter((n) => Number.isFinite(n.multiple) && n.multiple > 0).sort((a, b) => b.score - a.score).slice(0, k);
  if (top.length < 3) return null;
  const w = top.map((n) => Math.max(1e-3, n.score));
  const sw = w.reduce((a, b) => a + b, 0);
  return top.reduce((s, n, i) => s + w[i] * Math.log(n.multiple), 0) / sw;
}

export type ConformalBand = { low: number; mid: number; high: number; level: number; coverage: number | null; testedOn: string; calibration: number };

/**
 * The split-conformal interval for a target's multiple. `pool` is every deal with a multiple; `score(a, b)`
 * the retrieval score. Calibration deals are those from `calibFrom` on, each predicted from earlier years
 * only; the absolute log residuals set the half-width at the (1 - alpha) conformal quantile. Coverage is then
 * measured on the latest year held out from calibration (when it has deals), so the printed rate is honest.
 * Returns null when there are too few calibration deals for this alpha. Pure.
 */
export function conformalBand(targetNeighbours: { score: number; multiple: number }[], pool: MultipleDeal[], score: (a: number, b: number) => number, opts: { alpha?: number; k?: number; calibFrom?: number } = {}): ConformalBand | null {
  const alpha = opts.alpha ?? 0.2, k = opts.k ?? 10;
  const years = [...new Set(pool.map((d) => d.year))].sort();
  if (years.length < 3) return null;
  const last = years[years.length - 1];
  const calibFrom = opts.calibFrom ?? years[Math.floor(years.length / 2)];
  const residual = (d: MultipleDeal) => {
    const earlier = pool.filter((x) => x.year < d.year && x.id !== d.id).map((x) => ({ score: score(d.id, x.id), multiple: x.multiple }));
    const p = knnPredict(earlier, k);
    return p === null ? null : Math.abs(Math.log(d.multiple) - p);
  };
  const calib = pool.filter((d) => d.year >= calibFrom && d.year < last).map(residual).filter((r): r is number => r !== null);
  if (calib.length < minCalibration(alpha)) return null;
  const q = splitConformal(calib, alpha);
  const mid = knnPredict(targetNeighbours, k);
  if (q === null || mid === null) return null;
  const test = pool.filter((d) => d.year === last).map(residual).filter((r): r is number => r !== null);
  const coverage = test.length >= 5 ? test.filter((r) => r <= q).length / test.length : null;
  return { low: Math.exp(mid - q), mid: Math.exp(mid), high: Math.exp(mid + q), level: 1 - alpha, coverage, testedOn: test.length >= 5 ? `${test.length} deals from ${last}` : "too few recent deals to test yet", calibration: calib.length };
}

/** The band in words: "80% interval 7.1x to 12.4x; it covered 82% of 34 deals from 2026." Pure. */
export function bandSentence(b: ConformalBand | null, multiple = "EV/EBITDA"): string {
  if (!b) return `Not enough comparable deals with ${multiple} yet for a tested interval.`;
  const cov = b.coverage === null ? `Its coverage is not tested yet (${b.testedOn}).` : `On ${b.testedOn} held out, it covered ${Math.round(b.coverage * 100)}%.`;
  return `${Math.round(b.level * 100)}% interval ${b.low.toFixed(1)}x to ${b.high.toFixed(1)}x ${multiple} (centre ${b.mid.toFixed(1)}x), calibrated on ${b.calibration} earlier deals. ${cov}`;
}
