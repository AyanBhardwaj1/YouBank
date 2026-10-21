/**
 * Federal Reserve Board data as fallbacks: the H.15 constant-maturity Treasury yields (for the curve,
 * when the Treasury's own feed fails) and the H.10 noon buying rates in New York (for currencies, after
 * the ECB). The Board's Data Download Program is being retired (its Build-Your-Package removal is planned
 * for the week of 9 November 2026), so both are read from FRED's copies of the Board's series, as the
 * research recommends: public-domain Fed data, credited to the Board and to FRED, and, under FRED's
 * terms, never cached (fredSeries keeps a series for the length of one request only).
 */
import type { CurveRow } from "./treasury";
import { fredSeries, type Obs } from "./fred";
import { canonical } from "./symbols";

/** H.15 constant-maturity series on FRED, by the Treasury curve's tenor names (yields in percent, as the Treasury's). */
export const H15_TENORS: [string, string][] = [
  ["1 Mo", "DGS1MO"], ["3 Mo", "DGS3MO"], ["6 Mo", "DGS6MO"], ["1 Yr", "DGS1"], ["2 Yr", "DGS2"], ["3 Yr", "DGS3"],
  ["5 Yr", "DGS5"], ["7 Yr", "DGS7"], ["10 Yr", "DGS10"], ["20 Yr", "DGS20"], ["30 Yr", "DGS30"],
];

/** How far back the fallback curve goes: enough for "1 year ago" on the GC screen. */
const CURVE_DAYS = 400;

/** H.15 series as curve rows, newest first (the Treasury feed's shape). Pure. */
export function curveFromH15(series: Record<string, Obs[]>): CurveRow[] {
  const byDate = new Map<string, Record<string, number>>();
  for (const [tenor, id] of H15_TENORS) {
    for (const o of series[id] ?? []) {
      const row = byDate.get(o.date) ?? {};
      row[tenor] = o.value;
      byDate.set(o.date, row);
    }
  }
  return [...byDate.entries()].filter(([, y]) => Object.keys(y).length >= 6).map(([date, yields]) => ({ date, yields })).sort((a, b) => (a.date < b.date ? 1 : -1));
}

/** The curve from the Fed's H.15 (via FRED), newest first; empty when FRED has nothing. */
export async function h15Curves(now = Date.now()): Promise<CurveRow[]> {
  const start = new Date(now - CURVE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const got = await Promise.all(H15_TENORS.map(async ([, id]) => [id, await fredSeries(id, start).catch(() => [] as Obs[])] as const));
  return curveFromH15(Object.fromEntries(got));
}

/** H.10 series on FRED by pair, each already in the market's quoting convention (EURUSD: dollars per euro). CNH uses the CNY rate. */
export const H10_SERIES: Record<string, string> = {
  EURUSD: "DEXUSEU", USDJPY: "DEXJPUS", GBPUSD: "DEXUSUK", USDCHF: "DEXSZUS", AUDUSD: "DEXUSAL",
  USDCAD: "DEXCAUS", USDCNH: "DEXCHUS", USDCNY: "DEXCHUS", USDMXN: "DEXMXUS", USDINR: "DEXINUS",
};

export const h10Covers = (symbol: string) => Object.hasOwn(H10_SERIES, canonical(symbol));

/** A pair's daily noon buying rates from the Fed's H.10 (via FRED), oldest first, from `from`. */
export async function h10Pair(symbol: string, from: string): Promise<{ date: string; close: number }[]> {
  const id = H10_SERIES[canonical(symbol)];
  if (!id) return [];
  return (await fredSeries(id, from)).filter((o) => o.value > 0).map((o) => ({ date: o.date, close: o.value }));
}
