"use client";

/**
 * The LBO Stress Lab (E6): a buyout run over 1,000 synthetic macro and operating paths. On the left, the
 * company (or a private target's figures), the structure as tranche rows in order of seniority, covenants and
 * the exit; on the right, the outcome as distributions: the MOIC fan by year, the IRR histogram, the breach
 * heatmap (years against covenants), the attribution with its bands, the max-price curve (price against the
 * chance of clearing the hurdle) and the gentlest path to a breach. Everything is labelled SYNTHETIC with its
 * recipe and seed; "Refine" (premium) reruns it on 20,000 paths over up to seven years; "Send to Studio"
 * pushes a labelled sheet. On a phone the lab is simplified to the entry multiple and leverage sliders, the
 * IRR distribution, the breach odds and the breach sentence; tranches are edited on a tablet or desktop.
 */
import { ArrowDown, ArrowUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { usePhone } from "@/components/ui/useMedia";
import { errorMessage } from "@/lib/client/errors";
import type { Covenants, Tranche } from "@/lib/edge/scen/lbo";
import type { StressResult } from "@/lib/edge/scen/stress";
import { api, post } from "../client";
import { SendToStudio } from "../SendToStudio";
import { SyntheticTag } from "./parts";

type Lab = {
  title: string; name: string; ticker: string; recipe: string; seed: number; paths: number; refined: boolean; ranOn: string;
  inputs: { revenue: number; ebitda: number; capexPct: number; daPct: number; growth: number; fy: string; source: string; sourcesUses: { entryTev: number; debt0: number; fees: number; uses: number; equity: number } };
  entry: { multiple: number; source: string; band: string | null }; exit: { base: number; sigma: number; elasticity: number; source: string };
  assumptions: string[]; realism: { score: number; warnings: string[] } | null; structure: { covenants: Covenants; tranches: Tranche[]; years: number };
  result: StressResult;
};

const DEFAULT_TRANCHES: Tranche[] = [
  { name: "Term loan B", kind: "tlb", turns: 4, floating: true, spreadBps: 350, floorPct: 0.5, oid: 99, amortPct: 1, prepayable: true },
  { name: "Senior notes", kind: "notes", turns: 1.5, floating: false, fixedPct: 8.5, amortPct: 0, prepayable: false },
  { name: "Revolver", kind: "revolver", turns: 1, floating: true, spreadBps: 325, floorPct: 0, amortPct: 0, prepayable: true },
];
const pc = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(dp)}%`);
const mm = (v: number) => (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}bn` : `$${(v / 1e6).toFixed(0)}m`);
const num = (v: string) => (v.trim() === "" ? undefined : Number(v));

function MoicFan({ fan }: { fan: StressResult["fan"] }) {
  const W = 420, H = 150, L = 34, R = 8, T = 10, B = 18;
  const all = fan.flatMap((f) => [f.p5, f.p95]).filter(Number.isFinite).concat([0, 1]);
  const lo = Math.min(...all), hi = Math.max(...all), span = hi - lo || 1;
  const x = (k: number) => L + (k / Math.max(1, fan.length - 1)) * (W - L - R), y = (v: number) => T + (1 - (v - lo) / span) * (H - T - B);
  const band = (a: (f: StressResult["fan"][number]) => number, b: (f: StressResult["fan"][number]) => number) => `M${fan.map((f, k) => `${x(k)},${y(a(f))}`).join(" L")} L${[...fan].reverse().map((f, i) => `${x(fan.length - 1 - i)},${y(b(f))}`).join(" L")} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`MOIC if exited each year: median ${fan.at(-1)?.p50.toFixed(2)}x in year ${fan.length}, 90% of paths ${fan.at(-1)?.p5.toFixed(2)}x to ${fan.at(-1)?.p95.toFixed(2)}x`}>
      <line x1={L} x2={W - R} y1={y(1)} y2={y(1)} stroke="var(--line-strong)" strokeDasharray="3 3" />
      <text x={L - 4} y={y(1) + 3} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>1.0x</text>
      <path d={band((f) => f.p5, (f) => f.p95)} fill="var(--accent)" opacity={0.14} />
      <path d={band((f) => f.p25, (f) => f.p75)} fill="var(--accent)" opacity={0.24} />
      <path d={`M${fan.map((f, k) => `${x(k)},${y(f.p50)}`).join(" L")}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {fan.map((f, k) => <text key={k} x={x(k)} y={H - 4} textAnchor="middle" style={{ font: "10px var(--font-sans, system-ui)", fill: "var(--muted)" }}>Y{f.year}</text>)}
      <text x={L + 4} y={T + 9} style={{ font: "600 10px var(--font-sans, system-ui)", fill: "var(--accent)", letterSpacing: "0.08em" }}>SYNTHETIC</text>
    </svg>
  );
}

function IrrHistogram({ h, hurdle }: { h: StressResult["histogram"]; hurdle: number }) {
  const W = 320, H = 100, max = Math.max(1, ...h.map((b) => b.n)), bw = W / Math.max(1, h.length);
  const lo = h[0]?.lo ?? 0, hi = h.at(-1)?.hi ?? 1, xAt = (v: number) => ((v - lo) / (hi - lo || 1)) * W;
  return (
    <svg viewBox={`0 0 ${W} ${H + 14}`} className="block h-auto w-full" role="img" aria-label="Distribution of IRR across the paths">
      {h.map((b, i) => <rect key={i} x={i * bw + 0.5} y={H - (b.n / max) * H} width={Math.max(1, bw - 1)} height={(b.n / max) * H} fill={b.hi <= 0 ? "var(--neg)" : "var(--accent)"} opacity={0.6} />)}
      {hurdle >= lo && hurdle <= hi && <line x1={xAt(hurdle)} x2={xAt(hurdle)} y1={0} y2={H} stroke="var(--info)" strokeDasharray="3 2" />}
      <text x={0} y={H + 12} style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{pc(lo)}</text>
      <text x={W} y={H + 12} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{pc(hi)}</text>
    </svg>
  );
}

function Heatmap({ rows }: { rows: StressResult["heatmap"] }) {
  const cell = (p: number) => ({ background: `color-mix(in oklab, var(--color-neg) ${Math.round(Math.min(1, p * 2) * 100)}%, transparent)` });
  return (
    <table className="w-full text-[11px]" aria-label="Chance each covenant test fails in a quarter of each year">
      <thead><tr className="text-[10px] uppercase tracking-wider text-muted"><th className="py-0.5 text-left font-normal">Year</th>{rows.map((r) => <th key={r.year} className="font-normal">Y{r.year}</th>)}</tr></thead>
      <tbody>
        <tr><td className="py-0.5 pr-2 text-muted">Net leverage</td>{rows.map((r) => <td key={r.year} className="num rounded text-center" style={cell(r.leverage)}>{pc(r.leverage)}</td>)}</tr>
        <tr><td className="py-0.5 pr-2 text-muted">Interest cover</td>{rows.map((r) => <td key={r.year} className="num rounded text-center" style={cell(r.cover)}>{pc(r.cover)}</td>)}</tr>
      </tbody>
    </table>
  );
}

function PriceCurve({ mp }: { mp: StressResult["maxPrice"] }) {
  const W = 320, H = 110, L = 30, B = 16;
  const xs = mp.curve.map((c) => c.multiple), lo = Math.min(...xs), hi = Math.max(...xs);
  const x = (m: number) => L + ((m - lo) / (hi - lo || 1)) * (W - L - 6), y = (p: number) => 6 + (1 - p) * (H - B - 6);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={`Chance of at least ${pc(mp.hurdle)} IRR against the entry multiple; the most a sponsor can pay with ${pc(mp.confidence)} confidence is ${mp.multiple ? `${mp.multiple.toFixed(1)}x` : "below the range"}`}>
      <line x1={L} x2={W - 6} y1={y(mp.confidence)} y2={y(mp.confidence)} stroke="var(--info)" strokeDasharray="3 2" />
      <text x={L - 3} y={y(mp.confidence) + 3} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--info)" }}>{pc(mp.confidence)}</text>
      <path d={`M${mp.curve.map((c) => `${x(c.multiple)},${y(c.prob)}`).join(" L")}`} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {mp.multiple && mp.multiple >= lo && mp.multiple <= hi && <circle cx={x(mp.multiple)} cy={y(mp.confidence)} r={3.5} fill="var(--accent)" />}
      <text x={L} y={H - 3} style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{lo.toFixed(1)}x</text>
      <text x={W - 6} y={H - 3} textAnchor="end" style={{ font: "10px var(--font-mono, monospace)", fill: "var(--muted)" }}>{hi.toFixed(1)}x</text>
    </svg>
  );
}

function Attribution({ rows }: { rows: StressResult["attribution"] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.p10), Math.abs(r.p90)]));
  const at = (v: number) => 50 + (v / max) * 50;
  return (
    <ul className="space-y-1 text-[11.5px]" aria-label="Returns attribution: median with its 10th to 90th percentile band">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_64px] items-center gap-2">
          <span className="truncate text-muted">{r.label}</span>
          <span className="relative h-3"><span className="absolute inset-y-0 left-1/2 w-px bg-line" /><span className="absolute inset-y-1 rounded bg-accent/25" style={{ left: `${Math.min(at(r.p10), at(r.p90))}%`, width: `${Math.abs(at(r.p90) - at(r.p10))}%` }} /><span className="absolute inset-y-0 w-0.5 bg-accent" style={{ left: `${at(r.p50)}%` }} /></span>
          <span className="num text-right">{mm(r.p50)}</span>
        </li>
      ))}
    </ul>
  );
}

function Results({ lab, id, status, onRefine, refining, err }: { lab: Lab; id: number | null; status: string; onRefine: () => void; refining: boolean; err: unknown }) {
  const r = lab.result, by = Math.min(3, r.years);
  const table = { title: `${lab.title} (synthetic)`, synthetic: { recipe: lab.recipe, seed: lab.seed, ...(lab.realism ? { realism: lab.realism.score } : {}) }, columns: [{ name: "measure", type: "text" }, { name: "value", type: "text" }], rows: [
    ["Paths", String(r.paths)], ["Median IRR", pc(r.irr.p50, 1)], ["IRR 10th to 90th percentile", `${pc(r.irr.p10)} to ${pc(r.irr.p90)}`], ["Median MOIC", `${r.moic.p50.toFixed(2)}x`],
    ["Chance of MOIC under 1x", pc(r.odds.moicBelowOne)], ...r.breachByYear.map((b, k) => [`Covenant breach by year ${k + 1}`, pc(b)]), ["Chance equity ends under half of entry", pc(r.odds.equityBelowHalf)],
    ["Most a sponsor can pay", r.maxPrice.multiple ? `${r.maxPrice.multiple.toFixed(1)}x EBITDA for ${pc(r.maxPrice.hurdle)} IRR with ${pc(r.maxPrice.confidence)} probability` : "no price clears the line"], ["Gentlest scenario that breaks it", r.reverse.sentence],
  ] };
  return (
    <div className="space-y-3">
      <SyntheticTag recipe={lab.recipe} seed={lab.seed} paths={r.paths} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[["Median IRR", pc(r.irr.p50, 1), `10th-90th ${pc(r.irr.p10)} to ${pc(r.irr.p90)}`], ["Chance of losing money", pc(r.odds.moicBelowOne), `MOIC under 1x`], [`Breach by year ${by}`, pc(r.breachByYear[by - 1]), `any breach ${pc(r.odds.breachAny)}`], ["Most a sponsor can pay", r.maxPrice.multiple ? `${r.maxPrice.multiple.toFixed(1)}x` : "—", `${pc(r.maxPrice.hurdle)} IRR, ${pc(r.maxPrice.confidence)} sure`]].map(([k, v, s]) => (
          <div key={k} className="rounded-lg border border-line p-2"><div className="text-[10.5px] text-muted">{k}</div><div className="num text-[18px] font-semibold">{v}</div><div className="text-[10px] text-faint">{s}</div></div>
        ))}
      </div>
      <section className="rounded-lg border-l-2 border-neg bg-neg/5 px-3 py-2"><h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">The gentlest path to a breach</h4><p className="mt-0.5 text-[12.5px]">{r.reverse.sentence}</p></section>
      <div className="grid gap-3 md:grid-cols-2">
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">MOIC if exited each year</h4><MoicFan fan={r.fan} /></section>
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">IRR across paths (hurdle dashed)</h4><IrrHistogram h={r.histogram} hurdle={r.maxPrice.hurdle} /></section>
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Covenant tests failing, by year</h4><Heatmap rows={r.heatmap} /><p className="mt-1 text-[10.5px] text-muted">First breach by year: {r.breachByYear.map((b, k) => `Y${k + 1} ${pc(b)}`).join(" · ")}. Liquidity defaults: {pc(r.odds.defaulted, 1)}.</p></section>
        <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Price against the chance of {pc(r.maxPrice.hurdle)} IRR</h4><PriceCurve mp={r.maxPrice} /></section>
      </div>
      <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Where the returns come from (median, 10th-90th band)</h4><Attribution rows={r.attribution} /></section>
      <p className="text-[11px] text-muted">{r.base.note} It gives an IRR of {pc(r.base.irr, 1)}; the paths above show how wide the outcomes really are.</p>
      <details className="text-[11px] text-muted"><summary className="cursor-pointer text-fg">Inputs and assumptions</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>{lab.inputs.source}: revenue {mm(lab.inputs.revenue)}, EBITDA {mm(lab.inputs.ebitda)}; entry {lab.entry.multiple.toFixed(1)}x ({lab.entry.source}){lab.entry.band ? `. ${lab.entry.band}` : ""}.</li>
          <li>Sources and uses: enterprise value {mm(lab.inputs.sourcesUses.entryTev)}, debt {mm(lab.inputs.sourcesUses.debt0)}, fees {mm(lab.inputs.sourcesUses.fees)}, sponsor equity {mm(lab.inputs.sourcesUses.equity)}.</li>
          {lab.assumptions.map((a) => <li key={a}>{a}</li>)}
          {lab.realism && <li>Realism of the macro paths against history: {lab.realism.score} / 100{lab.realism.warnings.length ? ` (${lab.realism.warnings.join(" ")})` : ""}.</li>}
        </ul>
      </details>
      <div className="flex flex-wrap items-center gap-2">
        {id && <button type="button" onClick={onRefine} disabled={refining || status === "refining" || lab.refined} className="ctl inline-flex items-center gap-1 border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg disabled:opacity-50">{refining || status === "refining" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}{lab.refined ? `Refined (${r.paths.toLocaleString("en-US")} paths, ${lab.ranOn})` : status === "refining" ? "Refining…" : "Refine: 20,000 paths"} <PremiumBadge feature="edge.lbo-refine" /></button>}
        <SendToStudio title={lab.title} source={`Edge LBO Stress Lab (synthetic, seed ${lab.seed})`} items={[{ label: `${lab.title} (synthetic)`, value: table }]} />
      </div>
      {err ? <PlanNotice error={err} /> : null}
    </div>
  );
}

export function LboTab({ suggest, initial }: { suggest: string[]; initial?: string | null }) {
  const phone = usePhone();
  const [ticker, setTicker] = useState(initial ?? suggest[0] ?? "");
  const [priv, setPriv] = useState(false);
  const [manual, setManual] = useState({ name: "", revenue: "", ebitda: "", capexPct: "40", daPct: "30", growth: "4" });
  const [entry, setEntry] = useState(""), [exit, setExit] = useState(""), [elasticity, setElasticity] = useState("0.5");
  const [tranches, setTranches] = useState<Tranche[]>(DEFAULT_TRANCHES);
  const [cov, setCov] = useState<{ lev: string; cover: string; springing: boolean }>({ lev: "7", cover: "1.75", springing: false });
  const [years, setYears] = useState(5), [hurdle, setHurdle] = useState("20"), [breakYear, setBreakYear] = useState(3);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<unknown>(null);
  const [lab, setLab] = useState<Lab | null>(null), [id, setId] = useState<number | null>(null), [status, setStatus] = useState("preview");
  const [refining, setRefining] = useState(false), [refErr, setRefErr] = useState<unknown>(null);
  const setTr = (i: number, patch: Partial<Tranche>) => setTranches((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const move = (i: number, d: -1 | 1) => setTranches((ts) => { const n = [...ts]; const j = i + d; if (j < 0 || j >= n.length) return ts; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const body = {
        kind: "lbo", ...(priv ? { manual: { name: manual.name || "Private target", revenue: (num(manual.revenue) ?? 0) * 1e6, ebitda: (num(manual.ebitda) ?? 0) * 1e6, capexPct: num(manual.capexPct), daPct: num(manual.daPct), growth: (num(manual.growth) ?? 4) / 100 } } : { ticker: ticker.trim().toUpperCase() }),
        entryMultiple: num(entry), exitMultiple: num(exit), exitElasticity: num(elasticity), tranches, years, hurdle: (num(hurdle) ?? 20) / 100, breakYear: Math.min(breakYear, years),
        covenants: { maxNetLeverage: cov.lev.trim() ? Number(cov.lev) : null, minInterestCover: cov.cover.trim() ? Number(cov.cover) : null, springing: cov.springing, springAt: 0.35 },
      };
      const r = await post<{ id: number; status: string; result: Lab }>("/api/edge/scenarios", body);
      setLab(r.result); setId(r.id); setStatus(r.status);
    } catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setBusy(false); }
  };
  const refine = async () => {
    if (!id) return;
    setRefining(true); setRefErr(null);
    try { const r = await post<{ status: string }>(`/api/edge/scenarios/${id}/refine`, {}); setStatus(r.status); }
    catch (e) { setRefErr(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setRefining(false); }
  };
  // While a refine runs, ask for its status every few seconds; when it is ready, load the larger result.
  useEffect(() => {
    if (status !== "refining" || !id) return;
    let live = true;
    const t = setInterval(async () => {
      try {
        const s = await api<{ status: string }>(`/api/edge/scenarios/${id}?status=1`);
        if (!live || s.status === "refining") return;
        const full = await api<{ status: string; result: Lab }>(`/api/edge/scenarios/${id}`);
        if (live) { setLab(full.result); setStatus(full.status); }
      } catch { /* the next tick tries again */ }
    }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [status, id]);
  const tlb = tranches.find((t) => t.kind === "tlb");
  return (
    <div className={`grid gap-3 ${phone ? "" : "lg:grid-cols-[360px_minmax(0,1fr)]"}`}>
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="panel space-y-2.5 p-3 text-[12px]">
        <div className="flex items-center justify-between gap-2"><h3 className="text-[13px] font-semibold">LBO Stress Lab</h3><label className="inline-flex items-center gap-1 text-[11.5px] text-muted"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} className="accent-[var(--accent)]" />Private target</label></div>
        {!priv ? (
          <label className="block"><span className="text-muted">Company</span><input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} list="lbo-suggest" placeholder="Ticker" className="ctl mt-0.5 w-full border border-line bg-transparent px-2 py-1 uppercase outline-none" /><datalist id="lbo-suggest">{suggest.map((t) => <option key={t} value={t} />)}</datalist></label>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <input value={manual.name} onChange={(e) => setManual({ ...manual, name: e.target.value })} placeholder="Name" className="ctl col-span-2 border border-line bg-transparent px-2 py-1 outline-none" aria-label="Target name" />
            {([["revenue", "Revenue ($m)"], ["ebitda", "EBITDA ($m)"], ["capexPct", "Capex (% of EBITDA)"], ["daPct", "D&A (% of EBITDA)"], ["growth", "Growth (% a year)"]] as const).map(([k, l]) => <label key={k} className="block"><span className="text-[10.5px] text-muted">{l}</span><input value={manual[k]} onChange={(e) => setManual({ ...manual, [k]: e.target.value })} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>)}
          </div>
        )}
        <div className="grid grid-cols-2 gap-1.5">
          <label className="block"><span className="text-[10.5px] text-muted">Entry (x EBITDA; blank: precedents)</span><input value={entry} onChange={(e) => setEntry(e.target.value)} inputMode="decimal" placeholder="from E1" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Hold (years)</span><input type="number" min={2} max={7} value={years} onChange={(e) => setYears(Math.max(2, Math.min(7, Number(e.target.value) || 5)))} className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
        </div>
        {phone ? (
          <label className="block"><span className="text-[10.5px] text-muted">Term loan: {tlb?.turns.toFixed(2)}x EBITDA</span><input type="range" min={0} max={7} step={0.25} value={tlb?.turns ?? 4} onChange={(e) => setTranches((ts) => ts.map((t) => (t.kind === "tlb" ? { ...t, turns: Number(e.target.value) } : t)))} className="w-full accent-[var(--accent)]" /></label>
        ) : (
          <fieldset className="space-y-1"><legend className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">Structure, most senior first</legend>
            {tranches.map((t, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_52px_64px_auto] items-center gap-1 rounded-md border border-line p-1">
                <input value={t.name} onChange={(e) => setTr(i, { name: e.target.value })} className="min-w-0 bg-transparent text-[11.5px] outline-none" aria-label="Tranche name" />
                <input value={t.turns} onChange={(e) => setTr(i, { turns: Number(e.target.value) || 0 })} inputMode="decimal" className="ctl border border-line bg-transparent px-1 py-0.5 text-right text-[11px]" aria-label={`${t.name} turns of EBITDA`} title="turns of EBITDA" />
                {t.floating ? <input value={t.spreadBps ?? 0} onChange={(e) => setTr(i, { spreadBps: Number(e.target.value) || 0 })} inputMode="decimal" className="ctl border border-line bg-transparent px-1 py-0.5 text-right text-[11px]" aria-label={`${t.name} spread over SOFR in bp`} title="SOFR + bp" /> : <input value={t.fixedPct ?? 0} onChange={(e) => setTr(i, { fixedPct: Number(e.target.value) || 0 })} inputMode="decimal" className="ctl border border-line bg-transparent px-1 py-0.5 text-right text-[11px]" aria-label={`${t.name} fixed coupon %`} title="fixed %" />}
                <span className="flex items-center"><button type="button" onClick={() => move(i, -1)} aria-label="Move up" className="p-0.5 text-muted hover:text-fg"><ArrowUp className="h-3 w-3" /></button><button type="button" onClick={() => move(i, 1)} aria-label="Move down" className="p-0.5 text-muted hover:text-fg"><ArrowDown className="h-3 w-3" /></button><button type="button" onClick={() => setTranches((ts) => ts.filter((_, k) => k !== i))} aria-label="Remove" className="p-0.5 text-muted hover:text-neg"><Trash2 className="h-3 w-3" /></button></span>
                <div className="col-span-4 flex flex-wrap gap-x-2 text-[10.5px] text-muted">
                  <select value={t.kind} onChange={(e) => setTr(i, { kind: e.target.value as Tranche["kind"], floating: e.target.value === "tlb" || e.target.value === "revolver" })} className="bg-transparent" aria-label="Kind"><option value="tlb">Term loan</option><option value="notes">Notes</option><option value="second">Second lien</option><option value="revolver">Revolver</option></select>
                  <label className="inline-flex items-center gap-1"><input type="checkbox" checked={t.floating} onChange={(e) => setTr(i, { floating: e.target.checked })} />floating</label>
                  {t.floating && <label className="inline-flex items-center gap-1">floor <input value={t.floorPct ?? 0} onChange={(e) => setTr(i, { floorPct: Number(e.target.value) || 0 })} className="w-8 bg-transparent" />%</label>}
                  {t.kind !== "revolver" && <label className="inline-flex items-center gap-1">amort <input value={t.amortPct ?? 0} onChange={(e) => setTr(i, { amortPct: Number(e.target.value) || 0 })} className="w-8 bg-transparent" />%/yr</label>}
                  <label className="inline-flex items-center gap-1"><input type="checkbox" checked={t.prepayable} onChange={(e) => setTr(i, { prepayable: e.target.checked })} />sweep</label>
                </div>
              </div>
            ))}
            <button type="button" onClick={() => setTranches((ts) => [...ts, { name: "Second lien", kind: "second", turns: 1, floating: false, fixedPct: 11, amortPct: 0, prepayable: true }])} className="inline-flex items-center gap-1 text-[11px] text-muted hover:text-fg"><Plus className="h-3 w-3" />Add a tranche</button>
          </fieldset>
        )}
        <div className="grid grid-cols-3 gap-1.5">
          <label className="block"><span className="text-[10.5px] text-muted">Max net leverage</span><input value={cov.lev} onChange={(e) => setCov({ ...cov, lev: e.target.value })} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Min interest cover</span><input value={cov.cover} onChange={(e) => setCov({ ...cov, cover: e.target.value })} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Breaks by year</span><input type="number" min={1} max={years} value={breakYear} onChange={(e) => setBreakYear(Math.max(1, Math.min(years, Number(e.target.value) || 3)))} className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
        </div>
        <label className="inline-flex items-center gap-1.5 text-[11.5px] text-muted"><input type="checkbox" checked={cov.springing} onChange={(e) => setCov({ ...cov, springing: e.target.checked })} />Covenant-lite: test only when the revolver is over 35% drawn</label>
        {!phone && <div className="grid grid-cols-3 gap-1.5">
          <label className="block"><span className="text-[10.5px] text-muted">Exit (x; blank: deals)</span><input value={exit} onChange={(e) => setExit(e.target.value)} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Exit-to-market elasticity</span><input value={elasticity} onChange={(e) => setElasticity(e.target.value)} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
          <label className="block"><span className="text-[10.5px] text-muted">Hurdle IRR (%)</span><input value={hurdle} onChange={(e) => setHurdle(e.target.value)} inputMode="decimal" className="ctl w-full border border-line bg-transparent px-2 py-1 outline-none" /></label>
        </div>}
        <button type="submit" disabled={busy || (!priv && !ticker.trim())} className="ctl inline-flex w-full items-center justify-center gap-1 bg-accent px-2.5 py-1.5 font-semibold text-accent-fg disabled:opacity-50">{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}Run 1,000 paths</button>
        <p className="text-[10.5px] text-faint">Free: 1,000 paths over up to seven years, the reverse stress test and the Studio push. Every number is synthetic, with its recipe and seed.</p>
        {err ? <PlanNotice error={err} /> : null}
      </form>
      <div className="panel min-w-0 p-3">
        {busy && !lab && <div aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-64 rounded" /></div>}
        {!busy && !lab && <p className="text-[12.5px] text-muted">Pick a company (or type a private target&apos;s figures) and run. The lab simulates rates, the market and the company&apos;s own results, runs the buyout down every path, and shows the odds of a covenant breach, the IRR range, the most a sponsor can pay at a hurdle, and the gentlest scenario that breaks the deal.</p>}
        {lab && <Results lab={lab} id={id} status={status} onRefine={refine} refining={refining} err={refErr} />}
      </div>
    </div>
  );
}

/** A saved LBO stress test reopened from Saved, with its refine. */
export function LboSaved({ id, result, status: initialStatus }: { id: number; result: unknown; status: string }) {
  const [lab, setLab] = useState(result as Lab), [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<unknown>(null);
  useEffect(() => {
    if (status !== "refining") return;
    let live = true;
    const t = setInterval(async () => {
      try { const s = await api<{ status: string }>(`/api/edge/scenarios/${id}?status=1`); if (!live || s.status === "refining") return; const full = await api<{ status: string; result: Lab }>(`/api/edge/scenarios/${id}`); if (live) { setLab(full.result); setStatus(full.status); } } catch { /* next tick */ }
    }, 5000);
    return () => { live = false; clearInterval(t); };
  }, [status, id]);
  const refine = async () => { setBusy(true); setErr(null); try { setStatus((await post<{ status: string }>(`/api/edge/scenarios/${id}/refine`, {})).status); } catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); } finally { setBusy(false); } };
  if (!lab?.result) return <p className="text-[12px] text-muted">This stress test has no result stored.</p>;
  return <div className="panel p-3"><h3 className="mb-2 text-[14px] font-semibold">{lab.title}</h3><Results lab={lab} id={id} status={status} onRefine={refine} refining={busy} err={err} /></div>;
}
