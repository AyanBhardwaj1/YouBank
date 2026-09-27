import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { createDoc } from "@/lib/studio/db";
import { emptyDeck } from "@/lib/studio/types";
import { importCsv, importXlsx } from "@/lib/studio/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Upload a spreadsheet (.xlsx, .xlsm or .csv): it becomes a live Studio workbook, with an intake report. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Attach a file" }, { status: 400 });
    if (file.size > 4_000_000) return NextResponse.json({ error: "Files up to 4 MB for now" }, { status: 413 });
    const name = file.name || "upload.xlsx";
    const { workbook, intake } = /\.csv$/i.test(name)
      ? importCsv(await file.text(), name)
      : /\.xls[xm]$/i.test(name) ? await importXlsx(await file.arrayBuffer(), name) : (() => { throw Object.assign(new Error("Upload an .xlsx, .xlsm or .csv file"), { status: 400 }); })();
    const row = await createDoc(user, { title: name.replace(/\.[^.]+$/, "").slice(0, 120), workbook, deck: emptyDeck(), comments: [], kind: "upload", intake });
    return NextResponse.json({ id: row.id, intake });
  });
}
