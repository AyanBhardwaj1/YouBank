import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { cacheJson } from "@/lib/cache";
import { requireEdge } from "@/lib/edge/access";
import { siteModel } from "@/lib/edge/site3d";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MONTH = 30 * 86_400_000;

/**
 * A site in 3D (?asset=ID for a plant, ?detection=ID for a ground change): the newest aerial photograph
 * and the structures lidar sees there, with storage tanks counted. Shared by everyone and kept a month.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const asset = Number(q.get("asset")), detection = Number(q.get("detection"));
    let at: { lon: number; lat: number } | null = null;
    if (Number.isInteger(asset) && asset > 0) {
      const [a] = (await requireDb().execute(sql`select ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets where id = ${asset} and (owner_id is null or owner_id = ${user.id})`)).rows as { lon: number; lat: number }[];
      if (a) at = { lon: Number(a.lon), lat: Number(a.lat) };
    } else if (Number.isInteger(detection) && detection > 0) {
      const [d] = await requireDb().select({ visual: schema.edgeDetections.visual, bbox: schema.edgeDetections.bbox }).from(schema.edgeDetections)
        .where(and(eq(schema.edgeDetections.id, detection), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
      const site = (d?.visual as { site?: { lon: number; lat: number } } | undefined)?.site;
      const b = d?.bbox as number[] | null | undefined;
      at = site ? { lon: site.lon, lat: site.lat } : b ? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 } : null;
    }
    if (!at) return NextResponse.json({ error: "Pick a plant or a ground change." }, { status: 400 });
    await rateLimit(`edge-site3d:${user.id}`, 60, 3_600_000, "Many site models this hour; try again in a few minutes.");
    const key = `edge:site3d:v1:${at.lon.toFixed(4)},${at.lat.toFixed(4)}`;
    return NextResponse.json(await cacheJson(key, MONTH, () => siteModel(at!.lon, at!.lat)), { headers: { "cache-control": "private, max-age=3600" } });
  });
}
