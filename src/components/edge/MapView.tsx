"use client";

/**
 * The region on a map: every mapped gas pipeline and processing plant, the companies this person
 * watches in colour, findings as markers (click one to see its card), and a recent satellite layer. In
 * 3D: the terrain, buildings and plants lit by the sun, this week's flares burning on their stacks, and
 * for any plant or finding a digital twin (./map3d/SiteTwin.tsx) with lidar, AI scene analyses and
 * imagery draped on the ground.
 */
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { EdgeCardView } from "./Cards";
import { useApi, type AssetCollection, type Bbox, type EdgeCard, type EdgeState, type FeedData, type FlaringVisual, type GroundVisual, type Imagery, type RadarVisual } from "./client";
import type { MapApi, MapAsset, MapMarker } from "./EarthMap";
import type { FlareSpot } from "./map3d/scene";
import { EMPTY_VIEW, SiteTwin, targetKey, type TwinTarget, type TwinView } from "./map3d/SiteTwin";
import { DrillingNearby, PlanetScenes } from "./SitePanels";
import { TerrainPanel } from "./Terrain";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <MapLoading /> });

export function MapLoading() {
  return <div className="flex h-full w-full items-center justify-center bg-elevated/40 text-[12px] text-muted"><Icon name="Loader" className="mr-2 h-4 w-4 animate-spin" /> Loading the map</div>;
}

/** Findings drawn as markers: the ones tied to a place on the ground. */
const MAPPED = new Set(["ground_change", "flaring", "radar_change", "permits", "methane_plume"]);

/** Distinct colours for watched companies (Okabe-Ito, then two extras). */
export const WATCH_COLORS = ["#E69F00", "#56B4E9", "#009E73", "#CC79A7", "#D55E00", "#F0E442", "#0072B2"];

export function centreOf(card: EdgeCard): { lon: number; lat: number } | null {
  const site = (card.visual as { site?: { lon: number; lat: number } }).site;
  if (site) return { lon: site.lon, lat: site.lat };
  if (card.bbox) return { lon: (card.bbox[0] + card.bbox[2]) / 2, lat: (card.bbox[1] + card.bbox[3]) / 2 };
  return null;
}

/** A finding as the place a digital twin is built for. */
function cardTarget(card: EdgeCard): TwinTarget | null {
  const at = centreOf(card);
  if (!at) return null;
  const v = card.visual as { bbox?: Bbox; overlay?: string };
  return { detection: card.id, name: card.title, ...at, bbox: v.bbox ?? card.bbox, heat: card.kind === "ground_change" && typeof v.overlay === "string" };
}

export function MapView({ state, focus, onOpenDeal }: { state: EdgeState; focus: { card: EdgeCard; key: number; threeD?: boolean } | null; onOpenDeal: (c: EdgeCard) => void }) {
  const region = state.covered[0];
  const assets = useApi<AssetCollection>(`/api/edge/assets?place=${region.key}`);
  const feed = useApi<FeedData>("/api/edge/feed?scope=all", 120_000);
  const [satOn, setSatOn] = useState(!!focus);
  const sat = useApi<Imagery>(satOn ? `/api/edge/imagery?place=${region.key}` : null);
  const [picked, setPicked] = useState<number | null>(focus?.card.id ?? null);
  const [asset, setAsset] = useState<MapAsset | null>(null);
  const [zoom, setZoom] = useState(0);
  const [view, setView] = useState<TwinView>(EMPTY_VIEW);
  const [mapApi, setMapApi] = useState<MapApi | null>(null);
  const [jump, setJump] = useState<{ lon: number; lat: number; zoom: number; pitch: number; bearing?: number; key: number } | null>(null);
  const onFly = useCallback((f: { lon: number; lat: number; zoom: number; pitch: number; bearing: number }) => setJump({ ...f, key: Date.now() }), []);

  const highlight = useMemo(() => state.watches.filter((w) => w.kind === "company" && w.target.ticker).map((w, i) => ({ ticker: w.target.ticker!, label: w.label, color: WATCH_COLORS[i % WATCH_COLORS.length] })), [state.watches]);
  const cards = useMemo(() => {
    const all = [...(feed.data?.cards ?? [])];
    if (focus && !all.some((c) => c.id === focus.card.id)) all.unshift(focus.card);
    return all;
  }, [feed.data, focus]);
  const markers: MapMarker[] = useMemo(() => cards.flatMap((c) => { const p = centreOf(c); return p && MAPPED.has(c.kind) ? [{ id: c.id, lon: p.lon, lat: p.lat, title: c.title, kind: c.kind }] : []; }), [cards]);
  // This week's flaring findings burn on their plants in 3D.
  const flares: FlareSpot[] = useMemo(() => cards.flatMap((c) => {
    if (c.kind !== "flaring") return [];
    const v = c.visual as FlaringVisual;
    return v.site ? [{ id: c.id, lon: v.site.lon, lat: v.site.lat, frpMw: v.stats?.frpTotal ?? 0, days: v.stats?.days ?? 0, title: c.title }] : [];
  }), [cards]);
  const fly = useMemo(() => { const p = focus ? centreOf(focus.card) : null; return p ? { ...p, zoom: focus!.threeD ? 13.6 : 13.2, ...(focus!.threeD ? { pitch: 62 } : {}), key: focus!.key } : null; }, [focus]);
  const card = cards.find((c) => c.id === picked) ?? null;
  // Ground and radar changes draw what changed over the map, on the box they compared.
  const overlay = useMemo(() => { const v = card?.kind === "ground_change" || card?.kind === "radar_change" ? (card.visual as GroundVisual | RadarVisual) : null; return v?.overlay && v.bbox ? { url: v.overlay, bbox: v.bbox as Bbox } : null; }, [card]);
  const scene3d = useMemo(() => ({ ...view.scene, flares }), [view.scene, flares]);
  const twin = view.scene.twin ?? null;

  // The place the side panel's twin is for: the picked plant, the picked finding, or the open twin's own.
  const assetTarget = useMemo<TwinTarget | null>(() => (asset ? { asset: asset.id, name: asset.name || asset.operator || "The site", lon: asset.lon, lat: asset.lat } : null), [asset]);
  const findingTarget = useMemo(() => (card ? cardTarget(card) : null), [card]);
  // Opened with "See it in 3D" on a ground change: its twin opens straight away.
  const autoOpenKey = focus?.threeD && focus.card.kind === "ground_change" ? `d${focus.card.id}` : "";
  useEffect(() => { if (focus?.threeD) queueMicrotask(() => setPicked(focus.card.id)); }, [focus]);

  const twinPanel = (t: TwinTarget) => <SiteTwin key={targetKey(t)} target={t} view={view} setView={setView} api={mapApi} onFly={onFly} autoOpen={!!autoOpenKey && targetKey(t) === autoOpenKey} />;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="panel relative h-[64vh] min-h-[420px] overflow-hidden max-md:h-[58dvh] max-md:min-h-[340px]">
        <EarthMap bbox={region.bbox} assets={assets.data} highlight={highlight} markers={markers} satellite={satOn ? sat.data : null} focus={jump ?? fly} initial3D={!!focus?.threeD}
          site={twin?.site ?? null} overlay={overlay} scene3d={scene3d} drape={view.drape} planet={view.planet} onApi={setMapApi}
          onMarker={(id) => { setPicked(id); setAsset(null); }} onAsset={(a) => { setAsset(a); setPicked(null); }} onZoom={setZoom} />
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-col gap-1.5">
          <div className="pointer-events-auto flex flex-wrap gap-1">
            <button type="button" onClick={() => setSatOn((v) => !v)} aria-pressed={satOn} className={`glass flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] shadow ${satOn ? "border-accent/60 bg-bg/90 text-accent" : "border-line bg-bg/80 text-muted hover:text-fg"}`}>
              <Icon name={sat.loading && satOn ? "Loader" : "Satellite"} className={`h-3.5 w-3.5 ${sat.loading && satOn ? "animate-spin" : ""}`} /> Satellite{satOn && sat.data ? `, ${sat.data.from} to ${sat.data.to}` : ""}
            </button>
            {satOn && sat.data && zoom > 0 && zoom < sat.data.minzoom && <span className="glass rounded-full border border-line bg-bg/80 px-2.5 py-1 text-[11px] text-muted shadow">Zoom in to see the imagery</span>}
          </div>
          <div className="glass pointer-events-auto rounded-lg border border-line bg-bg/80 px-2.5 py-2 text-[11px] shadow">
            <div className="mb-1 flex items-center gap-1 font-semibold text-muted"><Icon name="Layers" className="h-3 w-3" /> {region.name}</div>
            {highlight.map((h) => <div key={h.ticker} className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: h.color }} />{h.label}</div>)}
            <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-3 rounded-sm bg-faint" />Other operators</div>
            <div className="flex items-center gap-1.5 text-muted"><span className="h-2.5 w-2.5 rounded-full border-[3px] border-accent bg-white" />A finding</div>
            {flares.length > 0 && <div className="flex items-center gap-1.5 text-muted"><Icon name="Flame" className="h-3 w-3 text-[#F28C28]" />Flaring this week (in 3D)</div>}
            {assets.loading && <div className="mt-1 flex items-center gap-1 text-faint"><Icon name="Loader" className="h-3 w-3 animate-spin" /> Loading assets</div>}
          </div>
        </div>
        {sat.error && satOn && <div className="absolute bottom-8 left-2 rounded bg-bg/90 px-2 py-1 text-[11px] text-neg">Satellite layer unavailable: {sat.error}</div>}
        {twin && (
          <div className="glass absolute bottom-8 left-2 max-w-[min(420px,80%)] rounded-lg border border-line bg-bg/90 px-2.5 py-2 text-[11px] shadow">
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold">Digital twin: {twin.name}</span>
              <button type="button" onClick={() => setView(EMPTY_VIEW)} aria-label="Remove the digital twin" className="ml-auto text-muted hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
            </div>
            <p className="mt-0.5 leading-snug text-muted">{[twin.site?.photo ? `Aerial photo: USDA NAIP, ${twin.site.photo.date}` : "", twin.site?.lidar ? `heights: USGS 3DEP lidar, ${twin.site.lidar.year}` : "", "© OpenStreetMap contributors"].filter(Boolean).join("; ")}.</p>
          </div>
        )}
      </div>
      {/* Below the side-by-side width, what you picked on the map rises as a sheet over the map's lower part. */}
      <aside className={`min-w-0 ${asset || card ? "max-lg:fixed max-lg:overscroll-contain max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-[70] max-lg:max-h-[62dvh] max-lg:overflow-y-auto max-lg:rounded-t-[14px] max-lg:border max-lg:border-b-0 max-lg:border-line-strong max-lg:bg-panel max-lg:px-3 max-lg:pb-[calc(12px+var(--safe-b))] max-lg:pt-1 max-lg:shadow-[0_-12px_40px_rgba(0,0,0,.35)] max-lg:[&_button:has(svg.lucide-x)]:min-h-10" : ""}`}>
        {(asset || card) && <div className="mx-auto mb-1 mt-1 lg:hidden"><span className="sheet-handle mx-auto block" aria-hidden /></div>}
        {asset && !card ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{asset.kind === "pipeline" ? "Pipeline" : "Processing plant"}</span>
              <button type="button" onClick={() => setAsset(null)} className="flex items-center gap-1 rounded px-1 hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /> Close</button>
            </div>
            <div className="panel p-3">
              <h3 className="text-[13.5px] font-semibold">{asset.name || asset.operator}</h3>
              <p className="text-[11.5px] text-muted">{[asset.company && asset.company !== asset.operator ? `${asset.company}${asset.ticker ? ` (${asset.ticker})` : ""}, operated by ${asset.operator}` : `${asset.operator || asset.company}${asset.ticker ? ` (${asset.ticker})` : ""}`, asset.kind === "processing_plant" && asset.cap ? `${Math.round(asset.cap)} MMcfd` : ""].filter(Boolean).join(" · ")}</p>
              {asset.kind !== "pipeline" && assetTarget && <div className="mt-2">{twinPanel(assetTarget)}</div>}
              <div className="mt-2"><TerrainPanel key={asset.id} asset={asset.id} /></div>
              {asset.kind !== "pipeline" && <div className="mt-2 space-y-2"><DrillingNearby key={`d${asset.id}`} asset={asset.id} /><PlanetScenes key={`p${asset.id}`} asset={asset.id} /></div>}
            </div>
          </div>
        ) : card ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>Selected finding</span>
              <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 rounded px-1 hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /> Close</button>
            </div>
            {findingTarget && MAPPED.has(card.kind) && twinPanel(findingTarget)}
            <EdgeCardView card={card} index={0} onOpenDeal={onOpenDeal} />
          </div>
        ) : view.target && twin ? (
          twinPanel(view.target)
        ) : (
          <div className="panel p-4 text-[12.5px] text-muted">
            <h3 className="text-[13px] font-semibold text-fg">The {region.name}, mapped</h3>
            <p className="mt-1.5 leading-relaxed">{assets.data ? `${assets.data.features.filter((f) => f.properties.kind === "pipeline").length.toLocaleString()} pipeline segments and ${assets.data.features.filter((f) => f.properties.kind === "processing_plant").length} processing plants` : "Pipelines and processing plants"} from EIA maps, each matched to its listed parent where one is known. Click a pipeline or plant for its operator; click a marker to see what changed there.</p>
            <p className="mt-2 leading-relaxed">Turn on Satellite and zoom in to see the ground itself: the clearest Sentinel-2 pixels of the last six weeks, 10 m across.</p>
            <p className="mt-2 leading-relaxed">Turn on 3D to tilt the map over the terrain, with buildings at their heights, each plant a column by its capacity and this week&apos;s flares burning on their stacks. The sun button lights it for any hour; the globe shows the whole Earth. Drag with the right button (two fingers on a phone) to turn it. Click a pipeline for its elevation profile, or a plant for the ground around it, read from USGS lidar where it has been flown.</p>
            <p className="mt-2 leading-relaxed">Pick a plant or a finding and open its digital twin: tanks and stacks at their measured sizes, pipelines, the aerial photo, and with a plan the lidar point cloud and AI scene analyses in 3D.</p>
            {markers.length > 0 && <p className="mt-2 text-accent">{markers.length} {markers.length === 1 ? "finding" : "findings"} on the map.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
