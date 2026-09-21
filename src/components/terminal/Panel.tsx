"use client";

import type { AiStatus, OpenPanel } from "./Terminal";
import { FUNCTIONS, type Command } from "@/lib/functions";
import { useCompany } from "@/lib/client/companies";
import { DesScreen } from "./screens/DesScreen";
import { FaScreen } from "./screens/FaScreen";
import { CompsScreen } from "./screens/CompsScreen";
import { PrecScreen } from "./screens/PrecScreen";
import { FilScreen } from "./screens/FilScreen";
import { AiScreen } from "./screens/AiScreen";
import { PgScreen } from "./screens/PgScreen";
import { CapScreen } from "./screens/CapScreen";
import { EvtScreen } from "./screens/EvtScreen";
import { InsScreen } from "./screens/InsScreen";
import { XbrlScreen } from "./screens/XbrlScreen";
import { ToolsPanel, ToolPanel } from "./screens/ToolPanels";

type Props = {
  panel: OpenPanel;
  maximized: boolean;
  onClose: () => void;
  onToggleMax: () => void;
  onRun: (command: Command) => void;
  ai: AiStatus | null;
  openPanels: OpenPanel[];
};

const NEEDS_COMPANY = new Set(["DES", "FA", "COMPS", "FIL", "CAP"]);

export function Panel({ panel, maximized, onClose, onToggleMax, onRun, ai, openPanels }: Props) {
  const needs = NEEDS_COMPANY.has(panel.fn) || panel.fn === "AI";
  const { data: company, error, loading } = useCompany(needs ? panel.ticker : null);

  const body = (() => {
    if (panel.fn === "PREC") return <PrecScreen onRun={onRun} ticker={panel.ticker} />;
    if (panel.fn === "PG") return <PgScreen onRun={onRun} />;
    if (panel.fn === "AI") return <AiScreen ticker={panel.ticker} company={company} ai={ai} openPanels={openPanels} onRun={onRun} />;
    if (panel.fn === "EVT") return <EvtScreen ticker={panel.ticker} onRun={onRun} />;
    if (panel.fn === "INS") return <InsScreen ticker={panel.ticker} />;
    if (panel.fn === "XBRL") return <XbrlScreen ticker={panel.ticker} />;
    if (panel.fn === "TOOLS") return <ToolsPanel ticker={panel.ticker} onRun={onRun} />;
    if (panel.fn === "TOOL") return <ToolPanel ticker={panel.ticker} id={panel.arg ?? ""} onRun={onRun} />;
    if (loading) return <Loading ticker={panel.ticker} />;
    if (error || !company) return <ErrorState ticker={panel.ticker} error={error ?? "No data"} />;
    switch (panel.fn) {
      case "DES": return <DesScreen company={company} onRun={onRun} />;
      case "FA": return <FaScreen company={company} />;
      case "COMPS": return <CompsScreen company={company} onRun={onRun} ai={ai} />;
      case "FIL": return <FilScreen company={company} />;
      case "CAP": return <CapScreen company={company} onRun={onRun} />;
    }
  })();

  const title = panel.fn === "TOOL" ? (panel.arg ?? "tool") : FUNCTIONS[panel.fn].label;

  return (
    <section className="group flex h-full min-h-0 flex-col overflow-hidden panel glass">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-elevated/70 px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wider text-accent">{panel.fn}</span>
          {panel.fn !== "TOOLS" && <span className="num font-semibold text-fg">{panel.ticker}</span>}
          <span className="truncate text-muted">{title}</span>
          {company?.ltm.periodEnd && NEEDS_COMPANY.has(panel.fn) && <span className="num hidden text-[10px] text-faint xl:inline">LTM {company.ltm.periodEnd}</span>}
        </div>
        <div className="flex items-center gap-0.5 text-muted opacity-60 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onToggleMax} aria-label={maximized ? "Restore panel" : "Maximize panel"} title={maximized ? "Restore" : "Maximize"}
            className="grid h-6 w-6 place-items-center ctl hover:bg-raised hover:text-fg">{maximized ? "⤡" : "⤢"}</button>
          <button type="button" onClick={onClose} aria-label="Close panel" title="Close" className="grid h-6 w-6 place-items-center ctl hover:bg-raised hover:text-neg">×</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{body}</div>
    </section>
  );
}

function Loading({ ticker }: { ticker: string }) {
  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <div className="flex items-center gap-2 text-[11px] text-muted">
        <span className="h-2 w-2 animate-pulse rounded-full bg-accent" /> Loading {ticker} from SEC EDGAR and FMP…
      </div>
      {[1, 2, 3].map((i) => (
        <div key={i} className="grid grid-cols-6 gap-2">
          {[1, 2, 3, 4, 5, 6].map((j) => <div key={j} className="shimmer h-12 ctl" style={{ animationDelay: `${(i * 6 + j) * 40}ms` }} />)}
        </div>
      ))}
    </div>
  );
}

function ErrorState({ ticker, error }: { ticker: string; error: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1 p-4 text-center">
      <div className="text-[13px] text-neg">Could not load {ticker}</div>
      <div className="max-w-[420px] text-[11px] text-muted">{error}</div>
      <div className="mt-2 text-[10.5px] text-faint">Only SEC registrants with XBRL filings are supported (US-listed companies).</div>
    </div>
  );
}
