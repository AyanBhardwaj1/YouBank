/**
 * The terminal's market data, with backups. Each function asks its dataset's sources in the registry's
 * order (registry.ts): FMP first; when FMP fails in any way (timeout, network, 5xx, its limit, an
 * unreadable or empty answer) or does not cover a symbol (the free plan's prices stop at about 87
 * tickers), the backups answer:
 * - Nasdaq for US stocks and ETFs;
 * - an ETF that tracks the index or commodity, for symbols Nasdaq does not list (S&P 500 via SPY);
 * - the ECB's reference rates for currencies, and CoinGecko for crypto.
 * On interactive requests a slow FMP is hedged by the backup (chain.ts). Each answer notes its source
 * (see provenance.ts), so a screen can say where its numbers came from. A caller may pass a person's
 * preferred order (`{ prefer, exclude }`); without one the default order is used.
 * AI research, the last backup, is for facts rather than series: see research.ts and the callers.
 */
import { BOARD_QUOTE_CONCURRENCY } from "./budgets";
import { mapLimit } from "./chain";
import { MarketDataError, type Bar, type Quote } from "./fmp";
import { isCrypto } from "./free";
import { isFxPair, PROXIES } from "./kinds";
import type { AnsweredBy, Provider } from "./provenance";
import { fromChain, isEmptyAnswer, NoSourceError, type ChainOptions, type DatasetId, type Profile as RegistryProfile } from "./registry";

export { isFxPair, PROXIES };
export type { ChainOptions };

const defaultFrom = () => new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const asBars = (xs: { date: string; close: number }[]): Bar[] => xs.map((x) => ({ date: x.date, open: x.close, high: x.close, low: x.close, close: x.close, volume: 0 }));

export type Sourced<T> = { data: T; source: Provider; via?: string; by?: AnsweredBy };

/** The daily-bars dataset for a symbol: currencies and crypto have their own backups. */
const barsDataset = (symbol: string): DatasetId => (isFxPair(symbol.toUpperCase()) ? "fx" : isCrypto(symbol) ? "crypto" : "daily-bars");

/** Daily bars with where they came from: FMP, then the backups. Throws MarketDataError when no source has the symbol. */
export async function historyFrom(symbol: string, from?: string, closesOnly = false, opts: ChainOptions = {}): Promise<Sourced<Bar[]>> {
  const start = from ?? defaultFrom();
  try {
    const a = await fromChain(barsDataset(symbol) as "daily-bars", { symbol, from: start }, opts);
    // Closes only, as FMP's light endpoint gave them (the backups keep their full bars, as before).
    const data = closesOnly && a.by.id === "fmp" ? asBars(a.data) : a.data;
    return { data, source: a.provider, by: a.by, ...(a.via ? { via: a.via } : {}) };
  } catch (e) {
    // Nothing anywhere: say so. Otherwise the first source's own error (a plan limit's words, a timeout).
    if (isEmptyAnswer(e) || e instanceof NoSourceError) throw new MarketDataError(`No price history for ${symbol.toUpperCase()}`);
    throw e;
  }
}

/** Daily bars, oldest first: FMP, then the backups. */
export const history = async (symbol: string, from?: string): Promise<Bar[]> => (await historyFrom(symbol, from)).data;

/** Daily closes, oldest first, with the same fallbacks as history(). */
export const closes = async (symbol: string, from?: string): Promise<{ date: string; close: number }[]> => (await historyFrom(symbol, from, true)).data.map((b) => ({ date: b.date, close: b.close }));

/**
 * Latest quotes for a list: FMP where it answers, Nasdaq for the rest (not for currencies, crypto or
 * proxied symbols). Symbols with no quote are left out; callers fall back to the last daily close.
 */
export async function quotes(symbols: string[], ttlMs?: number, opts: ChainOptions = {}): Promise<Record<string, Pick<Quote, "price" | "changePercentage">>> {
  const out: Record<string, Pick<Quote, "price" | "changePercentage">> = {};
  await mapLimit([...new Set(symbols)], BOARD_QUOTE_CONCURRENCY, async (s) => {
    const a = await fromChain("quote", { symbol: s, ttlMs }, opts).catch(() => null);
    if (a) out[s] = { price: a.data.price, changePercentage: a.data.changePercentage };
  });
  return out;
}

export type Profile = RegistryProfile;

/**
 * Price, change, market cap and 52-week range for a company: FMP's profile, then Nasdaq's quote and
 * summary. Nasdaq has no description or website; those stay empty (the terminal can research them).
 */
export async function quoteProfile(symbol: string, opts: ChainOptions = {}): Promise<Profile | null> {
  return (await fromChain("profile", { symbol }, opts).catch(() => null))?.data ?? null;
}
