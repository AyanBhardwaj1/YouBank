import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { requireFeature } from "@/lib/billing/entitlements";
import { upgradeOn } from "@/lib/edge/premium";
import { PLANET, planetScenes } from "@/lib/edge/premium/planet";
import type { Bbox } from "@/lib/edge/sources/eia";
import { boxAround } from "@/lib/edge/sources/sentinel";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * Planet's sharper scenes of a plant (?asset=ID) or a finding's place (?detection=ID) from the last 60
 * days under 20% cloud, with thumbnails through /api/edge/planet/thumb. 404 { off: true } until
 * PLANET_API_KEY is set; 402 for a plan without sharper imagery (edge.planet), before Planet is asked.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    if (!upgradeOn("planet")) return NextResponse.json({ off: true }, { status: 404 });
    // Premium (edge.planet): set up for everyone, used by those whose plan includes it; nothing is asked of Planet otherwise.
    await requireFeature(user, "edge.planet");
    const q = new URL(req.url).searchParams;
    const asset = Number(q.get("asset")), detection = Number(q.get("detection"));
    let bbox: Bbox | null = null;
    if (Number.isInteger(asset) && asset > 0) {
      const [a] = (await requireDb().execute(sql`
        select ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets
        where id = ${asset} and kind <> 'pipeline' and (owner_id is null or owner_id = ${user.id})`)).rows as { lon: number; lat: number }[];
      if (a) bbox = boxAround(Number(a.lon), Number(a.lat), 2.5);
    } else if (Number.isInteger(detection) && detection > 0) {
      // The box only (the visual can hold a large overlay image).
      const [d] = await requireDb().select({ box: sql<Bbox | null>`${schema.edgeDetections.visual}->'bbox'`, bbox: schema.edgeDetections.bbox }).from(schema.edgeDetections)
        .where(and(eq(schema.edgeDetections.id, detection), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
      bbox = ((d?.box ?? d?.bbox) as Bbox | null | undefined) ?? null;
    } else {
      return NextResponse.json({ error: "Pick a plant or a finding." }, { status: 400 });
    }
    if (!bbox) return NextResponse.json({ error: "That place is not on the map." }, { status: 404 });
    await rateLimit(`edge-planet:${user.id}`, 120, 3_600_000, "Many Planet searches this hour; try again in a few minutes.");
    const scenes = await planetScenes(bbox);
    return NextResponse.json({ scenes, bbox, source: PLANET.name, license: PLANET.license }, { headers: { "cache-control": "private, max-age=3600" } });
  });
}
