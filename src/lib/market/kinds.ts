/**
 * What kind of instrument a symbol is, for choosing a dataset's sources (registry.ts): currency pairs,
 * crypto, and the index and commodity symbols Nasdaq does not list (each with the ETF that stands in).
 */
export { isCrypto } from "./free";

/** Symbols Nasdaq does not list, and the ETF that stands in for each (its returns, not its level). */
export const PROXIES: Record<string, string> = {
  "^GSPC": "SPY", "^DJI": "DIA", "^IXIC": "ONEQ", "^RUT": "IWM", "^GSPTSE": "EWC", "^BVSP": "EWZ", "^FTSE": "EWU", "^GDAXI": "EWG",
  "^FCHI": "EWQ", "^STOXX50E": "FEZ", "^N225": "EWJ", "^HSI": "EWH", "000001.SS": "ASHR", "^AXJO": "EWA",
  GCUSD: "GLD", SIUSD: "SLV", CLUSD: "USO", BZUSD: "BNO", NGUSD: "UNG", HGUSD: "CPER", ZCUSX: "CORN", ZWUSX: "WEAT",
};

const CURRENCIES = new Set(["USD", "EUR", "JPY", "GBP", "CHF", "AUD", "CAD", "CNH", "CNY", "MXN", "INR", "NZD", "SEK", "NOK", "HKD", "SGD", "KRW", "BRL", "ZAR"]);
export const isFxPair = (s: string) => /^[A-Z]{6}$/.test(s) && CURRENCIES.has(s.slice(0, 3)) && CURRENCIES.has(s.slice(3));
