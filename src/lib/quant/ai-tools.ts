/**
 * Quant Edge's tools for the assistant (docs/quant-edge.md, section 7.2): factor exposures, portfolio risk,
 * the backtest integrity check on typed numbers, live signals, event base rates, execution costs and the Kelly
 * calculator on the person's own inputs. Each returns numbers with their sources, intervals and disclosures.
 *
 * The wording rules (quant/words.ts, section 9) are written into every description, so the assistant reports
 * statistics and never turns them into advice; scripts/test-quant.ts checks each description against FORBIDDEN.
 * The tools run at the free tier's limits (30 holdings, three years): premium depth stays in the Quant hub.
 * Modules load on first use, which keeps the chat route light.
 */
import { z } from "zod";
import { def, toolError, type ToolDef } from "@/lib/ai/tools";
import { DISCLOSURES } from "./words";

const J = (x: unknown) => JSON.stringify(x);
const r = (v: number | null | undefined, d = 4) => (v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(d)));
const fail = (e: unknown) => J({ error: toolError(e) });

/** Appended to every description: how the assistant may speak about what the tool returns. */
export const WORDING = "Report these as statistics about the past or about the inputs given, with n, the interval and the window; never as advice, a forecast for one stock or a promise; never tell the person to trade; repeat the disclosures field in plain words.";

const Holdings = z.array(z.object({ symbol: z.string(), weight: z.number().describe("fraction of the portfolio, e.g. 0.25") })).min(1).max(30);

export const factorExposuresTool = def({
  name: "quant_factor_exposures",
  description: `Factor exposures of a portfolio of US stocks and funds (up to 30 holdings with weights): betas to market, size, value, momentum, quality and low volatility with 95% intervals over one and three years, alpha with its t-statistic, R squared, how much of the risk is factor versus specific, the closest mix of index funds and today's factor crowding. Factors are YouBank's own (built from SEC filings and daily prices) or ETF proxies when those lack history; the result names which. ${WORDING}`,
  schema: z.object({ holdings: Holdings, years: z.number().min(1).max(3).optional() }),
  run: async ({ holdings, years }, ctx) => {
    try {
      const { factorLab } = await import("./factors/lab");
      const l = await factorLab(holdings, { years: years ?? 3, maxHoldings: 30 });
      const src = ctx.addSource(`YouBank Factor Lab (${l.tier === "youbank" ? "YouBank's own factors from SEC filings and daily prices" : "ETF-proxy factors"}), ${l.version}`, "https://www.sec.gov/edgar/search/");
      const w = (x: typeof l.windows.y1) => x && { years: x.years, n: x.n, from: x.from, to: x.to, alphaAnnual: r(x.alphaAnnual), alphaT: r(x.alphaT, 2), r2: r(x.r2, 3), luck: x.luck, betas: x.betas.map((b) => ({ factor: b.label, beta: r(b.beta, 3), low: r(b.low, 3), high: r(b.high, 3), t: r(b.t, 2) })) };
      return J({ source: src, tier: l.tier, factorSource: l.factorSource, summary: l.summary, y1: w(l.windows.y1), y3: w(l.windows.y3), riskSplit: l.riskSplit, tracking: l.tracking, crowding: l.crowding, outside: l.outside, disclosures: l.disclosures });
    } catch (e) { return fail(e); }
  },
});

export const riskTool = def({
  name: "quant_risk",
  description: `Risk of a portfolio of US stocks and funds (up to 30 holdings with weights): which holdings and factors the risk comes from, one-day 95% and 99% value at risk and expected shortfall (filtered historical simulation, with a Kupiec and Christoffersen backtest), historical replays (2000, 2007 quant crunch, 2008, 2020, 2022) and optional shocks like "market -20" or "rates +1", days to exit each position, and the odds of drawdowns over a year under the model. ${WORDING}`,
  schema: z.object({ holdings: Holdings, shocks: z.array(z.string()).max(2).optional().describe('e.g. "market -20", "rates +1", "momentum -10"'), portfolioUsd: z.number().positive().optional() }),
  run: async ({ holdings, shocks, portfolioUsd }, ctx) => {
    try {
      const { riskView } = await import("./risk/run");
      const v = await riskView({ holdings, pro: false, shocks, portfolioUsd });
      const src = ctx.addSource(`YouBank portfolio risk model (daily prices ${v.window.from} to ${v.window.to}, ${v.paths} simulated paths, seed ${v.seed}), ${v.version}`, "https://www.sec.gov/edgar/search/");
      return J({
        source: src, summary: v.summary, varSentence: v.varSentence, var: v.var, missing: v.missing, covarianceMethod: v.covarianceMethod,
        topHoldings: v.decomposition.holdings.slice(0, 10), factors: v.decomposition.factors, specificShare: r(v.decomposition.specificShare, 3),
        stress: v.stress, shocks: v.shocks, liquidity: v.liquidity.filter((x) => x.flag), drawdowns: v.drawdowns, locked: v.locked, disclosures: v.disclosures,
      });
    } catch (e) { return fail(e); }
  },
});

export const backtestCheckTool = def({
  name: "quant_backtest_check",
  description: `Check a backtest claim from its numbers alone: a Sharpe ratio, how many months, how often it trades (daily, weekly or monthly), how many variants were tried, and optionally skewness and kurtosis. Returns the probabilistic and deflated Sharpe ratios (Bailey and Lopez de Prado), the Sharpe that the best of that many zero-skill variants would reach by luck, the minimum track record length, the Harvey-Liu haircut and a verdict from strong to likely luck. When the number of variants is unknown, ask or show how the answer changes with it. ${WORDING}`,
  schema: z.object({ sharpe: z.number(), months: z.number().positive(), frequency: z.enum(["daily", "weekly", "monthly"]).optional(), trials: z.number().int().min(1).optional(), skew: z.number().optional(), kurt: z.number().optional() }),
  run: async (input, ctx) => {
    try {
      const { checkClaim, cleanClaim } = await import("./integrity/claim");
      const c = checkClaim(cleanClaim(input as Record<string, unknown>));
      const src = ctx.addSource("YouBank backtest check (Bailey and Lopez de Prado 2012 and 2014; Harvey, Liu and Zhu 2016)", "https://doi.org/10.3905/jpm.2014.40.5.094");
      return J({ source: src, sentence: c.sentence, verdict: c.verdict, psr: r(c.psr, 3), dsr: r(c.dsr, 3), luckySharpe: r(c.srStarAnnual, 2), minTrackRecordYears: r(c.minTrlYears, 1), years: r(c.years, 1), haircut: c.haircut && { sharpe: r(c.haircut.sharpe, 2), share: r(c.haircut.share, 2) }, passesT3: c.t3, input: c.input, disclosures: [DISCLOSURES.hypothetical] });
    } catch (e) { return fail(e); }
  },
});

export const signalsTool = def({
  name: "quant_signals",
  description: `Quant Edge's live signals for up to 20 US tickers: insider clusters, activist stakes, Edge Pulse change points and Deal Radar probabilities, each with its kind, horizon, the base rate of what followed similar past events (n, average excess return with an interval, hit rate against the unconditional hit rate), its calibration, a one-sentence explanation and its evidence links. ${WORDING}`,
  schema: z.object({ tickers: z.array(z.string()).min(1).max(20), producers: z.array(z.string()).optional() }),
  run: async ({ tickers, producers }, ctx) => {
    try {
      const { latestSignals } = await import("./signals");
      const list = await latestSignals({ symbols: tickers.map((t) => t.toUpperCase().replace(/\./g, "-")), producers });
      const src = ctx.addSource("YouBank Quant Edge signals (SEC Form 4 and Schedule 13D, Edge Pulse, Deal Radar)", "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent");
      return J({
        source: src, count: list.length,
        signals: list.slice(0, 40).map((s) => ({ symbol: s.instrument.symbol, producer: s.producer, kind: s.kind, asOf: s.asOf, validUntil: s.validUntil, horizonDays: s.horizonDays, explain: s.explain, event: s.event, probability: s.probability, score: s.score, calibration: s.calibration, evidence: s.evidence.slice(0, 3), reconstructed: s.reconstructed })),
        disclosures: [DISCLOSURES.base_rate, DISCLOSURES.not_advice],
      });
    } catch (e) { return fail(e); }
  },
});

export const eventBaseRatesTool = def({
  name: "quant_event_base_rates",
  description: `Base rates for a type of corporate event across YouBank's top-1,000 US universe: what followed past events of that type, as average market-adjusted cumulative abnormal return with a 95% bootstrap interval, the hit rate next to the unconditional hit rate, n, and splits by era, size and liquidity. Types: cluster_buy, large_officer_buy, cluster_sell, activist_new, activist_up, hiring_shift, attention_spike, patent_shift. Survivorship is flagged. ${WORDING}`,
  schema: z.object({ type: z.string() }),
  run: async ({ type }, ctx) => {
    try {
      const { CATALOG, baseRateFor } = await import("./events/rates");
      const meta = CATALOG[type];
      if (!meta) return J({ error: `Unknown event type. Known: ${Object.keys(CATALOG).join(", ")}.` });
      const b = await baseRateFor(type);
      const src = ctx.addSource(`YouBank event study (${meta.source}), market model over sessions -250 to -30`, "https://www.sec.gov/edgar/search/");
      if (!b) return J({ source: src, type, label: meta.label, available: false, note: "Not computed yet: base rates need at least 30 stored events, and the weekly pass computes them." });
      return J({
        source: src, type, label: meta.label, computedAt: b.computedAt, universe: b.universe, survivorship: b.survivorship,
        primary: b.primary, windows: b.study.windows, byEra: b.study.byEra, bySize: b.study.bySize, byLiquidity: b.study.byLiquidity,
        disclosures: [DISCLOSURES.base_rate, ...(b.survivorship ? [DISCLOSURES.survivorship] : [])],
      });
    } catch (e) { return fail(e); }
  },
});

export const costsTool = def({
  name: "quant_costs",
  description: `Estimated cost of trading a US stock or fund at a given size: half-spread (Corwin-Schultz and Abdi-Ranaldo from daily bars), market impact (square-root law on 20-day dollar volume and volatility), commission, and the round trip in basis points, with the participation rate. A model estimate from daily data, not a quote. ${WORDING}`,
  schema: z.object({ ticker: z.string(), notionalUsd: z.number().positive(), side: z.enum(["buy", "sell", "short", "cover"]).optional() }),
  run: async ({ ticker, notionalUsd, side }, ctx) => {
    try {
      const { estimateCost } = await import("./tca/run");
      const c = await estimateCost(ticker, notionalUsd, side ?? "buy");
      const src = ctx.addSource(`YouBank execution-cost model (${c.source}), ${c.model}`, "https://doi.org/10.1111/j.1540-6261.2012.01729.x");
      return J({ source: src, symbol: c.symbol, notionalUsd, spreadBps: r(c.spreadBps, 1), impactBps: r(c.impactBps, 1), commissionBps: r(c.commissionBps, 1), totalRoundTripBps: r(c.totalRoundTripBps, 1), adv20Usd: r(c.adv20Usd, 0), participation: c.adv20Usd > 0 ? r(notionalUsd / c.adv20Usd, 4) : null, asOf: c.asOf, disclosures: [DISCLOSURES.model_estimate] });
    } catch (e) { return fail(e); }
  },
});

export const kellyTool = def({
  name: "quant_kelly",
  description: `The Kelly calculator on numbers the person supplies, never on YouBank's own signals: for a bet, a win-probability range and the payoff odds; for an asset, a Sharpe range and volatility. Returns full, half and quarter Kelly, the low end of the range, the growth curve's shape and the chance of halving under each fraction. It knows nothing about the person's finances. ${WORDING}`,
  schema: z.union([
    z.object({ kind: z.literal("bet"), pLow: z.number().min(0).max(1), pHigh: z.number().min(0).max(1), odds: z.number().positive() }),
    z.object({ kind: z.literal("asset"), sharpeLow: z.number(), sharpeHigh: z.number(), vol: z.number().positive().describe("annual volatility, e.g. 0.18") }),
  ]),
  run: async (input, ctx) => {
    try {
      const { kelly } = await import("./sizing/governor");
      const k = kelly(input);
      const src = ctx.addSource("YouBank Kelly calculator (Kelly 1956; Thorp 2006; MacLean, Thorp and Ziemba 2010)", "https://doi.org/10.1002/j.1538-7305.1956.tb03809.x");
      return J({ source: src, sentence: k.sentence, full: r(k.central), lowEnd: r(k.lowEnd), uncertaintyAdjusted: r(k.robust), quarter: r(k.quarter), table: k.drawdownTable, notes: k.notes, disclosures: [k.disclosure] });
    } catch (e) { return fail(e); }
  },
});

export const QUANT_TOOLS = [factorExposuresTool, riskTool, backtestCheckTool, signalsTool, eventBaseRatesTool, costsTool, kellyTool] as unknown as ToolDef<unknown>[];
