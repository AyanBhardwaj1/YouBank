/**
 * The clone backtest. Pure: prices come in, curves and statistics go out (scripts/test-copytrade.ts
 * checks the arithmetic on paths whose answers are known).
 *
 * What it simulates, and what it does not:
 * - Lag-aware: a clone can only buy a 13F once it is public. The "as filed" line buys each portfolio at
 *   the close of the first trading day after its filing date (a filing accepted after 4 pm cannot be
 *   traded that day, and EDGAR's daily index does not say which ones were), and holds it until the next
 *   filing. The "quarter end, no lag" line buys the same portfolio at the quarter-end close: what you
 *   would have earned if you had known the holdings the day they were held, which nobody did. The gap
 *   between the two is the cost of the 45-day lag.
 * - Weights are the 13F's market values at quarter end, rescaled to the clone's rules (targets.ts).
 *   Between rebalances the positions drift with prices (buy and hold).
 * - Price return on daily closes (split-adjusted). Dividends are not reinvested, there are no fees,
 *   commissions, spreads, slippage or taxes, no shorting and no options. A ticker with no price on the
 *   rebalance day is left out and the rest scaled up; a delisted holding carries its last price until the
 *   next filing. Survivorship and look-ahead in the ticker mapping (today's tickers for old CUSIPs) can
 *   flatter old periods.
 */

export type Close = { date: string; close: number };
export type RebalanceEvent = { date: string; weights: Record<string, number>; label?: string };
export type CurvePoint = { date: string; value: number };
export type Trade = { date: string; label?: string; held: string[]; missing: string[]; /** Share of the event's weight that had a price and was bought. */ pricedWeight: number };

/** The index of the first trading day on (or, with `after`, strictly after) a date. -1 when there is none. */
export function tradingIndex(calendar: string[], date: string, after: boolean): number {
  let lo = 0, hi = calendar.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (after ? calendar[mid] <= date : calendar[mid] < date) lo = mid + 1; else hi = mid;
  }
  return lo < calendar.length ? lo : -1;
}

/**
 * Simulate a portfolio that rebalances to each event's weights. `after` = true trades at the first close
 * strictly after the event date (the lagged clone); false trades on the event date itself when it is a
 * trading day (the quarter-end line). The curve starts at 100 on the first trade.
 */
export function simulate(events: RebalanceEvent[], prices: Record<string, Close[]>, calendar: string[], after: boolean): { curve: CurvePoint[]; trades: Trade[] } {
  const at = new Map<number, RebalanceEvent>();
  for (const e of [...events].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    const i = tradingIndex(calendar, e.date, after);
    if (i >= 0) at.set(i, e); // two events landing on one day: the later one wins
  }
  const byTicker = new Map<string, Map<string, number>>();
  for (const [t, xs] of Object.entries(prices)) byTicker.set(t, new Map(xs.filter((x) => x.close > 0).map((x) => [x.date, x.close])));
  const last = new Map<string, number>();
  let units = new Map<string, number>();
  let cash = 0;
  let started = false;
  const curve: CurvePoint[] = [];
  const trades: Trade[] = [];
  for (let i = 0; i < calendar.length; i++) {
    const d = calendar[i];
    for (const [t, m] of byTicker) { const p = m.get(d); if (p !== undefined) last.set(t, p); }
    const value = () => cash + [...units].reduce((s, [t, u]) => s + u * (last.get(t) ?? 0), 0);
    const ev = at.get(i);
    if (ev) {
      const v = started ? value() : 100;
      const held = Object.entries(ev.weights).filter(([t, w]) => w > 0 && (last.get(t) ?? 0) > 0);
      const missing = Object.entries(ev.weights).filter(([t, w]) => w > 0 && !((last.get(t) ?? 0) > 0)).map(([t]) => t);
      const wsum = held.reduce((s, [, w]) => s + w, 0);
      if (held.length && wsum > 0) {
        units = new Map(held.map(([t, w]) => [t, (v * (w / wsum)) / last.get(t)!]));
        cash = 0;
      } else if (!started) {
        cash = v; // nothing priced yet: start in cash
      }
      started = true;
      const total = Object.values(ev.weights).reduce((s, w) => s + Math.max(0, w), 0);
      trades.push({ date: d, label: ev.label, held: held.map(([t]) => t), missing, pricedWeight: total > 0 ? wsum / total : 0 });
    }
    if (started) curve.push({ date: d, value: value() });
  }
  return { curve, trades };
}

/** A price series as a curve starting at 100 on `from` (for the benchmark line). */
export function indexFrom(xs: Close[], from: string): CurvePoint[] {
  const s = xs.filter((x) => x.date >= from && x.close > 0);
  if (!s.length) return [];
  const base = s[0].close;
  return s.map((x) => ({ date: x.date, value: (100 * x.close) / base }));
}

export type Metrics = { totalReturn: number; cagr: number; volatility: number; sharpe: number | null; maxDrawdown: number; beta: number | null; days: number; from: string; to: string };

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}

export const dailyReturns = (c: CurvePoint[]): { date: string; r: number }[] => c.slice(1).map((p, i) => ({ date: p.date, r: c[i].value > 0 ? p.value / c[i].value - 1 : 0 }));

/** Largest fall from a running peak, as a negative fraction (-0.25 is a 25% drawdown). */
export function maxDrawdown(c: CurvePoint[]): number {
  let peak = -Infinity, worst = 0;
  for (const p of c) { peak = Math.max(peak, p.value); if (peak > 0) worst = Math.min(worst, p.value / peak - 1); }
  return worst;
}

/** Beta of `r` against `b`, on the dates both have. */
export function beta(r: { date: string; r: number }[], b: { date: string; r: number }[]): number | null {
  const bm = new Map(b.map((x) => [x.date, x.r]));
  const pairs = r.filter((x) => bm.has(x.date)).map((x) => [x.r, bm.get(x.date)!] as const);
  if (pairs.length < 20) return null;
  const mr = mean(pairs.map((p) => p[0])), mb = mean(pairs.map((p) => p[1]));
  let cov = 0, vb = 0;
  for (const [x, y] of pairs) { cov += (x - mr) * (y - mb); vb += (y - mb) ** 2; }
  return vb > 0 ? cov / vb : null;
}

/**
 * Annualised statistics of a daily curve: CAGR over calendar days, volatility from daily returns
 * (252 trading days a year), Sharpe as annualised mean return less `riskFree` over volatility, the
 * maximum drawdown, and beta against a benchmark curve.
 */
export function metrics(c: CurvePoint[], bench?: CurvePoint[], riskFree = 0): Metrics | null {
  if (c.length < 2 || !(c[0].value > 0)) return null;
  const days = (Date.parse(c[c.length - 1].date) - Date.parse(c[0].date)) / 86_400_000;
  const total = c[c.length - 1].value / c[0].value - 1;
  const rs = dailyReturns(c);
  const vol = stdev(rs.map((x) => x.r)) * Math.sqrt(252);
  return {
    totalReturn: total,
    cagr: days > 0 ? Math.pow(1 + total, 365.25 / days) - 1 : 0,
    volatility: vol,
    sharpe: vol > 0 ? (mean(rs.map((x) => x.r)) * 252 - riskFree) / vol : null,
    maxDrawdown: maxDrawdown(c),
    beta: bench ? beta(rs, dailyReturns(bench)) : null,
    days: Math.round(days), from: c[0].date, to: c[c.length - 1].date,
  };
}

/** A long curve thinned for a chart (every k-th point, always the last), keeping the shape. */
export function thin(c: CurvePoint[], max = 260): CurvePoint[] {
  if (c.length <= max) return c;
  const k = Math.ceil(c.length / max);
  return c.filter((_, i) => i % k === 0 || i === c.length - 1);
}

/** Annual one-way turnover from rebalance weights: half the absolute weight changes per rebalance, per year. */
export function annualTurnover(events: { date: string; weights: Record<string, number> }[]): number {
  if (events.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < events.length; i++) {
    const a = events[i - 1].weights, b = events[i].weights;
    let s = 0;
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) s += Math.abs((b[k] ?? 0) - (a[k] ?? 0));
    total += s / 2;
  }
  const years = (Date.parse(events.at(-1)!.date) - Date.parse(events[0].date)) / (365.25 * 86_400_000);
  return years > 0 ? total / years : 0;
}
