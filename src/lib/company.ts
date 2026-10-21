import type { CompanyData } from "./types";
import { resolveTicker } from "./edgar/tickers";
import { fyeLabel, getSubmissions, recentFilings, submissionsUrl } from "./edgar/submissions";
import { factsUrl, fiscalLabel, fyeMonthOf, getCompanyFacts, latestEnd, ltmAt, addMonths, quarterAt, quarterEnds, type CompanyFacts } from "./edgar/facts";
import { capFromShares, chainOf, CHAINS, instantOf, ltmOf, resolveRevenue, sharesOutstanding as resolveShares, type Chain, type Shares } from "./edgar/concepts";
import { quoteProfile, type PricedProfile } from "./market/data";
import { publicOnly } from "./market/user-context";
import { isStaleQuote } from "./market/calendar";
import { noteSource, type Provider } from "./market/provenance";
import { canonical } from "./market/symbols";
import { applyManualInputs } from "@/db/manual";
import { aiUser } from "@/lib/ai/context";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";
import { describeFailure } from "@/lib/errors";
import { forgetMemo, memo } from "@/lib/memo";
import { inBackground } from "@/lib/cache";
import { lease } from "@/lib/locks";
import { SEC_STALE_IF_ERROR_MS } from "@/lib/market/budgets";
import { noteFreshness } from "@/lib/market/provenance";
import { sharedMap } from "@/lib/shared";

const MM = 1e6;
const mm = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round((v / MM) * 10) / 10);

/** Line items only DES/FA read; the shared ones (revenue, income, cash flow, capex, cash, debt) come from edgar/concepts. */
const LOCAL = {
  costOfRevenue: chainOf("cost of revenue", ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices", "CostOfGoodsSold"]),
  grossProfit: chainOf("gross profit", ["GrossProfit"]),
  da: chainOf("D&A", ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAmortizationAndOther"]),
  sbc: chainOf("stock-based compensation", ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense", "SharebasedCompensationArrangementBySharebasedPaymentAwardCompensationCost1"]),
  capSoftware: chainOf("capitalized software", ["PaymentsToDevelopSoftware"]),
  sti: chainOf("short-term investments", ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"]),
};

/** Revenue rows by the shared resolver (DES, FA, COMPS and FCST read the same series). */
export const pickRevenue = (cf: CompanyFacts) => resolveRevenue(cf);

/** LTM for a line item by its chain, recording the concept used. */
function ltmFor(cf: CompanyFacts, key: string, chain: Chain, end: string, concepts: Record<string, string>): number | null {
  const d = ltmOf(cf, chain, end);
  if (d) concepts[key] = d.concept;
  return d ? d.value : null;
}

function instantFor(cf: CompanyFacts, key: string, chain: Chain, end: string, concepts: Record<string, string>): number | null {
  const f = instantOf(cf, chain, end);
  if (f) concepts[key] = f.concept;
  return f ? f.value : null;
}

/** Cover-page shares (summed across classes, with the class count), recording the concept used. */
export function sharesOutstanding(cf: CompanyFacts, concepts: Record<string, string>): Shares | null {
  const s = resolveShares(cf);
  if (s) concepts.shares = s.concept;
  return s;
}

/**
 * Market cap in USD millions: the feed's own figure, else price times cover-page shares for a single
 * share class. Null for several classes without the feed's figure (summed shares times one class's
 * price is wrong: Berkshire's A shares trade at about 1,500 times its B shares).
 */
export function marketCapMm(feedCap: number | null, price: number, shares: Pick<Shares, "total" | "classes"> | null): number | null {
  if (feedCap !== null && feedCap > 0) return feedCap / MM;
  const cap = capFromShares(price, shares);
  return cap === null ? null : cap / MM;
}

/** Cash plus short-term investments, USD millions; null when neither is reported (not $0). */
export const cashPlusInvestments = (cash: number | null, sti: number | null) => (cash === null && sti === null ? null : mm((cash ?? 0) + (sti ?? 0)));

const COMPANY_TTL_MS = 6 * 3_600_000;
/** Past six hours a record still answers at once (flagged stale) while one rebuild runs; past a week it does not. */
const COMPANY_STALE_MS = SEC_STALE_IF_ERROR_MS;

/** Rebuild a stale record in the background: once per ticker per instance, and one instance at a time (a lease). */
function refreshRecord(ticker: string) {
  if (refreshing.has(ticker)) return;
  const run = (async () => {
    const release = db ? await lease(`company-refresh:${ticker}`, 120_000) : async () => undefined;
    if (!release) return;
    try {
      const fresh = await assembleCompany(ticker);
      if (fresh && db) {
        await db.insert(schema.companyCache).values({ ticker, data: fresh, fetchedAt: new Date() }).onConflictDoUpdate({ target: schema.companyCache.ticker, set: { data: fresh, fetchedAt: new Date() } });
        forgetMemo(`company:${ticker}`);
      }
    } finally {
      await release();
    }
  })().finally(() => refreshing.delete(ticker));
  refreshing.set(ticker, run);
  inBackground(run);
}
const refreshing = sharedMap<string, Promise<unknown>>("company:refreshing");

/** Bumped when the stored record's units or fields change, so older records are rebuilt rather than misread. */
export const RECORD_VERSION = 2;

/** The record's price block from a profile (USD millions), with the provider's own as-of, source and flags. */
function priceFrom(p: PricedProfile, shares: Pick<Shares, "total" | "classes"> | null, prior: CompanyData["price"]): NonNullable<CompanyData["price"]> {
  const asOf = p.asOf ?? p.fetchedAt ?? new Date().toISOString();
  return {
    last: p.price, change: p.change, changePct: p.changePct, marketCap: marketCapMm(p.marketCap, p.price, shares) ?? prior?.marketCap ?? null,
    low52: p.low52 ?? prior?.low52 ?? null, high52: p.high52 ?? prior?.high52 ?? null, asOf, source: p.source, fetchedAt: p.fetchedAt,
    // Stale: behind the NYSE session, or a cached profile served past its fresh lifetime (FMP failing or refreshing).
    ...(p.delayed ? { delayed: true } : {}), ...(p.stale || isStaleQuote(asOf) ? { stale: true } : {}),
  };
}

/** No feed answered: the stored price stands, flagged stale with its own as-of (noted for the response's badge). */
function storedPrice(price: NonNullable<CompanyData["price"]>): NonNullable<CompanyData["price"]> {
  const source = (price.source === "Nasdaq" ? "Nasdaq" : "FMP") as Provider;
  noteSource(source, "Price from the last stored record: no feed answered", { asOf: price.asOf, stale: true });
  return { ...price, stale: true };
}

/**
 * The stored record for a ticker (a large JSON document), read at most once a minute per instance and
 * shared by concurrent requests: a watchlist of five tickers polled by hundreds of people would otherwise
 * read and parse the same five rows on every request. Callers clone it before changing anything.
 */
function cachedRecord(ticker: string): Promise<{ data: unknown; fetchedAt: Date } | null> {
  return memo(`company:${ticker}`, 60_000, async () => {
    const [row] = await db!.select({ data: schema.companyCache.data, fetchedAt: schema.companyCache.fetchedAt }).from(schema.companyCache).where(eq(schema.companyCache.ticker, ticker));
    return row ?? null;
  });
}

/** A company with the caller's own manual estimates applied (the person comes from the request context). */
export async function getCompanyData(tickerRaw: string): Promise<CompanyData | null> {
  const base = await companyBase(tickerRaw);
  if (!base) return null;
  const [withInputs] = await applyManualInputs([base], aiUser());
  return withInputs;
}

/**
 * The shared record: filings and fundamentals (cached six hours) with a fresh price. A private copy.
 * Built public-only (market/user-context): it is shared through company_cache, so no one's own keys or
 * source order ever feed it.
 */
function companyBase(tickerRaw: string): Promise<CompanyData | null> {
  return publicOnly(() => sharedCompanyBase(tickerRaw));
}

async function sharedCompanyBase(tickerRaw: string): Promise<CompanyData | null> {
  const ticker = canonical(tickerRaw);
  let base: CompanyData | null = null;
  if (db) {
    try {
      const row = await cachedRecord(ticker);
      const age = row ? Date.now() - row.fetchedAt.getTime() : Infinity;
      // A record written before the current units (fractions, nulls for missing, share classes) is rebuilt, never served stale.
      if (row && age < COMPANY_STALE_MS && (row.data as CompanyData).recordVersion === RECORD_VERSION) {
        base = structuredClone(row.data as CompanyData);
        if (age >= COMPANY_TTL_MS) {
          noteFreshness({ stale: true, fetchedAt: row.fetchedAt.toISOString() });
          refreshRecord(ticker);
        }
        // Refresh the price part more often than the fundamentals.
        // A cached record without a price (every feed was out when it was built) gets one when a feed is back.
        const p = await quoteProfile(ticker).catch(() => null);
        const shares = base.balance.sharesOut ? { total: base.balance.sharesOut * MM, classes: base.balance.shareClasses ?? null } : null;
        if (p) base.price = priceFrom(p, shares, base.price);
        else if (base.price) base.price = storedPrice(base.price);
        if (p && !base.description && p.description) base.description = p.description;
      }
    } catch { /* cache unavailable */ }
  }
  if (!base) {
    base = await assembleCompany(ticker);
    if (!base) return null;
    if (db) {
      try { await db.insert(schema.companyCache).values({ ticker, data: base, fetchedAt: new Date() }).onConflictDoUpdate({ target: schema.companyCache.ticker, set: { data: base, fetchedAt: new Date() } }); } catch { /* ignore */ }
      forgetMemo(`company:${ticker}`);
    }
    base = structuredClone(base);
  }
  return base;
}

async function assembleCompany(tickerRaw: string): Promise<CompanyData | null> {
  const row = await resolveTicker(tickerRaw);
  if (!row) return null;
  const [sub, cf, profile] = await Promise.all([
    getSubmissions(row.cik),
    getCompanyFacts(row.cik),
    quoteProfile(row.ticker).catch(() => null),
  ]);

  const concepts: Record<string, string> = {};
  const notes: string[] = [];

  const revenuePick = pickRevenue(cf);
  const end = revenuePick ? latestEnd(revenuePick.rows) : null;
  if (!revenuePick || !end) notes.push("No revenue concept found in XBRL facts; fundamentals unavailable.");
  const asOf = end ?? new Date().toISOString().slice(0, 10);
  if (revenuePick) concepts.revenue = revenuePick.concept;

  const rev = revenuePick ? ltmAt(revenuePick.rows, asOf) : null;
  const prior = revenuePick ? ltmAt(revenuePick.rows, addMonths(asOf, -12)) : null;
  if (rev) notes.push(`LTM revenue via ${rev.method} (${revenuePick!.concept}).`);
  else if (revenuePick) notes.push(`Revenue rows exist (${revenuePick.concept}) but a full LTM could not be assembled from the reported periods.`);

  let gross = ltmFor(cf, "grossProfit", LOCAL.grossProfit, asOf, concepts);
  if (gross === null && rev) {
    const cogs = ltmFor(cf, "costOfRevenue", LOCAL.costOfRevenue, asOf, concepts);
    if (cogs !== null) { gross = rev.value - cogs; notes.push("Gross profit computed as revenue minus cost of revenue."); }
  }
  const opInc = ltmFor(cf, "operatingIncome", CHAINS.operatingIncome, asOf, concepts);
  const da = ltmFor(cf, "da", LOCAL.da, asOf, concepts);
  const sbc = ltmFor(cf, "sbc", LOCAL.sbc, asOf, concepts);
  const ocf = ltmFor(cf, "ocf", CHAINS.operatingCashFlow, asOf, concepts);
  const capexBase = ltmFor(cf, "capex", CHAINS.capex, asOf, concepts);
  const capSoft = ltmFor(cf, "capSoftware", LOCAL.capSoftware, asOf, concepts);
  const capex = capexBase === null ? null : capexBase + (capSoft ?? 0);
  if (capSoft) notes.push("Capex includes capitalized software development costs.");
  const netIncome = ltmFor(cf, "netIncome", CHAINS.netIncome, asOf, concepts);
  const ebitda = opInc !== null && da !== null ? opInc + da : null;
  const adjEbitda = ebitda !== null && sbc !== null ? ebitda + sbc : null;
  if (ebitda !== null) notes.push("EBITDA = operating income + D&A (reported, not company-adjusted). Adj. EBITDA adds back stock-based compensation.");

  const cash = instantFor(cf, "cash", CHAINS.cash, asOf, concepts);
  const sti = instantFor(cf, "sti", LOCAL.sti, asOf, concepts);
  let debt = instantFor(cf, "debtTotal", CHAINS.debtTotal, asOf, concepts);
  if (debt === null) {
    const nc = instantFor(cf, "debtNoncurrent", CHAINS.debtNoncurrent, asOf, concepts);
    const cur = instantFor(cf, "debtCurrent", CHAINS.debtCurrent, asOf, concepts);
    debt = nc === null && cur === null ? null : (nc ?? 0) + (cur ?? 0);
  }
  if (debt === null) { debt = 0; notes.push("No debt concept reported; debt assumed zero. Verify against the balance sheet."); }
  notes.push("Net debt = debt - cash - short-term investments. Leases, preferred stock, and minority interest excluded.");

  const shares = sharesOutstanding(cf, concepts);
  if (shares && (shares.classes ?? 0) > 1) notes.push(`Shares outstanding sum ${shares.classes} share classes; market cap comes from the price feed, never from summed shares times one class's price.`);

  const fyeMonth = fyeMonthOf(sub.fiscalYearEnd);
  const quarters = revenuePick
    ? quarterEnds(revenuePick.rows, asOf, 8)
        .map((qEnd) => ({ end: qEnd, revenue: quarterAt(revenuePick.rows, qEnd), label: fiscalLabel(qEnd, fyeMonth) }))
        .filter((q): q is { end: string; revenue: number; label: string } => q.revenue !== null)
        .map((q) => ({ ...q, revenue: mm(q.revenue)! }))
    : [];

  const biz = sub.addresses?.business;

  return {
    ticker: row.ticker,
    name: profile?.name ?? sub.name,
    cik: row.cik,
    sic: sub.sic,
    sicLabel: sub.sicDescription,
    exchange: profile?.exchange ?? sub.exchanges?.[0] ?? "",
    hq: profile?.city ? `${profile.city}, ${profile.state ?? ""}`.replace(/, $/, "") : biz ? `${biz.city ?? ""}, ${biz.stateOrCountry ?? ""}` : "",
    fye: fyeLabel(sub.fiscalYearEnd),
    fyeMMDD: sub.fiscalYearEnd,
    description: profile?.description ?? "",
    industry: profile?.industry ?? sub.sicDescription,
    website: profile?.website ?? "",
    price: profile ? priceFrom(profile, shares, null) : null,
    ltm: {
      periodEnd: asOf,
      revenue: mm(rev?.value), priorRevenue: mm(prior?.value), grossProfit: mm(gross), operatingIncome: mm(opInc),
      da: mm(da), sbc: mm(sbc), ebitda: mm(ebitda), adjEbitda: mm(adjEbitda), operatingCashFlow: mm(ocf), capex: mm(capex), netIncome: mm(netIncome),
    },
    balance: { asOf, cash: cashPlusInvestments(cash, sti), debt: mm(debt), sharesOut: shares ? mm(shares.total) : null, shareClasses: shares?.classes ?? null },
    estimates: { ntmRevenue: null, ntmEbitda: null, source: null },
    quarters,
    filings: recentFilings(sub),
    sources: { concepts, notes, factsUrl: factsUrl(row.cik), submissionsUrl: submissionsUrl(row.cik), filed: rev?.parts.reduce((m, f) => (f.filed > m ? f.filed : m), "") || null },
    recordVersion: RECORD_VERSION,
  };
}

/** Resolve several tickers with bounded concurrency, then the caller's manual estimates in one query. Failures are reported per ticker. */
export async function getCompanies(tickers: string[], concurrency = 4): Promise<Record<string, CompanyData | { error: string }>> {
  const out: Record<string, CompanyData | { error: string }> = {};
  const found: CompanyData[] = [];
  const queue = [...new Set(tickers.map((t) => t.toUpperCase()))];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift()!;
      try {
        const c = await companyBase(t);
        out[t] = c ?? { error: "Unknown ticker" };
        if (c) found.push(c);
      } catch (e) {
        out[t] = { error: describeFailure(e, 502, "company").message };
      }
    }
  }));
  await applyManualInputs(found, aiUser());
  return out;
}
