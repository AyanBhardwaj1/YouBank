/**
 * Webull's OpenAPI (developer.webull.com), direct. Webull offers two official routes:
 * - the Trading API for individuals, trading their own account: the person applies in Webull's developer
 *   centre (reviewed in about one to two working days), registers an app, and generates an App Key and
 *   App Secret (shown once, after SMS and trading-password checks). They paste both here; we store them
 *   encrypted. This adapter implements that route;
 * - the Connect API for third-party platforms: OAuth 2.0 with PKCE, after registering the platform with
 *   Webull (an application form). That is the right route for YouBank at scale; it needs Webull's
 *   approval and is documented in docs/algo-trading.md as a next step. Webull also trades through
 *   SnapTrade ("read and trade" for Webull US), which works today with copy trading's connection.
 *
 * Signing (Webull's authentication guide): the query parameters and the headers x-app-key,
 * x-signature-algorithm, x-signature-nonce, x-signature-version, x-timestamp and host, sorted by name and
 * joined as name=value with "&"; the request path, "&", that string and, when there is a body, "&" and
 * the upper-case MD5 of the body; URL-encoded; HMAC-SHA1 keyed by the App Secret followed by "&"; base64.
 * The timestamp is ISO 8601 UTC without milliseconds. Webull's regional sites differ (some use
 * HMAC-SHA256 and a token step), so the host and paths below are settings: check them against
 * developer.webull.com for the account's region before turning the adapter on (ALGO_WEBULL_ENABLED=1).
 *
 * Rate limits (developer.webull.com, Trading API overview): place 600 a minute, preview 150 per 10 s,
 * cancel 600 a minute, order queries 2 every 2 s. client_order_id: unique per account, at most 32 characters.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { last4, num, send, type Fetch, defaultFetch } from "./http";
import type { BrokerAccount, BrokerAdapter, BrokerBalances, BrokerPosition, Capabilities, OrderAck, OrderInfo, OrderRequest, Preview } from "./types";

export const webullBase = () => (process.env.WEBULL_API_BASE?.trim() || "https://api.webull.com").replace(/\/$/, "");
export const webullEnabled = () => process.env.ALGO_WEBULL_ENABLED?.trim() === "1";

/** The paths, kept together so they can be checked against Webull's reference in one place. */
export const WEBULL_PATHS = {
  accounts: "/openapi/account/list",
  balance: "/openapi/assets/balance",
  positions: "/openapi/assets/positions",
  preview: "/openapi/trade/order/preview",
  place: "/openapi/trade/order/place",
  cancel: "/openapi/trade/order/cancel",
  detail: "/openapi/trade/order/detail",
} as const;

// Options off: an option order needs Webull's option fields (strike, expiry, right), which this adapter does
// not send yet, so options strategies are refused at the live gate rather than rejected by Webull.
const CAPS: Capabilities = {
  equities: true, fractional: true, options: false, crypto: false, orderTypes: ["market", "limit", "stop", "stop_limit"], timeInForce: ["day", "gtc"],
  extendedHours: true, preview: true, cancel: true, quotes: false, clientOrderId: "dedupe", clientOrderIdMax: 32, paper: false,
};

/** Python's quote(s, safe=""): encodeURIComponent plus the five characters it leaves alone. */
const quote = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** The string Webull signs, and the signature. Pure (nonce and timestamp passed in). */
export function webullSign(o: { appKey: string; appSecret: string; host: string; path: string; query: Record<string, string>; body: string; nonce: string; timestamp: string }): { stringToSign: string; signature: string; headers: Record<string, string> } {
  const headers: Record<string, string> = { "x-app-key": o.appKey, "x-signature-algorithm": "HMAC-SHA1", "x-signature-version": "1.0", "x-signature-nonce": o.nonce, "x-timestamp": o.timestamp };
  const params = { ...o.query, ...headers, host: o.host };
  const joined = Object.keys(params).sort().map((k) => `${k}=${params[k as keyof typeof params]}`).join("&");
  const stringToSign = `${o.path}&${joined}${o.body ? `&${createHash("md5").update(o.body, "utf8").digest("hex").toUpperCase()}` : ""}`;
  const signature = createHmac("sha1", `${o.appSecret}&`).update(quote(stringToSign), "utf8").digest("base64");
  return { stringToSign, signature, headers: { ...headers, "x-signature": signature } };
}

/** One stock or option order in Webull's new_orders shape. Pure. */
export function webullOrder(o: OrderRequest): Record<string, unknown> {
  return {
    client_order_id: o.clientOrderId.replace(/-/g, "").slice(0, 32),
    combo_type: "NORMAL",
    symbol: o.symbol.toUpperCase(),
    instrument_type: o.assetClass === "option" ? "OPTION" : "EQUITY",
    market: "US",
    side: o.side.toUpperCase(),
    order_type: o.type.toUpperCase(),
    ...(o.type === "limit" && o.limitPrice !== null ? { limit_price: String(o.limitPrice) } : {}),
    quantity: String(Math.round(o.qty * 1e5) / 1e5),
    time_in_force: o.timeInForce.toUpperCase(),
    entrust_type: "QTY",
    support_trading_session: o.extendedHours ? "ALL" : "CORE",
  };
}

type WAccount = { account_id: string; account_number?: string; account_type?: string; account_class?: string; user_id?: string };

export function webull(appKey: string, appSecret: string, f: Fetch = defaultFetch, clock: { now: () => Date; nonce: () => string } = { now: () => new Date(), nonce: () => randomUUID().replace(/-/g, "") }): BrokerAdapter {
  const base = webullBase();
  const host = new URL(base).host;
  const call = <T>(method: "GET" | "POST", path: string, query: Record<string, string> = {}, body?: unknown) => {
    const b = body === undefined ? "" : JSON.stringify(body);
    const s = webullSign({ appKey, appSecret, host, path, query, body: b, nonce: clock.nonce(), timestamp: clock.now().toISOString().replace(/\.\d{3}Z$/, "Z") });
    const qs = new URLSearchParams(query).toString();
    return send<T>("Webull", f, { method, url: `${base}${path}${qs ? `?${qs}` : ""}`, headers: s.headers, body: body === undefined ? undefined : b, timeoutMs: 30_000 });
  };
  const info = (o: Record<string, unknown>): OrderInfo => ({ brokerOrderId: String(o.order_id ?? o.client_order_id ?? ""), clientOrderId: typeof o.client_order_id === "string" ? o.client_order_id : null, status: String(o.status ?? o.order_status ?? ""), filledQty: num(o.filled_quantity ?? o.filled_qty) ?? 0, avgFillPrice: num(o.filled_price ?? o.avg_filled_price), raw: o });
  return {
    id: "webull",
    capabilities: () => CAPS,
    async accounts(): Promise<BrokerAccount[]> {
      const r = await call<WAccount[] | { data?: WAccount[] }>("GET", WEBULL_PATHS.accounts);
      const list = Array.isArray(r) ? r : r.data ?? [];
      return list.map((a) => ({ id: a.account_id, name: `Webull ${a.account_type ?? ""}`.trim(), number: last4(a.account_number ?? a.account_id), paper: false, currency: "USD", equity: null, cash: null, buyingPower: null, type: /margin/i.test(a.account_type ?? a.account_class ?? "") ? "margin" : /cash/i.test(a.account_type ?? "") ? "cash" : "unknown", tradingAllowed: true }));
    },
    async balances(accountId: string): Promise<BrokerBalances> {
      const r = await call<Record<string, unknown>>("GET", WEBULL_PATHS.balance, { account_id: accountId });
      const a = (Array.isArray(r.account_currency_assets) ? r.account_currency_assets[0] : r) as Record<string, unknown>;
      return { cash: num(a.cash_balance ?? r.total_cash_balance) ?? 0, buyingPower: num(a.buying_power ?? r.buying_power), equity: num(r.total_asset ?? r.net_liquidation_value), currency: "USD" };
    },
    async positions(accountId: string): Promise<BrokerPosition[]> {
      const r = await call<Record<string, unknown>[] | { holdings?: Record<string, unknown>[] }>("GET", WEBULL_PATHS.positions, { account_id: accountId });
      const list = Array.isArray(r) ? r : r.holdings ?? [];
      return list.map((p) => ({ symbol: String(p.symbol ?? ""), units: num(p.quantity ?? p.qty) ?? 0, price: num(p.last_price ?? p.market_price) ?? 0, marketValue: num(p.market_value) ?? 0, avgCost: num(p.cost_price ?? p.unit_cost) }));
    },
    async preview(o: OrderRequest): Promise<Preview> {
      const r = await call<Record<string, unknown>>("POST", WEBULL_PATHS.preview, {}, { account_id: o.accountId, new_orders: [webullOrder(o)] });
      return { tradeId: null, estimatedCommission: num(r.estimated_commission ?? r.commission), estimatedCost: num(r.estimated_cost ?? r.estimated_amount), raw: r };
    },
    async placeOrder(o: OrderRequest): Promise<OrderAck> {
      const r = await call<Record<string, unknown>>("POST", WEBULL_PATHS.place, {}, { account_id: o.accountId, new_orders: [webullOrder(o)] });
      // Webull's cancel and detail calls take our client order id, so that is the id we keep (its own order_id stays in raw).
      return { brokerOrderId: String(webullOrder(o).client_order_id), status: String(r.status ?? "submitted"), raw: r };
    },
    async cancel(accountId: string, brokerOrderId: string): Promise<void> {
      await call<unknown>("POST", WEBULL_PATHS.cancel, {}, { account_id: accountId, client_order_id: brokerOrderId });
    },
    async orderStatus(accountId, ref): Promise<OrderInfo | null> {
      const id = (ref.clientOrderId ?? ref.brokerOrderId ?? "").replace(/-/g, "").slice(0, 32);
      if (!id) return null;
      const r = await call<Record<string, unknown>>("GET", WEBULL_PATHS.detail, { account_id: accountId, client_order_id: id });
      return info(r);
    },
  };
}
