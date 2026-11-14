import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { globeMarkers } from "@/lib/edge/globe";
import { flareFreshness } from "@/lib/edge/passes";

export const dynamic = "force-dynamic";

/** The globe's markers: every public finding of the last month with a place on the Earth, and how fresh flaring is. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const [markers, flares] = await Promise.all([globeMarkers(), flareFreshness().catch(() => null)]);
    return NextResponse.json({ markers, flares, generatedAt: new Date().toISOString() }, { headers: { "cache-control": "private, max-age=60" } });
  });
}
