import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listMeetings } from "@/lib/calendar/meetings";
import { createMeeting, type CreateInput } from "@/lib/calendar/write";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DAY = 86_400_000;

/** Meetings overlapping ?from=&to= (ISO), from the stored window. At most 62 days at a time. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const from = new Date(q.get("from") ?? Date.now() - 7 * DAY);
    const to = new Date(q.get("to") ?? from.getTime() + 14 * DAY);
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || to <= from) return NextResponse.json({ error: "Give a from and a to date." }, { status: 400 });
    if (to.getTime() - from.getTime() > 62 * DAY) return NextResponse.json({ error: "Ask for at most two months at a time." }, { status: 400 });
    return NextResponse.json({ meetings: await listMeetings(user.id, from, to) });
  });
}

/** Create a meeting in one of the person's calendars, and invite people when asked. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as CreateInput | null;
    if (!body?.title || !body.start || !body.end) return NextResponse.json({ error: "A title, a start and an end are needed." }, { status: 400 });
    await rateLimit(`calendar-write:${user.id}`, 60, 3_600_000, "That is a lot of meetings this hour. Try again later.");
    const meeting = await createMeeting(user, { ...body, browserTz: req.headers.get("x-timezone") });
    return NextResponse.json({ meeting }, { status: 201 });
  });
}
