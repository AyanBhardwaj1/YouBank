import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { answerQuestion, dismissQuestion } from "@/lib/crm/autopilot";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** Answer a question. With `remember`, the answer joins the playbook for every similar email after. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { answer?: string; remember?: boolean } | null;
    return NextResponse.json(await answerQuestion(user.id, id, body?.answer ?? "", body?.remember !== false));
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await dismissQuestion(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
