"use client";

import { useMemo, useState } from "react";
import type { Command } from "@/lib/functions";
import { ALL_TOOL_DEFS, toolById, toolsFor } from "@/lib/workflows/registry";
import { ToolRunner } from "@/components/workflows/ToolRunner";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { Icon } from "@/components/ui/Icon";

/** First tool whose id, title, or tags contain any of the keywords (packs are data, so lookups are by keyword). */
export function findToolId(keywords: string[]): string | null {
  const ks = keywords.map((k) => k.toLowerCase());
  const hit = ALL_TOOL_DEFS.find((t) => ks.some((k) => t.id.includes(k.replace(/\s+/g, "-")) || t.title.toLowerCase().includes(k) || (t.tags ?? []).some((g) => g.toLowerCase().includes(k))));
  return hit?.id ?? null;
}

/** Compact gallery inside a terminal panel; picking a tool replaces it with a TOOL panel for the active ticker. */
export function ToolsPanel({ ticker, onRun }: { ticker: string; onRun: (c: Command) => void }) {
  const { profile } = useWorkspace();
  const [q, setQ] = useState("");
  const tools = useMemo(() => {
    const s = q.trim().toLowerCase();
    return toolsFor(profile).filter((t) => !s || [t.title, t.tagline, t.category, ...(t.tags ?? [])].join(" ").toLowerCase().includes(s));
  }, [profile, q]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-1.5 text-[11px]">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${tools.length} tools…`} className="ctl w-52 border border-line bg-bg px-2 py-1 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        <span className="text-muted">Runs on <span className="num text-fg">{ticker}</span> where a ticker applies</span>
      </div>
      <div className="stagger grid min-h-0 flex-1 auto-rows-min gap-1.5 overflow-auto p-2 sm:grid-cols-2">
        {tools.map((t) => (
          <button key={t.id} type="button" onClick={() => onRun({ ticker, fn: "TOOL", arg: t.id })} className="lift ctl flex items-start gap-2 border border-line bg-elevated/50 px-2.5 py-2 text-left">
            <span className={`grid h-6 w-6 shrink-0 place-items-center ctl ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"}`}><Icon name={t.icon} className="h-3.5 w-3.5" /></span>
            <span className="min-w-0"><span className="block truncate text-[11.5px] font-semibold">{t.title}</span><span className="block truncate text-[10.5px] text-muted">{t.tagline}</span></span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function ToolPanel({ ticker, id, onRun }: { ticker: string; id: string; onRun: (c: Command) => void }) {
  const tool = toolById(id);
  if (!tool) {
    const near = ALL_TOOL_DEFS.filter((t) => t.id.includes(id.split("-")[0] ?? "")).slice(0, 6);
    return (
      <div className="p-3 text-[12px]">
        <div className="text-neg">No tool with id “{id}”.</div>
        {near.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{near.map((t) => <button key={t.id} type="button" onClick={() => onRun({ ticker, fn: "TOOL", arg: t.id })} className="ctl border border-line px-2 py-1 text-muted hover:border-accent/50 hover:text-accent">{t.title}</button>)}</div>}
        <button type="button" onClick={() => onRun({ ticker, fn: "TOOLS" })} className="mt-2 text-accent hover:underline">Browse all tools</button>
      </div>
    );
  }
  return <ToolRunner key={`${id}-${ticker}`} tool={tool} compact ticker={ticker} />;
}
