import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { decryptToken, encryptToken, encryptionReady } from "./crypto";
import { googleConfig, profile, refreshAccessToken } from "./gmail";
import { MAIL_PRESETS, verifyMailbox, type ImapSettings } from "./imap";

export type AccountRow = typeof schema.emailAccounts.$inferSelect;
/** What the UI is allowed to see: never the tokens or the password. */
export type SafeAccount = { id: number; address: string; provider: string; status: string; lastSyncAt: string | null; lastError: string; host: string };

export const toSafe = (a: AccountRow): SafeAccount => ({
  id: a.id, address: a.address, provider: a.provider, status: a.status,
  lastSyncAt: a.lastSyncAt?.toISOString() ?? null, lastError: a.lastError,
  host: a.provider === "imap" ? (a.settings.imapHost ?? "") : "gmail.googleapis.com",
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

/**
 * Connect a mailbox with an app password over IMAP and SMTP.
 *
 * Both servers are signed in to before anything is stored, so a wrong password is reported now
 * rather than on the first send. The password is encrypted at rest; the UI never sees it again.
 */
export async function saveImapAccount(userId: string, input: {
  email: string; password: string; name?: string; preset?: string;
  imapHost?: string; imapPort?: number; smtpHost?: string; smtpPort?: number; username?: string;
}): Promise<AccountRow> {
  if (!encryptionReady()) throw new Error("EMAIL_TOKEN_SECRET is not set, so a mailbox password cannot be stored safely. Generate one with: openssl rand -base64 32");
  const address = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(address)) throw new Error("That is not an email address");
  const password = input.password.replace(/\s+/g, ""); // Google shows app passwords in groups of four
  if (!password) throw new Error("Paste the app password");
  const preset = input.preset && MAIL_PRESETS[input.preset] ? MAIL_PRESETS[input.preset] : null;
  const settings: ImapSettings = preset
    ? { imapHost: preset.imapHost, imapPort: preset.imapPort, imapSecure: preset.imapSecure, smtpHost: preset.smtpHost, smtpPort: preset.smtpPort, smtpSecure: preset.smtpSecure, username: input.username?.trim() || address, preset: input.preset }
    : {
        imapHost: (input.imapHost ?? "").trim(), imapPort: Number(input.imapPort) || 993, imapSecure: (Number(input.imapPort) || 993) === 993,
        smtpHost: (input.smtpHost ?? "").trim(), smtpPort: Number(input.smtpPort) || 465, smtpSecure: (Number(input.smtpPort) || 465) === 465,
        username: input.username?.trim() || address, preset: "custom",
      };
  if (!settings.imapHost || !settings.smtpHost) throw new Error("Both the IMAP and SMTP server names are needed");
  await verifyMailbox(settings, password);

  const values = {
    provider: "imap", displayName: (input.name ?? "").trim().slice(0, 120), settings, secret: encryptToken(password),
    accessToken: "", refreshToken: "", tokenExpiresAt: null, scopes: [] as string[], status: "connected", lastError: "", cursor: "",
  };
  const [row] = await requireDb().insert(schema.emailAccounts).values({ userId, address, ...values })
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

/** The address Gmail says this token belongs to, used to name the connection. */
export async function addressFor(token: string): Promise<string> {
  const p = await profile(token);
  return p.emailAddress.toLowerCase();
}
