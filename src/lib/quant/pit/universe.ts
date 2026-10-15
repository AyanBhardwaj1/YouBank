/**
 * QF3: the universe (quant_universe): which securities existed when, ranked by market value.
 *
 * The beta (no price vendor chosen yet, docs/quant-edge.md open question 1): today's US listings from SEC's
 * company_tickers_exchange.json, common stock only, the 1,000 largest. Market value is shares outstanding
 * (dei:EntityCommonStockSharesOutstanding, one SEC frame for every filer) times the latest stored close; before
 * the bar store has a close, the public float from the latest 10-K cover (dei:EntityPublicFloat frame) stands
 * in, and each row says which it used.
 *
 * Survivorship is a stated, measured property: the beta universe starts from today's listings, so companies
 * that delisted before the first build are missing, and every result on it carries the survivorship flag
 * (words.ts). Rows that drop out of SEC's list later get a last_date, so the gap shrinks from the first build on.
 */
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { DAY, edgarJson } from "@/lib/edgar/client";
import { frame } from "@/lib/market/frames";
import { storedBars } from "./bars";

export const UNIVERSE = "us-top1000";
export const UNIVERSE_SIZE = 1000;

export type ExchangeFile = { fields: string[]; data: (string | number | null)[][] };
export type Listing = { cik: string; name: string; symbol: string; exchange: string; securityType: SecurityType };
export type SecurityType = "common" | "etf" | "adr" | "reit" | "preferred" | "unit" | "warrant" | "other";

/** Parse SEC's company_tickers_exchange.json ({ fields: [cik, name, ticker, exchange], data: [...] }). Pure. */
export function parseExchangeFile(f: ExchangeFile): Listing[] {
  const i = { cik: f.fields.indexOf("cik"), name: f.fields.indexOf("name"), ticker: f.fields.indexOf("ticker"), exchange: f.fields.indexOf("exchange") };
  if (Object.values(i).some((k) => k < 0)) throw new Error("company_tickers_exchange.json: unexpected fields");
  return f.data.map((r) => {
    const symbol = String(r[i.ticker] ?? "").toUpperCase().replace(/\./g, "-");
    const name = String(r[i.name] ?? "");
    return { cik: String(r[i.cik] ?? "").padStart(10, "0"), name, symbol, exchange: String(r[i.exchange] ?? ""), securityType: classify(symbol, name) };
  }).filter((l) => l.symbol && l.cik !== "0000000000");
}

/**
 * The security type from the ticker and name (a heuristic, stated as such): dashed suffixes mark preferred
 * shares (-P), units (-U), warrants (-W) and rights (-R); fund and trust names mark ETFs and other vehicles.
 */
export function classify(symbol: string, name: string): SecurityType {
  if (/-P[A-Z]?$/.test(symbol) || /\bpreferred\b/i.test(name)) return "preferred";
  if (/-U[N]?$/.test(symbol) || /\bunits?\b/i.test(name)) return "unit";
  if (/-W[ST]?$|-R$/.test(symbol) || /\bwarrants?\b|\brights?\b/i.test(name)) return "warrant";
  if (/\b(etf|fund|trust|portfolio|index)\b/i.test(name) && !/\breal estate investment trust\b|\breit\b|realty/i.test(name)) return /\btrust\b/i.test(name) && !/\b(etf|fund|index)\b/i.test(name) ? "other" : "etf";
  if (/\bADR\b|American Depositary/i.test(name)) return "adr";
  if (/\breit\b|realty|real estate investment trust/i.test(name)) return "reit";
  return "common";
}

export type Candidate = Listing & { shares?: number | null; float?: number | null; close?: number | null };
export type Ranked = Candidate & { marketCap: number; capSource: "shares x close" | "public float"; rank: number };

/**
 * Rank candidates by market value: shares x close where both are known, else public float. Only common stock
 * and REITs on a US exchange, one row per CIK (its most valuable class, so a top-N rule is about companies), with
 * a price at least `minPrice` when a close is known. Pure.
 */
export function rankUniverse(cands: Candidate[], n = UNIVERSE_SIZE, minPrice = 5): Ranked[] {
  const US = /^(NYSE|Nasdaq|NYSE American|NYSE Arca|CBOE|BATS)$/i;
  const scored = cands
    .filter((c) => (c.securityType === "common" || c.securityType === "reit") && US.test(c.exchange) && (c.close == null || c.close >= minPrice))
    .map((c) => {
      const mc = c.shares && c.close ? c.shares * c.close : null;
      return mc ? { ...c, marketCap: mc, capSource: "shares x close" as const } : c.float ? { ...c, marketCap: c.float, capSource: "public float" as const } : null;
    })
    .filter((c): c is Omit<Ranked, "rank"> => !!c && c.marketCap > 0);
  const byCik = new Map<string, Omit<Ranked, "rank">>();
  for (const c of scored) { const cur = byCik.get(c.cik); if (!cur || c.marketCap > cur.marketCap) byCik.set(c.cik, c); }
  return [...byCik.values()].sort((a, b) => b.marketCap - a.marketCap).slice(0, n).map((c, i) => ({ ...c, rank: i + 1 }));
}

/** The latest calendar quarter-end instant SEC frames cover well ("CY2026Q2I"), a quarter behind. */
export function frameInstant(now = new Date(), lagQuarters = 1): string {
  const q = Math.floor(now.getUTCMonth() / 3) - lagQuarters;
  const y = now.getUTCFullYear() + Math.floor(q / 4);
  return `CY${y}Q${((q % 4) + 4) % 4 + 1}I`;
}

/**
 * Rebuild the universe: today's listings, shares and float from SEC frames, closes from the bar store, the top
 * 1,000 written with their rank; members not in today's list get a last_date. Returns counts.
 */
export async function refreshUniverse(deadline: number): Promise<{ listings: number; ranked: number; delisted: number; capFromShares: number }> {
  const db = requireDb();
  const file = await edgarJson<ExchangeFile>("https://www.sec.gov/files/company_tickers_exchange.json", "company_tickers_exchange.json", DAY);
  const listings = parseExchangeFile(file);
  const sharesFrame = await frame("EntityCommonStockSharesOutstanding", frameInstant(new Date(), 1), "shares", "dei").catch(() => frame("EntityCommonStockSharesOutstanding", frameInstant(new Date(), 2), "shares", "dei")).catch(() => null);
  const floatFrame = await frame("EntityPublicFloat", `CY${new Date().getUTCFullYear() - 1}Q2I`, "USD", "dei").catch(() => null);
  const key = (cik: string) => String(Number(cik));
  const cands: Candidate[] = listings.map((l) => ({ ...l, shares: sharesFrame?.values[key(l.cik)] ?? null, float: floatFrame?.values[key(l.cik)] ?? null }));
  // Closes from the store for the most valuable 1,400 by float or shares (one small read each, within the deadline).
  const prelim = rankUniverse(cands, 1400);
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < prelim.length && Date.now() < deadline) {
      const c = prelim[i++];
      const b = await storedBars(c.symbol).catch(() => null);
      const cand = cands.find((x) => x.symbol === c.symbol);
      if (b?.c.length && cand) cand.close = b.c[b.c.length - 1];
    }
  }));
  const ranked = rankUniverse(cands, UNIVERSE_SIZE);
  const today = new Date().toISOString().slice(0, 10);
  const listed = new Set(listings.map((l) => l.symbol));
  // Clear old ranks, then write the new ones (first_date is the first day YouBank saw the listing). A symbol that
  // already has an open row (no last_date) keeps it: the key is (symbol, first_date), so inserting it again with
  // today's date would add a second open row each rebuild, and members() would list the symbol twice.
  await db.update(schema.quantUniverse).set({ rank: null }).where(sql`${schema.quantUniverse.rank} is not null`);
  const openRows = new Set((await db.select({ symbol: schema.quantUniverse.symbol }).from(schema.quantUniverse).where(isNull(schema.quantUniverse.lastDate))).map((r) => r.symbol));
  for (let k = 0; k < ranked.length; k += 200) {
    const slice = ranked.slice(k, k + 200);
    const fresh = slice.filter((r) => !openRows.has(r.symbol));
    if (fresh.length) await db.insert(schema.quantUniverse).values(fresh.map((r) => ({ symbol: r.symbol, cik: r.cik, name: r.name, exchange: r.exchange, securityType: r.securityType, firstDate: today, rank: r.rank, marketCap: r.marketCap, hasPrices: !!r.close, source: `SEC company_tickers_exchange.json; ${r.capSource}`, updatedAt: new Date() })))
      .onConflictDoNothing();
    for (const r of slice) await db.update(schema.quantUniverse).set({ rank: r.rank, marketCap: r.marketCap, hasPrices: !!r.close, source: `SEC company_tickers_exchange.json; ${r.capSource}`, updatedAt: new Date() }).where(and(eq(schema.quantUniverse.symbol, r.symbol), isNull(schema.quantUniverse.lastDate)));
  }
  const open = await db.select({ symbol: schema.quantUniverse.symbol }).from(schema.quantUniverse).where(isNull(schema.quantUniverse.lastDate));
  const gone = open.filter((r) => !listed.has(r.symbol)).map((r) => r.symbol);
  for (const s of gone.slice(0, 500)) await db.update(schema.quantUniverse).set({ lastDate: today, rank: null, updatedAt: new Date() }).where(and(eq(schema.quantUniverse.symbol, s), isNull(schema.quantUniverse.lastDate)));
  return { listings: listings.length, ranked: ranked.length, delisted: gone.length, capFromShares: ranked.filter((r) => r.capSource === "shares x close").length };
}

/** The current members, by rank. */
export async function members(limit = UNIVERSE_SIZE): Promise<{ symbol: string; cik: string | null; name: string; rank: number; marketCap: number | null }[]> {
  const rows = await requireDb().select({ symbol: schema.quantUniverse.symbol, cik: schema.quantUniverse.cik, name: schema.quantUniverse.name, rank: schema.quantUniverse.rank, marketCap: schema.quantUniverse.marketCap })
    .from(schema.quantUniverse).where(and(isNull(schema.quantUniverse.lastDate), sql`${schema.quantUniverse.rank} is not null`)).orderBy(asc(schema.quantUniverse.rank)).limit(limit);
  return rows.map((r) => ({ ...r, rank: r.rank ?? 0 }));
}

/** Survivorship, measured: members, rows that have left the list, and how many have stored prices. */
export async function survivorship(): Promise<{ members: number; withPrices: number; delistedSinceFirstBuild: number; firstBuild: string | null; note: string }> {
  const r = (await requireDb().execute(sql`select count(*) filter (where last_date is null and rank is not null)::int as members, count(*) filter (where last_date is null and rank is not null and has_prices)::int as with_prices, count(*) filter (where last_date is not null)::int as gone, min(first_date)::text as first from quant_universe`)).rows[0] as { members: number; with_prices: number; gone: number; first: string | null } | undefined;
  return {
    members: Number(r?.members ?? 0), withPrices: Number(r?.with_prices ?? 0), delistedSinceFirstBuild: Number(r?.gone ?? 0), firstBuild: r?.first ?? null,
    note: "The beta universe is today's 1,000 largest US listings: securities delisted before the first build are missing (survivorship bias). Rows that leave the list afterwards are kept with their last date.",
  };
}
