"use client";

/**
 * Documents · RAG: ask across filings, calls, data rooms, the workspace, the Newsroom and the web with
 * every claim quoted and checked; keep the library; see what changed between filings or calls; and map
 * the topics of a big corpus. Any citation opens the source viewer at the exact place.
 */
import { useCallback, useState } from "react";
import { AskPanel, type AskScope } from "./AskPanel";
import { ChangeRadar } from "./ChangeRadar";
import { CitationViewer } from "./CitationViewer";
import type { ViewTarget } from "./client";
import { Library } from "./Library";
import { TopicMapView } from "./TopicMap";

export type DocsTab = "ask" | "library" | "radar" | "topics";
const TABS: { id: DocsTab; label: string }[] = [{ id: "ask", label: "Ask" }, { id: "library", label: "Library" }, { id: "radar", label: "Change radar" }, { id: "topics", label: "Topic map" }];

export type DocsOpen = { tab?: DocsTab; answer?: number | null; radar?: { ticker: string; form?: string; section?: string } | null; key: number };

export function DocumentsView({ tickers, open }: { tickers: string[]; open?: DocsOpen | null }) {
  const [tab, setTab] = useState<DocsTab>(open?.tab ?? (open?.radar ? "radar" : "ask"));
  const [target, setTarget] = useState<ViewTarget | null>(null);
  const [scope, setScope] = useState<AskScope>(null);
  const [preset, setPreset] = useState<{ question: string; key: number; tickers?: string[]; sources?: string[] } | null>(null);
  const onCite = useCallback((t: ViewTarget) => setTarget(t), []);
  const close = useCallback(() => setTarget(null), []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-0.5 rounded-lg border border-line p-0.5" role="tablist" aria-label="Documents">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1 text-[12.5px] ${tab === t.id ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{t.label}</button>
          ))}
        </div>
        <p className="text-[11.5px] text-muted">Every quote is checked against its source before you see it.</p>
      </div>

      {tab === "ask" && (
        <AskPanel key={preset?.key ?? 0} onCite={onCite} scope={scope} clearScope={() => setScope(null)} suggestTickers={tickers} openAnswer={open?.answer ?? null} preset={preset} />
      )}
      {tab === "library" && <Library onAsk={(docIds, label) => { setScope({ docIds, label }); setPreset(null); setTab("ask"); }} />}
      {tab === "radar" && <ChangeRadar key={open?.key ?? 0} onCite={onCite} suggest={tickers} initial={open?.radar ?? null} />}
      {tab === "topics" && <TopicMapView onCite={onCite} onAskTopic={(question, s) => { setScope(null); setPreset({ question, key: Date.now(), ...s }); setTab("ask"); }} />}

      <CitationViewer target={target} onClose={close} />
    </div>
  );
}
