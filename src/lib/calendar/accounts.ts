/**
 * Connected calendar accounts: saving them, turning a stored row into a working provider, and keeping
 * OAuth tokens fresh. Server only.
 *
 * The patterns are the mailbox connector's (src/lib/crm/accounts.ts): every secret is encrypted with
 * EMAIL_TOKEN_SECRET before it is stored (OAuth tokens, CalDAV app passwords, and ICS links, which
 * often carry a private token in the URL); a refresh that fails marks the account `needs_reauth` with
 * the reason, and the UI shows Reconnect; disconnecting deletes the row and, by cascade, every
 * calendar and event that came from it.
 */
import { and, asc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CalendarAccountSettings } from "@/db/schema";
import { requireFeature } from "@/lib/billing/entitlements";
import type { CurrentUser } from "@/lib/auth/user";
import { decryptToken, encryptToken, encryptionReady } from "@/lib/crm/crypto";
import { describeFailure } from "@/lib/errors";
import { publicFetch } from "./net";
import { ProviderError, type CalendarProvider, type TokenResponse } from "./provider";
import { CalDavCalendar, CALDAV_PRESETS } from "./providers/caldav";
import { GoogleCalendar, googleCalendarConfig, googleRefresh } from "./providers/google";
import { IcsCalendar, normalizeFeedUrl } from "./providers/ics";
import { MicrosoftCalendar, microsoftConfig, microsoftRefresh } from "./providers/microsoft";
import type { ProviderId } from "./types";

export type AccountRow = typeof schema.calendarAccounts.$inferSelect;
export type CalendarRow = typeof schema.calendarCalendars.$inferSelect;

/** What the browser may see of an account: never tokens, passwords or a private feed URL. */
export type SafeAccount = { id: number; provider: ProviderId; address: string; displayName: string; status: string; lastError: string; lastSyncAt: string | null; host: string };

export function toSafe(a: AccountRow): SafeAccount {
  const host = a.provider === "caldav" ? safeHost(a.settings.serverUrl) : a.provider === "ics" ? a.settings.url ?? "" : a.provider === "google" ? "Google" : "Microsoft";
  return { id: a.id, provider: a.provider as ProviderId, address: a.address, displayName: a.displayName, status: a.status, lastError: a.lastError, lastSyncAt: a.lastSyncAt?.toISOString() ?? null, host };
}

const safeHost = (url?: string) => { try { return url ? new URL(url).hostname : ""; } catch { return ""; } };

/** Which ways of connecting this server supports, for "Not set up yet" in the UI. */
export function providerSetup(origin: string): Record<ProviderId, { ready: boolean; reason: string }> {
  const enc = encryptionReady();
  const noEnc = "Needs EMAIL_TOKEN_SECRET on the server, so passwords and tokens can be stored encrypted.";
  return {
    google: { ready: enc && !!googleCalendarConfig(origin), reason: !enc ? noEnc : "Needs a Google OAuth client (GOOGLE_CALENDAR_CLIENT_ID and _SECRET, or the Gmail client)." },
    microsoft: { ready: enc && !!microsoftConfig(origin), reason: !enc ? noEnc : "Needs a Microsoft app registration (MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET)." },
    caldav: { ready: enc, reason: enc ? "" : noEnc },
    ics: { ready: enc, reason: enc ? "" : noEnc },
  };
}

export async function listAccounts(userId: string): Promise<AccountRow[]> {
  return requireDb().select().from(schema.calendarAccounts).where(eq(schema.calendarAccounts.userId, userId)).orderBy(asc(schema.calendarAccounts.createdAt));
}

export async function getAccount(userId: string, id: number): Promise<AccountRow | null> {
  const [row] = await requireDb().select().from(schema.calendarAccounts).where(and(eq(schema.calendarAccounts.id, id), eq(schema.calendarAccounts.userId, userId)));
  return row ?? null;
}

/**
 * A second account (of any kind) is a paid perk; reconnecting one already connected never is.
 * Called before anything is stored.
 */
export async function checkAccountLimit(user: Pick<CurrentUser, "id" | "email">, provider: ProviderId, address: string): Promise<void> {
  const existing = await listAccounts(user.id);
  const same = existing.some((a) => a.provider === provider && a.address === address.toLowerCase());
  if (!same && existing.length >= 1) await requireFeature(user, "calendar.multi_account");
}

function assertEncryption() {
  if (!encryptionReady()) throw new Error("EMAIL_TOKEN_SECRET is not set, so calendar credentials cannot be stored safely. Generate one with: openssl rand -base64 32");
}

const expiry = (seconds: number) => new Date(Date.now() + Math.max(seconds - 60, 60) * 1000);

/** Store a freshly authorised Google or Microsoft account. Reconnecting updates it in place. */
export async function saveOAuthAccount(userId: string, provider: "google" | "microsoft", address: string, t: TokenResponse): Promise<AccountRow> {
  assertEncryption();
  const values = {
    accessToken: encryptToken(t.access_token),
    // Google only returns a refresh token on first consent; keep the stored one if this grant omits it.
    ...(t.refresh_token ? { refreshToken: encryptToken(t.refresh_token) } : {}),
    tokenExpiresAt: expiry(t.expires_in), scopes: (t.scope ?? "").split(" ").filter(Boolean), status: "connected", lastError: "",
  };
  const [row] = await requireDb().insert(schema.calendarAccounts).values({ userId, provider, address: address.toLowerCase(), ...values })
    .onConflictDoUpdate({ target: [schema.calendarAccounts.userId, schema.calendarAccounts.provider, schema.calendarAccounts.address], set: values })
    .returning();
  return row;
}

/**
 * Connect a CalDAV server with an app password. The server is signed in to and its calendars listed
 * before anything is stored, so a wrong password or address is reported now.
 */
export async function connectCalDav(user: Pick<CurrentUser, "id" | "email">, input: { preset?: string; serverUrl?: string; username: string; password: string; name?: string }): Promise<AccountRow> {
  assertEncryption();
  const preset = input.preset ? CALDAV_PRESETS[input.preset] : undefined;
  const serverUrl = (preset?.url || input.serverUrl || "").trim();
  if (!serverUrl) throw new Error("Enter the CalDAV server address.");
  const username = input.username.trim();
  const password = input.password.replace(/\s+/g, "");
  if (!username || !password) throw new Error("Enter the user name and the app password.");
  const provider = new CalDavCalendar({ serverUrl, username, password, email: username.includes("@") ? username : "" }, publicFetch());
  const { homeUrl, email } = await provider.discoverHome();
  const calendars = await provider.listCalendars();
  if (!calendars.length) throw new Error("Signed in, but that account has no calendars.");
  const address = (email || username).toLowerCase();
  await checkAccountLimit(user, "caldav", address);
  const settings: CalendarAccountSettings = { serverUrl, homeUrl, username, preset: input.preset ?? "custom" };
  const values = { displayName: (input.name ?? preset?.label ?? "").slice(0, 120), secret: encryptToken(password), settings, status: "connected", lastError: "" };
  const [row] = await requireDb().insert(schema.calendarAccounts).values({ userId: user.id, provider: "caldav", address, ...values })
    .onConflictDoUpdate({ target: [schema.calendarAccounts.userId, schema.calendarAccounts.provider, schema.calendarAccounts.address], set: values })
    .returning();
  return row;
}

/** Subscribe to an ICS link. It is fetched once first, so a link that is not a calendar is refused now. */
export async function connectIcs(user: Pick<CurrentUser, "id" | "email">, input: { url: string; name?: string }): Promise<AccountRow> {
  assertEncryption();
  const url = normalizeFeedUrl(input.url);
  const [cal] = await new IcsCalendar(url, publicFetch()).listCalendars();
  const u = new URL(url);
  // The address shown and used to recognise a re-subscription: host and path, never the query (tokens).
  const address = `${u.hostname}${u.pathname}`.toLowerCase().slice(0, 300);
  await checkAccountLimit(user, "ics", address);
  const values = { displayName: (input.name || cal?.name || u.hostname).slice(0, 120), secret: encryptToken(url), settings: { url: u.hostname }, status: "connected", lastError: "" };
  const [row] = await requireDb().insert(schema.calendarAccounts).values({ userId: user.id, provider: "ics", address, ...values })
    .onConflictDoUpdate({ target: [schema.calendarAccounts.userId, schema.calendarAccounts.provider, schema.calendarAccounts.address], set: values })
    .returning();
  return row;
}

/** Mark an account for reconnecting, with a reason a person can act on. */
export async function markNeedsReauth(accountId: number, message: string): Promise<void> {
  await requireDb().update(schema.calendarAccounts).set({ status: "needs_reauth", lastError: message.slice(0, 500) }).where(eq(schema.calendarAccounts.id, accountId));
}

/**
 * An access token for a Google or Microsoft account, refreshed and re-stored when it has expired.
 * A refusal marks the account `needs_reauth`: only signing in again fixes a revoked grant.
 */
async function accessToken(account: AccountRow): Promise<string> {
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() > Date.now() && account.accessToken) return decryptToken(account.accessToken);
  if (!account.refreshToken) {
    await markNeedsReauth(account.id, "Sign in again to keep this calendar connected.");
    throw new ProviderError("This calendar needs to be reconnected.", "auth");
  }
  try {
    const refresh = decryptToken(account.refreshToken);
    let t: TokenResponse;
    if (account.provider === "google") {
      const cfg = googleCalendarConfig("");
      if (!cfg) throw new ProviderError("Google Calendar is no longer set up on this server.", "auth");
      t = await googleRefresh(fetch, cfg, refresh);
    } else {
      const cfg = microsoftConfig("");
      if (!cfg) throw new ProviderError("Microsoft 365 is no longer set up on this server.", "auth");
      t = await microsoftRefresh(fetch, cfg, refresh);
    }
    await requireDb().update(schema.calendarAccounts).set({
      accessToken: encryptToken(t.access_token), tokenExpiresAt: expiry(t.expires_in),
      // Microsoft rotates refresh tokens; keep the newest.
      ...(t.refresh_token ? { refreshToken: encryptToken(t.refresh_token) } : {}),
      status: "connected", lastError: "",
    }).where(eq(schema.calendarAccounts.id, account.id));
    account.accessToken = encryptToken(t.access_token);
    account.tokenExpiresAt = expiry(t.expires_in);
    return t.access_token;
  } catch (e) {
    const auth = e instanceof ProviderError && e.kind === "auth";
    const message = describeFailure(e, 502, "calendar-token-refresh").message;
    if (auth) await markNeedsReauth(account.id, `Sign in again: ${message}`);
    throw auth ? new ProviderError("This calendar needs to be reconnected.", "auth") : e;
  }
}

/** A working provider for a stored account. */
export function providerFor(account: AccountRow): CalendarProvider {
  switch (account.provider) {
    case "google": return new GoogleCalendar(() => accessToken(account));
    case "microsoft": return new MicrosoftCalendar(() => accessToken(account), fetch, account.address);
    case "caldav": {
      const s = account.settings;
      return new CalDavCalendar({ serverUrl: s.serverUrl ?? "", homeUrl: s.homeUrl, username: s.username ?? account.address, password: decryptToken(account.secret), email: account.address.includes("@") ? account.address : "" }, publicFetch());
    }
    case "ics": return new IcsCalendar(decryptToken(account.secret), publicFetch());
    default: throw new Error(`Unknown calendar provider: ${account.provider}`);
  }
}

/** Delete an account; its calendars and events go with it. Push channels are stopped first (best effort). */
export async function disconnectAccount(userId: string, id: number, stop?: (account: AccountRow) => Promise<void>): Promise<void> {
  const account = await getAccount(userId, id);
  if (!account) return;
  if (stop) await stop(account).catch(() => undefined);
  await requireDb().delete(schema.calendarAccounts).where(and(eq(schema.calendarAccounts.id, id), eq(schema.calendarAccounts.userId, userId)));
}
