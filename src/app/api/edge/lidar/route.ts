import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { placeFrom } from "@/lib/edge/place";
import { MAX_BUDGET, pointCloud } from "@/lib/edge/sources/lidar";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One pass of a site's lidar point cloud (?asset= or ?detection=, &budget= points in all, &pass= from 0,
 * &km= box size 0.4 to 1.6): USGS 3DEP points from the public Entwine copies, as YouBank's compact binary
 * format (src/lib/edge/geo3d/ept.ts). The browser asks for pass 0, reads `passes` from its header and
 * asks for the rest in turn. Part of the Lidar digital twin feature; read only when someone opens it.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await requireFeature(user, "maps.lidar");
    const q = new URL(req.url).searchParams;
    const place = await placeFrom(q, user.id);
    const budget = Math.max(20_000, Math.min(MAX_BUDGET, Number(q.get("budget")) || 250_000));
    const pass = Math.max(0, Math.min(8, Math.floor(Number(q.get("pass")) || 0)));
    const km = Math.max(0.4, Math.min(1.6, Number(q.get("km")) || 1.2));
    const survey = q.get("survey") ?? undefined;
    await rateLimit(`edge-lidar:${user.id}`, 240, 3_600_000, "Many point cloud requests this hour; try again in a few minutes.");
    const cloud = await pointCloud({ lon: place.lon, lat: place.lat, km, budget, pass, survey });
    if (!cloud) return NextResponse.json({ error: "No USGS lidar survey covers this place yet (3DEP is the United States only)." }, { status: 404 });
    return new Response(cloud.bytes as unknown as BodyInit, { headers: { "content-type": "application/octet-stream", "cache-control": "private, max-age=86400" } });
  });
}
