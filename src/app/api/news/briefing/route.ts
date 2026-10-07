import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { r2Ready } from "@/lib/edge/infra/r2";
import { withinRate } from "@/lib/locks";
import { freeBriefing, makeBriefing, todaysBriefing, ttsReady, withAudioUrls } from "@/lib/news/audio";
import { VOICES } from "@/lib/news/prefs";
import { readerFor } from "@/lib/news/reader";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The person's audio briefing: the free chapters (read by the browser's voice), today's AI briefing
 * if one was made (with signed links to its audio), and their audio settings.
 */
export async function GET() {
  return guarded(async (user) => {
    const ctx = await readerFor(user.id);
    if (!ctx) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    const [chapters, stored] = await Promise.all([freeBriefing(ctx), todaysBriefing(ctx)]);
    return NextResponse.json({
      chapters, stored: stored ? await withAudioUrls(stored) : null, deskLabel: ctx.desk.label,
      settings: { ...ctx.prefs.audio, voices: VOICES }, neural: { ready: ttsReady(), stored: r2Ready() },
    }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/**
 * { remake?: boolean }: write and voice today's AI briefing (premium, news.audio). Spends only here,
 * on the person's click. Today's is returned as it is unless they ask to remake it (three times a day).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireFeature(user, "news.audio");
    const body = (await req.json().catch(() => ({}))) as { remake?: boolean };
    const ctx = await readerFor(user.id);
    if (!ctx) return NextResponse.json({ error: "Finish onboarding first" }, { status: 409 });
    const existing = await todaysBriefing(ctx);
    if (existing && !body.remake) return NextResponse.json(await withAudioUrls(existing));
    if (!(await withinRate(`news-audio:${user.id}`, existing ? 3 : 4, 20 * 3_600_000))) {
      return NextResponse.json({ error: "You have made today's briefing several times already. It can be made again tomorrow." }, { status: 429 });
    }
    return NextResponse.json(await makeBriefing(ctx, "ai"));
  });
}
