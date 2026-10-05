/**
 * How good a set of probabilities was, once the outcomes are known: the scores every Track record panel,
 * every model scorecard and every evaluation script prints. Each is a standard proper scoring rule or
 * discrimination measure, and each comes with a bootstrap interval where a number alone would mislead.
 * - brier (mean squared error of the probability) and Brier skill against a reference (the base rate):
 *   above 0 means better than always saying the base rate;
 * - logLoss, clipped so one confident miss is finite;
 * - murphy: Brier = reliability - resolution + uncertainty, binned (Murphy 1973);
 * - ece: expected calibration error over equal-width bins;
 * - reliabilityBins: what the reliability diagram draws, with a Jeffreys interval on each bin's rate;
 * - auroc (Mann-Whitney, ties shared) and prAuc (average precision);
 * - bootstrapCi: a percentile interval for any statistic, from a seeded generator so it reproduces.
 * Pure.
 */
import { ibetaInv, rng } from "../scen/stats";

const finite = (p: number[], y: number[]) => p.map((v, i) => [v, y[i]] as const).filter(([v, o]) => Number.isFinite(v) && Number.isFinite(o));

export function brier(p: number[], y: number[]): number {
  const xs = finite(p, y);
  return xs.length ? xs.reduce((s, [v, o]) => s + (v - o) ** 2, 0) / xs.length : NaN;
}

/** Brier skill against a reference forecast (a constant base rate by default: the outcomes' own mean). Pure. */
export function brierSkill(p: number[], y: number[], reference?: number[] | number): number {
  const base = reference === undefined ? y.reduce((a, b) => a + b, 0) / Math.max(1, y.length) : reference;
  const ref = typeof base === "number" ? y.map(() => base) : base;
  const r = brier(ref, y);
  return r > 0 ? 1 - brier(p, y) / r : NaN;
}

export function logLoss(p: number[], y: number[], eps = 1e-6): number {
  const xs = finite(p, y);
  return xs.length ? -xs.reduce((s, [v, o]) => { const q = Math.min(1 - eps, Math.max(eps, v)); return s + o * Math.log(q) + (1 - o) * Math.log(1 - q); }, 0) / xs.length : NaN;
}

export type Bin = { lo: number; hi: number; n: number; meanP: number; rate: number; low: number; high: number };

/** A Jeffreys interval for k successes in n (Beta(k + 1/2, n - k + 1/2) quantiles). Pure. */
export function jeffreys(k: number, n: number, level = 0.9): [number, number] {
  if (!(n > 0)) return [0, 1];
  const t = (1 - level) / 2;
  return [k === 0 ? 0 : ibetaInv(t, k + 0.5, n - k + 0.5), k === n ? 1 : ibetaInv(1 - t, k + 0.5, n - k + 0.5)];
}

/**
 * Equal-width bins of stated probability, each with how many forecasts it holds, their mean probability,
 * the share that happened and a 90% Jeffreys interval on that share. Empty bins are left out. Pure.
 */
export function reliabilityBins(p: number[], y: number[], bins = 10, level = 0.9): Bin[] {
  const out: Bin[] = [];
  const xs = finite(p, y);
  for (let b = 0; b < bins; b++) {
    const lo = b / bins, hi = (b + 1) / bins;
    const inBin = xs.filter(([v]) => (b === bins - 1 ? v >= lo && v <= hi : v >= lo && v < hi));
    if (!inBin.length) continue;
    const n = inBin.length, k = inBin.reduce((s, [, o]) => s + o, 0);
    const [low, high] = jeffreys(Math.round(k), n, level);
    out.push({ lo, hi, n, meanP: inBin.reduce((s, [v]) => s + v, 0) / n, rate: k / n, low, high });
  }
  return out;
}

/** Expected calibration error: the bin-size-weighted gap between stated probability and what happened. Pure. */
export function ece(p: number[], y: number[], bins = 10): number {
  const total = finite(p, y).length;
  if (!total) return NaN;
  return reliabilityBins(p, y, bins).reduce((s, b) => s + (b.n / total) * Math.abs(b.meanP - b.rate), 0);
}

/**
 * Murphy's decomposition over bins: reliability (lower is better calibrated), resolution (higher sorts
 * outcomes better than the base rate), uncertainty (the base rate's own variance). Brier is about
 * reliability - resolution + uncertainty (exactly so when every forecast in a bin is equal). Pure.
 */
export function murphy(p: number[], y: number[], bins = 10): { reliability: number; resolution: number; uncertainty: number; brier: number } {
  const xs = finite(p, y), n = xs.length;
  if (!n) return { reliability: NaN, resolution: NaN, uncertainty: NaN, brier: NaN };
  const base = xs.reduce((s, [, o]) => s + o, 0) / n;
  let rel = 0, res = 0;
  for (const b of reliabilityBins(p, y, bins)) { rel += b.n * (b.meanP - b.rate) ** 2; res += b.n * (b.rate - base) ** 2; }
  return { reliability: rel / n, resolution: res / n, uncertainty: base * (1 - base), brier: brier(p, y) };
}

/** Area under the ROC curve: the chance a random positive outscores a random negative (ties count half). Pure. */
export function auroc(scores: number[], y: number[]): number {
  const xs = finite(scores, y).map(([s, o]) => ({ s, o: o >= 0.5 ? 1 : 0 })).sort((a, b) => a.s - b.s);
  const pos = xs.filter((x) => x.o).length, neg = xs.length - pos;
  if (!pos || !neg) return NaN;
  // Mid-ranks over ties, then the Mann-Whitney U of the positives.
  let rankSum = 0;
  for (let i = 0; i < xs.length;) {
    let j = i;
    while (j < xs.length && xs[j].s === xs[i].s) j++;
    const mid = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) if (xs[k].o) rankSum += mid;
    i = j;
  }
  return (rankSum - (pos * (pos + 1)) / 2) / (pos * neg);
}

/** Average precision: the area under the precision-recall curve, stepwise (ties broken pessimistically). Pure. */
export function prAuc(scores: number[], y: number[]): number {
  const xs = finite(scores, y).map(([s, o]) => ({ s, o: o >= 0.5 ? 1 : 0 })).sort((a, b) => b.s - a.s || a.o - b.o);
  const pos = xs.filter((x) => x.o).length;
  if (!pos) return NaN;
  let tp = 0, ap = 0;
  xs.forEach((x, i) => { if (x.o) { tp++; ap += tp / (i + 1); } });
  return ap / pos;
}

/** Of the cases ranked in the top share by score, the share that happened, against the base rate ("top-1% lift"). Pure. */
export function topLift(scores: number[], y: number[], share = 0.01): { n: number; rate: number; base: number; lift: number } {
  const xs = finite(scores, y).sort((a, b) => b[0] - a[0]);
  const n = Math.max(1, Math.round(xs.length * share));
  const top = xs.slice(0, n), base = xs.reduce((s, [, o]) => s + o, 0) / Math.max(1, xs.length);
  const rate = top.reduce((s, [, o]) => s + o, 0) / n;
  return { n, rate, base, lift: base > 0 ? rate / base : NaN };
}

/**
 * A percentile bootstrap interval for any statistic of paired arrays: resample cases with replacement
 * `draws` times (seeded, so the same data always gives the same interval). Non-finite draws are skipped. Pure.
 */
export function bootstrapCi(stat: (p: number[], y: number[]) => number, p: number[], y: number[], opts: { draws?: number; level?: number; seed?: number } = {}): [number, number] {
  const n = p.length, draws = opts.draws ?? 500, level = opts.level ?? 0.9;
  if (!n) return [NaN, NaN];
  const u = rng(opts.seed ?? 7);
  const vals: number[] = [];
  for (let d = 0; d < draws; d++) {
    const bp = new Array<number>(n), by = new Array<number>(n);
    for (let i = 0; i < n; i++) { const k = Math.floor(u() * n); bp[i] = p[k]; by[i] = y[k]; }
    const v = stat(bp, by);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return [NaN, NaN];
  vals.sort((a, b) => a - b);
  const at = (q: number) => vals[Math.min(vals.length - 1, Math.max(0, Math.floor(q * (vals.length - 1))))];
  return [at((1 - level) / 2), at(1 - (1 - level) / 2)];
}
