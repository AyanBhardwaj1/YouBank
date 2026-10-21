"use client";

/**
 * Algo trading: strategies (templates and the builder), each strategy's paper or live dashboard and
 * backtests, broker connections, the AI agent and the audit log. The kill switch stays at the top of every
 * tab. Tabs: strategies, brokers, agent, activity; ?strategy=ID opens one strategy.
 */
import { lazyPanel, useIdlePreload } from "@/components/ui/lazyPanel";
import { useCallback, useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { useSubNav, useViewInUrl } from "@/lib/subnav";
import { AgentChat } from "./AgentChat";
import { AlgoConsentProvider, useAlgoConsent } from "./AlgoConsent";
import { Brokers } from "./Brokers";
import { call, json, MODE_LABEL, MODE_TONE, SIGNAL_LABEL, usd, when, type Hub } from "./client";
import { StrategyDetail } from "./StrategyDetail";

// The builder (and the strategy schema it validates with, zod included) loads when a strategy is created or edited.
const StrategyEditor = lazyPanel(() => import("./StrategyEditor").then((m) => m.StrategyEditor), () => <div className="shimmer h-72 rounded-md" />);
import { useTabInView } from "@/components/ui/useTabInView";

type Tab = "strategies" | "brokers" | "agent" | "activity";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "strategies", label: "Strategies", icon: "LineChart" },
  { id: "brokers", label: "Brokers", icon: "Landmark" },
  { id: "agent", label: "Agent", icon: "Bot" },
  { id: "activity", label: "Audit log", icon: "ScrollText" },
];

export function AlgoHub(props: { initialTab?: string; initialStrategy?: number | null; connected?: string | null; reason?: string | null }) {
  return <AlgoConsentProvider><Inner {...props} /></AlgoConsentProvider>;
}

function Inner({ initialTab, initialStrategy, connected, reason }: { initialTab?: string; initialStrategy?: number | null; connected?: string | null; reason?: string | null }) {
  const ask = useAlgoConsent();
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.id === initialTab)?.id ?? "strategies");
  useIdlePreload([StrategyEditor]);
  const tabRow = useTabInView<HTMLElement>(tab);
  const [hub, setHub] = useState<Hub | null>(null);
  const [selected, setSelected] = useState<number | null>(initialStrategy ?? null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useSubNav("/app/algo", (v) => { if (TABS.some((t) => t.id === v)) { setTab(v as Tab); setSelected(null); } });
  useViewInUrl("/app/algo", "tab", tab, "strategies");
  const load = useCallback(() => fetchJson<Hub>("/api/algo/strategies").then(setHub).catch((e) => setError(errorMessage(e))), []);
  useEffect(() => { void load(); }, [load]);
  const toggleKill = async () => {
    if (!hub) return;
    const on = !hub.kill.user;
    if (on && !(await confirmDialog({ title: "Stop all trading?", body: "Every strategy stops placing orders and unsent batches are canceled. Orders already at your broker stay there; cancel them on each strategy or with your broker.", confirmLabel: "Stop everything", tone: "danger" }))) return;
    try { await call("/api/algo/kill", json("POST", { on }), ask); await load(); } catch (e) { setError(errorMessage(e)); }
  };
  return (
    // The page scrolls inside itself, as every workspace does: the frame around it never scrolls.
    <div className="h-full overflow-auto">
    <div className="mx-auto max-w-6xl p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="display text-[26px] leading-tight text-fg sm:text-[30px]">Algo trading</h1>
          <p className="mt-1 max-w-3xl text-[12.5px] text-muted">Build rule-based strategies, test them honestly, run them on paper for free, and with Pro trade them in your own account: each batch approved by you, or within strict limits on its own.</p>
        </div>
        {hub && (
          <button onClick={toggleKill} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] font-semibold ${hub.kill.user ? "bg-neg text-white" : "border border-neg/60 text-neg hover:bg-neg/10"}`} aria-pressed={hub.kill.user}>
            <Icon name="Square" className="h-3.5 w-3.5" />{hub.kill.user ? "Kill switch ON: turn off" : "Kill switch"}
          </button>
        )}
      </div>
      {hub?.kill.global && <p className="mb-3 rounded-md border border-neg/50 bg-neg/10 p-2.5 text-[12px] text-neg">Trading is paused for everyone by YouBank&apos;s administrators.{hub.kill.globalReason ? ` ${hub.kill.globalReason}` : ""}</p>}
      {hub && !hub.server.liveEnabled && <p className="mb-3 flex gap-2 rounded-md border border-line bg-elevated p-2.5 text-[11.5px] text-muted"><Icon name="Info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />Real trading is switched off on this server. Backtests and paper trading work; live modes wait until it is turned on.</p>}
      <nav ref={tabRow} className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" aria-label="Algo trading">
        {TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => { setTab(t.id); setSelected(null); setCreating(false); }} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] ${tab === t.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}><Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}{t.id === "agent" && <PremiumBadge feature="algo.agent" />}</button>
        ))}
      </nav>
      {error && <p className="mb-3 rounded-md border border-neg/40 bg-neg/10 p-2.5 text-[12px] text-neg">{error}</p>}
      {tab === "strategies" && (!hub ? <div className="shimmer h-40 rounded-md" /> : selected ? (
        <StrategyDetail id={selected} hub={hub} onBack={() => { setSelected(null); void load(); }} reloadHub={load} />
      ) : creating ? (
        <section className="panel p-3"><h2 className="mb-2 text-[15px] font-semibold text-fg">New strategy</h2><StrategyEditor templates={hub.templates} onSaved={(id) => { setCreating(false); setSelected(id); void load(); }} onCancel={() => setCreating(false)} /></section>
      ) : (
        <Strategies hub={hub} onOpen={setSelected} onNew={() => setCreating(true)} />
      ))}
      {tab === "brokers" && <Brokers connected={connected} reason={reason} />}
      {tab === "agent" && <AgentChat onChanged={load} />}
      {tab === "activity" && <Activity />}
      <p className="mt-4 text-[11px] text-muted">{hub?.notAdvice ?? ""}</p>
    </div>
    </div>
  );
}

function Strategies({ hub, onOpen, onNew }: { hub: Hub; onOpen: (id: number) => void; onNew: () => void }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-muted">{hub.strategies.length} of {hub.plan.cap} strategies on your plan{!hub.plan.live ? " · live trading with Pro" : ""}.</p>
        <button onClick={onNew} disabled={hub.strategies.length >= hub.plan.cap} className="ctl flex items-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50"><Icon name="Plus" className="h-3.5 w-3.5" />New strategy</button>
      </div>
      {!hub.strategies.length ? (
        <div className="panel p-6 text-center"><Icon name="LineChart" className="mx-auto h-6 w-6 text-accent" /><p className="mt-2 text-[13px] text-fg">No strategies yet.</p><p className="mt-1 text-[12px] text-muted">Start from a template (trend, momentum, mean reversion, pairs, DCA, a 13F copy or options income), backtest it, then let it run on paper.</p></div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {hub.strategies.map((s) => (
            <button key={s.id} onClick={() => onOpen(s.id)} className="panel group p-3 text-left transition hover:border-line-strong">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><div className="truncate text-[13.5px] font-semibold text-fg group-hover:text-accent">{s.name}</div><div className="truncate text-[11.5px] text-muted">{SIGNAL_LABEL[s.signal] ?? s.signal} · {s.universe.slice(0, 5).join(", ")}{s.universe.length > 5 ? "…" : ""}</div></div>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10.5px] ${MODE_TONE[s.mode] ?? ""}`}>{MODE_LABEL[s.mode] ?? s.mode}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
                <span>Capital {usd(s.capitalUsd)}</span>
                {s.status !== "active" && <span className="text-fg">Paused</span>}
                {s.kill && <span className="font-semibold text-neg">Kill switch on</span>}
                <span>Next {when(s.nextTickAt)}</span>
              </div>
              {s.lastDecision?.rationale && <p className="mt-2 line-clamp-2 text-[11.5px] text-muted">{s.lastDecision.rationale}</p>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type Entry = { id: number; at: string; actor: string; action: string; strategyId: number | null; batchId: number | null; orderId: number | null; payload: Record<string, unknown> };

function Activity() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => { fetchJson<{ entries: Entry[] }>("/api/algo/audit").then((r) => setRows(r.entries)).catch((e) => setError(errorMessage(e))); }, []);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12px] text-muted">Every consent, connection, strategy change, decision, order, kill switch and agent action, append-only.</p><a href="/api/algo/audit?format=csv" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-fg hover:bg-elevated"><Icon name="Download" className="h-3.5 w-3.5" />Download CSV</a></div>
      {error && <p className="text-[12px] text-neg">{error}</p>}
      {!rows ? <div className="shimmer h-40 rounded-md" /> : !rows.length ? <p className="text-[12px] text-muted">Nothing yet.</p> : (
        <ul className="panel divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="px-3 py-2 text-[12px]">
              <button onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full flex-wrap items-baseline justify-between gap-2 text-left">
                <span className="font-semibold text-fg">{r.action}</span>
                <span className="text-muted">{when(r.at)} · {r.actor}{r.strategyId ? ` · strategy ${r.strategyId}` : ""}{r.batchId ? ` · batch ${r.batchId}` : ""}</span>
              </button>
              {open === r.id && <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-elevated p-2 text-[11px] text-muted">{JSON.stringify(r.payload, null, 2)}</pre>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
