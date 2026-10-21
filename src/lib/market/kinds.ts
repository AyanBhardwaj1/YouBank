/**
 * What kind of instrument a symbol is, for choosing a dataset's sources (registry.ts): currency pairs,
 * crypto, and the index and commodity symbols Nasdaq does not list (each with the ETF that stands in),
 * and whether its quotes follow the NYSE session (for judging staleness).
 */
import { isCrypto } from "./free";
import { canonical, hasExchangeSuffix } from "./symbols";

export { isCrypto };

/** Symbols Nasdaq does not list, and the ETF that stands in for each (its returns, not its level). */
export const PROXIES: Record<string, string> = {
  "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "ONEQ", "^RUT": "IWM", "^GSPTSE": "EWC", "^BVSP": "EWZ", "^FTSE": "EWU", "^GDAXI": "EWG",
  "^FCHI": "EWQ", "^STOXX50E": "FEZ", "^N225": "EWJ", "^HSI": "EWH", "000001.SS": "ASHR", "^AXJO": "EWA",
  GCUSD: "GLD", SIUSD: "SLV", CLUSD: "USO", BZUSD: "BNO", NGUSD: "UNG", HGUSD: "CPER", ZCUSX: "CORN", ZWUSX: "WEAT",
};

const CURRENCIES = new Set(["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "CNH", "CNY", "MXN", "INR", "NZD", "SEK", "NOK", "HKD", "SGD", "KRW", "BRL", "ZAR"]);
export const isFxPair = (s: string) => /^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3));

/** US indices that trade on the NYSE session; any other "^" index (Nikkei, DAX…) keeps its own exchange's hours. */
const US_INDICES = new Set(["^GSPC", "^DJI", "^IXIC", "^NDX", "^RUT", "^VIX"]);

/**
 * Whether a symbol's quotes follow the NYSE session, so "behind the market" can be judged by calendar.ts.
 * A foreign index or listing (its own hours), an FX pair or crypto (around the clock) and a commodity
 * future (nearly so) are not: their as-of is reported, never flagged stale by New York's clock.
 */
export const nyseSession = (symbol: string): boolean => {
  const s = canonical(symbol);
  return s.startsWith("^") ? US_INDICES.has(s) : !isFxPair(s) && !isCrypto(s) && !/USD$|USX$/.test(s) && !hasExchangeSuffix(s) && !/^\d/.test(s);
};
