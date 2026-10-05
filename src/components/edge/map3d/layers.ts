/**
 * The 3D map's layer registry: every deck.gl layer Edge draws over MapLibre, in one list. Each entry
 * says what it is, whether a plan feature unlocks its data, whether it animates, when it has something
 * to draw, how to build its deck.gl layers from the scene, and what a click on it says.
 *
 * To add a layer (a new kind of site, say crypto-mining facilities): append an entry to MAP_LAYERS,
 * put its data in `scene.extra[<your id>]` from the page, and build it here. EarthMap needs no change:
 * it draws whatever the registry builds, lights it with the sun, and routes clicks to `describe`.
 *
 * deck.gl itself is passed in (`ctx.mods`), loaded only when a 3D layer first has data, so nothing here
 * pulls it into the page's first load.
 */
import type { Layer } from "@deck.gl/core";
import { deckMesh, flameMesh, hallMesh, merge, stackMesh, tankMesh, tinted, towerMesh, tube } from "@/lib/edge/geo3d/mesh";
import { heightAt } from "@/lib/edge/geo3d/heights";
import { LIDAR_CLASSES } from "@/lib/edge/geo3d/ept";
import type { DigitalTwin, TwinFlame, TwinModel } from "@/lib/edge/twin";
import type { SceneCell } from "@/lib/edge/scene";
import { cloudColors, cloudOriginZ, cloudRange, flameColor, flicker, type CloudPass, type Map3DScene, type Rgba } from "./scene";

export type DeckModules = {
  core: typeof import("@deck.gl/core");
  layers: typeof import("@deck.gl/layers");
  mesh: typeof import("@deck.gl/mesh-layers");
};

export type LayerContext = {
  mods: DeckModules;
  scene: Map3DScene;
  /** Milliseconds, for animated layers. */
  time: number;
  zoom: number;
  /** Terrain exaggeration; 0 when the terrain is off (everything then stands at height 0). */
  relief: number;
  /** Height of the drawn ground at a point, exaggeration included. */
  ground: (lon: number, lat: number) => number;
  /** Changes when more terrain has loaded, so layers placed with `ground` are placed again. */
  groundKey: number;
  lite: boolean;
};

export type MapLayerDef = {
  id: string;
  label: string;
  description: string;
  /** The plan feature whose data this layer draws (the data arrives only when the plan allows it). */
  premium?: string;
  animated?: boolean;
  has: (scene: Map3DScene) => boolean;
  build: (ctx: LayerContext) => Layer[];
  /** Plain text for a clicked object, or null. */
  describe?: (object: unknown, scene: Map3DScene) => string | null;
};

/* ---------------- Meshes, built once ---------------- */

let meshes: { tank: object; stack: object; tower: object; flame: object; hall: object } | null = null;
const MESH = () => (meshes ??= { tank: deckMesh(tankMesh()), stack: deckMesh(stackMesh()), tower: deckMesh(towerMesh()), flame: deckMesh(flameMesh()), hall: deckMesh(hallMesh()) });

const MODEL_COLOR: Record<TwinModel["basis"], Rgba> = { lidar: [242, 169, 59, 255], osm: [246, 196, 120, 255], estimated: [214, 205, 190, 235] };
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const BARRELS_PER_M3 = 6.2898;
const basisWords = (m: TwinModel) => (m.basis === "lidar" ? "measured by USGS lidar" : m.basis === "osm" ? "as tagged in OpenStreetMap" : "estimated from its mapped outline");

/** The ground under a twin object: the twin's own grid when terrain is on (scaled by the exaggeration), else 0. */
const twinZ = (twin: DigitalTwin, ctx: LayerContext, lon: number, lat: number) => (ctx.relief > 0 ? heightAt(twin.ground, lon, lat) * ctx.relief : 0);

/* ---------------- Pipelines as one merged tube mesh per twin ---------------- */

const SUBSTANCE: Record<string, [number, number, number]> = { gas: [255, 214, 90], oil: [120, 84, 60], water: [80, 160, 235] };
const pipeCache = new WeakMap<DigitalTwin, { relief: number; mesh: object }>();
function pipeMesh(twin: DigitalTwin, relief: number): object {
  const hit = pipeCache.get(twin);
  if (hit && hit.relief === relief) return hit.mesh;
  const kx = 111_320 * Math.cos((twin.center.lat * Math.PI) / 180), ky = 110_574;
  const parts = twin.tubes.map((t) => {
    const path = t.path.map(([lon, lat, z]) => [(lon - twin.center.lon) * kx, (lat - twin.center.lat) * ky, relief > 0 ? z + (relief - 1) * (z - 1.5) : 1.5] as [number, number, number]);
    return tinted(tube(path, 1.2, 8), SUBSTANCE[t.substance.toLowerCase()] ?? [200, 200, 210]);
  });
  const mesh = deckMesh(merge(...parts));
  pipeCache.set(twin, { relief, mesh });
  return mesh;
}

/* ---------------- Point cloud colours, kept per pass ---------------- */

const colorCache = new WeakMap<CloudPass, { key: string; colors: Uint8Array }>();
function passColors(p: CloudPass, mode: "class" | "height" | "intensity", range: [number, number]): Uint8Array {
  const key = `${mode}:${range[0].toFixed(1)}:${range[1].toFixed(1)}`;
  const hit = colorCache.get(p);
  if (hit?.key === key) return hit.colors;
  const colors = cloudColors(p, mode, range);
  colorCache.set(p, { key, colors });
  return colors;
}

/* ---------------- Scene cells ---------------- */

const CELL_SCALE: Record<string, number> = { heat: 140, "ai-change": 160, landuse: 70, cube: 0 };
const CUBE_LAYER_M = 14;

function cellColor(result: NonNullable<Map3DScene["analysis"]>, c: SceneCell, upTo: number): Rgba {
  const legend = result.legend.find((l) => l.k === c.k);
  const [r, g, b] = legend?.color ?? [200, 200, 200];
  if (result.kind === "landuse") return [r, g, b, c.t ? 255 : 170];
  if (result.kind === "cube") return [r, g, b, Math.round(110 + 145 * ((c.t ?? 0) + 1) / Math.max(1, upTo + 1))];
  return [r, g, b, Math.round(150 + 105 * c.v)];
}

/* ---------------- The registry ---------------- */

export const MAP_LAYERS: MapLayerDef[] = [
  {
    id: "flare-beacons", label: "Flaring plants", description: "Plants NASA's satellites saw flaring this week, as a stack with a flame sized by the heat. Larger than life until you zoom in.",
    animated: true,
    has: (s) => !!s.flares?.length,
    build: (ctx) => {
      const { mesh: M } = ctx.mods;
      const twinIds = new Set((ctx.scene.twin?.flames ?? []).map((f) => f.detectionId));
      const data = (ctx.scene.flares ?? []).filter((f) => !twinIds.has(f.id));
      if (!data.length) return [];
      // About 24 pixels tall at any zoom (a 30 m stack is a speck at zoom 11), true size only close in.
      const metresPerPixel = (156_543 * Math.cos((data[0].lat * Math.PI) / 180)) / 2 ** ctx.zoom;
      const grow = Math.max(1, metresPerPixel * 0.8);
      const intensity = (f: (typeof data)[number]) => Math.min(1, 0.2 + 0.6 * Math.min(1, f.frpMw / 40) + 0.2 * Math.min(1, f.days / 7));
      const z = (f: (typeof data)[number]) => ctx.ground(f.lon, f.lat);
      return [
        new M.SimpleMeshLayer({ id: "flare-beacons:stack", data, mesh: MESH().stack as never, sizeScale: grow, getPosition: (f) => [f.lon, f.lat, z(f)], getScale: [3, 3, 30], getColor: [205, 210, 218, 255], pickable: true, updateTriggers: { getPosition: [ctx.relief, ctx.groundKey] } }),
        new M.SimpleMeshLayer({
          id: "flare-beacons:flame", data, mesh: MESH().flame as never, sizeScale: grow, pickable: true,
          getPosition: (f) => [f.lon, f.lat, z(f) + 30 * grow],
          getScale: (f) => { const k = 8 + 22 * intensity(f), s = flicker(ctx.time, f.id, intensity(f)); return [k * 0.42, k * 0.42, k * s]; },
          getColor: (f) => flameColor(intensity(f)), material: { ambient: 1, diffuse: 0, shininess: 0 },
          updateTriggers: { getScale: ctx.time, getPosition: [ctx.relief, grow, ctx.groundKey] },
        }),
      ];
    },
    describe: (o) => { const f = o as { title?: string; frpMw?: number; days?: number }; return f.title ? `${f.title}. ${fmt(f.frpMw ?? 0)} MW of radiant heat this week (NASA VIIRS).` : null; },
  },
  {
    id: "twin-models", label: "Tanks, stacks and towers", description: "Storage tanks sized from lidar or OpenStreetMap, stacks, towers and shafts, standing on the terrain.",
    has: (s) => !!s.twin?.models.length,
    build: (ctx) => {
      const twin = ctx.scene.twin!;
      const { mesh: M } = ctx.mods;
      const pos = (m: TwinModel) => [m.lon, m.lat, twinZ(twin, ctx, m.lon, m.lat) - 0.3] as [number, number, number];
      const tanks = twin.models.filter((m) => m.kind === "tank");
      const stacks = twin.models.filter((m) => m.kind === "stack" || m.kind === "flare");
      const towers = twin.models.filter((m) => m.kind === "tower" || m.kind === "shaft");
      const common = { pickable: true, getPosition: pos, updateTriggers: { getPosition: ctx.relief } };
      return [
        new M.SimpleMeshLayer<TwinModel>({ id: "twin-models:tanks", data: tanks, mesh: MESH().tank as never, getScale: (m) => [m.diameterM, m.diameterM, m.heightM], getColor: (m) => MODEL_COLOR[m.basis], ...common }),
        new M.SimpleMeshLayer<TwinModel>({ id: "twin-models:stacks", data: stacks, mesh: MESH().stack as never, getScale: (m) => [Math.max(1, m.diameterM), Math.max(1, m.diameterM), m.heightM], getColor: [212, 216, 224, 255], ...common }),
        new M.SimpleMeshLayer<TwinModel>({ id: "twin-models:towers", data: towers, mesh: MESH().tower as never, getScale: (m) => [Math.max(2, m.diameterM), Math.max(2, m.diameterM), m.heightM], getColor: (m) => (m.kind === "shaft" ? [150, 128, 104, 255] : [190, 196, 206, 255]), ...common }),
      ];
    },
    describe: (o) => {
      const m = o as TwinModel;
      if (!m?.kind) return null;
      const name = m.name ? `${m.name}: ` : "";
      if (m.kind === "tank") return `${name}Storage tank, ${m.diameterM} m across and ${m.heightM} m tall, ${basisWords(m)}${m.volumeM3 ? `. About ${fmt(m.volumeM3)} m³ (${fmt(m.volumeM3 * BARRELS_PER_M3)} barrels) of shell` : ""}${m.content ? `; holds ${m.content}` : ""}.`;
      if (m.kind === "flare") return `${name}Flare stack, ${m.heightM} m tall, ${basisWords(m)}.`;
      if (m.kind === "stack") return `${name}Stack or chimney, ${m.heightM} m tall, ${basisWords(m)}.`;
      if (m.kind === "shaft") return `${name}Mine shaft headframe${m.content ? ` (${m.content})` : ""}, ${m.heightM} m, ${basisWords(m)}.`;
      return `${name}Tower or column, ${m.heightM} m tall, ${basisWords(m)}.`;
    },
  },
  {
    id: "twin-flames", label: "Flares", description: "The plant's flaring in the last six weeks: a flame on the stack, sized and coloured by the heat NASA's satellites measured.",
    animated: true,
    has: (s) => !!s.twin?.flames.length,
    build: (ctx) => {
      const twin = ctx.scene.twin!;
      const { mesh: M, layers: L } = ctx.mods;
      const base = (f: TwinFlame) => twinZ(twin, ctx, f.lon, f.lat);
      return [
        new L.ScatterplotLayer<TwinFlame>({ id: "twin-flames:glow", data: twin.flames, radiusUnits: "meters", getRadius: (f) => 30 + 90 * f.intensity * flicker(ctx.time, f.detectionId + 7, f.intensity), getPosition: (f) => [f.lon, f.lat, base(f) + 0.5], getFillColor: [255, 140, 40, 46], stroked: false, billboard: false, updateTriggers: { getRadius: ctx.time, getPosition: ctx.relief } }),
        new M.SimpleMeshLayer<TwinFlame>({ id: "twin-flames:stack", data: twin.flames.filter((f) => f.placed === "viirs"), mesh: MESH().stack as never, getPosition: (f) => [f.lon, f.lat, base(f)], getScale: (f) => [1.4, 1.4, f.stackM], getColor: [212, 216, 224, 255], pickable: true, updateTriggers: { getPosition: ctx.relief } }),
        new M.SimpleMeshLayer<TwinFlame>({
          id: "twin-flames:flame", data: twin.flames, mesh: MESH().flame as never, pickable: true,
          getPosition: (f) => [f.lon, f.lat, base(f) + f.stackM],
          getScale: (f) => { const h = f.stackM * (0.3 + 0.6 * f.intensity) * flicker(ctx.time, f.detectionId, f.intensity); return [h * 0.4, h * 0.4, h]; },
          getColor: (f) => flameColor(f.intensity), material: { ambient: 1, diffuse: 0, shininess: 0 },
          updateTriggers: { getScale: ctx.time, getPosition: ctx.relief },
        }),
      ];
    },
    describe: (o) => { const f = o as TwinFlame; return f?.detectionId ? `Flaring on ${f.days} of 7 days to ${f.to}: ${fmt(f.frpMw)} MW of radiant heat (NASA VIIRS, 375 m pixels). ${f.placed === "viirs" ? "Placed where the heat was seen; the stack itself is not mapped." : "Shown on the nearest mapped stack."}` : null; },
  },
  {
    id: "twin-pipes", label: "Pipelines", description: "Pipelines through the site from EIA and OpenStreetMap, as tubes following the ground (drawn 2.4 m thick; most are buried).",
    has: (s) => !!s.twin?.tubes.length,
    build: (ctx) => {
      const twin = ctx.scene.twin!;
      // The mesh carries its own heights (metres above sea level, scaled with the relief) around the twin's centre.
      return [new ctx.mods.mesh.SimpleMeshLayer({ id: "twin-pipes", data: [twin.center], mesh: pipeMesh(twin, ctx.relief) as never, getPosition: (c: { lon: number; lat: number }) => [c.lon, c.lat, 0], getColor: [255, 255, 255, 255], pickable: true })];
    },
    describe: () => "Pipelines (EIA and OpenStreetMap). Routes are approximate, and most pipe is buried.",
  },
  {
    id: "lidar-cloud", label: "Lidar point cloud", description: "USGS 3DEP lidar returns, coloured by class, height or intensity.",
    premium: "maps.lidar",
    has: (s) => !!s.cloud?.passes.length,
    build: (ctx) => {
      const cloud = ctx.scene.cloud!, twin = ctx.scene.twin;
      const { core, layers: L } = ctx.mods;
      const range = cloud.color === "height" ? cloudRange(cloud.passes) : ([0, 1] as [number, number]);
      const first = cloud.passes[0].header;
      const terrain = twin ? heightAt(twin.ground, first.origin.lon, first.origin.lat) : null;
      // On flat ground (terrain off) the cloud's ground sits at 0; on terrain it meets the drawn ground.
      const originZ = ctx.relief > 0 ? cloudOriginZ(first, terrain, ctx.relief) : first.origin.z - (first.groundZ ?? first.origin.z);
      return cloud.passes.map((p, i) => new L.PointCloudLayer({
        id: `lidar-cloud:${i}`,
        data: { length: p.header.n, attributes: { getPosition: { value: p.positions, size: 3 }, getColor: { value: passColors(p, cloud.color, range), size: 4, normalized: true } } },
        coordinateSystem: core.COORDINATE_SYSTEM.METER_OFFSETS,
        coordinateOrigin: [p.header.origin.lon, p.header.origin.lat, originZ + (p.header.origin.z - first.origin.z)],
        pointSize: cloud.pointSize, sizeUnits: "pixels", material: false, pickable: false,
        updateTriggers: { getColor: `${cloud.color}:${range.join(",")}` },
      }));
    },
  },
  {
    id: "scene-cells", label: "Scene analysis", description: "The analysis as 3D cells: each stands as tall as the share of it that changed, or by its land use.",
    has: (s) => !!s.analysis?.cells.length,
    build: (ctx) => {
      const a = ctx.scene.analysis!;
      const upTo = ctx.scene.analysisUpTo ?? Number.MAX_SAFE_INTEGER;
      const data = a.kind === "cube" ? a.cells.filter((c) => (c.t ?? 0) <= upTo) : a.cells;
      const radius = (a.cellM / Math.SQRT2) * 0.94;
      const z = (c: SceneCell) => ctx.ground(c.lon, c.lat) + (a.kind === "cube" ? (c.t ?? 0) * CUBE_LAYER_M : 0);
      return [new ctx.mods.layers.ColumnLayer<SceneCell>({
        id: "scene-cells", data, diskResolution: 4, angle: 45, radius, extruded: true, pickable: true, coverage: 1,
        getPosition: (c) => [c.lon, c.lat, z(c)],
        getElevation: (c) => (a.kind === "cube" ? CUBE_LAYER_M * 0.85 : Math.max(2, c.v * CELL_SCALE[a.kind] * (a.kind === "landuse" && c.t ? 1.4 : 1))),
        getFillColor: (c) => cellColor(a, c, upTo === Number.MAX_SAFE_INTEGER ? (a.layers?.length ?? 1) : upTo),
        material: { ambient: 0.55, diffuse: 0.55, shininess: 12 },
        updateTriggers: { getPosition: [ctx.relief, upTo, ctx.groundKey], getFillColor: upTo },
      })];
    },
    describe: (o, scene) => {
      const c = o as SceneCell, a = scene.analysis;
      if (typeof c?.v !== "number" || !a) return null;
      const label = a.legend.find((l) => l.k === c.k)?.label ?? "";
      if (a.kind === "landuse") return `${label}${c.t ? `, which became ${label.toLowerCase()} since ${a.layers?.[0] ?? "the earlier year"}` : ""} (${a.cellM} m cell, Impact Observatory's ${a.layers?.[1] ?? ""} map).`;
      if (a.kind === "cube") return `${label} by ${a.layers?.[(c.t ?? 0) + 1] ?? "this month"}: ${Math.round(c.v * 100)}% of this ${a.cellM} m cell, against ${a.layers?.[0] ?? "the first month"}.`;
      if (a.kind === "ai-change") return `${label}: ${Math.round(c.v * 100)}% of the scale (AlphaEarth embeddings, ${a.layers?.join(" against ") ?? ""}).`;
      return `${label}: ${Math.round(c.v * 100)}% of this ${a.cellM} m cell changed.`;
    },
  },
  {
    id: "scene-shapes", label: "Footprints", description: "Outlines traced by Segment Anything, raised to estimated heights: tanks, buildings and pads.",
    premium: "maps.footprints",
    has: (s) => !!s.analysis?.shapes?.length,
    build: (ctx) => {
      const a = ctx.scene.analysis!;
      type Shape = NonNullable<typeof a.shapes>[number];
      return [new ctx.mods.layers.SolidPolygonLayer<Shape>({
        id: "scene-shapes", data: a.shapes ?? [], extruded: true, pickable: true,
        getPolygon: (s) => { const zc = ctx.ground(s.ring[0][0], s.ring[0][1]); return s.ring.map(([lon, lat]) => [lon, lat, zc] as [number, number, number]); },
        getElevation: (s) => s.heightM, getFillColor: (s) => [...(a.legend.find((l) => l.k === s.k)?.color ?? [200, 200, 200]), 225] as Rgba,
        material: { ambient: 0.5, diffuse: 0.6, shininess: 16 }, updateTriggers: { getPolygon: [ctx.relief, ctx.groundKey] },
      })];
    },
    describe: (o) => { const s = o as { k?: number; areaM2?: number; heightM?: number; score?: number }; return s?.k ? `${s.k === 1 ? "Round, tank-like" : s.k === 2 ? "Building" : "Pad, yard or pond"}: ${fmt(s.areaM2 ?? 0)} m², drawn ${s.heightM} m tall (an estimate). Segment Anything's confidence ${Math.round((s.score ?? 0) * 100)}%.` : null; },
  },
];

/** The registry entry a deck.gl layer id belongs to ("twin-models:tanks" -> twin-models). */
export const layerDef = (deckId: string) => MAP_LAYERS.find((d) => deckId === d.id || deckId.startsWith(`${d.id}:`));

/** Every deck.gl layer the scene calls for, in registry order, skipping hidden ones. */
export function buildLayers(ctx: LayerContext): Layer[] {
  const hidden = new Set(ctx.scene.hidden ?? []);
  return MAP_LAYERS.filter((d) => !hidden.has(d.id) && d.has(ctx.scene)).flatMap((d) => d.build(ctx));
}

/** Whether anything in the scene animates (the map then redraws every frame while it is on screen). */
export const animates = (scene: Map3DScene) => MAP_LAYERS.some((d) => d.animated && !(scene.hidden ?? []).includes(d.id) && d.has(scene));

/** Lidar class names and colours, for the legend. */
export const CLASS_LEGEND = Object.entries(LIDAR_CLASSES).map(([k, v]) => ({ k: Number(k), ...v }));

/** The data-hall mesh, exported for layers added later (data centres drawn as models rather than extruded outlines). */
export const hallModel = () => MESH().hall;
