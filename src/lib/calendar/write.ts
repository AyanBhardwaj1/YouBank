/**
 * Creating, rescheduling and cancelling meetings. Server only; free.
 *
 * Every write goes to the provider first and the stored copy follows, so YouBank never shows a
 * meeting that is not really in the person's calendar. After a write the calendar is re-synced: that
 * picks up what the provider added (a Meet link, Graph's ids, a CalDAV series' other occurrences).
 *
 * Invitations go out only when the person leaves "Send invitations" on, and are sent by the provider
 * itself (Google sendUpdates, Graph, CalDAV scheduling), so they come from the person's own address.
 */
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { getAccount, providerFor, type CalendarRow } from "./accounts";
import { getMeeting, eventWithAccount, type Meeting } from "./meetings";
import { getPrefs, zoneFor } from "./prefs";
import { ProviderError } from "./provider";
import { applyPage, loadLinkContext, syncCalendar } from "./sync";
import { syncWindow, type ChangeScope, type EventRef } from "./types";
import { isUsableLink } from "./video";

const plain = (message: string) => Object.assign(new Error(message), { status: 400 });

export type CreateInput = {
  calendarId?: number | null;
  title: string;
  description?: string;
  location?: string;
  start: string;
  end: string;
  attendees?: { email: string; name?: string }[];
  videoUrl?: string;
  addConference?: boolean;
  sendInvites?: boolean;
  browserTz?: string | null;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

function times(startIso: string, endIso: string): { start: Date; end: Date } {
  const start = new Date(startIso), end = new Date(endIso);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) throw plain("Pick a start and an end time.");
  if (end <= start) throw plain("The meeting has to end after it starts.");
  if (end.getTime() - start.getTime() > 24 * 3_600_000) throw plain("A meeting can be at most 24 hours long.");
  return { start, end };
}

/** The calendar to write to: the one asked for, else the default, else the first writable primary. */
async function targetCalendar(userId: string, calendarId?: number | null): Promise<CalendarRow> {
  const db = requireDb();
  const C = schema.calendarCalendars;
  const writable = await db.select().from(C).where(and(eq(C.userId, userId), eq(C.canWrite, true))).orderBy(desc(C.isPrimary), C.id);
  if (!writable.length) throw plain("Connect a calendar you can write to (Google, Microsoft 365 or CalDAV) first.");
  const prefs = await getPrefs(userId);
  const pick = writable.find((c) => c.id === calendarId) ?? writable.find((c) => c.id === prefs.defaultCalendarId) ?? writable[0];
  if (calendarId && pick.id !== calendarId) throw plain("That calendar cannot be written to.");
  return pick;
}

export async function createMeeting(user: Pick<CurrentUser, "id" | "email">, input: CreateInput): Promise<Meeting | null> {
  const title = input.title.trim().slice(0, 300);
  if (!title) throw plain("Give the meeting a title.");
  const { start, end } = times(input.start, input.end);
  const attendees = (input.attendees ?? []).map((a) => ({ email: a.email.trim().toLowerCase(), name: a.name?.trim().slice(0, 120) })).filter((a) => a.email);
  const bad = attendees.find((a) => !EMAIL.test(a.email));
  if (bad) throw plain(`"${bad.email}" is not an email address.`);
  if (attendees.length > 100) throw plain("At most 100 people can be invited from here.");
  if (input.videoUrl && !isUsableLink(input.videoUrl)) throw plain("The video link must be an https:// address.");

  const cal = await targetCalendar(user.id, input.calendarId);
  const account = await getAccount(user.id, cal.accountId);
  if (!account) throw plain("That calendar is no longer connected.");
  if (account.status === "needs_reauth") throw plain("That calendar needs to be reconnected first (Settings, Calendar).");
  const prefs = await getPrefs(user.id);
  const provider = providerFor(account);
  const created = await provider.createEvent({ remoteId: cal.remoteId, timezone: cal.timezone || zoneFor(prefs, input.browserTz) }, {
    title, description: input.description?.slice(0, 8000), location: input.location?.slice(0, 500), start, end,
    timezone: zoneFor(prefs, input.browserTz), attendees, videoUrl: input.videoUrl?.trim() || undefined, addConference: !!input.addConference,
  }, { sendInvites: input.sendInvites !== false, organizerEmail: account.address.includes("@") ? account.address : user.email });

  // Store it at once so the view shows it, then let a sync fill in whatever the provider added.
  const ctx = await loadLinkContext(user.id);
  await applyPage(user.id, cal, { upserts: created ? [created] : [], removed: [], replacedGroups: [], full: false, nextToken: null }, syncWindow(), ctx);
  await syncCalendar(user.id, provider, cal, ctx).catch(() => undefined);
  if (!created) return null;
  const [row] = await requireDb().select({ id: schema.calendarEvents.id }).from(schema.calendarEvents)
    .where(and(eq(schema.calendarEvents.calendarId, cal.id), eq(schema.calendarEvents.remoteId, created.remoteId.slice(0, 1000))));
  return row ? getMeeting(user.id, row.id) : null;
}

export type ChangeInput = { start?: string; end?: string; title?: string; description?: string; location?: string; videoUrl?: string; attendees?: { email: string; name?: string }[]; scope?: ChangeScope; sendInvites?: boolean };

async function writable(userId: string, eventId: number) {
  const found = await eventWithAccount(userId, eventId);
  if (!found) throw Object.assign(new Error("That meeting is not in your calendar any more."), { status: 404 });
  if (!found.cal.canWrite) throw plain("That calendar is read-only here. Change the meeting where it was created.");
  if (found.account.status === "needs_reauth") throw plain("That calendar needs to be reconnected first (Settings, Calendar).");
  const e = found.e;
  const ref: EventRef = { remoteId: e.remoteId, icalUid: e.icalUid, recurrenceId: e.recurrenceId, seriesId: e.seriesId, etag: e.etag, href: e.href };
  return { ...found, ref, provider: providerFor(found.account) };
}

const conflict = (e: unknown) => e instanceof ProviderError && e.kind === "conflict" ? Object.assign(new Error(e.message), { status: 409 }) : e;

/** Reschedule or edit. For a series, `scope` says whether this occurrence or all of them move. */
export async function changeMeeting(userId: string, eventId: number, input: ChangeInput): Promise<Meeting | null> {
  const w = await writable(userId, eventId);
  const scope: ChangeScope = input.scope === "series" && (w.e.seriesId || w.e.recurrenceId) ? "series" : "instance";
  const patch: Parameters<typeof w.provider.updateEvent>[2] = {};
  if (input.start || input.end) {
    const { start, end } = times(input.start ?? w.e.startsAt.toISOString(), input.end ?? w.e.endsAt.toISOString());
    if (scope === "series") patch.shiftMs = start.getTime() - w.e.startsAt.getTime();
    else { patch.start = start; patch.end = end; }
    if (scope === "series" && end.getTime() - start.getTime() !== w.e.endsAt.getTime() - w.e.startsAt.getTime()) throw plain("To change the length of every meeting in a series, change it where the series was created.");
  }
  if (input.title !== undefined) patch.title = input.title.trim().slice(0, 300) || w.e.title;
  if (input.description !== undefined) patch.description = input.description.slice(0, 8000);
  if (input.location !== undefined) patch.location = input.location.slice(0, 500);
  if (input.videoUrl !== undefined) {
    if (input.videoUrl && !isUsableLink(input.videoUrl)) throw plain("The video link must be an https:// address.");
    patch.videoUrl = input.videoUrl;
  }
  if (input.attendees) patch.attendees = input.attendees.filter((a) => EMAIL.test(a.email.trim())).map((a) => ({ email: a.email.trim().toLowerCase(), name: a.name }));
  try {
    await w.provider.updateEvent({ remoteId: w.cal.remoteId, timezone: w.cal.timezone }, w.ref, patch, { sendInvites: input.sendInvites !== false, scope });
  } catch (e) {
    throw conflict(e);
  }
  await syncCalendar(userId, w.provider, w.cal, await loadLinkContext(userId)).catch(() => undefined);
  return getMeeting(userId, eventId);
}

/** Cancel this occurrence, or the whole series. Attendees are told when `sendInvites` is on. */
export async function cancelMeeting(userId: string, eventId: number, input: { scope?: ChangeScope; sendInvites?: boolean } = {}): Promise<void> {
  const w = await writable(userId, eventId);
  const scope: ChangeScope = input.scope === "series" && (w.e.seriesId || w.e.recurrenceId) ? "series" : "instance";
  try {
    await w.provider.deleteEvent({ remoteId: w.cal.remoteId, timezone: w.cal.timezone }, w.ref, { sendInvites: input.sendInvites !== false, scope });
  } catch (e) {
    throw conflict(e);
  }
  const E = schema.calendarEvents;
  await requireDb().delete(E).where(scope === "series" && w.e.groupKey ? and(eq(E.calendarId, w.cal.id), eq(E.icalUid, w.e.icalUid)) : eq(E.id, eventId));
  await syncCalendar(userId, w.provider, w.cal, await loadLinkContext(userId)).catch(() => undefined);
}
