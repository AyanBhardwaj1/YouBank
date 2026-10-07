import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { getMeetingAt, getUpcomingMeetings } from "@/lib/calendar/meetings";

export const dynamic = "force-dynamic";

/**
 * For the meeting copilot (docs/calendar.md). Signed-in session only.
 * - `GET /api/calendar/upcoming?hours=24` → { meetings: Meeting[] } starting in the next N hours (max 168).
 * - `GET /api/calendar/upcoming?at=<ISO>` → { meeting: Meeting | null }, the meeting happening then.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const q = new URL(req.url).searchParams;
    const at = q.get("at");
    if (at !== null) {
      const t = at ? new Date(at) : new Date();
      if (!Number.isFinite(t.getTime())) return NextResponse.json({ error: "at must be an ISO date-time" }, { status: 400 });
      return NextResponse.json({ meeting: await getMeetingAt(user.id, t, { leadMinutes: Number(q.get("lead") ?? 10) || 10 }) });
    }
    const hours = Math.min(Math.max(Number(q.get("hours") ?? 24) || 24, 1), 168);
    return NextResponse.json({ meetings: await getUpcomingMeetings(user.id, { hours, limit: Number(q.get("limit") ?? 50) || 50 }) });
  });
}
