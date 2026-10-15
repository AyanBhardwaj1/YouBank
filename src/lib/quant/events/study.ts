/**
 * QF5: the event-study engine. Every base rate a Quant feature shows comes from here, computed one way with
 * one set of caveats. Pure: events and return series in, base rates out.
 *
 * - Day 0 is the first session the event could be traded on: the session of the first open after the event
 *   became public (`knownAt`, e.g. a Form 4's EDGAR acceptance). Academic studies that start from the trade date
 *   overstate what anyone could capture.
 * - Abnormal returns against the market model, fitted on sessions -250 to -30 (at least 120 returns, else the
 *   market-adjusted return, beta 1, and the count of such events is reported), optionally against factors.
 * - Windows: 0 to +1 (the reaction, mostly not capturable), +2 to +20, +2 to +60, +2 to +125.
 * - Cumulative abnormal returns averaged across events, with a 90% interval from a bootstrap that resamples
 *   calendar months (events cluster in time; resampling single events would overstate precision).
 * - Hit rate: the share of events whose stock beat the market over the window, against the unconditional rate
 *   for the same stocks (every 5th session as a start, over the same years).
 * - Splits by era, size tercile and liquidity; and after an estimated round-trip cost per event.
 */
import { rng, quantile } from "../stats/core";
import { nextOpenAfter } from "../pit/calendar";

export type Series = { dates: string[]; ret: number[] };
export type StudyEvent = { id: string; symbol: string; knownAt: string; size?: number | null; adv?: number | null; costBps?: number | null };
export type Window = { label: string; from: number; to: number };

export const WINDOWS: Window[] = [
  { label: "0..+1", from: 0, to: 1 },
  { label: "+2..+20", from: 2, to: 20 },
  { label: "+2..+60", from: 2, to: 60 },
  { label: "+2..+125", from: 2, to: 125 },
];

export type WindowStats = { window: string; n: number; car: number; low: number; high: number; hitRate: number; unconditionalHitRate: number; netCar: number | null; marketAdjusted: number };
export type EventResult = { id: string; symbol: string; day0: string; cars: Record<string, number>; beat: Record<string, boolean>; size?: number | null; adv?: number | null; costBps?: number | null; marketAdjusted: boolean };
export type Study = { windows: WindowStats[]; byEra: { era: string; stats: WindowStats }[]; bySize: { tercile: "small" | "mid" | "large"; stats: WindowStats }[]; byLiquidity: { tercile: "low" | "mid" | "high"; stats: WindowStats }[]; events: EventResult[]; skipped: { id: string; reason: string }[]; era: string; primary: string };

/** Index of the first date >= d in a sorted list, or -1. */
function lowerBound(dates: string[], d: string): number {
  let lo = 0, hi = dates.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (dates[mid] < d) lo = mid + 1; else hi = mid; }
  return lo < dates.length ? lo : -1;
}

/** Abnormal-return CARs of one event over every window, or why it was skipped. */
export function eventCars(ev: StudyEvent, stock: Series, market: Series, windows = WINDOWS): EventResult | { skip: string } {
  const day0 = nextOpenAfter(ev.knownAt).slice(0, 10);
  const mIdx = new Map(market.dates.map((d, i) => [d, i]));
  const i0 = lowerBound(stock.dates, day0);
  if (i0 < 0) return { skip: "no prices after the event" };
  const last = Math.max(...windows.map((w) => w.to));
  if (i0 + last >= stock.dates.length) return { skip: "the window has not finished" };
  // Market model on sessions -250..-30.
  const est: [number, number][] = [];
  for (let k = Math.max(0, i0 - 250); k <= i0 - 30; k++) { const j = mIdx.get(stock.dates[k]); if (j !== undefined) est.push([market.ret[j], stock.ret[k]]); }
  let alpha = 0, beta = 1, marketAdjusted = true;
  if (est.length >= 120) {
    const mx = est.reduce((s, p) => s + p[0], 0) / est.length, my = est.reduce((s, p) => s + p[1], 0) / est.length;
    let sxy = 0, sxx = 0;
    for (const [x, y] of est) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; }
    if (sxx > 0) { beta = sxy / sxx; alpha = my - beta * mx; marketAdjusted = false; }
  }
  const cars: Record<string, number> = {}, beat: Record<string, boolean> = {};
  for (const w of windows) {
    let car = 0, rs = 1, rm = 1, ok = true;
    for (let k = i0 + w.from; k <= i0 + w.to; k++) {
      const j = mIdx.get(stock.dates[k]);
      if (j === undefined) { ok = false; break; }
      car += stock.ret[k] - (alpha + beta * market.ret[j]);
      rs *= 1 + stock.ret[k]; rm *= 1 + market.ret[j];
    }
    if (!ok) return { skip: "market and stock dates do not line up" };
    cars[w.label] = car; beat[w.label] = rs > rm;
  }
  return { id: ev.id, symbol: ev.symbol, day0, cars, beat, size: ev.size, adv: ev.adv, costBps: ev.costBps, marketAdjusted };
}

/** The unconditional hit rate: the share of windows (every 5th session as a start) in which the stock beat the market. */
export function unconditionalHitRate(stock: Series, market: Series, w: Window, from?: string, to?: string): { rate: number; n: number } {
  const mIdx = new Map(market.dates.map((d, i) => [d, i]));
  let hit = 0, n = 0;
  for (let s = 0; s + w.to < stock.dates.length; s += 5) {
    const d = stock.dates[s];
    if ((from && d < from) || (to && d > to)) continue;
    let rs = 1, rm = 1, ok = true;
    for (let k = s + w.from; k <= s + w.to; k++) { const j = mIdx.get(stock.dates[k]); if (j === undefined) { ok = false; break; } rs *= 1 + stock.ret[k]; rm *= 1 + market.ret[j]; }
    if (!ok) continue;
    n++; if (rs > rm) hit++;
  }
  return { rate: n ? hit / n : NaN, n };
}

/** Mean CAR with a 90% interval from a bootstrap over calendar months. */
function carStats(rs: EventResult[], w: string, unconditional: number, draws: number, seed: number): WindowStats {
  const n = rs.length;
  if (!n) return { window: w, n: 0, car: NaN, low: NaN, high: NaN, hitRate: NaN, unconditionalHitRate: unconditional, netCar: null, marketAdjusted: 0 };
  const car = rs.reduce((s, r) => s + r.cars[w], 0) / n;
  const months = new Map<string, EventResult[]>();
  for (const r of rs) { const m = r.day0.slice(0, 7); months.set(m, [...(months.get(m) ?? []), r]); }
  const groups = [...months.values()];
  const u = rng(seed), samples: number[] = [];
  for (let d = 0; d < draws; d++) {
    let s = 0, k = 0;
    for (let g = 0; g < groups.length; g++) { const pick = groups[Math.floor(u() * groups.length)]; for (const r of pick) { s += r.cars[w]; k++; } }
    if (k) samples.push(s / k);
  }
  const withCost = rs.filter((r) => r.costBps !== undefined && r.costBps !== null);
  return {
    window: w, n, car, low: quantile(samples, 0.05), high: quantile(samples, 0.95), hitRate: rs.filter((r) => r.beat[w]).length / n, unconditionalHitRate: unconditional,
    netCar: withCost.length === n ? rs.reduce((s, r) => s + r.cars[w] - (r.costBps ?? 0) / 1e4, 0) / n : null, marketAdjusted: rs.filter((r) => r.marketAdjusted).length,
  };
}

const terciles = <T>(xs: T[], key: (x: T) => number | null | undefined): [T[], T[], T[]] => {
  const ok = xs.filter((x) => Number.isFinite(key(x) as number));
  const v = ok.map((x) => key(x) as number);
  const a = quantile(v, 1 / 3), b = quantile(v, 2 / 3);
  return [ok.filter((x) => (key(x) as number) <= a), ok.filter((x) => (key(x) as number) > a && (key(x) as number) <= b), ok.filter((x) => (key(x) as number) > b)];
};

/**
 * Run a study. `stocks` maps symbol to its daily returns; `eras` are break dates ("2006-01-01") splitting the
 * sample (before the first, between, after the last). `primary` names the window a signal quotes.
 */
export function eventStudy(events: StudyEvent[], stocks: Map<string, Series>, market: Series, opts: { eras?: string[]; primary?: string; draws?: number; seed?: number } = {}): Study {
  const draws = opts.draws ?? 500, seed = opts.seed ?? 23, primary = opts.primary ?? "+2..+125";
  const results: EventResult[] = [], skipped: Study["skipped"] = [];
  for (const ev of events) {
    const s = stocks.get(ev.symbol);
    if (!s) { skipped.push({ id: ev.id, reason: "no prices for the symbol" }); continue; }
    const r = eventCars(ev, s, market);
    if ("skip" in r) skipped.push({ id: ev.id, reason: r.skip }); else results.push(r);
  }
  const first = results.map((r) => r.day0).sort()[0], last = results.map((r) => r.day0).sort().at(-1);
  const uncond = (w: Window, rs: EventResult[], from?: string, to?: string) => {
    let hit = 0, n = 0;
    for (const sym of new Set(rs.map((r) => r.symbol))) { const u = unconditionalHitRate(stocks.get(sym)!, market, w, from ?? first, to ?? last); if (Number.isFinite(u.rate)) { hit += u.rate * u.n; n += u.n; } }
    return n ? hit / n : NaN;
  };
  const statsFor = (rs: EventResult[], w: Window, from?: string, to?: string) => carStats(rs, w.label, uncond(w, rs, from, to), draws, seed);
  const pw = WINDOWS.find((w) => w.label === primary) ?? WINDOWS[3];
  const eras = (opts.eras ?? []).sort();
  const bounds = [undefined, ...eras, undefined];
  const byEra = bounds.slice(0, -1).map((from, k) => {
    const to = bounds[k + 1];
    const rs = results.filter((r) => (!from || r.day0 >= from) && (!to || r.day0 < to));
    const label = `${from ? from.slice(0, 4) : first?.slice(0, 4) ?? "?"}-${to ? String(Number(to.slice(0, 4)) - 1) : last?.slice(0, 4) ?? "?"}`;
    return { era: label, stats: statsFor(rs, pw, from, to) };
  }).filter((e) => e.stats.n > 0);
  const [s1, s2, s3] = terciles(results, (r) => r.size);
  const [l1, l2, l3] = terciles(results, (r) => r.adv);
  return {
    windows: WINDOWS.map((w) => statsFor(results, w)),
    byEra, bySize: [["small", s1], ["mid", s2], ["large", s3]].filter(([, rs]) => (rs as EventResult[]).length).map(([t, rs]) => ({ tercile: t as "small" | "mid" | "large", stats: statsFor(rs as EventResult[], pw) })),
    byLiquidity: [["low", l1], ["mid", l2], ["high", l3]].filter(([, rs]) => (rs as EventResult[]).length).map(([t, rs]) => ({ tercile: t as "low" | "mid" | "high", stats: statsFor(rs as EventResult[], pw) })),
    events: results, skipped, era: first && last ? `${first.slice(0, 4)}-${last.slice(0, 4)}` : "", primary: pw.label,
  };
}
