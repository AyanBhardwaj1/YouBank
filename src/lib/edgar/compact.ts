/**
 * companyfacts in compact form: only the concepts the app reads, so one company's facts fit the shared
 * Postgres cache (a full document is often 2–10 MB; kv_cache takes up to 3 MB) and a new instance reads
 * them from there instead of downloading them from SEC again (facts.ts getCompanyFacts).
 *
 * Kept: every concept named below (the interactive screens' lists: DES/FA/COMPS in company.ts, the
 * terminal's fundamentals and Street views, the inference panels, splits; and the concept chains used
 * by OpenBB and edgartools for revenue, net income, operating income, cash flow, capex and shares, so a
 * resolver can walk them), any concept whose name matches CONCEPT_FAMILIES, all of `dei`, and a filer's
 * own extension concepts named like revenue (company.ts reads those). Dropped: everything else.
 *
 * Reading a new concept on an interactive path? Add it here (or make sure CONCEPT_FAMILIES matches it).
 * Screens that browse every concept (the XBRL screen) and background jobs use getCompanyFactsFull.
 */
import type { CompanyFacts } from "./facts";

export const FACT_CONCEPTS = new Set([
  // Revenue and its chains
  "Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
  "RevenuesNetOfInterestExpense", "SalesRevenueServicesNet", "SalesRevenueGoodsNet", "RevenuesExcludingInterestAndDividends", "OperatingRevenue",
  "InterestAndDividendIncomeOperating", "NoninterestIncome", "PremiumsEarnedNet", "RegulatedAndUnregulatedOperatingRevenue",
  // Costs and profit
  "CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfServices", "CostOfGoodsSold", "GrossProfit", "OperatingIncomeLoss", "OperatingIncome",
  "IncomeLossFromContinuingOperationsBeforeInterestAndTaxes", "SellingGeneralAndAdministrativeExpense", "GeneralAndAdministrativeExpense",
  "NetIncomeLoss", "ProfitLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "NetIncomeLossAttributableToNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
  "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeTaxExpenseBenefit",
  "InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestPaidNet",
  "DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAmortizationAndOther", "Depreciation",
  "ShareBasedCompensation", "AllocatedShareBasedCompensationExpense", "SharebasedCompensationArrangementBySharebasedPaymentAwardCompensationCost1",
  "EarningsPerShareBasic", "EarningsPerShareDiluted",
  // Cash flow
  "NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  "PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets", "PaymentsToDevelopSoftware",
  "PaymentsOfDividends", "PaymentsOfDividendsCommonStock", "CommonStockDividendsPerShareDeclared", "CommonStockDividendsPerShareCashPaid",
  // Balance sheet
  "Assets", "AssetsCurrent", "Liabilities", "LiabilitiesCurrent", "StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  "RetainedEarningsAccumulatedDeficit", "AccountsReceivableNetCurrent", "ReceivablesNetCurrent", "AccountsReceivableNet", "InventoryNet", "InventoryGross",
  "PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization",
  "CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash",
  "ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  // Debt and its maturities
  "LongTermDebt", "LongTermDebtAndCapitalLeaseObligations", "DebtLongtermAndShorttermCombinedAmount", "ConvertibleDebt", "ConvertibleNotesPayable",
  "LongTermDebtNoncurrent", "ConvertibleDebtNoncurrent", "ConvertibleNotesPayableNoncurrent", "ConvertibleLongTermNotesPayable", "SeniorLongTermNotes",
  "LongTermDebtAndCapitalLeaseObligationsNoncurrent", "NotesPayableNoncurrent", "LongTermNotesPayable",
  "LongTermDebtCurrent", "ConvertibleDebtCurrent", "ConvertibleNotesPayableCurrent", "DebtCurrent", "ShortTermBorrowings", "LongTermDebtAndCapitalLeaseObligationsCurrent", "NotesPayableCurrent",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree",
  "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive",
  // Shares
  "CommonStockSharesOutstanding", "WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic",
  // IFRS filers (20-F, 40-F)
  "Revenue", "ProfitLossAttributableToOwnersOfParent", "CashFlowsFromUsedInOperatingActivities",
]);

/** A safety net for families the statements read (a concept added to a chain without being listed above). */
const CONCEPT_FAMILIES = /^(Revenue|Revenues|SalesRevenue|NetIncome|ProfitLoss|OperatingIncome|GrossProfit|CostOf|NetCashProvidedByUsedIn|PaymentsToAcquire|PaymentsOfDividends|CommonStockDividendsPerShare|WeightedAverageNumberOf|EarningsPerShare|LongTermDebt|ShortTermBorrowings|DebtCurrent|CashAndCashEquivalents|StockholdersEquity)/;

/** Company extension concepts that company.ts considers for revenue. */
const EXTENSION_REVENUE = /Revenue/i;

/** The facts the app reads, in the same shape. Pure. */
export function compactFacts(cf: CompanyFacts): CompanyFacts {
  const facts: CompanyFacts["facts"] = {};
  for (const [taxonomy, byConcept] of Object.entries(cf.facts ?? {})) {
    const keep: CompanyFacts["facts"][string] = {};
    for (const [concept, v] of Object.entries(byConcept)) {
      const wanted = taxonomy === "dei"
        || ((taxonomy === "us-gaap" || taxonomy === "ifrs-full") && (FACT_CONCEPTS.has(concept) || CONCEPT_FAMILIES.test(concept)))
        || (taxonomy !== "us-gaap" && taxonomy !== "ifrs-full" && taxonomy !== "srt" && EXTENSION_REVENUE.test(concept));
      if (wanted) keep[concept] = v;
    }
    if (Object.keys(keep).length) facts[taxonomy] = keep;
  }
  return { cik: cf.cik, entityName: cf.entityName, facts };
}
