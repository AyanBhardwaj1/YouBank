import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { inviteMember, membership, removeMember, requireTeam, setMemberRole } from "@/lib/teams/db";
import { isTeamRole } from "@/lib/teams/roles";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Invite someone by email. Returns the redemption link for the caller to pass on. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireTeam(id, user.id, "invite");
    const body = (await req.json().catch(() => null)) as { email?: string; role?: string } | null;
    const email = body?.email?.trim();
    const role = isTeamRole(body?.role) ? body.role : "member";
    if (!email) return NextResponse.json({ error: "An email address is required" }, { status: 400 });
    const invite = await inviteMember(id, email, role, user.email || user.name || user.id);
    const origin = new URL(req.url).origin;
    return NextResponse.json({ ...invite, role, url: `${origin}/app/team/join?token=${invite.token}` }, { status: 201 });
  });
}

/** Change a member's role. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const me = await requireTeam(id, user.id, "invite");
    const body = (await req.json().catch(() => null)) as { userId?: string; role?: string } | null;
    if (!body?.userId || !isTeamRole(body.role)) return NextResponse.json({ error: "userId and a valid role are required" }, { status: 400 });
    await setMemberRole(id, me, body.userId, body.role);
    return NextResponse.json({ ok: true });
  });
}

/** Remove a member, or leave the team when the target is yourself. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const me = await membership(id, user.id);
    if (!me) return NextResponse.json({ error: "You are not on this team" }, { status: 403 });
    const body = (await req.json().catch(() => null)) as { userId?: string } | null;
    await removeMember(id, me, body?.userId || user.id);
    return NextResponse.json({ ok: true });
  });
}
