"use client";

import { useEffect, useState } from "react";
import type { ConceptMatch, ConceptSeries } from "@/lib/edgar/series";
import { LineChart } from "@/components/charts/LineChart";

const fmtVal = (v: number, unit: string) => (unit === "USD" ? (Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${v.toLocaleString("en-US")}`) : unit === "shares" ? `${(v / 1e6).toFixed(1)}M sh` : unit === "pure" ? v.toFixed(3) : `${v.toLocaleString("en-US")} ${unit}`);

const PRESETS = ["Revenue", "Debt|Notes|Borrowings", "Lease", "Goodwill|Intangible", "IncomeTax", "DeferredRevenue|ContractWithCustomer", "ShareBasedCompensation", "Receivable|Inventory|Payable", "Segment", "Impairment|Restructuring"];

/** Explore any XBRL concept a company reports: regex search over tag names, then chart and tabulate the series. */
export function XbrlScreen({ ticker }: { ticker: string }) {
  const [q, setQ] = useState("Revenue");
  const [matches, setMatches] = useState<ConceptMatch[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<{ concept: string; data: ConceptSeries | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/company/${ticker}/series?find=${encodeURIComponent(q || ".")}`, { signal: ctrl.signal }).then((r) => r.json()).then((r) => { if (r.error) setError(r.error); else { setError(null); setMatches(r.matches); } }).catch(() => {});
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [ticker, q]);

  useEffect(() => {
    if (!selected) return;
    const ctrl = new AbortController();
    fetch(`/api/company/${ticker}/series?concepts=${encodeURIComponent(selected)}&periods=12`, { signal: ctrl.signal }).then((r) => r.json()).then((r) => setLoaded({ concept: selected, data: r.series?.[0] ?? null })).catch(() => {});
    return () => ctrl.abort();
  }, [ticker, selected]);

  const series = loaded && loaded.concept === selected ? loaded.data : null;

  const points = series ? (series.annual.length >= 2 ? series.annual : series.quarterly.length >= 2 ? series.quarterly : series.instants) : [];
  const kind = series ? (series.annual.length >= 2 ? "annual" : series.quarterly.length >= 2 ? "quarterly" : "point-in-time") : "";

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Regex over concept names" spellCheck={false} className="ctl num w-56 border border-line bg-bg px-2 py-1 text-fg placeholder:font-sans placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        {PRESETS.map((p) => <button key={p} type="button" onClick={() => setQ(p)} className={`rounded-full border px-2 py-0.5 ${q === p ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{p.split("|")[0]}</button>)}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(220px,40%)_1fr]">
        <ul className="min-h-0 overflow-auto border-r border-line">
          {!matches && !error && <li className="p-3 text-[11px] text-muted">Searching tags…</li>}
          {error && <li className="p-3 text-[11px] text-neg">{error}</li>}
          {matches?.map((m) => {
            const id = m.taxonomy === "us-gaap" ? m.concept : `${m.taxonomy}:${m.concept}`;
            return (
              <li key={`${m.taxonomy}:${m.concept}:${m.unit}`}>
                <button type="button" onClick={() => setSelected(id)} className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] hover:bg-elevated ${selected === id ? "bg-elevated" : ""}`}>
                  <span className="min-w-0 flex-1 truncate" title={m.concept}><span className={m.taxonomy !== "us-gaap" ? "text-accent" : ""}>{m.taxonomy !== "us-gaap" ? `${m.taxonomy}:` : ""}</span>{m.concept}</span>
                  <span className="num shrink-0 text-[10px] text-muted">{m.unit} · {m.count} · {m.latest.slice(0, 7)}</span>
                </button>
              </li>
            );
          })}
          {matches && matches.length === 0 && <li className="p-3 text-[11px] text-muted">No concepts match.</li>}
        </ul>
        <div className="min-h-0 overflow-auto p-3">
          {!selected && <div className="text-[11px] text-muted">Pick a concept. Extension tags (company-specific) are highlighted.</div>}
          {selected && !series && <div className="shimmer h-40 ctl" />}
          {series && (
            <>
              <div className="mb-2 text-[12px] font-semibold">{series.concept} <span className="num text-[10px] font-normal text-muted">{series.unit} · {kind}</span></div>
              {points.length >= 2 ? <LineChart series={[{ name: series.concept.slice(0, 18), points: points.map((p) => ({ x: p.end.slice(0, 7), y: p.value })) }]} format={(v) => fmtVal(v, series.unit)} height={180} /> : null}
              <table className="num mt-3 w-full text-[11px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">Period end</th><th className="py-1 text-right font-normal">Value</th><th className="py-1 text-right font-normal">Form</th></tr></thead>
                <tbody className="stagger">
                  {[...points].reverse().map((p) => (
                    <tr key={p.end} className="border-b border-line/50"><td className="py-1">{p.end}</td><td className="py-1 text-right">{fmtVal(p.value, series.unit)}</td><td className="py-1 text-right text-muted">{p.form ?? ""}</td></tr>
                  ))}
                </tbody>
              </table>
              {series.error && <div className="mt-2 text-[11px] text-neg">{series.error}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
