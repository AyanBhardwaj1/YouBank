import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { listAccounts, providerSetup, toSafe } from "@/lib/calendar/accounts";
import { getPrefs } from "@/lib/calendar/prefs";
import { CALDAV_PRESETS } from "@/lib/calendar/providers/caldav";

export const dynamic = "force-dynamic";

/**
 * Everything the Calendar settings and view need to start: connected accounts (never their secrets),
 * their calendars, the person's preferences, and which ways of connecting this server supports.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const origin = new URL(req.url).origin;
    const [accounts, calendars, prefs] = await Promise.all([
      listAccounts(user.id),
      requireDb().select().from(schema.calendarCalendars).where(eq(schema.calendarCalendars.userId, user.id)).orderBy(asc(schema.calendarCalendars.accountId), asc(schema.calendarCalendars.id)),
      getPrefs(user.id),
    ]);
    return NextResponse.json({
      accounts: accounts.map(toSafe),
      calendars: calendars.map((c) => ({ id: c.id, accountId: c.accountId, name: c.name, color: c.color, timezone: c.timezone, canWrite: c.canWrite, primary: c.isPrimary, visible: c.visible, lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null, push: !!c.push })),
      prefs,
      setup: providerSetup(origin),
      presets: Object.fromEntries(Object.entries(CALDAV_PRESETS).map(([k, p]) => [k, { label: p.label, url: p.url, appPasswordUrl: p.appPasswordUrl, note: p.note }])),
    });
  });
}
