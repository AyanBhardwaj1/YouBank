/**
 * The cache for data fetched with a person's own key, partitioned by person and provider, and kept apart
 * from every shared cache: keys `byo:v1:<hash of the person>:<provider>:<what>` in kv_cache (or this process's memory
 * when there is no database), never the shared `cj1:` entries, the company record, R2 bars or news sparks.
 * No shared fill lease and no disk copy. Removing a key purges its rows (`purgeKeyed`), as Finnhub's terms
 * require when a subscription ends.
 *
 * Only the database layer is used when there is one, so a purge is immediate on every instance (a memory
 * copy on another instance could not be purged).
 */
import { createHash } from "node:crypto";
import { and, eq, gt, like } from "drizzle-orm";
import { db, schema } from "@/db";
import { sharedMap } from "@/lib/shared";
import type { KeyProvider } from "../sources-meta";

const PREFIX = "byo:v1";
const MEM_MAX = 2_000;
const mem = sharedMap<string, { exp: number; fetchedAt: number; json: string }>("byo:mem");
const inflight = sharedMap<string, Promise<unknown>>("byo:inflight");

/** A person's partition name: a hash of their id (hex, so no LIKE wildcard can appear in it). Pure. */
const partition = (userId: string) => createHash("sha256").update(`byo:${userId}`).digest("hex").slice(0, 24);
/** The partition for a person and provider ("byo:v1:<user hash>:<provider>:"). Pure. */
export const keyedPrefix = (userId: string, provider: KeyProvider) => `${PREFIX}:${partition(userId)}:${provider}:`;
/** One entry's key. Pure. */
export const keyedKey = (userId: string, provider: KeyProvider, what: string) => `${keyedPrefix(userId, provider)}${what}`;
/** Whether a cache key belongs to keyed data (no shared cache may hold one). Pure. */
export const isKeyedKey = (key: string) => key.startsWith(`${PREFIX}:`);

type Stored = { fetchedAt: number; json: string };

async function read(key: string): Promise<Stored | null> {
  if (!db) {
    const m = mem.get(key);
    return m && m.exp > Date.now() ? m : null;
  }
  try {
    const [row] = await db.select({ value: schema.kvCache.value }).from(schema.kvCache).where(and(eq(schema.kvCache.key, key), gt(schema.kvCache.expiresAt, new Date())));
    if (!row) return null;
    const i = row.value.indexOf("|");
    return { fetchedAt: Number(row.value.slice(0, i)), json: row.value.slice(i + 1) };
  } catch { return null; }
}

async function write(key: string, s: Stored, ttlMs: number) {
  const exp = s.fetchedAt + ttlMs;
  if (!db) {
    if (mem.size >= MEM_MAX) mem.clear();
    mem.set(key, { exp, ...s });
    return;
  }
  const value = `${s.fetchedAt}|${s.json}`;
  try { await db.insert(schema.kvCache).values({ key, value, expiresAt: new Date(exp) }).onConflictDoUpdate({ target: schema.kvCache.key, set: { value, expiresAt: new Date(exp) } }); } catch { /* not cached */ }
}

/**
 * A keyed answer, cached for `ttlMs` in the person's own partition; one load per key per instance.
 * `held` is asked just before the answer is written: a key removed while its fetch was in flight (the
 * purge already ran) leaves nothing behind.
 */
export async function keyedCache<T>(userId: string, provider: KeyProvider, what: string, ttlMs: number, load: () => Promise<T>, held: () => Promise<boolean> = async () => true): Promise<{ value: T; fetchedAt: number }> {
  const key = keyedKey(userId, provider, what);
  const hit = await read(key);
  if (hit) return { value: JSON.parse(hit.json) as T, fetchedAt: hit.fetchedAt };
  const pending = inflight.get(key) as Promise<{ value: T; fetchedAt: number }> | undefined;
  if (pending) return pending;
  const p = (async () => {
    try {
      const value = await load();
      const fetchedAt = Date.now();
      if (value !== null && value !== undefined && (await held())) await write(key, { fetchedAt, json: JSON.stringify(value) }, ttlMs);
      return { value, fetchedAt };
    } finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  return p;
}

/** Delete a person's cached keyed data: one provider's, or every provider's. Returns how many entries went. */
export async function purgeKeyed(userId: string, provider?: KeyProvider): Promise<number> {
  const prefix = provider ? keyedPrefix(userId, provider) : `${PREFIX}:${partition(userId)}:`;
  let n = 0;
  for (const k of [...mem.keys()]) if (k.startsWith(prefix)) { mem.delete(k); n++; }
  if (db) {
    const gone = await db.delete(schema.kvCache).where(like(schema.kvCache.key, `${prefix}%`)).returning({ key: schema.kvCache.key });
    n += gone.length;
  }
  return n;
}
