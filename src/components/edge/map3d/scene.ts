/**
 * What the 3D map is asked to draw beyond its base layers, in one object the page hands to EarthMap:
 * a digital twin, a lidar point cloud, a scene analysis, flares from the feed, and room for more (the
 * `extra` bag, for layers added to the registry in ./layers.ts). Also the pure helpers the layers use:
 * colour ramps, the flame's flicker and the point cloud's colouring. No map or deck.gl imports here,
 * so tests can load it.
 */
import type { PointCloudHeader } from "@/lib/edge/geo3d/ept";
import { LIDAR_CLASSES } from "@/lib/edge/geo3d/ept";
import type { SceneResult } from "@/lib/edge/scene";
import type { DigitalTwin } from "@/lib/edge/twin";

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

/** A point cloud as it arrives: one entry per pass, each drawn as its own layer so earlier passes are not uploaded again. */
export type CloudPass = { header: PointCloudHeader; positions: Float32Array; classes: Uint8Array; intensity: Uint8Array };
export type CloudColor = "class" | "height" | "intensity";
export type Cloud = { passes: CloudPass[]; color: CloudColor; pointSize: number };

/** A flare from the feed (a flaring finding), shown as a stack and flame in the regional 3D view. */
export type FlareSpot = { id: number; lon: number; lat: number; frpMw: number; days: number; title: string };

export type Map3DScene = {
  twin?: DigitalTwin | null;
  cloud?: Cloud | null;
  analysis?: SceneResult | null;
  /** For a time stack: draw layers up to this index (the 3D time-lapse's playhead). */
  analysisUpTo?: number;
  flares?: FlareSpot[];
  /** Registry layer ids switched off by the person. */
  hidden?: string[];
  /** Data for layers added to the registry by other areas (keyed by their layer id). */
  extra?: Record<string, unknown>;
};

/** "#46B3C9" as [70, 179, 201]. Pure. */
export function hexRgb(hex: string): Rgb {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 136];
}

/** Linear blend of two colours. Pure. */
export const blend = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * Math.max(0, Math.min(1, t)))) as Rgb;

/** A perceptual ramp for heights (viridis-like stops), t from 0 to 1. Pure. */
export function heightRamp(t: number): Rgb {
  const stops: Rgb[] = [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x));
  return blend(stops[i], stops[i + 1], x - i);
}

/** How tall a flame stands right now, as a share of its full height: a slow breath and a fast flicker, out of step between flares. Pure. */
export function flicker(timeMs: number, seed: number, intensity: number): number {
  const s = seed * 1.618;
  const breath = 0.5 + 0.5 * Math.sin(timeMs / 900 + s);
  const fast = 0.5 + 0.5 * Math.sin(timeMs / 97 + s * 3.1) * Math.sin(timeMs / 151 + s * 1.7);
  return 0.72 + 0.14 * breath + 0.14 * fast * (0.5 + 0.5 * intensity);
}

/** Flame colour by strength: pale yellow for a weak flare to deep orange-red for a strong one. Pure. */
export const flameColor = (intensity: number): Rgba => [255, Math.round(215 - 95 * intensity), Math.round(110 - 90 * intensity), 235];

/**
 * Colours for a pass of points: by class (ASPRS colours, ground brown, vegetation green, buildings
 * orange), by height (a ramp over `range` metres above the lowest point), or by return intensity. Pure.
 */
export function cloudColors(p: CloudPass, mode: CloudColor, range: [number, number]): Uint8Array {
  const n = p.header.n, out = new Uint8Array(n * 4);
  const span = Math.max(1, range[1] - range[0]);
  for (let i = 0; i < n; i++) {
    let c: Rgb;
    if (mode === "class") c = LIDAR_CLASSES[p.classes[i]]?.color ?? [190, 190, 190];
    else if (mode === "height") c = heightRamp((p.positions[i * 3 + 2] + p.header.origin.z - range[0]) / span);
    else { const v = Math.min(255, 40 + p.intensity[i] * 1.6); c = [v, v, v]; }
    out[i * 4] = c[0]; out[i * 4 + 1] = c[1]; out[i * 4 + 2] = c[2]; out[i * 4 + 3] = 255;
  }
  return out;
}

/** The lowest and highest absolute heights across passes (for the height ramp), trimmed of the extreme 1%. Pure. */
export function cloudRange(passes: CloudPass[]): [number, number] {
  const sample: number[] = [];
  for (const p of passes) { const step = Math.max(1, Math.floor(p.header.n / 4000)); for (let i = 0; i < p.header.n; i += step) sample.push(p.positions[i * 3 + 2] + p.header.origin.z); }
  if (!sample.length) return [0, 1];
  sample.sort((a, b) => a - b);
  return [sample[Math.floor(sample.length * 0.01)], sample[Math.min(sample.length - 1, Math.floor(sample.length * 0.99))]];
}

/**
 * Where to put a point cloud's origin so its ground meets the map's: the terrain height at the centre
 * minus how far the cloud's ground lies above its own origin. Lidar heights and the terrain tiles can be
 * on different vertical datums (tens of metres apart), so the cloud is lined up on its ground returns
 * rather than trusted as absolute. Pure.
 */
export function cloudOriginZ(header: PointCloudHeader, terrainAtCentre: number | null, relief: number): number {
  if (terrainAtCentre === null || header.groundZ === null) return header.origin.z * relief;
  return terrainAtCentre * relief - (header.groundZ - header.origin.z);
}

/** Total points across passes. Pure. */
export const cloudPoints = (c: Cloud | null | undefined) => (c?.passes ?? []).reduce((s, p) => s + p.header.n, 0);
