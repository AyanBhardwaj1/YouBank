/**
 * Sentinel-1 radar (Copernicus, C-band, a pass every six to twelve days by day or night, through cloud)
 * as radiometrically terrain-corrected backscatter through Microsoft's Planetary Computer: scene search
 * by box and window, a box's VV and VH as numbers (linear power, 10 m), and rendered crops. No key.
 * Passes on the same relative orbit look at the ground from the same angle, so their pixels compare.
 */
import { parseNpy } from "../terrain";
import type { Bbox, SourceInfo } from "./eia";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";
const UA = { "User-Agent": "YouBank research (Edge radar)" };

export const S1: SourceInfo = {
  key: "sentinel-1-rtc",
  name: "Copernicus Sentinel-1 radiometrically terrain-corrected backscatter (RTC), via Microsoft Planetary Computer",
  url: "https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc",
  license: "CC BY 4.0 (Microsoft as licensor, Catalyst as processor); contains modified Copernicus Sentinel data",
  vintage: "10 m VV and VH, every 6 to 12 days",
};

export type RadarScene = {
  id: string; date: string; at: string; orbit: "ascending" | "descending"; relOrbit: number; platform: string;
  /** Which corners of the searched box the scene's footprint holds, one bit each (15: all four). */
  corners: number;
};
/** One pass over a box: the scene slices of one acquisition (a box on a slice edge needs both). */
export type RadarPass = { date: string; ids: string[] };
export type RadarWindow = { vv: Float32Array; vh: Float32Array; valid: Uint8Array; coverage: number };

type StacItem = { id: string; properties: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } | null };

/** Whether a point lies inside a polygon ring (ray casting). Pure. */
function inRing(ring: number[][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which corners of a box a footprint (GeoJSON Polygon or MultiPolygon, outer rings) holds, as bits 1, 2, 4, 8; 15 without a footprint. Pure. */
export function cornersIn(geometry: StacItem["geometry"], bbox: Bbox): number {
  const polys = geometry?.type === "Polygon" ? [geometry.coordinates as number[][][]] : geometry?.type === "MultiPolygon" ? (geometry.coordinates as number[][][][]) : null;
  if (!polys) return 15;
  const corners = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]]];
  return corners.reduce((bits, [x, y], k) => (polys.some((poly) => poly[0] && inRing(poly[0], x, y)) ? bits | (1 << k) : bits), 0);
}

/** STAC items as scenes over a box, dropping any without an orbit. Pure. */
export function scenesFrom(items: StacItem[], bbox: Bbox): RadarScene[] {
  return items.flatMap((f) => {
    const p = f.properties, at = String(p.datetime ?? p.start_datetime ?? ""), orbit = p["sat:orbit_state"], rel = Number(p["sat:relative_orbit"]);
    if (!at || (orbit !== "ascending" && orbit !== "descending") || !Number.isFinite(rel)) return [];
    return [{ id: f.id, date: at.slice(0, 10), at, orbit, relOrbit: rel, platform: String(p.platform ?? ""), corners: cornersIn(f.geometry, bbox) }];
  });
}

/** Radar scenes over a box in a window, newest first. */
export async function radarScenes(bbox: Bbox, from: Date, to: Date, limit = 60): Promise<RadarScene[]> {
  const res = await fetch(STAC, {
    method: "POST", headers: { ...UA, "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ collections: ["sentinel-1-rtc"], bbox, datetime: `${from.toISOString()}/${to.toISOString()}`, sortby: [{ field: "datetime", direction: "desc" }], limit }),
  });
  if (!res.ok) throw new Error(`Sentinel-1 search answered ${res.status}`);
  return scenesFrom(((await res.json()) as { features?: StacItem[] }).features ?? [], bbox);
}

/** One scene's VV and VH over a box as a size by size grid (linear power), with where it has data. */
export async function readScene(id: string, bbox: Bbox, size: number): Promise<RadarWindow> {
  const url = `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(5)).join(",")}/${size}x${size}.npy?collection=sentinel-1-rtc&item=${encodeURIComponent(id)}&assets=vv&assets=vh&nodata=-32768`;
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`Sentinel-1 read answered ${res.status}`);
  const { shape, data } = parseNpy(new Uint8Array(await res.arrayBuffer()));
  const n = size * size;
  const vv = new Float32Array(data.subarray(0, n)), vh = new Float32Array(data.subarray(n, 2 * n)), valid = new Uint8Array(n);
  const masked = shape.length === 3 && shape[0] >= 3;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const ok = (!masked || data[2 * n + i] > 0) && Number.isFinite(vv[i]) && vv[i] >= 0 && vv[i] < 1000 && Number.isFinite(vh[i]) && vh[i] >= 0;
    valid[i] = ok ? 1 : 0;
    count += valid[i];
  }
  return { vv, vh, valid, coverage: count / n };
}

/** A pass over a box: its slices read and merged on one grid. */
export async function readPass(pass: RadarPass, bbox: Bbox, size: number): Promise<RadarWindow> {
  const parts = await Promise.all(pass.ids.map((id) => readScene(id, bbox, size)));
  if (parts.length === 1) return parts[0];
  const n = size * size, out: RadarWindow = { vv: new Float32Array(n), vh: new Float32Array(n), valid: new Uint8Array(n), coverage: 0 };
  let count = 0;
  for (let i = 0; i < n; i++) {
    const p = parts.find((w) => w.valid[i]);
    if (p) { out.vv[i] = p.vv[i]; out.vh[i] = p.vh[i]; out.valid[i] = 1; count++; }
  }
  out.coverage = count / n;
  return out;
}

/** A pass as a picture: VV in decibels, grey from -22 dB (smooth ground, black) to +3 dB (steel, white). */
export const radarUrl = (id: string, bbox: Bbox, size = 512) =>
  `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(5)).join(",")}/${size}x${size}.png?collection=sentinel-1-rtc&item=${encodeURIComponent(id)}&expression=${encodeURIComponent("10*log10(vv)")}&asset_as_band=true&rescale=-22,3&nodata=-32768`;
