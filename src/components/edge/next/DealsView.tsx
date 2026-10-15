"use client";

/**
 * Deals (E1, the Precedent Engine): a precedent-transactions database built from EDGAR's own merger
 * documents. Search with filter chips, or "Like…" a ticker, a deal or a sentence to retrieve deals by
 * meaning and structure; a strip shows the multiples with the interquartile range and, for a "Like" search,
 * the split-conformal band with its tested coverage. A deal's page lays out the sale process, every term
 * with its quote and confidence, and the fairness ranges as a football field. On a phone results become
 * cards and the deal page opens as a full-height sheet with the timeline running down.
 */
import { ExternalLink, FileText, Loader2, Lock, RefreshCw, Search, Sparkles, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Sheet } from "@/components/ui/Sheet";
import { usePhone } from "@/components/ui/useMedia";
import { errorMessage, safeText } from "@/lib/client/errors";
import { FAMILY_LABEL } from "@/lib/edge/deals/fields";
import { fmtMoney } from "@/lib/edge/deals/parse";
import { confidenceLine, type ShownField, type TimelineStep } from "@/lib/edge/deals/view";
import type { DealsValue } from "@/lib/edge/canvas/values";
import { post, useApi } from "../client";
import { SendToStudio } from "../SendToStudio";
import { pct } from "./charts";

type Stats = { n: number; median: number; p25: number; p75: number; low: number; high: number } | null;
type Deal = {
  id: number; announcedAt: string | null; targetName: string; targetTicker: string; acquirerName: string; buyerType: string; sic: string; consideration: string;
  equityUsdMm: number | null; evUsdMm: number | null; evEbitda: number | null; evRevenue: number | null; premiumUnaffected: number | null; extractedAt: string | null;
  sources: { form: string; url: string; filed: string; role?: string; press?: string }[]; terms?: Record<string, unknown>; why?: string[]; score?: number;
};
type ListData = { deals: Deal[]; total: number; coverage: { deals: number; read: number; withMultiple: number; from: string | null; to: string | null }; spread: { evEbitda: Stats; evRevenue: Stats } };
type Band = { low: number; mid: number; high: number; level: number; coverage: number | null; testedOn: string; calibration: number } | null;
type SimilarData = { query: { name: string; method: string }; results: Deal[]; range: { evEbitda: Stats; evRevenue: Stats; band: Band }; bandText: string };
type Backfill = { on: boolean; why: string; dailyUsd: number; spentTodayUsd: number; leftToday: number; unread: number; deals: number; state: { cursor?: string; lastRun?: string; lastError?: string }; from: string };

const SECTORS: { v: string; label: string }[] = [
  { v: "", label: "Any sector" }, { v: "13", label: "Oil and gas" }, { v: "49", label: "Utilities and pipelines" }, { v: "28", label: "Chemicals and pharma" },
  { v: "283", label: "Pharmaceuticals" }, { v: "73", label: "Software and services" }, { v: "36", label: "Electronics" }, { v: "38", label: "Instruments and devices" },
  { v: "60", label: "Banks" }, { v: "63", label: "Insurance" }, { v: "67", label: "REITs and holding cos." }, { v: "50", label: "Wholesale" }, { v: "58", label: "Restaurants" },
];
const SIZES = [{ v: "", label: "Any size" }, { v: "0-500", label: "Under $500m" }, { v: "500-2000", label: "$500m to $2bn" }, { v: "2000-10000", label: "$2bn to $10bn" }, { v: "10000-", label: "Over $10bn" }];
const BUYERS = [{ v: "", label: "Any buyer" }, { v: "strategic", label: "Strategic" }, { v: "sponsor", label: "Sponsor" }, { v: "sponsor_backed", label: "Sponsor-backed" }];
const CONS = [{ v: "", label: "Any consideration" }, { v: "cash", label: "Cash" }, { v: "stock", label: "Stock" }, { v: "mixed", label: "Mixed" }];
// Year chips carry their own start dates, worked out once when the module loads (renders stay pure).
const THIS_YEAR = new Date().getUTCFullYear();
const YEARS = [{ v: "", label: "Since 2015" }, { v: `${THIS_YEAR - 2}-01-01`, label: `Since ${THIS_YEAR - 2}` }, { v: `${THIS_YEAR - 5}-01-01`, label: `Since ${THIS_YEAR - 5}` }];
const TICKER = /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/;

const x = (v: number | null | undefined, dp = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v.toFixed(dp)}x`);
const mm = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtMoney({ value: v, unit: "usd_mm" }));

function Chip({ value, options, onChange, label }: { value: string; options: { v: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <label className={`ctl inline-flex shrink-0 items-center border px-2 py-1 text-[11.5px] ${value ? "border-accent/60 bg-accent-soft text-fg" : "border-line text-muted"}`}>
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="bg-transparent outline-none">{options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}</select>
    </label>
  );
}

/** EV/EBITDA of the deals shown as dots, the interquartile range shaded, and the conformal band as a whisker. */
function Strip({ values, stats, band }: { values: number[]; stats: Stats; band?: Band }) {
  const v = values.filter((n) => Number.isFinite(n) && n > 0 && n < 60);
  if (v.length < 3 && !band) return null;
  const hi = Math.max(20, ...v, band?.high ?? 0) * 1.05, w = 100;
  const sx = (n: number) => `${Math.min(100, (n / hi) * w)}%`;
  return (
    <div className="panel p-3" aria-label="Multiples of the deals shown">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11.5px]">
        <span className="font-semibold">EV / LTM EBITDA</span>
        <span className="text-muted">{stats ? `median ${x(stats.median)} · IQR ${x(stats.p25)} to ${x(stats.p75)} · ${stats.n} deals` : `${v.length} deals with a multiple`}</span>
      </div>
      <div className="relative mt-3 h-8">
        <span className="absolute inset-x-0 top-1/2 h-px bg-line" />
        {stats && <span className="absolute top-1.5 h-5 rounded bg-accent-soft" style={{ left: sx(stats.p25), width: `calc(${sx(stats.p75)} - ${sx(stats.p25)})` }} title={`Interquartile range ${x(stats.p25)} to ${x(stats.p75)}`} />}
        {stats && <span className="absolute top-0.5 h-7 w-[2px] bg-accent" style={{ left: sx(stats.median) }} />}
        {v.map((n, i) => <span key={i} className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg/70" style={{ left: sx(n) }} title={x(n)} />)}
        {band && <><span className="absolute top-7 h-px bg-info" style={{ left: sx(band.low), width: `calc(${sx(band.high)} - ${sx(band.low)})` }} /><span className="absolute top-6 h-2 w-px bg-info" style={{ left: sx(band.low) }} /><span className="absolute top-6 h-2 w-px bg-info" style={{ left: sx(band.high) }} /></>}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-faint"><span>0x</span><span>{x(hi / 2, 0)}</span><span>{x(hi, 0)}</span></div>
      {band && <p className="mt-1.5 text-[11px] text-muted"><span className="font-medium text-info">Blue whisker:</span> {Math.round(band.level * 100)}% conformal interval {x(band.low)} to {x(band.high)}, calibrated on {band.calibration} earlier deals; {band.coverage === null ? `coverage not tested yet (${band.testedOn})` : `covered ${Math.round(band.coverage * 100)}% of ${band.testedOn} held out`}.</p>}
    </div>
  );
}

function feePct(d: Deal): string {
  const fee = d.terms?.termination_fee;
  return typeof fee === "number" && d.equityUsdMm ? `${((fee / d.equityUsdMm) * 100).toFixed(1)}%` : "—";
}

function ResultsTable({ deals, onOpen, selected }: { deals: Deal[]; onOpen: (id: number) => void; selected: number | null }) {
  return (
    <div className="panel table-scroll hidden overflow-auto md:block">
      <table className="w-full whitespace-nowrap text-[12px]">
        <thead className="sticky top-0 bg-panel text-[10px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="py-1.5 pl-3 text-left font-normal">Target</th><th className="py-1.5 text-left font-normal">Buyer</th><th className="py-1.5 text-left font-normal">Announced</th>
            <th className="py-1.5 text-right font-normal">EV</th><th className="py-1.5 text-right font-normal">EV/EBITDA</th><th className="py-1.5 text-right font-normal">Premium</th><th className="py-1.5 text-right font-normal">Term. fee</th>
            <th className="py-1.5 pl-3 pr-3 text-left font-normal">Why similar</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} onClick={() => onOpen(d.id)} className={`cursor-pointer border-b border-line/50 hover:bg-elevated/70 ${selected === d.id ? "bg-elevated" : ""}`}>
              <td className="max-w-[220px] truncate py-1.5 pl-3 font-semibold" title={d.targetName}>{d.targetName || "Not read yet"}{d.targetTicker ? <span className="ml-1 font-normal text-muted">{d.targetTicker}</span> : null}{!d.extractedAt && <span className="ml-1.5 rounded bg-elevated px-1 text-[10px] font-normal text-muted">stub</span>}</td>
              <td className="max-w-[180px] truncate py-1.5" title={d.acquirerName}>{d.acquirerName || "—"}{d.buyerType ? <span className="ml-1 text-[10px] text-muted">{d.buyerType.replace("_", "-")}</span> : null}</td>
              <td className="num py-1.5 text-muted">{d.announcedAt?.slice(0, 10) ?? "—"}</td>
              <td className="num py-1.5 text-right">{mm(d.evUsdMm ?? d.equityUsdMm)}</td>
              <td className="num py-1.5 text-right">{x(d.evEbitda)}</td>
              <td className="num py-1.5 text-right">{d.premiumUnaffected !== null ? pct(d.premiumUnaffected) : "—"}</td>
              <td className="num py-1.5 text-right">{feePct(d)}</td>
              <td className="py-1.5 pl-3 pr-3"><div className="flex max-w-[320px] flex-wrap gap-1">{(d.why ?? []).slice(0, 3).map((w) => <span key={w} className="rounded-full border border-line px-1.5 text-[10.5px] text-muted">{w}</span>)}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultCards({ deals, onOpen }: { deals: Deal[]; onOpen: (id: number) => void }) {
  return (
    <ul className="space-y-2 md:hidden">
      {deals.map((d) => (
        <li key={d.id}>
          <button type="button" onClick={() => onOpen(d.id)} className="panel w-full p-3 text-left">
            <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[13px] font-semibold">{d.targetName || "Not read yet"}</span><span className="num shrink-0 text-[11px] text-muted">{d.announcedAt?.slice(0, 7) ?? ""}</span></div>
            <div className="mt-0.5 truncate text-[12px] text-muted">{d.acquirerName ? `bought by ${d.acquirerName}` : "buyer not read yet"}</div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
              <div><div className="text-faint">EV/EBITDA</div><div className="num text-fg">{x(d.evEbitda)}</div></div>
              <div><div className="text-faint">Premium</div><div className="num text-fg">{d.premiumUnaffected !== null ? pct(d.premiumUnaffected) : "—"}</div></div>
              <div><div className="text-faint">EV</div><div className="num text-fg">{mm(d.evUsdMm ?? d.equityUsdMm)}</div></div>
            </div>
            {d.why?.length ? <div className="mt-2 flex flex-wrap gap-1">{d.why.slice(0, 3).map((w) => <span key={w} className="rounded-full border border-line px-1.5 text-[10.5px] text-muted">{w}</span>)}</div> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ steps, vertical }: { steps: TimelineStep[]; vertical: boolean }) {
  if (!steps.length) return <p className="text-[11.5px] text-muted">The documents read so far do not state the sale process.</p>;
  if (vertical) return (
    <ol className="relative ml-2 border-l border-line">
      {steps.map((s) => <li key={s.key} className="mb-2.5 ml-3"><span className="absolute -left-[5px] mt-1 h-2.5 w-2.5 rounded-full bg-accent" /><div className="text-[12px] font-medium">{s.label}</div><div className="num text-[11px] text-muted">{s.date ?? `${s.count}`}</div></li>)}
    </ol>
  );
  return (
    <ol className="flex items-start" aria-label="Sale process">
      {steps.map((s, i) => (
        <li key={s.key} className="relative flex-1 text-center">
          {i > 0 && <span className="absolute left-0 right-1/2 top-[5px] h-px bg-line" />}
          {i < steps.length - 1 && <span className="absolute left-1/2 right-0 top-[5px] h-px bg-line" />}
          <span className="relative mx-auto block h-2.5 w-2.5 rounded-full bg-accent" />
          <div className="mt-1 text-[11px] font-medium leading-tight">{s.label}</div>
          <div className="num text-[11px] text-muted">{s.date ?? s.count}</div>
        </li>
      ))}
    </ol>
  );
}

function Football({ bars, offer }: { bars: { label: string; low: number; high: number }[]; offer: number | null }) {
  if (!bars.length) return null;
  const lo = Math.min(...bars.map((b) => b.low), offer ?? Infinity) * 0.9, hi = Math.max(...bars.map((b) => b.high), offer ?? 0) * 1.05;
  const s = (v: number) => `${((v - lo) / (hi - lo)) * 100}%`;
  return (
    <div aria-label="Fairness opinion ranges per share">
      {bars.map((b) => (
        <div key={b.label} className="mb-2">
          <div className="flex justify-between text-[11px]"><span>{b.label}</span><span className="num text-muted">${b.low.toFixed(2)} to ${b.high.toFixed(2)}</span></div>
          <div className="relative mt-0.5 h-3 rounded bg-line/60">
            <span className="absolute inset-y-0 rounded bg-accent/70" style={{ left: s(b.low), width: `calc(${s(b.high)} - ${s(b.low)})` }} />
            {offer !== null && <span className="absolute -inset-y-0.5 w-[2px] bg-fg" style={{ left: s(offer) }} />}
          </div>
        </div>
      ))}
      {offer !== null && <p className="text-[11px] text-muted">The black line is the offer: ${offer.toFixed(2)} a share.</p>}
    </div>
  );
}

type DealPageData = {
  deal: Deal & { signedAt: string | null; closedAt: string | null; status: string };
  families: { family: keyof typeof FAMILY_LABEL; label: string; fields: ShownField[] }[];
  timeline: TimelineStep[]; football: { bars: { label: string; low: number; high: number }[]; offer: number | null };
  trail: { name: string; url: string; license: string; method: string; modelVersion: string; retrievedAt: string }[];
  actions: { read: boolean; reread: { allowed: boolean; ready: boolean } };
};

function FieldRow({ f }: { f: ShownField }) {
  const [open, setOpen] = useState(false);
  const tone = f.checks.some((c) => c.ok === false) ? "text-neg" : f.confidence >= 0.85 ? "text-pos" : "text-muted";
  return (
    <li className="border-b border-line/60 py-1.5 last:border-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-baseline justify-between gap-3 text-left" aria-expanded={open}>
        <span className="text-[12px] text-muted">{f.label}</span>
        <span className="num text-right text-[12.5px] font-medium text-fg">{f.text}</span>
      </button>
      <div className={`mt-0.5 text-[10.5px] ${tone}`}>{confidenceLine(f)}</div>
      {open && (
        <blockquote className="mt-1.5 rounded-md border-l-2 border-accent bg-elevated px-2 py-1.5 text-[11.5px] leading-relaxed">
          <span className="text-fg">&ldquo;{f.quote}&rdquo;</span>
          <span className="mt-1 flex flex-wrap items-center gap-2 text-[10.5px] text-muted">
            <span>{f.section}</span>
            {f.docUrl && <a href={f.docUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-info hover:underline">Open the filing <ExternalLink className="h-3 w-3" /></a>}
            <span>{f.method}</span>
          </span>
        </blockquote>
      )}
    </li>
  );
}

function DealPage({ id, onClose, onLike, phone }: { id: number; onClose: () => void; onLike: (id: number) => void; phone: boolean }) {
  const { data, error, reload } = useApi<DealPageData>(`/api/edge/deals/${id}`);
  const [busy, setBusy] = useState<"read" | "reread" | null>(null);
  const [actError, setActError] = useState<unknown>(null);
  const act = async (kind: "read" | "reread") => {
    setBusy(kind); setActError(null);
    try { await post(`/api/edge/deals/${id}/${kind}`, {}); reload(); }
    catch (e) { setActError(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setBusy(null); }
  };
  if (error) return <p className="p-3 text-[12px] text-neg">This deal did not load: {error}</p>;
  if (!data) return <div className="p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-40 rounded" /></div>;
  const d = data.deal;
  const asValue: DealsValue = { type: "deals", title: `${d.targetName} precedent`, query: d.targetName, method: "one deal", items: [{ id: d.id, target: d.targetName, buyer: d.acquirerName, announced: d.announcedAt ?? "", evUsdMm: d.evUsdMm, evEbitda: d.evEbitda, evRevenue: d.evRevenue, premium: d.premiumUnaffected, buyerType: d.buyerType, why: [], url: d.sources[0]?.url ?? "" }], range: null, band: null };
  return (
    <div className="space-y-3">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold tracking-tight">{d.targetName || "A deal not read yet"}{d.targetTicker ? <span className="ml-1.5 text-[12px] font-normal text-muted">{d.targetTicker}</span> : null}</h3>
          <p className="text-[12px] text-muted">{d.acquirerName ? `Acquired by ${d.acquirerName}` : "Buyer not read yet"} · announced {d.announcedAt ?? "—"} · {d.consideration || "consideration not read"}{d.buyerType ? ` · ${d.buyerType.replace("_", "-")} buyer` : ""}</p>
        </div>
        {!phone && <button type="button" onClick={onClose} className="ctl p-1 text-muted hover:text-fg" aria-label="Close the deal"><X className="h-4 w-4" /></button>}
      </header>
      <dl className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
        <div><dt className="text-muted">Equity value</dt><dd className="num text-fg">{mm(d.equityUsdMm)}</dd></div>
        <div><dt className="text-muted">Enterprise value</dt><dd className="num text-fg">{mm(d.evUsdMm)}</dd></div>
        <div><dt className="text-muted">EV/LTM EBITDA</dt><dd className="num text-fg">{x(d.evEbitda)}</dd></div>
        <div><dt className="text-muted">Premium</dt><dd className="num text-fg">{d.premiumUnaffected !== null ? pct(d.premiumUnaffected, 1) : "—"}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-1.5">
        {data.actions.read && <button type="button" disabled={!!busy} onClick={() => void act("read")} className="ctl inline-flex items-center gap-1.5 bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg disabled:opacity-50">{busy === "read" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}Read its documents now</button>}
        <button type="button" onClick={() => onLike(d.id)} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg"><Sparkles className="h-3.5 w-3.5" />Deals like this one</button>
        {data.actions.reread.ready && (
          <button type="button" disabled={!!busy || !data.actions.reread.allowed} onClick={() => void act("reread")} title={data.actions.reread.allowed ? "Every term re-quoted and re-checked by the stronger model, about $0.24 from your AI allowance" : "Part of a paid plan"} className="ctl inline-flex items-center gap-1.5 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-60">
            {busy === "reread" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : data.actions.reread.allowed ? <RefreshCw className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}Re-read with the stronger model <PremiumBadge feature="edge.deals-reread" />
          </button>
        )}
        <SendToStudio title={`Precedent: ${d.targetName}`} source="Edge Deals" items={[{ label: "Precedent", value: asValue }]} />
      </div>
      {actError ? <PlanNotice error={actError} /> : null}
      <section><h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Sale process</h4><Timeline steps={data.timeline} vertical={phone} /></section>
      {data.football.bars.length > 0 && <section><h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Fairness opinion</h4><Football bars={data.football.bars} offer={data.football.offer} /></section>}
      {data.families.length ? data.families.map((g) => (
        <section key={g.family}>
          <h4 className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{g.label}</h4>
          <ul>{g.fields.map((f) => <FieldRow key={f.field} f={f} />)}</ul>
        </section>
      )) : <p className="text-[12px] text-muted">No terms read yet. {data.actions.read ? "Read its documents now, or wait for the backfill." : ""}</p>}
      <section>
        <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Documents and audit trail</h4>
        <ul className="space-y-1 text-[11.5px]">
          {d.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noreferrer" className="text-info hover:underline">{s.form} filed {s.filed}</a>{s.press ? <> · <a href={s.press} target="_blank" rel="noreferrer" className="text-info hover:underline">press release</a></> : null}</li>)}
          {data.trail.slice(-6).map((t, i) => <li key={i} className="text-muted">{t.name}: {t.method}{t.modelVersion ? ` (${t.modelVersion})` : ""}, {t.retrievedAt.slice(0, 10)}</li>)}
        </ul>
        <p className="mt-1.5 text-[10.5px] text-faint">Terms are quoted from the filings and re-read by number parsers; confidence says how often fields like each were right. SEC EDGAR filings are US government works.</p>
      </section>
    </div>
  );
}

function BackfillPanel() {
  const { data, reload } = useApi<Backfill>("/api/edge/deals/backfill");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!data) return null; // Not an administrator (403), or still loading.
  const send = async (body: Record<string, unknown>) => { setBusy(true); setErr(null); try { await post("/api/edge/deals/backfill", body); reload(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="panel flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[11.5px]">
      <span className="font-semibold">Backfill (administrators)</span>
      <span className={data.on ? "text-pos" : "text-muted"}>{data.on ? "Reading on" : "Reading off"}: {data.why}</span>
      <span className="text-muted">${data.spentTodayUsd.toFixed(2)} of ${data.dailyUsd.toFixed(2)} today · {data.leftToday} more deals today · {data.unread} unread of {data.deals} · cursor {data.state.cursor ?? data.from}</span>
      <span className="ml-auto flex gap-1.5">
        <button type="button" disabled={busy} onClick={() => void send({ on: !data.on })} className="ctl border border-line px-2 py-0.5 hover:text-fg">{data.on ? "Switch off" : "Switch on"}</button>
        <button type="button" disabled={busy || !data.on} onClick={() => void send({ run: true })} className="ctl border border-line px-2 py-0.5 hover:text-fg disabled:opacity-50">{busy ? "Working…" : "Run a slice now"}</button>
      </span>
      {err && <span className="w-full text-neg">{err}</span>}
      {data.state.lastError && <span className="w-full text-neg">Last run: {safeText(data.state.lastError)}</span>}
    </div>
  );
}

export function DealsView({ tickers }: { tickers: string[] }) {
  const phone = usePhone();
  const [q, setQ] = useState("");
  const [sic, setSic] = useState(""), [size, setSize] = useState(""), [buyer, setBuyer] = useState(""), [cons, setCons] = useState(""), [years, setYears] = useState("");
  const [like, setLike] = useState(tickers[0] ?? "");
  const [similar, setSimilar] = useState<SimilarData | null>(null);
  const [likeBusy, setLikeBusy] = useState(false);
  const [likeError, setLikeError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const filters = useMemo(() => {
    const [min, max] = size.split("-");
    const from = years;
    return { sic, buyer, consideration: cons, min: min || "", max: max || "", from };
  }, [sic, size, buyer, cons, years]);
  const qs = new URLSearchParams(Object.entries({ q, ...filters }).filter(([, v]) => v)).toString();
  const list = useApi<ListData>(`/api/edge/deals?${qs}`);
  const runLike = useCallback(async (input: { dealId?: number; text?: string }) => {
    setLikeBusy(true); setLikeError(null);
    const t = input.text?.trim() ?? "";
    const body = input.dealId ? { dealId: input.dealId } : TICKER.test(t) ? { ticker: t.toUpperCase() } : { text: t };
    try {
      const [min, max] = size.split("-");
      setSimilar(await post<SimilarData>("/api/edge/deals/similar", { ...body, buyerType: buyer || undefined, filters: { sic: sic || undefined, consideration: cons || undefined, from: filters.from || undefined, min: min ? Number(min) : undefined, max: max ? Number(max) : undefined } }));
    } catch (e) { setLikeError(errorMessage(e)); } finally { setLikeBusy(false); }
  }, [buyer, cons, filters.from, sic, size]);
  const shown = similar ? similar.results : list.data?.deals ?? [];
  const cov = list.data?.coverage;
  const precedentValue: DealsValue | null = similar ? { type: "deals", title: `Deals like ${similar.query.name}`, query: similar.query.name, method: similar.query.method, items: similar.results.map((r) => ({ id: r.id, target: r.targetName, buyer: r.acquirerName, announced: r.announcedAt ?? "", evUsdMm: r.evUsdMm, evEbitda: r.evEbitda, evRevenue: r.evRevenue, premium: r.premiumUnaffected, buyerType: r.buyerType, why: r.why ?? [], url: r.sources[0]?.url ?? "" })), range: similar.range.evEbitda ? { median: similar.range.evEbitda.median, p25: similar.range.evEbitda.p25, p75: similar.range.evEbitda.p75, n: similar.range.evEbitda.n } : null, band: similar.range.band ? { ...similar.range.band, text: similar.bandText } : null } : null;
  return (
    <div className="space-y-3">
      <div className="panel space-y-2 p-3">
        <div className="flex flex-col gap-2 md:flex-row">
          <label className="ctl flex min-w-0 flex-1 items-center gap-1.5 border border-line px-2 py-1.5"><Search className="h-3.5 w-3.5 text-muted" /><input value={q} onChange={(e) => { setQ(e.target.value); setSimilar(null); }} placeholder="Search by target, buyer or ticker" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" aria-label="Search deals" /></label>
          <form className="flex min-w-0 flex-1 gap-1.5" onSubmit={(e) => { e.preventDefault(); if (like.trim()) void runLike({ text: like }); }}>
            <label className="ctl flex min-w-0 flex-1 items-center gap-1.5 border border-line px-2 py-1.5"><Sparkles className="h-3.5 w-3.5 text-accent" /><input value={like} onChange={(e) => setLike(e.target.value)} placeholder="Like… a ticker, or a sentence about the target" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" aria-label="Find deals like" /></label>
            <button type="submit" disabled={likeBusy || !like.trim()} className="ctl shrink-0 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">{likeBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}</button>
          </form>
        </div>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
          <Chip label="Sector" value={sic} options={SECTORS} onChange={setSic} /><Chip label="Size" value={size} options={SIZES} onChange={setSize} />
          <Chip label="Buyer type" value={buyer} options={BUYERS} onChange={setBuyer} /><Chip label="Years" value={years} options={YEARS} onChange={setYears} />
          <Chip label="Consideration" value={cons} options={CONS} onChange={setCons} />
          {similar && <button type="button" onClick={() => setSimilar(null)} className="ctl shrink-0 border border-line px-2 py-1 text-[11.5px] text-muted hover:text-fg">Back to all deals</button>}
        </div>
        <p className="text-[11px] text-muted">
          {cov ? `${cov.deals.toLocaleString()} deals from EDGAR merger filings${cov.from ? ` (${cov.from.slice(0, 4)} to ${cov.to?.slice(0, 4)})` : ""}; ${cov.read.toLocaleString()} read term by term, ${cov.withMultiple.toLocaleString()} with an EBITDA multiple.` : "Loading the database…"}
          {" "}Every term is quoted from the filing and checked.
        </p>
        {likeError && <p className="text-[12px] text-neg">{likeError}</p>}
      </div>
      <BackfillPanel />
      {similar && <p className="px-1 text-[12px] text-muted">Deals like <span className="font-medium text-fg">{similar.query.name}</span> · {similar.query.method}</p>}
      <Strip values={shown.map((d) => d.evEbitda ?? NaN)} stats={similar ? similar.range.evEbitda : list.data?.spread.evEbitda ?? null} band={similar?.range.band} />
      {precedentValue && precedentValue.items.length > 0 && <div className="flex flex-wrap items-center gap-2 px-1"><span className="text-[11.5px] text-muted">Use as a precedent set:</span><SendToStudio title={precedentValue.title} source="Edge Deals" items={[{ label: "Precedents", value: precedentValue }]} /><a href={`/api/edge/deals/export?${qs}`} className="ctl inline-flex items-center gap-1 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Export CSV (50 free)</a></div>}
      {list.error && !similar && <p className="panel px-3 py-2 text-[12px] text-neg">Deals did not load: {list.error}</p>}
      {!shown.length && (list.data || similar) && <p className="panel px-3 py-3 text-[12.5px] text-muted">{similar ? "No deals like that in the database yet." : cov && cov.deals === 0 ? "The deal database is empty until the daily pass and the backfill find merger filings." : "No deals match these filters."}</p>}
      <div className={`grid gap-3 ${open !== null && !phone ? "lg:grid-cols-[minmax(0,1fr)_420px]" : ""}`}>
        <div className="min-w-0">
          <ResultsTable deals={shown} onOpen={setOpen} selected={open} />
          <ResultCards deals={shown} onOpen={setOpen} />
          {!similar && list.data && list.data.total > shown.length && <p className="mt-2 px-1 text-[11px] text-muted">Showing {shown.length} of {list.data.total.toLocaleString()}; narrow the filters to see others.</p>}
        </div>
        {open !== null && !phone && <aside className="panel max-h-[80vh] overflow-auto p-3.5"><DealPage id={open} onClose={() => setOpen(null)} onLike={(id) => void runLike({ dealId: id })} phone={false} /></aside>}
      </div>
      {phone && <Sheet open={open !== null} onClose={() => setOpen(null)} size="full" label="Deal">{open !== null && <DealPage id={open} onClose={() => setOpen(null)} onLike={(id) => { setOpen(null); void runLike({ dealId: id }); }} phone />}</Sheet>}
    </div>
  );
}
