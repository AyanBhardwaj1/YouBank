/**
 * Terrain for what Edge already knows: a ground change (the ground before it, and the earth its new pad
 * took to level), a processing plant (its site), and a pipeline (its elevation profile). Each is read once
 * and kept for a month; a finding's elevation source joins its audit trail.
 */
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheJson } from "@/lib/cache";
import { record } from "./provenance";
import type { Bbox } from "./sources/eia";
import { boxAround } from "./sources/sentinel";
import { demGrid, maskFromOverlay, pipelineProfile, readSite, TERRAIN_VERSION, type PipelineProfile, type SiteTerrain } from "./terrain";

const MONTH = 30 * 86_400_000;
const fail = (message: string, status: number) => Object.assign(new Error(message), { status });

export type AssetTerrain = (SiteTerrain | PipelineProfile) & { asset: { id: number; kind: string; name: string; operator: string; company: string; ticker: string } };

/** The ground under a ground change, read on the grid of its change mask (each mask cell is two by two elevation cells). */
export async function terrainForDetection(userId: string, id: number): Promise<SiteTerrain> {
  const [row] = await requireDb().select().from(schema.edgeDetections)
    .where(and(eq(schema.edgeDetections.id, id), or(isNull(schema.edgeDetections.ownerId), eq(schema.edgeDetections.ownerId, userId))));
  if (!row || row.kind !== "ground_change") throw fail("That finding has no ground to read.", 404);
  return cacheJson(`edge:terrain:v1:detection:${id}`, MONTH, async () => {
    const v = row.visual as { bbox?: Bbox; overlay?: string; before?: { date?: string }; site?: { lon: number; lat: number } };
    const bbox = v.bbox ?? (row.bbox as Bbox | null);
    if (!bbox) throw fail("That finding has no place on the map.", 400);
    const mask = v.overlay ? maskFromOverlay(v.overlay) : null;
    const size = Math.min(768, (mask?.width ?? 256) * 2);
    const grid = await demGrid(bbox, size, size, { before: v.before?.date });
    const t = readSite(grid, mask, v.site ?? null, { changedAfter: v.before?.date });
    await record(`detection:${id}`, [{
      sourceName: t.source.name, sourceUrl: `${t.source.url} (${t.source.items.join(", ")})`, license: t.source.license,
      method: `terrain: ground level, slope and balanced cut and fill under the change (${TERRAIN_VERSION}, ${t.source.resolutionM} m, ${t.source.vintage})`, modelVersion: "", retrievedAt: new Date(),
    }]).catch(() => undefined);
    return t;
  });
}

/** A mapped asset's terrain: a pipeline's elevation profile, or the ground around a plant. */
export async function terrainForAsset(userId: string, id: number): Promise<AssetTerrain> {
  const [a] = (await requireDb().execute(sql`
    select id, kind, name, operator, company, ticker, ST_AsGeoJSON(geom) as g, ST_X(ST_PointOnSurface(geom)) as lon, ST_Y(ST_PointOnSurface(geom)) as lat
    from edge_assets where id = ${id} and (owner_id is null or owner_id = ${userId})`)).rows as { id: number; kind: string; name: string; operator: string; company: string; ticker: string; g: string; lon: number; lat: number }[];
  if (!a) throw fail("That asset is not on the map.", 404);
  const asset = { id: a.id, kind: a.kind, name: a.name, operator: a.operator, company: a.company, ticker: a.ticker };
  if (a.kind === "pipeline") return { ...(await cacheJson(`edge:terrain:v1:asset:${id}`, MONTH, () => pipelineProfile(JSON.parse(a.g)))), asset };
  if (a.kind === "processing_plant" || a.kind === "site") {
    const t = await cacheJson(`edge:terrain:v1:asset:${id}`, MONTH, async () => {
      const lon = Number(a.lon), lat = Number(a.lat);
      return readSite(await demGrid(boxAround(lon, lat, 2), 256, 256), null, { lon, lat });
    });
    return { ...t, asset };
  }
  throw fail("Terrain is read for plants, sites and pipelines.", 400);
}
