import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { answerVoice } from "@/lib/edge/voice/answer";
import type { Intent } from "@/lib/edge/voice/router";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const INTENTS: Intent[] = ["odds", "pulse", "precedents", "company", "feed", "thesis", "note", "send", "ask"];
const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

/**
 * The Voice Analyst (free): POST { text, intent?, ticker? } with words the browser recognised (or the realtime
 * session's function call) and get a short script with its citations. Audio never reaches the server.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => ({}))) as { text?: unknown; intent?: unknown; ticker?: unknown };
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 2) return NextResponse.json({ error: "I did not catch that. Hold the button and speak, or type the question." }, { status: 400 });
    await rateLimit(`edge-voice:${user.id}`, 60, 3_600_000, "Sixty voice questions this hour. Try again later.");
    const intent = INTENTS.includes(body.intent as Intent) ? (body.intent as Intent) : undefined;
    const ticker = typeof body.ticker === "string" && TICKER.test(body.ticker.trim().toUpperCase()) ? body.ticker.trim().toUpperCase() : undefined;
    return NextResponse.json(await answerVoice(user.id, text, intent || ticker ? { intent, ticker } : undefined));
  });
}
