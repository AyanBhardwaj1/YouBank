import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { MAX_SECONDS, MIN_SECONDS, recordMinutes } from "@/lib/edge/voice/realtime";
import { withinRate } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** End a live session: POST { session, seconds }; records minutes past the two-minute minimum, once per session. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { session?: unknown; seconds?: unknown };
    const session = typeof body.session === "string" ? body.session.slice(0, 40) : "";
    const seconds = Math.min(MAX_SECONDS, Math.max(0, Number(body.seconds) || 0));
    if (!session) return NextResponse.json({ error: "No session to end." }, { status: 400 });
    if (!(await withinRate(`edge-voice-end:${user.id}:${session}`, 1, 86_400_000))) return NextResponse.json({ ok: true, recordedUsd: 0 });
    return NextResponse.json({ ok: true, recordedUsd: recordMinutes(Math.max(0, seconds - MIN_SECONDS)) });
  });
}
