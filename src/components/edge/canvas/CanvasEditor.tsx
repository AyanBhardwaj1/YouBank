"use client";

/**
 * The canvas editor. Blocks come from the palette (drag or click), wires connect an output to an input
 * that accepts its kind, and the inspector sets each block and shows what it produced. Running animates
 * the wires as data flows and fills each block's mini preview as it finishes. The side panel holds what
 * is wrong or could come next, the run history, checkpoints, branches (compared side by side), deploying
 * as a monitor, and sharing with a team. Viewers see everything but change nothing. Below the lg
 * breakpoint the side panel opens as a sheet from the bottom (tapping a block opens it). On the canvas,
 * Tab and Enter pick a block, the arrow keys move it and Delete removes what is picked.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useReactFlow,
  type Connection, type Dimensions, type Edge, type EdgeChange, type EdgeSelectionChange, type Node, type NodeChange, type NodeSelectionChange, type XYPosition,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { AlertTriangle, ArrowLeft, Bell, BookmarkPlus, GitBranch, History, Lightbulb, Loader2, PanelBottomOpen, Play, Plus, Redo2, Search, Share2, Trash2, Undo2, X } from "lucide-react";
import { memo, useCallback, useEffect, useId, useMemo, useState, useSyncExternalStore, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { accepts, makeNode, MODULE_LABEL, newId, NODE, NODES, suggestions, validate, wire, type CanvasNode, type Field, type Graph, type Kind, type Module } from "@/lib/edge/canvas/catalog";
import type { RunView } from "@/lib/edge/canvas/engine";
import { applySelect } from "@/lib/edge/canvas/view";
import { api, ago, post, useNow } from "../client";
import { KIND_COLOR, MODULE_COLOR } from "./colors";
import { MiniPreview } from "./MiniPreview";
import { ModuleNode, type ModuleData } from "./ModuleNode";
import { Modal, Sheet } from "./Overlays";
import { Outputs } from "./Results";
import { CanvasSkeleton } from "./Skeleton";
import { useCanvas } from "./useCanvas";
import { errorMessage } from "@/lib/client/errors";

const nodeTypes = { module: ModuleNode };
const MODULES: Module[] = ["source", "earth", "documents", "networks", "scenarios", "output"];
const NO_CONFIG: Record<string, unknown> = {};
const NONE: ReadonlySet<string> = new Set();
// Props xyflow compares by identity, made once rather than on every frame of a drag.
const FIT_VIEW = { padding: 0.25 };
const PRO_OPTIONS = { hideAttribution: true };
const MINIMAP_STYLE = { background: "var(--panel)" };
const minimapColor = (n: Node) => MODULE_COLOR[NODE[(n.data as ModuleData).nodeType]?.module ?? "source"];

// Tailwind's lg: from here up the inspector sits beside the canvas; below it, it opens as a sheet.
const WIDE = "(min-width: 64rem)";
const onWideChange = (cb: () => void) => { const m = window.matchMedia(WIDE); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const isWide = () => window.matchMedia(WIDE).matches;

/** The blocks for xyflow. A block's data holds only what it shows, so moving the block leaves it as it was. */
function flowNodes(graph: Graph, run: RunView | null, issues: Map<string, string[]>, picked: ReadonlySet<string>, onToggle: (id: string) => void): Node[] {
  const steps = new Map(run?.steps.map((s) => [s.nodeId, s]) ?? []);
  return graph.nodes.map((n) => {
    const s = steps.get(n.id);
    const data: ModuleData = {
      nodeType: n.type, config: n.data.config ?? NO_CONFIG, title: n.data.title, expanded: n.data.expanded,
      status: s?.status, step: s?.step, summary: s?.summary, error: s?.error, preview: s?.preview ?? null, issues: issues.get(n.id), onToggle,
    };
    return { id: n.id, type: "module", position: n.position, data, selected: picked.has(n.id) };
  });
}

/** The wires for xyflow, in the colour of the kind they carry and animated while data flows along them. */
function flowEdges(graph: Graph, run: RunView | null, picked: ReadonlySet<string>): Edge[] {
  const steps = new Map(run?.steps.map((s) => [s.nodeId, s]) ?? []);
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  return graph.edges.map((e) => {
    const src = byId.get(e.source);
    const kind = src ? NODE[src.type]?.outputs.find((o) => o.name === e.sourceHandle)?.kind : undefined;
    const from = steps.get(e.source)?.status, to = steps.get(e.target)?.status;
    const flowing = from === "running" || from === "waiting" || (from === "done" && (to === "running" || to === "waiting" || to === "queued"));
    return { id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle, animated: flowing, selected: picked.has(e.id), style: { stroke: kind ? KIND_COLOR[kind] : "var(--line-strong)", strokeWidth: flowing ? 2.6 : 1.8, opacity: from === "skipped" || from === "failed" ? 0.35 : 1 } };
  });
}

function FieldInput({ f, value, onChange, disabled }: { f: Field; value: unknown; onChange: (v: unknown) => void; disabled: boolean }) {
  const base = "ctl w-full border border-line bg-bg px-2 py-1.5 text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent/60 disabled:opacity-60";
  switch (f.type) {
    case "tickers": return <input disabled={disabled} defaultValue={Array.isArray(value) ? value.join(", ") : ""} onBlur={(e) => onChange(e.target.value.split(/[\s,]+/).map((t) => t.trim().toUpperCase()).filter(Boolean))} placeholder="ET, KMI" className={base} />;
    case "text": return <input disabled={disabled} defaultValue={typeof value === "string" ? value : ""} onBlur={(e) => onChange(e.target.value)} placeholder={f.placeholder} className={base} />;
    case "textarea": return <textarea disabled={disabled} defaultValue={typeof value === "string" ? value : ""} onBlur={(e) => onChange(e.target.value)} placeholder={f.placeholder} rows={3} className={`${base} resize-y`} />;
    case "number": return <input type="number" disabled={disabled} defaultValue={typeof value === "number" ? value : ""} min={f.min} max={f.max} step={f.step ?? 1} onBlur={(e) => onChange(e.target.value === "" ? undefined : Math.max(f.min, Math.min(f.max, Number(e.target.value))))} className={base} />;
    case "toggle": return <label className="flex items-center gap-2 text-[12px]"><input type="checkbox" disabled={disabled} checked={value !== false} onChange={(e) => onChange(e.target.checked)} className="accent-[var(--accent)]" />{value !== false ? "On" : "Off"}</label>;
    case "select": return <Select value={String(value ?? f.options[0]?.value ?? "")} onChange={(v) => onChange(v)} disabled={disabled} className={`${base} text-left`}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>;
    case "multiselect": {
      const cur = Array.isArray(value) ? (value as string[]) : [];
      return <div className="flex flex-wrap gap-1">{f.options.map((o) => { const on = cur.includes(o.value); return <button key={o.value} type="button" disabled={disabled} onClick={() => onChange(on ? cur.filter((x) => x !== o.value) : [...cur, o.value])} className={`rounded-full border px-2 py-0.5 text-[11px] ${on ? "border-accent/60 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{o.label}</button>; })}</div>;
    }
  }
}

type FlowProps = {
  nodes: Node[]; edges: Edge[]; readOnly: boolean;
  onNodesChange: (changes: NodeChange[]) => void; onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (conn: Connection) => void; isValidConnection: (conn: Connection | Edge) => boolean;
  onPaneClick: () => void; onNodeClick: () => void;
};

/**
 * The canvas itself. A dragged block's position stays here until the drop, when the graph takes it, so
 * a drag frame re-renders this pane and moves one node: the editor, the inspector and every other block
 * keep their objects. The sizes xyflow measured stay on the nodes, so a rebuilt node is not measured again.
 */
const Flow = memo(function Flow({ nodes, edges, readOnly, onNodesChange, onEdgesChange, onConnect, isValidConnection, onPaneClick, onNodeClick }: FlowProps) {
  const [drag, setDrag] = useState<Record<string, XYPosition> | null>(null);
  const [sizes, setSizes] = useState<Record<string, Dimensions>>({});
  const sized = useMemo(() => nodes.map((n) => (sizes[n.id] ? { ...n, measured: sizes[n.id] } : n)), [nodes, sizes]);
  const shown = useMemo(() => (drag ? sized.map((n) => (drag[n.id] ? { ...n, position: drag[n.id] } : n)) : sized), [sized, drag]);
  const onChange = useCallback((changes: NodeChange[]) => {
    const moving = changes.flatMap((ch) => (ch.type === "position" && ch.dragging && ch.position ? [[ch.id, ch.position] as const] : []));
    const measured = changes.flatMap((ch) => (ch.type === "dimensions" && ch.dimensions ? [[ch.id, ch.dimensions] as const] : []));
    const rest = changes.filter((ch) => ch.type !== "dimensions" && !(ch.type === "position" && ch.dragging));
    if (moving.length) setDrag((cur) => ({ ...cur, ...Object.fromEntries(moving) }));
    if (measured.length) setSizes((cur) => ({ ...cur, ...Object.fromEntries(measured) }));
    if (rest.length) onNodesChange(rest);
    if (rest.some((ch) => ch.type === "position")) setDrag(null); // dropped: the graph has the position now
  }, [onNodesChange]);
  return (
    <ReactFlow nodes={shown} edges={edges} nodeTypes={nodeTypes} onNodesChange={onChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection}
      onPaneClick={onPaneClick} onNodeClick={onNodeClick} nodesDraggable={!readOnly} nodesConnectable={!readOnly} deleteKeyCode={null} fitView fitViewOptions={FIT_VIEW} minZoom={0.2} maxZoom={1.6} proOptions={PRO_OPTIONS}>
      <Background gap={22} size={1} color="var(--line)" />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" nodeColor={minimapColor} maskColor="rgba(0,0,0,0.35)" style={MINIMAP_STYLE} />
    </ReactFlow>
  );
});

/** Where the inspector goes: beside the canvas from lg up (as it always was), below that in a sheet from the bottom while it is open. */
function Dock({ wide, open, id, onClose, children }: { wide: boolean; open: boolean; id: string; onClose: () => void; children: ReactNode }) {
  if (wide) return <aside className="hidden w-[340px] shrink-0 flex-col border-l border-line lg:flex">{children}</aside>;
  return open ? <Sheet id={id} label="Details" onClose={onClose}>{children}</Sheet> : null;
}

function Editor({ id }: { id: number }) {
  const router = useRouter();
  const now = useNow();
  const c = useCanvas(id);
  const flow = useReactFlow();
  const wide = useSyncExternalStore(onWideChange, isWide, () => true);
  const [selected, setSelected] = useState<string | null>(null);
  // The inspector shows one block; the canvas can pick several (Shift-drag, Cmd-click) to move or delete together.
  const [picked, setPicked] = useState<ReadonlySet<string>>(NONE);
  const [pickedEdges, setPickedEdges] = useState<ReadonlySet<string>>(NONE);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<"canvas" | "history">("canvas");
  const [compare, setCompare] = useState<{ a: RunView; b: RunView } | null>(null);
  const [sheet, setSheet] = useState(false);
  const sheetId = useId();
  const graph = c.graph;
  const available = useMemo(() => new Set(c.data?.available ?? []), [c.data?.available]);
  const issues = useMemo(() => (graph ? validate(graph, available) : []), [graph, available]);
  const issuesByNode = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of issues) if (i.level === "error") m.set(i.nodeId, [...(m.get(i.nodeId) ?? []), i.message]);
    return m;
  }, [issues]);
  const tips = useMemo(() => (graph ? suggestions(graph, available) : []), [graph, available]);
  const readOnly = c.readOnly;
  const { setGraph, editGraph } = c;
  const select = useCallback((nodeId: string | null) => { setSelected(nodeId); setPicked(nodeId ? new Set([nodeId]) : NONE); setPickedEdges(NONE); }, []);

  // Blocks call back through the canvas's current graph, so the callback, and with it each block's data, stays the same object.
  const onToggle = useCallback((nodeId: string) => {
    editGraph((g) => ({ ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, expanded: !n.data.expanded } } : n)) }), { transient: true });
  }, [editGraph]);
  const nodes = useMemo(() => (graph ? flowNodes(graph, c.run, issuesByNode, picked, onToggle) : []), [graph, c.run, issuesByNode, picked, onToggle]);
  const edges = useMemo(() => (graph ? flowEdges(graph, c.run, pickedEdges) : []), [graph, c.run, pickedEdges]);

  // Follow the latest run when the canvas opens (or the one named in the address).
  const latestRun = c.data?.runs[0]?.id ?? null;
  const { followRun } = c;
  useEffect(() => {
    const asked = Number(new URLSearchParams(window.location.search).get("run"));
    followRun(Number.isInteger(asked) && asked > 0 ? asked : latestRun);
  }, [latestRun, followRun]);

  // The picked blocks and wires follow xyflow's selection, so its flags never drift from ours. A drop or an
  // arrow key moves blocks (no undo step, as moving never had one); a removal is one undo step.
  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const sel = changes.filter((ch): ch is NodeSelectionChange => ch.type === "select");
    if (sel.length) {
      setPicked((cur) => applySelect(cur, sel));
      if (readOnly) { const on = sel.find((ch) => ch.selected); if (on) setSelected(on.id); }
      else for (const ch of sel) setSelected((cur) => (ch.selected ? ch.id : cur === ch.id ? null : cur));
    }
    if (readOnly) return;
    const removed = new Set(changes.flatMap((ch) => (ch.type === "remove" ? [ch.id] : [])));
    const moved = new Map(changes.flatMap((ch) => (ch.type === "position" && ch.position ? [[ch.id, ch.position] as const] : [])));
    if (!removed.size && !moved.size) return;
    editGraph((g) => ({
      ...g,
      nodes: g.nodes.filter((n) => !removed.has(n.id)).map((n) => { const p = moved.get(n.id); return p ? { ...n, position: p } : n; }),
      edges: removed.size ? g.edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)) : g.edges,
    }), { transient: !removed.size });
  }, [editGraph, readOnly]);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const sel = changes.filter((ch): ch is EdgeSelectionChange => ch.type === "select");
    if (sel.length) setPickedEdges((cur) => applySelect(cur, sel));
    if (readOnly) return;
    const removed = new Set(changes.flatMap((ch) => (ch.type === "remove" ? [ch.id] : [])));
    if (removed.size) editGraph((g) => ({ ...g, edges: g.edges.filter((e) => !removed.has(e.id)) }));
  }, [editGraph, readOnly]);

  const kindOf = useCallback((nodeId: string, handle: string | null): Kind | undefined => {
    const n = graph?.nodes.find((x) => x.id === nodeId);
    return n ? NODE[n.type]?.outputs.find((o) => o.name === handle)?.kind : undefined;
  }, [graph]);

  const isValidConnection = useCallback((conn: Connection | Edge) => {
    if (!graph || conn.source === conn.target) return false;
    const kind = kindOf(conn.source, conn.sourceHandle ?? null);
    const t = graph.nodes.find((n) => n.id === conn.target);
    const port = t && NODE[t.type]?.inputs.find((p) => p.name === conn.targetHandle);
    if (!kind || !port || !accepts(port, kind)) return false;
    return port.multi || !graph.edges.some((e) => e.target === conn.target && e.targetHandle === conn.targetHandle);
  }, [graph, kindOf]);

  const onConnect = useCallback((conn: Connection) => {
    if (!graph || readOnly || !isValidConnection(conn)) return;
    setGraph({ ...graph, edges: [...graph.edges, wire(conn.source, conn.sourceHandle ?? "", conn.target, conn.targetHandle ?? "")] });
  }, [setGraph, graph, isValidConnection, readOnly]);

  const addBlock = useCallback((type: string, at?: { x: number; y: number }, after?: { nodeId: string; kind: Kind }) => {
    if (!graph || readOnly) return;
    const def = NODE[type];
    let position = at;
    if (!position) {
      const from = after ? graph.nodes.find((n) => n.id === after.nodeId) : null;
      position = from ? { x: from.position.x + 320, y: from.position.y + 40 } : flow.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
    const node = makeNode(type, {}, newId(type.split(".")[1]?.slice(0, 6) ?? "n"), position);
    const edgesNext = [...graph.edges];
    if (after) {
      const src = graph.nodes.find((n) => n.id === after.nodeId);
      const out = src && NODE[src.type].outputs.find((o) => o.kind === after.kind);
      const port = def.inputs.find((p) => accepts(p, after.kind));
      if (src && out && port) edgesNext.push(wire(src.id, out.name, node.id, port.name));
    }
    setGraph({ ...graph, nodes: [...graph.nodes, node], edges: edgesNext });
    select(node.id);
  }, [setGraph, flow, graph, readOnly, select]);

  const onDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData("application/x-edge-block");
    if (type && NODE[type]) addBlock(type, flow.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  }, [addBlock, flow]);

  const setConfig = useCallback((nodeId: string, key: string, value: unknown) => {
    if (!graph) return;
    setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, config: { ...n.data.config, [key]: value } } } : n)) });
  }, [setGraph, graph]);
  const setNodeTitle = useCallback((nodeId: string, title: string) => {
    if (!graph) return;
    setGraph({ ...graph, nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, title: title.trim() || undefined } } : n)) });
  }, [setGraph, graph]);
  const removeBlock = useCallback((nodeId: string) => {
    if (!graph) return;
    setGraph({ ...graph, nodes: graph.nodes.filter((n) => n.id !== nodeId), edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId) });
    select(null);
  }, [setGraph, graph, select]);
  const onPaneClick = useCallback(() => select(null), [select]);
  // On a phone or tablet, tapping a block opens the sheet with its settings and results.
  const onNodeClick = useCallback(() => { if (!wide) setSheet(true); }, [wide]);
  const closeSheet = useCallback(() => setSheet(false), []);
  const closeCompare = useCallback(() => setCompare(null), []);

  // Keyboard: undo, redo, run.
  const { undo, redo, startRun, setNotice } = c;
  const run = useCallback(async () => {
    setBusy("run");
    try { await startRun(); } catch (e) { setNotice(errorMessage(e)); } finally { setBusy(null); }
  }, [setNotice, startRun]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (mod && e.key === "Enter") { e.preventDefault(); void run(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, run, undo]);

  const act = async (name: string, f: () => Promise<unknown>) => {
    setBusy(name);
    try { await f(); } catch (e) { c.setNotice(errorMessage(e)); } finally { setBusy(null); }
  };

  if (c.error) return <div className="p-6 text-[13px] text-neg">{c.error} <Link href="/app/edge?view=canvases" className="ml-2 text-accent hover:underline">Back to canvases</Link></div>;
  if (!c.data || !graph) return <CanvasSkeleton />;

  const data = c.data;
  const sel = graph.nodes.find((n) => n.id === selected) ?? null;
  const selDef = sel ? NODE[sel.type] : null;
  const selStep = sel ? c.run?.steps.find((s) => s.nodeId === sel.id) : null;
  const running = c.run && (c.run.status === "queued" || c.run.status === "running");
  const errors = issues.filter((i) => i.level === "error");
  const palette = NODES.filter((d) => available.has(d.type) && (!query || `${d.label} ${d.tech ?? ""} ${d.blurb}`.toLowerCase().includes(query.toLowerCase())));
  const saveLabel = { saved: "Saved", saving: "Saving", dirty: "Unsaved", conflict: "Reloaded", error: "Not saved" }[c.save];

  const compareWith = (otherId: number) => act("compare", async () => {
    const other = await api<{ runs: { id: number; status: string }[] }>(`/api/edge/canvases/${otherId}`);
    const mine = data.runs.find((r) => r.status === "done"), theirs = other.runs.find((r) => r.status === "done");
    if (!mine || !theirs) throw new Error("Run both canvases once to compare them.");
    const [a, b] = await Promise.all([api<RunView>(`/api/edge/runs/${mine.id}`), api<RunView>(`/api/edge/runs/${theirs.id}`)]);
    setCompare({ a, b });
  });

  // Delete or Backspace on the canvas (not in the panels) removes the picked blocks with their wires, and
  // picked wires, as one step Cmd+Z brings back.
  const onCanvasKey = (e: ReactKeyboardEvent) => {
    if (readOnly || (e.key !== "Delete" && e.key !== "Backspace") || (!picked.size && !pickedEdges.size)) return;
    if ((e.target as HTMLElement).closest("input, textarea, [contenteditable]")) return;
    e.preventDefault();
    editGraph((g) => ({ ...g, nodes: g.nodes.filter((n) => !picked.has(n.id)), edges: g.edges.filter((x) => !pickedEdges.has(x.id) && !picked.has(x.source) && !picked.has(x.target)) }));
    select(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
        <Link href="/app/edge?view=canvases" className="rounded p-1 text-muted hover:text-fg" aria-label="All canvases"><ArrowLeft className="h-4 w-4" /></Link>
        <input value={c.title} onChange={(e) => c.setTitle(e.target.value)} disabled={readOnly} aria-label="Canvas title" className="min-w-[160px] flex-1 bg-transparent text-[15px] font-semibold outline-none disabled:opacity-80 sm:flex-none sm:w-[340px]" />
        {data.canvas.branch && <span className="flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted"><GitBranch className="h-3 w-3" />{data.canvas.branch}</span>}
        <span className={`text-[11px] ${c.save === "error" || c.save === "conflict" ? "text-neg" : "text-faint"}`}>{readOnly ? "View only" : saveLabel}</span>
        <div className="ml-auto flex items-center gap-1">
          {!readOnly && <>
            <button type="button" onClick={c.undo} disabled={!c.canUndo} title="Undo (Cmd+Z)" className="rounded p-1.5 text-muted hover:text-fg disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
            <button type="button" onClick={c.redo} disabled={!c.canRedo} title="Redo (Cmd+Shift+Z)" className="rounded p-1.5 text-muted hover:text-fg disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
            <button type="button" onClick={() => void act("checkpoint", async () => { const label = await promptDialog({ title: "Name this checkpoint", label: "Name", defaultValue: `Checkpoint ${data.checkpoints.length + 1}`, confirmLabel: "Save checkpoint" }); if (label) { await post(`/api/edge/canvases/${id}/checkpoints`, { label }); await c.load(); } })} title="Save a named checkpoint" className="rounded p-1.5 text-muted hover:text-fg"><BookmarkPlus className="h-4 w-4" /></button>
            <button type="button" onClick={() => void act("branch", async () => { const label = await promptDialog({ title: "Branch this canvas", body: "A copy you can change and compare side by side, such as a bull and a bear case.", label: "Branch name", defaultValue: "bear case", confirmLabel: "Branch" }); if (label) { const r = await post<{ canvas: { id: number } }>(`/api/edge/canvases/${id}/branch`, { label }); router.push(`/app/edge/canvas/${r.canvas.id}`); } })} title="Branch into a variant" className="rounded p-1.5 text-muted hover:text-fg"><GitBranch className="h-4 w-4" /></button>
          </>}
          <button type="button" onClick={() => setSheet((o) => !o)} aria-expanded={sheet} aria-controls={sheet ? sheetId : undefined} title="Settings, results, runs and versions"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted hover:text-fg lg:hidden"><PanelBottomOpen className="h-4 w-4" />Details</button>
          <button type="button" onClick={() => void run()} disabled={readOnly || !!running || busy === "run" || errors.length > 0} title={errors.length ? errors[0].message : "Run (Cmd+Enter)"} className="ctl ml-1 flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">
            {running || busy === "run" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} {running ? "Running" : "Run"}
          </button>
        </div>
      </header>
      {c.notice && <div className="flex items-center gap-2 border-b border-line bg-accent-soft px-3 py-1.5 text-[11.5px] text-accent"><span className="flex-1">{c.notice}</span><button type="button" onClick={() => c.setNotice(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button></div>}
      <div className="border-b border-line bg-elevated/60 px-3 py-1.5 text-[11.5px] text-muted md:hidden">Canvases are built on a tablet or a computer. Here you can run this one and read its results; the feed, alerts and stories work fully on a phone.</div>

      <div className="flex min-h-0 flex-1">
        {!readOnly && (
          <aside className="hidden w-[210px] shrink-0 flex-col border-r border-line md:flex">
            <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5"><Search className="h-3.5 w-3.5 text-muted" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a block" className="w-full bg-transparent text-[12px] outline-none placeholder:text-faint" /></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {MODULES.map((m) => {
                const blocks = palette.filter((d) => d.module === m);
                if (!blocks.length) return null;
                return (
                  <div key={m} className="mb-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted"><span className="h-2 w-2 rounded-full" style={{ background: MODULE_COLOR[m] }} />{MODULE_LABEL[m]}</div>
                    {blocks.map((d) => (
                      <button key={d.type} type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("application/x-edge-block", d.type); e.dataTransfer.effectAllowed = "move"; }} onClick={() => addBlock(d.type)} title={d.blurb}
                        className="mb-1 flex w-full items-start gap-2 rounded-md border border-transparent px-1.5 py-1 text-left hover:border-line hover:bg-elevated/60">
                        <Icon name={d.icon} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                        <span className="min-w-0"><span className="block text-[12px]">{d.label}</span><span className="block truncate text-[10.5px] text-faint">{d.blurb}</span></span>
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </aside>
        )}

        <div className="edge-flow relative min-w-0 flex-1" onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }} onDrop={onDrop} onKeyDown={onCanvasKey}>
          <Flow nodes={nodes} edges={edges} readOnly={readOnly} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} isValidConnection={isValidConnection} onPaneClick={onPaneClick} onNodeClick={onNodeClick} />
          {!graph.nodes.length && <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[13px] text-muted">Drag blocks in from the left, or click one to add it.</div>}
        </div>

        <Dock wide={wide} open={sheet} id={sheetId} onClose={closeSheet}>
          {sel && selDef ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: `${MODULE_COLOR[selDef.module]}33`, color: MODULE_COLOR[selDef.module] }}><Icon name={selDef.icon} className="h-3.5 w-3.5" /></span>
                <input key={sel.id} defaultValue={sel.data.title ?? ""} placeholder={selDef.label} disabled={readOnly} onBlur={(e) => setNodeTitle(sel.id, e.target.value)} className="flex-1 bg-transparent text-[13.5px] font-semibold outline-none" />
                <button type="button" onClick={() => select(null)} aria-label="Close" className="text-muted hover:text-fg"><X className="h-4 w-4" /></button>
              </div>
              <p className="mt-1 text-[11.5px] text-muted">{selDef.blurb}{selDef.tech ? ` (${selDef.tech})` : ""}</p>
              {(issuesByNode.get(sel.id) ?? []).map((m) => <p key={m} className="mt-1.5 flex items-start gap-1 text-[11.5px] text-neg"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{m}</p>)}
              <div className="mt-3 space-y-2.5" key={`fields-${sel.id}`}>
                {selDef.fields.map((f) => (
                  <label key={f.key} className="block text-[11px] text-muted">
                    <span className="mb-1 block">{f.label}</span>
                    <FieldInput f={f} value={sel.data.config[f.key]} onChange={(v) => setConfig(sel.id, f.key, v)} disabled={readOnly} />
                    {"help" in f && f.help && <span className="mt-0.5 block text-[10.5px] text-faint">{f.help}</span>}
                  </label>
                ))}
              </div>
              {selDef.steps.length > 0 && <div className="mt-3 text-[11px] text-muted"><span className="font-semibold text-fg">Steps:</span> {selDef.steps.map((s) => s.label).join(" → ")}</div>}
              <div className="mt-4 border-t border-line pt-3">
                <div className="mb-1.5 flex items-center justify-between text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted"><span>Last run</span>{selStep?.finishedAt && now ? <span className="font-normal normal-case tracking-normal">{ago(selStep.finishedAt, now)}</span> : null}</div>
                {!selStep ? <p className="text-[12px] text-muted">Not run yet.</p> : selStep.status === "done" ? (
                  <><p className="mb-2 text-[12px]">{selStep.summary}</p>{selStep.preview && <div className="mb-3"><MiniPreview preview={selStep.preview} large /></div>}{selStep.output ? <Outputs outputs={selStep.output} downloads={selStep.downloads} /> : <p className="text-[11.5px] text-faint">Its full output loads when the run finishes.</p>}</>
                ) : <p className={`text-[12px] ${selStep.status === "failed" ? "text-neg" : "text-muted"}`}>{selStep.error || selStep.summary || selStep.status}</p>}
              </div>
              {!readOnly && <button type="button" onClick={() => removeBlock(sel.id)} className="mt-4 flex items-center gap-1 text-[11.5px] text-muted hover:text-neg"><Trash2 className="h-3.5 w-3.5" />Remove block</button>}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <nav className="mb-3 flex gap-1 text-[12px]">
                {(["canvas", "history"] as const).map((p) => <button key={p} type="button" onClick={() => setPanel(p)} className={`ctl px-2.5 py-1 ${panel === p ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{p === "canvas" ? "This canvas" : "Runs and versions"}</button>)}
              </nav>
              {panel === "canvas" ? (
                <div className="space-y-4">
                  {errors.length > 0 && <section><h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-neg">Fix before running</h3><ul className="space-y-1">{errors.map((i, k) => <li key={k}><button type="button" onClick={() => select(i.nodeId)} className="text-left text-[12px] text-neg hover:underline">{NODE[graph.nodes.find((n) => n.id === i.nodeId)?.type ?? ""]?.label ?? "A block"}: {i.message}</button></li>)}</ul></section>}
                  {!readOnly && tips.length > 0 && (
                    <section>
                      <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><Lightbulb className="h-3 w-3" />What could come next</h3>
                      <ul className="space-y-1.5">{tips.slice(0, 4).map((t, k) => {
                        const from = graph.nodes.find((n) => n.id === t.after);
                        return <li key={k} className="text-[11.5px] text-muted">After <span className="text-fg">{from?.data.title || NODE[from?.type ?? ""]?.label}</span>: <span className="inline-flex flex-wrap gap-1">{t.types.slice(0, 3).map((ty) => <button key={ty} type="button" onClick={() => addBlock(ty, undefined, { nodeId: t.after, kind: t.kind })} className="inline-flex items-center gap-0.5 rounded-full border border-line px-1.5 py-px text-[11px] text-fg hover:border-accent/50"><Plus className="h-3 w-3" />{NODE[ty].label}</button>)}</span></li>;
                      })}</ul>
                    </section>
                  )}
                  <section>
                    <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><Bell className="h-3 w-3" />Deploy as a monitor</h3>
                    {data.monitor?.active ? (
                      <div className="text-[12px]"><p>Runs {data.monitor.schedule}; alerts {data.monitor.alert === "immediate" ? "straight away" : "in your daily digest"} when a signal crosses its line.</p>
                        {!readOnly && <button type="button" onClick={() => void act("monitor", async () => { await api(`/api/edge/canvases/${id}/monitor`, { method: "DELETE" }); await c.load(); })} className="mt-1 text-[11.5px] text-muted hover:text-neg">Stop the monitor</button>}</div>
                    ) : (
                      <div className="text-[12px] text-muted">
                        <p>Re-run this canvas on a schedule and alert you when its signals change.{graph.nodes.some((n) => n.type === "out.signal") ? "" : " Add a Signal block to say what to watch."}</p>
                        {!readOnly && <div className="mt-1.5 flex gap-1.5">
                          {(["daily", "weekly"] as const).map((s) => <button key={s} type="button" disabled={busy === "monitor" || errors.length > 0} onClick={() => void act("monitor", async () => { const immediate = await confirmDialog({ title: `Deploy ${s}`, body: "Alert you straight away when a signal crosses its line? Choose No to get it in your daily digest instead.", confirmLabel: "Straight away", cancelLabel: "Daily digest" }); const r = await post<{ runId: number }>(`/api/edge/canvases/${id}/monitor`, { schedule: s, alert: immediate ? "immediate" : "digest" }); await c.load(); c.followRun(r.runId); })} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-fg hover:border-accent/50 disabled:opacity-50">Deploy {s}</button>)}
                        </div>}
                      </div>
                    )}
                  </section>
                  {data.role === "owner" && data.teams.length > 0 && (
                    <section>
                      <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><Share2 className="h-3 w-3" />Share with a team</h3>
                      <Select value={String(data.canvas.teamId ?? "")} onChange={(v) => void act("share", async () => { await api(`/api/edge/canvases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ teamId: v ? Number(v) : null, version: data.canvas.version }) }); await c.load(); })} className="ctl w-full border border-line bg-bg px-2 py-1.5 text-left text-[12px]">
                        <option value="">Only me</option>
                        {data.teams.map((t) => <option key={t.id} value={String(t.id)}>{t.name} (editors change it, viewers look)</option>)}
                      </Select>
                    </section>
                  )}
                  {data.branches.length > 1 && (
                    <section>
                      <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><GitBranch className="h-3 w-3" />Branches</h3>
                      <ul className="space-y-1">{data.branches.map((b) => <li key={b.id} className="flex items-center justify-between gap-2 text-[12px]">{b.id === id ? <span className="text-accent">{b.branch || "main"} (this one)</span> : <Link href={`/app/edge/canvas/${b.id}`} className="hover:underline">{b.branch || "main"}</Link>}{b.id !== id && <button type="button" onClick={() => void compareWith(b.id)} className="text-[11px] text-muted hover:text-fg">Compare</button>}</li>)}</ul>
                    </section>
                  )}
                  {!readOnly && <button type="button" onClick={() => void act("delete", async () => { if (await confirmDialog({ title: "Delete this canvas?", body: "Its runs stay in the audit trail. This cannot be undone.", tone: "danger", confirmLabel: "Delete" })) { await api(`/api/edge/canvases/${id}`, { method: "DELETE" }); router.push("/app/edge?view=canvases"); } })} className="flex items-center gap-1 text-[11.5px] text-muted hover:text-neg"><Trash2 className="h-3.5 w-3.5" />Delete canvas</button>}
                </div>
              ) : (
                <div className="space-y-4">
                  <section>
                    <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><History className="h-3 w-3" />Runs</h3>
                    {!data.runs.length ? <p className="text-[12px] text-muted">No runs yet.</p> : <ul className="space-y-1">{data.runs.map((r) => (
                      <li key={r.id}><button type="button" onClick={() => c.followRun(r.id)} className={`flex w-full items-center justify-between gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-elevated/60 ${c.run?.id === r.id ? "bg-elevated/60" : ""}`}>
                        <span><span className={r.status === "done" ? "text-pos" : r.status === "failed" ? "text-neg" : "text-info"}>●</span> {now ? ago(r.createdAt, now) : r.createdAt.slice(0, 10)} · {r.trigger}</span>
                        <span className="num text-[10.5px] text-muted">{r.cost?.aiUsd !== undefined ? `$${(r.cost.aiUsd + (r.cost.mlUsd ?? 0)).toFixed(3)}` : ""}</span>
                      </button></li>
                    ))}</ul>}
                  </section>
                  <section>
                    <h3 className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted"><BookmarkPlus className="h-3 w-3" />Checkpoints</h3>
                    {!data.checkpoints.length ? <p className="text-[12px] text-muted">None yet. Save one from the bookmark button.</p> : <ul className="space-y-1">{data.checkpoints.map((cp) => (
                      <li key={cp.id} className="flex items-center justify-between gap-2 text-[12px]"><span>{cp.label} <span className="text-faint">· v{cp.version}</span></span>{!readOnly && <button type="button" onClick={() => void act("restore", async () => { if (await confirmDialog({ title: `Restore "${cp.label}"?`, body: "The canvas goes back to this checkpoint; the current version stays in the undo history of this session.", confirmLabel: "Restore" })) { await post(`/api/edge/canvases/${id}/checkpoints`, { restore: cp.id }); await c.load(); } })} className="text-[11px] text-muted hover:text-fg">Restore</button>}</li>
                    ))}</ul>}
                  </section>
                </div>
              )}
            </div>
          )}
        </Dock>
      </div>

      {compare && (
        <Modal title="Side by side" onClose={closeCompare}>
          <div className="grid gap-3 md:grid-cols-2">
            {[compare.a, compare.b].map((r, k) => (
              <div key={k} className="space-y-2">
                <div className="text-[11px] uppercase tracking-wider text-muted">{k === 0 ? "This canvas" : "The branch"} · run {r.id}</div>
                {r.steps.filter((s) => s.status === "done" && s.preview).map((s) => (
                  <div key={s.nodeId} className="rounded-lg border border-line p-2"><div className="text-[12px] font-medium">{NODE[s.type]?.label ?? s.type}</div><div className="mb-1.5 text-[11.5px] text-muted">{s.summary}</div>{s.preview && <MiniPreview preview={s.preview} large />}</div>
                ))}
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function CanvasEditor({ id }: { id: number }) {
  return <ReactFlowProvider><Editor id={id} /></ReactFlowProvider>;
}

export type { CanvasNode };
