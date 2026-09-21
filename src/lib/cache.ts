import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";

/**
 * Layered string cache: memory (per process) -> disk (local dev) -> Neon kv_cache (serverless).
 * Values are strings (JSON or text). Disk is skipped on Vercel where the filesystem is read-only.
 */
const mem = new Map<string, { exp: number; value: string }>();
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
      if (raw.exp > Date.now()) { mem.set(key, raw); return raw.value; }
    } catch { /* miss */ }
  }
  if (db) {
    try {
      const [row] = await db.select().from(schema.kvCache).where(eq(schema.kvCache.key, key));
      if (row && row.expiresAt.getTime() > Date.now()) { mem.set(key, { exp: row.expiresAt.getTime(), value: row.value }); return row.value; }
    } catch { /* db unavailable */ }
  }
  return null;
}

export async function cacheSet(key: string, value: string, ttlMs: number): Promise<void> {
  const exp = Date.now() + ttlMs;
  mem.set(key, { exp, value });
  if (DISK_OK) {
    try { await mkdir(DISK_DIR, { recursive: true }); await writeFile(path.join(DISK_DIR, safe(key)), JSON.stringify({ exp, value })); } catch { /* ignore */ }
  }
  if (db && value.length <= MAX_DB_BYTES) {
    try {
      await db.insert(schema.kvCache).values({ key, value, expiresAt: new Date(exp) }).onConflictDoUpdate({ target: schema.kvCache.key, set: { value, expiresAt: new Date(exp) } });
      // Opportunistic cleanup of expired rows.
      if (Math.random() < 0.02) await db.delete(schema.kvCache).where(sql`${schema.kvCache.expiresAt} < now()`);
    } catch { /* ignore */ }
  }
}

export async function cacheJson<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const hit = await cacheGet(key);
  if (hit) return JSON.parse(hit) as T;
  const value = await load();
  await cacheSet(key, JSON.stringify(value), ttlMs);
  return value;
}
