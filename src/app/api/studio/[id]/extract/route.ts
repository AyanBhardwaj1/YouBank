import { NextResponse } from "next/server";
import { loadUserContext } from "@/lib/ai/persona";
import { guardedFor } from "@/lib/office/auth";
import { commit, docData, requireDoc } from "@/lib/studio/db";
import { attachmentFrom, extractTables, tablesToSheet } from "@/lib/studio/documents";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** A data-room PDF's financial tables become a new sheet of sourced inputs, each figure tagged with its page. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a PDF" }, { status: 400 });
    const row = await requireDoc(user, id, "edit");
    const doc = docData(row);
    const att = await attachmentFrom(file);
    const { prefs } = await loadUserContext(user.id);
    const x = await extractTables(att, prefs);
    if (!x.tables.length) return NextResponse.json({ event: null, tables: 0, figures: 0, notes: x.notes, error: "No financial tables found in that file." }, { status: 422 });
    const { patch, sheet, figures } = tablesToSheet(doc, x, att.name);
    const ev = await commit(id, doc, [patch], { actor: user.id, actorName: user.name || user.email, label: `Extracted ${x.tables.length} table${x.tables.length === 1 ? "" : "s"} from ${att.name}` });
    return NextResponse.json({ event: { id: ev.id, patches: ev.patches, label: ev.label }, sheet: { id: sheet.id, name: sheet.name }, tables: x.tables.length, figures, notes: x.notes });
  });
}
