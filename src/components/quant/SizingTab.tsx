"use client";

/**
 * Q4 KELLY: the Kelly calculator on the person's own numbers (a bet, or an asset's Sharpe range), the drawdown
 * governor simulated on a symbol's history, and (Pro) a RiskBudget saved for the algo engine, which may adopt or
 * tighten it, never loosen it. Nothing here reads an account balance.
 */
import { useEffect, useState } from "react";
import { LineChart } from "@/components/charts/LineChart";
import { PremiumBadge } from "@/components/billing/Premium";
import type { RiskBudget } from "@/lib/quant/contracts";
import type { GovernorRun, KellyResult } from "@/lib/quant/sizing/governor";
import { Button, Card, Disclosures, ErrorNote, Field, inputCls, json, num, pct, Stat, Table, useQuantCall, useRun } from "./ui";

export type KellyArgs = { kind: "bet"; pLow: string; pHigh: string; odds: string } | { kind: "asset"; sharpeLow: string; sharpeHigh: string; vol: string };

export function SizingTab({ initial }: { initial?: KellyArgs }) {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">How large a bet or position the numbers you enter support, how often each size halves the account, and what drawdown rules would have done. For the inputs entered only: YouBank does not know your finances.</p>
      <KellyCalc initial={initial} />
      <Governor />
      <Budget />
    </div>
  );
}

function KellyCalc({ initial }: { initial?: KellyArgs }) {
  const [f, setF] = useState<KellyArgs>(initial ?? { kind: "bet", pLow: "0.53", pHigh: "0.58", odds: "1" });
  const call = useQuantCall();
  const r = useRun<{ kelly: KellyResult }>();
  const go = () => r.run(() => call("/api/quant/sizing", json("POST", { mode: "kelly", ...f })));
  useEffect(() => { if (initial) void go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const k = r.data?.kelly;
  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <Card title="Kelly calculator">
        <div className="mb-2 flex gap-1">{(["bet", "asset"] as const).map((kind) => <button key={kind} onClick={() => setF(kind === "bet" ? { kind, pLow: "0.53", pHigh: "0.58", odds: "1" } : { kind, sharpeLow: "0.3", sharpeHigh: "0.8", vol: "0.18" })} className={`ctl px-2.5 py-1 text-[12px] ${f.kind === kind ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:bg-elevated"}`}>{kind === "bet" ? "A bet" : "An asset"}</button>)}</div>
        <form onSubmit={(e) => { e.preventDefault(); void go(); }} className="grid grid-cols-2 gap-2">
          {f.kind === "bet" ? (<>
            <Field label="Win chance, low"><input inputMode="decimal" value={f.pLow} onChange={(e) => setF({ ...f, pLow: e.target.value })} className={inputCls} /></Field>
            <Field label="Win chance, high"><input inputMode="decimal" value={f.pHigh} onChange={(e) => setF({ ...f, pHigh: e.target.value })} className={inputCls} /></Field>
            <Field label="Pays (to 1)"><input inputMode="decimal" value={f.odds} onChange={(e) => setF({ ...f, odds: e.target.value })} className={inputCls} /></Field>
          </>) : (<>
            <Field label="Sharpe, low"><input inputMode="decimal" value={f.sharpeLow} onChange={(e) => setF({ ...f, sharpeLow: e.target.value })} className={inputCls} /></Field>
            <Field label="Sharpe, high"><input inputMode="decimal" value={f.sharpeHigh} onChange={(e) => setF({ ...f, sharpeHigh: e.target.value })} className={inputCls} /></Field>
            <Field label="Volatility a year"><input inputMode="decimal" value={f.vol} onChange={(e) => setF({ ...f, vol: e.target.value })} className={inputCls} /></Field>
          </>)}
          <div className="col-span-2"><Button type="submit" busy={r.busy}>Calculate</Button></div>
        </form>
        <ErrorNote error={r.error} />
      </Card>
      {k ? (
        <Card title="For the inputs entered">
          <p className="text-[13px] text-fg">{k.sentence}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Full Kelly" value={pct(k.central, 1)} />
            <Stat label="At the low end" value={pct(k.lowEnd, 1)} />
            <Stat label="Half Kelly" value={pct(k.central / 2, 1)} hint="75% of the growth" />
            <Stat label="Quarter Kelly" value={pct(k.quarter, 1)} />
          </div>
          <div className="mt-3"><LineChart title="Long-run growth by fraction" series={[{ name: "Midpoint", points: k.curve.filter((_, i) => i % 4 === 0).map((c) => ({ x: pct(c.fraction, 1), y: c.growthCentral })) }, { name: "Low end", points: k.curve.filter((_, i) => i % 4 === 0).map((c) => ({ x: pct(c.fraction, 1), y: c.growthLow })) }]} format={(v) => v.toFixed(4)} height={170} /></div>
          <Table head={["Fraction", "Size", "Growth kept", "Chance of halving", "Of losing a third"]} rows={k.drawdownTable.map((d) => [d.label, pct(d.fraction, 1), pct(d.growthShare, 0), pct(d.pHalf, 1), pct(d.pThird, 1)])} minWidth={420} />
          <p className="mt-1 text-[11px] text-muted">Chances are of ever falling that far below the starting value, under continuous rebalancing.</p>
          {k.notes.map((n) => <p key={n} className="mt-1 text-[12px] text-muted">{n}</p>)}
          <Disclosures items={[k.disclosure]} />
        </Card>
      ) : <Card><p className="text-[12.5px] text-muted">Enter your edge as a range, not a point: the uncertainty is what makes full Kelly dangerous.</p></Card>}
    </div>
  );
}

function Governor() {
  const [symbol, setSymbol] = useState("SPY");
  const [template, setTemplate] = useState<"pod" | "floor">("pod");
  const call = useQuantCall();
  const r = useRun<{ governor: GovernorRun; drawdowns: { fraction: number; y1: { median: number; p95: number }; y3: { median: number; p95: number } }[]; disclosure: string }>();
  const go = () => r.run(() => call("/api/quant/sizing", json("POST", { mode: "governor", symbol, years: 20, template: template === "floor" ? { kind: "floor", floorPct: 0.8, multiplier: 3 } : { kind: "pod" } })));
  const g = r.data?.governor;
  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <Card title="Drawdown governor">
        <div className="grid grid-cols-2 gap-2">
          <Field label="On the history of"><input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} className={inputCls} /></Field>
          <Field label="Rules"><select value={template} onChange={(e) => setTemplate(e.target.value as "pod" | "floor")} className={inputCls}><option value="pod">Pod: halve at 5%, flat at 7.5%</option><option value="floor">Floor at 80% of peak</option></select></Field>
        </div>
        <div className="mt-2"><Button onClick={() => void go()} busy={r.busy}>Simulate</Button></div>
        <p className="mt-2 text-[11px] text-muted">On your own strategy&apos;s logged returns: <PremiumBadge feature="quant.sizing-pro" /></p>
        <ErrorNote error={r.error} />
      </Card>
      {g ? (
        <Card title="What the rules would have done">
          <p className="text-[13px] text-fg">{g.sentence}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Worst fall, no rules" value={pct(g.base.maxDrawdown, 1)} />
            <Stat label="Worst fall, with rules" value={pct(g.governed.maxDrawdown, 1)} />
            <Stat label="Return given up" value={pct(g.returnGivenUp, 1)} />
            <Stat label="De-riskings" value={String(g.triggers.length)} hint={`${g.soldNearBottom.length} near a bottom`} />
          </div>
          {r.data && <Table head={["Size", "Median 1-year fall", "Bad 1-year fall (95th)", "Median 3-year fall"]} rows={r.data.drawdowns.map((d) => [`${d.fraction === 1 ? "Full" : d.fraction === 0.5 ? "Half" : "Quarter"} exposure`, pct(d.y1.median, 1), pct(d.y1.p95, 1), pct(d.y3.median, 1)])} minWidth={420} />}
          <Disclosures items={r.data ? [r.data.disclosure] : []} />
        </Card>
      ) : <Card><p className="text-[12.5px] text-muted">Pods at multi-manager funds cut risk at fixed losses. See what such rules would have done to a fund or stock&apos;s history: smaller falls, some return given up, and the times it de-risked near a bottom.</p></Card>}
    </div>
  );
}

function Budget() {
  const [f, setF] = useState({ ofKelly: "0.25", maxPositionWeight: "0.1", maxGross: "1", maxDailyLossPct: "0.03", volTarget: "0.12" });
  const call = useQuantCall();
  const cur = useRun<{ budget: (RiskBudget & { version: number }) | null }>();
  const r = useRun<{ budget: RiskBudget; id: number }>();
  useEffect(() => { void cur.run(() => call("/api/quant/sizing")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Card title={<span className="flex items-center gap-2">Risk budget for the algo engine <PremiumBadge feature="quant.sizing-pro" /></span>}>
      <p className="text-[12px] text-muted">Limits the algo engine reads before it sizes an order. It may adopt them or tighten them, never loosen them.</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Field label="Share of Kelly"><input inputMode="decimal" value={f.ofKelly} onChange={(e) => setF({ ...f, ofKelly: e.target.value })} className={inputCls} /></Field>
        <Field label="Largest position"><input inputMode="decimal" value={f.maxPositionWeight} onChange={(e) => setF({ ...f, maxPositionWeight: e.target.value })} className={inputCls} /></Field>
        <Field label="Gross exposure"><input inputMode="decimal" value={f.maxGross} onChange={(e) => setF({ ...f, maxGross: e.target.value })} className={inputCls} /></Field>
        <Field label="Daily loss limit"><input inputMode="decimal" value={f.maxDailyLossPct} onChange={(e) => setF({ ...f, maxDailyLossPct: e.target.value })} className={inputCls} /></Field>
        <Field label="Volatility target"><input inputMode="decimal" value={f.volTarget} onChange={(e) => setF({ ...f, volTarget: e.target.value })} className={inputCls} /></Field>
      </div>
      <div className="mt-2"><Button busy={r.busy} onClick={() => void r.run(() => call("/api/quant/sizing", json("POST", { mode: "budget", ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])) })))}>Save budget</Button></div>
      <ErrorNote error={r.error} />
      {(r.data?.budget ?? cur.data?.budget) && <p className="mt-2 text-[12px] text-fg">{(r.data?.budget ?? cur.data?.budget)!.basis}</p>}
      {cur.data?.budget && !r.data && <p className="mt-1 text-[11px] text-muted">Saved {cur.data.budget.asOf.slice(0, 10)} (version {num(cur.data.budget.version, 0)}).</p>}
    </Card>
  );
}
