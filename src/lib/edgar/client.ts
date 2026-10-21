import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheEntry, cacheGet, cacheSet } from "@/lib/cache";
import { withinRate } from "@/lib/locks";
import { budget, SEC_STALE_IF_ERROR_MS } from "@/lib/market/budgets";
import { noteFreshness } from "@/lib/market/provenance";
import { callSource } from "@/lib/market/source";
import { fetchRetry, retryServerErrors, type RetryInit } from "@/lib/net";
import { shared, sharedMap } from "@/lib/shared";

/**
 * SEC EDGAR fetch with a descriptive User-Agent (required by SEC), a rate limit, and a JSON disk cache
 * under .cache/edgar. Cache entries carry a TTL. SEC's fair-access limit (10 requests a second) counts
 * every request from our servers together, so besides pacing each instance, requests take a slot in a
 * shared per-second budget; and when SEC answers 429 or 403, every instance backs off for a minute
 * rather than getting our addresses blocked. A request that finds no slot in the shared budget within a
 * few seconds fails as busy instead of going over. Concurrent requests for the same document share one
 * fetch (per process), so a filing everyone opens at once costs SEC one request per instance.
 *
 * Pacing spaces request *starts* 125 ms apart and lets requests run at once: a slow document no longer
 * holds up the ones behind it. JSON documents are cached in memory (and on disk in development) with
 * stale-while-revalidate and a week of stale-if-error (cache.ts); each request is timed and counted for
 * the "sec" breaker (market/source.ts). Timeouts follow the interactive or background budget.
 */
/** The User-Agent SEC requires (a company and a contact address); the placeholder is for development only. */
export const UA = process.env.EDGAR_USER_AGENT ?? "YouBank dev (set-your-email@example.com)";
const CACHE_DIR = path.join(process.cwd(), ".cache", "edgar");
const MIN_GAP_MS = 125; // 8 requests per second, under SEC's 10/s limit
const DISK_OK = !process.env.VERCEL && !process.env.YOUBANK_NO_DISK_CACHE;
const mem = sharedMap<string, { fetchedAt: number; data: unknown }>("edgar:mem");
/** Requests in flight by cache key, so concurrent asks for one document share its fetch. */
const inflight = sharedMap<string, Promise<unknown>>("edgar:inflight");
/** The per-process pacing (one schedule for every copy of this module, src/lib/shared). */
const pace = shared("edgar:pace", () => ({ lastRequest: 0 }));

/** Share one load per key among concurrent callers in this process. */
function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const p = load().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const SEC_BUSY = "SEC EDGAR is busy right now. Try again in a minute.";

const SHARED_PER_SECOND = 8;
const BACKOFF_KEY = "edgar:backoff";
let backoffUntil = 0, backoffCheckedAt = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Whether any instance was told to slow down in the last minute (checked against the shared flag every few seconds). */
async function inBackoff(): Promise<boolean> {
  if (Date.now() < backoffUntil) return true;
  if (Date.now() - backoffCheckedAt < 5_000) return false;
  backoffCheckedAt = Date.now();
  backoffUntil = Number(await cacheGet(BACKOFF_KEY).catch(() => null)) || 0;
  return Date.now() < backoffUntil;
}

/** One request to sec.gov: within the shared budget, never during a back-off, and starting one on 429 or 403. */
async function secRequest(url: string, init: RetryInit, op: string): Promise<Response> {
  if (await inBackoff()) throw Object.assign(new Error("SEC EDGAR asked us to slow down. Try again in a minute."), { status: 503 });
  let slot = false;
  for (let i = 0; i < 12 && !(slot = await withinRate("edgar", SHARED_PER_SECOND, 1_000)); i++) await sleep(250 + Math.random() * 250);
  // Every instance's budget was spent for three seconds running: wait for a quieter moment rather than
  // go over SEC's limit (which blocks our addresses for ten minutes).
  if (!slot) throw Object.assign(new Error(SEC_BUSY), { status: 503 });
  // One retry on a network failure or a 5xx. Never on 429 or 403: those start the shared back-off below.
  // A 5xx, 429 or 403 counts as a failure for the breaker and the stats; the response still goes back.
  let res: Response;
  try {
    res = await callSource("sec", op, async () => {
      const r = await fetchRetry(url, { ...init, retryOn: retryServerErrors });
      if (r.status >= 500 || r.status === 429 || r.status === 403) throw Object.assign(new Error(`EDGAR ${r.status}`), { status: r.status, response: r });
      return r;
    }, { label: "SEC EDGAR" });
  } catch (e) {
    const r = (e as { response?: Response }).response;
    if (!r) throw e;
    res = r;
  }
  if (res.status === 429 || res.status === 403) {
    backoffUntil = Date.now() + 60_000;
    await cacheSet(BACKOFF_KEY, String(backoffUntil), 60_000).catch(() => undefined);
  }
  return res;
}

/** Start `fn` in this process's next free 125 ms slot. Only the starts are paced: requests run at once. */
function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const start = Math.max(now, pace.lastRequest + MIN_GAP_MS);
  pace.lastRequest = start;
  return start > now ? sleep(start - now).then(fn) : fn();
}

/** The kind of SEC request, for the stats: "companyfacts", "submissions", "frames", "efts", "archives". */
const opOf = (url: string) => /api\/xbrl\/(\w+)/.exec(url)?.[1] ?? (/efts\./.test(url) ? "efts" : /submissions/.test(url) ? "submissions" : /Archives/.test(url) ? "archives" : "other");

async function readCache<T>(key: string, ttlMs: number): Promise<T | null> {
  const m = mem.get(key);
  if (m && Date.now() - m.fetchedAt < ttlMs) return m.data as T;
  return null;
}

function remember(key: string, data: unknown, fetchedAt: number) {
  mem.set(key, { fetchedAt, data });
  if (mem.size > 40) mem.delete(mem.keys().next().value!); // bound memory on long-lived instances
}

/** The old disk layer's entries (development), read once as a starting point. */
async function readDisk<T>(key: string, ttlMs: number): Promise<T | null> {
  if (!DISK_OK) return null;
  try {
    const { fetchedAt, data } = JSON.parse(await readFile(path.join(CACHE_DIR, key), "utf8")) as { fetchedAt: number; data: T };
    return Date.now() - fetchedAt < ttlMs ? data : null;
  } catch {
    return null;
  }
}

async function writeDisk(key: string, data: unknown) {
  if (!DISK_OK) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, key), JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch { /* read-only filesystem */ }
}

export type EdgarJsonOptions = {
  /** Keep it in the shared Postgres cache too (small, widely read documents). Default: this instance only. */
  shared?: boolean;
};

/**
 * A JSON document from sec.gov, cached: parsed in memory (the last 40) for its lifetime; past it, served
 * at once while one refresh runs, and for a week when SEC fails (flagged stale). Large documents stay out
 * of Postgres unless `shared` (company_tickers.json, about 1 MB, was a large share of its transfer).
 */
export async function edgarJson<T>(url: string, cacheKey: string, ttlMs: number, opts: EdgarJsonOptions = {}): Promise<T> {
  const cached = await readCache<T>(cacheKey, ttlMs);
  if (cached) return cached;
  const disk = await readDisk<T>(cacheKey, ttlMs);
  if (disk) { remember(cacheKey, disk, Date.now()); return disk; }
  const e = await cacheEntry<T>(`edgar:json:${cacheKey}`, ttlMs, () => once(`json:${cacheKey}`, async () => {
    const res = await throttle(() => secRequest(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store", timeoutMs: budget().secTimeoutMs }, opOf(url)));
    if (!res.ok) throw Object.assign(new Error(`EDGAR ${res.status} for ${url}`), { status: res.status });
    const data = (await res.json()) as T;
    await writeDisk(cacheKey, data);
    return data;
  }), { local: !opts.shared, shared: !!opts.shared, staleMs: ttlMs, staleIfErrorMs: SEC_STALE_IF_ERROR_MS });
  if (e.stale) noteFreshness({ stale: true, fetchedAt: new Date(e.fetchedAt).toISOString() });
  else remember(cacheKey, e.value, e.fetchedAt);
  return e.value;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** A throttled request to sec.gov with the User-Agent SEC requires, uncached: for live feeds polled often. */
export function edgarFetch(url: string, timeoutMs = 25_000): Promise<Response> {
  return throttle(() => secRequest(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store", timeoutMs }, opOf(url)));
}

/** Fetch a text/HTML document from sec.gov with the same throttle and User-Agent; cached on disk as text. */
export async function edgarText(url: string, cacheKey: string, ttlMs: number): Promise<string> {
  const cached = await cacheGet(`edgar:${cacheKey}`);
  if (cached) return cached;
  return once(`text:${cacheKey}`, async () => {
    const res = await throttle(() => secRequest(url, { headers: { "User-Agent": UA }, cache: "no-store", timeoutMs: budget().secTimeoutMs }, opOf(url)));
    if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
    const text = await res.text();
    await cacheSet(`edgar:${cacheKey}`, text, ttlMs);
    return text;
  });
}
