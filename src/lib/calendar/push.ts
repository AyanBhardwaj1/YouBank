/**
 * Push notifications from Google and Microsoft, so a change in someone's calendar reaches YouBank in
 * seconds rather than at the next poll. Server only.
 *
 * Each shown calendar on a Google or Microsoft account gets a channel (Google events.watch, up to 7
 * days) or subscription (Graph, under 3 days) pointing at /api/calendar/webhooks/<provider>. A random
 * secret travels with it (Google's channel token, Graph's clientState) and is checked on every
 * notification; it is stored encrypted. Channels are created after a sync and renewed by the cron a
 * day before they lapse. Polling stays on as the fallback, so a lost channel costs only latency.
 *
 * Not used when the app is not reachable from the internet (localhost), or when CALENDAR_PUSH=off.
 */
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CalendarPush } from "@/db/schema";
import { decryptToken, encryptToken, secretsMatch } from "@/lib/crm/crypto";
import { providerFor, type AccountRow, type CalendarRow } from "./accounts";
import { canPush, type CalendarProvider } from "./provider";

const RENEW_BEFORE = 24 * 3_600_000;

/** Whether this deployment can receive webhooks at `origin`. */
export function pushEnabled(origin: string): boolean {
  if ((process.env.CALENDAR_PUSH ?? "").toLowerCase() === "off") return false;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && !/^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname);
  } catch {
    return false;
  }
}

/** The public base URL for webhooks: CALENDAR_PUSH_URL, APP_URL, or the request's origin. */
export function pushOrigin(requestOrigin: string): string {
  return (process.env.CALENDAR_PUSH_URL || process.env.APP_URL || requestOrigin).replace(/\/$/, "");
}

/** Create or renew the channel for one calendar when it is missing or about to lapse. */
export async function ensurePush(account: AccountRow, cal: CalendarRow, provider: CalendarProvider, origin: string, now = Date.now()): Promise<"skipped" | "kept" | "created" | "renewed"> {
  if (!canPush(provider) || !pushEnabled(origin) || (account.provider !== "google" && account.provider !== "microsoft")) return "skipped";
  const db = requireDb();
  const current = cal.push;
  if (current && Date.parse(current.expiresAt) - now > RENEW_BEFORE) return "kept";
  const ref = { remoteId: cal.remoteId, timezone: cal.timezone };
  if (current && provider.renew) {
    const renewed = await provider.renew({ id: current.id, resourceId: current.resourceId, expiresAt: current.expiresAt }, ref).catch(() => null);
    if (renewed) {
      await db.update(schema.calendarCalendars).set({ push: { ...current, expiresAt: renewed.expiresAt } }).where(eq(schema.calendarCalendars.id, cal.id));
      return "renewed";
    }
  }
  if (current) await provider.unwatch({ id: current.id, resourceId: current.resourceId, expiresAt: current.expiresAt }).catch(() => undefined);
  const secret = randomBytes(24).toString("base64url");
  const channel = await provider.watch(ref, `${origin}/api/calendar/webhooks/${account.provider}`, secret);
  const push: CalendarPush = { kind: account.provider, id: channel.id, resourceId: channel.resourceId, expiresAt: channel.expiresAt, secret: encryptToken(secret) };
  await db.update(schema.calendarCalendars).set({ push, pushId: channel.id }).where(eq(schema.calendarCalendars.id, cal.id));
  return "created";
}

/** Stop every channel on an account (before a disconnect). */
export async function stopPush(account: AccountRow): Promise<void> {
  const provider = providerFor(account);
  if (!canPush(provider)) return;
  const cals = await requireDb().select().from(schema.calendarCalendars).where(eq(schema.calendarCalendars.accountId, account.id));
  for (const c of cals) if (c.push) await provider.unwatch({ id: c.push.id, resourceId: c.push.resourceId, expiresAt: c.push.expiresAt }).catch(() => undefined);
}

/**
 * The calendar a notification is for, if its secret matches. Null for anything unknown or forged;
 * callers answer those with a plain 200/202 so a prober learns nothing.
 */
export async function calendarForPush(kind: "google" | "microsoft", channelId: string, secret: string): Promise<CalendarRow | null> {
  if (!channelId || !secret) return null;
  const [cal] = await requireDb().select().from(schema.calendarCalendars).where(eq(schema.calendarCalendars.pushId, channelId));
  if (!cal?.push || cal.push.kind !== kind) return null;
  let expected = "";
  try { expected = decryptToken(cal.push.secret); } catch { return null; }
  return secretsMatch(secret, expected) ? cal : null;
}
