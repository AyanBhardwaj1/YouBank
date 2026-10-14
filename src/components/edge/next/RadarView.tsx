"use client";

/**
 * Deal Radar (E4): a calibrated model probability that a company announces an agreement to be acquired in
 * the next 12 months, beside its sector's base rate, with its reasons and a public track record. The board
 * has tabs for your watches, the week's movers and (premium) the screener; each row shows a probability bar
 * with its interval whisker and a tick at the base rate, a 26-week sparkline and the top three reasons. A
 * company's page shows the odds over time with dated filings, the contributions as a waterfall, what would
 * move it, likely buyers from the deal model, and the model's reliability diagram and scorecard. On a phone
 * rows become cards and the company page opens as a sheet. Never a tip: every number is a model probability.
 */
import { ExternalLink, Lock, Search } from "lucide-react";
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Sheet } from "@/components/ui/Sheet";
import { usePhone } from "@/components/ui/useMedia";
import { onTabKeys, tabProps } from "../tabs";
import { useApi } from "../client";
import { pct, ProbBar, ReliabilityDiagram, SeriesChart, Sparkline } from "./charts";

type Reason = { key: string; label: string; direction: "up" | "down"; contrib: number; url?: string; date?: string };
type Row = { nodeId: number; ticker: string; name: string; sector: string; p: number; low: number | null; high: number | null; base: number; rise: number | null; reasons: Reason[]; history: number[] };
type Board = { rows: Row[]; version: string | null; disclaimer: string };
type Bin = { lo: number; hi: number; n: number; meanP: number; rate: number; low: number; high: number };
type Company = { covered: false; error: string; scorecard: { text: string; bins: Bin[] } | null } | {
  covered: true; ticker: string; name: string; sector: string; p: number; low: number | null; high: number | null; base: number; reasons: Reason[]; contribs: Reason[];
  moves: { key: string; label: string; to: number }[]; history: { period: string; value: number }[]; buyers: { name: string; ticker: string; score: number }[];
  version: string; engine: string; scorecard: string; scorecardFull: { bins: Bin[] } | null; calibration: string; disclaimer: string; trainedThrough: string;
  track: { n: number; verdict: string; bins: Bin[] } | null;
};

const SECTOR_LABEL: Record<string, string> = { energy: "Energy", tech: "Technology", health: "Healthcare", other: "Other" };

function Reasons({ list, max = 3 }: { list: Reason[]; max?: number }) {
  return <div className="flex flex-wrap gap-1">{list.slice(0, max).map((r) => {
    const chip = <span className={`rounded-full border px-1.5 py-px text-[10.5px] ${r.direction === "up" ? "border-accent/50 text-fg" : "border-line text-muted"}`}>{r.direction === "up" ? "▲" : "▼"} {r.label}{r.date ? ` · ${r.date.slice(0, 7)}` : ""}</span>;
    return r.url ? <a key={r.key} href={r.url} target="_blank" rel="noreferrer">{chip}</a> : <span key={r.key}>{chip}</span>;
  })}</div>;
}

function BoardTable({ rows, onOpen }: { rows: Row[]; onOpen: (t: string) => void }) {
  const max = Math.max(0.3, ...rows.map((r) => (r.high ?? r.p) * 1.1));
  return (
    <>
      <div className="panel table-scroll hidden overflow-auto md:block">
        <table className="w-full text-[12px]">
          <thead className="bg-panel text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1.5 pl-3 text-left font-normal">Company</th><th className="w-[220px] py-1.5 text-left font-normal">12-month odds (interval, base-rate tick)</th><th className="py-1.5 text-right font-normal">Week</th><th className="py-1.5 pl-3 text-left font-normal">26 weeks</th><th className="py-1.5 pl-3 pr-3 text-left font-normal">Top reasons</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.nodeId} onClick={() => onOpen(r.ticker)} className="cursor-pointer border-b border-line/50 hover:bg-elevated/70">
              <td className="py-1.5 pl-3"><span className="font-semibold">{r.ticker}</span> <span className="text-muted">{r.name}</span><div className="text-[10px] text-faint">{SECTOR_LABEL[r.sector] ?? r.sector}</div></td>
              <td className="py-1.5"><div className="flex items-center gap-2"><span className="num w-11 text-right font-semibold">{pct(r.p, 1)}</span><div className="flex-1"><ProbBar p={r.p} low={r.low} high={r.high} base={r.base} max={max} /></div></div></td>
              <td className="num py-1.5 text-right">{r.rise !== null ? `${r.rise >= 0 ? "+" : ""}${(r.rise * 100).toFixed(1)}` : "—"}</td>
              <td className="py-1.5 pl-3"><Sparkline values={r.history} width={90} label={`${r.ticker} odds`} /></td>
              <td className="py-1.5 pl-3 pr-3"><Reasons list={r.reasons} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">{rows.map((r) => (
        <li key={r.nodeId}><button type="button" onClick={() => onOpen(r.ticker)} className="panel w-full p-3 text-left">
          <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[13px] font-semibold">{r.ticker} <span className="font-normal text-muted">{r.name}</span></span><span className="num text-[15px] font-semibold">{pct(r.p, 1)}</span></div>
          <div className="mt-1.5"><ProbBar p={r.p} low={r.low} high={r.high} base={r.base} max={max} /></div>
          <div className="mt-1.5 text-[11px] text-muted">base rate {pct(r.base, 1)}{r.reasons[0] ? ` · ${r.reasons[0].direction === "up" ? "▲" : "▼"} ${r.reasons[0].label}` : ""}</div>
        </button></li>
      ))}</ul>
    </>
  );
}

function Waterfall({ list }: { list: Reason[] }) {
  if (!list.length) return null;
  const max = Math.max(...list.map((r) => Math.abs(r.contrib)), 1e-6);
  return (
    <ul className="space-y-1 text-[11.5px]" aria-label="What pushes the odds up or down (log-odds contributions)">
      {list.map((r) => (
        <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-2">
          <span className="truncate text-right text-muted" title={r.label}>{r.label}</span>
          <span className="relative h-3">
            <span className="absolute inset-y-0 left-1/2 w-px bg-line" />
            <span className={`absolute inset-y-0.5 rounded ${r.direction === "up" ? "bg-accent" : "bg-info"}`} style={r.direction === "up" ? { left: "50%", width: `${(Math.abs(r.contrib) / max) * 50}%` } : { right: "50%", width: `${(Math.abs(r.contrib) / max) * 50}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function CompanyPage({ ticker }: { ticker: string }) {
  const { data, error } = useApi<Company>(`/api/edge/odds?ticker=${ticker}`);
  if (error) return <p className="p-3 text-[12px] text-neg">Deal Radar did not load: {error}</p>;
  if (!data) return <div className="p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-40 rounded" /></div>;
  if (!data.covered) return <div className="space-y-2 p-1 text-[12.5px]"><p className="text-muted">{data.error}</p>{data.scorecard && <p className="text-[11.5px] text-muted">{data.scorecard.text}</p>}</div>;
  const marks = data.reasons.filter((r) => r.date).map((r) => ({ date: r.date!, label: r.label }));
  return (
    <div className="space-y-3">
      <header>
        <h3 className="text-[15px] font-semibold tracking-tight">{data.name} <span className="text-[12px] font-normal text-muted">{data.ticker}</span></h3>
        <p className="mt-1 text-[12px] text-muted">Model probability of an announced agreement to be acquired within 12 months</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3"><span className="num text-[26px] font-semibold">{pct(data.p, 1)}</span><span className="text-[12px] text-muted">interval {pct(data.low, 1)} to {pct(data.high, 1)} · sector base rate {pct(data.base, 1)} · {(data.p / Math.max(1e-6, data.base)).toFixed(1)}x</span></div>
        <div className="mt-2"><ProbBar p={data.p} low={data.low} high={data.high} base={data.base} max={Math.max(0.3, (data.high ?? data.p) * 1.3)} /></div>
        <p className="mt-2 rounded-md border-l-2 border-accent bg-accent-soft/40 px-2.5 py-1.5 text-[11.5px]">{data.disclaimer}</p>
      </header>
      <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Odds over time</h4><SeriesChart points={data.history} marks={marks} label="12-month sale odds" unit="probability" height={120} /></section>
      <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Why: what pushes the odds up or down</h4><Waterfall list={data.contribs} /><div className="mt-1.5"><Reasons list={data.reasons} /></div></section>
      {data.moves.length > 0 && <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">What would move it</h4><ul className="space-y-0.5 text-[12px]">{data.moves.map((m) => <li key={m.key} className="flex justify-between gap-2"><span>{m.label}</span><span className="num text-muted">to {pct(m.to, 1)}</span></li>)}</ul></section>}
      {data.buyers.length > 0 && <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Likely buyers (deal model)</h4><div className="flex flex-wrap gap-1.5 text-[12px]">{data.buyers.map((b) => <a key={b.name} href={`/app/edge?company=${b.ticker || ""}`} className="rounded-full border border-line px-2 py-0.5 hover:border-accent/50">{b.ticker || b.name}</a>)}</div><p className="mt-1 text-[10.5px] text-faint">A ranking from the relationship graph, not a forecast; open Networks for the paths.</p></section>}
      <section className="grid gap-3 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div><ReliabilityDiagram bins={data.scorecardFull?.bins ?? []} label="Out-of-time reliability" /></div>
        <div className="space-y-1.5 text-[11.5px] text-muted"><p>{data.scorecard}</p><p>{data.calibration}</p><p>Model {data.version} ({data.engine === "lightgbm" ? "LightGBM hazard model" : "logistic hazard model"}), trained on months through {data.trainedThrough}.</p>
          {data.track && <p className="text-fg">Track record so far: {data.track.verdict} <a href="/app/edge?view=track" className="text-info hover:underline">Track record</a></p>}</div>
      </section>
    </div>
  );
}

type Tab = "watched" | "movers" | "screen";

export function RadarView({ tickers, initial }: { tickers: string[]; initial?: string | null }) {
  const phone = usePhone();
  const [tab, setTab] = useState<Tab>("watched");
  const [open, setOpen] = useState<string | null>(initial ?? null);
  const [sector, setSector] = useState(""), [min, setMin] = useState("");
  const [find, setFind] = useState("");
  const url = tab === "screen" ? `/api/edge/odds/board?scope=screen${sector ? `&sector=${sector}` : ""}${min ? `&min=${Number(min) / 100}` : ""}` : `/api/edge/odds/board?scope=${tab}`;
  const { data, error } = useApi<Board>(url);
  const locked = !!error && /plan/i.test(error);
  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3 text-[12.5px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" role="tablist" aria-label="Deal Radar board" onKeyDown={onTabKeys}>
            {(["watched", "movers", "screen"] as Tab[]).map((t) => <button key={t} type="button" {...tabProps(tab === t)} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 text-[12px] ${tab === t ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{t === "watched" ? "Your watches" : t === "movers" ? "The week's movers" : <span className="inline-flex items-center gap-1">Screener <PremiumBadge feature="edge.odds-screener" /></span>}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (find.trim()) setOpen(find.trim().toUpperCase()); }} className="flex gap-1"><label className="ctl flex items-center gap-1 border border-line px-2 py-1"><Search className="h-3.5 w-3.5 text-muted" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Ticker" className="w-24 bg-transparent uppercase outline-none" aria-label="Company ticker" /></label><button type="submit" className="ctl border border-line px-2 py-1 text-muted hover:text-fg">Open</button></form>
        </div>
        {tab === "screen" && !locked && (
          <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
            <select value={sector} onChange={(e) => setSector(e.target.value)} className="ctl border border-line bg-transparent px-2 py-1" aria-label="Sector"><option value="">Every sector</option><option value="energy">Energy</option><option value="tech">Technology</option><option value="health">Healthcare</option></select>
            <label className="flex items-center gap-1">At least <input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} className="ctl w-14 border border-line bg-transparent px-1.5 py-1" inputMode="decimal" aria-label="Minimum odds in percent" />%</label>
            <a href={`${url}&format=csv`} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1 text-muted hover:text-fg">Export CSV <ExternalLink className="h-3 w-3" /></a>
          </div>
        )}
        <p className="text-[11px] text-muted">A statistical estimate from public filings, not a rumour or advice. Each probability sits beside its sector&apos;s base rate, is logged when made and scored when its window closes.</p>
      </div>
      {locked && <div className="panel p-3"><PlanNotice error={new Error(error!)} /><p className="mt-1 flex items-center gap-1 text-[11.5px] text-muted"><Lock className="h-3.5 w-3.5" />The screener filters and exports every company the Radar scores.</p></div>}
      {error && !locked && <p className="panel px-3 py-2 text-[12px] text-neg">The board did not load: {error}</p>}
      {data && !data.rows.length && <p className="panel px-3 py-3 text-[12.5px] text-muted">{tab === "watched" ? (tickers.length ? "None of your watched companies is scored yet (this round covers energy, technology and healthcare)." : "Watch companies to see their odds here.") : "No scores yet: the Deal Radar scores the universe after its first training run."}</p>}
      <div className={`grid gap-3 ${open && !phone ? "lg:grid-cols-[minmax(0,1fr)_440px]" : ""}`}>
        <div className="min-w-0">{data && data.rows.length > 0 && <BoardTable rows={data.rows} onOpen={setOpen} />}{data?.version && <p className="mt-1 px-1 text-[10.5px] text-faint">Model {data.version}</p>}</div>
        {open && !phone && <aside className="panel max-h-[85vh] overflow-auto p-3.5"><div className="mb-2 flex justify-end"><button type="button" onClick={() => setOpen(null)} className="text-[11.5px] text-muted hover:text-fg">Close</button></div><CompanyPage ticker={open} /></aside>}
      </div>
      {phone && <Sheet open={!!open} onClose={() => setOpen(null)} size="full" label="Deal Radar company">{open && <CompanyPage ticker={open} />}</Sheet>}
    </div>
  );
}
