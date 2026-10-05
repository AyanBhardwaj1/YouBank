import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { importAudioUrl } from "@/lib/edge/docs/uploads";
import { rateLimit } from "@/lib/locks";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireReady } from "@/lib/edge/premium";
import { READ_FEATURE, requestPremiumRead } from "@/lib/edge/premium/reading";
import { publicMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Import a recording from a public audio or video link (a podcast episode, a webcast file) and transcribe
 * it; with { speakers: true }, with OpenAI's speaker labels (premium: the plan and the upgrade are
 * checked before anything is downloaded).
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { url?: string; title?: string; speakers?: boolean } | null;
    if (!body?.url) return NextResponse.json({ error: "Paste the link to the recording." }, { status: 400 });
    if (body.speakers === true) { await requireFeature(user, READ_FEATURE.diarize); requireReady(READ_FEATURE.diarize); }
    await rateLimit(`edge-audio:${user.id}`, 10, 3_600_000, "Several recordings this hour; try again later.");
    const doc = await importAudioUrl(user.id, body.url, body.title ?? "");
    let note: string | undefined;
    if (body.speakers === true) { try { await requestPremiumRead(user, doc.id, "diarize"); } catch (e) { note = publicMessage(e); } }
    await ingest(doc.id);
    return NextResponse.json({ docId: doc.id, status: "reading", ...(note ? { note } : {}) });
  });
}
