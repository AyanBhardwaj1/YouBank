/**
 * student tool pack: recruiting logistics, graded interview prep, and the teaching versions of every core
 * finance calculation. Authored from docs/research/students-and-public-markets.md (PART A: the 60 technical
 * questions, the A2 recruiting timelines, the A3 syllabus, the A6 top-10 features) with method detail from
 * docs/research/banker-ma-coverage.md section 5. See packs/core.ts for the reference implementation.
 *
 * House rule for this pack: every tool teaches. Define the term, show the arithmetic with the numbers
 * substituted in, then give the interview-length answer and the follow-up that comes next.
 */
import { fmt, list, num, parseCsv, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* Specialty strings copied verbatim from src/lib/roles.ts (role "student"). */
const IB = "Investment banking", CONSULT = "Consulting", PEVC = "Private equity / VC", ERHF = "Equity research / hedge funds", CORP = "Corporate finance", ACCT = "Accounting", UND = "Undecided";
const TRACKS = [IB, CONSULT, PEVC, ERHF, CORP, ACCT, UND];
const CLASS_YEARS = ["Freshman", "Sophomore", "Junior", "Senior", "Master's", "MBA year 1", "MBA year 2"];

/** Appended to every teaching method so the pack stays consistent. */
const TEACH = `TEACHING RULES: define every term the first time it appears; show each calculation as an equation with the numbers substituted in, not just the answer; close the relevant block with an "In an interview" line giving the 30-60 second spoken version; and name the follow-up question an interviewer asks next. A student must be able to redo the arithmetic on paper from what you wrote.`;

/* ======================================================================================
 * AI workflows: the research's top 10
 * ====================================================================================== */

const technicalDrill: ToolDef = {
  kind: "ai", id: "technical-drill", title: "Technical drill engine", tagline: "Graded question sets by topic and difficulty, with a weak-topic map.",
  description: "Generates an interview-grade drill set across accounting, enterprise value, valuation, DCF, merger models, LBO and markets at the difficulty of the round you are preparing for, with model answers that show the arithmetic. Paste your own answers and it grades them topic by topic against the model answers and tells you what to repeat tomorrow.",
  roles: ["student"], specialties: [IB, PEVC, ERHF, CORP, ACCT, UND], category: "Learning", icon: "GraduationCap", deliverable: "quiz", savesMinutes: 90, tags: ["interview", "drills", "grading"],
  fields: [
    { key: "topics", label: "Topics", type: "multiselect", required: true, options: ["Accounting", "Enterprise & equity value", "Valuation & comps", "DCF", "Merger model", "LBO", "Markets & pitching", "Brain teasers"], default: ["Accounting", "Enterprise & equity value", "DCF"] },
    { key: "difficulty", label: "Difficulty", type: "select", options: ["Screening", "First round", "Superday", "PE modeling test"], default: "First round" },
    { key: "count", label: "Questions", type: "number", default: 8, min: 4, max: 20 },
    { key: "ticker", label: "Anchor company (optional)", type: "ticker", placeholder: "AAPL", help: "Some questions will use this company's real figures so you can check them" },
    { key: "answers", label: "Your answers (optional)", type: "textarea", placeholder: "1. Depreciation is non-cash, so...", help: "Number them to match. Leave empty to get a self-mark rubric instead" },
  ],
  example: { topics: ["Accounting", "Enterprise & equity value", "DCF"], difficulty: "First round", count: 8, ticker: "AAPL", answers: "1. Depreciation rises 10, so operating income falls 10, net income falls 6 at 40% tax, and cash goes up 4 because you add back the full 10.\n2. Enterprise value is market cap plus debt minus cash. You subtract cash because the buyer gets it." },
  effort: "medium", tools: ["get_company_financials", "get_xbrl_series", "search_filing", "read_filing", "calc"],
  instructions: `QUESTION BANK (these buckets mirror the 60-question research bank; draw from them, do not invent a new syllabus):
- Accounting: the three statements and how they link; a $10 rise in depreciation at a stated tax rate; AR versus deferred revenue; working capital and why negative working capital can be a good sign; capitalize versus expense; DTL versus DTA; goodwill and impairment; debt-funded capex; a cash inventory purchase; which single statement you would pick to judge health (the cash flow statement) and which two (income statement plus balance sheet, because the cash flow statement can be derived from them).
- Enterprise & equity value: both definitions and the bridge (equity value = price x diluted shares; EV = equity value + debt + preferred + non-controlling interest - cash); why strictly only excess cash is subtracted; why NCI is added (consolidated revenue and EBITDA include 100% of the subsidiary, so EV must reflect 100% of its capital); whether EV can be negative (yes, when cash exceeds market cap plus debt, while public equity value cannot); which metric pairs with which value (EV with revenue, EBITDA and EBIT; equity value with net income, book value and levered FCF); a $100 stock issuance held in cash (equity value +100, EV unchanged); the treasury stock method.
- Valuation & comps: the three methodologies; why they cannot be ranked mechanically but precedents usually sit highest on the control premium; how to pick 5-10 peers; premium drivers (growth, margins, ROIC, moat, scarcity); EV/EBITDA versus EV/revenue; why a bank is valued on P/E and price to tangible book rather than EV/EBITDA; the football field.
- DCF: the walk-through; unlevered FCF = EBIT x (1 - t) + D&A - capex - increase in NWC; WACC = E/V x Ke + D/V x Kd x (1 - t); CAPM; unlevering and relevering beta with beta_L / (1 + (1 - t) x D/E); terminal value by Gordon growth (g at or below long-run nominal GDP, roughly 2-3%) versus exit multiple, each cross-checked against the other, with terminal value typically 60-80% of EV; the mid-year convention (discount at t - 0.5); when a DCF does not work (early-stage, banks and insurers); the levered DCF.
- Merger model: the walk-through; the rule of thumb (all-stock deals are accretive when the buyer's P/E exceeds the seller's; cash or debt deals when the seller's after-tax earnings yield beats the after-tax cost of the funding); synergy valuation; purchase accounting write-ups, the deferred tax liability and residual goodwill; asset versus stock deals and 338(h)(10); the financing cost ranking (cash cheapest, then debt, then stock); why accretion is not the same as value creation.
- LBO: the walk-through; why leverage lifts returns (less equity funds the same asset, cash flow repays debt, interest is tax-deductible); the ideal candidate; the paper LBO; sources and uses; the tranche stack (revolver, term loan A/B, senior and subordinated notes, mezzanine/PIK); IRR versus MOIC; the three value-creation levers (EBITDA growth, multiple expansion, deleveraging).
- Markets & pitching: pitch a stock in 60-90 seconds; the current 10-year Treasury, fed funds and S&P levels (the question tests habit, not precision); a recent deal; how to value a company with no revenue.
- Brain teasers: clock angles (1:45 is 142.5 degrees - 120 for four hour marks plus 22.5 of hour-hand drift); the averaging trap (60 miles at 30 mph then any speed cannot average 60 mph over 60 miles, because the two hours are already spent).
METHOD: 1. Pick questions covering every selected topic, weighted to the difficulty: "Screening" is definitions plus one-step arithmetic; "First round" is two-step arithmetic plus one follow-up; "Superday" is multi-step with a trap (negative EV, NCI, out-of-the-money options, no EBITDA, a stub period); "PE modeling test" is paper-LBO and accretion arithmetic against the clock. 2. If a ticker is given, call get_company_financials and build at least three questions on its real figures (actual D&A, net debt, diluted share count, EV and multiples) so the student can verify them; use get_xbrl_series with find when you need a specific tag such as "Deferred|Lease". 3. Run every calculation through calc and show the substituted equation inside the answer.
PRODUCE, in order: callout naming the topics, the question count and how long the set should take; qa with one item per question where q is phrased exactly as an interviewer would ask it and a is the model answer in 60-100 words (arithmetic first, then one sentence of intuition, then the trap); score with one item for every selected topic and no gaps - grade a topic 0-5 against the model answers where the student answered it, noting exactly what was missing or wrong, and for any topic they did not reach, score its expected difficulty 0-5 and put "self-mark" in the note, so a partial answer set still returns a complete rubric; table "Weak-topic map" (Topic, Questions, Result, What to review, Syllabus stage); bullets "Repeat tomorrow" naming the specific questions. Keep caveats to at most three short lines: the source key, one comparability note, and which figures are practice assumptions rather than reported numbers. ${TEACH}`,
  prompt: (i) => `Build a ${str(i, "difficulty", "First round")} drill of ${num(i, "count", 8)} questions on ${list(i, "topics").join(", ") || "accounting and valuation"}${str(i, "ticker") ? `, anchored on ${str(i, "ticker").toUpperCase()}'s real figures` : ""}.${str(i, "answers") ? ` Grade the answers below against your model answers.\n\nMy answers:\n${str(i, "answers")}` : " I have not answered yet, so give me a self-mark rubric."}`,
};

const mockInterview: ToolDef = {
  kind: "ai", id: "mock-interview-prep", title: "Mock interviewer", tagline: "A full interview with escalating pushback, a scored rubric, and three fixes.",
  description: "Role-plays the interviewer for the round you name - phone screen, superday technical, fit, deal discussion, PE headhunter screen or hedge fund PM - and writes the session out in full: every question, the pushback that follows a weak answer, the model answer, and rubric scores on structure, accuracy, concision and presence. Paste your own answers to be graded instead.",
  roles: ["student"], specialties: TRACKS, category: "Learning", icon: "MessageSquare", deliverable: "quiz", savesMinutes: 120, tags: ["mock interview", "rubric", "pushback"],
  fields: [
    { key: "mode", label: "Round", type: "select", required: true, options: ["Phone screen (30 min)", "Superday technical", "Fit / behavioral", "Deal discussion", "PE headhunter screen", "Hedge fund PM", "Consulting personal experience"], default: "Superday technical" },
    { key: "firm", label: "Firm and group", type: "text", required: true, placeholder: "Evercore, Technology M&A" },
    { key: "track", label: "Target track", type: "select", options: TRACKS, default: IB },
    { key: "resume", label: "Your background", type: "textarea", placeholder: "Junior at a non-target, 3.8 GPA, summer at a boutique doing sell-side healthcare..." },
    { key: "answers", label: "Your answers (optional)", type: "textarea", help: "Paste answers to be graded instead of given model answers" },
  ],
  example: { mode: "Superday technical", firm: "Evercore, Technology M&A", track: IB, resume: "Junior at a non-target, 3.8 GPA finance major, summer analyst at a 20-person tech boutique where I spread comps and drafted two CIM sections on a $300mm SaaS sale, president of the investment club, one long pitch on SNOW.", answers: "" },
  effort: "medium",
  instructions: `1. Build the session to the real shape of the round: a 30-minute phone screen is 2 minutes of resume walk, 3 fit questions, 5 technicals and 2 questions for the interviewer; a superday technical is 12-15 technicals with no small talk and two traps; a deal discussion is one deal taken apart for 10 minutes (parties, price, multiple, rationale, financing, and your view of whether it creates value); a PE headhunter screen is 30 minutes of why-PE, fund preferences, deal inventory and timeline pressure with no technicals; a hedge fund PM round is one long pitch plus three rounds of pushback on the variant view and the sizing; a consulting personal-experience interview is two stories examined for ownership and measurable result.
2. Read the background field and aim at least four questions directly at it, including the two weakest points (non-target school, unquantified experience, a gap, a low-brand internship) phrased the way an interviewer would actually raise them.
3. Call web_research once for the firm and group named - recent deals, group reputation, what they publish about culture - and use it in the "why this firm" model answer. Use edgar_fulltext_search with the firm's name in quotes and forms ["DEFM14A","8-K"] to name one real mandate rather than a generic compliment.
4. Escalate. Every technical gets a level-2 follow-up ("where does that number come from?") and the two most important get a level-3 ("your answer implies X - is that what you meant?"). The escalation is the product; do not write a flat list.
PRODUCE: kpis (questions, minutes, hardest topic, the pass bar for this round); qa "Transcript" with each question and either the model answer or, when answers were pasted, the grade plus the corrected version, with follow-ups written inside the answer as "Follow-up:" lines; score on Structure, Technical accuracy, Concision, Firm knowledge and Presence out of 5 each with notes; bullets "Three fixes before the real thing" - exactly three, each specific and doable in a day; checklist "Questions to ask them" with 5 items. ${TEACH}`,
  prompt: (i) => `Run a ${str(i, "mode")} mock interview for ${str(i, "firm")} on the ${str(i, "track", IB)} track.${str(i, "resume") ? `\n\nMy background: ${str(i, "resume")}` : ""}${str(i, "answers") ? `\n\nGrade these answers:\n${str(i, "answers")}` : ""}`,
};

const recruitingCalendar: ToolDef = {
  kind: "ai", id: "recruiting-calendar", title: "Recruiting calendar & tracker", tagline: "Dated deadlines for your class year and track, plus a pipeline board.",
  description: "Turns the recruiting cycle into a dated calendar for your class year and target tracks - IB summer analyst waves, PE on-cycle, consulting deadlines, hedge fund autumn windows, CFA sittings - refreshed against the firms you name. Outputs a timeline from today forward, a firm-by-firm pipeline table, and this week's actions.",
  roles: ["student"], specialties: TRACKS, category: "Learning", icon: "Calendar", deliverable: "checklist", savesMinutes: 150, tags: ["timeline", "deadlines", "tracker"],
  fields: [
    { key: "tracks", label: "Target tracks", type: "multiselect", required: true, options: TRACKS, default: [IB] },
    { key: "classYear", label: "Class year", type: "select", required: true, options: CLASS_YEARS, default: "Sophomore" },
    { key: "gradDate", label: "Graduation", type: "date", default: "2029-05-01" },
    { key: "firms", label: "Firms on your list", type: "text", placeholder: "Goldman Sachs, Evercore, Houlihan Lokey", help: "Comma separated; each gets a pipeline row" },
    { key: "status", label: "Where you are", type: "textarea", placeholder: "Applied to 12 banks, one HireVue done, no first rounds yet." },
  ],
  example: { tracks: [IB, PEVC], classYear: "Sophomore", gradDate: "2029-05-01", firms: "Goldman Sachs, Evercore, Houlihan Lokey, Piper Sandler, Jefferies", status: "Applied to five early-insight programmes, nothing back yet. No finance internship yet." },
  effort: "medium",
  instructions: `BASE DATASET (researched 2026-09-20; this is the starting calendar, and you refresh it before answering):
- IB summer analyst: the summer-2027 cycle opened with PwC and Alvarez & Marsal in August 2025, ran a large wave in November-December 2025 (RBC, BMO, Houlihan Lokey, Citadel, then JPMorgan, UBS, Lazard, Barclays, Jefferies) and added Goldman Sachs, Evercore, Bain Capital and Ares in January 2026. As of 1 September 2026 the Adventis tracker showed 180 firms, 113 posted, 67 still to come and 22+ expected that month (Piper Sandler, GTCR, Cantor). The summer-2028 cycle repeats that shape one year later: first postings August-October 2026, the main wave November 2026-January 2027, peak screens and superdays January-March 2027, then middle-market and boutique postings through summer 2027. Postings stay open from two weeks to six months. Screens are HireVue, Suited or Pymetrics; superday offers can arrive within 24 hours. Sophomore-fall programmes are open now: early insight, Spring Insight and Sophomore Summit at Bank of America, Goldman Sachs, JPMorgan, Morgan Stanley and UBS, lasting one day to two weeks and often feeding early superdays or direct conversion. A finance-adjacent sophomore summer is now a hard prerequisite. Accelerated full-time interviews for non-returners run August-October of senior year.
- PE on-cycle: the 2026 on-cycle for associates starting in 2028 launched August-October 2026, roughly 6-9 weeks after first-year analysts started. Headhunters build lists in July-August and run intro calls late August-September; each fund uses one exclusive firm (CPI, Dynamics Search Partners, SG Partners, Henkel). First call to signed offer can be under 72 hours with exploding deadlines. Stages: 30-minute headhunter screen, first round (behavioural plus a paper LBO or accretion/dilution), a 1-3 hour Excel modeling test or a 24-72 hour take-home, a case study with 30-60 minutes of pushback, then the partner round. Off-cycle middle-market, growth and upper-middle-market funds recruit year-round on 4-8 week timelines and are a growing share of hiring.
- Consulting (undergraduate): network January-April; MBB applications open June-July with deadlines July-September (BCG summer associate deadlines were 23 June and 3 September 2026; McKinsey's full-time business analyst deadline was 11 August 2026; L.E.K.'s pre-MBA programmes closed 6 June 2026); interviews August-October; offers September-November with 1-2 week acceptance windows. Big 4, Oliver Wyman, Kearney and EY-Parthenon run rolling processes. MBA: applications open August-September, full-time deadlines cluster in September and internship deadlines in November, interviews October-December, offers into January. Formats: an online assessment, then two or three case rounds (interviewer-led at McKinsey, candidate-led at Bain, mixed at BCG) plus a personal-experience interview. Start prep 9-12 months out; most candidates over-prepare cases and under-prepare behavioural stories.
- Equity research: unstructured and as-needed - seats open when an associate leaves. Phone or video first round, superday, then a modeling test or written case. Bring one buy and one hold/sell pitch, and avoid names the interviewer covers.
- Hedge funds: Point72 Academy applications open in the autumn and are read on a rolling basis; the 2027 cycle requires graduation between December 2027 and July 2028; four stages (resume screen, word-limited questionnaire, case study with a stock pitch and original models, then several 30-minute PM and analyst interviews); 2027 intern base pay is $120,000-$140,000 annualised, feeding an 8-week internship and a 10-month associate programme. Citadel and Balyasny run autumn early-career windows. Roughly 80% of lateral hedge-fund hiring is off-cycle and moves in 1-2 weeks once it starts.
- Corporate finance / FLDP: recruiting sits far closer to the start date than IB and the interviews are accounting-heavy.
- CFA: exam windows in February, May, August and November; Level I in all four, Level II in May, August and November, Level III in February and August. Fees run $1,140 early to $1,490 standard for Levels I-II and $1,240/$1,590 for Level III; the one-time enrollment fee was eliminated in February 2026; total programme cost $3,520-$4,570; $250 to reschedule. CFA Institute Research Challenge: local rounds early in the calendar year, sub-regionals in March, regional semifinals 6-7 April 2027, regional finals 8-9 April 2027, global final the week of 10 May 2027 in Singapore.
METHOD: 1. Map the class year and graduation date to the right cycle before anything else - a sophomore today is recruiting for summer 2028, a junior for summer 2027 and should be applying to whatever is still open this month, an MBA1 to the September and November deadlines. State the mapping in one line. 2. Call web_research once per named firm ("<firm> summer analyst 2028 application open") and once for the track overall to catch anything that has moved since the base dataset; mark each row "confirmed" with a source or "expected" from the pattern above. 3. Use calc for days-remaining arithmetic against today's date.
PRODUCE: callout with the single most urgent item and the days left; timeline of every dated event from today forward in ISO dates, tone "warn" inside 30 days and "info" beyond a quarter, each with detail naming what to submit; table "Firm pipeline" (Firm, Programme, Opens, Deadline, Stage reached, Next action, Confirmed?) with one row per named firm; checklist "This week" with 5-7 dated items; bullets "What moves next quarter". Never present an expected date as confirmed.`,
  prompt: (i) => `I am a ${str(i, "classYear", "Sophomore")} graduating ${str(i, "gradDate", "2029")} targeting ${list(i, "tracks").join(" and ") || "investment banking"}. Build my recruiting calendar and pipeline.${str(i, "firms") ? ` Firms: ${str(i, "firms")}.` : ""}${str(i, "status") ? `\n\nWhere I am: ${str(i, "status")}` : ""}`,
};

const stockPitch: ToolDef = {
  kind: "ai", id: "stock-pitch-builder", title: "Stock pitch builder", tagline: "A defensible long or short from live filings, with a consensus-vs-you table.",
  description: "Builds the interview stock pitch from SEC data and the comps engine: a recommendation with price target and horizon, two or three thesis points that each assert something the market has wrong, dated catalysts from the 8-K calendar, a base/bull/bear valuation, risks with mitigants, and a 90-second spoken script. Its core is the consensus-versus-you table interviewers push on.",
  roles: ["student"], specialties: [ERHF, PEVC, IB, UND], category: "Research", icon: "TrendingUp", deliverable: "memo", savesMinutes: 240, tags: ["stock pitch", "thesis", "catalysts"],
  fields: [
    { key: "ticker", label: "Ticker", type: "ticker", required: true, placeholder: "NKE" },
    { key: "direction", label: "Direction", type: "select", options: ["Long", "Short"], default: "Long" },
    { key: "horizon", label: "Horizon", type: "select", options: ["6 months", "12 months", "18-24 months"], default: "12 months" },
    { key: "format", label: "Format", type: "select", options: ["90-second interview pitch", "Two-page research memo", "Hedge fund case study"], default: "90-second interview pitch" },
    { key: "peers", label: "Peers (optional)", type: "tickers", placeholder: "DECK ONON SKX LULU" },
  ],
  example: { ticker: "NKE", direction: "Long", horizon: "12 months", format: "90-second interview pitch", peers: ["DECK", "ONON", "SKX", "LULU"] },
  effort: "high",
  instructions: `1. Call get_company_financials for the ticker: record LTM revenue and growth, gross and operating margin, FCF, net debt, market cap, EV and the multiples returned.
2. Call get_trading_comps with the given peers, or with 4-6 peers you pick and justify by business model, size and buyer universe; record the peer median EV/LTM revenue and EV/LTM EBITDA and where the subject sits against them. A median needs at least three peers with a usable (positive, disclosed) denominator: with fewer, report the median as "n/a - insufficient peer data" and pitch on the metrics that are available rather than printing a two-name median. Note any peer whose fiscal year end differs from the subject, because the set is not calendarised.
3. Call search_filing on the latest 10-K for "competition" and "risk factors", and on the latest 10-Q for "results of operations" and "guidance" or "outlook"; expand the two most important hits with read_filing. Pull the company's own KPI language - units, comparable sales, ARR, net revenue retention, backlog, whatever it actually reports.
4. Call get_recent_filings with forms ["8-K"] and use the returned item codes to pick events: 2.02 results, 7.01 Reg FD, 8.01 other, 5.02 officer changes, 1.01 material agreements. Read at most two 8-K documents, and only where the item code indicates a dated forward event; take everything else from the filing index rather than opening each document. Only put a date in the catalyst timeline if a filing or the company states it - write "expected, not confirmed" otherwise.
5. Call web_research once for consensus expectations and the current bear case, so the consensus column is sourced rather than assumed.
6. Do every multiple, growth rate and implied price with calc.
PRODUCE in this order: kpis (last price, market cap, EV, EV/LTM EBITDA versus peer median, LTM revenue growth, FCF margin); callout with the recommendation in one sentence - direction, price target, horizon and the percentage upside or downside from the last price; markdown "Background" in two sentences only (what it sells, how it charges); bullets "Thesis" with two or three points, each asserting something the market has wrong, each carrying the filing evidence and the number that proves it; table "What consensus assumes vs what you assume" (Driver, Consensus or market-implied, Your assumption, Why you differ, Source) with at least four drivers - this table is the pitch; timeline "Catalysts" using real dates from the 8-Ks and the filing calendar; table "Valuation" with base, bull and bear rows (Case, Revenue, EBITDA or EPS, Multiple, Implied value per share, Return) naming where each multiple comes from; risks with three items, each with a mitigant and the observable level at which the thesis is wrong; markdown "90-second script" written as spoken words in the order recommendation, background, thesis, catalysts, valuation, risk, about 200 words.
If the company is unprofitable, pitch on EV/revenue and gross profit and say why. If a figure is not disclosed, write "not disclosed" rather than estimating it. For a short, state the borrow and squeeze risk explicitly. Keep caveats to at most four lines: the as-of dates and fiscal period, any figure where the data feed and the filing disagree (use the filing and say so), how EBITDA was derived, and the fact that the scenario cases are your assumptions rather than guidance. ${TEACH}`,
  prompt: (i) => `Build a ${str(i, "direction", "Long").toLowerCase()} pitch on ${str(i, "ticker").toUpperCase()} over ${str(i, "horizon", "12 months")}, formatted as a ${str(i, "format", "90-second interview pitch")}.${list(i, "peers").length ? ` Peers: ${list(i, "peers").join(", ")}.` : ""}`,
};

const timedModelTest: ToolDef = {
  kind: "ai", id: "timed-model-test", title: "Timed model test generator", tagline: "Randomized paper LBOs and modeling cases with a full answer key.",
  description: "Generates the test you will actually sit: a 10-minute paper LBO, a 10-minute accretion/dilution, a 60-minute three-statement build or a two-hour Excel LBO, with round assumptions you can do in your head, the step order a tester expects, and an answer key showing every intermediate number plus IRR and MOIC.",
  roles: ["student"], specialties: [PEVC, IB, ERHF, CORP], category: "Modeling", icon: "Timer", deliverable: "quiz", savesMinutes: 180, tags: ["paper LBO", "modeling test", "answer key"],
  fields: [
    { key: "testType", label: "Test", type: "select", required: true, options: ["Paper LBO (10 min)", "Paper LBO (hard, 15 min)", "Accretion / dilution (10 min)", "Three-statement build (60 min)", "Excel LBO (2 hours)", "Growth equity case (90 min)"], default: "Paper LBO (10 min)" },
    { key: "difficulty", label: "Level", type: "select", options: ["First round", "Modeling test", "Partner round"], default: "Modeling test" },
    { key: "ticker", label: "Anchor company (optional)", type: "ticker", placeholder: "CMG", help: "Assumptions get scaled to this company's real EBITDA and margins" },
    { key: "minutes", label: "Time limit", type: "number", unit: "minutes", default: 10, min: 5, max: 180 },
  ],
  example: { testType: "Paper LBO (10 min)", difficulty: "Modeling test", ticker: "CMG", minutes: 10 },
  effort: "medium",
  instructions: `1. Choose assumptions round enough to do on paper: EBITDA a multiple of 25, entry and exit multiples in whole or half turns, leverage in whole turns, growth in whole percents, a 25% tax rate. The canonical shape to vary is: $100 EBITDA at 10x = $1,000 EV, 5x debt ($500) and $500 sponsor equity; EBITDA reaches $150 by year 5; exit at 10x = $1,500; $200 of debt repaid leaves $300, so equity is $1,200 - a 2.4x MOIC and about 19% IRR. Do not reuse those exact numbers; move the multiple, the leverage, the growth path or the exit year.
2. If a ticker is given, call get_company_financials and scale the assumptions to its real LTM EBITDA, EBITDA margin and capex intensity, rounding hard; say which figures came from the filing so the student knows the case is grounded.
3. Do the whole answer key with calc: sources and uses, the debt schedule year by year (beginning debt, interest on the beginning balance, cash taxes, free cash flow, sweep, ending debt), exit equity, MOIC and IRR. For a single entry and single exit, IRR = MOIC^(1/years) - 1; sanity-check against the five-year anchors a candidate is expected to have memorised (1.5x is about 8.4%, 2.0x about 15%, 2.5x about 20%, 3.0x about 25%, 5.0x about 38%) and say so.
4. For accretion/dilution: offer price = target price x (1 + premium); new shares = stock consideration / acquirer price; pro forma net income = acquirer + target + after-tax synergies - after-tax new interest - after-tax foregone interest on cash; accretion = pro forma EPS / standalone EPS - 1. Cross-check against the P/E rule of thumb.
5. For a three-statement build, specify the drivers and the schedules required (revenue build, PP&E and D&A, debt and interest, equity roll) and the balance check; for an Excel LBO, list the required tabs and the exact deliverable (a returns table plus a sensitivity grid).
PRODUCE: callout with the time limit, what to produce, and the rule that the student writes their answer before reading on; table "Assumptions" (Item, Value, Unit, Source) and nothing else in that block so it can be read alone; steps "How a tester expects you to work" with the ordered method and a minute budget per step; table "Answer key" with the full schedule, one row per year; kpis (entry EV, sponsor equity, exit equity, MOIC, IRR - or standalone EPS, pro forma EPS and accretion); score "Partial credit" listing what each step is worth out of 100; qa with the four follow-ups a tester asks after the answer (what breaks this, what if the exit multiple compresses a turn, where does the cash go, why is IRR not MOIC divided by years). ${TEACH}`,
  prompt: (i) => `Generate a ${str(i, "testType")} at ${str(i, "difficulty", "Modeling test")} level with a ${num(i, "minutes", 10)}-minute limit${str(i, "ticker") ? `, scaled to ${str(i, "ticker").toUpperCase()}` : ""}. Include the full answer key.`,
};

const modelAuditor: ToolDef = {
  kind: "ai", id: "model-auditor", title: "Model auditor", tagline: "Balance, sign, circularity and sanity checks on your model's outputs.",
  description: "Audits a model you built by reading its output rows: it re-adds every subtotal, ties the cash flow statement to the balance sheet, checks that assets equal liabilities plus equity in every year, hunts sign errors and hard-coded plugs, and tests whether the drivers are even plausible. Returns a ranked issue list naming the line and year to fix.",
  roles: ["student"], specialties: [IB, PEVC, CORP, ACCT], category: "Modeling", icon: "FileSpreadsheet", deliverable: "analysis", savesMinutes: 120, tags: ["audit", "balance check", "model review"],
  fields: [
    { key: "modelType", label: "Model", type: "select", required: true, options: ["Three-statement", "LBO", "DCF", "Merger model", "Operating model"], default: "Three-statement" },
    { key: "outputs", label: "Model output rows", type: "csv", required: true, columns: "line_item,Y1,Y2,Y3,Y4,Y5", help: "Paste your output rows straight from Excel: one row per line item, one column per period" },
    { key: "notes", label: "How it is built (optional)", type: "textarea", placeholder: "Revenue is a price x volume build; interest is on the average debt balance; cash is the plug." },
  ],
  example: {
    modelType: "Three-statement",
    outputs: "line_item,Y1,Y2,Y3,Y4,Y5\nRevenue,1000,1150,1300,1440,1570\nCOGS,-400,-460,-520,-576,-628\nGross profit,600,690,780,864,942\nOperating expenses,-420,-470,-520,-560,-600\nEBIT,180,220,260,304,342\nInterest expense,-30,-28,-25,-22,-18\nPretax income,150,192,235,282,324\nTaxes,-38,-48,-59,-71,-81\nNet income,112,144,176,211,243\nD&A,60,66,72,78,84\nChange in working capital,-25,-28,-30,-32,-34\nCash from operations,147,182,218,257,293\nCapex,-80,-88,-95,-101,-108\nCash from investing,-80,-88,-95,-101,-108\nDebt repayment,-40,-40,-40,-40,-40\nCash from financing,-40,-40,-40,-40,-40\nNet change in cash,27,54,83,116,145\nCash,127,181,264,380,525\nAccounts receivable,120,138,156,173,188\nInventory,90,104,117,130,141\nNet PP&E,520,542,565,588,612\nTotal assets,857,965,1102,1271,1466\nAccounts payable,80,92,104,115,126\nDebt,560,520,480,440,400\nTotal liabilities,640,612,584,555,526\nEquity,205,349,525,736,979\nTotal liabilities and equity,845,961,1109,1291,1505",
    notes: "Revenue grows 15% fading to 9%; interest is 5% on the beginning debt balance; cash is the plug and equity is prior equity plus net income.",
  },
  effort: "high",
  instructions: `1. Parse the pasted rows into line items by period. Recompute every subtotal with calc instead of trusting the pasted one: gross profit = revenue + COGS (signs as pasted), EBIT = gross profit + operating expenses, pretax = EBIT + interest, net income = pretax + taxes, cash from operations = net income + D&A + change in working capital, net change in cash = CFO + CFI + CFF, ending cash = prior cash + net change, total assets = sum of the asset lines, total liabilities and equity = sum of the liability and equity lines. Report the difference for every subtotal that does not tie, in the units given.
2. Run the standard audit list a first-year analyst is graded on (the Macabacus-style model check): (a) balance check - total assets minus total liabilities and equity for every year, flagging any non-zero; (b) cash tie - the balance sheet cash line must equal prior cash plus the cash flow statement's net change; (c) sign conventions - costs, capex, taxes and debt repayments consistently negative, working capital increases shown as cash outflows; (d) effective tax rate = taxes / pretax income each year, flagged when it moves without explanation; (e) implied interest rate = interest / average debt balance, flagged when it drifts; (f) plugs and hard-codes - any line that moves without a driver, and an equity roll that does not equal prior equity plus net income less dividends; (g) circularity risk where interest is computed on an average balance that itself depends on the cash sweep; (h) driver sanity - revenue growth, gross and EBIT margin, capex as a percent of revenue and working capital as a percent of revenue, shown as a trend so a fade or a hockey stick is visible; (i) the PP&E roll - prior net PP&E + capex - D&A should equal closing net PP&E.
3. Where the pasted data cannot support a check, name the missing rows rather than guessing.
PRODUCE: kpis (rows checked, checks run, issues found, the largest balance-sheet break with its year); callout naming the single error that would fail the test; risks "Issue list" where risk is the problem with its exact line and year, severity is high for anything breaking the balance sheet or cash tie, medium for sign and rate drift, low for style, and mitigation is the specific fix; table "Recomputed subtotals" (Line, Year, As pasted, Recomputed, Difference) showing only the lines that differ; table "Driver trends" (Metric, Y1..Yn) for growth, gross margin, EBIT margin, effective tax rate, implied interest rate, capex as a percent of revenue and working capital as a percent of revenue; checklist "Fix in this order". ${TEACH}`,
  prompt: (i) => `Audit my ${str(i, "modelType", "three-statement")} model from the output rows below.${str(i, "notes") ? ` How it is built: ${str(i, "notes")}` : ""}`,
};

const networking: ToolDef = {
  kind: "ai", id: "networking-outreach", title: "Networking email & coffee-chat prep", tagline: "A five-sentence cold email, ten questions, and the follow-up cadence.",
  description: "Drafts the outreach email in the five-sentence structure that actually earns replies, then the ten questions to ask on the call, the notes to take, and the dated follow-up cadence that keeps the contact worth something three months later. Built for volume: at a 10-25% reply rate the cadence matters more than the wording.",
  roles: ["student"], specialties: TRACKS, category: "Communication", icon: "Mail", deliverable: "email", savesMinutes: 45, tags: ["networking", "cold email", "coffee chat"],
  fields: [
    { key: "contact", label: "Contact", type: "text", required: true, placeholder: "VP, Leveraged Finance, Jefferies" },
    { key: "shared", label: "Shared background", type: "text", placeholder: "Same university, both in the investment club" },
    { key: "ask", label: "The ask", type: "select", options: ["Coffee chat", "15-minute informational call", "Referral for a posting", "Thank-you follow-up", "Re-engage after months of silence"], default: "15-minute informational call" },
    { key: "track", label: "Your target", type: "select", options: TRACKS, default: IB },
    { key: "about", label: "About you", type: "textarea", placeholder: "Sophomore, finance major, built a DCF on CMG for the investment club, want technology M&A." },
  ],
  example: { contact: "VP in Leveraged Finance at Jefferies, alum of my school", shared: "Same university and both were in the student investment fund", ask: "15-minute informational call", track: IB, about: "Sophomore finance major, 3.8 GPA, built a comps set and a DCF on CMG for the investment fund, targeting technology or sponsors coverage." },
  effort: "low", tools: ["web_research", "calc"],
  instructions: `1. Write the email to the five-sentence structure the research identifies as the working template: (1) who you are in one line - school, year and what you are recruiting for; (2) the specific, verifiable connection - shared club, school, hometown, a deal their group did, something they wrote; (3) one line of evidence that you have already done the work (a model, a pitch, a prior internship) rather than a claim of being passionate; (4) the ask, small and time-boxed - 15 minutes, two or three suggested windows, offer to work around them; (5) an easy out and a thank you. Subject line under 50 characters, no adjectives, no attachments unless asked, total under 120 words.
2. Call web_research once for the firm and group in the contact field so sentence 2 rests on something real - a recent mandate, a fund close, a sector the group is known for. If nothing verifiable comes back, fall back to the shared background and say so; never invent a deal or a person's history.
3. Set the cadence from the evidence: 2-3 attempts spaced 7-10 business days, then move the contact to a 4-6 month touch; expect 10-25% replies, so the pipeline needs volume and every send needs a follow-up date attached. A thank-you goes out within 24 hours of any call and repeats one specific thing they said.
PRODUCE: email block with the subject and body ready to send, addressed to the contact's role; bullets "Why this email works" mapping each sentence to its job so the student can write the next fifty alone; bullets "Ten questions for the call" - specific to their seat and seniority, none answerable from the firm's website, at least three about how the work actually gets done and one about what they would do differently; checklist "Follow-up cadence" with dated items counted from today (send, first follow-up, second follow-up, thank-you, four-month touch); callout with the three things that get a student blacklisted (asking for a job in the first email, mass blind-copying, skipping the thank-you); a second email block "Thank-you note". ${TEACH}`,
  prompt: (i) => `Draft a ${str(i, "ask", "15-minute informational call").toLowerCase()} outreach to ${str(i, "contact")}.${str(i, "shared") ? ` Shared background: ${str(i, "shared")}.` : ""} I am targeting ${str(i, "track", IB)}.${str(i, "about") ? `\n\nAbout me: ${str(i, "about")}` : ""}`,
};

const learningPath: ToolDef = {
  kind: "ai", id: "learning-path", title: "Learning path generator", tagline: "A week-by-week syllabus for the hours you actually have.",
  description: "Turns the accounting-to-valuation-to-modeling-to-LBO-to-M&A syllabus into a dated weekly plan sized to your track, your starting level and the hours you can give it, with a practice deliverable and a checkpoint test for every stage. When the deadline is too close for the full path it says which stages get cut and why.",
  roles: ["student"], specialties: TRACKS, category: "Learning", icon: "Compass", deliverable: "checklist", savesMinutes: 90, tags: ["syllabus", "study plan", "curriculum"],
  fields: [
    { key: "track", label: "Target track", type: "select", required: true, options: TRACKS, default: IB },
    { key: "weeks", label: "Weeks available", type: "number", required: true, default: 8, min: 1, max: 40 },
    { key: "hours", label: "Hours per week", type: "number", required: true, default: 6, min: 2, max: 40 },
    { key: "level", label: "Starting point", type: "select", options: ["No finance background", "Some coursework", "Finished a modeling course", "Had a finance internship"], default: "Some coursework" },
    { key: "gaps", label: "Known weak spots", type: "text", placeholder: "Deferred taxes, LBO debt schedules, mental math" },
  ],
  example: { track: IB, weeks: 8, hours: 6, level: "Some coursework", gaps: "deferred taxes, LBO debt schedules, talking through a DCF out loud" },
  effort: "medium", tools: ["calc"],
  instructions: `SYLLABUS (from the research; hours are full-path estimates). Stage 0 Excel and formatting, 5h - keyboard-only navigation, blue inputs and black formulas, chart and table conventions; output: rebuild a comps table with no mouse. Stage 1 Accounting, 15-20h - the three statements and their linkages, working capital, D&A, deferred taxes, SBC, leases, goodwill and impairment, NCI and equity-method investments; output: walk any $10 change through the statements in under 60 seconds. Stage 2 Enterprise and equity value, 5h - the bridge, treasury stock method, which metric pairs with which value, negative EV, ranking multiples; output: compute EV for ten companies from filings. Stage 3 Valuation, 15h - trading comps, precedent transactions, DCF with WACC, CAPM, beta relevering, terminal value and the mid-year convention, the football field; output: a comps sheet plus a DCF with sensitivities. Stage 4 Three-statement model, 10h - revenue build, margins, PP&E, debt and equity schedules, balancing with no plugs; output: a 30-90 minute timed build. Stage 5 LBO, 15h - paper LBO, sources and uses, tranches, cash sweep, IRR and MOIC, the value-creation bridge; output: a paper LBO in 10 minutes and a two-hour Excel LBO. Stage 6 M&A, 10h - accretion/dilution, purchase accounting, synergies, consideration mix, asset versus stock and 338(h)(10), process and documents; output: a merger model with contribution analysis. Stage 7 Sector knowledge, ongoing - SaaS (ARR, NRR, Rule of 40), healthcare, FIG (P/TBV, ROE), energy (EV/EBITDAX), REITs (FFO, NAV); output: a one-page sector primer. Stage 8 Markets and pitching, 10h - pitch structure, catalysts, risk/reward skew, current levels; output: two 90-second pitches, one long and one short. Stage 9 Behavioural, 10h - resume walk-through, why banking, why this firm, deal discussion, the nine usual fit questions; output: a recorded mock with scoring. Stage 10 Consulting cases (consulting track only), 60h+ over 6-9 months - structure, hypotheses, mental math, brainstorming, synthesis, 30-50 practice cases.
METHOD: 1. Compute the budget (weeks x hours) with calc and compare it to what the track needs: IB and PE need stages 0-6 plus 8-9 (about 85-95 hours); equity research and hedge funds need 1-3 and 7-8 heavily plus a written pitch; consulting needs stage 10 as the spine with 1-2 and 8-9 alongside; corporate finance and accounting need 1, 2 and 4 with the accounting depth of stage 1 and not the LBO. Show the arithmetic. If the budget is short, say which stages are cut and why that is the right cut - never pretend a 20-hour budget covers the path.
2. Adjust for the starting point: "No finance background" adds 50% to stage 1; "Finished a modeling course" lets stages 3-5 run at half hours but keeps the timed outputs; "Had a finance internship" moves hours to stages 8-9 and the deal discussion. Front-load the named weak spots.
3. Order matters: never start valuation before the three statements are automatic, and schedule the first mock interview no later than the midpoint so there is time to act on the feedback.
PRODUCE: kpis (hours available, hours the path needs, coverage as a percentage, stages cut); callout stating whether the deadline is realistic and what to drop if not; table "Weekly plan" (Week, Dates, Stage, Topics, Hours, Practice output, Checkpoint) with one row per week using real dates from today; table "Stage budget" (Stage, Full-path hours, Your hours, Why adjusted); checklist "Checkpoints" - the dated tests that prove a stage is done, each naming the YouBank tool to run (technical-drill on that topic, three-statement-impact, paper-lbo-timed, mock-interview-prep); bullets "If you fall behind" with the triage order. ${TEACH}`,
  prompt: (i) => `Build a ${num(i, "weeks", 8)}-week plan at ${num(i, "hours", 6)} hours per week to be interview-ready for ${str(i, "track", IB)}. I am at: ${str(i, "level", "Some coursework")}.${str(i, "gaps") ? ` Weak spots: ${str(i, "gaps")}.` : ""}`,
};

const resumeCoach: ToolDef = {
  kind: "ai", id: "resume-story-coach", title: "Resume bullet & story coach", tagline: "Quantified bullets against the one-page conventions, plus your walk-through script.",
  description: "Lints a finance resume against the one-page conventions recruiters screen on - half-inch margins, reverse chronological, past-tense action verbs, quantified results, no first person - rewrites every weak bullet with numbers and scope, and builds the two-to-three minute chronological 'walk me through your resume' script that opens every interview.",
  roles: ["student"], specialties: TRACKS, category: "Communication", icon: "FileText", deliverable: "memo", savesMinutes: 120, tags: ["resume", "bullets", "story"],
  fields: [
    { key: "resume", label: "Resume text", type: "textarea", required: true, placeholder: "Paste the whole resume as text, including dates and section headers" },
    { key: "track", label: "Target track", type: "select", options: TRACKS, default: IB },
    { key: "target", label: "Target role", type: "text", placeholder: "Summer analyst, technology M&A" },
    { key: "extra", label: "Detail the resume leaves out", type: "textarea", placeholder: "The comps set covered 11 companies and went into a live pitch; the club fund was $250k." },
  ],
  example: {
    resume: "EDUCATION\nState University, BS Finance, GPA 3.8/4.0, expected May 2028. Coursework: Corporate Finance, Financial Accounting.\nEXPERIENCE\nSummer Analyst, Boutique Advisory, Jun 2026 - Aug 2026. Helped with comps and worked on parts of a CIM. Assisted senior bankers with research on companies. Attended client calls.\nInvestment Club, Analyst, Sep 2025 - present. Responsible for pitching stocks to the club. Made a DCF model.\nBarista, Local Coffee, 2024 - 2025. Customer service.\nSKILLS: Excel, PowerPoint, Python (basic), passionate about markets and hard working.",
    track: IB, target: "Summer analyst, technology M&A",
    extra: "The comps set was 11 software companies spread from XBRL and used in a live sell-side pitch; the CIM sections were the market overview and the financial summary; the club fund is $250k and my SNOW pitch was adopted and is up 14%.",
  },
  effort: "medium", tools: ["calc"],
  instructions: `1. Lint against the conventions the sources treat as non-negotiable: exactly one page; 0.5 to 0.55 inch margins; reverse chronological within each section; Education first for students, with GPA out of 4.0; no photo, no objective, no first person, no "responsible for" and no "helped with"; past-tense action verbs; dates right-aligned and formatted consistently; consistent tense and punctuation; a Skills line listing tools rather than adjectives (cut "passionate" and "hard working"); no soft-skill claim without evidence. Quote the exact text that breaks each convention.
2. Rewrite every bullet to the pattern action verb + what you built + the scope in numbers + what it was used for. Every bullet needs at least one number: companies spread, pages drafted, dollars of fund, percent of a task, size of the deal or portfolio. Use the extra-detail field for numbers the resume left out and never invent one - where a number is missing, write the bullet with a bracketed placeholder naming exactly what to look up. Vocabulary matters: "spread comparable companies from SEC filings" beats "did research".
3. Build the walk-through script: strictly chronological, 2-3 minutes spoken (roughly 300-380 words), one sentence per stop, each stop ending in the decision that led to the next, closing on why this track and this firm. Mark where to pause for the interviewer to interrupt.
4. Use calc for any arithmetic in the bullets (percentages, growth, fund returns) so the numbers survive a challenge.
PRODUCE: score on One-page conventions, Quantification, Verb and tense discipline, Relevance to the target and Story arc, out of 5 each, with the specific breach in the note; table "Bullet rewrites" (Section, Original, Rewritten, Why it is stronger) covering every weak bullet; bullets "Cut these lines" with the reason; markdown "Walk me through your resume" as the spoken script with pause markers; qa with the five questions this resume invites and a one-line answer for each, including the uncomfortable one about its weakest line; checklist "Before you send it". ${TEACH}`,
  prompt: (i) => `Lint and rewrite my resume for ${str(i, "target") || str(i, "track", IB)} and build my walk-through script.${str(i, "extra") ? `\n\nDetail the resume leaves out: ${str(i, "extra")}` : ""}\n\nResume:\n${str(i, "resume")}`,
};

const casePartner: ToolDef = {
  kind: "ai", id: "case-interview-partner", title: "Case interview partner", tagline: "A full practice case with exhibits, the math, and a scored synthesis.",
  description: "Runs a consulting case in the firm's own style - interviewer-led at McKinsey, candidate-led at Bain, mixed at BCG - with a real prompt, numeric exhibits, the quantitative question and its worked answer, a MECE structure key, a brainstorm list and a 30-second synthesis, then scores structure, math, insight and communication.",
  roles: ["student"], specialties: [CONSULT, PEVC, UND], category: "Learning", icon: "Presentation", deliverable: "quiz", savesMinutes: 120, tags: ["case interview", "MECE", "synthesis"],
  fields: [
    { key: "style", label: "Firm style", type: "select", required: true, options: ["McKinsey (interviewer-led)", "Bain (candidate-led)", "BCG (mixed)", "Big 4 / Deloitte", "EY-Parthenon / boutique"], default: "Bain (candidate-led)" },
    { key: "caseType", label: "Case type", type: "select", required: true, options: ["Profitability decline", "Market entry", "M&A / commercial due diligence", "Growth strategy", "Pricing", "Cost reduction", "Market sizing", "Operations / capacity"], default: "Profitability decline" },
    { key: "industry", label: "Industry", type: "text", required: true, placeholder: "Athletic footwear retail" },
    { key: "answers", label: "Your structure and answers (optional)", type: "textarea", help: "Paste your framework, math and recommendation to be graded" },
  ],
  example: { style: "Bain (candidate-led)", caseType: "Profitability decline", industry: "Athletic footwear retail", answers: "" },
  effort: "medium", tools: ["calc", "web_research"],
  instructions: `1. Match the format to the style: interviewer-led means you drive the sequence and hand over one question at a time; candidate-led means the candidate chooses the next branch, so the key must show which branch was right and what picking the wrong one would have cost; mixed means a structured opening and a candidate-led middle. Every style ends with a synthesis under time pressure.
2. Write the case as a real client situation with a decision and a number attached: a client, a time frame, the decision, and the metric that settles it. Include two numeric exhibits as table blocks with internally consistent figures (units, price, cost, mix, share) constructed so the answer falls out of a decomposition rather than a guess, and state plainly that the figures are illustrative and built for practice. Call web_research once for the industry's real economics (typical gross margin, channel mix, growth) so the exhibits are not absurd.
3. Structure key: a MECE tree two levels deep. Profitability is profit = (price x volume) - (fixed + variable costs), broken into the drivers the exhibits can actually test; market entry is market attractiveness, competitive position, capability fit and entry economics; due diligence is market growth, share defensibility, unit economics and downside; market sizing needs a top-down and a bottom-up path that reconcile within a stated tolerance.
4. The math is where candidates fail: give one quantitative question with the arithmetic shown line by line through calc, units carried, and the rounding a candidate should use in their head (round to one significant figure, then adjust). State the order of magnitude before the precise answer.
PRODUCE: callout with the case prompt as an interviewer would read it plus the clarifying questions a strong candidate asks; table "Exhibit 1" and table "Exhibit 2" with the data; steps "Expected structure" as the MECE tree, saying what each branch tests; qa "The interview" with each question and the model answer including the worked math; bullets "Brainstorm key" with 6-8 ideas grouped into two or three buckets; markdown "Synthesis" as a 30-second spoken recommendation in the order answer, two reasons, risk, next step; score on Structure, Math accuracy, Business insight, Synthesis and Communication out of 5 with notes - grading the pasted answers when given, otherwise stating what a 5 looks like. ${TEACH}`,
  prompt: (i) => `Run a ${str(i, "style")} ${str(i, "caseType").toLowerCase()} case in ${str(i, "industry")}.${str(i, "answers") ? `\n\nGrade my work:\n${str(i, "answers")}` : " Give me the full answer key."}`,
};

/* ======================================================================================
 * AI workflows: concept explainers grounded in a real company
 * ====================================================================================== */

const accountingExplainer: ToolDef = {
  kind: "ai", id: "accounting-explainer", title: "Accounting concept explainer", tagline: "Any accounting concept, taught on a real company's actual footnote.",
  description: "Explains an accounting concept the way an interviewer expects to hear it, then proves it on a real filing: it finds the company's own footnote, pulls the actual balances from XBRL, walks the entry through all three statements, and ends with the interview-length answer and the follow-up.",
  roles: ["student"], specialties: [ACCT, IB, CORP, ERHF, UND], category: "Accounting & audit", icon: "BookOpen", deliverable: "analysis", savesMinutes: 75, tags: ["accounting", "footnotes", "concepts"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "SNOW" },
    { key: "concept", label: "Concept", type: "select", required: true, options: ["Deferred revenue", "Deferred tax assets & liabilities", "Stock-based compensation", "Operating leases (ASC 842)", "Goodwill & impairment", "Inventory and LIFO/FIFO", "Capitalized software", "Revenue recognition (ASC 606)", "Working capital", "Non-controlling interests", "Equity-method investments", "Accrued liabilities", "Share repurchases & treasury stock"], default: "Deferred revenue" },
    { key: "depth", label: "Depth", type: "select", options: ["Interview answer", "Class-level detail", "Both"], default: "Both" },
  ],
  example: { ticker: "SNOW", concept: "Deferred revenue", depth: "Both" },
  effort: "medium",
  instructions: `1. Call get_company_financials for context (size, fiscal year end, business model), because the concept means different things at a subscription company than at a retailer.
2. Call search_filing on the latest 10-K with the phrases the filer actually uses for the concept - "deferred revenue" or "contract liabilities" and "remaining performance obligations"; "deferred tax assets" and "valuation allowance"; "stock-based compensation" and "unrecognized compensation cost"; "operating lease" and "right-of-use asset" and "weighted-average discount rate"; "goodwill" and "reporting unit" and "impairment"; "inventories" and "first-in, first-out"; "capitalized" and "internal-use software"; "revenue recognition" and "performance obligation"; "non-controlling interest"; "equity method". Expand the two best hits with read_filing so you quote the company's own words.
3. Call get_xbrl_series with find set to a regex for the concept ("Deferred|Contract", "IncomeTax|Valuation", "ShareBasedCompensation", "Lease", "Goodwill|Impairment", "Inventory", "NoncontrollingInterest") and then pull 4-6 periods of the tags that matter, so the reader sees the balance trend rather than one number. Values come back in raw units - convert to millions with calc and say so.
4. Walk the mechanics: the journal entry in plain words, then the effect on each statement in order (income statement, cash flow statement, balance sheet) with the sign of each line, then the balance check. Name the GAAP reference where one applies (ASC 606 revenue, ASC 842 leases, ASC 350 goodwill, ASC 718 stock compensation, ASC 740 income taxes).
PRODUCE: kpis (the company's actual balances for this concept, the latest period and the change); markdown "What it is" (definition in three sentences, no jargon left undefined); table "On the statements" (Statement, Line, Direction, Why) covering the full entry; line or columns chart of the balance over the periods you pulled; markdown "In this company's own words" quoting the footnote with the citation; qa "What an interviewer asks" with four questions and model answers, one of which must be the classic trap for this concept (deferred revenue is a liability, not revenue; a DTL is not a cash obligation today; SBC is non-cash but real dilution; operating leases moved on-balance-sheet but rent stays in EBITDA only if you do not capitalise them). ${TEACH}`,
  prompt: (i) => `Teach me ${str(i, "concept")} using ${str(i, "ticker").toUpperCase()}'s real filing. Depth: ${str(i, "depth", "Both")}.`,
};

const dcfWalkthrough: ToolDef = {
  kind: "ai", id: "dcf-walkthrough", title: "Walk me through a DCF", tagline: "The whole answer built on one real company's numbers.",
  description: "Answers the most common technical question with an actual company: pulls the real revenue, margins, D&A and capex, builds unlevered free cash flow line by line, builds WACC from CAPM with relevered beta, values the terminal year both ways, bridges to equity value per share, and then compresses the whole thing into the 60-second spoken answer.",
  roles: ["student"], specialties: [IB, PEVC, ERHF, CORP], category: "Valuation", icon: "Calculator", deliverable: "analysis", savesMinutes: 120, tags: ["DCF", "WACC", "terminal value"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "CMG" },
    { key: "years", label: "Projection years", type: "number", default: 5, min: 3, max: 10 },
    { key: "terminal", label: "Terminal value method", type: "select", options: ["Gordon growth", "Exit multiple", "Both, cross-checked"], default: "Both, cross-checked" },
  ],
  example: { ticker: "CMG", years: 5, terminal: "Both, cross-checked" },
  effort: "high",
  instructions: `1. Call get_company_financials: record LTM revenue, prior revenue, operating income, D&A, capex, operating cash flow, net income, cash, debt, shares out, price and market cap. Call get_xbrl_series for 6 periods of revenue and operating income so the growth path is observed rather than assumed.
2. Call search_filing on the latest 10-K for "liquidity and capital resources" and on the latest 10-Q for "outlook" or "guidance" to source the near-term growth and margin assumptions; state which assumption came from which sentence.
3. Build unlevered free cash flow explicitly: UFCF = EBIT x (1 - tax) + D&A - capex - increase in net working capital. Show the formula once, then the table. Use a 25% marginal rate unless the filing's effective rate is materially different, in which case use the filing's rate and say so.
4. Build WACC from parts: risk-free rate from the 10-year Treasury (say the level you are using and the date), cost of equity via CAPM = rf + beta x equity risk premium with an ERP of 5-6%, beta unlevered from peers with beta_L / (1 + (1 - t) x D/E) and relevered at this company's structure, after-tax cost of debt = pre-tax yield x (1 - t), then weight by market values of equity and debt. Every step through calc.
5. Terminal value: Gordon growth = final-year FCF x (1 + g) / (WACC - g) with g at or below long-run nominal GDP (2-3%), and exit multiple = final-year EBITDA x multiple taken from the trading comps. Cross-check each against the other - report the multiple implied by the perpetuity and the growth implied by the exit multiple - and report terminal value as a percent of enterprise value, flagging it if it is outside the usual 60-80%.
6. Discount with the mid-year convention (period t discounted at t - 0.5, which lifts present value roughly 6-7% at typical WACCs) and say why: cash arrives through the year, not on the last day.
PRODUCE: kpis (WACC, implied EV, implied equity value per share, current price, upside/downside, terminal value as a percent of EV); table "Unlevered free cash flow" with one row per projection year and every line of the formula as a column; waterfall "EV to equity value" (PV of forecast FCF, PV of terminal value, enterprise value, less debt, plus cash, equity value); sensitivity of value per share on WACC x terminal growth; table "WACC build" (Component, Value, Source); markdown "The 60-second answer" as spoken words; bullets "Where this DCF is fragile" naming the two assumptions that move the answer most. ${TEACH}`,
  prompt: (i) => `Walk me through a DCF on ${str(i, "ticker").toUpperCase()} with real numbers, ${num(i, "years", 5)} projection years, terminal value by ${str(i, "terminal", "Both, cross-checked")}.`,
};

const evEquityExplainer: ToolDef = {
  kind: "ai", id: "ev-equity-explainer", title: "EV vs equity value explainer", tagline: "The bridge built on one company, including the diluted share count.",
  description: "Builds the enterprise-to-equity bridge on a real company from its cover-page share count, option disclosures, debt, cash and other claims, computes diluted shares by the treasury stock method, and then drills the eight questions interviewers ask about which value pairs with which metric.",
  roles: ["student"], specialties: [IB, PEVC, ERHF, ACCT], category: "Valuation", icon: "ArrowLeftRight", deliverable: "analysis", savesMinutes: 90, tags: ["enterprise value", "bridge", "treasury stock method"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "NKE" },
    { key: "extras", label: "Bridge items to cover", type: "multiselect", options: ["Preferred stock", "Non-controlling interests", "Operating leases", "Underfunded pension", "Convertibles", "Equity investments"], default: ["Operating leases", "Non-controlling interests"] },
  ],
  example: { ticker: "NKE", extras: ["Operating leases", "Non-controlling interests"] },
  effort: "medium",
  instructions: `1. Call get_company_financials for price, market cap, cash, debt and cover-page shares. Call get_xbrl_series with find "Debt|Notes|Lease|NoncontrollingInterest|PreferredStock|RedeemableNoncontrolling" and pull the tags that exist, over the last 4 periods, converting raw units to millions with calc.
2. Call search_filing on the latest 10-K for "stock options" and "restricted stock units" and on the latest DEF 14A for "outstanding options" to get the option and RSU counts and weighted-average exercise prices; expand with read_filing. If the counts are not disclosed in a usable form, say so and build the bridge on cover-page shares, labelling it basic rather than diluted - do not invent option tranches.
3. Compute diluted shares by the treasury stock method: for each in-the-money tranche the net new shares are options x (1 - strike / price), because the exercise proceeds are assumed to repurchase shares at the current price; add RSUs in full; add if-converted shares for any in-the-money convertible. Out-of-the-money options are anti-dilutive and excluded.
4. Build the bridge: equity value = price x diluted shares; EV = equity value + total debt + preferred + non-controlling interests + capitalised operating leases (only if the peer set does it - say which convention you are using) + underfunded pension - cash and short-term investments. Cover each item the user selected, with that company's real number or an explicit "none disclosed".
PRODUCE: kpis (basic shares, diluted shares, dilution percent, equity value, enterprise value, net debt); table "Share count build" (Instrument, Shares, Strike, In the money?, Net new shares); waterfall "Equity value to enterprise value" with every bridge item; table "Which value pairs with which metric" (Metric, Pairs with, Why) covering revenue, EBITDA, EBIT, net income, book value and levered FCF; qa with six questions and model answers: why cash is subtracted and why only excess cash strictly should be, why NCI is added, whether EV can be negative, what happens to equity value and EV when the company issues $100 of stock and holds the cash, why EV/net income is meaningless, and what happens to both values when debt is repaid with cash. ${TEACH}`,
  prompt: (i) => `Build the enterprise-to-equity bridge for ${str(i, "ticker").toUpperCase()} and drill me on it.${list(i, "extras").length ? ` Cover: ${list(i, "extras").join(", ")}.` : ""}`,
};

const compsExplainer: ToolDef = {
  kind: "ai", id: "comps-line-by-line", title: "Comps explained line by line", tagline: "Every row of a trading comps set, defended or thrown out.",
  description: "Builds a trading comps set on live SEC data and then explains it the way a first-year analyst has to defend it: why each peer belongs, what calendarisation and EBITDA normalisation would change, when a multiple should be marked NM, and what the spread to the median actually tells you.",
  roles: ["student"], specialties: [IB, ERHF, PEVC, CORP], category: "Valuation", icon: "BarChart3", deliverable: "table", savesMinutes: 120, tags: ["comps", "multiples", "peer selection"],
  fields: [
    { key: "ticker", label: "Subject", type: "ticker", required: true, placeholder: "NKE" },
    { key: "peers", label: "Peers", type: "tickers", placeholder: "DECK ONON SKX LULU UAA", help: "Leave empty and the model picks and defends a set" },
    { key: "focus", label: "Primary multiple", type: "select", options: ["EV/EBITDA", "EV/Revenue", "P/E", "EV/FCF"], default: "EV/EBITDA" },
  ],
  example: { ticker: "NKE", peers: ["DECK", "ONON", "SKX", "LULU", "UAA"], focus: "EV/EBITDA" },
  effort: "medium",
  instructions: `1. Call get_trading_comps for the subject and peers (or a set of 5-8 you choose and justify by business model, size, growth and buyer universe, tiered into core and adjacent). Call get_company_financials on the subject and on the two peers furthest from it, to explain the outliers.
2. Teach the spreading method in the order a real comps sheet is built: (a) pick peers; (b) diluted shares from the cover page plus in-the-money options by the treasury stock method plus RSUs plus if-converted shares; (c) the EV bridge - equity value plus debt, preferred and NCI, less cash; (d) LTM = latest fiscal year plus current year to date less prior year to date; (e) calendarise non-December fiscal year ends by weighting the two fiscal years by months and footnote it; (f) normalise EBITDA by removing restructuring, impairments, litigation, gains on sale and FX, and treat stock-based compensation consistently across the set; (g) compute the multiples and show min, 25th percentile, median, mean, 75th and max; (h) mark NM when the denominator is negative or the multiple falls outside a plausible band.
3. Use get_trading_comps's fiscal-year-end field to identify which peers need calendarising, and search_filing on the subject's 10-K for "restructuring" or "impairment" to show one real normalisation candidate with its number.
4. For the two widest gaps to the peer median, find the reason in the filings (pricing model, mix, investment phase, a one-time item) rather than asserting that the company is cheap or expensive.
PRODUCE: kpis (subject's primary multiple, peer median, spread, and the subject's growth and margin versus the median); table "Comps" with the subject first (emphasisRow 0), a column for fiscal year end, and min/25th/median/mean/75th in totals or a note; table "Defend each peer" (Peer, Belongs because, Weakness as a comp, Keep or cut); bar chart of the primary multiple with the subject emphasised and the median as the reference line; scatter of growth versus the primary multiple; bullets "What would change this table" covering calendarisation, normalisation and forward versus trailing multiples; qa with four questions: how you picked the peers, why the subject trades at a premium or discount, why you would use this multiple over another, and what makes a multiple NM. ${TEACH}`,
  prompt: (i) => `Build and then explain a comps set for ${str(i, "ticker").toUpperCase()} line by line on ${str(i, "focus", "EV/EBITDA")}.${list(i, "peers").length ? ` Peers: ${list(i, "peers").join(", ")}.` : " Pick and defend the peers yourself."}`,
};

const precedentsExplainer: ToolDef = {
  kind: "ai", id: "precedents-explainer", title: "Precedent transactions explained", tagline: "Three real deals from EDGAR, taken apart field by field.",
  description: "Teaches precedent transaction analysis on real merger proxies: finds three comparable deals through EDGAR full-text search, extracts offer price, premium, consideration mix and termination fee from the documents, computes the implied multiples where the target was a registrant, and explains why precedents usually price above trading comps.",
  roles: ["student"], specialties: [IB, PEVC, CORP], category: "Valuation", icon: "Handshake", deliverable: "table", savesMinutes: 180, tags: ["precedents", "premiums", "merger proxy"],
  fields: [
    { key: "sector", label: "Sector keywords", type: "text", required: true, placeholder: "athletic footwear apparel consumer brands" },
    { key: "from", label: "Announced since", type: "date", default: "2024-01-01" },
    { key: "count", label: "Deals to teach", type: "number", default: 3, min: 2, max: 5 },
  ],
  example: { sector: "athletic footwear apparel consumer brands", from: "2024-01-01", count: 3 },
  effort: "high",
  instructions: `1. Run edgar_fulltext_search with "agreement and plan of merger" plus the sector keywords, forms ["DEFM14A","8-K","S-4","SC TO-T"], from the given date; run two query variants and de-duplicate by target. Pick the requested number of deals, preferring ones with a filed merger proxy because the proxy carries the terms.
2. For each deal, read_document with the queries "per share", "merger consideration", "premium", "termination fee" and "background of the merger" to extract: announcement date, acquirer and whether it is a strategic or a sponsor, target, consideration per share and mix, implied equity value, premium to the unaffected price, termination fee, and any go-shop or financing condition. Quote the document for the price and the premium.
3. Where the target was an SEC registrant, call get_company_financials or get_xbrl_series for LTM revenue and EBITDA near the announcement and compute EV/Revenue and EV/EBITDA with calc; where it was not, mark NM and say why. Purchase equity value = offer price x diluted shares at the offer price (treasury stock method run at the offer price, not the market price) and EV adds net debt and other claims.
4. Teach the four things that make precedents different from trading comps: acquirers pay a control premium and share synergies, so precedents usually sit above comps; the data is stale because it reflects the credit and equity conditions of the announcement date; strategics pay more than sponsors because sponsors cannot pay for synergies; and stock deals price lower than cash deals. Use the 2025 benchmarks for context - median termination fee about 2.7% of transaction value with roughly 48% of fees between 2.0% and 3.5%, and go-shops in about 8.5% of deals with 30-60 day windows.
PRODUCE: kpis (deals found, median premium, median EV/EBITDA, median termination fee as a percent); table "Precedent transactions" (Announced, Target, Acquirer, Type, EV, EV/LTM Rev, EV/LTM EBITDA, Premium, Consideration, Termination fee, Source); bar chart of premiums by deal; table "Where each field came from" (Field, Document, Exact phrase) for one deal, so the student can repeat the extraction; qa with four questions: why precedents are usually higher than comps, how you measure the premium and against which price, which target financials you use when the announcement falls mid-quarter, and why a sponsor deal is a weaker comp for a strategic buyer. State clearly which multiples you computed versus which were disclosed. ${TEACH}`,
  prompt: (i) => `Find ${num(i, "count", 3)} precedent transactions since ${str(i, "from", "2024-01-01")} in ${str(i, "sector")} and teach me the method field by field.`,
};

const lboIntuition: ToolDef = {
  kind: "ai", id: "lbo-intuition", title: "LBO intuition explainer", tagline: "Why leverage works, tested on a real company as a candidate.",
  description: "Explains where LBO returns actually come from by running a real company through the candidacy checklist and a paper LBO: stable cash flow, capex intensity, existing leverage and price. Then it splits the returns into EBITDA growth, multiple expansion and deleveraging so the student can answer the follow-up rather than reciting the steps.",
  roles: ["student"], specialties: [PEVC, IB, ERHF], category: "Modeling", icon: "Layers", deliverable: "analysis", savesMinutes: 120, tags: ["LBO", "leverage", "returns attribution"],
  fields: [
    { key: "ticker", label: "Candidate", type: "ticker", required: true, placeholder: "CMG" },
    { key: "leverage", label: "Entry leverage", type: "number", unit: "x EBITDA", default: 5, min: 0, max: 8 },
    { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 3, max: 7 },
  ],
  example: { ticker: "CMG", leverage: 5, years: 5 },
  effort: "medium",
  instructions: `1. Call get_company_financials: LTM revenue, EBITDA (both reported and ex-SBC), operating cash flow, capex, cash, debt, market cap and EV. Call search_filing on the latest 10-K for "seasonality", "contractual obligations" and "indebtedness" to judge cash-flow stability and existing leverage, and on the 10-Q for anything about capex plans.
2. Score the company against the ideal-candidate checklist and say where it fails: stable and predictable cash flows, low capex and working-capital needs, strong management, hard assets or contracted revenue, low existing leverage, operational upside, and a reasonable entry price. A company trading at 30x EBITDA with heavy unit growth capex is a bad LBO and the answer should say so plainly.
3. Run the paper LBO with calc at the given leverage: entry EV = LTM EBITDA x the current EV/EBITDA multiple; debt = leverage turns x EBITDA; sponsor equity = EV plus fees less debt; project EBITDA at a growth rate you justify from the filings; each year compute interest on the beginning balance, cash taxes, free cash flow and the sweep; exit at the entry multiple; then MOIC = exit equity / sponsor equity and IRR = MOIC^(1/years) - 1.
4. Attribute the return exactly: EBITDA growth contributes (exit EBITDA - entry EBITDA) x entry multiple; multiple change contributes (exit multiple - entry multiple) x exit EBITDA; deleveraging contributes entry net debt less exit net debt; fees are negative. Those four must sum to exit equity less entry equity - show that they do.
5. Answer the three intuition questions with the numbers you just produced: why leverage lifts returns (less equity funds the same asset, the company's own cash flow repays the debt, and interest is tax-deductible), why IRR and MOIC are both quoted (a fast 2x can beat a slow 3x), and which lever the sponsor actually controls.
PRODUCE: kpis (entry EV, entry multiple, sponsor equity, exit equity, MOIC, IRR); score "Candidacy" on the seven checklist items out of 5 each with a note; table "Debt schedule" one row per year (Beginning debt, EBITDA, Interest, Cash taxes, FCF, Sweep, Ending debt, Net debt/EBITDA); waterfall "Where the return came from" with the four attribution components between entry and exit equity; callout stating whether this is actually a good LBO candidate and why; qa with four follow-ups including what happens at a one-turn lower exit multiple. ${TEACH}`,
  prompt: (i) => `Is ${str(i, "ticker").toUpperCase()} a good LBO candidate? Run it at ${num(i, "leverage", 5)}x over ${num(i, "years", 5)} years and teach me where the returns come from.`,
};

const mergerConsequences: ToolDef = {
  kind: "ai", id: "merger-consequences", title: "Merger consequences explainer", tagline: "Accretion, dilution and purchase accounting on two real tickers.",
  description: "Takes two real companies, sets an offer price at your premium and consideration mix, and works the merger consequences through: new shares and new debt, foregone interest, after-tax synergies, pro forma EPS, accretion or dilution, the break-even synergy number, purchase accounting write-ups with the deferred tax liability, and a contribution analysis.",
  roles: ["student"], specialties: [IB, PEVC, CORP, ACCT], category: "Modeling", icon: "Split", deliverable: "analysis", savesMinutes: 150, tags: ["merger model", "accretion", "purchase accounting"],
  fields: [
    { key: "acquirer", label: "Acquirer", type: "ticker", required: true, placeholder: "NKE" },
    { key: "target", label: "Target", type: "ticker", required: true, placeholder: "SKX" },
    { key: "premium", label: "Premium to market", type: "number", unit: "%", default: 30 },
    { key: "cashPct", label: "Cash consideration", type: "number", unit: "%", default: 50 },
    { key: "synergies", label: "Run-rate pre-tax synergies", type: "number", unit: "$mm", default: 150 },
  ],
  example: { acquirer: "NKE", target: "SKX", premium: 30, cashPct: 50, synergies: 150 },
  effort: "high",
  instructions: `1. Call get_company_financials for both tickers: price, diluted shares, net income, revenue, EBITDA, cash and debt. Compute each company's EPS and P/E with calc and state them before anything else, because the rule of thumb depends on them.
2. Price the deal: offer per share = target price x (1 + premium); offer equity value = offer per share x target diluted shares; split it by the consideration mix. New shares = the stock portion / the acquirer's price. Assume the cash portion is funded first from balance-sheet cash above a stated minimum and then with new debt at a rate you justify (say the assumption and its source).
3. Pro forma net income = acquirer net income + target net income + after-tax synergies - after-tax interest on the new debt - after-tax foregone interest on the cash used, all at the acquirer's marginal tax rate. Pro forma EPS = that over acquirer shares plus new shares. Accretion or dilution = pro forma EPS / standalone EPS - 1. Show every line.
4. Solve for the break-even pre-tax synergies that make accretion exactly zero, and cross-check the result against the rules of thumb: all-stock is accretive when the acquirer's P/E exceeds the target's P/E at the offer, and cash or debt funding is accretive when the target's after-tax earnings yield exceeds the after-tax cost of the funding. If the rule and the arithmetic disagree, find the reason (usually the synergies or the foregone interest).
5. Purchase accounting: allocate the excess of purchase price over the target's net identifiable assets into PP&E write-ups, identifiable intangibles that get amortised, and residual goodwill that does not under US GAAP; create a deferred tax liability equal to the write-ups times the tax rate in a stock deal; expense transaction fees and capitalise financing fees. Give an illustrative allocation and label it as such, since the target's fair values are not public.
6. Say the sentence that separates candidates: accretion is not value creation - buying a lower-P/E target is mechanically accretive and says nothing about whether the price was right.
PRODUCE: kpis (offer per share, offer equity value, standalone EPS, pro forma EPS, accretion/dilution, break-even synergies); table "Deal build" (Item, Value, Formula) from offer price to pro forma EPS; waterfall "Standalone to pro forma net income" with synergies, new interest and foregone interest; sensitivity of accretion across premium and cash percentage; table "Contribution analysis" (Metric, Acquirer, Target, Acquirer share, Pro forma ownership) for revenue, EBITDA, net income and equity value; qa with four questions including why an all-stock deal can be dilutive even when the buyer's P/E is higher. ${TEACH}`,
  prompt: (i) => `Work the merger consequences of ${str(i, "acquirer").toUpperCase()} acquiring ${str(i, "target").toUpperCase()} at a ${num(i, "premium", 30)}% premium, ${num(i, "cashPct", 50)}% cash, with ${fmt.money(num(i, "synergies", 150))} of run-rate pre-tax synergies.`,
};

/* ======================================================================================
 * AI workflows: drills, stories, and firm-side research
 * ====================================================================================== */

const brainteasers: ToolDef = {
  kind: "ai", id: "brainteaser-drills", title: "Brain teaser & mental math drills", tagline: "Timed sets with the technique, not just the answer.",
  description: "Generates the brain teasers and mental math that S&T, consulting and banking interviews use as a proxy for composure: clock angles, rate traps, probability, estimation and percentage arithmetic. Every answer shows the technique so the next one is faster, and the set is timed per question.",
  roles: ["student"], specialties: [IB, CONSULT, ERHF, UND], category: "Learning", icon: "Lightbulb", deliverable: "quiz", savesMinutes: 45, tags: ["brain teasers", "mental math", "estimation"],
  fields: [
    { key: "types", label: "Types", type: "multiselect", required: true, options: ["Mental math", "Percentages & multiples", "Clock & geometry", "Probability", "Rate & work problems", "Market sizing", "Logic & lateral"], default: ["Mental math", "Clock & geometry", "Rate & work problems"] },
    { key: "count", label: "Questions", type: "number", default: 10, min: 5, max: 20 },
    { key: "seconds", label: "Seconds per question", type: "number", default: 45, min: 15, max: 180 },
  ],
  example: { types: ["Mental math", "Clock & geometry", "Rate & work problems"], count: 10, seconds: 45 },
  effort: "low", tools: ["calc"],
  instructions: `1. Draw from the canonical set and vary the numbers: the angle between the clock hands at a given time (at 1:45 it is 142.5 degrees - 120 degrees for four hour marks plus 22.5 degrees of hour-hand drift, since the hour hand moves 0.5 degrees per minute and the minute hand 6); the averaging trap (a car drives 60 miles at 30 mph, so the two hours are already spent and no speed can average 60 mph over that 60 miles); two-digit multiplication; percentage and multiple conversions; compound growth by the rule of 72; probability with replacement versus without; combined work rates; and market sizing by decomposition.
2. Teach the technique with each answer, because the technique is transferable and the answer is not: anchor and adjust (12% of 350 is 10% plus 2%); difference of squares for squaring numbers near a round one; converting a multiple to a growth rate with the rule of 72 (72 divided by the rate gives the doubling years); carrying units through a rate problem so the trap is visible; rounding to one significant figure first and correcting afterwards for sizing.
3. Verify every answer with calc before writing it. For mental math, also give the exact answer and the approximation a candidate should say out loud, since interviewers accept a fast approximation with the method stated.
4. Set the difficulty so the given seconds-per-question limit is tight but achievable, and state the total time for the set.
PRODUCE: callout with the rules (time limit, no calculator, say your method out loud) and the total time; qa with one item per question where the answer gives the exact figure, then the technique in one line, then the common wrong answer and why people fall for it; score "Technique checklist" rating the student's readiness on each selected type out of 5 with what to practise; table "Mental math ladder" (Skill, Drill, Target time) as a daily five-minute routine; bullets "Say this out loud" with the three sentences that buy thinking time without sounding lost. ${TEACH}`,
  prompt: (i) => `Give me ${num(i, "count", 10)} brain teasers on ${list(i, "types").join(", ") || "mental math"} at ${num(i, "seconds", 45)} seconds each, with the technique for each.`,
};

const behavioralBank: ToolDef = {
  kind: "ai", id: "behavioral-star-bank", title: "Behavioral question bank (STAR)", tagline: "Your stories mapped to the nine usual questions, scored.",
  description: "Turns your experiences into a STAR story bank covering the fit questions that actually get asked, maps each story to the questions it can answer without repeating itself, and scores every story on specificity, ownership, quantified result and reflection. Built on the finding that candidates over-prepare technicals and under-prepare stories.",
  roles: ["student"], specialties: TRACKS, category: "Communication", icon: "Users", deliverable: "memo", savesMinutes: 120, tags: ["behavioral", "STAR", "fit"],
  fields: [
    { key: "experiences", label: "Your experiences", type: "textarea", required: true, placeholder: "One per line: what it was, what you did, what happened, any numbers." },
    { key: "track", label: "Target track", type: "select", options: TRACKS, default: IB },
    { key: "firm", label: "Firm (optional)", type: "text", placeholder: "Houlihan Lokey" },
  ],
  example: { experiences: "Ran the investment club's $250k consumer sleeve; my SNOW long was adopted and is up 14%.\nLed a four-person case competition team that placed second of 40; I rebuilt the model the night before after finding a sign error.\nWorked 25 hours a week as a barista through sophomore year while holding a 3.8 GPA.\nBoutique summer: spread 11 software comps and drafted two CIM sections; the MD sent back my first draft twice.", track: IB, firm: "Houlihan Lokey" },
  effort: "medium", tools: ["web_research", "calc"],
  instructions: `1. Use the nine questions that recur in every fit interview: walk me through your resume; why this industry; why this firm; tell me about a time you led a team; a time you failed or made a mistake; a time you worked with a difficult person or handled conflict; your greatest strength and your biggest weakness; a time you worked under a deadline or juggled competing priorities; and what questions do you have for me. Add the track-specific one - why sponsors coverage, why long/short investing, why consulting over banking - and for a hedge fund or research seat, the pitch question.
2. Build each story in STAR form with hard limits: Situation in one sentence with the scale (dollars, people, time), Task in one sentence stating what was yours specifically, Action in three to four sentences all in the first person singular ("I") and naming the decision you made, Result in one sentence with a number, plus a final reflection sentence saying what you would do differently. Total 45-75 seconds spoken.
3. Map stories to questions so no story is used twice in one interview, and flag any question with no story behind it as a gap to go and create an experience for.
4. Use the experiences field only - never invent an achievement. Where a result has no number, write the placeholder naming exactly what to go and measure. Call web_research once if a firm is named, to ground the "why this firm" answer in something real.
PRODUCE: table "Story bank" (Story, Situation, Task, Action, Result, Best used for) with one row per story; table "Question coverage" (Question, Story to use, Backup, Gap?) covering all nine plus the track-specific ones; score on Specificity, Ownership (first person, not "we"), Quantified result, Reflection and Length discipline, out of 5 each with the fix; markdown "Why this industry and why this firm" as two drafted answers in spoken form, 45 seconds each; bullets "Gaps to fill this term" naming what to go and do. ${TEACH}`,
  prompt: (i) => `Build my STAR story bank for ${str(i, "track", IB)}${str(i, "firm") ? ` at ${str(i, "firm")}` : ""} and score each story.\n\nMy experiences:\n${str(i, "experiences")}`,
};

const firmBrief: ToolDef = {
  kind: "ai", id: "firm-research-brief", title: "Firm research brief", tagline: "Groups, real mandates and culture, so 'why this firm' lands.",
  description: "Researches a firm the way a candidate should before a superday: what the group actually does, named recent mandates found in SEC filings rather than press releases, how it is structured, what current and former employees say about the culture, and the three questions that show you did the work.",
  roles: ["student"], specialties: TRACKS, category: "Research", icon: "Building2", deliverable: "research", savesMinutes: 90, tags: ["why this firm", "culture", "deals"],
  fields: [
    { key: "firm", label: "Firm", type: "text", required: true, placeholder: "Houlihan Lokey" },
    { key: "group", label: "Group or office", type: "text", placeholder: "Technology M&A, San Francisco" },
    { key: "track", label: "Track", type: "select", options: TRACKS, default: IB },
    { key: "interview", label: "Interview date", type: "date" },
  ],
  example: { firm: "Houlihan Lokey", group: "Technology M&A", track: IB, interview: "2026-10-15" },
  effort: "medium",
  instructions: `1. Call edgar_fulltext_search with the firm's name in quotes and forms ["DEFM14A","S-4","8-K","425"] over the last 18 months to find deals where the firm is named as financial adviser or delivered a fairness opinion; read_document on the two best hits with the query "financial advisor" and "opinion of" to confirm the role and pull the target, the acquirer and the price. This is the difference between a candidate who read a press release and one who read the proxy.
2. Call web_research two or three times, no more: once for the firm's group structure and reputation in the named group, once for recent news (fund closes, senior hires, league table position, layoffs or expansion), and once for culture from employee-facing sources. Attribute culture claims to their source and mark them as opinion; never present a forum post as fact.
3. If the firm is itself SEC-registered (many advisory firms and asset managers are), call get_company_financials and get_recent_filings for revenue mix, headcount trends and segment commentary, which is the strongest possible "why this firm" evidence.
4. Convert the research into the answer: "why this firm" must cite one specific mandate, one structural fact about how the group works (coverage versus product, deal size, generalist versus specialist staffing) and one personal connection. Generic praise about culture and people is the most common failure - say so.
PRODUCE: kpis (deals found in filings, group's apparent focus, sources used, days until the interview when given); table "Named mandates from SEC filings" (Date, Target, Acquirer, Firm's role, Document); bullets "How this group is structured" with sources; bullets "Culture, attributed" separating what the firm says about itself from what employees say; markdown "Why this firm" as a drafted 45-second answer citing one real mandate; qa with three questions to ask them that cannot be answered from the website; risks "What could catch you out" (a recent negative story, a group reorganisation, an unfamiliar deal). ${TEACH}`,
  prompt: (i) => `Research ${str(i, "firm")}${str(i, "group") ? `, ${str(i, "group")}` : ""} for a ${str(i, "track", IB)} interview${str(i, "interview") ? ` on ${str(i, "interview")}` : ""}, and draft my "why this firm" answer.`,
};

const dealWalkthrough: ToolDef = {
  kind: "ai", id: "deal-walkthrough", title: "Deal walkthrough builder", tagline: "A real public deal turned into your 30-second and 3-minute answers.",
  description: "Builds the deal discussion from the actual filings: parties, price, multiple, premium, financing and rationale pulled from the 8-K and merger proxy, then the background-of-the-merger timeline, then the two versions you need - thirty seconds and three minutes - plus the follow-ups and your own view on whether it creates value.",
  roles: ["student"], specialties: [IB, PEVC, CONSULT, ERHF], category: "Research", icon: "ScrollText", deliverable: "memo", savesMinutes: 150, tags: ["deal discussion", "merger proxy", "narrative"],
  fields: [
    { key: "deal", label: "Deal", type: "text", required: true, placeholder: "Skechers / 3G Capital take-private" },
    { key: "target", label: "Target ticker (if listed)", type: "ticker", placeholder: "SKX" },
    { key: "lens", label: "Lens", type: "select", options: ["Banker (would you advise it)", "PE (would you underwrite it)", "Equity research (would you own it)", "Consulting (would integration work)"], default: "PE (would you underwrite it)" },
  ],
  example: { deal: "Skechers take-private by 3G Capital, announced May 2025", target: "SKX", lens: "PE (would you underwrite it)" },
  effort: "high",
  instructions: `1. Call edgar_fulltext_search for the deal by party names with forms ["8-K","DEFM14A","SC 13E3","S-4"] to locate the announcement 8-K and the merger proxy. If a target ticker is given, call get_recent_filings for that ticker with forms ["8-K","DEFM14A","DEF 14A"] first, which is faster and more reliable.
2. Extract from the documents with read_document, using the queries "per share", "merger consideration", "premium", "termination fee", "financing", "background of the merger", "reasons for the merger" and "opinion of": the announcement date, consideration per share and mix, equity value and enterprise value, the premium and against which unaffected date, the financing structure and any equity commitment letter, the termination and reverse termination fees, the outside date and regulatory conditions, and the advisers on each side. Quote the document for the price.
3. Call get_company_financials or get_xbrl_series on the target for LTM revenue and EBITDA near the announcement, and compute EV/Revenue and EV/EBITDA with calc so the deal has a multiple attached. Say which figures you computed.
4. Build the timeline from the "background of the merger" section - first contact, indications of interest, exclusivity, the board meetings, signing - because that section is where a candidate finds the detail nobody else has read.
5. Then form a view under the chosen lens and commit to it: a banker asks whether the price and structure were defensible, a sponsor asks whether the entry multiple and cash flow support the underwriting and what the exit looks like, a research analyst asks what it says about sector valuations, a consultant asks what integration would take. A candidate who has no view fails this question.
PRODUCE: kpis (announcement date, price per share, premium, EV, EV/LTM EBITDA, consideration mix); markdown "30-second version" written as spoken words - parties, price, multiple, rationale, your view, in about 75 words; markdown "3-minute version" adding the process, the financing, the synergies or the sponsor's underwriting, and the risks; timeline "Background of the merger" with dated steps from the proxy; table "Deal terms" (Term, Value, Document, Why it matters); bullets "Your view" with three reasons and one thing that would change your mind; qa with five follow-ups a banker asks, including how you would have valued it differently and what you would have advised the board. ${TEACH}`,
  prompt: (i) => `Build my deal walkthrough on ${str(i, "deal")}${str(i, "target") ? ` (target ${str(i, "target").toUpperCase()})` : ""} through a ${str(i, "lens", "PE")} lens.`,
};

const coveragePrimer: ToolDef = {
  kind: "ai", id: "coverage-primer", title: "Coverage group industry primer", tagline: "The metrics, multiples and questions for one sector, on real names.",
  description: "Produces the one-page sector primer a coverage-group interview expects: the KPIs that sector actually runs on, the multiples used and why others do not work, the current valuation range across real listed leaders, the deal patterns, and the five sector questions with answers.",
  roles: ["student"], specialties: [IB, ERHF, CONSULT, PEVC], category: "Research", icon: "Factory", deliverable: "research", savesMinutes: 120, tags: ["sector primer", "KPIs", "multiples"],
  fields: [
    { key: "sector", label: "Sector", type: "select", required: true, options: ["Technology / software", "Healthcare", "Energy & power", "Financial institutions", "Consumer & retail", "Industrials", "Media & telecom", "Real estate & gaming"], default: "Technology / software" },
    { key: "tickers", label: "Names to anchor on", type: "tickers", placeholder: "SNOW MDB DDOG", help: "Leave empty and the model picks the leaders" },
    { key: "use", label: "Use", type: "select", options: ["Coverage group interview", "Stock pitch background", "Class or club primer"], default: "Coverage group interview" },
  ],
  example: { sector: "Technology / software", tickers: ["SNOW", "MDB", "DDOG"], use: "Coverage group interview" },
  effort: "medium",
  instructions: `SECTOR MAP (use the right metrics for the sector, and say why the wrong ones fail): Technology and software - ARR, net and gross revenue retention, Rule of 40 (growth plus FCF margin), gross margin, magic number or CAC payback, remaining performance obligations; valued on EV/Revenue and EV/ARR while unprofitable and EV/FCF or EV/EBITDA once profitable; semis add book-to-bill and utilisation. Healthcare - for biotech, risk-adjusted NPV with probability of success by phase and patent cliffs, not EBITDA; for medtech and services, EV/EBITDA with reimbursement and volume drivers. Energy and power - EV/EBITDAX, PV-10 of proved reserves, production per day, decline rates, debt-adjusted cash flow for E&P; midstream on distributable cash flow and contracted volumes; utilities on rate base growth and P/E against allowed return. Financial institutions - P/E, price to tangible book, return on tangible common equity, CET1, net interest margin, efficiency ratio and combined ratio for insurers; never EV/EBITDA, because interest and leverage are the business rather than the financing. Consumer and retail - comparable store sales, four-wall EBITDA, units and price/mix, gross margin and inventory turns, EV/EBITDA and EV/EBITDAR where rent matters. Industrials - book-to-bill, backlog, aftermarket mix, incremental margins, capacity utilisation, EV/EBITDA through the cycle on mid-cycle earnings. Media and telecom - ARPU, subscribers and churn, content spend, EV/EBITDA and per-subscriber values. Real estate and gaming - FFO and AFFO, net asset value, cap rates, same-store NOI, occupancy and RevPAR; P/FFO rather than P/E.
METHOD: 1. Pick the anchor names given, or 4-6 listed leaders you justify, and call get_trading_comps for the current valuation range; call get_company_financials on the largest to get concrete figures. 2. Call search_filing on one anchor company's 10-K for the sector KPI language so the primer quotes how companies actually report it (for software, "remaining performance obligations" and "net revenue retention"; for retail, "comparable sales"; for energy, "proved reserves"). 3. Call web_research once for the sector's current state - growth, rates, consolidation - and once for recent M&A patterns; use edgar_fulltext_search with sector keywords and forms ["DEFM14A","8-K"] to name one real recent deal. 4. Do every multiple and median with calc.
PRODUCE: kpis (sector median EV/EBITDA or EV/Revenue, median growth, median margin, names in the set); table "Metrics that matter" (Metric, What it measures, Why this sector, Where to find it in a filing); table "Valuation snapshot" of the anchor names (Company, EV, Primary multiple, Growth, Margin); bar chart of the primary multiple across the set; bullets "Deal patterns" with one named recent transaction and its multiple; qa "Five sector questions" with model answers, including the one about which multiple you would not use here and why. ${TEACH}`,
  prompt: (i) => `Write a ${str(i, "sector")} primer for a ${str(i, "use", "coverage group interview").toLowerCase()}${list(i, "tickers").length ? `, anchored on ${list(i, "tickers").join(", ")}` : ""}.`,
};

const cfaCpaQuiz: ToolDef = {
  kind: "ai", id: "cfa-cpa-quiz", title: "CFA / CPA topic quiz", tagline: "Exam-format questions on the topics you pick, with the windows and fees.",
  description: "Builds an exam-format quiz on the CFA or CPA topics you name - multiple choice with distractors that punish the usual mistakes, item-set style where the exam uses it - and pairs it with the real registration windows, deadlines and fees so the study plan has dates attached.",
  roles: ["student"], specialties: [ERHF, ACCT, CORP, UND], category: "Learning", icon: "Library", deliverable: "quiz", savesMinutes: 90, tags: ["CFA", "CPA", "exam prep"],
  fields: [
    { key: "exam", label: "Exam", type: "select", required: true, options: ["CFA Level I", "CFA Level II", "CFA Level III", "CPA FAR", "CPA REG", "CPA AUD", "CPA discipline (BAR / ISC / TCP)"], default: "CFA Level I" },
    { key: "topics", label: "Topics", type: "multiselect", required: true, options: ["Ethics & professional standards", "Quantitative methods", "Economics", "Financial statement analysis", "Corporate issuers", "Equity investments", "Fixed income", "Derivatives", "Alternative investments", "Portfolio management", "Governmental & nonprofit accounting", "Taxation of individuals", "Business law", "Audit evidence & reports"], default: ["Financial statement analysis", "Equity investments", "Quantitative methods"] },
    { key: "count", label: "Questions", type: "number", default: 10, min: 5, max: 25 },
    { key: "examDate", label: "Target sitting", type: "date", default: "2027-02-15" },
  ],
  example: { exam: "CFA Level I", topics: ["Financial statement analysis", "Equity investments", "Quantitative methods"], count: 10, examDate: "2027-02-15" },
  effort: "medium",
  instructions: `1. Before weighting the quiz, call web_research once for the current published topic weights for the exam named (CFA Institute publishes them per level and they change between curriculum cycles; the CPA sections changed under the 2024 CPA Evolution model). Do not assume weights from memory - state the weights you found with their source, and if you cannot verify them, weight the selected topics equally and say so explicitly.
2. Registration facts you may state directly (researched 2026-09-20): CFA exam windows fall in February, May, August and November; Level I is offered in all four windows, Level II in May, August and November, and Level III in February and August. Fees run from $1,140 early to $1,490 standard for Levels I-II and $1,240 early to $1,590 standard for Level III; the one-time enrollment fee was eliminated in February 2026; total programme cost is $3,520-$4,570 and rescheduling costs $250. Candidates may register while still at university, within 23 months of graduation - tell the student to verify eligibility on the CFA Institute site rather than relying on this. CPA requires 150 credit hours plus state licensure, so the constraint is usually the credit hours and the state board, not the exam date.
3. Write questions in the exam's own format: CFA Levels I and II are three-option multiple choice (Level II in item sets built on a vignette, so write one short vignette and hang three questions off it); Level III mixes constructed response with item sets, so write one constructed-response prompt with a marking guide. CPA uses four-option multiple choice plus task-based simulations, so include one simulation-style question with a small table to complete.
4. Every distractor must encode a specific error a candidate actually makes - the wrong sign on a cash flow, using the coupon rate instead of the yield, forgetting to annualise, using book instead of market weights, mixing FIFO and LIFO, confusing accrual and cash basis. Show the arithmetic for the correct answer with calc and name the error each distractor represents.
PRODUCE: callout with the sitting date, days remaining and the registration deadline logic; qa with one item per question - q holds the question with its lettered options, a holds the correct answer, the worked arithmetic, and one line per distractor naming the error it punishes; table "Topic weights and your plan" (Topic, Published weight, Source, Your hours per week, Order); score "Readiness" per selected topic out of 5 with what to study; timeline of registration and study milestones from today to the sitting. ${TEACH}`,
  prompt: (i) => `Build a ${num(i, "count", 10)}-question ${str(i, "exam")} quiz on ${list(i, "topics").join(", ")} for the ${str(i, "examDate", "next")} sitting, and give me the registration dates.`,
};

const first10k: ToolDef = {
  kind: "ai", id: "first-10k-guide", title: "First-time 10-K reading guide", tagline: "A guided path through a real 10-K in the time you have.",
  description: "Walks you through an actual 10-K in the order a professional reads it, with a time budget per section, the ten numbers to copy down, the sentences that matter in MD&A and the footnotes, and a short quiz at the end to prove you read it rather than skimmed it.",
  roles: ["student"], specialties: [ERHF, ACCT, IB, CORP, UND], category: "Research", icon: "FileSearch", deliverable: "checklist", savesMinutes: 120, tags: ["10-K", "filings", "how to read"],
  fields: [
    { key: "ticker", label: "Company", type: "ticker", required: true, placeholder: "AAPL" },
    { key: "minutes", label: "Time you have", type: "select", options: ["30 minutes", "60 minutes", "2 hours"], default: "60 minutes" },
    { key: "goal", label: "Why you are reading it", type: "select", options: ["Interview prep", "Stock pitch", "Accounting class", "Industry learning"], default: "Interview prep" },
  ],
  example: { ticker: "AAPL", minutes: "60 minutes", goal: "Interview prep" },
  effort: "medium",
  instructions: `1. Call get_recent_filings for the ticker with forms ["10-K"] to get the actual filing and its date, and get_company_financials for the headline figures you will ask the student to verify.
2. Walk the document in professional reading order, using search_filing on the 10-K for each stop and read_filing to pull the passage: (a) the cover page - shares outstanding, fiscal year end, public float, auditor; (b) Item 1 Business - what they sell, to whom, segments, seasonality, customer concentration; (c) Item 1A Risk Factors - the first three only, because they are ordered by management's own priority and the rest is boilerplate; (d) Item 5 - the share repurchase table; (e) Item 7 MD&A "results of operations" - the sentences that explain the revenue and margin change, then "liquidity and capital resources" for the cash position, the revolver and the maturities; (f) Item 8 notes in this order - revenue disaggregation, debt, leases, segments, income taxes, commitments and contingencies, then subsequent events; (g) Item 9A controls, checking for any material weakness. Give a minute budget per stop that sums to the time available, and cut the later stops rather than skimming everything when the budget is 30 minutes.
3. Adapt to the goal: interview prep wants the three numbers and one story the student can recite; a stock pitch wants the KPI trend and the disclosure that supports a variant view; an accounting class wants the notes; industry learning wants Item 1 and the competition discussion.
4. Quote the actual sentences with citations so the student can find them, and show where each headline number in the financial statements can be tied back to a note.
PRODUCE: kpis (filing date, fiscal year end, revenue, operating margin, cash, total debt, shares outstanding); steps "Reading order" with one step per stop, each carrying the minute budget, the exact search phrase to use and what to look for; table "The ten numbers to copy down" (Number, Value, Where it is, Why it matters); bullets "Sentences worth quoting" with citations; callout naming the single most important disclosure in this particular filing; qa "Prove you read it" with five questions whose answers are all in the sections you walked, each answer citing its location; bullets "Traps for first-time readers" (adjusted versus reported figures, non-GAAP reconciliations, segment definitions that changed, the difference between the fiscal and calendar year). ${TEACH}`,
  prompt: (i) => `Guide me through ${str(i, "ticker").toUpperCase()}'s latest 10-K in ${str(i, "minutes", "60 minutes")} for ${str(i, "goal", "Interview prep").toLowerCase()}.`,
};

/* ======================================================================================
 * Calculators (pure TypeScript). Percent inputs are whole numbers and divided by 100 inside compute.
 * ====================================================================================== */

/** IRR for a single entry and single exit: MOIC^(1/years) - 1. */
const irrFromMoic = (moic: number, years: number): number | null => (moic > 0 && years > 0 ? Math.pow(moic, 1 / years) - 1 : null);
const median = (xs: number[]): number => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Paper LBO: sources and uses, a real debt schedule with a cash sweep, IRR/MOIC and the value-creation bridge. */
const paperLbo: ToolDef = {
  kind: "calc", id: "paper-lbo-timed", title: "Paper LBO", tagline: "Five-year debt paydown, IRR, MOIC, and where the return came from.",
  description: "The paper LBO an interviewer asks you to do in ten minutes, run properly: sources and uses with fees, a year-by-year debt schedule with interest on the beginning balance and a cash sweep, exit at an assumed multiple, then IRR and MOIC and an exact attribution of the return to EBITDA growth, multiple change and deleveraging.",
  roles: ["student"], specialties: [PEVC, IB], category: "Modeling", icon: "Coins", savesMinutes: 60, tags: ["LBO", "IRR", "MOIC"],
  fields: [
    { key: "entryEbitda", label: "Entry EBITDA", type: "number", unit: "$mm", required: true, default: 100 },
    { key: "entryMultiple", label: "Entry EV/EBITDA", type: "number", unit: "x", default: 10 },
    { key: "debtTurns", label: "Debt at entry", type: "number", unit: "x EBITDA", default: 5 },
    { key: "feesPct", label: "Transaction & financing fees", type: "number", unit: "% of EV", default: 2 },
    { key: "ebitdaGrowth", label: "EBITDA growth", type: "number", unit: "% a year", default: 8.45, help: "8.45% takes $100 of EBITDA to $150 over five years" },
    { key: "exitMultiple", label: "Exit EV/EBITDA", type: "number", unit: "x", default: 10 },
    { key: "years", label: "Hold period", type: "number", unit: "years", default: 5, min: 1, max: 10 },
    { key: "interestRate", label: "Blended interest rate", type: "number", unit: "%", default: 9 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "daPct", label: "D&A", type: "number", unit: "% of EBITDA", default: 20 },
    { key: "capexPct", label: "Capex", type: "number", unit: "% of EBITDA", default: 25 },
    { key: "nwcPct", label: "Change in working capital", type: "number", unit: "% of EBITDA growth", default: 10 },
    { key: "sweepPct", label: "Cash sweep", type: "number", unit: "% of FCF", default: 100 },
  ],
  example: { entryEbitda: 100, entryMultiple: 10, debtTurns: 5, feesPct: 2, ebitdaGrowth: 8.45, exitMultiple: 10, years: 5, interestRate: 9, taxRate: 25, daPct: 20, capexPct: 25, nwcPct: 10, sweepPct: 100 },
  prefill: (c) => {
    const eb = c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0;
    const ev = (c.price?.marketCap ?? 0) + (c.balance.debt ?? 0) - (c.balance.cash ?? 0);
    const mult = eb > 0 && ev > 0 ? Math.round((ev / eb) * 10) / 10 : 10;
    return { entryEbitda: Math.round(eb), entryMultiple: mult, exitMultiple: mult, debtTurns: 5, years: 5 };
  },
  compute: (i: Inputs): WorkflowOutput => {
    const e0 = num(i, "entryEbitda"), entryX = num(i, "entryMultiple"), turns = num(i, "debtTurns");
    const g0 = num(i, "ebitdaGrowth") / 100, exitX = num(i, "exitMultiple"), yrs = Math.round(num(i, "years", 5));
    const kd = num(i, "interestRate") / 100, tax = num(i, "taxRate") / 100, daP = num(i, "daPct") / 100;
    const capexP = num(i, "capexPct") / 100, nwcP = num(i, "nwcPct") / 100, feeP = num(i, "feesPct") / 100, sweep = num(i, "sweepPct", 100) / 100;
    if (e0 <= 0) throw new Error("Entry EBITDA must be positive.");
    if (entryX <= 0 || exitX <= 0) throw new Error("Entry and exit multiples must be positive.");
    if (yrs < 1 || yrs > 10) throw new Error("Hold period must be between 1 and 10 years.");
    const entryEv = e0 * entryX, fees = entryEv * feeP, debt0 = turns * e0, sponsor = entryEv + fees - debt0;
    if (sponsor <= 0) throw new Error(`${turns.toFixed(1)}x of debt funds more than the ${fmt.money(entryEv)} purchase price plus fees, so sponsor equity would be negative. Lower the leverage or raise the entry multiple.`);
    type Yr = { y: number; ebitda: number; da: number; ebit: number; interest: number; taxes: number; fcf: number; paydown: number; debt: number; cash: number };
    const run = (g: number): Yr[] => {
      const out: Yr[] = []; let debt = debt0, cash = 0;
      for (let y = 1; y <= yrs; y++) {
        const ebitda = e0 * Math.pow(1 + g, y), prev = e0 * Math.pow(1 + g, y - 1);
        const da = ebitda * daP, ebit = ebitda - da, interest = debt * kd;
        const ebt = ebit - interest, taxes = Math.max(ebt, 0) * tax;
        const fcf = ebt - taxes + da - ebitda * capexP - (ebitda - prev) * nwcP;
        const paydown = Math.min(Math.max(fcf * sweep, 0), debt);
        debt -= paydown; cash += fcf - paydown;
        out.push({ y, ebitda, da, ebit, interest, taxes, fcf, paydown, debt, cash });
      }
      return out;
    };
    const rows = run(g0), last = rows[rows.length - 1];
    const exitEbitda = e0 * Math.pow(1 + g0, yrs), exitEv = exitEbitda * exitX;
    const netDebtExit = last.debt - last.cash, equityExit = exitEv - netDebtExit;
    const moic = equityExit / sponsor, irr = irrFromMoic(moic, yrs);
    const irrAt = (x: number, g: number): number | null => { const r = run(g), l = r[r.length - 1], eb = e0 * Math.pow(1 + g, yrs); return irrFromMoic((eb * x - (l.debt - l.cash)) / sponsor, yrs); };
    const xs = [entryX - 2, entryX - 1, entryX, entryX + 1, entryX + 2].map((x) => Math.max(0.5, x));
    const gs = [g0 - 0.04, g0 - 0.02, g0, g0 + 0.02, g0 + 0.04];
    const growthPart = (exitEbitda - e0) * entryX, multiplePart = (exitX - entryX) * exitEbitda, debtPart = debt0 - netDebtExit;
    return {
      title: "Paper LBO",
      summary: `Buying ${fmt.money(e0)} of EBITDA at ${fmt.x(entryX)} costs ${fmt.money(entryEv)} of enterprise value, funded with ${fmt.money(debt0)} of debt (${fmt.x(turns)}) and ${fmt.money(sponsor)} of sponsor equity after ${fmt.money(fees)} of fees. EBITDA reaches ${fmt.money(exitEbitda)} by year ${yrs} and the exit at ${fmt.x(exitX)} leaves ${fmt.money(equityExit)} of equity: a ${fmt.x(moic, 2)} MOIC and a ${fmt.pct(irr, 1)} IRR. Of the ${fmt.money(equityExit - sponsor)} of value created, ${fmt.pct(growthPart / (equityExit - sponsor), 0)} came from EBITDA growth and ${fmt.pct(debtPart / (equityExit - sponsor), 0)} from paying down debt.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Entry EV", value: fmt.money(entryEv), hint: `${fmt.money(e0)} EBITDA x ${fmt.x(entryX)}` },
          { label: "Sponsor equity", value: fmt.money(sponsor), hint: "EV + fees - debt" },
          { label: "Exit equity", value: fmt.money(equityExit), hint: `${fmt.money(exitEv)} EV less ${fmt.money(netDebtExit)} net debt` },
          { label: "MOIC", value: fmt.x(moic, 2), tone: moic >= 2 ? "pos" : moic >= 1 ? "neutral" : "neg" },
          { label: "IRR", value: fmt.pct(irr, 1), tone: irr !== null && irr >= 0.2 ? "pos" : irr !== null && irr >= 0 ? "neutral" : "neg", hint: "MOIC^(1/years) - 1" },
          { label: "Entry / exit leverage", value: `${fmt.x(turns)} / ${fmt.x(netDebtExit / exitEbitda)}` },
        ] },
        { type: "table", title: "Sources & uses (USD mm)", columns: ["Item", "Amount", "x EBITDA", "Note"], rows: [
          ["Uses: purchase equity and refinanced debt", fmt.num(entryEv, 0), fmt.x(entryX), "Entry EBITDA x entry multiple"],
          ["Uses: transaction and financing fees", fmt.num(fees, 0), fmt.x(fees / e0), `${fmt.pct(feeP, 1)} of EV`],
          ["Sources: debt", fmt.num(debt0, 0), fmt.x(turns), `Interest at ${fmt.pct(kd, 1)} on the beginning balance`],
          ["Sources: sponsor equity", fmt.num(sponsor, 0), fmt.x(sponsor / e0), "The plug: total uses less debt"],
        ], totals: ["Total", fmt.num(entryEv + fees, 0), fmt.x((entryEv + fees) / e0), ""] },
        { type: "table", title: "Debt schedule (USD mm)", columns: ["Year", "EBITDA", "D&A", "EBIT", "Interest", "Cash taxes", "Free cash flow", "Debt paydown", "Ending debt", "Net debt / EBITDA"],
          rows: rows.map((r) => [`Y${r.y}`, fmt.num(r.ebitda, 0), fmt.num(r.da, 0), fmt.num(r.ebit, 0), fmt.num(r.interest, 0), fmt.num(r.taxes, 0), fmt.num(r.fcf, 0), fmt.num(r.paydown, 0), fmt.num(r.debt, 0), fmt.x((r.debt - r.cash) / r.ebitda)]),
          note: "Interest is charged on the beginning-of-year balance, which is what an interviewer expects on paper; a real model uses the average balance and creates a circularity." },
        { type: "waterfall", title: "Where the return came from (USD mm)", format: "money", steps: [
          { label: "Sponsor equity", value: sponsor, total: true },
          { label: "EBITDA growth", value: growthPart },
          { label: "Multiple change", value: multiplePart },
          { label: "Debt paydown and cash", value: debtPart },
          { label: "Fees", value: -fees },
          { label: "Exit equity", value: equityExit, total: true },
        ] },
        { type: "sensitivity", title: "IRR: exit multiple x EBITDA growth", rowLabel: "Exit multiple", colLabel: "EBITDA growth", rows: xs.map((x) => fmt.x(x)), cols: gs.map((g) => fmt.pct(g, 1)), values: xs.map((x) => gs.map((g) => irrAt(x, g))), format: "pct", baseRow: 2, baseCol: 2 },
        { type: "columns", title: "Ending debt balance (USD mm)", format: "money", data: rows.map((r) => ({ label: `Y${r.y}`, value: r.debt })) },
      ],
      caveats: [
        "Free cash flow is EBITDA less interest, cash taxes, capex and the change in working capital; D&A is added back after tax, so the tax shield on D&A is captured.",
        "Taxes are floored at zero with no net operating loss carryforward, and no mandatory amortisation or revolver draw is modelled: a negative free cash flow year simply reduces the cash balance.",
        "The attribution is exact by construction: EBITDA growth x entry multiple, plus multiple change x exit EBITDA, plus the change in net debt, less fees, equals exit equity less sponsor equity.",
        "IRR here assumes one entry and one exit with no dividends or recapitalisations; a dividend recap raises IRR without changing MOIC much.",
      ],
      nextSteps: ["Redo it on paper in ten minutes and compare", "Check the IRR against the memorised anchors in the MOIC-to-IRR table", "Run the same company through the LBO intuition explainer to test whether it is a real candidate"],
    };
  },
};

/** Enterprise value bridge, the multiples it supports, and which value pairs with which metric. */
const evBridge: ToolDef = {
  kind: "calc", id: "ev-bridge-trainer", title: "EV / equity bridge & multiples", tagline: "Every bridge item, then the multiples each value legitimately supports.",
  description: "Builds the enterprise value bridge from equity value through debt, preferred, non-controlling interests, capitalised leases and pension, less cash, then computes the multiples on the correct numerator so that EV pairs with revenue, EBITDA and EBIT while equity value pairs with net income. Marks a multiple NM rather than printing a negative one.",
  roles: ["student"], specialties: [IB, ERHF, ACCT, PEVC], category: "Valuation", icon: "ArrowLeftRight", savesMinutes: 25, tags: ["enterprise value", "bridge", "multiples"],
  fields: [
    { key: "price", label: "Share price", type: "number", unit: "$/share", required: true, default: 62 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", required: true, default: 1480 },
    { key: "debt", label: "Total debt", type: "number", unit: "$mm", default: 8500 },
    { key: "cash", label: "Cash and short-term investments", type: "number", unit: "$mm", default: 9900 },
    { key: "preferred", label: "Preferred stock", type: "number", unit: "$mm", default: 0 },
    { key: "nci", label: "Non-controlling interests", type: "number", unit: "$mm", default: 0 },
    { key: "leases", label: "Capitalised operating leases", type: "number", unit: "$mm", default: 3000 },
    { key: "pension", label: "Underfunded pension", type: "number", unit: "$mm", default: 0 },
    { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", default: 46300 },
    { key: "ebitda", label: "LTM EBITDA", type: "number", unit: "$mm", default: 5200 },
    { key: "ebit", label: "LTM EBIT", type: "number", unit: "$mm", default: 4300 },
    { key: "netIncome", label: "LTM net income", type: "number", unit: "$mm", default: 3200 },
  ],
  example: { price: 62, shares: 1480, debt: 8500, cash: 9900, preferred: 0, nci: 0, leases: 3000, pension: 0, revenue: 46300, ebitda: 5200, ebit: 4300, netIncome: 3200 },
  prefill: (c) => ({
    price: c.price?.last ?? 0, shares: c.balance.sharesOut ?? 0, debt: c.balance.debt ?? 0, cash: c.balance.cash ?? 0,
    revenue: c.ltm.revenue ?? 0, ebitda: c.ltm.adjEbitda ?? c.ltm.ebitda ?? 0, ebit: c.ltm.operatingIncome ?? 0, netIncome: c.ltm.netIncome ?? 0,
    preferred: 0, nci: 0, leases: 0, pension: 0,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const px = num(i, "price"), sh = num(i, "shares");
    if (px <= 0 || sh <= 0) throw new Error("Share price and diluted share count must both be positive.");
    const debt = num(i, "debt"), cash = num(i, "cash"), pref = num(i, "preferred"), nci = num(i, "nci"), leases = num(i, "leases"), pension = num(i, "pension");
    const rev = num(i, "revenue"), ebitda = num(i, "ebitda"), ebit = num(i, "ebit"), ni = num(i, "netIncome");
    const eq = px * sh, ev = eq + debt + pref + nci + leases + pension - cash, netDebt = debt - cash;
    const mult = (v: number, d: number) => (d > 0 && v > 0 ? v / d : null);
    return {
      title: "Enterprise value bridge",
      summary: `${fmt.moneyRaw(px, 2)} a share on ${fmt.num(sh, 0)}mm diluted shares is ${fmt.money(eq)} of equity value. Adding ${fmt.money(debt + pref + nci + leases + pension)} of debt and debt-like claims and subtracting ${fmt.money(cash)} of cash gives an enterprise value of ${fmt.money(ev)}, so the company carries ${netDebt < 0 ? `${fmt.money(-netDebt)} of net cash` : `${fmt.money(netDebt)} of net debt`}. ${ev > 0 ? `That is ${fmt.x(mult(ev, ebitda))} LTM EBITDA and ${fmt.x(mult(ev, rev))} LTM revenue.` : "Enterprise value is negative because cash exceeds market capitalisation plus debt, which is possible and is a real interview question."}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Equity value", value: fmt.money(eq), hint: "Price x diluted shares" },
          { label: "Enterprise value", value: fmt.money(ev), tone: ev > 0 ? "neutral" : "warn" },
          { label: netDebt < 0 ? "Net cash" : "Net debt", value: fmt.money(Math.abs(netDebt)), tone: netDebt > 0 ? "warn" : "pos", hint: "Debt less cash, before leases and pension" },
          { label: "EV / LTM revenue", value: fmt.x(mult(ev, rev)) },
          { label: "EV / LTM EBITDA", value: fmt.x(mult(ev, ebitda)) },
          { label: "P / E", value: fmt.x(mult(eq, ni)) },
        ] },
        { type: "waterfall", title: "Equity value to enterprise value (USD mm)", format: "money", steps: [
          { label: "Equity value", value: eq, total: true },
          { label: "Plus total debt", value: debt },
          { label: "Plus preferred", value: pref },
          { label: "Plus non-controlling interests", value: nci },
          { label: "Plus capitalised leases", value: leases },
          { label: "Plus underfunded pension", value: pension },
          { label: "Less cash", value: -cash },
          { label: "Enterprise value", value: ev, total: true },
        ] },
        { type: "table", title: "Which value pairs with which metric", columns: ["Metric", "Correct numerator", "Multiple", "Why"], rows: [
          ["LTM revenue", "Enterprise value", fmt.x(mult(ev, rev)), "Revenue is available to every capital provider, so it pairs with EV"],
          ["LTM EBITDA", "Enterprise value", fmt.x(mult(ev, ebitda)), "Pre-interest and pre-tax, so it belongs to debt and equity together"],
          ["LTM EBIT", "Enterprise value", fmt.x(mult(ev, ebit)), "Also pre-interest; better than EBITDA when capital intensity differs"],
          ["LTM net income", "Equity value", fmt.x(mult(eq, ni)), "After interest, so only equity holders have a claim on it"],
          ["Book value of equity", "Equity value", "n/a", "Balance-sheet equity pairs with market equity, not EV"],
          ["Levered free cash flow", "Equity value", "n/a", "After debt service, so it is an equity measure"],
        ] },
        { type: "bar", title: "Bridge components (USD mm)", format: "money", data: [
          { label: "Equity value", value: eq, emphasis: true }, { label: "Debt", value: debt }, { label: "Preferred", value: pref },
          { label: "NCI", value: nci }, { label: "Leases", value: leases }, { label: "Pension", value: pension }, { label: "Cash", value: -cash },
          { label: "Enterprise value", value: ev, emphasis: true },
        ] },
      ],
      caveats: [
        "Strictly only excess cash should be subtracted: cash needed to run the business is an operating asset. Most practitioners subtract all cash and footnote it.",
        "Non-controlling interests are added because consolidated revenue and EBITDA include 100% of a partly owned subsidiary, so enterprise value must reflect 100% of its capital.",
        "Capitalised operating leases are added only when EBITDA is before rent and the peer set applies the same convention; under ASC 842 the lease liability is already on the balance sheet, so check you are not double counting it against debt.",
        "A multiple is marked n/a when the numerator or denominator is not positive; a negative multiple should never be printed in a comps table.",
      ],
      nextSteps: ["Compute diluted shares properly with the treasury stock method calculator", "Rebuild this bridge from a real 10-K cover page and balance sheet", "Compare the multiples to a peer median in the comps explainer"],
    };
  },
};

/** Treasury stock method: in-the-money options exercise and the proceeds repurchase shares at the market price. */
const tsmShares: ToolDef = {
  kind: "calc", id: "tsm-diluted-shares", title: "Diluted shares (treasury stock method)", tagline: "Options, RSUs and convertibles turned into one diluted count.",
  description: "Runs the treasury stock method tranche by tranche: in-the-money options are exercised, the proceeds repurchase shares at the current price, and only the net new shares dilute. Adds restricted stock in full and in-the-money convertibles on an if-converted basis, and shows which tranches are anti-dilutive and excluded.",
  roles: ["student"], specialties: [IB, ERHF, ACCT], category: "Valuation", icon: "Scale", savesMinutes: 25, tags: ["treasury stock method", "dilution", "share count"],
  fields: [
    { key: "price", label: "Current share price", type: "number", unit: "$/share", required: true, default: 100 },
    { key: "basic", label: "Basic shares outstanding", type: "number", unit: "mm", required: true, default: 100 },
    { key: "tranches", label: "Option tranches", type: "csv", columns: "shares_mm,strike", default: "shares_mm,strike\n10,60\n8,95\n5,130", help: "One row per tranche: shares in millions and the weighted-average exercise price" },
    { key: "rsus", label: "Unvested RSUs and PSUs", type: "number", unit: "mm", default: 3 },
    { key: "convertPrincipal", label: "Convertible principal", type: "number", unit: "$mm", default: 200 },
    { key: "convertPrice", label: "Conversion price", type: "number", unit: "$/share", default: 80 },
  ],
  example: { price: 100, basic: 100, tranches: "shares_mm,strike\n10,60\n8,95\n5,130", rsus: 3, convertPrincipal: 200, convertPrice: 80 },
  prefill: (c) => ({ price: c.price?.last ?? 0, basic: c.balance.sharesOut ?? 0 }),
  compute: (i: Inputs): WorkflowOutput => {
    const px = num(i, "price"), basic = num(i, "basic"), rsus = num(i, "rsus"), cp = num(i, "convertPrincipal"), cpx = num(i, "convertPrice");
    if (px <= 0) throw new Error("Current share price must be positive.");
    if (basic <= 0) throw new Error("Basic shares outstanding must be positive.");
    const parsed = parseCsv(str(i, "tranches"));
    const raw = [...(Number.isFinite(Number(parsed.header[0])) ? [parsed.header] : []), ...parsed.rows];
    const tranches = raw.map((r) => ({ shares: Number(r[0]), strike: Number(r[1]) })).filter((t) => Number.isFinite(t.shares) && Number.isFinite(t.strike) && t.shares > 0);
    if (!tranches.length && rsus <= 0 && cp <= 0) throw new Error("Enter at least one option tranche (shares_mm,strike), some RSUs, or a convertible.");
    const rows = tranches.map((t) => {
      const itm = t.strike < px, proceeds = itm ? t.shares * t.strike : 0, repurchased = itm ? proceeds / px : 0;
      return { ...t, itm, proceeds, repurchased, net: itm ? t.shares - repurchased : 0 };
    });
    const netOptions = rows.reduce((a, r) => a + r.net, 0), proceeds = rows.reduce((a, r) => a + r.proceeds, 0);
    const convItm = cp > 0 && cpx > 0 && cpx < px, convShares = convItm ? cp / cpx : 0;
    const diluted = basic + netOptions + rsus + convShares;
    const excluded = rows.filter((r) => !r.itm).reduce((a, r) => a + r.shares, 0);
    return {
      title: "Diluted shares, treasury stock method",
      summary: `At ${fmt.moneyRaw(px, 2)} a share, ${fmt.num(rows.filter((r) => r.itm).reduce((a, r) => a + r.shares, 0), 1)}mm of options are in the money and contribute ${fmt.num(netOptions, 1)}mm net new shares after the ${fmt.money(proceeds)} of exercise proceeds are used to repurchase stock. With ${fmt.num(rsus, 1)}mm of RSUs and ${fmt.num(convShares, 1)}mm of if-converted shares, diluted shares are ${fmt.num(diluted, 1)}mm against ${fmt.num(basic, 1)}mm basic, a ${fmt.pct(diluted / basic - 1, 1)} increase. ${excluded > 0 ? `${fmt.num(excluded, 1)}mm of out-of-the-money options are anti-dilutive and excluded.` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Basic shares", value: `${fmt.num(basic, 1)}mm` },
          { label: "Diluted shares", value: `${fmt.num(diluted, 1)}mm` },
          { label: "Dilution", value: fmt.pct(diluted / basic - 1, 1), tone: diluted / basic - 1 > 0.05 ? "warn" : "neutral" },
          { label: "Exercise proceeds", value: fmt.money(proceeds), hint: "Assumed to repurchase shares at the market price" },
          { label: "Equity value, basic", value: fmt.money(px * basic) },
          { label: "Equity value, diluted", value: fmt.money(px * diluted) },
        ] },
        { type: "table", title: "Option tranches", columns: ["Tranche", "Options (mm)", "Strike", "In the money?", "Proceeds ($mm)", "Shares repurchased (mm)", "Net new shares (mm)"],
          rows: rows.map((r, k) => [`Tranche ${k + 1}`, fmt.num(r.shares, 1), fmt.moneyRaw(r.strike, 2), r.itm ? "Yes" : "No - anti-dilutive", r.itm ? fmt.num(r.proceeds, 0) : "0", fmt.num(r.repurchased, 1), fmt.num(r.net, 1)]),
          totals: ["Total", fmt.num(tranches.reduce((a, t) => a + t.shares, 0), 1), "", "", fmt.num(proceeds, 0), fmt.num(rows.reduce((a, r) => a + r.repurchased, 0), 1), fmt.num(netOptions, 1)] },
        { type: "waterfall", title: "Share count build (mm)", format: "num", steps: [
          { label: "Basic shares", value: basic, total: true },
          { label: "Net options (TSM)", value: netOptions },
          { label: "RSUs and PSUs", value: rsus },
          { label: "If-converted shares", value: convShares },
          { label: "Diluted shares", value: diluted, total: true },
        ] },
        { type: "bar", title: "Net new shares by source (mm)", format: "num", data: [
          ...rows.map((r) => ({ label: `Options ${fmt.moneyRaw(r.strike, 0)}`, value: r.net, note: r.itm ? undefined : "out of the money" })),
          { label: "RSUs", value: rsus }, { label: "Convertible", value: convShares },
        ] },
      ],
      caveats: [
        "Net new shares per tranche = options x (1 - strike / price); the formula is just the proceeds buying back stock at the current price.",
        "Out-of-the-money options are anti-dilutive and excluded, which is why the diluted count falls when the share price falls - the opposite of most students' intuition.",
        "RSUs and PSUs are added in full because there are no proceeds; performance units should only be counted where the performance condition is expected to be met.",
        "The if-converted method adds the conversion shares and, for an EPS calculation, also adds back the after-tax interest on the convertible. This calculator handles the share count only.",
        "For precedent transactions, run the treasury stock method at the offer price rather than the market price, which raises the diluted count.",
      ],
      nextSteps: ["Pull the real option tranches from the equity compensation footnote or the DEF 14A", "Feed the diluted count into the EV bridge calculator", "Check how the count changes if the share price falls 20%"],
    };
  },
};

/** One transaction walked through all three statements, with the balance check. */
type FlowCase = { is: [string, number][]; cf: [string, number][]; bs: [string, number][]; ni: number; cash: number; assets: number; le: number; script: string; follow: string[] };
const FLOWS: Record<string, (a: number, t: number) => FlowCase> = {
  "Depreciation +$X": (a, t) => ({
    is: [["D&A", a], ["Operating income", -a], ["Pre-tax income", -a], ["Taxes", -a * t], ["Net income", -a * (1 - t)]],
    cf: [["Net income", -a * (1 - t)], ["Add back D&A (non-cash)", a], ["Cash from operations", a * t], ["Net change in cash", a * t]],
    bs: [["Cash", a * t], ["PP&E, net", -a], ["Total assets", -a * (1 - t)], ["Retained earnings", -a * (1 - t)], ["Total liabilities + equity", -a * (1 - t)]],
    ni: -a * (1 - t), cash: a * t, assets: -a * (1 - t), le: -a * (1 - t),
    script: `Depreciation is a non-cash expense, so operating income and pre-tax income both fall by ${fmt.num(a, 0)}. At a ${fmt.pct(t, 0)} tax rate the tax bill falls by ${fmt.num(a * t, 1)}, so net income falls by ${fmt.num(a * (1 - t), 1)}. On the cash flow statement you start from the lower net income and add the full ${fmt.num(a, 0)} of depreciation back, so cash actually rises by ${fmt.num(a * t, 1)} - the tax shield. On the balance sheet, PP&E falls ${fmt.num(a, 0)} and cash rises ${fmt.num(a * t, 1)}, so assets fall ${fmt.num(a * (1 - t), 1)}, matched by retained earnings.`,
    follow: ["Why does cash go up when an expense goes up?", "What happens to enterprise value and to equity value?", "Now do it with a 0% tax rate"],
  }),
  "Inventory bought for cash +$X": (a) => ({
    is: [["No impact until the inventory is sold through COGS", 0]],
    cf: [["Increase in inventory (working capital)", -a], ["Cash from operations", -a], ["Net change in cash", -a]],
    bs: [["Cash", -a], ["Inventory", a], ["Total assets", 0], ["Total liabilities + equity", 0]],
    ni: 0, cash: -a, assets: 0, le: 0,
    script: `Buying inventory is an asset swap: cash falls ${fmt.num(a, 0)} and inventory rises ${fmt.num(a, 0)}, so total assets do not move and there is no income statement impact until the goods are sold and the cost lands in COGS. The only visible effect is a ${fmt.num(a, 0)} working capital outflow in cash from operations.`,
    follow: ["When does this hit the income statement?", "What if the inventory was bought on credit instead?", "How does this show up in free cash flow?"],
  }),
  "Capex +$X funded with debt": (a) => ({
    is: [["No impact until depreciation and interest begin", 0]],
    cf: [["Capital expenditures (investing)", -a], ["Debt issued (financing)", a], ["Net change in cash", 0]],
    bs: [["PP&E, net", a], ["Total assets", a], ["Debt", a], ["Total liabilities + equity", a]],
    ni: 0, cash: 0, assets: a, le: a,
    script: `Nothing touches the income statement on day one. The cash flow statement shows ${fmt.num(a, 0)} out in investing and ${fmt.num(a, 0)} in from financing, so net cash is unchanged. The balance sheet grows on both sides: PP&E up ${fmt.num(a, 0)}, debt up ${fmt.num(a, 0)}. From next period the depreciation and the interest expense both start reducing net income.`,
    follow: ["What happens in year two?", "What does this do to enterprise value?", "How would a lender look at this?"],
  }),
  "Accrued unpaid expense +$X": (a, t) => ({
    is: [["Operating expenses", a], ["Pre-tax income", -a], ["Taxes", -a * t], ["Net income", -a * (1 - t)]],
    cf: [["Net income", -a * (1 - t)], ["Increase in accrued liabilities", a], ["Cash from operations", a * t], ["Net change in cash", a * t]],
    bs: [["Cash", a * t], ["Total assets", a * t], ["Accrued liabilities", a], ["Retained earnings", -a * (1 - t)], ["Total liabilities + equity", a * t]],
    ni: -a * (1 - t), cash: a * t, assets: a * t, le: a * t,
    script: `The expense is recognised but not paid, so net income falls ${fmt.num(a * (1 - t), 1)} while the accrued liability rises ${fmt.num(a, 0)}. Adding that working capital increase back leaves cash up ${fmt.num(a * t, 1)}, which is just the tax saved. Assets rise ${fmt.num(a * t, 1)}; liabilities rise ${fmt.num(a, 0)} and retained earnings fall ${fmt.num(a * (1 - t), 1)}, so it balances.`,
    follow: ["What happens when you actually pay it?", "Why is accrual accounting different from cash accounting here?", "Where would an auditor look for this?"],
  }),
  "Cash collected in advance (deferred revenue) +$X": (a) => ({
    is: [["No revenue recognised yet (ASC 606: no performance obligation satisfied)", 0]],
    cf: [["Increase in deferred revenue", a], ["Cash from operations", a], ["Net change in cash", a]],
    bs: [["Cash", a], ["Total assets", a], ["Deferred revenue", a], ["Total liabilities + equity", a]],
    ni: 0, cash: a, assets: a, le: a,
    script: `Collecting cash before delivering creates an obligation, not revenue. Cash rises ${fmt.num(a, 0)} and deferred revenue, a liability, rises ${fmt.num(a, 0)}. Nothing reaches the income statement until the service is delivered, which is why a fast-growing subscription business can show strong cash from operations well before the revenue appears.`,
    follow: ["Why is deferred revenue a liability?", "What does this do to working capital, and is negative working capital bad here?", "How would you value a company with large deferred revenue?"],
  }),
  "Inventory write-down of $X": (a, t) => ({
    is: [["Cost of goods sold / impairment", a], ["Pre-tax income", -a], ["Taxes", -a * t], ["Net income", -a * (1 - t)]],
    cf: [["Net income", -a * (1 - t)], ["Add back non-cash write-down", a], ["Cash from operations", a * t], ["Net change in cash", a * t]],
    bs: [["Cash", a * t], ["Inventory", -a], ["Total assets", -a * (1 - t)], ["Retained earnings", -a * (1 - t)], ["Total liabilities + equity", -a * (1 - t)]],
    ni: -a * (1 - t), cash: a * t, assets: -a * (1 - t), le: -a * (1 - t),
    script: `The write-down is non-cash: net income falls ${fmt.num(a * (1 - t), 1)}, the full ${fmt.num(a, 0)} is added back, and cash rises ${fmt.num(a * t, 1)} on the tax deduction. Inventory falls ${fmt.num(a, 0)} so assets fall ${fmt.num(a * (1 - t), 1)}, matched by retained earnings. It is the same mechanical shape as a depreciation increase.`,
    follow: ["How is this different from a goodwill impairment?", "Can you write it back up under US GAAP?", "Would you add it back to get to adjusted EBITDA?"],
  }),
  "Issue $X of stock, hold the cash": (a) => ({
    is: [["No income statement impact", 0]],
    cf: [["Stock issued (financing)", a], ["Net change in cash", a]],
    bs: [["Cash", a], ["Total assets", a], ["Common stock and APIC", a], ["Total liabilities + equity", a]],
    ni: 0, cash: a, assets: a, le: a,
    script: `Cash rises ${fmt.num(a, 0)} and paid-in capital rises ${fmt.num(a, 0)}. Equity value rises by ${fmt.num(a, 0)} because the company now holds ${fmt.num(a, 0)} more cash, but enterprise value is unchanged: you added ${fmt.num(a, 0)} to equity value and subtract the same ${fmt.num(a, 0)} of cash in the bridge. That is the classic follow-up.`,
    follow: ["What happens to enterprise value?", "What happens to EPS?", "What if the cash is used to repay debt instead?"],
  }),
  "Repay $X of debt with cash": (a) => ({
    is: [["No immediate impact; interest expense falls going forward", 0]],
    cf: [["Debt repaid (financing)", -a], ["Net change in cash", -a]],
    bs: [["Cash", -a], ["Total assets", -a], ["Debt", -a], ["Total liabilities + equity", -a]],
    ni: 0, cash: -a, assets: -a, le: -a,
    script: `Cash falls ${fmt.num(a, 0)} and debt falls ${fmt.num(a, 0)}, so both sides of the balance sheet shrink and there is no immediate income statement effect. Net debt is unchanged, so enterprise value is unchanged - the company swapped one non-operating item for another. From next period, interest expense is lower, so net income rises.`,
    follow: ["Why is enterprise value unchanged?", "What happens to the leverage ratio?", "What happens to the interest coverage ratio next year?"],
  }),
  "Stock-based compensation expense of $X": (a, t) => ({
    is: [["Operating expenses (stock-based compensation)", a], ["Pre-tax income", -a], ["Taxes", -a * t], ["Net income", -a * (1 - t)]],
    cf: [["Net income", -a * (1 - t)], ["Add back stock-based compensation", a], ["Cash from operations", a * t], ["Net change in cash", a * t]],
    bs: [["Cash", a * t], ["Total assets", a * t], ["Additional paid-in capital", a], ["Retained earnings", -a * (1 - t)], ["Total liabilities + equity", a * t]],
    ni: -a * (1 - t), cash: a * t, assets: a * t, le: a * t,
    script: `Stock compensation is an expense that never uses cash: net income falls ${fmt.num(a * (1 - t), 1)}, the full ${fmt.num(a, 0)} is added back, and cash rises ${fmt.num(a * t, 1)} on the deduction. Paid-in capital rises ${fmt.num(a, 0)} while retained earnings fall ${fmt.num(a * (1 - t), 1)}. The cost is real, but it is paid in dilution rather than cash, which is why analysts argue about whether to add it back to EBITDA.`,
    follow: ["Should stock compensation be added back to EBITDA?", "Where does the dilution show up?", "How would you treat it in a DCF?"],
  }),
  "Write off $X of receivables": (a, t) => ({
    is: [["Bad debt expense", a], ["Pre-tax income", -a], ["Taxes", -a * t], ["Net income", -a * (1 - t)]],
    cf: [["Net income", -a * (1 - t)], ["Add back non-cash provision", a], ["Cash from operations", a * t], ["Net change in cash", a * t]],
    bs: [["Cash", a * t], ["Accounts receivable, net", -a], ["Total assets", -a * (1 - t)], ["Retained earnings", -a * (1 - t)], ["Total liabilities + equity", -a * (1 - t)]],
    ni: -a * (1 - t), cash: a * t, assets: -a * (1 - t), le: -a * (1 - t),
    script: `Recognising the loss costs ${fmt.num(a * (1 - t), 1)} of net income, and because the provision is non-cash it is added back, leaving cash up ${fmt.num(a * t, 1)} on the tax deduction. Net receivables fall ${fmt.num(a, 0)}, so assets fall ${fmt.num(a * (1 - t), 1)}, matched by retained earnings. Note that revenue was already recognised when the sale was made - this is the correction.`,
    follow: ["What if the receivable had already been reserved for?", "What does a rising allowance tell you about revenue quality?", "How does days sales outstanding move?"],
  }),
  "Capitalize $X instead of expensing it": (a, t) => ({
    is: [["Operating expenses", -a], ["Pre-tax income", a], ["Taxes", a * t], ["Net income", a * (1 - t)]],
    cf: [["Net income", a * (1 - t)], ["Cash from operations", a * (1 - t)], ["Capitalised cost (investing)", -a], ["Net change in cash", -a * t]],
    bs: [["Cash", -a * t], ["Capitalised asset", a], ["Total assets", a * (1 - t)], ["Retained earnings", a * (1 - t)], ["Total liabilities + equity", a * (1 - t)]],
    ni: a * (1 - t), cash: -a * t, assets: a * (1 - t), le: a * (1 - t),
    script: `Compared with expensing it, capitalising ${fmt.num(a, 0)} lifts net income by ${fmt.num(a * (1 - t), 1)} and moves the outflow from operating to investing, so cash from operations looks ${fmt.num(a * (1 - t), 1)} better. Total cash is actually ${fmt.num(a * t, 1)} worse, because you gave up the immediate tax deduction. You capitalise when the spending creates a benefit beyond one year - and this is exactly why analysts compare capex-adjusted cash flow rather than cash from operations alone.`,
    follow: ["When is capitalising appropriate?", "How would you adjust the comps for a peer that expenses it?", "What happens to EBITDA?"],
  }),
  "Buy back $X of stock": (a) => ({
    is: [["No income statement impact; EPS rises on a lower share count", 0]],
    cf: [["Share repurchase (financing)", -a], ["Net change in cash", -a]],
    bs: [["Cash", -a], ["Total assets", -a], ["Treasury stock (contra-equity)", -a], ["Total liabilities + equity", -a]],
    ni: 0, cash: -a, assets: -a, le: -a,
    script: `Cash falls ${fmt.num(a, 0)} and equity falls ${fmt.num(a, 0)} through treasury stock, so the balance sheet shrinks on both sides. Net income is unchanged but the share count falls, so EPS rises - which is why buybacks can flatter EPS growth without any operating improvement. Equity value falls by the cash paid out; enterprise value is unchanged.`,
    follow: ["Why is enterprise value unchanged?", "Is a buyback always good for shareholders?", "What happens if the buyback is funded with debt?"],
  }),
};

const threeStatement: ToolDef = {
  kind: "calc", id: "three-statement-impact", title: "Three-statement impact", tagline: "Any transaction walked through the income statement, cash flow and balance sheet.",
  description: "The single most-asked accounting question, computed exactly: pick a transaction and an amount, and it shows every affected line on all three statements with the right sign, proves that assets still equal liabilities plus equity, and gives you the spoken answer in under sixty seconds.",
  roles: ["student"], specialties: [ACCT, CORP, IB, UND], category: "Accounting & audit", icon: "Layers", savesMinutes: 20, tags: ["three statements", "accounting", "linkages"],
  fields: [
    { key: "scenario", label: "Transaction", type: "select", required: true, options: Object.keys(FLOWS), default: "Depreciation +$X" },
    { key: "amount", label: "Amount (X)", type: "number", unit: "$mm", required: true, default: 10 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 40 },
  ],
  example: { scenario: "Depreciation +$X", amount: 10, taxRate: 40 },
  compute: (i: Inputs): WorkflowOutput => {
    const key = str(i, "scenario"), a = num(i, "amount"), t = num(i, "taxRate") / 100;
    const build = FLOWS[key];
    if (!build) throw new Error(`Pick a transaction. Available: ${Object.keys(FLOWS).join("; ")}`);
    if (a <= 0) throw new Error("Amount must be positive.");
    if (t < 0 || t >= 1) throw new Error("Tax rate must be between 0% and 100%.");
    const c = build(a, t);
    const balanced = Math.abs(c.assets - c.le) < 1e-9;
    const sign = (v: number) => (v === 0 ? "no change" : `${v > 0 ? "+" : ""}${fmt.num(v, 1)}`);
    return {
      title: key.replace("$X", fmt.money(a, 0)),
      summary: `${c.script} Assets change by ${sign(c.assets)} and liabilities plus equity by ${sign(c.le)}, so the balance sheet ${balanced ? "still balances" : "does not balance - check the inputs"}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Net income", value: sign(c.ni), tone: c.ni < 0 ? "neg" : c.ni > 0 ? "pos" : "neutral" },
          { label: "Cash", value: sign(c.cash), tone: c.cash < 0 ? "neg" : c.cash > 0 ? "pos" : "neutral" },
          { label: "Total assets", value: sign(c.assets) },
          { label: "Liabilities + equity", value: sign(c.le) },
          { label: "Balance check", value: balanced ? "Balances" : "Broken", tone: balanced ? "pos" : "neg", hint: "Assets minus liabilities and equity" },
        ] },
        { type: "table", title: "Line by line (USD mm)", columns: ["Statement", "Line", "Change"], rows: [
          ...c.is.map(([l, v]) => ["Income statement", l, v === 0 ? "no change" : sign(v)] as (string | number | null)[]),
          ...c.cf.map(([l, v]) => ["Cash flow statement", l, sign(v)] as (string | number | null)[]),
          ...c.bs.map(([l, v]) => ["Balance sheet", l, sign(v)] as (string | number | null)[]),
        ], note: `Computed at a ${fmt.pct(t, 0)} tax rate. Positive means the line increases.` },
        { type: "waterfall", title: "Net income to change in cash (USD mm)", format: "money", steps: [
          { label: "Net income", value: c.ni, total: true },
          ...c.cf.filter(([l]) => !/^Net income|^Cash from operations$|^Net change in cash$/.test(l)).map(([l, v]) => ({ label: l, value: v })),
          { label: "Change in cash", value: c.cash, total: true },
        ] },
        { type: "callout", tone: "info", title: "Say it in under sixty seconds", text: c.script },
        { type: "qa", title: "The follow-ups", items: c.follow.map((q) => ({ q, a: "Answer it out loud before reading the explanation above, then check yourself against the line-by-line table." })) },
      ],
      caveats: [
        "Taxes are assumed to be paid in cash in the same period at the marginal rate; in reality a deferred tax asset or liability may absorb part of the effect.",
        "The capitalise-versus-expense case is shown as the difference from expensing the same amount, which is how the question is asked.",
        "Every case here balances by construction. If your own walk-through does not balance, you have missed either the tax effect or the retained earnings entry.",
      ],
      nextSteps: ["Do the same transaction at a 0% and a 25% tax rate and notice what only the tax rate changes", "Try the two cases where cash moves but net income does not", "Run the technical drill engine on the accounting bucket"],
    };
  },
};

/** A constant-growth DCF with the mid-year convention, sized to be done in five minutes. */
const dcfQuick: ToolDef = {
  kind: "calc", id: "dcf-five-minute", title: "Five-minute DCF", tagline: "Unlevered free cash flow, mid-year discounting, and a WACC × growth grid.",
  description: "The simplified DCF you can build in an interview: constant growth and margin, unlevered free cash flow from EBIT, mid-year discounting, a Gordon growth terminal value cross-checked against the implied exit multiple, and a sensitivity grid. It also reports terminal value as a share of enterprise value, which is the number interviewers probe.",
  roles: ["student"], specialties: [IB, ERHF, CORP, PEVC], category: "Valuation", icon: "Gauge", savesMinutes: 45, tags: ["DCF", "mid-year convention", "terminal value"],
  fields: [
    { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", required: true, default: 11800 },
    { key: "growth", label: "Revenue growth", type: "number", unit: "% a year", default: 12 },
    { key: "ebitMargin", label: "EBIT margin", type: "number", unit: "%", default: 17 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
    { key: "daPct", label: "D&A", type: "number", unit: "% of revenue", default: 3.5 },
    { key: "capexPct", label: "Capex", type: "number", unit: "% of revenue", default: 5 },
    { key: "nwcPct", label: "Change in NWC", type: "number", unit: "% of incremental revenue", default: 2 },
    { key: "years", label: "Projection years", type: "number", default: 5, min: 3, max: 10 },
    { key: "wacc", label: "WACC", type: "number", unit: "%", default: 8.5 },
    { key: "terminalGrowth", label: "Terminal growth", type: "number", unit: "%", default: 2.5 },
    { key: "netDebt", label: "Net debt (negative = net cash)", type: "number", unit: "$mm", default: -2000 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "mm", default: 1360 },
  ],
  example: { revenue: 11800, growth: 12, ebitMargin: 17, taxRate: 25, daPct: 3.5, capexPct: 5, nwcPct: 2, years: 5, wacc: 8.5, terminalGrowth: 2.5, netDebt: -2000, shares: 1360 },
  prefill: (c) => ({
    revenue: c.ltm.revenue ?? 1000,
    growth: c.ltm.revenue && c.ltm.priorRevenue ? Math.round((c.ltm.revenue / c.ltm.priorRevenue - 1) * 100) : 10,
    ebitMargin: c.ltm.revenue && c.ltm.operatingIncome !== null ? Math.round((c.ltm.operatingIncome / c.ltm.revenue) * 100) : 15,
    daPct: c.ltm.revenue && c.ltm.da !== null ? Math.round((c.ltm.da / c.ltm.revenue) * 1000) / 10 : 4,
    capexPct: c.ltm.revenue && c.ltm.capex !== null ? Math.round((c.ltm.capex / c.ltm.revenue) * 1000) / 10 : 5,
    netDebt: (c.balance.debt ?? 0) - (c.balance.cash ?? 0),
    shares: c.balance.sharesOut ?? 100,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    const rev0 = num(i, "revenue"), g = num(i, "growth") / 100, m = num(i, "ebitMargin") / 100, t = num(i, "taxRate") / 100;
    const daP = num(i, "daPct") / 100, cxP = num(i, "capexPct") / 100, nwcP = num(i, "nwcPct") / 100;
    const yrs = Math.round(num(i, "years", 5)), w = num(i, "wacc") / 100, gT = num(i, "terminalGrowth") / 100;
    const nd = num(i, "netDebt"), sh = num(i, "shares");
    if (rev0 <= 0) throw new Error("LTM revenue must be positive.");
    if (sh <= 0) throw new Error("Diluted shares must be positive.");
    if (w <= gT) throw new Error(`WACC of ${fmt.pct(w, 1)} must exceed terminal growth of ${fmt.pct(gT, 1)}, or the perpetuity is meaningless.`);
    const evAt = (wacc: number, gt: number) => {
      let pv = 0, fcfN = 0, ebitdaN = 0;
      for (let y = 1; y <= yrs; y++) {
        const rev = rev0 * Math.pow(1 + g, y), prev = rev0 * Math.pow(1 + g, y - 1);
        const ebit = rev * m, da = rev * daP;
        const fcf = ebit * (1 - t) + da - rev * cxP - (rev - prev) * nwcP;
        pv += fcf / Math.pow(1 + wacc, y - 0.5);
        if (y === yrs) { fcfN = fcf; ebitdaN = ebit + da; }
      }
      const tv = (fcfN * (1 + gt)) / (wacc - gt), pvTv = tv / Math.pow(1 + wacc, yrs);
      return { pv, pvTv, ev: pv + pvTv, fcfN, ebitdaN, tv };
    };
    const base = evAt(w, gT);
    const rows = Array.from({ length: yrs }, (_, k) => {
      const y = k + 1, rev = rev0 * Math.pow(1 + g, y), prev = rev0 * Math.pow(1 + g, y - 1);
      const ebit = rev * m, da = rev * daP, nopat = ebit * (1 - t), cx = rev * cxP, dn = (rev - prev) * nwcP;
      const fcf = nopat + da - cx - dn, df = 1 / Math.pow(1 + w, y - 0.5);
      return { y, rev, ebit, nopat, da, cx, dn, fcf, df, pv: fcf * df };
    });
    const eq = base.ev - nd, perShare = eq / sh;
    const waccs = [w - 0.02, w - 0.01, w, w + 0.01, w + 0.02], gts = [gT - 0.01, gT - 0.005, gT, gT + 0.005, gT + 0.01];
    return {
      title: "Five-minute DCF",
      summary: `Discounting ${yrs} years of unlevered free cash flow at ${fmt.pct(w, 1)} with the mid-year convention gives ${fmt.money(base.pv)} of present value, and the Gordon growth terminal value adds ${fmt.money(base.pvTv)}, for an enterprise value of ${fmt.money(base.ev)}. After ${nd < 0 ? `adding ${fmt.money(-nd)} of net cash` : `subtracting ${fmt.money(nd)} of net debt`}, equity value is ${fmt.money(eq)}, or ${fmt.moneyRaw(perShare, 2)} a share. Terminal value is ${fmt.pct(base.pvTv / base.ev, 0)} of enterprise value, so most of the answer is the terminal assumption.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Enterprise value", value: fmt.money(base.ev) },
          { label: "Equity value", value: fmt.money(eq) },
          { label: "Value per share", value: fmt.moneyRaw(perShare, 2) },
          { label: "Terminal value / EV", value: fmt.pct(base.pvTv / base.ev, 0), tone: base.pvTv / base.ev > 0.8 ? "warn" : "neutral", hint: "Usually 60-80%; above that the forecast is doing no work" },
          { label: "Implied exit EV/EBITDA", value: fmt.x(base.ebitdaN > 0 ? base.tv / base.ebitdaN : null), hint: "Cross-check the perpetuity against trading comps" },
          { label: "Year 1 unlevered FCF", value: fmt.money(rows[0].fcf) },
        ] },
        { type: "table", title: "Unlevered free cash flow (USD mm)", columns: ["Year", "Revenue", "EBIT", "NOPAT", "+ D&A", "- Capex", "- ΔNWC", "Unlevered FCF", "Discount factor", "PV"],
          rows: rows.map((r) => [`Y${r.y}`, fmt.num(r.rev, 0), fmt.num(r.ebit, 0), fmt.num(r.nopat, 0), fmt.num(r.da, 0), fmt.num(-r.cx, 0), fmt.num(-r.dn, 0), fmt.num(r.fcf, 0), r.df.toFixed(3), fmt.num(r.pv, 0)]),
          totals: ["Sum of PV", "", "", "", "", "", "", "", "", fmt.num(base.pv, 0)],
          note: "Unlevered FCF = EBIT x (1 - tax) + D&A - capex - increase in net working capital. The discount factor uses t - 0.5 because cash arrives through the year, which lifts present value by roughly 6-7% versus year-end discounting." },
        { type: "waterfall", title: "Enterprise value to value per share (USD mm)", format: "money", steps: [
          { label: "PV of forecast FCF", value: base.pv },
          { label: "PV of terminal value", value: base.pvTv },
          { label: "Enterprise value", value: base.ev, total: true },
          { label: nd < 0 ? "Plus net cash" : "Less net debt", value: -nd },
          { label: "Equity value", value: eq, total: true },
        ] },
        { type: "sensitivity", title: "Value per share: WACC × terminal growth", rowLabel: "WACC", colLabel: "Terminal growth", rows: waccs.map((x) => fmt.pct(x, 1)), cols: gts.map((x) => fmt.pct(x, 1)),
          values: waccs.map((x) => gts.map((y) => (x <= y ? null : (evAt(x, y).ev - nd) / sh))), format: "num", baseRow: 2, baseCol: 2 },
        { type: "columns", title: "Unlevered free cash flow (USD mm)", format: "money", data: rows.map((r) => ({ label: `Y${r.y}`, value: r.fcf })) },
      ],
      caveats: [
        "Growth and margin are held constant, which is the point of a five-minute DCF; a real model fades both and builds revenue bottom-up.",
        "Mid-year convention (discount at t - 0.5). Use end-of-period discounting for highly seasonal cash flows or a mid-year transaction close.",
        "Terminal growth must sit at or below long-run nominal GDP, roughly 2-3%. Always cross-check the implied exit multiple against comps, and the implied growth if you start from a multiple.",
        "Tax is applied to EBIT with no benefit from net operating losses, and stock-based compensation is treated as a non-cash item inside EBIT rather than deducted.",
      ],
      nextSteps: ["Justify the discount rate with the WACC calculator", "Compare the implied exit multiple to a peer median", "Run the DCF walkthrough workflow to get the same answer from a real filing"],
    };
  },
};

/** The MOIC-to-IRR conversion table PE candidates are expected to know from memory. */
const moicIrr: ToolDef = {
  kind: "calc", id: "moic-to-irr", title: "MOIC to IRR table", tagline: "Convert between multiple and rate of return, and memorise the anchors.",
  description: "Converts a multiple of invested capital into an internal rate of return for any hold period, and prints the full grid so the five-year anchors can be memorised: 1.5x is about 8.4%, 2.0x about 15%, 2.5x about 20%, 3.0x about 25% and 5.0x about 38%. Also solves the reverse - the multiple needed to clear a target IRR.",
  roles: ["student"], specialties: [PEVC, IB], category: "Modeling", icon: "Percent", savesMinutes: 15, tags: ["IRR", "MOIC", "returns"],
  fields: [
    { key: "moic", label: "MOIC", type: "number", unit: "x", required: true, default: 2.5 },
    { key: "years", label: "Hold period", type: "number", unit: "years", required: true, default: 5, min: 1, max: 15 },
    { key: "targetIrr", label: "Target IRR", type: "number", unit: "%", default: 20 },
  ],
  example: { moic: 2.5, years: 5, targetIrr: 20 },
  compute: (i: Inputs): WorkflowOutput => {
    const moic = num(i, "moic"), yrs = num(i, "years", 5), target = num(i, "targetIrr") / 100;
    if (moic <= 0) throw new Error("MOIC must be positive.");
    if (yrs <= 0) throw new Error("Hold period must be positive.");
    const irr = irrFromMoic(moic, yrs);
    const needMoic = Math.pow(1 + target, yrs);
    const needYears = target > 0 && moic > 1 ? Math.log(moic) / Math.log(1 + target) : null;
    const doubling = target > 0 ? Math.log(2) / Math.log(1 + target) : null;
    const moics = [1.5, 1.75, 2, 2.25, 2.5, 3, 4, 5], holds = [3, 4, 5, 6, 7];
    const baseRow = moics.findIndex((m) => Math.abs(m - moic) < 1e-9);
    const baseCol = holds.findIndex((h) => Math.abs(h - yrs) < 1e-9);
    return {
      title: "MOIC to IRR",
      summary: `A ${fmt.x(moic, 2)} MOIC over ${fmt.num(yrs, 1)} years is a ${fmt.pct(irr, 1)} IRR, because IRR = MOIC^(1/years) - 1 = ${moic.toFixed(2)}^(1/${yrs}) - 1. To clear ${fmt.pct(target, 0)} over the same period you would need ${fmt.x(needMoic, 2)}${needYears !== null ? `, and this ${fmt.x(moic, 2)} would clear ${fmt.pct(target, 0)} only if it were reached in ${needYears.toFixed(1)} years` : ""}. Money doubles every ${doubling !== null ? doubling.toFixed(1) : "n/a"} years at ${fmt.pct(target, 0)}, which the rule of 72 approximates as ${target > 0 ? (0.72 / target).toFixed(1) : "n/a"}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "IRR", value: fmt.pct(irr, 1), tone: irr !== null && irr >= target ? "pos" : "warn" },
          { label: "MOIC", value: fmt.x(moic, 2) },
          { label: `MOIC needed for ${fmt.pct(target, 0)}`, value: fmt.x(needMoic, 2) },
          { label: `Years to hit ${fmt.pct(target, 0)} at this MOIC`, value: needYears === null ? "n/a" : `${needYears.toFixed(1)} yrs` },
          { label: "Doubling time at target", value: doubling === null ? "n/a" : `${doubling.toFixed(1)} yrs` },
        ] },
        { type: "sensitivity", title: "IRR: MOIC × hold period", rowLabel: "MOIC", colLabel: "Years", rows: moics.map((m) => fmt.x(m, 2)), cols: holds.map(String),
          values: moics.map((m) => holds.map((h) => irrFromMoic(m, h))), format: "pct", baseRow: baseRow >= 0 ? baseRow : undefined, baseCol: baseCol >= 0 ? baseCol : undefined },
        { type: "table", title: "The five-year anchors to memorise", columns: ["MOIC", "5-year IRR", "Say it as"], rows: [
          ["1.5x", fmt.pct(irrFromMoic(1.5, 5), 1), "about 8%"], ["2.0x", fmt.pct(irrFromMoic(2, 5), 1), "about 15%"],
          ["2.5x", fmt.pct(irrFromMoic(2.5, 5), 1), "about 20%"], ["3.0x", fmt.pct(irrFromMoic(3, 5), 1), "about 25%"],
          ["4.0x", fmt.pct(irrFromMoic(4, 5), 1), "about 32%"], ["5.0x", fmt.pct(irrFromMoic(5, 5), 1), "about 38%"],
        ], note: "These are the numbers a sponsor expects you to convert in your head. Learn the five-year column first, then the three- and seven-year columns." },
        { type: "line", title: "IRR by hold period at this MOIC", format: "pct", series: [{ name: `${fmt.x(moic, 2)} MOIC`, points: Array.from({ length: 10 }, (_, k) => ({ x: `${k + 1}y`, y: irrFromMoic(moic, k + 1) })) }] },
      ],
      caveats: [
        "This is the single-cash-flow case: one investment at entry and one exit, no dividends, recapitalisations or follow-ons. With interim cash flows you need a full XIRR.",
        "IRR is time-weighted and MOIC is absolute, which is why both are quoted: a 2.0x in three years (26% IRR) beats a 3.0x in ten years (12%).",
        "A dividend recapitalisation pulls cash forward and raises IRR while barely moving MOIC, which is why sponsors like them and LPs scrutinise them.",
      ],
      nextSteps: ["Cover the table and convert 2.2x over 4 years in your head", "Check a paper LBO answer against the anchors before quoting the IRR", "Redo the paper LBO calculator at a one-turn lower exit multiple and watch the IRR"],
    };
  },
};

/** Compound annual growth rate, doubling time, and the compounding path. */
const cagrCalc: ToolDef = {
  kind: "calc", id: "cagr-and-growth", title: "CAGR & growth path", tagline: "Compound annual growth, doubling time, and the gap versus straight-line.",
  description: "Computes the compound annual growth rate between two values over any period, the total growth, the doubling time and the rule-of-72 approximation, and plots the compounded path against the straight-line path so the difference between average growth and compound growth is visible.",
  roles: ["student"], specialties: [CONSULT, CORP, ERHF, UND], category: "Modeling", icon: "LineChart", savesMinutes: 10, tags: ["CAGR", "growth", "compounding"],
  fields: [
    { key: "begin", label: "Beginning value", type: "number", unit: "$mm", required: true, default: 5435 },
    { key: "end", label: "Ending value", type: "number", unit: "$mm", required: true, default: 11800 },
    { key: "years", label: "Years between them", type: "number", required: true, default: 5, min: 0.25, max: 50, step: 0.25 },
    { key: "forecastYears", label: "Extend the path", type: "number", unit: "years", default: 3, min: 0, max: 20 },
  ],
  example: { begin: 5435, end: 11800, years: 5, forecastYears: 3 },
  prefill: (c) => ({ begin: c.ltm.priorRevenue ?? 0, end: c.ltm.revenue ?? 0, years: 1, forecastYears: 3 }),
  compute: (i: Inputs): WorkflowOutput => {
    const b = num(i, "begin"), e = num(i, "end"), y = num(i, "years", 5), fwd = Math.round(num(i, "forecastYears", 0));
    if (b <= 0) throw new Error("Beginning value must be positive to compute a compound rate.");
    if (e <= 0) throw new Error("Ending value must be positive to compute a compound rate.");
    if (y <= 0) throw new Error("Years must be positive.");
    const cagr = Math.pow(e / b, 1 / y) - 1, total = e / b - 1;
    const simple = total / y;
    const doubling = cagr > 0 ? Math.log(2) / Math.log(1 + cagr) : null;
    const n = Math.ceil(y) + fwd;
    const path = Array.from({ length: n + 1 }, (_, k) => ({ k, comp: b * Math.pow(1 + cagr, k), lin: b + (e - b) * (k / y) }));
    const ends = [e * 0.8, e * 0.9, e, e * 1.1, e * 1.2], spans = [y - 1, y - 0.5, y, y + 0.5, y + 1].filter((s) => s > 0);
    return {
      title: "Compound annual growth rate",
      summary: `Going from ${fmt.money(b)} to ${fmt.money(e)} over ${fmt.num(y, 2)} years is a ${fmt.pct(cagr, 1)} CAGR: (${fmt.num(e, 0)} / ${fmt.num(b, 0)})^(1/${fmt.num(y, 2)}) - 1. Total growth is ${fmt.pct(total, 1)}, which divided by the years would suggest ${fmt.pct(simple, 1)} a year - the difference is compounding, and quoting the simple average is a common interview error. At this rate the value doubles every ${doubling === null ? "n/a" : doubling.toFixed(1)} years, which the rule of 72 approximates as ${cagr > 0 ? (0.72 / cagr).toFixed(1) : "n/a"}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "CAGR", value: fmt.pct(cagr, 2), tone: cagr > 0 ? "pos" : "neg" },
          { label: "Total growth", value: fmt.pct(total, 1) },
          { label: "Simple average (wrong)", value: fmt.pct(simple, 1), tone: "warn", hint: "Total growth divided by years ignores compounding" },
          { label: "Doubling time", value: doubling === null ? "n/a" : `${doubling.toFixed(1)} yrs` },
          { label: "Rule of 72 estimate", value: cagr > 0 ? `${(0.72 / cagr).toFixed(1)} yrs` : "n/a" },
          { label: `Value in ${fwd} more years`, value: fmt.money(b * Math.pow(1 + cagr, y + fwd)) },
        ] },
        { type: "table", title: "Implied path (USD mm)", columns: ["Year", "Compounded", "Straight line", "Difference"],
          rows: path.map((p) => [`Y${p.k}`, fmt.num(p.comp, 0), p.k <= y ? fmt.num(p.lin, 0) : null, p.k <= y ? fmt.num(p.comp - p.lin, 0) : null]),
          note: "The straight-line column stops at the observed end point; the compounded column continues into the extension." },
        { type: "line", title: "Compounded versus straight-line growth (USD mm)", format: "money", series: [
          { name: "Compounded", points: path.map((p) => ({ x: `Y${p.k}`, y: p.comp })) },
          { name: "Straight line", points: path.map((p) => ({ x: `Y${p.k}`, y: p.k <= y ? p.lin : null })) },
        ] },
        { type: "sensitivity", title: "CAGR: ending value × years", rowLabel: "Ending value", colLabel: "Years", rows: ends.map((v) => fmt.money(v)), cols: spans.map((s) => fmt.num(s, 2)),
          values: ends.map((v) => spans.map((s) => Math.pow(v / b, 1 / s) - 1)), format: "pct", baseRow: 2, baseCol: spans.indexOf(y) >= 0 ? spans.indexOf(y) : undefined },
      ],
      caveats: [
        "CAGR describes only the two end points, so it hides volatility: a name that fell 50% then tripled has the same CAGR as a smooth compounder.",
        "Use calendar years consistently. A fiscal-year comparison against a calendar-year peer will misstate the rate, which is why comps are calendarised.",
        "For quarterly data, use the number of quarters divided by four as the year count rather than annualising a single quarter.",
      ],
      nextSteps: ["Recompute using the first and last fiscal years from a 10-K five-year selected financial data table", "Compare the CAGR to the peer median in the comps explainer", "Use the rate as the growth input in the five-minute DCF"],
    };
  },
};

/** Accretion / dilution with the P/E rule of thumb and the break-even synergy solve. */
const accretionQuick: ToolDef = {
  kind: "calc", id: "accretion-dilution-rule", title: "Accretion / dilution quick", tagline: "Pro forma EPS, the P/E rule check, and break-even synergies.",
  description: "Prices a deal at your premium and consideration mix, then computes pro forma earnings per share after new interest, foregone interest on cash used and after-tax synergies, reports accretion or dilution, solves for the synergies that break even, and checks the answer against the rule of thumb about the buyer's and seller's price-earnings ratios.",
  roles: ["student"], specialties: [IB, CORP, PEVC], category: "Modeling", icon: "Split", savesMinutes: 40, tags: ["accretion", "merger model", "EPS"],
  fields: [
    { key: "acqPrice", label: "Acquirer share price", type: "number", unit: "$/share", required: true, default: 62 },
    { key: "acqShares", label: "Acquirer diluted shares", type: "number", unit: "mm", required: true, default: 1480 },
    { key: "acqNi", label: "Acquirer net income", type: "number", unit: "$mm", required: true, default: 3200 },
    { key: "tgtPrice", label: "Target share price", type: "number", unit: "$/share", required: true, default: 55 },
    { key: "tgtShares", label: "Target diluted shares", type: "number", unit: "mm", required: true, default: 152 },
    { key: "tgtNi", label: "Target net income", type: "number", unit: "$mm", required: true, default: 640 },
    { key: "premium", label: "Premium to market", type: "number", unit: "%", default: 30 },
    { key: "cashPct", label: "Cash consideration", type: "number", unit: "%", default: 60 },
    { key: "debtFunded", label: "Cash funded with new debt", type: "number", unit: "%", default: 100, help: "The rest comes off the balance sheet and gives up interest income" },
    { key: "kd", label: "Interest rate on new debt", type: "number", unit: "%", default: 5.5 },
    { key: "cashYield", label: "Yield given up on balance-sheet cash", type: "number", unit: "%", default: 4 },
    { key: "taxRate", label: "Acquirer tax rate", type: "number", unit: "%", default: 25 },
    { key: "synergies", label: "Run-rate pre-tax synergies", type: "number", unit: "$mm", default: 120 },
  ],
  example: { acqPrice: 62, acqShares: 1480, acqNi: 3200, tgtPrice: 55, tgtShares: 152, tgtNi: 640, premium: 30, cashPct: 60, debtFunded: 100, kd: 5.5, cashYield: 4, taxRate: 25, synergies: 120 },
  compute: (i: Inputs): WorkflowOutput => {
    const pA = num(i, "acqPrice"), shA = num(i, "acqShares"), niA = num(i, "acqNi");
    const pT = num(i, "tgtPrice"), shT = num(i, "tgtShares"), niT = num(i, "tgtNi");
    const prem = num(i, "premium") / 100, cashPct = num(i, "cashPct") / 100, dFund = num(i, "debtFunded") / 100;
    const kd = num(i, "kd") / 100, cy = num(i, "cashYield") / 100, t = num(i, "taxRate") / 100, syn = num(i, "synergies");
    if (pA <= 0 || shA <= 0) throw new Error("Acquirer price and diluted shares must be positive.");
    if (pT <= 0 || shT <= 0) throw new Error("Target price and diluted shares must be positive.");
    if (cashPct < 0 || cashPct > 1) throw new Error("Cash consideration must be between 0% and 100%.");
    const epsA = niA / shA, epsT = niT / shT;
    const offerPx = pT * (1 + prem), offerVal = offerPx * shT;
    const cashCons = offerVal * cashPct, stockCons = offerVal - cashCons;
    const newShares = stockCons / pA, newDebt = cashCons * dFund, cashUsed = cashCons - newDebt;
    const at = (v: number) => v * (1 - t);
    const pf = (s: number) => {
      const ni = niA + niT + at(s) - at(newDebt * kd) - at(cashUsed * cy);
      return { ni, shares: shA + newShares, eps: ni / (shA + newShares) };
    };
    const base = pf(syn), accretion = base.eps / epsA - 1;
    const beSyn = (epsA * base.shares - niA - niT + at(newDebt * kd) + at(cashUsed * cy)) / (1 - t);
    const peA = epsA > 0 ? pA / epsA : null, peTOffer = epsT > 0 ? offerPx / epsT : null;
    const tgtYield = epsT > 0 ? epsT / offerPx : null, costOfCash = kd * (1 - t);
    const prems = [0, 0.1, 0.2, 0.3, 0.4, 0.5], mixes = [0, 0.25, 0.5, 0.75, 1];
    const grid = prems.map((p) => mixes.map((mx) => {
      const ov = pT * (1 + p) * shT, cc = ov * mx, ns = (ov - cc) / pA, nd = cc * dFund, cu = cc - nd;
      const ni = niA + niT + at(syn) - at(nd * kd) - at(cu * cy);
      return ni / (shA + ns) / epsA - 1;
    }));
    return {
      title: "Accretion / dilution",
      summary: `At a ${fmt.pct(prem, 0)} premium the offer is ${fmt.moneyRaw(offerPx, 2)} a share, or ${fmt.money(offerVal)} of equity value, funded ${fmt.pct(cashPct, 0)} cash and ${fmt.pct(1 - cashPct, 0)} stock (${fmt.num(newShares, 1)}mm new shares). Pro forma EPS is ${fmt.moneyRaw(base.eps, 2)} against ${fmt.moneyRaw(epsA, 2)} standalone, so the deal is ${accretion >= 0 ? "accretive" : "dilutive"} by ${fmt.pct(Math.abs(accretion), 1)}. ${beSyn <= 0 ? `It is accretive with no synergies at all: it could absorb ${fmt.money(-beSyn)} of pre-tax dis-synergies before turning dilutive.` : `Break-even pre-tax synergies are ${fmt.money(beSyn)}, versus the ${fmt.money(syn)} assumed.`}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Offer per share", value: fmt.moneyRaw(offerPx, 2), hint: `${fmt.moneyRaw(pT, 2)} x (1 + ${fmt.pct(prem, 0)})` },
          { label: "Offer equity value", value: fmt.money(offerVal) },
          { label: "Standalone EPS", value: fmt.moneyRaw(epsA, 2) },
          { label: "Pro forma EPS", value: fmt.moneyRaw(base.eps, 2) },
          { label: "Accretion / (dilution)", value: fmt.pct(accretion, 1), tone: accretion >= 0 ? "pos" : "neg" },
          { label: beSyn <= 0 ? "Dis-synergy cushion" : "Break-even synergies", value: fmt.money(Math.abs(beSyn)), tone: beSyn <= syn ? "pos" : "warn", hint: beSyn <= 0 ? "Pre-tax dis-synergies it could absorb before turning dilutive" : "Pre-tax synergies needed for zero accretion" },
        ] },
        { type: "table", title: "Deal build (USD mm unless stated)", columns: ["Item", "Value", "Formula"], rows: [
          ["Acquirer EPS", fmt.moneyRaw(epsA, 2), "Net income / diluted shares"],
          ["Target EPS", fmt.moneyRaw(epsT, 2), "Net income / diluted shares"],
          ["Offer price per share", fmt.moneyRaw(offerPx, 2), "Target price x (1 + premium)"],
          ["Offer equity value", fmt.num(offerVal, 0), "Offer price x target diluted shares"],
          ["Cash consideration", fmt.num(cashCons, 0), `${fmt.pct(cashPct, 0)} of offer value`],
          ["Stock consideration", fmt.num(stockCons, 0), "Offer value less cash"],
          ["New shares issued (mm)", fmt.num(newShares, 1), "Stock consideration / acquirer price"],
          ["New debt", fmt.num(newDebt, 0), `${fmt.pct(dFund, 0)} of the cash portion`],
          ["Balance-sheet cash used", fmt.num(cashUsed, 0), "Cash portion less new debt"],
          ["After-tax new interest", fmt.num(at(newDebt * kd), 0), `New debt x ${fmt.pct(kd, 2)} x (1 - ${fmt.pct(t, 0)})`],
          ["After-tax foregone interest", fmt.num(at(cashUsed * cy), 0), `Cash used x ${fmt.pct(cy, 2)} x (1 - ${fmt.pct(t, 0)})`],
          ["After-tax synergies", fmt.num(at(syn), 0), `${fmt.num(syn, 0)} x (1 - ${fmt.pct(t, 0)})`],
          ["Pro forma net income", fmt.num(base.ni, 0), "Sum of the above"],
          ["Pro forma diluted shares (mm)", fmt.num(base.shares, 1), "Acquirer shares + new shares"],
          ["Pro forma EPS", fmt.moneyRaw(base.eps, 2), "Pro forma net income / pro forma shares"],
        ], emphasisRow: 14 },
        { type: "waterfall", title: "Standalone to pro forma net income (USD mm)", format: "money", steps: [
          { label: "Acquirer net income", value: niA, total: true },
          { label: "Target net income", value: niT },
          { label: "After-tax synergies", value: at(syn) },
          { label: "After-tax new interest", value: -at(newDebt * kd) },
          { label: "Foregone interest on cash", value: -at(cashUsed * cy) },
          { label: "Pro forma net income", value: base.ni, total: true },
        ] },
        { type: "sensitivity", title: "Accretion / (dilution): premium × cash consideration", rowLabel: "Premium", colLabel: "Cash %", rows: prems.map((p) => fmt.pct(p, 0)), cols: mixes.map((m) => fmt.pct(m, 0)), values: grid, format: "pct", baseRow: 3, baseCol: 2 },
        { type: "table", title: "The rules of thumb, checked", columns: ["Test", "Value", "Says"], rows: [
          ["Acquirer P/E", fmt.x(peA, 1), "All-stock deals are accretive when the buyer's P/E exceeds the seller's at the offer"],
          ["Target P/E at the offer", fmt.x(peTOffer, 1), peA !== null && peTOffer !== null && peA > peTOffer ? "Buyer's P/E is higher, so an all-stock deal would be accretive" : "Buyer's P/E is lower, so an all-stock deal would be dilutive"],
          ["Target after-tax earnings yield", fmt.pct(tgtYield, 2), "Cash or debt funding is accretive when this exceeds the after-tax cost of the funding"],
          ["After-tax cost of new debt", fmt.pct(costOfCash, 2), tgtYield !== null && tgtYield > costOfCash ? "Yield beats the cost, so the cash portion is accretive" : "Cost exceeds the yield, so the cash portion is dilutive"],
        ] },
      ],
      caveats: [
        "Accretion is not value creation: buying any lower-P/E target is mechanically accretive and says nothing about whether the price was right.",
        "This is a year-one, pre-synergy-phasing view with no purchase accounting: real models add amortisation of identifiable intangibles, a deferred tax liability on write-ups, transaction fees expensed and financing fees capitalised, all of which reduce accretion.",
        "Synergies are applied at the run rate from day one. Phasing them over two or three years and netting the cost to achieve is the honest version.",
        "Both companies' earnings are held flat, so this isolates the deal's effect rather than forecasting the businesses.",
      ],
      nextSteps: ["Run the same deal on two real tickers with the merger consequences workflow", "Find the premium that takes accretion to zero", "Try it all-stock and all-cash and explain the difference out loud"],
    };
  },
};

/** WACC built from peer betas: unlever, take the median, relever, then weight. */
const waccScratch: ToolDef = {
  kind: "calc", id: "wacc-from-scratch", title: "WACC from peer betas", tagline: "Unlever each peer, relever at your structure, then weight the costs.",
  description: "Builds the weighted average cost of capital the way a valuation is defended: unlever each peer's observed beta with the Hamada formula, take the median so one outlier cannot set the answer, relever it at the target capital structure, run CAPM for the cost of equity, and weight it against the after-tax cost of debt.",
  roles: ["student"], specialties: [IB, ERHF, CORP, ACCT], category: "Valuation", icon: "Radar", savesMinutes: 35, tags: ["WACC", "beta", "CAPM"],
  fields: [
    { key: "peers", label: "Peer betas", type: "csv", required: true, columns: "ticker,levered_beta,debt_to_equity_pct", default: "ticker,levered_beta,debt_to_equity_pct\nNKE,1.05,18\nLULU,1.28,8\nDECK,1.15,5\nONON,1.40,12\nSKX,1.10,22", help: "One row per peer: its observed levered beta and its debt-to-equity ratio in percent" },
    { key: "rf", label: "Risk-free rate", type: "number", unit: "%", default: 4.2, help: "The 10-year Treasury yield" },
    { key: "erp", label: "Equity risk premium", type: "number", unit: "%", default: 5.5 },
    { key: "sizePremium", label: "Size premium", type: "number", unit: "%", default: 0 },
    { key: "targetDe", label: "Target debt / equity", type: "number", unit: "%", default: 20 },
    { key: "kd", label: "Pre-tax cost of debt", type: "number", unit: "%", default: 6 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 25 },
  ],
  example: { peers: "ticker,levered_beta,debt_to_equity_pct\nNKE,1.05,18\nLULU,1.28,8\nDECK,1.15,5\nONON,1.40,12\nSKX,1.10,22", rf: 4.2, erp: 5.5, sizePremium: 0, targetDe: 20, kd: 6, taxRate: 25 },
  compute: (i: Inputs): WorkflowOutput => {
    const rf = num(i, "rf") / 100, erp = num(i, "erp") / 100, size = num(i, "sizePremium") / 100;
    const targetDe = num(i, "targetDe") / 100, kd = num(i, "kd") / 100, t = num(i, "taxRate") / 100;
    if (t < 0 || t >= 1) throw new Error("Tax rate must be between 0% and 100%.");
    const parsed = parseCsv(str(i, "peers"));
    const raw = [...(Number.isFinite(Number(parsed.header[1])) ? [parsed.header] : []), ...parsed.rows];
    const peers = raw.map((r) => ({ name: String(r[0] ?? "peer"), bl: Number(r[1]), de: Number(r[2]) / 100 }))
      .filter((p) => Number.isFinite(p.bl) && Number.isFinite(p.de) && p.bl > 0);
    if (!peers.length) throw new Error("Enter at least one peer row as ticker,levered_beta,debt_to_equity_pct.");
    const rows = peers.map((p) => ({ ...p, bu: p.bl / (1 + (1 - t) * p.de) }));
    const medUn = median(rows.map((r) => r.bu));
    const relevered = medUn * (1 + (1 - t) * targetDe);
    const ke = rf + relevered * erp + size, kdAfter = kd * (1 - t);
    const wd = targetDe / (1 + targetDe), we = 1 - wd;
    const wacc = we * ke + wd * kdAfter;
    const betas = [relevered - 0.2, relevered - 0.1, relevered, relevered + 0.1, relevered + 0.2].map((b) => Math.max(0.05, b));
    const erps = [erp - 0.01, erp - 0.005, erp, erp + 0.005, erp + 0.01];
    return {
      title: "WACC from peer betas",
      summary: `Unlevering the ${rows.length} peer betas gives a median unlevered beta of ${medUn.toFixed(2)}, which relevered at a ${fmt.pct(targetDe, 0)} debt-to-equity ratio is ${relevered.toFixed(2)}. CAPM then gives a cost of equity of ${fmt.pct(ke, 2)} = ${fmt.pct(rf, 2)} + ${relevered.toFixed(2)} x ${fmt.pct(erp, 2)}${size > 0 ? ` + ${fmt.pct(size, 2)}` : ""}. Weighting that ${fmt.pct(we, 0)} against an after-tax cost of debt of ${fmt.pct(kdAfter, 2)} at ${fmt.pct(wd, 0)} gives a WACC of ${fmt.pct(wacc, 2)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "WACC", value: fmt.pct(wacc, 2) },
          { label: "Cost of equity", value: fmt.pct(ke, 2) },
          { label: "After-tax cost of debt", value: fmt.pct(kdAfter, 2) },
          { label: "Median unlevered beta", value: medUn.toFixed(2) },
          { label: "Relevered beta", value: relevered.toFixed(2) },
          { label: "Equity / debt weights", value: `${fmt.pct(we, 0)} / ${fmt.pct(wd, 0)}` },
        ] },
        { type: "table", title: "Unlevering the peers", columns: ["Peer", "Levered beta", "Debt / equity", "Unlevered beta", "Formula"],
          rows: rows.map((r) => [r.name, r.bl.toFixed(2), fmt.pct(r.de, 0), r.bu.toFixed(2), `${r.bl.toFixed(2)} / (1 + (1 - ${fmt.pct(t, 0)}) x ${fmt.pct(r.de, 0)})`]),
          totals: ["Median", "", "", medUn.toFixed(2), "Median, not mean, so one outlier cannot set the answer"] },
        { type: "table", title: "WACC build", columns: ["Component", "Value", "Note"], rows: [
          ["Risk-free rate", fmt.pct(rf, 2), "10-year Treasury yield on the valuation date"],
          ["Relevered beta", relevered.toFixed(2), `Median unlevered x (1 + (1 - ${fmt.pct(t, 0)}) x ${fmt.pct(targetDe, 0)})`],
          ["Equity risk premium", fmt.pct(erp, 2), "Typically 5-6% for US large caps"],
          ["Size premium", fmt.pct(size, 2), "From published decile studies for small caps; zero for large caps"],
          ["Cost of equity", fmt.pct(ke, 2), "CAPM: rf + beta x ERP + premia"],
          ["Pre-tax cost of debt", fmt.pct(kd, 2), "Yield on the company's own debt or a comparable rating"],
          ["After-tax cost of debt", fmt.pct(kdAfter, 2), `Pre-tax x (1 - ${fmt.pct(t, 0)}); interest is deductible`],
          ["WACC", fmt.pct(wacc, 2), `${fmt.pct(we, 0)} x cost of equity + ${fmt.pct(wd, 0)} x after-tax cost of debt`],
        ], emphasisRow: 7 },
        { type: "sensitivity", title: "WACC: relevered beta × equity risk premium", rowLabel: "Beta", colLabel: "ERP", rows: betas.map((b) => b.toFixed(2)), cols: erps.map((e) => fmt.pct(e, 1)),
          values: betas.map((b) => erps.map((e) => we * (rf + b * e + size) + wd * kdAfter)), format: "pct", baseRow: 2, baseCol: 2 },
        { type: "bar", title: "Cost of capital components", format: "pct", data: [
          { label: "Cost of equity", value: ke }, { label: "After-tax cost of debt", value: kdAfter }, { label: "WACC", value: wacc, emphasis: true },
        ], reference: { value: wacc, label: "WACC" } },
      ],
      caveats: [
        "The Hamada unlevering formula assumes a debt beta of zero and a constant capital structure, so it overstates the equity risk borne by highly levered peers.",
        "Weights must use market values of equity and debt, and the target structure rather than today's, if the structure is expected to change.",
        "Betas are inputs here: source them from a provider or regress returns against an index yourself, and say which index and window you used.",
        "Size and company-specific premiums are judgment calls; cite the study rather than picking a number, and expect to defend it.",
      ],
      nextSteps: ["Feed this WACC into the five-minute DCF and see how much the answer moves", "Recompute at the peer median debt-to-equity to check the relevering", "Explain out loud why the cost of equity exceeds the cost of debt"],
    };
  },
};

export const STUDENT_PACK: ToolDef[] = [
  // AI workflows: the research's top 10
  technicalDrill, mockInterview, recruitingCalendar, stockPitch, timedModelTest, modelAuditor, networking, learningPath, resumeCoach, casePartner,
  // AI workflows: concept explainers on real companies
  accountingExplainer, dcfWalkthrough, evEquityExplainer, compsExplainer, precedentsExplainer, lboIntuition, mergerConsequences,
  // AI workflows: drills, stories, firm-side research
  brainteasers, behavioralBank, firmBrief, dealWalkthrough, coveragePrimer, cfaCpaQuiz, first10k,
  // Calculators
  paperLbo, evBridge, tsmShares, threeStatement, dcfQuick, moicIrr, cagrCalc, accretionQuick, waccScratch,
];
