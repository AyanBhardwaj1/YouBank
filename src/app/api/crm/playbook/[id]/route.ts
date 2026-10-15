import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { deletePlaybookEntry, updatePlaybookEntry } from "@/lib/crm/knowledge";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { question?: string; answer?: string } | null;
    return NextResponse.json(await updatePlaybookEntry(user.id, id, body ?? {}));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "That link is not valid. Check it, or go back and open the item again." }, { status: 400 });
    await deletePlaybookEntry(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
