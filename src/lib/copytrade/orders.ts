/**
 * One-tap approval: a reviewed batch of orders goes to the broker, once. The storage and the broker are
 * passed in (a database store and SnapTrade in the app, in-memory fakes in scripts/test-copytrade.ts), so
 * the rules that keep money safe are tested as they run.
 *
 * Why a double tap can never double-order:
 * 1. The batch moves from "proposed" to "placing" in one conditional update that only one request can
 *    win. The loser (a second tap, a retried request, a second tab) places nothing: it reads the batch and
 *    answers with its state, the same answer when it carries the same idempotency key.
 * 2. Each order moves from "pending" to "submitting" the same way before its broker call, so even two
 *    winners (there cannot be two, but defence in depth) would not both send it.
 * 3. Each order carries a client order id derived from the batch and its position, a canonical UUID that
 *    SnapTrade passes to brokers that de-duplicate on it.
 * 4. A broker call that times out or fails without an answer leaves the order "unknown", never retried
 *    automatically: it may have reached the broker. The status refresh (and the person's broker) settles it.
 *
 * Every step writes to the audit log: who approved, when, from where, and the exact payloads sent.
 */
import { createHash } from "node:crypto";
import type { MarketState } from "./markethours";
import { refusalMessage } from "@/lib/error-text";

export type BatchStatus = "proposed" | "placing" | "placed" | "partial" | "failed" | "canceled" | "expired";
export type OrderStatus = "pending" | "submitting" | "placed" | "rejected" | "unknown" | "skipped" | string;

export type BatchRow = {
  id: number; userId: string; portfolioId: number; accountId: string; status: BatchStatus;
  idemKey: string | null; buyValue: number; sellValue: number; orderCount: number; expiresAt: Date;
};
export type OrderRow = {
  id: number; batchId: number; seq: number; clientOrderId: string; ticker: string; symbolId: string | null;
  action: "BUY" | "SELL"; units: number; orderType: "Limit" | "Market"; limitPrice: number | null; estValue: number;
  status: OrderStatus; brokerageOrderId: string | null; error: string | null;
};
export type AuditEntry = { userId: string; actor: string; action: string; batchId?: number | null; orderId?: number | null; portfolioId?: number | null; payload: Record<string, unknown>; ip?: string | null; userAgent?: string | null };

export interface CopyStore {
  batch(id: number, userId: string): Promise<BatchRow | null>;
  /** proposed -> placing with the idempotency key, only when still proposed and not expired at `at`. True for the one caller that won. */
  claimBatch(id: number, userId: string, idemKey: string, at: Date): Promise<boolean>;
  /** placing -> proposed again, only for the claim with this key and before any order was sent (the daily limit's second check). */
  releaseBatch(id: number, idemKey: string): Promise<void>;
  orders(batchId: number): Promise<OrderRow[]>;
  /** pending -> submitting. True for the one caller that won. */
  claimOrder(orderId: number): Promise<boolean>;
  updateOrder(orderId: number, patch: Partial<Pick<OrderRow, "status" | "brokerageOrderId" | "error">> & { impact?: unknown; response?: unknown }): Promise<void>;
  finishBatch(id: number, status: BatchStatus): Promise<void>;
  /**
   * Value of this person's copy orders in batches approved since `since` that were not turned down: sent,
   * being sent, or claimed and about to be (for the daily limit). Counting claimed batches is what makes
   * the limit hold when two batches are approved at the same moment.
   */
  committedValueSince(userId: string, since: Date): Promise<number>;
  audit(e: AuditEntry): Promise<void>;
}

export type PlaceResult = { brokerageOrderId: string; status: string; raw?: unknown };
export interface OrderBroker {
  /** The broker's check of an order; tradeId null when this broker does not offer the check. */
  impact(o: OrderRow): Promise<{ tradeId: string | null; commission: number | null; remainingCash: number | null; raw?: unknown }>;
  placeChecked(tradeId: string, o: OrderRow): Promise<PlaceResult>;
  placeForce(o: OrderRow): Promise<PlaceResult>;
}

/** A canonical version-4-shaped UUID derived from a batch and an order's position: the same order, the same id. Pure. */
export function clientOrderId(batchId: number, seq: number, salt = ""): string {
  const h = createHash("sha256").update(`youbank-copy:${salt}:${batchId}:${seq}`).digest();
  h[6] = (h[6] & 0x0f) | 0x40;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** Batches at or above this value, or with this many orders, need the typed confirmation. */
export const LARGE_BATCH_USD = 10_000;
export const LARGE_BATCH_ORDERS = 15;

/** The words a person types to approve a large batch, or null when a click is enough. Pure. */
export function confirmationPhrase(b: Pick<BatchRow, "buyValue" | "sellValue" | "orderCount">): string | null {
  return b.buyValue + b.sellValue >= LARGE_BATCH_USD || b.orderCount >= LARGE_BATCH_ORDERS ? `PLACE ${b.orderCount} ORDERS` : null;
}

export type ApproveRequest = {
  batchId: number;
  user: { id: string; email: string };
  idemKey: string;
  confirmation: string;
  now: Date;
  ip?: string | null;
  userAgent?: string | null;
  maxDayUsd: number;
  /** The per-order ceiling now (the copy's and the server's, whichever is lower), checked again at approval. */
  maxOrderUsd: number;
  market: MarketState;
  /**
   * Generalised for algo trading (lib/algo/orders.ts), which reuses this function with its own store and
   * brokers: "typed" (the default) asks for the typed confirmation on large batches; "none" is for batches
   * the person already authorised another way (a strategy's autonomous mode, with its own stored consent).
   */
  confirm?: "typed" | "none";
  /** What the orders belong to, in messages ("copy" by default; "strategy" for algo trading). */
  noun?: string;
};

export type ApproveResult = { outcome: "placed" | "partial" | "failed" | "already"; status: BatchStatus; orders: OrderRow[]; message: string };

const refuse = (message: string, status: number) => Object.assign(new Error(message), { status });
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const transient = (e: unknown) => {
  const s = (e as { status?: number } | null)?.status;
  const name = (e as { name?: string } | null)?.name ?? "";
  return name === "TimeoutError" || name === "AbortError" || s === undefined || s >= 500;
};
const say = (e: unknown) => refusalMessage(e, "No answer from the broker");

/** Approve and place a batch. Throws (with an HTTP status) when it must not go; otherwise reports what happened. */
export async function approveBatch(store: CopyStore, broker: OrderBroker, req: ApproveRequest): Promise<ApproveResult> {
  const b = await store.batch(req.batchId, req.user.id);
  if (!b) throw refuse("That batch of orders was not found.", 404);
  if (!/^[A-Za-z0-9-]{8,80}$/.test(req.idemKey)) throw refuse("This approval is missing its key. Reload the page and try again.", 400);
  if (b.status !== "proposed") {
    if (b.idemKey === req.idemKey) return { outcome: "already", status: b.status, orders: await store.orders(b.id), message: "Already approved. Nothing new was sent." };
    throw refuse(b.status === "canceled" ? "This batch was canceled." : b.status === "expired" ? "These orders are out of date. Review a fresh set." : "This batch was already approved. Nothing new was sent.", 409);
  }
  if (b.expiresAt.getTime() < req.now.getTime()) { await store.finishBatch(b.id, "expired"); throw refuse("These orders are out of date (prices move). Review a fresh set.", 409); }
  const noun = req.noun ?? "copy";
  const phrase = req.confirm === "none" ? null : confirmationPhrase(b);
  if (phrase && req.confirmation.trim().toUpperCase() !== phrase) throw refuse(`This is a large batch. Type "${phrase}" to approve it.`, 400);
  const orders = (await store.orders(b.id)).filter((o) => o.status === "pending");
  if (!orders.length) throw refuse("There are no orders to place in this batch.", 400);
  if (!req.market.open && orders.some((o) => o.orderType === "Market")) throw refuse(`The market is closed (${req.market.reason}). Market orders can only go while it is open; it next opens ${req.market.nextOpen}. Switch this ${noun} to limit orders, or come back then.`, 409);
  const tooBig = req.maxOrderUsd > 0 ? orders.find((o) => o.estValue > req.maxOrderUsd + 0.005) : undefined;
  if (tooBig) throw refuse(`The ${tooBig.ticker} order is over the per-order limit of $${req.maxOrderUsd.toLocaleString("en-US")}. Review a fresh set.`, 409);
  const value = b.buyValue + b.sellValue;
  const overDay = (total: number) => refuse(`This would take today's ${noun} orders to $${Math.round(total).toLocaleString("en-US")}, over your daily limit of $${req.maxDayUsd.toLocaleString("en-US")}. Raise the limit in the ${noun}'s settings or wait until tomorrow.`, 400);
  const since = startOfDay(req.now);
  const sent = await store.committedValueSince(req.user.id, since);
  if (req.maxDayUsd > 0 && sent + value > req.maxDayUsd) throw overDay(sent + value);

  if (!(await store.claimBatch(b.id, req.user.id, req.idemKey, req.now))) {
    const now = await store.batch(b.id, req.user.id);
    if (now?.idemKey === req.idemKey) return { outcome: "already", status: now.status, orders: await store.orders(b.id), message: "Already approved. Nothing new was sent." };
    throw refuse(now?.status === "proposed" ? "These orders are out of date (prices move). Review a fresh set." : "This batch was already approved. Nothing new was sent.", 409);
  }
  // The first check read before the claim, so a second batch approved at the same moment could pass it
  // too. Read again now that this claim is committed: of two simultaneous claims, at least one sees the
  // other, so both can never go over the limit. Nothing has been sent yet, so the claim is undone.
  if (req.maxDayUsd > 0) {
    const committed = await store.committedValueSince(req.user.id, since);
    if (committed > req.maxDayUsd + 0.005) { await store.releaseBatch(b.id, req.idemKey); throw overDay(committed); }
  }
  await store.audit({ userId: req.user.id, actor: req.user.email, action: "approve", batchId: b.id, portfolioId: b.portfolioId, ip: req.ip, userAgent: req.userAgent,
    payload: { idemKey: req.idemKey, confirmation: req.confirm === "none" ? "standing consent" : phrase ? "typed" : "click", market: req.market, accountId: b.accountId, orders: orders.map((o) => ({ id: o.id, clientOrderId: o.clientOrderId, ticker: o.ticker, action: o.action, units: o.units, orderType: o.orderType, limitPrice: o.limitPrice, estValue: o.estValue })) } });

  let placed = 0, failed = 0, unknown = 0;
  for (const o of orders) {
    if (!(await store.claimOrder(o.id))) continue;
    let impact: Awaited<ReturnType<OrderBroker["impact"]>> | null = null;
    try {
      impact = await broker.impact(o);
    } catch (e) {
      if (!transient(e)) {
        failed++;
        await store.updateOrder(o.id, { status: "rejected", error: say(e) });
        await store.audit({ userId: req.user.id, actor: "system", action: "order-rejected", batchId: b.id, orderId: o.id, payload: { stage: "impact", reason: say(e) } });
        continue;
      }
      // The check itself did not answer: place without it, with our client order id for de-duplication.
    }
    try {
      const r = impact?.tradeId ? await broker.placeChecked(impact.tradeId, o) : await broker.placeForce(o);
      placed++;
      await store.updateOrder(o.id, { status: r.status || "placed", brokerageOrderId: r.brokerageOrderId || null, impact: impact?.raw ?? null, response: r.raw ?? null });
      await store.audit({ userId: req.user.id, actor: "system", action: "order-placed", batchId: b.id, orderId: o.id, payload: { checked: !!impact?.tradeId, tradeId: impact?.tradeId ?? null, commission: impact?.commission ?? null, clientOrderId: o.clientOrderId, brokerageOrderId: r.brokerageOrderId, status: r.status, request: { ticker: o.ticker, symbolId: o.symbolId, action: o.action, units: o.units, orderType: o.orderType, limitPrice: o.limitPrice } } });
    } catch (e) {
      if (transient(e)) {
        unknown++;
        await store.updateOrder(o.id, { status: "unknown", error: "The broker did not confirm this order. It may or may not have been placed: check your broker before trying again." });
      } else {
        failed++;
        await store.updateOrder(o.id, { status: "rejected", error: say(e) });
      }
      await store.audit({ userId: req.user.id, actor: "system", action: transient(e) ? "order-unknown" : "order-rejected", batchId: b.id, orderId: o.id, payload: { stage: "place", reason: say(e) } });
    }
  }
  const status: BatchStatus = placed && !failed && !unknown ? "placed" : placed || unknown ? "partial" : "failed";
  await store.finishBatch(b.id, status);
  const message = status === "placed" ? `Sent ${placed} order${placed === 1 ? "" : "s"} to your broker.`
    : status === "partial" ? `Sent ${placed} of ${orders.length} orders.${failed ? ` ${failed} were turned down.` : ""}${unknown ? ` ${unknown} did not get an answer: check your broker before trying again.` : ""}`
    : "Your broker turned these orders down. Nothing was placed.";
  return { outcome: status === "placed" ? "placed" : status === "partial" ? "partial" : "failed", status, orders: await store.orders(b.id), message };
}
