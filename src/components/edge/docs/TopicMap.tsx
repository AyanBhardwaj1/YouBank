"use client";

/**
 * The topic map: every passage of a big set of documents placed by what it is about, so the corpus's
 * themes show as named clusters. Hover a dot to read it, click it to open the source, pick a cluster
 * to list its passages or ask about it.
 */
import { Loader2, Map as MapIcon, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/Select";
import { post } from "@/components/news/client";
import { errorText, type TopicMap, type ViewTarget } from "./client";

const PALETTE = ["#5B8DEF", "#E0795A", "#4FB286", "#C77DDB", "#E3B341", "#46B3C9", "#E06C9F", "#8C9EFF", "#A3B86C", "#D98E4A"];
const W = 1000, H = 620, PAD = 36;

type Corpus = "uploads" | "workspace" | "company" | "all";
type Result = TopicMap & { docs: number };

export function TopicMapView({ onCite, onAskTopic }: { onCite: (t: ViewTarget) => void; onAskTopic: (question: string, scope?: { tickers?: string[]; sources?: string[] }) => void }) {
  const [corpus, setCorpus] = useState<Corpus>("uploads");
  const [ticker, setTicker] = useState("");
  const [busy, setBusy] = useState(false);
  const [map, setMap] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; id: number } | null>(null);

  const run = async () => {
    setBusy(true); setError(null); setFocus(null);
    const body = corpus === "uploads" ? { sources: ["upload", "audio"] } : corpus === "workspace" ? { sources: ["workspace"] } : corpus === "company" ? { tickers: [ticker.trim().toUpperCase()], sources: ["sec"] } : {};
    try { setMap(await post<Result>("/api/edge/topics", body)); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };

  const plot = useMemo(() => {
    if (!map?.points.length) return null;
    const xs = map.points.map((p) => p.x), ys = map.points.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const sx = (x: number) => PAD + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * PAD);
    const sy = (y: number) => H - PAD - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * PAD);
    const pts = map.points.map((p) => ({ ...p, px: sx(p.x), py: sy(p.y) }));
    const centers = map.clusters.map((c) => {
      const mine = pts.filter((p) => p.cluster === c.id);
      return { ...c, x: mine.reduce((s, p) => s + p.px, 0) / (mine.length || 1), y: mine.reduce((s, p) => s + p.py, 0) / (mine.length || 1) };
    });
    return { pts, centers, byId: new Map(pts.map((p) => [p.id, p])) };
  }, [map]);

  const colorOf = (cluster: number) => PALETTE[Math.abs(cluster) % PALETTE.length];
  const tipPoint = tip && plot ? plot.byId.get(tip.id) : null;
  const focused = focus !== null && map ? map.clusters.find((c) => c.id === focus) : null;

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); void run(); }} className="flex flex-wrap items-center gap-2 text-[12px]">
        <span className="text-muted">Map the topics of</span>
        <Select value={corpus} onChange={(v) => setCorpus(v as Corpus)} aria-label="Documents to map" className="ctl border border-line bg-bg px-2 py-1 text-left">
          <option value="uploads">my uploads and recordings</option><option value="workspace">my workspace</option><option value="company">a company&apos;s filings</option><option value="all">everything I can read</option>
        </Select>
        {corpus === "company" && <input value={ticker} onChange={(e) => setTicker(e.target.value)} placeholder="Ticker" className="ctl w-[100px] border border-line bg-bg px-2 py-1 uppercase outline-none placeholder:normal-case placeholder:text-faint focus:border-accent/60" aria-label="Ticker" />}
        <button type="submit" disabled={busy || (corpus === "company" && !ticker.trim())} className="ctl flex items-center gap-1 bg-accent px-3 py-1 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <MapIcon className="h-3 w-3" />}Map</button>
        {map && <span className="text-[11px] text-muted">{map.points.length} passages from {map.docs} documents · {map.method}</span>}
      </form>
      {error && <p className="text-[12px] text-neg">{error}</p>}
      {map && !map.points.length && <p className="text-[12px] text-muted">{map.method === "too few passages" ? "Too few passages to map; add more documents first." : "Nothing to map yet."}</p>}
      {plot && map && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="panel relative overflow-hidden p-1">
            <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Topic map of the passages" onMouseLeave={() => setTip(null)}>
              {plot.pts.map((p) => (
                <circle key={p.id} cx={p.px} cy={p.py} r={tip?.id === p.id ? 6 : 3.4} fill={colorOf(p.cluster)} opacity={focus === null || focus === p.cluster ? 0.8 : 0.12}
                  className="cursor-pointer" onMouseEnter={() => setTip({ x: p.px, y: p.py, id: p.id })} onClick={() => onCite({ chunkId: p.id })} />
              ))}
              {plot.centers.map((c) => (
                <text key={c.id} x={c.x} y={c.y} textAnchor="middle" className="cursor-pointer select-none" onClick={() => setFocus((f) => (f === c.id ? null : c.id))}
                  style={{ font: "600 15px var(--font-sans, system-ui)", fill: "var(--fg)", stroke: "var(--panel)", strokeWidth: 5, paintOrder: "stroke", opacity: focus === null || focus === c.id ? 1 : 0.3 }}>{c.label}</text>
              ))}
            </svg>
            {tipPoint && tip && (
              <div className="pointer-events-none absolute z-10 max-w-[300px] rounded-md border border-line bg-panel px-2.5 py-2 text-[11.5px] shadow-lg" style={{ left: `${Math.min(70, (tip.x / W) * 100)}%`, top: `${Math.min(75, (tip.y / H) * 100)}%`, transform: "translate(8px, 8px)" }}>
                <div className="truncate font-semibold">{tipPoint.title}</div>
                <div className="mt-0.5 line-clamp-4 text-muted">{tipPoint.text}</div>
              </div>
            )}
          </div>
          <aside className="space-y-2">
            <ul className="space-y-1">
              {[...map.clusters].sort((a, b) => b.size - a.size).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setFocus((f) => (f === c.id ? null : c.id))} aria-pressed={focus === c.id} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-[12px] ${focus === c.id ? "border-accent/50 bg-accent-soft/30" : "border-line hover:border-accent/40"}`}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} /><span className="min-w-0 flex-1 truncate">{c.label}</span><span className="num text-[11px] text-muted">{c.size}</span>
                  </button>
                </li>
              ))}
            </ul>
            {focused && (
              <div className="space-y-1.5 border-t border-line pt-2">
                <button type="button" onClick={() => onAskTopic(`What do the documents say about ${focused.label.toLowerCase()}?`, corpus === "company" ? { tickers: [ticker.trim().toUpperCase()], sources: ["sec"] } : corpus === "workspace" ? { sources: ["workspace"] } : corpus === "uploads" ? { sources: ["uploads", "audio"] } : undefined)} className="ctl flex w-full items-center justify-center gap-1 bg-accent px-2 py-1 text-[12px] font-semibold text-accent-fg"><Search className="h-3 w-3" />Ask about {focused.label.toLowerCase()}</button>
                <ul className="space-y-1">
                  {plot.pts.filter((p) => p.cluster === focused.id).slice(0, 8).map((p) => (
                    <li key={p.id}><button type="button" onClick={() => onCite({ chunkId: p.id })} className="w-full rounded-md border border-line px-2 py-1.5 text-left text-[11.5px] hover:border-accent/50"><div className="truncate font-medium">{p.title}</div><div className="line-clamp-2 text-muted">{p.text}</div></button></li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
      {!map && !busy && <p className="text-[12px] text-muted">For a big set of documents (a data room, a year of filings), the map shows what they are about and where to look first.</p>}
    </div>
  );
}
