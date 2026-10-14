import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { endMeeting } from "@/lib/meetings/pipeline";
import { publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
// Notes are written after the answer (within the person's allowance), so this function stays up long enough.
export const maxDuration = 300;

/** The meeting is over: { discard?: true } deletes it instead of writing notes. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { discard?: unknown } | null;
    return NextResponse.json({ meeting: publicMeeting(await endMeeting(user, id, { discard: body?.discard === true })) });
  }, { device: "required" });
}
