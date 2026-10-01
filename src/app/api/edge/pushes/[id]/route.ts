import { NextResponse } from "next/server";
import { decidePush } from "@/lib/edge/push";
import { guardedFor } from "@/lib/office/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Accept (added to the model as one undoable run) or dismiss an Edge push: { action: "accept" | "dismiss" }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guardedFor(req, async (user) => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const b = (await req.json().catch(() => ({}))) as { action?: unknown };
    if (b.action !== "accept" && b.action !== "dismiss") return NextResponse.json({ error: "Accept or dismiss." }, { status: 400 });
    return NextResponse.json(await decidePush(user, id, b.action));
  });
}
