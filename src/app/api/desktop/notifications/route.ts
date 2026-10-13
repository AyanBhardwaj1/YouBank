import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { desktopFeed, feedSince } from "@/lib/desktop/feed";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * What is new since the app last asked (?since=<ISO time>), for native notifications. Read-only and
 * cheap; the app polls every few minutes and sends back `now` as its next `since`. `kinds` (comma
 * separated: alerts, questions, deals) is what the person chose to be told about on this computer.
 */
export async function GET(req: Request) {
  return guardedDesktop(req, async (user) => {
    await rateLimit(`desktop-feed:${user.id}`, 60, 3_600_000, "Checking for alerts too often. The app will try again shortly.");
    const q = new URL(req.url).searchParams;
    const kinds = new Set((q.get("kinds") ?? "alerts,questions,deals").split(","));
    const now = new Date();
    const items = await desktopFeed(user.id, feedSince(q.get("since"), now.getTime()), { alerts: kinds.has("alerts"), questions: kinds.has("questions"), deals: kinds.has("deals") });
    return NextResponse.json({ now: now.toISOString(), items }, { headers: { "Cache-Control": "no-store" } });
  }, { device: "required" });
}
