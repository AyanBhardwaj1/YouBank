import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { discardDraft, updateDraft } from "@/lib/crm/db";

export const dynamic = "force-dynamic";

/** Save a reviewer's edits. Saving never sends. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { subject?: string; body?: string } | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await updateDraft(user.id, id, { subject: body.subject, body: body.body }));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await discardDraft(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
