/**
 * From a decision to orders, and what happens to an order after that. Pure.
 *
 * - `planOrders`: the target weights × the strategy's capital, against what the strategy itself holds, as
 *   orders. This is copy trading's rebalance (copytrade/rebalance.ts) reused as it is: the strategy's own
 *   shares are its `managed` units, shares the person holds outside the strategy are protected (never
 *   counted, never sold), whole shares unless the broker trades fractions, sells first, buys scaled to the
 *   cash available, limit prices a band either side of the last price.
 * - `twap`: an order worth at least the threshold is cut into equal child orders spread evenly over a
 *   window, each its own limit order with its own client order id; the quantities add up exactly.
 * - `algoOrderId`: the client order id, derived from the strategy, the decision and the order's place in
 *   it, so the same order always carries the same id (brokers that de-duplicate on it reject a repeat).
 * - The order lifecycle: our states, the moves allowed between them, and each broker's words mapped to
 *   them. "unknown" (a placement that got no answer) is never resent: only reconciliation with the broker
 *   moves it on.
 */
import { clientOrderId } from "@/lib/copytrade/orders";
import { limitPrice, proposeOrders, roundUnits, type Proposal } from "@/lib/copytrade/rebalance";
import type { StrategySpec } from "./strategy";

export type PlanInput = {
  spec: StrategySpec;
  weights: Record<string, number>;
  /** The strategy's capital now (its equity in paper; for live, the lower of its capital and what the account can fund). */
  budgetUsd: number;
  cash: number;
  positions: { ticker: string; units: number; price: number }[];
  managed: Record<string, number>;
  prices: Record<string, number>;
  fractional: boolean;
};

/** The orders that move the strategy to its target, with what was skipped and why. */
export function planOrders(p: PlanInput): Proposal {
  return proposeOrders({
    targets: Object.entries(p.weights).filter(([, w]) => w > 0).map(([ticker, weight]) => ({ ticker, weight })),
    budgetUsd: p.budgetUsd, cash: p.cash, positions: p.positions, managed: p.managed, prices: p.prices, fractional: p.fractional,
    minOrderUsd: p.spec.execution.minOrderUsd, sellOutside: false, cashBufferPct: 0.005, useSaleProceeds: true,
    orderType: p.spec.execution.orderType, limitBand: p.spec.execution.limitBandBps / 10_000, maxOrderUsd: p.spec.risk.maxOrderUsd,
  });
}

export type Slice = { seq: number; of: number; units: number; notBefore: string; limitPrice: number | null };

/**
 * Time-weighted slicing. Orders under `thresholdUsd` (or a single slice) go at once. Each slice's limit is
 * re-centred on the price when it is sent (the caller passes it then); here it starts at the parent's.
 */
export function twap(units: number, price: number, start: Date, opts: { thresholdUsd: number; slices: number; minutes: number; fractional: boolean; limitPrice: number | null }): Slice[] {
  const n = units * price >= opts.thresholdUsd ? Math.max(1, opts.slices) : 1;
  const base = roundUnits(units / n, opts.fractional);
  const out: Slice[] = [];
  let left = units;
  for (let i = 0; i < n; i++) {
    const u = i === n - 1 ? Math.round(left * 1e4) / 1e4 : base;
    if (u <= 0) continue;
    left -= u;
    out.push({ seq: i, of: n, units: u, notBefore: new Date(start.getTime() + (n > 1 ? (i * opts.minutes * 60_000) / (n - 1) : 0)).toISOString(), limitPrice: opts.limitPrice });
  }
  return out.length ? out : [{ seq: 0, of: 1, units, notBefore: start.toISOString(), limitPrice: opts.limitPrice }];
}

/** A re-centred limit for a slice sent later: the band around the price at that time. */
export const sliceLimit = (price: number, side: "BUY" | "SELL", bandBps: number) => limitPrice(price, side, bandBps / 10_000);

/** The client order id of a strategy's order: a canonical UUID (and the 32-character form for brokers that cap the length). */
export function algoOrderId(strategyId: number, decisionId: number, seq: number, slice = 0): { uuid: string; short: string } {
  const uuid = clientOrderId(decisionId, seq * 100 + slice, `algo:${strategyId}`);
  return { uuid, short: uuid.replace(/-/g, "") };
}

/* ---------------- Lifecycle ---------------- */

export type OrderState = "pending" | "submitting" | "accepted" | "partially_filled" | "filled" | "canceled" | "expired" | "rejected" | "unknown";

export const FINAL: ReadonlySet<OrderState> = new Set(["filled", "canceled", "expired", "rejected"]);

const ALLOWED: Record<OrderState, OrderState[]> = {
  pending: ["submitting", "canceled", "expired"],
  submitting: ["accepted", "partially_filled", "filled", "rejected", "unknown"],
  accepted: ["partially_filled", "filled", "canceled", "expired", "rejected"],
  partially_filled: ["partially_filled", "filled", "canceled", "expired"],
  unknown: ["accepted", "partially_filled", "filled", "canceled", "expired", "rejected"],
  filled: [], canceled: [], expired: [], rejected: [],
};

/** Whether an order may move from one state to another. Nothing leaves a final state; nothing goes back to pending (which is what a resend would need). */
export const canMove = (from: OrderState, to: OrderState) => from === to ? !FINAL.has(from) : ALLOWED[from].includes(to);

/** Each broker's order status, in our words. Unrecognised statuses are "accepted" (still working) so they are asked about again. */
export function normaliseStatus(broker: string, raw: string | null | undefined): OrderState {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const map: Record<string, OrderState> = {
    // Alpaca
    new: "accepted", accepted: "accepted", pending_new: "accepted", accepted_for_bidding: "accepted", held: "accepted", calculated: "accepted", done_for_day: "accepted", pending_cancel: "accepted", pending_replace: "accepted", stopped: "accepted", suspended: "accepted",
    partially_filled: "partially_filled", filled: "filled", canceled: "canceled", cancelled: "canceled", expired: "expired", rejected: "rejected", replaced: "canceled",
    // SnapTrade (upper case in their API)
    executed: "filled", partial: "partially_filled", partial_canceled: "canceled", failed: "rejected", open: "accepted", pending: "accepted", queued: "accepted", triggered: "accepted", activated: "accepted",
    // Webull
    submitted: "accepted", working: "accepted", pending_submit: "accepted", partial_filled: "partially_filled", partially_executed: "partially_filled", fail: "rejected",
    // Robinhood crypto
    confirmed: "accepted", unconfirmed: "accepted",
  };
  if (!s) return broker === "paper" ? "pending" : "accepted";
  return map[s] ?? "accepted";
}
