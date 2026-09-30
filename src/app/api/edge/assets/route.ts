import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { assetsIn, ensureMaps } from "@/lib/edge/assets";
import { PLACES } from "@/lib/edge/sources/eia";
import { memo } from "@/lib/memo";

export const dynamic = "force-dynamic";

const KINDS = new Set(["pipeline", "processing_plant", "county"]);

/** Assets on the map as GeoJSON: ?place=permian&tickers=ET,KMI&names=Durango&kinds=pipeline,processing_plant (counties only when asked for). */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const q = new URL(req.url).searchParams;
    const placeKey = q.get("place") ?? "permian";
    const place = PLACES[placeKey];
    if (!place) return NextResponse.json({ error: "Unknown place" }, { status: 400 });
    const tickers = (q.get("tickers") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter((t) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(t)).slice(0, 8).sort();
    const names = (q.get("names") ?? "").split(",").map((n) => n.trim().slice(0, 60)).filter((n) => n.length >= 4).slice(0, 4).sort();
    const kinds = (q.get("kinds") ?? "").split(",").filter((k) => KINDS.has(k)).sort();
    await ensureMaps();
    // Public map data is the same for everyone, so it is shared per instance.
    const features = await memo(`edge:assets:${placeKey}:${tickers.join(",")}:${names.join(",").toLowerCase()}:${kinds.join(",")}`, 10 * 60_000, () => assetsIn(place.bbox, { tickers, names, kinds, limit: 8000, simplify: 0.001 }));
    return NextResponse.json({ type: "FeatureCollection", features }, { headers: { "cache-control": "private, max-age=600" } });
  });
}
