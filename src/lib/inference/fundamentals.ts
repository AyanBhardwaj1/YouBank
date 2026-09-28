/**
 * An annual panel of the fundamentals the credit and forensic models need, read from SEC XBRL company
 * facts: flows for each fiscal year (revenue, cost of revenue, SG&A, depreciation, operating income,
 * net income, operating cash flow, capex, interest, pre-tax income and tax) and balances at each fiscal year end. Each field
 * tries the usual us-gaap tags in order, so a company that switched tags still has a continuous series.
 */
import { pickConcept, type CompanyFacts, type Fact } from "@/lib/edgar/facts";

export type Annual = {
  end: string;
  fy: number;
  revenue: number | null; cogs: number | null; grossProfit: number | null; sga: number | null; da: number | null;
  ebit: number | null; netIncome: number | null; cfo: number | null; capex: number | null; interest: number | null;
  pretax: number | null; incomeTax: number | null;
  totalAssets: number | null; currentAssets: number | null; currentLiabilities: number | null; totalLiabilities: number | null;
  retainedEarnings: number | null; equity: number | null; receivables: number | null; inventory: number | null; ppe: number | null;
  ltDebt: number | null; stDebt: number | null; cash: number | null; shares: number | null;
};

const FLOWS: Record<string, string[]> = {
  revenue: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "SalesRevenueGoodsNet"],
  cogs: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"],
  grossProfit: ["GrossProfit"],
  sga: ["SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense"],
  da: ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "Depreciation"],
  ebit: ["OperatingIncomeLoss"],
  netIncome: ["NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic"],
  cfo: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"],
  capex: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"],
  interest: ["InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestPaidNet"],
  pretax: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"],
  incomeTax: ["IncomeTaxExpenseBenefit"],
};

const INSTANTS: Record<string, string[]> = {
  totalAssets: ["Assets"],
  currentAssets: ["AssetsCurrent"],
  currentLiabilities: ["LiabilitiesCurrent"],
  totalLiabilities: ["Liabilities"],
  retainedEarnings: ["RetainedEarningsAccumulatedDeficit"],
  equity: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"],
  receivables: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsReceivableNet"],
  inventory: ["InventoryNet", "InventoryGross"],
  ppe: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"],
  ltDebt: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt", "LongTermNotesPayable"],
  stDebt: ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "LongTermDebtAndCapitalLeaseObligationsCurrent"],
  cash: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"],
};

const days = (a: string, b: string) => Math.abs(new Date(a + "T00:00:00Z").getTime() - new Date(b + "T00:00:00Z").getTime()) / 86_400_000;

function annualFlow(rows: Fact[], end: string): number | null {
  let best: Fact | null = null;
  for (const r of rows) if (r.start && r.days >= 350 && r.days <= 380 && days(r.end, end) <= 7 && (!best || r.filed > best.filed)) best = r;
  return best ? best.val : null;
}

function instant(rows: Fact[], end: string): number | null {
  let best: Fact | null = null;
  for (const r of rows) if (!r.start && days(r.end, end) <= 7 && (!best || r.filed > best.filed)) best = r;
  return best ? best.val : null;
}

/** The last `years` fiscal years, oldest first. */
export function annualPanel(cf: CompanyFacts, years = 6): Annual[] {
  const flows = Object.fromEntries(Object.entries(FLOWS).map(([k, c]) => [k, pickConcept(cf, c)?.rows ?? []])) as Record<string, Fact[]>;
  const inst = Object.fromEntries(Object.entries(INSTANTS).map(([k, c]) => [k, pickConcept(cf, c)?.rows ?? []])) as Record<string, Fact[]>;
  const sharesRows = pickConcept(cf, ["EntityCommonStockSharesOutstanding"], "shares", "dei")?.rows ?? pickConcept(cf, ["WeightedAverageNumberOfDilutedSharesOutstanding", "CommonStockSharesOutstanding"], "shares")?.rows ?? [];
  // Fiscal year ends: annual rows of the best-covered anchor concepts, one per year.
  const anchor = [...flows.revenue, ...flows.netIncome, ...flows.cfo].filter((r) => r.start && r.days >= 350 && r.days <= 380);
  const ends: { end: string; fy: number }[] = [];
  for (const r of anchor.sort((a, b) => (a.end < b.end ? -1 : 1))) {
    if (ends.some((e) => days(e.end, r.end) <= 20)) continue;
    ends.push({ end: r.end, fy: Number(r.end.slice(0, 4)) });
  }
  const last = ends.slice(-years);
  return last.map(({ end, fy }) => {
    const f = (k: string) => annualFlow(flows[k], end);
    const i = (k: string) => instant(inst[k], end);
    const revenue = f("revenue"), cogs = f("cogs");
    const gp = f("grossProfit") ?? (revenue !== null && cogs !== null ? revenue - cogs : null);
    const ta = i("totalAssets"), eq = i("equity");
    const sharesNear = (() => { let best: Fact | null = null; for (const r of sharesRows) if (days(r.end, end) <= 120 && (!best || days(r.end, end) < days(best.end, end))) best = r; return best?.val ?? null; })();
    return {
      end, fy,
      revenue, cogs, grossProfit: gp, sga: f("sga"), da: f("da"), ebit: f("ebit"), netIncome: f("netIncome"), cfo: f("cfo"), capex: f("capex"), interest: f("interest"),
      pretax: f("pretax"), incomeTax: f("incomeTax"),
      totalAssets: ta, currentAssets: i("currentAssets"), currentLiabilities: i("currentLiabilities"),
      totalLiabilities: i("totalLiabilities") ?? (ta !== null && eq !== null ? ta - eq : null),
      retainedEarnings: i("retainedEarnings"), equity: eq, receivables: i("receivables"), inventory: i("inventory"), ppe: i("ppe"),
      ltDebt: i("ltDebt"), stDebt: i("stDebt"), cash: i("cash"), shares: sharesNear,
    };
  });
}
