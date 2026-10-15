/**
 * QF4, tier 0: ETF-proxy factors, available on day one from free daily prices of broad index funds, while
 * YouBank's own long-short factors (engine.ts) build up history from the point-in-time store. Each is a long-
 * only index fund against its benchmark, so it is a tilt, not an academic long-short factor, and every screen
 * says which set it used. Kenneth French's factors are not shown or redistributed (open question 3); they are
 * only compared with YouBank's offline (scripts/eval-factors.ts).
 *
 *   MKT  the S&P 500 (SPY) minus the risk-free rate (BIL, a 1-3 month Treasury bill fund)
 *   SMB  small minus large: Russell 2000 (IWM) minus Russell 1000 (IWB)
 *   HML  value minus growth: Russell 1000 Value (IWD) minus Russell 1000 Growth (IWF)
 *   MOM  momentum: MSCI USA Momentum (MTUM) minus SPY
 *   QMJ  quality: MSCI USA Quality (QUAL) minus SPY
 *   LVOL low volatility: MSCI USA Minimum Volatility (USMV) minus SPY
 * Investment (CMA) has no clean index-fund proxy and is left out of this tier.
 */
import { barReturns, loadBars } from "../pit/bars";

export const ETF_VERSION = "etf-2026-10-15.1";

export type FactorDef = { key: string; label: string; long: string; short: string; note: string };

export const ETF_FACTORS: FactorDef[] = [
  { key: "MKT", label: "Market", long: "SPY", short: "BIL", note: "S&P 500 fund minus Treasury bills" },
  { key: "SMB", label: "Size (small minus large)", long: "IWM", short: "IWB", note: "Russell 2000 fund minus Russell 1000 fund" },
  { key: "HML", label: "Value (value minus growth)", long: "IWD", short: "IWF", note: "Russell 1000 Value fund minus Russell 1000 Growth fund" },
  { key: "MOM", label: "Momentum", long: "MTUM", short: "SPY", note: "MSCI USA Momentum fund minus the S&P 500 fund" },
  { key: "QMJ", label: "Quality", long: "QUAL", short: "SPY", note: "MSCI USA Quality fund minus the S&P 500 fund" },
  { key: "LVOL", label: "Low volatility", long: "USMV", short: "SPY", note: "MSCI USA Minimum Volatility fund minus the S&P 500 fund" },
];

/** Index funds that track each factor, shown as "index funds that track this factor" (several, no affiliate links). */
export const FACTOR_FUNDS: Record<string, string[]> = {
  MKT: ["SPY", "VOO", "IVV", "VTI"], SMB: ["IWM", "VB", "IJR"], HML: ["IWD", "VTV", "IUSV"], MOM: ["MTUM", "SPMO"], QMJ: ["QUAL", "SPHQ"], LVOL: ["USMV", "SPLV"],
};

/** The funds Factor Lab's tracking mix chooses from (constrained least squares, weights >= 0 summing to 1). */
export const TRACKING_FUNDS = ["SPY", "IWM", "IWD", "IWF", "MTUM", "QUAL", "USMV"];

export type FactorPanel = { dates: string[]; names: string[]; rows: number[][]; source: string; version: string; missing: string[] };

/** Align several return series on common dates. Pure. */
export function align(series: Record<string, { dates: string[]; ret: number[] }>, names: string[]): { dates: string[]; rows: number[][] } {
  const maps = names.map((n) => new Map(series[n]?.dates.map((d, i) => [d, series[n].ret[i]]) ?? []));
  const dates = (series[names[0]]?.dates ?? []).filter((d) => maps.every((m) => m.has(d)));
  return { dates, rows: dates.map((d) => maps.map((m) => m.get(d)!)) };
}

/** Long-minus-short daily returns per factor, on common dates. Pure. */
export function buildEtfFactors(etf: Record<string, { dates: string[]; ret: number[] }>, defs = ETF_FACTORS): FactorPanel {
  const usable = defs.filter((f) => etf[f.long]?.dates.length && etf[f.short]?.dates.length);
  const funds = [...new Set(usable.flatMap((f) => [f.long, f.short]))];
  const a = align(etf, funds);
  const ix = new Map(funds.map((f, i) => [f, i]));
  return {
    dates: a.dates, names: usable.map((f) => f.key),
    rows: a.rows.map((r) => usable.map((f) => r[ix.get(f.long)!] - r[ix.get(f.short)!])),
    source: "ETF proxies: daily returns of index funds (" + usable.map((f) => `${f.key} = ${f.long} - ${f.short}`).join("; ") + ")",
    version: ETF_VERSION, missing: defs.filter((f) => !usable.includes(f)).map((f) => f.key),
  };
}

/** Daily returns of funds from the bar store or a live read. */
export async function fundReturns(symbols: string[], from: string): Promise<Record<string, { dates: string[]; ret: number[] }>> {
  const out: Record<string, { dates: string[]; ret: number[] }> = {};
  let i = 0;
  const list = [...new Set(symbols)];
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, async () => {
    while (i < list.length) { const s = list[i++]; const b = await loadBars(s, from).catch(() => null); if (b?.bars.c.length) out[s] = barReturns(b.bars); }
  }));
  return out;
}

/** ETF-proxy factor returns from `from` to today. */
export async function etfFactorPanel(from: string): Promise<FactorPanel> {
  const funds = [...new Set(ETF_FACTORS.flatMap((f) => [f.long, f.short]))];
  return buildEtfFactors(await fundReturns(funds, from));
}
