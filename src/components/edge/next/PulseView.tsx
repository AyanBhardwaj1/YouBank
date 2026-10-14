"use client";

/**
 * Pulse (E3, the Alt-Data Pulse): a company's free alternative data as series. On a desktop, small
 * multiples (one chart per metric, the weeks a change was flagged shaded, dated awards and WARN notices on
 * the axis), the tells list, where the company hires, a peer comparison and a coverage badge that says
 * which sources answered. On a phone, a stack of sparklines with the latest value and change; a tap opens
 * the full chart. Every change states its probability and the detector's false-alarm rate.
 */
import { ChevronDown, ChevronUp, Loader2, RefreshCw, Search } from "lucide-react";
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { errorMessage } from "@/lib/client/errors";
import { TELL_LABEL, type Tell } from "@/lib/edge/series/metrics";
import { post, useApi } from "../client";
import { SeriesChart, Sparkline } from "./charts";

type Verdict = { prob: number; z: number; move: number; seasonal: boolean; alarm: boolean } | null;
type Series = { metric: string; label: string; unit: string; cadence: string; source: string; points: { period: string; value: number }[]; verdict: Verdict; flagged: string[]; falseAlarms: string };
type PulseData = {
  nodeId: number; name: string; ticker: string; refreshedAt: string | null; coverageText: string; historySince: string | null;
  series: Series[]; tells: { tell: Tell; title: string; location: string; firstSeen: string; url: string }[]; metros: { metro: string; open: number }[];
  events: { date: string; label: string; kind: string; url?: string }[]; findings: { id: number; kind: string; title: string; summary: string; observedAt: string | null; confidence: number }[];
  daily: { list: string[]; allowed: boolean; limit: number };
};

const fmt = (v: number) => (Math.abs(v) >= 1e9 ? `${(v / 1e9).toFixed(1)}bn` : Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : Math.abs(v) >= 1e4 ? `${Math.round(v / 1e3)}k` : v.toLocaleString("en-US", { maximumFractionDigits: 1 }));
const moveText = (v: Verdict) => (v && Number.isFinite(v.move) ? `${v.move >= 0 ? "+" : ""}${Math.round(v.move * 100)}% over six ${"periods"}` : "");
/** Primary series first: open postings, attention, awards, patents, then departments and tells. */
const ORDER = (m: string) => (m === "jobs.open" ? 0 : m === "jobs.new" ? 1 : m === "wiki.views" ? 2 : m.startsWith("usasp") ? 3 : m.startsWith("patents") ? 4 : m.startsWith("warn") ? 5 : m.startsWith("jobs.tell") ? 6 : 7);

function ChangeLine({ s }: { s: Series }) {
  if (!s.verdict) return <p className="text-[10.5px] text-faint">{s.points.length} {s.cadence === "monthly" ? "months" : "weeks"} so far; change detection starts at 12.</p>;
  return <p className={`text-[10.5px] ${s.verdict.alarm ? "text-accent" : "text-muted"}`}>Change probability {s.verdict.prob.toFixed(2)}{moveText(s.verdict) ? ` · ${moveText(s.verdict).replace("periods", s.cadence === "monthly" ? "months" : "weeks")}` : ""}{s.verdict.alarm ? " · flagged" : ""}{s.falseAlarms ? `. ${s.falseAlarms}` : ""}</p>;
}

function PhoneRow({ s, marks }: { s: Series; marks: { date: string; label: string }[] }) {
  const [open, setOpen] = useState(false);
  const last = s.points[s.points.length - 1];
  return (
    <li className="border-b border-line/60 py-2 last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-medium">{s.label}</span><span className="num text-[11px] text-muted">{last ? fmt(last.value) : "—"} {s.unit}{s.verdict && Number.isFinite(s.verdict.move) ? ` · ${s.verdict.move >= 0 ? "+" : ""}${Math.round(s.verdict.move * 100)}%` : ""}</span></span>
        <Sparkline values={s.points.slice(-26).map((p) => p.value)} width={88} label={s.label} tone={s.verdict?.alarm ? "accent" : "muted"} />
        {open ? <ChevronUp className="h-4 w-4 text-muted" /> : <ChevronDown className="h-4 w-4 text-muted" />}
      </button>
      {open && <div className="mt-2"><SeriesChart points={s.points} flagged={s.flagged} marks={marks} label={s.label} unit={s.unit} height={140} /><ChangeLine s={s} /><p className="text-[10px] text-faint">{s.source}</p></div>}
    </li>
  );
}

/** Peers' open postings indexed to 100 at the first common week, against the company's own. */
function Peers({ ticker }: { ticker: string }) {
  const [input, setInput] = useState("");
  const [peers, setPeers] = useState<string[]>([]);
  const own = useApi<PulseData>(`/api/edge/pulse?ticker=${ticker}`);
  const others = [useApi<PulseData>(peers[0] ? `/api/edge/pulse?ticker=${peers[0]}` : null), useApi<PulseData>(peers[1] ? `/api/edge/pulse?ticker=${peers[1]}` : null), useApi<PulseData>(peers[2] ? `/api/edge/pulse?ticker=${peers[2]}` : null)];
  const lines = [own.data, ...others.map((o) => o.data)].filter((d): d is PulseData => !!d).map((d) => ({ name: d.ticker || d.name, pts: d.series.find((s) => s.metric === "jobs.open")?.points ?? [] })).filter((l) => l.pts.length > 1);
  const start = lines.length ? lines.map((l) => l.pts[0].period).sort().pop()! : "";
  const idx = lines.map((l) => { const pts = l.pts.filter((p) => p.period >= start); const b = pts[0]?.value || 1; return { name: l.name, v: pts.map((p) => (p.value / b) * 100) }; });
  const max = Math.max(110, ...idx.flatMap((l) => l.v)), min = Math.min(90, ...idx.flatMap((l) => l.v)), n = Math.max(2, ...idx.map((l) => l.v.length));
  const colors = ["var(--accent)", "var(--info)", "var(--pos)", "var(--muted)"];
  return (
    <section className="panel p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-[12.5px] font-semibold">Compare open postings with peers</h3>
        <form onSubmit={(e) => { e.preventDefault(); setPeers(input.toUpperCase().split(/[\s,]+/).filter(Boolean).slice(0, 3)); }} className="flex gap-1"><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Up to 3 tickers" className="ctl w-36 border border-line bg-transparent px-2 py-1 text-[12px] outline-none" aria-label="Peer tickers" /><button type="submit" className="ctl border border-line px-2 py-1 text-[12px] text-muted hover:text-fg">Compare</button></form></div>
      {idx.length > 1 ? (
        <svg viewBox="0 0 300 100" className="mt-2 h-32 w-full" role="img" aria-label={`Open postings indexed to 100: ${idx.map((l) => `${l.name} ${Math.round(l.v[l.v.length - 1])}`).join(", ")}`}>
          {idx.map((l, i) => <polyline key={l.name} points={l.v.map((y, j) => `${(j / (n - 1)) * 300},${100 - ((y - min) / (max - min)) * 96 - 2}`).join(" ")} fill="none" stroke={colors[i]} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />)}
        </svg>
      ) : <p className="mt-2 text-[11.5px] text-muted">Add peers that have job boards to compare (indexed to 100 at the first week all share).</p>}
      {idx.length > 1 && <div className="mt-1 flex flex-wrap gap-3 text-[11px]">{idx.map((l, i) => <span key={l.name} className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded" style={{ background: colors[i] }} />{l.name} {Math.round(l.v[l.v.length - 1])}</span>)}</div>}
    </section>
  );
}

export function PulseView({ tickers, initial }: { tickers: string[]; initial?: string | null }) {
  const [ticker, setTicker] = useState((initial ?? tickers[0] ?? "").toUpperCase());
  const [input, setInput] = useState(ticker);
  const { data, error, reload } = useApi<PulseData>(ticker ? `/api/edge/pulse?ticker=${ticker}` : null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [actErr, setActErr] = useState<unknown>(null);
  const refresh = async () => {
    setBusy(true); setNote(null); setActErr(null);
    try { const r = await post<{ coverage: string; points: number; findings: number }>("/api/edge/pulse", { action: "refresh", ticker }); setNote(`${r.points} points stored, ${r.findings} new finding${r.findings === 1 ? "" : "s"}. ${r.coverage}.`); reload(); }
    catch (e) { setActErr(e instanceof Error ? e : new Error(errorMessage(e))); } finally { setBusy(false); }
  };
  const toggleDaily = async () => {
    if (!data) return;
    const on = data.daily.list.includes(ticker);
    setActErr(null);
    try { await post("/api/edge/pulse", { action: "daily", tickers: on ? data.daily.list.filter((t) => t !== ticker) : [...data.daily.list, ticker] }); reload(); }
    catch (e) { setActErr(e instanceof Error ? e : new Error(errorMessage(e))); }
  };
  const series = [...(data?.series ?? [])].filter((s) => s.points.length).sort((a, b) => ORDER(a.metric) - ORDER(b.metric) || a.metric.localeCompare(b.metric));
  const marks = (data?.events ?? []).map((e) => ({ date: e.date, label: e.label }));
  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <form onSubmit={(e) => { e.preventDefault(); if (input.trim()) setTicker(input.trim().toUpperCase()); }} className="flex min-w-0 flex-1 gap-1.5">
          <label className="ctl flex min-w-0 flex-1 items-center gap-1.5 border border-line px-2 py-1.5"><Search className="h-3.5 w-3.5 text-muted" /><input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ticker" className="min-w-0 flex-1 bg-transparent text-[12.5px] uppercase outline-none" aria-label="Company ticker" /></label>
          <button type="submit" className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg">Show</button>
        </form>
        <div className="flex flex-wrap gap-1">{tickers.slice(0, 6).map((t) => <button key={t} type="button" onClick={() => { setTicker(t); setInput(t); }} className={`rounded-full border px-2 py-0.5 text-[11.5px] ${t === ticker ? "border-accent/60 bg-accent-soft" : "border-line text-muted hover:text-fg"}`}>{t}</button>)}</div>
      </div>
      {!ticker && <p className="panel px-3 py-3 text-[12.5px] text-muted">Pick a company to see its hiring, attention, federal awards, layoff notices and patents.</p>}
      {error && <p className="panel px-3 py-2 text-[12px] text-neg">The Pulse did not load: {error}</p>}
      {ticker && !data && !error && <div className="panel h-[360px] p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-[280px] rounded-lg" /></div>}
      {data && (
        <>
          <div className="panel flex flex-wrap items-center gap-x-3 gap-y-1.5 p-3 text-[12px]">
            <span className="text-[14px] font-semibold">{data.name}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted" title="Which sources answered">{data.coverageText}</span>
            <span className="text-[11px] text-muted">{data.refreshedAt ? `Read ${data.refreshedAt.slice(0, 10)}` : "Not read yet"}{data.historySince ? ` · job history since ${data.historySince}` : ""}</span>
            <span className="ml-auto flex flex-wrap gap-1.5">
              <button type="button" disabled={busy} onClick={() => void refresh()} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Read the sources now</button>
              <button type="button" onClick={() => void toggleDaily()} disabled={!data.daily.allowed} title={data.daily.allowed ? `Refreshed every day instead of every week (up to ${data.daily.limit} companies)` : "Daily refresh is part of a paid plan"} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-60">{data.daily.list.includes(ticker) ? "Daily: on" : "Refresh daily"} <PremiumBadge feature="edge.pulse-daily" /></button>
            </span>
            {note && <p className="w-full text-[11.5px] text-muted">{note}</p>}
            {actErr ? <PlanNotice error={actErr} className="w-full" /> : null}
          </div>
          {!series.length && <p className="panel px-3 py-3 text-[12.5px] text-muted">No signals stored yet. Read the sources now: Edge first finds the company&apos;s job boards, Wikipedia article, federal recipient id and patent assignee.</p>}
          {/* Desktop: small multiples. */}
          <div className="hidden gap-3 md:grid md:grid-cols-2 xl:grid-cols-3">
            {series.map((s) => (
              <section key={s.metric} className={`panel p-3 ${s.verdict?.alarm ? "border-accent/50" : ""}`}>
                <div className="flex items-baseline justify-between gap-2"><h3 className="truncate text-[12.5px] font-semibold" title={s.label}>{s.label}</h3><span className="num text-[11px] text-muted">{fmt(s.points[s.points.length - 1].value)}</span></div>
                <div className="mt-1.5"><SeriesChart points={s.points} flagged={s.flagged} marks={marks} label={s.label} unit={s.unit} height={110} /></div>
                <ChangeLine s={s} />
                <p className="text-[10px] text-faint">{s.source} · {s.cadence}</p>
              </section>
            ))}
          </div>
          {/* Phone: sparklines that open. */}
          {series.length > 0 && <ul className="panel px-3 md:hidden">{series.map((s) => <PhoneRow key={s.metric} s={s} marks={marks} />)}</ul>}
          <div className="grid gap-3 lg:grid-cols-2">
            <section className="panel p-3">
              <h3 className="text-[12.5px] font-semibold">Tells</h3>
              <p className="text-[11px] text-muted">Postings that come before announcements: IPO readiness (private companies only), integration, corporate development, restructuring, new metros, plant build-outs.</p>
              {data.tells.length ? <ul className="mt-2 divide-y divide-line/60 text-[12px]">{data.tells.map((t, i) => <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-2 py-1.5"><a href={t.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:text-info">{t.title}</a><span className="rounded-full bg-accent-soft px-1.5 text-[10.5px] text-accent">{TELL_LABEL[t.tell] ?? t.tell}</span><span className="num w-full text-[10.5px] text-muted sm:w-auto">{t.location || "—"} · first seen {t.firstSeen}</span></li>)}</ul> : <p className="mt-2 text-[11.5px] text-muted">No tells among the open postings.</p>}
            </section>
            <section className="panel p-3">
              <h3 className="text-[12.5px] font-semibold">Where they hire</h3>
              {data.metros.length ? <ul className="mt-2 space-y-1 text-[12px]">{data.metros.map((m) => <li key={m.metro} className="grid grid-cols-[minmax(0,1fr)_120px_32px] items-center gap-2"><span className="truncate capitalize">{m.metro}</span><span className="h-1.5 overflow-hidden rounded-full bg-line"><span className="block h-full rounded-full bg-accent" style={{ width: `${(m.open / Math.max(1, data.metros[0].open)) * 100}%` }} /></span><span className="num text-right text-muted">{m.open}</span></li>)}</ul> : <p className="mt-2 text-[11.5px] text-muted">No job board read yet.</p>}
              {data.events.length > 0 && <><h3 className="mt-3 text-[12.5px] font-semibold">Events</h3><ul className="mt-1 space-y-1 text-[11.5px]">{data.events.slice(0, 8).map((e, i) => <li key={i}><span className="num text-muted">{e.date}</span> {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-info">{e.label}</a> : e.label}</li>)}</ul></>}
            </section>
          </div>
          {data.ticker && <Peers ticker={data.ticker} />}
          <p className="px-1 text-[10.5px] text-faint">Sources: public job-board APIs (counts and titles only, linked back), Wikimedia pageviews (CC0), USAspending.gov (public domain), state WARN notices (public records), USPTO PatentsView (CC BY 4.0). Workday and SuccessFactors boards are not read, so large companies can have thin hiring coverage.</p>
        </>
      )}
    </div>
  );
}
