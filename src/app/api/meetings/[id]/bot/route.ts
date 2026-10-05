import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { stopBot } from "@/lib/meetings/pipeline";
import { publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Take the notetaker out of the call. What it heard so far still becomes notes. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json({ meeting: publicMeeting(await stopBot(user, id)) });
  });
}
