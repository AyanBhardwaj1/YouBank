import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { sitesGeoJson, type SiteKind } from "@/lib/crypto/sites";

export const dynamic = "force-dynamic";

const KINDS = new Set<SiteKind>(["bitcoin_mining", "hosting", "hpc_conversion"]);

/**
 * Bitcoin mining sites and crypto data centres as GeoJSON points (?kinds=bitcoin_mining,hpc_conversion),
 * for the map layer in src/lib/crypto/map-layer.ts. Public data from company filings; the same for
 * everyone, so the browser may keep it for a day.
 */
export async function GET(req: Request) {
  return guarded(async () => {
    const kinds = (new URL(req.url).searchParams.get("kinds") ?? "").split(",").filter((k): k is SiteKind => KINDS.has(k as SiteKind));
    return NextResponse.json(sitesGeoJson(kinds), { headers: { "cache-control": "private, max-age=86400" } });
  });
}
