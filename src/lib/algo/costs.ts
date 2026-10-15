/**
 * Trading costs and option prices for backtests and the paper broker. Pure.
 *
 * Costs per fill, in dollars:
 * - commission: per share (with a minimum) and/or basis points of value (0 at most US retail brokers for
 *   stocks and ETFs today; options typically $0.50–$0.65 a contract, crypto 0.1–0.6% of value);
 * - regulatory fees on sells: the SEC's Section 31 fee (a rate per million dollars sold that the SEC resets
 *   each fiscal year) and FINRA's trading activity fee (per share, capped per trade). Both are inputs,
 *   because their rates change; the defaults are the published rates as of this writing and are small;
 * - slippage: half the bid-ask spread plus a square-root market-impact term, σ·k·√(order / ADV), the
 *   standard approximation (Almgren et al. 2005; Kissell). Without volume data it is a fixed spread.
 *
 * Option prices for the income templates: Black–Scholes with volatility = recent realised volatility ×
 * (1 + an implied-volatility premium). Real option quotes are not used; results are labelled as modelled.
 */
import { normCdf, normInv } from "@/lib/edge/scen/stats";

export type CostModel = {
  commissionPerShare: number;
  commissionMin: number;
  commissionBps: number;
  /** Section 31 fee, dollars per million dollars of sales. */
  secFeePerMillion: number;
  /** FINRA TAF per share sold, and its cap per trade. */
  tafPerShare: number;
  tafMax: number;
  /** Half-spread paid on every fill, in basis points of price. */
  halfSpreadBps: number;
  /** Impact coefficient k in σ·k·√(participation); 0 turns the impact term off. */
  impactK: number;
  /** Per-contract option commission. */
  optionPerContract: number;
};

/**
 * US-listed stocks and ETFs at a zero-commission broker. The Section 31 default ($27.80 per million) is the
 * rate set for fiscal 2025 and the TAF ($0.000166 a share, $8.30 cap) FINRA's 2024–25 schedule; the SEC has
 * since reset its rate, so these err high. Check the SEC's and FINRA's current notices and pass the rates in.
 */
export const US_EQUITY: CostModel = { commissionPerShare: 0, commissionMin: 0, commissionBps: 0, secFeePerMillion: 27.8, tafPerShare: 0.000166, tafMax: 8.3, halfSpreadBps: 2, impactK: 0.1, optionPerContract: 0.65 };
/** Spot crypto: a percentage fee and wider spreads, no regulatory fees. */
export const CRYPTO: CostModel = { commissionPerShare: 0, commissionMin: 0, commissionBps: 25, secFeePerMillion: 0, tafPerShare: 0, tafMax: 0, halfSpreadBps: 10, impactK: 0.1, optionPerContract: 0 };
export const FREE: CostModel = { commissionPerShare: 0, commissionMin: 0, commissionBps: 0, secFeePerMillion: 0, tafPerShare: 0, tafMax: 0, halfSpreadBps: 0, impactK: 0, optionPerContract: 0 };

export type Fill = { price: number; fees: number; slippageUsd: number };

/**
 * The price and fees of filling `qty` at reference price `px`. `dailyVol` is the daily return volatility
 * and `adv` the average daily dollar volume (0 or missing: no impact term).
 */
export function fillCost(side: "buy" | "sell", qty: number, px: number, m: CostModel, opts: { dailyVol?: number; adv?: number; contracts?: number } = {}): Fill {
  const value = Math.abs(qty) * px;
  const impact = m.impactK > 0 && opts.adv && opts.adv > 0 && opts.dailyVol ? m.impactK * opts.dailyVol * Math.sqrt(value / opts.adv) : 0;
  const slip = m.halfSpreadBps / 10_000 + impact;
  const price = side === "buy" ? px * (1 + slip) : px * (1 - slip);
  let fees = Math.max(m.commissionMin, Math.abs(qty) * m.commissionPerShare) + (value * m.commissionBps) / 10_000;
  if (opts.contracts) fees += opts.contracts * m.optionPerContract;
  if (side === "sell") fees += (value * m.secFeePerMillion) / 1e6 + Math.min(m.tafMax, Math.abs(qty) * m.tafPerShare);
  if (qty === 0) fees = 0;
  return { price, fees: Math.round(fees * 100) / 100, slippageUsd: Math.abs(price - px) * Math.abs(qty) };
}

/* ---------------- Black–Scholes ---------------- */

export function bsPrice(kind: "call" | "put", S: number, K: number, T: number, vol: number, r = 0): number {
  if (T <= 0 || vol <= 0) return Math.max(0, kind === "call" ? S - K : K - S);
  const d1 = (Math.log(S / K) + (r + vol * vol / 2) * T) / (vol * Math.sqrt(T)), d2 = d1 - vol * Math.sqrt(T);
  return kind === "call" ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export function bsDelta(kind: "call" | "put", S: number, K: number, T: number, vol: number, r = 0): number {
  if (T <= 0 || vol <= 0) return kind === "call" ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const d1 = (Math.log(S / K) + (r + vol * vol / 2) * T) / (vol * Math.sqrt(T));
  return kind === "call" ? normCdf(d1) : normCdf(d1) - 1;
}

/** The strike with |delta| = target (closed form from d1), rounded to the strike grid. */
export function strikeForDelta(kind: "call" | "put", S: number, T: number, vol: number, delta: number, step = 1, r = 0): number {
  const d1 = kind === "call" ? normInv(delta) : normInv(1 - delta);
  const K = S * Math.exp(-(d1 * vol * Math.sqrt(T)) + (r + vol * vol / 2) * T);
  // Out of the money: calls round up, puts round down.
  return kind === "call" ? Math.ceil(K / step) * step : Math.floor(K / step) * step;
}

/** The OCC option symbol (e.g. SPY261120C00600000): root, YYMMDD expiry, C/P, strike × 1000 in 8 digits. */
export function occSymbol(root: string, expiry: string, kind: "call" | "put", strike: number): string {
  const [y, m, d] = expiry.split("-");
  return `${root.toUpperCase().replace(/[^A-Z]/g, "")}${y.slice(2)}${m}${d}${kind === "call" ? "C" : "P"}${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

/** The standard monthly expiry (third Friday) on or after `dteDays` from `date`. */
export function monthlyExpiry(date: string, dteDays: number): string {
  const t = new Date(Date.parse(`${date}T00:00:00Z`) + dteDays * 86_400_000);
  for (let k = 0; k < 3; k++) {
    const y = t.getUTCFullYear(), m = t.getUTCMonth() + k;
    const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const third = new Date(Date.UTC(y, m, 1 + ((5 - first + 7) % 7) + 14));
    if (third.getTime() >= t.getTime()) return third.toISOString().slice(0, 10);
  }
  return t.toISOString().slice(0, 10);
}
