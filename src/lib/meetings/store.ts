/**
 * Reading and writing meetings. Every function takes the owner's id and only touches their rows.
 */
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { MeetingParticipantJson } from "@/db/schema";
import { normalizeSettings, refusedBy, type MeetingNotes, type MeetingSettings, type Segment } from "./model";
import { nameSpeakers, stitch, type Chunk } from "./stitch";

export type MeetingRow = typeof schema.meetings.$inferSelect;

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

/* ---------------- Settings ---------------- */

export async function getMeetingSettings(userId: string): Promise<MeetingSettings> {
  const [row] = await requireDb().select().from(schema.meetingSettings).where(eq(schema.meetingSettings.userId, userId));
  return normalizeSettings(row?.settings ?? {});
}

export async function saveMeetingSettings(userId: string, raw: unknown): Promise<MeetingSettings> {
  const settings = normalizeSettings(raw);
  await requireDb().insert(schema.meetingSettings).values({ userId, settings, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.meetingSettings.userId, set: { settings, updatedAt: new Date() } });
  return settings;
}

/* ---------------- Meetings ---------------- */

export type NewMeeting = {
  source: "desktop" | "bot";
  platform: string;
  title: string;
  deviceId?: number | null;
  meetingUrl?: string;
  status?: string;
  consent?: MeetingRow["consent"];
  context?: Record<string, unknown>;
  participants?: MeetingParticipantJson[];
};

/** Start a meeting record. Refused when the person's never-record settings cover it. */
export async function createMeeting(userId: string, m: NewMeeting): Promise<MeetingRow> {
  const settings = await getMeetingSettings(userId);
  const refused = refusedBy(settings, m.platform, `${m.title} ${String(m.context?.appTitle ?? "")}`);
  if (refused) throw status(refused, 403);
  const [row] = await requireDb().insert(schema.meetings).values({
    userId, source: m.source, platform: m.platform.slice(0, 20), title: m.title.slice(0, 200), deviceId: m.deviceId ?? null,
    meetingUrl: (m.meetingUrl ?? "").slice(0, 1000), status: m.status ?? "live", consent: m.consent ?? {}, context: m.context ?? {},
    participants: m.participants ?? [],
  }).returning();
  return row;
}

export async function getMeeting(userId: string, id: number): Promise<MeetingRow> {
  const [row] = await requireDb().select().from(schema.meetings).where(and(eq(schema.meetings.id, id), eq(schema.meetings.userId, userId)));
  if (!row) throw status("Meeting not found", 404);
  return row;
}

export async function updateMeeting(id: number, set: Partial<typeof schema.meetings.$inferInsert>): Promise<MeetingRow> {
  const [row] = await requireDb().update(schema.meetings).set({ ...set, updatedAt: new Date() }).where(eq(schema.meetings.id, id)).returning();
  return row;
}

export async function meetingByBot(botId: string): Promise<MeetingRow | null> {
  const [row] = await requireDb().select().from(schema.meetings).where(eq(schema.meetings.botId, botId));
  return row ?? null;
}

/**
 * The person's meetings, newest first, optionally only those linked to a contact or deal. Transcripts
 * past the person's retention are removed first, so a list never shows what should be gone.
 */
export async function listMeetings(userId: string, opts: { contactId?: number; dealId?: number; limit?: number } = {}) {
  const db = requireDb();
  await purgeExpired(userId).catch(() => 0);
  const link = opts.contactId ? { kind: "contact", ref: opts.contactId } : opts.dealId ? { kind: "deal", ref: opts.dealId } : null;
  const ids = link
    ? (await db.select({ id: schema.meetingLinks.meetingId }).from(schema.meetingLinks)
      .where(and(eq(schema.meetingLinks.userId, userId), eq(schema.meetingLinks.kind, link.kind), eq(schema.meetingLinks.refId, link.ref)))).map((r) => r.id)
    : null;
  if (ids && !ids.length) return [];
  return db.select({
    id: schema.meetings.id, title: schema.meetings.title, platform: schema.meetings.platform, source: schema.meetings.source, status: schema.meetings.status,
    startedAt: schema.meetings.startedAt, endedAt: schema.meetings.endedAt, durationSec: schema.meetings.durationSec, participants: schema.meetings.participants,
    notesAt: schema.meetings.notesAt, error: schema.meetings.error, summary: sql<string | null>`${schema.meetings.notes}->>'summary'`,
  }).from(schema.meetings)
    .where(and(eq(schema.meetings.userId, userId), ids ? inArray(schema.meetings.id, ids) : undefined))
    .orderBy(desc(schema.meetings.startedAt)).limit(Math.min(200, opts.limit ?? 60));
}

export async function deleteMeeting(userId: string, id: number): Promise<void> {
  const db = requireDb();
  const m = await getMeeting(userId, id);
  // Its timeline entries in Relationships go too; contacts it created stay (they may have been kept).
  await db.delete(schema.crmThreads).where(and(eq(schema.crmThreads.userId, userId), sql`${schema.crmThreads.providerThreadId} like ${`meeting:${m.id}:%`}`));
  await db.update(schema.crmActions).set({ status: "dismissed", decidedAt: new Date() })
    .where(and(eq(schema.crmActions.userId, userId), eq(schema.crmActions.meetingId, m.id), eq(schema.crmActions.status, "pending")));
  await db.delete(schema.meetings).where(eq(schema.meetings.id, m.id));
}

/* ---------------- Transcript ---------------- */

export async function putChunk(meetingId: number, c: { seq: number; startSec: number; durationSec: number; segments: Segment[]; engine: string }): Promise<void> {
  const values = { meetingId, seq: c.seq, startSec: c.startSec, durationSec: c.durationSec, segments: c.segments, engine: c.engine.slice(0, 60) };
  await requireDb().insert(schema.meetingChunks).values(values)
    .onConflictDoUpdate({ target: [schema.meetingChunks.meetingId, schema.meetingChunks.seq], set: { ...values, createdAt: new Date() } });
}

export async function loadChunks(meetingId: number): Promise<Chunk[]> {
  const rows = await requireDb().select().from(schema.meetingChunks).where(eq(schema.meetingChunks.meetingId, meetingId)).orderBy(schema.meetingChunks.seq);
  return rows.map((r) => ({ seq: r.seq, startSec: r.startSec, durationSec: r.durationSec, segments: r.segments }));
}

/** The meeting's transcript in meeting time, with speakers named where the notes named them. */
export async function transcriptOf(m: MeetingRow): Promise<Segment[]> {
  const segments = stitch(await loadChunks(m.id));
  const notes = m.notes as MeetingNotes | null;
  return nameSpeakers(segments, notes?.speakers ?? []);
}

/** The newest stretch of a live meeting's transcript (the copilot's rolling view). */
export async function transcriptTail(meetingId: number, chunks = 6): Promise<Segment[]> {
  const rows = await requireDb().select().from(schema.meetingChunks).where(eq(schema.meetingChunks.meetingId, meetingId))
    .orderBy(desc(schema.meetingChunks.seq)).limit(chunks);
  return stitch(rows.map((r) => ({ seq: r.seq, startSec: r.startSec, durationSec: r.durationSec, segments: r.segments })));
}

/* ---------------- Links ---------------- */

export async function linkMeeting(userId: string, meetingId: number, kind: "contact" | "deal", refIds: number[], how: string): Promise<void> {
  const ids = [...new Set(refIds.filter((n) => Number.isInteger(n) && n > 0))];
  if (!ids.length) return;
  await requireDb().insert(schema.meetingLinks).values(ids.map((refId) => ({ meetingId, userId, kind, refId, how }))).onConflictDoNothing();
}

export async function unlinkMeeting(userId: string, meetingId: number, kind: "contact" | "deal", refId: number): Promise<void> {
  await requireDb().delete(schema.meetingLinks).where(and(eq(schema.meetingLinks.userId, userId), eq(schema.meetingLinks.meetingId, meetingId), eq(schema.meetingLinks.kind, kind), eq(schema.meetingLinks.refId, refId)));
}

export async function meetingLinks(meetingId: number) {
  return requireDb().select().from(schema.meetingLinks).where(eq(schema.meetingLinks.meetingId, meetingId));
}

/* ---------------- Allowances and retention ---------------- */

/** Meetings that got AI notes this calendar month (UTC), for the free allowance. */
export async function notesUsedThisMonth(userId: string, now = new Date()): Promise<number> {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [r] = await requireDb().select({ n: sql<number>`count(*)::int` }).from(schema.meetings)
    .where(and(eq(schema.meetings.userId, userId), isNotNull(schema.meetings.notesAt), gte(schema.meetings.notesAt, start)));
  return r?.n ?? 0;
}

/** Remove transcripts older than the person's retention. Notes and links stay. Returns how many meetings. */
export async function purgeExpired(userId: string): Promise<number> {
  const settings = await getMeetingSettings(userId);
  if (!settings.retentionDays) return 0;
  const db = requireDb();
  const cutoff = new Date(Date.now() - settings.retentionDays * 86_400_000);
  const old = await db.select({ id: schema.meetings.id }).from(schema.meetings)
    .where(and(eq(schema.meetings.userId, userId), lt(schema.meetings.startedAt, cutoff), isNull(schema.meetings.purgedAt), inArray(schema.meetings.status, ["ready", "failed", "cancelled"])))
    .limit(200);
  if (!old.length) return 0;
  const ids = old.map((o) => o.id);
  await db.delete(schema.meetingChunks).where(inArray(schema.meetingChunks.meetingId, ids));
  await db.update(schema.meetings).set({ purgedAt: new Date() }).where(inArray(schema.meetings.id, ids));
  return ids.length;
}
