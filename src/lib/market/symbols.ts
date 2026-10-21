/**
 * One spelling for a security, and each provider's spelling of it. Pure.
 *
 * Canonical form: upper case, trimmed, with a share class written after a dot (`BRK.B`), the display
 * convention most terminals use. Providers differ: FMP and SEC's ticker file write `BRK-B`, Nasdaq writes
 * `BRK.B`, Bloomberg `BRK/B`, IBKR `BRK B`. Callers pass whatever a person typed (or another feed wrote);
 * each client converts at its own boundary, so a symbol is never guessed at by trying spellings in turn.
 *
 * Left alone: indices (`^GSPC`), FX pairs (`EURUSD`), crypto pairs (`BTCUSD`, `BTC-USD`) and exchange
 * suffixes (`000001.SS`): only a one- or two-letter class after a letters-only root counts as a share class.
 */

/** A root of 1-6 letters, a separator (dot, dash, slash or space) and a 1-2 letter class. */
const SHARE_CLASS = /^([A-Z]{1,6})[.\-/ ]([A-Z]{1,2})$/;
/** Crypto against the dollar as a pair with a dash ("BTC-USD"); FMP writes it without one. */
const CRYPTO_DASH = /^([A-Z0-9]{2,10})-(USD|USDT|USDC)$/;

const clean = (raw: string) => raw.trim().toUpperCase().replace(/\s+/g, " ");

/** The root and share class of a symbol, or null when it has no class. */
export function shareClassOf(raw: string): { root: string; cls: string } | null {
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
