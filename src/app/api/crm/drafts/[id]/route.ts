import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { discardDraft, unscheduleDraft, updateDraft } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/** Save a reviewer's edits (saving never sends), or stop autopilot from sending this one. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { subject?: string; body?: string; action?: string } | null;
    if (!body) return NextResponse.json({ error: "That request was incomplete. Reload the page and try again." }, { status: 400 });
    if (body.action === "unschedule") return NextResponse.json(await unscheduleDraft(user.id, id));
    return NextResponse.json(await updateDraft(user.id, id, { subject: body.subject, body: body.body }));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    await discardDraft(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
