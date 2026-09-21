import type { CompanyData } from "./types";
import { resolveTicker } from "./edgar/tickers";
import { fyeLabel, getSubmissions, recentFilings, submissionsUrl } from "./edgar/submissions";
import { factsUrl, fiscalLabel, getCompanyFacts, instantAt, latestEnd, ltmAt, addMonths, pickConcept, quarterAt, quarterEnds, rowsFor, extensionConcepts, recentCoverage, type CompanyFacts, type Fact } from "./edgar/facts";
import { fmpProfile } from "./fmp/client";
import { applyManualInputs } from "@/db/manual";
import { db, schema } from "@/db";
import { eq } from "drizzle-orm";

const MM = 1e6;
const mm = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round((v / MM) * 10) / 10);

const CONCEPTS = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense", "SalesRevenueServicesNet", "RevenuesExcludingInterestAndDividends"],
  costOfRevenue: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices", "CostOfGoodsSold"],
  grossProfit: ["GrossProfit"],
  operatingIncome: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAmortizationAndOther"],
  sbc: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"],
  ocf: ["NetCashProvidedByUsedInOperatingActivities"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  capSoftware: ["PaymentsToDevelopSoftware"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"],
  sti: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"],
  debtTotal: ["LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount", "ConvertibleDebt", "ConvertibleNotesPayable"],
  debtNoncurrent: ["LongTermDebtNoncurrent", "ConvertibleDebtNoncurrent", "ConvertibleNotesPayableNoncurrent", "ConvertibleLongTermNotesPayable", "SeniorLongTermNotes", "LongTermDebtAndCapitalLeaseObligationsNoncurrent", "NotesPayableNoncurrent"],
  debtCurrent: ["LongTermDebtCurrent", "ConvertibleDebtCurrent", "ConvertibleNotesPayableCurrent", "DebtCurrent", "ShortTermBorrowings", "LongTermDebtAndCapitalLeaseObligationsCurrent", "NotesPayableCurrent"],
};

/**
 * Revenue needs extra care: companies switch tags, and some (Exxon, for one) report total revenue only under a
 * company-specific extension element. Try standard candidates first, then extensions named like revenue, and keep
 * the first concept from which a full LTM can be assembled; otherwise the best-covered candidate.
 */
function pickRevenue(cf: CompanyFacts): { concept: string; rows: Fact[] } | null {
  const candidates: { label: string; rows: Fact[] }[] = [];
  for (const c of CONCEPTS.revenue) { const rows = rowsFor(cf, "us-gaap", c); if (rows.length) candidates.push({ label: c, rows }); }
  for (const e of extensionConcepts(cf, /Revenue/i, /Cost|Deferred|Unearned|Proceeds|PerShare|Percent|Tax|Receivable|Contract(Liability|Asset)|Segment|Intersegment|Excise/i)) {
    const rows = rowsFor(cf, e.taxonomy, e.concept);
    if (rows.length) candidates.push({ label: `${e.taxonomy}:${e.concept}`, rows });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => recentCoverage(b.rows) - recentCoverage(a.rows));
  for (const c of candidates) {
    const end = latestEnd(c.rows);
    if (end && ltmAt(c.rows, end)) return { concept: c.label, rows: c.rows };
  }
  return { concept: candidates[0].label, rows: candidates[0].rows };
}

function ltmFor(cf: CompanyFacts, key: keyof typeof CONCEPTS, end: string, concepts: Record<string, string>) {
  const pick = pickConcept(cf, CONCEPTS[key]);
  if (!pick) return { value: null as number | null, method: null as string | null };
  const d = ltmAt(pick.rows, end);
  if (d) concepts[key] = pick.concept;
  return { value: d ? d.value : null, method: d?.method ?? null };
}

function instantFor(cf: CompanyFacts, key: keyof typeof CONCEPTS, end: string, concepts: Record<string, string>) {
  const pick = pickConcept(cf, CONCEPTS[key]);
  if (!pick) return null;
  const f = instantAt(pick.rows, end);
  if (f) concepts[key] = pick.concept;
  return f ? f.val : null;
}

/** Cover-page shares outstanding, summing share classes reported at the same date; falls back to diluted weighted average. */
function sharesOutstanding(cf: CompanyFacts, concepts: Record<string, string>): number | null {
  const today = new Date().toISOString().slice(0, 10);
  for (const [taxonomy, concept] of [["dei", "EntityCommonStockSharesOutstanding"], ["us-gaap", "CommonStockSharesOutstanding"]] as const) {
    const raw = cf.facts[taxonomy]?.[concept]?.units?.["shares"];
    if (!raw?.length) continue;
    const instants = raw.filter((r) => !r.start && r.end <= today && r.val > 0);
    if (!instants.length) continue;
    const latestEnd = instants.reduce((m, r) => (r.end > m ? r.end : m), "");
    const atEnd = instants.filter((r) => r.end === latestEnd);
    const latestAccn = atEnd.reduce((m, r) => (r.filed > m.filed ? r : m)).accn;
    // Multi-class filers report one row per class under the same accession; sum them.
    const total = atEnd.filter((r) => r.accn === latestAccn).reduce((a, r) => a + r.val, 0);
    if (total > 0) { concepts.shares = `${taxonomy}:${concept}`; return total; }
  }
  const diluted = pickConcept(cf, ["WeightedAverageNumberOfDilutedSharesOutstanding"], "shares");
  if (diluted) {
    const q = diluted.rows.filter((r) => r.start && r.days >= 60 && r.days <= 100).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
    if (q) { concepts.shares = "WeightedAverageNumberOfDilutedSharesOutstanding (latest quarter)"; return q.val; }
  }
  return null;
}

const COMPANY_TTL_MS = 6 * 3_600_000;

export async function getCompanyData(tickerRaw: string): Promise<CompanyData | null> {
  const ticker = tickerRaw.toUpperCase().trim();
  let base: CompanyData | null = null;
  if (db) {
    try {
      const [row] = await db.select().from(schema.companyCache).where(eq(schema.companyCache.ticker, ticker));
      if (row && Date.now() - row.fetchedAt.getTime() < COMPANY_TTL_MS) {
        base = structuredClone(row.data as CompanyData);
        // Refresh the price part more often than the fundamentals.
        const p = await fmpProfile(ticker).catch(() => null);
        if (p && base.price) { const [lo, hi] = p.range?.split("-").map(Number) ?? [NaN, NaN]; base.price = { ...base.price, last: p.price, change: p.change, changePct: p.changePercentage, marketCap: p.marketCap / MM, low52: Number.isFinite(lo) ? lo : base.price.low52, high52: Number.isFinite(hi) ? hi : base.price.high52, asOf: p.fetchedAt }; }
      }
    } catch { /* cache unavailable */ }
  }
  if (!base) {
    base = await assembleCompany(ticker);
    if (!base) return null;
    if (db) {
      try { await db.insert(schema.companyCache).values({ ticker, data: base, fetchedAt: new Date() }).onConflictDoUpdate({ target: schema.companyCache.ticker, set: { data: base, fetchedAt: new Date() } }); } catch { /* ignore */ }
    }
    base = structuredClone(base);
  }
  const [withInputs] = await applyManualInputs([base]);
  return withInputs;
}

async function assembleCompany(tickerRaw: string): Promise<CompanyData | null> {
  const row = await resolveTicker(tickerRaw);
  if (!row) return null;
  const [sub, cf, profile] = await Promise.all([
    getSubmissions(row.cik),
    getCompanyFacts(row.cik),
    fmpProfile(row.ticker).catch(() => null),
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

  let gross = ltmFor(cf, "grossProfit", asOf, concepts).value;
  if (gross === null && rev) {
    const cogs = ltmFor(cf, "costOfRevenue", asOf, concepts).value;
    if (cogs !== null) { gross = rev.value - cogs; notes.push("Gross profit computed as revenue minus cost of revenue."); }
  }
  const opInc = ltmFor(cf, "operatingIncome", asOf, concepts).value;
  const da = ltmFor(cf, "da", asOf, concepts).value;
  const sbc = ltmFor(cf, "sbc", asOf, concepts).value;
  const ocf = ltmFor(cf, "ocf", asOf, concepts).value;
  const capexBase = ltmFor(cf, "capex", asOf, concepts).value;
  const capSoft = ltmFor(cf, "capSoftware", asOf, concepts).value;
  const capex = capexBase === null ? null : capexBase + (capSoft ?? 0);
  if (capSoft) notes.push("Capex includes capitalized software development costs.");
  const netIncome = ltmFor(cf, "netIncome", asOf, concepts).value;
  const ebitda = opInc !== null && da !== null ? opInc + da : null;
  const adjEbitda = ebitda !== null && sbc !== null ? ebitda + sbc : null;
  if (ebitda !== null) notes.push("EBITDA = operating income + D&A (reported, not company-adjusted). Adj. EBITDA adds back stock-based compensation.");

  const cash = instantFor(cf, "cash", asOf, concepts);
  const sti = instantFor(cf, "sti", asOf, concepts);
  let debt = instantFor(cf, "debtTotal", asOf, concepts);
  if (debt === null) {
    const nc = instantFor(cf, "debtNoncurrent", asOf, concepts);
    const cur = instantFor(cf, "debtCurrent", asOf, concepts);
    debt = nc === null && cur === null ? null : (nc ?? 0) + (cur ?? 0);
  }
  if (debt === null) { debt = 0; notes.push("No debt concept reported; debt assumed zero. Verify against the balance sheet."); }
  notes.push("Net debt = debt - cash - short-term investments. Leases, preferred stock, and minority interest excluded.");

  const shares = sharesOutstanding(cf, concepts);
  const sharesFact = shares !== null ? { val: shares } : null;

  const fyeMonth = Number(sub.fiscalYearEnd?.slice(0, 2)) || 12;
  const quarters = revenuePick
    ? quarterEnds(revenuePick.rows, asOf, 8)
        .map((qEnd) => ({ end: qEnd, revenue: quarterAt(revenuePick.rows, qEnd), label: fiscalLabel(qEnd, fyeMonth) }))
        .filter((q): q is { end: string; revenue: number; label: string } => q.revenue !== null)
        .map((q) => ({ ...q, revenue: mm(q.revenue)! }))
    : [];

  const marketCap = profile ? (profile.marketCap > 0 ? profile.marketCap : sharesFact ? profile.price * sharesFact.val : 0) / MM : null;
  const [lo, hi] = profile?.range?.split("-").map(Number) ?? [NaN, NaN];
  const biz = sub.addresses?.business;

  return {
    ticker: row.ticker,
    name: profile?.companyName ?? sub.name,
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
    price: profile && marketCap !== null ? {
      last: profile.price, change: profile.change, changePct: profile.changePercentage, marketCap,
      low52: Number.isFinite(lo) ? lo : null, high52: Number.isFinite(hi) ? hi : null, asOf: profile.fetchedAt,
    } : null,
    ltm: {
      periodEnd: asOf,
      revenue: mm(rev?.value), priorRevenue: mm(prior?.value), grossProfit: mm(gross), operatingIncome: mm(opInc),
      da: mm(da), sbc: mm(sbc), ebitda: mm(ebitda), adjEbitda: mm(adjEbitda), operatingCashFlow: mm(ocf), capex: mm(capex), netIncome: mm(netIncome),
    },
    balance: { asOf, cash: mm((cash ?? 0) + (sti ?? 0)), debt: mm(debt), sharesOut: sharesFact ? mm(sharesFact.val) : null },
    estimates: { ntmRevenue: null, ntmEbitda: null, source: null },
    quarters,
    filings: recentFilings(sub),
    sources: { concepts, notes, factsUrl: factsUrl(row.cik), submissionsUrl: submissionsUrl(row.cik) },
  };
}

/** Resolve several tickers with bounded concurrency. Failures are reported per ticker. */
export async function getCompanies(tickers: string[], concurrency = 4): Promise<Record<string, CompanyData | { error: string }>> {
  const out: Record<string, CompanyData | { error: string }> = {};
  const queue = [...new Set(tickers.map((t) => t.toUpperCase()))];
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const t = queue.shift()!;
      try {
        const c = await getCompanyData(t);
        out[t] = c ?? { error: "Unknown ticker" };
      } catch (e) {
        out[t] = { error: e instanceof Error ? e.message : String(e) };
      }
    }
  }));
  return out;
}
