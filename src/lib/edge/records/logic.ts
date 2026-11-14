/**
 * The pure parts of Edge's public-records signals (tested in scripts/test-edge-records.ts): reactor
 * outages and derates from the NRC's daily status, bursts of FDA recalls against a firm's own year, and
 * vehicle recalls large against a maker's usual pace.
 */
import type { NameRule } from "./names";
import { tickerFor } from "./names";
import type { ReactorDay } from "../sources/nrc";
import type { FdaRecall } from "../sources/openfda";
import type { VehicleRecall } from "../sources/nhtsa";

const DAY = 86_400_000;
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export type ReactorEvent = {
  unit: string; kind: "outage" | "derate"; start: string; latest: string; days: number; power: number; before: number;
  /** Percent-of-power-days lost in the run: the sum over its days of (before - power). */
  lostPctDays: number;
  series: { date: string; power: number }[];
};

/**
 * Each unit's current run below its normal output, if any: an outage (20% of power or less) after a
 * month averaging 80% or more, or a derate (15 points or more under a normal of 90% or more, for two days
 * or more). Units whose newest report is more than four days older than the file's are left out. Pure.
 */
export function reactorEvents(rows: ReactorDay[]): ReactorEvent[] {
  const by = new Map<string, ReactorDay[]>();
  for (const r of rows) { const l = by.get(r.unit) ?? []; l.push(r); by.set(r.unit, l); }
  const newest = rows.reduce((m, r) => (r.date > m ? r.date : m), "");
  const out: ReactorEvent[] = [];
  for (const [unit, list] of by) {
    const days = [...new Map(list.map((d) => [d.date, d])).values()].sort((a, b) => a.date.localeCompare(b.date));
    const last = days[days.length - 1];
    if (!last || Date.parse(newest) - Date.parse(last.date) > 4 * DAY) continue;
    const series = days.slice(-45).map((d) => ({ date: d.date, power: d.power }));
    // Outage: the run of days at 20% or less ending today, against the month before it.
    if (last.power <= 20) {
      let s = days.length - 1;
      while (s > 0 && days[s - 1].power <= 20) s--;
      const prior = days.slice(Math.max(0, s - 30), s).map((d) => d.power);
      const before = median(prior);
      if (prior.length >= 10 && before >= 80) {
        const run = days.slice(s);
        out.push({ unit, kind: "outage", start: days[s].date, latest: last.date, days: run.length, power: last.power, before, lostPctDays: Math.round(run.reduce((t, d) => t + Math.max(0, before - d.power), 0)), series });
      }
      continue;
    }
    // Derate: at least 15 points under a normal of 90% or more, for the last two days or more.
    const prior = days.slice(Math.max(0, days.length - 32), days.length - 2).map((d) => d.power);
    const normal = median(prior);
    if (prior.length < 10 || normal < 90) continue;
    const low = (p: number) => p <= normal - 15 && p > 20;
    if (!low(last.power) || !low(days[days.length - 2]?.power ?? 100)) continue;
    let s = days.length - 1;
    while (s > 0 && low(days[s - 1].power)) s--;
    const run = days.slice(s);
    const before = median(days.slice(Math.max(0, s - 30), s).map((d) => d.power));
    if (!(before >= 90)) continue;
    out.push({ unit, kind: "derate", start: days[s].date, latest: last.date, days: run.length, power: last.power, before, lostPctDays: Math.round(run.reduce((t, d) => t + Math.max(0, before - d.power), 0)), series });
  }
  return out;
}

/** Megawatt-hours not generated in a run, from a unit's capacity. Pure. */
export const lostMwh = (e: Pick<ReactorEvent, "lostPctDays">, mw: number) => Math.round((e.lostPctDays / 100) * mw * 24);

/** Whether a run falls in the spring or autumn refuelling seasons (most planned outages do). Pure. */
export const refuelSeason = (date: string) => [3, 4, 5, 9, 10, 11].includes(Number(date.slice(5, 7)));

/** P(X >= k) for a Poisson count with mean `lambda`. Pure. */
export function poissonTail(k: number, lambda: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let term = Math.exp(-lambda), cdf = term;
  for (let i = 1; i < k; i++) { term *= lambda / i; cdf += term; }
  return Math.max(0, Math.min(1, 1 - cdf));
}

export type RecallBurst = {
  ticker: string; name: string; recalls: FdaRecall[]; classI: number; k: number;
  /** The firm's usual number of recalls in a window this long, from its year before. */
  lambda: number; p: number; signal: boolean;
};

/**
 * FDA recalls reported in the last `windowDays` grouped by listed parent, each against the parent's own
 * pace over the year before (`baseline`, counts by filed firm over `baselineDays`). A burst is any Class
 * I recall, or three or more recalls when the parent's usual pace makes that less than 1% likely. Pure.
 */
export function recallBursts(recent: FdaRecall[], baseline: { firm: string; count: number }[], rules: NameRule[], windowDays = 14, baselineDays = 351): RecallBurst[] {
  const groups = new Map<string, { name: string; recalls: FdaRecall[] }>();
  for (const r of recent) {
    const hit = tickerFor(rules, r.firm);
    if (!hit) continue;
    const g = groups.get(hit.ticker) ?? { name: hit.name, recalls: [] };
    if (!g.recalls.some((x) => x.number === r.number)) g.recalls.push(r);
    groups.set(hit.ticker, g);
  }
  const base = new Map<string, number>();
  for (const b of baseline) { const hit = tickerFor(rules, b.firm); if (hit) base.set(hit.ticker, (base.get(hit.ticker) ?? 0) + b.count); }
  return [...groups.entries()].map(([ticker, g]) => {
    const k = g.recalls.length, classI = g.recalls.filter((r) => r.classification === "Class I").length;
    const lambda = Math.round(((base.get(ticker) ?? 0) * windowDays / baselineDays) * 100) / 100;
    const p = poissonTail(k, Math.max(lambda, 0.05));
    return { ticker, name: g.name, recalls: g.recalls.sort((a, b) => a.classification.localeCompare(b.classification) || b.reportDate.localeCompare(a.reportDate)), classI, k, lambda, p: Math.round(p * 10_000) / 10_000, signal: classI > 0 || (k >= 3 && p < 0.01) };
  }).sort((a, b) => b.classI - a.classI || a.p - b.p);
}

export type VehicleBurst = { ticker: string; name: string; recalls: VehicleRecall[]; units: number; usual: number; biggest: number; parkIt: boolean; signal: boolean };

/**
 * Vehicle recalls received in the last `windowDays` grouped by listed maker, against the maker's units
 * recalled in a window that long over the year before. A signal: 100,000 vehicles or more and at least
 * three times the usual, any single recall of 250,000 or more, or a do-not-drive or park-outside warning. Pure.
 */
export function vehicleBursts(year: VehicleRecall[], rules: NameRule[], now: number, windowDays = 14): VehicleBurst[] {
  const cut = new Date(now - windowDays * DAY).toISOString().slice(0, 10);
  const groups = new Map<string, { name: string; recent: VehicleRecall[]; before: number; beforeFrom: string }>();
  for (const r of year) {
    const hit = tickerFor(rules, r.maker);
    if (!hit) continue;
    const g = groups.get(hit.ticker) ?? { name: hit.name, recent: [], before: 0, beforeFrom: r.received };
    if (r.received >= cut) g.recent.push(r); else { g.before += r.units; if (r.received < g.beforeFrom) g.beforeFrom = r.received; }
    groups.set(hit.ticker, g);
  }
  const yearFrom = year.reduce((m, r) => (r.received < m ? r.received : m), cut);
  const spanDays = Math.max(windowDays, (Date.parse(cut) - Date.parse(yearFrom)) / DAY);
  return [...groups.entries()].filter(([, g]) => g.recent.length).map(([ticker, g]) => {
    const units = g.recent.reduce((t, r) => t + r.units, 0), biggest = Math.max(0, ...g.recent.map((r) => r.units)), parkIt = g.recent.some((r) => r.parkIt);
    const usual = Math.round((g.before * windowDays) / spanDays);
    return { ticker, name: g.name, recalls: g.recent.sort((a, b) => b.units - a.units), units, usual, biggest, parkIt, signal: (units >= 100_000 && units >= 3 * Math.max(usual, 1)) || biggest >= 250_000 || parkIt };
  }).sort((a, b) => b.units - a.units);
}

/** How big a vehicle burst is, 0 to 1, on a log scale (10,000 vehicles 0.25, a million 0.75); a park-it warning at least 0.6. Pure. */
export const vehicleMagnitude = (units: number, parkIt: boolean) => Math.round(Math.max(parkIt ? 0.6 : 0, Math.min(1, Math.max(0, (Math.log10(Math.max(1, units)) - 3) / 4))) * 100) / 100;
