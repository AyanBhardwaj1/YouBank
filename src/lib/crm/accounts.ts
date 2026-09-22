import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { decryptToken, encryptToken, encryptionReady } from "./crypto";
import { fetchThread, googleConfig, listThreadIds, profile, refreshAccessToken } from "./gmail";
import { ingestThread, processThread } from "./db";

export type AccountRow = typeof schema.emailAccounts.$inferSelect;
/** What the UI is allowed to see: never the tokens. */
export type SafeAccount = { id: number; address: string; provider: string; status: string; lastSyncAt: string | null; lastError: string };

export const toSafe = (a: AccountRow): SafeAccount => ({
  id: a.id, address: a.address, provider: a.provider, status: a.status,
  lastSyncAt: a.lastSyncAt?.toISOString() ?? null, lastError: a.lastError,
});

export async function listAccounts(userId: string): Promise<AccountRow[]> {
  return requireDb().select().from(schema.emailAccounts)
    .where(eq(schema.emailAccounts.userId, userId)).orderBy(desc(schema.emailAccounts.createdAt));
}

export async function getAccount(userId: string, id: number): Promise<AccountRow | null> {
  const [row] = await requireDb().select().from(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.id, id), eq(schema.emailAccounts.userId, userId)));
  return row ?? null;
}

/** Store a freshly authorised mailbox. Re-connecting the same address updates it in place. */
export async function saveAccount(userId: string, fields: {
  address: string; accessToken: string; refreshToken: string; expiresIn: number; scopes: string[];
}): Promise<AccountRow> {
  if (!encryptionReady()) throw new Error("EMAIL_TOKEN_SECRET is not set, so mailbox tokens cannot be stored safely. Generate one with: openssl rand -base64 32");
  const db = requireDb();
  const address = fields.address.toLowerCase();
  const tokenExpiresAt = new Date(Date.now() + Math.max(fields.expiresIn - 60, 60) * 1000);
  const values = {
    provider: "gmail",
    accessToken: encryptToken(fields.accessToken),
    // Google only returns a refresh token on first consent; keep the stored one if this grant omits it.
    ...(fields.refreshToken ? { refreshToken: encryptToken(fields.refreshToken) } : {}),
    tokenExpiresAt, scopes: fields.scopes, status: "connected", lastError: "",
  };
  const [row] = await db.insert(schema.emailAccounts).values({ userId, address, ...values })
    .onConflictDoUpdate({ target: [schema.emailAccounts.userId, schema.emailAccounts.address], set: values })
    .returning();
  return row;
}

export async function disconnectAccount(userId: string, id: number): Promise<void> {
  // The row is deleted rather than flagged, so no token survives a disconnect.
  await requireDb().delete(schema.emailAccounts)
    .where(and(eq(schema.emailAccounts.id, id), eq(schema.emailAccounts.userId, userId)));
}

/** A usable access token, refreshed and re-stored when the current one has expired. */
export async function accessTokenFor(account: AccountRow, origin: string): Promise<string> {
  const db = requireDb();
  const stillValid = account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now();
  if (stillValid && account.accessToken) return decryptToken(account.accessToken);
  if (!account.refreshToken) throw new Error("This mailbox needs to be reconnected");
  try {
    const cfg = googleConfig(origin);
    const t = await refreshAccessToken(cfg, decryptToken(account.refreshToken));
    await db.update(schema.emailAccounts).set({
      accessToken: encryptToken(t.access_token),
      tokenExpiresAt: new Date(Date.now() + Math.max(t.expires_in - 60, 60) * 1000),
      status: "connected", lastError: "",
    }).where(eq(schema.emailAccounts.id, account.id));
    return t.access_token;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(schema.emailAccounts).set({ status: "needs_reauth", lastError: message.slice(0, 500) })
      .where(eq(schema.emailAccounts.id, account.id));
    throw new Error(`This mailbox needs to be reconnected: ${message}`);
  }
}

export type SyncResult = { fetched: number; ingested: number; triaged: number; skipped: number; errors: string[] };

/**
 * Pull recent threads and read them.
 *
 * Reading is the expensive part, so only threads that are new or have grown since the last sync are
 * triaged. Nothing is ever sent from here.
 */
export async function syncMailbox(userId: string, account: AccountRow, origin: string, opts?: { max?: number; query?: string }): Promise<SyncResult> {
  const db = requireDb();
  const token = await accessTokenFor(account, origin);
  const out: SyncResult = { fetched: 0, ingested: 0, triaged: 0, skipped: 0, errors: [] };

  let ids: string[] = [];
  try { ids = await listThreadIds(token, { query: opts?.query, max: opts?.max ?? 15 }); }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.update(schema.emailAccounts).set({ lastError: message.slice(0, 500) }).where(eq(schema.emailAccounts.id, account.id));
    throw e;
  }

  for (const id of ids) {
    try {
      const fetched = await fetchThread(token, id, account.address);
      if (!fetched) { out.skipped++; continue; }
      out.fetched++;

      const [existing] = await db.select({ id: schema.crmThreads.id, triagedAt: schema.crmThreads.triagedAt, last: schema.crmThreads.lastMessageAt })
        .from(schema.crmThreads)
        .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmThreads.providerThreadId, fetched.providerThreadId)));
      const newest = fetched.messages[fetched.messages.length - 1]?.sentAt ?? null;
      const unchanged = existing?.triagedAt && existing.last && newest && existing.last.getTime() >= newest.getTime();

      const thread = await ingestThread(userId, { ...fetched, accountId: account.id });
      out.ingested++;
      if (unchanged) { out.skipped++; continue; }
      await processThread(userId, thread.id);
      out.triaged++;
    } catch (e) {
      out.errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await db.update(schema.emailAccounts).set({ lastSyncAt: new Date(), lastError: out.errors[0]?.slice(0, 500) ?? "" })
    .where(eq(schema.emailAccounts.id, account.id));
  return out;
}

/** The address Gmail says this token belongs to, used to name the connection. */
export async function addressFor(token: string): Promise<string> {
  const p = await profile(token);
  return p.emailAddress.toLowerCase();
}
