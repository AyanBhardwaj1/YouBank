/**
 * The assistant's view of the terminal's models: price risk, credit, earnings quality, a revenue
 * forecast, the cost of capital, the economy and the screener. Each returns the model's output with
 * its inputs and method, compacted for a prompt, and registers a source to cite. The terminal modules
 * load on first use, which keeps the chat route light and avoids an import cycle through the agent.
 *
 * FRED data is licensed for display only, so the macro tool returns BLS and Treasury figures and the
 * models built on them, never FRED series.
 */
import { z } from "zod";
import { def, type ToolDef } from "./tools";

const J = (x: unknown) => JSON.stringify(x);
const r = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const secUrl = (cik?: string) => (cik ? `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json` : "https://www.sec.gov/edgar/search/");
const fail = (e: unknown) => J({ error: e instanceof Error ? e.message : String(e), planLimited: (e as { constructor?: { name?: string } })?.constructor?.name === "MarketDataError" });

export const priceRiskTool = def({
  name: "get_price_risk",
  description: "A stock's price risk from daily prices: returns over 1M/YTD/1Y/3Y, realized, EWMA and GARCH volatility (with the GARCH forecast), trend and volatility regime, betas against the S&P 500 (2y weekly Blume-adjusted, 1y daily, Welch's slope-winsorized) with standard errors, one-day VaR and expected shortfall three ways with a Kupiec backtest, max drawdown, Sharpe and Sortino. Decimals: 0.12 is 12%.",
  schema: z.object({ ticker: z.string() }),
  run: async ({ ticker }, ctx) => {
    try {
      const [{ priceAnalytics }, { withProvenance }] = await Promise.all([import("@/lib/terminal/price"), import("@/lib/market/provenance")]);
      const run = await withProvenance(() => priceAnalytics(ticker.toUpperCase()));
      const p = run.value;
      // Name the feed that actually answered: FMP, or a backup (Nasdaq, with the S&P 500 tracked by SPY).
      const feeds = run.providers.length ? run.providers.join(", ") : "Financial Modeling Prep";
      const src = ctx.addSource(`${p.ticker} daily prices to ${p.asOf} (${feeds}), YouBank risk models`, run.providers.includes("Nasdaq") && !run.providers.includes("FMP") ? `https://www.nasdaq.com/market-activity/stocks/${p.ticker.toLowerCase()}` : "https://financialmodelingprep.com/");
      return J({
        source: src, ticker: p.ticker, asOf: p.asOf, last: p.last, change: p.change, high52: p.high52, low52: p.low52, drawdownFromHigh: r(p.drawdownNow),
        maxDrawdown3y: { ...p.maxDrawdown, value: r(p.maxDrawdown.value) }, vol: p.vol, regime: p.regime,
        betas: p.beta.map((b) => ({ window: b.window, raw: r(b.beta, 3), adjusted: r(b.adjusted, 3), se: r(b.se, 3), r2: r(b.r2, 3) })),
        var95: p.risk.var95, var99: p.risk.var99, sharpe1y: r(p.risk.sharpe, 2), sortino1y: r(p.risk.sortino, 2), momentum12_1: r(p.risk.momentum12_1),
        cone: p.cone.map((c) => ({ days: c.horizonDays, p10: r(c.p10, 2), p90: r(c.p90, 2) })), varBacktest: p.backtest,
      });
    } catch (e) { return fail(e); }
  },
});

export const creditRiskTool = def({
  name: "get_credit_risk",
  description: "Implied credit rating without a ratings licence: Altman Z'' (via Altman's rating medians), Ohlson O-score (probability of failure) and Merton distance to default (one-year default probability), the median view, historical default rates for that rating, coverage and leverage, and each model's inputs. Views outside a model's domain are marked excluded with the reason.",
  schema: z.object({ ticker: z.string() }),
  run: async ({ ticker }, ctx) => {
    try {
      const { creditView } = await import("@/lib/terminal/fundamentals");
      const c = await creditView(ticker.toUpperCase());
      const src = ctx.addSource(`${c.ticker} SEC XBRL annual filings; YouBank credit models (Altman 1995, Ohlson 1980, Merton/Bharath-Shumway 2008)`, secUrl());
      return J({
        source: src, ticker: c.ticker, name: c.name, rating: c.rating.rating, grade: c.rating.grade, views: c.rating.views, mortality: c.rating.mortality,
        zpp: c.rating.zpp && { value: r(c.rating.zpp.value, 2), zone: c.rating.zpp.zone, inputs: c.rating.zpp.inputs },
        oScore: c.rating.o && { value: r(c.rating.o.value, 2), pd: r(c.rating.o.pd), inputs: c.rating.o.inputs },
        merton: c.rating.merton && { dd: r(c.rating.merton.dd, 2), pd: c.rating.merton.pd, assetVol: r(c.rating.merton.assetVol) },
        history: c.history, coverage: c.coverage, market: c.market, caveat: c.caveat,
      });
    } catch (e) { return fail(e); }
  },
});

export const qualityTool = def({
  name: "get_earnings_quality",
  description: "Forensic accounting checks from SEC filings: Beneish M-score with its eight ratios and probit probability, Piotroski F-score with each signal, Sloan accruals, Novy-Marx gross profitability, working-capital days and cash conversion over up to six years, and red flags.",
  schema: z.object({ ticker: z.string() }),
  run: async ({ ticker }, ctx) => {
    try {
      const { qualityView } = await import("@/lib/terminal/fundamentals");
      const q = await qualityView(ticker.toUpperCase());
      const src = ctx.addSource(`${q.ticker} SEC XBRL annual filings to FY${q.fy}; Beneish (1999), Piotroski (2000), Sloan (1996)`, secUrl());
      return J({ source: src, ...q });
    } catch (e) { return fail(e); }
  },
});

export const revenueForecastTool = def({
  name: "get_revenue_forecast",
  description: "A statistical forecast of the next four quarters of revenue from the company's own reported quarterly history (the M4-winning combination of exponential smoothing, damped trend and Theta, with conformal 80% and 95% intervals and its backtest error), against the Street's consensus where available. USD millions.",
  schema: z.object({ ticker: z.string() }),
  run: async ({ ticker }, ctx) => {
    try {
      const { forecastView } = await import("@/lib/terminal/fundamentals");
      const f = await forecastView(ticker.toUpperCase());
      const src = ctx.addSource(`${f.ticker} quarterly revenue, SEC XBRL; YouBank forecast (M4 combination, conformal intervals)`, secUrl());
      return J({ source: src, ticker: f.ticker, history: f.history.slice(-8), quarters: f.labels, forecast: f.forecast, growthYoY: f.growth, consensus: f.consensus, modelVsStreet: f.modelVsStreet });
    } catch (e) { return fail(e); }
  },
});

export const costOfCapitalTool = def({
  name: "get_cost_of_capital",
  description: "WACC built from its parts: the 10-year Treasury, beta (2y weekly Blume or Welch), an equity risk premium (default 5%), cost of debt from the implied rating's spread with the effective rate beside it, the tax shield and market-value weights, plus a Monte Carlo 80% range and which input moves it most.",
  schema: z.object({ ticker: z.string(), erp: z.number().min(0.02).max(0.12).optional().describe("equity risk premium as a decimal"), beta: z.enum(["blume", "welch"]).optional() }),
  run: async ({ ticker, erp, beta }, ctx) => {
    try {
      const { waccView } = await import("@/lib/terminal/wacc");
      const w = await waccView(ticker.toUpperCase(), erp, beta ?? "blume");
      const src = ctx.addSource(`${w.ticker} cost of capital: U.S. Treasury par curve ${w.riskFree.date ?? ""}, SEC XBRL, prices from Financial Modeling Prep`, "https://home.treasury.gov/resource-center/data-chart-center/interest-rates");
      return J({ source: src, ...w, range: { p10: w.range.p10, p50: w.range.p50, p90: w.range.p90 } });
    } catch (e) { return fail(e); }
  },
});

export const macroTool = def({
  name: "get_macro_outlook",
  description: "US economy from primary public-domain data: BLS inflation, unemployment, payrolls and earnings with three-month model outlooks (conformal 80% intervals and backtests), the Sahm rule, the Treasury yield curve with its Nelson-Siegel level, slope and curvature, and the New York Fed's yield-curve recession probability.",
  schema: z.object({}),
  run: async (_i, ctx) => {
    try {
      const { macroView, curveView } = await import("@/lib/terminal/macro");
      const [m, c] = await Promise.all([macroView(), curveView().catch(() => null)]);
      const bls = ctx.addSource("Bureau of Labor Statistics (public domain), YouBank outlook models", "https://www.bls.gov/data/");
      const tsy = ctx.addSource(`U.S. Treasury daily par yield curve${c ? `, ${c.asOf}` : ""}`, "https://home.treasury.gov/resource-center/data-chart-center/interest-rates");
      return J({
        sources: { bls, treasury: tsy }, outlooks: m.outlooks, sahm: m.sahm, recession: m.recession,
        curve: c && { asOf: c.asOf, labels: c.labels, today: c.curves[0]?.yields, yearAgo: c.curves[3]?.yields, nelsonSiegel: c.fit && { level: c.fit.level, slope: c.fit.slope, curvature: c.fit.curvature }, shape: c.shape },
        note: "FRED series on the ECO screen are display-only under FRED's terms and are not included here.",
      });
    } catch (e) { return fail(e); }
  },
});

export const screenTool = def({
  name: "screen_companies",
  description: "Screen every US SEC filer on its latest annual figures (revenue, growth, margins, ROA/ROE, cash flow margin, debt to equity, assets, cash) with a request in plain words. Returns the filters it applied, anything it could not express, and up to 25 matches.",
  schema: z.object({ query: z.string() }),
  run: async ({ query }, ctx) => {
    try {
      const { applyFilters, parseScreen, universe } = await import("@/lib/terminal/screen");
      const parsed = await parseScreen(query);
      const u = await universe();
      const rows = applyFilters(u.rows, parsed.filters, parsed.sort ?? undefined, 25);
      const src = ctx.addSource(`SEC XBRL frames, calendar year ${u.year} (${u.rows.length} filers)`, "https://www.sec.gov/search-filings/edgar-application-programming-interfaces");
      return J({ source: src, year: u.year, universe: u.rows.length, parsed, rows });
    } catch (e) { return fail(e); }
  },
});

export const INFERENCE_TOOLS = [priceRiskTool, creditRiskTool, qualityTool, revenueForecastTool, costOfCapitalTool, macroTool, screenTool] as unknown as ToolDef<unknown>[];
