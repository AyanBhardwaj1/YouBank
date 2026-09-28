"use client";

import dynamic from "next/dynamic";
import type { AiStatus, OpenPanel } from "./Terminal";
import { FUNCTIONS, needsTicker, type Command } from "@/lib/functions";
import { useCompany } from "@/lib/client/companies";
import { DesScreen } from "./screens/DesScreen";
import { FaScreen } from "./screens/FaScreen";

/*
 * Every screen but the two most common loads on demand, so the terminal's first paint carries only
 * the frame. Screens from one file share a chunk (opening GP also brings BETA and RISK).
 */
function ScreenLoading() {
  return (
    <div className="flex flex-col gap-3 p-3" aria-busy="true">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-14 ctl" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
      <div className="shimmer h-40 ctl" />
    </div>
  );
}
const CompsScreen = dynamic(() => import("./screens/CompsScreen").then((m) => m.CompsScreen), { loading: ScreenLoading });
const PrecScreen = dynamic(() => import("./screens/PrecScreen").then((m) => m.PrecScreen), { loading: ScreenLoading });
const FilScreen = dynamic(() => import("./screens/FilScreen").then((m) => m.FilScreen), { loading: ScreenLoading });
const AiScreen = dynamic(() => import("./screens/AiScreen").then((m) => m.AiScreen), { loading: ScreenLoading });
const PgScreen = dynamic(() => import("./screens/PgScreen").then((m) => m.PgScreen), { loading: ScreenLoading });
const CapScreen = dynamic(() => import("./screens/CapScreen").then((m) => m.CapScreen), { loading: ScreenLoading });
const EvtScreen = dynamic(() => import("./screens/EvtScreen").then((m) => m.EvtScreen), { loading: ScreenLoading });
const InsScreen = dynamic(() => import("./screens/InsScreen").then((m) => m.InsScreen), { loading: ScreenLoading });
const XbrlScreen = dynamic(() => import("./screens/XbrlScreen").then((m) => m.XbrlScreen), { loading: ScreenLoading });
const ToolsPanel = dynamic(() => import("./screens/ToolPanels").then((m) => m.ToolsPanel), { loading: ScreenLoading });
const ToolPanel = dynamic(() => import("./screens/ToolPanels").then((m) => m.ToolPanel), { loading: ScreenLoading });
const GpScreen = dynamic(() => import("./screens/PriceScreens").then((m) => m.GpScreen), { loading: ScreenLoading });
const HpScreen = dynamic(() => import("./screens/PriceScreens").then((m) => m.HpScreen), { loading: ScreenLoading });
const BetaScreen = dynamic(() => import("./screens/PriceScreens").then((m) => m.BetaScreen), { loading: ScreenLoading });
const RiskScreen = dynamic(() => import("./screens/PriceScreens").then((m) => m.RiskScreen), { loading: ScreenLoading });
const IratScreen = dynamic(() => import("./screens/CreditScreens").then((m) => m.IratScreen), { loading: ScreenLoading });
const DdisScreen = dynamic(() => import("./screens/CreditScreens").then((m) => m.DdisScreen), { loading: ScreenLoading });
const WaccScreen = dynamic(() => import("./screens/CreditScreens").then((m) => m.WaccScreen), { loading: ScreenLoading });
const QualScreen = dynamic(() => import("./screens/FundamentalScreens").then((m) => m.QualScreen), { loading: ScreenLoading });
const FcstScreen = dynamic(() => import("./screens/FundamentalScreens").then((m) => m.FcstScreen), { loading: ScreenLoading });
const EeScreen = dynamic(() => import("./screens/StreetScreens").then((m) => m.EeScreen), { loading: ScreenLoading });
const AnrScreen = dynamic(() => import("./screens/StreetScreens").then((m) => m.AnrScreen), { loading: ScreenLoading });
const DvdScreen = dynamic(() => import("./screens/StreetScreens").then((m) => m.DvdScreen), { loading: ScreenLoading });
const WeiScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.WeiScreen), { loading: ScreenLoading });
const FxcScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.FxcScreen), { loading: ScreenLoading });
const CmdtyScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.CmdtyScreen), { loading: ScreenLoading });
const MostScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.MostScreen), { loading: ScreenLoading });
const SectScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.SectScreen), { loading: ScreenLoading });
const MaScreen = dynamic(() => import("./screens/MarketScreens").then((m) => m.MaScreen), { loading: ScreenLoading });
const GcScreen = dynamic(() => import("./screens/MacroScreens").then((m) => m.GcScreen), { loading: ScreenLoading });
const EcoScreen = dynamic(() => import("./screens/MacroScreens").then((m) => m.EcoScreen), { loading: ScreenLoading });
const EqsScreen = dynamic(() => import("./screens/WorkspaceScreens").then((m) => m.EqsScreen), { loading: ScreenLoading });
const PortScreen = dynamic(() => import("./screens/WorkspaceScreens").then((m) => m.PortScreen), { loading: ScreenLoading });
const LearnScreen = dynamic(() => import("./screens/WorkspaceScreens").then((m) => m.LearnScreen), { loading: ScreenLoading });

type Props = {
  panel: OpenPanel;
  maximized: boolean;
  onClose: () => void;
  onToggleMax: () => void;
  onRun: (command: Command) => void;
  ai: AiStatus | null;
  openPanels: OpenPanel[];
  activeTicker: string;
};

const NEEDS_COMPANY = new Set(["DES", "FA", "COMPS", "FIL", "CAP"]);

export function Panel({ panel, maximized, onClose, onToggleMax, onRun, ai, openPanels, activeTicker }: Props) {
  const needs = NEEDS_COMPANY.has(panel.fn) || panel.fn === "AI";
  const { data: company, error, loading } = useCompany(needs && panel.ticker ? panel.ticker : null);
  const t = panel.ticker;

  const body = (() => {
    switch (panel.fn) {
      case "PREC": return <PrecScreen onRun={onRun} ticker={t} />;
      case "PG": return <PgScreen onRun={onRun} />;
      case "AI": return <AiScreen ticker={t} company={company} ai={ai} openPanels={openPanels} onRun={onRun} question={panel.arg} />;
      case "EVT": return <EvtScreen ticker={t} onRun={onRun} />;
      case "INS": return <InsScreen ticker={t} />;
      case "XBRL": return <XbrlScreen ticker={t} />;
      case "TOOLS": return <ToolsPanel ticker={t} onRun={onRun} />;
      case "TOOL": return <ToolPanel ticker={t} id={panel.arg ?? ""} onRun={onRun} />;
      case "GP": return <GpScreen ticker={t} onRun={onRun} />;
      case "HP": return <HpScreen ticker={t} onRun={onRun} />;
      case "BETA": return <BetaScreen ticker={t} onRun={onRun} />;
      case "RISK": return <RiskScreen ticker={t} onRun={onRun} />;
      case "IRAT": return <IratScreen ticker={t} onRun={onRun} />;
      case "DDIS": return <DdisScreen ticker={t} onRun={onRun} />;
      case "WACC": return <WaccScreen ticker={t} onRun={onRun} />;
      case "QUAL": return <QualScreen ticker={t} onRun={onRun} />;
      case "FCST": return <FcstScreen ticker={t} onRun={onRun} />;
      case "EE": return <EeScreen ticker={t} onRun={onRun} />;
      case "ANR": return <AnrScreen ticker={t} onRun={onRun} />;
      case "DVD": return <DvdScreen ticker={t} onRun={onRun} />;
      case "WEI": return <WeiScreen onRun={onRun} />;
      case "FXC": return <FxcScreen onRun={onRun} />;
      case "CMDTY": return <CmdtyScreen onRun={onRun} />;
      case "MOST": return <MostScreen onRun={onRun} />;
      case "SECT": return <SectScreen onRun={onRun} />;
      case "MA": return <MaScreen onRun={onRun} />;
      case "GC": return <GcScreen onRun={onRun} />;
      case "ECO": return <EcoScreen onRun={onRun} />;
      case "EQS": return <EqsScreen onRun={onRun} arg={panel.arg} activeTicker={activeTicker} />;
      case "PORT": return <PortScreen onRun={onRun} arg={panel.arg} activeTicker={activeTicker} />;
      case "LEARN": return <LearnScreen onRun={onRun} activeTicker={activeTicker} />;
    }
    if (loading) return <Loading ticker={t} />;
    if (error || !company) return <ErrorState ticker={t} error={error ?? "No data"} />;
    switch (panel.fn) {
      case "DES": return <DesScreen company={company} onRun={onRun} />;
      case "FA": return <FaScreen company={company} />;
      case "COMPS": return <CompsScreen company={company} onRun={onRun} ai={ai} />;
      case "FIL": return <FilScreen company={company} />;
      case "CAP": return <CapScreen company={company} onRun={onRun} />;
    }
  })();

  const title = panel.fn === "TOOL" ? (panel.arg ?? "tool") : (panel.fn === "EQS" || panel.fn === "PORT") && panel.arg ? `${FUNCTIONS[panel.fn].label}: ${panel.arg}` : FUNCTIONS[panel.fn].label;

  return (
    <section className="group flex h-full min-h-0 flex-col overflow-hidden panel glass">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-line bg-elevated/70 px-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wider text-accent">{panel.fn}</span>
          {needsTicker(panel.fn) && panel.fn !== "TOOLS" && t && <span className="num font-semibold text-fg">{t}</span>}
          <span className="truncate text-muted" title={title}>{title}</span>
          {company?.ltm.periodEnd && NEEDS_COMPANY.has(panel.fn) && <span className="num hidden text-[10px] text-faint xl:inline">LTM {company.ltm.periodEnd}</span>}
        </div>
        <div className="flex items-center gap-0.5 text-muted opacity-60 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onToggleMax} aria-label={maximized ? "Restore panel" : "Maximize panel"} title={maximized ? "Restore" : "Maximize"}
            className="grid h-6 w-6 place-items-center ctl hover:bg-raised hover:text-fg">{maximized ? "⤡" : "⤢"}</button>
          <button type="button" onClick={onClose} aria-label="Close panel" title="Close" className="grid h-6 w-6 place-items-center ctl hover:bg-raised hover:text-neg">×</button>
        </div>
      </header>
      <div className="@container min-h-0 flex-1 overflow-auto">{body}</div>
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
