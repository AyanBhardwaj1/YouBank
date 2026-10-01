import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { terrainForAsset, terrainForDetection } from "@/lib/edge/ground";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Terrain from free elevation data (USGS 3DEP lidar or 10 m, else Copernicus 30 m): ?detection=ID reads the
 * ground under a ground change, with the earth its new pad took to level; ?asset=ID gives a pipeline's
 * elevation profile or the ground around a plant.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const detection = Number(q.get("detection")), asset = Number(q.get("asset"));
    await rateLimit(`edge-terrain:${user.id}`, 120, 3_600_000, "Much terrain read this hour; try again in a few minutes.");
    const headers = { "cache-control": "private, max-age=3600" };
    if (Number.isInteger(detection) && detection > 0) return NextResponse.json(await terrainForDetection(user.id, detection), { headers });
    if (Number.isInteger(asset) && asset > 0) return NextResponse.json(await terrainForAsset(user.id, asset), { headers });
    return NextResponse.json({ error: "Pick a finding or an asset." }, { status: 400 });
  });
}
