/**
 * Team roles and what each one may do.
 *
 * Kept free of any database or server import so client components can render permission-aware UI
 * (hiding an invite button, disabling a delete) from the same rules the API enforces.
 */

export type TeamRole = "owner" | "admin" | "member" | "viewer";

export const TEAM_ROLES: TeamRole[] = ["owner", "admin", "member", "viewer"];

export const ROLE_LABEL: Record<TeamRole, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
  viewer: "Viewer",
};

export const ROLE_BLURB: Record<TeamRole, string> = {
  owner: "Full control, including deleting the team. There is always at least one.",
  admin: "Manage members and invitations, and edit everything the team owns.",
  member: "Create and edit shared work. Cannot change who is on the team.",
  viewer: "Read shared work. Cannot change anything.",
};

/** Higher outranks lower. Used to stop someone editing a peer or promoting above themselves. */
const RANK: Record<TeamRole, number> = { owner: 3, admin: 2, member: 1, viewer: 0 };

export type TeamPermission =
  | "view"           // see the team and its shared work
  | "edit"           // create and change shared work
  | "invite"         // invite and remove members, change their roles
  | "deleteTeam";    // delete the team outright

const GRANTS: Record<TeamRole, TeamPermission[]> = {
  owner: ["view", "edit", "invite", "deleteTeam"],
  admin: ["view", "edit", "invite"],
  member: ["view", "edit"],
  viewer: ["view"],
};

export function can(role: TeamRole, permission: TeamPermission): boolean {
  return GRANTS[role]?.includes(permission) ?? false;
}

export function outranks(a: TeamRole, b: TeamRole): boolean {
  return RANK[a] > RANK[b];
}

/**
 * Whether `actor` may move `target` from their current role to `next`.
 *
 * Two rules: you must outrank the person you are changing, and you may grant any role up to and
 * including your own. An owner can therefore make a second owner, which is the only way to hand a
 * team over or for the last owner to leave.
 */
export function canAssignRole(actor: TeamRole, target: TeamRole, next: TeamRole): boolean {
  return outranks(actor, target) && RANK[next] <= RANK[actor];
}

/** Roles this actor is allowed to hand out, for rendering a role picker. */
export function assignableBy(actor: TeamRole): TeamRole[] {
  return TEAM_ROLES.filter((r) => RANK[r] <= RANK[actor]);
}

export function isTeamRole(v: unknown): v is TeamRole {
  return typeof v === "string" && (TEAM_ROLES as string[]).includes(v);
}

/** URL-safe team slug. Collisions are resolved by the caller appending a suffix. */
export function slugify(name: string): string {
  const base = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return base || "team";
}
