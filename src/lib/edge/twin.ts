/**
 * A site's digital twin from free data, put together for the 3D map: the ground (the same elevation
 * tiles the map's terrain uses), what stands on it, and what runs through it.
 * - Storage tanks, towers and other structures measured by USGS lidar with the newest NAIP aerial photo
 *   (./site3d.ts), where the United States has flown them.
 * - What OpenStreetMap's mappers have drawn there (./sources/osm.ts): tanks with tagged sizes, flare
 *   stacks and chimneys, pipelines, data centres, mines and quarries.
 * - EIA's gas pipelines through the box, as tubes following the ground.
 * - The plant's flaring, when NASA's satellites saw it in the last six weeks: a flame on the stack,
 *   sized by the heat they measured.
 * Every model says where its size came from and whether it was measured, tagged or estimated. Shared by
 * everyone who opens the same site and kept a week; the lidar point cloud itself is separate (and
 * read only when someone asks for it).
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { groundGrid, heightAt, TERRARIUM_SOURCE, type GroundGrid } from "./geo3d/terrarium";
import { siteModel, type SiteModel } from "./site3d";
import { EIA_PIPELINES, type Bbox, type SourceInfo } from "./sources/eia";
import { LIDAR_POINTS, surveysAt } from "./sources/lidar";
import { OSM, osmSite, type OsmArea, type OsmSite } from "./sources/osm";
import { boxAround } from "./sources/sentinel";
import { FIRMS } from "./sources/firms";
import { densify } from "./terrain";
import { metres } from "./flares";

export const TWIN_VERSION = "twin v1";
const SITE_KM = 1.6;
const WEEK = 7 * 86_400_000;
/** Pipelines are drawn this thick (their real diameter, under a metre, would not show at site scale). */
export const TUBE_RADIUS_M = 1.2;

export type TwinModel = {
  id: string; kind: "tank" | "stack" | "flare" | "tower" | "shaft"; lon: number; lat: number; groundM: number;
  heightM: number; diameterM: number; name: string; content: string; volumeM3: number | null;
  /** lidar: measured; osm: tagged by mappers; estimated: a size guessed from the outline or a typical one. */
  basis: "lidar" | "osm" | "estimated";
};
export type TwinFlame = { lon: number; lat: number; groundM: number; stackM: number; intensity: number; frpMw: number; days: number; to: string; detectionId: number; placed: "osm" | "lidar" | "viirs" };
export type TwinTube = { id: string; name: string; substance: string; path: [number, number, number][]; buried: boolean; source: "eia" | "osm" };
export type TwinArea = OsmArea;

export type DigitalTwin = {
  version: string; name: string; center: { lon: number; lat: number }; bbox: Bbox; ground: GroundGrid;
  models: TwinModel[]; flames: TwinFlame[]; tubes: TwinTube[]; areas: TwinArea[];
  /** The aerial photograph and lidar structures (drawn by the map itself as a draped image and extrusions). */
  site: SiteModel | null;
  /** The newest lidar survey with points here, for the point cloud; null outside its coverage. */
  lidar: { survey: string; year: number } | null;
  counts: { tanks: number; stacks: number; flames: number; pipelines: number; datacenters: number; mines: number };
  sources: SourceInfo[]; notes: string[];
};

/* ---------------- Pure pieces ---------------- */

/** A ring's centre (the mean of its corners, the closing point left out). Pure. */
export function ringCentre(ring: [number, number][]): [number, number] {
  const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

/** How strong a flare looks, 0.15 to 1, from the week's radiant heat (MW, summed over detections) and the days it burned. Pure. */
export const flameIntensity = (frpMw: number, days: number) => Math.round(Math.max(0.15, Math.min(1, 0.15 + 0.6 * Math.min(1, frpMw / 40) + 0.25 * Math.min(1, days / 7))) * 100) / 100;

/**
 * Tanks and stacks from lidar and from OpenStreetMap as one list: a mapped feature within a few metres
 * of a measured one is the same object (the measurement wins, the mapper's name is kept). Pure.
 */
export function mergeModels(site: SiteModel | null, osm: OsmSite, ground: (lon: number, lat: number) => number): TwinModel[] {
  const out: TwinModel[] = [];
  for (const [i, s] of (site?.structures ?? []).entries()) {
    if (s.kind === "structure") continue;
    const [lon, lat] = ringCentre(s.ring);
    out.push({
      id: `lidar/${i}`, kind: s.kind === "tank" ? "tank" : "tower", lon, lat, groundM: ground(lon, lat), heightM: s.heightM,
      diameterM: s.diameterM ?? Math.max(2, Math.sqrt(s.areaM2)), name: "", content: "", volumeM3: s.volumeM3, basis: "lidar",
    });
  }
  for (const p of osm.points) {
    const twin = out.find((m) => m.basis === "lidar" && metres(m.lon, m.lat, p.lon, p.lat) <= Math.max(8, p.diameterM / 2));
    if (twin) {
      twin.name ||= p.name;
      twin.content ||= p.content;
      if (p.kind === "flare" || p.kind === "stack") twin.kind = p.kind;
      continue;
    }
    out.push({
      id: p.id, kind: p.kind, lon: p.lon, lat: p.lat, groundM: ground(p.lon, p.lat), heightM: p.heightM, diameterM: p.diameterM, name: p.name, content: p.content,
      volumeM3: p.kind === "tank" ? Math.round(Math.PI * (p.diameterM / 2) ** 2 * p.heightM) : null, basis: p.estimated ? "estimated" : "osm",
    });
  }
  return out.slice(0, 400);
}

/** Lines of lon/lat as tubes that follow the ground, a point every 25 m, raised by the tube's radius. Pure. */
export function tubePaths(lines: [number, number][][], ground: (lon: number, lat: number) => number, lift = TUBE_RADIUS_M + 0.3): [number, number, number][][] {
  const out: [number, number, number][][] = [];
  for (const line of lines) {
    if (line.length < 2) continue;
    const pts = densify([line], 25);
    out.push(pts.map((p) => [Math.round(p.lon * 1e7) / 1e7, Math.round(p.lat * 1e7) / 1e7, Math.round((ground(p.lon, p.lat) + lift) * 10) / 10]));
  }
  return out;
}

/** Where to light a flare: a mapped flare stack or chimney, else the tallest measured tower, within 600 m of the heat; else the heat's own centre. Pure. */
export function flameSite(models: TwinModel[], heat: { lon: number; lat: number }): { lon: number; lat: number; stackM: number; placed: TwinFlame["placed"] } {
  const near = (m: TwinModel) => metres(m.lon, m.lat, heat.lon, heat.lat) <= 600;
  const mapped = models.filter((m) => (m.kind === "flare" || m.kind === "stack") && near(m)).sort((a, b) => metres(a.lon, a.lat, heat.lon, heat.lat) - metres(b.lon, b.lat, heat.lon, heat.lat))[0];
  if (mapped) return { lon: mapped.lon, lat: mapped.lat, stackM: mapped.heightM, placed: mapped.basis === "lidar" ? "lidar" : "osm" };
  const tower = models.filter((m) => m.kind === "tower" && near(m)).sort((a, b) => b.heightM - a.heightM)[0];
  if (tower) return { lon: tower.lon, lat: tower.lat, stackM: tower.heightM, placed: "lidar" };
  return { lon: heat.lon, lat: heat.lat, stackM: 30, placed: "viirs" };
}

/* ---------------- Reading ---------------- */

type Line = [number, number][];

async function eiaPipelines(bbox: Bbox): Promise<{ id: number; name: string; lines: Line[] }[]> {
  const env = sql`ST_MakeEnvelope(${bbox[0]}, ${bbox[1]}, ${bbox[2]}, ${bbox[3]}, 4326)`;
  const rows = (await requireDb().execute(sql`
    select id, coalesce(nullif(name, ''), operator) as name, ST_AsGeoJSON(ST_Intersection(geom, ${env}), 7) as g
    from edge_assets where kind = 'pipeline' and owner_id is null and geom && ${env} limit 40`)).rows as { id: number; name: string; g: string }[];
  return rows.flatMap((r) => {
    const g = JSON.parse(r.g) as { type: string; coordinates: unknown };
    const lines = g.type === "LineString" ? [g.coordinates as Line] : g.type === "MultiLineString" ? (g.coordinates as Line[]) : [];
    return lines.length ? [{ id: Number(r.id), name: r.name, lines }] : [];
  });
}

type FlareRow = { id: number; site: { lon: number; lat: number } | null; stats: { frpTotal?: number; days?: number } | null; hits: { lon: number; lat: number }[] | null; observed: string };

async function recentFlaring(bbox: Bbox, userId: string): Promise<FlareRow[]> {
  const rows = (await requireDb().execute(sql`
    select id, visual->'site' as site, visual->'stats' as stats, visual->'hits' as hits, observed_at::text as observed from edge_detections
    where kind = 'flaring' and (owner_id is null or owner_id = ${userId}) and observed_at > now() - interval '45 days'
      and (visual->'site'->>'lon')::float between ${bbox[0]} and ${bbox[2]} and (visual->'site'->>'lat')::float between ${bbox[1]} and ${bbox[3]}
    order by observed_at desc limit 4`)).rows as FlareRow[];
  return rows;
}

/** The twin of the site around a point. Kept a week per place (shared); the flaring part is read fresh. */
export async function digitalTwin(at: { lon: number; lat: number; name: string }, userId: string): Promise<DigitalTwin> {
  // Kept a week, or an hour when a source failed (so a passing outage is not remembered for a week).
  const key = `edge:twin:v1:${at.lon.toFixed(4)},${at.lat.toFixed(4)}`;
  const hit = await cacheGet(key);
  let base: DigitalTwin;
  if (hit) base = JSON.parse(hit) as DigitalTwin;
  else {
    const built = await twinBase(at);
    base = built.twin;
    await cacheSet(key, JSON.stringify(base), built.partial ? 3_600_000 : WEEK);
  }
  const flames: TwinFlame[] = [];
  try {
    const seen = new Set<string>();
    for (const f of await recentFlaring(base.bbox, userId)) {
      const hits = (f.hits ?? []).filter((h) => Number.isFinite(h.lon) && Number.isFinite(h.lat));
      const heat = hits.length ? { lon: hits.reduce((s, h) => s + h.lon, 0) / hits.length, lat: hits.reduce((s, h) => s + h.lat, 0) / hits.length } : f.site;
      if (!heat) continue;
      const where = flameSite(base.models, { lon: Math.min(base.bbox[2], Math.max(base.bbox[0], heat.lon)), lat: Math.min(base.bbox[3], Math.max(base.bbox[1], heat.lat)) });
      const key = `${where.lon.toFixed(5)},${where.lat.toFixed(5)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const frp = Number(f.stats?.frpTotal) || 0, days = Number(f.stats?.days) || 0;
      flames.push({ ...where, groundM: heightAt(base.ground, where.lon, where.lat), intensity: flameIntensity(frp, days), frpMw: frp, days, to: String(f.observed).slice(0, 10), detectionId: Number(f.id) });
    }
  } catch (e) {
    logError(e, { where: "edge-twin-flaring" });
  }
  const sources = flames.length && !base.sources.some((s) => s.key === FIRMS.key) ? [...base.sources, FIRMS] : base.sources;
  return { ...base, flames, sources, counts: { ...base.counts, flames: flames.length } };
}

async function twinBase(at: { lon: number; lat: number; name: string }): Promise<{ twin: DigitalTwin; partial: boolean }> {
  const bbox = boxAround(at.lon, at.lat, SITE_KM);
  const notes: string[] = [];
  let partial = false;
  const [ground, site, osm, pipes, surveys] = await Promise.all([
    groundGrid(bbox, 64, 14),
    cacheJson(`edge:site3d:v1:${at.lon.toFixed(4)},${at.lat.toFixed(4)}`, 30 * 86_400_000, () => siteModel(at.lon, at.lat)).catch((e) => { logError(e, { where: "edge-twin-site3d" }); partial = true; return null; }),
    osmSite(bbox).catch((e) => { logError(e, { where: "edge-twin-osm" }); partial = true; notes.push("OpenStreetMap's Overpass service did not answer, so mapped tanks, stacks and pipelines are missing; try again later."); return { points: [], lines: [], areas: [] } as OsmSite; }),
    eiaPipelines(bbox).catch(() => []),
    surveysAt(at.lon, at.lat).catch(() => []),
  ]);
  // Elevation tiles that did not load leave flat ground under the models: keep such a twin an hour, not a week.
  if (ground.missing) { partial = true; notes.push("Some of the ground's elevation tiles did not load, so models may not sit exactly on the terrain; try again later."); }
  const h = (lon: number, lat: number) => Math.round(heightAt(ground, lon, lat) * 10) / 10;
  const models = mergeModels(site, osm, h);
  const tubes: TwinTube[] = [
    ...pipes.flatMap((p) => tubePaths(p.lines, h).map((path, i) => ({ id: `eia/${p.id}/${i}`, name: p.name, substance: "gas", path, buried: true, source: "eia" as const }))),
    ...osm.lines.flatMap((l) => tubePaths([l.path], h).map((path) => ({ id: l.id, name: l.name, substance: l.substance, path, buried: l.buried, source: "osm" as const }))),
  ].slice(0, 80);
  const lidar = surveys[0] ? { survey: surveys[0].name, year: surveys[0].year } : null;
  // Lidar's own index says it has flown here but the site model found none: Planetary Computer probably
  // did not answer, so keep this twin for an hour, not a week.
  if (lidar && site && !site.lidar) partial = true;
  if (site?.notes.length) notes.push(...site.notes.slice(0, 2));
  if (tubes.length) notes.push(`Pipelines are drawn ${TUBE_RADIUS_M * 2} m thick along their mapped routes; most are buried, and EIA's lines only approximate where the pipe runs.`);
  if (models.some((m) => m.basis === "estimated")) notes.push("Sizes marked estimated are guessed from a mapped outline or a typical size, not measured.");
  const sources: SourceInfo[] = [TERRARIUM_SOURCE, OSM];
  if (site?.lidar || site?.photo) sources.push({ key: "naip-3dep", name: "USDA NAIP aerial photography and USGS 3DEP lidar heights, via Microsoft Planetary Computer", url: "https://planetarycomputer.microsoft.com/dataset/3dep-lidar-hag", license: "Public domain (USDA, USGS)", vintage: [site.photo ? `photo ${site.photo.date}` : "", site.lidar ? `lidar ${site.lidar.year}` : ""].filter(Boolean).join(", ") });
  if (pipes.length) sources.push(EIA_PIPELINES);
  if (lidar) sources.push(LIDAR_POINTS);
  const twin: DigitalTwin = {
    version: TWIN_VERSION, name: at.name, center: { lon: at.lon, lat: at.lat }, bbox, ground, models, flames: [], tubes, areas: osm.areas.slice(0, 60), site, lidar,
    counts: {
      tanks: models.filter((m) => m.kind === "tank").length, stacks: models.filter((m) => m.kind === "stack" || m.kind === "flare" || m.kind === "tower").length, flames: 0,
      pipelines: tubes.length, datacenters: osm.areas.filter((a) => a.kind === "datacenter").length, mines: osm.areas.filter((a) => a.kind === "mine").length + osm.points.filter((p) => p.kind === "shaft").length,
    },
    sources, notes,
  };
  return { twin, partial };
}
