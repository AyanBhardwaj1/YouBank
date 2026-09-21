import { DAY, edgarJson } from "./client";
import { cacheJson } from "@/lib/cache";
import type { TickerRow } from "../types";

type Raw = Record<string, { cik_str: number; ticker: string; title: string }>;

let mapPromise: Promise<Map<string, TickerRow>> | null = null;

/** Ticker -> { cik (10 digits), ticker, name } from SEC's company_tickers.json, cached one day. */
export function tickerMap(): Promise<Map<string, TickerRow>> {
  if (!mapPromise) {
    mapPromise = cacheJson<Raw>("edgar:company_tickers", DAY, () => edgarJson<Raw>("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", DAY)).then((raw) => {
      const m = new Map<string, TickerRow>();
      for (const r of Object.values(raw)) {
        m.set(r.ticker.toUpperCase(), { cik: String(r.cik_str).padStart(10, "0"), ticker: r.ticker.toUpperCase(), name: r.title });
      }
      return m;
    });
    mapPromise.catch(() => { mapPromise = null; });
  }
  return mapPromise;
}

export async function resolveTicker(ticker: string): Promise<TickerRow | null> {
  return (await tickerMap()).get(ticker.toUpperCase()) ?? null;
}

/** Prefix match on ticker, substring match on name. Ticker matches rank first. */
export async function searchTickers(q: string, limit = 8): Promise<TickerRow[]> {
  const needle = q.trim().toUpperCase();
  if (!needle) return [];
  const rows = [...(await tickerMap()).values()];
  const byTicker = rows.filter((r) => r.ticker.startsWith(needle));
  const byName = rows.filter((r) => !r.ticker.startsWith(needle) && r.name.toUpperCase().includes(needle));
  return [...byTicker.sort((a, b) => a.ticker.length - b.ticker.length), ...byName].slice(0, limit);
}
