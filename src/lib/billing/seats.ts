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
 *
 * The reassignment cooldown: a seat that is freed (taken back, given up, or lost when its holder leaves the
 * team or the team is deleted) cannot go to a different person for 30 days after it was last given. Without
 * it, one seat could hand a fresh AI allowance to a new person every few days, and AI cost per subscription
 * would have no limit. `seat_history` (drizzle/0024_seat_cooldown.sql) keeps every seat given; a person who
 * held a seat in the last 30 days and holds none now still counts against the seat count until their window
 * ends, so at most (seats - 1) different people get the plan's allowance in any 30 days, plus whatever new
 * seats the owner pays for. Giving the seat back to the same person is always allowed. Seats the webhook
 * trims because the paid count went down stop cooling (they are no longer paid for, and raising the count
 * again is a new payment). Administrators (ADMIN_EMAILS) are exempt.
 */
import { and, asc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { can, isTeamRole, type TeamRole } from "@/lib/teams/roles";
import { isPlanId, LIVE_STATUSES, PLANS, type PlanId } from "./plans";

/** The plans whose seats can be shared. */
export const SEAT_PLANS: PlanId[] = ["team", "enterprise"];

/** Seats the owner can give away: the subscription's quantity less the owner's own. Pure. */
export const assignableSeats = (seats: number) => Math.max(0, Math.floor(seats) - 1);

/** Days after a seat was last given before it can go to someone else once freed. */
export const SEAT_COOLDOWN_DAYS = 30;
const COOLDOWN_MS = SEAT_COOLDOWN_DAYS * 86_400_000;

/** One seat given, from `seat_history` (trimmed rows left out). */
export type SeatGiven = { userId: string; assignedAt: Date; email?: string; name?: string };
export type CoolingSeat = { userId: string; email: string; name: string; until: Date };

/**
 * The people whose freed seat is still cooling: they held one of the owner's seats within the last 30 days
 * and hold none now. Each with the moment their seat may go to someone else (30 days after it was last
 * given to them), soonest first. Pure.
 */
export function coolingSeats(history: SeatGiven[], current: string[], now = new Date()): CoolingSeat[] {
  const last = new Map<string, SeatGiven>();
  for (const h of history) { const was = last.get(h.userId); if (!was || h.assignedAt.getTime() > was.assignedAt.getTime()) last.set(h.userId, h); }
  const held = new Set(current);
  return [...last.values()]
    .filter((h) => !held.has(h.userId) && h.assignedAt.getTime() + COOLDOWN_MS > now.getTime())
    .map((h) => ({ userId: h.userId, email: h.email ?? "", name: h.name ?? "", until: new Date(h.assignedAt.getTime() + COOLDOWN_MS) }))
    .sort((a, b) => a.until.getTime() - b.until.getTime() || a.userId.localeCompare(b.userId));
}

/** Seats free to give to someone new now: the assignable seats less those held and those cooling. Pure. */
export const freeSeats = (assignable: number, held: number, cooling: number) => Math.max(0, assignable - held - cooling);

/**
 * When the cooldown lets a seat go to someone new: null when it already can (a seat is free, the person is
 * the one whose seat is cooling, or the owner is exempt), else the date a cooling seat's window ends. With
 * more people cooling than seats (the count went down meanwhile), the date is when enough windows have
 * ended. Pure.
 */
export function cooldownUntil(a: { assignable: number; current: string[]; history: SeatGiven[]; targetId: string; now?: Date; exempt?: boolean }): Date | null {
  if (a.exempt) return null;
  const cooling = coolingSeats(a.history, a.current, a.now);
  if (cooling.some((c) => c.userId === a.targetId)) return null;
  const free = a.assignable - a.current.length - cooling.length;
  if (free > 0 || a.current.length >= a.assignable) return null;
  return cooling[Math.min(cooling.length, 1 - free) - 1].until;
}

/** "November 13, 2026", in UTC so the server and the page agree. Pure. */
export const seatDate = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/** The cooldown's refusal, naming the date. Pure. */
export const cooldownMessage = (until: Date) =>
  `This seat can be given to someone else on ${seatDate(until)}. A freed seat can go to a different person ${SEAT_COOLDOWN_DAYS} days after it was last given, so one seat cannot pass a fresh AI allowance from person to person. You can give it back to the person who last held it at any time, or add a seat under Manage billing.`;

/** The plan an assigned seat grants, or null. `rank` is how many of the owner's assignments came before this one. Pure. */
export function seatPlan(s: { plan: string; status: string; seats: number; rank: number; member: boolean }): PlanId | null {
  if (!s.member || !LIVE_STATUSES.includes(s.status) || !isPlanId(s.plan) || !SEAT_PLANS.includes(s.plan)) return null;
  return s.rank < assignableSeats(s.seats) ? s.plan : null;
}

/**
 * Why a seat cannot be given, or null when it can. Pure. With `current` (who holds the owner's seats now)
 * and `history` (seats given in the last 30 days), the reassignment cooldown applies too, unless `exempt`.
 */
export function assignError(a: {
  ownerId: string; targetId: string; plan: string | null; status: string | null; seats: number; assigned: number;
  ownerRole: TeamRole | null; targetRole: TeamRole | null; targetSeatOwner: string | null;
  current?: string[]; history?: SeatGiven[]; now?: Date; exempt?: boolean;
}): string | null {
  if (!a.plan || !isPlanId(a.plan) || !SEAT_PLANS.includes(a.plan) || !a.status || !LIVE_STATUSES.includes(a.status)) return "Seats come with a live Deal Team or Enterprise subscription.";
  if (a.ownerId === a.targetId) return "You already hold one seat yourself, as the subscriber.";
  if (!a.ownerRole || !can(a.ownerRole, "invite")) return "You can give seats only to people on a team you own or administer.";
  if (!a.targetRole) return "That person is not on this team. Invite them on the Team page first.";
  if (a.targetSeatOwner === a.ownerId) return "That person already has one of your seats.";
  if (a.targetSeatOwner) return "That person already has a seat on someone else's subscription.";
  if (a.assigned >= assignableSeats(a.seats)) return `All ${a.seats} seats are in use (yours included). Add seats under Manage billing, or free one first.`;
  if (a.history) {
    const until = cooldownUntil({ assignable: assignableSeats(a.seats), current: a.current ?? [], history: a.history, targetId: a.targetId, now: a.now, exempt: a.exempt });
    if (until) return cooldownMessage(until);
  }
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

/**
 * Seats this owner gave in the last 30 days, trimmed ones left out. Empty (and logged) when the table is not
 * there yet, so a deploy that lands before drizzle/0024 keeps seats working without the cooldown.
 */
export async function recentSeats(ownerUserId: string, now = new Date()): Promise<SeatGiven[]> {
  const h = schema.seatHistory;
  return requireDb().select({ userId: h.userId, assignedAt: h.assignedAt, email: h.email, name: h.name }).from(h)
    .where(and(eq(h.ownerUserId, ownerUserId), isNull(h.trimmedAt), gt(h.assignedAt, new Date(now.getTime() - COOLDOWN_MS))))
    .catch((e) => { logError(e, { where: "seat-history" }); return []; });
}

export type SeatPerson = { userId: string; email: string; name: string; teamId: number; teamName: string };
export type SeatBoard = {
  plan: PlanId; seats: number; assignable: number; assigned: (SeatPerson & { assignedAt: string; active: boolean })[]; candidates: SeatPerson[];
  /** Freed seats still in their 30-day window: they can go back to that person now, to anyone else from `until`. */
  cooling: { userId: string; email: string; name: string; until: string }[];
  /** Seats that can go to someone new now. */
  free: number;
  /** When a seat can next go to someone new, while none can now because freed seats are cooling (ISO). */
  nextFree: string | null;
};

/**
 * What the owner sees in Settings: who holds a seat, whose freed seat is cooling, and who on their teams
 * could have one. Null when they have no seat plan. `exempt` (administrators) shows no cooldown.
 */
export async function seatBoard(ownerUserId: string, opts: { exempt?: boolean } = {}): Promise<SeatBoard | null> {
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
  const history = opts.exempt ? [] : await recentSeats(ownerUserId);
  const current = assignedRows.map((r) => r.userId);
  const cooling = coolingSeats(history, current);
  const nextFree = cooldownUntil({ assignable, current, history, targetId: "" });
  return {
    nextFree: nextFree ? nextFree.toISOString() : null,
    plan: sub.plan, seats: sub.seats, assignable,
    cooling: cooling.map((c) => ({ userId: c.userId, email: c.email, name: c.name, until: c.until.toISOString() })),
    free: freeSeats(assignable, assignedRows.length, cooling.length),
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

/** Give one of the owner's seats to a member of one of their teams. `exempt` (administrators) skips the cooldown. */
export async function assignSeat(ownerUserId: string, targetUserId: string, teamId: number, opts: { exempt?: boolean } = {}): Promise<void> {
  const db = requireDb();
  const [sub] = await db.select({ plan: schema.subscriptions.plan, status: schema.subscriptions.status, seats: schema.subscriptions.seats })
    .from(schema.subscriptions).where(eq(schema.subscriptions.userId, ownerUserId));
  const roles = await db.select({ userId: schema.teamMembers.userId, role: schema.teamMembers.role, email: schema.teamMembers.email, name: schema.teamMembers.name })
    .from(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), inArray(schema.teamMembers.userId, [ownerUserId, targetUserId])));
  const ownerRow = roles.find((r) => r.userId === ownerUserId), target = roles.find((r) => r.userId === targetUserId);
  const [held] = await db.select({ owner: schema.seatAssignments.ownerUserId }).from(schema.seatAssignments).where(eq(schema.seatAssignments.userId, targetUserId));
  const current = (await db.select({ userId: schema.seatAssignments.userId }).from(schema.seatAssignments).where(eq(schema.seatAssignments.ownerUserId, ownerUserId))).map((r) => r.userId);
  const history = opts.exempt ? [] : await recentSeats(ownerUserId);
  const why = assignError({
    ownerId: ownerUserId, targetId: targetUserId, plan: sub?.plan ?? null, status: sub?.status ?? null, seats: sub?.seats ?? 0, assigned: current.length,
    ownerRole: ownerRow && isTeamRole(ownerRow.role) ? ownerRow.role : null, targetRole: target && isTeamRole(target.role) ? target.role : null,
    targetSeatOwner: held?.owner ?? null, current, history, exempt: opts.exempt,
  });
  if (why) throw new SeatError(why, why.startsWith("Seats come") ? 402 : 409);
  // The unique index on user_id settles a race between two owners: the second insert does nothing.
  const rows = await db.insert(schema.seatAssignments).values({ ownerUserId, userId: targetUserId, teamId, email: target!.email, name: target!.name })
    .onConflictDoNothing({ target: schema.seatAssignments.userId }).returning({ id: schema.seatAssignments.id });
  if (!rows.length) throw new SeatError("That person already has a seat.", 409);
  // The cooldown's memory: kept after the seat is freed, whichever way (drizzle/0024_seat_cooldown.sql).
  await db.insert(schema.seatHistory).values({ ownerUserId, userId: targetUserId, teamId, email: target!.email, name: target!.name })
    .catch((e) => logError(e, { where: "seat-history" }));
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
  if (drop.length) {
    await db.delete(schema.seatAssignments).where(inArray(schema.seatAssignments.id, drop.map((r) => r.id)));
    // Seats no longer paid for do not cool: raising the count again is a new payment.
    await db.update(schema.seatHistory).set({ trimmedAt: new Date() })
      .where(and(eq(schema.seatHistory.ownerUserId, ownerUserId), inArray(schema.seatHistory.userId, drop.map((r) => r.userId)), isNull(schema.seatHistory.trimmedAt)))
      .catch((e) => logError(e, { where: "seat-history" }));
  }
  return drop.map((r) => r.userId);
}

/** A member leaving or removed from a team gives up any seat they held through it. */
export async function releaseTeamSeat(teamId: number, userId: string): Promise<void> {
  await requireDb().delete(schema.seatAssignments).where(and(eq(schema.seatAssignments.teamId, teamId), eq(schema.seatAssignments.userId, userId)));
}

/** "3 of 4 seats in use" for the Plan tab. Pure. */
export const seatsLine = (b: Pick<SeatBoard, "seats" | "assigned" | "plan">) =>
  `${b.assigned.filter((a) => a.active).length + 1} of ${b.seats} ${PLANS[b.plan].name} seats in use, yours included`;
