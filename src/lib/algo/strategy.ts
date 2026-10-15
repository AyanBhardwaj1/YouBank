/**
 * Strategies as data: a typed JSON document (validated with zod) that says what to trade, why, how much,
 * how often and within which limits. Nothing in a strategy is code, so a strategy built in the editor, by
 * a template or by the AI agent is checked by the same schema and runs through the same engine and risk
 * limits. Pure, safe on the client.
 *
 * The parts:
 * - universe: the symbols it may hold (at most 30) and the benchmark it is compared with;
 * - signal: one rule that turns prices into a view (trend, momentum, mean reversion, pairs, a fixed mix,
 *   a 13F copy, options income), or Quant's signals or target portfolios through the contract (signals.ts);
 * - sizing: equal, inverse volatility or volatility-targeted, with a cap per position;
 * - rebalance: when it decides (daily at the open or close, weekly, monthly, or intraday every 15, 30 or
 *   60 minutes) and how far weights must drift before it trades;
 * - risk: the limits the risk engine enforces on every order (risk.ts), all required for live trading;
 * - execution: limit orders with a band (default) or market orders, and TWAP slicing for larger orders.
 */
import { z } from "zod";
import { issueSentence, type FieldIssue } from "@/lib/error-text";

const Sym = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9.\-/]{0,20}$/, "Use ticker symbols like AAPL, BRK-B or BTC-USD");

export const SignalRuleZ = z.discriminatedUnion("type", [
  z.object({ type: z.literal("trend"), fast: z.number().int().min(2).max(200).default(50), slow: z.number().int().min(5).max(400).default(200) }),
  z.object({ type: z.literal("momentum"), lookback: z.number().int().min(21).max(504).default(252), skip: z.number().int().min(0).max(63).default(21), top: z.number().int().min(1).max(20).default(3), absolute: z.boolean().default(true) }),
  z.object({ type: z.literal("meanReversion"), indicator: z.enum(["rsi", "zscore"]).default("rsi"), lookback: z.number().int().min(2).max(100).default(14), entry: z.number().default(30), exit: z.number().default(50), trendFilter: z.number().int().min(0).max(400).default(200) }),
  z.object({ type: z.literal("pairs"), a: Sym, b: Sym, lookback: z.number().int().min(40).max(504).default(120), entryZ: z.number().min(0.5).max(5).default(2), exitZ: z.number().min(0).max(3).default(0.5), maxHalfLife: z.number().min(1).max(250).default(40), requireCointegration: z.enum(["1%", "5%", "10%"]).default("5%") }),
  z.object({ type: z.literal("rebalance"), weights: z.record(z.string().regex(/^[A-Z0-9][A-Z0-9.\-/]{0,20}$/, "Use upper-case ticker symbols"), z.number().min(0).max(1)) }),
  z.object({ type: z.literal("copy13f"), cik: z.string().regex(/^\d{1,10}$/), top: z.number().int().min(1).max(50).default(15) }),
  z.object({ type: z.literal("income"), kind: z.enum(["covered_call", "cash_secured_put"]), underlying: Sym, delta: z.number().min(0.05).max(0.5).default(0.3), dte: z.number().int().min(7).max(90).default(30), ivPremium: z.number().min(0).max(1).default(0.1) }),
  // Quant's signals (src/lib/quant/contracts.ts): a producer such as "quant.insider_cluster".
  z.object({ type: z.literal("external"), producer: z.string().regex(/^[a-z][a-z0-9._:-]{1,80}$/), topN: z.number().int().min(1).max(30).default(10), minConfidence: z.number().min(0).max(1).default(0.3) }),
  // Quant's target portfolios by key (a sleeve, a risk-parity mix, a 13F clone).
  z.object({ type: z.literal("target"), key: z.string().min(1).max(120) }),
]);
export type SignalRule = z.infer<typeof SignalRuleZ>;

export const RiskLimitsZ = z.object({
  /** Largest single order, in dollars. */
  maxOrderUsd: z.number().min(1).max(1_000_000).default(2_500),
  /** Orders this strategy may send in one day (buys and sells, at their estimated value). */
  maxDayUsd: z.number().min(1).max(5_000_000).default(10_000),
  /** Largest share of the strategy's equity in one position. */
  maxPositionPct: z.number().min(0.01).max(1).default(0.35),
  /** Gross exposure (Σ|weights|) and net exposure (Σ weights) limits, as a fraction of equity. */
  maxGross: z.number().min(0.05).max(2).default(1),
  maxNet: z.number().min(-1).max(2).default(1),
  /** Stop adding risk for the day once the strategy is down this much since the open (0.03 = 3%). */
  dailyLossPct: z.number().min(0.002).max(0.5).default(0.03),
  /** Trip the strategy's kill switch at this drawdown from its peak. */
  maxDrawdownPct: z.number().min(0.01).max(0.9).default(0.15),
  /** Order throttles. */
  maxOrdersPerMinute: z.number().int().min(1).max(60).default(10),
  maxOrdersPerDay: z.number().int().min(1).max(500).default(40),
  /** Refuse an order whose price is this far from the reference price (0.05 = 5%). */
  fatFingerPct: z.number().min(0.005).max(0.5).default(0.05),
  /** Short selling (backtests only: live and paper strategies are long-only). */
  allowShort: z.boolean().default(false),
  /** Trading outside 9:30–16:00 ET (limit orders only, where the broker supports it). */
  allowExtendedHours: z.boolean().default(false),
  /** How day trades are treated: the legacy pattern-day-trader count, FINRA's intraday-margin regime (from June 2026), or off (cash accounts). */
  pdtMode: z.enum(["legacy", "intraday", "off"]).default("legacy"),
});
export type RiskLimits = z.infer<typeof RiskLimitsZ>;

export const StrategySpecZ = z.object({
  version: z.literal(1).default(1),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(600).default(""),
  assetClass: z.enum(["equity", "crypto", "options"]).default("equity"),
  universe: z.array(Sym).min(1).max(30),
  benchmark: Sym.default("SPY"),
  signal: SignalRuleZ,
  sizing: z.object({
    method: z.enum(["equal", "inverseVol", "volTarget"]).default("equal"),
    /** Annual volatility to aim for (volTarget), 0.10 = 10%. */
    targetVol: z.number().min(0.02).max(0.6).default(0.12),
    volLookback: z.number().int().min(10).max(252).default(63),
    maxWeight: z.number().min(0.01).max(1).default(0.35),
  }).default({ method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.35 }),
  rebalance: z.object({
    every: z.enum(["daily", "weekly", "monthly", "intraday"]).default("weekly"),
    at: z.enum(["open", "close"]).default("close"),
    minutes: z.union([z.literal(15), z.literal(30), z.literal(60)]).default(60),
    /** Skip trades that move a weight by less than this (0.02 = 2 points). */
    drift: z.number().min(0).max(0.5).default(0.02),
  }).default({ every: "weekly", at: "close", minutes: 60, drift: 0.02 }),
  /** Recurring contribution for DCA (the paper account adds it as cash; live strategies size from it). */
  dca: z.object({ amountUsd: z.number().min(0).max(1_000_000), every: z.enum(["weekly", "monthly"]) }).nullable().default(null),
  capitalUsd: z.number().min(100).max(10_000_000).default(10_000),
  risk: RiskLimitsZ.default(RiskLimitsZ.parse({})),
  execution: z.object({
    orderType: z.enum(["Limit", "Market"]).default("Limit"),
    /** Limit band either side of the last price, in basis points. */
    limitBandBps: z.number().min(1).max(500).default(25),
    /** Orders worth at least this are split into `slices` child orders over `minutes` (TWAP). */
    twapThresholdUsd: z.number().min(100).max(10_000_000).default(5_000),
    slices: z.number().int().min(1).max(20).default(4),
    minutes: z.number().int().min(5).max(390).default(60),
    minOrderUsd: z.number().min(1).max(10_000).default(5),
  }).default({ orderType: "Limit", limitBandBps: 25, twapThresholdUsd: 5_000, slices: 4, minutes: 60, minOrderUsd: 5 }),
}).superRefine((s, ctx) => {
  if (s.signal.type === "trend" && s.signal.fast >= s.signal.slow) ctx.addIssue({ code: "custom", path: ["signal", "fast"], message: "The fast average must be shorter than the slow one." });
  if (s.signal.type === "pairs" && s.signal.a === s.signal.b) ctx.addIssue({ code: "custom", path: ["signal", "b"], message: "A pair needs two different symbols." });
  if (s.signal.type === "pairs" && s.signal.exitZ >= s.signal.entryZ) ctx.addIssue({ code: "custom", path: ["signal", "exitZ"], message: "Exit before the entry level: exitZ must be below entryZ." });
  if (s.signal.type === "rebalance") {
    const sum = Object.values(s.signal.weights).reduce((a, b) => a + b, 0);
    if (sum > 1 + 1e-6) ctx.addIssue({ code: "custom", path: ["signal", "weights"], message: `The weights add up to ${(sum * 100).toFixed(0)}%; they can add up to at most 100%.` });
  }
  if (s.risk.maxOrderUsd > s.risk.maxDayUsd) ctx.addIssue({ code: "custom", path: ["risk", "maxOrderUsd"], message: "The per-order limit cannot be above the daily limit." });
  if (s.risk.maxNet > s.risk.maxGross) ctx.addIssue({ code: "custom", path: ["risk", "maxNet"], message: "Net exposure cannot exceed gross exposure." });
  if (s.signal.type === "income" && s.assetClass !== "options") ctx.addIssue({ code: "custom", path: ["assetClass"], message: "Options income strategies use the options asset class." });
});
export type StrategySpec = z.infer<typeof StrategySpecZ>;

/** The symbols a strategy needs prices for: its universe, the pair's legs and the benchmark. */
export function symbolsOf(s: StrategySpec): string[] {
  const extra = s.signal.type === "pairs" ? [s.signal.a, s.signal.b] : s.signal.type === "rebalance" ? Object.keys(s.signal.weights) : s.signal.type === "income" ? [s.signal.underlying] : [];
  return [...new Set([...s.universe, ...extra])];
}

/** Days of history a strategy needs before its first decision. */
export function warmupDays(s: StrategySpec): number {
  const r = s.signal;
  const sig = r.type === "trend" ? r.slow : r.type === "momentum" ? r.lookback + 1 : r.type === "meanReversion" ? Math.max(r.lookback + 1, r.trendFilter) : r.type === "pairs" ? r.lookback : r.type === "income" ? 63 : 2;
  return Math.max(sig, s.sizing.method === "equal" ? 0 : s.sizing.volLookback + 1) + 1;
}

/** The editor's names for the fields a validation message is about. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name", description: "Description", universe: "Symbols", benchmark: "Benchmark", capitalUsd: "Capital ($)", assetClass: "Asset class",
  fast: "Fast average (days)", slow: "Slow average (days)", lookback: "Lookback (days)", trendFilter: "Trend filter (days)", entryZ: "Entry z-score", exitZ: "Exit z-score",
  "signal.a": "First symbol of the pair", "signal.b": "Second symbol of the pair", weights: "Weights", producer: "Signal producer",
  maxWeight: "Largest weight", targetVol: "Target volatility", volLookback: "Volatility lookback (days)", drift: "Drift threshold",
  maxOrderUsd: "Per-order limit ($)", maxDayUsd: "Daily limit ($)", maxNet: "Net exposure", maxGross: "Gross exposure", maxDrawdownPct: "Drawdown stop",
  limitBandBps: "Limit band (bps)", twapThresholdUsd: "Split orders above ($)", slices: "Slices per order", minOrderUsd: "Smallest order ($)",
  "rebalance.minutes": "Intraday interval (minutes)", "execution.minutes": "Spread slices over (minutes)",
};

/**
 * Validate a strategy. `errors` are sentences about the field ("Limit band (bps) must be at most 500."),
 * for the editor and anyone reading; `fields` holds each one's path (signal.fast), for the agent.
 */
export function parseStrategy(raw: unknown): { ok: true; spec: StrategySpec } | { ok: false; errors: string[]; fields: string[] } {
  const p = StrategySpecZ.safeParse(raw);
  if (p.success) return { ok: true, spec: p.data };
  const issues = p.error.issues.slice(0, 12);
  return { ok: false, errors: issues.map((i) => issueSentence(i as FieldIssue, FIELD_LABELS)), fields: issues.map((i) => i.path.join(".") || "strategy") };
}

/** The errors with their fields, for the agent: "Fast average (days) must be… (signal.fast)". */
export const errorsWithFields = (p: { errors: string[]; fields: string[] }) => p.errors.map((e, i) => `${e.replace(/\.$/, "")} (${p.fields[i]})`).join("; ");

/** Whether every risk limit was set on purpose (live trading requires it): the person saved the limits explicitly. */
export const RISK_KEYS = Object.keys(RiskLimitsZ.shape) as (keyof RiskLimits)[];

/* ---------------- Templates ---------------- */

export type Template = { id: string; name: string; blurb: string; how: string; risks: string; spec: unknown };

const base = { version: 1 as const };

/**
 * The starting points in the builder. Each says what it does, how, and how it tends to fail, in words a
 * person can check, with no claim about future returns.
 */
export const TEMPLATES: Template[] = [
  {
    id: "trend-voltarget", name: "Trend following with volatility targeting",
    blurb: "Hold each ETF while its 50-day average is above its 200-day average; size the book to about 12% volatility.",
    how: "A moving-average crossover per asset (Faber 2007's timing rule is a close cousin). Holdings are scaled so the portfolio's recent volatility is near the target, which cuts exposure when markets turn wild.",
    risks: "Whipsaws in sideways markets, late exits after sharp falls, and long stretches behind a buy-and-hold benchmark in steady bull markets.",
    spec: { ...base, name: "Trend + vol target", universe: ["SPY", "QQQ", "IWM", "EFA", "TLT", "GLD"], benchmark: "SPY", signal: { type: "trend", fast: 50, slow: 200 }, sizing: { method: "volTarget", targetVol: 0.12, volLookback: 63, maxWeight: 0.35 }, rebalance: { every: "weekly", at: "close", minutes: 60, drift: 0.03 } },
  },
  {
    id: "momentum-rotation", name: "Momentum rotation",
    blurb: "Each month, hold the 2 of 6 sector and asset ETFs with the best 12-month return (skipping the last month), and only while that return is positive.",
    how: "Cross-sectional 12-1 momentum (Jegadeesh and Titman 1993) with an absolute-momentum filter (Antonacci's dual momentum): money moves to cash when nothing is rising.",
    risks: "Momentum crashes at sharp market turns (2009), concentration in two holdings, and monthly turnover.",
    spec: { ...base, name: "Momentum rotation", universe: ["XLK", "XLF", "XLE", "XLV", "XLI", "TLT"], benchmark: "SPY", signal: { type: "momentum", lookback: 252, skip: 21, top: 2, absolute: true }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.5 }, rebalance: { every: "monthly", at: "close", minutes: 60, drift: 0.02 }, risk: { maxPositionPct: 0.5 } },
  },
  {
    id: "mean-reversion-rsi", name: "Mean reversion (RSI)",
    blurb: "Buy an index ETF when its 2-day RSI falls under 10 while it is above its 200-day average; sell when RSI recovers above 60.",
    how: "Short-horizon reversal: sharp dips inside an uptrend have tended to bounce (Connors's RSI(2)). The trend filter avoids catching falling knives in bear markets.",
    risks: "Many small wins and occasional large losses; results are sensitive to costs and to the exact thresholds (a classic overfitting trap: check the deflated Sharpe).",
    spec: { ...base, name: "RSI(2) dip buyer", universe: ["SPY", "QQQ"], benchmark: "SPY", signal: { type: "meanReversion", indicator: "rsi", lookback: 2, entry: 10, exit: 60, trendFilter: 200 }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.5 }, rebalance: { every: "daily", at: "close", minutes: 60, drift: 0.01 }, risk: { maxPositionPct: 0.5 } },
  },
  {
    id: "pairs-cointegration", name: "Pairs trading (cointegration)",
    blurb: "Trade the spread between two related ETFs when it stretches two standard deviations, only while they test as cointegrated.",
    how: "Engle–Granger: a hedge ratio by least squares, an ADF test on the spread (MacKinnon's critical values) and its half-life. Entries at |z| ≥ 2, exits near zero. Live and paper strategies hold only the long leg (no short selling); backtests can run both legs.",
    risks: "Relationships break (the test passing in-sample is not a guarantee), spreads can widen far beyond two deviations, and the long-only version keeps market risk.",
    spec: { ...base, name: "GLD/GDX pair", universe: ["GLD", "GDX"], benchmark: "SPY", signal: { type: "pairs", a: "GDX", b: "GLD", lookback: 120, entryZ: 2, exitZ: 0.5, maxHalfLife: 40, requireCointegration: "10%" }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.5 }, rebalance: { every: "daily", at: "close", minutes: 60, drift: 0.02 }, risk: { maxPositionPct: 0.5 } },
  },
  {
    id: "dca-rebalance", name: "DCA and periodic rebalance",
    blurb: "Add a fixed amount every month and keep a 60/30/10 stock, bond and gold mix, rebalancing when a weight drifts 5 points.",
    how: "Dollar-cost averaging spreads purchases over time; threshold rebalancing sells what ran up and buys what fell behind, keeping risk where you set it.",
    risks: "No market timing at all: it falls with the market. Rebalancing in taxable accounts can realise gains.",
    spec: { ...base, name: "60/30/10 with DCA", universe: ["VTI", "BND", "GLD"], benchmark: "SPY", signal: { type: "rebalance", weights: { VTI: 0.6, BND: 0.3, GLD: 0.1 } }, rebalance: { every: "monthly", at: "close", minutes: 60, drift: 0.05 }, dca: { amountUsd: 500, every: "monthly" }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.6 }, risk: { maxPositionPct: 0.65 } },
  },
  {
    id: "copy-13f", name: "13F copy (Berkshire Hathaway)",
    blurb: "Hold a fund's largest disclosed positions, rebalanced the day after each new 13F is public. Reuses Fund copies' data and rules.",
    how: "The latest 13F as publicly known on each date (amendments counted on the day filed), top 15 positions by value, share classes merged. Lag-aware: it can only trade what has been published.",
    risks: "13Fs are up to 45 days old when filed and leave out shorts, cash and non-US holdings; the fund may have sold already.",
    spec: { ...base, name: "Berkshire 13F copy", universe: ["AAPL"], benchmark: "SPY", signal: { type: "copy13f", cik: "1067983", top: 15 }, rebalance: { every: "weekly", at: "close", minutes: 60, drift: 0.03 }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 0.4 }, risk: { maxPositionPct: 0.45 } },
  },
  {
    id: "covered-call", name: "Covered call income",
    blurb: "Hold 100 shares of an ETF and sell a 30-day call around 0.30 delta against them each month.",
    how: "Collects option premium in exchange for capping upside above the strike. Strikes come from Black–Scholes on recent realised volatility plus an implied-volatility premium; only brokers that trade options through their API can run it live.",
    risks: "Upside is capped while downside is not; assignment can sell the shares; the backtest prices options with a model, not real option quotes, so treat its numbers as rough.",
    spec: { ...base, name: "SPY covered calls", assetClass: "options", universe: ["SPY"], benchmark: "SPY", signal: { type: "income", kind: "covered_call", underlying: "SPY", delta: 0.3, dte: 30, ivPremium: 0.1 }, rebalance: { every: "monthly", at: "close", minutes: 60, drift: 0.02 }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 1 }, risk: { maxPositionPct: 1 }, capitalUsd: 75_000 },
  },
  {
    id: "csp-income", name: "Cash-secured put income",
    blurb: "Keep cash for 100 shares and sell a 30-day put around 0.25 delta each month.",
    how: "Collects premium for agreeing to buy at the strike. Cash covering the full assignment is held back, so there is no leverage.",
    risks: "Losses in sharp falls (you buy at the strike), capped gains, and model-priced backtests.",
    spec: { ...base, name: "QQQ cash-secured puts", assetClass: "options", universe: ["QQQ"], benchmark: "QQQ", signal: { type: "income", kind: "cash_secured_put", underlying: "QQQ", delta: 0.25, dte: 30, ivPremium: 0.1 }, rebalance: { every: "monthly", at: "close", minutes: 60, drift: 0.02 }, sizing: { method: "equal", targetVol: 0.12, volLookback: 63, maxWeight: 1 }, risk: { maxPositionPct: 1 }, capitalUsd: 60_000 },
  },
];

export function templateSpec(id: string): StrategySpec | null {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  const p = parseStrategy(t.spec);
  return p.ok ? p.spec : null;
}
