"use client";

/**
 * The region on a map: every mapped gas pipeline and processing plant, the companies this person
 * watches in colour, findings as markers (click one to see its card), and a recent satellite layer.
 */
import dynamic from "next/dynamic";
import { Layers, Loader2, Satellite, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EdgeCardView } from "./Cards";
import { useApi, type AssetCollection, type EdgeCard, type EdgeState, type FeedData, type Imagery } from "./client";
import type { MapMarker } from "./EarthMap";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <MapLoading /> });

export function MapLoading() {
  return <div className="flex h-full w-full items-center justify-center bg-elevated/40 text-[12px] text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading the map</div>;
}

/** Distinct colours for watched companies (Okabe-Ito, then two extras). */
export const WATCH_COLORS = ["#E69F00", "#56B4E9", "#009E73", "#CC79A7", "#D55E00", "#F0E442", "#0072B2"];

export function centreOf(card: EdgeCard): { lon: number; lat: number } | null {
  const site = (card.visual as { site?: { lon: number; lat: number } }).site;
  if (site) return { lon: site.lon, lat: site.lat };
  if (card.bbox) return { lon: (card.bbox[0] + card.bbox[2]) / 2, lat: (card.bbox[1] + card.bbox[3]) / 2 };
  return null;
}

export function MapView({ state, now, focus, onOpenDeal }: { state: EdgeState; now: number; focus: { card: EdgeCard; key: number } | null; onOpenDeal: (c: EdgeCard) => void }) {
  const region = state.covered[0];
  const assets = useApi<AssetCollection>(`/api/edge/assets?place=${region.key}`);
  const feed = useApi<FeedData>("/api/edge/feed?scope=all", 120_000);
  const [satOn, setSatOn] = useState(!!focus);
  const sat = useApi<Imagery>(satOn ? `/api/edge/imagery?place=${region.key}` : null);
  const [picked, setPicked] = useState<number | null>(focus?.card.id ?? null);
  const [zoom, setZoom] = useState(0);

  const highlight = useMemo(() => state.watches.filter((w) => w.kind === "company" && w.target.ticker).map((w, i) => ({ ticker: w.target.ticker!, label: w.label, color: WATCH_COLORS[i % WATCH_COLORS.length] })), [state.watches]);
  const cards = useMemo(() => {
    const all = [...(feed.data?.cards ?? [])];
    if (focus && !all.some((c) => c.id === focus.card.id)) all.unshift(focus.card);
    return all;
  }, [feed.data, focus]);
  const markers: MapMarker[] = useMemo(() => cards.flatMap((c) => { const p = centreOf(c); return p && c.kind === "ground_change" ? [{ id: c.id, lon: p.lon, lat: p.lat, title: c.title, kind: c.kind }] : []; }), [cards]);
  const fly = useMemo(() => { const p = focus ? centreOf(focus.card) : null; return p ? { ...p, zoom: 13.2, key: focus!.key } : null; }, [focus]);
  const card = cards.find((c) => c.id === picked) ?? null;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="panel relative h-[64vh] min-h-[420px] overflow-hidden">
        <EarthMap bbox={region.bbox} assets={assets.data} highlight={highlight} markers={markers} satellite={satOn ? sat.data : null} focus={fly} onMarker={setPicked} onZoom={setZoom} />
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
      </div>
      <aside className="min-w-0">
        {card ? (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted">
              <span>Selected finding</span>
              <button type="button" onClick={() => setPicked(null)} className="flex items-center gap-1 rounded px-1 hover:text-fg"><X className="h-3.5 w-3.5" /> Close</button>
            </div>
            <EdgeCardView card={card} index={0} now={now} onOpenDeal={onOpenDeal} />
          </div>
        ) : (
          <div className="panel p-4 text-[12.5px] text-muted">
            <h3 className="text-[13px] font-semibold text-fg">The {region.name}, mapped</h3>
            <p className="mt-1.5 leading-relaxed">{assets.data ? `${assets.data.features.filter((f) => f.properties.kind === "pipeline").length.toLocaleString()} pipeline segments and ${assets.data.features.filter((f) => f.properties.kind === "processing_plant").length} processing plants` : "Pipelines and processing plants"} from EIA maps, each matched to its listed parent where one is known. Click a pipeline or plant for its operator; click a marker to see what changed there.</p>
            <p className="mt-2 leading-relaxed">Turn on Satellite and zoom in to see the ground itself: the clearest Sentinel-2 pixels of the last six weeks, 10 m across.</p>
            {markers.length > 0 && <p className="mt-2 text-accent">{markers.length} {markers.length === 1 ? "finding" : "findings"} on the map.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}
