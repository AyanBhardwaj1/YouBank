/**
 * Holdings as people type or paste them: "AAPL 40 MSFT 30, KO 30", "AAPL MSFT KO" (equal weights), a list of
 * { symbol, weight }, or CSV rows "symbol,weight". Pure, safe on the client.
 */
export type Holding = { symbol: string; weight: number };

const SYMBOL = /^[A-Z^][A-Z0-9.\-^]{0,9}$/;

export function parseHoldingsText(text: string): Holding[] {
  const tokens = text.toUpperCase().split(/[\s,;\t]+/).filter(Boolean);
  const out: Holding[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (!SYMBOL.test(tokens[i])) continue;
    const w = Number((tokens[i + 1] ?? "").replace(/[%$]/g, ""));
    if (Number.isFinite(w) && w > 0) { out.push({ symbol: tokens[i], weight: w }); i++; } else out.push({ symbol: tokens[i], weight: 1 });
  }
  return merge(out);
}

/** Same symbol twice adds up; dots become dashes (BRK.B is BRK-B). */
function merge(hs: Holding[]): Holding[] {
  const by = new Map<string, number>();
  for (const h of hs) { const s = h.symbol.toUpperCase().replace(/\./g, "-"); by.set(s, (by.get(s) ?? 0) + h.weight); }
  return [...by.entries()].map(([symbol, weight]) => ({ symbol, weight }));
}

/** Holdings from untrusted input: a string or a list; at most 500 rows. */
export function cleanHoldings(v: unknown): Holding[] {
  if (typeof v === "string") return parseHoldingsText(v).slice(0, 500);
  if (!Array.isArray(v)) return [];
  return merge(v.slice(0, 500).map((x) => ({ symbol: String((x as Holding)?.symbol ?? "").toUpperCase().trim(), weight: Number((x as Holding)?.weight) })).filter((h) => SYMBOL.test(h.symbol) && Number.isFinite(h.weight) && h.weight > 0));
}
