import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { exportSteps } from "@/lib/edge/agent/store";

export const dynamic = "force-dynamic";

/** A thesis's full step log for compliance (E7): GET ?format=csv|json. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Name a thesis." }, { status: 400 });
    const r = await exportSteps(user.id, id, new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv");
    return new Response(r.body, { headers: { "content-type": r.type, "content-disposition": `attachment; filename="${r.name}"` } });
  });
}
