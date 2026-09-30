import { NextResponse } from "next/server";
import { loadUserContext } from "@/lib/ai/persona";
import { rateLimit } from "@/lib/locks";
import { guardedFor } from "@/lib/office/auth";
import { commit, docData, requireDoc } from "@/lib/studio/db";
import { attachmentFrom, readMarkup } from "@/lib/studio/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A marked-up printout (PDF or photo) becomes comments on the cells and slides the marks refer to. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await rateLimit(`studio-read:${user.id}`, 20, 3_600_000, "Many documents have been read this hour. Try again later.");
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach the marked-up PDF or photo" }, { status: 400 });
    const row = await requireDoc(user, id, "edit");
    const doc = docData(row);
    const att = await attachmentFrom(file);
    const { prefs } = await loadUserContext(user.id);
    const r = await readMarkup(doc, att, user.name || user.email, prefs);
    if (!r.comments.length) return NextResponse.json({ event: null, added: 0, unplaced: 0, illegible: r.illegible });
    const ev = await commit(id, doc, [{ op: "comments", comments: [...doc.comments, ...r.comments] }], { actor: user.id, actorName: user.name || user.email, label: `${r.comments.length} comment${r.comments.length === 1 ? "" : "s"} from ${att.name}` });
    return NextResponse.json({ event: { id: ev.id, patches: ev.patches, label: ev.label }, added: r.comments.length, unplaced: r.unplaced, illegible: r.illegible });
  });
}
