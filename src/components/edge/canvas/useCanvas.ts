"use client";

/**
 * A canvas in the browser: load it, save changes shortly after they stop (with the version it was
 * based on, so a co-editor's save is never overwritten; on a clash their version is loaded), follow
 * co-editors' saves and runs live, keep an undo history, and follow a run as it goes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Graph } from "@/lib/edge/canvas/catalog";
import type { RunView } from "@/lib/edge/canvas/engine";
import { api, post } from "../client";

export type CanvasData = {
  canvas: { id: number; title: string; description: string; graph: Graph; version: number; teamId: number | null; template: string; parentId: number | null; branch: string; updatedAt: string; ownerId: string };
  role: "owner" | "editor" | "viewer";
  runs: { id: number; status: string; trigger: string; createdAt: string; finishedAt: string | null; cost: Record<string, number>; error: string }[];
  monitor: { schedule: string; alert: string; active: boolean; nextRunAt: string } | null;
  branches: { id: number; title: string; branch: string; parentId: number | null }[];
  checkpoints: { id: number; label: string; version: number; createdAt: string }[];
  available: string[];
  teams: { id: number; name: string; role: string }[];
};

export type SaveState = "saved" | "saving" | "dirty" | "conflict" | "error";

const clone = (g: Graph): Graph => JSON.parse(JSON.stringify(g)) as Graph;

export function useCanvas(id: number) {
  const [data, setData] = useState<CanvasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graph, setGraphState] = useState<Graph | null>(null);
  const [title, setTitleState] = useState("");
  const [save, setSave] = useState<SaveState>("saved");
  const [notice, setNotice] = useState<string | null>(null);
  const [run, setRun] = useState<RunView | null>(null);
  const [hist, setHist] = useState({ past: 0, future: 0 });
  const version = useRef(0);
  const current = useRef<Graph | null>(null);
  const pending = useRef<{ graph?: Graph; title?: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const past = useRef<Graph[]>([]);
  const future = useRef<Graph[]>([]);
  const stopFollow = useRef<(() => void) | null>(null);

  const show = useCallback((g: Graph) => { current.current = g; setGraphState(g); }, []);

  const apply = useCallback((d: CanvasData) => {
    setData(d); setTitleState(d.canvas.title); version.current = d.canvas.version; setError(null);
    if (!pending.current) show(d.canvas.graph);
  }, [show]);
  const fail = useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []);

  const load = useCallback(() => api<CanvasData>(`/api/edge/canvases/${id}`).then((d) => { apply(d); return d; }, (e) => { fail(e); return null; }), [apply, fail, id]);

  useEffect(() => {
    let live = true;
    api<CanvasData>(`/api/edge/canvases/${id}`).then((d) => { if (live) apply(d); }, (e) => { if (live) fail(e); });
    return () => { live = false; };
  }, [apply, fail, id]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const body = pending.current;
    if (!body) return;
    pending.current = null;
    setSave("saving");
    try {
      const res = await fetch(`/api/edge/canvases/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, version: version.current }) });
      const j = (await res.json().catch(() => ({}))) as { canvas?: CanvasData["canvas"]; error?: string };
      if (res.status === 409 && j.canvas) {
        version.current = j.canvas.version; show(j.canvas.graph); setTitleState(j.canvas.title);
        setSave("conflict"); setNotice(j.error ?? "Someone else changed this canvas; their version is loaded.");
        return;
      }
      if (!res.ok || !j.canvas) throw new Error(j.error ?? `Could not save (HTTP ${res.status})`);
      version.current = j.canvas.version;
      setSave(pending.current ? "dirty" : "saved");
    } catch (e) {
      pending.current = { ...body, ...(pending.current ?? {}) };
      setSave("error"); setNotice(e instanceof Error ? e.message : String(e));
    }
  }, [id, show]);

  const schedule = useCallback(() => {
    setSave("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, 800);
  }, [flush]);

  /** Change the graph, remembering the previous one for undo unless `transient` (as while dragging). */
  const setGraph = useCallback((next: Graph, opts: { transient?: boolean } = {}) => {
    const cur = current.current;
    if (cur && !opts.transient) {
      past.current.push(clone(cur));
      if (past.current.length > 60) past.current.shift();
      future.current = [];
      setHist({ past: past.current.length, future: 0 });
    }
    show(next);
    pending.current = { ...(pending.current ?? {}), graph: next };
    schedule();
  }, [schedule, show]);

  const setTitle = useCallback((t: string) => { setTitleState(t); pending.current = { ...(pending.current ?? {}), title: t }; schedule(); }, [schedule]);

  const step = useCallback((from: React.RefObject<Graph[]>, to: React.RefObject<Graph[]>) => {
    const g = from.current.pop();
    if (!g) return;
    if (current.current) to.current.push(clone(current.current));
    show(g);
    setHist({ past: past.current.length, future: future.current.length });
    pending.current = { ...(pending.current ?? {}), graph: g };
    schedule();
  }, [schedule, show]);
  const undo = useCallback(() => step(past, future), [step]);
  const redo = useCallback(() => step(future, past), [step]);

  // Save before leaving.
  useEffect(() => {
    const onHide = () => { if (pending.current) void flush(); };
    window.addEventListener("pagehide", onHide);
    return () => { window.removeEventListener("pagehide", onHide); onHide(); };
  }, [flush]);

  // Co-editors: their saves replace ours when nothing of ours is unsaved; their runs appear in the list.
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const es = new EventSource(`/api/edge/canvases/${id}/stream`);
    const onPatch = (m: MessageEvent) => {
      const e = JSON.parse(m.data) as { version: number; label: string; payload: { graph?: Graph; title?: string } };
      if (e.version <= version.current || pending.current) return; // our own save, or ours will clash and load theirs
      version.current = e.version;
      if (e.payload.graph) show(e.payload.graph);
      if (e.payload.title) setTitleState(e.payload.title);
      setNotice(`${e.label || "A teammate"} changed this canvas`);
    };
    const onRun = () => { void api<CanvasData>(`/api/edge/canvases/${id}`).then((d) => setData((cur) => (cur ? { ...cur, runs: d.runs, monitor: d.monitor, checkpoints: d.checkpoints } : d))).catch(() => undefined); };
    es.addEventListener("patch", onPatch);
    es.addEventListener("run", onRun);
    es.addEventListener("checkpoint", onRun);
    return () => es.close();
  }, [id, show]);

  // Follow a run: fast while it goes, slower when hidden, and reload the canvas's run list at the end.
  const followRun = useCallback((runId: number | null) => {
    stopFollow.current?.();
    if (!runId) { setRun(null); return; }
    let live = true;
    let delay = 1200;
    stopFollow.current = () => { live = false; };
    const tick = async () => {
      if (!live) return;
      try {
        const r = await api<RunView>(`/api/edge/runs/${runId}`);
        if (!live) return;
        setRun(r);
        if (r.status === "queued" || r.status === "running") { delay = Math.min(4000, delay + 300); setTimeout(tick, document.visibilityState === "hidden" ? 8000 : delay); }
        else void load();
      } catch { if (live) setTimeout(tick, 5000); }
    };
    void tick();
  }, [load]);
  useEffect(() => () => stopFollow.current?.(), []);

  const startRun = useCallback(async () => {
    await flush();
    const r = await post<{ runId: number }>(`/api/edge/canvases/${id}/run`, {});
    followRun(r.runId);
    return r.runId;
  }, [flush, followRun, id]);

  return {
    data, error, graph, title, save, notice, run, setNotice, setGraph, setTitle, undo, redo, flush, load, startRun, followRun,
    canUndo: hist.past > 0, canRedo: hist.future > 0, readOnly: data?.role === "viewer",
  };
}
