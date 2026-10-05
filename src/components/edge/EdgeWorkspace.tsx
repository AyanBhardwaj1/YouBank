"use client";

/**
 * Edge: an alternative-data edge from four frontier techniques, as modules. The feed shows what changed
 * at the things a person watches; Documents answers from filings, calls and data rooms with checked
 * quotes; Networks draws and predicts from the relationship graph; Scenarios simulates what could
 * happen, labeled synthetic; the map shows the region itself; the what-if draws any combination of
 * companies. All four modules plug into the same feed, watches and canvases.
 */
import dynamic from "next/dynamic";
import { MotionConfig, motion } from "motion/react";
import { Radar as RadarIcon, RefreshCw } from "lucide-react";
import { useCallback, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useSubNav } from "@/lib/subnav";
import type { DocsOpen } from "./docs/DocumentsView";
import { FeedView } from "./FeedView";
import { MODULES, useEdgeState, type EdgeCard, type EdgeState, type FeedData, type FilingVisual, type ProformaVisual } from "./client";
import { WatchPanel } from "./WatchPanel";

// Only the feed ships with the page; each other view loads the first time it is opened.
const ViewLoading = () => <div className="panel h-[520px] p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-[440px] rounded-lg" /></div>;
const CanvasHome = dynamic(() => import("./canvas/CanvasHome").then((m) => m.CanvasHome), { loading: ViewLoading });
const DocumentsView = dynamic(() => import("./docs/DocumentsView").then((m) => m.DocumentsView), { loading: ViewLoading });
const NetworksView = dynamic(() => import("./net/NetworksView").then((m) => m.NetworksView), { loading: ViewLoading });
const ScenariosView = dynamic(() => import("./scen/ScenariosView").then((m) => m.ScenariosView), { loading: ViewLoading });
const MapView = dynamic(() => import("./MapView").then((m) => m.MapView), { loading: ViewLoading });
const WhatIf = dynamic(() => import("./WhatIf").then((m) => m.WhatIf), { loading: ViewLoading });

export type EdgeView = "feed" | "canvases" | "documents" | "networks" | "scenarios" | "map" | "whatif";
const VIEWS: { id: EdgeView; label: string }[] = [{ id: "feed", label: "Feed" }, { id: "canvases", label: "Canvases" }, { id: "documents", label: "Documents" }, { id: "networks", label: "Networks" }, { id: "scenarios", label: "Scenarios" }, { id: "map", label: "Map" }, { id: "whatif", label: "Deal what-if" }];

export function EdgeWorkspace({ initialView = "feed", initialDocs = null, initialCompany = null, initialDeal = null, initialState, initialFeed, seededAt }: { initialView?: EdgeView; initialDocs?: DocsOpen | null; initialCompany?: string | null; initialDeal?: { parties: string[]; place: string } | null; initialState?: EdgeState; initialFeed?: FeedData; seededAt?: string }) {
  const [view, setViewState] = useState<EdgeView>(initialView);
  // The feed page that came with the page is used once; coming back to the feed later fetches it fresh.
  const [feedSeed, setFeedSeed] = useState(initialFeed);
  // The view rides in the address, so a refresh or a shared link opens the same one.
  const setView = useCallback((v: EdgeView) => {
    setViewState(v); setFeedSeed(undefined);
    try { window.history.replaceState(null, "", v === "feed" ? "/app/edge" : `/app/edge?view=${v}`); } catch { /* the view still changes */ }
  }, []);
  useSubNav("/app/edge", (v) => { if (VIEWS.some((x) => x.id === v)) setView(v as EdgeView); });
  const edge = useEdgeState(initialState, seededAt);
  const [focus, setFocus] = useState<{ card: EdgeCard; key: number; threeD?: boolean } | null>(null);
  const [deal, setDeal] = useState<{ parties: string[]; place?: string; key: number } | null>(initialDeal ? { ...initialDeal, key: 1 } : null);
  const [docs, setDocs] = useState<DocsOpen | null>(initialDocs);
  const [net, setNet] = useState<{ ticker: string | null; key: number }>({ ticker: initialCompany, key: 0 });

  // Stable handlers, so the memoized feed cards do not re-render when the workspace does.
  const showOnMap = useCallback((card: EdgeCard, opts?: { threeD?: boolean }) => { setFocus({ card, key: Date.now(), threeD: opts?.threeD }); setView("map"); }, [setView]);
  const openDeal = useCallback((card: EdgeCard) => {
    const v = card.visual as ProformaVisual;
    setDeal({ parties: v.parties.map((p) => p.tickers[0] ?? p.label), place: v.place, key: Date.now() });
    setView("whatif");
  }, [setView]);
  const openNetworks = useCallback((ticker: string) => { setNet({ ticker, key: Date.now() }); setView("networks"); }, [setView]);
  const openRadar = useCallback((card: EdgeCard) => {
    const v = card.visual as FilingVisual;
    setDocs({ tab: "radar", radar: { ticker: v.ticker, form: v.form, section: v.section }, key: Date.now() });
    setView("documents");
  }, [setView]);

  const state = edge.data;
  const watchedTickers = [...new Set((state?.watches ?? []).map((w) => w.target.ticker).filter((t): t is string => !!t))];
  return (
    <MotionConfig reducedMotion="user">
    <div className="scroll-touch h-full overflow-auto">
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
          {/* On a phone the seven views scroll sideways rather than push the page wider, fading at the edge to say there is more. */}
          <nav className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg border border-line p-0.5 [scrollbar-width:none] max-md:[mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)]" aria-label="Edge views">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" onClick={() => setView(v.id)} aria-current={view === v.id ? "page" : undefined} className={`relative shrink-0 whitespace-nowrap rounded-md px-3 py-1 text-[12.5px] transition max-md:min-h-9 ${view === v.id ? "text-fg" : "text-muted hover:text-fg"}`}>
                {view === v.id && <motion.span layoutId="edge-view" className="absolute inset-0 rounded-md bg-elevated" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                <span className="relative">{v.label}</span>
              </button>
            ))}
          </nav>
        </header>

        {/* The modules: a tile each from a tablet up, one line of chips on a phone so the feed starts above the fold. */}
        <div className="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none] md:hidden" aria-label="Modules">
          {MODULES.map((m) => <span key={m.id} title={m.blurb} className="flex shrink-0 items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px]"><Icon name={m.icon} className="h-3 w-3 text-accent" />{m.label}<span className="text-muted">· {m.tech}</span></span>)}
        </div>
        <div className="mt-3 hidden grid-cols-4 gap-2 md:grid" aria-label="Modules">
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
          edge.error ? (
            <div className="panel mt-4 flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <p className="text-[12.5px] text-neg">Edge did not load: {edge.error}</p>
              <button type="button" onClick={edge.reload} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] text-muted hover:text-fg"><RefreshCw className="h-3.5 w-3.5" /> Try again</button>
            </div>
          ) : <EdgeSkeleton />
        ) : (
          <div className={`mt-4 grid gap-4 ${view === "feed" ? "xl:grid-cols-[minmax(0,1fr)_300px]" : ""}`}>
            <main key={view} className="fade-in min-w-0">
              {view === "feed" && <FeedView state={state} initial={feedSeed} onMap={showOnMap} onOpenDeal={openDeal} onOpenRadar={openRadar} onOpenNetworks={openNetworks} onBlend={edge.reload} />}
              {view === "canvases" && <CanvasHome />}
              {view === "documents" && <DocumentsView key={docs?.key ?? 0} tickers={watchedTickers} open={docs} />}
              {view === "networks" && <NetworksView key={net.key} tickers={watchedTickers} initial={net.ticker} />}
              {view === "scenarios" && <ScenariosView tickers={watchedTickers} />}
              {view === "map" && <MapView key={focus?.key ?? 0} state={state} focus={focus} onOpenDeal={openDeal} />}
              {view === "whatif" && <WhatIf key={deal?.key ?? 0} state={state} initial={deal} />}
            </main>
            {view === "feed" && (
              <div className="order-first space-y-3 xl:order-none">
                <WatchPanel state={state} onChanged={edge.reload} />
                <div className="panel hidden p-3 text-[11.5px] leading-relaxed text-muted xl:block">
                  <div className="font-semibold text-fg">How Earth works</div>
                  <p className="mt-1">Every day Edge compares each watched plant with the same place a year before in Sentinel-2 imagery (10 m), keeps changes that are compact and clear of cloud, shadow and vegetation, and describes what it sees. New Newsroom deals that touch your companies are drawn as pro-forma maps.</p>
                  <div className="mt-2 font-semibold text-fg">How Documents works</div>
                  <p className="mt-1">When a company you watch files a 10-K or 10-Q, Edge compares its risk factors with the previous one and posts what was added, dropped and reworded, in the filing&apos;s own words.</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </MotionConfig>
  );
}

/** Before the person's Edge state arrives: the feed and the watch panel, shaped as they will be. */
export function EdgeSkeleton() {
  return (
    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]" aria-busy="true" aria-label="Loading Edge">
      <div className="min-w-0">
        <div className="flex gap-1">{[72, 48, 48, 64].map((w, i) => <div key={i} className="shimmer h-6 rounded-md" style={{ width: w }} />)}</div>
        <div className="mt-3 grid items-start gap-3 lg:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="panel p-3.5"><div className="shimmer h-3 w-40 rounded" /><div className="shimmer mt-2.5 aspect-square w-full rounded-lg" /><div className="shimmer mt-3 h-4 w-3/4 rounded" /><div className="shimmer mt-2 h-3 w-full rounded" /></div>)}
        </div>
      </div>
      <div className="panel order-first h-fit p-3 xl:order-none"><div className="shimmer h-4 w-24 rounded" /><div className="shimmer mt-2 h-1 w-full rounded" /><div className="mt-3 space-y-2">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-8 rounded-md" />)}</div></div>
    </div>
  );
}
