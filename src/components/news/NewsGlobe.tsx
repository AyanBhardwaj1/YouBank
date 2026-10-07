"use client";

/**
 * Where the news is happening, on a globe. MapLibre's globe projection (the map stack Edge already
 * uses) with a style of our own: no map tiles at all, just the oceans, the land (Natural Earth, in
 * public/news/land.json) and a graticule in the theme's tokens, so it loads fast, draws the same in
 * every style, light or dark, and re-tints when the theme changes.
 *
 * Each place is a marker sized by the significance of its stories (importance, raised by breadth of
 * coverage), coloured by its main sector, with a pulse on the busiest; filtered to a desk's tags in
 * the browser. Clicking (or Enter on the list) opens the place's stories; a story opens in the reader.
 * The globe turns slowly until touched, only with rich motion and never under reduced motion.
 * Loaded on demand (next/dynamic) and only once it is on screen: MapLibre is large.
 */
import maplibregl, { type GeoJSONSource, type Map as MLMap, type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion } from "motion/react";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { filterPoints, markerRadius, significance, type GlobePoint, type GlobeStory } from "@/lib/news/geo";
import { Icon } from "@/components/ui/Icon";
import { ago, useMotionLevel } from "./client";
import { SECTOR_HUE } from "./DataArt";

export type GlobeProps = {
  points: GlobePoint[];
  /** Desk filter: only places and stories with these tags; null for everything. */
  tags: string[] | null;
  now: number;
  onOpen: (id: number) => void;
  height?: number | string;
  /** A compact teaser: no side list, no controls beyond zoom. */
  compact?: boolean;
};

const cssVar = (name: string, fallback: string) => (typeof window === "undefined" ? fallback : getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback);

/** Theme colours as the map needs them (MapLibre takes plain colours, not CSS variables). */
function palette() {
  return {
    bg: cssVar("--bg", "#0a0c0f"), panel: cssVar("--panel", "#101318"), elevated: cssVar("--elevated", "#171b22"), raised: cssVar("--raised", "#1e232c"),
    line: cssVar("--line", "#242a33"), lineStrong: cssVar("--line-strong", "#323a46"), muted: cssVar("--muted", "#7d8794"), accent: cssVar("--accent", "#f5a623"), fg: cssVar("--fg", "#d7dde6"),
  };
}

const isDark = (hex: string) => {
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
};

/** Lines every 30 degrees, for a sense of the sphere. */
function graticule() {
  const features: GeoJSON.Feature[] = [];
  for (let lon = -180; lon < 180; lon += 30) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 33 }, (_, i) => [lon, -80 + i * 5]) } });
  for (let lat = -60; lat <= 60; lat += 30) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: Array.from({ length: 73 }, (_, i) => [-180 + i * 5, lat]) } });
  return { type: "FeatureCollection" as const, features };
}

function styleFor(c: ReturnType<typeof palette>): StyleSpecification {
  const dark = isDark(c.bg);
  return {
    version: 8,
    projection: { type: "globe" },
    sky: { "sky-color": c.bg, "horizon-color": c.raised, "fog-color": c.bg, "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, dark ? 0.85 : 0.6, 5, 0.3, 7, 0] },
    sources: {
      land: { type: "geojson", data: "/news/land.json" },
      grid: { type: "geojson", data: graticule() },
      places: { type: "geojson", data: { type: "FeatureCollection", features: [] } },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": dark ? c.panel : c.elevated } },
      { id: "grid", type: "line", source: "grid", paint: { "line-color": c.line, "line-width": 0.6, "line-opacity": 0.7 } },
      { id: "land", type: "fill", source: "land", paint: { "fill-color": dark ? c.raised : c.bg, "fill-opacity": 1 } },
      { id: "coast", type: "line", source: "land", paint: { "line-color": c.lineStrong, "line-width": 0.7 } },
      { id: "pulse", type: "circle", source: "places", filter: ["==", ["get", "rank"], 0], paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-opacity": 0, "circle-pitch-alignment": "viewport" } },
      { id: "pulse-2", type: "circle", source: "places", filter: ["<", ["get", "rank"], 4], paint: { "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-opacity": 0, "circle-pitch-alignment": "viewport" } },
      { id: "dots", type: "circle", source: "places", paint: {
        "circle-radius": ["get", "r"], "circle-color": ["get", "color"], "circle-opacity": ["case", ["==", ["get", "inferred"], 1], 0.35, 0.55],
        "circle-stroke-color": ["get", "color"], "circle-stroke-width": ["case", ["boolean", ["feature-state", "hover"], false], 2.5, 1.25], "circle-pitch-alignment": "viewport",
      } },
      { id: "cores", type: "circle", source: "places", paint: { "circle-radius": 2.2, "circle-color": c.fg, "circle-opacity": 0.9, "circle-pitch-alignment": "viewport" } },
    ],
  };
}

/** The colour a place wears: the sector most of its stories carry, else the accent. */
function colorOf(p: GlobePoint, accent: string): string {
  const n = new Map<string, number>();
  for (const s of p.stories) for (const t of s.tags) if (t in SECTOR_HUE) n.set(t, (n.get(t) ?? 0) + significance(s.importance, s.sourceCount));
  const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return top ? SECTOR_HUE[top] : accent;
}

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

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

export default function NewsGlobe(props: GlobeProps) {
  const [canDraw] = useState(() => typeof window !== "undefined" && hasWebGL());
  const shown = useMemo(() => filterPoints(props.points, props.tags), [props.points, props.tags]);
  const list = <PlaceList points={shown} now={props.now} onOpen={props.onOpen} />;
  if (!canDraw) return <div className="rounded-[var(--nr-radius)] border border-line p-4"><p className="mb-3 text-[12px] text-muted">This browser cannot draw the globe (WebGL is off or unavailable). Here are the same places as a list.</p>{list}</div>;
  return <Boundary fallback={list}><Globe {...props} shown={shown} /></Boundary>;
}

function Globe({ shown, now, onOpen, height = 520, compact = false }: GlobeProps & { shown: GlobePoint[] }) {
  const level = useMotionLevel();
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<MLMap | null>(null);
  const [ready, setReady] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [hover, setHover] = useState<{ id: string; x: number; y: number; w: number } | null>(null);
  const touched = useRef(false);
  const latest = useRef(shown);
  useEffect(() => { latest.current = shown; });

  // Create the map once.
  useEffect(() => {
    if (!el.current) return;
    const m = new maplibregl.Map({
      container: el.current, style: styleFor(palette()), center: [-30, 28], zoom: compact ? 1.15 : 1.75, minZoom: 0.6, maxZoom: 6,
      attributionControl: { compact: true, customAttribution: "Land: Natural Earth" }, renderWorldCopies: false, dragRotate: true, pitchWithRotate: false,
    });
    map.current = m;
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    if (compact) m.scrollZoom.disable();
    const stop = () => { touched.current = true; };
    m.on("mousedown", stop); m.on("touchstart", stop); m.on("wheel", stop);
    m.on("load", () => setReady(true));
    let hoverId: string | number | undefined;
    m.on("mousemove", "dots", (e) => {
      const f = e.features?.[0];
      m.getCanvas().style.cursor = f ? "pointer" : "";
      if (hoverId !== undefined) m.setFeatureState({ source: "places", id: hoverId }, { hover: false });
      hoverId = f?.id;
      if (hoverId !== undefined) m.setFeatureState({ source: "places", id: hoverId }, { hover: true });
      if (f) setHover({ id: String(f.properties?.pid), x: e.point.x, y: e.point.y, w: m.getCanvas().clientWidth });
    });
    m.on("mouseleave", "dots", () => {
      m.getCanvas().style.cursor = "";
      if (hoverId !== undefined) m.setFeatureState({ source: "places", id: hoverId }, { hover: false });
      hoverId = undefined;
      setHover(null);
    });
    m.on("click", "dots", (e) => {
      const pid = e.features?.[0]?.properties?.pid;
      if (pid) { touched.current = true; setPicked(String(pid)); }
    });
    // Re-tint when the person changes theme.
    const obs = new MutationObserver(() => {
      const c = palette(), dark = isDark(c.bg);
      if (!m.isStyleLoaded()) return;
      m.setPaintProperty("ocean", "background-color", dark ? c.panel : c.elevated);
      m.setPaintProperty("land", "fill-color", dark ? c.raised : c.bg);
      m.setPaintProperty("coast", "line-color", c.lineStrong);
      m.setPaintProperty("grid", "line-color", c.line);
      m.setPaintProperty("cores", "circle-color", c.fg);
      m.setSky({ "sky-color": c.bg, "horizon-color": c.raised, "fog-color": c.bg });
    });
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
    return () => { obs.disconnect(); m.remove(); map.current = null; };
  }, [compact]);

  // Places: sized against the heaviest on screen, coloured by sector, the busiest ranked for the pulse.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    const accent = palette().accent;
    const max = Math.max(...shown.map((p) => p.weight), 1e-6);
    (m.getSource("places") as GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: shown.map((p, i) => ({ type: "Feature", id: i + 1, geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { pid: p.id, r: markerRadius(p.weight, max) * (compact ? 0.8 : 1), color: colorOf(p, accent), rank: i, inferred: p.inferred ? 1 : 0 } })),
    });
  }, [shown, ready, compact]);

  // The pulse and the slow turn: one animation frame loop, rich motion only.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready || level !== "rich") return;
    let raf = 0, last = performance.now();
    const loop = (t: number) => {
      const k = (t % 2400) / 2400, k2 = ((t + 1200) % 2400) / 2400;
      m.setPaintProperty("pulse", "circle-radius", ["*", ["get", "r"], 1 + k * 1.8]);
      m.setPaintProperty("pulse", "circle-opacity", 0.35 * (1 - k));
      m.setPaintProperty("pulse-2", "circle-radius", ["*", ["get", "r"], 1 + k2 * 1.4]);
      m.setPaintProperty("pulse-2", "circle-opacity", 0.22 * (1 - k2));
      if (!touched.current && !m.isMoving()) {
        const c = m.getCenter();
        m.setCenter([((c.lng + ((t - last) / 1000) * 3 + 540) % 360) - 180, c.lat]);
      }
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, level]);

  const fly = (p: GlobePoint) => { touched.current = true; setPicked(p.id); map.current?.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.current.getZoom(), 2.2), duration: level === "off" ? 0 : 1200 }); };
  const pick = shown.find((p) => p.id === picked) ?? null;
  const hov = hover ? shown.find((p) => p.id === hover.id) : null;

  return (
    <div className={compact ? "" : "grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"}>
      <div className="relative min-w-0 overflow-hidden rounded-[var(--nr-radius)] border border-line" style={{ height }}>
        {/* MapLibre makes its container position: relative, so the map gets a sized child of a positioned box. */}
        <div className="absolute inset-0"><div ref={el} className="h-full w-full" aria-label={`Globe of ${shown.length} places in the news`} role="application" /></div>
        {!ready && <div className="shimmer absolute inset-0" />}
        {hov && hover && !pick && (
          <div className="pointer-events-none absolute z-10 w-[240px] -translate-x-1/2 rounded-[var(--radius)] border border-line-strong bg-raised/95 p-2 text-[11.5px] shadow-float backdrop-blur" style={{ left: Math.min(Math.max(hover.x, 130), hover.w - 130), top: hover.y + 16 }}>
            <div className="flex items-baseline justify-between gap-2"><span className="font-semibold text-fg">{hov.name}</span><span className="num text-muted">{hov.stories.length} {hov.stories.length === 1 ? "story" : "stories"}</span></div>
            <p className="mt-0.5 line-clamp-2 text-muted">{hov.stories[0]?.headline}</p>
          </div>
        )}
        <AnimatePresence>
          {pick && (
            <motion.div key={pick.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: level === "off" ? 0 : 0.2 }}
              className="absolute inset-x-2 bottom-2 z-20 max-h-[62%] overflow-y-auto rounded-[var(--radius)] border border-line-strong bg-raised/95 p-3 shadow-float backdrop-blur sm:inset-x-auto sm:left-3 sm:w-[340px]">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-fg">{pick.name}{pick.inferred && <span className="ml-1.5 text-[10.5px] font-normal text-muted">US-listed companies</span>}</span>
                <button type="button" onClick={() => setPicked(null)} className="text-muted hover:text-fg" aria-label="Close"><Icon name="X" className="h-4 w-4" /></button>
              </div>
              <StoryList stories={pick.stories} now={now} onOpen={onOpen} />
            </motion.div>
          )}
        </AnimatePresence>
        <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-bg/75 px-2 py-0.5 text-[10.5px] text-muted backdrop-blur-sm"><span className="num text-fg">{shown.length}</span> places · last 48 hours</div>
      </div>
      {!compact && <PlaceList points={shown} now={now} onOpen={onOpen} onPick={fly} picked={picked} />}
    </div>
  );
}

function StoryList({ stories, now, onOpen }: { stories: GlobeStory[]; now: number; onOpen: (id: number) => void }) {
  return (
    <ul className="space-y-1.5">
      {stories.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => onOpen(s.id)} className="group block w-full text-left">
            <span className="block text-[12px] leading-snug text-fg group-hover:text-accent">{s.headline}</span>
            <span className="text-[10.5px] text-muted">{now ? ago(s.updatedAt, now) : ""}{s.sourceCount > 1 ? ` · ${s.sourceCount} outlets` : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function PlaceList({ points, now, onOpen, onPick, picked }: { points: GlobePoint[]; now: number; onOpen: (id: number) => void; onPick?: (p: GlobePoint) => void; picked?: string | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(...points.map((p) => p.weight), 1e-6);
  if (!points.length) return <p className="text-[12px] text-muted">No places in this desk&apos;s news in the last two days.</p>;
  return (
    <div className="min-w-0">
      <div className="nr-kicker mb-2 flex items-center gap-1.5"><Icon name="Map" className="h-3.5 w-3.5" />Most active</div>
      <ol className="max-h-[480px] space-y-1 overflow-y-auto pr-1">
        {points.slice(0, 24).map((p, i) => {
          const on = (picked ?? open) === p.id;
          return (
            <li key={p.id}>
              <button type="button" onClick={() => { if (onPick) onPick(p); setOpen(on ? null : p.id); }} className="group grid w-full grid-cols-[18px_1fr_auto] items-center gap-2 rounded-md px-1 py-1 text-left text-[12px] hover:bg-elevated" aria-expanded={on}>
                <span className="num text-faint">{i + 1}</span>
                <span className="min-w-0">
                  <span className="block truncate text-fg group-hover:text-accent">{p.name}{p.inferred && <span className="text-muted"> · listed cos.</span>}</span>
                  <span className="mt-0.5 block h-1 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent/70" style={{ width: `${(p.weight / max) * 100}%` }} /></span>
                </span>
                <span className="num text-muted">{p.stories.length}</span>
              </button>
              {on && !onPick && <div className="mb-2 ml-6 mt-1"><StoryList stories={p.stories} now={now} onOpen={onOpen} /></div>}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
