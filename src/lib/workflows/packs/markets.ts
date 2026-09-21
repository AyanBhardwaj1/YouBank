/**
 * Public markets tool pack: sell-side equity research, long/short and multi-manager equity, event-driven /
 * merger arbitrage, distressed & credit, long-only and quant seats. Authored from
 * docs/research/students-and-public-markets.md (Part B) with credit methodology from
 * docs/research/banker-restructuring.md. See packs/core.ts for the reference implementation.
 */
import { bool, fmt, list, num, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* Specialty strings, verbatim from src/lib/roles.ts. STU is the student specialty, included so student-facing tools survive the specialty filter. */
const ER = "Equity research (sell-side)";
const LS = "Long/short equity";
const ED = "Event-driven / merger arbitrage";
const DC = "Distressed & credit";
const MM = "Multi-manager pod";
const LO = "Long-only / asset management";
const QS = "Quant / systematic";
const STU = "Equity research / hedge funds";

const T = (i: Inputs, k = "ticker") => str(i, k).toUpperCase();

/* ======================================================================================
 * AI workflows
 * ====================================================================================== */

const earningsPreview: ToolDef = {
  kind: "ai", id: "eq-earnings-preview", title: "Earnings preview", tagline: "The pre-print note: modeled drivers, the debates, guidance on the record, and the setup.",
  description: "Builds the preview a covering analyst publishes the week before results: the driver trend from the last six quarters, the guidance already on the record from the prior results 8-K, your number against the consensus you paste, the two debates that will move the stock, and positioning from Form 4 and 13D/G activity. Sources are SEC XBRL, the last two 10-Qs, earnings 8-K exhibits, and ownership filings.",
  roles: ["markets", "student"], specialties: [ER, LS, MM, LO, STU], category: "Research", icon: "Calendar", deliverable: "memo", savesMinutes: 150, tags: ["earnings", "preview", "consensus", "positioning"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "quarter", label: "Quarter", type: "text", required: true, placeholder: "FQ3 2026", help: "The fiscal quarter about to be reported" },
    { key: "consensusRevenue", label: "Consensus revenue", type: "number", unit: "$mm", help: "Paste from your estimates provider; free data has no consensus" },
    { key: "consensusEps", label: "Consensus EPS", type: "number", unit: "$" },
    { key: "myEstimates", label: "Your estimates", type: "text", placeholder: "revenue $1,035mm, non-GAAP EPS $0.50" },
    { key: "expectedMove", label: "Options-implied move", type: "number", unit: "%", help: "Leave blank if you have no options data" },
    { key: "debates", label: "The debates", type: "textarea", placeholder: "What the bulls and bears are arguing about into the print" },
  ],
  example: { ticker: "DDOG", quarter: "FQ3 2026", consensusRevenue: 1150, consensusEps: 0.65, myEstimates: "revenue $1,180mm, non-GAAP EPS $0.69", expectedMove: 9, debates: "AI-native cohort contribution and whether optimization at the largest customers is finished" },
  effort: "medium",
  instructions: `1. get_company_financials for the ticker: LTM figures, the quarterly revenue series, the fiscal year end (map the quarter label to the right period end) and the recent filing list.
2. get_recent_filings with forms ["8-K","10-Q","4","SC 13D","SC 13G"] and limit 40. Find the two most recent results 8-Ks (item 2.02). The filing URL is the primary document, not the press release: read_document on the filing index (the URL ending in a slash, or replace the document name with the -index.htm page) to list the exhibits, then read_document on the EX-99.1 earnings release itself. Do not guess exhibit filenames. Query it for "outlook", "guidance", "we expect", "full year", "operating margin" to capture the guidance on the record, and repeat on the prior quarter's release for the comparison.
3. search_filing on the latest 10-Q for "results of operations", "outlook", "liquidity and capital resources", and the company's own KPI language ("remaining performance obligations", "net revenue retention", "customers with annual recurring revenue", "same-store sales", "occupancy", "RevPAR", "backlog", "average revenue per user"). read_filing to expand at least two hits and quote the KPI definition, not just the number.
4. get_xbrl_series for six to eight quarters of the revenue concept plus GrossProfit, OperatingIncomeLoss and NetCashProvidedByUsedInOperatingActivities. With calc compute year-over-year and sequential growth, incremental margin (change in operating income divided by change in revenue) and the implied guide-to-consensus gap. Values come back in raw units: divide by 1e6 for USD millions. Many filers do not tag a standalone fourth quarter: derive it as the fiscal year less the first three quarters and label the figure derived.
5. get_insider_transactions with limit 12 and classify codes (P open-market purchase, S sale, A award, M exercise, F tax withholding); flag any cluster of three or more insiders buying within 30 days. Scan the filing list for SC 13D/13G amendments in the last 90 days and read_document on Item 4 of any 13D for intent.
6. Build the number: state your revenue and EPS estimate against the pasted consensus, decompose the gap into two or three named drivers with the arithmetic, and say what the print must show for each to be right.
Produce, in order: kpis (consensus revenue and EPS, your estimate, implied year-over-year growth, guide midpoint versus consensus, options-implied move); table "Consensus vs our number" (line, consensus, our estimate, delta, driver); table "Driver trend" (last five or six quarters: revenue, growth, gross margin, operating margin, the company KPI); bullets "The two debates" with the evidence each side needs from this print; timeline of the dated events into and after the report; bullets "Positioning" (insider activity, 13D/G, short interest only if the user supplied it); callout with the setup and what would change the view; nextSteps; caveats.
Missing data: consensus is user-supplied, so if it is blank use the guidance midpoint as the reference and label it. If no options-implied move is given, say the expected move is unknown rather than inventing one. If the guidance exhibit cannot be read, name the filing you tried.`,
  prompt: (i) => `Write the earnings preview for ${T(i)} ahead of ${str(i, "quarter")}.${num(i, "consensusRevenue") ? ` Consensus: revenue $${num(i, "consensusRevenue")}mm, EPS $${num(i, "consensusEps")}.` : ""}${str(i, "myEstimates") ? ` My estimates: ${str(i, "myEstimates")}.` : ""}${num(i, "expectedMove") ? ` Options imply a ${num(i, "expectedMove")}% move.` : ""}${str(i, "debates") ? ` Debates: ${str(i, "debates")}.` : ""}`,
};

const earningsRecap: ToolDef = {
  kind: "ai", id: "eq-earnings-recap", title: "Earnings recap & guidance delta", tagline: "What was reported, what changed in the guide, and the estimate revisions that follow.",
  description: "The same-day recap: actuals from the results 8-K against consensus and the prior guide, a line-by-line guidance delta versus the prior quarter's outlook, the KPIs and segment detail from the release, the non-GAAP reconciliation, and the estimate and price-target implications. Reads both the current and prior earnings 8-K exhibits so the guidance change is measured, not asserted.",
  roles: ["markets", "student"], specialties: [ER, LS, MM, LO, STU], category: "Research", icon: "RefreshCw", deliverable: "memo", savesMinutes: 180, tags: ["earnings", "recap", "guidance", "revisions"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "NVDA" },
    { key: "quarter", label: "Quarter reported", type: "text", required: true, placeholder: "FQ2 FY2027" },
    { key: "consensus", label: "Consensus / your estimates", type: "textarea", placeholder: "Revenue $46.0bn, non-GAAP EPS $1.01, Data Center $41.0bn; my number: revenue $46.8bn" },
    { key: "audience", label: "Audience", type: "select", options: ["Morning meeting", "PM / pod", "Investment committee", "Client email"], default: "PM / pod" },
  ],
  example: { ticker: "NVDA", quarter: "FQ2 FY2027", consensus: "consensus revenue $46.0bn, non-GAAP EPS $1.01, Data Center $41.0bn; my estimate revenue $46.8bn", audience: "PM / pod" },
  effort: "high",
  instructions: `1. get_recent_filings with forms ["8-K","10-Q","10-K"] and limit 30. Identify the results 8-K (item 2.02) for the quarter and the one before it. read_document on each press-release exhibit (usually EX-99.1) with queries "outlook", "we expect", "guidance", "revenue", "non-GAAP", "gross margin", "operating expenses", "segment", "share repurchase", and any KPI name.
2. Build the actuals table from the current release: revenue, gross margin, operating income and margin, EPS on both GAAP and non-GAAP bases, free cash flow, segment or product revenue, and the KPIs. Pull the non-GAAP reconciliation and state the largest adjustment (usually stock-based compensation) as a percent of revenue.
3. Build the guidance delta by comparing each guided line in this release with the same line in the prior release: metric, prior guide, new guide, change at the midpoint, and the implied sequential or year-over-year growth. Use calc for every delta. Where guidance is a range, use the midpoint and say so.
4. search_filing on the 10-Q (if already filed) for "results of operations", "deferred revenue", "remaining performance obligations", "subsequent events" and any accounting change, to catch what the press release left out.
5. get_xbrl_series for the revenue concept and OperatingIncomeLoss over eight quarters to put the print in trend context.
6. Use web_research only for earnings-call commentary and analyst reaction (transcripts are not in SEC data); label every such point as press or transcript commentary with the link, and never state a management quote you have not sourced.
7. Compare with the pasted consensus and estimates: beat or miss per line in dollars and percent, then state the estimate revisions that follow (direction and rough magnitude for the next two quarters and the full year) and what they do to a multiple-based target.
Produce: kpis (revenue and growth, versus consensus, non-GAAP EPS versus consensus, guide midpoint change, margin); table "Actuals vs consensus" (line, actual, consensus, surprise, percent); table "Guidance delta" (metric, prior guide, new guide, change, read-through); bullets "What changed" (five at most, each with a number); columns or line chart of the quarterly revenue trend; bullets "Estimate revisions"; callout written for the audience selected (a morning-meeting paragraph, a pod-style action line, or a client email); caveats on non-GAAP versus GAAP and on any figure taken from press commentary.`,
  prompt: (i) => `Recap ${T(i)}'s ${str(i, "quarter")} results with a guidance delta for a ${str(i, "audience", "PM").toLowerCase()} audience.${str(i, "consensus") ? ` Reference numbers: ${str(i, "consensus")}.` : ""}`,
};

const initiationTeardown: ToolDef = {
  kind: "ai", id: "eq-initiation-teardown", title: "Initiation-style teardown", tagline: "The long-form first look: business, unit economics, moat, model, valuation, rating.",
  description: "Produces the structure of an initiation of coverage compressed into one deliverable: industry and value chain, how the company makes money and the unit economics, the KPI history from XBRL and filings, competitive position, management and incentives, a summary model, valuation with a target multiple justified against peers and the company's own history, the bull and bear cases, and the risks to the call.",
  roles: ["markets", "student"], specialties: [ER, LO, LS, STU], category: "Research", icon: "BookOpen", deliverable: "memo", savesMinutes: 600, tags: ["initiation", "coverage", "teardown"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "MDB SNOW NET CRWD", help: "Leave empty to have the model propose the coverage set" },
    { key: "stance", label: "Stance", type: "select", options: ["Let the work decide", "Initiate Buy", "Initiate Hold", "Initiate Sell"], default: "Let the work decide" },
    { key: "focus", label: "Emphasis", type: "text", placeholder: "e.g. platform consolidation, margin path, competitive displacement" },
  ],
  example: { ticker: "DDOG", peers: ["MDB", "SNOW", "NET", "CRWD"], stance: "Let the work decide", focus: "platform consolidation and the operating margin path" },
  effort: "high",
  instructions: `1. get_company_financials for the subject and get_trading_comps for the subject plus peers (propose five to seven peers by business model, buyer universe and scale if none are given, and state the logic).
2. search_filing on the latest 10-K for "our business", "our platform" or "products and services", "competition", "customers", "sales and marketing", "human capital", "intellectual property", "seasonality", "government regulation", and the two largest risk factors. read_filing to expand at least five hits and quote the language that defines the model (contract length, pricing basis, channel).
3. Unit economics: find the disclosed KPIs with search_filing (net revenue retention, customers above a revenue threshold, remaining performance obligations, average revenue per unit, same-store sales, occupancy, utilization) and compute revenue per customer, the split of growth between new and existing customers, gross margin by segment where disclosed, and sales efficiency (net new annualized revenue divided by prior-period sales and marketing spend) with calc.
4. get_xbrl_series for four to six years of revenue, gross profit, operating income, stock-based compensation, capex and operating cash flow; compute the multi-year CAGR, the margin path, FCF conversion (FCF / EBITDA) and ROIC (NOPAT = EBIT x (1 - tax rate); invested capital = total debt + book equity - cash, or net PP&E + working capital + goodwill, stating which you used).
5. search_filing on the DEF 14A for "compensation discussion", "performance share", "peer group" and "beneficial ownership" to describe what management is paid to do and how much stock they own.
6. get_recent_filings with forms ["8-K","SC 13D","S-8","424B"] to catch capital raises, M&A, management changes and activist positions.
7. Valuation: state the target metric and year (a forward metric 12 to 24 months out), justify the target multiple from the peer set and from the company's own history (compute the historical EV/revenue or EV/EBITDA range from get_xbrl_series against price data), bridge enterprise value to equity and to per share, and cross-check by stating what revenue growth the current price already requires.
Produce: kpis (price, market cap, EV, EV/LTM revenue or EBITDA, revenue growth, FCF margin, target and implied return); markdown "Industry and value chain"; markdown "How it makes money" with the unit-economics arithmetic; table "Operating history" (four to six years of revenue, growth, gross margin, operating margin, FCF, ROIC); score "Moat scorecard" (switching costs, scale, network effects, brand, cost advantage, data; 0-5 each with the filing citation); table "Valuation" (method, metric, multiple, implied EV, implied per share); bar of peer multiples with the subject emphasised; bullets "Bull case" and "Bear case" with the numbers each requires; risks; qa "Questions for management"; nextSteps. Respect the stance field: if a rating is specified, argue it honestly and say where it is most vulnerable; if not, conclude with the rating the evidence supports and the expected 12-month return that justifies it.`,
  prompt: (i) => `Write an initiation-style teardown of ${T(i)}${list(i, "peers").length ? ` against ${list(i, "peers").join(", ")}` : ""}. Stance: ${str(i, "stance", "let the work decide")}.${str(i, "focus") ? ` Emphasise ${str(i, "focus")}.` : ""}`,
};

const thesisMemo: ToolDef = {
  kind: "ai", id: "eq-thesis-memo", title: "Thesis & variant-perception memo", tagline: "Call, falsifiable thesis, the consensus assumption that is wrong, catalyst, risks, sizing.",
  description: "Drafts the buy-side memo in its six-part structure: the call with direction and magnitude, a falsifiable thesis, the variant view that names the specific consensus assumption it disagrees with, a datable catalyst inside six to twelve months, two or three weighted risks, and sizing with a cut level. Includes a consensus-versus-us table, a pre-mortem, and a reward-to-risk skew check.",
  roles: ["markets", "student"], specialties: [LS, MM, LO, ER, STU], category: "Deliverables", icon: "Target", deliverable: "memo", savesMinutes: 240, tags: ["thesis", "variant perception", "memo"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "WBD" },
    { key: "direction", label: "Direction", type: "select", options: ["Long", "Short"], default: "Long" },
    { key: "consensusView", label: "What consensus believes", type: "textarea", required: true, placeholder: "The specific assumption you think is wrong" },
    { key: "horizon", label: "Horizon", type: "number", unit: "months", default: 12, min: 3, max: 36 },
    { key: "upside", label: "Target upside", type: "number", unit: "%", help: "Leave blank to have the memo derive it" },
    { key: "cut", label: "Cut level", type: "number", unit: "%", default: 12 },
  ],
  example: { ticker: "WBD", direction: "Long", consensusView: "Consensus assumes linear network decline accelerates and that the separation leaves Global Networks with stranded costs and no buyer", horizon: 12, upside: 40, cut: 12 },
  effort: "high",
  instructions: `1. Verify the factual base before writing: get_company_financials, then get_xbrl_series for six to twelve quarters of revenue, operating income, operating cash flow and debt, and search_filing on the latest 10-K and 10-Q for the segment disclosures, the guidance language and the two risk factors nearest the thesis.
2. Test the stated consensus assumption against the filings. Name the exact disclosure that supports or contradicts it and quote it. If the filings support consensus, say so plainly and either narrow the thesis or recommend passing; a memo that cannot find a variant view should say the idea is consensus.
3. Build the consensus-versus-us table: three to five modeled lines (revenue growth, a key KPI, gross or EBITDA margin, capex or FCF, the exit multiple), with the consensus assumption, our assumption, the gap in percent, and the disclosed evidence for ours. Use calc for every derived figure.
4. Catalyst: date it. Use get_recent_filings for the reporting cadence and any 8-K item 7.01/8.01 event notices, search_filing on the DEF 14A for the annual meeting date, and the 10-K debt footnote or "contractual obligations" for maturities. A plausible but undated development is not a catalyst: label it soft.
5. Risks: two or three, each with a probability, the dollar or percent impact, and the observable that would show it happening. Include crowding and, for shorts, borrow cost and squeeze risk (use get_insider_transactions and the ownership filings for context); note that valuation alone is the weakest short thesis.
6. Sizing: state the size as a percent of the book, the cut level, and the resulting reward-to-risk. Compute the skew as target upside divided by the cut and flag anything below 2:1 (the practitioner benchmark is about 3:1).
7. Pre-mortem: one paragraph written as if the position had lost money, naming the most likely reason.
Produce: callout with the call in one sentence (direction, target, horizon, size); markdown "Thesis" (three numbered, falsifiable claims); markdown "Variant view" naming the consensus assumption and the evidence; table "Consensus vs us"; timeline "Catalysts" with dates; risks with severity and mitigation; table "Sizing and skew" (target, cut, skew, size, expected value); markdown "Pre-mortem"; nextSteps (the specific diligence that would confirm the variant view); caveats.`,
  prompt: (i) => `Draft a ${str(i, "direction", "Long").toLowerCase()} memo on ${T(i)} over ${num(i, "horizon", 12)} months. Consensus believes: ${str(i, "consensusView")}.${num(i, "upside") ? ` Target upside ${num(i, "upside")}% against a ${num(i, "cut", 12)}% cut.` : ` Cut level ${num(i, "cut", 12)}%.`}`,
};

const scenarioTargets: ToolDef = {
  kind: "ai", id: "eq-scenario-targets", title: "Bull / bear / base with price targets", tagline: "Three driver paths, three targets, probability-weighted value and skew.",
  description: "Builds the three-scenario framework behind a price target: explicit driver paths for revenue, margin and multiple in each case, the per-share target each implies through an enterprise-to-equity bridge, probabilities, the probability-weighted value, and the reward-to-risk skew against the current price. Uses the target-multiple method with a DCF-style cross-check.",
  roles: ["markets", "student"], specialties: [ER, LS, MM, LO, ED, STU], category: "Valuation", icon: "Split", deliverable: "analysis", savesMinutes: 180, tags: ["scenarios", "price target", "skew"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "CCL" },
    { key: "method", label: "Primary method", type: "select", options: ["Forward P/E", "EV/EBITDA", "EV/Sales", "Sum of the parts", "FCF yield"], default: "EV/EBITDA" },
    { key: "horizon", label: "Horizon", type: "number", unit: "months", default: 12, min: 6, max: 36 },
    { key: "drivers", label: "Key drivers", type: "text", placeholder: "net yields, occupancy, fuel, net debt paydown" },
  ],
  example: { ticker: "CCL", method: "EV/EBITDA", horizon: 12, drivers: "net yields, occupancy, fuel cost per metric ton, debt paydown" },
  effort: "medium",
  instructions: `1. get_company_financials and get_xbrl_series for eight quarters (and four years where available) of revenue, operating income, D&A, capex, operating cash flow, debt and cash. Establish the starting point: LTM revenue, EBITDA (operating income plus D&A, labelled as reported), net debt, diluted shares and the current price.
2. search_filing on the latest 10-K and 10-Q for the guidance language and the drivers named by the user; quote the disclosed levels so each scenario path starts from a real number.
3. get_trading_comps for the peer set to establish the multiple range, and compute the company's own historical multiple range from get_xbrl_series against the price data available. The base-case multiple must be justified by one of those two references, not asserted.
4. Build three driver paths for the horizon: bear, base and bull, each with revenue growth, the margin, and the exit multiple, plus the one driver that distinguishes it. Show the arithmetic with calc: forward metric x target multiple = enterprise value; less net debt (and preferred and minority interest) = equity value; divided by diluted shares = the target. For Forward P/E apply the multiple to forward EPS directly and state the share-count assumption.
5. Assign probabilities that sum to 100 and justify each in one line. Compute the probability-weighted target, the expected return from the current price, and the skew (bull upside divided by bear downside).
6. Cross-check: state what revenue CAGR the current price implies under a simple perpetuity-growth discounted cash flow, and whether the base case sits above or below it.
Produce: kpis (current price, bear/base/bull targets, weighted target, expected return, skew); table "Scenario build" (driver, bear, base, bull) followed by valuation rows (forward metric, multiple, EV, net debt, equity, per share, return); table "Probability weighting" (scenario, probability, target, return, contribution); bar of the three targets with the current price as the reference line; sensitivity of the per-share target to the multiple and the forward metric; bullets "What moves the stock between cases"; caveats (multiple ranges are not calendarized; reported versus adjusted EBITDA). In nextSteps point at the bull/bear/base expected value calculator and the price-target calculator for the arithmetic.`,
  prompt: (i) => `Build bull, base and bear cases and ${num(i, "horizon", 12)}-month price targets for ${T(i)} using ${str(i, "method", "EV/EBITDA")}.${str(i, "drivers") ? ` Drivers that matter: ${str(i, "drivers")}.` : ""}`,
};

const catalystCalendar: ToolDef = {
  kind: "ai", id: "eq-catalyst-calendar", title: "Catalyst calendar", tagline: "Every dated event across the book for the next quarter, with what each one resolves.",
  description: "Assembles a dated catalyst calendar for a list of positions from filings: estimated reporting dates from the filing cadence, annual meetings, investor days announced in 8-Ks, debt maturities from the debt footnote, lock-up expiries from prospectuses, court and regulatory dates from full-text search, and index or corporate-action events. Each event carries what it resolves for the thesis.",
  roles: ["markets", "student"], specialties: [MM, LS, ED, ER, STU], category: "Portfolio", icon: "Calendar", deliverable: "table", savesMinutes: 180, tags: ["catalysts", "calendar", "events"],
  fields: [
    { key: "tickers", label: "Positions", type: "tickers", required: true, placeholder: "NVDA DDOG CCL WBD HES" },
    { key: "days", label: "Window", type: "number", unit: "days", default: 90, min: 30, max: 365 },
    { key: "include", label: "Event types", type: "multiselect", options: ["Earnings", "Investor days", "Annual meetings", "Debt maturities", "Lock-up expiries", "Regulatory / court dates", "Index & corporate actions", "Product launches"], default: ["Earnings", "Investor days", "Debt maturities", "Regulatory / court dates"] },
  ],
  example: { tickers: ["NVDA", "DDOG", "CCL", "WBD", "HES"], days: 90, include: ["Earnings", "Investor days", "Debt maturities", "Regulatory / court dates"] },
  effort: "medium",
  instructions: `1. For each ticker call get_recent_filings with forms ["8-K","10-Q","10-K","DEF 14A"] and limit 25. Derive the expected reporting date from the cadence of the last four results 8-Ks (item 2.02) and the fiscal period ends, and label it estimated unless a filing states the date.
2. Read any 8-K with item 7.01 or 8.01 for announced investor days, conferences, capital-markets days and guidance updates. search_filing on the DEF 14A for "annual meeting of stockholders" to date the meeting and any shareholder proposals.
3. Debt maturities: search_filing on the latest 10-K or 10-Q for "maturities of long-term debt", "contractual obligations" and "revolving credit facility"; record amounts due inside the window and show any springing maturity at the earlier date.
4. Lock-ups and share supply: for recent IPOs use edgar_fulltext_search with forms ["424B4","S-1"] and the phrase "lock-up" to date the expiry; check for S-8 and 424B filings and any announced secondary.
5. Regulatory and court dates: edgar_fulltext_search with the entity name and phrases such as "second request", "trial is scheduled", "consent decree", "PDUFA", "appeal", and read_document on the hits for the date. For merger situations read the outside date in the merger agreement.
6. For each event state what it resolves for the thesis and set the tone (pos, neg, neutral, warn). Where the user gave no options data do not invent an expected move; say that event sizing needs it.
Produce: timeline of every dated event across the book, sorted; table "Catalyst calendar" (date, ticker, event, type, what it resolves, confidence: disclosed or estimated); kpis (events in the window, hard versus soft, the busiest week, positions with no dated catalyst); bullets "Clustered risk" naming any week where several positions report or resolve together; callout on the largest single-day exposure; caveats (reporting dates estimated from cadence; no options-implied moves; index rules are external knowledge).`,
  prompt: (i) => `Build a ${num(i, "days", 90)}-day catalyst calendar for ${list(i, "tickers").join(", ")}, covering ${list(i, "include").join(", ").toLowerCase() || "earnings, investor days and maturities"}.`,
};

const ownershipMonitor: ToolDef = {
  kind: "ai", id: "eq-ownership-monitor", title: "Ownership & positioning monitor", tagline: "Form 4 clusters, 13D/G activity, holder concentration, and days to cover.",
  description: "Tracks who is buying and selling: Form 4 insider transactions by code with cluster and 10b5-1 flags, SC 13D and 13G filings and amendments with the stated purpose, the five-percent holders and insider stakes from the proxy, and days to cover from short interest you supply. The positioning page that goes under a thesis before it is sized.",
  roles: ["markets", "student"], specialties: [LS, MM, ED, QS, STU], category: "Screening", icon: "Users", deliverable: "analysis", savesMinutes: 120, tags: ["insiders", "13D", "13F", "crowding"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "LUMN" },
    { key: "days", label: "Lookback", type: "number", unit: "days", default: 365, min: 60, max: 1095 },
    { key: "shortInterest", label: "Short interest", type: "number", unit: "shares mm", help: "From the FINRA twice-monthly file, if you have it" },
    { key: "adv", label: "Average daily volume", type: "number", unit: "shares mm", help: "For days to cover" },
  ],
  example: { ticker: "LUMN", days: 365, shortInterest: 120, adv: 22 },
  effort: "medium",
  instructions: `1. get_insider_transactions with limit 25. Group by transaction code: P open-market purchase, S sale, A grant, M option exercise, F shares withheld for tax. Separate discretionary trades (P and S) from compensation mechanics (A, M, F) and say clearly that grants and withholdings are not signals.
2. Flag clusters: three or more distinct insiders buying within 30 days, or any purchase by the CEO or CFO above one year of salary. Where a transaction may be under a trading plan, read_document on the Form 4 URL and quote the footnote (a "Rule 10b5-1" footnote materially weakens the signal).
3. get_recent_filings with forms ["SC 13D","SC 13D/A","SC 13G","SC 13G/A","4","144"] and limit 40. For each 13D or amendment, read_document with query "Purpose of Transaction" (Item 4) and "Item 5" for the position size and percent, and quote the stated intent. Distinguish 13G passive filers (index funds and asset managers) from 13D activists.
4. search_filing on the DEF 14A for "security ownership of certain beneficial owners" to tabulate the five-percent holders, the officer and director group stake, and any pledging or hedging disclosure.
5. If short interest and average daily volume are given, compute with calc: short interest as a percent of shares outstanding and of float, and days to cover (short interest / ADV). State that FINRA short interest is twice-monthly and is not the same as daily short-sale volume. If they are not given, leave the metric out rather than estimating it.
6. Conclude on crowding and what it means for sizing: a heavily shorted, heavily owned name needs a smaller size and a wider stop.
Produce: kpis (net insider buying or selling over the window in dollars, distinct buyers, largest holder and percent, insider group stake, short interest as a percent of float, days to cover); table "Insider transactions" (date, insider, role, code, shares, price, value, holdings after, plan footnote); table "Five percent holders and 13D/G activity" (holder, type, percent, filing, date, stated purpose); bar of net insider dollars by month; callout on the positioning read; risks (crowding, pledging, concentrated control); caveats (Form 4 is filed within two business days; 13F long positions lag up to 45 days and exclude shorts; 13G filings do not signal intent).`,
  prompt: (i) => `Monitor ownership and positioning in ${T(i)} over the last ${num(i, "days", 365)} days.${num(i, "shortInterest") ? ` Short interest ${num(i, "shortInterest")}mm shares on ${num(i, "adv")}mm ADV.` : ""}`,
};

const shortRedFlags: ToolDef = {
  kind: "ai", id: "eq-short-redflags", title: "Short thesis red-flag scan", tagline: "Accruals, receivables, capitalized costs, the non-GAAP gap, auditor and 4.02 events.",
  description: "Runs the forensic checklist behind an accounting short: the Sloan accrual ratio, receivables and deferred revenue against revenue, capitalized software and content costs against amortization, the non-GAAP-to-GAAP gap and its composition, auditor changes and non-reliance 8-Ks, material weaknesses, SEC comment letters, and related-party exposure. Each flag is scored and tied to the disclosure it came from.",
  roles: ["markets"], specialties: [LS, MM, ER, DC], category: "Diligence", icon: "AlertTriangle", deliverable: "analysis", savesMinutes: 300, tags: ["short", "forensic", "earnings quality"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "WBD" },
    { key: "years", label: "Lookback", type: "number", unit: "years", default: 3, min: 2, max: 6 },
    { key: "focus", label: "Tests", type: "multiselect", options: ["Accruals", "Receivables vs revenue", "Capitalized costs", "Non-GAAP gap", "Auditor & control issues", "Related parties", "Segment & KPI changes", "Acquisition accounting"], default: ["Accruals", "Receivables vs revenue", "Capitalized costs", "Non-GAAP gap", "Auditor & control issues"] },
  ],
  example: { ticker: "WBD", years: 3, focus: ["Accruals", "Receivables vs revenue", "Capitalized costs", "Non-GAAP gap", "Auditor & control issues"] },
  effort: "high",
  instructions: `1. get_company_financials, then get_xbrl_series with find set to "Receivable|Revenue|Inventory|CapitalizedComputerSoftware|FilmCost|Accrued|Assets|NetIncome|OperatingActivities|Goodwill|Intangible" to discover the tags this filer uses, then pull the series (eight to twelve quarters, or the requested years).
2. Accruals: compute the Sloan accrual ratio = (net income - cash flow from operations) / average total assets for each period, and the cash conversion ratio = operating cash flow / net income. Rising income with flat or falling operating cash flow is the core earnings-quality warning; quantify the gap in dollars.
3. Receivables and revenue: compute days sales outstanding = accounts receivable / revenue x days in the period, and compare the growth of receivables, unbilled receivables and contract assets with revenue growth. Compare deferred revenue growth with revenue growth: deferred revenue falling while revenue grows pulls demand forward.
4. Capitalized costs: pull capitalized software, film and content, or development costs and compare additions with amortization; a widening gap flatters margins. search_filing on the 10-K for "capitalized software", "content assets", "amortization" and the accounting policy, and quote the useful-life assumption.
5. Non-GAAP gap: from the latest results 8-K exhibit (read_document on the press release) and the 10-K, compute non-GAAP operating income or EPS minus GAAP as a percent of revenue and of GAAP, and name the three largest adjustments with stock-based compensation shown separately as a percent of revenue. Recurring "one-time" charges across three or more years are a flag.
6. Auditor and controls: get_recent_filings with forms ["8-K","10-K","NT 10-K"] and read the item codes for 4.01 (auditor change) and 4.02 (non-reliance on previously issued financials); search_filing on the 10-K for "material weakness", "not effective", "substantial doubt", "critical audit matter", "restatement". Run edgar_fulltext_search with the entity name and forms ["UPLOAD","CORRESP"] for SEC comment letters and read what the staff asked about.
7. Related parties and structure: search_filing on the 10-K and DEF 14A for "related party transactions", "variable interest entity", "off-balance sheet", "factoring" or "receivables securitization".
8. Then answer the question that matters: is this a short with a catalyst, or only an accounting concern? Name the datable event that would force the market to price it. Accounting alone, with no catalyst, is not a short thesis, and valuation alone is weaker still.
Produce: kpis (latest accrual ratio and its trend, cash conversion, DSO change in days, non-GAAP gap as a percent of revenue, count of hard events such as 4.01, 4.02 or a material weakness); score "Red flags" (one row per test, 0-5, with the filing citation in the note); table "Earnings quality trend" (period, net income, operating cash flow, accrual ratio, DSO, deferred revenue, non-GAAP gap); line or columns chart of net income against operating cash flow; risks with severity; callout stating whether a catalyst exists and what it is; caveats (XBRL tag coverage varies and extension-heavy filers are sparse; no borrow or short-interest data unless supplied).`,
  prompt: (i) => `Run a short red-flag scan on ${T(i)} over ${num(i, "years", 3)} years, testing ${list(i, "focus").join(", ").toLowerCase()}.`,
};

const managementIncentives: ToolDef = {
  kind: "ai", id: "eq-management-incentives", title: "Management quality & incentive review", tagline: "What the proxy pays them to do, and whether it is what creates value.",
  description: "Reads the DEF 14A to establish what management is actually paid for: the annual and long-term incentive metrics with weights and payout curves, the compensation peer group, ownership guidelines and actual stakes, change-in-control and severance terms, clawback, pledging and hedging policies, and related-party transactions. Then judges whether those metrics line up with per-share value creation.",
  roles: ["markets"], specialties: [LO, ER, LS, MM], category: "Diligence", icon: "Scale", deliverable: "analysis", savesMinutes: 180, tags: ["proxy", "compensation", "governance"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "CCL" },
    { key: "peers", label: "Compare with", type: "tickers", placeholder: "RCL NCLH", help: "Optional: reads their proxies too" },
    { key: "lens", label: "Lens", type: "select", options: ["Long-term owner", "Activist", "Credit", "Short seller"], default: "Long-term owner" },
  ],
  example: { ticker: "CCL", peers: ["RCL", "NCLH"], lens: "Long-term owner" },
  effort: "high",
  instructions: `1. search_filing on the latest DEF 14A for "compensation discussion and analysis", "annual incentive plan", "performance share units", "relative total shareholder return", "compensation peer group", "stock ownership guidelines", "clawback", "change in control", "severance", "pledging", "hedging", "perquisites", "CEO pay ratio", "say-on-pay" and "related party transactions". read_filing to expand each hit and quote the metric definitions and weights.
2. Build the incentive table: each metric, its weight, the threshold, target and maximum levels, the payout curve, and the actual payout last year. Note whether the metrics are adjusted or GAAP and who approves the adjustments; an adjusted-EBITDA bonus with discretionary add-backs is materially weaker than a per-share or return-on-capital metric.
3. Test alignment: compare the incentive metrics with what drives per-share value for this business (from get_company_financials and get_xbrl_series: growth, margin, ROIC, FCF per share, the share-count trend). Flag the classic misalignments: revenue or absolute EBITDA growth with no capital charge, adjusted metrics that exclude recurring costs, EPS targets met through buybacks, option repricing, single-trigger vesting, outsized perquisites.
4. Ownership and skin in the game: from the beneficial ownership table take the officer and director group stake and the CEO's holdings as a multiple of salary; check the ownership guideline and whether it is met; flag pledging.
5. get_insider_transactions with limit 25 to see whether they buy with their own money or only sell what vests.
6. If peers are given, repeat steps 1 and 2 on their proxies and compare metric choice, pay quantum and ownership.
7. Apply the lens: an activist cares about the metric that could be changed and the entrenchment provisions; a credit lens cares about leverage-linked incentives and dividend or buyback pressure; a short seller cares about aggressive adjusted metrics and insider selling.
Produce: kpis (CEO total pay, percent performance-based, insider group stake, CEO ownership as a multiple of salary, CEO pay ratio, say-on-pay support); table "Incentive plan" (metric, weight, target, payout, GAAP or adjusted, alignment verdict); score "Governance scorecard" (metric alignment, ownership, severance and change of control, clawback, board independence and refreshment, related-party exposure; 0-5 with citations); bullets "Red flags" with the quoted language; table comparing peers when peers are given; qa "Questions for the board or IR"; caveats (proxy data is annual and backward-looking; realized pay differs from grant-date value).`,
  prompt: (i) => `Review management quality and incentives at ${T(i)} from the proxy${list(i, "peers").length ? `, compared with ${list(i, "peers").join(", ")}` : ""}, through a ${str(i, "lens", "long-term owner").toLowerCase()} lens.`,
};

const moatAssessment: ToolDef = {
  kind: "ai", id: "eq-moat-assessment", title: "Competitive moat assessment", tagline: "Which advantages are real, tested against disclosures and returns on capital.",
  description: "Tests each claimed source of competitive advantage against evidence in the filings: pricing power in revenue per unit or customer, retention and churn disclosures, gross margin level and stability versus peers, returns on invested capital against the cost of capital, customer and supplier concentration, and the counter-evidence in the competition and risk-factor sections. Scores every advantage and says what would erode it.",
  roles: ["markets", "student"], specialties: [LO, LS, ER, STU], category: "Research", icon: "Shield", deliverable: "analysis", savesMinutes: 180, tags: ["moat", "competition", "ROIC"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "NVDA" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "AMD AVGO INTC" },
    { key: "sources", label: "Advantages to test", type: "multiselect", options: ["Switching costs", "Network effects", "Scale & cost advantage", "Brand & pricing power", "Regulatory / licences", "Data & learning", "Distribution"], default: ["Switching costs", "Network effects", "Scale & cost advantage", "Brand & pricing power", "Data & learning"] },
  ],
  example: { ticker: "NVDA", peers: ["AMD", "AVGO", "INTC"], sources: ["Switching costs", "Scale & cost advantage", "Brand & pricing power", "Data & learning"] },
  effort: "medium",
  instructions: `1. get_company_financials and get_trading_comps for the subject and peers. Compute with calc: gross margin, operating margin, the stability of gross margin over eight quarters (range and standard deviation from get_xbrl_series), FCF conversion, and ROIC (NOPAT = operating income x (1 - effective tax rate); invested capital = total debt plus book equity less cash, or net PP&E plus working capital plus goodwill; state which definition you used and keep it consistent across peers). Compare ROIC with a plausible cost of capital and state the spread: a moat that does not show up as a return above the cost of capital is a claim, not a moat.
2. search_filing on the latest 10-K for "competition", "our competitors", "customers", "one customer accounted for", "concentration of credit risk", "intellectual property", "patents", "suppliers", "manufacturing", "backlog", "pricing" and "seasonality". read_filing to expand the competition section fully and quote how the company itself describes the competitive field.
3. Evidence per advantage: switching costs need retention, contract length or migration-cost disclosure; network effects need two-sided growth data; scale needs a unit-cost or gross-margin gap against peers that widens with volume; brand needs realized price increases; regulatory needs the licence or approval named; a data advantage needs a disclosed feedback loop, not an assertion.
4. Counter-evidence: pull the two risk factors that most directly threaten the advantage, any customer above ten percent of revenue, supplier dependence, and get_recent_filings for 8-K items 2.06 (impairment) or 5.02 (executive departures) that suggest erosion.
5. Durability: state the reinvestment runway (capex and R&D as a percent of revenue against the growth it buys) and the one development that would break each advantage.
Produce: kpis (gross margin versus peer median, ROIC, ROIC less cost of capital, gross margin stability, revenue growth versus peers, customer concentration); score "Moat scorecard" (one row per advantage tested, 0-5, note citing the disclosure); table "Evidence" (advantage, the disclosure that supports it, the counter-evidence, verdict); scatter of peer gross margin against revenue growth with the subject emphasised; bar of ROIC across the peer set; bullets "What would erode it"; caveats (ROIC definitions differ and goodwill-heavy balance sheets distort them; fiscal years are not calendarized).`,
  prompt: (i) => `Assess ${T(i)}'s competitive moat${list(i, "peers").length ? ` against ${list(i, "peers").join(", ")}` : ""}, testing ${list(i, "sources").join(", ").toLowerCase()}.`,
};

const mergerArb: ToolDef = {
  kind: "ai", id: "evd-merger-arb", title: "Merger arbitrage workflow", tagline: "Read the agreement, date the conditions, then price the spread.",
  description: "Works a deal the way an event-driven analyst does: finds the definitive merger agreement and proxy in EDGAR, extracts the consideration, conditions, outside date, termination fees, regulatory efforts standard and no-shop terms, dates the remaining milestones from 8-K and 425 filings, then computes the gross and annualized spread, the downside to the unaffected price, the market-implied probability and the breakeven probability.",
  roles: ["markets"], specialties: [ED, LS, MM, DC], category: "Sourcing & deals", icon: "Handshake", deliverable: "analysis", savesMinutes: 360, tags: ["merger arb", "spread", "regulatory"],
  fields: [
    { key: "target", label: "Target ticker", type: "ticker", required: true, placeholder: "HES" },
    { key: "acquirer", label: "Acquirer ticker", type: "ticker", placeholder: "CVX", help: "Leave blank for a sponsor or private buyer" },
    { key: "announcedFrom", label: "Search filings from", type: "date", default: "2023-06-01" },
    { key: "probability", label: "Your probability of close", type: "number", unit: "%", default: 85, min: 1, max: 99 },
    { key: "closeDays", label: "Days to expected close", type: "number", unit: "days", default: 120, min: 5, max: 1095 },
  ],
  example: { target: "HES", acquirer: "CVX", announcedFrom: "2023-06-01", probability: 85, closeDays: 120 },
  effort: "high",
  instructions: `1. Establish the deal's status before anything else. get_recent_filings on the target with forms ["8-K","25","15-12B","DEFM14A","S-4","425"] and limit 40, and read the item codes: an item 2.01 8-K, a Form 25 or a Form 15 means the deal closed and the target was delisted; an item 1.02 8-K means the agreement was terminated. If the deal is closed or terminated, stop the document hunt at once and write the post-mortem version instead: the terms as signed, the actual timeline from announcement to close or break, the realized return from the announcement-day price, and the two lessons for the next deal of this shape. Never quote a live spread on a dead deal and never keep searching for intermediate milestones once the outcome is known.
2. Find the documents. If get_recent_filings returned an unknown ticker, the target has already been delisted: resolve it by name with search_companies or edgar_fulltext_search and carry on with the post-mortem branch. edgar_fulltext_search with the target's name as entity and the phrase "agreement and plan of merger", forms ["8-K","DEFM14A","S-4","425","SC 14D9","SC TO-T"], from the given date. Identify the definitive agreement exhibit (usually EX-2.1) and the merger proxy or S-4.
3. Read the agreement with read_document, one query per term: "Merger Consideration", "Exchange Ratio", "Per Share Merger Consideration", "Termination Date" or "End Date" (the outside date and any automatic extensions), "Company Termination Fee", "Parent Termination Fee" or "Regulatory Termination Fee", "Conditions to the Merger", "Regulatory Efforts" or "reasonable best efforts", "Burdensome Condition", "No Solicitation" and "Superior Proposal", "Material Adverse Effect" and its carve-outs, "Dividends", "Financing", "Specific Performance". Quote the outside date and the fees exactly, with the section number.
4. Read the proxy or S-4 with read_document for "Background of the Merger", "Reasons for the Merger", "Opinion of" (the banker's methods and reference ranges), "Interests of the Directors and Officers", "Regulatory Approvals", "Litigation Relating to the Merger", "Appraisal Rights", the vote standard and the record date. Note the unaffected price or premium disclosure (often a 10-day or 30-day VWAP) and use it as the break reference.
5. Date the milestones. get_recent_filings on both parties with forms ["8-K","425","DEFA14A","SC 13E3","S-4/A"] and read the hits for HSR clearance or a second request, other jurisdictions (EU, UK CMA, China SAMR, CFIUS), the shareholder vote result, financing completion, outside-date extensions and any litigation ruling. Build a timeline of what has happened and what is left.
6. Price it. get_company_financials on the target and, for stock or mixed consideration, the acquirer, for the current prices. With calc: offer value = cash per share + exchange ratio x acquirer price; gross spread = offer value - target price; spread percent = gross spread / target price; simple annualized = spread percent x 365 / days; compounded annualized = (1 + spread percent) ^ (365 / days) - 1. Add any target dividends payable before close. Net the borrow cost on the acquirer short for stock deals. Downside = break price (the unaffected price, adjusted for what has changed since) / target price - 1. Market-implied probability = (target price - break) / (offer value - break); this is also the breakeven probability, so compare it with the user's probability. Probability-weighted value = p x (offer + dividends) + (1 - p) x break.
7. Judge the risk. State the regulatory theory of harm if any (horizontal overlap, vertical foreclosure, national security), who must approve, the realistic timeline, and whether the efforts standard and the reverse termination fee put the risk on the buyer. For stock deals give the hedge ratio in acquirer shares per target share.
TOOL BUDGET. Batch queries and stop when you have enough: at most eight read_document calls on the agreement and six on the proxy, and at most two full-text searches for any single milestone. If a date or approval cannot be found in three attempts, write "not found in the filings reviewed" and move on. Always produce the full output: an incomplete timeline is acceptable, a missing deliverable is not.
Produce: kpis (offer value, target price, gross spread percent, annualized, downside to break, market-implied probability); table "Deal terms" (term, what the agreement says, section, why it matters); table "Spread math" showing every step of the arithmetic; timeline of milestones with the outside date marked; checklist "Remaining conditions" with owner and expected date; risks (regulatory, vote, financing, MAE, timing) with severity; callout with the recommendation, size and hedge. For a closed or terminated deal, replace the spread kpis with the realized outcome (consideration actually paid, days from announcement to close, return from the announcement-day price) and keep the deal terms, timeline and risk blocks. Caveats: no options or borrow data unless supplied; the break price is an estimate.`,
  prompt: (i) => `Work the ${T(i, "target")}${str(i, "acquirer") ? ` / ${T(i, "acquirer")}` : ""} merger: read the agreement and proxy for terms, conditions, the outside date and regulatory risk, date the milestones, then price the spread at a ${num(i, "probability", 85)}% probability of close in ${num(i, "closeDays", 120)} days. Search filings from ${str(i, "announcedFrom", "2023-06-01")}.`,
};

const specialSituations: ToolDef = {
  kind: "ai", id: "evd-special-situation", title: "Spin-off, activism & index events", tagline: "Separations valued sum-of-the-parts, campaigns read from the 13D, index demand sized.",
  description: "Analyses the three non-merger event types from primary documents: a spin-off or split-off from the Form 10 information statement (ratio, tax treatment, debt allocation, stranded costs, carve-out financials) with a sum-of-the-parts valuation and the implied stub; an activist campaign from the SC 13D purpose and exhibits with the nomination window from the proxy and bylaws; and an index or share-class event with demand sized against average daily volume.",
  roles: ["markets"], specialties: [ED, LS, MM, QS], category: "Sourcing & deals", icon: "Layers", deliverable: "analysis", savesMinutes: 300, tags: ["spin-off", "activism", "index", "SOTP"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "WBD" },
    { key: "eventType", label: "Event", type: "select", required: true, options: ["Spin-off / split-off", "Activist campaign", "Index add, delete or rebalance", "Share class or listing change"], default: "Spin-off / split-off" },
    { key: "peers", label: "Peers for the parts", type: "tickers", placeholder: "NFLX DIS PARA FOXA" },
    { key: "notes", label: "What you know", type: "textarea", placeholder: "The announced structure, dates, or the activist's ask" },
  ],
  example: { ticker: "WBD", eventType: "Spin-off / split-off", peers: ["NFLX", "DIS", "PARA", "FOXA"], notes: "Separation of Streaming & Studios from Global Networks announced; watching the debt allocation and the tax treatment" },
  effort: "high",
  instructions: `Pick the branch that matches the event type and follow it fully; ignore the others.
SPIN-OFF / SPLIT-OFF. 1. get_recent_filings with forms ["8-K","10-12B","10-12B/A","S-1","S-4","424B"] and edgar_fulltext_search with the entity name plus "information statement" and "spin-off". 2. read_document on the Form 10 information statement with queries "distribution ratio", "record date", "distribution date", "intended to qualify", "Section 355", "separation and distribution agreement", "transition services agreement", "tax matters agreement", "indebtedness", "cash allocation", "unaudited pro forma", "combined financial statements", "stranded costs" or "dis-synergies", and "no trading market". Quote the ratio, the dates and the tax-opinion condition. 3. Build the sum of the parts: take each segment's revenue and EBITDA from the 10-K segment footnote (search_filing "segment") or get_xbrl_series, apply peer multiples from get_trading_comps on the peers given (justify each), carry corporate costs as a separate negative line, subtract net debt as allocated in the information statement, and bridge to the parent's current price to show the implied stub. 4. Note the mechanical flows: index funds must sell the spun entity if it is not index-eligible and the parent's weight changes at distribution; size that forced selling against average daily volume rather than asserting it.
ACTIVIST CAMPAIGN. 1. get_recent_filings with forms ["SC 13D","SC 13D/A","PREC14A","DEFC14A","DFAN14A","8-K"]. read_document on the 13D Item 4 "Purpose of Transaction", Item 5 for the stake and percent, Item 6 for any swap or option exposure, plus the letters and presentations filed as exhibits. Quote the ask. 2. Get the mechanics: search_filing on the DEF 14A for "advance notice", "nomination", "annual meeting of stockholders", "proxy access", "classified board", "special meeting" and "supermajority"; check the bylaws exhibit (EX-3) via edgar_fulltext_search if the proxy is silent. State the nomination window and whether it is open. 3. Value the ask: quantify each demand (divest a segment, cut costs by X, lever up and buy back, replace the CEO) with arithmetic from get_company_financials, and say what the stock is worth if the activist wins, loses, or settles. 4. Check the register: the five-percent holders from the proxy and whether the top holders are likely to support.
INDEX OR SHARE-CLASS EVENT. 1. Pull the float-relevant facts: cover-page shares outstanding from the latest 10-Q via get_xbrl_series or search_filing, the insider and five-percent stakes from the DEF 14A, and any multiple share classes from the 10-K "description of capital stock". 2. Compute float-adjusted shares and the implied index demand as a share of average daily volume; if the index weight or tracking assets are unknown, present demand per billion dollars of tracking assets and label the assumption. 3. Date the rebalance and state plainly that index methodology is external knowledge, not SEC data. 4. For a share-class collapse or re-listing, read the 8-K and any S-4 for the exchange terms and the voting arrangements.
Produce in every branch: kpis (event date, the headline value, the implied upside, the mechanical flow); a table carrying the main arithmetic (sum-of-the-parts by segment, or the value of each activist demand, or demand against ADV); timeline with the dated steps; checklist of what has to happen; risks with severity; callout with the trade expression (long the parent, own the stub, hedge with the peer, buy into forced selling) and the sizing logic; caveats naming every assumption that is not from a filing.`,
  prompt: (i) => `Analyse the ${str(i, "eventType", "spin-off").toLowerCase()} at ${T(i)}${list(i, "peers").length ? `, using ${list(i, "peers").join(", ")} for the parts` : ""}.${str(i, "notes") ? ` Context: ${str(i, "notes")}.` : ""}`,
};

const capStructureMap: ToolDef = {
  kind: "ai", id: "crd-capital-structure-map", title: "Capital structure map", tagline: "Every tranche in priority order with cumulative leverage and the maturity wall.",
  description: "Parses the debt footnote, the credit agreement and the indenture exhibits into a tranche table in priority order: obligor, face amount, coupon and rate basis, maturity including springing dates, security and guarantors, then cumulative gross and net leverage through each layer, cash interest, liquidity and the maturity wall. The table a credit analyst rebuilds by hand every quarter.",
  roles: ["markets"], specialties: [DC, LS, ED], category: "Credit & restructuring", icon: "Layers", deliverable: "table", savesMinutes: 240, tags: ["capital structure", "leverage", "maturities"],
  fields: [
    { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "LUMN" },
    { key: "ebitdaBasis", label: "EBITDA basis", type: "select", options: ["Reported (operating income + D&A)", "Adjusted, ex-SBC", "Company-defined (from the credit agreement)"], default: "Reported (operating income + D&A)" },
    { key: "includeLeases", label: "Treat operating leases as debt", type: "toggle", default: false },
  ],
  example: { ticker: "LUMN", ebitdaBasis: "Reported (operating income + D&A)", includeLeases: true },
  effort: "high",
  instructions: `1. get_company_financials for LTM EBITDA, cash, total debt and shares. get_xbrl_series with find set to "Debt|Notes|LineOfCredit|Lease|InterestExpense" to discover the filer's tags, then pull LongTermDebt, LongTermDebtCurrent, LongTermDebtNoncurrent, InterestExpense, OperatingLeaseLiability and any facility-level tags for six periods. Raw units: divide by 1e6.
2. search_filing on the latest 10-Q and 10-K for "long-term debt", "indebtedness", "senior notes", "term loan", "revolving credit facility", "letters of credit", "maturities of long-term debt", "covenant", "interest rate", "subsidiary guarantor" and "fair value of debt". read_filing to expand the debt footnote in full: every tranche with its amount, rate and maturity. The fair-value disclosure is often the only public mark on the bonds; use it and label it a level-2 estimate.
3. Confirm what the footnote does not give from the documents: edgar_fulltext_search with the entity name for "Credit Agreement" and "Indenture" restricted to forms ["8-K","10-K","10-Q","S-4"], then read_document on the EX-10 and EX-4 exhibits with queries "Applicable Margin", "Maturity Date", "Collateral", "Guarantors", "Springing", "Restricted Subsidiary", "Permitted Liens", "Excess Cash Flow". Show any springing maturity at the earlier date, not the stated one.
4. Order the tranches by priority: superpriority and DIP, ABL or revolver, first lien term loans and secured notes, 1.5 and second lien, unsecured notes, subordinated, preferred, then common. Group by obligor and flag structural subordination where an issuer is not a guarantor of the operating subsidiaries' debt.
5. With calc compute cumulatively through each layer: face outstanding, gross leverage, net leverage (after cash), leverage at the chosen EBITDA basis, and cash interest coverage ((EBITDA - capex) / cash interest). If leases are to be treated as debt, add the operating lease liability to the secured layers and say so. State the market value of debt where a fair-value or trading level is available, and the enterprise value implied by those prices.
6. Liquidity: cash, revolver commitment and drawn amount, letters of credit outstanding, availability, and any minimum-liquidity covenant, from the footnote and the liquidity section.
Produce: kpis (total debt, net debt, net leverage, secured leverage, cash interest coverage, weighted average coupon, nearest maturity); table "Capital structure" in priority order (tranche, obligor, face $mm, coupon, maturity, security and guarantors, cumulative net leverage) with totals; bar "Maturity wall" of amounts due by year; table "Liquidity" (source, amount, note); callout identifying where enterprise value would break at a stated multiple and therefore the fulcrum candidate; caveats (private debt and private credit are not public; PIK accruals, undrawn commitments, letters of credit, hedges, factoring, leases, pension and litigation claims may be missing; the credit agreement's defined EBITDA differs from reported).`,
  prompt: (i) => `Map ${T(i)}'s capital structure from the debt footnote and the credit documents on a ${str(i, "ebitdaBasis", "reported")} EBITDA basis${bool(i, "includeLeases") ? ", treating operating leases as debt" : ""}.`,
};

const creditRelativeValue: ToolDef = {
  kind: "ai", id: "crd-relative-value", title: "Credit relative value across tranches", tagline: "Yield to worst and spread per turn, within the stack and against peers.",
  description: "Compares instruments on the metrics a credit analyst trades on: yield to worst from the price and call schedule, spread to the benchmark, spread per turn of leverage through the tranche, and the adjustments for security, covenant quality, call protection, duration and liquidity. Works within one issuer's capital structure and against peer issuers, and concludes with an overweight or underweight and a trade expression.",
  roles: ["markets"], specialties: [DC, ED, LS], category: "Credit & restructuring", icon: "ArrowLeftRight", deliverable: "table", savesMinutes: 240, tags: ["credit", "relative value", "yield to worst"],
  fields: [
    { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "CCL" },
    { key: "peers", label: "Peer issuers", type: "tickers", placeholder: "RCL NCLH" },
    { key: "bonds", label: "Instruments", type: "csv", required: true, columns: "issuer,instrument,seniority,coupon,maturity,call_date,call_price,price,amount_mm", help: "Paste your runs or marks; TRACE prices are not available here" },
    { key: "benchmark", label: "Benchmark yield", type: "number", unit: "%", default: 4.2, help: "Treasury of similar maturity" },
  ],
  example: { ticker: "CCL", peers: ["RCL", "NCLH"], benchmark: 4.2, bonds: "issuer,instrument,seniority,coupon,maturity,call_date,call_price,price,amount_mm\nCCL,First-priority notes 2028,1L secured,7.000,2028-08-15,2026-08-15,103.5,101.75,2400\nCCL,Senior unsecured notes 2030,Unsecured,6.000,2030-05-01,2026-05-01,101.0,96.50,2000\nRCL,Senior unsecured notes 2029,Unsecured,5.500,2029-04-01,2026-04-01,101.0,98.25,1500" },
  effort: "high",
  instructions: `1. Establish the fundamentals for the issuer and every peer with get_company_financials and get_xbrl_series: LTM EBITDA, capex, cash interest expense, total and secured debt, cash. Compute gross and net leverage, secured leverage, interest coverage and (EBITDA - capex) / cash interest with calc.
2. For each pasted instrument compute the bond math with calc. Yield: build the semiannual cash flows and solve with irr, then annualize as a bond-equivalent yield. For a bond maturing in N years with coupon c per 100 of face at price P, use irr(-P, c/2, c/2, ..., c/2 + 100) over 2N periods and multiply the result by 2. Repeat to each call date using the call price as the redemption value. Yield to worst is the lowest of the yield to maturity and every yield to call. Report the current yield (coupon / price) alongside it.
3. Spread = yield to worst minus the benchmark yield, in basis points. Spread per turn of leverage = spread in basis points divided by the net leverage through that tranche (cumulative debt at that priority and above, divided by EBITDA). This is the primary cross-sectional metric; show it for every instrument.
4. Adjust the comparison instead of ranking raw numbers: note seniority and collateral, guarantor coverage, maintenance versus incurrence covenants, call protection and any make-whole, the duration difference, issue size and likely liquidity, and any ratings disclosed in the filings. Say which differences explain the spread gaps and which look like mispricing.
5. Within the issuer's own stack, test whether the secured-to-unsecured differential is consistent with the recovery implied by an enterprise value at a stated multiple: if the unsecured notes trade at a yield implying near-full recovery while enterprise value breaks in the secured tranche, that is the trade.
6. Conclude with an overweight or underweight per instrument and one or two trade expressions (long the loan against the bond, long secured against unsecured, or cash against CDS where a curve exists), with the reason and the risk that breaks it.
Produce: kpis (best relative-value instrument, its yield to worst and spread, the issuer's net leverage and coverage, the widest spread per turn in the set); table "Relative value" (issuer, instrument, seniority, coupon, maturity, price, current yield, yield to maturity, yield to call, yield to worst, spread bps, leverage through, spread per turn); scatter of leverage through the tranche against yield to worst with the subject issuer emphasised; bar of spread per turn by instrument; bullets "What explains the gaps"; callout with the recommendation and the trade; caveats (prices are user-supplied marks, not TRACE; yields assume semiannual coupons and clean prices with no accrued interest; loan yields need the base rate and any floor).`,
  prompt: (i) => `Run credit relative value for ${T(i)}${list(i, "peers").length ? ` against ${list(i, "peers").join(", ")}` : ""} across the pasted instruments, against a ${num(i, "benchmark", 4.2)}% benchmark.`,
};

const recoveryAnalysis: ToolDef = {
  kind: "ai", id: "crd-recovery-analysis", title: "Recovery analysis & fulcrum", tagline: "Waterfall by class at several multiples, going concern against liquidation.",
  description: "Runs the recovery work behind a distressed position: distributable value from a going-concern multiple range and from a liquidation analysis, claims by class in absolute-priority order including the secured deficiency drop-down, recoveries by tranche, the fulcrum security, and the best-interests comparison. Claims come from the debt footnote, leases, pension and contingencies.",
  roles: ["markets"], specialties: [DC, ED], category: "Credit & restructuring", icon: "Waterfall", deliverable: "analysis", savesMinutes: 300, tags: ["recovery", "fulcrum", "distressed"],
  fields: [
    { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "LUMN" },
    { key: "multiples", label: "Going-concern multiples", type: "text", default: "4 5 6", help: "Space separated EV/EBITDA multiples" },
    { key: "ebitda", label: "Distressed EBITDA", type: "number", unit: "$mm", help: "Leave blank to use LTM with a stated haircut" },
    { key: "scenario", label: "Analysis", type: "select", options: ["Going concern", "Liquidation", "Both"], default: "Both" },
  ],
  example: { ticker: "LUMN", multiples: "4 5 6", scenario: "Both" },
  effort: "high",
  instructions: `1. Build the claims stack first. get_company_financials and get_xbrl_series (find "Debt|Notes|Lease|Pension|AccountsPayable|Assets"), then search_filing on the 10-K and 10-Q for "long-term debt", "maturities", "operating lease", "finance lease", "pension", "other postretirement", "commitments and contingencies", "legal proceedings", "asset retirement" and "accounts payable". List every claim by class and by obligor: superpriority or DIP, ABL or revolver, first lien, 1.5 and second lien, unsecured notes, other general unsecured (trade payables, lease rejection damages, pension underfunding, litigation), subordinated, preferred, common.
2. Going-concern value: EBITDA (the user's distressed figure, or LTM EBITDA with an explicit stated haircut) times each multiple in the list, plus excess cash, less administrative and professional fees and any DIP repayment. Justify the multiple range from get_trading_comps on distressed-relevant peers and say that plan values are litigated.
3. Waterfall, in absolute-priority order: DIP superpriority, then administrative and professional claims, then secured claims to the value of their collateral with the deficiency dropping to general unsecured, then priority unsecured (taxes and wages), then general unsecured pro rata, then subordinated, then preferred, then common. Build it entity by entity where guarantees differ so structural subordination shows up, then consolidate. Use calc for every allocation and check that distributed value equals distributable value.
4. Identify the fulcrum: the most senior class not paid in full, which normally receives the reorganized equity. State the recovery of the class above and below it so the reader sees how thin the break is.
5. If liquidation is requested, apply recovery factors to each asset class from the balance sheet (cash at 100 percent, receivables 60 to 80 percent, inventory and PP&E lower, intangibles and goodwill near zero), subtract wind-down costs and trustee fees, and run the same waterfall. Compare each class's plan recovery with its liquidation recovery: that is the best-interests test.
6. Translate into prices: for each traded tranche compare the recovery per 100 of face with the market price if the user or the fair-value footnote supplies one, and state the implied return and the time to resolution.
Produce: kpis (distributable value at the base multiple, fulcrum class, fulcrum recovery, blended recovery on funded debt, residual equity value); table "Recovery by class" (class, claim $mm, recovery $mm at each multiple, recovery percent, cumulative leverage through the class) emphasising the fulcrum row; waterfall of value flowing down the classes at the base multiple; sensitivity of the fulcrum class recovery to the multiple and EBITDA; table "Liquidation analysis" when requested (asset, book value, recovery factor, proceeds); risks; caveats (trade, litigation, lease-rejection and intercompany claims are only knowable from post-petition schedules; plan value is contested; pension and tax claims may have priority).`,
  prompt: (i) => `Run a recovery analysis for ${T(i)} at ${str(i, "multiples", "4 5 6")}x${num(i, "ebitda") ? ` on $${num(i, "ebitda")}mm of distressed EBITDA` : " on LTM EBITDA with a stated haircut"} (${str(i, "scenario", "Both").toLowerCase()}), and identify the fulcrum.`,
};

const covenantReview: ToolDef = {
  kind: "ai", id: "crd-covenant-review", title: "Covenant & document review", tagline: "Baskets, incremental capacity, blockers and sacred rights, quoted with sections.",
  description: "Extracts the covenant package from credit agreements and indentures the way a covenant service does: restricted payments and investment capacity, incremental and ratio debt, free-and-clear amounts, the builder basket, unrestricted subsidiary capacity, change of control, asset sales and excess cash flow sweeps, the defined EBITDA with its add-back caps, financial covenants and headroom, amendment thresholds and sacred rights, and the J.Crew, Serta and double-dip blockers.",
  roles: ["markets"], specialties: [DC, ED, LS], category: "Credit & restructuring", icon: "ScrollText", deliverable: "analysis", savesMinutes: 420, tags: ["covenants", "indenture", "LME"],
  fields: [
    { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "CCL" },
    { key: "docType", label: "Documents", type: "select", options: ["Credit agreement (EX-10)", "Indenture (EX-4)", "Both"], default: "Both" },
    { key: "docUrl", label: "Document URL", type: "text", placeholder: "https://www.sec.gov/Archives/edgar/data/...", help: "Optional: a specific exhibit to read instead of searching" },
    { key: "purpose", label: "Purpose", type: "select", options: ["Lender protection review", "LME capacity (attacker)", "LME defence (holder)", "New-issue covenant summary"], default: "Lender protection review" },
  ],
  example: { ticker: "CCL", docType: "Both", purpose: "LME defence (holder)" },
  effort: "high",
  instructions: `1. Find the documents unless a URL is given. edgar_fulltext_search with the entity name and "Credit Agreement" or "Indenture", forms ["8-K","10-K","10-Q","S-4"], to locate EX-10 and EX-4 exhibits; get_recent_filings also lists the 8-K item 1.01 filings that carry new facilities and amendments. Take the most recent document plus every amendment and say which version you read: amendments scatter the operative terms across many exhibits.
2. Read with read_document, one query per provision, quoting the language and the section number: "Restricted Payments", "Permitted Investments", "Available Amount" or "Cumulative Credit" (the builder basket), "Incremental Facilities" or "Incremental Amount", "Free and Clear", "Ratio Debt", "Unrestricted Subsidiary", "Restricted Subsidiary", "Change of Control", "Asset Sale" and "Net Proceeds", "Excess Cash Flow", "Consolidated EBITDA" (the definition, add-back caps and the synergy window), "Financial Covenant", "Springing", "Equity Cure", "Required Lenders", "each affected Lender" or sacred rights, "open market purchase", "pro rata", "Applicable Premium" or "Make-Whole", "MFN", "Springing Maturity", "Intercreditor".
3. Size the capacity with calc on the document's own definitions: maximum pari and priming debt today (ratio-based capacity at the tested level, plus free-and-clear amounts, plus a fully drawn revolver), restricted payment and investment capacity (general basket plus the builder plus any ratio test), and the value of assets that could be moved to an unrestricted subsidiary. Use the defined EBITDA where the definition is available and flag the gap against reported EBITDA (add-back caps have historically run 15 to 25 percent with 18 to 24 month synergy windows, and realized EBITDA has come in well below inception projections).
4. Covenant headroom: recompute each maintenance or springing covenant on the document's definitions from get_company_financials and get_xbrl_series; headroom = (covenant level - actual) / level, and state the EBITDA decline that breaches it. Note the revolver-usage trigger for springing tests (commonly 35 to 40 percent) and any step-downs.
5. Blockers and precedent: state whether the document has uptier blockers (pro rata protection and sacred rights against lien subordination), drop-down blockers, and double-dip or pari-plus protection, and whether the "open market purchase" language matches the Serta formulation. Note the direction of the market since Serta (5th Cir., December 2024): uptier blockers now in most new loans, lien-subordination sacred rights common, drop-down blockers still rare. Do not predict how a court would rule.
6. Answer the stated purpose: for an attacker, the specific transaction the document permits and the steps; for a defender, the holes to fix and the blocking position needed (Required Lenders above 50 percent for amendments, two thirds for collateral release under an indenture, unanimity on payment terms); for a new issue, the one-page covenant summary with a grade.
Produce: kpis (net leverage, incremental pari capacity, restricted payment capacity, covenant headroom, nearest springing trigger); table "Covenant package" (provision, what it says, section, capacity or level, comment); table "Capacity build" showing the arithmetic; checklist "LME vulnerability" (uptier, drop-down, double-dip, exit consents; each with the protection present or absent); risks with severity; callout with the one-line verdict for the stated purpose; caveats (compliance certificates and add-backs are private; amendments may be unfiled; this is not legal advice and counsel must confirm).`,
  prompt: (i) => `Review ${T(i)}'s ${str(i, "docType", "Both").toLowerCase()} covenant package for ${str(i, "purpose", "lender protection review").toLowerCase()}.${str(i, "docUrl") ? ` Read this document: ${str(i, "docUrl")}.` : ""}`,
};

const distressedScreen: ToolDef = {
  kind: "ai", id: "crd-distressed-screen", title: "Distressed watchlist screen", tagline: "Leverage, coverage, burn, runway, the maturity wall and the hard 8-K events.",
  description: "Screens a watchlist for stress on the measures that precede a restructuring: net and secured leverage, cash interest coverage, burn and months of liquidity runway, the maturity wall inside 24 months, and the hard filing events (going-concern language, 8-K items 1.03, 2.04, 2.06 and 4.02, forbearances and covenant amendments). Ranks the list with a disclosed distress score.",
  roles: ["markets"], specialties: [DC, ED, LS], category: "Screening", icon: "Radar", deliverable: "table", savesMinutes: 240, tags: ["distressed", "screen", "going concern"],
  fields: [
    { key: "tickers", label: "Watchlist", type: "tickers", required: true, placeholder: "LUMN CCL WBD AAL RIG PARA" },
    { key: "leverage", label: "Net leverage threshold", type: "number", unit: "x", default: 5 },
    { key: "flags", label: "Events to check", type: "multiselect", options: ["Going-concern language", "8-K 1.03 bankruptcy", "8-K 2.04 acceleration", "8-K 2.06 impairment", "8-K 4.02 non-reliance", "Covenant amendment / forbearance", "Negative free cash flow", "Maturity inside 24 months"], default: ["Going-concern language", "8-K 2.04 acceleration", "Covenant amendment / forbearance", "Negative free cash flow", "Maturity inside 24 months"] },
  ],
  example: { tickers: ["LUMN", "CCL", "WBD", "AAL", "RIG", "PARA"], leverage: 5, flags: ["Going-concern language", "8-K 2.04 acceleration", "Covenant amendment / forbearance", "Negative free cash flow", "Maturity inside 24 months"] },
  effort: "high",
  instructions: `1. For each ticker, get_company_financials for LTM EBITDA, operating cash flow, capex, cash, debt and shares, and get_xbrl_series for InterestExpense and the debt tags over six periods (divide raw units by 1e6).
2. With calc compute for each name: gross and net leverage (net debt / EBITDA), cash interest coverage (EBITDA / cash interest) and the fixed-charge proxy ((EBITDA - capex) / cash interest), free cash flow (operating cash flow - capex), and burn = EBITDA - cash interest - capex - taxes - mandatory amortization where disclosed. Months of runway = (cash + revolver availability) / monthly burn when the company is burning; say "not burning" otherwise.
3. Maturity wall: search_filing on the latest 10-K or 10-Q for "maturities of long-term debt" and "contractual obligations" and record amounts due in the next eight quarters; flag any maturity larger than cash plus one year of free cash flow, and any springing maturity.
4. Hard events: get_recent_filings with forms ["8-K","10-K","10-Q","NT 10-K"] and limit 30 per name, and read the item codes for 1.03 (bankruptcy), 2.04 (triggering event or acceleration), 2.03 (new debt), 2.06 (impairment), 4.02 (non-reliance) and 5.02. search_filing on the 10-K and 10-Q for "substantial doubt", "going concern", "forbearance", "covenant relief", "waiver", "amendment", "restructuring support agreement", "debt exchange". Run edgar_fulltext_search with the entity name and the phrases "substantial doubt about its ability to continue" and "restructuring support agreement" for anything the filing index misses.
5. Score each name out of 100 and publish the weighting: net leverage against the threshold, coverage below 2.0x, negative free cash flow, runway under 12 months, a maturity inside 24 months it cannot cover, and each hard event. Rank descending and say which names are stressed, which are distressed, and which are already in a process.
6. For the top two or three, add one line on where value is likely to break and which instrument to work next.
Produce: kpis (names screened, names above the leverage threshold, names with a hard event, the shortest runway, the nearest large maturity); table "Distress screen" (ticker, net leverage, secured leverage where known, coverage, free cash flow, runway months, next maturity and amount, flags, score), ranked; bar of the scores; timeline of the nearest maturities and dated events across the list; risks; caveats (private and private-credit debt is invisible; revolver availability and covenant definitions come from filings and may be stale; no bond prices or ratings).`,
  prompt: (i) => `Screen ${list(i, "tickers").join(", ")} for distress above ${num(i, "leverage", 5)}x net leverage, checking ${list(i, "flags").join(", ").toLowerCase()}.`,
};

const sectorPrimer: ToolDef = {
  kind: "ai", id: "eq-sector-primer", title: "Sector note / industry primer", tagline: "Structure, drivers, KPIs, unit economics and the debates, built from the filings.",
  description: "Writes the industry primer that anchors coverage: the value chain and industry structure with revenue share across the covered set, the demand drivers and the cycle position, the KPIs that matter and where each is disclosed, unit economics and operating leverage, capital intensity and returns, regulation, and the live debates. Built from segment disclosures and XBRL rather than assertion.",
  roles: ["markets", "student"], specialties: [ER, LO, LS, MM, STU], category: "Research", icon: "Compass", deliverable: "research", savesMinutes: 480, tags: ["primer", "sector", "KPIs"],
  fields: [
    { key: "sector", label: "Sector", type: "text", required: true, placeholder: "US cruise lines" },
    { key: "tickers", label: "Covered set", type: "tickers", required: true, placeholder: "CCL RCL NCLH" },
    { key: "focus", label: "Sections to emphasise", type: "multiselect", options: ["Demand drivers", "Industry structure & share", "Pricing", "Unit economics", "Capital intensity & returns", "Regulation", "Cycle position", "Valuation framework"], default: ["Demand drivers", "Industry structure & share", "Unit economics", "Cycle position", "Valuation framework"] },
  ],
  example: { sector: "US cruise lines", tickers: ["CCL", "RCL", "NCLH"], focus: ["Demand drivers", "Industry structure & share", "Unit economics", "Cycle position", "Valuation framework"] },
  effort: "high",
  instructions: `1. get_company_financials for every ticker and get_trading_comps across the set. Sum the revenue of the covered set and state each company's share of that set, making clear it is share of the covered set and not of the industry unless a filing sizes the market.
2. search_filing on each 10-K for "industry", "competition", the asset base ("our fleet", "our stores", "our rigs"), "segment", "pricing", "customers", "capacity", "regulation", "seasonality" and the sector KPI language (net yields, occupancy, RevPAR, same-store sales, rig utilization, average revenue per user, load factor, net revenue retention). read_filing to expand the two most informative passages per company and quote the KPI definitions: definitions differ between companies and fixing that is the first job of a primer.
3. get_xbrl_series for four to six years of revenue, operating income, D&A, capex and operating cash flow for each name; compute the set's growth rate, the margin range across the cycle, capital intensity (capex / revenue and capex / D&A) and the incremental margin in the last upcycle with calc.
4. Unit economics: build one unit of the business (a ship, a store, a rig, a subscriber cohort) from disclosed figures: revenue per unit, contribution margin, the capital cost and the payback, and the fixed-cost base that creates operating leverage. Show the arithmetic.
5. Structure and pricing: concentration across the set, barriers to entry with evidence, who sets price, contract length, and the cost pass-through mechanism. Use web_research only for third-party market data (association statistics, regulator data) and cite the links.
6. Cycle and debates: name the two or three indicators that turn first, where they stand in the most recent filings and 8-K guidance, and the live debates with the evidence each side needs.
Produce: markdown "Industry map" (value chain and who captures the margin); table "The covered set" (company, revenue, share of set, growth, EBITDA margin, capex/revenue, net leverage, EV/EBITDA); line chart of revenue by company over four to six years; markdown "Unit economics" with the arithmetic; bullets "KPI dictionary" (KPI, definition, where it is disclosed, why it matters, comparability warning); markdown "Cycle position"; bullets "The debates"; risks; table "Valuation framework" (metric, why this sector uses it, current range); nextSteps; caveats (fiscal years are not calendarized; industry size comes only from company disclosure or cited third parties).`,
  prompt: (i) => `Write an industry primer on ${str(i, "sector")} covering ${list(i, "tickers").join(", ")}, emphasising ${list(i, "focus").join(", ").toLowerCase()}.`,
};

const ideaScreener: ToolDef = {
  kind: "ai", id: "eq-idea-screener", title: "Idea screener over a ticker list", tagline: "Rank a universe on fundamentals, valuation against its own history, and insider flow.",
  description: "Screens a ticker list for the thesis type you pick and ranks it on a disclosed weighting: growth and margin trend from the quarterly series, FCF conversion, leverage and coverage, valuation against the set median and the company's own multi-year range, accrual quality, stock-based compensation intensity, and net insider buying. Returns the ranked table plus a one-paragraph rationale and the next diligence step for the top names.",
  roles: ["markets", "student"], specialties: [LS, QS, MM, ER, STU], category: "Screening", icon: "Filter", deliverable: "table", savesMinutes: 240, tags: ["screen", "idea generation", "ranking"],
  fields: [
    { key: "tickers", label: "Universe", type: "tickers", required: true, placeholder: "NVDA DDOG CCL LUMN WBD HES" },
    { key: "thesisType", label: "Thesis type", type: "select", options: ["Long: quality compounder", "Long: value / mean reversion", "Long: inflection", "Short: deteriorating fundamentals", "Short: accounting risk", "Event: catalyst driven"], default: "Long: value / mean reversion" },
    { key: "metrics", label: "Metrics", type: "multiselect", options: ["Revenue growth & trend", "Margin trend", "FCF conversion", "Leverage & coverage", "Valuation vs peers", "Valuation vs own history", "Accrual quality", "SBC intensity", "Insider flow"], default: ["Revenue growth & trend", "Margin trend", "FCF conversion", "Valuation vs peers", "Valuation vs own history", "Insider flow"] },
    { key: "maxNames", label: "Names to write up", type: "number", default: 3, min: 1, max: 6 },
  ],
  example: { tickers: ["NVDA", "DDOG", "CCL", "LUMN", "WBD", "HES"], thesisType: "Long: value / mean reversion", metrics: ["Revenue growth & trend", "Margin trend", "FCF conversion", "Valuation vs peers", "Valuation vs own history", "Insider flow"], maxNames: 3 },
  effort: "high",
  instructions: `1. Call get_company_financials once per ticker, and get_trading_comps across the whole list for a consistent multiple set and the median. Note every ticker that fails to resolve and continue.
2. Compute each selected metric with calc and put the formula in the table note: revenue growth (LTM against prior LTM) and the sequential trend from the quarterly series (last two quarters annualized against the prior two); margin trend (operating margin now against four quarters ago, in basis points); FCF conversion ((operating cash flow - capex) / EBITDA); net leverage and interest coverage; EV/EBITDA and EV/revenue against the set median; valuation against the company's own range using get_xbrl_series for multi-year fundamentals against current price data, labelled approximate; accrual ratio ((net income - operating cash flow) / average total assets); stock-based compensation as a percent of revenue; net insider buying from get_insider_transactions (open-market P less S in dollars, ignoring awards and withholdings).
3. Score and rank. Publish the weighting explicitly and orient it to the thesis type: a quality compounder weights margin trend, FCF conversion and returns; value / mean reversion weights the discount to the set median and to the company's own range with a solvency filter; deteriorating fundamentals inverts growth and margin trend; accounting risk weights the accrual ratio, the non-GAAP gap and stock-based compensation; catalyst driven weights dated events found through get_recent_filings. Normalize each metric within the list (rank or z-score) so scale differences do not dominate, and say which you used.
4. Write up the top N names: one paragraph each stating the mispricing, the single number that carries the thesis, the disconfirming evidence to look for, and the specific next step (which filing section, which KPI, which document).
5. Be explicit about what this screen cannot see: estimate revisions, short interest, borrow, options and alternative data are not available here, so the screen is fundamental and valuation based only.
Produce: kpis (universe size, names scored, best and worst score, the set's median multiple, the widest discount to own history); table "Screen" (ticker, one column per metric, score, rank), ranked, with every formula in the note; bar of the scores; scatter of EV/EBITDA against revenue growth with the top names emphasised; markdown or bullets with one paragraph per top name; nextSteps; caveats.`,
  prompt: (i) => `Screen ${list(i, "tickers").join(", ")} for a "${str(i, "thesisType", "Long: value / mean reversion")}" thesis on ${list(i, "metrics").join(", ").toLowerCase()}, and write up the top ${num(i, "maxNames", 3)}.`,
};

const positionNote: ToolDef = {
  kind: "ai", id: "pod-position-note", title: "Position note (multi-manager format)", tagline: "Thesis, downside, hedge, size, catalysts, cut level: one page for the PM.",
  description: "Drafts the note a pod analyst sends before a trade goes on, in platform format: the call and the size, the thesis in three lines, the variant view, the numbers against consensus, the downside case with the arithmetic that reaches the cut level, the hedge and the residual exposure, dated catalysts, and the risk metrics (volatility contribution, days to exit, loss at the cut) with the cut discipline stated.",
  roles: ["markets"], specialties: [MM, LS, ED, DC], category: "Portfolio", icon: "ClipboardList", deliverable: "memo", savesMinutes: 150, tags: ["position note", "sizing", "hedge", "pod"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "NVDA" },
    { key: "direction", label: "Direction", type: "select", options: ["Long", "Short"], default: "Long" },
    { key: "size", label: "Proposed size", type: "number", unit: "% of book", default: 3, step: 0.25 },
    { key: "targetUpside", label: "Target", type: "number", unit: "%", default: 35 },
    { key: "cutLevel", label: "Cut level", type: "number", unit: "%", default: 12 },
    { key: "horizon", label: "Horizon", type: "number", unit: "months", default: 9 },
    { key: "hedge", label: "Intended hedge", type: "text", placeholder: "short a semi-cap basket / the sector ETF / a named peer" },
  ],
  example: { ticker: "NVDA", direction: "Long", size: 3, targetUpside: 35, cutLevel: 12, horizon: 9, hedge: "short a semiconductor-capital-equipment basket to neutralise sector beta" },
  effort: "medium",
  instructions: `1. Ground the note in data before writing: get_company_financials, get_xbrl_series for eight quarters of revenue and operating income, search_filing on the latest 10-Q for the guidance and the KPI, get_recent_filings for dated events and the last results 8-K, and get_insider_transactions for positioning.
2. Write the call in one line: direction, size as a percent of the book, target, cut, horizon. Then the thesis in three falsifiable lines, then the variant view naming the consensus assumption it contradicts and the disclosure that supports the alternative.
3. The numbers: a short table of three to five lines (revenue growth, the KPI, margin, EPS or FCF, the exit multiple) with consensus (or the guide midpoint, labelled), our number, and the gap. Use calc.
4. The downside: build the bear case explicitly and show the arithmetic that produces the cut level, then say whether the stock reaches the cut through multiple compression, an estimate cut, or both. Compute reward-to-risk as target divided by cut and flag anything under 2:1; the platform benchmark is nearer 3:1.
5. The hedge: state what is hedged (market beta, sector, a factor, an input cost) and what residual exposure is intentionally kept, because the pod is paid for the residual. Give the instrument and a rough ratio, and say what the hedge costs (borrow, carry, tracking error).
6. Risk metrics: at the size given, state the contribution to book volatility (size times the name's annualized volatility, so a 3 percent position in a 45 percent volatility stock contributes roughly 135 basis points of standalone volatility), the days to exit at 20 percent of average daily volume (say so if ADV is not supplied), and the loss in basis points of the book if the cut is hit. Relate that to a pod drawdown ladder where capital is typically halved around a 5 percent drawdown and pulled near 7.5 percent.
7. Close with the cut discipline: the price or the event that triggers a re-underwrite, and who decides.
Produce: callout with the call and the size; markdown "Thesis" (three numbered lines); markdown "Variant view"; table "Our numbers vs consensus"; table "Downside to the cut" with the arithmetic; table "Sizing and risk" (size, volatility contribution, days to exit, loss at the cut in basis points, reward-to-risk); timeline "Catalysts"; risks; bullets "Hedge and residual exposure"; caveats (no options, borrow, ADV or factor-model data unless supplied). Keep the note short enough to read in two minutes.`,
  prompt: (i) => `Draft a pod position note: ${str(i, "direction", "Long").toLowerCase()} ${T(i)} at ${num(i, "size", 3)}% of the book, ${num(i, "targetUpside", 35)}% target against a ${num(i, "cutLevel", 12)}% cut over ${num(i, "horizon", 9)} months.${str(i, "hedge") ? ` Hedge: ${str(i, "hedge")}.` : ""}`,
};

const factorExposure: ToolDef = {
  kind: "ai", id: "pod-factor-exposure", title: "Factor exposure from fundamentals", tagline: "Which style tilts a basket carries, built from filings when no risk model is at hand.",
  description: "Explains the style exposures of a list of positions using fundamental proxies rather than a returns-based risk model: value from multiples and free cash flow yield, quality from margin stability, cash conversion and returns on capital, growth from the revenue trend, size from market capitalization, leverage from net debt and coverage, and a volatility proxy from revenue dispersion and the 52-week range. Z-scores each metric within the set and says what to hedge.",
  roles: ["markets"], specialties: [QS, MM, LS, LO], category: "Portfolio", icon: "Gauge", deliverable: "analysis", savesMinutes: 180, tags: ["factors", "exposure", "hedging"],
  fields: [
    { key: "tickers", label: "Positions", type: "tickers", required: true, placeholder: "NVDA DDOG CCL LUMN" },
    { key: "weights", label: "Weights", type: "text", placeholder: "3 2 -1.5 -1", help: "Percent of book in the same order; negative for shorts. Equal weights if blank" },
    { key: "factors", label: "Factors", type: "multiselect", options: ["Value", "Quality", "Growth", "Size", "Leverage", "Volatility proxy", "Capital intensity"], default: ["Value", "Quality", "Growth", "Size", "Leverage"] },
  ],
  example: { tickers: ["NVDA", "DDOG", "CCL", "LUMN"], weights: "3 2 -1.5 -1", factors: ["Value", "Quality", "Growth", "Size", "Leverage"] },
  effort: "medium",
  instructions: `1. State the method's limit in the first sentence of the summary: there is no returns history or covariance matrix here, so these are fundamental proxies for style factors, not a risk model's betas. They are useful for spotting an unintended tilt, not for predicting factor P&L.
2. get_company_financials for every ticker and get_trading_comps across the set. get_xbrl_series for eight quarters of revenue and operating income, and four years where available.
3. Build the metrics with calc: Value = EV/EBITDA, EV/revenue and free cash flow yield (FCF / market cap); Quality = gross margin level and its standard deviation over eight quarters, FCF conversion (FCF / EBITDA), ROIC (NOPAT / invested capital) and the accrual ratio; Growth = LTM revenue growth and the two-quarter sequential trend; Size = market capitalization (use its natural log); Leverage = net debt / EBITDA and interest coverage; Volatility proxy = the coefficient of variation of quarterly revenue plus the 52-week high-to-low range divided by the last price; Capital intensity = capex / revenue.
4. Z-score each metric within the set: z = (x - mean) / standard deviation, computed on the names available and winsorized at plus or minus 2.5 so one outlier cannot dominate. Invert the sign where a low value means high exposure (a low EV/EBITDA is a positive value score). Put the formula in the table note.
5. Aggregate to the book: multiply each name's z-score by its weight (equal weights if none given, longs positive and shorts negative) and sum to get the net tilt per factor. A long book of expensive, high-growth names hedged with a cheap, levered short is short value and long growth twice over: say that in plain words.
6. Recommend hedges: for each unintended tilt, give the direction and one practical expression (a sector or style basket, a paired name with the opposite score, or a size adjustment), and say what it costs in alpha given up.
Produce: kpis (net tilt on the two largest factors, gross and net exposure from the weights, the most concentrated single name, the least liquid name if ADV is known); table "Factor scores" (ticker, weight, one column per factor z-score, dominant tilt) with the formula in the note; bar of the book's net tilt by factor; scatter of the value score against the quality score with the largest positions emphasised; bullets "Unintended exposures and hedges"; caveats (fundamental proxies only; no returns covariance, no beta, no crowding data; fiscal periods are not calendarized).`,
  prompt: (i) => `Explain the factor exposures of ${list(i, "tickers").join(", ")}${str(i, "weights") ? ` at weights ${str(i, "weights")}` : " at equal weights"} across ${list(i, "factors").join(", ").toLowerCase()}, and say what to hedge.`,
};

const complianceFormat: ToolDef = {
  kind: "ai", id: "eq-compliance-format", title: "Research note compliance formatting", tagline: "Publishable layout, sourced claims, rating consistency and disclosure placeholders.",
  description: "Takes a draft note and returns it in publishable form with the compliance problems flagged: fact separated from opinion, every number attributed, the valuation methodology and the risks to the price target stated, the rating checked against its own definition and the implied return, promissory and selective-disclosure language removed, and the required disclosure placeholders inserted for the firm to confirm.",
  roles: ["markets"], specialties: [ER, LO, MM], category: "Communication", icon: "FileText", deliverable: "memo", savesMinutes: 90, tags: ["compliance", "research note", "disclosure"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "noteType", label: "Note type", type: "select", options: ["Initiation", "Rating change", "Price-target change", "Earnings note", "Thematic / industry"], default: "Rating change" },
    { key: "rating", label: "Rating", type: "select", options: ["Buy / Outperform / Overweight", "Hold / Neutral / Market-weight", "Sell / Underperform / Underweight"], default: "Buy / Outperform / Overweight" },
    { key: "priceTarget", label: "Price target", type: "number", unit: "$" },
    { key: "note", label: "Draft note", type: "textarea", required: true, placeholder: "Paste the draft" },
  ],
  example: { ticker: "DDOG", noteType: "Rating change", rating: "Buy / Outperform / Overweight", priceTarget: 165, note: "We are upgrading DDOG to Outperform. Management told us demand is inflecting and we are confident the stock will work over the next few months. Numbers are going higher and the multiple should re-rate to where it used to trade. We see 30% upside." },
  effort: "medium",
  instructions: `1. Check the facts before formatting. get_company_financials for the current price, market capitalization and the LTM figures, and search_filing or read_document on the latest 10-Q and the last results 8-K for any figure or guidance the draft asserts. Every number that stays in the note must be traceable to a filing, a disclosed company statement, or the analyst's own model labelled as an estimate.
2. Rewrite into the published layout: headline with the action; the rating, current price and price target with the implied return; a two-or-three-sentence summary; "What changed" (for a rating or target change, the estimate changes that justify it); the thesis in numbered points; the estimate table; "Valuation and price target" stating the method, the metric, the year and the multiple with its justification; "Risks to our target"; and the disclosure block.
3. Flag every compliance problem in a table rather than silently deleting it: unsourced figures; opinion stated as fact; promissory or return-guaranteeing language ("will work", "is guaranteed", "cannot lose"); anything implying non-public information from management ("management told us", "our checks confirm") which must be re-attributed to a public statement or removed; selective-disclosure and fair-treatment problems; superlatives with no evidence; a target change with no estimate or methodology change; missing risks; and internal inconsistency between the rating, the implied return and the rating definition.
4. Test the rating's internal logic: compute the implied return from the current price to the target with calc and compare it with the rating definition (a Buy usually needs a positive expected excess return over 12 months against the sector or index, a Hold sits inside a band, a Sell needs a negative one). If the implied return contradicts the rating, say so and state which one has to change.
5. Insert disclosure placeholders marked [FIRM TO CONFIRM], never asserted as facts: analyst certification (Regulation AC), analyst and firm ownership, investment-banking and non-investment-banking compensation relationships, market making, the rating distribution table, the price-target and rating history, the valuation methodology and risks statement, FINRA Rule 2241 separation and quiet periods, MiFID II research-payment language, and distribution restrictions by jurisdiction.
6. Do not soften the analytical content: the job is to make the same call defensible, not to hedge it away.
Produce: markdown "Reformatted note" (the publishable draft in full); table "Compliance issues" (the quoted phrase, the problem, the rule or principle at stake, the suggested wording); kpis (current price, target, implied return, rating consistency verdict, unsourced claims found); checklist "Pre-publication" (each required element, done or outstanding, owner); risks "Language risk" with severity; callout with the one change that matters most; caveats stating plainly that this is a drafting aid and the firm's compliance and legal teams own the final review.`,
  prompt: (i) => `Format this ${str(i, "noteType", "rating change").toLowerCase()} note on ${T(i)} for publication with a ${str(i, "rating", "Buy")} rating${num(i, "priceTarget") ? ` and a $${num(i, "priceTarget")} target` : ""}, and flag every compliance problem.\n\nDraft:\n${str(i, "note")}`,
};

const morningNote: ToolDef = {
  kind: "ai", id: "eq-morning-note", title: "Morning note drafter", tagline: "Overnight filings and news mapped to covered names, a paragraph each.",
  description: "Turns overnight developments into the morning-meeting product: for each covered name, the filing or event behind it, what it changes in the numbers, whether the rating or target moves, and the one-line takeaway for the desk. Finds the triggering filing in EDGAR rather than relying on the description, and ends with a ninety-second morning-call script.",
  roles: ["markets"], specialties: [ER, MM, LS], category: "Communication", icon: "MessageSquare", deliverable: "email", savesMinutes: 75, tags: ["morning note", "desk", "sell-side"],
  fields: [
    { key: "tickers", label: "Names", type: "tickers", required: true, placeholder: "NVDA DDOG" },
    { key: "event", label: "What happened", type: "textarea", required: true, placeholder: "What you saw overnight, one line per name" },
    { key: "audience", label: "Audience", type: "select", options: ["Sales & trading", "Institutional clients", "Internal PM group"], default: "Sales & trading" },
  ],
  example: { tickers: ["NVDA", "DDOG"], event: "NVDA filed an 8-K on new export licensing; DDOG announced a convertible note offering", audience: "Sales & trading" },
  effort: "low",
  instructions: `1. For each ticker, get_recent_filings with forms ["8-K","424B","10-Q","SC 13D","4"] and limit 10 to find the filing behind the event. read_document on the relevant exhibit (a press release, a prospectus supplement, a merger agreement) with a query matching the event, and quote the operative sentence. If no filing exists, use web_research and label the source; never state a fact with no source.
2. For each name write one tight paragraph: what was disclosed (with the filing and date), what it changes in the numbers (quantify with calc, even roughly: dilution from a convertible as the change in share count, revenue at risk from an export restriction as a percent of the segment), whether it changes the estimate, the rating or the target, and what the desk should say to clients.
3. Quantify the mechanics rather than gesturing at them: for a convertible, the size against market capitalization, the conversion premium and the share count if converted; for a buyback, the percent of shares and the days of volume it represents; for an 8-K item 5.02, who left and what they owned; for a 13D, the stake and the stated purpose.
4. Rank the names by how much the news matters, and say where a known price move already reflects it.
5. End with a ninety-second script for the morning call: three sentences per name at most, leading with the action.
Produce: table "Overnight" (name, what changed, filing and date, estimate or target impact, action); markdown with one paragraph per name; email with a subject line and the body ready to send to the chosen audience; bullets "Script for the call"; caveats (no intraday prices, no consensus, no sell-side aggregation; anything sourced from the press is labelled).`,
  prompt: (i) => `Draft the morning note for ${list(i, "tickers").join(", ")} for a ${str(i, "audience", "sales & trading").toLowerCase()} audience. Overnight: ${str(i, "event")}.`,
};

const pmPushback: ToolDef = {
  kind: "ai", id: "eq-pm-pushback", title: "PM pushback & thesis stress test", tagline: "A skeptical PM checks your facts, then asks the questions that break the thesis.",
  description: "Stress-tests a stock pitch the way a portfolio manager or an interviewer does: verifies the factual claims against the filings first, scores the pitch against the six-part memo structure, then asks the questions in order of how likely each is to break the thesis, with the answer a strong analyst would give and the data points that would falsify the call.",
  roles: ["markets", "student"], specialties: [LS, MM, ER, LO, STU], category: "Learning", icon: "MessageSquare", deliverable: "quiz", savesMinutes: 90, tags: ["pitch", "interview", "stress test"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "CCL" },
    { key: "direction", label: "Direction", type: "select", options: ["Long", "Short"], default: "Long" },
    { key: "thesis", label: "Your pitch", type: "textarea", required: true, placeholder: "Paste your pitch: call, thesis, variant view, catalyst, risks, sizing" },
    { key: "questionCount", label: "Questions", type: "number", default: 10, min: 5, max: 20 },
    { key: "seat", label: "Who is asking", type: "select", options: ["Multi-manager PM", "Long-only PM", "Sell-side director of research", "Hedge fund interviewer"], default: "Multi-manager PM" },
  ],
  example: { ticker: "CCL", direction: "Long", thesis: "Long CCL: bookings and onboard spend are at records, net yields keep rising, and the balance sheet deleverages by two turns over two years as the newbuild schedule slows. Consensus still values it on pre-pandemic multiples. Target 40% upside over 12 months.", questionCount: 10, seat: "Multi-manager PM" },
  effort: "medium",
  instructions: `1. Verify before you challenge. get_company_financials and get_xbrl_series for the figures the pitch asserts, and search_filing on the latest 10-K and 10-Q for the guidance, the KPI and the debt schedule. List any claim the filings contradict or cannot support, with the number that is actually disclosed. This is the part a human PM does in thirty seconds and it decides how the rest of the meeting goes.
2. Score the pitch out of 5 on each element of the buy-side structure: the call (direction and magnitude stated), a falsifiable thesis, a variant view that names the consensus assumption, a dated catalyst inside six to twelve months, two or three weighted risks with observables, and sizing with a cut level. Be specific about what is missing.
3. Ask the questions in the order a PM asks them, hardest first: what is priced in; who is on the other side and why they are wrong; what has to be true in the numbers and whether that is plausible against the disclosed base; what the downside is and how the cut is enforced; what the catalyst is and what happens if it slips; how the position is hedged and what the residual exposure is; how crowded the trade is (and for a short, borrow and squeeze risk); what would make you double the size; what would make you exit; and what you would need to see to admit the thesis is wrong.
4. For every question, supply the answer a strong analyst gives, grounded in a filing figure where possible, so the user can compare their own answer against it.
5. Close with the two data points that would falsify the thesis, the one that would confirm it, and the single piece of work to do before the position goes on. Adapt the tone to the seat: a multi-manager PM leads with risk and sizing, a long-only PM with the five-year business, a director of research with the defensibility of the published call, an interviewer with structure and composure.
Produce: kpis (claims checked, claims unsupported, structure score out of 30, the estimated chance the thesis survives contact with the filings); score "Pitch scorecard" (one row per structural element, 0-5, with the gap in the note); table "Fact check" (claim, what the filing says, source, verdict); qa with the requested number of questions, each with the strong answer; bullets "What would falsify this"; callout with the single biggest hole; nextSteps.`,
  prompt: (i) => `Act as a ${str(i, "seat", "multi-manager PM").toLowerCase()} and stress-test this ${str(i, "direction", "Long").toLowerCase()} pitch on ${T(i)} with ${num(i, "questionCount", 10)} questions.\n\nPitch:\n${str(i, "thesis")}`,
};

const postMortem: ToolDef = {
  kind: "ai", id: "eq-post-mortem", title: "Post-earnings post-mortem", tagline: "Expectation against outcome, the error classified, the lesson written as a rule.",
  description: "Closes the loop after a print: reconstructs what was actually reported from the results 8-K and the 10-Q, lines it up against the expectation you had, classifies the error (thesis, estimate, expectations, timing or sizing), attributes the price reaction, and writes the lesson as a rule to apply next quarter.",
  roles: ["markets", "student"], specialties: [MM, LS, ER, STU], category: "Reporting", icon: "RefreshCw", deliverable: "analysis", savesMinutes: 90, tags: ["post-mortem", "process", "attribution"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "WBD" },
    { key: "quarter", label: "Quarter", type: "text", required: true, placeholder: "Q2 2026" },
    { key: "expectation", label: "What you expected", type: "textarea", required: true, placeholder: "Your estimates and what you thought would move the stock" },
    { key: "priceMove", label: "Price reaction", type: "number", unit: "%", help: "Move on the print" },
    { key: "position", label: "Position at the print", type: "text", placeholder: "Long 2.5% of book, no hedge" },
  ],
  example: { ticker: "WBD", quarter: "Q2 2026", expectation: "Streaming EBITDA above $1.3bn, subscriber net adds above 5mm, and a firmer timeline for the separation; I expected the stock up on the split news", priceMove: -9, position: "Long 2.5% of book, no hedge" },
  effort: "medium",
  instructions: `1. Reconstruct the print. get_recent_filings with forms ["8-K","10-Q"] and read_document on the results press release with queries for each line in the expectation plus "outlook", "guidance" and the KPI names. Then search_filing on the 10-Q for anything the release omitted (segment detail, deferred revenue, one-time items, subsequent events).
2. Line the expectation up against the outcome: one row per expected line with the expectation, the actual, the delta, and where the number came from. Use calc for every delta and be honest about what was never actually forecast.
3. Classify each miss using exactly these categories, defining them in the note: thesis error (the business does not work the way you thought), estimate error (direction right, level wrong), expectations error (right on the business but the market had already priced it), timing error (right but early), sizing or hedging error (the position or hedge was wrong even though the analysis held). Say which single category explains most of the P&L.
4. Attribute the reaction: given the price move and the position, quantify the P&L in basis points of the book, and separate the part explained by the reported numbers from the part explained by the guide and by positioning into the print (use get_insider_transactions and any 13D/G activity, and say where short-interest or options data would be needed to finish the attribution).
5. Write the lesson as a rule that can be applied, not a sentiment: a rule names the trigger, the action and the evidence ("when the guide implies a second-half hockey stick above the trailing four-quarter incremental margin, halve the position before the print"). One or two rules at most.
Produce: kpis (revenue and EPS against expectation, the guide change, the price reaction, the P&L in basis points of the book); table "Expectation vs outcome" (line, expected, actual, delta, error class); markdown "What actually happened" with filing citations; bullets "Where the process failed"; checklist "Before the next print" with owner and due date; callout with the rule to carry forward; caveats (no intraday or options data; splitting fundamentals from positioning is judgment).`,
  prompt: (i) => `Run a post-mortem on ${T(i)} after ${str(i, "quarter")}.${num(i, "priceMove") ? ` The stock moved ${num(i, "priceMove")}% on the print.` : ""}${str(i, "position") ? ` Position: ${str(i, "position")}.` : ""} I expected: ${str(i, "expectation")}.`,
};

const expertCallNotes: ToolDef = {
  kind: "ai", id: "pod-expert-call-notes", title: "Expert call & channel-check synthesis", tagline: "Raw notes turned into thesis-tagged takeaways, verified where filings can verify.",
  description: "Converts expert-network call notes or channel-check findings into structured research: each claim tagged to the thesis point it supports or contradicts, rated for evidence quality, and cross-checked against the filings where a disclosure can confirm or deny it. Ends with the modeled drivers that should change, the follow-up questions, and the next expert profile worth calling.",
  roles: ["markets"], specialties: [MM, LS, LO, ER], category: "Diligence", icon: "Radio", deliverable: "analysis", savesMinutes: 90, tags: ["expert calls", "channel checks", "primary research"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "notes", label: "Call notes", type: "textarea", required: true, placeholder: "Paste your raw notes" },
    { key: "thesisPoints", label: "Thesis points", type: "textarea", placeholder: "The two or three claims your thesis rests on" },
    { key: "expert", label: "Who you spoke to", type: "text", placeholder: "Former regional sales director, left 4 months ago" },
  ],
  example: { ticker: "DDOG", notes: "Former regional sales director, departed 4 months ago. Renewals at the top 50 accounts are being repriced with 10-15% discounts on log volume, but attach rates on the newer security and AI modules are running well above plan. Competitive losses mostly to in-house open-source stacks, not to the large platform vendors. Sales cycles lengthened by about three weeks over the last two quarters.", thesisPoints: "1) Multi-product attach keeps net retention above 115%. 2) Pricing pressure on log volume is contained. 3) Competition is platform vendors, not DIY.", expert: "Former regional sales director, left 4 months ago" },
  effort: "medium",
  instructions: `1. Extract the discrete claims from the notes: one row per claim, in the expert's own terms, with the number if one was given. Do not merge claims or smooth them into a narrative; the value is in the specifics.
2. Tag each claim to the thesis point it supports or contradicts, or mark it new information. Where it contradicts, say what that does to the thesis.
3. Rate the evidence: first-hand against hearsay, the expert's vantage point and recency (how long since they left, which accounts or region they saw), sample size (one account or fifty), and whether the claim is checkable. A single former employee's view of pricing is a hypothesis; two independent, consistent accounts start to be evidence.
4. Verify what can be verified. search_filing on the latest 10-K and 10-Q for the relevant disclosure (net revenue retention, remaining performance obligations, deferred revenue, pricing language, competition, backlog, contract length) and get_xbrl_series for the series that would show the claimed effect (deferred revenue growth, revenue per customer, gross margin). State where the filings agree, disagree, or are silent, and quote them.
5. Translate into the model: which drivers should change, in which direction, and roughly by how much, with the arithmetic (a 10 to 15 percent repricing on the share of revenue in the affected product is a specific, testable number). Say which change is large enough to matter to the thesis.
6. Follow-ups: three questions that would resolve the biggest remaining uncertainty, and the profile of the next expert or channel to call (role, region, recency) so the next call triangulates rather than repeats.
7. Add the compliance note: no material non-public information, no current employees of the covered company, no confidential documents or customer data, and calls go through a compliance-screened network. Flag anything in the notes that reads like MNPI and recommend escalating it rather than using it.
Produce: table "Claims" (claim, thesis tag, supports or contradicts, evidence quality, what the filings say, verdict); kpis (claims captured, checkable claims, claims contradicted by filings, drivers affected); bullets "Model changes" with the arithmetic; qa "Follow-up questions"; bullets "Who to call next"; risks "Compliance and evidence risk" with severity; callout with the net effect on the thesis; caveats (a single expert is a hypothesis, not a data point; expert views are not disclosures).`,
  prompt: (i) => `Synthesise these ${T(i)} call notes into thesis-tagged takeaways and verify what the filings can verify.${str(i, "expert") ? ` Source: ${str(i, "expert")}.` : ""}${str(i, "thesisPoints") ? `\n\nMy thesis points:\n${str(i, "thesisPoints")}` : ""}\n\nNotes:\n${str(i, "notes")}`,
};

/* ======================================================================================
 * Calculator helpers
 * ====================================================================================== */

/** Required positive number with a readable error. */
const req = (i: Inputs, k: string, label: string): number => {
  const v = num(i, k, NaN);
  if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be a positive number.`);
  return v;
};

/** Bond-equivalent yield (semiannual compounding) solved by bisection. Price and redemption per 100 of face. */
function beYield(price: number, couponPct: number, years: number, redemption = 100): number | null {
  if (!(price > 0) || !(years > 0)) return null;
  const n = Math.max(1, Math.round(years * 2)), c = couponPct / 2;
  const pv = (y: number) => { let v = 0; for (let t = 1; t <= n; t++) v += c / Math.pow(1 + y / 2, t); return v + redemption / Math.pow(1 + y / 2, n); };
  let lo = -0.95, hi = 4;
  if (pv(lo) < price || pv(hi) > price) return null;
  for (let k = 0; k < 240; k++) { const mid = (lo + hi) / 2; if (pv(mid) > price) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/** Modified duration at a semiannually compounded yield. */
function modDuration(y: number, couponPct: number, years: number, redemption = 100): number {
  const n = Math.max(1, Math.round(years * 2)), c = couponPct / 2;
  let pv = 0, wt = 0;
  for (let t = 1; t <= n; t++) { const d = c / Math.pow(1 + y / 2, t); pv += d; wt += (t / 2) * d; }
  const r = redemption / Math.pow(1 + y / 2, n); pv += r; wt += (n / 2) * r;
  return pv > 0 ? wt / pv / (1 + y / 2) : 0;
}

/* ======================================================================================
 * Calculators
 * ====================================================================================== */

/** Price target from EV/EBITDA, EV/Sales and P/E with the enterprise-to-equity bridge. */
const priceTarget: ToolDef = {
  kind: "calc", id: "eq-price-target", title: "Price target from multiples", tagline: "Three target multiples, the EV-to-equity bridge, the blended target and the upside.",
  description: "Applies target multiples to forward metrics the way a sell-side target is built: EV/EBITDA and EV/Sales bridged through net debt and other claims to a per-share value, P/E applied straight to forward EPS, then blended, compared with the current price, and mapped to the rating band the implied return supports.",
  roles: ["markets", "student"], specialties: [ER, LO, LS, MM, STU], category: "Valuation", icon: "Target", savesMinutes: 45, tags: ["price target", "multiples", "upside"],
  fields: [
    { key: "price", label: "Current price", type: "number", unit: "$", required: true, default: 100 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", required: true, default: 100 },
    { key: "netDebt", label: "Net debt (negative = net cash)", type: "number", unit: "$mm", default: 0 },
    { key: "otherClaims", label: "Preferred + minority interest", type: "number", unit: "$mm", default: 0 },
    { key: "fwdEbitda", label: "Forward EBITDA", type: "number", unit: "$mm", default: 0 },
    { key: "targetEvEbitda", label: "Target EV/EBITDA", type: "number", unit: "x", default: 0 },
    { key: "fwdRevenue", label: "Forward revenue", type: "number", unit: "$mm", default: 0 },
    { key: "targetEvSales", label: "Target EV/Sales", type: "number", unit: "x", default: 0 },
    { key: "fwdEps", label: "Forward EPS", type: "number", unit: "$", default: 0 },
    { key: "targetPe", label: "Target P/E", type: "number", unit: "x", default: 0 },
    { key: "dividendYield", label: "Dividend yield", type: "number", unit: "%", default: 0 },
    { key: "primary", label: "Primary method", type: "select", options: ["EV/EBITDA", "EV/Sales", "P/E"], default: "EV/EBITDA" },
  ],
  example: { price: 24.5, shares: 1150, netDebt: 27500, otherClaims: 0, fwdEbitda: 6400, targetEvEbitda: 8.5, fwdRevenue: 25500, targetEvSales: 2.2, fwdEps: 1.35, targetPe: 14, dividendYield: 0, primary: "EV/EBITDA" },
  prefill: (c) => ({
    price: c.price?.last ?? 100,
    shares: c.balance.sharesOut ?? 100,
    netDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0),
    fwdEbitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0,
    fwdRevenue: c.ltm.revenue ?? 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const price = req(i, "price", "Current price"), shares = req(i, "shares", "Diluted shares");
    const netDebt = num(i, "netDebt"), other = num(i, "otherClaims"), div = num(i, "dividendYield") / 100;
    type M = { name: string; metric: number; multiple: number; ev: number; equity: number; ps: number };
    const methods: M[] = [];
    const addEv = (name: string, metric: number, multiple: number) => {
      if (metric > 0 && multiple > 0) { const ev = metric * multiple, equity = ev - netDebt - other; methods.push({ name, metric, multiple, ev, equity, ps: equity / shares }); }
    };
    addEv("EV/EBITDA", num(i, "fwdEbitda"), num(i, "targetEvEbitda"));
    addEv("EV/Sales", num(i, "fwdRevenue"), num(i, "targetEvSales"));
    const eps = num(i, "fwdEps"), pe = num(i, "targetPe");
    if (eps > 0 && pe > 0) { const ps = eps * pe; methods.push({ name: "P/E", metric: eps, multiple: pe, ev: ps * shares + netDebt + other, equity: ps * shares, ps }); }
    if (!methods.length) throw new Error("Enter at least one target multiple with its matching forward metric: EV/EBITDA with forward EBITDA, EV/Sales with forward revenue, or P/E with forward EPS.");
    const blended = methods.reduce((a, m) => a + m.ps, 0) / methods.length;
    const upside = blended / price - 1, total = upside + div;
    const rating = upside >= 0.15 ? "Buy / Outperform" : upside <= -0.1 ? "Sell / Underperform" : "Hold / Neutral";
    const p = methods.find((m) => m.name === str(i, "primary", "EV/EBITDA")) ?? methods[0];
    const mults = [0.8, 0.9, 1, 1.1, 1.2].map((k) => p.multiple * k);
    const mets = [0.9, 0.95, 1, 1.05, 1.1].map((k) => p.metric * k);
    const grid = mults.map((mx) => mets.map((mt) => (p.name === "P/E" ? mt * mx : (mt * mx - netDebt - other) / shares)));
    return {
      title: "Price target from multiples",
      summary: `The blended target is ${fmt.moneyRaw(blended, 2)} against a ${fmt.moneyRaw(price, 2)} price, ${fmt.pct(upside)} ${upside >= 0 ? "upside" : "downside"}${div > 0 ? ` and ${fmt.pct(total)} total return with the dividend` : ""}, which maps to ${rating}. The ${p.name} method carries the bridge: ${fmt.x(p.multiple)} on ${fmt.money(p.metric)} of forward metric implies ${fmt.money(p.ev)} of enterprise value and ${fmt.moneyRaw(p.ps, 2)} per share.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Blended target", value: fmt.moneyRaw(blended, 2) },
          { label: "Current price", value: fmt.moneyRaw(price, 2) },
          { label: "Implied return", value: fmt.pct(upside), tone: upside >= 0 ? "pos" : "neg" },
          { label: "Total return", value: fmt.pct(total), hint: "Price target plus the dividend yield" },
          { label: "Rating band", value: rating, tone: upside >= 0.15 ? "pos" : upside <= -0.1 ? "neg" : "neutral", hint: "Buy above +15%, Sell below -10% over 12 months" },
          { label: "Methods used", value: String(methods.length) },
        ] },
        { type: "table", title: "Target by method", columns: ["Method", "Forward metric", "Target multiple", "Implied EV ($mm)", "Implied equity ($mm)", "Per share", "Return"],
          rows: methods.map((m) => [m.name, m.name === "P/E" ? fmt.moneyRaw(m.metric, 2) : fmt.money(m.metric), fmt.x(m.multiple), fmt.money(m.ev), fmt.money(m.equity), fmt.moneyRaw(m.ps, 2), fmt.pct(m.ps / price - 1)]),
          totals: ["Blended (equal weight)", "", "", "", "", fmt.moneyRaw(blended, 2), fmt.pct(upside)], note: "Equity value = EV less net debt less preferred and minority interest. P/E is applied directly to forward EPS." },
        { type: "waterfall", title: `Enterprise to equity bridge, ${p.name} method (USD mm)`, format: "money",
          steps: [{ label: `${fmt.x(p.multiple)} x forward metric`, value: p.ev, total: true }, { label: "Less net debt", value: -netDebt }, { label: "Less preferred and minority", value: -other }, { label: "Equity value", value: p.equity, total: true }] },
        { type: "bar", title: "Target per share by method", format: "num", reference: { value: price, label: "Current price" },
          data: [...methods.map((m) => ({ label: m.name, value: m.ps })), { label: "Blended", value: blended, emphasis: true }] },
        { type: "sensitivity", title: `Per share: ${p.name} multiple x forward metric`, rowLabel: "Multiple", colLabel: p.name === "P/E" ? "Forward EPS" : "Forward metric ($mm)",
          rows: mults.map((m) => fmt.x(m)), cols: mets.map((m) => (p.name === "P/E" ? fmt.moneyRaw(m, 2) : fmt.num(m, 0))), values: grid, format: "num", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["Methods are equally weighted; weight them by hand if one is the house method.", "Forward metrics are user inputs: state the fiscal year and whether EBITDA and EPS are reported or adjusted.", "Rating bands are a convention (Buy above +15%, Sell below -10% over 12 months); use your firm's definitions.", "A target is not discounted to present value; a 12-month target implicitly earns the cost of equity."],
      nextSteps: ["Cross-check the target multiple against the peer set and the company's own history", "Run the bull/bear/base calculator to get the probability-weighted value and the skew", "Run the reverse DCF to see what growth the current price already requires"],
    };
  },
};

/** Bull / bear / base probability weighting, expected value and skew. */
const scenarioEv: ToolDef = {
  kind: "calc", id: "eq-scenario-ev", title: "Bull / bear / base expected value", tagline: "Probability-weighted target, expected return, reward-to-risk skew and the breakeven odds.",
  description: "Weights three price targets by probability to get the expected value and expected return, annualizes it over the horizon, computes the reward-to-risk skew and the probability-weighted upside against downside, and solves for the bull-case probability required to break even against the bear case.",
  roles: ["markets", "student"], specialties: [LS, MM, ER, ED, QS, STU], category: "Valuation", icon: "Split", savesMinutes: 30, tags: ["scenarios", "expected value", "skew"],
  fields: [
    { key: "price", label: "Current price", type: "number", unit: "$", required: true, default: 100 },
    { key: "bull", label: "Bull target", type: "number", unit: "$", required: true, default: 150 },
    { key: "base", label: "Base target", type: "number", unit: "$", required: true, default: 120 },
    { key: "bear", label: "Bear target", type: "number", unit: "$", required: true, default: 70 },
    { key: "pBull", label: "Probability, bull", type: "number", unit: "%", default: 25 },
    { key: "pBase", label: "Probability, base", type: "number", unit: "%", default: 55 },
    { key: "pBear", label: "Probability, bear", type: "number", unit: "%", default: 20 },
    { key: "horizon", label: "Horizon", type: "number", unit: "months", default: 12, min: 1, max: 60 },
    { key: "dividendYield", label: "Dividend yield", type: "number", unit: "%", default: 0 },
  ],
  example: { price: 24.5, bull: 38, base: 29, bear: 15, pBull: 30, pBase: 45, pBear: 25, horizon: 12, dividendYield: 0 },
  prefill: (c) => ({ price: c.price?.last ?? 100, bull: (c.price?.last ?? 100) * 1.4, base: (c.price?.last ?? 100) * 1.15, bear: (c.price?.last ?? 100) * 0.7 }),
  compute: (i: Inputs): WorkflowOutput => {
    const price = req(i, "price", "Current price");
    const h = req(i, "horizon", "Horizon"), div = num(i, "dividendYield") / 100;
    const cases = [
      { name: "Bull", target: num(i, "bull"), p: num(i, "pBull") },
      { name: "Base", target: num(i, "base"), p: num(i, "pBase") },
      { name: "Bear", target: num(i, "bear"), p: num(i, "pBear") },
    ];
    if (cases.some((c) => !(c.target > 0))) throw new Error("Enter a positive price target for the bull, base and bear cases.");
    const pSum = cases.reduce((a, c) => a + c.p, 0);
    if (pSum <= 0) throw new Error("Probabilities must sum to more than zero.");
    const rows = cases.map((c) => { const w = c.p / pSum, ret = c.target / price - 1 + div * (h / 12); return { ...c, w, ret, contrib: w * ret }; });
    const evPrice = rows.reduce((a, r) => a + r.w * r.target, 0);
    const expRet = rows.reduce((a, r) => a + r.contrib, 0);
    const annual = Math.pow(1 + expRet, 12 / h) - 1;
    const bull = rows[0], bear = rows[2];
    const skew = price > bear.target ? (bull.target - price) / (price - bear.target) : null;
    const up = rows.reduce((a, r) => a + r.w * Math.max(r.ret, 0), 0);
    const down = rows.reduce((a, r) => a + r.w * Math.min(r.ret, 0), 0);
    const wSkew = down < 0 ? up / -down : null;
    const breakeven = bull.target !== bear.target ? (price - bear.target) / (bull.target - bear.target) : null;
    const pb = [0.1, 0.2, 0.3, 0.4, 0.5], pbr = [0.1, 0.2, 0.3, 0.4, 0.5];
    const grid = pb.map((b) => pbr.map((r) => (b + r > 1 ? null : (b * bull.target + r * bear.target + (1 - b - r) * rows[1].target) / price - 1 + div * (h / 12))));
    return {
      title: "Bull / bear / base expected value",
      summary: `The probability-weighted value is ${fmt.moneyRaw(evPrice, 2)}, an expected return of ${fmt.pct(expRet)} over ${h} months (${fmt.pct(annual)} annualized). Reward-to-risk on the outer cases is ${skew === null ? "not computable" : `${skew.toFixed(2)}:1`}${wSkew === null ? "" : ` and ${wSkew.toFixed(2)}:1 after probability weighting`}. The bull case needs ${breakeven === null ? "n/a" : fmt.pct(breakeven, 0)} probability against the bear case alone to break even.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Expected value", value: fmt.moneyRaw(evPrice, 2) },
          { label: "Expected return", value: fmt.pct(expRet), tone: expRet >= 0 ? "pos" : "neg" },
          { label: "Annualized", value: fmt.pct(annual) },
          { label: "Reward / risk", value: skew === null ? "n/a" : `${skew.toFixed(2)}:1`, tone: skew !== null && skew >= 2 ? "pos" : "warn", hint: "Bull upside divided by bear downside; the practitioner benchmark is about 3:1" },
          { label: "Weighted up / down", value: wSkew === null ? "n/a" : `${wSkew.toFixed(2)}:1` },
          { label: "Breakeven bull odds", value: breakeven === null ? "n/a" : fmt.pct(breakeven, 0) },
        ] },
        { type: "table", title: "Scenarios", columns: ["Case", "Probability", "Target", "Return", "Weighted contribution"],
          rows: rows.map((r) => [r.name, fmt.pct(r.w, 0), fmt.moneyRaw(r.target, 2), fmt.pct(r.ret), fmt.pct(r.contrib)]),
          totals: ["Expected", fmt.pct(1, 0), fmt.moneyRaw(evPrice, 2), fmt.pct(expRet), ""], note: pSum !== 100 ? `Probabilities entered summed to ${fmt.num(pSum, 0)}% and were normalized to 100%.` : "Returns include the dividend yield over the horizon." },
        { type: "bar", title: "Return by scenario", format: "pct", reference: { value: 0, label: "Break even" },
          data: rows.map((r) => ({ label: `${r.name} (${fmt.pct(r.w, 0)})`, value: r.ret, emphasis: r.name === "Base" })) },
        { type: "sensitivity", title: "Expected return: bull probability x bear probability", rowLabel: "P(bull)", colLabel: "P(bear)",
          rows: pb.map((x) => fmt.pct(x, 0)), cols: pbr.map((x) => fmt.pct(x, 0)), values: grid, format: "pct" },
      ],
      caveats: ["Three discrete cases are a crude distribution: the tails are usually fatter than a bear case built from a multiple and an estimate cut.", "Probabilities are judgment. State what evidence would move them and by how much.", "Annualizing compounds the expected return over the horizon; it does not annualize the risk.", "Blank cells in the grid are combinations where the two probabilities exceed 100%."],
      nextSteps: ["Size the position from the cut level with the position sizing calculator", "Write the variant view that justifies the bull probability", "Re-run after the next print with updated cases"],
    };
  },
};

/** Position sizing from volatility, a risk budget with a stop, liquidity and the single-name cap. */
const positionSize: ToolDef = {
  kind: "calc", id: "pod-position-size", title: "Position sizing", tagline: "Volatility-based and risk-budget sizes, capped by liquidity and the single-name limit.",
  description: "Sizes a position four ways and takes the binding constraint: a volatility target (weight = target volatility contribution divided by the name's annualized volatility), a risk budget with a stop (weight = risk budget divided by the stop distance), a liquidity cap from days to exit at a share of average daily volume, and the single-name limit. Reports the loss at the stop in basis points of the book against a pod drawdown ladder.",
  roles: ["markets"], specialties: [MM, LS, QS, ED], category: "Portfolio", icon: "Gauge", savesMinutes: 30, tags: ["sizing", "risk budget", "liquidity"],
  fields: [
    { key: "capital", label: "Book capital", type: "number", unit: "$mm", required: true, default: 500 },
    { key: "vol", label: "Annualized volatility of the name", type: "number", unit: "%", required: true, default: 45 },
    { key: "targetVol", label: "Target volatility contribution", type: "number", unit: "bps", default: 100, help: "Standalone volatility this position should contribute" },
    { key: "riskBudget", label: "Risk budget for the position", type: "number", unit: "bps", default: 50, help: "Loss of book you accept if the stop is hit" },
    { key: "stop", label: "Stop distance", type: "number", unit: "%", default: 15 },
    { key: "price", label: "Price", type: "number", unit: "$", required: true, default: 50 },
    { key: "adv", label: "Average daily volume", type: "number", unit: "shares mm", default: 5 },
    { key: "participation", label: "Participation of ADV", type: "number", unit: "%", default: 20 },
    { key: "maxDays", label: "Maximum days to exit", type: "number", unit: "days", default: 3 },
    { key: "nameCap", label: "Single-name cap", type: "number", unit: "% of book", default: 5 },
  ],
  example: { capital: 500, vol: 45, targetVol: 135, riskBudget: 50, stop: 15, price: 178, adv: 32, participation: 20, maxDays: 3, nameCap: 5 },
  prefill: (c) => ({ price: c.price?.last ?? 50 }),
  compute: (i: Inputs): WorkflowOutput => {
    const capital = req(i, "capital", "Book capital"), vol = req(i, "vol", "Annualized volatility") / 100, price = req(i, "price", "Price");
    const targetVol = num(i, "targetVol") / 10000, budget = num(i, "riskBudget") / 10000, stop = num(i, "stop") / 100;
    const adv = num(i, "adv"), part = num(i, "participation") / 100, maxDays = num(i, "maxDays"), cap = num(i, "nameCap") / 100;
    if (!(stop > 0)) throw new Error("Stop distance must be greater than zero.");
    const wVol = targetVol > 0 ? targetVol / vol : Infinity;
    const wStop = budget > 0 ? budget / stop : Infinity;
    const liqDollars = adv > 0 && part > 0 && maxDays > 0 ? adv * price * part * maxDays : Infinity;
    const wLiq = liqDollars === Infinity ? Infinity : liqDollars / capital;
    const wCap = cap > 0 ? cap : Infinity;
    const cons = [
      { name: "Volatility target", w: wVol, note: `${fmt.bps(targetVol)} of book volatility / ${fmt.pct(vol, 0)} name volatility` },
      { name: "Risk budget with stop", w: wStop, note: `${fmt.bps(budget)} risk budget / ${fmt.pct(stop, 0)} stop` },
      { name: "Liquidity", w: wLiq, note: adv > 0 ? `${fmt.money(liqDollars)} tradable in ${fmt.num(maxDays, 0)} days at ${fmt.pct(part, 0)} of ${fmt.num(adv, 1)}mm ADV` : "No ADV supplied" },
      { name: "Single-name cap", w: wCap, note: `House limit ${fmt.pct(cap, 1)}` },
    ].filter((c) => Number.isFinite(c.w));
    if (!cons.length) throw new Error("Enter at least one constraint: a target volatility contribution, a risk budget with a stop, a liquidity cap, or a single-name cap.");
    const binding = cons.reduce((a, b) => (b.w < a.w ? b : a));
    const w = binding.w;
    const pos = w * capital, shares = pos / price;
    const days = adv > 0 && part > 0 ? shares / (adv * part) : null;
    const lossBps = w * stop, volContrib = w * vol;
    return {
      title: "Position sizing",
      summary: `The binding constraint is ${binding.name.toLowerCase()}, which caps the position at ${fmt.pct(w, 2)} of the book: ${fmt.money(pos)} and ${fmt.num(shares, 2)}mm shares. At that size the name contributes about ${fmt.bps(volContrib)} of standalone volatility, the stop costs ${fmt.bps(lossBps)} of the book, and exit takes ${days === null ? "an unknown number of" : fmt.num(days, 2)} days at ${fmt.pct(part, 0)} of average daily volume.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Recommended weight", value: fmt.pct(w, 2), tone: "info" },
          { label: "Position size", value: fmt.money(pos) },
          { label: "Shares", value: `${fmt.num(shares, 2)}mm` },
          { label: "Volatility contribution", value: fmt.bps(volContrib) },
          { label: "Loss at the stop", value: fmt.bps(lossBps), tone: lossBps > 0.005 ? "warn" : "neutral" },
          { label: "Days to exit", value: days === null ? "n/a" : fmt.num(days, 2) },
          { label: "Binding constraint", value: binding.name },
        ] },
        { type: "table", title: "Constraints", columns: ["Constraint", "Implied weight", "Position ($mm)", "Basis"],
          rows: cons.map((c) => [c.name, fmt.pct(c.w, 2), fmt.money(c.w * capital), c.note]), emphasisRow: cons.indexOf(binding),
          note: "Weight = target volatility / name volatility; = risk budget / stop distance; = tradable dollars / capital; = house cap. The smallest binds." },
        { type: "bar", title: "Implied weight by constraint", format: "pct",
          data: cons.map((c) => ({ label: c.name, value: c.w, emphasis: c === binding })) },
        { type: "sensitivity", title: "Weight from the risk budget: stop distance x risk budget", rowLabel: "Stop", colLabel: "Risk budget",
          rows: [0.05, 0.1, 0.15, 0.2, 0.3].map((s) => fmt.pct(s, 0)), cols: [25, 50, 75, 100, 150].map((b) => `${b} bps`),
          values: [0.05, 0.1, 0.15, 0.2, 0.3].map((s) => [25, 50, 75, 100, 150].map((b) => b / 10000 / s)), format: "pct" },
      ],
      caveats: ["Volatility contribution here is standalone: it ignores correlation with the rest of the book, so it overstates the marginal risk of a diversifying position and understates a correlated one.", "A stop is not a guaranteed exit level; gaps through the stop cost more than the risk budget.", "Platform drawdown ladders (capital roughly halved near a 5% drawdown, pulled near 7.5%) mean several positions stopping together matters more than any one of them.", "Days to exit assumes constant participation in normal volume; liquidity disappears exactly when you need it."],
      nextSteps: ["Check the correlation with the existing book before adding", "Set the re-underwrite trigger, not just the stop", "Run the pairs hedge calculator if the sizing is limited by sector or market beta"],
    };
  },
};

/** Merger arbitrage spread, annualized return and probability-weighted outcomes. */
const arbSpread: ToolDef = {
  kind: "calc", id: "evd-arb-spread", title: "Merger arb spread & annualized return", tagline: "Offer value, gross and net spread, annualized return, break downside and implied odds.",
  description: "Prices a deal: offer value from cash and stock consideration, gross spread against the current price, the spread net of dividends and the borrow cost on the acquirer short, simple and compounded annualized returns over the days to close, downside to the break price, the probability-weighted value, and the breakeven (market-implied) probability of close.",
  roles: ["markets"], specialties: [ED, LS, MM], category: "Sourcing & deals", icon: "Handshake", savesMinutes: 40, tags: ["merger arb", "spread", "annualized"],
  fields: [
    { key: "targetPrice", label: "Target price", type: "number", unit: "$", required: true, default: 50 },
    { key: "cash", label: "Cash per share", type: "number", unit: "$", default: 0 },
    { key: "ratio", label: "Exchange ratio", type: "number", unit: "x", default: 0, help: "Acquirer shares per target share" },
    { key: "acquirerPrice", label: "Acquirer price", type: "number", unit: "$", default: 0 },
    { key: "dividends", label: "Target dividends before close", type: "number", unit: "$/share", default: 0 },
    { key: "days", label: "Days to close", type: "number", unit: "days", required: true, default: 120, min: 1, max: 1825 },
    { key: "probability", label: "Probability of close", type: "number", unit: "%", default: 85, min: 1, max: 100 },
    { key: "breakPrice", label: "Break price (unaffected)", type: "number", unit: "$", required: true, default: 40 },
    { key: "borrowRate", label: "Borrow cost on the acquirer short", type: "number", unit: "%", default: 0.5 },
  ],
  example: { targetPrice: 158.5, cash: 0, ratio: 1.025, acquirerPrice: 162, dividends: 2, days: 120, probability: 85, breakPrice: 132, borrowRate: 0.5 },
  prefill: (c) => ({ targetPrice: c.price?.last ?? 50, breakPrice: (c.price?.last ?? 50) * 0.8 }),
  compute: (i: Inputs): WorkflowOutput => {
    const price = req(i, "targetPrice", "Target price"), days = req(i, "days", "Days to close"), brk = req(i, "breakPrice", "Break price");
    const cash = num(i, "cash"), ratio = num(i, "ratio"), acq = num(i, "acquirerPrice"), divs = num(i, "dividends");
    const p = Math.min(Math.max(num(i, "probability", 85) / 100, 0), 1), borrow = num(i, "borrowRate") / 100;
    const stockValue = ratio > 0 ? ratio * acq : 0;
    const offer = cash + stockValue;
    if (!(offer > 0)) throw new Error("Enter cash per share, or an exchange ratio with an acquirer price.");
    const borrowCost = stockValue * borrow * (days / 365);
    const gross = offer - price, net = offer + divs - borrowCost - price;
    const grossPct = gross / price, netPct = net / price;
    const simple = netPct * (365 / days), comp = Math.pow(1 + netPct, 365 / days) - 1;
    const down = brk / price - 1;
    const netOffer = offer + divs - borrowCost;
    const ev = p * netOffer + (1 - p) * brk, expRet = ev / price - 1;
    const expAnn = Math.pow(1 + Math.max(expRet, -0.999), 365 / days) - 1;
    const breakeven = netOffer !== brk ? (price - brk) / (netOffer - brk) : null;
    const rr = down < 0 ? netPct / -down : null;
    const probs = [0.6, 0.7, 0.8, 0.9, 0.95], dayGrid = [30, 60, 120, 180, 365];
    const grid = probs.map((pp) => dayGrid.map((d) => {
      const bc = stockValue * borrow * (d / 365), e = pp * (offer + divs - bc) + (1 - pp) * brk;
      return Math.pow(1 + Math.max(e / price - 1, -0.999), 365 / d) - 1;
    }));
    return {
      title: "Merger arb spread and annualized return",
      summary: `Offer value is ${fmt.moneyRaw(offer, 2)} against a ${fmt.moneyRaw(price, 2)} price: a gross spread of ${fmt.moneyRaw(gross, 2)} (${fmt.pct(grossPct)}) and ${fmt.pct(netPct)} net of dividends and borrow, worth ${fmt.pct(simple)} simple or ${fmt.pct(comp)} compounded annualized over ${fmt.num(days, 0)} days. The break price implies ${fmt.pct(down)} downside, so the market is pricing about ${breakeven === null ? "n/a" : fmt.pct(breakeven, 0)} probability of close against your ${fmt.pct(p, 0)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Offer value", value: fmt.moneyRaw(offer, 2) },
          { label: "Gross spread", value: `${fmt.moneyRaw(gross, 2)} (${fmt.pct(grossPct)})`, tone: gross >= 0 ? "pos" : "warn" },
          { label: "Annualized (compounded)", value: fmt.pct(comp), tone: comp >= 0 ? "pos" : "neg" },
          { label: "Downside to break", value: fmt.pct(down), tone: "neg" },
          { label: "Breakeven probability", value: breakeven === null ? "n/a" : fmt.pct(breakeven, 0), hint: "(price - break) / (offer - break): also the market-implied probability" },
          { label: "Expected return at your odds", value: fmt.pct(expRet), tone: expRet >= 0 ? "pos" : "neg" },
          { label: "Reward / risk", value: rr === null ? "n/a" : `${rr.toFixed(2)}:1` },
        ] },
        { type: "table", title: "Spread build", columns: ["Component", "Per share", "Note"],
          rows: [
            ["Cash consideration", fmt.moneyRaw(cash, 2), ""],
            ["Stock consideration", fmt.moneyRaw(stockValue, 2), ratio > 0 ? `${fmt.num(ratio, 4)}x at ${fmt.moneyRaw(acq, 2)}` : "Cash deal"],
            ["Offer value", fmt.moneyRaw(offer, 2), "Cash plus exchange ratio times acquirer price"],
            ["Target dividends to close", fmt.moneyRaw(divs, 2), "Added to the arbitrageur's return"],
            ["Borrow cost on the short", fmt.moneyRaw(-borrowCost, 2), ratio > 0 ? `${fmt.pct(borrow, 2)} on ${fmt.moneyRaw(stockValue, 2)} for ${fmt.num(days, 0)} days` : "No stock leg"],
            ["Target price", fmt.moneyRaw(-price, 2), "Cost today"],
            ["Net spread", fmt.moneyRaw(net, 2), fmt.pct(netPct)],
            ["Simple annualized", fmt.pct(simple), "Spread % x 365 / days"],
            ["Compounded annualized", fmt.pct(comp), "(1 + spread %) ^ (365 / days) - 1"],
            ["Probability-weighted annualized", fmt.pct(expAnn), `Expected value at ${fmt.pct(p, 0)} probability of close, annualized`],
          ], emphasisRow: 6 },
        { type: "bar", title: "Outcomes per share", format: "num", reference: { value: price, label: "Price today" },
          data: [{ label: "Deal closes", value: netOffer }, { label: `Expected (${fmt.pct(p, 0)})`, value: ev, emphasis: true }, { label: "Deal breaks", value: brk }] },
        { type: "sensitivity", title: "Annualized expected return: probability x days to close", rowLabel: "P(close)", colLabel: "Days",
          rows: probs.map((x) => fmt.pct(x, 0)), cols: dayGrid.map((d) => String(d)), values: grid, format: "pct", baseRow: 3, baseCol: 2 },
      ],
      caveats: ["The break price is an estimate. Practitioners anchor it on the unaffected price before the leak, adjusted for what has changed in the market and the business since.",
        "Stock deals need the hedge on: this assumes a short of the exchange ratio in acquirer shares, held to close, with no re-hedging and no collar or walk-away adjustment.",
        "Annualizing a short-dated spread flatters it: a 1% spread over 20 days annualizes above 18% but is one deal-break away from a 20% loss.",
        "Ignores financing cost on the long, ticking fees, dividends on the acquirer short, and taxes."],
      nextSteps: ["Read the merger agreement for the outside date, the efforts standard and the fees before sizing", "Check whether the reverse termination fee compensates for the regulatory risk", "Size with the position sizing calculator using the break price as the stop"],
    };
  },
};

/** Quick quarterly or annual earnings model with an EPS bridge and a sensitivity. */
const earningsModel: ToolDef = {
  kind: "calc", id: "eq-earnings-model", title: "Earnings model quick", tagline: "Revenue growth and margins to GAAP and non-GAAP EPS, with the bridge and a sensitivity.",
  description: "Rolls revenue growth, gross margin and operating expense growth into operating income, taxes, share count and EPS on both GAAP and non-GAAP bases, bridges the change in EPS into growth, margin, opex and share-count effects, and shows EPS across a growth and gross-margin grid.",
  roles: ["markets", "student"], specialties: [ER, LS, MM, LO, STU], category: "Modeling", icon: "FileSpreadsheet", savesMinutes: 60, tags: ["earnings model", "EPS", "margins"],
  fields: [
    { key: "revenue", label: "Prior-period revenue", type: "number", unit: "$mm", required: true, default: 1000 },
    { key: "growth", label: "Revenue growth", type: "number", unit: "%", default: 20 },
    { key: "priorGrossMargin", label: "Prior gross margin", type: "number", unit: "%", default: 80 },
    { key: "grossMargin", label: "Forecast gross margin", type: "number", unit: "%", default: 81 },
    { key: "opex", label: "Prior operating expenses", type: "number", unit: "$mm", default: 700 },
    { key: "opexGrowth", label: "Operating expense growth", type: "number", unit: "%", default: 15 },
    { key: "otherIncome", label: "Other income, net", type: "number", unit: "$mm", default: 0, help: "Interest income less interest expense" },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 21 },
    { key: "shares", label: "Prior diluted shares", type: "number", unit: "mm", required: true, default: 350 },
    { key: "shareChange", label: "Share count change", type: "number", unit: "%", default: 1.5 },
    { key: "sbc", label: "Stock-based compensation", type: "number", unit: "$mm", default: 0, help: "Added back for non-GAAP EPS" },
    { key: "consensusEps", label: "Consensus EPS", type: "number", unit: "$", default: 0 },
    { key: "price", label: "Price", type: "number", unit: "$", default: 0 },
  ],
  example: { revenue: 3800, growth: 23, priorGrossMargin: 80.5, grossMargin: 81, opex: 2750, opexGrowth: 17, otherIncome: 120, taxRate: 21, shares: 355, shareChange: 1.5, sbc: 720, consensusEps: 2.95, price: 148 },
  prefill: (c) => ({
    revenue: c.ltm.revenue ?? 1000,
    growth: c.ltm.revenue && c.ltm.priorRevenue ? Math.round((c.ltm.revenue / c.ltm.priorRevenue - 1) * 100) : 15,
    priorGrossMargin: c.ltm.revenue && c.ltm.grossProfit !== null ? Math.round((c.ltm.grossProfit / c.ltm.revenue) * 1000) / 10 : 80,
    grossMargin: c.ltm.revenue && c.ltm.grossProfit !== null ? Math.round((c.ltm.grossProfit / c.ltm.revenue) * 1000) / 10 : 80,
    opex: c.ltm.grossProfit !== null && c.ltm.operatingIncome !== null ? c.ltm.grossProfit - c.ltm.operatingIncome : 0,
    shares: c.balance.sharesOut ?? 100,
    sbc: c.ltm.sbc ?? 0,
    price: c.price?.last ?? 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const rev0 = req(i, "revenue", "Prior-period revenue"), sh0 = req(i, "shares", "Prior diluted shares");
    const g = num(i, "growth") / 100, gm0 = num(i, "priorGrossMargin") / 100, gm1 = num(i, "grossMargin") / 100;
    const opex0 = num(i, "opex"), opexG = num(i, "opexGrowth") / 100, other = num(i, "otherIncome");
    const tax = Math.min(Math.max(num(i, "taxRate") / 100, 0), 0.6), scg = num(i, "shareChange") / 100;
    const sbc = num(i, "sbc"), cons = num(i, "consensusEps"), price = num(i, "price");
    const rev1 = rev0 * (1 + g), opex1 = opex0 * (1 + opexG), sh1 = sh0 * (1 + scg);
    if (!(sh1 > 0)) throw new Error("Forecast share count must be positive.");
    const gp0 = rev0 * gm0, oi0 = gp0 - opex0, ni0 = (oi0 + other) * (1 - tax), eps0 = ni0 / sh0;
    const gp1 = rev1 * gm1, oi1 = gp1 - opex1, pre1 = oi1 + other, ni1 = pre1 * (1 - tax), eps1 = ni1 / sh1;
    const epsNg = (ni1 + sbc * (1 - tax)) / sh1;
    const eGrowth = (rev1 - rev0) * gm0 * (1 - tax) / sh0;
    const eMargin = rev1 * (gm1 - gm0) * (1 - tax) / sh0;
    const eOpex = -(opex1 - opex0) * (1 - tax) / sh0;
    const eShares = ni1 / sh1 - ni1 / sh0;
    const gs = [g - 0.06, g - 0.03, g, g + 0.03, g + 0.06], ms = [gm1 - 0.02, gm1 - 0.01, gm1, gm1 + 0.01, gm1 + 0.02];
    const grid = gs.map((gg) => ms.map((mm) => { const r = rev0 * (1 + gg); return ((r * mm - opex1 + other) * (1 - tax) + sbc * (1 - tax)) / sh1; }));
    return {
      title: "Earnings model quick",
      summary: `Revenue of ${fmt.money(rev1)} (${fmt.pct(g)} growth) at a ${fmt.pct(gm1, 1)} gross margin against ${fmt.pct(opexG)} opex growth gives ${fmt.money(oi1)} of operating income, a ${fmt.pct(oi1 / rev1, 1)} margin, GAAP EPS of ${fmt.moneyRaw(eps1, 2)} and non-GAAP EPS of ${fmt.moneyRaw(epsNg, 2)}${cons > 0 ? `, ${fmt.pct(epsNg / cons - 1)} against the ${fmt.moneyRaw(cons, 2)} consensus` : ""}. Operating leverage is the swing factor: the incremental margin is ${fmt.pct((oi1 - oi0) / (rev1 - rev0), 0)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Revenue", value: fmt.money(rev1), delta: fmt.pct(g) },
          { label: "Operating margin", value: fmt.pct(oi1 / rev1, 1), delta: `${fmt.bps(oi1 / rev1 - oi0 / rev0)} vs prior` },
          { label: "GAAP EPS", value: fmt.moneyRaw(eps1, 2), delta: eps0 !== 0 ? fmt.pct(eps1 / eps0 - 1) : undefined },
          { label: "Non-GAAP EPS", value: fmt.moneyRaw(epsNg, 2), hint: "Stock-based compensation added back after tax" },
          { label: "vs consensus", value: cons > 0 ? fmt.pct(epsNg / cons - 1) : "n/a", tone: cons > 0 && epsNg >= cons ? "pos" : cons > 0 ? "neg" : "neutral" },
          { label: "Implied P/E", value: price > 0 && epsNg > 0 ? fmt.x(price / epsNg) : "n/a" },
          { label: "Incremental margin", value: rev1 !== rev0 ? fmt.pct((oi1 - oi0) / (rev1 - rev0), 0) : "n/a" },
        ] },
        { type: "table", title: "Income statement (USD mm except per share)", columns: ["Line", "Prior", "Forecast", "Change"],
          rows: [
            ["Revenue", fmt.num(rev0, 0), fmt.num(rev1, 0), fmt.pct(g)],
            ["Gross profit", fmt.num(gp0, 0), fmt.num(gp1, 0), fmt.pct(gp1 / gp0 - 1)],
            ["Gross margin", fmt.pct(gm0, 1), fmt.pct(gm1, 1), fmt.bps(gm1 - gm0)],
            ["Operating expenses", fmt.num(opex0, 0), fmt.num(opex1, 0), fmt.pct(opexG)],
            ["Operating income", fmt.num(oi0, 0), fmt.num(oi1, 0), oi0 !== 0 ? fmt.pct(oi1 / oi0 - 1) : "n/a"],
            ["Operating margin", fmt.pct(oi0 / rev0, 1), fmt.pct(oi1 / rev1, 1), fmt.bps(oi1 / rev1 - oi0 / rev0)],
            ["Other income, net", fmt.num(other, 0), fmt.num(other, 0), "flat"],
            ["Tax", fmt.num(-(oi0 + other) * tax, 0), fmt.num(-pre1 * tax, 0), fmt.pct(tax, 0)],
            ["Net income", fmt.num(ni0, 0), fmt.num(ni1, 0), ni0 !== 0 ? fmt.pct(ni1 / ni0 - 1) : "n/a"],
            ["Diluted shares", fmt.num(sh0, 1), fmt.num(sh1, 1), fmt.pct(scg)],
            ["GAAP EPS", fmt.moneyRaw(eps0, 2), fmt.moneyRaw(eps1, 2), eps0 !== 0 ? fmt.pct(eps1 / eps0 - 1) : "n/a"],
            ["Non-GAAP EPS", "n/a", fmt.moneyRaw(epsNg, 2), `SBC ${fmt.money(sbc)} added back`],
          ], emphasisRow: 10 },
        { type: "waterfall", title: "EPS bridge, prior to forecast (USD per share)", format: "num",
          steps: [{ label: "Prior GAAP EPS", value: eps0, total: true }, { label: "Revenue growth", value: eGrowth }, { label: "Gross margin", value: eMargin }, { label: "Operating expenses", value: eOpex }, { label: "Share count", value: eShares }, { label: "Forecast GAAP EPS", value: eps1, total: true }] },
        { type: "sensitivity", title: "Non-GAAP EPS: revenue growth x gross margin", rowLabel: "Growth", colLabel: "Gross margin",
          rows: gs.map((x) => fmt.pct(x, 0)), cols: ms.map((x) => fmt.pct(x, 1)), values: grid, format: "num", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["One period, one tax rate, no working capital or cash flow: this sizes the EPS consequence of the drivers, it is not a three-statement model.",
        "Non-GAAP EPS here adds back stock-based compensation after tax only; match your own or the company's adjustment set before comparing with consensus.",
        "The EPS bridge holds the prior gross margin for the growth effect and the forecast revenue for the margin effect, so the two do not double count.",
        "Other income is held flat; model interest on the actual cash and debt balances if leverage is changing."],
      nextSteps: ["Compare the non-GAAP EPS with the consensus you pasted and decide whether the gap is a driver or a definition difference", "Take the forward EPS into the price target calculator", "Check the incremental margin against the last four quarters before trusting the operating leverage"],
    };
  },
};

/** Credit metrics plus yield to maturity, yield to call, yield to worst and spread. */
const bondMetrics: ToolDef = {
  kind: "calc", id: "crd-bond-metrics", title: "Credit metrics & yield to worst", tagline: "Leverage and coverage with YTM, YTC, YTW, spread and spread per turn.",
  description: "Computes the credit statistics and the bond math together: gross, net and secured leverage, interest coverage and the fixed-charge proxy, then yield to maturity and yield to call from the price by bisection on semiannual cash flows, yield to worst, the spread to the benchmark, spread per turn of leverage and modified duration.",
  roles: ["markets"], specialties: [DC, ED, LS], category: "Credit & restructuring", icon: "Percent", savesMinutes: 40, tags: ["credit", "yield to worst", "leverage"],
  fields: [
    { key: "ebitda", label: "LTM EBITDA", type: "number", unit: "$mm", required: true, default: 1000 },
    { key: "totalDebt", label: "Total debt", type: "number", unit: "$mm", required: true, default: 5000 },
    { key: "securedDebt", label: "Secured debt", type: "number", unit: "$mm", default: 0 },
    { key: "cash", label: "Cash", type: "number", unit: "$mm", default: 0 },
    { key: "cashInterest", label: "Cash interest expense", type: "number", unit: "$mm", default: 300 },
    { key: "capex", label: "Capex", type: "number", unit: "$mm", default: 200 },
    { key: "price", label: "Bond price", type: "number", unit: "per 100", required: true, default: 96 },
    { key: "coupon", label: "Coupon", type: "number", unit: "%", required: true, default: 6 },
    { key: "years", label: "Years to maturity", type: "number", unit: "years", required: true, default: 5 },
    { key: "callYears", label: "Years to first call", type: "number", unit: "years", default: 0 },
    { key: "callPrice", label: "Call price", type: "number", unit: "per 100", default: 100 },
    { key: "benchmark", label: "Benchmark yield", type: "number", unit: "%", default: 4.2 },
    { key: "priority", label: "Leverage through this tranche", type: "number", unit: "$mm", default: 0, help: "Debt at this priority and above; defaults to total debt" },
  ],
  example: { ebitda: 6100, totalDebt: 27000, securedDebt: 13000, cash: 1800, cashInterest: 1600, capex: 3200, price: 96.5, coupon: 6, years: 4.6, callYears: 1.6, callPrice: 101, benchmark: 4.2, priority: 13000 },
  prefill: (c) => ({
    ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0,
    totalDebt: c.balance.debt ?? 0,
    cash: c.balance.cash ?? 0,
    capex: c.ltm.capex ?? 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const ebitda = req(i, "ebitda", "LTM EBITDA"), debt = req(i, "totalDebt", "Total debt");
    const price = req(i, "price", "Bond price"), coupon = num(i, "coupon"), years = req(i, "years", "Years to maturity");
    const secured = num(i, "securedDebt"), cash = num(i, "cash"), interest = num(i, "cashInterest"), capex = num(i, "capex");
    const callYears = num(i, "callYears"), callPrice = num(i, "callPrice", 100), bench = num(i, "benchmark") / 100;
    const through = num(i, "priority") > 0 ? num(i, "priority") : debt;
    const gross = debt / ebitda, net = (debt - cash) / ebitda, sec = secured > 0 ? secured / ebitda : null;
    const cov = interest > 0 ? ebitda / interest : null, fccr = interest > 0 ? (ebitda - capex) / interest : null;
    const ytm = beYield(price, coupon, years);
    const ytc = callYears > 0 ? beYield(price, coupon, callYears, callPrice) : null;
    const ytw = ytm === null ? ytc : ytc === null ? ytm : Math.min(ytm, ytc);
    if (ytw === null) throw new Error("Could not solve a yield from that price, coupon and maturity. Check the inputs.");
    const worstIsCall = ytc !== null && ytm !== null && ytc < ytm;
    const current = coupon / price, spread = ytw - bench;
    const levThrough = through / ebitda;
    const perTurn = levThrough > 0 ? (spread * 10000) / levThrough : null;
    const dur = modDuration(ytw, coupon, worstIsCall ? callYears : years, worstIsCall ? callPrice : 100);
    const prices = [price - 8, price - 4, price, price + 4, price + 8], tenors = [Math.max(1, years - 2), Math.max(1, years - 1), years, years + 1, years + 2];
    const grid = prices.map((pp) => tenors.map((tt) => beYield(pp, coupon, tt)));
    return {
      title: "Credit metrics and yield to worst",
      summary: `Net leverage is ${fmt.x(net)} with ${cov === null ? "no" : fmt.x(cov)} interest coverage. At ${fmt.num(price, 2)} the bond yields ${fmt.pct(ytm ?? 0, 2)} to maturity${ytc === null ? "" : ` and ${fmt.pct(ytc, 2)} to the first call`}, so yield to worst is ${fmt.pct(ytw, 2)}${worstIsCall ? " (to call)" : " (to maturity)"}: ${fmt.bps(spread)} over the benchmark, or ${perTurn === null ? "n/a" : `${Math.round(perTurn)} bps`} per turn of leverage through the tranche.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Yield to worst", value: fmt.pct(ytw, 2), tone: "info", hint: worstIsCall ? "To first call" : "To maturity" },
          { label: "Spread to benchmark", value: fmt.bps(spread) },
          { label: "Current yield", value: fmt.pct(current, 2) },
          { label: "Net leverage", value: fmt.x(net), tone: net > 6 ? "warn" : "neutral" },
          { label: "Leverage through tranche", value: fmt.x(levThrough) },
          { label: "Spread per turn", value: perTurn === null ? "n/a" : `${Math.round(perTurn)} bps` },
          { label: "Modified duration", value: fmt.num(dur, 2) },
        ] },
        { type: "table", title: "Credit statistics and bond math", columns: ["Measure", "Value", "Formula"],
          rows: [
            ["Gross leverage", fmt.x(gross), "Total debt / EBITDA"],
            ["Net leverage", fmt.x(net), "(Total debt - cash) / EBITDA"],
            ["Secured leverage", sec === null ? "n/a" : fmt.x(sec), "Secured debt / EBITDA"],
            ["Interest coverage", cov === null ? "n/a" : fmt.x(cov), "EBITDA / cash interest"],
            ["Fixed-charge proxy", fccr === null ? "n/a" : fmt.x(fccr), "(EBITDA - capex) / cash interest"],
            ["Yield to maturity", ytm === null ? "n/a" : fmt.pct(ytm, 2), "Semiannual bisection on the cash flows to maturity"],
            ["Yield to first call", ytc === null ? "n/a" : fmt.pct(ytc, 2), `Redemption at ${fmt.num(callPrice, 2)} in ${fmt.num(callYears, 1)} years`],
            ["Yield to worst", fmt.pct(ytw, 2), "Lower of yield to maturity and every yield to call"],
            ["Spread", fmt.bps(spread), "Yield to worst less the benchmark yield"],
            ["Spread per turn of leverage", perTurn === null ? "n/a" : `${Math.round(perTurn)} bps`, "Spread in bps / leverage through the tranche"],
            ["Modified duration", fmt.num(dur, 2), "Macaulay duration at yield to worst / (1 + y/2)"],
          ], emphasisRow: 7 },
        { type: "bar", title: "Yields", format: "pct", reference: { value: bench, label: "Benchmark" },
          data: [{ label: "Current yield", value: current }, { label: "To maturity", value: ytm }, { label: "To call", value: ytc }, { label: "To worst", value: ytw, emphasis: true }] },
        { type: "sensitivity", title: "Yield to maturity: price x years to maturity", rowLabel: "Price", colLabel: "Years",
          rows: prices.map((x) => fmt.num(x, 1)), cols: tenors.map((x) => fmt.num(x, 1)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["Yields assume semiannual coupons, whole periods and a clean price: no accrued interest, no settlement convention, no day count.",
        "Yield to worst here tests maturity and one call date. A full call schedule, a make-whole period or a par call needs every date tested.",
        "Floating-rate loans need the base rate, the floor and the discount margin instead of a fixed-coupon yield.",
        "Leverage uses reported EBITDA; the credit agreement's defined EBITDA with its add-backs is usually lower, and covenant tests run on the defined figure."],
      nextSteps: ["Compare the spread per turn against the issuer's other tranches and against peers", "Test the recovery implied by the price with the recovery waterfall calculator", "Recompute on the credit agreement's defined EBITDA before quoting covenant headroom"],
    };
  },
};

/** Absolute-priority recovery waterfall with fulcrum identification. */
const recoveryWaterfall: ToolDef = {
  kind: "calc", id: "crd-recovery-waterfall", title: "Recovery waterfall", tagline: "Distributable value through the classes in priority order, with the fulcrum named.",
  description: "Runs a going-concern recovery waterfall for a simple capital structure under the absolute priority rule: DIP and superpriority, administrative and professional fees, secured claims with the deficiency dropping pro rata into general unsecured, priority unsecured, general unsecured, subordinated, preferred and common. Names the fulcrum class and shows leverage through each layer.",
  roles: ["markets"], specialties: [DC, ED], category: "Credit & restructuring", icon: "Layers", savesMinutes: 90, tags: ["recovery", "waterfall", "fulcrum"],
  fields: [
    { key: "ebitda", label: "Distressed EBITDA", type: "number", unit: "$mm", required: true, default: 500 },
    { key: "multiple", label: "Going-concern multiple", type: "number", unit: "x", required: true, default: 5 },
    { key: "excessCash", label: "Excess cash", type: "number", unit: "$mm", default: 0 },
    { key: "adminFees", label: "Administrative & professional fees", type: "number", unit: "$mm", default: 0 },
    { key: "dip", label: "DIP / superpriority", type: "number", unit: "$mm", default: 0 },
    { key: "revolver", label: "Revolver / ABL (secured)", type: "number", unit: "$mm", default: 0 },
    { key: "firstLien", label: "First lien debt", type: "number", unit: "$mm", default: 2000 },
    { key: "secondLien", label: "Second lien debt", type: "number", unit: "$mm", default: 0 },
    { key: "priorityClaims", label: "Priority unsecured (taxes, wages)", type: "number", unit: "$mm", default: 0 },
    { key: "unsecuredNotes", label: "Unsecured notes", type: "number", unit: "$mm", default: 1000 },
    { key: "otherUnsecured", label: "Other unsecured (trade, leases, pension, litigation)", type: "number", unit: "$mm", default: 0 },
    { key: "subordinated", label: "Subordinated debt", type: "number", unit: "$mm", default: 0 },
    { key: "preferred", label: "Preferred", type: "number", unit: "$mm", default: 0 },
    { key: "shares", label: "Shares outstanding", type: "number", unit: "mm", default: 100 },
  ],
  example: { ebitda: 3200, multiple: 4.5, excessCash: 500, adminFees: 250, dip: 0, revolver: 1000, firstLien: 9500, secondLien: 0, priorityClaims: 200, unsecuredNotes: 8500, otherUnsecured: 2500, subordinated: 0, preferred: 0, shares: 1000 },
  prefill: (c) => ({ ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0, excessCash: c.balance.cash ?? 0, shares: c.balance.sharesOut ?? 100 }),
  compute: (i: Inputs): WorkflowOutput => {
    const ebitda = req(i, "ebitda", "Distressed EBITDA"), mult = req(i, "multiple", "Going-concern multiple");
    const shares = num(i, "shares", 1);
    const value = ebitda * mult + num(i, "excessCash");
    const dip = num(i, "dip"), admin = num(i, "adminFees"), rev = num(i, "revolver"), l1 = num(i, "firstLien"), l2 = num(i, "secondLien");
    const prio = num(i, "priorityClaims"), notes = num(i, "unsecuredNotes"), other = num(i, "otherUnsecured"), sub = num(i, "subordinated"), pref = num(i, "preferred");
    const funded = dip + rev + l1 + l2 + notes + sub;
    if (funded + other + prio <= 0) throw new Error("Enter at least one claim: DIP, revolver, first lien, second lien, notes, subordinated or other unsecured.");
    let left = value;
    const take = (claim: number) => { const paid = Math.min(claim, Math.max(left, 0)); left -= paid; return paid; };
    const pDip = take(dip), pAdmin = take(admin), pRev = take(rev), p1 = take(l1), p2 = take(l2), pPrio = take(prio);
    const deficiency = rev - pRev + (l1 - p1) + (l2 - p2);
    const pool = notes + other + deficiency;
    const unsecPaid = Math.min(pool, Math.max(left, 0));
    const rate = pool > 0 ? unsecPaid / pool : 0;
    left -= unsecPaid;
    const pNotes = notes * rate, pOther = other * rate, pDef = deficiency * rate;
    const pSub = take(sub), pPref = take(pref);
    const equity = Math.max(left, 0);
    const layers = [
      { name: "DIP / superpriority", claim: dip, paid: pDip },
      { name: "Administrative & professional", claim: admin, paid: pAdmin },
      { name: "Revolver / ABL (secured)", claim: rev, paid: pRev + (rev > 0 && pool > 0 ? ((rev - pRev) / Math.max(deficiency, 1e-9)) * pDef : 0) },
      { name: "First lien", claim: l1, paid: p1 + (l1 > 0 && pool > 0 ? ((l1 - p1) / Math.max(deficiency, 1e-9)) * pDef : 0) },
      { name: "Second lien", claim: l2, paid: p2 + (l2 > 0 && pool > 0 ? ((l2 - p2) / Math.max(deficiency, 1e-9)) * pDef : 0) },
      { name: "Priority unsecured", claim: prio, paid: pPrio },
      { name: "Unsecured notes", claim: notes, paid: pNotes },
      { name: "Other unsecured", claim: other, paid: pOther },
      { name: "Subordinated", claim: sub, paid: pSub },
      { name: "Preferred", claim: pref, paid: pPref },
    ].filter((l) => l.claim > 0);
    let cum = 0;
    const rows = layers.map((l) => { cum += l.claim; return [l.name, fmt.num(l.claim, 0), fmt.num(l.paid, 0), fmt.pct(l.claim > 0 ? l.paid / l.claim : 0, 0), fmt.x(cum / ebitda)]; });
    const fulcrumIdx = layers.findIndex((l) => l.paid < l.claim - 0.5);
    const fulcrum = fulcrumIdx >= 0 ? layers[fulcrumIdx] : null;
    const fundedPaid = layers.filter((l) => !["Administrative & professional", "Priority unsecured", "Other unsecured", "Preferred"].includes(l.name)).reduce((a, l) => a + l.paid, 0);
    const mults = [mult - 1, mult - 0.5, mult, mult + 0.5, mult + 1].filter((m) => m > 0);
    const ebitdas = [ebitda * 0.8, ebitda * 0.9, ebitda, ebitda * 1.1, ebitda * 1.2];
    const notesRecovery = (e: number, m: number) => {
      if (notes <= 0) return null;
      let v = e * m + num(i, "excessCash");
      for (const c of [dip, admin, rev, l1, l2, prio]) { const paid = Math.min(c, Math.max(v, 0)); v -= paid; }
      const def = Math.max(rev + l1 + l2 - Math.max(e * m + num(i, "excessCash") - dip - admin, 0), 0);
      const p = notes + other + Math.min(def, rev + l1 + l2);
      return p > 0 ? Math.min(Math.max(v, 0) / p, 1) : null;
    };
    return {
      title: "Recovery waterfall",
      summary: `${fmt.money(ebitda)} of distressed EBITDA at ${fmt.x(mult)} plus excess cash gives ${fmt.money(value)} of distributable value against ${fmt.money(funded + other + prio + admin)} of claims. ${fulcrum ? `The fulcrum is the ${fulcrum.name.toLowerCase()} class at ${fmt.pct(fulcrum.paid / fulcrum.claim, 0)} recovery: it is the most senior class not paid in full, so it normally takes the reorganized equity.` : "Every class is paid in full and value remains for the equity."} Residual equity value is ${fmt.money(equity)}${shares > 0 ? ` (${fmt.moneyRaw(equity / shares, 2)} per share)` : ""}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Distributable value", value: fmt.money(value) },
          { label: "Total claims", value: fmt.money(funded + other + prio + admin) },
          { label: "Fulcrum class", value: fulcrum ? fulcrum.name : "None (equity in the money)", tone: fulcrum ? "warn" : "pos" },
          { label: "Fulcrum recovery", value: fulcrum ? fmt.pct(fulcrum.paid / fulcrum.claim, 0) : "n/a" },
          { label: "Blended funded-debt recovery", value: funded > 0 ? fmt.pct(fundedPaid / funded, 0) : "n/a" },
          { label: "Residual equity", value: fmt.money(equity), tone: equity > 0 ? "pos" : "neg" },
          { label: "Value break leverage", value: fmt.x(value / ebitda) },
        ] },
        { type: "table", title: "Recovery by class (USD mm)", columns: ["Class", "Claim", "Recovery", "Recovery %", "Cumulative leverage through"],
          rows, emphasisRow: fulcrumIdx >= 0 ? fulcrumIdx : undefined,
          totals: ["Total", fmt.num(layers.reduce((a, l) => a + l.claim, 0), 0), fmt.num(layers.reduce((a, l) => a + l.paid, 0), 0), "", ""],
          note: "Absolute priority: DIP, then administrative claims, then secured to the value of collateral with the deficiency dropping pro rata into general unsecured, then priority unsecured, general unsecured, subordinated, preferred, common." },
        { type: "waterfall", title: "Value through the structure (USD mm)", format: "money",
          steps: [{ label: "Distributable value", value: value, total: true }, ...layers.map((l) => ({ label: l.name, value: -l.paid })), { label: "Residual to equity", value: equity, total: true }] },
        { type: "sensitivity", title: "Unsecured notes recovery: multiple x EBITDA", rowLabel: "Multiple", colLabel: "EBITDA ($mm)",
          rows: mults.map((m) => fmt.x(m)), cols: ebitdas.map((e) => fmt.num(e, 0)),
          values: mults.map((m) => ebitdas.map((e) => notesRecovery(e, m))), format: "pct", baseRow: mults.indexOf(mult) >= 0 ? mults.indexOf(mult) : 2, baseCol: 2 },
      ],
      caveats: ["One consolidated pool: no entity-by-entity build, so structural subordination and guarantee coverage are not captured. Build it by obligor when non-guarantor subsidiaries hold value.",
        "Secured claims are treated as secured by all assets. Where collateral is a defined pool, the claim recovers only to the value of that collateral and the rest is unsecured.",
        "Trade, lease-rejection, litigation, pension and intercompany claims are usually only knowable from post-petition schedules; the 'other unsecured' input is where they belong and it is normally too small.",
        "Plan value is litigated: judges accept DCF, comps and precedents, so present a range rather than a point.",
        "No time value, no post-petition interest, no section 1111(b) election, and no value given to warrants or 'tips' paid to junior classes for peace."],
      nextSteps: ["Test the fulcrum against the market price of each tranche to find where recovery is mispriced", "Re-run at the multiple range a plan would defend, not one point", "Check the covenant review for baskets that could move collateral before a filing"],
    };
  },
};

/** Short interest, days to cover and the borrow-cost drag on a short. */
const shortInterest: ToolDef = {
  kind: "calc", id: "eq-short-interest", title: "Short interest & borrow cost drag", tagline: "Percent of float, days to cover, and what the borrow costs you while you wait.",
  description: "Turns a short-interest reading into the two numbers that matter for a short: crowding (percent of float and of shares outstanding, and days to cover against average daily volume) and carry (the borrow fee over the intended holding period as a decline the stock must deliver just to break even), with the change against the prior reading.",
  roles: ["markets", "student"], specialties: [LS, QS, MM, STU], category: "Screening", icon: "TrendingDown", savesMinutes: 20, tags: ["short interest", "days to cover", "borrow"],
  fields: [
    { key: "price", label: "Price", type: "number", unit: "$", required: true, default: 50 },
    { key: "sharesOut", label: "Shares outstanding", type: "number", unit: "mm", required: true, default: 500 },
    { key: "float", label: "Free float", type: "number", unit: "mm", default: 0, help: "Defaults to shares outstanding" },
    { key: "shortInterest", label: "Short interest", type: "number", unit: "shares mm", required: true, default: 50 },
    { key: "priorShortInterest", label: "Prior short interest", type: "number", unit: "shares mm", default: 0 },
    { key: "adv", label: "Average daily volume", type: "number", unit: "shares mm", required: true, default: 10 },
    { key: "borrowFee", label: "Borrow fee", type: "number", unit: "%", default: 3 },
    { key: "holdDays", label: "Intended holding period", type: "number", unit: "days", default: 90, min: 1, max: 1095 },
  ],
  example: { price: 5.4, sharesOut: 1000, float: 940, shortInterest: 120, priorShortInterest: 96, adv: 22, borrowFee: 8, holdDays: 90 },
  prefill: (c) => ({ price: c.price?.last ?? 50, sharesOut: c.balance.sharesOut ?? 500 }),
  compute: (i: Inputs): WorkflowOutput => {
    const price = req(i, "price", "Price"), sharesOut = req(i, "sharesOut", "Shares outstanding");
    const si = req(i, "shortInterest", "Short interest"), adv = req(i, "adv", "Average daily volume");
    const float = num(i, "float") > 0 ? num(i, "float") : sharesOut;
    const prior = num(i, "priorShortInterest"), fee = num(i, "borrowFee") / 100, days = req(i, "holdDays", "Holding period");
    const pctFloat = si / float, pctOut = si / sharesOut, dtc = si / adv;
    const change = prior > 0 ? si / prior - 1 : null;
    const carry = fee * (days / 365);
    const carryPerShare = price * carry;
    const annual = fee;
    const score = Math.min(10, pctFloat * 20 + Math.min(dtc, 15) / 3 + (fee > 0.1 ? 2 : fee > 0.03 ? 1 : 0));
    const periods = [30, 60, 90, 180, 365];
    const fees = [0.01, 0.03, 0.08, 0.2, 0.5];
    return {
      title: "Short interest and borrow cost drag",
      summary: `Short interest is ${fmt.pct(pctFloat)} of float (${fmt.pct(pctOut)} of shares out) and ${fmt.num(dtc, 1)} days to cover at ${fmt.num(adv, 1)}mm average daily volume${change === null ? "" : `, ${change >= 0 ? "up" : "down"} ${fmt.pct(Math.abs(change), 0)} from the prior reading`}. At a ${fmt.pct(fee, 1)} borrow fee the position carries ${fmt.pct(carry, 2)} over ${fmt.num(days, 0)} days, so the stock must fall that much before the short makes anything.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Short interest % of float", value: fmt.pct(pctFloat), tone: pctFloat > 0.2 ? "warn" : "neutral" },
          { label: "% of shares out", value: fmt.pct(pctOut) },
          { label: "Days to cover", value: fmt.num(dtc, 1), tone: dtc > 5 ? "warn" : "neutral" },
          { label: "Change vs prior", value: change === null ? "n/a" : fmt.pct(change), tone: change !== null && change > 0 ? "warn" : "neutral" },
          { label: "Borrow over the period", value: fmt.pct(carry, 2), hint: `${fmt.moneyRaw(carryPerShare, 2)} per share` },
          { label: "Annualized carry", value: fmt.pct(annual, 1) },
          { label: "Squeeze risk (0-10)", value: fmt.num(score, 1), tone: score > 6 ? "neg" : score > 3 ? "warn" : "pos" },
        ] },
        { type: "table", title: "Build", columns: ["Measure", "Value", "Formula"],
          rows: [
            ["Short interest", `${fmt.num(si, 1)}mm shares`, "As reported on the settlement date"],
            ["Short interest value", fmt.money(si * price), "Shares short x price"],
            ["Percent of float", fmt.pct(pctFloat), "Short interest / free float"],
            ["Percent of shares out", fmt.pct(pctOut), "Short interest / shares outstanding"],
            ["Days to cover", fmt.num(dtc, 1), "Short interest / average daily volume"],
            ["Change vs prior reading", change === null ? "n/a" : fmt.pct(change), "Current / prior - 1"],
            ["Borrow fee", fmt.pct(fee, 2), "Annualized rebate rate"],
            ["Carry over the holding period", fmt.pct(carry, 2), "Fee x days / 365"],
            ["Breakeven decline", fmt.pct(carry, 2), "The fall needed to cover the borrow alone"],
          ], emphasisRow: 7 },
        { type: "bar", title: "Borrow cost as a percent of the position", format: "pct",
          data: periods.map((d) => ({ label: `${d}d`, value: fee * (d / 365), emphasis: d === Math.round(days) })) },
        { type: "sensitivity", title: "Borrow cost as a percent of the position: fee x holding period", rowLabel: "Borrow fee", colLabel: "Days held",
          rows: fees.map((f) => fmt.pct(f, 1)), cols: periods.map((d) => String(d)), values: fees.map((f) => periods.map((d) => f * (d / 365))), format: "pct" },
      ],
      caveats: ["FINRA short interest is a twice-monthly snapshot published on the seventh business day after the settlement date: it is stale and it is not the daily short-sale volume many sites show.",
        "Days to cover uses recent volume; in a squeeze volume explodes, so the ratio understates how quickly a crowded short can be forced out.",
        "Borrow fees move: hard-to-borrow names reprice daily and the rate you are quoted today is not the rate you will pay for a year.",
        "The squeeze score is a simple composite of float shorted, days to cover and the borrow fee, not a probability."],
      nextSteps: ["Pair this with the ownership monitor to see whether insiders and 13D holders are adding", "Check the borrow with the desk before sizing", "Make sure the short has a dated catalyst: crowding plus no catalyst is how shorts get squeezed"],
    };
  },
};

/** Reverse DCF: the revenue growth the current price already requires. */
const reverseDcf: ToolDef = {
  kind: "calc", id: "eq-reverse-dcf", title: "Reverse DCF: what growth is priced in", tagline: "Solve for the revenue CAGR that justifies today's enterprise value.",
  description: "Inverts the discounted cash flow: takes the enterprise value implied by the current price, a free cash flow margin path and a discount rate, then solves by bisection for the revenue CAGR over the forecast horizon that makes the present value of free cash flow plus a perpetuity-growth terminal value equal that enterprise value. The answer is the expectation embedded in the price.",
  roles: ["markets", "student"], specialties: [LS, LO, ER, QS, STU], category: "Valuation", icon: "TrendingUp", savesMinutes: 60, tags: ["reverse DCF", "expectations", "valuation"],
  fields: [
    { key: "price", label: "Current price", type: "number", unit: "$", required: true, default: 100 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", required: true, default: 100 },
    { key: "netDebt", label: "Net debt (negative = net cash)", type: "number", unit: "$mm", default: 0 },
    { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", required: true, default: 1000 },
    { key: "fcfMargin", label: "Current FCF margin", type: "number", unit: "%", default: 10 },
    { key: "terminalFcfMargin", label: "Terminal FCF margin", type: "number", unit: "%", default: 20 },
    { key: "years", label: "Forecast years", type: "number", unit: "years", default: 10, min: 3, max: 20 },
    { key: "wacc", label: "Discount rate", type: "number", unit: "%", default: 9 },
    { key: "terminalGrowth", label: "Terminal growth", type: "number", unit: "%", default: 2.5 },
  ],
  example: { price: 148, shares: 355, netDebt: -3400, revenue: 3800, fcfMargin: 24, terminalFcfMargin: 32, years: 10, wacc: 9, terminalGrowth: 2.5 },
  prefill: (c) => ({
    price: c.price?.last ?? 100,
    shares: c.balance.sharesOut ?? 100,
    netDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0),
    revenue: c.ltm.revenue ?? 1000,
    fcfMargin: c.ltm.revenue && c.ltm.operatingCashFlow !== null ? Math.round(((c.ltm.operatingCashFlow - (c.ltm.capex ?? 0)) / c.ltm.revenue) * 1000) / 10 : 10,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const price = req(i, "price", "Current price"), shares = req(i, "shares", "Diluted shares"), rev0 = req(i, "revenue", "LTM revenue");
    const netDebt = num(i, "netDebt"), m0 = num(i, "fcfMargin") / 100, mT = num(i, "terminalFcfMargin") / 100;
    const years = Math.round(req(i, "years", "Forecast years")), wacc = num(i, "wacc") / 100, gT = num(i, "terminalGrowth") / 100;
    if (!(wacc > gT)) throw new Error("The discount rate must exceed terminal growth for a perpetuity value.");
    const ev = price * shares + netDebt;
    if (!(ev > 0)) throw new Error("Enterprise value implied by the price is not positive; check net debt.");
    const marginAt = (y: number) => (years <= 1 ? mT : m0 + (mT - m0) * ((y - 1) / (years - 1)));
    const pvAt = (g: number) => {
      let pv = 0, rev = rev0, last = 0;
      for (let y = 1; y <= years; y++) { rev *= 1 + g; const fcf = rev * marginAt(y); last = fcf; pv += fcf / Math.pow(1 + wacc, y); }
      const tv = (last * (1 + gT)) / (wacc - gT);
      return { pv: pv + tv / Math.pow(1 + wacc, years), operating: pv, terminal: tv / Math.pow(1 + wacc, years), lastRev: rev, lastFcf: last };
    };
    let lo = -0.4, hi = 1.2;
    const bounded = pvAt(lo).pv <= ev && pvAt(hi).pv >= ev;
    for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (pvAt(mid).pv < ev) lo = mid; else hi = mid; }
    const g = (lo + hi) / 2;
    const res = pvAt(g);
    const rows: (string | number | null)[][] = [];
    let rev = rev0;
    for (let y = 1; y <= years; y++) { rev *= 1 + g; const mar = marginAt(y), fcf = rev * mar; rows.push([`Y${y}`, fmt.num(rev, 0), fmt.pct(mar, 1), fmt.num(fcf, 0), fmt.num(fcf / Math.pow(1 + wacc, y), 0)]); }
    const waccs = [wacc - 0.02, wacc - 0.01, wacc, wacc + 0.01, wacc + 0.02];
    const margins = [mT - 0.06, mT - 0.03, mT, mT + 0.03, mT + 0.06];
    const solve = (w: number, mm: number) => {
      if (!(w > gT)) return null;
      const f = (gg: number) => { let pv = 0, r = rev0, last = 0; for (let y = 1; y <= years; y++) { r *= 1 + gg; const mar = years <= 1 ? mm : m0 + (mm - m0) * ((y - 1) / (years - 1)); last = r * mar; pv += last / Math.pow(1 + w, y); } return pv + ((last * (1 + gT)) / (w - gT)) / Math.pow(1 + w, years); };
      let a = -0.4, b = 1.2;
      if (f(a) > ev || f(b) < ev) return null;
      for (let k = 0; k < 120; k++) { const mid = (a + b) / 2; if (f(mid) < ev) a = mid; else b = mid; }
      return (a + b) / 2;
    };
    return {
      title: "Reverse DCF: what growth is priced in",
      summary: `At ${fmt.moneyRaw(price, 2)} the enterprise value is ${fmt.money(ev)}, which requires ${bounded ? `a ${fmt.pct(g)} revenue CAGR` : `growth outside the ${fmt.pct(-0.4, 0)} to ${fmt.pct(1.2, 0)} search range (the solver returned ${fmt.pct(g)})`} for ${years} years on a free cash flow margin rising from ${fmt.pct(m0, 1)} to ${fmt.pct(mT, 1)}, discounted at ${fmt.pct(wacc, 1)} with ${fmt.pct(gT, 1)} terminal growth. That implies revenue of ${fmt.money(res.lastRev)} and free cash flow of ${fmt.money(res.lastFcf)} in year ${years}, with ${fmt.pct(res.terminal / res.pv, 0)} of the value in the terminal period.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Enterprise value", value: fmt.money(ev), hint: "Price x shares plus net debt" },
          { label: "Implied revenue CAGR", value: fmt.pct(g), tone: g > 0.2 ? "warn" : "info" },
          { label: `Year ${years} revenue`, value: fmt.money(res.lastRev) },
          { label: `Year ${years} FCF`, value: fmt.money(res.lastFcf) },
          { label: "Terminal share of value", value: fmt.pct(res.terminal / res.pv, 0), tone: res.terminal / res.pv > 0.7 ? "warn" : "neutral" },
          { label: "Revenue multiple implied", value: fmt.x(ev / rev0) },
        ] },
        { type: "table", title: "Implied path at the solved growth (USD mm)", columns: ["Year", "Revenue", "FCF margin", "Free cash flow", "PV of FCF"],
          rows, totals: ["PV of forecast FCF", "", "", "", fmt.num(res.operating, 0)],
          note: `Margin ramps linearly from ${fmt.pct(m0, 1)} to ${fmt.pct(mT, 1)} over the horizon. End-of-year discounting.` },
        { type: "columns", title: "Implied free cash flow (USD mm)", format: "money",
          data: rows.map((r, k) => ({ label: `Y${k + 1}`, value: Number(String(r[3]).replace(/[^0-9.-]/g, "")) })) },
        { type: "sensitivity", title: "Implied revenue CAGR: discount rate x terminal FCF margin", rowLabel: "Discount rate", colLabel: "Terminal FCF margin",
          rows: waccs.map((w) => fmt.pct(w, 1)), cols: margins.map((m) => fmt.pct(m, 0)),
          values: waccs.map((w) => margins.map((m) => solve(w, m))), format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["A reverse DCF is an expectations statement, not a valuation: it says what the price requires, and the judgment is whether that is plausible against history and the industry.",
        "One constant growth rate for the whole horizon is a simplification; a fading path with the same present value implies higher near-term growth.",
        "End-of-year discounting and no mid-year convention. Taxes, working capital and stock-based compensation are inside the free cash flow margin inputs, so define the margin the same way you measured it.",
        bounded ? "The solution sits inside the search range of -40% to +120% growth." : "The required growth fell outside the -40% to +120% search range: treat the number as a bound, not a solution."],
      nextSteps: ["Compare the implied CAGR with the last five years of actual growth and the industry's growth rate", "Test whether the terminal margin is achievable by anyone in the sector", "Take a defensible growth rate back into the price target calculator"],
    };
  },
};

/** Pairs trade hedge ratio: beta, dollar, volatility neutral and minimum variance. */
const pairsHedge: ToolDef = {
  kind: "calc", id: "pod-pairs-hedge", title: "Pairs trade hedge ratio", tagline: "Beta, dollar, volatility-neutral and minimum-variance hedges with the residual volatility.",
  description: "Sizes the short leg of a pair four ways (dollar neutral, beta neutral, volatility neutral and minimum variance from the correlation), then reports the residual net beta, the pair's annualized volatility against the long leg alone, and how much of the standalone risk the hedge removes.",
  roles: ["markets"], specialties: [MM, LS, QS, ED], category: "Portfolio", icon: "ArrowLeftRight", savesMinutes: 30, tags: ["pairs", "hedge ratio", "beta"],
  fields: [
    { key: "capital", label: "Book capital", type: "number", unit: "$mm", required: true, default: 500 },
    { key: "longNotional", label: "Long notional", type: "number", unit: "$mm", required: true, default: 15 },
    { key: "betaLong", label: "Beta, long", type: "number", default: 1.3 },
    { key: "betaShort", label: "Beta, short", type: "number", default: 1.1 },
    { key: "volLong", label: "Volatility, long", type: "number", unit: "%", required: true, default: 40 },
    { key: "volShort", label: "Volatility, short", type: "number", unit: "%", required: true, default: 30 },
    { key: "correlation", label: "Correlation", type: "number", default: 0.7, min: -1, max: 1, step: 0.05 },
    { key: "priceLong", label: "Price, long", type: "number", unit: "$", default: 100 },
    { key: "priceShort", label: "Price, short", type: "number", unit: "$", default: 50 },
    { key: "objective", label: "Objective", type: "select", options: ["Beta neutral", "Dollar neutral", "Volatility neutral", "Minimum variance"], default: "Beta neutral" },
  ],
  example: { capital: 500, longNotional: 15, betaLong: 1.45, betaShort: 1.15, volLong: 42, volShort: 33, correlation: 0.72, priceLong: 178, priceShort: 96, objective: "Beta neutral" },
  prefill: (c) => ({ priceLong: c.price?.last ?? 100 }),
  compute: (i: Inputs): WorkflowOutput => {
    const capital = req(i, "capital", "Book capital"), longN = req(i, "longNotional", "Long notional");
    const vL = req(i, "volLong", "Volatility, long") / 100, vS = req(i, "volShort", "Volatility, short") / 100;
    const bL = num(i, "betaLong"), bS = num(i, "betaShort"), rho = Math.min(Math.max(num(i, "correlation"), -1), 1);
    const pL = num(i, "priceLong"), pS = num(i, "priceShort");
    if (!(bS !== 0)) throw new Error("Beta of the short leg cannot be zero for a beta-neutral hedge.");
    const methods = [
      { name: "Dollar neutral", short: longN, note: "Equal notional both legs" },
      { name: "Beta neutral", short: longN * (bL / bS), note: `Long notional x beta long / beta short (${fmt.num(bL, 2)} / ${fmt.num(bS, 2)})` },
      { name: "Volatility neutral", short: longN * (vL / vS), note: `Long notional x vol long / vol short (${fmt.pct(vL, 0)} / ${fmt.pct(vS, 0)})` },
      { name: "Minimum variance", short: longN * rho * (vL / vS), note: "Long notional x correlation x vol long / vol short" },
    ];
    const pairVol = (shortN: number) => {
      const wL = longN / capital, wS = shortN / capital;
      const v = wL * wL * vL * vL + wS * wS * vS * vS - 2 * wL * wS * rho * vL * vS;
      return Math.sqrt(Math.max(v, 0));
    };
    const longOnlyVol = (longN / capital) * vL;
    const chosen = methods.find((m) => m.name === str(i, "objective", "Beta neutral")) ?? methods[1];
    const rows = methods.map((m) => {
      const pv = pairVol(m.short);
      return [m.name, fmt.money(m.short), fmt.pct(m.short / capital, 2), pS > 0 ? `${fmt.num(m.short / pS, 2)}mm` : "n/a", fmt.pct((longN * bL - m.short * bS) / capital, 2), fmt.bps(pv), fmt.pct(longOnlyVol > 0 ? 1 - pv / longOnlyVol : 0, 0), m.note];
    });
    const chosenVol = pairVol(chosen.short);
    const netBeta = (longN * bL - chosen.short * bS) / capital;
    const rhos = [0.3, 0.5, 0.7, 0.85, 0.95], vols = [0.2, 0.3, 0.4, 0.5, 0.6];
    const grid = rhos.map((r) => vols.map((v) => {
      const sn = chosen.name === "Minimum variance" ? longN * r * (vL / v) : chosen.name === "Volatility neutral" ? longN * (vL / v) : chosen.short;
      const wL = longN / capital, wS = sn / capital;
      return Math.sqrt(Math.max(wL * wL * vL * vL + wS * wS * v * v - 2 * wL * wS * r * vL * v, 0));
    }));
    return {
      title: "Pairs trade hedge ratio",
      summary: `A ${chosen.name.toLowerCase()} hedge shorts ${fmt.money(chosen.short)} against the ${fmt.money(longN)} long${pS > 0 ? ` (${fmt.num(chosen.short / pS, 2)}mm shares)` : ""}, leaving ${fmt.pct(netBeta, 2)} of net beta on ${fmt.pct(capital > 0 ? (longN + chosen.short) / capital : 0, 1)} gross. The pair's annualized volatility is ${fmt.bps(chosenVol)} of book against ${fmt.bps(longOnlyVol)} for the long alone, so the hedge removes ${fmt.pct(longOnlyVol > 0 ? 1 - chosenVol / longOnlyVol : 0, 0)} of the standalone risk at a correlation of ${fmt.num(rho, 2)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Short notional", value: fmt.money(chosen.short) },
          { label: "Shares short", value: pS > 0 ? `${fmt.num(chosen.short / pS, 2)}mm` : "n/a" },
          { label: "Shares long", value: pL > 0 ? `${fmt.num(longN / pL, 2)}mm` : "n/a" },
          { label: "Net beta", value: fmt.pct(netBeta, 2), tone: Math.abs(netBeta) < 0.005 ? "pos" : "warn" },
          { label: "Gross exposure", value: fmt.pct((longN + chosen.short) / capital, 1) },
          { label: "Pair volatility", value: fmt.bps(chosenVol) },
          { label: "Risk removed", value: fmt.pct(longOnlyVol > 0 ? 1 - chosenVol / longOnlyVol : 0, 0), tone: "pos" },
        ] },
        { type: "table", title: "Hedge by objective", columns: ["Objective", "Short notional", "% of book", "Shares short", "Net beta", "Pair volatility", "Risk removed", "Basis"],
          rows, emphasisRow: methods.indexOf(chosen), note: "Pair volatility = sqrt(wL^2 sL^2 + wS^2 sS^2 - 2 wL wS rho sL sS), annualized, as a share of book capital." },
        { type: "bar", title: "Annualized volatility as a share of book", format: "pct",
          data: [{ label: "Long alone", value: longOnlyVol }, ...methods.map((m) => ({ label: m.name, value: pairVol(m.short), emphasis: m === chosen }))] },
        { type: "sensitivity", title: "Pair volatility: correlation x short-leg volatility", rowLabel: "Correlation", colLabel: "Short volatility",
          rows: rhos.map((r) => fmt.num(r, 2)), cols: vols.map((v) => fmt.pct(v, 0)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["Beta and correlation are historical and unstable: they widen exactly when a pair is under stress, which is when the hedge is supposed to work.",
        "A hedge that removes most of the volatility also removes most of the return. The pod is paid for the residual, so hedge the exposure you do not have a view on, not the one you do.",
        "Ignores borrow cost, dividends on the short, financing and the tracking error of using a basket or ETF instead of a single name.",
        "Volatility-neutral and minimum-variance ratios are equal when the correlation is 1.0; below that, the minimum-variance short is smaller."],
      nextSteps: ["Check the borrow and the dividend calendar on the short leg", "Re-test the correlation over the horizon you intend to hold, not the trailing year", "Feed the pair volatility into the position sizing calculator as the name's volatility"],
    };
  },
};

export const MARKETS_PACK: ToolDef[] = [
  // AI workflows
  earningsPreview, earningsRecap, initiationTeardown, thesisMemo, scenarioTargets, catalystCalendar, ownershipMonitor,
  shortRedFlags, managementIncentives, moatAssessment, mergerArb, specialSituations, capStructureMap, creditRelativeValue,
  recoveryAnalysis, covenantReview, distressedScreen, sectorPrimer, ideaScreener, positionNote, factorExposure,
  complianceFormat, morningNote, pmPushback, postMortem, expertCallNotes,
  // Calculators
  priceTarget, scenarioEv, positionSize, arbSpread, earningsModel, bondMetrics, recoveryWaterfall, shortInterest,
  reverseDcf, pairsHedge,
];
