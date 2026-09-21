/**
 * Consultant tool pack: strategy, commercial due diligence, financial due diligence (TAS), operations
 * and performance, restructuring / turnaround, economic & valuation advisory, and technology & digital.
 * Authored from docs/research/consulting.md. Methods follow the research: MECE issue trees, top-down and
 * bottom-up sizing reconciled to ~15%, FTI-style price/volume/mix, the seller / diligence / pro forma
 * add-back taxonomy, TTM-average NWC pegs, 13-week cash with a minimum-cash policy, and XBRL benchmarking.
 */
import { bool, fmt, list, num, parseCsv, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* ======================================================================================
 * AI workflows
 * ====================================================================================== */

const WORKFLOWS: ToolDef[] = [
  /* ---------------- Strategy ---------------- */
  {
    kind: "ai", id: "strat-issue-tree-workplan", title: "Issue tree & workplan studio", tagline: "A MECE decomposition of the client question, with an owner, source and date on every leaf.",
    description: "Turns a client question into a MECE issue tree (layers 1-2 as yes/no hypotheses, layers 3-4 as data-answerable questions) and converts every leaf into a workplan line: the analysis, the data source, the owner and the due date. Checks its own tree for overlap and gaps before producing the plan.",
    roles: ["consultant", "corpfin", "student"], specialties: ["Strategy", "Commercial due diligence", "Operations & performance"],
    category: "Planning & forecasting", icon: "Network", deliverable: "checklist", savesMinutes: 150, tags: ["MECE", "issue tree", "workplan", "hypothesis"], effort: "medium",
    fields: [
      { key: "question", label: "Client question", type: "textarea", required: true, placeholder: "Should we enter the US mid-market payroll software segment?" },
      { key: "decomposition", label: "Primary decomposition", type: "select", options: ["Algebra / proven formula", "Process / funnel", "Segmentation", "Conceptual framework", "Opposite pairs", "Let the model choose"], default: "Let the model choose" },
      { key: "weeks", label: "Case length", type: "number", unit: "weeks", default: 6, min: 2, max: 16 },
      { key: "team", label: "Team", type: "text", placeholder: "1 EM, 2 consultants, 1 analyst" },
      { key: "ticker", label: "Public comparable (optional)", type: "ticker", help: "Used to anchor the tree's numbers in real disclosures" },
    ],
    example: { question: "Should our client, a $1.2B specialty distributor, enter the US mid-market payroll software segment, and can it reach $100M of EBIT within five years?", decomposition: "Algebra / proven formula", weeks: 6, team: "1 EM, 2 consultants, 1 analyst", ticker: "PCTY" },
    instructions: `1. Restate the question as a decision with a number and a date ("Can the client reach $100M EBIT in segment X by FY31?"). 2. Build the tree. Layers 1-2 are falsifiable yes/no hypotheses; layers 3-4 are open questions a data point can answer. Use the decomposition requested, defaulting to the strongest of: proven formula (Profit = Revenue - Cost; Revenue = Volume x Price), dimensional complement (market x share), funnel (aware -> considered -> won -> retained), or sum of segments (product x customer x geography x channel). Be MECE at every level, one layer at a time, and separate fundamentally different problems early. 3. Pressure-test your own tree: name any overlap between siblings and anything the tree misses, then fix it. 4. If a ticker is given, call get_company_financials and search_filing on its 10-K for "segment", "competition", "our strategy" and "customers" so the tree's quantities (market size, share, price points, cost lines) reference real disclosures rather than placeholders; call get_xbrl_series with Revenues, OperatingIncomeLoss and SellingGeneralAndAdministrativeExpense for the economics of a leaf. 5. Convert every leaf into a workplan line: analysis, method, data source (SEC filing, expert call, survey, client data room, government statistics), owner by role, due date inside the case length, and the "so what if true". 6. Sequence to answer-first: put the two analyses that could kill the hypothesis in week 1.
Produce: callout with the restated question and the day-one hypothesis; steps "Issue tree" (one item per layer-1 branch, detail listing its children as "1.1 ... 1.2 ..."); table "Workplan" with columns Branch, Analysis, Method, Data source, Owner, Due, Kills the hypothesis if; checklist "Week 1 must-dos" with owner and due; risks "Where this tree could be wrong" (3-4, severity, mitigation); bullets "MECE check" naming overlaps removed and gaps added. If the question is too vague to decompose, say so in the callout and offer the two sharper questions you would take to the partner.`,
    prompt: (i) => `Build a MECE issue tree and workplan for: ${str(i, "question")}\n\nPrimary decomposition: ${str(i, "decomposition", "Let the model choose")}. Case length: ${num(i, "weeks", 6)} weeks. Team: ${str(i, "team", "1 EM, 2 consultants, 1 analyst")}.${str(i, "ticker") ? ` Anchor quantities in ${str(i, "ticker").toUpperCase()}'s disclosures.` : ""}`,
  },
  {
    kind: "ai", id: "strat-hypothesis-storyline", title: "Hypothesis-driven storyline", tagline: "Governing thought, key lines and support: the pyramid before anyone builds a chart.",
    description: "Writes the storyline for a case or workstream in pyramid-principle form: one governing thought, three to five mutually exclusive key lines, and the support under each, ordered as Situation, Complication, Question, Answer. Grades each key line on whether the evidence in hand actually carries it and names the analysis that would close the gap.",
    roles: ["consultant", "corpfin", "student"], specialties: ["Strategy", "Commercial due diligence", "Operations & performance"],
    category: "Deliverables", icon: "Layers", deliverable: "memo", savesMinutes: 120, tags: ["pyramid principle", "SCQA", "storyline", "Minto"], effort: "medium",
    fields: [
      { key: "question", label: "The question being answered", type: "text", required: true, placeholder: "Should the sponsor pay 11x for this asset?" },
      { key: "hypothesis", label: "Working answer", type: "textarea", required: true, placeholder: "Yes, but only if the price increase holds and the top-3 concentration can be diluted" },
      { key: "evidence", label: "Evidence so far", type: "textarea", required: true, placeholder: "One finding per line: what you found, from which source" },
      { key: "structure", label: "Structure", type: "select", options: ["SCQA", "Pyramid (governing thought then key lines)", "Both"], default: "Both" },
      { key: "audience", label: "Audience", type: "select", options: ["Investment committee", "Steering committee", "CEO / CFO", "Lender group", "Board"], default: "Investment committee" },
    ],
    example: { question: "Should the sponsor pay 11x LTM EBITDA for a $180M-revenue specialty coatings distributor?", hypothesis: "Yes at 10x, not 11x: the market grows with non-residential construction, the target's share gains are real, but 41% top-3 concentration and a 2024 price increase that has not been retested cap the underwriting.", evidence: "Market grew 5.4% p.a. 2019-2025 per public filers' segment commentary\nTop 3 customers = 41% of revenue, two contracts renew within 18 months\nGross margin +210bps since 2023, of which ~150bps is price\nNRR of the top 50 accounts is 96%\nTwo of five expert calls said a competitor is quoting 8% below list\nEBITDA add-backs include owner compensation of $2.1M and \"one-time\" ERP costs that appear in three of four years", structure: "Both", audience: "Investment committee" },
    instructions: `1. Write the governing thought: one sentence that answers the question, carries a number, and could be wrong. 2. Derive three to five key lines that are mutually exclusive and, taken together, force the governing thought. Order them by inductive weight, not by workstream. 3. Under each key line, list the support actually available from the evidence provided, tagged [fact], [analysis] or [judgment]. 4. Grade each key line: Carried (evidence sufficient), Thin (directionally supported, needs one more analysis) or Unsupported (assertion). Name the single analysis that would move each Thin or Unsupported line to Carried, and who owns it. 5. Lay the same content out as SCQA when requested: Situation (what the audience already agrees on), Complication (what changed or what is at risk), Question (the decision), Answer (the governing thought). 6. Write the horizontal-logic test: read the key lines in order as a paragraph and say whether it reads as an argument or a table of contents; if the latter, rewrite the key lines. 7. Use get_company_financials or search_filing only to check a number the evidence asserts; do not add new research. 8. Tailor the ask: an investment committee needs the price and the conditions, a steering committee needs decisions required, a lender group needs liquidity and covenants.
Produce: callout with the governing thought; markdown "SCQA" (four short paragraphs) when requested; table "Pyramid" with columns Key line (as a full-sentence action title), Support, Type, Grade, Analysis to close the gap, Owner; score "Evidence strength" scoring each key line 1-5 with the reason; bullets "Horizontal logic read-back" (the key lines read as one paragraph); bullets "What would change the answer"; nextSteps ordered by what unblocks the decision. Never pad a key line with restated support; if the evidence cannot carry a fourth line, produce three.`,
    prompt: (i) => `Build the ${str(i, "structure", "Both")} storyline for a ${str(i, "audience", "investment committee")}.\n\nQuestion: ${str(i, "question")}\nWorking answer: ${str(i, "hypothesis")}\n\nEvidence:\n${str(i, "evidence")}`,
  },
  {
    kind: "ai", id: "strat-market-model-workbench", title: "Market model workbench", tagline: "Top-down and bottom-up sizing, reconciled, with every input sourced and confidence-tagged.",
    description: "Builds the CDD market model both ways: top-down from a public macro anchor through geography, segment and eligibility filters to SAM and SOM, and bottom-up from units times price or accounts times ACV. Reconciles the two, flags divergence beyond 15% as an assumption problem rather than a rounding problem, and exposes base, upside and downside drivers.",
    roles: ["consultant", "pe", "corpfin", "student"], specialties: ["Strategy", "Commercial due diligence", "Economic & valuation advisory"],
    category: "Modeling", icon: "Target", deliverable: "model", savesMinutes: 300, tags: ["TAM", "SAM", "SOM", "market sizing", "triangulation"], effort: "high",
    fields: [
      { key: "market", label: "Market definition", type: "text", required: true, placeholder: "US commercial HVAC maintenance and repair services" },
      { key: "geography", label: "Geography", type: "text", default: "United States" },
      { key: "segments", label: "Segments to size", type: "text", placeholder: "office, healthcare, education, industrial" },
      { key: "tickers", label: "Public filers in this market", type: "tickers", placeholder: "FIX EME WSO", help: "Used to anchor revenue, pricing and growth from 10-K segment disclosures" },
      { key: "unit", label: "Bottom-up unit", type: "select", options: ["Sites x visits x price", "Accounts x ACV", "Units x price", "Installed base x attach rate x price", "Transactions x take rate"], default: "Accounts x ACV" },
      { key: "price", label: "Price per unit", type: "number", unit: "$000s", default: 18, help: "ACV, contract value, or price per unit in thousands" },
      { key: "notes", label: "Client context", type: "textarea", placeholder: "Who is asking, what decision the number drives, any client data already in hand" },
    ],
    example: { market: "US commercial HVAC maintenance and repair services", geography: "United States", segments: "office, healthcare, education, industrial", tickers: ["FIX", "EME", "WSO", "CARR", "LII"], unit: "Sites x visits x price", price: 18, notes: "A PE-backed regional mechanical services platform is underwriting a buy-and-build; the number drives the entry multiple and the geographic sequencing." },
    instructions: `1. Fix the market boundary first: what is in, what is out, the unit of measure, and the period. State it in one sentence; most sizing errors are definitional.
2. Top-down. Use web_research for the macro anchor (industry revenue, establishment counts, spend per establishment) and prefer government sources with an audit trail: Census County Business Patterns and SUSB for establishment and employment counts, the Economic Census for industry revenue, BEA GDP-by-industry and input-output tables for value added, BLS OES wages and PPI for cost and price inflation. Then filter: anchor -> geography -> segment -> eligible (SAM) -> penetration (SOM). Record each filter's value, source and confidence (High = cited public statistic, Medium = triangulated, Low = judgment).
3. Anchor to filings, keeping this step inside roughly 15 tool calls. Use at most two web_research calls for the macro anchor. Then for each ticker call get_company_financials and one get_xbrl_series with Revenues and OperatingIncomeLoss for the trend; run search_filing on the 10-K only for the two phrases that bear on the sizing, chosen from "segment", "customers", "backlog" and "properties", and only for the two or three filers closest to the market being sized. Derive at least two public anchors the model must respect: total revenue of the named filers in this market, and an implied price or revenue-per-unit (revenue per site, per employee, per contract) computed with calc.
4. Bottom-up. Build the requested unit chain explicitly (sites x visits per year x price, or reachable accounts x win rate x ACV) with every factor sourced. Use the public filers' disclosed unit counts, branch counts or headcount from the 10-K as the reality check on your unit count.
5. Reconcile with calc: gap = (bottom-up - top-down) / midpoint. Within 15% call the assumptions sound; beyond 15% name the one or two filters or factors that explain the gap and give the reconciled number with the reason for choosing it. Never average away a divergence you cannot explain.
6. Scenarios: build pessimistic / base / optimistic by moving the two highest-leverage drivers only, and state the growth CAGR with its driver (construction starts, installed base, replacement cycle, pricing).
Produce: kpis (TAM, SAM, SOM, bottom-up estimate, gap %, reconciled market size, CAGR); markdown "Market definition" (boundary, unit, period, what is excluded); waterfall "Top-down funnel" from the anchor through each filter to SOM; table "Top-down build" (Step, Value, Filter applied, Source, Confidence); table "Bottom-up build" (Factor, Value, Source, Confidence) with a totals row; bar comparing top-down SOM, bottom-up and reconciled; table "Scenarios" (Driver, Down, Base, Up, Implied market size); bullets "Three assumptions that drive the answer"; caveats naming every Low-confidence input. If a macro anchor cannot be found, say so and size bottom-up only, labelling the output an estimate with no independent anchor rather than inventing a TAM. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Size ${str(i, "market")} in ${str(i, "geography", "the United States")} both ways and reconcile.${str(i, "segments") ? ` Segments: ${str(i, "segments")}.` : ""} Bottom-up unit: ${str(i, "unit", "Accounts x ACV")} at roughly $${num(i, "price", 18)}k per unit.${list(i, "tickers").length ? ` Anchor to these public filers: ${list(i, "tickers").join(", ")}.` : ""}${str(i, "notes") ? `\n\nContext: ${str(i, "notes")}` : ""}`,
  },
  {
    kind: "ai", id: "strat-five-forces", title: "Five forces from filings", tagline: "Porter's five forces scored 1-5 with the filing language that justifies each score.",
    description: "Scores market attractiveness on rivalry, buyer power, supplier power, threat of entry and substitutes, pulling the evidence from incumbents' own 10-K competition, customers and risk-factor language rather than from assertion. Ends with the sustainable margin the structure implies and what would change each rating.",
    roles: ["consultant", "pe", "student"], specialties: ["Strategy", "Commercial due diligence", "Economic & valuation advisory"],
    category: "Research", icon: "Shield", deliverable: "analysis", savesMinutes: 180, tags: ["Porter", "five forces", "market attractiveness"], effort: "high",
    fields: [
      { key: "market", label: "Market", type: "text", required: true, placeholder: "US fast-casual restaurant chains" },
      { key: "tickers", label: "Incumbents", type: "tickers", required: true, placeholder: "CMG MCD YUM" },
      { key: "boundary", label: "Where you would draw the boundary", type: "text", placeholder: "Include QSR and fast casual, exclude full-service and grocery prepared foods" },
    ],
    example: { market: "US fast-casual and quick-service restaurants", tickers: ["CMG", "MCD", "YUM", "WING", "DPZ"], boundary: "Include limited-service chains with national scale; exclude full-service dining and grocery prepared food, but treat both as substitutes." },
    instructions: `1. Heed Porter's warning that managers define competition too narrowly, as if it occurred only among today's direct competitors: state the boundary, then name the substitutes and potential entrants that sit outside it. 2. Gather evidence force by force rather than company by company, and keep the whole set inside roughly 25 tool calls. Call get_trading_comps once for the incumbents, then get_company_financials only for the two or three that matter most to the structure. Assign each force two search phrases and run them against the one or two incumbents most likely to disclose on it: rivalry "competition" and "we compete"; buyer power "customers" and "concentration of credit risk"; supplier power "raw materials" and "suppliers"; entry "barriers to entry" and "government regulation"; substitutes "substitute" and "pricing pressure". Expand with read_filing only the three or four hits you intend to quote. Do not run every phrase against every incumbent. 3. Quantify each force with numbers, not adjectives: rivalry from the spread in operating margin and revenue growth across incumbents (get_trading_comps) plus the share held by the top three; buyer power from customer concentration disclosures and the gross margin trend; supplier power from input-cost language, PPI exposure and any single-source disclosure; entry from capex intensity (get_xbrl_series with PaymentsToAcquirePropertyPlantAndEquipment over Revenues), regulatory approvals and brand or scale minimums; substitutes from the economics of the next best alternative. 4. Score each force 1 (structurally unattractive) to 5 (attractive to incumbents), with the evidence and the one datum that would move it. 5. Conclude with the sustainable margin the structure supports, compared with the incumbents' actual operating margins, and say which incumbent's position the structure favours.
Produce: score "Five forces" (five items, score out of 5, note = the evidence in one line); table "Evidence" with columns Force, Score, Quantitative evidence, Filing language (short quote with citation), What would change it; kpis (top-3 share, incumbent operating margin range, revenue growth range, capex % of revenue); bar of operating margin by incumbent; callout with the overall attractiveness verdict and the implied sustainable margin; risks "Structural threats over three years" with severity. If a force cannot be evidenced from filings, score it and mark the evidence as judgment in the table rather than leaving it blank. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Score the five forces for ${str(i, "market")} using ${list(i, "tickers").join(", ")} as the incumbents.${str(i, "boundary") ? ` Boundary: ${str(i, "boundary")}.` : ""}`,
  },
  {
    kind: "ai", id: "strat-profit-pool-map", title: "Profit pool mapper", tagline: "Revenue and margin by value-chain step from segment disclosures, reconciled to the industry total.",
    description: "Maps where the profit sits along a value chain using the Bain four-step method: define the pool's boundaries, size the total, size each activity from pure-play filers' segment disclosures, then check and reconcile. Plots revenue against operating margin so the area of each block is the profit, and states the method behind every estimate.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Strategy", "Commercial due diligence", "Economic & valuation advisory"],
    category: "Research", icon: "PieChart", deliverable: "analysis", savesMinutes: 300, tags: ["profit pool", "value chain", "segments", "Bain"], effort: "high",
    fields: [
      { key: "market", label: "Industry / value chain", type: "text", required: true, placeholder: "US non-residential HVAC value chain" },
      { key: "steps", label: "Value-chain steps", type: "text", required: true, placeholder: "components, equipment OEM, distribution, mechanical contracting, service, controls software" },
      { key: "tickers", label: "Pure-play or segment filers", type: "tickers", required: true, placeholder: "LII CARR WSO FIX EME" },
      { key: "total", label: "Known industry revenue (optional)", type: "number", unit: "$mm", default: 0, help: "Leave at zero to build the total from the steps" },
    ],
    example: { market: "US non-residential HVAC value chain", steps: "components, equipment OEM, distribution, mechanical contracting and installation, service and maintenance, controls and building software", tickers: ["LII", "CARR", "WSO", "FIX", "EME", "JCI"], total: 0 },
    instructions: `1. Define the pool's boundaries: list the value-chain activities in sequence, say which are in the pool and which are adjacent, and fix the geography and period. 2. Assign each ticker to the step or steps it occupies, covering at most six filers and keeping the retrieval to about four calls each so the whole map stays inside roughly 25 tool calls. Per filer: get_company_financials; one get_xbrl_series call with Revenues, OperatingIncomeLoss, CostOfRevenue and SellingGeneralAndAdministrativeExpense for three years; one search_filing on the 10-K for "segment information" or "reportable segments"; and at most one read_filing to pull the segment revenue and segment operating income table. Skip the filing search entirely for a single-segment pure play, where the XBRL totals already are the step. 3. Size each step: revenue = disclosed segment revenue for the filers plus an estimated tail for private players, where the tail is built from a stated method (share implied by the filers' own commentary, establishment counts from web_research on Census data, or revenue per unit of activity). Margin = segment operating margin of the pure plays, adjusted for mix, with the method named. 4. Reconcile with calc: the sum of step revenues against the known industry revenue if given, or against a top-down anchor found with web_research; if the gap exceeds 10% name what is double-counted (intra-chain sales are the usual culprit) or missing, and restate. 5. Compute profit per step = revenue x margin, each step's share of total profit, and profit per dollar of revenue. Say where profit is migrating and why, using the three-year margin trend by step.
Produce: kpis (pool revenue, pool profit, most profitable step, its share of profit, reconciliation gap %); table "Profit pool" with columns Step, Revenue ($mm), Method, Operating margin, Profit ($mm), % of pool profit, Source, Confidence, with a totals row; scatter with xLabel "Revenue ($mm)" and yLabel "Operating margin" plotting each step so the area reads as profit; bar of profit by step; markdown "Where profit is migrating" with the three-year trend and the causal mechanism; bullets "Implications for the client's position in the chain"; caveats on intra-chain double counting, segment definitions that differ between filers, and every estimated tail. Where a step has no public filer, mark it Estimated and give the build; do not present it as reported. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Map the profit pool for ${str(i, "market")} across these steps: ${str(i, "steps")}. Use ${list(i, "tickers").join(", ")} as the public anchors.${num(i, "total") > 0 ? ` Reconcile to a total industry revenue of $${num(i, "total")}mm.` : ""}`,
  },
  {
    kind: "ai", id: "strat-ghost-deck", title: "Ghost deck generator", tagline: "Action titles in SCQA order with the exhibit each slide needs, before anyone opens PowerPoint.",
    description: "Turns a findings log and the case question into a ghost deck: a numbered storyline of action titles of fifteen words or fewer, one message per slide, each with the exhibit that proves it, the data source and the owner. Runs the horizontal-logic test on the title sequence and the vertical-logic test on each title against its exhibit.",
    roles: ["consultant", "corpfin", "student"], specialties: ["Strategy", "Commercial due diligence", "Operations & performance", "Restructuring / turnaround"],
    category: "Deliverables", icon: "Presentation", deliverable: "deck", savesMinutes: 240, tags: ["ghost deck", "action titles", "SCQA", "storyline"], effort: "medium",
    fields: [
      { key: "question", label: "Deck question", type: "text", required: true, placeholder: "Should we acquire the platform and at what price?" },
      { key: "findings", label: "Findings log", type: "textarea", required: true, placeholder: "One finding per line, with the number and the source" },
      { key: "audience", label: "Audience", type: "select", options: ["Steering committee", "Investment committee", "CEO / CFO", "Board", "Lender group", "Client working session"], default: "Steering committee" },
      { key: "slides", label: "Target slide count", type: "number", default: 12, min: 5, max: 30 },
      { key: "exec", label: "Include a 2-page executive summary", type: "toggle", default: true },
    ],
    example: { question: "Should the sponsor acquire the specialty coatings distributor, and at what price?", findings: "Market grew 5.4% p.a. 2019-2025; non-residential construction starts are the driver\nTarget gained ~180bps of share in two regions, lost share in one\nTop 3 customers = 41% of revenue; two contracts renew inside 18 months\nGross margin +210bps since 2023, ~150bps of it price, not yet retested\nNRR of the top 50 accounts is 96%; 4 of 22 lost accounts cited service levels\nSeller add-backs of $4.3M include $2.1M owner comp and ERP costs recurring in 3 of 4 years\nNWC peg on a TTM average is $2.4M above the seller's proposed 3-month average\nTwo of five expert calls say a competitor quotes 8% below list in the education vertical", audience: "Investment committee", slides: 12, exec: true },
    instructions: `1. Read the findings log and cluster it into the three to five messages that decide the question. Discard findings that do not change the decision; a ghost deck is an argument, not an inventory. 2. Write the storyline in SCQA order: Situation (what the audience accepts), Complication (what changed or is at risk), Question (the decision), Answer (the recommendation with the number and the condition). 3. Write one action title per slide: a full sentence stating the takeaway, fifteen words or fewer, two lines maximum, no label titles ("Market overview" is a failure). Each title must be falsifiable and carry a number where one exists. 4. Specify the exhibit each title needs: chart type, axes, cut of the data, and the source line that will sit on the page. Name the analysis that produces it and the owner. 5. Run the horizontal-logic test: read the titles in order as a paragraph and state whether it argues to the recommendation; fix any title that only announces a topic. Run the vertical-logic test: for each title say whether its exhibit alone proves it, and flag titles whose support is an assertion. 6. If a needed number is missing from the findings log, do not invent it: mark the slide "data gap" with the request that would fill it. Use search_filing or get_company_financials only to verify a figure the log asserts. 7. Include the executive summary when asked: page one the answer and the three reasons, page two the conditions, risks and the ask.
Produce: callout with the one-sentence answer; steps "Storyline" (one item per slide, title = the action title, detail = exhibit, source and owner); table "Slide plan" with columns #, Action title, Exhibit, Cut of data, Source, Owner, Support strength; markdown "Executive summary" when requested; bullets "Horizontal logic read-back" (titles read as one paragraph); bullets "Data gaps to close before the meeting"; caveats on any title graded thin. Keep the deck at the requested length by cutting slides, not by shortening the argument.`,
    prompt: (i) => `Build a ${num(i, "slides", 12)}-slide ghost deck for a ${str(i, "audience", "steering committee")} answering: ${str(i, "question")}${bool(i, "exec", true) ? " Include a two-page executive summary." : ""}\n\nFindings log:\n${str(i, "findings")}`,
  },
  {
    kind: "ai", id: "strat-steerco-update", title: "SteerCo update drafter", tagline: "Progress vs plan, findings, decisions required, risks and next steps, in the standard order.",
    description: "Drafts the weekly steering committee pages from the workplan status and the findings log, in the order client executives expect: progress against plan, what we now believe, the decisions the committee must take this week, risks with owners, and next steps. Every decision comes with the recommendation, the options and the cost of delay.",
    roles: ["consultant", "corpfin"], specialties: ["Strategy", "Operations & performance", "Restructuring / turnaround", "Technology & digital"],
    category: "Communication", icon: "Users", deliverable: "deck", savesMinutes: 120, tags: ["SteerCo", "governance", "status", "PMO"], effort: "medium",
    fields: [
      { key: "project", label: "Project / codename", type: "text", required: true, placeholder: "Project Meridian - cost transformation" },
      { key: "week", label: "Week", type: "number", default: 4, min: 1, max: 52 },
      { key: "status", label: "Workplan status", type: "textarea", required: true, placeholder: "One line per workstream: owner, plan, actual, RAG" },
      { key: "findings", label: "Findings this period", type: "textarea", required: true },
      { key: "decisions", label: "Decisions needed", type: "textarea", placeholder: "One per line, with the options you see" },
      { key: "meeting", label: "Meeting date", type: "date" },
    ],
    example: { project: "Project Meridian - SG&A cost transformation", week: 4, status: "Cost baseline: analyst owner, plan 100% mapped, actual 92% mapped, amber - two entities' GL still outstanding\nBenchmarking: consultant owner, complete, green\nOpportunity sizing: EM owner, plan 60%, actual 60%, green\nOperating model options: plan 20%, actual 0%, red - waiting on the HR census", findings: "Mapped baseline is $612M, $38M higher than the budget view because of intercompany allocations\nSG&A at 24.1% of revenue vs peer median 19.8% and top quartile 17.2%\nGap to median is $85M; gap to top quartile is $147M\nSpans and layers: 9 layers to the front line, average span 4.1 vs benchmark 6-8\nProcurement: 62% of addressable spend is off-contract", decisions: "Approve the $85M target (median) or the $110M stretch\nWhether to include the two unmapped entities in the wave-1 scope\nRelease of the HR census to the team", meeting: "2026-09-24" },
    instructions: `1. Open with the one-line message of the week: what the committee should take away before any detail. 2. Progress vs plan: one row per workstream with owner, planned completion, actual, RAG status and the reason for anything not green. Do not soften red; say what is blocked and who unblocks it. 3. What we now believe: convert findings into two to four statements with numbers, each labelled Confirmed, Emerging or Being tested, and say which earlier belief has changed. 4. Decisions required: for each, the decision in one sentence, the options with their consequences, your recommendation, the owner and the cost of delaying a week. A SteerCo page with no decisions is a status report, so if none is needed say so explicitly. 5. Risks: a register with severity, owner and mitigation, including data-access and client-capacity risks. 6. Next two weeks: the analyses that close the open questions, with dates, plus what the team needs from the committee. 7. Use calc for any arithmetic in the numbers quoted, and verify externally checkable figures with get_company_financials or get_xbrl_series where a ticker is implied; never restate a client number you cannot source.
Produce: callout with the message of the week; table "Progress vs plan" (Workstream, Owner, Plan, Actual, RAG, Comment); bullets "What we now believe" with Confirmed / Emerging / Being tested tags; table "Decisions required" (Decision, Options, Recommendation, Owner, Cost of delay); risks (3-5 with severity and mitigation); checklist "Next two weeks" with owner and due date; email draft of the pre-read note to the committee chair. Keep every cell short enough to read on a slide.`,
    prompt: (i) => `Draft the week ${num(i, "week", 4)} steering committee update for ${str(i, "project")}${str(i, "meeting") ? `, meeting ${str(i, "meeting")}` : ""}.\n\nWorkplan status:\n${str(i, "status")}\n\nFindings this period:\n${str(i, "findings")}${str(i, "decisions") ? `\n\nDecisions needed:\n${str(i, "decisions")}` : ""}`,
  },
  {
    kind: "ai", id: "strat-number-tie-out", title: "Number tie-out guardian", tagline: "Every number in the deck checked against the model, by slide, cell and magnitude.",
    description: "Extracts every figure from pasted slide text and reconciles it to the model or databook extract, listing mismatches by slide with the magnitude and the likely cause: stale refresh, unit error, rounding, scope difference or a genuine error. Also flags internally inconsistent numbers inside the deck, such as parts that do not sum to the stated total.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Strategy", "Financial due diligence (TAS)", "Operations & performance", "Commercial due diligence"],
    category: "Reporting", icon: "CheckSquare", deliverable: "checklist", savesMinutes: 180, tags: ["tie-out", "quality control", "review", "databook"], effort: "high",
    fields: [
      { key: "deck", label: "Deck text", type: "textarea", required: true, placeholder: "Paste slide by slide: 'Slide 4: Revenue grew to $184.2M in FY25, +6.1%...'" },
      { key: "model", label: "Model / databook extract", type: "csv", required: true, columns: "label, value, units, period, source_cell", placeholder: "label,value,units,period,source_cell" },
      { key: "tolerance", label: "Tolerance", type: "number", unit: "%", default: 0.5, min: 0, max: 10, step: 0.1 },
      { key: "units", label: "Deck units", type: "select", options: ["$mm", "$000s", "$", "Mixed"], default: "$mm" },
    ],
    example: {
      deck: "Slide 3: Revenue reached $184.2M in FY25, up 6.1% on FY24.\nSlide 4: Gross margin expanded 210bps to 31.4%; gross profit was $57.8M.\nSlide 5: Adjusted EBITDA of $22.6M represents a 12.3% margin after $4.3M of add-backs.\nSlide 6: The top three customers are 41% of revenue, or $75.5M.\nSlide 9: The NWC peg is $18.4M on a trailing twelve month average.\nSlide 11: At 10.0x adjusted EBITDA the enterprise value is $226M and the equity cheque is $198M.",
      model: "label,value,units,period,source_cell\nRevenue,184.2,$mm,FY25,Databook!C14\nRevenue,173.6,$mm,FY24,Databook!B14\nGross profit,57.4,$mm,FY25,Databook!C22\nGross margin,31.2,%,FY25,Databook!C23\nAdjusted EBITDA,22.6,$mm,FY25,QoE!F31\nAdd-backs accepted,3.9,$mm,FY25,QoE!F28\nTop 3 customer revenue,75.5,$mm,FY25,Rev!H9\nNWC peg (TTM average),18.9,$mm,TTM Jun-26,NWC!D40\nNet debt,28.0,$mm,Jun-26,Bridge!C12",
      tolerance: 0.5, units: "$mm",
    },
    instructions: `1. Extract every number from the deck text with its slide, its label, its unit and its period. Normalize units to the stated deck unit before comparing; $000s against $mm and bps against % are the two most common false positives. 2. Match each deck number to a model row by label, period and unit. Where a label is ambiguous, say which model rows it could mean and do not assert a match. 3. Compare: pass if the absolute difference is within the tolerance as a percentage of the model value; otherwise a mismatch, with the difference in both absolute and percentage terms. 4. Classify each mismatch: stale (the deck matches an older value), unit error, rounding beyond tolerance, scope difference (reported vs adjusted, TTM vs FY, gross vs net), derived-number error (the deck's own arithmetic), or unsupported (no model row exists). 5. Check the deck against itself: recompute every stated growth rate, margin, multiple, sum of parts and percentage of total with calc, and flag any that the deck's own numbers do not produce. Percentages of a total must sum to 100 and parts must sum to the stated total. 6. Verify externally checkable figures (a public company's revenue, a peer median) with get_company_financials or get_xbrl_series and flag any that the filings contradict. 7. Rank the findings by the size of the number and the seniority of the audience, not by slide order.
Produce: kpis (numbers checked, matched, mismatched, unsupported, largest mismatch); callout naming the single mismatch to fix first and why; table "Mismatches" with columns Slide, Label, Deck value, Model value, Difference, Difference %, Model cell, Classification, Fix; table "Internal consistency" (Slide, Stated relationship, Recomputed, Verdict); bullets "Unsupported numbers" (in the deck with no model row); checklist "Fix list" ordered by materiality with owner. If the deck text contains no extractable numbers, say so plainly rather than producing an empty table.`,
    prompt: (i) => `Tie out every number in this deck against the model extract at a ${num(i, "tolerance", 0.5)}% tolerance. Deck units are ${str(i, "units", "$mm")}.\n\nDeck text:\n${str(i, "deck")}`,
  },

  /* ---------------- Commercial due diligence ---------------- */
  {
    kind: "ai", id: "cdd-peer-benchmark-builder", title: "Peer benchmark builder", tagline: "Quartile benchmarking on margins, SG&A, R&D and working capital, with the gap to median in dollars.",
    description: "Builds the benchmark table that opens most strategy, CDD and cost cases: gross and EBITDA margin, SG&A %, R&D %, DSO, DIO, DPO, cash conversion cycle and revenue per employee for a target and five to fifteen peers, straight from SEC XBRL with the tag used on every line. Presents quartiles, the target's position, and the gap to median converted into dollars of annual cost.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Strategy", "Commercial due diligence", "Operations & performance", "Technology & digital"],
    category: "Diligence", icon: "BarChart3", deliverable: "table", savesMinutes: 240, tags: ["benchmarking", "quartiles", "XBRL", "SG&A"], effort: "high",
    fields: [
      { key: "ticker", label: "Target", type: "ticker", required: true, placeholder: "CMG" },
      { key: "peers", label: "Peers", type: "tickers", placeholder: "MCD SBUX YUM WING DPZ", help: "Leave blank to have the model propose a set and justify it" },
      { key: "metrics", label: "Metrics", type: "multiselect", options: ["Gross margin", "EBITDA margin", "Operating margin", "SG&A %", "R&D %", "Revenue per employee", "DSO", "DIO", "DPO", "Cash conversion cycle", "Capex %", "Revenue growth"], default: ["Gross margin", "EBITDA margin", "SG&A %", "Revenue growth", "Cash conversion cycle"] },
      { key: "years", label: "Fiscal years", type: "number", default: 3, min: 1, max: 5 },
    ],
    example: { ticker: "CMG", peers: ["MCD", "SBUX", "YUM", "WING", "DPZ"], metrics: ["Gross margin", "EBITDA margin", "SG&A %", "Revenue growth", "Cash conversion cycle"], years: 3 },
    instructions: `1. If peers are blank, propose 6-10 US filers matched on business model, scale and buyer universe, and state the inclusion logic and anything deliberately excluded. Cross-check the set against the target's own DEF 14A compensation peer group via search_filing on "peer group" and against the 10-K "competition" section. 2. Keep the whole build inside roughly 30 tool calls: cap the peer set at eight companies, and prefer one batched XBRL call per company over repeated filing searches. Call get_trading_comps once for the target and peers for valuation and growth, then for every company make a single get_xbrl_series call for the requested number of fiscal years carrying every concept the selected metrics need: Revenues and RevenueFromContractWithCustomerExcludingAssessedTax, CostOfRevenue, GrossProfit, SellingGeneralAndAdministrativeExpense, GeneralAndAdministrativeExpense, SellingAndMarketingExpense, ResearchAndDevelopmentExpense, OperatingIncomeLoss, DepreciationDepletionAndAmortization, AccountsReceivableNetCurrent, InventoryNet, AccountsPayableCurrent and PaymentsToAcquirePropertyPlantAndEquipment. When a concept is absent, use get_xbrl_series with find (for example "Selling|Administrative|ResearchAndDevelopment|Inventory") to locate the filer's actual tag, and record which tag you used for each company. 3. Compute with calc: margins on revenue; SG&A % and R&D % of revenue; DSO = AR / revenue x 365, DIO = inventory / cost of revenue x 365, DPO = payables / cost of revenue x 365, CCC = DSO + DIO - DPO; capex % of revenue. For revenue per employee, get headcount from search_filing on the 10-K for "human capital", "employees" or "full-time employees" (it is not reliably in XBRL) and say where it came from. 4. Build quartiles across the peer set for each metric (Q1, median, Q3) and place the target, stating whether high or low is better for each. 5. Convert the gap to median into dollars: the gap in percentage points times target revenue. Do the same for the top quartile. 6. Explain the two largest gaps from the filings, but only for the target and the single best-performing peer, with two search phrases each drawn from "results of operations", "cost of sales", "selling, general and administrative" and "restructuring", to find the mix, pricing, scale or investment-phase reason. Do not read filings for every peer. 7. Calendarize: note fiscal year ends that differ and whether you aligned them.
Produce: kpis (target vs peer median on the first three metrics with delta and tone, plus the total gap-to-median in dollars); table "Benchmark" with the target first (emphasisRow 0), one column per metric, a median row in totals, and a Tag column naming the XBRL concept used; table "Quartiles" (Metric, Q1, Median, Q3, Target, Percentile, Gap to median $mm); bar of the primary metric with the target emphasized and a reference line at the median; scatter of revenue growth against the primary margin; markdown "Why the gaps exist" with filing citations; caveats on extension tags, custom taxonomies, fiscal-year offsets, adjusted vs reported figures and any company dropped for lack of data. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()} against ${list(i, "peers").length ? list(i, "peers").join(", ") : "a peer set you propose and justify"} on ${list(i, "metrics").join(", ") || "margins, SG&A and working capital"} over the last ${num(i, "years", 3)} fiscal years. Show quartiles and the gap to median in dollars.`,
  },
  {
    kind: "ai", id: "cdd-competitor-profile", title: "Competitor profile generator", tagline: "One sourced page per competitor from their own 10-K, with a confidence tag on every field.",
    description: "Builds the standard competitor profile for each name in a set: ownership, revenue, growth and margin, segment and geographic mix, headcount and hiring trend, product and pricing model, go-to-market, key customers and concentration, recent M&A and leadership changes, stated strategy, and the threat level to the client. Every field carries its source and a confidence tag, and the set ends in a comparison matrix scored against the client's key purchase criteria.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Commercial due diligence", "Strategy", "Technology & digital"],
    category: "Research", icon: "Radar", deliverable: "research", savesMinutes: 360, tags: ["competitor", "profile", "10-K", "landscape"], effort: "high",
    fields: [
      { key: "tickers", label: "Competitors", type: "tickers", required: true, placeholder: "LULU NKE DECK VFC UAA" },
      { key: "client", label: "Who is asking and why", type: "text", required: true, placeholder: "A sponsor underwriting a premium activewear brand" },
      { key: "criteria", label: "Key purchase criteria to score against", type: "text", placeholder: "product innovation, fit and quality, omnichannel experience, price-value" },
      { key: "privates", label: "Private competitors to cover", type: "text", placeholder: "Vuori, Alo Yoga", help: "Covered from web research and Form D, clearly labelled as estimates" },
    ],
    example: { tickers: ["LULU", "NKE", "DECK", "UAA"], client: "A sponsor underwriting a premium activewear brand at 11x EBITDA", criteria: "product innovation, fit and quality, omnichannel experience, price-value, brand heat", privates: "Vuori" },
    instructions: `1. Work one competitor at a time and keep the retrieval budget to about five calls each, so the whole set stays inside roughly 30 tool calls; cover at most six public competitors and say if you dropped any. Per competitor: get_company_financials; one get_xbrl_series call carrying Revenues, GrossProfit, OperatingIncomeLoss, SellingGeneralAndAdministrativeExpense and ResearchAndDevelopmentExpense for three years; then two or three search_filing calls on the latest 10-K chosen for what is still missing - "competition" for positioning, "segment" for mix, "human capital" for headcount, and "concentration of credit risk" only when concentration is in question. Expand at most one hit per competitor with read_filing, and only where a short quote of stated strategy or a headcount figure is needed. Stop searching a field once it is answered; do not run every phrase against every company. Call get_recent_filings with forms ["8-K"] once per competitor and note items 1.01, 2.01, 2.05, 2.06 and 5.02 for M&A, restructuring, impairments and leadership changes. 2. Fill the standard profile fields: ownership and control, taken from what get_company_financials and the 10-K already give you, and only worth a DEF 14A search for "beneficial ownership" where a founder, family or sponsor plainly controls the company and that control is part of the story; revenue, growth and EBITDA or operating margin; segment and geographic mix; headcount and the year-on-year change from the human capital disclosure; product portfolio and pricing model (list vs realized, subscription vs transactional); go-to-market and channel mix; key customers and any concentration disclosed under "concentration of credit risk"; recent M&A, capex and leadership changes; stated strategy in their own words with a short quote; strengths and weaknesses against the client's key purchase criteria; threat level to the client, High / Medium / Low, with the reason. 3. For private competitors spend at most two web_research calls and one form_d_search each: one research call for funding, scale and pricing signals, a second only to resolve a contradiction. Label every private figure Estimated with the method and never present it as reported; where scale is genuinely unknowable, say so rather than searching again. 4. Tag each field Reported (in a filing), Triangulated (two independent sources agree) or Estimated (single source or inference). 5. Score the comparison matrix on the client's criteria 1-5 with one line of evidence per cell, and say which competitor is most dangerous to the client and on which axis.
Produce: kpis (competitor count, revenue range, margin range, the fastest grower, the highest-margin operator); markdown "Profiles" with one ## section per competitor, each covering the standard fields in the same order with inline citations; table "Comparison matrix" (rows = competitors, columns = the client's key purchase criteria plus revenue, growth, margin, headcount, threat level); scatter of revenue against operating margin with the largest emphasized; bar of revenue growth by competitor; table "Recent moves" (Date, Company, Event, Source); bullets "So what for the client"; caveats listing every Estimated field and any competitor covered only from public web sources. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Profile these competitors for ${str(i, "client")}: ${list(i, "tickers").join(", ")}.${str(i, "privates") ? ` Also cover these private players from web research, labelled as estimates: ${str(i, "privates")}.` : ""}${str(i, "criteria") ? ` Score them against these key purchase criteria: ${str(i, "criteria")}.` : ""}`,
  },
  {
    kind: "ai", id: "cdd-report-outline", title: "CDD report assembler", tagline: "The commercial diligence report skeleton, filled to the red-flag thresholds a deal team tests.",
    description: "Assembles the standard CDD report: two-page executive summary, market attractiveness, competitive position and right to win, customer and revenue quality, the base-case revenue build, risks, and valuation implications. Runs the pre-LOI red-flag thresholds from the research (top-three concentration at or above 50%, NRR below 100%, NPS below 20, pipeline coverage below 3x quota, growth above 50% with no plan) and states which are tripped.",
    roles: ["consultant", "pe"], specialties: ["Commercial due diligence", "Strategy", "Financial due diligence (TAS)"],
    category: "Deliverables", icon: "ClipboardList", deliverable: "memo", savesMinutes: 420, tags: ["CDD", "red flags", "IC memo", "report"], effort: "high",
    fields: [
      { key: "target", label: "Target", type: "text", required: true, placeholder: "A $180M revenue specialty coatings distributor" },
      { key: "sector", label: "Sector / market", type: "text", required: true, placeholder: "US industrial coatings distribution" },
      { key: "thesis", label: "Sponsor thesis", type: "textarea", required: true, placeholder: "What the deal team believes and must be true" },
      { key: "tickers", label: "Public reference set", type: "tickers", placeholder: "SHW PPG RPM AXTA" },
      { key: "top3", label: "Top 3 customer concentration", type: "number", unit: "%", default: 41 },
      { key: "nrr", label: "Net revenue retention", type: "number", unit: "%", default: 96 },
      { key: "nps", label: "NPS", type: "number", default: 18, min: -100, max: 100 },
      { key: "coverage", label: "Pipeline coverage", type: "number", unit: "x", default: 2.4, step: 0.1 },
      { key: "growth", label: "Revenue growth, last year", type: "number", unit: "%", default: 7 },
      { key: "stage", label: "Stage", type: "select", options: ["Red-flag (pre-LOI)", "Full buy-side", "Vendor (sell-side) DD"], default: "Full buy-side" },
    ],
    example: { target: "A $180M revenue specialty coatings distributor serving industrial and education end markets", sector: "US industrial coatings distribution", thesis: "Buy-and-build: the platform holds a defensible regional position, the 2024 price increase is durable, and two bolt-ons take EBITDA from $23M to $38M in three years.", tickers: ["SHW", "PPG", "RPM", "AXTA"], top3: 41, nrr: 96, nps: 18, coverage: 2.4, growth: 7, stage: "Full buy-side" },
    instructions: `1. Start from the thesis and write it as a list of "must be true" statements; the report exists to test them, and each section must return a verdict on one of them. 2. Apply the red-flag thresholds to the inputs and say Tripped, Watch or Clear for each: top-three concentration at or above 50% (Watch from 30%), NRR below 100%, NPS below 20, pipeline coverage below 3x quota, revenue growth above 50% with no articulated plan, and any single contract renewing inside the hold period that exceeds 10% of revenue. Quantify the exposure in dollars, not just flags. 3. Build market attractiveness from the reference set: get_trading_comps, then search_filing on each filer's 10-K for "competition", "segment", "demand", "pricing" and "raw materials", and get_xbrl_series with Revenues and OperatingIncomeLoss for three years to evidence growth and the margin structure the market supports. Use web_research for the macro driver and market growth, cited. 4. Competitive position and right to win: share and share momentum with the method stated, the two or three capabilities that produce the right to win, and what a competitor would have to do to take it away. 5. Customer and revenue quality: concentration at the gross-profit level as well as revenue, cohort retention and NRR, win/loss themes, contract structure and the evidence of pricing power. 6. Base-case revenue build: volume x price by segment, bridged from the last actual year to the exit year, with each driver tied to an analysis. 7. Valuation implications: what the findings do to the entry multiple and the underwriting, including the EBITDA effect of any revenue-quality finding at the deal multiple. 8. Scope to stage: a red-flag report is the exec summary plus flags and the two analyses that would kill the deal; a vendor DD must anticipate buyer questions rather than argue the seller's case.
Produce: callout with the "would I invest" answer and the condition; markdown "Executive summary" (the answer, three reasons, three risks, the ask); score "Red-flag scorecard" scoring each threshold with the actual value in the note; table "Thresholds" (Test, Threshold, Actual, Verdict, Dollar exposure); markdown sections "Market attractiveness", "Competitive position and right to win" and "Customer and revenue quality" with citations; table "Base-case revenue build" (Driver, FY0, FY1, FY2, FY3, Source of the assumption); risks (5-7 with severity and mitigation); bullets "Valuation implications" quantified at the deal multiple; checklist "Confirmatory diligence to run before signing" with owner; caveats on everything taken from management without independent support. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Assemble a ${str(i, "stage", "Full buy-side")} CDD report for ${str(i, "target")} in ${str(i, "sector")}.\n\nSponsor thesis: ${str(i, "thesis")}\n\nMetrics in hand: top-3 concentration ${num(i, "top3")}%, NRR ${num(i, "nrr")}%, NPS ${num(i, "nps")}, pipeline coverage ${num(i, "coverage")}x, revenue growth ${num(i, "growth")}%.${list(i, "tickers").length ? ` Public reference set: ${list(i, "tickers").join(", ")}.` : ""}`,
  },
  {
    kind: "ai", id: "cdd-revenue-cohort-engine", title: "Revenue build & cohort engine", tagline: "Cohort retention, GRR and NRR, concentration and pipeline coverage from a transaction export.",
    description: "Turns an invoice or CRM export into the revenue-quality section of a diligence report: a cohort retention triangle by acquisition period, gross and net revenue retention, logo retention, customer and product concentration at revenue and gross-profit level, and a bottom-up rebuild of forward revenue from the cohorts rather than from management's growth rate. Flags the research's thresholds and explains each one.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Commercial due diligence", "Financial due diligence (TAS)", "Strategy"],
    category: "Diligence", icon: "Users", deliverable: "analysis", savesMinutes: 300, tags: ["cohorts", "NRR", "retention", "concentration"], effort: "high",
    fields: [
      { key: "transactions", label: "Transaction / CRM export", type: "csv", required: true, columns: "customer_id, cohort_period, period, revenue, gross_margin_pct, product, region", placeholder: "customer_id,cohort_period,period,revenue,gross_margin_pct,product,region" },
      { key: "basis", label: "Retention basis", type: "select", options: ["Net revenue retention", "Gross revenue retention", "Logo retention", "All three"], default: "All three" },
      { key: "coverage", label: "Pipeline coverage vs quota", type: "number", unit: "x", default: 2.4, step: 0.1 },
      { key: "forward", label: "Management's forward growth", type: "number", unit: "%", default: 12 },
    ],
    example: {
      transactions: "customer_id,cohort_period,period,revenue,gross_margin_pct,product,region\nC001,FY23,FY24,4200000,31,Core,US-East\nC001,FY23,FY25,4640000,32,Core,US-East\nC002,FY23,FY24,3100000,28,Core,US-East\nC002,FY23,FY25,2480000,27,Core,US-East\nC003,FY23,FY24,1900000,34,Specialty,US-West\nC003,FY23,FY25,0,0,Specialty,US-West\nC004,FY24,FY24,1450000,35,Specialty,US-West\nC004,FY24,FY25,1810000,36,Specialty,US-West\nC005,FY24,FY24,980000,29,Core,Midwest\nC005,FY24,FY25,1020000,29,Core,Midwest\nC006,FY24,FY24,640000,33,Specialty,Midwest\nC006,FY24,FY25,410000,31,Specialty,Midwest\nC007,FY25,FY25,2250000,30,Core,US-East\nC008,FY25,FY25,760000,37,Specialty,US-West",
      basis: "All three", coverage: 2.4, forward: 12,
    },
    instructions: `1. Map the columns first and say what you mapped: customer key, cohort (acquisition) period, observation period, revenue, gross margin, product, region. If the cohort column is missing, derive it as each customer's first period with revenue and say so. Report rows read, customers, periods covered, and any rows dropped with the reason. 2. Build the cohort triangle: revenue by cohort by period, indexed to each cohort's first full period at 100. 3. Compute with calc, per period and per cohort: GRR = (starting revenue - churn - downsell) / starting revenue, excluding expansion; NRR = (starting revenue - churn - downsell + expansion) / starting revenue; logo retention = customers retained / customers at start. Decompose the change into starting, expansion, downsell, churn and new so it reconciles exactly to the ending revenue, and show the reconciliation. 4. Concentration: top 1, top 3, top 5 and top 10 share of revenue and of gross profit; flag top 3 at or above 50% and note that gross-profit concentration above revenue concentration means the big accounts are also the profitable ones. 5. Flag each threshold with its value and the plausible cause read from the data (which cohort, which product, which region): NRR below 100%, any cohort with NRR below 100%, pipeline coverage below 3x quota, logo retention falling cohort over cohort. 6. Rebuild forward revenue bottom-up: retained revenue = current revenue x NRR by cohort, plus new customers at the observed new-cohort average, and compare the result with management's forward growth rate. State the gap in dollars and which assumption closes it. 7. Do not compute a retention rate from a single period; if the data supports only one period, say what you cannot compute.
Produce: kpis (customers, revenue, NRR, GRR, logo retention, top-3 concentration, bottom-up forward growth vs management); table "Cohort revenue triangle" (rows = cohorts, columns = periods) with a note on the indexing; table "Retention bridge" (Period, Starting, Expansion, Downsell, Churn, New, Ending, GRR, NRR) with totals; bar of NRR by cohort with a reference line at 1.0; table "Concentration" (Customer or rank, Revenue, % of revenue, Gross profit, % of gross profit); line of revenue by cohort over the periods; risks "Revenue quality red flags" with severity and the dollar exposure; bullets "Bottom-up forward revenue vs management case"; caveats on column mapping, partial periods and any customer identity assumption.`,
    prompt: (i) => `Build the revenue-quality analysis from this export on a ${str(i, "basis", "All three")} basis. Pipeline coverage is ${num(i, "coverage")}x quota and management's forward growth case is ${num(i, "forward")}%. Rebuild the forward revenue bottom-up from the cohorts and compare.`,
  },
  {
    kind: "ai", id: "cdd-segmentation-referencing", title: "Segmentation & referencing plan", tagline: "Cuts the customer base into segments that behave differently, then names who to call and why.",
    description: "Segments a customer file by size, behaviour and profitability, names each segment for how it buys rather than how big it is, and produces the independent customer referencing plan a diligence team runs: how many current, lost and prospect calls, which accounts by name, the hypothesis each call tests, and the recruiting script. Follows the CDD minimum of five to ten current customers, three to five lost customers and three to five industry experts.",
    roles: ["consultant", "pe"], specialties: ["Commercial due diligence", "Strategy", "Operations & performance"],
    category: "Diligence", icon: "Split", deliverable: "analysis", savesMinutes: 240, tags: ["segmentation", "referencing", "win/loss", "customers"], effort: "high",
    fields: [
      { key: "customers", label: "Customer file", type: "csv", required: true, columns: "customer, revenue, gross_margin_pct, tenure_years, industry, region, orders_per_year, status", placeholder: "customer,revenue,gross_margin_pct,tenure_years,industry,region,orders_per_year,status" },
      { key: "hypotheses", label: "Hypotheses to test on calls", type: "textarea", required: true, placeholder: "One per line" },
      { key: "calls", label: "Call budget", type: "number", default: 18, min: 5, max: 60 },
      { key: "dimensions", label: "Segmentation dimensions", type: "multiselect", options: ["Size", "Profitability", "Tenure / cohort", "Purchase frequency", "Industry / end market", "Region", "Channel"], default: ["Size", "Profitability", "Tenure / cohort", "Industry / end market"] },
    ],
    example: {
      customers: "customer,revenue,gross_margin_pct,tenure_years,industry,region,orders_per_year,status\nAtlas Industrial,18400000,24,11,Industrial,US-East,142,Active\nMeridian Schools,15100000,29,7,Education,US-East,88,Active\nNorthway Fabricators,8900000,22,9,Industrial,Midwest,61,Active\nCoastal Marine,6200000,35,4,Marine,US-West,44,Active\nPine Ridge District,4800000,31,6,Education,Midwest,29,Active\nHalcyon Coatings,3900000,26,2,Industrial,US-West,37,Active\nVertex Modular,2400000,38,1,Construction,US-East,19,Active\nBaywater Yards,1800000,33,8,Marine,US-West,12,Active\nKestrel Metals,1200000,19,3,Industrial,Midwest,26,Active\nSummit Academy,900000,30,5,Education,US-West,8,Churned\nOrion Pipeworks,2100000,21,6,Industrial,US-East,33,Churned\nLakeside Unified,1400000,28,4,Education,Midwest,11,Churned",
      hypotheses: "The 2024 price increase held and customers did not shop the account\nService levels, not price, drive switching in the education vertical\nThe top three accounts are contractually sticky through the hold period\nA competitor quoting 8% below list is winning only price-led business",
      calls: 18, dimensions: ["Size", "Profitability", "Tenure / cohort", "Industry / end market"],
    },
    instructions: `1. Read the file and report rows, revenue covered and any rows dropped. Compute revenue, gross profit, gross margin, orders and revenue per order for every customer with calc. 2. Segment on the requested dimensions, but define the cuts from the data (natural breaks, quartiles of revenue and margin) rather than round numbers. Cross the size cut with the margin cut to get the four-box (large-profitable, large-thin, small-profitable, small-thin) and report revenue, gross profit and customer count in each. 3. Name each segment for its buying behaviour and describe it in one line: who they are, what they buy, how they buy, what they pay, why they stay. Say which segment the client should defend, grow, reprice or exit, with the dollar consequence. 4. Analyse the churned accounts separately: their size, margin, tenure and industry versus retained accounts, and what that pattern implies about why customers leave. 5. Build the referencing plan to the call budget, keeping the CDD minimum of at least 5-10 current customers, 3-5 lost customers and 3-5 industry experts or channel participants. Allocate calls across segments in proportion to revenue at risk, not to customer count, and include at least one account from every segment that carries more than 10% of gross profit. 6. For each named account give the reason for selection, the hypothesis it tests, the two questions only that account can answer, and the recruiting route (management-introduced vs independently sourced), noting that management-introduced references are not independent evidence. 7. Include the recruiting script and the disclosure language, and note that lost-customer calls must not be sourced through the seller.
Produce: kpis (customers, revenue, gross profit, share in the large-profitable box, churned revenue, share of gross profit covered by the call plan); table "Segments" (Segment, Definition, Customers, Revenue, % of revenue, Gross profit, Gross margin, Action, Dollar at stake); scatter of revenue against gross margin per customer with the churned accounts emphasized; bar of gross profit by segment; table "Referencing plan" (Account, Segment, Revenue, Type: current / lost / prospect / expert, Hypothesis tested, Two questions, Recruiting route); bullets "What the churn pattern says"; markdown "Recruiting script" (short, with the disclosure language); caveats on the independence of management-introduced references and on any segment with too few accounts to generalize.`,
    prompt: (i) => `Segment this customer file on ${list(i, "dimensions").join(", ")} and build a ${num(i, "calls", 18)}-call referencing plan.\n\nHypotheses to test:\n${str(i, "hypotheses")}`,
  },
  {
    kind: "ai", id: "cdd-pricing-analysis", title: "Pricing & pocket-price analysis", tagline: "List to pocket price leakage by customer, with the durability test on every price increase.",
    description: "Builds the pricing analysis a commercial diligence or performance case needs: the pocket-price waterfall from list through invoice discounts, rebates, freight and terms to realized price, the price-realization band across customers, and the outliers worth repricing. Tests every recent price increase for durability the way a buyer does: is it contractual, has it recurred, and did volume or customers leave after it.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Commercial due diligence", "Operations & performance", "Strategy"],
    category: "Modeling", icon: "Percent", deliverable: "analysis", savesMinutes: 240, tags: ["pricing", "pocket price", "discounts", "price realization"], effort: "high",
    fields: [
      { key: "pricing", label: "Invoice-level pricing data", type: "csv", required: true, columns: "customer, sku, volume, list_price, invoice_price, rebates, freight, payment_terms_days", placeholder: "customer,sku,volume,list_price,invoice_price,rebates,freight,payment_terms_days" },
      { key: "method", label: "Analysis", type: "select", options: ["Pocket price waterfall", "Price realization band", "Price increase durability test", "All three"], default: "All three" },
      { key: "carry", label: "Cost of capital for terms", type: "number", unit: "%", default: 9 },
      { key: "increase", label: "Price increase to test", type: "text", placeholder: "4% list increase effective September 2025" },
    ],
    example: {
      pricing: "customer,sku,volume,list_price,invoice_price,rebates,freight,payment_terms_days\nAtlas Industrial,EP-100,42000,38.00,31.30,1.15,0.62,75\nAtlas Industrial,EP-220,18000,52.00,44.10,1.60,0.71,75\nMeridian Schools,EP-100,26000,38.00,33.80,0.40,0.55,45\nMeridian Schools,UR-400,9000,64.00,58.90,0.00,0.80,45\nNorthway Fabricators,EP-100,15500,38.00,30.20,1.90,0.68,90\nCoastal Marine,MR-300,7400,88.00,81.40,0.00,1.35,30\nHalcyon Coatings,EP-220,6100,52.00,41.80,2.10,0.74,60\nVertex Modular,UR-400,3200,64.00,60.50,0.00,0.92,30\nKestrel Metals,EP-100,4800,38.00,28.90,2.40,0.70,90\nBaywater Yards,MR-300,2100,88.00,84.20,0.00,1.40,30",
      method: "All three", carry: 9, increase: "4% list increase effective September 2025",
    },
    instructions: `1. Map the columns and report volume, revenue at list and revenue at invoice. 2. Build the pocket price per line with calc: pocket price = invoice price - rebates - freight - the carrying cost of payment terms, where the terms cost = invoice price x cost of capital x days / 365. Revenue-weight every average; a simple average of prices across customers of different size is the classic error. 3. Pocket-price waterfall: start from revenue at list and subtract each leakage element in order (invoice discount, rebates, freight, terms) to reach pocket revenue, and express each element in dollars, as a percentage of list and in basis points of realized margin. 4. Price realization band: for each SKU, the distribution of pocket price across customers (min, Q1, median, Q3, max) and each customer's position. Identify the outliers as customers more than one interquartile range below the median for their SKU, and quantify the dollars at stake in moving each to the median. Check whether low realization is explained by volume: tabulate pocket price against volume and name the customers that are cheap without being large. 5. Durability test on the stated price increase: use the data to show whether realized pocket price actually moved by the announced amount (announced minus realized is the give-back), whether volume or customers fell afterwards, and whether the increase is contractual or discretionary. State the verdict Durable, Partly durable or Not proven, and the EBITDA at risk if it reverses. 6. Where the client is public or has public comparables, use search_filing on the 10-K for "pricing", "price increases", "rebates" and "results of operations" to see how comparables describe their own realization, and get_xbrl_series with Revenues and GrossProfit to check whether reported margin moved in line.
Produce: kpis (revenue at list, pocket revenue, total leakage %, average pocket price, the realization spread between Q1 and Q3, dollars at stake in the outliers); waterfall "Pocket price waterfall" from list revenue to pocket revenue with each leakage element; table "Leakage by element" (Element, $, % of list, bps of margin); table "Realization by SKU" (SKU, Min, Q1, Median, Q3, Max, Spread, Customers below Q1); table "Repricing targets" (Customer, SKU, Pocket price, SKU median, Gap, Volume, Dollars at stake, Justification to test); bullets "Durability verdict" on the price increase with the evidence; callout with the single largest pricing action and its EBITDA effect; caveats on freight and rebate allocation, on lines with missing list prices, and on mix effects inside any average.`,
    prompt: (i) => `Run the ${str(i, "method", "All three")} pricing analysis on this invoice data at a ${num(i, "carry", 9)}% cost of capital for payment terms.${str(i, "increase") ? ` Test the durability of this increase: ${str(i, "increase")}.` : ""}`,
  },
  {
    kind: "ai", id: "cdd-survey-design", title: "Survey designer & cross-tab plan", tagline: "A CDD-grade instrument: screener, KPC importance and performance, NPS, switching and willingness to pay.",
    description: "Drafts the survey a commercial diligence case fields: screener logic that keeps only qualified respondents, a key purchase criteria importance and performance grid, the standard NPS question, share of wallet and switching intent, and a Van Westendorp or Gabor-Granger willingness-to-pay block. Comes with the quota plan, the sample size the target margin of error requires, the cross-tab plan and the bias checks.",
    roles: ["consultant", "pe"], specialties: ["Commercial due diligence", "Strategy", "Operations & performance"],
    category: "Research", icon: "ListChecks", deliverable: "checklist", savesMinutes: 240, tags: ["survey", "NPS", "KPC", "Van Westendorp"], effort: "medium",
    fields: [
      { key: "category", label: "Category / market", type: "text", required: true, placeholder: "US industrial coatings purchased by mechanical contractors" },
      { key: "audience", label: "Audience", type: "select", options: ["B2B decision makers", "B2B influencers and users", "Consumers", "Channel partners / distributors", "Lapsed customers"], default: "B2B decision makers" },
      { key: "n", label: "Target completes", type: "number", default: 300, min: 50, max: 2000 },
      { key: "blocks", label: "Blocks", type: "multiselect", options: ["Screener", "Firmographics", "KPC importance / performance", "NPS", "Share of wallet", "Switching intent", "Van Westendorp", "Gabor-Granger", "Brand awareness funnel", "Conjoint"], default: ["Screener", "Firmographics", "KPC importance / performance", "NPS", "Share of wallet", "Switching intent", "Van Westendorp"] },
      { key: "hypotheses", label: "Hypotheses the survey must test", type: "textarea", required: true },
      { key: "segments", label: "Segments to read out", type: "text", placeholder: "end market, company size, region, incumbent supplier" },
    ],
    example: { category: "US industrial and education coatings purchased by mechanical contractors and facilities teams", audience: "B2B decision makers", n: 300, blocks: ["Screener", "Firmographics", "KPC importance / performance", "NPS", "Share of wallet", "Switching intent", "Van Westendorp"], hypotheses: "Price is a top-three purchase criterion only in the education vertical\nService and availability beat price for industrial buyers\nA 5% price rise would move less than 10% of volume\nThe target's NPS is at or below the category average", segments: "end market, company size, region, incumbent supplier" },
    instructions: `1. Write the screener so the sample is the market: role and purchase authority, category purchase in the last 12 months, minimum spend, and a trap question to remove straight-liners and professional respondents. State the expected incidence rate and therefore how many starts are needed for the target completes. 2. Sequence the instrument: screener, firmographics, awareness and consideration, KPC importance then performance (never in the same grid on the same screen), incumbent supplier and share of wallet, switching intent with the trigger, NPS, willingness to pay, then open-ends. Unaided before aided, behaviour before attitude, price last. 3. Write the actual question text and scales, not descriptions of them: KPC importance on a constant-sum or 1-7 scale with 8-12 criteria drawn from the hypotheses, performance on the same criteria for the respondent's own supplier, NPS as "How likely are you to recommend X to a colleague?" on 0-10 with a verbatim follow-up, switching as intent plus the price gap that would trigger it. For Van Westendorp ask the four standard questions (too cheap, cheap or a bargain, expensive, too expensive); for Gabor-Granger ask purchase intent at a randomized ladder of five price points. 4. State the sample size mathematics: the margin of error at 95% confidence for the total sample and for the smallest segment you intend to read out, and say which planned cross-tabs the sample cannot support. As a rule, do not read out a segment below n = 50 and flag n = 30-50 as directional. 5. Quota plan: cells across the segments to be read out, with the target n per cell and the population source for the weighting. 6. Bias checks: leading wording, double-barrelled items, unbalanced scales, order effects (randomize criteria and brand lists), anchoring in the price block, and non-response bias in the sample frame. Name each risk and the specific fix in the instrument. 7. Cross-tab plan: which questions by which banners, the significance test to apply, and the two charts that will carry the story (the importance-performance grid and the price-sensitivity curves). 8. Use web_research to check category norms for NPS or price sensitivity only if a benchmark is needed, and cite it.
Produce: markdown "Instrument" with one ## per block and the verbatim question text, scales and logic; table "Sample plan" (Segment, Target n, Expected incidence, Margin of error, Read-out status); table "Cross-tab plan" (Question, Banners, Test, Exhibit); checklist "Bias and quality checks" with the fix; bullets "What each block proves about the hypotheses"; kpis (target completes, margin of error at 95%, smallest readable segment, blocks, estimated field length in minutes); caveats on incidence uncertainty, panel quality and the limits of stated-preference pricing.`,
    prompt: (i) => `Design a ${num(i, "n", 300)}-complete survey of ${str(i, "audience", "B2B decision makers")} in ${str(i, "category")} with these blocks: ${list(i, "blocks").join(", ")}.${str(i, "segments") ? ` Read out by: ${str(i, "segments")}.` : ""}\n\nHypotheses to test:\n${str(i, "hypotheses")}`,
  },
  {
    kind: "ai", id: "cdd-expert-call-planner", title: "Expert network call planner", tagline: "Who to call, in what order, and the ten questions each expert is uniquely able to answer.",
    description: "Plans the expert-network programme for a case: the expert archetypes to source, how many of each, the sequencing that makes later calls cheaper, and a tailored ten-question guide per archetype tied to the hypotheses. Includes the pre-call brief built from filings and the compliance rules that keep the calls clean: conflict checks, no MNPI, no current employees of the target, recording consent.",
    roles: ["consultant", "pe"], specialties: ["Commercial due diligence", "Strategy", "Technology & digital"],
    category: "Research", icon: "MessageSquare", deliverable: "checklist", savesMinutes: 180, tags: ["expert network", "GLG", "calls", "compliance"], effort: "medium",
    fields: [
      { key: "ticker", label: "Subject company", type: "ticker", required: true, placeholder: "NOW" },
      { key: "hypotheses", label: "Hypotheses to test", type: "textarea", required: true },
      { key: "calls", label: "Call budget", type: "number", default: 12, min: 3, max: 40 },
      { key: "types", label: "Expert archetypes", type: "multiselect", options: ["Former executive of the subject", "Former executive of a competitor", "Current customer / buyer", "Lost customer", "Channel partner or reseller", "Industry analyst", "Supplier", "Regulator or standards body", "Technical / architecture expert"], default: ["Former executive of a competitor", "Current customer / buyer", "Lost customer", "Channel partner or reseller", "Industry analyst"] },
      { key: "rate", label: "Blended rate per call", type: "number", unit: "$", default: 1100 },
    ],
    example: { ticker: "NOW", hypotheses: "Platform consolidation is displacing point ITSM tools in the mid-market\nSeat-based pricing is under pressure from agentic automation that reduces seats\nSwitching costs rise sharply once a customer builds workflows on the platform\nThe competitive threat is a suite vendor bundling, not a point solution undercutting", calls: 12, types: ["Former executive of a competitor", "Current customer / buyer", "Lost customer", "Channel partner or reseller", "Industry analyst"], rate: 1100 },
    instructions: `1. Build the pre-call brief from the filings so no paid hour is spent on facts that are public: call get_company_financials, search_filing on the 10-K for "competition", "our customers", "our strategy", "remaining performance obligations", "seasonality" and "human capital", search_filing on the latest 10-Q for "results of operations" and any disclosed operating metric, and get_recent_filings with forms ["8-K"] for recent material events. Summarize what is already known in ten lines and mark the facts an expert should be asked to interpret rather than repeat. 2. Allocate the call budget across archetypes in proportion to the hypotheses at stake, not evenly, and say what each archetype can uniquely answer and what it cannot. Note that former executives are good on strategy and cost structure but stale on current pricing, and that customers are authoritative on their own switching and worthless on market share. 3. Sequence the programme in three waves: wave 1 two or three orientation calls to sharpen the questions, wave 2 the bulk of the calls testing specific hypotheses, wave 3 targeted calls to resolve contradictions. Say what must be learned in wave 1 before wave 2 is booked. 4. Write a ten-question guide per archetype, ordered open to specific, each with a probe and the hypothesis it tests. Ask for numbers with a range and a basis ("what share, and how do you know?"), and end every guide with "who else should we speak to and what would they say differently?". 5. Screening questions to qualify an expert before accepting the call: tenure, scope of responsibility, recency, and whether they touched the specific decision in question; include the two questions that disqualify a mis-sourced expert. 6. Compliance: conflict and employment checks, no current employees or contractors of the subject or its customers where prohibited, no material non-public information, no discussion of the transaction, the recording and consent policy, the note-taking standard, and the escalation route if an expert volunteers MNPI. 7. Budget: calls x rate, plus the transcript-library search that should precede live calls, and the expected cost per hypothesis resolved.
Produce: markdown "Pre-call brief" (ten lines of public facts with citations, then what to ask an expert to interpret); table "Call plan" (Archetype, Calls, Wave, Hypothesis tested, What they uniquely know, What they cannot answer); qa "Question guides" with the ten questions per archetype as question/answer pairs where the answer states the probe and the hypothesis tested; kpis (calls, budget, cost per hypothesis, waves, public facts already established); bullets "What must be learned in wave 1 before booking wave 2"; checklist "Screening and compliance" with owner; caveats on expert recency, single-source risk and the limits of any share estimate from a single expert.`,
    prompt: (i) => `Plan a ${num(i, "calls", 12)}-call expert programme on ${str(i, "ticker").toUpperCase()} at roughly $${num(i, "rate", 1100)} per call, using these archetypes: ${list(i, "types").join(", ")}.\n\nHypotheses to test:\n${str(i, "hypotheses")}`,
  },
  {
    kind: "ai", id: "cdd-interview-guide-synthesis", title: "Interview guide & synthesis", tagline: "Guides by respondent type, then transcripts coded into a theme by source grid with quotes.",
    description: "Two halves of the same job: drafts interview guides of ten to fifteen questions ordered open to specific with probes, and codes pasted notes or transcripts into a theme by source grid with three attributed quotes per theme, contradictions flagged, and a what-we-heard / so-what line per theme. Reports how many independent sources support each theme so a partner can see which findings rest on one anecdote.",
    roles: ["consultant", "pe", "student"], specialties: ["Commercial due diligence", "Strategy", "Operations & performance", "Restructuring / turnaround"],
    category: "Research", icon: "BookOpen", deliverable: "analysis", savesMinutes: 300, tags: ["interviews", "synthesis", "coding", "transcripts"], effort: "high",
    fields: [
      { key: "mode", label: "Mode", type: "select", options: ["Draft interview guide", "Synthesize transcripts", "Both"], default: "Both" },
      { key: "respondent", label: "Respondent type", type: "select", options: ["Current customer", "Lost customer", "Prospect / non-customer", "Channel partner", "Industry expert", "Former executive of the target", "Target management"], default: "Current customer" },
      { key: "hypotheses", label: "Hypotheses to test", type: "textarea", required: true },
      { key: "transcripts", label: "Notes / transcripts", type: "textarea", placeholder: "Paste notes, one call per block, with the speaker's role and date at the top of each" },
      { key: "themes", label: "Themes to code against", type: "text", placeholder: "pricing power, switching costs, service levels, competitive threat" },
    ],
    example: {
      mode: "Both", respondent: "Current customer",
      hypotheses: "Customers would not switch to a competitor priced 8% below list\nService levels and availability outrank price for industrial buyers\nThe 2024 price increase was accepted without shopping the account\nContract renewals inside 18 months are not genuinely at risk",
      transcripts: "Call 1 - Facilities director, education district, 2026-09-08: We renewed last year. The increase came through at about four percent and we did not go out to bid; the changeover cost is not worth it for us. If someone came in ten percent under we would look, but we would ask the incumbent to match first. Availability is what we actually buy - a two-day wait shuts a job down.\n\nCall 2 - Procurement lead, industrial fabricator, 2026-09-09: We benchmarked them last spring and they were three to five percent above the next quote. We stayed because their technical support answers the phone. We have started dual-sourcing the commodity grades though, maybe fifteen percent of volume moved.\n\nCall 3 - Plant manager, marine yard, 2026-09-11: Price is not the issue for us, the specialty grades are hard to substitute. Lead times slipped in the first quarter and that cost us. If it happened again we would qualify a second supplier.\n\nCall 4 - Operations VP, industrial fabricator (lost account), 2026-09-12: We left over service. Two missed deliveries in a quarter. The new supplier is about the same price. Nobody from their side called us for six months after we left.",
      themes: "pricing power, switching costs, service levels, competitive threat, contract risk",
    },
    instructions: `1. Guide mode: write 10-15 questions for the respondent type, ordered open to specific, each with a probe. Open with context and behaviour ("walk me through how you last bought this"), move to criteria and trade-offs, then to the specific hypotheses, then to the counterfactual (what would make you switch, at what gap, how fast), and close with referrals and anything you did not ask. Never lead; ask for the number and the basis. For lost customers, establish the sequence of events before the reason. For target management, ask for the evidence behind each claim and where the data lives. 2. Synthesis mode: first list the calls with role, date and an independence tag (independently sourced vs management-introduced). 3. Code every passage to themes, using the supplied themes plus any that emerge, and build the theme by source grid: a cell per theme per call marked Supports, Contradicts, Nuances or Silent. 4. For each theme write the "what we heard" in one sentence and the "so what" in one sentence, then give up to three verbatim quotes with the speaker's role (never a name) and the call date. Quote exactly; do not paraphrase inside quotation marks. 5. Report evidence strength per theme: the number of independent sources that support it, whether they agree on magnitude, and a grade of Strong (three or more independent sources agreeing), Moderate or Anecdote. 6. Flag contradictions explicitly with both sides quoted, and say what would resolve each one: another call, a data request, or a survey question. 7. Convert the synthesis into implications for the hypotheses: for each hypothesis, Supported, Contradicted, Refined or Not tested, with the reason. 8. Do not add facts the transcripts do not contain, and do not compute a percentage from four calls; say "three of four sources" instead.
Produce: markdown "Interview guide" with the numbered questions and probes when guide mode is requested; table "Theme by source grid" (rows = themes, columns = calls, cells = Supports / Contradicts / Nuances / Silent); table "Themes" (Theme, What we heard, So what, Independent sources, Strength); qa "Quote bank" with the theme as the question and the attributed verbatim as the answer; bullets "Contradictions and how to resolve them"; table "Hypothesis verdicts" (Hypothesis, Verdict, Evidence, What would settle it); caveats on sample size, self-selection, management-introduced sources and recall bias.`,
    prompt: (i) => `Mode: ${str(i, "mode", "Both")}. Respondent type: ${str(i, "respondent", "Current customer")}.${str(i, "themes") ? ` Code against these themes: ${str(i, "themes")}.` : ""}\n\nHypotheses:\n${str(i, "hypotheses")}${str(i, "transcripts") ? `\n\nNotes / transcripts:\n${str(i, "transcripts")}` : ""}`,
  },

  /* ---------------- Financial due diligence (TAS) ---------------- */
  {
    kind: "ai", id: "fdd-add-back-tester", title: "Add-back tester", tagline: "Every seller add-back tested for recurrence, support and category, with the price impact at the multiple.",
    description: "Tests a seller's adjusted-EBITDA schedule item by item against the three-category taxonomy used in financial due diligence: seller adjustments, diligence adjustments and pro forma or run-rate adjustments. Applies the recurrence test across years, demands support for each item, gives an accept / partially accept / reject verdict with the rationale a manager would sign, and converts the rejected amount into lost enterprise value at the deal multiple.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Financial due diligence (TAS)", "Commercial due diligence", "Operations & performance"],
    category: "Diligence", icon: "Scale", deliverable: "table", savesMinutes: 300, tags: ["QoE", "add-backs", "adjusted EBITDA", "FDD"], effort: "high",
    fields: [
      { key: "addbacks", label: "Seller add-back schedule", type: "csv", required: true, columns: "item, category_claimed, fy1, fy2, fy3, ttm, support_reference, description", placeholder: "item,category_claimed,fy1,fy2,fy3,ttm,support_reference,description" },
      { key: "reportedEbitda", label: "Reported EBITDA (TTM)", type: "number", unit: "$mm", default: 18.3 },
      { key: "multiple", label: "Deal multiple", type: "number", unit: "x", default: 10, step: 0.5 },
      { key: "ticker", label: "Public comparable (optional)", type: "ticker", help: "Used to test whether the industry treats these items as recurring" },
    ],
    example: {
      addbacks: "item,category_claimed,fy1,fy2,fy3,ttm,support_reference,description\nOwner compensation above market,Non-recurring,2100000,2050000,2000000,2100000,Payroll register; comp study pending,Owner salary and bonus above a market CEO rate of $450k\nLegal settlement,One-time,0,0,1250000,1250000,Settlement agreement dated 2025-04,Customer dispute settled in FY25\nERP implementation costs,One-time project,640000,710000,580000,520000,Vendor invoices,Phased ERP rollout described as one-time each year\nRent normalization to market,Pro forma,0,0,0,380000,Appraisal; related-party lease,Related-party facility lease below market\nPersonal expenses,Non-recurring,185000,210000,240000,250000,Credit card detail,Owner travel vehicles and club memberships\nSeverance,One-time,120000,0,310000,310000,Separation agreements,Two reductions in force\nLost customer run-rate,Pro forma,0,0,0,-900000,Sales ledger,Customer lost in June not yet reflected in TTM\nMarketing rebrand,One-time,0,430000,0,0,Agency invoices,Brand refresh completed in FY24",
      reportedEbitda: 18.3, multiple: 10, ticker: "AXTA",
    },
    instructions: `1. Read the schedule and restate it with every item classified into exactly one category: (a) Seller adjustment, a claimed add-back (non-recurring expense, excess owner compensation, personal expenses, litigation, one-time projects); (b) Diligence adjustment, a correction you would propose (accounting error, unrecorded liability, revenue cut-off, opex capitalized, related-party terms restated to arm's length); (c) Pro forma or run-rate, normalizing the TTM for a known change (new rent, new or lost contracts, price increases, acquisitions, headcount already actioned). Say where the seller's claimed category is wrong, which is itself a finding. 2. Apply the recurrence test with calc: count the years in which each item appears and its variability. An item appearing in three of four years is recurring by behaviour whatever it is called; say so in those words and reject or haircut it. 3. Test support: each item needs a document that proves both the amount and the non-recurrence. Grade support Sufficient, Partial or None, and name the specific document you would request (payroll register and a market compensation study for owner comp, the settlement agreement and confirmation of no related claims for litigation, vendor invoices plus a project completion memo for one-time projects, an appraisal or third-party lease comparables for rent normalization, the signed contract for a run-rate revenue adjustment). 4. Apply the allowed and disallowed conventions. Allowed: genuinely non-recurring, non-operating, owner-specific, or contractually locked in and evidenced. Disallowed: it recurs; it is a normal cost of operating at the pro forma scale; it is a projected benefit rather than an actioned change; it is unsupported; or it is a revenue-side synergy. Owner compensation is allowable only down to a market rate for the role that must be filled, with the study as support. Run-rate adjustments must cut both ways, so require the lost-customer and cost-inflation items alongside the favourable ones and flag one-sidedness explicitly. 5. Expect to disallow roughly 10-30% of proposed add-backs in aggregate; if your verdicts land far outside that band, say why. 6. Build the bridge from reported EBITDA to your adjusted EBITDA, with the seller's number alongside, and quantify the price impact: rejected add-backs x the deal multiple. 7. If a ticker is given, use search_filing on its 10-K for "restructuring", "non-GAAP", "adjusted EBITDA" and "related party" and get_xbrl_series with RestructuringCharges and ShareBasedCompensation to show whether the industry treats these items as recurring; a peer that books the same charge every year is evidence against non-recurrence. 8. Close with the cash-earnings lens: adjusted EBITDA less the change in net working capital, capex and cash taxes, so the buyer sees what converts.
Produce: kpis (reported EBITDA, the seller's adjusted EBITDA, our adjusted EBITDA, adjustments rejected, % of proposed rejected, enterprise value impact at the multiple); waterfall "Reported to adjusted EBITDA" showing the accepted items and the total; table "Adjustment schedule" with columns Item, Claimed category, Our category, TTM amount, Years present, Recurrence verdict, Support grade, Accepted amount, Verdict, Rationale, Document requested; table "Effect of rejections" (Item, Rejected amount, Multiple, EV impact); callout on the single largest rejected item and the negotiating point; bullets "One-sided run-rate adjustments the seller omitted"; checklist "Documents to request" with owner; caveats on any pending compensation study, on items accepted subject to support, and on the difference between EBITDA and cash earnings.`,
    prompt: (i) => `Test this seller add-back schedule against reported TTM EBITDA of $${num(i, "reportedEbitda", 18.3)}mm at a ${num(i, "multiple", 10)}x deal multiple.${str(i, "ticker") ? ` Use ${str(i, "ticker").toUpperCase()} to test whether the industry treats these items as recurring.` : ""}`,
  },
  {
    kind: "ai", id: "fdd-nwc-peg-analyzer", title: "NWC peg analyzer", tagline: "Monthly working capital, seasonality, the TTM-average peg, and the adjustments that move the price.",
    description: "Builds the net working capital series from monthly balance sheets, sets the peg as a trailing twelve-month average and shows the seasonally matched alternative for the expected closing month, then quantifies the adjustments a buyer makes: aged receivables, obsolete inventory, stretched payables and non-recurring balances. Ends with the SPA definition language and the dollar difference between the competing peg proposals.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Financial due diligence (TAS)", "Commercial due diligence", "Restructuring / turnaround"],
    category: "Diligence", icon: "ArrowLeftRight", deliverable: "memo", savesMinutes: 300, tags: ["NWC", "peg", "SPA", "true-up"], effort: "high",
    fields: [
      { key: "monthly", label: "Monthly balance sheet", type: "csv", required: true, columns: "month, accounts_receivable, inventory, prepaid_expenses, accounts_payable, accrued_expenses, deferred_revenue, revenue, cost_of_revenue", placeholder: "month,accounts_receivable,inventory,prepaid_expenses,accounts_payable,accrued_expenses,deferred_revenue,revenue,cost_of_revenue" },
      { key: "closeMonth", label: "Expected closing month", type: "select", options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], default: "March" },
      { key: "basis", label: "Price mechanism", type: "select", options: ["Completion accounts", "Locked box"], default: "Completion accounts" },
      { key: "agedAr", label: "Receivables over 90 days", type: "number", unit: "$000s", default: 0 },
      { key: "obsolete", label: "Slow-moving / obsolete inventory", type: "number", unit: "$000s", default: 0 },
    ],
    example: {
      monthly: "month,accounts_receivable,inventory,prepaid_expenses,accounts_payable,accrued_expenses,deferred_revenue,revenue,cost_of_revenue\n2024-07,28400,21600,1450,17800,5200,900,16200,11300\n2024-08,29100,22400,1420,18300,5350,880,16800,11700\n2024-09,30600,23100,1390,18900,5480,910,17400,12100\n2024-10,29800,22800,1360,18400,5310,870,16900,11800\n2024-11,27300,21900,1410,17600,5120,850,15400,10800\n2024-12,24900,20400,1500,16900,6100,1020,14100,9900\n2025-01,25600,21100,1620,16200,5050,980,14600,10200\n2025-02,26800,21800,1580,16700,5180,940,15300,10700\n2025-03,29400,23400,1510,18100,5420,920,17100,11900\n2025-04,30900,24100,1470,18800,5600,900,17900,12500\n2025-05,31600,24600,1440,19200,5710,890,18400,12800\n2025-06,32400,24900,1400,19900,5880,910,18900,13200\n2025-07,31100,24200,1460,21400,5640,880,18100,12600\n2025-08,31800,24800,1430,22100,5780,870,18600,13000\n2025-09,33200,25600,1400,23200,5940,900,19300,13500\n2025-10,32100,25100,1380,22600,5760,860,18700,13100\n2025-11,29400,24000,1420,21800,5480,840,17000,11900\n2025-12,26800,22300,1520,20900,6400,1010,15600,10900",
      closeMonth: "March", basis: "Completion accounts", agedAr: 1850, obsolete: 2400,
    },
    instructions: `1. Define NWC per the usual SPA convention and say so explicitly: trade receivables plus inventory plus prepaid expenses, less trade payables and accrued expenses; exclude cash, debt and debt-like items, income taxes, and all deal-related items. State the treatment of deferred revenue and note that where it represents undelivered service it usually belongs in net debt rather than NWC, which is a negotiated point. 2. Build the monthly series with calc, report the months covered, and compute for each month: NWC, NWC as a percentage of trailing revenue, DSO = AR / revenue x days in month, DIO = inventory / cost of revenue x days, DPO = payables / cost of revenue x days, and the cash conversion cycle. 3. Compute the candidate pegs: the trailing twelve-month average of month-end NWC (the standard), the average of the latest three months, the average of the same calendar month across the years available (seasonally matched to the expected closing month), and the latest month. Show all four side by side with the dollar difference from the TTM average, because the choice of method is usually worth more than the earnings adjustments. 4. Quantify seasonality: the peak and trough months, the peak-to-trough swing in dollars and as a percentage of the average, and a month-of-year index (each calendar month's average NWC divided by the overall average). Say whether the expected closing month sits above or below the TTM average and what that does to the price at completion. 5. Adjustments to the peg, each quantified and each with the reason: receivables over 90 days that will not convert; slow-moving or obsolete inventory; stretched payables, which is the classic pre-sale manipulation, so test DPO for a trend break in the last two quarters and quantify the sustainable level; non-recurring or deal-related balances; and any accounting policy change mid-series. 6. Give the recommended peg with the method named, and the price impact of the seller's likely proposal versus yours. 7. Write the SPA points: the definition to include, the illustrative calculation to attach, the accounting policies clause (consistently applied, past practice prevailing over GAAP or the reverse), the true-up window of 60-90 days post-close, the dispute mechanism, and the locked-box alternative with leakage protection if that basis is chosen. 8. If fewer than 24 months are provided, say which analyses that weakens, seasonal matching above all, and request the missing months.
Produce: kpis (TTM average peg, 3-month average, seasonally matched peg for the closing month, latest month, peak-to-trough swing, recommended peg, price impact vs the seller's likely proposal); line "Monthly NWC with the trailing twelve-month average" as two series; table "Monthly detail" (Month, AR, Inventory, Prepaid, AP, Accrued, NWC, % of revenue, DSO, DIO, DPO, CCC); bar "Month-of-year seasonality index"; waterfall "TTM average to recommended peg" with each adjustment; table "Peg alternatives" (Method, Value, Difference vs TTM average, Argument for, Argument against); bullets "Evidence of payables stretching" with the DPO trend; markdown "SPA drafting points"; risks on the true-up; caveats on months provided, on deferred revenue treatment and on any estimate.`,
    prompt: (i) => `Build the NWC peg analysis from this monthly balance sheet for a ${str(i, "basis", "Completion accounts")} deal closing in ${str(i, "closeMonth", "March")}. Aged receivables over 90 days are $${num(i, "agedAr")}k and slow-moving inventory is $${num(i, "obsolete")}k.`,
  },

  /* ---------------- Operations & performance ---------------- */
  {
    kind: "ai", id: "ops-pvm-bridge", title: "Price-volume-mix bridge", tagline: "SKU-level price, volume, mix, new and discontinued effects that sum exactly to the revenue change.",
    description: "Decomposes a revenue or gross-margin change between two periods into price, volume and mix at SKU level, with new and discontinued SKUs broken out into their own bars, following the FTI sequence. Computes at the lowest level available because group-level analysis hides mix inside price, then applies the buyer's durability test to each bar: is it contractual, has it recurred, and did customers leave after the increase.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Financial due diligence (TAS)", "Commercial due diligence"],
    category: "Reporting", icon: "Layers", deliverable: "analysis", savesMinutes: 240, tags: ["PVM", "bridge", "mix", "variance"], effort: "high",
    fields: [
      { key: "sales", label: "Two-period sales data", type: "csv", required: true, columns: "sku, base_volume, base_net_revenue, current_volume, current_net_revenue, base_gross_profit, current_gross_profit, customer, channel", placeholder: "sku,base_volume,base_net_revenue,current_volume,current_net_revenue,base_gross_profit,current_gross_profit,customer,channel" },
      { key: "level", label: "Decompose at", type: "select", options: ["SKU", "SKU x customer", "Customer", "Channel", "Product family"], default: "SKU" },
      { key: "basis", label: "Basis", type: "select", options: ["Net revenue", "Gross profit", "Both"], default: "Net revenue" },
      { key: "periods", label: "Period labels", type: "text", default: "FY24 to FY25" },
    ],
    example: {
      sales: "sku,base_volume,base_net_revenue,current_volume,current_net_revenue,base_gross_profit,current_gross_profit,customer,channel\nEP-100,102000,3876000,108000,4320000,891000,1080000,Industrial,Direct\nEP-220,41000,2132000,38000,2090000,554000,543000,Industrial,Direct\nUR-400,18500,1184000,21000,1386000,367000,443000,Education,Distributor\nMR-300,9200,809600,9800,890800,283000,320000,Marine,Direct\nSP-150,14000,504000,0,0,131000,0,Industrial,Distributor\nNX-500,0,0,6400,441600,0,163000,Industrial,Direct\nEP-050,22000,528000,19500,487500,116000,102000,Education,Distributor",
      level: "SKU", basis: "Both", periods: "FY24 to FY25",
    },
    instructions: `1. Map the columns, report rows read and the base and current totals, and confirm the totals tie to the client's reported revenue before decomposing anything; a bridge that starts from the wrong total is worthless. 2. Derive the average selling price per line: base price = base net revenue / base volume, current price = current net revenue / current volume. Use net (pocket) revenue after discounts, rebates and freight where the data allows, and say which it is. 3. Separate the population into continuing SKUs (volume in both periods), new SKUs (volume only in the current period) and discontinued SKUs (volume only in the base period). Filter zero-volume periods out of the continuing set rather than letting them create infinite prices. 4. Decompose the continuing set with calc, and state the convention you used: price effect = (current price - base price) x base volume; volume effect = (current volume - base volume) x the base average price across the whole continuing set; mix effect = (current volume - base volume) x (the SKU's base price - the base average price); and the price-volume cross term = (current price - base price) x (current volume - base volume). New = current revenue of new SKUs; discontinued = negative base revenue of discontinued SKUs. 5. Prove the identity: the sum of all effects must equal the total change exactly. Show the residual and, if it is not zero to the dollar, find the error before writing anything else. 6. Decompose at the requested level, and if the level is coarser than SKU, note how much of what shows as price is really mix and quantify it by running the decomposition both ways. 7. On a gross-profit basis, repeat with margin per unit so the bridge separates price, cost and mix effects on profit. 8. Durability test per bar: is the price effect contractual or discretionary, has the same effect appeared in the prior year, did volume or customers fall after the increase (compare price change against volume change at SKU level), and is the mix effect a deliberate shift or a one-off large order. Grade each bar Durable, Partly durable or Not proven. 9. Name the three SKUs or customers that drive each bar and the commercial action each implies.
Produce: kpis (base revenue, current revenue, total change, price effect, volume effect, mix effect, new and discontinued, residual which must be zero); waterfall "Revenue bridge" from the base total through price, volume, mix, cross term, new and discontinued to the current total; table "Effects by SKU" (SKU, Base volume, Base price, Current volume, Current price, Price effect, Volume effect, Mix effect, Total, Share of the change) sorted by absolute total with totals; table "Durability test" (Bar, Amount, Contractual, Recurred last year, Volume response, Verdict); a second waterfall on gross profit when requested; bullets "What the mix effect actually is" in plain English; callout on the largest and least durable effect; caveats on the sequencing convention, on net vs gross pricing, on any SKU excluded and on unit consistency.`,
    prompt: (i) => `Build the price-volume-mix bridge ${str(i, "periods", "between the two periods")} at ${str(i, "level", "SKU")} level on a ${str(i, "basis", "Net revenue")} basis, and prove the effects sum exactly to the total change.`,
  },
  {
    kind: "ai", id: "ops-cost-baseline-zbb", title: "Cost baseline & zero-based targets", tagline: "GL mapped to categories and owners, then targets set from peer SG&A quartiles rather than last year.",
    description: "Builds the cost baseline an operations case runs on: the general ledger mapped to cost categories and named cost owners, duplicates and outliers flagged, and the baseline reconciled to the reported cost base. Then sets zero-based targets from peer quartiles pulled from XBRL rather than from last year's budget, sizes the prize by category, and writes the initiative charters with owners, phasing and one-time costs.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Strategy", "Restructuring / turnaround", "Technology & digital"],
    category: "Planning & forecasting", icon: "Layers", deliverable: "model", savesMinutes: 420, tags: ["ZBB", "cost baseline", "SG&A", "benchmarks"], effort: "high",
    fields: [
      { key: "gl", label: "GL / cost export", type: "csv", required: true, columns: "account_code, account_name, category, department, cost_owner, fy_spend, vendor", placeholder: "account_code,account_name,category,department,cost_owner,fy_spend,vendor" },
      { key: "revenue", label: "Client revenue", type: "number", unit: "$mm", default: 2540 },
      { key: "ticker", label: "Closest public proxy", type: "ticker", placeholder: "NOW" },
      { key: "peers", label: "Benchmark peers", type: "tickers", placeholder: "CRM ADBE WDAY INTU ORCL" },
      { key: "ambition", label: "Ambition", type: "select", options: ["Peer median", "Top quartile", "Both"], default: "Both" },
    ],
    example: {
      gl: "account_code,account_name,category,department,cost_owner,fy_spend,vendor\n6100,Salaries and wages,People,Sales,CRO,184200000,\n6110,Salaries and wages,People,R&D,CTO,212600000,\n6120,Salaries and wages,People,G&A,CFO,61400000,\n6200,Contractors and professional services,Third party,R&D,CTO,38900000,Various\n6210,Management consulting,Third party,G&A,CFO,12400000,Various\n6220,External audit and tax,Third party,G&A,Controller,4100000,Big 4\n6300,Marketing programs,Marketing,Marketing,CMO,96800000,Various\n6310,Events and sponsorships,Marketing,Marketing,CMO,31500000,Various\n6320,Agency fees,Marketing,Marketing,CMO,18200000,Various\n6400,Cloud hosting,Technology,R&D,CTO,74300000,Hyperscaler\n6410,Software licences,Technology,G&A,CIO,29700000,Various\n6420,Telecom and connectivity,Technology,G&A,CIO,6800000,Various\n6500,Facilities and rent,Facilities,G&A,COO,41200000,Various\n6510,Utilities and maintenance,Facilities,G&A,COO,9600000,Various\n6600,Travel and entertainment,Travel,Sales,CRO,34100000,Various\n6610,Travel and entertainment,Travel,R&D,CTO,7900000,Various\n6700,Recruiting fees,People,G&A,CHRO,14600000,Various\n6710,Training and development,People,G&A,CHRO,5200000,Various",
      revenue: 2540, ticker: "NOW", peers: ["CRM", "ADBE", "WDAY", "INTU", "ORCL"], ambition: "Both",
    },
    instructions: `1. Map the GL: assign every line to a cost category (people, third party, marketing, technology, facilities, travel, other) and to a named cost owner, and report the mapped total, the unmapped total and the lines you could not classify with the reason. Reconcile the baseline to the client's reported cost base and explain any gap; intercompany allocations, capitalized costs and accruals are the usual causes and each is a finding. 2. Flag data problems with calc: duplicate vendor-amount pairs, lines far outside their category's normal range, categories where a single vendor is more than 50% of spend, and any line without an owner. An unowned cost cannot be reduced. 3. Cut the baseline three ways: by category, by department and by cost owner, each with the spend, the percentage of total and the percentage of revenue. 4. Benchmark with XBRL. For the proxy and every peer call get_xbrl_series for three fiscal years with Revenues, SellingGeneralAndAdministrativeExpense, ResearchAndDevelopmentExpense, GeneralAndAdministrativeExpense, SellingAndMarketingExpense and CostOfRevenue, using get_xbrl_series with find when a filer uses a different tag, and record the tag per company. Compute SG&A %, R&D %, S&M % and G&A % of revenue for each, then the peer Q1, median and Q3. Get headcount from search_filing on the 10-K for "human capital" or "employees" for revenue per employee. 5. Set the target: the gap to median and the gap to top quartile in percentage points and in dollars (gap x client revenue), allocated to the categories that drive the gap rather than spread evenly. Sanity-check against the observed range for zero-based programmes, which is 10-25% of SG&A within about six months; a target far above that needs a structural reason (footprint exit, delayering, outsourcing) stated explicitly. 6. Size each lever bottom-up with a method, not a percentage: demand levers (do we need it at all, at what service level), price levers (rate, contract consolidation, off-contract spend), and productivity levers (spans, layers, automation, offshoring). 7. Write an initiative charter per lever: owner, baseline, target, the mechanism, milestones, the one-time cost to achieve, phasing by quarter, and the KPI that proves it happened. Phase realistically, because savings land in the run rate before they land in the P&L. 8. State the governance: monthly owner reviews against the baseline, the rule for claiming a saving, and how re-investment is tracked separately.
Produce: kpis (mapped baseline, unmapped, baseline % of revenue, peer median and top quartile %, gap to median $, gap to top quartile $, run-rate target); table "Baseline by category" (Category, Spend, % of total, % of revenue, Owner, Peer benchmark, Gap $); table "Baseline by cost owner" with totals; bar of spend by category with a reference line at the peer-median implied level; table "Size of the prize" (Lever, Category, Owner, Baseline, Target, Savings $, % of baseline, One-time cost, Phasing, KPI, Confidence); waterfall from the baseline through the top levers to the target cost base; checklist "Data quality flags" (duplicates, outliers, unowned lines); bullets "Governance rules for claiming savings"; caveats on tag differences between peers, on business-model differences that make a peer's SG&A % not comparable, and on any category benchmarked by judgment.`,
    prompt: (i) => `Build the cost baseline from this GL for a client with $${num(i, "revenue", 2540)}mm of revenue, then set zero-based targets to ${str(i, "ambition", "Both")}.${str(i, "ticker") ? ` Public proxy: ${str(i, "ticker").toUpperCase()}.` : ""}${list(i, "peers").length ? ` Benchmark peers: ${list(i, "peers").join(", ")}.` : ""}`,
  },
  {
    kind: "ai", id: "ops-cost-structure-benchmark", title: "Cost structure benchmark from SEC data", tagline: "Cost of revenue, SG&A, R&D and working-capital days against peer quartiles, with the tag on every line.",
    description: "Benchmarks a company's cost structure line by line against a peer set from SEC XBRL: cost of revenue, SG&A, selling and marketing, G&A, R&D and capex as percentages of revenue, plus DSO, DIO, DPO, cash conversion cycle and revenue per employee. Presents peer quartiles, converts each gap to median and to top quartile into dollars, and explains the two largest gaps from the filings so the numbers survive a partner review.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Strategy", "Technology & digital", "Restructuring / turnaround"],
    category: "Planning & forecasting", icon: "Gauge", deliverable: "table", savesMinutes: 240, tags: ["benchmark", "SG&A", "R&D", "XBRL", "working capital"], effort: "high",
    fields: [
      { key: "ticker", label: "Subject", type: "ticker", required: true, placeholder: "LULU" },
      { key: "peers", label: "Peers", type: "tickers", required: true, placeholder: "NKE DECK VFC COLM UAA" },
      { key: "lines", label: "Cost lines", type: "multiselect", options: ["Cost of revenue %", "Gross margin", "SG&A %", "Selling & marketing %", "G&A %", "R&D %", "Capex %", "Revenue per employee", "DSO", "DIO", "DPO", "Cash conversion cycle"], default: ["Cost of revenue %", "SG&A %", "Selling & marketing %", "Revenue per employee", "DIO", "Cash conversion cycle"] },
      { key: "years", label: "Fiscal years", type: "number", default: 3, min: 1, max: 5 },
    ],
    example: { ticker: "LULU", peers: ["NKE", "DECK", "VFC", "COLM", "UAA"], lines: ["Cost of revenue %", "SG&A %", "Selling & marketing %", "Revenue per employee", "DIO", "Cash conversion cycle"], years: 3 },
    instructions: `1. Keep the whole comparison inside roughly 30 tool calls: cap the set at eight companies and make one batched XBRL call per company rather than one per concept. For the subject and every peer call get_company_financials, then a single get_xbrl_series call for the requested number of fiscal years carrying every concept the selected lines need: Revenues and RevenueFromContractWithCustomerExcludingAssessedTax, CostOfRevenue and CostOfGoodsAndServicesSold, GrossProfit, SellingGeneralAndAdministrativeExpense, SellingAndMarketingExpense, GeneralAndAdministrativeExpense, ResearchAndDevelopmentExpense, OperatingIncomeLoss, DepreciationDepletionAndAmortization, PaymentsToAcquirePropertyPlantAndEquipment, AccountsReceivableNetCurrent, InventoryNet and AccountsPayableCurrent. When a filer does not report a concept, call get_xbrl_series with find (for example "Selling|Marketing|Administrative|ResearchAndDevelopment|Inventory|Payable") to find its actual tag, and record the tag used per company per line. Where a filer reports only a combined SG&A, say so rather than splitting it by assumption. 2. Compute each line with calc as a percentage of revenue, and the working-capital days as DSO = AR / revenue x 365, DIO = inventory / cost of revenue x 365, DPO = payables / cost of revenue x 365, CCC = DSO + DIO - DPO. For revenue per employee use headcount from search_filing on each 10-K for "human capital", "employees" or "full-time employees", and mark any headcount you could not find. 3. Build peer Q1, median and Q3 per line and place the subject, stating for each line whether high or low is better. Show the three-year trend for the subject against the peer median so a one-off year is not mistaken for structure. 4. Convert every gap into dollars: (subject % - peer median %) x subject revenue, and the same to top quartile. Total the dollar gaps but warn that the lines overlap, so the sum is an upper bound rather than an addressable prize. 5. Explain the two largest gaps from the filings, for the subject and the single best-performing peer only, using two phrases each from "cost of sales", "selling, general and administrative", "results of operations", "restructuring", "inventory" and "properties"; do not read every peer's filing. Business-model differences (owned versus wholesale, direct versus channel, in-house versus outsourced manufacturing, capitalized versus expensed software) explain most apparent inefficiency, and saying so is the analysis. 6. Calendarize: note differing fiscal year ends and whether you aligned them.
Produce: kpis (subject vs peer median on the first three lines with delta and tone, the total gap to median in dollars, the gap to top quartile in dollars); table "Cost structure" with the subject first (emphasisRow 0), one row per company, one column per selected line, and a median row in totals; table "Quartiles and gaps" (Line, Subject, Q1, Median, Q3, Better direction, Percentile, Gap to median $mm, Gap to top quartile $mm, XBRL tag used); bar of the largest-gap line with the subject emphasized and a reference line at the median; line of the subject against the peer median over the years for the two largest gaps; markdown "Why the gaps exist" with filing citations, separating structural from addressable; bullets "Addressable versus structural"; caveats on extension tags, combined SG&A reporting, missing headcount, fiscal-year offsets and lease accounting differences. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Benchmark ${str(i, "ticker").toUpperCase()}'s cost structure against ${list(i, "peers").join(", ")} on ${list(i, "lines").join(", ")} over ${num(i, "years", 3)} fiscal years. Give quartiles, the XBRL tag used per line, and each gap in dollars.`,
  },
  {
    kind: "ai", id: "ops-operating-model-design", title: "Operating model & org design", tagline: "Spans, layers and decision rights from an org file, with two or three structural options costed.",
    description: "Analyses an organization file for spans of control, layers to the front line, the manager-to-individual-contributor ratio and fragmented sub-scale teams, then designs two or three operating-model options against a stated objective. Each option comes with the structure, the decision rights in RACI form, the spans and layers it produces, the cost effect, the KPIs that would show it working, and what it would break.",
    roles: ["consultant", "corpfin"], specialties: ["Operations & performance", "Strategy", "Technology & digital", "Restructuring / turnaround"],
    category: "Planning & forecasting", icon: "Network", deliverable: "analysis", savesMinutes: 360, tags: ["operating model", "spans and layers", "RACI", "org design"], effort: "high",
    fields: [
      { key: "org", label: "Org / HR census", type: "csv", required: true, columns: "employee_id, title, manager_id, function, level, location, fte, base_salary", placeholder: "employee_id,title,manager_id,function,level,location,fte,base_salary" },
      { key: "objective", label: "Design objective", type: "select", options: ["Cost reduction", "Speed of decisions", "Customer centricity", "Product / platform model", "Post-merger integration", "Carve-out standalone", "Data & AI capability"], default: "Cost reduction" },
      { key: "options", label: "Options to design", type: "number", default: 3, min: 2, max: 4 },
      { key: "constraints", label: "Constraints", type: "textarea", placeholder: "What cannot change: union agreements, regulated roles, locations, named leaders" },
    ],
    example: {
      org: "employee_id,title,manager_id,function,level,location,fte,base_salary\n1,Chief Executive Officer,,Executive,1,Chicago,1,950000\n2,Chief Operating Officer,1,Operations,2,Chicago,1,620000\n3,Chief Commercial Officer,1,Commercial,2,Chicago,1,580000\n4,Chief Financial Officer,1,Finance,2,Chicago,1,560000\n5,SVP Operations East,2,Operations,3,Newark,1,340000\n6,SVP Operations West,2,Operations,3,Phoenix,1,335000\n7,VP Distribution,5,Operations,4,Newark,1,265000\n8,VP Service,5,Operations,4,Newark,1,258000\n9,Director Distribution East,7,Operations,5,Newark,1,185000\n10,Director Service East,8,Operations,5,Newark,1,182000\n11,Manager Branch Ops,9,Operations,6,Newark,1,132000\n12,Manager Branch Ops,9,Operations,6,Boston,1,128000\n13,Supervisor,11,Operations,7,Newark,1,96000\n14,Supervisor,12,Operations,7,Boston,1,94000\n15,Branch Associate,13,Operations,8,Newark,1,62000\n16,Branch Associate,13,Operations,8,Newark,1,61000\n17,Branch Associate,14,Operations,8,Boston,1,63000\n18,SVP Sales,3,Commercial,3,Chicago,1,330000\n19,VP Marketing,3,Commercial,4,Chicago,1,240000\n20,Director Sales East,18,Commercial,5,Newark,1,178000\n21,Manager Inside Sales,20,Commercial,6,Newark,1,124000\n22,Account Executive,21,Commercial,7,Newark,1,98000\n23,Account Executive,21,Commercial,7,Boston,1,96000\n24,VP Financial Planning,4,Finance,4,Chicago,1,235000\n25,Director FP&A,24,Finance,5,Chicago,1,172000\n26,Manager FP&A,25,Finance,6,Chicago,1,128000\n27,Analyst FP&A,26,Finance,7,Chicago,1,92000\n28,Controller,4,Finance,4,Chicago,1,228000\n29,Manager Accounting,28,Finance,6,Chicago,1,126000\n30,Accountant,29,Finance,7,Chicago,1,88000",
      objective: "Cost reduction", options: 3, constraints: "Branch-facing roles cannot be reduced below two per site; the CFO and CRO seats are fixed; no location closures in year one.",
    },
    instructions: `1. Build the hierarchy from manager_id and report the diagnostics with calc: total FTE and cost, the number of layers from the CEO to the front line, the average and median span of control by layer and by function, the count of managers with a span of one or two (the clearest delayering candidates), the manager-to-individual-contributor ratio, and sub-scale functions (a function whose total FTE cannot justify its layer count). Compare with the usual benchmark of six to eight direct reports per manager and a total of five to seven layers in a business of this size, and state that these are conventions, not laws. 2. Quantify the prize implied by the diagnostics: the cost of spans below four and of layers above the benchmark, computed from the census salaries and grossed up for benefits and on-costs with the rate you assume stated. 3. Diagnose the operating model, not just the chart: where decisions actually sit versus where accountability sits, which functions duplicate work across regions, and which handoffs create the delay the objective is trying to remove. Name the two or three design principles that follow from the objective. 4. Design the requested number of options, each a coherent whole rather than a variation in headcount: name it, describe the structure (for example functional with shared services, regional with a thin centre, or product and platform teams with a capability spine), the spans and layers it produces, the roles created and removed, the decision rights as a RACI over the five or six decisions that matter most, the governance forums, the cost effect (run-rate saving, one-time cost, phasing), the KPIs that would prove it works, and what it breaks. 5. Compare the options against the objective and the constraints in a single table, and recommend one with the condition attached. 6. Sequence the change: what happens in the first 100 days, what needs consultation or legal process, what must not be touched until the peak season passes, and the retention risk in the roles that carry the most knowledge. 7. If the census lacks salary or FTE data, do the structural analysis and say plainly which cost numbers you cannot produce.
Produce: kpis (FTE, total payroll cost, layers to the front line, average span, managers with a span below three, sub-scale functions, the indicative run-rate prize); table "Spans and layers" (Layer, Managers, FTE, Average span, Median span, Cost, Benchmark, Gap); bar of average span by function with a reference line at the benchmark; table "Options" (Option, Structure, Layers, Average span, FTE change, Run-rate cost effect, One-time cost, What it fixes, What it breaks); table "Decision rights" (Decision, Responsible, Accountable, Consulted, Informed) under the recommended option; waterfall from the current cost base to the recommended option's cost base; risks (retention, execution, customer disruption, regulatory or consultation) with severity and mitigation; checklist "First 100 days" with owner and due; caveats on on-cost assumptions, census completeness and the fact that span benchmarks vary by work type.`,
    prompt: (i) => `Analyse this org census and design ${num(i, "options", 3)} operating-model options for a ${str(i, "objective", "Cost reduction")} objective.${str(i, "constraints") ? `\n\nConstraints:\n${str(i, "constraints")}` : ""}`,
  },
  {
    kind: "ai", id: "ops-value-creation-plan", title: "Value creation & 100-day plan", tagline: "An EBITDA bridge by initiative, with the first 100 days carved out and owned.",
    description: "Turns diligence findings into a hold-period value creation plan: an EBITDA bridge from entry to exit by initiative, each with an owner, a mechanism, phasing, one-time costs, a KPI and a confidence grade, plus the 100-day plan that is its first chapter split into stabilize, quick wins and foundations. Ends with the exit-value arithmetic separating EBITDA growth, multiple change and deleveraging.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Operations & performance", "Strategy", "Restructuring / turnaround", "Commercial due diligence"],
    category: "Portfolio", icon: "Rocket", deliverable: "model", savesMinutes: 360, tags: ["value creation", "100-day plan", "EBITDA bridge", "portfolio"], effort: "high",
    fields: [
      { key: "company", label: "Company / portco", type: "text", required: true, placeholder: "A $180M revenue specialty coatings distributor" },
      { key: "findings", label: "Diligence findings and red flags", type: "textarea", required: true },
      { key: "ebitda", label: "Entry EBITDA", type: "number", unit: "$mm", default: 22.6 },
      { key: "entryMultiple", label: "Entry multiple", type: "number", unit: "x", default: 10, step: 0.5 },
      { key: "leverage", label: "Entry leverage", type: "number", unit: "x", default: 4.5, step: 0.5 },
      { key: "hold", label: "Hold period", type: "number", unit: "years", default: 5, min: 2, max: 8 },
      { key: "horizon", label: "Produce", type: "select", options: ["100-day plan", "Full value creation plan", "Both"], default: "Both" },
      { key: "ticker", label: "Public benchmark (optional)", type: "ticker", help: "Used to benchmark the margin the plan assumes" },
    ],
    example: {
      company: "A $180M revenue specialty coatings distributor bought at 10x", findings: "Gross margin 210bps below the best public comparable, ~150bps of the recent gain is price not mix\nTop 3 customers are 41% of revenue; two contracts renew inside 18 months\n62% of addressable procurement spend is off-contract\nNine layers to the front line, average span 4.1\nNRR of the top 50 accounts is 96%; lost accounts cite service levels\nNo pricing governance: branch managers discount without approval\nERP implementation is unfinished and monthly close takes 19 days\nWorking capital is 24% of revenue against a peer median near 18%",
      ebitda: 22.6, entryMultiple: 10, leverage: 4.5, hold: 5, horizon: "Both", ticker: "AXTA",
    },
    instructions: `1. Convert each finding into a value lever or a risk to be closed; a finding that produces neither belongs in neither plan. 2. Build the EBITDA bridge from entry EBITDA to the exit case, one bar per initiative, grouped into commercial (pricing, mix, cross-sell, churn reduction, new segments), cost (procurement, footprint, spans and layers, automation), and working capital or capex, which move cash and returns rather than EBITDA and so belong in a separate cash bridge. Size each with a method and a source, not a percentage: quantity x rate, with the analysis behind the rate named. 3. For each initiative give the owner, mechanism, baseline, target, phasing by quarter or year (savings hit the run rate before the P&L), one-time cost to achieve, the KPI and its current value, dependencies, and a confidence grade of High, Medium or Low with the reason. Haircut Low-confidence initiatives explicitly rather than quietly. 4. Write the 100-day plan in three tracks: stabilize (cash, reporting, retention of key people, anything from diligence that is on fire), quick wins (actions with an owner and a payback inside two quarters), and foundations (the capability, data and governance the later years depend on). Every line needs an owner, a date inside 100 days, and a measurable done condition. Include the first-30-days diagnostic list and the reporting pack the sponsor will require by day 45. 5. Exit arithmetic with calc: exit EBITDA, exit value at the entry multiple and at a stated exit multiple, then decompose value creation into EBITDA growth, multiple change and debt paydown, with the implied MOIC and IRR at the entry leverage. Say how much of the return depends on multiple expansion, because that is the part the plan does not control. 6. If a ticker is given, call get_company_financials and get_xbrl_series with Revenues, GrossProfit, OperatingIncomeLoss and SellingGeneralAndAdministrativeExpense, and use search_filing on its 10-K for "results of operations" and "gross margin" to test whether the margin the plan assumes has ever been achieved by anyone in this industry. 7. Governance: the cadence (weekly initiative review, monthly board pack), the rule for claiming a saving against the baseline, and who arbitrates disputed claims.
Produce: kpis (entry EBITDA, exit EBITDA, EBITDA uplift, run-rate value at the entry multiple, one-time costs, MOIC, IRR); waterfall "EBITDA bridge, entry to exit" with one step per initiative and totals; table "Initiative register" (Initiative, Track, Owner, Mechanism, Baseline, Target, Year-1, Run-rate EBITDA, One-time cost, KPI, Confidence); checklist "First 100 days" with owner and due date, grouped into stabilize, quick wins and foundations; table "Value creation attribution" (Source, $mm, % of value created) covering EBITDA growth, multiple change and debt paydown; risks (5-7 with severity, owner and mitigation); bullets "What must be true for the exit case"; caveats on Low-confidence initiatives, on double counting between commercial and cost levers, and on any benchmark used as a target without a mechanism.`,
    prompt: (i) => `Build ${str(i, "horizon", "Both")} for ${str(i, "company")}: entry EBITDA $${num(i, "ebitda", 22.6)}mm at ${num(i, "entryMultiple", 10)}x with ${num(i, "leverage", 4.5)}x leverage and a ${num(i, "hold", 5)}-year hold.${str(i, "ticker") ? ` Benchmark the assumed margin against ${str(i, "ticker").toUpperCase()}.` : ""}\n\nDiligence findings:\n${str(i, "findings")}`,
  },

  /* ---------------- Restructuring / turnaround ---------------- */
  {
    kind: "ai", id: "turn-13-week-cash-engine", title: "13-week cash flow engine", tagline: "Receipts, disbursements and financing by week from the agings, with headroom against minimum cash.",
    description: "Builds the turnaround team's operating system from the raw ledgers: weekly receipts driven off the receivables aging and collection behaviour, disbursements split into payroll, taxes, critical vendors, other payables, rent, debt service and professional fees, and financing with revolver availability, all against the minimum-cash policy. Produces the weekly variance narrative, the top five drivers split into timing and permanent, and the decisions the cash meeting must take.",
    roles: ["consultant", "corpfin"], specialties: ["Restructuring / turnaround", "Operations & performance", "Financial due diligence (TAS)"],
    category: "Credit & restructuring", icon: "Hourglass", deliverable: "model", savesMinutes: 420, tags: ["13WCF", "liquidity", "DIP", "cash"], effort: "high",
    fields: [
      { key: "aging", label: "AR and AP aging", type: "csv", required: true, columns: "bucket, accounts_receivable, accounts_payable, notes", placeholder: "bucket,accounts_receivable,accounts_payable,notes" },
      { key: "calendar", label: "Payroll, rent, tax, debt and capex calendar", type: "textarea", required: true, placeholder: "Payroll $3.1M biweekly from week 2; rent $0.9M weeks 1, 5, 9, 13; sales tax $1.4M week 3; interest $2.2M week 6..." },
      { key: "openingCash", label: "Opening cash", type: "number", unit: "$000s", default: 8400 },
      { key: "minCash", label: "Minimum cash policy", type: "number", unit: "$000s", default: 5000 },
      { key: "revolver", label: "Revolver availability", type: "number", unit: "$000s", default: 12000 },
      { key: "billings", label: "Weekly billings", type: "number", unit: "$000s", default: 6200 },
      { key: "actuals", label: "Week-zero actuals and variances (optional)", type: "textarea", placeholder: "Last week: forecast receipts 6,100 actual 5,300; payroll on plan; a critical vendor took a $400k prepayment" },
    ],
    example: {
      aging: "bucket,accounts_receivable,accounts_payable,notes\nCurrent,14200,9100,\n1-30 days,8600,6400,\n31-60 days,4100,3800,Two accounts in dispute\n61-90 days,2300,2900,Critical vendors are 1400 of this\n90+ days,3100,4200,1900 likely uncollectible",
      calendar: "Payroll $3,100k biweekly beginning week 2\nBenefits and payroll taxes $620k with each payroll\nRent $880k in weeks 1, 5, 9 and 13\nSales and use tax $1,400k in week 3\nProperty tax $900k in week 10\nInterest and amortization $2,200k in weeks 6 and 13\nProfessional fees $450k weekly from week 1\nCritical vendor payments $1,100k weekly\nCapex, maintenance only, $180k weekly",
      openingCash: 8400, minCash: 5000, revolver: 12000, billings: 6200,
      actuals: "Last week forecast receipts were 6,100 against 5,300 actual; a top-five customer paid 800 late and has promised it this week. Payroll was on plan. A critical vendor demanded a 400 prepayment to keep shipping.",
    },
    instructions: `1. Lock the cash truth first: state the opening cash, which accounts it includes, and whether any of it is restricted or trapped in a subsidiary. A 13-week forecast that starts from an unverified cash number is an exercise, not a control. 2. Drive receipts from the aging rather than from revenue: assume current and 1-30 day receivables collect over the next two to four weeks, 31-60 over four to six, 61-90 with a haircut and a delay, and 90-plus at a stated recovery rate, and say the pattern you used. Add collections on new billings at the implied lag. Reconcile total forecast receipts to total collectible receivables plus billings so nothing is collected twice, and show that reconciliation. 3. Lay the disbursement calendar out by week in the standard order: payroll, benefits and payroll taxes, other taxes, rent, critical vendors, other trade payables, debt service, capex, professional fees. Payroll and taxes are non-deferrable and must never be the balancing item; if the week is short, the flex sits in trade payables and capex, and you should say which. 4. Build the summary block per week: beginning cash, receipts, disbursements, net operating cash, revolver draw or repayment, ending cash, the minimum cash policy, headroom, and remaining revolver availability. Draw only to the minimum-cash policy and repay from excess. Use calc for every row and make the weeks tie: the ending cash of one week equals the beginning cash of the next. 5. Identify the trough week and its headroom, the first week of any breach, and the size of the funding gap. If the forecast breaches, state the mitigations in the order a company actually uses them: collections acceleration on named accounts, vendor term extension, capex deferral, non-core asset sales, then new money. 6. Where week-zero actuals are supplied, produce the variance report: forecast against actual by line, the top five drivers, each tagged Timing or Permanent, the cash effect of each, the owner, and the effect on the 13-week ending cash. A timing variance changes the shape; a permanent variance changes the outcome. 7. Write the weekly cash meeting agenda: actuals review, disbursement approvals above the threshold, collections by owner, the two-week liquidity view, the actions log and the decisions needed. Say explicitly that without a weekly meeting with approvals, variances and owners, the forecast will not change outcomes. 8. Note the covenant and reporting implications: what the lender or a DIP budget requires, the permitted variance (often 10-15% on disbursements, tested weekly or on a rolling four-week basis), and the reporting date.
Produce: kpis (opening cash, trough cash and its week, minimum headroom, total receipts, total disbursements, peak revolver draw, funding gap if any); table "13-week cash flow" with one row per line item and one column per week, in the order receipts, each disbursement category, total disbursements, net operating cash, financing, ending cash, headroom, availability, with weekly totals; line "Ending cash against the minimum-cash policy" as two series; bar of weekly headroom with the trough emphasized; table "Variance report" (Line, Forecast, Actual, Variance, Timing or Permanent, Owner, Effect on week 13) when actuals are supplied; checklist "Cash meeting agenda and approvals" with owner; risks (liquidity, vendor, covenant, payroll) with severity and mitigation; bullets "Mitigations in the order to use them" with the cash each releases; caveats on the collection pattern assumed, on restricted cash, and on any disbursement estimated rather than calendared.`,
    prompt: (i) => `Build a 13-week cash flow from these agings and this calendar. Opening cash $${num(i, "openingCash")}k, minimum cash policy $${num(i, "minCash")}k, revolver availability $${num(i, "revolver")}k, weekly billings $${num(i, "billings")}k.\n\nCalendar:\n${str(i, "calendar")}${str(i, "actuals") ? `\n\nWeek-zero actuals and variances:\n${str(i, "actuals")}` : ""}`,
  },
  {
    kind: "ai", id: "turn-liquidity-triage-cro-plan", title: "Liquidity triage & CRO 30-60-90", tagline: "Runway, covenant headroom and maturities from the filings, then the first 90 days of a CRO.",
    description: "Triages a distressed situation from public filings: liquidity and runway from cash, revolver availability and burn, covenant headroom and maturity walls from the debt footnote, and the warning signals in recent 8-Ks and going-concern language. Then writes the chief restructuring officer's 30-60-90 day plan, with the stabilization actions, the lender and creditor engagement sequence, and the decision gates between an out-of-court fix and a filing.",
    roles: ["consultant", "corpfin"], specialties: ["Restructuring / turnaround", "Operations & performance", "Financial due diligence (TAS)"],
    category: "Credit & restructuring", icon: "Flame", deliverable: "memo", savesMinutes: 360, tags: ["turnaround", "CRO", "liquidity", "covenants", "IBR"], effort: "high",
    fields: [
      { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "VFC" },
      { key: "situation", label: "What you already know", type: "textarea", placeholder: "Lender posture, recent amendments, management changes, sponsor stance" },
      { key: "minCash", label: "Minimum operating cash", type: "number", unit: "$mm", default: 250 },
      { key: "role", label: "Mandate", type: "select", options: ["CRO / interim management", "Lender-side independent business review", "Company-side advisor", "Creditor committee advisor"], default: "CRO / interim management" },
      { key: "horizon", label: "Plan horizon", type: "select", options: ["30-60-90 days", "First 13 weeks", "Both"], default: "Both" },
    ],
    example: { ticker: "VFC", situation: "Leverage is elevated after a period of brand underperformance; the dividend has been cut and disposals are underway. Lenders are engaged but watching the leverage covenant, and a maturity sits inside 24 months.", minCash: 250, role: "CRO / interim management", horizon: "Both" },
    instructions: `1. Establish the facts before the plan. Call get_company_financials for scale, margins and cash flow. Call get_xbrl_series with LongTermDebtNoncurrent, LongTermDebtCurrent, InterestExpense, CashAndCashEquivalentsAtCarryingValue, OperatingLeaseLiability, NetCashProvidedByUsedInOperatingActivities and PaymentsToAcquirePropertyPlantAndEquipment for six to eight periods, using find when a tag is missing. 2. Read the debt: search_filing on the latest 10-K and 10-Q for "indebtedness", "credit agreement", "revolving credit facility", "covenant", "maturities of long-term debt", "liquidity and capital resources", "subsequent events" and "going concern", and read_filing to expand each hit. Pull tranche, amount, coupon, maturity, security, guarantors and the financial covenants with their definitions and test dates. If a covenant definition matters, use edgar_fulltext_search with forms ["8-K","10-K"] and the phrase "Consolidated EBITDA" or "leverage ratio" to find the credit agreement exhibit and read_document it. 3. Call get_recent_filings with forms ["8-K"] and flag items 1.01, 2.03, 2.04, 2.05, 2.06, 3.02, 4.02 and 5.02, plus any amendment, waiver or forbearance, and note dividend or buyback suspensions and asset sales. Call get_insider_transactions and note any pattern. 4. Compute liquidity with calc: cash plus revolver availability, less the minimum operating cash, over the quarterly or monthly burn, to give runway in months. Compute covenant headroom against the tested ratio and the EBITDA decline that breaches it, which is the number that matters most. Build the maturity wall by year and identify the first maturity that cannot be refinanced out of internal cash generation. 5. Triage: state the situation as a Liquidity crisis, a Covenant crisis, a Balance-sheet crisis or Operating underperformance, because each has a different fix, and name the binding constraint with its date. 6. Write the plan for the mandate. A CRO plan covers days 1-30 (control cash: a daily cash report, disbursement approvals, a 13-week forecast, verify the cash truth, stop discretionary spend, retain key people, open the lender dialogue, secure the advisers), days 31-60 (the diagnostic: contribution by business line and customer, the cost baseline, the working capital opportunity, the business plan and its downside, the liquidity scenarios) and days 61-90 (the restructuring path: the plan presented to lenders, the amend-and-extend or new-money ask, the asset disposals, the operational actions committed with owners, and the contingency preparation). A lender-side IBR instead tests management's plan, its liquidity and its sensitivities, and reports on viability and options. 7. Set the decision gates with dates and the test at each: does the out-of-court solution close the funding gap; is there a consenting majority in each class; does the company have 13 weeks of liquidity to negotiate; does it need the protection of a filing and a DIP budget to hold vendors. 8. Name the stakeholders and the sequence: secured lenders first, then bondholders, then the unsecured trade, with the message and the ask for each, and the disclosure constraint on each conversation.
Produce: callout with the triage verdict and the binding constraint with its date; kpis (cash, revolver availability, total liquidity, runway in months, leverage, covenant headroom, EBITDA cushion to breach, first material maturity); table "Capital structure" (Tranche, Amount, Coupon, Maturity, Security, Covenant, Source); timeline of maturities, covenant test dates and the 8-K events already filed; bar of liquidity against the minimum-cash policy over the coming quarters; checklist "30-60-90 plan" grouped by phase with owner and due date; table "Decision gates" (Gate, Date, Test, If yes, If no); risks (5-7 with severity and mitigation); bullets "Stakeholder sequence and the ask for each"; caveats on covenant definitions not fully disclosed, on a burn rate derived from reported cash flow rather than a weekly forecast, and on anything estimated.`,
    prompt: (i) => `Triage ${str(i, "ticker").toUpperCase()} from its filings and write the ${str(i, "horizon", "Both")} plan for a ${str(i, "role", "CRO / interim management")} mandate. Minimum operating cash is $${num(i, "minCash")}mm.${str(i, "situation") ? `\n\nWhat we already know:\n${str(i, "situation")}` : ""}`,
  },

  /* ---------------- Economic & valuation advisory ---------------- */
  {
    kind: "ai", id: "econ-damages-model", title: "Damages & lost profits scaffold", tagline: "A but-for model with a yardstick benchmark, the causation chain, and an assumption log that survives cross-examination.",
    description: "Builds the economic-damages scaffold for a lost-profits, reasonable-royalty or event-study claim: the but-for world constructed from a yardstick benchmark of public comparables, the causation chain from the alleged conduct to the harm, incremental rather than fully absorbed margins, the mitigation and offset analysis, and prejudgment interest. Every assumption is logged with its source and the sensitivity it drives, because the assumption log is what an opposing expert attacks.",
    roles: ["consultant"], specialties: ["Economic & valuation advisory", "Financial due diligence (TAS)", "Strategy"],
    category: "Valuation", icon: "Landmark", deliverable: "memo", savesMinutes: 420, tags: ["damages", "lost profits", "but-for", "event study", "expert"], effort: "high",
    fields: [
      { key: "matter", label: "Matter", type: "text", required: true, placeholder: "Breach of an exclusive distribution agreement" },
      { key: "theory", label: "Damages theory", type: "select", options: ["Lost profits (but-for)", "Reasonable royalty", "Unjust enrichment / disgorgement", "Diminution in value", "Event study (securities)", "Price erosion"], default: "Lost profits (but-for)" },
      { key: "plaintiff", label: "Plaintiff / claimant", type: "text", required: true, placeholder: "A regional equipment rental operator" },
      { key: "benchmarks", label: "Yardstick companies", type: "tickers", placeholder: "URI HEES WSC", help: "Public comparables used to build the but-for growth rate" },
      { key: "eventDate", label: "Event / breach date", type: "date", default: "2024-03-15" },
      { key: "period", label: "Damages period", type: "text", default: "March 2024 to June 2026" },
      { key: "facts", label: "Facts and data in hand", type: "textarea", required: true },
    ],
    example: {
      matter: "Breach of an exclusive regional distribution agreement", theory: "Lost profits (but-for)", plaintiff: "A regional equipment rental operator with $84M of revenue before the breach", benchmarks: ["URI", "HEES", "WSC"], eventDate: "2024-03-15", period: "March 2024 to June 2026",
      facts: "Pre-breach revenue grew 11% in 2022 and 9% in 2023\nRevenue was $84M in the twelve months to February 2024, then $79M and $81M in the following two twelve-month periods\nIncremental contribution margin on rental revenue is about 46%; fixed fleet and branch costs did not change\nThe plaintiff added $1.1M of costs to source substitute equipment\nTwo of five lost accounts were regained in 2025 at lower rates\nThe defendant began supplying two competitors in the territory in March 2024\nThe wider rental market grew through the period on public filers' disclosures",
    },
    instructions: `1. Frame the claim: the conduct alleged, the causal mechanism from conduct to harm, the damages period with its start and end dates and the reason for each, and the damages theory. State the standard you are working to in economic terms - the harm must be caused by the conduct, reasonably certain in amount rather than speculative, and foreseeable - and note that the expert opines on the economics, not on liability. 2. Build the but-for world. For the yardstick method, call get_company_financials and get_xbrl_series with Revenues and OperatingIncomeLoss for the benchmark tickers over the pre-event and damages periods, and search_filing on their 10-Ks for "results of operations", "demand", "rental rates", "competition" and "seasonality" to confirm the benchmark experienced the same market conditions and no idiosyncratic shock. Compute the benchmark growth over the damages period with calc and apply it to the plaintiff's pre-event base, and say why the benchmark is a valid control. Cross-check with at least one second method: the plaintiff's own pre-event trend, the before-and-after comparison, or a market-share method, and reconcile the results. 3. Compute lost revenue per period as but-for revenue less actual revenue, and convert to lost profits using the incremental contribution margin, not the fully absorbed margin: identify which costs were avoided because the revenue did not occur, and treat fixed costs that continued as unavoided. This is the single most attacked step, so show the margin derivation. 4. Add the plaintiff's mitigation and additional costs caused by the conduct, and deduct the benefit of any mitigation achieved (revenue regained, costs avoided, substitute business won). Address the duty to mitigate explicitly. 5. Prejudgment interest: state the rate, whether simple or compound and the statutory basis, and compute from each period's midpoint to the judgment date. Say how the answer would differ if the tribunal instead discounts future losses to present value, and never do both to the same cash flow. 6. For a reasonable royalty, build the royalty base and rate separately, with comparable licences and the profit-split logic, and sanity-check against the infringer's own margin. For an event study, define the estimation and event windows, the market and industry index, the regression specification, the abnormal return with its statistical significance, and the per-share inflation ribbon. 7. Sensitivities: rank the four or five assumptions that move the number most (but-for growth, incremental margin, damages period length, mitigation credit, interest rate) and give the range, not just a point estimate. 8. Write the assumption log: every assumption, its source, its direction of effect, the opposing argument against it, and your response. Then list the data you would need in discovery to replace each judgment with evidence.
Produce: callout with the damages range and the single assumption that drives it; kpis (lost revenue, incremental margin, lost profits, mitigation costs, offsets, prejudgment interest, total damages); table "But-for model" (Period, But-for revenue, Actual revenue, Lost revenue, Incremental margin, Lost profit, Interest years, Interest, Cumulative) with totals; line "But-for against actual revenue" as two series with the benchmark index as a third; waterfall from lost profits through mitigation costs, offsets and interest to total damages; table "Method triangulation" (Method, Result, Strengths, Weaknesses); sensitivity of total damages over but-for growth against incremental margin; table "Assumption log" (Assumption, Value, Source, Effect, Opposing argument, Response); bullets "Discovery requests that would replace judgment with evidence"; caveats on causation being a legal question, on the reliability standard expert testimony must meet, and on every figure taken from the plaintiff without independent support.`,
    prompt: (i) => `Build a ${str(i, "theory", "Lost profits (but-for)")} damages scaffold for ${str(i, "plaintiff")} in this matter: ${str(i, "matter")}. Event date ${str(i, "eventDate", "2024-03-15")}, damages period ${str(i, "period", "the period stated")}.${list(i, "benchmarks").length ? ` Yardstick companies: ${list(i, "benchmarks").join(", ")}.` : ""}\n\nFacts and data:\n${str(i, "facts")}`,
  },
  {
    kind: "ai", id: "econ-dlom-control-premium", title: "DLOM & control premium reference", tagline: "Marketability and control adjustments built from empirical studies and EDGAR deal premiums.",
    description: "Builds the defensible discount and premium stack between a public-comparable value and the interest actually being valued: the discount for lack of marketability from restricted-stock and option-based models, the discount for lack of control or its inverse control premium from an empirical sample of real deal premiums pulled from EDGAR merger proxies, and the Mandelbaum factors applied to the subject. States the level of value at each step so the adjustments are not double counted.",
    roles: ["consultant"], specialties: ["Economic & valuation advisory", "Financial due diligence (TAS)", "Strategy"],
    category: "Valuation", icon: "Percent", deliverable: "memo", savesMinutes: 300, tags: ["DLOM", "control premium", "Mandelbaum", "levels of value"], effort: "high",
    fields: [
      { key: "subject", label: "Subject interest", type: "text", required: true, placeholder: "A 22% non-voting interest in a private industrial components maker" },
      { key: "ticker", label: "Public comparable", type: "ticker", required: true, placeholder: "ETN" },
      { key: "basis", label: "Adjustment required", type: "select", options: ["Minority marketable to minority non-marketable (DLOM)", "Control to minority (DLOC)", "Minority to control (control premium)", "Full stack: control marketable to minority non-marketable"], default: "Full stack: control marketable to minority non-marketable" },
      { key: "purpose", label: "Purpose", type: "select", options: ["Gift or estate tax (Rev. Rul. 59-60)", "Financial reporting (ASC 820)", "Shareholder dispute / fair value", "Buy-sell agreement", "Divorce"], default: "Gift or estate tax (Rev. Rul. 59-60)" },
      { key: "hold", label: "Expected holding period", type: "number", unit: "years", default: 3, min: 0.5, max: 10, step: 0.5 },
      { key: "vol", label: "Volatility of the comparable", type: "number", unit: "%", default: 28 },
      { key: "facts", label: "Subject facts", type: "textarea", placeholder: "Distribution history, transfer restrictions, buy-sell terms, prospect of a sale or IPO, size of block, information rights" },
    ],
    example: {
      subject: "A 22% non-voting, non-controlling interest in a private industrial components maker with $140M of revenue", ticker: "ETN", basis: "Full stack: control marketable to minority non-marketable", purpose: "Gift or estate tax (Rev. Rul. 59-60)", hold: 3, vol: 28,
      facts: "No dividends in the last four years; the buy-sell requires board consent for any transfer and gives the company a right of first refusal; the family has said it will not sell the business; the block has no board seat and receives annual financial statements only; the company is profitable with modest leverage and a 12-year operating history.",
    },
    instructions: `1. Fix the levels of value before any number: control marketable, minority marketable (the level a public trading multiple produces), control non-marketable, minority non-marketable. Say which level the comparable evidence produces and which level the subject interest sits at, and therefore which adjustments are needed and in which order. Most errors in this area are double counting: applying a control premium to a multiple already derived from control transactions, or a full DLOM on top of a discount already embedded in the income approach. 2. Establish the marketable base: call get_company_financials for the comparable and get_trading_comps for the peer set so the base multiple and the level of value it represents are explicit, and note that public trading multiples are minority marketable. 3. DLOM. Present the empirical families rather than a single number: restricted-stock studies (transactions in unregistered shares of public companies, historically clustering in the mid-teens to mid-thirties percent, with later studies lower after the Rule 144 holding period was shortened), pre-IPO studies (higher, and criticised for selection bias), and option-based models where the discount is the cost of the lost ability to sell - Chaffe using a European put over the holding period, Longstaff using a lookback put, and Finnerty using an average-strike put. Compute the option-based indications from the holding period and volatility supplied, show the inputs, and say that each model measures a different thing. 4. Apply the Mandelbaum factors to the subject facts one by one, each with the direction and rough magnitude of its effect: private versus public sale prospects, the financial statement analysis, the company's dividend policy and history, the nature of the company and its history and position in the industry, management, the amount of control in the transferred shares, transfer restrictions, holding period, the company's redemption policy, and the costs of a public offering. Conclude a DLOM with a range and a point, and tie the point to the factors rather than to a study average. 5. Control premium or minority discount. Build an empirical sample from EDGAR rather than citing a study you cannot see: run edgar_fulltext_search with forms ["DEFM14A","S-4","8-K"] and phrases such as "premium to the unaffected" or "agreement and plan of merger" for the subject's industry and period, then read_document each hit with queries "premium", "per share merger consideration" and "unaffected" to extract the announced premium to the unaffected price, and compute the median and quartiles with calc. State what the premium actually contains - synergies and the acquirer's specific plans, not only control - which is why a full announced premium overstates pure control value. Convert between the two forms: the implied minority discount = 1 - 1 / (1 + control premium), and say so explicitly. 6. Build the stack in order with each step's basis and the resulting value, and state the purpose-specific standard: the Rev. Rul. 59-60 factors and the fair market value standard for tax, ASC 820 and the unit of account for financial reporting, and the relevant statutory standard where fair value rather than fair market value applies, noting that some jurisdictions disallow marketability discounts in dissenters' matters. 7. Give the sensitivity of the concluded value to the DLOM and to the control adjustment, and name the evidence that would narrow each.
Produce: callout with the concluded discount stack and the resulting value indication; kpis (the base multiple and its level of value, DLOM range, DLOM concluded, control premium median from the EDGAR sample, implied minority discount, net adjustment); table "Levels of value" (Level, Adjustment applied, Basis, Value indication) as an ordered walk; table "DLOM evidence" (Source family, Indication, What it measures, Applicability to the subject) covering restricted stock, pre-IPO, Chaffe, Longstaff and Finnerty with the option inputs shown; score "Mandelbaum factors" scoring each factor with the direction of effect in the note; table "Control premium sample from EDGAR" (Announced, Target, Acquirer, Premium to unaffected, Source); sensitivity of the concluded value over DLOM against the control adjustment; bullets "Double-counting checks performed"; caveats on study vintage and comparability, on the difference between synergistic premiums and control value, on jurisdictional treatment of discounts, and on every judgment input.`,
    prompt: (i) => `Build the ${str(i, "basis", "Full stack")} adjustment for ${str(i, "subject")} using ${str(i, "ticker").toUpperCase()} as the public comparable, for a ${str(i, "purpose", "Gift or estate tax (Rev. Rul. 59-60)")} purpose. Expected holding period ${num(i, "hold", 3)} years, comparable volatility ${num(i, "vol", 28)}%.${str(i, "facts") ? `\n\nSubject facts:\n${str(i, "facts")}` : ""}`,
  },

  /* ---------------- Technology & digital ---------------- */
  {
    kind: "ai", id: "tdd-checklist", title: "Technology due diligence checklist", tagline: "Architecture, technical debt, velocity, security and IT cost, scored with the evidence to request.",
    description: "Produces the technology diligence workplan and scorecard for a two-to-four week tech DD: the question set per area, the artefacts and access to request, the red flags that change the deal, and a scored assessment of architecture and scalability, technical debt, engineering organization and velocity, security and compliance, data and AI readiness, third-party and licensing exposure, and the IT cost baseline benchmarked against public R&D and technology spend ratios.",
    roles: ["consultant", "pe"], specialties: ["Technology & digital", "Commercial due diligence", "Operations & performance"],
    category: "Diligence", icon: "Server", deliverable: "checklist", savesMinutes: 300, tags: ["tech DD", "technical debt", "architecture", "security"], effort: "high",
    fields: [
      { key: "target", label: "Target", type: "text", required: true, placeholder: "A $70M ARR vertical SaaS platform for dental practices" },
      { key: "stack", label: "What is known about the stack and team", type: "textarea", required: true, placeholder: "Languages, cloud, monolith or services, team size, release cadence, incidents, certifications" },
      { key: "peers", label: "Public benchmarks", type: "tickers", placeholder: "NOW VEEV TYL PCTY", help: "Used to benchmark R&D and technology spend as a percentage of revenue" },
      { key: "spend", label: "Technology spend", type: "number", unit: "% of revenue", default: 14 },
      { key: "areas", label: "Areas in scope", type: "multiselect", options: ["Architecture & scalability", "Technical debt", "Engineering org & velocity", "Security & compliance", "Data & AI readiness", "IT cost baseline", "Third-party & licensing", "Integration / carve-out readiness"], default: ["Architecture & scalability", "Technical debt", "Engineering org & velocity", "Security & compliance", "Data & AI readiness", "IT cost baseline"] },
      { key: "thesis", label: "Deal thesis the technology must support", type: "text", placeholder: "3x the customer count in four years and add two adjacent modules" },
    ],
    example: { target: "A $70M ARR vertical SaaS platform for dental practices", stack: "Ruby on Rails monolith with a Postgres primary, some Go services for scheduling, AWS single-region, 46 engineers across product and platform, monthly releases with a two-day freeze, three Sev-1 incidents last year, SOC 2 Type II but no HITRUST, no formal SRE function, one founder-engineer holds most of the billing logic.", peers: ["NOW", "VEEV", "TYL", "PCTY"], spend: 14, areas: ["Architecture & scalability", "Technical debt", "Engineering org & velocity", "Security & compliance", "Data & AI readiness", "IT cost baseline"], thesis: "Triple the practice count in four years and add payments and analytics modules" },
    instructions: `1. Start from the deal thesis and work backwards: technology diligence is not an audit, it is a test of whether this stack and this team can deliver that plan at that cost. State the two or three technical conditions the thesis depends on. 2. For every area in scope produce the question set (8-12 questions a CTO cannot answer with a slide), the artefacts to request (architecture diagrams, the cloud bill by service, repository and commit statistics, the incident and post-mortem log, test coverage and build times, the dependency and licence inventory, pen-test and SOC 2 reports with the exceptions list, DPAs and the sub-processor list, the backlog and roadmap, an org chart with tenure, a key-person map), and the red flags that change price or structure. Name the specific red flags: single points of failure in one person or one region, a monolith with no seams where the roadmap needs modules, no automated tests where the plan requires speed, licence contamination from copyleft components in shipped code, customer data commingled across tenants, unremediated pen-test findings, no disaster-recovery test, capitalized development that flatters EBITDA, and a cloud bill growing faster than revenue. 3. Benchmark the cost. For each public benchmark call get_company_financials and get_xbrl_series with Revenues, ResearchAndDevelopmentExpense and CostOfRevenue, and search_filing on the 10-K for "research and development", "hosting", "cost of revenue" and "human capital" to see how each describes technology spend and capitalization. Compute R&D as a percentage of revenue and the range across the set with calc, compare the target's technology spend, and say what the difference means: under-investment relative to the roadmap, or genuine efficiency. Also check the capitalized software treatment, because it changes both EBITDA and the true engineering run rate. 4. Score each area 1-5 against what the thesis requires, not against a theoretical ideal, with the evidence for the score and the evidence still missing. 5. Quantify remediation: the investment needed by area over the hold period, one-time against run-rate, and the effect on the model. A tech DD that ends in adjectives has failed; end in dollars and dates. 6. Write the 100-day technology plan and the diligence sessions to run: who to interview, in what order, and the one question that must be answered in each.
Produce: callout with the go / go-with-conditions / no-go verdict and the conditions; score "Technology scorecard" scoring each in-scope area out of 5 with the evidence in the note; table "Diligence workplan" (Area, Questions to ask, Artefacts to request, Owner, Session, Red flags to test); kpis (target technology spend % of revenue, peer R&D % median and range, engineers, estimated remediation investment, key-person risks); bar of R&D % of revenue across the benchmarks with the target's spend as a reference line; risks "Technical red flags" with severity and mitigation; table "Remediation investment" (Item, Type, Year 1, Run-rate, Rationale); checklist "First 100 days after close" with owner and due; bullets "What the thesis requires that this stack cannot do today"; caveats on what could not be tested without code and infrastructure access, and on capitalized software comparability between the target and the public benchmarks. If you approach the tool-call budget before every field is filled, stop gathering and write the output with what you have, marking the unfilled fields Not found and listing them in caveats: a complete structure with labelled gaps is worth more than a truncated answer.`,
    prompt: (i) => `Build the technology diligence plan and scorecard for ${str(i, "target")}, covering ${list(i, "areas").join(", ")}. Technology spend is ${num(i, "spend", 14)}% of revenue.${list(i, "peers").length ? ` Benchmark against ${list(i, "peers").join(", ")}.` : ""}${str(i, "thesis") ? ` The thesis the technology must support: ${str(i, "thesis")}.` : ""}\n\nWhat is known:\n${str(i, "stack")}`,
  },
];

/* ======================================================================================
 * Calculator helpers
 * ====================================================================================== */

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Locate a CSV column by any of its accepted names, falling back to a substring match. */
function findCol(header: string[], ...names: string[]): number {
  const h = header.map(norm);
  for (const n of names) { const k = h.indexOf(norm(n)); if (k >= 0) return k; }
  for (const n of names) { const t = norm(n); const k = h.findIndex((x) => x.includes(t)); if (k >= 0) return k; }
  return -1;
}

/** Numeric cell, tolerant of currency symbols, thousands separators, percent signs and parentheses. */
function cellNum(row: string[], k: number, fallback = 0): number {
  if (k < 0) return fallback;
  const raw = (row[k] ?? "").trim();
  if (raw === "") return fallback;
  const neg = /^\(.*\)$/.test(raw);
  const v = Number(raw.replace(/[()$,%\s]/g, ""));
  if (!Number.isFinite(v)) return fallback;
  return neg ? -v : v;
}

const cellStr = (row: string[], k: number, fallback = "") => (k < 0 ? fallback : (row[k] ?? "").trim() || fallback);

/** Linear-interpolation quantile (the R-7 / Excel PERCENTILE convention) over an unsorted array. */
function quantile(values: number[], p: number): number {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return NaN;
  if (v.length === 1) return v[0];
  const h = (v.length - 1) * p, lo = Math.floor(h), hi = Math.ceil(h);
  return v[lo] + (h - lo) * (v[hi] - v[lo]);
}

const mean = (v: number[]) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

/** 1 -> "1st", 22 -> "22nd", 13 -> "13th". */
const ordinal = (k: number) => { const t = k % 100; return `${k}${t >= 11 && t <= 13 ? "th" : ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][k % 10]}`; };

/* ======================================================================================
 * Calculators
 * ====================================================================================== */

const CALCULATORS: ToolDef[] = [
  {
    kind: "calc", id: "strat-market-sizing", title: "Market sizing: top-down & bottom-up", tagline: "TAM to SAM to SOM, a unit-economics bottom-up, and the 15% convergence test between them.",
    description: "Sizes a market both ways and reconciles them. Top-down filters a macro anchor by geography, segment and eligibility to reach SAM, then applies penetration to reach SOM; bottom-up multiplies reachable accounts by adoption and average contract value. Reports the gap between the two against the 15% convergence threshold practitioners use, and grids obtainable revenue over penetration and price.",
    roles: ["consultant", "pe", "corpfin", "student"], specialties: ["Strategy", "Commercial due diligence", "Economic & valuation advisory"],
    category: "Modeling", icon: "Target", savesMinutes: 90, tags: ["TAM", "SAM", "SOM", "triangulation", "market sizing"],
    fields: [
      { key: "tam", label: "Macro anchor (industry revenue)", type: "number", unit: "$mm", required: true, default: 50000, help: "The cited public statistic the top-down build starts from" },
      { key: "geoPct", label: "Geography filter", type: "number", unit: "%", default: 40, help: "Share of the anchor in the target geography" },
      { key: "segmentPct", label: "Segment filter", type: "number", unit: "%", default: 50 },
      { key: "eligiblePct", label: "Eligibility filter", type: "number", unit: "%", default: 100, help: "Share of the segment that can actually buy (SAM)" },
      { key: "penetrationPct", label: "Penetration / capture", type: "number", unit: "%", default: 10, help: "Share of SAM obtainable (SOM)" },
      { key: "accounts", label: "Addressable accounts or units", type: "number", unit: "count", default: 200000 },
      { key: "reachablePct", label: "Reachable", type: "number", unit: "%", default: 50, help: "Share of accounts the go-to-market can actually reach" },
      { key: "adoptionPct", label: "Adoption / win rate", type: "number", unit: "%", default: 20 },
      { key: "acv", label: "Price per account or unit", type: "number", unit: "$000s", required: true, default: 50 },
      { key: "growth", label: "Market growth", type: "number", unit: "% p.a.", default: 6 },
      { key: "years", label: "Projection horizon", type: "number", unit: "years", default: 5, min: 1, max: 10 },
    ],
    example: { tam: 50000, geoPct: 40, segmentPct: 50, eligiblePct: 100, penetrationPct: 10, accounts: 215000, reachablePct: 50, adoptionPct: 20, acv: 50, growth: 6, years: 5 },
    compute: (i: Inputs): WorkflowOutput => {
      const tam = num(i, "tam"), geo = num(i, "geoPct", 100) / 100, seg = num(i, "segmentPct", 100) / 100, elig = num(i, "eligiblePct", 100) / 100;
      const pen = num(i, "penetrationPct") / 100, accounts = num(i, "accounts"), reach = num(i, "reachablePct", 100) / 100;
      const adopt = num(i, "adoptionPct") / 100, acv = num(i, "acv"), g = num(i, "growth") / 100, years = Math.max(1, Math.round(num(i, "years", 5)));
      if (tam <= 0) throw new Error("The macro anchor must be positive: enter the cited industry revenue in $mm.");
      if (acv <= 0) throw new Error("Price per account must be positive (in $000s).");
      if ([geo, seg, elig, pen, reach, adopt].some((x) => x < 0 || x > 1)) throw new Error("Filters, penetration, reach and adoption are percentages between 0 and 100.");
      const afterGeo = tam * geo, afterSeg = afterGeo * seg, sam = afterSeg * elig, som = sam * pen;
      const customers = accounts * reach * adopt, bottomUp = (customers * acv) / 1000;
      const mid = (som + bottomUp) / 2;
      const gap = mid > 0 ? (bottomUp - som) / mid : 0;
      const converged = Math.abs(gap) <= 0.15;
      const reconciled = converged ? mid : Math.min(som, bottomUp);
      const eligibleCustomers = sam / (acv / 1000);
      const impliedPen = eligibleCustomers > 0 ? customers / eligibleCustomers : 0;
      const impliedAcv = customers > 0 ? (som / customers) * 1000 : 0;
      const pens = [pen * 0.5, pen * 0.75, pen, pen * 1.25, pen * 1.5];
      const acvs = [acv * 0.8, acv * 0.9, acv, acv * 1.1, acv * 1.2];
      const grid = pens.map((p) => acvs.map((a) => (eligibleCustomers * p * a) / 1000));
      const proj = Array.from({ length: years }, (_, k) => ({ x: `Y${k + 1}`, y: reconciled * Math.pow(1 + g, k + 1) }));
      return {
        title: "Market sizing: top-down and bottom-up",
        summary: `Top-down gives a SOM of ${fmt.money(som)} from a ${fmt.money(tam)} anchor (SAM ${fmt.money(sam)} at ${fmt.pct(pen, 0)} penetration); bottom-up gives ${fmt.money(bottomUp)} from ${fmt.int(customers)} accounts at ${fmt.moneyRaw(acv, 0)}k. The two differ by ${fmt.pct(Math.abs(gap), 0)}, ${converged ? "inside the 15% convergence threshold, so the assumptions hang together" : "outside the 15% convergence threshold, so at least one filter or unit factor is wrong"}. The reconciled market is ${fmt.money(reconciled)}, growing to ${fmt.money(reconciled * Math.pow(1 + g, years))} in ${years} years at ${fmt.pct(g, 1)}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Anchor (TAM)", value: fmt.money(tam) }, { label: "SAM", value: fmt.money(sam) },
            { label: "SOM (top-down)", value: fmt.money(som) }, { label: "Bottom-up", value: fmt.money(bottomUp) },
            { label: "Gap", value: fmt.pct(gap, 0), tone: converged ? "pos" : "warn", hint: "Bottom-up vs top-down over the midpoint; 15% is the practitioner threshold" },
            { label: "Reconciled", value: fmt.money(reconciled) },
            { label: "Implied penetration, bottom-up", value: fmt.pct(impliedPen, 1), hint: `Against ${fmt.pct(pen, 1)} assumed top-down` },
          ] },
          { type: "callout", tone: converged ? "pos" : "warn", title: converged ? "Converged within 15%" : "Divergence beyond 15%",
            text: converged
              ? `The two builds agree to ${fmt.pct(Math.abs(gap), 0)}, so the filters and the unit economics are telling the same story. Carry ${fmt.money(reconciled)} as the base case and expose penetration and price as the live drivers.`
              : `The builds disagree by ${fmt.pct(Math.abs(gap), 0)}. Bottom-up implies ${fmt.pct(impliedPen, 1)} penetration of ${fmt.int(eligibleCustomers)} eligible accounts against the ${fmt.pct(pen, 1)} assumed top-down, and top-down implies ${fmt.moneyRaw(impliedAcv, 0)}k per account against the ${fmt.moneyRaw(acv, 0)}k entered. Fix the eligibility filter or the price before averaging; the model defaults to the lower of the two at ${fmt.money(reconciled)}.` },
          { type: "waterfall", title: "Top-down funnel (USD mm)", format: "money", steps: [
            { label: "Macro anchor", value: tam, total: true },
            { label: "Less other geographies", value: -(tam - afterGeo) },
            { label: "Less other segments", value: -(afterGeo - afterSeg) },
            { label: "Less ineligible", value: -(afterSeg - sam) },
            { label: "SAM", value: sam, total: true },
            { label: "Less unpenetrated", value: -(sam - som) },
            { label: "SOM", value: som, total: true },
          ] },
          { type: "table", title: "Top-down build", columns: ["Step", "Filter", "Value ($mm)", "% of anchor"], rows: [
            ["Macro anchor (industry revenue)", "-", fmt.num(tam, 0), fmt.pct(1, 0)],
            ["In target geography", fmt.pct(geo, 0), fmt.num(afterGeo, 0), fmt.pct(afterGeo / tam, 0)],
            ["In target segment", fmt.pct(seg, 0), fmt.num(afterSeg, 0), fmt.pct(afterSeg / tam, 0)],
            ["Eligible to buy (SAM)", fmt.pct(elig, 0), fmt.num(sam, 0), fmt.pct(sam / tam, 0)],
            ["Obtainable (SOM)", fmt.pct(pen, 0), fmt.num(som, 0), fmt.pct(som / tam, 1)],
          ], emphasisRow: 4, note: "Every filter needs a cited source and a confidence tag before this leaves the team room." },
          { type: "table", title: "Bottom-up build", columns: ["Factor", "Value", "Running result"], rows: [
            ["Addressable accounts or units", fmt.int(accounts), fmt.int(accounts)],
            ["Reachable", fmt.pct(reach, 0), fmt.int(accounts * reach)],
            ["Adoption / win rate", fmt.pct(adopt, 0), fmt.int(customers)],
            ["Price per account ($000s)", fmt.num(acv, 1), `${fmt.num(bottomUp, 0)} $mm`],
          ], totals: ["Bottom-up market", "", `${fmt.num(bottomUp, 0)} $mm`] },
          { type: "bar", title: "Top-down, bottom-up and reconciled (USD mm)", format: "money", reference: { value: mid, label: "Midpoint" },
            data: [{ label: "Top-down SOM", value: som }, { label: "Bottom-up", value: bottomUp }, { label: "Reconciled", value: reconciled, emphasis: true }] },
          { type: "sensitivity", title: "Obtainable revenue ($mm): penetration × price", rowLabel: "Penetration", colLabel: "Price ($000s)", rows: pens.map((p) => fmt.pct(p, 1)), cols: acvs.map((a) => fmt.num(a, 0)), values: grid, format: "money", baseRow: 2, baseCol: 2 },
          { type: "line", title: "Reconciled market at the stated growth rate (USD mm)", format: "money", series: [{ name: "Market size", points: proj }] },
        ],
        caveats: [
          "Eligible accounts in the sensitivity grid are held at SAM divided by the entered price, so the grid varies penetration and price against a fixed eligible population.",
          "Top-down and bottom-up are only independent if they do not share an input; if the account count was derived from the anchor, the convergence test proves nothing.",
          "New products typically capture 0.1-2% of SAM in the early years, so a high penetration assumption needs a distribution or contractual reason.",
          "Outside the 15% band the reconciled figure defaults to the lower of the two builds rather than the average.",
        ],
        nextSteps: ["Tag each filter with its source and a High / Medium / Low confidence", "Rebuild the account count from an independent source (establishment counts, licence registers, installed base)", "Run the market model workbench to anchor the filters in public filings"],
      };
    },
  },
  {
    kind: "calc", id: "ops-pvm-decomposition", title: "Price-volume-mix decomposition", tagline: "SKU-level price, volume, mix, new and discontinued effects that tie to the dollar.",
    description: "Decomposes a revenue change between two periods into price, volume, mix, a price-volume cross term and the effect of new and discontinued SKUs, from pasted SKU-level volume and revenue. Both conventions offered are exact: the effects always sum to the reported change, and the residual is shown so the tie-out is visible.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Financial due diligence (TAS)", "Commercial due diligence"],
    category: "Modeling", icon: "Layers", savesMinutes: 90, tags: ["PVM", "bridge", "mix", "variance"],
    fields: [
      { key: "sales", label: "SKU-level sales, two periods", type: "csv", required: true, columns: "sku, base_volume, base_revenue, current_volume, current_revenue", placeholder: "sku,base_volume,base_revenue,current_volume,current_revenue" },
      { key: "method", label: "Convention", type: "select", options: ["Price at base volume + cross term (4 effects)", "Price at current volume (3 effects)"], default: "Price at base volume + cross term (4 effects)" },
      { key: "periods", label: "Period labels", type: "text", default: "FY24 to FY25" },
    ],
    example: {
      sales: "sku,base_volume,base_revenue,current_volume,current_revenue\nEP-100,102000,3876000,108000,4320000\nEP-220,41000,2132000,38000,2090000\nUR-400,18500,1184000,21000,1386000\nMR-300,9200,809600,9800,890800\nSP-150,14000,504000,0,0\nNX-500,0,0,6400,441600\nEP-050,22000,528000,19500,487500",
      method: "Price at base volume + cross term (4 effects)", periods: "FY24 to FY25",
    },
    compute: (i: Inputs): WorkflowOutput => {
      const { header, rows } = parseCsv(str(i, "sales"));
      if (!rows.length) throw new Error("Paste SKU-level rows with columns sku, base_volume, base_revenue, current_volume, current_revenue.");
      const cSku = findCol(header, "sku", "product", "item", "customer");
      const cQ0 = findCol(header, "base_volume", "prior_volume", "base_units", "volume_base");
      const cR0 = findCol(header, "base_revenue", "base_net_revenue", "prior_revenue", "revenue_base");
      const cQ1 = findCol(header, "current_volume", "curr_volume", "volume_current", "new_volume");
      const cR1 = findCol(header, "current_revenue", "current_net_revenue", "curr_revenue", "revenue_current");
      if (cQ0 < 0 || cR0 < 0 || cQ1 < 0 || cR1 < 0) throw new Error(`Could not find the volume and revenue columns. Expected base_volume, base_revenue, current_volume, current_revenue; found: ${header.join(", ")}`);
      const items = rows.map((r, k) => ({ sku: cellStr(r, cSku, `Row ${k + 1}`), q0: cellNum(r, cQ0), r0: cellNum(r, cR0), q1: cellNum(r, cQ1), r1: cellNum(r, cR1) }))
        .filter((x) => x.q0 !== 0 || x.r0 !== 0 || x.q1 !== 0 || x.r1 !== 0);
      if (!items.length) throw new Error("No rows carried volume or revenue.");
      const base = items.reduce((a, x) => a + x.r0, 0), curr = items.reduce((a, x) => a + x.r1, 0);
      if (base === 0) throw new Error("Base revenue is zero; a bridge needs a base period to bridge from.");
      const cont = items.filter((x) => x.q0 > 0 && x.q1 > 0);
      const newSkus = items.filter((x) => x.q0 <= 0 && x.q1 > 0), disc = items.filter((x) => x.q0 > 0 && x.q1 <= 0);
      const newRev = newSkus.reduce((a, x) => a + x.r1, 0), discRev = disc.reduce((a, x) => a + x.r0, 0);
      const baseVolC = cont.reduce((a, x) => a + x.q0, 0), baseRevC = cont.reduce((a, x) => a + x.r0, 0);
      const pbar0 = baseVolC > 0 ? baseRevC / baseVolC : 0;
      const three = str(i, "method").startsWith("Price at current");
      const detail = cont.map((x) => {
        const p0 = x.r0 / x.q0, p1 = x.r1 / x.q1, dq = x.q1 - x.q0, dp = p1 - p0;
        const price = three ? dp * x.q1 : dp * x.q0;
        const cross = three ? 0 : dp * dq;
        const volume = dq * pbar0, mix = dq * (p0 - pbar0);
        return { sku: x.sku, q0: x.q0, q1: x.q1, p0, p1, price, volume, mix, cross, total: x.r1 - x.r0 };
      });
      const sum = (f: (d: typeof detail[number]) => number) => detail.reduce((a, d) => a + f(d), 0);
      const price = sum((d) => d.price), volume = sum((d) => d.volume), mix = sum((d) => d.mix), cross = sum((d) => d.cross);
      const change = curr - base;
      const residual = change - (price + volume + mix + cross + newRev - discRev);
      const steps: { label: string; value: number; total?: boolean }[] = [
        { label: `Base revenue`, value: base, total: true },
        { label: three ? "Price (at current volume)" : "Price (at base volume)", value: price },
        { label: "Volume", value: volume },
        { label: "Mix", value: mix },
      ];
      if (!three) steps.push({ label: "Price × volume", value: cross });
      steps.push({ label: "New SKUs", value: newRev }, { label: "Discontinued SKUs", value: -discRev }, { label: "Current revenue", value: curr, total: true });
      const ranked = [...detail].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
      const largest = [{ label: "Price", value: price }, { label: "Volume", value: volume }, { label: "Mix", value: mix }, { label: "Cross", value: cross }, { label: "New", value: newRev }, { label: "Discontinued", value: -discRev }]
        .reduce((a, b) => (Math.abs(b.value) > Math.abs(a.value) ? b : a));
      return {
        title: `Price-volume-mix bridge, ${str(i, "periods", "base to current")}`,
        summary: `Revenue moved ${fmt.moneyRaw(change, 0)} (${fmt.pct(change / base, 1)}) from ${fmt.moneyRaw(base, 0)} to ${fmt.moneyRaw(curr, 0)}. Price contributed ${fmt.moneyRaw(price, 0)}, volume ${fmt.moneyRaw(volume, 0)} and mix ${fmt.moneyRaw(mix, 0)}${three ? "" : `, with a ${fmt.moneyRaw(cross, 0)} price-volume cross term`}; new SKUs added ${fmt.moneyRaw(newRev, 0)} and discontinued SKUs removed ${fmt.moneyRaw(discRev, 0)}. The largest single effect is ${largest.label.toLowerCase()} at ${fmt.moneyRaw(largest.value, 0)}, and the effects tie to the reported change with a residual of ${fmt.moneyRaw(residual, 0)}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Base revenue", value: fmt.moneyRaw(base, 0) }, { label: "Current revenue", value: fmt.moneyRaw(curr, 0) },
            { label: "Change", value: fmt.moneyRaw(change, 0), delta: fmt.pct(change / base, 1), tone: change >= 0 ? "pos" : "neg" },
            { label: "Price", value: fmt.moneyRaw(price, 0), tone: price >= 0 ? "pos" : "neg" },
            { label: "Volume", value: fmt.moneyRaw(volume, 0), tone: volume >= 0 ? "pos" : "neg" },
            { label: "Mix", value: fmt.moneyRaw(mix, 0), tone: mix >= 0 ? "pos" : "neg" },
            { label: "New less discontinued", value: fmt.moneyRaw(newRev - discRev, 0) },
            { label: "Residual", value: fmt.moneyRaw(residual, 0), tone: Math.abs(residual) < 1 ? "pos" : "warn", hint: "Must be zero: the decomposition is an identity" },
          ] },
          { type: "waterfall", title: "Revenue bridge", format: "money", steps },
          { type: "table", title: "Effects by SKU", columns: ["SKU", "Base volume", "Base price", "Current volume", "Current price", "Price", "Volume", "Mix", ...(three ? [] : ["Cross"]), "Total", "% of change"],
            rows: ranked.map((d) => [d.sku, fmt.int(d.q0), fmt.moneyRaw(d.p0, 2), fmt.int(d.q1), fmt.moneyRaw(d.p1, 2), fmt.moneyRaw(d.price, 0), fmt.moneyRaw(d.volume, 0), fmt.moneyRaw(d.mix, 0), ...(three ? [] : [fmt.moneyRaw(d.cross, 0)]), fmt.moneyRaw(d.total, 0), fmt.pct(change !== 0 ? d.total / change : 0, 0)]),
            totals: ["Continuing SKUs", fmt.int(baseVolC), "", fmt.int(cont.reduce((a, x) => a + x.q1, 0)), "", fmt.moneyRaw(price, 0), fmt.moneyRaw(volume, 0), fmt.moneyRaw(mix, 0), ...(three ? [] : [fmt.moneyRaw(cross, 0)]), fmt.moneyRaw(price + volume + mix + cross, 0), ""],
            note: `Base average price across continuing SKUs is ${fmt.moneyRaw(pbar0, 2)}; the mix effect measures volume shifting toward SKUs priced away from that average.` },
          { type: "bar", title: "Decomposition", format: "money", data: [
            { label: three ? "Price (current vol)" : "Price (base vol)", value: price, emphasis: largest.label === "Price" },
            { label: "Volume", value: volume, emphasis: largest.label === "Volume" },
            { label: "Mix", value: mix, emphasis: largest.label === "Mix" },
            ...(three ? [] : [{ label: "Cross", value: cross, emphasis: largest.label === "Cross" }]),
            { label: "New", value: newRev, emphasis: largest.label === "New" },
            { label: "Discontinued", value: -discRev, emphasis: largest.label === "Discontinued" },
          ] },
          { type: "table", title: "Population", columns: ["Group", "SKUs", "Base revenue", "Current revenue"], rows: [
            ["Continuing (volume in both periods)", String(cont.length), fmt.moneyRaw(baseRevC, 0), fmt.moneyRaw(cont.reduce((a, x) => a + x.r1, 0), 0)],
            ["New (current period only)", String(newSkus.length), fmt.moneyRaw(0, 0), fmt.moneyRaw(newRev, 0)],
            ["Discontinued (base period only)", String(disc.length), fmt.moneyRaw(discRev, 0), fmt.moneyRaw(0, 0)],
          ], totals: ["Total", String(items.length), fmt.moneyRaw(base, 0), fmt.moneyRaw(curr, 0)] },
        ],
        caveats: [
          three
            ? "Price is measured at current volume, so the price-volume interaction sits inside the price bar; the three effects still sum exactly to the change."
            : "Price is measured at base volume with the interaction isolated in a cross term, following the FTI convention; the four effects sum exactly to the change.",
          "Volume is valued at the base average price across continuing SKUs and mix captures the deviation of each SKU's base price from that average; changing that base changes the split between volume and mix but not their sum.",
          "Prices are derived as revenue divided by volume, so any revenue net of discounts, rebates or freight produces a pocket-price bridge and any gross revenue produces a list-price bridge. Keep units consistent across SKUs.",
          "New and discontinued SKUs are separated rather than blended into price, which is what keeps price and mix interpretable.",
        ],
        nextSteps: ["Run the same decomposition at SKU x customer level to see how much of the price bar is really mix", "Apply the durability test to the price bar: contractual, recurring, and what happened to volume", "Repeat on gross profit to separate price from cost inflation"],
      };
    },
  },
  {
    kind: "calc", id: "fdd-nwc-peg", title: "NWC peg: TTM average & seasonality", tagline: "Monthly working capital, four candidate pegs, the seasonal index and the price impact.",
    description: "Builds net working capital month by month from pasted balance sheets, computes the trailing twelve-month average peg alongside the three-month, seasonally matched and latest-month alternatives, and quantifies the seasonal swing that decides which one a seller will argue for. Adjusts the peg for aged receivables, obsolete inventory and payables stretching, and prices the difference at completion.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Financial due diligence (TAS)", "Commercial due diligence", "Restructuring / turnaround"],
    category: "Diligence", icon: "ArrowLeftRight", savesMinutes: 120, tags: ["NWC", "peg", "seasonality", "SPA"],
    fields: [
      { key: "monthly", label: "Monthly balance sheet", type: "csv", required: true, columns: "month, accounts_receivable, inventory, prepaid_expenses, accounts_payable, accrued_expenses, revenue", placeholder: "month,accounts_receivable,inventory,prepaid_expenses,accounts_payable,accrued_expenses,revenue" },
      { key: "closeMonth", label: "Expected closing month", type: "select", options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], default: "March" },
      { key: "agedAr", label: "Receivables over 90 days to exclude", type: "number", unit: "$000s", default: 0 },
      { key: "obsolete", label: "Obsolete / slow-moving inventory", type: "number", unit: "$000s", default: 0 },
      { key: "apStretch", label: "Payables stretch to normalize", type: "number", unit: "$000s", default: 0, help: "Payables above the sustainable level; normalizing raises NWC and so raises the peg" },
    ],
    example: {
      monthly: "month,accounts_receivable,inventory,prepaid_expenses,accounts_payable,accrued_expenses,revenue\n2024-01,25100,20700,1590,16000,5010,14300\n2024-02,26300,21400,1550,16500,5140,15000\n2024-03,28900,23000,1480,17900,5380,16800\n2024-04,30300,23700,1440,18600,5550,17600\n2024-05,31000,24200,1410,19000,5660,18100\n2024-06,31800,24500,1370,19700,5830,18600\n2024-07,28400,21600,1450,17800,5200,16200\n2024-08,29100,22400,1420,18300,5350,16800\n2024-09,30600,23100,1390,18900,5480,17400\n2024-10,29800,22800,1360,18400,5310,16900\n2024-11,27300,21900,1410,17600,5120,15400\n2024-12,24900,20400,1500,16900,6100,14100\n2025-01,25600,21100,1620,16200,5050,14600\n2025-02,26800,21800,1580,16700,5180,15300\n2025-03,29400,23400,1510,18100,5420,17100\n2025-04,30900,24100,1470,18800,5600,17900\n2025-05,31600,24600,1440,19200,5710,18400\n2025-06,32400,24900,1400,19900,5880,18900\n2025-07,31100,24200,1460,21400,5640,18100\n2025-08,31800,24800,1430,22100,5780,18600\n2025-09,33200,25600,1400,23200,5940,19300\n2025-10,32100,25100,1380,22600,5760,18700\n2025-11,29400,24000,1420,21800,5480,17000\n2025-12,26800,22300,1520,20900,6400,15600",
      closeMonth: "March", agedAr: 1850, obsolete: 2400, apStretch: 1600,
    },
    compute: (i: Inputs): WorkflowOutput => {
      const { header, rows } = parseCsv(str(i, "monthly"));
      if (rows.length < 3) throw new Error("Paste at least three months of balance sheet data; 24-36 months is the diligence standard.");
      const cM = findCol(header, "month", "period", "date");
      const cAr = findCol(header, "accounts_receivable", "trade_receivables", "receivables", "ar");
      const cInv = findCol(header, "inventory", "inventories", "stock");
      const cPre = findCol(header, "prepaid_expenses", "prepaid", "prepayments");
      const cAp = findCol(header, "accounts_payable", "trade_payables", "payables", "ap");
      const cAcc = findCol(header, "accrued_expenses", "accruals", "accrued");
      const cRev = findCol(header, "revenue", "sales", "net_revenue");
      if (cAr < 0 || cAp < 0) throw new Error(`Could not find receivables and payables columns; found: ${header.join(", ")}`);
      const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
      const series = rows.map((r, k) => {
        const label = cellStr(r, cM, `M${k + 1}`);
        const m = /(\d{4})[-/](\d{1,2})/.exec(label);
        const mi = m ? Math.min(11, Math.max(0, Number(m[2]) - 1)) : MONTHS.findIndex((x) => norm(label).includes(norm(x).slice(0, 3)));
        const ar = cellNum(r, cAr), inv = cellNum(r, cInv), pre = cellNum(r, cPre), ap = cellNum(r, cAp), acc = cellNum(r, cAcc), rev = cellNum(r, cRev);
        return { label, monthIndex: mi, ar, inv, pre, ap, acc, rev, nwc: ar + inv + pre - ap - acc };
      });
      const n = series.length;
      const nwcs = series.map((s) => s.nwc);
      const ttm = mean(nwcs.slice(Math.max(0, n - 12)));
      const avg3 = mean(nwcs.slice(Math.max(0, n - 3)));
      const full = mean(nwcs);
      const latest = nwcs[n - 1];
      const closeIdx = MONTHS.indexOf(str(i, "closeMonth", "March"));
      const closeMonths = series.filter((s) => s.monthIndex === closeIdx);
      const seasonal = closeMonths.length ? mean(closeMonths.map((s) => s.nwc)) : ttm;
      const overall = mean(nwcs);
      const index = MONTHS.map((label, k) => { const v = series.filter((s) => s.monthIndex === k).map((s) => s.nwc); return { label: label.slice(0, 3), value: v.length && overall !== 0 ? mean(v) / overall : null }; }).filter((x) => x.value !== null);
      const peak = series.reduce((a, b) => (b.nwc > a.nwc ? b : a)), trough = series.reduce((a, b) => (b.nwc < a.nwc ? b : a));
      const swing = peak.nwc - trough.nwc;
      const agedAr = num(i, "agedAr"), obsolete = num(i, "obsolete"), stretch = num(i, "apStretch");
      const recommended = ttm - agedAr - obsolete + stretch;
      const ttmRev = series.slice(Math.max(0, n - 12)).reduce((a, s) => a + s.rev, 0);
      const pctRev = ttmRev > 0 ? recommended / ttmRev : NaN;
      const dsoLatest = series[n - 1].rev > 0 ? (series[n - 1].ar / series[n - 1].rev) * 30.4 : NaN;
      const dpoFirstHalf = mean(series.slice(0, Math.floor(n / 2)).map((s) => (s.rev > 0 ? (s.ap / s.rev) * 30.4 : NaN)).filter(Number.isFinite));
      const dpoRecent = mean(series.slice(Math.max(0, n - 6)).map((s) => (s.rev > 0 ? (s.ap / s.rev) * 30.4 : NaN)).filter(Number.isFinite));
      const priceImpact = seasonal - recommended;
      const rolling = series.map((s, k) => ({ x: s.label, y: mean(nwcs.slice(Math.max(0, k - 11), k + 1)) }));
      return {
        title: "Net working capital peg",
        summary: `On ${n} months of data the trailing twelve-month average NWC is ${fmt.moneyRaw(ttm, 0)}k, against ${fmt.moneyRaw(avg3, 0)}k on a three-month average and ${fmt.moneyRaw(latest, 0)}k at the latest month end. Working capital swings ${fmt.moneyRaw(swing, 0)}k peak to trough (${fmt.pct(overall !== 0 ? swing / overall : 0, 0)} of the average), peaking in ${peak.label} and troughing in ${trough.label}, so the choice of method is worth more than most earnings adjustments. After excluding ${fmt.moneyRaw(agedAr, 0)}k of aged receivables and ${fmt.moneyRaw(obsolete, 0)}k of obsolete inventory and normalizing ${fmt.moneyRaw(stretch, 0)}k of payables stretch, the recommended peg is ${fmt.moneyRaw(recommended, 0)}k; a ${str(i, "closeMonth", "March")} close would deliver ${fmt.moneyRaw(seasonal, 0)}k, a ${fmt.moneyRaw(Math.abs(priceImpact), 0)}k price ${priceImpact >= 0 ? "benefit to the seller" : "benefit to the buyer"}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "TTM average peg", value: `${fmt.moneyRaw(ttm, 0)}k` },
            { label: "3-month average", value: `${fmt.moneyRaw(avg3, 0)}k`, delta: `${fmt.moneyRaw(avg3 - ttm, 0)}k vs TTM` },
            { label: `Seasonal (${str(i, "closeMonth", "March")})`, value: `${fmt.moneyRaw(seasonal, 0)}k`, delta: `${fmt.moneyRaw(seasonal - ttm, 0)}k vs TTM` },
            { label: "Latest month", value: `${fmt.moneyRaw(latest, 0)}k` },
            { label: "Peak to trough", value: `${fmt.moneyRaw(swing, 0)}k`, tone: "warn", hint: `${peak.label} high, ${trough.label} low` },
            { label: "Recommended peg", value: `${fmt.moneyRaw(recommended, 0)}k` },
            { label: "% of TTM revenue", value: fmt.pct(pctRev, 1) },
            { label: "Price impact at close", value: `${fmt.moneyRaw(priceImpact, 0)}k`, tone: priceImpact >= 0 ? "neg" : "pos", hint: "Closing NWC at the seasonal level less the recommended peg" },
          ] },
          { type: "line", title: "Monthly NWC and the trailing twelve-month average ($000s)", format: "money", series: [
            { name: "Month-end NWC", points: series.map((s) => ({ x: s.label, y: s.nwc })) },
            { name: "Trailing 12-month average", points: rolling },
          ] },
          { type: "waterfall", title: "TTM average to recommended peg ($000s)", format: "money", steps: [
            { label: "TTM average", value: ttm, total: true },
            { label: "Less receivables over 90 days", value: -agedAr },
            { label: "Less obsolete inventory", value: -obsolete },
            { label: "Add back payables stretch", value: stretch },
            { label: "Recommended peg", value: recommended, total: true },
          ] },
          { type: "table", title: "Peg alternatives", columns: ["Method", "Value ($000s)", "vs TTM average", "Argument"], rows: [
            ["Trailing twelve-month average", fmt.moneyRaw(ttm, 0), fmt.moneyRaw(0, 0), "Market standard; smooths seasonality across a full cycle"],
            ["Latest three months", fmt.moneyRaw(avg3, 0), fmt.moneyRaw(avg3 - ttm, 0), avg3 < ttm ? "Favours the seller here; only defensible if the business has structurally changed" : "Favours the buyer here; only defensible if the business has structurally changed"],
            [`Seasonally matched (${str(i, "closeMonth", "March")})`, fmt.moneyRaw(seasonal, 0), fmt.moneyRaw(seasonal - ttm, 0), "Best when the closing month is known and seasonality is material"],
            ["Latest month end", fmt.moneyRaw(latest, 0), fmt.moneyRaw(latest - ttm, 0), "Weakest: a single point on a seasonal curve"],
            [`Full-series average (${n} months)`, fmt.moneyRaw(full, 0), fmt.moneyRaw(full - ttm, 0), "Cross-check only; stale if the business grew through the series"],
            ["Recommended", fmt.moneyRaw(recommended, 0), fmt.moneyRaw(recommended - ttm, 0), "TTM average adjusted for quality of receivables, inventory and payables"],
          ], emphasisRow: 5 },
          { type: "bar", title: "Month-of-year seasonality index (1.0 = average)", format: "num", reference: { value: 1, label: "Average" }, data: index.map((x) => ({ label: x.label, value: x.value })) },
          { type: "table", title: "Monthly detail ($000s)", columns: ["Month", "AR", "Inventory", "Prepaid", "AP", "Accrued", "NWC", "Revenue", "NWC % of revenue", "DSO (days)"],
            rows: series.map((s) => [s.label, fmt.num(s.ar, 0), fmt.num(s.inv, 0), fmt.num(s.pre, 0), fmt.num(s.ap, 0), fmt.num(s.acc, 0), fmt.num(s.nwc, 0), fmt.num(s.rev, 0), s.rev > 0 ? fmt.pct(s.nwc / (s.rev * 12), 1) : "n/a", s.rev > 0 ? fmt.num((s.ar / s.rev) * 30.4, 0) : "n/a"]),
            note: `Latest DSO ${Number.isFinite(dsoLatest) ? fmt.num(dsoLatest, 0) : "n/a"} days. DPO averaged ${Number.isFinite(dpoFirstHalf) ? fmt.num(dpoFirstHalf, 0) : "n/a"} days in the first half of the series against ${Number.isFinite(dpoRecent) ? fmt.num(dpoRecent, 0) : "n/a"} days in the last six months${Number.isFinite(dpoRecent) && Number.isFinite(dpoFirstHalf) && dpoRecent - dpoFirstHalf > 5 ? " - a trend break consistent with payables stretching before a sale." : "."}` },
          { type: "callout", tone: Number.isFinite(dpoRecent) && Number.isFinite(dpoFirstHalf) && dpoRecent - dpoFirstHalf > 5 ? "warn" : "info", title: "SPA drafting points",
            text: `Define NWC as trade receivables plus inventory plus prepaid expenses less trade payables and accrued expenses, excluding cash, debt and debt-like items, income taxes and all deal-related balances, and attach this schedule as the illustrative calculation. Fix the accounting policies clause, a true-up window of 60-90 days after closing and the dispute mechanism.${Number.isFinite(dpoRecent) && Number.isFinite(dpoFirstHalf) && dpoRecent - dpoFirstHalf > 5 ? ` DPO has extended by roughly ${fmt.num(dpoRecent - dpoFirstHalf, 0)} days in the last six months, so negotiate the payables normalization explicitly rather than leaving it to the true-up.` : ""}`,
          },
        ],
        caveats: [
          "Deferred revenue is excluded from this NWC definition; where it represents undelivered service it is usually treated as a debt-like item in the equity bridge, which is a negotiated point.",
          "DSO and DPO here use the single month's revenue annualized at 30.4 days, so they are directional; compute them on cost of revenue and on a rolling basis for the report.",
          `Seasonal matching uses the ${closeMonths.length} observation(s) of ${str(i, "closeMonth", "March")} in the data; with fewer than two years of history it is not a seasonal average.`,
          "The price impact assumes closing NWC equals the seasonally matched level; the actual completion accounts will differ and the true-up settles the balance.",
        ],
        nextSteps: ["Request the AR and inventory agings to support the quality adjustments", "Test whether any accounting policy changed mid-series", "Agree the definition and the illustrative calculation in the SPA before the peg is negotiated"],
      };
    },
  },
  {
    kind: "calc", id: "turn-13-week-cash", title: "13-week cash flow", tagline: "Weekly receipts, disbursements, revolver draws and headroom against a minimum-cash policy.",
    description: "Builds the turnaround standard: thirteen weeks of receipts driven off the opening receivables and new billings at a collection lag, disbursements calendared by category, revolver draws sized to the minimum-cash policy, and weekly headroom. Runs a collections stress case alongside the base and reports the trough week, the first breach and the funding gap.",
    roles: ["consultant", "corpfin"], specialties: ["Restructuring / turnaround", "Operations & performance", "Financial due diligence (TAS)"],
    category: "Credit & restructuring", icon: "Hourglass", savesMinutes: 150, tags: ["13WCF", "liquidity", "cash", "DIP"],
    fields: [
      { key: "openingCash", label: "Opening cash", type: "number", unit: "$000s", required: true, default: 8400 },
      { key: "openingAr", label: "Opening receivables (collectible)", type: "number", unit: "$000s", default: 27000 },
      { key: "arWeeks", label: "Weeks to collect opening receivables", type: "number", unit: "weeks", default: 6, min: 1, max: 13 },
      { key: "billings", label: "Weekly billings", type: "number", unit: "$000s", default: 6200 },
      { key: "lag", label: "Collection lag on new billings", type: "number", unit: "weeks", default: 5, min: 0, max: 12 },
      { key: "payroll", label: "Payroll per fortnight (incl. taxes)", type: "number", unit: "$000s", default: 3720 },
      { key: "ap", label: "Trade payables run rate, weekly", type: "number", unit: "$000s", default: 2600 },
      { key: "critical", label: "Critical vendor payments, weekly", type: "number", unit: "$000s", default: 1100 },
      { key: "rent", label: "Rent, every four weeks", type: "number", unit: "$000s", default: 880 },
      { key: "debt", label: "Debt service, monthly", type: "number", unit: "$000s", default: 1100 },
      { key: "fees", label: "Professional fees, weekly", type: "number", unit: "$000s", default: 450 },
      { key: "capex", label: "Capex, weekly", type: "number", unit: "$000s", default: 180 },
      { key: "tax", label: "Tax payment", type: "number", unit: "$000s", default: 1400 },
      { key: "taxWeek", label: "Tax payment week", type: "number", default: 3, min: 1, max: 13 },
      { key: "minCash", label: "Minimum cash policy", type: "number", unit: "$000s", default: 5000 },
      { key: "revolver", label: "Revolver availability", type: "number", unit: "$000s", default: 12000 },
      { key: "stress", label: "Stress case: collections shortfall", type: "number", unit: "%", default: 15 },
    ],
    example: { openingCash: 9600, openingAr: 27000, arWeeks: 6, billings: 6200, lag: 4, payroll: 3720, ap: 2300, critical: 1100, rent: 880, debt: 1100, fees: 450, capex: 180, tax: 1400, taxWeek: 3, minCash: 5000, revolver: 6000, stress: 15 },
    compute: (i: Inputs): WorkflowOutput => {
      const open = num(i, "openingCash"), ar = num(i, "openingAr"), arWeeks = Math.max(1, Math.round(num(i, "arWeeks", 6)));
      const bill = num(i, "billings"), lag = Math.max(0, Math.round(num(i, "lag", 5)));
      const payroll = num(i, "payroll"), ap = num(i, "ap"), crit = num(i, "critical"), rent = num(i, "rent");
      const debt = num(i, "debt"), fees = num(i, "fees"), capex = num(i, "capex");
      const tax = num(i, "tax"), taxWeek = Math.min(13, Math.max(1, Math.round(num(i, "taxWeek", 3))));
      const minCash = num(i, "minCash"), capacity = num(i, "revolver"), stress = num(i, "stress") / 100;
      if (open <= 0) throw new Error("Opening cash must be positive; verify the cash truth across every account before forecasting.");
      if (minCash < 0 || capacity < 0) throw new Error("Minimum cash and revolver availability cannot be negative.");
      type Wk = { w: number; receipts: number; payroll: number; ap: number; critical: number; rent: number; debt: number; fees: number; capex: number; tax: number; disb: number; net: number; draw: number; end: number; headroom: number; avail: number; short: number };
      const run = (factor: number): Wk[] => {
        const out: Wk[] = [];
        let cash = open, drawn = 0;
        for (let w = 1; w <= 13; w++) {
          const receipts = ((w <= arWeeks ? ar / arWeeks : 0) + (w > lag ? bill : 0)) * factor;
          const wPayroll = w % 2 === 0 ? payroll : 0;
          const wRent = w % 4 === 1 ? rent : 0;
          const wDebt = w % 4 === 0 ? debt : 0;
          const wTax = w === taxWeek ? tax : 0;
          const disb = wPayroll + ap + crit + wRent + wDebt + fees + capex + wTax;
          const net = receipts - disb;
          const before = cash + net;
          let draw = 0, short = 0;
          if (before < minCash) {
            const need = minCash - before, room = Math.max(0, capacity - drawn);
            draw = Math.min(need, room); short = Math.max(0, need - room);
          } else if (drawn > 0) {
            draw = -Math.min(before - minCash, drawn);
          }
          drawn += draw;
          cash = before + draw;
          out.push({ w, receipts, payroll: wPayroll, ap, critical: crit, rent: wRent, debt: wDebt, fees, capex, tax: wTax, disb, net, draw, end: cash, headroom: cash - minCash, avail: Math.max(0, capacity - drawn), short });
        }
        return out;
      };
      const base = run(1), stressed = run(1 - stress);
      const sum = (rows: Wk[], f: (r: Wk) => number) => rows.reduce((a, r) => a + f(r), 0);
      const trough = base.reduce((a, b) => (b.end < a.end ? b : a));
      const stressTrough = stressed.reduce((a, b) => (b.end < a.end ? b : a));
      const peakDraw = Math.max(0, ...base.map((r) => capacity - r.avail));
      const gap = Math.max(0, ...stressed.map((r) => r.short));
      const breach = stressed.find((r) => r.short > 0);
      const totalRec = sum(base, (r) => r.receipts), totalDisb = sum(base, (r) => r.disb);
      return {
        title: "13-week cash flow",
        summary: `Base case: ${fmt.moneyRaw(totalRec, 0)}k of receipts against ${fmt.moneyRaw(totalDisb, 0)}k of disbursements takes cash from ${fmt.moneyRaw(open, 0)}k to ${fmt.moneyRaw(base[12].end, 0)}k, with the trough in week ${trough.w} at ${fmt.moneyRaw(trough.end, 0)}k and minimum headroom of ${fmt.moneyRaw(trough.headroom, 0)}k over the ${fmt.moneyRaw(minCash, 0)}k policy. Peak revolver usage is ${fmt.moneyRaw(peakDraw, 0)}k of the ${fmt.moneyRaw(capacity, 0)}k available. At a ${fmt.pct(stress, 0)} collections shortfall the trough falls to ${fmt.moneyRaw(stressTrough.end, 0)}k in week ${stressTrough.w}${gap > 0 ? ` and the facility is exhausted in week ${breach ? breach.w : "n/a"}, leaving a funding gap of ${fmt.moneyRaw(gap, 0)}k` : " and the facility still covers the policy"}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Opening cash", value: `${fmt.moneyRaw(open, 0)}k` },
            { label: "Week 13 cash", value: `${fmt.moneyRaw(base[12].end, 0)}k`, tone: base[12].end >= minCash ? "pos" : "neg" },
            { label: "Trough", value: `${fmt.moneyRaw(trough.end, 0)}k`, hint: `Week ${trough.w}` },
            { label: "Minimum headroom", value: `${fmt.moneyRaw(trough.headroom, 0)}k`, tone: trough.headroom > 0 ? "pos" : "neg" },
            { label: "Total receipts", value: `${fmt.moneyRaw(totalRec, 0)}k` },
            { label: "Total disbursements", value: `${fmt.moneyRaw(totalDisb, 0)}k` },
            { label: "Peak revolver draw", value: `${fmt.moneyRaw(peakDraw, 0)}k`, tone: peakDraw >= capacity ? "neg" : peakDraw > capacity * 0.6 ? "warn" : "neutral" },
            { label: `Funding gap at ${fmt.pct(stress, 0)} stress`, value: `${fmt.moneyRaw(gap, 0)}k`, tone: gap > 0 ? "neg" : "pos" },
          ] },
          { type: "line", title: "Ending cash against the minimum-cash policy ($000s)", format: "money", series: [
            { name: "Base case", points: base.map((r) => ({ x: `W${r.w}`, y: r.end })) },
            { name: `Stress (-${fmt.pct(stress, 0)} collections)`, points: stressed.map((r) => ({ x: `W${r.w}`, y: r.end })) },
            { name: "Minimum cash policy", points: base.map((r) => ({ x: `W${r.w}`, y: minCash })) },
          ] },
          { type: "table", title: "Base case ($000s)", columns: ["Week", "Receipts", "Payroll", "Trade AP", "Critical vendors", "Rent", "Debt service", "Taxes", "Prof. fees", "Capex", "Total disb.", "Net", "Draw / (repay)", "Ending cash", "Headroom", "Availability"],
            rows: base.map((r) => [`W${r.w}`, fmt.num(r.receipts, 0), fmt.num(r.payroll, 0), fmt.num(r.ap, 0), fmt.num(r.critical, 0), fmt.num(r.rent, 0), fmt.num(r.debt, 0), fmt.num(r.tax, 0), fmt.num(r.fees, 0), fmt.num(r.capex, 0), fmt.num(r.disb, 0), fmt.num(r.net, 0), fmt.num(r.draw, 0), fmt.num(r.end, 0), fmt.num(r.headroom, 0), fmt.num(r.avail, 0)]),
            totals: ["Total", fmt.num(totalRec, 0), fmt.num(sum(base, (r) => r.payroll), 0), fmt.num(sum(base, (r) => r.ap), 0), fmt.num(sum(base, (r) => r.critical), 0), fmt.num(sum(base, (r) => r.rent), 0), fmt.num(sum(base, (r) => r.debt), 0), fmt.num(sum(base, (r) => r.tax), 0), fmt.num(sum(base, (r) => r.fees), 0), fmt.num(sum(base, (r) => r.capex), 0), fmt.num(totalDisb, 0), fmt.num(totalRec - totalDisb, 0), fmt.num(sum(base, (r) => r.draw), 0), fmt.num(base[12].end, 0), "", ""],
            emphasisRow: trough.w - 1 },
          { type: "bar", title: "Weekly headroom over the minimum-cash policy ($000s)", format: "money", reference: { value: 0, label: "Policy" },
            data: base.map((r) => ({ label: `W${r.w}`, value: r.headroom, emphasis: r.w === trough.w })) },
          { type: "waterfall", title: "Thirteen-week cash bridge ($000s)", format: "money", steps: [
            { label: "Opening cash", value: open, total: true },
            { label: "Receipts", value: totalRec },
            { label: "Payroll and taxes", value: -(sum(base, (r) => r.payroll) + sum(base, (r) => r.tax)) },
            { label: "Trade and critical vendors", value: -(sum(base, (r) => r.ap) + sum(base, (r) => r.critical)) },
            { label: "Rent, debt service, fees, capex", value: -(sum(base, (r) => r.rent) + sum(base, (r) => r.debt) + sum(base, (r) => r.fees) + sum(base, (r) => r.capex)) },
            { label: "Net revolver", value: sum(base, (r) => r.draw) },
            { label: "Week 13 cash", value: base[12].end, total: true },
          ] },
          { type: "checklist", title: "Weekly cash meeting", items: [
            { text: "Review last week's actuals against forecast and tag the top five variances Timing or Permanent", owner: "Finance lead" },
            { text: "Approve disbursements above the threshold; payroll and taxes are never the balancing item", owner: "CRO / CFO" },
            { text: "Collections by owner on the named top accounts, with a committed date per invoice", owner: "Credit manager" },
            { text: "Two-week liquidity view and the revolver availability certificate", owner: "Treasury" },
            { text: "Actions log with owners, and the decisions needed this week", owner: "PMO" },
          ] },
        ],
        caveats: [
          `Receipts assume the opening receivables collect evenly over ${arWeeks} weeks and new billings collect after a ${lag}-week lag; replace both with the actual aging and collection curve as soon as the ledger is available.`,
          "Payroll is modelled in even weeks, rent every fourth week from week 1, debt service every fourth week from week 4, so align the pattern with the real calendar before this goes to a lender.",
          "Revolver draws are sized only to restore the minimum-cash policy and excess cash repays the facility; borrowing-base availability, not the commitment, is the real constraint.",
          "Without a weekly meeting with approvals, variances and owners, the forecast will not change outcomes.",
        ],
        nextSteps: ["Replace the collection pattern with the AR aging and the last 13 weeks of actual receipts", "Add the borrowing-base calculation and any covenant test to the summary block", "Build the no-revolver scenario for the lender pack"],
      };
    },
  },
];

const CALCULATORS_B: ToolDef[] = [
  {
    kind: "calc", id: "ops-zbb-savings", title: "Zero-based budgeting savings scenario", tagline: "Category gaps to a peer benchmark, a capture rate, the ramp, and the year-one landing.",
    description: "Sizes a zero-based cost programme from a category baseline and the peer benchmark spend for each category: the gap, the share of the gap committed, the run-rate saving, the one-time cost to achieve and the payback. Ramps the saving over the implementation window to give the year-one P&L effect rather than the run rate, and flags totals outside the 10-25% of SG&A that zero-based programmes actually deliver.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Strategy", "Restructuring / turnaround", "Technology & digital"],
    category: "Planning & forecasting", icon: "Wallet", savesMinutes: 120, tags: ["ZBB", "cost", "savings", "benchmark"],
    fields: [
      { key: "costs", label: "Cost categories", type: "csv", required: true, columns: "category, baseline_spend, benchmark_spend, capture_pct, one_time_cost, owner", placeholder: "category,baseline_spend,benchmark_spend,capture_pct,one_time_cost,owner" },
      { key: "ramp", label: "Ramp to full run rate", type: "number", unit: "months", default: 6, min: 1, max: 24 },
      { key: "sgaBase", label: "Total SG&A for the credibility check", type: "number", unit: "$mm", default: 0, help: "Leave at zero to use the sum of the baseline" },
    ],
    example: {
      costs: "category,baseline_spend,benchmark_spend,capture_pct,one_time_cost,owner\nPeople - G&A,61.4,48.0,70,4.2,CFO\nThird party and professional services,55.4,38.0,60,1.1,CFO\nMarketing programs and events,146.5,118.0,50,2.4,CMO\nTechnology and licences,111.0,92.0,55,3.6,CIO\nFacilities,50.8,41.0,45,6.8,COO\nTravel and entertainment,42.0,29.0,75,0.3,CRO\nRecruiting and training,19.8,15.0,60,0.2,CHRO",
      ramp: 6, sgaBase: 0,
    },
    compute: (i: Inputs): WorkflowOutput => {
      const { header, rows } = parseCsv(str(i, "costs"));
      if (!rows.length) throw new Error("Paste cost categories with columns category, baseline_spend, benchmark_spend, capture_pct, one_time_cost, owner.");
      const cCat = findCol(header, "category", "cost_category", "line", "lever");
      const cBase = findCol(header, "baseline_spend", "baseline", "spend", "current_spend");
      const cBench = findCol(header, "benchmark_spend", "benchmark", "target_spend", "peer_spend");
      const cCap = findCol(header, "capture_pct", "capture", "capture_rate", "target_pct");
      const cOne = findCol(header, "one_time_cost", "one_time", "cost_to_achieve", "onetime");
      const cOwn = findCol(header, "owner", "cost_owner", "accountable");
      if (cBase < 0) throw new Error(`Could not find a baseline_spend column; found: ${header.join(", ")}`);
      const ramp = Math.max(1, Math.round(num(i, "ramp", 6)));
      const items = rows.map((r, k) => {
        const category = cellStr(r, cCat, `Category ${k + 1}`);
        const baseline = cellNum(r, cBase), bench = cellNum(r, cBench), capture = cellNum(r, cCap, 100) / 100;
        const gap = bench > 0 ? Math.max(0, baseline - bench) : baseline;
        const savings = Math.min(baseline, Math.max(0, gap * capture));
        return { category, baseline, bench, capture, gap, savings, oneTime: cellNum(r, cOne), owner: cellStr(r, cOwn, "Unassigned") };
      }).filter((x) => x.baseline > 0);
      if (!items.length) throw new Error("No category carried a positive baseline spend.");
      const baseline = items.reduce((a, x) => a + x.baseline, 0);
      const gapTotal = items.reduce((a, x) => a + x.gap, 0);
      const runRate = items.reduce((a, x) => a + x.savings, 0);
      const oneTime = items.reduce((a, x) => a + x.oneTime, 0);
      const sgaBase = num(i, "sgaBase") > 0 ? num(i, "sgaBase") : baseline;
      const pctOfBase = baseline > 0 ? runRate / baseline : 0;
      const pctOfSga = sgaBase > 0 ? runRate / sgaBase : 0;
      const yr1Factor = ramp <= 12 ? 1 - ramp / 24 : Math.max(0, (12 - ramp / 2) / 12);
      const year1 = runRate * yr1Factor;
      const payback = year1 > 0 ? (oneTime / year1) * 12 : Infinity;
      const scen = [{ name: "Conservative", f: 0.6 }, { name: "Base", f: 1 }, { name: "Stretch", f: 1.3 }].map((s) => {
        const v = items.reduce((a, x) => a + Math.min(x.gap, x.savings * s.f), 0);
        return { ...s, runRate: v, year1: v * yr1Factor, pct: baseline > 0 ? v / baseline : 0 };
      });
      const mults = [0.6, 0.8, 1, 1.2, 1.4], ramps = [3, 6, 9, 12];
      const grid = mults.map((m) => ramps.map((rm) => items.reduce((a, x) => a + Math.min(x.gap, x.savings * m), 0) * (1 - rm / 24)));
      const ranked = [...items].sort((a, b) => b.savings - a.savings);
      const credible = pctOfSga >= 0.1 && pctOfSga <= 0.25;
      return {
        title: "Zero-based savings scenario",
        summary: `A ${fmt.money(baseline)} baseline sits ${fmt.money(gapTotal)} above the category benchmarks. At the entered capture rates the run-rate saving is ${fmt.money(runRate)}, ${fmt.pct(pctOfBase, 1)} of the baseline and ${fmt.pct(pctOfSga, 1)} of the SG&A base, which is ${credible ? "inside" : "outside"} the 10-25% band zero-based programmes typically deliver. Over a ${ramp}-month ramp the year-one P&L effect is ${fmt.money(year1)} against ${fmt.money(oneTime)} of one-time cost, a payback of ${Number.isFinite(payback) ? `${payback.toFixed(0)} months` : "n/a"}. The three largest levers are ${ranked.slice(0, 3).map((x) => x.category).join(", ")}.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Baseline", value: fmt.money(baseline) },
            { label: "Gap to benchmark", value: fmt.money(gapTotal) },
            { label: "Run-rate saving", value: fmt.money(runRate), tone: "pos" },
            { label: "% of baseline", value: fmt.pct(pctOfBase, 1) },
            { label: "% of SG&A base", value: fmt.pct(pctOfSga, 1), tone: credible ? "pos" : "warn", hint: "Zero-based programmes typically deliver 10-25%" },
            { label: "Year-1 P&L effect", value: fmt.money(year1), hint: `${ramp}-month ramp` },
            { label: "One-time cost", value: fmt.money(oneTime) },
            { label: "Payback", value: Number.isFinite(payback) ? `${payback.toFixed(0)} mo` : "n/a", tone: payback <= 12 ? "pos" : payback <= 24 ? "warn" : "neg" },
          ] },
          { type: "callout", tone: credible ? "info" : "warn", title: credible ? "Target is in the credible band" : "Target needs a structural reason",
            text: credible
              ? `At ${fmt.pct(pctOfSga, 1)} of the SG&A base the programme is consistent with what zero-based exercises deliver in about six months. Protect it with monthly owner reviews against the mapped baseline and a written rule for claiming a saving.`
              : `At ${fmt.pct(pctOfSga, 1)} of the SG&A base the target sits outside the 10-25% range observed in zero-based programmes. ${pctOfSga > 0.25 ? "A target this large needs a structural lever named explicitly - footprint exit, delayering, outsourcing or scope reduction - not a deeper percentage on the same activities." : "A target this small suggests the benchmark set is too close to the current cost base, or the capture rates are conservative; test the top-quartile benchmark instead of the median."}` },
          { type: "table", title: "Savings by category (USD mm)", columns: ["Category", "Baseline", "Benchmark", "Gap", "Capture", "Run-rate saving", "% of baseline", "One-time", "Owner"],
            rows: ranked.map((x) => [x.category, fmt.num(x.baseline, 1), x.bench > 0 ? fmt.num(x.bench, 1) : "no benchmark", fmt.num(x.gap, 1), fmt.pct(x.capture, 0), fmt.num(x.savings, 1), fmt.pct(x.baseline > 0 ? x.savings / x.baseline : 0, 1), fmt.num(x.oneTime, 1), x.owner]),
            totals: ["Total", fmt.num(baseline, 1), "", fmt.num(gapTotal, 1), "", fmt.num(runRate, 1), fmt.pct(pctOfBase, 1), fmt.num(oneTime, 1), ""] },
          { type: "waterfall", title: "Baseline to target cost base (USD mm)", format: "money", steps: [
            { label: "Baseline", value: baseline, total: true },
            ...ranked.slice(0, 5).map((x) => ({ label: x.category, value: -x.savings })),
            ...(ranked.length > 5 ? [{ label: "Other categories", value: -ranked.slice(5).reduce((a, x) => a + x.savings, 0) }] : []),
            { label: "Target cost base", value: baseline - runRate, total: true },
          ] },
          { type: "bar", title: "Run-rate saving by category (USD mm)", format: "money", data: ranked.map((x) => ({ label: x.category, value: x.savings, emphasis: x.category === ranked[0].category })) },
          { type: "table", title: "Scenarios", columns: ["Scenario", "Capture multiple", "Run-rate saving", "% of baseline", "Year-1 effect"],
            rows: scen.map((s) => [s.name, `${s.f.toFixed(1)}x`, fmt.num(s.runRate, 1), fmt.pct(s.pct, 1), fmt.num(s.year1, 1)]), emphasisRow: 1 },
          { type: "sensitivity", title: "Year-one savings ($mm): capture multiple × ramp", rowLabel: "Capture multiple", colLabel: "Ramp (months)", rows: mults.map((m) => `${m.toFixed(1)}x`), cols: ramps.map((r) => `${r}`), values: grid, format: "money", baseRow: 2, baseCol: 1 },
        ],
        caveats: [
          "Savings are capped at the gap to the benchmark, so raising the capture rate above 100% cannot conjure savings the benchmark does not support; categories with no benchmark treat the whole baseline as the gap.",
          `The year-one factor assumes a linear ramp to full run rate over ${ramp} months, giving ${fmt.pct(yr1Factor, 0)} of the run rate in the first twelve months.`,
          "Benchmarks must be scaled to the client's revenue and adjusted for business-model differences before they are used as targets; a peer's SG&A ratio is not a target on its own.",
          "One-time costs exclude the internal programme cost and any re-investment the business case assumes; track re-investment separately from savings.",
        ],
        nextSteps: ["Write an initiative charter per lever with the mechanism, milestones and KPI", "Confirm each benchmark against the peer XBRL tags used", "Set the monthly owner review and the rule for claiming a saving against the baseline"],
      };
    },
  },
  {
    kind: "calc", id: "ops-cost-to-serve", title: "Cost to serve & unit economics", tagline: "Activity-based cost per customer, contribution after serving, and the whale curve.",
    description: "Applies activity-based costing to a customer file: order handling, line picking, delivery, support, sales coverage and the carrying cost of payment terms are assigned to each customer, then netted against gross profit to give true contribution. Ranks customers by contribution, draws the whale curve of cumulative profit, and names the accounts that destroy it.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Commercial due diligence", "Strategy"],
    category: "Modeling", icon: "Coins", savesMinutes: 120, tags: ["cost to serve", "whale curve", "unit economics", "ABC"],
    fields: [
      { key: "customers", label: "Customer activity file", type: "csv", required: true, columns: "customer, revenue, gross_margin_pct, orders, order_lines, deliveries, support_tickets, sales_visits, dso_days", placeholder: "customer,revenue,gross_margin_pct,orders,order_lines,deliveries,support_tickets,sales_visits,dso_days" },
      { key: "perOrder", label: "Cost per order", type: "number", unit: "$", default: 42 },
      { key: "perLine", label: "Cost per order line", type: "number", unit: "$", default: 6.5 },
      { key: "perDelivery", label: "Cost per delivery", type: "number", unit: "$", default: 185 },
      { key: "perTicket", label: "Cost per support ticket", type: "number", unit: "$", default: 58 },
      { key: "perVisit", label: "Cost per sales visit", type: "number", unit: "$", default: 310 },
      { key: "carry", label: "Cost of capital on receivables", type: "number", unit: "%", default: 9 },
    ],
    example: {
      customers: "customer,revenue,gross_margin_pct,orders,order_lines,deliveries,support_tickets,sales_visits,dso_days\nAtlas Industrial,4200000,24,980,14700,1120,180,24,75\nMeridian Schools,3100000,29,420,5040,460,70,12,45\nNorthway Fabricators,2050000,22,640,11520,760,120,10,90\nCoastal Marine,1480000,35,240,2640,260,40,8,30\nPine Ridge District,1120000,31,190,2470,210,28,4,45\nHalcyon Coatings,880000,26,520,8320,610,96,9,60\nVertex Modular,620000,38,130,1430,150,18,6,30\nBaywater Yards,430000,33,88,968,104,12,3,30\nKestrel Metals,340000,19,410,6970,480,82,7,90\nOrion Pipeworks,260000,21,360,6120,420,74,8,85",
      perOrder: 42, perLine: 6.5, perDelivery: 185, perTicket: 58, perVisit: 310, carry: 9,
    },
    compute: (i: Inputs): WorkflowOutput => {
      const { header, rows } = parseCsv(str(i, "customers"));
      if (!rows.length) throw new Error("Paste a customer file with columns customer, revenue, gross_margin_pct, orders, order_lines, deliveries, support_tickets, sales_visits, dso_days.");
      const cName = findCol(header, "customer", "account", "name");
      const cRev = findCol(header, "revenue", "sales", "net_revenue");
      const cGm = findCol(header, "gross_margin_pct", "gross_margin", "gm_pct", "margin");
      const cOrd = findCol(header, "orders", "order_count");
      const cLines = findCol(header, "order_lines", "lines", "picks");
      const cDel = findCol(header, "deliveries", "shipments", "drops");
      const cTick = findCol(header, "support_tickets", "tickets", "service_calls");
      const cVis = findCol(header, "sales_visits", "visits", "calls");
      const cDso = findCol(header, "dso_days", "dso", "terms_days", "payment_terms_days");
      if (cRev < 0) throw new Error(`Could not find a revenue column; found: ${header.join(", ")}`);
      const cpo = num(i, "perOrder"), cpl = num(i, "perLine"), cpd = num(i, "perDelivery"), cpt = num(i, "perTicket"), cpv = num(i, "perVisit"), carry = num(i, "carry") / 100;
      const items = rows.map((r, k) => {
        const revenue = cellNum(r, cRev);
        const gm = cellNum(r, cGm, 0) / 100;
        const orders = cellNum(r, cOrd), lines = cellNum(r, cLines), deliveries = cellNum(r, cDel), tickets = cellNum(r, cTick), visits = cellNum(r, cVis), dso = cellNum(r, cDso);
        const gp = revenue * gm;
        const terms = (revenue / 365) * dso * carry;
        const cts = orders * cpo + lines * cpl + deliveries * cpd + tickets * cpt + visits * cpv + terms;
        return { name: cellStr(r, cName, `Customer ${k + 1}`), revenue, gm, gp, orders, lines, deliveries, tickets, visits, dso, terms, cts, net: gp - cts };
      }).filter((x) => x.revenue > 0);
      if (!items.length) throw new Error("No customer carried positive revenue.");
      const revenue = items.reduce((a, x) => a + x.revenue, 0);
      const gp = items.reduce((a, x) => a + x.gp, 0);
      const cts = items.reduce((a, x) => a + x.cts, 0);
      const net = gp - cts;
      const ranked = [...items].sort((a, b) => b.net - a.net);
      let cum = 0;
      const curve = ranked.map((x) => { cum += x.net; return { x: x.name, y: cum }; });
      const peak = Math.max(...curve.map((p) => p.y));
      const losers = ranked.filter((x) => x.net < 0);
      const avgActivityCost = items.length ? (cts - items.reduce((a, x) => a + x.terms, 0)) / items.length : 0;
      const avgGm = revenue > 0 ? gp / revenue : 0;
      const breakeven = avgGm > 0 ? avgActivityCost / avgGm : NaN;
      return {
        title: "Cost to serve and unit economics",
        summary: `Across ${items.length} customers, ${fmt.moneyRaw(revenue, 0)} of revenue produces ${fmt.moneyRaw(gp, 0)} of gross profit (${fmt.pct(avgGm, 1)}), of which ${fmt.moneyRaw(cts, 0)} is consumed serving the accounts, leaving ${fmt.moneyRaw(net, 0)} of contribution (${fmt.pct(revenue > 0 ? net / revenue : 0, 1)} of revenue). ${losers.length} of ${items.length} customers destroy value, giving back ${fmt.moneyRaw(peak - net, 0)} of the ${fmt.moneyRaw(peak, 0)} peak on the whale curve. At average activity a customer needs ${Number.isFinite(breakeven) ? fmt.moneyRaw(breakeven, 0) : "n/a"} of revenue to cover its cost to serve.`,
        blocks: [
          { type: "kpis", items: [
            { label: "Revenue", value: fmt.moneyRaw(revenue, 0) },
            { label: "Gross profit", value: fmt.moneyRaw(gp, 0), delta: fmt.pct(avgGm, 1) },
            { label: "Cost to serve", value: fmt.moneyRaw(cts, 0), delta: fmt.pct(revenue > 0 ? cts / revenue : 0, 1) },
            { label: "Contribution after serving", value: fmt.moneyRaw(net, 0), tone: net >= 0 ? "pos" : "neg" },
            { label: "Contribution margin", value: fmt.pct(revenue > 0 ? net / revenue : 0, 1) },
            { label: "Unprofitable customers", value: `${losers.length} of ${items.length}`, tone: losers.length ? "warn" : "pos" },
            { label: "Whale curve peak", value: fmt.moneyRaw(peak, 0), hint: `${fmt.pct(net !== 0 ? peak / net : 0, 0)} of the final contribution` },
            { label: "Breakeven revenue", value: Number.isFinite(breakeven) ? fmt.moneyRaw(breakeven, 0) : "n/a", hint: "At average activity and average gross margin" },
          ] },
          { type: "table", title: "Customer economics", columns: ["Customer", "Revenue", "Gross margin", "Gross profit", "Orders", "Deliveries", "Tickets", "DSO", "Terms cost", "Cost to serve", "CTS % of revenue", "Contribution", "Contribution margin"],
            rows: ranked.map((x) => [x.name, fmt.moneyRaw(x.revenue, 0), fmt.pct(x.gm, 1), fmt.moneyRaw(x.gp, 0), fmt.int(x.orders), fmt.int(x.deliveries), fmt.int(x.tickets), fmt.int(x.dso), fmt.moneyRaw(x.terms, 0), fmt.moneyRaw(x.cts, 0), fmt.pct(x.revenue > 0 ? x.cts / x.revenue : 0, 1), fmt.moneyRaw(x.net, 0), fmt.pct(x.revenue > 0 ? x.net / x.revenue : 0, 1)]),
            totals: ["Total", fmt.moneyRaw(revenue, 0), fmt.pct(avgGm, 1), fmt.moneyRaw(gp, 0), fmt.int(items.reduce((a, x) => a + x.orders, 0)), fmt.int(items.reduce((a, x) => a + x.deliveries, 0)), fmt.int(items.reduce((a, x) => a + x.tickets, 0)), "", fmt.moneyRaw(items.reduce((a, x) => a + x.terms, 0), 0), fmt.moneyRaw(cts, 0), fmt.pct(revenue > 0 ? cts / revenue : 0, 1), fmt.moneyRaw(net, 0), fmt.pct(revenue > 0 ? net / revenue : 0, 1)] },
          { type: "line", title: "Whale curve: cumulative contribution by customer, best to worst", format: "money", series: [{ name: "Cumulative contribution", points: curve }] },
          { type: "bar", title: "Contribution after cost to serve", format: "money", reference: { value: 0, label: "Breakeven" },
            data: ranked.map((x) => ({ label: x.name, value: x.net, emphasis: x.net < 0 })) },
          { type: "scatter", title: "Revenue against contribution margin", xLabel: "Revenue", yLabel: "Contribution margin", xFormat: "money", yFormat: "pct",
            points: ranked.map((x) => ({ label: x.name, x: x.revenue, y: x.revenue > 0 ? x.net / x.revenue : null, emphasis: x.net < 0 })) },
          { type: "table", title: "Activity cost build", columns: ["Activity", "Rate", "Volume", "Cost", "% of cost to serve"], rows: [
            ["Order handling", fmt.moneyRaw(cpo, 2), fmt.int(items.reduce((a, x) => a + x.orders, 0)), fmt.moneyRaw(items.reduce((a, x) => a + x.orders, 0) * cpo, 0), fmt.pct(cts > 0 ? (items.reduce((a, x) => a + x.orders, 0) * cpo) / cts : 0, 0)],
            ["Line picking", fmt.moneyRaw(cpl, 2), fmt.int(items.reduce((a, x) => a + x.lines, 0)), fmt.moneyRaw(items.reduce((a, x) => a + x.lines, 0) * cpl, 0), fmt.pct(cts > 0 ? (items.reduce((a, x) => a + x.lines, 0) * cpl) / cts : 0, 0)],
            ["Delivery", fmt.moneyRaw(cpd, 2), fmt.int(items.reduce((a, x) => a + x.deliveries, 0)), fmt.moneyRaw(items.reduce((a, x) => a + x.deliveries, 0) * cpd, 0), fmt.pct(cts > 0 ? (items.reduce((a, x) => a + x.deliveries, 0) * cpd) / cts : 0, 0)],
            ["Support", fmt.moneyRaw(cpt, 2), fmt.int(items.reduce((a, x) => a + x.tickets, 0)), fmt.moneyRaw(items.reduce((a, x) => a + x.tickets, 0) * cpt, 0), fmt.pct(cts > 0 ? (items.reduce((a, x) => a + x.tickets, 0) * cpt) / cts : 0, 0)],
            ["Sales coverage", fmt.moneyRaw(cpv, 2), fmt.int(items.reduce((a, x) => a + x.visits, 0)), fmt.moneyRaw(items.reduce((a, x) => a + x.visits, 0) * cpv, 0), fmt.pct(cts > 0 ? (items.reduce((a, x) => a + x.visits, 0) * cpv) / cts : 0, 0)],
            ["Receivables carrying cost", fmt.pct(carry, 1), "-", fmt.moneyRaw(items.reduce((a, x) => a + x.terms, 0), 0), fmt.pct(cts > 0 ? items.reduce((a, x) => a + x.terms, 0) / cts : 0, 0)],
          ], totals: ["Total cost to serve", "", "", fmt.moneyRaw(cts, 0), fmt.pct(1, 0)] },
          { type: "callout", tone: losers.length ? "warn" : "pos", title: losers.length ? "Where the profit leaks" : "No value-destroying accounts",
            text: losers.length
              ? `${losers.map((x) => x.name).slice(0, 4).join(", ")}${losers.length > 4 ? ` and ${losers.length - 4} others` : ""} consume ${fmt.moneyRaw(losers.reduce((a, x) => a + x.cts, 0), 0)} of serving cost against ${fmt.moneyRaw(losers.reduce((a, x) => a + x.gp, 0), 0)} of gross profit. The levers, in the order they are usually tried: minimum order size, order consolidation and delivery frequency, a channel or self-serve move, tightened payment terms, then price. Repricing to breakeven on these accounts recovers ${fmt.moneyRaw(-losers.reduce((a, x) => a + x.net, 0), 0)}.`
              : `Every account covers its cost to serve. The remaining prize is in the spread: ${ranked[0].name} contributes at ${fmt.pct(ranked[0].revenue > 0 ? ranked[0].net / ranked[0].revenue : 0, 1)} against ${fmt.pct(ranked[ranked.length - 1].revenue > 0 ? ranked[ranked.length - 1].net / ranked[ranked.length - 1].revenue : 0, 1)} at the bottom, so service-level differentiation is worth more than price here.` },
        ],
        caveats: [
          "Activity rates are fully loaded averages; a true activity-based costing exercise derives them from the cost baseline by activity pool and re-tests capacity utilization before rates are used to make pricing decisions.",
          "Only the receivables carrying cost is financed here; inventory held for a specific customer, returns and rework should be added where the data exists.",
          "Gross margin is taken as given per customer, so mix within a customer is invisible; run the analysis at customer x product level where the data allows.",
          "Contribution after cost to serve is not net profit: unallocated overhead remains outside this view by design.",
        ],
        nextSteps: ["Set a minimum order size and a delivery frequency policy for the small, high-activity accounts", "Model the price and terms change needed to bring each loss-making account to breakeven", "Tie the activity rates back to the cost baseline so the rates are defensible"],
      };
    },
  },
];

const CALCULATORS_C: ToolDef[] = [
  {
    kind: "calc", id: "cdd-nps-survey-stats", title: "NPS & survey statistics", tagline: "Net promoter score with its confidence interval, plus the sample size the read-out needs.",
    description: "Computes the net promoter score from promoter, passive and detractor counts and puts a real confidence interval around it, using the variance of the +1 / 0 / -1 NPS variable rather than a proportion approximation. Applies the finite population correction, tests the score against the sub-20 threshold diligence checklists use, and solves for the sample size a target margin of error requires.",
    roles: ["consultant", "pe", "corpfin"], specialties: ["Commercial due diligence", "Strategy", "Operations & performance"],
    category: "Research", icon: "Gauge", savesMinutes: 45, tags: ["NPS", "survey", "margin of error", "sample size"],
    fields: [
      { key: "promoters", label: "Promoters (9-10)", type: "number", required: true, default: 138 },
      { key: "passives", label: "Passives (7-8)", type: "number", required: true, default: 96 },
      { key: "detractors", label: "Detractors (0-6)", type: "number", required: true, default: 66 },
      { key: "confidence", label: "Confidence level", type: "select", options: ["90%", "95%", "99%"], default: "95%" },
      { key: "population", label: "Population size", type: "number", default: 0, help: "Customer base size; leave at zero for an infinite population" },
      { key: "targetMoe", label: "Target margin of error", type: "number", unit: "points", default: 5, min: 1, max: 30 },
      { key: "benchmark", label: "Category benchmark NPS", type: "number", default: 31, min: -100, max: 100 },
    ],
    example: { promoters: 138, passives: 96, detractors: 66, confidence: "95%", population: 4200, targetMoe: 5, benchmark: 31 },
    compute: (i: Inputs): WorkflowOutput => {
      const p = Math.round(num(i, "promoters")), pa = Math.round(num(i, "passives")), d = Math.round(num(i, "detractors"));
      if (p < 0 || pa < 0 || d < 0) throw new Error("Promoter, passive and detractor counts cannot be negative.");
      const n = p + pa + d;
      if (n < 2) throw new Error("Enter at least two responses: an NPS needs a sample.");
      const pop = Math.round(num(i, "population"));
      if (pop > 0 && pop < n) throw new Error("The population cannot be smaller than the sample.");
      const z = str(i, "confidence", "95%") === "90%" ? 1.6449 : str(i, "confidence", "95%") === "99%" ? 2.5758 : 1.96;
      const targetMoe = Math.max(1, num(i, "targetMoe", 5)), bench = num(i, "benchmark");
      const shareP = p / n, shareD = d / n, sharePa = pa / n;
      const nps = (shareP - shareD) * 100;
      const variance = shareP + shareD - Math.pow(shareP - shareD, 2);
      const fpc = pop > 0 ? Math.sqrt((pop - n) / (pop - 1)) : 1;
      const se = Math.sqrt(variance / n) * fpc;
      const moe = z * se * 100;
      const lo = nps - moe, hi = nps + moe;
      const nForMoe = (e: number) => { const n0 = (Math.pow(z, 2) * variance) / Math.pow(e / 100, 2); return pop > 0 ? n0 / (1 + (n0 - 1) / pop) : n0; };
      const nForProp = (e: number) => { const n0 = (Math.pow(z, 2) * 0.25) / Math.pow(e / 100, 2); return pop > 0 ? n0 / (1 + (n0 - 1) / pop) : n0; };
      const sizes = [50, 100, 200, 300, 500, 1000];
      const moeAt = (m: number) => { const f = pop > 0 && pop > m ? Math.sqrt((pop - m) / (pop - 1)) : 1; return z * Math.sqrt(variance / m) * 100 * f; };
      const redFlag = nps < 20;
      const vsBench = nps - bench;
      const benchSignificant = Math.abs(vsBench) > moe;
      return {
        title: "NPS and survey statistics",
        summary: `NPS is ${nps.toFixed(1)} on ${n} responses (${fmt.pct(shareP, 1)} promoters, ${fmt.pct(sharePa, 1)} passives, ${fmt.pct(shareD, 1)} detractors), with a margin of error of ${moe.toFixed(1)} points at ${str(i, "confidence", "95%")} confidence, so the true score sits between ${lo.toFixed(1)} and ${hi.toFixed(1)}. ${redFlag ? `At ${nps.toFixed(0)} the score is below the 20-point threshold diligence checklists treat as a red flag.` : `At ${nps.toFixed(0)} the score clears the 20-point diligence threshold.`} Against a category benchmark of ${bench.toFixed(0)} the gap of ${vsBench.toFixed(1)} points is ${benchSignificant ? "larger than the margin of error, so it is a real difference" : "inside the margin of error, so it is not distinguishable from noise"}. Reaching a ${targetMoe.toFixed(0)}-point margin of error needs ${Math.ceil(nForMoe(targetMoe))} completes.`,
        blocks: [
          { type: "kpis", items: [
            { label: "NPS", value: nps.toFixed(1), tone: redFlag ? "neg" : nps >= 50 ? "pos" : "neutral" },
            { label: "Responses", value: fmt.int(n) },
            { label: `Margin of error (${str(i, "confidence", "95%")})`, value: `±${moe.toFixed(1)} pts` },
            { label: "Confidence interval", value: `${lo.toFixed(1)} to ${hi.toFixed(1)}` },
            { label: "Promoters", value: fmt.pct(shareP, 1) },
            { label: "Detractors", value: fmt.pct(shareD, 1) },
            { label: "vs benchmark", value: `${vsBench >= 0 ? "+" : ""}${vsBench.toFixed(1)} pts`, tone: benchSignificant ? (vsBench >= 0 ? "pos" : "neg") : "warn", hint: benchSignificant ? "Outside the margin of error" : "Inside the margin of error" },
            { label: `n for ±${targetMoe.toFixed(0)} pts`, value: fmt.int(Math.ceil(nForMoe(targetMoe))) },
          ] },
          { type: "callout", tone: redFlag ? "warn" : "pos", title: redFlag ? "Below the diligence threshold" : "Above the diligence threshold",
            text: redFlag
              ? `An NPS of ${nps.toFixed(0)} is below the 20 that commercial diligence checklists flag. Read it with behaviour, not on its own: pair it with repeat purchase, logo retention and the detractor verbatims, and split the score by segment - a single weak segment can carry a whole score down while the rest of the base is loyal.${moe > 8 ? ` The ±${moe.toFixed(1)}-point interval is wide, so the finding needs more completes before it goes in a report as a number.` : ""}`
              : `An NPS of ${nps.toFixed(0)} clears the 20-point threshold, but a relationship score says little about any single interaction. Pair it with behaviour (repeat purchase, referrals, expansion) and read the score by segment before treating it as evidence of pricing power.` },
          { type: "bar", title: "Response mix", format: "pct", data: [
            { label: "Promoters (9-10)", value: shareP, emphasis: true }, { label: "Passives (7-8)", value: sharePa }, { label: "Detractors (0-6)", value: shareD },
          ] },
          { type: "table", title: "Response detail", columns: ["Group", "Count", "Share", "NPS weight"], rows: [
            ["Promoters (9-10)", fmt.int(p), fmt.pct(shareP, 1), "+1"],
            ["Passives (7-8)", fmt.int(pa), fmt.pct(sharePa, 1), "0"],
            ["Detractors (0-6)", fmt.int(d), fmt.pct(shareD, 1), "-1"],
          ], totals: ["Total", fmt.int(n), fmt.pct(1, 0), `NPS ${nps.toFixed(1)}`] },
          { type: "bar", title: "Margin of error by sample size (NPS points)", format: "num", reference: { value: targetMoe, label: `Target ±${targetMoe.toFixed(0)}` },
            data: sizes.map((m) => ({ label: `n=${m}`, value: moeAt(m), emphasis: m >= n && (sizes.indexOf(m) === 0 || sizes[sizes.indexOf(m) - 1] < n) })) },
          { type: "table", title: "Sample size planning", columns: ["Target margin of error", "Completes for NPS", "Completes for a 50/50 proportion", "Read-out status"],
            rows: [15, 10, 7, 5, 3].map((e) => [`±${e} pts`, fmt.int(Math.ceil(nForMoe(e))), fmt.int(Math.ceil(nForProp(e))), Math.ceil(nForMoe(e)) <= n ? "Achieved" : "Needs more completes"]),
            note: `Computed at ${str(i, "confidence", "95%")} confidence on the observed NPS variance of ${variance.toFixed(3)}${pop > 0 ? `, with a finite population correction against a base of ${fmt.int(pop)} (factor ${fpc.toFixed(3)})` : ", with no finite population correction"}. A 50/50 proportion is the worst case for any single survey question.` },
          { type: "score", title: "Read-out reliability", items: [
            { label: "Total sample", score: Math.min(5, Math.max(1, Math.round(n / 60))), max: 5, note: `n = ${n}; a full CDD survey runs 200-1,000+ completes` },
            { label: "Precision at this n", score: moe <= 4 ? 5 : moe <= 6 ? 4 : moe <= 9 ? 3 : moe <= 13 ? 2 : 1, max: 5, note: `±${moe.toFixed(1)} points at ${str(i, "confidence", "95%")}` },
            { label: "Benchmark comparison", score: benchSignificant ? 5 : 2, max: 5, note: benchSignificant ? "The gap to the benchmark exceeds the margin of error" : "The gap to the benchmark is inside the margin of error" },
          ] },
        ],
        caveats: [
          "The margin of error uses the variance of the NPS variable itself (promoters +1, passives 0, detractors -1), which is wider than the proportion approximation often quoted and is the correct basis for a difference test.",
          "Segments below n = 50 should not be read out; n = 30-50 is directional only. Sub-group margins of error are much wider than the total-sample figure.",
          "Sampling error is only one error: non-response bias, a sample frame supplied by the seller, and question-order effects usually matter more than the interval.",
          pop > 0 ? `The finite population correction assumes a random sample of the ${fmt.int(pop)}-customer base.` : "No finite population correction applied; enter the customer base size if the sample is a large share of it.",
        ],
        nextSteps: ["Split the score by segment, tenure and product before drawing a conclusion", "Pair the score with logo retention and NRR from the cohort engine", "Code the detractor verbatims into themes and size the revenue at risk"],
      };
    },
  },
  {
    kind: "calc", id: "cdd-benchmark-quartiles", title: "Benchmark quartile spread", tagline: "Quartiles, the subject's percentile, and the gap to median and top quartile in dollars.",
    description: "Turns a pasted list of peer values for one metric into the benchmark exhibit: minimum, first quartile, median, third quartile and maximum by linear interpolation, each company's quartile, the subject's percentile among peers, and the gap to median and to top quartile converted into dollars of annual cost where the metric is a percentage of revenue.",
    roles: ["consultant", "corpfin", "pe"], specialties: ["Operations & performance", "Strategy", "Commercial due diligence", "Economic & valuation advisory"],
    category: "Diligence", icon: "BarChart3", savesMinutes: 60, tags: ["benchmark", "quartiles", "gap to median", "peers"],
    fields: [
      { key: "data", label: "Peer values", type: "csv", required: true, columns: "company, value", placeholder: "company,value" },
      { key: "metric", label: "Metric", type: "text", required: true, default: "SG&A % of revenue" },
      { key: "subject", label: "Subject company", type: "text", required: true, default: "Client" },
      { key: "format", label: "Metric type", type: "select", options: ["Percent of revenue", "Percent", "Multiple", "Days", "Number"], default: "Percent of revenue" },
      { key: "higherIsBetter", label: "Higher is better", type: "toggle", default: false },
      { key: "revenue", label: "Subject revenue", type: "number", unit: "$mm", default: 2540, help: "Used to convert a percentage-of-revenue gap into dollars" },
    ],
    example: {
      data: "company,value\nClient,33.2\nCRM,33.8\nADBE,26.4\nWDAY,31.2\nINTU,29.7\nORCL,19.8\nSAP,24.9\nNOW,28.1\nTEAM,32.6\nHUBS,38.4",
      metric: "SG&A % of revenue", subject: "Client", format: "Percent of revenue", higherIsBetter: false, revenue: 2540,
    },
    compute: (i: Inputs): WorkflowOutput => {
      const { header, rows } = parseCsv(str(i, "data"));
      if (!rows.length) throw new Error("Paste peer rows with columns company, value.");
      const cName = findCol(header, "company", "peer", "ticker", "name");
      const cVal = findCol(header, "value", "metric", "amount", "pct", "ratio");
      if (cVal < 0) throw new Error(`Could not find a value column; found: ${header.join(", ")}`);
      const all = rows.map((r, k) => ({ name: cellStr(r, cName, `Peer ${k + 1}`), value: cellNum(r, cVal, NaN) })).filter((x) => Number.isFinite(x.value));
      if (all.length < 3) throw new Error("A quartile spread needs at least three companies with values.");
      const subjectName = str(i, "subject", "Client");
      const subject = all.find((x) => norm(x.name) === norm(subjectName));
      const peers = subject ? all.filter((x) => x !== subject) : all;
      if (peers.length < 2) throw new Error("At least two peers are needed once the subject is excluded.");
      const higher = bool(i, "higherIsBetter");
      const fmtType = str(i, "format", "Percent of revenue");
      const isPctRev = fmtType === "Percent of revenue";
      const fv = (v: number) => (!Number.isFinite(v) ? "n/a" : fmtType === "Multiple" ? `${v.toFixed(1)}x` : fmtType === "Days" ? `${v.toFixed(0)} days` : fmtType === "Number" ? fmt.num(v, 1) : `${v.toFixed(1)}%`);
      const vals = peers.map((x) => x.value);
      const min = Math.min(...vals), max = Math.max(...vals);
      const q1 = quantile(vals, 0.25), med = quantile(vals, 0.5), q3 = quantile(vals, 0.75);
      const iqr = q3 - q1;
      const top = higher ? q3 : q1, bottom = higher ? q1 : q3;
      const revenue = num(i, "revenue");
      const sv = subject ? subject.value : NaN;
      const below = subject ? peers.filter((x) => x.value < sv).length : 0;
      const equal = subject ? peers.filter((x) => x.value === sv).length : 0;
      const pctRank = subject ? (below + 0.5 * equal) / peers.length : NaN;
      const betterRank = subject ? (higher ? pctRank : 1 - pctRank) : NaN;
      const gapMed = subject ? sv - med : NaN;
      const gapTop = subject ? sv - top : NaN;
      const dollars = (gapPts: number) => (isPctRev && Number.isFinite(gapPts) ? (Math.abs(gapPts) / 100) * revenue : NaN);
      const favourable = subject ? (higher ? sv >= med : sv <= med) : false;
      const beyondTop = subject ? (higher ? sv >= top : sv <= top) : false;
      const quartileOf = (v: number) => (v <= q1 ? "Q1 (lowest)" : v <= med ? "Q2" : v <= q3 ? "Q3" : "Q4 (highest)");
      const ranked = [...all].sort((a, b) => (higher ? b.value - a.value : a.value - b.value));
      return {
        title: `${str(i, "metric", "Benchmark")}: quartile spread`,
        summary: subject
          ? `${subjectName} sits at ${fv(sv)} on ${str(i, "metric", "the metric")} against a peer median of ${fv(med)} across ${peers.length} peers, a gap of ${fv(Math.abs(gapMed))} ${favourable ? "in its favour" : "against it"}${isPctRev ? ` and worth ${fmt.money(dollars(gapMed))} of annual cost at ${fmt.money(revenue)} of revenue` : ""}. That places it in the ${ordinal(Math.round(betterRank * 100))} percentile of the peer set (${higher ? "higher" : "lower"} is better). ${beyondTop ? `It already sits inside the best quartile of ${fv(top)}, ahead of it by ${fv(Math.abs(gapTop))}.` : `Reaching the best quartile of ${fv(top)} is a total gap of ${fv(Math.abs(gapTop))}${isPctRev ? `, or ${fmt.money(dollars(gapTop))} a year, of which ${isPctRev ? fmt.money(dollars(gapMed)) : fv(Math.abs(gapMed))} is the gap to median` : ""}.`} The peer set spans ${fv(min)} to ${fv(max)} with an interquartile range of ${fv(iqr)}, so the spread itself is ${Math.abs(iqr) > Math.abs(med) * 0.25 ? "wide enough that business-model differences, not efficiency, may explain much of it" : "tight, which makes the subject's position meaningful"}.`
          : `Across ${peers.length} companies the median is ${fv(med)} with quartiles at ${fv(q1)} and ${fv(q3)} and a range of ${fv(min)} to ${fv(max)}. No row matched the subject name "${subjectName}", so no gap analysis was produced; add the subject to the pasted list to place it.`,
        blocks: [
          { type: "kpis", items: [
            ...(subject ? [{ label: subjectName, value: fv(sv), tone: (favourable ? "pos" : "warn") as "pos" | "warn" }] : []),
            { label: "Peer median", value: fv(med) },
            { label: "Q1", value: fv(q1) }, { label: "Q3", value: fv(q3) },
            { label: `Best quartile (${higher ? "high" : "low"})`, value: fv(top) },
            ...(subject ? [{ label: "Percentile", value: ordinal(Math.round(betterRank * 100)), hint: `${higher ? "Higher" : "Lower"} is better` }] : []),
            ...(subject && isPctRev ? [{ label: "Gap to median", value: fmt.money(dollars(gapMed)), tone: (favourable ? "pos" : "neg") as "pos" | "neg" }, { label: "Gap to best quartile", value: fmt.money(dollars(gapTop)) }] : subject ? [{ label: "Gap to median", value: fv(Math.abs(gapMed)) }] : []),
          ] },
          { type: "table", title: "Quartile statistics", columns: ["Statistic", "Value", ...(isPctRev ? ["Implied annual cost ($mm)"] : [])], rows: [
            ["Minimum", fv(min), ...(isPctRev ? [fmt.num((min / 100) * revenue, 0)] : [])],
            ["First quartile (Q1)", fv(q1), ...(isPctRev ? [fmt.num((q1 / 100) * revenue, 0)] : [])],
            ["Median", fv(med), ...(isPctRev ? [fmt.num((med / 100) * revenue, 0)] : [])],
            ["Third quartile (Q3)", fv(q3), ...(isPctRev ? [fmt.num((q3 / 100) * revenue, 0)] : [])],
            ["Maximum", fv(max), ...(isPctRev ? [fmt.num((max / 100) * revenue, 0)] : [])],
            ["Interquartile range", fv(iqr), ...(isPctRev ? [fmt.num((iqr / 100) * revenue, 0)] : [])],
            ...(subject ? [[`${subjectName} (subject)`, fv(sv), ...(isPctRev ? [fmt.num((sv / 100) * revenue, 0)] : [])]] : []),
          ], emphasisRow: subject ? 6 : 2, note: `Quartiles use linear interpolation over the peer set, excluding the subject. ${higher ? "Higher" : "Lower"} is better here, so ${fv(top)} is the quartile to aim at and ${fv(bottom)} is the weak quartile.` },
          { type: "bar", title: `${str(i, "metric", "Metric")} by company`, format: isPctRev || fmtType === "Percent" ? "num" : fmtType === "Multiple" ? "x" : "num",
            reference: { value: med, label: `Median ${fv(med)}` },
            data: ranked.map((x) => ({ label: x.name, value: x.value, emphasis: subject ? norm(x.name) === norm(subjectName) : false, note: quartileOf(x.value) })) },
          { type: "table", title: "Ranked companies", columns: ["Rank", "Company", "Value", "Quartile", "vs median", ...(isPctRev ? ["vs median ($mm)"] : [])],
            rows: ranked.map((x, k) => [String(k + 1), x.name + (subject && norm(x.name) === norm(subjectName) ? " (subject)" : ""), fv(x.value), quartileOf(x.value), `${x.value - med >= 0 ? "+" : ""}${fv(x.value - med)}`, ...(isPctRev ? [fmt.num(((x.value - med) / 100) * revenue, 0)] : [])]),
            emphasisRow: subject ? ranked.findIndex((x) => norm(x.name) === norm(subjectName)) : undefined },
          ...(subject ? [{ type: "callout" as const, tone: (favourable ? "pos" : "warn") as "pos" | "warn", title: favourable ? "Better than median" : "Worse than median",
            text: `${subjectName} is ${favourable ? "ahead of" : "behind"} the peer median by ${fv(Math.abs(gapMed))}${isPctRev ? ` (${fmt.money(dollars(gapMed))} a year at ${fmt.money(revenue)} of revenue)` : ""} and is ${beyondTop ? "already inside" : "outside"} the best quartile. Before this becomes a target, separate structural from addressable: differences in vertical integration, channel mix, capitalization policy and accounting classification usually explain a large part of any gap of this size, and the XBRL tag each peer used should be checked line by line.` }] : []),
        ],
        caveats: [
          "Quartiles are computed on the peer set with the subject excluded, using linear interpolation, so they differ slightly from an exclusive-median convention on small sets.",
          `With ${peers.length} peers the quartiles are sensitive to a single outlier; the interquartile range of ${fv(iqr)} is the better read of dispersion than the min-max range.`,
          isPctRev ? "Dollar gaps assume the metric is a percentage of the subject's revenue and that the gap is fully addressable, which it rarely is; treat it as the size of the prize, not the target." : "No dollar conversion is applied because the metric is not a percentage of revenue.",
          "Fiscal year ends, adjusted versus reported figures, and different XBRL tags for the same concept all distort a cross-company comparison; state the tag used per company in the report.",
        ],
        nextSteps: ["Name the XBRL tag behind every peer value", "Split the gap into structural and addressable before setting a target", "Run the cost structure benchmark for the full line-by-line comparison"],
      };
    },
  },
];

const CALCULATORS_D: ToolDef[] = [
  {
    kind: "calc", id: "econ-lost-profits", title: "Damages: lost profits", tagline: "But-for revenue against actuals, incremental margin, mitigation, offsets and prejudgment interest.",
    description: "Builds the lost-profits schedule an expert report rests on: but-for revenue grown from the pre-event base at the yardstick rate, lost revenue against the actuals for each period, lost profit at the incremental contribution margin rather than the fully absorbed margin, plus mitigation costs, less the benefit of mitigation achieved, plus prejudgment interest from each period's midpoint to judgment.",
    roles: ["consultant"], specialties: ["Economic & valuation advisory", "Financial due diligence (TAS)", "Strategy"],
    category: "Valuation", icon: "Landmark", savesMinutes: 150, tags: ["damages", "lost profits", "but-for", "prejudgment interest"],
    fields: [
      { key: "base", label: "Pre-event revenue, last full period", type: "number", unit: "$mm", required: true, default: 84 },
      { key: "growth", label: "But-for growth rate", type: "number", unit: "% p.a.", default: 9, help: "From the yardstick benchmark or the plaintiff's own pre-event trend" },
      { key: "frequency", label: "Period frequency", type: "select", options: ["Annual", "Quarterly", "Monthly"], default: "Annual" },
      { key: "actuals", label: "Actual revenue by period", type: "text", required: true, default: "79 81", help: "Space or comma separated, one figure per damages period, in $mm" },
      { key: "margin", label: "Incremental contribution margin", type: "number", unit: "%", default: 46 },
      { key: "mitigationCost", label: "Mitigation and additional costs incurred", type: "number", unit: "$mm", default: 1.1 },
      { key: "offsets", label: "Benefit of mitigation achieved (offset)", type: "number", unit: "$mm", default: 0.4 },
      { key: "interest", label: "Prejudgment interest rate", type: "number", unit: "%", default: 6 },
      { key: "compound", label: "Compound the interest", type: "toggle", default: false },
    ],
    example: { base: 84, growth: 9, frequency: "Annual", actuals: "79 81", margin: 46, mitigationCost: 1.1, offsets: 0.4, interest: 6, compound: false },
    compute: (i: Inputs): WorkflowOutput => {
      const base = num(i, "base"), g = num(i, "growth") / 100, m = num(i, "margin") / 100;
      const mitig = num(i, "mitigationCost"), offsets = num(i, "offsets"), r = num(i, "interest") / 100, compound = bool(i, "compound");
      const freq = str(i, "frequency", "Annual");
      const ppy = freq === "Monthly" ? 12 : freq === "Quarterly" ? 4 : 1;
      const actuals = list(i, "actuals").map(Number).filter((x) => Number.isFinite(x));
      if (base <= 0) throw new Error("Pre-event revenue must be positive.");
      if (!actuals.length) throw new Error("Enter actual revenue for at least one damages period, space or comma separated.");
      if (m <= 0 || m > 1) throw new Error("The incremental contribution margin must be between 0 and 100%.");
      const n = actuals.length;
      const periodRate = Math.pow(1 + g, 1 / ppy) - 1;
      const basePerPeriod = base / ppy;
      const rows = actuals.map((actual, k) => {
        const butFor = basePerPeriod * Math.pow(1 + periodRate, k + 1);
        const lostRev = butFor - actual;
        const lostProfit = lostRev * m;
        const years = (n - k - 0.5) / ppy;
        const interest = compound ? lostProfit * (Math.pow(1 + r, years) - 1) : lostProfit * r * years;
        return { label: ppy === 1 ? `Year ${k + 1}` : ppy === 4 ? `Q${k + 1}` : `M${k + 1}`, butFor, actual, lostRev, lostProfit, years, interest };
      });
      const lostRev = rows.reduce((a, x) => a + x.lostRev, 0);
      const lostProfit = rows.reduce((a, x) => a + x.lostProfit, 0);
      const interestTotal = rows.reduce((a, x) => a + x.interest, 0);
      const total = lostProfit + mitig - offsets + interestTotal;
      const butForTotal = rows.reduce((a, x) => a + x.butFor, 0);
      const growths = [g - 0.04, g - 0.02, g, g + 0.02, g + 0.04];
      const margins = [m - 0.1, m - 0.05, m, m + 0.05, m + 0.1].filter((x) => x > 0);
      const grid = growths.map((gg) => margins.map((mm) => {
        const pr = Math.pow(1 + gg, 1 / ppy) - 1;
        let lp = 0, it = 0;
        actuals.forEach((actual, k) => {
          const bf = basePerPeriod * Math.pow(1 + pr, k + 1);
          const p = (bf - actual) * mm;
          const yrs = (n - k - 0.5) / ppy;
          lp += p; it += compound ? p * (Math.pow(1 + r, yrs) - 1) : p * r * yrs;
        });
        return lp + mitig - offsets + it;
      }));
      let cum = 0;
      const cumRows = rows.map((x) => { cum += x.lostProfit + x.interest; return cum; });
      return {
        title: "Lost profits damages",
        summary: `But-for revenue of ${fmt.money(butForTotal)} over ${n} ${freq.toLowerCase()} period${n === 1 ? "" : "s"} against actuals of ${fmt.money(actuals.reduce((a, b) => a + b, 0))} gives lost revenue of ${fmt.money(lostRev)}. At a ${fmt.pct(m, 0)} incremental contribution margin that is ${fmt.money(lostProfit)} of lost profit, plus ${fmt.money(mitig)} of mitigation and additional costs, less ${fmt.money(offsets)} of mitigation benefit, plus ${fmt.money(interestTotal)} of ${compound ? "compound" : "simple"} prejudgment interest at ${fmt.pct(r, 1)}, for total damages of ${fmt.money(total)}. Lost profit is ${fmt.pct(butForTotal > 0 ? lostProfit / butForTotal : 0, 1)} of but-for revenue, and the incremental margin is the assumption that moves the answer most.`,
        blocks: [
          { type: "kpis", items: [
            { label: "But-for revenue", value: fmt.money(butForTotal) },
            { label: "Lost revenue", value: fmt.money(lostRev), tone: lostRev >= 0 ? "neutral" : "warn" },
            { label: "Incremental margin", value: fmt.pct(m, 0) },
            { label: "Lost profit", value: fmt.money(lostProfit) },
            { label: "Mitigation costs", value: fmt.money(mitig) },
            { label: "Offsets", value: fmt.money(-offsets) },
            { label: "Prejudgment interest", value: fmt.money(interestTotal), hint: `${compound ? "Compound" : "Simple"} at ${fmt.pct(r, 1)} from each period midpoint` },
            { label: "Total damages", value: fmt.money(total), tone: "info" },
          ] },
          { type: "table", title: "But-for model (USD mm)", columns: ["Period", "But-for revenue", "Actual revenue", "Lost revenue", "Incremental margin", "Lost profit", "Years to judgment", "Interest", "Cumulative"],
            rows: rows.map((x, k) => [x.label, fmt.num(x.butFor, 1), fmt.num(x.actual, 1), fmt.num(x.lostRev, 1), fmt.pct(m, 0), fmt.num(x.lostProfit, 1), x.years.toFixed(2), fmt.num(x.interest, 2), fmt.num(cumRows[k], 1)]),
            totals: ["Total", fmt.num(butForTotal, 1), fmt.num(actuals.reduce((a, b) => a + b, 0), 1), fmt.num(lostRev, 1), "", fmt.num(lostProfit, 1), "", fmt.num(interestTotal, 2), fmt.num(lostProfit + interestTotal, 1)] },
          { type: "line", title: "But-for against actual revenue (USD mm)", format: "money", series: [
            { name: "But-for", points: rows.map((x) => ({ x: x.label, y: x.butFor })) },
            { name: "Actual", points: rows.map((x) => ({ x: x.label, y: x.actual })) },
          ] },
          { type: "waterfall", title: "Damages build (USD mm)", format: "money", steps: [
            { label: "Lost profit", value: lostProfit, total: true },
            { label: "Mitigation and additional costs", value: mitig },
            { label: "Less mitigation benefit", value: -offsets },
            { label: "Prejudgment interest", value: interestTotal },
            { label: "Total damages", value: total, total: true },
          ] },
          { type: "sensitivity", title: "Total damages ($mm): but-for growth × incremental margin", rowLabel: "But-for growth", colLabel: "Incremental margin", rows: growths.map((x) => fmt.pct(x, 1)), cols: margins.map((x) => fmt.pct(x, 0)), values: grid, format: "money", baseRow: 2, baseCol: margins.indexOf(m) >= 0 ? margins.indexOf(m) : 2 },
          { type: "table", title: "Assumption log", columns: ["Assumption", "Value", "Basis to document", "Opposing argument to expect"], rows: [
            ["Pre-event revenue base", fmt.money(base), "Audited or reviewed statements for the last full pre-event period", "The base period was itself unusual and overstates the run rate"],
            ["But-for growth", fmt.pct(g, 1), "Yardstick benchmark growth over the same period, or the plaintiff's own pre-event trend", "The benchmark is not comparable, or the growth reflects market conditions the plaintiff could not have captured"],
            ["Incremental contribution margin", fmt.pct(m, 0), "Cost behaviour analysis showing which costs were avoided when the revenue did not occur", "The fully absorbed margin applies because capacity costs would have scaled"],
            ["Damages period", `${n} ${freq.toLowerCase()} period${n === 1 ? "" : "s"}`, "The date the conduct began and the date its effect ended or was mitigated", "The period is too long: the effect dissipated earlier, or other causes intervened"],
            ["Mitigation", `${fmt.money(mitig)} cost, ${fmt.money(offsets)} benefit`, "Invoices for substitute arrangements and the revenue regained", "The plaintiff failed to mitigate reasonably, or the offset is understated"],
            ["Prejudgment interest", `${fmt.pct(r, 1)} ${compound ? "compound" : "simple"}`, "The statutory or contractual rate and the convention in the forum", "The wrong rate or convention, or double counting with a present-value discount"],
          ] },
        ],
        caveats: [
          "But-for revenue is grown from the pre-event base at the stated rate; substitute a directly measured yardstick or market-share series where one is available, and reconcile at least two methods before concluding.",
          "Lost profit uses an incremental contribution margin, which is the correct basis where fixed costs continued regardless. Applying a fully absorbed margin overstates damages and is the most commonly attacked step.",
          "Prejudgment interest runs from each period's midpoint to the judgment date. Do not also discount the same cash flow to present value; choose one convention and state the legal basis.",
          "Causation and liability are legal questions. This schedule quantifies an economic scenario and does not establish that the conduct caused it.",
          "Negative lost revenue in any period means the actuals exceeded the but-for world; it is retained in the total as an offset rather than floored at zero, which is the conservative treatment.",
        ],
        nextSteps: ["Document the yardstick's comparability and test for any idiosyncratic shock in the benchmark", "Derive the incremental margin from cost behaviour rather than the reported margin", "Run the second method (before-and-after or market share) and reconcile the results"],
      };
    },
  },
];

export const CONSULTANT_PACK: ToolDef[] = [...WORKFLOWS, ...CALCULATORS, ...CALCULATORS_B, ...CALCULATORS_C, ...CALCULATORS_D];
