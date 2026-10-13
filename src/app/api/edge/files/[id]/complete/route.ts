import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { AUDIO, completeUpload, ownFile } from "@/lib/edge/docs/uploads";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireReady } from "@/lib/edge/premium";
import { isPremiumRead, READ_FEATURE, requestPremiumRead } from "@/lib/edge/premium/reading";
import { publicMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
/** Without Inngest, reading happens after the response in this function's time. */
export const maxDuration = 300;

/**
 * Finish an upload: every part is checked, the document is created and reading starts. With
 * { premium: "llamaparse" | "diarize" } the person chose a premium reader for it: the plan and the
 * upgrade are checked before the upload is finished (402 or 409, nothing spent), and a file the reader
 * does not suit (a recording sent to LlamaParse) is read the standard way with a note.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { premium?: { pdf?: string; audio?: string } } | null;
    // The choice is per kind of file: a recording gets the audio choice, anything else the document one.
    // Only that one is checked, so a reader ticked for the other kind never blocks this upload.
    const method = AUDIO.test((await ownFile(user.id, id)).mime) ? body?.premium?.audio : body?.premium?.pdf;
    if (isPremiumRead(method)) { await requireFeature(user, READ_FEATURE[method]); requireReady(READ_FEATURE[method]); }
    const doc = await completeUpload(user.id, id);
    let note: string | undefined;
    if (isPremiumRead(method) && doc.status !== "ready") {
      try { await requestPremiumRead(user, doc.id, method); } catch (e) { note = publicMessage(e); }
    }
    const how = doc.status === "ready" ? "ready" : await ingest(doc.id);
    return NextResponse.json({ docId: doc.id, status: how === "ready" ? "ready" : "reading", ...(note ? { note } : {}) });
  });
}
