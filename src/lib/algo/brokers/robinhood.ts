/**
 * Robinhood's official Crypto Trading API: crypto only. Robinhood offers no public API for stocks or
 * options to third-party apps (its Agentic Trading, launched in 2026, connects a person's own AI agent to
 * Robinhood's MCP server and a dedicated agentic account; see docs/algo-trading.md). Unofficial
 * reverse-engineered stock APIs break Robinhood's terms and are not used here.
 *
 * The person creates API credentials in Robinhood's web app (crypto account settings), registering an
 * Ed25519 public key; they give YouBank the API key and the matching private key (a base64 32-byte seed),
 * stored encrypted. Every request is signed:
 *   message   = api_key + timestamp + path (with query) + METHOD + body (the JSON sent, or nothing)
 *   x-api-key, x-timestamp (Unix seconds), x-signature = base64(Ed25519(private key, message))
 * Requests are accepted for about 30 seconds after their timestamp. Base URL https://trading.robinhood.com.
 * Endpoints: GET /api/v1/crypto/trading/accounts/, /holdings/, /orders/, POST /orders/,
 * POST /orders/{id}/cancel/, GET /api/v1/crypto/marketdata/best_bid_ask/?symbol=BTC-USD.
 * Order types: market, limit, stop_loss, stop_limit; client_order_id is a UUID the API requires.
 */
import { createPrivateKey, sign as edSign } from "node:crypto";
import { num, send, type Fetch, defaultFetch } from "./http";
import type { BrokerAccount, BrokerAdapter, BrokerBalances, BrokerPosition, BrokerQuote, Capabilities, OrderAck, OrderInfo, OrderRequest } from "./types";

export const RH_BASE = "https://trading.robinhood.com";

const CAPS: Capabilities = {
  equities: false, fractional: true, options: false, crypto: true, orderTypes: ["market", "limit"], timeInForce: ["gtc"],
  extendedHours: false, preview: false, cancel: true, quotes: true, clientOrderId: "dedupe", clientOrderIdMax: 36, paper: false,
};

/** An Ed25519 private key from a base64 32-byte seed (PKCS#8 wrapping). */
export function ed25519Key(seedB64: string) {
  const seed = Buffer.from(seedB64.trim(), "base64");
  if (seed.length !== 32) throw Object.assign(new Error("The Robinhood private key should be the 32-byte base64 seed shown when you created the key."), { status: 400 });
  return createPrivateKey({ key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]), format: "der", type: "pkcs8" });
}

/** The signature headers for one request. Pure (given the timestamp). */
export function rhHeaders(apiKey: string, seedB64: string, method: string, pathWithQuery: string, body: string, timestamp: number): Record<string, string> {
  const message = `${apiKey}${timestamp}${pathWithQuery}${method.toUpperCase()}${body}`;
  const signature = edSign(null, Buffer.from(message, "utf8"), ed25519Key(seedB64)).toString("base64");
  return { "x-api-key": apiKey, "x-timestamp": String(timestamp), "x-signature": signature };
}

/** The order body Robinhood takes. Pure. */
export function rhOrderBody(o: OrderRequest): Record<string, unknown> {
  const qty = String(Math.round(o.qty * 1e8) / 1e8);
  return {
    client_order_id: o.clientOrderId,
    side: o.side,
    symbol: o.symbol.toUpperCase(),
    type: o.type,
    ...(o.type === "market" ? { market_order_config: { asset_quantity: qty } } : { limit_order_config: { asset_quantity: qty, limit_price: String(o.limitPrice), time_in_force: "gtc" } }),
  };
}

type RHOrder = { id: string; client_order_id?: string; state: string; filled_asset_quantity?: string | number; average_price?: string | number | null };

export function robinhoodCrypto(apiKey: string, seedB64: string, f: Fetch = defaultFetch, now: () => number = Date.now): BrokerAdapter {
  const call = <T>(method: "GET" | "POST", path: string, body?: unknown) => {
    const b = body === undefined ? "" : JSON.stringify(body);
    return send<T>("Robinhood", f, { method, url: `${RH_BASE}${path}`, headers: rhHeaders(apiKey, seedB64, method, path, b, Math.floor(now() / 1000)), body: body === undefined ? undefined : b, timeoutMs: 30_000 });
  };
  const info = (o: RHOrder): OrderInfo => ({ brokerOrderId: o.id, clientOrderId: o.client_order_id ?? null, status: o.state, filledQty: num(o.filled_asset_quantity) ?? 0, avgFillPrice: num(o.average_price), raw: o });
  return {
    id: "robinhood_crypto",
    capabilities: () => CAPS,
    async accounts(): Promise<BrokerAccount[]> {
      const a = await call<{ account_number: string; status: string; buying_power: string; buying_power_currency: string }>("GET", "/api/v1/crypto/trading/accounts/");
      return [{ id: a.account_number, name: "Robinhood Crypto", number: `…${String(a.account_number).slice(-4)}`, paper: false, currency: a.buying_power_currency || "USD", equity: null, cash: num(a.buying_power), buyingPower: num(a.buying_power), type: "cash", tradingAllowed: a.status === "active" }];
    },
    async positions(): Promise<BrokerPosition[]> {
      const r = await call<{ results: { asset_code: string; total_quantity: string | number }[] }>("GET", "/api/v1/crypto/trading/holdings/");
      return (r.results ?? []).map((h) => ({ symbol: `${h.asset_code}-USD`, units: num(h.total_quantity) ?? 0, price: 0, marketValue: 0, avgCost: null }));
    },
    async balances(): Promise<BrokerBalances> {
      const a = await call<{ buying_power: string; buying_power_currency: string }>("GET", "/api/v1/crypto/trading/accounts/");
      return { cash: num(a.buying_power) ?? 0, buyingPower: num(a.buying_power), equity: null, currency: a.buying_power_currency || "USD" };
    },
    async quotes(symbols: string[]): Promise<Record<string, BrokerQuote>> {
      const q = symbols.map((s) => `symbol=${encodeURIComponent(s.toUpperCase())}`).join("&");
      const r = await call<{ results: { symbol: string; bid_inclusive_of_sell_spread: string; ask_inclusive_of_buy_spread: string; price: string; timestamp: string }[] }>("GET", `/api/v1/crypto/marketdata/best_bid_ask/?${q}`);
      return Object.fromEntries((r.results ?? []).map((x) => [x.symbol, { symbol: x.symbol, bid: num(x.bid_inclusive_of_sell_spread), ask: num(x.ask_inclusive_of_buy_spread), last: num(x.price), at: x.timestamp ?? null }]));
    },
    async placeOrder(o: OrderRequest): Promise<OrderAck> {
      const r = await call<RHOrder>("POST", "/api/v1/crypto/trading/orders/", rhOrderBody(o));
      return { brokerOrderId: r.id, status: r.state, raw: r };
    },
    async cancel(_a: string, id: string): Promise<void> {
      await call<unknown>("POST", `/api/v1/crypto/trading/orders/${encodeURIComponent(id)}/cancel/`);
    },
    async orderStatus(_a, ref): Promise<OrderInfo | null> {
      if (ref.brokerOrderId) return info(await call<RHOrder>("GET", `/api/v1/crypto/trading/orders/${encodeURIComponent(ref.brokerOrderId)}/`));
      if (ref.clientOrderId) {
        const r = await call<{ results: RHOrder[] }>("GET", `/api/v1/crypto/trading/orders/?client_order_id=${encodeURIComponent(ref.clientOrderId)}`);
        const o = r.results?.[0];
        return o ? info(o) : null;
      }
      return null;
    },
  };
}
