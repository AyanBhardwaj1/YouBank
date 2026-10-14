"use client";

/**
 * Call Desk (E5): earnings calls read question by question. A call's page shows the Q&A as a strip, one
 * segment per question coloured by its probability of a fully evasive answer; a segment opens the question
 * and the answer side by side with the dodging phrase highlighted, its class probabilities and the reasons,
 * and for a recording a "play from the question" control. Beside it: the call's evasion rate with its
 * interval against the company's last calls, what was avoided, and the promises the call made. The Promises
 * tab is the company's ledger with status chips and the hit rate; Compare peers (premium) sets up to six
 * companies side by side. On a phone the strip becomes a list of question cards with previous and next.
 * Never "lies": an answer either addressed the question asked or did not.
 */
import { ChevronLeft, ChevronRight, ExternalLink, Loader2, Mic, Play, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Sheet } from "@/components/ui/Sheet";
import { usePhone } from "@/components/ui/useMedia";
import { errorMessage } from "@/lib/client/errors";
import { onTabKeys, tabProps } from "../tabs";
import { post, useApi } from "../client";
import { pct } from "./charts";

type Cls = "direct" | "intermediate" | "evasive";
type Pair = { n: number; analyst: string; firm: string; question: string; answer: string; answerers: string[]; t?: number; followUp: boolean; clear: boolean; topic: string; p?: Record<Cls, number>; cls?: Cls; tags?: string[]; quote?: string; reasons?: string[] };
type Promise = { id?: number; metric: string; label: string; low: number | null; high: number | null; unit: string; op: string; period: { fy: number; q?: number } | null; quote: string; mapped: boolean; why: string; status: string; p?: number; closesAt?: string; reported?: number | null; missPct?: number; said?: string };
type Call = {
  read: true; docId: number; title: string; ticker: string; name: string; said: string; media: boolean; url: string; raw: string | null; pairs: Pair[];
  summary: { n: number; scored: number; mean: number; low: number; high: number } | null; comparison: { calls: number; prob: number; rose: boolean; sentence: string; before: { mean: number } } | null;
  avoided: { topic: string; n: number; p: number }[]; commitments: Promise[]; engine: string; classifier: { version: string; scorecard: string }; eva: { asked: boolean; used: boolean; note: string }; disclaimer: string; note?: string;
};
type ListRow = { id: number; title: string; source: string; mime: string; status: string; ticker: string; form: string; filed: string; createdAt: string; summary: { mean: number; low: number; high: number; scored: number } | null; rose: number | null; promises: number; read: boolean };

const CLS_LABEL: Record<Cls, string> = { direct: "Direct", intermediate: "Partial", evasive: "Did not answer" };
const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "border-line text-muted" }, hit: { label: "Hit", cls: "border-pos/50 text-pos" }, missed_low: { label: "Missed low", cls: "border-neg/50 text-neg" }, missed_high: { label: "Above range", cls: "border-info/50 text-info" },
  raised: { label: "Raised later", cls: "border-info/50 text-info" }, lowered: { label: "Lowered later", cls: "border-neg/40 text-neg" }, withdrawn: { label: "Withdrawn", cls: "border-neg/40 text-neg" },
  unresolved: { label: "Not reported", cls: "border-line text-faint" }, unmapped: { label: "Not scored", cls: "border-line text-faint" },
};
const tone = (p: number) => `color-mix(in oklab, var(--color-neg) ${Math.round(p * 100)}%, var(--color-pos))`;
const clock = (s?: number) => (s === undefined ? "" : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`);
const fmtVal = (v: number | null, unit: string) => (v === null ? "—" : unit === "usd_per_share" ? `$${v.toFixed(2)}` : unit === "pct_growth" ? `${(v * 100).toFixed(1)}%` : unit === "per_day" ? `${Math.round(v).toLocaleString("en-US")}/d` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}bn` : `$${(v / 1e6).toFixed(0)}m`);
const periodText = (p: Promise["period"]) => (p ? (p.q ? `Q${p.q} FY${p.fy}` : `FY${p.fy}`) : "—");

function Highlight({ text, quote }: { text: string; quote?: string }) {
  if (!quote || !text.includes(quote)) return <>{text}</>;
  const i = text.indexOf(quote);
  return <>{text.slice(0, i)}<mark className="rounded bg-neg/15 px-0.5 text-fg">{quote}</mark>{text.slice(i + quote.length)}</>;
}

function Probs({ p }: { p: Record<Cls, number> }) {
  return <div className="flex flex-wrap gap-1 text-[10.5px]">{(["direct", "intermediate", "evasive"] as Cls[]).map((c) => <span key={c} className="num rounded-full border border-line px-1.5 py-px">{CLS_LABEL[c]} {pct(p[c])}</span>)}</div>;
}

function PairDetail({ pair, onPlay }: { pair: Pair; onPlay?: (t: number) => void }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px] text-muted">
        <span><span className="font-semibold text-fg">Q{pair.n}</span> · {pair.analyst}{pair.firm ? `, ${pair.firm}` : ""}{pair.followUp ? " · follow-up" : ""} · {pair.topic}</span>
        {pair.t !== undefined && onPlay && <button type="button" onClick={() => onPlay(pair.t!)} className="inline-flex items-center gap-1 text-info hover:underline"><Play className="h-3 w-3" /> Play from {clock(pair.t)}</button>}
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <section className="rounded-lg border border-line bg-elevated/40 p-2.5"><h5 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Question</h5><p className="text-[12.5px] leading-relaxed">{pair.question}</p></section>
        <section className="rounded-lg border border-line bg-elevated/40 p-2.5"><h5 className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted">Answer{pair.answerers.length ? ` · ${pair.answerers.join(", ")}` : ""}</h5><p className="text-[12.5px] leading-relaxed"><Highlight text={pair.answer} quote={pair.quote} /></p></section>
      </div>
      {pair.p ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2"><span className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white" style={{ background: tone(pair.p.evasive + pair.p.intermediate / 2) }}>{CLS_LABEL[pair.cls ?? "direct"]}</span><Probs p={pair.p} /></div>
          {pair.reasons?.length ? <p className="text-[11.5px] text-muted">Why: {pair.reasons.join("; ")}.</p> : null}
        </div>
      ) : <p className="text-[11.5px] text-faint">Not scored: who asked or who answered is not clear in this transcript.</p>}
    </div>
  );
}

function Promises({ rows }: { rows: Promise[] }) {
  if (!rows.length) return <p className="text-[12px] text-muted">No quantified promises found.</p>;
  return (
    <>
      <div className="table-scroll hidden overflow-auto md:block">
        <table className="w-full text-[11.5px]">
          <thead className="text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">Promise</th><th className="text-left font-normal">Period</th><th className="text-right font-normal">Range</th><th className="text-right font-normal">Reported</th><th className="pl-2 text-left font-normal">Status</th><th className="text-right font-normal">P(hit)</th></tr></thead>
          <tbody>{rows.map((r, i) => (
            <tr key={r.id ?? `u${i}`} className="border-b border-line/50 align-top">
              <td className="max-w-[360px] py-1 pr-2"><div className="font-semibold">{r.label}</div><div className="text-[10.5px] text-muted" title={r.quote}>&ldquo;{r.quote.slice(0, 160)}{r.quote.length > 160 ? "…" : ""}&rdquo;</div>{!r.mapped && <div className="text-[10px] text-faint">{r.why}</div>}</td>
              <td className="py-1">{periodText(r.period)}</td>
              <td className="num py-1 text-right">{r.op === ">=" ? `≥ ${fmtVal(r.low, r.unit)}` : r.op === "<=" ? `≤ ${fmtVal(r.high, r.unit)}` : `${fmtVal(r.low, r.unit)} – ${fmtVal(r.high, r.unit)}`}</td>
              <td className="num py-1 text-right">{r.reported !== undefined && r.reported !== null ? fmtVal(r.reported, r.unit === "pct_growth" ? "usd" : r.unit) : "—"}</td>
              <td className="py-1 pl-2"><span className={`rounded-full border px-1.5 py-px text-[10.5px] ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span>{r.missPct ? <span className="ml-1 text-[10px] text-muted">{(r.missPct * 100).toFixed(1)}%</span> : null}</td>
              <td className="num py-1 text-right">{r.p !== undefined ? pct(r.p) : "—"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <ul className="space-y-1.5 md:hidden">{rows.map((r, i) => (
        <li key={r.id ?? `u${i}`} className="rounded-lg border border-line p-2 text-[12px]">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{r.label} · {periodText(r.period)}</span><span className={`rounded-full border px-1.5 py-px text-[10.5px] ${STATUS[r.status]?.cls ?? ""}`}>{STATUS[r.status]?.label ?? r.status}</span></div>
          <div className="num text-muted">{r.op === ">=" ? `≥ ${fmtVal(r.low, r.unit)}` : r.op === "<=" ? `≤ ${fmtVal(r.high, r.unit)}` : `${fmtVal(r.low, r.unit)} – ${fmtVal(r.high, r.unit)}`}{r.reported !== undefined && r.reported !== null ? ` · reported ${fmtVal(r.reported, r.unit === "pct_growth" ? "usd" : r.unit)}` : ""}</div>
        </li>
      ))}</ul>
    </>
  );
}

function CallPage({ id, phone }: { id: number; phone: boolean }) {
  const { data, error, reload } = useApi<Call | { read: false }>(`/api/edge/calls/${id}`);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<unknown>(null);
  const [ticker, setTicker] = useState(""), [eva, setEva] = useState(false);
  const [at, setAt] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const read = async () => {
    setBusy(true); setErr(null);
    try { await post(`/api/edge/calls/${id}/read`, { ...(ticker ? { ticker } : {}), ...(eva ? { eva: true } : {}) }); reload(); }
    catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setBusy(false); }
  };
  if (error) return <p className="p-3 text-[12px] text-neg">This call did not load: {error}</p>;
  if (!data) return <div className="p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-40 rounded" /></div>;
  const controls = (
    <div className="flex flex-wrap items-center gap-2 text-[12px]">
      <label className="ctl flex items-center gap-1 border border-line px-2 py-1"><span className="text-muted">Ticker</span><input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder={data.read ? data.ticker || "—" : "optional"} className="w-16 bg-transparent uppercase outline-none" aria-label="Company ticker for this call" /></label>
      <label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={eva} onChange={(e) => setEva(e.target.checked)} className="accent-[var(--accent)]" />Add Eva-4B <PremiumBadge feature="edge.calls-eva" /></label>
      <button type="button" onClick={read} disabled={busy} className="ctl inline-flex items-center gap-1 bg-accent px-2.5 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}{data.read ? "Read again" : "Read this call"}</button>
    </div>
  );
  if (!data.read) return <div className="space-y-2 p-1"><p className="text-[12.5px] text-muted">Call Desk has not read this call yet. Reading pairs every analyst question with management&apos;s answer, scores each, and logs the promises made. It is free.</p>{controls}{err ? <PlanNotice error={err} /> : null}</div>;
  const c = data;
  const scored = c.pairs.filter((p) => p.p);
  const pair = c.pairs[Math.min(at, Math.max(0, c.pairs.length - 1))];
  const play = (t: number) => { if (audio.current) { audio.current.currentTime = t; void audio.current.play().catch(() => undefined); } };
  return (
    <div className="space-y-3">
      <header className="space-y-1">
        <h3 className="text-[15px] font-semibold tracking-tight">{c.name || c.title} {c.ticker && <span className="text-[12px] font-normal text-muted">{c.ticker}</span>}</h3>
        <p className="text-[11.5px] text-muted">{c.title} · {c.said} · {c.pairs.length} questions, {scored.length} scored · {c.engine}</p>
        {c.summary && (
          <div className="flex flex-wrap items-baseline gap-x-3"><span className="num text-[24px] font-semibold">{pct(c.summary.mean)}</span><span className="text-[12px] text-muted">of answers did not address the question (80% interval {pct(c.summary.low)} to {pct(c.summary.high)})</span></div>
        )}
        {c.comparison && <p className={`rounded-md border-l-2 px-2.5 py-1.5 text-[11.5px] ${c.comparison.rose ? "border-neg bg-neg/5" : "border-line bg-elevated/40"}`}>{c.comparison.sentence}</p>}
        {c.note && <p className="text-[11.5px] text-muted">{c.note}</p>}
        {c.eva.note && <p className="text-[11px] text-muted">{c.eva.note}</p>}
        <p className="text-[10.5px] text-faint">{c.disclaimer}</p>
        {controls}
        {err ? <PlanNotice error={err} /> : null}
      </header>
      {c.raw && <audio ref={(el) => { audio.current = el; }} src={c.raw} controls preload="metadata" className="w-full" />}
      {c.pairs.length > 0 && (
        <section>
          <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">The Q&amp;A, one segment a question</h4>
          {!phone && <div className="flex h-7 w-full overflow-hidden rounded-md border border-line" role="tablist" aria-label="Questions">{c.pairs.map((p, i) => (
            <button key={p.n} type="button" {...tabProps(i === at)} onClick={() => setAt(i)} title={`Q${p.n} ${p.analyst}: ${p.p ? `${pct(p.p.evasive)} did not answer` : "not scored"}`} className={`h-full flex-1 border-r border-bg/40 transition ${i === at ? "ring-2 ring-inset ring-fg" : ""}`} style={{ background: p.p ? tone(p.p.evasive + p.p.intermediate / 2) : "var(--color-line)" }} aria-label={`Question ${p.n}`} />
          ))}</div>}
          <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
            <button type="button" onClick={() => setAt(Math.max(0, at - 1))} disabled={at === 0} className="inline-flex items-center gap-0.5 disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
            <span className="num">{at + 1} / {c.pairs.length}</span>
            <button type="button" onClick={() => setAt(Math.min(c.pairs.length - 1, at + 1))} disabled={at >= c.pairs.length - 1} className="inline-flex items-center gap-0.5 disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          {pair && <div className="mt-2"><PairDetail pair={pair} onPlay={c.raw ? play : undefined} /></div>}
        </section>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {c.avoided.length > 0 && <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">What they avoided</h4><ul className="space-y-0.5 text-[12px]">{c.avoided.map((a) => <li key={a.topic} className="flex justify-between gap-2"><span>{a.topic}</span><span className="num text-muted">{a.n} question{a.n === 1 ? "" : "s"}</span></li>)}</ul></section>}
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Classifier record</h4><p className="text-[11px] text-muted">{c.classifier.scorecard}</p></section>
      </div>
      <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Promises on this call</h4><Promises rows={c.commitments} /></section>
    </div>
  );
}

function PromisesTab({ ticker }: { ticker: string }) {
  const { data, error } = useApi<{ ticker: string; name: string; rows: Promise[]; hitRate: { text: string } }>(ticker ? `/api/edge/commitments?ticker=${ticker}` : null);
  if (!ticker) return <p className="panel px-3 py-3 text-[12.5px] text-muted">Type a ticker to see the promises its management made and how they turned out.</p>;
  if (error) return <p className="panel px-3 py-2 text-[12px] text-neg">The promises did not load: {error}</p>;
  if (!data) return <div className="panel p-4" aria-busy="true"><div className="shimmer h-24 rounded" /></div>;
  return (
    <div className="panel space-y-2 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[14px] font-semibold">{data.name} <span className="text-[12px] font-normal text-muted">{data.ticker}</span></h3><a href={`/api/edge/commitments?ticker=${data.ticker}&format=csv`} className="inline-flex items-center gap-1 text-[11.5px] text-muted hover:text-fg">Export CSV <ExternalLink className="h-3 w-3" /></a></div>
      <p className="text-[12px]">{data.hitRate.text}</p>
      <Promises rows={data.rows} />
      <p className="text-[10.5px] text-faint">Each promise is read from the company&apos;s own release or call, logged with the probability it hits (from its record), and settled from XBRL when the filing for its period lands. Unmapped metrics are listed, not guessed.</p>
    </div>
  );
}

function PeersTab({ initial }: { initial: string[] }) {
  const [text, setText] = useState(initial.slice(0, 6).join(", "));
  const [busy, setBusy] = useState(false), [err, setErr] = useState<unknown>(null);
  const [res, setRes] = useState<{ rows: { ticker: string; name: string; said: string; rate: { mean: number; low: number; high: number } | null; avoided: string[]; hitRate: string }[]; comparison: string } | null>(null);
  const run = async () => {
    setBusy(true); setErr(null);
    try { setRes(await post("/api/edge/calls/peers", { tickers: text.split(/[\s,]+/).filter(Boolean) })); }
    catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel space-y-2 p-3 text-[12.5px]">
      <div className="flex flex-wrap items-center gap-2"><input value={text} onChange={(e) => setText(e.target.value.toUpperCase())} placeholder="ET, KMI, WMB, TRGP" className="ctl min-w-0 flex-1 border border-line bg-transparent px-2 py-1 uppercase outline-none" aria-label="Two to six tickers" /><button type="button" onClick={run} disabled={busy} className="ctl inline-flex items-center gap-1 bg-accent px-2.5 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy && <Loader2 className="h-3 w-3 animate-spin" />}Compare <PremiumBadge feature="edge.calls-peers" /></button></div>
      {err ? <PlanNotice error={err} /> : null}
      {res && (
        <>
          <ul className="space-y-1">{res.rows.map((r) => <li key={r.ticker} className="grid grid-cols-[64px_minmax(0,1fr)] gap-2 rounded-md border border-line p-2"><span className="font-semibold">{r.ticker}</span><span className="text-muted">{r.rate ? `${pct(r.rate.mean)} did not answer (${pct(r.rate.low)}–${pct(r.rate.high)}), ${r.said}` : "no call read yet"}{r.avoided.length ? ` · avoided ${r.avoided.join(", ")}` : ""}<br />{r.hitRate}</span></li>)}</ul>
          <p className="rounded-md border-l-2 border-accent bg-accent-soft/40 px-2.5 py-1.5 text-[12px]">{res.comparison}</p>
        </>
      )}
    </div>
  );
}

type Tab = "calls" | "promises" | "peers";

export function CallsView({ tickers, initial }: { tickers: string[]; initial?: string | null }) {
  const phone = usePhone();
  const [tab, setTab] = useState<Tab>("calls");
  const [ticker, setTicker] = useState(initial ?? ""), [find, setFind] = useState(initial ?? "");
  const [open, setOpen] = useState<number | null>(null);
  const { data, error } = useApi<{ calls: ListRow[] }>(`/api/edge/calls${ticker ? `?ticker=${ticker}` : ""}`);
  const rows = useMemo(() => data?.calls ?? [], [data]);
  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3 text-[12.5px]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1" role="tablist" aria-label="Call Desk" onKeyDown={onTabKeys}>
            {(["calls", "promises", "peers"] as Tab[]).map((t) => <button key={t} type="button" {...tabProps(tab === t)} onClick={() => setTab(t)} className={`rounded-md px-2.5 py-1 text-[12px] ${tab === t ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{t === "calls" ? "Calls" : t === "promises" ? "Promises" : <span className="inline-flex items-center gap-1">Compare peers <PremiumBadge feature="edge.calls-peers" /></span>}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); setTicker(find.trim().toUpperCase()); }} className="flex gap-1"><label className="ctl flex items-center gap-1 border border-line px-2 py-1"><Search className="h-3.5 w-3.5 text-muted" /><input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Ticker" className="w-24 bg-transparent uppercase outline-none" aria-label="Company ticker" /></label><button type="submit" className="ctl border border-line px-2 py-1 text-muted hover:text-fg">Show</button></form>
        </div>
        <p className="text-[11px] text-muted">Each analyst question is paired with management&apos;s answer and scored direct, partial or did-not-answer with calibrated probabilities. Every quantified promise goes into the forecast ledger and is settled from the company&apos;s filings. Upload a recording or open a filed 8-K transcript under Documents to add calls.</p>
      </div>
      {tab === "promises" && <PromisesTab ticker={ticker} />}
      {tab === "peers" && <PeersTab initial={ticker ? [ticker, ...tickers.filter((t) => t !== ticker)] : tickers} />}
      {tab === "calls" && (
        <div className={`grid gap-3 ${open && !phone ? "lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]" : ""}`}>
          <div className="min-w-0 space-y-2">
            {error && <p className="panel px-3 py-2 text-[12px] text-neg">The calls did not load: {error}</p>}
            {data && !rows.length && <p className="panel px-3 py-3 text-[12.5px] text-muted">{ticker ? `No calls or filed releases for ${ticker} yet. Read its 8-Ks under Documents (SEC filings) or upload a recording.` : "No calls yet. Upload an earnings-call recording under Documents, or open a company to read its filed 8-K releases and transcripts."}</p>}
            <ul className="space-y-1.5">{rows.map((r) => (
              <li key={r.id}><button type="button" onClick={() => setOpen(r.id)} className={`panel w-full p-2.5 text-left ${open === r.id ? "border-accent/60" : ""}`}>
                <div className="flex items-center justify-between gap-2"><span className="flex min-w-0 items-center gap-1.5 truncate text-[12.5px] font-semibold">{r.source === "audio" || /^(audio|video)\//.test(r.mime) ? <Mic className="h-3.5 w-3.5 shrink-0 text-muted" /> : null}{r.title}</span>{r.summary ? <span className="num shrink-0 text-[12px]" style={{ color: tone(Math.min(1, r.summary.mean * 2)) }}>{pct(r.summary.mean)}</span> : null}</div>
                <div className="mt-0.5 text-[10.5px] text-muted">{r.ticker || "—"} · {(r.filed || r.createdAt).slice(0, 10)} · {r.read ? `${r.summary ? `${r.summary.scored} answers scored` : "release"}${r.promises ? ` · ${r.promises} promises` : ""}` : r.status === "ready" ? "not read yet" : r.status}{r.rose !== null && r.rose >= 0.9 ? " · evasion rose" : ""}</div>
              </button></li>
            ))}</ul>
          </div>
          {open && !phone && <aside className="panel max-h-[85vh] min-w-0 overflow-auto p-3.5"><div className="mb-2 flex justify-end"><button type="button" onClick={() => setOpen(null)} className="text-[11.5px] text-muted hover:text-fg">Close</button></div><CallPage key={open} id={open} phone={false} /></aside>}
        </div>
      )}
      {phone && <Sheet open={!!open && tab === "calls"} onClose={() => setOpen(null)} size="full" label="Call Desk call">{open && <CallPage key={open} id={open} phone />}</Sheet>}
    </div>
  );
}
