/**
 * Prices and inputs for backtests and ticks, from the market data layer (lib/market/data: FMP where the
 * plan covers a symbol, then Nasdaq's public API; CoinGecko for the large coins), each answer cached and
 * its source named. Server only.
 *
 * - `loadPanel`: daily bars (opens and closes) for a strategy's symbols and its benchmark on the
 *   benchmark's calendar, forward-filled, with the symbols no source had.
 * - `copyTimeline`: for 13F-copy strategies, every filing date's clone weights as then known (copy
 *   trading's own lag-aware events), so a backtest trades each filing only after it was public.
 * - `quotesFor`: latest prices as quotes for the paper broker and the risk engine's reference prices.
 */
import { withProvenance, type Provider } from "@/lib/market/provenance";
import { historyFrom, quotes } from "@/lib/market/data";
import { canonical } from "@/lib/market/symbols";
import { cloneEvents } from "@/lib/copytrade/analytics";
import type { BrokerQuote } from "./brokers/types";
import { panelOf, type Panel } from "./evaluate";
import { symbolsOf, type StrategySpec } from "./strategy";

/** Our symbol as the market data layer takes it: canonical (BRK-B → BRK.B; each feed respells it), BTC-USD → BTCUSD. */
export const dataSymbol = (s: string) => (/-USD$/.test(s) ? s.replace("-", "") : canonical(s));

async function pool<T>(xs: T[], n: number, f: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) await f(xs[i++]); }));
}

export type Loaded = { panel: Panel; opens: Record<string, number[]>; missing: string[]; providers: Provider[]; notes: string[] };

export async function loadPanel(symbols: string[], benchmark: string, from: string, opts: { deadline?: number } = {}): Promise<Loaded> {
  const list = [...new Set([...symbols, benchmark])].slice(0, 40);
  const { value, providers, notes } = await withProvenance(async () => {
    const bars: Record<string, { date: string; open: number; close: number }[]> = {};
    const missing: string[] = [];
    await pool(list, 6, async (s) => {
      if (opts.deadline && Date.now() > opts.deadline) { missing.push(s); return; }
      try {
        const r = await historyFrom(dataSymbol(s), from, false);
        if (r.data.length) bars[s] = r.data.map((b) => ({ date: b.date, open: b.open, close: b.close })).sort((a, b) => (a.date < b.date ? -1 : 1));
        else missing.push(s);
      } catch { missing.push(s); }
    });
    return { bars, missing };
  });
  const cal = (value.bars[benchmark] ?? Object.values(value.bars).sort((a, b) => b.length - a.length)[0] ?? []).map((b) => b.date);
  const panel = panelOf(cal, Object.fromEntries(Object.entries(value.bars).map(([k, xs]) => [k, xs.map((x) => ({ date: x.date, close: x.close }))])));
  const opens: Record<string, number[]> = {};
  for (const [k, xs] of Object.entries(value.bars)) {
    const m = new Map(xs.map((x) => [x.date, x.open]));
    // Bars from a closes-only source carry open = close; those are not real opens, so they are left out.
    opens[k] = cal.map((d, i) => { const o = m.get(d); return o && o > 0 && o !== panel.closes[k][i] ? o : NaN; });
    if (opens[k].every((v) => !Number.isFinite(v))) delete opens[k];
  }
  return { panel, opens, missing: value.missing, providers, notes };
}

/** The symbols a strategy needs and the window to load for `years` of decisions after its warm-up. */
export function windowFor(spec: StrategySpec, years: number, now = new Date()): { symbols: string[]; from: string } {
  const warmDays = Math.ceil((Math.max(300, 2 * 260) * 7) / 5);
  const from = new Date(now.getTime() - years * 365.25 * 86_400_000 - warmDays * 86_400_000).toISOString().slice(0, 10);
  return { symbols: symbolsOf(spec), from };
}

/** Clone weights by filing date for a 13F-copy strategy (copy trading's lag-aware events). */
export async function copyTimeline(cik: string, top: number, years: number): Promise<{ date: string; weights: Record<string, number> }[]> {
  return (await cloneEvents(cik, top, years)).map((e) => ({ date: e.date, weights: e.weights }));
}

/** Latest prices as quotes (no bid and ask from these sources: the paper broker adds its spread). */
export async function quotesFor(symbols: string[]): Promise<Record<string, BrokerQuote>> {
  if (!symbols.length) return {};
  const q = await quotes(symbols.map(dataSymbol)).catch(() => ({} as Record<string, { price: number }>));
  const out: Record<string, BrokerQuote> = {};
  const at = new Date().toISOString();
  for (const s of symbols) { const p = q[dataSymbol(s)]?.price; if (p && p > 0) out[s] = { symbol: s, bid: null, ask: null, last: p, at }; }
  return out;
}
