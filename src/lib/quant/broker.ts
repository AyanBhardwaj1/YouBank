/**
 * A person's own broker data for Quant, through the SnapTrade connection copy trading already made (Pro:
 * copytrade.broker pays SnapTrade's per-user fee). Read-only: holdings for Factor Lab and Risk, recent orders as
 * fills for Costs. Never shown to anyone else, never pooled.
 */
import type { CurrentUser } from "@/lib/auth/user";
import { snapUser } from "@/lib/copytrade/live";
import { positionsOf, snaptrade, type SnapOrder } from "@/lib/copytrade/snaptrade";
import type { Fill } from "./contracts";

type Person = Pick<CurrentUser, "id" | "email">;

/** The account's positions as portfolio weights (by market value), and its total. */
export async function brokerHoldings(user: Person, accountId: string): Promise<{ holdings: { symbol: string; weight: number }[]; total: number; cash: number }> {
  const u = await snapUser(user.id);
  if (!u) throw Object.assign(new Error("Connect a brokerage account in Fund copies first."), { status: 409 });
  const p = positionsOf(await snaptrade.holdings(u, accountId));
  const invested = p.positions.reduce((s, x) => s + x.units * x.price, 0);
  return { holdings: p.positions.filter((x) => x.units * x.price > 0).map((x) => ({ symbol: x.ticker, weight: (x.units * x.price) / (invested || 1) })), total: p.total, cash: p.cash };
}

/** A SnapTrade order as a Fill, when it executed. Pure. */
export function orderToFill(o: SnapOrder, accountRef: string, broker?: string): Fill | null {
  const qty = Number(o.filled_quantity ?? o.total_quantity ?? NaN), price = Number(o.execution_price ?? NaN);
  const sym = (o.universal_symbol?.symbol ?? o.symbol ?? "").toUpperCase().replace(/[./]/g, "-");
  if (!(qty > 0) || !(price > 0) || !sym || !o.brokerage_order_id || !(o.status ?? "").toUpperCase().includes("EXECUTED")) return null;
  const action = (o.action ?? "").toUpperCase();
  const side = action.includes("SELL_SHORT") || action === "SHORT" ? "short" : action.includes("BUY_TO_COVER") || action === "COVER" ? "cover" : action.startsWith("SELL") ? "sell" : "buy";
  const ot = (o.order_type ?? "").toLowerCase();
  const executedAt = o.time_executed ?? o.time_placed;
  if (!executedAt) return null;
  return {
    source: "snaptrade", accountRef, broker, extId: o.brokerage_order_id, symbol: sym, side, qty, price,
    executedAt: new Date(executedAt).toISOString(), ...(o.time_placed ? { placedAt: new Date(o.time_placed).toISOString() } : {}),
    orderType: ot.includes("market") ? "market" : ot.includes("limit") ? "limit" : ot.includes("stop") ? "stop" : "other",
    ...(o.limit_price ? { limitPrice: Number(o.limit_price) } : {}),
  };
}

/** Executed orders from the last `days` (SnapTrade's recent-orders endpoint covers a few days). */
export async function brokerFills(user: Person, accountId: string, days = 3): Promise<Fill[]> {
  const u = await snapUser(user.id);
  if (!u) throw Object.assign(new Error("Connect a brokerage account in Fund copies first."), { status: 409 });
  const orders = await snaptrade.recentOrders(u, accountId, days);
  return orders.map((o) => orderToFill(o, accountId)).filter((f): f is Fill => !!f);
}
