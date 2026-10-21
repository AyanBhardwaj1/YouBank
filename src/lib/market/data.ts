/**
 * The terminal's market data, with backups. Every function tries FMP first; when FMP is out (its daily
 * limit) or does not cover a symbol (the free plan's prices stop at about 87 tickers), it falls back to:
 * - Nasdaq for US stocks and ETFs;
 * - an ETF that tracks the index or commodity, for symbols Nasdaq does not list (S&P 500 via SPY);
 * - the ECB's reference rates for currencies, and CoinGecko for crypto.
 * Each answer notes its source (see provenance.ts), so a screen can say where its numbers came from.
 * AI research, the last backup, is for facts rather than series: see research.ts and the callers.
 */
import { fmpProfile } from "@/lib/fmp/client";
import { isStaleQuote } from "./calendar";
import type { Profile as CanonicalProfile } from "./canonical";
import { closes as fmpCloses, history as fmpHistory, MarketDataError, quotes as fmpQuotes, type Bar } from "./fmp";
import { quoteOf } from "./fmp-schema";
import { coinGeckoHistory, ecbPair, isCrypto } from "./free";
import { backupEnabled, nasdaqHistory, nasdaqQuote, nasdaqSummary } from "./nasdaq";
import { noteSource, type Provider } from "./provenance";
import { canonical } from "./symbols";

/** Symbols Nasdaq does not list, and the ETF that stands in for each (its returns, not its level). */
export const PROXIES: Record<string, string> = {
  "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "ONEQ", "^RUT": "IWM", "^GSPTSE": "EWC", "^BVSP": "EWZ", "^FTSE": "EWU", "^GDAXI": "EWG",
  "^FCHI": "EWQ", "^STOXX50E": "FEZ", "^N225": "EWJ", "^HSI": "EWH", "000001.SS": "ASHR", "^AXJO": "EWA",
  GCUSD: "GLD", SIUSD: "SLV", CLUSD: "USO", BZUSD: "BNO", NGUSD: "UNG", HGUSD: "CPER", ZCUSX: "CORN", ZWUSX: "WEAT",
};

/** What each proxied symbol is, for the stand-in label ("S&P 500 via SPY"). */
const PROXY_NAMES: Record<string, string> = {
  "^GSPC": "S&P 500", "^DJI": "Dow Jones Industrial", "^IXIC": "Nasdaq Composite", "^RUT": "Russell 2000", "^GSPTSE": "S&P/TSX Composite", "^BVSP": "Bovespa",
  "^FTSE": "FTSE 100", "^GDAXI": "DAX", "^FCHI": "CAC 40", "^STOXX50E": "Euro Stoxx 50", "^N225": "Nikkei 225", "^HSI": "Hang Seng", "000001.SS": "Shanghai Composite",
  "^AXJO": "ASX 200", GCUSD: "Gold", SIUSD: "Silver", CLUSD: "WTI crude", BZUSD: "Brent crude", NGUSD: "Natural gas", HGUSD: "Copper", ZCUSX: "Corn", ZWUSX: "Wheat",
};

/** "S&P 500 via SPY": an ETF standing in for an index or commodity is never shown as its level without this. */
export const standInLabel = (symbol: string): string | undefined => (PROXIES[symbol] ? `${PROXY_NAMES[symbol] ?? symbol} via ${PROXIES[symbol]}` : undefined);

const CURRENCIES = new Set(["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "CNH", "CNY", "MXN", "INR", "NZD", "SEK", "NOK", "HKD", "SGD", "KRW", "BRL", "ZAR"]);
export const isFxPair = (s: string) => /^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3));

const defaultFrom = () => new Date(Date.now() - 5 * 365.25 * 86_400_000).toISOString().slice(0, 10);
const asBars = (xs: { date: string; close: number }[]): Bar[] => xs.map((x) => ({ date: x.date, open: x.close, high: x.close, low: x.close, close: x.close, volume: 0 }));

/** `via` is the ETF or fixing that stood in; `label` says so in words ("S&P 500 via SPY"). */
export type Sourced<T> = { data: T; source: Provider; via?: string; label?: string };

/** Backup daily bars for one symbol, oldest first, noting the source. Null when no backup has it. */
async function backupHistory(symbol: string, from: string): Promise<Sourced<Bar[]> | null> {
  if (!backupEnabled()) return null;
  const s = canonical(symbol);
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
  const label = standInLabel(s);
  noteSource("Nasdaq", label);
  return { data: bars, source: "Nasdaq", via: PROXIES[s], label };
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

/** A latest quote: price and the day's change as a fraction (null when the feed has none), with its as-of. */
export type LiveQuote = { price: number; changePct: number | null; asOf: string | null; source: Provider };

/** Note a quote's source with its as-of, flagged stale when it is behind the market (calendar.ts) and delayed when the feed says so. */
function noteQuote(source: Provider, asOf: string | null, delayed?: boolean) {
  noteSource(source, undefined, { ...(asOf ? { asOf, stale: isStaleQuote(asOf) } : {}), ...(delayed ? { delayed } : {}) });
}

/**
 * Latest quotes for a list: FMP where it answers, Nasdaq (or the proxy ETF) for the rest. Symbols with
 * no quote are left out; callers fall back to the last daily close.
 */
export async function quotes(symbols: string[], ttlMs?: number): Promise<Record<string, LiveQuote>> {
  const out: Record<string, LiveQuote> = {};
  const fmp = await fmpQuotes(symbols, ttlMs).catch(() => ({}));
  for (const [s, raw] of Object.entries(fmp)) { const q = quoteOf(raw); out[s] = { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "FMP" }; noteQuote("FMP", q.asOf); }
  if (!backupEnabled()) return out;
  const missing = symbols.filter((s) => !out[s] && !isFxPair(s) && !isCrypto(s) && !PROXIES[s]);
  await Promise.all(missing.map(async (s) => {
    const q = await nasdaqQuote(s).catch(() => null);
    if (q) { out[s] = { price: q.price, changePct: q.changePct, asOf: q.asOf, source: "Nasdaq" }; noteQuote("Nasdaq", q.asOf, q.delayed); }
  }));
  return out;
}

export type Profile = CanonicalProfile;

/**
 * Price, change, market cap and 52-week range for a company: FMP's profile, then Nasdaq's quote and
 * summary. Nasdaq has no description or website; those stay empty (the terminal can research them).
 * Missing figures stay null (never 0), and the price keeps the provider's own as-of.
 */
export async function quoteProfile(symbol: string): Promise<Profile | null> {
  const p = await fmpProfile(symbol).catch(() => null);
  if (p) { noteSource("FMP", undefined, { asOf: p.asOf ?? undefined, fetchedAt: p.fetchedAt }); return p; }
  if (!backupEnabled()) return null;
  const [q, s] = await Promise.all([nasdaqQuote(symbol).catch(() => null), nasdaqSummary(symbol).catch(() => null)]);
  if (!q) return null;
  const fetchedAt = new Date().toISOString();
  noteQuote("Nasdaq", q.asOf ?? fetchedAt, q.delayed);
  return {
    symbol: canonical(symbol), name: q.name, price: q.price, change: q.change, changePct: q.changePct, marketCap: s?.marketCap ?? null,
    low52: s?.low52 ?? null, high52: s?.high52 ?? null, exchange: s?.exchange || q.exchange, industry: s?.industry ?? "", sector: s?.sector ?? "", website: "", description: "",
    source: "Nasdaq", asOf: q.asOf ?? fetchedAt, fetchedAt, delayed: q.delayed,
  };
}
