/**
 * Real availability, for the scheduler and for the email agent. Server only, and free: free/busy
 * reads cost nothing.
 *
 * Busy time is asked of each provider live (Google freeBusy, Graph getSchedule, CalDAV reads), so a
 * meeting booked a minute ago counts, and falls back to the stored events when a provider does not
 * answer. ICS subscriptions count too: a published team calendar blocks time like any other.
 */
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { listAccounts, providerFor } from "./accounts";
import { canUseById, getPrefs, zoneFor } from "./prefs";
import { findSlots as findFree, formatSlot, mergeIntervals, zoneLabel } from "./slots";
import type { Interval } from "./types";

/** Busy intervals across all of a person's shown calendars. */
export async function busyFor(userId: string, window: Interval): Promise<{ busy: Interval[]; live: boolean }> {
  const db = requireDb();
  const accounts = (await listAccounts(userId)).filter((a) => a.status === "connected");
  const busy: Interval[] = [];
  let live = accounts.length > 0;
  const stored = async (accountId: number) => {
    const rows = await db.select({ s: schema.calendarEvents.startsAt, e: schema.calendarEvents.endsAt })
      .from(schema.calendarEvents).innerJoin(schema.calendarCalendars, eq(schema.calendarCalendars.id, schema.calendarEvents.calendarId))
      .where(and(eq(schema.calendarCalendars.accountId, accountId), eq(schema.calendarCalendars.visible, true), eq(schema.calendarEvents.busy, true), eq(schema.calendarEvents.allDay, false),
        sql`${schema.calendarEvents.status} <> 'cancelled'`, lt(schema.calendarEvents.startsAt, new Date(window.end)), gt(schema.calendarEvents.endsAt, new Date(window.start))));
    return rows.map((r) => ({ start: r.s.getTime(), end: r.e.getTime() }));
  };
  await Promise.all(accounts.map(async (a) => {
    const cals = await db.select().from(schema.calendarCalendars).where(and(eq(schema.calendarCalendars.accountId, a.id), eq(schema.calendarCalendars.visible, true)));
    if (!cals.length) return;
    if (a.provider === "ics") { busy.push(...await stored(a.id)); return; }
    try {
      busy.push(...await providerFor(a).freeBusy(cals.map((c) => ({ remoteId: c.remoteId, timezone: c.timezone })), window));
    } catch {
      live = false;
      busy.push(...await stored(a.id));
    }
  }));
  return { busy: mergeIntervals(busy), live };
}

export type SlotRequest = { durationMin?: number; days?: number; from?: Date; max?: number; browserTz?: string | null };

/** Free times for a new meeting, on the person's own clock and working hours. */
export async function findSlots(userId: string, req: SlotRequest = {}): Promise<{ slots: { start: string; end: string; label: string }[]; timezone: string; live: boolean }> {
  const prefs = await getPrefs(userId);
  const tz = zoneFor(prefs, req.browserTz);
  const from = (req.from ?? new Date()).getTime();
  const to = from + Math.min(Math.max(req.days ?? 10, 1), 30) * 86_400_000;
  const { busy, live } = await busyFor(userId, { start: from, end: to });
  const slots = findFree({ busy, from, to, durationMin: req.durationMin ?? prefs.defaultDuration, timezone: tz, workHours: prefs.workHours, maxSlots: Math.min(req.max ?? 6, 20) });
  return { slots: slots.map((s) => ({ start: new Date(s.start).toISOString(), end: new Date(s.end).toISOString(), label: formatSlot(s, tz) })), timezone: tz, live };
}

/** Words that mean the email is about finding a time. */
const ABOUT_TIME = /\b(meet|meeting|call|catch up|catch-up|chat|coffee|zoom|schedule|availability|available|free (?:on|next|this)|time (?:to|that) works|calendar|slot)\b/i;

/**
 * For the Relationships email agent: a short availability note to put in a draft's instructions, when
 * the thread is about finding a time, the person has a calendar connected and their plan includes
 * smart scheduling. Empty otherwise. It never sends anything and never books anything.
 */
export async function schedulingNote(userId: string, text: string, opts: { category?: string } = {}): Promise<string> {
  if (opts.category !== "scheduling" && !ABOUT_TIME.test(text)) return "";
  const db = requireDb();
  const [any] = await db.select({ id: schema.calendarAccounts.id }).from(schema.calendarAccounts).where(and(eq(schema.calendarAccounts.userId, userId), eq(schema.calendarAccounts.status, "connected"))).limit(1).catch(() => []);
  if (!any) return "";
  if (!(await canUseById(userId, "calendar.smart_scheduling"))) return "";
  const { slots, timezone } = await findSlots(userId, { durationMin: 30, days: 7, max: 4 });
  if (!slots.length) return "";
  return [
    `The reader's real availability for a 30-minute meeting (${zoneLabel(timezone)}), from their calendar:`,
    ...slots.map((s) => `- ${s.label}`),
    "The reader authorises proposing these times. If the email should suggest when to meet, offer two or three of them in the reader's time zone and ask which suits. Do not claim a meeting is booked, and do not offer any other time.",
  ].join("\n");
}
