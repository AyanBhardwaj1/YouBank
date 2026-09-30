/**
 * Leases and counters shared by every instance, kept in kv_cache (no table of their own): a lease is
 * a lock that frees itself when its holder dies, a counter limits requests per window. Both fail
 * open when the database does not answer, so a blip never locks people out.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type Release = () => Promise<void>;

/** Take `key` for `ttlMs` unless another holder's lease is still running. Returns its release, or null when taken. */
export async function lease(key: string, ttlMs: number): Promise<Release | null> {
  const k = `lease:${key}`, token = randomUUID(), expiresAt = new Date(Date.now() + ttlMs);
  try {
    const [row] = await requireDb().insert(schema.kvCache).values({ key: k, value: token, expiresAt })
      .onConflictDoUpdate({ target: schema.kvCache.key, set: { value: token, expiresAt }, setWhere: sql`${schema.kvCache.expiresAt} < now()` })
      .returning({ value: schema.kvCache.value });
    if (row?.value !== token) return null;
  } catch {
    return async () => undefined;
  }
  return async () => {
    await requireDb().delete(schema.kvCache).where(and(eq(schema.kvCache.key, k), eq(schema.kvCache.value, token))).catch(() => undefined);
  };
}

/** Count a request against `key`; false once more than `limit` arrived in the current window. */
export async function withinRate(key: string, limit: number, windowMs: number): Promise<boolean> {
  const win = Math.floor(Date.now() / windowMs);
  const k = `rate:${key}:${win}`;
  try {
    const [row] = await requireDb().insert(schema.kvCache).values({ key: k, value: "1", expiresAt: new Date((win + 1) * windowMs + 60_000) })
      .onConflictDoUpdate({ target: schema.kvCache.key, set: { value: sql`(${schema.kvCache.value}::int + 1)::text` } })
      .returning({ value: schema.kvCache.value });
    return Number(row?.value ?? 0) <= limit;
  } catch {
    return true;
  }
}

/** A 429 with a message for people; `guarded()` passes it through. */
export const tooMany = (message: string) => Object.assign(new Error(message), { status: 429 });

/** Throw a 429 when `key` has had more than `limit` requests this window. */
export async function rateLimit(key: string, limit: number, windowMs: number, message: string): Promise<void> {
  if (!(await withinRate(key, limit, windowMs))) throw tooMany(message);
}
