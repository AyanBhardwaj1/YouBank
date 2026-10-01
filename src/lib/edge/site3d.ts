/**
 * A site in 3D from free public data, read through Microsoft Planetary Computer:
 * - the ground: the newest USDA NAIP aerial photograph (0.6 m), draped on the terrain;
 * - what stands on it: USGS 3DEP lidar's height above ground (2 m).
 * Compact clusters taller than 3 m become structures; the photograph's near-infrared band (a vegetation
 * index) sets trees and scrub apart; round, flat-topped ones of tank size are counted as storage tanks,
 * with their shell volume. As of the lidar survey and the photo's flight, so not live.
 */
import { cellSize, components, pool, quantileSorted, readWindow, stacItems, type StacItem } from "./terrain";
import type { Bbox } from "./sources/eia";
import { boxAround } from "./sources/sentinel";

export const SITE3D_VERSION = "site3d v1";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";
const BARRELS_PER_M3 = 6.2898;

export type Structure = {
  kind: "tank" | "tower" | "structure"; heightM: number; areaM2: number; diameterM: number | null; volumeM3: number | null;
  ring: [number, number][];
};
export type SiteModel = {
  version: string; bbox: Bbox;
  photo: { url: string; date: string; item: string } | null;
  lidar: { survey: string; year: string } | null;
  structures: Structure[];
  counts: { tanks: number; towers: number; structures: number; trees: number };
  tankVolumeM3: number; tankBarrels: number;
  notes: string[];
};

type Grid = { z: Float32Array; valid: Uint8Array; width: number; height: number };

/** The convex hull of points (monotone chain), counter-clockwise. Pure. */
export function convexHull(points: [number, number][]): [number, number][] {
  const p = [...new Map(points.map((q) => [`${q[0]},${q[1]}`, q])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of [...p].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Area and perimeter of a polygon given as a ring of points. Pure. */
export function polygonStats(ring: [number, number][]): { area: number; perimeter: number } {
  let a = 0, per = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    a += x1 * y2 - x2 * y1;
    per += Math.hypot(x2 - x1, y2 - y1);
  }
  return { area: Math.abs(a) / 2, perimeter: per };
}

/**
 * Structures in a height-above-ground grid (metres, cells `cell` metres across): compact clusters at
 * least `minHeight` tall, minus vegetation where a vegetation-index grid on the same cells says so.
 * Rings are in grid coordinates (x right, y down, cell corners). Pure.
 */
export function findStructures(hag: Grid, cell: { x: number; y: number }, ndvi: Grid | null, minHeight = 3): { found: (Omit<Structure, "ring"> & { ring: [number, number][] })[]; trees: number } {
  const { z, valid, width: w, height: h } = hag;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = valid[i] && z[i] >= minHeight && z[i] < 120 ? 1 : 0;
  const cellArea = cell.x * cell.y;
  const out: (Omit<Structure, "ring"> & { ring: [number, number][] })[] = [];
  let trees = 0;
  for (const blob of components(mask, w, h, 1, 6).slice(0, 600)) {
    const hs = Float32Array.from(blob.map((i) => z[i])).sort();
    let green = 0, greenN = 0;
    if (ndvi) for (const i of blob) if (ndvi.valid[i]) { green += ndvi.z[i]; greenN++; }
    if (greenN && green / greenN > 0.18) { trees++; continue; }
    const corners: [number, number][] = [];
    for (const i of blob) { const x = i % w, y = (i - x) / w; corners.push([x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]); }
    const hull = convexHull(corners);
    const { area, perimeter } = polygonStats(hull);
    const areaM2 = blob.length * cellArea;
    const solidity = blob.length / Math.max(1, area);
    if (solidity < 0.5) { trees++; continue; } // scattered canopy rather than one built thing
    const heightM = quantileSorted(hs, 0.9);
    const mean = hs.reduce((a, b) => a + b, 0) / hs.length;
    const sd = Math.sqrt(hs.reduce((a, b) => a + (b - mean) ** 2, 0) / hs.length);
    // A tank is a solid, flat-topped disc: its area fills the circle across its widest span (a square
    // fills 64% of it, a 2:1 block about half), and it stands at least a sixth as tall as it is wide.
    let span = 0;
    for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) span = Math.max(span, Math.hypot((hull[i][0] - hull[j][0]) * cell.x, (hull[i][1] - hull[j][1]) * cell.y));
    const roundness = areaM2 / Math.max(1e-9, Math.PI * (span / 2) ** 2);
    const diameterM = span;
    const tank = roundness >= 0.72 && solidity >= 0.8 && perimeter > 0 && sd / Math.max(0.1, mean) <= 0.25 && diameterM >= 5 && diameterM <= 60 && heightM >= 3 && heightM <= 25 && heightM / diameterM >= 0.15;
    // Tall and slender: a processing column, flare stack or mast.
    const tower = !tank && heightM >= 20 && areaM2 <= 150;
    out.push({
      kind: tank ? "tank" : tower ? "tower" : "structure", heightM: Math.round(heightM * 10) / 10, areaM2: Math.round(areaM2),
      diameterM: tank ? Math.round(diameterM * 10) / 10 : null, volumeM3: tank ? Math.round(Math.PI * (diameterM / 2) ** 2 * heightM) : null, ring: hull,
    });
  }
  return { found: out, trees };
}

const toLonLat = (bbox: Bbox, w: number, h: number) => ([x, y]: [number, number]): [number, number] =>
  [Math.round((bbox[0] + (x / w) * (bbox[2] - bbox[0])) * 1e6) / 1e6, Math.round((bbox[3] - (y / h) * (bbox[3] - bbox[1])) * 1e6) / 1e6];

/** Merge several items' windows of one collection over the same grid (the first valid value wins). */
async function merged(collection: string, items: StacItem[], bbox: Bbox, w: number, h: number, opts: { assets?: string; expression?: string } = {}, resampling = "nearest"): Promise<Grid | null> {
  const wins = await pool(items.slice(0, 6), 3, (it) => readWindow(collection, it.id, bbox, w, h, resampling, opts).catch(() => null));
  const z = new Float32Array(w * h), valid = new Uint8Array(w * h);
  let any = false;
  for (const win of wins) {
    if (!win) continue;
    any = true;
    for (let i = 0; i < z.length; i++) if (!valid[i] && win.valid[i]) { z[i] = win.z[i]; valid[i] = 1; }
  }
  return any ? { z, valid, width: w, height: h } : null;
}

const overlapsBox = (a: number[], b: Bbox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** Model the site around a point: the newest aerial photograph, and its structures from lidar. */
export async function siteModel(lon: number, lat: number, km = 1.6): Promise<SiteModel> {
  const bbox = boxAround(lon, lat, km);
  const notes: string[] = [];
  const [naip, hagItems] = await Promise.all([
    stacItems("naip", bbox, 20).catch(() => [] as StacItem[]),
    stacItems("3dep-lidar-hag", bbox, 30).catch(() => [] as StacItem[]),
  ]);
  // The newest photograph that covers the box (NAIP quarter-quads overlap at their edges).
  const photos = naip.filter((i) => overlapsBox(i.bbox, bbox)).sort((a, b) => String(b.properties.datetime ?? "").localeCompare(String(a.properties.datetime ?? "")));
  const newest = photos[0] ? String(photos[0].properties.datetime ?? "").slice(0, 4) : "";
  const sameYear = photos.filter((p) => String(p.properties.datetime ?? "").startsWith(newest));
  const best = sameYear.find((p) => p.bbox[0] <= bbox[0] && p.bbox[1] <= bbox[1] && p.bbox[2] >= bbox[2] && p.bbox[3] >= bbox[3]) ?? sameYear[0];
  const photo = best ? {
    url: `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(6)).join(",")}/1024x1024.jpg?collection=naip&item=${encodeURIComponent(best.id)}&assets=image&asset_bidx=image%7C1%2C2%2C3`,
    date: String(best.properties.datetime ?? "").slice(0, 10), item: best.id,
  } : null;
  if (!photo) notes.push("No NAIP aerial photograph covers this place (NAIP is the United States only).");
  else if (!sameYear.every((p) => p === best) && !(best.bbox[0] <= bbox[0] && best.bbox[2] >= bbox[2] && best.bbox[1] <= bbox[1] && best.bbox[3] >= bbox[3])) notes.push("The photograph covers most, not all, of the site.");

  // Lidar: the newest survey over the box, its tiles merged on a 2 m grid.
  const surveys = new Map<string, StacItem[]>();
  for (const it of hagItems.filter((i) => overlapsBox(i.bbox, bbox))) { const s = it.id.replace(/-hag.*$/, ""); surveys.set(s, [...(surveys.get(s) ?? []), it]); }
  const latest = [...surveys.entries()].map(([name, list]) => ({ name, list, date: String(list[0].properties.end_datetime ?? list[0].properties.datetime ?? "") })).sort((a, b) => b.date.localeCompare(a.date))[0];
  const cell = { x: 2, y: 2 };
  const size = cellSize(bbox, 1, 1);
  const w = Math.min(900, Math.round(size.x / cell.x)), h = Math.min(900, Math.round(size.y / cell.y));
  let structures: Structure[] = [], trees = 0;
  if (latest) {
    const [hag, ndvi] = await Promise.all([
      merged("3dep-lidar-hag", latest.list, bbox, w, h),
      sameYear.length ? merged("naip", sameYear, bbox, w, h, { assets: "image", expression: "(image_b4-image_b1)/(image_b4+image_b1)" }, "average") : Promise.resolve(null),
    ]);
    if (hag) {
      const real = cellSize(bbox, w, h);
      const found = findStructures(hag, real, ndvi);
      trees = found.trees;
      const ll = toLonLat(bbox, w, h);
      structures = found.found.sort((a, b) => b.areaM2 - a.areaM2).slice(0, 300).map((s) => ({ ...s, ring: [...s.ring.map(ll), ll(s.ring[0])] }));
    }
    notes.push(`Heights are from lidar flown ${latest.date.slice(0, 4)}: anything built since then is missing, and anything removed since is still shown.`);
  } else notes.push("No 3DEP lidar has been flown here yet, so the site has no structures in 3D.");
  if (!sameYear.length) notes.push("Without a photograph's near-infrared band, tall trees cannot be told from structures.");
  const tanks = structures.filter((s) => s.kind === "tank");
  const tankVolumeM3 = tanks.reduce((a, s) => a + (s.volumeM3 ?? 0), 0);
  if (tanks.length) notes.push("A tank's volume is its shell (π r² h from the lidar footprint and height), not its working capacity, which is usually 80 to 90% of that.");
  return {
    version: SITE3D_VERSION, bbox, photo, lidar: latest ? { survey: latest.name, year: latest.date.slice(0, 4) } : null,
    structures, counts: { tanks: tanks.length, towers: structures.filter((x) => x.kind === "tower").length, structures: structures.filter((x) => x.kind === "structure").length, trees },
    tankVolumeM3, tankBarrels: Math.round(tankVolumeM3 * BARRELS_PER_M3), notes,
  };
}
