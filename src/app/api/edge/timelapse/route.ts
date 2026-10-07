import { NextResponse } from "next/server";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { cacheJson } from "@/lib/cache";
import { requireEdge } from "@/lib/edge/access";
import type { Bbox } from "@/lib/edge/sources/eia";
import { timelapse } from "@/lib/edge/timelapse";

export const dynamic = "force-dynamic";

/**
 * A ground change's site month by month (?detection=ID): the clearest Sentinel-2 scene of each month for two
 * years. &size=1024 gives frames at 1,024 pixels for the 3D time-lapse export (the export feature); the
 * default is 384.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const id = Number(new URL(req.url).searchParams.get("detection"));
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Pick a ground change." }, { status: 400 });
    const size = new URL(req.url).searchParams.get("size") === "1024" ? 1024 : 384;
    if (size > 384) await requireFeature(user, "maps.export");
    // The box only (the visual also holds the change overlay, a large image).
    const [d] = await requireDb().select({ box: sql<Bbox | null>`${schema.edgeDetections.visual}->'bbox'`, bbox: schema.edgeDetections.bbox }).from(schema.edgeDetections)
      .where(and(eq(schema.edgeDetections.id, id), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, user.id))));
    const bbox = (d?.box ?? d?.bbox) as Bbox | null | undefined;
    if (!bbox) return NextResponse.json({ error: "That finding has no place on the map." }, { status: 404 });
    const day = new Date().toISOString().slice(0, 10);
    const frames = await cacheJson(`edge:timelapse:v2:${id}:${size}:${day}`, 86_400_000, () => timelapse(bbox, 24, size));
    return NextResponse.json({ frames }, { headers: { "cache-control": "private, max-age=3600" } });
  });
}
