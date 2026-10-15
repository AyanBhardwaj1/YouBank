/**
 * Checks for running in production: the outbound HTTP helper (timeouts, the retry policy, Retry-After,
 * never repeating a POST), the database's transient-error rules, the environment and feature checks,
 * the health verdict, sign-in origins, security headers and the browser's request helper. No network,
 * no database.
 *   pnpm exec tsx scripts/test-prod.ts
 */
import { isPlainRead, isTransientDbError, mayRetry, neverSent } from "@/db/transient";
import { checkAuthUrl, checkDatabaseUrl, checkEnv, checkJobs, featureStatus, FEATURES, moneySwitches } from "@/lib/env";
import { healthVerdict } from "@/lib/health";
import { expectedRelations, MIGRATIONS, summarize } from "@/lib/setup";
import { authBaseUrl, authTrustedOrigins } from "@/lib/auth/origins";
import { AUTH_RATE_RULES, secondsLeft } from "@/lib/auth/rate-limit";
import nextConfig, { contentSecurityPolicy, permissionsPolicy } from "../next.config";
import { clientFetch, retryAfterMs, retryPlan, signInHref, watchesSession } from "@/lib/client/net";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { StreamDropped, readSse } from "@/lib/client/sse";
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

function testDb() {
  console.log("database: transient failures");
  const pg = (code: string) => Object.assign(new Error(code), { code });
  check("a connect timeout never reached the server", neverSent(pg("CONNECT_TIMEOUT")));
  check("a waking compute (57P03) never ran the query", neverSent(pg("57P03")));
  check("a dropped connection is transient but may have run", isTransientDbError(pg("CONNECTION_CLOSED")) && !neverSent(pg("CONNECTION_CLOSED")));
  check("Neon scaling to zero (57P01) is transient", isTransientDbError(pg("57P01")));
  check("a constraint or syntax error is not", !isTransientDbError(pg("23505")) && !isTransientDbError(pg("42601")));
  check("a statement timeout is not retried", !isTransientDbError(pg("57014")));
  check("a code on the cause counts (Drizzle wraps the driver's error)", isTransientDbError(Object.assign(new Error("Failed query"), { cause: pg("ECONNRESET") })));
  check("a plain select is a read", isPlainRead('select "id", "updated_at" from "profiles" where "user_id" = $1'));
  check("a select with a comment first is a read", isPlainRead("-- hi\n select 1"));
  check("select … for update is not", !isPlainRead('select * from "kv_cache" for update'));
  check("a sequence or advisory lock is not", !isPlainRead("select nextval('x')") && !isPlainRead("select pg_advisory_lock(1)"));
  check("insert … returning is not", !isPlainRead('insert into "kv_cache" ("key") values ($1) returning "value"'));
  check("a CTE is not assumed safe", !isPlainRead("with x as (delete from t returning *) select * from x"));
  check("a write is retried only when it never left", mayRetry("insert into t values (1)", pg("ECONNREFUSED")) && !mayRetry("insert into t values (1)", pg("ECONNRESET")));
  check("a read is retried after a dropped connection", mayRetry("select 1", pg("ECONNRESET")));

  console.log("database: migrations");
  check("migrations 0015 to 0026 are all checked", ["0015", "0016", "0017", "0018", "0019", "0020", "0021", "0022", "0023", "0024", "0025", "0026"].every((n) => MIGRATIONS.some(([m]) => m.startsWith(n))));
  check("every migration file is listed", MIGRATIONS.length === 26, MIGRATIONS.length);
  check("no relation is checked twice", new Set(expectedRelations()).size === expectedRelations().length);
  const s1 = summarize(["algo_orders", "quant_events_issuer_idx"], ["crm_messages.topics"]);
  check("missing objects are grouped by migration", s1.migrations.map((m) => m.name).join() === "0010_contact_knowledge,0025_algo,0026_quant", s1);
  check("a complete schema has nothing missing", !summarize([]).core.length && !summarize([]).migrations.length);
  check("a missing core table is core", summarize(["profiles"]).core[0] === "profiles");
}

function testEnvAndHealth() {
  console.log("environment");
  const full = { DATABASE_URL: "postgres://u:p@ep-x-pooler.us-east-2.aws.neon.tech/db", BETTER_AUTH_SECRET: "x".repeat(40), OPENAI_API_KEY: "k" };
  check("the minimum runs", checkEnv(full, false).missing.length === 0);
  check("Neon's direct address is flagged for the app", checkDatabaseUrl({ DATABASE_URL: "postgres://u:p@ep-x.us-east-2.aws.neon.tech/db" }).length === 1);
  check("the pooled address is fine", checkDatabaseUrl(full).length === 0);
  check("a garbled DATABASE_URL is named, without its value", /not a postgres/.test(checkDatabaseUrl({ DATABASE_URL: "npg_secret" })[0] ?? "") && !(checkDatabaseUrl({ DATABASE_URL: "npg_secret" })[0] ?? "").includes("npg_secret"));
  check("BETTER_AUTH_URL on another domain than the site is flagged in production", checkAuthUrl({ VERCEL_ENV: "production", BETTER_AUTH_URL: "https://youbank-nu.vercel.app", NEXT_PUBLIC_SITE_URL: "https://youbank.com" }, true).length === 1);
  check("BETTER_AUTH_URL equal to the site is fine", checkAuthUrl({ VERCEL_ENV: "production", BETTER_AUTH_URL: "https://youbank.com/", NEXT_PUBLIC_SITE_URL: "https://youbank.com" }, true).length === 0);
  check("BETTER_AUTH_URL on a preview is not compared", checkAuthUrl({ VERCEL_ENV: "preview", BETTER_AUTH_URL: "https://youbank-nu.vercel.app", NEXT_PUBLIC_SITE_URL: "https://youbank.com" }, true).length === 0);
  check("plain http for sign-in is flagged in production", checkAuthUrl({ BETTER_AUTH_URL: "http://youbank.com" }, true).length === 1);
  check("INNGEST_DEV on a deployment is flagged", checkJobs({ VERCEL: "1", INNGEST_DEV: "1" }, true).length === 1 && checkJobs({ INNGEST_DEV: "1" }, false).length === 0);
  const fs = featureStatus({ OPENAI_API_KEY: "k", R2_ACCOUNT_ID: "a" });
  check("a feature with one of its options set is on", fs.find((f) => f.id === "ai")?.on === true);
  check("a half-set feature is off and names what is missing", fs.find((f) => f.id === "storage")?.on === false && (fs.find((f) => f.id === "storage")?.missing ?? []).includes("R2_BUCKET"));
  check("every feature says what people see while it is off", FEATURES.every((f) => f.off.length > 10));
  check("real-money switches default off", Object.values(moneySwitches({})).every((v) => v === false));
  check("only exactly 1 turns one on", moneySwitches({ COPYTRADE_TRADING_ENABLED: "true", ALGO_LIVE_ENABLED: "1" }).copyTrading === false && moneySwitches({ ALGO_LIVE_ENABLED: "1" }).algoLive === true);

  console.log("health verdict");
  const okDb = { ok: true, ms: 12, schema: { core: [], migrations: [] } };
  const env0 = { missing: [], invalid: [], fatal: [] };
  check("all good is ok (200)", healthVerdict({ db: okDb, env: env0, jobs: { on: true }, operator: false }).httpStatus === 200 && healthVerdict({ db: okDb, env: env0, jobs: { on: true }, operator: false }).status === "ok");
  check("no database is down (503)", healthVerdict({ db: { ok: false, ms: 0, reason: "not configured" }, env: env0, jobs: { on: true }, operator: false }).httpStatus === 503);
  check("a missing required setting is down", healthVerdict({ db: okDb, env: { missing: ["BETTER_AUTH_SECRET"], invalid: [], fatal: ["BETTER_AUTH_SECRET"] }, jobs: { on: true }, operator: false }).status === "down");
  check("missing core tables are down", healthVerdict({ db: { ...okDb, schema: { core: ["profiles"], migrations: [] } }, env: env0, jobs: { on: true }, operator: false }).status === "down");
  const mig = healthVerdict({ db: { ...okDb, schema: { core: [], migrations: [{ name: "0025_algo", missing: ["algo_orders"] }] } }, env: env0, jobs: { on: true }, operator: true });
  check("a missing migration is degraded (200)", mig.status === "degraded" && mig.httpStatus === 200);
  check("operators see which migration and how to fix it", JSON.stringify(mig.checks).includes("0025_algo") && JSON.stringify(mig.checks).includes("db-setup.mts finish"));
  const pub = healthVerdict({ db: { ...okDb, schema: { core: [], migrations: [{ name: "0025_algo", missing: ["algo_orders"] }] } }, env: { missing: ["CRON_SECRET"], invalid: [], fatal: [] }, jobs: { on: false }, operator: false });
  check("visitors see counts, not names", !JSON.stringify(pub).includes("algo") && !JSON.stringify(pub).includes("CRON_SECRET") && JSON.stringify(pub).includes("problems"));
  check("a missing optional setting is degraded, not down", pub.status === "degraded");
}

async function testAuthAndHeaders() {
  console.log("sign-in origins");
  const prod = { VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://youbank.com", VERCEL_PROJECT_PRODUCTION_URL: "youbank.com", VERCEL_URL: "youbank-abc123.vercel.app" };
  check("production signs in on the site's address", authBaseUrl(prod) === "https://youbank.com");
  check("BETTER_AUTH_URL wins in production", authBaseUrl({ ...prod, BETTER_AUTH_URL: "https://auth.youbank.com" }) === "https://auth.youbank.com");
  check("the vercel.app address keeps working after the custom domain", authTrustedOrigins(prod).includes("https://youbank-nu.vercel.app") && authTrustedOrigins(prod).includes("https://youbank.com"));
  const pv = { VERCEL_ENV: "preview", NEXT_PUBLIC_SITE_URL: "https://youbank.com", VERCEL_PROJECT_PRODUCTION_URL: "youbank.com", VERCEL_URL: "youbank-git-x-me.vercel.app", VERCEL_BRANCH_URL: "youbank-git-feature-me.vercel.app" };
  check("a preview signs in on its own address", authBaseUrl(pv) === "https://youbank-git-feature-me.vercel.app", authBaseUrl(pv));
  check("a production BETTER_AUTH_URL copied to previews is ignored there", authBaseUrl({ ...pv, BETTER_AUTH_URL: "https://youbank.com" }) === "https://youbank-git-feature-me.vercel.app");
  check("a preview's own fixed BETTER_AUTH_URL is kept", authBaseUrl({ ...pv, BETTER_AUTH_URL: "https://staging.youbank.com" }) === "https://staging.youbank.com");
  check("both preview addresses may post to sign-in", authTrustedOrigins(pv).includes("https://youbank-git-x-me.vercel.app") && authTrustedOrigins(pv).includes("https://youbank-git-feature-me.vercel.app"));
  check("extra origins can be added", authTrustedOrigins({ ...prod, AUTH_TRUSTED_ORIGINS: "app.youbank.com, https://www.youbank.com" }).includes("https://www.youbank.com"));
  check("no stray origins are trusted in production", !authTrustedOrigins({ ...prod, NODE_ENV: "production" }).some((o) => o.includes("localhost")));
  check("sign-in limits: session reads are not counted, password sign-in has a long window", AUTH_RATE_RULES["/get-session"] === false && (AUTH_RATE_RULES["/sign-in/email"] as { window: number }).window >= 60);
  check("a refused sign-in says when to try again", secondsLeft(60, 30_500) === 30 && secondsLeft(60, 59_999) === 1);

  console.log("security headers");
  const csp = contentSecurityPolicy({ https: true });
  const has = (d: string) => csp.split("; ").some((x) => x === d || x.startsWith(`${d} `));
  check("framing is refused", csp.includes("frame-ancestors 'none'"));
  check("plugins and <base> hijacks are refused", has("object-src 'none'") && has("base-uri 'self'"));
  check("scripts load only from YouBank", /script-src 'self'/.test(csp) && !/script-src[^;]*https:/.test(csp));
  check("no eval in production", !csp.includes("'unsafe-eval'") && contentSecurityPolicy({ dev: true }).includes("'unsafe-eval'"));
  check("map and PDF workers may start from blobs", has("worker-src 'self' blob:"));
  check("WebAssembly may compile", csp.includes("'wasm-unsafe-eval'"));
  check("map tiles, logos and stored files load over https", has("img-src 'self' data: blob: https:") && /connect-src 'self' https:/.test(csp));
  check("http subresources are upgraded on deployments only", csp.includes("upgrade-insecure-requests") && !contentSecurityPolicy({}).includes("upgrade-insecure-requests"));
  check("previews allow Vercel's toolbar", contentSecurityPolicy({ preview: true }).includes("https://vercel.live") && !csp.includes("vercel.live"));
  check("the microphone only where asked", permissionsPolicy(true).includes("microphone=(self)") && permissionsPolicy(false).includes("microphone=()"));
  const rules = await nextConfig.headers!();
  const forPath = (p: string, key: string) => {
    let v: string | undefined;
    for (const r of rules) if (new RegExp(`^${r.source.replace("/:path*", "(/.*)?").replace(/^\/\(\(\?!/, "/((?!")}$`).test(p)) for (const h of r.headers) if (h.key === key) v = h.value;
    return v;
  };
  check("every page gets HSTS", !!forPath("/pricing", "Strict-Transport-Security"));
  check("marketing pages block the microphone", forPath("/pricing", "Permissions-Policy")?.includes("microphone=()") === true);
  check("every workspace page allows it (client navigation keeps the first page's policy)", forPath("/app/terminal", "Permissions-Policy")?.includes("microphone=(self)") === true && forPath("/app/edge", "Permissions-Policy")?.includes("microphone=(self)") === true);
  check("pages get the CSP", !!forPath("/app/news", "Content-Security-Policy"));
  check("the Office add-in pages are not framed-blocked", forPath("/office/taskpane", "X-Frame-Options") === undefined && forPath("/office/taskpane", "Content-Security-Policy") === undefined);
}

async function testClient() {
  console.log("browser requests");
  check("a GET is retried once after a network failure", retryPlan("GET", { network: true }, 0) !== null && retryPlan("GET", { network: true }, 1) === null);
  check("a POST is never retried", retryPlan("POST", { network: true }, 0) === null && retryPlan("POST", { status: 503 }, 0) === null);
  check("a 503 GET is retried once", retryPlan("GET", { status: 503 }, 0) !== null);
  check("a 429 with a short Retry-After is waited out", retryPlan("GET", { status: 429, retryAfter: 2000 }, 0) === 2000);
  check("a 429 with a long one is handed to the caller", retryPlan("GET", { status: 429, retryAfter: 60_000 }, 0) === null && retryPlan("GET", { status: 429 }, 0) === null);
  check("a 401, 402 or 404 is not retried", [401, 402, 404].every((s) => retryPlan("GET", { status: s }, 0) === null));
  check("Better Auth's X-Retry-After is read", retryAfterMs(new Headers({ "x-retry-after": "7" })) === 7000);
  check("sign-in brings the person back to the page", signInHref("/app/news?x=1") === "/sign-in?next=%2Fapp%2Fnews%3Fx%3D1");
  check("sign-in never sends anyone off the app", signInHref("https://evil.example/") === "/sign-in?next=%2Fapp");
  check("sign-in's own 401 (a wrong password) is not a lost session", !watchesSession("/api/auth/sign-in/email") && watchesSession("/api/news/feed"));

  const scripted = (steps: (number | Error)[]) => {
    let n = 0;
    const f = async () => {
      const s = steps[Math.min(n++, steps.length - 1)];
      if (s instanceof Error) throw s;
      return new Response(JSON.stringify({ ok: s < 400, error: s >= 400 ? "Nope." : undefined }), { status: s, headers: { "content-type": "application/json" } });
    };
    return { f, calls: () => n };
  };
  {
    const u = scripted([new TypeError("Failed to fetch"), 200]);
    const r = await clientFetch("/api/x", {}, u.f);
    check("clientFetch: a dropped GET gets through on the second try", r.status === 200 && u.calls() === 2);
  }
  {
    const u = scripted([new TypeError("Failed to fetch"), 200]);
    const e = await clientFetch("/api/order", { method: "POST", body: "{}" }, u.f).then(() => null, (x: unknown) => x);
    check("clientFetch: a dropped POST is not resent", !!e && u.calls() === 1);
  }
  {
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = async () => { n++; await gate; return new Response("{\"ok\":true}", { status: 200 }); };
    const a = clientFetch("/api/send", { method: "POST", body: "{\"id\":1}" }, f);
    const b = clientFetch("/api/send", { method: "POST", body: "{\"id\":1}" }, f);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    check("clientFetch: a double click sends once and both get the answer", n === 1 && (await ra.json()).ok && (await rb.json()).ok);
  }
  {
    const u = scripted([200]);
    await clientFetch("/api/send", { method: "POST", body: "{\"id\":2}" }, u.f);
    await clientFetch("/api/send", { method: "POST", body: "{\"id\":2}" }, u.f);
    check("clientFetch: the same write sent again later goes out again", u.calls() === 2);
  }
  {
    const f = (_u: string, i?: RequestInit) => new Promise<Response>((_, reject) => i?.signal?.addEventListener("abort", () => reject(i.signal!.reason), { once: true }));
    const e = await clientFetch("/api/slow", { timeoutMs: 30 }, f).then(() => null, (x: unknown) => x);
    check("clientFetch: a request that never answers times out", (e as { name?: string })?.name === "TimeoutError" && /too long|longer|slow/i.test(errorMessage(e)), errorMessage(e));
  }
  {
    const realFetch = globalThis.fetch;
    let n = 0;
    globalThis.fetch = (async () => { n++; return new Response(JSON.stringify({ error: "This needs Pro." }), { status: 402 }); }) as typeof fetch;
    const e = await fetchJson("/api/premium").then(() => null, (x: unknown) => x);
    globalThis.fetch = realFetch;
    check("fetchJson: a 402 keeps its friendly message and is not retried", errorMessage(e) === "This needs Pro." && n === 1);
  }
  {
    const enc = new TextEncoder();
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({ pull(c) { if (pulled++ === 0) c.enqueue(enc.encode("data: {\"type\":\"text\",\"text\":\"hi\"}\n\n")); else c.error(new TypeError("network error")); } });
    const seen: string[] = [];
    const e = await readSse(new Response(body), (ev) => seen.push(ev.type)).then(() => null, (x: unknown) => x);
    check("a stream that drops mid-answer keeps what arrived and says it dropped", seen[0] === "text" && e instanceof StreamDropped && /dropped/.test(errorMessage(e)), errorMessage(e));
  }
}

async function main() {
  // AbortSignal.timeout's timer does not keep Node alive; a server always has something else that does.
  const alive = setInterval(() => undefined, 1_000);
  await testNet();
  clearInterval(alive);
  testDb();
  testEnvAndHealth();
  await testAuthAndHeaders();
  const alive2 = setInterval(() => undefined, 1_000);
  await testClient();
  clearInterval(alive2);
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
