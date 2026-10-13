"use client";

/**
 * Edge in the Terminal, with the beta on. EDGE: one company across Edge (what was found about it, the
 * deal model's buyers and targets, red flags, what of it is on the map). GEO: its plants and pipelines
 * with what satellites saw change there. NET: its relationships from SEC filings and what the graph
 * finds. SIM: a stress of its stock. ASK: a question over its filings and the person's documents,
 * answered with checked quotes.
 */
import dynamic from "next/dynamic";
import { AlertTriangle, Check, CircleStop, ExternalLink, Eye, Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, post, useApi } from "@/components/news/client";
import { EdgeCardView } from "@/components/edge/Cards";
import type { AssetCollection, EdgeCard, EdgeState, ProformaVisual } from "@/components/edge/client";
import type { MapMarker } from "@/components/edge/EarthMap";
import { AnswerView } from "@/components/edge/docs/AnswerView";
import { CitationViewer } from "@/components/edge/docs/CitationViewer";
import { askStream, errorText, type DocAnswer, type ViewTarget } from "@/components/edge/docs/client";
import { Findings } from "@/components/edge/net/Findings";
import { ForceGraph } from "@/components/edge/net/ForceGraph";
import { fmtUsd, type CompanyView, type GEdge, type GNode, type Missing, type Picks, type Prediction, type Sub } from "@/components/edge/net/client";
import { MarketResultView } from "@/components/edge/scen/MarketTab";
import type { MarketResult } from "@/lib/edge/scen/market";
import type { CompanyOverview, RankedPick } from "@/lib/edge/overview";
import { networkUrl, radarUrl, simRequest, whatIfUrl } from "@/lib/edge/links";
import type { Command } from "@/lib/functions";
import { errorMessage } from "@/lib/client/errors";

const EarthMap = dynamic(() => import("@/components/edge/EarthMap"), { ssr: false, loading: () => <div className="shimmer h-full w-full" /> });

type Run = (c: Command) => void;
const EARTH_KINDS = new Set(["ground_change", "radar_change", "flaring", "methane_plume", "permits"]);
const KIND: Record<string, string> = { ground_change: "Ground", radar_change: "Radar", flaring: "Flaring", methane_plume: "Methane", permits: "Permits", deal_proforma: "Deal", filing_change: "Filing", graph_flag: "Red flag", graph_prediction: "Model" };
const openTab = (url: string) => window.open(url, "_blank", "noopener");

function Waiting({ error, what }: { error: string | null; what: string }) {
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-6 text-center">
        <div className="text-[13px] text-neg">Could not load {what}</div>
        <p className="max-w-[440px] text-[11.5px] text-muted">{error}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 p-3" aria-busy="true">
      <div className="flex items-center gap-2 text-[11px] text-muted"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Loading {what}…</div>
      <div className="shimmer h-20 ctl" /><div className="shimmer h-40 ctl" />
    </div>
  );
}

function Heading({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return <div className="mb-1.5 flex items-center justify-between gap-2"><h3 className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{children}</h3>{action}</div>;
}

/** A finding in a line, opening to the full feed card. */
function FindingRow({ card, open, onToggle, onRun }: { card: EdgeCard; open: boolean; onToggle: () => void; onRun: Run }) {
  const at = card.observedAt ?? card.detectedAt;
  return (
    <li className="rounded-md border border-line">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-elevated/40">
        <span className="w-[58px] shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted">{KIND[card.kind] ?? card.module}</span>
        <span className="min-w-0 flex-1 truncate text-[12px]">{card.title}</span>
        <span className="num shrink-0 text-[10.5px] text-faint">{at.slice(0, 10)}</span>
      </button>
      {open && (
        <div className="border-t border-line p-2">
          <EdgeCardView card={card} index={0}
            onOpenDeal={(c) => openTab(whatIfUrl((c.visual as ProformaVisual).parties.map((p) => p.tickers[0] ?? p.label), (c.visual as ProformaVisual).place))}
            onOpenRadar={() => openTab(radarUrl(card.tickers[0] ?? ""))}
            onOpenNetworks={(t) => onRun({ ticker: t, fn: "NET", via: "click" })} />
        </div>
      )}
    </li>
  );
}

function PickBars({ title, items, onRun }: { title: string; items: RankedPick[]; onRun: Run }) {
  const max = Math.max(1e-6, ...items.map((i) => i.score));
  return (
    <section>
      <Heading>{title}</Heading>
      {!items.length ? <p className="text-[11.5px] text-muted">None from the latest model.</p> : (
        <ol className="space-y-1">
          {items.map((p) => (
            <li key={`${p.rank}-${p.name}`} title={p.why}>
              <button type="button" disabled={!p.ticker} onClick={() => p.ticker && onRun({ ticker: p.ticker, fn: "EDGE", via: "click" })} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left hover:bg-elevated/40 disabled:cursor-default">
                <span className="num w-4 shrink-0 text-[10.5px] text-faint">{p.rank}</span>
                <span className="min-w-0 flex-1 truncate text-[12px]">{p.name}{p.ticker ? <span className="num ml-1 text-muted">{p.ticker}</span> : null}</span>
                <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent" style={{ width: `${(p.score / max) * 100}%` }} /></span>
              </button>
              {p.why && <div className="truncate pl-7 text-[10.5px] text-muted">{p.why}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function useOverview(ticker: string) {
  return useApi<CompanyOverview>(ticker ? `/api/edge/company?ticker=${encodeURIComponent(ticker)}` : null);
}

export function EdgeScreen({ ticker, onRun }: { ticker: string; onRun: Run }) {
  const q = useOverview(ticker);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!q.data) return <Waiting error={q.error} what={`Edge on ${ticker}`} />;
  const d = q.data;
  const g = d.graph;
  const watch = async () => {
    setBusy(true); setError(null);
    try {
      if (d.watch) await api(`/api/edge/watches/${d.watch.id}`, { method: "DELETE" });
      else await post("/api/edge/watches", { kind: "company", ticker });
      q.reload();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const onMap = d.assets.plants + d.assets.pipelines > 0;
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <header className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-semibold">{d.name}</div>
          <div className="truncate text-[11px] text-muted">{[g?.industry, g?.place, g?.revenue ? `revenue ${fmtUsd(g.revenue)}` : ""].filter(Boolean).join(" · ") || "Not in the relationship graph yet"}</div>
        </div>
        {(d.watch || d.canWatch) && (
          <button type="button" disabled={busy} onClick={() => void watch()} aria-pressed={!!d.watch} title={d.watch ? "Stop watching" : "Watch it: its ground, filings and deals are checked daily, and big changes alert you"}
            className={`ctl flex items-center gap-1 border px-2 py-0.5 text-[11.5px] ${d.watch ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : d.watch ? <Check className="h-3 w-3" /> : <Eye className="h-3 w-3" />}{d.watch ? "Watching" : "Watch"}
          </button>
        )}
        <div className="flex gap-1">
          {(["GEO", "NET", "SIM", "ASK"] as const).map((fn) => <button key={fn} type="button" onClick={() => onRun({ ticker, fn, via: "click" })} className="num ctl border border-line px-1.5 py-0.5 text-[11px] text-accent hover:border-accent/50">{fn}</button>)}
        </div>
      </header>
      {error && <p className="text-[11.5px] text-neg">{error}</p>}

      <section>
        <Heading action={<a href="/app/edge?view=feed" target="_blank" rel="noreferrer" className="text-[10.5px] text-accent hover:underline">The feed</a>}>What Edge found</Heading>
        {!d.cards.length ? <p className="text-[11.5px] text-muted">Nothing yet in the last year: no ground change at its mapped sites, deal footprint, filing rewrite, red flag or model pick. {d.watch ? "It is checked daily." : "Watch it to have it checked daily."}</p> : (
          <ul className="space-y-1">{d.cards.map((c) => <FindingRow key={c.id} card={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} onRun={onRun} />)}</ul>
        )}
      </section>

      {g ? (
        <>
          <div className="grid gap-3 @2xl:grid-cols-2">
            <PickBars title="Likely buyers" items={g.buyers} onRun={onRun} />
            <PickBars title="Likely targets" items={g.targets} onRun={onRun} />
          </div>
          <p className="text-[10.5px] text-faint">{g.scorecard}{g.version ? ` · model ${g.version}` : ""}. A ranking from past deals, not a forecast.</p>
          <section>
            <Heading action={<button type="button" onClick={() => onRun({ ticker, fn: "NET", via: "click" })} className="text-[10.5px] text-accent hover:underline">NET</button>}>Red flags</Heading>
            {!g.flags.length ? <p className="text-[11.5px] text-muted">None in the filings Edge has read.</p> : (
              <ul className="space-y-1">{g.flags.map((f, i) => (
                <li key={i} className="flex items-start gap-1.5"><AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${f.severity === "high" ? "text-neg" : "text-muted"}`} /><span className="min-w-0 flex-1"><span className="font-medium">{f.title}</span> <span className="text-muted">{f.detail}</span></span><span className="num shrink-0 text-[10.5px] text-faint">{f.date}</span></li>
              ))}</ul>
            )}
          </section>
          <div className="flex flex-wrap gap-1 text-[10.5px]">
            {([["directors", "directors"], ["officers", "officers"], ["holders", "5% holders"], ["subsidiaries", "subsidiaries"], ["customers", "named customers"], ["deals", "deals"]] as const).map(([k, label]) => g.counts[k] ? <span key={k} className="num rounded-full border border-line px-2 py-0.5 text-muted">{g.counts[k]} {label}</span> : null)}
          </div>
        </>
      ) : (
        <p className="text-[11.5px] text-muted">{d.name} is not in the relationship graph yet. <button type="button" onClick={() => onRun({ ticker, fn: "NET", via: "click" })} className="text-accent hover:underline">NET</button> reads its filings in.</p>
      )}

      <section>
        <Heading action={onMap ? <button type="button" onClick={() => onRun({ ticker, fn: "GEO", via: "click" })} className="text-[10.5px] text-accent hover:underline">GEO</button> : undefined}>On the map</Heading>
        <p className="text-[11.5px] text-muted">{onMap ? <><span className="num text-fg">{d.assets.plants}</span> gas processing plants ({d.assets.capacityMMcfd.toLocaleString("en-US")} MMcfd) and <span className="num text-fg">{d.assets.pipelines}</span> pipelines ({d.assets.pipelineKm.toLocaleString("en-US")} km) in the Permian, from EIA&apos;s maps.</> : "None of its assets are on Edge's map, which covers the Permian's gas pipelines and processing plants."}</p>
      </section>

      <footer className="flex flex-wrap gap-3 border-t border-line pt-2 text-[11px]">
        <a href={networkUrl(ticker)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Open in Edge<ExternalLink className="h-3 w-3" /></a>
        <a href={radarUrl(ticker)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">What changed in its 10-K<ExternalLink className="h-3 w-3" /></a>
      </footer>
    </div>
  );
}

const centreOf = (c: EdgeCard) => {
  const site = (c.visual as { site?: { lon: number; lat: number } }).site;
  if (site) return { lon: site.lon, lat: site.lat };
  return c.bbox ? { lon: (c.bbox[0] + c.bbox[2]) / 2, lat: (c.bbox[1] + c.bbox[3]) / 2 } : null;
};

export function GeoScreen({ ticker, onRun }: { ticker: string; onRun: Run }) {
  const q = useOverview(ticker);
  const state = useApi<EdgeState>("/api/edge");
  const has = !!q.data && q.data.assets.plants + q.data.assets.pipelines > 0;
  const assets = useApi<AssetCollection>(has ? `/api/edge/assets?place=permian&tickers=${encodeURIComponent(ticker)}` : null);
  const [focus, setFocus] = useState<{ lon: number; lat: number; zoom?: number; key: number } | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  // Everything Earth finds at the sites: ground and radar change, flaring, methane, drilling permits.
  const ground = useMemo(() => (q.data?.cards ?? []).filter((c) => EARTH_KINDS.has(c.kind)), [q.data]);
  const markers: MapMarker[] = useMemo(() => ground.flatMap((c) => { const at = centreOf(c); return at ? [{ id: c.id, ...at, title: c.title, kind: c.kind }] : []; }), [ground]);
  if (!q.data || !state.data) return <Waiting error={q.error ?? state.error} what={`${ticker} on the ground`} />;
  const permian = state.data.places.find((p) => p.key === "permian") ?? state.data.places[0];
  return (
    <div className="space-y-3 p-3 text-[12px]">
      <div className="text-[11.5px] text-muted">{has ? <>{q.data.name}: <span className="num text-fg">{q.data.assets.plants}</span> processing plants and <span className="num text-fg">{q.data.assets.pipelines}</span> pipelines in the Permian, in colour; everyone else&apos;s muted.</> : <>None of {q.data.name}&apos;s assets are on Edge&apos;s map (the Permian&apos;s gas pipelines and processing plants).</>}</div>
      {permian && (
        <div className="relative h-[320px] overflow-hidden ctl border border-line">
          <EarthMap bbox={permian.bbox} assets={assets.data} highlight={[{ ticker, color: "#E0795A" }]} markers={markers} focus={focus} onMarker={(id) => setOpen(id)} />
        </div>
      )}
      <section>
        <Heading>What changed on the ground</Heading>
        {!ground.length ? <p className="text-[11.5px] text-muted">No ground or radar change, flaring or jump in drilling permits at its mapped sites in the last year. {q.data.watch ? "Its sites are checked daily." : <button type="button" onClick={() => onRun({ ticker, fn: "EDGE", via: "click" })} className="text-accent hover:underline">Watch it from EDGE</button>}</p> : (
          <ul className="space-y-1">{ground.map((c) => (
            <FindingRow key={c.id} card={c} open={open === c.id} onRun={onRun}
              onToggle={() => { const next = open === c.id ? null : c.id; setOpen(next); const at = centreOf(c); if (next && at) setFocus({ ...at, zoom: 12, key: Date.now() }); }} />
          ))}</ul>
        )}
      </section>
      <p className="text-[10.5px] text-faint">Imagery: Copernicus Sentinel-2 and Sentinel-1 (ESA), via Microsoft Planetary Computer. Heat: NASA FIRMS (VIIRS). Permits: Texas RRC, New Mexico OCD. Assets: EIA. Map: OpenFreeMap, OpenStreetMap contributors.</p>
    </div>
  );
}

export function NetScreen({ ticker, onRun }: { ticker: string; onRun: Run }) {
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  const company = useApi<CompanyView | Missing>(`/api/edge/graph/company?ticker=${encodeURIComponent(ticker)}`, building ? 10_000 : 0);
  const data = company.data && !("missing" in company.data) ? company.data : null;
  const missing = company.data && "missing" in company.data ? company.data : null;
  const sub = useApi<Sub>(data ? `/api/edge/graph/subgraph?ticker=${encodeURIComponent(ticker)}` : null);
  const [pick, setPick] = useState<{ id: number; nodes: Set<number>; links: Set<number>; graph: Picks["graph"] } | null>(null);

  const onPick = useCallback((p: Prediction | null, graph: Picks["graph"]) => {
    if (!p) { setPick(null); return; }
    const nodes = new Set<number>(p.pathNodes.flat().concat(p.node.id));
    const links = new Set<number>(graph.links.filter((l) => p.pathNodes.some((path) => path.some((n, i) => i > 0 && ((path[i - 1] === l.s && n === l.d) || (path[i - 1] === l.d && n === l.s))))).map((l) => l.id));
    setPick({ id: p.node.id, nodes, links, graph });
  }, []);
  const drawn = useMemo(() => {
    if (!sub.data) return null;
    const nodes = new Map<number, GNode>(sub.data.nodes.map((n) => [n.id, n]));
    const links = new Map<number, GEdge>(sub.data.links.map((l) => [l.id, l]));
    if (pick) { for (const n of pick.graph.nodes) if (pick.nodes.has(n.id)) nodes.set(n.id, n); for (const l of pick.graph.links) if (pick.links.has(l.id)) links.set(l.id, l); }
    return { nodes: [...nodes.values()], links: [...links.values()] };
  }, [sub.data, pick]);

  const build = async () => {
    setBuildError(null);
    try { await post("/api/edge/graph/build", { ticker }); setBuilding(true); } catch (e) { setBuildError(errorMessage(e)); }
  };

  if (missing) {
    return (
      <div className="flex flex-col items-start gap-2 p-4 text-[12px]">
        <div className="text-[13px] font-semibold">{missing.name || missing.ticker} is not in the graph yet</div>
        {missing.listed ? (
          <>
            <p className="text-muted">Edge can read its filings now: its board, officers and insider trades, 5% holders, subsidiaries, named customers and suppliers, and its deals. It takes a minute or two.</p>
            {building ? <span className="flex items-center gap-1.5 text-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading {missing.ticker}&apos;s filings…</span>
              : <button type="button" onClick={() => void build()} className="ctl bg-accent px-3 py-1 font-semibold text-accent-fg">Build {missing.ticker}&apos;s network</button>}
            {buildError && <p className="text-neg">{buildError}</p>}
          </>
        ) : <p className="text-muted">No SEC filer has that ticker.</p>}
      </div>
    );
  }
  if (!data) return <Waiting error={company.error} what={`${ticker}'s network`} />;
  return (
    <div className="space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className="font-semibold text-fg">{data.node.name}</span>
        {([["directors", "directors"], ["officers", "officers"], ["holders", "5% holders"], ["subsidiaries", "subsidiaries"], ["deals", "deals"]] as const).map(([k, label]) => data.counts[k] ? <span key={k} className="num">{data.counts[k]} {label}</span> : null)}
        {pick && <button type="button" onClick={() => setPick(null)} className="text-accent hover:underline">Clear the path</button>}
        <a href={networkUrl(ticker)} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-accent hover:underline">Open in Edge<ExternalLink className="h-3 w-3" /></a>
      </div>
      {drawn ? <ForceGraph nodes={drawn.nodes} links={drawn.links} focus={data.node.id} height={300} highlight={pick ? { nodes: new Set([...pick.nodes, data.node.id]), links: pick.links } : null} onSelect={(n) => { if (n.kind === "company" && n.ticker && n.ticker !== ticker) onRun({ ticker: n.ticker, fn: "NET", via: "click" }); }} /> : <div className="shimmer h-[300px] ctl" />}
      <Findings key={ticker} ticker={ticker} company={data} onPick={onPick} picked={pick?.id ?? null} onOpen={(t) => onRun({ ticker: t, fn: "NET", via: "click" })} />
    </div>
  );
}

export function SimScreen({ ticker, arg }: { ticker: string; arg?: string }) {
  const [run, setRun] = useState<{ id: number; status: string; result: MarketResult } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const body = useMemo(() => simRequest(ticker, arg), [ticker, arg]);

  // Run once when the panel opens; the result is saved to the person's scenarios.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    post<{ id: number; status: string; result: MarketResult }>("/api/edge/scenarios", body).then(setRun).catch((e) => setError(errorMessage(e)));
  }, [body]);

  // While a refinement runs in the background, check back every few seconds.
  useEffect(() => {
    if (!run || run.status !== "refining") return;
    let live = true;
    const t = setInterval(() => { api<{ status: string; result: MarketResult }>(`/api/edge/scenarios/${run.id}`).then((s) => { if (live && s.status !== "refining") setRun({ id: run.id, status: s.status, result: s.result }); }).catch(() => undefined); }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [run]);

  if (!run) return error ? <Waiting error={error} what={`a stress of ${ticker}`} /> : (
    <div className="flex items-center gap-2 p-4 text-[12px] text-muted"><Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />Simulating 1,000 paths for {ticker}{arg ? `: ${arg}` : ""}…</div>
  );
  return (
    <div className="space-y-2 p-3">
      <MarketResultView r={run.result} id={run.id} status={run.status} onRefined={() => setRun({ ...run, status: "refining" })} />
      <p className="text-[10.5px] text-faint">Saved to your scenarios in Edge. Try <span className="num">SIM 2008</span>, <span className="num">SIM oil -30%</span> or a sentence.</p>
    </div>
  );
}

export function AskScreen({ ticker, arg }: { ticker: string; arg?: string }) {
  const [question, setQuestion] = useState(arg ?? "");
  const [steps, setSteps] = useState<string[] | null>(null);
  const [answer, setAnswer] = useState<DocAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cite, setCite] = useState<ViewTarget | null>(null);
  const abort = useRef<AbortController | null>(null);
  const asked = useRef(false);

  const ask = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || abort.current) return;
    setError(null); setAnswer(null); setSteps(["Gathering the documents in scope"]);
    abort.current = new AbortController();
    try {
      const a = await askStream({ question: q, mode: "balanced", form: "auto", scope: { tickers: [ticker], sources: ["sec", "uploads", "audio"], forms: ["10-K", "10-Q", "8-K"], months: 12 } },
        (m) => setSteps((s) => (s && s[s.length - 1] !== m ? [...s, m] : s)), abort.current.signal);
      setAnswer(a);
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") setError(errorText(e));
    } finally { setSteps(null); abort.current = null; }
  }, [ticker]);

  // A question typed after ASK is asked as the panel opens.
  useEffect(() => {
    if (!arg || asked.current) return;
    asked.current = true;
    queueMicrotask(() => void ask(arg));
  }, [arg, ask]);

  return (
    <div className="space-y-3 p-3 text-[12px]">
      <form onSubmit={(e) => { e.preventDefault(); void ask(question); }} className="flex gap-2">
        <input value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={2000} placeholder={`Ask ${ticker}'s filings, calls and your documents`} aria-label="Question"
          className="ctl min-w-0 flex-1 border border-line bg-bg px-2.5 py-1.5 outline-none placeholder:text-faint focus:border-accent/60" />
        {steps
          ? <button type="button" onClick={() => abort.current?.abort()} className="ctl flex items-center gap-1 border border-line px-2.5"><CircleStop className="h-3.5 w-3.5" />Stop</button>
          : <button type="submit" disabled={!question.trim()} className="ctl flex items-center gap-1 bg-accent px-2.5 font-semibold text-accent-fg disabled:opacity-50"><Search className="h-3.5 w-3.5" />Ask</button>}
      </form>
      {steps && (
        <ol className="space-y-1" aria-live="polite">
          {steps.map((s, i) => <li key={`${i}-${s}`} className="flex items-center gap-2">{i < steps.length - 1 ? <Check className="h-3.5 w-3.5 text-pos" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}<span className={i < steps.length - 1 ? "text-muted" : ""}>{s}</span></li>)}
          <li className="text-[10.5px] text-faint">Reading a company&apos;s filings for the first time takes a minute or two.</li>
        </ol>
      )}
      {error && <p className="text-neg">{error}</p>}
      {answer && <AnswerView a={answer} onCite={setCite} />}
      {answer?.answerId ? <a href={`/app/edge?view=documents&answer=${answer.answerId}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-accent hover:underline">Open in Documents<ExternalLink className="h-3 w-3" /></a> : null}
      {!answer && !steps && !error && <p className="text-[11px] text-muted">Searches {ticker}&apos;s 10-K, 10-Q and 8-K filings from the last year, plus your uploads and recordings. Every claim quotes its source; click one to see it in place.</p>}
      <CitationViewer target={cite} onClose={() => setCite(null)} />
    </div>
  );
}
