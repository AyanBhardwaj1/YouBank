/**
 * Edge's asset store: pipelines and plants from public maps, matched to their listed parents, kept in
 * PostGIS so overlaps, distances and lengths are one query. Public assets are shared by everyone; a
 * person's uploaded or drawn assets (later) are theirs. A region is refreshed at most weekly (the maps
 * change yearly).
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { parentOf } from "./companies";
import { CENSUS_COUNTIES, counties } from "./sources/census";
import { EIA_PIPELINES, EIA_PLANTS, gasPipelines, processingPlants, type AssetInput, type Bbox, type Geometry, type SourceInfo } from "./sources/eia";

export const ASSET_SOURCES: Record<string, SourceInfo> = { [EIA_PIPELINES.key]: EIA_PIPELINES, [EIA_PLANTS.key]: EIA_PLANTS, [CENSUS_COUNTIES.key]: CENSUS_COUNTIES };

export type AssetFeature = {
  type: "Feature"; id: number; geometry: Geometry;
  properties: { id: number; kind: string; name: string; operator: string; company: string; ticker: string; status: string; source: string; attrs: Record<string, unknown> };
};

const WEEK = 7 * 86_400_000;
const regionKey = (bbox: Bbox) => `edge:sync:${bbox.map((v) => v.toFixed(2)).join(",")}`;

async function upsert(rows: AssetInput[]) {
  const db = requireDb();
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200).map((r) => {
      const parent = r.kind === "county" ? null : parentOf(r.operator) ?? (typeof r.attrs.owner === "string" ? parentOf(r.attrs.owner) : null);
      return sql`(${r.source}, ${r.sourceId}, ${r.kind}, ${r.name.slice(0, 200)}, ${r.operator.slice(0, 200)}, ${parent?.company ?? r.operator.slice(0, 200)}, ${parent?.ticker ?? ""}, ${r.status.slice(0, 60)}, ${JSON.stringify({ ...r.attrs, ...(parent ? { parentBasis: parent.basis } : {}) })}::jsonb, ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(r.geometry)}), 4326), now())`;
    });
    await db.execute(sql`
      insert into edge_assets (source, source_id, kind, name, operator, company, ticker, status, attrs, geom, retrieved_at)
      values ${sql.join(chunk, sql`, `)}
      on conflict (source, source_id) do update set kind = excluded.kind, name = excluded.name, operator = excluded.operator, company = excluded.company,
        ticker = excluded.ticker, status = excluded.status, attrs = excluded.attrs, geom = excluded.geom, retrieved_at = now()`);
  }
}

/** Load a region's public assets, unless it was loaded in the last week. Returns how many were loaded (0 when fresh). */
export async function syncRegion(bbox: Bbox, force = false): Promise<number> {
  if (!force && (await cacheGet(regionKey(bbox)))) return 0;
  const [pipes, plants, areas] = await Promise.all([gasPipelines(bbox), processingPlants(bbox), counties(bbox)]);
  await upsert([...pipes, ...plants, ...areas]);
  await cacheSet(regionKey(bbox), String(Date.now()), WEEK);
  return pipes.length + plants.length + areas.length;
}

/** Public assets in a box (and the person's own), optionally for some companies or kinds only. Counties only when asked for. */
export async function assetsIn(bbox: Bbox, opts: { tickers?: string[]; names?: string[]; kinds?: string[]; userId?: string | null; limit?: number; simplify?: number } = {}): Promise<AssetFeature[]> {
  const conds = [sql`geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)`, opts.userId ? sql`(owner_id is null or owner_id = ${opts.userId})` : sql`owner_id is null`];
  // Companies by ticker, or by a name inside the parent or operator (for operators not matched to a listed parent).
  const who = [
    ...(opts.tickers?.length ? [sql`ticker in (${sql.join(opts.tickers.map((t) => sql`${t}`), sql`, `)})`] : []),
    ...(opts.names ?? []).map((n) => { const like = `%${n.replace(/[%_\\]/g, "")}%`; return sql`(company ilike ${like} or operator ilike ${like})`; }),
  ];
  if (who.length) conds.push(sql`(${sql.join(who, sql` or `)})`);
  if (opts.kinds?.length) conds.push(sql`kind in (${sql.join(opts.kinds.map((k) => sql`${k}`), sql`, `)})`);
  else conds.push(sql`kind <> 'county'`);
  const rows = await requireDb().execute(sql`
    select id, kind, name, operator, company, ticker, status, source, attrs,
      ST_AsGeoJSON(${opts.simplify ? sql`ST_SimplifyPreserveTopology(geom, ${opts.simplify})` : sql`geom`}, ${opts.simplify ? 4 : 5}) as geometry
    from edge_assets where ${sql.join(conds, sql` and `)} limit ${opts.limit ?? 5000}`);
  return (rows.rows as { id: number; kind: string; name: string; operator: string; company: string; ticker: string; status: string; source: string; attrs: Record<string, unknown>; geometry: string }[])
    .map((r) => ({ type: "Feature", id: r.id, geometry: JSON.parse(r.geometry) as Geometry, properties: { id: r.id, kind: r.kind, name: r.name, operator: r.operator, company: r.company, ticker: r.ticker, status: r.status, source: r.source, attrs: r.attrs } }));
}

export type CompanyFootprint = { ticker: string; company: string; pipelineKm: number; pipelineSegments: number; plants: number; capacityMMcfd: number };

/** Each company's footprint in a box: kilometres of pipeline inside it, plants and processing capacity. */
export async function footprints(bbox: Bbox, tickers: string[]): Promise<CompanyFootprint[]> {
  if (!tickers.length) return [];
  const rows = await requireDb().execute(sql`
    select ticker, max(company) as company,
      coalesce(sum(case when kind = 'pipeline' then ST_Length(ST_Intersection(geom, ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326))::geography) end), 0) / 1000 as pipeline_km,
      count(*) filter (where kind = 'pipeline') as pipeline_segments,
      count(*) filter (where kind = 'processing_plant') as plants,
      coalesce(sum(case when kind = 'processing_plant' then (attrs->>'capacityMMcfd')::float end), 0) as capacity
    from edge_assets
    where owner_id is null and ticker in (${sql.join(tickers.map((t) => sql`${t}`), sql`, `)})
      and geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
    group by ticker`);
  return (rows.rows as { ticker: string; company: string; pipeline_km: number; pipeline_segments: number; plants: number; capacity: number }[])
    .map((r) => ({ ticker: r.ticker, company: r.company, pipelineKm: Number(r.pipeline_km), pipelineSegments: Number(r.pipeline_segments), plants: Number(r.plants), capacityMMcfd: Number(r.capacity) }));
}

/** The listed companies with assets in a box, biggest pipeline footprint first. */
export async function companiesIn(bbox: Bbox): Promise<{ ticker: string; company: string; assets: number }[]> {
  const rows = await requireDb().execute(sql`
    select ticker, max(company) as company, count(*) as assets from edge_assets
    where owner_id is null and ticker <> '' and geom && ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)
    group by ticker order by count(*) desc`);
  return (rows.rows as { ticker: string; company: string; assets: number }[]).map((r) => ({ ticker: r.ticker, company: r.company, assets: Number(r.assets) }));
}
