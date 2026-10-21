import { z } from "zod";
import { forSec } from "@/lib/market/symbols";
import { parseOrThrow } from "@/lib/market/validate";
import { DAY, edgarJson } from "./client";
import type { TickerRow } from "../types";

/** SEC's company_tickers.json: { "0": { cik_str, ticker, title }, … }. */
const TickerFile = z.record(z.string(), z.looseObject({ cik_str: z.union([z.number(), z.string().regex(/^\d+$/)]), ticker: z.string(), title: z.string() }));

/** The ticker file, checked (drift is SourceError "schema"), as ticker -> row in SEC's own spelling (BRK-B). */
export function parseTickerFile(raw: unknown): Map<string, TickerRow> {
  const m = new Map<string, TickerRow>();
  for (const r of Object.values(parseOrThrow(TickerFile, raw, "SEC EDGAR", "company_tickers.json"))) {
    m.set(r.ticker.toUpperCase(), { cik: String(r.cik_str).padStart(10, "0"), ticker: r.ticker.toUpperCase(), name: r.title });
  }
  return m;
}

/** A ticker as typed (BRK.B, brk/b, "BRK B") looked up in SEC's map, which spells classes BRK-B. */
export const findTicker = (map: Map<string, TickerRow>, ticker: string): TickerRow | null => map.get(forSec(ticker)) ?? null;

let mapPromise: Promise<Map<string, TickerRow>> | null = null;

/**
 * Ticker -> { cik (10 digits), ticker, name } from SEC's company_tickers.json, kept a day per instance.
 * Fetched from SEC, not the shared kv cache: the file is about 1 MB, and reading it from Postgres on
 * every new instance was a large share of the database's network transfer.
 */
export function tickerMap(): Promise<Map<string, TickerRow>> {
  if (!mapPromise) {
    mapPromise = edgarJson<unknown>("https://www.sec.gov/files/company_tickers.json", "company_tickers.json", DAY).then(parseTickerFile);
    mapPromise.catch(() => { mapPromise = null; });
  }
  return mapPromise;
}

export async function resolveTicker(ticker: string): Promise<TickerRow | null> {
  return findTicker(await tickerMap(), ticker);
}

// Names compared without spaces or legal suffixes ("Exxon Mobil" and "ExxonMobil Holdings Corp" differ only
// loosely; "Target" and "TARGET CORP" strictly). "KKR & Co. Inc." is "kkr".
const LEGAL = /\b(inc|incorporated|corp|corporation|co|ltd|limited|llc|lp|l p|plc|sa|se|ag|nv|n v|de|class [a-c])\b/g;
const LOOSE = /\b(the|company|holdings?|group|new)\b/g;
export const nameKey = (s: string, loose: boolean) => {
  let k = s.toLowerCase().replace(/&/g, " and ").replace(/[.,'’()/-]/g, " ").replace(LEGAL, " ");
  if (loose) k = k.replace(LOOSE, " ");
  return k.replace(/\s+/g, " ").trim().replace(/( and)+$/, "").replace(/\s+/g, "");
};

let byNamePromise: Promise<{ strict: Map<string, TickerRow | null>; loose: Map<string, TickerRow | null> }> | null = null;

/**
 * The listing for a company name ("Nvidia" is NVIDIA CORP, NVDA), only when exactly one listed company
 * has that name: first on the name less its legal suffix, then also less words like "group" and
 * "holdings". SEC lists a company's primary share class first.
 */
export async function tickerByName(name: string): Promise<TickerRow | null> {
  if (!byNamePromise) {
    byNamePromise = tickerMap().then((m) => {
      const strict = new Map<string, TickerRow | null>(), loose = new Map<string, TickerRow | null>();
      const add = (map: Map<string, TickerRow | null>, k: string, r: TickerRow) => {
        const had = map.get(k);
        if (had === undefined) map.set(k, r);
        else if (had && had.cik !== r.cik) map.set(k, null);
      };
      for (const r of m.values()) { add(strict, nameKey(r.name, false), r); add(loose, nameKey(r.name, true), r); }
      return { strict, loose };
    });
    byNamePromise.catch(() => { byNamePromise = null; });
  }
  const { strict, loose } = await byNamePromise;
  const k = nameKey(name, false);
  if (k.length < 3) return null;
  const hit = strict.get(k);
  if (hit !== undefined) return hit;
  const kl = nameKey(name, true);
  return kl.length >= 3 ? loose.get(kl) ?? null : null;
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
