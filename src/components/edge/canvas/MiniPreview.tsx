/**
 * A block's mini preview of what it produced: a map, a graph, a chart, numbers or text. Apart from the
 * block itself, so results and stories can show one without loading the node editor.
 */
import type { Preview } from "@/lib/edge/canvas/engine";

export function MiniPreview({ preview, large = false }: { preview: Preview; large?: boolean }) {
  const h = large ? 180 : 86;
  switch (preview.kind) {
    case "map": {
      const pts = preview.points;
      if (!pts.length) return <div className="text-[10.5px] text-faint">No points</div>;
      const [x0, y0, x1, y1] = preview.bbox ?? [Math.min(...pts.map((p) => p.lon)) - 0.3, Math.min(...pts.map((p) => p.lat)) - 0.3, Math.max(...pts.map((p) => p.lon)) + 0.3, Math.max(...pts.map((p) => p.lat)) + 0.3];
      const w = 220, sx = (lon: number) => ((lon - x0) / Math.max(1e-6, x1 - x0)) * w, sy = (lat: number) => h - ((lat - y0) / Math.max(1e-6, y1 - y0)) * h;
      const tone = (t?: string) => (t === "pos" ? "var(--pos)" : t === "neg" ? "var(--neg)" : t === "info" ? "var(--info)" : "var(--accent)");
      return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-md bg-bg" role="img" aria-label="Map preview">
          {[1, 2, 3].map((i) => <line key={i} x1={(w / 4) * i} x2={(w / 4) * i} y1={0} y2={h} stroke="var(--line)" strokeWidth={0.5} />)}
          {[1, 2].map((i) => <line key={`h${i}`} y1={(h / 3) * i} y2={(h / 3) * i} x1={0} x2={w} stroke="var(--line)" strokeWidth={0.5} />)}
          {pts.map((p, i) => <circle key={i} cx={sx(p.lon)} cy={sy(p.lat)} r={large ? 5 : 3.5} fill={tone(p.tone)} stroke="white" strokeWidth={1}><title>{p.label}</title></circle>)}
        </svg>
      );
    }
    case "stats":
      return <div className="grid grid-cols-2 gap-1">{preview.items.slice(0, large ? 8 : 4).map((s) => <div key={s.label} className="rounded-md bg-bg px-1.5 py-1"><div className="truncate text-[9.5px] uppercase tracking-wider text-faint">{s.label}</div><div className="num truncate text-[12px] font-semibold">{s.value}</div></div>)}</div>;
    case "list":
      return <ul className="space-y-0.5">{preview.items.slice(0, large ? 12 : 3).map((it, i) => <li key={i} className="flex items-baseline justify-between gap-2 text-[10.5px]"><span className="truncate">{it.label}</span><span className="num shrink-0 text-muted">{it.score !== undefined ? it.score.toFixed(2) : it.detail}</span></li>)}</ul>;
    case "chart": {
      const w = 220, all = preview.series.flatMap((s) => s.values);
      const lo = Math.min(...all), hi = Math.max(...all);
      const colors = ["var(--accent)", "var(--info)", "var(--pos)", "var(--neg)"];
      return (
        <div>
          {preview.synthetic && <div className="mb-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-accent">Synthetic</div>}
          <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-md bg-bg" role="img" aria-label="Chart preview">
            {preview.series.map((s, k) => <path key={s.label} d={s.values.map((v, i) => `${i ? "L" : "M"}${(i / Math.max(1, s.values.length - 1)) * w},${h - ((v - lo) / Math.max(1e-9, hi - lo)) * (h - 6) - 3}`).join(" ")} fill="none" stroke={colors[k % colors.length]} strokeWidth={1.5} />)}
          </svg>
        </div>
      );
    }
    case "graph": {
      const w = 220, n = preview.nodes.slice(0, large ? 40 : 14);
      const pos = new Map(n.map((x, i) => [x.id, { x: w / 2 + Math.cos((i / n.length) * Math.PI * 2) * (w / 2 - 14) * (i === 0 ? 0 : 1), y: h / 2 + Math.sin((i / n.length) * Math.PI * 2) * (h / 2 - 10) * (i === 0 ? 0 : 1) }]));
      return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-md bg-bg" role="img" aria-label="Graph preview">
          {preview.links.filter((l) => pos.has(l.s) && pos.has(l.d)).map((l, i) => { const a = pos.get(l.s)!, b = pos.get(l.d)!; return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--line-strong)" strokeWidth={0.8} />; })}
          {n.map((x, i) => { const p = pos.get(x.id)!; return <circle key={x.id} cx={p.x} cy={p.y} r={i === 0 ? 5 : 3.2} fill={i === 0 ? "var(--accent)" : "#CC79A7"}><title>{x.label}</title></circle>; })}
        </svg>
      );
    }
    case "text":
      return <p className={`${large ? "" : "line-clamp-3"} whitespace-pre-line text-[10.5px] text-muted`}>{preview.text.replace(/\*\*/g, "")}</p>;
    default:
      return null;
  }
}
