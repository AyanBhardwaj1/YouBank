/**
 * Keys for YouBank's MCP server (/api/mcp): how a person's AI app (Claude, ChatGPT, Cursor, an in-house
 * agent) signs in to YouBank's research tools. A key reads `ybm_<account>.<secret>`: the account part says
 * whose key it is, so a check reads one profile row instead of searching every one, and only a SHA-256
 * hash of the secret is stored (profiles.extra.apiKeys). The key is shown once, when it is made; at most
 * KEYS_MAX per person, each named for the app it is for and revocable from Settings → Connect AI apps.
 *
 * MCP keys are separate from desktop (`ybd_`) and Office (`ybo_`) tokens and only work on /api/mcp. Pure.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const KEYS_MAX = 5;
export const KEY_PREFIX = "ybm_";

export type StoredKey = { id: string; name: string; hint: string; hash: string; createdAt: string; lastUsedAt: string | null };
/** What Settings shows: never the hash. */
export type KeyView = Omit<StoredKey, "hash">;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

/** A new key for a person: the full key (shown once) and what is stored. */
export function makeKey(userId: string, name: string, now = new Date().toISOString()): { key: string; stored: StoredKey } {
  const secret = randomBytes(32).toString("base64url");
  const key = `${KEY_PREFIX}${b64(userId)}.${secret}`;
  return { key, stored: { id: randomBytes(6).toString("hex"), name: cleanKeyName(name), hint: `${KEY_PREFIX}…${secret.slice(-4)}`, hash: sha256(secret), createdAt: now, lastUsedAt: null } };
}

export const cleanKeyName = (n: unknown) => (typeof n === "string" ? n.replace(/\s+/g, " ").replace(/\p{Cc}/gu, "").trim().slice(0, 60) : "") || "AI app";

/** The account and secret in a key, from an `Authorization: Bearer …` header or the key itself; null when it is not one. */
export function parseKey(header: string | null | undefined): { userId: string; secret: string } | null {
  const raw = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  const m = /^ybm_([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{40,60})$/.exec(raw);
  if (!m) return null;
  const userId = Buffer.from(m[1], "base64url").toString("utf8");
  if (!userId || b64(userId) !== m[1]) return null;
  return { userId, secret: m[2] };
}

/** The stored key this secret matches, compared in constant time. */
export function matchKey(keys: StoredKey[], secret: string): StoredKey | null {
  const h = Buffer.from(sha256(secret), "hex");
  let hit: StoredKey | null = null;
  for (const k of keys) {
    const s = Buffer.from(k.hash, "hex");
    if (s.length === h.length && timingSafeEqual(s, h)) hit = k;
  }
  return hit;
}

/** Stored keys, cleaned: well-formed ones, one per id, at most KEYS_MAX. */
export function normalizeKeys(raw: unknown): StoredKey[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw.flatMap((x): StoredKey[] => {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || !/^[a-f0-9]{12}$/.test(o.id) || seen.has(o.id) || typeof o.hash !== "string" || !/^[a-f0-9]{64}$/.test(o.hash)) return [];
    seen.add(o.id);
    return [{ id: o.id, name: cleanKeyName(o.name), hint: typeof o.hint === "string" ? o.hint.slice(0, 20) : KEY_PREFIX, hash: o.hash, createdAt: typeof o.createdAt === "string" ? o.createdAt : "", lastUsedAt: typeof o.lastUsedAt === "string" ? o.lastUsedAt : null }];
  }).slice(0, KEYS_MAX);
}

export const viewOf = (k: StoredKey): KeyView => ({ id: k.id, name: k.name, hint: k.hint, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt });
