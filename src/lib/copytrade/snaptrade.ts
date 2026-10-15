/**
 * A small typed client for SnapTrade, the brokerage aggregator (Schwab, Fidelity, Robinhood, Webull,
 * Interactive Brokers, E*TRADE and about twenty more). Server only: it holds the consumer key.
 *
 * Written rather than installing snaptrade-typescript-sdk (axios, about 2 MB of generated code) for the
 * dozen calls the copy feature makes. The signing scheme was checked line by line against the SDK
 * (12.2.17, requestAfterHook.ts), and scripts/test-copytrade.ts checks our signatures against ones the
 * SDK's own code computed:
 * - every request carries `clientId` and a `timestamp` (Unix seconds) in the query, and user-scoped
 *   calls also `userId` and `userSecret`;
 * - the `Signature` header is base64(HMAC-SHA256(key = encodeURI(consumerKey), message)), where the
 *   message is JSON of { content, path, query } with every object's keys sorted: `content` is the JSON
 *   body (null without one), `path` the request path ("/accounts"), `query` the query string exactly as
 *   sent, without the "?".
 * Paths are SnapTrade's canonical root paths (the legacy /api/v1 prefix is deprecated).
 *
 * Pricing: SnapTrade bills per connected user per month (about $2 on pay-as-you-go with trading, at the
 * time of writing), so a connection exists only when a person on a plan with `copytrade.broker` asks
 * for one, and is deleted when they disconnect.
 */
import { createHmac } from "node:crypto";
import { fetchRetry } from "@/lib/net";

export const snaptradeBase = () => (process.env.SNAPTRADE_BASE_URL?.trim() || "https://api.snaptrade.com").replace(/\/$/, "");

/** Whether SnapTrade keys are set (without them, Connect reads "Not set up yet"). */
export function snaptradeReady(): boolean {
  return !!(process.env.SNAPTRADE_CLIENT_ID?.trim() && process.env.SNAPTRADE_CONSUMER_KEY?.trim());
}

/**
 * JSON with every key, at every depth, in sorted order. The same construction as the SDK's
 * JSONstringifyOrder: collect every key name seen anywhere, sort, and pass the list as JSON.stringify's
 * allow-list, which also orders keys by that list.
 */
export function canonicalJson(obj: unknown): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  JSON.stringify(obj, (k, v) => { if (!seen.has(k)) { seen.add(k); keys.push(k); } return v; });
  keys.sort();
  return JSON.stringify(obj, keys);
}

/** The Signature header for one request. Pure, for tests. */
export function signRequest(consumerKey: string, path: string, query: string, body: unknown): string {
  const message = canonicalJson({ content: body === undefined ? null : body, path, query });
  return createHmac("sha256", encodeURI(consumerKey)).update(message, "utf8").digest("base64");
}

export type SnapUser = { userId: string; userSecret: string };

/**
 * A failure SnapTrade or the broker reported, with SnapTrade's HTTP status and their own words when they
 * gave any. `status` is what the route answers (set by `call`); `httpStatus` is what SnapTrade said.
 */
export class SnapTradeError extends Error {
  constructor(message: string, readonly httpStatus: number, readonly detail: string, readonly code: string | null) {
    super(message);
    this.name = "SnapTradeError";
  }
}

/** The broker's or SnapTrade's own reason, when it is short and reads as meant for people. */
export function brokerReason(body: unknown): string {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = [b.detail, b.message, b.error, (b.raw_error as Record<string, unknown> | undefined)?.message].find((v): v is string => typeof v === "string" && v.trim().length > 0) ?? "";
  const t = raw.replace(/\s+/g, " ").trim();
  return t.length > 0 && t.length <= 240 && !/https?:\/\/|\{|\bat\s+\S+\(|Traceback|Exception:/i.test(t) ? t : "";
}

type CallOpts = { query?: [string, string | number | boolean | undefined][]; body?: unknown; user?: SnapUser; timeoutMs?: number; now?: () => number };

/** Build the query string as sent (and signed): clientId, then the user, then the call's own parameters, then the timestamp. */
export function buildQuery(clientId: string, user: SnapUser | undefined, extra: [string, string | number | boolean | undefined][], timestamp: number): string {
  const q = new URLSearchParams();
  q.set("clientId", clientId);
  if (user) { q.set("userId", user.userId); q.set("userSecret", user.userSecret); }
  for (const [k, v] of extra) if (v !== undefined) q.set(k, String(v));
  q.set("timestamp", String(timestamp));
  return q.toString();
}

async function call<T>(method: "GET" | "POST" | "DELETE", path: string, opts: CallOpts = {}): Promise<T> {
  const clientId = process.env.SNAPTRADE_CLIENT_ID?.trim(), key = process.env.SNAPTRADE_CONSUMER_KEY?.trim();
  if (!clientId || !key) throw Object.assign(new Error("Brokerage connections are not set up yet."), { status: 503 });
  const query = buildQuery(clientId, opts.user, opts.query ?? [], Math.round((opts.now?.() ?? Date.now()) / 1000));
  const hasBody = opts.body !== undefined;
  // Only GETs are ever repeated (one retry on a network failure, 429 or 5xx). An order (POST) or a cancel
  // (DELETE) goes out once: its outcome is unknown after a failure, and the caller decides what to do.
  const res = await fetchRetry(`${snaptradeBase()}${path}?${query}`, {
    method, cache: "no-store", timeoutMs: opts.timeoutMs ?? 30_000,
    headers: { Accept: "application/json", "User-Agent": "YouBank copy trading", Signature: signRequest(key, path, query, hasBody ? opts.body : null), ...(hasBody ? { "Content-Type": "application/json" } : {}) },
    body: hasBody ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const reason = brokerReason(data);
    const code = typeof (data as Record<string, unknown> | null)?.code === "string" || typeof (data as Record<string, unknown> | null)?.code === "number" ? String((data as Record<string, unknown>).code) : null;
    // 4xx from SnapTrade is usually the broker's own refusal (insufficient funds, a closed market, a
    // symbol not tradable here): worth showing. Anything else is ours to log.
    const status = res.status === 429 ? 429 : res.status >= 500 ? 502 : res.status === 401 || res.status === 403 ? 502 : 400;
    const message = res.status === 429 ? "The brokerage connection is busy. Try again in a minute."
      : res.status >= 500 ? "Your brokerage connection did not answer. Try again in a few minutes."
      : res.status === 401 || res.status === 403 ? "Your brokerage connection needs attention. Reconnect your broker and try again."
      : reason ? `Your broker said: ${reason}` : "Your broker turned this request down.";
    throw Object.assign(new SnapTradeError(message, res.status, reason, code), { status });
  }
  return data as T;
}

/* ---------------- Types (the fields we read) ---------------- */

export type SnapAccount = { id: string; brokerage_authorization: string; name: string | null; number: string; institution_name: string; is_paper?: boolean; cash_restrictions?: string[]; balance?: { total?: { amount?: number; currency?: string } | null }; status?: string };
export type SnapSymbol = { id: string; symbol: string; raw_symbol?: string; description?: string | null; currency?: { code?: string }; type?: { code?: string; description?: string }; exchange?: { code?: string; mic_code?: string } };
export type SnapPosition = { symbol?: { symbol?: SnapSymbol; id?: string; description?: string; is_tradable?: boolean }; units?: number | null; price?: number | null; fractional_units?: number | null; average_purchase_price?: number | null; cash_equivalent?: boolean | null };
export type SnapBalance = { currency?: { code?: string }; cash?: number | null; buying_power?: number | null };
export type SnapHoldings = { account?: SnapAccount; balances?: SnapBalance[] | null; positions?: SnapPosition[] | null };
export type SnapBrokerage = { slug?: string; name?: string; display_name?: string; allows_trading?: boolean | null; allows_fractional_units?: boolean | null; maintenance_mode?: boolean; is_degraded?: boolean };
export type SnapAuthorization = { id?: string; brokerage?: SnapBrokerage; name?: string; type?: string; disabled?: boolean };
export type SnapOrder = { brokerage_order_id?: string; status?: string; action?: string; total_quantity?: string | null; filled_quantity?: string | null; execution_price?: string | null; limit_price?: string | null; order_type?: string | null; time_in_force?: string; time_placed?: string; time_executed?: string | null; symbol?: string; universal_symbol?: SnapSymbol | null };
export type TradeForm = { account_id: string; action: "BUY" | "SELL"; universal_symbol_id: string; order_type: "Limit" | "Market"; time_in_force: "Day" | "GTC"; price?: number | null; units?: number | null };
export type TradeImpact = { trade?: { id?: string; units?: number | null; price?: number | null }; trade_impacts?: { remaining_cash?: number | null; estimated_commission?: number | null; forex_fees?: number | null; currency?: string }[] };

/* ---------------- Calls ---------------- */

export const snaptrade = {
  /** Create the SnapTrade user for one of ours; returns the secret, which we store encrypted. */
  registerUser: (userId: string) => call<{ userId?: string; userSecret?: string }>("POST", "/snapTrade/registerUser", { body: { userId } }),
  /** Delete the SnapTrade user and every connection (stops SnapTrade's monthly charge for them). */
  deleteUser: (userId: string) => call<unknown>("DELETE", "/snapTrade/deleteUser", { query: [["userId", userId]] }),
  /** A one-time link to SnapTrade's connection portal, which comes back to `redirect`. */
  loginUrl: (user: SnapUser, redirect: string, reconnect?: string) => call<{ redirectURI?: string }>("POST", "/snapTrade/login", { user, body: { customRedirect: redirect, connectionType: "trade-if-available", immediateRedirect: true, ...(reconnect ? { reconnect } : {}) } }),
  accounts: (user: SnapUser) => call<SnapAccount[]>("GET", "/accounts", { user }),
  holdings: (user: SnapUser, accountId: string) => call<SnapHoldings>("GET", `/accounts/${encodeURIComponent(accountId)}/holdings`, { user }),
  authorizations: (user: SnapUser) => call<SnapAuthorization[]>("GET", "/authorizations", { user }),
  symbolSearch: (user: SnapUser, accountId: string, substring: string) => call<SnapSymbol[]>("POST", `/accounts/${encodeURIComponent(accountId)}/symbols`, { user, body: { substring } }),
  /** Check an order: the broker's view of its cost and commission, and a trade id valid for five minutes. */
  orderImpact: (user: SnapUser, form: TradeForm) => call<TradeImpact>("POST", "/trade/impact", { user, body: form }),
  /** Place an order checked by orderImpact. */
  placeChecked: (user: SnapUser, tradeId: string) => call<SnapOrder>("POST", `/trade/${encodeURIComponent(tradeId)}`, { user, body: { wait_to_confirm: true }, timeoutMs: 45_000 }),
  /** Place an order without the impact check, with our id passed to brokers that de-duplicate on it. */
  placeForce: (user: SnapUser, form: TradeForm & { client_order_id: string }) => call<SnapOrder>("POST", "/trade/place", { user, body: form, timeoutMs: 45_000 }),
  orderDetail: (user: SnapUser, accountId: string, brokerageOrderId: string) => call<SnapOrder>("POST", `/accounts/${encodeURIComponent(accountId)}/orders/details`, { user, body: { brokerage_order_id: brokerageOrderId } }),
  recentOrders: (user: SnapUser, accountId: string, days = 3) => call<SnapOrder[]>("GET", `/accounts/${encodeURIComponent(accountId)}/orders`, { user, query: [["state", "all"], ["days", days]] }),
  /** Ask the broker to cancel an open order (algo trading's cancel; copy trading cancels at the broker). */
  cancelOrder: (user: SnapUser, accountId: string, brokerageOrderId: string) => call<unknown>("POST", `/accounts/${encodeURIComponent(accountId)}/orders/cancel`, { user, body: { brokerage_order_id: brokerageOrderId } }),
};

/** Positions and cash of one account, in the shape the rebalance takes. */
export function positionsOf(h: SnapHoldings): { cash: number; positions: { ticker: string; units: number; price: number }[]; total: number } {
  const usd = (h.balances ?? []).find((b) => (b.currency?.code ?? "USD") === "USD") ?? h.balances?.[0];
  const cash = Math.max(0, usd?.cash ?? 0);
  const positions = (h.positions ?? []).filter((p) => !p.cash_equivalent && p.symbol?.symbol?.symbol).map((p) => ({ ticker: String(p.symbol!.symbol!.symbol).toUpperCase().replace(/[./]/g, "-"), units: (p.units ?? 0) + (p.units ? 0 : p.fractional_units ?? 0), price: p.price ?? 0 }));
  return { cash, positions, total: cash + positions.reduce((s, p) => s + p.units * p.price, 0) };
}

/** Statuses after which an order will not change again. */
export const FINAL_STATUSES = new Set(["EXECUTED", "CANCELED", "PARTIAL_CANCELED", "REJECTED", "FAILED", "EXPIRED", "REPLACED"]);
