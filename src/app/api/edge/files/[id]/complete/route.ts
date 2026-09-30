import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { ingest } from "@/lib/edge/docs/ingest";
import { completeUpload } from "@/lib/edge/docs/uploads";

export const dynamic = "force-dynamic";
/** Without Inngest, reading happens after the response in this function's time. */
export const maxDuration = 300;

/** Finish an upload: every part is checked, the document is created and reading starts. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const doc = await completeUpload(user.id, id);
    const how = doc.status === "ready" ? "ready" : await ingest(doc.id);
    return NextResponse.json({ docId: doc.id, status: how === "ready" ? "ready" : "reading" });
  });
}
