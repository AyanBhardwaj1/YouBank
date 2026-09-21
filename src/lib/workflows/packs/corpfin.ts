/**
 * Corporate finance pack: FP&A, corporate development, strategic finance, treasury, investor relations, and
 * controller workflows. AI workflows encode a method over SEC data and pasted exports; calculators implement the
 * standard formulas (PVM decomposition, covenant ratios, accretion/dilution, CCC, layered hedging, 13-week cash).
 */
import { fmt, num, str, list, parseCsv, type Inputs, type OutputBlock, type ToolDef, type WorkflowOutput } from "../types";

/* ---------------- Shared helpers ---------------- */

const FPA = "FP&A", CD = "Corporate development / M&A", SF = "Strategic finance", TR = "Treasury", IR = "Investor relations", CTRL = "Controller / accounting ops";
const ACCT = ["Controllership", "Technical accounting / SEC reporting", "Transaction advisory (FDD)", "Audit"];
const CONS = ["Financial due diligence (TAS)", "Strategy", "Operations & performance", "Restructuring / turnaround"];

type Row = Record<string, string>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
/** Parse pasted CSV into records keyed by normalized header. */
function records(text: string): Row[] {
  const { header, rows } = parseCsv(text);
  if (!header.length || !rows.length) throw new Error("Paste a CSV with a header row and at least one data row.");
  const keys = header.map(norm);
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
const cell = (r: Row, ...aliases: string[]): string => { for (const a of aliases) { const v = r[norm(a)]; if (v) return v; } return ""; };
const cnum = (r: Row, ...aliases: string[]): number => { const raw = cell(r, ...aliases).replace(/[,$%\s]/g, ""); const neg = /^\(.*\)$/.test(raw); const n = Number(raw.replace(/[()]/g, "")); return Number.isFinite(n) ? (neg ? -n : n) : 0; };
const need = (r: Row, label: string, ...aliases: string[]) => { if (!cell(r, ...aliases)) throw new Error(`CSV needs a "${label}" column (accepted names: ${aliases.join(", ")}).`); };
const median = (v: number[]) => { const s = v.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
/** IRR by bisection on annual flows (flows[0] at t=0). Null when no sign change. */
function irrOf(flows: number[]): number | null {
  const f = (r: number) => flows.reduce((a, cf, k) => a + cf / Math.pow(1 + r, k), 0);
  let lo = -0.99, hi = 10; if (f(lo) * f(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(mid) > 0) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
const tone = (v: number): "pos" | "neg" | "neutral" => (v > 0 ? "pos" : v < 0 ? "neg" : "neutral");

/* ======================================================================================
 * AI workflows
 * ====================================================================================== */

const peerBenchmarkInternal: ToolDef = {
  kind: "ai", id: "cf-peer-benchmark-internal", title: "Peer benchmark for the CFO and board", tagline: "Growth, margins, opex ratios, working capital, and leverage versus peers, translated into dollars of gap.",
  description: "Builds the internal-audience benchmark: the company against a peer set on growth, gross margin, opex ratios, EBITDA and FCF margins, DSO/DIO/DPO and cash conversion cycle, leverage, coverage, and ROIC, from SEC XBRL. Every gap versus the peer median is converted into what closing it would be worth in USD and labeled structural or execution, then written as talking points for the audience.",
  roles: ["corpfin", "consultant"], specialties: [FPA, SF, IR, CTRL, ...CONS], category: "Reporting", icon: "BarChart3", deliverable: "table", savesMinutes: 180, tags: ["benchmark", "peers", "board"],
  fields: [
    { key: "ticker", label: "Your company", type: "ticker", required: true, placeholder: "NOW" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "CRM WDAY DDOG ADBE INTU", help: "Leave empty to build the set from the proxy peer group and 10-K competitors" },
    { key: "audience", label: "Audience", type: "select", options: ["CFO staff meeting", "Board / audit committee", "Business unit review", "Strategy offsite"], default: "CFO staff meeting" },
    { key: "lens", label: "Lenses", type: "multiselect", options: ["Growth", "Gross margin", "Opex ratios (S&M, R&D, G&A)", "EBITDA and FCF margin", "Working capital (DSO, DIO, DPO, CCC)", "Leverage and coverage", "ROIC", "Valuation multiples"], default: ["Growth", "Gross margin", "Opex ratios (S&M, R&D, G&A)", "EBITDA and FCF margin", "Working capital (DSO, DIO, DPO, CCC)"] },
  ],
  example: { ticker: "NOW", peers: ["CRM", "WDAY", "DDOG", "ADBE", "INTU"], audience: "CFO staff meeting", lens: ["Growth", "Gross margin", "Opex ratios (S&M, R&D, G&A)", "EBITDA and FCF margin", "Working capital (DSO, DIO, DPO, CCC)"] },
  effort: "medium",
  instructions: `1. Peer set: if none given, search_filing on the subject's DEF 14A for "peer group" (compensation peers) and on the 10-K for "competitors"; keep 5-7 US-listed names of similar business model and scale and say why each is in.
2. get_trading_comps with the subject and peers for growth, gross margin, operating and FCF margins, Rule of 40, EV/Revenue, EV/EBITDA.
3. get_xbrl_series (periods 4, annual values, divide raw USD by 1e6) for the subject and every peer with concepts ["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","CostOfRevenue","SellingAndMarketingExpense","ResearchAndDevelopmentExpense","GeneralAndAdministrativeExpense","SellingGeneralAndAdministrativeExpense","AccountsReceivableNetCurrent","InventoryNet","AccountsPayableCurrent","LongTermDebt","InterestExpense","IncomeTaxExpenseBenefit","StockholdersEquity","OperatingIncomeLoss"]; when a concept is missing use find "Marketing|Research|Administrative|Receivable|Payable|Debt|Interest" and take the closest tag, labeling it. Where get_company_financials returns no gross profit for a peer, derive gross margin as (revenue - cost of revenue) / revenue from the XBRL tags rather than dropping that peer from the median, and say which tag you used. Use the latest fiscal year for each company and note fiscal year ends.
4. Compute with calc, for every company: opex ratio = expense / revenue; DSO = AR / revenue x 365; DIO = inventory / COGS x 365 (report 0 for a software or services peer set with no inventory tag and say so, rather than leaving CCC null); DPO = AP / COGS x 365; CCC = DSO + DIO - DPO (ending balances); net leverage = (debt - cash) / EBITDA; interest coverage = EBITDA / interest expense; ROIC = operating income x (1 - effective tax rate) / (debt + equity - cash). Peer median for each metric and the subject's quartile rank (1 = best).
5. Internal translation: for each emphasized metric, value of the gap in USD mm on the subject's own revenue: one point of margin or opex ratio = revenue x 1%; DSO gap x revenue / 365 = cash tied up; DPO gap x COGS / 365. Label each gap structural (business model, mix, pricing model: cite the 10-K "gross margin" or "compared to" passages via search_filing) or execution (scale, productivity) and say which owner would act on it.
Produce: kpis (subject vs peer median on the emphasized lenses with delta and tone); table "Benchmark" with the subject first (emphasisRow 0), then peers, and the peer median in totals, units in headers; bar chart of the primary lens with the subject emphasized and the median as reference; table "What closing the gap is worth" (metric, subject, median, gap, USD mm, structural or execution, owner); bullets "Talking points" written for the audience (board: three plain-language bullets on outcome; CFO staff: drivers and owners; BU review: the two metrics the unit controls); caveats on fiscal year alignment, GAAP vs adjusted, ending versus average balances. Missing data: show n/a, never drop a peer silently.`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()} against ${list(i, "peers").length ? list(i, "peers").join(", ") : "a peer set you build from the proxy and 10-K"} for a ${str(i, "audience", "CFO staff meeting")}. Lenses: ${list(i, "lens").join(", ") || "growth, margins, opex ratios, working capital"}.`,
};

const guidanceVsConsensus: ToolDef = {
  kind: "ai", id: "cf-guidance-vs-consensus", title: "Guidance vs consensus analyzer", tagline: "Guidance history from 8-K releases and 10-Qs, beat/miss pattern, and where pasted consensus sits in the range.",
  description: "Extracts every guidance range the company issued from its Item 2.02 earnings releases and 10-Q outlook sections, matches each to the reported actual from XBRL to compute the beat/miss pattern and range widths, then positions a pasted consensus table inside the current range. Ends with a guidance-philosophy read and implications for the next guide.",
  roles: ["corpfin"], specialties: [IR, FPA, SF], category: "Research", icon: "Target", deliverable: "analysis", savesMinutes: 150, tags: ["guidance", "consensus", "earnings"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "NOW" },
    { key: "consensus", label: "Consensus table (optional)", type: "csv", columns: "metric, period, consensus_mean, consensus_low, consensus_high, n_estimates", help: "Paste from your licensed consensus provider; the tool never fetches consensus itself" },
    { key: "metric", label: "Primary metric", type: "select", options: ["Revenue", "Subscription revenue / ARR", "Operating margin", "EPS", "Free cash flow"], default: "Revenue" },
    { key: "quarters", label: "Quarters of history", type: "number", default: 6, min: 2, max: 12 },
  ],
  example: { ticker: "NOW", metric: "Subscription revenue / ARR", quarters: 6, consensus: "metric,period,consensus_mean,consensus_low,consensus_high,n_estimates\nSubscription revenue,Q3 FY2026,3510,3470,3560,28\nSubscription revenue,FY2026,13480,13350,13600,30\nNon-GAAP operating margin,FY2026,30.6,30.0,31.2,26" },
  effort: "high",
  instructions: `1. get_recent_filings for the ticker with forms ["8-K"] and limit 40; keep the filings carrying Item 2.02 for the requested number of quarters. For each, read_document on the filing URL with queries "outlook", "guidance", "expects", "range", "fiscal" (the press release is Exhibit 99.1; if the primary document is only the cover, read_document with query "Exhibit 99.1" to find it) and extract every guided metric: period, low, high, midpoint, issued date, GAAP or non-GAAP, and whether it was raised, maintained, or lowered versus the previous release.
2. search_filing on the latest 10-Q and 10-K for "outlook", "guidance", "we expect" to confirm the current ranges and qualitative guidance (FX, share count, margin direction).
3. get_xbrl_series periods 8 with concepts ["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","OperatingIncomeLoss","EarningsPerShareDiluted","NetCashProvidedByUsedInOperatingActivities"] for actuals (raw USD, divide by 1e6). Match each guided period to its actual; with calc compute beat vs midpoint = actual / midpoint - 1, beat vs top end, range width = (high - low) / midpoint, the median beat, and the share of periods above the top end. For non-GAAP guided metrics use the release's own reported figure, labeled.
4. If a consensus table was pasted: for each metric and period, position in range = (consensus - low) / (high - low) (below 0 means consensus is under the range, above 1 over it), gap to midpoint %, and implied print = midpoint x (1 + median historical beat) versus consensus. If nothing was pasted, say so in caveats and deliver the history alone.
5. Guidance philosophy: cadence (annual, quarterly, both), metrics guided, conservatism (beat frequency and size), range width trend, non-GAAP framing (Regulation G reconciliation present or not), and how peers in the same sector frame guidance if useful.
Tool budget: about 20 tool calls. Read at most six earnings releases and one 10-Q; if the budget runs short, cover fewer quarters and say which in caveats rather than ending without output.
Produce: kpis (current range, midpoint, consensus vs midpoint, median historical beat, beat-the-top-end frequency, average range width); table "Guidance history" (period, metric, issued, low, high, midpoint, actual, beat vs mid %, beat vs top %, raised/maintained/lowered, source); table "Consensus vs range" when pasted (metric, period, low, high, consensus, position in range, gap to mid, implied print); bar of beat vs midpoint by period (format pct); markdown "Guidance philosophy"; bullets "Implications for the next guide" (where consensus would land, risk of a guide-down, suggested range width); caveats on GAAP vs non-GAAP actuals, restatements, constant currency.`,
  prompt: (i) => `Analyze ${str(i, "ticker").toUpperCase()}'s guidance history for the last ${num(i, "quarters", 6)} quarters with ${str(i, "metric", "Revenue")} as the primary metric${str(i, "consensus").trim() ? ", and position the pasted consensus inside the current range" : " (no consensus pasted)"}.`,
};

const earningsQaBank: ToolDef = {
  kind: "ai", id: "cf-earnings-qa-bank", title: "Earnings Q&A bank generator", tagline: "The most likely analyst questions, mined from your filings and your peers' 10-Qs, with answer frames and proof points.",
  description: "Produces the earnings-call Q&A document: the N most likely questions grouped by theme, each with who asks it, an answer frame (headline, proof points cited to public disclosures, bridge), what not to say under Reg FD, and a risk rating. Questions come from the company's own 10-Q/10-K/8-K soft spots, XBRL trends (deceleration, margin, DSO, RPO), and what peers said in their latest 10-Qs.",
  roles: ["corpfin"], specialties: [IR, FPA, SF], category: "Communication", icon: "MessageSquare", deliverable: "analysis", savesMinutes: 240, tags: ["earnings", "Q&A", "IR"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "peers", label: "Peers to mine", type: "tickers", placeholder: "NOW SNOW MDB", help: "Three is enough; the read-across is one filing search per peer" },
    { key: "quarter", label: "Call", type: "text", placeholder: "Q3 FY2026", default: "upcoming quarter" },
    { key: "themes", label: "Themes", type: "multiselect", options: ["Demand and pipeline", "Pricing and discounting", "Margins and cost actions", "Guidance and cadence", "Capital allocation", "AI and product", "Headcount and hiring", "Competition", "Macro and FX", "Working capital and cash"], default: ["Demand and pipeline", "Pricing and discounting", "Margins and cost actions", "Guidance and cadence", "AI and product", "Competition"] },
    { key: "count", label: "Questions", type: "number", default: 15, min: 8, max: 25 },
  ],
  example: { ticker: "DDOG", peers: ["NOW", "SNOW", "MDB"], quarter: "Q3 FY2026", themes: ["Demand and pipeline", "Pricing and discounting", "Margins and cost actions", "Guidance and cadence", "AI and product", "Competition"], count: 15 },
  effort: "high",
  instructions: `1. Soft spots from numbers: get_company_financials, then get_xbrl_series periods 8 with concepts ["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","OperatingIncomeLoss","AccountsReceivableNetCurrent","ContractWithCustomerLiabilityCurrent","RevenueRemainingPerformanceObligation","ShareBasedCompensation"]. With calc: sequential and YoY growth by quarter, operating margin trend, DSO, RPO growth vs revenue growth, deferred revenue change. Every deterioration (deceleration, margin compression, DSO rising, RPO growing slower than revenue, SBC rising as % of revenue) becomes a question.
2. Own disclosures, in at most six calls: search_filing on the latest 10-Q with the multi-term queries "outlook guidance", "remaining performance obligations net retention" and "pricing macroeconomic seasonality"; search_filing on the 10-K with "competition"; get_recent_filings forms ["8-K"] limit 8 and read_document once on the latest Item 2.02 release with the query "outlook". Expand a hit with read_filing only when the snippet is not enough to quote. Each new disclosure, change in language, or omission versus the prior quarter is a question.
3. Peer read-across, capped at three peers and two calls each: search_filing on the peer's 10-Q with "outlook", then with "demand pricing" only if the first query returned little. Do not open peer 8-K exhibits or read peer filings unless a specific peer guidance change is itself the question. Where a peer's message differs from the company's (guide raised while ours was maintained, pricing changes, layoffs), write the read-across question an analyst will ask.
Tool budget: about 20 tool calls in total. Stop gathering as soon as the themes are covered and never end a turn without the JSON output: if the budget is nearly spent, write the Q&A bank from what you already have and list the gaps in caveats.
4. Write the N questions grouped by theme (the selected themes first). Each item: who asks (sell-side model question, long-only, hedge fund) and the analyst's phrasing as q; as a, an answer frame: headline sentence, two proof points with citations to public filings, bridge back to the message, "do not say" (MNPI, numbers beyond guidance, customer names; Reg FD), risk rating high/medium/low. Use [internal figure] placeholders where a good answer needs non-public data.
Produce: kpis (questions, themes, high-risk questions, peer read-across questions); qa with the N items (q starts with the theme in brackets, a contains the frame); table "Theme heatmap" (theme, questions, likelihood, trigger: own disclosure or peer name, suggested responder CEO/CFO); bullets "Proof points bank" (each a fact with its citation); risks "Landmines" (3-5 with mitigation phrasing); checklist "Prep tasks" with owner. Caveats: transcripts are not available here, so questions are inferred from filings, not from prior calls.`,
  prompt: (i) => `Build the ${num(i, "count", 15)}-question Q&A bank for ${str(i, "ticker").toUpperCase()}'s ${str(i, "quarter", "upcoming")} earnings call, mining ${list(i, "peers").slice(0, 3).join(", ") || "three close peers you choose"} for read-across. Themes: ${list(i, "themes").join(", ")}.`,
};

const varianceCommentary: ToolDef = {
  kind: "ai", id: "cf-variance-commentary", title: "Variance commentary writer", tagline: "Budget vs actual pack from a pasted export: variances computed in code, top drivers explained, commentary drafted.",
  description: "Turns a pasted budget-versus-actual export into the monthly variance pack: variances and favorable/unfavorable flags computed by line, rate/volume splits where unit columns exist, a bridge from budget EBITDA to actual, and commentary in the what/why/so-what/action pattern for the CFO, business leaders, or the board. Unexplained items become questions for budget owners rather than invented causes.",
  roles: ["corpfin", "accountant"], specialties: [FPA, SF, CTRL, ...ACCT], category: "Reporting", icon: "FileSpreadsheet", deliverable: "memo", savesMinutes: 180, tags: ["BvA", "variance", "FP&A"],
  fields: [
    { key: "csv", label: "Budget vs actual export", type: "csv", required: true, columns: "line, cost_center (optional), budget, actual, prior_year (optional), budget_units (optional), actual_units (optional); amounts in $k", placeholder: "line,cost_center,budget,actual,prior_year" },
    { key: "period", label: "Period", type: "text", default: "September 2026" },
    { key: "thresholdPct", label: "Threshold", type: "number", unit: "%", default: 5 },
    { key: "thresholdAmt", label: "Threshold", type: "number", unit: "$k", default: 100 },
    { key: "audience", label: "Audience", type: "select", options: ["CFO", "Business unit leaders", "Board"], default: "CFO" },
  ],
  example: { period: "September 2026", thresholdPct: 5, thresholdAmt: 100, audience: "CFO", csv: "line,cost_center,budget,actual,prior_year,budget_units,actual_units\nSubscription revenue,Sales,12500,12950,11200,,\nServices revenue,Services,1800,1520,1650,,\nCost of subscription,COGS,2600,2810,2350,,\nCost of services,COGS,1500,1490,1380,,\nSales and marketing,S&M,4200,4610,3900,,\nResearch and development,R&D,3100,2980,2800,,\nGeneral and administrative,G&A,1400,1350,1300,,\nCloud hosting,COGS,1100,1260,950,410,462\nContractors,R&D,350,520,300,,\nTravel,S&M,220,310,150,," },
  effort: "medium",
  instructions: `1. Parse the export. Classify every line as revenue (name contains revenue, sales, subscription, bookings), COGS (cost of, COGS, hosting), or opex (everything else) unless a type column exists. Favorable = actual above budget for revenue, below budget for costs. With calc compute variance = actual - budget, variance % of budget, variance vs prior year, and the totals: revenue, gross profit, opex, EBITDA (revenue - COGS - opex) for budget and actual. Flag lines exceeding both thresholds.
2. Driver attribution. Where budget_units and actual_units exist: budget rate = budget / budget_units, actual rate = actual / actual_units, volume variance = (actual_units - budget_units) x budget rate, rate variance = (actual rate - budget rate) x actual_units (they sum to the line variance; verify with calc). Otherwise assign a driver hypothesis from the line name, size, and the prior-year pattern (timing, volume, price/rate, mix, one-time, FX) and label it as a hypothesis.
3. Commentary for the ten largest absolute variances: two or three sentences each in the what / why / so what / action pattern, with the amount and percent in the sentence, then a headline paragraph for the audience (board: outcome and full-year implication; CFO: drivers and owners; business leaders: actions and dates). Never invent a cause; unexplained items go to the questions block.
Produce: kpis (revenue variance, gross margin variance in points, opex variance, EBITDA variance, lines over threshold; tone favorable/unfavorable); table "Budget vs actual ($k)" sorted by absolute variance (line, cost center, budget, actual, variance, %, F/U, driver) with totals; waterfall from budget EBITDA through the six largest drivers and "Other" to actual EBITDA (verify the steps sum); markdown "Commentary"; qa "Questions for budget owners"; checklist "Follow-ups" with owner = cost center. Caveats: classification assumptions and any lines that could not be typed.`,
  prompt: (i) => `Write the ${str(i, "period", "monthly")} budget-vs-actual pack for the ${str(i, "audience", "CFO")}; flag lines over ${num(i, "thresholdPct", 5)}% and $${num(i, "thresholdAmt", 100)}k.`,
};

const pvmNarrative: ToolDef = {
  kind: "ai", id: "cf-pvm-narrative", title: "PVM revenue bridge narrative", tagline: "Price, volume, mix, new, and discontinued effects from a sales cube, reconciled to the total and explained.",
  description: "Decomposes the revenue variance in a pasted sales cube into new, discontinued, volume, mix, and price effects using the standard formulas, verifies they sum to the total, then writes the bridge commentary: which items drove each effect, price realization, mix quality, and what to do about it. Pair with the PVM calculator for a deterministic table.",
  roles: ["corpfin", "consultant"], specialties: [FPA, SF, ...CONS], category: "Reporting", icon: "Split", deliverable: "analysis", savesMinutes: 120, tags: ["PVM", "bridge", "revenue"],
  fields: [
    { key: "csv", label: "Sales cube", type: "csv", required: true, columns: "item, base_volume, base_price, actual_volume, actual_price (or base_revenue, actual_revenue); optional base_unit_cost, actual_unit_cost" },
    { key: "period", label: "Period", type: "text", default: "Q2 FY2026" },
    { key: "base", label: "Base", type: "select", options: ["Budget", "Prior year", "Prior forecast"], default: "Budget" },
    { key: "level", label: "Hierarchy in the cube", type: "text", placeholder: "SKU, product line, region, customer", default: "product line" },
  ],
  example: { period: "Q2 FY2026", base: "Prior year", level: "category x region", csv: "item,base_volume,base_price,actual_volume,actual_price\nFootwear North America,42.0,68.0,40.5,71.0\nApparel North America,30.0,41.0,31.5,40.2\nFootwear EMEA,25.0,62.0,27.0,60.5\nApparel EMEA,14.0,38.0,13.0,39.0\nEquipment,6.0,27.0,0,0\nFootwear Greater China,18.0,58.0,15.5,55.0\nDigital-only line,0,0,4.0,52.0" },
  effort: "medium",
  instructions: `1. Parse the cube. Prices may be derived as revenue / volume when only revenue columns exist. Bucket first: items with base_volume 0 and actual_volume > 0 are New (effect = actual revenue); items with actual_volume 0 and base_volume > 0 are Discontinued (effect = -base revenue). Continuing items only, with calc: V0 = sum of base volumes, V1 = sum of actual volumes, P0 = base revenue / V0 (base average price); volume effect = (V1 - V0) x P0; mix effect = sum(actual_volume x base_price) - V1 x P0; price effect = sum((actual_price - base_price) x actual_volume). Check: new + discontinued + volume + mix + price = actual revenue - base revenue; state the check.
2. Item detail: item variance, item price effect = (actual_price - base_price) x actual_volume, item volume-and-mix effect = (actual_volume - base_volume) x base_price; the sum of item volume-and-mix equals the aggregate volume plus mix.
3. If unit cost columns exist, run the same decomposition on COGS and present a gross margin bridge (price, cost rate, volume, mix).
4. Narrative: the three items behind each effect; price realization = price effect / base revenue; mix quality (positive mix means shift toward higher-priced items); whether volume loss is concentrated; discontinued and new lines net; implications for pricing, sales capacity, and the forecast.
Produce: kpis (base revenue, actual revenue, total variance and %, price, volume, mix, new, discontinued); waterfall (base -> volume -> mix -> price -> new -> discontinued -> actual, totals marked); table "By item" (item, base revenue, actual revenue, variance, price effect, volume+mix effect); bar of item variances with the largest emphasized; markdown "Bridge commentary"; bullets "Actions"; caveats on aggregation level (mix depends on the hierarchy) and FX not separated unless rate columns exist.`,
  prompt: (i) => `Decompose ${str(i, "period", "the period")} revenue versus ${str(i, "base", "budget").toLowerCase()} at the ${str(i, "level", "product line")} level into price, volume, mix, new, and discontinued effects, reconcile to the total, and write the bridge commentary.`,
};

const thirteenWeekCopilot: ToolDef = {
  kind: "ai", id: "cf-13-week-cash-copilot", title: "13-week cash copilot", tagline: "Roll the direct-method forecast forward from actuals, attribute last week's variance, flag minimum-cash breaches.",
  description: "Takes a pasted 13-week receipts and disbursements forecast with actuals for the closed weeks, re-anchors to the bank balance, attributes variance by line as timing or permanent, rolls the open weeks forward, and flags weeks below minimum cash with the revolver draw and levers needed. Output is the refreshed grid, the variance report, and the actions list treasury sends on Monday.",
  roles: ["corpfin"], specialties: [TR, FPA, SF, CTRL], category: "Planning & forecasting", icon: "Wallet", deliverable: "table", savesMinutes: 150, tags: ["13-week", "cash", "treasury"],
  fields: [
    { key: "csv", label: "Forecast and actuals", type: "csv", required: true, columns: "week (1-13 or week-ending date), line (Collections, Payroll, AP, Rent, Debt service, Capex, Taxes, Other), forecast, actual (blank for open weeks); $k, disbursements as positive numbers" },
    { key: "openingCash", label: "Opening cash (week 1)", type: "number", unit: "$k", required: true, default: 18000 },
    { key: "minCash", label: "Minimum cash policy", type: "number", unit: "$k", default: 10000 },
    { key: "revolver", label: "Undrawn revolver", type: "number", unit: "$k", default: 25000 },
    { key: "notes", label: "Known events", type: "textarea", placeholder: "Payroll on weeks 2/4/6..., Q3 estimated tax week 5, term loan interest week 9, large customer paying late" },
  ],
  example: { openingCash: 18000, minCash: 10000, revolver: 25000, notes: "Biweekly payroll in even weeks; estimated tax payment in week 5; term loan interest in week 9; largest customer (18% of AR) told us its week-2 payment slips to week 4.", csv: "week,line,forecast,actual\n1,Collections,6200,5400\n1,Payroll,0,0\n1,AP,3900,4150\n1,Rent,900,900\n2,Collections,6400,6100\n2,Payroll,4300,4380\n2,AP,3800,3650\n3,Collections,6300,\n3,AP,3900,\n3,Capex,1200,\n4,Collections,7100,\n4,Payroll,4300,\n4,AP,3800,\n5,Collections,6200,\n5,AP,3900,\n5,Taxes,2600,\n6,Collections,6500,\n6,Payroll,4300,\n6,AP,3800,\n7,Collections,6300,\n7,AP,3900,\n7,Rent,900,\n8,Collections,6600,\n8,Payroll,4300,\n8,AP,3800,\n9,Collections,6400,\n9,AP,3900,\n9,Debt service,3100,\n10,Collections,6800,\n10,Payroll,4300,\n10,AP,3800,\n11,Collections,6300,\n11,AP,3900,\n12,Collections,6700,\n12,Payroll,4300,\n12,AP,3800,\n13,Collections,6500,\n13,AP,3900,\n13,Rent,900," },
  effort: "medium",
  instructions: `1. Parse. Inflow lines are those whose name contains collection, receipt, customer, or AR; every other line is a disbursement (positive = cash out). With calc, compute per week the forecast net flow and closing cash from opening cash, and for closed weeks (any actual present) the actual net flow, the actual closing cash, and the line variances: variance = actual - forecast, favorable when collections are higher or disbursements lower; total variance as % of forecast receipts plus disbursements; cumulative accuracy (target under 5% by week 4-5).
2. Re-anchor: the last actual closing balance is the new starting point (the bank balance rules, not the GL). Classify each closed-week variance as timing or permanent using the notes and line behaviour: a collections shortfall named as slippage is timing (push 70% into the next one to two weeks and drop 30% as leakage), recurring disbursement overruns (payroll, AP) are permanent (rebase the remaining weeks by the observed ratio, capped at +15%), one-time items are not repeated. Apply the known events from the notes to the correct weeks.
3. Roll the open weeks forward with the adjusted lines; recompute closing cash. Alerts: weeks with closing cash below the minimum, the low point and its week, the revolver draw needed each week = max(0, minimum - closing) (cumulative draws reduce availability), liquidity = closing cash + undrawn revolver. Size levers that close any gap: stretch discretionary AP one week, accelerate the largest receivables, defer capex, with USD amounts.
Produce: kpis (opening cash, week-13 closing, low point and week, breach weeks, peak revolver draw, last closed week variance %); table "13-week forecast, rolled ($k)" (week, collections, each disbursement line, net flow, closing cash, headroom vs minimum) with totals; table "Variance, closed weeks" (week, line, forecast, actual, variance, timing/permanent, treatment in the roll-forward); line chart with two series: closing cash by week and minimum cash; callout (warn) when any week breaches, otherwise info with the headroom; checklist "Actions this week" with owners (AR, AP, treasury). Caveats: forecast is direct-method and bank-anchored; timing assumptions listed.`,
  prompt: (i) => `Roll the 13-week cash forecast forward from the closed weeks. Opening cash $${num(i, "openingCash")}k, minimum cash $${num(i, "minCash")}k, undrawn revolver $${num(i, "revolver")}k.${str(i, "notes") ? ` Known events: ${str(i, "notes")}` : ""}`,
};

const covenantCertificate: ToolDef = {
  kind: "ai", id: "cf-covenant-certificate", title: "Covenant definitions & compliance certificate", tagline: "Reads the credit agreement for lender-defined EBITDA, then computes the ratios and drafts the certificate.",
  description: "Extracts the financial covenant machinery from a credit agreement (Consolidated EBITDA add-backs and their caps, the cash netting limit, the ratio definitions, testing dates, cure rights) and applies it to a pasted trial balance or covenant input schedule. Produces the ratio calculations, headroom at the 80/90/95% warning levels, two stress cases, and a compliance-certificate draft.",
  roles: ["corpfin", "accountant"], specialties: [TR, CTRL, FPA, ...ACCT], category: "Credit & restructuring", icon: "Shield", deliverable: "memo", savesMinutes: 480, tags: ["covenant", "credit agreement", "certificate"],
  fields: [
    { key: "csv", label: "Covenant inputs", type: "csv", required: true, columns: "item, amount ($mm) - rows for EBITDA (GAAP), each add-back, total debt, finance leases, cash, restricted cash, revolver commitment, revolver drawn, interest expense, capex, cash taxes, scheduled amortization, dividends", placeholder: "item,amount" },
    { key: "agreement", label: "Credit agreement excerpts", type: "textarea", placeholder: "Paste the definitions of Consolidated EBITDA, Consolidated Net Leverage Ratio, Interest Coverage Ratio, the financial covenant section, and any cure provision", help: "Leave empty for a public issuer and the tool will hunt for the EX-10 credit agreement on EDGAR" },
    { key: "ticker", label: "Ticker (public issuers)", type: "ticker", placeholder: "CAT" },
    { key: "period", label: "Test period", type: "text", default: "Q3 FY2026" },
  ],
  example: { ticker: "CAT", period: "Q3 FY2026", agreement: "\"Consolidated EBITDA\" means Consolidated Net Income plus, to the extent deducted, interest, taxes, depreciation and amortization, non-cash equity compensation, and restructuring charges and pro forma run-rate cost savings not to exceed 15% of Consolidated EBITDA (before giving effect thereto) in the aggregate. The Consolidated Net Leverage Ratio shall not exceed 3.50:1.00, tested quarterly; unrestricted cash netted shall not exceed $500,000,000. The Interest Coverage Ratio shall not be less than 3.00:1.00.", csv: "item,amount\nEBITDA (GAAP),1480\nStock-based compensation,86\nRestructuring charges,54\nRun-rate cost savings,240\nTotal debt,5100\nFinance leases,180\nCash,900\nRestricted cash,60\nRevolver commitment,1500\nRevolver drawn,300\nInterest expense,205\nCapex,310\nCash taxes,150\nScheduled amortization,120\nDividends,95" },
  effort: "high",
  instructions: `1. Definitions first. If agreement text was pasted, extract verbatim: the Consolidated EBITDA build (every permitted add-back and every cap, e.g. run-rate synergies capped at a percentage of EBITDA), whether the cap is applied before or after giving effect to the add-back, the cash netting limit, the debt definition (does it include finance leases, letters of credit, securitization), the exact ratio definitions and required levels, the testing dates and the reference period, equity cure rights and their limits. If no text was pasted and a ticker is given, run edgar_fulltext_search with the entity name and the phrase "Consolidated EBITDA" restricted to forms ["8-K","10-K","10-Q"], then read_document on the credit agreement exhibit with queries "Consolidated EBITDA means", "Net Leverage Ratio", "Interest Coverage Ratio", "financial covenant". Never assume an add-back the agreement does not grant: the most common error in practice is using accounting EBITDA instead of lender-defined EBITDA.
2. Build lender EBITDA with calc, line by line, showing each add-back and the amount disallowed by a cap. Then: net debt = total debt + finance leases (if included) + drawn revolver - min(unrestricted cash, netting cap) with restricted cash excluded; net leverage = net debt / lender EBITDA; total leverage = total debt / lender EBITDA; interest coverage = lender EBITDA / interest expense; fixed-charge coverage = (lender EBITDA - capex - cash taxes) / (interest + scheduled amortization + dividends); liquidity = unrestricted cash + (revolver commitment - drawn).
3. Headroom: for each covenant compute utilization = actual / limit (inverted for minimum ratios), the EBITDA cushion (lender EBITDA - net debt / max leverage) and its percentage, and the debt capacity (max leverage x lender EBITDA - net debt). Flag utilization above 80%, 90% and 95%.
4. Stress: (a) EBITDA down 10% and 20% with debt flat; (b) revenue down 10% with gross margin down 200 bps, carried to EBITDA using the pasted margins if present, otherwise stated as an EBITDA delta. Report the quarter each covenant would trip and the EBITDA or cash amount needed to cure.
Produce: kpis (lender EBITDA, net leverage vs limit, interest coverage vs floor, FCCR, liquidity, tightest covenant utilization); table "Consolidated EBITDA build" (line, amount, add-back permitted?, cap, allowed, agreement reference) with totals; table "Covenant compliance" (covenant, calculation, actual, required, headroom, utilization %, pass/fail) with emphasisRow on the tightest; sensitivity of net leverage to EBITDA decline x incremental debt; markdown "Certificate draft" in officer-certificate language with the ratio schedule; risks (definitional risks: uncapped add-backs used, cash netting, pro forma adjustments); caveats naming every definition that had to be assumed.`,
  prompt: (i) => `Compute the ${str(i, "period", "quarter")} covenant package${str(i, "ticker") ? ` for ${str(i, "ticker").toUpperCase()}` : ""} from the pasted inputs, using ${str(i, "agreement").trim() ? "the pasted credit agreement definitions" : "the credit agreement you locate on EDGAR"}, and draft the compliance certificate.`,
};

const driverForecastStudio: ToolDef = {
  kind: "ai", id: "cf-driver-forecast-studio", title: "Driver-based forecast studio", tagline: "Turns driver history into a rolling 12-24 month forecast with scenarios and a forecast-accuracy read.",
  description: "Builds a driver-based rolling forecast instead of a line-item extrapolation: revenue from the model you pick (pipeline x win rate x ACV, units x price, usage x unit price, or reps x ramped quota), cost of revenue from usage and unit cost, opex from headcount x fully loaded cost plus non-headcount run-rate. Quantifies the driver history, fits the trend, produces base, upside and downside cases, and reports MAPE and bias from the history so the reader knows how much to trust it.",
  roles: ["corpfin"], specialties: [FPA, SF, TR], category: "Planning & forecasting", icon: "LineChart", deliverable: "model", savesMinutes: 300, tags: ["forecast", "drivers", "rolling"],
  fields: [
    { key: "csv", label: "Driver and actuals history", type: "csv", required: true, columns: "period (YYYY-MM or Qx FYxx), driver, actual, forecast (optional, the version in force at the time); one row per driver per period", placeholder: "period,driver,actual,forecast" },
    { key: "model", label: "Revenue driver model", type: "select", options: ["Pipeline x win rate x ACV", "Units x price", "Usage x unit price", "Reps x ramped quota", "Subscription: beginning ARR + new + expansion - churn"], default: "Subscription: beginning ARR + new + expansion - churn" },
    { key: "horizon", label: "Horizon", type: "select", options: ["12 months", "18 months", "24 months"], default: "18 months" },
    { key: "convention", label: "Convention", type: "select", options: ["Rolling (re-cut every month)", "3+9", "6+6", "9+3"], default: "6+6" },
    { key: "notes", label: "Known changes", type: "textarea", placeholder: "Price increase effective April, 12 AE hires in Q2 ramping over 5 months, one large renewal at risk" },
  ],
  example: { model: "Subscription: beginning ARR + new + expansion - churn", horizon: "18 months", convention: "6+6", notes: "List price up 7% effective 2026-04 on new business only; 12 AE hires closing in Q2 FY2026 with a 5-month ramp to full quota; one 6% -of-ARR customer flagged at risk in Q4.", csv: "period,driver,actual,forecast\n2026-01,Beginning ARR ($k),182000,181000\n2026-01,New ARR ($k),5400,5800\n2026-01,Expansion ARR ($k),3100,2900\n2026-01,Churned ARR ($k),1800,1500\n2026-01,Quota-carrying reps,88,90\n2026-01,Pipeline coverage (x),3.1,3.5\n2026-02,Beginning ARR ($k),188700,188200\n2026-02,New ARR ($k),5100,6000\n2026-02,Expansion ARR ($k),3400,3000\n2026-02,Churned ARR ($k),2100,1600\n2026-02,Quota-carrying reps,91,94\n2026-03,Beginning ARR ($k),195100,195600\n2026-03,New ARR ($k),6800,6200\n2026-03,Expansion ARR ($k),4100,3100\n2026-03,Churned ARR ($k),1900,1700\n2026-03,Quota-carrying reps,94,98\n2026-04,Beginning ARR ($k),204100,203200\n2026-04,New ARR ($k),5900,6400\n2026-04,Expansion ARR ($k),3600,3200\n2026-04,Churned ARR ($k),2400,1800\n2026-04,Quota-carrying reps,96,101" },
  effort: "high",
  instructions: `1. Read the history. For every driver compute with calc: the last three values, the mean and median sequential growth, the coefficient of variation, and (where both columns exist) forecast error = actual / forecast - 1 by period, then MAPE (mean of absolute errors) and bias (mean of signed errors) per driver. Call out any driver with a bias worse than +/-5%: that is chronic optimism or sandbagging and the forecast must be adjusted for it.
2. Build the driver forecast for the horizon using the selected model, one row per driver per period: hold structural drivers (win rate, ACV, churn rate, price) at the trailing three-period average unless the notes justify a change, and grow volume drivers at the trailing growth rate damped toward the trailing-twelve-period average (state the damping). Apply the notes to the exact periods they affect (a price change flows only to new business; hires ramp linearly over the stated ramp before contributing full productivity). Derive the P&L lines from the drivers: revenue from the model, cost of revenue from usage x unit cost, opex = headcount x fully loaded cost + non-headcount run-rate. Under the 3+9, 6+6 or 9+3 convention keep the closed periods at actuals and reforecast only the remainder; label the split.
3. Scenarios: base as above; upside and downside by moving only the two drivers with the highest revenue sensitivity (compute the sensitivity: percent change in revenue per percent change in driver) by one historical standard deviation each; state each delta explicitly.
4. Reconcile: the forecast-over-forecast change versus the forecast column for any period still open (driver by driver), and the implied full-year growth versus the trailing growth rate. If the implied growth exceeds the trailing rate, say what has to be true.
Produce: kpis (forecast revenue for the horizon, implied growth, MAPE, bias, the two most sensitive drivers); table "Driver forecast" (driver, last actual, trailing average, method, then the forecast periods, quarterly if the horizon exceeds 12 months) with a note on the damping; table "P&L build" (line, closed periods, forecast periods, full year, growth); line chart with the base, upside and downside revenue paths; table "Scenario drivers" (driver, base, upside, downside, revenue impact); bullets "Assumptions that decide the answer"; risks for the R&O list with severity and mitigation; caveats on driver history length and any driver held flat for lack of data.`,
  prompt: (i) => `Build a ${str(i, "horizon", "18 months")} driver-based forecast on the ${str(i, "model", "subscription")} model under the ${str(i, "convention", "6+6")} convention, with base, upside and downside cases and a forecast-accuracy read.${str(i, "notes") ? ` Known changes: ${str(i, "notes")}` : ""}`,
};

const saasBoardPack: ToolDef = {
  kind: "ai", id: "cf-saas-metrics-board-pack", title: "SaaS metrics & board pack", tagline: "ARR waterfall, NRR, CAC payback, burn multiple and Rule of 40 from a billing export, benchmarked by stage.",
  description: "Computes the startup metric set from a customer-level billing or CRM export: ARR waterfall (new, expansion, contraction, churn), NRR and GRR on a fixed cohort, logo churn, magic number, burn multiple, CAC and CAC payback, Rule of 40 and runway. Benchmarks each against the stage table, then drafts the financial section of the board deck and the investor update in the same numbers.",
  roles: ["corpfin"], specialties: [SF, FPA, IR], category: "Reporting", icon: "Rocket", deliverable: "deck", savesMinutes: 240, tags: ["ARR", "SaaS", "board"],
  fields: [
    { key: "csv", label: "Customer ARR export", type: "csv", required: true, columns: "customer, segment (optional), arr_begin ($k), arr_end ($k), start_date (optional), churn_date (optional)", placeholder: "customer,segment,arr_begin,arr_end" },
    { key: "sm", label: "S&M spend, prior quarter", type: "number", unit: "$k", default: 7200 },
    { key: "grossMargin", label: "Gross margin", type: "number", unit: "%", default: 76 },
    { key: "netBurn", label: "Net burn, quarter", type: "number", unit: "$k", default: 5400 },
    { key: "cash", label: "Cash on hand", type: "number", unit: "$k", default: 62000 },
    { key: "stage", label: "Stage", type: "select", options: ["Seed", "Series A", "Series B", "Series C", "$50M+ ARR / pre-IPO"], default: "Series B" },
  ],
  example: { sm: 7200, grossMargin: 76, netBurn: 5400, cash: 62000, stage: "Series B", csv: "customer,segment,arr_begin,arr_end\nNorthwind Traders,Enterprise,1450,1720\nContoso,Enterprise,980,980\nFabrikam,Enterprise,760,410\nAdventure Works,Mid-market,540,0\nTailspin Toys,Mid-market,420,505\nWide World,Mid-market,380,395\nLitware,SMB,120,140\nProseware,SMB,95,0\nFourth Coffee,SMB,80,96\nGraphic Design Inc,SMB,0,210\nHumongous Health,Enterprise,0,640\nLucerne Publishing,Mid-market,0,180" },
  effort: "medium",
  instructions: `1. Compute with calc from the export, never in prose. Fixed-cohort definitions: the cohort is every customer with arr_begin > 0. New ARR = sum of arr_end for customers with arr_begin = 0. Expansion = sum of max(0, arr_end - arr_begin) over the cohort. Contraction = sum of min(0, arr_end - arr_begin) for customers still above zero. Churn = -sum of arr_begin for cohort customers with arr_end = 0. Check that beginning ARR + new + expansion + contraction + churn equals ending ARR and state the check. NRR = cohort arr_end / cohort arr_begin; GRR = (cohort arr_begin + contraction + churn) / cohort arr_begin; logo churn = churned logos / beginning logos. Net new ARR = ending - beginning.
2. Efficiency: magic number = net new ARR / prior-quarter S&M; burn multiple = net burn / net new ARR (lower is better); CAC = prior-quarter S&M / new logos; CAC payback months = CAC / (new ARR per new logo x gross margin / 12); Rule of 40 = annualized ARR growth % + FCF or EBITDA margin % (state which); runway months = cash / (net burn / 3); ARR per FTE if a headcount is available.
3. Benchmark against the stage table and say where the company sits, in a sentence per metric: burn multiple roughly 1.5-3.0x at seed, 0.8-1.5x at Series B, below 1.0x above $50M ARR; NRR roughly 100-120% at Series A rising to 110-135% at Series C; CAC payback 12-24 months at seed compressing to 6-12 months at growth stage; Rule of 40 medians near 28% for public SaaS and near 12% for private companies. Flag any metric more than one band away from stage norms as the thing the board will ask about.
4. Segment cut: run NRR, churn and expansion by segment and name the segment carrying or dragging the number; list the three largest contraction or churn accounts by dollars.
Produce: kpis (ending ARR, net new ARR, NRR, GRR, burn multiple, CAC payback, Rule of 40, runway months with tone against the stage band); waterfall "ARR waterfall" (beginning, new, expansion, contraction, churn, ending with totals marked); table "Metrics vs stage benchmark" (metric, value, stage band, read); table "By segment" (segment, beginning ARR, ending ARR, NRR, logos, churned logos); bar of the largest account movements; markdown "Board deck financial section" with action-title bullets (results vs plan, efficiency, runway and the hiring decision it implies, three risks); email "Investor update" with the same numbers in a short monthly-update structure; caveats on the definitional choices (fixed cohort, ARR at period end, no mid-period movements) and anything the export could not support.`,
  prompt: (i) => `Compute the ${str(i, "stage", "Series B")} metric set from the pasted customer ARR export (prior-quarter S&M $${num(i, "sm")}k, gross margin ${num(i, "grossMargin")}%, net burn $${num(i, "netBurn")}k, cash $${num(i, "cash")}k), benchmark it by stage, and draft the board financial section and investor update.`,
};

const targetScreener: ToolDef = {
  kind: "ai", id: "cf-ma-target-screener", title: "M&A target screener", tagline: "Screens public companies on capability keywords, size, growth and margins, then scores strategic fit.",
  description: "Builds the corporate development long-list: finds companies whose filings describe the capability you are buying, filters on revenue, growth, gross margin and valuation from SEC data, and scores each on strategic fit, financial attractiveness, technology, integration complexity and counterparty risk with a stated rubric. Every score carries the sentence from the filing that supports it.",
  roles: ["corpfin", "consultant"], specialties: [CD, SF, ...CONS], category: "Screening", icon: "Radar", deliverable: "table", savesMinutes: 360, tags: ["screening", "corp dev", "M&A"],
  fields: [
    { key: "capability", label: "Capability or thesis", type: "textarea", required: true, placeholder: "What we are buying and why: the product gap, the customer we would cross-sell to, the build-versus-buy argument" },
    { key: "keywords", label: "Filing keywords", type: "text", required: true, placeholder: "observability, incident response, telemetry pipeline" },
    { key: "revMin", label: "Revenue floor", type: "number", unit: "$mm", default: 100 },
    { key: "revMax", label: "Revenue ceiling", type: "number", unit: "$mm", default: 800 },
    { key: "growthMin", label: "Growth floor", type: "number", unit: "%", default: 15 },
    { key: "gmMin", label: "Gross margin floor", type: "number", unit: "%", default: 60 },
    { key: "count", label: "Targets", type: "number", default: 10, min: 5, max: 20 },
    { key: "acquirer", label: "Acquirer (optional)", type: "ticker", placeholder: "NOW" },
  ],
  example: { acquirer: "NOW", capability: "Add an observability and incident-response data plane to the workflow platform so we can sell one contract to the same IT buyer instead of losing the telemetry budget to point tools. Build would take three years and we have no time-series storage IP.", keywords: "observability, incident response, telemetry, application performance monitoring", revMin: 100, revMax: 800, growthMin: 15, gmMin: 60, count: 10 },
  effort: "high",
  instructions: `1. Build the candidate universe three ways and de-duplicate: (a) edgar_fulltext_search on the keywords in quotes restricted to forms ["10-K"] for the last two years, which finds companies that describe the capability in their own business section; (b) search_companies on the obvious names in the category; (c) if an acquirer is given, search_filing on its 10-K for "competition" and "competitors" and on its DEF 14A for "peer group" to pick up adjacent names. Aim for at least twice the requested target count before filtering.
2. For each candidate call get_company_financials and drop anything outside the revenue band, below the growth floor or below the gross margin floor; keep the rejects in a short "screened out" list with the reason and the number. Then call get_trading_comps with the survivors for EV/Revenue, EV/EBITDA, growth, margins and Rule of 40.
3. For each survivor, search_filing on the 10-K for the keywords plus "customers", "concentration" and "competition" and quote the sentence that proves (or disproves) the capability. Note anything that changes acquirability: a controlled or dual-class structure (DEF 14A), an existing strategic holder, recent activist or 13D activity, a change-of-control provision, or heavy customer concentration.
4. Score each target 1-5 on: strategic fit (does the filing describe our capability and our buyer), financial attractiveness (growth, margin, valuation vs the peer set), technology and product (own IP versus resale), integration complexity (headcount, geographies, on-premise versus cloud, unrelated lines), counterparty risk (ownership, governance, litigation). Weight strategic fit and financials double and state the weights. Compute the price to acquire at a 30% premium to the current price and the implied EV/Revenue, and say whether that multiple is above or below the trading median.
Tool budget: about 25 tool calls. Run at most three full-text searches, then get_company_financials only for candidates that pass the description screen, one get_trading_comps call for all survivors together, and one search_filing per short-listed target. If the budget runs short, return fewer targets and say how many candidates were left unscreened.
Produce: kpis (candidates found, screened in, median EV/Revenue of the short list, median growth); table "Long list" (company, ticker, revenue, growth, gross margin, EV, EV/Revenue, EV/EBITDA, price to acquire at 30%, implied EV/Revenue, total score, one-line rationale with citation) sorted by score; score block for the top five on the five rubric dimensions; scatter of growth versus EV/Revenue with the top target emphasized; bullets "Screened out and why"; risks (deal-blocking issues by target); nextSteps (which three to take to the deal review committee and what to diligence first).`,
  prompt: (i) => `Screen for ${num(i, "count", 10)} acquisition targets${str(i, "acquirer") ? ` for ${str(i, "acquirer").toUpperCase()}` : ""}: ${str(i, "capability")}\n\nFiling keywords: ${str(i, "keywords")}. Filters: revenue $${num(i, "revMin")}-${num(i, "revMax")}mm, growth above ${num(i, "growthMin")}%, gross margin above ${num(i, "gmMin")}%.`,
};

const synergyAccretionMemo: ToolDef = {
  kind: "ai", id: "cf-synergy-accretion-memo", title: "Synergy & accretion deal memo", tagline: "Populates the merger model from XBRL, tests the synergy case, and writes the investment committee memo.",
  description: "Builds the standard strategic merger analysis for two public companies: offer price at the stated premium, sources and uses under the chosen consideration mix, EPS accretion or dilution in year one and at full run-rate synergies, pro forma leverage and coverage, and the breakeven synergy level. Sizes the synergy claim against the target's own cost base and writes the committee memo with the aggressive assumptions flagged.",
  roles: ["corpfin", "consultant"], specialties: [CD, SF, FPA, ...CONS], category: "Modeling", icon: "Handshake", deliverable: "memo", savesMinutes: 420, tags: ["M&A", "accretion", "synergies"],
  fields: [
    { key: "acquirer", label: "Acquirer", type: "ticker", required: true, placeholder: "NOW" },
    { key: "target", label: "Target", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "premium", label: "Premium to current price", type: "number", unit: "%", default: 30 },
    { key: "mix", label: "Consideration", type: "select", options: ["100% cash", "100% stock", "50/50 cash and stock", "70/30 cash and stock", "30/70 cash and stock"], default: "50/50 cash and stock" },
    { key: "costSyn", label: "Run-rate cost synergies", type: "number", unit: "$mm", default: 400 },
    { key: "revSyn", label: "Run-rate revenue synergies (EBITDA effect)", type: "number", unit: "$mm", default: 150 },
    { key: "cta", label: "Cost to achieve (one-time)", type: "number", unit: "$mm", default: 500 },
    { key: "phasing", label: "Synergy phasing", type: "select", options: ["25/60/100 over three years", "50/85/100 over three years", "33/66/100 over three years"], default: "25/60/100 over three years" },
  ],
  example: { acquirer: "NOW", target: "DDOG", premium: 30, mix: "50/50 cash and stock", costSyn: 400, revSyn: 150, cta: 500, phasing: "25/60/100 over three years" },
  effort: "high",
  instructions: `1. Pull both sides: get_company_financials for acquirer and target, then get_xbrl_series periods 4 with concepts ["Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","OperatingIncomeLoss","NetIncomeLoss","EarningsPerShareDiluted","WeightedAverageNumberOfDilutedSharesOutstanding","LongTermDebt","InterestExpense","CashAndCashEquivalentsAtCarryingValue","StockBasedCompensation","ShareBasedCompensation"] for both (values are raw units: divide USD by 1e6 and shares by 1e6). Use diluted share counts and diluted EPS from XBRL, not cover-page shares, and say which period each figure comes from.
2. Offer and funding with calc: offer per share = target price x (1 + premium); equity value = offer x target diluted shares; enterprise value = equity value + target debt - target cash; cash consideration and stock consideration per the mix; new acquirer shares = stock consideration / acquirer price; new debt = cash consideration less any acquirer balance-sheet cash used (use cash down to a stated minimum operating cash, then debt); fees at 1.5% of equity value unless stated.
3. Accretion: pro forma net income = acquirer net income + target net income + after-tax run-rate synergies at the phasing for each of years one to three - after-tax interest on new debt (use the acquirer's average borrowing cost from InterestExpense / average debt, or 5.5% if it has no debt, and say which) - after-tax foregone interest on cash used (use 4% unless the filings support another rate); pro forma diluted shares = acquirer diluted shares + new shares; pro forma EPS and accretion versus standalone EPS for each year. Breakeven synergies = the pre-tax synergy amount that sets accretion to zero in year one; solve it and state it as a percentage of target revenue and of target operating expense.
4. Credit and sanity: pro forma net debt / combined EBITDA (target EBITDA plus run-rate synergies, and again without synergies), pro forma interest coverage, and the implied EV/Revenue and EV/EBITDA paid versus the target's trading multiples from get_trading_comps. Test the synergy case: cost synergies as a percentage of target operating expense (above roughly 25-30% of target opex or above 8-10% of target revenue needs a named source such as duplicate public-company costs, sales overlap or hosting consolidation, since a cost-to-achieve near or above one year of run-rate synergies is the usual signal of an aggressive claim) and note that revenue synergies are credited at zero in the committee base case unless the memo can name the cross-sell motion.
Produce: kpis (offer per share, premium, equity value, EV, year-one accretion %, run-rate accretion %, breakeven synergies, pro forma net leverage); table "Sources and uses"; table "Accretion / dilution" (line from acquirer net income through synergies, interest, foregone interest, pro forma net income, shares, EPS, accretion % for years 1-3) with emphasisRow on pro forma EPS; sensitivity of year-one accretion to premium x run-rate synergies; waterfall from acquirer standalone net income to pro forma net income; markdown "Committee memo" (thesis, price, synergy case, financing, integration risk, recommendation); risks with severity; caveats (no purchase accounting step-up or intangible amortization modeled, GAAP EPS not adjusted, target standalone plan unavailable).`,
  prompt: (i) => `Model ${str(i, "acquirer").toUpperCase()} acquiring ${str(i, "target").toUpperCase()} at a ${num(i, "premium", 30)}% premium, ${str(i, "mix", "50/50 cash and stock")}, with $${num(i, "costSyn")}mm cost and $${num(i, "revSyn")}mm revenue synergies phased ${str(i, "phasing", "25/60/100 over three years")} and $${num(i, "cta")}mm cost to achieve. Write the committee memo.`,
};

const earningsScript: ToolDef = {
  kind: "ai", id: "cf-earnings-script", title: "Earnings call script drafter", tagline: "Prepared remarks in your prior-quarter voice, with the constant-currency and non-GAAP bridges built in.",
  description: "Drafts the CEO and CFO prepared remarks for the earnings call by learning the structure and cadence of the company's own prior releases and remarks, then filling them with the quarter's results. Includes the constant-currency bridge, the non-GAAP framing with a Regulation G reconciliation checklist, the guidance paragraph, and the handoff lines.",
  roles: ["corpfin"], specialties: [IR, FPA, SF], category: "Communication", icon: "Presentation", deliverable: "memo", savesMinutes: 300, tags: ["earnings", "script", "IR"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "NOW" },
    { key: "quarter", label: "Quarter", type: "text", required: true, default: "Q3 FY2026" },
    { key: "csv", label: "Results and guidance", type: "csv", required: true, columns: "metric, actual, guidance_mid (optional), prior_year (optional), next_period_low (optional), next_period_high (optional); $mm or % as labeled in the metric name", placeholder: "metric,actual,guidance_mid,prior_year" },
    { key: "themes", label: "Messages to land", type: "textarea", placeholder: "Three things we want the market to take away" },
    { key: "length", label: "Length", type: "select", options: ["Tight (8 minutes)", "Standard (12 minutes)", "Full (18 minutes)"], default: "Standard (12 minutes)" },
  ],
  example: { ticker: "NOW", quarter: "Q3 FY2026", length: "Standard (12 minutes)", themes: "Subscription growth held above 20% in constant currency; operating margin expanded 150 bps with AI products contributing for the first time; we are raising the full-year subscription revenue range.", csv: "metric,actual,guidance_mid,prior_year,next_period_low,next_period_high\nSubscription revenue ($mm),3540,3505,2950,3780,3800\nTotal revenue ($mm),3660,3620,3060,,\ncRPO growth (%),21.5,20.5,24.0,,\nNon-GAAP operating margin (%),31.2,30.0,30.1,30.5,30.5\nFree cash flow ($mm),610,,505,,\nFX headwind to subscription revenue ($mm),-28,,,," },
  effort: "medium",
  instructions: `1. Learn the voice. get_recent_filings with forms ["8-K"] limit 20, then read_document on the last two Item 2.02 filings (the release is Exhibit 99.1; if the primary document is only a cover page, read the exhibit) with queries "financial highlights", "outlook", "we are", "non-GAAP", and on any prepared-remarks exhibit (EX-99.2). Record the structure: the order of metrics in the CFO section, the recurring phrases, how guidance is introduced, how FX is described, the closing line and the handoff to Q&A. search_filing on the latest 10-Q for "outlook" and the key operating metric definitions so the script uses the company's own words.
2. Check the numbers before writing. With calc compute, from the pasted table: growth versus prior year, beat versus the guidance midpoint in dollars and percent, margin change in basis points, constant-currency growth (growth excluding the stated FX effect: (actual - FX effect) / prior year - 1), and the sequential trend. Cross-check reported actuals against XBRL with get_xbrl_series for the revenue and operating income concepts and flag any figure that does not tie.
3. Write the remarks in the company's structure, at the requested length (roughly 130 words per minute, split about 40% CEO and 60% CFO): CEO opening and headline, business and product commentary tied to the messages to land, customer proof point; CFO results in the same metric order as the prior quarter, constant-currency bridge, margin and cash flow drivers, capital allocation, then guidance with the reason for any change; closing and handoff. Every number in the script must come from the pasted table or a tool call. Mark anything you could not verify as [confirm] rather than guessing.
Produce: markdown "Prepared remarks" with ## CEO and ## CFO sections in speakable sentences (no bullets inside the remarks, short sentences, numbers spelled the way they are spoken); table "Number check" (metric, actual, prior year, growth, constant currency, guidance midpoint, beat, source) with totals omitted; bullets "Non-GAAP and Regulation G checklist" (each non-GAAP measure named must appear with its most directly comparable GAAP measure and a reconciliation of equal prominence, no per-share presentation of a liquidity measure such as free cash flow, no individually tailored revenue recognition); bullets "Language changes versus last quarter" (what was dropped, added or softened, since analysts diff the script); checklist "Pre-call tasks" with owners; caveats on unverified figures.`,
  prompt: (i) => `Draft ${str(i, "quarter")} prepared remarks for ${str(i, "ticker").toUpperCase()} in the voice of its prior releases, ${str(i, "length", "Standard (12 minutes)").toLowerCase()}.${str(i, "themes") ? ` Messages to land: ${str(i, "themes")}` : ""}`,
};

const earningsRelease: ToolDef = {
  kind: "ai", id: "cf-earnings-release", title: "Earnings release drafter", tagline: "The 8-K press release in your own house format, with Reg G reconciliations and the guidance table.",
  description: "Drafts the quarterly earnings press release by mirroring the company's own prior Exhibit 99.1: headline and subheads, the financial highlights order, the operating metrics paragraph, the guidance table, the non-GAAP reconciliation tables required by Regulation G and Item 10(e), the safe-harbor language, and the conference-call logistics block.",
  roles: ["corpfin", "accountant"], specialties: [IR, CTRL, FPA, ...ACCT], category: "Communication", icon: "ScrollText", deliverable: "memo", savesMinutes: 240, tags: ["earnings", "press release", "8-K"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "quarter", label: "Quarter", type: "text", required: true, default: "Q3 FY2026" },
    { key: "csv", label: "Results", type: "csv", required: true, columns: "line, current ($mm or as labeled), prior_year, gaap_or_non_gaap, adjustment_detail (optional)", placeholder: "line,current,prior_year,gaap_or_non_gaap" },
    { key: "guidance", label: "Guidance to publish", type: "csv", columns: "metric, period, low, high" },
    { key: "highlights", label: "Business highlights", type: "textarea", placeholder: "Customer wins, product launches, partnerships, executive changes to reference" },
  ],
  example: { ticker: "DDOG", quarter: "Q3 FY2026", highlights: "Crossed 4,000 customers with ARR above $100k; launched the AI agent observability suite; signed a nine-figure multi-year commitment with a global bank.", csv: "line,current,prior_year,gaap_or_non_gaap,adjustment_detail\nRevenue ($mm),1085,826,GAAP,\nGross profit ($mm),876,663,GAAP,\nOperating income ($mm),68,31,GAAP,\nStock-based compensation ($mm),196,168,adjustment,Included in the non-GAAP bridge\nAmortization of acquired intangibles ($mm),9,7,adjustment,\nNon-GAAP operating income ($mm),273,206,non-GAAP,\nNet income ($mm),94,52,GAAP,\nDiluted EPS ($),0.26,0.15,GAAP,\nNon-GAAP diluted EPS ($),0.54,0.45,non-GAAP,\nOperating cash flow ($mm),330,258,GAAP,\nFree cash flow ($mm),284,220,non-GAAP,Operating cash flow less capex and capitalized software\nCustomers with ARR over $100k,4010,3130,metric,", guidance: "metric,period,low,high\nRevenue ($mm),Q4 FY2026,1120,1124\nRevenue ($mm),FY2026,4215,4219\nNon-GAAP operating income ($mm),FY2026,1010,1014\nNon-GAAP diluted EPS ($),FY2026,2.10,2.12" },
  effort: "medium",
  instructions: `1. Get the house format. get_recent_filings forms ["8-K"] limit 20 and read_document on the two most recent Item 2.02 releases (Exhibit 99.1) with queries "reported", "highlights", "outlook", "non-GAAP", "forward-looking", "conference call". Capture verbatim structure: headline pattern, the order of the financial highlights bullets, the standing operating metrics, the guidance table layout, the exact non-GAAP definitions the company publishes, the safe-harbor paragraph, and the boilerplate "About" paragraph. Reuse that structure rather than inventing one; reuse the company's own metric names.
2. Verify the numbers. With calc compute growth for every line, margins, the GAAP-to-non-GAAP bridge (GAAP measure plus each adjustment equals the non-GAAP measure: check it and say so), and free cash flow from operating cash flow less capex. Reconcile the current-quarter GAAP figures to XBRL with get_xbrl_series on the revenue, operating income and net income concepts where the period is already filed, and flag any mismatch instead of silently using the pasted number.
3. Draft the release: headline with the one or two facts that lead, two subheads, the quote from the CEO and one from the CFO in the prior releases' register, financial highlights in the prior order with prior-year comparisons, business highlights from the notes (nothing not given), the guidance table exactly as pasted, the reconciliation tables, safe harbor and call logistics. Apply Regulation G and Item 10(e): present the most directly comparable GAAP measure with equal prominence, never lead with a non-GAAP figure alone, do not present free cash flow or another liquidity measure on a per-share basis, do not use individually tailored revenue measures, and reconcile forward-looking non-GAAP guidance or state why a reconciliation is not available without unreasonable effort.
Produce: markdown "Press release draft" with the headline, subheads, quotes and body; table "Financial highlights" (line, current, prior year, change %, GAAP or non-GAAP); table "GAAP to non-GAAP reconciliation" (GAAP line, each adjustment, non-GAAP line) with the check shown; table "Guidance" as pasted; checklist "Reg G and Item 10(e) review" (one item per requirement, marked done or open); bullets "Disclosure decisions to confirm with counsel and the audit committee"; caveats on any figure that did not tie to XBRL and on the numbers taken on trust from the paste.`,
  prompt: (i) => `Draft ${str(i, "ticker").toUpperCase()}'s ${str(i, "quarter")} earnings press release in its own prior format, with the reconciliation tables and the guidance table.${str(i, "highlights") ? ` Business highlights: ${str(i, "highlights")}` : ""}`,
};

const closeFluxPack: ToolDef = {
  kind: "ai", id: "cf-close-flux-pack", title: "Close flux & balance explanations", tagline: "Trial-balance deltas turned into material flux narratives for the audit committee and the auditors.",
  description: "Takes a pasted trial balance with the prior period and the budget, applies a materiality rule in both dollars and percent, and writes the flux explanation for every account that breaches it: what moved, the driver, whether it is timing or permanent, and what evidence supports it. Produces the close checklist and the open items the controller has to chase.",
  roles: ["corpfin", "accountant"], specialties: [CTRL, FPA, ...ACCT], category: "Accounting & audit", icon: "ClipboardList", deliverable: "memo", savesMinutes: 180, tags: ["close", "flux", "controller"],
  fields: [
    { key: "csv", label: "Trial balance", type: "csv", required: true, columns: "account, account_type (optional: asset/liability/revenue/expense), current ($k), prior ($k), budget ($k, optional), prior_year ($k, optional)", placeholder: "account,account_type,current,prior,budget" },
    { key: "period", label: "Period", type: "text", default: "September 2026" },
    { key: "matAmt", label: "Materiality", type: "number", unit: "$k", default: 150 },
    { key: "matPct", label: "Materiality", type: "number", unit: "%", default: 10 },
    { key: "audience", label: "Audience", type: "select", options: ["Audit committee", "Controller review", "External auditors", "CFO"], default: "Audit committee" },
    { key: "ticker", label: "Ticker (optional)", type: "ticker", placeholder: "NKE", help: "Used to borrow the company's own MD&A language for the same accounts" },
  ],
  example: { period: "September 2026", matAmt: 150, matPct: 10, audience: "Audit committee", ticker: "NKE", csv: "account,account_type,current,prior,budget,prior_year\nAccounts receivable,asset,48200,43100,45000,41500\nInventory,asset,31400,29800,28500,26900\nPrepaid expenses,asset,4100,5600,5200,5100\nAccrued compensation,liability,12800,9400,11500,9100\nDeferred revenue,liability,26700,25100,26000,21400\nAccounts payable,liability,18900,21300,20000,19700\nRevenue,revenue,62400,58900,61000,54200\nCost of revenue,expense,21800,19700,20500,18600\nSales and marketing,expense,11200,9800,10400,9300\nResearch and development,expense,8600,8500,8800,7900\nGeneral and administrative,expense,4900,4200,4300,4000\nBad debt expense,expense,620,180,200,210" },
  effort: "medium",
  instructions: `1. Compute with calc for every account: month-over-month delta and percent, delta versus budget, delta versus prior year, and the percent of the account balance. Apply the dual materiality rule: an account is reportable only when it breaches both the dollar and the percent threshold, except that any new account, any sign flip, and any contra or reserve account movement is always reportable. Report the count of accounts tested, breached and waived.
2. Tie the books together before explaining anything: revenue less cost of revenue less operating expense equals operating income; the change in accounts receivable against the change in revenue (implied DSO days, computed as AR / revenue x days in period); the change in deferred revenue against billings; the change in accrued compensation against the number of payroll accrual days; inventory against cost of revenue (implied DIO). Where a balance moves against its driver, that mismatch is the flux story, not the balance itself.
3. Write each flux explanation in the pattern auditors accept: the account and the amount of the move, the driver quantified, the classification (volume, timing, rate, accrual or estimate change, reclassification, one-time, error), whether it reverses next period, and the evidence that supports it (subledger, aging, contract, payroll calendar). Never invent a driver: where the trial balance alone cannot explain the move, write the specific question and the document to pull, and put it in the open items rather than in the narrative. If a ticker was given, search_filing on the latest 10-Q for "compared to" plus the account name so the wording matches how the company already explains that line externally.
4. Tailor the audience: the audit committee gets four to six sentences on the material moves and any estimate change; the controller review gets every breach with the owner; the auditors get the classification and the evidence reference; the CFO gets the P&L effect and the full-year implication.
Produce: kpis (accounts tested, material breaches, largest favorable and unfavorable moves, net income effect of the flux items, estimate changes); table "Flux analysis ($k)" sorted by absolute delta (account, type, current, prior, delta, delta %, vs budget, vs prior year, classification, reportable) with totals; markdown "Flux narratives" with one short paragraph per material account; table "Driver ties" (balance, driver, implied metric such as DSO or DIO, prior, change, comment); qa "Open items" (the question and the document to pull); checklist "Close tasks" with owners and due dates; caveats on accounts that could not be typed and on any explanation labeled as a hypothesis.`,
  prompt: (i) => `Write the ${str(i, "period")} flux pack for the ${str(i, "audience", "audit committee").toLowerCase()} from the pasted trial balance; materiality is $${num(i, "matAmt")}k and ${num(i, "matPct")}%.${str(i, "ticker") ? ` Borrow ${str(i, "ticker").toUpperCase()}'s own MD&A phrasing where it fits.` : ""}`,
};

const rollingReforecast: ToolDef = {
  kind: "ai", id: "cf-rolling-reforecast", title: "Quarterly reforecast", tagline: "Actuals plus a rebuilt remainder: forecast-over-forecast deltas, the R&O list, and what to tell the CFO.",
  description: "Produces the quarterly reforecast under the 3+9, 6+6 or 9+3 convention: closed periods at actuals, the remainder rebuilt line by line, then the forecast-over-forecast change explained by line with the run-rate maths behind it. Ends with the risks and opportunities register, probability-weighted, and the decision the CFO has to make on the gap to budget.",
  roles: ["corpfin"], specialties: [FPA, SF, IR], category: "Planning & forecasting", icon: "RefreshCw", deliverable: "table", savesMinutes: 240, tags: ["reforecast", "rolling forecast", "FP&A"],
  fields: [
    { key: "csv", label: "Budget, prior forecast, actuals", type: "csv", required: true, columns: "line, budget_fy ($k), prior_forecast_fy ($k), actual_ytd ($k), budget_ytd ($k); one row per P&L line", placeholder: "line,budget_fy,prior_forecast_fy,actual_ytd,budget_ytd" },
    { key: "convention", label: "Convention", type: "select", options: ["3+9", "6+6", "9+3", "Rolling 12"], default: "6+6" },
    { key: "method", label: "Remainder method", type: "select", options: ["Trend the YTD run-rate", "Hold the prior forecast unless YTD proves otherwise", "Rebuild from drivers in the notes"], default: "Hold the prior forecast unless YTD proves otherwise" },
    { key: "notes", label: "Changes since the last forecast", type: "textarea", placeholder: "Deals slipped, hiring freeze, price increase, contract won, FX move, cost action" },
  ],
  example: { convention: "6+6", method: "Hold the prior forecast unless YTD proves otherwise", notes: "Two enterprise deals worth $2.4M of in-year revenue slipped from June to Q3; hiring freeze on all G&A reqs from July; cloud committed-spend discount lands in August worth roughly $90k a month; EUR is running 3% below the budget rate.", csv: "line,budget_fy,prior_forecast_fy,actual_ytd,budget_ytd\nSubscription revenue,148000,150000,73100,72000\nServices revenue,21000,19500,9100,10200\nCost of revenue,40500,40800,20400,19800\nSales and marketing,49000,50200,25600,24100\nResearch and development,37000,36200,17900,18300\nGeneral and administrative,16500,16900,8600,8100\nCapex,9000,9000,3800,4400" },
  effort: "medium",
  instructions: `1. Establish the base with calc for every line: actual YTD versus budget YTD (dollar and percent), the YTD run-rate annualized, the implied remainder in the prior forecast (prior forecast FY less actual YTD) and what that remainder implies as a period run-rate versus the YTD actual run-rate. State the closed-period count from the convention (3+9 means three months closed and nine reforecast) and never reforecast a closed period.
2. Rebuild the remainder by the chosen method. Trend the run-rate: remainder = YTD run-rate x remaining periods, adjusted for known seasonality if the history shows it. Hold the prior forecast: keep the prior remainder unless YTD variance exceeds 3% of the YTD budget, in which case rebase by the YTD variance ratio and say so. Rebuild from drivers: use the notes as the drivers and show the arithmetic. Apply each item in the notes to the correct line and period with an amount (slipped deals move revenue between periods and change nothing in the full year unless the note says the deal was lost; a hiring freeze reduces the remainder's compensation run-rate; an FX move is applied to the exposed revenue share).
3. Explain the movement: forecast-over-forecast change by line (new FY versus prior forecast FY) and the gap to budget by line, each decomposed into the YTD variance carried forward and the change in the remainder, which must sum to the total change. Verify with calc and state the check. Then compute the derived lines: gross margin, EBITDA or operating income, and the full-year growth rate implied under the new view versus the budget.
4. Build the risks and opportunities register from the notes and the variances: each item with an owner, a dollar amount, a probability, the period it lands in, and the probability-weighted value. Total the weighted risk and opportunity and compare with the gap to budget so the reader can see whether the gap is coverable.
Produce: kpis (new FY revenue, change versus prior forecast, gap to budget, new FY EBITDA, weighted R&O coverage of the gap, YTD variance); table "Reforecast ($k)" (line, budget FY, prior forecast FY, actual YTD, reforecast remainder, new FY, vs prior forecast, vs budget, %) with totals and emphasisRow on the EBITDA line; waterfall from the prior forecast to the new forecast through the four or five largest line changes plus "Other" (verify the steps sum); table "Risks and opportunities" (item, owner, line, amount, probability, weighted, period); bullets "What changed and why"; nextSteps (the decision the CFO must make, the actions that would close the gap, and what to tell the board); caveats on the method and any line held flat for lack of evidence.`,
  prompt: (i) => `Reforecast the year on the ${str(i, "convention", "6+6")} convention using ${str(i, "method", "the prior forecast unless YTD proves otherwise").toLowerCase()}, explain the forecast-over-forecast change by line, and build the R&O register.${str(i, "notes") ? ` Changes since the last forecast: ${str(i, "notes")}` : ""}`,
};

const workingCapitalPeers: ToolDef = {
  kind: "ai", id: "cf-working-capital-peers", title: "Working capital benchmark & cash unlock", tagline: "DSO, DIO, DPO and the cash conversion cycle versus peers from XBRL, with the cash each gap is worth.",
  description: "Pulls receivables, inventory and payables from SEC XBRL for the company and its peers, computes DSO, DIO, DPO and the cash conversion cycle on a consistent basis, ranks the company against the peer median and the best quartile, and converts every gap into the cash it would release. Reads the filings for the payment terms, factoring and supply-chain-finance disclosures that explain why the peers are where they are.",
  roles: ["corpfin", "consultant", "accountant"], specialties: [TR, FPA, CTRL, ...CONS], category: "Reporting", icon: "ArrowLeftRight", deliverable: "analysis", savesMinutes: 210, tags: ["working capital", "CCC", "DSO"],
  fields: [
    { key: "ticker", label: "Your company", type: "ticker", required: true, placeholder: "NKE" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "DECK SKX VFC UAA LULU", help: "Leave empty to build the set from the 10-K competitor language" },
    { key: "target", label: "Target", type: "select", options: ["Peer median", "Best quartile", "Best in class"], default: "Peer median" },
    { key: "years", label: "Years of history", type: "number", default: 4, min: 2, max: 6 },
    { key: "rate", label: "Cost of funds", type: "number", unit: "%", default: 6, help: "Used to value the released cash annually" },
  ],
  example: { ticker: "NKE", peers: ["DECK", "SKX", "VFC", "UAA", "LULU"], target: "Peer median", years: 4, rate: 6 },
  effort: "medium",
  instructions: `1. If no peers are given, search_filing on the subject's 10-K for "competitors" and on the DEF 14A for "peer group", and keep 5-7 US-listed names with comparable business models; say why each is in.
2. For the subject and every peer call get_xbrl_series with periods equal to the requested years and concepts ["AccountsReceivableNetCurrent","InventoryNet","AccountsPayableCurrent","Revenues","RevenueFromContractWithCustomerExcludingAssessedTax","CostOfRevenue","CostOfGoodsAndServicesSold","CostOfGoodsSold"]. Values are raw USD, so divide by 1e6 and label everything in millions. When a concept is absent, call get_xbrl_series with find "Receivable|Inventory|Payable|CostOf" and take the closest tag, naming the substitute in the table note. Use annual (fiscal-year) values and record each company's fiscal year end.
3. Compute with calc, per company and per year: DSO = accounts receivable / revenue x 365; DIO = inventory / cost of revenue x 365 (report as not applicable where there is no inventory); DPO = accounts payable / cost of revenue x 365; cash conversion cycle = DSO + DIO - DPO; net working capital = receivables + inventory - payables, and NWC as a percent of revenue. Use fiscal-year-end balances and say so (a trailing two-point average is the alternative; note the difference). Then take the peer median and the best quartile for each metric and rank the subject.
4. Convert the gaps to cash on the subject's own scale: receivables unlock = (subject DSO - target DSO) x subject revenue / 365; inventory unlock = (subject DIO - target DIO) x subject cost of revenue / 365; payables unlock = (target DPO - subject DPO) x subject cost of revenue / 365. Total the three, apply the cost of funds to give the annual carrying benefit, and compare the total with the subject's cash balance and revolver so the reader sees the scale.
5. Explain the gaps from the filings, not from theory: search_filing on the subject's and the two most different peers' 10-K or 10-Q for "payment terms", "supply chain financing" or "supplier finance program", "factoring", "receivable sales", "inventory" and "days". A peer with a supplier-finance program or receivable sales is not a like-for-like DPO or DSO comparison; say so explicitly. Note channel mix (wholesale versus direct), seasonality and the effect of the fiscal year end on inventory.
Produce: kpis (subject CCC, peer median CCC, gap in days, total cash unlock, annual carrying benefit, worst-ranked component); table "Working capital benchmark" with the subject first (emphasisRow 0), peers, and the peer median in totals, columns DSO, DIO, DPO, CCC, NWC % of revenue, fiscal year end; line chart of the subject's CCC over the requested years with the peer median as a second series; table "Cash unlock" (lever, subject days, target days, gap, cash released, annual carrying benefit, owner); bullets "Why the peers differ" with citations to the payment-terms and supplier-finance disclosures; nextSteps (the two levers with the best ratio of cash to effort and the first action each); caveats on ending versus average balances, fiscal year alignment, supplier finance and factoring comparability, and any substituted tag.`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()}'s working capital against ${list(i, "peers").length ? list(i, "peers").join(", ") : "a peer set you build from the 10-K"} over ${num(i, "years", 4)} years, target the ${str(i, "target", "peer median").toLowerCase()}, and quantify the cash unlock at a ${num(i, "rate", 6)}% cost of funds.`,
};

const cashPooling: ToolDef = {
  kind: "ai", id: "cf-cash-pooling", title: "Cash pooling & liquidity structure", tagline: "Entity and currency map into a pooling design: header accounts, sweeps, intercompany terms, trapped cash.",
  description: "Designs the liquidity structure from an entity, currency and bank map: which balances concentrate into which header account, physical zero-balance sweeps versus notional netting versus an in-house bank, the intercompany loan documentation and arm's-length interest that physical pooling creates, and the trapped-cash and withholding issues that decide what is actually poolable. Quantifies the idle cash mobilized and the interest benefit.",
  roles: ["corpfin"], specialties: [TR, CTRL, SF], category: "Planning & forecasting", icon: "Landmark", deliverable: "memo", savesMinutes: 300, tags: ["treasury", "pooling", "liquidity"],
  fields: [
    { key: "csv", label: "Entity, currency and bank map", type: "csv", required: true, columns: "entity, country, currency, bank, average_balance_local (mm), minimum_operating_local (mm), trapped (Y/N), notes", placeholder: "entity,country,currency,bank,average_balance_local,minimum_operating_local,trapped" },
    { key: "structure", label: "Structure to evaluate", type: "select", options: ["Physical pooling (ZBA sweeps)", "Notional pooling", "In-house bank", "Hybrid: physical by currency, notional overlay"], default: "Hybrid: physical by currency, notional overlay" },
    { key: "investRate", label: "Investment rate on concentrated cash", type: "number", unit: "%", default: 4.5 },
    { key: "borrowRate", label: "Borrowing rate on the revolver", type: "number", unit: "%", default: 6.5 },
    { key: "notes", label: "Constraints", type: "textarea", placeholder: "Bank group, existing credit agreement restrictions, tax or exchange-control issues, ERP and bank connectivity" },
  ],
  example: { structure: "Hybrid: physical by currency, notional overlay", investRate: 4.5, borrowRate: 6.5, notes: "Credit agreement restricts intercompany loans to $250mm in aggregate; two banks in the revolver group want the operating flows; India and Brazil entities have exchange controls; treasury team of three, no TMS.", csv: "entity,country,currency,bank,average_balance_local,minimum_operating_local,trapped,notes\nParent Inc,United States,USD,Bank A,180,60,N,Revolver borrower\nUS OpCo,United States,USD,Bank A,95,25,N,\nCanada Ltd,Canada,CAD,Bank A,42,12,N,\nUK Ltd,United Kingdom,GBP,Bank B,58,15,N,Receives EMEA collections\nGermany GmbH,Germany,EUR,Bank B,74,20,N,\nNetherlands BV,Netherlands,EUR,Bank B,31,8,N,Holding company\nSingapore Pte,Singapore,SGD,Bank C,26,9,N,\nIndia Pvt,India,INR,Bank C,2400,900,Y,Exchange controls\nBrazil Ltda,Brazil,BRL,Bank C,110,45,Y,IOF tax on transfers" },
  effort: "high",
  instructions: `1. Map what exists. From the pasted map compute with calc: total balances by currency and by bank (converted to USD at a stated rate, which you should source with web_research for the major pairs or state as an assumption), the surplus above minimum operating cash by entity, the share of total cash that is trapped, and the concentration by bank. Report how much cash is genuinely mobilizable: surplus, not trapped, and not restricted by the constraints in the notes.
2. Design the structure by currency, not by entity. Propose a header (concentration) account per material currency with the entity that should own it and why, the participants sweeping into it, and the sweep mechanics (zero balance, target balance, or end-of-day). Keep the US dollar leg physical: notional pooling is generally not permitted for US-resident participants, so a US structure concentrates through actual sweeps; say this explicitly rather than proposing a notional US pool. For the non-US legs, compare notional netting (balances net at the bank, no cash moves, interest optimization, simpler tax profile) against physical sweeps (real concentration, real intercompany loans) and recommend one with reasons. Cover the in-house bank only when the entity count and volume justify it, and say what it requires: an internal account structure, transfer pricing, and someone to run it.
3. Deal with the consequences that get treasurers into trouble. Physical pooling creates intercompany loans: they need documented facility agreements, arm's-length interest (a stated spread over the relevant reference rate, consistent across participants, with a thin-capitalization check), withholding-tax review on interest by jurisdiction, and a check against the credit agreement's limits on intercompany indebtedness and investments in subsidiaries (use the constraints in the notes; if a public ticker is available, edgar_fulltext_search the credit agreement for "Investments" and "Intercompany Indebtedness"). Trapped cash stays out of the pool: name each blocked entity, the mechanism (exchange control, transfer tax, minimum capital, dividend restriction) and the alternative (dividend calendar, royalty or service fee, local overdraft against the balance).
4. Quantify the benefit: interest income on newly concentrated surplus at the investment rate; avoided revolver borrowing at the borrowing rate where a subsidiary was borrowing while another sat on cash; the spread compression from netting debit and credit balances; less the bank fees and implementation cost. Present the net annual benefit and be explicit that the first-order benefit is usually avoided borrowing, not investment yield.
Produce: kpis (total cash, mobilizable surplus, trapped cash, cash concentrated under the design, net annual benefit, participants); table "Entity map" (entity, country, currency, bank, balance USD, minimum, surplus, poolable or blocked and why); table "Proposed structure" (currency, header account owner, bank, participants, mechanism, sweep frequency); steps "Implementation" (documentation, bank onboarding, ERP and bank connectivity, intercompany agreements, transfer pricing file, go-live by currency leg); risks "Legal, tax and credit" with severity and mitigation (notional pooling restriction for US participants, withholding tax, thin capitalization, credit agreement limits, commingling and insolvency risk, exchange controls); bullets "Policy language to add"; caveats that this is a treasury design and not tax or legal advice, plus every FX rate assumed.`,
  prompt: (i) => `Design the ${str(i, "structure", "pooling")} liquidity structure from the pasted entity and bank map, quantify the benefit at a ${num(i, "investRate", 4.5)}% investment rate and a ${num(i, "borrowRate", 6.5)}% borrowing rate, and list the documentation and tax steps.${str(i, "notes") ? ` Constraints: ${str(i, "notes")}` : ""}`,
};

const bankRfpScorecard: ToolDef = {
  kind: "ai", id: "cf-bank-rfp-scorecard", title: "Bank relationship RFP scorecard", tagline: "Fees, wallet share versus credit provided, a weighted scorecard, and the RFP question set.",
  description: "Turns the bank analysis statements and the credit commitments into the annual bank review: fee spend by service and by bank, unit prices against market ranges, share of wallet against share of credit provided, a weighted scorecard on the criteria that decide the panel, and the RFP question set plus the letter to the banks. Built for the treasurer who has to defend the panel to the CFO.",
  roles: ["corpfin"], specialties: [TR, CTRL, FPA], category: "Diligence", icon: "Scale", deliverable: "table", savesMinutes: 300, tags: ["banking", "RFP", "fees"],
  fields: [
    { key: "csv", label: "Bank fees and services", type: "csv", required: true, columns: "bank, service (e.g. ACH origination, wire out, lockbox, account maintenance, FX spread), volume (items), unit_price ($), annual_fee ($k)", placeholder: "bank,service,volume,unit_price,annual_fee" },
    { key: "credit", label: "Credit and wallet", type: "csv", columns: "bank, revolver_commitment ($mm), term_loan ($mm), other_credit ($mm), ancillary_revenue_to_bank ($k, optional)" },
    { key: "criteria", label: "Scoring criteria", type: "multiselect", options: ["Credit commitment", "Pricing", "Platform and API quality", "Geographic coverage", "Service quality and escalation", "Implementation capability", "FX and hedging execution", "Card and payables programs", "Counterparty credit rating"], default: ["Credit commitment", "Pricing", "Platform and API quality", "Geographic coverage", "Service quality and escalation"] },
    { key: "goal", label: "Decision", type: "select", options: ["Annual review and renegotiation", "Consolidate the panel", "Add a bank", "Full RFP and re-bid"], default: "Annual review and renegotiation" },
  ],
  example: { goal: "Annual review and renegotiation", criteria: ["Credit commitment", "Pricing", "Platform and API quality", "Geographic coverage", "Service quality and escalation"], csv: "bank,service,volume,unit_price,annual_fee\nBank A,Account maintenance,144,35,5.0\nBank A,ACH origination,820000,0.11,90.2\nBank A,Wire out domestic,4200,9.50,39.9\nBank A,Lockbox items,310000,0.42,130.2\nBank A,Positive pay,96,55,5.3\nBank B,Account maintenance,72,40,2.9\nBank B,ACH origination,240000,0.14,33.6\nBank B,Wire out international,1800,32.00,57.6\nBank B,FX spread (bps on $420mm),420,45.00,18.9\nBank C,Account maintenance,48,45,2.2\nBank C,Wire out domestic,900,14.00,12.6\nBank C,Cash concentration sweeps,1200,6.50,7.8", credit: "bank,revolver_commitment,term_loan,other_credit,ancillary_revenue_to_bank\nBank A,400,150,25,320\nBank B,250,0,40,115\nBank C,100,0,0,26" },
  effort: "medium",
  instructions: `1. Normalize the fee data with calc: total annual fees by bank and by service, the implied unit price for every line (annual fee / volume, reconciled against the stated unit price and flagged where they disagree), the fee per account and per transaction, and the share of total spend by bank. Group services into the standard families (depository and maintenance, disbursements, receivables and lockbox, information and reporting, liquidity and sweeps, FX, fraud controls) so the comparison is like for like. Where a service appears at more than one bank, rank the unit prices and compute the saving from moving the volume to the cheapest provider at current volumes; where a bank appears only once, say the price cannot be benchmarked internally and mark it for the RFP. Use web_research only to sanity-check typical ranges for the largest lines, and label any external range as indicative.
2. Wallet versus credit: from the credit table compute each bank's share of total committed credit, share of total fees, and share of ancillary revenue, then the ratio of wallet share to credit share. A bank providing a quarter of the credit and receiving a tenth of the wallet is the relationship at risk at renewal; name it. Total the committed credit and say whether the fee pool is large enough to support the panel.
3. Score each bank 1-5 on the selected criteria, with the weights shown and summing to 100% (credit commitment and pricing usually carry the most weight in a review, platform and coverage in a re-bid). Every score needs a one-line justification anchored to the data or a stated judgement, never a number on its own. Compute the weighted total and rank the panel.
4. Build the decision output for the stated goal: which volumes to move and the dollar saving, which fees to challenge with the specific unit price and the comparison, the target panel size, and the transition risk of each change (implementation effort, single points of failure, concentration of operating accounts at one bank).
Produce: kpis (total annual bank fees, largest bank by fees, fee saving identified, total committed credit, worst wallet-to-credit ratio); table "Fees by bank and service" (bank, service family, volume, unit price, annual fee, best available unit price, saving at current volume) with totals; table "Wallet versus credit" (bank, committed credit, credit share, fees, fee share, ancillary, wallet-to-credit ratio, read); score block for the panel on the weighted criteria; bar of annual fees by bank; bullets "RFP question set" grouped by criterion (pricing schedule with unit prices and volume tiers, implementation timeline, API and reporting formats, entitlements and controls, escalation and named service team, FX execution and disclosure of spreads, credit appetite and ancillary expectations); email to the relationship managers setting out the review, the data requested and the timeline; nextSteps; caveats on unbenchmarked lines and on fees that vary with rate environments (earnings credit rate offsets).`,
  prompt: (i) => `Run the bank panel review for a ${str(i, "goal", "annual review").toLowerCase()} from the pasted fee schedule${str(i, "credit").trim() ? " and credit commitments" : ""}, score the banks on ${list(i, "criteria").join(", ")}, and draft the RFP question set.`,
};

const investorTargeting: ToolDef = {
  kind: "ai", id: "cf-investor-targeting", title: "Shareholder base & investor targeting", tagline: "Holders from 13F and 13D/G filings, style mix, peer-holder overlap, and a ranked targeting list.",
  description: "Builds the IR ownership picture from SEC filings: the largest institutional holders and how their positions moved, the 5% holders and activists from 13D and 13G filings, the style mix of the register, and the investors who hold your peers but not you. Ends with a ranked targeting list, the argument each target needs to hear, and the outreach note.",
  roles: ["corpfin"], specialties: [IR, SF, CD], category: "Research", icon: "Users", deliverable: "research", savesMinutes: 300, tags: ["13F", "ownership", "targeting"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "peers", label: "Peers to mine for holders", type: "tickers", placeholder: "NOW SNOW MDB NET" },
    { key: "styles", label: "Styles to target", type: "multiselect", options: ["Growth", "GARP", "Value", "Core / index", "Hedge fund", "Sovereign / pension", "Retail and platform"], default: ["Growth", "GARP", "Core / index", "Hedge fund"] },
    { key: "count", label: "Targets", type: "number", default: 12, min: 5, max: 25 },
    { key: "story", label: "Equity story", type: "textarea", placeholder: "The two or three things we want a new holder to underwrite" },
  ],
  example: { ticker: "DDOG", peers: ["NOW", "SNOW", "MDB", "NET"], styles: ["Growth", "GARP", "Core / index", "Hedge fund"], count: 12, story: "Consumption growth is reaccelerating as AI workloads land, gross margin holds above 80%, and free cash flow margin is converting above 30% while we stay disciplined on headcount." },
  effort: "high",
  instructions: `1. The 5% and activist layer first: get_recent_filings for the ticker with forms ["SC 13G","SC 13D","SC 13G/A","SC 13D/A"] limit 40, then read_document on each with queries "percent of class", "aggregate amount beneficially owned", "purpose of transaction" to get the holder, the position, the percent of class, the filing date, and whether the intent language is passive (13G) or activist (13D). A new 13D or an amendment changing intent is the single most important fact in this analysis; lead with it if present.
2. The institutional layer: run edgar_fulltext_search with the company name in quotes restricted to forms ["13F-HR"] for the last two quarters to find managers whose information tables name the issuer, then read_document on the information table with the company name as the query to read the shares and value held. Do the same for one prior quarter where the filing exists so positions can be compared. Note the limits plainly: 13F reports long US positions only, is filed 45 days after quarter end, omits shorts and non-US managers, and full-text search will not surface every filer, so the register you build is a sample and must be labeled as one.
3. The peer-overlap layer: repeat the 13F search for each peer and build the list of managers who hold at least two peers but not the subject. These are the warm targets. For each, record the peers held, the approximate position size, and therefore the position they could take in the subject at a comparable weight.
4. Classify and rank. Give each holder a style from its filings and its portfolio (concentrated growth, GARP, deep value, index and quantitative, hedge fund, sovereign or pension) and note turnover if two quarters are available. Compute with calc: the share of identified shares held by the top five and top ten holders, the split by style, the net change in identified positions quarter over quarter, and each target's potential position in dollars and as a percent of the subject's market cap (from get_company_financials). Rank the targets on fit with the equity story, the size they could take, the warmth of the peer overlap, and accessibility. Use get_insider_transactions to note any insider selling a prospective holder will ask about.
Tool budget: about 22 tool calls. Cap the 13F work at two quarters for the subject and one quarter per peer, at most three peers, and read at most six information tables in total. If the budget runs short, write the analysis from the holders you have identified and say in caveats how many filings were sampled.
Produce: kpis (identified institutional shares as a percent of shares outstanding, number of 5% holders, top-ten concentration, net position change, targets identified, potential demand in dollars); table "Largest holders" (holder, style, shares, value, percent of class, change versus prior quarter, filing and date); timeline of 13D and 13G events with tone; table "Targeting list" (manager, style, peers held, estimated position, potential position in the subject, the argument they need, warmth, next step) sorted by rank; bar of the register by style; email "Outreach note" to the top target built on the equity story with a specific meeting ask; caveats stating the 13F coverage limits, the 45-day lag, the absence of a paid surveillance feed, and that percentages are of identified shares rather than the full register.`,
  prompt: (i) => `Analyze ${str(i, "ticker").toUpperCase()}'s shareholder base from 13F and 13D/G filings, mine ${list(i, "peers").join(", ") || "close peers you choose"} for holders we do not have, and rank ${num(i, "count", 12)} targets across ${list(i, "styles").join(", ")}.${str(i, "story") ? ` Equity story: ${str(i, "story")}` : ""}`,
};

const irDisclosureBenchmark: ToolDef = {
  kind: "ai", id: "cf-ir-disclosure-benchmark", title: "IR disclosure benchmark", tagline: "What peers disclose that you do not: KPIs, segments, guidance metrics, non-GAAP, and the cost of adding each.",
  description: "Compares your disclosure package against a peer set filing by filing: which operating KPIs each company publishes, how segments are cut, which metrics are guided and on what cadence, which non-GAAP measures are used, and what the earnings release and 10-Q include. Produces the disclosure matrix, the gaps worth closing, and the argument for and against each addition.",
  roles: ["corpfin"], specialties: [IR, CTRL, FPA], category: "Research", icon: "Eye", deliverable: "table", savesMinutes: 240, tags: ["disclosure", "IR", "benchmark"],
  fields: [
    { key: "ticker", label: "Your company", type: "ticker", required: true, placeholder: "NOW" },
    { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "CRM WDAY ADBE INTU DDOG" },
    { key: "topics", label: "Topics", type: "multiselect", options: ["Operating KPIs", "Segment detail", "Guidance metrics and cadence", "Non-GAAP measures", "Remaining performance obligations / backlog", "Retention and churn", "Customer counts and cohorts", "Headcount and productivity", "Capital allocation and buybacks", "FX and constant currency"], default: ["Operating KPIs", "Guidance metrics and cadence", "Non-GAAP measures", "Remaining performance obligations / backlog", "Retention and churn"] },
    { key: "decision", label: "Decision to support", type: "select", options: ["Should we start disclosing something new?", "Should we stop disclosing something?", "Preparing for an investor day", "Annual disclosure committee review"], default: "Should we start disclosing something new?" },
  ],
  example: { ticker: "NOW", peers: ["CRM", "WDAY", "ADBE", "INTU", "DDOG"], topics: ["Operating KPIs", "Guidance metrics and cadence", "Non-GAAP measures", "Remaining performance obligations / backlog", "Retention and churn"], decision: "Should we start disclosing something new?" },
  effort: "high",
  instructions: `1. For the subject and every peer, search_filing on the latest 10-K and 10-Q for the phrases that locate each selected topic: "key metrics" or "key business metrics", "we define", "remaining performance obligations", "net revenue retention" or "dollar-based net retention", "customers with", "segment" and "reportable segment", "non-GAAP", "constant currency", "share repurchase". Use read_filing to expand the hits that matter (at least one expansion per company) so you quote the actual definition rather than the label. Then get_recent_filings forms ["8-K"] limit 8 for each company and read_document on the latest Item 2.02 release with queries "outlook" and "metrics" to capture what is guided, on what cadence, and which metrics appear only in the release and never in the 10-Q.
2. Build the matrix: one row per disclosure item, one column per company, each cell marked disclosed, partial (mentioned without a definition or only annually), or not disclosed, with the definition quoted in a note where it differs materially between companies. Definitional differences matter more than presence: a retention number measured on a different cohort or a backlog measured over a different horizon is not the same disclosure, and the analysis is wrong if it treats them as the same.
3. Score the gaps. For each item the peers disclose and the subject does not, compute the peer coverage (how many of the peer set disclose it) and assess: what an analyst does with it, whether the subject's own trend in that metric is favorable (check with get_xbrl_series for the related concept, for example RevenueRemainingPerformanceObligation or ContractWithCustomerLiabilityCurrent, and with get_company_financials), the commitment it creates (once given, withdrawing a metric is read as bad news), the preparation and controls burden, and whether the metric would need to survive a bad quarter. Do the reverse pass too: items the subject discloses that no peer does, which can be withdrawn most cheaply at a fiscal-year boundary.
4. Frame the recommendation for the stated decision with the governance path: disclosure committee review, audit committee approval for a new non-GAAP measure or KPI, Item 10(e) and Regulation G requirements for non-GAAP measures, the Commission's guidance that a key metric needs a clear definition, a statement of how management uses it and consistent period-to-period presentation, and the need to give at least the prior-year comparative when a metric is introduced.
Tool budget: about 24 tool calls. Use one multi-term search_filing per company per form (for example "key metrics remaining performance obligations net retention non-GAAP") instead of one call per topic, cap the peer set at four names, and expand with read_filing only for the two definitions that matter most. If the budget runs short, drop the least relevant peer and say so.
Produce: kpis (items compared, gaps where a majority of peers disclose and the subject does not, subject-only disclosures, recommended additions); table "Disclosure matrix" (item, subject, then one column per peer, peer coverage, definitional note) with the subject column emphasized; table "Gap assessment" (item, peer coverage, analyst use, our trend, commitment created, preparation burden, recommendation); bullets "Definitions that differ" with citations; checklist "If we add it" (definition drafting, historical restatement of comparatives, controls and evidence, disclosure committee, audit committee, first-quarter presentation, and the plan for the quarter the metric turns down); risks; caveats on fiscal year differences and on filings read rather than transcripts.`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()}'s disclosure against ${list(i, "peers").join(", ")} on ${list(i, "topics").join(", ")}, to answer: ${str(i, "decision", "should we disclose something new?")}`,
};

const boardDeckNarrative: ToolDef = {
  kind: "ai", id: "cf-board-deck-narrative", title: "Board deck narrative", tagline: "Action titles, the storyline, and speaker notes for the CFO section, built from your metrics table.",
  description: "Turns the quarter's numbers into the finance section of the board deck: a storyline with action titles rather than topic labels, the supporting exhibit for each slide, speaker notes, the risks and opportunities slide, and the explicit asks. Adds market and peer context from SEC data when a ticker is given, so relative performance is in the deck before a director asks for it.",
  roles: ["corpfin", "consultant"], specialties: [FPA, SF, IR, ...CONS], category: "Deliverables", icon: "Presentation", deliverable: "deck", savesMinutes: 270, tags: ["board", "deck", "CFO"],
  fields: [
    { key: "csv", label: "Metrics", type: "csv", required: true, columns: "metric, actual, plan, prior_year, fy_forecast, fy_plan; amounts in $k or as labeled in the metric name", placeholder: "metric,actual,plan,prior_year,fy_forecast,fy_plan" },
    { key: "meeting", label: "Meeting", type: "select", options: ["Quarterly board meeting", "Audit committee", "Strategy session", "Monthly investor update"], default: "Quarterly board meeting" },
    { key: "asks", label: "Decisions we need", type: "textarea", placeholder: "Approve the hiring plan, approve the $50mm buyback authorization, sign off on the guidance range" },
    { key: "ticker", label: "Ticker (optional)", type: "ticker", placeholder: "CAT" },
    { key: "peers", label: "Peers for context", type: "tickers", placeholder: "DE CMI HON ETN" },
    { key: "slides", label: "Slides", type: "number", default: 8, min: 5, max: 14 },
  ],
  example: { meeting: "Quarterly board meeting", slides: 8, ticker: "CAT", peers: ["DE", "CMI", "HON", "ETN"], asks: "Approve the FY27 capex envelope of $2.1bn, approve an incremental $500mm to the buyback authorization, and confirm the dividend increase ahead of the June declaration.", csv: "metric,actual,plan,prior_year,fy_forecast,fy_plan\nRevenue ($mm),16800,16400,16100,66200,65000\nGross margin (%),33.1,32.4,31.8,32.8,32.2\nOperating margin (%),20.4,19.6,19.1,20.1,19.4\nAdjusted EPS ($),5.42,5.05,4.86,21.30,20.40\nFree cash flow ($mm),2100,1850,1720,8400,7900\nBacklog ($mm),31200,30000,28400,,\nNet leverage (x),1.1,1.3,1.4,1.0,1.2\nHeadcount,112400,113000,110900,,\nCapex ($mm),480,520,430,2050,2200" },
  effort: "medium",
  instructions: `1. Compute before writing: for every metric, actual versus plan and versus prior year in absolute terms and percent (basis points for margins), the full-year forecast versus the full-year plan, and the implied remaining-period performance. With calc check that the derived metrics tie (margin times revenue equals profit, EPS against the share count if given) and flag any metric that does not.
2. Find the story. Rank the variances by size and by consequence, and pick the one sentence the board should remember: the company is ahead or behind, driven by a named factor, with a named implication for the full year and for the decisions on the table. Everything else in the deck supports or qualifies that sentence. If the quarter beat but the full-year forecast did not move, say why in the first slide; directors notice that gap immediately.
3. Add external context when a ticker is given: get_company_financials for the subject and get_trading_comps with the peers for growth, margins and FCF conversion, and put the subject's relative position on the context slide. Where the subject's own reported figures are public, reconcile the pasted internal numbers to them and note the basis difference (segment, non-GAAP, constant currency) rather than presenting two different numbers for the same thing.
4. Write the deck as action titles: every slide title is a full sentence with the conclusion and a number in it ("Revenue beat plan by $400mm on aftermarket volume; we are holding the full-year range"), never a topic ("Revenue"). For each slide give the exhibit to show (which chart or table and what it plots), three to five speaker-note bullets, and the objection a director is likely to raise with the answer. Keep the requested slide count, and reserve the last two for risks and opportunities and for the asks. Write the asks as decisions with a recommendation, the alternatives considered, and the consequence of deferring.
Produce: kpis (the five or six numbers the board tracks, each with the delta versus plan and tone); steps "Slide flow" where each item's title is the action title and the detail is the exhibit plus speaker notes; table "Performance versus plan" (metric, actual, plan, variance, versus prior year, full-year forecast, versus full-year plan) with emphasisRow on the headline metric; waterfall or bar for the largest driver of the variance; table "Peer context" when a ticker was given; risks "Risks and opportunities" with severity and mitigation, each with a dollar amount where possible; checklist "Asks and decisions" with the recommendation, the owner and the date; caveats on internal versus reported bases and on any metric that did not tie.`,
  prompt: (i) => `Build the ${num(i, "slides", 8)}-slide finance section for the ${str(i, "meeting", "quarterly board meeting").toLowerCase()} from the pasted metrics${str(i, "ticker") ? `, with peer context for ${str(i, "ticker").toUpperCase()} versus ${list(i, "peers").join(", ") || "its peers"}` : ""}.${str(i, "asks") ? ` Decisions needed: ${str(i, "asks")}` : ""}`,
};

const integration100Day: ToolDef = {
  kind: "ai", id: "cf-integration-100-day", title: "100-day integration plan", tagline: "Day 1 readiness through Day 100 by workstream, with the synergy tracker fields and the first steerco report.",
  description: "Builds the post-merger integration plan a corporate development team can actually run: the integration management office and decision rights, Day 1 readiness by workstream, milestones at Day 30, 60, 90 and 100, the synergy tracker with owners and leading indicators, retention of critical roles, and the first steering committee status report. Pulls the publicly stated deal rationale and synergy targets when the deal is disclosed.",
  roles: ["corpfin", "consultant"], specialties: [CD, SF, FPA, ...CONS], category: "Deliverables", icon: "ListChecks", deliverable: "checklist", savesMinutes: 360, tags: ["integration", "PMI", "100-day"],
  fields: [
    { key: "target", label: "Target", type: "text", required: true, placeholder: "Ticker or name" },
    { key: "acquirer", label: "Acquirer", type: "ticker", placeholder: "CAT" },
    { key: "close", label: "Expected close", type: "date", default: "2026-12-31" },
    { key: "size", label: "Target revenue", type: "number", unit: "$mm", default: 400 },
    { key: "synergy", label: "Synergy target (run-rate)", type: "number", unit: "$mm", default: 45 },
    { key: "workstreams", label: "Workstreams", type: "multiselect", options: ["Finance and accounting", "Commercial and go-to-market", "Product and technology", "People and organization", "Operations and supply chain", "Legal, compliance and contracts", "IT systems and data", "Customer communications", "Facilities and real estate"], default: ["Finance and accounting", "Commercial and go-to-market", "Product and technology", "People and organization", "IT systems and data", "Customer communications"] },
    { key: "model", label: "Integration model", type: "select", options: ["Full absorption", "Preserve and connect", "Best of both", "Hold separate initially"], default: "Full absorption" },
  ],
  example: { target: "a $400mm-revenue electrification components maker", acquirer: "CAT", close: "2026-12-31", size: 400, synergy: 45, model: "Full absorption", workstreams: ["Finance and accounting", "Commercial and go-to-market", "Product and technology", "People and organization", "IT systems and data", "Customer communications"] },
  effort: "high",
  instructions: `1. Ground the plan in the deal. If the target is a ticker or the deal is announced, get_recent_filings forms ["8-K","S-4","DEFM14A"] and read_document with queries "merger consideration", "synergies", "expected to close", "transition services", "retention", "regulatory approval" to capture the stated rationale, the public synergy number and its phasing, the closing conditions and any transition services arrangement. If the target is private, use get_company_financials on the acquirer for scale context and say the target's figures are as supplied. Everything public must be cited; everything assumed must be labeled.
2. Stand up the governance: the integration management office (who runs it, the cadence, the escalation path, the decision rights split between the IMO and the workstreams), the steering committee membership and meeting rhythm, the single source of truth for status, and the rule for what reaches the CFO. Size the IMO against the deal: a target at this revenue scale does not need a twenty-person office, and saying so is part of the plan.
3. Build the plan by workstream and by milestone. Day 1 readiness is the subset that must be true at close: payroll continuity, banking and payment authority, the first consolidated close calendar, chart-of-accounts mapping, customer and supplier notification, employee communications and offer letters, IT access and security baseline, contract assignment and change-of-control consents, insurance and licenses. Then Day 30, 60, 90 and 100 milestones per workstream, each with an owner role, a deliverable and the dependency that could block it. Apply the integration model: full absorption sets an early systems cutover and a single go-to-market motion; preserve and connect keeps the target's systems and integrates only the interfaces; hold separate defers everything except reporting and controls, and the milestone set must reflect that choice rather than repeating a generic list.
4. Wire the synergies to the plan: decompose the run-rate target into initiatives (duplicate public-company and corporate costs, procurement, facilities, headcount overlap, systems consolidation, cross-sell and pricing), each with a gross run-rate amount, a cost to achieve, the month it starts contributing, the leading indicator that shows it is working before the savings appear, and an owner. The initiative amounts must sum to the synergy target: show the check. Note the one-time costs and the retention pool, and flag critical-role attrition as the risk that destroys the case.
Produce: kpis (days to close, workstreams, Day 1 critical items, synergy target, cost to achieve, net year-one impact); steps "Governance and cadence"; checklist "Day 1 readiness" with owner and due date; timeline of Day 30, 60, 90 and 100 milestones with tone; table "Synergy tracker" (initiative, workstream, owner, gross run-rate, cost to achieve, net, start month, leading indicator, RAG) with totals and the check against the target; risks with severity and mitigation (critical-role attrition, customer churn at the first renewal, systems cutover, culture, regulatory conditions, TSA expiry); markdown "First steering committee report" written as if it were Day 14; caveats on what is assumed versus disclosed.`,
  prompt: (i) => `Build the 100-day integration plan for ${str(i, "acquirer") ? `${str(i, "acquirer").toUpperCase()}'s acquisition of ` : ""}${str(i, "target")} (target revenue $${num(i, "size")}mm, run-rate synergy target $${num(i, "synergy")}mm, expected close ${str(i, "close")}, ${str(i, "model", "full absorption").toLowerCase()}). Workstreams: ${list(i, "workstreams").join(", ")}.`,
};

const targetOnePager: ToolDef = {
  kind: "ai", id: "cf-target-one-pager", title: "Corp dev target one-pager", tagline: "The page you take to the deal review committee: fit, financials, price to acquire, and the first diligence questions.",
  description: "Produces the internal one-page target profile: what the company does and for whom, the financial profile against its peers, the ownership and governance facts that decide whether it is acquirable, the price to acquire at your premium with the implied multiples against precedent deals, the integration complexity, and the three questions that would kill the deal.",
  roles: ["corpfin", "consultant"], specialties: [CD, SF, ...CONS], category: "Deliverables", icon: "FileText", deliverable: "memo", savesMinutes: 180, tags: ["corp dev", "target", "one-pager"],
  fields: [
    { key: "ticker", label: "Target", type: "ticker", required: true, placeholder: "DDOG" },
    { key: "thesis", label: "Why we would buy it", type: "textarea", required: true, placeholder: "The capability, the customer overlap, the build-versus-buy argument" },
    { key: "premium", label: "Premium assumption", type: "number", unit: "%", default: 30 },
    { key: "audience", label: "Audience", type: "select", options: ["Deal review committee", "CEO", "Board", "CFO screening"], default: "Deal review committee" },
    { key: "acquirer", label: "Us (optional)", type: "ticker", placeholder: "NOW" },
  ],
  example: { ticker: "DDOG", thesis: "Buys the observability data plane we would otherwise take three years to build, and puts a second product in front of the same IT operations buyer we already sell workflow to.", premium: 30, audience: "Deal review committee", acquirer: "NOW" },
  effort: "medium",
  instructions: `1. get_company_financials for the target and, if given, the acquirer. search_filing on the target's latest 10-K for "our business" or "overview", "customers", "concentration", "competition", "employees" and "properties", and on the latest 10-Q for "outlook". Use read_filing to expand at least two hits so the business description is in the company's own words rather than a paraphrase.
2. Acquirability facts, which are the reason most one-pagers get sent back: get_recent_filings forms ["DEF 14A","SC 13D","SC 13G","8-K"] and read_document to establish the share class structure (dual class, founder control, super-voting shares), the largest holders and any activist, staggered board or anti-takeover provisions, change-of-control payments in the compensation discussion, and recent 8-K items that change the picture (5.02 officer departures, 1.01 material agreements). get_insider_transactions for recent insider selling. State plainly whether a deal needs the founder's agreement.
3. Price it: current price and market cap, 52-week range where available, offer at the stated premium, implied equity value and enterprise value using the target's debt and cash, and implied EV/Revenue and EV/EBITDA. Run get_trading_comps with three or four close peers to place those multiples, and run edgar_fulltext_search on forms ["8-K","DEFM14A"] with "agreement and plan of merger" plus the sector keywords for two or three recent precedents to place the premium. Compute everything with calc and label each multiple as computed rather than disclosed.
4. Judge fit and complexity: where the thesis is supported by the target's own disclosures and where it is not, the customer and product overlap, the revenue synergy motion in one sentence, the cost overlap in one sentence, and the integration complexity (headcount, geographies, deployment model, unrelated business lines, open-source or partner dependencies). Then the three questions that would kill the deal, each phrased so a diligence workstream can answer it.
Produce: kpis (market cap, EV, LTM revenue and growth, gross margin, FCF margin, offer per share at the premium, implied EV/Revenue); markdown "Business" (four to six sentences with citations); table "Financial profile" (metric, target, then the peer median, with a column for the comparison); table "Price to acquire" (current price, premium, offer per share, equity value, net debt, EV, implied EV/Revenue, implied EV/EBITDA, precedent range); bullets "Strategic fit" and "Integration complexity"; bullets "Ownership and governance" with the acquirability read; risks (three deal-killers with severity); nextSteps (what to diligence first, who to call, whether this goes forward); caveats on computed versus disclosed figures and on anything the filings did not settle.`,
  prompt: (i) => `Write the target one-pager on ${str(i, "ticker").toUpperCase()} for the ${str(i, "audience", "deal review committee").toLowerCase()}${str(i, "acquirer") ? `, from ${str(i, "acquirer").toUpperCase()}'s perspective` : ""}, at a ${num(i, "premium", 30)}% premium. Thesis: ${str(i, "thesis")}`,
};

const synergyTracker: ToolDef = {
  kind: "ai", id: "cf-synergy-tracker", title: "Post-merger synergy tracker", tagline: "Realization against the deal model by initiative, with phasing curves, slippage, and the steerco report.",
  description: "Turns the synergy initiative list into the monthly tracker the CFO and the steering committee read: realized run-rate against the phasing curve, net impact after cost to achieve, the gap to the deal model, which initiatives have slipped and by how much, and the leading indicators that say whether the rest will land. Ends with the status report and the escalations.",
  roles: ["corpfin"], specialties: [CD, FPA, SF], category: "Reporting", icon: "Gauge", deliverable: "table", savesMinutes: 210, tags: ["synergies", "PMI", "tracker"],
  fields: [
    { key: "csv", label: "Initiative tracker", type: "csv", required: true, columns: "initiative, workstream, owner, gross_run_rate ($k), cost_to_achieve ($k), realized_run_rate ($k), realized_ytd ($k), start_month (1-24), status, leading_kpi", placeholder: "initiative,workstream,owner,gross_run_rate,cost_to_achieve,realized_run_rate,realized_ytd,start_month,status,leading_kpi" },
    { key: "dealTarget", label: "Deal model run-rate target", type: "number", unit: "$k", default: 45000 },
    { key: "monthsSinceClose", label: "Months since close", type: "number", default: 9, min: 1, max: 36 },
    { key: "phasing", label: "Deal model phasing", type: "select", options: ["25/60/100 over three years", "50/85/100 over three years", "33/66/100 over three years"], default: "25/60/100 over three years" },
    { key: "notes", label: "Context", type: "textarea", placeholder: "What changed this month: attrition, customer losses, systems slippage, new initiatives found" },
  ],
  example: { dealTarget: 45000, monthsSinceClose: 9, phasing: "25/60/100 over three years", notes: "Two senior engineers in the platform team resigned in month 8; the ERP cutover slipped from month 9 to month 12, which defers the finance headcount savings; procurement found $3.1mm of additional logistics savings not in the deal model.", csv: "initiative,workstream,owner,gross_run_rate,cost_to_achieve,realized_run_rate,realized_ytd,start_month,status,leading_kpi\nDuplicate public company costs,Finance,Controller,4200,300,4200,3150,1,Complete,Audit and listing fees run-rate\nFinance headcount overlap,Finance,VP Finance,6800,2400,2100,1400,6,At risk,Positions closed vs plan\nProcurement: direct materials,Operations,CPO,11500,900,7300,4900,3,On track,Repriced spend under contract\nProcurement: logistics,Operations,CPO,3100,200,1200,600,7,On track,Lanes retendered\nFacilities consolidation,Facilities,Head of RE,5400,3100,1800,900,9,Delayed,Sites exited\nIT systems consolidation,IT,CIO,7200,4800,900,300,9,Delayed,Applications decommissioned\nSales overlay reduction,Commercial,CRO,4500,1200,3400,2100,4,On track,Quota-carrying heads\nCross-sell to installed base,Commercial,CRO,6200,600,1100,500,6,At risk,Pipeline from cross-sell motion" },
  effort: "medium",
  instructions: `1. Compute with calc, never in prose: total gross run-rate in the tracker versus the deal model target and the gap; total realized run-rate and realization percent; realized year to date; total cost to achieve, spent and remaining; net run-rate impact (gross less the annualized portion of recurring cost to achieve, with one-time costs shown separately and not netted against run-rate); and the ratio of cost to achieve to gross run-rate by initiative, which flags the initiatives that are not worth finishing.
2. Compare against the phasing curve rather than against the full target: from the selected phasing and the months since close, compute the expected cumulative run-rate at this point (interpolate within the year) and the expected realization percent, then measure each initiative and the portfolio against that expectation. An initiative at 40% realization in month 9 is ahead of a 25/60/100 curve, and saying so is the difference between a useful tracker and a red dashboard.
3. Assign RAG by rule and state the rule: green where realized run-rate is at or above the phasing expectation and the leading indicator is moving; amber where realization is between 60% and 100% of expectation, or where the start month has passed with no realization; red where realization is below 60% of expectation, the cost to achieve has grown beyond the gross run-rate, or the owner has no leading indicator. Override the rule only with a reason from the notes, and label the override.
4. Diagnose and act: for every amber and red initiative give the driver (from the status, the leading indicator and the notes), the dollar amount at risk, the recovery action with a date and an owner, and what must be true for it to go green. Reconcile the portfolio to the deal model: realized plus credible remaining versus the target, and the shortfall the CFO has to either backfill with new initiatives or reset with the board. Credit newly found initiatives separately from the deal model so the original case remains auditable.
Produce: kpis (deal model target, tracked gross, realized run-rate, realization percent versus the phasing expectation, cost to achieve spent and remaining, net impact, gap to model with tone); table "Initiative tracker" (initiative, workstream, owner, gross, realized, realization %, expected at this month, variance, cost to achieve, net, RAG, leading indicator) with totals, sorted worst variance first; waterfall from the deal model target through realized, in flight, at risk and newly found to the current expected run-rate (verify the steps sum); bar of realized versus gross by workstream; markdown "Steering committee report" (status in one paragraph, what moved this month, the three escalations, the decisions needed); checklist "Recovery actions" with owner and date; risks; caveats on the phasing interpolation, on run-rate versus in-year effects, and on any initiative whose leading indicator is missing.`,
  prompt: (i) => `Update the synergy tracker at month ${num(i, "monthsSinceClose", 9)} after close against a $${num(i, "dealTarget")}k run-rate deal model phased ${str(i, "phasing", "25/60/100 over three years")}, and draft the steering committee report.${str(i, "notes") ? ` This month: ${str(i, "notes")}` : ""}`,
};

const kpiNonGaap: ToolDef = {
  kind: "ai", id: "cf-kpi-definitions-nongaap", title: "KPI definitions & non-GAAP reconciliations", tagline: "Write the definitions, build the reconciliation tables, and test them against Reg G and Item 10(e).",
  description: "Drafts the disclosure-ready definition of every non-GAAP measure and operating KPI the company uses, builds the reconciliation from the most directly comparable GAAP measure, benchmarks each definition against peers, and tests the package against Regulation G, Item 10(e) and the staff's non-GAAP guidance. Produces the definitions page, the reconciliation tables and the review checklist.",
  roles: ["corpfin", "accountant"], specialties: [IR, CTRL, FPA, ...ACCT], category: "Accounting & audit", icon: "ScrollText", deliverable: "memo", savesMinutes: 240, tags: ["non-GAAP", "Reg G", "KPI"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "NOW" },
    { key: "measures", label: "Measures", type: "multiselect", options: ["Non-GAAP operating income and margin", "Adjusted EBITDA", "Non-GAAP EPS", "Free cash flow", "Constant currency growth", "ARR or subscription revenue", "Net revenue retention", "Remaining performance obligations / backlog", "Billings", "Adjusted gross margin", "Organic growth"], default: ["Non-GAAP operating income and margin", "Free cash flow", "Constant currency growth", "Remaining performance obligations / backlog"] },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "CRM WDAY ADBE INTU" },
    { key: "csv", label: "Current period figures (optional)", type: "csv", columns: "line, amount ($mm), gaap_or_adjustment, note" },
  ],
  example: { ticker: "NOW", measures: ["Non-GAAP operating income and margin", "Free cash flow", "Constant currency growth", "Remaining performance obligations / backlog"], peers: ["CRM", "WDAY", "ADBE", "INTU"], csv: "line,amount,gaap_or_adjustment,note\nGAAP operating income,540,gaap,\nStock-based compensation,610,adjustment,\nAmortization of purchased intangibles,26,adjustment,\nBusiness combination and other,18,adjustment,Transaction and integration costs\nNon-GAAP operating income,1194,non-gaap,\nNet cash provided by operating activities,780,gaap,\nPurchases of property and equipment,-140,adjustment,\nFree cash flow,640,non-gaap," },
  effort: "medium",
  instructions: `1. Read what the company already says: search_filing on the latest 10-K and 10-Q for "non-GAAP", "we define", "reconciliation", "constant currency", "remaining performance obligations", "free cash flow", and get_recent_filings forms ["8-K"] limit 8 then read_document on the latest Item 2.02 release with the query "non-GAAP" to capture the exact published definitions and the reconciliation layout. Quote them; a rewritten definition that changes meaning is itself a disclosure problem. Note any definition that differs between the release and the 10-Q.
2. Benchmark each measure against the peers with search_filing on their 10-Qs for the same phrases: which adjustments they include, whether they adjust for stock-based compensation, whether free cash flow is net of capitalized software and finance leases, whether constant currency is computed at prior-period rates or hedged rates, and what horizon backlog covers. Build a comparison so the reader can see whether the company's measure is tighter or looser than the peer convention, since an outlier definition is the one analysts restate.
3. Draft, for each selected measure: the definition in disclosure language, the most directly comparable GAAP measure, why management uses it and how (the usefulness statement the rules require), the reconciling items with the sign convention, and the presentation rules that apply. Build the reconciliation table from the pasted figures where given and check the arithmetic with calc, confirming each non-GAAP total equals its GAAP starting point plus the adjustments; where no figures were pasted, populate from get_xbrl_series with the relevant concepts (OperatingIncomeLoss, NetCashProvidedByUsedInOperatingActivities, PaymentsToAcquirePropertyPlantAndEquipment, ShareBasedCompensation, RevenueRemainingPerformanceObligation) and label the period.
4. Test the package and report each failure as an item to fix: the most directly comparable GAAP measure must be presented with equal or greater prominence and cannot be relegated to a later page; a full reconciliation is required for each measure; liquidity measures such as free cash flow must not be presented on a per-share basis; individually tailored revenue recognition is not permitted; adjustments for normal, recurring cash operating expenses are problematic; non-GAAP measures must be labeled and cannot use a title confusingly similar to a GAAP measure; forward-looking non-GAAP guidance needs a quantitative reconciliation or the unreasonable-effort statement; operating KPIs need a clear definition, a statement of how management uses them, consistent presentation period to period, and an explanation of any change in the way they are calculated.
Produce: table "Definitions" (measure, comparable GAAP measure, definition as drafted, why management uses it, peer convention, outlier flag); table "Reconciliations" (GAAP line, each adjustment, non-GAAP line, current period, with the arithmetic check shown) with totals; table "Peer comparison" (measure, us, then one column per peer, difference that matters); checklist "Reg G and Item 10(e) review" with one item per requirement marked pass or fix and the specific fix; bullets "Definition changes to disclose" (any change from the prior period and the comparative restatement it requires); caveats on figures taken from the paste rather than from filings and on measures the filings did not define.`,
  prompt: (i) => `Draft the definitions and reconciliations for ${str(i, "ticker").toUpperCase()}'s ${list(i, "measures").join(", ")}, benchmark them against ${list(i, "peers").join(", ") || "close peers you choose"}, and run the Reg G and Item 10(e) review.`,
};

/* ======================================================================================
 * Calculators
 * ====================================================================================== */

/** Price / volume / mix decomposition. Effects sum exactly to the revenue variance. */
const pvmBridge: ToolDef = {
  kind: "calc", id: "cf-pvm-bridge", title: "Price / volume / mix bridge", tagline: "Decomposes a revenue variance into price, volume, mix, new and discontinued, reconciled to the total.",
  description: "Implements the standard PVM decomposition on a pasted sales cube: volume effect at base average price, mix effect from the shift between items, price effect at actual volumes, and separate buckets for items that appeared or disappeared. The five effects sum to the total variance by construction and the residual is reported so the reconciliation is visible.",
  roles: ["corpfin", "consultant"], specialties: [FPA, SF, CD, ...CONS], category: "Reporting", icon: "Split", savesMinutes: 90, tags: ["PVM", "bridge", "variance"],
  fields: [
    { key: "csv", label: "Sales cube", type: "csv", required: true, columns: "item, base_volume, base_price, actual_volume, actual_price (base_revenue / actual_revenue may replace price or volume)", placeholder: "item,base_volume,base_price,actual_volume,actual_price" },
    { key: "unit", label: "Amounts in", type: "select", options: ["$mm", "$k", "$"], default: "$mm" },
    { key: "top", label: "Items to chart", type: "number", default: 10, min: 3, max: 25 },
  ],
  example: { unit: "$mm", top: 10, csv: "item,base_volume,base_price,actual_volume,actual_price\nFootwear North America,42.0,68.0,40.5,71.0\nApparel North America,30.0,41.0,31.5,40.2\nFootwear EMEA,25.0,62.0,27.0,60.5\nApparel EMEA,14.0,38.0,13.0,39.0\nFootwear Greater China,18.0,58.0,15.5,55.0\nEquipment,6.0,27.0,0,0\nDigital-only line,0,0,4.0,52.0" },
  compute: (i: Inputs): WorkflowOutput => {
    const u = str(i, "unit", "$mm");
    const parsed = records(str(i, "csv")).map((r) => {
      const item = cell(r, "item", "product", "sku", "name", "segment", "category", "customer") || "(unnamed)";
      let bv = cnum(r, "base_volume", "budget_volume", "prior_volume", "volume_base", "base_units");
      let av = cnum(r, "actual_volume", "volume_actual", "current_volume", "actual_units");
      let bp = cnum(r, "base_price", "budget_price", "prior_price", "price_base", "base_asp");
      let ap = cnum(r, "actual_price", "price_actual", "current_price", "actual_asp");
      const br = cnum(r, "base_revenue", "budget_revenue", "prior_revenue", "revenue_base");
      const ar = cnum(r, "actual_revenue", "revenue_actual", "current_revenue");
      if (!bp && bv && br) bp = br / bv;
      if (!ap && av && ar) ap = ar / av;
      if (!bv && bp && br) bv = br / bp;
      if (!av && ap && ar) av = ar / ap;
      return { item, bv, av, bp, ap, br: bv * bp, ar: av * ap };
    }).filter((p) => p.bv > 0 || p.av > 0);
    if (!parsed.length) throw new Error("No usable rows. Each row needs a base and actual volume with a price, or a volume with a revenue.");
    if (parsed.some((p) => (p.bv > 0 && !p.bp) || (p.av > 0 && !p.ap))) throw new Error("Price could not be derived for at least one row: give base_price/actual_price, or a revenue column alongside the volume.");
    const cont = parsed.filter((p) => p.bv > 0 && p.av > 0);
    const newRows = parsed.filter((p) => p.bv <= 0 && p.av > 0);
    const discRows = parsed.filter((p) => p.av <= 0 && p.bv > 0);
    if (!cont.length) throw new Error("No continuing items (rows with both a base and an actual volume), so price, volume and mix cannot be separated.");
    const v0 = sum(cont.map((p) => p.bv)), v1 = sum(cont.map((p) => p.av));
    const r0c = sum(cont.map((p) => p.br)), r1c = sum(cont.map((p) => p.ar));
    const p0 = r0c / v0;
    const volume = (v1 - v0) * p0;
    const mix = sum(cont.map((p) => p.av * p.bp)) - v1 * p0;
    const price = sum(cont.map((p) => (p.ap - p.bp) * p.av));
    const newEff = sum(newRows.map((p) => p.ar)), discEff = -sum(discRows.map((p) => p.br));
    const base = r0c + sum(discRows.map((p) => p.br)), actual = r1c + newEff;
    const total = actual - base, resid = total - (volume + mix + price + newEff + discEff);
    const byItem = parsed.map((p) => ({ ...p, variance: p.ar - p.br, priceEff: p.bv > 0 && p.av > 0 ? (p.ap - p.bp) * p.av : 0, volMix: p.bv > 0 && p.av > 0 ? (p.av - p.bv) * p.bp : p.ar - p.br, bucket: p.bv <= 0 ? "New" : p.av <= 0 ? "Discontinued" : "Continuing" })).sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance));
    const money = (v: number) => fmt.num(v, 1);
    return {
      title: "Price / volume / mix bridge",
      summary: `Revenue moved ${money(total)} ${u} (${fmt.pct(base ? total / base : 0)}) from ${money(base)} to ${money(actual)}. Price contributed ${money(price)}, volume ${money(volume)}, mix ${money(mix)}, new items ${money(newEff)} and discontinued items ${money(discEff)}. The five effects reconcile to the total with a residual of ${money(resid)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: `Base revenue (${u})`, value: money(base) }, { label: `Actual revenue (${u})`, value: money(actual) },
          { label: "Total variance", value: `${money(total)} (${fmt.pct(base ? total / base : 0)})`, tone: tone(total) },
          { label: "Price", value: money(price), tone: tone(price), hint: `Realization ${fmt.pct(base ? price / base : 0)} of base revenue` },
          { label: "Volume", value: money(volume), tone: tone(volume) }, { label: "Mix", value: money(mix), tone: tone(mix), hint: "Positive means a shift toward higher-priced items" },
          { label: "New", value: money(newEff), tone: tone(newEff) }, { label: "Discontinued", value: money(discEff), tone: tone(discEff) },
        ] },
        { type: "waterfall", title: `Revenue bridge (${u})`, format: "num", steps: [{ label: "Base", value: base, total: true }, { label: "Volume", value: volume }, { label: "Mix", value: mix }, { label: "Price", value: price }, { label: "New", value: newEff }, { label: "Discontinued", value: discEff }, { label: "Actual", value: actual, total: true }] },
        { type: "table", title: `By item (${u})`, columns: ["Item", "Bucket", "Base volume", "Base price", "Actual volume", "Actual price", "Base revenue", "Actual revenue", "Variance", "Price effect", "Volume + mix"],
          rows: byItem.map((p) => [p.item, p.bucket, fmt.num(p.bv, 1), fmt.num(p.bp, 2), fmt.num(p.av, 1), fmt.num(p.ap, 2), money(p.br), money(p.ar), money(p.variance), money(p.priceEff), money(p.volMix)]),
          totals: ["Total", "", fmt.num(sum(parsed.map((p) => p.bv)), 1), "", fmt.num(sum(parsed.map((p) => p.av)), 1), "", money(base), money(actual), money(total), money(price), money(volume + mix + newEff + discEff)],
          note: "Item price effect = (actual price − base price) × actual volume; item volume + mix = (actual volume − base volume) × base price. Item volume+mix sums to aggregate volume plus mix for continuing items." },
        { type: "bar", title: `Largest item variances (${u})`, format: "num", data: byItem.slice(0, Math.round(num(i, "top", 10))).map((p, k) => ({ label: p.item, value: p.variance, emphasis: k === 0, note: p.bucket === "Continuing" ? undefined : p.bucket })) },
      ],
      caveats: [
        `Effects are computed at the hierarchy level pasted: volume = (ΣQ1 − ΣQ0) × base average price, mix = Σ(Q1 × P0) − ΣQ1 × base average price, price = Σ((P1 − P0) × Q1). Mix is level-dependent, so a SKU-level cube and a region-level cube give different price/mix splits from the same data.`,
        `Reconciliation residual ${money(resid)} ${u}${Math.abs(resid) < Math.max(1e-6, Math.abs(total) * 1e-9) ? " (exact)" : " (rounding in the pasted data)"}.`,
        "New and discontinued items are bucketed before the decomposition so a launch or an exit is not read as volume or mix. FX is not separated unless the cube is already in constant currency.",
      ],
      nextSteps: ["Run the same decomposition on cost of revenue to build the gross margin bridge", "Re-run one level deeper for the two largest variances to see whether mix or price drives them", "Feed the price effect into the reforecast as realization rather than volume"],
    };
  },
};

/** Lender-defined leverage, coverage, FCCR and liquidity with headroom and a stress grid. */
const covenantHeadroom: ToolDef = {
  kind: "calc", id: "cf-covenant-headroom", title: "Covenant headroom calculator", tagline: "Net leverage, interest coverage, FCCR and liquidity against the limits, with cushion and a stress grid.",
  description: "Computes the maintenance covenant package from lender-defined EBITDA: net leverage with the cash netting cap applied, interest and fixed-charge coverage, and minimum liquidity, each against its limit with the cushion expressed in EBITDA, in debt capacity and as a utilization percentage. Includes the two-way stress grid of EBITDA decline against incremental debt.",
  roles: ["corpfin", "accountant"], specialties: [TR, FPA, CTRL, ...ACCT], category: "Credit & restructuring", icon: "Shield", savesMinutes: 120, tags: ["covenant", "leverage", "headroom"],
  fields: [
    { key: "ebitda", label: "EBITDA (GAAP)", type: "number", unit: "$mm", required: true, default: 1480 },
    { key: "addbacks", label: "Permitted add-backs (after caps)", type: "number", unit: "$mm", default: 380 },
    { key: "debt", label: "Total debt incl. finance leases", type: "number", unit: "$mm", required: true, default: 5280 },
    { key: "cash", label: "Unrestricted cash", type: "number", unit: "$mm", default: 900 },
    { key: "nettingCap", label: "Cash netting cap", type: "number", unit: "$mm", default: 500 },
    { key: "interest", label: "Cash interest expense (LTM)", type: "number", unit: "$mm", default: 205 },
    { key: "capex", label: "Capex (LTM)", type: "number", unit: "$mm", default: 310 },
    { key: "taxes", label: "Cash taxes (LTM)", type: "number", unit: "$mm", default: 150 },
    { key: "amort", label: "Scheduled amortization (next 12m)", type: "number", unit: "$mm", default: 120 },
    { key: "dividends", label: "Dividends and restricted payments", type: "number", unit: "$mm", default: 95 },
    { key: "revolver", label: "Undrawn revolver", type: "number", unit: "$mm", default: 1200 },
    { key: "maxLeverage", label: "Max net leverage", type: "number", unit: "x", default: 3.5 },
    { key: "minCoverage", label: "Min interest coverage", type: "number", unit: "x", default: 3 },
    { key: "minFccr", label: "Min fixed-charge coverage", type: "number", unit: "x", default: 1.25 },
    { key: "minLiquidity", label: "Min liquidity", type: "number", unit: "$mm", default: 750 },
  ],
  example: { ebitda: 1480, addbacks: 380, debt: 5280, cash: 900, nettingCap: 500, interest: 205, capex: 310, taxes: 150, amort: 120, dividends: 95, revolver: 1200, maxLeverage: 3.5, minCoverage: 3, minFccr: 1.25, minLiquidity: 750 },
  prefill: (c) => ({
    ebitda: c.ltm.ebitda ?? c.ltm.adjEbitda ?? 0, addbacks: c.ltm.sbc ?? 0, debt: c.balance.debt ?? 0, cash: c.balance.cash ?? 0,
    capex: c.ltm.capex ?? 0, nettingCap: Math.round((c.balance.cash ?? 0) / 2),
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const ebitda = num(i, "ebitda"), addbacks = num(i, "addbacks"), debt = num(i, "debt"), cash = num(i, "cash");
    const cap = num(i, "nettingCap"), interest = num(i, "interest"), capex = num(i, "capex"), taxes = num(i, "taxes");
    const amort = num(i, "amort"), divs = num(i, "dividends"), revolver = num(i, "revolver");
    const maxLev = num(i, "maxLeverage"), minCov = num(i, "minCoverage"), minFccr = num(i, "minFccr"), minLiq = num(i, "minLiquidity");
    const lenderEbitda = ebitda + addbacks;
    if (lenderEbitda <= 0) throw new Error("Lender EBITDA (EBITDA plus permitted add-backs) must be positive.");
    if (debt < 0 || maxLev <= 0) throw new Error("Total debt must be non-negative and the maximum leverage covenant positive.");
    const nettedCash = Math.min(cash, cap), netDebt = debt - nettedCash;
    const netLev = netDebt / lenderEbitda, totalLev = debt / lenderEbitda;
    const cov = interest > 0 ? lenderEbitda / interest : null;
    const fixedCharges = interest + amort + divs;
    const fccr = fixedCharges > 0 ? (lenderEbitda - capex - taxes) / fixedCharges : null;
    const liquidity = cash + revolver;
    const ebitdaCushion = lenderEbitda - netDebt / maxLev, debtCapacity = maxLev * lenderEbitda - netDebt;
    const covCushion = cov === null ? null : lenderEbitda - minCov * interest;
    const util = [
      { name: "Net leverage", calc: "(Debt − min(cash, netting cap)) / lender EBITDA", actual: netLev, req: maxLev, u: netLev / maxLev, head: `${fmt.x(maxLev - netLev)} of ratio, ${fmt.money(ebitdaCushion)} of EBITDA`, fmtv: fmt.x },
      { name: "Interest coverage", calc: "Lender EBITDA / cash interest", actual: cov ?? NaN, req: minCov, u: cov ? minCov / cov : 0, head: covCushion === null ? "n/a" : `${fmt.money(covCushion)} of EBITDA`, fmtv: fmt.x },
      { name: "Fixed-charge coverage", calc: "(Lender EBITDA − capex − cash taxes) / (interest + amortization + dividends)", actual: fccr ?? NaN, req: minFccr, u: fccr ? minFccr / fccr : 0, head: fccr === null ? "n/a" : `${fmt.money((fccr - minFccr) * fixedCharges)} of EBITDA`, fmtv: fmt.x },
      { name: "Minimum liquidity", calc: "Unrestricted cash + undrawn revolver", actual: liquidity, req: minLiq, u: minLiq > 0 ? minLiq / liquidity : 0, head: fmt.money(liquidity - minLiq), fmtv: fmt.money },
    ];
    const tightest = util.reduce((a, b) => (b.u > a.u ? b : a));
    const declines = [0, 0.05, 0.1, 0.15, 0.2];
    const draws = [0, 0.05, 0.1, 0.15].map((p) => p * debt);
    const grid = declines.map((d) => draws.map((x) => (debt + x - Math.min(cash, cap)) / (lenderEbitda * (1 - d))));
    const status = (u: number) => (u >= 1 ? "Breach" : u >= 0.95 ? "Critical" : u >= 0.9 ? "Warning" : u >= 0.8 ? "Watch" : "Compliant");
    return {
      title: "Covenant headroom",
      summary: `Lender EBITDA of ${fmt.money(lenderEbitda)} (${fmt.money(ebitda)} reported plus ${fmt.money(addbacks)} of add-backs) supports net leverage of ${fmt.x(netLev)} against a ${fmt.x(maxLev)} limit, using ${fmt.pct(netLev / maxLev, 0)} of the covenant. The tightest test is ${tightest.name.toLowerCase()} at ${fmt.pct(tightest.u, 0)} utilization (${status(tightest.u).toLowerCase()}). EBITDA can fall ${fmt.pct(lenderEbitda > 0 ? ebitdaCushion / lenderEbitda : 0, 0)} before the leverage covenant trips, and there is ${fmt.money(debtCapacity)} of incremental debt capacity.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Lender EBITDA", value: fmt.money(lenderEbitda), hint: `${fmt.pct(lenderEbitda ? addbacks / lenderEbitda : 0, 0)} from add-backs` },
          { label: "Net leverage", value: fmt.x(netLev), delta: `limit ${fmt.x(maxLev)}`, tone: netLev >= maxLev ? "neg" : netLev / maxLev >= 0.9 ? "warn" : "pos" },
          { label: "Total leverage", value: fmt.x(totalLev), hint: "No cash netting" },
          { label: "Interest coverage", value: fmt.x(cov), delta: `floor ${fmt.x(minCov)}`, tone: cov !== null && cov < minCov ? "neg" : "pos" },
          { label: "FCCR", value: fmt.x(fccr), delta: `floor ${fmt.x(minFccr)}`, tone: fccr !== null && fccr < minFccr ? "neg" : "pos" },
          { label: "Liquidity", value: fmt.money(liquidity), delta: `floor ${fmt.money(minLiq)}`, tone: liquidity < minLiq ? "neg" : "pos" },
          { label: "EBITDA cushion", value: `${fmt.money(ebitdaCushion)} (${fmt.pct(ebitdaCushion / lenderEbitda, 0)})`, tone: ebitdaCushion <= 0 ? "neg" : "neutral" },
          { label: "Debt capacity", value: fmt.money(debtCapacity), tone: debtCapacity <= 0 ? "neg" : "neutral" },
        ] },
        { type: "table", title: "Covenant compliance", columns: ["Covenant", "Calculation", "Actual", "Required", "Headroom", "Utilization", "Status"],
          rows: util.map((r) => [r.name, r.calc, r.fmtv(Number.isFinite(r.actual) ? r.actual : null), r.fmtv(r.req), r.head, fmt.pct(r.u, 0), status(r.u)]),
          emphasisRow: util.indexOf(tightest), note: "Utilization is actual/limit for maximum ratios and limit/actual for minimums, so 100% is the covenant level in both cases. Warning levels: 80% watch, 90% warning, 95% critical." },
        { type: "table", title: "Lender EBITDA and net debt build ($mm)", columns: ["Line", "Amount", "Note"], rows: [
          ["EBITDA (GAAP)", fmt.money(ebitda), "As reported"], ["Permitted add-backs", fmt.money(addbacks), "After any agreement caps"], ["Lender EBITDA", fmt.money(lenderEbitda), "Covenant denominator"],
          ["Total debt", fmt.money(debt), "Including finance leases and drawn revolver"], ["Unrestricted cash", fmt.money(cash), ""], ["Cash netted", fmt.money(nettedCash), `Capped at ${fmt.money(cap)}`], ["Net debt", fmt.money(netDebt), "Covenant numerator"],
        ], emphasisRow: 2 },
        { type: "sensitivity", title: "Net leverage: EBITDA decline × incremental debt", rowLabel: "EBITDA decline", colLabel: "Incremental debt", rows: declines.map((d) => fmt.pct(d, 0)), cols: draws.map((x) => fmt.money(x)), values: grid, format: "x", baseRow: 0, baseCol: 0 },
        { type: "bar", title: "Covenant utilization", format: "pct", data: util.map((r) => ({ label: r.name, value: r.u, emphasis: r === tightest })), reference: { value: 1, label: "Covenant level" } },
      ],
      caveats: [
        "Add-backs must be taken from the credit agreement, not from the non-GAAP reconciliation: run-rate synergies and restructuring charges are usually capped as a percentage of EBITDA, and using accounting EBITDA instead of lender-defined EBITDA is the most common covenant error.",
        "Cash netting is applied only up to the stated cap and only to unrestricted cash. Confirm whether the debt definition includes letters of credit, securitization facilities and finance leases.",
        "FCCR here is (lender EBITDA − capex − cash taxes) / (cash interest + scheduled amortization + dividends); many agreements define fixed charges differently, so reconcile to the agreement before certifying.",
        "The grid holds cash and interest flat while EBITDA falls; a real downside case also raises interest on the incremental draw and consumes cash.",
      ],
      nextSteps: ["Run the covenant definitions workflow against the credit agreement to confirm every add-back and cap", "Test the forecast quarters, not just LTM, since maintenance tests are quarterly", "Size the equity cure or the EBITDA action needed at the tightest quarter"],
    };
  },
};

/** DSO, DIO, DPO, cash conversion cycle and the cash released by moving to target days. */
const cashConversionCycle: ToolDef = {
  kind: "calc", id: "cf-cash-conversion-cycle", title: "Cash conversion cycle & unlock", tagline: "DSO + DIO − DPO, the working capital it ties up, and the cash released at peer-median days.",
  description: "Computes days sales outstanding, days inventory outstanding and days payable outstanding from the balance sheet and the income statement, sums them into the cash conversion cycle, then converts the gap to the target days into cash released and an annual carrying benefit at your cost of funds.",
  roles: ["corpfin", "consultant", "accountant"], specialties: [TR, FPA, CTRL, ...CONS, ...ACCT], category: "Reporting", icon: "ArrowLeftRight", savesMinutes: 45, tags: ["CCC", "DSO", "working capital"],
  fields: [
    { key: "revenue", label: "Revenue (LTM)", type: "number", unit: "$mm", required: true, default: 51400 },
    { key: "cogs", label: "Cost of revenue (LTM)", type: "number", unit: "$mm", required: true, default: 28900 },
    { key: "ar", label: "Accounts receivable", type: "number", unit: "$mm", required: true, default: 4680 },
    { key: "inventory", label: "Inventory", type: "number", unit: "$mm", default: 7600 },
    { key: "ap", label: "Accounts payable", type: "number", unit: "$mm", default: 3120 },
    { key: "targetDso", label: "Target DSO", type: "number", unit: "days", default: 30 },
    { key: "targetDio", label: "Target DIO", type: "number", unit: "days", default: 85 },
    { key: "targetDpo", label: "Target DPO", type: "number", unit: "days", default: 45 },
    { key: "rate", label: "Cost of funds", type: "number", unit: "%", default: 6 },
    { key: "days", label: "Days in period", type: "number", unit: "days", default: 365 },
  ],
  example: { revenue: 51400, cogs: 28900, ar: 4680, inventory: 7600, ap: 3120, targetDso: 30, targetDio: 85, targetDpo: 45, rate: 6, days: 365 },
  prefill: (c) => ({
    revenue: c.ltm.revenue ?? 0,
    cogs: c.ltm.revenue !== null && c.ltm.grossProfit !== null ? c.ltm.revenue - c.ltm.grossProfit : 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const rev = num(i, "revenue"), cogs = num(i, "cogs"), ar = num(i, "ar"), inv = num(i, "inventory"), ap = num(i, "ap");
    const d = num(i, "days", 365) || 365, rate = num(i, "rate") / 100;
    const tDso = num(i, "targetDso"), tDio = num(i, "targetDio"), tDpo = num(i, "targetDpo");
    if (rev <= 0) throw new Error("Revenue must be positive to compute DSO.");
    if (cogs <= 0 && (inv > 0 || ap > 0)) throw new Error("Cost of revenue must be positive to compute DIO and DPO.");
    const dso = (ar / rev) * d, dio = cogs > 0 ? (inv / cogs) * d : 0, dpo = cogs > 0 ? (ap / cogs) * d : 0;
    const ccc = dso + dio - dpo, targetCcc = tDso + tDio - tDpo;
    const nwc = ar + inv - ap;
    const arUnlock = ((dso - tDso) * rev) / d, invUnlock = ((dio - tDio) * cogs) / d, apUnlock = ((tDpo - dpo) * cogs) / d;
    const totalUnlock = arUnlock + invUnlock + apUnlock;
    const levers = [
      { lever: "Receivables (DSO)", actual: dso, target: tDso, gap: dso - tDso, cash: arUnlock, owner: "Credit and collections" },
      { lever: "Inventory (DIO)", actual: dio, target: tDio, gap: dio - tDio, cash: invUnlock, owner: "Supply chain" },
      { lever: "Payables (DPO)", actual: dpo, target: tDpo, gap: tDpo - dpo, cash: apUnlock, owner: "Procurement and AP" },
    ];
    return {
      title: "Cash conversion cycle",
      summary: `The cash conversion cycle is ${fmt.num(ccc, 1)} days (DSO ${fmt.num(dso, 1)} + DIO ${fmt.num(dio, 1)} − DPO ${fmt.num(dpo, 1)}), tying up ${fmt.money(nwc)} of net working capital, or ${fmt.pct(nwc / rev)} of revenue. Moving to the target days would take the cycle to ${fmt.num(targetCcc, 1)} days and release ${fmt.money(totalUnlock)} of cash, worth ${fmt.money(totalUnlock * rate)} a year at a ${fmt.pct(rate, 1)} cost of funds.`,
      blocks: [
        { type: "kpis", items: [
          { label: "CCC", value: `${fmt.num(ccc, 1)} days`, delta: `target ${fmt.num(targetCcc, 1)}`, tone: ccc <= targetCcc ? "pos" : "warn" },
          { label: "DSO", value: `${fmt.num(dso, 1)} days`, tone: dso <= tDso ? "pos" : "neg" }, { label: "DIO", value: `${fmt.num(dio, 1)} days`, tone: dio <= tDio ? "pos" : "neg" },
          { label: "DPO", value: `${fmt.num(dpo, 1)} days`, tone: dpo >= tDpo ? "pos" : "neg" },
          { label: "Net working capital", value: fmt.money(nwc), hint: `${fmt.pct(nwc / rev)} of revenue` },
          { label: "Cash unlock at target", value: fmt.money(totalUnlock), tone: tone(totalUnlock) },
          { label: "Annual carrying benefit", value: fmt.money(totalUnlock * rate) },
        ] },
        { type: "table", title: "Working capital days", columns: ["Component", "Balance ($mm)", "Driver ($mm)", "Days", "Target", "Gap", "Cash at target ($mm)", "Owner"],
          rows: [
            ["Accounts receivable", fmt.money(ar), `Revenue ${fmt.money(rev)}`, fmt.num(dso, 1), fmt.num(tDso, 1), fmt.num(dso - tDso, 1), fmt.money(arUnlock), "Credit and collections"],
            ["Inventory", fmt.money(inv), `COGS ${fmt.money(cogs)}`, fmt.num(dio, 1), fmt.num(tDio, 1), fmt.num(dio - tDio, 1), fmt.money(invUnlock), "Supply chain"],
            ["Accounts payable", fmt.money(ap), `COGS ${fmt.money(cogs)}`, fmt.num(dpo, 1), fmt.num(tDpo, 1), fmt.num(tDpo - dpo, 1), fmt.money(apUnlock), "Procurement and AP"],
          ],
          totals: ["Cash conversion cycle", fmt.money(nwc), "", fmt.num(ccc, 1), fmt.num(targetCcc, 1), fmt.num(ccc - targetCcc, 1), fmt.money(totalUnlock), ""],
          note: `DSO = AR / revenue × ${d}; DIO = inventory / COGS × ${d}; DPO = AP / COGS × ${d}; CCC = DSO + DIO − DPO.` },
        { type: "waterfall", title: "Days bridge to target", format: "num", steps: [{ label: "Current CCC", value: ccc, total: true }, { label: "Receivables", value: tDso - dso }, { label: "Inventory", value: tDio - dio }, { label: "Payables", value: -(tDpo - dpo) }, { label: "Target CCC", value: targetCcc, total: true }] },
        { type: "bar", title: "Cash released by lever ($mm)", format: "money", data: levers.map((l) => ({ label: l.lever, value: l.cash, emphasis: Math.abs(l.cash) === Math.max(...levers.map((x) => Math.abs(x.cash))) })) },
      ],
      caveats: [
        "Computed on period-end balances, which are seasonal: a trailing two-point or four-point average gives a smoother read and is the convention when the year-end is a trough.",
        "Peer DPO and DSO are not comparable where a company runs a supplier-finance program, sells receivables or factors, since those move the balance without changing the underlying terms. Check the disclosure before setting the target.",
        "DIO and DPO use cost of revenue rather than purchases; where purchases differ materially from COGS (building or drawing down inventory), DPO on purchases is the better measure.",
        "Cash released is a one-time balance-sheet effect, not recurring earnings; the carrying benefit is the annual value of holding that cash at the stated cost of funds.",
      ],
      nextSteps: ["Benchmark the target days against peers from XBRL rather than setting them by judgement", "Split the receivables gap by aging bucket and customer to find where the days actually sit", "Reflect the agreed target days in the 13-week cash forecast"],
    };
  },
};

/** Headcount plan roll-up: fully loaded cost by month with ramp-adjusted survival. */
const headcountPlan: ToolDef = {
  kind: "calc", id: "cf-headcount-plan", title: "Headcount plan roll-up", tagline: "Fully loaded cost by month and department from a hiring plan, with attrition and exit run-rate.",
  description: "Rolls a hiring plan into monthly cost: base pay grossed up for bonus, commission, benefits and payroll taxes, recognized from each requisition's start month, with attrition applied on a monthly survival basis and no backfill assumed. Reports in-year cost, the exit run-rate, cost per FTE and the department split.",
  roles: ["corpfin"], specialties: [FPA, SF, CTRL], category: "Planning & forecasting", icon: "Users", savesMinutes: 90, tags: ["headcount", "opex", "planning"],
  fields: [
    { key: "csv", label: "Hiring plan", type: "csv", required: true, columns: "department, role, start_month (1-N), fte, base_salary ($k annual), bonus_pct (%), commission_pct (%, optional)", placeholder: "department,role,start_month,fte,base_salary,bonus_pct" },
    { key: "months", label: "Plan horizon", type: "number", unit: "months", default: 12, min: 3, max: 24 },
    { key: "benefits", label: "Benefits load", type: "number", unit: "%", default: 18 },
    { key: "payrollTax", label: "Payroll taxes", type: "number", unit: "%", default: 8 },
    { key: "attrition", label: "Annual attrition", type: "number", unit: "%", default: 12 },
    { key: "startingFte", label: "Starting FTE", type: "number", default: 420 },
    { key: "startingCost", label: "Starting monthly cost", type: "number", unit: "$k", default: 4900 },
  ],
  example: { months: 12, benefits: 18, payrollTax: 8, attrition: 12, startingFte: 420, startingCost: 4900, csv: "department,role,start_month,fte,base_salary,bonus_pct,commission_pct\nSales,Account executive,2,6,145,0,60\nSales,Sales engineer,3,3,165,15,0\nSales,SDR,2,5,70,0,30\nEngineering,Senior engineer,1,4,195,12,0\nEngineering,Engineering manager,4,2,225,15,0\nEngineering,SRE,6,3,185,12,0\nProduct,Product manager,3,2,185,15,0\nCustomer success,CSM,2,4,120,10,0\nG&A,Accountant,5,2,105,8,0\nG&A,Recruiter,1,2,115,10,0\nMarketing,Demand gen manager,7,2,135,10,0" },
  compute: (i: Inputs): WorkflowOutput => {
    const months = Math.round(num(i, "months", 12));
    const load = 1 + num(i, "benefits") / 100 + num(i, "payrollTax") / 100;
    const attr = num(i, "attrition") / 100;
    if (attr < 0 || attr >= 1) throw new Error("Annual attrition must be between 0% and 99%.");
    const mAttr = 1 - Math.pow(1 - attr, 1 / 12);
    const startFte = num(i, "startingFte"), startCost = num(i, "startingCost");
    const hires = records(str(i, "csv")).map((r) => {
      need(r, "base salary", "base_salary", "salary", "base");
      const fte = cnum(r, "fte", "heads", "count", "headcount") || 1;
      const base = cnum(r, "base_salary", "salary", "base");
      const variable = 1 + (cnum(r, "bonus_pct", "bonus", "target_bonus") + cnum(r, "commission_pct", "commission", "variable_pct")) / 100;
      const start = Math.max(1, Math.round(cnum(r, "start_month", "month", "startmonth", "start") || 1));
      return { dept: cell(r, "department", "dept", "team", "cost_center", "function") || "Unassigned", role: cell(r, "role", "title", "position") || "Hire", start, fte, base, loaded: base * variable * load, monthly: (base * variable * load * fte) / 12 };
    });
    if (!hires.length) throw new Error("Paste at least one requisition row.");
    if (hires.some((h) => h.base <= 0)) throw new Error("Every row needs a positive base_salary (annual, in $k).");
    const surv = (m: number, start: number) => Math.pow(1 - mAttr, Math.max(0, m - start));
    const monthly = Array.from({ length: months }, (_, k) => {
      const m = k + 1;
      const newCost = sum(hires.filter((h) => h.start <= m).map((h) => h.monthly * surv(m, h.start)));
      const baseCost = startCost * Math.pow(1 - mAttr, m - 1);
      const fte = startFte * Math.pow(1 - mAttr, m - 1) + sum(hires.filter((h) => h.start <= m).map((h) => h.fte * surv(m, h.start)));
      return { m, newCost, baseCost, total: newCost + baseCost, fte, adds: sum(hires.filter((h) => h.start === m).map((h) => h.fte)) };
    });
    const grossAdds = sum(hires.map((h) => h.fte));
    const inYearNew = sum(monthly.map((x) => x.newCost)), inYearTotal = sum(monthly.map((x) => x.total));
    const exit = monthly[months - 1];
    const depts = [...new Set(hires.map((h) => h.dept))].map((dept) => {
      const rows = hires.filter((h) => h.dept === dept);
      const cost = sum(monthly.map((x) => sum(rows.filter((h) => h.start <= x.m).map((h) => h.monthly * surv(x.m, h.start)))));
      return { dept, fte: sum(rows.map((h) => h.fte)), cost, runRate: sum(rows.map((h) => h.monthly * surv(months, h.start))) * 12, avgLoaded: sum(rows.map((h) => h.loaded * h.fte)) / sum(rows.map((h) => h.fte)) };
    }).sort((a, b) => b.cost - a.cost);
    const medianLoaded = median(hires.map((h) => h.loaded)) ?? 0;
    return {
      title: "Headcount plan roll-up",
      summary: `The plan adds ${fmt.num(grossAdds, 1)} FTE across ${depts.length} departments at a median fully loaded cost of $${fmt.num(medianLoaded, 0)}k. In-year cost of the new hires is $${fmt.num(inYearNew, 0)}k and total compensation cost is $${fmt.num(inYearTotal, 0)}k over ${months} months; the month-${months} exit run-rate is $${fmt.num(exit.total * 12, 0)}k annualized on ${fmt.num(exit.fte, 1)} FTE.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Gross FTE adds", value: fmt.num(grossAdds, 1) }, { label: "Ending FTE", value: fmt.num(exit.fte, 1), delta: `from ${fmt.num(startFte, 0)}` },
          { label: "In-year cost of new hires", value: `$${fmt.num(inYearNew, 0)}k` }, { label: "Total in-year comp", value: `$${fmt.num(inYearTotal, 0)}k` },
          { label: "Exit run-rate (annualized)", value: `$${fmt.num(exit.total * 12, 0)}k` }, { label: "Median fully loaded cost", value: `$${fmt.num(medianLoaded, 0)}k`, hint: `Load factor ${load.toFixed(2)}x on base plus variable` },
          { label: "Cost per FTE (exit)", value: `$${fmt.num(exit.fte ? (exit.total * 12) / exit.fte : 0, 0)}k` },
        ] },
        { type: "table", title: "By department ($k)", columns: ["Department", "FTE adds", "In-year cost", "Exit run-rate", "Avg fully loaded"],
          rows: depts.map((d) => [d.dept, fmt.num(d.fte, 1), fmt.num(d.cost, 0), fmt.num(d.runRate, 0), fmt.num(d.avgLoaded, 0)]),
          totals: ["Total", fmt.num(grossAdds, 1), fmt.num(inYearNew, 0), fmt.num(sum(depts.map((d) => d.runRate)), 0), fmt.num(medianLoaded, 0)] },
        { type: "table", title: "Monthly build ($k)", columns: ["Month", "FTE adds", "Ending FTE", "Existing base", "New hires", "Total cost", "Cumulative"],
          rows: monthly.map((x, k) => [`M${x.m}`, fmt.num(x.adds, 1), fmt.num(x.fte, 1), fmt.num(x.baseCost, 0), fmt.num(x.newCost, 0), fmt.num(x.total, 0), fmt.num(sum(monthly.slice(0, k + 1).map((y) => y.total)), 0)]) },
        { type: "line", title: "Monthly compensation cost ($k)", format: "num", series: [
          { name: "Total", points: monthly.map((x) => ({ x: `M${x.m}`, y: Number(x.total.toFixed(0)) })) },
          { name: "New hires", points: monthly.map((x) => ({ x: `M${x.m}`, y: Number(x.newCost.toFixed(0)) })) },
        ] },
        { type: "columns", title: "FTE adds by month", format: "num", data: monthly.map((x) => ({ label: `M${x.m}`, value: Number(x.adds.toFixed(1)) })) },
      ],
      caveats: [
        `Fully loaded cost = base × (1 + bonus% + commission%) × (1 + benefits% + payroll tax%), recognized from the start month with no partial-month proration. Load factor is ${load.toFixed(2)}x.`,
        `Attrition of ${fmt.pct(attr, 0)} a year is applied as a monthly survival factor of ${fmt.pct(mAttr, 2)} to both the existing base and the plan, with no backfill: add backfill requisitions as rows to model replacement hiring.`,
        "Commission is treated as an on-target cost at full productivity from the start month; if quota carriers ramp, enter the ramped commission or stagger the start months.",
        "Excludes equity compensation, recruiting fees, severance, contractors and non-headcount spend (tools, travel, facilities per head).",
      ],
      nextSteps: ["Compare the exit run-rate with the opex line in the reforecast", "Model the hiring-freeze case by pushing every non-revenue start month out one quarter", "Add fully loaded cost per FTE to the board pack as the productivity denominator"],
    };
  },
};

/** Buyback versus dividend: EPS accretion, leverage, payout coverage and the earnings-yield test. */
const buybackVsDividend: ToolDef = {
  kind: "calc", id: "cf-buyback-vs-dividend", title: "Buyback vs dividend", tagline: "EPS accretion, pro forma leverage and payout coverage for the same dollars returned two ways.",
  description: "Prices the same capital return as a share repurchase and as a dividend: shares retired at an execution premium, after-tax funding cost of the cash and debt used, pro forma EPS and accretion, buyback yield, dividend per share and payout ratio, FCF coverage, and pro forma net leverage. Applies the earnings-yield test that decides whether a debt-funded buyback is accretive.",
  roles: ["corpfin"], specialties: [IR, TR, FPA, SF], category: "Capital markets", icon: "Coins", savesMinutes: 90, tags: ["buyback", "dividend", "capital allocation"],
  fields: [
    { key: "netIncome", label: "Net income (LTM)", type: "number", unit: "$mm", required: true, default: 10500 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", required: true, default: 480 },
    { key: "price", label: "Share price", type: "number", unit: "$", required: true, default: 385 },
    { key: "ebitda", label: "EBITDA (LTM)", type: "number", unit: "$mm", default: 15800 },
    { key: "fcf", label: "Free cash flow (LTM)", type: "number", unit: "$mm", default: 9800 },
    { key: "cash", label: "Cash and equivalents", type: "number", unit: "$mm", default: 6800 },
    { key: "debt", label: "Total debt", type: "number", unit: "$mm", default: 38000 },
    { key: "deploy", label: "Capital to return", type: "number", unit: "$mm", required: true, default: 5000 },
    { key: "debtFunded", label: "Funded with new debt", type: "number", unit: "%", default: 40 },
    { key: "premium", label: "Execution premium to current price", type: "number", unit: "%", default: 2 },
    { key: "newDebtRate", label: "New debt rate", type: "number", unit: "%", default: 5.5 },
    { key: "cashYield", label: "Yield on cash used", type: "number", unit: "%", default: 4 },
    { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 23 },
    { key: "currentDps", label: "Current dividend per share (annual)", type: "number", unit: "$", default: 5.6 },
  ],
  example: { netIncome: 10500, shares: 480, price: 385, ebitda: 15800, fcf: 9800, cash: 6800, debt: 38000, deploy: 5000, debtFunded: 40, premium: 2, newDebtRate: 5.5, cashYield: 4, tax: 23, currentDps: 5.6 },
  prefill: (c) => ({
    netIncome: c.ltm.netIncome ?? 0, shares: c.balance.sharesOut ?? 100, price: c.price?.last ?? 100, ebitda: c.ltm.ebitda ?? c.ltm.adjEbitda ?? 0,
    fcf: (c.ltm.operatingCashFlow ?? 0) - (c.ltm.capex ?? 0), cash: c.balance.cash ?? 0, debt: c.balance.debt ?? 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const ni = num(i, "netIncome"), shares = num(i, "shares"), price = num(i, "price"), ebitda = num(i, "ebitda");
    const fcf = num(i, "fcf"), cash = num(i, "cash"), debt = num(i, "debt"), deploy = num(i, "deploy");
    const debtPct = num(i, "debtFunded") / 100, prem = num(i, "premium") / 100;
    const kd = num(i, "newDebtRate") / 100, ky = num(i, "cashYield") / 100, tax = num(i, "tax") / 100, dps0 = num(i, "currentDps");
    if (shares <= 0 || price <= 0) throw new Error("Share count and price must be positive.");
    if (deploy <= 0) throw new Error("Enter the capital to return.");
    const newDebt = deploy * debtPct, cashUsed = deploy - newDebt;
    if (cashUsed > cash) throw new Error(`Cash funding of ${fmt.money(cashUsed)} exceeds the ${fmt.money(cash)} cash balance. Raise the debt-funded share.`);
    const fundingCost = (newDebt * kd + cashUsed * ky) * (1 - tax);
    const marketCap = price * shares, baseEps = ni / shares;
    const avgPrice = price * (1 + prem), retired = deploy / avgPrice;
    const bbNi = ni - fundingCost, bbShares = shares - retired, bbEps = bbNi / bbShares;
    const divNi = ni - fundingCost, divEps = divNi / shares;
    const dpsNew = deploy / shares, existingDiv = dps0 * shares;
    const netDebt0 = debt - cash, pfNetDebt = netDebt0 + deploy;
    const costRate = fundingCost / deploy, earningsYield = baseEps / avgPrice;
    const prices = [price * 0.8, price * 0.9, price, price * 1.1, price * 1.2];
    const sizes = [deploy * 0.5, deploy * 0.75, deploy, deploy * 1.5, deploy * 2];
    const grid = prices.map((p) => sizes.map((s) => {
      const nd = s * debtPct, cu = s - nd;
      if (cu > cash) return null;
      const fc = (nd * kd + cu * ky) * (1 - tax);
      return (ni - fc) / (shares - s / (p * (1 + prem))) / baseEps - 1;
    }));
    return {
      title: "Buyback vs dividend",
      summary: `Returning ${fmt.money(deploy)} (${fmt.pct(deploy / marketCap)} of market cap) as a repurchase retires ${fmt.num(retired, 1)}mm shares, or ${fmt.pct(retired / shares)} of the count, and takes EPS from ${fmt.moneyRaw(baseEps, 2)} to ${fmt.moneyRaw(bbEps, 2)} (${fmt.pct(bbEps / baseEps - 1)}). The same dollars as a dividend pay ${fmt.moneyRaw(dpsNew, 2)} per share and leave EPS at ${fmt.moneyRaw(divEps, 2)}. Both take net leverage from ${fmt.x(ebitda ? netDebt0 / ebitda : null)} to ${fmt.x(ebitda ? pfNetDebt / ebitda : null)}. The buyback is ${earningsYield > costRate ? "accretive" : "dilutive"}: the ${fmt.pct(earningsYield)} earnings yield at the purchase price is ${earningsYield > costRate ? "above" : "below"} the ${fmt.pct(costRate)} after-tax funding cost.`,
      blocks: [
        { type: "kpis", items: [
          { label: "EPS, standalone", value: fmt.moneyRaw(baseEps, 2) },
          { label: "EPS, buyback", value: fmt.moneyRaw(bbEps, 2), delta: fmt.pct(bbEps / baseEps - 1), tone: bbEps >= baseEps ? "pos" : "neg" },
          { label: "EPS, dividend", value: fmt.moneyRaw(divEps, 2), delta: fmt.pct(divEps / baseEps - 1), tone: divEps >= baseEps ? "pos" : "neg" },
          { label: "Shares retired", value: `${fmt.num(retired, 1)}mm (${fmt.pct(retired / shares)})` },
          { label: "Buyback yield", value: fmt.pct(deploy / marketCap) },
          { label: "Dividend per share", value: fmt.moneyRaw(dpsNew, 2), hint: `On top of ${fmt.moneyRaw(dps0, 2)} existing` },
          { label: "Pro forma net leverage", value: fmt.x(ebitda ? pfNetDebt / ebitda : null), delta: `from ${fmt.x(ebitda ? netDebt0 / ebitda : null)}`, tone: ebitda && pfNetDebt / ebitda > 3 ? "warn" : "neutral" },
          { label: "Earnings yield vs funding cost", value: `${fmt.pct(earningsYield)} vs ${fmt.pct(costRate)}`, tone: earningsYield > costRate ? "pos" : "neg" },
        ] },
        { type: "table", title: "Side by side ($mm unless noted)", columns: ["Line", "Standalone", "Buyback", "Dividend"], rows: [
          ["Net income", fmt.money(ni), fmt.money(bbNi), fmt.money(divNi)],
          ["After-tax funding cost", fmt.money(0), fmt.money(-fundingCost), fmt.money(-fundingCost)],
          ["Diluted shares (mm)", fmt.num(shares, 1), fmt.num(bbShares, 1), fmt.num(shares, 1)],
          ["EPS ($)", fmt.moneyRaw(baseEps, 2), fmt.moneyRaw(bbEps, 2), fmt.moneyRaw(divEps, 2)],
          ["EPS change", "—", fmt.pct(bbEps / baseEps - 1), fmt.pct(divEps / baseEps - 1)],
          ["Cash used", fmt.money(0), fmt.money(cashUsed), fmt.money(cashUsed)],
          ["New debt", fmt.money(0), fmt.money(newDebt), fmt.money(newDebt)],
          ["Net debt", fmt.money(netDebt0), fmt.money(pfNetDebt), fmt.money(pfNetDebt)],
          ["Net leverage", fmt.x(ebitda ? netDebt0 / ebitda : null), fmt.x(ebitda ? pfNetDebt / ebitda : null), fmt.x(ebitda ? pfNetDebt / ebitda : null)],
          ["Total payout / return", fmt.money(existingDiv), fmt.money(existingDiv + deploy), fmt.money(existingDiv + deploy)],
          ["Payout ratio of net income", fmt.pct(ni ? existingDiv / ni : null), fmt.pct(ni ? (existingDiv + deploy) / ni : null), fmt.pct(ni ? (existingDiv + deploy) / ni : null)],
          ["FCF coverage of the return", fmt.x(existingDiv ? fcf / existingDiv : null), fmt.x(fcf / (existingDiv + deploy)), fmt.x(fcf / (existingDiv + deploy))],
        ], emphasisRow: 3, note: "The dividend case is EPS-neutral except for the after-tax cost of the cash and debt used to fund it; only the buyback changes the share count." },
        { type: "bar", title: "Pro forma EPS ($)", format: "num", data: [{ label: "Standalone", value: Number(baseEps.toFixed(2)) }, { label: "Buyback", value: Number(bbEps.toFixed(2)), emphasis: true }, { label: "Dividend", value: Number(divEps.toFixed(2)) }] },
        { type: "sensitivity", title: "Buyback EPS accretion: purchase price × size", rowLabel: "Average purchase price", colLabel: "Capital deployed", rows: prices.map((p) => fmt.moneyRaw(p, 0)), cols: sizes.map((s) => fmt.money(s)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "Accretion is the mechanical EPS effect only: it is not value creation. A repurchase creates value when the shares are bought below intrinsic value, and the earnings-yield test (earnings yield at the purchase price versus the after-tax cost of funds) is the accretion test, not a valuation test.",
        "Execution premium models buying into the market over time; a 10b5-1 program or an accelerated share repurchase changes both the average price and the timing of the share-count reduction, which is assumed immediate here.",
        "A dividend is a standing commitment: cutting it is read as distress, so coverage should be tested against a downside FCF case, not LTM FCF. A buyback can be paused without the same signal.",
        "Excludes buyback excise or withholding taxes, the dilution from ongoing equity compensation, and any rating-agency or covenant constraint on the pro forma leverage.",
      ],
      nextSteps: ["Test the pro forma leverage against the covenant calculator and the rating threshold", "Re-run at the downside FCF case to check dividend coverage", "Compare the buyback yield with peers' capital-return policies before recommending"],
    };
  },
};

/** Debt schedule: amortization, maturity wall, weighted average cost and floating-rate sensitivity. */
const debtSchedule: ToolDef = {
  kind: "calc", id: "cf-debt-schedule", title: "Debt schedule & interest", tagline: "Tranche-level amortization, the maturity wall, weighted average cost and the floating-rate sensitivity.",
  description: "Builds the debt schedule from the tranche list: all-in rate per tranche (fixed coupon or base rate plus spread), scheduled amortization and maturity repayments year by year, interest on average balances, weighted average cost of debt and weighted average maturity, the maturity wall, and the interest sensitivity of the floating-rate portion.",
  roles: ["corpfin", "accountant"], specialties: [TR, CTRL, FPA, ...ACCT], category: "Credit & restructuring", icon: "Layers", savesMinutes: 90, tags: ["debt", "maturity wall", "interest"],
  fields: [
    { key: "csv", label: "Tranches", type: "csv", required: true, columns: "tranche, principal ($mm), rate (%, fixed coupon), floating (Y/N), spread_bps, maturity_year, amort_pct (% of original principal per year)", placeholder: "tranche,principal,rate,floating,spread_bps,maturity_year,amort_pct" },
    { key: "baseRate", label: "Base rate (SOFR or equivalent)", type: "number", unit: "%", default: 4.25 },
    { key: "startYear", label: "First year of the schedule", type: "number", default: 2026 },
    { key: "years", label: "Years to project", type: "number", default: 6, min: 2, max: 12 },
  ],
  example: { baseRate: 4.25, startYear: 2026, years: 6, csv: "tranche,principal,rate,floating,spread_bps,maturity_year,amort_pct\nRevolver ($1.5bn commitment),300,,Y,150,2029,0\nTerm loan B,1200,,Y,225,2031,1\n3.45% senior notes,750,3.45,N,,2027,0\n4.90% senior notes,1000,4.90,N,,2030,0\n5.75% senior notes,900,5.75,N,,2034,0\nFinance leases,180,6.20,N,,2028,20" },
  compute: (i: Inputs): WorkflowOutput => {
    const base = num(i, "baseRate") / 100, y0 = Math.round(num(i, "startYear", 2026)), horizon = Math.round(num(i, "years", 6));
    const tranches = records(str(i, "csv")).map((r) => {
      need(r, "principal", "principal", "amount", "balance", "outstanding");
      const floating = /^(y|yes|true|1|float)/i.test(cell(r, "floating", "is_floating", "type", "rate_type"));
      const spread = cnum(r, "spread_bps", "spread", "margin_bps", "margin") / 10000;
      const fixed = cnum(r, "rate", "coupon", "interest_rate") / 100;
      return {
        name: cell(r, "tranche", "instrument", "facility", "name", "description") || "Tranche",
        principal: cnum(r, "principal", "amount", "balance", "outstanding"), floating,
        rate: floating ? base + spread : fixed, spread,
        maturity: Math.round(cnum(r, "maturity_year", "maturity", "year", "due") || y0 + horizon),
        amortPct: cnum(r, "amort_pct", "amortization", "amort") / 100,
      };
    }).filter((t) => t.principal > 0);
    if (!tranches.length) throw new Error("Paste at least one tranche with a positive principal.");
    if (tranches.some((t) => !Number.isFinite(t.rate) || t.rate <= 0)) throw new Error("Every tranche needs a fixed rate, or floating = Y with a spread in basis points.");
    const total = sum(tranches.map((t) => t.principal));
    const waRate = sum(tranches.map((t) => t.principal * t.rate)) / total;
    const waMaturity = sum(tranches.map((t) => t.principal * Math.max(0, t.maturity - y0))) / total;
    const floatingShare = sum(tranches.filter((t) => t.floating).map((t) => t.principal)) / total;
    const balances = tranches.map((t) => t.principal);
    const schedule = Array.from({ length: horizon }, (_, k) => {
      const year = y0 + k;
      let begin = 0, amort = 0, maturities = 0, interest = 0;
      tranches.forEach((t, idx) => {
        const b = balances[idx];
        begin += b;
        if (b <= 0) return;
        let a = 0, m = 0;
        if (year >= t.maturity) { m = b; } else { a = Math.min(b, t.principal * t.amortPct); }
        const end = b - a - m;
        interest += ((b + end) / 2) * t.rate;
        amort += a; maturities += m; balances[idx] = end;
      });
      return { year, begin, amort, maturities, end: begin - amort - maturities, interest };
    });
    const wall = Array.from({ length: horizon }, (_, k) => ({ label: String(y0 + k), value: sum(tranches.filter((t) => t.maturity === y0 + k).map((t) => t.principal)) }));
    const beyond = sum(tranches.filter((t) => t.maturity > y0 + horizon - 1).map((t) => t.principal));
    if (beyond > 0) wall.push({ label: `${y0 + horizon}+`, value: beyond });
    const nextMat = tranches.filter((t) => t.maturity >= y0).sort((a, b) => a.maturity - b.maturity)[0];
    const floatingBalance = sum(tranches.filter((t) => t.floating).map((t) => t.principal));
    const blocks: OutputBlock[] = [
      { type: "kpis", items: [
        { label: "Total debt", value: fmt.money(total) }, { label: "Weighted average cost", value: fmt.pct(waRate, 2) },
        { label: "Weighted average maturity", value: `${fmt.num(waMaturity, 1)} yrs` }, { label: "Floating share", value: fmt.pct(floatingShare, 0), tone: floatingShare > 0.5 ? "warn" : "neutral" },
        { label: `${y0} interest`, value: fmt.money(schedule[0].interest) },
        { label: "Next maturity", value: nextMat ? `${fmt.money(sum(tranches.filter((t) => t.maturity === nextMat.maturity).map((t) => t.principal)))} in ${nextMat.maturity}` : "n/a" },
        { label: "Amortization, next 12m", value: fmt.money(schedule[0].amort) },
      ] },
      { type: "table", title: "Tranches", columns: ["Tranche", "Principal ($mm)", "Type", "All-in rate", "Spread (bps)", "Maturity", "Annual amortization", "% of debt"],
        rows: tranches.sort((a, b) => a.maturity - b.maturity).map((t) => [t.name, fmt.money(t.principal), t.floating ? "Floating" : "Fixed", fmt.pct(t.rate, 2), t.floating ? fmt.int(t.spread * 10000) : "—", String(t.maturity), fmt.money(t.principal * t.amortPct), fmt.pct(t.principal / total, 0)]),
        totals: ["Total", fmt.money(total), `${fmt.pct(floatingShare, 0)} floating`, fmt.pct(waRate, 2), "", `WAM ${fmt.num(waMaturity, 1)} yrs`, fmt.money(sum(tranches.map((t) => t.principal * t.amortPct))), "100%"] },
      { type: "table", title: "Schedule ($mm)", columns: ["Year", "Beginning balance", "Scheduled amortization", "Maturities", "Ending balance", "Interest", "Average rate"],
        rows: schedule.map((s) => [String(s.year), fmt.money(s.begin), fmt.money(s.amort), fmt.money(s.maturities), fmt.money(s.end), fmt.money(s.interest), fmt.pct(s.begin ? s.interest / ((s.begin + s.end) / 2) : null, 2)]),
        totals: ["Total", "", fmt.money(sum(schedule.map((s) => s.amort))), fmt.money(sum(schedule.map((s) => s.maturities))), "", fmt.money(sum(schedule.map((s) => s.interest))), ""],
        note: "Interest is computed on the average of the beginning and ending balance at the all-in rate; revolver draws are held flat until maturity unless an amortization percentage is given." },
      { type: "columns", title: "Maturity wall ($mm)", format: "money", data: wall },
    ];
    if (floatingBalance > 0) {
      const shifts = [-0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02];
      blocks.push({ type: "bar", title: `${y0} interest by base-rate shift ($mm)`, format: "money", reference: { value: schedule[0].interest, label: "Current" },
        data: shifts.map((s) => ({ label: `${s >= 0 ? "+" : ""}${fmt.bps(s)}`, value: schedule[0].interest + floatingBalance * s, emphasis: s === 0 })) });
    }
    return {
      title: "Debt schedule",
      summary: `Total debt of ${fmt.money(total)} carries a weighted average cost of ${fmt.pct(waRate, 2)} and a weighted average maturity of ${fmt.num(waMaturity, 1)} years, with ${fmt.pct(floatingShare, 0)} floating. Interest is ${fmt.money(schedule[0].interest)} in ${y0}, and ${fmt.money(sum(schedule.map((s) => s.maturities)))} of maturities fall inside the ${horizon}-year window${nextMat ? `, the first in ${nextMat.maturity}` : ""}. A 100 basis point move in the base rate changes annual interest by ${fmt.money(floatingBalance * 0.01)}.`,
      blocks,
      caveats: [
        "Floating tranches are priced at the current base rate plus spread held flat for the whole horizon; use the forward curve for a real interest forecast and note any interest-rate swap that fixes part of the floating balance.",
        "Revolver balances are held at the drawn amount rather than modeled against a seasonal working-capital swing, and commitment fees on the undrawn portion are excluded.",
        "Excludes original issue discount, debt issuance cost amortization, letters of credit, securitization facilities and any make-whole or call premium on early repayment.",
        "Interest on average balances approximates the actual accrual; a monthly or quarterly convention changes the figure slightly.",
      ],
      nextSteps: ["Test the maturity wall against the liquidity in the 13-week forecast and the revolver availability", "Price the refinancing of the nearest maturity at current spreads", "Feed the floating balance into the swap breakeven calculator"],
    };
  },
};

/** Layered FX hedge program: target ratios by tenor, incremental notional, blended rate and at-risk exposure. */
const fxHedgeLayering: ToolDef = {
  kind: "calc", id: "cf-fx-hedge-layering", title: "FX exposure & layered hedge ratio", tagline: "Policy hedge ratios by quarter, the incremental notional to trade, and the exposure still at risk.",
  description: "Takes the forecast exposure by currency and quarter and applies a layered hedging policy: the target hedge ratio for each forward quarter, the hedges already on, the incremental notional to execute, the blended rate the program locks in, and the unhedged exposure that remains at risk under an adverse move, including the EPS effect.",
  roles: ["corpfin"], specialties: [TR, FPA, IR], category: "Modeling", icon: "Globe", savesMinutes: 120, tags: ["FX", "hedging", "treasury"],
  fields: [
    { key: "csv", label: "Exposure forecast", type: "csv", required: true, columns: "currency, quarter (1 = next quarter), exposure_local (mm), spot_rate (USD per unit), forward_rate (USD per unit), hedged_local (mm, already executed)", placeholder: "currency,quarter,exposure_local,spot_rate,forward_rate,hedged_local" },
    { key: "policy", label: "Policy hedge ratios by quarter", type: "text", default: "100, 75, 50, 25, 10, 0", help: "Comma separated, quarter 1 first; the last value applies to later quarters" },
    { key: "shock", label: "Adverse move", type: "number", unit: "%", default: 10 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", default: 480 },
    { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 23 },
  ],
  example: { policy: "100, 75, 50, 25, 10, 0", shock: 10, shares: 480, tax: 23, csv: "currency,quarter,exposure_local,spot_rate,forward_rate,hedged_local\nEUR,1,240,1.08,1.085,230\nEUR,2,255,1.08,1.090,180\nEUR,3,262,1.08,1.094,120\nEUR,4,270,1.08,1.098,60\nEUR,5,280,1.08,1.102,0\nGBP,1,95,1.27,1.272,90\nGBP,2,98,1.27,1.274,70\nGBP,3,101,1.27,1.276,45\nGBP,4,104,1.27,1.278,20\nJPY,1,9800,0.0067,0.00675,8500\nJPY,2,10100,0.0067,0.00679,5000\nJPY,3,10400,0.0067,0.00683,2000\nJPY,4,10700,0.0067,0.00687,0" },
  compute: (i: Inputs): WorkflowOutput => {
    const policy = list(i, "policy").map(Number).filter(Number.isFinite).map((p) => p / 100);
    if (!policy.length) throw new Error("Enter the policy hedge ratios, for example 100, 75, 50, 25.");
    const shock = num(i, "shock") / 100, shares = num(i, "shares"), tax = num(i, "tax") / 100;
    const rows = records(str(i, "csv")).map((r) => {
      need(r, "exposure_local", "exposure_local", "exposure", "forecast_exposure", "notional");
      const q = Math.max(1, Math.round(cnum(r, "quarter", "period", "tenor", "q") || 1));
      const exposure = cnum(r, "exposure_local", "exposure", "forecast_exposure", "notional");
      const spot = cnum(r, "spot_rate", "spot", "rate");
      const fwd = cnum(r, "forward_rate", "forward", "fwd") || spot;
      const hedged = Math.min(exposure, cnum(r, "hedged_local", "hedged", "existing_hedges", "on"));
      const target = policy[Math.min(q, policy.length) - 1];
      return { ccy: (cell(r, "currency", "ccy", "pair") || "USD").toUpperCase(), q, exposure, spot, fwd, hedged, target, targetLocal: exposure * target, incremental: Math.max(0, exposure * target - hedged) };
    }).filter((r) => r.exposure > 0);
    if (!rows.length) throw new Error("Paste at least one exposure row with a positive local-currency amount.");
    if (rows.some((r) => r.spot <= 0)) throw new Error("Every row needs a positive spot_rate expressed as USD per unit of local currency.");
    const usd = (r: typeof rows[number], local: number) => local * r.spot;
    const totalUsd = sum(rows.map((r) => usd(r, r.exposure)));
    const hedgedUsd = sum(rows.map((r) => usd(r, r.hedged))), targetUsd = sum(rows.map((r) => usd(r, r.targetLocal)));
    const incrementalUsd = sum(rows.map((r) => usd(r, r.incremental)));
    const atRiskNow = sum(rows.map((r) => usd(r, r.exposure - r.hedged))) * shock;
    const atRiskTarget = sum(rows.map((r) => usd(r, r.exposure - r.targetLocal))) * shock;
    const byCcy = [...new Set(rows.map((r) => r.ccy))].map((ccy) => {
      const rs = rows.filter((r) => r.ccy === ccy);
      const exp = sum(rs.map((r) => r.exposure)), hed = sum(rs.map((r) => r.hedged)), tgt = sum(rs.map((r) => r.targetLocal));
      const blended = exp ? (sum(rs.map((r) => r.targetLocal * r.fwd)) + sum(rs.map((r) => (r.exposure - r.targetLocal) * r.spot))) / exp : 0;
      const spot = rs[0].spot;
      return { ccy, exp, hed, tgt, usd: sum(rs.map((r) => usd(r, r.exposure))), ratio: exp ? hed / exp : 0, targetRatio: exp ? tgt / exp : 0, blended, spot, pickup: exp ? blended / spot - 1 : 0 };
    }).sort((a, b) => b.usd - a.usd);
    const quarters = [...new Set(rows.map((r) => r.q))].sort((a, b) => a - b);
    const shocks = [0.05, 0.1, 0.15, 0.2];
    const ratios = [0, 0.25, 0.5, 0.75, 1];
    const grid = shocks.map((s) => ratios.map((rr) => -totalUsd * (1 - rr) * s));
    return {
      title: "FX exposure and layered hedge program",
      summary: `Forecast exposure across ${byCcy.length} currencies is ${fmt.money(totalUsd)} at spot, of which ${fmt.money(hedgedUsd)} (${fmt.pct(totalUsd ? hedgedUsd / totalUsd : 0, 0)}) is hedged today against a policy target of ${fmt.pct(totalUsd ? targetUsd / totalUsd : 0, 0)}. Executing the layers requires ${fmt.money(incrementalUsd)} of incremental notional. A ${fmt.pct(shock, 0)} adverse move costs ${fmt.money(atRiskNow)} on today's book and ${fmt.money(atRiskTarget)} once the program is at policy, or ${fmt.moneyRaw((atRiskTarget * (1 - tax)) / Math.max(shares, 1), 2)} per share.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Exposure at spot", value: fmt.money(totalUsd) },
          { label: "Hedge ratio today", value: fmt.pct(totalUsd ? hedgedUsd / totalUsd : 0, 0), delta: `policy ${fmt.pct(totalUsd ? targetUsd / totalUsd : 0, 0)}`, tone: hedgedUsd >= targetUsd ? "pos" : "warn" },
          { label: "Incremental notional to trade", value: fmt.money(incrementalUsd) },
          { label: `At risk today (${fmt.pct(shock, 0)} move)`, value: fmt.money(atRiskNow), tone: "neg" },
          { label: "At risk at policy", value: fmt.money(atRiskTarget), tone: atRiskTarget < atRiskNow ? "pos" : "neg" },
          { label: "EPS at risk at policy", value: fmt.moneyRaw((atRiskTarget * (1 - tax)) / Math.max(shares, 1), 2), hint: "After tax, per diluted share" },
        ] },
        { type: "table", title: "Layering schedule by currency and quarter", columns: ["Currency", "Quarter", "Exposure (local mm)", "Spot", "Forward", "Policy target", "Hedged (local)", "Target (local)", "Incremental to trade", "USD exposure ($mm)"],
          rows: rows.sort((a, b) => a.ccy.localeCompare(b.ccy) || a.q - b.q).map((r) => [r.ccy, `Q${r.q}`, fmt.num(r.exposure, 1), fmt.num(r.spot, 4), fmt.num(r.fwd, 4), fmt.pct(r.target, 0), fmt.num(r.hedged, 1), fmt.num(r.targetLocal, 1), fmt.num(r.incremental, 1), fmt.money(usd(r, r.exposure))]),
          totals: ["Total", "", "", "", "", fmt.pct(totalUsd ? targetUsd / totalUsd : 0, 0), "", "", fmt.money(incrementalUsd), fmt.money(totalUsd)] },
        { type: "table", title: "By currency", columns: ["Currency", "Exposure (local mm)", "USD ($mm)", "Hedged now", "At policy", "Blended rate at policy", "Pickup vs spot"],
          rows: byCcy.map((c) => [c.ccy, fmt.num(c.exp, 1), fmt.money(c.usd), fmt.pct(c.ratio, 0), fmt.pct(c.targetRatio, 0), fmt.num(c.blended, 4), fmt.pct(c.pickup, 2)]) },
        { type: "columns", title: "Policy hedge ratio by quarter", format: "pct", data: quarters.map((q) => ({ label: `Q${q}`, value: Number((policy[Math.min(q, policy.length) - 1]).toFixed(4)) })) },
        { type: "sensitivity", title: "P&L impact of an adverse move: move size × hedge ratio ($mm)", rowLabel: "Adverse move", colLabel: "Hedge ratio", rows: shocks.map((s) => fmt.pct(s, 0)), cols: ratios.map((r) => fmt.pct(r, 0)), values: grid, format: "money", baseRow: 1, baseCol: 2 },
      ],
      caveats: [
        "Rates are entered as USD per unit of local currency, so a rise is a stronger local currency. The blended rate at policy is the weighted average of the forward rate on the hedged layer and spot on the unhedged layer, which is the rate the program locks in only if spot does not move.",
        "A layered program reduces the variability of the realized rate rather than improving it: it buys predictability, and over a full cycle the cost is the forward points plus execution.",
        "Forecast accuracy sets the real hedge ratio. Hedging more than the forecast exposure creates an over-hedge that has to be marked to market, so the layered schedule should step down as forecast confidence falls.",
        "This is an economic hedge view. Hedge accounting under ASC 815 requires designation, documentation and effectiveness testing before the offset can be presented in other comprehensive income, and balance-sheet remeasurement of existing monetary items is a separate exposure from the forecast exposure modeled here.",
      ],
      nextSteps: ["Execute the incremental layers by quarter and re-run weekly as the forecast changes", "Compare the blended rate at policy with the rate embedded in the budget", "Document the policy ratios and the instrument set before trading"],
    };
  },
};

/** Fixed versus floating: the swap breakeven path, carry and present value. */
const swapBreakeven: ToolDef = {
  kind: "calc", id: "cf-swap-breakeven", title: "Interest rate swap breakeven", tagline: "What the floating index has to do for a pay-fixed swap to pay off, and the carry until it does.",
  description: "Compares paying fixed on a swap against staying floating: the all-in cost of each leg today, the negative or positive carry in year one, the average floating index that breaks even, the linear rate path required to get there, and the present value of the decision under a flat-forwards scenario.",
  roles: ["corpfin"], specialties: [TR, FPA, CTRL], category: "Modeling", icon: "Percent", savesMinutes: 60, tags: ["swap", "hedging", "interest rate"],
  fields: [
    { key: "notional", label: "Notional", type: "number", unit: "$mm", required: true, default: 1200 },
    { key: "tenor", label: "Tenor", type: "number", unit: "years", required: true, default: 5, min: 2, max: 15 },
    { key: "index", label: "Floating index today", type: "number", unit: "%", default: 4.25 },
    { key: "swapFixed", label: "Swap fixed rate", type: "number", unit: "%", default: 3.85 },
    { key: "spread", label: "Credit spread over the index", type: "number", unit: "bps", default: 225 },
    { key: "discount", label: "Discount rate", type: "number", unit: "%", default: 4 },
    { key: "hedgeShare", label: "Share of the floating balance swapped", type: "number", unit: "%", default: 100 },
  ],
  example: { notional: 1200, tenor: 5, index: 4.25, swapFixed: 3.85, spread: 225, discount: 4, hedgeShare: 100 },
  compute: (i: Inputs): WorkflowOutput => {
    const notionalAll = num(i, "notional"), share = num(i, "hedgeShare") / 100;
    const notional = notionalAll * share;
    const n = Math.round(num(i, "tenor", 5)), i0 = num(i, "index") / 100, fixed = num(i, "swapFixed") / 100;
    const spread = num(i, "spread") / 10000, r = num(i, "discount") / 100;
    if (notional <= 0) throw new Error("Notional and the swapped share must be positive.");
    if (n < 2) throw new Error("Use a tenor of at least two years so a rate path can be solved.");
    const allInFixed = fixed + spread, allInFloatToday = i0 + spread;
    const carry1 = notional * (allInFloatToday - allInFixed);
    const ramp = (2 * (fixed - i0)) / (n - 1);
    const path = Array.from({ length: n }, (_, k) => i0 + ramp * k);
    const rows = path.map((idx, k) => {
      const t = k + 1;
      const floatCost = notional * (idx + spread), fixedCost = notional * allInFixed;
      const diff = floatCost - fixedCost;
      return { t, idx, floatCost, fixedCost, diff, pv: diff / Math.pow(1 + r, t) };
    });
    const flat = Array.from({ length: n }, (_, k) => notional * (i0 - fixed) / Math.pow(1 + r, k + 1));
    const pvFlat = sum(flat), pvRamp = sum(rows.map((x) => x.pv));
    const avgFloats = [i0 - 0.01, i0 - 0.005, i0, fixed, i0 + 0.01].sort((a, b) => a - b);
    const fixeds = [fixed - 0.005, fixed - 0.0025, fixed, fixed + 0.0025, fixed + 0.005];
    const grid = avgFloats.map((af) => fixeds.map((fx) => sum(Array.from({ length: n }, (_, k) => (notional * (af - fx)) / Math.pow(1 + r, k + 1)))));
    return {
      title: "Interest rate swap breakeven",
      summary: `Paying fixed at ${fmt.pct(fixed, 2)} plus a ${fmt.bps(spread)} credit spread costs ${fmt.pct(allInFixed, 2)} all-in on ${fmt.money(notional)} of notional, against ${fmt.pct(allInFloatToday, 2)} floating today: year-one carry is ${fmt.money(carry1)}${carry1 < 0 ? " (the swap costs money to hold)" : " (the swap saves money immediately)"}. The swap breaks even if the index averages ${fmt.pct(fixed, 2)} over ${n} years, which needs a rise of ${fmt.bps(ramp)} a year from ${fmt.pct(i0, 2)} today. If the index simply stays flat, staying floating is worth ${fmt.money(pvFlat)} in present value${pvFlat > 0 ? ", so the swap is a cost paid for certainty" : ", so the swap is economically favorable on today's curve"}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "All-in fixed", value: fmt.pct(allInFixed, 2) }, { label: "All-in floating today", value: fmt.pct(allInFloatToday, 2) },
          { label: "Year-one carry", value: fmt.money(carry1), tone: tone(carry1) },
          { label: "Breakeven average index", value: fmt.pct(fixed, 2), hint: "Undiscounted: the swap rate is the breakeven average" },
          { label: "Required rise", value: `${fmt.bps(ramp)} / year`, tone: ramp > 0 ? "warn" : "pos" },
          { label: "PV, flat index", value: fmt.money(pvFlat), hint: "Positive means floating wins", tone: tone(-pvFlat) },
          { label: "Notional swapped", value: `${fmt.money(notional)} (${fmt.pct(share, 0)})` },
        ] },
        { type: "table", title: "Cost by year ($mm)", columns: ["Year", "Index on the breakeven path", "Floating all-in", "Floating cost", "Fixed cost", "Floating less fixed", "PV of the difference"],
          rows: rows.map((x) => [`Y${x.t}`, fmt.pct(x.idx, 2), fmt.pct(x.idx + spread, 2), fmt.money(x.floatCost), fmt.money(x.fixedCost), fmt.money(x.diff), fmt.money(x.pv)]),
          totals: ["Total", "", "", fmt.money(sum(rows.map((x) => x.floatCost))), fmt.money(sum(rows.map((x) => x.fixedCost))), fmt.money(sum(rows.map((x) => x.diff))), fmt.money(pvRamp)],
          note: "The breakeven path is the linear rise that makes the average index equal the swap rate; by construction the undiscounted difference nets to roughly zero and the residual PV is the discounting effect." },
        { type: "line", title: "Index paths versus the swap rate", format: "pct",
          series: [
            { name: "Breakeven path", points: rows.map((x) => ({ x: `Y${x.t}`, y: Number(x.idx.toFixed(4)) })) },
            { name: "Flat index", points: rows.map((x) => ({ x: `Y${x.t}`, y: Number(i0.toFixed(4)) })) },
            { name: "Swap fixed rate", points: rows.map((x) => ({ x: `Y${x.t}`, y: Number(fixed.toFixed(4)) })) },
          ] },
        { type: "sensitivity", title: "PV of staying floating: average index × swap rate ($mm)", rowLabel: "Average index", colLabel: "Swap fixed rate", rows: avgFloats.map((a) => fmt.pct(a, 2)), cols: fixeds.map((f) => fmt.pct(f, 2)), values: grid, format: "money", baseCol: 2 },
      ],
      caveats: [
        "The credit spread is assumed constant and applies to both legs, so it nets out of the comparison: a pay-fixed swap fixes the index, not the credit spread, and a spread widening at refinancing is unhedged.",
        "A single annual payment convention is used. Quarterly resets with day-count conventions and a compounded overnight index change the numbers modestly.",
        "Market pricing already embeds the forward curve: a swap rate below today's index means the market expects cuts, so a swap is not free money in either direction. The decision is about the value of certainty and covenant headroom, not about beating the curve.",
        "Excludes credit valuation adjustment, collateral and margin requirements, breakage cost on early termination, and hedge accounting designation under ASC 815, without which the mark to market runs through earnings.",
      ],
      nextSteps: ["Size the swap against the floating balance in the debt schedule rather than the total debt", "Test the interest coverage covenant under the unhedged rate path", "Check the hedge accounting documentation before execution"],
    };
  },
};

/** EPS accretion / dilution with sources and uses, breakeven synergies and pro forma leverage. */
const accretionDilution: ToolDef = {
  kind: "calc", id: "cf-accretion-dilution", title: "Accretion / dilution", tagline: "Offer, funding mix, synergies and EPS: accretion, breakeven synergies and pro forma leverage.",
  description: "The standard merger arithmetic: offer per share at the premium, equity and enterprise value, sources and uses under the cash and stock mix, pro forma net income after after-tax synergies, new debt interest and foregone interest on cash, pro forma EPS and accretion, the synergy level that breaks even, and pro forma leverage and coverage.",
  roles: ["corpfin", "consultant"], specialties: [CD, SF, FPA, ...CONS], category: "Modeling", icon: "Handshake", savesMinutes: 150, tags: ["M&A", "accretion", "EPS"],
  fields: [
    { key: "acqPrice", label: "Acquirer share price", type: "number", unit: "$", required: true, default: 920 },
    { key: "acqShares", label: "Acquirer diluted shares", type: "number", unit: "mm", required: true, default: 208 },
    { key: "acqNi", label: "Acquirer net income", type: "number", unit: "$mm", required: true, default: 1560 },
    { key: "acqEbitda", label: "Acquirer EBITDA", type: "number", unit: "$mm", default: 3100 },
    { key: "acqNetDebt", label: "Acquirer net debt (negative = net cash)", type: "number", unit: "$mm", default: -6200 },
    { key: "tgtPrice", label: "Target share price", type: "number", unit: "$", required: true, default: 152 },
    { key: "tgtShares", label: "Target diluted shares", type: "number", unit: "mm", required: true, default: 355 },
    { key: "tgtNi", label: "Target net income", type: "number", unit: "$mm", default: 250 },
    { key: "tgtEbitda", label: "Target EBITDA", type: "number", unit: "$mm", default: 700 },
    { key: "tgtNetDebt", label: "Target net debt", type: "number", unit: "$mm", default: -3600 },
    { key: "premium", label: "Premium", type: "number", unit: "%", default: 30 },
    { key: "cashPct", label: "Cash consideration", type: "number", unit: "%", default: 50 },
    { key: "debtFunded", label: "Cash portion funded with new debt", type: "number", unit: "%", default: 70 },
    { key: "synergies", label: "Run-rate pre-tax synergies", type: "number", unit: "$mm", default: 400 },
    { key: "newDebtRate", label: "New debt rate", type: "number", unit: "%", default: 5.5 },
    { key: "cashYield", label: "Yield on cash used", type: "number", unit: "%", default: 4 },
    { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 21 },
    { key: "feesPct", label: "Fees", type: "number", unit: "% of equity value", default: 1.5 },
  ],
  example: { acqPrice: 920, acqShares: 208, acqNi: 1560, acqEbitda: 3100, acqNetDebt: -6200, tgtPrice: 152, tgtShares: 355, tgtNi: 250, tgtEbitda: 700, tgtNetDebt: -3600, premium: 30, cashPct: 50, debtFunded: 70, synergies: 400, newDebtRate: 5.5, cashYield: 4, tax: 21, feesPct: 1.5 },
  prefill: (c) => ({
    acqPrice: c.price?.last ?? 100, acqShares: c.balance.sharesOut ?? 100, acqNi: c.ltm.netIncome ?? 0,
    acqEbitda: c.ltm.ebitda ?? c.ltm.adjEbitda ?? 0, acqNetDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0),
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const ap = num(i, "acqPrice"), as = num(i, "acqShares"), ani = num(i, "acqNi"), aeb = num(i, "acqEbitda"), and = num(i, "acqNetDebt");
    const tp = num(i, "tgtPrice"), ts = num(i, "tgtShares"), tni = num(i, "tgtNi"), teb = num(i, "tgtEbitda"), tnd = num(i, "tgtNetDebt");
    const prem = num(i, "premium") / 100, cashPct = num(i, "cashPct") / 100, dPct = num(i, "debtFunded") / 100;
    const syn = num(i, "synergies"), kd = num(i, "newDebtRate") / 100, ky = num(i, "cashYield") / 100, tax = num(i, "tax") / 100, fees = num(i, "feesPct") / 100;
    if (ap <= 0 || as <= 0 || tp <= 0 || ts <= 0) throw new Error("Prices and share counts for both companies must be positive.");
    const offer = tp * (1 + prem), equity = offer * ts, ev = equity + tnd, feeAmt = equity * fees;
    const cashCons = equity * cashPct, stockCons = equity - cashCons;
    const newShares = stockCons / ap, newDebt = (cashCons + feeAmt) * dPct, cashUsed = cashCons + feeAmt - newDebt;
    const pfShares = as + newShares, baseEps = ani / as;
    const eps = (s: number) => {
      const interest = newDebt * kd * (1 - tax), foregone = cashUsed * ky * (1 - tax);
      const pfNi = ani + tni + s * (1 - tax) - interest - foregone;
      return { pfNi, eps: pfNi / pfShares, interest, foregone };
    };
    const at = eps(syn), noSyn = eps(0);
    const breakeven = (baseEps * pfShares - ani - tni + at.interest + at.foregone) / (1 - tax);
    const pfNetDebt = and + tnd + cashCons + feeAmt, pfEbitda = aeb + teb + syn;
    const prems = [0, 0.15, prem, prem + 0.15, prem + 0.3];
    const syns = [0, syn * 0.5, syn, syn * 1.5, syn * 2];
    const grid = prems.map((p) => syns.map((s) => {
      const eq = tp * (1 + p) * ts, f = eq * fees, cc = eq * cashPct, sc = eq - cc;
      const ns = sc / ap, nd = (cc + f) * dPct, cu = cc + f - nd;
      const pfN = ani + tni + s * (1 - tax) - nd * kd * (1 - tax) - cu * ky * (1 - tax);
      return pfN / (as + ns) / baseEps - 1;
    }));
    return {
      title: "Accretion / dilution",
      summary: `At a ${fmt.pct(prem, 0)} premium the offer is ${fmt.moneyRaw(offer, 2)} per share, ${fmt.money(equity)} of equity value and ${fmt.money(ev)} of enterprise value (${fmt.x(teb ? ev / teb : null)} EV/EBITDA). Funded ${fmt.pct(cashPct, 0)} cash and ${fmt.pct(1 - cashPct, 0)} stock, pro forma EPS is ${fmt.moneyRaw(at.eps, 2)} against ${fmt.moneyRaw(baseEps, 2)} standalone, ${at.eps >= baseEps ? "accretive" : "dilutive"} by ${fmt.pct(Math.abs(at.eps / baseEps - 1))} with the full ${fmt.money(syn)} of synergies and ${fmt.pct(Math.abs(noSyn.eps / baseEps - 1))} ${noSyn.eps >= baseEps ? "accretive" : "dilutive"} without them. Breakeven synergies are ${fmt.money(breakeven)}, and pro forma net leverage is ${fmt.x(pfEbitda ? pfNetDebt / pfEbitda : null)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Offer per share", value: fmt.moneyRaw(offer, 2), delta: fmt.pct(prem, 0) }, { label: "Equity value", value: fmt.money(equity) },
          { label: "Enterprise value", value: fmt.money(ev), hint: `${fmt.x(teb ? ev / teb : null)} EV/EBITDA` },
          { label: "Pro forma EPS", value: fmt.moneyRaw(at.eps, 2), delta: fmt.pct(at.eps / baseEps - 1), tone: at.eps >= baseEps ? "pos" : "neg" },
          { label: "Accretion without synergies", value: fmt.pct(noSyn.eps / baseEps - 1), tone: noSyn.eps >= baseEps ? "pos" : "neg" },
          { label: "Breakeven synergies", value: fmt.money(breakeven), hint: `${fmt.pct(teb ? breakeven / teb : null, 0)} of target EBITDA`, tone: breakeven > syn ? "warn" : "pos" },
          { label: "New shares issued", value: `${fmt.num(newShares, 1)}mm (${fmt.pct(newShares / pfShares)})` },
          { label: "Pro forma net leverage", value: fmt.x(pfEbitda ? pfNetDebt / pfEbitda : null), delta: `from ${fmt.x(aeb ? and / aeb : null)}`, tone: pfEbitda && pfNetDebt / pfEbitda > 3 ? "warn" : "neutral" },
        ] },
        { type: "table", title: "Sources and uses ($mm)", columns: ["Uses", "Amount", "Sources", "Amount"], rows: [
          ["Equity purchase price", fmt.money(equity), "New debt", fmt.money(newDebt)],
          ["Fees and expenses", fmt.money(feeAmt), "Balance sheet cash", fmt.money(cashUsed)],
          ["", "", "Acquirer stock", fmt.money(stockCons)],
        ], totals: ["Total uses", fmt.money(equity + feeAmt), "Total sources", fmt.money(newDebt + cashUsed + stockCons)], note: "Target net debt is assumed to remain in place rather than refinanced." },
        { type: "table", title: "EPS build", columns: ["Line", "No synergies", "With run-rate synergies"], rows: [
          ["Acquirer net income ($mm)", fmt.money(ani), fmt.money(ani)],
          ["Target net income ($mm)", fmt.money(tni), fmt.money(tni)],
          ["After-tax synergies ($mm)", fmt.money(0), fmt.money(syn * (1 - tax))],
          ["Interest on new debt ($mm)", fmt.money(-at.interest), fmt.money(-at.interest)],
          ["Foregone interest on cash ($mm)", fmt.money(-at.foregone), fmt.money(-at.foregone)],
          ["Pro forma net income ($mm)", fmt.money(noSyn.pfNi), fmt.money(at.pfNi)],
          ["Pro forma diluted shares (mm)", fmt.num(pfShares, 1), fmt.num(pfShares, 1)],
          ["Pro forma EPS ($)", fmt.moneyRaw(noSyn.eps, 2), fmt.moneyRaw(at.eps, 2)],
          ["Standalone EPS ($)", fmt.moneyRaw(baseEps, 2), fmt.moneyRaw(baseEps, 2)],
          ["Accretion / (dilution)", fmt.pct(noSyn.eps / baseEps - 1), fmt.pct(at.eps / baseEps - 1)],
        ], emphasisRow: 9 },
        { type: "waterfall", title: "Pro forma net income bridge ($mm)", format: "money", steps: [
          { label: "Acquirer", value: ani, total: true }, { label: "Target", value: tni }, { label: "Synergies after tax", value: syn * (1 - tax) },
          { label: "New debt interest", value: -at.interest }, { label: "Foregone interest", value: -at.foregone }, { label: "Pro forma", value: at.pfNi, total: true },
        ] },
        { type: "sensitivity", title: "EPS accretion: premium × run-rate synergies", rowLabel: "Premium", colLabel: "Synergies ($mm)", rows: prems.map((p) => fmt.pct(p, 0)), cols: syns.map((s) => fmt.money(s)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "No purchase accounting: excludes the intangible step-up and its amortization, deferred tax effects, inventory and deferred revenue write-downs, and the write-off of the target's existing deferred revenue, all of which reduce GAAP accretion. Treat this as an adjusted-EPS view.",
        "Synergies are credited at the full run-rate with no phasing and no cost to achieve; year-one accretion is lower under any realistic phasing. Revenue synergies should be excluded from the base case.",
        "Fees are funded in the mix but excluded from pro forma earnings as a one-time cost. Retention and integration costs are not modeled.",
        "Accretion is not value creation: a stock-funded deal can be accretive simply because the acquirer trades at a higher multiple than the target.",
      ],
      nextSteps: ["Phase the synergies and add the cost to achieve before taking the numbers to the committee", "Test the pro forma leverage against covenant limits and the rating agency threshold", "Compare the implied multiple paid with trading comps and precedent transactions"],
    };
  },
};

/** Translation FX impact by currency with a hedged sensitivity grid. */
const fxSensitivity: ToolDef = {
  kind: "calc", id: "cf-fx-sensitivity", title: "FX sensitivity", tagline: "Revenue, EBITDA and EPS at spot versus budget rates, by currency, net of hedges.",
  description: "Translates the operating plan by currency at both spot and budget rates to isolate the FX effect on revenue, operating expense, EBITDA and EPS, reports the constant-currency growth adjustment, and grids the earnings impact against the size of the move and the hedge ratio.",
  roles: ["corpfin", "accountant"], specialties: [TR, FPA, IR, ...ACCT], category: "Reporting", icon: "Globe", savesMinutes: 75, tags: ["FX", "constant currency", "sensitivity"],
  fields: [
    { key: "csv", label: "Exposure by currency", type: "csv", required: true, columns: "currency, revenue_local (mm), opex_local (mm), spot_rate (USD per unit), budget_rate (USD per unit)", placeholder: "currency,revenue_local,opex_local,spot_rate,budget_rate" },
    { key: "hedgeRatio", label: "Hedge ratio on the net exposure", type: "number", unit: "%", default: 50 },
    { key: "shock", label: "Move to test", type: "number", unit: "%", default: 10 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", default: 480 },
    { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 23 },
  ],
  example: { hedgeRatio: 50, shock: 10, shares: 480, tax: 23, csv: "currency,revenue_local,opex_local,spot_rate,budget_rate\nEUR,4200,2600,1.08,1.12\nGBP,1450,780,1.27,1.29\nJPY,210000,145000,0.0067,0.0071\nCNY,6800,4900,0.1385,0.1405\nCAD,980,540,0.735,0.742\nBRL,1600,1150,0.185,0.196" },
  compute: (i: Inputs): WorkflowOutput => {
    const hedge = num(i, "hedgeRatio") / 100, shock = num(i, "shock") / 100, shares = num(i, "shares"), tax = num(i, "tax") / 100;
    const rows = records(str(i, "csv")).map((r) => {
      need(r, "revenue_local", "revenue_local", "revenue", "revenue_lc");
      const rev = cnum(r, "revenue_local", "revenue", "revenue_lc");
      const opex = cnum(r, "opex_local", "opex", "costs_local", "cost_local", "expense_local");
      const spot = cnum(r, "spot_rate", "spot", "current_rate");
      const budget = cnum(r, "budget_rate", "budget", "plan_rate", "prior_rate") || spot;
      return { ccy: (cell(r, "currency", "ccy") || "USD").toUpperCase(), rev, opex, spot, budget,
        revSpot: rev * spot, revBudget: rev * budget, opexSpot: opex * spot, opexBudget: opex * budget,
        move: budget ? spot / budget - 1 : 0 };
    }).filter((r) => r.rev > 0 || r.opex > 0);
    if (!rows.length) throw new Error("Paste at least one currency row with a revenue or opex amount.");
    if (rows.some((r) => r.spot <= 0)) throw new Error("Every row needs a positive spot_rate expressed as USD per unit of local currency.");
    const revSpot = sum(rows.map((r) => r.revSpot)), revBudget = sum(rows.map((r) => r.revBudget));
    const opexSpot = sum(rows.map((r) => r.opexSpot)), opexBudget = sum(rows.map((r) => r.opexBudget));
    const revFx = revSpot - revBudget, opexFx = opexSpot - opexBudget, ebitdaFx = revFx - opexFx;
    const hedged = ebitdaFx * (1 - hedge);
    const epsFx = (hedged * (1 - tax)) / Math.max(shares, 1);
    const detail = rows.map((r) => ({ ...r, revFx: r.revSpot - r.revBudget, ebitdaFx: r.revSpot - r.revBudget - (r.opexSpot - r.opexBudget) })).sort((a, b) => Math.abs(b.ebitdaFx) - Math.abs(a.ebitdaFx));
    const shocks = [-shock * 2, -shock, -shock / 2, shock / 2, shock, shock * 2];
    const ratios = [0, 0.25, 0.5, 0.75, 1];
    const netExposure = sum(rows.map((r) => r.revSpot - r.opexSpot));
    const grid = shocks.map((s) => ratios.map((h) => (netExposure * s * (1 - h) * (1 - tax)) / Math.max(shares, 1)));
    return {
      title: "FX sensitivity",
      summary: `At spot, revenue translates to ${fmt.money(revSpot)} against ${fmt.money(revBudget)} at budget rates, an FX effect of ${fmt.money(revFx)} (${fmt.pct(revBudget ? revFx / revBudget : 0)} of revenue). Natural offsets in local cost take the EBITDA effect to ${fmt.money(ebitdaFx)}; after a ${fmt.pct(hedge, 0)} hedge ratio the retained impact is ${fmt.money(hedged)}, or ${fmt.moneyRaw(epsFx, 2)} per diluted share. The largest single driver is ${detail[0].ccy} at ${fmt.money(detail[0].ebitdaFx)} of EBITDA.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Revenue at spot", value: fmt.money(revSpot) }, { label: "Revenue at budget rates", value: fmt.money(revBudget) },
          { label: "FX effect on revenue", value: fmt.money(revFx), tone: tone(revFx) },
          { label: "Net exposure (revenue less local cost)", value: fmt.money(netExposure) },
          { label: "FX effect on EBITDA", value: fmt.money(ebitdaFx), tone: tone(ebitdaFx), hint: "Before hedges" },
          { label: "After hedges", value: fmt.money(hedged), tone: tone(hedged) },
          { label: "EPS effect", value: fmt.moneyRaw(epsFx, 2), tone: tone(epsFx) },
          { label: "Constant-currency revenue adjustment", value: fmt.pct(revBudget ? -revFx / revBudget : 0), hint: "Add to reported growth to state it in constant currency" },
        ] },
        { type: "table", title: "By currency ($mm)", columns: ["Currency", "Revenue (local mm)", "Opex (local mm)", "Spot", "Budget", "Move vs budget", "Revenue at spot", "Revenue at budget", "FX on revenue", "FX on EBITDA"],
          rows: detail.map((r) => [r.ccy, fmt.num(r.rev, 0), fmt.num(r.opex, 0), fmt.num(r.spot, 4), fmt.num(r.budget, 4), fmt.pct(r.move, 1), fmt.money(r.revSpot), fmt.money(r.revBudget), fmt.money(r.revFx), fmt.money(r.ebitdaFx)]),
          totals: ["Total", "", "", "", "", "", fmt.money(revSpot), fmt.money(revBudget), fmt.money(revFx), fmt.money(ebitdaFx)] },
        { type: "bar", title: "FX effect on EBITDA by currency ($mm)", format: "money", data: detail.map((r, k) => ({ label: r.ccy, value: r.ebitdaFx, emphasis: k === 0 })) },
        { type: "sensitivity", title: "EPS impact: move in every rate × hedge ratio ($ per share)", rowLabel: "Move in local currencies", colLabel: "Hedge ratio", rows: shocks.map((s) => fmt.pct(s, 0)), cols: ratios.map((h) => fmt.pct(h, 0)), values: grid, format: "num", baseCol: 2 },
      ],
      caveats: [
        "Rates are USD per unit of local currency, so a positive move is a stronger local currency and a translation tailwind for revenue earned in that currency.",
        "This is translation exposure on the operating plan. Transaction exposure on monetary balances (intercompany loans, receivables and payables in a non-functional currency) remeasures through the income statement separately and is not included.",
        "The hedge ratio is applied to the net EBITDA exposure as a simple offset. A real program hedges specific forecast cash flows at specific forward rates, so the realized offset differs; use the layered hedge calculator for the schedule.",
        "Constant currency here restates the current period at budget rates. Companies more commonly restate at prior-period rates, which gives a different number, so label the convention in any external disclosure.",
      ],
      nextSteps: ["Recompute at the rates in force at the guidance date to isolate the guidance FX headwind", "Feed the net exposure by currency into the layered hedge schedule", "Report the constant-currency adjustment in the earnings script and the board pack"],
    };
  },
};

/** Forecast accuracy scorecard: MAPE, bias and hit rate by line and by period. */
const forecastAccuracy: ToolDef = {
  kind: "calc", id: "cf-forecast-accuracy", title: "Forecast accuracy scorecard", tagline: "MAPE, bias and hit rate by line and period, so chronic optimism shows up by name.",
  description: "Scores forecast quality from a history of forecast and actual pairs: mean absolute percentage error, signed bias, the share of periods inside tolerance, and the worst period for each line. Separates random error from systematic bias, which is the number that tells you which lines to adjust before the next cycle.",
  roles: ["corpfin"], specialties: [FPA, SF, IR, CTRL], category: "Planning & forecasting", icon: "Target", savesMinutes: 60, tags: ["accuracy", "MAPE", "bias"],
  fields: [
    { key: "csv", label: "Forecast versus actual history", type: "csv", required: true, columns: "period, line, forecast, actual", placeholder: "period,line,forecast,actual" },
    { key: "tolerance", label: "Tolerance", type: "number", unit: "%", default: 5 },
  ],
  example: { tolerance: 5, csv: "period,line,forecast,actual\nQ1 FY25,Revenue,31200,30400\nQ2 FY25,Revenue,32500,31900\nQ3 FY25,Revenue,34000,33100\nQ4 FY25,Revenue,36500,35200\nQ1 FY26,Revenue,37000,36800\nQ2 FY26,Revenue,38500,38100\nQ1 FY25,Gross margin,22400,22100\nQ2 FY25,Gross margin,23100,22800\nQ3 FY25,Gross margin,24200,23600\nQ4 FY25,Gross margin,26000,25100\nQ1 FY26,Gross margin,26300,26200\nQ2 FY26,Gross margin,27400,27100\nQ1 FY25,S&M,9800,10400\nQ2 FY25,S&M,10100,10900\nQ3 FY25,S&M,10400,11200\nQ4 FY25,S&M,11000,11900\nQ1 FY26,S&M,11200,11600\nQ2 FY26,S&M,11500,12300\nQ1 FY25,Capex,2100,1400\nQ2 FY25,Capex,2300,1600\nQ3 FY25,Capex,2400,1500\nQ4 FY25,Capex,2600,2100\nQ1 FY26,Capex,2500,1700\nQ2 FY26,Capex,2700,1900" },
  compute: (i: Inputs): WorkflowOutput => {
    const tol = num(i, "tolerance", 5) / 100;
    const obs = records(str(i, "csv")).map((r) => {
      need(r, "forecast", "forecast", "plan", "budget", "forecast_amount");
      const f = cnum(r, "forecast", "plan", "budget", "forecast_amount"), a = cnum(r, "actual", "actuals", "actual_amount");
      return { period: cell(r, "period", "month", "quarter", "date") || "n/a", line: cell(r, "line", "account", "metric", "item") || "Total", f, a, err: f ? a / f - 1 : 0 };
    }).filter((o) => o.f !== 0);
    if (!obs.length) throw new Error("No usable rows: each row needs a period, a line, a non-zero forecast and an actual.");
    const periods = [...new Set(obs.map((o) => o.period))];
    const byLine = [...new Set(obs.map((o) => o.line))].map((line) => {
      const rs = obs.filter((o) => o.line === line);
      const mape = sum(rs.map((o) => Math.abs(o.err))) / rs.length;
      const bias = sum(rs.map((o) => o.err)) / rs.length;
      const hit = rs.filter((o) => Math.abs(o.err) <= tol).length / rs.length;
      const worst = rs.reduce((a, b) => (Math.abs(b.err) > Math.abs(a.err) ? b : a));
      const dollarMape = sum(rs.map((o) => Math.abs(o.a - o.f))) / sum(rs.map((o) => Math.abs(o.f)));
      return { line, n: rs.length, mape, medianAbs: median(rs.map((o) => Math.abs(o.err))) ?? 0, bias, hit, worst, dollarMape, dollarErr: sum(rs.map((o) => o.a - o.f)) };
    }).sort((a, b) => b.mape - a.mape);
    const byPeriod = periods.map((p) => {
      const rs = obs.filter((o) => o.period === p);
      return { period: p, bias: sum(rs.map((o) => o.err)) / rs.length, mape: sum(rs.map((o) => Math.abs(o.err))) / rs.length };
    });
    const overall = sum(obs.map((o) => Math.abs(o.err))) / obs.length;
    const overallBias = sum(obs.map((o) => o.err)) / obs.length;
    const dollarOverall = sum(obs.map((o) => Math.abs(o.a - o.f))) / sum(obs.map((o) => Math.abs(o.f)));
    const chronic = byLine.filter((l) => Math.abs(l.bias) > tol && l.n >= 3);
    const read = (l: (typeof byLine)[number]) => (Math.abs(l.bias) <= tol / 2 ? "Unbiased" : l.bias > 0 ? "Systematically under-forecast" : "Systematically over-forecast");
    return {
      title: "Forecast accuracy scorecard",
      summary: `Across ${obs.length} forecast-actual pairs covering ${byLine.length} lines and ${periods.length} periods, MAPE is ${fmt.pct(overall)} and the signed bias is ${fmt.pct(overallBias)}, with ${fmt.pct(obs.filter((o) => Math.abs(o.err) <= tol).length / obs.length, 0)} of observations inside the ${fmt.pct(tol, 0)} tolerance. ${chronic.length ? `${chronic.length} line${chronic.length > 1 ? "s show" : " shows"} systematic bias beyond tolerance: ${chronic.map((c) => `${c.line} (${fmt.pct(c.bias)})`).join(", ")}. Adjust those lines before the next cycle rather than tightening the process everywhere.` : "No line shows systematic bias beyond tolerance, so the remaining error is dispersion rather than optimism."}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Observations", value: fmt.int(obs.length) }, { label: "MAPE", value: fmt.pct(overall), tone: overall <= tol ? "pos" : overall <= tol * 2 ? "warn" : "neg" },
          { label: "Dollar-weighted error", value: fmt.pct(dollarOverall) },
          { label: "Bias", value: fmt.pct(overallBias), tone: Math.abs(overallBias) <= tol / 2 ? "pos" : "warn", hint: "Positive means actuals come in above forecast" },
          { label: "Inside tolerance", value: fmt.pct(obs.filter((o) => Math.abs(o.err) <= tol).length / obs.length, 0) },
          { label: "Worst line", value: `${byLine[0].line} (${fmt.pct(byLine[0].mape)})`, tone: "neg" },
          { label: "Chronically biased lines", value: fmt.int(chronic.length), tone: chronic.length ? "warn" : "pos" },
        ] },
        { type: "table", title: "By line", columns: ["Line", "Observations", "MAPE", "Median absolute error", "Bias", "Dollar error", "Inside tolerance", "Worst period", "Read"],
          rows: byLine.map((l) => [l.line, fmt.int(l.n), fmt.pct(l.mape), fmt.pct(l.medianAbs), fmt.pct(l.bias), fmt.num(l.dollarErr, 0), fmt.pct(l.hit, 0), `${l.worst.period} (${fmt.pct(l.worst.err)})`, read(l)]),
          totals: ["All lines", fmt.int(obs.length), fmt.pct(overall), "", fmt.pct(overallBias), fmt.num(sum(obs.map((o) => o.a - o.f)), 0), fmt.pct(obs.filter((o) => Math.abs(o.err) <= tol).length / obs.length, 0), "", ""],
          note: "Error = actual / forecast − 1. MAPE is the mean of absolute errors; bias is the mean of signed errors, so a line can have a high MAPE with no bias (noisy) or a low MAPE with persistent bias (systematically wrong in one direction)." },
        { type: "line", title: "Bias and MAPE by period", format: "pct", series: [
          { name: "Bias", points: byPeriod.map((p) => ({ x: p.period, y: Number(p.bias.toFixed(4)) })) },
          { name: "MAPE", points: byPeriod.map((p) => ({ x: p.period, y: Number(p.mape.toFixed(4)) })) },
        ] },
        { type: "bar", title: "MAPE by line", format: "pct", reference: { value: tol, label: "Tolerance" }, data: byLine.map((l, k) => ({ label: l.line, value: l.mape, emphasis: k === 0, note: read(l) })) },
      ],
      caveats: [
        "Percentage error uses the forecast as the denominator, so lines forecast near zero produce large percentages: read those against the dollar error column instead.",
        "Bias is only meaningful with enough observations; lines with fewer than three pairs are reported but should not drive a process change.",
        "The scorecard measures the forecast in force at the time, so it mixes horizons. Tag the pairs by horizon (one month out, one quarter out) to separate forecasting skill from late-breaking news.",
        "Accuracy is not the only objective: a line that is deliberately conservative for target-setting will show bias by design, and that is a policy choice to state rather than an error to fix.",
      ],
      nextSteps: ["Adjust the chronically biased lines by their measured bias in the next reforecast", "Assign each line an owner and report accuracy in the monthly review", "Split the error by horizon to see whether the process or the information is the constraint"],
    };
  },
};

/** Capital allocation: NPV, IRR, payback and profitability index ranked under a budget constraint. */
const capitalAllocation: ToolDef = {
  kind: "calc", id: "cf-capital-allocation", title: "Capital allocation ranking", tagline: "NPV, IRR, payback and profitability index by project, funded greedily against the budget.",
  description: "Ranks capital requests on the standard measures: net present value at the hurdle rate, internal rate of return solved by bisection, simple and discounted payback, and the profitability index that governs allocation under a hard budget. Funds projects in index order until the budget is exhausted and reports what the constraint costs in foregone NPV.",
  roles: ["corpfin", "consultant"], specialties: [FPA, SF, CD, TR, ...CONS], category: "Modeling", icon: "Compass", savesMinutes: 120, tags: ["capital allocation", "NPV", "IRR"],
  fields: [
    { key: "csv", label: "Project requests", type: "csv", required: true, columns: "project, category, investment ($mm), flows (space-separated annual cash flows, $mm), strategic_score (1-5, optional)", placeholder: "project,category,investment,flows,strategic_score" },
    { key: "hurdle", label: "Hurdle rate", type: "number", unit: "%", default: 11 },
    { key: "budget", label: "Capital budget", type: "number", unit: "$mm", default: 900 },
  ],
  example: { hurdle: 11, budget: 900, csv: "project,category,investment,flows,strategic_score\nCapacity expansion - Ohio,Growth,340,45 82 105 118 124 124 124,4\nERP replacement,Infrastructure,210,-15 35 62 78 82 82 82,3\nAutomation - line 4,Cost reduction,95,26 31 33 34 34 34 34,3\nNew product tooling,Growth,150,10 48 72 84 84 84,5\nDistribution center,Growth,260,30 62 84 92 96 96 96,4\nFleet electrification,Sustainability,120,14 22 28 31 33 33 33,2\nData center refresh,Infrastructure,80,18 24 26 27 27 27,3\nR&D lab expansion,Growth,110,0 18 42 58 62 64 64,5" },
  compute: (i: Inputs): WorkflowOutput => {
    const hurdle = num(i, "hurdle") / 100, budget = num(i, "budget");
    const projects = records(str(i, "csv")).map((r) => {
      need(r, "investment", "investment", "capex", "outlay", "cost");
      const inv = cnum(r, "investment", "capex", "outlay", "cost");
      const flows = (cell(r, "flows", "cash_flows", "cashflows", "cf") || "").split(/[\s;|]+/).map(Number).filter((x) => Number.isFinite(x));
      return { name: cell(r, "project", "name", "request", "initiative") || "Project", cat: cell(r, "category", "type", "bucket") || "Uncategorized", inv, flows, strategic: cnum(r, "strategic_score", "strategic", "score", "fit") };
    }).filter((p) => p.inv > 0);
    if (!projects.length) throw new Error("Paste at least one project with a positive investment.");
    if (projects.some((p) => p.flows.length === 0)) throw new Error("Every project needs a flows column: annual cash flows separated by spaces, for example \"45 82 105 118\".");
    const scored = projects.map((p) => {
      const pv = sum(p.flows.map((cf, k) => cf / Math.pow(1 + hurdle, k + 1)));
      const npv = pv - p.inv;
      const irr = irrOf([-p.inv, ...p.flows]);
      let cum = -p.inv, payback: number | null = null, dcum = -p.inv, dpay: number | null = null;
      p.flows.forEach((cf, k) => {
        const prev = cum; cum += cf;
        if (payback === null && cum >= 0) payback = k + (cf ? -prev / cf : 0);
        const d = cf / Math.pow(1 + hurdle, k + 1), dprev = dcum; dcum += d;
        if (dpay === null && dcum >= 0) dpay = k + (d ? -dprev / d : 0);
      });
      return { ...p, npv, pi: pv / p.inv, irr, payback: payback as number | null, dpay: dpay as number | null };
    }).sort((a, b) => b.pi - a.pi);
    let spend = 0;
    const funded = scored.map((p) => {
      const ok = p.npv > 0 && spend + p.inv <= budget;
      if (ok) spend += p.inv;
      return { ...p, funded: ok, reason: p.npv <= 0 ? `Below hurdle (IRR ${fmt.pct(p.irr)})` : ok ? "Funded" : "Budget exhausted" };
    });
    const requested = sum(scored.map((p) => p.inv));
    const fundedNpv = sum(funded.filter((p) => p.funded).map((p) => p.npv));
    const foregone = sum(funded.filter((p) => !p.funded && p.npv > 0).map((p) => p.npv));
    const portfolioFlows = Array.from({ length: Math.max(...funded.filter((p) => p.funded).map((p) => p.flows.length), 1) }, (_, k) => sum(funded.filter((p) => p.funded).map((p) => p.flows[k] ?? 0)));
    const portfolioIrr = irrOf([-spend, ...portfolioFlows]);
    const strategicConflict = funded.filter((p) => !p.funded && p.strategic >= 4 && p.npv > 0);
    return {
      title: "Capital allocation ranking",
      summary: `${scored.length} requests total ${fmt.money(requested)} against a ${fmt.money(budget)} budget. Ranking by profitability index and funding in order fills ${fmt.money(spend)} across ${funded.filter((p) => p.funded).length} projects, delivering ${fmt.money(fundedNpv)} of NPV at a ${fmt.pct(portfolioIrr)} portfolio IRR. ${funded.filter((p) => p.npv <= 0).length} project${funded.filter((p) => p.npv <= 0).length === 1 ? "" : "s"} fail the ${fmt.pct(hurdle, 0)} hurdle outright, and the budget constraint leaves ${fmt.money(foregone)} of positive NPV unfunded.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Requests", value: `${scored.length} totalling ${fmt.money(requested)}` }, { label: "Budget", value: fmt.money(budget) },
          { label: "Funded", value: `${funded.filter((p) => p.funded).length} for ${fmt.money(spend)}` },
          { label: "NPV funded", value: fmt.money(fundedNpv), tone: "pos" },
          { label: "Portfolio IRR", value: fmt.pct(portfolioIrr), tone: portfolioIrr !== null && portfolioIrr > hurdle ? "pos" : "warn" },
          { label: "NPV left on the table", value: fmt.money(foregone), tone: foregone > 0 ? "warn" : "pos" },
          { label: "Below hurdle", value: fmt.int(funded.filter((p) => p.npv <= 0).length), tone: "neg" },
        ] },
        { type: "table", title: "Ranked requests", columns: ["Rank", "Project", "Category", "Investment", "NPV", "IRR", "PI", "Payback (yrs)", "Discounted payback", "Strategic", "Decision"],
          rows: funded.map((p, k) => [k + 1, p.name, p.cat, fmt.money(p.inv), fmt.money(p.npv), fmt.pct(p.irr), p.pi.toFixed(2), p.payback === null ? "beyond horizon" : fmt.num(p.payback, 1), p.dpay === null ? "beyond horizon" : fmt.num(p.dpay, 1), p.strategic ? `${fmt.num(p.strategic, 0)}/5` : "—", p.reason]),
          totals: ["", "Total", "", fmt.money(requested), fmt.money(sum(funded.map((p) => p.npv))), "", "", "", "", "", `${fmt.money(spend)} funded`],
          note: `Profitability index = present value of inflows / investment, which is the correct ranking metric under a hard capital budget. Discounted at the ${fmt.pct(hurdle, 0)} hurdle rate; IRR solved by bisection.` },
        { type: "bar", title: "NPV by project ($mm)", format: "money", data: funded.map((p) => ({ label: p.name, value: p.npv, emphasis: p.funded, note: p.funded ? "Funded" : p.reason })) },
        { type: "scatter", title: "Return versus size", xLabel: "Investment ($mm)", yLabel: "IRR", xFormat: "money", yFormat: "pct",
          points: funded.map((p) => ({ label: p.name, x: p.inv, y: p.irr, emphasis: p.funded })) },
        { type: "columns", title: "Cumulative investment in rank order ($mm)", format: "money",
          data: funded.map((p, k) => ({ label: `${k + 1}. ${p.name}`, value: sum(funded.slice(0, k + 1).map((x) => x.inv)) })) },
      ],
      caveats: [
        "Cash flows are taken as given and assumed to occur at year end with the investment at time zero; a mid-year convention or a multi-year build changes both NPV and payback.",
        "The profitability index is the right ranking rule for a one-period budget constraint but ignores project interdependence, mandatory spend (safety, compliance, maintenance) and optionality. Ring-fence mandatory projects before ranking.",
        "A single hurdle rate is applied to every project. In practice the hurdle should carry a project-risk premium over WACC, and companies keep hurdle rates sticky and above WACC, which biases against long-dated projects.",
        "IRR is unreliable for flows that change sign more than once and is not reported where no rate solves the equation. Strategic scores are the user's input and are shown alongside the financials rather than blended into the ranking.",
      ],
      nextSteps: ["Ring-fence mandatory and compliance spend, then re-rank the discretionary pool", "Re-run at a hurdle rate built from the WACC calculator plus a project risk premium",
        strategicConflict.length ? `Take the strategically important projects the budget crowded out to the CFO as a budget decision: ${strategicConflict.map((p) => `${p.name} (NPV ${fmt.money(p.npv)}, strategic ${fmt.num(p.strategic, 0)}/5)`).join(", ")}` : "No strategically important project was crowded out, so the budget constraint is not costing strategy"],
    };
  },
};

export const CORPFIN_PACK: ToolDef[] = [
  // FP&A and strategic finance
  peerBenchmarkInternal, varianceCommentary, pvmNarrative, driverForecastStudio, rollingReforecast, closeFluxPack, boardDeckNarrative, saasBoardPack,
  // Investor relations
  guidanceVsConsensus, earningsQaBank, earningsScript, earningsRelease, investorTargeting, irDisclosureBenchmark, kpiNonGaap,
  // Treasury
  thirteenWeekCopilot, covenantCertificate, workingCapitalPeers, cashPooling, bankRfpScorecard,
  // Corporate development
  targetScreener, targetOnePager, synergyAccretionMemo, integration100Day, synergyTracker,
  // Calculators
  pvmBridge, covenantHeadroom, cashConversionCycle, headcountPlan, buybackVsDividend, debtSchedule, fxHedgeLayering, swapBreakeven, accretionDilution, fxSensitivity, forecastAccuracy, capitalAllocation,
];
