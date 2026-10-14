/**
 * Each person's calendar preferences: their zone, working hours, default calendar and meeting length,
 * a personal meeting-room link, and the morning auto-brief switch. Server only.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { canUse } from "@/lib/billing/entitlements";
import { isIanaZone } from "./tz";
import { normalizeWorkHours } from "./slots";
import { isUsableLink } from "./video";
import type { WorkHours } from "./types";

export type CalendarPrefs = {
  timezone: string;
  workHours: WorkHours;
  defaultCalendarId: number | null;
  defaultDuration: number;
  videoUrl: string;
  autoBrief: boolean;
  autoBriefLast: string;
};

export async function getPrefs(userId: string): Promise<CalendarPrefs> {
  const [row] = await requireDb().select().from(schema.calendarPrefs).where(eq(schema.calendarPrefs.userId, userId)).catch(() => []);
  return {
    timezone: row?.timezone && isIanaZone(row.timezone) ? row.timezone : "",
    workHours: normalizeWorkHours(row?.workHours),
    defaultCalendarId: row?.defaultCalendarId ?? null,
    defaultDuration: row?.defaultDuration ?? 30,
    videoUrl: row?.videoUrl ?? "",
    autoBrief: row?.autoBrief ?? false,
    autoBriefLast: row?.autoBriefLast ?? "",
  };
}

/** The zone to work in: the saved one, else the browser's (sent with the request), else UTC. */
export function zoneFor(prefs: Pick<CalendarPrefs, "timezone">, browserTz?: string | null): string {
  if (prefs.timezone) return prefs.timezone;
  if (browserTz && isIanaZone(browserTz)) return browserTz;
  return "UTC";
}

export type PrefsInput = Partial<{ timezone: string; workHours: unknown; defaultCalendarId: number | null; defaultDuration: number; videoUrl: string; autoBrief: boolean }>;

/** Save what changed. `email` is stored so background work can check the plan (see calendarPrefs). */
export async function savePrefs(userId: string, email: string, input: PrefsInput): Promise<CalendarPrefs> {
  const set: Partial<typeof schema.calendarPrefs.$inferInsert> = { email, updatedAt: new Date() };
  if (input.timezone !== undefined) {
    if (input.timezone && !isIanaZone(input.timezone)) throw new Error("That is not a time zone this server knows.");
    set.timezone = input.timezone;
  }
  if (input.workHours !== undefined) set.workHours = normalizeWorkHours(input.workHours);
  if (input.defaultCalendarId !== undefined) set.defaultCalendarId = input.defaultCalendarId;
  if (input.defaultDuration !== undefined) set.defaultDuration = Math.min(Math.max(Math.round(Number(input.defaultDuration)) || 30, 5), 480);
  if (input.videoUrl !== undefined) {
    if (input.videoUrl && !isUsableLink(input.videoUrl)) throw new Error("The meeting link must be an https:// address.");
    set.videoUrl = input.videoUrl.trim();
  }
  if (input.autoBrief !== undefined) set.autoBrief = input.autoBrief;
  await requireDb().insert(schema.calendarPrefs).values({ userId, ...set }).onConflictDoUpdate({ target: schema.calendarPrefs.userId, set });
  return getPrefs(userId);
}

/**
 * Whether a person may use a premium feature, from their id alone (background work has no session).
 * Their email (for the administrator bypass and Campus plans) comes from their profile, or from what
 * the calendar settings stored.
 */
export async function canUseById(userId: string, featureId: string): Promise<boolean> {
  const db = requireDb();
  const [p] = await db.select({ email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, userId)).catch(() => []);
  let email = p?.email ?? "";
  if (!email) {
    const [c] = await db.select({ email: schema.calendarPrefs.email }).from(schema.calendarPrefs).where(eq(schema.calendarPrefs.userId, userId)).catch(() => []);
    email = c?.email ?? "";
  }
  return canUse({ id: userId, email }, featureId);
}
