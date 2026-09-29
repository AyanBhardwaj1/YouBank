"use client";

import { useEffect, useSyncExternalStore } from "react";
import { EFFORTS, MODELS, type Effort, type ModelDef } from "@/lib/ai/models";
import { Select } from "@/components/ui/Select";

export type AiSettings = { model?: string; effort?: Effort };
type Catalog = { providers: string[]; models: (ModelDef & { available: boolean })[] };

let catalogCache: Catalog | null = null;
let statusCache: { model: string; effort: Effort; configured: boolean; provider: string; label?: string } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Account-level AI settings, shared by every picker on the page and persisted to the profile. */
export function useAiSettings() {
  // The server has no status, so hydration renders none too (the server snapshot); the shared store
  // takes over after, even when another component on the page fetched it before this one hydrated.
  const statusNow = useSyncExternalStore(subscribe, () => statusCache, () => null);
  const catalogNow = useSyncExternalStore(subscribe, () => catalogCache, () => null);
  useEffect(() => {
    if (!statusCache) fetch("/api/ai/status").then((r) => r.json()).then((s) => { statusCache = s; notify(); }).catch(() => {});
    if (!catalogCache) fetch("/api/ai/models").then((r) => r.json()).then((c) => { if (c && Array.isArray(c.models)) { catalogCache = c; notify(); } }).catch(() => {});
  }, []);
  const settings: AiSettings = { model: statusNow?.model, effort: statusNow?.effort };
  const setSettings = (next: AiSettings, persist = true) => {
    if (statusCache) statusCache = { ...statusCache, model: next.model ?? statusCache.model, effort: next.effort ?? statusCache.effort, label: MODELS.find((m) => m.id === next.model)?.label };
    notify();
    if (persist) fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ai: next }) }).catch(() => {});
  };
  return { settings, setSettings, catalog: catalogNow, status: statusNow };
}

const tierLabel: Record<ModelDef["tier"], string> = { flagship: "Flagship", pro: "Pro", balanced: "Balanced", fast: "Fast", reasoning: "Reasoning", legacy: "Older" };

export function ModelPicker({ value, onChange, compact = false }: { value: AiSettings; onChange: (v: AiSettings) => void; compact?: boolean }) {
  const { catalog } = useAiSettings();
  const models = (catalog?.models ?? MODELS.map((m) => ({ ...m, available: true }))).filter((m) => m.available);
  const current = MODELS.find((m) => m.id === value.model);
  if (compact) {
    return (
      <span className="flex items-center gap-1 text-[11px] text-muted">
        <Select value={value.model ?? ""} onChange={(v) => onChange({ ...value, model: v })} className="ctl max-w-[170px] border border-line bg-elevated px-1.5 py-1 text-fg" title="Model">
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}{m.recommended ? " ★" : ""}</option>)}
        </Select>
        {(current?.effort ?? true) && (
          <Select value={value.effort ?? "medium"} onChange={(v) => onChange({ ...value, effort: v as Effort })} className="ctl border border-line bg-elevated px-1.5 py-1 text-fg" title="Reasoning effort">
            {EFFORTS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        )}
      </span>
    );
  }
  const families = [...new Set(models.map((m) => m.family))];
  return (
    <div className="space-y-4">
      {families.map((fam) => (
        <div key={fam}>
          <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-muted">{fam}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {models.filter((m) => m.family === fam).map((m) => {
              const active = m.id === value.model;
              return (
                <button key={m.id} type="button" onClick={() => onChange({ ...value, model: m.id })} className={`lift ctl border p-3 text-left ${active ? "border-accent bg-accent-soft" : "border-line bg-panel"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-[12.5px] font-semibold ${active ? "text-accent" : ""}`}>{m.label}{m.recommended && <span className="ml-1 text-[10px] text-accent">★</span>}</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted">{tierLabel[m.tier]}</span>
                  </div>
                  <div className="mt-1 text-[11px] leading-snug text-muted">{m.description}</div>
                  <div className="num mt-1.5 text-[10px] text-faint">{m.provider} · cost {"$".repeat(m.cost)}</div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div>
        <div className="mb-1.5 text-[10.5px] uppercase tracking-wider text-muted">Reasoning effort</div>
        <div className="flex flex-wrap gap-2">
          {EFFORTS.map((e) => (
            <button key={e.id} type="button" onClick={() => onChange({ ...value, effort: e.id })} className={`ctl border px-3 py-1.5 text-left ${value.effort === e.id ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`} title={e.hint}>
              <div className="text-[12px] font-semibold">{e.label}</div><div className="text-[10.5px] opacity-80">{e.hint}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
