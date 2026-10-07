"use client";

/**
 * Edge's map: a free vector basemap (OpenFreeMap, OpenStreetMap data) in the theme's light or dark,
 * an optional recent satellite layer (Sentinel-2), counties shaded by what a deal does to them, gas
 * pipelines and processing plants coloured by company or deal side, and markers for findings.
 *
 * In 3D the map tilts over the terrain (AWS Terrain Tiles, relief exaggerated to taste) with shaded
 * relief, OpenStreetMap's buildings stand at their heights, plants stand as columns by capacity until
 * you zoom in close, and the sun lights it all for any hour of the day (sky included). The globe shows
 * the whole Earth with its atmosphere. A digital twin, a lidar point cloud, flares and scene analyses
 * come from the layer registry (./map3d/layers.ts), drawn by deck.gl inside MapLibre's own WebGL2
 * context and loaded only when one of them has something to draw.
 *
 * Small screens and modest devices start in a lighter 2.5D mode: tilt and buildings without the
 * terrain until it is asked for, fewer pixels, a smaller tile cache. Loaded only when a map is on
 * screen (MapLibre is large).
 */
import maplibregl, { type ExpressionSpecification, type GeoJSONSource, type Map as MLMap, type Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import { atSolarHour, solarHour, sunPosition, type Sun } from "@/lib/edge/geo3d/sun";
import { heightAt } from "@/lib/edge/geo3d/heights";
import type { SiteModel } from "@/lib/edge/site3d";
import { hexagon } from "@/lib/edge/terrain-view";
import { tilt as tween } from "./tilt";
import { partyOf, type AssetCollection, type AssetFeature, type Bbox, type Imagery } from "./client";
import { addCryptoSitesLayer } from "@/lib/crypto/map-layer"; // Crypto layer (owned by the crypto work)
import { Controls } from "./map3d/Controls";
import { animates, buildLayers, layerDef, MAP_LAYERS, type LayerContext } from "./map3d/layers";
import { applySun, below, corners, OUR_LAYERS, setGlobe as setProjection, settleOnGround, skySpec, syncAreas, syncBuildings, syncCredits, syncDrape, syncPlanet } from "./map3d/maplibre";
import { createOverlay, hasWebGL2, lighting, loadDeck, type Loaded, type Overlay } from "./map3d/overlay";
import type { Map3DScene } from "./map3d/scene";

export type MapParty = { key: string; label: string; color: string; tickers: string[]; companies: string[] };
export type MapMarker = { id: number; lon: number; lat: number; title: string; kind: string };
export type CountyShade = Record<string, { flag: "high" | "watch" | ""; shared: boolean }>;

/** What a page can do with the map once it is drawn (record it, turn it). */
export type MapApi = { canvas: () => HTMLCanvasElement; setOrbit: (on: boolean) => void };

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
  focus?: { lon: number; lat: number; zoom?: number; pitch?: number; bearing?: number; key: number } | null;
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
  /** The 3D layers from the registry: a digital twin, a point cloud, flares, a scene analysis. */
  scene3d?: Map3DScene;
  /** An image draped on the terrain over a box (a time-lapse frame). */
  drape?: { url: string; bbox: Bbox } | null;
  /** A Planet scene draped over a box (through YouBank's tile proxy). */
  planet?: { type: string; id: string; bbox: Bbox } | null;
  onApi?: (api: MapApi | null) => void;
  /** Told the zoom level as it changes (the satellite layer shows from zoom 8). */
  onZoom?: (zoom: number) => void;
  className?: string;
};

export type MapAsset = { id: number; kind: string; name: string; operator: string; company: string; ticker: string; cap: number; lon: number; lat: number };

/** GeoJSON as the map takes it (the GeoJSON types come with MapLibre). */
type GeoData = Parameters<GeoJSONSource["setData"]>[0];

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

/**
 * Whether to start light: a phone-sized screen, or a device that reports little memory. Everything
 * still works; the terrain waits to be asked for and the map draws fewer pixels.
 */
function deviceLite(): boolean {
  if (typeof window === "undefined") return false;
  const small = window.matchMedia?.("(max-width: 640px)").matches ?? false;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return small || (mem !== undefined && mem <= 4);
}

/** Credits for the imagery, lidar and analyses on the map now (the basemap and terrain sources credit themselves). */
function creditsFor(p: EarthMapProps): string {
  const s = p.scene3d ?? {};
  const out: string[] = [];
  if (p.site?.photo) out.push("Aerial photo: USDA NAIP");
  if (p.site?.lidar || s.twin?.lidar || s.cloud?.passes.length) out.push("Lidar: USGS 3DEP");
  if (s.twin) out.push("Twin: © OpenStreetMap contributors, AWS Terrain Tiles");
  const kind = s.analysis?.kind;
  if (kind === "landuse") out.push("Land use: © Impact Observatory, Microsoft and Esri (CC BY 4.0)");
  if (kind === "ai-change") out.push("AlphaEarth Foundations embeddings: Google DeepMind (CC BY 4.0)");
  if (kind === "heat" || kind === "cube" || p.drape) out.push("Contains modified Copernicus Sentinel data");
  if (s.flares?.length || s.twin?.flames.length) out.push("Flares: NASA FIRMS (VIIRS)");
  return out.join(" · ");
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

type DeckState = "off" | "loading" | "on" | "unsupported" | "failed";
const EMPTY_SCENE: Map3DScene = {};

function MapCanvas(props: EarthMapProps) {
  const el = useRef<HTMLDivElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [lite] = useState(deviceLite);
  const [dark] = useState(isDark);
  const reduceMotion = useReducedMotion() ?? false;
  const [threeD, setThreeD] = useState(!!props.initial3D);
  const [relief, setRelief] = useState(lite ? 0 : 2);
  const [globe, setGlobe] = useState(false);
  const [sunOpen, setSunOpen] = useState(false);
  const [sunAt, setSunAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [centre, setCentre] = useState<[number, number]>(() => [(props.bbox[0] + props.bbox[2]) / 2, (props.bbox[1] + props.bbox[3]) / 2]);
  const [orbiting, setOrbiting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [deckState, setDeckState] = useState<DeckState>("off");
  const [zoomQ, setZoomQ] = useState(0);
  const [groundKey, setGroundKey] = useState(0);
  const map = useRef<MLMap | null>(null);
  const popup = useRef<Popup | null>(null);
  const latest = useRef(props);
  const view3D = useRef({ on: threeD, relief });
  const onMarker = useRef(props.onMarker);
  const onZoom = useRef(props.onZoom);
  const onAsset = useRef(props.onAsset);
  const deck = useRef<{ loaded: Loaded; overlay: Overlay } | null>(null);
  const time = useRef(0);
  const scene = props.scene3d ?? EMPTY_SCENE;
  const sceneRef = useRef(scene);
  const groundRef = useRef(groundKey);
  useEffect(() => { latest.current = props; onMarker.current = props.onMarker; onZoom.current = props.onZoom; onAsset.current = props.onAsset; view3D.current = { on: threeD, relief }; sceneRef.current = scene; groundRef.current = groundKey; });

  const sunTime = sunAt ?? now;
  const sun: Sun = sunPosition(sunTime, centre[1], centre[0]);
  const terrainRelief = threeD ? relief : 0;

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
        dragRotate: false, pitchWithRotate: true, touchPitch: false, maxPitch: 78,
        // Lighter on phones and modest devices: fewer pixels, fewer tiles kept, no fades.
        pixelRatio: Math.min(window.devicePixelRatio || 1, deviceLite() ? 1.5 : 2),
        ...(deviceLite() ? { maxTileCacheSize: 80, fadeDuration: 0 } : {}),
      });
    } catch {
      queueMicrotask(() => setFailed(true));
      return;
    }
    m.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.current = m;
    popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: "280px", className: "edge-popup" });
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
      // Crypto layer: Bitcoin mining sites and crypto data centres, self-contained with its own button and popups (src/lib/crypto/map-layer.ts).
      addCryptoSitesLayer(m, { beforeId: "markers-halo" });
      syncSatellite(m, p.satellite);
      syncOverlay(m, p.overlay);
      syncSite(m, p.site, false);
      sync3D(m, view3D.current.on, view3D.current.relief, false, sunPosition(Date.now(), m.getCenter().lat, m.getCenter().lng), isDark());
      m.on("click", "site-structures", (e) => {
        const q = e.features?.[0]?.properties as { kind: string; h: number; d: number; v: number } | undefined;
        if (!q) return;
        const what = q.kind === "tank" ? `Storage tank, ${q.d} m across and ${q.h} m tall: about ${Math.round(q.v).toLocaleString("en-US")} m³ (${Math.round(q.v * 6.2898).toLocaleString("en-US")} barrels) of shell` : q.kind === "tower" ? `Tower or stack, ${q.h} m tall` : `Structure, ${q.h} m tall`;
        popup.current?.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)">${esc(what)}<br><span style="opacity:.7">From USGS 3DEP lidar</span></div>`).addTo(m);
      });
      m.on("click", "twin-areas-line", (e) => {
        const q = e.features?.[0]?.properties as { kind: string; name: string; h: number; operator: string; estimated: number } | undefined;
        if (!q) return;
        const what = q.kind === "datacenter" ? `Data centre${q.name ? `: ${q.name}` : ""}${q.operator ? ` (${q.operator})` : ""}, ${q.h} m tall${q.estimated ? " (estimated)" : ""}` : q.kind === "mine" ? `Mine or quarry${q.name ? `: ${q.name}` : ""}; the terrain shows its pit` : `Works${q.name ? `: ${q.name}` : ""}`;
        popup.current?.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)">${esc(what)}<br><span style="opacity:.7">© OpenStreetMap contributors</span></div>`).addTo(m);
      });
      for (const layer of ["pipes", "plants", "plant-columns", "markers"]) {
        m.on("mouseenter", layer, () => { m.getCanvas().style.cursor = "pointer"; });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; });
      }
      onZoom.current?.(m.getZoom());
      setZoomQ(Math.round(m.getZoom() * 4) / 4);
      m.on("zoomend", () => { onZoom.current?.(m.getZoom()); setZoomQ(Math.round(m.getZoom() * 4) / 4); });
      m.on("moveend", () => { const c = m.getCenter(); setCentre((old) => (Math.abs(old[0] - c.lng) + Math.abs(old[1] - c.lat) > 0.5 ? [c.lng, c.lat] : old)); });
      // Terrain that arrives after a model was placed moves it onto the ground (at most once a second).
      let lastIdle = 0;
      m.on("idle", () => { if (m.getTerrain() && Date.now() - lastIdle > 1000) { lastIdle = Date.now(); setGroundKey((k) => k + 1); } });
      m.on("click", "markers", (e) => {
        const id = Number(e.features?.[0]?.properties?.id);
        if (Number.isFinite(id)) onMarker.current?.(id);
      });
      m.on("click", (e) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ["plants", "plant-columns", "pipes"].filter((id) => m.getLayer(id)) })[0];
        if (!f) return;
        const q = f.properties as { id: number; kind: string; name: string; operator: string; company: string; ticker: string; cap: number };
        const point = f.geometry.type === "Point" ? (f.geometry.coordinates as [number, number]) : [e.lngLat.lng, e.lngLat.lat];
        onAsset.current?.({ id: Number(q.id), kind: q.kind, name: q.name, operator: q.operator, company: q.company, ticker: q.ticker, cap: Number(q.cap) || 0, lon: point[0], lat: point[1] });
        const owner = q.company && q.company !== q.operator ? `${esc(q.company)}${q.ticker ? ` (${esc(q.ticker)})` : ""}, operated by ${esc(q.operator)}` : `${esc(q.operator || q.company)}${q.ticker ? ` (${esc(q.ticker)})` : ""}`;
        popup.current?.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)"><b>${esc(q.name || q.operator)}</b><br>${q.kind === "processing_plant" ? `Processing plant${q.cap ? `, ${Math.round(q.cap)} MMcfd` : ""}` : "Gas pipeline"}<br><span style="opacity:.75">${owner}</span></div>`).addTo(m);
      });
      setLoaded(true);
    });
    return () => { setLoaded(false); deck.current?.overlay.finalize(); deck.current = null; m.remove(); map.current = null; };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Data changes, one source at a time: new markers (every feed poll) do not re-upload thousands of assets.
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    const coloured = colourAssets(props.assets, props.parties, props.highlight, cssVar("--faint", "#4d5866"));
    (m.getSource("assets") as GeoJSONSource | undefined)?.setData(coloured);
    (m.getSource("columns") as GeoJSONSource | undefined)?.setData(plantColumns(coloured));
  }, [props.assets, props.parties, props.highlight, loaded]);
  useEffect(() => { const m = map.current; if (m && loaded) (m.getSource("counties") as GeoJSONSource | undefined)?.setData(shadeCounties(props.counties, props.shade)); }, [props.counties, props.shade, loaded]);
  useEffect(() => { const m = map.current; if (m && loaded) (m.getSource("markers") as GeoJSONSource | undefined)?.setData(markerData(props.markers)); }, [props.markers, loaded]);

  useEffect(() => { const m = map.current; if (m && loaded) syncSatellite(m, props.satellite); }, [props.satellite, loaded]);

  // The live sun moves on every five minutes while nobody has picked an hour.
  useEffect(() => {
    if (sunAt !== null) return;
    const t = setInterval(() => setNow(Date.now()), 300_000);
    return () => clearInterval(t);
  }, [sunAt]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    sync3D(m, threeD, relief, true, sunPosition(sunTime, centre[1], centre[0]), dark);
    if (threeD && relief > 0) settleOnGround(m);
  }, [threeD, relief, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const m = map.current; if (m && loaded) applySun(m, sunPosition(sunTime, centre[1], centre[0]), dark, threeD); }, [sunTime, centre, threeD, loaded, dark]);
  useEffect(() => { const m = map.current; if (m && loaded) { setProjection(m, globe); if (globe) m.setSky(skySpec(sunPosition(sunTime, centre[1], centre[0]), dark)); } }, [globe, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keyed on the image and box, not the object: each feed poll brings a new object for the same overlay, which would redraw it.
  const overlayUrl = props.overlay?.url ?? null, overlayBox = props.overlay?.bbox.join(",") ?? null;
  useEffect(() => { const m = map.current; if (m && loaded) syncOverlay(m, latest.current.overlay); }, [overlayUrl, overlayBox, loaded]);
  const credits = creditsFor(props);
  useEffect(() => { const m = map.current; if (m && loaded) syncCredits(m, credits); }, [credits, loaded]);
  const drapeUrl = props.drape?.url ?? null;
  useEffect(() => { const m = map.current; if (m && loaded) syncDrape(m, latest.current.drape); }, [drapeUrl, loaded]);
  const planetKey = props.planet ? `${props.planet.type}/${props.planet.id}` : null;
  useEffect(() => { const m = map.current; if (m && loaded) syncPlanet(m, latest.current.planet); }, [planetKey, loaded]);

  // A digital twin opens flat-projected, tilted, at true relief (unless the terrain is off), with its areas drawn.
  const twin = scene.twin ?? null;
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    syncAreas(m, twin?.areas ?? null);
    if (!twin) return;
    queueMicrotask(() => { setGlobe(false); setThreeD(true); setRelief((r) => (r === 0 ? 0 : 1)); });
  }, [twin, loaded]);
  // With deck.gl drawing tanks and towers as models, the lidar extrusions keep only the other structures.
  const modelsByDeck = deckState === "on" && !!twin;
  useEffect(() => { const m = map.current; if (m && loaded) syncSite(m, props.site, modelsByDeck); }, [props.site, modelsByDeck, loaded]);
  useEffect(() => { if (props.want3D) queueMicrotask(() => setThreeD(true)); }, [props.want3D]);

  useEffect(() => { map.current?.fitBounds(props.bbox, { padding: 24, duration: 600 }); }, [props.bbox]);

  // Flights wait for the map (and its terrain) to load: a camera placed for flat ground and then given
  // terrain would look at the wrong spot. The ground height is fixed for the flight and taken up again
  // when it lands (freezeElevation), so terrain that loads after landing still lifts the camera; without
  // it MapLibre keeps the height it guessed at take-off, under the hills if their tiles were not in yet.
  useEffect(() => {
    const f = props.focus, m = map.current;
    if (!f || !loaded || !m) return;
    m.flyTo({ center: [f.lon, f.lat], zoom: f.zoom ?? 12.5, ...(f.pitch !== undefined ? { pitch: f.pitch, bearing: f.bearing ?? (f.pitch ? -25 : 0) } : {}), curve: 1.5, speed: 1.1, maxDuration: 3200, essential: true, freezeElevation: true });
  }, [props.focus, loaded]);

  // Orbit: turn slowly about the centre until stopped or the person touches the map.
  useEffect(() => {
    const m = map.current;
    if (!m || !orbiting) return;
    let raf = 0, last = performance.now();
    const stop = () => setOrbiting(false);
    const step = (t: number) => { m.setBearing(m.getBearing() + Math.min(64, t - last) * 0.009); last = t; raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    m.on("mousedown", stop); m.on("touchstart", stop); m.on("wheel", stop);
    return () => { cancelAnimationFrame(raf); m.off("mousedown", stop); m.off("touchstart", stop); m.off("wheel", stop); };
  }, [orbiting]);

  useEffect(() => {
    if (!loaded) return;
    latest.current.onApi?.({ canvas: () => map.current!.getCanvas(), setOrbit: (on) => setOrbiting(on && !reduceMotion) });
    return () => latest.current.onApi?.(null);
  }, [loaded, reduceMotion]);

  /* ---------------- deck.gl: the registry's layers ---------------- */

  const wantDeck = loaded && threeD && !globe && MAP_LAYERS.some((d) => d.has(scene));

  /** The registry's layers for the scene as it is now, at an animation time. */
  const layersNow = (mods: Loaded["mods"], t: number) => {
    const m = map.current!;
    const s = sceneRef.current;
    const r = view3D.current.on ? view3D.current.relief : 0;
    const ctx: LayerContext = {
      mods, scene: s, time: t, zoom: m.getZoom(), relief: r, lite, groundKey: groundRef.current,
      ground: (lon, lat) => {
        if (r <= 0) return 0;
        const tw = s.twin;
        if (tw && lon >= tw.bbox[0] && lon <= tw.bbox[2] && lat >= tw.bbox[1] && lat <= tw.bbox[3]) return heightAt(tw.ground, lon, lat) * r;
        return m.queryTerrainElevation([lon, lat]) ?? 0;
      },
    };
    return buildLayers(ctx);
  };

  // Load deck.gl and put the overlay on the map when a layer has something to draw; take it off when none has.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!wantDeck) {
      if (deck.current) { deck.current.overlay.finalize(); deck.current = null; queueMicrotask(() => setDeckState("off")); }
      return;
    }
    if (deck.current) return;
    if (!hasWebGL2(m)) { queueMicrotask(() => setDeckState("unsupported")); return; }
    let live = true;
    queueMicrotask(() => setDeckState("loading"));
    loadDeck().then((loaded) => {
      if (!live || !map.current || deck.current) return;
      const onClick = (info: { object?: unknown; layer?: { id: string } | null; coordinate?: number[] }) => {
        if (!info.object || !info.layer || !info.coordinate) return;
        const text = layerDef(info.layer.id)?.describe?.(info.object, sceneRef.current);
        if (text) popup.current?.setLngLat([info.coordinate[0], info.coordinate[1]]).setHTML(`<div style="font:12px/1.4 var(--font-sans)">${esc(text)}</div>`).addTo(map.current!);
      };
      const overlay = createOverlay(map.current, loaded, { layers: layersNow(loaded.mods, time.current), effects: [lighting(loaded.mods, sunTime, sun)], onClick });
      deck.current = { loaded, overlay };
      setDeckState("on");
    }).catch(() => { if (live) setDeckState("failed"); });
    return () => { live = false; };
  }, [wantDeck]); // eslint-disable-line react-hooks/exhaustive-deps

  // Redraw the layers when the scene, the relief, the zoom, the terrain or the sun change.
  useEffect(() => {
    const d = deck.current;
    if (!d || deckState !== "on") return;
    d.overlay.setProps({ layers: layersNow(d.loaded.mods, time.current), effects: [lighting(d.loaded.mods, sunTime, sun)] });
  }, [deckState, scene, terrainRelief, zoomQ, groundKey, sunTime, centre]); // eslint-disable-line react-hooks/exhaustive-deps

  // Animate flames while any are on screen (still, for people who ask for less motion).
  const animating = deckState === "on" && !reduceMotion && animates(scene);
  useEffect(() => {
    if (!animating) return;
    let raf = 0, last = 0;
    const frameMs = lite ? 80 : 40;
    const step = (t: number) => {
      raf = requestAnimationFrame(step);
      if (t - last < frameMs || document.hidden) return;
      last = t; time.current = t;
      const d = deck.current;
      if (d) d.overlay.setProps({ layers: layersNow(d.loaded.mods, t) });
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [animating, lite]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <NoMap />;
  const hour = solarHour(sunTime, centre[0]);
  return (
    <div className={`relative ${props.className ?? "h-full w-full"}`}>
      {/* MapLibre makes its container position: relative, so it is sized by height and width, not inset. */}
      <div ref={el} className="h-full w-full" />
      {/* Under the zoom and compass buttons, clear of the attribution, which can run to two lines. */}
      <Controls
        threeD={threeD} onThreeD={() => { setThreeD((v) => !v); setSunOpen(false); setOrbiting(false); }}
        relief={relief} reliefOptions={lite ? [0, 1, 2, 4] : [1, 2, 4]} onRelief={setRelief}
        globe={globe} onGlobe={() => {
          const m = map.current;
          const next = !globe;
          setGlobe(next);
          if (!m) return;
          if (next) m.easeTo({ zoom: Math.min(m.getZoom(), 2.6), pitch: 0, bearing: 0, duration: 1600, freezeElevation: true });
          else m.fitBounds(props.bbox, { padding: 24, duration: 1200, freezeElevation: true });
        }}
        sunOpen={sunOpen} onSunOpen={() => setSunOpen((v) => !v)} sun={sun} hour={hour} live={sunAt === null}
        onHour={(h) => setSunAt(h === null ? null : atSolarHour(Date.now(), centre[0], h))}
        orbiting={orbiting} canOrbit={!reduceMotion} onOrbit={() => setOrbiting((v) => !v)}
        lite={lite}
      />
      {deckState === "unsupported" && wantDeck && <div className="glass absolute bottom-8 right-2 max-w-[70%] rounded-md border border-line bg-bg/90 px-2 py-1 text-[10.5px] text-muted shadow">This browser draws the map without WebGL2, so 3D models and point clouds are off. Buildings and terrain still work.</div>}
      {deckState === "failed" && wantDeck && <div className="glass absolute bottom-8 right-2 max-w-[70%] rounded-md border border-line bg-bg/90 px-2 py-1 text-[10.5px] text-neg shadow">The 3D models did not load. Reload the page to try again.</div>}
    </div>
  );
}

/** Tilt and turn the camera (see ./tilt), at once when not animating. */
function tilt(m: MLMap, pitch: number, bearing: number, animate: boolean) {
  tween(m, pitch, bearing, animate ? 900 : 0);
}

const SITE_COLORS: ExpressionSpecification = ["match", ["get", "kind"], "tank", "#F2A93B", "tower", "#E5534B", "#D7DEE6"];

/** A ground change's outline, draped on the ground (crisp 10 m pixels). */
function syncOverlay(m: MLMap, o: EarthMapProps["overlay"]) {
  if (m.getLayer("change-overlay")) m.removeLayer("change-overlay");
  if (m.getSource("change-overlay")) m.removeSource("change-overlay");
  if (!o) return;
  m.addSource("change-overlay", { type: "image", url: o.url, coordinates: corners(o.bbox) });
  m.addLayer({ id: "change-overlay", type: "raster", source: "change-overlay", paint: { "raster-opacity": 0.85, "raster-fade-duration": 0, "raster-resampling": "nearest" } }, below(m, OUR_LAYERS));
}

/**
 * A modelled site: the aerial photograph under everything of ours, the structures as 3D shapes. When
 * deck.gl draws the tanks and towers as models (`modelsByDeck`), only the other structures are extruded here.
 */
function syncSite(m: MLMap, site: SiteModel | null | undefined, modelsByDeck: boolean) {
  for (const id of ["site-structures", "site-photo"]) { if (m.getLayer(id)) m.removeLayer(id); if (m.getSource(id)) m.removeSource(id); }
  if (!site) return;
  if (site.photo) {
    m.addSource("site-photo", { type: "image", url: site.photo.url, coordinates: corners(site.bbox) });
    m.addLayer({ id: "site-photo", type: "raster", source: "site-photo", paint: { "raster-opacity": 1, "raster-fade-duration": 0 } }, below(m, ["drape", "change-overlay", ...OUR_LAYERS]));
  }
  const shown = site.structures.filter((x) => !modelsByDeck || x.kind === "structure");
  m.addSource("site-structures", { type: "geojson", data: { type: "FeatureCollection", features: shown.map((x, i) => ({ type: "Feature", id: i, geometry: { type: "Polygon", coordinates: [x.ring] }, properties: { kind: x.kind, h: x.heightM, d: x.diameterM ?? 0, v: x.volumeM3 ?? 0 } })) } as GeoData });
  m.addLayer({ id: "site-structures", type: "fill-extrusion", source: "site-structures", minzoom: 11, paint: {
    "fill-extrusion-color": SITE_COLORS, "fill-extrusion-height": ["get", "h"], "fill-extrusion-base": 0, "fill-extrusion-opacity": 0.95, "fill-extrusion-vertical-gradient": true,
  } }, below(m, ["markers-halo", "markers"]));
}

/**
 * Terrain (unless the relief is 0, the light 2.5D mode), sun-lit shaded relief, sky, buildings and
 * columns on; or everything back to the flat map.
 */
function sync3D(m: MLMap, on: boolean, relief: number, animate: boolean, sun: Sun, dark: boolean) {
  if (on) {
    if (relief > 0) {
      const dem = { type: "raster-dem" as const, tiles: [TERRAIN_TILES], tileSize: 256, maxzoom: 15, encoding: "terrarium" as const };
      if (!m.getSource("dem")) m.addSource("dem", { ...dem, attribution: TERRAIN_ATTRIBUTION });
      // Shading reads its own copy of the tiles, as MapLibre recommends, so terrain and relief do not contend.
      if (!m.getSource("dem-shade")) m.addSource("dem-shade", dem);
      if (!m.getLayer("hillshade")) {
        m.addLayer({ id: "hillshade", type: "hillshade", source: "dem-shade", paint: {
          "hillshade-method": "basic", "hillshade-illumination-anchor": "map",
          "hillshade-shadow-color": dark ? "#000000" : "#5b4b33", "hillshade-highlight-color": dark ? "#3e4d60" : "#ffffff", "hillshade-accent-color": dark ? "#0d1218" : "#6d5c41",
        } }, below(m, ["sat", "planet", "site-photo", "drape", ...OUR_LAYERS]));
      }
      m.setTerrain({ source: "dem", exaggeration: relief });
    } else {
      m.setTerrain(null);
      if (m.getLayer("hillshade")) m.removeLayer("hillshade");
    }
    m.dragRotate.enable(); m.touchZoomRotate.enableRotation(); m.touchPitch.enable();
    if (m.getLayer("plant-columns")) m.setLayoutProperty("plant-columns", "visibility", "visible");
    if (m.getLayer("plants")) m.setLayerZoomRange("plants", COLUMNS_UNTIL, 24);
    syncBuildings(m, true, dark);
    applySun(m, sun, dark, true);
    // A flight under way sets its own pitch; tilting now would stop it short.
    if (m.getPitch() < 20 && !m.isMoving()) tilt(m, 58, m.getBearing() || -20, animate);
  } else {
    syncBuildings(m, false, dark);
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
