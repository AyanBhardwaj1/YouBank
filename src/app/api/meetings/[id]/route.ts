import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { updatePicks } from "@/lib/meetings/pipeline";
import { deleteMeeting } from "@/lib/meetings/store";
import { meetingDetail, publicMeeting } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/** One meeting: transcript, notes, linked contacts and deals, proposed changes and follow-up drafts. A notetaker meeting is brought up to date first. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    return NextResponse.json(await meetingDetail(user, id), { headers: { "Cache-Control": "no-store" } });
  });
}

/** Rename it, or say who and what it was about: { title?, contactIds?, dealIds?, removeContactId? }. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json({ meeting: publicMeeting(await updatePicks(user, id, body)) });
  });
}

/** Delete the meeting, its transcript and its entries on contacts' timelines. Contacts it added stay. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await deleteMeeting(user.id, id);
    return NextResponse.json({ ok: true });
  });
}
