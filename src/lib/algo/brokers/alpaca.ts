/**
 * Alpaca's Trading API (v2), paper and live. Two ways in:
 * - OAuth (Alpaca Connect): the person approves YouBank on Alpaca's page and we hold a bearer token
 *   (encrypted). Alpaca must approve the app before it may trade other people's live accounts; paper
 *   accounts work as soon as the app is registered.
 * - API keys: a person pastes the key id and secret from their own Alpaca dashboard (paper keys are the
 *   intended use; live keys are refused unless ALGO_ALPACA_LIVE_KEYS=1).
 * Endpoints: GET /v2/account, GET /v2/positions, POST /v2/orders, GET /v2/orders/{id},
 * GET /v2/orders:by_client_order_id, DELETE /v2/orders/{id}; quotes from the market data API
 * (/v2/stocks/quotes/latest, /v1beta3/crypto/us/latest/quotes). Rate limit: 200 requests a minute per key.
 * client_order_id: Alpaca rejects a second order with an id already used on the account.
 */
import { last4, num, send, type Fetch, defaultFetch } from "./http";
import type { BrokerAccount, BrokerAdapter, BrokerBalances, BrokerPosition, BrokerQuote, Capabilities, OrderAck, OrderInfo, OrderRequest } from "./types";

export type AlpacaAuth = { kind: "keys"; keyId: string; secret: string } | { kind: "oauth"; token: string };
export type AlpacaEnv = "paper" | "live";

export const ALPACA_BASE: Record<AlpacaEnv, string> = { paper: "https://paper-api.alpaca.markets", live: "https://api.alpaca.markets" };
export const ALPACA_DATA = "https://data.alpaca.markets";
export const ALPACA_OAUTH = { authorize: "https://app.alpaca.markets/oauth/authorize", token: "https://api.alpaca.markets/oauth/token" };

const CAPS: Capabilities = {
  equities: true, fractional: true, options: true, crypto: true, orderTypes: ["market", "limit", "stop", "stop_limit"], timeInForce: ["day", "gtc", "ioc"],
  extendedHours: true, preview: false, cancel: true, quotes: true, clientOrderId: "dedupe", clientOrderIdMax: 128, paper: true,
};

/** The body Alpaca's POST /v2/orders takes for one of our orders. Pure, for the fixtures. */
export function alpacaOrderBody(o: OrderRequest): Record<string, unknown> {
  const crypto = o.assetClass === "crypto";
  return {
    symbol: crypto ? o.symbol.replace("-", "/") : o.symbol,
    qty: String(Math.round(o.qty * 1e9) / 1e9),
    side: o.side,
    type: o.type,
    // Crypto takes GTC or IOC only; fractional equity orders must be DAY.
    time_in_force: crypto ? (o.timeInForce === "day" ? "gtc" : o.timeInForce) : o.timeInForce,
    ...(o.type === "limit" && o.limitPrice !== null ? { limit_price: String(o.limitPrice) } : {}),
    ...(o.extendedHours && o.type === "limit" && o.timeInForce === "day" && !crypto ? { extended_hours: true } : {}),
    ...(o.assetClass === "option" && o.positionIntent ? { position_intent: o.positionIntent } : {}),
    client_order_id: o.clientOrderId,
  };
}

type AAccount = { id: string; account_number: string; status: string; currency: string; cash: string; equity: string; buying_power: string; multiplier: string; pattern_day_trader: boolean; daytrade_count: number; trading_blocked: boolean; account_blocked: boolean };
type APosition = { symbol: string; qty: string; current_price: string; market_value: string; avg_entry_price: string; asset_class: string };
type AOrder = { id: string; client_order_id: string; status: string; filled_qty: string; filled_avg_price: string | null };

export function alpaca(env: AlpacaEnv, auth: AlpacaAuth, f: Fetch = defaultFetch): BrokerAdapter {
  const base = ALPACA_BASE[env];
  const headers: Record<string, string> = auth.kind === "keys" ? { "APCA-API-KEY-ID": auth.keyId, "APCA-API-SECRET-KEY": auth.secret } : { Authorization: `Bearer ${auth.token}` };
  const get = <T>(url: string) => send<T>("Alpaca", f, { method: "GET", url, headers });
  const info = (o: AOrder): OrderInfo => ({ brokerOrderId: o.id, clientOrderId: o.client_order_id ?? null, status: o.status, filledQty: num(o.filled_qty) ?? 0, avgFillPrice: num(o.filled_avg_price), raw: o });
  return {
    id: "alpaca",
    capabilities: () => ({ ...CAPS, paper: env === "paper" }),
    async accounts(): Promise<BrokerAccount[]> {
      const a = await get<AAccount>(`${base}/v2/account`);
      return [{
        id: a.id, name: env === "paper" ? "Alpaca paper" : "Alpaca", number: last4(a.account_number), paper: env === "paper", currency: a.currency || "USD",
        equity: num(a.equity), cash: num(a.cash), buyingPower: num(a.buying_power), type: Number(a.multiplier) > 1 ? "margin" : "cash",
        tradingAllowed: a.status === "ACTIVE" && !a.trading_blocked && !a.account_blocked, dayTradeCount: a.daytrade_count ?? null, patternDayTrader: a.pattern_day_trader ?? null,
      }];
    },
    async positions(): Promise<BrokerPosition[]> {
      const ps = await get<APosition[]>(`${base}/v2/positions`);
      return ps.map((p) => ({ symbol: p.asset_class === "crypto" ? p.symbol.replace(/USD$/, "-USD").replace("/", "-") : p.symbol, units: num(p.qty) ?? 0, price: num(p.current_price) ?? 0, marketValue: num(p.market_value) ?? 0, avgCost: num(p.avg_entry_price) }));
    },
    async balances(): Promise<BrokerBalances> {
      const a = await get<AAccount>(`${base}/v2/account`);
      return { cash: num(a.cash) ?? 0, buyingPower: num(a.buying_power), equity: num(a.equity), currency: a.currency || "USD" };
    },
    async quotes(symbols: string[]): Promise<Record<string, BrokerQuote>> {
      const out: Record<string, BrokerQuote> = {};
      const eq = symbols.filter((s) => !/-USD$/.test(s)), cr = symbols.filter((s) => /-USD$/.test(s));
      if (eq.length) {
        const r = await get<{ quotes: Record<string, { bp: number; ap: number; t: string }> }>(`${ALPACA_DATA}/v2/stocks/quotes/latest?symbols=${encodeURIComponent(eq.join(","))}`);
        for (const [s, q] of Object.entries(r.quotes ?? {})) out[s] = { symbol: s, bid: q.bp || null, ask: q.ap || null, last: q.bp && q.ap ? (q.bp + q.ap) / 2 : null, at: q.t ?? null };
      }
      if (cr.length) {
        const r = await get<{ quotes: Record<string, { bp: number; ap: number; t: string }> }>(`${ALPACA_DATA}/v1beta3/crypto/us/latest/quotes?symbols=${encodeURIComponent(cr.map((s) => s.replace("-", "/")).join(","))}`);
        for (const [s, q] of Object.entries(r.quotes ?? {})) { const k = s.replace("/", "-"); out[k] = { symbol: k, bid: q.bp || null, ask: q.ap || null, last: q.bp && q.ap ? (q.bp + q.ap) / 2 : null, at: q.t ?? null }; }
      }
      return out;
    },
    async placeOrder(o: OrderRequest): Promise<OrderAck> {
      const r = await send<AOrder>("Alpaca", f, { method: "POST", url: `${base}/v2/orders`, headers, body: JSON.stringify(alpacaOrderBody(o)), timeoutMs: 45_000 });
      return { brokerOrderId: r.id, status: r.status, raw: r };
    },
    async cancel(_accountId: string, brokerOrderId: string): Promise<void> {
      await send<unknown>("Alpaca", f, { method: "DELETE", url: `${base}/v2/orders/${encodeURIComponent(brokerOrderId)}`, headers });
    },
    async orderStatus(_accountId, ref): Promise<OrderInfo | null> {
      if (ref.brokerOrderId) return info(await get<AOrder>(`${base}/v2/orders/${encodeURIComponent(ref.brokerOrderId)}`));
      if (ref.clientOrderId) return info(await get<AOrder>(`${base}/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(ref.clientOrderId)}`));
      return null;
    },
  };
}

/** The URL that starts Alpaca's OAuth consent for this app. Pure. */
export function alpacaAuthorizeUrl(clientId: string, redirectUri: string, state: string, env: AlpacaEnv): string {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, state, scope: "account:write trading data", env });
  return `${ALPACA_OAUTH.authorize}?${q.toString()}`;
}

/** Exchange an authorization code for an access token (form-encoded, as Alpaca's token endpoint takes it). */
export async function alpacaExchange(code: string, redirectUri: string, f: Fetch = defaultFetch): Promise<string> {
  const id = process.env.ALPACA_OAUTH_CLIENT_ID?.trim(), secret = process.env.ALPACA_OAUTH_CLIENT_SECRET?.trim();
  if (!id || !secret) throw Object.assign(new Error("Alpaca sign-in is not set up yet."), { status: 503 });
  const res = await f(ALPACA_OAUTH.token, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: id, client_secret: secret, redirect_uri: redirectUri }).toString(), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  const j = (await res.json().catch(() => ({}))) as { access_token?: string };
  if (!res.ok || !j.access_token) throw Object.assign(new Error("Alpaca did not complete the connection. Try again."), { status: 502 });
  return j.access_token;
}
