"use client";

import { useEffect, useMemo, useState } from "react";
import { DEMO, demoBy, demoMedians, demoSet, SOFTWARE_SET } from "@/lib/demo";
import { Sparkline } from "@/components/charts/Sparkline";
import { Columns } from "@/components/charts/Columns";
import { HBar } from "@/components/charts/HBar";
import { Waterfall } from "@/components/charts/Waterfall";
import { Typewriter } from "@/components/motion/Reveal";

const money = (v: number | null) => (v === null ? "n/a" : Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${v.toFixed(0)}M`);
const pct = (v: number | null) => (v === null ? "NM" : `${(v * 100).toFixed(0)}%`);
const xx = (v: number | null) => (v === null ? "NM" : `${v.toFixed(1)}x`);

type Step = { cmd: string; ticker: string; fn: "DES" | "FA" | "COMPS" | "CAP" | "EVT"; caption: string };
const STEPS: Step[] = [
  { cmd: "SNOW DES", ticker: "SNOW", fn: "DES", caption: "A company page assembled from XBRL facts, not a scraped summary" },
  { cmd: "SNOW COMPS", ticker: "SNOW", fn: "COMPS", caption: "Peers proposed by the assistant, medians computed live" },
  { cmd: "CCL CAP", ticker: "CCL", fn: "CAP", caption: "Debt, leverage, coverage and the maturity wall from the debt footnote" },
  { cmd: "DDOG FA", ticker: "DDOG", fn: "FA", caption: "LTM income statement and cash flow with the concept each number came from" },
];

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "pos" | "neg" }) {
  return (
    <div className="ctl border border-line bg-elevated/60 px-2.5 py-2">
      <div className="text-[9.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-0.5 text-[15px] font-semibold leading-none">{value}</div>
      {sub && <div className={`mt-1 text-[10px] ${tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-muted"}`}>{sub}</div>}
    </div>
  );
}

function ScreenBody({ step }: { step: Step }) {
  const c = demoBy(step.ticker);
  if (!c) return null;
  const peers = demoSet(SOFTWARE_SET);
  const m = demoMedians(peers.filter((p) => p.ticker !== c.ticker));
  const netDebt = (c.debt ?? 0) - (c.cash ?? 0);
  if (step.fn === "DES") {
    return (
      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2"><span className="num text-[20px] font-semibold text-accent">{c.ticker}</span><span className="text-[13px]">{c.name}</span></div>
            <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted">
              <span className="rounded border border-line bg-elevated px-1.5 py-0.5">Prepackaged software</span>
              <span className="rounded border border-line bg-elevated px-1.5 py-0.5">FYE {c.fye || "Jan 31"}</span>
              <span className="rounded border border-line bg-elevated px-1.5 py-0.5">LTM {c.ltmEnd}</span>
            </div>
          </div>
          <div className="text-right">
            <div className="num text-[18px] font-semibold leading-none">{c.price?.toFixed(2)}</div>
            <div className={`num mt-1 text-[10.5px] ${(c.changePct ?? 0) >= 0 ? "text-pos" : "text-neg"}`}>{(c.changePct ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(c.changePct ?? 0).toFixed(2)}%</div>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Tile label="Market cap" value={money(c.marketCap)} />
          <Tile label="Enterprise value" value={money(c.ev)} sub={netDebt < 0 ? `net cash ${money(-netDebt)}` : `net debt ${money(netDebt)}`} />
          <Tile label="LTM revenue" value={money(c.revenue)} sub={`${pct(c.growth)} y/y`} tone="pos" />
        </div>
        <Columns title="Quarterly revenue, USD millions (SEC XBRL)" height={120} data={c.quarters.map((q) => ({ label: q.label.replace("FY", "'"), value: q.revenue }))} format={(v) => money(v)} />
      </div>
    );
  }
  if (step.fn === "COMPS") {
    return (
      <div className="p-3">
        <table className="w-full text-[11px]">
          <thead className="text-[9.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">Ticker</th><th className="py-1 pr-2 text-right font-normal">EV/Rev</th><th className="py-1 pr-2 text-right font-normal">Growth</th><th className="py-1 pr-2 text-right font-normal">GM</th><th className="py-1 pr-1 text-right font-normal">R40</th></tr></thead>
          <tbody className="stagger">
            {peers.slice(0, 6).map((p) => (
              <tr key={p.ticker} className={`border-b border-line/50 ${p.ticker === c.ticker ? "bg-accent-soft font-semibold" : ""}`}>
                <td className={`num py-1 ${p.ticker === c.ticker ? "text-accent" : ""}`}>{p.ticker}</td>
                <td className="num py-1 pr-2 text-right">{xx(p.evRevLtm)}</td>
                <td className="num py-1 pr-2 text-right">{pct(p.growth)}</td>
                <td className="num py-1 pr-2 text-right">{pct(p.gm)}</td>
                <td className="num py-1 pr-1 text-right">{p.r40?.toFixed(0) ?? "NM"}</td>
              </tr>
            ))}
            <tr className="bg-elevated/70 text-[10.5px] font-semibold"><td className="py-1 text-muted">Median</td><td className="num py-1 pr-2 text-right">{xx(m.evRev)}</td><td className="num py-1 pr-2 text-right">{pct(m.growth)}</td><td className="num py-1 pr-2 text-right">{pct(m.gm)}</td><td className="num py-1 pr-1 text-right">{m.r40?.toFixed(0) ?? "NM"}</td></tr>
          </tbody>
        </table>
        <div className="mt-2"><HBar title="EV / LTM revenue" maxBars={7} format={(v) => xx(v)} referenceLine={m.evRev ? { value: m.evRev, label: `median ${xx(m.evRev)}` } : undefined}
          data={peers.slice(0, 7).map((p) => ({ key: p.ticker, label: p.ticker, value: p.evRevLtm, emphasis: p.ticker === c.ticker }))} /></div>
      </div>
    );
  }
  if (step.fn === "CAP") {
    const ebitda = 5200, interest = 1620;
    return (
      <div className="flex flex-col gap-2.5 p-3">
        <div className="grid grid-cols-4 gap-2">
          <Tile label="Total debt" value={money(c.debt)} />
          <Tile label="Cash" value={money(c.cash)} sub={`net debt ${money(netDebt)}`} />
          <Tile label="Debt / EBITDA" value={xx((c.debt ?? 0) / ebitda)} sub="reported LTM" tone="neg" />
          <Tile label="EBITDA / interest" value={xx(ebitda / interest)} sub="coverage" tone="pos" />
        </div>
        <Waterfall title="Net debt bridge, USD millions" format={(v) => money(v)} height={170}
          steps={[{ label: "Total debt", value: c.debt ?? 0, total: true }, { label: "Less cash", value: -(c.cash ?? 0) }, { label: "Net debt", value: netDebt, total: true }]} />
        <div className="text-[10px] text-muted">Maturity ladder, covenant headroom and tranche detail come from the debt footnote and credit-agreement exhibits.</div>
      </div>
    );
  }
  const rows: [string, string, string][] = [
    ["Revenue", money(c.revenue), `${pct(c.growth)} y/y`],
    ["Gross profit", money((c.revenue ?? 0) * (c.gm ?? 0)), `${pct(c.gm)} margin`],
    ["Free cash flow", money((c.revenue ?? 0) * (c.fcfm ?? 0)), `${pct(c.fcfm)} margin`],
    ["Rule of 40", c.r40?.toFixed(0) ?? "NM", c.r40 && c.r40 >= 40 ? "above 40" : "below 40"],
  ];
  return (
    <div className="flex flex-col gap-2.5 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="LTM revenue" value={money(c.revenue)} sub={`${pct(c.growth)} y/y`} tone="pos" />
        <Tile label="FCF margin" value={pct(c.fcfm)} sub={money((c.revenue ?? 0) * (c.fcfm ?? 0))} tone="pos" />
      </div>
      <table className="w-full text-[11px]">
        <tbody className="stagger">
          {rows.map(([k, v, s]) => (
            <tr key={k} className="border-b border-line/60"><td className="py-1 text-muted">{k}</td><td className="num py-1 text-right">{v}</td><td className="py-1 pl-3 text-right text-[10px] text-muted">{s}</td></tr>
          ))}
        </tbody>
      </table>
      <Columns title="Quarterly revenue, USD millions" height={110} data={c.quarters.map((q) => ({ label: q.label.replace("FY", "'"), value: q.revenue }))} format={(v) => money(v)} />
    </div>
  );
}

/** Auto-playing terminal: commands type themselves, panels swap, the watchlist and tape tick. */
export function DemoTerminal() {
  const [step, setStep] = useState(0);
  const [ready, setReady] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const typing = ready !== step;
  const s = STEPS[step];
  const watch = useMemo(() => demoSet(SOFTWARE_SET).slice(0, 6), []);

  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 2000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const t = setTimeout(() => setReady(step), s.cmd.length * 70 + 250);
    const n = setTimeout(() => setStep((i) => (i + 1) % STEPS.length), 6200);
    return () => { clearTimeout(t); clearTimeout(n); };
  }, [step, s.cmd.length]);

  const drift = (seed: number) => ((Math.sin((tick + seed) * 7.13) * 1000) % 1) * 0.5;

  return (
    <div className="float overflow-hidden panel">
      <div className="flex items-center gap-2 border-b border-line bg-elevated/60 px-3 py-1.5">
        <span className="flex gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-neg/70" /><span className="h-2.5 w-2.5 rounded-full bg-accent/70" /><span className="h-2.5 w-2.5 rounded-full bg-pos/70" /></span>
        <span className="num ml-2 text-[10.5px] text-muted">youbank.app/app/terminal</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted"><span className="pulse-ring h-1.5 w-1.5 rounded-full bg-pos" /> live</span>
      </div>
      <div className="grid grid-cols-[132px_1fr] sm:grid-cols-[168px_1fr]">
        <aside className="border-r border-line bg-panel/60">
          <div className="px-2.5 pb-1 pt-2 text-[9.5px] uppercase tracking-wider text-muted">Watchlist</div>
          <ul>
            {watch.map((w) => {
              const chg = (w.changePct ?? 0) + drift(w.ticker.charCodeAt(1));
              return (
                <li key={w.ticker} className={`flex items-center gap-1.5 px-2.5 py-1 ${w.ticker === s.ticker ? "bg-elevated" : ""}`}>
                  <span className={`h-5 w-0.5 rounded ${w.ticker === s.ticker ? "bg-accent" : "bg-transparent"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between"><span className={`num text-[11px] font-semibold ${w.ticker === s.ticker ? "text-accent" : ""}`}>{w.ticker}</span><span className="num text-[10.5px]">{w.price?.toFixed(2)}</span></span>
                    <span className="flex items-baseline justify-between"><span className="hidden truncate text-[9.5px] text-muted sm:inline">{w.name.split(" ")[0]}</span><span className={`num text-[9.5px] ${chg >= 0 ? "text-pos" : "text-neg"}`}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span></span>
                  </span>
                  <span className="hidden sm:inline"><Sparkline values={w.quarters.map((q) => q.revenue)} width={26} height={14} stroke="var(--chart-1)" /></span>
                </li>
              );
            })}
          </ul>
        </aside>
        <div className="min-w-0">
          <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.5">
            <span className="text-accent">›</span>
            <span className="num text-[11.5px] uppercase tracking-wide">{typing ? <Typewriter text={s.cmd} speed={70} /> : <span>{s.cmd}</span>}</span>
            {!typing && <span className="num ml-auto ctl bg-accent-soft px-1.5 py-0.5 text-[9.5px] text-accent">{s.fn}</span>}
          </div>
          <div key={`${step}-${s.fn}`} className="rise min-h-[300px]">
            {!typing ? <ScreenBody step={s} /> : <div className="flex flex-col gap-2 p-3">{[1, 2, 3].map((i) => <div key={i} className="shimmer h-14 ctl" style={{ animationDelay: `${i * 90}ms` }} />)}</div>}
          </div>
          <div className="border-t border-line px-2.5 py-1 text-[10px] text-muted">{s.caption}</div>
        </div>
      </div>
      <div className="relative h-6 overflow-hidden border-t border-line bg-panel">
        <div className="tape-track flex h-full w-max items-center whitespace-nowrap">
          {[...DEMO.comps, ...DEMO.comps].map((i, k) => (
            <span key={k} className="num flex items-center gap-1.5 px-3 text-[10px]">
              <span className="font-semibold">{i.ticker}</span><span className="text-muted">{i.price?.toFixed(2)}</span>
              <span className={(i.changePct ?? 0) >= 0 ? "text-pos" : "text-neg"}>{(i.changePct ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(i.changePct ?? 0).toFixed(2)}%</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
