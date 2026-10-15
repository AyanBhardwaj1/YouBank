/**
 * Q5, the Execution Cost Analyzer's maths. Pure.
 *
 * - Spreads without quotes: the Corwin-Schultz (2012) high-low estimator and the Abdi-Ranaldo (2017)
 *   close-high-low estimator on daily bars.
 * - The pre-trade cost model: half the spread each way, impact Y·σ_daily·√(Q/ADV) each way (the square-root
 *   law, Y about 0.7), commission from a broker table, borrow for shorts. Y is shrunk toward the person's own
 *   measured costs once there are 30 or more fills.
 * - Per fill, from daily bars: slippage against the day's open, close and typical price (H+L+C)/3 (labelled
 *   "typical price", not VWAP), where in the day's range it filled, and flags for market orders at the open or
 *   in the last minutes. Daily-bar comparisons are rough: they cannot see the quote at the moment of the trade.
 * - The annual cost: the last 12 months of fills, projected.
 */
import type { CostEstimate, Fill } from "../contracts";
import { median } from "@/lib/inference/stats";

export const TCA_VERSION = "q5-2026-10-15.1";
export const IMPACT_Y = 0.7;

export type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };

/** Corwin-Schultz spread estimate for each pair of consecutive days (negative estimates set to zero). */
export function corwinSchultz(bars: Bar[]): number[] {
  const k = 3 - 2 * Math.SQRT2, out: number[] = [];
  for (let t = 0; t + 1 < bars.length; t++) {
    const a = bars[t], b = bars[t + 1];
    if (!(a.low > 0 && b.low > 0 && a.high >= a.low && b.high >= b.low)) continue;
    const beta = Math.log(a.high / a.low) ** 2 + Math.log(b.high / b.low) ** 2;
    const gamma = Math.log(Math.max(a.high, b.high) / Math.min(a.low, b.low)) ** 2;
    const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k);
    out.push(Math.max(0, (2 * (Math.exp(alpha) - 1)) / (1 + Math.exp(alpha))));
  }
  return out;
}

/** Abdi-Ranaldo spread estimate over a window: S² = 4·E[(c_t - η_t)(c_t - η_{t+1})], η the log mid-range. */
export function abdiRanaldo(bars: Bar[]): number | null {
  const terms: number[] = [];
  for (let t = 0; t + 1 < bars.length; t++) {
    const a = bars[t], b = bars[t + 1];
    if (!(a.low > 0 && b.low > 0 && a.close > 0)) continue;
    const c = Math.log(a.close), e0 = (Math.log(a.high) + Math.log(a.low)) / 2, e1 = (Math.log(b.high) + Math.log(b.low)) / 2;
    terms.push((c - e0) * (c - e1));
  }
  if (!terms.length) return null;
  const m = terms.reduce((s, v) => s + v, 0) / terms.length;
  return Math.sqrt(Math.max(0, 4 * m));
}

/** A spread estimate from daily bars: the median of the Corwin-Schultz pairs and Abdi-Ranaldo, floored at 1 bp. */
export function spreadEstimate(bars: Bar[]): { spread: number; cs: number | null; ar: number | null; n: number } {
  const cs = corwinSchultz(bars), ar = abdiRanaldo(bars);
  const csMean = cs.length ? cs.reduce((s, v) => s + v, 0) / cs.length : null;
  const parts = [csMean, ar].filter((v): v is number => v !== null && Number.isFinite(v));
  return { spread: Math.max(1e-4, parts.length ? median(parts) : 1e-3), cs: csMean, ar, n: cs.length };
}

/** Commission per trade in bp of notional for a broker (most US brokers charge $0 on stocks). */
export function commissionBps(broker: string | undefined, notionalUsd: number, shares: number): number {
  const b = (broker ?? "").toLowerCase();
  if (/ibkr|interactive/.test(b)) return (Math.min(Math.max(1, 0.005 * shares), 0.01 * notionalUsd) / notionalUsd) * 1e4;
  return 0;
}

/** The pre-trade estimate (round trip unless stated). Pure. */
export function costModel(o: { notionalUsd: number; price: number; sigmaDaily: number; advUsd: number; spread: number; side: Fill["side"]; broker?: string; y?: number; borrowBpsYear?: number | null; asOf?: string }): CostEstimate {
  const y = o.y ?? IMPACT_Y;
  const part = o.advUsd > 0 ? o.notionalUsd / o.advUsd : 1;
  const impactOneWay = y * o.sigmaDaily * Math.sqrt(Math.max(part, 0));
  const shares = o.price > 0 ? o.notionalUsd / o.price : 0;
  const comm = commissionBps(o.broker, o.notionalUsd, shares);
  const spreadBps = o.spread * 1e4, impactBps = 2 * impactOneWay * 1e4, commissionBpsRt = 2 * comm;
  return {
    spreadBps, impactBps, commissionBps: commissionBpsRt, borrowBpsYear: o.side === "short" ? o.borrowBpsYear ?? 30 : null,
    totalRoundTripBps: spreadBps + impactBps + commissionBpsRt, referenceNotionalUsd: o.notionalUsd, adv20Usd: o.advUsd,
    model: `half the spread each way (Corwin-Schultz and Abdi-Ranaldo on daily bars) + ${y.toFixed(2)}·σ·√(Q/ADV) each way + commission; ${TCA_VERSION}`,
    asOf: o.asOf ?? new Date().toISOString(),
  };
}

/** Y shrunk toward the person's measured impact once there are 30 or more fills: k = n / (n + 30). Pure. */
export function shrinkY(observedY: number[], prior = IMPACT_Y): { y: number; n: number; weight: number } {
  const xs = observedY.filter((v) => Number.isFinite(v) && v >= 0 && v < 10);
  if (xs.length < 30) return { y: prior, n: xs.length, weight: 0 };
  const w = xs.length / (xs.length + 30);
  return { y: w * median(xs) + (1 - w) * prior, n: xs.length, weight: w };
}

/** Sign of a fill: buying (and covering) costs when the price is above the benchmark, selling when below. */
export const sideSign = (s: Fill["side"]) => (s === "buy" || s === "cover" ? 1 : -1);

export type FillAnalysis = {
  fill: Fill; date: string; bar: Bar | null; vsOpenBps: number | null; vsCloseBps: number | null; vsTypicalBps: number | null; rangePosition: number | null;
  notionalUsd: number; modelledCostBps: number | null; modelledCostUsd: number | null; flags: string[];
};

/**
 * One fill against its day's bar (positive bps = cost to the person). `spread` and `sigma` are the
 * estimates around that day. Time-of-day flags need a known time.
 */
export function analyseFill(f: Fill & { timeKnown?: boolean }, bar: Bar | null, est: { spread: number; sigmaDaily: number; advUsd: number } | null, nyMinutes: number | null): FillAnalysis {
  const s = sideSign(f.side), notional = f.qty * f.price;
  const vs = (bench: number) => (bench > 0 ? (s * (f.price - bench) / bench) * 1e4 : null);
  const typical = bar ? (bar.high + bar.low + bar.close) / 3 : 0;
  const flags: string[] = [];
  if (bar && (f.price > bar.high * 1.001 || f.price < bar.low * 0.999)) flags.push("outside the day's range: check the date, a split or an extended-hours trade");
  if (nyMinutes !== null && f.timeKnown !== false && f.orderType === "market") {
    if (nyMinutes < 9 * 60 + 45) flags.push("market order in the first 15 minutes, when spreads are widest");
    if (nyMinutes >= 15 * 60 + 50) flags.push("market order in the last 10 minutes");
  }
  let modelledCostBps: number | null = null;
  if (est) {
    const impact = IMPACT_Y * est.sigmaDaily * Math.sqrt(est.advUsd > 0 ? notional / est.advUsd : 1);
    modelledCostBps = (est.spread / 2 + impact) * 1e4 + (f.fees ? (f.fees / Math.max(notional, 1e-9)) * 1e4 : 0);
  }
  return {
    fill: f, date: f.executedAt.slice(0, 10), bar,
    vsOpenBps: bar ? vs(bar.open) : null, vsCloseBps: bar ? vs(bar.close) : null, vsTypicalBps: bar ? vs(typical) : null,
    rangePosition: bar && bar.high > bar.low ? (s > 0 ? (f.price - bar.low) / (bar.high - bar.low) : (bar.high - f.price) / (bar.high - bar.low)) : null,
    notionalUsd: notional, modelledCostBps, modelledCostUsd: modelledCostBps !== null ? (modelledCostBps / 1e4) * notional : null, flags,
  };
}

export type AnnualCost = { fills: number; months: number; tradesPerMonth: number; avgTradeUsd: number; perYearUsd: number; pctOfPortfolio: number | null; measuredVsTypicalBps: number | null; feesUsd: number };

/** The last 12 months projected to a year. Pure. */
export function annualCost(rows: FillAnalysis[], portfolioUsd: number | null, now = new Date()): AnnualCost {
  const since = new Date(now.getTime() - 365 * 86_400_000).toISOString();
  const xs = rows.filter((r) => r.fill.executedAt >= since);
  const first = xs.map((r) => r.fill.executedAt).sort()[0];
  const months = first ? Math.max(1, (now.getTime() - Date.parse(first)) / (30.44 * 86_400_000)) : 1;
  const cost = xs.reduce((s, r) => s + (r.modelledCostUsd ?? 0), 0);
  const perYear = cost * Math.min(12 / months, 12);
  const vt = xs.filter((r) => r.vsTypicalBps !== null);
  const notional = vt.reduce((s, r) => s + r.notionalUsd, 0);
  return {
    fills: xs.length, months: Math.round(months * 10) / 10, tradesPerMonth: xs.length / months, avgTradeUsd: xs.length ? xs.reduce((s, r) => s + r.notionalUsd, 0) / xs.length : 0,
    perYearUsd: perYear, pctOfPortfolio: portfolioUsd && portfolioUsd > 0 ? perYear / portfolioUsd : null,
    measuredVsTypicalBps: notional > 0 ? vt.reduce((s, r) => s + (r.vsTypicalBps as number) * r.notionalUsd, 0) / notional : null,
    feesUsd: xs.reduce((s, r) => s + (r.fill.fees ?? 0), 0),
  };
}
