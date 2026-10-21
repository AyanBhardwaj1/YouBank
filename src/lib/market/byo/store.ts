/**
 * A person's data-source settings (drizzle/0029_data_sources.sql): their order per dataset and their own
 * provider keys. Server only.
 *
 * Keys are encrypted at rest as one AES-256-GCM blob (lib/crm/crypto), decrypted only on the server when
 * a keyed adapter fetches (`dataUserFor(...).key`), and never sent back to the browser: the page sees the
 * last four characters, the plan type and the last test (key_meta). Removing or replacing a key purges the
 * person's cached data from that provider (byo/cache.ts).
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { decryptToken, encryptionReady, encryptToken } from "@/lib/crm/crypto";
import { sharedMap } from "@/lib/shared";
import { isDatasetName, isKeyProvider, isSourceId, type DatasetName, type KeyProvider, type PlanType, type SourceId } from "../sources-meta";
import type { DataUser } from "../user-context";
import { purgeKeyed } from "./cache";

export type KeyMeta = { last4: string; plan: PlanType; addedAt: string; lastTest?: { ok: boolean; at: string; ms: number } };
export type Settings = { order: Partial<Record<DatasetName, SourceId[]>>; keyMeta: Partial<Record<KeyProvider, KeyMeta>> };
type StoredKey = { key: string; plan: PlanType; addedAt: string };

/** Settings are read on every terminal request: kept a few seconds per instance (a person's own change clears it here). */
const MEMO_MS = 15_000;
const MEMO_MAX = 5_000;
const memo = sharedMap<string, { until: number; s: Settings }>("byo:settings");

/** Stored prefs, keeping only known datasets and source ids (anything else in the row is ignored). Pure. */
export function cleanOrder(raw: unknown): Settings["order"] {
  const order = (raw && typeof raw === "object" ? (raw as { order?: unknown }).order : null) ?? {};
  const out: Settings["order"] = {};
  for (const [d, ids] of Object.entries(order as Record<string, unknown>)) {
    if (isDatasetName(d) && Array.isArray(ids)) out[d] = [...new Set(ids.filter(isSourceId))];
  }
  return out;
}

function cleanMeta(raw: unknown): Settings["keyMeta"] {
  const out: Settings["keyMeta"] = {};
  for (const [p, m] of Object.entries((raw ?? {}) as Record<string, KeyMeta>)) if (isKeyProvider(p) && m && typeof m.last4 === "string") out[p] = m;
  return out;
}

/** A person's settings (no secrets). Empty when they have none. */
export async function loadSettings(userId: string): Promise<Settings> {
  const hit = memo.get(userId);
  if (hit && hit.until > Date.now()) return hit.s;
  const [row] = await requireDb().select({ prefs: schema.userDataSources.prefs, keyMeta: schema.userDataSources.keyMeta }).from(schema.userDataSources).where(eq(schema.userDataSources.userId, userId));
  const s: Settings = { order: cleanOrder(row?.prefs), keyMeta: cleanMeta(row?.keyMeta) };
  if (memo.size >= MEMO_MAX) memo.clear();
  memo.set(userId, { until: Date.now() + MEMO_MS, s });
  return s;
}

type StoredKeys = Partial<Record<KeyProvider, StoredKey>>;

/** A stored blob's keys. Server only; never logged, never returned to a client. */
const keysOf = (keysEnc: string | null | undefined): StoredKeys => (keysEnc ? (JSON.parse(decryptToken(keysEnc)) as StoredKeys) : {});

/** The person's decrypted keys. Server only; never logged, never returned to a client. */
async function loadKeys(userId: string): Promise<StoredKeys> {
  const [row] = await requireDb().select({ keysEnc: schema.userDataSources.keysEnc }).from(schema.userDataSources).where(eq(schema.userDataSources.userId, userId));
  return keysOf(row?.keysEnc);
}

type Row = { order: Settings["order"]; keyMeta: Settings["keyMeta"]; keysEnc: string };

/**
 * Change a person's row from what is stored now, never from a copy: the row is locked for the change, so
 * two changes at once (two tabs, two instances) cannot write over each other, and a key added on one
 * instance is never dropped, nor a removed one brought back, by another instance's few-seconds-old copy.
 */
async function mutate<T>(userId: string, change: (row: Row) => { set: Partial<typeof schema.userDataSources.$inferInsert>; result: T }): Promise<T> {
  const out = await requireDb().transaction(async (tx) => {
    await tx.insert(schema.userDataSources).values({ userId }).onConflictDoNothing();
    const [row] = await tx.select({ prefs: schema.userDataSources.prefs, keyMeta: schema.userDataSources.keyMeta, keysEnc: schema.userDataSources.keysEnc })
      .from(schema.userDataSources).where(eq(schema.userDataSources.userId, userId)).for("update");
    const { set, result } = change({ order: cleanOrder(row?.prefs), keyMeta: cleanMeta(row?.keyMeta), keysEnc: row?.keysEnc ?? "" });
    await tx.update(schema.userDataSources).set({ ...set, updatedAt: new Date() }).where(eq(schema.userDataSources.userId, userId));
    return result;
  });
  memo.delete(userId);
  return out;
}

/** A stored blob's keys, or none when it cannot be read (the server's secret changed): a new key then starts afresh. */
const readableKeys = (keysEnc: string): StoredKeys => { try { return keysOf(keysEnc); } catch { return {}; } };

/**
 * Save the person's order for the datasets given (already validated by the route); other datasets keep
 * theirs, and an empty list goes back to the default order.
 */
export async function saveOrder(userId: string, order: Settings["order"]): Promise<void> {
  await mutate(userId, (row) => {
    const merged: Settings["order"] = { ...row.order, ...order };
    for (const [d, ids] of Object.entries(merged)) if (!ids?.length) delete merged[d as DatasetName];
    return { set: { prefs: { order: merged } }, result: undefined };
  });
}

/** Save (or replace) a key: encrypted with the others, its last four and plan shown. Purges data cached with the old one. */
export async function saveKey(userId: string, provider: KeyProvider, key: string, plan: PlanType, lastTest?: KeyMeta["lastTest"]): Promise<KeyMeta> {
  if (!encryptionReady()) throw Object.assign(new Error("Saving keys is not set up on this server yet."), { status: 503 });
  const meta = await mutate(userId, (row) => {
    const keys = readableKeys(row.keysEnc);
    const addedAt = new Date().toISOString();
    const m: KeyMeta = { last4: key.slice(-4), plan, addedAt, ...(lastTest ? { lastTest } : {}) };
    // What is shown follows what is stored: a key that could not be read is not listed as saved.
    const shown = Object.fromEntries(Object.entries(row.keyMeta).filter(([p]) => !!keys[p as KeyProvider]));
    return { set: { keysEnc: encryptToken(JSON.stringify({ ...keys, [provider]: { key, plan, addedAt } })), keyMeta: { ...shown, [provider]: m } }, result: m };
  });
  await purgeKeyed(userId, provider);
  return meta;
}

/** Remove a key and purge every cached answer fetched with it. Returns whether there was one. */
export async function removeKey(userId: string, provider: KeyProvider): Promise<{ removed: boolean; purged: number }> {
  const had = await mutate(userId, (row) => {
    const rest = readableKeys(row.keysEnc), meta = { ...row.keyMeta };
    const was = !!rest[provider] || !!meta[provider];
    delete rest[provider];
    delete meta[provider];
    return { set: { keysEnc: Object.keys(rest).length ? encryptToken(JSON.stringify(rest)) : "", keyMeta: meta }, result: was };
  });
  return { removed: had, purged: await purgeKeyed(userId, provider) };
}

/** Record a saved key's last test on its shown facts. */
export async function noteKeyTest(userId: string, provider: KeyProvider, lastTest: NonNullable<KeyMeta["lastTest"]>): Promise<void> {
  await mutate(userId, (row) => {
    const m = row.keyMeta[provider];
    return { set: m ? { keyMeta: { ...row.keyMeta, [provider]: { ...m, lastTest } } } : {}, result: undefined };
  });
}

/** Whether the person still holds a key for `provider`, read now (not from a copy): a fetch that started before the key was removed does not cache its answer. */
export async function keyStillHeld(userId: string, provider: KeyProvider): Promise<boolean> {
  const [row] = await requireDb().select({ keyMeta: schema.userDataSources.keyMeta }).from(schema.userDataSources).where(eq(schema.userDataSources.userId, userId));
  return !!cleanMeta(row?.keyMeta)[provider];
}

/** A saved key, decrypted, for a test the person asked for. Server only. */
export async function savedKey(userId: string, provider: KeyProvider): Promise<{ key: string; plan: PlanType } | null> {
  const k = (await loadKeys(userId))[provider];
  return k ? { key: k.key, plan: k.plan } : null;
}

/**
 * The data layer's view of a person for one request (user-context.ts): their order, which providers
 * they have keys for, and a reader that decrypts the keys once, only if a keyed source fetches.
 */
export async function dataUserFor(userId: string, override?: DataUser["override"]): Promise<DataUser> {
  const s = await loadSettings(userId);
  let keys: Promise<Partial<Record<KeyProvider, StoredKey>>> | null = null;
  return {
    userId, order: s.order, keyed: new Set(Object.keys(s.keyMeta) as KeyProvider[]), ...(override ? { override } : {}),
    key: async (p) => { keys ??= loadKeys(userId).catch(() => ({})); return (await keys)[p]?.key ?? null; },
    held: (p) => keyStillHeld(userId, p).catch(() => false),
  };
}

/** Forget this instance's copy of a person's settings (tests; a change made elsewhere). */
export const forgetSettings = (userId: string) => memo.delete(userId);
