import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { callView } from "@/lib/edge/calls/store";

export const dynamic = "force-dynamic";

/** A call Call Desk has read (E5): its Q&A pairs with their scores, the call's rate, what was avoided, its promises. */
export async function GET(_req: Request, ctx: { params: Promise<{ docId: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const docId = Number((await ctx.params).docId);
    if (!Number.isInteger(docId) || docId <= 0) return NextResponse.json({ error: "Name a document." }, { status: 400 });
    const view = await callView(user.id, docId);
    if (!view) return NextResponse.json({ read: false }, { status: 200 });
    return NextResponse.json({ read: true, ...view });
  });
}
