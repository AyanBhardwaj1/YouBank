import { NextResponse } from "next/server";
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";

export const dynamic = "force-dynamic";

const MERGERS = new Set(["acquisition", "merger", "take_private", "tender"]);

/**
 * A Newsroom deal on Edge's map (?story=<story id>): its pro-forma card when the two sides own mapped
 * assets (combined footprint, overlap, the counties that screen high), and either way the parties for
 * the deal what-if.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const story = Number(new URL(req.url).searchParams.get("story"));
    if (!Number.isInteger(story) || story <= 0) return NextResponse.json({ error: "Pick a story." }, { status: 400 });
    const db = requireDb();
    const [deal] = await db.select().from(schema.newsDeals).where(eq(schema.newsDeals.clusterId, story)).limit(1);
    if (!deal || !MERGERS.has(deal.kind)) return NextResponse.json({ deal: null }, { headers: { "cache-control": "private, max-age=300" } });
    const [card] = await db.select({ id: schema.edgeDetections.id, title: schema.edgeDetections.title, summary: schema.edgeDetections.summary, bbox: schema.edgeDetections.bbox, visual: schema.edgeDetections.visual })
      .from(schema.edgeDetections).where(and(eq(schema.edgeDetections.kind, "deal_proforma"), like(schema.edgeDetections.key, `deal:${deal.id}:%`), isNull(schema.edgeDetections.ownerId)))
      .orderBy(desc(schema.edgeDetections.magnitude)).limit(1);
    const parties = [deal.acquirerTicker || deal.acquirer, deal.targetTicker || deal.target].filter(Boolean);
    return NextResponse.json({ deal: { id: deal.id, kind: deal.kind, parties }, card: card ?? null }, { headers: { "cache-control": "private, max-age=300" } });
  });
}
