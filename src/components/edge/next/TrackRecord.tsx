"use client";

/**
 * The Track record (F3): how every probability Edge stated about the future turned out. One panel per
 * model: its reliability diagram, Brier skill against the base rates it showed with a 90% interval, how
 * many forecasts resolved and how many are still open, and the latest resolved, anonymised. Nobody else
 * publishes this; it is what makes the odds elsewhere in Edge worth reading. On a phone the panels stack.
 */
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { useApi } from "../client";
import { pct, ReliabilityDiagram } from "./charts";
import type { TrackPanel } from "@/lib/edge/forecasts/ledger";

const KIND_LABEL: Record<string, string> = {
  deal_target: "Deal Radar: sale within 12 months", deal_acquirer: "Deal Radar: material acquisition", guidance: "Call Desk: management guidance",
  thesis_claim: "Thesis Agent: claims", evasion_followup: "Call Desk: after evasive answers", buyer_win: "Buyer Simulator: winners", rule_final: "Regulatory rules: finalised",
};

function Panel({ p }: { p: TrackPanel }) {
  return (
    <section className="panel p-3.5">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[14px] font-semibold tracking-tight">{KIND_LABEL[p.kind] ?? p.kind.replace(/_/g, " ")}{p.manual ? " (settled by hand)" : ""}</h3>
          <div className="mt-0.5 text-[11px] text-muted">Model {p.model} · versions {p.versions.join(", ") || "—"} · scored at {Math.round(p.horizonDays / 30)} month{p.horizonDays >= 60 ? "s" : ""} before the close</div>
        </div>
        <div className="flex gap-3 text-[11px]">
          <span><span className="num text-[15px] font-semibold text-fg">{p.n}</span> <span className="text-muted">resolved</span></span>
          <span><span className="num text-[15px] font-semibold text-fg">{p.pending}</span> <span className="text-muted">open</span></span>
        </div>
      </header>
      <div className="mt-3 grid gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="mx-auto md:mx-0"><ReliabilityDiagram bins={p.bins} /></div>
        <div className="min-w-0 space-y-2.5">
          <p className="rounded-md border-l-2 border-accent bg-accent-soft/40 px-2.5 py-1.5 text-[12.5px] leading-relaxed">{p.verdict}</p>
          <dl className="grid grid-cols-2 gap-2 text-[11.5px] sm:grid-cols-4">
            <div><dt className="text-muted">Brier</dt><dd className="num text-fg">{p.brier === null ? "—" : p.brier.toFixed(3)}</dd></div>
            <div><dt className="text-muted">Base-rate Brier</dt><dd className="num text-fg">{p.baseBrier === null ? "—" : p.baseBrier.toFixed(3)}</dd></div>
            <div><dt className="text-muted">Brier skill</dt><dd className="num text-fg">{pct(p.skill)}{p.skillCi ? <span className="text-muted"> ({pct(p.skillCi[0])} to {pct(p.skillCi[1])})</span> : null}</dd></div>
            <div><dt className="text-muted">Calibration error</dt><dd className="num text-fg">{p.ece === null ? "—" : pct(p.ece, 1)}</dd></div>
          </dl>
          {p.recent.length > 0 ? (
            <div>
              <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Resolved lately</div>
              <ul className="divide-y divide-line rounded-md border border-line text-[11.5px]">
                {p.recent.slice(0, 8).map((r, i) => (
                  <li key={i} className="flex items-center gap-2 px-2 py-1.5">
                    {r.outcome >= 0.5 ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-pos" aria-label="Happened" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Did not happen" />}
                    <span className="min-w-0 flex-1 truncate" title={r.question}>{r.label}: {r.question}</span>
                    <span className="num shrink-0 text-muted">said {pct(r.probability)}</span>
                    <span className="num hidden shrink-0 text-faint sm:inline">{r.resolvedAt.slice(0, 10)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : <p className="flex items-center gap-1.5 text-[11.5px] text-muted"><Clock className="h-3.5 w-3.5" /> The first of these resolve when their windows close. Every forecast was logged when it was made and cannot be edited.</p>}
        </div>
      </div>
    </section>
  );
}

export function TrackRecord() {
  const { data, error, loading } = useApi<{ panels: TrackPanel[]; mine: TrackPanel[]; generatedAt: string }>("/api/edge/track?mine=1");
  return (
    <div className="space-y-3">
      <div className="panel p-3.5 text-[12.5px] leading-relaxed">
        <h2 className="text-[15px] font-semibold tracking-tight">Track record</h2>
        <p className="mt-1 max-w-[80ch] text-muted">Every probability Edge states about the future is logged when it is made, with a rule that settles it from public records, and scored when its window closes. A model is scored on the estimate it stood by well before the outcome, not its last-minute update. If a model does no better than simply stating the base rate, this page says so.</p>
      </div>
      {error && <p className="panel px-3 py-2 text-[12px] text-neg">The track record did not load: {error}</p>}
      {!data && !error && <div className="panel h-[320px] p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-[240px] rounded-lg" /></div>}
      {data && !data.panels.length && !loading && <p className="panel px-3 py-3 text-[12.5px] text-muted">No forecasts yet. Deal Radar logs its first ones after its first scoring.</p>}
      {data?.panels.map((p) => <Panel key={`${p.kind}-${p.model}-${p.manual}`} p={p} />)}
      {data && data.mine.length > 0 && (
        <>
          <h3 className="px-1 pt-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">Your own forecasts</h3>
          {data.mine.map((p) => <Panel key={`mine-${p.kind}-${p.model}-${p.manual}`} p={p} />)}
        </>
      )}
    </div>
  );
}
