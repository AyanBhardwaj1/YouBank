"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ToolDef, WorkflowOutput, Inputs } from "@/lib/workflows/types";
import { WorkflowOutput as OutputSchema } from "@/lib/workflows/types";
import { FieldsForm, defaultInputs } from "./FieldsForm";
import { OutputBlocks, outputToMarkdown } from "./OutputBlocks";
import { Icon } from "@/components/ui/Icon";
import { ModelPicker, useAiSettings } from "@/components/ai/ModelPicker";
import { readSse, errorOf } from "@/lib/client/sse";
import { useCompany } from "@/lib/client/companies";
import { useCollabSession } from "@/lib/client/collab";
import type { Source } from "@/components/terminal/Markdown";

type ToolEvent = { name: string; status: "start" | "end"; summary?: string };
type RunSummary = { id: number; title: string; createdAt: string; model: string; status: string };

export function ToolRunner({ tool, initialInputs, runId, compact = false, ticker, sessionId, me }: {
  tool: ToolDef; initialInputs?: Inputs; runId?: number; compact?: boolean; ticker?: string;
  /** When set, the inputs below are shared live with everyone else in this session. */
  sessionId?: number; me?: { id: string; name: string };
}) {
  const [inputs, setInputs] = useState<Inputs>(() => defaultInputs(tool.fields, { ...(ticker && tool.fields.some((f) => f.key === "ticker") ? { ticker } : {}), ...(initialInputs ?? {}) }));
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<ToolEvent[]>([]);
  const [thinking, setThinking] = useState("");
  const [progress, setProgress] = useState(0);
  const [output, setOutput] = useState<WorkflowOutput | null>(null);
  const [sources, setSources] = useState<Source[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ model?: string; durationMs?: number; runId?: number | null }>({});
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(false);
  const { settings, setSettings } = useAiSettings();
  const prefillTicker = tool.kind === "calc" && tool.prefill ? (ticker ?? String(inputs.ticker ?? "")) : null;
  const { data: company } = useCompany(prefillTicker || null);
  const prefilled = useRef(false);
  const outRef = useRef<HTMLDivElement>(null);

  // A remote edit arrives on the event stream, so merging it here is not a render-phase update.
  const collab = useCollabSession(sessionId ?? null, {
    selfId: me?.id,
    onRemote: (patch, from) => {
      setInputs((cur) => ({ ...cur, ...patch }));
      setStatus(`${from} changed ${Object.keys(patch).join(", ")}`);
    },
  });

  /** Local edits go to the shared state; only the fields that actually changed are sent. */
  const changeInputs = useCallback((next: Inputs) => {
    if (sessionId) {
      const diff: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(next)) if (inputs[k] !== v) diff[k] = v;
      if (Object.keys(diff).length) collab.patch(diff);
    }
    setInputs(next);
  }, [sessionId, inputs, collab]);

  // Calculators compute live.
  const calc = useMemo(() => {
    if (tool.kind !== "calc") return null;
    try { return { output: tool.compute(inputs), error: null as string | null }; } catch (e) { return { output: null, error: e instanceof Error ? e.message : String(e) }; }
  }, [tool, inputs]);

  useEffect(() => {
    if (tool.kind === "calc" && tool.prefill && company && !prefilled.current) { prefilled.current = true; setInputs((cur) => ({ ...cur, ...tool.prefill!(company) })); setStatus(`Prefilled from ${company.ticker} SEC data`); }
  }, [company, tool]);

  const loadRun = useCallback(async (id: number) => {
    try {
      const r = await fetch(`/api/tools/runs/${id}`);
      if (!r.ok) throw new Error(await errorOf(r));
      const row = await r.json();
      const parsed = OutputSchema.safeParse(row.output);
      if (parsed.success) { setOutput(parsed.data); setSources(row.sources ?? []); setInputs((cur) => ({ ...cur, ...(row.inputs ?? {}) })); setMeta({ model: row.model, durationMs: row.durationMs, runId: row.id }); }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  useEffect(() => { if (!runId) return; const t = setTimeout(() => void loadRun(runId), 0); return () => clearTimeout(t); }, [runId, loadRun]);

  const refreshRuns = useCallback(() => { fetch(`/api/tools/runs?tool=${encodeURIComponent(tool.id)}&limit=12`).then((r) => r.json()).then((r) => setRuns(Array.isArray(r) ? r : [])).catch(() => setRuns([])); }, [tool.id]);
  useEffect(() => { const t = setTimeout(refreshRuns, 0); return () => clearTimeout(t); }, [refreshRuns]);

  const run = async () => {
    if (tool.kind !== "ai" || busy) return;
    setBusy(true); setEvents([]); setThinking(""); setProgress(0); setOutput(null); setSources([]); setError(null); setMeta({});
    try {
      const res = await fetch("/api/tools/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: tool.id, inputs, model: settings.model, effort: settings.effort }) });
      if (!res.ok) throw new Error(await errorOf(res));
      await readSse(res, (ev) => {
        if (ev.type === "tool") setEvents((es) => { const next = [...es]; if (ev.status === "start") next.push({ name: String(ev.name), status: "start", summary: ev.summary as string }); else { const k = next.findLastIndex((t) => t.name === ev.name && t.status === "start"); if (k >= 0) next[k] = { ...next[k], status: "end", summary: (ev.summary as string) || next[k].summary }; } return next; });
        else if (ev.type === "thinking") setThinking((t) => t + String(ev.text));
        else if (ev.type === "progress") setProgress((p) => p + Number(ev.chars ?? 0));
        else if (ev.type === "error") setError(String(ev.message));
        else if (ev.type === "output") {
          if (ev.output) { setOutput(ev.output as WorkflowOutput); setSources((ev.sources as Source[]) ?? []); }
          if (ev.error) setError(String(ev.error));
          setMeta({ model: ev.model as string, durationMs: ev.durationMs as number, runId: ev.runId as number | null });
        }
      });
      refreshRuns();
      setTimeout(() => outRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const saveCalc = async () => {
    if (!calc?.output) return;
    try { const r = await fetch("/api/tools/runs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toolId: tool.id, inputs, output: calc.output }) }); if (!r.ok) throw new Error(await errorOf(r)); setStatus("Saved to your library"); refreshRuns(); setTimeout(() => setStatus(null), 2500); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const shown = tool.kind === "calc" ? calc?.output ?? null : output;
  const md = shown ? outputToMarkdown(shown, sources) : "";
  const copy = async () => { try { await navigator.clipboard.writeText(md); setStatus("Copied as markdown"); setTimeout(() => setStatus(null), 2000); } catch { setStatus("Copy failed"); } };
  const download = () => { const blob = new Blob([md], { type: "text/markdown" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${tool.id}-${new Date().toISOString().slice(0, 10)}.md`; a.click(); URL.revokeObjectURL(a.href); };
  const missing = tool.fields.filter((f) => f.required && (inputs[f.key] === undefined || inputs[f.key] === "" || (Array.isArray(inputs[f.key]) && (inputs[f.key] as unknown[]).length === 0)));

  return (
    <div className={`flex h-full flex-col ${compact ? "" : "gap-4"}`}>
      {!compact && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center ctl bg-accent-soft text-accent"><Icon name={tool.icon} className="h-4.5 w-4.5" /></span>
              <div>
                <h1 className="text-[18px] font-semibold leading-tight">{tool.title}</h1>
                <div className="text-[11.5px] text-muted">{tool.tagline}</div>
              </div>
            </div>
            <p className="mt-2 max-w-[760px] text-[12px] leading-relaxed text-muted">{tool.description}</p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <span className="rounded-full border border-line px-2 py-0.5">{tool.kind === "ai" ? "AI workflow" : "Calculator"}</span>
            <span className="rounded-full border border-line px-2 py-0.5">{tool.category}</span>
            {tool.savesMinutes && <span className="rounded-full border border-line px-2 py-0.5">saves ~{tool.savesMinutes >= 60 ? `${(tool.savesMinutes / 60).toFixed(tool.savesMinutes % 60 ? 1 : 0)}h` : `${tool.savesMinutes}m`}</span>}
          </div>
        </div>
      )}

      {sessionId && (
        <div className={`flex flex-wrap items-center justify-between gap-2 border-b border-line bg-elevated/40 px-3.5 py-2 text-[11.5px] ${compact ? "" : ""}`}>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${collab.connected ? "bg-pos" : "bg-warn"}`}
              title={collab.connected ? "Live" : "Reconnecting"} />
            <span className="text-muted">{collab.connected ? "Shared session" : "Reconnecting…"}</span>
            {collab.presence.map((p) => (
              <span key={p.userId} className={`ctl px-1.5 py-0.5 ${p.userId === me?.id ? "bg-elevated text-muted" : "bg-accent-soft text-accent"}`}>
                {p.userId === me?.id ? "you" : p.name || "someone"}{p.field ? ` · ${p.field}` : ""}
              </span>
            ))}
          </span>
          <span className="text-[11px] text-muted">Everyone here edits the same inputs.</span>
        </div>
      )}

      <div className={`grid gap-4 ${compact ? "p-3" : ""} ${tool.kind === "calc" && !compact ? "lg:grid-cols-[380px_1fr]" : ""}`}>
        <section className="panel p-3.5">
          <FieldsForm fields={tool.fields} values={inputs} onChange={changeInputs} columns={tool.kind === "calc" ? 1 : compact ? 1 : 2} />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {tool.kind === "ai" ? (
              <button type="button" onClick={run} disabled={busy || missing.length > 0} title={missing.length ? `Fill in: ${missing.map((m) => m.label).join(", ")}` : undefined}
                className="ctl glow flex items-center gap-1.5 bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-40">
                {busy ? <><span className="h-2 w-2 animate-pulse rounded-full bg-accent-fg" /> Working…</> : <><Icon name="Play" className="h-3.5 w-3.5" /> Run workflow</>}
              </button>
            ) : (
              <button type="button" onClick={saveCalc} disabled={!calc?.output} className="ctl flex items-center gap-1.5 bg-accent px-3.5 py-1.5 text-[12.5px] font-semibold text-accent-fg disabled:opacity-40"><Icon name="Save" className="h-3.5 w-3.5" /> Save result</button>
            )}
            {tool.example && <button type="button" onClick={() => setInputs(defaultInputs(tool.fields, tool.example))} className="ctl border border-line px-2.5 py-1.5 text-[11.5px] text-muted hover:border-accent/50 hover:text-fg">Try an example</button>}
            {tool.kind === "ai" && <ModelPicker value={settings} onChange={setSettings} compact />}
            {status && <span className="text-[11px] text-pos">{status}</span>}
            {runs && runs.length > 0 && (
              <select value="" onChange={(e) => { const id = Number(e.target.value); if (id) void loadRun(id); }} className="ctl ml-auto border border-line bg-elevated px-2 py-1 text-[11px] text-muted">
                <option value="">History ({runs.length})…</option>
                {runs.map((r) => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {r.title.slice(0, 40)}</option>)}
              </select>
            )}
          </div>
          {tool.kind === "ai" && (busy || events.length > 0 || thinking) && (
            <div className="mt-3 border-t border-line pt-2 text-[11px]">
              <div className="flex flex-wrap items-center gap-1.5">
                {events.map((t, j) => (
                  <span key={j} className={`num rounded border border-line px-1.5 py-px text-[10px] ${t.status === "start" ? "animate-pulse text-accent" : "text-muted"}`} title={t.summary}>{t.status === "start" ? "⟳" : "✓"} {t.name}</span>
                ))}
                {busy && progress > 0 && <span className="text-muted">composing… {progress.toLocaleString()} chars</span>}
                {busy && events.length === 0 && progress === 0 && <span className="text-muted">planning…</span>}
              </div>
              {thinking && (
                <div className="mt-1.5">
                  <button type="button" onClick={() => setShowThinking((s) => !s)} className="text-[10.5px] text-muted hover:text-fg">{showThinking ? "Hide" : "Show"} reasoning</button>
                  {showThinking && <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-line bg-bg p-2 font-sans text-[11px] text-muted">{thinking}</pre>}
                </div>
              )}
            </div>
          )}
          {(error || calc?.error) && <div className="mt-2 text-[11.5px] text-neg">{error ?? calc?.error}</div>}
        </section>

        <section ref={outRef} className={`min-w-0 ${compact ? "" : "panel p-4"}`}>
          {shown ? (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                <div className="text-[15px] font-semibold">{shown.title}</div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted">
                  {meta.model && <span className="num">{meta.model}{meta.durationMs ? ` · ${(meta.durationMs / 1000).toFixed(0)}s` : ""}</span>}
                  <button type="button" onClick={copy} className="ctl border border-line px-2 py-0.5 hover:border-accent/50 hover:text-fg" title="Copy as markdown"><Icon name="Copy" className="h-3 w-3" /></button>
                  <button type="button" onClick={download} className="ctl border border-line px-2 py-0.5 hover:border-accent/50 hover:text-fg" title="Download .md"><Icon name="Download" className="h-3 w-3" /></button>
                  {!compact && <Link href={`/app/terminal?ticker=${encodeURIComponent(String(inputs.ticker ?? ""))}&fn=AI`} className="ctl border border-line px-2 py-0.5 hover:border-accent/50 hover:text-fg" title="Discuss in the AI panel"><Icon name="MessageSquare" className="h-3 w-3" /></Link>}
                </div>
              </div>
              <OutputBlocks output={shown} sources={sources} compact={compact} />
            </>
          ) : (
            <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 text-center text-muted">
              <Icon name={tool.icon} className="h-8 w-8 text-faint" />
              <div className="text-[12.5px]">{tool.kind === "ai" ? "Fill in the inputs and run. Progress and sources stream in here." : "Results update as you type."}</div>
              {tool.example && <button type="button" onClick={() => setInputs(defaultInputs(tool.fields, tool.example))} className="text-[11.5px] text-accent hover:underline">Load the example</button>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
