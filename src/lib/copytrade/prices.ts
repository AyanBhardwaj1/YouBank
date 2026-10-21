/**
 * Daily closes and latest prices for clones, from the terminal's market data layer (lib/market/data):
 * FMP where the plan covers the symbol, then Nasdaq's public quote API, every answer cached. Free to us
 * on the current plans. Each result says which sources answered, so pages can cite them.
 */
import { historyFrom, quotes } from "@/lib/market/data";
import { withProvenance, type Provider } from "@/lib/market/provenance";
import { canonical } from "@/lib/market/symbols";
import type { Close } from "./backtest";

async function pool<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => { while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); } }));
  return out;
}

/** Daily closes from `from` for each ticker (at most `max`), with the tickers no source had. */
export async function dailyCloses(tickers: string[], from: string, opts: { max?: number; deadline?: number } = {}): Promise<{ prices: Record<string, Close[]>; missing: string[]; providers: Provider[]; notes: string[] }> {
  const list = [...new Set(tickers)].slice(0, opts.max ?? 150);
  const { value, providers, notes } = await withProvenance(async () => {
    const prices: Record<string, Close[]> = {};
    const missing: string[] = [];
    await pool(list, 6, async (t) => {
      if (opts.deadline && Date.now() > opts.deadline) { missing.push(t); return; }
      // One request: each feed spells the symbol its own way (SEC's BRK-B is BRK.B on Nasdaq) at its boundary.
      try {
        const r = await historyFrom(canonical(t), from, true);
        if (r.data.length) { prices[t] = r.data.map((b) => ({ date: b.date, close: b.close })).sort((a, b) => (a.date < b.date ? -1 : 1)); return; }
      } catch { /* no source has it */ }
      missing.push(t);
    });
    return { prices, missing };
  });
  return { ...value, providers, notes };
}

/** Latest prices (quotes, falling back to the last close) for a list of tickers. */
export async function latestPrices(tickers: string[]): Promise<{ prices: Record<string, number>; providers: Provider[] }> {
  const list = [...new Set(tickers)];
  const { value, providers } = await withProvenance(async () => {
    const out: Record<string, number> = {};
    const q = await quotes(list.map(canonical)).catch(() => ({} as Record<string, { price: number }>));
    for (const t of list) { const p = q[canonical(t)]?.price; if (p && p > 0) out[t] = p; }
    const missing = list.filter((t) => !out[t]);
    if (missing.length) {
      const from = new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);
      const c = await dailyCloses(missing, from, { max: 60 });
      for (const [t, xs] of Object.entries(c.prices)) if (xs.length) out[t] = xs[xs.length - 1].close;
    }
    return out;
  });
  return { prices: value, providers };
}
