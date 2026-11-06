/**
 * The Book's risk, from daily closes: what a small fund's risk system would tell the PM, worked out from the
 * positions' weights and a year of prices, with nothing modelled that the data cannot show.
 *
 * - Beta to the S&P 500 (SPY) for each name, and the book's beta-adjusted net exposure: how much of NAV moves
 *   with the market. A market move of -10% then costs about betaNet × 10% of NAV.
 * - Volatility, and a one-day 95% value at risk and expected shortfall, read off the book's own daily P&L
 *   over the last year with today's weights (historical simulation; no normal-distribution assumption).
 * - Each name's share of the book's risk (its Euler contribution to variance), so a 3% position that drives
 *   40% of the risk is visible.
 * - Correlated pairs: two longs that move together are one bet in two tickets ("stacked"); a long and a short
 *   that move together hedge each other.
 * - Stress replays: today's book through real episodes (the COVID crash, the 2022 rate shock, SVB, the yen
 *   carry unwind, the April 2025 tariff shock), each name's own return over the window. A name that did not
 *   trade then is listed as left out, never counted as flat.
 *
 * Weights are % of NAV; every P&L figure here is % of NAV. Pure (safe on the client), tested in
 * scripts/test-book.ts; prices are fetched in ./risk-store.ts.
 */
export type Close = { date: string; close: number };
export type RiskInput = { ticker: string; direction: "long" | "short"; weight: number | null };

export const BENCHMARK = "SPY";
export const RISK_DAYS = 252;
/** A name needs this many daily returns in the window to be in the risk figures (a recent IPO is left out). */
export const MIN_RETURNS = 120;

export const SCENARIOS = [
  { id: "covid", label: "COVID crash", from: "2020-02-19", to: "2020-03-23" },
  { id: "rates-2022", label: "2022 rate shock", from: "2022-01-03", to: "2022-06-16" },
  { id: "svb", label: "SVB and regional banks", from: "2023-03-08", to: "2023-03-17" },
  { id: "yen-carry", label: "Yen carry unwind", from: "2024-07-16", to: "2024-08-05" },
  { id: "tariffs-2025", label: "April 2025 tariff shock", from: "2025-04-02", to: "2025-04-08" },
] as const;
/** The earliest date the replays need, for fetching. */
export const HISTORY_FROM = "2020-01-02";
export const SHOCKS = [-20, -10, -5, 5, 10];

export type PositionRisk = { ticker: string; direction: "long" | "short"; weight: number; beta: number | null; vol: number | null; riskShare: number | null };
export type Pair = { a: string; b: string; rho: number; kind: "stacked" | "hedge"; weight: number };
export type ScenarioResult = { id: string; label: string; from: string; to: string; pnl: number | null; market: number | null; covered: number; missing: string[]; worst: { ticker: string; pnl: number }[] };
export type BookRisk = {
  asOf: string; benchmark: string;
  window: { from: string; to: string; days: number } | null;
  betaNet: number | null; vol: number | null; var95: number | null; es95: number | null;
  positions: PositionRisk[]; pairs: Pair[];
  shocks: { move: number; pnl: number }[];
  scenarios: ScenarioResult[];
  excluded: { ticker: string; reason: string }[];
};

const r2 = (x: number) => Math.round(x * 100) / 100;
const sign = (d: "long" | "short") => (d === "long" ? 1 : -1);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The risk with where its prices came from (the server adds these). */
export type SourcedRisk = BookRisk & { sources: string[]; missingPrices: string[] };

/** The last close on or before a date. */
export function closeOn(xs: Close[], date: string): Close | null {
  let lo = 0, hi = xs.length - 1, best: Close | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid].date <= date) { best = xs[mid]; lo = mid + 1; } else hi = mid - 1;
  }
  return best;
}

/** Daily returns on the benchmark's calendar: one entry per benchmark day, null where the name has no close that day or the day before. */
export function returnsOn(calendar: string[], xs: Close[]): (number | null)[] {
  const by = new Map(xs.map((c) => [c.date, c.close]));
  const out: (number | null)[] = [];
  for (let i = 1; i < calendar.length; i++) {
    const a = by.get(calendar[i - 1]), b = by.get(calendar[i]);
    out.push(a && b && a > 0 ? b / a - 1 : null);
  }
  return out;
}

function covar(x: (number | null)[], y: (number | null)[]): { cov: number; vx: number; vy: number; n: number } {
  const pairs: [number, number][] = [];
  for (let i = 0; i < x.length; i++) if (x[i] !== null && y[i] !== null) pairs.push([x[i] as number, y[i] as number]);
  const n = pairs.length;
  if (n < 2) return { cov: 0, vx: 0, vy: 0, n };
  const mx = mean(pairs.map((p) => p[0])), my = mean(pairs.map((p) => p[1]));
  let cov = 0, vx = 0, vy = 0;
  for (const [a, b] of pairs) { cov += (a - mx) * (b - my); vx += (a - mx) ** 2; vy += (b - my) ** 2; }
  return { cov: cov / (n - 1), vx: vx / (n - 1), vy: vy / (n - 1), n };
}

/** The p-quantile of a sorted list (linear between points). */
function quantile(sorted: number[], p: number): number {
  const at = (sorted.length - 1) * p, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** A replay of today's book over one episode. */
export function replay(book: RiskInput[], prices: Record<string, Close[]>, s: { id: string; label: string; from: string; to: string }): ScenarioResult {
  const missing: string[] = [];
  const parts: { ticker: string; pnl: number }[] = [];
  let covered = 0;
  for (const p of book) {
    if (!p.weight) continue;
    const xs = prices[p.ticker] ?? [];
    const a = closeOn(xs, s.from), b = closeOn(xs, s.to);
    // The name must have traded at the start of the episode (a close within a week of it), or it is left out.
    if (!a || !b || a.close <= 0 || Date.parse(s.from) - Date.parse(a.date) > 7 * 86_400_000) { missing.push(p.ticker); continue; }
    parts.push({ ticker: p.ticker, pnl: sign(p.direction) * p.weight * (b.close / a.close - 1) });
    covered += p.weight;
  }
  const m = prices[BENCHMARK] ?? [];
  const ma = closeOn(m, s.from), mb = closeOn(m, s.to);
  return {
    id: s.id, label: s.label, from: s.from, to: s.to,
    pnl: parts.length ? r2(parts.reduce((x, y) => x + y.pnl, 0)) : null,
    market: ma && mb && ma.close > 0 ? r2((mb.close / ma.close - 1) * 100) : null,
    covered: r2(covered), missing,
    worst: parts.filter((x) => x.pnl < 0).sort((x, y) => x.pnl - y.pnl).slice(0, 3).map((x) => ({ ticker: x.ticker, pnl: r2(x.pnl) })),
  };
}

/** The book's risk from daily closes (each list oldest first; the benchmark under BENCHMARK). */
export function bookRisk(book: RiskInput[], prices: Record<string, Close[]>, now = new Date()): BookRisk {
  const excluded: { ticker: string; reason: string }[] = [];
  const bench = prices[BENCHMARK] ?? [];
  const calendar = bench.slice(-(RISK_DAYS + 1)).map((c) => c.date);
  const empty: BookRisk = { asOf: now.toISOString(), benchmark: BENCHMARK, window: null, betaNet: null, vol: null, var95: null, es95: null, positions: [], pairs: [], shocks: [], scenarios: [], excluded };
  const sized = book.filter((p) => {
    if (p.weight && p.weight > 0) return true;
    excluded.push({ ticker: p.ticker, reason: "no weight" });
    return false;
  });
  const scenarios = SCENARIOS.map((s) => replay(sized, prices, s));
  if (calendar.length < MIN_RETURNS + 1) return { ...empty, scenarios, excluded: [...excluded, ...(bench.length ? [] : [{ ticker: BENCHMARK, reason: "no benchmark prices" }])] };

  const m = returnsOn(calendar, bench);
  const rows: { p: RiskInput & { weight: number }; r: (number | null)[]; beta: number | null; vol: number | null }[] = [];
  for (const p of sized) {
    const xs = prices[p.ticker];
    if (!xs?.length) { excluded.push({ ticker: p.ticker, reason: "no prices" }); continue; }
    const r = returnsOn(calendar, xs);
    const n = r.filter((x) => x !== null).length;
    if (n < MIN_RETURNS) { excluded.push({ ticker: p.ticker, reason: `${n} trading days of prices in the last year` }); continue; }
    const c = covar(r, m);
    rows.push({ p: p as RiskInput & { weight: number }, r, beta: c.vx > 0 && c.vy > 0 ? c.cov / c.vy : null, vol: c.vx > 0 ? Math.sqrt(c.vx * 252) * 100 : null });
  }
  if (!rows.length) return { ...empty, scenarios, excluded };

  // The book's daily P&L (% NAV) with today's weights; a name's missing day counts as unchanged.
  const pnl = m.map((_, t) => rows.reduce((acc, x) => acc + sign(x.p.direction) * x.p.weight * (x.r[t] ?? 0), 0));
  const sorted = [...pnl].sort((a, b) => a - b);
  const q = quantile(sorted, 0.05);
  const tail = sorted.filter((x) => x <= q);
  const bookVar = covar(pnl, pnl).vx;
  const betaNet = rows.reduce((acc, x) => acc + sign(x.p.direction) * x.p.weight * (x.beta ?? 0), 0);

  const positions: PositionRisk[] = rows.map((x) => {
    // Euler contribution: w·cov(r_i, book) / var(book).
    const c = covar(x.r.map((v) => (v === null ? 0 : sign(x.p.direction) * x.p.weight * v)), pnl);
    return { ticker: x.p.ticker, direction: x.p.direction, weight: x.p.weight, beta: x.beta === null ? null : r2(x.beta), vol: x.vol === null ? null : r2(x.vol), riskShare: bookVar > 0 ? r2((c.cov / bookVar) * 100) : null };
  }).sort((a, b) => (b.riskShare ?? 0) - (a.riskShare ?? 0));

  const pairs: Pair[] = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const c = covar(rows[i].r, rows[j].r);
    if (c.n < MIN_RETURNS || c.vx <= 0 || c.vy <= 0) continue;
    const rho = c.cov / Math.sqrt(c.vx * c.vy);
    if (Math.abs(rho) < 0.7) continue;
    const same = rows[i].p.direction === rows[j].p.direction;
    // Moving together and held the same way: one bet; moving together and held opposite ways: a hedge.
    const kind: Pair["kind"] = (rho > 0) === same ? "stacked" : "hedge";
    pairs.push({ a: rows[i].p.ticker, b: rows[j].p.ticker, rho: r2(rho), kind, weight: r2(rows[i].p.weight + rows[j].p.weight) });
  }
  pairs.sort((a, b) => Math.abs(b.rho) * b.weight - Math.abs(a.rho) * a.weight);

  return {
    asOf: now.toISOString(), benchmark: BENCHMARK,
    window: { from: calendar[0], to: calendar[calendar.length - 1], days: m.length },
    betaNet: r2(betaNet), vol: r2(Math.sqrt(bookVar * 252)), var95: r2(Math.max(0, -q)), es95: r2(Math.max(0, -mean(tail))),
    positions, pairs: pairs.slice(0, 8),
    shocks: SHOCKS.map((move) => ({ move, pnl: r2((betaNet * move) / 100) })),
    scenarios, excluded,
  };
}

/** One line for a person: the headline numbers. */
export function riskLine(r: BookRisk): string {
  if (r.betaNet === null) return "Not enough price history to measure the book's risk.";
  const worst = r.scenarios.filter((s) => s.pnl !== null).sort((a, b) => (a.pnl ?? 0) - (b.pnl ?? 0))[0];
  return `Beta-adjusted net ${r.betaNet >= 0 ? "+" : ""}${r.betaNet}% of NAV; one-day 95% VaR ${r.var95}% of NAV${worst ? `; worst replay: ${worst.label}, ${worst.pnl! >= 0 ? "+" : ""}${worst.pnl}%` : ""}.`;
}
