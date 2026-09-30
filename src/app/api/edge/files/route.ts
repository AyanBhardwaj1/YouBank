import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { createUpload } from "@/lib/edge/docs/uploads";

export const dynamic = "force-dynamic";

/** Start an upload: { name, mime, bytes, teamId? }. The file then arrives in `parts` pieces of `partBytes`. */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const body = (await req.json().catch(() => null)) as { name?: string; mime?: string; bytes?: number; teamId?: number | null } | null;
    if (!body?.name || !body.bytes) return NextResponse.json({ error: "Name and size are needed." }, { status: 400 });
    const u = await createUpload(user.id, { name: body.name, mime: body.mime ?? "", bytes: body.bytes, teamId: body.teamId ?? null });
    return NextResponse.json({ fileId: u.file.id, parts: u.parts, partBytes: u.partBytes });
  });
}
