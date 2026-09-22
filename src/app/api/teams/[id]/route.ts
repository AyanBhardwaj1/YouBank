import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { deleteTeam, listInvites, listMembers, renameTeam, requireTeam } from "@/lib/teams/db";
import { can } from "@/lib/teams/roles";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Team detail: members, and pending invitations for those allowed to see them. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const me = await requireTeam(id, user.id, "view");
    const [members, invites] = await Promise.all([
      listMembers(id),
      can(me.role, "invite") ? listInvites(id) : Promise.resolve([]),
    ]);
    return NextResponse.json({ id, me, members, invites });
  });
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireTeam(id, user.id, "invite");
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    if (!body?.name?.trim()) return NextResponse.json({ error: "A team needs a name" }, { status: 400 });
    await renameTeam(id, body.name);
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireTeam(id, user.id, "deleteTeam");
    await deleteTeam(id);
    return NextResponse.json({ ok: true });
  });
}
