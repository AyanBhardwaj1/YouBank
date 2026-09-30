import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheGet, cacheSet } from "@/lib/cache";
import { withinRate } from "@/lib/locks";

/**
 * SEC EDGAR fetch with a descriptive User-Agent (required by SEC), a rate limit, and a JSON disk cache
 * under .cache/edgar. Cache entries carry a TTL. SEC's fair-access limit (10 requests a second) counts
 * every request from our servers together, so besides pacing each instance, requests take a slot in a
 * shared per-second budget; and when SEC answers 429 or 403, every instance backs off for a minute
 * rather than getting our addresses blocked.
 */
const UA = process.env.EDGAR_USER_AGENT ?? "YouBank dev (set-your-email@example.com)";
const CACHE_DIR = path.join(process.cwd(), ".cache", "edgar");
const MIN_GAP_MS = 125; // 8 requests per second, under SEC's 10/s limit
const DISK_OK = !process.env.VERCEL;
const mem = new Map<string, { fetchedAt: number; data: unknown }>();

let lastRequest = 0;
let chain: Promise<unknown> = Promise.resolve();

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
async function secRequest(url: string, init: RequestInit): Promise<Response> {
  if (await inBackoff()) throw Object.assign(new Error("SEC EDGAR asked us to slow down. Try again in a minute."), { status: 503 });
  for (let i = 0; i < 12 && !(await withinRate("edgar", SHARED_PER_SECOND, 1_000)); i++) await sleep(250 + Math.random() * 250);
  const res = await fetch(url, init);
  if (res.status === 429 || res.status === 403) {
    backoffUntil = Date.now() + 60_000;
    await cacheSet(BACKOFF_KEY, String(backoffUntil), 60_000).catch(() => undefined);
  }
  return res;
}

function throttle<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const wait = Math.max(0, lastRequest + MIN_GAP_MS - Date.now());
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequest = Date.now();
    return fn();
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
}

async function readCache<T>(key: string, ttlMs: number): Promise<T | null> {
  const m = mem.get(key);
  if (m && Date.now() - m.fetchedAt < ttlMs) return m.data as T;
  if (!DISK_OK) return null;
  try {
    const raw = await readFile(path.join(CACHE_DIR, key), "utf8");
    const { fetchedAt, data } = JSON.parse(raw) as { fetchedAt: number; data: T };
    return Date.now() - fetchedAt < ttlMs ? data : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: unknown) {
  mem.set(key, { fetchedAt: Date.now(), data });
  if (mem.size > 40) mem.delete(mem.keys().next().value!); // bound memory on long-lived instances
  if (!DISK_OK) return;
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, key), JSON.stringify({ fetchedAt: Date.now(), data }));
  } catch { /* read-only filesystem */ }
}

export async function edgarJson<T>(url: string, cacheKey: string, ttlMs: number): Promise<T> {
  const cached = await readCache<T>(cacheKey, ttlMs);
  if (cached) return cached;
  const res = await throttle(() => secRequest(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store", signal: AbortSignal.timeout(25_000) }));
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  const data = (await res.json()) as T;
  await writeCache(cacheKey, data);
  return data;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** A throttled request to sec.gov with the User-Agent SEC requires, uncached: for live feeds polled often. */
export function edgarFetch(url: string, timeoutMs = 25_000): Promise<Response> {
  return throttle(() => secRequest(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store", signal: AbortSignal.timeout(timeoutMs) }));
}

/** Fetch a text/HTML document from sec.gov with the same throttle and User-Agent; cached on disk as text. */
export async function edgarText(url: string, cacheKey: string, ttlMs: number): Promise<string> {
  const cached = await cacheGet(`edgar:${cacheKey}`);
  if (cached) return cached;
  const res = await throttle(() => secRequest(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(25_000) }));
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  const text = await res.text();
  await cacheSet(`edgar:${cacheKey}`, text, ttlMs);
  return text;
}
