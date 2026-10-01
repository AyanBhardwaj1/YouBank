import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { permitsNear } from "@/lib/edge/permits";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Drilling permits within 10 km of a plant (?asset=ID), read once a day: New Mexico's with their approval
 * dates, Texas's permitted, undrilled locations (its map has no dates) with those Edge has seen appear.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number(new URL(req.url).searchParams.get("asset"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a plant." }, { status: 400 });
    const [a] = (await requireDb().execute(sql`
      select id, kind, ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat from edge_assets
      where id = ${id} and (owner_id is null or owner_id = ${user.id})`)).rows as { id: number; kind: string; lon: number; lat: number }[];
    if (!a) return NextResponse.json({ error: "That plant is not on the map." }, { status: 404 });
    if (a.kind !== "processing_plant" && a.kind !== "site") return NextResponse.json({ error: "Permits are read around plants and sites." }, { status: 400 });
    await rateLimit(`edge-permits:${user.id}`, 120, 3_600_000, "Many permit lookups this hour; try again in a few minutes.");
    const permits = await permitsNear({ id: Number(a.id), lon: Number(a.lon), lat: Number(a.lat) });
    return NextResponse.json(permits, { headers: { "cache-control": "private, max-age=3600" } });
  });
}
