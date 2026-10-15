/**
 * The HTTP call every broker adapter makes, with failures turned into messages people can read: the same
 * rules as copy trading's SnapTrade client (a broker's own short reason is passed on; anything else is
 * ours to log). The fetch is injectable, so scripts/test-algo.ts checks each adapter's requests against
 * fixtures without a network.
 */
import { brokerReason } from "@/lib/copytrade/snaptrade";
import { BrokerError } from "./types";
import { fetchRetry } from "@/lib/net";

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export const defaultFetch: Fetch = (url, init) => fetch(url, init);

export type Req = { method: "GET" | "POST" | "DELETE" | "PATCH"; url: string; headers?: Record<string, string>; body?: string; timeoutMs?: number };

/** Map a failed response to a BrokerError: 429 busy, 5xx no answer (transient), 401/403 reconnect, other 4xx the broker's refusal. */
export function failure(broker: string, httpStatus: number, body: unknown): BrokerError {
  const reason = brokerReason(body);
  if (httpStatus === 429) return new BrokerError(`${broker} is busy. Try again in a minute.`, 429, httpStatus, reason, false);
  if (httpStatus >= 500) return new BrokerError(`${broker} did not answer. Try again in a few minutes.`, 502, httpStatus, reason, true);
  if (httpStatus === 401 || httpStatus === 403) return new BrokerError(`Your ${broker} connection needs attention. Reconnect it and try again.`, 502, httpStatus, reason, false);
  return new BrokerError(reason ? `${broker} said: ${reason}` : `${broker} turned this request down.`, 400, httpStatus, reason, false);
}

/** Send a request; JSON in, JSON out. A timeout or network failure is a transient BrokerError (the order's outcome is unknown). */
export async function send<T>(broker: string, f: Fetch, r: Req): Promise<T> {
  let res: Response;
  try {
    // Only GETs are ever repeated (one retry on a network failure, 429 or 5xx). Orders (POST), cancels
    // (DELETE) and changes (PATCH) go out exactly once; their client order ids keep them idempotent upstream.
    res = await fetchRetry(r.url, { fetch: f, method: r.method, headers: { Accept: "application/json", ...(r.body !== undefined ? { "Content-Type": "application/json" } : {}), ...r.headers }, body: r.body, cache: "no-store", timeoutMs: r.timeoutMs ?? 30_000, idempotent: r.method === "GET" });
  } catch (e) {
    const name = (e as { name?: string } | null)?.name ?? "";
    throw new BrokerError(name === "TimeoutError" || name === "AbortError" ? `${broker} did not answer in time.` : `${broker} could not be reached.`, 504, 0, "", true);
  }
  const text = await res.text().catch(() => "");
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) throw failure(broker, res.status, data);
  return data as T;
}

export const num = (v: unknown): number | null => { const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN; return Number.isFinite(n) ? n : null; };
export const last4 = (s: unknown) => (typeof s === "string" && s ? `…${s.slice(-4)}` : "");
