import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db, schema } from "@/db";
import { lease, type Release } from "./locks";
import { shared, sharedMap } from "./shared";

/**
 * Layered string cache: memory (per process) -> disk (local dev) -> Neon kv_cache (serverless).
 * Values are strings (JSON or text). Disk is skipped on Vercel where the filesystem is read-only.
 * The memory layer is bounded (by entries and by size); cacheJson shares one load among concurrent
 * misses (so a popular ticker at the open costs one upstream call per instance, not one per request) and
 * remembers a failure for half a minute (so an upstream outage is not hammered by every request).
 *
 * cacheEntry (and cacheJson on top of it) can also keep serving a value past its fresh lifetime:
 * - stale-while-revalidate (`staleMs`): for that long after it stops being fresh, the last value answers
 *   at once, flagged stale, while one refresh runs in the background (under the shared fill lease);
 * - stale-if-error (`staleIfErrorMs`): up to that long after it stops being fresh, a refresh is tried
 *   first and the last value answers, flagged stale, only when the refresh fails.
 * Nothing is served past `staleUntil` (fresh lifetime + the longer window): the row expires then.
 */
const mem = sharedMap<string, { exp: number; value: string }>("cache:mem");
const MEM_MAX = 5_000;
/** The memory layer's size budget in characters: large values (companyfacts, 5-year bars) count by size, not as one entry each. */
const MEM_MAX_CHARS = 96 * 1024 * 1024;
const memSize = shared("cache:mem:size", () => ({ chars: 0 }));
const loading = sharedMap<string, Promise<unknown>>("cache:loading");
const failed = sharedMap<string, { until: number; error: unknown }>("cache:failed");
const FAILURE_MS = 30_000;

function forget(key: string) {
  const old = mem.get(key);
  if (old) { memSize.chars -= old.value.length; mem.delete(key); }
}

/** Keep the memory layer bounded: drop expired entries, then the oldest (a Map keeps insertion order) until it fits. */
function remember(key: string, entry: { exp: number; value: string }) {
  forget(key);
  if (mem.size >= MEM_MAX || memSize.chars + entry.value.length > MEM_MAX_CHARS) {
    const now = Date.now();
    for (const [k, v] of mem) if (v.exp <= now) forget(k);
    let n = mem.size >= MEM_MAX ? MEM_MAX / 10 : 0;
    for (const k of mem.keys()) {
      if (n <= 0 && memSize.chars + entry.value.length <= MEM_MAX_CHARS) break;
      forget(k); n--;
    }
  }
  if (entry.value.length > MEM_MAX_CHARS) return;
  mem.set(key, entry);
  memSize.chars += entry.value.length;
}
const DISK_OK = !process.env.VERCEL && !process.env.YOUBANK_NO_DISK_CACHE;
const DISK_DIR = path.join(process.cwd(), ".cache", "kv");
const MAX_DB_BYTES = 3_000_000;

const safe = (key: string) => key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);

/**
 * The first live value among `keys` (in order) with its expiry: memory, then disk, then one kv_cache
 * query for all of them. Expiry is checked in the query, so an expired value (up to MAX_DB_BYTES) is
 * never transferred.
 */
async function readRaw(keys: string[], local = false): Promise<{ key: string; value: string; exp: number } | null> {
  const now = Date.now();
  for (const key of keys) { const m = mem.get(key); if (m && m.exp > now) return { key, value: m.value, exp: m.exp }; }
  if (DISK_OK) {
    for (const key of keys) {
      try {
        const raw = JSON.parse(await readFile(path.join(DISK_DIR, safe(key)), "utf8")) as { exp: number; value: string };
        if (raw.exp > Date.now()) { remember(key, raw); return { key, value: raw.value, exp: raw.exp }; }
      } catch { /* miss */ }
    }
  }
  if (db && !local) {
    try {
      const rows = await db.select({ key: schema.kvCache.key, value: schema.kvCache.value, expiresAt: schema.kvCache.expiresAt }).from(schema.kvCache)
        .where(and(inArray(schema.kvCache.key, keys), gt(schema.kvCache.expiresAt, new Date())));
      for (const key of keys) {
        const row = rows.find((r) => r.key === key);
        if (row) { remember(key, { exp: row.expiresAt.getTime(), value: row.value }); return { key, value: row.value, exp: row.expiresAt.getTime() }; }
      }
    } catch { /* db unavailable */ }
  }
  return null;
}

export async function cacheGet(key: string): Promise<string | null> {
  return (await readRaw([key]))?.value ?? null;
}

/** When a key expires (epoch ms), or null when it is missing or expired. Reads the expiry only, never the value. */
export async function cacheExpiry(key: string): Promise<number | null> {
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.exp;
  if (DISK_OK) {
    try {
      const raw = JSON.parse(await readFile(path.join(DISK_DIR, safe(key)), "utf8")) as { exp: number };
      if (raw.exp > Date.now()) return raw.exp;
    } catch { /* miss */ }
  }
  if (db) {
    try {
      const [row] = await db.select({ expiresAt: schema.kvCache.expiresAt }).from(schema.kvCache)
        .where(and(eq(schema.kvCache.key, key), gt(schema.kvCache.expiresAt, new Date())));
      if (row) return row.expiresAt.getTime();
    } catch { /* db unavailable */ }
  }
  return null;
}

export async function cacheSet(key: string, value: string, ttlMs: number, local = false, now = Date.now()): Promise<void> {
  // `now` lets a caller stamp the expiry from the same clock reading as its own timestamps (cacheEntry's
  // staleUntil is this row's expiry, so it must equal fetchedAt + ttl + window exactly).
  const exp = now + ttlMs;
  remember(key, { exp, value });
  if (DISK_OK) {
    try { await mkdir(DISK_DIR, { recursive: true }); await writeFile(path.join(DISK_DIR, safe(key)), JSON.stringify({ exp, value })); } catch { /* ignore */ }
  }
  if (db && !local && value.length <= MAX_DB_BYTES) {
    try {
      await db.insert(schema.kvCache).values({ key, value, expiresAt: new Date(exp) }).onConflictDoUpdate({ target: schema.kvCache.key, set: { value, expiresAt: new Date(exp) } });
      // Opportunistic cleanup of expired rows, a batch at a time (indexed on expires_at).
      if (Math.random() < 0.02) await db.execute(sql`delete from ${schema.kvCache} where ${schema.kvCache.key} in (select ${schema.kvCache.key} from ${schema.kvCache} where ${schema.kvCache.expiresAt} < now() limit 500)`);
    } catch { /* ignore */ }
  }
}

export type CacheJsonOptions = {
  /**
   * Share the refill across instances, for public data from a provider with a quota (market data, SEC):
   * on a miss the first instance takes a short lease and loads; the others wait up to `waitMs` for its
   * answer to land in the shared cache before loading themselves. So a key expiring under hundreds of
   * people costs one upstream call, not one per instance. Fails open: no lease, no wait.
   */
  shared?: boolean;
  waitMs?: number;
  /** Stale-while-revalidate: how long past its fresh lifetime the last value answers at once while one refresh runs. Default 0. */
  staleMs?: number;
  /** Stale-if-error: how long past its fresh lifetime the last value answers when a refresh fails. Default 0 (or staleMs, if longer). */
  staleIfErrorMs?: number;
  /** Keep it in this instance only (memory, and disk in development), never in Postgres: large documents. */
  local?: boolean;
  /** A shorter fresh lifetime for some answers (a well-formed "nothing here" kept five minutes instead of hours). */
  ttlFor?: (value: unknown) => number | undefined;
};

/** A cached value and its ages (epoch ms). `stale`: served past freshUntil (stale-while-revalidate or stale-if-error). */
export type CacheEntry<T> = { value: T; fetchedAt: number; freshUntil: number; staleUntil: number; stale: boolean };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Entries with ages live under their own key prefix, so a build without this format (a rollback, or an
 * old instance during a deploy) never reads one as plain JSON; it simply misses and loads. Values the
 * older format wrote under the bare key are still read, as fresh until they expire.
 */
const ENTRY = "cj1:";
type Stored = { fetchedAt: number; freshUntil: number; staleUntil: number; json: string };

/** "fetchedAt|freshUntil|json". Pure. */
const encode = (fetchedAt: number, freshUntil: number, json: string) => `${fetchedAt}|${freshUntil}|${json}`;
function decode(raw: string, exp: number): Stored | null {
  const a = raw.indexOf("|"), b = a < 0 ? -1 : raw.indexOf("|", a + 1);
  if (b < 0) return null;
  const fetchedAt = Number(raw.slice(0, a)), freshUntil = Number(raw.slice(a + 1, b));
  return Number.isFinite(fetchedAt) && Number.isFinite(freshUntil) ? { fetchedAt, freshUntil, staleUntil: exp, json: raw.slice(b + 1) } : null;
}

/** The live entry for `key`: the aged format first, then a value the older format left under the bare key. */
async function readEntry(key: string, ttlMs: number, local = false): Promise<Stored | null> {
  const r = await readRaw([ENTRY + key, key], local);
  if (!r) return null;
  if (r.key === key) return { fetchedAt: Math.max(0, r.exp - ttlMs), freshUntil: r.exp, staleUntil: r.exp, json: r.value };
  return decode(r.value, r.exp);
}

const toEntry = <T>(s: Stored, stale: boolean): CacheEntry<T> => ({ value: JSON.parse(s.json) as T, fetchedAt: s.fetchedAt, freshUntil: s.freshUntil, staleUntil: s.staleUntil, stale });

/** Wait for another instance's load to land in the shared cache (polling it), up to `waitMs`: a value newer than `after`. */
async function awaitOtherFill(key: string, ttlMs: number, waitMs: number, newerThan: number, local = false): Promise<Stored | null> {
  for (let waited = 0; waited < waitMs; waited += 200) {
    await sleep(200);
    const hit = await readEntry(key, ttlMs, local);
    if (hit && hit.fetchedAt > newerThan && Date.now() < hit.freshUntil) return hit;
  }
  return null;
}

/** Keep a background task alive past the response (Next's after(), Vercel's waitUntil); outside a request it just runs. */
export function inBackground(task: Promise<unknown>) {
  const quiet = task.catch(() => undefined);
  try { after(quiet); } catch { /* not in a request (scripts, jobs): the promise runs on its own */ }
}

type FillOpts = CacheJsonOptions & { background?: boolean; staleSince?: number };

/** One load per key per instance; with `shared`, one per key across instances (the fill lease). */
function fill<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: FillOpts): Promise<CacheEntry<T>> | null {
  const pending = loading.get(key);
  if (pending) return opts.background ? null : (pending as Promise<CacheEntry<T>>);
  const windowMs = Math.max(0, opts.staleMs ?? 0, opts.staleIfErrorMs ?? 0);
  const p = (async (): Promise<CacheEntry<T>> => {
    let release: Release | null = null;
    try {
      if (opts.shared && !opts.local && db) {
        release = await lease(`fill:${key}`, 20_000);
        if (!release) {
          // Another instance is loading. A background refresh leaves it to them; a reader waits a moment.
          if (opts.background) throw Object.assign(new Error("refresh in progress elsewhere"), { benign: true });
          const other = await awaitOtherFill(key, ttlMs, opts.waitMs ?? 2_000, opts.staleSince ?? 0, opts.local);
          if (other) return toEntry<T>(other, false);
        }
      }
      const value = await load();
      failed.delete(key);
      const ttl = opts.ttlFor?.(value) ?? ttlMs;
      const fetchedAt = Date.now(), freshUntil = fetchedAt + ttl;
      const json = JSON.stringify(value);
      await cacheSet(ENTRY + key, encode(fetchedAt, freshUntil, json), ttl + windowMs, opts.local, fetchedAt);
      return { value, fetchedAt, freshUntil, staleUntil: freshUntil + windowMs, stale: false };
    } catch (e) {
      if (!(e as { benign?: boolean }).benign) {
        if (failed.size >= MEM_MAX) failed.clear();
        failed.set(key, { until: Date.now() + FAILURE_MS, error: e });
      }
      throw e;
    } finally {
      loading.delete(key);
      if (release) await release();
    }
  })();
  loading.set(key, p);
  return p;
}

/**
 * A cached JSON value with its ages: fresh from the cache, stale while one refresh runs (`staleMs`),
 * stale when a refresh fails (`staleIfErrorMs`), or loaded now. Throws the load's error when there is no
 * value young enough to stand in (and, for half a minute after a failure, without asking again).
 */
export async function cacheEntry<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: CacheJsonOptions = {}): Promise<CacheEntry<T>> {
  const hit = await readEntry(key, ttlMs, opts.local);
  const now = Date.now();
  if (hit && now < hit.freshUntil) return toEntry<T>(hit, false);
  const f = failed.get(key);
  const failing = !!f && f.until > now;
  if (hit) {
    // Past fresh but before staleUntil (the row is gone after that). The source failed moments ago: the
    // last value stands in without asking again.
    if (failing) return toEntry<T>(hit, true);
    if (now < hit.freshUntil + Math.max(0, opts.staleMs ?? 0)) {
      const refresh = fill(key, ttlMs, load, { ...opts, background: true, staleSince: hit.fetchedAt });
      if (refresh) inBackground(refresh);
      return toEntry<T>(hit, true);
    }
    try {
      return await fill(key, ttlMs, load, { ...opts, staleSince: hit.fetchedAt })!;
    } catch {
      return toEntry<T>(hit, true);
    }
  }
  if (failing) throw f!.error;
  return fill(key, ttlMs, load, opts)!;
}

export async function cacheJson<T>(key: string, ttlMs: number, load: () => Promise<T>, opts: CacheJsonOptions = {}): Promise<T> {
  return (await cacheEntry(key, ttlMs, load, opts)).value;
}
