/**
 * Terrain, from free elevation data. For any place Edge reads the best surface there is, through
 * Microsoft Planetary Computer: USGS 3DEP lidar (bare earth, 2 m) where it has been flown, else the USGS
 * 3DEP seamless model (10 m, the United States), else Copernicus GLO-30 (30 m, worldwide). From it: a
 * site's slope and relief, where it sits against the ground around it, the earth a new pad took to level
 * (balanced cut and fill on the ground as it was before), and a pipeline's elevation profile. Results are
 * kept for a month; the ground does not move.
 */
import { PNG } from "pngjs";
import type { Bbox } from "./sources/eia";

export const TERRAIN_VERSION = "terrain v1";
const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";
const UA = { "User-Agent": "YouBank research (Edge terrain)" };

export type SourceKey = "lidar" | "3dep" | "copernicus";
const SOURCES: Record<SourceKey, { collection: string; name: string; resolutionM: number; accuracy: string; license: string; url: string }> = {
  lidar: {
    collection: "3dep-lidar-dtm", name: "USGS 3DEP lidar, bare-earth model", resolutionM: 2, accuracy: "about ±0.2 m vertically",
    license: "Public domain (U.S. Geological Survey)", url: "https://planetarycomputer.microsoft.com/dataset/3dep-lidar-dtm",
  },
  "3dep": {
    collection: "3dep-seamless", name: "USGS 3DEP seamless elevation", resolutionM: 10, accuracy: "about ±1 to 3 m vertically",
    license: "Public domain (U.S. Geological Survey)", url: "https://planetarycomputer.microsoft.com/dataset/3dep-seamless",
  },
  copernicus: {
    collection: "cop-dem-glo-30", name: "Copernicus DEM GLO-30", resolutionM: 30, accuracy: "about ±2 to 4 m vertically, and a surface model, so trees and buildings count as ground",
    license: "Copernicus DEM, free with attribution: © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA",
    url: "https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30",
  },
};

export type TerrainSource = { key: SourceKey; name: string; resolutionM: number; vintage: string; accuracy: string; license: string; url: string; items: string[] };
export type Grid = { bbox: Bbox; width: number; height: number; z: Float32Array; valid: Uint8Array; cell: { x: number; y: number }; source: TerrainSource; coverage: number };

export type Pad = {
  kind: "cleared" | "darkened"; hectares: number; lon: number; lat: number;
  /** The ground before: mean level, mean slope, and the spread of levels inside the footprint (5th to 95th percentile). */
  groundM: number; slopeDeg: number; reliefM: number;
  /** Share of the ground around the site lower than this footprint, 0 to 1. */
  position: number;
  /** For new bare ground: levelling it flat at the balancing height moves this much earth each way. */
  levelM?: number; cutM3?: number; fillM3?: number; stripM3?: [number, number];
};
export type SiteTerrain = {
  kind: "site"; version: string; bbox: Bbox; source: TerrainSource; coverage: number;
  /** atSite is the level at the site's own point, and positionAtSite the share of the ground around it that is lower. */
  elevation: { min: number; max: number; mean: number; atSite: number | null; positionAtSite: number | null };
  reliefM: number; slope: { meanDeg: number; p90Deg: number };
  pads: Pad[]; earthwork: { cutM3: number; fillM3: number; hectares: number } | null;
  /** Shaded relief of the site with the changes outlined, as a PNG data URI. */
  image: string | null;
  notes: string[];
};
export type ProfilePoint = { km: number; m: number };
export type PipelineProfile = {
  kind: "profile"; version: string; source: TerrainSource; lengthKm: number; spacingM: number;
  points: ProfilePoint[];
  low: { m: number; km: number; lon: number; lat: number }; high: { m: number; km: number; lon: number; lat: number };
  climbM: number; descentM: number; netM: number;
  steepest: { gradePct: number; fromKm: number; toKm: number; overKm: number };
  notes: string[];
};

/* ---------------- Pure pieces ---------------- */

/** A NumPy .npy array (the data API's raw output): its shape and values as floats. Pure. */
export function parseNpy(buf: Uint8Array): { shape: number[]; data: Float32Array } {
  if (buf[0] !== 0x93 || String.fromCharCode(...buf.subarray(1, 6)) !== "NUMPY") throw new Error("Not a NumPy array");
  const major = buf[6];
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = major >= 2 ? dv.getUint32(8, true) : dv.getUint16(8, true);
  const start = major >= 2 ? 12 : 10;
  const header = new TextDecoder().decode(buf.subarray(start, start + headerLen));
  const descr = header.match(/'descr':\s*'([^']+)'/)?.[1] ?? "<f4";
  const shape = (header.match(/'shape':\s*\(([^)]*)\)/)?.[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number);
  if (/'fortran_order':\s*True/.test(header)) throw new Error("Fortran-ordered arrays are not supported");
  const n = shape.reduce((a, b) => a * b, 1);
  const off = start + headerLen;
  const out = new Float32Array(n);
  const little = !descr.startsWith(">");
  const t = descr.slice(1);
  const size = t === "f8" || t === "i8" ? 8 : t === "f4" || t === "i4" || t === "u4" ? 4 : t === "i2" || t === "u2" ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const p = off + i * size;
    out[i] = t === "f4" ? dv.getFloat32(p, little) : t === "f8" ? dv.getFloat64(p, little) : t === "i2" ? dv.getInt16(p, little) : t === "u2" ? dv.getUint16(p, little)
      : t === "i4" ? dv.getInt32(p, little) : t === "u4" ? dv.getUint32(p, little) : t === "u1" ? dv.getUint8(p) : t === "i1" ? dv.getInt8(p) : Number.NaN;
  }
  return { shape, data: out };
}

/** Metres per cell, across and down, for a box split into w by h cells. Pure. */
export function cellSize(bbox: Bbox, w: number, h: number): { x: number; y: number } {
  const lat = (bbox[1] + bbox[3]) / 2;
  return { x: ((bbox[2] - bbox[0]) * 111_320 * Math.cos((lat * Math.PI) / 180)) / w, y: ((bbox[3] - bbox[1]) * 110_574) / h };
}

type Surface = { z: Float32Array; valid: Uint8Array; width: number; height: number; cell: { x: number; y: number } };

/** Slope in degrees at every cell (Horn's method); NaN at the edge and next to missing cells. Pure. */
export function slopeDegrees(g: Surface): Float32Array {
  const { z, valid, width: w, height: h, cell } = g;
  const out = new Float32Array(w * h).fill(Number.NaN);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = i - w - 1, b = i - w, c = i - w + 1, d = i - 1, f = i + 1, g7 = i + w - 1, h8 = i + w, i9 = i + w + 1;
      if (!(valid[a] && valid[b] && valid[c] && valid[d] && valid[f] && valid[g7] && valid[h8] && valid[i9])) continue;
      const dzdx = ((z[c] + 2 * z[f] + z[i9]) - (z[a] + 2 * z[d] + z[g7])) / (8 * cell.x);
      const dzdy = ((z[g7] + 2 * z[h8] + z[i9]) - (z[a] + 2 * z[b] + z[c])) / (8 * cell.y);
      out[i] = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
    }
  }
  return out;
}

/** Shaded relief, 0 to 255, lit from the north-west; flat ground lifted by `exaggeration` so low relief still reads. Pure. */
export function hillshade(g: Surface, exaggeration = 3): Uint8Array {
  const { z, valid, width: w, height: h, cell } = g;
  const out = new Uint8Array(w * h).fill(180);
  const zen = ((90 - 45) * Math.PI) / 180, az = ((360 - 315 + 90) % 360) * (Math.PI / 180);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const a = i - w - 1, b = i - w, c = i - w + 1, d = i - 1, f = i + 1, g7 = i + w - 1, h8 = i + w, i9 = i + w + 1;
      if (!(valid[a] && valid[b] && valid[c] && valid[d] && valid[f] && valid[g7] && valid[h8] && valid[i9])) continue;
      const dzdx = (((z[c] + 2 * z[f] + z[i9]) - (z[a] + 2 * z[d] + z[g7])) / (8 * cell.x)) * exaggeration;
      const dzdy = (((z[g7] + 2 * z[h8] + z[i9]) - (z[a] + 2 * z[b] + z[c])) / (8 * cell.y)) * exaggeration;
      const slope = Math.atan(Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const v = 255 * (Math.cos(zen) * Math.cos(slope) + Math.sin(zen) * Math.sin(slope) * Math.cos(az - aspect));
      out[i] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return out;
}

/** Connected groups of mask cells of one kind (eight neighbours), largest first, at least `minCells` each. Pure. */
export function components(mask: Uint8Array, w: number, h: number, kind: number, minCells: number): number[][] {
  const seen = new Uint8Array(w * h);
  const out: number[][] = [];
  for (let s = 0; s < mask.length; s++) {
    if (mask[s] !== kind || seen[s]) continue;
    const blob: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      blob.push(p);
      const px = p % w, py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const x = px + dx, y = py + dy;
        if ((dx || dy) && x >= 0 && y >= 0 && x < w && y < h) { const q = y * w + x; if (!seen[q] && mask[q] === kind) { seen[q] = 1; stack.push(q); } }
      }
    }
    if (blob.length >= minCells) out.push(blob);
  }
  return out.sort((a, b) => b.length - a.length);
}

/**
 * Levelling a footprint flat at the height that balances cut and fill (its mean ground level): the earth
 * taken off the high side, which fills the low side. Pure.
 */
export function levelling(heights: ArrayLike<number>, cellArea: number): { level: number; cut: number; fill: number } {
  let sum = 0;
  for (let i = 0; i < heights.length; i++) sum += heights[i];
  const level = heights.length ? sum / heights.length : 0;
  let cut = 0, fill = 0;
  for (let i = 0; i < heights.length; i++) { const d = heights[i] - level; if (d > 0) cut += d * cellArea; else fill -= d * cellArea; }
  return { level, cut, fill };
}

/** The value at fraction q of a sorted array. Pure. */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  if (!sorted.length) return Number.NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/** Share of a sorted array below a value. Pure. */
export function rankBelow(sorted: ArrayLike<number>, v: number): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < v) lo = mid + 1; else hi = mid; }
  return sorted.length ? lo / sorted.length : 0;
}

/** The change mask from a ground-change overlay (1 new bare ground, 2 new dark surface). Pure. */
export function maskFromOverlay(dataUri: string): { mask: Uint8Array; width: number; height: number } {
  const png = PNG.sync.read(Buffer.from(dataUri.replace(/^data:image\/png;base64,/, ""), "base64"));
  const mask = new Uint8Array(png.width * png.height);
  for (let p = 0; p < mask.length; p++) {
    const i = p * 4;
    if (png.data[i + 3] < 64) continue;
    mask[p] = png.data[i + 2] > 180 ? 2 : png.data[i] > 180 ? 1 : 0;
  }
  return { mask, width: png.width, height: png.height };
}

const haversineM = (a: number[], b: number[]) => {
  const r = 6_371_008.8, toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(s)));
};

/** Points every `spacingM` along lines (parts in order), with distance from the start in km. Pure. */
export function densify(lines: number[][][], spacingM: number): { lon: number; lat: number; km: number; part: number }[] {
  const out: { lon: number; lat: number; km: number; part: number }[] = [];
  let total = 0;
  lines.forEach((line, part) => {
    if (line.length < 2) return;
    out.push({ lon: line[0][0], lat: line[0][1], km: total / 1000, part });
    let carry = 0;
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1], b = line[i], seg = haversineM(a, b);
      let at = spacingM - carry;
      while (at <= seg) { const t = at / seg; out.push({ lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, km: (total + at) / 1000, part }); at += spacingM; }
      carry = (carry + seg) % spacingM;
      total += seg;
    }
    const last = line[line.length - 1];
    if (out.length && out[out.length - 1].km < total / 1000 - 1e-6) out.push({ lon: last[0], lat: last[1], km: total / 1000, part });
  });
  return out;
}

/** Climb, descent, extremes and the steepest stretch of an elevation profile. Small wiggles under `noiseM` are ignored. Pure. */
export function profileStats(km: number[], m: number[], noiseM = 1): { climb: number; descent: number; steepest: { gradePct: number; fromKm: number; toKm: number; overKm: number } } {
  let climb = 0, descent = 0, anchor = m[0] ?? 0;
  for (let i = 1; i < m.length; i++) {
    if (m[i] - anchor > noiseM) { climb += m[i] - anchor; anchor = m[i]; }
    else if (anchor - m[i] > noiseM) { descent += anchor - m[i]; anchor = m[i]; }
  }
  const length = km.length ? km[km.length - 1] - km[0] : 0;
  const window = Math.max(0.2, Math.min(1, length / 10));
  let best = { gradePct: 0, fromKm: 0, toKm: 0, overKm: window };
  for (let i = 0, j = 0; i < km.length; i++) {
    while (j < km.length && km[j] - km[i] < window) j++;
    if (j >= km.length) break;
    const grade = (Math.abs(m[j] - m[i]) / ((km[j] - km[i]) * 1000)) * 100;
    if (grade > best.gradePct) best = { gradePct: grade, fromKm: km[i], toKm: km[j], overKm: km[j] - km[i] };
  }
  return { climb, descent, steepest: best };
}

/** Elevation at a point of a grid by bilinear interpolation, or null outside or on missing cells. Pure. */
export function sampleGrid(g: { bbox: Bbox; width: number; height: number; z: Float32Array; valid: Uint8Array }, lon: number, lat: number): number | null {
  const fx = ((lon - g.bbox[0]) / (g.bbox[2] - g.bbox[0])) * g.width - 0.5;
  const fy = ((g.bbox[3] - lat) / (g.bbox[3] - g.bbox[1])) * g.height - 0.5;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  if (x0 < -1 || y0 < -1 || x0 > g.width - 1 || y0 > g.height - 1) return null;
  const cx = (x: number) => Math.max(0, Math.min(g.width - 1, x)), cy = (y: number) => Math.max(0, Math.min(g.height - 1, y));
  const idx = [[cx(x0), cy(y0)], [cx(x0 + 1), cy(y0)], [cx(x0), cy(y0 + 1)], [cx(x0 + 1), cy(y0 + 1)]].map(([x, y]) => y * g.width + x);
  if (idx.some((i) => !g.valid[i])) return idx.some((i) => g.valid[i]) ? g.z[idx.find((i) => g.valid[i])!] : null;
  const tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
  return (g.z[idx[0]] * (1 - tx) + g.z[idx[1]] * tx) * (1 - ty) + (g.z[idx[2]] * (1 - tx) + g.z[idx[3]] * tx) * ty;
}

/* ---------------- Reading elevation ---------------- */

/** Run `fn` over items, at most `n` at a time, keeping their order. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } }));
  return out;
}

type StacItem = { id: string; bbox: number[]; properties: Record<string, unknown> };

async function stacItems(collection: string, bbox: Bbox, limit: number): Promise<StacItem[]> {
  const res = await fetch(STAC, { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify({ collections: [collection], bbox, limit }), cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Planetary Computer search answered ${res.status}`);
  return ((await res.json()) as { features?: StacItem[] }).features ?? [];
}

async function readWindow(collection: string, item: string, bbox: Bbox, w: number, h: number, resampling: string): Promise<{ z: Float32Array; valid: Uint8Array }> {
  const url = `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(6)).join(",")}/${w}x${h}.npy?collection=${collection}&item=${encodeURIComponent(item)}&assets=data&resampling=${resampling}`;
  const res = await fetch(url, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(45_000) });
  if (!res.ok) throw new Error(`Planetary Computer elevation answered ${res.status}`);
  const { shape, data } = parseNpy(new Uint8Array(await res.arrayBuffer()));
  const n = w * h;
  const z = data.subarray(0, n);
  const valid = new Uint8Array(n);
  const masked = shape.length === 3 && shape[0] >= 2;
  for (let i = 0; i < n; i++) valid[i] = (masked ? data[n * (shape[0] - 1) + i] > 0 : true) && Number.isFinite(z[i]) && z[i] > -1000 && z[i] < 9000 ? 1 : 0;
  return { z: new Float32Array(z), valid };
}

const yearOf = (it: StacItem) => String(it.properties.end_datetime ?? it.properties.datetime ?? it.properties.start_datetime ?? "").slice(0, 10);
const overlaps = (a: number[], b: Bbox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];

/** The items of a source that cover a box, and how to describe their date; for lidar, the newest survey flown before `before`. */
async function itemsFor(key: SourceKey, bbox: Bbox, before?: string, max = 6): Promise<{ items: StacItem[]; vintage: string }> {
  const src = SOURCES[key];
  let found = (await stacItems(src.collection, bbox, key === "lidar" || max > 12 ? 60 : 12)).filter((i) => overlaps(i.bbox, bbox));
  if (key === "3dep") found = found.filter((i) => i.properties.gsd === 10 || /-13$/.test(i.id));
  if (!found.length) return { items: [], vintage: "" };
  if (key === "lidar") {
    // One survey at a time (surveys overlap and differ slightly): the newest flown before the change.
    const surveys = new Map<string, StacItem[]>();
    for (const it of found) { const s = it.id.replace(/-dtm.*$/, ""); surveys.set(s, [...(surveys.get(s) ?? []), it]); }
    const ranked = [...surveys.entries()].map(([name, list]) => ({ name, list, date: list.map(yearOf).sort().pop() ?? "" }))
      .filter((s) => !before || (s.date && s.date < before)).sort((a, b) => b.date.localeCompare(a.date));
    if (!ranked.length) return { items: [], vintage: "" };
    return { items: ranked[0].list.slice(0, max), vintage: `flown ${ranked[0].date.slice(0, 4)} (${ranked[0].name})` };
  }
  return { items: found.slice(0, max), vintage: key === "copernicus" ? "TanDEM-X radar, 2011 to 2015" : `USGS 3DEP (dated ${yearOf(found[0]).slice(0, 4)})` };
}

/**
 * The best elevation grid for a box: lidar when a survey before `before` covers it, else USGS 3DEP 10 m,
 * else Copernicus 30 m. Tiles covering parts of the box are merged on the same grid.
 */
export async function demGrid(bbox: Bbox, width: number, height: number, opts: { before?: string; order?: SourceKey[] } = {}): Promise<Grid> {
  const cell = cellSize(bbox, width, height);
  for (const key of opts.order ?? (["lidar", "3dep", "copernicus"] as SourceKey[])) {
    const src = SOURCES[key];
    const { items, vintage } = await itemsFor(key, bbox, opts.before).catch(() => ({ items: [] as StacItem[], vintage: "" }));
    const ids = items.map((i) => i.id);
    if (!ids.length) continue;
    const resampling = src.resolutionM < Math.min(cell.x, cell.y) ? "average" : "bilinear";
    const windows = await Promise.all(ids.map((id) => readWindow(src.collection, id, bbox, width, height, resampling).catch(() => null)));
    const z = new Float32Array(width * height), valid = new Uint8Array(width * height);
    for (const win of windows) {
      if (!win) continue;
      for (let i = 0; i < z.length; i++) if (!valid[i] && win.valid[i]) { z[i] = win.z[i]; valid[i] = 1; }
    }
    let count = 0;
    for (let i = 0; i < valid.length; i++) count += valid[i];
    const coverage = count / valid.length;
    // Lidar and 3DEP must cover the box; Copernicus is the last resort.
    if (coverage >= 0.95 || (key === "copernicus" && coverage >= 0.5)) {
      return { bbox, width, height, z, valid, cell, coverage, source: { key, name: src.name, resolutionM: src.resolutionM, vintage, accuracy: src.accuracy, license: src.license, url: src.url, items: ids } };
    }
  }
  throw Object.assign(new Error("No elevation data covers this place."), { status: 404 });
}

/* ---------------- Sites ---------------- */

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);

/** Hypsometric tint (low teal to high tan) under shaded relief, with the changes outlined. Pure apart from encoding. */
function siteImage(g: Grid, shade: Uint8Array, lo: number, hi: number, mask: { mask: Uint8Array; width: number; height: number } | null, out = 256): string {
  const png = new PNG({ width: out, height: out });
  const ramp = [[42, 110, 104], [120, 150, 104], [196, 178, 124], [168, 120, 82]];
  const color = (t: number) => { const x = Math.max(0, Math.min(0.999, t)) * (ramp.length - 1); const i = Math.floor(x), f = x - i; return ramp[i].map((c, k) => c + (ramp[i + 1][k] - c) * f); };
  for (let y = 0; y < out; y++) {
    for (let x = 0; x < out; x++) {
      const gx = Math.min(g.width - 1, Math.floor((x / out) * g.width)), gy = Math.min(g.height - 1, Math.floor((y / out) * g.height));
      const gi = gy * g.width + gx, p = (y * out + x) * 4;
      if (!g.valid[gi]) { png.data[p] = png.data[p + 1] = png.data[p + 2] = 30; png.data[p + 3] = 255; continue; }
      const [cr, cg, cb] = color((g.z[gi] - lo) / Math.max(1, hi - lo));
      const l = 0.35 + (0.65 * shade[gi]) / 255;
      png.data[p] = Math.min(255, cr * l); png.data[p + 1] = Math.min(255, cg * l); png.data[p + 2] = Math.min(255, cb * l); png.data[p + 3] = 255;
      if (mask) {
        const mx = Math.min(mask.width - 1, Math.floor((x / out) * mask.width)), my = Math.min(mask.height - 1, Math.floor((y / out) * mask.height));
        const k = mask.mask[my * mask.width + mx];
        if (k) {
          const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const nx = mx + dx, ny = my + dy; return nx < 0 || ny < 0 || nx >= mask.width || ny >= mask.height || mask.mask[ny * mask.width + nx] !== k; });
          const [er, eg, eb] = k === 1 ? [255, 176, 32] : [56, 189, 248];
          if (edge) { png.data[p] = er; png.data[p + 1] = eg; png.data[p + 2] = eb; }
          else { png.data[p] = (png.data[p] * 3 + er) / 4; png.data[p + 1] = (png.data[p + 1] * 3 + eg) / 4; png.data[p + 2] = (png.data[p + 2] * 3 + eb) / 4; }
        }
      }
    }
  }
  return `data:image/png;base64,${PNG.sync.write(png, { colorType: 2 }).toString("base64")}`;
}

/**
 * Read a site: its levels, slope and relief, and for each change outlined in `mask` (cells of the mask
 * map onto `scale` by `scale` grid cells), the ground before, where it sits, and for new bare ground the
 * balanced cut and fill to level it. Pure apart from the image.
 */
export function readSite(g: Grid, mask: { mask: Uint8Array; width: number; height: number } | null, point: { lon: number; lat: number } | null, opts: { changedAfter?: string; image?: boolean } = {}): SiteTerrain {
  const vals: number[] = [];
  for (let i = 0; i < g.z.length; i++) if (g.valid[i]) vals.push(g.z[i]);
  const sorted = Float32Array.from(vals).sort();
  const slope = slopeDegrees(g);
  const slopes: number[] = [];
  for (let i = 0; i < slope.length; i++) if (Number.isFinite(slope[i])) slopes.push(slope[i]);
  const slopeSorted = Float32Array.from(slopes).sort();
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const cellArea = g.cell.x * g.cell.y;
  const pads: Pad[] = [];
  if (mask) {
    const sx = g.width / mask.width, sy = g.height / mask.height;
    for (const kind of [1, 2] as const) {
      for (const blob of components(mask.mask, mask.width, mask.height, kind, kind === 1 ? 20 : 10).slice(0, 6)) {
        const hs: number[] = [], ss: number[] = [];
        let cx = 0, cy = 0;
        for (const p of blob) {
          const mx = p % mask.width, my = (p - mx) / mask.width;
          cx += mx; cy += my;
          for (let dy = 0; dy < sy; dy++) for (let dx = 0; dx < sx; dx++) {
            const gi = Math.min(g.height - 1, Math.floor(my * sy + dy)) * g.width + Math.min(g.width - 1, Math.floor(mx * sx + dx));
            if (g.valid[gi]) { hs.push(g.z[gi]); if (Number.isFinite(slope[gi])) ss.push(slope[gi]); }
          }
        }
        if (hs.length < 4) continue;
        const hSorted = Float32Array.from(hs).sort();
        const groundM = hs.reduce((a, b) => a + b, 0) / hs.length;
        const areaM2 = hs.length * cellArea;
        const lon = g.bbox[0] + ((cx / blob.length + 0.5) / mask.width) * (g.bbox[2] - g.bbox[0]);
        const lat = g.bbox[3] - ((cy / blob.length + 0.5) / mask.height) * (g.bbox[3] - g.bbox[1]);
        const pad: Pad = {
          kind: kind === 1 ? "cleared" : "darkened", hectares: r1(areaM2 / 10_000), lon: Math.round(lon * 1e5) / 1e5, lat: Math.round(lat * 1e5) / 1e5,
          groundM: r1(groundM), slopeDeg: r1(ss.length ? ss.reduce((a, b) => a + b, 0) / ss.length : 0), reliefM: r1(quantileSorted(hSorted, 0.95) - quantileSorted(hSorted, 0.05)),
          position: Math.round(rankBelow(sorted, groundM) * 100) / 100,
        };
        if (kind === 1) {
          const l = levelling(hs, cellArea);
          pad.levelM = r1(l.level); pad.cutM3 = Math.round(l.cut / 10) * 10; pad.fillM3 = Math.round(l.fill / 10) * 10;
          pad.stripM3 = [Math.round((areaM2 * 0.15) / 10) * 10, Math.round((areaM2 * 0.3) / 10) * 10];
        }
        pads.push(pad);
      }
    }
  }
  const cleared = pads.filter((p) => p.kind === "cleared");
  const notes: string[] = [];
  const surveyYear = Number(g.source.vintage.match(/\d{4}/)?.[0] ?? 0);
  if (opts.changedAfter && surveyYear && surveyYear >= Number(opts.changedAfter.slice(0, 4))) notes.push(`The elevation data dates from ${surveyYear}, which may be after some of this work began, so the levelling figures may be low.`);
  if (g.source.key !== "lidar") notes.push(`Levels are good to ${g.source.accuracy}; for a small pad the cut and fill are an order of magnitude, not a survey.`);
  if (cleared.length) notes.push("Cut and fill assume the new ground was levelled flat at the height that balances them. Topsoil stripping, often 15 to 30 cm over the whole footprint, comes on top.");
  if (pads.some((p) => p.kind === "darkened")) notes.push("New dark surface (water, tanks or paving) shows the ground it sits on; the depth of any pit cannot be read from the surface before.");
  const lo = quantileSorted(sorted, 0.02), hi = quantileSorted(sorted, 0.98);
  const atSite = point ? sampleGrid(g, point.lon, point.lat) : null;
  return {
    kind: "site", version: TERRAIN_VERSION, bbox: g.bbox, source: g.source, coverage: Math.round(g.coverage * 100) / 100,
    elevation: { min: r1(sorted[0] ?? 0), max: r1(sorted[sorted.length - 1] ?? 0), mean: r1(mean), atSite: atSite === null ? null : r1(atSite), positionAtSite: atSite === null ? null : Math.round(rankBelow(sorted, atSite) * 100) / 100 },
    reliefM: r1(hi - lo), slope: { meanDeg: r1(slopes.reduce((a, b) => a + b, 0) / Math.max(1, slopes.length)), p90Deg: r1(quantileSorted(slopeSorted, 0.9)) },
    pads, earthwork: cleared.length ? { cutM3: cleared.reduce((s, p) => s + (p.cutM3 ?? 0), 0), fillM3: cleared.reduce((s, p) => s + (p.fillM3 ?? 0), 0), hectares: r1(cleared.reduce((s, p) => s + p.hectares, 0)) } : null,
    image: opts.image === false ? null : siteImage(g, hillshade(g), lo, hi, mask),
    notes,
  };
}

/* ---------------- Pipelines ---------------- */

/** Lines from a GeoJSON LineString or MultiLineString. Pure. */
export function linesOf(geom: { type: string; coordinates: unknown }): number[][][] {
  if (geom.type === "LineString") return [geom.coordinates as number[][]];
  if (geom.type === "MultiLineString") return geom.coordinates as number[][][];
  return [];
}

/** A pipeline's elevation profile, sampled about 500 times along its length on the best model that covers it. */
export async function pipelineProfile(geom: { type: string; coordinates: unknown }): Promise<PipelineProfile> {
  const lines = linesOf(geom).filter((l) => l.length >= 2);
  if (!lines.length) throw Object.assign(new Error("That asset is not a line."), { status: 400 });
  let lengthM = 0;
  for (const l of lines) for (let i = 1; i < l.length; i++) lengthM += haversineM(l[i - 1], l[i]);
  const spacingM = Math.max(20, Math.min(2000, lengthM / 500));
  const pts = densify(lines, spacingM);
  const xs = pts.map((p) => p.lon), ys = pts.map((p) => p.lat);
  const pad = 0.002;
  const box: Bbox = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) + pad, Math.max(...ys) + pad];
  // 3DEP where it covers (the United States), else Copernicus; one window per tile, sized to the sampling.
  // Only the tiles the line passes through (a long pipeline's box covers many it never touches).
  const inside = (b: number[], p: { lon: number; lat: number }) => p.lon >= b[0] && p.lon <= b[2] && p.lat >= b[1] && p.lat <= b[3];
  const crossed = async (k: SourceKey) => {
    const f = await itemsFor(k, box, undefined, 60).catch(() => ({ items: [] as StacItem[], vintage: "" }));
    return { ...f, items: f.items.filter((it) => pts.some((p) => inside(it.bbox, p))).slice(0, 24) };
  };
  let key: SourceKey = "3dep";
  let found = await crossed("3dep");
  if (!found.items.length) { key = "copernicus"; found = await crossed("copernicus"); }
  if (!found.items.length) throw Object.assign(new Error("No elevation data covers this pipeline."), { status: 404 });
  const src = SOURCES[key];
  const grids = (await pool(found.items, 6, async (it) => {
    const b: Bbox = [Math.max(box[0], it.bbox[0]), Math.max(box[1], it.bbox[1]), Math.min(box[2], it.bbox[2]), Math.min(box[3], it.bbox[3])];
    if (b[0] >= b[2] || b[1] >= b[3]) return null;
    const c = cellSize(b, 1, 1), target = Math.max(src.resolutionM, spacingM / 2);
    const w = Math.max(16, Math.min(768, Math.ceil(c.x / target))), h = Math.max(16, Math.min(768, Math.ceil(c.y / target)));
    const win = await readWindow(src.collection, it.id, b, w, h, src.resolutionM < target ? "average" : "bilinear").catch(() => null);
    return win ? { bbox: b, width: w, height: h, ...win } : null;
  })).filter((g): g is NonNullable<typeof g> => !!g);
  const km: number[] = [], m: number[] = [], at: { lon: number; lat: number }[] = [];
  for (const p of pts) {
    const g = grids.find((x) => p.lon >= x.bbox[0] && p.lon <= x.bbox[2] && p.lat >= x.bbox[1] && p.lat <= x.bbox[3]);
    const v = g ? sampleGrid(g, p.lon, p.lat) : null;
    if (v === null) continue;
    km.push(Math.round(p.km * 1000) / 1000); m.push(r1(v)); at.push({ lon: p.lon, lat: p.lat });
  }
  if (km.length < 2) throw Object.assign(new Error("The elevation data does not cover this pipeline."), { status: 404 });
  const st = profileStats(km, m, src.resolutionM <= 10 ? 1 : 3);
  let lo = 0, hi = 0;
  for (let i = 1; i < m.length; i++) { if (m[i] < m[lo]) lo = i; if (m[i] > m[hi]) hi = i; }
  const step = Math.max(1, Math.ceil(km.length / 400));
  const points = km.map((k, i) => ({ km: k, m: m[i] })).filter((_, i) => i % step === 0 || i === lo || i === hi || i === km.length - 1);
  const notes = [`Sampled every ${spacingM >= 1000 ? `${r1(spacingM / 1000)} km` : `${r0(spacingM)} m`} along the line on ${src.name} (${src.resolutionM} m), good to ${src.accuracy}.`];
  if (lines.length > 1) notes.push(`The line has ${lines.length} parts; distances run through them in the order EIA lists them.`);
  return {
    kind: "profile", version: TERRAIN_VERSION, source: { key, name: src.name, resolutionM: src.resolutionM, vintage: found.vintage, accuracy: src.accuracy, license: src.license, url: src.url, items: found.items.map((i) => i.id) },
    lengthKm: r1(lengthM / 1000), spacingM: r0(spacingM), points,
    low: { m: m[lo], km: km[lo], lon: at[lo].lon, lat: at[lo].lat }, high: { m: m[hi], km: km[hi], lon: at[hi].lon, lat: at[hi].lat },
    climbM: r0(st.climb), descentM: r0(st.descent), netM: r0(m[m.length - 1] - m[0]),
    steepest: { gradePct: Math.round(st.steepest.gradePct * 100) / 100, fromKm: r1(st.steepest.fromKm), toKm: r1(st.steepest.toKm), overKm: r1(st.steepest.overKm) },
    notes,
  };
}
