import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { putPart } from "@/lib/edge/docs/uploads";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** One 4 MB piece of a local file's upload: PUT with ?n=<index> and the raw bytes as the body (Edge's own part store). */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedDesktop(req, async (user) => {
    const id = Number((await ctx.params).id), n = Number(new URL(req.url).searchParams.get("n"));
    if (!Number.isInteger(id) || !Number.isInteger(n)) return NextResponse.json({ error: "bad request" }, { status: 400 });
    await putPart(user.id, id, n, new Uint8Array(await req.arrayBuffer()));
    return NextResponse.json({ ok: true });
  }, { device: "required" });
}
