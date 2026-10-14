import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { updatePicks } from "@/lib/meetings/pipeline";
import { getMeeting, transcriptTail } from "@/lib/meetings/store";
import { publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** A meeting's state, for the copilot window and the "notes ready" check; ?tail=1 adds the latest transcript. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const m = await getMeeting(user.id, id);
    const tail = new URL(req.url).searchParams.get("tail") ? await transcriptTail(m.id, 10) : undefined;
    return NextResponse.json({ meeting: publicMeeting(m), ...(tail ? { tail } : {}) }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}

/** Rename, or pick who and what the meeting is about: { title?, contactIds?, dealIds? }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!id || !body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json({ meeting: publicMeeting(await updatePicks(user, id, body)) });
  }, { device: "required" });
}
