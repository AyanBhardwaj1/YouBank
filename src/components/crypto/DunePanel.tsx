"use client";

/**
 * Premium: load a saved Dune query's latest results (on-chain SQL someone has already written:
 * exchange flows, whale cohorts, a protocol's users) into a sortable table, and download it as CSV.
 * Runs only on a click; the server checks the plan before calling Dune.
 */
import { useState } from "react";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { DataTable } from "@/components/terminal/kit";
import type { DuneResult } from "@/lib/crypto/dune";

const cell = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { maximumFractionDigits: 4 })) : typeof v === "object" ? JSON.stringify(v) : String(v));
const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function DunePanel() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ busy: boolean; data?: DuneResult; error?: string }>({ busy: false });
  const run = async () => {
    setState({ busy: true });
    try {
      const res = await fetch("/api/crypto/dune", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ queryId: q.trim() }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Dune did not return results");
      setState({ busy: false, data: j as DuneResult });
    } catch (e) { setState({ busy: false, error: e instanceof Error ? e.message : "Dune did not return results" }); }
  };
  const download = () => {
    const d = state.data;
    if (!d) return;
    const text = [d.columns.map(csvCell).join(","), ...d.rows.map((r) => d.columns.map((c) => csvCell(r[c])).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
    a.download = `dune-${d.queryId}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <PremiumGate feature="crypto.dune">
      <div className="flex flex-col gap-3">
        <div className="ctl border border-line bg-panel p-3">
          <h3 className="flex items-center gap-2 text-[12.5px] font-semibold">Dune query <PremiumBadge feature="crypto.dune" /></h3>
          <p className="mt-1 text-[11.5px] text-muted">Paste a Dune query link or number. YouBank loads its latest saved results (up to 500 rows); re-run the query on Dune first if you need fresher numbers.</p>
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(); }} className="mt-2 flex gap-1.5">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="https://dune.com/queries/1234567 or 1234567" className="ctl min-w-0 flex-1 border border-line bg-bg px-2 py-1 text-[12px] outline-none focus:border-accent/60" />
            <button type="submit" disabled={state.busy || !q.trim()} className="ctl bg-accent px-3 py-1 text-[12px] font-semibold text-bg disabled:opacity-40">{state.busy ? "Loading…" : "Load results"}</button>
          </form>
          {state.error && <p className="mt-2 text-[11.5px] text-neg">{state.error}</p>}
        </div>
        {state.data && (
          <div className="ctl border border-line bg-panel p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11.5px]">
              <a href={state.data.source.url} target="_blank" rel="noreferrer" className="font-semibold text-info hover:underline">{state.data.source.name} ↗</a>
              <span className="text-muted">{state.data.rows.length.toLocaleString("en-US")} of {state.data.rowCount.toLocaleString("en-US")} rows{state.data.executedAt ? `, run ${state.data.executedAt.slice(0, 16).replace("T", " ")} UTC` : ""}</span>
              <button type="button" onClick={download} className="ml-auto ctl border border-line px-2 py-0.5 hover:border-accent/60">Download CSV</button>
            </div>
            <DataTable rows={state.data.rows} rowKey={(_, i) => String(i)} max={500} columns={state.data.columns.map((c) => ({ key: c, label: c, align: "left" as const, value: (r: Record<string, unknown>) => { const v = r[c]; return typeof v === "number" ? v : v === null || v === undefined ? null : String(v); }, render: (r: Record<string, unknown>) => <span className="block max-w-[260px] truncate" title={cell(r[c])}>{cell(r[c])}</span> }))} />
          </div>
        )}
      </div>
    </PremiumGate>
  );
}
