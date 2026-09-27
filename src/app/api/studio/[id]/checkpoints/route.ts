import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";
import { createCheckpoint, docData, listCheckpoints, requireDoc } from "@/lib/studio/db";

export const dynamic = "force-dynamic";

/** Named checkpoints of a document, newest first. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    await requireDoc(user, id);
    return NextResponse.json({ checkpoints: await listCheckpoints(id) });
  });
}

/** Save the document as it is now under a name. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as { name?: string } | null;
    const name = body?.name?.trim();
    if (!name) return NextResponse.json({ error: "Name the checkpoint" }, { status: 400 });
    const row = await requireDoc(user, id, "edit");
    return NextResponse.json({ checkpoint: await createCheckpoint(id, user, name, docData(row)) });
  });
}
