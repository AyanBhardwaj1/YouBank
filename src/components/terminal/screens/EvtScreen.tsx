"use client";

import { useEffect, useMemo, useState } from "react";
import type { Command } from "@/lib/functions";

type Filing = { form: string; filed: string; period: string; items: string; title: string; url: string; index: string; accession: string };

const ITEMS: Record<string, string> = {
  "1.01": "Material agreement", "1.02": "Agreement terminated", "1.03": "Bankruptcy", "1.05": "Cybersecurity incident", "2.01": "Acquisition or disposition completed", "2.02": "Results of operations", "2.03": "Debt or off-balance-sheet obligation",
  "2.04": "Triggering event / acceleration", "2.05": "Exit or disposal costs", "2.06": "Material impairment", "3.01": "Delisting notice", "3.02": "Unregistered equity sale", "3.03": "Security holder rights modified", "4.01": "Auditor change", "4.02": "Non-reliance on financials (restatement)",
  "5.01": "Change in control", "5.02": "Officer or director change", "5.03": "Bylaw or fiscal year change", "5.07": "Shareholder vote", "5.08": "Shareholder nominations", "7.01": "Reg FD disclosure", "8.01": "Other events", "9.01": "Exhibits",
};
const HOT = new Set(["1.03", "2.04", "4.02", "4.01", "2.06", "5.01", "1.01", "2.01", "5.02"]);
const FORM_FAMILIES = ["8-K", "10-Q", "10-K", "DEF 14A", "SC 13D", "SC 13G", "S-4", "DEFM14A", "424B", "4", "D"];

/** Timeline of a company's filings with 8-K item codes decoded and notable events highlighted. */
export function EvtScreen({ ticker, onRun }: { ticker: string; onRun: (c: Command) => void }) {
  const [rows, setRows] = useState<Filing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("");
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/company/${ticker}/filings?limit=100`, { signal: ctrl.signal }).then((r) => r.json()).then((r) => { if (r.error) setError(r.error); else setRows(r.filings); }).catch(() => {});
    return () => ctrl.abort();
  }, [ticker]);
  const list = useMemo(() => (rows ?? []).filter((f) => !filter || f.form === filter || f.form.startsWith(filter)), [rows, filter]);
  const notable = useMemo(() => (rows ?? []).filter((f) => f.form.startsWith("8-K") && f.items.split(",").some((i) => HOT.has(i.trim()))).slice(0, 6), [rows]);
  const families = FORM_FAMILIES.filter((f) => (rows ?? []).some((r) => r.form === f || r.form.startsWith(f)));

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px]">
        <button type="button" onClick={() => setFilter("")} className={`rounded-full border px-2 py-0.5 ${!filter ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All {rows ? rows.length : ""}</button>
        {families.map((f) => <button key={f} type="button" onClick={() => setFilter(filter === f ? "" : f)} className={`rounded-full border px-2 py-0.5 ${filter === f ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{f}</button>)}
        <button type="button" onClick={() => onRun({ ticker, fn: "AI" })} className="ml-auto text-accent hover:underline">✦ Summarize notable events</button>
      </div>
      {notable.length > 0 && !filter && (
        <div className="stagger grid gap-1.5 border-b border-line p-3 sm:grid-cols-2 xl:grid-cols-3">
          {notable.map((f) => (
            <a key={f.accession} href={f.url} target="_blank" rel="noreferrer" className="lift ctl border border-line bg-elevated/60 px-2.5 py-2 text-[11px]">
              <div className="flex items-center justify-between"><span className="num text-muted">{f.filed}</span><span className="rounded bg-accent-soft px-1.5 text-[10px] text-accent">8-K</span></div>
              <div className="mt-0.5 font-medium">{f.items.split(",").map((i) => ITEMS[i.trim()] ?? i.trim()).filter(Boolean).slice(0, 2).join(" · ")}</div>
            </a>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {!rows && !error && <div className="p-3 text-[11px] text-muted">Loading filings…</div>}
        {error && <div className="p-3 text-[11px] text-neg">{error}</div>}
        <ol className="stagger relative ml-5 mr-3 mt-3 border-l border-line pl-4">
          {list.map((f) => {
            const items = f.items ? f.items.split(",").map((i) => i.trim()).filter(Boolean) : [];
            const hot = items.some((i) => HOT.has(i));
            return (
              <li key={f.accession} className="relative mb-2.5 text-[11.5px]">
                <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-panel ${hot ? "bg-accent" : f.form.startsWith("10-") ? "bg-info" : "bg-chart-dim"}`} />
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="num text-muted">{f.filed}</span>
                  <span className={`num rounded px-1.5 text-[10px] font-semibold ${f.form.startsWith("8-K") ? "bg-accent-soft text-accent" : f.form.startsWith("10-") ? "bg-info/15 text-info" : "bg-elevated text-muted"}`}>{f.form}</span>
                  {f.period && <span className="num text-[10px] text-faint">period {f.period}</span>}
                  <a href={f.url} target="_blank" rel="noreferrer" className="ml-auto text-[10.5px] text-muted hover:text-info">open ↗</a>
                </div>
                <div className="mt-0.5 text-fg/90">{items.length ? items.map((i) => ITEMS[i] ? `${i} ${ITEMS[i]}` : i).join(" · ") : f.title}</div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
