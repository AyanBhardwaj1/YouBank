"use client";

/**
 * Networks · GNN: a company's relationships as a graph built from SEC filings (boards and officers,
 * insiders, 5% holders, subsidiaries and joint ventures, customers and suppliers, deals), drawn as a
 * force network, on the map, or as an ownership tree, beside what the graph finds: likely buyers and
 * targets from the deal model, warm introductions, exposure and red flags. A company not yet in the
 * graph can be read in on the spot.
 */
import dynamic from "next/dynamic";
import { Loader2, Network, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, post, useApi } from "@/components/news/client";
import { fmtUsd, type CompanyView, type GEdge, type GNode, type MapData, type Missing, type Picks, type Prediction, type Status, type Sub, type Tree } from "./client";
import { Findings } from "./Findings";
import { ForceGraph } from "./ForceGraph";
import { OwnershipTree } from "./OwnershipTree";

const NetMap = dynamic(() => import("./NetMap"), { ssr: false, loading: () => <div className="h-[520px] animate-pulse rounded-lg bg-elevated/40" /> });

type Mode = "network" | "map" | "tree";
const MODES: { id: Mode; label: string }[] = [{ id: "network", label: "Network" }, { id: "map", label: "Map" }, { id: "tree", label: "Ownership" }];

export function NetworksView({ tickers, initial }: { tickers: string[]; initial?: string | null }) {
  const [ticker, setTicker] = useState((initial || tickers[0] || "ET").toUpperCase());
  const [mode, setMode] = useState<Mode>("network");
  const [building, setBuilding] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ ticker: string; name: string; inGraph: boolean }[]>([]);
  const [pick, setPick] = useState<{ id: number; nodes: Set<number>; links: Set<number>; graph: Picks["graph"] } | null>(null);

  const status = useApi<Status>("/api/edge/graph/status");
  const company = useApi<CompanyView | Missing>(`/api/edge/graph/company?ticker=${encodeURIComponent(ticker)}`, building === ticker ? 10_000 : 0);
  const data = company.data && !("missing" in company.data) ? company.data : null;
  const missing = company.data && "missing" in company.data ? company.data : null;
  const sub = useApi<Sub>(data && mode === "network" ? `/api/edge/graph/subgraph?ticker=${encodeURIComponent(ticker)}` : null);
  const map = useApi<MapData>(data && mode === "map" ? `/api/edge/graph/map?ticker=${encodeURIComponent(ticker)}` : null);
  const tree = useApi<Tree>(data && mode === "tree" ? `/api/edge/graph/tree?ticker=${encodeURIComponent(ticker)}` : null);

  // Once a company being built arrives, stop polling for it.
  useEffect(() => { if (data && building) queueMicrotask(() => setBuilding(null)); }, [data, building]);

  // Search: companies already in the graph first, then any listed company.
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return;
    let live = true;
    const t = setTimeout(() => { api<{ results: typeof results }>(`/api/edge/graph/search?q=${encodeURIComponent(text)}`).then((r) => { if (live) setResults(r.results); }).catch(() => undefined); }, 200);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  const open = useCallback((t: string) => { setTicker(t.toUpperCase()); setPick(null); setQ(""); setResults([]); }, []);
  const build = async () => {
    setBuildError(null);
    try { await post("/api/edge/graph/build", { ticker }); setBuilding(ticker); } catch (e) { setBuildError(e instanceof Error ? e.message : String(e)); }
  };
  const onPick = useCallback((p: Prediction | null, graph: Picks["graph"]) => {
    if (!p) { setPick(null); return; }
    const nodes = new Set<number>(p.pathNodes.flat().concat(p.node.id));
    const links = new Set<number>(graph.links.filter((l) => p.pathNodes.some((path) => path.some((n, i) => i > 0 && ((path[i - 1] === l.s && n === l.d) || (path[i - 1] === l.d && n === l.s))))).map((l) => l.id));
    setPick({ id: p.node.id, nodes, links, graph });
    setMode("network");
  }, []);
  const select = useCallback((n: GNode) => { if (n.kind === "company" && n.ticker && n.ticker !== ticker) open(n.ticker); }, [open, ticker]);

  // The drawing: the neighbourhood, plus the chosen prediction's paths.
  const drawn = useMemo(() => {
    if (!sub.data) return null;
    const nodes = new Map<number, GNode>(sub.data.nodes.map((n) => [n.id, n]));
    const links = new Map<number, GEdge>(sub.data.links.map((l) => [l.id, l]));
    if (pick) { for (const n of pick.graph.nodes) if (pick.nodes.has(n.id)) nodes.set(n.id, n); for (const l of pick.graph.links) if (pick.links.has(l.id)) links.set(l.id, l); }
    return { nodes: [...nodes.values()], links: [...links.values()] };
  }, [sub.data, pick]);

  const suggestions = tickers.filter((t) => t !== ticker).slice(0, 6);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <label className="flex items-center gap-1.5 rounded-md border border-line bg-bg px-2 py-1"><Search className="h-3.5 w-3.5 text-muted" /><input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) open(results[0]?.ticker ?? q.trim()); }} placeholder="Company or ticker" className="w-[180px] bg-transparent text-[12.5px] outline-none placeholder:text-faint" aria-label="Find a company" /></label>
          {q.trim().length >= 2 && results.length > 0 && (
            <ul className="absolute left-0 top-full z-20 mt-1 w-[300px] overflow-hidden rounded-md border border-line bg-panel shadow-xl">
              {results.map((r) => <li key={r.ticker}><button type="button" onClick={() => open(r.ticker)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] hover:bg-elevated"><span className="num w-12 shrink-0 text-muted">{r.ticker}</span><span className="min-w-0 flex-1 truncate">{r.name}</span>{r.inGraph && <Network className="h-3 w-3 text-accent" aria-label="In the graph" />}</button></li>)}
            </ul>
          )}
        </div>
        {suggestions.map((t) => <button key={t} type="button" onClick={() => open(t)} className="num rounded-full border border-dashed border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">{t}</button>)}
        <span className="ml-auto text-[11px] text-muted">{status.data ? `${status.data.size.companies.toLocaleString("en-US")} companies, ${status.data.size.links.toLocaleString("en-US")} links from SEC filings${status.data.model ? ` · deal model ${status.data.model.version}` : status.data.latest?.status === "training" ? " · the deal model is training" : ""}` : ""}</span>
      </div>

      {company.error && <p className="text-[12.5px] text-neg">{company.error}</p>}
      {!company.data && !company.error && <div className="h-64 animate-pulse rounded-lg bg-elevated/40" />}

      {missing && (
        <div className="panel flex flex-col items-start gap-2 p-4">
          <div className="text-[13px] font-semibold">{missing.name || missing.ticker} is not in the graph yet</div>
          {missing.listed ? (
            <>
              <p className="text-[12px] text-muted">Edge can read its filings now: its board, officers and insider trades, 5% holders, subsidiaries, named customers and suppliers, and its deals. It takes a minute or two.</p>
              {building === ticker ? <span className="flex items-center gap-1.5 text-[12px] text-accent"><Loader2 className="h-3.5 w-3.5 animate-spin" />Reading {missing.ticker}&apos;s filings…</span>
                : <button type="button" onClick={() => void build()} className="ctl bg-accent px-3 py-1 text-[12.5px] font-semibold text-accent-fg">Build {missing.ticker}&apos;s network</button>}
              {buildError && <p className="text-[12px] text-neg">{buildError}</p>}
            </>
          ) : <p className="text-[12px] text-muted">No SEC filer has that ticker.</p>}
        </div>
      )}

      {data && (
        <>
          <header className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-semibold tracking-tight">{data.node.name} <span className="num text-[13px] font-normal text-muted">{data.node.ticker}</span></h2>
              <p className="text-[11.5px] text-muted">{[data.industry, data.place, data.revenue ? `revenue ${fmtUsd(data.revenue)} (last twelve months)` : ""].filter(Boolean).join(" · ")}</p>
            </div>
            <div className="flex flex-wrap gap-1 text-[10.5px]">
              {([["directors", "directors"], ["officers", "officers"], ["holders", "5% holders"], ["subsidiaries", "subsidiaries"], ["customers", "named customers"], ["deals", "deals"]] as const).map(([k, label]) => data.counts[k] ? <span key={k} className="num rounded-full border border-line px-2 py-0.5 text-muted">{data.counts[k]} {label}</span> : null)}
            </div>
          </header>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
            <div className="min-w-0 space-y-2">
              <div className="flex items-center gap-0.5 self-start rounded-lg border border-line p-0.5" role="tablist" aria-label="View">
                {MODES.map((m) => <button key={m.id} type="button" role="tab" aria-selected={mode === m.id} onClick={() => setMode(m.id)} className={`rounded-md px-3 py-0.5 text-[12px] ${mode === m.id ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{m.label}</button>)}
                {pick && mode === "network" && <button type="button" onClick={() => setPick(null)} className="ml-2 text-[11px] text-accent hover:underline">Clear the highlighted path</button>}
              </div>
              {mode === "network" && (drawn ? <ForceGraph nodes={drawn.nodes} links={drawn.links} focus={data.node.id} highlight={pick ? { nodes: new Set([...pick.nodes, data.node.id]), links: pick.links } : null} onSelect={select} /> : <div className="h-[520px] animate-pulse rounded-lg bg-elevated/40" />)}
              {mode === "map" && (map.data ? <NetMap data={map.data} focus={data.node.id} /> : <div className="h-[520px] animate-pulse rounded-lg bg-elevated/40" />)}
              {mode === "tree" && (tree.data ? <OwnershipTree tree={tree.data} onOpen={open} /> : <div className="h-64 animate-pulse rounded-lg bg-elevated/40" />)}
              <p className="text-[10.5px] text-faint">From SEC EDGAR: Form 4 (insiders), Schedule 13D/13G (5% holders), Exhibit 21 (subsidiaries), the 10-K (named customers and suppliers), merger filings and 8-K Item 2.01 (deals), plus the Newsroom&apos;s deal tracker. People appear only in their public roles.</p>
            </div>
            <Findings key={ticker} ticker={ticker} company={data} onPick={onPick} picked={pick?.id ?? null} onOpen={open} />
          </div>
        </>
      )}
    </div>
  );
}
