/**
 * What OpenStreetMap's mappers have drawn at a site, for the digital twin: storage tanks and silos
 * (with their diameter and height where tagged), flare stacks, chimneys and towers, pipelines, data
 * centres, mines and quarries, and works outlines. Read through the public Overpass API for the site's
 * box only, kept a week (Overpass is a shared, free service; a site is one small query). Where a size
 * is not tagged it is estimated from the outline and said to be estimated.
 * © OpenStreetMap contributors, ODbL.
 */
import { cacheJson } from "@/lib/cache";
import type { Bbox, SourceInfo } from "./eia";

export const OSM: SourceInfo = {
  key: "osm-overpass",
  name: "OpenStreetMap, through the Overpass API",
  url: "https://www.openstreetmap.org/copyright",
  license: "© OpenStreetMap contributors, Open Database License (ODbL)",
  vintage: "as mapped today",
};

const ENDPOINT = () => process.env.OVERPASS_URL?.trim() || "https://overpass-api.de/api/interpreter";
const WEEK = 7 * 86_400_000;

type LonLat = [number, number];

export type OsmPoint = { id: string; kind: "tank" | "stack" | "flare" | "tower" | "shaft"; lon: number; lat: number; name: string; heightM: number; diameterM: number; estimated: boolean; content: string };
export type OsmLine = { id: string; kind: "pipeline"; path: LonLat[]; name: string; substance: string; buried: boolean; diameterMm: number | null };
export type OsmArea = { id: string; kind: "datacenter" | "mine" | "works"; ring: LonLat[]; name: string; heightM: number; estimated: boolean; operator: string };
export type OsmSite = { points: OsmPoint[]; lines: OsmLine[]; areas: OsmArea[] };

type Element = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[]; members?: { role?: string; geometry?: { lat: number; lon: number }[] }[] };

/** The Overpass query for a box: facility tags only, with geometry, at most 800 elements. Pure. */
export function overpassQuery(b: Bbox): string {
  const bb = `${b[1].toFixed(6)},${b[0].toFixed(6)},${b[3].toFixed(6)},${b[2].toFixed(6)}`;
  return `[out:json][timeout:25];(
nwr["man_made"~"^(storage_tank|silo|chimney|flare|tower|mast|mineshaft|works|pipeline)$"](${bb});
nwr["building"~"^(storage_tank|silo|data_center)$"](${bb});
nwr["telecom"="data_center"](${bb});
nwr["landuse"="quarry"](${bb});
nwr["industrial"~"^(mine|oil|gas|refinery)$"](${bb});
);out body geom 800;`;
}

/** A length tag in metres ("20", "20 m", "65 ft", "20,5"), or null. Pure. */
export function metresOf(v: string | undefined): number | null {
  if (!v) return null;
  const m = v.trim().replace(",", ".").match(/^(-?\d+(?:\.\d+)?)\s*(m|metres?|meters?|ft|feet|')?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return /^(ft|feet|')$/i.test(m[2] ?? "") ? n * 0.3048 : n;
}

/** Area (m²) and widest span (m) of a ring of lon/lat points, on a local flat projection. Pure. */
export function ringSize(ring: LonLat[]): { areaM2: number; spanM: number; centre: LonLat } {
  if (!ring.length) return { areaM2: 0, spanM: 0, centre: [0, 0] };
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length, lon0 = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180), ky = 110_574;
  const xy = ring.map(([lo, la]) => [(lo - lon0) * kx, (la - lat0) * ky]);
  let a = 0, span = 0;
  for (let i = 0; i < xy.length; i++) { const p = xy[i], q = xy[(i + 1) % xy.length]; a += p[0] * q[1] - q[0] * p[1]; }
  for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) span = Math.max(span, Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]));
  return { areaM2: Math.abs(a) / 2, spanM: span, centre: [lon0, lat0] };
}

const ringOf = (e: Element): LonLat[] => {
  if (e.geometry?.length) return e.geometry.map((g) => [g.lon, g.lat]);
  const outer = e.members?.find((m) => m.role === "outer" && m.geometry?.length);
  return outer?.geometry ? outer.geometry.map((g) => [g.lon, g.lat]) : [];
};

/** Turn an Overpass answer into the twin's points, lines and areas. Pure. */
export function osmSiteFrom(json: { elements?: Element[] } | null | undefined): OsmSite {
  const out: OsmSite = { points: [], lines: [], areas: [] };
  for (const e of json?.elements ?? []) {
    const t = e.tags ?? {};
    const id = `${e.type}/${e.id}`;
    const name = t.name ?? t["name:en"] ?? "";
    const mm = t.man_made ?? "", building = t.building ?? "";
    const ring = e.type === "node" ? [] : ringOf(e);
    const size = ring.length >= 3 ? ringSize(ring) : null;
    const at: LonLat | null = e.type === "node" && e.lat !== undefined && e.lon !== undefined ? [e.lon, e.lat] : size ? size.centre : null;
    const tagH = metresOf(t.height) ?? (t["building:levels"] ? Number(t["building:levels"]) * 3.5 || null : null);
    if (mm === "pipeline") {
      if (e.type === "way" && ring.length >= 2) out.lines.push({ id, kind: "pipeline", path: ring, name, substance: t.substance ?? t.type ?? "", buried: (t.location ?? "underground") !== "overground" && (t.location ?? "") !== "overhead", diameterMm: Number(t.diameter) > 20 ? Number(t.diameter) : null }); // pipeline diameters are tagged in millimetres
      continue;
    }
    if (mm === "storage_tank" || mm === "silo" || building === "storage_tank" || building === "silo") {
      if (!at) continue;
      const tagD = metresOf(t.diameter);
      const d = tagD ?? (size ? Math.max(3, Math.min(120, size.spanM)) : mm === "silo" ? 6 : 12);
      const h = tagH ?? (mm === "silo" || building === "silo" ? Math.max(10, d * 2.2) : Math.max(5, Math.min(16, d * 0.55)));
      out.points.push({ id, kind: "tank", lon: at[0], lat: at[1], name, heightM: round1(h), diameterM: round1(d), estimated: tagD === null || tagH === null, content: t.content ?? t.substance ?? "" });
      continue;
    }
    if (mm === "flare" || mm === "chimney" || (mm === "tower" && /flare/i.test(t["tower:type"] ?? ""))) {
      if (!at) continue;
      const flare = mm === "flare" || /flare/i.test(t["tower:type"] ?? "");
      out.points.push({ id, kind: flare ? "flare" : "stack", lon: at[0], lat: at[1], name, heightM: round1(tagH ?? (flare ? 35 : 45)), diameterM: round1(metresOf(t.diameter) ?? (flare ? 1.2 : 3)), estimated: tagH === null, content: "" });
      continue;
    }
    if (mm === "tower" || mm === "mast") {
      if (!at) continue;
      out.points.push({ id, kind: "tower", lon: at[0], lat: at[1], name, heightM: round1(tagH ?? 30), diameterM: 4, estimated: tagH === null, content: "" });
      continue;
    }
    if (mm === "mineshaft") {
      if (!at) continue;
      out.points.push({ id, kind: "shaft", lon: at[0], lat: at[1], name, heightM: round1(tagH ?? 25), diameterM: 8, estimated: tagH === null, content: t.resource ?? "" });
      continue;
    }
    if (ring.length < 3) continue;
    if (t.telecom === "data_center" || building === "data_center") {
      out.areas.push({ id, kind: "datacenter", ring, name, heightM: round1(tagH ?? 14), estimated: tagH === null, operator: t.operator ?? "" });
    } else if (t.landuse === "quarry" || t.industrial === "mine") {
      out.areas.push({ id, kind: "mine", ring, name, heightM: 0, estimated: false, operator: t.operator ?? "" });
    } else if (mm === "works" || /^(oil|gas|refinery)$/.test(t.industrial ?? "")) {
      out.areas.push({ id, kind: "works", ring, name, heightM: 0, estimated: false, operator: t.operator ?? "" });
    }
  }
  return out;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The OpenStreetMap features at a site's box, kept a week. An Overpass outage gives an empty site, not an error. */
export async function osmSite(bbox: Bbox): Promise<OsmSite> {
  return cacheJson(`edge:osm:v1:${bbox.map((v) => v.toFixed(4)).join(",")}`, WEEK, async () => {
    const res = await fetch(ENDPOINT(), {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/x-www-form-urlencoded", "User-Agent": "YouBank research (Edge digital twin)" },
      body: `data=${encodeURIComponent(overpassQuery(bbox))}`,
    });
    if (!res.ok) throw Object.assign(new Error(`OpenStreetMap's Overpass service answered ${res.status}`), { status: 502 });
    return osmSiteFrom((await res.json()) as { elements?: Element[] });
  });
}
