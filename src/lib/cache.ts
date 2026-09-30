import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Layered string cache: memory (per process) -> disk (local dev) -> Neon kv_cache (serverless).
 * Values are strings (JSON or text). Disk is skipped on Vercel where the filesystem is read-only.
 * The memory layer is bounded; cacheJson shares one load among concurrent misses (so a popular ticker
 * at the open costs one upstream call per instance, not one per request) and remembers a failure for
 * half a minute (so an upstream outage is not hammered by every request).
 */
const mem = new Map<string, { exp: number; value: string }>();
const MEM_MAX = 5_000;
const loading = new Map<string, Promise<unknown>>();
const failed = new Map<string, { until: number; error: unknown }>();
const FAILURE_MS = 30_000;

/** Keep the memory layer bounded: drop expired entries, then the oldest tenth (a Map keeps insertion order). */
function remember(key: string, entry: { exp: number; value: string }) {
  if (!mem.has(key) && mem.size >= MEM_MAX) {
    const now = Date.now();
    for (const [k, v] of mem) if (v.exp <= now) mem.delete(k);
    if (mem.size >= MEM_MAX) { let n = MEM_MAX / 10; for (const k of mem.keys()) { if (n-- <= 0) break; mem.delete(k); } }
  }
  mem.set(key, entry);
}
const DISK_OK = !process.env.VERCEL && !process.env.YOUBANK_NO_DISK_CACHE;
const DISK_DIR = path.join(process.cwd(), ".cache", "kv");
const MAX_DB_BYTES = 3_000_000;

const safe = (key: string) => key.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 180);

export async function cacheGet(key: string): Promise<string | null> {
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.value;
  if (DISK_OK) {
    try {
      const raw = JSON.parse(await readFile(path.join(DISK_DIR, safe(key)), "utf8")) as { exp: number; value: string };
      if (raw.exp > Date.now()) { remember(key, raw); return raw.value; }
    } catch { /* miss */ }
  }
  if (db) {
    try {
      const [row] = await db.select().from(schema.kvCache).where(eq(schema.kvCache.key, key));
      if (row && row.expiresAt.getTime() > Date.now()) { remember(key, { exp: row.expiresAt.getTime(), value: row.value }); return row.value; }
    } catch { /* db unavailable */ }
  }
  return null;
}

export async function cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
  const exp = Date.now() + ttlMs;
  remember(key, { exp, value });
  if (DISK_OK) {
    try { await mkdir(DISK_DIR, { recursive: true }); await writeFile(path.join(DISK_DIR, safe(key)), JSON.stringify({ exp, value })); } catch { /* ignore */ }
  }
  if (db && value.length <= MAX_DB_BYTES) {
    try {
      await db.insert(schema.kvCache).values({ key, value, expiresAt: new Date(exp) }).onConflictDoUpdate({ target: schema.kvCache.key, set: { value, expiresAt: new Date(exp) } });
      // Opportunistic cleanup of expired rows, a batch at a time (indexed on expires_at).
      if (Math.random() < 0.02) await db.execute(sql`delete from ${schema.kvCache} where ${schema.kvCache.key} in (select ${schema.kvCache.key} from ${schema.kvCache} where ${schema.kvCache.expiresAt} < now() limit 500)`);
    } catch { /* ignore */ }
  }
}

export async function cacheJson<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T;
  const f = failed.get(key);
  if (f && f.until > Date.now()) throw f.error;
  const pending = loading.get(key);
  if (pending) return pending as Promise<T>;
  const p = (async () => {
    try {
      const value = await load();
      failed.delete(key);
      await cacheSet(key, JSON.stringify(value), ttlMs);
      return value;
    } catch (e) {
      if (failed.size >= MEM_MAX) failed.clear();
      failed.set(key, { until: Date.now() + FAILURE_MS, error: e });
      throw e;
    } finally {
      loading.delete(key);
    }
  })();
  loading.set(key, p);
  return p;
}
