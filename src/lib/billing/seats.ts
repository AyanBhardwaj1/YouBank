/**
 * Deal Team and Enterprise seats. Server only, apart from the pure rules at the top.
 *
 * A subscription belongs to the person who bought it (the owner); its quantity is the seat count, and the
 * owner holds one seat themselves. The owner gives the others to members of a team they own or
 * administer (the existing `teams` and `team_members`), in Settings under Plan. `entitlements()` then
 * grants the subscription's plan to each assigned person while:
 * - the subscription is live (active, trialing or past due),
 * - the person is still a member of the team the seat was given through, and
 * - the seat is within the count: assignments are ranked by when they were made, and only the first
 *   (seats − 1) count, so lowering the seat count in the Stripe portal takes the newest seats back first.
 * The webhook trims the assignments to the new count as well (trimSeats), so the list in Settings is true.
 * Seat holders' AI allowances are their own (per seat) and reset on the owner's billing anniversary.
 */
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { can, isTeamRole, type TeamRole } from "@/lib/teams/roles";
import { isPlanId, LIVE_STATUSES, PLANS, type PlanId } from "./plans";

/** The plans whose seats can be shared. */
export const SEAT_PLANS: PlanId[] = ["team", "enterprise"];

/** Seats the owner can give away: the subscription's quantity less the owner's own. Pure. */
export const assignableSeats = (seats: number) => Math.max(0, Math.floor(seats) - 1);

/** The plan an assigned seat grants, or null. `rank` is how many of the owner's assignments came before this one. Pure. */
export function seatPlan(s: { plan: string; status: string; seats: number; rank: number; member: boolean }): PlanId | null {
  if (!s.member || !LIVE_STATUSES.includes(s.status) || !isPlanId(s.plan) || !SEAT_PLANS.includes(s.plan)) return null;
  return s.rank < assignableSeats(s.seats) ? s.plan : null;
}

/** Why a seat cannot be given, or null when it can. Pure. */
export function assignError(a: {
  ownerId: string; targetId: string; plan: string | null; status: string | null; seats: number; assigned: number;
  ownerRole: TeamRole | null; targetRole: TeamRole | null; targetSeatOwner: string | null;
}): string | null {
  if (!a.plan || !isPlanId(a.plan) || !SEAT_PLANS.includes(a.plan) || !a.status || !LIVE_STATUSES.includes(a.status)) return "Seats come with a live Deal Team or Enterprise subscription.";
  if (a.ownerId === a.targetId) return "You already hold one seat yourself, as the subscriber.";
  if (!a.ownerRole || !can(a.ownerRole, "invite")) return "You can give seats only to people on a team you own or administer.";
  if (!a.targetRole) return "That person is not on this team. Invite them on the Team page first.";
  if (a.targetSeatOwner === a.ownerId) return "That person already has one of your seats.";
  if (a.targetSeatOwner) return "That person already has a seat on someone else's subscription.";
  if (a.assigned >= assignableSeats(a.seats)) return `All ${a.seats} seats are in use (yours included). Add seats under Manage billing, or free one first.`;
  return null;
}

/** Which of an owner's assignments a new seat count keeps: the oldest (seats − 1); the rest go. Pure. */
export function seatsToTrim<T extends { id: number; assignedAt: Date }>(rows: T[], seats: number, plan: string, live: boolean): T[] {
  if (!live) return [];
  const sorted = [...rows].sort((a, b) => a.assignedAt.getTime() - b.assignedAt.getTime() || a.id - b.id);
  return sorted.slice(isPlanId(plan) && SEAT_PLANS.includes(plan) ? assignableSeats(seats) : 0);
}

/* ---------------- Reads ---------------- */

export type HeldSeat = { plan: PlanId; ownerUserId: string; ownerEmail: string | null; teamName: string | null; anchor: Date | null };

/** The plan an assigned seat gives this person, if any. One query; null when they hold none (or the table is not there yet). */
export async function heldSeat(userId: string): Promise<HeldSeat | null> {
  const t = schema.seatAssignments, s = schema.subscriptions, m = schema.teamMembers;
  const [r] = await requireDb().select({
    ownerUserId: t.ownerUserId, plan: s.plan, status: s.status, seats: s.seats, anchor: s.billingAnchor,
    rank: sql<number>`(select count(*)::int from ${t} x where x.owner_user_id = ${t.ownerUserId} and (x.assigned_at, x.id) < (${t.assignedAt}, ${t.id}))`,
    member: sql<boolean>`exists(select 1 from ${m} tm where tm.team_id = ${t.teamId} and tm.user_id = ${t.userId})`,
    ownerEmail: sql<string | null>`(select o.email from ${m} o where o.team_id = ${t.teamId} and o.user_id = ${t.ownerUserId} limit 1)`,
    teamName: sql<string | null>`(select tt.name from ${schema.teams} tt where tt.id = ${t.teamId})`,
  }).from(t).innerJoin(s, eq(s.userId, t.ownerUserId)).where(eq(t.userId, userId)).catch(() => []);
  if (!r) return null;
  const plan = seatPlan({ plan: r.plan, status: r.status, seats: r.seats, rank: Number(r.rank), member: !!r.member });
  return plan ? { plan, ownerUserId: r.ownerUserId, ownerEmail: r.ownerEmail || null, teamName: r.teamName, anchor: r.anchor ?? null } : null;
}

/** Everyone holding one of this owner's seats (to drop their cached plans when the subscription changes). */
export async function seatHolders(ownerUserId: string): Promise<string[]> {
  const rows = await requireDb().select({ userId: schema.seatAssignments.userId }).from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, ownerUserId));
  return rows.map((r) => r.userId);
}

export type SeatPerson = { userId: string; email: string; name: string; teamId: number; teamName: string };
export type SeatBoard = { plan: PlanId; seats: number; assignable: number; assigned: (SeatPerson & { assignedAt: string; active: boolean })[]; candidates: SeatPerson[] };

/** What the owner sees in Settings: who holds a seat, and who on their teams could. Null when they have no seat plan. */
export async function seatBoard(ownerUserId: string): Promise<SeatBoard | null> {
  const db = requireDb();
  const [sub] = await db.select({ plan: schema.subscriptions.plan, status: schema.subscriptions.status, seats: schema.subscriptions.seats })
    .from(schema.subscriptions).where(eq(schema.subscriptions.userId, ownerUserId));
  if (!sub || !isPlanId(sub.plan) || !SEAT_PLANS.includes(sub.plan) || !LIVE_STATUSES.includes(sub.status)) return null;
  const mine = await db.select({ teamId: schema.teamMembers.teamId, role: schema.teamMembers.role, teamName: schema.teams.name })
    .from(schema.teamMembers).innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId)).where(eq(schema.teamMembers.userId, ownerUserId));
  const managed = mine.filter((r) => isTeamRole(r.role) && can(r.role, "invite"));
  const teamName = new Map(mine.map((r) => [r.teamId, r.teamName]));
  const assignedRows = await db.select().from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, ownerUserId))
    .orderBy(asc(schema.seatAssignments.assignedAt), asc(schema.seatAssignments.id));
  const members = managed.length ? await db.select({ teamId: schema.teamMembers.teamId, userId: schema.teamMembers.userId, email: schema.teamMembers.email, name: schema.teamMembers.name })
    .from(schema.teamMembers).where(and(inArray(schema.teamMembers.teamId, managed.map((m) => m.teamId)), ne(schema.teamMembers.userId, ownerUserId))) : [];
  const seated = await (members.length ? db.select({ userId: schema.seatAssignments.userId }).from(schema.seatAssignments).where(inArray(schema.seatAssignments.userId, [...new Set(members.map((m) => m.userId))])) : Promise.resolve([]));
  const taken = new Set(seated.map((r) => r.userId));
  const memberOf = new Set(members.map((m) => `${m.teamId}:${m.userId}`));
  const assignable = assignableSeats(sub.seats);
  const seen = new Set<string>();
  return {
    plan: sub.plan, seats: sub.seats, assignable,
    assigned: assignedRows.map((r, i) => ({
      userId: r.userId, email: r.email, name: r.name, teamId: r.teamId, teamName: teamName.get(r.teamId) ?? "", assignedAt: r.assignedAt.toISOString(),
      active: i < assignable && memberOf.has(`${r.teamId}:${r.userId}`),
    })),
    candidates: members.filter((m) => !taken.has(m.userId) && !seen.has(m.userId) && (seen.add(m.userId), true))
      .map((m) => ({ ...m, teamName: teamName.get(m.teamId) ?? "" })),
  };
}

/* ---------------- Writes ---------------- */

export class SeatError extends Error {
  /** Read by `guarded()`: below 500, so the message reaches the person as written. */
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.name = "SeatError"; this.status = status; }
}

/** Give one of the owner's seats to a member of one of their teams. */
export async function assignSeat(ownerUserId: string, targetUserId: string, teamId: number): Promise<void> {
  const db = requireDb();
  const [sub] = await db.select({ plan: schema.subscriptions.plan, status: schema.subscriptions.status, seats: schema.subscriptions.seats })
    .from(schema.subscriptions).where(eq(schema.subscriptions.userId, ownerUserId));
  const roles = await db.select({ userId: schema.teamMembers.userId, role: schema.teamMembers.role, email: schema.teamMembers.email, name: schema.teamMembers.name })
    .from(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), inArray(schema.teamMembers.userId, [ownerUserId, targetUserId])));
  const ownerRow = roles.find((r) => r.userId === ownerUserId), target = roles.find((r) => r.userId === targetUserId);
  const [held] = await db.select({ owner: schema.seatAssignments.ownerUserId }).from(schema.seatAssignments).where(eq(schema.seatAssignments.userId, targetUserId));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, ownerUserId));
  const why = assignError({
    ownerId: ownerUserId, targetId: targetUserId, plan: sub?.plan ?? null, status: sub?.status ?? null, seats: sub?.seats ?? 0, assigned: Number(n),
    ownerRole: ownerRow && isTeamRole(ownerRow.role) ? ownerRow.role : null, targetRole: target && isTeamRole(target.role) ? target.role : null,
    targetSeatOwner: held?.owner ?? null,
  });
  if (why) throw new SeatError(why, why.startsWith("Seats come") ? 402 : 409);
  // The unique index on user_id settles a race between two owners: the second insert does nothing.
  const rows = await db.insert(schema.seatAssignments).values({ ownerUserId, userId: targetUserId, teamId, email: target!.email, name: target!.name })
    .onConflictDoNothing({ target: schema.seatAssignments.userId }).returning({ id: schema.seatAssignments.id });
  if (!rows.length) throw new SeatError("That person already has a seat.", 409);
}

/** Take a seat back (the owner), or give it up (the holder). */
export async function releaseSeat(actorUserId: string, holderUserId: string): Promise<boolean> {
  const t = schema.seatAssignments;
  const rows = await requireDb().delete(t)
    .where(and(eq(t.userId, holderUserId), actorUserId === holderUserId ? sql`true` : eq(t.ownerUserId, actorUserId)))
    .returning({ id: t.id });
  return rows.length > 0;
}

/** After the subscription changes: drop assignments beyond the new seat count (newest first), or all on a non-team plan. Returns who lost a seat. */
export async function trimSeats(ownerUserId: string, plan: string, status: string, seats: number): Promise<string[]> {
  const db = requireDb();
  const rows = await db.select({ id: schema.seatAssignments.id, userId: schema.seatAssignments.userId, assignedAt: schema.seatAssignments.assignedAt })
    .from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, ownerUserId));
  const drop = seatsToTrim(rows, seats, plan, LIVE_STATUSES.includes(status));
  if (drop.length) await db.delete(schema.seatAssignments).where(inArray(schema.seatAssignments.id, drop.map((r) => r.id)));
  return drop.map((r) => r.userId);
}

/** A member leaving or removed from a team gives up any seat they held through it. */
export async function releaseTeamSeat(teamId: number, userId: string): Promise<void> {
  await requireDb().delete(schema.seatAssignments).where(and(eq(schema.seatAssignments.teamId, teamId), eq(schema.seatAssignments.userId, userId)));
}

/** "3 of 4 seats in use" for the Plan tab. Pure. */
export const seatsLine = (b: Pick<SeatBoard, "seats" | "assigned" | "plan">) =>
  `${b.assigned.filter((a) => a.active).length + 1} of ${b.seats} ${PLANS[b.plan].name} seats in use, yours included`;
