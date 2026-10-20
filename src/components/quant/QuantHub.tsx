"use client";

/**
 * The Quant hub (/app/quant): the quant desk's methods on the person's own portfolio and ideas, with intervals,
 * sources and disclosures. Tabs: Overview, Integrity (BTX), Factors (FACT), Risk, Sizing (KELLY), Costs (TCA),
 * Insiders (INSC), Drills (DRILL) and Signals. On phones the tabs scroll and every panel stacks.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import type { QuantSignal } from "@/lib/quant/contracts";
import { DISCLOSURES } from "@/lib/quant/words";
import { useSubNav } from "@/lib/subnav";
import { CostsTab } from "./CostsTab";
import { DrillsTab } from "./DrillsTab";
import { InsidersTab } from "./InsidersTab";
import { IntegrityTab } from "./IntegrityTab";
import { FactorsTab, RiskTab } from "./PortfolioTabs";
import { SizingTab } from "./SizingTab";
import { Button, Card, Disclosures, ErrorNote, Field, inputCls, num, pct, QuantConsent, Stat, useQuantCall, useRun } from "./ui";
import { useTabInView } from "@/components/ui/useTabInView";

export type QuantTab = "overview" | "integrity" | "factors" | "risk" | "sizing" | "costs" | "insiders" | "drills" | "signals";
export const QUANT_TABS: { id: QuantTab; label: string; icon: string; code?: string }[] = [
  { id: "overview", label: "Overview", icon: "Gauge" },
  { id: "integrity", label: "Backtest check", icon: "Shield", code: "BTX" },
  { id: "factors", label: "Factors", icon: "Layers", code: "FACT" },
  { id: "risk", label: "Risk", icon: "AlertTriangle", code: "PORT" },
  { id: "sizing", label: "Sizing", icon: "Scale", code: "KELLY" },
  { id: "costs", label: "Costs", icon: "Receipt", code: "TCA" },
  { id: "insiders", label: "Insiders", icon: "Users", code: "INSC" },
  { id: "drills", label: "Drills", icon: "GraduationCap", code: "DRILL" },
  { id: "signals", label: "Signals", icon: "Radar" },
];

export function QuantHub({ initialTab }: { initialTab?: string }) {
  return <QuantConsent><HubInner initialTab={initialTab} /></QuantConsent>;
}

function HubInner({ initialTab }: { initialTab?: string }) {
  const [tab, setTab] = useState<QuantTab>(QUANT_TABS.find((t) => t.id === initialTab)?.id ?? "overview");
  const tabRow = useTabInView<HTMLElement>(tab);
  useSubNav("/app/quant", (v) => { if (QUANT_TABS.some((t) => t.id === v)) setTab(v as QuantTab); });
  return (
    // The page scrolls inside itself, as every workspace does: the frame around it never scrolls.
    <div className="h-full overflow-auto">
    <div className="mx-auto max-w-6xl p-3 sm:p-4">
      <div className="mb-3">
        <h1 className="display text-[26px] leading-tight text-fg sm:text-[30px]">Quant</h1>
        <p className="mt-1 max-w-3xl text-[12.5px] text-muted">The methods a quant desk uses, on your own portfolio and ideas: what drives returns, where the risk is, whether a backtest is luck, how much to size, what trading costs and what insiders are doing. Every number comes with its interval and its source.</p>
      </div>
      <nav ref={tabRow} className="-mx-3 mb-3 flex gap-1 overflow-x-auto px-3 sm:mx-0 sm:px-0" aria-label="Quant">
        {QUANT_TABS.map((t) => (
          <button key={t.id} aria-current={tab === t.id ? "page" : undefined} onClick={() => setTab(t.id)} className={`ctl flex shrink-0 items-center gap-1.5 px-3 py-2 text-[12.5px] ${tab === t.id ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}><Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}</button>
        ))}
      </nav>
      {tab === "overview" && <Overview go={setTab} />}
      {tab === "integrity" && <IntegrityTab />}
      {tab === "factors" && <FactorsTab />}
      {tab === "risk" && <RiskTab />}
      {tab === "sizing" && <SizingTab />}
      {tab === "costs" && <CostsTab />}
      {tab === "insiders" && <InsidersTab />}
      {tab === "drills" && <DrillsTab />}
      {tab === "signals" && <SignalsTab />}
      <p className="mt-4 text-[11px] text-muted">{DISCLOSURES.not_advice}</p>
    </div>
    </div>
  );
}

type Status = {
  consent: boolean; universe: { members: number; withPrices: number; delistedSinceFirstBuild: number; firstBuild: string | null; note: string } | null;
  factors: { youbank: { from: string | null; to: string | null; days: number }; version: string } | null;
  producers: { producer: string; live: number; latest: string | null }[];
  notOffered: { title: string; why: string; lesson: string; source: { label: string; url: string } }[];
  plan: Record<string, boolean>; infra: { store: boolean; jobs: boolean };
};

const BLURBS: { tab: QuantTab; title: string; text: string }[] = [
  { tab: "integrity", title: "Is that backtest luck?", text: "Grade any backtest by the variants tried, its length, its costs and look-ahead." },
  { tab: "factors", title: "What drives your returns", text: "Market, size, value, momentum, quality and low-volatility exposures, with intervals." },
  { tab: "risk", title: "Where the risk is", text: "Risk by holding and factor, value at risk, 2008 and 2020 replays, shocks and days to exit." },
  { tab: "sizing", title: "How much to size", text: "Kelly ranges on your own numbers, drawdown odds and drawdown rules." },
  { tab: "costs", title: "What trading costs you", text: "Spreads and impact before a trade, and your own fills measured after." },
  { tab: "insiders", title: "Insiders and activists", text: "Cluster purchases and 13D stakes, with the base rate of what followed." },
  { tab: "drills", title: "Desk drills", text: "Calibration, expected value and the Kelly coin. Virtual, no prizes." },
];

function Overview({ go }: { go: (t: QuantTab) => void }) {
  const call = useQuantCall();
  const s = useRun<Status>();
  useEffect(() => { void s.run(() => call("/api/quant/status")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  const d = s.data;
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {BLURBS.map((b) => (
          <button key={b.tab} onClick={() => go(b.tab)} className="panel group p-3 text-left transition hover:border-line-strong">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-fg group-hover:text-accent"><Icon name={QUANT_TABS.find((t) => t.id === b.tab)!.icon} className="h-3.5 w-3.5" />{b.title}</div>
            <p className="mt-1 text-[11.5px] text-muted">{b.text}</p>
          </button>
        ))}
      </div>
      {d && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="The data underneath">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Universe" value={num(d.universe?.members ?? 0, 0)} hint={`US listings by market value; ${num(d.universe?.withPrices ?? 0, 0)} with stored prices`} />
              <Stat label="YouBank factors" value={d.factors?.youbank.days ? `${num(d.factors.youbank.days, 0)} days` : "Building"} hint={d.factors?.youbank.from ? `${d.factors.youbank.from} to ${d.factors.youbank.to}` : "ETF proxies until then"} />
            </div>
            {d.universe && <p className="mt-2 flex gap-1.5 text-[11.5px] text-muted"><Icon name="AlertTriangle" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{d.universe.note}</p>}
            {!d.infra.store && <p className="mt-1 text-[11.5px] text-muted">Prices are read live (the bar store is not configured), so some screens are slower.</p>}
          </Card>
          <Card title="Signal producers">
            {d.producers.length ? <ul className="space-y-1 text-[12px]">{d.producers.map((p) => <li key={p.producer} className="flex justify-between gap-2"><span className="font-mono text-fg">{p.producer}</span><span className="text-muted">{p.live} live{p.latest ? ` · ${new Date(p.latest).toISOString().slice(0, 10)}` : ""}</span></li>)}</ul> : <p className="text-[12px] text-muted">No signals published yet. A producer publishes once its base rate rests on at least 30 past events.</p>}
          </Card>
        </div>
      )}
      {d && (
        <Card title="What Quant does not offer, and why">
          <div className="grid gap-2 md:grid-cols-2">
            {d.notOffered.map((n) => <div key={n.title} className="rounded-md border border-line p-2.5 text-[12px]"><b className="text-fg">{n.title}.</b> <span className="text-muted">{n.why} {n.lesson}</span> <a href={n.source.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{n.source.label}</a></div>)}
          </div>
        </Card>
      )}
      <ErrorNote error={s.error} />
    </div>
  );
}

export function SignalsTab({ initialSymbols }: { initialSymbols?: string }) {
  const [symbols, setSymbols] = useState(initialSymbols ?? "");
  const call = useQuantCall();
  const r = useRun<{ at: string; count: number; signals: QuantSignal[] }>();
  const load = () => r.run(() => call(`/api/quant/signals${symbols.trim() ? `?symbols=${encodeURIComponent(symbols.trim())}` : ""}`));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">Signals are statements about the past with a time stamp: when every input was public, how long the statement holds, the base rate behind it and how well its kind has been calibrated. The algo engine reads the same signals, as of the same times.</p>
      <form onSubmit={(e) => { e.preventDefault(); void load(); }} className="flex max-w-md items-end gap-2">
        <Field label="Tickers (optional)"><input value={symbols} onChange={(e) => setSymbols(e.target.value.toUpperCase())} placeholder="AAPL, MSFT" className={inputCls} /></Field>
        <Button type="submit" busy={r.busy}>Show</Button>
      </form>
      <ErrorNote error={r.error} />
      {r.data && (r.data.signals.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {r.data.signals.slice(0, 60).map((s) => (
            <Card key={s.id} title={<span>{s.instrument.symbol} <span className="font-normal text-muted">· {s.producer.replace(/^quant\./, "").replace(/_/g, " ")}</span></span>} right={<span className="text-[11px] text-muted">until {s.validUntil.slice(0, 10)}</span>}>
              <p className="text-[12.5px] text-fg">{s.explain}</p>
              {s.event && <p className="mt-1 text-[11.5px] text-muted">Base rate: {pct(s.event.baseRate.car, 1, true)} over {s.event.baseRate.window} (n {s.event.baseRate.n}); beat the market {pct(s.event.baseRate.hitRate, 0)} vs {pct(s.event.baseRate.unconditionalHitRate, 0)}.</p>}
              {s.probability && <p className="mt-1 text-[11.5px] text-muted">{pct(s.probability.p, 0)} (range {pct(s.probability.low, 0)} to {pct(s.probability.high, 0)}; base rate {pct(s.probability.baseRate, 0)}).</p>}
              <p className="mt-1 text-[11px] text-muted">Public from {s.asOf.slice(0, 16).replace("T", " ")} UTC{s.reconstructed ? " · reconstructed" : ""} · {s.evidence.slice(0, 2).map((e, i) => <a key={i} href={e.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{i ? ", " : ""}{e.label}</a>)}</p>
            </Card>
          ))}
        </div>
      ) : <Card><p className="text-[12px] text-muted">No live signals{symbols.trim() ? " for those tickers" : ""}.</p></Card>)}
      <Disclosures items={[DISCLOSURES.base_rate]} />
    </div>
  );
}
