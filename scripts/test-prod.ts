/**
 * Checks for running in production: the outbound HTTP helper (timeouts, the retry policy, Retry-After,
 * never repeating a POST), the database's transient-error rules, the environment and feature checks,
 * the health verdict, sign-in origins, security headers and the browser's request helper. No network,
 * no database.
 *   pnpm exec tsx scripts/test-prod.ts
 */
import { backoffDelay, fetchRetry, fetchWithTimeout, isIdempotentMethod, isNetworkError, isRetryableStatus, parseRetryAfter, retryServerErrors, withTimeout } from "@/lib/net";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

/** A scripted upstream: each call takes the next step (a status, optionally with headers, or a thrown error). */
type Step = number | { status: number; headers?: Record<string, string> } | Error | "hang";
function upstream(steps: Step[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step === "hang") {
      return new Promise((_, reject) => {
        const s = init.signal;
        if (s?.aborted) return reject(s.reason);
        s?.addEventListener("abort", () => reject(s.reason), { once: true });
      });
    }
    if (step instanceof Error) throw step;
    const { status, headers } = typeof step === "number" ? { status: step, headers: {} } : step;
    return new Response(status === 204 ? null : JSON.stringify({ status }), { status, headers });
  };
  return { f, calls };
}
const netError = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
const noSleep = { sleep: async () => undefined, random: () => 0.5 };

async function testNet() {
  console.log("network helper: policy");
  check("GET, HEAD and OPTIONS are idempotent", ["GET", "head", "OPTIONS", undefined].every((m) => isIdempotentMethod(m)));
  check("POST, PUT, PATCH and DELETE are not repeated by default", ["POST", "PUT", "PATCH", "DELETE"].every((m) => !isIdempotentMethod(m)));
  check("429 and 5xx are retryable", [408, 425, 429, 500, 502, 503, 504].every(isRetryableStatus));
  check("4xx refusals and 501 are not", [400, 401, 403, 404, 409, 422, 501].every((s) => !isRetryableStatus(s)));
  check("quota upstreams retry server errors only", retryServerErrors(503) && !retryServerErrors(429) && !retryServerErrors(501));
  check("undici's fetch failed is a network error", isNetworkError(netError()));
  check("a timeout is not a network error", !isNetworkError(Object.assign(new Error("t"), { name: "TimeoutError" })));
  check("Retry-After in seconds", parseRetryAfter("3") === 3000);
  check("Retry-After as an HTTP date", parseRetryAfter(new Date(10_000 + 5_000).toUTCString(), 10_000) === 5000, parseRetryAfter(new Date(15_000).toUTCString(), 10_000));
  check("Retry-After in the past is zero", parseRetryAfter(new Date(0).toUTCString(), 10_000) === 0);
  check("a missing or garbled Retry-After is null", parseRetryAfter(null) === null && parseRetryAfter("soon") === null);
  check("back-off doubles and is capped", backoffDelay(1, 300, 4000, () => 1) === 300 && backoffDelay(3, 300, 4000, () => 1) === 1200 && backoffDelay(10, 300, 4000, () => 1) === 4000);
  check("back-off has full jitter", backoffDelay(3, 300, 4000, () => 0) === 0 && backoffDelay(3, 300, 4000, () => 0.5) === 600);

  console.log("network helper: timeouts");
  {
    const u = upstream(["hang"]);
    const t0 = Date.now();
    const e = await fetchWithTimeout("https://x.test/a", { fetch: u.f, timeoutMs: 50 }).then(() => null, (x: unknown) => x as Error);
    check("a hung upstream times out", e?.name === "TimeoutError", e?.name);
    check("…promptly", Date.now() - t0 < 1_000, Date.now() - t0);
  }
  {
    const ctrl = new AbortController();
    const s = withTimeout(ctrl.signal, 60_000);
    ctrl.abort();
    check("the caller's own cancel still works under a timeout", s.aborted);
  }
  {
    const u = upstream(["hang", 200]);
    const e = await fetchRetry("https://x.test/a", { fetch: u.f, timeoutMs: 30, ...noSleep }).then(() => null, (x: unknown) => x as Error);
    check("a timed-out GET is not retried by default", e?.name === "TimeoutError" && u.calls.length === 1, u.calls.length);
  }
  {
    const u = upstream(["hang", 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, timeoutMs: 30, retryOnTimeout: true, ...noSleep });
    check("…unless asked", r.status === 200 && u.calls.length === 2, u.calls.length);
  }

  console.log("network helper: retries");
  {
    const u = upstream([503, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep });
    check("a GET that got 503 is retried once and succeeds", r.status === 200 && u.calls.length === 2);
  }
  {
    const u = upstream([503, 503, 503]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep });
    check("retries are bounded (one by default) and the last answer is returned as is", r.status === 503 && u.calls.length === 2, u.calls.length);
  }
  {
    const u = upstream([502, 502, 502, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, retries: 3, ...noSleep });
    check("more retries when asked", r.status === 200 && u.calls.length === 4);
  }
  {
    const u = upstream([netError(), 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep });
    check("a network failure on a GET is retried", r.status === 200 && u.calls.length === 2);
  }
  {
    const u = upstream([404, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep });
    check("a 404 is not retried", r.status === 404 && u.calls.length === 1);
  }
  {
    const u = upstream([new Error("bad certificate"), 200]);
    const e = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep }).then(() => null, (x: unknown) => x as Error);
    check("an error that is not a network failure is thrown at once", e?.message === "bad certificate" && u.calls.length === 1);
  }
  {
    const u = upstream([503, 200]);
    const r = await fetchRetry("https://x.test/order", { fetch: u.f, method: "POST", body: "{}", ...noSleep });
    check("a POST is never repeated (an order goes out once)", r.status === 503 && u.calls.length === 1);
  }
  {
    const u = upstream([netError(), 200]);
    const e = await fetchRetry("https://x.test/order", { fetch: u.f, method: "POST", body: "{}", ...noSleep }).then(() => null, (x: unknown) => x as Error);
    check("…not even after a network failure", !!e && u.calls.length === 1);
  }
  {
    const u = upstream([503, 200]);
    await fetchRetry("https://x.test/o/1", { fetch: u.f, method: "DELETE", ...noSleep });
    check("a DELETE (an order cancel) is not repeated", u.calls.length === 1);
  }
  {
    const u = upstream([503, 200]);
    const r = await fetchRetry("https://x.test/search", { fetch: u.f, method: "POST", body: "{}", idempotent: true, ...noSleep });
    check("a read-only POST marked idempotent is retried", r.status === 200 && u.calls.length === 2);
  }
  {
    const u = upstream([503, 200]);
    const body = new ReadableStream({ start(c) { c.close(); } });
    await fetchRetry("https://x.test/up", { fetch: u.f, method: "PUT", body, idempotent: true, ...noSleep });
    check("a streamed body is never sent twice", u.calls.length === 1);
  }
  {
    const u = upstream([429, 200]);
    const r = await fetchRetry("https://x.test/q", { fetch: u.f, retryOn: retryServerErrors, ...noSleep });
    check("a quota upstream's 429 is returned, not retried", r.status === 429 && u.calls.length === 1);
  }
  {
    const waits: number[] = [];
    const u = upstream([{ status: 429, headers: { "retry-after": "2" } }, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, sleep: async (ms) => { waits.push(ms); }, random: () => 0.5 });
    check("Retry-After is honoured", r.status === 200 && waits[0] === 2000, waits);
  }
  {
    const u = upstream([{ status: 503, headers: { "retry-after": "120" } }, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, ...noSleep });
    check("a Retry-After longer than we may wait is returned to the caller", r.status === 503 && u.calls.length === 1);
  }
  {
    const waits: number[] = [];
    const u = upstream([500, 200]);
    await fetchRetry("https://x.test/a", { fetch: u.f, sleep: async (ms) => { waits.push(ms); }, random: () => 0.5, baseDelayMs: 400 });
    check("without Retry-After, a jittered back-off", waits[0] === 200, waits);
  }
  {
    const u = upstream([503, 200]);
    const r = await fetchRetry("https://x.test/a", { fetch: u.f, timeoutMs: 10_000, deadlineMs: 5_000, ...noSleep });
    check("no retry that could not finish within the deadline", r.status === 503 && u.calls.length === 1);
  }
  {
    const ctrl = new AbortController();
    const u = upstream([netError(), 200]);
    ctrl.abort();
    const e = await fetchRetry("https://x.test/a", { fetch: async (url, init) => { if (init.signal?.aborted) throw init.signal.reason; return u.f(url, init); }, signal: ctrl.signal, ...noSleep }).then(() => null, (x: unknown) => x as Error);
    check("a request the caller cancelled is not retried", !!e && u.calls.length === 0);
  }
  {
    const seen: string[] = [];
    const u = upstream([503, 200]);
    await fetchRetry("https://x.test/a", { fetch: u.f, headers: { "X-Key": "k" }, ...noSleep, onRetry: ({ status }) => seen.push(String(status)) });
    check("each attempt carries the same request", u.calls.every((c) => new Headers(c.init.headers).get("x-key") === "k") && seen[0] === "503");
  }
}

async function main() {
  // AbortSignal.timeout's timer does not keep Node alive; a server always has something else that does.
  const alive = setInterval(() => undefined, 1_000);
  await testNet();
  clearInterval(alive);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
