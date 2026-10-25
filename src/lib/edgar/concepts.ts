/**
 * One XBRL concept resolver for every screen that reads SEC company facts: DES/FA/COMPS (company.ts),
 * FCST and DDIS (terminal/fundamentals.ts), IRAT and QUAL (inference/fundamentals.ts) and EQS's frames
 * (terminal/screen.ts). Before this each kept its own tag list, so one company could have revenue in DES
 * and none in FCST.
 *
 * Following OpenBB's SEC standardization (research.md §4.1, §4.4):
 * - a chain of tags per line item, first match wins per period (a filer that moved from SalesRevenueNet
 *   to the ASC 606 tag in 2018 keeps one continuous history);
 * - the subset rule: when the matched tag is smaller than the whole-line tag (Revenues) in the same
 *   filing, the whole line wins (the ASC 606 tag can be a component);
 * - year bounds (`until`): a tag retired from the taxonomy is not asked for in later calendar frames;
 * - operating income is never rolled up from parts;
 * - shares for market cap are the cover page's dei:EntityCommonStockSharesOutstanding, one value per
 *   class, summed for the count; us-gaap:CommonStockSharesOutstanding is the fallback.
 * Company-specific extensions (Exxon reports total revenue only that way) are used when the standard
 * chain has nothing current. Pure.
 */
import { addMonths, factRows, instantAt, latestEnd, ltmAt, pickConcept, recentCoverage, rowsFor, extensionConcepts, type CompanyFacts, type Fact } from "./facts";

export type ChainTag = { tag: string; until?: number };
export type Chain = { name: string; tags: ChainTag[]; unit?: string; wholeLine?: string[]; extensions?: { include: RegExp; exclude?: RegExp } };

const t = (...tags: string[]): ChainTag[] => tags.map((tag) => ({ tag }));
/** The last calendar year SalesRevenueNet appears in filings: it left the taxonomy with ASC 606. */
const SALES_REVENUE_NET_UNTIL = 2018;

export const CHAINS = {
  revenue: {
    name: "revenue",
    tags: [
      { tag: "RevenueFromContractWithCustomerExcludingAssessedTax" }, { tag: "Revenues" }, { tag: "RevenueFromContractWithCustomerIncludingAssessedTax" },
      { tag: "SalesRevenueNet", until: SALES_REVENUE_NET_UNTIL }, ...t("SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RevenuesNetOfInterestExpense", "RevenuesExcludingInterestAndDividends"),
    ],
    // Whole-line totals, in priority order: Revenues, then a bank's total net revenue (its ASC 606 tag covers fees only).
    wholeLine: ["Revenues", "RevenuesNetOfInterestExpense"],
    extensions: { include: /Revenue/i, exclude: /Cost|Deferred|Unearned|Proceeds|PerShare|Percent|Tax|Receivable|Contract(Liability|Asset)|Segment|Intersegment|Excise/i },
  },
  /** Attributable to the parent first (EPS and P/E); ProfitLoss (with minority interests) when that is all there is. */
  netIncome: { name: "net income", tags: t("NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic") },
  operatingIncome: { name: "operating income", tags: t("OperatingIncomeLoss") },
  operatingCashFlow: { name: "operating cash flow", tags: t("NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations") },
  capex: { name: "capital expenditure", tags: t("PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets") },
  cash: { name: "cash", tags: t("CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash") },
  /** Total debt (current portion included) where the filer tags one figure. */
  debtTotal: { name: "debt", tags: t("LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount", "ConvertibleDebt", "ConvertibleNotesPayable") },
  debtNoncurrent: { name: "long-term debt", tags: t("LongTermDebtNoncurrent", "ConvertibleDebtNoncurrent", "ConvertibleNotesPayableNoncurrent", "ConvertibleLongTermNotesPayable", "SeniorLongTermNotes", "LongTermDebtAndCapitalLeaseObligationsNoncurrent", "NotesPayableNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt", "LongTermNotesPayable") },
  debtCurrent: { name: "short-term debt", tags: t("LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "LongTermDebtAndCapitalLeaseObligationsCurrent", "ConvertibleDebtCurrent", "ConvertibleNotesPayableCurrent", "NotesPayableCurrent") },
} satisfies Record<string, Chain>;

/** A local list of tags (a line item only one screen reads) as a chain. */
export const chainOf = (name: string, tags: string[], unit?: string): Chain => ({ name, tags: t(...tags), unit });

export type Resolved = { concept: string; rows: (Fact & { concept: string })[] };

const periodKey = (r: Fact) => `${r.start ?? ""}|${r.end}`;
const byPeriod = (a: Fact, b: Fact) => (a.end < b.end ? -1 : a.end > b.end ? 1 : a.days - b.days);

/** The standard chain merged per period: first tag wins, then the whole line where it is larger in the same filing. */
function mergeChain(cf: CompanyFacts, chain: Chain): Resolved["rows"] {
  const unit = chain.unit ?? "USD";
  const merged = new Map<string, Fact & { concept: string }>();
  const whole = new Map<string, Fact & { concept: string }>();
  for (const { tag } of chain.tags) {
    for (const r of rowsFor(cf, "us-gaap", tag, unit)) {
      const k = periodKey(r);
      if (!merged.has(k)) merged.set(k, { ...r, concept: tag });
      if (chain.wholeLine?.includes(tag) && !whole.has(k)) whole.set(k, { ...r, concept: tag });
    }
  }
  for (const [k, m] of merged) {
    const w = whole.get(k);
    if (w && w.concept !== m.concept && w.accn === m.accn && w.val > m.val) merged.set(k, w);
  }
  return [...merged.values()].sort(byPeriod);
}

/** Whether a duration series can give an LTM at its latest period. */
const ltmAble = (rows: Fact[]) => { const end = latestEnd(rows); return !!end && !!ltmAt(rows, end); };

/** The company extension best placed to stand in: most recent coverage, able to give an LTM. */
function bestExtension(cf: CompanyFacts, chain: Chain): Resolved | null {
  if (!chain.extensions) return null;
  const found = extensionConcepts(cf, chain.extensions.include, chain.extensions.exclude)
    .map((e) => ({ concept: `${e.taxonomy}:${e.concept}`, rows: rowsFor(cf, e.taxonomy, e.concept, chain.unit ?? "USD") }))
    .filter((e) => e.rows.length)
    .sort((a, b) => recentCoverage(b.rows) - recentCoverage(a.rows));
  const pick = found.find((e) => ltmAble(e.rows)) ?? found[0];
  return pick ? { concept: pick.concept, rows: pick.rows.map((r) => ({ ...r, concept: pick.concept })) } : null;
}

/** One line item's rows for a company, by its chain. Null when the company reports none of it. */
export function resolveSeries(cf: CompanyFacts, chain: Chain): Resolved | null {
  const rows = mergeChain(cf, chain);
  const ext = bestExtension(cf, chain);
  // An extension stands in when the standard tags give nothing, no LTM, or stopped a year before it.
  const standardEnd = latestEnd(rows), extEnd = ext ? latestEnd(ext.rows) : null;
  if (ext && (!rows.length || !ltmAble(rows) || (standardEnd && extEnd && extEnd > addMonths(standardEnd, 12)))) return ext;
  if (!rows.length) return null;
  return { concept: rows[rows.length - 1].concept, rows };
}

export const resolveRevenue = (cf: CompanyFacts) => resolveSeries(cf, CHAINS.revenue);

/** A line item's LTM ending at `end`: the merged chain, then each tag alone (a tag may carry the periods an LTM needs that the merge mixed). */
export function ltmOf(cf: CompanyFacts, chain: Chain, end: string): { value: number; method: string; concept: string } | null {
  const merged = resolveSeries(cf, chain);
  const d = merged ? ltmAt(merged.rows, end) : null;
  if (merged && d) return { value: d.value, method: d.method, concept: merged.concept };
  for (const { tag } of chain.tags) {
    const pick = pickConcept(cf, [tag], chain.unit ?? "USD");
    const one = pick ? ltmAt(pick.rows, end) : null;
    if (pick && one) return { value: one.value, method: one.method, concept: pick.concept };
  }
  return null;
}

/** A balance-sheet item at or before `end`. */
export function instantOf(cf: CompanyFacts, chain: Chain, end: string): { value: number; concept: string } | null {
  const merged = resolveSeries(cf, chain);
  const f = merged ? instantAt(merged.rows, end) : null;
  return f ? { value: f.val, concept: (f as Fact & { concept?: string }).concept ?? merged!.concept } : null;
}

/* ---------------- Shares ---------------- */

/** Shares outstanding: the count, and how many classes it sums (null when unknown, e.g. a weighted average). */
export type Shares = { total: number; classes: number | null; concept: string; end: string };

const QUARTER_MIN_DAYS = 60, QUARTER_MAX_DAYS = 100;

/** Cover-page shares, one row per class at the latest date of the latest filing, summed; then the balance sheet; then diluted weighted average. */
export function sharesOutstanding(cf: CompanyFacts, today = new Date().toISOString().slice(0, 10)): Shares | null {
  for (const [taxonomy, concept] of [["dei", "EntityCommonStockSharesOutstanding"], ["us-gaap", "CommonStockSharesOutstanding"]] as const) {
    const instants = factRows(cf, taxonomy, concept, "shares").filter((r) => !r.start && r.end <= today && r.val > 0);
    if (!instants.length) continue;
    const end = instants.reduce((m, r) => (r.end > m ? r.end : m), "");
    const atEnd = instants.filter((r) => r.end === end);
    const accn = atEnd.reduce((m, r) => (r.filed > m.filed ? r : m)).accn;
    const classes = atEnd.filter((r) => r.accn === accn);
    const total = classes.reduce((a, r) => a + r.val, 0);
    if (total > 0) return { total, classes: classes.length, concept: `${taxonomy}:${concept}`, end };
  }
  const diluted = pickConcept(cf, ["WeightedAverageNumberOfDilutedSharesOutstanding"], "shares");
  const q = diluted?.rows.filter((r) => r.start && r.days >= QUARTER_MIN_DAYS && r.days <= QUARTER_MAX_DAYS).sort((a, b) => (a.end < b.end ? 1 : -1))[0];
  return q ? { total: q.val, classes: null, concept: "WeightedAverageNumberOfDilutedSharesOutstanding (latest quarter)", end: q.end } : null;
}

/** Cover-page share counts by date, each the sum of its classes in the latest filing that reports that date. */
function coverShares(cf: CompanyFacts): { end: string; total: number }[] {
  const byEnd = new Map<string, { accn: string; filed: string; total: number }>();
  for (const r of factRows(cf, "dei", "EntityCommonStockSharesOutstanding", "shares")) {
    if (r.start || !(r.val > 0)) continue;
    const had = byEnd.get(r.end);
    if (!had || r.filed > had.filed) byEnd.set(r.end, { accn: r.accn, filed: r.filed, total: r.val });
    else if (had.accn === r.accn) had.total += r.val;
  }
  return [...byEnd.entries()].map(([end, v]) => ({ end, total: v.total })).sort((a, b) => (a.end < b.end ? -1 : 1));
}

const dayGap = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** Shares outstanding nearest a fiscal year end (within `tolDays`): the cover page summed across classes, else diluted weighted average or the balance sheet. */
export function sharesNear(cf: CompanyFacts, end: string, tolDays = 120): number | null {
  const near = <T extends { end: string }>(xs: T[]) => xs.filter((x) => dayGap(x.end, end) <= tolDays).sort((a, b) => dayGap(a.end, end) - dayGap(b.end, end))[0];
  const cover = near(coverShares(cf));
  if (cover) return cover.total;
  const other = pickConcept(cf, ["WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"], "shares");
  return other ? near(other.rows)?.val ?? null : null;
}

/**
 * Market cap in dollars from a price and a share count: only for a single class. With several classes
 * each has its own price (Berkshire's A shares trade at about 1,500 times its B shares), so summed shares
 * times one class's price is wrong: null, and the caller says why.
 */
export function capFromShares(price: number, shares: Pick<Shares, "total" | "classes"> | null): number | null {
  return shares && shares.classes === 1 && price > 0 ? price * shares.total : null;
}

/* ---------------- Debt maturities (DDIS) ---------------- */

export const MATURITY = [
  ["Next 12 months", "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths"],
  ["Year 2", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo"],
  ["Year 3", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree"],
  ["Year 4", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour"],
  ["Year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive"],
  ["After year 5", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"],
] as const;

/**
 * The debt maturity ladder (USD millions) from one filing: the latest balance-sheet date any bucket is
 * tagged at, and every bucket as of that date. A bucket the company stopped tagging is left out rather
 * than joining an old year's figure to this year's schedule.
 */
export function maturityLadder(cf: CompanyFacts): { asOf: string | null; ladder: { bucket: string; amount: number }[] } {
  const rows = MATURITY.map(([bucket, tag]) => ({ bucket, rows: rowsFor(cf, "us-gaap", tag).filter((r) => !r.start) }));
  const asOf = rows.flatMap((b) => b.rows).reduce<string | null>((m, r) => (!m || r.end > m ? r.end : m), null);
  if (!asOf) return { asOf: null, ladder: [] };
  const ladder: { bucket: string; amount: number }[] = [];
  for (const b of rows) {
    const hit = b.rows.find((r) => r.end === asOf);
    if (hit) ladder.push({ bucket: b.bucket, amount: hit.val / 1e6 });
  }
  return { asOf, ladder };
}
