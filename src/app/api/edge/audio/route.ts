import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { importAudioUrl } from "@/lib/edge/docs/uploads";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Import a recording from a public audio or video link (a podcast episode, a webcast file) and transcribe it. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { url?: string; title?: string } | null;
    if (!body?.url) return NextResponse.json({ error: "Paste the link to the recording." }, { status: 400 });
    await rateLimit(`edge-audio:${user.id}`, 10, 3_600_000, "Several recordings this hour; try again later.");
    const doc = await importAudioUrl(user.id, body.url, body.title ?? "");
    await ingest(doc.id);
    return NextResponse.json({ docId: doc.id, status: "reading" });
  });
}
