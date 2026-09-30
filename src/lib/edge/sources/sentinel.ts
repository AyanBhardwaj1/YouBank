/**
 * Sentinel-2 imagery (Copernicus open data, 10 m, a new pass every five days or so) through Microsoft's
 * Planetary Computer: scene search by box and date, and true-colour crops of any box, rendered on
 * request. No key and no bill. Crops of the same box from two scenes line up pixel for pixel, which is
 * what change detection compares.
 */
import type { Bbox, SourceInfo } from "./eia";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";

export const SENTINEL: SourceInfo = {
  key: "sentinel-2",
  name: "Copernicus Sentinel-2 L2A, via Microsoft Planetary Computer",
  url: "https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a",
  license: "Copernicus open data licence (free use with attribution: contains modified Copernicus Sentinel data)",
  vintage: "10 m true colour",
};

export type Scene = { id: string; date: string; cloud: number };

type StacItem = { id: string; properties: { datetime: string; "eo:cloud_cover"?: number } };

/** Scenes over a box in a date window with little cloud, newest first. */
export async function scenes(bbox: Bbox, from: Date, to: Date, maxCloud = 5, limit = 10): Promise<Scene[]> {
  const res = await fetch(STAC, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      collections: ["sentinel-2-l2a"], bbox, datetime: `${from.toISOString()}/${to.toISOString()}`,
      query: { "eo:cloud_cover": { lt: maxCloud } }, sortby: [{ field: "datetime", direction: "desc" }], limit,
    }),
  });
  if (!res.ok) throw new Error(`Sentinel-2 search answered ${res.status}`);
  const j = (await res.json()) as { features?: StacItem[] };
  return (j.features ?? []).map((f) => ({ id: f.id, date: f.properties.datetime.slice(0, 10), cloud: Number(f.properties["eo:cloud_cover"] ?? 0) }));
}

/** The clearest scene within `windowDays` of a date, or null. */
export async function clearestNear(bbox: Bbox, when: Date, windowDays = 30): Promise<Scene | null> {
  const day = 86_400_000;
  const found = await scenes(bbox, new Date(when.getTime() - windowDays * day), new Date(Math.min(Date.now(), when.getTime() + windowDays * day)), 5, 20);
  return found.sort((a, b) => a.cloud - b.cloud || b.date.localeCompare(a.date))[0] ?? null;
}

/** A true-colour crop of a box from one scene, as a PNG URL (transparent where the scene has no data). */
export const cropUrl = (scene: Scene, bbox: Bbox, size = 256) =>
  `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(5)).join(",")}/${size}x${size}.png?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0`;

/** The scene-classification band for the same box (cloud, shadow, water, bare ground...), class values as pixels. */
export const classesUrl = (scene: Scene, bbox: Bbox, size = 256) =>
  `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(5)).join(",")}/${size}x${size}.png?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&assets=SCL&nodata=0&resampling=nearest`;

async function get(url: string): Promise<Buffer> {
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Sentinel-2 crop answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export const crop = (scene: Scene, bbox: Bbox, size = 256) => get(cropUrl(scene, bbox, size));
export const classes = (scene: Scene, bbox: Bbox, size = 256) => get(classesUrl(scene, bbox, size));

/**
 * A light-cloud Sentinel-2 mosaic of a box over a date window, as an XYZ tile template for the map. The
 * search is registered once and named by its hash, so the same window gives the same tiles (and cache).
 */
export async function mosaic(bbox: Bbox, from: Date, to: Date, maxCloud = 10): Promise<{ tiles: string; minzoom: number; maxzoom: number }> {
  const res = await fetch(`${DATA}/mosaic/register`, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ collections: ["sentinel-2-l2a"], bbox, datetime: `${from.toISOString()}/${to.toISOString()}`, query: { "eo:cloud_cover": { lt: maxCloud } }, sortby: [{ field: "eo:cloud_cover", direction: "asc" }] }),
  });
  if (!res.ok) throw new Error(`Sentinel-2 mosaic answered ${res.status}`);
  const j = (await res.json()) as { id?: string; searchid?: string };
  const id = j.id ?? j.searchid;
  if (!id) throw new Error("Sentinel-2 mosaic returned no id");
  return { tiles: `${DATA}/mosaic/${id}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0&collection=sentinel-2-l2a`, minzoom: 8, maxzoom: 16 };
}

/** A square box of `km` a side centred on a point. */
export function boxAround(lon: number, lat: number, km: number): Bbox {
  const dLat = km / 2 / 110.574;
  const dLon = km / 2 / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}
