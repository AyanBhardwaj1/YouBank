import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { completeFile } from "@/lib/desktop/files";

export const dynamic = "force-dynamic";
/** Without Inngest, reading happens after the response in this function's time. */
export const maxDuration = 300;

/** Finish a local file's upload: { pathKey, sha256, name, bytes }. The document is created, reading starts, and an older version is retired. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user, device) => {
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => null)) as { pathKey?: string; sha256?: string; name?: string; bytes?: number } | null;
    if (!device || !Number.isInteger(id) || !body?.pathKey || !body.sha256) return NextResponse.json({ error: "bad request" }, { status: 400 });
    return NextResponse.json(await completeFile(user, device, id, { pathKey: body.pathKey, sha256: body.sha256, name: body.name ?? "", bytes: Number(body.bytes ?? 0) }));
  }, { device: "required" });
}
