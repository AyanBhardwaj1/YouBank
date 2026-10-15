/**
 * The built-in paper broker: a simulated account that fills orders against real quotes, with a spread,
 * slippage and fees, so paper results are not flattered by perfect fills. Every strategy starts here, and
 * live autonomous trading requires a stretch of paper trading first. The state is a plain object stored
 * with the strategy; the fill model is pure (scripts/test-algo.ts checks it).
 *
 * The fill model:
 * - market orders fill at the ask (buys) or bid (sells), moved a further `slippageBps` against us; without
 *   a bid and ask, at the last price ± `halfSpreadBps`;
 * - limit orders fill when marketable (a buy limit at or above the ask, a sell limit at or below the bid),
 *   at the better of the limit and that price; otherwise they rest and are checked on each later tick;
 * - equity orders rest while the market is closed and fill at the first quote after it opens; DAY orders
 *   still resting at the end of their day expire; crypto trades around the clock;
 * - fees come from the cost model (costs.ts): commissions, and the SEC and FINRA fees on sells;
 * - buys beyond the cash, and sells beyond the shares held (no short sales), are rejected;
 * - placing twice with the same client order id returns the first order (as brokers that de-duplicate do).
 * It does not model partial fills, queue position, or prices moving inside a minute.
 */
import { newYorkParts } from "@/lib/copytrade/markethours";
import { fillCost, US_EQUITY, CRYPTO, type CostModel } from "../costs";
import type { BrokerAccount, BrokerAdapter, BrokerQuote, Capabilities, OrderInfo, OrderRequest } from "./types";

export type PaperOrder = {
  id: string; clientOrderId: string; symbol: string; assetClass: OrderRequest["assetClass"]; side: "buy" | "sell"; qty: number;
  type: "market" | "limit"; limitPrice: number | null; timeInForce: "day" | "gtc"; status: "resting" | "filled" | "canceled" | "rejected" | "expired";
  filledQty: number; avgPrice: number | null; fees: number; createdAt: string; day: string; reason?: string;
};
export type PaperFill = { at: string; orderId: string; symbol: string; side: "buy" | "sell"; qty: number; price: number; fees: number; realized: number };
export type PaperState = { startCash: number; cash: number; positions: Record<string, { units: number; avgCost: number }>; orders: PaperOrder[]; fills: PaperFill[]; realized: number; seq: number };

export type FillModel = { slippageBps: number; halfSpreadBps: number; costs: CostModel; cryptoCosts: CostModel };
export const DEFAULT_FILL: FillModel = { slippageBps: 2, halfSpreadBps: 3, costs: { ...US_EQUITY, halfSpreadBps: 0, impactK: 0 }, cryptoCosts: { ...CRYPTO, halfSpreadBps: 0, impactK: 0 } };

export const newPaper = (cash: number): PaperState => ({ startCash: cash, cash, positions: {}, orders: [], fills: [], realized: 0, seq: 0 });

const CAPS: Capabilities = {
  equities: true, fractional: true, options: false, crypto: true, orderTypes: ["market", "limit"], timeInForce: ["day", "gtc"],
  extendedHours: false, preview: true, cancel: true, quotes: true, clientOrderId: "dedupe", clientOrderIdMax: 128, paper: true,
};

/** The executable price for an order now, or null when it would not fill (a limit that is not marketable). Pure. */
export function executablePrice(o: Pick<PaperOrder, "side" | "type" | "limitPrice">, q: BrokerQuote, m: FillModel): number | null {
  const last = q.last ?? (q.bid && q.ask ? (q.bid + q.ask) / 2 : null);
  const ask = q.ask ?? (last ? last * (1 + m.halfSpreadBps / 10_000) : null);
  const bid = q.bid ?? (last ? last * (1 - m.halfSpreadBps / 10_000) : null);
  if (o.side === "buy") {
    if (!ask) return null;
    const px = ask * (1 + m.slippageBps / 10_000);
    if (o.type === "market") return px;
    return o.limitPrice !== null && o.limitPrice >= ask ? Math.min(o.limitPrice, px) : null;
  }
  if (!bid) return null;
  const px = bid * (1 - m.slippageBps / 10_000);
  if (o.type === "market") return px;
  return o.limitPrice !== null && o.limitPrice <= bid ? Math.max(o.limitPrice, px) : null;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** Try to fill one resting order. Mutates `s`. Pure apart from that. */
export function tryFill(s: PaperState, o: PaperOrder, q: BrokerQuote | undefined, open: boolean, now: Date, m: FillModel = DEFAULT_FILL): void {
  if (o.status !== "resting") return;
  if (o.assetClass !== "crypto" && !open) return;
  if (!q) return;
  const px = executablePrice(o, q, m);
  if (px === null) return;
  const costs = o.assetClass === "crypto" ? m.cryptoCosts : m.costs;
  const fees = fillCost(o.side, o.qty, px, costs).fees;
  const pos = s.positions[o.symbol] ?? { units: 0, avgCost: 0 };
  if (o.side === "buy") {
    const need = o.qty * px + fees;
    if (need > s.cash + 1e-6) { o.status = "rejected"; o.reason = `Not enough cash: needs $${need.toFixed(2)}, has $${s.cash.toFixed(2)}.`; return; }
    s.cash = r6(s.cash - need);
    s.positions[o.symbol] = { units: r6(pos.units + o.qty), avgCost: (pos.units * pos.avgCost + o.qty * px) / (pos.units + o.qty) };
    s.fills.push({ at: now.toISOString(), orderId: o.id, symbol: o.symbol, side: "buy", qty: o.qty, price: r6(px), fees, realized: 0 });
  } else {
    if (o.qty > pos.units + 1e-9) { o.status = "rejected"; o.reason = `Sells ${o.qty} but holds ${pos.units}: short sales are not allowed.`; return; }
    const realized = (px - pos.avgCost) * o.qty - fees;
    s.cash = r6(s.cash + o.qty * px - fees);
    s.realized = r2(s.realized + realized);
    const left = r6(pos.units - o.qty);
    if (left <= 1e-9) delete s.positions[o.symbol]; else s.positions[o.symbol] = { units: left, avgCost: pos.avgCost };
    s.fills.push({ at: now.toISOString(), orderId: o.id, symbol: o.symbol, side: "sell", qty: o.qty, price: r6(px), fees, realized: r2(realized) });
  }
  o.status = "filled"; o.filledQty = o.qty; o.avgPrice = r6(px); o.fees = fees;
  if (s.fills.length > 1000) s.fills = s.fills.slice(-1000);
}

/** Re-check resting orders against fresh quotes and expire DAY orders from earlier days. Mutates `s`. */
export function sweep(s: PaperState, quotes: Record<string, BrokerQuote>, open: boolean, now: Date, m: FillModel = DEFAULT_FILL): void {
  const today = newYorkParts(now).date;
  for (const o of s.orders) {
    if (o.status !== "resting") continue;
    if (o.timeInForce === "day" && o.assetClass !== "crypto" && o.day < today) { o.status = "expired"; continue; }
    tryFill(s, o, quotes[o.symbol], open, now, m);
  }
  if (s.orders.length > 500) s.orders = s.orders.filter((o, i) => o.status === "resting" || i >= s.orders.length - 400);
}

/** Value of the paper account at given prices (positions without a price at their average cost). */
export const paperEquity = (s: PaperState, prices: Record<string, number>) => s.cash + Object.entries(s.positions).reduce((t, [k, p]) => t + p.units * (prices[k] ?? p.avgCost), 0);

/**
 * The paper broker behind the shared interface. `quotes` gives live quotes (the market data layer in the
 * app, fixtures in tests); `isOpen` says whether the equity market is open now.
 */
export function paperBroker(s: PaperState, deps: { quotes: (symbols: string[]) => Promise<Record<string, BrokerQuote>>; isOpen: () => boolean; now: () => Date; model?: FillModel }): BrokerAdapter {
  const m = deps.model ?? DEFAULT_FILL;
  const info = (o: PaperOrder): OrderInfo => ({ brokerOrderId: o.id, clientOrderId: o.clientOrderId, status: o.status, filledQty: o.filledQty, avgFillPrice: o.avgPrice, raw: o.reason ? { reason: o.reason } : undefined });
  return {
    id: "paper",
    capabilities: () => CAPS,
    async accounts(): Promise<BrokerAccount[]> {
      const q = await deps.quotes(Object.keys(s.positions)).catch(() => ({} as Record<string, BrokerQuote>));
      const eq = paperEquity(s, Object.fromEntries(Object.entries(q).map(([k, v]) => [k, v.last ?? v.bid ?? 0]).filter(([, v]) => (v as number) > 0)));
      return [{ id: "paper", name: "YouBank paper account", number: "", paper: true, currency: "USD", equity: eq, cash: s.cash, buyingPower: s.cash, type: "cash", tradingAllowed: true }];
    },
    async positions() {
      const q = await deps.quotes(Object.keys(s.positions)).catch(() => ({} as Record<string, BrokerQuote>));
      return Object.entries(s.positions).map(([k, p]) => { const px = q[k]?.last ?? p.avgCost; return { symbol: k, units: p.units, price: px, marketValue: p.units * px, avgCost: p.avgCost }; });
    },
    async balances() { return { cash: s.cash, buyingPower: s.cash, equity: null, currency: "USD" }; },
    quotes: (symbols) => deps.quotes(symbols),
    async preview(o) {
      const q = (await deps.quotes([o.symbol]))[o.symbol];
      const px = q ? executablePrice({ side: o.side, type: o.type, limitPrice: o.limitPrice }, q, m) : null;
      const fees = px ? fillCost(o.side, o.qty, px, o.assetClass === "crypto" ? m.cryptoCosts : m.costs).fees : null;
      return { tradeId: null, estimatedCommission: fees, estimatedCost: px ? o.qty * px : null };
    },
    async placeOrder(o: OrderRequest) {
      const dup = s.orders.find((x) => x.clientOrderId === o.clientOrderId);
      if (dup) return { brokerOrderId: dup.id, status: dup.status };
      const now = deps.now();
      const po: PaperOrder = { id: `paper-${++s.seq}`, clientOrderId: o.clientOrderId, symbol: o.symbol, assetClass: o.assetClass, side: o.side, qty: o.qty, type: o.type, limitPrice: o.limitPrice, timeInForce: o.timeInForce, status: "resting", filledQty: 0, avgPrice: null, fees: 0, createdAt: now.toISOString(), day: newYorkParts(now).date };
      s.orders.push(po);
      const q = await deps.quotes([o.symbol]).catch(() => ({} as Record<string, BrokerQuote>));
      tryFill(s, po, q[o.symbol], deps.isOpen(), now, m);
      return { brokerOrderId: po.id, status: po.status, raw: po.reason ? { reason: po.reason } : undefined };
    },
    async cancel(_a, id) { const o = s.orders.find((x) => x.id === id); if (o && o.status === "resting") o.status = "canceled"; },
    async orderStatus(_a, ref) {
      const o = s.orders.find((x) => (ref.brokerOrderId && x.id === ref.brokerOrderId) || (ref.clientOrderId && x.clientOrderId === ref.clientOrderId));
      return o ? info(o) : null;
    },
  };
}
