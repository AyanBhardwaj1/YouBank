/**
 * The terminal's market data, with backups. Every function tries FMP first; when FMP is out (its daily
 * limit) or does not cover a symbol (the free plan's prices stop at about 87 tickers), it falls back to:
 * - Nasdaq for US stocks and ETFs;
 * - an ETF that tracks the index or commodity, for symbols Nasdaq does not list (S&P 500 via SPY);
 * - the ECB's reference rates for currencies, and CoinGecko for crypto.
 * Each answer notes its source (see provenance.ts), so a screen can say where its numbers came from.
 * AI research, the last backup, is for facts rather than series: see research.ts and the callers.
 */
import { fmpProfile, type FmpProfile } from "@/lib/fmp/client";
import { closes as fmpCloses, history as fmpHistory, MarketDataError, quotes as fmpQuotes, type Bar, type Quote } from "./fmp";
import { coinGeckoHistory, ecbPair, isCrypto } from "./free";
import { backupEnabled, nasdaqHistory, nasdaqQuote, nasdaqSummary } from "./nasdaq";
import { noteSource, type Provider } from "./provenance";

/** Symbols Nasdaq does not list, and the ETF that stands in for each (its returns, not its level). */
export const PROXIES: Record<string, string> = {
  "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "ONEQ", "^RUT": "IWM", "^GSPTSE": "EWC", "^BVSP": "EWZ", "^FTSE": "EWU", "^GDAXI": "EWG",
  "^FCHI": "EWQ", "^STOXX50E": "FEZ", "^N225": "EWJ", "^HSI": "EWH", "000001.SS": "ASHR", "^AXJO": "EWA",
  GCUSD: "GLD", SIUSD: "SLV", CLUSD: "USO", BZUSD: "BNO", NGUSD: "UNG", HGUSD: "CPER", ZCUSX: "CORN", ZWUSX: "WEAT",
};

const CURRENCIES = new Set(["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "CNH", "CNY", "MXN", "INR", "NZD", "SEK", "NOK", "HKD", "SGD", "KRW", "BRL", "ZAR"]);
export const isFxPair = (s: string) => /^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3));

const defaultFrom = () => new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const asBars = (xs: { date: string; close: number }[]): Bar[] => xs.map((x) => ({ date: x.date, open: x.close, high: x.close, low: x.close, close: x.close, volume: 0 }));

export type Sourced<T> = { data: T; source: Provider; via?: string };

/** Backup daily bars for one symbol, oldest first, noting the source. Null when no backup has it. */
async function backupHistory(symbol: string, from: string): Promise<Sourced<Bar[]> | null> {
  if (!backupEnabled()) return null;
  const s = symbol.toUpperCase();
  if (isFxPair(s)) {
    const xs = await ecbPair(s, from);
    if (!xs.length) return null;
    noteSource("ECB", `${s} from the ECB's daily reference rates`);
    return { data: asBars(xs), source: "ECB", via: "ECB fixing" };
  }
  if (isCrypto(s)) {
    const xs = (await coinGeckoHistory(s)).filter((x) => x.date >= from);
    if (!xs.length) return null;
    noteSource("CoinGecko");
    return { data: asBars(xs), source: "CoinGecko" };
  }
  const target = PROXIES[s] ?? s;
  const bars = await nasdaqHistory(target, from);
  if (!bars.length) return null;
  noteSource("Nasdaq", PROXIES[s] ? `${s} tracked by the ${target} ETF` : undefined);
  return { data: bars, source: "Nasdaq", via: PROXIES[s] };
}

/** Daily bars with where they came from: FMP, then the backups. Throws MarketDataError when no source has the symbol. */
export async function historyFrom(symbol: string, from?: string, closesOnly = false): Promise<Sourced<Bar[]>> {
  const start = from ?? defaultFrom();
  let why = "";
  try {
    const bars = closesOnly ? asBars(await fmpCloses(symbol, from)) : await fmpHistory(symbol, from);
    if (bars.length) { noteSource("FMP"); return { data: bars, source: "FMP" }; }
  } catch (e) {
    if (!(e instanceof MarketDataError)) throw e;
    why = e.message;
  }
  const b = await backupHistory(symbol, start);
  if (b) return b;
  throw new MarketDataError(why || `No price history for ${symbol.toUpperCase()}`);
}

/** Daily bars, oldest first: FMP, then the backups. */
export const history = async (symbol: string, from?: string): Promise<Bar[]> => (await historyFrom(symbol, from)).data;

/** Daily closes, oldest first, with the same fallbacks as history(). */
export const closes = async (symbol: string, from?: string): Promise<{ date: string; close: number }[]> => (await historyFrom(symbol, from, true)).data.map((b) => ({ date: b.date, close: b.close }));

/**
 * Latest quotes for a list: FMP where it answers, Nasdaq (or the proxy ETF) for the rest. Symbols with
 * no quote are left out; callers fall back to the last daily close.
 */
export async function quotes(symbols: string[], ttlMs?: number): Promise<Record<string, Pick<Quote, "price" | "changePercentage">>> {
  const out: Record<string, Pick<Quote, "price" | "changePercentage">> = {};
  const fmp = await fmpQuotes(symbols, ttlMs).catch(() => ({} as Record<string, Quote>));
  for (const [s, q] of Object.entries(fmp)) out[s] = q;
  if (Object.keys(fmp).length) noteSource("FMP");
  if (!backupEnabled()) return out;
  const missing = symbols.filter((s) => !out[s] && !isFxPair(s) && !isCrypto(s) && !PROXIES[s]);
  await Promise.all(missing.map(async (s) => {
    const q = await nasdaqQuote(s).catch(() => null);
    if (q) { out[s] = { price: q.price, changePercentage: q.changePct ?? 0 }; noteSource("Nasdaq"); }
  }));
  return out;
}

export type Profile = FmpProfile & { fetchedAt: string };

/**
 * Price, change, market cap and 52-week range for a company: FMP's profile, then Nasdaq's quote and
 * summary. Nasdaq has no description or website; those stay empty (the terminal can research them).
 */
export async function quoteProfile(symbol: string): Promise<Profile | null> {
  const p = await fmpProfile(symbol).catch(() => null);
  if (p) { noteSource("FMP"); return p; }
  if (!backupEnabled()) return null;
  const [q, s] = await Promise.all([nasdaqQuote(symbol).catch(() => null), nasdaqSummary(symbol).catch(() => null)]);
  if (!q) return null;
  noteSource("Nasdaq");
  return {
    symbol: symbol.toUpperCase(), price: q.price, marketCap: s?.marketCap ?? 0, change: q.change ?? 0, changePercentage: q.changePct ?? 0,
    range: s?.low52 && s?.high52 ? `${s.low52}-${s.high52}` : "", companyName: q.name, cik: "", exchange: s?.exchange || q.exchange,
    exchangeFullName: s?.exchange || q.exchange, industry: s?.industry ?? "", sector: s?.sector ?? "", website: "", description: "", fetchedAt: new Date().toISOString(),
  };
}
