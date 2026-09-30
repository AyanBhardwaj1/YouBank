"use client";

/**
 * A block on the canvas: its module's colour and icon, typed ports on each side, a line on how it is
 * set, and while a run goes, its status, the step it is on (expand to see every step) and a live mini
 * preview of what it produced: a map, a graph, a chart, numbers or text.
 */
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, Check, ChevronDown, Loader2, MinusCircle, Timer } from "lucide-react";
import { memo } from "react";
import { Icon } from "@/components/ui/Icon";
import { NODE, type Kind, type Module } from "@/lib/edge/canvas/catalog";
import type { Preview } from "@/lib/edge/canvas/engine";

export const MODULE_COLOR: Record<Module, string> = { source: "#94a3b8", earth: "#56B4E9", documents: "#E69F00", networks: "#CC79A7", scenarios: "#009E73", output: "#F0B429" };
export const KIND_COLOR: Record<Kind, string> = {
  companies: "#94a3b8", places: "#94a3b8", findings: "#56B4E9", proforma: "#56B4E9", docs: "#E69F00", answer: "#E69F00",
  ranking: "#CC79A7", graph: "#CC79A7", scenario: "#009E73", table: "#009E73", memo: "#F0B429", signal: "#F0B429", file: "#F0B429",
};

export type ModuleData = {
  nodeType: string; config: Record<string, unknown>; title?: string; expanded?: boolean;
  status?: string; step?: string; summary?: string; error?: string; preview?: Preview | null;
  issues?: string[]; onToggle?: (id: string) => void;
};

/** One line on how a block is set. Pure. */
export function describeConfig(type: string, c: Record<string, unknown>): string {
  const list = (v: unknown) => (Array.isArray(v) ? v.join(", ") : "");
  switch (type) {
    case "source.companies": return list(c.tickers) || "Your watched companies";
    case "source.deal": return list(c.parties) || "Newest deal touching your watches";
    case "source.place": return String(c.place ?? "permian").replace(/^\w/, (x) => x.toUpperCase());
    case "source.documents": return `${list(c.sources) || "sources"} · ${list(c.forms) || "all forms"} · ${c.months ?? 12} mo`;
    case "earth.watch": return `${c.sites ?? 3} sites each · last ${c.months ?? 6} mo${c.refine === false ? "" : " · foundation-model check"}`;
    case "earth.proforma": return `In the ${String(c.place ?? "permian")} basin`;
    case "docs.ask": return typeof c.question === "string" && c.question ? `“${c.question.slice(0, 70)}${c.question.length > 70 ? "…" : ""}” · ${c.mode ?? "strict"}` : "Ask a question";
    case "docs.changes": return `${c.form ?? "10-K"} · ${c.section ?? "risk"}`;
    case "net.graph": return `${c.finding ?? "acquirers"} · ${c.depth ?? 2} hops`;
    case "scen.simulate": return `${c.driver ?? "replay"}${c.driver === "replay" ? ` ${c.replay ?? ""}` : c.driver === "shock" && c.shock ? `: ${String(c.shock).slice(0, 40)}` : ""} · ${c.horizon ?? 60} days`;
    case "scen.synthetic": return `${c.method ?? "auto"} · ${c.rows ?? 1000} rows · seed ${c.seed ?? 7}`;
    case "out.memo": return `${c.style ?? "brief"}${c.audience ? ` for ${c.audience}` : ""}`;
    case "out.signal": return c.when === "changes" || !c.when ? "Alert when it changes" : `Alert ${c.when} ${c.threshold ?? 0}`;
    case "out.export": return String(c.format ?? "csv").toUpperCase();
    default: return "";
  }
}

function StatusChip({ status }: { status?: string }) {
  if (!status || status === "queued") return status === "queued" ? <span className="flex items-center gap-1 text-[10px] text-muted"><Timer className="h-3 w-3" />Queued</span> : null;
  if (status === "running") return <span className="flex items-center gap-1 text-[10px] text-info"><Loader2 className="h-3 w-3 animate-spin" />Running</span>;
  if (status === "waiting") return <span className="flex items-center gap-1 text-[10px] text-info"><Loader2 className="h-3 w-3 animate-spin" />Waiting on ML</span>;
  if (status === "done") return <span className="flex items-center gap-1 text-[10px] text-pos"><Check className="h-3 w-3" />Done</span>;
  if (status === "skipped") return <span className="flex items-center gap-1 text-[10px] text-muted"><MinusCircle className="h-3 w-3" />Skipped</span>;
  return <span className="flex items-center gap-1 text-[10px] text-neg"><AlertTriangle className="h-3 w-3" />Failed</span>;
}

export const ModuleNode = memo(function ModuleNode({ id, data, selected }: NodeProps) {
  const d = data as ModuleData;
  const def = NODE[d.nodeType];
  if (!def) return <div className="panel p-2 text-[11px] text-neg">Unknown block</div>;
  const color = MODULE_COLOR[def.module];
  const stepIndex = def.steps.findIndex((s) => s.id === d.step);
  const running = d.status === "running" || d.status === "waiting";
  return (
    <div className={`w-[244px] rounded-xl border bg-panel shadow-lg transition ${selected ? "ring-2 ring-accent" : ""} ${running ? "shadow-[0_0_0_1px_var(--info),0_0_24px_-6px_var(--info)]" : ""}`} style={{ borderColor: `${color}66` }}>
      <div className="flex items-center gap-2 rounded-t-xl px-2.5 py-2" style={{ background: `${color}1f` }}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: `${color}33`, color }}><Icon name={def.icon} className="h-3.5 w-3.5" /></span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold">{d.title || def.label}{def.tech ? <span className="ml-1 text-[10px] font-normal text-muted">· {def.tech}</span> : null}</div>
        </div>
        <StatusChip status={d.status} />
      </div>
      <div className="px-2.5 py-2">
        <div className="line-clamp-2 text-[11px] text-muted">{describeConfig(d.nodeType, d.config)}</div>
        {d.issues?.length ? <div className="mt-1 flex items-start gap-1 text-[10.5px] text-neg"><AlertTriangle className="mt-px h-3 w-3 shrink-0" />{d.issues[0]}</div> : null}
        {def.steps.length > 0 && (
          <button type="button" onClick={(e) => { e.stopPropagation(); d.onToggle?.(id); }} className="nodrag mt-1.5 flex w-full items-center gap-1 text-left text-[10.5px] text-muted hover:text-fg">
            <ChevronDown className={`h-3 w-3 transition ${d.expanded ? "rotate-180" : ""}`} />
            {running && stepIndex >= 0 ? `${def.steps[stepIndex].label} (${stepIndex + 1}/${def.steps.length})` : `${def.steps.length} steps`}
          </button>
        )}
        {d.expanded && (
          <ol className="mt-1 space-y-0.5 border-l border-line pl-2">
            {def.steps.map((s, i) => {
              const state = d.status === "done" ? "done" : running ? (i < stepIndex ? "done" : i === stepIndex ? "now" : "todo") : "todo";
              return <li key={s.id} className={`text-[10.5px] ${state === "done" ? "text-pos" : state === "now" ? "text-info" : "text-faint"}`}>{state === "done" ? "✓ " : state === "now" ? "› " : "· "}{s.label}</li>;
            })}
          </ol>
        )}
        {(d.summary || d.error) && <div className={`mt-1.5 line-clamp-3 text-[10.5px] ${d.error ? "text-neg" : "text-fg"}`}>{d.error || d.summary}</div>}
        {d.preview && <div className="mt-2"><MiniPreview preview={d.preview} /></div>}
      </div>
      {def.inputs.map((p, i) => (
        <Handle key={p.name} type="target" position={Position.Left} id={p.name} title={`${p.label} (${p.kinds.join(" or ")})`}
          style={{ top: 44 + i * 22, width: 11, height: 11, background: "var(--panel)", border: `2px solid ${p.kinds[0] === "any" ? "#94a3b8" : KIND_COLOR[p.kinds[0] as Kind]}` }} />
      ))}
      {def.outputs.map((o, i) => (
        <Handle key={o.name} type="source" position={Position.Right} id={o.name} title={o.label}
          style={{ top: 44 + i * 22, width: 11, height: 11, background: KIND_COLOR[o.kind], border: "2px solid var(--panel)" }} />
      ))}
    </div>
  );
});

/* ---------------- Mini previews ---------------- */

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
