"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseAddr } from "@/lib/studio/address";
import type { StudioStreamEvent } from "@/lib/studio/agent";
import type { Issue } from "@/lib/studio/audit";
import type { SemDiff } from "@/lib/studio/checkpoints";
import type { TieIssue } from "@/lib/studio/deck";
import type { LintIssue } from "@/lib/studio/lint";
import { Engine } from "@/lib/studio/engine";
import { applyPatch, applyWithUndo, describePatches, type Patch } from "@/lib/studio/ops";
import type { StudioDocData } from "@/lib/studio/types";

export type Run = { id: string; instruction: string; status: string; summary: string; model: string; stats: Record<string, number>; startedAt: string; finishedAt: string | null };
export type HistoryItem = { id: number; actor: string; actorName: string; runId: string; label: string; createdAt: string };
export type Meta = {
  kind: string; ticker: string; intake: Record<string, unknown> | null; teamId: number | null; mine: boolean;
  runs: Run[]; history: HistoryItem[]; teams: { id: number; name: string }[]; me: { id: string; name: string };
};
export type LogItem =
  | { k: "tool"; name: string; summary?: string; done: boolean; at: number }
  | { k: "note"; text: string; at: number }
  | { k: "change"; label: string; at: number }
  | { k: "error"; text: string; at: number };
export type Health = { errors: number; warnings: number; infos: number; top: Issue[] };
export type AgentState = { running: boolean; runId: string | null; instruction: string; log: LogItem[]; text: string; model: string; stats: Record<string, number> | null; startedAt: number };
export type Chat = { role: "user" | "assistant"; content: string };
export type Checkpoint = { id: number; name: string; createdByName: string; eventId: number; createdAt: string };

/** Cells the agent just wrote: when each becomes visible (revealed in reading order) and until when it glows. */
export type Flash = Map<string, { at: number; until: number; hidden: boolean }>;

const J = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
};

export function useStudio(id: number) {
  const docRef = useRef<StudioDocData | null>(null);
  const engineRef = useRef<Engine | null>(null);
  const applied = useRef(new Set<number>());
  const undoStack = useRef<{ patches: Patch[]; undo: Patch[]; label: string }[]>([]);
  const flash = useRef<Flash>(new Map());
  const abort = useRef<AbortController | null>(null);
  const me = useRef<string>("");
  const [, setVersion] = useState(0);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [focus, setFocus] = useState<{ sheet: string; range: string; at: number } | null>(null);
  const [focusSlide, setFocusSlide] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [ties, setTies] = useState<TieIssue[] | null>(null);
  const [lint, setLint] = useState<LintIssue[] | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [agent, setAgent] = useState<AgentState>({ running: false, runId: null, instruction: "", log: [], text: "", model: "", stats: null, startedAt: 0 });
  const [chat, setChat] = useState<Chat[]>([]);
  const [saving, setSaving] = useState(0);
  const [clock, setClock] = useState(0);
  const lastWhere = useRef<{ where: "model" | "deck"; sheet?: string; slide?: string } | null>(null);
  const bump = useCallback(() => { setVersion((v) => v + 1); setClock(performance.now()); }, []);

  const load = useCallback(async () => {
    const d = await J<{ doc: StudioDocData; cursor: number } & Meta>(await fetch(`/api/studio/${id}`));
    docRef.current = d.doc;
    engineRef.current = new Engine(d.doc.workbook);
    me.current = d.me.id;
    setMeta({ kind: d.kind, ticker: d.ticker, intake: d.intake, teamId: d.teamId, mine: d.mine, runs: d.runs, history: d.history, teams: d.teams, me: d.me });
    bump();
    return d.cursor;
  }, [id, bump]);

  /** Runs, history and team: a light read that leaves the document itself alone. */
  const refreshMeta = useCallback(async () => {
    const d = await J<Pick<Meta, "runs" | "history" | "teamId">>(await fetch(`/api/studio/${id}?meta=1`)).catch(() => null);
    if (d) setMeta((m) => (m ? { ...m, runs: d.runs, history: d.history, teamId: d.teamId } : m));
  }, [id]);

  /** The same, for changes streaming in from others: one refresh covers every change in a two-second window. */
  const metaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshMetaSoon = useCallback(() => {
    if (metaTimer.current) return;
    metaTimer.current = setTimeout(() => { metaTimer.current = null; void refreshMeta(); }, 2_000);
  }, [refreshMeta]);
  useEffect(() => () => { if (metaTimer.current) clearTimeout(metaTimer.current); }, []);

  /** Apply patches that arrived from elsewhere (the agent or another person), with a reveal and glow. */
  const receive = useCallback((eventId: number, patches: Patch[], reveal: boolean) => {
    if (eventId && applied.current.has(eventId)) return;
    if (eventId) applied.current.add(eventId);
    const doc = docRef.current, engine = engineRef.current;
    if (!doc || !engine) return;
    const now = performance.now();
    let n = 0;
    for (const p of patches) {
      if (p.op === "cells") {
        const sheet = doc.workbook.sheets[p.sheet];
        const keys = Object.keys(p.cells).sort((a, b) => { const x = parseAddr(a)!, y = parseAddr(b)!; return x.r - y.r || x.c - y.c; });
        const step = keys.length > 1 ? Math.min(14, 900 / keys.length) : 0;
        for (const a of keys) {
          const wasEmpty = !sheet?.cells[a]?.f && (sheet?.cells[a]?.v === undefined || sheet?.cells[a]?.v === null);
          const at = now + (reveal ? n * step : 0);
          flash.current.set(`${p.sheet}!${a}`, { at, until: at + 1400, hidden: reveal && wasEmpty && !!p.cells[a] });
          n++;
        }
      }
      applyPatch(doc, p, engine);
    }
    bump();
  }, [bump]);

  // Re-render while cells are still being revealed (the glow itself is a CSS animation).
  useEffect(() => {
    const t = setInterval(() => {
      const now = performance.now();
      let pending = false, expired = false;
      for (const [k, f] of flash.current) {
        if (f.until < now) { flash.current.delete(k); expired = true; }
        else if (f.hidden && f.at > now - 60) pending = true;
      }
      if (pending || expired) bump();
    }, 40);
    return () => clearInterval(t);
  }, [bump]);

  // Load, then follow everyone else's edits while the page is in view. A tab left in the background
  // closes its stream after a short grace period and, shown again, resumes from the last change it saw.
  useEffect(() => {
    let es: EventSource | null = null;
    let closed = false;
    let last = 0;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    const open = () => {
      if (es || closed) return;
      es = new EventSource(`/api/studio/${id}/stream?since=${last}`);
      es.addEventListener("change", (m) => {
        const e = JSON.parse((m as MessageEvent).data) as { id: number; patches: Patch[]; actor: string; runId: string; label: string };
        last = Math.max(last, e.id);
        // My own edits were applied the moment I made them; replaying them could briefly undo a later keystroke.
        if (e.actor === me.current && !e.runId) { applied.current.add(e.id); return; }
        if (!applied.current.has(e.id)) { receive(e.id, e.patches, e.actor === "agent" || e.actor === "edge"); refreshMetaSoon(); }
      });
    };
    const shut = () => { es?.close(); es = null; };
    const onVisibility = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (document.visibilityState === "hidden") hideTimer = setTimeout(shut, 30_000);
      else open();
    };
    const t = setTimeout(() => {
      load().then((cursor) => {
        if (closed) return;
        last = cursor;
        if (document.visibilityState !== "hidden") open();
        document.addEventListener("visibilitychange", onVisibility);
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 0);
    return () => {
      closed = true;
      clearTimeout(t);
      if (hideTimer) clearTimeout(hideTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      shut();
    };
  }, [id, load, receive, refreshMetaSoon]);

  /** A person's edit: applied now, saved in the background with its undo. */
  const edit = useCallback(async (patches: Patch[], label?: string) => {
    const doc = docRef.current, engine = engineRef.current;
    if (!doc || !engine || !patches.length) return;
    const text = label ?? describePatches(doc, patches);
    const undo = applyWithUndo(doc, patches, engine);
    undoStack.current.push({ patches, undo, label: text });
    if (undoStack.current.length > 100) undoStack.current.shift();
    bump();
    setSaving((n) => n + 1);
    try {
      const r = await J<{ eventId: number }>(await fetch(`/api/studio/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ patches, undo, label: text }) }));
      applied.current.add(r.eventId);
    } catch (e) {
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}. Reloading.`);
      await load().catch(() => undefined);
    } finally { setSaving((n) => n - 1); }
  }, [id, bump, load]);

  const undoLast = useCallback(async () => {
    const last = undoStack.current.pop();
    if (!last) return;
    const doc = docRef.current, engine = engineRef.current;
    if (!doc || !engine) return;
    const redo = applyWithUndo(doc, last.undo, engine);
    bump();
    try {
      const r = await J<{ eventId: number }>(await fetch(`/api/studio/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ patches: last.undo, undo: redo, label: `Undid: ${last.label}` }) }));
      applied.current.add(r.eventId);
    } catch { await load().catch(() => undefined); }
  }, [id, bump, load]);

  const undoRun = useCallback(async (runId: string) => {
    const r = await J<{ event: { id: number; patches: Patch[] } }>(await fetch(`/api/studio/${id}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) }));
    receive(r.event.id, r.event.patches, false);
    setNotice("Undid the agent's run.");
    refreshMeta();
  }, [id, receive, refreshMeta]);

  const undoEvent = useCallback(async (eventId: number) => {
    const r = await J<{ event: { id: number; patches: Patch[] } }>(await fetch(`/api/studio/${id}/undo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ eventId }) }));
    receive(r.event.id, r.event.patches, false);
    refreshMeta();
  }, [id, receive, refreshMeta]);

  const action = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    const r = await J<{ events: { id: number; patches: Patch[] }[]; result: unknown }>(await fetch(`/api/studio/${id}/action`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: name, args }) }));
    for (const e of r.events) receive(e.id, e.patches, name === "template");
    if (name === "audit") setIssues(r.result as Issue[]);
    if (name === "tieout") setTies(r.result as TieIssue[]);
    if (name === "lint" || name === "lint_fix") setLint(r.result as LintIssue[]);
    if (r.events.length) refreshMeta();
    return r.result;
  }, [id, receive, refreshMeta]);

  /** Run the agent and watch it work: every patch it commits is applied the moment it is stored. */
  const run = useCallback(async (instruction: string, opts: { effort?: "fast" | "balanced" | "thorough"; selection?: { sheet?: string; range?: string } } = {}) => {
    if (agent.running) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const history = chat.slice(-6);
    setChat((c) => [...c, { role: "user", content: instruction }]);
    lastWhere.current = null;
    setAgent({ running: true, runId: null, instruction, log: [], text: "", model: "", stats: null, startedAt: Date.now() });
    setHealth(null);
    let text = "";
    const log = (item: LogItem) => setAgent((a) => ({ ...a, log: [...a.log.slice(-120), item] }));
    try {
      const res = await fetch(`/api/studio/${id}/agent`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instruction, effort: opts.effort, selection: opts.selection, history }), signal: ctl.signal });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Agent failed (${res.status})`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as StudioStreamEvent;
          switch (e.t) {
            case "patch": receive(e.id, e.patches, true); log({ k: "change", label: e.label, at: Date.now() }); setAgent((a) => ({ ...a, runId: e.runId })); break;
            case "focus": setFocus({ sheet: e.sheet, range: e.range, at: Date.now() }); lastWhere.current = { where: "model", sheet: e.sheet }; break;
            case "slide": setFocusSlide(e.slide); lastWhere.current = { where: "deck", slide: e.slide }; break;
            case "tool":
              if (e.status === "start") log({ k: "tool", name: e.name, summary: e.summary, done: false, at: Date.now() });
              else setAgent((a) => { const i = [...a.log].reverse().findIndex((x) => x.k === "tool" && x.name === e.name && !x.done); if (i < 0) return a; const idx = a.log.length - 1 - i; const next = [...a.log]; next[idx] = { ...(next[idx] as Extract<LogItem, { k: "tool" }>), done: true }; return { ...a, log: next }; });
              break;
            case "note": log({ k: "note", text: e.text, at: Date.now() }); break;
            case "text": text += e.text; setAgent((a) => ({ ...a, text: a.text + e.text })); break;
            case "health": setHealth({ errors: e.errors, warnings: e.warnings, infos: e.infos, top: e.top }); break;
            case "error": log({ k: "error", text: e.message, at: Date.now() }); break;
            case "done": setAgent((a) => ({ ...a, runId: e.runId || a.runId, model: e.model, stats: e.stats })); break;
          }
        }
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) log({ k: "error", text: e instanceof Error ? e.message : String(e), at: Date.now() });
    } finally {
      abort.current = null;
      setAgent((a) => ({ ...a, running: false }));
      if (text) setChat((c) => [...c, { role: "assistant", content: text }]);
      refreshMeta();
    }
  }, [agent.running, chat, id, receive, refreshMeta]);

  const stop = useCallback(() => { abort.current?.abort(); }, []);

  /** A marked-up printout becomes comments; a data-room PDF becomes a sheet of sourced inputs. */
  const readDocument = useCallback(async (kind: "markup" | "extract", file: File) => {
    const form = new FormData();
    form.set("file", file);
    const r = await J<{ event: { id: number; patches: Patch[] } | null; added?: number; unplaced?: number; illegible?: number; sheet?: { id: string; name: string }; tables?: number; figures?: number; notes?: string[] }>(await fetch(`/api/studio/${id}/${kind}`, { method: "POST", body: form }));
    if (r.event) receive(r.event.id, r.event.patches, kind === "extract");
    refreshMeta();
    return r;
  }, [id, receive, refreshMeta]);

  const loadCheckpoints = useCallback(async () => {
    const r = await J<{ checkpoints: Checkpoint[] }>(await fetch(`/api/studio/${id}/checkpoints`));
    setCheckpoints(r.checkpoints);
  }, [id]);
  const saveCheckpoint = useCallback(async (name: string) => {
    await J(await fetch(`/api/studio/${id}/checkpoints`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }));
    await loadCheckpoints();
  }, [id, loadCheckpoints]);
  const compareCheckpoint = useCallback(async (cid: number) => J<{ diff: SemDiff; summary: string }>(await fetch(`/api/studio/${id}/checkpoints/${cid}`)), [id]);
  const restoreCheckpoint = useCallback(async (cid: number) => {
    const r = await J<{ event: { id: number; patches: Patch[] } | null }>(await fetch(`/api/studio/${id}/checkpoints/${cid}`, { method: "POST" }));
    if (r.event) receive(r.event.id, r.event.patches, false);
    refreshMeta();
    return !!r.event;
  }, [id, receive, refreshMeta]);

  return {
    doc: docRef.current, engine: engineRef.current, meta, error, setError, notice, setNotice, focus, setFocus, focusSlide, setFocusSlide, health, issues, setIssues, ties, setTies, clock,
    /** Where the agent last worked, for settling the view when a run ends. */
    lastWhere: () => lastWhere.current,
    agent, run, stop, edit, undoLast, undoRun, undoEvent, action, flash: flash.current, saving: saving > 0, reload: load, chat,
    lint, setLint, readDocument, checkpoints, loadCheckpoints, saveCheckpoint, compareCheckpoint, restoreCheckpoint,
  };
}
