import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { cacheJson } from "@/lib/cache";
import { assetsIn, ensureMaps, type AssetFeature } from "@/lib/edge/assets";
import { PLACES } from "@/lib/edge/sources/eia";

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
    // Public map data is the same for everyone and changes rarely, so it is shared for the day. The map
    // reads only a plant's capacity and a county's id from the attributes, so the rest stay behind.
    const key = `edge:assets:v2:${new Date().toISOString().slice(0, 10)}:${placeKey}:${tickers.join(",")}:${names.join(",").toLowerCase()}:${kinds.join(",")}`;
    const features = await cacheJson(key, 86_400_000, async () => {
      await ensureMaps();
      return (await assetsIn(place.bbox, { tickers, names, kinds, limit: 8000, simplify: 0.001 })).map(slim);
    });
    return NextResponse.json({ type: "FeatureCollection", features }, { headers: { "cache-control": "private, max-age=3600, stale-while-revalidate=86400" } });
  });
}

/** A feature with only the attributes the map draws with. */
function slim(f: AssetFeature): AssetFeature {
  const { capacityMMcfd, geoid } = f.properties.attrs;
  return { ...f, properties: { ...f.properties, attrs: { ...(capacityMMcfd !== undefined ? { capacityMMcfd } : {}), ...(geoid !== undefined ? { geoid } : {}) } } };
}
