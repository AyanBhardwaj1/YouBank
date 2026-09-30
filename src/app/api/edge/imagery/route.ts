import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { cacheJson } from "@/lib/cache";
import { requireEdge } from "@/lib/edge/access";
import { PLACES } from "@/lib/edge/sources/eia";
import { mosaic, SENTINEL } from "@/lib/edge/sources/sentinel";

export const dynamic = "force-dynamic";

const DAY = 86_400_000;

/** A recent satellite layer for the map: the clearest Sentinel-2 pixels of the last 45 days, as tiles. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const placeKey = new URL(req.url).searchParams.get("place") ?? "permian";
    const place = PLACES[placeKey];
    if (!place) return NextResponse.json({ error: "Unknown place" }, { status: 400 });
    // Anchored to the day so everyone shares one registered search (and the tile cache) per day.
    const day = new Date(Math.floor(Date.now() / DAY) * DAY);
    const from = new Date(day.getTime() - 45 * DAY);
    const layer = await cacheJson(`edge:mosaic:${placeKey}:${day.toISOString().slice(0, 10)}`, DAY, () => mosaic(place.bbox, from, day));
    return NextResponse.json({ ...layer, from: from.toISOString().slice(0, 10), to: day.toISOString().slice(0, 10), attribution: `Contains modified Copernicus Sentinel data ${day.getUTCFullYear()}, via Microsoft Planetary Computer`, license: SENTINEL.license },
      { headers: { "cache-control": "private, max-age=3600" } });
  });
}
