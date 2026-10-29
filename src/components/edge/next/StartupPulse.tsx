"use client";

/**
 * A startup's Pulse strip in /app/vc (E3): its hiring, attention and other free signals as sparklines, with
 * any tells, from the same store as Edge's Pulse. When the store cannot answer, the strip
 * stays out of the way.
 */
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "@/lib/client/errors";
import { post, useApi } from "@/components/news/client";
import { Sparkline } from "./charts";

type Data = { coverageText: string; refreshedAt: string | null; series: { metric: string; label: string; points: { value: number }[]; verdict: { move: number; alarm: boolean } | null }[]; tells: { tell: string; title: string; url: string }[] };

export function StartupPulse({ id }: { id: number }) {
  const { data, error, reload } = useApi<Data>(`/api/edge/pulse?startup=${id}`);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (error) return null;
  if (!data) return <div className="shimmer mt-4 h-16 rounded-md" aria-busy="true" />;
  const rows = data.series.filter((s) => ["jobs.open", "jobs.new", "wiki.views", "usasp.obligated", "patents.grants"].includes(s.metric) && s.points.length);
  const read = async () => { setBusy(true); setErr(null); try { await post("/api/edge/pulse", { action: "refresh", startup: id }); reload(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="mt-4 rounded-md border border-line bg-panel p-3 text-[11.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] uppercase tracking-wider text-muted">Pulse · Edge</span><span className="text-muted">{data.refreshedAt ? data.coverageText : "Not read yet"}</span>
        <button type="button" disabled={busy} onClick={() => void read()} className="rounded border border-line px-2 py-0.5 text-muted hover:text-fg disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : data.refreshedAt ? "Read again" : "Read its signals"}</button></div>
      {rows.length > 0 && <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">{rows.map((s) => <div key={s.metric} className="flex items-center justify-between gap-2"><span className="truncate">{s.label}<span className="num ml-1 text-muted">{s.points[s.points.length - 1].value.toLocaleString("en-US")}</span></span><Sparkline values={s.points.slice(-26).map((p) => p.value)} width={80} height={20} label={s.label} tone={s.verdict?.alarm ? "accent" : "muted"} /></div>)}</div>}
      {data.tells.length > 0 && <div className="mt-2">{data.tells.slice(0, 3).map((t, i) => <a key={i} href={t.url} target="_blank" rel="noreferrer" className="block truncate text-info hover:underline">{t.tell}: {t.title}</a>)}</div>}
      {err && <p className="mt-1 text-neg">{err}</p>}
    </div>
  );
}
