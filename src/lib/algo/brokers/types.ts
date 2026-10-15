/**
 * One interface for every broker the strategies can trade through, generalised from copy trading's
 * SnapTrade flows (copytrade/live.ts): accounts, positions, balances, quotes where the broker offers them,
 * a preview of an order's cost, placing with our client order id, cancelling, and asking about an order.
 * `capabilities` says what the broker allows through its API, so the engine refuses (with the reason)
 * what a broker cannot do instead of finding out from a rejection.
 *
 * Adapters: the built-in paper broker (simulated fills on real prices), Alpaca (paper and live), SnapTrade
 * (the brokers it trades, through the same connection copy trading uses), Webull's OpenAPI, and
 * Robinhood's Crypto Trading API (crypto only). docs/algo-trading.md says what each broker officially
 * allows and why Robinhood stocks are not on the list.
 */

export type BrokerId = "paper" | "alpaca" | "snaptrade" | "webull" | "robinhood_crypto";

export type Capabilities = {
  equities: boolean;
  fractional: boolean;
  options: boolean;
  crypto: boolean;
  /** Order types and time-in-force values the API accepts. */
  orderTypes: ("market" | "limit" | "stop" | "stop_limit")[];
  timeInForce: ("day" | "gtc" | "ioc")[];
  extendedHours: boolean;
  /** A cost check before placing (SnapTrade's order impact, Webull's preview). */
  preview: boolean;
  cancel: boolean;
  quotes: boolean;
  /** Whether the broker rejects a second order with the same client order id ("dedupe"), only echoes it back, or ignores it. */
  clientOrderId: "dedupe" | "echo" | "none";
  /** The longest client order id it accepts. */
  clientOrderIdMax: number;
  /** A paper (simulated) environment. */
  paper: boolean;
};

export type BrokerAccount = {
  id: string;
  name: string;
  /** Last four characters only. */
  number: string;
  paper: boolean;
  currency: string;
  equity: number | null;
  cash: number | null;
  buyingPower: number | null;
  type: "cash" | "margin" | "unknown";
  tradingAllowed: boolean;
  /** Day trades in the last five business days and the broker's pattern-day-trader flag, where reported. */
  dayTradeCount?: number | null;
  patternDayTrader?: boolean | null;
};

export type BrokerPosition = { symbol: string; units: number; price: number; marketValue: number; avgCost: number | null };
export type BrokerBalances = { cash: number; buyingPower: number | null; equity: number | null; currency: string };
export type BrokerQuote = { symbol: string; bid: number | null; ask: number | null; last: number | null; at: string | null };

export type AssetClass = "equity" | "crypto" | "option";

export type OrderRequest = {
  accountId: string;
  clientOrderId: string;
  symbol: string;
  assetClass: AssetClass;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  limitPrice: number | null;
  timeInForce: "day" | "gtc";
  extendedHours?: boolean;
  /** Options: open or close (sell_to_open for covered calls and cash-secured puts). */
  positionIntent?: "buy_to_open" | "buy_to_close" | "sell_to_open" | "sell_to_close";
  /** The broker's own id for the symbol, where it needs one (SnapTrade's universal symbol id). */
  brokerSymbolId?: string | null;
};

export type OrderAck = { brokerOrderId: string; status: string; raw?: unknown };
export type OrderInfo = { brokerOrderId: string; clientOrderId: string | null; status: string; filledQty: number; avgFillPrice: number | null; raw?: unknown };
export type Preview = { tradeId: string | null; estimatedCommission: number | null; estimatedCost: number | null; raw?: unknown };

export interface BrokerAdapter {
  readonly id: BrokerId;
  capabilities(): Capabilities;
  accounts(): Promise<BrokerAccount[]>;
  positions(accountId: string): Promise<BrokerPosition[]>;
  balances(accountId: string): Promise<BrokerBalances>;
  quotes?(symbols: string[]): Promise<Record<string, BrokerQuote>>;
  preview?(o: OrderRequest): Promise<Preview>;
  /** Place an order the preview checked (SnapTrade's checked trade). */
  placePreviewed?(tradeId: string, o: OrderRequest): Promise<OrderAck>;
  placeOrder(o: OrderRequest): Promise<OrderAck>;
  cancel(accountId: string, brokerOrderId: string): Promise<void>;
  orderStatus(accountId: string, ref: { brokerOrderId?: string | null; clientOrderId?: string | null }): Promise<OrderInfo | null>;
  /** Resolve a ticker to the broker's own id, where it needs one. */
  resolveSymbol?(accountId: string, symbol: string): Promise<string | null>;
}

/**
 * A broker's refusal or failure, with what the person may be told. `transient` failures (timeouts, 5xx,
 * no answer) leave an order "unknown" and are never retried automatically; others are "rejected".
 */
export class BrokerError extends Error {
  constructor(message: string, readonly status: number, readonly httpStatus: number, readonly detail: string, readonly transient: boolean) {
    super(message);
    this.name = "BrokerError";
  }
}

/** Whether a capability allows an order, with the reason when it does not. Pure. */
export function supports(c: Capabilities, o: Pick<OrderRequest, "assetClass" | "type" | "timeInForce" | "qty" | "extendedHours">): string | null {
  if (o.assetClass === "equity" && !c.equities) return "This broker does not trade stocks through its API.";
  if (o.assetClass === "crypto" && !c.crypto) return "This broker does not trade crypto through its API.";
  if (o.assetClass === "option" && !c.options) return "This broker does not trade options through its API.";
  if (!c.orderTypes.includes(o.type)) return `This broker does not take ${o.type} orders through its API.`;
  if (!c.timeInForce.includes(o.timeInForce)) return `This broker does not take ${o.timeInForce.toUpperCase()} orders through its API.`;
  if (o.assetClass === "equity" && !c.fractional && Math.abs(o.qty - Math.round(o.qty)) > 1e-9) return "This broker trades whole shares only through its API.";
  if (o.extendedHours && !c.extendedHours) return "This broker does not take extended-hours orders through its API.";
  return null;
}
