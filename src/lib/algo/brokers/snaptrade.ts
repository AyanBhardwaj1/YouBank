/**
 * SnapTrade as a BrokerAdapter: copy trading's client (copytrade/snaptrade.ts) and its signing, the same
 * SnapTrade user and connection (so a person who connected for copy trading pays SnapTrade's per-user
 * fee once for both), behind the shared interface. Which brokers can trade through it is SnapTrade's
 * per-broker access table: Webull US, Schwab (with Schwab's own approval), Fidelity, E*TRADE, Tradier,
 * Alpaca and others read and trade; Robinhood is read-only (positions, no orders). The account's
 * authorization says which, and an account whose broker does not allow trading is refused before any order.
 */
import { positionsOf, snaptrade, type SnapOrder, type SnapUser, type TradeForm } from "@/lib/copytrade/snaptrade";
import type { BrokerAccount, BrokerAdapter, BrokerPosition, Capabilities, OrderInfo, OrderRequest } from "./types";

type Lookup = (u: SnapUser, accountId: string, ticker: string) => Promise<string | null>;

/** The checked-trade form for SnapTrade, from one of our orders. Pure. */
export function snapForm(o: OrderRequest): TradeForm {
  return { account_id: o.accountId, action: o.side === "buy" ? "BUY" : "SELL", universal_symbol_id: o.brokerSymbolId ?? "", order_type: o.type === "limit" ? "Limit" : "Market", time_in_force: o.timeInForce === "gtc" ? "GTC" : "Day", price: o.type === "limit" ? o.limitPrice : null, units: o.qty };
}

export function snaptradeAdapter(u: SnapUser, opts: { fractional: boolean; trading: boolean; lookup: Lookup }): BrokerAdapter {
  const caps: Capabilities = {
    equities: opts.trading, fractional: opts.fractional, options: false, crypto: false, orderTypes: ["market", "limit"], timeInForce: ["day", "gtc"],
    extendedHours: false, preview: true, cancel: true, quotes: false, clientOrderId: "echo", clientOrderIdMax: 36, paper: false,
  };
  const info = (o: SnapOrder): OrderInfo => ({ brokerOrderId: o.brokerage_order_id ?? "", clientOrderId: null, status: o.status ?? "", filledQty: Number(o.filled_quantity ?? 0) || 0, avgFillPrice: Number.isFinite(Number(o.execution_price)) && o.execution_price !== null ? Number(o.execution_price) : null, raw: o });
  return {
    id: "snaptrade",
    capabilities: () => caps,
    async accounts(): Promise<BrokerAccount[]> {
      const [accts, auths] = await Promise.all([snaptrade.accounts(u), snaptrade.authorizations(u).catch(() => [])]);
      const byAuth = new Map(auths.map((a) => [a.id, a.brokerage]));
      return accts.map((a) => {
        const b = byAuth.get(a.brokerage_authorization);
        return { id: a.id, name: a.name ?? a.institution_name, number: a.number ? `…${a.number.slice(-4)}` : "", paper: !!a.is_paper, currency: a.balance?.total?.currency ?? "USD", equity: a.balance?.total?.amount ?? null, cash: null, buyingPower: null, type: "unknown" as const, tradingAllowed: b?.allows_trading !== false };
      });
    },
    async positions(accountId: string): Promise<BrokerPosition[]> {
      return positionsOf(await snaptrade.holdings(u, accountId)).positions.map((p) => ({ symbol: p.ticker, units: p.units, price: p.price, marketValue: p.units * p.price, avgCost: null }));
    },
    async balances(accountId: string) {
      const p = positionsOf(await snaptrade.holdings(u, accountId));
      return { cash: p.cash, buyingPower: null, equity: p.total, currency: "USD" };
    },
    async resolveSymbol(accountId: string, symbol: string) { return opts.lookup(u, accountId, symbol); },
    async preview(o: OrderRequest) {
      if (!o.brokerSymbolId) throw Object.assign(new Error("The broker could not find this ticker."), { status: 400 });
      const r = await snaptrade.orderImpact(u, snapForm(o));
      const imp = r.trade_impacts?.[0];
      return { tradeId: r.trade?.id ?? null, estimatedCommission: imp?.estimated_commission ?? null, estimatedCost: null, raw: r };
    },
    async placePreviewed(tradeId: string) {
      const r = await snaptrade.placeChecked(u, tradeId);
      return { brokerOrderId: r.brokerage_order_id ?? "", status: r.status ?? "placed", raw: r };
    },
    async placeOrder(o: OrderRequest) {
      const r = await snaptrade.placeForce(u, { ...snapForm(o), client_order_id: o.clientOrderId });
      return { brokerOrderId: r.brokerage_order_id ?? "", status: r.status ?? "placed", raw: r };
    },
    async cancel(accountId: string, brokerOrderId: string) { await snaptrade.cancelOrder(u, accountId, brokerOrderId); },
    async orderStatus(accountId, ref) {
      if (!ref.brokerOrderId) return null;
      return info(await snaptrade.orderDetail(u, accountId, ref.brokerOrderId));
    },
  };
}
