/**
 * What the meeting pages and the desktop app read: one meeting with everything around it, the list
 * with what the person may use, and contact and deal search for the pickers.
 */
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { entitlements } from "@/lib/billing/entitlements";
import { MEETINGS_FEATURES } from "@/lib/billing/features/meetings";
import { botProvider } from "./bot";
import type { MeetingNotes } from "./model";
import { notesAllowance, syncBot } from "./pipeline";
import { getMeeting, getMeetingSettings, listMeetings, meetingLinks, transcriptOf, type MeetingRow } from "./store";
import { turns } from "./stitch";
import { pickTranscriber } from "./transcribe";

type User = { id: string; email: string; name: string };

/** The parts of a meeting row a page may see (no device id, no cached brief). */
export function publicMeeting(m: MeetingRow) {
  return {
    id: m.id, title: m.title, platform: m.platform, source: m.source, status: m.status, meetingUrl: m.meetingUrl,
    bot: { status: m.bot.status ?? null, joinedAt: m.bot.joinedAt ?? null, error: m.bot.error ?? null },
    participants: m.participants, consent: m.consent, live: { on: !!m.live.on, minutes: m.live.minutes ?? 0 },
    notes: (m.notes as MeetingNotes | null) ?? null, notesAt: m.notesAt, transcriber: m.transcriber, durationSec: m.durationSec,
    error: m.error, startedAt: m.startedAt, endedAt: m.endedAt, purgedAt: m.purgedAt,
  };
}

/** One meeting for its page: transcript (speaker-labelled where known), links, proposals, drafts. */
export async function meetingDetail(user: User, id: number) {
  const db = requireDb();
  let m = await getMeeting(user.id, id);
  if (m.source === "bot") m = await syncBot(user, m).catch(() => m);
  const [segments, links, actions, drafts] = await Promise.all([
    transcriptOf(m),
    meetingLinks(m.id),
    db.select().from(schema.crmActions).where(and(eq(schema.crmActions.userId, user.id), eq(schema.crmActions.meetingId, m.id))).orderBy(desc(schema.crmActions.createdAt)),
    db.select({ id: schema.crmDrafts.id, subject: schema.crmDrafts.subject, body: schema.crmDrafts.body, status: schema.crmDrafts.status, toAddresses: schema.crmDrafts.toAddresses, contactId: schema.crmDrafts.contactId })
      .from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, user.id), sql`(${schema.crmDrafts.meta}->>'meetingId')::int = ${m.id}`)),
  ]);
  const contactIds = links.filter((l) => l.kind === "contact").map((l) => l.refId), dealIds = links.filter((l) => l.kind === "deal").map((l) => l.refId);
  const [contacts, deals] = await Promise.all([
    contactIds.length ? db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, company: schema.crmContacts.company, tags: schema.crmContacts.tags })
      .from(schema.crmContacts).where(and(eq(schema.crmContacts.userId, user.id), inArray(schema.crmContacts.id, contactIds))) : [],
    dealIds.length ? db.select({ id: schema.crmDeals.id, name: schema.crmDeals.name, stage: schema.crmDeals.stage })
      .from(schema.crmDeals).where(and(eq(schema.crmDeals.userId, user.id), inArray(schema.crmDeals.id, dealIds))) : [],
  ]);
  return {
    meeting: publicMeeting(m),
    transcript: turns(segments),
    contacts: contacts.map((c) => ({ ...c, how: links.find((l) => l.kind === "contact" && l.refId === c.id)?.how ?? "manual", needsReview: c.tags.includes("needs review") })),
    deals,
    updates: actions.map((a) => ({ id: a.id, kind: a.kind, status: a.status, title: a.title, reasoning: a.reasoning, uncertainties: a.uncertainties, payload: a.payload, decidedAt: a.decidedAt })),
    drafts,
  };
}

/** What the person may use, for the list page and the desktop app. */
export async function meetingAccess(user: User) {
  const [e, allowance, settings] = await Promise.all([entitlements(user), notesAllowance(user), getMeetingSettings(user.id)]);
  return {
    settings,
    features: Object.fromEntries(MEETINGS_FEATURES.map((f) => [f.id, e.features.includes(f.id)])),
    notes: allowance,
    capture: !!pickTranscriber(),
    bot: botProvider().ready(),
    speakers: !!pickTranscriber()?.diarizes,
  };
}

export async function meetingList(user: User, opts: { contactId?: number; dealId?: number } = {}) {
  const [meetings, access] = await Promise.all([listMeetings(user.id, opts), meetingAccess(user)]);
  return { meetings, ...access };
}

/** Contacts and deals whose name, email or company contains `q`, for the pickers. */
export async function searchRefs(userId: string, q: string) {
  const db = requireDb();
  const like = `%${q.trim().replace(/[%_\\]/g, (c) => `\\${c}`).slice(0, 60)}%`;
  const [contacts, deals] = await Promise.all([
    db.select({ id: schema.crmContacts.id, name: schema.crmContacts.name, email: schema.crmContacts.email, company: schema.crmContacts.company }).from(schema.crmContacts)
      .where(and(eq(schema.crmContacts.userId, userId), q.trim() ? or(ilike(schema.crmContacts.name, like), ilike(schema.crmContacts.email, like), ilike(schema.crmContacts.company, like)) : undefined))
      .orderBy(desc(schema.crmContacts.lastSeenAt)).limit(12),
    db.select({ id: schema.crmDeals.id, name: schema.crmDeals.name, stage: schema.crmDeals.stage }).from(schema.crmDeals)
      .where(and(eq(schema.crmDeals.userId, userId), q.trim() ? ilike(schema.crmDeals.name, like) : eq(schema.crmDeals.status, "open")))
      .orderBy(desc(schema.crmDeals.updatedAt)).limit(8),
  ]);
  return { contacts, deals };
}

/** The person behind a meeting, for webhook work that has no session. */
export async function meetingOwner(userId: string): Promise<User | null> {
  const [p] = await requireDb().select({ name: schema.profiles.name, email: schema.profiles.email }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  return p ? { id: userId, name: p.name ?? "", email: p.email ?? "" } : null;
}
