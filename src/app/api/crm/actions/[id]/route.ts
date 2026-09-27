import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { approveAction, dismissAction } from "@/lib/crm/actions";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Approve a suggestion. One that involves email produces a draft for review; nothing is sent. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json(await approveAction(user.id, id));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await dismissAction(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
