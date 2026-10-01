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
import { NODE, type Kind } from "@/lib/edge/canvas/catalog";
import type { Preview } from "@/lib/edge/canvas/engine";
import { sameData } from "@/lib/edge/canvas/view";
import { KIND_COLOR, MODULE_COLOR } from "./colors";
import { MiniPreview } from "./MiniPreview";

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

/** Every prop the same, data compared by value: the editor rebuilds data with the graph, so a block redraws only when what it shows changed. */
function sameProps(a: NodeProps, b: NodeProps): boolean {
  const keys = Object.keys(a) as (keyof NodeProps)[];
  return keys.length === Object.keys(b).length && keys.every((k) => (k === "data" ? sameData(a.data, b.data) : a[k] === b[k]));
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
}, sameProps);
