"use client";

/**
 * SAT <TICKER>: a company's geospatial signal monitor. A locator map of the sites Edge watches for it
 * (its mapped plants, the curated satellite sites that name it) with the ones that signalled lit, and one
 * row per signal: what kind, where, when observed, the reading, its z-score against the site's own
 * history, the history as a sparkline and a picture of the site. Enter opens the full finding.
 */
import { useMemo, useState } from "react";
import { edgeImageSrc } from "@/lib/edge/imgsrc";
import { networkUrl } from "@/lib/edge/links";
import { useClock } from "@/components/edge/client";
import type { SatSite, SatView } from "@/lib/terminal/edge/sat";
import type { SiteSignal } from "@/lib/terminal/edge-signals";
import { EdgeCardDrill } from "./EdgeCardDrill";
import { big, Chip, DASH, Empty, Fallback, FnLinks, Keys, NavTable, num, shortAgo, SourceStrip, Spark, Stats, Waiting, Z, useEdgeTerminal, type Col, type Run } from "./edge-kit";

const POLL = 120_000;
type Row = SiteSignal & { confidence: number; magnitude: number };
export const SAT_KIND: Record<string, { label: string; color: string }> = {
  flaring: { label: "FLARE", color: "#E8833A" }, crop_vigour: { label: "CROP", color: "#5BAA5B" }, water_extent: { label: "WATER", color: "#3E8ED0" }, vessel_traffic: { label: "SHIPS", color: "#7A7FD6" },
  radar_change: { label: "RADAR", color: "#B07CC6" }, ground_change: { label: "GROUND", color: "#C9A227" }, permits: { label: "PERMIT", color: "#4FB3A9" }, methane_plume: { label: "CH4", color: "#D9534F" },
};

const reading = (r: Row) => (r.value === null ? DASH : r.unit === "NDVI" ? r.value.toFixed(2) : r.unit === "water" ? `${(r.value * 100).toFixed(1)}%` : r.unit === "m²" || r.unit === "kg/h" ? big(r.value) : num(r.value, r.value < 10 ? 1 : 0));

/** A satellite crop through Edge's image cache; a picture that does not load becomes a quiet placeholder, never a broken image. */
function Thumb({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <span className="inline-block h-[22px] w-[34px] rounded-sm border border-dashed border-line align-middle" title={src ? "The picture did not load" : "No picture"} />;
  // eslint-disable-next-line @next/next/no-img-element -- satellite crops through Edge's image cache
  return <img src={edgeImageSrc(src)} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} className="inline-block h-[22px] w-[34px] rounded-sm border border-line object-cover align-middle" />;
}

/** Where the sites are: an equirectangular locator, sites as dots, the ones that signalled in their kind's colour. */
function Locator({ sites, signals, bbox, focus }: { sites: SatSite[]; signals: Row[]; bbox: [number, number, number, number] | null; focus: Row | null }) {
  if (!bbox) return null;
  const W = 260, H = 150, [x0, y0, x1, y1] = bbox;
  const k = Math.cos((((y0 + y1) / 2) * Math.PI) / 180);
  const sx = W / Math.max(1e-6, (x1 - x0) * k), sy = H / Math.max(1e-6, y1 - y0), s = Math.min(sx, sy);
  const ox = (W - (x1 - x0) * k * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const p = (lon: number, lat: number) => [ox + (lon - x0) * k * s, oy + (y1 - lat) * s] as const;
  const lit = new Map<string, Row>();
  for (const r of signals) if (!lit.has(r.site)) lit.set(r.site, r);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0 rounded border border-line bg-bg" role="img" aria-label={`${sites.length} sites, ${lit.size} with signals`}>
      {[0.25, 0.5, 0.75].map((f) => <g key={f} stroke="var(--line)" strokeWidth={0.5}><line x1={W * f} x2={W * f} y1={0} y2={H} /><line y1={H * f} y2={H * f} x1={0} x2={W} /></g>)}
      {sites.map((st) => { const [x, y] = p(st.lon, st.lat); return <circle key={`s-${st.name}`} cx={x} cy={y} r={2} fill="var(--faint)"><title>{st.name}</title></circle>; })}
      {[...lit.values()].map((r) => { const [x, y] = p(r.lon, r.lat); const c = SAT_KIND[r.kind]?.color ?? "var(--accent)"; return <g key={`l-${r.site}`}><circle cx={x} cy={y} r={7} fill={c} opacity={0.18} /><circle cx={x} cy={y} r={3.2} fill={c}><title>{`${r.site}: ${r.title}`}</title></circle></g>; })}
      {focus && (() => { const [x, y] = p(focus.lon, focus.lat); return <g><circle cx={x} cy={y} r={9} fill="none" stroke="var(--accent)" strokeWidth={1.5} /><text x={Math.min(x + 11, W - 4)} y={Math.max(10, y - 6)} fontSize={9} fill="var(--fg)" textAnchor={x > W * 0.6 ? "end" : "start"}>{focus.site}</text></g>; })()}
      <text x={4} y={H - 4} fontSize={8.5} fill="var(--faint)">{`${y0.toFixed(1)}°…${y1.toFixed(1)}°  ${x0.toFixed(1)}°…${x1.toFixed(1)}°`}</text>
    </svg>
  );
}

export function SatScreen({ ticker, onRun }: { ticker: string; onRun: Run }) {
  const q = useEdgeTerminal<SatView>("sat", { ticker }, POLL, !!ticker);
  const now = useClock();
  const [kind, setKind] = useState<string | null>(null);
  const [focus, setFocus] = useState<Row | null>(null);
  const rows = useMemo(() => (q.data?.signals ?? []).filter((r) => !kind || r.kind === kind), [q.data, kind]);
  const cols: Col<Row>[] = useMemo(() => [
    { key: "kind", label: "Kind", align: "left", value: (r) => r.kind, render: (r) => <span className="inline-block w-[46px] rounded-sm px-1 text-center text-[9px] font-bold tracking-wider text-white" style={{ background: SAT_KIND[r.kind]?.color ?? "var(--accent)" }}>{SAT_KIND[r.kind]?.label ?? r.kind}</span> },
    { key: "site", label: "Site", align: "left", value: (r) => r.site, render: (r) => <span className="block max-w-[180px] truncate" title={r.site}>{r.site}</span> },
    { key: "at", label: "Observed", title: "Last observation", value: (r) => r.at, render: (r) => <span title={r.at}>{shortAgo(r.at, now)}</span> },
    { key: "val", label: "Reading", value: (r) => r.value, render: (r) => <span>{reading(r)} <span className="text-[9.5px] text-faint">{r.unit}</span></span> },
    { key: "z", label: "Z", title: "Against this site's own history", value: (r) => (r.z === null ? null : Math.abs(r.z)), render: (r) => <Z z={r.z} /> },
    { key: "hist", label: "History", sortable: false, render: (r) => <Spark values={r.history} w={64} h={16} tone={r.z !== null && Math.abs(r.z) >= 2 ? "warn" : "muted"} label={`${r.site} history`} /> },
    { key: "conf", label: "Conf", title: "Edge's confidence", value: (r) => r.confidence, render: (r) => <span className="text-muted">{Math.round(r.confidence * 100)}</span> },
    { key: "img", label: "Image", sortable: false, align: "center", render: (r) => <Thumb src={r.thumb} alt={`${r.site}, ${r.at.slice(0, 10)}`} /> },
    { key: "title", label: "Finding", align: "left", sortable: false, render: (r) => <span className="block max-w-[320px] truncate text-muted" title={r.title}>{r.title}</span> },
  ], [now]);

  if (!ticker) return <Empty title="Give a ticker">Type <span className="num text-accent">SAT XOM</span> or <span className="num text-accent">XOM SAT</span>.</Empty>;
  if (!q.data) return <Waiting error={q.error} what={`${ticker}'s sites`} />;
  const d = q.data;
  const kinds = [...new Set(d.signals.map((s) => s.kind))];
  const strong = d.signals.filter((s) => s.z !== null && Math.abs(s.z) >= 2).length;
  const newest = d.signals[0]?.at ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <Fallback sources={d.sources} error={q.error} asOf={d.asOf} />
      <div className="flex shrink-0 gap-2 border-b border-line p-2">
        <Locator sites={d.sites} signals={d.signals} bbox={d.bbox} focus={focus} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2"><span className="truncate text-[13px] font-semibold">{d.name}</span><FnLinks ticker={ticker} fns={["ALT", "GEO", "EDGE"]} onRun={onRun} /></div>
          <Stats items={[
            { label: "Signals (1y)", value: d.signals.length },
            { label: "|z| ≥ 2", value: strong, tone: strong ? "text-chart-emphasis" : undefined },
            { label: "Sites watched", value: d.sites.length },
            { label: "Lit sites", value: new Set(d.signals.map((s) => s.site)).size },
            { label: "Newest", value: newest ? shortAgo(newest, now) : DASH, title: newest ?? undefined },
            { label: "Flare pass", value: d.flares?.checkedAt ? shortAgo(d.flares.checkedAt, now) : DASH, tone: d.flares && !d.flares.ok ? "text-chart-emphasis" : undefined },
          ]} />
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Chip active={!kind} onClick={() => setKind(null)}>All {d.signals.length}</Chip>
            {kinds.map((k) => <Chip key={k} active={kind === k} onClick={() => setKind(kind === k ? null : k)}>{SAT_KIND[k]?.label ?? k} {d.signals.filter((s) => s.kind === k).length}</Chip>)}
            <span className="ml-auto"><Keys items={[["↑↓", "move"], ["⏎", "open"], ["1-9", "sort"]]} /></span>
          </div>
        </div>
      </div>
      <NavTable label={`${ticker} geospatial signals`} rows={rows} cols={cols} rowKey={(r) => String(r.id)} initialSort={{ key: "at", desc: true }}
        detail={(r) => <EdgeCardDrill id={r.id} onRun={onRun} />} onCursor={setFocus}
        empty={<Empty title={`No geospatial signals for ${ticker} in the last year`}>
          {d.sites.length ? <>Edge watches {d.sites.length} site{d.sites.length === 1 ? "" : "s"} for {d.name} ({d.sites.slice(0, 3).map((s) => s.name).join(", ")}{d.sites.length > 3 ? "…" : ""}) and has seen no flaring, ground or radar change, permit jump, methane plume or satellite anomaly there.</> : <>None of {d.name}&apos;s sites are on Edge&apos;s map: it covers the Permian&apos;s gas processing plants (EIA) and curated satellite sites (crop belts, reservoirs and brine ponds, LNG terminals).</>}
          {d.suggest.length > 0 && <span className="mt-1 block">With signals now: {d.suggest.map((s) => <button key={s.ticker} type="button" onClick={() => onRun({ ticker: s.ticker, fn: "SAT", via: "click" })} className="num mr-2 text-accent hover:underline">SAT {s.ticker} <span className="text-faint">{s.n}</span></button>)}</span>}
          <span className="mt-1 block"><button type="button" onClick={() => onRun({ ticker: "", fn: "FLR", via: "click" })} className="num text-accent hover:underline">FLR</button> shows every mapped plant&apos;s flaring; <a href={networkUrl(ticker)} target="_blank" rel="noreferrer" className="text-accent hover:underline">watch {ticker} in Edge</a> to have its sites checked daily.</span>
        </Empty>} />
      <SourceStrip sources={d.sources} asOf={d.asOf} pollMs={POLL}>
        {d.trail.length > 0 && <span className="text-faint" title={d.trail.map((t) => `${t.name} (${t.license}), read ${t.retrievedAt.slice(0, 10)}`).join("\n")}>trail: {d.trail.slice(0, 4).map((t) => t.name).join(" · ")}</span>}
      </SourceStrip>
    </div>
  );
}
