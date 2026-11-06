/**
 * YouBank as an MCP server: the research tools the in-app AI uses, offered to the person's own AI apps
 * (Claude, ChatGPT, Cursor, an in-house agent) under their account. Every figure comes back with the
 * source it is from (SEC XBRL facts, the filing, the price feed), so an answer written elsewhere can be
 * checked the same way as one written here. Read-only: nothing here trades, sends or changes anything.
 *
 * What is offered: company fundamentals and comps from SEC XBRL, filing search and reading (sec.gov
 * only), EDGAR full-text search, recent filings, XBRL series, insider transactions, what changed in the
 * latest 10-K or 10-Q, private raises (Form D) and startups, a calculator, this week's Newsroom stories
 * for a ticker, and the person's Book with each thesis checked. Web research is left out: it spends the
 * person's AI allowance, which belongs to the app. The answers to every call are written to the
 * person's research ledger when it is on (src/lib/ledger).
 */
import { z } from "zod";
import { ALL_TOOLS, def, type Source, type ToolCtx, type ToolDef } from "@/lib/ai/tools";
import { filingChangesTool } from "@/lib/ai/filing-changes-tool";
import { evaluateBook, loadBook, newsFor } from "@/lib/book/store";
import { METRIC_KEYS, normalizePosition, summarize, tickerOf } from "@/lib/book/position";
import { failureMessage } from "@/lib/errors";
import { siteLink } from "@/lib/site";
import { withSources, type McpPrompt, type McpServer } from "./protocol";

const OFFERED = new Set(["get_company_financials", "get_trading_comps", "search_companies", "search_filing", "read_filing", "edgar_fulltext_search", "read_document", "get_recent_filings", "get_xbrl_series", "get_insider_transactions", "calc", "form_d_search", "search_startups"]);

const TITLES: Record<string, string> = {
  get_company_financials: "Company fundamentals (SEC XBRL)", get_trading_comps: "Trading comps", search_companies: "Find a company", search_filing: "Search a filing",
  read_filing: "Read a filing section", edgar_fulltext_search: "EDGAR full-text search", read_document: "Read an SEC document", get_recent_filings: "Recent filings",
  get_xbrl_series: "XBRL time series", get_insider_transactions: "Insider transactions", calc: "Calculator", form_d_search: "Private raises (Form D)", search_startups: "Startup directory",
  filing_changes: "What changed in the 10-K / 10-Q", ticker_news: "News for a ticker", check_thesis: "Check kill criteria now", book_status: "My book: which theses hold",
};

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
  description: "Check a thesis's kill criteria against a company's SEC XBRL filings and price right now, the way YouBank's Book does, without saving anything. Give the ticker, long or short, and criteria (metric, >= or <=, threshold; percentages as percent, 20 = 20%). Returns each criterion's figure, period, source, headroom and state (pass, near, fail, unknown) and the overall verdict. Metrics: revenue_growth, gross_margin, operating_margin, fcf_margin, rule_of_40, revenue ($M), net_debt ($M), ev_revenue, pe, price.",
  schema: z.object({
    ticker: z.string().min(1).max(12),
    direction: z.enum(["long", "short"]).default("long"),
    thesis: z.string().max(280).optional(),
    criteria: z.array(z.object({ metric: z.enum(METRIC_KEYS as [string, ...string[]]), op: z.enum([">=", "<="]), value: z.number() })).min(1).max(8),
  }),
  run: async ({ ticker, direction, thesis, criteria }, ctx) => {
    const p = normalizePosition({ ticker, direction, thesis: thesis || `${direction} ${ticker}`, criteria });
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
    description: "The signed-in person's Book in YouBank: each position (long or short, weight, entry) with its thesis checked against SEC filings and the price. Says which theses are broken, on watch or intact, the figure behind every kill criterion with its period and source, exposure (gross, net, at risk) and P&L since entry. Optionally for one ticker.",
    schema: z.object({ ticker: z.string().max(12).optional() }),
    run: async ({ ticker }, ctx) => {
      const book = await loadBook(userId);
      const only = ticker ? tickerOf(ticker) : null;
      const positions = only ? book.filter((p) => p.ticker === only) : book;
      if (!positions.length) return JSON.stringify({ note: only ? `${only} is not in the book.` : "The book is empty. Positions are added in YouBank → Book.", link: siteLink("/app/book") });
      const evals = await evaluateBook(positions);
      return JSON.stringify({
        summary: summarize(evals), link: siteLink("/app/book"),
        positions: evals.map((e) => ({
          ticker: e.ticker, name: e.name, direction: e.direction, weight_pct_nav: e.weight, verdict: e.verdict, score: e.score, price: e.price, pnl_since_entry: e.pnl, summary: e.summary,
          thesis: positions.find((p) => p.id === e.positionId)?.thesis,
          kill_criteria: e.checks.map((c) => ({ criterion: `${c.label} ${c.target}`, now: c.shown, headroom: c.headroom?.shown ?? null, state: c.state, source: c.evidence ? ctx.addSource(`${e.ticker} ${c.label}: ${c.evidence.source}, ${c.evidence.period}`, c.evidence.url) : null })),
          catalysts: e.catalysts.map((c) => ({ label: c.label, date: c.date, in_days: c.inDays })),
        })),
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
      "4. End with three things I should decide or check this week.",
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
      `4. book_status for ${tick(ticker)}: which kill criteria the report could break, and the numbers that would do it.`,
      "End with the five questions I should want answered on the call.",
      CITE,
    ].join("\n"),
  },
];

export function mcpServer(userId: string): McpServer {
  const defs: ToolDef<unknown>[] = [...ALL_TOOLS.filter((t) => OFFERED.has(t.name)), filingChangesTool as unknown as ToolDef<unknown>, tickerNewsTool as unknown as ToolDef<unknown>, checkThesisTool as unknown as ToolDef<unknown>, bookTool(userId) as unknown as ToolDef<unknown>];
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
      return { name: t.name, title: TITLES[t.name] ?? t.name, description: t.description, inputSchema: { type: "object", ...inputSchema } };
    }),
    describeError: (e) => failureMessage(e, "mcp.tool"),
    prompts: PROMPTS,
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
