/**
 * Outbound HTTP from the server: one place for timeouts and retries. Server and scripts only (no
 * browser APIs beyond fetch; the browser has its own in lib/client/net).
 *
 * - `fetchWithTimeout`: fetch that gives up after `timeoutMs` (and still honours the caller's own
 *   abort signal). Nothing waits on an upstream for longer than the function it runs in may live.
 * - `fetchRetry`: the same, plus bounded retries for requests that are safe to repeat:
 *   - only GET/HEAD/OPTIONS, or a request the caller marks `idempotent` (a read-only POST such as a
 *     search, a JSON-RPC read, or a write carrying an idempotency key). Order placement, sends and
 *     anything else that changes state are never repeated;
 *   - only on a network failure or a retryable status (408, 425, 429, 500, 502, 503, 504);
 *   - exponential back-off with full jitter, and a server's Retry-After when it sends one (up to
 *     `maxRetryAfterMs`; a longer wait is the server saying "not now", so the response is returned);
 *   - never past `deadlineMs`, so a retry cannot push a request past its function's maxDuration;
 *   - a timed-out attempt is not retried unless `retryOnTimeout` is set: on a slow upstream the second
 *     try would usually time out too, doubling the wait.
 *
 * The response of the last attempt is returned as it is (a 503 stays a 503): callers keep their own
 * handling of statuses, so adopting this changes nothing but timeouts and retries.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type TimeoutInit = RequestInit & {
  /** Per attempt. Default 15 s. */
  timeoutMs?: number;
  /** The fetch to use (tests inject one; adapters pass theirs). */
  fetch?: FetchLike;
};

export type RetryInit = TimeoutInit & {
  /** Further attempts after the first. Default 1 (two attempts in all); capped at 4. */
  retries?: number;
  /** Mark a non-GET request as safe to repeat (read-only, or carrying an idempotency key). */
  idempotent?: boolean;
  /** First back-off, doubled per attempt, with full jitter. Default 300 ms. */
  baseDelayMs?: number;
  /** The longest back-off between attempts. Default 4 s. */
  maxDelayMs?: number;
  /** The longest Retry-After we wait for; longer answers are returned to the caller. Default 10 s. */
  maxRetryAfterMs?: number;
  /**
   * The whole budget in ms from the first attempt: a retry is made only when it can finish (back-off
   * plus a full attempt's timeout) inside it. Default: every attempt's timeout plus the back-offs.
   */
  deadlineMs?: number;
  /** Retry an attempt that timed out. Default false. */
  retryOnTimeout?: boolean;
  /** Override which statuses are retried (default: isRetryableStatus). */
  retryOn?: (status: number) => boolean;
  /** Called before each retry (logging, tests). */
  onRetry?: (info: { attempt: number; delayMs: number; status?: number; error?: unknown }) => void;
  /** Tests: a clock and a sleep. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
};

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether a method is safe to repeat by itself. Pure. */
export const isIdempotentMethod = (method: string | undefined) => IDEMPOTENT.has((method ?? "GET").toUpperCase());

/** Statuses worth one more try: timeouts, too-early, rate limits and the server-side failures that pass. Pure. */
export const isRetryableStatus = (status: number) => status === 408 || status === 425 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;

/** For upstreams whose 429 is a quota rather than a pause (FMP, SEC): only server failures are retried. Pure. */
export const retryServerErrors = (status: number) => status >= 500 && status !== 501 && isRetryableStatus(status);

/** Our own timeout, or the caller cancelling. Pure. */
export const isAbortLike = (e: unknown) => ["TimeoutError", "AbortError"].includes((e as { name?: string } | null)?.name ?? "");

const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_CLOSED"]);

/** A failure to reach the server at all (undici's "fetch failed" and the socket errors under it). Pure. */
export function isNetworkError(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 4; x = (x as { cause?: unknown }).cause, i++) {
    const code = (x as { code?: unknown }).code;
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    const name = (x as { name?: unknown }).name, message = x instanceof Error ? x.message : "";
    if (name === "TypeError" && /fetch failed|network|socket|terminated/i.test(message)) return true;
  }
  return false;
}

/**
 * A Retry-After header as milliseconds from `now`: delta-seconds or an HTTP date. Null when absent or
 * unreadable. Pure.
 */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  const v = value?.trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/** Full-jitter exponential back-off for retry number `attempt` (1-based). Pure given `random`. */
export function backoffDelay(attempt: number, baseMs = 300, maxMs = 4_000, random: () => number = Math.random): number {
  const cap = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(cap * random());
}

/**
 * The caller's signal and a timeout as one signal. AbortSignal.any is in Node 20.3+; the fallback
 * wires it by hand. The timeout aborts with a TimeoutError, as AbortSignal.timeout does.
 */
export function withTimeout(signal: AbortSignal | null | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  const any = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([signal, timeout]);
  const ctrl = new AbortController();
  const stop = (s: AbortSignal) => () => ctrl.abort(s.reason);
  if (signal.aborted) ctrl.abort(signal.reason);
  else {
    signal.addEventListener("abort", stop(signal), { once: true });
    timeout.addEventListener("abort", stop(timeout), { once: true });
  }
  return ctrl.signal;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** fetch with a per-request timeout; the caller's own `signal` still cancels it. */
export function fetchWithTimeout(url: string, init: TimeoutInit = {}): Promise<Response> {
  const { timeoutMs = 15_000, fetch: f = fetch, ...rest } = init;
  return f(url, { ...rest, signal: withTimeout(rest.signal, timeoutMs) });
}

/** Free a discarded response's connection. */
const drain = (res: Response) => { try { void res.body?.cancel().catch(() => undefined); } catch { /* already used */ } };

/** fetch with a timeout and bounded, polite retries for requests that are safe to repeat (see the module note). */
export async function fetchRetry(url: string, init: RetryInit = {}): Promise<Response> {
  const {
    retries: wanted = 1, idempotent, baseDelayMs = 300, maxDelayMs = 4_000, maxRetryAfterMs = 10_000, retryOnTimeout = false,
    retryOn = isRetryableStatus, onRetry, sleep = sleepReal, random = Math.random, deadlineMs, ...rest
  } = init;
  const timeoutMs = rest.timeoutMs ?? 15_000;
  const safe = idempotent ?? isIdempotentMethod(rest.method);
  // A body that can be read only once (a stream) cannot be sent twice.
  const replayable = rest.body === undefined || rest.body === null || typeof rest.body === "string" || rest.body instanceof URLSearchParams || rest.body instanceof ArrayBuffer || ArrayBuffer.isView(rest.body) || (typeof Blob !== "undefined" && rest.body instanceof Blob);
  const retries = safe && replayable ? Math.min(Math.max(0, Math.floor(wanted)), 4) : 0;
  const started = Date.now();
  const deadline = started + (deadlineMs ?? (timeoutMs + maxDelayMs) * (retries + 1));
  // A retry only when it can still finish in time.
  const fits = (delayMs: number) => Date.now() + delayMs + timeoutMs <= deadline;

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, rest);
    } catch (e) {
      // The caller cancelled: stop at once. Our own timeout: retried only when asked.
      if (rest.signal?.aborted) throw e;
      const timedOut = isAbortLike(e);
      const retryable = timedOut ? retryOnTimeout : isNetworkError(e);
      const delayMs = backoffDelay(attempt + 1, baseDelayMs, maxDelayMs, random);
      if (last || !retryable || !fits(delayMs)) throw e;
      onRetry?.({ attempt: attempt + 1, delayMs, error: e });
      await sleep(delayMs);
      continue;
    }
    if (last || !retryOn(res.status)) return res;
    const after = parseRetryAfter(res.headers.get("retry-after"));
    if (after !== null && after > maxRetryAfterMs) return res;
    const delayMs = after ?? backoffDelay(attempt + 1, baseDelayMs, maxDelayMs, random);
    if (!fits(delayMs)) return res;
    drain(res);
    onRetry?.({ attempt: attempt + 1, delayMs, status: res.status });
    await sleep(delayMs);
  }
}
