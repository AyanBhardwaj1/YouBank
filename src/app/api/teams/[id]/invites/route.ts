import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireTeam, revokeInvite } from "@/lib/teams/db";

export const dynamic = "force-dynamic";

/** Withdraw a pending invitation. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    await requireTeam(id, user.id, "invite");
    const body = (await req.json().catch(() => null)) as { inviteId?: number } | null;
    if (!Number.isInteger(body?.inviteId)) return NextResponse.json({ error: "Choose an invitation." }, { status: 400 });
    await revokeInvite(id, body!.inviteId!);
    return NextResponse.json({ ok: true });
  });
}
