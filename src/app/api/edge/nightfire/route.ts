import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { requireEdge } from "@/lib/edge/access";
import { upgradeOn } from "@/lib/edge/premium";
import { flareVolumes } from "@/lib/edge/premium/nightfire";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Whether Nightfire is set up, so a plant's panel can offer it. Reads nothing from EOG. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    return NextResponse.json({ ready: upgradeOn("nightfire") });
  });
}

/**
 * A plant's flare volumes from VIIRS Nightfire over the last week: { asset }. Premium (edge.nightfire):
 * the plan is checked before anything is read; each night's file is kept a week once read.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    await requireFeature(user, "edge.nightfire");
    if (!upgradeOn("nightfire")) return NextResponse.json({ error: "Nightfire is not switched on yet. An administrator needs to set it up first." }, { status: 409 });
    const body = (await req.json().catch(() => null)) as { asset?: number } | null;
    const asset = Number(body?.asset);
    if (!Number.isInteger(asset) || asset <= 0) return NextResponse.json({ error: "Pick a plant." }, { status: 400 });
    const [a] = (await requireDb().execute(sql`
      select ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets
      where id = ${asset} and kind <> 'pipeline' and (owner_id is null or owner_id = ${user.id})`)).rows as { lon: number; lat: number }[];
    if (!a) return NextResponse.json({ error: "That plant is not on the map." }, { status: 404 });
    await rateLimit(`edge-nightfire:${user.id}`, 60, 3_600_000, "Many flare lookups this hour; try again in a few minutes.");
    return NextResponse.json(await flareVolumes(Number(a.lon), Number(a.lat)), { headers: { "cache-control": "private, no-store" } });
  });
}
