import { NextResponse } from "next/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { canRead } from "@/lib/edge/docs/store";
import { toneOf, type Turn } from "@/lib/edge/docs/tone";

export const dynamic = "force-dynamic";

/**
 * A cited passage in context for the viewer: the passage and its neighbours, how to open the original
 * (the stored file, or the source's page), and for recordings the speaker's hedging and tone there.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number(new URL(req.url).searchParams.get("chunk"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const db = requireDb();
    const [c] = await db.select().from(schema.edgeChunks).where(eq(schema.edgeChunks.id, id));
    if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const [d] = await db.select().from(schema.edgeDocs).where(eq(schema.edgeDocs.id, c.docId));
    if (!d || !(await canRead(user.id, d))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const around = await db.select({ id: schema.edgeChunks.id, ord: schema.edgeChunks.ord, text: schema.edgeChunks.text, page: schema.edgeChunks.page, tStart: schema.edgeChunks.tStart, speaker: schema.edgeChunks.speaker })
      .from(schema.edgeChunks).where(and(eq(schema.edgeChunks.docId, c.docId), gte(schema.edgeChunks.ord, c.ord - 2), lte(schema.edgeChunks.ord, c.ord + 2))).orderBy(schema.edgeChunks.ord);
    const turns = ((d.meta as { turns?: Turn[] }).turns ?? []);
    return NextResponse.json({
      doc: { id: d.id, title: d.title, source: d.source, url: d.url, mime: d.mime, lang: d.lang, fileId: d.fileId, pages: d.pages, durationSec: d.durationSec, ticker: String((d.meta as { ticker?: string }).ticker ?? ""), form: String((d.meta as { form?: string }).form ?? ""), transcription: String((d.meta as { transcription?: { credit?: string } }).transcription?.credit ?? "") },
      passage: { id: c.id, ord: c.ord, page: c.page, section: c.section, speaker: c.speaker, tStart: c.tStart, tEnd: c.tEnd, text: c.text },
      around, raw: d.fileId ? `/api/edge/files/${d.fileId}/raw` : null,
      tone: turns.length ? toneOf(turns, c.tStart) : null,
    });
  });
}
