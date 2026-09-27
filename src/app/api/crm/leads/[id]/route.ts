import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { removeLead, updateLead } from "@/lib/crm/campaigns";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Supply an address, overrule the agent's verdict, or add notes. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { email?: string; status?: string; notes?: string; name?: string } | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await updateLead(user.id, id, body));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await removeLead(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
