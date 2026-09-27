import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { confirmLesson, setLessonActive } from "@/lib/crm/engine";

export const dynamic = "force-dynamic";

/** Retire a lesson the agent learned from your edits. It stops being applied to new drafts. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await setLessonActive(user.id, id, false);
    return NextResponse.json({ ok: true });
  });
}

/** Confirm a lesson so it applies now, rather than after the agent sees it a second time. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await confirmLesson(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
