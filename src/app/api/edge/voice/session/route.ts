import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { requireReady } from "@/lib/edge/premium";
import { MAX_SECONDS, MIN_SECONDS, mintKey, recordMinutes, SESSIONS_PER_DAY } from "@/lib/edge/voice/realtime";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * Start a live voice session (premium edge.voice-realtime), only when the person presses "Live conversation":
 * mints a one-minute key for the browser's WebRTC connection and records the two-minute minimum.
 */
export async function POST() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await requireFeature(user, "edge.voice-realtime");
    requireReady("edge.voice-realtime");
    await rateLimit(`edge-voice-live:${user.id}`, SESSIONS_PER_DAY, 86_400_000, `${SESSIONS_PER_DAY} live sessions today. Hold-to-talk still works.`);
    const k = await mintKey();
    recordMinutes(MIN_SECONDS, k.model);
    return NextResponse.json({ key: k.key, expiresAt: k.expiresAt, model: k.model, session: randomBytes(9).toString("base64url"), maxSeconds: MAX_SECONDS, minSeconds: MIN_SECONDS });
  });
}
