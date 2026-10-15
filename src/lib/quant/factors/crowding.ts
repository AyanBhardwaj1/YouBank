/**
 * QF4: crowding, three measures per factor, each read as a percentile of its own history. Crowding is shown as a
 * risk warning, never as a timing signal: crowded factors have fallen together (the August 2007 quant quake,
 * Khandani and Lo), but timing factors on crowding has not reliably paid. Pure.
 *
 * - Valuation spread: the long leg's aggregate book-to-market over the short leg's (AQR's measure). For value,
 *   a wide spread means value is cheap; for other factors, a narrow spread means the long side is expensive.
 * - Comovement: the average pairwise correlation of the long leg's market-adjusted weekly returns over 52
 *   weeks ("comomentum", Lou and Polk).
 * - Ownership concentration: the share of the long leg's market value held by the 13F filers YouBank tracks as
 *   hedge funds (the copy-trading store), against its history.
 */
import { corr } from "../stats/core";

export type Leg = { symbol: string; mcap: number; bm: number | null }[];

/** Aggregate book-to-market of the long leg over the short leg's (Σ book / Σ market value each). */
export function valuationSpread(long: Leg, short: Leg): number | null {
  const agg = (l: Leg) => { const ok = l.filter((x) => x.bm !== null && x.bm > 0 && x.mcap > 0); const me = ok.reduce((s, x) => s + x.mcap, 0); return me > 0 ? ok.reduce((s, x) => s + (x.bm as number) * x.mcap, 0) / me : null; };
  const a = agg(long), b = agg(short);
  return a !== null && b !== null && b > 0 ? a / b : null;
}

/** Average pairwise correlation of the columns of `weekly` (each column one stock's weekly excess returns). */
export function comovement(weekly: number[][]): number | null {
  const k = weekly.length;
  if (k < 2) return null;
  let s = 0, n = 0;
  for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) { const c = corr(weekly[i], weekly[j]); if (Number.isFinite(c)) { s += c; n++; } }
  return n ? s / n : null;
}

/** Weekly (5-session) compounded returns of a daily series minus the market's. */
export function weeklyExcess(daily: number[], market: number[]): number[] {
  const out: number[] = [];
  for (let t = 0; t + 5 <= Math.min(daily.length, market.length); t += 5) {
    let a = 1, b = 1;
    for (let k = t; k < t + 5; k++) { a *= 1 + daily[k]; b *= 1 + market[k]; }
    out.push(a - b);
  }
  return out;
}

/** Share of the leg's market value held by tracked hedge funds' 13F positions (value held by symbol). */
export function ownershipShare(leg: { symbol: string; mcap: number }[], held: Map<string, number>): number | null {
  const me = leg.reduce((s, x) => s + x.mcap, 0);
  return me > 0 ? leg.reduce((s, x) => s + Math.min(held.get(x.symbol) ?? 0, x.mcap), 0) / me : null;
}

/** Where a value sits in its own history (0 = lowest, 1 = highest); null with fewer than 12 points. */
export function percentileOf(value: number, history: number[]): number | null {
  const h = history.filter(Number.isFinite);
  if (h.length < 12 || !Number.isFinite(value)) return null;
  return h.filter((x) => x < value).length / h.length + 0.5 * (h.filter((x) => x === value).length / h.length);
}

export type CrowdingPoint = { date: string; factor: string; spread: number | null; comove: number | null; ownership: number | null };
export type CrowdingNow = { factor: string; date: string; spread: { value: number | null; pct: number | null }; comove: { value: number | null; pct: number | null }; ownership: { value: number | null; pct: number | null }; crowded: boolean; months: number };

/**
 * The latest reading per factor with percentiles of its own history. "Crowded" when comovement or ownership is
 * above the 90th percentile, or (for factors other than value) the valuation spread is below the 10th.
 */
export function crowdingNow(points: CrowdingPoint[]): CrowdingNow[] {
  const by = new Map<string, CrowdingPoint[]>();
  for (const p of points) by.set(p.factor, [...(by.get(p.factor) ?? []), p]);
  return [...by.entries()].map(([factor, ps]) => {
    const s = ps.sort((a, b) => a.date.localeCompare(b.date)), last = s[s.length - 1];
    const hist = (k: "spread" | "comove" | "ownership") => s.map((p) => p[k]).filter((v): v is number => v !== null);
    const at = (k: "spread" | "comove" | "ownership") => ({ value: last[k], pct: last[k] === null ? null : percentileOf(last[k] as number, hist(k)) });
    const spread = at("spread"), comove = at("comove"), ownership = at("ownership");
    const crowded = (comove.pct ?? 0) > 0.9 || (ownership.pct ?? 0) > 0.9 || (factor !== "HML" && spread.pct !== null && spread.pct < 0.1);
    return { factor, date: last.date, spread, comove, ownership, crowded, months: s.length };
  });
}
