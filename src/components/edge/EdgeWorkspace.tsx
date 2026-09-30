"use client";

/**
 * Edge: an alternative-data edge from four frontier techniques, as modules. The feed shows what changed
 * at the things a person watches; the map shows the region itself; the what-if draws any combination
 * of companies. Earth (GeoAI) is live; Documents, Networks and Scenarios arrive next and plug into the
 * same feed, watches and canvases.
 */
import { motion } from "motion/react";
import { Radar as RadarIcon } from "lucide-react";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useSubNav } from "@/lib/subnav";
import { CanvasHome } from "./canvas/CanvasHome";
import { FeedView } from "./FeedView";
import { MapView } from "./MapView";
import { MODULES, useEdgeState, useNow, type EdgeCard, type ProformaVisual } from "./client";
import { WatchPanel } from "./WatchPanel";
import { WhatIf } from "./WhatIf";

export type EdgeView = "feed" | "canvases" | "map" | "whatif";
const VIEWS: { id: EdgeView; label: string }[] = [{ id: "feed", label: "Feed" }, { id: "canvases", label: "Canvases" }, { id: "map", label: "Map" }, { id: "whatif", label: "Deal what-if" }];

export function EdgeWorkspace({ initialView = "feed" }: { initialView?: EdgeView }) {
  const now = useNow();
  const [view, setView] = useState<EdgeView>(initialView);
  useSubNav("/app/edge", (v) => { if (VIEWS.some((x) => x.id === v)) setView(v as EdgeView); });
  const edge = useEdgeState();
  const [focus, setFocus] = useState<{ card: EdgeCard; key: number } | null>(null);
  const [deal, setDeal] = useState<{ parties: string[]; place?: string; key: number } | null>(null);

  const showOnMap = (card: EdgeCard) => { setFocus({ card, key: Date.now() }); setView("map"); };
  const openDeal = (card: EdgeCard) => {
    const v = card.visual as ProformaVisual;
    setDeal({ parties: v.parties.map((p) => p.tickers[0] ?? p.label), place: v.place, key: Date.now() });
    setView("whatif");
  };

  const state = edge.data;
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <RadarIcon className="h-5 w-5 text-accent" />
              <h1 className="text-[20px] font-semibold tracking-tight">Edge</h1>
              <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">Beta</span>
            </div>
            <p className="mt-1 max-w-[70ch] text-[12.5px] text-muted">What satellites, networks and documents show before the news does, on the things you watch.</p>
          </div>
          <nav className="flex items-center gap-0.5 rounded-lg border border-line p-0.5" aria-label="Edge views">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined} className={`relative rounded-md px-3 py-1 text-[12.5px] transition ${view === v.id ? "text-fg" : "text-muted hover:text-fg"}`}>
                {view === v.id && <motion.span layoutId="edge-view" className="absolute inset-0 rounded-md bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <span className="relative">{v.label}</span>
              </button>
            ))}
          </nav>
        </header>

        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4" aria-label="Modules">
          {MODULES.map((m) => (
            <div key={m.id} className={`panel flex items-start gap-2 px-3 py-2 ${m.live ? "border-accent/40" : "opacity-70"}`} title={m.blurb}>
              <Icon name={m.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${m.live ? "text-accent" : "text-muted"}`} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[12.5px] font-semibold">{m.label}<span className="text-[10.5px] font-normal text-muted">· {m.tech}</span></div>
                <div className="truncate text-[10.5px] text-muted">{m.live ? "Live" : "Arriving next"}: {m.blurb}</div>
              </div>
            </div>
          ))}
        </div>

        {!state ? (
          edge.error ? <p className="mt-6 text-[12.5px] text-neg">{edge.error}</p> : <div className="mt-6 h-40 animate-pulse rounded-lg bg-elevated/40" />
        ) : (
          <div className={`mt-4 grid gap-4 ${view === "feed" ? "xl:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
            <main className="min-w-0">
              {view === "feed" && <FeedView state={state} now={now} onMap={showOnMap} onOpenDeal={openDeal} onBlend={edge.reload} />}
              {view === "canvases" && <CanvasHome />}
              {view === "map" && <MapView key={focus?.key ?? 0} state={state} now={now} focus={focus} onOpenDeal={openDeal} />}
              {view === "whatif" && <WhatIf key={deal?.key ?? 0} state={state} initial={deal} />}
            </main>
            {view === "feed" && (
              <div className="order-first space-y-3 xl:order-none">
                <WatchPanel state={state} now={now} onChanged={edge.reload} />
                <div className="panel hidden p-3 text-[11.5px] leading-relaxed text-muted xl:block">
                  <div className="font-semibold text-fg">How Earth works</div>
                  <p className="mt-1">Every day Edge compares each watched plant with the same place a year before in Sentinel-2 imagery (10 m), keeps changes that are compact and clear of cloud, shadow and vegetation, and describes what it sees. New Newsroom deals that touch your companies are drawn as pro-forma maps.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
