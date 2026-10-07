/**
 * Reading meetings back out: the calendar view, what a contact or deal has coming up, and the small
 * stable API the meeting copilot uses. Server only; reads the database, never a provider.
 *
 * Copilot contract (documented in docs/calendar.md; keep it backward compatible):
 * - getMeetingAt(userId, time) → the meeting happening at `time` (or starting within ten minutes), or null.
 * - getUpcomingMeetings(userId, window) → meetings starting in the window, soonest first.
 * Both return `Meeting`: the event, its attendees with any linked contact, the linked contacts and
 * deals, and the video link with its provider name.
 */
import { and, asc, eq, gt, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CalendarAttendee } from "@/db/schema";
import { normalizeEmail } from "./match";
import { videoProvider } from "./video";
import type { ProviderId } from "./types";

export type EventRow = typeof schema.calendarEvents.$inferSelect;

export type MeetingContact = { id: number; email: string; name: string; title: string; company: string };
export type MeetingDeal = { id: number; name: string; stage: string; status: string };

export type Meeting = {
  id: number;
  calendarId: number;
  calendarName: string;
  color: string;
  provider: ProviderId;
  canWrite: boolean;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  allDay: boolean;
  timezone: string;
  status: string;
  busy: boolean;
  /** One occurrence of a recurring series. */
  recurring: boolean;
  organizer: CalendarAttendee | null;
  attendees: (CalendarAttendee & { contactId: number | null })[];
  contacts: MeetingContact[];
  deals: MeetingDeal[];
  external: boolean;
  videoUrl: string;
  videoProvider: string;
  htmlLink: string;
};

type Joined = { e: EventRow; c: { name: string; color: string; canWrite: boolean; accountId: number }; provider: string };

async function enrich(userId: string, rows: Joined[]): Promise<Meeting[]> {
  const db = requireDb();
  const contactIds = [...new Set(rows.flatMap((r) => r.e.contactIds))];
  const dealIds = [...new Set(rows.flatMap((r) => r.e.dealIds))];
  const [contacts, deals] = await Promise.all([
    contactIds.length ? db.select({ id: schema.crmContacts.id, email: schema.crmContacts.email, name: schema.crmContacts.name, title: schema.crmContacts.title, company: schema.crmContacts.company })
      .from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, userId), inArray(schema.crmContacts.id, contactIds))).catch(() => []) : Promise.resolve([]),
    dealIds.length ? db.select({ id: schema.crmDeals.id, name: schema.crmDeals.name, stage: schema.crmDeals.stage, status: schema.crmDeals.status })
      .from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.id, dealIds))).catch(() => []) : Promise.resolve([]),
  ]);
  const cById = new Map(contacts.map((c) => [c.id, c]));
  const byEmail = new Map(contacts.map((c) => [normalizeEmail(c.email), c.id]));
  const dById = new Map(deals.map((d) => [d.id, d]));
  return rows.map(({ e, c, provider }) => ({
    id: e.id, calendarId: e.calendarId, calendarName: c.name, color: c.color, provider: provider as ProviderId, canWrite: c.canWrite,
    title: e.title, description: e.description, location: e.location, start: e.startsAt.toISOString(), end: e.endsAt.toISOString(), allDay: e.allDay, timezone: e.timezone,
    status: e.status, busy: e.busy, recurring: !!e.recurrenceId, organizer: e.organizer,
    attendees: e.attendees.map((a) => ({ ...a, contactId: byEmail.get(normalizeEmail(a.email)) ?? null })),
    contacts: e.contactIds.map((id) => cById.get(id)).filter((x): x is MeetingContact => !!x),
    deals: e.dealIds.map((id) => dById.get(id)).filter((x): x is MeetingDeal => !!x),
    external: e.external, videoUrl: e.videoUrl, videoProvider: videoProvider(e.videoUrl), htmlLink: e.htmlLink,
  }));
}

const E = schema.calendarEvents, C = schema.calendarCalendars, A = schema.calendarAccounts;

/** Events with their calendar and account, the shape every reader here starts from. */
const selectJoined = () => requireDb().select({ e: E, c: { name: C.name, color: C.color, canWrite: C.canWrite, accountId: C.accountId }, provider: A.provider })
  .from(E).innerJoin(C, eq(C.id, E.calendarId)).innerJoin(A, eq(A.id, C.accountId));

/** Every shown event overlapping [from, to), for the calendar view. */
export async function listMeetings(userId: string, from: Date, to: Date, limit = 2000): Promise<Meeting[]> {
  const rows = await selectJoined()
    .where(and(eq(E.userId, userId), eq(C.visible, true), sql`${E.status} <> 'cancelled'`, lt(E.startsAt, to), gt(E.endsAt, from)))
    .orderBy(asc(E.startsAt)).limit(limit);
  return enrich(userId, rows);
}

export async function getMeeting(userId: string, id: number): Promise<Meeting | null> {
  const rows = await selectJoined().where(and(eq(E.userId, userId), eq(E.id, id)));
  return rows.length ? (await enrich(userId, rows))[0] : null;
}

/** The stored row behind a meeting, with its calendar and account, for writes. */
export async function eventWithAccount(userId: string, id: number) {
  const [row] = await requireDb().select({ e: E, cal: C, account: A }).from(E).innerJoin(C, eq(C.id, E.calendarId)).innerJoin(A, eq(A.id, C.accountId))
    .where(and(eq(E.userId, userId), eq(E.id, id)));
  return row ?? null;
}

/**
 * The meeting at `time`: one in progress, or starting within `leadMinutes`. When several overlap, the
 * one with a video link wins (that is the one being joined), then the one that started most recently.
 * All-day events and events marked free are never "the meeting".
 */
export async function getMeetingAt(userId: string, time: Date, opts: { leadMinutes?: number } = {}): Promise<Meeting | null> {
  const lead = (opts.leadMinutes ?? 10) * 60_000;
  const rows = await selectJoined()
    .where(and(eq(E.userId, userId), eq(C.visible, true), sql`${E.status} <> 'cancelled'`, eq(E.allDay, false), eq(E.busy, true),
      lte(E.startsAt, new Date(time.getTime() + lead)), gt(E.endsAt, time)))
    .orderBy(asc(E.startsAt)).limit(20);
  if (!rows.length) return null;
  const score = (r: Joined) => (r.e.videoUrl ? 1e15 : 0) + Math.min(r.e.startsAt.getTime(), time.getTime());
  const best = [...rows].sort((a, b) => score(b) - score(a))[0];
  return (await enrich(userId, [best]))[0];
}

/** Meetings starting in the window, soonest first. Defaults to the next 24 hours. */
export async function getUpcomingMeetings(userId: string, window: { from?: Date; to?: Date; hours?: number; limit?: number } = {}): Promise<Meeting[]> {
  const from = window.from ?? new Date();
  const to = window.to ?? new Date(from.getTime() + (window.hours ?? 24) * 3_600_000);
  const rows = await selectJoined()
    .where(and(eq(E.userId, userId), eq(C.visible, true), sql`${E.status} <> 'cancelled'`, gte(E.startsAt, from), lt(E.startsAt, to)))
    .orderBy(asc(E.startsAt)).limit(Math.min(window.limit ?? 50, 200));
  return enrich(userId, rows);
}

/** Meetings with a contact or about a deal: upcoming ones and the most recent past ones. */
export async function meetingsFor(userId: string, target: { contactId?: number; dealId?: number }, opts: { past?: number; upcoming?: number } = {}): Promise<{ upcoming: Meeting[]; past: Meeting[] }> {
  const cond = target.contactId ? sql`${E.contactIds} @> ${JSON.stringify([target.contactId])}::jsonb` : sql`${E.dealIds} @> ${JSON.stringify([target.dealId ?? -1])}::jsonb`;
  const base = selectJoined;
  const now = new Date();
  const [up, past] = await Promise.all([
    base().where(and(eq(E.userId, userId), sql`${E.status} <> 'cancelled'`, cond, gte(E.endsAt, now))).orderBy(asc(E.startsAt)).limit(opts.upcoming ?? 5),
    base().where(and(eq(E.userId, userId), sql`${E.status} <> 'cancelled'`, cond, lt(E.endsAt, now))).orderBy(sql`${E.startsAt} desc`).limit(opts.past ?? 3),
  ]);
  return { upcoming: await enrich(userId, up), past: await enrich(userId, past) };
}

export type MeetingSummary = { lastMet: string | null; nextMeeting: { id: number; title: string; start: string } | null; upcoming: number };

/**
 * "Last met" and "next meeting" for every linked contact and deal, in one query, for the Contacts and
 * Pipeline tabs. Declined meetings still count: the invitation went out.
 */
export async function meetingSummaries(userId: string): Promise<{ contacts: Record<number, MeetingSummary>; deals: Record<number, MeetingSummary> }> {
  const rows = await requireDb().select({ id: E.id, title: E.title, startsAt: E.startsAt, endsAt: E.endsAt, contactIds: E.contactIds, dealIds: E.dealIds })
    .from(E).where(and(eq(E.userId, userId), sql`${E.status} <> 'cancelled'`, eq(E.allDay, false), sql`(jsonb_array_length(${E.contactIds}) > 0 or jsonb_array_length(${E.dealIds}) > 0)`))
    .orderBy(asc(E.startsAt)).limit(5000);
  const now = Date.now();
  const contacts: Record<number, MeetingSummary> = {}, deals: Record<number, MeetingSummary> = {};
  const touch = (map: Record<number, MeetingSummary>, key: number, r: (typeof rows)[number]) => {
    const s = (map[key] ??= { lastMet: null, nextMeeting: null, upcoming: 0 });
    if (r.endsAt.getTime() < now) s.lastMet = r.startsAt.toISOString();
    else {
      s.upcoming++;
      if (!s.nextMeeting) s.nextMeeting = { id: r.id, title: r.title, start: r.startsAt.toISOString() };
    }
  };
  for (const r of rows) {
    for (const id of r.contactIds) touch(contacts, id, r);
    for (const id of r.dealIds) touch(deals, id, r);
  }
  return { contacts, deals };
}
