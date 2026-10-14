import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { briefLines, meetingBrief } from "@/lib/meetings/copilot";
import { getMeeting } from "@/lib/meetings/store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** What Relationships and the research data hold about the people in the meeting. Free: no model. ?fresh=1 rebuilds it. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const brief = await meetingBrief(user.id, await getMeeting(user.id, id), !!new URL(req.url).searchParams.get("fresh"));
    return NextResponse.json({ brief, lines: briefLines(brief) }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}
