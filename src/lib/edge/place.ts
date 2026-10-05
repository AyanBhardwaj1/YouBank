/**
 * The place a 3D view is about, from the request: a mapped plant or pipeline (?asset=ID) or a finding
 * (?detection=ID), as a point with its name. Only places the person may see: shared public assets and
 * findings, or their own. Shared by the digital twin, the point cloud and the scene analyses.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { Bbox } from "./sources/eia";

export type Place = { lon: number; lat: number; name: string; kind: string; assetId: number | null; detectionId: number | null; bbox: Bbox | null };

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const missing = (message: string) => Object.assign(new Error(message), { status: 404 });

/** Resolve ?asset= or ?detection= to a place, or throw a plain 400/404. */
export async function placeFrom(q: URLSearchParams | Record<string, unknown>, userId: string): Promise<Place> {
  const get = (k: string) => (q instanceof URLSearchParams ? q.get(k) : q[k]);
  const asset = Number(get("asset")), detection = Number(get("detection"));
  if (Number.isInteger(asset) && asset > 0) {
    const [a] = (await requireDb().execute(sql`
      select ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat, name, kind, operator from edge_assets
      where id = ${asset} and (owner_id is null or owner_id = ${userId})`)).rows as { lon: number; lat: number; name: string; kind: string; operator: string }[];
    if (!a) throw missing("That plant or pipeline is not on the map.");
    return { lon: Number(a.lon), lat: Number(a.lat), name: a.name || a.operator || "The site", kind: a.kind, assetId: asset, detectionId: null, bbox: null };
  }
  if (Number.isInteger(detection) && detection > 0) {
    // The site and box only (the visual can hold a large overlay image).
    const [d] = await requireDb().select({
      site: sql<{ lon: number; lat: number; name?: string } | null>`${schema.edgeDetections.visual}->'site'`, box: sql<Bbox | null>`${schema.edgeDetections.visual}->'bbox'`,
      bbox: schema.edgeDetections.bbox, title: schema.edgeDetections.title, kind: schema.edgeDetections.kind,
    }).from(schema.edgeDetections).where(and(eq(schema.edgeDetections.id, detection), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, userId))));
    if (!d) throw missing("That finding is not available.");
    const b = (d.box ?? d.bbox) as Bbox | null;
    const at = d.site ? { lon: Number(d.site.lon), lat: Number(d.site.lat) } : b ? { lon: (b[0] + b[2]) / 2, lat: (b[1] + b[3]) / 2 } : null;
    if (!at || !Number.isFinite(at.lon) || !Number.isFinite(at.lat)) throw missing("That finding has no place on the map.");
    return { ...at, name: d.site?.name || d.title, kind: d.kind, assetId: null, detectionId: detection, bbox: b };
  }
  throw bad("Pick a plant, a pipeline or a finding.");
}
