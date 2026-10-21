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

/** The person's decrypted keys. Server only; never logged, never returned to a client. */
async function loadKeys(userId: string): Promise<Partial<Record<KeyProvider, StoredKey>>> {
  const [row] = await requireDb().select({ keysEnc: schema.userDataSources.keysEnc }).from(schema.userDataSources).where(eq(schema.userDataSources.userId, userId));
  if (!row?.keysEnc) return {};
  return JSON.parse(decryptToken(row.keysEnc)) as Partial<Record<KeyProvider, StoredKey>>;
}

async function upsert(userId: string, set: Partial<typeof schema.userDataSources.$inferInsert>) {
  await requireDb().insert(schema.userDataSources).values({ userId, ...set, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.userDataSources.userId, set: { ...set, updatedAt: new Date() } });
  memo.delete(userId);
}

/** Save the person's order per dataset (already validated by the route). */
export async function saveOrder(userId: string, order: Settings["order"]): Promise<void> {
  await upsert(userId, { prefs: { order } });
}

/** Save (or replace) a key: encrypted with the others, its last four and plan shown. Purges data cached with the old one. */
export async function saveKey(userId: string, provider: KeyProvider, key: string, plan: PlanType, lastTest?: KeyMeta["lastTest"]): Promise<KeyMeta> {
  if (!encryptionReady()) throw Object.assign(new Error("Saving keys is not set up on this server yet."), { status: 503 });
  const [keys, s] = await Promise.all([loadKeys(userId).catch(() => ({}) as Partial<Record<KeyProvider, StoredKey>>), loadSettings(userId)]);
  const addedAt = new Date().toISOString();
  const meta: KeyMeta = { last4: key.slice(-4), plan, addedAt, ...(lastTest ? { lastTest } : {}) };
  await upsert(userId, { keysEnc: encryptToken(JSON.stringify({ ...keys, [provider]: { key, plan, addedAt } })), keyMeta: { ...s.keyMeta, [provider]: meta } });
  await purgeKeyed(userId, provider);
  return meta;
}

/** Remove a key and purge every cached answer fetched with it. Returns whether there was one. */
export async function removeKey(userId: string, provider: KeyProvider): Promise<{ removed: boolean; purged: number }> {
  const [keys, s] = await Promise.all([loadKeys(userId).catch(() => ({}) as Partial<Record<KeyProvider, StoredKey>>), loadSettings(userId)]);
  const had = !!keys[provider] || !!s.keyMeta[provider];
  const rest = { ...keys }, meta = { ...s.keyMeta };
  delete rest[provider];
  delete meta[provider];
  await upsert(userId, { keysEnc: Object.keys(rest).length ? encryptToken(JSON.stringify(rest)) : "", keyMeta: meta });
  return { removed: had, purged: await purgeKeyed(userId, provider) };
}

/** Record a saved key's last test on its shown facts. */
export async function noteKeyTest(userId: string, provider: KeyProvider, lastTest: NonNullable<KeyMeta["lastTest"]>): Promise<void> {
  const s = await loadSettings(userId);
  if (!s.keyMeta[provider]) return;
  await upsert(userId, { keyMeta: { ...s.keyMeta, [provider]: { ...s.keyMeta[provider], lastTest } } });
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
  };
}

/** Forget this instance's copy of a person's settings (tests; a change made elsewhere). */
export const forgetSettings = (userId: string) => memo.delete(userId);
