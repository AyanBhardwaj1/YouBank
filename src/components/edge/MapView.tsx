"use client";

/**
 * The region on a map: every mapped gas pipeline and processing plant, the companies this person
 * watches in colour, findings as markers (click one to see its card), and a recent satellite layer.
 */
import dynamic from "next/dynamic";
import { Box, Layers, Loader2, Satellite, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteModel } from "@/lib/edge/site3d";
import { EdgeCardView } from "./Cards";
import { api, useApi, type AssetCollection, type Bbox, type EdgeCard, type EdgeState, type FeedData, type GroundVisual, type Imagery, type RadarVisual } from "./client";
import type { MapAsset, MapMarker } from "./EarthMap";
import { DrillingNearby, PlanetScenes } from "./SitePanels";
import { TerrainPanel } from "./Terrain";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <MapLoading /> });

export function MapLoading() {
  return <div className="flex h-full w-full items-center justify-center bg-elevated/40 text-[12px] text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the map</div>;
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

/** Builds the 3D model of a site, saying what it is doing. */
function SiteButton({ state, query, onModel }: { state: { model: SiteModel | null; busy: boolean; key: string }; query: string; onModel: () => void }) {
  const mine = state.key === query;
  return (
    <button type="button" disabled={state.busy} onClick={onModel} className="ctl flex w-full items-center justify-center gap-1.5 border border-accent/50 bg-accent-soft/40 px-2.5 py-1.5 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:opacity-60">
      {state.busy && mine ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Box className="h-3.5 w-3.5" />}
      {state.busy && mine ? "Reading lidar and the aerial photograph…" : state.model && mine ? "Shown in 3D on the map" : "Model this site in 3D (lidar and aerial photo)"}
    </button>
  );
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
  const [site, setSite] = useState<{ model: SiteModel | null; busy: boolean; error: string | null; key: string }>({ model: null, busy: false, error: null, key: "" });
  const [want3D, setWant3D] = useState(0);
  const [jump, setJump] = useState<{ lon: number; lat: number; zoom: number; pitch: number; key: number } | null>(null);

  // A site in 3D: the newest aerial photograph and what lidar sees standing there, flown to and tilted.
  const modelSite = (query: string, at: { lon: number; lat: number }) => {
    setSite({ model: null, busy: true, error: null, key: query });
    api<SiteModel>(`/api/edge/site3d?${query}`)
      .then((model) => { setSite({ model, busy: false, error: null, key: query }); setWant3D(Date.now()); setJump({ ...at, zoom: 15.4, pitch: 62, key: Date.now() }); })
      .catch((e) => setSite({ model: null, busy: false, error: e instanceof Error ? e.message : String(e), key: query }));
  };
  // Opened with "See it in 3D": model that site straight away.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !focus?.threeD || focus.card.kind !== "ground_change") return;
    opened.current = true;
    const at = centreOf(focus.card);
    if (at) queueMicrotask(() => modelSite(`detection=${focus.card.id}`, at));
  }, [focus]);

  const highlight = useMemo(() => state.watches.filter((w) => w.kind === "company" && w.target.ticker).map((w, i) => ({ ticker: w.target.ticker!, label: w.label, color: WATCH_COLORS[i % WATCH_COLORS.length] })), [state.watches]);
  const cards = useMemo(() => {
    const all = [...(feed.data?.cards ?? [])];
    if (focus && !all.some((c) => c.id === focus.card.id)) all.unshift(focus.card);
    return all;
  }, [feed.data, focus]);
  const markers: MapMarker[] = useMemo(() => cards.flatMap((c) => { const p = centreOf(c); return p && MAPPED.has(c.kind) ? [{ id: c.id, lon: p.lon, lat: p.lat, title: c.title, kind: c.kind }] : []; }), [cards]);
  const fly = useMemo(() => { const p = focus ? centreOf(focus.card) : null; return p ? { ...p, zoom: focus!.threeD ? 13.6 : 13.2, ...(focus!.threeD ? { pitch: 62 } : {}), key: focus!.key } : null; }, [focus]);
  const card = cards.find((c) => c.id === picked) ?? null;
  // Ground and radar changes draw what changed over the map, on the box they compared.
  const overlay = useMemo(() => { const v = card?.kind === "ground_change" || card?.kind === "radar_change" ? (card.visual as GroundVisual | RadarVisual) : null; return v?.overlay && v.bbox ? { url: v.overlay, bbox: v.bbox as Bbox } : null; }, [card]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="panel relative h-[64vh] min-h-[420px] overflow-hidden max-md:h-[58dvh] max-md:min-h-[340px]">
        <EarthMap bbox={region.bbox} assets={assets.data} highlight={highlight} markers={markers} satellite={satOn ? sat.data : null} focus={jump ?? fly} initial3D={!!focus?.threeD} want3D={want3D} site={site.model} overlay={overlay}
          onMarker={(id) => { setPicked(id); setAsset(null); }} onAsset={(a) => { setAsset(a); setPicked(null); }} onZoom={setZoom} />
        <div className="pointer-events-none absolute left-2 top-2 flex max-w-[70%] flex-col gap-1.5">
          <div className="pointer-events-auto flex flex-wrap gap-1">
            <button type="button" onClick={() => setSatOn((v) => !v)} aria-pressed={satOn} className={`glass flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] shadow ${satOn ? "border-accent/60 bg-bg/90 text-accent" : "border-line bg-bg/80 text-muted hover:text-fg"}`}>
              {sat.loading && satOn ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Satellite className="h-3.5 w-3.5" />} Satellite{satOn && sat.data ? `, ${sat.data.from} to ${sat.data.to}` : ""}
            </button>
            {satOn && sat.data && zoom > 0 && zoom < sat.data.minzoom && <span className="glass rounded-full border border-line bg-bg/80 px-2.5 py-1 text-[11px] text-muted shadow">Zoom in to see the imagery</span>}
          </div>
          <div className="glass pointer-events-auto rounded-lg border border-line bg-bg/80 px-2.5 py-2 text-[11px] shadow">
            <div className="mb-1 flex items-center gap-1 font-semibold text-muted"><Layers className="h-3 w-3" /> {region.name}</div>
            {highlight.map((h) => <div key={h.ticker} className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: h.color }} />{h.label}</div>)}
            <div className="flex items-center gap-1.5 text-muted"><span className="h-2 w-3 rounded-sm bg-faint" />Other operators</div>
            <div className="flex items-center gap-1.5 text-muted"><span className="h-2.5 w-2.5 rounded-full border-[3px] border-accent bg-white" />A finding</div>
            {assets.loading && <div className="mt-1 flex items-center gap-1 text-faint"><Loader2 className="h-3 w-3 animate-spin" /> Loading assets</div>}
          </div>
        </div>
        {sat.error && satOn && <div className="absolute bottom-8 left-2 rounded bg-bg/90 px-2 py-1 text-[11px] text-neg">Satellite layer unavailable: {sat.error}</div>}
        {site.model && (
          <div className="glass absolute bottom-8 left-2 max-w-[min(420px,80%)] rounded-lg border border-line bg-bg/90 px-2.5 py-2 text-[11px] shadow">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Site in 3D</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#F2A93B]" />{site.model.counts.tanks} tank{site.model.counts.tanks === 1 ? "" : "s"}{site.model.tankBarrels ? ` (about ${Math.round(site.model.tankBarrels / 1000).toLocaleString("en-US")}k barrels of shell)` : ""}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#E5534B]" />{site.model.counts.towers} tower{site.model.counts.towers === 1 ? "" : "s"}</span>
              <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-[#D7DEE6]" />{site.model.counts.structures} other</span>
              <button type="button" onClick={() => setSite({ model: null, busy: false, error: null, key: "" })} aria-label="Remove the site model" className="ml-auto text-muted hover:text-fg"><X className="h-3.5 w-3.5" /></button>
            </div>
            <p className="mt-1 leading-snug text-muted">{[site.model.photo ? `Aerial photo: USDA NAIP, ${site.model.photo.date}` : "", site.model.lidar ? `heights: USGS 3DEP lidar, ${site.model.lidar.year}` : ""].filter(Boolean).join("; ")}. {site.model.notes[0]}</p>
          </div>
        )}
        {site.error && <div className="absolute bottom-8 left-2 rounded bg-bg/90 px-2 py-1 text-[11px] text-neg">{site.error}</div>}
      </div>
      {/* Below the side-by-side width, what you picked on the map rises as a sheet over the map's lower part. */}
      <aside className={`min-w-0 ${asset || card ? "max-lg:fixed max-lg:overscroll-contain max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-[70] max-lg:max-h-[62dvh] max-lg:overflow-y-auto max-lg:rounded-t-[14px] max-lg:border max-lg:border-b-0 max-lg:border-line-strong max-lg:bg-panel max-lg:px-3 max-lg:pb-[calc(12px+var(--safe-b))] max-lg:pt-1 max-lg:shadow-[0_-12px_40px_rgba(0,0,0,.35)] max-lg:[&_button:has(svg.lucide-x)]:min-h-10" : ""}`}>
        {(asset || card) && <div className="mx-auto mb-1 mt-1 lg:hidden"><span className="sheet-handle mx-auto block" aria-hidden /></div>}
        {asset && !card ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted">
              <span>{asset.kind === "pipeline" ? "Pipeline" : "Processing plant"}</span>
              <button type="button" onClick={() => setAsset(null)} className="flex items-center gap-1 rounded px-1 hover:text-fg"><X className="h-3.5 w-3.5" /> Close</button>
            </div>
            <div className="panel p-3">
              <h3 className="text-[13.5px] font-semibold">{asset.name || asset.operator}</h3>
              <p className="text-[11.5px] text-muted">{[asset.company && asset.company !== asset.operator ? `${asset.company}${asset.ticker ? ` (${asset.ticker})` : ""}, operated by ${asset.operator}` : `${asset.operator || asset.company}${asset.ticker ? ` (${asset.ticker})` : ""}`, asset.kind === "processing_plant" && asset.cap ? `${Math.round(asset.cap)} MMcfd` : ""].filter(Boolean).join(" · ")}</p>
              {asset.kind !== "pipeline" && <div className="mt-2"><SiteButton state={site} query={`asset=${asset.id}`} onModel={() => modelSite(`asset=${asset.id}`, { lon: asset.lon, lat: asset.lat })} /></div>}
              <div className="mt-2"><TerrainPanel key={asset.id} asset={asset.id} /></div>
              {asset.kind !== "pipeline" && <div className="mt-2 space-y-2"><DrillingNearby key={`d${asset.id}`} asset={asset.id} /><PlanetScenes key={`p${asset.id}`} asset={asset.id} /></div>}
            </div>
          </div>
        ) : card ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
              <span>Selected finding</span>
              <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 rounded px-1 hover:text-fg"><X className="h-3.5 w-3.5" /> Close</button>
            </div>
            {card.kind === "ground_change" && centreOf(card) && <div className="mb-2"><SiteButton state={site} query={`detection=${card.id}`} onModel={() => modelSite(`detection=${card.id}`, centreOf(card)!)} /></div>}
            <EdgeCardView card={card} index={0} onOpenDeal={onOpenDeal} />
          </div>
        ) : (
          <div className="panel p-4 text-[12.5px] text-muted">
            <h3 className="text-[13px] font-semibold text-fg">The {region.name}, mapped</h3>
            <p className="mt-1.5 leading-relaxed">{assets.data ? `${assets.data.features.filter((f) => f.properties.kind === "pipeline").length.toLocaleString()} pipeline segments and ${assets.data.features.filter((f) => f.properties.kind === "processing_plant").length} processing plants` : "Pipelines and processing plants"} from EIA maps, each matched to its listed parent where one is known. Click a pipeline or plant for its operator; click a marker to see what changed there.</p>
            <p className="mt-2 leading-relaxed">Turn on Satellite and zoom in to see the ground itself: the clearest Sentinel-2 pixels of the last six weeks, 10 m across.</p>
            <p className="mt-2 leading-relaxed">Turn on 3D to tilt the map over the terrain, with each plant a column by its capacity; drag with the right button (two fingers on a phone) to turn it. Click a pipeline for its elevation profile, or a plant for the ground around it, read from USGS lidar where it has been flown.</p>
            {markers.length > 0 && <p className="mt-2 text-accent">{markers.length} {markers.length === 1 ? "finding" : "findings"} on the map.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
