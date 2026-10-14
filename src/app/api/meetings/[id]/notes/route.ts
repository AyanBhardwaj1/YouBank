import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { finishMeeting } from "@/lib/meetings/pipeline";
import { publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Write (or rewrite) a meeting's notes now: a person's click. It counts toward the free monthly
 * allowance, or needs the plan past it, and files the result into Relationships again.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await rateLimit(`meetings-notes:${user.id}`, 20, 86_400_000, "Notes have been rewritten many times today. Try again tomorrow.");
    const r = await finishMeeting(user, id, { force: true });
    return NextResponse.json({ meeting: publicMeeting(r.meeting), crm: r.crm });
  });
}
