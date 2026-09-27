import { currentUser } from "@/lib/auth/user";
import { docData, requireDoc } from "@/lib/studio/db";
import { Engine } from "@/lib/studio/engine";
import { exportPptx } from "@/lib/studio/pptx";
import { exportXlsx } from "@/lib/studio/xlsx";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Download the workbook as .xlsx (formulas and values) or the deck as .pptx (native tables and charts). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  const format = new URL(req.url).searchParams.get("format") === "pptx" ? "pptx" : "xlsx";
  let row;
  try { row = await requireDoc(user, id); } catch (e) { return new Response(e instanceof Error ? e.message : "Forbidden", { status: 403 }); }
  const doc = docData(row);
  const engine = new Engine(doc.workbook);
  const buf = format === "pptx" ? await exportPptx(doc, engine) : await exportXlsx(doc, engine);
  const name = `${doc.title.replace(/[^\w\- ().]+/g, "").trim() || "YouBank"}.${format}`;
  const type = format === "pptx" ? "application/vnd.openxmlformats-officedocument.presentationml.presentation" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return new Response(new Uint8Array(buf), { headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "no-store" } });
}
