/**
 * OAuth clients and authorization codes for the MCP server (src/lib/mcp/oauth.ts), kept in kv_cache:
 * registered clients for a year, metadata-document clients for a day (then fetched again), and codes for
 * ten minutes. A code is taken with one DELETE … RETURNING, so it can be used once even when two token
 * requests race.
 */
import { randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { assertPublicUrl } from "@/lib/net";
import { CODE_TTL_MS, clientFrom, isMetadataClientId, type AuthorizeRequest, type OAuthClient } from "./oauth";

const kv = schema.kvCache;
const YEAR = 365 * 86_400_000, DAY = 86_400_000;

async function put(key: string, value: unknown, ttl: number) {
  const v = JSON.stringify(value);
  await requireDb().insert(kv).values({ key, value: v, expiresAt: new Date(Date.now() + ttl) }).onConflictDoUpdate({ target: kv.key, set: { value: v, expiresAt: new Date(Date.now() + ttl) } });
}
async function get<T>(key: string): Promise<T | null> {
  const [r] = await requireDb().select({ value: kv.value }).from(kv).where(and(eq(kv.key, key), gt(kv.expiresAt, new Date())));
  try { return r ? (JSON.parse(r.value) as T) : null; } catch { return null; }
}

/** Dynamic Client Registration (RFC 7591). */
export async function registerClient(body: unknown): Promise<{ client: OAuthClient } | { error: string }> {
  const id = `ybc_${randomBytes(16).toString("base64url")}`;
  const r = clientFrom(body, id);
  if ("client" in r) await put(`oauth:client:${id}`, r.client, YEAR);
  return r;
}

/** A Client ID Metadata Document: fetched from its own URL (public addresses only), which must name itself. */
async function fetchMetadataClient(clientId: string): Promise<OAuthClient | null> {
  await assertPublicUrl(clientId);
  const res = await fetch(clientId, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const text = (await res.text()).slice(0, 20_000);
  let doc: Record<string, unknown>;
  try { doc = JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  if (doc.client_id !== clientId) return null;
  const r = clientFrom(doc, clientId);
  return "client" in r ? r.client : null;
}

export async function getClient(clientId: string): Promise<OAuthClient | null> {
  if (/^ybc_[A-Za-z0-9_-]{20,30}$/.test(clientId)) return get<OAuthClient>(`oauth:client:${clientId}`);
  if (!isMetadataClientId(clientId)) return null;
  const cached = await get<OAuthClient>(`oauth:cimd:${clientId}`);
  if (cached) return cached;
  const fetched = await fetchMetadataClient(clientId).catch(() => null);
  if (fetched) await put(`oauth:cimd:${clientId}`, fetched, DAY);
  return fetched;
}

type CodeData = AuthorizeRequest & { userId: string; clientName: string };

export async function issueCode(userId: string, req: AuthorizeRequest, clientName: string): Promise<string> {
  const code = randomBytes(24).toString("base64url");
  await put(`oauth:code:${code}`, { ...req, userId, clientName } satisfies CodeData, CODE_TTL_MS);
  return code;
}

/** Take a code: it exists, has not expired, and is gone afterwards. */
export async function takeCode(code: string): Promise<CodeData | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(code)) return null;
  const [r] = await requireDb().delete(kv).where(and(eq(kv.key, `oauth:code:${code}`), gt(kv.expiresAt, new Date()))).returning({ value: kv.value });
  try { return r ? (JSON.parse(r.value) as CodeData) : null; } catch { return null; }
}
