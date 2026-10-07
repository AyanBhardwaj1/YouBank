import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { findSlots } from "@/lib/calendar/scheduling";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Free times across all of the person's calendars: { durationMin?, days?, from?, max? }. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { durationMin?: number; days?: number; from?: string; max?: number };
    await rateLimit(`calendar-slots:${user.id}`, 120, 3_600_000, "Too many availability checks this hour. Try again later.");
    const from = body.from ? new Date(body.from) : undefined;
    return NextResponse.json(await findSlots(user.id, {
      durationMin: Math.min(Math.max(Number(body.durationMin) || 30, 5), 480), days: Number(body.days) || 10, max: Number(body.max) || 6,
      from: from && Number.isFinite(from.getTime()) && from.getTime() > Date.now() ? from : undefined, browserTz: req.headers.get("x-timezone"),
    }));
  });
}
