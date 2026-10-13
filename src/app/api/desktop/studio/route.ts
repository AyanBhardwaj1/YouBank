import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { createFromWorkbook, fileNameHeader, MAX_PUSH_BYTES } from "@/lib/desktop/office";
import { rateLimit } from "@/lib/locks";
import { listDocs } from "@/lib/studio/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The person's Studio models and decks (and their teams'), for "Pull to this computer". */
export async function GET(req: Request) {
  return guardedDesktop(req, async (user) => {
    const docs = await listDocs(user);
    return NextResponse.json({ docs: docs.map((d) => ({ id: d.id, title: d.title, kind: d.kind, ticker: d.ticker, sheets: d.sheets, slides: d.slides, mine: d.mine, updatedAt: d.updatedAt })) });
  }, { device: "required" });
}

/**
 * Link a local workbook that is not in Studio yet: the raw .xlsx is the body and `x-youbank-filename`
 * its name. It becomes a new Studio document; the app then keeps the two in step.
 */
export async function POST(req: Request) {
  return guardedDesktop(req, async (user) => {
    await rateLimit(`desktop-studio-new:${user.id}`, 30, 3_600_000, "Many workbooks have been linked in the last hour. Try again later.");
    if (Number(req.headers.get("content-length") ?? 0) > MAX_PUSH_BYTES) return NextResponse.json({ error: "Files up to 4 MB can be linked for now." }, { status: 413 });
    const name = fileNameHeader(req.headers.get("x-youbank-filename"), "Workbook.xlsx");
    if (!/\.xls[xm]$/i.test(name)) return NextResponse.json({ error: "Only Excel workbooks (.xlsx, .xlsm) can be linked to Studio." }, { status: 400 });
    return NextResponse.json(await createFromWorkbook(user, new Uint8Array(await req.arrayBuffer()), name));
  }, { device: "required" });
}
