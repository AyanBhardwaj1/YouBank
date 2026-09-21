import { z } from "zod";
import { getCompanyData, getCompanies } from "../company";
import { derive, fmtMoney, fmtPct, fmtX } from "../metrics";
import { searchTickers } from "../edgar/tickers";
import { getFilingText, searchText } from "../edgar/filingText";
import { PEER_GROUPS } from "../static-data";
import type { CompanyData } from "../types";
import { webResearch } from "./research";
import { searchFormD } from "../vc/formd";
import { searchStartups, SOURCES } from "../vc/directory";
import { fullTextSearch } from "../edgar/fulltext";
import { getSubmissions, listFilings } from "../edgar/submissions";
import { conceptSeries, findConcepts } from "../edgar/series";
import { resolveTicker } from "../edgar/tickers";
import { insiderTransactions } from "../edgar/insiders";
import { evaluateScript } from "../calc";

export type Source = { id: string; label: string; url: string };
export type ToolCtx = { addSource: (label: string, url: string) => string };
export type ToolDef<T = unknown> = {
  name: string;
  description: string;
  schema: z.ZodType<T>;
  parameters: Record<string, unknown>;
  run: (input: T, ctx: ToolCtx) => Promise<string>;
};

function def<T>(t: Omit<ToolDef<T>, "parameters">): ToolDef<T> {
  return { ...t, parameters: z.toJSONSchema(t.schema) as Record<string, unknown> };
}

function summarize(c: CompanyData, ctx: ToolCtx) {
  const d = derive(c);
  const src = ctx.addSource(`${c.ticker} SEC XBRL company facts, LTM to ${c.ltm.periodEnd} (${c.sources.concepts.revenue ?? "revenue"})`, c.sources.factsUrl);
  const px = c.price ? ctx.addSource(`${c.ticker} price and market cap, FMP, ${c.price.asOf.slice(0, 16)}Z`, `https://financialmodelingprep.com/`) : null;
  return {
    ticker: c.ticker, name: c.name, source: src, price_source: px, sic: `${c.sic} ${c.sicLabel}`, fye: c.fye, hq: c.hq, industry: c.industry,
    description: c.description.slice(0, 600),
    ltm_usd_mm: { period_end: c.ltm.periodEnd, revenue: c.ltm.revenue, prior_ltm_revenue: c.ltm.priorRevenue, revenue_growth: d.revenueGrowth, gross_profit: c.ltm.grossProfit, gross_margin: d.grossMargin,
      operating_income: c.ltm.operatingIncome, operating_margin: d.opMargin, da: c.ltm.da, ebitda_reported: c.ltm.ebitda, sbc: c.ltm.sbc, adj_ebitda_ex_sbc: c.ltm.adjEbitda,
      operating_cash_flow: c.ltm.operatingCashFlow, capex: c.ltm.capex, fcf: d.fcf, fcf_margin: d.fcfMargin, net_income: c.ltm.netIncome, rule_of_40: d.ruleOf40 },
    balance_usd_mm: { as_of: c.balance.asOf, cash_and_st_investments: c.balance.cash, debt: c.balance.debt, net_debt: d.netDebt, shares_out_mm: c.balance.sharesOut },
    valuation_usd_mm: c.price ? { price: c.price.last, change_pct: c.price.changePct, market_cap: d.marketCap, enterprise_value: d.ev, ev_to_ltm_revenue: d.evRevLtm, ev_to_ltm_ebitda: d.evEbitdaLtm, ev_to_adj_ebitda: d.evAdjEbitdaLtm, ev_to_fcf: d.evFcf, pe_ltm: d.peLtm, ntm_estimates: "not available (no estimates source)" } : null,
    quarterly_revenue: c.quarters.map((q) => `${q.label} (${q.end}): ${q.revenue}`),
    recent_filings: c.filings.slice(0, 6).map((f) => `${f.form} filed ${f.filed}${f.period ? ` for period ${f.period}` : ""}`),
    xbrl_concepts_used: c.sources.concepts, derivation_notes: c.sources.notes,
  };
}

export const getCompanyTool = def({
  name: "get_company_financials",
  description: "Fundamentals for a US-listed company from SEC XBRL (LTM income statement, cash flow, balance sheet, quarterly revenue) plus price, market cap, and EV from FMP. USD millions.",
  schema: z.object({ ticker: z.string().describe("Ticker symbol, e.g. SNOW") }),
  run: async ({ ticker }, ctx) => {
    const c = await getCompanyData(ticker);
    if (!c) return JSON.stringify({ error: `Unknown ticker ${ticker}. Use search_companies.` });
    return JSON.stringify(summarize(c, ctx));
  },
});

export const compsTool = def({
  name: "get_trading_comps",
  description: "Trading comps grid for a target and peers: EV/Revenue, EV/EBITDA, EV/FCF, growth, margins, Rule of 40, with peer median and mean. If peers are omitted, the saved peer group containing the target is used.",
  schema: z.object({ ticker: z.string(), peers: z.array(z.string()).optional().describe("Peer tickers; omit to use the saved group") }),
  run: async ({ ticker, peers }, ctx) => {
    const t = ticker.toUpperCase();
    const group = PEER_GROUPS.find((g) => g.members.some((m) => m.ticker === t));
    const list = peers?.length ? peers.map((p) => p.toUpperCase()) : (group?.members.map((m) => m.ticker) ?? []).filter((x) => x !== t);
    const res = await getCompanies([t, ...list]);
    const rows = Object.values(res).filter((v): v is CompanyData => !("error" in v)).map((c) => {
      const d = derive(c);
      const src = ctx.addSource(`${c.ticker} SEC XBRL company facts, LTM to ${c.ltm.periodEnd}`, c.sources.factsUrl);
      return { ticker: c.ticker, source: src, tier: c.ticker === t ? "target" : group?.members.find((m) => m.ticker === c.ticker)?.tier ?? "peer",
        ev_usd_mm: d.ev, ev_rev_ltm: fmtX(d.evRevLtm), ev_ebitda_ltm: fmtX(d.evEbitdaLtm), ev_adj_ebitda: fmtX(d.evAdjEbitdaLtm), ev_fcf: fmtX(d.evFcf),
        rev_growth: fmtPct(d.revenueGrowth), gross_margin: fmtPct(d.grossMargin), op_margin: fmtPct(d.opMargin), fcf_margin: fmtPct(d.fcfMargin), rule_of_40: d.ruleOf40?.toFixed(0) ?? "NM",
        ltm_revenue: fmtMoney(c.ltm.revenue), ltm_end: c.ltm.periodEnd, fye: c.fye };
    });
    const errs = Object.entries(res).filter(([, v]) => "error" in v).map(([k, v]) => `${k}: ${(v as { error: string }).error}`);
    const peerRows = rows.filter((r) => r.tier !== "target");
    const med = (f: (c: CompanyData) => number | null) => { const v = Object.values(res).filter((x): x is CompanyData => !("error" in x) && x.ticker !== t).map(f).filter((x): x is number => x !== null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    return JSON.stringify({ group: group?.name ?? "custom", rows, peer_count: peerRows.length, peer_median: { ev_rev_ltm: fmtX(med((c) => derive(c).evRevLtm)), rev_growth: fmtPct(med((c) => derive(c).revenueGrowth)), gross_margin: fmtPct(med((c) => derive(c).grossMargin)), fcf_margin: fmtPct(med((c) => derive(c).fcfMargin)) }, errors: errs, note: "EBITDA is reported (operating income + D&A); NTM multiples unavailable without estimates. Fiscal years not calendarized." });
  },
});

export const searchCompaniesTool = def({
  name: "search_companies",
  description: "Find SEC registrants by ticker prefix or company name.",
  schema: z.object({ query: z.string() }),
  run: async ({ query }) => JSON.stringify(await searchTickers(query, 10)),
});

async function latestFiling(ticker: string, form: string) {
  const c = await getCompanyData(ticker);
  if (!c) return { error: `Unknown ticker ${ticker}` };
  const f = c.filings.find((x) => x.form === form) ?? c.filings.find((x) => x.form.startsWith(form));
  if (!f) return { error: `No recent ${form} for ${ticker}. Available: ${[...new Set(c.filings.map((x) => x.form))].join(", ")}` };
  return { c, f };
}

export const searchFilingTool = def({
  name: "search_filing",
  description: "Search the text of a company's latest filing of a given form (10-K, 10-Q, 8-K, DEF 14A) for a phrase or topic. Returns snippets with character offsets you can expand with read_filing. Use for items not in XBRL: net revenue retention, ARR, customer counts, segment commentary, risk factors, guidance.",
  schema: z.object({ ticker: z.string(), form: z.string().describe("10-K, 10-Q, 8-K, or DEF 14A"), query: z.string().describe("Phrase or terms, e.g. 'net revenue retention rate'") }),
  run: async ({ ticker, form, query }, ctx) => {
    const r = await latestFiling(ticker, form);
    if ("error" in r) return JSON.stringify(r);
    const text = await getFilingText(r.f.url);
    const hits = searchText(text, query);
    const src = ctx.addSource(`${r.c.ticker} ${r.f.form} filed ${r.f.filed}${r.f.period ? ` (period ${r.f.period})` : ""}`, r.f.url);
    return JSON.stringify({ source: src, filing: `${r.f.form} filed ${r.f.filed}`, url: r.f.url, text_length: text.length, hits });
  },
});

export const readFilingTool = def({
  name: "read_filing",
  description: "Read a slice of the latest filing's text by character offset (max 8000 characters per call).",
  schema: z.object({ ticker: z.string(), form: z.string(), offset: z.number().int().min(0), length: z.number().int().min(200).max(8000).optional() }),
  run: async ({ ticker, form, offset, length }, ctx) => {
    const r = await latestFiling(ticker, form);
    if ("error" in r) return JSON.stringify(r);
    const text = await getFilingText(r.f.url);
    const src = ctx.addSource(`${r.c.ticker} ${r.f.form} filed ${r.f.filed}`, r.f.url);
    return JSON.stringify({ source: src, offset, text: text.slice(offset, offset + (length ?? 4000)) });
  },
});

export const webResearchTool = def({
  name: "web_research",
  description: "Search the web and summarize what is publicly known about a private company, founder, fund, market, or deal: funding rounds, investors, valuation signals, products, competitors, news, and how to reach people. Returns a summary with source URLs. Use for anything not in SEC data.",
  schema: z.object({ query: z.string().describe("A focused research question, e.g. 'Series B investors and valuation of Cursor (Anysphere) 2026'") }),
  run: async ({ query }, ctx) => {
    const r = await webResearch(query);
    const cited = r.citations.map((c) => ({ ...c, source: ctx.addSource(c.title || c.url, c.url) }));
    return JSON.stringify({ summary: r.text, sources: cited });
  },
});

export const formDTool = def({
  name: "form_d_search",
  description: "Search SEC Form D filings (notices of exempt private offerings) by company name. Returns amounts raised, dates of first sale, entity details, and related persons (executive officers, directors, promoters) with business addresses. Use to verify private raises and identify founders and officers.",
  schema: z.object({ company: z.string().describe("Company or issuer name, e.g. 'Anthropic PBC'") }),
  run: async ({ company }, ctx) => {
    const r = await searchFormD(company, 6);
    const filings = r.filings.map((f) => ({ ...f, source: ctx.addSource(`${f.issuer} ${f.form} filed ${f.filed} (SEC Form D)`, f.url) }));
    return JSON.stringify({ total_matches: r.total, filings });
  },
});

export const startupsTool = def({
  name: "search_startups",
  description: `Search YouBank's startup directory (${Object.values(SOURCES).join(", ")}): name, description, founders, country, program (e.g. "YC W25", "a16z", "Show HN", "SEC Form D", "Thiel Fellowship"). Returns matching startups with website, founders, location, stage, investors, and amounts raised where known.`,
  schema: z.object({ query: z.string().optional().describe("Keywords matched against name, description, founders"), source: z.enum(["yc", "a16z", "thiel", "hn", "formd", "web", "user"]).optional(), country: z.string().optional(), program: z.string().optional(), limit: z.number().int().min(1).max(50).optional() }),
  run: async ({ query, source, country, program, limit }, ctx) => {
    const r = await searchStartups({ q: query, source, country, program, pageSize: limit ?? 20 });
    const src = ctx.addSource("YouBank startup directory (YC API, a16z portfolio, Show HN, SEC Form D, Wikipedia, web discovery)", "https://youbank-nu.vercel.app/app/vc");
    return JSON.stringify({ source: src, total: r.total, rows: r.rows.map((x) => ({ name: x.name, program: x.program, one_liner: x.oneLiner, website: x.website, founders: x.founders, location: x.location, country: x.country, stage: x.fundingStage, investors: x.investors, raised: x.raised, date: x.sourceDate, url: x.url })) });
  },
});

export const fullTextTool = def({
  name: "edgar_fulltext_search",
  description: "Full-text search across every SEC filing and exhibit since 2001 (efts.sec.gov). Use for precedent transactions (forms DEFM14A, S-4, 8-K with phrases like \"Agreement and Plan of Merger\"), credit agreements and indentures (EX-10, EX-4), comment letters (forms UPLOAD, CORRESP), bankruptcies (8-K \"Item 1.03\"), going-concern language, IPO prospectuses (424B4, S-1), or any phrase. Quote exact phrases with double quotes. Returns entities, forms, dates, and document URLs to pass to read_document.",
  schema: z.object({ query: z.string().describe("Search phrase, e.g. '\"agreement and plan of merger\" software'"), forms: z.array(z.string()).optional().describe("Form types, e.g. [\"8-K\",\"DEFM14A\"]"), from: z.string().optional().describe("YYYY-MM-DD"), to: z.string().optional().describe("YYYY-MM-DD"), entity: z.string().optional().describe("Company name filter"), limit: z.number().int().min(1).max(40).optional() }),
  run: async ({ query, forms, from, to, entity, limit }, ctx) => {
    const r = await fullTextSearch({ q: query, forms, from, to, entity, limit: limit ?? 15 });
    const src = ctx.addSource(`EDGAR full-text search: ${query}${forms?.length ? ` (${forms.join(", ")})` : ""}`, `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}`);
    return JSON.stringify({ source: src, total: r.total, hits: r.hits });
  },
});

export const readDocumentTool = def({
  name: "read_document",
  description: "Read any document on sec.gov by URL (from edgar_fulltext_search, get_recent_filings, or a filing index): merger agreements, proxies, credit agreements, comment letters, S-1s, Form D XML. Pass a query to get matching snippets with offsets, or an offset/length to read a slice (max 8000 chars).",
  schema: z.object({ url: z.string().url(), query: z.string().optional(), offset: z.number().int().min(0).optional(), length: z.number().int().min(200).max(8000).optional() }),
  run: async ({ url, query, offset, length }, ctx) => {
    if (!/^https:\/\/(www\.)?sec\.gov\//.test(url)) return JSON.stringify({ error: "Only sec.gov URLs can be read here. Use web research for other sites." });
    const text = await getFilingText(url);
    const src = ctx.addSource(`SEC document ${url.split("/").slice(-2).join("/")}`, url);
    if (query) return JSON.stringify({ source: src, text_length: text.length, hits: searchText(text, query, 8) });
    return JSON.stringify({ source: src, text_length: text.length, offset: offset ?? 0, text: text.slice(offset ?? 0, (offset ?? 0) + (length ?? 4000)) });
  },
});

export const recentFilingsTool = def({
  name: "get_recent_filings",
  description: "List a company's recent SEC filings with dates, periods, and 8-K item codes (1.01 material agreement, 1.03 bankruptcy, 2.01 acquisition completed, 2.02 results, 2.03 debt incurred, 2.04 triggering event/acceleration, 2.05 exit costs, 2.06 impairment, 3.02 unregistered sales, 4.02 non-reliance, 5.02 officer changes, 7.01 Reg FD, 8.01 other). Filter by form prefixes such as 8-K, 10-Q, DEF 14A, S-4, SC 13D, 4, D.",
  schema: z.object({ ticker: z.string(), forms: z.array(z.string()).optional(), limit: z.number().int().min(1).max(60).optional() }),
  run: async ({ ticker, forms, limit }, ctx) => {
    const row = await resolveTicker(ticker);
    if (!row) return JSON.stringify({ error: `Unknown ticker ${ticker}` });
    const sub = await getSubmissions(row.cik);
    const rows = listFilings(sub, forms ?? [], limit ?? 25);
    const src = ctx.addSource(`${row.ticker} SEC filing index`, `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${row.cik}`);
    return JSON.stringify({ source: src, company: sub.name, filings: rows });
  },
});

export const xbrlSeriesTool = def({
  name: "get_xbrl_series",
  description: "Time series for specific XBRL concepts from SEC company facts: annual, quarterly, and point-in-time values (USD or shares). Use `find` to discover tag names (regex, e.g. 'Debt|Notes', 'Lease', 'Goodwill', 'IncomeTax', 'Segment'). Good for debt schedules, interest expense, leases, goodwill, deferred revenue, tax, share counts, and disclosure benchmarking.",
  schema: z.object({ ticker: z.string(), concepts: z.array(z.string()).optional().describe("us-gaap concept names, e.g. ['LongTermDebt','InterestExpense']"), find: z.string().optional().describe("Regex to list matching concept names"), periods: z.number().int().min(1).max(12).optional() }),
  run: async ({ ticker, concepts, find, periods }, ctx) => {
    const row = await resolveTicker(ticker);
    if (!row) return JSON.stringify({ error: `Unknown ticker ${ticker}` });
    const src = ctx.addSource(`${row.ticker} SEC XBRL company facts`, `https://data.sec.gov/api/xbrl/companyfacts/CIK${row.cik}.json`);
    if (find) return JSON.stringify({ source: src, matches: await findConcepts(row.cik, find) });
    const series = await conceptSeries(row.cik, concepts ?? [], periods ?? 6);
    return JSON.stringify({ source: src, series, note: "Values in raw units (USD or shares), not millions." });
  },
});

export const insiderTool = def({
  name: "get_insider_transactions",
  description: "Recent insider transactions from Form 4 filings: owner, role, transaction code (P purchase, S sale, A award, M exercise, F tax withholding), shares, price, and holdings after.",
  schema: z.object({ ticker: z.string(), limit: z.number().int().min(1).max(25).optional() }),
  run: async ({ ticker, limit }, ctx) => {
    const row = await resolveTicker(ticker);
    if (!row) return JSON.stringify({ error: `Unknown ticker ${ticker}` });
    const tx = await insiderTransactions(row.ticker, row.cik, limit ?? 12);
    const src = ctx.addSource(`${row.ticker} Form 4 filings (SEC)`, `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${row.cik}&type=4`);
    return JSON.stringify({ source: src, transactions: tx });
  },
});

export const calcTool = def({
  name: "calc",
  description: "Exact arithmetic. One expression per line; 'name = expr' defines a variable for later lines. Supports + - * / ^, parentheses, k/m/b/% suffixes (2.5b, 40%), and sqrt ln log exp abs min max round pow npv(rate, cf1, cf2, ...) irr(cf0, cf1, ...) pmt(rate, n, pv). Use it for every multiple, growth rate, margin, IRR, or bridge.",
  schema: z.object({ script: z.string().describe("e.g. 'ev = 45.2b + 2.1b - 3.9b\nev / 5.43b'") }),
  run: async ({ script }) => {
    try { const r = evaluateScript(script); return JSON.stringify({ results: r.results.map((x) => ({ line: x.line, value: Number.isFinite(x.value) ? Number(x.value.toPrecision(12)) : String(x.value) })) }); }
    catch (e) { return JSON.stringify({ error: e instanceof Error ? e.message : String(e) }); }
  },
});

export const ALL_TOOLS = [getCompanyTool, compsTool, searchCompaniesTool, searchFilingTool, readFilingTool, readDocumentTool, fullTextTool, recentFilingsTool, xbrlSeriesTool, insiderTool, calcTool, webResearchTool, formDTool, startupsTool] as unknown as ToolDef<unknown>[];

/** Run a tool by name with schema validation; errors are returned as strings so the model can recover. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolCtx): Promise<{ output: string; isError: boolean }> {
  const tool = ALL_TOOLS.find((t) => t.name === name);
  if (!tool) return { output: `Unknown tool ${name}`, isError: true };
  const parsed = tool.schema.safeParse(rawInput);
  if (!parsed.success) return { output: JSON.stringify({ INVALID_INPUT: parsed.error.issues.map((i) => i.message) }), isError: true };
  try {
    return { output: await tool.run(parsed.data, ctx), isError: false };
  } catch (e) {
    return { output: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), isError: true };
  }
}
