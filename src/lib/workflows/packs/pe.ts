/**
 * Private equity tool pack: buyouts, growth equity, private credit, secondaries, infrastructure, and
 * fund/LP work. AI workflows encode the sponsor's method (CIM triage, take-private precedents, QoE,
 * IC, 100-day, VCP, exits, LP reporting); calculators implement LBO, debt, waterfall and fund math.
 */
import { bool, fmt, list, num, parseCsv, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* ======================================================================================
 * Shared math helpers
 * ====================================================================================== */

/** IRR of an annual cash-flow vector (t = 0..n) by bisection. Null when there is no sign change. */
function irr(input: number[], lo = -0.9999, hi = 10): number | null {
  const flows = input.slice();
  while (flows.length > 1 && flows[flows.length - 1] === 0) flows.pop();
  const npv = (r: number) => flows.reduce((a, cf, t) => a + cf / Math.pow(1 + r, t), 0);
  let flo = npv(lo);
  const fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2, v = npv(mid);
    if (flo * v <= 0) hi = mid; else { lo = mid; flo = v; }
  }
  return (lo + hi) / 2;
}

/** Solve f(x) = target on [lo, hi] by bisection; f must be monotonic on the interval. */
function solve(f: (x: number) => number, target: number, lo: number, hi: number): number | null {
  let flo = f(lo) - target;
  const fhi = f(hi) - target;
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let k = 0; k < 140; k++) {
    const mid = (lo + hi) / 2, v = f(mid) - target;
    if (flo * v <= 0) hi = mid; else { lo = mid; flo = v; }
  }
  return (lo + hi) / 2;
}

/**
 * Carry catch-up tranche. Distributes `avail` of profit so the carry holder ends holding `carry` of
 * cumulative profit distributions: during the catch-up tier it takes `catchUp` of each dollar until
 * its shortfall to carry x cumulative profit is cleared, then the residual splits carry / (1 - carry).
 */
function catchUpSplit(avail: number, lpProfit: number, gpProfit: number, carry: number, catchUp: number): { gp: number; lp: number } {
  const k = carry / (1 - carry);
  const denom = catchUp - k * (1 - catchUp);
  let gp = 0, lp = 0, rem = Math.max(0, avail);
  if (denom > 0) {
    const shortfall = Math.max(0, k * lpProfit - gpProfit); const x = Math.min(rem, shortfall / denom); gp += catchUp * x; lp += (1 - catchUp) * x; rem -= x;
  }
  gp += carry * rem; lp += (1 - carry) * rem;
  return { gp, lp };
}

/** Find a CSV column by normalized name, exact match first then substring. */
function colIdx(header: string[], ...names: string[]): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const h = header.map(norm);
  for (const n of names) { const i = h.indexOf(norm(n)); if (i >= 0) return i; }
  for (const n of names) { const i = h.findIndex((x) => x.includes(norm(n))); if (i >= 0) return i; }
  return -1;
}

/** Parse a CSV cell as a number, treating (123) as negative and stripping $ , % symbols. */
function cellNum(row: string[], i: number): number {
  if (i < 0 || i >= row.length) return 0;
  const raw = String(row[i] ?? "").trim();
  const v = Number(raw.replace(/[$,%\s()]/g, ""));
  if (!Number.isFinite(v)) return 0;
  return /^\(.*\)$/.test(raw) ? -v : v;
}

/* ======================================================================================
 * LBO engine, shared by the returns, ability-to-pay and recap calculators
 * ====================================================================================== */

type LboIn = {
  ebitda: number; entryX: number; exitX: number; years: number; growth: number;
  daPct: number; capexPct: number; nwcPct: number; tax: number;
  senTurns: number; senRate: number; senAmort: number;
  subTurns: number; subRate: number; subPik: boolean;
  sweep: number; minCash: number; txFeePct: number; finFeePct: number; mgmtPool: number;
};
type LboYear = { year: number; ebitda: number; cashInt: number; pikInt: number; taxes: number; capex: number; dNwc: number; fcf: number; amort: number; swept: number; sen: number; sub: number; cash: number; netDebt: number; lev: number };
type LboOut = {
  entryEv: number; debt0: number; sen0: number; sub0: number; fees: number; equity: number; rows: LboYear[];
  exitEbitda: number; exitEv: number; exitNetDebt: number; exitEquity: number; proceeds: number;
  moic: number; irrPct: number | null; entryLev: number; exitLev: number;
  attribution: { label: string; value: number }[];
};

/** Full LBO: sources and uses, debt schedule with mandatory amortization and a cash sweep, exit and attribution. */
function runLbo(p: LboIn): LboOut {
  const entryEv = p.ebitda * p.entryX;
  const sen0 = p.ebitda * p.senTurns, sub0 = p.ebitda * p.subTurns, debt0 = sen0 + sub0;
  const fees = entryEv * p.txFeePct + debt0 * p.finFeePct;
  const equity = entryEv + fees + p.minCash - debt0;
  let sen = sen0, sub = sub0, cash = p.minCash, prevE = p.ebitda;
  const rows: LboYear[] = [];
  for (let y = 1; y <= p.years; y++) {
    const ebitda = p.ebitda * Math.pow(1 + p.growth, y); const da = ebitda * p.daPct, ebit = ebitda - da; const cashInt = sen * p.senRate + (p.subPik ? 0 : sub * p.subRate);
    const pikInt = p.subPik ? sub * p.subRate : 0; const taxes = Math.max(0, ebit - cashInt - pikInt) * p.tax; const capex = ebitda * p.capexPct, dNwc = (ebitda - prevE) * p.nwcPct;
    const fcf = ebitda - cashInt - taxes - capex - dNwc; const amort = Math.min(sen, sen0 * p.senAmort); const avail = Math.max(0, fcf - amort) * p.sweep; const sweptSen = Math.min(sen - amort, avail);
    const sweptSub = p.subPik ? 0 : Math.min(sub, avail - sweptSen); sen = sen - amort - sweptSen; sub = sub + pikInt - sweptSub; cash = cash + fcf - amort - sweptSen - sweptSub; const netDebt = sen + sub - cash;
    rows.push({ year: y, ebitda, cashInt, pikInt, taxes, capex, dNwc, fcf, amort, swept: sweptSen + sweptSub, sen, sub, cash, netDebt, lev: netDebt / ebitda }); prevE = ebitda;
  }
  const last = rows[rows.length - 1];
  const exitEbitda = last.ebitda, exitEv = exitEbitda * p.exitX, exitNetDebt = last.netDebt;
  const exitEquity = exitEv - exitNetDebt;
  const proceeds = exitEquity * (1 - p.mgmtPool);
  const flows = [-equity, ...rows.map((_, k) => (k === rows.length - 1 ? proceeds : 0))];
  const entryNetDebt = debt0 - p.minCash;
  return {
    entryEv, debt0, sen0, sub0, fees, equity, rows, exitEbitda, exitEv, exitNetDebt, exitEquity, proceeds,
    moic: equity > 0 ? proceeds / equity : NaN, irrPct: irr(flows),
    entryLev: entryNetDebt / p.ebitda, exitLev: last.lev,
    attribution: [
      { label: "Sponsor equity at entry", value: equity }, { label: "EBITDA growth", value: (exitEbitda - p.ebitda) * p.entryX }, { label: "Multiple change", value: (p.exitX - p.entryX) * exitEbitda },
      { label: "Debt paydown", value: entryNetDebt - exitNetDebt }, { label: "Fees", value: -fees }, { label: "Management pool", value: -exitEquity * p.mgmtPool }, { label: "Sponsor proceeds", value: proceeds },
    ],
  };
}

const lboFrom = (i: Inputs, over: Partial<LboIn> = {}): LboIn => ({
  ebitda: num(i, "ebitda", 100), entryX: num(i, "entryMultiple", 11), exitX: num(i, "exitMultiple", 11),
  years: Math.max(1, Math.round(num(i, "years", 5))), growth: num(i, "ebitdaGrowth", 8) / 100,
  daPct: num(i, "daPct", 25) / 100, capexPct: num(i, "capexPct", 20) / 100, nwcPct: num(i, "nwcPct", 15) / 100,
  tax: num(i, "taxRate", 25) / 100, senTurns: num(i, "senTurns", 4), senRate: num(i, "senRate", 8.5) / 100,
  senAmort: num(i, "senAmort", 1) / 100, subTurns: num(i, "subTurns", 1), subRate: num(i, "subRate", 11.5) / 100,
  subPik: bool(i, "subPik", false), sweep: num(i, "sweep", 75) / 100, minCash: num(i, "minCash", 20),
  txFeePct: num(i, "txFeePct", 2) / 100, finFeePct: num(i, "finFeePct", 2.5) / 100, mgmtPool: num(i, "mgmtPool", 8) / 100,
  ...over,
});

/* ======================================================================================
 * AI workflows
 * ====================================================================================== */

const cimFirstRead: ToolDef = {
  kind: "ai", id: "pe-cim-first-read", title: "CIM first-read memo", tagline: "Paste the CIM pages; get the screening memo, the red flags, and a first-pass LBO frame.",
  description: "Turns pasted CIM or teaser excerpts into the one-page screening memo an associate writes after a first read: business and revenue model, the financial summary as presented, the add-backs the banker is asking you to accept, customer and end-market concentration, the questions that decide whether to bid, and a first-pass entry frame anchored to public comps. Every claim is tagged as CIM-asserted or independently verified against SEC data.",
  roles: ["pe"], specialties: ["Middle-market buyout", "Large-cap buyout", "Growth equity"],
  category: "Diligence", icon: "FileSearch", deliverable: "memo", savesMinutes: 180, tags: ["CIM", "screening", "triage"], effort: "high",
  fields: [
    { key: "cim", label: "CIM excerpts", type: "textarea", required: true, placeholder: "Paste the executive summary, financial summary, adjusted EBITDA bridge, customer concentration and growth-initiative pages", help: "Paste as much as you have: financial summary and add-back tables matter most" },
    { key: "company", label: "Target name (as in the CIM)", type: "text", required: true, placeholder: "e.g. Project Atlas / Meridian Mechanical Services" },
    { key: "ticker", label: "Public comp (optional)", type: "ticker", placeholder: "FIX", help: "A listed company in the same business; used for comps and disclosure benchmarks" },
    { key: "thesis", label: "Our angle (optional)", type: "text", placeholder: "e.g. buy-and-build in Southeast mechanical services, 4-6 add-ons" },
  ],
  example: {
    company: "Project Atlas (Meridian Mechanical Services)",
    ticker: "FIX",
    thesis: "Buy-and-build platform in Southeast commercial HVAC service, 4-6 add-ons over the hold",
    cim: `EXECUTIVE SUMMARY
Meridian Mechanical Services ("Meridian" or the "Company") is a leading provider of commercial HVAC installation, retrofit and recurring maintenance services across Georgia, Tennessee and the Carolinas. Founded in 1998 and owner-operated, Meridian serves healthcare, data center, education and light industrial end markets through 6 branches and 410 field technicians.
FINANCIAL SUMMARY (USD 000s)
FY2023A revenue 168,400; FY2024A revenue 196,100; FY2025A revenue 231,900; LTM Jun-2026 revenue 248,700
LTM Jun-2026 gross profit 61,300 (24.6%); LTM reported EBITDA 24,100 (9.7%)
ADJUSTED EBITDA BRIDGE (LTM Jun-2026, USD 000s)
Reported EBITDA 24,100; owner compensation above market 2,900; personal travel, autos and club dues 640; one-time ERP implementation 1,150; legal settlement (terminated GC dispute) 820; branch opening costs (Charlotte, Nashville) 1,400; pro forma run-rate of 2026 price increase 2,250; run-rate of March 2026 acquisition (Piedmont Air) 1,900; management fee to be eliminated 750. ADJUSTED EBITDA 35,910 (14.4% margin)
REVENUE MIX AND BACKLOG
Service and maintenance contracts 38% of revenue, project/install 62%. Contracted backlog at Jun-2026 of 141,000, up from 96,000 at Jun-2025. Maintenance agreement renewal rate cited at 94%.
CUSTOMER CONCENTRATION
Top customer 17% of LTM revenue (regional hospital system, master services agreement expiring Dec-2027); top 5 customers 46%; top 10 60%.
GROWTH INITIATIVES
(i) convert install customers to maintenance agreements, (ii) two greenfield branches (Raleigh, Birmingham), (iii) price realization of 4-5% annually, (iv) fragmented market with over 300 sub-scale operators in footprint.
OTHER
Net working capital of 31,200 at Jun-2026 (12.5% of LTM revenue); capex 1.8% of revenue; 78 owned service vehicles under a fleet lease; unionized workforce at 1 of 6 branches; CEO/founder intends to retire at close, CFO joined 2024.`,
  },
  instructions: `1. Read the pasted CIM text first and extract, verbatim where possible: revenue and EBITDA by year, the adjusted-EBITDA bridge line by line, margin, backlog, revenue mix (recurring vs project), retention, customer concentration, NWC, capex, headcount, management situation, and every growth initiative with the quantum the banker claims.
2. Test the add-back stack against the QoE taxonomy: seller add-backs (owner compensation, personal expenses, one-time projects, litigation), diligence corrections, and pro forma / run-rate adjustments. For each line give a verdict (accept, haircut, reject) with a reason; providers commonly disallow 10-30% of proposed add-backs, and "one-offs" that appear every year (branch openings, ERP, settlements) are the usual rejects. Show the price impact: at the entry multiple, each dollar of rejected add-back removes that multiple of enterprise value.
3. If a public comp ticker is given, set the valuation anchor with two calls and stop: get_company_financials on the ticker and get_trading_comps with 4-6 listed peers in the same business. Treat that grid as the source for EV/EBITDA and EV/Revenue; only when it returns NM for a multiple you actually need should you fall back to get_xbrl_series for one peer with named concepts, never a broad find sweep across every peer. If a figure looks internally inconsistent, say so in caveats and use the other source rather than dropping the anchor. Then use search_filing on the closest peer's 10-K for "backlog", "customer concentration", "maintenance" or "service revenue" to benchmark the CIM's claims, since a 94% renewal rate or a 38% recurring mix is only meaningful against what public operators report. Apply a private-company and size discount to the public multiple and say how many turns it is worth and why.
4. Compute with calc: revenue CAGR, reported and adjusted EBITDA margin, the add-back as a percentage of reported EBITDA, NWC as a percentage of revenue, capex intensity, backlog coverage of project revenue, and implied EV at the comp range on both reported and your adjusted EBITDA.
5. Where the CIM is silent, say so explicitly rather than inferring: cash conversion, gross margin by contract type, churn at the account level, the split of price versus volume, pension or multi-employer plan exposure for the union branch, and any change-of-control terms on the top customer's MSA.
Produce, in order: callout with the bid / no-bid read in two sentences; kpis (LTM revenue, revenue CAGR, reported EBITDA and margin, CIM adjusted EBITDA and margin, your adjusted EBITDA, implied EV range); table "Adjusted EBITDA bridge" (Item, CIM amount, Verdict, Our amount, Rationale) with a totals row; table "Financial summary" as presented with growth and margins; bullets "What the CIM is selling" and bullets "What the CIM avoids"; risks (5-7 with severity and mitigation, covering concentration, founder transition, union exposure, project-versus-service mix, pricing durability); qa "Questions for management" (8, each answerable in a management meeting); table "Comps anchor" if a ticker was given; nextSteps (diligence scope and who owns each workstream); caveats separating CIM-asserted figures from verified ones.`,
  prompt: (i) => `First-read memo on ${str(i, "company")}.${str(i, "ticker") ? ` Use ${str(i, "ticker").toUpperCase()} and its peers as the public comp anchor.` : ""}${str(i, "thesis") ? ` Our angle: ${str(i, "thesis")}.` : ""}\n\n--- CIM excerpts ---\n${str(i, "cim")}\n--- end CIM excerpts ---`,
};

const targetScreen: ToolDef = {
  kind: "ai", id: "pe-target-screen", title: "Target screen from public comps", tagline: "Build the buy-list: public peers, the private universe they imply, and the ones that screen for a sponsor.",
  description: "Screens a sector for sponsor-ready targets by first spreading the listed universe from SEC data (scale, growth, margin, leverage, cash conversion), then deriving the profile that works in an LBO at today's leverage and cost of debt, and finally listing named candidates: listed companies that screen as take-private candidates plus private companies found through Form D, the startup directory and web research.",
  roles: ["pe", "banker", "corpfin"], category: "Screening", icon: "Filter", deliverable: "table", savesMinutes: 210, tags: ["screening", "sourcing", "comps"], effort: "high",
  fields: [
    { key: "sector", label: "Sector / business model", type: "text", required: true, placeholder: "e.g. commercial HVAC and mechanical services" },
    { key: "anchors", label: "Anchor tickers", type: "tickers", required: true, placeholder: "FIX EME IESC POWL", help: "Listed companies that define the universe" },
    { key: "minRevenue", label: "Minimum revenue", type: "number", unit: "$mm", default: 200 }, { key: "maxEv", label: "Maximum EV", type: "number", unit: "$mm", default: 4000 },
    { key: "criteria", label: "Must-haves", type: "multiselect", options: ["Recurring revenue", "EBITDA margin above 15%", "Low capex intensity", "Fragmented market for add-ons", "Founder or family owned", "Under-levered balance sheet", "Non-cyclical end markets", "Pricing power"], default: ["Recurring revenue", "Fragmented market for add-ons", "Low capex intensity"] },
  ],
  example: { sector: "commercial HVAC, mechanical and electrical services", anchors: ["FIX", "EME", "IESC", "POWL"], minRevenue: 200, maxEv: 4000, criteria: ["Recurring revenue", "Fragmented market for add-ons", "Low capex intensity", "Founder or family owned"] },
  instructions: `1. Call get_trading_comps on the first anchor with the remaining anchors as peers to spread the listed universe; call get_company_financials on each anchor that the comps grid leaves incomplete. Use search_companies with the sector words and the anchors' SIC codes to widen the universe to 8-12 names.
2. Define the screen quantitatively before naming candidates: revenue and EV bands from the inputs, EBITDA margin threshold, capex as a percentage of EBITDA, net leverage today, and the revenue growth needed for a 2.5x MOIC over five years. At today's structures (total leverage 4.0-5.5x, all-in cost of debt 8-9%, sponsor equity 40-60% of the structure) state the EBITDA CAGR required at a flat exit multiple and use calc to prove it.
3. Score every listed name against the must-haves using filing evidence, not inference: search_filing on each candidate's 10-K for "recurring", "service agreements" or "maintenance contracts", "customer concentration", "backlog", "indebtedness" and "capital expenditures"; use get_xbrl_series for LongTermDebt and InterestExpense where leverage matters.
4. For take-private candidates add the control test: use get_insider_transactions and search_filing on the DEF 14A for "beneficial ownership" to find founder, family or sponsor blocks, and get_recent_filings with forms ["SC 13D"] for activist positions. A 30-40% premium on top of today's EV is the starting point; compute the implied entry multiple at that premium with calc and say whether it still clears the return test.
5. For the private universe, run form_d_search and search_startups on the sector words and web_research for "largest privately held [sector] companies" and regional operators; report only companies you can point to a source for, with the signal that surfaced them.
Produce: kpis (universe size, median EV/EBITDA, median EBITDA margin, required EBITDA CAGR for 2.5x, candidates that pass); table "Screen" (Company, Public/Private, Revenue, EBITDA, Margin, EV, EV/EBITDA, Net leverage, Passes?, Why) with the anchors first; score block rating the top 5 candidates against the must-haves; scatter of EBITDA margin versus revenue growth with the passing names emphasized; bullets "Where the value is" and "Who else will be bidding"; table "Private candidates" (Company, Source, Signal, Estimated scale); nextSteps (outreach order); caveats on private estimates and on multiples being LTM and un-calendarized.`,
  prompt: (i) => `Screen ${str(i, "sector")} for sponsor targets. Anchors: ${list(i, "anchors").join(", ")}. Revenue above $${num(i, "minRevenue", 200)}mm, EV below $${num(i, "maxEv", 4000)}mm. Must-haves: ${list(i, "criteria").join("; ") || "recurring revenue and add-on runway"}.`,
};

const takePrivatePrecedents: ToolDef = {
  kind: "ai", id: "pe-take-private-precedents", title: "Take-private precedent finder", tagline: "Sponsor take-privates from merger proxies and 13E-3s: premiums, multiples, financing, and who bid.",
  description: "Finds sponsor-led take-privates in a sector with EDGAR full-text search over DEFM14A merger proxies and SC 13E3 going-private statements, reads each document for the consideration, the premium to the unaffected price, the sponsor and its equity and debt financing, the go-shop and termination fees, and the background-of-the-merger process, then assembles the precedent table with medians and the multiples where XBRL supports them.",
  roles: ["pe", "banker"], category: "Valuation", icon: "Handshake", deliverable: "table", savesMinutes: 300, tags: ["take-private", "precedents", "premiums", "13E-3"], effort: "high",
  fields: [
    { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "software, cybersecurity, healthcare IT" }, { key: "from", label: "Announced from", type: "date", default: "2023-01-01" },
    { key: "count", label: "Deals to find", type: "number", default: 6, min: 4, max: 15, help: "Six fully documented deals beat twelve half-read ones; raise it only for a broad sector" }, { key: "sponsor", label: "Sponsor filter (optional)", type: "text", placeholder: "e.g. Thoma Bravo, Vista Equity Partners" },
  ],
  example: { sector: "software cloud subscription", from: "2023-01-01", count: 6, sponsor: "" },
  instructions: `1. Gather candidates with edgar_fulltext_search, running at least four query variants and de-duplicating by target: (a) "going private transaction" plus the sector words, forms ["SC 13E3"]; (b) "Agreement and Plan of Merger" with "Parent" and "Sponsor" plus sector words, forms ["DEFM14A","PREM14A"]; (c) "affiliates of" plus "equity commitment letter", forms ["DEFM14A","SC 13E3"]; (d) "Opinion of" plus "Financial Advisor" with the sector words, forms ["DEFM14A"]. Apply the from date and, if a sponsor filter is given, pass it as the query text as well (sponsor names appear in the proxy body, not the filer name). Prefer SC 13E3 hits: a 13E-3 is filed only when an affiliate or controlling sponsor is on both sides, which is the cleanest signal of a sponsor take-private.
2. Read each proxy with at most three read_document calls, batching terms into one query rather than one call per phrase: (a) "per share in cash merger consideration premium unaffected closing price"; (b) "equity commitment letter debt commitment termination fee go-shop rollover"; (c) one offset read (offset from a hit, length 1200-2000) only when a number you need is cut off mid-sentence. You have several documents to cover in one context, so never re-query the same document once per field. Capture: announce date, target, sponsor(s) and any rollover or co-invest party, price per share, implied equity value and enterprise value as disclosed, premium to the last unaffected close and to the 30-day or 52-week measure the proxy cites, equity check, debt commitment size and structure (unitranche, term loan B, private credit), termination and reverse termination fees in dollars and as a percent of transaction value, go-shop window, and how many parties the background section says were contacted and bid.
3. Remember that a completed take-private target is delisted, so get_company_financials and get_xbrl_series will usually not resolve its old ticker: try once per target, then stop. Get the target's LTM revenue and EBITDA from the proxy instead, where the "Certain Financial Projections" section and the financial advisor's selected-companies and selected-transactions analyses normally state them outright along with the multiples the board was shown. Deal terms always come from the filing, never from the web; allow at most one web_research call per target after the proxy read has failed, label anything it returns as web-sourced, and mark the multiple NM rather than spending further calls. Compute EV/LTM Revenue and EV/LTM EBITDA with calc only from figures you read, mark NM and say why when EBITDA is negative or unavailable, and never carry a multiple you did not compute or read.
4. Compute medians and the range for premium, EV/Revenue, EV/EBITDA, equity as a percentage of EV (today's structures run 40-60% equity) and termination fee as a percentage of transaction value (the 2025 US benchmark is a ~2.7% median). Flag every deal where the equity percentage or the premium sits outside the interquartile range and say what explains it.
5. If fewer deals are found than requested, widen the date window or drop to forms ["DEFM14A"] only, and report the count you actually verified. Do not fill gaps with deals you cannot cite to a document URL.
Produce: kpis (deals verified, median premium, median EV/EBITDA, median equity %, median termination fee %); table "Sponsor take-privates" (Announced, Target, Sponsor, $/share, Premium, EV, EV/LTM Rev, EV/LTM EBITDA, Equity %, Debt structure, Term fee %, Source); bar chart of premium by deal; bar chart of EV/EBITDA by deal; bullets "Process and terms worth copying" drawn from the background sections and go-shop data; timeline of the announcements; caveats on computed versus disclosed multiples and on premium measurement dates.`,
  prompt: (i) => `Find ${num(i, "count", 8)} sponsor take-privates announced since ${str(i, "from", "2023-01-01")} in: ${str(i, "sector")}.${str(i, "sponsor") ? ` Focus on ${str(i, "sponsor")}.` : ""} Give premiums, multiples, financing structures and termination fees.`,
};

const qoeAddbackTest: ToolDef = {
  kind: "ai", id: "pe-qoe-addback-test", title: "Quality of earnings add-back tester", tagline: "Every proposed add-back categorized, tested, and priced at your entry multiple.",
  description: "Takes the seller's adjusted-EBITDA bridge as a CSV and applies the QoE taxonomy: seller add-backs, diligence corrections, and pro forma or run-rate adjustments. Each line gets a verdict, an evidence standard for sustaining it, and a price impact at the entry multiple, producing the bridge from reported to defensible EBITDA that the bid and the lender's leverage case both rest on.",
  roles: ["pe", "banker", "corpfin"], category: "Diligence", icon: "Scale", deliverable: "analysis", savesMinutes: 200, tags: ["QoE", "add-backs", "EBITDA", "diligence"], effort: "high",
  fields: [
    { key: "addbacks", label: "Adjusted EBITDA bridge", type: "csv", required: true, columns: "item, amount, category, recurs_prior_years, seller_support", help: "One row per adjustment; amount in $mm or $000s (say which in the notes)" },
    { key: "reportedEbitda", label: "Reported EBITDA", type: "number", unit: "$mm", required: true, default: 24.1 }, { key: "entryMultiple", label: "Entry multiple", type: "number", unit: "x", default: 10 },
    { key: "units", label: "CSV units", type: "select", options: ["$mm", "$000s"], default: "$mm" },
    { key: "notes", label: "Context (optional)", type: "textarea", placeholder: "Owner-operated, first institutional capital; ERP went live in FY25; one branch unionized" },
  ],
  example: {
    reportedEbitda: 24.1, entryMultiple: 10, units: "$mm",
    notes: "Founder-owned commercial HVAC services platform, LTM Jun-2026. ERP implementation started FY24 and is ongoing. Two branches opened in each of the last three years.",
    addbacks: `item,amount,category,recurs_prior_years,seller_support
Owner compensation above market,2.90,Seller add-back,yes,Comp study from seller's advisor
Personal travel autos and club dues,0.64,Seller add-back,yes,GL detail
One-time ERP implementation,1.15,Seller add-back,yes,Vendor invoices
Legal settlement - terminated GC dispute,0.82,Seller add-back,no,Settlement agreement
Branch opening costs Charlotte and Nashville,1.40,Seller add-back,yes,Internal schedule
Run-rate of 2026 price increase,2.25,Pro forma,n/a,Price letters to top 20 customers
Run-rate of March 2026 acquisition (Piedmont Air),1.90,Pro forma,n/a,Piedmont FY25 unaudited P&L
Management fee to be eliminated,0.75,Seller add-back,yes,Related-party agreement
Unrecorded accrued vacation,-0.35,Diligence adjustment,n/a,Our recalculation
Capitalized labor that is really opex,-0.55,Diligence adjustment,n/a,Fixed asset additions testing`,
  },
  instructions: `1. Normalize the CSV: map the item, amount, category, recurrence and support columns whatever they are called, convert to $mm using the units field, and total the seller's claimed adjusted EBITDA. State the total and the implied margin lift if revenue is given in the context.
2. Classify every line into exactly one bucket: (a) seller add-back (non-recurring expense, excess owner compensation, personal expenses, litigation, one-time projects); (b) diligence adjustment (accounting errors, unrecorded liabilities, revenue cut-off, opex capitalized as capex, related-party terms restated to arm's length); (c) pro forma / run-rate (new rent, new contracts, price increases, acquisitions, lost customers). Re-categorize the seller's label when it is wrong and say so.
3. Apply the test that decides each one: does it recur in prior years (branch openings, ERP phases and "one-time" settlements that appear annually are operating costs, not add-backs); is the amount supported by third-party evidence or by a management schedule; for owner compensation, is there a market comp study and a replacement hire; for pro forma items, is the change contracted and already in run-rate, and is the realization period defensible; for acquisitions, is it a full-period pro forma with the seller's cost base or a synergized number. Give each line a verdict (accept / haircut to X / reject) and the evidence a QoE provider would require. Benchmark: providers commonly disallow 10-30% of proposed add-backs.
4. Use calc to build the bridge from reported EBITDA to your defensible EBITDA and to price every rejection at the entry multiple (at 10x, $0.2mm of rejected add-backs removes $2.0mm of enterprise value). Report total disallowed in dollars, as a percentage of the claimed adjustments, and as enterprise value.
5. Use web_research or search_filing on a listed peer only to benchmark whether a cost the seller calls non-recurring is disclosed as ordinary by public operators in the same business (for example whether branch opening or ERP costs appear in peers' operating expense rather than as adjustments).
Produce: callout with the defensible EBITDA and the EV impact; kpis (reported EBITDA, seller adjusted EBITDA, our adjusted EBITDA, total disallowed, EV impact at entry multiple, % of add-backs disallowed); table "Add-back testing" (Item, Bucket, Seller $, Verdict, Our $, Evidence required, Recurs?) with a totals row; waterfall from reported EBITDA through accepted buckets to our adjusted EBITDA; bar of disallowed dollars by bucket; checklist "QoE workstream" (proof of cash, revenue cut-off testing, concentration at gross-profit level, related-party review, run-rate substantiation) with owners; risks; nextSteps; caveats on unaudited figures and on the pro forma items that need contractual proof.`,
  prompt: (i) => `Test the seller's add-backs against reported EBITDA of $${num(i, "reportedEbitda", 0)}mm at a ${num(i, "entryMultiple", 10)}x entry multiple. CSV amounts are in ${str(i, "units", "$mm")}.${str(i, "notes") ? `\n\nContext: ${str(i, "notes")}` : ""}`,
};

const netDebtChecklist: ToolDef = {
  kind: "ai", id: "pe-net-debt-checklist", title: "Net debt & debt-like items checklist", tagline: "Everything that should come off the purchase price before the wire goes out.",
  description: "Builds the funded-debt and debt-like-items schedule that sets the equity purchase price in a cash-free debt-free deal: bank debt, finance leases, seller notes and earnouts, deferred revenue on undelivered services, accrued bonuses and payroll taxes, unfunded pensions, customer deposits, and the accruals sellers leave out. Works from a pasted balance sheet or trial balance and, where the target has a listed comparable, benchmarks what that peer discloses.",
  roles: ["pe", "banker", "corpfin"], category: "Diligence", icon: "ListChecks", deliverable: "checklist", savesMinutes: 120, tags: ["net debt", "purchase price", "SPA"], effort: "medium",
  fields: [
    { key: "balances", label: "Balance sheet / trial balance extract", type: "textarea", required: true, placeholder: "Paste the liability and equity side of the closing balance sheet with account names and amounts" },
    { key: "ticker", label: "Listed comparable (optional)", type: "ticker", placeholder: "FIX", help: "Used to benchmark lease, pension and contract-liability disclosure" },
    { key: "equityPrice", label: "Headline EV / TEV", type: "number", unit: "$mm", default: 360 },
    { key: "nwcTreatment", label: "Deal structure", type: "select", options: ["Cash-free debt-free with NWC peg", "Locked box", "Cash and debt included"], default: "Cash-free debt-free with NWC peg" },
  ],
  example: {
    equityPrice: 360, ticker: "FIX", nwcTreatment: "Cash-free debt-free with NWC peg",
    balances: `Revolver drawn 8,400
Term loan (Bank of the South) 22,600
Current portion of long-term debt 3,100
Finance lease obligations - service fleet 6,900
Operating lease liabilities (6 branches) 14,200
Seller note from 2024 acquisition of Summit Air 2,500
Earnout payable - Piedmont Air acquisition (max 4,000) 2,800
Accrued bonuses (unpaid FY25 and stub FY26) 2,150
Accrued vacation and PTO 1,480
Accrued payroll and sales taxes 940
Customer deposits and progress billings in excess of costs 7,300
Deferred revenue - unexpired maintenance agreements 5,600
Accrued interest 190
Multi-employer pension withdrawal estimate (1 union branch) unknown
Accrued warranty and callback reserve 620
Cash and equivalents 4,300`,
  },
  instructions: `1. Parse the pasted balances into three lists: (a) funded debt (revolver, term loans, current portion, finance leases, seller notes, accrued interest, debt break costs and prepayment premiums); (b) debt-like items (earnouts and deferred consideration from prior acquisitions, accrued but unpaid bonuses, vacation and PTO, unpaid sales and payroll taxes, customer deposits and billings in excess of cost, deferred revenue on undelivered services, unfunded or multi-employer pension exposure, rent-free period accruals, unusual accruals, warranty reserves, transaction and change-of-control payments); (c) items to leave in working capital or exclude. State the rule you applied for each: it is debt-like when it is a pre-close obligation that the buyer must fund with cash after close and it is not already in the NWC peg definition.
2. Apply the deal structure: under cash-free debt-free, equity price = EV - funded debt - debt-like items + cash (subject to a minimum cash carve-out) with a separate NWC true-up to the peg; under a locked box, say which items are already captured and which are not. Flag double-counting between the peg and the debt-like list explicitly, because deferred revenue, customer deposits and accrued bonuses are the usual overlaps.
3. Size the items the seller called unknown. For operating leases, decide whether the deal capitalizes them (lender leverage cases usually do when EBITDA is post-rent) and state the effect on both net debt and the multiple. For multi-employer pension exposure, ask for the latest Form 5500 and the withdrawal liability estimate; if a listed comparable ticker is given, call search_filing on its 10-K for "multiemployer", "withdrawal liability", "finance lease", "contract liabilities" and "asset retirement" and use get_xbrl_series with find "Lease|Pension|ContractWithCustomerLiability" to show how large these lines are for a public operator of similar size.
4. Compute with calc: funded debt total, debt-like total, net debt, equity price, and each bucket as a percentage of EV. Show the price impact of the three largest contested items.
5. For each contested item, write the SPA mechanic that resolves it: a specific indemnity, an escrow, a dollar-for-dollar purchase price adjustment, a pre-close payment by the seller, or inclusion in the peg definition.
Produce: kpis (EV, funded debt, debt-like items, cash, equity price, debt-like as % of EV); table "Net debt schedule" (Item, Bucket, Amount, Debt-like?, Treatment, Evidence needed) with totals; waterfall from EV to equity price; checklist "Requests to the seller" with owners; risks (contested items with severity); table "Peer disclosure benchmark" when a ticker was given; caveats on the overlap with the NWC peg and on unquantified exposures.`,
  prompt: (i) => `Build the net debt and debt-like items schedule for a ${str(i, "nwcTreatment", "cash-free debt-free")} deal at a $${num(i, "equityPrice", 0)}mm headline EV.${str(i, "ticker") ? ` Benchmark disclosure against ${str(i, "ticker").toUpperCase()}.` : ""}\n\n--- Balances ---\n${str(i, "balances")}\n--- end ---`,
};

const icMemo: ToolDef = {
  kind: "ai", id: "pe-ic-memo", title: "Investment committee memo", tagline: "The full IC memo: thesis, returns, diligence findings, risks, and the recommendation.",
  description: "Assembles the investment committee memo in the house order: recommendation and requested capital, the thesis in three claims, market and competitive position from filings and web research, the base and downside cases with the returns that follow, the value creation plan, diligence findings and open items, structure and financing, and the exit. Numbers are pulled from public data and the user's inputs, each one tagged to its source.",
  roles: ["pe"], specialties: ["Large-cap buyout", "Middle-market buyout", "Growth equity", "Infrastructure & real assets"],
  category: "Deliverables", icon: "Presentation", deliverable: "memo", savesMinutes: 360, tags: ["IC", "memo", "approval"], effort: "high",
  fields: [
    { key: "company", label: "Target", type: "text", required: true, placeholder: "e.g. Meridian Mechanical Services" }, { key: "ticker", label: "Comp anchor (optional)", type: "ticker", placeholder: "FIX" },
    { key: "facts", label: "Deal facts", type: "textarea", required: true, placeholder: "EV, entry multiple, EBITDA, leverage and structure, equity check, hold, exit multiple, diligence findings, management plan", help: "Paste your model outputs and diligence summary; the memo is built around them" },
    { key: "stage", label: "IC stage", type: "select", options: ["Screening / IOI", "Second round / LOI", "Final approval"], default: "Second round / LOI" },
    { key: "recommendation", label: "Our recommendation", type: "select", options: ["Proceed", "Proceed with conditions", "Pass"], default: "Proceed with conditions" },
  ],
  example: {
    company: "Meridian Mechanical Services", ticker: "FIX", stage: "Second round / LOI", recommendation: "Proceed with conditions",
    facts: `EV $359mm at 10.0x our adjusted EBITDA of $35.9mm (CIM claims 10.0x on $35.9mm; we underwrite $33.4mm after disallowing $2.5mm of add-backs, so 10.7x on our number).
Structure: $134mm unitranche (4.0x our EBITDA) at SOFR+525 with a 1% floor, 1% annual amortization, 75% cash sweep; $20mm delayed draw for add-ons; sponsor equity $241mm including $12mm rollover from the CFO; 8% MIP struck at cost with a 2.0x ratchet.
Base case: 9% EBITDA CAGR to $51mm in year five (3% price, 4% volume, 2% mix from service conversion), 4 add-ons at 7.0x adding $9mm of EBITDA, exit at 10.5x in year five.
Diligence: QoE complete (Big 4), NWC peg set at $29.8mm TTM average, top customer 17% with an MSA expiring Dec-2027, one unionized branch with an unquantified multi-employer withdrawal exposure, founder retiring at close and no CEO identified.
Returns: 22.4% IRR / 2.7x MOIC base; downside at 5% EBITDA CAGR and a 9.0x exit is 11% IRR / 1.7x.`,
  },
  instructions: `1. Build the memo from the pasted deal facts; do not invent figures. Where a fact is missing (management team, exit route, add-on pipeline) list it as an open item rather than filling it in.
2. Verify and enrich the market section with public data: get_company_financials and get_trading_comps on the comp anchor and 4-6 peers for the valuation range and margin structure; search_filing on the anchor's 10-K for "competition", "backlog", "customer concentration" and "human capital" for end-market and labor evidence; web_research for market size, growth and any recent transactions in the sector. Every external claim carries its source id.
3. Re-derive the returns arithmetic with calc rather than restating it: entry EV, entry leverage on both the seller's and your EBITDA, sponsor equity as a percentage of the structure, implied MOIC and IRR, and the attribution of the base case into EBITDA growth, multiple change and deleveraging. State the EBITDA CAGR required for a 2.5x MOIC at a flat exit multiple and compare it with the plan (Bain's benchmark: 10-12% annual EBITDA growth now does what 5% used to).
4. Write the downside case explicitly: what breaks (loss of the top customer, a cycle in project revenue, wage inflation, price realization failing), what it does to EBITDA and leverage, whether the covenant holds, and the IRR and MOIC that result. Tie the covenant headroom to the structure in the facts.
5. Tailor depth to the IC stage: screening / IOI is three pages of thesis, price and the two questions that could kill it; second round / LOI adds diligence scope, financing and the conditions in the recommendation; final approval adds confirmatory findings, the signed structure and the 100-day plan owner.
Produce: callout with the recommendation, the capital requested and the conditions; kpis (EV, entry multiple on our EBITDA, leverage, equity check, base IRR/MOIC, downside IRR/MOIC); markdown "Investment thesis" (exactly three numbered claims, each with the evidence and the number that proves it); table "Valuation and comps"; table "Returns cases" (Case, EBITDA CAGR, Exit multiple, Exit EBITDA, Net debt at exit, MOIC, IRR); waterfall of value creation attribution; markdown "Value creation plan" with owners; table "Diligence findings" (Workstream, Provider, Finding, Impact on price or structure, Status); risks (6-8 with severity and mitigation); markdown "Structure and financing"; markdown "Exit"; checklist "Conditions to closing"; nextSteps; caveats.`,
  prompt: (i) => `Draft the ${str(i, "stage", "Second round / LOI")} IC memo for ${str(i, "company")}. Recommendation: ${str(i, "recommendation", "Proceed with conditions")}.${str(i, "ticker") ? ` Comp anchor: ${str(i, "ticker").toUpperCase()}.` : ""}\n\n--- Deal facts ---\n${str(i, "facts")}\n--- end ---`,
};

const hundredDayPlan: ToolDef = {
  kind: "ai", id: "pe-100-day-plan", title: "100-day plan builder", tagline: "Thesis translated into workstreams, owners, and 30/60/90 milestones.",
  description: "Turns the investment thesis into the post-close plan roughly 90% of sponsors now build: a one-page thesis translation, workstreams across finance and reporting, commercial, operations, technology, human capital and integration, each with an owner, 30/60/90-day milestones, the quick wins that land in the first month, and the reporting cadence that makes the value creation plan measurable.",
  roles: ["pe"], specialties: ["Middle-market buyout", "Large-cap buyout", "Growth equity"],
  category: "Portfolio", icon: "ClipboardList", deliverable: "checklist", savesMinutes: 240, tags: ["100-day", "post-close", "value creation"], effort: "medium",
  fields: [
    { key: "company", label: "Portfolio company", type: "text", required: true, placeholder: "e.g. Meridian Mechanical Services" },
    { key: "thesis", label: "Thesis and plan", type: "textarea", required: true, placeholder: "The three or four things that have to happen for the deal to work, with the numbers attached" },
    { key: "situation", label: "Starting point", type: "textarea", placeholder: "Systems, team gaps, reporting maturity, known issues from diligence, carve-out or integration needs" },
    { key: "closeDate", label: "Close date", type: "date", default: "2026-10-15" }, { key: "ticker", label: "Benchmark peer (optional)", type: "ticker", placeholder: "FIX" },
  ],
  example: {
    company: "Meridian Mechanical Services", closeDate: "2026-10-15", ticker: "FIX",
    thesis: "Convert project customers to maintenance agreements (recurring mix 38% to 55%), realize 4-5% annual price, open Raleigh and Birmingham greenfields, complete 4 add-ons at 6-7x, take EBITDA from $33.4mm to $51mm and margin from 13.4% to 16%.",
    situation: "Founder CEO retires at close and no successor is identified; CFO joined 2024 and is capable but has no FP&A support; QuickBooks plus a half-implemented ERP; no monthly close calendar and reporting arrives 25 days late; no CRM, pricing is set branch by branch; one unionized branch; NWC at 12.5% of revenue with DSO near 62 days.",
  },
  instructions: `1. Write the thesis translation first: for each thesis claim, the operating change required, the metric that proves it, the baseline today, the year-one target and the owner. If the thesis has four claims the plan has four spines; everything else is supporting work.
2. Build workstreams across the standard six: finance and reporting, commercial (pricing, sales, customer mix), operations, technology and data, human capital, and integration or add-ons. For each, list the 30-day, 60-day and 90-day milestones with a named owner role (CEO, CFO, operating partner, deal team, external provider) and the artifact that closes the milestone (a signed pricing policy, a monthly reporting pack, a KPI dashboard, a working ERP module, a hired controller).
3. Front-load the non-negotiables: day-one controls (bank authorities, signature limits, cash sweep and lender reporting), the close calendar and a monthly reporting pack by day 30, the 13-week cash forecast if liquidity is tight, KPI definitions agreed with management, weekly operating reviews from day 1, synergy and add-on tracking by day 60, and the first board pack and LP-ready reporting by day 90.
4. Address the diligence findings from the starting point as explicit workstream items: leadership gaps (interim or search kickoff in the first two weeks), systems (what to stabilize versus replace), working capital (DSO and billing discipline, usually the fastest cash win), and any union, regulatory or customer-concentration exposure.
5. If a benchmark ticker is given, call get_company_financials and search_filing on its 10-K for "human capital", "backlog", "service agreements" and segment margin to set defensible targets for margin, DSO and recurring mix rather than round numbers, and cite them.
Produce: callout with the one-sentence plan and the single metric that matters most; table "Thesis translation" (Thesis claim, Operating change, Metric, Baseline, Year-1 target, Owner); checklist "First 30 days" with owners and due dates counted from the close date; checklist "Days 31-60"; checklist "Days 61-100"; timeline of the governance cadence (first board meeting, monthly pack, quarterly reforecast, lender compliance dates); table "KPI dashboard" (KPI, Definition, Source system, Frequency, Baseline, Target); risks (execution risks with mitigation); bullets "Quick wins"; nextSteps; caveats.`,
  prompt: (i) => `Build the 100-day plan for ${str(i, "company")}, closing ${str(i, "closeDate", "2026-10-15")}.${str(i, "ticker") ? ` Benchmark targets against ${str(i, "ticker").toUpperCase()}.` : ""}\n\nThesis: ${str(i, "thesis")}${str(i, "situation") ? `\n\nStarting point: ${str(i, "situation")}` : ""}`,
};

const valueCreationPlan: ToolDef = {
  kind: "ai", id: "pe-value-creation-plan", title: "Value creation plan with quantified levers", tagline: "Every lever sized in EBITDA dollars against public benchmarks, bridged to the exit.",
  description: "Builds the value creation plan as a quantified EBITDA bridge rather than a list of initiatives: pricing, mix, volume, procurement, SG&A, footprint and add-ons, each sized in dollars, each benchmarked against what listed operators in the same business actually achieve, with a realization schedule, the cost to achieve, and the multiple and deleveraging contribution that completes the return.",
  roles: ["pe"], specialties: ["Middle-market buyout", "Large-cap buyout", "Infrastructure & real assets"],
  category: "Portfolio", icon: "TrendingUp", deliverable: "analysis", savesMinutes: 300, tags: ["VCP", "EBITDA bridge", "benchmarks"], effort: "high",
  fields: [
    { key: "company", label: "Portfolio company", type: "text", required: true }, { key: "peers", label: "Benchmark tickers", type: "tickers", required: true, placeholder: "FIX EME IESC", help: "Listed operators whose margins set the ceiling" },
    { key: "revenue", label: "Revenue", type: "number", unit: "$mm", required: true, default: 249 }, { key: "ebitda", label: "EBITDA today", type: "number", unit: "$mm", required: true, default: 33.4 },
    { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 3, max: 7 },
    { key: "levers", label: "Levers in scope", type: "multiselect", options: ["Pricing", "Mix shift to recurring", "Volume / share gain", "Procurement", "SG&A and overhead", "Footprint / greenfield", "Add-on M&A", "Working capital", "Capex discipline"], default: ["Pricing", "Mix shift to recurring", "Procurement", "SG&A and overhead", "Add-on M&A"] },
    { key: "context", label: "Context", type: "textarea", placeholder: "What diligence found: pricing dispersion, overhead structure, add-on pipeline, capacity" },
  ],
  example: {
    company: "Meridian Mechanical Services", peers: ["FIX", "EME", "IESC"], revenue: 249, ebitda: 33.4, years: 5,
    levers: ["Pricing", "Mix shift to recurring", "Procurement", "SG&A and overhead", "Add-on M&A"],
    context: "CDD found 6-9 points of gross margin dispersion between branches on comparable work and no central pricing policy. Recurring maintenance is 38% of revenue at a 31% gross margin versus 21% on project work. Purchasing is branch-level across 4 equipment OEMs. Corporate overhead is 6.1% of revenue. Pipeline of 11 owner-operated targets at $2-6mm EBITDA trading at 6-7x.",
  },
  instructions: `1. Establish the ceiling before sizing anything: call get_trading_comps on the peer tickers and get_company_financials on each; compute gross margin, EBITDA margin, SG&A as a percentage of revenue, capex intensity and revenue per branch or per employee where disclosed. Use search_filing on the best peer's 10-K for "gross margin", "selling general and administrative", "service", "backlog" and segment tables to see how the margin is actually built. The peer's structure, not a round number, sets what each lever can deliver.
2. Size every in-scope lever in EBITDA dollars with calc and show the arithmetic: pricing = realized price change x revenue base x retention of volume; mix = (recurring gross margin - project gross margin) x revenue shifted; volume = incremental revenue x contribution margin; procurement = spend under management x savings rate; SG&A = (current SG&A % - target SG&A %) x revenue; footprint = revenue per new site x contribution margin less ramp cost; add-ons = number x average EBITDA x (1 + synergy %) and note the multiple arbitrage separately; working capital and capex as cash, not EBITDA. State the benchmark that supports each rate and cite it.
3. Phase realization rather than assuming full effect on day one: a 20/50/80/100 ramp over years one to four is the default, cut it back where the lever needs a system or a hire. Subtract the one-time cost to achieve and any dis-synergy (customer attrition after a price increase, lost volume, integration cost).
4. Assemble the bridge from EBITDA today to exit EBITDA and split total value creation three ways: EBITDA growth = (exit EBITDA - entry EBITDA) x entry multiple; multiple change = (exit multiple - entry multiple) x exit EBITDA; deleveraging = entry net debt - exit net debt. Revenue growth produced 71% of value in recent exits, so state plainly how much of the plan depends on multiple expansion, and test the plan against the 10-12% annual EBITDA growth a 2.5x MOIC now needs.
5. Assign each lever an owner, a monthly metric, and the leading indicator that shows it is working before the EBITDA arrives. Flag the levers that are mutually exclusive or that compete for the same management bandwidth.
Produce: kpis (EBITDA today, exit EBITDA, margin today and at exit, peer median margin, implied EBITDA CAGR, total value created); table "Lever sizing" (Lever, Mechanic, Driver value, Benchmark and source, EBITDA $, Ramp, Cost to achieve, Owner) with totals; waterfall from EBITDA today to exit EBITDA by lever; bar of EBITDA margin versus each peer with the exit target as a reference; table "Realization schedule" by year; table "Value creation attribution" (EBITDA growth, multiple change, deleveraging, fees); risks (which levers are fragile and why); nextSteps; caveats on peer comparability and on unaudited baselines.`,
  prompt: (i) => `Build the value creation plan for ${str(i, "company")}: $${num(i, "revenue", 0)}mm revenue, $${num(i, "ebitda", 0)}mm EBITDA, ${num(i, "years", 5)}-year hold. Benchmark against ${list(i, "peers").join(", ")}. Levers: ${list(i, "levers").join("; ")}.${str(i, "context") ? `\n\nContext: ${str(i, "context")}` : ""}`,
};

const addonScreen: ToolDef = {
  kind: "ai", id: "pe-addon-screen", title: "Add-on acquisition screen", tagline: "Bolt-on candidates for a platform, with the multiple arbitrage and integration order.",
  description: "Screens for add-on targets around an existing platform, which now account for roughly three quarters of North American sponsor deal count: defines the acquisition criteria from the platform's gaps, finds candidates through SEC full-text search, Form D, the startup directory and web research, and sizes each one's accretion including the multiple arbitrage between the platform's entry multiple and the add-on price.",
  roles: ["pe", "corpfin"], category: "Sourcing & deals", icon: "Network", deliverable: "table", savesMinutes: 240, tags: ["add-on", "buy-and-build", "pipeline"], effort: "high",
  fields: [
    { key: "platform", label: "Platform description", type: "text", required: true, placeholder: "e.g. Southeast US commercial HVAC service platform, $249mm revenue, 6 branches" },
    { key: "criteria", label: "Acquisition criteria", type: "textarea", required: true, placeholder: "Geography, revenue and EBITDA range, service mix, owner situation, what we will not buy" },
    { key: "platformEbitda", label: "Platform EBITDA", type: "number", unit: "$mm", default: 33.4 }, { key: "platformMultiple", label: "Platform entry multiple", type: "number", unit: "x", default: 10 },
    { key: "targetMultiple", label: "Expected add-on multiple", type: "number", unit: "x", default: 6.5 }, { key: "count", label: "Candidates", type: "number", default: 12, min: 5, max: 25 },
  ],
  example: {
    platform: "Southeast US commercial HVAC and mechanical service platform, $249mm revenue, 6 branches in GA, TN, NC, SC",
    criteria: "Owner-operated commercial HVAC or mechanical contractors in NC, SC, TN, AL, FL panhandle; $2-8mm EBITDA; at least 30% recurring maintenance revenue; no residential; no heavy new-construction exposure; owner willing to stay 12-24 months; no union shops",
    platformEbitda: 33.4, platformMultiple: 10, targetMultiple: 6.5, count: 12,
  },
  instructions: `1. Convert the criteria into a screen with hard gates and soft preferences, and state the disqualifiers explicitly (residential exposure, new-construction concentration, union shops, owner unwilling to transition). Say what a candidate must have to be worth a call.
2. Find candidates from several independent sources and label the source for each: search_companies and get_company_financials for listed or formerly listed operators and divisions that could be carve-outs; edgar_fulltext_search with the sector words plus phrases like "asset purchase agreement", "membership interest purchase agreement" and the geography, forms ["8-K","10-K"], to surface acquirers and named private operators inside filings; form_d_search on the sector and regional names for private raises; search_startups for technology-enabled entrants; web_research for trade association member lists, regional business journal rankings ("largest mechanical contractors in Charlotte"), and licence registries. Report only named companies with a traceable signal.
3. Estimate scale for each candidate from whatever evidence exists (headcount, branch count, licence class, revenue per technician benchmarks from the platform, press mentions) and mark every estimate as an estimate with its basis.
4. Size the economics with calc for each candidate and in aggregate: purchase price at the expected add-on multiple, EBITDA acquired, synergies you would underwrite (usually procurement, overhead elimination and pricing convergence, not revenue), pro forma platform EBITDA, and the value created by multiple arbitrage = EBITDA acquired x (platform multiple - add-on multiple) plus the synergy value at the platform multiple. Show pro forma leverage if the add-ons are debt-funded at the platform's structure and flag when the delayed-draw capacity runs out.
5. Order the pipeline: rank by fit, size, integration difficulty and owner readiness, and propose the sequence with the reason (a first add-on that proves the integration playbook beats the largest one).
Produce: kpis (candidates found, aggregate EBITDA in the pipeline, average estimated multiple, value created by arbitrage, pro forma platform EBITDA if all close); table "Add-on pipeline" (Company, Location, Estimated revenue, Estimated EBITDA, Fit, Source and signal, Owner situation, Priority); score block on the top 5 against the criteria; bar of EBITDA acquired by candidate; waterfall from platform EBITDA to pro forma EBITDA; bullets "Integration playbook" (what happens in the first 180 days of each add-on); nextSteps (outreach order and who calls); caveats on estimated private financials.`,
  prompt: (i) => `Find ${num(i, "count", 12)} add-on candidates for: ${str(i, "platform")}. Platform EBITDA $${num(i, "platformEbitda", 0)}mm at ${num(i, "platformMultiple", 10)}x; expect to pay ${num(i, "targetMultiple", 6.5)}x.\n\nCriteria: ${str(i, "criteria")}`,
};

const portfolioMonitoring: ToolDef = {
  kind: "ai", id: "pe-portfolio-monitoring", title: "Portfolio monitoring review", tagline: "Paste the KPI export; get the exception report the deal teams need to act on.",
  description: "Turns a portfolio KPI export into the monthly monitoring pack: performance against budget and prior year by company, leverage and liquidity, covenant headroom, the exceptions that need a deal-team response, and the portfolio roll-up with value-creation-plan progress. Ranks companies by the gap between plan and reality rather than by size.",
  roles: ["pe"], specialties: ["Middle-market buyout", "Large-cap buyout", "Growth equity", "Private credit / direct lending"],
  category: "Portfolio", icon: "Gauge", deliverable: "analysis", savesMinutes: 180, tags: ["portfolio", "monitoring", "KPIs"], effort: "medium",
  fields: [
    { key: "kpis", label: "Portfolio KPI export", type: "csv", required: true, columns: "company, period, revenue_ltm, revenue_budget, ebitda_ltm, ebitda_budget, ebitda_py, net_debt, cash, revolver_available, covenant_leverage_max, invested_equity, current_mark", help: "One row per company per period; extra columns are used if present" },
    { key: "period", label: "Reporting period", type: "text", required: true, placeholder: "Q3 2026" },
    { key: "focus", label: "Emphasis", type: "select", options: ["Exception report", "Board-pack roll-up", "Liquidity and covenants", "Value creation progress"], default: "Exception report" },
  ],
  example: {
    period: "Q3 2026", focus: "Exception report",
    kpis: `company,period,revenue_ltm,revenue_budget,ebitda_ltm,ebitda_budget,ebitda_py,net_debt,cash,revolver_available,covenant_leverage_max,invested_equity,current_mark
Meridian Mechanical,Q3 2026,254.1,262.0,34.8,37.5,31.2,128.4,9.1,20.0,5.50,241.0,268.0
Calder Packaging,Q3 2026,412.6,398.0,61.9,58.4,55.1,281.0,14.2,35.0,5.25,196.0,305.0
Northbridge Software,Q3 2026,88.4,102.0,12.1,21.0,14.9,96.5,6.8,5.0,6.00,142.0,96.0
Harbor Point Dental,Q3 2026,176.2,171.0,29.4,28.1,24.6,151.0,4.9,10.0,6.25,118.0,164.0
Vela Logistics,Q3 2026,331.8,345.0,38.2,44.0,42.7,214.0,7.6,15.0,5.00,151.0,138.0
Ridgeline Aggregates,Q3 2026,208.9,205.0,58.1,56.0,51.4,232.0,11.3,25.0,5.75,171.0,246.0`,
  },
  instructions: `1. Parse the CSV and normalize whatever column names appear. For each company compute with calc: revenue and EBITDA versus budget in dollars and percent, EBITDA versus prior year, EBITDA margin and the margin change, net leverage (net debt / LTM EBITDA), the covenant cushion in both turns and dollars of EBITDA (required EBITDA = net debt / covenant maximum; cushion = LTM EBITDA - required EBITDA), total liquidity (cash plus revolver availability) and liquidity as months of EBITDA, and the mark as a multiple of invested equity. Say when a column is missing rather than guessing.
2. Rank by exception severity, not size: a company inside 15% of budget with cushion above 25% is green; below budget with cushion between 10% and 25% is amber; a cushion under 10%, a leverage above the covenant maximum, negative EBITDA momentum against prior year, or liquidity under three months of EBITDA is red. Give every company a status and the one number that determines it.
3. For each red and amber company write the diagnosis and the required action: whether the shortfall is revenue or margin, whether it is a mix or a cost problem, what the lender conversation looks like (equity cure, amendment, covenant reset, sponsor support letter), and what the deal team must bring to the next portfolio review.
4. Roll up the portfolio: total invested equity, total current mark, gross unrealized MOIC, weighted average net leverage, aggregate EBITDA versus budget, and the concentration of value in the top two positions. Note how much of the mark is carried above cost and what supports it.
5. Where a company's business has a listed comparable, use get_company_financials or get_trading_comps on that peer to sanity-check whether the shortfall is company-specific or a sector move, and say which it is. Use search_filing on the peer's latest 10-Q for demand commentary when the pattern looks sector-wide.
Produce: callout with the one company that needs attention this week and why; kpis (companies reporting, aggregate EBITDA vs budget, weighted net leverage, positions with cushion under 15%, gross unrealized MOIC); table "Portfolio scorecard" (Company, LTM revenue, vs budget, LTM EBITDA, vs budget, vs PY, Net leverage, Covenant cushion, Liquidity, Mark / cost, Status) sorted worst first; bar of EBITDA variance to budget by company; scatter of net leverage versus EBITDA growth; risks (the red positions with severity and mitigation); checklist "Actions before the next portfolio review" with owners; nextSteps; caveats on unaudited management figures and definitional differences between companies.`,
  prompt: (i) => `Produce the ${str(i, "period")} portfolio monitoring review, emphasis: ${str(i, "focus", "Exception report")}.`,
};

const exitAnalysis: ToolDef = {
  kind: "ai", id: "pe-exit-analysis", title: "Exit route analysis", tagline: "IPO versus strategic sale versus sponsor-to-sponsor versus recap, priced off public comps.",
  description: "Compares the exit routes for a portfolio company on the terms that decide between them: the valuation each route supports from live public comps and precedent transactions, proceeds and liquidity timing, execution risk and conditionality, the residual stake and lock-up, and the IRR and DPI each produces. Includes the continuation-vehicle and dividend-recap alternatives that now absorb a share of exit activity.",
  roles: ["pe", "banker"], category: "Valuation", icon: "Split", deliverable: "analysis", savesMinutes: 270, tags: ["exit", "IPO", "sale", "recap"], effort: "high",
  fields: [
    { key: "company", label: "Portfolio company", type: "text", required: true }, { key: "peers", label: "Public comps", type: "tickers", required: true, placeholder: "FIX EME IESC POWL" },
    { key: "ebitda", label: "LTM EBITDA", type: "number", unit: "$mm", required: true, default: 51 }, { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", default: 320 },
    { key: "netDebt", label: "Net debt", type: "number", unit: "$mm", default: 96 }, { key: "equityBasis", label: "Sponsor equity basis", type: "number", unit: "$mm", default: 241 },
    { key: "yearsHeld", label: "Years held", type: "number", unit: "years", default: 4.5 },
    { key: "routes", label: "Routes to compare", type: "multiselect", options: ["IPO", "Strategic sale", "Sponsor-to-sponsor", "Dividend recap", "Continuation vehicle", "Minority stake sale"], default: ["IPO", "Strategic sale", "Sponsor-to-sponsor", "Dividend recap"] },
  ],
  example: { company: "Meridian Mechanical Services", peers: ["FIX", "EME", "IESC", "POWL"], ebitda: 51, revenue: 320, netDebt: 96, equityBasis: 241, yearsHeld: 4.5, routes: ["IPO", "Strategic sale", "Sponsor-to-sponsor", "Dividend recap"] },
  instructions: `1. Set the valuation anchors from live data. Call get_trading_comps on the peers for EV/LTM EBITDA and EV/Revenue with the median and range, and get_company_financials on the two closest peers for margin and growth comparability. Then find transaction anchors with edgar_fulltext_search: "agreement and plan of merger" plus the sector words, forms ["DEFM14A","8-K","S-4"], and read_document for "enterprise value", "per share" and "premium". State the trading and transaction ranges separately; strategics pay for synergies and sponsors pay for the return.
2. For an IPO route, find the comparable recent listings with edgar_fulltext_search on forms ["424B4","S-1"] plus the sector words, and read_document for "shares of common stock", "initial public offering price", "use of proceeds" and "lock-up". Price the IPO at a discount to the trading comps (an IPO discount is normal), model the primary/secondary split, the residual sponsor stake, the 180-day lock-up and the staged sell-down, and be explicit that the sponsor does not get full liquidity at pricing.
3. Compute each route with calc: EV at the route's multiple, equity proceeds = EV - net debt, proceeds to the sponsor net of a management pool if one exists, fees (advisory, underwriting, financing), the cash received at close versus later, MOIC on the equity basis, and IRR from the years held plus the time to liquidity for each tranche. For the dividend recap, size the debt at the leverage the market supports, take out fees, and show it as a partial realization that resets leverage and extends the hold. For a continuation vehicle, show the NAV reference price, the discount a secondary buyer would want, and the fact that the sponsor's own carry and the LP's roll-or-cash election are the real negotiation.
4. Score execution: conditionality and financing risk, timeline to close, disclosure and diligence burden, market-window dependence, antitrust or regulatory review, management distraction and retention, and the residual exposure the sponsor keeps. Say which route survives a weak market window.
5. Recommend one route with the trigger conditions that would change the answer, and name the preparation each route needs to start now (audit quality, carve-out financials, S-1 readiness, add-on integration completion, management team depth).
Produce: callout with the recommended route and the trigger that would change it; kpis (LTM EBITDA, comp median multiple, best-route EV, equity proceeds, MOIC, IRR); table "Route comparison" (Route, Multiple, EV, Equity proceeds, Cash at close, Fees, MOIC, IRR, Time to close, Execution risk); bar of equity proceeds by route; table "Valuation anchors" (trading comps, precedent transactions, recent IPOs with sources); sensitivity of MOIC across exit multiple and net debt; risks; checklist "Exit readiness"; nextSteps; caveats on un-calendarized comps and on IPO proceeds being staged.`,
  prompt: (i) => `Compare exit routes for ${str(i, "company")}: $${num(i, "ebitda", 0)}mm LTM EBITDA, $${num(i, "revenue", 0)}mm revenue, $${num(i, "netDebt", 0)}mm net debt, $${num(i, "equityBasis", 0)}mm equity basis, held ${num(i, "yearsHeld", 0)} years. Comps: ${list(i, "peers").join(", ")}. Routes: ${list(i, "routes").join(", ")}.`,
};

const lpQuarterlyReport: ToolDef = {
  kind: "ai", id: "pe-lp-quarterly-report", title: "LP quarterly report drafter", tagline: "The quarterly letter and performance summary, drafted from the portfolio and mark data.",
  description: "Drafts the quarterly LP report from a portfolio and cash-flow export: the fund performance summary (called, distributed, NAV, DPI, RVPI, TVPI, net IRR), the portfolio review company by company with what changed in the quarter, new investments and realizations, mark movements with the valuation basis under ASC 820, and the market commentary. Written in the restrained register LPs expect, with every number reconciled to the schedule.",
  roles: ["pe"], category: "Reporting", icon: "Mail", deliverable: "memo", savesMinutes: 300, tags: ["LP", "quarterly", "reporting", "ILPA"], effort: "high",
  fields: [
    { key: "fund", label: "Fund", type: "text", required: true, placeholder: "e.g. Ridge Lane Capital Partners IV, L.P." }, { key: "quarter", label: "Quarter", type: "text", required: true, placeholder: "Q3 2026" },
    { key: "positions", label: "Portfolio and cash flows", type: "csv", required: true, columns: "company, invested_date, invested_equity, current_mark, prior_mark, realized_proceeds, valuation_basis, ebitda_ltm, net_debt, status", help: "One row per position; add a TOTALS or FUND row for called and distributed capital if you have it" },
    { key: "fundFacts", label: "Fund-level facts", type: "textarea", placeholder: "Commitments, called to date, distributed to date, NAV, management fee, hurdle, any subsequent events" },
    { key: "tone", label: "Emphasis", type: "select", options: ["Standard quarterly letter", "Liquidity and DPI focus", "Fundraising-adjacent", "Annual meeting prep"], default: "Standard quarterly letter" },
  ],
  example: {
    fund: "Ridge Lane Capital Partners IV, L.P.", quarter: "Q3 2026", tone: "Liquidity and DPI focus",
    fundFacts: "Commitments $850mm; called to date $612mm (72%); distributed to date $284mm; NAV at 9/30/26 $781mm; 2% management fee on commitments stepping to 1.5% of invested capital after the investment period ended 6/30/26; 8% preferred return, 20% carry, European waterfall; GP commit 2%. Subsequent event: signed LOI to sell Ridgeline Aggregates at 11.5x LTM EBITDA, expected to close in Q1 2027.",
    positions: `company,invested_date,invested_equity,current_mark,prior_mark,realized_proceeds,valuation_basis,ebitda_ltm,net_debt,status
Meridian Mechanical,2022-10-15,241.0,268.0,262.0,0,Comparable company multiple,34.8,128.4,Active
Calder Packaging,2021-06-30,196.0,305.0,292.0,45.0,Comparable company multiple,61.9,281.0,Active
Northbridge Software,2022-03-01,142.0,96.0,118.0,0,DCF and comps blend,12.1,96.5,Watch
Harbor Point Dental,2023-09-12,118.0,164.0,158.0,0,Comparable company multiple,29.4,151.0,Active
Vela Logistics,2021-11-05,151.0,138.0,151.0,0,Comparable transaction multiple,38.2,214.0,Watch
Ridgeline Aggregates,2020-08-20,171.0,246.0,238.0,62.0,Signed LOI,58.1,232.0,Exiting`,
  },
  instructions: `1. Reconcile the numbers first and show the arithmetic with calc: total invested equity, total current mark, total realized proceeds, gross unrealized and realized MOIC, and, from the fund facts, paid-in capital, distributions, NAV, DPI = distributions / paid-in, RVPI = NAV / paid-in, TVPI = DPI + RVPI. Compute net IRR only if dated cash flows are provided; otherwise state that it is reported from the administrator and label it as such. Never present a performance metric you could not derive from the data given.
2. Write the portfolio review company by company, in order of value: what happened operationally this quarter in one or two sentences, the mark and the change from the prior quarter with the reason (earnings growth, multiple movement in the comp set, leverage change, a signed transaction), the valuation basis as disclosed in the export, and leverage. For marks moved by comps, call get_trading_comps on the relevant listed peers and cite the multiple movement as the support an auditor will look for under ASC 820; for a signed LOI, say the mark is calibrated to the transaction price and note the conditions.
3. Handle markdowns directly and early rather than burying them. For each write-down state the cause, what the sponsor is doing, what would have to be true to recover the basis, and whether more capital is contemplated. LPs treat an unexplained markdown as a governance problem.
4. Address liquidity explicitly, since distributions have run near 14% of NAV industry-wide for several years and holds have stretched toward seven years: DPI to date, distributions in the quarter, the realization pipeline with expected timing, and what the fund is doing to create liquidity (sale processes, recaps, continuation vehicles, secondary sales). Do not promise timing you were not given.
5. Add short market commentary grounded in evidence, not adjectives: use web_research for current entry multiples, leverage and financing costs, and edgar_fulltext_search on recent DEFM14A or 424B4 filings in the fund's sectors for evidence of where exit markets are pricing. Keep it to one paragraph that connects to the portfolio.
Produce: kpis (paid-in, distributed, NAV, DPI, TVPI, gross MOIC); markdown "Letter from the General Partner" (4-6 short paragraphs in the selected emphasis); table "Fund performance summary"; table "Portfolio summary" (Company, Invested date, Invested, Prior mark, Current mark, Change, Realized, Basis, Net leverage, Status) with totals; waterfall of NAV movement from prior quarter (earnings, multiple, leverage, realizations, new investments); bar of mark / cost by position; markdown "Portfolio review" with a short section per company; markdown "Realizations and liquidity"; markdown "Market commentary"; timeline of subsequent events; caveats on valuation judgement, unaudited figures and the administrator-reported metrics.`,
  prompt: (i) => `Draft the ${str(i, "quarter")} LP report for ${str(i, "fund")}. Emphasis: ${str(i, "tone", "Standard quarterly letter")}.${str(i, "fundFacts") ? `\n\nFund facts: ${str(i, "fundFacts")}` : ""}`,
};

const privateCreditMemo: ToolDef = {
  kind: "ai", id: "pe-private-credit-memo", title: "Private credit investment memo", tagline: "The lender's memo: cash flow coverage, downside recovery, documentation, and pricing.",
  description: "Drafts the direct-lending credit memo in the order a credit committee reads it: the borrower and sponsor, the facility and pricing, the credit statistics through the cycle, the cash-flow and covenant analysis, the downside and recovery case at a stressed multiple, documentation and structural protections, and the recommendation with conditions. Public comps and credit agreements from EDGAR supply the benchmarks.",
  roles: ["pe"], specialties: ["Private credit / direct lending"],
  category: "Credit & restructuring", icon: "Shield", deliverable: "memo", savesMinutes: 300, tags: ["private credit", "unitranche", "credit memo"], effort: "high",
  fields: [
    { key: "borrower", label: "Borrower", type: "text", required: true, placeholder: "e.g. Meridian Mechanical Services (Ridge Lane Capital)" },
    { key: "facility", label: "Facility and terms", type: "textarea", required: true, placeholder: "Size, structure, pricing, tenor, amortization, covenants, fees, undrawn commitments" },
    { key: "financials", label: "Borrower financials", type: "textarea", required: true, placeholder: "Revenue, EBITDA (reported and adjusted), capex, NWC, leverage, interest, FCF, seasonality" },
    { key: "peers", label: "Public comps", type: "tickers", placeholder: "FIX EME IESC", help: "Used for through-cycle margin and downside multiples" }, { key: "stress", label: "Downside EBITDA decline", type: "number", unit: "%", default: 25 },
  ],
  example: {
    borrower: "Meridian Mechanical Services (sponsor: Ridge Lane Capital Partners IV)", peers: ["FIX", "EME", "IESC"], stress: 25,
    facility: "$134mm first-lien unitranche plus $20mm delayed draw for add-ons and a $25mm revolver (undrawn at close, 50bps commitment fee). SOFR + 525bps with a 1.00% floor, 2.0 points OID, 1% annual amortization, 75% cash flow sweep stepping to 50% below 3.5x, 101 soft call for 12 months. Single financial covenant: net leverage of 5.50x tested quarterly, stepping to 5.00x after year two, with an equity cure right (two cures, not consecutive). Tenor 6 years.",
    financials: "LTM Jun-2026 revenue $248.7mm, reported EBITDA $24.1mm, sponsor-adjusted $35.9mm, QoE-supported $33.4mm. Capex 1.8% of revenue. NWC 12.5% of revenue with Q1 seasonal build of roughly $9mm. Entry net leverage 4.0x on QoE EBITDA. Cash interest at close approximately $13.4mm. Recurring maintenance 38% of revenue, project 62%. Top customer 17%, top 5 46%. Backlog $141mm.",
  },
  instructions: `1. State the credit in one paragraph before any analysis: borrower, sponsor, facility, leverage, pricing, the two things that make it money good and the one thing that would break it.
2. Build the credit statistics from the pasted financials with calc, on the EBITDA you believe rather than the sponsor's: entry total and first-lien net leverage, EBITDA to cash interest, (EBITDA - capex) to cash interest, fixed charge coverage = (EBITDA - capex - taxes) / (cash interest + scheduled amortization), free cash flow after debt service, and FCF as a percentage of funded debt. Show the seasonal peak working capital draw against the revolver and whether the revolver is big enough.
3. Benchmark the structure against the market with evidence, not assertion: use edgar_fulltext_search with phrases like "Consolidated EBITDA" plus "Available Amount", or "Consolidated Net Leverage Ratio", forms ["8-K","10-K","10-Q"] and exhibit text, to read recent credit agreements from comparable borrowers, and read_document for the EBITDA definition, addback caps, restricted payments, permitted acquisitions and incremental / accordion capacity. Compare the proposed pricing and leverage against current market terms (unitranche at SOFR + 475-550, all-in around 9%, total leverage 4.0-5.5x, sponsor equity 40-60%) and say where this deal sits.
4. Run the downside: apply the stress decline to EBITDA, hold capex and interest, re-test every covenant and coverage ratio by year, and say in which quarter the covenant breaks and what the cure or amendment looks like. Then run recovery: value the enterprise at a distressed multiple anchored to the public comps' trough multiples (get_trading_comps and search_filing on a peer's 10-K for the worst recent cycle), subtract the facility, and state first-lien recovery as a percentage. Attachment and detachment points matter more than the spread.
5. Interrogate the documentation: the EBITDA definition and add-back cap, the equity cure mechanics and limits, incremental and ratio debt capacity, restricted payments and dividend capacity, asset sale and prepayment provisions, transfer restrictions, MFN protection, the sweep step-downs, and any J. Crew or Serta style value-leakage risk. Name the three changes you would require.
Produce: callout with the recommendation and conditions; kpis (facility size, entry leverage, all-in yield, interest coverage, FCCR, downside recovery); table "Facility and pricing"; table "Credit statistics" by year (base case) with covenant levels alongside; table "Downside case" with the covenant test result per quarter or year; bar of leverage through the case with the covenant as a reference line; markdown "Recovery analysis" with the multiple and the waterfall; risks (5-7 with severity); checklist "Documentation requirements"; nextSteps; caveats on the EBITDA definition used and on unaudited borrower figures.`,
  prompt: (i) => `Draft the credit memo for ${str(i, "borrower")}, stressing EBITDA down ${num(i, "stress", 25)}%.${list(i, "peers").length ? ` Comps: ${list(i, "peers").join(", ")}.` : ""}\n\nFacility: ${str(i, "facility")}\n\nFinancials: ${str(i, "financials")}`,
};

const creditAgreementTerms: ToolDef = {
  kind: "ai", id: "pe-credit-agreement-terms", title: "Credit agreement term extraction", tagline: "Pull the EBITDA definition, covenants, baskets and leakage risk out of the real documents.",
  description: "Finds and reads credit agreements and indentures filed as exhibits on EDGAR for comparable borrowers and extracts the terms that determine how much a document actually allows: the Consolidated EBITDA definition and its add-back cap, financial covenants and step-downs, incremental and ratio debt, restricted payments and available amount baskets, asset sale and prepayment mechanics, and the transfer and MFN provisions that protect or expose a lender.",
  roles: ["pe"], specialties: ["Private credit / direct lending", "Middle-market buyout", "Large-cap buyout"],
  category: "Credit & restructuring", icon: "ScrollText", deliverable: "table", savesMinutes: 240, tags: ["credit agreement", "covenants", "documentation"], effort: "high",
  fields: [
    { key: "ticker", label: "Borrower or comparable", type: "ticker", required: true, placeholder: "CHTR", help: "A listed issuer whose credit agreement is filed as an exhibit" },
    { key: "peers", label: "Additional comparables (optional)", type: "tickers", placeholder: "WBD CCL SATS" },
    { key: "terms", label: "Terms to extract", type: "multiselect", options: ["Consolidated EBITDA definition and add-back cap", "Financial covenants and step-downs", "Incremental / accordion and ratio debt", "Restricted payments and available amount", "Asset sales and mandatory prepayment", "Cash sweep and excess cash flow", "Equity cure", "Permitted acquisitions and investments", "MFN and transfer restrictions", "Unrestricted subsidiary designation"], default: ["Consolidated EBITDA definition and add-back cap", "Financial covenants and step-downs", "Incremental / accordion and ratio debt", "Restricted payments and available amount", "Cash sweep and excess cash flow"] },
  ],
  example: { ticker: "CHTR", peers: ["WBD", "SATS"], terms: ["Consolidated EBITDA definition and add-back cap", "Financial covenants and step-downs", "Incremental / accordion and ratio debt", "Restricted payments and available amount", "Cash sweep and excess cash flow", "Unrestricted subsidiary designation"] },
  instructions: `1. Locate the documents. Call get_recent_filings on the ticker with forms ["8-K","10-K","10-Q","S-4"] and look for material agreement items (1.01) and exhibit indices; then run edgar_fulltext_search restricted to the entity with phrases that only appear in loan documents: "Consolidated Net Leverage Ratio", "Available Amount", "Restricted Payment", "Incremental Facility", "Excess Cash Flow", "Consolidated EBITDA" and "Credit Agreement dated as of". Collect the document URLs from the hits and prefer the most recent amendment and restatement; when documents disagree, the most recent filing wins.
2. Read each document with read_document using the defined term as the query, then expand around the hit with an offset read: the definition of Consolidated EBITDA (list every permitted add-back and the cap on projected synergies and cost savings, usually expressed as a percentage of EBITDA and a look-forward period), Consolidated Net Leverage Ratio and any First Lien or Secured ratio, the financial covenant levels and step-down dates, springing covenant triggers tied to revolver utilization, the Incremental Facility and ratio debt capacity with MFN protection and sunset, Restricted Payments with the Available Amount / builder basket and its starter amount, Excess Cash Flow sweep percentages and step-downs, mandatory prepayment from asset sales with reinvestment rights, equity cure mechanics and limits, Permitted Investments including any unrestricted subsidiary designation capacity, and assignment and disqualified lender provisions.
3. Quote the operative language for each term, short and exact, with the source id, and then restate it in one plain sentence saying what it permits in dollars at the borrower's current EBITDA. Use get_company_financials or get_xbrl_series for EBITDA and debt so the baskets can be sized, and calc to convert every ratio-based capacity into dollars.
4. Compare across the comparables where more than one ticker is given, and rank them by borrower friendliness on each dimension. Flag the structural leakage risks explicitly: uncapped add-backs, unrestricted subsidiary designation with IP transfer capacity, liability management exposure, weak MFN, generous builder baskets, and no lender-consent transfer restrictions.
5. Where a term cannot be found in the filed documents, say so; do not substitute market convention for the document.
Produce: callout with the single most borrower-friendly and most lender-friendly feature found; table "Term extraction" (Term, Document and section, Operative language, What it permits in dollars, Borrower-friendly?) ; table "Comparison across borrowers" when peers were given; bullets "Leakage and liability management risk"; bullets "Changes we would require in our own paper"; timeline of the amendments read; nextSteps; caveats naming every term that could not be located and the filing date of each document used.`,
  prompt: (i) => `Extract credit agreement terms for ${str(i, "ticker").toUpperCase()}${list(i, "peers").length ? ` and compare with ${list(i, "peers").join(", ")}` : ""}. Focus on: ${list(i, "terms").join("; ")}.`,
};

const lenderPackage: ToolDef = {
  kind: "ai", id: "pe-lender-package", title: "Lender package builder", tagline: "The financing memo and bank grid: credit stats, the lender case, and who to call.",
  description: "Builds the financing package a sponsor sends to banks and private credit funds: the transaction overview and sources and uses, the lender case with the credit statistics that matter to a committee, the covenant proposal with headroom, the downside case, and a lender grid of realistic structures and pricing benchmarked against recent comparable financings found in EDGAR exhibits.",
  roles: ["pe"], specialties: ["Private credit / direct lending", "Middle-market buyout", "Large-cap buyout", "Infrastructure & real assets"],
  category: "Capital markets", icon: "Landmark", deliverable: "deck", savesMinutes: 270, tags: ["financing", "lenders", "leverage"], effort: "high",
  fields: [
    { key: "company", label: "Borrower", type: "text", required: true }, { key: "ebitda", label: "EBITDA (our case)", type: "number", unit: "$mm", required: true, default: 33.4 },
    { key: "ev", label: "Purchase EV", type: "number", unit: "$mm", required: true, default: 359 }, { key: "targetLeverage", label: "Target total leverage", type: "number", unit: "x", default: 4.5 },
    { key: "structure", label: "Preferred structure", type: "select", options: ["Unitranche", "Bank TLB plus revolver", "First lien / second lien", "Unitranche plus delayed draw", "Club of private credit funds"], default: "Unitranche plus delayed draw" },
    { key: "details", label: "Business and plan", type: "textarea", required: true, placeholder: "Business model, revenue quality, capex, seasonality, add-on program, management, sponsor equity" },
    { key: "peers", label: "Public comps", type: "tickers", placeholder: "FIX EME IESC" },
  ],
  example: {
    company: "Meridian Mechanical Services", ebitda: 33.4, ev: 359, targetLeverage: 4.5, structure: "Unitranche plus delayed draw", peers: ["FIX", "EME", "IESC"],
    details: "Commercial HVAC and mechanical services, 6 branches in the Southeast, 38% recurring maintenance revenue with a 94% renewal rate, 62% project with $141mm of contracted backlog. Capex 1.8% of revenue. Q1 working capital build of roughly $9mm. Plan: 4 add-ons at 6-7x funded from a $20mm delayed draw, price realization of 4-5% annually, recurring mix to 55%. Sponsor equity $241mm including $12mm CFO rollover, 8% MIP struck at cost.",
  },
  instructions: `1. Build sources and uses with calc at the target leverage: purchase EV, refinanced debt, minimum cash, transaction fees (about 2% of EV) and financing fees (about 2% of debt), funded by each tranche and sponsor equity as the plug. Report sponsor equity in dollars and as a percentage of total capitalization; the current market is 40-60% equity, so say where this sits.
2. Write the lender case, not the sponsor case: start from QoE-supported EBITDA, show the credit statistics by year (total and first lien net leverage, EBITDA / cash interest, (EBITDA - capex) / cash interest, FCCR, FCF after debt service, FCF / funded debt), and be explicit about which growth in the plan the lender is being asked to underwrite versus which is upside. Include the seasonal peak revolver draw and the liquidity available at the low point.
3. Benchmark structure and pricing against real recent financings rather than assertion: run edgar_fulltext_search with phrases like "Credit Agreement dated as of" plus the sector words, or "unitranche" and "SOFR plus", forms ["8-K","10-K"], and read_document for the tranche sizes, spreads, floors, OID, amortization, sweep and covenant levels. Use get_trading_comps and get_company_financials on the public comps to show the sector's margin stability and capex intensity, which is what a committee uses to justify leverage.
4. Propose the covenant package and prove the headroom: a single net leverage maintenance covenant set 30-35% above the model case is the market norm for a sponsor unitranche; compute the EBITDA cushion in dollars and the percentage decline that triggers a breach at each test date, and state the equity cure terms you are asking for.
5. Build the lender grid: for each structure (unitranche, bank TLB plus revolver, first lien / second lien, club) give realistic leverage, pricing (SOFR plus spread, floor, OID), fees, amortization, sweep, covenant, flexibility for the add-on program, and the trade-off in one line. Name the lender types that do each structure at this size and what each will push back on.
Produce: kpis (EV, funded debt, total leverage, sponsor equity %, blended cost of debt, year-1 FCCR); table "Sources and uses" with totals; table "Lender case credit statistics" by year; table "Lender grid" (Structure, Leverage, Pricing, OID and fees, Amortization, Sweep, Covenant, Add-on capacity, Trade-off); bar of leverage by year against the proposed covenant as a reference; table "Comparable financings" with sources; bullets "Questions the committee will ask" and the answer to each; risks; nextSteps; caveats on pricing being indicative and on the EBITDA definition.`,
  prompt: (i) => `Build the lender package for ${str(i, "company")}: $${num(i, "ebitda", 0)}mm EBITDA, $${num(i, "ev", 0)}mm EV, target ${num(i, "targetLeverage", 4.5)}x, preferred structure ${str(i, "structure", "Unitranche")}.${list(i, "peers").length ? ` Comps: ${list(i, "peers").join(", ")}.` : ""}\n\n${str(i, "details")}`,
};

const mgmtMeetingPrep: ToolDef = {
  kind: "ai", id: "pe-mgmt-meeting-prep", title: "Management meeting prep", tagline: "The questions that decide the bid, ordered by what they would change.",
  description: "Prepares the management presentation session: the four or five questions whose answers change the price, a full question bank by function with the answer you expect and what a bad answer would mean, the numbers to tie out live, the tells to watch for, and the follow-up information request list. Built from the deal facts plus what listed operators in the same business disclose.",
  roles: ["pe"], specialties: ["Large-cap buyout", "Middle-market buyout", "Growth equity"],
  category: "Diligence", icon: "MessageSquare", deliverable: "checklist", savesMinutes: 150, tags: ["management meeting", "diligence", "questions"], effort: "medium",
  fields: [
    { key: "company", label: "Target", type: "text", required: true }, { key: "facts", label: "What we know", type: "textarea", required: true, placeholder: "CIM highlights, our concerns, the model assumptions we need to validate" },
    { key: "ticker", label: "Listed comparable", type: "ticker", placeholder: "FIX", help: "Used to know which disclosures are standard in this business" },
    { key: "attendees", label: "Who is presenting", type: "text", placeholder: "e.g. CEO (retiring), CFO (joined 2024), VP Operations" },
    { key: "stage", label: "Stage", type: "select", options: ["First management meeting", "Second round deep dive", "Confirmatory session"], default: "First management meeting" },
  ],
  example: {
    company: "Meridian Mechanical Services", ticker: "FIX", attendees: "Founder CEO (retiring at close), CFO (joined 2024), VP Operations, VP Service", stage: "First management meeting",
    facts: "CIM claims 14.4% adjusted EBITDA margin on $248.7mm revenue with $11.8mm of add-backs including $2.25mm of pro forma price increase and $1.9mm of acquisition run-rate. 38% recurring / 62% project mix, 94% maintenance renewal rate, top customer 17% on an MSA expiring Dec-2027, backlog $141mm. Six branches; one unionized. Our concerns: durability of the price increase, project margin volatility, no identified CEO successor, ERP half-implemented, 6-9 points of branch-level gross margin dispersion.",
  },
  instructions: `1. Start with the price-moving questions: identify the four or five open items where the answer changes your bid by more than half a turn, state the current assumption, the range the answer could move it to, and the specific question that resolves it. Everything else is secondary.
2. Build the question bank by function: commercial (pricing mechanism and customer reaction, win rates, contract terms, concentration and change-of-control clauses, backlog conversion and margin in backlog), operations (branch-level margin dispersion and its cause, technician recruitment and wage inflation, utilization, subcontractor mix), finance (revenue recognition on project work, percentage-of-completion estimates and true-ups, working capital seasonality and billing discipline, add-back substantiation, the ERP timeline), people (CEO succession, second-layer depth, retention and incentives, the union relationship and the last negotiation), and growth (add-on pipeline and how prior acquisitions performed, greenfield ramp economics, capacity constraints). For each question give the answer you expect, and the answer that would be a problem.
3. Know what standard disclosure looks like before the meeting: call get_company_financials on the listed comparable and search_filing on its 10-K for "backlog", "customer concentration", "service", "human capital", "collective bargaining" and segment margin, so you can tell management that public operators in this business report metrics they claim not to track, and cite it.
4. List the numbers to tie out live in the room, with the source and the arithmetic: adjusted EBITDA to the QoE bridge, backlog to revenue conversion, recurring revenue definition and the renewal rate calculation, NWC as a percentage of revenue, capex against fleet age, and revenue per technician against the peer.
5. Close with logistics: who asks what, the observation notes to take (who answers financial questions, whether the CFO owns the numbers, how management handles a challenged assumption), and the information request list to send within 24 hours.
Produce: callout with the single question that matters most; table "Price-moving questions" (Question, Current assumption, Range if the answer differs, Bid impact); qa "Question bank" (20-30 pairs, question and the answer we expect, grouped by function via the question text); checklist "Tie out live" with the source of each figure; bullets "Tells to watch"; table "Standard disclosure in this sector" from the listed comparable with citations; checklist "Information request list" with owners; nextSteps; caveats.`,
  prompt: (i) => `Prepare for the ${str(i, "stage", "first management meeting").toLowerCase()} with ${str(i, "company")}.${str(i, "attendees") ? ` Presenting: ${str(i, "attendees")}.` : ""}${str(i, "ticker") ? ` Listed comparable: ${str(i, "ticker").toUpperCase()}.` : ""}\n\nWhat we know: ${str(i, "facts")}`,
};

const growthEquityScreen: ToolDef = {
  kind: "ai", id: "pe-growth-equity-screen", title: "Growth equity investment screen", tagline: "Efficiency-adjusted growth against public comps, and what the round has to price at.",
  description: "Screens a growth-stage company the way a growth investor does: revenue quality and retention, efficiency (burn multiple, magic number, CAC payback, Rule of 40), the path to profitability, and the valuation the public comps support at exit after dilution. Uses live SEC data for the public comp set and pasted or cited company metrics for the target.",
  roles: ["pe"], specialties: ["Growth equity"],
  category: "Screening", icon: "Rocket", deliverable: "analysis", savesMinutes: 210, tags: ["growth equity", "SaaS metrics", "Rule of 40"], effort: "high",
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "metrics", label: "Company metrics", type: "textarea", required: true, placeholder: "ARR, growth, NRR/GRR, gross margin, net burn, S&M spend, CAC payback, headcount, cash, last round" },
    { key: "peers", label: "Public comps", type: "tickers", required: true, placeholder: "DDOG MDB NET GTLB" }, { key: "check", label: "Check size", type: "number", unit: "$mm", default: 75 },
    { key: "ownership", label: "Target ownership", type: "number", unit: "%", default: 18 }, { key: "exitYears", label: "Years to exit", type: "number", unit: "years", default: 5 },
  ],
  example: {
    company: "Lattice Data Systems", peers: ["DDOG", "MDB", "NET", "GTLB"], check: 75, ownership: 18, exitYears: 5,
    metrics: "ARR $42mm growing 78% year over year; NRR 121%, GRR 93%; gross margin 76%; net burn $18mm over the last twelve months; S&M $16mm in the last twelve months with net new ARR of $18.4mm; CAC payback 19 months; 214 employees; $31mm cash; last round a $28mm Series B at a $210mm post-money 19 months ago; top 10 customers 34% of ARR; 71% of ARR on annual contracts, 22% multi-year.",
  },
  instructions: `1. Compute the efficiency metrics from the pasted figures with calc and show each formula: growth rate, net and gross revenue retention, burn multiple = net burn / net new ARR, magic number = net new ARR (annualized from the period) / prior-period S&M, CAC payback in months = CAC / (ACV x gross margin) expressed monthly, Rule of 40 = growth % + FCF or EBITDA margin %, and the Rule of X weighting growth roughly 2x. State which figures the company did not provide and what you would need.
2. Anchor on the public comps with live data: call get_trading_comps on the peers and get_company_financials on the two closest, then compute each peer's growth, gross margin, FCF margin, Rule of 40 and EV/LTM revenue. Use search_filing on the peers' 10-Ks or 10-Qs for "net revenue retention", "remaining performance obligations", "customers" and "gross margin" so the target's retention and mix claims are measured against disclosed peer metrics rather than folklore. A growth-adjusted multiple (EV/revenue divided by growth, or a regression of EV/revenue on growth and margin) is the fair way to compare.
3. Judge revenue quality, not just growth: contract length and renewal mechanics, concentration, the gap between NRR and GRR (expansion masking churn), gross margin trajectory versus peers, and whether growth is being bought (rising CAC payback and burn multiple with flat magic number is the tell).
4. Build the return: entry valuation implied by the check and target ownership (post-money = check / ownership), the revenue path at a decaying growth rate (roughly 30% decay per year is the cloud benchmark), the exit multiple from the peer set applied to exit-year revenue with a discount for private-company liquidity, expected dilution from future rounds, and the resulting MOIC and IRR at exit. Test what growth and multiple are required for a 3x and say whether the path is credible.
5. State the structure question: primary versus secondary, liquidation preference, board and information rights, and what protection is appropriate given the burn and the runway. Say how many months of runway the check buys at the current burn.
Produce: callout with the verdict and the price at which it works; kpis (ARR, growth, NRR, burn multiple, Rule of 40, implied entry EV/ARR, peer median EV/revenue); table "Metrics versus benchmarks" (Metric, Company, Peer median, Percentile, Source); table "Public comps" with growth, margin, Rule of 40 and multiples; scatter of growth versus EV/revenue with the implied entry point emphasized; table "Return scenarios" (Case, Exit-year revenue, Exit multiple, Exit EV, Dilution, MOIC, IRR); risks; qa "Diligence questions" (6); nextSteps; caveats on self-reported metrics and definitional differences in NRR.`,
  prompt: (i) => `Screen ${str(i, "company")} for a $${num(i, "check", 0)}mm growth investment at ${num(i, "ownership", 0)}% ownership, ${num(i, "exitYears", 5)}-year horizon. Comps: ${list(i, "peers").join(", ")}.\n\nMetrics: ${str(i, "metrics")}`,
};

const sponsorActivityMap: ToolDef = {
  kind: "ai", id: "pe-sponsor-activity-map", title: "Sponsor activity map", tagline: "Who has been buying in your sector, at what price, with what structure.",
  description: "Maps sponsor activity in a sector from SEC evidence: the take-privates, add-ons and minority deals each firm has done, the multiples and premiums where they are disclosed, the financing structures used, and the pattern that tells you who will be in your auction and what they can pay. Built from merger proxies, 13E-3s, 8-Ks, 13D filings and the listed alternative managers' own disclosure.",
  roles: ["pe"], specialties: ["Large-cap buyout", "Middle-market buyout", "Secondaries"],
  category: "Research", icon: "Radar", deliverable: "research", savesMinutes: 210, tags: ["sponsors", "competitive", "sourcing"], effort: "high",
  fields: [
    { key: "sector", label: "Sector", type: "text", required: true, placeholder: "e.g. commercial and industrial services" },
    { key: "sponsors", label: "Sponsors to profile", type: "text", placeholder: "e.g. Thoma Bravo, Vista Equity Partners, Bain Capital", help: "Leave empty to let the search surface the most active firms" },
    { key: "from", label: "From", type: "date", default: "2023-01-01" },
    { key: "angle", label: "Use", type: "select", options: ["Who will bid against us", "Who to sell to", "Where the sector is pricing", "Partner and co-invest mapping"], default: "Who will bid against us" },
  ],
  example: { sector: "commercial and industrial services, HVAC and mechanical contracting", sponsors: "", from: "2023-01-01", angle: "Who will bid against us" },
  instructions: `1. Surface the active firms with edgar_fulltext_search across several phrasings and de-duplicate by sponsor: "affiliates of" plus the sector words in forms ["DEFM14A","SC 13E3"]; "equity commitment letter" plus the sector words; "portfolio company of" plus the sector words in forms ["8-K","10-K","S-1"]; and each named sponsor as query text in forms ["SC 13D","SC 13E3","DEFM14A"] if the sponsors field is filled. Sponsor names appear in document text rather than as filers, so query the body.
2. For each sponsor, build the deal list from documents you actually read: read_document on the proxies and 8-Ks for "per share", "premium", "enterprise value", "equity commitment", "debt commitment" and "rollover" to capture target, date, price, premium, EV, equity check and financing structure. Where the target filed with the SEC, use get_company_financials or get_xbrl_series and calc to compute EV/LTM EBITDA and EV/Revenue; mark NM where you cannot.
3. Add the listed alternative managers' own disclosure where relevant: get_company_financials and search_filing on the 10-K of firms such as KKR, BX, APO, CG, ARES, TPG or OWL for "dry powder", "capital commitments", "investment period" and sector commentary, to size who has capital to deploy and where their strategy sits. Use web_research for fund closes, sector team hires and public statements, and cite every source.
4. Derive the pattern rather than listing deals: each firm's typical check and EV band, sector niche, structure preference (all-equity minority, control with unitranche, public-to-private, carve-out), leverage used, hold length, whether they buy platforms or add-ons, and who they partner with. Then answer the selected angle directly: who bids against you and what they can pay at their return hurdle, or who buys from you and what they need to see.
5. Be honest about coverage: EDGAR only captures deals that touch a registrant, so private-to-private transactions are invisible unless a filing or a press release mentions them. State how many deals you verified from documents versus from web sources.
Produce: callout answering the selected angle in three sentences; kpis (sponsors identified, deals verified, median EV/EBITDA, median premium, median equity %); table "Sponsor activity" (Sponsor, Deals in window, Typical EV band, Sector niche, Structure and leverage, Most recent deal, Source); table "Deals" (Date, Target, Sponsor, EV, Multiple, Premium, Structure, Source); bar of deal count by sponsor; timeline of the transactions; bullets "What this means for our process"; nextSteps; caveats on EDGAR coverage of private deals.`,
  prompt: (i) => `Map sponsor activity in ${str(i, "sector")} since ${str(i, "from", "2023-01-01")}.${str(i, "sponsors") ? ` Profile: ${str(i, "sponsors")}.` : ""} Angle: ${str(i, "angle", "Who will bid against us")}.`,
};

const secondariesReview: ToolDef = {
  kind: "ai", id: "pe-secondaries-portfolio-review", title: "LP secondaries portfolio review", tagline: "Price an LP portfolio line by line: NAV quality, unfunded, and the bid that clears.",
  description: "Reviews an LP fund portfolio offered in the secondary market: rolls each position's NAV forward from the reference date, tests NAV quality against public comps and vintage benchmarks, assesses unfunded exposure and remaining fund life, and builds the bid by position with the discount each one justifies and the blended price for the portfolio.",
  roles: ["pe"], specialties: ["Secondaries", "Fund of funds / LP"],
  category: "Portfolio", icon: "Layers", deliverable: "analysis", savesMinutes: 300, tags: ["secondaries", "LP portfolio", "NAV"], effort: "high",
  fields: [
    { key: "positions", label: "Fund positions", type: "csv", required: true, columns: "fund, vintage, strategy, commitment, paid_in, unfunded, nav, distributions, reference_date, top_holdings", help: "One row per fund interest" },
    { key: "refDate", label: "NAV reference date", type: "date", default: "2026-06-30" }, { key: "targetIrr", label: "Target net IRR", type: "number", unit: "%", default: 17 },
    { key: "horizon", label: "Expected remaining life", type: "number", unit: "years", default: 5 },
  ],
  example: {
    refDate: "2026-06-30", targetIrr: 17, horizon: 5,
    positions: `fund,vintage,strategy,commitment,paid_in,unfunded,nav,distributions,reference_date,top_holdings
Cartwright Equity Partners V,2019,Large-cap buyout,40.0,38.1,3.9,31.4,22.6,2026-06-30,"industrial distribution, specialty chemicals"
Bell Harbor Growth III,2021,Growth equity,25.0,21.3,4.7,19.8,1.2,2026-06-30,"vertical SaaS, payments"
Arden Ridge Mid-Market IV,2018,Middle-market buyout,30.0,29.4,1.2,14.9,31.8,2026-06-30,"HVAC services, packaging"
Northfield Infrastructure II,2020,Infrastructure,35.0,30.2,5.8,36.1,8.4,2026-06-30,"contracted renewables, fiber"
Saltgrass Credit Opportunities III,2022,Private credit,20.0,16.8,3.2,17.9,4.1,2026-06-30,"sponsor unitranche"
Kestrel Technology Partners VI,2021,Large-cap buyout,45.0,36.0,9.0,38.2,2.8,2026-06-30,"infrastructure software, cyber"`,
  },
  instructions: `1. Normalize the CSV and compute per position with calc: DPI = distributions / paid-in, RVPI = NAV / paid-in, TVPI, NAV as a percentage of commitment, unfunded as a percentage of commitment, years since vintage, and remaining fund life against a ten-year term plus extensions. Total the portfolio and show the strategy and vintage mix.
2. Test NAV quality, which is the whole job. For each position use the top holdings and strategy to pick listed comparables, call get_trading_comps and get_company_financials on them, and ask whether public multiples have moved since the reference date: a NAV struck on June multiples is stale if the comp set has re-rated. Compare each fund's TVPI and DPI against vintage benchmarks (2010-2014 buyout vintages ran 1.8-2.2x TVPI and 1.4-1.8x DPI; 2019-2021 vintages 1.1-1.4x TVPI and 0.1-0.3x DPI; top-quartile IRR above 20%) and say where each fund sits. Flag funds whose RVPI is high and DPI near zero at year five, and funds whose NAV rests on a small number of assets.
3. Assess the unfunded separately: what it will be called for (add-ons and follow-ons versus new investments), whether the investment period has ended, and the drag it creates. Unfunded is a liability the buyer assumes, so price it.
4. Build the bid position by position: the discount or premium to rolled-forward NAV that the position justifies given NAV quality, remaining life, strategy, concentration and the expected distribution profile; then the cash flows (price at close, expected calls over the draw period, expected distributions over the remaining life) and the IRR and MOIC at that price. Solve for the price that delivers the target net IRR and show it as a percentage of NAV. Use the secondaries pricing calculator's convention: price against adjusted NAV, treat unfunded as future calls, and state the expected total value multiple on NAV you underwrote.
5. Rank the portfolio into buy, buy at a wider discount and pass, and say what you would strip out of a portfolio bid.
Produce: callout with the blended bid as a percentage of NAV and the two positions that drive it; kpis (total NAV, total unfunded, portfolio DPI, portfolio TVPI, blended bid % of NAV, implied IRR at the bid); table "Position analysis" (Fund, Vintage, Strategy, Paid-in, NAV, Unfunded, DPI, TVPI, NAV quality, Bid % of NAV, Implied IRR); bar of bid discount by position; scatter of vintage year versus DPI; table "Vintage benchmark comparison"; risks (concentration, stale marks, unfunded exposure); nextSteps; caveats on NAV staleness, on the absence of underlying company financials and on the sensitivity of the bid to the distribution profile assumed.`,
  prompt: (i) => `Review and price this LP secondary portfolio at a ${num(i, "targetIrr", 17)}% target net IRR, NAV reference date ${str(i, "refDate", "2026-06-30")}, ${num(i, "horizon", 5)} years of expected remaining life.`,
};

const continuationVehicle: ToolDef = {
  kind: "ai", id: "pe-continuation-vehicle", title: "Continuation vehicle analysis", tagline: "GP-led secondary: the reference price, the conflict, and whether LPs should roll or cash.",
  description: "Analyzes a GP-led continuation vehicle from both sides: the reference price against trading comps and precedent transactions, the structure (rollover economics, new carry and fee basis, deferred consideration, stapled primary), the conflicts a fairness opinion and LPAC process must address, and the roll-or-cash decision for an existing LP compared with the alternative of holding or selling in the open secondary market.",
  roles: ["pe"], specialties: ["Secondaries", "Fund of funds / LP"],
  category: "Valuation", icon: "ArrowLeftRight", deliverable: "analysis", savesMinutes: 240, tags: ["continuation vehicle", "GP-led", "secondaries"], effort: "high",
  fields: [
    { key: "asset", label: "Asset", type: "text", required: true, placeholder: "e.g. Calder Packaging (from Fund III into CV I)" }, { key: "peers", label: "Public comps", type: "tickers", required: true, placeholder: "PKG IP SEE SON" },
    { key: "terms", label: "Proposed terms", type: "textarea", required: true, placeholder: "Reference price and multiple, NAV, rollover option, new fee and carry, GP commitment, deferred consideration, stapled primary" },
    { key: "assetFacts", label: "Asset facts", type: "textarea", required: true, placeholder: "Revenue, EBITDA, growth, net debt, hold to date, remaining plan" },
    { key: "lens", label: "Point of view", type: "select", options: ["Existing LP deciding roll or cash", "Secondary buyer pricing the CV", "GP designing the structure"], default: "Existing LP deciding roll or cash" },
  ],
  example: {
    asset: "Calder Packaging, moving from Fund III into a single-asset continuation vehicle", peers: ["PKG", "IP", "SEE", "SON"], lens: "Existing LP deciding roll or cash",
    terms: "Reference price $305mm equity value, struck at 9.5x LTM EBITDA of $61.9mm less $281mm net debt; current Fund III NAV $305mm (so a par reference). Existing LPs may roll at par into the CV or take cash. New CV terms: 1.25% management fee on invested capital, 15% carry over an 8% hurdle, GP commit 3%, five-year term. Lead secondary buyer taking $180mm with 20% deferred over 18 months. Stapled primary of $75mm into Fund V.",
    assetFacts: "Corrugated and specialty packaging, $412.6mm LTM revenue, $61.9mm LTM EBITDA (15.0% margin) versus $55.1mm prior year, net debt $281mm (4.5x), invested equity $196mm in June 2021, realized $45mm from a 2024 dividend recap. Remaining plan: two bolt-ons in specialty coatings, a $28mm capacity project completing in 2027, price recovery as containerboard pricing normalizes.",
  },
  instructions: `1. Test the reference price independently before reading the GP's justification. Call get_trading_comps on the peers and get_company_financials on the two closest for EV/LTM EBITDA, margin and growth comparability; then find transaction anchors with edgar_fulltext_search ("agreement and plan of merger" plus the sector words, forms ["DEFM14A","8-K","S-4"]) and read_document for "enterprise value" and "premium". Compute the implied EV and equity value at the trading median, the trading range and the transaction range with calc, and say where the reference price sits in each. A reference price at or below NAV that is also below the comp median is the case to interrogate.
2. Lay out the structure in economic terms: the fee and carry the rolling LP pays from here (a second layer of carry on the same asset is the core objection), the reset of the carry basis from the original cost to the reference price, the GP commitment, the deferred consideration and who bears the credit risk, the stapled primary and what it is really buying, and the term. Quantify the fee and carry drag on a rolling LP's forward return.
3. Address the conflict on its own terms: the GP sets the price on both sides. State what a defensible process contains (a competitive process or a market check, an independent fairness opinion, LPAC consent, full disclosure of the stapled primary and of the GP's own rollover, a genuine cash option at the reference price, and enough time to decide) and mark which elements the proposed terms include.
4. Run the roll-or-cash arithmetic for the selected lens. For a rolling LP: forward MOIC and IRR from the reference price under base and downside cases, net of the new fees and carry, versus taking cash and the reinvestment alternative, versus the price available in the open LP secondary market. For a secondary buyer: entry multiple, leverage, the remaining plan's credibility, and the IRR at the price offered with the deferred consideration modeled. For the GP: what price clears the market and what the LPAC will insist on.
5. Give a recommendation and the three facts that would flip it.
Produce: callout with the recommendation for the selected lens; kpis (reference EV and multiple, comp median multiple, implied value at comps, premium or discount to NAV, forward MOIC net of new terms, fee and carry drag); table "Reference price triangulation" (Method, Multiple, Implied EV, Implied equity, Source); table "Structure economics" (Term, Proposed, Market norm, Effect on a rolling LP); table "Roll versus cash" (Case, Exit multiple, Exit EBITDA, Equity value, Net MOIC rolling, Cash alternative); checklist "Process and governance requirements" marking which are met; risks; nextSteps; caveats on the reliance on GP-supplied figures and on comp comparability.`,
  prompt: (i) => `Analyze the continuation vehicle for ${str(i, "asset")} from the perspective of an ${str(i, "lens", "existing LP deciding roll or cash").toLowerCase()}. Comps: ${list(i, "peers").join(", ")}.\n\nTerms: ${str(i, "terms")}\n\nAsset: ${str(i, "assetFacts")}`,
};

const infraAssetDiligence: ToolDef = {
  kind: "ai", id: "pe-infra-asset-diligence", title: "Infrastructure asset diligence", tagline: "Contracted cash flows, counterparty credit, regulatory regime, and what happens after the contract ends.",
  description: "Diligences an infrastructure or real asset the way an infra fund does: the contract or regulatory regime that produces the cash flow, its escalation and termination terms, counterparty credit, availability and volume risk, the capital plan and lifecycle capex, the debt structure and DSCR, and the terminal value question of what the asset earns once the contract rolls off. Uses listed infrastructure owners' filings as the disclosure benchmark.",
  roles: ["pe"], specialties: ["Infrastructure & real assets"],
  category: "Diligence", icon: "Factory", deliverable: "analysis", savesMinutes: 270, tags: ["infrastructure", "contracted cash flow", "DSCR"], effort: "high",
  fields: [
    { key: "asset", label: "Asset", type: "text", required: true, placeholder: "e.g. 320MW contracted solar portfolio, ERCOT and MISO" },
    { key: "assetType", label: "Asset class", type: "select", options: ["Contracted renewables", "Regulated utility", "Midstream / energy transition", "Digital infrastructure (fiber, towers, data centers)", "Transport (roads, ports, rail, airports)", "Water / waste", "Social infrastructure / PPP"], default: "Contracted renewables" },
    { key: "facts", label: "Asset facts", type: "textarea", required: true, placeholder: "Capacity, offtake contracts and tenor, counterparties, revenue and EBITDA, capex, debt, merchant exposure" },
    { key: "peers", label: "Listed benchmarks", type: "tickers", required: true, placeholder: "NEE AWK BIP", help: "Listed owners of similar assets for disclosure and return benchmarks" },
  ],
  example: {
    asset: "320MW operating solar portfolio across four projects in ERCOT and MISO", assetType: "Contracted renewables", peers: ["NEE", "AES", "CWEN"],
    facts: "Four operating projects (2019-2023 COD), 320MW DC / 245MW AC. 78% of 2027E revenue under PPAs: a 15-year utility PPA at $34/MWh through 2038 (investment-grade municipal utility), two corporate PPAs at $41 and $38/MWh through 2033 and 2034 (one BBB- industrial offtaker, one unrated data center developer with a parent guarantee), remaining 22% merchant in ERCOT West. 2026E revenue $58mm, EBITDA $44mm (76% margin), O&M $9mm with 2% escalators, no revenue escalators on the utility PPA. Existing project debt $210mm amortizing to 2038 at a 5.85% fixed swapped rate, current DSCR 1.42x, distributions locked below 1.20x. Lifecycle: inverter replacement estimated $11mm in 2030-2032; two sites have panel degradation running 0.8%/yr versus 0.5% modeled. Land leases 25-30 years with two 5-year extensions.",
  },
  instructions: `1. Map the revenue stack first: for each contract state the counterparty, the tenor and expiry, the price and escalation (or its absence, which is a real-terms decline), volume or availability obligations, curtailment and basis risk allocation, termination and change-of-control rights, and any credit support (parent guarantee, letter of credit, collateral posting triggers). Then state the percentage of revenue contracted by year and the year the contracted percentage drops below 70%.
2. Test counterparty credit rather than accepting a rating: for listed offtakers call get_company_financials and search_filing on the 10-K for "purchase power agreement", "long-term contracts", "credit ratings" and "liquidity", and use get_xbrl_series for leverage and interest coverage; for unrated counterparties say what credit support exists and what you would require. Concentration of contracted revenue in one weak counterparty is the classic infra loss.
3. Benchmark operations and disclosure against the listed owners: get_trading_comps on the peer tickers, and search_filing on the closest peer's 10-K for "availability", "capacity factor", "degradation", "operations and maintenance", "asset retirement obligation" and "power purchase agreement" to test the asset's assumed capacity factor, O&M per MW, degradation rate and decommissioning provision. Cite each benchmark; where the asset's assumption is more favorable than the peer's disclosed experience, say so and quantify the EBITDA at risk.
4. Build the capital and debt picture: lifecycle and maintenance capex by year with the evidence behind each estimate, the debt amortization profile against the contract tenor (a tail beyond the contract is a refinancing risk), DSCR by year with the distribution lock-up test, and the covenant and reserve accounts. Use calc for CFADS, DSCR, the minimum DSCR year and the loan life coverage ratio.
5. Confront terminal value honestly: what the asset earns when the PPAs expire, whether that is a merchant curve, a re-contracting assumption or a residual value, and how much of the equity value depends on it. State the percentage of equity value in the post-contract period, which is the single most common source of over-valuation in infra.
Produce: callout with the verdict and the one exposure that decides it; kpis (contracted revenue %, weighted average contract life, EBITDA, minimum DSCR, debt tail beyond contract, % of equity value in terminal period); table "Revenue stack" (Contract, Counterparty, Credit, Tenor, Price and escalation, % of revenue, Termination and change of control); line chart of contracted versus merchant revenue by year; table "Operating benchmarks" (Metric, Asset assumption, Peer disclosure, Source, EBITDA at risk); table "Capital and debt" by year with DSCR; risks (6-8 with severity); checklist "Technical and legal diligence scope"; nextSteps; caveats on merchant price curves and on peer comparability.`,
  prompt: (i) => `Diligence ${str(i, "asset")} (${str(i, "assetType", "infrastructure")}). Listed benchmarks: ${list(i, "peers").join(", ")}.\n\nFacts: ${str(i, "facts")}`,
};

const gpManagerDiligence: ToolDef = {
  kind: "ai", id: "pe-gp-manager-diligence", title: "GP manager diligence", tagline: "Operational and investment due diligence on a fund manager, with the questions LPs actually ask.",
  description: "Builds the LP's due diligence on a fund manager: track record decomposition (how much of the return came from multiple expansion, leverage and EBITDA growth rather than skill), attribution to individuals still at the firm, strategy drift across funds, team stability and carry distribution, terms against market, and the operational diligence checklist covering valuation policy, administration, LPA protections and reporting.",
  roles: ["pe"], specialties: ["Fund of funds / LP"],
  category: "Research", icon: "Users", deliverable: "checklist", savesMinutes: 300, tags: ["ODD", "manager selection", "LP diligence"], effort: "high",
  fields: [
    { key: "manager", label: "Manager", type: "text", required: true, placeholder: "e.g. Ridge Lane Capital Partners" },
    { key: "fund", label: "Fund being raised", type: "text", required: true, placeholder: "e.g. Fund V, $1.2B target, mid-market industrials" },
    { key: "trackRecord", label: "Track record data", type: "textarea", required: true, placeholder: "Prior funds: vintage, size, gross and net TVPI/DPI/IRR, deal count, realized and unrealized, notable outcomes" },
    { key: "terms", label: "Proposed terms", type: "textarea", placeholder: "Fee, step-down, carry, hurdle, waterfall type, GP commit, recycling, investment period, key person" },
    { key: "focus", label: "Emphasis", type: "select", options: ["Investment diligence", "Operational diligence", "Terms negotiation", "Re-up decision"], default: "Investment diligence" },
  ],
  example: {
    manager: "Ridge Lane Capital Partners", fund: "Fund V, $1.2B target, mid-market industrial and business services", focus: "Investment diligence",
    trackRecord: "Fund II (2014, $310mm): 2.3x gross / 1.9x net TVPI, 1.8x DPI, 21% net IRR, 11 platforms, fully realized. Fund III (2017, $560mm): 2.1x gross / 1.7x net, 1.1x DPI, 17% net IRR, 13 platforms, 4 unrealized. Fund IV (2022, $850mm): 1.4x gross / 1.2x net, 0.15x DPI, 11% net IRR, 9 platforms, 8 unrealized, investment period ended 6/30/26. Notable: Ridgeline Aggregates (Fund III) 4.1x; Northbridge Software (Fund IV) marked at 0.68x. Two of four founding partners have retired since 2021; the partner who led Ridgeline and two other top outcomes left in 2024 to start his own firm.",
    terms: "2% on commitments stepping to 1.5% of invested capital after the investment period; 20% carry over an 8% preferred return; European whole-fund waterfall with a 100% GP catch-up; GP commit 2%; recycling up to 20% of commitments; 5-year investment period; key person clause covering three named partners; no fee offset disclosure provided.",
  },
  instructions: `1. Decompose the track record before believing it. For each prior fund compute with calc: gross and net TVPI, DPI, RVPI, the fee and carry drag between gross and net, DPI against fund age, and the percentage of TVPI that is still unrealized. Benchmark against vintage norms (2010-2014 buyout vintages 1.8-2.2x TVPI and 1.4-1.8x DPI; 2019-2021 vintages 1.1-1.4x TVPI and 0.1-0.3x DPI; top-quartile net IRR above 20%, bottom quartile 5-8%) and say which quartile each fund sits in. Flag the funds whose return is mostly RVPI and the funds where a single deal drives the result.
2. Ask where the return came from. For each named outcome, decompose into EBITDA growth, multiple expansion and deleveraging using the deal facts given, and use get_trading_comps and get_company_financials on listed comparables plus edgar_fulltext_search on the sector's merger proxies to establish what the sector's multiples did over the hold. A fund whose return is mostly multiple expansion in a re-rating market has not demonstrated much. Note whether subscription lines may be inflating reported IRR (200-500 bps is the documented range) and ask for IRR with and without the facility.
3. Attribute to people, not to the firm: which partners led the deals that produced the return, whether they are still there, what the carry split is among current partners, the hires and departures by year, and what the key person clause actually triggers. Use web_research and form_d_search to verify departures, new firms founded by former partners, and the fund's own Form D filings and ADV where available.
4. Test strategy drift across funds: fund size growth, average check size, sector mix, control versus minority, leverage used, geography, and any move into adjacent strategies (credit, continuation vehicles, separately managed accounts). Size creep is the most common cause of a step-down in returns; quantify the change in average equity check from fund to fund.
5. Run the terms and operational checklists: fee basis and step-down, carry percentage, hurdle and catch-up, waterfall type and clawback, GP commit and whether it is cash or fee waiver, recycling, investment period, fee offsets, expenses charged to the fund, co-invest allocation policy, valuation policy and who signs the marks, auditor and administrator, ILPA reporting compliance, LPAC composition, key person and no-fault divorce, and side letter and MFN practice. Mark each as market, off-market or undisclosed.
Produce: callout with the recommendation and the two diligence items that must be resolved; kpis (funds raised, blended net TVPI, blended DPI, latest fund net IRR, % of TVPI unrealized, fee and carry drag); table "Track record" (Fund, Vintage, Size, Gross TVPI, Net TVPI, DPI, Net IRR, Quartile, Unrealized %); table "Return attribution on named outcomes"; bar of DPI by fund against the vintage benchmark; table "Terms versus market" (Term, Proposed, Market, Assessment); checklist "Operational due diligence" with status; risks (key person, size creep, strategy drift, mark quality); qa "Questions for the GP" (10); nextSteps; caveats on GP-supplied performance data and the need for verified cash flows.`,
  prompt: (i) => `Diligence ${str(i, "manager")} on ${str(i, "fund")}. Emphasis: ${str(i, "focus", "Investment diligence")}.\n\nTrack record: ${str(i, "trackRecord")}${str(i, "terms") ? `\n\nTerms: ${str(i, "terms")}` : ""}`,
};

const ioiLoiDrafter: ToolDef = {
  kind: "ai", id: "pe-ioi-loi-drafter", title: "IOI / LOI drafter", tagline: "The bid letter: price, structure, diligence remaining, and the conditions you can defend.",
  description: "Drafts the indication of interest or letter of intent with the commercial terms a seller's banker scores: valuation and its basis, the form and sources of consideration with financing evidence, treatment of management and rollover, the diligence still required and the timeline, exclusivity, and the conditions. Calibrates the price against public comps and recent precedents so the number is defensible in the process.",
  roles: ["pe", "banker"], category: "Deliverables", icon: "FileText", deliverable: "email", savesMinutes: 120, tags: ["IOI", "LOI", "bid letter"], effort: "medium",
  fields: [
    { key: "target", label: "Target", type: "text", required: true },
    { key: "letterType", label: "Letter", type: "select", options: ["Indication of interest (round 1)", "Letter of intent (round 2)", "Final binding offer"], default: "Indication of interest (round 1)" },
    { key: "terms", label: "Our terms", type: "textarea", required: true, placeholder: "Price or range, EBITDA basis, structure, financing, rollover, diligence remaining, timeline, exclusivity ask" },
    { key: "peers", label: "Public comps", type: "tickers", placeholder: "FIX EME IESC" }, { key: "banker", label: "Seller's advisor and process", type: "text", placeholder: "e.g. Harris Williams, bids due Nov 14, management meetings week of Dec 1" },
  ],
  example: {
    target: "Meridian Mechanical Services", letterType: "Indication of interest (round 1)", peers: ["FIX", "EME", "IESC"],
    banker: "Harris Williams; IOIs due November 14; management meetings week of December 1; second-round bids mid-January",
    terms: "Range of $330-360mm enterprise value, 9.9-10.8x our adjusted EBITDA of $33.4mm (we do not underwrite $2.5mm of the seller's add-backs). All-cash, funded with $134mm of committed unitranche (highly confident letter from two lenders in hand) and equity from Ridge Lane Capital Partners IV ($850mm fund, $238mm remaining). Open to CFO rollover of up to $15mm and an 8% MIP. Diligence remaining: QoE, insurance, IT, commercial diligence on the maintenance base, union and multi-employer pension review. Four weeks to signing from access; requesting three weeks of exclusivity at LOI. No financing contingency.",
  },
  instructions: `1. Calibrate the price before drafting. Call get_trading_comps on the comps and get_company_financials on the closest one for the trading range; run edgar_fulltext_search ("agreement and plan of merger" plus the sector words, forms ["DEFM14A","8-K","S-4"]) and read_document for "enterprise value" and disclosed multiples to establish the transaction range. State where the offer sits against both, and compute with calc the implied multiple on the seller's EBITDA and on yours, since a banker will quote the first number.
2. Write the letter to be scored, not admired. A seller's advisor ranks bids on price, certainty and speed. Lead with the enterprise value or range and the EBITDA it is based on; say explicitly which of the seller's adjustments you do not accept and why, because the difference will surface anyway and raising it now protects the bid from a re-trade later.
3. Evidence the funding: equity source and available capital, debt commitment status (highly confident letter, commitment letter, or committed at signing), and whether there is a financing condition. Certainty of close is where sponsors lose to strategics, so make the financing paragraph concrete.
4. Be precise on process and diligence: the workstreams remaining with the providers named, the access required, the timeline to signing in weeks, board and IC approval status, exclusivity requested with its duration, and the required treatment of management, rollover and the incentive plan. Keep conditions short and defensible; each additional condition costs the bid a place in the ranking.
5. Match the register to the letter type: a round-one IOI is two pages, non-binding, a range, and appetite; an LOI is specific, single-price, with exclusivity and a signing timeline; a final binding offer references the marked-up SPA, the funding in place and the confirmatory items only.
Produce: email block with the subject and the full letter body addressed to the seller's advisor; table "Price calibration" (Method, Multiple, Implied EV, Source); kpis (offer EV, multiple on our EBITDA, multiple on seller EBITDA, equity, debt, weeks to sign); bullets "Why this bid should advance" written as the advisor would summarize it; table "Diligence remaining" (Workstream, Provider, Duration, Access needed); checklist "Before sending" (IC approval, lender letters, conflicts, NDA compliance); risks (where we could be out-bid or re-traded); nextSteps; caveats.`,
  prompt: (i) => `Draft a ${str(i, "letterType", "Indication of interest (round 1)").toLowerCase()} for ${str(i, "target")}.${str(i, "banker") ? ` Process: ${str(i, "banker")}.` : ""}${list(i, "peers").length ? ` Comps: ${list(i, "peers").join(", ")}.` : ""}\n\nOur terms: ${str(i, "terms")}`,
};

/* ======================================================================================
 * Calculators
 * ====================================================================================== */

const lboReturns: ToolDef = {
  kind: "calc", id: "pe-lbo-returns", title: "LBO returns & attribution", tagline: "Debt schedule with a cash sweep, IRR and MOIC, and the split between growth, multiple and deleveraging.",
  description: "Full LBO returns model: sources and uses with transaction and financing fees, two debt tranches with rates, mandatory amortization and an optional cash sweep, a cash-flow driven debt schedule, exit at a multiple on final-year EBITDA, and the value creation attribution that separates EBITDA growth from multiple expansion and debt paydown. IRR is solved by bisection on the sponsor's cash flows.",
  roles: ["pe", "banker"], category: "Modeling", icon: "Calculator", savesMinutes: 240, tags: ["LBO", "IRR", "MOIC", "attribution"],
  fields: [
    { key: "ebitda", label: "Entry LTM EBITDA", type: "number", unit: "$mm", required: true, default: 33.4 }, { key: "entryMultiple", label: "Entry EV/EBITDA", type: "number", unit: "x", required: true, default: 10.5 },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", required: true, default: 10.5 }, { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 1, max: 10 },
    { key: "ebitdaGrowth", label: "EBITDA CAGR", type: "number", unit: "%", default: 9 }, { key: "senTurns", label: "First lien / unitranche", type: "number", unit: "x EBITDA", default: 4 },
    { key: "senRate", label: "First lien rate", type: "number", unit: "%", default: 9 }, { key: "senAmort", label: "Mandatory amortization", type: "number", unit: "% of original principal p.a.", default: 1 },
    { key: "subTurns", label: "Second lien / mezzanine", type: "number", unit: "x EBITDA", default: 0.75 }, { key: "subRate", label: "Second lien rate", type: "number", unit: "%", default: 12 },
    { key: "subPik", label: "Second lien pays PIK", type: "toggle", default: false }, { key: "sweep", label: "Cash flow sweep", type: "number", unit: "% of FCF after amortization", default: 75 },
    { key: "daPct", label: "D&A", type: "number", unit: "% of EBITDA", default: 22 }, { key: "capexPct", label: "Capex", type: "number", unit: "% of EBITDA", default: 14 },
    { key: "nwcPct", label: "NWC investment", type: "number", unit: "% of EBITDA growth", default: 25 }, { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "txFeePct", label: "Transaction fees", type: "number", unit: "% of EV", default: 2 }, { key: "finFeePct", label: "Financing fees", type: "number", unit: "% of debt", default: 2.5 },
    { key: "minCash", label: "Minimum cash funded at close", type: "number", unit: "$mm", default: 5 }, { key: "mgmtPool", label: "Management pool", type: "number", unit: "% of exit equity", default: 8 },
  ],
  example: { ebitda: 33.4, entryMultiple: 10.5, exitMultiple: 10.5, years: 5, ebitdaGrowth: 9, senTurns: 4, senRate: 9, senAmort: 1, subTurns: 0.75, subRate: 12, subPik: false, sweep: 75, daPct: 22, capexPct: 14, nwcPct: 25, taxRate: 25, txFeePct: 2, finFeePct: 2.5, minCash: 5, mgmtPool: 8 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda; const ev = c.price && e ? c.price.marketCap + (c.balance.debt ?? 0) - (c.balance.cash ?? 0) : null; const x = e && ev && e > 0 ? Math.round((ev / e) * 10) / 10 : 10.5;
    return {
      ebitda: e && e > 0 ? Math.round(e * 10) / 10 : 100,
      entryMultiple: Math.min(25, Math.max(4, x)), exitMultiple: Math.min(25, Math.max(4, x)),
      daPct: e && e > 0 && c.ltm.da !== null ? Math.round((c.ltm.da / e) * 100) : 22,
      capexPct: e && e > 0 && c.ltm.capex !== null ? Math.round((Math.abs(c.ltm.capex) / e) * 100) : 14,
    };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const p = lboFrom(i);
    if (p.ebitda <= 0) throw new Error("Entry EBITDA must be positive.");
    if (p.entryX <= 0 || p.exitX <= 0) throw new Error("Entry and exit multiples must be positive.");
    if (p.senTurns < 0 || p.subTurns < 0) throw new Error("Leverage turns cannot be negative.");
    const r = runLbo(p);
    if (r.equity <= 0) throw new Error(`Debt and fees (${fmt.money(r.debt0 + r.fees)}) exceed the purchase price: reduce leverage or raise the entry multiple.`);
    const total = p.senTurns + p.subTurns; const senShare = total > 0 ? p.senTurns / total : 1; const turns = [total - 1, total - 0.5, total, total + 0.5, total + 1].map((t) => Math.max(0, t));
    const exits = [p.exitX - 2, p.exitX - 1, p.exitX, p.exitX + 1, p.exitX + 2].map((x) => Math.max(0.5, x));
    const grid = turns.map((t) => exits.map((x) => {
      const out = runLbo({ ...p, exitX: x, senTurns: t * senShare, subTurns: t * (1 - senShare) });
      return out.equity > 0 && out.irrPct !== null ? out.irrPct : null;
    }));
    const rowsTbl = r.rows.map((y) => [`Y${y.year}`, fmt.num(y.ebitda, 1), fmt.num(y.cashInt, 1), fmt.num(y.pikInt, 1), fmt.num(y.taxes, 1), fmt.num(y.capex, 1), fmt.num(y.dNwc, 1), fmt.num(y.fcf, 1), fmt.num(y.amort + y.swept, 1), fmt.num(y.sen, 1), fmt.num(y.sub, 1), fmt.num(y.cash, 1), fmt.x(y.lev)]);
    return {
      title: "LBO returns and value creation attribution",
      summary: `A ${fmt.x(p.entryX)} entry on ${fmt.money(p.ebitda)} of EBITDA with ${fmt.x(total)} of leverage needs ${fmt.money(r.equity)} of sponsor equity and returns ${fmt.money(r.proceeds)} after ${p.years} years: ${fmt.x(r.moic, 2)} MOIC and ${fmt.pct(r.irrPct, 1)} IRR. Net leverage falls from ${fmt.x(r.entryLev)} to ${fmt.x(r.exitLev)}. Of the ${fmt.money(r.proceeds - r.equity)} of value created, EBITDA growth contributes ${fmt.money(r.attribution[1].value)}, the multiple ${fmt.money(r.attribution[2].value)} and debt paydown ${fmt.money(r.attribution[3].value)}, less ${fmt.money(-(r.attribution[4].value + r.attribution[5].value))} of fees and management pool.`,
      blocks: [
        { type: "kpis", items: [
          { label: "IRR", value: fmt.pct(r.irrPct, 1), tone: (r.irrPct ?? 0) >= 0.2 ? "pos" : (r.irrPct ?? 0) >= 0.15 ? "warn" : "neg", hint: "Solved by bisection on the sponsor's cash flows" },
          { label: "MOIC", value: fmt.x(r.moic, 2), tone: r.moic >= 2.5 ? "pos" : r.moic >= 2 ? "warn" : "neg" }, { label: "Sponsor equity", value: fmt.money(r.equity), hint: `${fmt.pct(r.equity / (r.equity + r.debt0), 0)} of total capitalization` },
          { label: "Exit equity value", value: fmt.money(r.exitEquity) }, { label: "Entry / exit leverage", value: `${fmt.x(r.entryLev)} → ${fmt.x(r.exitLev)}` },
          { label: "Exit EBITDA", value: fmt.money(r.exitEbitda), delta: fmt.pct(r.exitEbitda / p.ebitda - 1, 0) },
        ] },
        { type: "table", title: "Sources and uses (USD mm)", columns: ["Sources", "$mm", "x EBITDA", "Uses", "$mm"],
          rows: [
            ["First lien / unitranche", fmt.num(r.sen0, 1), fmt.x(p.senTurns), "Purchase enterprise value", fmt.num(r.entryEv, 1)],
            ["Second lien / mezzanine", fmt.num(r.sub0, 1), fmt.x(p.subTurns), "Transaction fees", fmt.num(r.entryEv * p.txFeePct, 1)],
            ["Sponsor equity", fmt.num(r.equity, 1), fmt.x(r.equity / p.ebitda), "Financing fees", fmt.num(r.debt0 * p.finFeePct, 1)], ["", "", "", "Cash to balance sheet", fmt.num(p.minCash, 1)],
          ],
          totals: ["Total sources", fmt.num(r.equity + r.debt0, 1), fmt.x((r.equity + r.debt0) / p.ebitda), "Total uses", fmt.num(r.entryEv + r.fees + p.minCash, 1)] },
        { type: "table", title: "Debt schedule and free cash flow (USD mm)", columns: ["Year", "EBITDA", "Cash interest", "PIK", "Taxes", "Capex", "Δ NWC", "FCF", "Debt repaid", "First lien", "Second lien", "Cash", "Net leverage"], rows: rowsTbl, note: "Interest accrues on beginning balances. The sweep applies to free cash flow after mandatory amortization, first lien before second lien." },
        { type: "waterfall", title: "Value creation attribution (USD mm)", format: "money", steps: r.attribution.map((a, k) => ({ label: a.label, value: a.value, total: k === 0 || k === r.attribution.length - 1 })) },
        { type: "sensitivity", title: "IRR: total leverage × exit multiple", rowLabel: "Leverage (x EBITDA)", colLabel: "Exit EV/EBITDA", rows: turns.map((t) => fmt.x(t)), cols: exits.map((x) => fmt.x(x)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
        { type: "line", title: "Net leverage by year", format: "x", series: [{ name: "Net debt / EBITDA", points: r.rows.map((y) => ({ x: `Y${y.year}`, y: y.lev })) }] },
      ],
      caveats: [
        "Cash-free debt-free entry: sponsor equity is the plug after debt, fees and the minimum cash funded at close. Entry net debt is funded debt less that cash.",
        "Attribution follows the standard identity: EBITDA growth = (exit EBITDA − entry EBITDA) × entry multiple; multiple change = (exit multiple − entry multiple) × exit EBITDA; deleveraging = entry net debt − exit net debt; fees and the management pool are deducted. The steps reconcile exactly to the equity gain.",
        "No revolver is modeled, so a negative free cash flow year reduces cash rather than drawing a facility. Taxes are computed on EBIT less all interest with no NOL carryforward. Capex, D&A and the NWC investment are expressed against EBITDA rather than revenue.",
        "The management pool is treated as straight dilution of exit equity; use the management equity waterfall calculator for hurdles, catch-up and vesting.",
      ],
      nextSteps: ["Run the ability-to-pay calculator to find the maximum entry multiple at your hurdle", "Check covenant headroom in the base and downside cases", "Size the management incentive plan with the MIP waterfall"],
    };
  },
};

const paperLbo: ToolDef = {
  kind: "calc", id: "pe-paper-lbo", title: "Paper LBO", tagline: "The five-minute interview LBO, with every step of the arithmetic shown.",
  description: "The paper LBO done the way it is done on a whiteboard: entry enterprise value and the sources and uses, EBITDA grown at a constant rate, cumulative free cash flow applied to debt, exit at a multiple on final-year EBITDA, and MOIC and IRR. Every line of arithmetic is printed so the answer can be defended or drilled.",
  roles: ["pe", "banker"], category: "Modeling", icon: "Timer", savesMinutes: 20, tags: ["paper LBO", "interview", "quick"],
  fields: [
    { key: "ebitda", label: "Entry EBITDA", type: "number", unit: "$mm", required: true, default: 100 }, { key: "entryMultiple", label: "Entry EV/EBITDA", type: "number", unit: "x", required: true, default: 10 },
    { key: "leverage", label: "Total leverage", type: "number", unit: "x EBITDA", default: 5 }, { key: "rate", label: "Blended interest rate", type: "number", unit: "%", default: 9 },
    { key: "ebitdaGrowth", label: "EBITDA growth", type: "number", unit: "% p.a.", default: 8 },
    { key: "fcfPct", label: "Pre-interest cash conversion", type: "number", unit: "% of EBITDA", default: 55, help: "EBITDA less capex, taxes and working capital, before interest" },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", default: 10 }, { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 1, max: 10 },
  ],
  example: { ebitda: 100, entryMultiple: 10, leverage: 5, rate: 9, ebitdaGrowth: 8, fcfPct: 55, exitMultiple: 10, years: 5 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda; const ev = c.price && e ? c.price.marketCap + (c.balance.debt ?? 0) - (c.balance.cash ?? 0) : null; const x = e && ev && e > 0 ? Math.round((ev / e) * 10) / 10 : 10;
    return { ebitda: e && e > 0 ? Math.round(e) : 100, entryMultiple: Math.min(25, Math.max(4, x)), exitMultiple: Math.min(25, Math.max(4, x)) };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const e0 = num(i, "ebitda", 100), entryX = num(i, "entryMultiple", 10), lev = num(i, "leverage", 5); const rate = num(i, "rate", 9) / 100, g = num(i, "ebitdaGrowth", 8) / 100, conv = num(i, "fcfPct", 55) / 100;
    const exitX = num(i, "exitMultiple", 10), years = Math.max(1, Math.round(num(i, "years", 5)));
    if (e0 <= 0 || entryX <= 0) throw new Error("Entry EBITDA and the entry multiple must be positive.");
    if (lev >= entryX) throw new Error(`Leverage of ${fmt.x(lev)} at a ${fmt.x(entryX)} entry leaves no equity. Reduce leverage.`);
    const ev0 = e0 * entryX, debt0 = e0 * lev, equity = ev0 - debt0; let debt = debt0, e = e0; const rows: { y: number; ebitda: number; cash: number; interest: number; paydown: number; debt: number }[] = [];
    for (let y = 1; y <= years; y++) {
      e = e0 * Math.pow(1 + g, y); const interest = debt * rate, cash = e * conv; const paydown = Math.max(0, Math.min(debt, cash - interest)); debt -= paydown;
      rows.push({ y, ebitda: e, cash, interest, paydown, debt });
    }
    const exitEv = e * exitX, exitEq = exitEv - debt; const moic = exitEq / equity, rr = irr([-equity, ...rows.map((_, k) => (k === years - 1 ? exitEq : 0))]);
    const exits = [exitX - 2, exitX - 1, exitX, exitX + 1, exitX + 2].map((x) => Math.max(0.5, x)); const levs = [lev - 1, lev - 0.5, lev, lev + 0.5, lev + 1].map((l) => Math.max(0, Math.min(entryX - 0.25, l)));
    const grid = levs.map((l) => exits.map((x) => {
      const eq = ev0 - e0 * l; if (eq <= 0) return null; let d = e0 * l;
      for (let y = 1; y <= years; y++) { const ey = e0 * Math.pow(1 + g, y); d -= Math.max(0, Math.min(d, ey * conv - d * rate)); }
      return irr([-eq, ...Array.from({ length: years }, (_, k) => (k === years - 1 ? e * x - d : 0))]);
    }));
    return {
      title: "Paper LBO",
      summary: `Equity of ${fmt.money(equity)} buys ${fmt.money(e0)} of EBITDA at ${fmt.x(entryX)} with ${fmt.x(lev)} of debt. EBITDA compounds to ${fmt.money(e)} and cumulative free cash flow repays ${fmt.money(debt0 - debt)} of debt, so exit equity at ${fmt.x(exitX)} is ${fmt.money(exitEq)}: ${fmt.x(moic, 2)} MOIC and ${fmt.pct(rr, 1)} IRR over ${years} years.`,
      blocks: [
        { type: "kpis", items: [
          { label: "MOIC", value: fmt.x(moic, 2), tone: moic >= 2.5 ? "pos" : moic >= 2 ? "warn" : "neg" }, { label: "IRR", value: fmt.pct(rr, 1), tone: (rr ?? 0) >= 0.2 ? "pos" : "warn" },
          { label: "Equity in", value: fmt.money(equity) }, { label: "Equity out", value: fmt.money(exitEq) }, { label: "Debt repaid", value: fmt.money(debt0 - debt), hint: `${fmt.pct((debt0 - debt) / debt0, 0)} of entry debt` },
          { label: "Exit leverage", value: fmt.x(debt / e) },
        ] },
        { type: "table", title: "The arithmetic", columns: ["Step", "Calculation", "Value"], rows: [
          ["1. Entry EV", `${fmt.money(e0)} × ${fmt.x(entryX)}`, fmt.money(ev0)], ["2. Debt", `${fmt.money(e0)} × ${fmt.x(lev)}`, fmt.money(debt0)], ["3. Sponsor equity", "EV − debt", fmt.money(equity)],
          ["4. Exit EBITDA", `${fmt.money(e0)} × (1 + ${fmt.pct(g, 0)})^${years}`, fmt.money(e)], ["5. Exit EV", `${fmt.money(e)} × ${fmt.x(exitX)}`, fmt.money(exitEv)], ["6. Debt at exit", "entry debt − cumulative paydown", fmt.money(debt)],
          ["7. Exit equity", "exit EV − debt at exit", fmt.money(exitEq)], ["8. MOIC", "exit equity ÷ equity in", fmt.x(moic, 2)], ["9. IRR", `MOIC^(1/${years}) − 1, solved by bisection`, fmt.pct(rr, 1)],
        ], emphasisRow: 8 },
        { type: "table", title: "Debt paydown (USD mm)", columns: ["Year", "EBITDA", "Cash before interest", "Interest", "Debt repaid", "Debt at year end"], rows: rows.map((x) => [`Y${x.y}`, fmt.num(x.ebitda, 1), fmt.num(x.cash, 1), fmt.num(x.interest, 1), fmt.num(x.paydown, 1), fmt.num(x.debt, 1)]) },
        { type: "sensitivity", title: "IRR: leverage × exit multiple", rowLabel: "Leverage", colLabel: "Exit multiple", rows: levs.map((l) => fmt.x(l)), cols: exits.map((x) => fmt.x(x)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: ["Cash conversion is expressed before interest, so capex, taxes and working capital are bundled into one percentage of EBITDA; no fees, minimum cash, mandatory amortization, PIK or management pool are modeled.", "All free cash flow after interest goes to debt with no cash build, which flatters exit equity slightly versus a partial sweep.", "For a defensible model use the full LBO returns calculator."],
    };
  },
};

const sourcesUses: ToolDef = {
  kind: "calc", id: "pe-sources-uses", title: "Sources & uses and debt schedule", tagline: "Build the funding table and the full tranche-by-tranche schedule with sweep and PIK.",
  description: "Builds the transaction funding table (purchase equity value, refinanced debt, minimum cash, transaction and financing fees, funded by revolver, term loan, second lien, seller note, rollover and sponsor equity as the plug) and then the multi-year debt schedule with mandatory amortization, a cash flow sweep applied in tranche priority, PIK accretion on the seller note, and the blended cost of debt and leverage path.",
  roles: ["pe", "banker"], category: "Modeling", icon: "Layers", savesMinutes: 150, tags: ["sources and uses", "debt schedule", "capital structure"],
  fields: [
    { key: "ebitda", label: "EBITDA", type: "number", unit: "$mm", required: true, default: 33.4 }, { key: "entryMultiple", label: "Entry EV/EBITDA", type: "number", unit: "x", required: true, default: 10.5 },
    { key: "refi", label: "Existing debt refinanced", type: "number", unit: "$mm", default: 0 }, { key: "minCash", label: "Cash to balance sheet", type: "number", unit: "$mm", default: 5 },
    { key: "txFeePct", label: "Transaction fees", type: "number", unit: "% of EV", default: 2 }, { key: "finFeePct", label: "Financing fees", type: "number", unit: "% of debt", default: 2.5 },
    { key: "revolver", label: "Revolver commitment", type: "number", unit: "$mm", default: 25 }, { key: "revolverDrawn", label: "Revolver drawn at close", type: "number", unit: "$mm", default: 0 },
    { key: "revolverFee", label: "Undrawn commitment fee", type: "number", unit: "%", default: 0.5 }, { key: "tlb", label: "Term loan / unitranche", type: "number", unit: "$mm", default: 134 },
    { key: "tlbRate", label: "Term loan rate", type: "number", unit: "%", default: 9 }, { key: "tlbAmort", label: "Term loan amortization", type: "number", unit: "% p.a.", default: 1 },
    { key: "secondLien", label: "Second lien", type: "number", unit: "$mm", default: 0 }, { key: "secondLienRate", label: "Second lien rate", type: "number", unit: "%", default: 12 },
    { key: "sellerNote", label: "Seller note", type: "number", unit: "$mm", default: 10 }, { key: "sellerNoteRate", label: "Seller note rate", type: "number", unit: "%", default: 8 },
    { key: "sellerPik", label: "Seller note is PIK", type: "toggle", default: true }, { key: "rollover", label: "Rollover equity", type: "number", unit: "$mm", default: 12 },
    { key: "sweep", label: "Cash flow sweep", type: "number", unit: "%", default: 75 }, { key: "fcfPct", label: "Pre-interest cash conversion", type: "number", unit: "% of EBITDA", default: 55 },
    { key: "ebitdaGrowth", label: "EBITDA growth", type: "number", unit: "% p.a.", default: 9 }, { key: "years", label: "Years to schedule", type: "number", unit: "years", default: 6, min: 2, max: 10 },
  ],
  example: { ebitda: 33.4, entryMultiple: 10.5, refi: 0, minCash: 5, txFeePct: 2, finFeePct: 2.5, revolver: 25, revolverDrawn: 0, revolverFee: 0.5, tlb: 134, tlbRate: 9, tlbAmort: 1, secondLien: 0, secondLienRate: 12, sellerNote: 10, sellerNoteRate: 8, sellerPik: true, rollover: 12, sweep: 75, fcfPct: 55, ebitdaGrowth: 9, years: 6 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda;
    return { ebitda: e && e > 0 ? Math.round(e * 10) / 10 : 100, refi: Math.round(c.balance.debt ?? 0), tlb: e && e > 0 ? Math.round(e * 4) : 400 };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const e0 = num(i, "ebitda", 33.4), entryX = num(i, "entryMultiple", 10.5);
    if (e0 <= 0 || entryX <= 0) throw new Error("EBITDA and the entry multiple must be positive.");
    const ev = e0 * entryX, refi = num(i, "refi"), minCash = num(i, "minCash"); const txFee = ev * num(i, "txFeePct", 2) / 100;
    const rev = num(i, "revolver"), revDrawn = Math.min(num(i, "revolverDrawn"), rev), revFee = num(i, "revolverFee", 0.5) / 100;
    const tlb0 = num(i, "tlb"), tlbRate = num(i, "tlbRate", 9) / 100, tlbAmortRate = num(i, "tlbAmort", 1) / 100; const sl0 = num(i, "secondLien"), slRate = num(i, "secondLienRate", 12) / 100;
    const sn0 = num(i, "sellerNote"), snRate = num(i, "sellerNoteRate", 8) / 100, snPik = bool(i, "sellerPik", true);
    const rollover = num(i, "rollover"), sweep = num(i, "sweep", 75) / 100, conv = num(i, "fcfPct", 55) / 100; const g = num(i, "ebitdaGrowth", 9) / 100, years = Math.max(2, Math.round(num(i, "years", 6)));
    const debt0 = revDrawn + tlb0 + sl0 + sn0; const finFee = debt0 * num(i, "finFeePct", 2.5) / 100; const uses = ev + refi + minCash + txFee + finFee; const sponsor = uses - debt0 - rollover;
    if (sponsor < 0) throw new Error(`Debt and rollover of ${fmt.money(debt0 + rollover)} exceed total uses of ${fmt.money(uses)}. Reduce a tranche.`);
    const blended = debt0 > 0 ? (revDrawn * tlbRate + tlb0 * tlbRate + sl0 * slRate + sn0 * snRate) / debt0 : 0; let tlb = tlb0, sl = sl0, sn = sn0, rd = revDrawn, cash = minCash, e = e0;
    const rows: { y: number; ebitda: number; interest: number; fcf: number; amort: number; swept: number; pik: number; tlb: number; sl: number; sn: number; rd: number; cash: number; net: number; lev: number }[] = [];
    for (let y = 1; y <= years; y++) {
      e = e0 * Math.pow(1 + g, y); const interest = rd * tlbRate + tlb * tlbRate + sl * slRate + (snPik ? 0 : sn * snRate) + (rev - rd) * revFee; const pik = snPik ? sn * snRate : 0; const fcf = e * conv - interest;
      const amort = Math.min(tlb, tlb0 * tlbAmortRate); let avail = Math.max(0, fcf - amort) * sweep; const swTlb = Math.min(tlb - amort, avail); avail -= swTlb; const swSl = Math.min(sl, avail); avail -= swSl;
      const swSn = snPik ? 0 : Math.min(sn, avail); tlb = tlb - amort - swTlb; sl -= swSl; sn = sn + pik - swSn; cash += fcf - amort - swTlb - swSl - swSn;
      if (cash < 0) { rd = Math.min(rev, rd - cash); cash = 0; }
      const net = rd + tlb + sl + sn - cash; rows.push({ y, ebitda: e, interest, fcf, amort, swept: swTlb + swSl + swSn, pik, tlb, sl, sn, rd, cash, net, lev: net / e });
      }
    return {
      title: "Sources and uses with debt schedule",
      summary: `Total funding of ${fmt.money(uses)} at a ${fmt.x(entryX)} entry: ${fmt.money(debt0)} of debt (${fmt.x(debt0 / e0)}), ${fmt.money(rollover)} of rollover and ${fmt.money(sponsor)} of sponsor equity, which is ${fmt.pct(sponsor / uses, 0)} of the structure. The blended cash cost of debt is ${fmt.pct(blended, 2)} and net leverage falls from ${fmt.x((debt0 - minCash) / e0)} to ${fmt.x(rows[rows.length - 1].lev)} by year ${years}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Total sources / uses", value: fmt.money(uses) }, { label: "Funded debt", value: fmt.money(debt0), hint: `${fmt.x(debt0 / e0)} gross leverage` },
          { label: "Sponsor equity", value: fmt.money(sponsor), delta: fmt.pct(sponsor / uses, 0), tone: sponsor / uses >= 0.4 ? "pos" : "warn" }, { label: "Blended cost of debt", value: fmt.pct(blended, 2) },
          { label: "Year-1 interest", value: fmt.money(rows[0].interest) }, { label: "Exit net leverage", value: fmt.x(rows[rows.length - 1].lev) },
        ] },
        { type: "table", title: "Sources (USD mm)", columns: ["Source", "$mm", "x EBITDA", "% of total", "Rate"], rows: [
          ["Revolver drawn", fmt.num(revDrawn, 1), fmt.x(revDrawn / e0), fmt.pct(revDrawn / uses, 1), fmt.pct(tlbRate, 2)], ["Term loan / unitranche", fmt.num(tlb0, 1), fmt.x(tlb0 / e0), fmt.pct(tlb0 / uses, 1), fmt.pct(tlbRate, 2)],
          ["Second lien", fmt.num(sl0, 1), fmt.x(sl0 / e0), fmt.pct(sl0 / uses, 1), fmt.pct(slRate, 2)], ["Seller note", fmt.num(sn0, 1), fmt.x(sn0 / e0), fmt.pct(sn0 / uses, 1), `${fmt.pct(snRate, 2)}${snPik ? " PIK" : ""}`],
          ["Rollover equity", fmt.num(rollover, 1), fmt.x(rollover / e0), fmt.pct(rollover / uses, 1), "—"], ["Sponsor equity", fmt.num(sponsor, 1), fmt.x(sponsor / e0), fmt.pct(sponsor / uses, 1), "—"],
        ], totals: ["Total sources", fmt.num(uses, 1), fmt.x(uses / e0), "100.0%", ""] },
        { type: "table", title: "Uses (USD mm)", columns: ["Use", "$mm", "% of total"], rows: [
          ["Purchase enterprise value", fmt.num(ev, 1), fmt.pct(ev / uses, 1)], ["Refinance existing debt", fmt.num(refi, 1), fmt.pct(refi / uses, 1)], ["Cash to balance sheet", fmt.num(minCash, 1), fmt.pct(minCash / uses, 1)],
          ["Transaction fees", fmt.num(txFee, 1), fmt.pct(txFee / uses, 1)], ["Financing fees", fmt.num(finFee, 1), fmt.pct(finFee / uses, 1)],
        ], totals: ["Total uses", fmt.num(uses, 1), "100.0%"] },
        { type: "table", title: "Debt schedule (USD mm)", columns: ["Year", "EBITDA", "Cash interest", "FCF after interest", "Amortization", "Swept", "PIK accretion", "Term loan", "Second lien", "Seller note", "Revolver", "Cash", "Net leverage"],
          rows: rows.map((r) => [`Y${r.y}`, fmt.num(r.ebitda, 1), fmt.num(r.interest, 1), fmt.num(r.fcf, 1), fmt.num(r.amort, 1), fmt.num(r.swept, 1), fmt.num(r.pik, 1), fmt.num(r.tlb, 1), fmt.num(r.sl, 1), fmt.num(r.sn, 1), fmt.num(r.rd, 1), fmt.num(r.cash, 1), fmt.x(r.lev)]),
          note: "The sweep applies to free cash flow after mandatory amortization in priority order: term loan, second lien, then any cash-pay seller note. A cash shortfall draws the revolver." },
        { type: "bar", title: "Capital structure at close (USD mm)", format: "money", data: [
          { label: "Revolver drawn", value: revDrawn }, { label: "Term loan", value: tlb0 }, { label: "Second lien", value: sl0 },
          { label: "Seller note", value: sn0 }, { label: "Rollover", value: rollover }, { label: "Sponsor equity", value: sponsor, emphasis: true },
        ] },
        { type: "line", title: "Net leverage path", format: "x", series: [{ name: "Net debt / EBITDA", points: rows.map((r) => ({ x: `Y${r.y}`, y: r.lev })) }] },
      ],
      caveats: ["Financing fees are expensed in the funding table rather than capitalized and amortized; transaction fees are treated as a use of funds at close.", "Cash conversion is stated before interest, so capex, taxes and working capital are one percentage of EBITDA.", "Undrawn commitment fees are charged on the unused revolver. PIK accretion compounds into the seller note balance and is not swept."],
    };
  },
};

const nwcPeg: ToolDef = {
  kind: "calc", id: "pe-nwc-peg", title: "Net working capital peg", tagline: "Monthly balances in, trailing-twelve-month peg out, with seasonality and the true-up.",
  description: "Builds the net working capital peg from a monthly balance history: computes NWC per the standard SPA definition (receivables plus inventory plus prepaids less payables and accrued liabilities), sets the peg as the trailing-twelve-month average to smooth seasonality, shows the by-calendar-month seasonal pattern, applies diligence adjustments for aged receivables, obsolete inventory and stretched payables, and computes the true-up against the expected closing balance.",
  roles: ["pe", "banker", "corpfin"], category: "Diligence", icon: "FileSpreadsheet", savesMinutes: 180, tags: ["NWC", "peg", "true-up", "SPA"],
  fields: [
    { key: "monthly", label: "Monthly balances", type: "csv", required: true, columns: "month, ar, inventory, prepaid, ap, accrued, revenue", help: "24-36 months of month-end balances; revenue is optional and used for the % of revenue view" },
    { key: "closingMonth", label: "Expected closing month", type: "text", placeholder: "2026-10", help: "Used for the seasonally matched peg" },
    { key: "closingNwc", label: "Expected NWC at closing", type: "number", unit: "$mm", default: 0, help: "Leave at zero to use the latest month" }, { key: "agedAr", label: "Aged / uncollectible receivables", type: "number", unit: "$mm", default: 0 },
    { key: "obsoleteInv", label: "Obsolete or excess inventory", type: "number", unit: "$mm", default: 0 },
    { key: "payableStretch", label: "Stretched payables to normalize", type: "number", unit: "$mm", default: 0, help: "Payables extended before sale; normalizing raises the peg" },
    { key: "otherAdj", label: "Other adjustments", type: "number", unit: "$mm", default: 0 },
  ],
  example: {
    closingMonth: "2026-10", closingNwc: 32.4, agedAr: 1.1, obsoleteInv: 0.4, payableStretch: 1.8, otherAdj: 0,
    monthly: `month,ar,inventory,prepaid,ap,accrued,revenue
2024-07,38.2,9.1,1.6,16.4,6.2,18.9
2024-08,39.8,9.4,1.5,17.1,6.0,19.6
2024-09,41.1,9.8,1.7,17.8,6.4,20.4
2024-10,40.2,9.2,1.6,17.2,6.6,20.1
2024-11,37.4,8.8,1.5,16.1,6.1,18.2
2024-12,34.9,8.4,1.4,15.2,7.2,17.1
2025-01,36.8,9.6,1.8,14.8,5.4,16.4
2025-02,38.4,10.1,1.9,15.4,5.2,16.9
2025-03,41.6,10.4,1.8,16.8,5.6,19.2
2025-04,43.2,10.0,1.7,17.9,5.9,20.8
2025-05,44.8,9.7,1.6,18.6,6.1,21.6
2025-06,45.9,9.4,1.6,19.1,6.4,22.4
2025-07,44.1,9.8,1.7,18.4,6.6,21.9
2025-08,45.6,10.1,1.6,19.2,6.3,22.6
2025-09,47.2,10.6,1.8,20.1,6.8,23.4
2025-10,46.1,9.9,1.7,19.4,7.0,23.1
2025-11,42.8,9.4,1.6,18.1,6.4,21.0
2025-12,39.6,9.0,1.5,17.0,7.6,19.4
2026-01,41.8,10.3,1.9,16.4,5.6,18.6
2026-02,43.6,10.8,2.0,17.1,5.4,19.2
2026-03,47.2,11.1,1.9,18.6,5.8,21.8
2026-04,49.1,10.7,1.8,19.8,6.1,23.6
2026-05,50.8,10.4,1.7,20.6,6.3,24.5
2026-06,52.1,10.1,1.7,21.2,6.6,25.4`,
  },
  compute: (i: Inputs): WorkflowOutput => {
    const { header, rows } = parseCsv(str(i, "monthly"));
    if (!header.length || rows.length < 3) throw new Error("Paste at least three months of balances with a header row.");
    const iM = colIdx(header, "month", "period", "date"), iAr = colIdx(header, "ar", "receivables", "accountsreceivable");
    const iInv = colIdx(header, "inventory", "inv"), iPre = colIdx(header, "prepaid", "prepaids", "other current assets");
    const iAp = colIdx(header, "ap", "payables", "accountspayable"), iAcc = colIdx(header, "accrued", "accruals", "accrued liabilities"); const iRev = colIdx(header, "revenue", "sales");
    if (iAr < 0 || iAp < 0) throw new Error("Could not find receivables and payables columns. Expected headers like month, ar, inventory, prepaid, ap, accrued.");
    const data = rows.map((r, k) => {
      const label = iM >= 0 ? String(r[iM] ?? `M${k + 1}`) : `M${k + 1}`;
      const ar = cellNum(r, iAr), inv = cellNum(r, iInv), pre = cellNum(r, iPre), ap = cellNum(r, iAp), acc = cellNum(r, iAcc), rev = cellNum(r, iRev);
      return { label, ar, inv, pre, ap, acc, rev, nwc: ar + inv + pre - ap - acc };
    });
    const monthOf = (s: string): number => {
      const m1 = s.match(/\b(\d{4})-(\d{1,2})\b/); if (m1) return Number(m1[2]); const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
      const idx = names.findIndex((n) => s.toLowerCase().includes(n)); if (idx >= 0) return idx + 1; const m2 = s.match(/^(\d{1,2})[/-]/); if (m2) return Number(m2[1]);
      return 0;
    };
    const window = Math.min(12, data.length); const ttm = data.slice(-window).reduce((a, d) => a + d.nwc, 0) / window;
    const rolling = data.map((_, k) => { const s = Math.max(0, k - window + 1); const sl = data.slice(s, k + 1); return sl.reduce((a, d) => a + d.nwc, 0) / sl.length; });
    const agedAr = num(i, "agedAr"), obs = num(i, "obsoleteInv"), stretch = num(i, "payableStretch"), other = num(i, "otherAdj"); const netAdj = -agedAr - obs + stretch + other; const peg = ttm + netAdj;
    const closingMonth = monthOf(str(i, "closingMonth"));
    const seasonal = Array.from({ length: 12 }, (_, m) => { const g = data.filter((d) => monthOf(d.label) === m + 1); return g.length ? g.reduce((a, d) => a + d.nwc, 0) / g.length : null; });
    const seasonalPeg = closingMonth >= 1 && seasonal[closingMonth - 1] !== null ? (seasonal[closingMonth - 1] as number) - agedAr - obs + stretch + other : null; const latest = data[data.length - 1];
    const closing = num(i, "closingNwc") !== 0 ? num(i, "closingNwc") : latest.nwc; const trueUp = closing - peg; const hi = data.reduce((a, d) => (d.nwc > a.nwc ? d : a), data[0]);
    const lo = data.reduce((a, d) => (d.nwc < a.nwc ? d : a), data[0]); const revTtm = data.slice(-window).reduce((a, d) => a + d.rev, 0);
    return {
      title: "Net working capital peg",
      summary: `The trailing ${window}-month average NWC is ${fmt.money(ttm)}; diligence adjustments move it by ${netAdj >= 0 ? "+" : "-"}${fmt.money(Math.abs(netAdj))} to a peg of ${fmt.money(peg)}. Against an expected closing balance of ${fmt.money(closing)} the true-up is ${fmt.money(Math.abs(trueUp))} ${trueUp >= 0 ? "in the seller's favor" : "in the buyer's favor"}. NWC swings from ${fmt.money(lo.nwc)} in ${lo.label} to ${fmt.money(hi.nwc)} in ${hi.label}, a ${fmt.money(hi.nwc - lo.nwc)} seasonal range, so the peg definition and the measurement date matter more than the level.`,
      blocks: [
        { type: "callout", tone: Math.abs(trueUp) > 0.15 * Math.abs(peg) ? "warn" : "info", title: "True-up at close", text: `Peg ${fmt.money(peg)} versus expected closing NWC ${fmt.money(closing)}: a ${fmt.money(Math.abs(trueUp))} adjustment ${trueUp >= 0 ? "payable to the seller" : "reducing the purchase price"}. Sellers frequently lose more at the working capital true-up than through earnings adjustments, so agree the definition and an illustrative calculation in the SPA and true up 60-90 days post-close.` },
        { type: "kpis", items: [
          { label: `TTM average (${window} mo)`, value: fmt.money(ttm) },
          { label: "Adjusted peg", value: fmt.money(peg), tone: "info" },
          { label: "Seasonally matched peg", value: seasonalPeg === null ? "n/a" : fmt.money(seasonalPeg), hint: closingMonth ? `Average of month ${closingMonth} across years` : "Enter a closing month" },
          { label: "Latest month NWC", value: fmt.money(latest.nwc), hint: latest.label }, { label: "Seasonal range", value: fmt.money(hi.nwc - lo.nwc), hint: `${lo.label} low to ${hi.label} high` },
          { label: "True-up", value: fmt.money(Math.abs(trueUp)), tone: trueUp >= 0 ? "neg" : "pos", hint: trueUp >= 0 ? "Buyer pays the seller" : "Purchase price reduction" },
          { label: "NWC % of TTM revenue", value: revTtm > 0 ? fmt.pct(ttm / revTtm, 1) : "n/a" },
        ] },
        { type: "table", title: "Monthly net working capital (USD mm)", columns: ["Month", "AR", "Inventory", "Prepaid", "AP", "Accrued", "NWC", `${window}-mo average`, "% of revenue"],
          rows: data.map((d, k) => [d.label, fmt.num(d.ar, 1), fmt.num(d.inv, 1), fmt.num(d.pre, 1), fmt.num(d.ap, 1), fmt.num(d.acc, 1), fmt.num(d.nwc, 1), fmt.num(rolling[k], 1), d.rev > 0 ? fmt.pct(d.nwc / (d.rev * 12), 1) : "n/a"]),
          emphasisRow: data.length - 1, note: "NWC = receivables + inventory + prepaids − payables − accrued liabilities. Cash, debt, income taxes and deal-related items are excluded per the standard SPA definition." },
        { type: "table", title: "Peg build", columns: ["Component", "$mm", "Note"], rows: [
          [`Trailing ${window}-month average NWC`, fmt.num(ttm, 1), "Smooths seasonality"],
          ["Less aged / uncollectible receivables", fmt.num(-agedAr, 1), "Balances that will not convert to cash"], ["Less obsolete or excess inventory", fmt.num(-obs, 1), "Written down in diligence"],
          ["Add back stretched payables", fmt.num(stretch, 1), "Normalizes pre-sale payable extension"], ["Other adjustments", fmt.num(other, 1), ""], ["Adjusted peg", fmt.num(peg, 1), "The number to put in the SPA"],
        ], emphasisRow: 5 },
        { type: "line", title: "NWC and the rolling average (USD mm)", format: "money", series: [
          { name: "Monthly NWC", points: data.map((d) => ({ x: d.label, y: d.nwc })) },
          { name: `${window}-month average`, points: data.map((d, k) => ({ x: d.label, y: rolling[k] })) },
        ] },
        { type: "bar", title: "Average NWC by calendar month (USD mm)", format: "money", reference: { value: peg, label: "Peg" },
          data: seasonal.map((v, m) => ({ label: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m], value: v, emphasis: m + 1 === closingMonth })) },
      ],
      caveats: [
        "The peg is the trailing-twelve-month average of the months provided; with fewer than twelve months it averages what is available and the window is stated. A seasonally matched peg (the average of the closing calendar month across years) is shown separately and is the better choice when the closing date is known.",
        "Diligence adjustments are applied as entered: aged receivables and obsolete inventory reduce the peg; normalizing stretched payables raises it, because a lower payable balance means higher NWC.",
        "Check for overlap with the net debt and debt-like items list: deferred revenue, customer deposits and accrued bonuses are commonly claimed in both places, and double-counting moves the price twice.",
        "The percentage of revenue column annualizes the month's revenue; it is indicative only.",
      ],
      nextSteps: ["Agree the NWC definition and an illustrative calculation as an SPA schedule", "Run the net debt and debt-like items checklist to eliminate double-counting", "Set the true-up mechanic, escrow and the 60-90 day settlement window"],
    };
  },
};

const covenantCompliance: ToolDef = {
  kind: "calc", id: "pe-covenant-compliance", title: "Covenant compliance & headroom", tagline: "Net leverage, coverage and FCCR against the levels, with the EBITDA cushion in dollars.",
  description: "Tests a credit against its financial covenants: covenant EBITDA with the add-back cap applied, net debt with the cash netting cap, net and first-lien leverage, interest coverage and the fixed charge coverage ratio, each against its level with headroom expressed both as a percentage and as the dollars of EBITDA that can be lost before a breach.",
  roles: ["pe", "banker", "corpfin"], category: "Credit & restructuring", icon: "Shield", savesMinutes: 60, tags: ["covenants", "headroom", "compliance"],
  fields: [
    { key: "reportedEbitda", label: "Reported LTM EBITDA", type: "number", unit: "$mm", required: true, default: 34.8 }, { key: "addbacks", label: "Claimed add-backs", type: "number", unit: "$mm", default: 4.2 },
    { key: "addbackCap", label: "Add-back cap", type: "number", unit: "% of reported EBITDA", default: 20 }, { key: "totalDebt", label: "Total funded debt", type: "number", unit: "$mm", required: true, default: 137.5 },
    { key: "firstLienDebt", label: "First lien debt", type: "number", unit: "$mm", default: 127.5 }, { key: "cash", label: "Cash", type: "number", unit: "$mm", default: 9.1 },
    { key: "cashCap", label: "Cash netting cap", type: "number", unit: "$mm", default: 10 }, { key: "cashInterest", label: "Cash interest", type: "number", unit: "$mm", required: true, default: 12.9 },
    { key: "capex", label: "Capex", type: "number", unit: "$mm", default: 4.6 }, { key: "taxes", label: "Cash taxes", type: "number", unit: "$mm", default: 3.1 },
    { key: "amort", label: "Scheduled amortization", type: "number", unit: "$mm", default: 1.3 }, { key: "dividends", label: "Restricted payments", type: "number", unit: "$mm", default: 0 },
    { key: "maxNetLeverage", label: "Max net leverage", type: "number", unit: "x", default: 5.5 }, { key: "maxFirstLien", label: "Max first lien leverage", type: "number", unit: "x", default: 5 },
    { key: "minCoverage", label: "Min interest coverage", type: "number", unit: "x", default: 2 }, { key: "minFccr", label: "Min fixed charge coverage", type: "number", unit: "x", default: 1.1 },
  ],
  example: { reportedEbitda: 34.8, addbacks: 4.2, addbackCap: 20, totalDebt: 137.5, firstLienDebt: 127.5, cash: 9.1, cashCap: 10, cashInterest: 12.9, capex: 4.6, taxes: 3.1, amort: 1.3, dividends: 0, maxNetLeverage: 5.5, maxFirstLien: 5, minCoverage: 2, minFccr: 1.1 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda;
    return { reportedEbitda: e && e > 0 ? Math.round(e * 10) / 10 : 100, totalDebt: Math.round(c.balance.debt ?? 0), firstLienDebt: Math.round((c.balance.debt ?? 0) * 0.9), cash: Math.round(c.balance.cash ?? 0), capex: Math.round(Math.abs(c.ltm.capex ?? 0)) };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const rep = num(i, "reportedEbitda"), claimed = num(i, "addbacks"), cap = num(i, "addbackCap", 20) / 100;
    if (rep <= 0) throw new Error("Reported EBITDA must be positive to test a leverage covenant.");
    const allowed = Math.min(claimed, rep * cap); const ebitda = rep + allowed; const debt = num(i, "totalDebt"), fl = num(i, "firstLienDebt"), cash = num(i, "cash"), cashCap = num(i, "cashCap", 0);
    const netted = Math.min(cash, cashCap > 0 ? cashCap : cash); const netDebt = debt - netted, netFl = fl - netted;
    const cashInt = num(i, "cashInterest"), capex = num(i, "capex"), taxes = num(i, "taxes"), amort = num(i, "amort"), divs = num(i, "dividends");
    if (cashInt <= 0) throw new Error("Cash interest must be positive to test coverage.");
    const lev = netDebt / ebitda, flLev = netFl / ebitda, cov = ebitda / cashInt; const fixed = cashInt + amort + divs; const fccr = fixed > 0 ? (ebitda - capex - taxes) / fixed : NaN;
    const maxLev = num(i, "maxNetLeverage", 5.5), maxFl = num(i, "maxFirstLien", 5), minCov = num(i, "minCoverage", 2), minFccr = num(i, "minFccr", 1.1);
    const tests = [
      { name: "Net leverage", level: `≤ ${fmt.x(maxLev)}`, actual: lev, actualS: fmt.x(lev), pass: lev <= maxLev, cushion: ebitda - netDebt / maxLev, pctCushion: 1 - (netDebt / maxLev) / ebitda },
      { name: "First lien leverage", level: `≤ ${fmt.x(maxFl)}`, actual: flLev, actualS: fmt.x(flLev), pass: flLev <= maxFl, cushion: ebitda - netFl / maxFl, pctCushion: 1 - (netFl / maxFl) / ebitda },
      { name: "Interest coverage", level: `≥ ${fmt.x(minCov)}`, actual: cov, actualS: fmt.x(cov), pass: cov >= minCov, cushion: ebitda - minCov * cashInt, pctCushion: 1 - (minCov * cashInt) / ebitda },
      { name: "Fixed charge coverage", level: `≥ ${fmt.x(minFccr, 2)}`, actual: fccr, actualS: fmt.x(fccr, 2), pass: fccr >= minFccr, cushion: ebitda - (minFccr * fixed + capex + taxes), pctCushion: 1 - (minFccr * fixed + capex + taxes) / ebitda },
    ];
    const binding = tests.reduce((a, t) => (t.pctCushion < a.pctCushion ? t : a), tests[0]); const declines = [0, 10, 20, 30, 40]; const levels = [maxLev - 0.5, maxLev - 0.25, maxLev, maxLev + 0.25, maxLev + 0.5];
    const grid = declines.map((d) => levels.map((l) => { const e = ebitda * (1 - d / 100); return e > 0 && l > 0 ? 1 - netDebt / l / e : null; }));
    return {
      title: "Covenant compliance and headroom",
      summary: `Covenant EBITDA is ${fmt.money(ebitda)} (reported ${fmt.money(rep)} plus ${fmt.money(allowed)} of add-backs, capped at ${fmt.pct(cap, 0)}${claimed > rep * cap ? `, so ${fmt.money(claimed - allowed)} of claimed add-backs is disallowed` : ""}). Net leverage is ${fmt.x(lev)} against a ${fmt.x(maxLev)} covenant and interest coverage is ${fmt.x(cov)} against ${fmt.x(minCov)}. The binding test is ${binding.name.toLowerCase()}, with ${fmt.pct(binding.pctCushion, 0)} of EBITDA cushion, or ${fmt.money(binding.cushion)}.`,
      blocks: [
        { type: "callout", tone: tests.some((t) => !t.pass) ? "neg" : binding.pctCushion < 0.15 ? "warn" : "pos", title: tests.some((t) => !t.pass) ? "Covenant breach" : binding.pctCushion < 0.15 ? "Thin cushion" : "In compliance",
          text: tests.some((t) => !t.pass) ? `${tests.filter((t) => !t.pass).map((t) => t.name).join(" and ")} fails. An equity cure, an amendment or a covenant reset is required before the next test date.` : `All tests pass. EBITDA can fall ${fmt.pct(binding.pctCushion, 0)} (${fmt.money(binding.cushion)}) before ${binding.name.toLowerCase()} breaches. Market practice sets the covenant 30-35% above the model case, so ${binding.pctCushion >= 0.25 ? "this is normal headroom" : "this is tighter than a sponsor would want at close"}.` },
        { type: "kpis", items: [
          { label: "Covenant EBITDA", value: fmt.money(ebitda), hint: `${fmt.money(allowed)} of add-backs allowed` }, { label: "Net debt", value: fmt.money(netDebt), hint: `${fmt.money(netted)} of cash netted` },
          { label: "Net leverage", value: fmt.x(lev), tone: lev <= maxLev ? "pos" : "neg" }, { label: "Interest coverage", value: fmt.x(cov), tone: cov >= minCov ? "pos" : "neg" },
          { label: "FCCR", value: fmt.x(fccr, 2), tone: fccr >= minFccr ? "pos" : "neg" },
          { label: "Binding cushion", value: fmt.pct(binding.pctCushion, 0), delta: fmt.money(binding.cushion), tone: binding.pctCushion >= 0.25 ? "pos" : binding.pctCushion >= 0.1 ? "warn" : "neg" },
        ] },
        { type: "table", title: "Covenant tests", columns: ["Test", "Level", "Actual", "Result", "EBITDA cushion", "Cushion %"],
          rows: tests.map((t) => [t.name, t.level, t.actualS, t.pass ? "Pass" : "FAIL", fmt.money(t.cushion), fmt.pct(t.pctCushion, 1)]),
          note: "Cushion is the dollars of covenant EBITDA that can be lost before the test fails, holding debt, interest, capex and taxes constant." },
        { type: "bar", title: "Headroom by test (% of EBITDA)", format: "pct", reference: { value: 0, label: "Breach" }, data: tests.map((t) => ({ label: t.name, value: t.pctCushion, emphasis: t.name === binding.name })) },
        { type: "sensitivity", title: "Net leverage cushion: EBITDA decline × covenant level", rowLabel: "EBITDA decline", colLabel: "Covenant level", rows: declines.map((d) => `${d}%`), cols: levels.map((l) => fmt.x(l)), values: grid, format: "pct", baseRow: 0, baseCol: 2 },
      ],
      caveats: [
        "Add-backs are capped at the stated percentage of reported EBITDA; real credit agreements cap projected synergies and cost savings with a look-forward period and often exclude some categories entirely, so read the Consolidated EBITDA definition before relying on this.",
        "Cash netting is capped as entered; many agreements limit netting or exclude cash held at non-guarantor subsidiaries.",
        "FCCR is computed as (EBITDA − capex − cash taxes) ÷ (cash interest + scheduled amortization + restricted payments). Definitions vary by agreement; use the document's.",
        "The sensitivity grid holds net debt constant, so it understates a breach in which a cash burn also raises debt.",
      ],
      nextSteps: ["Read the actual EBITDA definition and add-back cap with the credit agreement term extraction workflow", "Model the downside case and find the first failing test date", "Confirm equity cure capacity, limits and whether cures count toward EBITDA or debt paydown"],
    };
  },
};

const dividendRecap: ToolDef = {
  kind: "calc", id: "pe-dividend-recap", title: "Dividend recapitalization", tagline: "Size the dividend, re-lever, and see what it does to IRR versus holding.",
  description: "Sizes a dividend recapitalization: the incremental debt available at a target leverage, the fees, the excess cash released, and the dividend to the sponsor. Then compares returns with and without the recap by modeling the remaining hold on each capital structure, so the IRR benefit of pulling cash forward can be weighed against the extra leverage and interest cost.",
  roles: ["pe", "banker"], category: "Modeling", icon: "Coins", savesMinutes: 120, tags: ["dividend recap", "releveraging", "DPI"],
  fields: [
    { key: "ebitda", label: "Current LTM EBITDA", type: "number", unit: "$mm", required: true, default: 44 }, { key: "existingDebt", label: "Existing debt", type: "number", unit: "$mm", required: true, default: 120 },
    { key: "cash", label: "Cash on hand", type: "number", unit: "$mm", default: 18 }, { key: "minCash", label: "Minimum cash to retain", type: "number", unit: "$mm", default: 8 },
    { key: "targetLeverage", label: "Target gross leverage after recap", type: "number", unit: "x", default: 5 }, { key: "existingRate", label: "Rate on existing debt", type: "number", unit: "%", default: 8.5 },
    { key: "newRate", label: "Rate on new debt", type: "number", unit: "%", default: 10 }, { key: "feePct", label: "Financing fees", type: "number", unit: "% of new debt", default: 2.5 },
    { key: "basis", label: "Sponsor equity basis", type: "number", unit: "$mm", required: true, default: 241 }, { key: "yearsHeld", label: "Years held to date", type: "number", unit: "years", default: 3, min: 1, max: 10 },
    { key: "remaining", label: "Remaining hold", type: "number", unit: "years", default: 3, min: 1, max: 10 }, { key: "ebitdaGrowth", label: "EBITDA growth", type: "number", unit: "% p.a.", default: 8 },
    { key: "fcfPct", label: "Pre-interest cash conversion", type: "number", unit: "% of EBITDA", default: 55 }, { key: "sweep", label: "Cash flow sweep", type: "number", unit: "%", default: 75 },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", default: 10.5 },
  ],
  example: { ebitda: 44, existingDebt: 120, cash: 18, minCash: 8, targetLeverage: 5, existingRate: 8.5, newRate: 10, feePct: 2.5, basis: 241, yearsHeld: 3, remaining: 3, ebitdaGrowth: 8, fcfPct: 55, sweep: 75, exitMultiple: 10.5 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda;
    return { ebitda: e && e > 0 ? Math.round(e * 10) / 10 : 44, existingDebt: Math.round(c.balance.debt ?? 0), cash: Math.round(c.balance.cash ?? 0) };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const e0 = num(i, "ebitda"), existing = num(i, "existingDebt"), cash = num(i, "cash"), minCash = num(i, "minCash");
    const target = num(i, "targetLeverage", 5), exRate = num(i, "existingRate", 8.5) / 100, newRate = num(i, "newRate", 10) / 100;
    const feePct = num(i, "feePct", 2.5) / 100, basis = num(i, "basis"), held = Math.max(1, Math.round(num(i, "yearsHeld", 3)));
    const rem = Math.max(1, Math.round(num(i, "remaining", 3))), g = num(i, "ebitdaGrowth", 8) / 100; const conv = num(i, "fcfPct", 55) / 100, sweep = num(i, "sweep", 75) / 100, exitX = num(i, "exitMultiple", 10.5);
    if (e0 <= 0 || basis <= 0) throw new Error("EBITDA and the sponsor equity basis must be positive.");
    const newDebt = target * e0 - existing;
    if (newDebt <= 0) throw new Error(`Current gross leverage of ${fmt.x(existing / e0)} already exceeds the ${fmt.x(target)} target: there is no incremental debt capacity.`);
    const fees = newDebt * feePct, excessCash = Math.max(0, cash - minCash); const dividend = newDebt - fees + excessCash; const blended = (existing * exRate + newDebt * newRate) / (existing + newDebt);
    const path = (debt0: number, cash0: number, rate: number) => {
      let d = debt0, c = cash0;
      for (let y = 1; y <= rem; y++) {
        const e = e0 * Math.pow(1 + g, y), interest = d * rate, fcf = e * conv - interest;
        const pay = Math.max(0, Math.min(d, fcf * sweep));
        d -= pay; c += fcf - pay;
      }
      const eE = e0 * Math.pow(1 + g, rem);
      return { debt: d, cash: c, ebitda: eE, equity: eE * exitX - (d - c) };
    };
    const noRecap = path(existing, cash, exRate); const withRecap = path(existing + newDebt, minCash, blended); const n = held + rem;
    const flowsNo = Array.from({ length: n + 1 }, (_, t) => (t === 0 ? -basis : t === n ? noRecap.equity : 0));
    const flowsYes = Array.from({ length: n + 1 }, (_, t) => (t === 0 ? -basis : t === held ? dividend : 0) + (t === n ? withRecap.equity : 0)); const irrNo = irr(flowsNo), irrYes = irr(flowsYes);
    const moicNo = noRecap.equity / basis, moicYes = (dividend + withRecap.equity) / basis; const targets = [target - 0.5, target - 0.25, target, target + 0.25, target + 0.5].filter((t) => t * e0 > existing);
    const exits = [exitX - 1, exitX - 0.5, exitX, exitX + 0.5, exitX + 1].map((x) => Math.max(0.5, x));
    const grid = targets.map((t) => exits.map((x) => {
      const nd = t * e0 - existing, f = nd * feePct, div = nd - f + excessCash; const bl = (existing * exRate + nd * newRate) / (existing + nd); let d = existing + nd, c = minCash;
      for (let y = 1; y <= rem; y++) { const e = e0 * Math.pow(1 + g, y); const fcf = e * conv - d * bl; const pay = Math.max(0, Math.min(d, fcf * sweep)); d -= pay; c += fcf - pay; }
      const eq = e0 * Math.pow(1 + g, rem) * x - (d - c);
      return irr(Array.from({ length: n + 1 }, (_, tt) => (tt === 0 ? -basis : tt === held ? div : 0) + (tt === n ? eq : 0)));
    }));
    return {
      title: "Dividend recapitalization",
      summary: `Re-levering to ${fmt.x(target)} raises ${fmt.money(newDebt)} of incremental debt which, net of ${fmt.money(fees)} of fees and with ${fmt.money(excessCash)} of excess cash released, funds a ${fmt.money(dividend)} dividend: ${fmt.pct(dividend / basis, 0)} of the sponsor's basis returned in year ${held}. IRR improves from ${fmt.pct(irrNo, 1)} to ${fmt.pct(irrYes, 1)} while total MOIC moves from ${fmt.x(moicNo, 2)} to ${fmt.x(moicYes, 2)}, because pulling cash forward helps the time-weighted return more than the total.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Dividend", value: fmt.money(dividend), hint: `${fmt.pct(dividend / basis, 0)} of basis` }, { label: "New debt", value: fmt.money(newDebt) },
          { label: "Leverage after recap", value: fmt.x((existing + newDebt) / e0), tone: (existing + newDebt) / e0 > 6 ? "warn" : "neutral" },
          { label: "IRR with recap", value: fmt.pct(irrYes, 1), tone: (irrYes ?? 0) > (irrNo ?? 0) ? "pos" : "neg" }, { label: "IRR without", value: fmt.pct(irrNo, 1) },
          { label: "MOIC with / without", value: `${fmt.x(moicYes, 2)} / ${fmt.x(moicNo, 2)}` }, { label: "Blended cost of debt", value: fmt.pct(blended, 2), delta: `from ${fmt.pct(exRate, 2)}` },
        ] },
        { type: "table", title: "Recap sources and uses (USD mm)", columns: ["Item", "$mm", "Note"], rows: [
          ["New debt raised", fmt.num(newDebt, 1), `to ${fmt.x(target)} gross leverage`], ["Less financing fees", fmt.num(-fees, 1), `${fmt.pct(feePct, 1)} of new debt`],
          ["Plus excess cash released", fmt.num(excessCash, 1), `cash above ${fmt.money(minCash)} minimum`], ["Dividend to sponsor", fmt.num(dividend, 1), `year ${held}`],
        ], emphasisRow: 3 },
        { type: "waterfall", title: "Dividend build (USD mm)", format: "money", steps: [
          { label: "New debt", value: newDebt }, { label: "Financing fees", value: -fees }, { label: "Excess cash", value: excessCash }, { label: "Dividend", value: dividend, total: true },
        ] },
        { type: "table", title: "Returns comparison", columns: ["Case", "Cash at year " + held, "Exit EBITDA", "Net debt at exit", "Exit equity", "Total proceeds", "MOIC", "IRR"], rows: [
          ["Hold, no recap", fmt.money(0), fmt.money(noRecap.ebitda), fmt.money(noRecap.debt - noRecap.cash), fmt.money(noRecap.equity), fmt.money(noRecap.equity), fmt.x(moicNo, 2), fmt.pct(irrNo, 1)],
          ["Recap now", fmt.money(dividend), fmt.money(withRecap.ebitda), fmt.money(withRecap.debt - withRecap.cash), fmt.money(withRecap.equity), fmt.money(dividend + withRecap.equity), fmt.x(moicYes, 2), fmt.pct(irrYes, 1)],
        ], emphasisRow: 1 },
        { type: "sensitivity", title: "IRR with recap: target leverage × exit multiple", rowLabel: "Target leverage", colLabel: "Exit multiple", rows: targets.map((t) => fmt.x(t)), cols: exits.map((x) => fmt.x(x)), values: grid, format: "pct", baseCol: 2 },
      ],
      caveats: [
        "The recap is modeled at the current EBITDA with no change to the operating plan; the incremental interest is the only cost reflected. A recap that constrains capex or add-on capacity costs more than the interest.",
        "Interest accrues on the beginning balance at a blended rate across existing and new debt; no tranching, amortization, PIK or call protection is modeled.",
        "Cash flows are annual and the dividend is placed at the end of year of the holding period entered, so the IRR benefit is sensitive to that timing.",
        "Lender consent, restricted payment capacity and the available amount basket determine whether the dividend is permitted at all; size it against the credit agreement before relying on this.",
      ],
      nextSteps: ["Check restricted payment and available amount capacity in the credit agreement", "Re-test covenant headroom at the post-recap leverage", "Compare the recap against a partial sale or continuation vehicle in the exit route analysis"],
    };
  },
};

const mipWaterfall: ToolDef = {
  kind: "calc", id: "pe-mip-waterfall", title: "Management equity (MIP) waterfall", tagline: "Hurdles, catch-up, ratchet and vesting: what management actually receives at exit.",
  description: "Models the management incentive plan as a distribution waterfall: return of the sponsor's capital, a preferred return to the sponsor expressed as a MOIC hurdle, a catch-up tier where management receives most of each dollar until it holds its full share of profits, a residual split, an optional ratchet above a second hurdle, and time vesting with forfeiture back to the sponsor. Shows the breakpoints across exit values.",
  roles: ["pe", "corpfin"], category: "Modeling", icon: "Split", savesMinutes: 90, tags: ["MIP", "management equity", "waterfall", "vesting"],
  fields: [
    { key: "exitEquity", label: "Exit equity value", type: "number", unit: "$mm", required: true, default: 620 }, { key: "basis", label: "Sponsor invested equity", type: "number", unit: "$mm", required: true, default: 241 },
    { key: "hurdleMoic", label: "Hurdle", type: "number", unit: "x sponsor capital", default: 2, help: "Management shares only above this MOIC" }, { key: "mipPct", label: "MIP share of profits", type: "number", unit: "%", default: 10 },
    { key: "catchUp", label: "Catch-up rate", type: "number", unit: "% of distributions in the catch-up tier", default: 100, min: 0, max: 100, help: "100% gives management every dollar in the catch-up tier until it holds its full share of profits; 0% means it shares only in value above the hurdle" },
    { key: "ratchetMoic", label: "Ratchet hurdle", type: "number", unit: "x", default: 3 }, { key: "ratchetPct", label: "MIP share above the ratchet", type: "number", unit: "%", default: 15 },
    { key: "vestedPct", label: "Vested", type: "number", unit: "%", default: 80, help: "Unvested awards are forfeited back to the sponsor" },
  ],
  example: { exitEquity: 620, basis: 241, hurdleMoic: 2, mipPct: 10, catchUp: 100, ratchetMoic: 3, ratchetPct: 15, vestedPct: 80 },
  compute: (i: Inputs): WorkflowOutput => {
    const basis = num(i, "basis"), hurdle = num(i, "hurdleMoic", 2), mip = num(i, "mipPct", 10) / 100; const catchUp = Math.min(1, Math.max(0.01, num(i, "catchUp", 100) / 100));
    const ratchetX = num(i, "ratchetMoic", 3), ratchetPct = num(i, "ratchetPct", 15) / 100, vested = num(i, "vestedPct", 80) / 100;
    if (basis <= 0) throw new Error("Sponsor invested equity must be positive.");
    if (mip <= 0 || mip >= 1) throw new Error("The MIP share of profits must be between 0% and 100%.");
    if (hurdle < 1) throw new Error("The hurdle cannot be below 1.0x (return of capital).");
    const calc = (E: number) => {
      let rem = Math.max(0, E); const roc = Math.min(rem, basis); rem -= roc; const pref = Math.min(rem, basis * (hurdle - 1)); rem -= pref; const split = catchUpSplit(rem, pref, 0, mip, catchUp);
      const extra = Math.max(0, E - basis * Math.max(hurdle, ratchetX)) * Math.max(0, ratchetPct - mip); const gross = split.gp + extra; const vestedAmt = gross * vested;
      return { roc, pref, residLp: split.lp, residGp: split.gp, extra, gross, vestedAmt, forfeited: gross - vestedAmt, sponsor: E - vestedAmt };
    };
    const r = calc(num(i, "exitEquity")); const E = num(i, "exitEquity"); const grossMoic = E / basis, netMoic = r.sponsor / basis; const points = Array.from({ length: 9 }, (_, k) => basis * (0.5 + k * 0.4));
    const mips = [Math.max(1, mip * 100 - 5), mip * 100, mip * 100 + 5, mip * 100 + 10].map((x) => x / 100); const exits = [basis * 1.5, basis * 2, basis * 2.5, basis * 3, basis * 3.5];
    const grid = exits.map((ex) => mips.map((m) => {
      let rem = Math.max(0, ex); const roc = Math.min(rem, basis); rem -= roc; const pref = Math.min(rem, basis * (hurdle - 1)); rem -= pref; const s = catchUpSplit(rem, pref, 0, m, catchUp);
      const extra = Math.max(0, ex - basis * Math.max(hurdle, ratchetX)) * Math.max(0, ratchetPct - m);
      return (s.gp + extra) * vested;
    }));
    return {
      title: "Management equity waterfall",
      summary: `At a ${fmt.money(E)} exit equity value the sponsor's gross MOIC is ${fmt.x(grossMoic, 2)}. Management's award is worth ${fmt.money(r.gross)} gross and ${fmt.money(r.vestedAmt)} after ${fmt.pct(vested, 0)} vesting, which is ${fmt.pct(r.vestedAmt / E, 1)} of exit equity and ${fmt.pct(r.vestedAmt / Math.max(1e-9, E - basis), 1)} of the profit. The sponsor nets ${fmt.money(r.sponsor)}, a ${fmt.x(netMoic, 2)} MOIC, so the MIP costs ${(grossMoic - netMoic).toFixed(2)}x of sponsor return.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Exit equity value", value: fmt.money(E) }, { label: "MIP gross", value: fmt.money(r.gross) }, { label: "MIP vested", value: fmt.money(r.vestedAmt), hint: `${fmt.pct(vested, 0)} vested; ${fmt.money(r.forfeited)} forfeited` },
          { label: "MIP % of exit equity", value: fmt.pct(r.vestedAmt / E, 2) }, { label: "Sponsor gross MOIC", value: fmt.x(grossMoic, 2) }, { label: "Sponsor net MOIC", value: fmt.x(netMoic, 2), tone: netMoic >= 2.5 ? "pos" : "warn" },
        ] },
        { type: "table", title: "Distribution waterfall (USD mm)", columns: ["Tier", "Mechanic", "Distributed", "To sponsor", "To management"], rows: [
          ["1. Return of capital", `First ${fmt.money(basis)}`, fmt.num(r.roc, 1), fmt.num(r.roc, 1), fmt.num(0, 1)], ["2. Preferred return", `To ${fmt.x(hurdle)} sponsor MOIC`, fmt.num(r.pref, 1), fmt.num(r.pref, 1), fmt.num(0, 1)],
          ["3. Catch-up and residual", `${fmt.pct(catchUp, 0)} to MIP until it holds ${fmt.pct(mip, 0)} of profits, then ${fmt.pct(mip, 0)} / ${fmt.pct(1 - mip, 0)}`, fmt.num(r.residLp + r.residGp, 1), fmt.num(r.residLp, 1), fmt.num(r.residGp, 1)],
          ["4. Ratchet", `Additional ${fmt.pct(Math.max(0, ratchetPct - mip), 0)} above ${fmt.x(ratchetX)}`, fmt.num(r.extra, 1), fmt.num(-r.extra, 1), fmt.num(r.extra, 1)],
          ["5. Vesting forfeiture", `${fmt.pct(1 - vested, 0)} unvested returns to the sponsor`, fmt.num(0, 1), fmt.num(r.forfeited, 1), fmt.num(-r.forfeited, 1)],
        ], totals: ["Total", "", fmt.num(E, 1), fmt.num(r.sponsor, 1), fmt.num(r.vestedAmt, 1)], emphasisRow: 2 },
        { type: "waterfall", title: "Exit equity allocation (USD mm)", format: "money", steps: [
          { label: "Exit equity", value: E, total: true }, { label: "Sponsor capital returned", value: -r.roc }, { label: "Sponsor preferred", value: -r.pref }, { label: "Sponsor residual", value: -r.residLp },
          { label: "Forfeited to sponsor", value: -r.forfeited }, { label: "Management vested", value: r.vestedAmt, total: true },
        ] },
        { type: "line", title: "Management proceeds by exit MOIC (USD mm)", format: "money", series: [
          { name: "MIP vested", points: points.map((pt) => ({ x: fmt.x(pt / basis, 1), y: calc(pt).vestedAmt })) },
          { name: "Sponsor net of MIP", points: points.map((pt) => ({ x: fmt.x(pt / basis, 1), y: calc(pt).sponsor })) },
        ] },
        { type: "sensitivity", title: "MIP vested proceeds: exit equity × MIP share", rowLabel: "Exit equity", colLabel: "MIP share of profits", rows: exits.map((x) => fmt.money(x)), cols: mips.map((m) => fmt.pct(m, 0)), values: grid, format: "money", baseRow: 1, baseCol: 1 },
      ],
      caveats: [
        "The waterfall runs return of capital, then a preferred return to the sponsor stated as a MOIC hurdle, then a catch-up tier sized so management ends holding exactly its stated share of cumulative profits, then the residual split. A 100% catch-up gives management every dollar in that tier until it is caught up.",
        "The ratchet is applied as an incremental share on value above the ratchet hurdle, not a retroactive re-cut of the whole profit pool. Confirm which your plan documents use, because a retroactive ratchet is materially more expensive.",
        "Vesting is applied as a single blended percentage and forfeited value reverts to the sponsor. Good-leaver and bad-leaver treatment, accelerated vesting on a change of control and option strike prices are not modeled.",
        "Amounts are pre-tax and ignore the difference between options, growth shares and a sweet-equity strip, which changes both the timing and the character of the income.",
      ],
      nextSteps: ["Confirm whether the ratchet is incremental or retroactive in the plan documents", "Model the sponsor's net IRR after the MIP in the LBO returns calculator", "Check the leaver provisions and the change-of-control acceleration"],
    };
  },
};

const fundModel: ToolDef = {
  kind: "calc", id: "pe-fund-model", title: "Fund model: fees, carry and DPI/TVPI curves", tagline: "Deployment pacing, management fees, a European waterfall, and the J-curve.",
  description: "Builds the fund-level model: deployment paced over the investment period, management fees on commitments stepping down to invested capital, fund expenses, exits at a blended gross MOIC after a loss ratio, and a European whole-fund waterfall with a compounding preferred return, a GP catch-up and the carry split. Outputs gross and net MOIC, DPI, RVPI and TVPI by year, net IRR by bisection, and the fee and carry drag.",
  roles: ["pe"], category: "Modeling", icon: "PieChart", savesMinutes: 240, tags: ["fund model", "carry", "DPI", "TVPI", "waterfall"],
  fields: [
    { key: "fundSize", label: "Fund size", type: "number", unit: "$mm", required: true, default: 850 }, { key: "gpCommit", label: "GP commitment", type: "number", unit: "% of fund", default: 2 },
    { key: "mgmtFee", label: "Management fee", type: "number", unit: "% of commitments p.a.", default: 2 }, { key: "feeStepDown", label: "Fee after the investment period", type: "number", unit: "% of invested capital p.a.", default: 1.5 },
    { key: "expenses", label: "Fund expenses", type: "number", unit: "% of commitments p.a.", default: 0.15 }, { key: "investmentPeriod", label: "Investment period", type: "number", unit: "years", default: 5, min: 2, max: 7 },
    { key: "fundLife", label: "Fund life", type: "number", unit: "years", default: 12, min: 6, max: 15 }, { key: "deals", label: "Platform investments", type: "number", default: 10, min: 3, max: 40 },
    { key: "hold", label: "Average hold", type: "number", unit: "years", default: 5, min: 2, max: 10 }, { key: "grossMoic", label: "Gross MOIC on successful capital", type: "number", unit: "x", default: 2.8 },
    { key: "lossRatio", label: "Capital in losing deals", type: "number", unit: "%", default: 20 }, { key: "lossMoic", label: "MOIC on that capital", type: "number", unit: "x", default: 0.5 },
    { key: "hurdle", label: "Preferred return", type: "number", unit: "%", default: 8 }, { key: "carry", label: "Carried interest", type: "number", unit: "%", default: 20 },
    { key: "catchUp", label: "GP catch-up", type: "number", unit: "%", default: 100 }, { key: "recycle", label: "Recycle fees (deploy 100% of commitments)", type: "toggle", default: false },
  ],
  example: { fundSize: 850, gpCommit: 2, mgmtFee: 2, feeStepDown: 1.5, expenses: 0.15, investmentPeriod: 5, fundLife: 12, deals: 10, hold: 5, grossMoic: 2.8, lossRatio: 20, lossMoic: 0.5, hurdle: 8, carry: 20, catchUp: 100, recycle: false },
  compute: (i: Inputs): WorkflowOutput => {
    const size = num(i, "fundSize", 850), gpCommit = num(i, "gpCommit", 2) / 100; const feeRate = num(i, "mgmtFee", 2) / 100, stepRate = num(i, "feeStepDown", 1.5) / 100, expRate = num(i, "expenses", 0.15) / 100;
    const ip = Math.max(2, Math.round(num(i, "investmentPeriod", 5))), life = Math.max(ip + 2, Math.round(num(i, "fundLife", 12)));
    const hold = Math.max(2, Math.round(num(i, "hold", 5))), gross = num(i, "grossMoic", 2.8); const lossR = num(i, "lossRatio", 20) / 100, lossM = num(i, "lossMoic", 0.5);
    const hurdle = num(i, "hurdle", 8) / 100, carry = num(i, "carry", 20) / 100; const catchUp = Math.min(1, Math.max(0.01, num(i, "catchUp", 100) / 100)), recycle = bool(i, "recycle", false);
    if (size <= 0) throw new Error("Fund size must be positive.");
    if (carry <= 0 || carry >= 1) throw new Error("Carried interest must be between 0% and 100%.");
    const blended = lossR * lossM + (1 - lossR) * gross; type Y = { y: number; deployed: number; fees: number; exp: number; calls: number; dists: number; nav: number; lpDist: number; gpCarry: number };
    type Run = { rows: Y[]; totalFees: number; totalExp: number; paidIn: number; totalDist: number; totalGross: number; finalNav: number; gpCarryTotal: number; dpi: number; rvpi: number; tvpi: number; netIrr: number | null; grossIrr: number | null };
    /** One pass of the fund: pacing, fees, cohort exits, NAV mark, then the European waterfall. */
    const run = (investable: number, h: number, moic: number): Run => {
      const bl = lossR * lossM + (1 - lossR) * moic; const per = investable / ip; const vintages = Array.from({ length: ip }, (_, v) => v + 1); const rows: Y[] = []; let totalFees = 0, totalExp = 0;
      for (let y = 1; y <= life; y++) {
        const live = vintages.filter((v) => v <= y && y < v + h);
        const cost = live.length * per;
        const deployed = y <= ip ? per : 0;
        const fees = y <= ip ? feeRate * size : stepRate * cost;
        const exp = y <= ip || cost > 0 ? expRate * size : 0;
        const dists = vintages.filter((v) => v + h === y).length * per * bl;
        const nav = live.reduce((a, v) => a + per * (1 + (bl - 1) * ((y - v) / h)), 0);
        totalFees += fees; totalExp += exp;
        rows.push({ y, deployed, fees, exp, calls: deployed + fees + exp, dists, nav, lpDist: 0, gpCarry: 0 });
      }
      let unreturned = 0, pref = 0, lpProfit = 0, gpProfit = 0;
      for (const r of rows) {
        pref += unreturned * hurdle;
        unreturned += r.calls;
        let d = r.dists;
        const roc = Math.min(d, unreturned); unreturned -= roc; d -= roc;
        const pr = Math.min(d, pref); pref -= pr; d -= pr; lpProfit += pr;
        const sp = catchUpSplit(d, lpProfit, gpProfit, carry, catchUp);
        lpProfit += sp.lp; gpProfit += sp.gp;
        r.lpDist = roc + pr + sp.lp; r.gpCarry = sp.gp;
      }
      const paidIn = rows.reduce((a, r) => a + r.calls, 0); const totalDist = rows.reduce((a, r) => a + r.lpDist, 0); const totalGross = rows.reduce((a, r) => a + r.dists, 0);
      const finalNav = rows[rows.length - 1].nav; const lpFlows = [0, ...rows.map((r) => r.lpDist - r.calls)]; lpFlows[lpFlows.length - 1] += finalNav;
      const grossFlows = [0, ...rows.map((r) => r.dists - r.deployed)]; grossFlows[grossFlows.length - 1] += finalNav; const dpi = paidIn > 0 ? totalDist / paidIn : 0, rvpi = paidIn > 0 ? finalNav / paidIn : 0;
      return { rows, totalFees, totalExp, paidIn, totalDist, totalGross, finalNav, gpCarryTotal: gpProfit, dpi, rvpi, tvpi: dpi + rvpi, netIrr: irr(lpFlows), grossIrr: irr(grossFlows) };
    };
    let investable = size * 0.85;
    for (let k = 0; k < 8; k++) { const t = run(investable, hold, gross); investable = recycle ? size : Math.max(size * 0.5, size - t.totalFees - t.totalExp); }
    const res = run(investable, hold, gross); const rows = res.rows, paidIn = res.paidIn, totalDist = res.totalDist, totalGross = res.totalGross;
    const finalNav = res.finalNav, dpi = res.dpi, tvpi = res.tvpi, gpProfit = res.gpCarryTotal; const netIrr = res.netIrr, grossIrr = res.grossIrr; const built = { totalFees: res.totalFees, totalExp: res.totalExp };
    let cumD = 0, cumC = 0; const curve = rows.map((r) => { cumD += r.lpDist; cumC += r.calls; return { y: r.y, dpi: cumC > 0 ? cumD / cumC : 0, tvpi: cumC > 0 ? (cumD + r.nav) / cumC : 0 }; });
    const moics = [gross - 0.6, gross - 0.3, gross, gross + 0.3, gross + 0.6].map((m) => Math.max(0.2, m)); const holds = [Math.max(2, hold - 2), Math.max(2, hold - 1), hold, hold + 1, hold + 2];
    const grid = moics.map((m) => holds.map((h) => run(investable, h, m).netIrr));
    return {
      title: "Fund model",
      summary: `A ${fmt.money(size)} fund deploying ${fmt.money(investable)} over ${ip} years at a ${fmt.x(blended, 2)} blended gross MOIC returns ${fmt.x(tvpi, 2)} net TVPI and ${fmt.x(dpi, 2)} net DPI by year ${life}, a ${fmt.pct(netIrr, 1)} net IRR against ${fmt.pct(grossIrr, 1)} gross. Fees and expenses of ${fmt.money(built.totalFees + built.totalExp)} (${fmt.pct((built.totalFees + built.totalExp) / size, 1)} of commitments) and ${fmt.money(gpProfit)} of carry cost LPs ${(totalGross / paidIn - tvpi).toFixed(2)}x of gross multiple.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Blended gross MOIC", value: fmt.x(blended, 2), hint: `${fmt.pct(lossR, 0)} of capital at ${fmt.x(lossM, 1)}` }, { label: "Net TVPI", value: fmt.x(tvpi, 2), tone: tvpi >= 1.8 ? "pos" : tvpi >= 1.4 ? "warn" : "neg" },
          { label: "Net DPI", value: fmt.x(dpi, 2) }, { label: "Net IRR", value: fmt.pct(netIrr, 1), tone: (netIrr ?? 0) >= 0.2 ? "pos" : (netIrr ?? 0) >= 0.12 ? "warn" : "neg" }, { label: "Gross IRR", value: fmt.pct(grossIrr, 1) },
          { label: "Fees and expenses", value: fmt.money(built.totalFees + built.totalExp), delta: fmt.pct((built.totalFees + built.totalExp) / size, 1) }, { label: "Carry paid", value: fmt.money(gpProfit) },
          { label: "GP commitment", value: fmt.money(size * gpCommit) },
        ] },
        { type: "table", title: "Fund cash flows (USD mm)", columns: ["Year", "Deployed", "Fees", "Expenses", "Total calls", "Gross distributions", "Carry", "LP distributions", "NAV", "Cumulative DPI", "TVPI"],
          rows: rows.map((r, k) => [`Y${r.y}`, fmt.num(r.deployed, 1), fmt.num(r.fees, 1), fmt.num(r.exp, 1), fmt.num(r.calls, 1), fmt.num(r.dists, 1), fmt.num(r.gpCarry, 1), fmt.num(r.lpDist, 1), fmt.num(r.nav, 1), fmt.x(curve[k].dpi, 2), fmt.x(curve[k].tvpi, 2)]),
          totals: ["Total", fmt.num(investable, 1), fmt.num(built.totalFees, 1), fmt.num(built.totalExp, 1), fmt.num(paidIn, 1), fmt.num(totalGross, 1), fmt.num(gpProfit, 1), fmt.num(totalDist, 1), fmt.num(finalNav, 1), fmt.x(dpi, 2), fmt.x(tvpi, 2)] },
        { type: "line", title: "DPI and TVPI by year", format: "x", series: [
          { name: "Net DPI", points: curve.map((c) => ({ x: `Y${c.y}`, y: c.dpi })) },
          { name: "Net TVPI", points: curve.map((c) => ({ x: `Y${c.y}`, y: c.tvpi })) },
        ] },
        { type: "columns", title: "LP net cash flow, the J-curve (USD mm)", format: "money", data: rows.map((r) => ({ label: `Y${r.y}`, value: r.lpDist - r.calls })) },
        { type: "sensitivity", title: "Net IRR: gross MOIC × average hold", rowLabel: "Gross MOIC on successful capital", colLabel: "Average hold (years)", rows: moics.map((m) => fmt.x(m, 2)), cols: holds.map((h) => `${h}y`), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "Deployment is even across the investment period and each vintage exits in a single year at the blended gross MOIC, so the distribution profile is lumpier than a real fund. NAV marks each cohort linearly from cost to exit value over the hold.",
        "The waterfall is European (whole fund): distributions pay unreturned capital, then a preferred return accruing annually on unreturned capital, then a GP catch-up sized so the GP ends with exactly its carry share of cumulative profit, then the residual split. An American deal-by-deal waterfall with a clawback pays carry earlier and produces a higher GP IRR.",
        "Management fees are charged on committed capital during the investment period and on the cost of unexited investments afterwards. Fee offsets from portfolio company fees, organizational expenses and a subscription credit facility are not modeled; a subscription line can add 200-500 bps to reported IRR without changing cash returns.",
        "The GP commitment is reported but not allocated separately: fees and carry are applied to all fund capital, which slightly overstates the drag on LP-only capital.",
        "The sensitivity grid applies carry as a single deduction on total profit at the end of life rather than re-running the full waterfall, so it is indicative near the hurdle.",
      ],
      nextSteps: ["Compare the resulting TVPI and DPI against vintage benchmarks before using it with LPs", "Test the fee drag with and without recycling", "Run the secondaries pricing calculator to value the same positions in a sale"],
    };
  },
};

const secondariesPricing: ToolDef = {
  kind: "calc", id: "pe-secondaries-pricing", title: "Secondaries pricing", tagline: "Roll NAV forward, price the unfunded, and solve the bid that hits your IRR.",
  description: "Prices an LP fund interest in the secondary market: rolls the reference NAV forward for interim calls and distributions, applies the bid as a percentage of adjusted NAV, models the remaining unfunded as future calls and the expected distributions as a multiple of NAV over a back-weighted profile, and returns MOIC, IRR and the break-even bid that delivers the target return.",
  roles: ["pe"], specialties: ["Secondaries", "Fund of funds / LP"], category: "Valuation", icon: "ArrowLeftRight", savesMinutes: 120, tags: ["secondaries", "NAV discount", "DPI"],
  fields: [
    { key: "nav", label: "Reported NAV at reference date", type: "number", unit: "$mm", required: true, default: 31.4 }, { key: "unfunded", label: "Unfunded commitment", type: "number", unit: "$mm", default: 3.9 },
    { key: "interimDists", label: "Distributions since the reference date", type: "number", unit: "$mm", default: 1.2 }, { key: "interimCalls", label: "Calls since the reference date", type: "number", unit: "$mm", default: 0.4 },
    { key: "bidPct", label: "Bid", type: "number", unit: "% of adjusted NAV", default: 88 }, { key: "navMultiple", label: "Expected distributions on NAV", type: "number", unit: "x adjusted NAV", default: 1.25 },
    { key: "drawPct", label: "Unfunded expected to be called", type: "number", unit: "%", default: 70 }, { key: "unfundedMoic", label: "MOIC on called unfunded", type: "number", unit: "x", default: 1.6 },
    { key: "drawYears", label: "Years over which calls arrive", type: "number", unit: "years", default: 3, min: 1, max: 8 }, { key: "horizon", label: "Years to full realization", type: "number", unit: "years", default: 5, min: 2, max: 12 },
    { key: "targetIrr", label: "Target net IRR", type: "number", unit: "%", default: 17 },
  ],
  example: { nav: 31.4, unfunded: 3.9, interimDists: 1.2, interimCalls: 0.4, bidPct: 88, navMultiple: 1.25, drawPct: 70, unfundedMoic: 1.6, drawYears: 3, horizon: 5, targetIrr: 17 },
  compute: (i: Inputs): WorkflowOutput => {
    const nav = num(i, "nav"), unfunded = num(i, "unfunded"), iD = num(i, "interimDists"), iC = num(i, "interimCalls");
    const navX = num(i, "navMultiple", 1.25), drawPct = num(i, "drawPct", 70) / 100, uMoic = num(i, "unfundedMoic", 1.6);
    const drawYears = Math.max(1, Math.round(num(i, "drawYears", 3))), H = Math.max(2, Math.round(num(i, "horizon", 5))); const targetIrr = num(i, "targetIrr", 17) / 100;
    if (nav <= 0) throw new Error("Reported NAV must be positive.");
    const adjNav = nav - iD + iC;
    if (adjNav <= 0) throw new Error("Interim distributions exceed the reference NAV: the position has already been realized.");
    const calls = unfunded * drawPct; const totalDist = navX * adjNav + uMoic * calls; const weights = Array.from({ length: H }, (_, k) => k + 1); const wSum = weights.reduce((a, b) => a + b, 0);
    const flowsFor = (bidPct: number) => {
      const price = (bidPct / 100) * adjNav; const f: number[] = new Array(H + 1).fill(0); f[0] = -price;
      for (let y = 1; y <= drawYears; y++) f[y] -= calls / drawYears;
      for (let y = 1; y <= H; y++) f[y] += (totalDist * weights[y - 1]) / wSum;
      return f;
    };
    const bidPct = num(i, "bidPct", 88); const flows = flowsFor(bidPct); const price = (bidPct / 100) * adjNav; const rr = irr(flows), cost = price + calls, moic = totalDist / cost;
    const breakEven = solve((b) => irr(flowsFor(b)) ?? NaN, targetIrr, 10, 200); const bids = [bidPct - 10, bidPct - 5, bidPct, bidPct + 5, bidPct + 10].map((b) => Math.max(5, b));
    const mults = [navX - 0.3, navX - 0.15, navX, navX + 0.15, navX + 0.3].map((m) => Math.max(0.1, m));
    const grid = bids.map((b) => mults.map((m) => {
      const td = m * adjNav + uMoic * calls; const f: number[] = new Array(H + 1).fill(0); f[0] = -(b / 100) * adjNav;
      for (let y = 1; y <= drawYears; y++) f[y] -= calls / drawYears;
      for (let y = 1; y <= H; y++) f[y] += (td * weights[y - 1]) / wSum;
      return irr(f);
    }));
    let cum = 0; const cumRows = flows.map((f, t) => { cum += f; return { t, f, cum }; });
    return {
      title: "Secondaries pricing",
      summary: `Adjusted NAV is ${fmt.money(adjNav)} after rolling the reference NAV forward for ${fmt.money(iD)} of distributions and ${fmt.money(iC)} of calls. A bid at ${bidPct.toFixed(0)}% of adjusted NAV costs ${fmt.money(price)}, plus ${fmt.money(calls)} of expected future calls, against ${fmt.money(totalDist)} of expected distributions: ${fmt.x(moic, 2)} on total cost and a ${fmt.pct(rr, 1)} IRR over ${H} years. To hit a ${fmt.pct(targetIrr, 0)} target the bid has to be ${breakEven === null ? "outside the tested range" : `${breakEven.toFixed(1)}% of adjusted NAV`}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Adjusted NAV", value: fmt.money(adjNav), hint: "Reference NAV less interim distributions plus calls" }, { label: "Purchase price", value: fmt.money(price), delta: `${bidPct.toFixed(0)}% of NAV` },
          { label: "Discount to NAV", value: fmt.pct(1 - bidPct / 100, 1), tone: bidPct <= 100 ? "pos" : "warn" }, { label: "Total cost", value: fmt.money(cost), hint: "Price plus expected calls" },
          { label: "Expected proceeds", value: fmt.money(totalDist) }, { label: "MOIC", value: fmt.x(moic, 2) }, { label: "IRR", value: fmt.pct(rr, 1), tone: (rr ?? 0) >= targetIrr ? "pos" : "warn" },
          { label: `Break-even bid at ${fmt.pct(targetIrr, 0)}`, value: breakEven === null ? "n/a" : `${breakEven.toFixed(1)}% of NAV` },
        ] },
        { type: "table", title: "Cash flows (USD mm)", columns: ["Year", "Price and calls", "Distributions", "Net cash flow", "Cumulative"],
          rows: cumRows.map((r) => {
            const out = r.t === 0 ? -price : r.t <= drawYears ? -calls / drawYears : 0;
            const dist = r.t === 0 ? 0 : (totalDist * weights[r.t - 1]) / wSum;
            return [r.t === 0 ? "Close" : `Y${r.t}`, fmt.num(out, 2), fmt.num(dist, 2), fmt.num(r.f, 2), fmt.num(r.cum, 2)];
          }),
          note: "Distributions follow a back-weighted profile (weights 1, 2, ... H) because private portfolios realize later in the hold." },
        { type: "line", title: "Cumulative cash flow (USD mm)", format: "money", series: [{ name: "Cumulative", points: cumRows.map((r) => ({ x: r.t === 0 ? "Close" : `Y${r.t}`, y: r.cum })) }] },
        { type: "sensitivity", title: "IRR: bid × expected distributions on NAV", rowLabel: "Bid (% of adjusted NAV)", colLabel: "Distributions on NAV", rows: bids.map((b) => `${b.toFixed(0)}%`), cols: mults.map((m) => fmt.x(m, 2)), values: grid, format: "pct", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "NAV is rolled forward arithmetically for interim cash flows only; it is not re-marked. If the underlying comp set has moved since the reference date, adjust the expected distribution multiple rather than the NAV.",
        "The unfunded is priced as future calls at the stated draw rate with its own MOIC; a buyer assumes the whole unfunded obligation regardless of what is expected to be called.",
        "Distributions are spread on a back-weighted profile over the horizon. Because IRR is highly sensitive to that profile, treat the IRR as a range and the MOIC as the firmer number.",
        "Transfer fees, GP consent, standstill and the interim-period true-up mechanics of the purchase agreement are not modeled.",
      ],
      nextSteps: ["Test NAV quality position by position with the LP secondaries portfolio review", "Re-run the bid at a later reference date once the next quarterly NAV arrives", "Compare the bid against a continuation vehicle reference price for the same assets"],
    };
  },
};

const unitranchePricing: ToolDef = {
  kind: "calc", id: "pe-unitranche-pricing", title: "Unitranche pricing & leverage grid", tagline: "All-in yield with OID and fees, borrower coverage, and the leverage-versus-spread grid.",
  description: "Prices a unitranche or first-lien facility from the lender's and the borrower's side: the cash coupon on a floored base rate plus spread, PIK accretion, the all-in yield to expected life including OID, upfront and exit fees solved by bisection, and the borrower's interest coverage and fixed charge coverage at that leverage, with a grid across leverage turns and spreads.",
  roles: ["pe", "banker"], category: "Credit & restructuring", icon: "Percent", savesMinutes: 90, tags: ["unitranche", "pricing", "yield", "leverage"],
  fields: [
    { key: "ebitda", label: "Borrower EBITDA", type: "number", unit: "$mm", required: true, default: 33.4 }, { key: "turns", label: "Leverage", type: "number", unit: "x EBITDA", required: true, default: 4 },
    { key: "sofr", label: "Base rate (SOFR)", type: "number", unit: "%", default: 3.9 }, { key: "floor", label: "Base rate floor", type: "number", unit: "%", default: 1 }, { key: "spread", label: "Spread", type: "number", unit: "bps", default: 525 },
    { key: "pikShare", label: "Spread paid as PIK", type: "number", unit: "%", default: 0 }, { key: "oid", label: "OID", type: "number", unit: "points", default: 2 }, { key: "upfront", label: "Upfront fee", type: "number", unit: "points", default: 1 },
    { key: "exitFee", label: "Exit fee", type: "number", unit: "points", default: 0 }, { key: "tenor", label: "Tenor", type: "number", unit: "years", default: 6, min: 2, max: 10 },
    { key: "expectedLife", label: "Expected life", type: "number", unit: "years", default: 4, min: 1, max: 10 }, { key: "revolver", label: "Revolver commitment", type: "number", unit: "$mm", default: 25 },
    { key: "undrawnFee", label: "Undrawn commitment fee", type: "number", unit: "bps", default: 50 }, { key: "amortPct", label: "Mandatory amortization", type: "number", unit: "% p.a.", default: 1 },
    { key: "capexPct", label: "Capex", type: "number", unit: "% of EBITDA", default: 14 }, { key: "taxPct", label: "Cash taxes", type: "number", unit: "% of EBITDA", default: 9 },
  ],
  example: { ebitda: 33.4, turns: 4, sofr: 3.9, floor: 1, spread: 525, pikShare: 0, oid: 2, upfront: 1, exitFee: 0, tenor: 6, expectedLife: 4, revolver: 25, undrawnFee: 50, amortPct: 1, capexPct: 14, taxPct: 9 },
  compute: (i: Inputs): WorkflowOutput => {
    const e = num(i, "ebitda"), turns = num(i, "turns", 4);
    if (e <= 0 || turns <= 0) throw new Error("EBITDA and leverage must be positive.");
    const base = Math.max(num(i, "sofr", 3.9), num(i, "floor", 1)) / 100; const spread = num(i, "spread", 525) / 10000, pikShare = Math.min(1, Math.max(0, num(i, "pikShare", 0) / 100));
    const oid = num(i, "oid", 2) / 100, upfront = num(i, "upfront", 1) / 100, exitFee = num(i, "exitFee", 0) / 100;
    const tenor = Math.max(2, Math.round(num(i, "tenor", 6))), life = Math.min(tenor, Math.max(1, Math.round(num(i, "expectedLife", 4))));
    const revolver = num(i, "revolver"), undrawn = num(i, "undrawnFee", 50) / 10000; const amortRate = num(i, "amortPct", 1) / 100, capex = e * num(i, "capexPct", 14) / 100, taxes = e * num(i, "taxPct", 9) / 100;
    const drawn = turns * e; const cashRate = base + spread * (1 - pikShare), pikRate = spread * pikShare; const cashInterest = drawn * cashRate + (revolver) * undrawn; const allInCoupon = base + spread;
    const lenderFlows: number[] = new Array(life + 1).fill(0); lenderFlows[0] = -drawn * (1 - oid - upfront); let bal = drawn;
    for (let y = 1; y <= life; y++) {
      const amort = Math.min(bal, drawn * amortRate); lenderFlows[y] += bal * cashRate + amort; bal = bal - amort + bal * pikRate;
    }
    lenderFlows[life] += bal * (1 + exitFee); const yld = irr(lenderFlows); const amort1 = drawn * amortRate; const cov = e / cashInterest, covAfterCapex = (e - capex) / cashInterest;
    const fccr = (e - capex - taxes) / (cashInterest + amort1); const turnGrid = [turns - 1, turns - 0.5, turns, turns + 0.5, turns + 1].map((t) => Math.max(0.5, t));
    const spreadGrid = [spread - 0.0075, spread - 0.00375, spread, spread + 0.00375, spread + 0.0075].map((s) => Math.max(0.001, s));
    const grid = turnGrid.map((t) => spreadGrid.map((s) => {
      const ci = t * e * (base + s * (1 - pikShare)) + revolver * undrawn;
      return ci > 0 ? e / ci : null;
    }));
    return {
      title: "Unitranche pricing and leverage grid",
      summary: `${fmt.money(drawn)} drawn at ${fmt.x(turns)} leverage prices at ${fmt.pct(base, 2)} base plus ${(spread * 10000).toFixed(0)}bps, an all-in coupon of ${fmt.pct(allInCoupon, 2)}. With ${(oid * 100).toFixed(1)} points of OID and ${(upfront * 100).toFixed(1)} of upfront fee over a ${life}-year expected life the lender's yield is ${fmt.pct(yld, 2)}. The borrower pays ${fmt.money(cashInterest)} of cash interest, covering it ${fmt.x(cov)} with EBITDA and ${fmt.x(fccr, 2)} on a fixed charge basis.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Drawn amount", value: fmt.money(drawn), hint: `${fmt.x(turns)} EBITDA` }, { label: "All-in coupon", value: fmt.pct(allInCoupon, 2) },
          { label: "Lender yield to expected life", value: fmt.pct(yld, 2), tone: "info", hint: "IRR of the lender's cash flows including OID and fees" }, { label: "Cash interest", value: fmt.money(cashInterest) },
          { label: "Interest coverage", value: fmt.x(cov), tone: cov >= 2 ? "pos" : cov >= 1.5 ? "warn" : "neg" }, { label: "(EBITDA − capex) / interest", value: fmt.x(covAfterCapex) },
          { label: "FCCR", value: fmt.x(fccr, 2), tone: fccr >= 1.2 ? "pos" : fccr >= 1 ? "warn" : "neg" },
        ] },
        { type: "table", title: "Pricing build", columns: ["Component", "Rate", "Note"], rows: [
          ["Base rate", fmt.pct(num(i, "sofr", 3.9) / 100, 2), `floor ${fmt.pct(num(i, "floor", 1) / 100, 2)}${num(i, "sofr", 3.9) < num(i, "floor", 1) ? ", floor binds" : ""}`],
          ["Spread", fmt.pct(spread, 2), `${(spread * 10000).toFixed(0)} bps${pikShare > 0 ? `, ${fmt.pct(pikShare, 0)} PIK` : " all cash"}`], ["All-in coupon", fmt.pct(allInCoupon, 2), "Cash plus PIK"],
          ["Cash coupon", fmt.pct(cashRate, 2), "Paid currently"], ["OID", `${(oid * 100).toFixed(2)} pts`, `amortized over ${life} years in the yield`], ["Upfront fee", `${(upfront * 100).toFixed(2)} pts`, "Received at close"],
          ["Exit fee", `${(exitFee * 100).toFixed(2)} pts`, "Paid at repayment"], ["Yield to expected life", fmt.pct(yld, 2), "Bisection IRR on the lender's cash flows"],
        ], emphasisRow: 7 },
        { type: "table", title: "Lender cash flows (USD mm)", columns: ["Year", "Cash flow", "Note"],
          rows: lenderFlows.map((f, t) => [t === 0 ? "Close" : `Y${t}`, fmt.num(f, 2), t === 0 ? `Funded ${fmt.money(drawn)} less OID and fee` : t === life ? "Coupon, amortization and repayment at par plus exit fee" : "Coupon and amortization"]) },
        { type: "bar", title: "Yield components (%)", format: "pct", data: [
          { label: "Base rate", value: base }, { label: "Spread", value: spread }, { label: "OID and fees, annualized", value: Math.max(0, (yld ?? allInCoupon) - allInCoupon) }, { label: "Yield", value: yld ?? 0, emphasis: true },
        ] },
        { type: "sensitivity", title: "Borrower interest coverage: leverage × spread", rowLabel: "Leverage (x EBITDA)", colLabel: "Spread (bps)", rows: turnGrid.map((t) => fmt.x(t)), cols: spreadGrid.map((s) => (s * 10000).toFixed(0)), values: grid, format: "x", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "The lender yield is the IRR of par funding net of OID and upfront fee, the cash coupon on the outstanding balance, mandatory amortization, PIK accretion and repayment at the expected life with any exit fee. A shorter life raises the yield because the OID and fees amortize faster; call protection is not modeled.",
        "Undrawn commitment fees are charged on the full revolver commitment, and the revolver is assumed undrawn, so the borrower's coverage is slightly conservative.",
        "Coverage and FCCR use the EBITDA entered. Since the credit agreement's Consolidated EBITDA definition and its add-back cap decide the reported ratio, test both.",
        "Market reference for context: sponsor unitranche has been pricing around SOFR + 475-550 for an all-in cost near 9%, with total leverage of 4.0-5.5x and sponsor equity at 40-60% of the structure.",
      ],
    };
  },
};

const infraDscr: ToolDef = {
  kind: "calc", id: "pe-infra-dscr", title: "Infrastructure DSCR & project finance", tagline: "CFADS, debt sculpting to a target DSCR, coverage ratios, and the equity IRR.",
  description: "Project finance model for a contracted infrastructure asset: revenue and opex with escalation, cash flow available for debt service after tax, a debt schedule built as a level annuity, straight-line principal, or sculpted to a target DSCR, coverage ratios by year with the minimum DSCR and the loan life coverage ratio, the debt capacity the target DSCR supports, and the equity cash flows and IRR including a terminal value.",
  roles: ["pe"], specialties: ["Infrastructure & real assets"], category: "Modeling", icon: "Factory", savesMinutes: 210, tags: ["DSCR", "project finance", "CFADS", "LLCR"],
  fields: [
    { key: "cost", label: "Total project cost / EV", type: "number", unit: "$mm", required: true, default: 340 }, { key: "gearing", label: "Debt gearing", type: "number", unit: "% of cost", default: 62 },
    { key: "rate", label: "Interest rate", type: "number", unit: "%", default: 5.85 }, { key: "tenor", label: "Debt tenor", type: "number", unit: "years", default: 15, min: 3, max: 30 },
    { key: "amortType", label: "Amortization", type: "select", options: ["Sculpted to target DSCR", "Level annuity", "Straight-line principal"], default: "Sculpted to target DSCR" },
    { key: "targetDscr", label: "Target DSCR", type: "number", unit: "x", default: 1.35 }, { key: "revenue1", label: "Year-1 revenue", type: "number", unit: "$mm", required: true, default: 58 },
    { key: "revEsc", label: "Revenue escalation", type: "number", unit: "% p.a.", default: 1 }, { key: "opex1", label: "Year-1 opex", type: "number", unit: "$mm", default: 14 },
    { key: "opexEsc", label: "Opex escalation", type: "number", unit: "% p.a.", default: 2.5 }, { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "daYears", label: "Depreciation life", type: "number", unit: "years", default: 20, min: 5, max: 40 }, { key: "life", label: "Modeled asset life", type: "number", unit: "years", default: 20, min: 5, max: 40 },
    { key: "terminalMultiple", label: "Terminal value", type: "number", unit: "x final-year CFADS", default: 8 },
  ],
  example: { cost: 340, gearing: 62, rate: 5.85, tenor: 15, amortType: "Sculpted to target DSCR", targetDscr: 1.35, revenue1: 58, revEsc: 1, opex1: 14, opexEsc: 2.5, taxRate: 25, daYears: 20, life: 20, terminalMultiple: 8 },
  compute: (i: Inputs): WorkflowOutput => {
    const cost = num(i, "cost", 340), gearing = num(i, "gearing", 62) / 100, r = num(i, "rate", 5.85) / 100;
    const tenor = Math.max(3, Math.round(num(i, "tenor", 15))), life = Math.max(tenor, Math.round(num(i, "life", 20)));
    const mode = str(i, "amortType", "Sculpted to target DSCR"), target = Math.max(1.01, num(i, "targetDscr", 1.35));
    const rev1 = num(i, "revenue1"), revEsc = num(i, "revEsc", 1) / 100, opex1 = num(i, "opex1"), opexEsc = num(i, "opexEsc", 2.5) / 100;
    const tax = num(i, "taxRate", 25) / 100, daYears = Math.max(5, Math.round(num(i, "daYears", 20))); const termX = num(i, "terminalMultiple", 8);
    if (cost <= 0 || rev1 <= 0) throw new Error("Project cost and year-1 revenue must be positive.");
    if (gearing <= 0 || gearing >= 1) throw new Error("Gearing must be between 0% and 100%.");
    const debt0 = cost * gearing, equity = cost - debt0, da = cost / daYears; const rev = (y: number) => rev1 * Math.pow(1 + revEsc, y - 1); const opx = (y: number) => opex1 * Math.pow(1 + opexEsc, y - 1);
    let interestGuess = Array.from({ length: life + 1 }, (_, y) => (y >= 1 && y <= tenor ? debt0 * r * (1 - (y - 1) / tenor) : 0)); let cfads: number[] = []; let service: number[] = []; let balances: number[] = [];
    for (let pass = 0; pass < 4; pass++) {
      cfads = [0];
      for (let y = 1; y <= life; y++) {
        const ebitda = rev(y) - opx(y);
        const dep = y <= daYears ? da : 0;
        const taxable = ebitda - dep - (interestGuess[y] ?? 0);
        cfads.push(ebitda - Math.max(0, taxable) * tax);
      }
      const dfSum = (arr: number[]) => arr.reduce((a, v, y) => (y >= 1 && y <= tenor ? a + v / Math.pow(1 + r, y) : a), 0); service = new Array(life + 1).fill(0);
      if (mode === "Level annuity") {
        const pmt = (debt0 * r) / (1 - Math.pow(1 + r, -tenor));
        for (let y = 1; y <= tenor; y++) service[y] = pmt;
      } else if (mode === "Straight-line principal") {
        let bal = debt0;
        for (let y = 1; y <= tenor; y++) { const p = debt0 / tenor; service[y] = p + bal * r; bal -= p; }
      } else {
        const raw = cfads.map((c, y) => (y >= 1 && y <= tenor ? c / target : 0));
        const pv = dfSum(raw);
        const k = pv > 0 ? debt0 / pv : 0;
        for (let y = 1; y <= tenor; y++) service[y] = raw[y] * k;
      }
      balances = new Array(life + 1).fill(0); balances[0] = debt0; const newInterest = new Array(life + 1).fill(0);
      for (let y = 1; y <= life; y++) {
        const beg = balances[y - 1];
        const int = beg * r;
        newInterest[y] = y <= tenor ? int : 0;
        const principal = y <= tenor ? Math.min(beg, Math.max(0, service[y] - int)) : 0;
        if (y <= tenor) service[y] = int + principal;
        balances[y] = beg - principal;
      }
      interestGuess = newInterest;
    }
    const rows = Array.from({ length: life }, (_, k) => {
      const y = k + 1; const ebitda = rev(y) - opx(y); const int = interestGuess[y] ?? 0; const ds = service[y] ?? 0; const principal = Math.max(0, ds - int); const dscr = ds > 0 ? cfads[y] / ds : null;
      return { y, revenue: rev(y), opex: opx(y), ebitda, cfads: cfads[y], interest: int, principal, ds, dscr, balance: balances[y], equityCf: cfads[y] - ds };
    });
    const dscrs = rows.filter((x) => x.dscr !== null).map((x) => x.dscr as number);
    const minDscr = dscrs.length ? Math.min(...dscrs) : null, avgDscr = dscrs.length ? dscrs.reduce((a, b) => a + b, 0) / dscrs.length : null;
    const pvCfadsLoan = rows.reduce((a, x) => (x.y <= tenor ? a + x.cfads / Math.pow(1 + r, x.y) : a), 0); const llcr = debt0 > 0 ? pvCfadsLoan / debt0 : null;
    const capacity = rows.reduce((a, x) => (x.y <= tenor ? a + (x.cfads / target) / Math.pow(1 + r, x.y) : a), 0); const terminal = termX * rows[rows.length - 1].cfads;
    const eqFlows = [-equity, ...rows.map((x) => x.equityCf)]; eqFlows[eqFlows.length - 1] += terminal - balances[life]; const eqIrr = irr(eqFlows);
    const escs = [revEsc - 0.01, revEsc - 0.005, revEsc, revEsc + 0.005, revEsc + 0.01]; const rates = [r - 0.01, r - 0.005, r, r + 0.005, r + 0.01].map((x) => Math.max(0.005, x));
    const grid = escs.map((esc) => rates.map((rr2) => {
      const c: number[] = [0];
      for (let y = 1; y <= tenor; y++) {
        const ebitda = rev1 * Math.pow(1 + esc, y - 1) - opx(y);
        const dep = y <= daYears ? da : 0;
        const int = debt0 * rr2 * (1 - (y - 1) / tenor);
        c.push(ebitda - Math.max(0, ebitda - dep - int) * tax);
      }
      const pmt = (debt0 * rr2) / (1 - Math.pow(1 + rr2, -tenor)); const ds = c.slice(1).map(() => pmt); const m = Math.min(...c.slice(1).map((v, k) => v / ds[k]));
      return Number.isFinite(m) ? m : null;
    }));
    return {
      title: "Infrastructure DSCR and project finance",
      summary: `${fmt.money(debt0)} of debt at ${fmt.pct(gearing, 0)} gearing against ${fmt.money(equity)} of equity. ${mode} amortization over ${tenor} years produces a minimum DSCR of ${fmt.x(minDscr, 2)} and an average of ${fmt.x(avgDscr, 2)}, with an LLCR of ${fmt.x(llcr, 2)}. At the ${fmt.x(target, 2)} target DSCR the cash flows support ${fmt.money(capacity)} of debt, ${capacity >= debt0 ? `${fmt.money(capacity - debt0)} more than proposed` : `${fmt.money(debt0 - capacity)} less than proposed`}. Equity IRR including a ${fmt.x(termX)} terminal value on final-year CFADS is ${fmt.pct(eqIrr, 1)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Debt / equity", value: `${fmt.money(debt0)} / ${fmt.money(equity)}`, hint: `${fmt.pct(gearing, 0)} gearing` },
          { label: "Minimum DSCR", value: fmt.x(minDscr, 2), tone: (minDscr ?? 0) >= target ? "pos" : (minDscr ?? 0) >= 1.15 ? "warn" : "neg" }, { label: "Average DSCR", value: fmt.x(avgDscr, 2) },
          { label: "LLCR", value: fmt.x(llcr, 2), hint: "PV of CFADS over the loan life ÷ debt outstanding" },
          { label: `Debt capacity at ${fmt.x(target, 2)}`, value: fmt.money(capacity), tone: capacity >= debt0 ? "pos" : "warn" },
          { label: "Equity IRR", value: fmt.pct(eqIrr, 1) }, { label: "Year-1 CFADS", value: fmt.money(cfads[1]) },
        ] },
        { type: "table", title: "Project cash flows (USD mm)", columns: ["Year", "Revenue", "Opex", "EBITDA", "CFADS", "Interest", "Principal", "Debt service", "DSCR", "Debt balance", "Equity cash flow"],
          rows: rows.map((x) => [`Y${x.y}`, fmt.num(x.revenue, 1), fmt.num(x.opex, 1), fmt.num(x.ebitda, 1), fmt.num(x.cfads, 1), fmt.num(x.interest, 1), fmt.num(x.principal, 1), fmt.num(x.ds, 1), x.dscr === null ? "—" : fmt.x(x.dscr, 2), fmt.num(x.balance, 1), fmt.num(x.equityCf, 1)]),
          note: `CFADS = EBITDA less cash tax computed on EBITDA less depreciation less interest. Terminal value of ${fmt.money(terminal)} is added in the final year, net of any debt outstanding.` },
        { type: "bar", title: "DSCR by year", format: "x", reference: { value: target, label: `Target ${fmt.x(target, 2)}` },
          data: rows.filter((x) => x.y <= tenor).map((x) => ({ label: `Y${x.y}`, value: x.dscr, emphasis: x.dscr === minDscr })) },
        { type: "line", title: "CFADS and debt service (USD mm)", format: "money", series: [
          { name: "CFADS", points: rows.map((x) => ({ x: `Y${x.y}`, y: x.cfads })) },
          { name: "Debt service", points: rows.map((x) => ({ x: `Y${x.y}`, y: x.ds })) },
        ] },
        { type: "sensitivity", title: "Minimum DSCR: revenue escalation × interest rate", rowLabel: "Revenue escalation", colLabel: "Interest rate", rows: escs.map((e) => fmt.pct(e, 1)), cols: rates.map((x) => fmt.pct(x, 2)), values: grid, format: "x", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "Taxes are solved iteratively because interest depends on the schedule and the schedule depends on after-tax CFADS; four passes are run, which converges for normal inputs. Depreciation is straight-line on total project cost with no tax credits, bonus depreciation or loss carryforwards.",
        "Sculpting sets each year's debt service to CFADS ÷ target DSCR and then scales the profile so its present value at the debt rate equals the loan amount, which is the standard approach; the realized minimum DSCR can differ slightly from the target where the balance clamps in the final year.",
        "No debt service reserve account, maintenance reserve, cash lock-up test or distribution trap is modeled, and there is no construction period: the model starts at commercial operation.",
        "The terminal value is a multiple of final-year CFADS, which stands in for re-contracting or a residual sale. For a contracted asset whose offtake expires before the modeled life, that assumption carries most of the equity value and should be tested separately.",
      ],
      nextSteps: ["Test the re-contracting assumption in the terminal value against merchant curves", "Confirm the debt tail against the weighted average contract life", "Run the infrastructure asset diligence workflow on the offtake and counterparty credit"],
    };
  },
};

const abilityToPay: ToolDef = {
  kind: "calc", id: "pe-ability-to-pay", title: "Ability to pay", tagline: "Solve the maximum entry multiple that still clears your hurdle IRR.",
  description: "Inverts the LBO: holding the operating plan, the capital structure and the exit multiple fixed, it solves by bisection for the highest entry multiple at which the sponsor still earns its hurdle IRR, and then shows how that ceiling moves with leverage, exit multiple and hurdle. This is the number that sets the bid in an auction.",
  roles: ["pe", "banker", "corpfin"], category: "Valuation", icon: "Target", savesMinutes: 90, tags: ["ability to pay", "bid", "hurdle", "IRR"],
  fields: [
    { key: "ebitda", label: "Entry LTM EBITDA", type: "number", unit: "$mm", required: true, default: 33.4 }, { key: "targetIrr", label: "Hurdle IRR", type: "number", unit: "%", default: 22 },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", required: true, default: 10.5 }, { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 1, max: 10 },
    { key: "ebitdaGrowth", label: "EBITDA CAGR", type: "number", unit: "%", default: 9 }, { key: "senTurns", label: "First lien / unitranche", type: "number", unit: "x EBITDA", default: 4 },
    { key: "senRate", label: "First lien rate", type: "number", unit: "%", default: 9 }, { key: "senAmort", label: "Mandatory amortization", type: "number", unit: "% p.a.", default: 1 },
    { key: "subTurns", label: "Second lien / mezzanine", type: "number", unit: "x EBITDA", default: 0.75 }, { key: "subRate", label: "Second lien rate", type: "number", unit: "%", default: 12 },
    { key: "sweep", label: "Cash flow sweep", type: "number", unit: "%", default: 75 }, { key: "daPct", label: "D&A", type: "number", unit: "% of EBITDA", default: 22 },
    { key: "capexPct", label: "Capex", type: "number", unit: "% of EBITDA", default: 14 }, { key: "nwcPct", label: "NWC investment", type: "number", unit: "% of EBITDA growth", default: 25 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 }, { key: "txFeePct", label: "Transaction fees", type: "number", unit: "% of EV", default: 2 },
    { key: "finFeePct", label: "Financing fees", type: "number", unit: "% of debt", default: 2.5 }, { key: "minCash", label: "Cash funded at close", type: "number", unit: "$mm", default: 5 },
    { key: "mgmtPool", label: "Management pool", type: "number", unit: "% of exit equity", default: 8 },
  ],
  example: { ebitda: 33.4, targetIrr: 22, exitMultiple: 10.5, years: 5, ebitdaGrowth: 9, senTurns: 4, senRate: 9, senAmort: 1, subTurns: 0.75, subRate: 12, sweep: 75, daPct: 22, capexPct: 14, nwcPct: 25, taxRate: 25, txFeePct: 2, finFeePct: 2.5, minCash: 5, mgmtPool: 8 },
  prefill: (c) => {
    const e = c.ltm.adjEbitda ?? c.ltm.ebitda; const ev = c.price && e ? c.price.marketCap + (c.balance.debt ?? 0) - (c.balance.cash ?? 0) : null;
    return { ebitda: e && e > 0 ? Math.round(e * 10) / 10 : 100, exitMultiple: e && ev && e > 0 ? Math.min(25, Math.max(4, Math.round((ev / e) * 10) / 10)) : 10.5 };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const p = lboFrom(i); const hurdle = num(i, "targetIrr", 22) / 100;
    if (p.ebitda <= 0) throw new Error("Entry EBITDA must be positive.");
    if (hurdle <= 0) throw new Error("The hurdle IRR must be positive.");
    const at = (x: number, over: Partial<LboIn> = {}) => {
      const out = runLbo({ ...p, entryX: x, ...over });
      return out.equity > 0 && out.irrPct !== null ? out.irrPct : NaN;
    };
    /** Maximum entry multiple at a hurdle: bracket above the multiple where sponsor equity turns positive, then bisect. */
    const maxEntry = (h: number, over: Partial<LboIn> = {}): number | null => {
      const turnsUsed = (over.senTurns ?? p.senTurns) + (over.subTurns ?? p.subTurns); let lo = Math.max(0.5, turnsUsed * 1.02 + 0.1);
      while (lo < 40 && !Number.isFinite(at(lo, over))) lo += 0.1;
      if (lo >= 40) return null;
      return solve((x) => at(x, over), h, lo, 40);
    };
    const maxX = maxEntry(hurdle);
    if (maxX === null) throw new Error(`No entry multiple delivers a ${fmt.pct(hurdle, 1)} IRR with this plan and structure: even at the lowest price that leaves positive sponsor equity the return falls short. Raise the exit multiple, the growth rate or the leverage, or lower the hurdle.`);
    const r = runLbo({ ...p, entryX: maxX }); const hurdles = [hurdle - 0.04, hurdle - 0.02, hurdle, hurdle + 0.02, hurdle + 0.04].filter((h) => h > 0);
    const exits = [p.exitX - 2, p.exitX - 1, p.exitX, p.exitX + 1, p.exitX + 2].map((x) => Math.max(1, x)); const grid = hurdles.map((h) => exits.map((x) => maxEntry(h, { exitX: x })));
    const total = p.senTurns + p.subTurns, senShare = total > 0 ? p.senTurns / total : 1; const turns = [Math.max(0, total - 1.5), Math.max(0, total - 0.75), total, total + 0.75, total + 1.5];
    const byLev = turns.map((t) => ({ t, x: maxEntry(hurdle, { senTurns: t * senShare, subTurns: t * (1 - senShare) }) }));
    return {
      title: "Ability to pay",
      summary: `At a ${fmt.pct(hurdle, 0)} hurdle over ${p.years} years, with ${fmt.pct(p.growth, 0)} EBITDA growth, ${fmt.x(total)} of leverage and a ${fmt.x(p.exitX)} exit, the most you can pay is ${fmt.x(maxX)} EBITDA: ${fmt.money(r.entryEv)} of enterprise value requiring ${fmt.money(r.equity)} of equity. That is ${maxX >= p.exitX ? `${fmt.x(maxX - p.exitX)} above` : `${fmt.x(p.exitX - maxX)} below`} the exit multiple, so the return ${maxX >= p.exitX ? "depends on growth and deleveraging carrying a multiple contraction" : "has room for multiple compression"}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Maximum entry multiple", value: fmt.x(maxX), tone: "info" }, { label: "Maximum enterprise value", value: fmt.money(r.entryEv) },
          { label: "Sponsor equity required", value: fmt.money(r.equity), delta: fmt.pct(r.equity / (r.equity + r.debt0), 0) }, { label: "Entry net leverage", value: fmt.x(r.entryLev) }, { label: "MOIC at that price", value: fmt.x(r.moic, 2) },
          { label: "Exit EBITDA", value: fmt.money(r.exitEbitda) },
        ] },
        { type: "table", title: "The winning bid", columns: ["Step", "Value", "Note"], rows: [
          ["Entry EBITDA", fmt.money(p.ebitda), "LTM, on our adjusted number"], ["Maximum entry multiple", fmt.x(maxX), `solved by bisection for a ${fmt.pct(hurdle, 1)} IRR`],
          ["Maximum enterprise value", fmt.money(r.entryEv), "the headline number to bid"], ["Debt raised", fmt.money(r.debt0), fmt.x(total)], ["Fees", fmt.money(r.fees), "transaction and financing"],
          ["Sponsor equity", fmt.money(r.equity), `${fmt.pct(r.equity / (r.equity + r.debt0), 0)} of capitalization`], ["Exit equity value", fmt.money(r.exitEquity), `at ${fmt.x(p.exitX)} on ${fmt.money(r.exitEbitda)}`],
          ["Sponsor proceeds", fmt.money(r.proceeds), `after a ${fmt.pct(p.mgmtPool, 0)} management pool`],
        ], emphasisRow: 2 },
        { type: "bar", title: "Maximum entry multiple by leverage", format: "x", reference: { value: maxX, label: "Base" },
          data: byLev.map((b) => ({ label: fmt.x(b.t), value: b.x, emphasis: Math.abs(b.t - total) < 1e-9 })) },
        { type: "sensitivity", title: "Maximum entry multiple: hurdle IRR × exit multiple", rowLabel: "Hurdle IRR", colLabel: "Exit multiple", rows: hurdles.map((h) => fmt.pct(h, 0)), cols: exits.map((x) => fmt.x(x)), values: grid, format: "x", baseRow: 2, baseCol: 2 },
      ],
      caveats: [
        "The solve holds the operating plan, capital structure, fees and management pool fixed and moves only the entry multiple, so the answer is the price ceiling for that plan and not a valuation.",
        "Leverage is expressed in turns of entry EBITDA, so raising the entry multiple does not automatically raise the debt quantum; lenders size off EBITDA, which is why the ceiling is sensitive to the growth case rather than to price.",
        "Uses the same LBO engine as the returns calculator: annual cash flows, interest on beginning balances, a sweep after mandatory amortization, no revolver and taxes on EBIT less interest.",
        "An auction is won on certainty and structure as well as price; treat this as the walk-away line, not the opening bid.",
      ],
      nextSteps: ["Compare the ceiling with the trading and transaction comp ranges", "Test what EBITDA growth the ceiling requires and whether the value creation plan supports it", "Re-run at the lender's leverage rather than your own if the debt is not yet committed"],
    };
  },
};

export const PE_PACK: ToolDef[] = [
  // AI workflows
  cimFirstRead, targetScreen, takePrivatePrecedents, qoeAddbackTest, netDebtChecklist, icMemo, hundredDayPlan,
  valueCreationPlan, addonScreen, portfolioMonitoring, exitAnalysis, lpQuarterlyReport, privateCreditMemo,
  creditAgreementTerms, lenderPackage, mgmtMeetingPrep, growthEquityScreen, sponsorActivityMap, secondariesReview,
  continuationVehicle, infraAssetDiligence, gpManagerDiligence, ioiLoiDrafter,
  // Calculators
  lboReturns, paperLbo, sourcesUses, nwcPeg, covenantCompliance, dividendRecap, mipWaterfall, fundModel,
  secondariesPricing, unitranchePricing, infraDscr, abilityToPay,
];
