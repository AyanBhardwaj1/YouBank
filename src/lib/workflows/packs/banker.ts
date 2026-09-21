/**
 * Investment banking tool pack: M&A and sector coverage, restructuring, leveraged finance, ECM and DCM.
 * Authored from docs/research/banker-ma-coverage.md, banker-restructuring.md and banker-capital-markets.md.
 * Conventions: USD millions unless a field says otherwise; percent inputs are whole numbers (25 = 25%).
 */
import { bool, fmt, list, num, parseCsv, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* ---------------- specialty groups (strings must match roles.ts verbatim) ---------------- */
const COV = ["Technology M&A", "M&A (generalist)", "Healthcare", "Energy & power", "FIG", "Consumer & retail", "Industrials", "Media & telecom", "Real estate & gaming"];
const SPON = "Financial sponsors";
const LEV = "Leveraged finance";
const RX = "Restructuring";
const DESKS = [LEV, "ECM", "DCM", SPON];

/* ---------------- shared numeric helpers ---------------- */
/** Root of f on [lo, hi] by bisection: used for yields and IRRs. */
const solve = (f: (x: number) => number, lo: number, hi: number, iter = 200): number => {
  let a = lo, b = hi;
  const fa = f(a);
  for (let k = 0; k < iter; k++) { const m = (a + b) / 2; if (fa * f(m) <= 0) b = m; else a = m; }
  return (a + b) / 2;
};
/** Standard normal CDF (Abramowitz-Stegun 7.1.26). */
const N = (x: number): number => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const p = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const c = 1 - (Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI)) * p;
  return x >= 0 ? c : 1 - c;
};
/** Black-Scholes call with a continuous dividend yield. */
const bsCall = (s: number, k: number, t: number, vol: number, r: number, q: number): number => {
  if (t <= 0 || vol <= 0) return Math.max(0, s - k);
  const d1 = (Math.log(s / k) + (r - q + (vol * vol) / 2) * t) / (vol * Math.sqrt(t));
  return s * Math.exp(-q * t) * N(d1) - k * Math.exp(-r * t) * N(d1 - vol * Math.sqrt(t));
};
const median = (xs: number[]): number => { const v = [...xs].sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : 0; };
const nums = (i: Inputs, key: string): number[] => list(i, key).map(Number).filter((x) => Number.isFinite(x));

/* ======================================================================================
 * M&A and sector coverage: AI workflows
 * ====================================================================================== */

const MA_WORKFLOWS: ToolDef[] = [
  {
    kind: "ai", id: "ma-pitch-page", title: "Pitch page & PIB builder", tagline: "The company page every pitch book opens with, plus the public information binder behind it.",
    description: "Builds the standard coverage page for a pitch or board book: situation overview, financial snapshot with the last eight quarters, capitalization and EV bridge, dated recent developments from 8-K item codes, and the angle. In PIB mode it also indexes the filings a banker would print for the binder.",
    roles: ["banker"], specialties: [...COV, SPON], category: "Deliverables", icon: "Presentation", deliverable: "deck", savesMinutes: 150, tags: ["pitch", "PIB", "coverage"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "SNOW" },
      { key: "page", label: "Page", type: "select", options: ["Company profile page", "Situation overview", "Public information book (index + summaries)", "Board strategic alternatives"], default: "Company profile page" },
      { key: "angle", label: "Our angle", type: "text", placeholder: "e.g. sell-side readiness, sponsor take-private, carve-out of the data business" },
    ],
    example: { ticker: "SNOW", page: "Company profile page", angle: "sponsor take-private feasibility and consumption-model durability" },
    effort: "medium",
    instructions: `1. get_company_financials for the ticker. 2. get_recent_filings with forms ["8-K","10-Q","10-K","DEF 14A","SC 13D"] limit 25 and note item codes (1.01 material agreement, 2.01 completed acquisition, 2.02 results, 2.03 debt incurred, 5.02 officer change, 7.01/8.01 other). 3. search_filing on the 10-K for "our business", "competition" and "segment", and on the 10-Q for "outlook" or "guidance" plus the company's headline KPI (ARR, net revenue retention, RPO, backlog, RevPAR, production, CET1). 4. get_trading_comps for valuation context. 5. calc every multiple and the EV bridge (equity value + debt + preferred + NCI - cash).
Produce: kpis (price, market cap, EV, LTM revenue and growth, EBITDA margin, EV/LTM revenue or the sector-standard multiple, net debt/EBITDA); markdown "Situation overview" (5-7 sentences ending in why now); table "Financial snapshot" (LTM revenue, gross profit, EBITDA, FCF with margins, plus the last 4-8 quarters of revenue); table "Capitalization" as the EV bridge with each component sourced; bullets "Recent developments" dated with the 8-K item code; bullets "Our angle" written to the angle field; risks (3). In PIB mode add a timeline of the filings in the binder with one line on what each contains. Never state an NTM consensus figure: estimates are not in the data set, so say so in caveats.`,
    prompt: (i) => `Build the ${str(i, "page", "company profile page").toLowerCase()} for ${str(i, "ticker").toUpperCase()}.${str(i, "angle") ? ` Our angle: ${str(i, "angle")}.` : ""}`,
  },
  {
    kind: "ai", id: "ma-buyer-list", title: "Buyer list with ability-to-pay", tagline: "Tiered strategic and sponsor buyers, each with a rationale and what they can actually pay.",
    description: "Builds the sell-side buyer list every pitch needs: strategics and sponsors tiered by fit, with a one-line strategic rationale, prior acquisitions found in EDGAR, and an ability-to-pay test from each buyer's cash, revolver availability and leverage headroom. Sponsor capacity is flagged as web-sourced because dry powder is licensed data.",
    roles: ["banker"], specialties: [...COV, SPON], category: "Sourcing & deals", icon: "Users", deliverable: "table", savesMinutes: 240, tags: ["buyer list", "sell-side", "ability to pay"],
    fields: [
      { key: "ticker", label: "Target (if public)", type: "ticker", placeholder: "DDOG" },
      { key: "profile", label: "Target profile", type: "text", required: true, placeholder: "e.g. $2.5B revenue observability software, 25% growth, 78% gross margin" },
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "observability monitoring cloud software" },
      { key: "count", label: "Buyers to list", type: "number", default: 12, min: 5, max: 25 },
      { key: "sponsors", label: "Include sponsors", type: "toggle", default: true },
    ],
    example: { ticker: "DDOG", profile: "US-listed observability software, ~$3B revenue, 25% growth, 80% gross margin, net cash", sector: "observability monitoring cloud software", count: 12, sponsors: true },
    effort: "high",
    instructions: `1. If a target ticker is given, get_company_financials for size and multiple context. 2. Propose buyers in three tiers: Tier 1 direct strategics (same buyer universe, clear product logic), Tier 2 adjacent strategics and platform consolidators, Tier 3 sponsors (name the fund and the platform asset the target would bolt onto). Use search_companies to confirm tickers. 3. For every listed strategic call get_company_financials and compute with calc: cash and short-term investments, LTM EBITDA, existing net debt, leverage headroom to 3.0x pro forma net debt/EBITDA, and max cash consideration = cash above a stated operating minimum + incremental debt to 3.0x. State the assumption. 4. Evidence of appetite: edgar_fulltext_search with forms ["8-K","DEFM14A","S-4"] and the phrase "agreement and plan of merger" plus the buyer name, to list its last deals with dates. 5. For sponsors use web_research for fund size, vintage and dry powder and label it web-sourced; use search_startups or form_d_search only for private platform assets.
Produce: kpis (buyers listed, strategics versus sponsors, how many can pay a control price for the target's EV, median leverage headroom); table "Buyer list" with columns Buyer, Type, Tier, Strategic rationale, Prior deals, Cash ($mm), Leverage headroom ($mm), Max cash ability-to-pay ($mm), Accretive at a 30% premium?, Source; bar of ability-to-pay by buyer with a reference line at the target's EV; bullets "Outreach sequencing" (who to call first and why); caveats on sponsor data, undisclosed appetite, and the fact that ability-to-pay is not willingness to pay.`,
    prompt: (i) => `Build a tiered buyer list of ${num(i, "count", 12)} names${bool(i, "sponsors", true) ? " including sponsors" : ", strategics only"} for: ${str(i, "profile")}${str(i, "ticker") ? ` (${str(i, "ticker").toUpperCase()})` : ""}. Sector keywords: ${str(i, "sector")}.`,
  },
  {
    kind: "ai", id: "ma-target-screen", title: "Target list & acquisition screen", tagline: "Buy-side long list to short list, scored on fit, multiple and affordability.",
    description: "Runs the buy-side screen: builds a long list against the client's acquisition criteria, narrows to a short list with a fit score, and tests each name for affordability (EPS accretion tolerance and leverage headroom) so the pitch leads with three actionable targets rather than fifty names.",
    roles: ["banker", "corpfin", "pe"], category: "Screening", icon: "Radar", deliverable: "table", savesMinutes: 210, tags: ["buy-side", "screen", "corp dev"],
    fields: [
      { key: "acquirer", label: "Acquirer", type: "ticker", required: true, placeholder: "XOM" },
      { key: "criteria", label: "Acquisition criteria", type: "textarea", required: true, placeholder: "e.g. Permian-weighted E&P, 50-150 mboe/d, contiguous acreage, EV $2-10B, accretive to CFPS in year 1" },
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "Permian Delaware oil gas exploration production" },
      { key: "count", label: "Short list size", type: "number", default: 8, min: 3, max: 15 },
    ],
    example: { acquirer: "XOM", criteria: "Permian-weighted US E&P, 50-150 mboe/d, contiguous Delaware or Midland acreage, EV $2-12B, accretive to CFPS and FCF per share in year 1, no dilution to the dividend", sector: "Permian Delaware Midland oil gas exploration production", count: 8 },
    effort: "high",
    instructions: `1. get_company_financials for the acquirer: scale, multiple, net debt, cash, earnings base. 2. Build the long list with search_companies on sector keywords and get_trading_comps on any peer group that contains candidates; keep every name that meets the size and profile screen and say how many you rejected and why. 3. For each short-list name pull get_company_financials and, when the criteria reference a sector KPI, search_filing on its 10-K for the driver ("proved reserves", "boe per day", "annual recurring revenue", "backlog", "same-store sales", "common equity tier 1"). 4. Score each target 0-100 on strategic fit, financial fit (growth, margin and multiple versus the acquirer), affordability and executability (regulatory, holder concentration, family or sponsor control from the DEF 14A). 5. Affordability with calc: target EV at a 30% premium versus acquirer capacity (cash + debt to 3.0x pro forma), and a first-pass accretion test - all-stock is accretive when the acquirer's P/E exceeds the target's, all-cash when the target's after-tax earnings yield exceeds the after-tax cost of debt.
Produce: kpis (long list size, short list size, median target EV/EBITDA, how many are affordable in cash); score block for the short list; table "Short list" (Target, EV, EV/EBITDA, growth, strategic fit, affordability, accretive?, control/ownership, next step); scatter of growth versus EV/EBITDA with the acquirer emphasized; bullets "Top three and the approach"; caveats on private targets (not in EDGAR) and on synergies not yet tested.`,
    prompt: (i) => `Screen acquisition targets for ${str(i, "acquirer").toUpperCase()} and give me a short list of ${num(i, "count", 8)}. Criteria: ${str(i, "criteria")}. Sector keywords: ${str(i, "sector")}.`,
  },
  {
    kind: "ai", id: "ma-football-field", title: "Football field assembler", tagline: "Every valuation method on one page, with the offer price as the line to beat.",
    description: "Assembles the valuation summary page: 52-week trading range, trading comps at the 25th and 75th percentiles, precedent transactions, DCF at a WACC band, and an LBO ability-to-pay at sponsor hurdle returns, each as a low-high range with the basis stated and the offer price drawn across it.",
    roles: ["banker", "pe"], specialties: [...COV, RX, "ECM"], category: "Valuation", icon: "BarChart3", deliverable: "analysis", savesMinutes: 180, tags: ["football field", "valuation", "board deck"],
    fields: [
      { key: "ticker", label: "Target", type: "ticker", required: true, placeholder: "WBD" },
      { key: "offer", label: "Offer / reference price per share", type: "number", unit: "$", placeholder: "30" },
      { key: "methods", label: "Methods", type: "multiselect", options: ["52-week range", "Trading comps", "Precedent transactions", "DCF", "LBO ability-to-pay", "Research price targets", "SOTP"], default: ["52-week range", "Trading comps", "Precedent transactions", "DCF", "LBO ability-to-pay"] },
      { key: "wacc", label: "WACC band", type: "text", default: "9-11%" },
    ],
    example: { ticker: "WBD", offer: 30, methods: ["52-week range", "Trading comps", "Precedent transactions", "DCF", "LBO ability-to-pay", "SOTP"], wacc: "8-10%" },
    effort: "high",
    instructions: `1. get_company_financials for price, 52-week high and low, LTM metrics, net debt and diluted shares. 2. get_trading_comps for the peer set; take the 25th and 75th percentile of the sector-standard multiple (EV/revenue for software, EV/EBITDA for most, P/TBV for banks, P/FFO for REITs, EV/EBITDAX for E&P) and apply it to the target's LTM metric with calc for an implied per-share range. 3. Precedents: edgar_fulltext_search with forms ["DEFM14A","8-K","S-4"] and "agreement and plan of merger" plus sector keywords; use the 25th-75th percentile of EV/EBITDA across the deals you can verify. 4. DCF: run the range at the WACC band with 2-3% perpetuity growth and cross-check the implied exit multiple; terminal value is normally 60-80% of EV, so flag it if it is not. 5. LBO ability-to-pay: solve the entry price that clears a 20-25% IRR with 5.0-6.0x total leverage over a 5-year hold. 6. Research targets only if web_research returns dated published targets.
Produce: kpis (offer price, premium to the unaffected price, where the offer sits versus each range); table "Valuation summary" (Method, Low, High, Midpoint, Implied multiple, Basis); bar of method midpoints with a reference line at the offer price; markdown "Where the value is" (which methods drive the range and why they disagree); caveats (no consensus NTM estimates available, comps not calendarized unless you did so, LBO assumes market leverage).`,
    prompt: (i) => `Assemble a football field for ${str(i, "ticker").toUpperCase()} using ${list(i, "methods").join(", ") || "every standard method"}${num(i, "offer") ? ` against an offer of $${num(i, "offer")} per share` : ""}. WACC band ${str(i, "wacc", "9-11%")}.`,
  },
  {
    kind: "ai", id: "ma-merger-proxy-miner", title: "Merger proxy miner", tagline: "Background of the merger, fairness ranges, adviser fees and projections out of a DEFM14A.",
    description: "Reads a target's merger proxy or S-4 and extracts what bankers use it for: the dated background-of-the-merger narrative, every valuation analysis the financial adviser ran with its implied per-share range, the adviser's fee and contingent portion, management's projections, and the deal protection terms.",
    roles: ["banker", "pe", "markets", "corpfin", "student"], category: "Diligence", icon: "FileSearch", deliverable: "analysis", savesMinutes: 240, tags: ["DEFM14A", "fairness opinion", "process"],
    fields: [
      { key: "ticker", label: "Target ticker", type: "ticker", placeholder: "JNPR" },
      { key: "deal", label: "Deal (if no ticker)", type: "text", placeholder: "e.g. Penumbra / Boston Scientific" },
      { key: "aspects", label: "Extract", type: "multiselect", options: ["Background of the merger", "Fairness opinion analyses", "Adviser fees", "Management projections", "Deal protection", "Treatment of equity awards", "Golden parachutes"], default: ["Background of the merger", "Fairness opinion analyses", "Adviser fees", "Management projections", "Deal protection"] },
    ],
    example: { ticker: "JNPR", deal: "Juniper Networks / Hewlett Packard Enterprise", aspects: ["Background of the merger", "Fairness opinion analyses", "Adviser fees", "Management projections", "Deal protection"] },
    effort: "high",
    instructions: `1. Locate the proxy: get_recent_filings with forms ["DEFM14A","PREM14A","DEF 14A","S-4","SC 14D9"] for the ticker; if nothing is there, run edgar_fulltext_search with forms ["DEFM14A","S-4","SC 14D9"], the entity name and the phrase "Background of the Merger". 2. read_document on that filing with these queries, one call each: "Background of the Merger"; "opinion of" (the adviser's section); "Selected Companies Analysis"; "Selected Transactions Analysis"; "Discounted Cash Flow Analysis"; "implied per share"; "fee of approximately"; "Certain Unaudited Prospective Financial Information"; "Termination Fee"; "Treatment of Equity Awards"; "Golden Parachute". Expand the hits with offset reads until each section is covered. 3. Build the timeline strictly from dated sentences (who contacted whom, indications of interest and at what price, board meetings, exclusivity, the price walk): every entry needs a date and a source id. 4. Tabulate each valuation analysis with its inputs (multiple range, discount rate range, perpetuity growth or exit multiple) and the implied per-share range, and compare each to the deal price with calc. 5. Fees: separate the announcement fee, the closing fee, the opinion fee and the portion contingent on closing, and note the material relationships disclosed under FINRA Rule 5150.
Produce: callout with the one-line conclusion (what the process and the ranges say about price); timeline "Background of the merger"; table "Fairness opinion analyses" (Analysis, Inputs, Implied per share low, high, Deal price inside range?); table "Adviser economics" (Adviser, Role, Fee, Contingent, Opinion fee); table "Management projections" by year (revenue, EBITDA, unlevered FCF) exactly as disclosed; bullets "Deal protection" (termination fee and its % of equity value, go-shop, matching rights, outside date); caveats naming any section you could not find in the document.`,
    prompt: (i) => `Mine the merger proxy for ${str(i, "ticker") ? str(i, "ticker").toUpperCase() : str(i, "deal")} and extract: ${list(i, "aspects").join(", ") || "the background of the merger, the fairness analyses, the adviser fees and the projections"}.`,
  },
  {
    kind: "ai", id: "ma-fairness-opinion", title: "Fairness opinion summary & support book", tagline: "What the opinion says, what sits behind it, and the questions the fairness committee will ask.",
    description: "Summarizes a fairness opinion into the board-ready page: the methods, the implied ranges against the consideration, the adviser's fee and relationships under FINRA 5150, and the outline of the 40-80 page support book. It also produces the challenge questions a fairness committee or a plaintiff's expert would raise.",
    roles: ["banker"], specialties: [...COV, RX], category: "Deliverables", icon: "Scale", deliverable: "memo", savesMinutes: 180, tags: ["fairness opinion", "board", "FINRA 5150"],
    fields: [
      { key: "ticker", label: "Target", type: "ticker", required: true, placeholder: "JNPR" },
      { key: "price", label: "Consideration per share", type: "number", unit: "$", required: true, default: 40 },
      { key: "role", label: "We are advising", type: "select", options: ["Board", "Special committee", "Buyer", "Creditor / plan proponent"], default: "Board" },
    ],
    example: { ticker: "JNPR", price: 40, role: "Special committee" },
    effort: "high",
    instructions: `1. get_company_financials for the target. 2. If an opinion already exists, read it: get_recent_filings with forms ["DEFM14A","SC 14D9","S-4"], then read_document with the queries "opinion of", "implied per share", "Selected Companies Analysis", "Discounted Cash Flow Analysis", "fee of approximately" and "material relationships". 3. Independently sanity-check each range: get_trading_comps for the comps analysis and edgar_fulltext_search with forms ["DEFM14A","8-K"] and "agreement and plan of merger" plus sector keywords for the precedent set; recompute the implied values with calc and say which range you could not reproduce. 4. The standard support book runs: transaction overview and consideration mechanics, trading history and volume-weighted prices, premiums paid, trading comps, precedent transactions, DCF with sensitivities, LBO/ability-to-pay, research price targets, football field, and the fee and relationship disclosure.
Produce: callout stating whether the consideration falls inside every disclosed range; table "Methods and ranges" (Method, Range, Consideration inside?, Source); bullets "Support book contents" as the page list; qa "Fairness committee questions" (6 hard questions with the answer you would give: comp selection, who prepared the projections, discount rate, treatment of stock-based compensation, synergies excluded, conflicts and fee contingency); risks (process or disclosure gaps that create litigation exposure) with severity; caveats (an opinion addresses financial fairness only, as of a date, and is not a recommendation on price).`,
    prompt: (i) => `Summarize and stress-test the fairness analysis for ${str(i, "ticker").toUpperCase()} at $${num(i, "price")} per share, advising the ${str(i, "role", "board").toLowerCase()}.`,
  },
  {
    kind: "ai", id: "ma-process-tracker", title: "Deal process tracker & bid matrix", tagline: "The sell-side calendar, the buyer log and a bid matrix that compares bids on equal terms.",
    description: "Turns a launch date and a buyer log into the process artifacts: a week-by-week calendar from preparation through signing and close, a status tracker per buyer (NDA, CIM, management meeting, IOI, final bid), and a bid matrix that normalizes bids to EV, multiple and certainty so structurally different bids can be compared.",
    roles: ["banker"], specialties: [...COV, SPON], category: "Reporting", icon: "ClipboardList", deliverable: "checklist", savesMinutes: 150, tags: ["process", "bid matrix", "sell-side"],
    fields: [
      { key: "company", label: "Target", type: "text", required: true, placeholder: "Project Atlas (carve-out)" },
      { key: "stage", label: "Current stage", type: "select", options: ["Preparation", "Phase I marketing", "Phase II / management meetings", "Final bids", "Documentation & signing", "Sign to close"], default: "Phase I marketing" },
      { key: "launch", label: "Launch date", type: "date", default: "2026-10-06" },
      { key: "buyers", label: "Buyer log", type: "csv", columns: "buyer,type,nda,cim,mgmt_meeting,ioi_value,final_bid,notes", placeholder: "Cisco,Strategic,Signed,Sent,Held,3200,,board approval needed" },
    ],
    example: { company: "Project Atlas - observability carve-out", stage: "Phase II / management meetings", launch: "2026-10-06", buyers: "buyer,type,nda,cim,mgmt_meeting,ioi_value,final_bid,notes\nCisco,Strategic,Signed,Sent,Held,3200,,board approval needed\nThoma Bravo,Sponsor,Signed,Sent,Held,3400,,private credit financing\nDatadog,Strategic,Pending,,,,,antitrust overlap\nVista,Sponsor,Signed,Sent,Scheduled,2900,,wants exclusivity" },
    effort: "medium",
    instructions: `1. Build the calendar from the launch date on the standard sell-side schedule: preparation 4-6 weeks (CIM, model, data room, buyer list), Phase I 4-6 weeks (teaser, NDA, CIM, IOIs due), Phase II 4-6 weeks (management presentations, data room, site visits, final bids with SPA mark-ups and financing evidence), documentation and signing 3-4 weeks, then sign to close (Hart-Scott-Rodino 30-day initial waiting period, materially longer with a second request; 3-5 months is typical for a public deal). Date every milestone. 2. Parse the buyer log and compute conversion at each gate. 3. Normalize every bid with calc: headline value, EV after debt-like items, implied EV/LTM EBITDA, cash versus stock, financing condition, reps and warranties insurance, employee and regulatory conditions, closing timeline, and a certainty-weighted value where you state the haircut and why. 4. Flag process risks: fewer than three credible Phase II bidders, exclusivity requested before final bids, a bidder with a financing condition, an antitrust overlap, and any bidder whose diligence is behind the calendar.
Produce: kpis (buyers contacted, NDAs signed, IOIs received, median IOI value, bidders remaining); timeline of the calendar with dates; table "Bid matrix" with the normalized columns and the certainty-weighted value; checklist of the next two weeks with owners; risks with mitigations; nextSteps. If the buyer log is empty, produce the calendar and an empty tracker with the columns to fill.`,
    prompt: (i) => `Build the process tracker and bid matrix for ${str(i, "company")}. Stage: ${str(i, "stage")}. Launch date ${str(i, "launch", "2026-10-06")}.`,
  },
  {
    kind: "ai", id: "ma-cim-drafter", title: "CIM section drafter", tagline: "First-draft CIM sections in banker tone, with no valuation guidance and a list of what is missing.",
    description: "Drafts a confidential information memorandum section from public filings and your notes: executive summary, investment highlights with proof points, products, market, management, financials or risk factors. It writes in sell-side tone, never includes valuation guidance, and returns a diligence list of every claim it could not support.",
    roles: ["banker"], specialties: [...COV, SPON], category: "Deliverables", icon: "FileText", deliverable: "memo", savesMinutes: 300, tags: ["CIM", "sell-side", "drafting"],
    fields: [
      { key: "company", label: "Company", type: "text", required: true, placeholder: "Atlas Observability, Inc." },
      { key: "ticker", label: "Public comparable", type: "ticker", placeholder: "DDOG" },
      { key: "section", label: "Section", type: "select", options: ["Executive summary", "Investment highlights", "Products & services", "Market overview", "Sales & marketing", "Management & organization", "Financials & projections", "Risk factors & mitigants"], default: "Executive summary" },
      { key: "notes", label: "Management notes / KPIs", type: "textarea", required: true, placeholder: "ARR $310mm, NRR 118%, 1,240 customers, 42% growth, gross margin 79%, top-10 customers 14% of revenue..." },
    ],
    example: { company: "Atlas Observability, Inc.", ticker: "DDOG", section: "Executive summary", notes: "ARR $310mm growing 42%, NRR 118%, GRR 94%, 1,240 customers with 96 above $1mm ARR, top-10 customers 14% of revenue, gross margin 79%, FY26E EBITDA margin 6% with a path to 22%, three of the top five US banks as customers, founder-led, 540 employees, Series D at $2.1bn in 2024" },
    effort: "medium",
    instructions: `1. Use search_filing on the named public comparable's 10-K for the language conventions of the category ("our business", "competition", "customers", "growth strategy") so the draft reads like the sector, and get_company_financials for any market context you cite. 2. Write the section from the notes. Sell-side rules: the executive summary and the financial section carry the process, so they get the thinking time; every claim needs a number or a source; a CIM contains no valuation guidance, no multiple and no price expectation anywhere; growth claims are framed as historical fact plus management's plan, clearly labeled; customer names appear only if the notes say they may be used. 3. Investment highlights: exactly five, each a claim with two or three proof points beneath it (retention, cohort economics, concentration, win rate, margin structure, whitespace). 4. Financials: present historical results and management's projections separately, state the basis (audited, reviewed or management-prepared), and list the add-backs that will need quality-of-earnings support.
Produce: markdown with the drafted section using ## subheads and short paragraphs; bullets "Investment highlights" where the section calls for them; checklist "Diligence required to support this draft" (every unsupported claim with the document that would prove it); risks only for the risk-factors section; caveats stating that the draft comes from public filings plus the user's notes and that counsel and the client must review it before distribution.`,
    prompt: (i) => `Draft the "${str(i, "section", "Executive summary")}" section of the CIM for ${str(i, "company")}${str(i, "ticker") ? ` (public comparable ${str(i, "ticker").toUpperCase()})` : ""}.\n\nManagement notes:\n${str(i, "notes")}`,
  },
  {
    kind: "ai", id: "ma-management-presentation", title: "Management presentation outline", tagline: "The 60-100 slide Phase II deck, slide by slide, with the questions management must be ready for.",
    description: "Turns the CIM storyline into the management presentation: a slide-by-slide outline across company, market, product, go-to-market, financials and growth plan, with the action title for each slide and who presents it, plus a rehearsal Q&A of what strategics and sponsors actually ask in Phase II.",
    roles: ["banker"], specialties: [...COV, SPON], category: "Deliverables", icon: "Layout", deliverable: "deck", savesMinutes: 240, tags: ["management presentation", "Phase II", "rehearsal"],
    fields: [
      { key: "company", label: "Company", type: "text", required: true, placeholder: "Atlas Observability, Inc." },
      { key: "ticker", label: "Public comparable", type: "ticker", placeholder: "DDOG" },
      { key: "audience", label: "Audience", type: "select", options: ["Strategic buyers", "Sponsors", "Mixed Phase II group", "Lenders (bank meeting)"], default: "Mixed Phase II group" },
      { key: "slides", label: "Target slide count", type: "number", default: 70, min: 30, max: 120 },
    ],
    example: { company: "Atlas Observability, Inc.", ticker: "DDOG", audience: "Mixed Phase II group", slides: 70 },
    effort: "medium",
    instructions: `1. Ground the market and competitive sections in filings: search_filing on the public comparable's 10-K for "competition", "our market opportunity" and "customers", and on its 10-Q for "guidance"; get_trading_comps for the peer context you reference. 2. Build the outline in the standard Phase II order: opening and agenda (2), company and equity story (6-8), market and competitive positioning (8-10), product and technology roadmap (10-12), customers and case studies (6-8), go-to-market and unit economics (8-10), operations and organization (6), historical financials and quality of earnings (8-10), projections and the growth plan with a bridge from the current run-rate (8-10), transaction considerations and appendix (6-10). Fit the requested slide count. 3. For each slide give the action title (the message, not the topic), the exhibit it needs and the presenter (CEO, CFO, CPO, CRO): management presents, bankers are in the room. 4. Tailor the emphasis: strategics want product fit, integration and customer overlap; sponsors want cohort retention, the margin path, management depth and debt capacity; lenders want EBITDA quality, covenant headroom and fixed-charge coverage.
Produce: steps with one entry per section (title plus the slides beneath it); table "Slide plan" (Slide, Action title, Exhibit, Presenter); qa "Rehearsal questions" (10 with model answers, tuned to the audience); checklist of exhibits to build with owners; caveats on what is not yet supportable.`,
    prompt: (i) => `Outline a ${num(i, "slides", 70)}-slide management presentation for ${str(i, "company")} to ${str(i, "audience", "a mixed Phase II group").toLowerCase()}${str(i, "ticker") ? `, using ${str(i, "ticker").toUpperCase()} as the public comparable` : ""}.`,
  },
  {
    kind: "ai", id: "ma-market-update", title: "Weekly market update", tagline: "Monday's sector or capital-markets update: multiples, the week's deals, windows and catalysts.",
    description: "Builds the recurring weekly update for a coverage or product desk: where sector multiples sit versus their ranges, the transactions announced last week with premiums and terms, issuance and pricing outcomes for ECM, DCM and leveraged finance, and the catalysts on next week's calendar, with a client-ready email.",
    roles: ["banker"], specialties: [...COV, ...DESKS], category: "Reporting", icon: "Calendar", deliverable: "memo", savesMinutes: 120, tags: ["market update", "weekly", "client email"],
    fields: [
      { key: "desk", label: "Desk", type: "select", options: ["Sector M&A", "ECM", "DCM", "Leveraged finance"], default: "Sector M&A" },
      { key: "sector", label: "Sector", type: "text", required: true, placeholder: "Technology - infrastructure software" },
      { key: "tickers", label: "Coverage universe", type: "tickers", required: true, placeholder: "SNOW DDOG MDB NET CRWD" },
      { key: "weekOf", label: "Week of", type: "date", default: "2026-09-21" },
    ],
    example: { desk: "Sector M&A", sector: "Technology - infrastructure software", tickers: ["SNOW", "DDOG", "MDB", "NET", "CRWD"], weekOf: "2026-09-21" },
    effort: "medium",
    instructions: `1. get_trading_comps for the universe and compute the sub-sector median multiple, growth and Rule of 40 with calc. 2. The week's transactions: edgar_fulltext_search with forms ["8-K","DEFM14A","S-4"], the phrase "agreement and plan of merger" plus sector keywords and from = the Monday of the week; read_document for price, consideration mix, premium and termination fee on the two largest. 3. For an ECM desk use forms ["424B4","424B5"] with the phrases "initial public offering" and "over-allotment option"; for DCM use forms ["FWP","424B2","424B5"] with "Spread to Benchmark Treasury"; for leveraged finance use forms ["8-K"] with "Credit Agreement" and "Applicable Margin". 4. get_recent_filings with forms ["8-K"] across the universe for earnings (2.02) and material agreements (1.01). 5. Use web_research only for index moves, rates and spread levels, and date every level (reference points: IG OAS 81bps and a 5.53% effective yield, BBB 99bps, HY 265bps on 1 September 2026; loan yields 8.21% and OAS 453bps in June 2026; SOFR 3.73%).
Produce: kpis (median sector multiple and the week's change, deals announced, capital raised, the relevant spread or index level); table "Where multiples sit" (Company, sector multiple, growth, margin, versus its own 1-year range); table "Last week's transactions" (Date, Parties, Value, Multiple, Premium, Consideration, Terms of note); bullets "What it means for clients" (3-5, each tied to a number); timeline "Next week" (earnings dates, lock-up expiries, Fed and data, shareholder votes, outside dates); email with the client-ready version. Say in caveats which levels came from web research and that NTM consensus multiples are unavailable.`,
    prompt: (i) => `Write the ${str(i, "desk", "Sector M&A")} weekly update for ${str(i, "sector")} for the week of ${str(i, "weekOf", "2026-09-21")}. Universe: ${list(i, "tickers").join(", ")}.`,
  },
  {
    kind: "ai", id: "ma-sector-kpis", title: "Sector KPI extractor", tagline: "The KPIs that are not in XBRL: ARR and NRR, PV-10 and boe/d, CET1, FFO, backlog, same-store sales.",
    description: "Pulls the sector-defining operating metrics out of filing text and builds a time series with the quote and source behind every value: software ARR, NRR and RPO; energy PV-10, reserves and production; banks P/TBV, CET1 and NIM; REIT FFO, AFFO and same-store NOI; biotech pipeline and PDUFA dates; consumer same-store sales; industrials backlog and book-to-bill; telecom ARPU and churn.",
    roles: ["banker", "markets", "consultant", "corpfin"], category: "Research", icon: "Database", deliverable: "table", savesMinutes: 180, tags: ["KPI", "sector", "extraction"],
    fields: [
      { key: "tickers", label: "Companies", type: "tickers", required: true, placeholder: "SNOW DDOG MDB" },
      { key: "sector", label: "Sector", type: "select", options: ["Software & internet", "Semiconductors", "Biotech & pharma", "Healthcare services", "Energy - upstream", "Energy - midstream & utilities", "Banks & insurance", "Consumer & retail", "Industrials", "Media & telecom", "REITs, gaming & lodging"], default: "Software & internet" },
      { key: "periods", label: "Periods", type: "number", default: 4, min: 2, max: 8 },
    ],
    example: { tickers: ["SNOW", "DDOG", "MDB"], sector: "Software & internet", periods: 4 },
    effort: "high",
    instructions: `1. For each ticker call get_company_financials, then search_filing on the 10-K and the 10-Q with the sector's phrases below, expanding the best hits with read_filing (at least two reads per company):
- Software & internet: "annual recurring revenue", "net revenue retention rate", "remaining performance obligations", "customers with annual recurring revenue", "gross retention", "billings".
- Semiconductors: "book-to-bill", "design win", "capacity utilization", "inventory days", "gross margin".
- Biotech & pharma: "Phase 3", "Phase 2", "PDUFA", "clinical development", "loss of exclusivity", "patent expiration".
- Healthcare services: "same facility", "admissions", "payor mix", "net revenue per adjusted admission", "average length of stay".
- Energy - upstream: "standardized measure", "PV-10", "proved reserves", "boe per day", "average realized price", "production costs".
- Energy - midstream & utilities: "distributable cash flow", "distribution coverage", "rate base", "allowed return on equity", "take-or-pay".
- Banks & insurance: "tangible book value", "common equity tier 1", "net interest margin", "efficiency ratio", "allowance for credit losses", "combined ratio".
- Consumer & retail: "comparable sales", "same-store sales", "sales per square foot", "inventory turns", "store count".
- Industrials: "backlog", "book-to-bill", "orders", "incremental margin", "aftermarket".
- Media & telecom: "ARPU", "postpaid churn", "subscribers", "net additions", "content spend".
- REITs, gaming & lodging: "funds from operations", "AFFO", "same-store net operating income", "occupancy", "RevPAR", "EBITDAR", "rent coverage".
2. Use get_xbrl_series with find (for example "Revenue|Segment", "Debt", "Lease", "Reserve") when a metric is tagged; extension-heavy filers tag KPIs inconsistently, so say so. 3. Never compute a KPI the company does not disclose without labeling it "YouBank computed" and showing the arithmetic with calc.
Produce: table "KPI series" (Company, KPI, values by period, Definition as disclosed, Source id); table "Quotes" with the exact sentence behind each headline value; line chart of the primary KPI by company; bullets "What the KPIs say"; caveats listing every KPI you could not find and noting that definitions differ by company, so cross-company comparison needs the definition column.`,
    prompt: (i) => `Extract the ${str(i, "sector", "sector")} KPIs for ${list(i, "tickers").join(", ")} over the last ${num(i, "periods", 4)} periods, with the quote and source for each value.`,
  },
  {
    kind: "ai", id: "ma-earnings-comps-note", title: "Earnings-day comps refresh", tagline: "What last night's print did to the comps sheet, and the note that goes to the deal team.",
    description: "Re-spreads a peer set after a print and explains the deltas: the quarter versus the prior period, the KPI moves, how LTM figures and multiples change, which footnotes and normalizations need updating, and what it means for a live pitch or process.",
    roles: ["banker", "markets", "corpfin"], specialties: COV, category: "Reporting", icon: "RefreshCw", deliverable: "email", savesMinutes: 90, tags: ["earnings", "comps", "refresh"],
    fields: [
      { key: "ticker", label: "Company that reported", type: "ticker", required: true, placeholder: "SNOW" },
      { key: "peers", label: "Comps sheet", type: "tickers", required: true, placeholder: "DDOG MDB NET CRWD" },
      { key: "use", label: "What the sheet supports", type: "select", options: ["Live sell-side process", "Pitch in progress", "Fairness opinion", "Standing sector sheet"], default: "Standing sector sheet" },
    ],
    example: { ticker: "SNOW", peers: ["DDOG", "MDB", "NET", "CRWD"], use: "Pitch in progress" },
    effort: "medium",
    instructions: `1. get_company_financials for the reporter and get_xbrl_series for 6-8 quarters of revenue, operating income and operating cash flow so you show the trend, not just the quarter. 2. search_filing on the new 10-Q for "results of operations", "guidance" or "outlook", plus the company's KPI ("net revenue retention", "remaining performance obligations", "backlog", "same-store"); get_recent_filings with forms ["8-K"] to pick up the 2.02 release and any 1.01 or 5.02 alongside it. 3. get_trading_comps for the whole sheet and recompute LTM revenue, LTM EBITDA and the multiples with calc, showing before and after for the reporter (LTM = prior fiscal year + current year to date - prior year to date). 4. Identify what must change in the sheet's footnotes: new one-time items to normalize, an acquisition that makes LTM non-comparable, a fiscal-year offset that needs calendarizing, a share count change from the cover page, and any convertible or option issuance that moves treasury-stock-method shares.
Produce: callout with the one-line takeaway for the deal team; kpis (revenue and growth, EBITDA margin, the headline KPI, EV/LTM revenue before and after, each with delta and tone); table "Comps sheet impact" (Company, LTM revenue old/new, multiple old/new, change, action needed); bullets "Footnotes to update"; email to the deal team with a subject line and three short paragraphs; caveats (reported versus adjusted EBITDA, and no consensus estimates so this is LTM only).`,
    prompt: (i) => `${str(i, "ticker").toUpperCase()} just reported. Refresh the comps sheet (${list(i, "peers").join(", ")}) and write the note for a ${str(i, "use", "standing sector sheet").toLowerCase()}.`,
  },
  {
    kind: "ai", id: "ma-activism-screen", title: "Activism vulnerability screen", tagline: "How an activist would attack this company, scored across the five standard dimensions.",
    description: "Runs the defense adviser's vulnerability assessment: return versus peers, the valuation discount on comps and sum-of-the-parts, the governance scorecard from the proxy, the shareholder base and 13D activity, and balance-sheet capacity for buybacks, then writes the activist's likely white paper and the break-glass response plan.",
    roles: ["banker", "markets", "corpfin"], category: "Diligence", icon: "Shield", deliverable: "analysis", savesMinutes: 240, tags: ["activism", "defense", "governance"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
      { key: "peers", label: "Peers", type: "tickers", placeholder: "DIS CMCSA PARA NFLX" },
      { key: "lens", label: "We are advising", type: "select", options: ["The company (defense)", "An activist (offense)", "A long-only holder"], default: "The company (defense)" },
    ],
    example: { ticker: "WBD", peers: ["DIS", "CMCSA", "PARA", "NFLX"], lens: "The company (defense)" },
    effort: "high",
    instructions: `1. get_company_financials and get_trading_comps for the valuation discount versus the peer median on the sector-standard multiple, and quantify the gap in dollars per share with calc. 2. Governance: search_filing on the DEF 14A for "classified board", "advance notice", "rights plan", "supermajority", "special meeting", "proxy access", "exclusive forum" and "majority voting", plus director tenure; note universal-proxy exposure. 3. Holders and prior activity: get_recent_filings with forms ["SC 13D","SC 13G","DEF 14A","8-K"] limit 30 and get_insider_transactions - a 13D is due within five business days of crossing 5%. 4. Capacity: cash, leverage headroom to 3.0x net debt/EBITDA, and the buyback or dividend the balance sheet could fund. 5. Build the campaign the way an activist would: breakup or divestiture (use the segment footnote via search_filing "segment information"), capital allocation, a cost program with a margin target versus peers, board refreshment, and sale of the company. Context: 297 campaigns in 2025 with board change 37%, M&A 35% and capital allocation 31% of objectives; industrials 24% and technology 19% of targets; H1 2026 was the busiest half ever at 184 campaigns.
Produce: score block (0-100 each for underperformance, valuation discount, governance, shareholder base and balance-sheet capacity, plus a total); table "Vulnerability scorecard" (Dimension, Evidence, Score, Source); markdown "The activist's white paper" in the activist's voice with numbers; bullets "Our rebuttal" (or "Our demands" in offense mode); checklist "Break-glass plan" (advisers retained, stock-watch, rights plan on the shelf, board briefing, IR message, settlement parameters); caveats (13F holder detail, turnover and total-return history are partly web-sourced; cost basis is not in EDGAR).`,
    prompt: (i) => `Score ${str(i, "ticker").toUpperCase()}'s activism vulnerability versus ${list(i, "peers").join(", ") || "a peer set you propose"}, advising ${str(i, "lens", "the company").toLowerCase()}.`,
  },
  {
    kind: "ai", id: "ma-deal-protection", title: "Deal protection benchmark", tagline: "Termination fees, reverse fees and go-shops, benchmarked against real merger agreements.",
    description: "Benchmarks a deal protection package against precedent merger agreements pulled from EDGAR: company termination fee as a percentage of equity value and enterprise value, reverse termination fee, go-shop window and reduced fee, no-shop and matching rights, and the outside date. Anchored on the 2025 study of 160 US public targets.",
    roles: ["banker", "pe", "corpfin"], specialties: [...COV, SPON], category: "Diligence", icon: "Lock", deliverable: "table", savesMinutes: 180, tags: ["termination fee", "deal protection", "go-shop"],
    fields: [
      { key: "size", label: "Transaction value", type: "number", unit: "$mm", required: true, default: 3000 },
      { key: "buyer", label: "Buyer type", type: "select", options: ["Strategic", "Sponsor / take-private", "Merger of equals"], default: "Sponsor / take-private" },
      { key: "consideration", label: "Consideration", type: "select", options: ["All cash", "All stock", "Mixed"], default: "All cash" },
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "software" },
      { key: "from", label: "Precedents from", type: "date", default: "2024-01-01" },
    ],
    example: { size: 3000, buyer: "Sponsor / take-private", consideration: "All cash", sector: "software cloud", from: "2024-01-01" },
    effort: "high",
    instructions: `1. edgar_fulltext_search with forms ["DEFM14A","8-K","S-4"], the phrase "termination fee" plus the sector keywords, from the start date; run a second query on "Company Termination Fee" and a third on "go-shop" to catch outliers. De-duplicate by target. 2. For each precedent, read_document with the queries "Termination Fee", "Parent Termination Fee", "Superior Proposal", "matching rights", "go-shop", "Outside Date", "Reverse Termination Fee" and "specific performance", and record the dollar fees and terms. 3. Compute each fee as a percentage of equity value and of enterprise value with calc, and the reverse fee as a percentage of equity value. 4. Benchmark against the 2025 study of 160 US public targets above $50M: median company termination fee 2.7% of transaction value and 2.8% of EV, full range 0.1-10.1%, roughly 48% of fees between 2.0% and 3.5%, median dollar fee $41.4M, all-stock deals 3.0% versus all-cash 2.6%; go-shops appear in about 8.5% of deals with 30-60 day windows and the fee often halved inside the window; reverse termination fees for financing or regulatory failure commonly run 5-7% of equity value. Megadeals compress: the Paramount Skydance/Warner Bros. Discovery fee was $7.0B on $114.1B of value, 6.1%, which is an outlier to call out rather than average in.
Budget about 25 tool calls: five well-extracted precedents beat twelve half-read ones.
Produce: kpis (recommended fee % and dollar amount, precedent median, the percentile your recommendation sits in, reverse fee); table "Precedent deal protection" (Announced, Target, Acquirer, Buyer type, Value, Fee $, Fee % of equity, Fee % of EV, Reverse fee, Go-shop, Outside date, Source); bar of fee % by deal with a reference line at the median; callout with the package you would recommend and the two terms worth trading; caveats (fees come from the agreement text, EV is computed only where the target's financials exist, and none of this is legal advice).`,
    prompt: (i) => `Benchmark deal protection for a $${num(i, "size", 3000)}mm ${str(i, "consideration", "all cash").toLowerCase()} ${str(i, "buyer", "strategic").toLowerCase()} deal in ${str(i, "sector")}, using precedents since ${str(i, "from", "2024-01-01")}.`,
  },
  {
    kind: "ai", id: "ma-synergy-accretion", title: "Synergy & accretion workflow", tagline: "Announced-synergy benchmarks, the EPS build, and the synergies needed to justify the premium.",
    description: "Runs the strategic buyer's first question end to end: pulls announced synergy benchmarks for the sector from 8-K investor decks, builds pro forma EPS with purchase accounting and financing, solves for the pre-tax synergies that break even on EPS, and compares the capitalized value of synergies with the premium paid.",
    roles: ["banker", "corpfin"], specialties: COV, category: "Modeling", icon: "ArrowLeftRight", deliverable: "model", savesMinutes: 210, tags: ["accretion", "synergies", "merger model"],
    fields: [
      { key: "acquirer", label: "Acquirer", type: "ticker", required: true, placeholder: "XOM" },
      { key: "target", label: "Target", type: "ticker", required: true, placeholder: "DVN" },
      { key: "premium", label: "Premium to current price", type: "number", unit: "%", default: 30 },
      { key: "cashPct", label: "Cash consideration", type: "number", unit: "%", default: 50 },
      { key: "debtRate", label: "Cost of new debt", type: "number", unit: "%", default: 6 },
    ],
    example: { acquirer: "XOM", target: "DVN", premium: 25, cashPct: 0, debtRate: 5.5 },
    effort: "high",
    instructions: `1. get_company_financials for both companies: price, diluted shares, net income, EBITDA, cash, debt. 2. Synergy benchmarks: edgar_fulltext_search with forms ["8-K"] and the phrases "run-rate synergies", "cost synergies of approximately" and "expected to be accretive" plus sector keywords, from 24 months back; read_document on the investor decks and record announced run-rate synergies, phasing, cost to achieve, and synergies as a percentage of the target's revenue and of its operating expense. That percentage is the benchmark you apply. 3. Build the model with calc: offer price = target price x (1 + premium); offer equity value = offer price x target diluted shares (treasury stock method at the offer price, not the market price); sources and uses with the cash portion funded from balance-sheet cash then new debt, and the stock portion as new shares = offer value x stock % / acquirer price; purchase accounting with identifiable intangibles amortized over 7-10 years, a deferred tax liability at the tax rate on write-ups, transaction fees around 2.5% of offer value expensed and financing fees capitalized. 4. Pro forma net income = acquirer + target + after-tax synergies net of integration costs - after-tax new interest - after-tax foregone interest on cash used - after-tax incremental amortization; EPS over pro forma diluted shares; accretion for years 1-3 with synergies phased 50%/100%/100%. 5. Solve for the break-even pre-tax synergies and express them as a percentage of the target's operating expense. 6. Value of synergies = after-tax run-rate synergies capitalized at the acquirer's EV/EBITDA, compared with the premium paid in dollars.
Produce: kpis (offer price, offer equity value, year-1 and year-2 accretion, break-even synergies, value of synergies versus premium paid); table "Sources and uses"; table "EPS build" by year; waterfall from standalone EPS to pro forma EPS (synergies, new interest, foregone interest, amortization); table "Synergy benchmarks" from the 8-K decks with sources; sensitivity of year-1 accretion to premium and synergies; caveats (all-stock is accretive when the acquirer's P/E exceeds the target's and all-cash when the target's after-tax earnings yield exceeds the after-tax cost of debt; no consensus estimates, so this is LTM-based).`,
    prompt: (i) => `Model ${str(i, "acquirer").toUpperCase()} acquiring ${str(i, "target").toUpperCase()} at a ${num(i, "premium", 30)}% premium, ${num(i, "cashPct", 50)}% cash at ${num(i, "debtRate", 6)}% debt, and benchmark the synergies required.`,
  },
  {
    kind: "ai", id: "ma-sotp-breakup", title: "Sum-of-the-parts & breakup analysis", tagline: "Segment-by-segment value, the conglomerate discount, and what a breakup is worth net of costs.",
    description: "Values each segment on its own pure-play multiples from the segment footnote, subtracts capitalized corporate costs, net debt, pensions and minority interest, and compares the total with market value to size the conglomerate discount. In breakup mode it nets out dis-synergies, stranded costs, tax leakage and separation costs.",
    roles: ["banker", "markets", "consultant"], specialties: COV, category: "Valuation", icon: "Split", deliverable: "analysis", savesMinutes: 210, tags: ["SOTP", "breakup", "conglomerate discount"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "WBD" },
      { key: "mode", label: "Mode", type: "select", options: ["Sum-of-the-parts", "Breakup / spin analysis", "Activist breakup case"], default: "Sum-of-the-parts" },
      { key: "segments", label: "Segment overrides (optional)", type: "csv", columns: "segment,revenue,ebitda,peer_multiple,peers", placeholder: "Studios,11800,2400,9.0,LGF PARA" },
    ],
    example: { ticker: "WBD", mode: "Breakup / spin analysis", segments: "segment,revenue,ebitda,peer_multiple,peers\nStudios,11800,2400,9.0,LGF PARA\nNetworks,19200,7100,4.5,PARA AMCX\nStreaming,11500,1300,18.0,NFLX SPOT" },
    effort: "high",
    instructions: `1. get_company_financials for consolidated figures, net debt, shares and market cap. 2. Segments: if the overrides CSV is empty, search_filing on the 10-K for "segment information", "reportable segments" and "Adjusted EBITDA" and expand with read_filing; also try get_xbrl_series with find "Segment" for tagged segment revenue and profit. Use the disclosed segment definition and say what corporate or intersegment items sit outside the segments. 3. Multiples: for each segment name 3-5 listed pure plays and call get_trading_comps; use the median EV/EBITDA, or the segment-appropriate metric (EV/EBITDAX for E&P, P/FFO for real estate, percentage of AUM for asset management, EV/subscriber for telecom), and state it. 4. Build the sum with calc: segment EV = segment EBITDA x multiple; less unallocated corporate costs capitalized at the blended multiple; less net debt, underfunded pension (search_filing "projected benefit obligation"), minority interest and preferred; plus non-operating assets and equity investments. Per share on diluted shares. 5. Breakup mode: subtract dis-synergies (shared services, procurement, cross-selling), stranded costs, separation costs of 1-3% of separated revenue, and tax leakage on a taxable separation versus a tax-free spin, and note the 18-24 month timeline. Conglomerate discounts typically run 10-15%; activists pitch 30-50% - show both and label which is which.
Produce: kpis (SOTP EV, SOTP equity per share, current price, discount %, largest contributor); table "Sum of the parts" (Segment, Metric, Value, Multiple, Peers used, EV, % of total); waterfall from segment values through corporate costs and net debt to equity value; bar of SOTP per share versus the current price; risks (execution, dis-synergies, tax, timing) with severity; caveats (segment profit definitions are company-specific, corporate cost capitalization is a judgment, and there are no consensus estimates).`,
    prompt: (i) => `Run a ${str(i, "mode", "sum-of-the-parts").toLowerCase()} for ${str(i, "ticker").toUpperCase()} from the segment footnote and pure-play multiples.`,
  },
  {
    kind: "ai", id: "ma-premiums-paid", title: "Premiums paid analysis", tagline: "Premiums to the unaffected price across four windows, with the reference date the proxy used.",
    description: "Builds the premiums-paid page: for each precedent it takes the unaffected price the proxy itself uses, computes premiums to the 1-day, 1-week and 30-day prices and to the 52-week high, and reports the distribution by buyer type and consideration so a recommended premium sits in a defensible percentile.",
    roles: ["banker", "pe", "markets"], specialties: [...COV, SPON], category: "Valuation", icon: "TrendingUp", deliverable: "table", savesMinutes: 150, tags: ["premiums paid", "unaffected price", "precedents"],
    fields: [
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "software cloud data" },
      { key: "buyer", label: "Buyer type", type: "select", options: ["Any", "Strategic", "Sponsor / take-private"], default: "Any" },
      { key: "from", label: "From", type: "date", default: "2023-01-01" },
      { key: "count", label: "Deals", type: "number", default: 10, min: 5, max: 20 },
    ],
    example: { sector: "software cloud infrastructure", buyer: "Sponsor / take-private", from: "2023-01-01", count: 10 },
    effort: "high",
    instructions: `1. edgar_fulltext_search with forms ["DEFM14A","8-K","SC 14D9"], the phrase "premium" together with "per share in cash" and the sector keywords, from the start date; de-duplicate by target and prefer deals above $500M. 2. For each deal, read_document with the queries "unaffected", "the last trading day prior to", "premium of approximately", "closing price", "volume weighted average" and "52-week high" - merger proxies usually disclose the premium and its reference date themselves, which is the cleanest source. Where a rumor preceded announcement, the proxy's unaffected date will predate it: record both dates and say which you used. 3. Compute premiums with calc to the 1-day, 1-week and 30-day prices and to the 52-week high, plus implied EV/LTM EBITDA where the target's XBRL financials exist (get_company_financials or get_xbrl_series). 4. Summarize the distribution: minimum, 25th, median, mean, 75th and maximum, split by buyer type and consideration. Control premiums of 25-50% are the practitioner band; stock deals price lower and competitive processes higher.
Budget about 25 tool calls: report the deals you fully extracted rather than partially filling a longer table.
Produce: kpis (deal count, median 1-day premium, median 30-day premium, median premium to the 52-week high); table "Premiums paid" (Announced, Target, Acquirer, Buyer type, Consideration, Unaffected date, Offer price, 1-day, 1-week, 30-day, versus 52-week high, EV/EBITDA, Source); columns chart of the 1-day premium distribution in 10-point buckets; bullets "What drives the outliers" (competitive process, leak, controlling holder, stock consideration); caveats (leak detection needs news and volume data that is not in EDGAR; premiums use the proxy's own reference prices where disclosed).`,
    prompt: (i) => `Build a premiums-paid analysis of ${num(i, "count", 10)} ${str(i, "buyer", "any").toLowerCase()} deals in ${str(i, "sector")} since ${str(i, "from", "2023-01-01")}.`,
  },
  {
    kind: "ai", id: "ep-reserves-nav", title: "E&P reserves, PV-10 & NAV reader", tagline: "Supplemental oil and gas disclosures turned into PV-10, NAV and EV per flowing barrel.",
    description: "Parses the 10-K supplemental oil and gas disclosures into a reserve and PV-10 table, computes the screening metrics energy bankers quote (EV/EBITDAX, EV per flowing boe/d, EV per proved boe, dollars per acre, P/NAV, EV/DACF), and sensitizes value to the price deck because SEC pricing is a trailing average, not the strip.",
    roles: ["banker", "markets", "pe"], specialties: ["Energy & power", "M&A (generalist)"], category: "Valuation", icon: "Fuel", deliverable: "analysis", savesMinutes: 210, tags: ["PV-10", "reserves", "NAV"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "XOM" },
      { key: "peers", label: "Peers", type: "tickers", placeholder: "CVX COP EOG DVN" },
      { key: "deck", label: "Price deck", type: "select", options: ["SEC (trailing 12-month first-day-of-month average)", "Strip", "Flat $70 WTI / $3.50 HH", "Flat $60 WTI / $3.00 HH"], default: "SEC (trailing 12-month first-day-of-month average)" },
    ],
    example: { ticker: "XOM", peers: ["CVX", "COP", "EOG", "DVN"], deck: "Strip" },
    effort: "high",
    instructions: `1. get_company_financials for EV, net debt and cash flow. 2. search_filing on the 10-K for "standardized measure", "PV-10", "proved reserves", "proved developed", "changes in proved reserves", "average realized price", "production costs", "capitalized costs" and "net acres", expanding each with read_filing until the reserve tables are captured; also get_xbrl_series with find "Reserve|OilAndGas" for tagged values. 3. Compute with calc: EBITDAX (operating income + D&A + exploration expense - state what you used), DACF (operating cash flow + after-tax interest), EV/EBITDAX, EV per flowing boe/d, EV per proved boe, EV per proved developed boe, dollars per net acre where acreage is disclosed, and P/NAV where NAV = PV-10 of proved reserves plus a stated value for undeveloped inventory less net debt. 4. Benchmark ranges: EV/EBITDAX 3-7x, EV per flowing boe/d $30-100k, EV per proved boe $8-25, core Permian acreage $5-60k+ per acre. 5. Price deck: SEC PV-10 uses the trailing 12-month first-day-of-month average price, so it is stale when prices move. Approximate the sensitivity by scaling the revenue line of the standardized measure while holding costs, state the elasticity you used (a 10% price change typically moves PV-10 by 15-20%) and label it an approximation, not a re-run of the reserve report. 6. get_trading_comps for the peers and compare.
Produce: kpis (EV, EV/EBITDAX, PV-10, EV per flowing boe/d, EV per proved boe, P/NAV); table "Reserves and PV-10" by category (proved developed producing, proved developed non-producing, proved undeveloped) with volumes, PV-10 and % of total; table "Peer screening metrics"; sensitivity of NAV per share to the oil and gas price deck; caveats (PV-10 is a disclosure, not a value; third-party reserve reports from NSAI or Ryder Scott and Enverus acreage data are not in EDGAR; risking and discount-rate conventions differ between buyers).`,
    prompt: (i) => `Read ${str(i, "ticker").toUpperCase()}'s supplemental oil and gas disclosures and build the reserve, PV-10 and NAV page on a ${str(i, "deck", "SEC")} deck${list(i, "peers").length ? `, benchmarked against ${list(i, "peers").join(", ")}` : ""}.`,
  },
  {
    kind: "ai", id: "reit-nav-cap-rate", title: "REIT NAV & implied cap rate", tagline: "Forward NOI capitalized at market cap rates, against the price the market is paying.",
    description: "Builds a REIT net asset value the way real estate bankers do: annualized same-store NOI grown forward and capitalized at a market cap rate, plus development at cost and joint ventures at share, less debt and preferred, then compares NAV per share with the price and derives the implied cap rate the market is applying.",
    roles: ["banker", "markets"], specialties: ["Real estate & gaming", "M&A (generalist)"], category: "Valuation", icon: "Building2", deliverable: "analysis", savesMinutes: 180, tags: ["REIT", "NAV", "cap rate"],
    fields: [
      { key: "ticker", label: "REIT", type: "ticker", required: true, placeholder: "PLD" },
      { key: "capRate", label: "Market cap rate", type: "number", unit: "%", default: 5.5 },
      { key: "noiGrowth", label: "Forward same-store NOI growth", type: "number", unit: "%", default: 3 },
      { key: "peers", label: "Peers", type: "tickers", placeholder: "AMT EQIX SPG O" },
    ],
    example: { ticker: "PLD", capRate: 5.25, noiGrowth: 4, peers: ["AMT", "EQIX", "SPG", "O"] },
    effort: "high",
    instructions: `1. get_company_financials for EV, debt, cash and shares. 2. search_filing on the 10-Q and 10-K for "net operating income", "same store", "funds from operations", "AFFO", "occupancy", "leasing spreads", "development in progress", "unconsolidated joint ventures", "preferred", "operating partnership units" and "straight-line rent", expanding with read_filing. Operating partnership units must be added to the share count. 3. Build NAV with calc: forward NOI = annualized same-store NOI x (1 + growth); capitalized value = forward NOI / cap rate; add construction in progress at cost (or at a stabilized yield-on-cost less cost to complete), land, joint ventures at share, cash and other assets; subtract total debt at face (noting below-market fixed-rate debt), preferred at liquidation value, and corporate G&A capitalized at the same cap rate if the peer convention does so. Per share on diluted shares plus OP units. 4. Implied cap rate = forward NOI / (market cap + debt + preferred - cash - the value of non-NOI assets). 5. Compute P/FFO and P/AFFO and compare with get_trading_comps for the peers; REITs must distribute most of taxable income, so payout and AFFO coverage matter.
Produce: kpis (NAV per share, price, premium/discount to NAV, implied cap rate, P/FFO, P/AFFO); table "NAV build" with each line and its source; sensitivity of NAV per share to cap rate and NOI growth; bar of premium/discount to NAV versus peers; caveats (Green Street NAV estimates and market cap-rate series are licensed, so the cap rate is a user input; same-store definitions and NOI adjustments differ by REIT).`,
    prompt: (i) => `Build the NAV and implied cap rate for ${str(i, "ticker").toUpperCase()} at a ${num(i, "capRate", 5.5)}% cap rate and ${num(i, "noiGrowth", 3)}% forward NOI growth${list(i, "peers").length ? `, against ${list(i, "peers").join(", ")}` : ""}.`,
  },
  {
    kind: "ai", id: "fig-bank-merger", title: "Bank M&A: TBV dilution & earnback", tagline: "Marks, cost saves, tangible book dilution and the earnback period that decides bank deals.",
    description: "Runs the analysis that governs bank mergers: purchase accounting marks on loans and securities, the core deposit intangible, cost saves as a share of the target's expense base, tangible book value per share dilution at close, the crossover earnback period, pro forma CET1 and EPS accretion.",
    roles: ["banker", "corpfin"], specialties: ["FIG", "M&A (generalist)"], category: "Modeling", icon: "Landmark", deliverable: "model", savesMinutes: 240, tags: ["bank M&A", "TBV earnback", "CET1"],
    fields: [
      { key: "acquirer", label: "Acquirer", type: "ticker", required: true, placeholder: "JPM" },
      { key: "target", label: "Target", type: "ticker", required: true, placeholder: "CFG" },
      { key: "premium", label: "Premium", type: "number", unit: "%", default: 25 },
      { key: "costSaves", label: "Cost saves, % of target expense base", type: "number", unit: "%", default: 30 },
      { key: "loanMark", label: "Credit mark on loans", type: "number", unit: "%", default: 1.5 },
    ],
    example: { acquirer: "JPM", target: "CFG", premium: 25, costSaves: 30, loanMark: 1.5 },
    effort: "high",
    instructions: `1. get_company_financials for both banks, then get_xbrl_series with find "Loans|Deposits|Equity|Intangible|Securities" and pull loans, deposits, goodwill and intangibles, total and tangible common equity, and share counts. 2. search_filing on each 10-K for "tangible book value", "common equity tier 1", "net interest margin", "efficiency ratio", "allowance for credit losses", "accumulated other comprehensive", "held to maturity" and "fair value of loans" - the AOCI and held-to-maturity marks are where bank deals break. 3. Compute with calc: deal value = target price x (1 + premium) x shares; price to tangible book and price to earnings; purchase accounting = the credit mark on loans (reverse the existing allowance first, then re-establish the day-two CECL reserve - double counting it is the classic error), the securities mark to fair value, a core deposit intangible of 1-3% of core deposits amortized over 7-10 years on an accelerated basis, and goodwill as the residual. 4. TBV per share dilution at close and the crossover earnback: years until pro forma TBVPS matches the standalone path, with cost saves phased 75% in year 1 and 100% thereafter. The market norm is under three years. 5. Pro forma CET1 = pro forma CET1 capital / pro forma risk-weighted assets with goodwill and intangibles deducted; state the RWA assumption. 6. EPS accretion with after-tax cost saves less CDI amortization and any funding cost.
Produce: kpis (deal value, P/TBV, TBV dilution %, earnback years, pro forma CET1, year-2 EPS accretion); table "Purchase accounting" line by line; line chart of pro forma versus standalone TBVPS by year showing the crossover; table "Pro forma capital and profitability" (CET1, ROTCE, efficiency ratio); risks (regulatory approval timing at the Fed, OCC or FDIC, deposit attrition, CRE concentration, AOCI marks) with severity; caveats (call report and FR Y-9C detail sits outside EDGAR XBRL; marks are estimates and RWA is approximated).`,
    prompt: (i) => `Run the TBV dilution and earnback for ${str(i, "acquirer").toUpperCase()} acquiring ${str(i, "target").toUpperCase()} at a ${num(i, "premium", 25)}% premium with ${num(i, "costSaves", 30)}% cost saves and a ${num(i, "loanMark", 1.5)}% loan mark.`,
  },
];

/* ======================================================================================
 * Restructuring: AI workflows
 * ====================================================================================== */

const RX_WORKFLOWS: ToolDef[] = [
  {
    kind: "ai", id: "rx-capital-structure", title: "Capital structure table builder", tagline: "Every tranche in priority order with leverage through, reconciled to the balance sheet.",
    description: "Builds the restructuring banker's capital structure table from the debt footnote, the maturity schedule and the credit agreement and indenture exhibits: each tranche with obligor and guarantors, size, coupon, maturity, security and lien priority, cumulative gross and net leverage through the tranche, cash interest, and a reconciliation to the balance sheet with every difference footnoted.",
    roles: ["banker", "markets", "pe"], category: "Credit & restructuring", icon: "Layers", deliverable: "table", savesMinutes: 240, tags: ["cap table", "leverage", "credit agreement"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "LUMN" },
      { key: "ebitdaBasis", label: "Leverage basis", type: "select", options: ["Reported EBITDA", "Adjusted EBITDA (company-defined)", "Both side by side"], default: "Both side by side" },
      { key: "docs", label: "Read the credit agreement and indenture exhibits", type: "toggle", default: true },
    ],
    example: { ticker: "LUMN", ebitdaBasis: "Both side by side", docs: true },
    effort: "high",
    instructions: `1. get_company_financials for EBITDA, cash, total debt and market data. 2. get_recent_filings with forms ["10-Q","10-K","8-K"] limit 20 to find the current filings and any debt-related 8-K (items 1.01, 2.03, 2.04, 7.01). 3. search_filing on the latest 10-Q with at most five queries, in this order: "Long-term debt", "Credit Agreement", "Senior Notes", "letters of credit", "aggregate maturities". Then expand the debt footnote and the maturity table with read_filing (at least three reads) - that is where the tranche detail is, so spend the call budget on reads rather than more searches. Only query the 10-K for what the 10-Q does not carry, typically the full five-year maturity table, the guarantee package ("guarantee", "Guarantors") and covenant terms ("covenant", "springing"); keep total filing searches under ten. 4. get_xbrl_series with find "Debt|Notes|LineOfCredit|Lease|InterestExpense" and then pull the specific concepts to tie out totals and cash interest. 5. If the docs toggle is on, run edgar_fulltext_search with forms ["8-K"], the entity name and the phrase "Credit Agreement" to locate the governing EX-10, and read at most two exhibits with at most six read_document calls total, prioritizing "Applicable Margin", "Maturity Date" and "Guarantors". A credit agreement runs hundreds of pages: take the pricing, maturity and guarantee package and stop. Anything you did not confirm goes in caveats as a document term to check with counsel. 6. Order the tranches by priority: ABL or first-lien revolver, first-lien term loan, 1.5 lien, second lien, unsecured notes, structurally senior subsidiary debt (shown at its obligor), holdco or PIK notes, preferred. Compute with calc for each tranche: cumulative debt, cumulative net debt, leverage through the tranche on each EBITDA basis, and cash interest. 7. Reconcile the sum of tranches to balance-sheet debt and footnote every difference: unamortized discount and issuance costs, finance and operating leases, PIK accrual, undrawn revolver, letters of credit, securitization or factoring facilities, and any debt at non-guarantor subsidiaries.
Budget about 20 tool calls. The deliverable is the tranche table built from the debt footnote and the maturity schedule: once you have that, write the output and name the gaps, because a complete table with footnoted gaps beats an unfinished analysis.
Produce: kpis (total debt, net debt, net leverage, cash interest, liquidity = cash + revolver availability - letters of credit, weighted-average maturity); table "Capital structure" with columns Tranche, Obligor / guarantors, Facility size, Outstanding, Coupon, Maturity, Security & priority, Cumulative net debt, Leverage through, Source; table "Reconciliation to the balance sheet"; bar of outstandings by tranche in priority order; bullets "Document terms found" (springing maturities, maintenance or springing covenants, ECF sweep, restricted payment and investment baskets, unrestricted subsidiary capacity, blockers); caveats (secondary loan and bond marks are vendor-licensed and not in EDGAR; private and private-credit debt does not appear; amendments are scattered across exhibits, so flag anything you could not confirm).`,
    prompt: (i) => `Build the capital structure table for ${str(i, "ticker").toUpperCase()} from the latest filings${bool(i, "docs", true) ? " and the credit agreement and indenture exhibits" : ""}, with leverage through each tranche on ${str(i, "ebitdaBasis", "both bases").toLowerCase()}.`,
  },
  {
    kind: "ai", id: "rx-maturity-wall", title: "Debt maturity wall & refi feasibility", tagline: "Maturities by year and tranche, springing dates shown early, and the must-deal-by date.",
    description: "Builds the maturity wall from the debt footnote's five-year schedule, moves any tranche with a springing maturity to its earlier trigger date, overlays current market yields to test which maturities can actually be refinanced, and sets the date by which a transaction has to be agreed.",
    roles: ["banker"], specialties: [RX, LEV, "DCM", SPON], category: "Credit & restructuring", icon: "Hourglass", deliverable: "analysis", savesMinutes: 120, tags: ["maturity wall", "springing maturity", "refinancing"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "LUMN" },
      { key: "refiYield", label: "Assumed refinancing yield", type: "number", unit: "%", default: 11 },
      { key: "horizon", label: "Horizon", type: "select", options: ["3 years", "5 years", "All maturities"], default: "5 years" },
    ],
    example: { ticker: "LUMN", refiYield: 11, horizon: "5 years" },
    effort: "medium",
    instructions: `1. get_company_financials for EBITDA, cash and current cash interest. 2. search_filing on the 10-K for "aggregate maturities of long-term debt", "maturities of long-term debt", "Senior Notes", "Credit Agreement" and "revolving credit facility", and on the 10-Q for any change; expand with read_filing to get the year-by-year table and each tranche's stated maturity. 3. Search the same filings for "springing", "91 days prior", "matures on the earlier of" and "the date that is" to find springing maturities - a revolver or term loan that springs inside a junior maturity must be shown at the earlier date, because that is the date that actually governs. 4. get_xbrl_series with find "Debt|Notes" to tie the totals out. 5. Refinancing feasibility: for each maturity compute the pro forma cash interest at the assumed refinancing yield with calc, the resulting interest coverage (EBITDA - capex) / cash interest, and whether the tranche can be refinanced at par. Use web_research only for current market levels and date them (reference points: HY OAS 265bps with BB 162, B 293 and CCC 960; loan yields 8.21% and OAS 453bps in June 2026; SOFR 3.73%; roughly $1T of speculative-grade maturities due in 2028). 6. Set the must-deal-by date as the earliest of: the first springing trigger, twelve months before the nearest material maturity (the point at which auditors raise going-concern and the debt becomes current), and the first projected covenant breach.
Produce: kpis (debt maturing in the next 12 and 24 months, weighted-average maturity, earliest springing date, pro forma cash interest at the refinancing yield, coverage after refinancing); table "Maturity wall" (Year, Tranche, Amount, Coupon, Stated maturity, Effective maturity if springing, Refinanceable at par?); bar of maturities by year; timeline of trigger dates including the must-deal-by date; callout stating the deadline and the transaction it forces; caveats (springing terms live in the credit agreement, so confirm in the exhibit; market levels are web-sourced and dated).`,
    prompt: (i) => `Build the maturity wall for ${str(i, "ticker").toUpperCase()} over ${str(i, "horizon", "5 years")} including springing maturities, and test refinancing at ${num(i, "refiYield", 11)}%.`,
  },
  {
    kind: "ai", id: "rx-lme-capacity", title: "LME capacity & structure analyzer", tagline: "What the documents permit: incremental debt, drop-downs, uptiers and who gets subordinated.",
    description: "Reads the credit agreement and indenture for the definitions that matter and computes the liability management capacity stack: free-and-clear and ratio incremental debt, restricted payment and investment capacity into unrestricted subsidiaries, and the amendment thresholds. It then models the uptier, drop-down and double-dip structures the documents actually allow, with participant versus holdout outcomes and the post-Serta litigation risk.",
    roles: ["banker"], specialties: [RX, LEV, SPON], category: "Credit & restructuring", icon: "Network", deliverable: "analysis", savesMinutes: 300, tags: ["LME", "uptier", "drop-down", "baskets"],
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "LUMN" },
      { key: "docUrl", label: "Credit agreement / indenture URL (optional)", type: "text", placeholder: "https://www.sec.gov/Archives/edgar/data/..." },
      { key: "ebitda", label: "Covenant EBITDA", type: "number", unit: "$mm", default: 1000 },
      { key: "structure", label: "Structures to test", type: "multiselect", options: ["Uptier exchange", "Drop-down to an unrestricted subsidiary", "Double-dip / pari-plus", "Exit-consent exchange", "Amend and extend"], default: ["Uptier exchange", "Drop-down to an unrestricted subsidiary", "Double-dip / pari-plus"] },
    ],
    example: { ticker: "LUMN", docUrl: "", ebitda: 3900, structure: ["Uptier exchange", "Drop-down to an unrestricted subsidiary", "Double-dip / pari-plus"] },
    effort: "high",
    instructions: `1. Find the documents: if a URL is given, read_document on it; otherwise edgar_fulltext_search with forms ["8-K","10-K"], the entity name and the phrases "Credit Agreement" and "Indenture", then read_document on the EX-10 or EX-4. 2. Extract with read_document queries, quoting the language and citing the section: "Consolidated EBITDA" (add-back caps and the synergy look-forward window; historical caps run 15-25% with 18-24 month windows), "Incremental Facilities" and "Incremental Cap" (free-and-clear "greater of $X and 100% of Consolidated EBITDA" plus ratio debt), "Restricted Payments", "Investments", "Unrestricted Subsidiary", "Permitted Liens", "Required Lenders", "each Lender directly affected" or "Sacred Rights", "pro rata", "open market purchase", "Asset Sale", "Excess Cash Flow" and "MFN". 3. Compute the capacity stack with calc on the covenant EBITDA input: free-and-clear basket, ratio debt up to the first-lien net leverage test with the revolver fully drawn, builder or available-amount basket, general debt and lien baskets, and investment capacity available to move assets to an unrestricted subsidiary. Show the arithmetic per basket. 4. For each selected structure model the outcome: uptier - Required Lenders above 50% amend to permit super-priority debt, participants exchange at a discount into a first-out tranche and holdouts drop to last-out; show participant versus holdout recovery at the EV scenarios and the consent or exchange premium. Drop-down - investment plus restricted payment capacity versus the appraised value of the asset moved, and the remaining collateral coverage for legacy lenders. Double-dip or pari-plus - a new loan to a non-guarantor that is on-lent into the credit group, giving a guarantee claim and a pledged intercompany receivable, so a par claim counts twice against the same collateral. 5. Litigation and blocker context: Serta (5th Cir., December 2024; certiorari denied November 2025) held a privately negotiated non-pro-rata exchange was not an "open market purchase"; Mitel upheld an uptier on "purchase by way of assignment" language; Incora stripped liens without the required two-thirds consent and was reversed. Uptier blockers rose from roughly 40% to about 85% of loans post-Serta, sacred-rights protection against lien subordination from roughly 10% to about 70%, while drop-down blockers remain rare at around 9%.
Budget about 20 tool calls and no more than eight read_document calls on the documents: quote what you find, then write the output and put every unconfirmed definition in caveats for counsel.
Produce: kpis (free-and-clear capacity, ratio debt capacity, total priming capacity, investment capacity for a drop-down, Required Lender threshold); table "Capacity stack" (Basket, Definition quoted, Section, Capacity $mm, Math); table "Structure options" (Structure, What it needs, Consent threshold, Participant recovery, Holdout recovery, Blocker present?, Litigation risk); risks with severity; caveats (counsel must confirm every reading, amendments are scattered across exhibits, and add-backs and compliance certificates are private so covenant EBITDA is the user's input).`,
    prompt: (i) => `Analyze the liability management capacity of ${str(i, "ticker").toUpperCase()} on $${num(i, "ebitda", 1000)}mm of covenant EBITDA and test: ${list(i, "structure").join(", ")}.${str(i, "docUrl") ? ` Document: ${str(i, "docUrl")}` : ""}`,
  },
  {
    kind: "ai", id: "rx-dip-comps", title: "DIP sizing & pricing comps", tagline: "Size the facility off the 13-week trough, then price it against recent DIP orders.",
    description: "Sizes a debtor-in-possession facility from the cash forecast trough, the professional fee carve-out, adequate protection and case costs, splits it into new money and roll-up, and prices it against recent DIP facilities on rate, fees, roll-up ratio, milestones, variance covenants and the maturity.",
    roles: ["banker"], specialties: [RX, LEV], category: "Credit & restructuring", icon: "Banknote", deliverable: "analysis", savesMinutes: 240, tags: ["DIP", "roll-up", "financing"],
    fields: [
      { key: "company", label: "Company / case", type: "text", required: true, placeholder: "Carnival Cruise - hypothetical case" },
      { key: "ticker", label: "Ticker (if public)", type: "ticker", placeholder: "CCL" },
      { key: "trough", label: "13-week cash trough need", type: "number", unit: "$mm", default: 250 },
      { key: "prepetition", label: "Prepetition funded debt", type: "number", unit: "$mm", default: 2000 },
      { key: "sector", label: "Sector keywords", type: "text", placeholder: "cruise travel leisure" },
    ],
    example: { company: "Carnival Corporation - hypothetical prearranged case", ticker: "CCL", trough: 900, prepetition: 27000, sector: "cruise travel leisure lodging" },
    effort: "high",
    instructions: `1. If a ticker is given, get_company_financials and search_filing on the 10-Q for "liquidity", "availability", "letters of credit" and "restricted cash" to anchor the starting liquidity. 2. Size the facility with calc and show every component: the 13-week trough funding need, a minimum liquidity cushion ($10-75M depending on size), the professional fee carve-out (debtor and committee counsel and financial advisers, typically $3-8M per month in a mid-size case), adequate protection payments, case costs (critical vendor, utility deposits, KEIP/KERP, claims agent) and a contingency of 10-15%. Then split into new money and roll-up. 3. Comps: edgar_fulltext_search with forms ["8-K"] and the phrases "debtor-in-possession", "Item 1.03" and "DIP Facility" plus the sector keywords over the last 18 months; read_document on the 8-K exhibits and any DIP term sheet for new money, roll-up, rate, fees, maturity, milestones, minimum liquidity, variance tests, carve-out, challenge period and section 506(c) and 552(b) waivers. 4. Benchmark the terms: defensive DIPs from existing lenders price at SOFR+400-600, priming or third-party DIPs at SOFR+700-1,200, all-in 12-18% with fees; commitment fees 2-5%, exit fees 1-3%, unused 50-100bps, and backstop or structuring premiums of 5-10% in large PIK-heavy deals (Saks: $2.56bn at SOFR+11% PIK with 8% structuring and 10% backstop; Alkegen: SOFR+8.375% half PIK with a 5% backstop, 2.5% upfront and 2.25% exit). Roll-up ratios run 1:1 to 3:1 (Alkegen $315M new money against $315M roll-up; STG a 48.9% roll-up ratio; Axip a 75.7% creeping roll-up), 13 of 16 recent facilities came from prepetition lenders, and creeping roll-ups appeared in 4 of 16. Timing: interim order within 24-72 hours with 20-40% availability, final order in 21-45 days, maturity 6-18 months (90-180 days for a section 363 sale), and DIP-to-exit conversion is common.
Produce: kpis (total facility, new money, roll-up and ratio, all-in cost, implied fees); table "DIP sizing build" with each component and the assumption; table "DIP comps" (Case, Date, Size, New money / roll-up, Rate, Fees, Maturity, Milestones, Source); bar of all-in pricing across the comps with this facility emphasized; bullets "Marketing and approval" (the third-party outreach the DIP declaration must evidence, and the objections a committee will raise on roll-up, liens and waivers); caveats (DIP orders live on PACER and the claims-agent sites, so EDGAR only shows what a registrant files; private-credit DIPs may never appear).`,
    prompt: (i) => `Size and price a DIP facility for ${str(i, "company")} with a $${num(i, "trough", 250)}mm 13-week trough need against $${num(i, "prepetition", 2000)}mm of prepetition funded debt${str(i, "sector") ? `, using ${str(i, "sector")} comps` : ""}.`,
  },
  {
    kind: "ai", id: "rx-distress-screen", title: "Distress screener", tagline: "Going-concern language, Item 1.03 and 2.04 filings, and the leverage and liquidity that rank names.",
    description: "Screens a universe or a sector for restructuring candidates using EDGAR full-text search for going-concern and default language plus the credit statistics that matter: net leverage, EBITDA less capex over cash interest, liquidity runway and maturities inside 18 months, then ranks the names with a one-line catalyst for each.",
    roles: ["banker", "markets", "pe"], category: "Screening", icon: "Radar", deliverable: "table", savesMinutes: 210, tags: ["distress", "going concern", "screen"],
    fields: [
      { key: "tickers", label: "Universe (optional)", type: "tickers", placeholder: "CCL AAL LUMN WBA RIG" },
      { key: "sector", label: "Sector keywords (if no universe)", type: "text", placeholder: "healthcare services chemicals packaging" },
      { key: "trigger", label: "Triggers", type: "multiselect", options: ["Going concern language", "8-K Item 1.03 bankruptcy", "8-K Item 2.04 acceleration", "Forbearance or waiver", "Restructuring support agreement", "Late filing (NT 10-K / NT 10-Q)", "Auditor change"], default: ["Going concern language", "8-K Item 2.04 acceleration", "Forbearance or waiver", "Restructuring support agreement"] },
      { key: "from", label: "From", type: "date", default: "2026-01-01" },
    ],
    example: { tickers: ["CCL", "AAL", "LUMN", "WBA", "RIG"], sector: "telecom healthcare services chemicals", trigger: ["Going concern language", "8-K Item 2.04 acceleration", "Forbearance or waiver", "Restructuring support agreement"], from: "2026-01-01" },
    effort: "high",
    instructions: `1. Run edgar_fulltext_search once per selected trigger, from the start date, and combine: forms ["10-K","10-Q"] with "substantial doubt about our ability to continue as a going concern"; forms ["8-K"] with "Item 1.03"; forms ["8-K"] with "Item 2.04"; forms ["8-K"] with "forbearance agreement" and separately "waiver and amendment"; forms ["8-K"] with "restructuring support agreement"; forms ["NT 10-K","NT 10-Q"] with the sector keywords. Add the sector keywords to each query when no universe is given. 2. For each name that appears, and for every ticker in the universe, call get_company_financials and compute with calc: net debt / LTM EBITDA, (EBITDA - capex) / cash interest, liquidity (cash plus disclosed revolver availability) divided by the quarterly burn, and debt maturing inside 18 months as a percentage of total debt. 3. get_recent_filings with forms ["8-K","NT 10-K","10-Q"] for each name to date the most recent event, and search_filing on the 10-Q for "going concern", "covenant", "availability" and "waiver" to capture the language verbatim. 4. Score each name 0-100, weighting leverage 30, coverage 25, liquidity runway 25 and maturities 20, and adjust for an active trigger; a score above 70 is a live mandate candidate, 50-70 a watch name.
Produce: score block for the top names; table "Distress screen" (Company, Trigger and date, Net leverage, EBITDA-capex / cash interest, Liquidity, Runway, Maturities <18m, Score, Source); bar of scores; bullets "Catalysts in the next two quarters" with dates; risks; caveats (bond and loan trading levels, which are the fastest distress signal, are vendor-licensed; private issuers and private-credit borrowers do not appear in EDGAR; and about 65% of 2025 corporate defaults were distressed exchanges rather than filings, so out-of-court activity is under-represented by filing-based screens).`,
    prompt: (i) => `Screen ${list(i, "tickers").length ? list(i, "tickers").join(", ") : str(i, "sector")} for restructuring candidates since ${str(i, "from", "2026-01-01")} using: ${list(i, "trigger").join(", ")}.`,
  },
  {
    kind: "ai", id: "rx-precedent-restructurings", title: "Precedent restructurings comps", tagline: "Plan outcomes: recoveries by class, equity splits, rights offerings and backstop fees.",
    description: "Builds the precedent restructuring comp set from disclosure statements and emergence filings: recovery by class, the equity split between the fulcrum and junior classes, rights offering size and discount to plan value, backstop fees, management incentive plan size, exit leverage and the time in court.",
    roles: ["banker", "markets", "pe"], category: "Credit & restructuring", icon: "ScrollText", deliverable: "table", savesMinutes: 270, tags: ["precedents", "recoveries", "rights offering"],
    fields: [
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "telecom media technology" },
      { key: "from", label: "From", type: "date", default: "2023-01-01" },
      { key: "count", label: "Cases", type: "number", default: 8, min: 4, max: 15 },
      { key: "type", label: "Type", type: "select", options: ["Any", "Prepackaged / prearranged", "Free-fall Chapter 11", "Out-of-court LME", "Section 363 sale"], default: "Any" },
    ],
    example: { sector: "telecom media technology software", from: "2023-01-01", count: 8, type: "Any" },
    effort: "high",
    instructions: `1. edgar_fulltext_search with forms ["8-K","10-K","S-1"] and the phrases "plan of reorganization", "emerged from chapter 11", "disclosure statement", "rights offering" and "backstop commitment agreement" plus the sector keywords, from the start date; run two or three query variants and de-duplicate by debtor. 2. For each case, read_document with the queries "Recoveries", "estimated recovery", "Class 3", "Class 4", "rights offering", "backstop", "management incentive plan", "new common equity", "exit facility" and "Effective Date", and record: petition and effective dates, funded debt at filing, plan enterprise value, recovery by class in percent and in form (cash, take-back paper, new equity, warrants), the fulcrum class, the equity split, rights offering size and its discount to plan value, backstop fee, MIP percentage, and exit leverage. 3. Benchmark the terms: backstop fees averaged about 6% of the raise academically but recent cases ran 8-14% (Hearthside 10%, Hornblower 10%, Azul 14%, United Site Services 8%), and ConvergeOne's exclusive 10% backstop plus a discounted direct investment gave majority lenders 31% more than excluded lenders and was reversed in September 2025 on equal-treatment grounds, so any exclusive backstop now needs a market test. Roughly 65% of 2025 defaults were distressed exchanges, and one in four soft credit events later becomes a hard default, more than 70% of those within two years - so note which cases were second-bite restructurings. 4. Compute the medians with calc: recovery by lien class, plan EV / EBITDA at emergence, exit leverage, and days from petition to effective date.
Budget about 25 tool calls: report the cases you fully extracted and say which candidates went unread.
Produce: kpis (cases found, median first-lien recovery, median unsecured recovery, median days in court, median backstop fee); table "Precedent restructurings" (Debtor, Petition date, Type, Funded debt, Plan EV, 1L recovery, 2L recovery, Unsecured recovery, Fulcrum, Equity split, Rights offering and discount, Backstop fee, MIP, Exit leverage, Days, Source); bar of first-lien recovery by case; bullets "Terms worth copying or resisting"; caveats (disclosure statements and plan supplements live on PACER and the claims-agent microsites, so EDGAR coverage is partial and estimated recoveries in a disclosure statement are the proponent's estimates, not outcomes).`,
    prompt: (i) => `Build a precedent restructuring comp set of ${num(i, "count", 8)} ${str(i, "type", "any").toLowerCase()} cases in ${str(i, "sector")} since ${str(i, "from", "2023-01-01")}.`,
  },
  {
    kind: "ai", id: "rx-first-day-declaration", title: "First-day declaration summarizer", tagline: "Capital structure, events leading to filing, DIP terms and RSA milestones in one case sheet.",
    description: "Turns the first-day declaration and the petition 8-K into the case sheet a restructuring team works from: the corporate and obligor structure, the prepetition capital structure, liquidity at filing, the dated narrative of what went wrong, the relief requested on day one, the DIP terms and the restructuring support agreement's support levels and milestones.",
    roles: ["banker", "markets"], specialties: [RX], category: "Credit & restructuring", icon: "FileSearch", deliverable: "analysis", savesMinutes: 180, tags: ["first-day declaration", "chapter 11", "case sheet"],
    fields: [
      { key: "company", label: "Company / case", type: "text", required: true, placeholder: "Lumen Technologies" },
      { key: "ticker", label: "Ticker (if public)", type: "ticker", placeholder: "LUMN" },
      { key: "docUrl", label: "Declaration or 8-K URL (optional)", type: "text", placeholder: "https://www.sec.gov/Archives/edgar/data/..." },
    ],
    example: { company: "Lumen Technologies - hypothetical prearranged case", ticker: "LUMN", docUrl: "" },
    effort: "high",
    instructions: `1. Find the filing: if a URL is given, read_document on it; otherwise get_recent_filings with forms ["8-K"] for the ticker and edgar_fulltext_search with forms ["8-K"], the entity name and the phrases "Item 1.03" and "voluntary petition". 2. read_document with the queries "Events Leading to", "Capital Structure", "Prepetition Indebtedness", "Corporate History", "liquidity", "debtor-in-possession", "Restructuring Support Agreement", "Milestones", "first day", "cash management", "critical vendor" and "employee wages". The first-day declaration plus the disclosure statement carry roughly 80% of what a banker needs. 3. Where the declaration is not on EDGAR, reconstruct the capital structure from the last 10-Q debt footnote with search_filing on "Indebtedness", "Credit Agreement" and "Senior Notes", and say plainly that you did so. 4. Structure the output: obligor and guarantor map with which entities filed; capital structure by tranche in priority order with amounts and maturities; liquidity at filing (cash, availability, letters of credit, restricted cash); the dated chain of events; prepetition negotiations and the parties and advisers involved; first-day relief; DIP terms; RSA support percentage, treatment term sheet and milestones. 5. Voting and confirmation context: a class accepts with two-thirds in amount and one-half in number of those voting, so the support percentage in the RSA tells you how contested the case will be.
Budget about 18 tool calls: the declaration and the last debt footnote are enough for the case sheet.
Produce: kpis (funded debt at filing, cash at filing, DIP new money, RSA support %, first milestone date); table "Prepetition capital structure" in priority order; timeline "Events leading to the filing" with dates; bullets "Day-one relief requested"; table "DIP and RSA terms" (Term, Detail, Source); checklist of the standard first-day motions (cash management, wages and benefits, critical vendors, utilities, taxes, insurance, NOL protection, claims agent, DIP and cash collateral, bidding procedures if a sale case); caveats (PACER and the claims-agent microsites hold the declaration, motions and orders; EDGAR only has what the registrant filed).`,
    prompt: (i) => `Summarize the first-day declaration and petition for ${str(i, "company")}${str(i, "ticker") ? ` (${str(i, "ticker").toUpperCase()})` : ""}.${str(i, "docUrl") ? ` Document: ${str(i, "docUrl")}` : ""}`,
  },
  {
    kind: "ai", id: "rx-keip-kerp-benchmark", title: "KEIP / KERP benchmark", tagline: "Test the proposed metrics and cost against precedent plans and the Dana factors.",
    description: "Benchmarks a proposed key employee incentive or retention plan against precedent cases and the legal standard: whether the plan is incentivizing or retentive under section 503(c), how the metrics compare with plan projections, cost as a percentage of salary and of EBITDA, and the objections a creditors' committee or the US Trustee will raise.",
    roles: ["banker"], specialties: [RX], category: "Credit & restructuring", icon: "Users", deliverable: "table", savesMinutes: 150, tags: ["KEIP", "KERP", "Dana factors"],
    fields: [
      { key: "company", label: "Company / case", type: "text", required: true, placeholder: "Alkegen" },
      { key: "plan", label: "Proposed plan", type: "textarea", required: true, placeholder: "7 insiders, target payout 75% of base at $180mm EBITDA, stretch 125% at $205mm, liquidity gate $50mm, emergence by June 30" },
      { key: "cost", label: "Total plan cost at target", type: "number", unit: "$mm", default: 8 },
      { key: "ebitda", label: "Plan-year EBITDA", type: "number", unit: "$mm", default: 180 },
    ],
    example: { company: "Alkegen - hypothetical case", plan: "7 insiders (CEO, CFO, COO, GC, 3 EVPs); KEIP target payout 75% of base salary at $180mm EBITDA, threshold 50% at $160mm, stretch 125% at $205mm; liquidity gate of $50mm minimum; emergence-by-June-30 modifier; separate KERP for 140 non-insiders at 20% of base", cost: 8, ebitda: 180 },
    effort: "medium",
    instructions: `1. Precedents: edgar_fulltext_search with forms ["8-K"] and the phrases "key employee incentive plan", "key employee retention plan" and "incentive plan for certain insiders" over the last 24-36 months; read_document on the exhibits for participants, metrics, threshold/target/stretch payouts, total cost and how the court treated it. 2. Apply the legal standard: section 503(c)(1) bars retention payments to insiders absent a bona fide competing offer and strict tests, so insider plans must be incentivizing; a KEIP is judged under section 503(c)(3) and the Dana factors - is there a reasonable relationship between the plan and the results to be obtained, is the cost reasonable in the context of the debtor's assets and liabilities, is the scope fair and reasonable, is it consistent with industry standards, did the debtor conduct due diligence in developing it, and did the debtor receive independent counsel. 3. Test the metrics with calc: how much stretch sits between the threshold and the business plan (a threshold at or below plan is the classic objection because it pays for showing up), cost as a percentage of aggregate base salary, cost as a percentage of plan-year EBITDA and of funded debt, and the payout at each EBITDA outcome. Metrics should be tied to things the participants control: EBITDA, liquidity, emergence date, sale price. 4. Separate the insider KEIP from the non-insider KERP and check that no participant is an insider by function even if not by title.
Produce: kpis (cost at target, cost as % of salary, cost as % of EBITDA, stretch above plan, participants); table "Benchmark against precedents" (Case, Participants, Metrics, Target payout % of salary, Total cost, % of EBITDA, Outcome, Source); score block on the six Dana factors with a note for each; bullets "Objections to expect" from the committee and the US Trustee, with the answer; risks; caveats (KEIP motions and orders are court documents on PACER and the claims-agent sites; only some appear on EDGAR, and none of this is legal advice).`,
    prompt: (i) => `Benchmark this KEIP/KERP for ${str(i, "company")} against precedent plans and the Dana factors. Cost at target $${num(i, "cost", 8)}mm on $${num(i, "ebitda", 180)}mm of plan-year EBITDA.\n\nProposed plan:\n${str(i, "plan")}`,
  },
  {
    kind: "ai", id: "rx-exit-financing", title: "Exit financing & emergence capital structure", tagline: "The pro forma cap structure at emergence, and whether the plan is feasible.",
    description: "Builds the emergence capital structure from the plan terms - reinstated debt, take-back paper, a new exit facility, equitization and the rights offering - then tests leverage, coverage and liquidity at exit and runs the feasibility case required by section 1129(a)(11), including a downside where EBITDA falls 20%.",
    roles: ["banker"], specialties: [RX, LEV], category: "Credit & restructuring", icon: "Rocket", deliverable: "model", savesMinutes: 210, tags: ["exit financing", "feasibility", "emergence"],
    fields: [
      { key: "company", label: "Company / case", type: "text", required: true, placeholder: "Carnival - hypothetical plan" },
      { key: "ticker", label: "Ticker (if public)", type: "ticker", placeholder: "CCL" },
      { key: "exitEbitda", label: "Exit-year EBITDA", type: "number", unit: "$mm", required: true, default: 500 },
      { key: "targetLeverage", label: "Target exit leverage", type: "number", unit: "x", default: 3.5 },
      { key: "structure", label: "Exit structure", type: "multiselect", options: ["New exit term loan", "Exit revolver / ABL", "Take-back paper to 1L", "Rights offering", "Equitization of unsecured", "DIP-to-exit conversion"], default: ["New exit term loan", "Exit revolver / ABL", "Take-back paper to 1L", "Rights offering", "Equitization of unsecured"] },
    ],
    example: { company: "Carnival Corporation - hypothetical plan", ticker: "CCL", exitEbitda: 5800, targetLeverage: 3.5, structure: ["New exit term loan", "Exit revolver / ABL", "Take-back paper to 1L", "Rights offering", "Equitization of unsecured", "DIP-to-exit conversion"] },
    effort: "high",
    instructions: `1. If a ticker is given, get_company_financials and search_filing on the 10-K for "Indebtedness", "Credit Agreement" and "Senior Notes" to anchor the prepetition structure. 2. Size the exit structure with calc: total exit debt = target leverage x exit EBITDA; allocate across a new exit term loan, an exit revolver or ABL sized to the borrowing base and a minimum liquidity target, and take-back paper to the classes being reinstated; the balance of claims equitizes. Include the rights offering (size, discount to plan value, backstop fee) and any DIP-to-exit conversion, and net out plan-effective payments (administrative and priority claims, cure costs, professional fees, exit fees). 3. Price the exit debt against the market and precedents: edgar_fulltext_search with forms ["8-K"] and the phrases "exit facility", "exit term loan" and "upon emergence" over the last 24 months, then read_document for rate, tenor, covenants and fees; recent reference points are loan yields of 8.21% and OAS of 453bps in June 2026, unitranche all-in 9.0-11.0% versus 7.5-9.5% for broadly syndicated loans, and Alkegen's conversion of its DIP into a $400M exit facility. 4. Test feasibility for section 1129(a)(11): five-year projections with leverage, EBITDA less capex over cash interest, fixed-charge coverage and liquidity at each year end; then a downside case with EBITDA 20% below plan and check covenant compliance and whether the company can still fund maturities. Feasibility means the plan is not likely to be followed by liquidation or a further restructuring. 5. Note the best-interests test (each dissenting holder must do at least as well as in a Chapter 7 liquidation) and, where a class rejects, cramdown under section 1129(b).
Produce: kpis (exit debt, exit leverage, liquidity at emergence, cash interest, coverage, rights offering proceeds); table "Pro forma capital structure at emergence" (Tranche, Amount, Rate, Maturity, Source of claim); table "Feasibility projections" by year (EBITDA, capex, cash interest, FCF, leverage, coverage, liquidity) with a downside row set; sensitivity of exit coverage to leverage and EBITDA; risks (refinancing, covenant, liquidity, execution) with severity; caveats (pricing is market-implied and dated, and the plan's classification and treatment are the proponent's terms).`,
    prompt: (i) => `Build the emergence capital structure and feasibility case for ${str(i, "company")} at $${num(i, "exitEbitda", 500)}mm of exit EBITDA and ${num(i, "targetLeverage", 3.5)}x target leverage, using: ${list(i, "structure").join(", ")}.`,
  },
];

/* ======================================================================================
 * Leveraged finance, DCM, ECM and sponsors: AI workflows
 * ====================================================================================== */

const CM_WORKFLOWS: ToolDef[] = [
  {
    kind: "ai", id: "lev-credit-comps", title: "Credit comps builder", tagline: "Issuer, tranche, coupon, spread and leverage in one grid, from filings.",
    description: "Builds the leveraged finance credit comp grid: for each issuer the tranche structure with coupon, tenor, security and spread at issue from FWPs and prospectus supplements, plus total, senior and net leverage, EBITDA to interest coverage and fixed-charge coverage from XBRL, so a new structure can be priced against real precedents.",
    roles: ["banker", "pe", "markets"], category: "Capital markets", icon: "Table", deliverable: "table", savesMinutes: 210, tags: ["credit comps", "leverage", "spreads"],
    fields: [
      { key: "tickers", label: "Issuers", type: "tickers", required: true, placeholder: "CHTR WBD CCL AAL" },
      { key: "tranches", label: "Tranches to include", type: "multiselect", options: ["Revolver / ABL", "Term loan A", "Term loan B", "Second lien", "Senior secured notes", "Senior unsecured notes", "Subordinated / PIK", "Convertible"], default: ["Term loan B", "Senior secured notes", "Senior unsecured notes"] },
      { key: "band", label: "Rating band", type: "select", options: ["Any", "BB", "B", "CCC", "Investment grade crossover"], default: "Any" },
    ],
    example: { tickers: ["CHTR", "WBD", "CCL", "AAL"], tranches: ["Term loan B", "Senior secured notes", "Senior unsecured notes"], band: "B" },
    effort: "high",
    instructions: `1. For each issuer call get_company_financials, then get_xbrl_series with find "Debt|Notes|InterestExpense|LineOfCredit" and pull the debt and interest concepts so leverage and coverage come from tagged data. 2. search_filing on the 10-K for "Senior Notes", "Credit Agreement", "interest rate", "Applicable Margin" and "aggregate maturities" to get each tranche's coupon, maturity and security, expanding with read_filing. 3. Pricing at issue: get_recent_filings with forms ["FWP","424B5","424B2","8-K"] and read_document with the queries "Spread to Benchmark Treasury", "Interest Rate", "Maturity Date", "Underwriting Discount" and "Applicable Margin"; for loans, edgar_fulltext_search with forms ["8-K"] and the phrase "Credit Agreement" plus the issuer name and read the EX-10 for the margin grid, SOFR floor, OID and amortization. 4. Compute with calc: total, senior secured and net leverage, EBITDA / cash interest, (EBITDA - capex) / cash interest, and spread-to-worst for loans on the market convention of a four-year average life including OID accretion. 5. Anchor relative value on dated market levels (HY OAS 265bps with BB 162, B 293 and CCC 960; loan yields 8.21% and OAS 453bps in June 2026; SOFR 3.73%; IG OAS 81bps and BBB 99bps on 1 September 2026) and use web_research only for those levels, dating each.
Produce: kpis (issuers covered, median total leverage, median coupon or spread, median coverage); table "Credit comps" (Issuer, Ratings if disclosed, Tranche, Size, Coupon / spread, Maturity, Security, Total leverage, Senior leverage, EBITDA/interest, Source); scatter of total leverage against coupon or spread; bullets "Relative value" naming which tranche looks cheap or rich and why; caveats (TRACE secondary levels, index OAS by rating, and loan-level OID, flex and secondary marks are vendor-licensed; ratings are only included where the filing discloses them; 144A high-yield notes only appear on EDGAR if an exchange-offer S-4 is filed).`,
    prompt: (i) => `Build a credit comps grid for ${list(i, "tickers").join(", ")} covering ${list(i, "tranches").join(", ")}${str(i, "band") !== "Any" ? ` in the ${str(i, "band")} band` : ""}.`,
  },
  {
    kind: "ai", id: "lev-term-sheet-grid", title: "Term sheet grid generator", tagline: "TLB versus unitranche versus high yield, priced and papered side by side.",
    description: "Produces the leveraged finance structuring grid: each financing option with size, tenor, pricing, floor, OID, call protection, covenants, amortization, sweep, incremental capacity, MFN and add-back caps, converted to an all-in yield over a four-year life, with the trade-offs the sponsor is actually choosing between.",
    roles: ["banker", "pe"], specialties: [LEV, SPON, "DCM"], category: "Capital markets", icon: "FileSpreadsheet", deliverable: "table", savesMinutes: 240, tags: ["term sheet", "unitranche", "TLB", "flex"],
    fields: [
      { key: "borrower", label: "Borrower", type: "text", required: true, placeholder: "Project Atlas (sponsor-backed software)" },
      { key: "ticker", label: "Public comparable", type: "ticker", placeholder: "DDOG" },
      { key: "ebitda", label: "EBITDA", type: "number", unit: "$mm", required: true, default: 150 },
      { key: "purpose", label: "Purpose", type: "select", options: ["LBO", "Refinancing", "Dividend recap", "Add-on acquisition", "Amend and extend"], default: "LBO" },
      { key: "structures", label: "Structures", type: "multiselect", options: ["Revolver", "Term loan A", "Term loan B", "Second lien", "Unitranche (private credit)", "Senior secured notes", "Senior unsecured notes", "Preferred / HoldCo PIK"], default: ["Revolver", "Term loan B", "Unitranche (private credit)", "Senior unsecured notes"] },
    ],
    example: { borrower: "Project Atlas - sponsor-backed vertical software", ticker: "DDOG", ebitda: 150, purpose: "LBO", structures: ["Revolver", "Term loan B", "Unitranche (private credit)", "Senior unsecured notes"] },
    effort: "high",
    instructions: `1. Fresh precedents: edgar_fulltext_search with forms ["8-K"] and the phrases "Credit Agreement" and "Applicable Margin" plus sector keywords over the last 12 months, then read_document on the EX-10 for the margin grid, SOFR floor, incremental basket, MFN and sunset, excess cash flow sweep, soft call, amortization and EBITDA add-back caps. Live reference points to cite: TTM Technologies' June 2026 TLB of $400M at S+175 with an incremental basket of the greater of $490M and 100% of consolidated EBITDA and run-rate cost savings capped at 30% of EBITDA; DraftKings' August 2026 Term B-2 of $700M at S+200 (B-1 at S+175); AECOM's grid stepping from S+200/ABR+100 above 4.25x to S+125 below 2.5x with 15-30bp commitment fees and restructuring and synergy add-backs each capped at 25% of EBITDA. 2. Build the grid for each selected structure with calc, sizing tranches off the EBITDA input and the purpose: 2026 market structure is total leverage 4.0-5.0x for middle-market and 5.0-6.0x for upper-middle-market quality credits, with sponsor equity of 45-55% of the price and dividend recaps averaging 5.04x (22% at 6x or more). Pricing: broadly syndicated TLB at SOFR+300-425 with a 0-0.75% floor and OID of 99.0-99.75 converted to yield over a four-year life, soft call 101 for six months, cov-lite (over 90% of new BSL) with a springing revolver test above 35-40% utilization; unitranche at roughly S+525 new issue with all-in 9.0-11.0% versus 7.5-9.5% for BSL, 12 months of 101 call protection and maintenance covenants set with a 25-35% cushion; high yield with 2-4 years of non-call, a call schedule stepping from par plus half the coupon, a 35-40% equity clawback and a change-of-control put at 101. Arranger economics: 1-5% of the commitment, with first-lien TLB underwriting fees of 2.00-2.25% and second lien 2.50-3.00%; market flex of 100-150bps with no more than about 62.5bps taken as OID, 25bp step-ups at 120 and 180 days, a 25bp ratings flex, and ticking fees of 0% for 30 days, then 50% and then 100% of margin. 3. For each structure compute all-in yield at a four-year life (base rate + spread + OID accretion), annual cash interest, the leverage and coverage it implies, and what the borrower gives up (covenants, call protection, certainty, speed).
Produce: kpis (all-in yield by structure, total quantum, pro forma leverage, cash interest, coverage); table "Term sheet grid" with one column per structure and rows for size, tenor, pricing, floor, OID, all-in yield, call protection, covenants, amortization, ECF sweep, incremental, MFN, add-back cap and fees; bar of all-in cost by structure; bullets "Trade-offs and recommendation" (price against certainty, flex risk, documentary flexibility); caveats (private credit terms are not filed anywhere and are inferred from BDC disclosure; flex actually exercised and OID levels come from licensed loan data).`,
    prompt: (i) => `Build a term sheet grid for ${str(i, "borrower")} at $${num(i, "ebitda", 150)}mm EBITDA for a ${str(i, "purpose", "LBO").toLowerCase()} across: ${list(i, "structures").join(", ")}.`,
  },
  {
    kind: "ai", id: "lev-agency-leverage", title: "Reported vs covenant vs agency leverage", tagline: "The three leverage numbers on one bridge, with every adjustment named.",
    description: "Bridges reported Debt/EBITDA to credit-agreement leverage and to rating-agency adjusted leverage: lease and pension adjustments, hybrids at partial equity credit, securitizations and receivables facilities, and the EBITDA add-backs the agencies reject, ending in the ratios the agencies actually grid (adjusted Debt/EBITDA, FFO/debt, RCF/net debt, coverage).",
    roles: ["banker", "corpfin"], specialties: ["DCM", LEV, SPON], category: "Credit & restructuring", icon: "Gauge", deliverable: "analysis", savesMinutes: 180, tags: ["ratings", "adjusted leverage", "FFO/debt"],
    fields: [
      { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "WBD" },
      { key: "agency", label: "Agency methodology", type: "select", options: ["Moody's", "S&P", "Fitch"], default: "S&P" },
      { key: "addbacks", label: "Credit-agreement add-backs claimed", type: "number", unit: "$mm", default: 0 },
    ],
    example: { ticker: "WBD", agency: "S&P", addbacks: 400 },
    effort: "high",
    instructions: `1. get_company_financials for reported debt, cash, EBITDA and cash flow, then get_xbrl_series with find "Debt|Lease|Pension|Securitization|InterestExpense|PreferredStock" and pull the concepts you need. 2. search_filing on the 10-K for "operating lease liabilities", "finance lease", "projected benefit obligation", "underfunded", "accounts receivable securitization", "asset retirement obligation", "redeemable preferred", "hybrid", "guarantee" and "Adjusted EBITDA" so every adjustment has a source; expand with read_filing. 3. Build the three columns with calc. As reported: balance-sheet debt over reported EBITDA (operating income plus D&A). Credit agreement: the company's defined EBITDA including the add-backs claimed (run-rate cost savings and synergies are commonly capped at 25-30% of EBITDA - AECOM at 25%, TTM at 30% - and S&P has found realized EBITDA about 30% below inception projections, so show the add-back as a separate line and note the cap), net of balance-sheet cash if the covenant is a net test. Agency adjusted: add the reported ASC 842 lease liability (S&P uses the reported liability and haircuts artificially short leases, while Fitch instead capitalizes rent at a sector multiple), the underfunded pension net of tax, securitizations and receivables facilities, asset retirement obligations, hybrids at the equity credit the methodology assigns (commonly 50%), and guarantees of non-consolidated debt; remove the add-backs the agency does not accept and adjust for the agency's treatment of stock-based compensation and rent. 4. Compute the agency ratios: adjusted Debt/EBITDA, FFO/debt, RCF/net debt, EBITDA/interest and FOCF/debt, and map them to the methodology's financial risk categories (minimal, modest, intermediate, significant, aggressive, highly leveraged). Say which category the issuer lands in and what would move it a notch.
Produce: kpis (reported leverage, covenant leverage, agency-adjusted leverage, FFO/debt, EBITDA/interest); table "Leverage bridge" with three columns and one row per adjustment, each with its amount and source; waterfall from reported debt to agency-adjusted debt; callout on the rating implication and the headroom to the next category; caveats (agency methodologies are public but notching, business risk and financial policy assessments are judgment, and agency reports and grids are paid products - this is an approximation of the published method, not a rating).`,
    prompt: (i) => `Bridge reported, credit-agreement and ${str(i, "agency", "S&P")}-adjusted leverage for ${str(i, "ticker").toUpperCase()}${num(i, "addbacks") ? ` with $${num(i, "addbacks")}mm of claimed add-backs` : ""}.`,
  },
  {
    kind: "ai", id: "lev-lender-presentation", title: "Lender & rating agency presentation outline", tagline: "The bank meeting deck, the agency deck or the credit committee memo, section by section.",
    description: "Outlines the leveraged finance credit story in the format the audience expects: a lender presentation for the bank meeting, a rating agency presentation built around the agency's own factors, or an internal credit committee memo, each with the EBITDA bridge, the downside case and the hardest questions answered.",
    roles: ["banker"], specialties: [LEV, "DCM", SPON, RX], category: "Deliverables", icon: "Presentation", deliverable: "deck", savesMinutes: 210, tags: ["lender presentation", "rating agency", "credit committee"],
    fields: [
      { key: "borrower", label: "Borrower", type: "text", required: true, placeholder: "Project Atlas" },
      { key: "ticker", label: "Company or comparable", type: "ticker", placeholder: "CCL" },
      { key: "audience", label: "Deliverable", type: "select", options: ["Lender presentation (bank meeting)", "Rating agency presentation", "Internal credit committee memo", "Sponsor financing update"], default: "Lender presentation (bank meeting)" },
      { key: "deal", label: "Transaction", type: "text", required: true, placeholder: "$1.2bn TLB and $300mm revolver to fund the acquisition, 4.5x total leverage" },
    ],
    example: { borrower: "Carnival Corporation", ticker: "CCL", audience: "Rating agency presentation", deal: "$3.0bn senior unsecured notes to refinance secured debt and extend maturities, targeting a return to investment grade" },
    effort: "medium",
    instructions: `1. get_company_financials for the borrower or its public comparable and search_filing on the 10-K for "Adjusted EBITDA", "Indebtedness", "liquidity and capital resources", "covenant", "backlog" or the sector KPI, and "risk factors"; expand the EBITDA reconciliation with read_filing. 2. Build the outline for the chosen audience. Lender presentation: transaction overview and sources and uses; investment highlights; business and product overview; industry and competitive position; management; historical financials with the bridge from reported to adjusted EBITDA and support for every add-back; projections with a management case and a downside case; credit highlights and considerations with mitigants; capital structure, covenants and liquidity; syndication timetable and the bank meeting logistics. Rating agency presentation: business risk profile (scale, diversification, competitive position), financial policy and the sponsor's or board's stated leverage target, leverage and coverage under the agency's own adjustments, liquidity sources and uses over 12-24 months, downside case, and the path to the target rating. Credit committee memo: situation overview, credit considerations, risk factors and mitigants, transaction analytics, capital structure, comps, underwriting and hold recommendation with flex assumptions. 3. For each section give the message, the exhibit and the data source. 4. Add the EBITDA bridge explicitly: reported EBITDA, non-recurring items, run-rate synergies with their cap, pro forma acquisitions, and the diligence that supports each - this is the number lenders and agencies attack first.
Produce: steps with one entry per section (title plus what goes on the pages); table "Adjusted EBITDA bridge" (Item, Amount, Support, Who signs off); qa "Hardest questions" (10 with answers: add-back quality, customer concentration, cyclicality, covenant headroom, capex flexibility, refinancing risk, financial policy); checklist of materials to prepare (model, quality-of-earnings report, ratings drafts, legal papers); caveats (agency ratings and investor demand are not predictable from filings, and any projection shown to lenders needs client sign-off).`,
    prompt: (i) => `Outline a ${str(i, "audience", "lender presentation").toLowerCase()} for ${str(i, "borrower")}: ${str(i, "deal")}.`,
  },
  {
    kind: "ai", id: "ecm-ipo-valuation", title: "IPO valuation & discount workflow", tagline: "Comps to value, the IPO discount to a range, and what the range implies for ownership.",
    description: "Runs the IPO valuation the way an ECM desk does: value the issuer on trading comps and precedent IPOs, apply the IPO discount, set a range about 10-15% wide, then show post-money ownership, dilution under S-K Item 506, the step-up to the last private round, and what history says about pricing inside, above or below the range.",
    roles: ["banker", "corpfin", "vc"], category: "Capital markets", icon: "Rocket", deliverable: "analysis", savesMinutes: 240, tags: ["IPO", "valuation", "discount"],
    fields: [
      { key: "company", label: "Issuer", type: "text", required: true, placeholder: "Atlas Observability, Inc." },
      { key: "comps", label: "Trading comps", type: "tickers", required: true, placeholder: "DDOG SNOW MDB NET" },
      { key: "revenue", label: "Forward revenue", type: "number", unit: "$mm", required: true, default: 400 },
      { key: "growth", label: "Forward growth", type: "number", unit: "%", default: 35 },
      { key: "shares", label: "Pre-IPO shares", type: "number", unit: "mm", default: 200 },
      { key: "primary", label: "Primary shares offered", type: "number", unit: "mm", default: 20 },
      { key: "lastRound", label: "Last private round valuation", type: "number", unit: "$mm", default: 2100 },
    ],
    example: { company: "Atlas Observability, Inc.", comps: ["DDOG", "SNOW", "MDB", "NET"], revenue: 400, growth: 35, shares: 200, primary: 20, lastRound: 2100 },
    effort: "high",
    instructions: `1. get_trading_comps for the comp set and get_company_financials on the two closest names; compute each comp's EV/revenue on the metric you are using and the growth and margin behind it, and pick the percentile you would argue for, stating why. Software reference points: median EV/NTM revenue fell to 3.6x in February 2026, a ten-year low, and September 2026 medians ran 2.1x horizontal, 2.2x vertical and 2.9x infrastructure SaaS, with net revenue retention above 120% commanding roughly 21x versus 9x. Growth-adjusted multiples (multiple divided by growth, or the Rule of 40 regression) are how the range is defended. 2. Precedent IPOs: edgar_fulltext_search with forms ["424B4"] and the phrases "initial public offering" plus sector keywords from the last 18-24 months; read_document for the offer price, shares and post-offering share count so you can compute the multiple at pricing, and compare the step-up to the issuer's last private round. 3. Apply the IPO discount: conventionally 10-15% off the trading-comp value to leave a first-day return, then set a range about 10-15% wide around the midpoint. History from 1980-2025: 28% of IPOs priced below the range, 49% inside and 23% above, with average first-day returns of roughly 3%, 12% and 50% respectively - the partial adjustment effect - and 2025's mean first-day return was 29.3% with $13.1B left on the table on $39.0B of proceeds. 4. Compute with calc: EV and equity value at the comp multiple and after the discount, price per share on post-offering shares, market cap, proceeds gross and net of a gross spread (7.0% is standard for deals of $30-160M and 93.3% of them price exactly there; above $160M more than half price below 7%, and megadeals price far lower - Cerebras' May 2026 $5.55B deal carried a 2.35% spread), float percentage, primary versus secondary split, and dilution per S-K Item 506 (net tangible book value per share before and after). 5. State the all-in cost of going public: on a $200M IPO roughly $22-30M or 11-15% of proceeds including counsel, audit and comfort, D&O and exchange fees, with $8-15M per year of ongoing public-company cost.
Produce: kpis (comp multiple used, EV before and after discount, price range, market cap at the midpoint, float %, primary proceeds); table "Comps" (Company, EV/revenue, growth, margin, Rule of 40); table "Range build" (step, value, per share); bar of implied value by method (comps, precedent IPOs, discount applied); sensitivity of price per share to multiple and IPO discount; caveats (there is no consensus NTM data in the platform, so forward figures are the issuer's own; comps are LTM unless the user supplied forward numbers; Renaissance and Ritter statistics are cited from research, not live).`,
    prompt: (i) => `Value ${str(i, "company")} for an IPO on comps ${list(i, "comps").join(", ")} at $${num(i, "revenue", 400)}mm forward revenue growing ${num(i, "growth", 35)}%, offering ${num(i, "primary", 20)}mm primary shares on ${num(i, "shares", 200)}mm pre-IPO shares (last round $${num(i, "lastRound", 2100)}mm).`,
  },
  {
    kind: "ai", id: "ecm-ipo-comps", title: "IPO comps from 424B4s", tagline: "Every recent IPO in the sector: price versus range, spread, greenshoe, lock-up and aftermarket.",
    description: "Builds the IPO comp set from final prospectuses on EDGAR: pricing versus the filed range, base and upsized shares, primary and secondary split, gross spread in percent and dollars, greenshoe and directed share program, lock-up terms, bookrunner line-up, and the return from offer where the issuer now trades.",
    roles: ["banker", "vc", "corpfin"], category: "Capital markets", icon: "ScrollText", deliverable: "table", savesMinutes: 270, tags: ["IPO comps", "424B4", "gross spread"],
    fields: [
      { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "software cloud artificial intelligence" },
      { key: "from", label: "From", type: "date", default: "2025-01-01" },
      { key: "minSize", label: "Minimum deal size", type: "number", unit: "$mm", default: 200 },
      { key: "count", label: "IPOs", type: "number", default: 10, min: 4, max: 20 },
    ],
    example: { sector: "software cloud artificial intelligence semiconductor", from: "2025-01-01", minSize: 200, count: 10 },
    effort: "high",
    instructions: `1. edgar_fulltext_search with forms ["424B4"], the sector keywords plus the phrase "over-allotment option", from the start date; run a second variant with "initial public offering of" to catch misses, and de-duplicate by issuer. 2. For each IPO, read_document with the queries "Price to public", "Underwriting discounts and commissions", "Proceeds, before expenses", "over-allotment", "lock-up", "directed share program", "shares of common stock outstanding after this offering", "Joint Book-Running Managers" and "Nasdaq" or "New York Stock Exchange". Extract the offer price, base shares, primary versus secondary split, gross spread per share and in total, the greenshoe (15% for 30 days is standard), the directed share program, the lock-up length and any early-release trigger, the bookrunner and co-manager line-up, and the post-offering share count. 3. Get the filed range from the same issuer's S-1/A: edgar_fulltext_search with forms ["S-1/A","424B4"] and the entity plus "per share" and read the cover; classify each deal as priced below, within or above the range and note upsizing. 4. Aftermarket: get_company_financials for the issuer's current price and compute the return from offer with calc; where the ticker is unavailable say so rather than guessing. 5. Benchmark the spread: 93.3% of deals raising $30-160M carried exactly 7.0%, and 86.1% of $160-200M deals did too; above $160M, 54.4% priced below 7%; megadeals price far lower (Cerebras' May 2026 $5.55B at 2.35%, with a 4.5M-share greenshoe and ten co-managers; Gloo's July 2026 $22.75M at 6.0%). The 20/20/60 management, underwriting and selling concession split governs how the spread is shared.
Budget about 25 tool calls: if the budget runs out mid-set, report the IPOs you fully extracted and say how many candidates were left unread.
Produce: kpis (IPOs found, median deal size, median gross spread, share priced above range, median return from offer); table "IPO comps" (Priced, Issuer, Exchange, Filed range, Price, Versus range, Base / upsized shares, Primary / secondary, Proceeds, Spread %, Greenshoe, Lock-up, Bookrunners, Return from offer, Source); bar of gross spread by deal size; columns chart of the pricing-outcome distribution (below, within, above); bullets "What the set says about the window"; caveats (first-day and 30-day returns need a price history the platform does not store, so returns are from offer to the latest price; Renaissance and Ritter full statistics are licensed; foreign private issuers file F-1 and 424B4 variants with different cadence).`,
    prompt: (i) => `Build an IPO comp set of ${num(i, "count", 10)} ${str(i, "sector")} IPOs above $${num(i, "minSize", 200)}mm since ${str(i, "from", "2025-01-01")} from their 424B4s.`,
  },
  {
    kind: "ai", id: "ecm-dual-track", title: "Dual-track: IPO versus sale", tagline: "Two exit paths priced against each other, with the calendar overlaid.",
    description: "Compares an IPO exit with a sale on the terms a sponsor actually decides on: IPO value after the discount with only a partial sell-down and a 180-day lock-up, against a control premium with full certainty and immediate proceeds, including the after-tax proceeds and DPI impact, and the calendar overlay that shows when the decision must be made.",
    roles: ["banker", "pe"], specialties: ["ECM", SPON, ...COV], category: "Capital markets", icon: "Split", deliverable: "analysis", savesMinutes: 210, tags: ["dual track", "exit", "IPO vs sale"],
    fields: [
      { key: "company", label: "Company", type: "text", required: true, placeholder: "Atlas Observability, Inc." },
      { key: "comps", label: "Trading comps", type: "tickers", required: true, placeholder: "DDOG SNOW NET" },
      { key: "ebitda", label: "EBITDA (or revenue for a growth asset)", type: "number", unit: "$mm", required: true, default: 120 },
      { key: "sellDown", label: "IPO sell-down at pricing", type: "number", unit: "%", default: 15 },
      { key: "bids", label: "M&A indications received", type: "textarea", placeholder: "Strategic A: $3.1bn, all cash, financing committed; Sponsor B: $3.3bn with a financing condition" },
    ],
    example: { company: "Atlas Observability, Inc.", comps: ["DDOG", "SNOW", "NET"], ebitda: 120, sellDown: 15, bids: "Strategic A: $3.1bn all cash, financing committed, 5-month antitrust timeline; Sponsor B: $3.3bn with a financing condition and a 3% reverse termination fee" },
    effort: "high",
    instructions: `1. get_trading_comps for the comp set and value the company on the sector multiple; apply the conventional 10-15% IPO discount and state the range. 2. IPO path with calc: value at pricing after the discount, only the sell-down percentage monetized at IPO, the remaining stake marked at the IPO price but subject to a 180-day lock-up (early-release triggers are increasingly common) and aftermarket risk, then the expected value of selling down in follow-ons at a 3-8% marketed discount or 6-12% overnight; net of a gross spread of about 7% for a mid-size deal and $22-30M of all-in costs on a $200M raise; show the present value at the sponsor's cost of equity over the time to full exit. 3. Sale path: control premium of 25-50% on the public-equivalent value, or the indications given in the bids field; net of fees; full liquidity at close; adjust for certainty (financing condition, regulatory timeline, reverse termination fee) and for any rollover or earnout. Verify premium benchmarks with edgar_fulltext_search on forms ["DEFM14A","8-K"] with "agreement and plan of merger" plus sector keywords. 4. Calendar overlay: the auction customarily launches with the initial S-1 filing, and the decision to sell is normally made before the roadshow; SEC first comments arrive in roughly 30 days with 60-90 days to clear, then the public flip, testing-the-waters, an 8-10 day roadshow and pricing, while the auction runs Phase I over 4-6 weeks and Phase II over 4-6 weeks to final bids. Separate data rooms and confidentiality are standard, and underwriters may not know an M&A process is running. 5. Compare after-tax proceeds to the fund, DPI and IRR impact under both paths, and name the decision date.
Produce: kpis (IPO value at pricing, proceeds at IPO, sale value, net proceeds on a sale, difference in present value, decision date); table "Path comparison" (Dimension, IPO, Sale - value, certainty, proceeds now, time to full exit, after-tax proceeds, DPI, residual risk); timeline overlaying both processes with the decision point; risks (market window, aftermarket performance, antitrust, financing) with severity; callout with the recommendation and the condition that would flip it; caveats (no consensus estimates, follow-on discount assumptions are precedent-based, and tax treatment depends on structure).`,
    prompt: (i) => `Run a dual-track comparison for ${str(i, "company")} at $${num(i, "ebitda", 120)}mm EBITDA against comps ${list(i, "comps").join(", ")}, with a ${num(i, "sellDown", 15)}% IPO sell-down.${str(i, "bids") ? `\n\nIndications received:\n${str(i, "bids")}` : ""}`,
  },
  {
    kind: "ai", id: "dcm-new-issue-terms", title: "Bond new-issue terms extractor", tagline: "Every tranche from the FWP and prospectus supplement: spread, make-whole, par call, fees.",
    description: "Turns an issuer's pricing term sheets and prospectus supplements into a tranche table: size, coupon, maturity, benchmark Treasury and spread at issue, make-whole spread, par call date, settlement and underwriting discount by tranche, then plots the issuer's new-issue curve and compares the fees with 2026 benchmarks.",
    roles: ["banker", "corpfin", "markets"], specialties: ["DCM", LEV], category: "Capital markets", icon: "LineChart", deliverable: "table", savesMinutes: 180, tags: ["FWP", "new issue", "spread", "make-whole"],
    fields: [
      { key: "ticker", label: "Issuer", type: "ticker", required: true, placeholder: "XOM" },
      { key: "from", label: "From", type: "date", default: "2025-01-01" },
      { key: "count", label: "Deals to read", type: "number", default: 4, min: 1, max: 10 },
    ],
    example: { ticker: "XOM", from: "2025-01-01", count: 4 },
    effort: "high",
    instructions: `1. get_recent_filings with forms ["FWP","424B2","424B5","8-K"] limit 40 for the issuer and pick the most recent benchmark pricing documents back to the start date. Skip retail structured and equity-linked paper: any document whose title references a linked asset ("Notes Linked to", "Market Linked", "Callable Fixed Rate Notes", "Auto Callable") is a structured note, not benchmark issuance, and large banks file hundreds of them. If the recent filings are dominated by structured notes, switch to edgar_fulltext_search with forms ["FWP"] and the phrase "Pricing Term Sheet" plus the entity name, or read the 8-K announcing the notes offering and its underwriting agreement exhibit. 2. For each, read_document with the queries "Interest Rate", "Maturity Date", "Benchmark Treasury", "Spread to Benchmark Treasury", "Re-offer Yield", "Make-Whole", "Par Call", "Underwriting Discount", "Joint Book-Running Managers", "Settlement Date" and "CUSIP", and build one row per tranche. Where the FWP and the final supplement disagree, the later document wins, and say so. 3. get_company_financials and get_xbrl_series with find "Debt|InterestExpense" for leverage and coverage context at the time of issue. 4. Benchmark the underwriting discount, which scales with tenor rather than size: AbbVie's August 2026 $10.0B nine-tranche deal paid 0.150% on the 2-year fixed and floating, 0.250% on 2030, 0.350% on 2031, 0.375% on 2033, 0.450% on 2036, 0.475% on 2038 and 0.750% on the 30- and 40-year, a total discount of $41.8M or 0.42% of proceeds, priced from T+32 to T+92 with make-wholes of T+5 to T+15, par calls one to six months before maturity and T+10 settlement; Xylem's September 2026 $1.5B acquisition financing paid 0.450% on the 3-year at T+50, 0.600% on the 5-year at T+65 and 0.650% on the 10-year at T+85. High yield typically pays 1.25-2.5% of principal. Third-party claims of "1-2% for investment grade" overstate today's fees by a factor of two to four. 5. Compute with calc the weighted-average coupon, weighted-average life, total fees, and the spread curve by tenor; new-issue concessions ran roughly 3-7bps in Q1 2026 against 8-12bps post-pandemic, but the concession needs a secondary curve, which is not in EDGAR.
Budget about 18 tool calls: read the pricing documents you need for the tranche table, then write the output and list any deal you could not read in caveats.
Produce: kpis (deals read, total issued, weighted-average coupon, weighted-average tenor, total underwriting discount, fees as % of proceeds); table "Tranche terms" (Priced, Size, Coupon, Maturity, Benchmark, Spread, Re-offer yield, Make-whole, Par call, Fee %, Bookrunners, Source); bar of spread by tenor showing the issuer's new-issue curve; bullets "How this priced versus the benchmarks"; caveats (initial price thoughts, guidance, order books and the secondary curve needed for a true new-issue concession are Bloomberg and TRACE data, not EDGAR; 144A deals may never appear).`,
    prompt: (i) => `Extract the new-issue terms for ${str(i, "ticker").toUpperCase()}'s last ${num(i, "count", 4)} bond deals since ${str(i, "from", "2025-01-01")} and build the tranche table and spread curve.`,
  },
  {
    kind: "ai", id: "fsg-sponsor-coverage", title: "Sponsor coverage page", tagline: "A sponsor's funds, portfolio debt, maturities and the deals to pitch them.",
    description: "Builds the financial sponsors coverage page: the firm's funds and vintages from public sources and Form D, its public-company stakes and completed deals from 13D and merger filings, the portfolio companies with public debt mapped by maturity and leverage, and a ranked list of financing and exit ideas with the wallet each represents.",
    roles: ["banker", "pe"], specialties: [SPON, LEV, "ECM", "DCM"], category: "Sourcing & deals", icon: "Briefcase", deliverable: "analysis", savesMinutes: 240, tags: ["sponsors", "portfolio", "wallet"],
    fields: [
      { key: "sponsor", label: "Sponsor", type: "text", required: true, placeholder: "Thoma Bravo" },
      { key: "portfolio", label: "Public portfolio / issuers", type: "tickers", placeholder: "SATS LUMN" },
      { key: "focus", label: "Focus", type: "select", options: ["Financing ideas", "Exit ideas", "New platform ideas", "Full coverage page"], default: "Full coverage page" },
    ],
    example: { sponsor: "Apollo Global Management", portfolio: ["SATS", "LUMN", "AAL"], focus: "Full coverage page" },
    effort: "high",
    instructions: `1. Firm profile: web_research for funds, vintages, fund sizes, dry powder, sector focus and recent exits, dating everything and labeling it web-sourced because fund data is licensed; form_d_search on the sponsor name for fund vehicles and amounts sold, which is the free primary source for a raise. 2. Deal history and stakes: edgar_fulltext_search with forms ["SC 13D","SC 13G","8-K","DEFM14A"] and the sponsor name to find stakes, take-privates and exits, with dates and sizes; read_document on the most recent to confirm terms. 3. Portfolio debt: for each listed portfolio company or issuer call get_company_financials and search_filing on the 10-K for "Indebtedness", "Credit Agreement", "Senior Notes" and "aggregate maturities"; compute leverage, coverage and the maturity profile with calc. 4. Rank the ideas by wallet: refinancing or repricing where the maturity is inside 24 months or the coupon is above market; a dividend recap where capacity exists (2025 sponsored recap volume was $74.3B, up 11%, with 2026 recap leverage averaging 5.04x and 22% of deals at 6x or more, and a solvency opinion is required); an IPO or follow-on where the asset has been held more than four years and the window is open; a sale or continuation vehicle for assets held more than five years; add-on acquisitions for platforms. 5. Track the sponsor metrics the group uses: DPI, TVPI, RVPI, dry powder, remaining investment period, and hold period by asset.
Produce: kpis (funds, estimated dry powder, public portfolio value, portfolio debt maturing inside 24 months, ideas identified); table "Portfolio companies" (Company, Entry date if known, Ownership, EV, Total leverage, Coverage, Nearest maturity, Exit readiness); timeline of portfolio debt maturities; table "Ideas to pitch" (Idea, Company, Product, Size, Wallet, Why now); bullets "Relationship notes" (who covers whom, what they bought last); caveats (fund-level data, dry powder and private portfolio financials are licensed or private; only public stakes, Form D filings and public-company debt are verifiable here).`,
    prompt: (i) => `Build a ${str(i, "focus", "full coverage page").toLowerCase()} for ${str(i, "sponsor")}${list(i, "portfolio").length ? `, covering portfolio issuers ${list(i, "portfolio").join(", ")}` : ""}.`,
  },
];

/* ======================================================================================
 * M&A calculators
 * ====================================================================================== */

const MA_CALCS: ToolDef[] = [
  {
    kind: "calc", id: "ma-accretion-dilution", title: "Merger model: accretion / dilution", tagline: "Offer, sources and uses, purchase accounting, pro forma EPS and the break-even synergies.",
    description: "Builds the strategic buyer's merger model: offer price at a premium, cash and stock funding with new debt and foregone interest, purchase price allocation with intangible amortization and the deferred tax liability, then pro forma EPS for years 1-3 with synergies phased 50/100/100 and the pre-tax synergies needed to break even.",
    roles: ["banker", "corpfin", "pe", "markets", "student"], category: "Modeling", icon: "ArrowLeftRight", savesMinutes: 120, tags: ["accretion", "merger model", "EPS"],
    fields: [
      { key: "acqPrice", label: "Acquirer share price", type: "number", unit: "$", required: true, default: 200 },
      { key: "acqShares", label: "Acquirer diluted shares", type: "number", unit: "mm", required: true, default: 500 },
      { key: "acqNi", label: "Acquirer net income", type: "number", unit: "$mm", required: true, default: 2500 },
      { key: "acqCash", label: "Acquirer cash available for the deal", type: "number", unit: "$mm", default: 1000 },
      { key: "tgtPrice", label: "Target share price", type: "number", unit: "$", required: true, default: 40 },
      { key: "tgtShares", label: "Target diluted shares", type: "number", unit: "mm", required: true, default: 200 },
      { key: "tgtNi", label: "Target net income", type: "number", unit: "$mm", required: true, default: 240 },
      { key: "tgtNetAssets", label: "Target net identifiable assets (book)", type: "number", unit: "$mm", default: 2000 },
      { key: "premium", label: "Premium", type: "number", unit: "%", default: 30 },
      { key: "cashPct", label: "Cash consideration", type: "number", unit: "%", default: 50 },
      { key: "debtRate", label: "New debt rate", type: "number", unit: "%", default: 6 },
      { key: "cashYield", label: "Yield forgone on cash used", type: "number", unit: "%", default: 4 },
      { key: "intangPct", label: "Premium allocated to amortizable intangibles", type: "number", unit: "%", default: 40 },
      { key: "intangLife", label: "Intangible life", type: "number", unit: "years", default: 10 },
      { key: "synergies", label: "Run-rate pre-tax synergies", type: "number", unit: "$mm", default: 200 },
      { key: "cta", label: "Cost to achieve (year 1)", type: "number", unit: "$mm", default: 150 },
      { key: "feePct", label: "Transaction fees", type: "number", unit: "% of offer value", default: 2.5 },
      { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 25 },
      { key: "growth", label: "Standalone earnings growth", type: "number", unit: "%", default: 8 },
    ],
    example: { acqPrice: 118, acqShares: 4300, acqNi: 34000, acqCash: 15000, tgtPrice: 36, tgtShares: 620, tgtNi: 3100, tgtNetAssets: 24000, premium: 25, cashPct: 0, debtRate: 5.5, cashYield: 4, intangPct: 35, intangLife: 10, synergies: 1500, cta: 900, feePct: 1.5, tax: 23, growth: 5 },
    compute: (i: Inputs): WorkflowOutput => {
      const pA = num(i, "acqPrice"), sA = num(i, "acqShares"), niA = num(i, "acqNi"), cashA = num(i, "acqCash");
      const pT = num(i, "tgtPrice"), sT = num(i, "tgtShares"), niT = num(i, "tgtNi"), bvT = num(i, "tgtNetAssets");
      const tax = num(i, "tax") / 100, rd = num(i, "debtRate") / 100, ry = num(i, "cashYield") / 100;
      const iPct = num(i, "intangPct") / 100, life = Math.max(1, num(i, "intangLife", 10)), g = num(i, "growth") / 100;
      const syn = num(i, "synergies"), cta = num(i, "cta"), feePct = num(i, "feePct") / 100;
      if (pA <= 0 || sA <= 0 || pT <= 0 || sT <= 0) throw new Error("Share prices and share counts must be positive.");
      const model = (premPct: number, cashPct: number) => {
        const offer = pT * (1 + premPct), eqValue = offer * sT;
        const cashCon = eqValue * cashPct, stockCon = eqValue - cashCon;
        const newShares = stockCon / pA, fees = eqValue * feePct;
        const cashUsed = Math.min(cashCon + fees, Math.max(0, cashA)), newDebt = cashCon + fees - cashUsed;
        const premiumOverBook = Math.max(0, eqValue - bvT);
        const intangibles = premiumOverBook * iPct, dtl = intangibles * tax, amort = intangibles / life;
        const goodwill = premiumOverBook - intangibles + dtl;
        const pfShares = sA + newShares;
        const years = [1, 2, 3].map((y) => {
          const grow = Math.pow(1 + g, y - 1);
          const sYear = syn * (y === 1 ? 0.5 : 1), c = y === 1 ? cta : 0;
          const interest = newDebt * rd, forgone = cashUsed * ry;
          const pfNi = niA * grow + niT * grow + (sYear - c) * (1 - tax) - (interest + forgone + amort) * (1 - tax);
          const standalone = (niA * grow) / sA, pfEps = pfNi / pfShares;
          return { y, standalone, pfEps, accretion: pfEps / standalone - 1, pfNi, interest, forgone, amort, sYear, c, grow };
        });
        return { offer, eqValue, cashCon, stockCon, newShares, fees, cashUsed, newDebt, intangibles, dtl, goodwill, amort, pfShares, years };
      };
      const base = model(num(i, "premium") / 100, num(i, "cashPct") / 100);
      const y1 = base.years[0];
      const beSyn = y1.c + (y1.standalone * base.pfShares - niA - niT + (y1.interest + y1.forgone + y1.amort) * (1 - tax)) / (1 - tax);
      const prems = [-10, -5, 0, 5, 10].map((d) => num(i, "premium") / 100 + d / 100);
      const cashes = [0, 0.25, 0.5, 0.75, 1];
      const grid = prems.map((p) => cashes.map((c) => model(p, c).years[0].accretion));
      const tgtOpex = Math.max(1, niT / 0.1);
      return {
        title: "Accretion / dilution",
        summary: `At a ${fmt.pct(num(i, "premium") / 100, 0)} premium the offer is ${fmt.moneyRaw(base.offer, 2)} per share, or ${fmt.money(base.eqValue)} of equity value, funded ${fmt.pct(num(i, "cashPct") / 100, 0)} in cash. Year 1 EPS is ${y1.accretion >= 0 ? "accretive" : "dilutive"} by ${fmt.pct(Math.abs(y1.accretion), 1)} and year 2 by ${fmt.pct(Math.abs(base.years[1].accretion), 1)}. ${beSyn <= 0 ? `No synergies are needed for year 1 EPS neutrality: the deal absorbs ${fmt.money(-beSyn)} of dis-synergies before it dilutes.` : `Break-even needs ${fmt.money(beSyn)} of run-rate pre-tax synergies against the ${fmt.money(syn)} assumed.`}`,
        blocks: [
          { type: "kpis", items: [
            { label: "Offer price", value: fmt.moneyRaw(base.offer, 2) }, { label: "Offer equity value", value: fmt.money(base.eqValue) },
            { label: "Year 1 accretion", value: fmt.pct(y1.accretion, 1), tone: y1.accretion >= 0 ? "pos" : "neg" },
            { label: "Year 2 accretion", value: fmt.pct(base.years[1].accretion, 1), tone: base.years[1].accretion >= 0 ? "pos" : "neg" },
            { label: "Break-even synergies", value: beSyn <= 0 ? "None required" : fmt.money(beSyn), tone: beSyn <= syn ? "pos" : "warn", hint: beSyn <= 0 ? `Accretive with no synergies; absorbs ${fmt.money(-beSyn)} of dis-synergies` : "Pre-tax run-rate needed for year 1 EPS neutrality" },
            { label: "New shares issued", value: `${fmt.num(base.newShares, 1)}mm` }, { label: "New debt", value: fmt.money(base.newDebt) },
          ] },
          { type: "table", title: "Sources and uses (USD mm)", columns: ["Item", "Uses", "Sources"], rows: [
            ["Purchase of target equity", fmt.num(base.eqValue, 0), ""], ["Transaction fees", fmt.num(base.fees, 0), ""],
            ["Cash from balance sheet", "", fmt.num(base.cashUsed, 0)], ["New debt", "", fmt.num(base.newDebt, 0)], ["Acquirer stock issued", "", fmt.num(base.stockCon, 0)],
          ], totals: ["Total", fmt.num(base.eqValue + base.fees, 0), fmt.num(base.cashUsed + base.newDebt + base.stockCon, 0)], note: `Purchase accounting: ${fmt.money(base.intangibles)} of amortizable intangibles over ${life} years (${fmt.money(base.amort)} per year), ${fmt.money(base.dtl)} deferred tax liability, ${fmt.money(base.goodwill)} goodwill.` },
          { type: "table", title: "EPS build", columns: ["Year", "Standalone EPS", "Synergies (net)", "New interest", "Forgone interest", "Amortization", "Pro forma EPS", "Accretion"],
            rows: base.years.map((r) => [`Y${r.y}`, fmt.moneyRaw(r.standalone, 2), fmt.num(r.sYear - r.c, 0), fmt.num(-r.interest, 0), fmt.num(-r.forgone, 0), fmt.num(-r.amort, 0), fmt.moneyRaw(r.pfEps, 2), fmt.pct(r.accretion, 1)]), emphasisRow: 0 },
          { type: "waterfall", title: "Year 1 EPS bridge ($/share)", format: "num", steps: [
            { label: "Acquirer standalone", value: y1.standalone, total: true },
            { label: "Target earnings", value: niT / base.pfShares },
            { label: "Synergies net of cost", value: ((y1.sYear - y1.c) * (1 - tax)) / base.pfShares },
            { label: "New interest", value: (-y1.interest * (1 - tax)) / base.pfShares },
            { label: "Forgone interest", value: (-y1.forgone * (1 - tax)) / base.pfShares },
            { label: "Intangible amortization", value: (-y1.amort * (1 - tax)) / base.pfShares },
            { label: "Share issuance", value: y1.pfEps - (niA + niT + (y1.sYear - y1.c - y1.interest - y1.forgone - y1.amort) * (1 - tax)) / sA },
            { label: "Pro forma EPS", value: y1.pfEps, total: true },
          ] },
          { type: "sensitivity", title: "Year 1 accretion: premium × cash consideration", rowLabel: "Premium", colLabel: "Cash %", rows: prems.map((p) => fmt.pct(p, 0)), cols: cashes.map((c) => fmt.pct(c, 0)), values: grid, format: "pct", baseRow: 2, baseCol: cashes.indexOf(Math.min(1, Math.max(0, Math.round((num(i, "cashPct") / 100) * 4) / 4))) },
        ],
        caveats: [
          `${beSyn > 0 ? `Break-even synergies of ${fmt.money(beSyn)} are roughly ${fmt.pct(beSyn / tgtOpex, 0)} of an assumed target opex base; replace that with the real expense base from the target's income statement.` : "The deal is accretive before synergies, so the break-even figure is negative: it is the dis-synergy the structure can absorb, not a requirement."}`,
          "Target diluted shares should be struck with the treasury stock method at the offer price, not the market price. Transaction fees are expensed and excluded from the EPS build; financing fees would be capitalized and amortized.",
          "Synergies phase 50% in year 1 and 100% thereafter, with the cost to achieve taken in year 1. All-stock deals are accretive when the acquirer's P/E exceeds the target's; all-cash when the target's after-tax earnings yield exceeds the after-tax cost of debt.",
        ],
        nextSteps: ["Benchmark the synergy assumption against announced deals with the synergy & accretion workflow", "Run the contribution analysis to test whether ownership matches contribution", "Size the debt against the debt capacity calculator"],
      };
    },
    prefill: (c) => ({ acqPrice: c.price?.last ?? 100, acqShares: c.balance.sharesOut ?? 100, acqNi: c.ltm.netIncome ?? 0, acqCash: c.balance.cash ?? 0 }),
  },
  {
    kind: "calc", id: "lbo-returns", title: "LBO: sources, uses & returns", tagline: "Tranched capital structure, debt schedule with a sweep, IRR and MOIC with returns attribution.",
    description: "Runs the sponsor's model: entry at a multiple of EBITDA with a term loan and second lien sized in turns, fees and minimum cash, then a full debt schedule with mandatory amortization and a cash sweep, exit at a multiple, and returns decomposed into EBITDA growth, multiple change, debt paydown and fees.",
    roles: ["banker", "pe", "student"], category: "Modeling", icon: "Coins", savesMinutes: 180, tags: ["LBO", "IRR", "MOIC", "attribution"],
    fields: [
      { key: "ebitda", label: "Entry EBITDA", type: "number", unit: "$mm", required: true, default: 150 },
      { key: "entryMultiple", label: "Entry EV/EBITDA", type: "number", unit: "x", required: true, default: 12 },
      { key: "tlbTurns", label: "Term loan B", type: "number", unit: "x EBITDA", default: 4 },
      { key: "secondTurns", label: "Second lien / unitranche last-out", type: "number", unit: "x EBITDA", default: 1 },
      { key: "sofr", label: "SOFR", type: "number", unit: "%", default: 3.75 },
      { key: "tlbSpread", label: "Term loan spread", type: "number", unit: "bps", default: 350 },
      { key: "secondRate", label: "Second lien all-in rate", type: "number", unit: "%", default: 10.5 },
      { key: "oid", label: "Term loan OID", type: "number", unit: "price", default: 99.5 },
      { key: "financeFeePct", label: "Financing fees", type: "number", unit: "% of debt", default: 2 },
      { key: "txnFeePct", label: "Transaction fees", type: "number", unit: "% of EV", default: 2 },
      { key: "minCash", label: "Minimum cash", type: "number", unit: "$mm", default: 25 },
      { key: "growth", label: "EBITDA growth", type: "number", unit: "%", default: 8 },
      { key: "daPct", label: "D&A", type: "number", unit: "% of EBITDA", default: 20 },
      { key: "capexPct", label: "Capex", type: "number", unit: "% of EBITDA", default: 15 },
      { key: "nwcPct", label: "Change in NWC", type: "number", unit: "% of EBITDA growth", default: 15 },
      { key: "tax", label: "Cash tax rate", type: "number", unit: "%", default: 25 },
      { key: "amortPct", label: "Mandatory amortization", type: "number", unit: "% of TLB per year", default: 1 },
      { key: "sweep", label: "Cash sweep", type: "number", unit: "% of free cash", default: 75 },
      { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 2, max: 10 },
      { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", default: 12 },
    ],
    example: { ebitda: 150, entryMultiple: 12, tlbTurns: 4, secondTurns: 1.5, sofr: 3.75, tlbSpread: 375, secondRate: 10.5, oid: 99.5, financeFeePct: 2, txnFeePct: 2, minCash: 25, growth: 9, daPct: 20, capexPct: 15, nwcPct: 15, tax: 25, amortPct: 1, sweep: 75, years: 5, exitMultiple: 12 },
    prefill: (c) => ({ ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 150, entryMultiple: c.ltm.adjEbitda && c.price ? Math.max(4, Math.round((c.price.marketCap + (c.balance.debt ?? 0) - (c.balance.cash ?? 0)) / c.ltm.adjEbitda)) : 12 }),
    compute: (i: Inputs): WorkflowOutput => {
      const e0 = num(i, "ebitda"), entryX = num(i, "entryMultiple"), years = Math.round(num(i, "years", 5));
      const tlb0 = num(i, "tlbTurns") * e0, sl0 = num(i, "secondTurns") * e0;
      const oid = num(i, "oid", 99.5), tlbRate = num(i, "sofr") / 100 + num(i, "tlbSpread") / 10000 + (100 - oid) / 4 / 100;
      const slRate = num(i, "secondRate") / 100, g = num(i, "growth") / 100, da = num(i, "daPct") / 100;
      const capex = num(i, "capexPct") / 100, nwc = num(i, "nwcPct") / 100, tax = num(i, "tax") / 100;
      const amortPct = num(i, "amortPct") / 100, sweep = num(i, "sweep") / 100, minCash = num(i, "minCash");
      const exitX = num(i, "exitMultiple");
      if (e0 <= 0 || entryX <= 0) throw new Error("Entry EBITDA and entry multiple must be positive.");
      const entryTev = e0 * entryX, debt0 = tlb0 + sl0;
      const fees = debt0 * (num(i, "financeFeePct") / 100) + entryTev * (num(i, "txnFeePct") / 100);
      const uses = entryTev + fees + minCash, equity = uses - debt0;
      if (equity <= 0) throw new Error("Leverage exceeds the purchase price plus fees: reduce the debt turns.");
      let tlb = tlb0, sl = sl0, cash = minCash, prevE = e0;
      const rows: { y: number; ebitda: number; interest: number; taxes: number; fcf: number; amort: number; sweepPaid: number; tlb: number; sl: number; cash: number; netDebt: number }[] = [];
      for (let y = 1; y <= years; y++) {
        const ebitda = e0 * Math.pow(1 + g, y);
        const interest = tlb * tlbRate + sl * slRate;
        const ebit = ebitda * (1 - da);
        const taxes = Math.max(0, ebit - interest) * tax;
        const dNwc = (ebitda - prevE) * nwc;
        const fcf = ebitda - interest - taxes - ebitda * capex - dNwc;
        const amort = Math.min(tlb, tlb0 * amortPct);
        const avail = Math.max(0, fcf - amort);
        let pay = avail * sweep;
        tlb -= amort;
        const toTlb = Math.min(tlb, pay); tlb -= toTlb; pay -= toTlb;
        const toSl = Math.min(sl, pay); sl -= toSl; pay -= toSl;
        cash += fcf - amort - toTlb - toSl;
        rows.push({ y, ebitda, interest, taxes, fcf, amort, sweepPaid: toTlb + toSl, tlb, sl, cash, netDebt: tlb + sl - cash });
        prevE = ebitda;
      }
      const last = rows[rows.length - 1];
      const exitTev = last.ebitda * exitX, exitEquity = exitTev - last.netDebt;
      const moic = exitEquity / equity, irr = Math.pow(Math.max(moic, 0.0001), 1 / years) - 1;
      const openNd = debt0 - minCash;
      const attribution = [
        { label: "Sponsor equity", value: equity, total: true },
        { label: "EBITDA growth", value: entryX * (last.ebitda - e0) },
        { label: "Multiple change", value: (exitX - entryX) * last.ebitda },
        { label: "Debt paydown & cash build", value: openNd - last.netDebt },
        { label: "Fees at entry", value: -fees },
        { label: "Exit equity proceeds", value: exitEquity, total: true },
      ];
      const exits = [exitX - 2, exitX - 1, exitX, exitX + 1, exitX + 2].filter((x) => x > 0);
      const holds = rows.map((r) => r.y);
      const grid = exits.map((x) => holds.map((y) => { const r = rows[y - 1]; const eq = r.ebitda * x - r.netDebt; return eq <= 0 ? null : Math.pow(eq / equity, 1 / y) - 1; }));
      return {
        title: "LBO returns",
        summary: `Entry at ${fmt.x(entryX)} on ${fmt.money(e0)} of EBITDA is ${fmt.money(entryTev)} of enterprise value, funded with ${fmt.x((tlb0 + sl0) / e0)} of leverage and ${fmt.money(equity)} of sponsor equity (${fmt.pct(equity / uses, 0)} of uses). Exiting in year ${years} at ${fmt.x(exitX)} returns ${fmt.money(exitEquity)}, a ${moic.toFixed(2)}x MOIC and ${fmt.pct(irr, 1)} IRR. Debt paydown contributes ${fmt.money(openNd - last.netDebt)} of the ${fmt.money(exitEquity - equity)} of value created.`,
        blocks: [
          { type: "kpis", items: [
            { label: "IRR", value: fmt.pct(irr, 1), tone: irr >= 0.2 ? "pos" : irr >= 0.15 ? "warn" : "neg", hint: "Buyout funds target 20-25%" },
            { label: "MOIC", value: `${moic.toFixed(2)}x` }, { label: "Sponsor equity", value: fmt.money(equity) },
            { label: "Entry leverage", value: fmt.x(debt0 / e0) }, { label: "Exit leverage", value: fmt.x(last.netDebt / last.ebitda) },
            { label: "Entry TEV", value: fmt.money(entryTev) }, { label: "Exit equity", value: fmt.money(exitEquity) },
          ] },
          { type: "table", title: "Sources and uses (USD mm)", columns: ["Item", "Uses", "Sources", "x EBITDA"], rows: [
            ["Purchase enterprise value", fmt.num(entryTev, 0), "", fmt.x(entryX)], ["Fees and expenses", fmt.num(fees, 0), "", fmt.x(fees / e0)], ["Minimum cash", fmt.num(minCash, 0), "", ""],
            ["Term loan B", "", fmt.num(tlb0, 0), fmt.x(tlb0 / e0)], ["Second lien", "", fmt.num(sl0, 0), fmt.x(sl0 / e0)], ["Sponsor equity", "", fmt.num(equity, 0), fmt.x(equity / e0)],
          ], totals: ["Total", fmt.num(uses, 0), fmt.num(debt0 + equity, 0), fmt.x(uses / e0)], note: `Term loan all-in ${fmt.pct(tlbRate, 2)} (SOFR + ${num(i, "tlbSpread")}bps plus OID accretion at a four-year life); second lien ${fmt.pct(slRate, 2)}.` },
          { type: "table", title: "Debt schedule (USD mm)", columns: ["Year", "EBITDA", "Cash interest", "Cash taxes", "Free cash flow", "Amortization", "Sweep", "TLB", "Second lien", "Cash", "Net debt", "Net leverage"],
            rows: rows.map((r) => [`Y${r.y}`, fmt.num(r.ebitda, 0), fmt.num(r.interest, 0), fmt.num(r.taxes, 0), fmt.num(r.fcf, 0), fmt.num(r.amort, 0), fmt.num(r.sweepPaid, 0), fmt.num(r.tlb, 0), fmt.num(r.sl, 0), fmt.num(r.cash, 0), fmt.num(r.netDebt, 0), fmt.x(r.netDebt / r.ebitda)]) },
          { type: "waterfall", title: "Returns attribution (USD mm)", format: "money", steps: attribution },
          { type: "sensitivity", title: "IRR: exit multiple × hold period", rowLabel: "Exit multiple", colLabel: "Hold (years)", rows: exits.map((x) => fmt.x(x)), cols: holds.map((y) => `Y${y}`), values: grid, format: "pct", baseRow: exits.indexOf(exitX), baseCol: holds.length - 1 },
        ],
        caveats: [
          "Interest accrues on beginning balances with no revolver draw modeled; a negative free cash flow year builds no cash and is funded from the cash balance.",
          "Cash taxes are computed on EBIT less interest with no NOL carryforward and no limitation on interest deductibility under section 163(j).",
          "Returns are a single entry and exit cash flow, so the IRR is the annualized MOIC. A dividend recap or a bolt-on would change both the IRR and the attribution.",
          "2026 middle-market structures run 4.0-5.0x total leverage (5.0-6.0x for upper-middle-market credits) with sponsor equity of 45-55% of the purchase price; unitranche all-in pricing is 9.0-11.0% against 7.5-9.5% for broadly syndicated loans.",
        ],
        nextSteps: ["Solve the entry price at a 20-25% hurdle to set the ability-to-pay", "Test the structure against the debt capacity calculator", "Compare the pricing with the term sheet grid"],
      };
    },
  },
  {
    kind: "calc", id: "tsm-diluted-shares", title: "Treasury stock method & EV bridge", tagline: "Options, RSUs, warrants and converts to diluted shares, then equity value to enterprise value.",
    description: "Computes fully diluted shares under the treasury stock method (in-the-money options and warrants repurchase shares with their proceeds) plus RSUs and if-converted shares on in-the-money convertibles, then bridges equity value to enterprise value with debt, preferred, minority interest, leases and pensions.",
    roles: ["banker", "pe", "markets", "corpfin", "student"], category: "Valuation", icon: "Calculator", savesMinutes: 60, tags: ["TSM", "diluted shares", "EV bridge"],
    fields: [
      { key: "price", label: "Share price", type: "number", unit: "$", required: true, default: 50 },
      { key: "basic", label: "Basic shares (cover page)", type: "number", unit: "mm", required: true, default: 300 },
      { key: "options", label: "Options outstanding", type: "number", unit: "mm", default: 20 },
      { key: "strike", label: "Weighted-average strike", type: "number", unit: "$", default: 30 },
      { key: "rsus", label: "RSUs and PSUs", type: "number", unit: "mm", default: 8 },
      { key: "warrants", label: "Warrants", type: "number", unit: "mm", default: 0 },
      { key: "warrantStrike", label: "Warrant strike", type: "number", unit: "$", default: 11.5 },
      { key: "convertPrincipal", label: "Convertible principal", type: "number", unit: "$mm", default: 1000 },
      { key: "convertPrice", label: "Conversion price", type: "number", unit: "$", default: 60 },
      { key: "cash", label: "Cash and short-term investments", type: "number", unit: "$mm", default: 2000 },
      { key: "debt", label: "Total debt (excluding the convert)", type: "number", unit: "$mm", default: 3000 },
      { key: "preferred", label: "Preferred at liquidation", type: "number", unit: "$mm", default: 0 },
      { key: "nci", label: "Non-controlling interest", type: "number", unit: "$mm", default: 0 },
      { key: "leases", label: "Operating lease liability", type: "number", unit: "$mm", default: 500 },
      { key: "includeLeases", label: "Capitalize operating leases in EV", type: "toggle", default: false },
      { key: "pension", label: "Underfunded pension (net of tax)", type: "number", unit: "$mm", default: 0 },
    ],
    example: { price: 50, basic: 300, options: 20, strike: 30, rsus: 8, warrants: 0, warrantStrike: 11.5, convertPrincipal: 1000, convertPrice: 60, cash: 2000, debt: 3000, preferred: 0, nci: 0, leases: 500, includeLeases: false, pension: 0 },
    prefill: (c) => ({ price: c.price?.last ?? 50, basic: c.balance.sharesOut ?? 100, cash: c.balance.cash ?? 0, debt: c.balance.debt ?? 0 }),
    compute: (i: Inputs): WorkflowOutput => {
      const p = num(i, "price"), basic = num(i, "basic");
      if (p <= 0 || basic <= 0) throw new Error("Share price and basic shares must be positive.");
      const opt = num(i, "options"), k = num(i, "strike"), rsu = num(i, "rsus");
      const war = num(i, "warrants"), wk = num(i, "warrantStrike");
      const cvt = num(i, "convertPrincipal"), cp = num(i, "convertPrice");
      const tsm = (count: number, strike: number) => (count > 0 && strike < p ? count - (count * strike) / p : 0);
      const optNet = tsm(opt, k), warNet = tsm(war, wk);
      const cvtIn = cvt > 0 && cp > 0 && p > cp;
      const cvtShares = cvtIn ? cvt / cp : 0;
      const diluted = basic + optNet + rsu + warNet + cvtShares;
      const eq = diluted * p;
      const leaseAdd = bool(i, "includeLeases") ? num(i, "leases") : 0;
      const debtTotal = num(i, "debt") + (cvtIn ? 0 : cvt);
      const ev = eq + debtTotal + num(i, "preferred") + num(i, "nci") + leaseAdd + num(i, "pension") - num(i, "cash");
      return {
        title: "Diluted shares and enterprise value",
        summary: `Fully diluted shares are ${fmt.num(diluted, 1)}mm against ${fmt.num(basic, 1)}mm basic, ${fmt.pct(diluted / basic - 1, 1)} of dilution. Equity value is ${fmt.money(eq)} and enterprise value ${fmt.money(ev)}. The convertible is ${cvtIn ? `in the money, so ${fmt.num(cvtShares, 1)}mm if-converted shares are added and the principal is excluded from debt` : "out of the money, so its principal stays in debt and no shares are added"}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Diluted shares", value: `${fmt.num(diluted, 1)}mm` }, { label: "Dilution vs basic", value: fmt.pct(diluted / basic - 1, 1) },
            { label: "Equity value", value: fmt.money(eq) }, { label: "Enterprise value", value: fmt.money(ev) },
            { label: "Net debt", value: fmt.money(debtTotal + leaseAdd - num(i, "cash")) },
          ] },
          { type: "table", title: "Share build (mm)", columns: ["Component", "Gross", "Strike", "Proceeds ($mm)", "Shares repurchased", "Net shares added"], rows: [
            ["Basic shares", fmt.num(basic, 1), "", "", "", fmt.num(basic, 1)],
            ["Options (TSM)", fmt.num(opt, 1), fmt.moneyRaw(k, 2), fmt.num(opt > 0 && k < p ? opt * k : 0, 0), fmt.num(opt > 0 && k < p ? (opt * k) / p : 0, 1), fmt.num(optNet, 1)],
            ["RSUs / PSUs", fmt.num(rsu, 1), "n/a", "0", "0", fmt.num(rsu, 1)],
            ["Warrants (TSM)", fmt.num(war, 1), fmt.moneyRaw(wk, 2), fmt.num(war > 0 && wk < p ? war * wk : 0, 0), fmt.num(war > 0 && wk < p ? (war * wk) / p : 0, 1), fmt.num(warNet, 1)],
            ["Convertible (if-converted)", fmt.num(cvtShares, 1), fmt.moneyRaw(cp, 2), "n/a", "n/a", fmt.num(cvtShares, 1)],
          ], totals: ["Fully diluted", "", "", "", "", fmt.num(diluted, 1)], emphasisRow: 0 },
          { type: "waterfall", title: "Equity value to enterprise value (USD mm)", format: "money", steps: [
            { label: "Equity value", value: eq, total: true }, { label: "Plus debt", value: debtTotal }, { label: "Plus preferred", value: num(i, "preferred") },
            { label: "Plus NCI", value: num(i, "nci") }, { label: "Plus leases", value: leaseAdd }, { label: "Plus pension", value: num(i, "pension") },
            { label: "Less cash", value: -num(i, "cash") }, { label: "Enterprise value", value: ev, total: true },
          ] },
          { type: "columns", title: "Net shares added by instrument (mm)", format: "num", data: [{ label: "Options", value: optNet }, { label: "RSUs", value: rsu }, { label: "Warrants", value: warNet }, { label: "Convert", value: cvtShares }] },
        ],
        caveats: [
          "The treasury stock method assumes proceeds from in-the-money awards repurchase shares at the current price; out-of-the-money awards are excluded entirely. Use the weighted-average strike by tranche from the equity footnote rather than a single blended strike where the ranges are wide.",
          "Convertibles are treated as if-converted when in the money, which removes the principal from debt and adds the shares; net-share settlement or a bond hedge and warrant (capped call) would change the economics for the issuer, and the accounting diluted count under ASU 2020-06 differs from this transaction view.",
          "Operating leases are excluded from EV by default: include them only if the peer set capitalizes leases and EBITDA is presented before rent (EBITDAR).",
        ],
      };
    },
  },
  {
    kind: "calc", id: "ma-contribution-analysis", title: "Contribution analysis", tagline: "Who brings what to the merger, against who owns what afterwards.",
    description: "Compares each party's share of revenue, EBITDA, net income, equity value and enterprise value with its pro forma ownership at the agreed premium, and derives the exchange ratio each contribution metric would imply. The standard first page of any merger-of-equals discussion.",
    roles: ["banker", "corpfin", "markets"], category: "Modeling", icon: "PieChart", savesMinutes: 60, tags: ["contribution", "merger of equals", "ownership"],
    fields: [
      { key: "aName", label: "Company A (acquirer / larger)", type: "text", default: "Company A" },
      { key: "aPrice", label: "A share price", type: "number", unit: "$", required: true, default: 100 },
      { key: "aShares", label: "A diluted shares", type: "number", unit: "mm", required: true, default: 400 },
      { key: "aRevenue", label: "A revenue", type: "number", unit: "$mm", default: 8000 },
      { key: "aEbitda", label: "A EBITDA", type: "number", unit: "$mm", default: 2000 },
      { key: "aNi", label: "A net income", type: "number", unit: "$mm", default: 1000 },
      { key: "aNetDebt", label: "A net debt", type: "number", unit: "$mm", default: 3000 },
      { key: "bName", label: "Company B", type: "text", default: "Company B" },
      { key: "bPrice", label: "B share price", type: "number", unit: "$", required: true, default: 40 },
      { key: "bShares", label: "B diluted shares", type: "number", unit: "mm", required: true, default: 300 },
      { key: "bRevenue", label: "B revenue", type: "number", unit: "$mm", default: 4000 },
      { key: "bEbitda", label: "B EBITDA", type: "number", unit: "$mm", default: 900 },
      { key: "bNi", label: "B net income", type: "number", unit: "$mm", default: 420 },
      { key: "bNetDebt", label: "B net debt", type: "number", unit: "$mm", default: 1500 },
      { key: "premium", label: "Premium paid to B", type: "number", unit: "%", default: 15 },
    ],
    example: { aName: "Acquirer", aPrice: 100, aShares: 400, aRevenue: 8000, aEbitda: 2000, aNi: 1000, aNetDebt: 3000, bName: "Target", bPrice: 40, bShares: 300, bRevenue: 4000, bEbitda: 900, bNi: 420, bNetDebt: 1500, premium: 15 },
    compute: (i: Inputs): WorkflowOutput => {
      const nA = str(i, "aName", "Company A"), nB = str(i, "bName", "Company B");
      const pA = num(i, "aPrice"), sA = num(i, "aShares"), pB = num(i, "bPrice"), sB = num(i, "bShares");
      if (pA <= 0 || sA <= 0 || pB <= 0 || sB <= 0) throw new Error("Prices and share counts for both companies must be positive.");
      const eqA = pA * sA, eqB = pB * sB, prem = num(i, "premium") / 100;
      const offerB = eqB * (1 + prem), newShares = offerB / pA;
      const ownB = newShares / (sA + newShares), ownA = 1 - ownB;
      const metrics: { label: string; a: number; b: number }[] = [
        { label: "Revenue", a: num(i, "aRevenue"), b: num(i, "bRevenue") },
        { label: "EBITDA", a: num(i, "aEbitda"), b: num(i, "bEbitda") },
        { label: "Net income", a: num(i, "aNi"), b: num(i, "bNi") },
        { label: "Equity value (market)", a: eqA, b: eqB },
        { label: "Enterprise value", a: eqA + num(i, "aNetDebt"), b: eqB + num(i, "bNetDebt") },
        { label: "Net debt", a: num(i, "aNetDebt"), b: num(i, "bNetDebt") },
      ];
      const rows = metrics.map((m) => {
        const tot = m.a + m.b, shareB = tot === 0 ? 0 : m.b / tot;
        const impliedRatio = shareB >= 1 ? null : (shareB / (1 - shareB)) * (sA / sB);
        return [m.label, fmt.num(m.a, 0), fmt.num(m.b, 0), fmt.pct(1 - shareB, 1), fmt.pct(shareB, 1), impliedRatio === null ? "NM" : impliedRatio.toFixed(4)];
      });
      const shareBs = metrics.slice(0, 3).map((m) => (m.a + m.b === 0 ? 0 : m.b / (m.a + m.b)));
      const medianB = median(shareBs);
      const dealRatio = offerB / sB / pA;
      const fairRatio = (medianB / (1 - medianB)) * (sA / sB);
      return {
        title: "Contribution analysis",
        summary: `${nB} contributes a median ${fmt.pct(medianB, 1)} of revenue, EBITDA and net income but receives ${fmt.pct(ownB, 1)} of the pro forma equity at a ${fmt.pct(prem, 0)} premium, an exchange ratio of ${dealRatio.toFixed(4)} ${nA} shares per ${nB} share. Contribution parity on operating metrics would imply ${fairRatio.toFixed(4)}, so ${ownB > medianB ? `${nB} is over-compensated relative to what it contributes` : `${nB} is under-compensated relative to what it contributes`} by ${fmt.pct(Math.abs(ownB - medianB), 1)} of the pro forma equity.`,
        blocks: [
          { type: "kpis", items: [
            { label: `${nA} ownership`, value: fmt.pct(ownA, 1) }, { label: `${nB} ownership`, value: fmt.pct(ownB, 1) }, { label: `${nB} median contribution`, value: fmt.pct(medianB, 1) },
            { label: "Exchange ratio (deal)", value: dealRatio.toFixed(4) }, { label: "Exchange ratio (contribution parity)", value: fairRatio.toFixed(4) },
            { label: "New shares issued", value: `${fmt.num(newShares, 1)}mm` }, { label: "Premium to B", value: fmt.pct(prem, 1) },
          ] },
          { type: "table", title: "Contribution (USD mm)", columns: ["Metric", nA, nB, `${nA} %`, `${nB} %`, "Implied exchange ratio"], rows, note: "The implied exchange ratio is the ratio that would give each party ownership equal to its share of that metric." },
          { type: "bar", title: `${nB} contribution by metric versus pro forma ownership`, format: "pct", reference: { value: ownB, label: `Pro forma ownership ${fmt.pct(ownB, 1)}` },
            data: metrics.map((m) => ({ label: m.label, value: m.a + m.b === 0 ? null : m.b / (m.a + m.b) })) },
          { type: "callout", tone: ownB > medianB + 0.02 ? "warn" : "info", title: "Where the argument lands", text: `At ${fmt.pct(prem, 0)} premium ${nB} holders own ${fmt.pct(ownB, 1)} of the combined company. ${nB} contributes ${fmt.pct(shareBs[1], 1)} of EBITDA and ${fmt.pct(shareBs[2], 1)} of net income, and carries ${fmt.pct(num(i, "bNetDebt") / Math.max(1, num(i, "aNetDebt") + num(i, "bNetDebt")), 1)} of the combined net debt. In a merger of equals the negotiation runs on these gaps plus governance (board split, CEO, name, headquarters), and for banks on tangible book value dilution and earnback.` },
        ],
        caveats: [
          "Contribution analysis ignores synergies, which is the point: it shows what each side brings on a standalone basis before value creation is shared.",
          "Use consistent metric definitions (both adjusted or both reported) and the same period. Share counts should be diluted under the treasury stock method.",
          "Equity-value contribution embeds the market's own view of growth and risk, so it usually differs from operating-metric contribution; that difference is the negotiation.",
        ],
        nextSteps: ["Run the exchange ratio and collar calculator to test price risk", "Run accretion / dilution on the agreed ratio", "For bank deals, run the TBV dilution and earnback workflow"],
      };
    },
  },
  {
    kind: "calc", id: "ma-exchange-ratio", title: "Exchange ratio, floating & collar", tagline: "Who bears the price risk between signing and close, across a grid of acquirer prices.",
    description: "Compares a fixed exchange ratio, a floating ratio delivering fixed value, and a collar with a floor and a cap: for each acquirer price it shows the ratio, the value delivered per target share, the implied premium and the target's pro forma ownership, so the risk allocation in the structure is explicit.",
    roles: ["banker", "corpfin", "markets"], category: "Modeling", icon: "Scale", savesMinutes: 60, tags: ["exchange ratio", "collar", "stock deal"],
    fields: [
      { key: "acqPrice", label: "Acquirer price at signing", type: "number", unit: "$", required: true, default: 20 },
      { key: "tgtPrice", label: "Target price (unaffected)", type: "number", unit: "$", required: true, default: 20 },
      { key: "premium", label: "Premium", type: "number", unit: "%", default: 25 },
      { key: "collarLow", label: "Collar floor", type: "number", unit: "% below signing price", default: 15 },
      { key: "collarHigh", label: "Collar cap", type: "number", unit: "% above signing price", default: 15 },
      { key: "tgtShares", label: "Target diluted shares", type: "number", unit: "mm", default: 100 },
      { key: "acqShares", label: "Acquirer diluted shares", type: "number", unit: "mm", default: 300 },
    ],
    example: { acqPrice: 20, tgtPrice: 20, premium: 25, collarLow: 15, collarHigh: 15, tgtShares: 100, acqShares: 300 },
    compute: (i: Inputs): WorkflowOutput => {
      const pA = num(i, "acqPrice"), pT = num(i, "tgtPrice"), prem = num(i, "premium") / 100;
      const sT = num(i, "tgtShares"), sA = num(i, "acqShares");
      if (pA <= 0 || pT <= 0) throw new Error("Acquirer and target prices must be positive.");
      const offerValue = pT * (1 + prem), fixedRatio = offerValue / pA;
      const floorP = pA * (1 - num(i, "collarLow") / 100), capP = pA * (1 + num(i, "collarHigh") / 100);
      const ratioAtFloor = offerValue / floorP, ratioAtCap = offerValue / capP;
      const prices = [-30, -20, -10, 0, 10, 20, 30].map((d) => pA * (1 + d / 100));
      const own = (r: number) => (r * sT) / (sA + r * sT);
      const rows = prices.map((p) => {
        const fixedVal = fixedRatio * p;
        const floatRatio = offerValue / p;
        const collarRatio = p < floorP ? ratioAtFloor : p > capP ? ratioAtCap : offerValue / p;
        const collarVal = collarRatio * p;
        return { p, fixedVal, floatRatio, collarRatio, collarVal };
      });
      return {
        title: "Exchange ratio and collar",
        summary: `At ${fmt.moneyRaw(pA, 2)} the ${fmt.pct(prem, 0)} premium implies ${fmt.moneyRaw(offerValue, 2)} of value per target share, a fixed ratio of ${fixedRatio.toFixed(4)}. A fixed ratio leaves target holders with the acquirer's price risk: a 20% fall takes the value to ${fmt.moneyRaw(fixedRatio * pA * 0.8, 2)}. A floating ratio protects value but dilutes the acquirer, issuing ${fmt.num((offerValue / (pA * 0.8)) * sT, 1)}mm shares instead of ${fmt.num(fixedRatio * sT, 1)}mm at that price. The collar fixes value between ${fmt.moneyRaw(floorP, 2)} and ${fmt.moneyRaw(capP, 2)} and fixes the ratio outside it.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Fixed exchange ratio", value: fixedRatio.toFixed(4) }, { label: "Value per target share", value: fmt.moneyRaw(offerValue, 2) },
            { label: "Collar floor / cap", value: `${fmt.moneyRaw(floorP, 2)} - ${fmt.moneyRaw(capP, 2)}` },
            { label: "Ratio at the floor", value: ratioAtFloor.toFixed(4) }, { label: "Ratio at the cap", value: ratioAtCap.toFixed(4) },
            { label: "Target ownership (fixed)", value: fmt.pct(own(fixedRatio), 1) },
          ] },
          { type: "table", title: "Outcomes by acquirer price", columns: ["Acquirer price", "Fixed: value", "Fixed: premium", "Floating: ratio", "Floating: value", "Collar: ratio", "Collar: value", "Target ownership (collar)"],
            rows: rows.map((r) => [fmt.moneyRaw(r.p, 2), fmt.moneyRaw(r.fixedVal, 2), fmt.pct(r.fixedVal / pT - 1, 1), r.floatRatio.toFixed(4), fmt.moneyRaw(offerValue, 2), r.collarRatio.toFixed(4), fmt.moneyRaw(r.collarVal, 2), fmt.pct(own(r.collarRatio), 1)]),
            emphasisRow: 3 },
          { type: "line", title: "Value delivered per target share", format: "num", series: [
            { name: "Fixed ratio", points: rows.map((r) => ({ x: fmt.moneyRaw(r.p, 2), y: r.fixedVal })) },
            { name: "Floating ratio", points: rows.map((r) => ({ x: fmt.moneyRaw(r.p, 2), y: offerValue })) },
            { name: "Collar", points: rows.map((r) => ({ x: fmt.moneyRaw(r.p, 2), y: r.collarVal })) },
          ] },
          { type: "callout", tone: "info", title: "Risk allocation", text: `A fixed ratio gives target holders the economics of the combined company from signing and leaves them exposed to the acquirer's price; it is the norm in mergers of equals. A floating ratio guarantees value to the target and hands the dilution risk to the acquirer, so acquirers resist it in volatile markets. A collar splits the difference: value is fixed inside the band and the ratio is fixed outside it, with walk-away rights typically negotiated beyond the collar. Add a "fill or kill" walk-away right and a market-decline condition tied to a sector index if the acquirer's beta to the sector is high.` },
        ],
        caveats: [
          "Values ignore the target's own price movement and any market-wide decline condition or walk-away right in the agreement.",
          "Ownership assumes only the stock consideration; a cash-and-stock deal dilutes less. Target shares should be diluted under the treasury stock method at the offer price.",
          "Tax treatment differs: a fixed ratio is more likely to support tax-free reorganization treatment on the stock portion; confirm with counsel.",
        ],
      };
    },
  },
  {
    kind: "calc", id: "ma-premium-analysis", title: "Premium analysis", tagline: "Premiums to every reference price, and the multiples the offer implies.",
    description: "Computes the premium an offer represents to the unaffected 1-day, 1-week and 30-day prices, to the 30-day VWAP and to the 52-week high and low, then converts the offer into implied equity value, enterprise value and EV/revenue and EV/EBITDA multiples.",
    roles: ["banker", "pe", "markets", "corpfin", "student"], category: "Valuation", icon: "TrendingUp", savesMinutes: 45, tags: ["premium", "unaffected price", "offer"],
    fields: [
      { key: "offer", label: "Offer price per share", type: "number", unit: "$", required: true, default: 45 },
      { key: "p1d", label: "Unaffected price (1 day prior)", type: "number", unit: "$", required: true, default: 34 },
      { key: "p1w", label: "Price 1 week prior", type: "number", unit: "$", default: 33 },
      { key: "p30", label: "Price 30 days prior", type: "number", unit: "$", default: 31 },
      { key: "vwap30", label: "30-day VWAP", type: "number", unit: "$", default: 32 },
      { key: "high52", label: "52-week high", type: "number", unit: "$", default: 48 },
      { key: "low52", label: "52-week low", type: "number", unit: "$", default: 25 },
      { key: "shares", label: "Diluted shares at the offer price", type: "number", unit: "mm", required: true, default: 200 },
      { key: "netDebt", label: "Net debt and other EV items", type: "number", unit: "$mm", default: 1200 },
      { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", default: 3000 },
      { key: "ebitda", label: "LTM EBITDA", type: "number", unit: "$mm", default: 700 },
    ],
    example: { offer: 45, p1d: 34, p1w: 33, p30: 31, vwap30: 32, high52: 48, low52: 25, shares: 200, netDebt: 1200, revenue: 3000, ebitda: 700 },
    prefill: (c) => ({ p1d: c.price?.last ?? 30, high52: c.price?.high52 ?? 0, low52: c.price?.low52 ?? 0, shares: c.balance.sharesOut ?? 100, netDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0), revenue: c.ltm.revenue ?? 0, ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0 }),
    compute: (i: Inputs): WorkflowOutput => {
      const o = num(i, "offer"), sh = num(i, "shares");
      if (o <= 0 || sh <= 0) throw new Error("Offer price and diluted shares must be positive.");
      const refs: { label: string; p: number }[] = [
        { label: "Unaffected (1 day prior)", p: num(i, "p1d") }, { label: "1 week prior", p: num(i, "p1w") },
        { label: "30 days prior", p: num(i, "p30") }, { label: "30-day VWAP", p: num(i, "vwap30") },
        { label: "52-week high", p: num(i, "high52") }, { label: "52-week low", p: num(i, "low52") },
      ].filter((r) => r.p > 0);
      if (!refs.length) throw new Error("Enter at least one reference price.");
      const eq = o * sh, ev = eq + num(i, "netDebt");
      const rev = num(i, "revenue"), ebitda = num(i, "ebitda");
      const prem = (p: number) => o / p - 1;
      return {
        title: "Premium analysis",
        summary: `The ${fmt.moneyRaw(o, 2)} offer is a ${fmt.pct(prem(refs[0].p), 1)} premium to the unaffected price of ${fmt.moneyRaw(refs[0].p, 2)} and ${fmt.pct(prem(num(i, "vwap30") || refs[0].p), 1)} to the 30-day VWAP. It implies ${fmt.money(eq)} of equity value and ${fmt.money(ev)} of enterprise value, or ${ebitda > 0 ? fmt.x(ev / ebitda) : "NM"} LTM EBITDA and ${rev > 0 ? fmt.x(ev / rev) : "NM"} LTM revenue.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Premium to unaffected", value: fmt.pct(prem(refs[0].p), 1), tone: prem(refs[0].p) >= 0.25 ? "pos" : "warn" },
            { label: "Implied equity value", value: fmt.money(eq) }, { label: "Implied EV", value: fmt.money(ev) },
            { label: "EV / LTM EBITDA", value: ebitda > 0 ? fmt.x(ev / ebitda) : "NM" }, { label: "EV / LTM revenue", value: rev > 0 ? fmt.x(ev / rev) : "NM" },
            { label: "Versus 52-week high", value: num(i, "high52") > 0 ? fmt.pct(prem(num(i, "high52")), 1) : "n/a" },
          ] },
          { type: "table", title: "Premium to each reference price", columns: ["Reference", "Price", "Premium", "Implied equity value ($mm)", "Implied EV ($mm)"],
            rows: refs.map((r) => [r.label, fmt.moneyRaw(r.p, 2), fmt.pct(prem(r.p), 1), fmt.num(eq, 0), fmt.num(ev, 0)]), emphasisRow: 0 },
          { type: "bar", title: "Premium by reference price", format: "pct", reference: { value: 0.3, label: "Typical control premium 25-50%" }, data: refs.map((r) => ({ label: r.label, value: prem(r.p), emphasis: r.label.startsWith("Unaffected") })) },
        ],
        caveats: [
          "Control premiums typically run 25-50%; all-stock deals price lower and competitive processes higher. The 2025 sample of 160 US public targets showed a median termination fee of 2.7% of transaction value, a useful cross-check on how the package was negotiated.",
          "The unaffected price must precede any leak: if a rumor moved the stock, use the last trading day before the first report and disclose both dates, as merger proxies do.",
          "Diluted shares must be struck with the treasury stock method at the offer price, and net debt should include preferred, minority interest, earnouts and any debt-like item assumed.",
        ],
      };
    },
  },
  {
    kind: "calc", id: "ma-calendarization", title: "Calendarization & LTM / NTM", tagline: "Off-cycle fiscal years standardized to December, with LTM built from the stubs.",
    description: "Standardizes a non-December filer for a comps sheet: LTM equals the last fiscal year plus the current year-to-date less the prior year-to-date, and calendar-year figures weight two fiscal years by the months that fall inside the calendar year, then shows the multiples on each basis so the footnote writes itself.",
    roles: ["banker", "pe", "markets", "corpfin", "student"], category: "Valuation", icon: "Calendar", savesMinutes: 45, tags: ["calendarization", "LTM", "comps"],
    fields: [
      { key: "fyeMonth", label: "Fiscal year end", type: "select", options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], default: "January" },
      { key: "lastFyRevenue", label: "Last completed FY revenue", type: "number", unit: "$mm", required: true, default: 3600 },
      { key: "lastFyEbitda", label: "Last completed FY EBITDA", type: "number", unit: "$mm", default: 300 },
      { key: "ytdRevenue", label: "Current YTD revenue", type: "number", unit: "$mm", default: 2200 },
      { key: "ytdEbitda", label: "Current YTD EBITDA", type: "number", unit: "$mm", default: 240 },
      { key: "priorYtdRevenue", label: "Prior-year YTD revenue", type: "number", unit: "$mm", default: 1700 },
      { key: "priorYtdEbitda", label: "Prior-year YTD EBITDA", type: "number", unit: "$mm", default: 150 },
      { key: "fyARevenue", label: "FY estimate: year ending in this calendar year", type: "number", unit: "$mm", default: 4600 },
      { key: "fyAEbitda", label: "FY estimate EBITDA (year A)", type: "number", unit: "$mm", default: 460 },
      { key: "fyBRevenue", label: "FY estimate: following year (B)", type: "number", unit: "$mm", default: 5700 },
      { key: "fyBEbitda", label: "FY estimate EBITDA (year B)", type: "number", unit: "$mm", default: 680 },
      { key: "fyCRevenue", label: "FY estimate: year after (C)", type: "number", unit: "$mm", default: 6900 },
      { key: "fyCEbitda", label: "FY estimate EBITDA (year C)", type: "number", unit: "$mm", default: 900 },
      { key: "ev", label: "Enterprise value", type: "number", unit: "$mm", required: true, default: 45000 },
    ],
    example: { fyeMonth: "January", lastFyRevenue: 3626, lastFyEbitda: 300, ytdRevenue: 2280, ytdEbitda: 250, priorYtdRevenue: 1760, priorYtdEbitda: 150, fyARevenue: 4600, fyAEbitda: 460, fyBRevenue: 5700, fyBEbitda: 680, fyCRevenue: 6900, fyCEbitda: 900, ev: 45000 },
    compute: (i: Inputs): WorkflowOutput => {
      const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const m = months.indexOf(str(i, "fyeMonth", "December")) + 1;
      if (m <= 0) throw new Error("Choose a fiscal year end month.");
      const ev = num(i, "ev");
      if (ev <= 0) throw new Error("Enterprise value must be positive.");
      const ltmRev = num(i, "lastFyRevenue") + num(i, "ytdRevenue") - num(i, "priorYtdRevenue");
      const ltmEbitda = num(i, "lastFyEbitda") + num(i, "ytdEbitda") - num(i, "priorYtdEbitda");
      const wA = m / 12, wB = 1 - wA;
      const cy1Rev = wA * num(i, "fyARevenue") + wB * num(i, "fyBRevenue");
      const cy1Ebitda = wA * num(i, "fyAEbitda") + wB * num(i, "fyBEbitda");
      const cy2Rev = wA * num(i, "fyBRevenue") + wB * num(i, "fyCRevenue");
      const cy2Ebitda = wA * num(i, "fyBEbitda") + wB * num(i, "fyCEbitda");
      const x = (metric: number) => (metric > 0 ? ev / metric : null);
      const rows = [
        ["LTM (reported stubs)", fmt.num(ltmRev, 0), fmt.num(ltmEbitda, 0), fmt.pct(ltmEbitda / Math.max(1, ltmRev), 1), fmt.x(x(ltmRev)), fmt.x(x(ltmEbitda)), "FY + current YTD - prior YTD"],
        ["FY A (as reported basis)", fmt.num(num(i, "fyARevenue"), 0), fmt.num(num(i, "fyAEbitda"), 0), fmt.pct(num(i, "fyAEbitda") / Math.max(1, num(i, "fyARevenue")), 1), fmt.x(x(num(i, "fyARevenue"))), fmt.x(x(num(i, "fyAEbitda"))), `Fiscal year ending ${str(i, "fyeMonth")}`],
        ["CY1 (calendarized)", fmt.num(cy1Rev, 0), fmt.num(cy1Ebitda, 0), fmt.pct(cy1Ebitda / Math.max(1, cy1Rev), 1), fmt.x(x(cy1Rev)), fmt.x(x(cy1Ebitda)), `${fmt.pct(wA, 0)} FY A + ${fmt.pct(wB, 0)} FY B`],
        ["CY2 (calendarized)", fmt.num(cy2Rev, 0), fmt.num(cy2Ebitda, 0), fmt.pct(cy2Ebitda / Math.max(1, cy2Rev), 1), fmt.x(x(cy2Rev)), fmt.x(x(cy2Ebitda)), `${fmt.pct(wA, 0)} FY B + ${fmt.pct(wB, 0)} FY C`],
      ];
      return {
        title: "Calendarization and LTM / NTM",
        summary: `With a ${str(i, "fyeMonth")} fiscal year end, ${fmt.pct(wA, 0)} of each calendar year comes from the fiscal year ending in it and ${fmt.pct(wB, 0)} from the next. LTM revenue is ${fmt.money(ltmRev)} and LTM EBITDA ${fmt.money(ltmEbitda)}; calendarized CY1 revenue is ${fmt.money(cy1Rev)} against ${fmt.money(num(i, "fyARevenue"))} on a fiscal basis, which moves EV/revenue from ${fmt.x(x(num(i, "fyARevenue")))} to ${fmt.x(x(cy1Rev))}. Mixing fiscal and calendar years across a comp set is the most common source of a wrong multiple.`,
        blocks: [
          { type: "kpis", items: [
            { label: "LTM revenue", value: fmt.money(ltmRev) }, { label: "LTM EBITDA", value: fmt.money(ltmEbitda) },
            { label: "EV / LTM revenue", value: fmt.x(x(ltmRev)) }, { label: "EV / CY1 revenue", value: fmt.x(x(cy1Rev)) },
            { label: "EV / CY1 EBITDA", value: fmt.x(x(cy1Ebitda)) }, { label: "Calendar weights", value: `${fmt.pct(wA, 0)} / ${fmt.pct(wB, 0)}` },
          ] },
          { type: "table", title: "Periods and multiples (USD mm)", columns: ["Period", "Revenue", "EBITDA", "Margin", "EV / revenue", "EV / EBITDA", "Basis"], rows, emphasisRow: 2 },
          { type: "bar", title: "EV / revenue by basis", format: "x", data: [
            { label: "LTM", value: x(ltmRev) }, { label: "FY A", value: x(num(i, "fyARevenue")) }, { label: "CY1", value: x(cy1Rev), emphasis: true }, { label: "CY2", value: x(cy2Rev) },
          ] },
          { type: "markdown", title: "Footnote to paste", text: `Financials calendarized to a December year end. ${str(i, "fyeMonth")} fiscal year end: calendar year figures weight the fiscal year ending within the calendar year at ${fmt.pct(wA, 0)} and the following fiscal year at ${fmt.pct(wB, 0)}. LTM is the last completed fiscal year plus the current year-to-date less the prior-year year-to-date. EBITDA is as presented by the company; confirm whether stock-based compensation is added back consistently across the peer set, and whether any acquisition requires a pro forma LTM.` },
        ],
        caveats: [
          "Month weighting assumes revenue and EBITDA are spread evenly through the year. For a seasonal business (retail fourth quarter, cruise summer, tax-season software) weight the actual quarters instead and say so in the footnote.",
          "Forward figures are the user's estimates: the platform has no consensus data, so label CY1 and CY2 as management or user estimates rather than consensus.",
          "Normalize one-time items (restructuring, impairments, litigation, gains on sale, currency) before calendarizing, and treat stock-based compensation the same way for every company in the set.",
        ],
      };
    },
  },
];

/* ======================================================================================
 * Restructuring calculators
 * ====================================================================================== */

const RX_CALCS: ToolDef[] = [
  {
    kind: "calc", id: "rx-liquidity-runway", title: "Liquidity runway & 13-week cash flow", tagline: "Weekly receipts and disbursements to the trough week and the date a deal is required.",
    description: "Builds the 13-week cash flow the way a restructuring team uses it: weekly receipts and disbursements with professional fees, revolver availability net of letters of credit and any borrowing base, revolver draws when cash runs out, and the trough week, minimum-liquidity breach and runway date that set the deal deadline.",
    roles: ["banker", "corpfin", "pe", "consultant"], category: "Credit & restructuring", icon: "Wallet", savesMinutes: 120, tags: ["13-week cash flow", "liquidity", "runway"],
    fields: [
      { key: "cash", label: "Opening unrestricted cash", type: "number", unit: "$mm", required: true, default: 150 },
      { key: "restricted", label: "Restricted / trapped cash (excluded)", type: "number", unit: "$mm", default: 20 },
      { key: "commitment", label: "Revolver commitment", type: "number", unit: "$mm", default: 300 },
      { key: "drawn", label: "Revolver drawn", type: "number", unit: "$mm", default: 100 },
      { key: "lc", label: "Letters of credit outstanding", type: "number", unit: "$mm", default: 40 },
      { key: "borrowingBase", label: "Borrowing base (0 if not an ABL)", type: "number", unit: "$mm", default: 0 },
      { key: "receipts", label: "Weekly receipts", type: "text", required: true, default: "42 38 55 41 39 52 44 40 58 43 41 54 46", help: "One value per week, space or comma separated" },
      { key: "disbursements", label: "Weekly disbursements", type: "text", required: true, default: "48 44 61 47 45 58 50 46 64 49 47 60 52" },
      { key: "profFees", label: "Professional fees per week", type: "number", unit: "$mm", default: 1.5 },
      { key: "minLiquidity", label: "Minimum liquidity covenant", type: "number", unit: "$mm", default: 75 },
      { key: "stress", label: "Downside: receipts haircut", type: "number", unit: "%", default: 0 },
    ],
    example: { cash: 150, restricted: 20, commitment: 300, drawn: 100, lc: 40, borrowingBase: 0, receipts: "42 38 55 41 39 52 44 40 58 43 41 54 46", disbursements: "48 44 61 47 45 58 50 46 64 49 47 60 52", profFees: 1.5, minLiquidity: 75, stress: 10 },
    prefill: (c) => ({ cash: c.balance.cash ?? 0 }),
    compute: (i: Inputs): WorkflowOutput => {
      const rec = nums(i, "receipts"), dis = nums(i, "disbursements");
      if (!rec.length || !dis.length) throw new Error("Enter weekly receipts and disbursements, one value per week.");
      if (rec.length !== dis.length) throw new Error(`Receipts have ${rec.length} weeks and disbursements ${dis.length}: the two series must be the same length.`);
      const fees = num(i, "profFees"), minLiq = num(i, "minLiquidity"), stress = num(i, "stress") / 100;
      const bb = num(i, "borrowingBase");
      const cap = bb > 0 ? Math.min(num(i, "commitment"), bb) : num(i, "commitment");
      let avail = Math.max(0, cap - num(i, "drawn") - num(i, "lc"));
      let cash = num(i, "cash"), drawnTotal = num(i, "drawn");
      const rows = rec.map((r, k) => {
        const receipts = r * (1 - stress), disb = dis[k] + fees;
        const net = receipts - disb;
        cash += net;
        let draw = 0;
        if (cash < 0 && avail > 0) { draw = Math.min(-cash, avail); cash += draw; avail -= draw; drawnTotal += draw; }
        return { week: k + 1, receipts, disb, net, draw, cash, avail, liquidity: cash + avail };
      });
      const trough = rows.reduce((a, r) => (r.liquidity < a.liquidity ? r : a), rows[0]);
      const breach = rows.find((r) => r.liquidity < minLiq) ?? null;
      const dry = rows.find((r) => r.cash < 0) ?? null;
      const avgBurn = rows.reduce((a, r) => a + r.net, 0) / rows.length;
      const endLiq = rows[rows.length - 1].liquidity;
      const weeksLeft = avgBurn < 0 ? (endLiq - minLiq) / -avgBurn : Infinity;
      return {
        title: "Liquidity runway and 13-week cash flow",
        summary: `Opening liquidity is ${fmt.money(num(i, "cash") + Math.max(0, cap - num(i, "drawn") - num(i, "lc")))} (cash of ${fmt.money(num(i, "cash"))} plus ${fmt.money(Math.max(0, cap - num(i, "drawn") - num(i, "lc")))} of revolver availability)${stress > 0 ? ` with receipts stressed ${fmt.pct(stress, 0)}` : ""}. Average weekly burn is ${fmt.money(-avgBurn)}, the trough is ${fmt.money(trough.liquidity)} in week ${trough.week}, and ${breach ? `the ${fmt.money(minLiq)} minimum liquidity covenant is breached in week ${breach.week}` : `the ${fmt.money(minLiq)} minimum liquidity covenant holds through the forecast`}. ${Number.isFinite(weeksLeft) ? `At this burn the company reaches the covenant floor in about ${Math.max(0, weeksLeft).toFixed(0)} weeks past the forecast.` : "The forecast does not run to a liquidity cliff."}`,
        blocks: [
          { type: "kpis", items: [
            { label: "Opening liquidity", value: fmt.money(num(i, "cash") + Math.max(0, cap - num(i, "drawn") - num(i, "lc"))) },
            { label: "Trough liquidity", value: fmt.money(trough.liquidity), tone: trough.liquidity < minLiq ? "neg" : "warn", hint: `Week ${trough.week}` },
            { label: "Average weekly burn", value: fmt.money(-avgBurn), tone: avgBurn < 0 ? "neg" : "pos" },
            { label: "Covenant breach", value: breach ? `Week ${breach.week}` : "None in forecast", tone: breach ? "neg" : "pos" },
            { label: "Cash exhausted", value: dry ? `Week ${dry.week}` : "No", tone: dry ? "neg" : "pos" },
            { label: "Revolver drawn at end", value: fmt.money(drawnTotal) },
          ] },
          { type: "table", title: "13-week cash flow (USD mm)", columns: ["Week", "Receipts", "Disbursements", "Net", "Revolver draw", "Ending cash", "Availability", "Liquidity", "Covenant headroom"],
            rows: rows.map((r) => [`W${r.week}`, fmt.num(r.receipts, 1), fmt.num(r.disb, 1), fmt.num(r.net, 1), fmt.num(r.draw, 1), fmt.num(r.cash, 1), fmt.num(r.avail, 1), fmt.num(r.liquidity, 1), fmt.num(r.liquidity - minLiq, 1)]),
            emphasisRow: trough.week - 1, note: `Disbursements include ${fmt.money(fees)} of professional fees per week. Restricted cash of ${fmt.money(num(i, "restricted"))} is excluded from liquidity.` },
          { type: "line", title: "Cash, availability and total liquidity (USD mm)", format: "money", series: [
            { name: "Ending cash", points: rows.map((r) => ({ x: `W${r.week}`, y: r.cash })) },
            { name: "Revolver availability", points: rows.map((r) => ({ x: `W${r.week}`, y: r.avail })) },
            { name: "Total liquidity", points: rows.map((r) => ({ x: `W${r.week}`, y: r.liquidity })) },
            { name: "Covenant floor", points: rows.map((r) => ({ x: `W${r.week}`, y: minLiq })) },
          ] },
          { type: "callout", tone: breach || dry ? "neg" : "warn", title: "What this sets up", text: `${breach ? `A transaction has to be agreed before week ${breach.week}, because breaching the minimum liquidity covenant is an event of default that accelerates the debt and removes the option of an orderly process.` : "Liquidity holds through the forecast, so the deadline is set by the next maturity or covenant test rather than by cash."} In a chapter 11 case this forecast becomes the DIP budget: expect a rolling forecast refreshed every four weeks, weekly variance reporting, and permitted variances of roughly 15-20% on receipts with tighter tests on disbursements (Alkegen's order capped cumulative disbursements at 112.5% of budget from week four with a $32.5mm minimum liquidity test). Size any DIP off the trough week plus a cushion, the professional fee carve-out and case costs.` },
        ],
        caveats: [
          "A direct-method forecast: receipts should be built from the collection curve by customer and disbursements from payroll, vendor terms, rent, interest, taxes, capex and professional fees. The company's financial adviser or CRO normally owns the model; the banker stress-tests it.",
          "Revolver availability assumes the facility remains available: a borrowing-base reserve, a material adverse change condition or a covenant breach can remove it exactly when it is needed. Letters of credit reduce availability but not cash.",
          "Restricted and foreign trapped cash are excluded from liquidity. Post-petition, adequate protection payments, critical vendor payments and utility deposits are additional draws.",
        ],
        nextSteps: ["Size the DIP facility from the trough week", "Recompute covenant headroom on the stressed case", "Map the maturity wall against the runway date"],
      };
    },
  },
  {
    kind: "calc", id: "rx-covenant-headroom", title: "Covenant headroom & breach EBITDA", tagline: "Headroom by quarter, the EBITDA decline that breaches, and what an add-back haircut does.",
    description: "Recomputes a maintenance or springing covenant quarter by quarter on the defined EBITDA, showing headroom in percent, the EBITDA decline that would breach each test, and a sensitivity that disallows the add-backs the company is claiming, which is where covenant cushions usually disappear.",
    roles: ["banker", "pe", "corpfin"], category: "Credit & restructuring", icon: "Gauge", savesMinutes: 90, tags: ["covenant", "headroom", "add-backs"],
    fields: [
      { key: "test", label: "Covenant", type: "select", options: ["Total leverage (max)", "Net leverage (max)", "First-lien net leverage (max)", "Interest coverage (min)", "Fixed charge coverage (min)"], default: "Net leverage (max)" },
      { key: "levels", label: "Covenant levels by quarter", type: "text", required: true, default: "5.00 4.75 4.50 4.25", help: "One level per quarter, in order (leverage turns or coverage turns)" },
      { key: "ebitda", label: "Covenant EBITDA (LTM)", type: "number", unit: "$mm", required: true, default: 400 },
      { key: "addbacks", label: "Of which add-backs claimed", type: "number", unit: "$mm", default: 60 },
      { key: "trend", label: "EBITDA change per quarter", type: "number", unit: "%", default: -3 },
      { key: "debt", label: "Total debt", type: "number", unit: "$mm", required: true, default: 1800 },
      { key: "firstLien", label: "First-lien debt", type: "number", unit: "$mm", default: 1200 },
      { key: "cash", label: "Cash (netting capped where the document caps it)", type: "number", unit: "$mm", default: 120 },
      { key: "amortPerQ", label: "Scheduled amortization per quarter", type: "number", unit: "$mm", default: 5 },
      { key: "cashInterest", label: "Cash interest (LTM)", type: "number", unit: "$mm", default: 150 },
      { key: "capex", label: "Maintenance capex (LTM)", type: "number", unit: "$mm", default: 60 },
      { key: "cashTaxes", label: "Cash taxes (LTM)", type: "number", unit: "$mm", default: 20 },
    ],
    example: { test: "Net leverage (max)", levels: "5.00 4.75 4.50 4.25", ebitda: 400, addbacks: 60, trend: -4, debt: 1800, firstLien: 1200, cash: 120, amortPerQ: 5, cashInterest: 150, capex: 60, cashTaxes: 20 },
    compute: (i: Inputs): WorkflowOutput => {
      const levels = nums(i, "levels");
      if (!levels.length) throw new Error("Enter at least one covenant level.");
      const e0 = num(i, "ebitda");
      if (e0 <= 0) throw new Error("Covenant EBITDA must be positive.");
      const test = str(i, "test", "Net leverage (max)");
      const isMax = test.includes("max");
      const trend = num(i, "trend") / 100, amort = num(i, "amortPerQ");
      const ratioOf = (ebitda: number, q: number) => {
        const debt = Math.max(0, num(i, "debt") - amort * q), fl = Math.max(0, num(i, "firstLien") - amort * q);
        const cash = num(i, "cash");
        if (test.startsWith("Total leverage")) return debt / ebitda;
        if (test.startsWith("Net leverage")) return (debt - cash) / ebitda;
        if (test.startsWith("First-lien")) return (fl - cash) / ebitda;
        if (test.startsWith("Interest")) return ebitda / Math.max(0.01, num(i, "cashInterest"));
        return (ebitda - num(i, "capex") - num(i, "cashTaxes")) / Math.max(0.01, num(i, "cashInterest") + amort * 4);
      };
      const rows = levels.map((lvl, k) => {
        const q = k + 1, ebitda = e0 * Math.pow(1 + trend, q), actual = ratioOf(ebitda, q);
        const headroom = isMax ? (lvl - actual) / lvl : (actual - lvl) / lvl;
        const needed = isMax
          ? (test.startsWith("Total leverage") ? Math.max(0, num(i, "debt") - amort * q) / lvl : test.startsWith("First-lien") ? (Math.max(0, num(i, "firstLien") - amort * q) - num(i, "cash")) / lvl : (Math.max(0, num(i, "debt") - amort * q) - num(i, "cash")) / lvl)
          : (test.startsWith("Interest") ? lvl * num(i, "cashInterest") : lvl * (num(i, "cashInterest") + amort * 4) + num(i, "capex") + num(i, "cashTaxes"));
        return { q, ebitda, actual, lvl, headroom, needed, cushion: (ebitda - needed) / ebitda, breach: isMax ? actual > lvl : actual < lvl };
      });
      const first = rows.find((r) => r.breach) ?? null;
      const declines = [0, 0.1, 0.2, 0.3, 0.4];
      const haircuts = [0, 0.25, 0.5, 1];
      const ab = Math.min(num(i, "addbacks"), e0);
      const grid = declines.map((d) => haircuts.map((h) => ratioOf(Math.max(1, (e0 - ab * h) * (1 - d)), 1)));
      return {
        title: `Covenant headroom: ${test}`,
        summary: `On ${fmt.money(e0)} of covenant EBITDA the ${test.toLowerCase()} test runs at ${fmt.x(rows[0].actual)} against a ${fmt.x(rows[0].lvl)} level, headroom of ${fmt.pct(rows[0].headroom, 1)}. EBITDA can fall ${fmt.pct(Math.max(0, rows[0].cushion), 1)} before the first test breaches. ${first ? `On the ${fmt.pct(trend, 1)} quarterly trend the test breaches in quarter ${first.q}.` : "The test holds across every quarter shown."} Disallowing the ${fmt.money(ab)} of claimed add-backs takes the current ratio to ${fmt.x(ratioOf(Math.max(1, e0 - ab), 1))}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Current ratio", value: fmt.x(rows[0].actual), tone: rows[0].breach ? "neg" : rows[0].headroom < 0.15 ? "warn" : "pos" },
            { label: "Covenant level", value: fmt.x(rows[0].lvl) }, { label: "Headroom", value: fmt.pct(rows[0].headroom, 1) },
            { label: "EBITDA cushion", value: fmt.pct(Math.max(0, rows[0].cushion), 1), hint: "Decline that breaches the test" },
            { label: "First breach", value: first ? `Q${first.q}` : "None", tone: first ? "neg" : "pos" },
            { label: "Ratio without add-backs", value: fmt.x(ratioOf(Math.max(1, e0 - ab), 1)) },
          ] },
          { type: "table", title: "Headroom by quarter", columns: ["Quarter", "Covenant EBITDA ($mm)", "Level", "Actual", "Headroom", "EBITDA to breach ($mm)", "Cushion", "Status"],
            rows: rows.map((r) => [`Q${r.q}`, fmt.num(r.ebitda, 0), fmt.x(r.lvl), fmt.x(r.actual), fmt.pct(r.headroom, 1), fmt.num(r.needed, 0), fmt.pct(Math.max(0, r.cushion), 1), r.breach ? "Breach" : r.headroom < 0.15 ? "Tight" : "Compliant"]),
            emphasisRow: first ? first.q - 1 : 0 },
          { type: "bar", title: "Headroom by quarter", format: "pct", reference: { value: 0.15, label: "15% - the level at which lenders re-engage" }, data: rows.map((r) => ({ label: `Q${r.q}`, value: r.headroom, emphasis: r.breach })) },
          { type: "sensitivity", title: `${test}: EBITDA decline × add-back haircut`, rowLabel: "EBITDA decline", colLabel: "Add-backs disallowed", rows: declines.map((d) => fmt.pct(d, 0)), cols: haircuts.map((h) => fmt.pct(h, 0)), values: grid, format: "x", baseRow: 0, baseCol: 0 },
        ],
        caveats: [
          "Every covenant must be computed on the document's own definitions: defined EBITDA, whether cash netting is capped, whether the revolver counts when undrawn, and whether the test is maintenance or springs only above a revolver utilization threshold (commonly 35-40% in broadly syndicated loans).",
          "Add-back caps on run-rate cost savings and synergies typically run 25-30% of EBITDA with an 18-24 month realization window, and S&P has found realized EBITDA about 30% below inception projections - which is why the add-back haircut column matters more than the base case.",
          "Direct-lending deals are usually set with a 25-35% cushion to the business plan, so headroom below 15% is where lenders start asking for an amendment fee or an equity cure.",
          "Compliance certificates are private, so the covenant EBITDA here is the user's input rather than the certified number.",
        ],
        nextSteps: ["Check the LME capacity the same document allows", "Run the liquidity runway to see which binds first", "Map the maturity wall for the refinancing window"],
      };
    },
  },
  {
    kind: "calc", id: "rx-recovery-waterfall", title: "Recovery waterfall & fulcrum", tagline: "Absolute priority across classes at several enterprise values, with the fulcrum identified.",
    description: "Runs the value-break analysis: distributable value after the DIP and administrative claims is allocated down the priority ladder, pro rata within each rank, to give a recovery for every class at each enterprise value scenario, identify the fulcrum security, and show the equity split once the management incentive plan and a rights offering are layered in.",
    roles: ["banker", "pe", "markets"], category: "Credit & restructuring", icon: "Layers", savesMinutes: 180, tags: ["waterfall", "recovery", "fulcrum", "APR"],
    fields: [
      { key: "classes", label: "Claims by class", type: "csv", required: true, columns: "class,amount,rank", placeholder: "First lien term loan,1200,1", help: "Rank 1 is the most senior; equal ranks share pro rata" },
      { key: "evs", label: "Enterprise value scenarios", type: "text", required: true, default: "1400 1750 2100 2450", help: "Space separated, in $mm" },
      { key: "excessCash", label: "Excess cash available for distribution", type: "number", unit: "$mm", default: 50 },
      { key: "dip", label: "DIP claim (superpriority)", type: "number", unit: "$mm", default: 150 },
      { key: "admin", label: "Administrative and professional claims", type: "number", unit: "$mm", default: 75 },
      { key: "mip", label: "Management incentive plan", type: "number", unit: "% of new equity", default: 8 },
      { key: "rights", label: "Rights offering", type: "number", unit: "% of new equity", default: 15 },
      { key: "rightsDiscount", label: "Rights offering discount to plan value", type: "number", unit: "%", default: 30 },
      { key: "baseEv", label: "Base case enterprise value", type: "number", unit: "$mm", default: 1750 },
    ],
    example: { classes: "class,amount,rank\nFirst lien term loan,1200,1\nFirst lien notes,400,1\nSecond lien notes,500,2\nSenior unsecured notes,600,3\nTrade and other unsecured,150,3\nSubordinated notes,200,4", evs: "1400 1750 2100 2450", excessCash: 50, dip: 150, admin: 75, mip: 8, rights: 15, rightsDiscount: 30, baseEv: 2100 },
    compute: (i: Inputs): WorkflowOutput => {
      const raw = str(i, "classes");
      if (!raw.trim()) throw new Error("Paste the claims by class as CSV: class,amount,rank.");
      const parsed = parseCsv(raw);
      const lines = Number.isFinite(Number(parsed.header[1])) ? [parsed.header, ...parsed.rows] : parsed.rows;
      const classes = lines.map((r, k) => ({ name: r[0] || `Class ${k + 1}`, amount: Number(r[1]) || 0, rank: Number(r[2]) || k + 1 })).filter((c) => c.amount > 0);
      if (!classes.length) throw new Error("No claims parsed: expected rows of class,amount,rank with a positive amount.");
      const evs = nums(i, "evs");
      if (!evs.length) throw new Error("Enter at least one enterprise value scenario.");
      const baseEv = num(i, "baseEv") || evs[Math.floor(evs.length / 2)];
      const ranks = [...new Set(classes.map((c) => c.rank))].sort((a, b) => a - b);
      const run = (ev: number) => {
        let pot = ev + num(i, "excessCash") - num(i, "dip") - num(i, "admin");
        const out = new Map<string, number>();
        for (const r of ranks) {
          const group = classes.filter((c) => c.rank === r);
          const need = group.reduce((a, c) => a + c.amount, 0);
          const pay = Math.max(0, Math.min(pot, need));
          for (const c of group) out.set(c.name, need === 0 ? 0 : (pay * (c.amount / need)) / c.amount);
          pot -= pay;
        }
        return { recoveries: out, residual: Math.max(0, pot) };
      };
      const base = run(baseEv);
      const fulcrum = classes.find((c) => { const r = base.recoveries.get(c.name) ?? 0; return r < 0.999; }) ?? null;
      const mip = num(i, "mip") / 100, rights = num(i, "rights") / 100, disc = num(i, "rightsDiscount") / 100;
      const planEquity = Math.max(0, baseEv + num(i, "excessCash") - num(i, "dip") - num(i, "admin"));
      const toCreditors = Math.max(0, 1 - mip - rights);
      const rightsProceeds = planEquity * rights * (1 - disc);
      const dist = evs.map((ev) => ({ ev, ...run(ev) }));
      return {
        title: "Recovery waterfall",
        summary: `At a ${fmt.money(baseEv)} enterprise value, distributable value after the DIP and administrative claims is ${fmt.money(planEquity)}. ${fulcrum ? `The fulcrum is the ${fulcrum.name} at a ${fmt.pct(base.recoveries.get(fulcrum.name) ?? 0, 1)} recovery, so that class takes the reorganized equity.` : "Every class is paid in full and residual value flows to existing equity."} Total claims below the DIP are ${fmt.money(classes.reduce((a, c) => a + c.amount, 0))}, so the value break sits at rank ${fulcrum ? fulcrum.rank : ranks[ranks.length - 1]}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Distributable value", value: fmt.money(planEquity) },
            { label: "Fulcrum class", value: fulcrum ? fulcrum.name : "Equity retains value", tone: fulcrum ? "warn" : "pos" },
            { label: "Fulcrum recovery", value: fulcrum ? fmt.pct(base.recoveries.get(fulcrum.name) ?? 0, 1) : "n/a" },
            { label: "Total claims", value: fmt.money(classes.reduce((a, c) => a + c.amount, 0) + num(i, "dip") + num(i, "admin")) },
            { label: "New equity to creditors", value: fmt.pct(toCreditors, 0), hint: `After a ${fmt.pct(mip, 0)} MIP and a ${fmt.pct(rights, 0)} rights offering` },
            { label: "Rights offering proceeds", value: fmt.money(rightsProceeds), hint: `${fmt.pct(disc, 0)} discount to plan value` },
          ] },
          { type: "table", title: "Recovery by class and enterprise value", columns: ["Class", "Rank", "Claim ($mm)", ...evs.map((e) => `EV ${fmt.money(e)}`)],
            rows: classes.map((c) => [c.name, String(c.rank), fmt.num(c.amount, 0), ...dist.map((d) => fmt.pct(d.recoveries.get(c.name) ?? 0, 1))]),
            note: `Order of payment: DIP superpriority (${fmt.money(num(i, "dip"))}), administrative and professional claims (${fmt.money(num(i, "admin"))}), then each rank in turn, pro rata within a rank.` },
          { type: "bar", title: `Recovery at the base case EV of ${fmt.money(baseEv)}`, format: "pct", reference: { value: 1, label: "Paid in full" },
            data: classes.map((c) => ({ label: c.name, value: base.recoveries.get(c.name) ?? 0, emphasis: fulcrum?.name === c.name })) },
          { type: "sensitivity", title: "Recovery by class across enterprise value", rowLabel: "Class", colLabel: "Enterprise value", rows: classes.map((c) => c.name), cols: evs.map((e) => fmt.money(e)),
            values: classes.map((c) => dist.map((d) => d.recoveries.get(c.name) ?? 0)), format: "pct" },
          { type: "callout", tone: "info", title: "Plan mechanics from here", text: `The fulcrum class normally takes the new equity, senior classes are reinstated or take back paper, and junior classes receive "tips" - warrants or a small equity slice - to buy their vote. A rights offering at ${fmt.pct(disc, 0)} below plan value raises ${fmt.money(rightsProceeds)} and needs a backstop: academic averages sit near 6% of the raise but recent cases have run 8-14% (Hearthside 10%, Hornblower 10%, Azul 14%, United Site Services 8%), and after ConvergeOne was reversed in September 2025 on equal-treatment grounds any exclusive backstop needs a market test. Confirmation requires two-thirds in amount and one-half in number of each accepting class, the best-interests test against a chapter 7 liquidation, and cramdown analysis for any rejecting class.` },
        ],
        caveats: [
          "Build the waterfall entity by entity before consolidating: structural subordination and an incomplete guarantee package routinely change which class is the fulcrum, and a secured deficiency claim drops to unsecured under section 506 unless the holder makes the section 1111(b) election.",
          "Claim amounts are estimates until the schedules and statements of financial affairs are filed: trade, lease-rejection, litigation, pension, tax and intercompany claims are only sized post-petition.",
          "Enterprise value is the contested number in any case. Judges accept DCF, trading comps and precedent transactions, so present a range and a midpoint rather than a point estimate.",
        ],
        nextSteps: ["Build the pro forma capital structure at emergence and test feasibility", "Run a liquidation analysis for the best-interests test", "Compare the recoveries with precedent restructurings in the same sector"],
      };
    },
  },
];

/* ======================================================================================
 * Leveraged finance, DCM and ECM calculators
 * ====================================================================================== */

const CM_CALCS: ToolDef[] = [
  {
    kind: "calc", id: "lev-debt-capacity", title: "Debt capacity solver", tagline: "The binding constraint among leverage, coverage, fixed charges and covenant cushion.",
    description: "Sizes debt to the constraint that actually binds: maximum leverage, minimum interest coverage, a fixed-charge coverage floor, and the cushion a maintenance covenant needs to the business plan. Prices the structure off SOFR plus spread with OID accreted over a four-year life and shows the coverage grid.",
    roles: ["banker", "pe", "corpfin"], category: "Capital markets", icon: "Scale", savesMinutes: 90, tags: ["debt capacity", "leverage", "coverage", "FCCR"],
    fields: [
      { key: "ebitda", label: "EBITDA", type: "number", unit: "$mm", required: true, default: 150 },
      { key: "maintCapex", label: "Maintenance capex", type: "number", unit: "$mm", default: 20 },
      { key: "cashTaxes", label: "Cash taxes", type: "number", unit: "$mm", default: 15 },
      { key: "sofr", label: "SOFR", type: "number", unit: "%", default: 3.75 },
      { key: "spread", label: "Spread", type: "number", unit: "bps", default: 375 },
      { key: "oid", label: "OID", type: "number", unit: "price", default: 99.5 },
      { key: "maxLeverage", label: "Maximum total leverage", type: "number", unit: "x", default: 5 },
      { key: "minCoverage", label: "Minimum EBITDA / interest", type: "number", unit: "x", default: 2 },
      { key: "minFccr", label: "Minimum fixed charge coverage", type: "number", unit: "x", default: 1.5 },
      { key: "amortPct", label: "Scheduled amortization", type: "number", unit: "% of debt per year", default: 1 },
      { key: "cushion", label: "Covenant cushion to plan", type: "number", unit: "%", default: 30 },
    ],
    example: { ebitda: 150, maintCapex: 20, cashTaxes: 15, sofr: 3.75, spread: 375, oid: 99.5, maxLeverage: 5, minCoverage: 2, minFccr: 1.5, amortPct: 1, cushion: 30 },
    prefill: (c) => ({ ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 150, maintCapex: c.ltm.capex ?? 20 }),
    compute: (i: Inputs): WorkflowOutput => {
      const e = num(i, "ebitda"), capex = num(i, "maintCapex"), taxes = num(i, "cashTaxes");
      if (e <= 0) throw new Error("EBITDA must be positive.");
      const oid = num(i, "oid", 99.5);
      const rate = num(i, "sofr") / 100 + num(i, "spread") / 10000 + (100 - oid) / 4 / 100;
      const amort = num(i, "amortPct") / 100, cushion = num(i, "cushion") / 100;
      const maxLev = num(i, "maxLeverage"), minCov = num(i, "minCoverage"), minFccr = num(i, "minFccr");
      if (rate <= 0) throw new Error("The all-in rate must be positive.");
      const capLev = maxLev * e;
      const capCov = minCov > 0 ? e / (minCov * rate) : Infinity;
      const capFccr = minFccr > 0 ? Math.max(0, e - taxes - capex) / (minFccr * (rate + amort)) : Infinity;
      const capCushion = (maxLev / (1 + cushion)) * e;
      const options = [
        { name: `Maximum leverage ${fmt.x(maxLev)}`, cap: capLev, math: `${fmt.x(maxLev)} × ${fmt.money(e)}` },
        { name: `Interest coverage ${fmt.x(minCov)} minimum`, cap: capCov, math: `${fmt.money(e)} ÷ (${fmt.x(minCov)} × ${fmt.pct(rate, 2)})` },
        { name: `Fixed charge coverage ${fmt.x(minFccr)} minimum`, cap: capFccr, math: `(${fmt.money(e)} − ${fmt.money(taxes)} − ${fmt.money(capex)}) ÷ (${fmt.x(minFccr)} × (${fmt.pct(rate, 2)} + ${fmt.pct(amort, 1)}))` },
        { name: `Covenant cushion ${fmt.pct(cushion, 0)} to plan`, cap: capCushion, math: `${fmt.x(maxLev)} ÷ (1 + ${fmt.pct(cushion, 0)}) × ${fmt.money(e)}` },
      ];
      const binding = options.reduce((a, o) => (o.cap < a.cap ? o : a), options[0]);
      const debt = binding.cap, interest = debt * rate;
      const levs = [maxLev - 2, maxLev - 1, maxLev, maxLev + 1, maxLev + 2].filter((x) => x > 0);
      const rates = [rate - 0.02, rate - 0.01, rate, rate + 0.01, rate + 0.02];
      const grid = levs.map((L) => rates.map((r) => e / (L * e * r)));
      return {
        title: "Debt capacity",
        summary: `At ${fmt.money(e)} of EBITDA and an all-in cost of ${fmt.pct(rate, 2)}, capacity is ${fmt.money(debt)} or ${fmt.x(debt / e)} of leverage, and the binding constraint is ${binding.name.toLowerCase()}. That carries ${fmt.money(interest)} of cash interest, ${fmt.x(e / interest)} interest coverage and ${fmt.x(Math.max(0, e - taxes - capex) / (interest + debt * amort))} fixed charge coverage.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Debt capacity", value: fmt.money(debt) }, { label: "Implied leverage", value: fmt.x(debt / e) },
            { label: "Binding constraint", value: binding.name, tone: "warn" }, { label: "All-in rate", value: fmt.pct(rate, 2) },
            { label: "Cash interest", value: fmt.money(interest) }, { label: "Interest coverage", value: fmt.x(e / interest) },
            { label: "Fixed charge coverage", value: fmt.x(Math.max(0, e - taxes - capex) / (interest + debt * amort)) },
          ] },
          { type: "table", title: "Capacity by constraint (USD mm)", columns: ["Constraint", "Capacity", "Implied leverage", "Math", "Binding?"],
            rows: options.map((o) => [o.name, Number.isFinite(o.cap) ? fmt.num(o.cap, 0) : "no limit", Number.isFinite(o.cap) ? fmt.x(o.cap / e) : "n/a", o.math, o.name === binding.name ? "Yes" : ""]),
            emphasisRow: options.findIndex((o) => o.name === binding.name) },
          { type: "bar", title: "Capacity by constraint (USD mm)", format: "money", data: options.map((o) => ({ label: o.name.split(" ")[0] + " " + (o.name.split(" ")[1] ?? ""), value: Number.isFinite(o.cap) ? o.cap : null, emphasis: o.name === binding.name })) },
          { type: "sensitivity", title: "Interest coverage: leverage × all-in rate", rowLabel: "Leverage", colLabel: "All-in rate", rows: levs.map((L) => fmt.x(L)), cols: rates.map((r) => fmt.pct(r, 2)), values: grid, format: "x", baseRow: levs.indexOf(maxLev), baseCol: 2 },
        ],
        caveats: [
          "2026 market structures: middle-market total leverage of 4.0-5.0x and 5.0-6.0x for upper-middle-market quality credits, dividend recaps averaging 5.04x with 22% at 6x or more, unitranche all-in 9.0-11.0% against 7.5-9.5% for broadly syndicated loans, and direct-lending covenants set with a 25-35% cushion.",
          "The all-in rate accretes OID over a four-year average life, which is the loan-market convention; a floating-rate structure should also be stressed for a SOFR move, since coverage is the constraint that usually binds first.",
          "Capacity is not the same as what the documents permit: the existing credit agreement's incremental basket, ratio debt test and MFN protection may cap the incremental facility well below this number.",
        ],
        nextSteps: ["Build the tranching and pricing in the term sheet grid", "Run the LBO to see what the capacity does to returns", "Check the agency-adjusted leverage the rating agencies will publish"],
      };
    },
  },
  {
    kind: "calc", id: "dcm-bond-math", title: "Bond math: yield, duration & make-whole", tagline: "Yield to maturity and worst, duration, DV01, convexity and the make-whole redemption price.",
    description: "Solves a bond's yield from price, computes Macaulay and modified duration, DV01 and convexity, the yield to a call, and the make-whole redemption price as the present value of remaining cash flows discounted at the reference Treasury plus the make-whole spread, floored at par.",
    roles: ["banker", "markets", "corpfin", "student"], category: "Capital markets", icon: "Percent", savesMinutes: 45, tags: ["bond math", "duration", "make-whole", "YTW"],
    fields: [
      { key: "coupon", label: "Coupon", type: "number", unit: "%", required: true, default: 5.45 },
      { key: "years", label: "Years to maturity", type: "number", unit: "years", required: true, default: 7 },
      { key: "price", label: "Price", type: "number", unit: "per 100", required: true, default: 99.841 },
      { key: "freq", label: "Coupon frequency", type: "select", options: ["Semi-annual", "Annual", "Quarterly"], default: "Semi-annual" },
      { key: "callYears", label: "Years to first call (0 if none)", type: "number", unit: "years", default: 0 },
      { key: "callPrice", label: "Call price", type: "number", unit: "per 100", default: 100 },
      { key: "tsy", label: "Reference Treasury yield", type: "number", unit: "%", default: 4.1 },
      { key: "mwSpread", label: "Make-whole spread", type: "number", unit: "bps", default: 15 },
    ],
    example: { coupon: 5.45, years: 7, price: 99.841, freq: "Semi-annual", callYears: 3, callPrice: 102.725, tsy: 4.1, mwSpread: 15 },
    compute: (i: Inputs): WorkflowOutput => {
      const c = num(i, "coupon") / 100, yrs = num(i, "years"), P = num(i, "price");
      const m = str(i, "freq", "Semi-annual") === "Annual" ? 1 : str(i, "freq") === "Quarterly" ? 4 : 2;
      if (yrs <= 0 || P <= 0) throw new Error("Years to maturity and price must be positive.");
      const n = Math.max(1, Math.round(yrs * m)), cpn = (c * 100) / m;
      const cfs = Array.from({ length: n }, (_, k) => (k === n - 1 ? cpn + 100 : cpn));
      const pv = (y: number, flows: number[]) => flows.reduce((a, cf, k) => a + cf / Math.pow(1 + y / m, k + 1), 0);
      const ytm = solve((y) => pv(y, cfs) - P, 0.0001, 2);
      const per = ytm / m;
      let mac = 0, conv = 0;
      cfs.forEach((cf, k) => { const t = (k + 1) / m, d = cf / Math.pow(1 + per, k + 1); mac += t * d; conv += ((k + 1) * (k + 2) / (m * m)) * (cf / Math.pow(1 + per, k + 3)); });
      mac /= P; conv /= P;
      const mod = mac / (1 + per), dv01 = P * mod * 0.0001;
      const callY = num(i, "callYears"), callP = num(i, "callPrice", 100);
      let ytc: number | null = null;
      if (callY > 0 && callY < yrs) {
        const nc = Math.max(1, Math.round(callY * m));
        const cflow = Array.from({ length: nc }, (_, k) => (k === nc - 1 ? cpn + callP : cpn));
        ytc = solve((y) => pv(y, cflow) - P, 0.0001, 2);
      }
      const ytw = ytc === null ? ytm : Math.min(ytm, ytc);
      const mwRate = num(i, "tsy") / 100 + num(i, "mwSpread") / 10000;
      const mwPv = pv(mwRate, cfs), mwPrice = Math.max(100, mwPv);
      const shifts = [-0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02];
      const rows = shifts.map((s) => {
        const exact = pv(ytm + s, cfs);
        const est = P * (1 - mod * s + 0.5 * conv * s * s);
        return [fmt.bps(s), fmt.num(exact, 3), fmt.num(est, 3), fmt.num(exact - est, 3)];
      });
      return {
        title: "Bond math",
        summary: `At ${fmt.num(P, 3)} the ${fmt.pct(c, 3)} ${yrs}-year bond yields ${fmt.pct(ytm, 3)} to maturity${ytc === null ? "" : ` and ${fmt.pct(ytc, 3)} to the ${callY}-year call, so yield to worst is ${fmt.pct(ytw, 3)}`}. Modified duration is ${mod.toFixed(2)} years, DV01 is ${fmt.moneyRaw(dv01 * 10000, 0)} per $1mm of face, and convexity is ${conv.toFixed(1)}. A make-whole call at the reference Treasury plus ${num(i, "mwSpread")}bps redeems at ${fmt.num(mwPrice, 3)}, ${mwPrice > P ? `${fmt.num(mwPrice - P, 3)} points above` : `${fmt.num(P - mwPrice, 3)} points below`} the market price.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Yield to maturity", value: fmt.pct(ytm, 3) }, { label: "Yield to worst", value: fmt.pct(ytw, 3) },
            { label: "Modified duration", value: `${mod.toFixed(2)} yrs` }, { label: "Macaulay duration", value: `${mac.toFixed(2)} yrs` },
            { label: "DV01 per $1mm", value: fmt.moneyRaw(dv01 * 10000, 0) }, { label: "Convexity", value: conv.toFixed(1) },
            { label: "Make-whole price", value: fmt.num(mwPrice, 3), tone: mwPrice > P ? "warn" : "pos" },
          ] },
          { type: "table", title: "Price sensitivity to yield", columns: ["Yield shift", "Exact price", "Duration + convexity estimate", "Error"], rows, emphasisRow: 3,
            note: `dP/P = −modified duration × dy + ½ × convexity × dy². The estimate diverges beyond ±100bps, which is why the exact repricing column is the one to quote.` },
          { type: "line", title: "Price / yield", format: "num", series: [{ name: "Price", points: shifts.map((s) => ({ x: fmt.pct(ytm + s, 2), y: pv(ytm + s, cfs) })) }] },
          { type: "table", title: "Redemption alternatives", columns: ["Option", "Price", "Cost versus market", "Note"], rows: [
            ["Market repurchase", fmt.num(P, 3), "0.000", "Open-market purchases are subject to MNPI and blackout restrictions"],
            ["Make-whole call", fmt.num(mwPrice, 3), fmt.num(mwPrice - P, 3), `PV at Treasury ${fmt.pct(num(i, "tsy") / 100, 2)} + ${num(i, "mwSpread")}bps, floored at par; investment grade convention is T+5 to T+15, high yield T+30 to T+50`],
            ...(callY > 0 ? [["First call", fmt.num(callP, 3), fmt.num(callP - P, 3), `Callable in ${callY} years at ${fmt.num(callP, 3)}`]] : []),
          ] },
        ],
        caveats: [
          "Clean price and yield on a whole-period basis: there is no accrued interest or day-count adjustment, so a bond between coupon dates will differ slightly from a Bloomberg YAS screen.",
          "Yield to worst here is the lesser of yield to maturity and yield to the single call date entered. A full high-yield call schedule (non-call 2-4 years, then par plus half the coupon stepping to par, with a 35-40% equity clawback) needs each call date tested.",
          "Option-adjusted spread requires a lattice or Monte Carlo model and a volatility assumption; for a bullet bond the Z-spread equals the OAS.",
        ],
      };
    },
  },
  {
    kind: "calc", id: "dcm-refi-npv", title: "Refinancing NPV", tagline: "Present value of the savings against the premium and fees, with the break-even.",
    description: "Tests whether refinancing pays: present value of interest savings over the remaining life of the old debt, less the call or tender premium and fees funded into the new issue, with annual cash savings, the break-even year and the NPV as a percentage of refunded par against the 3% threshold used in refunding practice.",
    roles: ["banker", "corpfin", "pe"], category: "Capital markets", icon: "RefreshCw", savesMinutes: 60, tags: ["refinancing", "NPV", "tender", "make-whole"],
    fields: [
      { key: "principal", label: "Principal refinanced", type: "number", unit: "$mm", required: true, default: 1000 },
      { key: "oldCoupon", label: "Existing coupon", type: "number", unit: "%", required: true, default: 6 },
      { key: "years", label: "Remaining years to maturity", type: "number", unit: "years", required: true, default: 6 },
      { key: "newCoupon", label: "New coupon", type: "number", unit: "%", required: true, default: 4.625 },
      { key: "premium", label: "Call / tender premium", type: "number", unit: "points", default: 2 },
      { key: "fees", label: "Fees and expenses", type: "number", unit: "% of principal", default: 0.6 },
      { key: "discount", label: "Discount rate (new all-in yield)", type: "number", unit: "%", default: 4.9 },
      { key: "fund", label: "Fund the premium and fees with new debt", type: "toggle", default: true },
    ],
    example: { principal: 1000, oldCoupon: 6, years: 6, newCoupon: 4.625, premium: 2, fees: 0.6, discount: 4.9, fund: true },
    compute: (i: Inputs): WorkflowOutput => {
      const P = num(i, "principal"), oc = num(i, "oldCoupon") / 100, nc = num(i, "newCoupon") / 100;
      const yrs = Math.max(1, Math.round(num(i, "years"))), r = num(i, "discount") / 100;
      if (P <= 0) throw new Error("Principal must be positive.");
      const upfront = P * (num(i, "premium") / 100 + num(i, "fees") / 100);
      const funded = bool(i, "fund", true);
      const newPrincipal = funded ? P + upfront : P;
      const rows: { y: number; oldInt: number; newInt: number; saving: number; df: number; pv: number }[] = [];
      let pvSavings = 0;
      for (let y = 1; y <= yrs; y++) {
        const oldInt = P * oc, newInt = newPrincipal * nc, saving = oldInt - newInt;
        const df = 1 / Math.pow(1 + r, y);
        pvSavings += saving * df;
        rows.push({ y, oldInt, newInt, saving, df, pv: saving * df });
      }
      const extraPrincipalPv = funded ? upfront / Math.pow(1 + r, yrs) : 0;
      const npv = pvSavings - extraPrincipalPv - (funded ? 0 : upfront);
      const annual = rows[0].saving;
      const breakeven = annual > 0 ? upfront / annual : Infinity;
      return {
        title: "Refinancing NPV",
        summary: `Refinancing ${fmt.money(P)} of ${fmt.pct(oc, 3)} debt with ${fmt.pct(nc, 3)} paper saves ${fmt.money(annual)} of cash interest a year and has an NPV of ${fmt.money(npv)}, ${fmt.pct(npv / P, 2)} of refunded par. The ${fmt.money(upfront)} of premium and fees is recovered in ${Number.isFinite(breakeven) ? `${breakeven.toFixed(1)} years` : "no period at these coupons"}, against ${yrs} years of remaining life. ${npv / P >= 0.03 ? "This clears the 3% of refunded par threshold used in refunding practice." : "This falls short of the 3% of refunded par threshold, so the case rests on maturity extension or covenant relief rather than economics."}`,
        blocks: [
          { type: "kpis", items: [
            { label: "NPV of refinancing", value: fmt.money(npv), tone: npv > 0 ? "pos" : "neg" },
            { label: "NPV % of refunded par", value: fmt.pct(npv / P, 2), tone: npv / P >= 0.03 ? "pos" : "warn" },
            { label: "Annual cash savings", value: fmt.money(annual) }, { label: "Coupon saving", value: fmt.bps(oc - nc) },
            { label: "Upfront cost", value: fmt.money(upfront) }, { label: "Break-even", value: Number.isFinite(breakeven) ? `${breakeven.toFixed(1)} yrs` : "n/a" },
          ] },
          { type: "table", title: "Cash flows (USD mm)", columns: ["Year", "Old interest", "New interest", "Saving", "Discount factor", "PV of saving"],
            rows: rows.map((x) => [`Y${x.y}`, fmt.num(x.oldInt, 1), fmt.num(x.newInt, 1), fmt.num(x.saving, 1), x.df.toFixed(3), fmt.num(x.pv, 1)]),
            totals: ["PV of savings", "", "", "", "", fmt.num(pvSavings, 1)],
            note: funded ? `Premium and fees of ${fmt.money(upfront)} are funded into the new issue, so the new principal is ${fmt.money(newPrincipal)} and the extra principal is repaid at maturity (PV ${fmt.money(extraPrincipalPv)}).` : `Premium and fees of ${fmt.money(upfront)} are paid in cash at closing.` },
          { type: "waterfall", title: "NPV build (USD mm)", format: "money", steps: [
            { label: "PV of interest savings", value: pvSavings, total: true },
            { label: funded ? "PV of extra principal" : "Premium and fees", value: -(extraPrincipalPv + (funded ? 0 : upfront)) },
            { label: "Net present value", value: npv, total: true },
          ] },
          { type: "bar", title: "Annual cash savings (USD mm)", format: "money", data: rows.map((x) => ({ label: `Y${x.y}`, value: x.saving })) },
        ],
        caveats: [
          "Compare the execution routes before committing: a make-whole call redeems at the present value of remaining cash flows at the reference Treasury plus 5-15bps for investment grade (30-50bps for high yield), which is usually the most expensive route; a fixed-spread cash tender prices at a spread to the reference Treasury and typically costs 2-5 points over market for callable investment grade and 5-15 for high yield, with an early tender premium of roughly $30 per $1,000 inside about ten business days; open-market repurchases are cheapest but are limited by MNPI restrictions and available float.",
          "A tender offer needs a 20-business-day minimum offer period under Rule 14e-1 (five business days for an any-and-all investment-grade non-convertible offer without consents), plus ten business days after any material change - which is why timing, not NPV, often decides the structure.",
          "The discount rate should be the new all-in yield. Savings are pre-tax; after-tax savings scale by one minus the marginal rate where the interest is deductible, subject to section 163(j).",
        ],
      };
    },
  },
];

const ECM_CALCS: ToolDef[] = [
  {
    kind: "calc", id: "ecm-followon-pricing", title: "Follow-on & block pricing", tagline: "Expected discount from size versus ADTV, deal type, seller and volatility.",
    description: "Estimates the discount to last close a follow-on or block should price at, using the drivers the syndicate desk actually adjusts for: deal size against average daily volume and market capitalization, deal type (marketed, confidentially marketed, overnight bought deal or block), whether the seller is the issuer or a sponsor, and recent volatility, then converts it to proceeds and dilution.",
    roles: ["banker", "corpfin", "vc"], category: "Capital markets", icon: "BadgeDollarSign", savesMinutes: 60, tags: ["follow-on", "block", "discount", "ECM"],
    fields: [
      { key: "close", label: "Last close", type: "number", unit: "$", required: true, default: 13.16 },
      { key: "shares", label: "Shares offered", type: "number", unit: "mm", required: true, default: 15 },
      { key: "sharesOut", label: "Shares outstanding", type: "number", unit: "mm", required: true, default: 190 },
      { key: "adtv", label: "Average daily volume", type: "number", unit: "shares mm", required: true, default: 2.5 },
      { key: "type", label: "Deal type", type: "select", options: ["Marketed follow-on", "Confidentially marketed (CMPO)", "Overnight bought deal", "Block trade"], default: "Overnight bought deal" },
      { key: "seller", label: "Seller", type: "select", options: ["Issuer (primary)", "Sponsor / insider (secondary)", "Mixed"], default: "Sponsor / insider (secondary)" },
      { key: "vol", label: "30-day volatility", type: "number", unit: "%", default: 35 },
      { key: "spread", label: "Gross spread", type: "number", unit: "%", default: 2.13 },
    ],
    example: { close: 13.16, shares: 15, sharesOut: 190, adtv: 2.5, type: "Overnight bought deal", seller: "Sponsor / insider (secondary)", vol: 35, spread: 2.13 },
    prefill: (c) => ({ close: c.price?.last ?? 20, sharesOut: c.balance.sharesOut ?? 100 }),
    compute: (i: Inputs): WorkflowOutput => {
      const close = num(i, "close"), sh = num(i, "shares"), so = num(i, "sharesOut"), adtv = num(i, "adtv");
      if (close <= 0 || sh <= 0 || so <= 0 || adtv <= 0) throw new Error("Price, shares offered, shares outstanding and average daily volume must all be positive.");
      const type = str(i, "type", "Overnight bought deal"), seller = str(i, "seller", "Issuer (primary)");
      const bases: Record<string, { mid: number; lo: number; hi: number }> = {
        "Marketed follow-on": { mid: 5.5, lo: 3, hi: 8 },
        "Confidentially marketed (CMPO)": { mid: 6.5, lo: 4, hi: 9 },
        "Overnight bought deal": { mid: 9, lo: 6, hi: 12 },
        "Block trade": { mid: 8, lo: 6, hi: 10 },
      };
      const b = bases[type] ?? bases["Marketed follow-on"];
      const dealSize = sh * close, mktCap = so * close, pctCap = dealSize / mktCap, days = sh / adtv;
      const adj = Math.min(5, Math.max(0, days - 5) * 0.3) + Math.max(0, num(i, "vol") - 30) * 0.08 + (seller.startsWith("Sponsor") ? 0.75 : seller === "Mixed" ? 0.4 : 0) + (pctCap > 0.1 ? 0.5 : 0);
      const mid = (b.mid + adj) / 100, lo = Math.max(0.005, (b.lo + adj) / 100), hi = (b.hi + adj) / 100;
      const spread = num(i, "spread") / 100;
      const scen = [{ n: "Tight", d: lo }, { n: "Base", d: mid }, { n: "Wide", d: hi }].map((s) => {
        const price = close * (1 - s.d), gross = price * sh;
        return { ...s, price, gross, fees: gross * spread, net: gross * (1 - spread) };
      });
      const discs = [lo, (lo + mid) / 2, mid, (mid + hi) / 2, hi];
      const sizes = [sh * 0.5, sh * 0.75, sh, sh * 1.25, sh * 1.5];
      const grid = discs.map((d) => sizes.map((s) => close * (1 - d) * s * (1 - spread)));
      return {
        title: "Follow-on / block pricing",
        summary: `A ${fmt.num(sh, 1)}mm share ${type.toLowerCase()} is ${fmt.money(dealSize)}, ${fmt.pct(pctCap, 1)} of market capitalization and ${days.toFixed(1)} days of average volume. The expected discount to last close is ${fmt.pct(mid, 1)} (range ${fmt.pct(lo, 1)} to ${fmt.pct(hi, 1)}), an offer price of ${fmt.moneyRaw(close * (1 - mid), 2)} and net proceeds of ${fmt.money(scen[1].net)} after a ${fmt.pct(spread, 2)} gross spread.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Expected discount", value: fmt.pct(mid, 1) }, { label: "Offer price", value: fmt.moneyRaw(close * (1 - mid), 2) },
            { label: "Deal size", value: fmt.money(dealSize) }, { label: "% of market cap", value: fmt.pct(pctCap, 1), tone: pctCap > 0.1 ? "warn" : "neutral" },
            { label: "Days of ADTV", value: `${days.toFixed(1)}x`, tone: days > 10 ? "warn" : "neutral" },
            { label: "Net proceeds (base)", value: fmt.money(scen[1].net) },
            { label: "Dilution if primary", value: fmt.pct(sh / (so + sh), 1) },
          ] },
          { type: "table", title: "Pricing scenarios", columns: ["Scenario", "Discount to last close", "Offer price", "Gross proceeds ($mm)", "Underwriting ($mm)", "Net proceeds ($mm)"],
            rows: scen.map((s) => [s.n, fmt.pct(s.d, 1), fmt.moneyRaw(s.price, 2), fmt.num(s.gross, 1), fmt.num(s.fees, 1), fmt.num(s.net, 1)]), emphasisRow: 1 },
          { type: "bar", title: "Precedent discount ranges by deal type", format: "pct", reference: { value: mid, label: `This deal ${fmt.pct(mid, 1)}` },
            data: Object.entries(bases).map(([k, v]) => ({ label: k, value: v.mid / 100, emphasis: k === type })) },
          { type: "sensitivity", title: "Net proceeds ($mm): discount × shares offered", rowLabel: "Discount", colLabel: "Shares (mm)", rows: discs.map((d) => fmt.pct(d, 1)), cols: sizes.map((s) => fmt.num(s, 1)), values: grid, format: "money", baseRow: 2, baseCol: 2 },
        ],
        caveats: [
          "Benchmarks from 2025-26 precedents: marketed follow-ons price at a 3-8% discount over a 5-10 day book, overnight bought deals at 6-12%, and blocks bid over a few hours at 6-10%. Aveanna Healthcare's August 2026 sponsor secondary priced 15.0mm shares at $11.75 against a $13.16 last sale, a 10.7% discount with a 2.13% spread and a 30-day lock-up.",
          "The model is a precedent-based heuristic, not a regression on live order books: the actual discount depends on the book, anchor demand, the borrow and the sector tape on the night. A bought deal transfers the risk to the underwriter, so its bid embeds a re-offer cushion.",
          "Secondary sales by a sponsor carry overhang: disclose the remaining stake and the lock-up, and note where the sale ends controlled-company status. A concurrent issuer buyback reduces the effective supply and tightens the discount.",
        ],
      };
    },
  },
  {
    kind: "calc", id: "ecm-convert-pricing", title: "Convertible pricing", tagline: "Bond floor plus option value, delta, and the coupon-premium indifference grid.",
    description: "Values a convertible as a straight bond at the issuer's credit spread plus a call option on the stock: conversion price, parity, bond floor, theoretical value, delta, and the cost of a capped call that raises the effective conversion premium. The coupon-versus-premium grid is the trade-off the issuer actually negotiates.",
    roles: ["banker", "markets", "corpfin"], category: "Capital markets", icon: "ArrowLeftRight", savesMinutes: 90, tags: ["convertible", "capped call", "delta"],
    fields: [
      { key: "stock", label: "Stock price", type: "number", unit: "$", required: true, default: 50 },
      { key: "size", label: "Issue size", type: "number", unit: "$mm", required: true, default: 750 },
      { key: "coupon", label: "Coupon", type: "number", unit: "%", default: 1.5 },
      { key: "premium", label: "Conversion premium", type: "number", unit: "%", default: 32.5 },
      { key: "maturity", label: "Maturity", type: "number", unit: "years", default: 5 },
      { key: "creditSpread", label: "Credit spread", type: "number", unit: "%", default: 4.5 },
      { key: "rf", label: "Risk-free rate", type: "number", unit: "%", default: 4 },
      { key: "vol", label: "Implied volatility", type: "number", unit: "%", default: 40 },
      { key: "div", label: "Dividend yield", type: "number", unit: "%", default: 0 },
      { key: "capPremium", label: "Capped call / warrant strike premium", type: "number", unit: "%", default: 100 },
    ],
    example: { stock: 50, size: 750, coupon: 1.5, premium: 32.5, maturity: 5, creditSpread: 4.5, rf: 4, vol: 40, div: 0, capPremium: 100 },
    prefill: (c) => ({ stock: c.price?.last ?? 50 }),
    compute: (i: Inputs): WorkflowOutput => {
      const s = num(i, "stock"), size = num(i, "size"), cpn = num(i, "coupon") / 100;
      const prem = num(i, "premium") / 100, T = num(i, "maturity"), cs = num(i, "creditSpread") / 100;
      const rf = num(i, "rf") / 100, vol = num(i, "vol") / 100, q = num(i, "div") / 100, capP = num(i, "capPremium") / 100;
      if (s <= 0 || T <= 0 || size <= 0) throw new Error("Stock price, maturity and issue size must be positive.");
      if (vol <= 0) throw new Error("Implied volatility must be positive.");
      const convPrice = s * (1 + prem), ratio = 1000 / convPrice, parity = ratio * s;
      const y = rf + cs, n = Math.max(1, Math.round(T * 2));
      const floor = Array.from({ length: n }, (_, k) => (cpn * 1000) / 2 / Math.pow(1 + y / 2, k + 1)).reduce((a, b) => a + b, 0) + 1000 / Math.pow(1 + y / 2, n);
      const value = (px: number) => floor + ratio * bsCall(px, convPrice, T, vol, rf, q);
      const v = value(s), h = s * 0.01;
      const delta = ((value(s + h) - value(s - h)) / (2 * h)) * s / 1000;
      const capStrike = s * (1 + capP);
      const capCost = ratio * (bsCall(s, convPrice, T, vol, rf, q) - bsCall(s, capStrike, T, vol, rf, q));
      const coupons = [cpn - 0.01, cpn - 0.005, cpn, cpn + 0.005, cpn + 0.01].filter((c) => c >= 0);
      const prems = [prem - 0.1, prem - 0.05, prem, prem + 0.05, prem + 0.1];
      const grid = coupons.map((c) => prems.map((p) => {
        const cp = s * (1 + p), r2 = 1000 / cp;
        const fl = Array.from({ length: n }, (_, k) => (c * 1000) / 2 / Math.pow(1 + y / 2, k + 1)).reduce((a, b) => a + b, 0) + 1000 / Math.pow(1 + y / 2, n);
        return (fl + r2 * bsCall(s, cp, T, vol, rf, q)) / 10;
      }));
      return {
        title: "Convertible pricing",
        summary: `A ${fmt.pct(cpn, 3)} coupon at a ${fmt.pct(prem, 1)} premium converts at ${fmt.moneyRaw(convPrice, 2)} on a ${ratio.toFixed(4)} share ratio per $1,000. The bond floor is ${fmt.num(floor / 10, 2)} and the embedded option is worth ${fmt.num((v - floor) / 10, 2)}, a theoretical value of ${fmt.num(v / 10, 2)} per 100 - ${v >= 1000 ? "cheap to the issuer at par, so the terms can be tightened" : "rich at par, so the coupon or the premium has to move"}. Delta is ${fmt.pct(delta, 0)}, and a capped call struck at a ${fmt.pct(capP, 0)} premium costs ${fmt.pct(capCost / 1000, 2)} of principal, or ${fmt.money((capCost / 1000) * size)}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Conversion price", value: fmt.moneyRaw(convPrice, 2) }, { label: "Conversion ratio per $1,000", value: ratio.toFixed(4) },
            { label: "Parity", value: fmt.num(parity / 10, 2) }, { label: "Bond floor", value: fmt.num(floor / 10, 2) },
            { label: "Theoretical value", value: fmt.num(v / 10, 2), tone: v >= 1000 ? "pos" : "warn" },
            { label: "Delta", value: fmt.pct(delta, 0) }, { label: "Capped call cost", value: fmt.money((capCost / 1000) * size) },
          ] },
          { type: "waterfall", title: "Value decomposition (per 100)", format: "num", steps: [
            { label: "Bond floor at credit spread", value: floor / 10, total: true },
            { label: "Embedded call option", value: (v - floor) / 10 },
            { label: "Theoretical value", value: v / 10, total: true },
          ] },
          { type: "table", title: "Terms", columns: ["Term", "Value", "Note"], rows: [
            ["Issue size", fmt.money(size), "Shares underlying: " + fmt.num((size * 1000 * ratio) / 1000 / 1000, 2) + "mm"],
            ["Coupon / maturity", `${fmt.pct(cpn, 3)} / ${T} years`, "2026 market: 5-7 year maturities at low single-digit coupons with 25-40% premiums"],
            ["Conversion premium", fmt.pct(prem, 1), `Conversion price ${fmt.moneyRaw(convPrice, 2)}`],
            ["Credit spread / risk free", `${fmt.pct(cs, 2)} / ${fmt.pct(rf, 2)}`, "The bond floor is only as good as the credit"],
            ["Implied volatility", fmt.pct(vol, 0), "Hedge funds buy vol and short delta shares; borrow cost lowers the option value"],
            ["Capped call", `${fmt.pct(capP, 0)} strike, ${fmt.pct(capCost / 1000, 2)} of principal`, "About 57% of recent deals add a call spread, lifting the effective premium to 75-100%+"],
          ] },
          { type: "sensitivity", title: "Theoretical value per 100: coupon × conversion premium", rowLabel: "Coupon", colLabel: "Premium", rows: coupons.map((c) => fmt.pct(c, 2)), cols: prems.map((p) => fmt.pct(p, 0)), values: grid, format: "num", baseRow: 2, baseCol: 2 },
        ],
        caveats: [
          "A Black-Scholes European call ignores the issuer's soft and hard calls, holder put dates and any dividend protection: a lattice or Monte Carlo model is needed for those, and it will lower the option value where the issuer can force conversion.",
          "Theoretical value at or above 100 means the terms are cheap to investors at par, so the issuer can cut the coupon or raise the premium until the value sits near par on the buyer's assumptions. Hedge-fund buyers price on their own vol and borrow assumptions, which is why the pricing call is a market judgment.",
          "A capped call (bond hedge plus warrant) raises the effective conversion price for the issuer at a cash cost taken against equity; net-share settlement and the ASU 2020-06 if-converted method drive the EPS treatment.",
          "Practitioner convention is a 2-2.75% gross spread on converts, which is not included in the value above.",
        ],
      };
    },
  },
  {
    kind: "calc", id: "ecm-spac-economics", title: "SPAC economics & dilution", tagline: "Cash delivered per share after redemptions, promote, deferred fees and the PIPE.",
    description: "Runs the de-SPAC math across redemption scenarios: trust cash surviving redemptions plus the PIPE, less deferred underwriting and transaction costs, divided by the shares that survive including founder shares, to give the net cash per share a target actually receives and the effective dilution from the promote and the warrants.",
    roles: ["banker", "markets", "vc"], category: "Capital markets", icon: "Rocket", savesMinutes: 75, tags: ["SPAC", "de-SPAC", "redemptions", "promote"],
    fields: [
      { key: "trust", label: "Trust at IPO", type: "number", unit: "$mm", required: true, default: 75 },
      { key: "perUnit", label: "Trust per unit", type: "number", unit: "$", default: 10.025 },
      { key: "publicShares", label: "Public shares", type: "number", unit: "mm", required: true, default: 7.5 },
      { key: "founderShares", label: "Founder (promote) shares", type: "number", unit: "mm", default: 2.875 },
      { key: "sponsorAtRisk", label: "Sponsor at-risk capital", type: "number", unit: "$mm", default: 2.06 },
      { key: "upfrontPct", label: "Upfront underwriting", type: "number", unit: "% of trust", default: 1.1 },
      { key: "deferredPct", label: "Deferred underwriting", type: "number", unit: "% of trust", default: 3.5 },
      { key: "pipe", label: "PIPE", type: "number", unit: "$mm", default: 50 },
      { key: "pipePrice", label: "PIPE price per share", type: "number", unit: "$", default: 10 },
      { key: "txnCosts", label: "Other transaction costs", type: "number", unit: "$mm", default: 12 },
      { key: "warrants", label: "Public and private warrants", type: "number", unit: "mm", default: 3.75 },
      { key: "warrantStrike", label: "Warrant strike", type: "number", unit: "$", default: 11.5 },
      { key: "redemptions", label: "Redemption scenarios", type: "text", default: "20 50 80 95", help: "Percent of public shares redeemed" },
    ],
    example: { trust: 75, perUnit: 10.025, publicShares: 7.5, founderShares: 2.875, sponsorAtRisk: 2.06, upfrontPct: 1.1, deferredPct: 3.5, pipe: 50, pipePrice: 10, txnCosts: 12, warrants: 3.75, warrantStrike: 11.5, redemptions: "20 50 80 95" },
    compute: (i: Inputs): WorkflowOutput => {
      const trust = num(i, "trust"), perUnit = num(i, "perUnit", 10), pub = num(i, "publicShares");
      const founder = num(i, "founderShares"), pipe = num(i, "pipe"), pipePx = num(i, "pipePrice", 10);
      const deferred = trust * (num(i, "deferredPct") / 100), costs = num(i, "txnCosts");
      const upfront = trust * (num(i, "upfrontPct") / 100), atRisk = num(i, "sponsorAtRisk");
      const promoteValue = founder * perUnit, promoteMultiple = atRisk > 0 ? promoteValue / atRisk : Infinity;
      const reds = nums(i, "redemptions").map((r) => r / 100);
      if (trust <= 0 || pub <= 0) throw new Error("Trust size and public shares must be positive.");
      if (!reds.length) throw new Error("Enter at least one redemption scenario, for example 20 50 80 95.");
      const pipeShares = pipePx > 0 ? pipe / pipePx : 0;
      const rows = reds.map((r) => {
        const remaining = pub * (1 - r), trustCash = remaining * perUnit;
        const cash = trustCash + pipe - deferred - costs;
        const shares = remaining + founder + pipeShares;
        const perShare = shares > 0 ? cash / shares : 0;
        const promoteDilution = shares > 0 ? founder / shares : 0;
        const supplied = trustCash + pipe;
        return { r, remaining, trustCash, cash, shares, perShare, promoteDilution, delivered: supplied > 0 ? cash / supplied : 0 };
      });
      const mid = rows[Math.min(rows.length - 1, Math.floor(rows.length / 2))];
      return {
        title: "SPAC economics",
        summary: `On a ${fmt.money(trust)} trust at ${fmt.moneyRaw(perUnit, 3)} per unit with ${fmt.num(founder, 3)}mm founder shares (${fmt.pct(founder / (pub + founder), 1)} of the post-IPO share count), a ${fmt.pct(mid.r, 0)} redemption leaves ${fmt.money(mid.trustCash)} of trust cash. With a ${fmt.money(pipe)} PIPE, ${fmt.money(deferred)} of deferred underwriting and ${fmt.money(costs)} of other costs, the target receives ${fmt.money(mid.cash)} against ${fmt.num(mid.shares, 1)}mm shares, or ${fmt.moneyRaw(mid.perShare, 2)} of net cash per share against the $10.00 nominal price. The promote alone dilutes ${fmt.pct(mid.promoteDilution, 1)}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Deferred underwriting", value: fmt.money(deferred) }, { label: "PIPE shares", value: `${fmt.num(pipeShares, 1)}mm` },
            { label: `Cash delivered at ${fmt.pct(mid.r, 0)} redemption`, value: fmt.money(mid.cash) },
            { label: "Net cash per share", value: fmt.moneyRaw(mid.perShare, 2), tone: mid.perShare < 8 ? "neg" : mid.perShare < 9.5 ? "warn" : "pos" },
            { label: "Promote dilution", value: fmt.pct(mid.promoteDilution, 1) },
            { label: "Share of money supplied delivered", value: fmt.pct(mid.delivered, 0), tone: mid.delivered < 0.6 ? "neg" : "warn" },
            { label: "Promote value / at-risk capital", value: Number.isFinite(promoteMultiple) ? `${promoteMultiple.toFixed(1)}x` : "n/a", hint: `${fmt.money(promoteValue)} of founder shares at ${fmt.moneyRaw(perUnit, 2)} against ${fmt.money(atRisk)} of sponsor capital` },
          ] },
          { type: "table", title: "Redemption scenarios", columns: ["Redemption", "Public shares remaining (mm)", "Trust cash ($mm)", "Cash delivered ($mm)", "Total shares (mm)", "Net cash per share", "Promote dilution", "% of supplied cash delivered"],
            rows: rows.map((r) => [fmt.pct(r.r, 0), fmt.num(r.remaining, 2), fmt.num(r.trustCash, 1), fmt.num(r.cash, 1), fmt.num(r.shares, 2), fmt.moneyRaw(r.perShare, 2), fmt.pct(r.promoteDilution, 1), fmt.pct(r.delivered, 0)]) },
          { type: "bar", title: "Net cash per share by redemption scenario", format: "num", reference: { value: 10, label: "$10.00 nominal" }, data: rows.map((r) => ({ label: fmt.pct(r.r, 0), value: r.perShare })) },
          { type: "callout", tone: "warn", title: "Where the money goes", text: `Underwriting is paid ${fmt.money(upfront)} upfront (${fmt.pct(num(i, "upfrontPct") / 100, 2)} of trust, funded by the sponsor's ${fmt.money(atRisk)} of at-risk capital alongside working capital) and ${fmt.money(deferred)} deferred at closing. Classic SPAC economics were a 20% promote with 2% upfront and 3.5% deferred underwriting; post-2022 structures moved to 10-15% performance-linked promotes with less warrant coverage, and redemption rates of 80-98% mean the committed PIPE now does the real underwriting. Stanford research (Klausner) found some targets receive only about half of all the money investors supplied once the promote, fees and warrants are counted - the "% of supplied cash delivered" column above is that measure. Warrants add ${fmt.num(num(i, "warrants"), 2)}mm shares of overhang at a ${fmt.moneyRaw(num(i, "warrantStrike"), 2)} strike. Nasdaq raised listing thresholds effective 15 May 2026 (Global Market from $75mm to $100mm market value of listed securities; Capital Market SPACs $75mm MVLS with a $20mm unrestricted public float, 400 round-lot holders and four market makers), and the 80% trust-value test limits how small a target can be.` },
        ],
        caveats: [
          "Net cash per share divides cash delivered by all surviving shares (public, founder and PIPE) and excludes the target's rollover equity, so it measures SPAC-side dilution rather than the post-close capitalization.",
          "Founder shares are typically 25% of the public float (20% of the post-IPO total) bought for $25,000; where the promote is forfeited, earned out or transferred to the PIPE, rerun with the reduced count.",
          "Warrants are shown as overhang rather than valued: they dilute only above the strike, and a warrant redemption or exchange offer changes the count. Trust interest earned before closing is excluded.",
        ],
      };
    },
  },
];

export const BANKER_PACK: ToolDef[] = [...MA_WORKFLOWS, ...RX_WORKFLOWS, ...CM_WORKFLOWS, ...MA_CALCS, ...RX_CALCS, ...CM_CALCS, ...ECM_CALCS];
