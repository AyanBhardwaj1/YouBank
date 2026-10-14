/**
 * Paper copies: a pretend account that follows a fund with no money at stake. Free for everyone. Pure,
 * for tests: the cron and the routes pass in prices.
 *
 * A paper copy starts with its dollar size in cash and buys the clone's targets at the latest prices.
 * Each new 13F (or 13F/A that changes the latest quarter) rebalances it at the prices of the day the
 * filing is processed, so its record shows what following the fund from the day you started would have
 * done. Fractional shares, no fees, commissions or taxes, dividends not counted; a holding with no price
 * that day is kept as it is until it has one.
 */
import type { Close, CurvePoint } from "./backtest";

export type PaperEvent = { date: string; accession: string | null; label: string; cash: number; units: Record<string, number> };
export type PaperState = { startCash: number; startedAt: string; events: PaperEvent[] };

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Value of a set of units and cash at given prices; holdings without a price count at `fallback` prices, else zero. */
export function paperValue(e: Pick<PaperEvent, "cash" | "units">, prices: Record<string, number>, fallback: Record<string, number> = {}): number {
  return e.cash + Object.entries(e.units).reduce((s, [t, u]) => s + u * (prices[t] ?? fallback[t] ?? 0), 0);
}

/** Rebalance (or start) a paper copy to `targets` at `prices` on `date`. Returns the new state. */
export function paperRebalance(state: PaperState | null, targets: { ticker: string; weight: number }[], prices: Record<string, number>, date: string, accession: string | null, label: string, startCash: number): PaperState {
  const prev: PaperEvent = state?.events.at(-1) ?? { date, accession: null, label: "Start", cash: startCash, units: {} };
  // Holdings with no price today cannot be sold: they stay, and the rest of the money is rebalanced.
  const stuck: Record<string, number> = {};
  let money = prev.cash;
  for (const [t, u] of Object.entries(prev.units)) { if (prices[t] > 0) money += u * prices[t]; else stuck[t] = u; }
  const buyable = targets.filter((t) => t.weight > 0 && prices[t.ticker] > 0 && !(t.ticker in stuck));
  const wsum = buyable.reduce((s, t) => s + t.weight, 0);
  const units: Record<string, number> = { ...stuck };
  let spent = 0;
  if (wsum > 0) for (const t of buyable) { const u = r6((money * (t.weight / wsum)) / prices[t.ticker]); units[t.ticker] = u; spent += u * prices[t.ticker]; }
  const event: PaperEvent = { date, accession, label, cash: Math.max(0, r6(money - spent)), units };
  return { startCash: state?.startCash ?? startCash, startedAt: state?.startedAt ?? date, events: [...(state?.events ?? []), event].slice(-80) };
}

/** Daily value of a paper copy from its start, on the given trading days (prices carried forward). */
export function paperCurve(state: PaperState, prices: Record<string, Close[]>, calendar: string[]): CurvePoint[] {
  const by = new Map(Object.entries(prices).map(([t, xs]) => [t, new Map(xs.map((x) => [x.date, x.close]))]));
  const last: Record<string, number> = {};
  const out: CurvePoint[] = [];
  let k = -1;
  for (const d of calendar) {
    for (const [t, m] of by) { const p = m.get(d); if (p !== undefined && p > 0) last[t] = p; }
    if (d < state.startedAt) continue;
    while (k + 1 < state.events.length && state.events[k + 1].date <= d) k++;
    if (k < 0) continue;
    out.push({ date: d, value: paperValue(state.events[k], last) });
  }
  return out;
}
