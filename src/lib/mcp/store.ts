/**
 * MCP keys on the server: listed, made and revoked from Settings → Connect AI apps, and checked on every
 * call to /api/mcp. Kept in profiles.extra.apiKeys through the profile row lock (src/lib/prefs/extra.ts).
 * The last-used time is written at most once an hour per key, so a busy agent does not lock the row on
 * every call.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { updateExtra } from "@/lib/prefs/extra";
import { KEYS_MAX, makeKey, matchKey, normalizeKeys, normalizePolicy, parseKey, viewOf, type KeyPolicy, type KeyView } from "./keys";

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

export async function listKeys(userId: string): Promise<KeyView[]> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return normalizeKeys((row?.extra as Record<string, unknown> | undefined)?.apiKeys).map(viewOf);
}

/** A new key: the full key is returned once and never stored. */
export async function createKey(userId: string, name: string, client?: string): Promise<{ key: string; view: KeyView }> {
  const made = makeKey(userId, name);
  const stored = client ? { ...made.stored, client } : made.stored;
  const key = made.key;
  const saved = await updateExtra(userId, (extra) => {
    // An app that connects again (a new device, the connector re-added) replaces its own key, not adds one.
    const keys = normalizeKeys(extra.apiKeys).filter((k) => !client || k.client !== client);
    if (keys.length >= KEYS_MAX) throw status(`You can have ${KEYS_MAX} keys. Revoke one you no longer use to make another.`, 400);
    return { ...extra, apiKeys: [...keys, stored] };
  });
  if (!saved) throw status("Your profile is not set up yet. Reload and try again.", 409);
  return { key, view: viewOf(stored) };
}

export async function revokeKey(userId: string, id: string): Promise<void> {
  await updateExtra(userId, (extra) => ({ ...extra, apiKeys: normalizeKeys(extra.apiKeys).filter((k) => k.id !== id) }));
}

/** Change what a connected app may do. Returns the key as Settings shows it, or null when it is gone. */
export async function setPolicy(userId: string, id: string, change: Partial<KeyPolicy>): Promise<{ view: KeyView; before: KeyPolicy } | null> {
  let out: { view: KeyView; before: KeyPolicy } | null = null;
  await updateExtra(userId, (extra) => ({
    ...extra,
    apiKeys: normalizeKeys(extra.apiKeys).map((k) => {
      if (k.id !== id) return k;
      const before = normalizePolicy(k.policy);
      const next = { ...k, policy: normalizePolicy({ ...before, ...change }) };
      out = { view: viewOf(next), before };
      return next;
    }),
  }));
  return out;
}

/** Whose key this is (from an Authorization header), or null. */
export async function authenticate(header: string | null): Promise<{ userId: string; keyId: string; keyName: string; policy: KeyPolicy } | null> {
  const parsed = parseKey(header);
  if (!parsed) return null;
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, parsed.userId));
  if (!row) return null;
  const hit = matchKey(normalizeKeys((row.extra as Record<string, unknown> | null)?.apiKeys), parsed.secret);
  if (!hit) return null;
  if (!hit.lastUsedAt || Date.now() - Date.parse(hit.lastUsedAt) > 3_600_000) {
    const at = new Date().toISOString();
    await updateExtra(parsed.userId, (extra) => ({ ...extra, apiKeys: normalizeKeys(extra.apiKeys).map((k) => (k.id === hit.id ? { ...k, lastUsedAt: at } : k)) })).catch(() => null);
  }
  return { userId: parsed.userId, keyId: hit.id, keyName: hit.name, policy: normalizePolicy(hit.policy) };
}
