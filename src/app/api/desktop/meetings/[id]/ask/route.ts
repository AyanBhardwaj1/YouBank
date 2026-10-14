import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { askMeeting } from "@/lib/meetings/copilot";

export const dynamic = "force-dynamic";
export const maxDuration = 90;

/** "Ask about this meeting" in the copilot window: { question }. Within the daily AI allowance. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { question?: unknown } | null;
    return NextResponse.json(await askMeeting(user, id, typeof body?.question === "string" ? body.question : ""));
  }, { device: "required" });
}
