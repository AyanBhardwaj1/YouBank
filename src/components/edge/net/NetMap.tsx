"use client";

/**
 * The map-anchored network: companies at their headquarters (located from their EDGAR address), their
 * processing plants from Earth's maps, and the links between located companies drawn as arcs. People
 * and funds have no place, so they stay in the force view. Loaded only when chosen (MapLibre is large).
 */
import maplibregl, { type GeoJSONSource, type Map as MLMap } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { MapBoundary } from "../EarthMap";
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

function Canvas({ data, focus }: { data: MapData; focus: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);

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
      m.addLayer({ id: "net-labels", type: "symbol", source: "net-points", layout: { "text-field": ["get", "name"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top" }, paint: { "text-color": isDark() ? "#e6e8eb" : "#1d2430", "text-halo-color": isDark() ? "#0a0c0f" : "#ffffff", "text-halo-width": 1.4 } });
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

  const kinds = [...new Set(data.links.map((l) => l.kind))];
  return (
    <div className="relative h-[520px] w-full overflow-hidden rounded-lg border border-line">
      <div ref={el} className="absolute inset-0" />
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
