"use client";

import Link from "next/link";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { toolsFor } from "@/lib/workflows/registry";
import { Icon } from "@/components/ui/Icon";
import { useCompanies } from "@/lib/client/companies";
import { Sparkline } from "@/components/charts/Sparkline";
import type { Command } from "@/lib/functions";
import type { OpenPanel } from "./Terminal";
import { LogoMark } from "@/components/brand/Logo";

const shortName = (name: string) =>
  name.replace(/,?\s+(Inc\.?|N\.V\.|Technologies Inc\.?|Corp\.?|plc|Holdings)$/i, "").replace(/ Technologies$/, "").trim();

export function Rail({ activeTicker, panels, onRun, aiLabel }: { activeTicker: string; panels: OpenPanel[]; onRun: (c: Command) => void; aiLabel: string }) {
  const { config, profile } = useWorkspace();
  const tools = toolsFor(profile).slice(0, 5);
  const watchlist = config.watchlist;
  const { data } = useCompanies(watchlist);
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <LogoMark size={22} id="rail" />
        <div className="leading-tight">
          <div className="text-[13px] font-semibold tracking-tight"><span className="text-fg">You</span><span className="text-accent">Bank</span></div>
          <div className="max-w-[170px] truncate text-[10px] text-muted" title={config.title}>{config.title}</div>
        </div>
      </div>

      <div className="px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">Watchlist</div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {watchlist.map((t) => {
          const c = data[t];
          const active = t === activeTicker;
          const chg = c?.price?.changePct ?? null;
          return (
            <li key={t}>
              <button type="button" onClick={() => onRun({ ticker: t, fn: "DES" })}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-elevated ${active ? "bg-elevated" : ""}`}>
                <span className={`h-6 w-0.5 rounded ${active ? "bg-accent" : "bg-transparent"}`} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between">
                    <span className={`font-semibold ${active ? "text-accent" : "text-fg"}`}>{t}</span>
                    <span className="num text-fg">{c?.price ? c.price.last.toFixed(2) : <span className="inline-block h-3 w-10 animate-pulse rounded bg-elevated" />}</span>
                  </span>
                  <span className="flex items-baseline justify-between text-[10.5px]">
                    <span className="truncate text-muted">{c ? shortName(c.name) : "loading…"}</span>
                    {chg !== null && <span className={`num ${chg >= 0 ? "text-pos" : "text-neg"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>}
                  </span>
                </span>
                {c && c.quarters.length > 1 && (
                  <span title="Quarterly revenue trend"><Sparkline values={c.quarters.map((q) => q.revenue)} width={40} height={18} stroke="var(--chart-1)" /></span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-baseline justify-between border-t border-line px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">
        <span>Tools for you</span>
        <Link href="/app/tools" className="normal-case tracking-normal hover:text-fg">all →</Link>
      </div>
      <ul className="px-2 pb-1">
        {tools.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => onRun({ ticker: activeTicker, fn: "TOOL", arg: t.id })} title={t.tagline}
              className="flex w-full items-center gap-1.5 ctl px-1.5 py-1 text-left text-[11px] text-muted hover:bg-elevated hover:text-fg">
              <Icon name={t.icon} className={`h-3 w-3 shrink-0 ${t.kind === "ai" ? "text-accent" : "text-info"}`} />
              <span className="truncate">{t.title}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted">Open panels</div>
      <ul className="max-h-24 overflow-auto px-2 pb-2">
        {panels.length === 0 && <li className="px-1 text-muted">None</li>}
        {panels.map((p) => (
          <li key={p.id} className="flex items-center gap-2 px-1 py-0.5 text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent/80" />
            <span className="text-fg">{p.ticker}</span>
            <span className="text-muted">{p.fn}</span>
          </li>
        ))}
      </ul>

      <div className="border-t border-line px-3 py-2 text-[10px] text-muted">
        <div className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-pos" /> SEC EDGAR · live prices</div>
        <div className="flex items-center gap-1.5 truncate" title={aiLabel}><span className="h-1.5 w-1.5 rounded-full bg-faint" /> {aiLabel}</div>
        <div className="mt-1 text-faint">Press ? for commands</div>
      </div>
    </aside>
  );
}
