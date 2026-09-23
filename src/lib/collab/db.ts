import { and, asc, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { Forbidden, myTeamIds } from "@/lib/teams/db";

export type SessionRow = typeof schema.collabSessions.$inferSelect;
export type EventRow = typeof schema.collabEvents.$inferSelect;
export type Presence = { userId: string; name: string; field: string; lastSeenAt: string };

/** Someone who has not checked in within this window is treated as gone. */
export const PRESENCE_WINDOW_MS = 25_000;

/* ---------------- Access ---------------- */

/**
 * A session shared with a team is open to that team; one without a team belongs to its owner alone.
 * Every route goes through this so the rule lives in one place.
 */
export async function requireSession(user: CurrentUser, sessionId: number): Promise<SessionRow> {
  const [s] = await requireDb().select().from(schema.collabSessions).where(eq(schema.collabSessions.id, sessionId));
  if (!s) throw new Forbidden("That session does not exist");
  if (s.ownerId === user.id) return s;
  if (s.teamId && (await myTeamIds(user.id)).includes(s.teamId)) return s;
  throw new Forbidden(s.teamId
    ? "That session is shared with a team you are not on"
    : "That session is private to the person who started it");
}

/* ---------------- Sessions ---------------- */

export async function createSession(user: CurrentUser, fields: {
  kind?: string; refId?: string; title?: string; teamId?: number | null; state?: Record<string, unknown>;
}): Promise<SessionRow> {
  if (fields.teamId != null && !(await myTeamIds(user.id)).includes(fields.teamId)) {
    throw new Forbidden("You are not on that team");
  }
  const [row] = await requireDb().insert(schema.collabSessions).values({
    ownerId: user.id, teamId: fields.teamId ?? null,
    kind: fields.kind || "tool", refId: fields.refId ?? "",
    title: fields.title?.slice(0, 120) || "Shared session",
    state: fields.state ?? {},
  }).returning();
  return row;
}

/** Sessions the user can open: their own, plus anything shared with their teams. */
export async function listSessions(user: CurrentUser): Promise<SessionRow[]> {
  const teamIds = await myTeamIds(user.id);
  const where = teamIds.length
    ? or(eq(schema.collabSessions.ownerId, user.id), inArray(schema.collabSessions.teamId, teamIds))
    : eq(schema.collabSessions.ownerId, user.id);
  return requireDb().select().from(schema.collabSessions).where(where).orderBy(desc(schema.collabSessions.updatedAt)).limit(50);
}

export async function closeSession(user: CurrentUser, sessionId: number): Promise<void> {
  const s = await requireSession(user, sessionId);
  if (s.ownerId !== user.id) throw new Forbidden("Only the person who started a session can close it");
  await requireDb().update(schema.collabSessions).set({ status: "closed", updatedAt: new Date() }).where(eq(schema.collabSessions.id, sessionId));
}

/* ---------------- Events ---------------- */

export async function appendEvent(sessionId: number, user: CurrentUser, kind: string, payload: Record<string, unknown>): Promise<EventRow> {
  const [row] = await requireDb().insert(schema.collabEvents)
    .values({ sessionId, userId: user.id, userName: user.name || user.email, kind, payload }).returning();
  return row;
}

export async function eventsSince(sessionId: number, sinceId: number, limit = 200): Promise<EventRow[]> {
  return requireDb().select().from(schema.collabEvents)
    .where(and(eq(schema.collabEvents.sessionId, sessionId), gt(schema.collabEvents.id, sinceId)))
    .orderBy(asc(schema.collabEvents.id)).limit(limit);
}

/** The newest event id, so a client joining mid-session starts from now rather than replaying history. */
export async function latestEventId(sessionId: number): Promise<number> {
  const [row] = await requireDb().select({ id: schema.collabEvents.id }).from(schema.collabEvents)
    .where(eq(schema.collabEvents.sessionId, sessionId)).orderBy(desc(schema.collabEvents.id)).limit(1);
  return row?.id ?? 0;
}

/**
 * Apply a field-level change to the shared state.
 *
 * Last write wins per field. Two people editing different assumptions of the same model never
 * conflict; two people typing into the same box will see the later keystroke win, which is the
 * behaviour people already expect from a shared spreadsheet cell.
 */
export async function applyPatch(sessionId: number, user: CurrentUser, patch: Record<string, unknown>): Promise<EventRow> {
  const db = requireDb();
  const entries = Object.entries(patch).slice(0, 50);
  if (entries.length === 0) throw new Error("A patch needs at least one field");
  // Merge server-side so a slow client cannot overwrite fields it never touched.
  await db.update(schema.collabSessions)
    .set({ state: sql`${schema.collabSessions.state} || ${JSON.stringify(Object.fromEntries(entries))}::jsonb`, updatedAt: new Date() })
    .where(eq(schema.collabSessions.id, sessionId));
  return appendEvent(sessionId, user, "patch", { patch: Object.fromEntries(entries) });
}

/* ---------------- Presence ---------------- */

/** Check in, and report who else is here. Called on a timer by every connected client. */
export async function heartbeat(sessionId: number, user: CurrentUser, field = ""): Promise<Presence[]> {
  const db = requireDb();
  const now = new Date();
  await db.insert(schema.collabPresence)
    .values({ sessionId, userId: user.id, name: user.name || user.email, field, lastSeenAt: now })
    .onConflictDoUpdate({
      target: [schema.collabPresence.sessionId, schema.collabPresence.userId],
      set: { name: user.name || user.email, field, lastSeenAt: now },
    });
  return presenceFor(sessionId);
}

export async function presenceFor(sessionId: number): Promise<Presence[]> {
  const cutoff = new Date(Date.now() - PRESENCE_WINDOW_MS);
  const rows = await requireDb().select().from(schema.collabPresence)
    .where(and(eq(schema.collabPresence.sessionId, sessionId), gt(schema.collabPresence.lastSeenAt, cutoff)))
    .orderBy(asc(schema.collabPresence.lastSeenAt));
  return rows.map((r) => ({ userId: r.userId, name: r.name, field: r.field, lastSeenAt: r.lastSeenAt.toISOString() }));
}

export async function leave(sessionId: number, userId: string): Promise<void> {
  await requireDb().delete(schema.collabPresence)
    .where(and(eq(schema.collabPresence.sessionId, sessionId), eq(schema.collabPresence.userId, userId)));
}
