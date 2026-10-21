/**
 * One spelling for a security, and each provider's spelling of it. Pure.
 *
 * Canonical form: upper case, trimmed, with a share class written after a dot (`BRK.B`), the display
 * convention most terminals use. Providers differ: FMP and SEC's ticker file write `BRK-B`, Nasdaq writes
 * `BRK.B`, Bloomberg `BRK/B`, IBKR `BRK B`. Callers pass whatever a person typed (or another feed wrote);
 * each client converts at its own boundary, so a symbol is never guessed at by trying spellings in turn.
 *
 * Left alone: indices (`^GSPC`), FX pairs (`EURUSD`), crypto pairs (`BTCUSD`, `BTC-USD`) and exchange
 * suffixes (`000001.SS`, `SHOP.TO`, `VOD.L`, `SAP.DE`): only a one- or two-letter class after a
 * letters-only root counts as a share class, and a dot followed by a known exchange code is a listing
 * venue, not a class (FMP and Nasdaq both write `SHOP.TO`; `SHOP-TO` finds nothing). A dash or slash
 * still means a class (`BAC-PL`), and `.V` stays a class (McCormick's voting shares, `MKC.V`).
 */

/** A root of 1-6 letters, a separator (dot, dash, slash or space) and a 1-2 letter class. */
const SHARE_CLASS = /^([A-Z]{1,6})[.\-/ ]([A-Z]{1,2})$/;
/** Crypto against the dollar as a pair with a dash ("BTC-USD"); FMP writes it without one. */
const CRYPTO_DASH = /^([A-Z0-9]{2,10})-(USD|USDT|USDC)$/;

const clean = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, " ");

/** Exchange suffixes FMP and Yahoo write after a dot (London, Toronto, Frankfurt, Paris, Sydney, Hong Kong…). */
const EXCHANGE_SUFFIXES = new Set([
  "L", "F", "IL", "TO", "CN", "NE", "AX", "NZ", "HK", "SS", "SZ", "KS", "KQ", "TW", "SI", "BK", "JK", "KL", "NS", "BO", "PA", "DE", "BE", "DU", "HM",
  "MU", "SG", "AS", "BR", "LS", "MC", "MI", "SW", "VI", "ST", "OL", "CO", "HE", "IC", "IR", "AT", "WA", "BD", "IS", "ME", "TA", "JO", "SA", "MX",
  "BA", "SN", "LM", "QA", "SR", "KW",
]);

/** Whether a symbol carries a foreign listing's exchange suffix after a dot ("SHOP.TO", "VOD.L"). */
export const hasExchangeSuffix = (raw: string): boolean => { const m = /^[A-Z0-9]{1,8}\.([A-Z]{1,2})$/.exec(clean(raw)); return !!m && EXCHANGE_SUFFIXES.has(m[1]); };

/** The root and share class of a symbol, or null when it has no class. */
export function shareClassOf(raw: string): { root: string; cls: string } | null {
  if (hasExchangeSuffix(raw)) return null;
  const m = SHARE_CLASS.exec(clean(raw));
  return m ? { root: m[1], cls: m[2] } : null;
}

/** The canonical spelling: "brk/b", "BRK-B", "BRK B" -> "BRK.B"; "aapl" -> "AAPL"; others unchanged but upper case. */
export function canonical(raw: string): string {
  const s = clean(raw);
  const c = shareClassOf(s);
  return c ? `${c.root}.${c.cls}` : s;
}

const withSeparator = (raw: string, sep: string) => {
  const c = shareClassOf(raw);
  return c ? `${c.root}${sep}${c.cls}` : clean(raw);
};

/** Financial Modeling Prep: "BRK-B", crypto "BTCUSD". */
export function forFmp(raw: string): string {
  const s = withSeparator(raw, "-");
  const m = CRYPTO_DASH.exec(s);
  return m ? `${m[1]}${m[2]}` : s;
}

/** Nasdaq.com's API: "BRK.B". */
export const forNasdaq = (raw: string): string => withSeparator(raw, ".");

/** SEC's company_tickers.json: "BRK-B". */
export const forSec = (raw: string): string => withSeparator(raw, "-");
