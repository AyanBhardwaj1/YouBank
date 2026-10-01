"use client";

/**
 * A Newsroom deal drawn on Edge's map, inside the story (with the Edge beta on): both sides' plants and
 * pipelines in their colours, the counties where the combination screens high, and the headline numbers,
 * with the full what-if a click away. A deal whose sides own nothing mapped offers the what-if alone.
 */
import dynamic from "next/dynamic";
import { ArrowRight, Map as MapIcon } from "lucide-react";
import { useMemo } from "react";
import { useApi } from "@/components/news/client";
import { whatIfUrl } from "@/lib/edge/links";
import type { Proforma } from "@/lib/edge/proforma";
import type { Bbox } from "@/lib/edge/sources/eia";
import type { AssetCollection } from "./client";
import type { CountyShade, MapParty } from "./EarthMap";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-elevated/40" /> });

type Compact = Pick<Proforma, "parties" | "combined" | "overlap" | "counties" | "divestitures"> & { place: Proforma["place"] };
type DealOnMap = {
  deal: { id: number; kind: string; parties: string[] } | null;
  card: { id: number; title: string; summary: string; bbox: Bbox | null; visual: { place: string; proforma: Compact; parties: { label: string; tickers: string[]; companies: string[] }[] } } | null;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export function DealMap({ storyId }: { storyId: number }) {
  const { data } = useApi<DealOnMap>(`/api/edge/deal?story=${storyId}`);
  const card = data?.card ?? null;
  const p = card?.visual.proforma ?? null;
  const place = card?.visual.place ?? "permian";
  const tickers = p ? p.parties.map((x) => x.ticker).filter(Boolean) : [];
  const names = p ? p.parties.filter((x) => !x.ticker).map((x) => x.label) : [];
  const assets = useApi<AssetCollection>(p ? `/api/edge/assets?place=${place}&tickers=${tickers.join(",")}&names=${encodeURIComponent(names.join(","))}` : null);
  const counties = useApi<AssetCollection>(p ? `/api/edge/assets?place=${place}&kinds=county` : null);
  const parties: MapParty[] = useMemo(() => (p ? p.parties.map((x) => ({ key: x.key, label: x.label, color: x.color, tickers: x.ticker ? [x.ticker] : [], companies: x.ticker ? [] : [x.label] })) : []), [p]);
  const shade: CountyShade = useMemo(() => Object.fromEntries((p?.counties ?? []).map((c) => [c.geoid, { flag: c.flag, shared: c.parties.length >= 2 }])), [p]);
  if (!data?.deal || data.deal.parties.length < 2) return null;
  const link = whatIfUrl(card ? card.visual.parties.map((x) => x.tickers[0] ?? x.label) : data.deal.parties, place);

  if (!p || !card?.bbox) {
    return (
      <a href={link} className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-accent hover:underline">
        <MapIcon className="h-3.5 w-3.5" /> Draw what they would own together in Edge&apos;s what-if <ArrowRight className="h-3 w-3" />
      </a>
    );
  }
  const high = p.counties.filter((c) => c.flag === "high").length;
  return (
    <div className="nr-card mt-3 overflow-hidden">
      <div className="relative h-[240px]">
        <EarthMap bbox={card.bbox} assets={assets.data} parties={parties} counties={counties.data} shade={shade} />
        <div className="pointer-events-none absolute left-2 top-2 rounded-md border border-line bg-bg/85 px-2 py-1.5 text-[10.5px] shadow">
          {p.parties.map((x) => <div key={x.key} className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: x.color }} />{x.label}</div>)}
          {high > 0 && <div className="mt-0.5 flex items-center gap-1.5 text-muted"><span className="h-2.5 w-3 rounded-sm bg-neg/40" />Screens high</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 text-[11.5px] text-muted">
        <span><span className="num text-fg">{fmt(p.combined.capacityMMcfd)}</span> MMcfd of processing together ({Math.round(p.combined.capacityShare * 100)}% of the {p.place.name}&apos;s mapped capacity)</span>
        <span><span className="num text-fg">{p.overlap.counties}</span> counties where both operate{high ? <>, <span className="num text-neg">{high}</span> screen high</> : ""}</span>
        <a href={link} className="ml-auto inline-flex items-center gap-1 font-medium text-accent hover:underline">Open the what-if <ArrowRight className="h-3 w-3" /></a>
      </div>
      <p className="border-t border-line px-3 py-1.5 text-[10px] text-faint">Edge, from EIA&apos;s pipeline and processing-plant maps; county concentration screened as in the 2023 Merger Guidelines. A county is a rough market, so treat flags as where to look.</p>
    </div>
  );
}
