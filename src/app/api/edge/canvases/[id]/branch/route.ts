import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { branchCanvas } from "@/lib/edge/canvas/store";

export const dynamic = "force-dynamic";

/** Fork a canvas into a variant (a bull and a bear case) that can be compared with it side by side. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { label?: string };
    if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
    const c = await branchCanvas(user, id, body.label ?? "variant");
    return NextResponse.json({ canvas: { id: c.id, title: c.title } });
  });
}
