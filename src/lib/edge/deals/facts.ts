/**
 * A target's own figures at announcement, from SEC XBRL company facts as they had been filed by then (no
 * later restatement leaks in): LTM revenue and EBITDA (operating income plus depreciation and amortisation),
 * net debt and shares outstanding. They give the deal's multiples and the cross-field checks (deals/checks).
 * The figure's own filing is kept as its source.
 */
import { getCompanyFacts, ltmAt, normalize, type CompanyFacts, type Fact } from "@/lib/edgar/facts";

export type TargetFacts = { revenueMm: number | null; ebitdaMm: number | null; netDebtMm: number | null; sharesMm: number | null; asOf: string; periodEnd: string | null; source: string };

/** A concept's rows filed on or before a date, normalised. Pure. */
export function rowsAsOf(cf: CompanyFacts, concepts: string[], date: string, unit = "USD", taxonomy = "us-gaap"): Fact[] {
  for (const c of concepts) {
    const raw = cf.facts[taxonomy]?.[c]?.units?.[unit];
    if (!raw?.length) continue;
    const rows = normalize(raw.filter((r) => r.filed <= date));
    if (rows.length) return rows;
  }
  return [];
}

/** The latest instant value on or before the period end. Pure. */
const latestInstant = (rows: Fact[], end: string) => rows.filter((r) => !r.start && r.end <= end).sort((a, b) => a.end.localeCompare(b.end) || a.filed.localeCompare(b.filed)).pop() ?? null;

/** A target's figures as filed by `date`. Pure over company facts. */
export function factsAsOf(cf: CompanyFacts, date: string): TargetFacts {
  const revenue = rowsAsOf(cf, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"], date);
  const opInc = rowsAsOf(cf, ["OperatingIncomeLoss"], date);
  const da = rowsAsOf(cf, ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"], date);
  const latestEnd = [...revenue, ...opInc].filter((r) => r.start).map((r) => r.end).sort().pop() ?? null;
  const rev = latestEnd ? ltmAt(revenue, latestEnd) : null;
  const oi = latestEnd ? ltmAt(opInc, latestEnd) : null;
  const d = latestEnd ? ltmAt(da, latestEnd) : null;
  const debtRows = ["LongTermDebt", "LongTermDebtNoncurrent", "DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings", "CommercialPaper"].map((c) => rowsAsOf(cf, [c], date));
  const cashRows = rowsAsOf(cf, ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"], date);
  const end = latestEnd ?? date;
  // LongTermDebt includes its current portion; the noncurrent and current tags are added only without it.
  const ltd = latestInstant(debtRows[0], end);
  const parts = ltd ? [ltd, latestInstant(debtRows[4], end), latestInstant(debtRows[5], end)] : debtRows.slice(1).map((r) => latestInstant(r, end));
  const debt = parts.reduce((s, r) => s + (r?.val ?? 0), 0);
  const cash = latestInstant(cashRows, end)?.val ?? null;
  const shares = latestInstant(rowsAsOf(cf, ["EntityCommonStockSharesOutstanding"], date, "shares", "dei"), date)
    ?? latestInstant(rowsAsOf(cf, ["CommonStockSharesOutstanding"], date, "shares"), end);
  const mm = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? null : Math.round(v / 1e4) / 100);
  return {
    revenueMm: mm(rev?.value), ebitdaMm: oi ? mm(oi.value + (d?.value ?? 0)) : null,
    netDebtMm: parts.some(Boolean) || cash !== null ? mm(debt - (cash ?? 0)) : null, sharesMm: mm(shares?.val),
    asOf: date, periodEnd: latestEnd, source: `SEC XBRL company facts as filed by ${date}${latestEnd ? `, LTM to ${latestEnd}` : ""}`,
  };
}

export async function targetFacts(cik: string, date: string): Promise<TargetFacts | null> {
  if (!cik) return null;
  const cf = await getCompanyFacts(cik.padStart(10, "0")).catch(() => null);
  return cf ? factsAsOf(cf, date) : null;
}
