/**
 * The 3D map's MapLibre side: the sun's light on buildings and hills and the sky's colour, 3D buildings
 * from OpenFreeMap's OpenStreetMap tiles, a digital twin's data centres and mines, images draped on the
 * terrain (a time-lapse frame), Planet's tiles through YouBank's proxy, and the globe. Each function
 * adds what is missing and updates what is there, so calling it again is safe.
 */
import type { ExpressionSpecification, GeoJSONSource, ImageSource, Map as MLMap } from "maplibre-gl";
import { hillshadeFor, lightFor, skyFor, type Sun } from "@/lib/edge/geo3d/sun";
import type { Bbox } from "@/lib/edge/sources/eia";
import type { TwinArea } from "@/lib/edge/twin";

/** Our own layers, top to bottom of what new layers are slipped under. */
export const OUR_LAYERS = ["county-fill", "county-line", "pipes", "plant-columns", "plants", "markers-halo", "markers"];

/** Insert below the first of these layers that exists (so new layers sit under our own). */
export const below = (m: MLMap, ids: string[]) => ids.find((id) => m.getLayer(id));

export const corners = (b: Bbox): [[number, number], [number, number], [number, number], [number, number]] => [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]];

/** Sky colours for the globe and the tilted map, tinted by the sun; the atmosphere shows only zoomed out (the globe). */
export function skySpec(sun: Sun, dark: boolean) {
  const c = skyFor(sun.altitude, dark);
  return {
    "sky-color": c.sky, "horizon-color": c.horizon, "fog-color": c.fog,
    "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4,
    "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 1, 7, 0] as ExpressionSpecification,
  };
}

/** Light buildings, hills and the sky from where the sun stands. */
export function applySun(m: MLMap, sun: Sun, dark: boolean, threeD: boolean) {
  const l = lightFor(sun);
  m.setLight({ anchor: "map", position: l.position, color: l.color, intensity: l.intensity });
  if (m.getLayer("hillshade")) {
    const h = hillshadeFor(sun);
    m.setPaintProperty("hillshade", "hillshade-illumination-direction", h.direction);
    m.setPaintProperty("hillshade", "hillshade-illumination-altitude", h.altitude);
    m.setPaintProperty("hillshade", "hillshade-exaggeration", h.exaggeration);
  }
  if (threeD || m.getProjection()?.type === "globe") m.setSky(skySpec(sun, dark));
}

/** The basemap's vector source (OpenFreeMap names it "openmaptiles"), for 3D buildings. */
function vectorSource(m: MLMap): string | null {
  const sources = m.getStyle()?.sources ?? {};
  if (sources.openmaptiles) return "openmaptiles";
  return Object.entries(sources).find(([, s]) => s.type === "vector")?.[0] ?? null;
}

/** OpenStreetMap's buildings raised to their mapped heights (render_height; 6 m where untagged), from zoom 13, in 3D only. */
export function syncBuildings(m: MLMap, on: boolean, dark: boolean) {
  if (!m.getLayer("buildings-3d")) {
    if (!on) return;
    const src = vectorSource(m);
    if (!src) return;
    m.addLayer({
      id: "buildings-3d", type: "fill-extrusion", source: src, "source-layer": "building", minzoom: 13,
      paint: {
        "fill-extrusion-color": dark ? "#46505e" : "#d9d4cc",
        "fill-extrusion-height": ["interpolate", ["linear"], ["zoom"], 13, 0, 14, ["coalesce", ["get", "render_height"], 6]],
        "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
        "fill-extrusion-opacity": 0.88, "fill-extrusion-vertical-gradient": true,
      },
    }, below(m, ["site-photo", "change-overlay", "drape", ...OUR_LAYERS]));
  }
  m.setLayoutProperty("buildings-3d", "visibility", on ? "visible" : "none");
}

const AREA_COLOR: ExpressionSpecification = ["match", ["get", "kind"], "datacenter", "#7C8CF8", "mine", "#C08A4B", "#9AA4B2"];

/** A twin's data centres raised to their height, and mine, quarry and works outlines on the ground. */
export function syncAreas(m: MLMap, areas: TwinArea[] | null | undefined) {
  const data = { type: "FeatureCollection" as const, features: (areas ?? []).map((a, i) => ({ type: "Feature" as const, id: i, geometry: { type: "Polygon" as const, coordinates: [[...a.ring, a.ring[0]]] }, properties: { kind: a.kind, name: a.name, h: a.heightM, operator: a.operator, estimated: a.estimated ? 1 : 0 } })) };
  const src = m.getSource("twin-areas") as GeoJSONSource | undefined;
  if (src) { src.setData(data as Parameters<GeoJSONSource["setData"]>[0]); return; }
  if (!areas?.length) return;
  m.addSource("twin-areas", { type: "geojson", data: data as Parameters<GeoJSONSource["setData"]>[0] });
  const before = below(m, ["markers-halo", "markers"]);
  m.addLayer({ id: "twin-areas-fill", type: "fill", source: "twin-areas", filter: ["!=", ["get", "kind"], "datacenter"], paint: { "fill-color": AREA_COLOR, "fill-opacity": 0.18 } }, before);
  m.addLayer({ id: "twin-areas-line", type: "line", source: "twin-areas", paint: { "line-color": AREA_COLOR, "line-width": 2, "line-dasharray": [2, 1.5] } }, before);
  m.addLayer({ id: "twin-areas-3d", type: "fill-extrusion", source: "twin-areas", filter: ["==", ["get", "kind"], "datacenter"], paint: { "fill-extrusion-color": AREA_COLOR, "fill-extrusion-height": ["get", "h"], "fill-extrusion-opacity": 0.92, "fill-extrusion-vertical-gradient": true } }, before);
}

/** An image draped on the ground over a box (a time-lapse frame); swapped in place as frames change. */
export function syncDrape(m: MLMap, d: { url: string; bbox: Bbox } | null | undefined) {
  const src = m.getSource("drape") as ImageSource | undefined;
  if (!d) {
    if (m.getLayer("drape")) m.removeLayer("drape");
    if (src) m.removeSource("drape");
    return;
  }
  if (src) { src.updateImage({ url: d.url, coordinates: corners(d.bbox) }); return; }
  m.addSource("drape", { type: "image", url: d.url, coordinates: corners(d.bbox) });
  m.addLayer({ id: "drape", type: "raster", source: "drape", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, below(m, ["change-overlay", ...OUR_LAYERS]));
}

const planetShown = new WeakMap<MLMap, string>();

/** A Planet scene's tiles over a box, through /api/edge/planet/tile (the key stays on the server). */
export function syncPlanet(m: MLMap, p: { type: string; id: string; bbox: Bbox } | null | undefined) {
  const key = p ? `${p.type}/${p.id}` : "";
  if ((planetShown.get(m) ?? "") === key && !!m.getSource("planet") === !!p) return;
  planetShown.set(m, key);
  if (m.getLayer("planet")) m.removeLayer("planet");
  if (m.getSource("planet")) m.removeSource("planet");
  if (!p) return;
  m.addSource("planet", {
    type: "raster", tileSize: 256, minzoom: 12, maxzoom: 18, bounds: p.bbox,
    tiles: [`${window.location.origin}/api/edge/planet/tile?type=${encodeURIComponent(p.type)}&id=${encodeURIComponent(p.id)}&z={z}&x={x}&y={y}`],
    attribution: "Imagery © Planet Labs PBC",
  });
  m.addLayer({ id: "planet", type: "raster", source: "planet", paint: { "raster-opacity": 1, "raster-fade-duration": 150 } }, below(m, ["site-photo", "drape", "change-overlay", ...OUR_LAYERS]));
}

/**
 * Once the terrain under the centre has loaded, make sure the camera's idea of the ground matches it.
 * MapLibre fixes the ground height a flight aims at when the flight starts, and leaves it there after;
 * a flight that lands before the destination's elevation tiles (or a change of relief) would leave the
 * camera under or far above the hills until someone drags the map. A short ease to the same view picks
 * up the loaded height.
 */
export function settleOnGround(m: MLMap) {
  m.once("idle", () => {
    if (!m.getTerrain()) return;
    const c = m.getCenter(), ground = m.queryTerrainElevation(c);
    if (ground === null || Math.abs(ground - m.getCameraTargetElevation()) < 5) return;
    m.easeTo({ center: c, zoom: m.getZoom(), pitch: m.getPitch(), bearing: m.getBearing(), duration: 500, essential: true, freezeElevation: true });
  });
}

/** The globe, or the flat map. Zooming out to see the globe is the caller's choice. */
export function setGlobe(m: MLMap, on: boolean) {
  const now = m.getProjection()?.type === "globe";
  if (now !== on) m.setProjection({ type: on ? "globe" : "mercator" });
}
