/**
 * Shared tools every role gets. This file is also the reference implementation for role packs:
 * one AI workflow per deliverable with a precise method, and pure calculators that return the same block shapes.
 */
import { fmt, num, str, list, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* ======================================================================================
 * AI workflows
 * ====================================================================================== */

const companyOnePager: ToolDef = {
  kind: "ai", id: "company-one-pager", title: "Company one-pager", tagline: "A pitch-ready profile of any US-listed company, every number cited.",
  description: "Builds the standard one-page profile bankers, consultants, and investors put at the front of a deck: business description, key financials and margins, capitalization, recent events from 8-Ks, and the three things worth knowing. Sources are SEC XBRL, the latest 10-K/10-Q text, and recent filings.",
  roles: "all", category: "Deliverables", icon: "FileText", deliverable: "memo", savesMinutes: 90, tags: ["profile", "pitch", "tearsheet"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "SNOW" },
    { key: "audience", label: "Audience", type: "select", options: ["Pitch book", "Investment committee", "Client meeting", "Internal briefing"], default: "Pitch book" },
    { key: "focus", label: "Emphasis (optional)", type: "text", placeholder: "e.g. AI monetization, margin trajectory, capital allocation" },
  ],
  example: { ticker: "SNOW", audience: "Pitch book", focus: "consumption model and margin trajectory" },
  effort: "medium",
  instructions: `1. Call get_company_financials for the ticker. 2. Call search_filing on the latest 10-K for "overview" / "our business" and on the latest 10-Q for "outlook" or "guidance" and key metrics (customers, net retention, ARR, backlog/RPO as relevant). 3. Call get_recent_filings with forms ["8-K"] and note material items (1.01, 2.01, 2.02, 5.02, 8.01). 4. Compute margins, growth, net debt, EV, and multiples with calc.
Produce: kpis (market cap, EV, LTM revenue and growth, gross margin, FCF margin, EV/LTM revenue, net cash/debt); markdown "Business" (4-6 sentences, what they sell, to whom, how they charge); table "Financial snapshot" (LTM revenue, gross profit, operating income, EBITDA, FCF with margins, plus the last 4-8 quarters of revenue); bullets "Recent developments" from 8-Ks and the 10-Q with dates; bullets "Three things to know" written for the audience; risks (top 3 from risk factors, severity). Tailor tone to the audience field and the emphasis field.`,
  prompt: (i) => `Build a ${str(i, "audience", "pitch book")} one-pager for ${str(i, "ticker").toUpperCase()}.${str(i, "focus") ? ` Emphasize: ${str(i, "focus")}.` : ""}`,
};

const filingTeardown: ToolDef = {
  kind: "ai", id: "filing-teardown", title: "10-K / 10-Q teardown", tagline: "What changed, what management said, and what the footnotes hide.",
  description: "Reads the latest annual or quarterly report and produces the analyst's teardown: results versus the prior period, guidance and outlook language, segment and KPI disclosures, balance sheet and liquidity changes, notable footnotes (debt, leases, contingencies, related parties), and a short list of questions for management.",
  roles: "all", category: "Research", icon: "Search", deliverable: "analysis", savesMinutes: 120, tags: ["10-K", "10-Q", "earnings"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true },
    { key: "form", label: "Filing", type: "select", options: ["10-Q", "10-K"], default: "10-Q" },
    { key: "lens", label: "Lens", type: "select", options: ["Investor", "Banker", "Auditor", "Lender", "Competitor"], default: "Investor" },
  ],
  example: { ticker: "DDOG", form: "10-Q", lens: "Investor" },
  effort: "medium",
  instructions: `1. get_company_financials for context. 2. search_filing on the chosen form for: "results of operations", "outlook", "guidance", "liquidity and capital resources", "remaining performance obligations" or "backlog", "net revenue retention" or "customers", "segment", "debt", "leases", "commitments and contingencies", "subsequent events", "critical accounting". Use read_filing to expand the most important hits (at least 4 reads). 3. get_xbrl_series for 6 quarters of Revenues (or the revenue concept used), OperatingIncomeLoss, NetCashProvidedByUsedInOperatingActivities, and any debt concept found, to quantify trends.
Produce: kpis (revenue, growth, operating margin, FCF, cash, debt, and one KPI specific to the company); markdown "What changed" (period vs prior with numbers); bullets "Management's words" (short quotes with citations); table "Footnote watch" (topic, what it says, why it matters); columns chart of quarterly revenue; risks (3-5); qa "Questions for management" (5). Apply the lens: an auditor cares about estimates and controls, a lender about liquidity and covenants, a banker about strategic optionality, a competitor about product and pricing.`,
  prompt: (i) => `Tear down ${str(i, "ticker").toUpperCase()}'s latest ${str(i, "form", "10-Q")} through a ${str(i, "lens", "investor").toLowerCase()} lens.`,
};

const peerBenchmark: ToolDef = {
  kind: "ai", id: "peer-benchmark", title: "Peer benchmarking", tagline: "Growth, margins, cash conversion, and leverage versus a peer set, with the gaps explained.",
  description: "Builds a benchmarking table for a company against peers from live SEC data, ranks each metric, and explains the largest gaps using filing text. If no peers are given, the model proposes a set and says why.",
  roles: "all", category: "Valuation", icon: "BarChart3", deliverable: "table", savesMinutes: 120, tags: ["comps", "benchmark", "margins"],
  fields: [
    { key: "ticker", label: "Subject", type: "ticker", required: true },
    { key: "peers", label: "Peers (optional)", type: "tickers", placeholder: "DDOG MDB NET", help: "Leave empty to have the model propose peers" },
    { key: "metrics", label: "Emphasis", type: "multiselect", options: ["Growth", "Gross margin", "Operating margin", "FCF conversion", "Rule of 40", "Leverage", "Valuation multiples", "SBC intensity"], default: ["Growth", "Gross margin", "FCF conversion", "Valuation multiples"] },
  ],
  example: { ticker: "MDB", peers: ["SNOW", "DDOG", "NET", "GTLB"], metrics: ["Growth", "Gross margin", "FCF conversion", "Valuation multiples"] },
  effort: "medium",
  instructions: `1. If peers are empty, choose 5-7 US-listed peers by business model, scale, and buyer universe and state the logic. 2. Call get_trading_comps with the subject and peers. 3. For the two largest gaps versus the peer median, use search_filing on the subject's 10-K/10-Q to find the explanation (pricing model, mix, investment phase, one-time items). 4. Use calc for medians, quartiles, and gap sizes.
Produce: kpis (subject vs peer median on the emphasized metrics with delta and tone); table "Benchmark" with subject first (emphasisRow 0), peers, and a median row in totals; bar chart of the primary emphasized metric with the subject emphasized; scatter of growth vs EV/LTM revenue; markdown "Why the gaps" with citations; caveats on comparability (fiscal year ends, adjusted vs reported).`,
  prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()} against ${list(i, "peers").length ? list(i, "peers").join(", ") : "a peer set you propose"} on ${list(i, "metrics").join(", ") || "growth, margins, cash conversion, and valuation"}.`,
};

const precedentTransactions: ToolDef = {
  kind: "ai", id: "precedent-transactions", title: "Precedent transactions from EDGAR", tagline: "Real deals from merger proxies and 8-Ks: EV, multiples, premiums, and terms.",
  description: "Finds comparable acquisitions with EDGAR full-text search (DEFM14A merger proxies, S-4s, and 8-K merger announcements), reads the deal terms, and assembles a precedent transactions table with implied multiples where the target's financials are available in XBRL, plus premiums, consideration mix, and termination fees.",
  roles: ["banker", "pe", "corpfin", "consultant", "markets", "student"], category: "Valuation", icon: "Handshake", deliverable: "table", savesMinutes: 240, tags: ["M&A", "precedents", "premiums"],
  fields: [
    { key: "description", label: "Target profile", type: "text", required: true, placeholder: "e.g. US-listed vertical SaaS, $200M-$2B revenue" },
    { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "software, cybersecurity" },
    { key: "from", label: "From", type: "date", default: "2023-01-01" },
    { key: "count", label: "Deals to find", type: "number", default: 8, min: 3, max: 15 },
  ],
  example: { description: "US-listed infrastructure software targets acquired by strategics or sponsors", sector: "software cloud data", from: "2023-01-01", count: 8 },
  effort: "high",
  instructions: `1. Run edgar_fulltext_search with phrases like "agreement and plan of merger" plus sector keywords, forms ["DEFM14A","8-K","S-4","SC TO-T"], from the start date; run 2-3 query variants to gather candidates; de-duplicate by target. 2. For each candidate, read_document with queries "per share", "merger consideration", "premium", "termination fee", "enterprise value" to extract: announce date, acquirer, target, consideration per share and mix, implied equity value, premium to unaffected price, termination fee, financing/go-shop terms. 3. Where the target was an SEC registrant, call get_company_financials or get_xbrl_series for LTM revenue and EBITDA near the announcement to compute EV/Revenue and EV/EBITDA with calc; otherwise mark NM and say why. 4. Compute median and mean multiples and premiums.
Produce: kpis (deal count, median EV/Revenue, median EV/EBITDA, median premium); table "Precedent transactions" with columns Announced, Target, Acquirer, EV ($mm), EV/LTM Rev, EV/LTM EBITDA, Premium, Consideration, Termination fee, Source; bar chart of EV/Revenue by deal; bullets "Deal terms worth noting"; caveats on which figures were computed vs disclosed.`,
  prompt: (i) => `Find ${num(i, "count", 8)} precedent transactions since ${str(i, "from", "2023-01-01")} for: ${str(i, "description")}. Sector keywords: ${str(i, "sector")}.`,
};

const researchBrief: ToolDef = {
  kind: "ai", id: "research-brief", title: "Research brief", tagline: "A sourced answer to any market, company, or deal question.",
  description: "Combines web research, SEC filings, Form D, and the startup directory to answer an open question with a structured brief: the answer, the evidence with links, disagreements between sources, and what is still unknown.",
  roles: "all", category: "Research", icon: "Globe", deliverable: "research", savesMinutes: 60, tags: ["research", "web", "memo"],
  fields: [
    { key: "question", label: "Question", type: "textarea", required: true, placeholder: "e.g. How are AI coding assistants priced, and what are the public comps?" },
    { key: "depth", label: "Depth", type: "select", options: ["Quick (5 sources)", "Standard (10 sources)", "Deep (20 sources)"], default: "Standard (10 sources)" },
  ],
  example: { question: "What is the state of the take-private market for mid-cap software in 2026: volumes, multiples, and which sponsors are most active?", depth: "Standard (10 sources)" },
  effort: "medium",
  instructions: `Use web search for current facts, edgar_fulltext_search and read_document when SEC filings can settle a point, search_startups and form_d_search for private companies. Triangulate any figure with at least two sources and note disagreements. Do not pad.
Produce: callout with the one-paragraph answer; markdown "Evidence" organized by sub-question with citations; table "Sources" (source, what it supports, date); bullets "Open questions"; nextSteps.`,
  prompt: (i) => `${str(i, "question")}\n\nDepth: ${str(i, "depth", "Standard (10 sources)")}.`,
};

/* ======================================================================================
 * Calculators (pure TypeScript)
 * ====================================================================================== */

/** Discounted cash flow with mid-year convention, Gordon growth and exit-multiple terminal values, and a WACC x g sensitivity. */
const dcf: ToolDef = {
  kind: "calc", id: "dcf", title: "DCF valuation", tagline: "Unlevered free cash flow, two terminal methods, and a WACC × growth sensitivity.",
  description: "Projects revenue and margins over the horizon, builds unlevered free cash flow (EBIT less taxes plus D&A less capex less change in working capital), discounts with a mid-year convention, and derives enterprise and equity value under both perpetuity growth and exit multiple methods, with sensitivities. Prefills from live SEC data when opened on a ticker.",
  roles: "all", category: "Valuation", icon: "Calculator", savesMinutes: 180, tags: ["DCF", "valuation", "WACC"],
  fields: [
    { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", required: true, default: 1000 },
    { key: "growth", label: "Revenue growth, year 1", type: "number", unit: "%", default: 20, help: "Fades linearly to the terminal growth rate" },
    { key: "ebitdaMargin", label: "EBITDA margin, year 1", type: "number", unit: "%", default: 20 },
    { key: "targetMargin", label: "EBITDA margin, final year", type: "number", unit: "%", default: 30 },
    { key: "daPct", label: "D&A", type: "number", unit: "% of revenue", default: 4 },
    { key: "capexPct", label: "Capex", type: "number", unit: "% of revenue", default: 5 },
    { key: "nwcPct", label: "Change in NWC", type: "number", unit: "% of incremental revenue", default: 10 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "years", label: "Projection years", type: "number", default: 5, min: 3, max: 10 },
    { key: "wacc", label: "WACC", type: "number", unit: "%", default: 10 },
    { key: "terminalGrowth", label: "Terminal growth", type: "number", unit: "%", default: 3 },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", default: 15 },
    { key: "netDebt", label: "Net debt (negative = net cash)", type: "number", unit: "$mm", default: 0 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", default: 100 },
  ],
  example: { revenue: 5435, growth: 25, ebitdaMargin: 12, targetMargin: 32, daPct: 4, capexPct: 3, nwcPct: 5, taxRate: 21, years: 5, wacc: 9.5, terminalGrowth: 3.5, exitMultiple: 22, netDebt: -3900, shares: 335 },
  prefill: (c) => ({
    revenue: c.ltm.revenue ?? 1000,
    growth: c.ltm.revenue && c.ltm.priorRevenue ? Math.round((c.ltm.revenue / c.ltm.priorRevenue - 1) * 100) : 15,
    ebitdaMargin: c.ltm.revenue && c.ltm.adjEbitda !== null ? Math.max(5, Math.round((c.ltm.adjEbitda / c.ltm.revenue) * 100)) : 20,
    targetMargin: c.ltm.revenue && c.ltm.adjEbitda !== null ? Math.max(15, Math.round((c.ltm.adjEbitda / c.ltm.revenue) * 100) + 8) : 30,
    daPct: c.ltm.revenue && c.ltm.da !== null ? Math.round((c.ltm.da / c.ltm.revenue) * 100) : 4,
    capexPct: c.ltm.revenue && c.ltm.capex !== null ? Math.round((c.ltm.capex / c.ltm.revenue) * 100) : 5,
    netDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0),
    shares: c.balance.sharesOut ?? 100,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const years = Math.round(num(i, "years", 5));
    const rev0 = num(i, "revenue"), g1 = num(i, "growth") / 100, gT = num(i, "terminalGrowth") / 100;
    const m1 = num(i, "ebitdaMargin") / 100, mT = num(i, "targetMargin") / 100;
    const da = num(i, "daPct") / 100, capex = num(i, "capexPct") / 100, nwc = num(i, "nwcPct") / 100, tax = num(i, "taxRate") / 100;
    const wacc = num(i, "wacc") / 100, exitX = num(i, "exitMultiple"), netDebt = num(i, "netDebt"), shares = num(i, "shares", 1);
    if (rev0 <= 0 || shares <= 0) throw new Error("Revenue and shares must be positive.");
    if (wacc <= gT) throw new Error("WACC must exceed terminal growth for a perpetuity value.");
    const rows: { year: number; revenue: number; growth: number; ebitda: number; margin: number; ebit: number; nopat: number; fcf: number; df: number; pv: number }[] = [];
    let rev = rev0;
    for (let y = 1; y <= years; y++) {
      const t = years === 1 ? 1 : (y - 1) / (years - 1);
      const g = g1 + (gT - g1) * t;
      const m = m1 + (mT - m1) * t;
      const prev = rev; rev = prev * (1 + g);
      const ebitda = rev * m, dA = rev * da, ebit = ebitda - dA, nopat = ebit * (1 - Math.max(tax, 0));
      const fcf = nopat + dA - rev * capex - (rev - prev) * nwc;
      const df = 1 / Math.pow(1 + wacc, y - 0.5);
      rows.push({ year: y, revenue: rev, growth: g, ebitda, margin: m, ebit, nopat, fcf, df, pv: fcf * df });
    }
    const last = rows[rows.length - 1];
    const sumPv = rows.reduce((a, r) => a + r.pv, 0);
    const tvGordon = (last.fcf * (1 + gT)) / (wacc - gT);
    const tvExit = last.ebitda * exitX;
    const dfEnd = 1 / Math.pow(1 + wacc, years);
    const evG = sumPv + tvGordon * dfEnd, evX = sumPv + tvExit * dfEnd;
    const eqG = evG - netDebt, eqX = evX - netDebt;
    const impliedExit = tvGordon / last.ebitda, impliedG = (tvExit * wacc - last.fcf) / (tvExit + last.fcf);
    const waccs = [wacc - 0.02, wacc - 0.01, wacc, wacc + 0.01, wacc + 0.02];
    const gs = [gT - 0.01, gT - 0.005, gT, gT + 0.005, gT + 0.01];
    const sens = waccs.map((w) => gs.map((g) => (w <= g ? null : (rows.reduce((a, r) => a + r.fcf / Math.pow(1 + w, r.year - 0.5), 0) + ((last.fcf * (1 + g)) / (w - g)) / Math.pow(1 + w, years) - netDebt) / shares)));
    return {
      title: "DCF valuation",
      summary: `Perpetuity-growth method implies an enterprise value of ${fmt.money(evG)} and ${fmt.moneyRaw(eqG / shares, 2)} per share; the exit-multiple method implies ${fmt.money(evX)} and ${fmt.moneyRaw(eqX / shares, 2)} per share. Terminal value is ${fmt.pct((tvGordon * dfEnd) / evG, 0)} of the perpetuity EV, so the answer is mostly about the terminal assumptions.`,
      blocks: [
        { type: "kpis", items: [
          { label: "EV (perpetuity)", value: fmt.money(evG) }, { label: "EV (exit multiple)", value: fmt.money(evX) },
          { label: "Equity / share (perpetuity)", value: fmt.moneyRaw(eqG / shares, 2) }, { label: "Equity / share (exit)", value: fmt.moneyRaw(eqX / shares, 2) },
          { label: "Implied exit multiple", value: fmt.x(impliedExit), hint: "Exit EV/EBITDA implied by the perpetuity method" }, { label: "Implied perpetuity growth", value: fmt.pct(impliedG), hint: "Growth implied by the exit multiple method" },
        ] },
        { type: "table", title: "Projection (USD mm)", columns: ["Year", "Revenue", "Growth", "EBITDA", "Margin", "EBIT", "NOPAT", "Unlevered FCF", "Discount factor", "PV of FCF"],
          rows: rows.map((r) => [`Y${r.year}`, fmt.num(r.revenue, 0), fmt.pct(r.growth), fmt.num(r.ebitda, 0), fmt.pct(r.margin, 0), fmt.num(r.ebit, 0), fmt.num(r.nopat, 0), fmt.num(r.fcf, 0), r.df.toFixed(3), fmt.num(r.pv, 0)]),
          totals: ["Sum of PV", "", "", "", "", "", "", "", "", fmt.num(sumPv, 0)] },
        { type: "waterfall", title: "EV bridge, perpetuity method (USD mm)", format: "money", steps: [{ label: "PV of FCF", value: sumPv }, { label: "PV of terminal value", value: tvGordon * dfEnd }, { label: "Enterprise value", value: evG, total: true }, { label: "Less net debt", value: -netDebt }, { label: "Equity value", value: eqG, total: true }] },
        { type: "sensitivity", title: "Equity value per share: WACC × terminal growth", rowLabel: "WACC", colLabel: "Terminal growth", rows: waccs.map((w) => fmt.pct(w)), cols: gs.map((g) => fmt.pct(g)), values: sens, format: "num", baseRow: 2, baseCol: 2 },
        { type: "columns", title: "Unlevered free cash flow (USD mm)", format: "money", data: rows.map((r) => ({ label: `Y${r.year}`, value: r.fcf })) },
      ],
      caveats: ["Mid-year discounting convention. Margins and growth fade linearly. Taxes applied to EBIT (no NOL benefit). Net debt should include preferred and minority interest and exclude operating leases unless EBITDA is post-rent."],
      nextSteps: ["Replace fade assumptions with a bottom-up driver forecast", "Cross-check the implied exit multiple against trading comps", "Run the WACC calculator to justify the discount rate"],
    };
  },
};

/** Weighted average cost of capital via CAPM plus size and specific premiums. */
const wacc: ToolDef = {
  kind: "calc", id: "wacc", title: "WACC", tagline: "Cost of equity via CAPM, after-tax cost of debt, and the weighted rate with a beta × ERP grid.",
  description: "Computes the weighted average cost of capital from the risk-free rate, levered beta, equity risk premium, size and company-specific premiums, pre-tax cost of debt, tax rate, and the capital structure. Shows unlevering and relevering of beta for a target structure.",
  roles: "all", category: "Valuation", icon: "Percent", savesMinutes: 30, tags: ["WACC", "CAPM", "beta"],
  fields: [
    { key: "rf", label: "Risk-free rate", type: "number", unit: "%", default: 4.2 },
    { key: "beta", label: "Levered beta (observed)", type: "number", default: 1.2 },
    { key: "erp", label: "Equity risk premium", type: "number", unit: "%", default: 5.5 },
    { key: "size", label: "Size premium", type: "number", unit: "%", default: 0 },
    { key: "specific", label: "Company-specific premium", type: "number", unit: "%", default: 0 },
    { key: "kd", label: "Pre-tax cost of debt", type: "number", unit: "%", default: 6.5 },
    { key: "tax", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "debtWeight", label: "Debt / total capital", type: "number", unit: "%", default: 20 },
    { key: "peerDebtWeight", label: "Observed peer debt / capital (for unlevering)", type: "number", unit: "%", default: 20 },
  ],
  example: { rf: 4.2, beta: 1.15, erp: 5.5, size: 0.5, specific: 0, kd: 6.0, tax: 21, debtWeight: 15, peerDebtWeight: 25 },
  compute: (i: Inputs): WorkflowOutput => {
    const rf = num(i, "rf") / 100, beta = num(i, "beta"), erp = num(i, "erp") / 100, size = num(i, "size") / 100, spec = num(i, "specific") / 100;
    const kd = num(i, "kd") / 100, tax = num(i, "tax") / 100, wd = num(i, "debtWeight") / 100, wdPeer = num(i, "peerDebtWeight") / 100;
    const de = wd / (1 - wd), dePeer = wdPeer / (1 - wdPeer);
    const unlevered = beta / (1 + (1 - tax) * dePeer);
    const relevered = unlevered * (1 + (1 - tax) * de);
    const ke = rf + relevered * erp + size + spec;
    const kdAfter = kd * (1 - tax);
    const w = (1 - wd) * ke + wd * kdAfter;
    const betas = [relevered - 0.2, relevered - 0.1, relevered, relevered + 0.1, relevered + 0.2];
    const erps = [erp - 0.01, erp - 0.005, erp, erp + 0.005, erp + 0.01];
    const grid = betas.map((b) => erps.map((e) => (1 - wd) * (rf + b * e + size + spec) + wd * kdAfter));
    return {
      title: "Weighted average cost of capital",
      summary: `WACC is ${fmt.pct(w, 2)}: cost of equity ${fmt.pct(ke, 2)} on a relevered beta of ${relevered.toFixed(2)} (unlevered ${unlevered.toFixed(2)}), after-tax cost of debt ${fmt.pct(kdAfter, 2)}, weighted ${fmt.pct(1 - wd, 0)} equity and ${fmt.pct(wd, 0)} debt.`,
      blocks: [
        { type: "kpis", items: [{ label: "WACC", value: fmt.pct(w, 2) }, { label: "Cost of equity", value: fmt.pct(ke, 2) }, { label: "After-tax cost of debt", value: fmt.pct(kdAfter, 2) }, { label: "Unlevered beta", value: unlevered.toFixed(2) }, { label: "Relevered beta", value: relevered.toFixed(2) }] },
        { type: "table", title: "Build", columns: ["Component", "Value", "Note"], rows: [["Risk-free rate", fmt.pct(rf, 2), "10-year Treasury"], ["Unlevered beta", unlevered.toFixed(2), `Observed ${beta.toFixed(2)} at ${fmt.pct(wdPeer, 0)} debt/capital`], ["Relevered beta", relevered.toFixed(2), `At ${fmt.pct(wd, 0)} debt/capital`], ["Equity risk premium", fmt.pct(erp, 2), ""], ["Size premium", fmt.pct(size, 2), ""], ["Specific premium", fmt.pct(spec, 2), ""], ["Cost of equity", fmt.pct(ke, 2), "CAPM + premiums"], ["Pre-tax cost of debt", fmt.pct(kd, 2), ""], ["Tax rate", fmt.pct(tax, 0), ""], ["After-tax cost of debt", fmt.pct(kdAfter, 2), ""], ["Debt weight", fmt.pct(wd, 0), ""], ["WACC", fmt.pct(w, 2), ""]], emphasisRow: 11 },
        { type: "sensitivity", title: "WACC: relevered beta × equity risk premium", rowLabel: "Beta", colLabel: "ERP", rows: betas.map((b) => b.toFixed(2)), cols: erps.map((e) => fmt.pct(e, 1)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["Hamada unlevering assumes debt beta of zero and a constant capital structure.", "Size and specific premiums are judgment inputs; document the source (Kroll or Duff & Phelps) in the footnote."],
    };
  },
};

/** NPV, IRR, payback for a cash-flow schedule. */
const npvIrr: ToolDef = {
  kind: "calc", id: "npv-irr", title: "NPV, IRR & payback", tagline: "Capital budgeting on any cash-flow schedule with a discount-rate sensitivity.",
  description: "Takes an initial outlay and a series of cash flows, computes net present value at the hurdle rate, internal rate of return, simple and discounted payback, and the profitability index.",
  roles: "all", category: "Modeling", icon: "TrendingUp", savesMinutes: 20, tags: ["NPV", "IRR", "capital budgeting"],
  fields: [
    { key: "outlay", label: "Initial investment", type: "number", unit: "$mm", required: true, default: 100 },
    { key: "flows", label: "Cash flows by year", type: "text", required: true, default: "20 30 40 45 50", help: "Space or comma separated, one value per year" },
    { key: "rate", label: "Hurdle rate", type: "number", unit: "%", default: 10 },
  ],
  example: { outlay: 250, flows: "40 60 80 90 95 100", rate: 9 },
  compute: (i: Inputs): WorkflowOutput => {
    const outlay = num(i, "outlay"), rate = num(i, "rate") / 100;
    const flows = list(i, "flows").map(Number).filter((x) => Number.isFinite(x));
    if (!flows.length) throw new Error("Enter at least one cash flow.");
    const npvAt = (r: number) => -outlay + flows.reduce((a, cf, k) => a + cf / Math.pow(1 + r, k + 1), 0);
    const npv = npvAt(rate);
    let lo = -0.99, hi = 5; for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (npvAt(mid) > 0) lo = mid; else hi = mid; }
    const irr = (lo + hi) / 2;
    let cum = -outlay, payback: number | null = null, dcum = -outlay, dpayback: number | null = null;
    flows.forEach((cf, k) => { const prev = cum; cum += cf; if (payback === null && cum >= 0) payback = k + (cf ? -prev / cf : 0); const d = cf / Math.pow(1 + rate, k + 1); const dprev = dcum; dcum += d; if (dpayback === null && dcum >= 0) dpayback = k + (d ? -dprev / d : 0); });
    const pi = (npv + outlay) / outlay;
    const rates = [rate - 0.04, rate - 0.02, rate, rate + 0.02, rate + 0.04];
    return {
      title: "NPV and IRR",
      summary: `At a ${fmt.pct(rate, 1)} hurdle the project's NPV is ${fmt.money(npv)} (${npv >= 0 ? "accept" : "reject"}), the IRR is ${fmt.pct(irr, 1)}, and simple payback is ${payback === null ? "beyond the horizon" : `${(payback as number).toFixed(1)} years`}.`,
      blocks: [
        { type: "kpis", items: [{ label: "NPV", value: fmt.money(npv), tone: npv >= 0 ? "pos" : "neg" }, { label: "IRR", value: fmt.pct(irr, 1), tone: irr >= rate ? "pos" : "neg" }, { label: "Profitability index", value: pi.toFixed(2) }, { label: "Payback", value: payback === null ? "n/a" : `${(payback as number).toFixed(1)} yrs` }, { label: "Discounted payback", value: dpayback === null ? "n/a" : `${(dpayback as number).toFixed(1)} yrs` }] },
        { type: "table", title: "Cash flows (USD mm)", columns: ["Year", "Cash flow", "Discount factor", "PV", "Cumulative PV"], rows: (() => { let c = -outlay; return [["0", fmt.num(-outlay, 1), "1.000", fmt.num(-outlay, 1), fmt.num(-outlay, 1)], ...flows.map((cf, k) => { const df = 1 / Math.pow(1 + rate, k + 1); c += cf * df; return [String(k + 1), fmt.num(cf, 1), df.toFixed(3), fmt.num(cf * df, 1), fmt.num(c, 1)]; })]; })() },
        { type: "bar", title: "NPV by discount rate (USD mm)", format: "money", data: rates.map((r) => ({ label: fmt.pct(r, 0), value: npvAt(r), emphasis: r === rate })) },
      ],
    };
  },
};

export const CORE_PACK: ToolDef[] = [companyOnePager, filingTeardown, peerBenchmark, precedentTransactions, researchBrief, dcf, wacc, npvIrr];
