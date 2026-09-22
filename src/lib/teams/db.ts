import { randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { can, canAssignRole, isTeamRole, outranks, slugify, type TeamPermission, type TeamRole } from "./roles";

export type TeamSummary = { id: number; name: string; slug: string; role: TeamRole; memberCount: number; createdAt: string };
export type TeamMember = { userId: string; email: string; name: string; role: TeamRole; joinedAt: string };
export type TeamInvite = { id: number; email: string; role: TeamRole; invitedBy: string; expiresAt: string; createdAt: string };

/** Raised when the caller is a member but lacks the permission, or is not a member at all. */
export class Forbidden extends Error {
  /** Read by `guarded()` so these surface as 403 rather than 500. */
  readonly status = 403;
  constructor(message = "You do not have access to this team") { super(message); this.name = "Forbidden"; }
}

const INVITE_TTL_DAYS = 14;

/* ---------------- Reads ---------------- */

/** Every team the user belongs to, with their role and the current headcount. */
export async function myTeams(userId: string): Promise<TeamSummary[]> {
  const db = requireDb();
  const rows = await db
    .select({ id: schema.teams.id, name: schema.teams.name, slug: schema.teams.slug, createdAt: schema.teams.createdAt, role: schema.teamMembers.role })
    .from(schema.teamMembers)
    .innerJoin(schema.teams, eq(schema.teams.id, schema.teamMembers.teamId))
    .where(eq(schema.teamMembers.userId, userId))
    .orderBy(asc(schema.teams.name));
  if (rows.length === 0) return [];
  const counts = await db
    .select({ teamId: schema.teamMembers.teamId, n: count() })
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.teamId, rows.map((r) => r.id)))
    .groupBy(schema.teamMembers.teamId);
  const byTeam = new Map(counts.map((c) => [c.teamId, Number(c.n)]));
  return rows.map((r) => ({
    id: r.id, name: r.name, slug: r.slug,
    role: (isTeamRole(r.role) ? r.role : "member"),
    memberCount: byTeam.get(r.id) ?? 1,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** The user's membership row for one team, or null when they are not on it. */
export async function membership(teamId: number, userId: string): Promise<TeamMember | null> {
  const [row] = await requireDb().select().from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, userId)));
  if (!row) return null;
  return { userId: row.userId, email: row.email, name: row.name, role: isTeamRole(row.role) ? row.role : "member", joinedAt: row.joinedAt.toISOString() };
}

/**
 * Assert the user may do `permission` on `teamId`, returning their membership.
 * Every team-scoped route funnels through this so the rules live in one place.
 */
export async function requireTeam(teamId: number, userId: string, permission: TeamPermission): Promise<TeamMember> {
  const m = await membership(teamId, userId);
  if (!m) throw new Forbidden();
  if (!can(m.role, permission)) throw new Forbidden(`Your role (${m.role}) cannot do this`);
  return m;
}

export async function listMembers(teamId: number): Promise<TeamMember[]> {
  const rows = await requireDb().select().from(schema.teamMembers)
    .where(eq(schema.teamMembers.teamId, teamId)).orderBy(asc(schema.teamMembers.joinedAt));
  return rows.map((r) => ({ userId: r.userId, email: r.email, name: r.name, role: isTeamRole(r.role) ? r.role : "member", joinedAt: r.joinedAt.toISOString() }));
}

export async function listInvites(teamId: number): Promise<TeamInvite[]> {
  const rows = await requireDb().select().from(schema.teamInvites)
    .where(and(eq(schema.teamInvites.teamId, teamId), isNull(schema.teamInvites.acceptedAt)))
    .orderBy(desc(schema.teamInvites.createdAt));
  return rows.map((r) => ({ id: r.id, email: r.email, role: isTeamRole(r.role) ? r.role : "member", invitedBy: r.invitedBy, expiresAt: r.expiresAt.toISOString(), createdAt: r.createdAt.toISOString() }));
}

/* ---------------- Writes ---------------- */

/** Create a team and make the creator its owner. */
export async function createTeam(user: CurrentUser, name: string): Promise<TeamSummary> {
  const db = requireDb();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A team needs a name");
  // Slugs are unique; fall back to a short suffix rather than failing the create.
  let slug = slugify(trimmed);
  const [taken] = await db.select({ id: schema.teams.id }).from(schema.teams).where(eq(schema.teams.slug, slug));
  if (taken) slug = `${slug}-${randomBytes(3).toString("hex")}`;
  const [team] = await db.insert(schema.teams).values({ name: trimmed, slug, createdBy: user.id }).returning();
  await db.insert(schema.teamMembers).values({ teamId: team.id, userId: user.id, email: user.email, name: user.name, role: "owner" });
  return { id: team.id, name: team.name, slug: team.slug, role: "owner", memberCount: 1, createdAt: team.createdAt.toISOString() };
}

export async function renameTeam(teamId: number, name: string): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A team needs a name");
  await requireDb().update(schema.teams).set({ name: trimmed, updatedAt: new Date() }).where(eq(schema.teams.id, teamId));
}

export async function deleteTeam(teamId: number): Promise<void> {
  // Members and invitations cascade. An active-team pointer left behind is ignored on read.
  await requireDb().delete(schema.teams).where(eq(schema.teams.id, teamId));
}

/** Invite by email. Re-inviting the same address refreshes the role and token instead of erroring. */
export async function inviteMember(teamId: number, email: string, role: TeamRole, invitedBy: string): Promise<{ token: string; email: string }> {
  const db = requireDb();
  const addr = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) throw new Error(`"${email}" is not a valid email address`);
  if (role === "owner") throw new Error("Ownership is transferred, not invited");
  const existing = await db.select({ id: schema.teamMembers.id }).from(schema.teamMembers)
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.email, addr)));
  if (existing.length) throw new Error(`${addr} is already on this team`);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
  await db.insert(schema.teamInvites).values({ teamId, email: addr, role, token, invitedBy, expiresAt })
    .onConflictDoUpdate({ target: [schema.teamInvites.teamId, schema.teamInvites.email], set: { role, token, invitedBy, expiresAt, acceptedAt: null } });
  return { token, email: addr };
}

export async function revokeInvite(teamId: number, inviteId: number): Promise<void> {
  await requireDb().delete(schema.teamInvites)
    .where(and(eq(schema.teamInvites.id, inviteId), eq(schema.teamInvites.teamId, teamId)));
}

/** Redeem an invite token. Matching is by token; the email on it only has to agree case-insensitively. */
export async function acceptInvite(token: string, user: CurrentUser): Promise<TeamSummary> {
  const db = requireDb();
  const [invite] = await db.select().from(schema.teamInvites).where(eq(schema.teamInvites.token, token));
  if (!invite) throw new Forbidden("That invitation link is not valid");
  if (invite.acceptedAt) throw new Forbidden("That invitation has already been used");
  if (invite.expiresAt.getTime() < Date.now()) throw new Forbidden("That invitation has expired");
  if (user.email && invite.email.toLowerCase() !== user.email.toLowerCase()) {
    throw new Forbidden(`That invitation was sent to ${invite.email}. Sign in as that address to accept it.`);
  }
  const role: TeamRole = isTeamRole(invite.role) ? invite.role : "member";
  await db.insert(schema.teamMembers).values({ teamId: invite.teamId, userId: user.id, email: user.email, name: user.name, role })
    .onConflictDoNothing({ target: [schema.teamMembers.teamId, schema.teamMembers.userId] });
  await db.update(schema.teamInvites).set({ acceptedAt: new Date() }).where(eq(schema.teamInvites.id, invite.id));
  const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, invite.teamId));
  const [{ n }] = await db.select({ n: count() }).from(schema.teamMembers).where(eq(schema.teamMembers.teamId, invite.teamId));
  return { id: team.id, name: team.name, slug: team.slug, role, memberCount: Number(n), createdAt: team.createdAt.toISOString() };
}

/** Change a member's role. The caller must outrank both the target's current and intended role. */
export async function setMemberRole(teamId: number, actor: TeamMember, targetUserId: string, role: TeamRole): Promise<void> {
  const db = requireDb();
  const target = await membership(teamId, targetUserId);
  if (!target) throw new Forbidden("That person is not on this team");
  if (actor.userId === targetUserId) throw new Forbidden("You cannot change your own role");
  if (!canAssignRole(actor.role, target.role, role)) {
    throw new Forbidden("You cannot change someone at or above your own role, or grant a role above it");
  }
  await db.update(schema.teamMembers).set({ role })
    .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)));
}

/** Remove a member, or leave the team yourself. The last owner cannot be removed. */
export async function removeMember(teamId: number, actor: TeamMember, targetUserId: string): Promise<void> {
  const db = requireDb();
  const target = await membership(teamId, targetUserId);
  if (!target) return;
  const leaving = actor.userId === targetUserId;
  if (!leaving && !can(actor.role, "invite")) throw new Forbidden("Your role cannot remove members");
  if (!leaving && !outranks(actor.role, target.role)) throw new Forbidden("You cannot remove someone at or above your own role");
  if (target.role === "owner") {
    const [{ n }] = await db.select({ n: count() }).from(schema.teamMembers)
      .where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.role, "owner")));
    if (Number(n) <= 1) throw new Forbidden("A team needs an owner. Make someone else an owner first.");
  }
  // A stale active-team pointer is harmless: activeTeam() re-checks membership on read.
  await db.delete(schema.teamMembers).where(and(eq(schema.teamMembers.teamId, teamId), eq(schema.teamMembers.userId, targetUserId)));
}

/**
 * Remember which workspace the user last had open, in the existing `profiles.extra` bag.
 *
 * Deliberately not a column: adding one to `profiles` would break every `select()` against that
 * table until the migration ran, and this is a UI preference rather than a relation.
 */
export async function setActiveTeam(userId: string, teamId: number | null): Promise<void> {
  const db = requireDb();
  if (teamId !== null && !(await membership(teamId, userId))) throw new Forbidden();
  const [row] = await db.select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const extra: Record<string, unknown> = { ...(row?.extra ?? {}) };
  if (teamId === null) delete extra.activeTeamId; else extra.activeTeamId = teamId;
  await db.update(schema.profiles).set({ extra, updatedAt: new Date() }).where(eq(schema.profiles.userId, userId));
}

/** The stored active team, ignored when the user is no longer a member (or it was deleted). */
export async function activeTeam(userId: string, extra: unknown): Promise<number | null> {
  const raw = (extra as Record<string, unknown> | null)?.activeTeamId;
  const id = typeof raw === "number" ? raw : null;
  if (id === null) return null;
  return (await membership(id, userId)) ? id : null;
}

/** The team ids a user belongs to, for scoping list queries. */
export async function myTeamIds(userId: string): Promise<number[]> {
  const rows = await requireDb().select({ teamId: schema.teamMembers.teamId }).from(schema.teamMembers)
    .where(eq(schema.teamMembers.userId, userId));
  return rows.map((r) => r.teamId);
}
