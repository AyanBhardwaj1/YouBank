/**
 * Sending a strategy's batch: copy trading's one-tap approval (copytrade/orders.ts, `approveBatch`) reused
 * with algo trading's store and any BrokerAdapter, with the risk engine run first. Server-side, but pure
 * apart from what is passed in, so scripts/test-algo.ts runs it with in-memory fakes:
 * - the batch is claimed proposed → placing once, and each order pending → submitting once, so two taps,
 *   two ticks or two instances can never send an order twice;
 * - every order carries a client order id derived from the strategy, the decision and its position;
 * - a broker call with no answer leaves the order "unknown", never resent; new orders for that strategy
 *   wait (risk rule 2) until reconciliation settles it;
 * - immediately before the claim, the risk engine checks every order with state read fresh; blocked orders
 *   are marked "blocked" with the reason and never sent.
 */
import { approveBatch, type ApproveResult, type CopyStore, type OrderBroker, type OrderRow } from "@/lib/copytrade/orders";
import type { MarketState } from "@/lib/copytrade/markethours";
import type { BrokerAdapter, OrderRequest } from "./brokers/types";
import type { OrderCheck, RiskOrder } from "./risk";

/** An algo order row as copy trading's approval sees it, plus what the adapter needs. */
export type AlgoOrderRow = OrderRow & { assetClass: "equity" | "crypto" | "option" };

/** Our order as the adapter's request. Limit orders are DAY for equities (GTC for crypto, which never closes). */
export function toRequest(o: AlgoOrderRow, accountId: string, extendedHours = false): OrderRequest {
  return {
    accountId, clientOrderId: o.clientOrderId, symbol: o.ticker, assetClass: o.assetClass, side: o.action === "BUY" ? "buy" : "sell", qty: o.units,
    type: o.orderType === "Market" ? "market" : "limit", limitPrice: o.orderType === "Limit" ? o.limitPrice : null, timeInForce: o.assetClass === "crypto" ? "gtc" : "day",
    extendedHours, brokerSymbolId: o.symbolId, ...(o.assetClass === "option" ? { positionIntent: o.action === "SELL" ? "sell_to_open" as const : "buy_to_close" as const } : {}),
  };
}

/** A BrokerAdapter as the OrderBroker copy trading's approval drives: preview when it can, else place directly with our id. */
export function orderBroker(a: BrokerAdapter, accountId: string, rows: Map<number, AlgoOrderRow>, extendedHours = false): OrderBroker {
  const req = (o: OrderRow) => toRequest(rows.get(o.id) ?? { ...o, assetClass: "equity" }, accountId, extendedHours);
  return {
    async impact(o) {
      if (!a.preview || !a.placePreviewed) return { tradeId: null, commission: null, remainingCash: null };
      const p = await a.preview(req(o));
      return { tradeId: p.tradeId, commission: p.estimatedCommission, remainingCash: null, raw: p.raw };
    },
    async placeChecked(tradeId, o) {
      const r = await a.placePreviewed!(tradeId, req(o));
      return { brokerageOrderId: r.brokerOrderId, status: r.status, raw: r.raw };
    },
    async placeForce(o) {
      const r = await a.placeOrder(req(o));
      return { brokerageOrderId: r.brokerOrderId, status: r.status, raw: r.raw };
    },
  };
}

export type SendRequest = {
  batchId: number;
  user: { id: string; email: string };
  idemKey: string;
  confirmation: string;
  now: Date;
  market: MarketState;
  maxDayUsd: number;
  maxOrderUsd: number;
  /** Autonomous batches (and later TWAP slices of an approved batch) carry standing consent: no typed phrase. */
  autonomous: boolean;
  extendedHours?: boolean;
  ip?: string | null;
  userAgent?: string | null;
};

export type RiskGate = (orders: { row: AlgoOrderRow; order: RiskOrder }[]) => Promise<{ results: (OrderCheck & { order: RiskOrder })[]; trip: OrderCheck["trip"] }>;

export type AlgoStore = CopyStore & {
  algoOrders(batchId: number): Promise<AlgoOrderRow[]>;
  /** pending → blocked with the reasons (risk). */
  blockOrder(orderId: number, reason: string): Promise<void>;
  /** The risk engine tripped this strategy's kill switch. */
  tripKill(batchId: number, reason: string): Promise<void>;
};

/** Run the risk engine on a batch's pending orders, then send what passed, once. */
export async function sendBatch(store: AlgoStore, adapter: BrokerAdapter, accountId: string, risk: RiskGate, req: SendRequest): Promise<ApproveResult & { blocked: { ticker: string; reasons: string[] }[] }> {
  const rows = (await store.algoOrders(req.batchId)).filter((o) => o.status === "pending");
  const checked = await risk(rows.map((row) => ({ row, order: { symbol: row.ticker, side: row.action === "BUY" ? "buy" : "sell", qty: row.units, price: row.estValue / Math.max(1e-9, row.units), limitPrice: row.limitPrice !== null && row.assetClass === "option" ? row.limitPrice * 100 : row.limitPrice, type: row.orderType === "Market" ? "market" : "limit", assetClass: row.assetClass } })));
  const blocked: { ticker: string; reasons: string[] }[] = [];
  for (const [i, r] of checked.results.entries()) {
    if (r.ok) continue;
    const reasons = r.violations.filter((v) => v.severity === "block").map((v) => v.message);
    blocked.push({ ticker: rows[i].ticker, reasons });
    await store.blockOrder(rows[i].id, reasons.join(" "));
    await store.audit({ userId: req.user.id, actor: "risk-engine", action: "order-blocked", batchId: req.batchId, orderId: rows[i].id, payload: { rules: r.violations.map((v) => v.rule), reasons } });
  }
  if (checked.trip) await store.tripKill(req.batchId, "drawdown");
  if (rows.length && blocked.length === rows.length) {
    // Nothing may go: the batch ends here, with every reason on its orders and in the audit log.
    await store.finishBatch(req.batchId, "failed");
    return { outcome: "failed", status: "failed", orders: await store.orders(req.batchId), message: `The risk engine blocked every order: ${blocked[0].reasons[0] ?? "a limit was reached"}`, blocked };
  }
  const map = new Map(rows.map((r) => [r.id, r]));
  const result = await approveBatch(store, orderBroker(adapter, accountId, map, req.extendedHours), {
    batchId: req.batchId, user: req.user, idemKey: req.idemKey, confirmation: req.confirmation, now: req.now, ip: req.ip, userAgent: req.userAgent,
    maxDayUsd: req.maxDayUsd, maxOrderUsd: req.maxOrderUsd, market: req.market, confirm: req.autonomous ? "none" : "typed", noun: "strategy",
  });
  return { ...result, blocked };
}
