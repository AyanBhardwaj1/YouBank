/**
 * Requests from the browser to YouBank's own API, made resilient. Used by fetchJson (lib/client/errors)
 * and the Newsroom's `api`; the connectivity banner (components/ui/Connectivity) watches every request.
 *
 * - A timeout: no request waits forever. The default is a safety net past the platform's own limit (a
 *   function cannot answer after 300 s), so a slow AI run is never cut off; callers can pass a shorter one.
 * - A GET (and only a GET) is tried once more after a network failure or a 502/503/504, and after a 429
 *   whose Retry-After is short. A POST, PUT, PATCH or DELETE is never repeated: it may already have done
 *   its work (an order, a send, a payment).
 * - The same write sent twice while the first is still in flight (a double click) is sent once; both
 *   callers get the answer.
 * - A 429's Retry-After (or Better Auth's X-Retry-After) stays on the response for the caller's message.
 *
 * Pure helpers are exported for scripts/test-prod.ts; the rest needs a browser (or a fetch to inject).
 */

export const CLIENT_TIMEOUT_MS = 305_000;
/** The longest Retry-After we wait for in the background before handing the 429 to the caller. */
const MAX_WAIT_MS = 5_000;

type Init = RequestInit & { timeoutMs?: number };
type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const methodOf = (init?: RequestInit) => (init?.method ?? "GET").toUpperCase();

/** Seconds or an HTTP date in Retry-After (or X-Retry-After) as milliseconds; null when absent. Pure. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const v = (headers.get("retry-after") ?? headers.get("x-retry-after"))?.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Whether a failed attempt of `method` may be made again, after `wait` ms (null: do not). Pure. */
export function retryPlan(method: string, outcome: { status?: number; network?: boolean; retryAfter?: number | null }, attempt: number): number | null {
  if (attempt > 0 || method !== "GET") return null;
  if (outcome.network) return 800 + Math.round(Math.random() * 400);
  if (outcome.status === 502 || outcome.status === 503 || outcome.status === 504) return outcome.retryAfter != null ? (outcome.retryAfter <= MAX_WAIT_MS ? outcome.retryAfter : null) : 1_000 + Math.round(Math.random() * 500);
  if (outcome.status === 429 && outcome.retryAfter != null && outcome.retryAfter <= MAX_WAIT_MS) return outcome.retryAfter;
  return null;
}

/** The sign-in page that brings the person back here. Pure. */
export function signInHref(path: string): string {
  const next = /^\/app(\/|$|\?)/.test(path) ? path : "/app";
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** Whether a same-origin request's 401 speaks for the session (workspace API, not sign-in's own, the add-ins' or health). Pure. */
export function watchesSession(path: string): boolean {
  return path.startsWith("/api/") && !/^\/api\/(auth|office|desktop|health)(\/|$)/.test(path);
}

const isAbort = (e: unknown) => ["AbortError", "TimeoutError"].includes((e as { name?: string } | null)?.name ?? "");
const offline = () => { try { return typeof navigator !== "undefined" && navigator.onLine === false; } catch { return false; } };

/** The caller's signal plus a timeout. */
function withTimeout(signal: AbortSignal | null | undefined, ms: number): { signal: AbortSignal; done: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(Object.assign(new Error("The request took too long."), { name: "TimeoutError" })), ms);
  const stop = () => ctrl.abort(signal?.reason);
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
  return { signal: ctrl.signal, done: () => { clearTimeout(t); signal?.removeEventListener("abort", stop); } };
}

/** Identical writes in flight, so a double click sends once. */
const inflight = new Map<string, Promise<Response>>();
const writeKey = (method: string, url: string, init?: RequestInit) => (typeof init?.body === "string" || init?.body === undefined || init?.body === null ? `${method} ${url} ${init?.body ?? ""}` : null);

export async function clientFetch(url: string, init: Init = {}, f: Fetch = (u, i) => fetch(u, i)): Promise<Response> {
  const { timeoutMs = CLIENT_TIMEOUT_MS, ...rest } = init;
  const method = methodOf(rest);
  if (method !== "GET" && method !== "HEAD") {
    const key = writeKey(method, url, rest);
    const same = key ? inflight.get(key) : undefined;
    if (same) return (await same).clone();
    const p = once(url, rest, timeoutMs, f);
    if (!key) return p;
    inflight.set(key, p);
    try { return (await p).clone(); } finally { inflight.delete(key); }
  }
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await once(url, rest, timeoutMs, f);
    } catch (e) {
      if (isAbort(e) || rest.signal?.aborted) throw e;
      // Offline: no point trying now; the banner says so and the caller's own retry comes later.
      const wait = offline() ? null : retryPlan(method, { network: true }, attempt);
      if (wait === null) throw e;
      await sleep(wait, rest.signal);
      continue;
    }
    if (res.ok) return res;
    const wait = retryPlan(method, { status: res.status, retryAfter: retryAfterMs(res.headers) }, attempt);
    if (wait === null) return res;
    try { await res.body?.cancel(); } catch { /* already read */ }
    await sleep(wait, rest.signal);
  }
}

async function once(url: string, init: RequestInit, timeoutMs: number, f: Fetch): Promise<Response> {
  const t = withTimeout(init.signal, timeoutMs);
  try {
    return await f(url, { ...init, signal: t.signal });
  } finally {
    t.done();
  }
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(signal.reason); }, { once: true });
  });
}
