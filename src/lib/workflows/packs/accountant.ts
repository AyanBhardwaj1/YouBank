/**
 * Accountant pack: audit, tax, technical accounting / SEC reporting, transaction advisory (FDD), valuation,
 * forensic and controllership. AI workflows encode the standard (ASC/AS) method over SEC filings, XBRL facts,
 * EDGAR full-text search and pasted client exports; calculators implement the formulas exactly (AS 2105
 * materiality, AS 2315 attribute and monetary unit sampling, ASC 606 relative-SSP allocation, ASC 842 present
 * value with monthly discounting, ASC 740 rate reconciliation, treasury stock method, relief from royalty with
 * a tax amortization benefit, ASC 350 one-step impairment, four-column proof of cash, Benford, Section 382).
 * Authored from docs/research/accounting.md; see packs/core.ts for the reference implementation.
 */
import { fmt, num, str, list, parseCsv, type Inputs, type OutputBlock, type ToolDef, type WorkflowOutput } from "../types";

/* ---------------- Specialties ---------------- */

const AUD = "Audit", TAX = "Tax", TECH = "Technical accounting / SEC reporting", FDD = "Transaction advisory (FDD)", VAL = "Valuation", FRN = "Forensic", CTRL = "Controllership";
/** Specialty strings owned by other roles, so a shared tool still resolves for them. */
const X_CTRL = ["Controller / accounting ops", "Accounting"];
const X_FDD = ["Financial due diligence (TAS)", "Corporate development / M&A", "Accounting"];
const X_VAL = ["Economic & valuation advisory", "Corporate development / M&A"];
const X_REP = ["Controller / accounting ops", "Investor relations", "Strategic finance", "Accounting"];

/* ---------------- CSV helpers ---------------- */

type Row = Record<string, string>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Parse pasted CSV/TSV into records keyed by normalized header name. */
function records(text: string): Row[] {
  const { header, rows } = parseCsv(text);
  if (!header.length || !rows.length) throw new Error("Paste a CSV with a header row and at least one data row.");
  const keys = header.map(norm);
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
const cell = (r: Row, ...aliases: string[]): string => { for (const a of aliases) { const v = r[norm(a)]; if (v) return v; } return ""; };
/** Numeric cell: strips $ , % and whitespace, treats (123) as negative. */
const cnum = (r: Row, ...aliases: string[]): number => {
  const raw = cell(r, ...aliases).replace(/[,$%\s]/g, "");
  const neg = /^\(.*\)$/.test(raw);
  const n = Number(raw.replace(/[()]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : 0;
};
const need = (r: Row, label: string, ...aliases: string[]) => { if (!cell(r, ...aliases)) throw new Error(`CSV needs a "${label}" column (accepted names: ${aliases.join(", ")}).`); };

/* ---------------- Math helpers ---------------- */

const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
/** Present value of a monthly payment stream. rate is the ANNUAL nominal rate; discounting is monthly at rate/12. */
function pvMonthly(payments: number[], annualRate: number, inAdvance: boolean): number {
  const r = annualRate / 12;
  return payments.reduce((a, p, k) => a + p / Math.pow(1 + r, inAdvance ? k : k + 1), 0);
}
/** Poisson reliability (confidence) factor at zero expected misstatements, by risk of incorrect acceptance (%). */
const MUS_RF: Record<string, number> = { "5": 3.0, "10": 2.31, "15": 1.9, "20": 1.61, "25": 1.39, "30": 1.21, "37": 1.0, "50": 0.7 };
/** AICPA expansion factors applied to expected misstatement in monetary unit sampling. */
const MUS_EF: Record<string, number> = { "5": 1.6, "10": 1.5, "15": 1.4, "20": 1.3, "25": 1.25, "30": 1.2, "37": 1.15, "50": 1.0 };
/** Poisson reliability factors by number of observed deviations/overstatements, at 5% and 10% risk. */
const RF_BY_K: Record<string, number[]> = {
  "5": [3.0, 4.75, 6.3, 7.76, 9.16, 10.52, 11.85, 13.15, 14.44, 15.71, 16.97],
  "10": [2.31, 3.89, 5.33, 6.69, 8.0, 9.28, 10.54, 11.78, 13.0, 14.21, 15.41],
};
const rfAt = (risk: string, k: number): number => { const t = RF_BY_K[risk] ?? RF_BY_K["5"]; return t[Math.min(k, t.length - 1)] + Math.max(0, k - (t.length - 1)) * 1.3; };
/** Benford expected frequency of a leading digit d (1..9) or first-two-digits dd (10..99): log10(1 + 1/d). */
const benford = (d: number) => Math.log10(1 + 1 / d);

/* ---------------- Output helpers ---------------- */

/** Two-column assumptions table, so every calculator shows what it was fed. */
const assumptions = (rows: [string, string][], title = "Inputs and assumptions"): OutputBlock => ({ type: "table", title, columns: ["Input", "Value"], rows: rows.map(([a, b]) => [a, b]) });

/* ======================================================================================
 * AI workflows: technical accounting memos (ASC 606, 842, 805, 350, 718, 740, 326, 450, IFRS)
 * ====================================================================================== */

const memo606: ToolDef = {
  kind: "ai", id: "acc-asc606-memo", title: "ASC 606 revenue memo", tagline: "The five-step analysis of a real contract, with codification cites and the entries.",
  description: "Drafts an issue/facts/guidance/analysis/conclusion memo on a customer contract under ASC 606: contract identification, performance obligations, transaction price with variable consideration and the constraint, relative standalone-selling-price allocation, and timing of satisfaction. Cites the codification paragraph for every conclusion and benchmarks the policy language against peer 10-K revenue notes and SEC staff comment letters.",
  roles: ["accountant", "corpfin", "student"], specialties: [TECH, AUD, CTRL, ...X_REP], category: "Accounting & audit", icon: "ScrollText", deliverable: "memo", savesMinutes: 240, tags: ["ASC 606", "revenue", "memo", "SSP"],
  fields: [
    { key: "facts", label: "Contract facts", type: "textarea", required: true, placeholder: "Three-year SaaS subscription $1.2m/yr, one-time implementation fee $250k, usage overages billed monthly, 10% renewal discount, termination for convenience with 30 days notice", help: "Paste the contract summary or the relevant clauses" },
    { key: "ticker", label: "Company (for policy and peer language)", type: "ticker", placeholder: "NOW" },
    { key: "peers", label: "Peers for policy benchmarking", type: "tickers", placeholder: "SNOW CRM DDOG" },
    { key: "issues", label: "Issues to resolve", type: "multiselect", options: ["Performance obligations", "Variable consideration & constraint", "Material right / renewal option", "Principal vs agent", "Standalone selling price & allocation", "Over time vs point in time", "Significant financing component", "Contract costs (ASC 340-40)", "Contract modification"], default: ["Performance obligations", "Standalone selling price & allocation", "Over time vs point in time"] },
  ],
  example: { facts: "Three-year SaaS subscription at $1.2m per year invoiced annually in advance, a one-time implementation fee of $250k performed over the first 90 days by our own team, usage overages billed monthly at $0.02 per API call, and a contractual 10% discount on the first renewal year.", ticker: "NOW", peers: ["SNOW", "CRM"], issues: ["Performance obligations", "Variable consideration & constraint", "Material right / renewal option", "Standalone selling price & allocation", "Over time vs point in time"] },
  effort: "high",
  instructions: `Write the memo in the firm's standard format: Issue, Facts, Authoritative guidance, Analysis, Conclusion, Financial statement effect, Disclosure.
1. Restate the facts from the input as a numbered fact pattern; list any fact you need and do not have, and carry an assumption forward explicitly.
2. Step 1 - contract: test the five criteria in ASC 606-10-25-1 (approval and commitment, identifiable rights, payment terms, commercial substance, probable collection) and consider enforceable term where there is a termination for convenience (606-10-25-3, 55-4).
3. Step 2 - performance obligations: apply 606-10-25-14 through 25-22. For each promise state whether the good or service is capable of being distinct (25-19(a)) and distinct in the context of the contract (25-21: significant integration, significant modification/customization, highly interdependent). Address setup/implementation as a possible non-distinct activity (606-10-55-54) and a renewal discount as a material right (606-10-55-42, 55-43). Conclude a numbered list of performance obligations.
4. Step 3 - transaction price: 606-10-32-2. Estimate variable consideration by expected value or most likely amount (32-8) and apply the constraint (32-11, 32-12); test for a significant financing component (32-15 to 32-20) on annual-in-advance billing; consider consideration payable to a customer (32-25) and non-cash consideration (32-21). Where usage is a usage-based fee on IP, consider the sales-based royalty exception (606-10-55-65).
5. Step 4 - allocation: allocate on relative standalone selling price (32-31, 32-33), stating the SSP method for each obligation (observable price, adjusted market assessment, expected cost plus margin, residual only if 32-34 is met). Apply the discount-allocation exception (32-36, 32-37) and the variable-consideration allocation exception (32-39, 32-40) only if the criteria are met and say why.
6. Step 5 - recognition: for each obligation conclude over time (606-10-25-27: simultaneous receipt and consumption, enhancement of a customer-controlled asset, no alternative use plus enforceable right to payment) with an input or output measure (55-16 to 55-21), or point in time on transfer of control (25-30). Consider principal vs agent (55-36 to 55-40) if flagged.
7. Costs: apply ASC 340-40-25-1 to incremental costs of obtaining the contract and 340-40-25-5 to fulfillment costs, with the amortization period including anticipated renewals (340-40-35-1).
8. Benchmark: call search_filing on the company's and each peer's 10-K for "revenue recognition", "performance obligations", "standalone selling price", "variable consideration" and "remaining performance obligations" and quote how they describe the same judgment; call edgar_fulltext_search with forms ["UPLOAD","CORRESP"] for "performance obligation" or "standalone selling price" plus the sector to find what the SEC staff asked peers, and read_document the most relevant letter.
Produce: callout with the conclusion in one sentence; markdown "Issue and facts"; steps "Five-step analysis" (one item per step, the cite in the detail); table "Performance obligations and allocation" (Obligation, SSP method, SSP, Allocated price, Timing, Measure of progress, ASC cite); table "Illustrative entries" (Date/event, Dr, Cr, Amount); bullets "Key judgments and alternatives considered"; table "Peer policy language" (Company, Quote, Source); checklist "Disclosure (606-10-50)"; risks on the judgments most likely to draw a comment letter. Use calc for every allocation number and show the arithmetic.`,
  prompt: (i) => `Draft an ASC 606 memo on these facts:\n\n${str(i, "facts")}\n\nIssues to resolve: ${list(i, "issues").join("; ") || "the full five steps"}.${str(i, "ticker") ? ` Company: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark the policy language against ${list(i, "peers").join(", ")}.` : ""}`,
};

const memo842: ToolDef = {
  kind: "ai", id: "acc-asc842-memo", title: "ASC 842 lease memo & IBR support", tagline: "Classification against the five criteria, an incremental borrowing rate you can defend, and the schedule.",
  description: "Classifies a lease under ASC 842-10-25-2, builds and supports the incremental borrowing rate, and drafts the memo with the right-of-use asset and liability measurement, remeasurement triggers and disclosure requirements. Benchmarks the rate against the weighted-average discount rates peers disclose in their 10-K lease notes.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, CTRL, ...X_REP], category: "Accounting & audit", icon: "Layers", deliverable: "memo", savesMinutes: 150, tags: ["ASC 842", "leases", "IBR", "IFRS 16"],
  fields: [
    { key: "terms", label: "Lease terms", type: "textarea", required: true, placeholder: "7-year term, $1.2m per year paid monthly in advance, 3% annual escalation, asset economic life 10 years, fair value $9m, renewal option 5 years, IBR estimate 6.5%" },
    { key: "ticker", label: "Lessee (for peer rate benchmarking)", type: "ticker", placeholder: "CMG" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "MCD SBUX YUM" },
    { key: "framework", label: "Framework", type: "select", options: ["US GAAP (ASC 842)", "US GAAP with IFRS 16 comparison"], default: "US GAAP (ASC 842)" },
  ],
  example: { terms: "Seven-year lease of a distribution centre, $1.2m per year payable monthly in advance with 3% annual escalation, asset economic life 10 years, fair value $9m, one five-year renewal option not reasonably certain of exercise, $150k of landlord incentives and $80k of initial direct costs, IBR estimate 6.5%.", ticker: "CMG", peers: ["MCD", "SBUX", "YUM"], framework: "US GAAP with IFRS 16 comparison" },
  effort: "medium",
  instructions: `1. Scope: confirm an identified asset and the right to control its use (ASC 842-10-15-2 to 15-4: right to substantially all economic benefits and to direct the use), and whether a lease component is separable from non-lease components (842-10-15-28 to 15-33; note the practical expedient in 15-37).
2. Lease term: 842-10-30-1 with renewal and termination options included only when reasonably certain (842-10-55-26 factors: economic incentive, leasehold improvements, relocation cost, below-market renewal).
3. Classification: test all five criteria in 842-10-25-2 in order - transfer of ownership, purchase option reasonably certain, major part of remaining economic life (the 75% guideline in 842-10-55-2), present value of payments and residual value guarantee substantially all of fair value (the 90% guideline), specialized asset with no alternative use. State the numeric result of each test and the conclusion (finance vs operating).
4. Discount rate: use the rate implicit in the lease only if readily determinable (842-30-20); otherwise build the incremental borrowing rate as a collateralized, similar-term rate: start from a Treasury yield of matching tenor, add the lessee's credit spread from its own debt, then apply a downward collateral adjustment, and say which step used which evidence. Call get_xbrl_series with find "Lease" then concepts like OperatingLeaseWeightedAverageDiscountPercent and FinanceLeaseWeightedAverageDiscountPercent for the lessee and each peer, and search_filing on each peer's 10-K for "weighted-average discount rate" and "incremental borrowing rate" to place the chosen rate in the peer range. For a private lessee note the risk-free rate election (842-20-30-3).
5. Measurement: liability is the present value of remaining payments discounted monthly; ROU asset is the liability plus prepaid rent and initial direct costs less incentives (842-20-30-5). Show the first 12 months of the schedule and annual totals, and state the expense pattern (single straight-line cost for operating; interest plus straight-line amortization for finance).
6. Remeasurement and modification triggers (842-10-35-1 to 35-5, 842-20-35-4) and impairment interaction.
7. If the framework asks for IFRS 16, contrast: single lessee model, no classification test, front-loaded expense, and the effect on EBITDA and leverage metrics.
Produce: kpis (lease liability, ROU asset, discount rate, classification, annual expense); steps "Classification tests" with the numeric result and cite for each of the five criteria; table "IBR build" (component, rate, evidence); table "Peer disclosed discount rates" (company, operating rate, finance rate, weighted-average remaining term, source); table "Schedule" (period, payment, interest, principal/amortization, closing liability, ROU asset); bullets "Judgments"; checklist "Disclosure (842-20-50)"; caveats on evidence you could not obtain. Use calc for every present value.`,
  prompt: (i) => `Classify and measure this lease under ${str(i, "framework", "US GAAP (ASC 842)")}:\n\n${str(i, "terms")}\n${str(i, "ticker") ? `\nLessee: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark the discount rate against ${list(i, "peers").join(", ")}.` : ""}`,
};

const memo805: ToolDef = {
  kind: "ai", id: "acc-asc805-ppa-memo", title: "ASC 805 purchase price allocation memo", tagline: "Consideration, identifiable intangibles by method, goodwill as the residual, and the peer allocation mix.",
  description: "Drafts the business combination memo: whether the transaction is a business, the acquisition date and acquirer, consideration transferred including contingent consideration, the identifiable intangibles with the valuation method for each (relief from royalty, multi-period excess earnings, with-and-without), deferred taxes, and goodwill as the residual. Benchmarks the allocation mix and useful lives against comparable deals disclosed in peer 10-Ks and 8-K/S-4 filings.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [TECH, VAL, FDD, AUD, ...X_VAL], category: "Accounting & audit", icon: "Split", deliverable: "memo", savesMinutes: 300, tags: ["ASC 805", "PPA", "intangibles", "goodwill"],
  fields: [
    { key: "deal", label: "Deal facts", type: "textarea", required: true, placeholder: "$400m cash purchase of a vertical software business, $40m earnout on 2027 revenue, target LTM revenue $85m and EBITDA $18m, 92% gross retention, trade name used in market, 120 enterprise customers" },
    { key: "acquirer", label: "Acquirer", type: "ticker", placeholder: "NOW" },
    { key: "peers", label: "Comparable acquirers for allocation mix", type: "tickers", placeholder: "CRM ADBE INTU" },
    { key: "intangibles", label: "Intangibles to value", type: "multiselect", options: ["Customer relationships (MPEEM)", "Developed technology (RFR or MPEEM)", "Trade name (relief from royalty)", "Non-compete (with-and-without)", "Backlog", "In-process R&D", "Favorable/unfavorable contracts"], default: ["Customer relationships (MPEEM)", "Developed technology (RFR or MPEEM)", "Trade name (relief from royalty)", "Non-compete (with-and-without)"] },
  ],
  example: { deal: "$400m all-cash acquisition of a vertical software business with a $40m earnout on 2027 revenue; target LTM revenue $85m growing 18%, LTM EBITDA $18m, 120 enterprise customers with 92% gross retention, a trade name used in the market, and a two-year non-compete with the two founders.", acquirer: "NOW", peers: ["CRM", "ADBE", "INTU"], intangibles: ["Customer relationships (MPEEM)", "Developed technology (RFR or MPEEM)", "Trade name (relief from royalty)", "Non-compete (with-and-without)"] },
  effort: "high",
  instructions: `1. Threshold questions: is the acquired set a business (ASC 805-10-55-3A screen for a single identifiable asset, and the substantive process test in 805-10-55-5A to 55-9), who is the accounting acquirer (805-10-25-5, 55-11 to 55-15), and what is the acquisition date (805-10-25-6, control transfer).
2. Consideration transferred (805-30-30-7): cash, equity at acquisition-date fair value, contingent consideration classified as liability or equity (805-30-25-5, 805-30-35-1 for subsequent remeasurement), settlement of pre-existing relationships and replacement awards (805-30-30-9 to 30-13, ASC 718 split between consideration and post-combination compensation).
3. Identify intangibles under 805-20-55-11 to 55-45 by class (customer, technology, marketing-related, contract-based) and choose the method for each: relief from royalty (present value of after-tax royalties avoided at a market royalty rate, with a tax amortization benefit), multi-period excess earnings for customer relationships (attrition-decayed revenue, less operating expense, less contributory asset charges for working capital, fixed assets, technology and workforce, taxed, discounted), with-and-without for non-competes (probability-weighted cash flow difference). State the discount rate for each asset relative to the WACC and the IRR of the deal.
4. Reconcile: run the weighted average return on assets test (asset-weighted required returns against the WACC and the deal IRR) and explain any gap (805-20-30 and ASC 820 fair value measurement, highest and best use, market participant assumptions).
5. Deferred taxes: record deferred tax liabilities on the step-up of non-deductible intangibles in a stock deal (805-740-25-3) and no deferred tax on goodwill except component-1 tax-deductible goodwill; goodwill is the residual (805-30-30-1) and is never a plug for an error in the other steps.
6. Benchmark: call get_xbrl_series with find "Business|Acquisition|Intangible" and concepts such as FiniteLivedIntangibleAssetsAcquired1 and Goodwill for the acquirer, and search_filing on the acquirer's and each peer's 10-K for "business combinations", "purchase price allocation", "weighted-average useful life" and "customer relationships" to tabulate the mix (% of consideration to each class) and the useful lives they assigned; use edgar_fulltext_search forms ["8-K","S-4","10-Q"] with the target name if the deal is public.
Produce: kpis (consideration, identifiable intangibles, goodwill, goodwill as % of consideration, implied EV/EBITDA); waterfall "Consideration to goodwill" (consideration, less net tangible assets, less each intangible class, less DTL, equals goodwill); table "Intangible assets" (asset, method, key assumptions, fair value, useful life, amortization method, ASC cite); table "Peer allocation mix" (acquirer, deal, % customer, % technology, % trade name, % goodwill, source); markdown "Analysis" per numbered step with cites; bullets "Open items and PPA measurement period (805-10-25-13 to 25-19)"; risks. Every number through calc.`,
  prompt: (i) => `Draft the ASC 805 purchase price allocation memo for this transaction:\n\n${str(i, "deal")}\n\nValue: ${list(i, "intangibles").join("; ") || "all identifiable intangibles"}.${str(i, "acquirer") ? ` Acquirer: ${str(i, "acquirer").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark the allocation mix against ${list(i, "peers").join(", ")}.` : ""}`,
};

const memo350: ToolDef = {
  kind: "ai", id: "acc-asc350-goodwill-memo", title: "ASC 350 goodwill impairment assessment", tagline: "Step zero factors, the one-step quantitative test, and the market capitalization reconciliation.",
  description: "Runs the goodwill impairment assessment under ASC 350-20 as amended by ASU 2017-04: the optional qualitative screen, then the single quantitative step comparing reporting unit carrying amount to fair value from a discounted cash flow and guideline multiples, reconciled to market capitalization with an implied control premium. Uses live XBRL goodwill balances and peer impairment history.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [TECH, VAL, AUD, ...X_VAL], category: "Accounting & audit", icon: "TrendingDown", deliverable: "memo", savesMinutes: 240, tags: ["ASC 350", "goodwill", "impairment", "triggering event"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
    { key: "unit", label: "Reporting unit", type: "text", required: true, placeholder: "Networks" },
    { key: "trigger", label: "Trigger", type: "select", options: ["Annual test", "Share price decline", "Loss of a major customer", "Missed forecast", "Restructuring / reorganization", "Adverse regulation or litigation"], default: "Share price decline" },
    { key: "carrying", label: "Reporting unit carrying amount", type: "number", unit: "$mm", placeholder: "34000" },
    { key: "goodwill", label: "Goodwill allocated to the unit", type: "number", unit: "$mm", placeholder: "12000" },
  ],
  example: { ticker: "WBD", unit: "Networks", trigger: "Share price decline", carrying: 34000, goodwill: 12000 },
  effort: "high",
  instructions: `1. Establish the balances: call get_company_financials and get_xbrl_series with find "Goodwill|Impairment" then concepts Goodwill, GoodwillImpairmentLoss, IntangibleAssetsNetExcludingGoodwill and StockholdersEquity for at least six periods; call search_filing on the 10-K for "goodwill", "reporting unit", "annual impairment test", "significant assumptions" and "discount rate" and on the latest 10-Q for "triggering event" and "interim impairment". If the user supplied carrying amount and allocated goodwill, use them and label them as management inputs.
2. Reporting unit determination: operating segment or one level below (350-20-35-33 to 35-38), and how goodwill was assigned (350-20-35-41 to 35-45) plus any reorganization reassignment.
3. Step zero (optional, 350-20-35-3C): assess macroeconomic conditions, industry and market factors, cost factors, overall financial performance, entity-specific events (management, key personnel, strategy, customers, litigation), unit-specific events, and a sustained share price decline. Conclude whether it is more likely than not (over 50%) that fair value is below carrying amount, and say explicitly if the qualitative screen is not available because a trigger already exists.
4. Quantitative step (350-20-35-2 as amended by ASU 2017-04): impairment equals carrying amount less fair value, capped at the goodwill allocated to the unit. Build fair value from a DCF (state the forecast, terminal growth and discount rate, and that the rate is a market participant rate) and from guideline public company multiples using get_trading_comps on a peer set, then weight them and say why.
5. Reconcile the sum of reporting unit fair values to market capitalization from get_company_financials, and express the gap as an implied control premium; if the premium exceeds roughly 30% challenge the forecast rather than the premium.
6. Tax: if goodwill is tax-deductible, apply the simultaneous equation in 350-20-55-23C so the deferred tax effect does not create circularity, and say whether component-1 or component-2 goodwill dominates.
7. Order of testing: indefinite-lived intangibles (ASC 350-30-35-18) and long-lived asset groups (ASC 360/360-10 impairment via ASC 360 and ASC 350-30) before goodwill; note if that order changes the answer.
8. Peer context: use edgar_fulltext_search forms ["10-K","10-Q","8-K"] with "goodwill impairment charge" plus the sector and the last 18 months to find peers who took charges, and note the Item 2.06 8-Ks.
Produce: callout with the conclusion and the amount; kpis (carrying amount, fair value, headroom or shortfall, allocated goodwill, impairment charge, implied control premium); steps "Assessment path" (step zero factors then the quantitative step with cites); table "Fair value build" (method, value, weight, key assumptions); sensitivity of headroom to discount rate by terminal growth; table "Peer impairments" (company, period, charge, reason, source); checklist "Documentation for the file"; risks. Every number through calc and label management inputs versus derived figures.`,
  prompt: (i) => `Perform the ASC 350 goodwill impairment assessment for ${str(i, "ticker").toUpperCase()}'s ${str(i, "unit")} reporting unit. Trigger: ${str(i, "trigger", "annual test")}.${num(i, "carrying") ? ` Management carrying amount $${num(i, "carrying")}mm with $${num(i, "goodwill")}mm of allocated goodwill.` : ""}`,
};

const memo718: ToolDef = {
  kind: "ai", id: "acc-asc718-stock-comp-memo", title: "ASC 718 stock compensation memo", tagline: "Grant-date fair value, attribution, modifications and the peer volatility and forfeiture benchmarks.",
  description: "Drafts the stock compensation memo: classification as equity or liability, grant-date fair value and the valuation model, the service and performance conditions that drive attribution, forfeiture policy, modification and improbable-to-probable transitions, and the tax effects. Benchmarks expected volatility, expected term, dividend yield and forfeiture rates against the assumptions peers disclose.",
  roles: ["accountant", "corpfin"], specialties: [TECH, VAL, AUD, TAX, ...X_REP], category: "Accounting & audit", icon: "Coins", deliverable: "memo", savesMinutes: 180, tags: ["ASC 718", "stock comp", "RSU", "PSU"],
  fields: [
    { key: "grants", label: "Grant facts", type: "textarea", required: true, placeholder: "500k RSUs vesting 25% annually over 4 years, 200k PSUs on a 3-year relative TSR vs the S&P 500 with a 0-200% payout, 150k options struck at $120 with a 7-year contractual term" },
    { key: "ticker", label: "Company", type: "ticker", placeholder: "SNOW" },
    { key: "peers", label: "Peers for assumption benchmarking", type: "tickers", placeholder: "NOW MDB DDOG" },
    { key: "issues", label: "Issues", type: "multiselect", options: ["Equity vs liability classification", "Valuation model & assumptions", "Attribution (graded vs straight-line)", "Performance conditions & probability", "Market conditions (Monte Carlo)", "Forfeitures policy", "Modification / repricing", "Tax effects & windfalls", "Non-employee awards"], default: ["Valuation model & assumptions", "Attribution (graded vs straight-line)", "Performance conditions & probability"] },
  ],
  example: { grants: "500k RSUs vesting 25% annually over four years, 200k PSUs on three-year relative TSR versus the S&P 500 with a 0-200% payout, and 150k options struck at $120 with a seven-year contractual term granted to new hires.", ticker: "SNOW", peers: ["NOW", "MDB", "DDOG"], issues: ["Valuation model & assumptions", "Attribution (graded vs straight-line)", "Performance conditions & probability", "Market conditions (Monte Carlo)", "Tax effects & windfalls"] },
  effort: "medium",
  instructions: `1. Classify each award as equity or liability (ASC 718-10-25-6 to 25-19: cash settlement, repurchase features, puttable shares, 718-10-25-9 for liability-classified awards) and state the measurement consequence (grant-date fair value fixed for equity; remeasured each period for liability).
2. Measure grant-date fair value (718-10-30-2, 30-6): RSUs at the grant-date share price less the present value of dividends not received; options with a lattice or Black-Scholes-Merton model naming the six inputs (share price, exercise price, expected term, expected volatility, risk-free rate, dividend yield) and their basis (718-10-55-21 to 55-51); market-condition PSUs with a Monte Carlo simulation of relative TSR.
3. Attribution: service-inception to vesting; straight-line or graded for awards with graded vesting (718-10-35-8), with the floor that cumulative expense is at least the vested portion; performance conditions accrue only when probable (718-10-25-20, 718-10-35-3) and are trued up; market conditions are not trued up for outcome (718-10-30-14).
4. Forfeitures: state the accounting policy election to estimate or account as they occur (718-10-35-1D) and support the estimate.
5. Modifications (718-20-35-3): incremental fair value at the modification date; improbable-to-probable and probable-to-improbable Type I/II/III/IV analysis; repricing and exchange programs.
6. Tax (ASC 740-718): deferred tax on book expense for awards expected to produce a deduction, excess or deficient tax benefits in income at settlement (ASU 2016-09), non-deductible 162(m) covered employees, and ISO/NQSO differences.
7. Benchmark: call get_company_financials for SBC, then get_xbrl_series with find "ShareBased|Stock" and concepts ShareBasedCompensation, EmployeeServiceShareBasedCompensationNonvestedAwardsTotalCompensationCostNotYetRecognized and ShareBasedCompensationArrangementByShareBasedPaymentAwardFairValueAssumptionsExpectedVolatilityRate; call search_filing on the company's and each peer's 10-K for "stock-based compensation", "expected volatility", "expected term", "Monte Carlo" and "unrecognized compensation cost" and tabulate the assumptions and the SBC as a percentage of revenue.
Produce: kpis (grant-date fair value by award type, annual expense, unrecognized cost, weighted-average remaining period, SBC as % of revenue); table "Awards" (award, units, model, fair value per unit, total fair value, attribution, vesting, ASC cite); table "Expense attribution by year"; table "Peer assumptions" (company, volatility, expected term, dividend yield, forfeiture rate, source); markdown "Analysis" with cites; bullets "Judgments"; checklist "Disclosure (718-10-50)".`,
  prompt: (i) => `Draft the ASC 718 memo for these awards:\n\n${str(i, "grants")}\n\nIssues: ${list(i, "issues").join("; ")}.${str(i, "ticker") ? ` Company: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark assumptions against ${list(i, "peers").join(", ")}.` : ""}`,
};

const memo740: ToolDef = {
  kind: "ai", id: "acc-asc740-provision-memo", title: "ASC 740 provision & valuation allowance memo", tagline: "Current and deferred, the rate reconciliation in ASU 2023-09 categories, and the valuation allowance evidence.",
  description: "Drafts the income tax provision memo: the current payable from book income adjusted for permanent and temporary differences, the deferred inventory and rollforward at enacted rates, the statutory-to-effective rate reconciliation in the eight ASU 2023-09 categories, the valuation allowance weighing of positive and negative evidence, and the uncertain tax position two-step test with the UTB rollforward.",
  roles: ["accountant", "corpfin"], specialties: [TAX, TECH, AUD, ...X_REP], category: "Tax", icon: "Receipt", deliverable: "memo", savesMinutes: 300, tags: ["ASC 740", "provision", "ETR", "valuation allowance", "UTB"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", placeholder: "SNOW" },
    { key: "facts", label: "Facts and balances", type: "textarea", required: true, placeholder: "Pretax book loss of $(300)m, $60m federal NOLs, $22m of R&D credits, three-year cumulative loss, stock comp shortfalls, projected profitability from 2028, FDII and GILTI in the US, a UK and a German subsidiary" },
    { key: "focus", label: "Focus", type: "multiselect", options: ["Current and deferred computation", "Rate reconciliation (ASU 2023-09)", "Valuation allowance", "Uncertain tax positions", "Interim AETR (ASC 740-270)", "Return-to-provision true-up", "Outside basis / APB 23", "Pillar Two"], default: ["Rate reconciliation (ASU 2023-09)", "Valuation allowance"] },
    { key: "peers", label: "Peers for ETR benchmarking", type: "tickers", placeholder: "NOW MDB DDOG" },
  ],
  example: { ticker: "SNOW", facts: "Pretax book loss of $(300)m for the year, $60m of federal NOLs and $22m of R&D credits, a three-year cumulative loss, large stock compensation shortfalls, projected profitability from fiscal 2028, and UK and German subsidiaries.", focus: ["Rate reconciliation (ASU 2023-09)", "Valuation allowance", "Interim AETR (ASC 740-270)"], peers: ["NOW", "MDB", "DDOG"] },
  effort: "high",
  instructions: `1. Pull the reported numbers: get_company_financials, then get_xbrl_series with find "IncomeTax" and concepts IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest, IncomeTaxExpenseBenefit, CurrentFederalTaxExpenseBenefit, DeferredIncomeTaxExpenseBenefit, DeferredTaxAssetsGross, DeferredTaxAssetsValuationAllowance, UnrecognizedTaxBenefits and EffectiveIncomeTaxRateContinuingOperations for at least six periods. Call search_filing on the 10-K for "income taxes", "effective tax rate", "valuation allowance", "unrecognized tax benefits", "rate reconciliation" and "undistributed earnings".
2. Total tax = current + deferred (ASC 740-10-30-2). Current: pretax book income adjusted for permanent differences (non-deductible meals, 162(m), fines, tax-exempt income, GILTI/FDII, stock comp shortfalls) and temporary differences, less carryforwards, at the statutory rate, less credits. Deferred: temporary differences and carryforwards at the enacted rate for the year of reversal (740-10-30-8) - never the proposed rate.
3. Rate reconciliation in the eight ASU 2023-09 categories: state and local net of federal, foreign tax effects, enacted tax law changes, effect of cross-border tax laws, tax credits, valuation allowance changes, nontaxable or nondeductible items, and changes in unrecognized tax benefits. Disaggregate any category above 5% of pretax income times the statutory rate, and prepare the taxes-paid-by-jurisdiction table for jurisdictions at or above 5%.
4. Valuation allowance (740-10-30-17 to 30-25): inventory the four sources of future taxable income (future reversals of taxable temporary differences, future taxable income exclusive of reversals, taxable income in carryback years, tax planning strategies); treat a three-year cumulative loss as significant negative evidence that is objectively verifiable and hard to overcome; conclude more likely than not for each jurisdiction and each character of DTA separately (state, foreign, capital loss, credits).
5. Uncertain positions (740-10-25-6, 25-13, 30-7): recognition on technical merits at more likely than not, then measurement at the largest amount with a cumulative probability above 50%; accrue interest and penalties; draft the UTB rollforward lines (prior-year positions, current-year positions, settlements, statute lapses) with the amount that would affect the ETR and the open years.
6. Interim if requested: estimated annual effective rate applied to year-to-date ordinary income with discrete items in the quarter (740-270-30-5 to 30-11) and the exceptions for jurisdictions with losses for which no benefit can be recognized (740-270-30-36).
7. Benchmark: compute each peer's ETR and its largest reconciling item from the same XBRL concepts and search_filing on each peer's 10-K for "effective tax rate" to explain the spread.
Produce: kpis (pretax income, current tax, deferred tax, total provision, ETR, statutory rate, valuation allowance); waterfall "Statutory to effective rate" in the eight categories (percentage-point steps); table "Deferred tax inventory" (component, gross DTA/DTL, valuation allowance, net, cite); table "Rate reconciliation" ($ and % columns with the 5% disaggregation flag); table "Peer ETRs" (company, ETR, largest reconciling item, source); markdown "Valuation allowance analysis" with the positive and negative evidence weighed; table "UTB rollforward"; checklist "Disclosure (740-10-50 as amended)"; risks. Every figure through calc.`,
  prompt: (i) => `Draft the ASC 740 provision memo${str(i, "ticker") ? ` for ${str(i, "ticker").toUpperCase()}` : ""}. Facts:\n\n${str(i, "facts")}\n\nFocus on: ${list(i, "focus").join("; ")}.${list(i, "peers").length ? ` Benchmark the ETR against ${list(i, "peers").join(", ")}.` : ""}`,
};

const memo326: ToolDef = {
  kind: "ai", id: "acc-asc326-cecl-memo", title: "ASC 326 CECL allowance memo", tagline: "Lifetime expected credit losses by pool, the loss-rate build, and peer allowance ratios.",
  description: "Builds the current expected credit loss estimate for trade receivables, contract assets or loans: pooling by risk characteristics, a historical loss-rate or aging method adjusted for current conditions and reasonable and supportable forecasts, reversion, and the policy memo with ASC 326-20 cites. Benchmarks the allowance as a percentage of receivables against peers from XBRL.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "Shield", deliverable: "memo", savesMinutes: 180, tags: ["ASC 326", "CECL", "allowance", "receivables"],
  fields: [
    { key: "aging", label: "Aging / loss history", type: "csv", required: true, columns: "pool, bucket, balance, historical_loss_rate_pct, writeoffs_prior_year, recoveries_prior_year", placeholder: "Enterprise,Current,42000,0.2,60,10\nEnterprise,31-60,5200,1.1,45,5\nSMB,Current,9800,1.5,220,30" },
    { key: "ticker", label: "Company", type: "ticker", placeholder: "DE" },
    { key: "peers", label: "Peers for allowance ratios", type: "tickers", placeholder: "CAT CNH AGCO" },
    { key: "forecast", label: "Current conditions and forecast", type: "textarea", placeholder: "Two large customers in Chapter 11 workouts, unemployment forecast up 60bps, tightening dealer credit, reversion to historical after 12 months" },
  ],
  example: { aging: "pool,bucket,balance,historical_loss_rate_pct,writeoffs_prior_year,recoveries_prior_year\nDealer,Current,842000,0.15,900,180\nDealer,31-60,64000,0.9,540,60\nDealer,61-90,21000,3.5,410,25\nRetail,Current,310000,0.6,1900,300\nRetail,31-60,28000,2.8,820,90\nRetail,90+,9500,18,1400,110", ticker: "DE", peers: ["CAT", "AGCO"], forecast: "Farm income forecast down 12% year over year, used equipment prices falling, two large dealers on credit hold, reversion to the historical average after four quarters." },
  effort: "medium",
  instructions: `1. Parse the aging CSV into pools and buckets; sum balances and compute the weighted historical loss rate. If a required column is missing, say exactly which one and continue with what is present.
2. Pool by shared risk characteristics (ASC 326-20-30-2): customer type, geography, size, industry, collateral, term. Pools must be re-evaluated each period (326-20-35-2).
3. Measure lifetime expected credit losses (326-20-30-1): choose and name the method (aging schedule, loss-rate, roll-rate, probability-of-default/loss-given-default, discounted cash flow) and justify it. Pooled measurement is required where risk characteristics are shared; individual measurement only where they are not (326-20-30-2). Zero loss is only supportable in the narrow circumstances of 326-20-30-10.
4. Adjust the historical rate for current conditions and reasonable and supportable forecasts (326-20-30-7 to 30-9), then revert to historical information beyond the forecast horizon (326-20-30-9) - state the horizon, the reversion method and the driver used (unemployment, GDP, sector-specific index) and whether the adjustment is quantitative or qualitative.
5. Do not include expected recoveries above the amortized cost basis; consider collateral and credit enhancements (326-20-30-4 to 30-6). Write-offs when uncollectible (326-20-35-8).
6. Benchmark: call get_xbrl_series with find "Credit|Allowance|Receivable" then concepts AllowanceForDoubtfulAccountsReceivable, AccountsReceivableNetCurrent and AllowanceForCreditLossesOnFinancingReceivables for the company and each peer; call search_filing on each 10-K for "allowance for credit losses", "expected credit losses", "reasonable and supportable" and "reversion" to compare methods and horizons; express each allowance as a percentage of gross receivables and place the company in the range.
Produce: kpis (gross receivables, historical loss rate, qualitative adjustment, CECL allowance, allowance as % of receivables, peer median %); table "Allowance build by pool and bucket" (pool, bucket, balance, historical rate, adjustment, expected loss rate, allowance) with totals; waterfall "Historical to recorded allowance" (historical, current conditions, forecast, reversion, specific reserves); table "Peer allowance ratios" (company, allowance, receivables, %, method, forecast horizon, source); markdown "Policy and method" with cites; bullets "Qualitative factors and support"; checklist "Disclosure (326-20-50: credit quality indicators, rollforward, past due, nonaccrual, write-offs by vintage)"; risks.`,
  prompt: (i) => `Build the ASC 326 CECL allowance from the pasted aging.${str(i, "ticker") ? ` Company: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark the allowance ratio against ${list(i, "peers").join(", ")}.` : ""}${str(i, "forecast") ? `\n\nCurrent conditions and forecast: ${str(i, "forecast")}` : ""}`,
};

const memo450: ToolDef = {
  kind: "ai", id: "acc-asc450-contingency-memo", title: "ASC 450 loss contingency memo", tagline: "Probable and reasonably estimable, the range, and the disclosure that satisfies the SEC staff.",
  description: "Assesses litigation, regulatory, environmental, indemnification and warranty contingencies under ASC 450-20: likelihood (probable, reasonably possible, remote), estimability and the low end of a range, accrual versus disclosure, and gain contingencies. Drafts the accrual conclusion and the footnote, benchmarked against how peers disclose comparable matters and what the SEC staff has asked about aggregate reasonably possible losses.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, FRN, ...X_REP], category: "Accounting & audit", icon: "Scale", deliverable: "memo", savesMinutes: 150, tags: ["ASC 450", "contingencies", "litigation", "disclosure"],
  fields: [
    { key: "matters", label: "Matters", type: "textarea", required: true, placeholder: "Patent suit filed 3/2026 seeking $180m, counsel assesses unfavorable outcome as reasonably possible with exposure of $20-60m; EPA remediation order at one site, engineer's estimate $12-18m; a state sales tax assessment of $9m under appeal" },
    { key: "ticker", label: "Company", type: "ticker", placeholder: "DE" },
    { key: "peers", label: "Peers for disclosure language", type: "tickers", placeholder: "CAT HON GE" },
    { key: "type", label: "Contingency types", type: "multiselect", options: ["Litigation", "Regulatory / government investigation", "Environmental (ASC 410-30)", "Tax (non-income)", "Warranty / product", "Indemnification", "Guarantees (ASC 460)", "Gain contingency"], default: ["Litigation", "Regulatory / government investigation"] },
  ],
  example: { matters: "A patent suit filed in March 2026 seeking $180m in damages; outside counsel assesses an unfavorable outcome as reasonably possible with exposure of $20-60m and no point in the range more likely. An EPA remediation order at one site with an engineer's estimate of $12-18m over six years. A state sales tax assessment of $9m under administrative appeal with counsel assessing a favorable outcome as probable.", ticker: "DE", peers: ["CAT", "HON"], type: ["Litigation", "Regulatory / government investigation", "Environmental (ASC 410-30)", "Tax (non-income)"] },
  effort: "medium",
  instructions: `1. For each matter, set out facts, procedural status, the claim amount, counsel's assessment and the date of that assessment.
2. Likelihood (ASC 450-20-25-1): probable (likely to occur), reasonably possible (more than remote but less than likely), remote. Accrue when both probable and reasonably estimable (450-20-25-2); when a range is estimable and no amount within it is better than another, accrue the low end and disclose the range (450-20-30-1, 450-20-50-3).
3. Disclosure: for matters that are probable but not estimable, and for reasonably possible matters, disclose the nature and an estimate of the possible loss or range, or state that such an estimate cannot be made (450-20-50-3 to 50-6). Aggregate reasonably possible losses in excess of amounts accrued is the disclosure the SEC staff most often asks to be quantified - say whether an aggregate can be given and why.
4. Environmental matters follow ASC 410-30 (recognition when probable and estimable, measurement including allocation among PRPs, discounting only when timing is fixed or reliably determinable, and recoveries recorded separately as assets only when realization is probable).
5. Guarantees and indemnifications fall under ASC 460-10-25-4 for recognition at inception and 460-10-50 for disclosure; warranties are ASC 460-10-25-5 and ASC 606-10-55-30 to 55-35 for assurance versus service-type.
6. Gain contingencies are not recognized until realized (450-30-25-1) and are disclosed carefully to avoid misleading implications.
7. Benchmark: call search_filing on the company's 10-K and latest 10-Q for "commitments and contingencies", "legal proceedings", "reasonably possible", "range of loss" and "accrued" and on each peer's 10-K for the same phrases; call edgar_fulltext_search with forms ["UPLOAD","CORRESP"] for "reasonably possible" or "range of loss" plus the sector to find the staff's standard question and the responses, and read_document the best example; check get_recent_filings for 8-K Item 8.01 or Item 1.01 items on the same matters.
Produce: callout with the aggregate accrual and the aggregate reasonably possible loss above accrual; table "Matters" (matter, status, claim, likelihood, estimable, accrual, RP range, ASC cite, source); markdown "Analysis" per matter; markdown "Draft footnote" written in filing language; table "Peer disclosure language" (company, quote, source); bullets "Comment letter risk"; checklist "Evidence to obtain from counsel before the report date"; risks.`,
  prompt: (i) => `Assess these contingencies under ASC 450 (${list(i, "type").join("; ") || "litigation"}):\n\n${str(i, "matters")}\n${str(i, "ticker") ? `\nCompany: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark disclosure against ${list(i, "peers").join(", ")}.` : ""}`,
};

const ifrsGaap: ToolDef = {
  kind: "ai", id: "acc-ifrs-gaap-diff", title: "IFRS vs US GAAP difference register", tagline: "The differences that actually hit your accounts, quantified where the filings allow.",
  description: "Builds a difference register between IFRS and US GAAP for the accounts and topics that matter to a specific company or trial balance: development costs, inventory costing and reversals, leases, impairment models, revenue nuances, financial instruments, provisions, pensions, taxes and presentation. Quantifies the likely direction and size using the company's own disclosures and names the conversion adjustments.",
  roles: ["accountant", "corpfin", "student"], specialties: [TECH, AUD, TAX, ...X_REP], category: "Accounting & audit", icon: "ArrowLeftRight", deliverable: "table", savesMinutes: 210, tags: ["IFRS", "US GAAP", "conversion", "dual reporting"],
  fields: [
    { key: "direction", label: "Direction", type: "select", options: ["US GAAP to IFRS", "IFRS to US GAAP"], default: "US GAAP to IFRS" },
    { key: "ticker", label: "Company", type: "ticker", placeholder: "DE" },
    { key: "topics", label: "Topics", type: "multiselect", options: ["Revenue (ASC 606 / IFRS 15)", "Leases (ASC 842 / IFRS 16)", "Impairment of long-lived assets (ASC 360 / IAS 36)", "Goodwill (ASC 350 / IAS 36)", "Inventory (ASC 330 / IAS 2)", "Development costs (ASC 730 / IAS 38)", "Financial instruments & credit losses (ASC 326 / IFRS 9)", "Provisions (ASC 450 / IAS 37)", "Income taxes (ASC 740 / IAS 12)", "Share-based payment (ASC 718 / IFRS 2)", "Pensions (ASC 715 / IAS 19)", "Presentation & non-GAAP"], default: ["Leases (ASC 842 / IFRS 16)", "Development costs (ASC 730 / IAS 38)", "Impairment of long-lived assets (ASC 360 / IAS 36)", "Income taxes (ASC 740 / IAS 12)"] },
    { key: "accounts", label: "Account list or trial balance (optional)", type: "csv", columns: "account, balance, note", placeholder: "Capitalized software,42000,internal-use\nOperating lease ROU,18400,\nInventory reserves,(3100),LIFO" },
  ],
  example: { direction: "US GAAP to IFRS", ticker: "DE", topics: ["Leases (ASC 842 / IFRS 16)", "Inventory (ASC 330 / IAS 2)", "Development costs (ASC 730 / IAS 38)", "Impairment of long-lived assets (ASC 360 / IAS 36)", "Income taxes (ASC 740 / IAS 12)"] },
  effort: "medium",
  instructions: `1. Anchor on the company: get_company_financials, then search_filing on the 10-K for "significant accounting policies", "inventories", "LIFO", "capitalized software", "research and development", "leases", "impairment" and "income taxes" to learn which elections and balances actually exist. Where an account list or trial balance is pasted, map each account to the topics it touches.
2. For each selected topic, state the US GAAP rule with its ASC cite, the IFRS rule with its IAS/IFRS cite, the direction of the difference (earlier or later recognition, higher or lower carrying amount), and the practical conversion adjustment. Cover at minimum: development costs expensed under ASC 730-10-25-1 versus capitalized when the IAS 38.57 criteria are met; internal-use software (ASC 350-40) versus IAS 38; LIFO permitted under ASC 330 but prohibited by IAS 2.25, and inventory write-down reversals prohibited by ASC 330-10-35-14 but required by IAS 2.33; the ASC 842 dual classification model versus the single IFRS 16 lessee model and its EBITDA effect; long-lived asset impairment as an undiscounted recoverability test then fair value (ASC 360-10-35-17) versus the single-step recoverable amount test in IAS 36.18 with reversals permitted; goodwill tested at the reporting unit under ASC 350-20 versus the cash-generating unit under IAS 36 with no reversal permitted for goodwill; CECL lifetime losses (ASC 326-20) versus the IFRS 9 three-stage model; probable at roughly 75% in ASC 450 versus more likely than not in IAS 37.23 and the mid-point of a range under IAS 37.39 versus the low end under 450-20-30-1; uncertain tax positions two-step (ASC 740-10) versus IAS 12/IFRIC 23 expected value, and no intraperiod exceptions; share-based payment graded attribution required by IFRS 2.IG11 versus the ASC 718-10-35-8 policy choice; interest and tax classification choices in IAS 7 versus ASC 230.
3. Quantify what can be quantified from the filings: use get_xbrl_series for the relevant balances (capitalized software, ROU assets, LIFO reserve, valuation allowance, R&D expense) and estimate the adjustment with calc, labelling each as estimated.
Produce: table "Difference register" (topic, US GAAP rule and cite, IFRS rule and cite, direction of difference, estimated effect, affected accounts, effort) sorted by estimated effect; kpis (topics reviewed, differences that change earnings, differences that change only presentation, largest estimated adjustment); bullets "Policy elections to make on conversion"; markdown "Accounts most affected"; checklist "Conversion workplan"; caveats where the filing does not disclose enough to quantify.`,
  prompt: (i) => `Build the ${str(i, "direction", "US GAAP to IFRS")} difference register${str(i, "ticker") ? ` for ${str(i, "ticker").toUpperCase()}` : ""} covering ${list(i, "topics").join("; ")}.`,
};

/* ======================================================================================
 * AI workflows: public-data research (disclosure benchmarking, comment letters, CAMs, XBRL)
 * ====================================================================================== */

const discBenchmark: ToolDef = {
  kind: "ai", id: "acc-peer-disclosure-benchmark", title: "Peer disclosure benchmarker", tagline: "One footnote across several tickers, side by side, with the assumptions pulled out.",
  description: "Pulls the same footnote or policy from a peer set's latest 10-Ks, extracts the quantified assumptions (rates, lives, horizons, thresholds), and shows where the language and the judgments differ from the subject company. The standard first step before drafting a disclosure or answering an auditor, built on filing text and XBRL rather than reading ten documents.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [TECH, AUD, TAX, CTRL, ...X_REP], category: "Reporting", icon: "Table", deliverable: "table", savesMinutes: 240, tags: ["disclosure", "footnote", "benchmark", "10-K"],
  fields: [
    { key: "ticker", label: "Subject", type: "ticker", required: true, placeholder: "NOW" },
    { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "SNOW CRM DDOG MDB" },
    { key: "topic", label: "Footnote / policy", type: "select", required: true, options: ["Revenue recognition (ASC 606)", "Remaining performance obligations", "Leases (ASC 842)", "Goodwill & intangibles (ASC 350)", "Stock compensation (ASC 718)", "Income taxes & rate reconciliation (ASC 740)", "Credit losses (ASC 326)", "Business combinations (ASC 805)", "Segment reporting (ASC 280)", "Commitments & contingencies (ASC 450)", "Critical accounting estimates", "Non-GAAP measures & KPIs", "Capitalized software (ASC 350-40)", "Disaggregation of expenses (ASU 2024-03)"], default: "Revenue recognition (ASC 606)" },
    { key: "focus", label: "Specific question (optional)", type: "text", placeholder: "e.g. how they determine standalone selling price for usage-based fees" },
  ],
  example: { ticker: "NOW", peers: ["SNOW", "CRM", "DDOG", "MDB"], topic: "Revenue recognition (ASC 606)", focus: "how they describe standalone selling price and usage-based fees" },
  effort: "high",
  instructions: `1. For the subject and each peer, call search_filing on the latest 10-K with the phrases that locate the note: for revenue use "revenue recognition", "performance obligations", "standalone selling price", "remaining performance obligations"; for leases "weighted-average discount rate", "incremental borrowing rate", "operating lease cost"; for goodwill "reporting unit", "annual impairment test", "discount rate", "terminal growth"; for stock comp "expected volatility", "expected term", "unrecognized compensation"; for taxes "effective tax rate", "valuation allowance", "unrecognized tax benefits"; for credit losses "expected credit losses", "reasonable and supportable"; for segments "reportable segments", "chief operating decision maker", "significant segment expenses"; for critical estimates "critical accounting estimates". Expand the best hits with read_filing (at least two reads per company) so the quotes are real.
2. Pull the quantified facts from XBRL rather than from prose where possible: get_xbrl_series with find on a topic regex ("Lease", "Goodwill", "ShareBased", "IncomeTax", "RevenueRemainingPerformanceObligation", "Allowance") then the concepts it returns, for the subject and every peer, so the comparison table has audited numbers.
3. Build the comparison on structure, not vibes: for each company capture the policy election, the method, each quantified assumption, the level of disaggregation, and anything disclosed that the subject omits.
4. Identify the outliers: name the company whose assumption is most aggressive and most conservative on each axis and say what would have to be true for the subject's figure to be supportable.
5. Check enforcement risk: call edgar_fulltext_search with forms ["UPLOAD","CORRESP"] for the topic phrase plus the sector, and note any staff question already asked of a peer on this exact disclosure.
Produce: kpis (companies compared, assumptions extracted, subject percentile on the headline assumption); table "Assumption comparison" with one row per company (emphasisRow for the subject) and one column per assumption, plus a median row in totals; table "Disclosure language" (company, quote, source); bar chart of the headline quantified assumption with the subject emphasized; bullets "Where the subject differs"; bullets "What peers disclose that the subject does not"; nextSteps; caveats on fiscal-year and business-model comparability.`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()}'s ${str(i, "topic")} footnote against ${list(i, "peers").join(", ")}.${str(i, "focus") ? ` Focus on ${str(i, "focus")}.` : ""}`,
};

const commentLetters: ToolDef = {
  kind: "ai", id: "acc-comment-letter-search", title: "SEC comment letter search", tagline: "What the staff asked, how the company answered, and what it would ask you.",
  description: "Searches SEC staff comment letters (form UPLOAD) and company responses (form CORRESP) by company, topic and sector, reads the letters, and reconstructs each exchange: the question asked, the standard cited, the response, and whether the disclosure changed. Ends with the questions the staff would most likely ask about your own draft.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, TAX, CTRL, ...X_REP], category: "Reporting", icon: "Mail", deliverable: "research", savesMinutes: 180, tags: ["comment letter", "UPLOAD", "CORRESP", "SEC"],
  fields: [
    { key: "topic", label: "Topic or phrase", type: "text", required: true, placeholder: "standalone selling price", help: "Use the words the staff would use, e.g. 'non-GAAP measure', 'segment reporting', 'reasonably possible'" },
    { key: "ticker", label: "Company (optional)", type: "ticker", placeholder: "NOW" },
    { key: "sector", label: "Sector keywords", type: "text", placeholder: "software subscription" },
    { key: "from", label: "From", type: "date", default: "2024-01-01" },
    { key: "count", label: "Exchanges to reconstruct", type: "number", default: 8, min: 3, max: 15 },
  ],
  example: { topic: "standalone selling price", ticker: "NOW", sector: "software subscription", from: "2024-01-01", count: 8 },
  effort: "high",
  instructions: `1. Run edgar_fulltext_search with forms ["UPLOAD"] and the quoted topic phrase, from the start date, and again with the sector keywords added; if a ticker is given, run a third search with entity set to that company and no topic filter to see everything the staff has asked it. Comment letters are released about 20 business days after the review closes, so say the lag when a recent period looks empty.
2. De-duplicate by company and review, then for each candidate call read_document on the UPLOAD URL with the topic phrase as the query, and again with "we note", "please tell us", "please revise" and "supplementally" to capture the staff's actual wording.
3. Find the response: run edgar_fulltext_search with forms ["CORRESP"] and the same entity and date window, then read_document with queries "in response to comment", "we respectfully" and the topic phrase. Record whether the company agreed to revise, revised prospectively, or explained why no change was needed.
4. Check the outcome: use get_recent_filings for the company's next 10-K or 10-Q and search_filing on it for the topic phrase to see whether the disclosure actually changed.
5. Cluster the exchanges into themes, and for each theme state the standard or rule the staff cited (ASC paragraph, Item 10(e) of Regulation S-K for non-GAAP, Rule 3-05 for acquired businesses, Item 303 for MD&A) and the disclosure the staff wanted.
Produce: kpis (letters found, companies, distinct themes, median days from letter to response); timeline of the letters and responses by date; table "Exchanges" (date, company, form, staff question in one sentence, standard cited, company response, disclosure changed?, source); markdown "Themes" grouped with the staff's phrasing quoted; qa "Questions the staff would ask you" (at least six, in the staff's voice, each tied to a theme); bullets "How peers answered successfully"; nextSteps. If a search returns nothing, say so and widen the phrase rather than inventing letters.`,
  prompt: (i) => `Find and reconstruct ${num(i, "count", 8)} SEC comment letter exchanges since ${str(i, "from", "2024-01-01")} about "${str(i, "topic")}"${str(i, "sector") ? ` in ${str(i, "sector")}` : ""}${str(i, "ticker") ? `, including everything the staff has asked ${str(i, "ticker").toUpperCase()}` : ""}.`,
};

const commentTrends: ToolDef = {
  kind: "ai", id: "acc-comment-letter-trends", title: "Comment letter trend analysis", tagline: "Which topics the staff is pressing this year, ranked, with the language that triggers a letter.",
  description: "Measures the frequency of comment letter themes across a sector and a date range, compares the current period to the prior one, and turns the trend into a risk-ranked list for your next filing. Uses full-text search counts over UPLOAD letters, reads a sample of each theme, and reports the trigger language that attracted the staff's attention.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, TAX, ...X_REP], category: "Reporting", icon: "Radar", deliverable: "analysis", savesMinutes: 200, tags: ["comment letter", "trends", "SEC", "risk"],
  fields: [
    { key: "sector", label: "Sector / industry keywords", type: "text", required: true, placeholder: "software subscription cloud" },
    { key: "themes", label: "Themes to measure", type: "multiselect", options: ["Non-GAAP measures", "Revenue recognition (ASC 606)", "Segment reporting", "MD&A results discussion", "Goodwill & impairment", "Income taxes", "Business combinations & Rule 3-05", "Internal control & material weakness", "Leases", "Credit losses", "Contingencies", "Climate & human capital", "Cybersecurity (Item 1.05)", "Key performance indicators"], default: ["Non-GAAP measures", "Revenue recognition (ASC 606)", "Segment reporting", "MD&A results discussion", "Internal control & material weakness"] },
    { key: "current", label: "Current window from", type: "date", default: "2025-07-01" },
    { key: "prior", label: "Prior window from", type: "date", default: "2024-07-01" },
    { key: "ticker", label: "Your company (for the risk ranking)", type: "ticker", placeholder: "SNOW" },
  ],
  example: { sector: "software subscription cloud", themes: ["Non-GAAP measures", "Revenue recognition (ASC 606)", "Segment reporting", "MD&A results discussion", "Internal control & material weakness"], current: "2025-07-01", prior: "2024-07-01", ticker: "SNOW" },
  effort: "high",
  instructions: `1. For each theme, run edgar_fulltext_search with forms ["UPLOAD"] twice - once for the current window and once for the prior window - using the staff's own phrases, not the theme label: "non-GAAP", "individually tailored recognition and measurement", "performance obligation", "reportable segments", "chief operating decision maker", "significant segment expenses", "results of operations" with "quantify", "material weakness", "remediation", "reasonably possible", "key performance indicator". Record the total hit count from each search and the sector-filtered count.
2. Rank the themes by current-window frequency and by change versus the prior window; use calc for the counts and the percentage change. Note that letters are published after the review closes, so the most recent 20 business days are systematically thin - say so rather than reading the dip as a decline.
3. Read two letters per top theme with read_document (query "please" and the theme phrase) and quote the sentence the staff actually wrote, plus the disclosure it targeted.
4. Assess the subject company: search_filing on its latest 10-K for the language each top theme targets (for example a non-GAAP measure that adjusts for a normal, recurring cash operating expense, a segment note with no significant expense disaggregation, MD&A that describes a change without quantifying the drivers) and mark each theme as exposed, partly exposed or not exposed with the quote that supports it.
Produce: kpis (themes measured, letters in the current window, the fastest-rising theme, the subject's exposed themes); table "Theme frequency" (theme, prior count, current count, change %, staff phrase, example company, source) sorted by current count; bar chart of current-window counts; table "Subject exposure" (theme, exposure, quote from the filing, what to change); markdown "What the staff is actually pressing" with quotes; risks with severity by theme; nextSteps for the next filing. Never state a count you did not get from a search result.`,
  prompt: (i) => `Measure SEC comment letter themes in ${str(i, "sector")} for the window from ${str(i, "current", "2025-07-01")} against the window from ${str(i, "prior", "2024-07-01")}: ${list(i, "themes").join("; ")}.${str(i, "ticker") ? ` Then rank the risk for ${str(i, "ticker").toUpperCase()}'s next filing.` : ""}`,
};

const camCompare: ToolDef = {
  kind: "ai", id: "acc-cam-compare", title: "Critical audit matter extraction & comparison", tagline: "Every CAM in a peer set, the procedures performed, and what the auditor is worried about.",
  description: "Extracts critical audit matters from the auditor's reports in a peer set's 10-Ks: the matter, why it was a CAM, the procedures the auditor performed, and the accounts and assertions involved. Compares them across companies and against the company's own critical accounting estimates to show where audit attention and management judgment diverge.",
  roles: ["accountant", "corpfin", "markets"], specialties: [AUD, TECH, ...X_REP], category: "Accounting & audit", icon: "FileSearch", deliverable: "analysis", savesMinutes: 180, tags: ["CAM", "AS 3101", "auditor's report", "benchmark"],
  fields: [
    { key: "ticker", label: "Subject", type: "ticker", required: true, placeholder: "WBD" },
    { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "DIS NFLX PARA CMCSA" },
    { key: "years", label: "Years of reports", type: "number", default: 2, min: 1, max: 4 },
  ],
  example: { ticker: "WBD", peers: ["DIS", "NFLX", "PARA"], years: 2 },
  effort: "high",
  instructions: `1. For the subject and each peer, call search_filing on the 10-K for "critical audit matter", "Report of Independent Registered Public Accounting Firm", "we identified the following critical audit matter" and "our audit procedures included" and expand each hit with read_filing until you have the full CAM text, the audit firm name, the auditor tenure ("auditor since") and the opinion on internal control. For prior years, use get_recent_filings with forms ["10-K"] and read_document on the older filing URL with the same queries.
2. For each CAM record: the account or disclosure, the reason it was a CAM (subjectivity, estimation uncertainty, significant judgment), the specific procedures described (testing controls, sensitivity analysis, involving valuation specialists, testing completeness of data, evaluating management's forecast against external data), and whether a specialist was used.
3. Classify each CAM into a standard taxonomy (revenue, goodwill and intangibles, income taxes, business combinations, contingencies, allowance for credit losses, inventory, capitalization, share-based payment, going concern) and tabulate the taxonomy by company.
4. Compare with management's own disclosure: search_filing on each company's 10-K for "critical accounting estimates" and note where a company lists an estimate that its auditor did not identify as a CAM and vice versa, which is the most useful signal in this analysis.
5. Note the structural facts: number of CAMs per report (zero is common and meaningful), audit firm, tenure, and whether the ICFR opinion was adverse.
Produce: kpis (CAMs in the subject's report, peer median CAMs, most common CAM category, audit firms represented); table "CAM inventory" (company, year, audit firm, CAM, category, why, procedures in one sentence, source); bar chart of CAM counts by category across the peer set; table "CAM versus critical accounting estimate" (company, matter, CAM?, critical estimate?, comment); markdown "What the auditors are worried about" with quotes; bullets "Procedures to expect in your own audit"; caveats where a report could not be located.`,
  prompt: (i) => `Extract and compare the critical audit matters for ${str(i, "ticker").toUpperCase()} and ${list(i, "peers").join(", ")} over the last ${num(i, "years", 2)} year(s), and compare them with each company's critical accounting estimates.`,
};

const xbrlConsistency: ToolDef = {
  kind: "ai", id: "acc-xbrl-consistency", title: "XBRL fact consistency checker", tagline: "Tie the tagged facts to each other and to the peer set before the filing goes out.",
  description: "Checks a company's XBRL facts for internal consistency and tagging quality: statement subtotals that should add, period-over-period continuity of balances, flipped signs, unit and scale errors, custom extensions where a standard element exists, and outliers against the peer distribution. Produces the exception list a reviewer can clear before filing.",
  roles: ["accountant", "corpfin"], specialties: [TECH, AUD, CTRL, ...X_REP], category: "Reporting", icon: "Database", deliverable: "table", savesMinutes: 150, tags: ["XBRL", "tie-out", "tagging", "review"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "SNOW" },
    { key: "peers", label: "Peers for tagging comparison", type: "tickers", placeholder: "NOW MDB DDOG" },
    { key: "areas", label: "Areas", type: "multiselect", options: ["Income statement subtotals", "Balance sheet articulation", "Cash flow reconciliation", "Share counts & EPS", "Segment facts", "Tax facts", "Lease facts", "Goodwill & intangibles", "Custom extensions", "Units, scale & signs"], default: ["Income statement subtotals", "Balance sheet articulation", "Cash flow reconciliation", "Share counts & EPS", "Custom extensions"] },
  ],
  example: { ticker: "SNOW", peers: ["NOW", "MDB", "DDOG"], areas: ["Income statement subtotals", "Balance sheet articulation", "Cash flow reconciliation", "Share counts & EPS", "Custom extensions", "Units, scale & signs"] },
  effort: "medium",
  instructions: `1. Inventory the tags: call get_xbrl_series with find ".*" narrowed by area regexes ("Revenue|Cost|Gross|Operating|Net", "Assets|Liabilities|Equity|Cash", "NetCashProvided|Depreciation|ShareBased", "Shares|EarningsPerShare", "Segment", "IncomeTax", "Lease", "Goodwill|Intangible") to see which elements the company actually uses, and note every element name that is not a standard us-gaap element.
2. Pull the values with get_xbrl_series for at least six periods, then run the identities with calc and report the difference for each: Revenues less CostOfRevenue equals GrossProfit; GrossProfit less operating expenses equals OperatingIncomeLoss; Assets equals Liabilities plus StockholdersEquity (plus minority interest); AssetsCurrent and LiabilitiesCurrent do not exceed their totals; CashAndCashEquivalentsAtCarryingValue at the start plus the three cash flow sections equals the ending balance; NetIncomeLoss on the cash flow statement equals the income statement; NetIncomeLoss divided by WeightedAverageNumberOfDilutedSharesOutstanding equals EarningsPerShareDiluted within rounding.
3. Test continuity: prior-period closing balances must equal the current filing's comparatives, and each flow must tie to the change in its stock (goodwill rollforward, debt, deferred revenue, allowance). Flag any restated comparative and check for an 8-K Item 4.02 with get_recent_filings.
4. Test plausibility: sign conventions (expenses, capex, treasury stock and dividends are positive values on negated labels), units (USD versus shares versus pure), and scale (a value 1,000 times the neighbouring period).
5. Compare tagging with peers: for the same statement lines, list where the subject uses a custom extension and a peer uses a standard element, and where the subject omits a standard element the peers all report.
Produce: kpis (identities tested, exceptions found, custom extensions, largest unexplained difference); table "Exceptions" (check, expected, tagged, difference, severity, likely cause, source) sorted by severity; table "Extension review" (extension element, what it tags, standard element peers use, recommendation); table "Continuity" (concept, prior filing, current comparative, difference); bullets "Clear before filing"; callout if an identity fails by more than a rounding amount. State clearly when a concept simply is not tagged rather than treating a missing fact as an error.`,
  prompt: (i) => `Run the XBRL consistency and tagging review for ${str(i, "ticker").toUpperCase()} across ${list(i, "areas").join("; ")}.${list(i, "peers").length ? ` Compare tagging with ${list(i, "peers").join(", ")}.` : ""}`,
};

const rateRecBenchmark: ToolDef = {
  kind: "ai", id: "acc-rate-rec-benchmark", title: "Effective tax rate benchmarker", tagline: "Statutory to effective across a peer set in the eight ASU 2023-09 categories.",
  description: "Builds the statutory-to-effective rate bridge for a company and its peers from XBRL tax facts and the 10-K rate reconciliation table, normalized into the eight categories ASU 2023-09 requires, and explains the spread: foreign mix, credits, stock compensation, valuation allowance movements and discrete items. Shows which peers disclose above the 5% disaggregation threshold.",
  roles: ["accountant", "corpfin"], specialties: [TAX, TECH, ...X_REP], category: "Tax", icon: "Percent", deliverable: "table", savesMinutes: 180, tags: ["ASC 740", "ETR", "ASU 2023-09", "benchmark"],
  fields: [
    { key: "ticker", label: "Subject", type: "ticker", required: true, placeholder: "NOW" },
    { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "CRM SNOW MSFT ADBE" },
    { key: "periods", label: "Fiscal years", type: "number", default: 3, min: 1, max: 5 },
  ],
  example: { ticker: "NOW", peers: ["CRM", "SNOW", "ADBE"], periods: 3 },
  effort: "high",
  instructions: `1. For the subject and each peer, call get_xbrl_series with find "IncomeTax|EffectiveIncomeTax" then the concepts it returns, at minimum IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest, IncomeTaxExpenseBenefit, EffectiveIncomeTaxRateContinuingOperations, CurrentFederalTaxExpenseBenefit, CurrentForeignTaxExpenseBenefit, DeferredIncomeTaxExpenseBenefit, DeferredTaxAssetsValuationAllowance and UnrecognizedTaxBenefits, for the requested number of years.
2. Compute each company's ETR as total provision over pretax income with calc, and flag any year where pretax income is near zero so the ratio is not meaningful (mark NM rather than printing a large percentage).
3. Get the reconciliation detail from the text: call search_filing on each 10-K for "effective tax rate", "statutory federal income tax rate", "state taxes", "foreign", "research and development credits", "stock-based compensation", "valuation allowance" and "unrecognized tax benefits", expanding with read_filing so the percentage-point items come from the filed table and not from an estimate.
4. Normalize every disclosed line into the eight ASU 2023-09 categories: state and local net of federal, foreign tax effects, enacted tax law changes, effect of cross-border tax laws (GILTI, FDII, BEAT, Pillar Two), tax credits, valuation allowance changes, nontaxable or nondeductible items, and changes in unrecognized tax benefits; put anything else in an "other" row and keep it small. Mark items above 5% of pretax income times the statutory rate, which is the threshold at which separate disclosure is required.
5. Explain the spread: rank the peers by ETR, and for the widest gaps versus the subject name the category that accounts for it with the quoted disclosure.
Produce: kpis (subject ETR, peer median ETR, gap in percentage points, largest reconciling category, statutory rate); table "Rate reconciliation, percentage points" with one row per company and one column per category, subject first (emphasisRow 0) and a median row in totals; waterfall "Subject: statutory to effective"; line chart of ETR by fiscal year for every company; bullets "Why the subject differs"; table "Disclosure quality" (company, categories disclosed, taxes paid by jurisdiction disclosed?, source); caveats on fiscal-year alignment and on discrete items that make a single year unrepresentative.`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()}'s effective tax rate and rate reconciliation against ${list(i, "peers").join(", ")} for the last ${num(i, "periods", 3)} fiscal year(s), normalized into the eight ASU 2023-09 categories.`,
};

const riskProfile: ToolDef = {
  kind: "ai", id: "acc-risk-profile", title: "Public company accounting risk profile", tagline: "Material weaknesses, restatements, auditor changes, CAMs and going concern on one screen.",
  description: "Assembles the accounting risk record of a registrant from its filing history: Item 4.02 non-reliance and restatements, Item 4.01 auditor changes and dismissals, Item 9A internal control conclusions and material weaknesses, critical audit matters, late filings on Form 12b-25, and impairment and exit-cost 8-Ks. Used to scope an audit, price a deal or screen an investment.",
  roles: ["accountant", "markets", "consultant"], specialties: [AUD, TECH, FRN, FDD, ...X_FDD], category: "Diligence", icon: "AlertTriangle", deliverable: "analysis", savesMinutes: 150, tags: ["material weakness", "restatement", "4.02", "risk"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
    { key: "peers", label: "Peers (optional)", type: "tickers", placeholder: "PARA DIS CMCSA" },
    { key: "years", label: "Years of history", type: "number", default: 5, min: 2, max: 10 },
  ],
  example: { ticker: "WBD", peers: ["PARA", "DIS"], years: 5 },
  effort: "medium",
  instructions: `1. Call get_recent_filings with forms ["8-K","10-K","10-Q","NT 10-K","NT 10-Q","10-K/A","10-Q/A"] and a high limit, and read the item codes: 4.01 (auditor change), 4.02 (non-reliance), 2.06 (impairment), 2.05 (exit costs), 2.04 (triggering event), 5.02 (officer changes, especially CFO and chief accounting officer), 1.03 (bankruptcy). Note every amendment, which is the strongest restatement signal.
2. For each 4.01 and 4.02, read_document the 8-K and quote the reason given, the periods affected, and whether the auditor had disagreements or reportable events (Item 304(a)(1)(iv)-(v) of Regulation S-K).
3. Call search_filing on the latest 10-K for "material weakness", "not effective", "management's report on internal control", "remediation", "critical audit matter", "substantial doubt" and "restatement", and on the latest 10-Q for "material weakness" and "changes in internal control". Expand with read_filing so every conclusion is quoted.
4. Count CFO and chief accounting officer turnover from the 5.02 items and the proxy, since turnover plus a material weakness is the classic pattern.
5. Check filing timeliness against the deadlines (10-K 60/75/90 days and 10-Q 40/40/45 days by filer status; get dei:EntityFilerCategory and dei:EntityPublicFloat with get_xbrl_series) and note any Form 12b-25.
6. If peers are given, repeat steps 1 and 3 for each and compare counts.
Produce: kpis (material weaknesses open, restatements, auditor changes, CFO changes, CAMs, late filings); timeline of every event with tone; table "Events" (date, form, item, event, quote, source); table "Control conclusions by year" (year, ICFR effective?, weakness, auditor, opinion on ICFR); risks with severity and what to do about each in an audit or diligence scope; bar chart of event counts versus peers if peers are given; callout if there is an unremediated material weakness.`,
  prompt: (i) => `Build the accounting risk profile for ${str(i, "ticker").toUpperCase()} over the last ${num(i, "years", 5)} years.${list(i, "peers").length ? ` Compare with ${list(i, "peers").join(", ")}.` : ""}`,
};

const planningAnalytics: ToolDef = {
  kind: "ai", id: "acc-planning-analytics", title: "Audit planning analytics pack", tagline: "Five years of ratios and relationships, with the accounts that do not behave flagged.",
  description: "Builds the planning analytics an audit senior prepares under AS 2110 and AS 2305: multi-year trends and ratios from XBRL, the same ratios for a peer set, and a flag on every account whose movement breaks the plausible relationship it should have with revenue, headcount or volume. Ends with the significant accounts, relevant assertions and the identified risks of material misstatement.",
  roles: ["accountant"], specialties: [AUD, TECH, CTRL], category: "Accounting & audit", icon: "Gauge", deliverable: "analysis", savesMinutes: 180, tags: ["AS 2110", "planning", "analytics", "ratios"],
  fields: [
    { key: "ticker", label: "Client", type: "ticker", required: true, placeholder: "CMG" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "MCD YUM SBUX WEN" },
    { key: "years", label: "Years", type: "number", default: 5, min: 3, max: 8 },
    { key: "threshold", label: "Fluctuation threshold", type: "number", unit: "%", default: 10, help: "Flag movements above this and above the dollar threshold" },
    { key: "dollar", label: "Dollar threshold", type: "number", unit: "$mm", default: 25 },
  ],
  example: { ticker: "CMG", peers: ["MCD", "YUM", "SBUX"], years: 5, threshold: 10, dollar: 25 },
  effort: "medium",
  instructions: `1. Call get_company_financials, then get_xbrl_series for the requested years on the statement lines: Revenues, CostOfRevenue or CostOfGoodsAndServicesSold, GrossProfit, SellingGeneralAndAdministrativeExpense, ResearchAndDevelopmentExpense, OperatingIncomeLoss, InterestExpense, IncomeTaxExpenseBenefit, NetIncomeLoss, AccountsReceivableNetCurrent, InventoryNet, PrepaidExpenseAndOtherAssetsCurrent, AccountsPayableCurrent, AccruedLiabilitiesCurrent, ContractWithCustomerLiabilityCurrent, PropertyPlantAndEquipmentNet, Goodwill, LongTermDebtNoncurrent, StockholdersEquity, NetCashProvidedByUsedInOperatingActivities, PaymentsToAcquirePropertyPlantAndEquipment.
2. Compute with calc, per year: growth in every line, gross and operating margin, SG&A and R&D as a percentage of revenue, DSO, DIO, DPO and the cash conversion cycle, inventory and receivable turns, current ratio, net leverage, interest coverage, effective tax rate, capex as a percentage of revenue and of depreciation, accrual ratio (net income less operating cash flow over average assets), and the operating cash flow to net income ratio.
3. Apply dual thresholds: flag any account moving more than the percentage threshold AND more than the dollar threshold, which is the standard practice that keeps the flag list short.
4. Test plausible relationships rather than single lines: receivables against revenue, inventory against cost of revenue, payables against purchases, accrued compensation against headcount or revenue per employee, depreciation against gross PP&E, interest against average debt, deferred revenue against billings and revenue, and each against the same ratio for peers via get_trading_comps. A relationship that breaks is the finding; a line that grows with revenue is not.
5. Read the explanations before writing the risk: search_filing on the 10-K and latest 10-Q for "results of operations", "compared to", "primarily due to" and the account names you flagged, and quote management's explanation next to the flag.
6. Conclude in audit language: significant accounts and disclosures, the relevant assertions for each (existence, completeness, valuation, cutoff, presentation), the identified risks of material misstatement including the presumed fraud risk in revenue (AS 2110-68), and the planned response (controls reliance, substantive analytics, tests of detail).
Produce: kpis (accounts flagged, largest unexplained movement, accrual ratio, cash conversion cycle, peer-median gap); table "Ratio trend" (ratio, each year, peer median, direction) with the years as columns; table "Flagged accounts" (account, prior, current, change $, change %, management explanation, assertion at risk, planned response, source); line chart of the three most diagnostic ratios; risks; checklist "Planning documentation"; caveats on XBRL comparability and restated comparatives.`,
  prompt: (i) => `Build the audit planning analytics for ${str(i, "ticker").toUpperCase()} over ${num(i, "years", 5)} years, flagging movements above ${num(i, "threshold", 10)}% and $${num(i, "dollar", 25)}mm.${list(i, "peers").length ? ` Peers: ${list(i, "peers").join(", ")}.` : ""}`,
};

const estimateChallenger: ToolDef = {
  kind: "ai", id: "acc-estimate-challenger", title: "Estimate challenger", tagline: "Management's assumption against the range peers disclose, with the percentile.",
  description: "Takes a single management estimate - a discount rate, growth rate, useful life, royalty rate, loss rate, volatility, attrition or salvage assumption - and places it in the distribution of what comparable registrants disclose, using XBRL facts and footnote text. Produces the AS 2501 challenge: the range, the percentile, the contrary evidence and the question to put to management.",
  roles: ["accountant", "consultant"], specialties: [AUD, VAL, TECH, ...X_VAL], category: "Accounting & audit", icon: "Target", deliverable: "analysis", savesMinutes: 120, tags: ["AS 2501", "estimates", "assumptions", "benchmark"],
  fields: [
    { key: "estimate", label: "Estimate", type: "select", required: true, options: ["Goodwill DCF discount rate", "Terminal growth rate", "Lease incremental borrowing rate", "Expected volatility (ASC 718)", "Expected option term", "Customer attrition rate", "Royalty rate (relief from royalty)", "Allowance / loss rate", "Warranty accrual rate", "Useful life of intangibles", "Useful life of PP&E", "Pension discount rate", "Return on plan assets"], default: "Lease incremental borrowing rate" },
    { key: "value", label: "Management's assumption", type: "number", required: true, unit: "%", default: 6.5 },
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "CMG" },
    { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "MCD SBUX YUM DPZ" },
    { key: "support", label: "Management's support (optional)", type: "textarea", placeholder: "Treasury 7-year 4.1% plus 250bps credit spread, no collateral adjustment" },
  ],
  example: { estimate: "Lease incremental borrowing rate", value: 6.5, ticker: "CMG", peers: ["MCD", "SBUX", "YUM", "DPZ"], support: "Seven-year Treasury of 4.1% plus a 250bp credit spread from our revolver pricing, with no downward collateral adjustment." },
  effort: "medium",
  instructions: `1. Find the disclosed values: call get_xbrl_series for each peer with find matched to the estimate ("Lease" for OperatingLeaseWeightedAverageDiscountPercent and the remaining-term concepts, "ShareBased" for the volatility and term assumption concepts, "Goodwill|Impairment", "FiniteLivedIntangibleAsset" for useful lives, "Allowance", "Warranty", "DefinedBenefit" for pension rates) and record the tagged value and period for each. Where the assumption is not tagged, call search_filing on that peer's 10-K with the exact phrase ("weighted-average discount rate", "expected volatility", "discount rate used", "royalty rate", "weighted-average useful life", "attrition") and read_filing the hit.
2. Build the distribution with calc: minimum, first quartile, median, third quartile, maximum, and the subject's percentile. Do not average across periods that are not comparable; use the latest fiscal year for each peer and say the period.
3. Test the support: reconstruct management's build (for an IBR: matched-tenor Treasury plus the company's own credit spread less a collateral adjustment; for volatility: historical realized versus implied and the peer group; for a discount rate: WACC build with size and specific premiums) and state whether each step is evidenced.
4. Find the contrary evidence: the peer at the opposite end of the range, the company's own debt pricing from search_filing on the 10-K for "interest rate", "revolving credit facility" and "weighted average interest rate", and any inconsistency with a rate used elsewhere in the same filing (a lease IBR far below the rate on the company's own borrowings, a goodwill discount rate below the implied cost of equity).
5. Quantify the sensitivity: what the reported balance or expense would be at the peer median and at each quartile.
Produce: kpis (management's assumption, peer median, interquartile range, percentile, effect at the median); scatter or bar of each peer's disclosed value with the subject emphasized and a reference line at the median; table "Peer disclosures" (company, value, period, where disclosed, source); table "Support walk" (step, management's input, evidence, auditor's view); sensitivity of the affected balance to the assumption; bullets "Contrary evidence"; qa "Questions for management"; callout if the assumption sits outside the peer range.`,
  prompt: (i) => `Challenge ${str(i, "ticker").toUpperCase()}'s ${str(i, "estimate")} of ${num(i, "value")}% against ${list(i, "peers").join(", ")}.${str(i, "support") ? ` Management's support: ${str(i, "support")}` : ""}`,
};

const disclosureChecklist: ToolDef = {
  kind: "ai", id: "acc-disclosure-checklist", title: "Disclosure checklist runner", tagline: "Your draft note against the codification requirements and what peers actually filed.",
  description: "Runs a draft footnote or statement section against the disclosure requirements of the relevant ASC subtopic and Regulation S-X, item by item, and marks each requirement present, partial or missing with the peer example that shows how it is normally written. Built for the 10-K tie-out week.",
  roles: ["accountant", "corpfin"], specialties: [TECH, CTRL, AUD, ...X_REP], category: "Reporting", icon: "ListChecks", deliverable: "checklist", savesMinutes: 210, tags: ["disclosure", "checklist", "10-K", "S-X"],
  fields: [
    { key: "draft", label: "Draft disclosure", type: "textarea", required: true, placeholder: "Paste the draft footnote text" },
    { key: "topic", label: "Subtopic", type: "select", required: true, options: ["Revenue (606-10-50)", "Leases (842-20-50)", "Goodwill & intangibles (350-20-50, 350-30-50)", "Business combinations (805-10-50, 805-20-50)", "Income taxes (740-10-50)", "Credit losses (326-20-50)", "Stock compensation (718-10-50)", "Fair value (820-10-50)", "Segments (280-10-50)", "Contingencies (450-20-50)", "Debt (470-10-50)", "EPS (260-10-50)", "Related parties (850-10-50)", "Statement of cash flows (230-10-50)"], default: "Revenue (606-10-50)" },
    { key: "peers", label: "Peers for examples", type: "tickers", placeholder: "NOW CRM SNOW" },
    { key: "filer", label: "Filer status", type: "select", options: ["Large accelerated", "Accelerated", "Non-accelerated", "Smaller reporting company", "Private (GAAP)"], default: "Large accelerated" },
  ],
  example: { draft: "Revenue. We derive revenue from subscription services and professional services. Subscription revenue is recognized ratably over the contract term. Professional services revenue is recognized as services are performed. Remaining performance obligations were $1.4 billion at year end.", topic: "Revenue (606-10-50)", peers: ["NOW", "CRM", "SNOW"], filer: "Large accelerated" },
  effort: "high",
  instructions: `1. Enumerate the requirements of the chosen subtopic from the codification, one line per paragraph, in order, with the cite. For revenue that means disaggregation (606-10-50-5, 55-89 to 55-91), contract balances and the revenue recognized from opening contract liabilities (50-8 to 50-10), performance obligations including the significant judgment and timing description (50-12, 50-13), remaining performance obligations with the practical expedients and the disclosure of what is excluded (50-14, 50-14A, 50-15), significant judgments (50-17 to 50-20), and contract cost assets (340-40-50-1 to 50-3). Apply the equivalent detail for whichever subtopic is chosen, and add the Regulation S-X and S-K items that travel with it (S-X Rule 5-02 captions, Rule 5-03, Rule 4-08, Item 303 MD&A, Item 10(e) for non-GAAP). Reduce the list for a smaller reporting company or private filer and say which items were relieved.
2. Mark each requirement against the pasted draft as present, partial or missing, quoting the sentence in the draft that satisfies it. Be strict: a policy sentence is not a disaggregation table, and a total is not a rollforward.
3. For every missing or partial item, find a peer example: search_filing on each peer's latest 10-K for the phrase that locates the equivalent disclosure and quote two sentences that show the expected form.
4. Cross-check the draft against the numbers: where the draft states an amount, verify it against XBRL with get_xbrl_series (contract liabilities, remaining performance obligations, deferred commissions) and flag any figure that does not tie.
5. Check enforcement: edgar_fulltext_search with forms ["UPLOAD"] for the subtopic's usual pressure point to see what the staff asks when this note is thin.
Produce: kpis (requirements tested, present, partial, missing); checklist "Requirement status" with one item per requirement, the cite in the text and done=true only when fully satisfied; table "Gaps" (cite, requirement, status, what to add, peer example, source) sorted with missing items first; markdown "Suggested added language" written in filing voice for the three largest gaps; bullets "Tie-out exceptions"; caveats that this is a drafting aid and not a substitute for the firm's disclosure checklist.`,
  prompt: (i) => `Run the ${str(i, "topic")} disclosure checklist against this draft for a ${str(i, "filer", "Large accelerated")} filer.${list(i, "peers").length ? ` Use ${list(i, "peers").join(", ")} for examples.` : ""}\n\nDRAFT:\n${str(i, "draft")}`,
};

const newStandardScan: ToolDef = {
  kind: "ai", id: "acc-new-standard-scan", title: "New standard impact scanner", tagline: "How early adopters filed it, what it will do to your numbers, and the implementation plan.",
  description: "Scans EDGAR for registrants that have already adopted a new ASU, extracts the tables and policy language they filed, and turns that into an impact assessment and implementation plan for your own reporting: the accounts affected, the data you do not yet collect, the systems and control changes, and the transition disclosures required.",
  roles: ["accountant", "corpfin"], specialties: [TECH, CTRL, AUD, ...X_REP], category: "Reporting", icon: "Sparkles", deliverable: "memo", savesMinutes: 240, tags: ["ASU", "adoption", "transition", "DISE"],
  fields: [
    { key: "standard", label: "Standard", type: "select", required: true, options: ["ASU 2024-03 disaggregation of income statement expenses", "ASU 2023-09 income tax disclosures", "ASU 2023-07 segment reporting", "ASU 2023-05 joint venture formations", "ASU 2022-03 equity securities subject to restrictions", "ASU 2020-06 convertible instruments", "Other (describe in the notes field)"], default: "ASU 2024-03 disaggregation of income statement expenses" },
    { key: "ticker", label: "Your company", type: "ticker", required: true, placeholder: "DE" },
    { key: "peers", label: "Peers / likely early adopters", type: "tickers", placeholder: "CAT HON GE" },
    { key: "notes", label: "Notes / other standard", type: "textarea", placeholder: "Fiscal year ends October; we report three segments and use a shared-services cost pool" },
  ],
  example: { standard: "ASU 2024-03 disaggregation of income statement expenses", ticker: "DE", peers: ["CAT", "HON", "GE"], notes: "October fiscal year end, four reportable segments, a shared services cost pool and significant capitalized manufacturing overhead." },
  effort: "high",
  instructions: `1. State the standard precisely: scope, the effective dates for public business entities and others, whether early adoption is permitted, and the transition method (prospective, retrospective, modified retrospective) with the specific requirement. For ASU 2024-03 that is the tabular disaggregation of purchases of inventory, employee compensation, depreciation, intangible amortization and depletion within each relevant expense caption, plus selling expense and the definition used, effective for annual periods beginning after December 15, 2026.
2. Find the adopters: edgar_fulltext_search with forms ["10-K","10-Q"] on the ASU number and on the distinctive phrase the standard introduces ("disaggregation of income statement expenses", "employee compensation", "income taxes paid, net of refunds received", "significant segment expenses", "measure of segment profit or loss"), sorted to the most recent period, and read_document the best two or three to capture the filed table verbatim.
3. Pull the subject's current position: get_company_financials and get_xbrl_series for the captions the standard touches, and search_filing on the 10-K for the affected notes, so the gap is between what is tagged today and what will be required.
4. Assess the impact account by account: what new data is required, whether the general ledger and the chart of accounts carry it today, which system produces it, who owns it, and whether a control has to be designed. Name the specific fields (for ASU 2024-03: expense caption mapping, inventory purchases, compensation by caption, amortization by caption).
5. Draft the plan with dates anchored on the subject's fiscal year end and the filing calendar, including the interim dry run, the auditor and audit committee touchpoints, the XBRL tagging change, and the SAB 74 transition disclosure that must appear before adoption.
Produce: kpis (effective date for the subject, quarters until adoption, accounts affected, new data fields required); table "Early adopter examples" (company, period, what they filed, notable choice, source); table "Impact by account" (caption, current disclosure, required disclosure, data gap, system, owner); markdown "Transition and SAB 74 language" drafted for the next filing; checklist "Implementation plan" with owners and due dates; risks; caveats where no adopter could be found.`,
  prompt: (i) => `Assess the impact of ${str(i, "standard")} on ${str(i, "ticker").toUpperCase()} and build the implementation plan.${list(i, "peers").length ? ` Look for adopters among ${list(i, "peers").join(", ")} and the wider market.` : ""}${str(i, "notes") ? `\n\nContext: ${str(i, "notes")}` : ""}`,
};

const sxSignificance: ToolDef = {
  kind: "ai", id: "acc-sx-significance", title: "S-X significance tester", tagline: "Investment, asset and income tests for Rules 3-05, 3-09 and 4-08(g), with the filing consequence.",
  description: "Runs the Regulation S-X Rule 1-02(w) significance tests for an acquisition or an equity method investee and states what the registrant must file: audited target financial statements and how many years under Rule 3-05, separate investee statements under Rule 3-09, summarized financial information under Rule 4-08(g), and pro forma information under Article 11.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [TECH, FDD, AUD, ...X_FDD], category: "Reporting", icon: "Scale", deliverable: "analysis", savesMinutes: 120, tags: ["Rule 3-05", "Rule 3-09", "S-X", "significance"],
  fields: [
    { key: "ticker", label: "Registrant", type: "ticker", required: true, placeholder: "NOW" },
    { key: "target", label: "Target / investee", type: "text", required: true, placeholder: "Acquired analytics business" },
    { key: "consideration", label: "Consideration / investment", type: "number", required: true, unit: "$mm", default: 400 },
    { key: "targetAssets", label: "Target total assets", type: "number", unit: "$mm", default: 120 },
    { key: "targetIncome", label: "Target pretax income from continuing operations", type: "number", unit: "$mm", default: 9 },
    { key: "targetRevenue", label: "Target revenue", type: "number", unit: "$mm", default: 85 },
    { key: "kind", label: "Transaction", type: "select", options: ["Business acquisition (Rule 3-05)", "Equity method investee (Rules 3-09 / 4-08(g))", "Real estate operation (Rule 3-14)"], default: "Business acquisition (Rule 3-05)" },
  ],
  example: { ticker: "NOW", target: "Acquired analytics business", consideration: 400, targetAssets: 120, targetIncome: 9, targetRevenue: 85, kind: "Business acquisition (Rule 3-05)" },
  effort: "medium",
  instructions: `1. Get the registrant's denominators from the most recent audited annual statements: call get_company_financials and get_xbrl_series for Assets, Revenues and IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest for the last five fiscal years, plus dei:EntityFilerCategory and dei:EntityPublicFloat. Say which fiscal year is the measurement year.
2. Run the three tests of Rule 1-02(w) as amended in 2020 with calc, showing the numerator and denominator of each: investment test (consideration transferred, including contingent consideration at fair value, over the registrant's aggregate worldwide market value of voting and non-voting common equity, or total assets if no market value); asset test (target total assets over registrant total assets); income test, which after the 2020 amendments is the LOWER of the revenue component (target revenue over registrant revenue) and the income component (target absolute pretax income over the registrant's, using a five-year average when the registrant's most recent income is at least 10% below that average, and applying the rule that the revenue component is unavailable where either party has no material revenue in both of the last two years).
3. Conclude the filing consequence using the highest significance across the tests: above 20% requires Rule 3-05 audited statements (one year of audited plus the interim stub under the amended rules; two years where significance exceeds 40%), above 50% affects the shelf and Form S-3 eligibility and the Article 11 pro forma presentation; for equity method investees, above 20% triggers Rule 3-09 separate statements and above 10% triggers Rule 4-08(g) summarized information; Rule 3-14 applies to real estate operations with its own one-year presentation.
4. State the deadline and mechanics: the Item 9.01 8-K/A due 71 calendar days after the initial 8-K, the Article 11 pro forma requirements including transaction accounting, autonomous entity and management's adjustments, and the individually insignificant acquisitions aggregation test above 50%.
5. Check what peers filed in similar situations: get_recent_filings with forms ["8-K/A","S-4","10-K"] for the registrant and edgar_fulltext_search on "financial statements of businesses acquired" to show a filed example.
Produce: kpis (investment test %, asset test %, income test %, highest significance, years of audited statements required); table "Significance tests" (test, numerator, denominator, result %, threshold, conclusion) with the deciding row emphasized; checklist "Filing requirements and deadlines"; markdown "Basis and judgments" including the choice of denominators and any use of the five-year average income; bullets "Watch-outs" (contingent consideration, carve-out basis, target audited under a different framework, aggregation of individually insignificant acquisitions); caveats on inputs the user supplied versus figures from XBRL.`,
  prompt: (i) => `Run the S-X significance tests for ${str(i, "ticker").toUpperCase()}'s ${str(i, "kind", "acquisition")} of ${str(i, "target")}: consideration $${num(i, "consideration")}mm, target assets $${num(i, "targetAssets")}mm, target pretax income $${num(i, "targetIncome")}mm, target revenue $${num(i, "targetRevenue")}mm.`,
};

/* ======================================================================================
 * AI workflows: audit execution, forensic and controllership
 * ====================================================================================== */

const auditRiskMemo: ToolDef = {
  kind: "ai", id: "acc-audit-risk-memo", title: "Audit risk assessment memo", tagline: "AS 2110 from understanding the entity to the risks of material misstatement and the planned response.",
  description: "Drafts the risk assessment memo: understanding the entity and its environment, the significant classes of transactions and accounts with their relevant assertions, inherent and control risk by assertion, significant risks and the presumed fraud risk in revenue, the fraud brainstorming record, and the planned audit response by risk. Built from the client's filings, its risk factors and the accounting risk record of its peers.",
  roles: ["accountant"], specialties: [AUD, TECH, FRN], category: "Accounting & audit", icon: "Shield", deliverable: "memo", savesMinutes: 300, tags: ["AS 2110", "risk assessment", "fraud", "planning"],
  fields: [
    { key: "ticker", label: "Client", type: "ticker", required: true, placeholder: "CMG" },
    { key: "materiality", label: "Overall materiality", type: "number", unit: "$mm", default: 55 },
    { key: "scope", label: "Scope", type: "select", options: ["Integrated audit (404(b))", "Financial statement audit only", "Interim review (AS 4105)", "First-year audit"], default: "Integrated audit (404(b))" },
    { key: "concerns", label: "Known concerns", type: "textarea", placeholder: "New ERP implemented in Q3, a restated prior-year segment note, aggressive rebate programs, CFO started in January" },
  ],
  example: { ticker: "CMG", materiality: 55, scope: "Integrated audit (404(b))", concerns: "New point-of-sale system rolled out mid-year, loyalty programme expansion, a large self-insurance accrual and heavy new-restaurant capital spend." },
  effort: "high",
  instructions: `1. Understand the entity (AS 2110-07 to 2110-12): call get_company_financials; search_filing on the 10-K for "our business", "competition", "human capital", "regulation", "seasonality", "critical accounting estimates" and "properties"; search_filing on the risk factors for the five most audit-relevant risks and quote them. Note the industry, regulatory environment, the accounting framework, related parties and the incentive structure from the DEF 14A ("annual incentive", "performance metrics"), since compensation tied to a metric is a fraud incentive.
2. Understand the control environment and the reporting process: search_filing on the 10-K for "internal control over financial reporting", "material weakness", "changes in internal control" and "disclosure controls"; get_recent_filings for 8-K items 4.01, 4.02, 5.02 and 9.01; call acc-risk-profile-style checks on the peer set if useful.
3. Identify significant accounts and disclosures and the relevant assertions (AS 2110-59 to 2110-63) using size versus the stated materiality and the qualitative factors: complexity, subjectivity, susceptibility to management bias, volume, related parties, and the accounting for non-routine transactions.
4. Assess risk by assertion: state inherent risk (with the driver) and control risk, and conclude the risk of material misstatement as high, moderate or low for each significant assertion. Identify significant risks (AS 2110-70 to 2110-71) and apply the presumption of a fraud risk in revenue recognition (AS 2110-68), documenting the rebuttal only if one is genuinely available.
5. Record the fraud brainstorm (AS 2110-49 to 2110-57): incentives and pressures, opportunities, rationalization; management override; the journal entry and estimate procedures required by AS 2401; and the specific fraud scenarios for this client written as "how it would be done".
6. Plan the response (AS 2301): for each significant risk state the planned procedures, whether controls will be tested and relied on, the extent and timing, where a specialist is needed (valuation, tax, IT), and the group audit and service organization considerations (SOC 1 reports).
7. Quantify where possible with get_xbrl_series so the memo names balances rather than concepts.
Produce: kpis (overall materiality, significant accounts, significant risks, fraud risks, specialists required); table "Significant accounts and assertions" (account, balance, assertions, inherent risk, control risk, RMM, significant risk?, planned response); risks with severity for the significant risks; markdown "Understanding the entity" with quotes; markdown "Fraud brainstorming" with the scenarios; steps "Planned audit approach"; checklist "Documentation required before fieldwork"; caveats that the memo is a draft for the engagement team to challenge.`,
  prompt: (i) => `Draft the AS 2110 risk assessment memo for ${str(i, "ticker").toUpperCase()} (${str(i, "scope", "integrated audit")}) with overall materiality of $${num(i, "materiality", 55)}mm.${str(i, "concerns") ? ` Known concerns: ${str(i, "concerns")}` : ""}`,
};

const analyticalProcedures: ToolDef = {
  kind: "ai", id: "acc-analytical-procedures", title: "Substantive analytical procedure builder", tagline: "An independent expectation, a threshold below tolerable misstatement, and the investigation log.",
  description: "Designs a substantive analytical procedure under AS 2305: an expectation built from data independent of the recorded amount, disaggregated to the level that gives the procedure precision, a difference threshold set at or below tolerable misstatement, the comparison, and the investigation of every difference above the threshold with corroboration. Produces the workpaper documentation and the conclusion.",
  roles: ["accountant"], specialties: [AUD, CTRL, FRN], category: "Accounting & audit", icon: "Activity", deliverable: "analysis", savesMinutes: 180, tags: ["AS 2305", "analytics", "expectation", "threshold"],
  fields: [
    { key: "account", label: "Account tested", type: "text", required: true, placeholder: "Subscription revenue" },
    { key: "data", label: "Monthly data", type: "csv", required: true, columns: "period, recorded_amount, driver_1, driver_1_name, driver_2, driver_2_name, location_or_segment", placeholder: "2026-01,41200,1180,active subscribers,34.9,ARPU,NA\n2026-02,42050,1204,active subscribers,34.9,ARPU,NA" },
    { key: "tm", label: "Tolerable misstatement", type: "number", required: true, unit: "$mm", default: 8 },
    { key: "threshold", label: "Difference threshold", type: "number", unit: "% of TM", default: 75, help: "The threshold must not exceed tolerable misstatement" },
    { key: "ticker", label: "Public benchmark (optional)", type: "ticker", placeholder: "CMG" },
  ],
  example: { account: "Subscription revenue", data: "period,recorded_amount,driver_1,driver_1_name,driver_2,driver_2_name,location_or_segment\n2026-01,41200,1180,active subscribers,34.9,ARPU,NA\n2026-02,42050,1204,active subscribers,34.9,ARPU,NA\n2026-03,44900,1241,active subscribers,36.2,ARPU,NA\n2026-04,45100,1268,active subscribers,35.6,ARPU,NA\n2026-05,52800,1290,active subscribers,40.9,ARPU,NA\n2026-06,46700,1315,active subscribers,35.5,ARPU,NA", tm: 8, threshold: 75, ticker: "CMG" },
  effort: "medium",
  instructions: `1. Parse the pasted monthly data. State the population, the period and the level of disaggregation, and say explicitly that the expectation must be built from data independent of the recorded amount - never by rolling the recorded amount forward by a growth rate, which is the circularity the proposed replacement standard prohibits.
2. Build the expectation: multiply the drivers (units times price, headcount times average rate, square footage times rate, subscribers times ARPU), or use a ratio or regression against an independent driver; for a trend test use only prior-period independent data plus known changes (pricing actions, new locations, contract wins, the extra day in a month). Show the model with calc and state each input's source.
3. Set the threshold: the difference threshold is a stated percentage of tolerable misstatement and must not exceed it; where the account has a higher risk of material misstatement, set it lower and say why. Print the dollar threshold.
4. Assess precision before comparing: the procedure is only as good as its disaggregation (monthly by location or product beats annual in total) and the predictability of the relationship. If precision is insufficient, say the analytic cannot stand alone and specify the tests of detail that must supplement it.
5. Compare and investigate: for every period above the threshold, quantify the difference, state the hypothesis, and name the corroboration that would confirm it (a price increase letter, a new contract, a shipping log, a lease, an external index). Do not accept a management explanation without corroboration, and do not attribute the residual to "volume" without evidence.
6. Public benchmark where a ticker is given: get_company_financials and get_xbrl_series for the same line and call search_filing on the 10-Q for "compared to" and "primarily due to" to test whether the company's own explanation matches your model.
Produce: kpis (periods tested, threshold in dollars, periods above threshold, largest difference, aggregate unexplained); table "Expectation versus recorded" (period, expectation, recorded, difference, % difference, above threshold?, hypothesis, corroboration required); line chart with the expectation and the recorded amount as two series; markdown "Model and independence of inputs"; checklist "Investigation log"; callout with the conclusion on whether the account is fairly stated at this level of precision; caveats on the data the user supplied.`,
  prompt: (i) => `Design and perform a substantive analytical procedure on ${str(i, "account")} with tolerable misstatement of $${num(i, "tm", 8)}mm and a difference threshold of ${num(i, "threshold", 75)}% of tolerable misstatement.${str(i, "ticker") ? ` Cross-check against ${str(i, "ticker").toUpperCase()}'s filed commentary.` : ""}`,
};

const jeTesting: ToolDef = {
  kind: "ai", id: "acc-je-testing", title: "Journal entry testing", tagline: "Completeness roll-forward, fraud filters, a risk score per entry, and the selection with rationale.",
  description: "Runs the AS 2401 journal entry procedures over a pasted general ledger export: proves the population is complete by rolling entries to the change in the trial balance, applies the fraud filters PCAOB inspections expect to see (round amounts, weekend and post-close postings, unusual preparers, seldom-used accounts, missing descriptions, manual entries, reversals), scores every entry, and produces the documented selection.",
  roles: ["accountant", "corpfin"], specialties: [AUD, FRN, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "FileSpreadsheet", deliverable: "analysis", savesMinutes: 420, tags: ["AS 2401", "journal entries", "fraud", "testing"],
  fields: [
    { key: "entries", label: "Journal entry export", type: "csv", required: true, columns: "entry_id, entity, account, account_name, period, posting_date, effective_date, amount, debit_credit, currency, user, approver, source, description, document_number, reversal_flag", placeholder: "JE1001,US,6100,Professional fees,2026-03,2026-04-02,2026-03-31,250000,D,USD,jsmith,jsmith,Manual,,INV-,N" },
    { key: "periodEnd", label: "Period end", type: "date", required: true, default: "2026-03-31" },
    { key: "tm", label: "Tolerable misstatement", type: "number", unit: "$mm", default: 8 },
    { key: "rules", label: "Fraud filters", type: "multiselect", options: ["Round amounts", "Weekend / holiday postings", "Post-period-end and post-close postings", "Unusual or seldom-used preparers", "Preparer equals approver", "Manual and top-side entries", "Seldom-used accounts and unusual account pairs", "Missing or vague descriptions", "Reversals and reversing pairs", "Amounts just below an approval threshold", "Entries to estimate and reserve accounts", "Entries with no document number"], default: ["Round amounts", "Weekend / holiday postings", "Post-period-end and post-close postings", "Unusual or seldom-used preparers", "Manual and top-side entries", "Reversals and reversing pairs", "Amounts just below an approval threshold"] },
    { key: "threshold", label: "Approval threshold to test against", type: "number", unit: "$", default: 10000 },
  ],
  example: { entries: "entry_id,entity,account,account_name,period,posting_date,effective_date,amount,debit_credit,currency,user,approver,source,description,document_number,reversal_flag\nJE1001,US,6100,Professional fees,2026-03,2026-04-02,2026-03-31,250000,D,USD,jsmith,jsmith,Manual,,,N\nJE1002,US,4000,Revenue,2026-03,2026-03-31,2026-03-31,9800,C,USD,tlee,mgarcia,Manual,Cut-off accrual,ACC-22,N\nJE1003,US,2400,Accrued liabilities,2026-03,2026-03-28,2026-03-31,500000,C,USD,ctrl_admin,ctrl_admin,Top-side,Reserve true-up,,Y\nJE1004,US,6200,Rent,2026-03,2026-03-14,2026-03-31,42350,D,USD,arclerk,mgarcia,System,Monthly rent,RENT-3,N\nJE1005,UK,6100,Professional fees,2026-03,2026-04-05,2026-03-31,9950,D,GBP,jsmith,jsmith,Manual,adj,,N\nJE1006,US,1500,Inventory,2026-03,2026-03-21,2026-03-31,120000,D,USD,whmgr,mgarcia,System,Receipts,REC-88,N", periodEnd: "2026-03-31", tm: 8, rules: ["Round amounts", "Weekend / holiday postings", "Post-period-end and post-close postings", "Unusual or seldom-used preparers", "Preparer equals approver", "Manual and top-side entries", "Reversals and reversing pairs", "Amounts just below an approval threshold"], threshold: 10000 },
  effort: "high",
  instructions: `1. Map the columns first and print the mapping, because every ERP export differs: identify entry id, entity, account, period, posting and effective dates, amount and sign convention, user, approver, source and description. Name any required field that is absent and state the procedure it disables - without user and timestamp the AS 2401 selection cannot be performed, and say so plainly.
2. Prove completeness before testing anything: total debits must equal total credits, and the net movement by account must reconcile to the change in the trial balance for the period. Report the reconciliation with calc and quantify any gap; an unreconciled population is the single most common PCAOB inspection finding on this procedure.
3. Profile the population: entries and value by source (manual, system, recurring, top-side), by user, by account, and by posting date relative to period end. Show the concentration (top five users by manual value).
4. Apply each selected filter and count the hits: amounts ending in three or more zeros or repeating digits; postings on Saturdays, Sundays or holidays; postings after the period end or after the close date; users outside the accounting function or with few entries overall; preparer equal to approver; manual and top-side sources; accounts used in fewer than a stated number of entries and unusual debit/credit account pairs (revenue debited against a reserve, cash credited against an expense); blank or single-word descriptions; reversing pairs, especially where the reversal is in the following period; amounts between 90% and 100% of the approval threshold, which is the HealthSouth pattern.
5. Score each entry: assign weights to the filters it trips, add a weight for size relative to tolerable misstatement, and rank. State the weights so the selection is reproducible.
6. Select for testing: the highest-scoring entries plus a random sample of the residual population for coverage, and document for each selection the reason, the evidence to request (support, approval, business purpose) and the assertion addressed.
Produce: kpis (entries, total value, manual %, completeness gap, entries flagged, entries selected); table "Column mapping and data quality"; table "Completeness roll-forward" (account, opening, JE net, closing, TB change, difference) with totals; table "Filter results" (filter, entries, value, % of population, comment); table "Selections" (entry id, date, account, amount, user, source, filters tripped, score, evidence to request) sorted by score; bar chart of manual entry value by user; risks; checklist "Workpaper documentation for AS 2401"; caveats on the truncation of a large paste and on what the population excludes (automated recurring entries, sub-ledger detail).`,
  prompt: (i) => `Run AS 2401 journal entry testing on the pasted population for the period ending ${str(i, "periodEnd", "2026-03-31")} with tolerable misstatement of $${num(i, "tm", 8)}mm. Filters: ${list(i, "rules").join("; ")}. Approval threshold to test against: $${num(i, "threshold", 10000)}.`,
};

const fluxCommentary: ToolDef = {
  kind: "ai", id: "acc-flux-commentary", title: "Flux analysis commentary writer", tagline: "Dual-threshold variance analysis with a named driver and evidence for every account.",
  description: "Turns a trial balance by period into close-ready flux commentary: dual percentage and dollar thresholds tied to materiality, balance sheet first then P&L, against both the prior period and budget, with the driver named for every flagged account and the evidence required to support it. Also flags the accounts that did not move when they should have.",
  roles: ["accountant", "corpfin"], specialties: [CTRL, AUD, TECH, FDD, ...X_CTRL], category: "Reporting", icon: "ArrowLeftRight", deliverable: "memo", savesMinutes: 210, tags: ["flux", "close", "variance", "commentary"],
  fields: [
    { key: "tb", label: "Trial balance by period", type: "csv", required: true, columns: "account, account_name, fs_caption, entity, current_period, prior_period, budget", placeholder: "4000,Revenue,Revenue,US,12450,11180,12000\n5000,Cost of revenue,COGS,US,(4980),(4310),(4800)" },
    { key: "pctThreshold", label: "Percentage threshold", type: "number", unit: "%", default: 10 },
    { key: "dollarThreshold", label: "Dollar threshold", type: "number", unit: "$000s", default: 250 },
    { key: "compare", label: "Compare against", type: "multiselect", options: ["Prior period", "Budget", "Prior year same period"], default: ["Prior period", "Budget"] },
    { key: "context", label: "Known drivers", type: "textarea", placeholder: "Price increase effective February, one extra shipping day, a $400k legal settlement accrued in March, new lease commenced" },
  ],
  example: { tb: "account,account_name,fs_caption,entity,current_period,prior_period,budget\n4000,Subscription revenue,Revenue,US,12450,11180,12000\n4100,Services revenue,Revenue,US,1980,2240,2100\n5000,Cost of revenue,COGS,US,-4980,-4310,-4800\n6100,Professional fees,SG&A,US,-980,-420,-500\n6200,Rent,SG&A,US,-355,-290,-300\n6300,Salaries and wages,SG&A,US,-3420,-3380,-3500\n1100,Accounts receivable,AR,US,9840,7920,8200\n1500,Prepaid expenses,Prepaid,US,1240,1180,1200\n2100,Accounts payable,AP,US,-3120,-3480,-3300\n2400,Accrued liabilities,Accrued,US,-2860,-1990,-2100\n2600,Deferred revenue,Deferred revenue,US,-14200,-12800,-13500", pctThreshold: 10, dollarThreshold: 250, compare: ["Prior period", "Budget"], context: "A price increase effective February, a $400k legal settlement accrued in March, and a new distribution centre lease commenced in March." },
  effort: "medium",
  instructions: `1. Parse the trial balance and normalize signs so that revenue and liabilities are presented consistently; print the totals and confirm the trial balance nets to zero (or state the out-of-balance amount, which must be resolved before commentary is written).
2. Apply dual thresholds: an account is flagged only when it moves more than the percentage threshold AND more than the dollar threshold. Report the count of accounts flagged under each comparison, and list the accounts that fell just below both thresholds so the reviewer can see the edge.
3. Order the analysis balance sheet first and then the income statement, because a balance sheet movement usually explains the P&L movement (accrued liabilities up explains the expense; deferred revenue up explains billings ahead of revenue; receivables up with flat revenue is a collection or cut-off issue).
4. Name the driver for each flagged account and classify it: volume, price or rate, mix, timing or cut-off, one-time or non-recurring, accounting correction, reclassification, foreign exchange. Use the known drivers the user provided and tie each to the specific account; never write "due to increased activity" or "due to timing" without the amount and the mechanism.
5. Test each explanation for arithmetic: the named drivers must sum to the variance. Show the reconciliation and label any residual as unexplained, with the follow-up owner.
6. Flag negative findings too: accounts that should have moved and did not (depreciation flat after a large capital addition, interest flat after a drawdown, accrued compensation flat after headcount growth), and any account with a round-number balance or an unusual sign (credit balance receivable, debit balance deferred revenue).
7. Where a public company ticker is implied by the data, corroborate with search_filing on the 10-Q for "primarily due to" and the account name.
Produce: kpis (accounts reviewed, flagged versus prior period, flagged versus budget, largest variance, unexplained total); table "Flux, prior period" (caption, account, current, prior, change $, change %, driver, classification, evidence, owner) sorted by absolute change; table "Flux, budget" in the same shape when budget is requested; waterfall of the operating income variance by driver; bullets "Accounts that should have moved and did not"; markdown "Close commentary" written in the voice of a controller's monthly package, one short paragraph per caption; checklist "Support to attach"; caveats.`,
  prompt: (i) => `Write the flux commentary from the pasted trial balance. Flag accounts moving more than ${num(i, "pctThreshold", 10)}% and more than $${num(i, "dollarThreshold", 250)}k, compared against ${list(i, "compare").join(" and ")}.${str(i, "context") ? `\n\nKnown drivers: ${str(i, "context")}` : ""}`,
};

const goingConcern: ToolDef = {
  kind: "ai", id: "acc-going-concern", title: "Going concern assessment", tagline: "Conditions, management's plans, and whether substantial doubt is alleviated - with the report language.",
  description: "Performs the going concern evaluation under ASC 205-40 and AS 2415: identifies the conditions and events that raise substantial doubt, quantifies the liquidity runway against maturities and covenants for one year from issuance, evaluates whether management's plans are probable of implementation and of mitigating the doubt, and drafts the disclosure and the auditor's explanatory paragraph if required.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [AUD, TECH, CTRL, FDD, ...X_CTRL], category: "Accounting & audit", icon: "Hourglass", deliverable: "memo", savesMinutes: 210, tags: ["going concern", "ASC 205-40", "AS 2415", "liquidity"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
    { key: "issuance", label: "Expected issuance date", type: "date", default: "2027-03-01" },
    { key: "plans", label: "Management's plans", type: "textarea", placeholder: "Revolver upsize in negotiation, $200m asset sale signed, cost reduction of $150m annualized, covenant amendment requested" },
    { key: "forecast", label: "Monthly cash forecast (optional)", type: "csv", columns: "month, operating_cash_flow, capex, debt_service, financing, cash_balance, revolver_availability", placeholder: "2026-10,-18,-12,-9,0,240,150" },
  ],
  example: { ticker: "WBD", issuance: "2027-03-01", plans: "A revolver upsize in negotiation, a signed $200m asset sale expected to close in Q2, $150m of annualized cost reductions, and a requested covenant amendment on the net leverage test.", forecast: "" },
  effort: "high",
  instructions: `1. Establish the look-forward period: one year from the date the financial statements are issued or available to be issued under ASC 205-40-50-1, which differs from the auditor's AS 2415 period of one year beyond the balance sheet date. State both dates explicitly.
2. Identify the conditions (ASC 205-40-50-4 and AS 2415-06): recurring operating losses, negative operating cash flow, a working capital deficiency, defaults or covenant breaches, denial of trade credit, debt maturing within the period without a committed refinancing, loss of a key customer or franchise, litigation, and the need to dispose of assets or restructure debt. Quantify each from get_company_financials and get_xbrl_series (Revenues, OperatingIncomeLoss, NetCashProvidedByUsedInOperatingActivities, CashAndCashEquivalentsAtCarryingValue, AssetsCurrent, LiabilitiesCurrent, LongTermDebtCurrent, LongTermDebtNoncurrent, InterestExpense) and from search_filing on the 10-K and latest 10-Q for "liquidity and capital resources", "substantial doubt", "covenant", "maturities of long-term debt", "revolving credit facility" and "subsequent events".
3. Build the runway: months of liquidity from cash plus undrawn availability against the forecast burn, and the same against the maturity schedule inside the look-forward period. Use the pasted monthly forecast when provided; otherwise derive a run-rate burn from the last four quarters and label it as derived. Show the calculation with calc.
4. Test the covenants: read the ratio definitions and levels from the credit agreement text (edgar_fulltext_search with forms ["8-K","10-K","10-Q"] and "credit agreement" plus the company name, then read_document for "consolidated net leverage ratio", "interest coverage", "financial covenant"), compute current headroom and the EBITDA decline that breaches each test.
5. Evaluate management's plans in two steps (ASC 205-40-50-6 and 50-7): are they probable of being effectively implemented (approved before issuance, within management's control, feasible), and if so, are they probable of mitigating the conditions? Plans requiring a counterparty's consent - a refinancing not yet committed, an asset sale not yet signed, an equity raise not yet priced - are usually not probable of implementation, and a plan that alleviates only part of the shortfall does not alleviate the doubt.
6. Conclude in the three possible states and draft the wording: no substantial doubt; substantial doubt alleviated by plans, which still requires disclosure of the conditions and the plans; or substantial doubt not alleviated, which requires the explicit phrase "substantial doubt about its ability to continue as a going concern" in the notes and an explanatory paragraph in the auditor's report.
Produce: callout with the conclusion; kpis (cash, undrawn availability, LTM operating cash flow, months of runway, debt maturing in the period, covenant headroom); timeline of maturities, covenant test dates and the plan milestones through the look-forward period; table "Conditions and events" (condition, evidence, quantified effect, source); table "Management's plans" (plan, probable of implementation?, probable of mitigating?, amount, evidence required); line or bar chart of projected liquidity by month; markdown "Draft disclosure"; markdown "Auditor's report language if not alleviated"; risks; nextSteps.`,
  prompt: (i) => `Perform the going concern assessment for ${str(i, "ticker").toUpperCase()} with statements expected to be issued ${str(i, "issuance", "2027-03-01")}.${str(i, "plans") ? ` Management's plans: ${str(i, "plans")}` : ""}`,
};

const relatedParty: ToolDef = {
  kind: "ai", id: "acc-related-party-screen", title: "Related party screen", tagline: "Who the related parties are, what flowed to them, and whether it was disclosed.",
  description: "Builds the related party register for a registrant from the proxy statement, the related party footnote and the filing record, then tests the transactions against the ASC 850 and Item 404 disclosure requirements and the AS 2410 audit procedures. Cross-checks a pasted vendor or customer master against officer, director and affiliate names to find undisclosed relationships.",
  roles: ["accountant", "consultant"], specialties: [AUD, FRN, TECH, FDD, ...X_FDD], category: "Diligence", icon: "Network", deliverable: "analysis", savesMinutes: 180, tags: ["ASC 850", "related party", "Item 404", "AS 2410"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
    { key: "master", label: "Vendor / customer master (optional)", type: "csv", columns: "counterparty, type, address, city, state, tax_id_last4, ytd_amount, contact_name", placeholder: "Acme Consulting LLC,Vendor,1 Main St,Austin,TX,4412,480000,J. Smith" },
    { key: "focus", label: "Focus", type: "multiselect", options: ["Officers and directors", "Principal shareholders (5%+)", "Equity method investees and joint ventures", "Entities controlled by management", "Family members", "Consolidated VIEs", "Compensation arrangements"], default: ["Officers and directors", "Principal shareholders (5%+)", "Equity method investees and joint ventures", "Entities controlled by management"] },
  ],
  example: { ticker: "WBD", master: "", focus: ["Officers and directors", "Principal shareholders (5%+)", "Equity method investees and joint ventures", "Entities controlled by management"] },
  effort: "medium",
  instructions: `1. Build the register of parties: search_filing on the DEF 14A for "related person transactions", "certain relationships", "beneficial ownership", "director independence", "compensation committee interlocks" and each officer's biography; search_filing on the 10-K for "related party", "affiliate", "equity method", "variable interest entity" and "transactions with". Use get_recent_filings with forms ["SC 13D","SC 13G","4","3"] and get_insider_transactions to identify 5% holders, officers and directors and their affiliations.
2. Inventory the transactions: for each party record the nature of the relationship, the transaction type (sales, purchases, leases, loans, guarantees, services, licensing), the amounts by period, the terms, whether the terms are arm's length, balances outstanding, and the source paragraph.
3. Test disclosure: ASC 850-10-50-1 requires the nature of the relationship, a description of the transactions, the dollar amounts for each period an income statement is presented, and the amounts due to and from related parties with their terms; ASC 850-10-50-5 prohibits asserting arm's-length terms unless it can be substantiated. Item 404(a) of Regulation S-K requires disclosure of transactions above $120,000 in which a related person has a material interest, and Item 404(b) the policies for review and approval. Mark each transaction compliant, thin or undisclosed.
4. Apply the audit procedures of AS 2410: understand the company's process for identifying related parties, inquire of management and the audit committee, and perform the procedures for transactions outside the normal course of business - including reading the significant contracts, evaluating the business purpose, and considering whether the transaction is a fraud risk factor or indicates undisclosed relationships.
5. If a vendor or customer master is pasted, screen it: match counterparty and contact names against the officer, director and 5% holder names; look for addresses that match an officer's address or a post box, missing tax identification, sequential invoice patterns, counterparties formed close to the first transaction date, and counterparties whose only customer is the company. Report each match with the basis and a materiality note.
6. Read the peer practice: edgar_fulltext_search forms ["UPLOAD"] for "related party" to see what the staff asks when the note is thin.
Produce: kpis (parties identified, transactions, aggregate value, undisclosed or thin items); table "Related party register" (party, relationship, basis, transactions, amount, terms, disclosed where, adequacy, source); table "Master screen matches" (counterparty, match type, evidence, amount, follow-up) when a master is pasted; risks with severity; qa "Inquiries for management and the audit committee"; checklist "Procedures to document under AS 2410"; caveats on name matching producing false positives.`,
  prompt: (i) => `Build the related party register and screen for ${str(i, "ticker").toUpperCase()}, focusing on ${list(i, "focus").join("; ")}.`,
};

const closeChecklist: ToolDef = {
  kind: "ai", id: "acc-close-checklist", title: "Month-end close checklist generator", tagline: "A day-by-day close calendar with owners, dependencies and the recurring entries.",
  description: "Generates the close calendar for a specific company: tasks by business day with owner, dependency and evidence, the recurring journal entries, the reconciliations that must be complete before review, the flux and consolidation steps, and the review gates. Tuned for the entity structure, systems and materiality you describe, and for the SEC filing deadline when the company is a registrant.",
  roles: ["accountant", "corpfin"], specialties: [CTRL, TECH, AUD, ...X_CTRL], category: "Reporting", icon: "Calendar", deliverable: "checklist", savesMinutes: 150, tags: ["close", "checklist", "controllership", "calendar"],
  fields: [
    { key: "profile", label: "Company profile", type: "textarea", required: true, placeholder: "US parent, three subsidiaries (UK, Germany, Singapore), NetSuite plus a separate billing system, $400m revenue, 5-day close target, SOX compliant" },
    { key: "ticker", label: "Ticker (if a registrant)", type: "ticker", placeholder: "NOW" },
    { key: "days", label: "Close target", type: "number", unit: "business days", default: 5, min: 3, max: 15 },
    { key: "areas", label: "Include", type: "multiselect", options: ["Cash and bank reconciliations", "Revenue and deferred revenue", "AR and credit losses", "Inventory and cost of sales", "Fixed assets and leases", "Accruals and prepaids", "Payroll and compensation", "Intercompany and FX translation", "Tax provision", "Equity and stock compensation", "Consolidation and eliminations", "Flux and management reporting", "SOX evidence and certifications", "XBRL and filing"], default: ["Cash and bank reconciliations", "Revenue and deferred revenue", "Accruals and prepaids", "Intercompany and FX translation", "Consolidation and eliminations", "Flux and management reporting", "SOX evidence and certifications"] },
  ],
  example: { profile: "US parent with UK, German and Singapore subsidiaries, NetSuite general ledger plus a separate billing system, $400m revenue, 5-day close target, SOX compliant with a December year end.", ticker: "NOW", days: 5, areas: ["Cash and bank reconciliations", "Revenue and deferred revenue", "Accruals and prepaids", "Intercompany and FX translation", "Consolidation and eliminations", "Flux and management reporting", "SOX evidence and certifications", "XBRL and filing"] },
  effort: "medium",
  instructions: `1. If a ticker is given, call get_company_financials for scale and get_recent_filings for the last four 10-Q and 10-K filing dates to measure the company's actual filing lag, then work backwards from the statutory deadline (10-K 60/75/90 days and 10-Q 40/40/45 days after period end by filer status, which you can confirm from dei:EntityFilerCategory via get_xbrl_series) to set the review gates.
2. Sequence by dependency, not by department: cash and subledger cutoffs on day 1, subledger-to-general-ledger ties for cash, AR and AP by day 3 ("no rec, no close"), accruals once the AP cutoff is closed, revenue once billing is closed, intercompany matching before translation, translation before consolidation, eliminations before the top-side entries, flux after the consolidated trial balance, and the management package last.
3. For each task give: business day, task, owner role, inputs required, output, evidence for the SOX file, and the predecessor task. Mark the hard gates (period lock, review sign-off, certification) and note where preparer cannot equal approver.
4. List the recurring journal entries explicitly: accruals for known unbilled expenses, prepaid amortization, depreciation and ROU asset amortization, deferred revenue release, payroll and bonus accrual, commission accrual, stock compensation expense, the monthly tax estimate at the annual effective rate, FX revaluation of non-functional-currency balances and the intercompany interest accrual.
5. List the reconciliations with their aging rules (nothing over 60 days unreconciled; every reconciling item named and owned) and the intercompany matching tolerance.
6. Add the review layer: flux thresholds, balance sheet review, the reconciliation review queue, the checklist of items escalated to the controller, and the quarterly-only steps (provision, disclosure checklist, tie-out, XBRL, subsequent events, certifications).
Produce: kpis (tasks, hard gates, recurring entries, target close day, filing deadline); checklist "Close calendar" with each item's text starting "Day N -" and owner and due fields populated; table "Task detail" (day, task, owner, input, output, evidence, predecessor); table "Recurring journal entries" (entry, accounts, basis, owner, support); table "Reconciliations" (account, source, frequency, preparer, reviewer, aging rule); timeline of the gates and the filing date; bullets "Where this close will break"; nextSteps.`,
  prompt: (i) => `Generate a ${num(i, "days", 5)}-business-day close checklist for this company${str(i, "ticker") ? ` (${str(i, "ticker").toUpperCase()})` : ""}:\n\n${str(i, "profile")}\n\nInclude: ${list(i, "areas").join("; ")}.`,
};

const reconReview: ToolDef = {
  kind: "ai", id: "acc-recon-review", title: "Account reconciliation review", tagline: "Review a pasted reconciliation the way a controller does: does it tie, is the item supported, how old is it.",
  description: "Reviews account reconciliations against the reviewer's standard: does the general ledger balance agree to the subledger or statement, is every reconciling item identified, aged, supported and resolvable, are there unexplained plugs or offsetting items, and does the rollforward tie. Produces review notes, an aging of reconciling items and a conclusion on whether the reconciliation can be signed.",
  roles: ["accountant", "corpfin"], specialties: [CTRL, AUD, FRN, ...X_CTRL], category: "Accounting & audit", icon: "CheckSquare", deliverable: "analysis", savesMinutes: 120, tags: ["reconciliation", "close", "review", "SOX"],
  fields: [
    { key: "recs", label: "Reconciliations", type: "csv", required: true, columns: "account, account_name, gl_balance, source_balance, reconciling_item, item_amount, item_age_days, support_reference, preparer, reviewer", placeholder: "1010,Operating cash,4820,4915,Outstanding checks,-95,12,BANK-0326,arclerk,mgarcia" },
    { key: "materiality", label: "Materiality for review", type: "number", unit: "$000s", default: 250 },
    { key: "policy", label: "Aging policy", type: "number", unit: "days", default: 60, help: "Items older than this must be escalated or written off" },
  ],
  example: { recs: "account,account_name,gl_balance,source_balance,reconciling_item,item_amount,item_age_days,support_reference,preparer,reviewer\n1010,Operating cash,4820,4915,Outstanding checks,-95,12,BANK-0326,arclerk,mgarcia\n1100,Accounts receivable,9840,9902,Unapplied cash,-62,45,AR-AGE-0326,tlee,mgarcia\n1500,Prepaid expenses,1240,1180,Unsupported difference,60,190,,arclerk,arclerk\n2100,Accounts payable,-3120,-3050,Goods received not invoiced,-70,22,GRNI-0326,apclerk,mgarcia\n2400,Accrued liabilities,-2860,-2860,,0,0,ACC-0326,tlee,mgarcia\n1200,Intercompany receivable,2410,1980,Unmatched intercompany,430,95,,ctrl_admin,ctrl_admin", materiality: 250, policy: 60 },
  effort: "medium",
  instructions: `1. Parse the reconciliations and for each account compute the gap between the general ledger balance and the source balance, the sum of identified reconciling items, and the unexplained residual. Print the arithmetic: a reconciliation whose items do not sum to the gap is not reconciled, whatever the cover sheet says.
2. Classify each reconciling item: timing (outstanding checks, deposits in transit, goods received not invoiced, unapplied cash), error requiring a journal entry, unsupported difference or plug, and intercompany mismatch. A "plug", "to agree", "variance" or blank description is a finding, not an item.
3. Age every item against the stated policy and escalate: items older than the policy require an owner, a resolution date and, where uncollectible or unsupportable, a write-off entry. Aged items in cash and intercompany accounts are the highest risk.
4. Test the control attributes for SOX: preparer and reviewer must be different people, review must be evidenced and timely, and support must be referenced. Report every account where the preparer equals the reviewer or the support reference is blank.
5. Rank the findings by the unexplained residual against the stated materiality and propose the correcting entries with debit and credit accounts.
6. Look for patterns across accounts: offsetting residuals between two accounts (a misposting), the same aged item carried in consecutive periods, and intercompany balances that do not mirror.
Produce: kpis (accounts reviewed, reconciled cleanly, unexplained total, items over the aging policy, control attribute failures); table "Reconciliation status" (account, GL, source, gap, items identified, unexplained, status) with the worst rows first and totals; table "Review notes" (account, note, severity, owner, action, due) written as review comments a preparer can clear; table "Proposed entries" (account, Dr, Cr, amount, reason); bar chart of unexplained residual by account; risks; callout if any reconciliation cannot be signed; caveats.`,
  prompt: (i) => `Review these reconciliations with a materiality of $${num(i, "materiality", 250)}k and an aging policy of ${num(i, "policy", 60)} days, and write the review notes.`,
};

const walkthroughRcm: ToolDef = {
  kind: "ai", id: "acc-walkthrough-rcm", title: "Walkthrough & risk-control matrix drafter", tagline: "Process notes into a narrative, what-could-go-wrongs, controls and test attributes.",
  description: "Turns walkthrough notes or a process description into the ICFR documentation set: a process narrative from origination to the financial records, the what-could-go-wrong at each step mapped to assertions, the controls that address each WCGW with their type and frequency, and the test of design and operating effectiveness with sample sizes and attributes.",
  roles: ["accountant", "corpfin"], specialties: [AUD, CTRL, TECH, ...X_CTRL], category: "Accounting & audit", icon: "Network", deliverable: "table", savesMinutes: 240, tags: ["AS 2201", "ICFR", "RCM", "walkthrough"],
  fields: [
    { key: "notes", label: "Walkthrough notes", type: "textarea", required: true, placeholder: "Order entry: sales rep enters the order in Salesforce, the deal desk approves discounts above 15%, the order syncs to NetSuite nightly, billing runs on the 1st, revenue is recognized by the billing system schedule, the revenue manager reviews a deferred revenue rollforward monthly..." },
    { key: "process", label: "Process", type: "select", required: true, options: ["Order to cash / revenue", "Procure to pay", "Payroll", "Inventory and cost of sales", "Fixed assets and leases", "Financial close and reporting", "Treasury and cash", "Income tax provision", "Stock compensation", "IT general controls"], default: "Order to cash / revenue" },
    { key: "reliance", label: "Planned reliance", type: "select", options: ["High (control risk low)", "Moderate", "None (substantive only)"], default: "High (control risk low)" },
  ],
  example: { notes: "Sales reps enter orders in Salesforce; the deal desk approves any discount above 15%; approved orders sync to NetSuite nightly through an integration with an error queue reviewed by the order operations team; billing runs on the first business day; revenue schedules are created by the billing system from the contract term; the revenue manager reviews a deferred revenue rollforward and a revenue flux monthly; credit memos above $25k need the controller's approval.", process: "Order to cash / revenue", reliance: "High (control risk low)" },
  effort: "medium",
  instructions: `1. Write the narrative in transaction order from origination to the financial records, as AS 2110-37 requires: initiation, authorization, processing, recording, and the interfaces between systems, naming the system, the role and the document at each step. Mark every point where data crosses a system boundary or a manual intervention occurs, because that is where the risk lives.
2. Derive the what-could-go-wrongs at each step and map each to the assertion it threatens (occurrence, completeness, accuracy, cutoff, classification, existence, valuation, rights and obligations, presentation). Be specific: "an order is billed at an unapproved discount", not "revenue is misstated".
3. For each WCGW, identify the control that addresses it and classify it: preventive or detective, manual or automated, key or non-key, frequency (per transaction, daily, weekly, monthly, quarterly, annual), the evidence it produces, and the assertion coverage. Flag every WCGW with no control as a design gap and say what control to implement.
4. Identify the entity-level controls, the management review controls (with the precision question: what threshold triggers investigation, and what evidence shows the reviewer investigated), the IT dependencies (system-generated reports, interfaces, configurations) and the information produced by the entity that must itself be tested for completeness and accuracy.
5. Design the test: for each key control state the test of design, the test of operating effectiveness, the population, the sample size by frequency (common practice: annual 1, quarterly 2, monthly 2-3, weekly 5-8, daily 20-25, multiple per day 25-40, automated 1 with ITGC reliance), the attributes to inspect, and the roll-forward procedures if tested at interim.
6. Adjust for the planned reliance: with no reliance, say so and pivot to the substantive procedures instead of drafting a test plan.
Produce: markdown "Process narrative" with the steps numbered; table "Risk-control matrix" (step, WCGW, assertion, control id, control description, type, frequency, key?, evidence, test of design, sample size, attributes); bullets "Design gaps"; table "IT dependencies and IPE" (report or interface, owner, how completeness and accuracy will be tested); checklist "Walkthrough evidence to obtain"; risks; caveats that the narrative reflects what was described and must be confirmed by observing the process.`,
  prompt: (i) => `Draft the process narrative and risk-control matrix for the ${str(i, "process")} process. Planned reliance: ${str(i, "reliance", "High (control risk low)")}.\n\nNOTES:\n${str(i, "notes")}`,
};

const deficiencyEvaluator: ToolDef = {
  kind: "ai", id: "acc-deficiency-evaluator", title: "Control deficiency evaluator", tagline: "Deficiency, significant deficiency or material weakness - and the letter that says so.",
  description: "Classifies control deficiencies under AS 2201 by evaluating the magnitude of the potential misstatement and the likelihood that a material misstatement would not be prevented or detected, considering compensating controls and the indicators of a material weakness, then aggregates related deficiencies and drafts the AS 1305 written communication and the management letter points.",
  roles: ["accountant", "corpfin"], specialties: [AUD, CTRL, TECH, ...X_CTRL], category: "Accounting & audit", icon: "AlertTriangle", deliverable: "memo", savesMinutes: 150, tags: ["AS 2201", "material weakness", "AS 1305", "deficiency"],
  fields: [
    { key: "deficiencies", label: "Deficiencies", type: "csv", required: true, columns: "id, process, control, deficiency, account_affected, assertion, gross_exposure, deviations_found, population, compensating_control", placeholder: "D1,Revenue,Deal desk discount approval,3 of 25 orders billed without approval,Revenue,Accuracy,1200,3,25,Monthly revenue flux review" },
    { key: "materiality", label: "Overall materiality", type: "number", required: true, unit: "$mm", default: 55 },
    { key: "pm", label: "Performance materiality", type: "number", unit: "% of overall", default: 70 },
    { key: "context", label: "Entity context", type: "textarea", placeholder: "Prior-year material weakness in revenue remediated in Q2, new ERP in Q3, CFO transition in January" },
  ],
  example: { deficiencies: "id,process,control,deficiency,account_affected,assertion,gross_exposure,deviations_found,population,compensating_control\nD1,Revenue,Deal desk discount approval,3 of 25 orders billed without required approval,Revenue,Accuracy,1200,3,25,Monthly revenue flux review at a $500k threshold\nD2,Close,Journal entry review,12 manual entries posted without evidence of review,Multiple,Multiple,8400,12,140,None\nD3,ITGC,Privileged access review,Two terminated developers retained production access for 60 days,Multiple,Multiple,0,2,2,Quarterly access recertification\nD4,Leases,New lease review,One new lease not added to the lease system for two months,ROU asset,Completeness,340,1,9,Monthly lease schedule tie to GL", materiality: 55, pm: 70, context: "A prior-year material weakness in revenue was remediated in Q2, a new ERP went live in Q3, and the CFO started in January." },
  effort: "medium",
  instructions: `1. For each deficiency compute the magnitude: the gross exposure of the account or transaction class the control addresses, and the projected misstatement implied by the deviation rate found (deviations over population times the population value) with calc. Compare both to performance materiality and to overall materiality, and state the comparison.
2. Assess likelihood: whether a reasonable possibility exists that a material misstatement would not be prevented or detected on a timely basis - the AS 2201 definition of a material weakness - considering the nature of the accounts, the susceptibility to loss or fraud, the subjectivity and complexity involved, the interaction with other deficiencies, and the future consequences.
3. Test the compensating control properly: a compensating control only mitigates if it operates at a level of precision that would detect a misstatement of the magnitude in question, is itself effective, and has been tested. Name the precision threshold and say whether it is fine enough; a flux review at a $500k threshold does not compensate for an exposure of $8m.
4. Classify: control deficiency, significant deficiency (important enough to merit attention by those responsible for oversight), or material weakness. Apply the indicators in AS 2201-69: identification of fraud by senior management, restatement of previously issued statements, a material misstatement identified by the auditor that the company's controls would not have detected, and ineffective oversight by the audit committee. Say which indicator applies when one does.
5. Aggregate: group deficiencies affecting the same account, assertion or process and evaluate them in combination, since individually small deficiencies in the close process commonly aggregate to a material weakness. Present the aggregation explicitly.
6. Draft the communications: the written communication of material weaknesses and significant deficiencies to management and the audit committee before the report date required by AS 1305, and management letter points for the remaining deficiencies, each with the condition, the cause, the effect, the recommendation and space for management's response. Include remediation expectations and the retest timing.
Produce: kpis (deficiencies evaluated, material weaknesses, significant deficiencies, aggregate projected misstatement, performance materiality); table "Evaluation" (id, deficiency, magnitude, projected misstatement, likelihood, compensating control effective?, classification, indicator cited) with material weaknesses emphasized; table "Aggregation" (account or process, deficiencies grouped, combined magnitude, combined classification); markdown "Draft AS 1305 communication"; markdown "Management letter points"; checklist "Remediation and retest plan" with owners; callout if the ICFR opinion would be adverse; caveats.`,
  prompt: (i) => `Evaluate these control deficiencies against overall materiality of $${num(i, "materiality", 55)}mm and performance materiality of ${num(i, "pm", 70)}% of overall, then draft the communications.${str(i, "context") ? `\n\nContext: ${str(i, "context")}` : ""}`,
};

/* ======================================================================================
 * AI workflows: transaction advisory and tax
 * ====================================================================================== */

const qoeDatabook: ToolDef = {
  kind: "ai", id: "acc-qoe-databook", title: "Quality of earnings databook", tagline: "Adjusted EBITDA built from a monthly P&L, with every add-back ruled on.",
  description: "Turns a monthly profit-and-loss export into the core of a quality-of-earnings databook: monthly and trailing-twelve-month trends, an adjusted EBITDA bridge from reported to pro forma, each proposed add-back classified as accepted, reduced or rejected with the evidence a buyer would require, plus revenue and margin diligence observations and the open-item list.",
  roles: ["accountant", "consultant", "pe"], specialties: [FDD, AUD, ...X_FDD], category: "Diligence", icon: "FileSpreadsheet", deliverable: "analysis", savesMinutes: 480, tags: ["QoE", "EBITDA", "add-backs", "FDD"],
  fields: [
    { key: "pnl", label: "Monthly profit and loss", type: "csv", required: true, columns: "month,revenue,cogs,opex_payroll,opex_other,depreciation,amortization,other_income", help: "One row per month, at least 24 months so the trailing twelve months can be compared" },
    { key: "addbacks", label: "Proposed add-backs", type: "csv", columns: "item,amount,period,rationale,support", help: "The seller's adjustment schedule, one row per item" },
    { key: "context", label: "Deal and business context", type: "textarea", placeholder: "Founder-owned industrial services business, owner takes $1.4m of compensation, two one-time legal settlements, a new ERP in the period" },
    { key: "multiple", label: "Entry multiple for pricing the adjustments", type: "number", unit: "x", default: 8 },
  ],
  example: {
    pnl: "month,revenue,cogs,opex_payroll,opex_other,depreciation,amortization,other_income\n2024-07,4120,2510,690,430,95,40,0\n2024-08,4260,2590,700,441,95,40,0\n2024-09,4310,2620,705,448,96,40,0\n2024-10,4180,2545,698,452,96,40,0\n2024-11,3980,2430,690,447,96,40,0\n2024-12,4520,2740,720,610,97,40,120\n2025-01,4050,2480,702,441,97,40,0\n2025-02,4110,2510,704,438,97,40,0\n2025-03,4390,2660,712,455,98,40,0\n2025-04,4480,2700,718,461,98,40,0\n2025-05,4560,2740,722,470,98,40,0\n2025-06,4610,2760,726,474,99,40,0\n2025-07,4700,2810,731,479,99,40,0\n2025-08,4790,2860,737,486,99,40,0\n2025-09,4860,2900,742,492,100,40,0\n2025-10,4740,2835,739,498,100,40,0\n2025-11,4520,2705,733,494,100,40,0\n2025-12,5120,3060,760,690,101,40,150\n2026-01,4610,2745,745,489,101,40,0\n2026-02,4680,2785,748,492,101,40,0\n2026-03,4980,2960,757,506,102,40,0\n2026-04,5080,3015,762,513,102,40,0\n2026-05,5170,3065,767,521,102,40,0\n2026-06,5240,3105,772,527,103,40,0",
    addbacks: "item,amount,period,rationale,support\nOwner compensation above market,620,LTM,Owner paid 1.4m vs 780k market for the role,Compensation study and employment agreement\nLegal settlement,340,LTM,One-time dispute with a former distributor,Settlement agreement and legal invoices\nERP implementation costs,410,LTM,Non-recurring system implementation,Vendor statements of work\nRun-rate price increase,520,LTM,4% list increase effective April 2026 annualized,Price letters to top 20 customers\nFamily member payroll,180,LTM,Two relatives not continuing post-close,Payroll register\nRent above market,95,LTM,Related-party lease to be reset at close,Third-party appraisal",
    context: "Founder-owned industrial services business, single site, owner active in sales. Buyer is a lower middle-market sponsor. Related-party building lease will be reset at close.",
    multiple: 8,
  },
  effort: "high",
  instructions: `1. Parse the monthly P&L. Compute per month: gross profit and margin, EBITDA (revenue less cost of sales less operating expenses, before depreciation and amortization), and EBITDA margin. Build trailing-twelve-month columns for the latest twelve months and the prior twelve, and compute the year-over-year change in revenue, gross margin and EBITDA. Use calc for every figure and state the months included in each trailing-twelve-month window.
2. Rule on each proposed add-back. Classify as accepted, reduced (state the accepted amount) or rejected, using the standard tests: is it non-recurring in fact, is it supported by third-party evidence, would it persist for the buyer, is it already in the base, and is it measured on a run-rate basis. Apply the market practice from diligence: owner compensation above a documented market rate is accepted to the market level; one-time legal settlements are accepted with the settlement agreement; system implementation costs are accepted only for the non-capitalizable, non-recurring portion; run-rate pricing is accepted only with evidence of effectivity and volume retention and is reduced for partial-period realization; family payroll is accepted only if the person leaves; above-market rent is accepted to the appraised level. Reject anything that is a normal cost of operating or lacks support, and say what support would change the answer.
3. Build the bridge: reported EBITDA, then each accepted or reduced adjustment as its own step, to adjusted EBITDA. Show the seller's proposed adjusted EBITDA next to yours and quantify the difference in dollars and in purchase price at the entry multiple.
4. Diligence observations: revenue seasonality and the December spike, gross-margin trend and what drives it, payroll as a percent of revenue over time, the other-income line, and any month whose pattern breaks (flag it as a possible cut-off or accrual issue). Quantify each observation.
5. Open items: the specific documents or analyses needed to finish (customer-level revenue by month, wage detail, the appraisal, the price letters, an accrual walk), each tied to the adjustment it would prove.
Produce: kpis (reported LTM EBITDA, your adjusted EBITDA, seller's adjusted EBITDA, difference in purchase price at the multiple, LTM revenue growth, adjusted EBITDA margin); waterfall "Adjusted EBITDA bridge"; table "Add-back rulings" (Item, Proposed, Accepted, Treatment, Test applied, Evidence required) with totals; table "Monthly trend" (Month, Revenue, Gross margin, EBITDA, EBITDA margin) and a line chart of revenue and EBITDA margin; bullets "Diligence observations"; checklist "Open items" with the adjustment each supports; caveats stating that this is an EBITDA analysis of pasted data, not an audit, and that net working capital and net debt are separate exercises.`,
  prompt: (i) => `Build the quality-of-earnings analysis from this monthly P&L and rule on the seller's add-backs at a ${num(i, "multiple", 8)}x entry multiple.${str(i, "context") ? `\n\nContext: ${str(i, "context")}` : ""}`,
};

const nwcAnalysis: ToolDef = {
  kind: "ai", id: "acc-nwc-analysis", title: "Net working capital analysis and peg", tagline: "Monthly balances turned into a defensible peg, with the debt-like items pulled out.",
  description: "Analyzes monthly net working capital from a pasted balance schedule: which accounts belong in the target, seasonality and the averaging window that produces a fair peg, days sales outstanding and days payable trends, one-time or non-operating balances to exclude, and the debt-like items that belong in net debt instead. Produces the peg recommendation with the arithmetic and the true-up mechanics.",
  roles: ["accountant", "consultant", "pe"], specialties: [FDD, ...X_FDD], category: "Diligence", icon: "Scale", deliverable: "analysis", savesMinutes: 360, tags: ["NWC", "peg", "true-up", "FDD"],
  fields: [
    { key: "balances", label: "Monthly balance sheet detail", type: "csv", required: true, columns: "month,revenue,ar,inventory,prepaid,other_current_assets,ap,accrued_comp,accrued_other,deferred_revenue,other_current_liabilities", help: "At least 18 months of month-end balances" },
    { key: "exclusions", label: "Accounts the parties dispute", type: "textarea", placeholder: "Deferred revenue treated as debt-like, accrued bonus paid at close, related-party receivable, tax accounts" },
    { key: "window", label: "Averaging window", type: "select", options: ["Trailing 12 months", "Trailing 6 months", "Trailing 3 months", "Same months last year"], default: "Trailing 12 months" },
  ],
  example: {
    balances: "month,revenue,ar,inventory,prepaid,other_current_assets,ap,accrued_comp,accrued_other,deferred_revenue,other_current_liabilities\n2025-01,4050,5980,3120,410,180,3210,890,540,1250,160\n2025-02,4110,6040,3180,405,175,3260,910,545,1270,158\n2025-03,4390,6420,3240,398,172,3410,1020,560,1310,155\n2025-04,4480,6510,3290,415,168,3460,780,566,1330,162\n2025-05,4560,6620,3350,420,165,3520,800,571,1360,160\n2025-06,4610,6700,3410,425,163,3570,830,575,1380,158\n2025-07,4700,6810,3460,430,160,3620,860,580,1400,156\n2025-08,4790,6930,3510,435,158,3680,890,585,1420,154\n2025-09,4860,7040,3560,440,155,3730,930,590,1450,152\n2025-10,4740,6880,3610,445,153,3690,960,594,1470,150\n2025-11,4520,6560,3680,450,150,3620,990,598,1490,148\n2025-12,5120,7280,3450,455,148,3860,1310,610,1560,146\n2026-01,4610,6720,3520,460,146,3700,760,602,1510,150\n2026-02,4680,6810,3580,462,144,3740,790,606,1530,148\n2026-03,4980,7220,3640,465,142,3890,900,612,1570,146\n2026-04,5080,7360,3700,470,140,3950,700,617,1590,144\n2026-05,5170,7480,3760,474,138,4000,730,622,1610,142\n2026-06,5240,7580,3810,478,136,4050,760,626,1630,140",
    exclusions: "Buyer wants deferred revenue treated as debt-like because the cash is collected in advance. Seller's accrued bonus is paid in full at close. There is a $210k related-party receivable from the owner.",
    window: "Trailing 12 months",
  },
  effort: "high",
  instructions: `1. Compute net working capital for each month on a normalized basis: current assets in scope less current liabilities in scope. Exclude cash, debt and debt-like items, income tax accounts and non-operating balances by default and say so. Use calc and show the monthly series.
2. Rule on the disputed accounts one at a time. Deferred revenue: if the buyer must perform the service, it is an operating liability and belongs in working capital; only a cash-collected obligation with no remaining cost to serve behaves like debt, and the market convention is to keep it in working capital while pricing the cost to fulfill. Accrued bonus paid at close: remove from the peg and settle as an indebtedness item so the seller funds it. Related-party receivable: exclude, and require settlement at close. Tax accounts: exclude. For each, state the treatment, the effect on the peg in dollars, and which party it favors.
3. Seasonality: chart the monthly series against revenue, compute the coefficient of variation, and identify the peak and trough months and their drivers. Compute the peg under each candidate window (trailing twelve, six and three months, and the same month last year) and recommend one, explaining how the timing of close interacts with the seasonal pattern.
4. Days: compute days sales outstanding on a 365-day basis from monthly revenue annualized, days inventory on hand if cost of sales is available, days payable, and the resulting cash conversion cycle by month. Flag any trend that suggests the seller is stretching payables or slowing collections into the sale, and quantify the working-capital benefit the seller captured.
5. Recommend: the peg, the collar if any, the measurement basis (consistent with historical accounting practice, and the specific accounting policies that must be named in the purchase agreement), the true-up timing and dispute mechanism, and the estimated true-up exposure given the volatility you measured.
Produce: kpis (recommended peg, peg under the chosen window, latest month net working capital, peak-to-trough swing, days sales outstanding latest, estimated true-up exposure); table "Monthly net working capital" (Month, Revenue, Net working capital, Percent of revenue, Days sales outstanding, Days payable) ; line chart of net working capital and revenue; table "Disputed accounts" (Account, Treatment, Effect on peg, Rationale, Favors); table "Peg under each window" (Window, Peg, Comment) with the recommendation emphasized; bullets "Purchase agreement language to insist on"; caveats.`,
  prompt: (i) => `Analyze net working capital from these monthly balances and recommend a peg using a ${str(i, "window", "trailing 12 month")} window.${str(i, "exclusions") ? `\n\nDisputed items: ${str(i, "exclusions")}` : ""}`,
};

const maTaxStructuring: ToolDef = {
  kind: "ai", id: "acc-ma-tax-structuring", title: "M&A tax structuring options", tagline: "Asset versus stock, 338(h)(10), and what the step-up is worth.",
  description: "Compares the tax structures available for an acquisition: taxable asset purchase, taxable stock purchase, a section 338(h)(10) or 336(e) election, and a tax-free reorganization. Quantifies the buyer's step-up benefit and the seller's incremental tax cost, identifies the attributes at risk including net operating losses under section 382, and lists the diligence and agreement provisions each structure requires.",
  roles: ["accountant", "pe", "banker"], specialties: [TAX, FDD, ...X_FDD], category: "Tax", icon: "Landmark", deliverable: "analysis", savesMinutes: 300, tags: ["338(h)(10)", "step-up", "382", "structuring"],
  fields: [
    { key: "purchasePrice", label: "Purchase price", type: "number", unit: "$mm", required: true, default: 250 },
    { key: "taxBasis", label: "Seller's tax basis in assets", type: "number", unit: "$mm", default: 60 },
    { key: "stockBasis", label: "Seller's basis in stock", type: "number", unit: "$mm", default: 40 },
    { key: "entity", label: "Target entity type", type: "select", options: ["S corporation", "C corporation", "LLC / partnership", "Consolidated subsidiary"], default: "S corporation" },
    { key: "intangibleShare", label: "Share of price allocable to amortizable intangibles and goodwill", type: "number", unit: "%", default: 65 },
    { key: "buyerRate", label: "Buyer's marginal tax rate", type: "number", unit: "%", default: 25 },
    { key: "sellerOrdinary", label: "Seller's ordinary rate", type: "number", unit: "%", default: 37 },
    { key: "sellerCapital", label: "Seller's capital gains rate", type: "number", unit: "%", default: 23.8 },
    { key: "discountRate", label: "Discount rate for the step-up benefit", type: "number", unit: "%", default: 10 },
    { key: "attributes", label: "Attributes and complications", type: "textarea", placeholder: "$18m federal net operating loss, state credits, prior ownership change, foreign subsidiary, 401(k) plan, unpaid payroll taxes" },
  ],
  example: { purchasePrice: 250, taxBasis: 60, stockBasis: 40, entity: "S corporation", intangibleShare: 65, buyerRate: 25, sellerOrdinary: 37, sellerCapital: 23.8, discountRate: 10, attributes: "$18m federal net operating loss carryforward generated over the last four years, state R&D credits, one prior ownership change in 2021, a single foreign sales subsidiary in Canada, and an unresolved sales-and-use tax exposure in three states." },
  effort: "high",
  instructions: `1. Compute the step-up benefit with calc for each structure that produces one: the amount of basis step-up (purchase price less existing tax basis), the portion amortizable over fifteen years under section 197 given the intangible share, annual amortization, the annual tax shield at the buyer's rate, and the present value of the shield at the discount rate over fifteen years. State the present value both in dollars and as a percent of purchase price.
2. Compute the seller's tax cost under each structure: in an asset sale, ordinary income on the portion attributable to depreciation recapture, inventory and receivables versus capital gain on goodwill, and for a C corporation the second layer of tax on distribution; in a stock sale, capital gain on the difference between price and stock basis. Show the after-tax proceeds side by side and the gross-up the seller would need to be indifferent.
3. Explain what each structure requires: a 338(h)(10) election needs an S corporation or a consolidated subsidiary, a qualified stock purchase of at least eighty percent within twelve months, and a joint election with every selling shareholder, which means the consent has to be secured in the agreement; a 336(e) election is unilateral for the seller but narrower; a tax-free reorganization under section 368 requires continuity of interest and business enterprise and a valid business purpose, and gives the buyer carryover basis rather than a step-up.
4. Attributes: for each attribute named, state whether it survives. Net operating losses survive a stock purchase but are limited under section 382 to the value of the loss corporation times the long-term tax-exempt rate, and disappear economically in an asset purchase. Explain the ownership-change test, the five-year testing period, the effect of a prior ownership change, and the built-in gain and loss rules. State the annual limitation implied by the purchase price and a stated rate, using calc, and say how many years of the loss would be usable.
5. Diligence and provisions: the specific exposures to quantify (unpaid payroll taxes, sales-and-use nexus, worker classification, transfer pricing, unclaimed property), the representations and covenants each structure needs, the escrow or special indemnity, the purchase price allocation schedule and Form 8594, and the transfer taxes triggered by an asset deal.
Produce: callout with the recommended structure and why; table "Structure comparison" (Structure, Buyer step-up present value, Seller after-tax proceeds, Attributes surviving, Consents required, Key risk) with the recommendation emphasized; waterfall "Buyer step-up value"; table "Seller tax" (Component, Amount, Rate, Tax) with totals; bullets "Section 382 conclusion" with the arithmetic; checklist "Diligence and agreement provisions"; risks; caveats that this is a structuring analysis and not tax advice, that state and foreign consequences need local review, and that every number depends on the allocation ultimately agreed.`,
  prompt: (i) => `Compare tax structures for acquiring a ${str(i, "entity", "S corporation")} at $${num(i, "purchasePrice", 250)}mm with $${num(i, "taxBasis", 60)}mm of asset basis and $${num(i, "stockBasis", 40)}mm of stock basis.${str(i, "attributes") ? `\n\nAttributes: ${str(i, "attributes")}` : ""}`,
};

const transferPricing: ToolDef = {
  kind: "ai", id: "acc-transfer-pricing-benchmark", title: "Transfer pricing benchmark", tagline: "Comparable margins from public filings to support an intercompany price.",
  description: "Builds a comparable-company margin study from SEC filings to support an intercompany price under the transactional net margin method: screens candidate comparables, computes the profit level indicators from XBRL facts, derives the interquartile range, and tests where the tested party sits. Documents the search criteria, rejections and adjustments the way a local file requires.",
  roles: ["accountant", "corpfin"], specialties: [TAX, TECH], category: "Tax", icon: "Globe", deliverable: "analysis", savesMinutes: 420, tags: ["transfer pricing", "TNMM", "comparables", "local file"],
  fields: [
    { key: "tested", label: "Tested party function", type: "select", options: ["Limited-risk distributor", "Contract manufacturer", "Contract R&D services", "Shared services / management fee", "Sales agent (commissionaire)", "Routine marketing services"], default: "Limited-risk distributor" },
    { key: "comparables", label: "Candidate comparables", type: "tickers", required: true, placeholder: "GWW WCC POOL SITE", help: "Public companies performing a similar function; the workflow screens and rejects" },
    { key: "testedFinancials", label: "Tested party financials", type: "csv", columns: "year,revenue,cogs,operating_expenses,operating_profit,total_assets", help: "Three years if available" },
    { key: "pli", label: "Profit level indicator", type: "select", options: ["Operating margin (EBIT / sales)", "Berry ratio (gross profit / operating expenses)", "Full cost mark-up (EBIT / total cost)", "Return on assets"], default: "Operating margin (EBIT / sales)" },
    { key: "jurisdiction", label: "Jurisdiction and year", type: "text", placeholder: "Germany, FY2026" },
  ],
  example: { tested: "Limited-risk distributor", comparables: ["GWW", "WCC", "POOL", "SITE", "FAST"], testedFinancials: "year,revenue,cogs,operating_expenses,operating_profit,total_assets\n2024,82.4,66.1,13.9,2.4,31.2\n2025,88.9,71.6,14.6,2.7,33.8\n2026,94.2,75.9,15.4,2.9,35.9", pli: "Operating margin (EBIT / sales)", jurisdiction: "Germany, FY2026" },
  effort: "high",
  instructions: `1. State the search criteria before any data: the functional profile of the tested party, the industry and activity codes accepted, independence, the years required, and the rejection reasons you will apply (different function, related-party sales, loss-making in multiple years, size outside the accepted range, intangible ownership, distinct business model).
2. For each candidate call get_company_financials, then search_filing on the latest 10-K for "competition", "our business" and "segment" to confirm the function actually matches. Reject candidates explicitly and record the reason; a study with no rejections is not credible.
3. Compute the profit level indicator for each accepted comparable for the latest three years using get_xbrl_series where the annual series is needed, and take the three-year weighted average as well as the simple average. Use calc. For the Berry ratio and the full cost mark-up, state the exact numerator and denominator you used from the filing's income statement.
4. Build the range: minimum, lower quartile, median, upper quartile and maximum on the three-year weighted averages, computed the way the local rules expect, and place the tested party's result in the range. Compute the adjustment to reach the median if the tested party falls outside the interquartile range, in local currency and as a percent of sales.
5. Working capital adjustment: explain the mechanics (adjusting each comparable's result for differences in receivables, inventory and payables at a stated interest rate) and either perform it with the data available or state what is missing.
6. Document: the method selected and why the others were rejected (comparable uncontrolled price, resale price, cost plus, profit split), the tested party choice, the aggregation of transactions, and the year-end adjustment mechanism.
Produce: kpis (accepted comparables, rejected, tested party result, interquartile range low and high, median, adjustment to median); table "Comparable set" (Company, Function confirmed, Profit level indicator by year, Three-year weighted average, Accepted or rejected, Reason); table "Range" (Statistic, Value) with the tested party emphasized; scatter of size against margin; markdown "Method selection and functional analysis"; checklist "Local file documentation"; caveats that public-filing comparables are segment-level and unadjusted, that local rules on quartile computation and loss-makers vary, and that this supports but does not replace a study prepared for filing.`,
  prompt: (i) => `Benchmark a ${str(i, "tested", "limited-risk distributor")} against ${list(i, "comparables").join(", ")} using ${str(i, "pli", "operating margin")}${str(i, "jurisdiction") ? ` for ${str(i, "jurisdiction")}` : ""}.`,
};

/* ======================================================================================
 * Calculators: audit execution
 * ====================================================================================== */

const BENCHMARKS: { key: string; label: string; low: number; high: number }[] = [
  { key: "pretax", label: "Pre-tax income", low: 3, high: 7 },
  { key: "revenue", label: "Revenue", low: 0.5, high: 1 },
  { key: "assets", label: "Total assets", low: 0.5, high: 1 },
  { key: "equity", label: "Total equity", low: 1, high: 3 },
  { key: "expenses", label: "Total expenses (not-for-profit or pre-revenue)", low: 0.5, high: 1 },
];

/** AS 2105 materiality, performance materiality and the clearly-trivial threshold, with the benchmark comparison. */
const materiality: ToolDef = {
  kind: "calc", id: "acc-materiality", title: "Materiality and thresholds", tagline: "Overall, performance and clearly-trivial thresholds with every benchmark compared.",
  description: "Computes overall materiality from the chosen benchmark, performance materiality for the assessed risk, and the clearly-trivial threshold for accumulating misstatements, then shows what each alternative benchmark would have produced so the choice is documented rather than assumed. Prefills the benchmarks from SEC data when opened on a ticker.",
  roles: ["accountant", "student"], specialties: [AUD, TECH, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "Scale", savesMinutes: 45, tags: ["AS 2105", "materiality", "planning"],
  fields: [
    { key: "pretax", label: "Pre-tax income", type: "number", unit: "$000s", default: 120000 },
    { key: "revenue", label: "Revenue", type: "number", unit: "$000s", default: 2400000 },
    { key: "assets", label: "Total assets", type: "number", unit: "$000s", default: 1900000 },
    { key: "equity", label: "Total equity", type: "number", unit: "$000s", default: 820000 },
    { key: "expenses", label: "Total expenses", type: "number", unit: "$000s", default: 2280000 },
    { key: "benchmark", label: "Benchmark selected", type: "select", options: ["Pre-tax income", "Revenue", "Total assets", "Total equity", "Total expenses (not-for-profit or pre-revenue)"], default: "Pre-tax income" },
    { key: "pct", label: "Percentage applied", type: "number", unit: "%", default: 5, step: 0.1 },
    { key: "pmPct", label: "Performance materiality", type: "number", unit: "% of overall", default: 65 },
    { key: "trivialPct", label: "Clearly trivial", type: "number", unit: "% of overall", default: 5 },
    { key: "risk", label: "Assessed risk of material misstatement", type: "select", options: ["Lower", "Moderate", "Higher"], default: "Moderate" },
    { key: "specific", label: "Accounts needing a lower specific materiality", type: "text", placeholder: "Related-party transactions, executive compensation" },
  ],
  example: { pretax: 120000, revenue: 2400000, assets: 1900000, equity: 820000, expenses: 2280000, benchmark: "Pre-tax income", pct: 5, pmPct: 65, trivialPct: 5, risk: "Moderate", specific: "Related-party transactions and executive compensation" },
  prefill: (c) => ({
    pretax: c.ltm.netIncome !== null ? Math.round(c.ltm.netIncome * 1000 * 1.25) : undefined,
    revenue: c.ltm.revenue !== null ? Math.round(c.ltm.revenue * 1000) : undefined,
    assets: c.balance.cash !== null && c.ltm.revenue !== null ? Math.round((c.balance.cash + c.ltm.revenue) * 1000) : undefined,
    equity: undefined,
    expenses: c.ltm.revenue !== null && c.ltm.operatingIncome !== null ? Math.round((c.ltm.revenue - c.ltm.operatingIncome) * 1000) : undefined,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const vals: Record<string, number> = { pretax: num(i, "pretax"), revenue: num(i, "revenue"), assets: num(i, "assets"), equity: num(i, "equity"), expenses: num(i, "expenses") };
    const label = str(i, "benchmark", "Pre-tax income");
    const chosen = BENCHMARKS.find((b) => b.label === label) ?? BENCHMARKS[0];
    const base = vals[chosen.key];
    if (!base) throw new Error(`Enter a value for ${chosen.label}; it is the benchmark you selected.`);
    const pct = num(i, "pct", 5) / 100, pmPct = num(i, "pmPct", 65) / 100, trivPct = num(i, "trivialPct", 5) / 100;
    const risk = str(i, "risk", "Moderate");
    const overall = Math.abs(base) * pct;
    const pm = overall * pmPct;
    const trivial = overall * trivPct;
    const suggestedPm = risk === "Higher" ? 0.5 : risk === "Lower" ? 0.75 : 0.65;
    const rows = BENCHMARKS.map((b) => {
      const v = vals[b.key];
      const lo = Math.abs(v) * (b.low / 100), hi = Math.abs(v) * (b.high / 100);
      return [b.label + (b.key === chosen.key ? " (selected)" : ""), fmt.moneyRaw(v), `${b.low}% to ${b.high}%`, fmt.moneyRaw(lo), fmt.moneyRaw(hi)];
    });
    const idx = BENCHMARKS.findIndex((b) => b.key === chosen.key);
    const inRange = pct * 100 >= chosen.low && pct * 100 <= chosen.high;
    return {
      title: "Materiality and thresholds",
      summary: `Overall materiality is ${fmt.moneyRaw(overall)} thousand, ${pct * 100}% of ${chosen.label.toLowerCase()} of ${fmt.moneyRaw(base)} thousand. Performance materiality is ${fmt.moneyRaw(pm)} at ${(pmPct * 100).toFixed(0)}% of overall, and misstatements below ${fmt.moneyRaw(trivial)} are clearly trivial and need not be accumulated.${inRange ? "" : ` The ${(pct * 100).toFixed(1)}% applied sits outside the ${chosen.low}% to ${chosen.high}% range normally used for this benchmark, so document why.`}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Overall materiality", value: fmt.moneyRaw(overall), hint: "AS 2105: the level at which a reasonable investor's judgment would change" },
          { label: "Performance materiality", value: fmt.moneyRaw(pm), delta: `${(pmPct * 100).toFixed(0)}% of overall`, tone: Math.abs(pmPct - suggestedPm) > 0.12 ? "warn" : "neutral" },
          { label: "Clearly trivial", value: fmt.moneyRaw(trivial), delta: `${(trivPct * 100).toFixed(0)}% of overall` },
          { label: "Benchmark", value: chosen.label, delta: `${(pct * 100).toFixed(1)}% applied`, tone: inRange ? "pos" : "warn" },
        ] },
        { type: "table", title: "Benchmark comparison ($000s)", columns: ["Benchmark", "Amount", "Customary range", "Low end", "High end"], rows, emphasisRow: idx >= 0 ? idx : undefined, note: "Ranges are common firm practice, not requirements; AS 2105 requires judgment and documentation of the basis." },
        { type: "bar", title: "Materiality implied by each benchmark at the low end of its range ($000s)", format: "num", data: BENCHMARKS.map((b) => ({ label: b.label.split(" (")[0], value: Math.abs(vals[b.key]) * (b.low / 100), emphasis: b.key === chosen.key })) },
        { type: "table", title: "Thresholds in use", columns: ["Threshold", "Amount", "Purpose"], rows: [
          ["Overall materiality", fmt.moneyRaw(overall), "Evaluating the financial statements as a whole"],
          ["Performance materiality", fmt.moneyRaw(pm), "Designing procedures so that aggregated uncorrected and undetected misstatements stay below overall"],
          ["Clearly trivial", fmt.moneyRaw(trivial), "Below this, misstatements are not accumulated for evaluation"],
          ["Suggested performance materiality at assessed risk", fmt.moneyRaw(overall * suggestedPm), `${risk} risk implies about ${(suggestedPm * 100).toFixed(0)}% of overall`],
        ] },
        ...(str(i, "specific") ? [{ type: "callout" as const, tone: "info" as const, title: "Specific materiality", text: `A lower threshold is warranted for: ${str(i, "specific")}. Set it by reference to the sensitivity of the disclosure rather than to the financial-statement benchmark, and document the amount used.` }] : []),
        assumptions([["Benchmark", `${chosen.label} ${fmt.moneyRaw(base)}`], ["Percentage", `${(pct * 100).toFixed(2)}%`], ["Performance materiality", `${(pmPct * 100).toFixed(0)}% of overall`], ["Clearly trivial", `${(trivPct * 100).toFixed(0)}% of overall`], ["Assessed risk", risk]]),
      ],
      caveats: ["Amounts are in the same units as the inputs (thousands in the defaults).", "Performance materiality must reflect the assessed risk and the history of misstatements; a higher-risk engagement usually sits nearer 50% of overall.", "Revise materiality if the benchmark changes materially during the audit, and document the revision (AS 2105.10-.11)."],
      nextSteps: ["Document the benchmark choice and the percentage in the planning memo", "Set specific materiality for sensitive disclosures", "Feed performance materiality into the sampling calculators"],
    };
  },
};

/** AS 2315 attribute sampling: sample size for a control test and the upper deviation limit achieved. */
const attributeSample: ToolDef = {
  kind: "calc", id: "acc-attribute-sample", title: "Attribute sampling", tagline: "Control-test sample size and the upper deviation limit the result supports.",
  description: "Sizes a test of controls from the tolerable and expected deviation rates at the chosen risk of overreliance using Poisson reliability factors, then evaluates the result: the upper deviation limit implied by the deviations found, whether the control can be relied on, and how many more items would be needed to recover reliance.",
  roles: ["accountant"], specialties: [AUD, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "ListChecks", savesMinutes: 40, tags: ["AS 2315", "sampling", "controls"],
  fields: [
    { key: "population", label: "Population size", type: "number", default: 4800 },
    { key: "tolerable", label: "Tolerable deviation rate", type: "number", unit: "%", default: 5, step: 0.5 },
    { key: "expected", label: "Expected deviation rate", type: "number", unit: "%", default: 1, step: 0.5 },
    { key: "risk", label: "Risk of overreliance", type: "select", options: ["5", "10"], default: "5" },
    { key: "found", label: "Deviations found", type: "number", default: 1 },
    { key: "tested", label: "Items actually tested (optional)", type: "number", help: "Leave empty to evaluate at the computed sample size" },
  ],
  example: { population: 4800, tolerable: 5, expected: 1, risk: "5", found: 1, tested: 60 },
  compute: (i: Inputs): WorkflowOutput => {
    const pop = num(i, "population", 0);
    const tol = num(i, "tolerable", 5) / 100, exp = num(i, "expected", 1) / 100;
    const risk = str(i, "risk", "5");
    if (tol <= 0) throw new Error("Tolerable deviation rate must be greater than zero.");
    if (exp >= tol) throw new Error("Expected deviation rate must be below the tolerable rate, otherwise no sample size can support reliance.");
    let n = 0;
    for (let k = 5; k <= 4000; k++) {
      const allowed = Math.floor(exp * k);
      if (rfAt(risk, allowed) / k <= tol) { n = k; break; }
    }
    if (!n) throw new Error("No practical sample size supports these rates; lower the expected rate or raise the tolerable rate.");
    if (pop > 0 && n > pop) n = pop;
    const tested = num(i, "tested", 0) || n;
    const found = Math.max(0, Math.round(num(i, "found", 0)));
    const udl = rfAt(risk, found) / tested;
    const pass = udl <= tol;
    const sampleRate = tested > 0 ? found / tested : 0;
    let recover = 0;
    if (!pass) for (let k = tested + 1; k <= tested + 4000; k++) { if (rfAt(risk, found) / k <= tol) { recover = k - tested; break; } }
    const curve = [0, 1, 2, 3, 4].map((k) => ({ label: `${k} found`, value: rfAt(risk, k) / tested }));
    return {
      title: "Attribute sampling",
      summary: `At a ${(tol * 100).toFixed(1)}% tolerable rate, a ${(exp * 100).toFixed(1)}% expected rate and ${risk}% risk of overreliance, the sample is ${n} items. With ${found} deviation${found === 1 ? "" : "s"} in ${tested} items the upper deviation limit is ${fmt.pct(udl, 1)}, so the control ${pass ? "can be relied on" : "cannot be relied on"}.${pass ? "" : ` Recovering reliance would take about ${recover} more items with no further deviations.`}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Sample size", value: String(n) },
          { label: "Deviations found", value: String(found), delta: `${fmt.pct(sampleRate, 1)} sample rate` },
          { label: "Upper deviation limit", value: fmt.pct(udl, 1), tone: pass ? "pos" : "neg" },
          { label: "Tolerable rate", value: fmt.pct(tol, 1) },
          { label: "Conclusion", value: pass ? "Rely" : "Do not rely", tone: pass ? "pos" : "neg" },
        ] },
        { type: "table", title: "Computation", columns: ["Step", "Value", "Basis"], rows: [
          ["Reliability factor at 0 deviations", rfAt(risk, 0).toFixed(2), `Poisson, ${risk}% risk of overreliance`],
          ["Deviations allowed at this size", String(Math.floor(exp * n)), "Expected rate times sample size"],
          ["Reliability factor at that count", rfAt(risk, Math.floor(exp * n)).toFixed(2), "Table lookup"],
          ["Sample size", String(n), "Smallest n where factor divided by n is at or below the tolerable rate"],
          ["Items tested", String(tested), tested === n ? "Computed size" : "As entered"],
          ["Upper deviation limit", fmt.pct(udl, 2), `Factor at ${found} deviations divided by ${tested}`],
          ["Allowance for sampling risk", fmt.pct(udl - sampleRate, 2), "Upper limit less the observed sample rate"],
        ] },
        { type: "bar", title: "Upper deviation limit by deviations found, at this sample size", format: "pct", reference: { value: tol, label: `tolerable ${fmt.pct(tol, 1)}` }, data: curve.map((c) => ({ ...c, emphasis: c.label === `${found} found` })) },
        assumptions([["Population", pop ? String(pop) : "not entered"], ["Tolerable rate", fmt.pct(tol, 1)], ["Expected rate", fmt.pct(exp, 1)], ["Risk of overreliance", `${risk}%`]]),
      ],
      caveats: ["Poisson reliability factors assume a large population relative to the sample; below roughly 250 items consider a hypergeometric or a non-statistical approach.", "A deviation found must be investigated for cause before it is projected; an isolated deviation is still a deviation unless the cause is understood.", "Sample size is unrelated to population size for large populations, which is why the population field is documentation only."],
      nextSteps: ["Investigate the cause of every deviation before concluding", "If reliance fails, expand the sample or change the strategy to substantive testing"],
    };
  },
};

/** Monetary unit sampling: size, interval, projected misstatement and the upper misstatement limit. */
const musSample: ToolDef = {
  kind: "calc", id: "acc-mus-sample", title: "Monetary unit sampling", tagline: "Substantive sample size, then the projected and upper misstatement limits.",
  description: "Sizes a probability-proportional-to-size substantive sample from the recorded population, tolerable misstatement and expected misstatement, then evaluates the misstatements found: taints, projected misstatement, basic precision, the incremental allowance for sampling risk, and the upper misstatement limit against tolerable.",
  roles: ["accountant"], specialties: [AUD, FDD], category: "Accounting & audit", icon: "Calculator", savesMinutes: 60, tags: ["MUS", "PPS", "sampling", "substantive"],
  fields: [
    { key: "population", label: "Recorded population value", type: "number", unit: "$000s", required: true, default: 480000 },
    { key: "tolerable", label: "Tolerable misstatement", type: "number", unit: "$000s", required: true, default: 7800 },
    { key: "expected", label: "Expected misstatement", type: "number", unit: "$000s", default: 1000 },
    { key: "risk", label: "Risk of incorrect acceptance", type: "select", options: ["5", "10", "15", "20", "25", "30", "37", "50"], default: "5" },
    { key: "misstatements", label: "Misstatements found", type: "csv", columns: "item,book_value,audited_value", help: "One row per item where the audited value differs from the book value" },
  ],
  example: { population: 480000, tolerable: 7800, expected: 1000, risk: "5", misstatements: "item,book_value,audited_value\nINV-4471,96,72\nINV-5120,1450,1305\nINV-6008,38,0\nINV-7742,9200,9200" },
  compute: (i: Inputs): WorkflowOutput => {
    const pop = num(i, "population"), tol = num(i, "tolerable"), exp = num(i, "expected", 0);
    const risk = str(i, "risk", "5");
    const rf = MUS_RF[risk] ?? 3.0, ef = MUS_EF[risk] ?? 1.6;
    if (pop <= 0 || tol <= 0) throw new Error("Enter a recorded population value and a tolerable misstatement greater than zero.");
    const denom = tol - exp * ef;
    if (denom <= 0) throw new Error("Expected misstatement times the expansion factor must be below tolerable misstatement, otherwise the sample cannot be sized.");
    const n = Math.ceil((pop * rf) / denom);
    const interval = pop / n;
    const found = str(i, "misstatements") ? records(str(i, "misstatements")) : [];
    const items = found.map((r) => {
      need(r, "book value", "book_value", "book", "recorded");
      const book = cnum(r, "book_value", "book", "recorded");
      const audited = cnum(r, "audited_value", "audited", "audit");
      const diff = book - audited;
      const taint = book > 0 ? diff / book : 0;
      const isLarge = book >= interval;
      const projected = isLarge ? diff : taint * interval;
      return { id: cell(r, "item", "id", "reference") || "item", book, audited, diff, taint, isLarge, projected };
    }).filter((x) => Math.abs(x.diff) > 0);
    const overs = items.filter((x) => x.diff > 0).sort((a, b) => b.taint - a.taint);
    const unders = items.filter((x) => x.diff < 0);
    const basicPrecision = rf * interval;
    const projectedOver = sum(overs.map((x) => x.projected));
    // Incremental allowance: the increments in the reliability factor applied to the ranked taints of sampled items below the interval.
    let incremental = 0;
    const ranked = overs.filter((x) => !x.isLarge);
    for (let k = 1; k <= ranked.length; k++) {
      const inc = rfAt(risk === "10" ? "10" : "5", k) - rfAt(risk === "10" ? "10" : "5", k - 1) - 1;
      incremental += Math.max(0, inc) * ranked[k - 1].taint * interval;
    }
    const uml = projectedOver + basicPrecision + incremental;
    const projectedUnder = sum(unders.map((x) => x.projected));
    const netProjected = projectedOver + projectedUnder;
    const pass = uml <= tol;
    return {
      title: "Monetary unit sampling",
      summary: `The sample is ${n} items with a ${fmt.moneyRaw(interval)} sampling interval. ${items.length ? `The ${items.length} difference${items.length === 1 ? "" : "s"} found project to ${fmt.moneyRaw(projectedOver)} of overstatement; with basic precision of ${fmt.moneyRaw(basicPrecision)} and an incremental allowance of ${fmt.moneyRaw(incremental)}, the upper misstatement limit is ${fmt.moneyRaw(uml)} against tolerable misstatement of ${fmt.moneyRaw(tol)}, so the population ${pass ? "is acceptable" : "cannot be accepted as recorded"}.` : `No misstatements have been entered, so the upper limit is basic precision of ${fmt.moneyRaw(basicPrecision)} against tolerable misstatement of ${fmt.moneyRaw(tol)}.`}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Sample size", value: String(n) },
          { label: "Sampling interval", value: fmt.moneyRaw(interval) },
          { label: "Projected misstatement", value: fmt.moneyRaw(projectedOver), delta: netProjected !== projectedOver ? `${fmt.moneyRaw(netProjected)} net of understatements` : undefined },
          { label: "Upper misstatement limit", value: fmt.moneyRaw(uml), tone: pass ? "pos" : "neg" },
          { label: "Tolerable misstatement", value: fmt.moneyRaw(tol) },
          { label: "Conclusion", value: pass ? "Accept" : "Do not accept", tone: pass ? "pos" : "neg" },
        ] },
        { type: "table", title: "Sizing", columns: ["Step", "Value", "Basis"], rows: [
          ["Recorded population", fmt.moneyRaw(pop), "As entered"],
          ["Reliability factor", rf.toFixed(2), `${risk}% risk of incorrect acceptance, zero expected overstatements`],
          ["Expansion factor", ef.toFixed(2), "Applied to expected misstatement"],
          ["Denominator", fmt.moneyRaw(denom), "Tolerable less expected times expansion factor"],
          ["Sample size", String(n), "Population times reliability factor, divided by the denominator"],
          ["Sampling interval", fmt.moneyRaw(interval), "Population divided by sample size"],
        ] },
        ...(items.length ? [{ type: "table" as const, title: "Misstatements found and projection", columns: ["Item", "Book", "Audited", "Difference", "Taint", "Treatment", "Projected"], rows: items.map((x) => [x.id, fmt.moneyRaw(x.book), fmt.moneyRaw(x.audited), fmt.moneyRaw(x.diff), fmt.pct(x.taint, 1), x.isLarge ? "Individually significant, known" : "Taint times interval", fmt.moneyRaw(x.projected)]), totals: ["Total", "", "", fmt.moneyRaw(sum(items.map((x) => x.diff))), "", "", fmt.moneyRaw(netProjected)] }] : []),
        { type: "waterfall", title: "Upper misstatement limit ($000s)", format: "num", steps: [
          { label: "Projected", value: projectedOver },
          { label: "Basic precision", value: basicPrecision },
          { label: "Incremental allowance", value: incremental },
          { label: "Upper limit", value: uml, total: true },
        ] },
        assumptions([["Risk of incorrect acceptance", `${risk}%`], ["Expected misstatement", fmt.moneyRaw(exp)], ["Items with a difference", String(items.length)], ["Individually significant items", String(items.filter((x) => x.isLarge).length)]]),
      ],
      caveats: ["Monetary unit sampling is designed for overstatement; understatements and zero or negative balances need a separate approach and are excluded from the projection above.", "Items at or above the sampling interval are examined in full, so their differences are known rather than projected.", "The incremental allowance uses the standard ranked-taint increments; firm templates differ slightly in how the increments are rounded."],
      nextSteps: ["Investigate each difference for cause before projecting", "If the upper limit exceeds tolerable, extend the sample or ask management to correct the known misstatements and re-evaluate"],
    };
  },
};

/** Four-column proof of cash tying bank activity to the books. */
const proofOfCash: ToolDef = {
  kind: "calc", id: "acc-proof-of-cash", title: "Proof of cash", tagline: "Four columns that tie bank activity to recorded receipts and disbursements.",
  description: "Builds the four-column proof of cash: beginning balance, receipts, disbursements and ending balance, reconciling the bank's activity to the books through deposits in transit, outstanding checks and bank-only items. Cross-foots in both directions and reports the unexplained difference, which is the number that matters.",
  roles: ["accountant"], specialties: [AUD, FRN, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "Banknote", savesMinutes: 50, tags: ["proof of cash", "reconciliation", "fraud"],
  fields: [
    { key: "bankBegin", label: "Bank balance, beginning", type: "number", unit: "$000s", required: true, default: 4820 },
    { key: "bankReceipts", label: "Bank deposits during the period", type: "number", unit: "$000s", required: true, default: 58400 },
    { key: "bankDisb", label: "Bank withdrawals during the period", type: "number", unit: "$000s", required: true, default: 57110 },
    { key: "bankEnd", label: "Bank balance, ending", type: "number", unit: "$000s", required: true, default: 6110 },
    { key: "ditBegin", label: "Deposits in transit, beginning", type: "number", unit: "$000s", default: 610 },
    { key: "ditEnd", label: "Deposits in transit, ending", type: "number", unit: "$000s", default: 845 },
    { key: "ocBegin", label: "Outstanding checks, beginning", type: "number", unit: "$000s", default: 1290 },
    { key: "ocEnd", label: "Outstanding checks, ending", type: "number", unit: "$000s", default: 1515 },
    { key: "bankFees", label: "Bank fees charged but not recorded", type: "number", unit: "$000s", default: 12 },
    { key: "interest", label: "Interest credited but not recorded", type: "number", unit: "$000s", default: 26 },
    { key: "nsf", label: "NSF items charged back", type: "number", unit: "$000s", default: 35 },
    { key: "bookBegin", label: "Book balance, beginning", type: "number", unit: "$000s", required: true, default: 4140 },
    { key: "bookReceipts", label: "Recorded receipts", type: "number", unit: "$000s", required: true, default: 58670 },
    { key: "bookDisb", label: "Recorded disbursements", type: "number", unit: "$000s", required: true, default: 57365 },
    { key: "bookEnd", label: "Book balance, ending", type: "number", unit: "$000s", required: true, default: 5445 },
  ],
  example: { bankBegin: 4820, bankReceipts: 58400, bankDisb: 57110, bankEnd: 6110, ditBegin: 610, ditEnd: 845, ocBegin: 1290, ocEnd: 1515, bankFees: 12, interest: 26, nsf: 35, bookBegin: 4140, bookReceipts: 58670, bookDisb: 57365, bookEnd: 5445 },
  compute: (i: Inputs): WorkflowOutput => {
    const n = (k: string) => num(i, k, 0);
    const bank = { begin: n("bankBegin"), rec: n("bankReceipts"), disb: n("bankDisb"), end: n("bankEnd") };
    const bankFoots = bank.begin + bank.rec - bank.disb - bank.end;
    const book = { begin: n("bookBegin"), rec: n("bookReceipts"), disb: n("bookDisb"), end: n("bookEnd") };
    const bookFoots = book.begin + book.rec - book.disb - book.end;
    const dit = { begin: n("ditBegin"), end: n("ditEnd") };
    const oc = { begin: n("ocBegin"), end: n("ocEnd") };
    const fees = n("bankFees"), interest = n("interest"), nsf = n("nsf");
    // Adjusted bank columns should equal the books.
    const adj = {
      begin: bank.begin + dit.begin - oc.begin,
      rec: bank.rec - dit.begin + dit.end - interest + nsf,
      disb: bank.disb - oc.begin + oc.end - fees + nsf,
      end: bank.end + dit.end - oc.end,
    };
    const diff = { begin: adj.begin - book.begin, rec: adj.rec - book.rec, disb: adj.disb - book.disb, end: adj.end - book.end };
    const adjFoots = adj.begin + adj.rec - adj.disb - adj.end;
    const clean = Math.abs(diff.begin) < 0.5 && Math.abs(diff.rec) < 0.5 && Math.abs(diff.disb) < 0.5 && Math.abs(diff.end) < 0.5;
    const row = (label: string, a: number, b: number, c: number, d: number) => [label, fmt.moneyRaw(a), fmt.moneyRaw(b), fmt.moneyRaw(c), fmt.moneyRaw(d)];
    return {
      title: "Proof of cash",
      summary: `${clean ? "The proof ties: adjusted bank activity equals the books in all four columns." : `The proof does not tie. Unexplained differences: beginning ${fmt.moneyRaw(diff.begin)}, receipts ${fmt.moneyRaw(diff.rec)}, disbursements ${fmt.moneyRaw(diff.disb)}, ending ${fmt.moneyRaw(diff.end)}.`} Bank columns cross-foot to ${fmt.moneyRaw(bankFoots)} and book columns to ${fmt.moneyRaw(bookFoots)}; both should be zero.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Unexplained difference, receipts", value: fmt.moneyRaw(diff.rec), tone: Math.abs(diff.rec) < 0.5 ? "pos" : "neg" },
          { label: "Unexplained difference, disbursements", value: fmt.moneyRaw(diff.disb), tone: Math.abs(diff.disb) < 0.5 ? "pos" : "neg" },
          { label: "Adjusted ending balance", value: fmt.moneyRaw(adj.end), delta: `book ${fmt.moneyRaw(book.end)}`, tone: Math.abs(diff.end) < 0.5 ? "pos" : "neg" },
          { label: "Bank columns cross-foot", value: fmt.moneyRaw(bankFoots), tone: Math.abs(bankFoots) < 0.5 ? "pos" : "warn" },
          { label: "Book columns cross-foot", value: fmt.moneyRaw(bookFoots), tone: Math.abs(bookFoots) < 0.5 ? "pos" : "warn" },
        ] },
        { type: "table", title: "Four-column proof of cash ($000s)", columns: ["Line", "Beginning balance", "Receipts", "Disbursements", "Ending balance"], rows: [
          row("Per bank", bank.begin, bank.rec, bank.disb, bank.end),
          row("Deposits in transit, beginning", dit.begin, -dit.begin, 0, 0),
          row("Deposits in transit, ending", 0, dit.end, 0, dit.end),
          row("Outstanding checks, beginning", -oc.begin, 0, -oc.begin, 0),
          row("Outstanding checks, ending", 0, 0, oc.end, -oc.end),
          row("Interest credited, unrecorded", 0, -interest, 0, 0),
          row("Bank fees charged, unrecorded", 0, 0, -fees, 0),
          row("NSF charged back", 0, nsf, nsf, 0),
          row("Adjusted bank", adj.begin, adj.rec, adj.disb, adj.end),
          row("Per books", book.begin, book.rec, book.disb, book.end),
          row("Unexplained difference", diff.begin, diff.rec, diff.disb, diff.end),
        ], emphasisRow: 10, note: `Adjusted columns cross-foot to ${fmt.moneyRaw(adjFoots)}; a non-zero value means an adjustment was entered in only one column.` },
        { type: clean ? "callout" : "callout", tone: clean ? "pos" : "neg", title: clean ? "Ties" : "Investigate", text: clean
          ? "Every column reconciles. Retain the bank statements, the cut-off statement and the outstanding check listing as support, and confirm the deposits in transit cleared in the subsequent period."
          : "A difference in the receipts or disbursements column, with a clean ending balance, is the classic signature of lapping or of a kited transfer. Trace the difference to individual items: compare the deposit dates on the bank statement to the receipt dates in the cash receipts journal, and test the subsequent clearing of every deposit in transit and outstanding check." },
        assumptions([["Period bank activity", `${fmt.moneyRaw(bank.rec)} in, ${fmt.moneyRaw(bank.disb)} out`], ["Deposits in transit", `${fmt.moneyRaw(dit.begin)} to ${fmt.moneyRaw(dit.end)}`], ["Outstanding checks", `${fmt.moneyRaw(oc.begin)} to ${fmt.moneyRaw(oc.end)}`], ["Bank-only items", `fees ${fmt.moneyRaw(fees)}, interest ${fmt.moneyRaw(interest)}, NSF ${fmt.moneyRaw(nsf)}`]]),
      ],
      caveats: ["The proof assumes one bank account for one period; run it per account and consolidate, since inter-account transfers are where kiting hides.", "Transfers between company accounts must be tested against both sides at the cut-off date.", "A clean proof of cash evidences completeness of recorded activity, not the validity of the disbursements themselves."],
    };
  },
};

/** Benford's law digit tests with chi-square and mean absolute deviation. */
const benfordTest: ToolDef = {
  kind: "calc", id: "acc-benford", title: "Benford's law digit test", tagline: "First-digit and first-two-digit conformity with chi-square and MAD.",
  description: "Runs the digit tests forensic accountants use on a population of amounts: observed versus expected first-digit frequencies, chi-square against the critical value, the mean absolute deviation with Nigrini's conformity bands, and the digits that deviate most, which is where to sample.",
  roles: ["accountant", "consultant"], specialties: [FRN, AUD, CTRL], category: "Accounting & audit", icon: "Radar", savesMinutes: 45, tags: ["Benford", "forensic", "fraud", "JE testing"],
  fields: [
    { key: "amounts", label: "Amounts", type: "csv", required: true, columns: "amount (one per row; other columns are ignored)", help: "Paste a column of amounts, or a CSV with an amount column" },
    { key: "test", label: "Test", type: "select", options: ["First digit", "First two digits"], default: "First digit" },
    { key: "minAbs", label: "Ignore amounts below", type: "number", unit: "$", default: 10 },
  ],
  example: { test: "First digit", minAbs: 10, amounts: "amount\n1842\n1290\n2450\n1120\n3480\n1975\n1630\n4950\n1288\n2140\n1055\n1490\n2995\n1075\n1340\n1899\n2450\n1290\n4999\n1145\n1620\n1480\n2870\n1935\n1044\n5000\n1290\n1750\n2400\n1188\n1490\n4980\n1230\n1650\n2995\n1420\n1080\n4950\n1330\n1720\n2560\n1290\n1145\n4999\n1670\n1250\n2880\n1390\n1490\n4975" },
  compute: (i: Inputs): WorkflowOutput => {
    const rows = records(str(i, "amounts"));
    const minAbs = num(i, "minAbs", 0);
    const twoDigit = str(i, "test", "First digit") === "First two digits";
    const values = rows.map((r) => Math.abs(cnum(r, "amount", "value", "debit", "amt", "total"))).filter((v) => Number.isFinite(v) && v >= minAbs && v > 0);
    if (values.length < 30) throw new Error(`Only ${values.length} usable amounts; the digit tests need at least 30 and are unreliable below a few hundred.`);
    const lead = (v: number): number => {
      const s = String(v).replace(/[^0-9]/g, "").replace(/^0+/, "");
      if (!s) return 0;
      return twoDigit ? Number(s.slice(0, 2).padEnd(2, "0")) : Number(s[0]);
    };
    const digits = twoDigit ? Array.from({ length: 90 }, (_, k) => k + 10) : [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const counts = new Map<number, number>(digits.map((d) => [d, 0]));
    let usable = 0;
    for (const v of values) { const d = lead(v); if (counts.has(d)) { counts.set(d, (counts.get(d) ?? 0) + 1); usable++; } }
    const stats = digits.map((d) => {
      const obs = counts.get(d) ?? 0;
      const expPct = benford(d);
      const expCount = expPct * usable;
      const obsPct = usable ? obs / usable : 0;
      const chi = expCount > 0 ? Math.pow(obs - expCount, 2) / expCount : 0;
      return { d, obs, obsPct, expPct, expCount, chi, dev: obsPct - expPct };
    });
    const chiTotal = sum(stats.map((s) => s.chi));
    const df = digits.length - 1;
    const critical = twoDigit ? 113.15 : 15.51; // 5% significance, 89 and 8 degrees of freedom
    const mad = sum(stats.map((s) => Math.abs(s.dev))) / digits.length;
    const madBand = twoDigit
      ? mad < 0.0012 ? "close conformity" : mad < 0.0018 ? "acceptable conformity" : mad < 0.0022 ? "marginally acceptable" : "nonconformity"
      : mad < 0.006 ? "close conformity" : mad < 0.012 ? "acceptable conformity" : mad < 0.015 ? "marginally acceptable" : "nonconformity";
    const worst = [...stats].sort((a, b) => Math.abs(b.dev) - Math.abs(a.dev)).slice(0, 5);
    const conforms = chiTotal <= critical;
    return {
      title: twoDigit ? "Benford's law, first two digits" : "Benford's law, first digit",
      summary: `${usable} amounts tested. Chi-square is ${chiTotal.toFixed(1)} against a critical value of ${critical} at ${df} degrees of freedom, so the population ${conforms ? "conforms" : "does not conform"} to the expected distribution. Mean absolute deviation of ${mad.toFixed(4)} indicates ${madBand}. The largest deviation is digit ${worst[0].d} at ${fmt.pct(worst[0].obsPct, 1)} observed against ${fmt.pct(worst[0].expPct, 1)} expected.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Amounts tested", value: usable.toLocaleString("en-US") },
          { label: "Chi-square", value: chiTotal.toFixed(1), delta: `critical ${critical}`, tone: conforms ? "pos" : "neg" },
          { label: "Mean absolute deviation", value: mad.toFixed(4), delta: madBand, tone: mad < 0.012 ? "pos" : mad < 0.015 ? "warn" : "neg" },
          { label: "Largest deviation", value: `digit ${worst[0].d}`, delta: `${fmt.pct(worst[0].dev, 1)} vs expected`, tone: "warn" },
        ] },
        { type: "bar", title: "Observed versus expected frequency", format: "pct", data: stats.filter((s) => !twoDigit || s.obs > 0).slice(0, 24).map((s) => ({ label: String(s.d), value: s.obsPct, note: `expected ${fmt.pct(s.expPct, 1)}`, emphasis: Math.abs(s.dev) > (twoDigit ? 0.004 : 0.02) })) },
        { type: "table", title: "Digit detail", columns: ["Digit", "Observed", "Observed %", "Expected %", "Deviation", "Chi-square contribution"], rows: stats.filter((s) => !twoDigit || s.obs > 0).map((s) => [String(s.d), String(s.obs), fmt.pct(s.obsPct, 1), fmt.pct(s.expPct, 1), fmt.pct(s.dev, 1), s.chi.toFixed(2)]), totals: ["Total", String(usable), "100%", "100%", "", chiTotal.toFixed(1)] },
        { type: "bullets", title: "Where to sample", items: worst.map((w) => `Digit ${w.d}: ${w.obs} items, ${fmt.pct(w.obsPct, 1)} observed against ${fmt.pct(w.expPct, 1)} expected, chi-square contribution ${w.chi.toFixed(1)}. Pull the items beginning with this digit and test authorization and support.`) },
        assumptions([["Test", twoDigit ? "First two digits" : "First digit"], ["Amounts excluded below", fmt.moneyRaw(minAbs)], ["Rows parsed", String(rows.length)], ["Usable amounts", String(usable)]]),
      ],
      caveats: ["Benford applies to populations that span several orders of magnitude and arise from natural processes. Assigned numbers, prices clustered at thresholds, amounts with built-in minimums or maximums, and small ranges will fail the test for innocent reasons.", "Nonconformity is a direction for sampling, not evidence of fraud. Conformity does not rule fraud out, since a large fraud can be a handful of items.", "The chi-square test is sensitive to population size: with tens of thousands of items almost any population will fail, which is why the mean absolute deviation bands are reported alongside."],
      nextSteps: ["Sample the flagged digits and test authorization, support and business purpose", "Run the second-order and last-two-digit tests on the same population for rounding and fabrication patterns"],
    };
  },
};

/* ======================================================================================
 * Calculators: technical accounting
 * ====================================================================================== */

/** ASC 606 relative standalone-selling-price allocation, with the discount and residual tests. */
const sspAllocation: ToolDef = {
  kind: "calc", id: "acc-ssp-allocation", title: "ASC 606 price allocation", tagline: "Relative standalone-selling-price allocation with the discount test.",
  description: "Allocates a transaction price across performance obligations on relative standalone selling price, shows the implicit discount and how it lands on each obligation, and tests whether the discount-allocation exception in ASC 606-10-32-37 or a residual approach under 32-34 would change the answer.",
  roles: ["accountant", "corpfin", "student"], specialties: [TECH, AUD, CTRL, ...X_REP], category: "Accounting & audit", icon: "Split", savesMinutes: 60, tags: ["ASC 606", "SSP", "allocation"],
  fields: [
    { key: "price", label: "Transaction price", type: "number", unit: "$000s", required: true, default: 3850 },
    { key: "obligations", label: "Performance obligations", type: "csv", required: true, columns: "obligation,ssp,ssp_method,timing", help: "One row per obligation; ssp is the standalone selling price" },
    { key: "exception", label: "Apply the discount-allocation exception", type: "toggle", default: false, help: "Only when the 606-10-32-37 criteria are met: regular standalone sales, observable bundle discounts, and the discount relates entirely to specific obligations" },
    { key: "exceptionTo", label: "Obligations the discount relates to", type: "text", placeholder: "Subscription, Support" },
  ],
  example: { price: 3850, obligations: "obligation,ssp,ssp_method,timing\nSubscription (3 years),3600,Observable renewal price,Over time - ratable\nImplementation,300,Expected cost plus margin,Over time - input measure\nRenewal discount material right,120,Adjusted market assessment,Point in time at renewal\nTraining days,80,Observable list price,Point in time as delivered", exception: false, exceptionTo: "" },
  compute: (i: Inputs): WorkflowOutput => {
    const price = num(i, "price");
    const rows = records(str(i, "obligations"));
    if (price <= 0) throw new Error("Enter a transaction price greater than zero.");
    const obs = rows.map((r) => {
      need(r, "obligation", "obligation", "po", "item");
      need(r, "ssp", "ssp", "standalone_selling_price", "standalone");
      return { name: cell(r, "obligation", "po", "item"), ssp: cnum(r, "ssp", "standalone_selling_price", "standalone"), method: cell(r, "ssp_method", "method") || "not stated", timing: cell(r, "timing", "recognition") || "not stated" };
    });
    const totalSsp = sum(obs.map((o) => o.ssp));
    if (totalSsp <= 0) throw new Error("Standalone selling prices must sum to more than zero.");
    const discount = totalSsp - price;
    const useException = i.exception === true;
    const targets = list(i, "exceptionTo").map((s) => s.toLowerCase());
    const targeted = obs.filter((o) => targets.some((t) => o.name.toLowerCase().includes(t)));
    const targetedSsp = sum(targeted.map((o) => o.ssp));
    const alloc = obs.map((o) => {
      const pro = (o.ssp / totalSsp) * price;
      let allocated = pro;
      if (useException && targeted.length > 0 && targetedSsp > 0) {
        allocated = targeted.includes(o) ? o.ssp - discount * (o.ssp / targetedSsp) : o.ssp;
      }
      return { ...o, pro, allocated, pct: o.ssp / totalSsp, implied: o.ssp > 0 ? allocated / o.ssp - 1 : 0 };
    });
    const allocTotal = sum(alloc.map((a) => a.allocated));
    const residual = price - sum(obs.slice(0, -1).map((o) => o.ssp));
    return {
      title: "ASC 606 price allocation",
      summary: `A transaction price of ${fmt.moneyRaw(price)} against standalone selling prices totalling ${fmt.moneyRaw(totalSsp)} carries a ${fmt.moneyRaw(discount)} discount, ${fmt.pct(discount / totalSsp, 1)} of standalone value. ${useException && targeted.length ? `Under the 32-37 exception the discount is allocated entirely to ${targeted.map((t) => t.name).join(" and ")}.` : "Allocated on relative standalone selling price, every obligation absorbs the discount proportionally."} Allocated amounts total ${fmt.moneyRaw(allocTotal)}, which must equal the transaction price.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Transaction price", value: fmt.moneyRaw(price) },
          { label: "Sum of standalone prices", value: fmt.moneyRaw(totalSsp) },
          { label: "Discount", value: fmt.moneyRaw(discount), delta: fmt.pct(discount / totalSsp, 1), tone: discount > 0 ? "warn" : "neutral" },
          { label: "Obligations", value: String(obs.length) },
          { label: "Allocation ties", value: Math.abs(allocTotal - price) < 0.5 ? "Yes" : fmt.moneyRaw(allocTotal - price), tone: Math.abs(allocTotal - price) < 0.5 ? "pos" : "neg" },
        ] },
        { type: "table", title: "Allocation", columns: ["Obligation", "SSP", "% of SSP", "Pro rata", "Allocated", "Implicit discount", "SSP method", "Timing"], rows: alloc.map((a) => [a.name, fmt.moneyRaw(a.ssp), fmt.pct(a.pct, 1), fmt.moneyRaw(a.pro), fmt.moneyRaw(a.allocated), fmt.pct(a.implied, 1), a.method, a.timing]), totals: ["Total", fmt.moneyRaw(totalSsp), "100%", fmt.moneyRaw(price), fmt.moneyRaw(allocTotal), "", "", ""] },
        { type: "bar", title: "Allocated transaction price", format: "num", data: alloc.map((a) => ({ label: a.name.slice(0, 18), value: a.allocated })) },
        { type: "table", title: "Alternative approaches", columns: ["Approach", "Result", "When it is available"], rows: [
          ["Relative standalone selling price", `${alloc.map((a) => `${a.name.slice(0, 14)} ${fmt.moneyRaw(a.pro)}`).join("; ")}`, "The default under 606-10-32-31; always available"],
          ["Discount-allocation exception", targeted.length ? `Discount of ${fmt.moneyRaw(discount)} to ${targeted.map((t) => t.name).join(", ")}` : "Not computed; name the obligations it relates to", "Only if all three criteria in 32-37 are met and documented"],
          ["Residual approach for the last obligation", fmt.moneyRaw(residual), "Only if the selling price is highly variable or uncertain (32-34); not a convenience"],
        ] },
        assumptions([["Transaction price", fmt.moneyRaw(price)], ["Exception applied", useException ? `Yes, to ${targets.join(", ") || "unnamed obligations"}` : "No"], ["Obligations", String(obs.length)]]),
      ],
      caveats: ["Standalone selling prices are inputs here; the estimate itself is the judgment that gets challenged, so document the method and the observable evidence for each.", "Variable consideration allocated to a specific obligation under 32-39 is excluded from this pro rata allocation and must be handled separately.", "A material right is measured at the standalone selling price of the option, which reflects the incremental discount and the likelihood of exercise."],
    };
  },
};

/** ASC 842 lease classification and the liability and right-of-use asset schedule. */
const leaseSchedule: ToolDef = {
  kind: "calc", id: "acc-lease-schedule", title: "ASC 842 lease schedule", tagline: "Classification, present value, and the liability and right-of-use rollforward.",
  description: "Classifies a lease against the five ASC 842-10-25-2 criteria, discounts the payment stream monthly at the incremental borrowing rate, and builds the lease liability and right-of-use asset schedule with the expense pattern each classification produces.",
  roles: ["accountant", "corpfin", "student"], specialties: [TECH, AUD, CTRL, ...X_CTRL], category: "Accounting & audit", icon: "Building", savesMinutes: 75, tags: ["ASC 842", "leases", "ROU asset", "IBR"],
  fields: [
    { key: "payment", label: "Monthly payment", type: "number", unit: "$", required: true, default: 42000 },
    { key: "months", label: "Lease term", type: "number", unit: "months", required: true, default: 84 },
    { key: "rate", label: "Incremental borrowing rate", type: "number", unit: "%", required: true, default: 7.2, step: 0.1 },
    { key: "escalation", label: "Annual escalation", type: "number", unit: "%", default: 3 },
    { key: "advance", label: "Payments at the beginning of the month", type: "toggle", default: true },
    { key: "incentive", label: "Lease incentive received", type: "number", unit: "$", default: 250000 },
    { key: "idc", label: "Initial direct costs", type: "number", unit: "$", default: 60000 },
    { key: "prepaid", label: "Prepaid rent at commencement", type: "number", unit: "$", default: 0 },
    { key: "fairValue", label: "Fair value of the asset", type: "number", unit: "$", default: 4200000 },
    { key: "economicLife", label: "Remaining economic life", type: "number", unit: "months", default: 300 },
    { key: "transfer", label: "Transfers ownership at the end", type: "toggle", default: false },
    { key: "purchase", label: "Purchase option reasonably certain of exercise", type: "toggle", default: false },
    { key: "specialized", label: "Specialized asset with no alternative use", type: "toggle", default: false },
  ],
  example: { payment: 42000, months: 84, rate: 7.2, escalation: 3, advance: true, incentive: 250000, idc: 60000, prepaid: 0, fairValue: 4200000, economicLife: 300, transfer: false, purchase: false, specialized: false },
  compute: (i: Inputs): WorkflowOutput => {
    const pmt = num(i, "payment"), months = Math.round(num(i, "months")), rate = num(i, "rate") / 100;
    const esc = num(i, "escalation", 0) / 100, advance = i.advance !== false;
    const incentive = num(i, "incentive", 0), idc = num(i, "idc", 0), prepaid = num(i, "prepaid", 0);
    const fv = num(i, "fairValue", 0), life = num(i, "economicLife", 0);
    if (pmt <= 0 || months <= 0) throw new Error("Enter a monthly payment and a lease term in months.");
    const payments = Array.from({ length: months }, (_, k) => pmt * Math.pow(1 + esc, Math.floor(k / 12)));
    const pv = pvMonthly(payments, rate, advance);
    const total = sum(payments);
    const rou = pv + idc + prepaid - incentive;
    const termPct = life > 0 ? months / life : 0;
    const pvPct = fv > 0 ? pv / fv : 0;
    const tests = [
      { name: "Transfer of ownership", met: i.transfer === true, cite: "842-10-25-2(a)", detail: i.transfer === true ? "Ownership transfers at the end of the term" : "No transfer" },
      { name: "Purchase option reasonably certain", met: i.purchase === true, cite: "842-10-25-2(b)", detail: i.purchase === true ? "Option is reasonably certain of exercise" : "No such option" },
      { name: "Term is a major part of remaining economic life", met: termPct >= 0.75, cite: "842-10-25-2(c)", detail: `${months} of ${life || "n/a"} months, ${fmt.pct(termPct, 0)} (75% is the customary line)` },
      { name: "Present value is substantially all of fair value", met: pvPct >= 0.9, cite: "842-10-25-2(d)", detail: `${fmt.moneyRaw(pv)} of ${fmt.moneyRaw(fv)}, ${fmt.pct(pvPct, 0)} (90% is the customary line)` },
      { name: "Specialized asset", met: i.specialized === true, cite: "842-10-25-2(e)", detail: i.specialized === true ? "No alternative use to the lessor at the end of the term" : "Asset has alternative use" },
    ];
    const finance = tests.some((t) => t.met);
    // Liability amortization, monthly.
    const r = rate / 12;
    let liab = pv;
    const sched: { m: number; opening: number; payment: number; interest: number; principal: number; closing: number }[] = [];
    for (let m = 1; m <= months; m++) {
      const p = payments[m - 1];
      const opening = liab;
      const interest = advance ? (opening - p) * r : opening * r;
      const principal = p - interest;
      liab = opening + interest - p;
      sched.push({ m, opening, payment: p, interest, principal, closing: Math.max(liab, 0) });
    }
    const totalInterest = sum(sched.map((s) => s.interest));
    const year1 = sched.slice(0, 12);
    const annual = Array.from({ length: Math.ceil(months / 12) }, (_, y) => {
      const slice = sched.slice(y * 12, y * 12 + 12);
      return { year: y + 1, payments: sum(slice.map((s) => s.payment)), interest: sum(slice.map((s) => s.interest)), principal: sum(slice.map((s) => s.principal)), closing: slice[slice.length - 1]?.closing ?? 0 };
    });
    const straightLine = (total - incentive + idc) / (months / 12);
    const financeYear1 = rou / (months / 12) + sum(year1.map((s) => s.interest));
    return {
      title: `ASC 842 lease schedule: ${finance ? "finance" : "operating"} lease`,
      summary: `Present value of ${months} payments at ${(rate * 100).toFixed(2)}% is ${fmt.moneyRaw(pv)}, and the right-of-use asset is ${fmt.moneyRaw(rou)} after ${fmt.moneyRaw(idc)} of initial direct costs and ${fmt.moneyRaw(incentive)} of incentives. The lease is a ${finance ? "finance" : "operating"} lease because ${finance ? `${tests.filter((t) => t.met).map((t) => t.cite).join(" and ")} ${tests.filter((t) => t.met).length > 1 ? "are" : "is"} met` : "none of the five criteria in 842-10-25-2 are met"}. Total payments are ${fmt.moneyRaw(total)}, of which ${fmt.moneyRaw(totalInterest)} is interest.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Lease liability", value: fmt.moneyRaw(pv) },
          { label: "Right-of-use asset", value: fmt.moneyRaw(rou) },
          { label: "Classification", value: finance ? "Finance" : "Operating", tone: finance ? "warn" : "neutral" },
          { label: "Total payments", value: fmt.moneyRaw(total) },
          { label: "Total interest", value: fmt.moneyRaw(totalInterest) },
          { label: "Year 1 expense", value: fmt.moneyRaw(finance ? financeYear1 : straightLine), delta: finance ? "amortization plus interest" : "single straight-line cost" },
        ] },
        { type: "table", title: "Classification tests (ASC 842-10-25-2)", columns: ["Criterion", "Met", "Basis", "Cite"], rows: tests.map((t) => [t.name, t.met ? "Yes" : "No", t.detail, t.cite]) },
        { type: "table", title: "Annual liability rollforward", columns: ["Year", "Payments", "Interest", "Principal", "Closing liability"], rows: annual.map((a) => [`Year ${a.year}`, fmt.moneyRaw(a.payments), fmt.moneyRaw(a.interest), fmt.moneyRaw(a.principal), fmt.moneyRaw(a.closing)]), totals: ["Total", fmt.moneyRaw(total), fmt.moneyRaw(totalInterest), fmt.moneyRaw(pv), fmt.moneyRaw(0)] },
        { type: "line", title: "Lease liability and cumulative interest", format: "num", series: [
          { name: "Liability", points: annual.map((a) => ({ x: `Y${a.year}`, y: a.closing })) },
          { name: "Cumulative interest", points: annual.map((a, k) => ({ x: `Y${a.year}`, y: sum(annual.slice(0, k + 1).map((z) => z.interest)) })) },
        ] },
        { type: "table", title: "First twelve months", columns: ["Month", "Opening", "Payment", "Interest", "Principal", "Closing"], rows: year1.map((s) => [String(s.m), fmt.moneyRaw(s.opening), fmt.moneyRaw(s.payment), fmt.moneyRaw(s.interest), fmt.moneyRaw(s.principal), fmt.moneyRaw(s.closing)]) },
        { type: "callout", tone: "info", title: finance ? "Finance lease expense pattern" : "Operating lease expense pattern", text: finance
          ? "Amortize the right-of-use asset straight line over the shorter of the lease term and the useful life, and recognize interest on the liability separately. Expense is front-loaded, and both the amortization and the interest appear in operating and financing cash flows respectively."
          : "Recognize a single straight-line lease cost equal to total payments less incentives plus initial direct costs, divided over the term. The liability still unwinds at the discount rate, so the right-of-use asset amortization is the plug that keeps total cost level." },
        assumptions([["Payment", `${fmt.moneyRaw(pmt)} per month, ${advance ? "in advance" : "in arrears"}`], ["Escalation", `${(esc * 100).toFixed(1)}% a year`], ["Discount rate", `${(rate * 100).toFixed(2)}% annual, discounted monthly`], ["Term", `${months} months`], ["Incentive and initial direct costs", `${fmt.moneyRaw(incentive)} and ${fmt.moneyRaw(idc)}`]]),
      ],
      caveats: ["The term must include renewal or termination options only when exercise is reasonably certain; changing that judgment changes both the classification tests and the liability.", "The 75% and 90% thresholds are customary bright lines carried over from ASC 840, not requirements of ASC 842, which uses 'major part' and 'substantially all'.", "Variable payments that depend on usage or performance are excluded from the liability and expensed as incurred; only in-substance fixed payments belong above."],
    };
  },
};

/** ASC 740 effective tax rate reconciliation from statutory to reported. */
const rateRec: ToolDef = {
  kind: "calc", id: "acc-rate-reconciliation", title: "ASC 740 rate reconciliation", tagline: "Statutory to effective rate, in dollars and percentage points.",
  description: "Builds the effective tax rate reconciliation: the statutory provision, state taxes net of federal benefit, permanent differences, credits, stock compensation windfalls and shortfalls, valuation allowance movement and uncertain tax positions, arriving at the reported provision and the effective rate with each item's rate impact.",
  roles: ["accountant", "corpfin"], specialties: [TAX, TECH, CTRL, ...X_REP], category: "Tax", icon: "Percent", savesMinutes: 70, tags: ["ASC 740", "ETR", "rate rec", "provision"],
  fields: [
    { key: "pretax", label: "Pre-tax book income", type: "number", unit: "$000s", required: true, default: 184000 },
    { key: "statutory", label: "Federal statutory rate", type: "number", unit: "%", default: 21 },
    { key: "stateRate", label: "State rate, net of federal benefit", type: "number", unit: "%", default: 4.2, step: 0.1 },
    { key: "items", label: "Reconciling items", type: "csv", columns: "item,amount,basis", help: "amount is the tax effect in the same units as pre-tax income; basis is 'tax effect' or 'permanent difference'" },
    { key: "foreignRateDiff", label: "Foreign rate differential", type: "number", unit: "$000s", default: -6200 },
    { key: "credits", label: "Research and other credits", type: "number", unit: "$000s", default: -8400 },
    { key: "stockComp", label: "Stock compensation windfall (negative) or shortfall", type: "number", unit: "$000s", default: -5100 },
    { key: "vaChange", label: "Valuation allowance movement", type: "number", unit: "$000s", default: 2300 },
    { key: "utp", label: "Uncertain tax positions, net", type: "number", unit: "$000s", default: 1400 },
  ],
  example: { pretax: 184000, statutory: 21, stateRate: 4.2, foreignRateDiff: -6200, credits: -8400, stockComp: -5100, vaChange: 2300, utp: 1400, items: "item,amount,basis\nNon-deductible executive compensation (162(m)),1850,tax effect\nMeals and entertainment,240,tax effect\nGILTI inclusion,3100,tax effect\nFDII benefit,-2650,tax effect\nTax-exempt interest,-180,tax effect" },
  compute: (i: Inputs): WorkflowOutput => {
    const pretax = num(i, "pretax");
    if (!pretax) throw new Error("Enter pre-tax book income.");
    const stat = num(i, "statutory", 21) / 100;
    const federal = pretax * stat;
    const state = pretax * (num(i, "stateRate", 0) / 100);
    const extra = str(i, "items") ? records(str(i, "items")).map((r) => ({ name: cell(r, "item", "description") || "item", amount: cnum(r, "amount", "tax_effect", "effect"), basis: cell(r, "basis", "type") || "tax effect" })) : [];
    const lines = [
      { name: `Federal at ${(stat * 100).toFixed(0)}%`, amount: federal, fixed: true },
      { name: "State, net of federal benefit", amount: state, fixed: false },
      { name: "Foreign rate differential", amount: num(i, "foreignRateDiff", 0), fixed: false },
      ...extra.map((e) => ({ name: e.name, amount: e.amount, fixed: false })),
      { name: "Credits", amount: num(i, "credits", 0), fixed: false },
      { name: "Stock compensation", amount: num(i, "stockComp", 0), fixed: false },
      { name: "Valuation allowance", amount: num(i, "vaChange", 0), fixed: false },
      { name: "Uncertain tax positions", amount: num(i, "utp", 0), fixed: false },
    ];
    const provision = sum(lines.map((l) => l.amount));
    const etr = provision / pretax;
    const rows = lines.map((l) => [l.name, fmt.moneyRaw(l.amount), fmt.pct(l.amount / pretax, 1)]);
    const disclosureThreshold = Math.abs(pretax * 0.05 * stat);
    const disclosed = lines.filter((l) => !l.fixed && Math.abs(l.amount) >= Math.abs(pretax * 0.05));
    return {
      title: "ASC 740 rate reconciliation",
      summary: `The provision is ${fmt.moneyRaw(provision)} on pre-tax income of ${fmt.moneyRaw(pretax)}, an effective rate of ${fmt.pct(etr, 1)} against the ${(stat * 100).toFixed(0)}% statutory rate. The largest reconciling items are ${[...lines].filter((l) => !l.fixed).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount)).slice(0, 3).map((l) => `${l.name.toLowerCase()} at ${fmt.pct(l.amount / pretax, 1)}`).join(", ")}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Provision", value: fmt.moneyRaw(provision) },
          { label: "Effective tax rate", value: fmt.pct(etr, 1), tone: etr < stat ? "pos" : "warn" },
          { label: "Statutory rate", value: fmt.pct(stat, 0) },
          { label: "Difference", value: fmt.pct(etr - stat, 1), delta: fmt.moneyRaw(provision - federal) },
          { label: "Items at or above 5% of pre-tax income", value: String(disclosed.length), hint: "ASU 2023-09 requires separate disclosure at this threshold" },
        ] },
        { type: "table", title: "Rate reconciliation", columns: ["Item", "Tax effect", "Rate impact"], rows: [...rows, ["Total provision", fmt.moneyRaw(provision), fmt.pct(etr, 1)]], emphasisRow: rows.length },
        { type: "waterfall", title: "Statutory to reported provision ($000s)", format: "num", steps: [
          { label: "Federal statutory", value: federal, total: true },
          ...lines.filter((l) => !l.fixed && Math.abs(l.amount) > 0).map((l) => ({ label: l.name.slice(0, 16), value: l.amount })),
          { label: "Reported", value: provision, total: true },
        ] },
        { type: "bar", title: "Rate impact by item", format: "pct", data: lines.filter((l) => !l.fixed).map((l) => ({ label: l.name.slice(0, 18), value: l.amount / pretax, emphasis: Math.abs(l.amount) >= Math.abs(pretax * 0.05) })) },
        { type: "checklist", title: "ASU 2023-09 disclosure", items: [
          { text: "Eight prescribed categories disaggregated: state and local, foreign, effect of cross-border tax laws, enacted law changes, tax credits, valuation allowances, nontaxable or nondeductible items, and changes in unrecognized tax benefits", done: extra.length > 0 },
          { text: `Separate presentation of any item at or above 5% of pre-tax income times the statutory rate (${fmt.moneyRaw(disclosureThreshold)})`, done: disclosed.length > 0 },
          { text: "Income taxes paid, net of refunds, disaggregated by federal, state and foreign, and by individual jurisdiction at or above 5% of the total", done: false },
          { text: "State and foreign reconciling items disaggregated by jurisdiction where material", done: false },
        ] },
        assumptions([["Pre-tax income", fmt.moneyRaw(pretax)], ["Statutory rate", fmt.pct(stat, 0)], ["State rate, net", `${num(i, "stateRate", 0).toFixed(2)}%`], ["Additional items entered", String(extra.length)]]),
      ],
      caveats: ["Amounts are tax effects, not book differences; a permanent difference must be multiplied by the applicable rate before it enters the reconciliation.", "The interim rate is computed on forecast annual income with discrete items recognized in the period, so an annual reconciliation will not match a quarterly one.", "Valuation allowance and uncertain tax position movements often need their own rollforwards for disclosure."],
    };
  },
};

/** Basic and diluted earnings per share with the treasury stock and if-converted methods. */
const epsCalc: ToolDef = {
  kind: "calc", id: "acc-eps", title: "Basic and diluted EPS", tagline: "Treasury stock method, if-converted, and the antidilution ordering.",
  description: "Computes basic earnings per share, then tests each potentially dilutive instrument in order of its incremental effect: options and warrants under the treasury stock method, unvested restricted stock, and convertible instruments under the if-converted method, including only those that are dilutive.",
  roles: ["accountant", "corpfin", "student", "banker"], specialties: [TECH, CTRL, ...X_REP], category: "Accounting & audit", icon: "Layers", savesMinutes: 50, tags: ["EPS", "treasury stock method", "if-converted", "ASC 260"],
  fields: [
    { key: "netIncome", label: "Net income", type: "number", unit: "$000s", required: true, default: 96400 },
    { key: "preferred", label: "Preferred dividends declared", type: "number", unit: "$000s", default: 2400 },
    { key: "basicShares", label: "Weighted average shares, basic", type: "number", unit: "000s", required: true, default: 84000 },
    { key: "avgPrice", label: "Average market price", type: "number", unit: "$", required: true, default: 62.5 },
    { key: "options", label: "Options and warrants", type: "csv", columns: "grant,shares,strike", help: "Shares in thousands; each tranche on its own row" },
    { key: "rsu", label: "Unvested restricted stock units", type: "number", unit: "000s", default: 1450 },
    { key: "convPrincipal", label: "Convertible principal", type: "number", unit: "$000s", default: 300000 },
    { key: "convRate", label: "Convertible coupon", type: "number", unit: "%", default: 2.5, step: 0.1 },
    { key: "convShares", label: "Shares on conversion", type: "number", unit: "000s", default: 4200 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 24 },
  ],
  example: { netIncome: 96400, preferred: 2400, basicShares: 84000, avgPrice: 62.5, rsu: 1450, convPrincipal: 300000, convRate: 2.5, convShares: 4200, taxRate: 24, options: "grant,shares,strike\n2022 grant,2600,38.40\n2023 grant,1900,51.20\n2024 grant,1500,67.80\n2025 grant,900,74.10" },
  compute: (i: Inputs): WorkflowOutput => {
    const ni = num(i, "netIncome"), pref = num(i, "preferred", 0), basicShares = num(i, "basicShares");
    const price = num(i, "avgPrice"), tax = num(i, "taxRate", 0) / 100;
    if (!basicShares || !price) throw new Error("Enter weighted average basic shares and the average market price.");
    const available = ni - pref;
    const basic = available / basicShares;
    const opts = str(i, "options") ? records(str(i, "options")).map((r) => {
      const shares = cnum(r, "shares", "count", "options");
      const strike = cnum(r, "strike", "exercise_price", "price");
      const proceeds = shares * strike;
      const repurchased = price > 0 ? proceeds / price : 0;
      const incremental = Math.max(0, shares - repurchased);
      return { name: cell(r, "grant", "tranche", "name") || "grant", shares, strike, proceeds, repurchased, incremental, inTheMoney: strike < price };
    }) : [];
    const optionShares = sum(opts.filter((o) => o.inTheMoney).map((o) => o.incremental));
    const rsu = num(i, "rsu", 0);
    const convPrincipal = num(i, "convPrincipal", 0), convRate = num(i, "convRate", 0) / 100, convShares = num(i, "convShares", 0);
    const afterTaxInterest = convPrincipal * convRate * (1 - tax);
    const candidates = [
      { name: "Options and warrants (treasury stock method)", numerator: 0, shares: optionShares },
      { name: "Unvested restricted stock units", numerator: 0, shares: rsu },
      { name: "Convertible notes (if-converted)", numerator: afterTaxInterest, shares: convShares },
    ].filter((c) => c.shares > 0);
    const ranked = [...candidates].sort((a, b) => (a.shares ? a.numerator / a.shares : 0) - (b.shares ? b.numerator / b.shares : 0));
    let num0 = available, den = basicShares, prev = basic;
    const steps: { name: string; eps: number; dilutive: boolean; numerator: number; shares: number }[] = [];
    for (const c of ranked) {
      const eps = (num0 + c.numerator) / (den + c.shares);
      const dilutive = eps < prev;
      if (dilutive) { num0 += c.numerator; den += c.shares; prev = eps; }
      steps.push({ name: c.name, eps, dilutive, numerator: c.numerator, shares: c.shares });
    }
    const diluted = prev;
    const dilution = basic > 0 ? diluted / basic - 1 : 0;
    return {
      title: "Basic and diluted EPS",
      summary: `Basic earnings per share is ${fmt.moneyRaw(basic, 2)} on ${fmt.num(basicShares, 0)} thousand weighted average shares. Diluted is ${fmt.moneyRaw(diluted, 2)} on ${fmt.num(den, 0)} thousand shares, ${fmt.pct(Math.abs(dilution), 1)} of dilution. ${steps.filter((s) => !s.dilutive).length ? `${steps.filter((s) => !s.dilutive).map((s) => s.name.split(" (")[0]).join(" and ")} ${steps.filter((s) => !s.dilutive).length > 1 ? "were" : "was"} antidilutive and excluded.` : "Every instrument tested was dilutive."}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Basic EPS", value: fmt.moneyRaw(basic, 2) },
          { label: "Diluted EPS", value: fmt.moneyRaw(diluted, 2), delta: fmt.pct(dilution, 1), tone: "neg" },
          { label: "Income available to common", value: fmt.moneyRaw(available) },
          { label: "Basic shares", value: fmt.num(basicShares, 0) },
          { label: "Diluted shares", value: fmt.num(den, 0), delta: `+${fmt.num(den - basicShares, 0)}` },
        ] },
        ...(opts.length ? [{ type: "table" as const, title: "Treasury stock method by tranche (shares in thousands)", columns: ["Grant", "Shares", "Strike", "In the money", "Proceeds", "Shares repurchased", "Incremental shares"], rows: opts.map((o) => [o.name, fmt.num(o.shares, 0), fmt.moneyRaw(o.strike, 2), o.inTheMoney ? "Yes" : "No, excluded", fmt.moneyRaw(o.proceeds), fmt.num(o.repurchased, 0), o.inTheMoney ? fmt.num(o.incremental, 0) : "0"]), totals: ["Total", fmt.num(sum(opts.map((o) => o.shares)), 0), "", "", "", "", fmt.num(optionShares, 0)] }] : []),
        { type: "table", title: "Dilution sequence, most dilutive first", columns: ["Instrument", "Numerator effect", "Share effect", "EPS after inclusion", "Included"], rows: steps.map((s) => [s.name, fmt.moneyRaw(s.numerator), fmt.num(s.shares, 0), fmt.moneyRaw(s.eps, 3), s.dilutive ? "Yes" : "No, antidilutive"]) },
        { type: "waterfall", title: "Basic to diluted shares (thousands)", format: "num", steps: [
          { label: "Basic", value: basicShares, total: true },
          ...steps.filter((s) => s.dilutive).map((s) => ({ label: s.name.split(" (")[0].slice(0, 16), value: s.shares })),
          { label: "Diluted", value: den, total: true },
        ] },
        assumptions([["Net income", fmt.moneyRaw(ni)], ["Preferred dividends", fmt.moneyRaw(pref)], ["Average market price", fmt.moneyRaw(price, 2)], ["Convertible", `${fmt.moneyRaw(convPrincipal)} at ${(convRate * 100).toFixed(2)}%, ${fmt.num(convShares, 0)} thousand shares`], ["Tax rate", fmt.pct(tax, 0)]]),
      ],
      caveats: ["Instruments are tested in order of incremental effect, as ASC 260-10-45-30 requires; testing them in a different order can produce a different diluted figure.", "The average market price should be a simple average of weekly or monthly closing prices over the period, not the period-end price.", "Convertible instruments accounted for under the cash conversion or the 2020-06 single-instrument model may require the if-converted method regardless of settlement intent; the numerator add-back above assumes coupon interest only, with no amortization of discount."],
    };
  },
};

/* ======================================================================================
 * Calculators: valuation and tax attributes
 * ====================================================================================== */

/** Relief-from-royalty intangible value with the tax amortization benefit. */
const reliefFromRoyalty: ToolDef = {
  kind: "calc", id: "acc-relief-from-royalty", title: "Relief from royalty", tagline: "Trademark or technology value from avoided royalties, with the tax amortization benefit.",
  description: "Values an intangible asset by the royalty a licensee would have paid: royalty savings on the forecast revenue attributable to the asset, taxed and discounted with a mid-year convention, plus the tax amortization benefit a buyer receives from stepping the asset up over fifteen years.",
  roles: ["accountant", "consultant", "pe"], specialties: [VAL, TECH, FDD, ...X_VAL], category: "Valuation", icon: "BadgeDollarSign", savesMinutes: 90, tags: ["ASC 805", "relief from royalty", "intangibles", "TAB"],
  fields: [
    { key: "revenue", label: "Attributable revenue by year", type: "csv", required: true, columns: "year,revenue", help: "Revenue the asset supports, one row per forecast year" },
    { key: "royalty", label: "Royalty rate", type: "number", unit: "% of revenue", required: true, default: 4, step: 0.25 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 24 },
    { key: "discount", label: "Discount rate", type: "number", unit: "%", required: true, default: 13 },
    { key: "terminalGrowth", label: "Growth after the forecast", type: "number", unit: "%", default: 2, help: "Set to zero for a finite-lived asset that is not renewed" },
    { key: "life", label: "Remaining useful life", type: "select", options: ["Indefinite (terminal value)", "Finite (forecast only)"], default: "Indefinite (terminal value)" },
    { key: "amortYears", label: "Tax amortization period", type: "number", unit: "years", default: 15 },
  ],
  example: { revenue: "year,revenue\n2027,420000\n2028,462000\n2029,499000\n2030,529000\n2031,556000", royalty: 4, taxRate: 24, discount: 13, terminalGrowth: 2, life: "Indefinite (terminal value)", amortYears: 15 },
  compute: (i: Inputs): WorkflowOutput => {
    const rows = records(str(i, "revenue"));
    const royalty = num(i, "royalty") / 100, tax = num(i, "taxRate", 0) / 100, r = num(i, "discount") / 100, g = num(i, "terminalGrowth", 0) / 100;
    const amortYears = Math.max(1, Math.round(num(i, "amortYears", 15)));
    if (royalty <= 0 || r <= 0) throw new Error("Enter a royalty rate and a discount rate greater than zero.");
    if (r <= g) throw new Error("The discount rate must exceed the growth rate after the forecast.");
    const years = rows.map((row, k) => {
      need(row, "revenue", "revenue", "sales", "attributable_revenue");
      const rev = cnum(row, "revenue", "sales", "attributable_revenue");
      const gross = rev * royalty;
      const net = gross * (1 - tax);
      const df = 1 / Math.pow(1 + r, k + 0.5);
      return { label: cell(row, "year", "period") || `Y${k + 1}`, rev, gross, net, df, pv: net * df };
    });
    if (!years.length) throw new Error("Paste at least one forecast year.");
    const pvForecast = sum(years.map((y) => y.pv));
    const last = years[years.length - 1];
    const indefinite = str(i, "life", "Indefinite (terminal value)").startsWith("Indefinite");
    const terminalValue = indefinite ? (last.net * (1 + g)) / (r - g) : 0;
    const pvTerminal = indefinite ? terminalValue / Math.pow(1 + r, years.length) : 0;
    const preTab = pvForecast + pvTerminal;
    const annuity = Array.from({ length: amortYears }, (_, k) => 1 / Math.pow(1 + r, k + 0.5)).reduce((a, b) => a + b, 0);
    const tabFactor = 1 - (tax * annuity) / amortYears;
    if (tabFactor <= 0) throw new Error("The tax amortization benefit is not solvable at this discount rate and tax rate.");
    const value = preTab / tabFactor;
    const tab = value - preTab;
    return {
      title: "Relief from royalty",
      summary: `Avoided royalties of ${fmt.moneyRaw(years[0].gross)} in the first year, taxed at ${fmt.pct(tax, 0)} and discounted at ${fmt.pct(r, 0)}, give a value of ${fmt.moneyRaw(preTab)} before the tax amortization benefit and ${fmt.moneyRaw(value)} after. The benefit is worth ${fmt.moneyRaw(tab)}, ${fmt.pct(tab / value, 0)} of the concluded value.${indefinite ? ` The terminal value contributes ${fmt.pct(pvTerminal / preTab, 0)} of the pre-benefit value, so the royalty rate and the growth assumption carry the answer.` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Concluded fair value", value: fmt.moneyRaw(value) },
          { label: "Before tax amortization benefit", value: fmt.moneyRaw(preTab) },
          { label: "Tax amortization benefit", value: fmt.moneyRaw(tab), delta: fmt.pct(tab / value, 0) },
          { label: "Royalty rate", value: fmt.pct(royalty, 2) },
          { label: "Discount rate", value: fmt.pct(r, 1) },
          { label: "Terminal share", value: indefinite ? fmt.pct(pvTerminal / preTab, 0) : "n/a", tone: indefinite && pvTerminal / preTab > 0.6 ? "warn" : "neutral" },
        ] },
        { type: "table", title: "Royalty savings", columns: ["Year", "Attributable revenue", "Gross royalty", "After tax", "Discount factor", "Present value"], rows: years.map((y) => [y.label, fmt.moneyRaw(y.rev), fmt.moneyRaw(y.gross), fmt.moneyRaw(y.net), y.df.toFixed(3), fmt.moneyRaw(y.pv)]), totals: ["Forecast total", fmt.moneyRaw(sum(years.map((y) => y.rev))), fmt.moneyRaw(sum(years.map((y) => y.gross))), fmt.moneyRaw(sum(years.map((y) => y.net))), "", fmt.moneyRaw(pvForecast)] },
        { type: "waterfall", title: "Value build", format: "num", steps: [
          { label: "PV of forecast", value: pvForecast },
          ...(indefinite ? [{ label: "PV of terminal", value: pvTerminal }] : []),
          { label: "Before benefit", value: preTab, total: true },
          { label: "Tax amortization benefit", value: tab },
          { label: "Fair value", value: value, total: true },
        ] },
        { type: "sensitivity", title: "Fair value: royalty rate against discount rate", rowLabel: "Royalty rate", colLabel: "Discount rate",
          rows: [royalty - 0.01, royalty - 0.005, royalty, royalty + 0.005, royalty + 0.01].map((x) => fmt.pct(x, 2)),
          cols: [r - 0.02, r - 0.01, r, r + 0.01, r + 0.02].map((x) => fmt.pct(x, 0)),
          values: [royalty - 0.01, royalty - 0.005, royalty, royalty + 0.005, royalty + 0.01].map((ry) =>
            [r - 0.02, r - 0.01, r, r + 0.01, r + 0.02].map((rr) => {
              if (rr <= g || ry <= 0) return null;
              const pvF = years.reduce((a, y, k) => a + y.rev * ry * (1 - tax) / Math.pow(1 + rr, k + 0.5), 0);
              const lastNet = last.rev * ry * (1 - tax);
              const pvT = indefinite ? (lastNet * (1 + g)) / (rr - g) / Math.pow(1 + rr, years.length) : 0;
              const ann = Array.from({ length: amortYears }, (_, k) => 1 / Math.pow(1 + rr, k + 0.5)).reduce((a, b) => a + b, 0);
              const f = 1 - (tax * ann) / amortYears;
              return f > 0 ? (pvF + pvT) / f : null;
            })),
          format: "num", baseRow: 2, baseCol: 2 },
        assumptions([["Royalty rate", fmt.pct(royalty, 2)], ["Tax rate", fmt.pct(tax, 0)], ["Discount rate", fmt.pct(r, 1)], ["Life", indefinite ? `Indefinite, ${fmt.pct(g, 1)} growth after the forecast` : "Finite, forecast only"], ["Tax amortization period", `${amortYears} years`], ["Convention", "Mid-year discounting"]]),
      ],
      caveats: ["The royalty rate is the judgment that drives the answer; support it with observed license agreements for comparable assets and a profit-split cross-check, not with a rule of thumb.", "Attributable revenue must exclude revenue the asset does not support, and must be consistent with the contributory asset charges used elsewhere in the purchase price allocation.", "The tax amortization benefit assumes the buyer obtains a step-up; in a stock purchase with no election there is none, and the value concluded should be stated before the benefit."],
    };
  },
};

/** ASC 350 single-step goodwill impairment test with a weighted fair value. */
const goodwillImpairment: ToolDef = {
  kind: "calc", id: "acc-goodwill-impairment", title: "Goodwill impairment test", tagline: "Reporting-unit fair value against carrying amount, with the charge and the headroom.",
  description: "Runs the ASC 350 quantitative test: weights an income-approach and a market-approach fair value for the reporting unit, compares it with the carrying amount including goodwill, and measures the impairment charge, capped at the goodwill balance. Reports headroom and the fair value decline that would trigger a charge.",
  roles: ["accountant", "corpfin", "consultant"], specialties: [TECH, VAL, AUD, ...X_VAL], category: "Valuation", icon: "TrendingDown", savesMinutes: 80, tags: ["ASC 350", "goodwill", "impairment", "headroom"],
  fields: [
    { key: "carrying", label: "Carrying amount of the reporting unit", type: "number", unit: "$000s", required: true, default: 940000 },
    { key: "goodwill", label: "Goodwill allocated to the unit", type: "number", unit: "$000s", required: true, default: 310000 },
    { key: "dcf", label: "Income approach fair value", type: "number", unit: "$000s", required: true, default: 880000 },
    { key: "market", label: "Market approach fair value", type: "number", unit: "$000s", default: 820000 },
    { key: "weightDcf", label: "Weight on the income approach", type: "number", unit: "%", default: 70 },
    { key: "control", label: "Control premium applied to the market approach", type: "number", unit: "%", default: 15 },
    { key: "marketCapCheck", label: "Market capitalization of the whole entity", type: "number", unit: "$000s", default: 1650000, help: "Used for the reconciliation the SEC staff asks for" },
    { key: "otherUnits", label: "Fair value of the other reporting units", type: "number", unit: "$000s", default: 900000 },
  ],
  example: { carrying: 940000, goodwill: 310000, dcf: 880000, market: 820000, weightDcf: 70, control: 15, marketCapCheck: 1650000, otherUnits: 900000 },
  compute: (i: Inputs): WorkflowOutput => {
    const carrying = num(i, "carrying"), goodwill = num(i, "goodwill");
    const dcf = num(i, "dcf"), market = num(i, "market", 0), wDcf = num(i, "weightDcf", 70) / 100;
    const control = num(i, "control", 0) / 100;
    if (carrying <= 0 || goodwill < 0) throw new Error("Enter a carrying amount greater than zero and a goodwill balance.");
    const marketWithPremium = market * (1 + control);
    const fv = market > 0 ? dcf * wDcf + marketWithPremium * (1 - wDcf) : dcf;
    const excess = carrying - fv;
    const impairment = Math.max(0, Math.min(goodwill, excess));
    const headroom = fv / carrying - 1;
    const triggerDecline = fv > 0 ? 1 - carrying / fv : 0;
    const entityFv = fv + num(i, "otherUnits", 0);
    const cap = num(i, "marketCapCheck", 0);
    const reconciliation = cap > 0 ? entityFv / cap - 1 : 0;
    return {
      title: "Goodwill impairment test",
      summary: impairment > 0
        ? `Fair value of ${fmt.moneyRaw(fv)} is below the carrying amount of ${fmt.moneyRaw(carrying)} by ${fmt.moneyRaw(excess)}, so the reporting unit is impaired. The charge is ${fmt.moneyRaw(impairment)}, ${excess > goodwill ? "limited to the goodwill balance" : "the full excess"}, leaving ${fmt.moneyRaw(goodwill - impairment)} of goodwill.`
        : `Fair value of ${fmt.moneyRaw(fv)} exceeds the carrying amount of ${fmt.moneyRaw(carrying)} by ${fmt.moneyRaw(-excess)}, headroom of ${fmt.pct(headroom, 1)}. No impairment. Fair value would have to fall ${fmt.pct(Math.abs(triggerDecline), 1)} before a charge arises.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Weighted fair value", value: fmt.moneyRaw(fv) },
          { label: "Carrying amount", value: fmt.moneyRaw(carrying) },
          { label: impairment > 0 ? "Impairment charge" : "Headroom", value: impairment > 0 ? fmt.moneyRaw(impairment) : fmt.pct(headroom, 1), tone: impairment > 0 ? "neg" : headroom < 0.1 ? "warn" : "pos" },
          { label: "Goodwill after the test", value: fmt.moneyRaw(goodwill - impairment) },
          { label: "Decline that triggers a charge", value: impairment > 0 ? "already impaired" : fmt.pct(Math.abs(triggerDecline), 1) },
        ] },
        { type: "table", title: "Fair value build", columns: ["Approach", "Indication", "Weight", "Weighted"], rows: [
          ["Income approach (discounted cash flow)", fmt.moneyRaw(dcf), fmt.pct(market > 0 ? wDcf : 1, 0), fmt.moneyRaw(dcf * (market > 0 ? wDcf : 1))],
          ...(market > 0 ? [["Market approach, before control premium", fmt.moneyRaw(market), "", ""], [`Market approach, with a ${fmt.pct(control, 0)} control premium`, fmt.moneyRaw(marketWithPremium), fmt.pct(1 - wDcf, 0), fmt.moneyRaw(marketWithPremium * (1 - wDcf))]] : []),
        ], totals: ["Concluded fair value", "", "100%", fmt.moneyRaw(fv)] },
        { type: "waterfall", title: "Test ($000s)", format: "num", steps: [
          { label: "Fair value", value: fv, total: true },
          { label: "Less carrying amount", value: -carrying },
          { label: excess > 0 ? "Shortfall" : "Headroom", value: -excess, total: true },
        ] },
        { type: "table", title: "Entity reconciliation", columns: ["Item", "Amount"], rows: [
          ["This reporting unit", fmt.moneyRaw(fv)],
          ["Other reporting units", fmt.moneyRaw(num(i, "otherUnits", 0))],
          ["Implied entity fair value", fmt.moneyRaw(entityFv)],
          ["Market capitalization", cap > 0 ? fmt.moneyRaw(cap) : "not entered"],
          ["Difference", cap > 0 ? `${fmt.moneyRaw(entityFv - cap)} (${fmt.pct(reconciliation, 1)})` : "n/a"],
        ], note: "The staff expects the sum of reporting-unit fair values to reconcile to market capitalization, with the difference explained by a control premium and any unallocated corporate items." },
        { type: "sensitivity", title: "Impairment charge: income approach against weight", rowLabel: "Income approach", colLabel: "Weight on income",
          rows: [dcf * 0.8, dcf * 0.9, dcf, dcf * 1.1, dcf * 1.2].map((x) => fmt.moneyRaw(x)),
          cols: [0.3, 0.5, 0.7, 0.9, 1].map((x) => fmt.pct(x, 0)),
          values: [dcf * 0.8, dcf * 0.9, dcf, dcf * 1.1, dcf * 1.2].map((d) => [0.3, 0.5, 0.7, 0.9, 1].map((w) => {
            const f = market > 0 ? d * w + marketWithPremium * (1 - w) : d;
            return Math.max(0, Math.min(goodwill, carrying - f));
          })), format: "num", baseRow: 2, baseCol: 2 },
        assumptions([["Carrying amount", fmt.moneyRaw(carrying)], ["Goodwill", fmt.moneyRaw(goodwill)], ["Income approach", fmt.moneyRaw(dcf)], ["Market approach", market > 0 ? `${fmt.moneyRaw(market)} plus a ${fmt.pct(control, 0)} control premium` : "not used"], ["Weighting", market > 0 ? `${fmt.pct(wDcf, 0)} income` : "income only"]]),
      ],
      caveats: ["Since ASU 2017-04 the test is a single step: the charge is the excess of carrying amount over fair value, capped at goodwill, with no implied-fair-value-of-goodwill step.", "The carrying amount must be the reporting unit's, including allocated goodwill and any allocated corporate assets and liabilities, on the same basis as the fair value.", "A deferred tax consideration arises where the unit is valued on an after-tax basis but the carrying amount includes deferred taxes; simultaneous equations may be needed for a taxable-transaction assumption."],
    };
  },
};

/** Section 382 annual limitation and the usability of a net operating loss after an ownership change. */
const nolLimitation: ToolDef = {
  kind: "calc", id: "acc-382-limitation", title: "Section 382 limitation", tagline: "What a loss carryforward is worth after an ownership change.",
  description: "Computes the section 382 annual limitation from the value of the loss corporation and the long-term tax-exempt rate, adjusts for recognized built-in gains, and schedules how much of the carryforward is actually usable given the eighty percent taxable-income limitation, reporting the present value of the attribute before and after the change.",
  roles: ["accountant", "pe", "corpfin"], specialties: [TAX, FDD, ...X_FDD], category: "Tax", icon: "Hourglass", savesMinutes: 70, tags: ["382", "NOL", "ownership change", "attributes"],
  fields: [
    { key: "value", label: "Value of the loss corporation at the change date", type: "number", unit: "$000s", required: true, default: 250000 },
    { key: "rate", label: "Long-term tax-exempt rate", type: "number", unit: "%", required: true, default: 3.8, step: 0.1 },
    { key: "nol", label: "Net operating loss carryforward", type: "number", unit: "$000s", required: true, default: 18000 },
    { key: "preTcja", label: "Portion arising before 2018", type: "number", unit: "$000s", default: 0, help: "Pre-2018 losses expire after twenty years but are not subject to the 80% limitation" },
    { key: "nubig", label: "Net unrealized built-in gain recognized within five years", type: "number", unit: "$000s", default: 6000 },
    { key: "taxableIncome", label: "Forecast taxable income before losses, year 1", type: "number", unit: "$000s", required: true, default: 9000 },
    { key: "growth", label: "Taxable income growth", type: "number", unit: "%", default: 8 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "discount", label: "Discount rate for the attribute", type: "number", unit: "%", default: 10 },
    { key: "years", label: "Years to schedule", type: "number", default: 10, min: 3, max: 20 },
  ],
  example: { value: 250000, rate: 3.8, nol: 18000, preTcja: 0, nubig: 6000, taxableIncome: 9000, growth: 8, taxRate: 25, discount: 10, years: 10 },
  compute: (i: Inputs): WorkflowOutput => {
    const value = num(i, "value"), rate = num(i, "rate") / 100, nol = num(i, "nol");
    const nubig = num(i, "nubig", 0), ti0 = num(i, "taxableIncome"), g = num(i, "growth", 0) / 100;
    const tax = num(i, "taxRate", 25) / 100, disc = num(i, "discount", 10) / 100;
    const years = Math.max(3, Math.min(20, Math.round(num(i, "years", 10))));
    const preTcja = Math.min(num(i, "preTcja", 0), nol);
    const postTcja = nol - preTcja;
    if (value <= 0 || rate <= 0 || nol <= 0) throw new Error("Enter a value for the loss corporation, the long-term tax-exempt rate and a loss carryforward.");
    const baseLimit = value * rate;
    const rbigPerYear = nubig > 0 ? nubig / 5 : 0;
    let remainingPost = postTcja, remainingPre = preTcja, unused = 0;
    const sched = Array.from({ length: years }, (_, k) => {
      const ti = ti0 * Math.pow(1 + g, k);
      const limit = baseLimit + (k < 5 ? rbigPerYear : 0) + unused;
      const cap80 = 0.8 * ti;
      const usePre = Math.min(remainingPre, limit, ti);
      const usePost = Math.min(remainingPost, Math.max(0, limit - usePre), Math.max(0, cap80 - usePre));
      const used = usePre + usePost;
      unused = Math.max(0, limit - used);
      remainingPre -= usePre;
      remainingPost -= usePost;
      const shield = used * tax;
      return { year: k + 1, ti, limit, cap80, used, shield, pv: shield / Math.pow(1 + disc, k + 1), remaining: remainingPre + remainingPost };
    });
    const totalUsed = sum(sched.map((s) => s.used));
    const pvShield = sum(sched.map((s) => s.pv));
    const unlimitedPv = (() => {
      let rem = nol, pv = 0;
      for (let k = 0; k < years; k++) {
        const ti = ti0 * Math.pow(1 + g, k);
        const use = Math.min(rem, 0.8 * ti);
        rem -= use;
        pv += (use * tax) / Math.pow(1 + disc, k + 1);
      }
      return pv;
    })();
    const stranded = nol - totalUsed;
    return {
      title: "Section 382 limitation",
      summary: `An ownership change caps annual use at ${fmt.moneyRaw(baseLimit)}, the ${fmt.moneyRaw(value)} value of the loss corporation times the ${(rate * 100).toFixed(2)}% long-term tax-exempt rate${nubig > 0 ? `, plus ${fmt.moneyRaw(rbigPerYear)} a year for five years from recognized built-in gains` : ""}. Over ${years} years ${fmt.moneyRaw(totalUsed)} of the ${fmt.moneyRaw(nol)} carryforward is usable, worth ${fmt.moneyRaw(pvShield)} on a present-value basis against ${fmt.moneyRaw(unlimitedPv)} unlimited, so the change costs ${fmt.moneyRaw(unlimitedPv - pvShield)}.${stranded > 0 ? ` ${fmt.moneyRaw(stranded)} remains unused at the end of the schedule.` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Annual limitation", value: fmt.moneyRaw(baseLimit) },
          { label: "Usable over the schedule", value: fmt.moneyRaw(totalUsed), delta: fmt.pct(totalUsed / nol, 0) },
          { label: "Present value of the shield", value: fmt.moneyRaw(pvShield) },
          { label: "Value lost to the change", value: fmt.moneyRaw(unlimitedPv - pvShield), tone: "neg" },
          { label: "Unused at the end", value: fmt.moneyRaw(stranded), tone: stranded > 0 ? "warn" : "pos" },
          { label: "Years to exhaust", value: sched.find((s) => s.remaining <= 0.5) ? String(sched.find((s) => s.remaining <= 0.5)!.year) : `beyond ${years}` },
        ] },
        { type: "table", title: "Usage schedule", columns: ["Year", "Taxable income", "382 limitation", "80% of income", "Loss used", "Tax shield", "Present value", "Remaining"], rows: sched.map((s) => [`Y${s.year}`, fmt.moneyRaw(s.ti), fmt.moneyRaw(s.limit), fmt.moneyRaw(s.cap80), fmt.moneyRaw(s.used), fmt.moneyRaw(s.shield), fmt.moneyRaw(s.pv), fmt.moneyRaw(s.remaining)]), totals: ["Total", "", "", "", fmt.moneyRaw(totalUsed), fmt.moneyRaw(sum(sched.map((s) => s.shield))), fmt.moneyRaw(pvShield), fmt.moneyRaw(stranded)] },
        { type: "line", title: "Carryforward remaining and annual use", format: "num", series: [
          { name: "Remaining", points: sched.map((s) => ({ x: `Y${s.year}`, y: s.remaining })) },
          { name: "Used", points: sched.map((s) => ({ x: `Y${s.year}`, y: s.used })) },
          { name: "Limitation", points: sched.map((s) => ({ x: `Y${s.year}`, y: s.limit })) },
        ] },
        { type: "bullets", title: "Mechanics that change the answer", items: [
          `The limitation is fixed at the change date: ${fmt.moneyRaw(value)} times ${(rate * 100).toFixed(2)}%. Equity value at the change date, not the purchase price of the stock acquired, is the measure, and it includes the value of all outstanding stock.`,
          "An ownership change is a more than fifty percentage point increase in ownership by five percent shareholders over a rolling three-year testing period; small shareholders are aggregated into public groups.",
          nubig > 0 ? `Recognized built-in gains increase the limitation for five years, here ${fmt.moneyRaw(rbigPerYear)} a year, only to the extent gains are actually recognized and the net unrealized built-in gain exceeds the statutory threshold.` : "A net unrealized built-in loss would subject post-change recognized losses to the same limitation, so test the threshold in either direction.",
          "Unused limitation carries forward and accumulates, which is why a low-income early year is not permanently lost.",
          "Post-2017 losses do not expire but are capped at eighty percent of taxable income; pre-2018 losses expire twenty years after they arose and are not subject to that cap.",
          "The continuity-of-business-enterprise requirement applies for two years after the change: discontinue the historic business and the limitation drops to zero plus recognized built-in gains.",
        ] },
        assumptions([["Value of the loss corporation", fmt.moneyRaw(value)], ["Long-term tax-exempt rate", `${(rate * 100).toFixed(2)}%`], ["Carryforward", `${fmt.moneyRaw(nol)} (${fmt.moneyRaw(preTcja)} pre-2018)`], ["Built-in gains", fmt.moneyRaw(nubig)], ["Taxable income", `${fmt.moneyRaw(ti0)} growing ${(g * 100).toFixed(0)}%`], ["Tax and discount rates", `${fmt.pct(tax, 0)} and ${fmt.pct(disc, 0)}`]]),
      ],
      caveats: ["This is a mechanical computation, not an opinion. Whether an ownership change occurred requires a five percent shareholder analysis over the testing period, which needs the actual ownership history.",
        "State conformity to section 382 varies, and separate limitations can apply to credits and to interest carryforwards under section 163(j).",
        "Value at the change date has its own adjustments, including for capital contributions in the preceding two years and for redemptions, which are ignored above."],
      nextSteps: ["Get a shareholder analysis to confirm whether and when an ownership change occurred", "Test the net unrealized built-in gain threshold against the statutory floor", "Model the attribute's value into the purchase price at the tax rate the buyer will actually pay"],
    };
  },
};

/* ======================================================================================
 * Pack
 * ====================================================================================== */

export const ACCOUNTANT_PACK: ToolDef[] = [
  // Technical accounting memos
  memo606, memo842, memo805, memo350, memo718, memo740, memo326, memo450, ifrsGaap,
  // Disclosure and SEC reporting
  discBenchmark, commentLetters, commentTrends, camCompare, xbrlConsistency, rateRecBenchmark, disclosureChecklist, newStandardScan, sxSignificance,
  // Audit planning and execution
  riskProfile, planningAnalytics, estimateChallenger, auditRiskMemo, analyticalProcedures, jeTesting, goingConcern, relatedParty, walkthroughRcm, deficiencyEvaluator,
  // Controllership
  fluxCommentary, closeChecklist, reconReview,
  // Transaction advisory and tax
  qoeDatabook, nwcAnalysis, maTaxStructuring, transferPricing,
  // Calculators
  materiality, attributeSample, musSample, proofOfCash, benfordTest,
  sspAllocation, leaseSchedule, rateRec, epsCalc,
  reliefFromRoyalty, goodwillImpairment, nolLimitation,
];
