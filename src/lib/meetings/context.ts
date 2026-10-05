/**
 * What is known about a meeting beyond its audio: its title, who was invited or in it, and which
 * contacts and deals it concerns. Each source contributes what it knows and the pieces are merged.
 *
 * The sources on this branch use only what YouBank already has:
 * - the meeting app the desktop app detected and its window title ("Q3 review | Microsoft Teams");
 * - the participant list a notetaker bot reports;
 * - contacts and deals the person picked by hand.
 *
 * A calendar is the obvious richer source (the invite's title, attendees with emails, the meeting
 * link). It is built separately and is not a dependency here: it plugs in through
 * `registerContextSource` (see CALENDAR below and docs/meetings.md).
 */
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { dedupePeople, type Person } from "./match";
import { isMeetingUrl, platformOfUrl, type MeetingSettings, refusedBy } from "./model";

export type MeetingContext = {
  title: string;
  platform: string;
  meetingUrl: string;
  startsAt: string | null;
  endsAt: string | null;
  people: Person[];
  contactIds: number[];
  dealIds: number[];
  /** Which sources contributed, in order: "app", "bot", "manual", "calendar". */
  sources: string[];
};

/** What the caller already knows when it asks: the detected app and window, the bot's list, picks. */
export type ContextHint = { title?: string; platform?: string; meetingUrl?: string; people?: Person[]; contactIds?: number[]; dealIds?: number[] };

/** A meeting coming up, for auto-join rules (a calendar source provides these). */
export type UpcomingMeeting = { id: string; title: string; startsAt: string; endsAt: string | null; meetingUrl: string; people: Person[] };

export interface MeetingContextSource {
  id: string;
  /** What this source knows about the meeting this person is in at `at`, or null. */
  contextAt(userId: string, at: Date, hint: ContextHint): Promise<Partial<MeetingContext> | null>;
  /** Meetings starting within `windowMs` from now. Sources without a calendar leave this out. */
  upcoming?(userId: string, windowMs: number): Promise<UpcomingMeeting[]>;
}

/* ---------------- Pure helpers ---------------- */

/**
 * A meeting app's window or tab title without the app's own name: "Q3 review | Microsoft Teams" is
 * "Q3 review"; "Zoom Meeting" and "Meet - abc-defg-hij" (a bare meeting code) are no title. Pure.
 */
export function cleanAppTitle(raw: string): string {
  let t = raw.replace(/\p{Cc}/gu, "").replace(/\s+/g, " ").trim();
  t = t.replace(/\s+[-–—|]\s+(Google Chrome|Chromium|Mozilla Firefox|Firefox|Microsoft Edge|Safari|Brave|Arc|Opera)$/i, "");
  t = t.replace(/^\(\d+\)\s*/, "");
  t = t.replace(/^(Meet|Google Meet)\s*[-–—|:]\s*/i, "").replace(/\s*[-–—|]\s*(Microsoft Teams|Teams|Zoom|Zoom Workplace|Webex|Cisco Webex Meetings|Slack)$/i, "");
  t = t.replace(/^(Microsoft Teams|Zoom|Webex|Slack)\s*[-–—|:]\s*/i, "").replace(/^Huddle( with)?\s*/i, "");
  if (/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(t)) return ""; // a Meet code
  if (/^(zoom( meeting| workplace)?|meeting|meeting controls|microsoft teams|teams|webex|google meet|meet|slack|huddle|calls?)$/i.test(t)) return "";
  return t.slice(0, 200);
}

/** Merge what the sources said: the first title and link win, people and picks are combined. Pure. */
export function mergeContexts(parts: (Partial<MeetingContext> & { source: string })[]): MeetingContext {
  const out: MeetingContext = { title: "", platform: "", meetingUrl: "", startsAt: null, endsAt: null, people: [], contactIds: [], dealIds: [], sources: [] };
  for (const p of parts) {
    if (!p) continue;
    out.sources.push(p.source);
    out.title ||= (p.title ?? "").trim();
    out.platform ||= p.platform ?? "";
    out.meetingUrl ||= p.meetingUrl ?? "";
    out.startsAt ??= p.startsAt ?? null;
    out.endsAt ??= p.endsAt ?? null;
    out.people.push(...(p.people ?? []));
    out.contactIds.push(...(p.contactIds ?? []));
    out.dealIds.push(...(p.dealIds ?? []));
  }
  out.people = dedupePeople(out.people);
  out.contactIds = [...new Set(out.contactIds.filter((n) => Number.isInteger(n) && n > 0))];
  out.dealIds = [...new Set(out.dealIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!out.platform && out.meetingUrl) out.platform = platformOfUrl(out.meetingUrl) ?? "";
  return out;
}

/**
 * Which upcoming meetings an auto-join rule should send the notetaker to now: those with a joinable
 * link, starting within the next `leadMs`, not refused by the person's never-record settings, and not
 * already sent. Pure.
 */
export function autoJoinDue(upcoming: UpcomingMeeting[], settings: Pick<MeetingSettings, "autoJoin" | "neverApps" | "neverKeywords">, alreadySent: Set<string>, now = Date.now(), leadMs = 3 * 60_000): UpcomingMeeting[] {
  if (!settings.autoJoin) return [];
  return upcoming.filter((m) => {
    const t = Date.parse(m.startsAt);
    if (!Number.isFinite(t) || t - now > leadMs || now - t > 15 * 60_000) return false;
    if (!isMeetingUrl(m.meetingUrl) || alreadySent.has(m.id)) return false;
    return !refusedBy(settings, platformOfUrl(m.meetingUrl) ?? "", m.title);
  });
}

/* ---------------- The sources on this branch ---------------- */

/** The app the desktop detected, and its window title. */
export const appSource: MeetingContextSource = {
  id: "app",
  async contextAt(_userId, _at, hint) {
    if (!hint.title && !hint.platform) return null;
    return { title: cleanAppTitle(hint.title ?? ""), platform: hint.platform ?? "", meetingUrl: hint.meetingUrl ?? "" };
  },
};

/** The participant list a notetaker bot reported. */
export const botSource: MeetingContextSource = {
  id: "bot",
  async contextAt(_userId, _at, hint) {
    return hint.people?.length ? { people: hint.people } : null;
  },
};

/** Contacts and deals the person picked, with the picked contacts as known people. */
export const manualSource: MeetingContextSource = {
  id: "manual",
  async contextAt(userId, _at, hint) {
    const contactIds = (hint.contactIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 50);
    const dealIds = (hint.dealIds ?? []).filter((n) => Number.isInteger(n) && n > 0).slice(0, 20);
    if (!contactIds.length && !dealIds.length) return null;
    const db = requireDb();
    const [contacts, deals] = await Promise.all([
      contactIds.length ? db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email }).from(schema.crmContacts)
        .where(and(eq(schema.crmContacts.userId, userId), inArray(schema.crmContacts.id, contactIds))) : [],
      dealIds.length ? db.select({ id: schema.crmDeals.id }).from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, userId), inArray(schema.crmDeals.id, dealIds))) : [],
    ]);
    return { people: contacts.map((c) => ({ name: c.name, email: c.email })), contactIds: contacts.map((c) => c.id), dealIds: deals.map((d) => d.id) };
  },
};

/*
 * ======================= CALENDAR =======================
 * The calendar integration (built on its own branch) exposes getMeetingAt(userId, time) and
 * getUpcomingMeetings(userId, window). To use it, in that integration's code (not here):
 *
 *   registerContextSource({
 *     id: "calendar",
 *     contextAt: async (userId, at) => {
 *       const m = await getMeetingAt(userId, at);
 *       return m ? { title: m.title, meetingUrl: m.joinUrl, startsAt: m.start, endsAt: m.end, people: m.attendees } : null;
 *     },
 *     upcoming: async (userId, windowMs) => (await getUpcomingMeetings(userId, windowMs)).map(toUpcoming),
 *   });
 *
 * A registered calendar source is asked first, so an invite's title and attendees (with emails, which
 * match contacts for certain) win over a window title. Its `upcoming` is what auto-join rules use.
 * ========================================================
 */
const registered: MeetingContextSource[] = [];

/** Add a source (the calendar, when present). Asked before the built-in ones, once each. */
export function registerContextSource(source: MeetingContextSource): void {
  if (!registered.some((s) => s.id === source.id)) registered.push(source);
}

export const contextSources = (): MeetingContextSource[] => [...registered, appSource, botSource, manualSource];

/** Everything the sources know about a meeting, merged. A source that fails is skipped. */
export async function meetingContext(userId: string, at: Date, hint: ContextHint): Promise<MeetingContext> {
  const parts = await Promise.all(contextSources().map(async (s) => {
    const c = await s.contextAt(userId, at, hint).catch(() => null);
    return c ? { ...c, source: s.id } : null;
  }));
  return mergeContexts(parts.filter((p): p is Partial<MeetingContext> & { source: string } => !!p));
}

/** Upcoming meetings from every source that knows any (none until a calendar is registered). */
export async function upcomingMeetings(userId: string, windowMs: number): Promise<UpcomingMeeting[]> {
  const lists = await Promise.all(contextSources().map((s) => s.upcoming?.(userId, windowMs).catch(() => []) ?? Promise.resolve([])));
  return lists.flat();
}
