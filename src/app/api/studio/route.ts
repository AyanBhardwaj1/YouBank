import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { newDocument } from "@/lib/studio/create";
import { createDoc, listDocs } from "@/lib/studio/db";
import { validSnapshot, workbookFromSnapshot } from "@/lib/studio/sync";
import { emptyDeck } from "@/lib/studio/types";
import { jsonBody } from "@/lib/office/body";
import { TEMPLATES, type TemplateId } from "@/lib/studio/templates";
import { isCryptoTemplate } from "@/lib/studio/crypto-templates";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The person's models and decks, and the ones shared with their teams. */
export async function GET(req: Request) {
  return guardedFor(req, async (user) => NextResponse.json({ docs: await listDocs(user), templates: TEMPLATES }));
}

/**
 * A new document from a template, filled from SEC data when a ticker is given; or, from the Excel
 * add-in, a document holding exactly what the open workbook holds.
 */
export async function POST(req: Request) {
  return guardedFor(req, async (user) => {
    const body = ((await jsonBody(req)) ?? {}) as { template?: string; ticker?: string; peers?: string[]; acquirer?: string; title?: string; teamId?: number | null; snapshot?: unknown };
    if (body.snapshot !== undefined) {
      const snap = validSnapshot(body.snapshot);
      if (!snap) return NextResponse.json({ error: "That workbook could not be read. Very large workbooks (over 400,000 cells) are not supported yet." }, { status: 400 });
      const row = await createDoc(user, { title: body.title?.trim().slice(0, 120) || "Excel workbook", workbook: workbookFromSnapshot(snap), deck: emptyDeck(), comments: [], kind: "excel", teamId: body.teamId ?? null });
      return NextResponse.json({ id: row.id, notes: [] });
    }
    const template = (TEMPLATES.some((t) => t.id === body.template) ? body.template : "blank") as TemplateId;
    const ticker = body.ticker?.trim().toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10) || null;
    // Crypto templates take a token symbol or CoinGecko id ("1INCH", "uniswap"), digits and case kept.
    const token = isCryptoTemplate(template) ? body.ticker?.trim().replace(/[^A-Za-z0-9.\-]/g, "").slice(0, 60) || null : null;
    if (TEMPLATES.find((t) => t.id === template)?.ticker && template === "comps" && !ticker) return NextResponse.json({ error: "Trading comps need a ticker" }, { status: 400 });
    const d = await newDocument(template, { ticker: token ?? ticker, peers: body.peers?.slice(0, 14), acquirer: body.acquirer?.trim().toUpperCase() || null, title: body.title?.trim() });
    const row = await createDoc(user, { ...d, kind: template, ticker: ticker ?? "", teamId: body.teamId ?? null });
    return NextResponse.json({ id: row.id, notes: d.notes });
  });
}
