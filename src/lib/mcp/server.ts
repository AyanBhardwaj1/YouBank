/**
 * YouBank as an MCP server: the research tools the in-app AI uses, offered to the person's own AI apps
 * (Claude, ChatGPT, Cursor, an in-house agent) under their account. Every figure comes back with the
 * source it is from (SEC XBRL facts, the filing, the price feed), so an answer written elsewhere can be
 * checked the same way as one written here. Nothing here trades, sends or changes the person's data; the
 * one tool that writes (propose_position) leaves a proposal for the person to review, never a position.
 *
 * What is offered: company fundamentals and comps from SEC XBRL, filing search and reading (sec.gov
 * only), EDGAR full-text search, recent filings, XBRL series, insider transactions, what changed in the
 * latest 10-K or 10-Q, private raises (Form D) and startups, a calculator, this week's Newsroom stories
 * for a ticker, the person's Book with each thesis checked, the Book's risk (beta, VaR, correlated bets,
 * stress replays), any kill criteria checked on demand (check_thesis), and a position proposed for the person
 * to review (propose_position); plus seven ready-made prompts. Web research is left out: it spends the
 * person's AI allowance, which belongs to the app. The answers to every call are written to the
 * person's research ledger when it is on (src/lib/ledger).
 */
import { z } from "zod";
import { ALL_TOOLS, def, type Source, type ToolCtx, type ToolDef } from "@/lib/ai/tools";
import { filingChangesTool } from "@/lib/ai/filing-changes-tool";
import { addProposal, evaluateBook, holdingFacts, loadBook, loadBookHistory, loadJournal, loadProposals, newsFor, noteProposal } from "@/lib/book/store";
import { weekBrief } from "@/lib/book/week";
import { priceBaseRate } from "@/lib/book/baserate";
import { lintLetter } from "@/lib/book/letter";
import { governance, periodOf } from "@/lib/ledger/governance";
import { governanceRows, ledgerSettings } from "@/lib/ledger/store";
import { calibrationOf, closedReturn, CLOSE_REASONS, scorecard, scorecardLine } from "@/lib/book/journal";
import { calibrationLine } from "@/lib/book/forecast";
import { PROPOSAL_CARD, PROPOSAL_CARD_URI } from "./apps";
import { proposalFrom } from "@/lib/book/proposals";
import { METRIC_KEYS, normalizePosition, summarize, tickerOf } from "@/lib/book/position";
import { filingLine } from "@/lib/book/filings";
import { riskLine, whatIfLine } from "@/lib/book/risk";
import { cachedRisk, riskOf, riskWhatIf } from "@/lib/book/risk-store";
import { failureMessage } from "@/lib/errors";
import { siteLink } from "@/lib/site";
import { withSources, type McpPrompt, type McpServer } from "./protocol";
import { DEFAULT_POLICY, toolAllowed, type KeyPolicy } from "./keys";

const OFFERED = new Set(["get_company_financials", "get_trading_comps", "search_companies", "search_filing", "read_filing", "edgar_fulltext_search", "read_document", "get_recent_filings", "get_xbrl_series", "get_insider_transactions", "calc", "form_d_search", "search_startups"]);

const TITLES: Record<string, string> = {
  get_company_financials: "Company fundamentals (SEC XBRL)", get_trading_comps: "Trading comps", search_companies: "Find a company", search_filing: "Search a filing",
  read_filing: "Read a filing section", edgar_fulltext_search: "EDGAR full-text search", read_document: "Read an SEC document", get_recent_filings: "Recent filings",
  get_xbrl_series: "XBRL time series", get_insider_transactions: "Insider transactions", calc: "Calculator", form_d_search: "Private raises (Form D)", search_startups: "Startup directory",
  filing_changes: "What changed in the 10-K / 10-Q", ticker_news: "News for a ticker", check_thesis: "Check kill criteria now", book_status: "My book: which theses hold",
  book_risk: "My book's risk and stress tests", book_track_record: "My track record and calibration", book_week: "My book this week", compliance_check: "Compliance check for investor text", propose_position: "Propose a position for my review",
};
/** Tools that write something (a proposal only); every other tool is read-only. */
const WRITES = new Set(["propose_position"]);

/** This week's Newsroom stories that name a ticker, most important first, with links into YouBank. */
const tickerNewsTool = def({
  name: "ticker_news",
  description: "This week's YouBank Newsroom stories that name a ticker (clustered across outlets, most important first), each with a link. Use for 'what is the news on X'.",
  schema: z.object({ ticker: z.string().min(1).max(12) }),
  run: async ({ ticker }, ctx) => {
    const t = tickerOf(ticker);
    if (!t) return JSON.stringify({ error: `Not a ticker: ${ticker}` });
    const stories = (await newsFor([t])).get(t) ?? [];
    return JSON.stringify({ ticker: t, stories: stories.map((s) => ({ headline: s.headline, first_seen: s.at, source: ctx.addSource(s.headline, siteLink(`/app/news?story=${s.id}`)) })), note: stories.length ? undefined : "No stories naming this ticker in the last seven days." });
  },
});


/** Check kill criteria for any ticker now, without saving: the Book's check, on demand. */
const checkThesisTool = def({
  name: "check_thesis",
  description: "Check a thesis's kill criteria against a company's SEC XBRL filings and price right now, the way YouBank's Book does, without saving anything. Give the ticker, long or short, and criteria (metric, >= or <=, threshold; percentages as percent, 20 = 20%). Returns each criterion's figure, period, source, headroom and state (pass, near, fail, unknown) and the overall verdict. Metrics: revenue_growth, gross_margin, operating_margin, fcf_margin, rule_of_40, revenue ($M), net_debt ($M), ev_revenue, pe, price, insider_selling (open-market net selling over 90 days from Form 4s, $M; only when YouBank has a complete figure for the name), return_since_entry (a stop-loss in % from entry_price, in the position's favour: >= -15 means out if down 15%).",
  schema: z.object({
    ticker: z.string().min(1).max(12),
    direction: z.enum(["long", "short"]).default("long"),
    thesis: z.string().max(280).optional(),
    entry_price: z.number().positive().optional().describe("Needed for return_since_entry"),
    criteria: z.array(z.object({ metric: z.enum(METRIC_KEYS as [string, ...string[]]), op: z.enum([">=", "<="]), value: z.number() })).min(1).max(8),
  }),
  run: async ({ ticker, direction, thesis, entry_price, criteria }, ctx) => {
    const p = normalizePosition({ ticker, direction, thesis: thesis || `${direction} ${ticker}`, criteria, entry: entry_price });
    if (!p) return JSON.stringify({ error: `Not a ticker: ${ticker}` });
    const [e] = await evaluateBook([p]);
    if (!e || e.verdict === "unknown") return JSON.stringify({ ticker: p.ticker, verdict: "unknown", note: "The company's filings could not be read just now, or it is not a US SEC filer." });
    return JSON.stringify({
      ticker: e.ticker, name: e.name, direction: e.direction, verdict: e.verdict, score: e.score, summary: e.summary,
      criteria: e.checks.map((c) => ({ criterion: `${c.label} ${c.target}`, now: c.shown, headroom: c.headroom?.shown ?? null, state: c.state, source: c.evidence ? ctx.addSource(`${e.ticker} ${c.label}: ${c.evidence.source}, ${c.evidence.period}`, c.evidence.url) : null })),
      note: "Nothing was saved. Add the position in YouBank → Book to have it checked after every close.",
    });
  },
});

/** The person's Book: every position's thesis checked against filings and price, most urgent first. */
function bookTool(userId: string) {
  return def({
    name: "book_status",
    description: "The signed-in person's Book in YouBank: each position (long or short, weight, entry) with its thesis checked against SEC filings and the price. Says which theses are broken, on watch or intact, the figure behind every kill criterion with its period and source, exposure (gross, net, at risk) and P&L since entry, and a one-line risk headline when today's risk is already worked out (book_risk always has it). Where set, the PM's own forecast and the AI investment committee's last decision (add, hold, trim or exit, with its forecast and dissent). Optionally for one ticker.",
    schema: z.object({ ticker: z.string().max(12).optional() }),
    run: async ({ ticker }, ctx) => {
      const book = await loadBook(userId);
      const only = ticker ? tickerOf(ticker) : null;
      const positions = only ? book.filter((p) => p.ticker === only) : book;
      if (!positions.length) return JSON.stringify({ note: only ? `${only} is not in the book.` : "The book is empty. Positions are added in YouBank → Book.", link: siteLink("/app/book") });
      const [evals, risk, closed] = await Promise.all([evaluateBook(positions), only ? Promise.resolve(null) : cachedRisk(book).catch(() => null), only ? Promise.resolve([]) : loadJournal(userId).catch(() => [])]);
      return JSON.stringify({
        summary: summarize(evals), link: siteLink("/app/book"),
        // The risk headline when it is already worked out today (book_risk has the detail and works it out).
        ...(risk ? { risk: riskLine(risk) } : {}),
        // The track record over closed positions: hit rate, payoff, and how fast broken theses were exited.
        ...(closed.length ? { track_record: scorecardLine(scorecard(closed)) } : {}),
        positions: evals.map((e) => ({
          ticker: e.ticker, name: e.name, direction: e.direction, weight_pct_nav: e.weight, verdict: e.verdict, score: e.score, price: e.price, pnl_since_entry: e.pnl, summary: e.summary,
          thesis: positions.find((p) => p.id === e.positionId)?.thesis,
          ...(() => {
            const p = positions.find((x) => x.id === e.positionId);
            return {
              ...(p?.conviction ? { pm_forecast: { no_kill_criterion_fails_pct: Math.round(p.conviction.p * 100), by: p.conviction.by, source: p.conviction.source } } : {}),
              ...(() => {
                // The price base rate (baserate.ts) when today's risk is worked out: a starting point for a forecast.
                const vol = risk?.positions.find((x) => x.ticker === e.ticker)?.vol ?? null;
                const by = p?.conviction?.by ?? new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
                const b = p ? priceBaseRate(p, e.price, vol, by, new Date()) : null;
                return b ? { price_base_rate: { price_lines_hold_pct: Math.round(b.p * 100), by, volatility_pct: vol, note: "From price volatility alone (driftless random walk); fundamental criteria not included." } } : {};
              })(),
              ...(p?.committee ? { ai_committee: { decision: p.committee.decision, on: p.committee.at.slice(0, 10), rationale: p.committee.rationale, dissent: p.committee.dissent, watch: p.committee.watch, ...(p.committee.forecast ? { no_kill_criterion_fails_pct: Math.round(p.committee.forecast.p * 100), by: p.committee.forecast.by } : {}) } } : {}),
            };
          })(),
          kill_criteria: e.checks.map((c) => ({ criterion: `${c.label} ${c.target}`, now: c.shown, headroom: c.headroom?.shown ?? null, state: c.state, source: c.evidence ? ctx.addSource(`${e.ticker} ${c.label}: ${c.evidence.source}, ${c.evidence.period}`, c.evidence.url) : null })),
          catalysts: e.catalysts.map((c) => ({ label: c.label, date: c.date, in_days: c.inDays })),
          next_earnings: e.earnings ? { date: e.earnings.date, estimated: e.earnings.estimated, in_days: e.earnings.inDays } : null,
          next_report_must_show: e.nextPrint?.length ? (() => {
            const src = ctx.addSource(`${e.ticker} quarterly revenue, SEC XBRL company facts (last eight quarters)`, e.checks.find((c) => c.criterion.metric.startsWith("revenue") && c.evidence)?.evidence?.url ?? "https://data.sec.gov/");
            return e.nextPrint.map((b) => ({ line: b.line, revenue_needed_usd_mm: b.settled ? null : b.need, op: b.op, implied_yoy: b.yoy, last_quarter_yoy: b.lastYoy, source: src }));
          })() : undefined,
          new_filing: e.filing ? { form: e.filing.form, filed: e.filing.filed, risk_factors: e.filing.counts, note: filingLine(e.filing), source: ctx.addSource(`${e.ticker} ${e.filing.form} filed ${e.filing.filed}`, e.filing.url) } : null,
        })),
      });
    },
  });
}


function riskTool(userId: string) {
  return def({
    name: "book_risk",
    description: "The risk of the signed-in person's Book, from a year of daily closes: beta-adjusted net exposure to the S&P 500 (SPY), annualised volatility, one-day 95% value at risk and expected shortfall (historical, today's weights), each name's beta, volatility and share of the book's risk, pairs of names that move together (a stacked bet, or a hedge), P&L for market moves of -20% to +10%, and today's book replayed through the COVID crash, the 2022 rate shock, SVB, the 2024 yen carry unwind and the April 2025 tariff shock. With what_if, before a trade: the same figures with one more position, and which holdings it moves with (more of the same bet, or a hedge). All figures are % of NAV.",
    schema: z.object({ what_if: z.object({ ticker: z.string().min(1).max(12), direction: z.enum(["long", "short"]), weight_pct_nav: z.number().gt(0).max(100) }).optional().describe("Before a trade: the book's risk with this position added, and which holdings it moves with.") }),
    run: async ({ what_if }, ctx) => {
      const book = await loadBook(userId);
      if (what_if) {
        const t = tickerOf(what_if.ticker);
        if (!t) return JSON.stringify({ error: `Not a ticker: ${what_if.ticker}` });
        const w = await riskWhatIf(book, { ticker: t, direction: what_if.direction, weight: what_if.weight_pct_nav });
        const src = ctx.addSource(`Daily closes for the held names, ${t} and SPY (${w.sources.join(", ") || "market data"})`, siteLink("/app/book?view=risk"));
        return JSON.stringify({ headline: whatIfLine(w), source: src, units: "% of NAV", ...w, sources: undefined });
      }
      if (!book.length) return JSON.stringify({ note: "The book is empty. Positions are added in YouBank → Book.", link: siteLink("/app/book") });
      const r = await riskOf(book);
      const src = ctx.addSource(`Daily closes for the held names and SPY (${r.sources.join(", ") || "market data"}), ${r.window ? `${r.window.from} to ${r.window.to}` : "no window"}`, siteLink("/app/book?view=risk"));
      return JSON.stringify({ headline: riskLine(r), source: src, link: siteLink("/app/book?view=risk"), units: "% of NAV", ...r, sources: undefined });
    },
  });
}

/** The track record: what closed and why, calibration of the forecasts (the PM's against the AI's), and process against outcome. */
function trackRecordTool(userId: string) {
  return def({
    name: "book_track_record",
    description: "The signed-in person's track record in YouBank: closed positions with their reason, return and how the thesis stood; the scorecard (hit rate, payoff, how quickly broken theses were exited, what holding past the break cost); process against outcome (wins earned by the process against lucky ones); and the calibration of every forecast on a position, scored with the Brier score, by who made it (the PM, an AI app or the AI investment committee). Returns are unweighted price moves before costs, not fund performance.",
    schema: z.object({}),
    run: async (_args, ctx) => {
      const [book, closed, history] = await Promise.all([loadBook(userId), loadJournal(userId).catch(() => []), loadBookHistory(userId).catch(() => ({}))]);
      const s = scorecard(closed);
      const cal = calibrationOf(book, history, closed);
      const src = ctx.addSource("The person's YouBank track record (closed positions and resolved forecasts)", siteLink("/app/book"));
      return JSON.stringify({
        summary: scorecardLine(s), calibration_line: calibrationLine(cal), source: src, link: siteLink("/app/book"),
        scorecard: { closed: s.closed, hit_rate: s.hitRate, avg_return: s.avgReturn, avg_win: s.avgWin, avg_loss: s.avgLoss, payoff: s.payoff, still_broken_at_close: s.broke, exited_within_5_days_of_break: s.exitedOnBreak, median_days_to_exit: s.medianDaysToExit, closed_on_break_instead: s.counterfactual, by_reason: s.byReason },
        process_vs_outcome: s.process,
        returns_by_ai_committee_call: s.byCommittee,
        calibration: { resolved: cal.n, open: cal.open, brier: cal.brier, overconfidence: cal.bias, buckets: cal.buckets, by_source: cal.bySource },
        recent_closes: closed.slice(0, 15).map((c) => ({ ticker: c.ticker, direction: c.direction, opened: c.openedAt.slice(0, 10), closed: c.closedAt.slice(0, 10), reason: CLOSE_REASONS[c.reason], return: closedReturn(c), thesis_broke_on: c.brokeOn, note: c.note || undefined })),
        units: "returns as fractions (0.12 is 12%), in the position's favour",
      });
    },
  });
}

/** The last seven days of the Book: what changed, resolved and is coming (src/lib/book/week.ts). */
function weekTool(userId: string) {
  return def({
    name: "book_week",
    description: "The last seven days of the signed-in person's Book in YouBank: theses that changed verdict (from what, to what, and the day), forecasts that resolved (held or missed), the AI investment committee's sittings, positions closed, earnings and catalysts in the next two weeks, and proposals waiting for review, with a one-line headline. For a Monday-morning review.",
    schema: z.object({}),
    run: async (_args, ctx) => {
      const now = new Date();
      const [book, history, closed, proposals] = await Promise.all([loadBook(userId), loadBookHistory(userId).catch(() => ({})), loadJournal(userId).catch(() => []), loadProposals(userId).catch(() => [])]);
      const evals = await evaluateBook(book, now);
      const w = weekBrief({ now, book, evals, history, closed, proposals });
      const src = ctx.addSource("The person's YouBank Book: daily thesis checks, forecasts and the track record", siteLink("/report/week"));
      return JSON.stringify({ ...w, source: src, link: siteLink("/report/week") });
    },
  });
}

/** The compliance pass on text the AI app (or the person) wrote for investors (src/lib/book/letter.ts lintLetter). */
function complianceTool(userId: string) {
  return def({
    name: "compliance_check",
    description: "Check text written for investors (an LP letter, a DDQ answer, a pitch paragraph) before it goes out, the way YouBank's LP letter does: promissory or guaranteeing language, unsupported superlatives, performance without a time period, gross without net, hypothetical or back-tested results, AI claims with no record behind them, claims about how AI is supervised checked against the research ledger (e.g. 'every AI output is reviewed'), and figures about the person's holdings (revenue growth, gross, operating and FCF margin) checked against their SEC filings. Rule-based and deterministic: a first read for the compliance officer, not legal advice. Returns each finding with its severity, the sentence and why.",
    schema: z.object({ text: z.string().min(1).max(20_000) }),
    run: async ({ text }, ctx) => {
      const now = new Date();
      const period = periodOf(undefined, now);
      const [book, settings, rows] = await Promise.all([loadBook(userId), ledgerSettings(userId).catch(() => null), governanceRows(userId, period.from, period.to).catch(() => null)]);
      const facts = await holdingFacts(book, now);
      const g = rows ? governance(rows.rows, period.from, period.to, rows.later) : null;
      const ledgerOn = !!settings?.on;
      const findings = lintLetter(text, { ledgerOn, record: g ? { reviewedShare: g.reviewedShare, verifiedShare: g.figures.verifiedShare, outputs: g.ai } : null, facts });
      // A check that could not run is said, never read as "nothing flagged".
      const skipped = [
        ...(ledgerOn && !g ? ["The research ledger could not be read just now, so claims about AI supervision were not checked."] : []),
        ...(book.length && !facts.length ? ["The holdings' filings could not be read just now, so figures about them were not checked."] : []),
      ];
      const src = facts.length ? ctx.addSource("SEC XBRL company facts for the held companies, as YouBank's Book reads them", siteLink("/app/book")) : null;
      return JSON.stringify({
        verdict: findings.some((f) => f.severity === "high") ? "fix before sending" : findings.some((f) => f.severity === "medium") || skipped.length ? "review" : "nothing flagged",
        ...(skipped.length ? { not_checked: skipped } : {}),
        findings: findings.map((f) => ({ severity: f.severity, rule: f.rule, sentence: f.excerpt, why: f.why })),
        checked_against: { research_ledger: !ledgerOn ? "off" : g ? "on (last 30 days)" : "unreadable", holdings_with_figures: [...new Set(facts.map((f) => f.ticker))], source: src },
        note: "A first read, not legal advice: the firm's compliance officer signs off.",
      });
    },
  });
}

/** A position the AI app proposes: kept for the person to review on the Book page, never added by itself. */
function proposeTool(userId: string, from: string) {
  return def({
    name: "propose_position",
    description: "Propose a position for the signed-in person's Book in YouBank, with a one-line thesis, pillars, kill criteria (metric, >= or <=, threshold; percentages as percent, 20 = 20%) and catalysts. It does NOT change the Book: the proposal waits on the Book page, marked as coming from this app, until the person reviews it in the editor and adds it, or dismisses it. Returns where the criteria stand today (as check_thesis would) and a link. Say why in rationale, citing the sources you used; call book_risk with what_if first to say what it would do to the book's risk. Give conviction_pct and review_by to put a scored forecast on it: YouBank resolves it and sets your calibration beside the person's. Metrics: revenue_growth, gross_margin, operating_margin, fcf_margin, rule_of_40, revenue ($M), net_debt ($M), ev_revenue, pe, price, insider_selling ($M), return_since_entry (a stop-loss in %, with entry_price: >= -15 means out if down 15%).",
    schema: z.object({
      ticker: z.string().min(1).max(12),
      direction: z.enum(["long", "short"]),
      thesis: z.string().min(5).max(280),
      pillars: z.array(z.string().max(200)).max(6).optional(),
      kill_criteria: z.array(z.object({ metric: z.enum(METRIC_KEYS as [string, ...string[]]), op: z.enum([">=", "<="]), value: z.number(), note: z.string().max(140).optional() })).min(1).max(8),
      catalysts: z.array(z.object({ label: z.string().max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(8).optional(),
      weight_pct_nav: z.number().min(0).max(100).optional(),
      entry_price: z.number().positive().optional(),
      conviction_pct: z.number().min(1).max(99).optional().describe("Your probability (1-99) that no kill criterion fails before review_by; scored for calibration"),
      review_by: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      rationale: z.string().max(600).optional(),
    }),
    run: async (args, ctx) => {
      // The one tool that writes: 30 proposals an hour per person, so a looping agent cannot crowd the book's saves.
      const { withinRate } = await import("@/lib/locks");
      if (!(await withinRate(`mcp-propose:${userId}`, 30, 3_600_000).catch(() => true))) return JSON.stringify({ error: "Many positions were proposed this hour. Ask the person to review the ones waiting in their Book." });
      const r = proposalFrom(args as Record<string, unknown>, from);
      if ("error" in r) return JSON.stringify({ error: r.error });
      const [e] = await evaluateBook([r.proposal.position]).catch(() => []);
      await addProposal(userId, r.proposal);
      const link = siteLink(`/app/book?proposal=${r.proposal.id}`);
      // The bell says a proposal is waiting (unless the person switched the Book's alerts off). Best effort.
      await noteProposal(userId, r.proposal).catch(() => undefined);
      return JSON.stringify({
        proposed: true, id: r.proposal.id, link,
        note: "Nothing was added to the Book. The person reviews the proposal on the Book page and adds or dismisses it.",
        today: e && e.verdict !== "unknown" ? { verdict: e.verdict, summary: e.summary, criteria: e.checks.map((c) => ({ criterion: `${c.label} ${c.target}`, now: c.shown, headroom: c.headroom?.shown ?? null, state: c.state, source: c.evidence ? ctx.addSource(`${e.ticker} ${c.label}: ${c.evidence.source}, ${c.evidence.period}`, c.evidence.url) : null })) } : { verdict: "unknown", note: "The company's filings could not be read just now." },
      });
    },
  });
}

const tick = (v: string | undefined) => tickerOf(v ?? "") ?? (v ?? "").toUpperCase().slice(0, 10);
const CITE = "Cite every figure with the source id the tool returned ([S1], [S2], …) and do not state a number no tool returned. If a tool has no data, say so.";

/** Ready-made requests for the person's AI app (its slash menu): each names the YouBank tools to use. */
export const PROMPTS: McpPrompt[] = [
  {
    name: "book_review", title: "Review my book", description: "Which theses are broken or close to breaking, why, what changed this week, and what to look at next.",
    arguments: [],
    build: () => [
      "Review my book in YouBank.",
      "1. Call book_status. Lead with the positions whose thesis is broken, then those on watch, with the kill criterion, the figure and its source for each, and the % of NAV at risk.",
      "2. For each broken or on-watch name, call ticker_news and filing_changes (10-Q, section mdna) to find what moved it.",
      "3. Then the intact names in one line each, and any catalyst in the next two weeks.",
      "4. Call book_risk: the beta-adjusted net, the one-day VaR, any stacked bets, and the worst stress replay, in three lines.",
      "5. End with three things I should decide or check this week.",
      CITE,
    ].join("\n"),
  },
  {
    name: "red_team", title: "Argue against a position", description: "The strongest sourced case against a position's thesis, its weakest pillar and the signals that would prove it wrong.",
    arguments: [{ name: "ticker", description: "The position's ticker, e.g. SNOW", required: true }],
    build: ({ ticker }) => [
      `Act as a sceptical, well-informed opponent of my position in ${tick(ticker)}.`,
      `1. Call book_status with ticker ${tick(ticker)} for my thesis, pillars and kill criteria (if it is not in my book, argue against the consensus view).`,
      `2. Use get_company_financials, get_xbrl_series (revenue and margins over time), filing_changes and get_insider_transactions for ${tick(ticker)}.`,
      "3. Give the three strongest counter-arguments with evidence, the weakest pillar and why, and what would have to happen in the next two quarters to prove the thesis wrong, as checkable signals.",
      "Work alone: do not soften the case to agree with me. Under 450 words.",
      CITE,
    ].join("\n"),
  },
  {
    name: "investment_committee", title: "Convene an investment committee", description: "A bull brief and a bear brief written separately, then a chair's call (add, hold, trim or exit) with a 90-day probability and the dissent.",
    arguments: [{ name: "ticker", description: "The position's ticker, e.g. SNOW", required: true }],
    build: ({ ticker }) => [
      `Run an investment committee on my position in ${tick(ticker)}.`,
      `1. Call book_status with ticker ${tick(ticker)} for the thesis, pillars and kill criteria with where each stands, and check_thesis if it is not in my book.`,
      `2. The bull: using get_company_financials, get_xbrl_series, filing_changes and ticker_news for ${tick(ticker)}, write the strongest evidence-based case FOR the position (three arguments, the strongest pillar, two quarters of checkable signals). If you can run separate agents, write this brief in one that does not see the bear's.`,
      "3. The bear: separately, the strongest case AGAINST (three counter-arguments, the weakest pillar, the signals that would prove the thesis wrong). Do not revise the bull's brief after reading it.",
      "4. The chair: decide add, hold, trim or exit on the evidence in the two briefs and the kill criteria, not on which brief is longer. A failed kill criterion weighs toward trim or exit unless the bull shows with evidence that it is temporary. Give a calibrated probability (1-99) that no kill criterion fails in the next 90 days, the strongest point of the side that lost, and up to three signals to watch.",
      "This is advice for me to weigh; do not change my book. Under 700 words in all.",
      CITE,
    ].join("\n"),
  },
  {
    name: "lp_commentary", title: "Draft LP commentary", description: "A short investor commentary on the book from its theses, track record and the week, run through YouBank's compliance check before it is shown.",
    arguments: [{ name: "period", description: "e.g. Q4 2026 (optional)" }],
    build: ({ period }) => [
      `Draft a short commentary for our limited partners${period ? ` for ${period}` : ""}: the book, theses under pressure and why, what we closed and why, and how our process measured up.`,
      "1. Call book_status, book_track_record and book_week for the facts. Use only figures the tools returned; position returns are price moves before costs, never fund performance.",
      "2. Write under 350 words in plain language. No promises, no superlatives, no hypothetical results, and do not describe our AI use beyond what the tools show.",
      "3. Call compliance_check with your draft. Fix every high finding and say how you handled each medium one. Then show the final text, followed by the findings that remain.",
      "This is a draft for the PM to rewrite and the compliance officer to sign off.",
      CITE,
    ].join("\n"),
  },
  {
    name: "what_changed", title: "What changed in the latest filing", description: "New, dropped and reworded language in a company's latest 10-K or 10-Q against the one before, quoted.",
    arguments: [{ name: "ticker", description: "e.g. CRWD", required: true }, { name: "form", description: "10-K (default) or 10-Q" }],
    build: ({ ticker, form }) => [
      `Call filing_changes for ${tick(ticker)} with form ${form === "10-Q" ? "10-Q" : "10-K"}, first for section risk and then mdna.`,
      "Summarise what is new, what was dropped and what was reworded, most important first, quoting the language with the source id of the filing it is from. Say what each change could mean for an investor, and flag anything that touches my book (book_status).",
      CITE,
    ].join("\n"),
  },
  {
    name: "earnings_prep", title: "Earnings prep", description: "Before a company reports: the trend, what the comps show, the news, and which of my kill criteria are at stake.",
    arguments: [{ name: "ticker", description: "e.g. NVDA", required: true }],
    build: ({ ticker }) => [
      `Prepare me for ${tick(ticker)}'s next report.`,
      `1. get_company_financials and get_xbrl_series for revenue and gross margin over the last eight quarters: the trend and its turning points.`,
      `2. get_trading_comps for ${tick(ticker)}: where it trades against peers on growth and margins.`,
      `3. ticker_news and get_recent_filings for anything new since the last report.`,
      `4. book_status for ${tick(ticker)}: which kill criteria the report could break, and the numbers that would do it (next_report_must_show gives the revenue the quarter needs for each revenue criterion to hold).`,
      "End with the five questions I should want answered on the call.",
      CITE,
    ].join("\n"),
  },
  {
    name: "pre_trade_check", title: "Pre-trade check", description: "Before adding a position: where its kill criteria stand, what it does to the book's risk, what the latest filing and insiders say, and a go or no-go.",
    arguments: [{ name: "ticker", description: "e.g. AMD", required: true }, { name: "direction", description: "long (default) or short" }, { name: "weight", description: "% of NAV, e.g. 3 (default 2)" }],
    build: ({ ticker, direction, weight }) => {
      // "Short", "SHORT", "s" mean short; "3%", "3 %" mean 3. Anything unreadable falls back, and the text says so.
      const t = tick(ticker), side = /^\s*s/i.test(direction ?? "") ? "short" : "long";
      const asked = parseFloat(String(weight ?? "").replace(/[%\s]/g, "")), w = asked > 0 && asked <= 100 ? asked : 2;
      return [
        `Pre-trade check: ${side} ${t} at ${w}% of NAV${weight && w !== asked ? ` (the weight "${String(weight).slice(0, 20)}" could not be read, so 2% is used; say if that is wrong)` : ""}.`,
        `1. get_company_financials for ${t}. Propose three kill criteria that would prove a ${side} thesis wrong, and run check_thesis with them: where each stands and its headroom.`,
        `2. book_risk with what_if { ticker: ${t}, direction: ${side}, weight_pct_nav: ${w} }: beta-adjusted net, VaR and the worst replay before and after, and which holdings ${t} moves with (more of the same bet, or a hedge).`,
        `3. filing_changes for ${t} (latest 10-Q, section risk) and get_insider_transactions: anything new or any insider selling that argues against it.`,
        "4. End with go, size down, or no-go, in one line, and the single number to watch. If I say go, call propose_position with the thesis, the kill criteria and your reasoning, so it waits in my Book for review.",
        CITE,
      ].join("\n");
    },
  },
];

/** The server for one person; `from` names the calling app (its key's name) on what it proposes. */
export function mcpServer(userId: string, from = "An AI app", policy: KeyPolicy = DEFAULT_POLICY): McpServer {
  const defs: ToolDef<unknown>[] = [...ALL_TOOLS.filter((t) => OFFERED.has(t.name)), filingChangesTool as unknown as ToolDef<unknown>, tickerNewsTool as unknown as ToolDef<unknown>, checkThesisTool as unknown as ToolDef<unknown>, bookTool(userId) as unknown as ToolDef<unknown>, riskTool(userId) as unknown as ToolDef<unknown>, trackRecordTool(userId) as unknown as ToolDef<unknown>, weekTool(userId) as unknown as ToolDef<unknown>, complianceTool(userId) as unknown as ToolDef<unknown>, proposeTool(userId, from) as unknown as ToolDef<unknown>]
    // What this app may use (Settings → Connect AI apps): tools it may not use are neither listed nor callable.
    .filter((t) => toolAllowed(policy, t.name));
  return {
    name: "youbank", title: "YouBank research", version: "1.0.0",
    instructions: [
      "YouBank's research tools: US public-company fundamentals from SEC XBRL, filings and their changes, comps, insiders, private raises, news, and the person's Book of positions with each thesis checked.",
      "Every result carries source ids ([S1], [S2], …) with links. Cite them next to each figure; do not state a number a tool did not return.",
      "Amounts are USD millions unless a field says otherwise; margins and growth are fractions (0.25 = 25%).",
    ].join(" "),
    tools: defs.map((t) => {
      const inputSchema = { ...(t.parameters as Record<string, unknown>) };
      delete inputSchema.$schema;
      return { name: t.name, title: TITLES[t.name] ?? t.name, description: t.description, inputSchema: { type: "object", ...inputSchema }, ...(WRITES.has(t.name) ? { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } } : {}), ...(t.name === "propose_position" ? { _meta: { ui: { resourceUri: PROPOSAL_CARD_URI } } } : {}) };
    }),
    // MCP Apps: the card shown for a proposal, only to an app that may propose.
    resources: defs.some((t) => t.name === "propose_position") ? [PROPOSAL_CARD] : [],
    describeError: (e) => failureMessage(e, "mcp.tool"),
    // A prompt that names a tool this app may not use is not offered either.
    prompts: PROMPTS.filter((p) => (p.build({ ticker: "X" }).match(/\b(?:(?:book|propose)_[a-z_]+|compliance_check)\b/g) ?? []).every((n) => defs.some((t) => t.name === n))),
    call: async (name, args) => {
      const t = defs.find((d) => d.name === name);
      if (!t) return { text: `Unknown tool ${name}.`, isError: true };
      const parsed = t.schema.safeParse(args);
      if (!parsed.success) return { text: `Invalid arguments for ${name}: ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`, isError: true };
      const sources: Source[] = [];
      const ctx: ToolCtx = { addSource: (label, url) => { const found = sources.find((s) => s.url === url && s.label === label); if (found) return found.id; const id = `S${sources.length + 1}`; sources.push({ id, label, url }); return id; } };
      return withSources(await t.run(parsed.data, ctx), sources);
    },
  };
}
