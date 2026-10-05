/**
 * Fetching free crypto APIs politely. Server only.
 *
 * CoinGecko's keyless API allows a handful of calls a minute and DefiLlama asks for restraint, so
 * every answer goes through the shared layered cache (`cacheJson`: memory, disk in development, Neon
 * kv in production), which also shares one upstream call among concurrent requests and remembers a
 * failure for half a minute. Failures become a plain sentence naming the source, never its URL or
 * status line; the detail is logged with a reference.
 */
import { cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";

export const MIN = 60_000;
export const HOUR = 60 * MIN;

/** An upstream source that did not answer usefully. The message is written for people. */
export class CryptoDataError extends Error {
  readonly status: number;
  constructor(message: string, status = 503) {
    super(message);
    this.name = "CryptoDataError";
    this.status = status;
  }
}

const UA = "YouBank research terminal (crypto data; contact via site)";

type Opts = { key: string; ttlMs: number; source: string; headers?: Record<string, string>; timeoutMs?: number; init?: RequestInit };

/** Fetch JSON once per `ttlMs` (per cache key), transformed by `shape` before it is cached so large payloads stay small. */
export async function cachedJson<T, R = T>(url: string, opts: Opts, shape?: (raw: T) => R): Promise<R> {
  return cacheJson<R>(opts.key, opts.ttlMs, async () => {
    const raw = await fetchJson<T>(url, opts);
    return shape ? shape(raw) : (raw as unknown as R);
  });
}

/** One uncached JSON request with a timeout. Throws a CryptoDataError naming `source` on any failure. */
export async function fetchJson<T>(url: string, opts: Pick<Opts, "source" | "headers" | "timeoutMs" | "init">): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...opts.init, headers: { Accept: "application/json", "User-Agent": UA, ...opts.headers, ...(opts.init?.headers as Record<string, string> | undefined) }, cache: "no-store", signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000) });
  } catch (e) {
    logError(e, { where: `crypto:${opts.source}` });
    throw new CryptoDataError(`${opts.source} is not answering right now. Try again in a minute.`);
  }
  if (res.status === 429) throw new CryptoDataError(`${opts.source} is limiting requests right now (its free tier allows only a few a minute). Try again shortly.`, 503);
  if (res.status === 401 || res.status === 403) throw new CryptoDataError(`${opts.source} refused the request: this data needs a key or plan the workspace does not have.`, 503);
  if (res.status === 404) throw new CryptoDataError(`${opts.source} has no data for that.`, 404);
  if (!res.ok) {
    logError(new Error(`${opts.source} answered ${res.status}`), { where: `crypto:${opts.source}` });
    throw new CryptoDataError(`${opts.source} did not answer properly. Try again in a minute.`);
  }
  try {
    return (await res.json()) as T;
  } catch (e) {
    logError(e, { where: `crypto:${opts.source}` });
    throw new CryptoDataError(`${opts.source} sent something we could not read. Try again in a minute.`);
  }
}

/** POST a JSON-RPC body (nodes and indexers). */
export async function postJson<T>(url: string, body: unknown, opts: Pick<Opts, "source" | "headers" | "timeoutMs">): Promise<T> {
  return fetchJson<T>(url, { ...opts, init: { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } } });
}

/** A finite number or null, from anything an API might send (strings, nulls, NaN). */
export const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
export const str = (v: unknown): string => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : String(v));
export const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
/** A link from an upstream API, kept only when it is http(s): it ends up in an href, so never javascript: or data:. */
export const webUrl = (v: unknown): string => { const s = str(v); return /^https?:\/\/[^\s]+$/i.test(s) ? s : ""; };
