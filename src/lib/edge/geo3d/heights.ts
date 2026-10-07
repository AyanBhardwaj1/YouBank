/**
 * Heights from the free elevation tiles the 3D map draws its terrain with (AWS Open Data's Terrain
 * Tiles, Terrarium encoding), and a site's ground grid read from them: the pure half, safe in the
 * browser (the layers stand models on these heights). Reading tiles is in ./terrarium.ts (server).
 */
import type { Bbox, SourceInfo } from "../sources/eia";

export const TERRARIUM_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_SOURCE: SourceInfo = {
  key: "terrain-tiles", name: "Terrain Tiles on AWS Open Data (USGS 3DEP, SRTM, GMTED and others)",
  url: "https://registry.opendata.aws/terrain-tiles/", license: "Public domain and open licences; attribution as listed by Mapzen/Tilezen", vintage: "a mosaic of surveys, finest 1 to 10 m in the US",
};

/** A Terrarium pixel's height in metres. Pure. */
export const terrariumHeight = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** Fractional tile coordinates of a point at a zoom (Web Mercator, XYZ). Pure. */
export function tileXY(lon: number, lat: number, z: number): [number, number] {
  const n = 2 ** z, rad = (lat * Math.PI) / 180;
  return [((lon + 180) / 360) * n, ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n];
}

/** `missing`: elevation tiles that did not load (their part of the grid is a flat stand-in). */
export type GroundGrid = { bbox: Bbox; width: number; height: number; z: number[]; zoom: number; missing?: number };

/** Height at a point of a ground grid by bilinear interpolation (cells are samples at cell centres). Pure. */
export function heightAt(g: GroundGrid, lon: number, lat: number): number {
  const fx = Math.max(0, Math.min(g.width - 1, ((lon - g.bbox[0]) / (g.bbox[2] - g.bbox[0])) * g.width - 0.5));
  const fy = Math.max(0, Math.min(g.height - 1, ((g.bbox[3] - lat) / (g.bbox[3] - g.bbox[1])) * g.height - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(g.width - 1, x0 + 1), y1 = Math.min(g.height - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0, at = (x: number, y: number) => g.z[y * g.width + x];
  return (at(x0, y0) * (1 - tx) + at(x1, y0) * tx) * (1 - ty) + (at(x0, y1) * (1 - tx) + at(x1, y1) * tx) * ty;
}

/** Replace missing heights with the mean of the known ones (a missing tile is rare; a flat patch beats a hole). Pure. */
export function fillGaps(z: number[]): void {
  const known = z.filter((v) => Number.isFinite(v));
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 0;
  for (let i = 0; i < z.length; i++) if (!Number.isFinite(z[i])) z[i] = Math.round(mean * 10) / 10;
}
