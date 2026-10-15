/**
 * Performance statistics for backtests and live records, with the uncertainty around them. Pure.
 *
 * - The usual: CAGR, annualised volatility, Sharpe, Sortino, maximum drawdown and its length, turnover,
 *   hit rates (of days and of round-trip trades), beta and tracking against a benchmark.
 * - The probabilistic Sharpe ratio (Bailey and López de Prado 2012): the probability that the true Sharpe
 *   is above a threshold, given the track record's length, skewness and kurtosis.
 * - The deflated Sharpe ratio (Bailey and López de Prado 2014): the same probability against the Sharpe
 *   the best of N independent trials would show by luck alone. A backtest picked from many variants needs
 *   a DSR well above 0.95 to mean anything.
 * - Bootstrap intervals (a stationary block bootstrap of daily returns, so volatility clusters survive) for
 *   CAGR, Sharpe and the worst drawdown: the honest error bars on a single history.
 * - The probability of backtest overfitting (Bailey, Borwein, López de Prado and Zhu 2015) by
 *   combinatorially symmetric cross-validation over the variants a walk-forward tried.
 */
import { kurtosis, mean, normCdf, normInv, quantile, rng, skew, std } from "@/lib/edge/scen/stats";

export const PERIODS_PER_YEAR = 252;
const EULER_GAMMA = 0.5772156649015329;

export type Point = { date: string; value: number };

export const returnsOf = (curve: Point[]) => curve.slice(1).map((p, i) => (curve[i].value > 0 ? p.value / curve[i].value - 1 : 0));

export function cagr(curve: Point[], periods = PERIODS_PER_YEAR): number {
  if (curve.length < 2 || !(curve[0].value > 0)) return 0;
  const years = (curve.length - 1) / periods;
  const total = curve.at(-1)!.value / curve[0].value;
  return total > 0 && years > 0 ? total ** (1 / years) - 1 : -1;
}

export const annVol = (r: number[], periods = PERIODS_PER_YEAR) => std(r) * Math.sqrt(periods);

/** Annualised Sharpe of per-period returns over a per-period risk-free rate. Null with fewer than two returns or no variance. */
export function sharpe(r: number[], rfAnnual = 0, periods = PERIODS_PER_YEAR): number | null {
  if (r.length < 2) return null;
  const ex = r.map((x) => x - rfAnnual / periods);
  const s = std(ex);
  return s > 0 ? (mean(ex) / s) * Math.sqrt(periods) : null;
}

/** Sortino: excess return over the downside deviation (the root mean square of returns below zero, over all periods). */
export function sortino(r: number[], rfAnnual = 0, periods = PERIODS_PER_YEAR): number | null {
  if (r.length < 2) return null;
  const ex = r.map((x) => x - rfAnnual / periods);
  const dd = Math.sqrt(ex.reduce((s, x) => s + Math.min(0, x) ** 2, 0) / ex.length);
  return dd > 0 ? (mean(ex) / dd) * Math.sqrt(periods) : null;
}

export function drawdown(curve: Point[]): { max: number; peakDate: string | null; troughDate: string | null; longestDays: number; series: Point[] } {
  let peak = -Infinity, peakAt = "", max = 0, pk: string | null = null, tr: string | null = null, longest = 0, since = 0;
  const series: Point[] = [];
  for (const p of curve) {
    if (p.value > peak) { peak = p.value; peakAt = p.date; since = 0; } else since++;
    longest = Math.max(longest, since);
    const dd = peak > 0 ? p.value / peak - 1 : 0;
    series.push({ date: p.date, value: dd });
    if (dd < max) { max = dd; pk = peakAt; tr = p.date; }
  }
  return { max, peakDate: pk, troughDate: tr, longestDays: longest, series };
}

export function beta(r: number[], b: number[]): number | null {
  const n = Math.min(r.length, b.length);
  if (n < 20) return null;
  const x = r.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  const cov = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / (n - 1);
  const vb = y.reduce((s, v) => s + (v - my) ** 2, 0) / (n - 1);
  return vb > 0 ? cov / vb : null;
}

/* ---------------- Probabilistic and deflated Sharpe ---------------- */

/**
 * Probabilistic Sharpe ratio: P(true SR > srStar). `sr` and `srStar` are per period (not annualised), `n`
 * the number of returns, `g3` their skewness and `g4` their kurtosis (normal = 3, not excess).
 */
export function psr(sr: number, srStar: number, n: number, g3: number, g4: number): number {
  const den = 1 - g3 * sr + ((g4 - 1) / 4) * sr * sr;
  if (n < 2 || den <= 0) return NaN;
  return normCdf(((sr - srStar) * Math.sqrt(n - 1)) / Math.sqrt(den));
}

/** The Sharpe ratio (per period) the best of `trials` independent trials reaches by chance, given the variance of their Sharpes. */
export function expectedMaxSharpe(trials: number, varSr: number): number {
  if (trials <= 1) return 0;
  return Math.sqrt(Math.max(0, varSr)) * ((1 - EULER_GAMMA) * normInv(1 - 1 / trials) + EULER_GAMMA * normInv(1 - 1 / (trials * Math.E)));
}

/** Deflated Sharpe ratio: PSR against the expected maximum of `trials` trials. All Sharpe inputs per period. */
export function deflatedSharpe(sr: number, n: number, g3: number, g4: number, trials: number, varSr: number): { dsr: number; sr0: number } {
  const sr0 = expectedMaxSharpe(trials, varSr);
  return { dsr: psr(sr, sr0, n, g3, g4), sr0 };
}

/* ---------------- Bootstrap intervals ---------------- */

export type Interval = { p05: number; p50: number; p95: number };

/** Stationary block bootstrap (average block `block` days) of the return series: CAGR, Sharpe and max drawdown intervals. */
export function bootstrap(r: number[], opts: { paths?: number; block?: number; seed?: number; periods?: number } = {}): { cagr: Interval; sharpe: Interval; maxDrawdown: Interval; paths: number } | null {
  const n = r.length;
  if (n < 40) return null;
  const paths = opts.paths ?? 400, block = opts.block ?? 10, periods = opts.periods ?? PERIODS_PER_YEAR;
  const u = rng(opts.seed ?? 7);
  const c: number[] = [], s: number[] = [], d: number[] = [];
  for (let p = 0; p < paths; p++) {
    let at = Math.floor(u() * n), v = 1, peak = 1, worst = 0;
    const xs: number[] = [];
    for (let t = 0; t < n; t++) {
      if (t > 0) at = u() < 1 / block ? Math.floor(u() * n) : (at + 1) % n;
      const x = r[at];
      xs.push(x);
      v *= 1 + x; if (v > peak) peak = v; worst = Math.min(worst, v / peak - 1);
    }
    c.push(v > 0 ? v ** (periods / n) - 1 : -1);
    s.push(sharpe(xs, 0, periods) ?? 0);
    d.push(worst);
  }
  const iv = (x: number[]): Interval => ({ p05: quantile(x, 0.05), p50: quantile(x, 0.5), p95: quantile(x, 0.95) });
  return { cagr: iv(c), sharpe: iv(s), maxDrawdown: iv(d), paths };
}

/* ---------------- Overfitting ---------------- */

/**
 * Probability of backtest overfitting by combinatorially symmetric cross-validation. `matrix[k]` is the
 * per-period return series of variant k (all the same length). The periods are cut into `blocks` equal
 * blocks; for every way of choosing half of them as "in sample", the best variant in sample is ranked out
 * of sample. PBO is the share of splits where it lands in the bottom half (logit ≤ 0).
 */
export function pbo(matrix: number[][], blocks = 8): { pbo: number; splits: number } | null {
  const k = matrix.length;
  const T = Math.min(...matrix.map((r) => r.length));
  if (k < 2 || T < blocks * 5 || blocks % 2) return null;
  const size = Math.floor(T / blocks);
  const sr = (r: number[]) => { const s = std(r); return s > 0 ? mean(r) / s : 0; };
  const combos: number[][] = [];
  const pick = (start: number, acc: number[]) => {
    if (acc.length === blocks / 2) { combos.push([...acc]); return; }
    for (let i = start; i < blocks; i++) { acc.push(i); pick(i + 1, acc); acc.pop(); }
  };
  pick(0, []);
  let below = 0;
  for (const ins of combos) {
    const inSet = new Set(ins);
    const slice = (r: number[], wantIn: boolean) => r.slice(0, size * blocks).filter((_, t) => inSet.has(Math.floor(t / size)) === wantIn);
    const isSr = matrix.map((r) => sr(slice(r, true)));
    const oosSr = matrix.map((r) => sr(slice(r, false)));
    const best = isSr.indexOf(Math.max(...isSr));
    const rank = oosSr.filter((v) => v < oosSr[best]).length + 0.5 * (oosSr.filter((v) => v === oosSr[best]).length - 1);
    const w = (rank + 1) / (k + 1);
    if (Math.log(w / (1 - w)) <= 0) below++;
  }
  return { pbo: below / combos.length, splits: combos.length };
}

/* ---------------- The summary ---------------- */

export type Stats = {
  from: string; to: string; days: number;
  totalReturn: number; cagr: number; volatility: number; sharpe: number | null; sortino: number | null;
  maxDrawdown: number; longestDrawdownDays: number;
  /** Share of days with a gain. */
  hitRateDays: number;
  skew: number; kurtosis: number;
  /** P(true Sharpe > 0) from this record alone. */
  psr: number | null;
};

export function stats(curve: Point[], rfAnnual = 0): Stats | null {
  if (curve.length < 3) return null;
  const r = returnsOf(curve);
  const sr = sharpe(r, rfAnnual);
  const dd = drawdown(curve);
  const g3 = skew(r), g4 = kurtosis(r) + 3;
  const srp = sr === null ? null : sr / Math.sqrt(PERIODS_PER_YEAR);
  const p = srp === null ? null : psr(srp, 0, r.length, g3, g4);
  return {
    from: curve[0].date, to: curve.at(-1)!.date, days: r.length,
    totalReturn: curve.at(-1)!.value / curve[0].value - 1, cagr: cagr(curve), volatility: annVol(r), sharpe: sr, sortino: sortino(r, rfAnnual),
    maxDrawdown: dd.max, longestDrawdownDays: dd.longestDays, hitRateDays: r.filter((x) => x > 0).length / r.length,
    skew: g3, kurtosis: g4, psr: p === null || Number.isNaN(p) ? null : p,
  };
}

/** Plain-language warnings about how much a backtest can be trusted. */
export function overfitWarnings(o: { dsr: number | null; trials: number; pbo: number | null; days: number; trades: number; oosSharpe?: number | null; isSharpe?: number | null }): string[] {
  const w: string[] = [];
  if (o.days < 504) w.push(`Only ${o.days} trading days of history: under two years is too short to judge a strategy.`);
  if (o.trades < 30) w.push(`Only ${o.trades} trades: too few to tell skill from luck.`);
  if (o.dsr !== null && o.dsr < 0.95) w.push(`Deflated Sharpe ${(o.dsr * 100).toFixed(0)}% after ${o.trials} variant${o.trials === 1 ? "" : "s"} tried: below 95%, so this result is consistent with luck.`);
  if (o.pbo !== null && o.pbo > 0.5) w.push(`Probability of backtest overfitting ${(o.pbo * 100).toFixed(0)}%: the best variant in-sample usually did worse than the median out-of-sample.`);
  if (o.isSharpe !== undefined && o.oosSharpe !== undefined && o.isSharpe !== null && o.oosSharpe !== null && o.isSharpe > 0 && o.oosSharpe < o.isSharpe * 0.5) w.push(`Out-of-sample Sharpe (${o.oosSharpe.toFixed(2)}) is less than half the in-sample one (${o.isSharpe.toFixed(2)}): expect live results nearer the lower figure.`);
  return w;
}
