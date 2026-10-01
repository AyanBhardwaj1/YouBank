"use client";

/**
 * Edge's map: a free vector basemap (OpenFreeMap, OpenStreetMap data) in the theme's light or dark,
 * an optional recent satellite layer (Sentinel-2), counties shaded by what a deal does to them, gas
 * pipelines and processing plants coloured by company or deal side, and markers for findings. In 3D
 * the map tilts over the terrain (free elevation tiles, relief exaggerated to taste) with shaded relief
 * and a sky, and plants stand as columns by capacity until you zoom in close. Loaded only when a map
 * is on screen (MapLibre is large).
 */
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box } from "lucide-react";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import type { SiteModel } from "@/lib/edge/site3d";
import { hexagon } from "@/lib/edge/terrain-view";
import { tilt as tween } from "./tilt";
import { partyOf, type AssetCollection, type AssetFeature, type Bbox, type Imagery } from "./client";

export type MapParty = { key: string; label: string; color: string; tickers: string[]; companies: string[] };
export type MapMarker = { id: number; lon: number; lat: number; title: string; kind: string };
export type CountyShade = Record<string, { flag: "high" | "watch" | ""; shared: boolean }>;

export type EarthMapProps = {
  bbox: Bbox;
  assets?: AssetCollection | null;
  /** Deal sides: their assets take the side's colour and everyone else's fade. */
  parties?: MapParty[];
  /** Without parties: these companies get colours, the rest stay muted. */
  highlight?: { ticker: string; color: string }[];
  counties?: AssetCollection | null;
  shade?: CountyShade;
  markers?: MapMarker[];
  satellite?: Imagery | null;
  focus?: { lon: number; lat: number; zoom?: number; pitch?: number; key: number } | null;
  onMarker?: (id: number) => void;
  /** A pipeline or plant clicked on the map. */
  onAsset?: (asset: MapAsset) => void;
  /** Open tilted over the terrain. */
  initial3D?: boolean;
  /** Changing this number turns 3D on (for a parent that wants to show something in 3D). */
  want3D?: number;
  /** A site modelled in 3D: its aerial photograph draped on the ground and its structures standing on it. */
  site?: SiteModel | null;
  /** A ground change's outline (the detection's overlay image over its box), draped on the ground. */
  overlay?: { url: string; bbox: Bbox } | null;
  /** Told the zoom level as it changes (the satellite layer shows from zoom 8). */
  onZoom?: (zoom: number) => void;
  className?: string;
};

export type MapAsset = { id: number; kind: string; name: string; operator: string; company: string; ticker: string; cap: number; lon: number; lat: number };

/** GeoJSON as the map takes it (the GeoJSON types come with MapLibre). */
type GeoData = Parameters<GeoJSONSource["setData"]>[0];

const OUR_LAYERS = ["county-fill", "county-line", "pipes", "plant-columns", "plants", "markers-halo", "markers"];

/** Free elevation tiles (AWS Open Data's Terrain Tiles, from USGS 3DEP, SRTM and others), for the 3D view. */
const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const TERRAIN_ATTRIBUTION = '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain Tiles</a> (USGS 3DEP, SRTM and others)';
/** Plants are columns until this zoom, then flat circles again (close in, a column would hide the site). */
const COLUMNS_UNTIL = 10.5;


function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/** Whether the theme is dark, from the luminance of its background colour. */
function isDark(): boolean {
  const bg = cssVar("--bg", "#0a0c0f");
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return true;
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
}

function colourAssets(assets: AssetCollection | null | undefined, parties: MapParty[] | undefined, highlight: EarthMapProps["highlight"], muted: string) {
  const features = (assets?.features ?? []).map((f) => {
    const p = parties?.length ? partyOf(f.properties, parties) : undefined;
    const h = !parties?.length ? highlight?.find((x) => x.ticker && x.ticker === f.properties.ticker) : undefined;
    const color = p?.color ?? h?.color ?? muted;
    const cap = typeof f.properties.attrs.capacityMMcfd === "number" ? f.properties.attrs.capacityMMcfd : 0;
    return { type: "Feature" as const, id: f.id, geometry: f.geometry, properties: { id: f.id, kind: f.properties.kind, name: f.properties.name, operator: f.properties.operator, company: f.properties.company, ticker: f.properties.ticker, color, lit: p || h ? 1 : 0, cap } };
  });
  return { type: "FeatureCollection" as const, features } as GeoData;
}

/** Plants as columns for the 3D view: wider and taller with capacity, in their company or deal colour. */
function plantColumns(coloured: GeoData) {
  const features = ((coloured as { features: { id: number; geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> }[] }).features ?? [])
    .filter((f) => f.properties.kind === "processing_plant" && f.geometry.type === "Point")
    .map((f) => {
      const [lon, lat] = f.geometry.coordinates as [number, number];
      const cap = Number(f.properties.cap) || 0;
      return { type: "Feature" as const, id: f.id, geometry: { type: "Polygon" as const, coordinates: [hexagon(lon, lat, 1200 + 90 * Math.sqrt(cap))] }, properties: f.properties };
    });
  return { type: "FeatureCollection" as const, features } as GeoData;
}

function shadeCounties(counties: AssetCollection | null | undefined, shade: CountyShade | undefined) {
  const features = (counties?.features ?? []).map((f: AssetFeature) => {
    const s = shade?.[String(f.properties.attrs.geoid ?? "")];
    return { type: "Feature" as const, id: f.id, geometry: f.geometry, properties: { name: f.properties.name, flag: s?.flag ?? "", shared: s?.shared ? 1 : 0 } };
  });
  return { type: "FeatureCollection" as const, features } as GeoData;
}

const markerData = (markers: MapMarker[] | undefined) => ({
  type: "FeatureCollection" as const,
  features: (markers ?? []).map((m) => ({ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [m.lon, m.lat] }, properties: { id: m.id, title: m.title, kind: m.kind } })),
}) as GeoData;

/** Whether this browser can draw WebGL (some locked-down machines and old devices cannot). */
function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

function NoMap() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-elevated/40 p-6 text-center text-[12.5px] text-muted">
      This browser cannot draw the map (WebGL is turned off or unavailable). The feed, cards and tables work without it.
    </div>
  );
}

/** Keeps a map failure (a lost graphics context, a bad tile) inside the map instead of taking the page down. */
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <NoMap /> : this.props.children; }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export default function EarthMap(props: EarthMapProps) {
  const [canDraw] = useState(hasWebGL);
  if (!canDraw) return <NoMap />;
  return <MapBoundary><MapCanvas {...props} /></MapBoundary>;
}

function MapCanvas(props: EarthMapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [threeD, setThreeD] = useState(!!props.initial3D);
  const [relief, setRelief] = useState(2);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef(props);
  const view3D = useRef({ on: threeD, relief });
  const onMarker = useRef(props.onMarker);
  const onZoom = useRef(props.onZoom);
  const onAsset = useRef(props.onAsset);
  useEffect(() => { latest.current = props; onMarker.current = props.onMarker; onZoom.current = props.onZoom; onAsset.current = props.onAsset; view3D.current = { on: threeD, relief }; });

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    let m: MLMap;
    try {
      m = new maplibregl.Map({
        container: el.current,
        style: `https://tiles.openfreemap.org/styles/${isDark() ? "dark" : "positron"}`,
        bounds: props.bbox, fitBoundsOptions: { padding: 24 },
        attributionControl: { compact: true },
        // Turning and tilting stay off until 3D is on (sync3D enables them).
        dragRotate: false, pitchWithRotate: true, touchPitch: false, maxPitch: 75,
      });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = m;
    m.on("load", () => {
      const p = latest.current;
      const muted = cssVar("--faint", "#4d5866"), accent = cssVar("--accent", "#f5a623"), neg = cssVar("--neg", "#f85149"), info = cssVar("--info", "#58a6ff"), fg = cssVar("--fg", "#e6edf3");
      m.addSource("counties", { type: "geojson", data: shadeCounties(p.counties, p.shade) });
      const coloured = colourAssets(p.assets, p.parties, p.highlight, muted);
      m.addSource("assets", { type: "geojson", data: coloured });
      m.addSource("columns", { type: "geojson", data: plantColumns(coloured) });
      m.addSource("markers", { type: "geojson", data: markerData(p.markers) });
      m.addLayer({ id: "county-fill", type: "fill", source: "counties", paint: { "fill-color": ["match", ["get", "flag"], "high", neg, "watch", accent, info], "fill-opacity": ["case", ["==", ["get", "flag"], "high"], 0.28, ["==", ["get", "flag"], "watch"], 0.2, ["==", ["get", "shared"], 1], 0.1, 0] } });
      m.addLayer({ id: "county-line", type: "line", source: "counties", paint: { "line-color": muted, "line-width": 0.6, "line-opacity": 0.6 } });
      m.addLayer({ id: "pipes", type: "line", source: "assets", filter: ["==", ["get", "kind"], "pipeline"], layout: { "line-cap": "round", "line-join": "round", "line-sort-key": ["get", "lit"] }, paint: { "line-color": ["get", "color"], "line-width": ["interpolate", ["linear"], ["zoom"], 5, ["case", ["==", ["get", "lit"], 1], 1.4, 0.6], 11, ["case", ["==", ["get", "lit"], 1], 3.2, 1.2]], "line-opacity": ["case", ["==", ["get", "lit"], 1], 0.95, 0.45] } });
      // Height per MMcfd halves with each zoom level in, so a big plant stands out at any distance.
      m.addLayer({ id: "plant-columns", type: "fill-extrusion", source: "columns", maxzoom: COLUMNS_UNTIL, layout: { visibility: "none" }, paint: {
        "fill-extrusion-color": ["get", "color"],
        "fill-extrusion-height": ["interpolate", ["exponential", 2], ["zoom"], 4, ["*", ["max", ["get", "cap"], 8], 160], COLUMNS_UNTIL, ["*", ["max", ["get", "cap"], 8], 1.8]],
        "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.9, "fill-extrusion-vertical-gradient": true,
      } });
      m.addLayer({ id: "plants", type: "circle", source: "assets", filter: ["==", ["get", "kind"], "processing_plant"], layout: { "circle-sort-key": ["get", "lit"] }, paint: { "circle-color": ["get", "color"], "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "cap"]], 0, 3, 30, 11], "circle-stroke-color": fg, "circle-stroke-width": ["case", ["==", ["get", "lit"], 1], 1.2, 0.4], "circle-opacity": ["case", ["==", ["get", "lit"], 1], 0.95, 0.55] } });
      // Findings are rings with a white core, so they never read as a plant.
      m.addLayer({ id: "markers-halo", type: "circle", source: "markers", paint: { "circle-color": accent, "circle-radius": 14, "circle-opacity": 0.18, "circle-blur": 0.5 } });
      m.addLayer({ id: "markers", type: "circle", source: "markers", paint: { "circle-color": "#ffffff", "circle-radius": 4.5, "circle-stroke-color": accent, "circle-stroke-width": 3.5 } });
      ready.current = true;
      syncSatellite(m, p.satellite);
      syncOverlay(m, p.overlay);
      syncSite(m, p.site);
      sync3D(m, view3D.current.on, view3D.current.relief, false);
      m.on("click", "site-structures", (e) => {
        const q = e.features?.[0]?.properties as { kind: string; h: number; d: number; v: number } | undefined;
        if (!q) return;
        const what = q.kind === "tank" ? `Storage tank, ${q.d} m across and ${q.h} m tall: about ${Math.round(q.v).toLocaleString("en-US")} m³ (${Math.round(q.v * 6.2898).toLocaleString("en-US")} barrels) of shell` : q.kind === "tower" ? `Tower or stack, ${q.h} m tall` : `Structure, ${q.h} m tall`;
        popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)">${esc(what)}<br><span style="opacity:.7">From USGS 3DEP lidar</span></div>`).addTo(m);
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: "260px", className: "edge-popup" });
      for (const layer of ["pipes", "plants", "plant-columns", "markers"]) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }
      onZoom.current?.(m.getZoom());
      m.on("zoomend", () => onZoom.current?.(m.getZoom()));
      m.on("click", "markers", (e) => {
        const id = Number(e.features?.[0]?.properties?.id);
        if (Number.isFinite(id)) onMarker.current?.(id);
      });
      m.on("click", (e) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ["plants", "plant-columns", "pipes"] })[0];
        if (!f) return;
        const q = f.properties as { id: number; kind: string; name: string; operator: string; company: string; ticker: string; cap: number };
        const point = f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        onAsset.current?.({ id: Number(q.id), kind: q.kind, name: q.name, operator: q.operator, company: q.company, ticker: q.ticker, cap: Number(q.cap) || 0, lon: point[0], lat: point[1] });
        const owner = q.company && q.company !== q.operator ? `${esc(q.company)}${q.ticker ? ` (${esc(q.ticker)})` : ""}, operated by ${esc(q.operator)}` : `${esc(q.operator || q.company)}${q.ticker ? ` (${esc(q.ticker)})` : ""}`;
        popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)"><b>${esc(q.name || q.operator)}</b><br>${q.kind === "processing_plant" ? `Processing plant${q.cap ? `, ${Math.round(q.cap)} MMcfd` : ""}` : "Gas pipeline"}<br><span style="opacity:.75">${owner}</span></div>`).addTo(m);
      });
    });
    return () => { ready.current = false; m.remove(); map.current = null; };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data changes, one source at a time: new markers (every feed poll) do not re-upload thousands of assets.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    const coloured = colourAssets(props.assets, props.parties, props.highlight, cssVar("--faint", "#4d5866"));
    (m.getSource("assets") as GeoJSONSource | undefined)?.setData(coloured);
    (m.getSource("columns") as GeoJSONSource | undefined)?.setData(plantColumns(coloured));
  }, [props.assets, props.parties, props.highlight]);
  useEffect(() => { const m = map.current; if (m && ready.current) (m.getSource("counties") as GeoJSONSource | undefined)?.setData(shadeCounties(props.counties, props.shade)); }, [props.counties, props.shade]);
  useEffect(() => { const m = map.current; if (m && ready.current) (m.getSource("markers") as GeoJSONSource | undefined)?.setData(markerData(props.markers)); }, [props.markers]);

  useEffect(() => { const m = map.current; if (m && ready.current) syncSatellite(m, props.satellite); }, [props.satellite]);

  useEffect(() => { const m = map.current; if (m && ready.current) sync3D(m, threeD, relief, true); }, [threeD, relief]);

  // Keyed on the image and box, not the object: each feed poll brings a new object for the same overlay, which would redraw it.
  const overlayUrl = props.overlay?.url ?? null, overlayBox = props.overlay?.bbox.join(",") ?? null;
  useEffect(() => { const m = map.current; if (m && ready.current) syncOverlay(m, latest.current.overlay); }, [overlayUrl, overlayBox]);
  useEffect(() => { const m = map.current; if (m && ready.current) syncSite(m, props.site); }, [props.site]);
  useEffect(() => { if (props.want3D) queueMicrotask(() => setThreeD(true)); }, [props.want3D]);

  useEffect(() => { map.current?.fitBounds(props.bbox, { padding: 24, duration: 600 }); }, [props.bbox]);

  useEffect(() => {
    if (props.focus) map.current?.flyTo({ center: [props.focus.lon, props.focus.lat], zoom: props.focus.zoom ?? 12.5, ...(props.focus.pitch !== undefined ? { pitch: props.focus.pitch, bearing: props.focus.pitch ? -25 : 0 } : {}), duration: 1400, essential: true });
  }, [props.focus]);

  if (failed) return <NoMap />;
  return (
    <div className={`relative ${props.className ?? "h-full w-full"}`}>
      {/* MapLibre makes its container position: relative, so it is sized by height and width, not inset. */}
      <div ref={el} className="h-full w-full" />
      {/* Under the zoom and compass buttons, clear of the attribution, which can run to two lines. */}
      <div className="absolute right-2.5 top-[108px] z-10 flex flex-col items-end gap-1">
        <button type="button" onClick={() => setThreeD((v) => !v)} aria-pressed={threeD} title={threeD ? "Back to the flat map" : "Tilt over the terrain, plants as columns by capacity (drag with the right button or two fingers to turn)"}
          className={`glass flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow ${threeD ? "border-accent/60 bg-bg/90 text-accent" : "border-line bg-bg/85 text-muted hover:text-fg"}`}>
          <Box className="h-3.5 w-3.5" /> 3D
        </button>
        {threeD && (
          <div className="glass flex items-center gap-0.5 rounded-full border border-line bg-bg/85 p-0.5 text-[10.5px] shadow" role="radiogroup" aria-label="Relief">
            {[1, 2, 4].map((r) => <button key={r} type="button" role="radio" aria-checked={relief === r} onClick={() => setRelief(r)} title={r === 1 ? "True relief" : `Relief exaggerated ${r} times`} className={`rounded-full px-1.5 py-0.5 ${relief === r ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>×{r}</button>)}
          </div>
        )}
      </div>
    </div>
  );
}

/** Tilt and turn the camera (see ./tilt), at once when not animating. */
function tilt(m: MLMap, pitch: number, bearing: number, animate: boolean) {
  tween(m, pitch, bearing, animate ? 900 : 0);
}

const SITE_COLORS: ExpressionSpecification = ["match", ["get", "kind"], "tank", "#F2A93B", "tower", "#E5534B", "#D7DEE6"];

const corners = (b: Bbox): [[number, number], [number, number], [number, number], [number, number]] => [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]];

/** A ground change's outline, draped on the ground (crisp 10 m pixels). */
function syncOverlay(m: MLMap, o: EarthMapProps["overlay"]) {
  if (m.getLayer("change-overlay")) m.removeLayer("change-overlay");
  if (m.getSource("change-overlay")) m.removeSource("change-overlay");
  if (!o) return;
  m.addSource("change-overlay", { type: "image", url: o.url, coordinates: corners(o.bbox) });
  m.addLayer({ id: "change-overlay", type: "raster", source: "change-overlay", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, below(m, OUR_LAYERS));
}

/** A modelled site: the aerial photograph under everything of ours, the structures as 3D shapes. */
function syncSite(m: MLMap, site: SiteModel | null | undefined) {
  for (const id of ["site-structures", "site-photo"]) { if (m.getLayer(id)) m.removeLayer(id); if (m.getSource(id)) m.removeSource(id); }
  if (!site) return;
  if (site.photo) {
    m.addSource("site-photo", { type: "image", url: site.photo.url, coordinates: corners(site.bbox) });
    m.addLayer({ id: "site-photo", type: "raster", source: "site-photo", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, below(m, ["change-overlay", ...OUR_LAYERS]));
  }
  m.addSource("site-structures", { type: "geojson", data: { type: "FeatureCollection", features: site.structures.map((x, i) => ({ type: "Feature", id: i, geometry: { type: "Polygon", coordinates: [x.ring] }, properties: { kind: x.kind, h: x.heightM, d: x.diameterM ?? 0, v: x.volumeM3 ?? 0 } })) } as GeoData });
  m.addLayer({ id: "site-structures", type: "fill-extrusion", source: "site-structures", minzoom: 11, paint: {
    "fill-extrusion-color": SITE_COLORS, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.95, "fill-extrusion-vertical-gradient": true,
  } }, below(m, ["markers-halo", "markers"]));
}

/** Insert below the first of these layers that exists (so new layers sit under our own). */
const below = (m: MLMap, ids: string[]) => ids.find((id) => m.getLayer(id));

/** Terrain, shaded relief, sky and columns on; or everything back to the flat map. */
function sync3D(m: MLMap, on: boolean, relief: number, animate: boolean) {
  const dark = isDark();
  if (on) {
    const dem = { type: "raster-dem" as const, tiles: [TERRAIN_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium" as const };
    if (!m.getSource("dem")) m.addSource("dem", { ...dem, attribution: TERRAIN_ATTRIBUTION });
    // Shading reads its own copy of the tiles, as MapLibre recommends, so terrain and relief do not contend.
    if (!m.getSource("dem-shade")) m.addSource("dem-shade", dem);
    if (!m.getLayer("hillshade")) {
      m.addLayer({ id: "hillshade", type: "hillshade", source: "dem-shade", paint: {
        "hillshade-exaggeration": 0.6, "hillshade-shadow-color": dark ? "#000000" : "#5b4b33", "hillshade-highlight-color": dark ? "#3e4d60" : "#ffffff", "hillshade-accent-color": dark ? "#0d1218" : "#6d5c41",
      } }, below(m, ["sat", ...OUR_LAYERS]));
    }
    m.setTerrain({ source: "dem", exaggeration: relief });
    m.setSky({ "sky-color": dark ? "#0b1322" : "#a9cdee", "horizon-color": dark ? "#1c2838" : "#e6eef6", "fog-color": dark ? "#0b1322" : "#eef2f6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4, "atmosphere-blend": 0.7 });
    m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable();
    if (m.getLayer("plant-columns")) m.setLayoutProperty("plant-columns", "visibility", "visible");
    if (m.getLayer("plants")) m.setLayerZoomRange("plants", COLUMNS_UNTIL, 24);
    if (m.getPitch() < 20) tilt(m, 58, m.getBearing() || -20, animate);
  } else {
    if (!m.getTerrain() && !m.getLayer("hillshade") && m.getPitch() === 0) return;
    m.setTerrain(null);
    if (m.getLayer("hillshade")) m.removeLayer("hillshade");
    if (m.getLayer("plant-columns")) m.setLayoutProperty("plant-columns", "visibility", "none");
    if (m.getLayer("plants")) m.setLayerZoomRange("plants", 0, 24);
    m.dragRotate.disable(); m.touchZoomRotate.disableRotation(); m.touchPitch.disable();
    tilt(m, 0, 0, animate);
  }
}

function syncSatellite(m: MLMap, sat: Imagery | null | undefined) {
  const has = !!m.getSource("sat");
  if (!sat) {
    if (m.getLayer("sat")) m.removeLayer("sat");
    if (has) m.removeSource("sat");
    return;
  }
  if (has) return;
  m.addSource("sat", { type: "raster", tiles: [sat.tiles], tileSize: 256, minzoom: sat.minzoom, maxzoom: sat.maxzoom, attribution: sat.attribution });
  const before = OUR_LAYERS.find((id) => m.getLayer(id));
  m.addLayer({ id: "sat", type: "raster", source: "sat", paint: { "raster-opacity": 0.95, "raster-fade-duration": 200 } }, before);
}
