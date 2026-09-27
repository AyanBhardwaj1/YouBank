import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { newDocument } from "@/lib/studio/create";
import { createDoc, listDocs } from "@/lib/studio/db";
import { TEMPLATES, type TemplateId } from "@/lib/studio/templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The person's models and decks, and the ones shared with their teams. */
export async function GET() {
  return guarded(async (user) => NextResponse.json({ docs: await listDocs(user), templates: TEMPLATES }));
}

/** A new document from a template, filled from SEC data when a ticker is given. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => ({}))) as { template?: string; ticker?: string; peers?: string[]; acquirer?: string; title?: string; teamId?: number | null };
    const template = (TEMPLATES.some((t) => t.id === body.template) ? body.template : "blank") as TemplateId;
    const ticker = body.ticker?.trim().toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10) || null;
    if (TEMPLATES.find((t) => t.id === template)?.ticker && template === "comps" && !ticker) return NextResponse.json({ error: "Trading comps need a ticker" }, { status: 400 });
    const d = await newDocument(template, { ticker, peers: body.peers?.slice(0, 14), acquirer: body.acquirer?.trim().toUpperCase() || null, title: body.title?.trim() });
    const row = await createDoc(user, { ...d, kind: template, ticker: ticker ?? "", teamId: body.teamId ?? null });
    return NextResponse.json({ id: row.id, notes: d.notes });
  });
}
