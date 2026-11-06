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
import { summarize, tickerOf } from "@/lib/book/position";
import { failureMessage } from "@/lib/errors";
import { siteLink } from "@/lib/site";
import { withSources, type McpServer } from "./protocol";

const OFFERED = new Set(["get_company_financials", "get_trading_comps", "search_companies", "search_filing", "read_filing", "edgar_fulltext_search", "read_document", "get_recent_filings", "get_xbrl_series", "get_insider_transactions", "calc", "form_d_search", "search_startups"]);

const TITLES: Record<string, string> = {
  get_company_financials: "Company fundamentals (SEC XBRL)", get_trading_comps: "Trading comps", search_companies: "Find a company", search_filing: "Search a filing",
  read_filing: "Read a filing section", edgar_fulltext_search: "EDGAR full-text search", read_document: "Read an SEC document", get_recent_filings: "Recent filings",
  get_xbrl_series: "XBRL time series", get_insider_transactions: "Insider transactions", calc: "Calculator", form_d_search: "Private raises (Form D)", search_startups: "Startup directory",
  filing_changes: "What changed in the 10-K / 10-Q", ticker_news: "News for a ticker", book_status: "My book: which theses hold",
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
          kill_criteria: e.checks.map((c) => ({ criterion: `${c.label} ${c.target}`, now: c.shown, state: c.state, source: c.evidence ? ctx.addSource(`${e.ticker} ${c.label}: ${c.evidence.source}, ${c.evidence.period}`, c.evidence.url) : null })),
          catalysts: e.catalysts.map((c) => ({ label: c.label, date: c.date, in_days: c.inDays })),
        })),
      });
    },
  });
}

export function mcpServer(userId: string): McpServer {
  const defs: ToolDef<unknown>[] = [...ALL_TOOLS.filter((t) => OFFERED.has(t.name)), filingChangesTool as unknown as ToolDef<unknown>, tickerNewsTool as unknown as ToolDef<unknown>, bookTool(userId) as unknown as ToolDef<unknown>];
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
