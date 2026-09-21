import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cacheGet, cacheSet } from "@/lib/cache";

/**
 * SEC EDGAR fetch with a descriptive User-Agent (required by SEC), a 8 req/s rate limit,
 * and a JSON disk cache under .cache/edgar. Cache entries carry a TTL.
 */
const UA = process.env.EDGAR_USER_AGENT ?? "YouBank dev (set-your-email@example.com)";
const CACHE_DIR = path.join(process.cwd(), ".cache", "edgar");
const MIN_GAP_MS = 125; // 8 requests per second, under SEC's 10/s limit
const DISK_OK = !process.env.VERCEL;
const mem = new Map<string, { fetchedAt: number; data: unknown }>();

let lastRequest = 0;
let chain: Promise<unknown> = Promise.resolve();

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
  const res = await throttle(() => fetch(url, { headers: { "User-Agent": UA, "Accept-Encoding": "gzip, deflate" }, cache: "no-store" }));
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  const data = (await res.json()) as T;
  await writeCache(cacheKey, data);
  return data;
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Fetch a text/HTML document from sec.gov with the same throttle and User-Agent; cached on disk as text. */
export async function edgarText(url: string, cacheKey: string, ttlMs: number): Promise<string> {
  const cached = await cacheGet(`edgar:${cacheKey}`);
  if (cached) return cached;
  const res = await throttle(() => fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" }));
  if (!res.ok) throw new Error(`EDGAR ${res.status} for ${url}`);
  const text = await res.text();
  await cacheSet(`edgar:${cacheKey}`, text, ttlMs);
  return text;
}
