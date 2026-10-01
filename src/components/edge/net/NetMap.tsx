"use client";

/**
 * The map-anchored network: companies at their headquarters (located from their EDGAR address), their
 * processing plants from Earth's maps, and the links between located companies drawn as arcs; in 3D
 * the map tilts and each deal, stake or supply link rises as an arc (deck.gl, loaded only then). People
 * and funds have no place, so they stay in the force view. Loaded only when chosen (MapLibre is large).
 */
import maplibregl, { type GeoJSONSource, type IControl, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Box } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MapBoundary } from "../EarthMap";
import { tilt } from "../tilt";
import { LINK_COLOR, LINK_LABEL, NODE_COLOR, type MapData } from "./client";

type GeoData = Parameters<GeoJSONSource["setData"]>[0];

function isDark(): boolean {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
}

/** A gentle arc between two points (a quadratic curve bent sideways), as a line of points. Pure. */
export function arc(a: [number, number], b: [number, number], steps = 24): [number, number][] {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const c: [number, number] = [mx - dy * 0.18, my + dx * 0.18];
  return Array.from({ length: steps + 1 }, (_, i) => { const t = i / steps, u = 1 - t; return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as [number, number]; });
}

/** "#46B3C9" as [70, 179, 201]. Pure. */
export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [136, 136, 136];
}

type Arc3D = { from: [number, number]; to: [number, number]; color: [number, number, number]; label: string };
type Overlay = IControl & { setProps: (p: Record<string, unknown>) => void };

function Canvas({ data, focus }: { data: MapData; focus: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const overlay = useRef<Overlay | null>(null);
  const [ready, setReady] = useState(false);
  const [threeD, setThreeD] = useState(false);
  const [arcError, setArcError] = useState<string | null>(null);

  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({ container: el.current, style: `https://tiles.openfreemap.org/styles/${isDark() ? "dark" : "positron"}`, center: [-98, 35], zoom: 3.2, attributionControl: { compact: true } });
    map.current = m;
    m.on("load", () => setReady(true));
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const located = new Map(data.nodes.filter((n) => typeof n.lon === "number" && typeof n.lat === "number").map((n) => [n.id, n]));
    const points = { type: "FeatureCollection", features: [...located.values()].map((n) => ({ type: "Feature", geometry: { type: "Point", coordinates: [n.lon, n.lat] }, properties: { name: n.ticker || n.name, full: n.name, focus: n.id === focus ? 1 : 0, color: NODE_COLOR[n.kind] ?? "#888" } })) } as GeoData;
    const arcs = { type: "FeatureCollection", features: data.links.filter((l) => located.has(l.s) && located.has(l.d) && l.s !== l.d).map((l) => { const a = located.get(l.s)!, b = located.get(l.d)!; return { type: "Feature", geometry: { type: "LineString", coordinates: arc([a.lon!, a.lat!], [b.lon!, b.lat!]) }, properties: { color: LINK_COLOR[l.kind] ?? "#888", label: l.label } }; }) } as GeoData;
    const plants = { type: "FeatureCollection", features: data.plants.map((p) => ({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { name: p.name, ticker: p.ticker } })) } as GeoData;
    const set = (id: string, d: GeoData) => { const src = m.getSource(id) as GeoJSONSource | undefined; if (src) src.setData(d); else m.addSource(id, { type: "geojson", data: d }); };
    set("net-arcs", arcs); set("net-points", points); set("net-plants", plants);
    if (!m.getLayer("net-arcs")) m.addLayer({ id: "net-arcs", type: "line", source: "net-arcs", paint: { "line-color": ["get", "color"], "line-width": 1.6, "line-opacity": 0.75 } });
    if (!m.getLayer("net-plants")) m.addLayer({ id: "net-plants", type: "circle", source: "net-plants", paint: { "circle-radius": 2.6, "circle-color": "#4FB286", "circle-opacity": 0.8 } });
    if (!m.getLayer("net-points")) {
      m.addLayer({ id: "net-points", type: "circle", source: "net-points", paint: { "circle-radius": ["case", ["==", ["get", "focus"], 1], 9, 6], "circle-color": ["get", "color"], "circle-stroke-width": 1.5, "circle-stroke-color": isDark() ? "#0a0c0f" : "#ffffff" } });
      m.addLayer({ id: "net-labels", type: "symbol", source: "net-points", layout: { "text-field": ["get", "name"], "text-font": ["Noto Sans Regular"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": isDark() ? "#e6e8eb" : "#1d2430", "text-halo-color": isDark() ? "#0a0c0f" : "#ffffff", "text-halo-width": 1.4 } });
      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
      for (const layer of ["net-points", "net-plants", "net-arcs"]) {
        m.on("mousemove", layer, (e) => { m.getCanvas().style.cursor = "pointer"; const q = e.features?.[0]?.properties as { full?: string; name?: string; label?: string; ticker?: string } | undefined; if (q) popup.setLngLat(e.lngLat).setHTML(`<div style="font:12px/1.4 var(--font-sans)">${esc(q.label ?? q.full ?? `${q.name ?? ""}${q.ticker ? ` (${q.ticker} plant)` : ""}`)}</div>`).addTo(m); });
        m.on("mouseleave", layer, () => { m.getCanvas().style.cursor = ""; popup.remove(); });
      }
    }
    const coords = [...located.values()].map((n) => [n.lon!, n.lat!] as [number, number]).concat(data.plants.map((p) => [p.lon, p.lat] as [number, number]));
    if (coords.length) {
      const b = coords.reduce((acc, [x, y]) => [Math.min(acc[0], x), Math.min(acc[1], y), Math.max(acc[2], x), Math.max(acc[3], y)], [180, 90, -180, -90]);
      m.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 7, duration: 600 });
    }
  }, [data, focus, ready]);

  // 3D: tilt the map and raise every located link as an arc; flat again when off.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let live = true;
    if (!threeD) {
      if (overlay.current) { m.removeControl(overlay.current); overlay.current = null; }
      if (m.getLayer("net-arcs")) m.setLayoutProperty("net-arcs", "visibility", "visible");
      if (m.getPitch() > 0) tilt(m, 0, 0);
      return;
    }
    const located = new Map(data.nodes.filter((n) => typeof n.lon === "number" && typeof n.lat === "number").map((n) => [n.id, n]));
    const arcs: Arc3D[] = data.links.filter((l) => located.has(l.s) && located.has(l.d) && l.s !== l.d).map((l) => {
      const a = located.get(l.s)!, b = located.get(l.d)!;
      return { from: [a.lon!, a.lat!], to: [b.lon!, b.lat!], color: rgbOf(LINK_COLOR[l.kind] ?? "#888888"), label: l.label };
    });
    void Promise.all([import("@deck.gl/mapbox"), import("@deck.gl/layers")]).then(([{ MapboxOverlay }, { ArcLayer }]) => {
      if (!live || !map.current) return;
      const layer = new ArcLayer<Arc3D>({
        id: "net-arcs-3d", data: arcs, pickable: true, greatCircle: false, widthUnits: "pixels", getWidth: 2.5, getHeight: 0.55,
        getSourcePosition: (d) => d.from, getTargetPosition: (d) => d.to, getSourceColor: (d) => [...d.color, 230], getTargetColor: (d) => [...d.color, 140],
      });
      if (overlay.current) overlay.current.setProps({ layers: [layer] });
      else {
        // Its own canvas over the map, kept in step with the camera; sharing MapLibre's context stalls its redraws.
        overlay.current = new MapboxOverlay({ interleaved: false, layers: [layer], getTooltip: ({ object }: { object?: Arc3D }) => (object ? { text: object.label } : null) }) as unknown as Overlay;
        map.current.addControl(overlay.current);
      }
      if (map.current.getLayer("net-arcs")) map.current.setLayoutProperty("net-arcs", "visibility", "none");
      const dark = isDark();
      map.current.setSky({ "sky-color": dark ? "#0b1322" : "#a9cdee", "horizon-color": dark ? "#1c2838" : "#e6eef6", "fog-color": dark ? "#0b1322" : "#eef2f6", "sky-horizon-blend": 0.6, "horizon-fog-blend": 0.5, "fog-ground-blend": 0.4, "atmosphere-blend": 0.7 });
      if (map.current.getPitch() < 20) tilt(map.current, 55, -15);
    }).catch(() => { if (live) { setArcError("This browser could not draw the 3D arcs."); setThreeD(false); } });
    return () => { live = false; };
  }, [threeD, ready, data]);

  const kinds = [...new Set(data.links.map((l) => l.kind))];
  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border border-line">
      <div ref={el} className="h-full w-full" />
      <div className="absolute right-2 top-2 z-10 flex flex-col items-end gap-1">
        <button type="button" onClick={() => { setArcError(null); setThreeD((v) => !v); }} aria-pressed={threeD} title={threeD ? "Back to the flat map" : "Tilt the map and raise each link as an arc (drag with the right button to turn)"}
          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow ${threeD ? "border-accent/60 bg-panel/95 text-accent" : "border-line bg-panel/90 text-muted hover:text-fg"}`}>
          <Box className="h-3.5 w-3.5" /> 3D
        </button>
        {arcError && <span className="rounded bg-panel/95 px-2 py-0.5 text-[10.5px] text-neg">{arcError}</span>}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-panel/85 px-2 py-1 text-[10.5px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: NODE_COLOR.company }} />Headquarters</span>
        {data.plants.length > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#4FB286]" />Processing plants</span>}
        {kinds.map((k) => <span key={k} className="flex items-center gap-1"><span className="h-0.5 w-3" style={{ background: LINK_COLOR[k] }} />{LINK_LABEL[k] ?? k}</span>)}
      </div>
    </div>
  );
}

export default function NetMap(props: { data: MapData; focus: number }) {
  return <MapBoundary><Canvas {...props} /></MapBoundary>;
}
