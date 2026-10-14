import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { dealById } from "@/lib/edge/deals/store";
import { byFamily, footballField, shownFields, timeline } from "@/lib/edge/deals/view";
import { trailFor } from "@/lib/edge/provenance";
import { canUse } from "@/lib/billing/entitlements";
import { featureReady } from "@/lib/edge/premium";

export const dynamic = "force-dynamic";

/**
 * One deal (E1, free): its headline terms, every extracted field with its quote, document, section, checks
 * and confidence, grouped by family; the sale process as a timeline; the fairness ranges for the football
 * field; the documents read and the audit trail; and whether the person may re-read it with the stronger
 * model (premium) or read a stub now (free).
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number((await ctx.params).id);
    const d = Number.isInteger(id) && id > 0 ? await dealById(id) : null;
    if (!d) return NextResponse.json({ error: "That deal is not in the database." }, { status: 404 });
    const fields = shownFields(d.fields);
    const trail = await trailFor([`deal:${id}`]);
    return NextResponse.json({
      deal: d.deal, hasVector: d.hasVector, families: byFamily(fields), timeline: timeline(fields, { announcedAt: d.deal.announcedAt, signedAt: d.deal.signedAt, closedAt: d.deal.closedAt }),
      football: footballField(fields), trail: trail.map((t) => ({ name: t.sourceName, url: t.sourceUrl, license: t.license, method: t.method, modelVersion: t.modelVersion, retrievedAt: t.retrievedAt.toISOString() })),
      actions: { read: !d.deal.extractedAt, reread: { allowed: await canUse(user, "edge.deals-reread"), ready: featureReady("edge.deals-reread") } },
    }, { headers: { "cache-control": "private, max-age=30" } });
  });
}
