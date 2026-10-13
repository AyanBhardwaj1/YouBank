/**
 * Geospatial AI on a site, drawn in 3D. Each analysis turns imagery into a grid of cells the map
 * extrudes: how tall a cell stands says how much changed there, its colour what kind of change.
 * - Change heatmap (free): a ground-change finding's own mask (./change.ts), summed into 80 m cells.
 * - Land use (maps.scene): Impact Observatory's annual 10 m land-use maps (a deep-learning model run
 *   over Sentinel-2 every year, on Planetary Computer), the newest year against five years before;
 *   blocks stand by class, and cells that became built or bare ground are marked.
 * - Change through time (maps.scene): the clearest Sentinel-2 image of every other month for two years
 *   compared with the first, each month's change a layer above the last: a 3D time-lapse in which
 *   new ground rises as a column from the month it appeared.
 * - AI change (maps.ai-change): AlphaEarth embeddings of two years compared on the ML service
 *   (geo.embed_change), returned as a coarse grid.
 * - Footprints (maps.footprints): Segment Anything's outlines of everything in the newest aerial
 *   photograph (geo.footprints on the ML service), sorted into tanks, buildings and pads by shape.
 * The ML ones start a job and are polled; results are kept a month per place, so the same site asked
 * twice costs once.
 */
import { randomUUID } from "node:crypto";
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { changeBetween, classesFrom, decodePng } from "./change";
import { mlStart, mlStatus, noteMlCost, type MlTask } from "./infra/ml";
import { maskFromOverlay, pool, type StacItem } from "./terrain";
import { readWindow } from "./terrain";
import type { Bbox, SourceInfo } from "./sources/eia";
import { classes, clearestNear, crop, cropUrl, SENTINEL } from "./sources/sentinel";
import { timelapse } from "./timelapse";

export const SCENE_VERSION = "scene v1";
const MONTH = 30 * 86_400_000;

/** A cell of a 3D overlay: its centre, its size in metres, a value 0 to 1 (how much), a kind (what), and for the time stack a layer. */
export type SceneCell = { lon: number; lat: number; v: number; k: number; t?: number };
export type SceneLegend = { k: number; label: string; color: [number, number, number] }[];

export type SceneResult = {
  kind: "heat" | "landuse" | "cube" | "ai-change" | "footprints";
  version: string; bbox: Bbox; cellM: number; cells: SceneCell[]; legend: SceneLegend;
  /** For the time stack: the months, oldest first, one layer each. */
  layers?: string[];
  /** For footprints: outlines in lon/lat with a class and an estimated height. */
  shapes?: { ring: [number, number][]; k: number; heightM: number; areaM2: number; score: number }[];
  summary: string; source: SourceInfo[]; notes: string[];
};

/* ---------------- Pure pieces ---------------- */

/**
 * Sum a per-pixel mask over a box into square cells of `cellPx` pixels: each cell's share of pixels of
 * each kind (1 and 2), the larger kept. Cells with nothing are left out. Pure.
 */
export function maskCells(mask: Uint8Array, width: number, height: number, bbox: Bbox, cellPx: number, min = 0.02): SceneCell[] {
  const out: SceneCell[] = [];
  const cw = Math.ceil(width / cellPx), ch = Math.ceil(height / cellPx);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let a = 0, b = 0, n = 0;
      for (let y = cy * cellPx; y < Math.min(height, (cy + 1) * cellPx); y++) for (let x = cx * cellPx; x < Math.min(width, (cx + 1) * cellPx); x++) {
        const m = mask[y * width + x]; n++;
        if (m === 1) a++; else if (m === 2) b++;
      }
      if (!n) continue;
      const fa = a / n, fb = b / n, v = Math.max(fa, fb);
      if (v < min) continue;
      out.push({ ...cellCentre(bbox, width, height, cx, cy, cellPx), v: Math.round(v * 100) / 100, k: fa >= fb ? 1 : 2 });
    }
  }
  return out;
}

function cellCentre(bbox: Bbox, width: number, height: number, cx: number, cy: number, cellPx: number) {
  const px = Math.min(width, (cx + 0.5) * cellPx), py = Math.min(height, (cy + 0.5) * cellPx);
  return { lon: round6(bbox[0] + (px / width) * (bbox[2] - bbox[0])), lat: round6(bbox[3] - (py / height) * (bbox[3] - bbox[1])) };
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** Metres across a box (east-west). Pure. */
export const boxWidthM = (b: Bbox) => (b[2] - b[0]) * 111_320 * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180);

/** Impact Observatory's land-use classes (io-lulc-annual-v02), with the height their blocks stand and a colour. */
export const LULC: Record<number, { label: string; height: number; color: [number, number, number] }> = {
  1: { label: "Water", height: 0.05, color: [65, 155, 223] },
  2: { label: "Trees", height: 0.45, color: [57, 125, 73] },
  4: { label: "Flooded vegetation", height: 0.2, color: [122, 135, 198] },
  5: { label: "Crops", height: 0.25, color: [228, 150, 53] },
  7: { label: "Built area", height: 1, color: [196, 40, 27] },
  8: { label: "Bare ground", height: 0.12, color: [165, 155, 143] },
  9: { label: "Snow and ice", height: 0.1, color: [168, 235, 255] },
  11: { label: "Rangeland", height: 0.18, color: [227, 226, 195] },
};

/**
 * Two years of land-use classes on the same grid, summed into cells: each cell's most common class
 * now (k) and whether it changed to built area or bare ground since (t = 1), its height the class's.
 * Cells with no data in either year are left out. Pure.
 */
export function landUseCells(now: Uint8Array, before: Uint8Array, width: number, height: number, bbox: Bbox, cellPx: number): SceneCell[] {
  const out: SceneCell[] = [];
  const cw = Math.ceil(width / cellPx), ch = Math.ceil(height / cellPx);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      const cNow = new Map<number, number>(), cBefore = new Map<number, number>();
      for (let y = cy * cellPx; y < Math.min(height, (cy + 1) * cellPx); y++) for (let x = cx * cellPx; x < Math.min(width, (cx + 1) * cellPx); x++) {
        const i = y * width + x;
        if (LULC[now[i]]) cNow.set(now[i], (cNow.get(now[i]) ?? 0) + 1);
        if (LULC[before[i]]) cBefore.set(before[i], (cBefore.get(before[i]) ?? 0) + 1);
      }
      const top = (m: Map<number, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      const k = top(cNow), was = top(cBefore);
      if (!k) continue;
      const grew = (k === 7 || k === 8) && was !== 0 && was !== k;
      out.push({ ...cellCentre(bbox, width, height, cx, cy, cellPx), v: LULC[k].height, k, t: grew ? 1 : 0 });
    }
  }
  return out;
}

/**
 * Footprint outlines (pixel rings over a box's image) into lon/lat shapes, sorted by shape: round,
 * solid and tank-sized is a tank (k 1); compact and rectangular is a building (k 2); larger or ragged
 * is a pad or yard (k 3). Heights are estimates (a tank about half as tall as it is wide, a building
 * 6 m, a pad flat). Pure.
 */
export function footprintShapes(polys: { points: [number, number][]; score?: number }[], imageSize: [number, number], bbox: Bbox): NonNullable<SceneResult["shapes"]> {
  const mx = boxWidthM(bbox) / imageSize[0], my = ((bbox[3] - bbox[1]) * 110_574) / imageSize[1];
  const out: NonNullable<SceneResult["shapes"]> = [];
  for (const p of polys) {
    if (p.points.length < 3) continue;
    const xy = p.points.map(([x, y]) => [x * mx, y * my]);
    let a = 0, per = 0, span = 0;
    for (let i = 0; i < xy.length; i++) { const u = xy[i], w = xy[(i + 1) % xy.length]; a += u[0] * w[1] - w[0] * u[1]; per += Math.hypot(w[0] - u[0], w[1] - u[1]); }
    for (let i = 0; i < xy.length; i++) for (let j = i + 1; j < xy.length; j++) span = Math.max(span, Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]));
    const area = Math.abs(a) / 2;
    if (area < 12) continue;
    const roundness = area / (Math.PI * (span / 2) ** 2), compact = (4 * Math.PI * area) / (per * per || 1);
    const k = roundness >= 0.72 && compact >= 0.75 && span >= 4 && span <= 90 ? 1 : area <= 6000 && compact >= 0.45 ? 2 : 3;
    const heightM = k === 1 ? Math.max(4, Math.min(16, span * 0.5)) : k === 2 ? 6 : 0.6;
    const ring = p.points.map(([x, y]) => [round6(bbox[0] + (x / imageSize[0]) * (bbox[2] - bbox[0])), round6(bbox[3] - (y / imageSize[1]) * (bbox[3] - bbox[1]))] as [number, number]);
    out.push({ ring: [...ring, ring[0]], k, heightM: Math.round(heightM * 10) / 10, areaM2: Math.round(area), score: Math.round((p.score ?? 0) * 100) / 100 });
  }
  return out.sort((a, b) => b.areaM2 - a.areaM2).slice(0, 600);
}

/* ---------------- Free: a finding's change, in 3D ---------------- */

export const HEAT_LEGEND: SceneLegend = [{ k: 1, label: "New bare ground", color: [255, 176, 32] }, { k: 2, label: "New dark surface (water, tanks, paving)", color: [56, 189, 248] }];

/** A ground-change finding's mask (its overlay image) as 3D cells of 8 by 8 pixels (80 m at Sentinel-2's 10 m). */
export function heatFromOverlay(overlay: string, bbox: Bbox): SceneResult {
  const { mask, width, height } = maskFromOverlay(overlay);
  const cellPx = 8;
  const cells = maskCells(mask, width, height, bbox, cellPx);
  const cellM = Math.round((boxWidthM(bbox) / width) * cellPx);
  return {
    kind: "heat", version: SCENE_VERSION, bbox, cellM, cells, legend: HEAT_LEGEND,
    summary: `${cells.length} cells of about ${cellM} m changed; each stands as tall as the share of it that changed.`,
    source: [SENTINEL], notes: ["The change is the finding's own: two Sentinel-2 scenes a year apart, compared pixel by pixel."],
  };
}

/* ---------------- maps.scene: land use ---------------- */

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
export const IO_LULC: SourceInfo = {
  key: "io-lulc-annual-v02", name: "Impact Observatory 10 m annual land use and land cover (v2), via Microsoft Planetary Computer",
  url: "https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02", license: "CC BY 4.0 (Impact Observatory, Microsoft and Esri)", vintage: "yearly, 2017 onwards",
};

async function lulcItems(bbox: Bbox): Promise<StacItem[]> {
  const res = await fetch(STAC, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({ collections: [IO_LULC.key], bbox, limit: 40 }),
  });
  if (!res.ok) throw new Error(`Land-use search answered ${res.status}`);
  return ((await res.json()) as { features?: StacItem[] }).features ?? [];
}

const yearOf = (i: StacItem) => Number(String(i.properties.start_datetime ?? i.properties.datetime ?? "").slice(0, 4));

/** The box's land use in the newest year and five years before (or the oldest there is), as 3D cells. */
export async function landUse(bbox: Bbox): Promise<SceneResult> {
  return cacheJson(`edge:scene:landuse:v1:${bbox.map((v) => v.toFixed(4)).join(",")}`, MONTH, async () => {
    const items = (await lulcItems(bbox)).filter((i) => yearOf(i) > 2000 && i.bbox[0] < bbox[2] && i.bbox[2] > bbox[0] && i.bbox[1] < bbox[3] && i.bbox[3] > bbox[1]);
    if (!items.length) throw Object.assign(new Error("No land-use map covers this place."), { status: 404 });
    const years = [...new Set(items.map(yearOf))].sort((a, b) => a - b);
    const newest = years[years.length - 1], older = years.filter((y) => y <= newest - 5).pop() ?? years[0];
    const size = 128;
    const read = async (year: number) => {
      const z = new Uint8Array(size * size);
      const wins = await pool(items.filter((i) => yearOf(i) === year).slice(0, 4), 2, (i) => readWindow(IO_LULC.key, i.id, bbox, size, size, "nearest", { assets: "data" }).catch(() => null));
      for (const w of wins) if (w) for (let i = 0; i < z.length; i++) if (!z[i] && w.valid[i] && LULC[Math.round(w.z[i])]) z[i] = Math.round(w.z[i]);
      return z;
    };
    const [now, before] = await Promise.all([read(newest), older === newest ? Promise.resolve(new Uint8Array(size * size)) : read(older)]);
    const cellPx = 4;
    const cells = landUseCells(now, before, size, size, bbox, cellPx);
    if (!cells.length) throw Object.assign(new Error("The land-use map has no data here."), { status: 404 });
    const grew = cells.filter((c) => c.t === 1).length;
    const built = cells.filter((c) => c.k === 7).length;
    return {
      kind: "landuse", version: SCENE_VERSION, bbox, cellM: Math.round((boxWidthM(bbox) / size) * cellPx), cells,
      legend: Object.entries(LULC).map(([k, v]) => ({ k: Number(k), label: v.label, color: v.color })),
      layers: [String(older), String(newest)],
      summary: `In ${newest}, ${Math.round((built / cells.length) * 100)}% of this area was built; ${grew} cell${grew === 1 ? "" : "s"} became built or bare ground since ${older} (outlined).`,
      source: [IO_LULC], notes: ["Each block is a cell's most common class; built area stands tallest. The classes are a model's reading of Sentinel-2, about 85% accurate overall, less so for small or mixed cells."],
    };
  });
}

/* ---------------- maps.scene: change through time ---------------- */

/** Two years of change, every other month against the first, stacked: one layer of cells per month. */
export async function changeCube(bbox: Bbox): Promise<SceneResult> {
  return cacheJson(`edge:scene:cube:v1:${bbox.map((v) => v.toFixed(4)).join(",")}:${new Date().toISOString().slice(0, 7)}`, 7 * 86_400_000, async () => {
    const all = await timelapse(bbox, 24, 128);
    if (all.length < 3) throw Object.assign(new Error("Too few clear Sentinel-2 images of this place in two years to stack."), { status: 404 });
    const step = all.length > 12 ? 2 : 1;
    const frames = all.filter((_, i) => i % step === 0 || i === all.length - 1).slice(-12);
    const size = 128;
    const read = (f: (typeof frames)[number]) => Promise.all([
      crop({ id: f.scene, date: f.date, cloud: f.cloud }, bbox, size).then(decodePng),
      classes({ id: f.scene, date: f.date, cloud: f.cloud }, bbox, size).then(decodePng).then((p) => classesFrom(p.data, p.width, p.height)),
    ]).catch(() => null);
    const imgs = await pool(frames, 6, read);
    const baseAt = imgs.findIndex(Boolean);
    if (baseAt < 0) throw Object.assign(new Error("Sentinel-2 images of this place did not load; try again in a moment."), { status: 502 });
    const base = imgs[baseAt]!;
    const km = boxWidthM(bbox) / 1000;
    const cells: SceneCell[] = [];
    const layers: string[] = [];
    for (let m = baseAt + 1; m < frames.length; m++) {
      const img = imgs[m];
      if (!img) continue;
      const r = changeBetween(base[0].data, img[0].data, size, size, km * km, { classesBefore: base[1], classesAfter: img[1] });
      if (r.sceneWide || r.validFraction < 0.5) continue;
      const layer = layers.length;
      layers.push(frames[m].month);
      for (const c of maskCells(r.mask, size, size, bbox, 8, 0.06)) cells.push({ ...c, t: layer });
    }
    if (!layers.length) throw Object.assign(new Error("No month was clear enough to compare with the first."), { status: 404 });
    return {
      kind: "cube", version: SCENE_VERSION, bbox, cellM: Math.round((boxWidthM(bbox) / size) * 8), cells, legend: HEAT_LEGEND, layers: [frames[baseAt].month, ...layers],
      summary: `${layers.length} months compared with ${frames[baseAt].month}: each layer is a month, so new ground stands as a column from the month it appeared.`,
      source: [SENTINEL], notes: ["Months with cloud over much of the site, or that differ everywhere (a flood, smoke), are skipped. Each comparison is the same pixel method as Edge's ground-change cards."],
    };
  });
}

/* ---------------- ML jobs: AI change and footprints ---------------- */

export const ALPHAEARTH: SourceInfo = {
  key: "alphaearth", name: "AlphaEarth Foundations Satellite Embedding dataset (Google and Google DeepMind), via source.coop",
  url: "https://source.coop/tge-labs/aef", license: "CC BY 4.0", vintage: "annual, 10 m",
};
export const SAM_SOURCE: SourceInfo = {
  key: "sam2", name: "Segment Anything 2.1 (Meta), automatic masks on YouBank's ML service", url: "https://github.com/facebookresearch/sam2", license: "Apache-2.0 (model); imagery as credited", vintage: "run on request",
};

export type SceneJob = { id: string; userId: string; kind: "ai-change" | "footprints"; bbox: Bbox; callId: string; cacheKey: string; image?: { url: string; size: [number, number]; source: string } };
const jobKey = (id: string) => `edge:scene:job:v1:${id}`;

/** What a finished job became, or null while it runs. Throws a plain error when it failed. */
export async function pollJob(id: string, userId: string): Promise<SceneResult | null> {
  const raw = await cacheGet(jobKey(id));
  if (!raw) throw Object.assign(new Error("That analysis has expired; start it again."), { status: 404 });
  const job = JSON.parse(raw) as SceneJob;
  if (job.userId !== userId) throw Object.assign(new Error("That analysis is not yours."), { status: 404 });
  const ready = await cacheGet(job.cacheKey);
  if (ready) return JSON.parse(ready) as SceneResult;
  const s = await mlStatus(job.callId);
  if (!s.done) return null;
  noteMlCost(s.costUsd);
  if (!s.ok || !s.result) throw Object.assign(new Error("The analysis did not finish on the ML service. Nothing was saved; try again later."), { status: 502 });
  const result = job.kind === "ai-change" ? aiChangeResult(s.result, job.bbox) : footprintsResult(s.result, job);
  await cacheSet(job.cacheKey, JSON.stringify(result), MONTH);
  return result;
}

/** Start an ML analysis of a box, unless the same place's result is already kept (then it is returned). */
export async function startJob(kind: SceneJob["kind"], bbox: Bbox, userId: string, image?: SceneJob["image"]): Promise<{ job: string } | { result: SceneResult }> {
  const cacheKey = `edge:scene:${kind}:v1:${bbox.map((v) => v.toFixed(4)).join(",")}`;
  const ready = await cacheGet(cacheKey);
  if (ready) return { result: JSON.parse(ready) as SceneResult };
  const id = randomUUID();
  const task: MlTask = kind === "ai-change" ? "geo.embed_change" : "geo.footprints";
  const input = kind === "ai-change" ? { bbox, grid: 40 } : { bbox, image: image!.url, maxMasks: 400 };
  const callId = await mlStart(task, input, `scene:${id}`);
  const job: SceneJob = { id, userId, kind, bbox, callId, cacheKey, image };
  await cacheSet(jobKey(id), JSON.stringify(job), 2 * 3_600_000);
  return { job: id };
}

export const AI_LEGEND: SceneLegend = [{ k: 1, label: "Changed a little", color: [188, 55, 84] }, { k: 2, label: "Changed a lot", color: [249, 142, 9] }, { k: 3, label: "Changed completely", color: [252, 255, 164] }];

/** geo.embed_change's grid (1 - cosine similarity per cell, -1 where there is no data) as 3D cells. Pure. */
export function aiChangeResult(r: Record<string, unknown>, bbox: Bbox): SceneResult {
  const grid = r.grid as { width?: number; height?: number; values?: number[] } | undefined;
  const w = Number(grid?.width) || 0, h = Number(grid?.height) || 0, values = grid?.values ?? [];
  const years = (r.years as number[] | undefined) ?? [];
  const cells: SceneCell[] = [];
  const vmax = 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Number(values[y * w + x]);
    if (!Number.isFinite(v) || v < 0.08) continue;
    const s = Math.min(1, v / vmax);
    cells.push({ lon: round6(bbox[0] + ((x + 0.5) / w) * (bbox[2] - bbox[0])), lat: round6(bbox[3] - ((y + 0.5) / h) * (bbox[3] - bbox[1])), v: Math.round(s * 100) / 100, k: s >= 0.7 ? 3 : s >= 0.35 ? 2 : 1 });
  }
  const stats = r.stats as { above?: Record<string, number | null> } | undefined;
  const big = stats?.above?.["0.3"];
  return {
    kind: "ai-change", version: SCENE_VERSION, bbox, cellM: w ? Math.round(boxWidthM(bbox) / w) : 0, cells, legend: AI_LEGEND, layers: years.map(String),
    summary: `${years[0] ?? "Earlier"} against ${years[1] ?? "later"}: ${typeof big === "number" ? `${Math.round(big * 100)}% of the area changed strongly` : `${cells.length} cells changed`} in AlphaEarth's reading of every satellite that saw it (optical, radar and lidar together).`,
    source: [ALPHAEARTH], notes: ["Change is 1 minus the cosine similarity of each 10 m pixel's 64-number embedding in the two years, averaged into cells. It sees any change in the ground, not only construction: crops, fire and floods count too."],
  };
}

export const FOOTPRINT_LEGEND: SceneLegend = [{ k: 1, label: "Tank (round)", color: [242, 169, 59] }, { k: 2, label: "Building", color: [229, 83, 75] }, { k: 3, label: "Pad, yard or pond", color: [160, 170, 185] }];

/** geo.footprints's outlines as 3D shapes. Pure. */
export function footprintsResult(r: Record<string, unknown>, job: Pick<SceneJob, "bbox" | "image">): SceneResult {
  const polys = (r.polygons as { points: [number, number][]; score?: number }[] | undefined) ?? [];
  const size = (r.imageSize as [number, number] | undefined) ?? job.image?.size ?? [1024, 1024];
  const shapes = footprintShapes(polys, size, job.bbox);
  const n = (k: number) => shapes.filter((s) => s.k === k).length;
  return {
    kind: "footprints", version: SCENE_VERSION, bbox: job.bbox, cellM: 0, cells: [], legend: FOOTPRINT_LEGEND, shapes,
    summary: `${shapes.length} outlines: ${n(1)} round like tanks, ${n(2)} buildings, ${n(3)} pads, yards or ponds.`,
    source: [SAM_SOURCE, { key: "footprint-image", name: job.image?.source ?? "Aerial or satellite image", url: "", license: "As credited by its source", vintage: "" }],
    notes: ["Shapes are sorted by outline alone, and heights are estimates (a tank about half as tall as it is wide, a building 6 m). Open the lidar twin for measured heights."],
  };
}

/** The image footprints are traced on: the twin's NAIP photograph in the US, else the clearest Sentinel-2 scene of the last two months (10 m: pads and ponds, not buildings). */
export async function footprintImage(bbox: Bbox, naipUrl: string | null): Promise<NonNullable<SceneJob["image"]>> {
  if (naipUrl) return { url: naipUrl, size: [1024, 1024], source: "USDA NAIP aerial photograph (0.6 m), via Microsoft Planetary Computer" };
  const scene = await clearestNear(bbox, new Date(), 60);
  if (!scene) throw Object.assign(new Error("No clear satellite image of this place in the last two months to trace."), { status: 404 });
  return { url: cropUrl(scene, bbox, 512), size: [512, 512], source: `${SENTINEL.name}, ${scene.date}` };
}
