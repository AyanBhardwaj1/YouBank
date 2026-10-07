import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { fileNameHeader, MAX_PUSH_BYTES, pushWorkbook } from "@/lib/desktop/office";
import { errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";
import { docData, lastEventId, requireDoc } from "@/lib/studio/db";
import { Engine } from "@/lib/studio/engine";
import { exportPptx } from "@/lib/studio/pptx";
import { exportXlsx } from "@/lib/studio/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const parseId = (v: string) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

/**
 * Pull: the document as a real file (?format=xlsx or pptx), built by Studio's own export, with the
 * change it reflects in `x-youbank-cursor` so a later push can tell whether Studio moved on meanwhile.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await rateLimit(`studio-export:${user.id}`, 30, 600_000, "Many files have been built in the last few minutes. Try again shortly.");
    const format = new URL(req.url).searchParams.get("format") === "pptx" ? "pptx" : "xlsx";
    // The cursor is read before the document, so an edit landing in between is caught by the next push.
    const cursor = await lastEventId(id);
    const doc = docData(await requireDoc(user, id));
    const engine = new Engine(doc.workbook);
    const buf = format === "pptx" ? await exportPptx(doc, engine) : await exportXlsx(doc, engine);
    const name = `${doc.title.replace(/[^\w\- ().]+/g, "").trim() || "YouBank"}.${format}`;
    const type = format === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    return new Response(new Uint8Array(buf), {
      headers: { "Content-Type": type, "Cache-Control": "no-store", "x-youbank-cursor": String(cursor), "x-youbank-filename": encodeURIComponent(name) },
    });
  }, { device: "required" });
}

/**
 * Push: a local .xlsx (the raw file as the body) becomes one undoable change in Studio.
 * `x-youbank-base` is the cursor the file was pulled at; `?force=1` overwrites newer Studio changes.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = parseId((await ctx.params).id);
    if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await rateLimit(`desktop-push:${user.id}`, 120, 3_600_000, "Many syncs in the last hour. Your file is safe; try again shortly.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_PUSH_BYTES) return NextResponse.json({ error: "Files up to 4 MB can be synced for now." }, { status: 413 });
    const rawBase = req.headers.get("x-youbank-base");
    const base = rawBase && /^\d+$/.test(rawBase) ? Number(rawBase) : null;
    const name = fileNameHeader(req.headers.get("x-youbank-filename"), "Workbook.xlsx");
    try {
      return NextResponse.json(await pushWorkbook(user, id, new Uint8Array(await req.arrayBuffer()), { name, base, force: new URL(req.url).searchParams.get("force") === "1" }));
    } catch (e) {
      const cursor = (e as { cursor?: unknown }).cursor;
      return errorResponse(e, 400, typeof cursor === "number" ? { cursor } : {});
    }
  }, { device: "required" });
}
