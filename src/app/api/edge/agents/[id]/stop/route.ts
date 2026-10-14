import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { setStatus } from "@/lib/edge/agent/store";

export const dynamic = "force-dynamic";

/** Stop a thesis for good (owner only); its claims stay in the ledger and are still scored when they resolve. */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Name a thesis." }, { status: 400 });
    return NextResponse.json({ status: await setStatus(user.id, id, "stopped") });
  });
}
