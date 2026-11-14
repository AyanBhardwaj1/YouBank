"use client";

/** The person's watched markets (move alerts) and paper forecasts, scored with the Brier score beside the market's own price. */
import { useState } from "react";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import type { Calibration } from "@/lib/book/forecast";
import type { Venue } from "@/lib/predict/types";
import { Change, Empty, prob, useLoad, VenueBadge } from "./ui";

type WatchRow = { key: string; title: string; venue: Venue; url: string; threshold: number; baseProb: number | null; lastProb: number | null; prob: number | null; change24h: number | null; status: string | null; alertedAt: string | null };
type ForecastRow = { id: number; marketKey: string; title: string; venue: string; url: string; p: number; marketP: number | null; day: string; outcome: number | null; brier: number | null; marketBrier: number | null; closeTime: string | null };

export function WatchTab({ onOpen }: { onOpen: (key: string) => void }) {
  const watches = useLoad<{ watches: WatchRow[]; limit: number }>("/api/predict/watch");
  const forecasts = useLoad<{ forecasts: ForecastRow[]; calibration: Calibration; line: string }>("/api/predict/forecast");
  const w = watches.data, f = forecasts.data;
  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? watches.error ?? forecasts.error;
  const load = () => { watches.reload(); forecasts.reload(); };
  const stop = async (key: string) => {
    try { await fetchJson(`/api/predict/watch?key=${encodeURIComponent(key)}`, { method: "DELETE" }); load(); } catch (e) { setActionError(errorMessage(e)); }
  };
  const remove = async (id: number) => {
    try { await fetchJson(`/api/predict/forecast?id=${id}`, { method: "DELETE" }); load(); } catch (e) { setActionError(errorMessage(e)); }
  };
  const today = new Date().toISOString().slice(0, 10);
  const you = f?.calibration.bySource.find((s) => s.source === "You"), market = f?.calibration.bySource.find((s) => s.source === "Market price");

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {error && <p className="rounded-[var(--radius)] border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg lg:col-span-2">{error}</p>}
      <section className="panel min-w-0 p-3">
        <div className="mb-2 flex items-baseline justify-between gap-2"><h3 className="text-[13px] font-semibold text-fg">Watched markets</h3>{w && <span className="text-[11px] text-muted">{w.watches.length} of {w.limit}</span>}</div>
        {!w && <div className="shimmer h-32 ctl" />}
        {w && !w.watches.length && <Empty icon="Bell" title="Nothing watched yet">Open any market and choose Watch to be alerted when its probability moves by the points you pick.</Empty>}
        <ul className="space-y-1.5">
          {w?.watches.map((x) => (
            <li key={x.key} className="flex items-center gap-2 rounded-[var(--radius)] border border-line p-2">
              <button onClick={() => onOpen(x.key)} className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-1.5"><VenueBadge venue={x.venue} small /><span className="truncate text-[12px] text-fg hover:text-accent">{x.title}</span></span>
                <span className="mt-0.5 block text-[10.5px] text-muted">Alerts at {Math.round(x.threshold * 100)} pts from {prob(x.baseProb)}{x.alertedAt ? ` · last alert ${new Date(x.alertedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}{x.status && x.status !== "open" ? ` · ${x.status}` : ""}</span>
              </button>
              <span className="flex shrink-0 flex-col items-end"><span className="font-mono text-[13px] font-semibold tabular-nums text-fg">{prob(x.prob)}</span><Change v={x.change24h} /></span>
              <button onClick={() => stop(x.key)} aria-label={`Stop watching ${x.title}`} className="ctl shrink-0 border border-line px-2 py-1 text-[11px] text-muted hover:text-fg">Stop</button>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[11px] text-muted">Alerts arrive in the bell and on the channels you chose in Settings, under News and alerts, within the hour.</p>
      </section>

      <section className="panel min-w-0 p-3">
        <h3 className="mb-1 text-[13px] font-semibold text-fg">Your forecasts</h3>
        {f && <p className="text-[12px] text-fg">{f.line}</p>}
        {you && market && <p className="mt-1 text-[12px] text-muted">On the same markets, at the moments you forecast, the market&apos;s own price scored <span className="font-mono text-fg">{market.brier.toFixed(3)}</span> against your <span className={`font-mono ${you.brier <= market.brier ? "text-pos" : "text-neg"}`}>{you.brier.toFixed(3)}</span> (lower is better).</p>}
        {f && f.calibration.buckets.length > 0 && (
          <table className="mt-2 w-full text-[11.5px]">
            <thead><tr className="text-left text-[10.5px] uppercase tracking-wider text-muted"><th className="py-1 font-medium">Said</th><th className="py-1 text-right font-medium">n</th><th className="py-1 text-right font-medium">Average said</th><th className="py-1 text-right font-medium">Came true</th></tr></thead>
            <tbody>{f.calibration.buckets.map((b) => <tr key={b.label} className="border-t border-line"><td className="py-1 text-fg">{b.label}</td><td className="py-1 text-right font-mono tabular-nums text-muted">{b.n}</td><td className="py-1 text-right font-mono tabular-nums text-muted">{prob(b.avgP)}</td><td className="py-1 text-right font-mono tabular-nums text-fg">{prob(b.held)}</td></tr>)}</tbody>
          </table>
        )}
        {!f && <div className="shimmer mt-2 h-32 ctl" />}
        {f && !f.forecasts.length && <div className="mt-2"><Empty icon="Target" title="No forecasts yet">Open a market and record your own probability. When it resolves, you see your score beside the market&apos;s.</Empty></div>}
        <ul className="mt-2 space-y-1.5">
          {f?.forecasts.map((x) => (
            <li key={x.id} className="rounded-[var(--radius)] border border-line p-2">
              <button onClick={() => onOpen(x.marketKey)} className="block w-full text-left"><span className="line-clamp-2 text-[12px] text-fg hover:text-accent">{x.title}</span></button>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span>{x.day} · you <span className="font-mono text-fg">{prob(x.p)}</span> · market then <span className="font-mono">{prob(x.marketP)}</span></span>
                {x.outcome !== null ? <span className="font-mono tabular-nums">resolved {x.outcome ? "yes" : "no"} · Brier <span className={x.brier !== null && x.marketBrier !== null && x.brier <= x.marketBrier ? "text-pos" : "text-neg"}>{x.brier?.toFixed(3)}</span> vs {x.marketBrier?.toFixed(3) ?? "–"}</span>
                  : x.day === today ? <button onClick={() => remove(x.id)} className="text-[11px] text-muted underline-offset-2 hover:text-fg hover:underline">Remove (today only)</button> : <span>open</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
