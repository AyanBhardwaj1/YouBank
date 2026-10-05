import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { resolveManual } from "@/lib/edge/forecasts/ledger";

export const dynamic = "force-dynamic";

/** Settle one of your own manual questions (a thesis claim with no machine rule): { outcome: 0..1, note }. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const body = (await req.json().catch(() => ({}))) as { outcome?: number; note?: string };
    const ok = await resolveManual(user.id, id, Number(body.outcome), String(body.note ?? "").slice(0, 300));
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Only an open manual question of your own can be settled by hand." }, { status: 404 });
  });
}
