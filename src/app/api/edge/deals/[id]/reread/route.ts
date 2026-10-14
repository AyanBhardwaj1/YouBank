import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { premiumScope } from "@/lib/billing/use";
import { requireEdge } from "@/lib/edge/access";
import { readDeal } from "@/lib/edge/deals/extract";
import { dealById } from "@/lib/edge/deals/store";
import { requireReady } from "@/lib/edge/premium";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-read one deal with the stronger model (premium: edge.deals-reread, about $0.24 a deal, counted in the
 * person's AI allowance). Every term is re-quoted and re-checked; the new readings replace the active ones
 * and the earlier readings stay in the deal's audit trail. Runs only because the person pressed it.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await requireFeature(user, "edge.deals-reread");
    requireReady("edge.deals-reread");
    await rateLimit(`edge-deals-reread:${user.id}`, 10, 3_600_000, "Ten re-reads this hour. Try again later.");
    const id = Number((await ctx.params).id);
    if (!(Number.isInteger(id) && id > 0 && (await dealById(id)))) return NextResponse.json({ error: "That deal is not in the database." }, { status: 404 });
    const model = process.env.EDGE_REREAD_MODEL!.trim();
    const r = await premiumScope(user, { require: ["edge.deals-reread"] }, () => readDeal(id, { deadline: Date.now() + 270_000, model, replace: true, method: `${model} section-read v1 + number check (re-read)` }));
    if (r.error) return NextResponse.json({ error: r.error, result: r }, { status: 429 });
    return NextResponse.json({ ok: true, result: r });
  });
}
