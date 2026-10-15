"use client";

/**
 * Q5 TCA: what trading costs. A pre-trade estimate for any symbol and size; the person's own fills imported
 * from a broker export (or a connected broker, Pro) measured against each day's bar; what that adds up to in a
 * year; and brokers' Rule 605/606 reports with the payment for order flow on the person's own orders.
 * Fills are the person's alone: never pooled, deletable here.
 */
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { CostEstimate } from "@/lib/quant/contracts";
import type { TcaReport } from "@/lib/quant/tca/run";
import { bps, Button, Card, Disclosures, ErrorNote, Field, inputCls, json, num, pct, Stat, Table, usd, useQuantCall, useRun } from "./ui";

type Estimate = CostEstimate & { symbol: string; source: string; yShrunk: { y: number; n: number } };

export function CostsTab({ initialSymbol }: { initialSymbol?: string }) {
  return (
    <div className="space-y-3">
      <p className="max-w-3xl text-[12.5px] text-muted">Every trade pays a spread and moves the price a little. These are measurable, and they add up: here is what a trade should cost before you place it, and what yours did cost.</p>
      <Estimator initialSymbol={initialSymbol} />
      <MyFills />
    </div>
  );
}

function Estimator({ initialSymbol }: { initialSymbol?: string }) {
  const [f, setF] = useState({ symbol: initialSymbol ?? "AAPL", notionalUsd: "10000", side: "buy" });
  const call = useQuantCall();
  const r = useRun<{ estimate: Estimate; disclosure: string }>();
  const go = () => r.run(() => call("/api/quant/costs", json("POST", { ...f, notionalUsd: Number(f.notionalUsd) })));
  useEffect(() => { if (initialSymbol) void go(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const e = r.data?.estimate;
  return (
    <div className="grid gap-3 lg:grid-cols-[300px_1fr]">
      <Card title="Before a trade">
        <form onSubmit={(ev) => { ev.preventDefault(); void go(); }} className="grid grid-cols-2 gap-2">
          <Field label="Symbol"><input value={f.symbol} onChange={(ev) => setF({ ...f, symbol: ev.target.value.toUpperCase() })} className={inputCls} /></Field>
          <Field label="Size ($)"><input inputMode="numeric" value={f.notionalUsd} onChange={(ev) => setF({ ...f, notionalUsd: ev.target.value })} className={inputCls} /></Field>
          <Field label="Direction"><select value={f.side} onChange={(ev) => setF({ ...f, side: ev.target.value })} className={inputCls}><option value="buy">Into a position</option><option value="sell">Out of a position</option><option value="short">Short</option><option value="cover">Cover a short</option></select></Field>
          <div className="flex items-end"><Button type="submit" busy={r.busy}>Estimate</Button></div>
        </form>
        <ErrorNote error={r.error} />
      </Card>
      {e ? (
        <Card title={`${e.symbol}: about ${bps(e.totalRoundTripBps)} round trip`}>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Half-spread" value={bps(e.spreadBps)} />
            <Stat label="Price impact" value={bps(e.impactBps)} hint={`Impact coefficient ${num(e.yShrunk.y, 2)}${e.yShrunk.n ? ` (from ${e.yShrunk.n} of your fills)` : ""}`} />
            <Stat label="Commission" value={bps(e.commissionBps)} />
            <Stat label="Daily dollar volume" value={usd(e.adv20Usd)} hint={e.adv20Usd > 0 ? `You would be ${pct(e.referenceNotionalUsd / e.adv20Usd, 3)} of it` : undefined} />
          </div>
          <p className="mt-2 text-[11.5px] text-muted">{e.model}; {e.source}; as of {e.asOf.slice(0, 10)}.</p>
          <Disclosures items={r.data ? [r.data.disclosure] : []} />
        </Card>
      ) : <Card><p className="text-[12.5px] text-muted">Spread from daily highs, lows and closes (Corwin-Schultz, Abdi-Ranaldo); impact from the square-root law on 20-day volume and volatility.</p></Card>}
    </div>
  );
}

type Templates = Record<string, { label: string; columns: string[] }>;

function MyFills() {
  const [csv, setCsv] = useState("");
  const [portfolio, setPortfolio] = useState("");
  const call = useQuantCall();
  const fills = useRun<{ fills: unknown[]; templates: Templates }>();
  const imp = useRun<{ broker: string; read: number; added: number; skipped: number; errors: string[] }>();
  const rep = useRun<TcaReport>();
  const load = () => fills.run(() => call("/api/quant/fills"));
  const report = () => rep.run(() => call(`/api/quant/tca${portfolio ? `?portfolioUsd=${encodeURIComponent(portfolio)}` : ""}`));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const doImport = async () => { if (await imp.run(() => call("/api/quant/fills", json("POST", { csv })))) { setCsv(""); void load(); void report(); } };
  const removeAll = async () => {
    if (!(await confirmDialog({ title: "Delete all your fills?", body: "Your imported trades and their analysis are removed. This cannot be undone.", confirmLabel: "Delete", tone: "danger" }))) return;
    await call("/api/quant/fills", json("DELETE", { all: true })).catch(() => null);
    rep.setData(null); void load();
  };
  const t = rep.data;
  return (
    <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
      <Card title="Your trades">
        <p className="text-[12px] text-muted">{fills.data ? `${fills.data.fills.length} fills stored.` : "Loading…"} Export your history from your broker and paste or upload it.</p>
        <Field label="Broker export (CSV)"><textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={4} className={`${inputCls} font-mono text-[11px]`} placeholder="Paste the CSV here" /></Field>
        <input type="file" accept=".csv,text/csv" className="mt-1 text-[11.5px] text-muted" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); }} />
        <div className="mt-2 flex flex-wrap gap-2"><Button onClick={() => void doImport()} busy={imp.busy} disabled={!csv.trim()}>Import</Button>{(fills.data?.fills.length ?? 0) > 0 && <Button kind="ghost" onClick={() => void removeAll()}>Delete all</Button>}</div>
        {imp.data && <p className="mt-2 text-[12px] text-fg">Read {imp.data.read} trades from {imp.data.broker}; {imp.data.added} new{imp.data.skipped ? `, ${imp.data.skipped} rows skipped` : ""}.</p>}
        <ErrorNote error={imp.error} />
        {fills.data && <details className="mt-2 text-[11px] text-muted"><summary className="cursor-pointer">Exports YouBank reads</summary><ul className="mt-1 space-y-1">{Object.values(fills.data.templates).map((tp) => <li key={tp.label}><b className="text-fg">{tp.label}</b>: {tp.columns.join(", ")}</li>)}</ul></details>}
        <p className="mt-2 text-[11px] text-muted">Syncing a connected broker&apos;s orders: <PremiumBadge feature="quant.tca-pro" /></p>
        <div className="mt-3 flex items-end gap-2">
          <Field label="Portfolio value ($)" hint="Optional, for cost as a share"><input inputMode="numeric" value={portfolio} onChange={(e) => setPortfolio(e.target.value)} className={inputCls} /></Field>
          <Button onClick={() => void report()} busy={rep.busy}>Analyse</Button>
        </div>
        <ErrorNote error={rep.error} />
      </Card>
      {t ? (
        <Card title="What your trading cost" right={<a href={`/api/quant/tca?format=csv${portfolio ? `&portfolioUsd=${encodeURIComponent(portfolio)}` : ""}`} className="flex items-center gap-1 text-[11.5px] text-accent hover:underline"><Icon name="Download" className="h-3.5 w-3.5" />CSV</a>}>
          <p className="text-[13px] text-fg">{t.headline}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="A year, projected" value={usd(t.annual.perYearUsd)} hint={t.annual.pctOfPortfolio !== null ? `${pct(t.annual.pctOfPortfolio, 2)} of the portfolio` : undefined} />
            <Stat label="Against the day's typical price" value={bps(t.annual.measuredVsTypicalBps)} hint="Rough: daily data" />
            <Stat label="Trades a month" value={num(t.annual.tradesPerMonth, 1)} hint={`Average ${usd(t.annual.avgTradeUsd)}`} />
            <Stat label="Fees" value={usd(t.annual.feesUsd)} />
          </div>
          {t.expensive.length > 0 && <div className="mt-3"><b className="text-[12px] text-fg">Costliest trades</b><Table head={["Trade", "Size", "vs typical", "Modelled"]} rows={t.expensive.slice(0, 8).map((x) => [`${x.date} ${x.fill.symbol} ${x.fill.side}`, usd(x.notionalUsd), bps(x.vsTypicalBps), bps(x.modelledCostBps)])} /></div>}
          {t.byHour.some((h) => h.n > 0) && <div className="mt-3"><b className="text-[12px] text-fg">By hour (New York)</b><Table head={["Hour", "Trades", "Average vs typical"]} rows={t.byHour.filter((h) => h.n > 0).map((h) => [`${h.hour}:00`, String(h.n), bps(h.avgBps)])} minWidth={260} /></div>}
          {t.pfof.length > 0 && <div className="mt-3"><b className="text-[12px] text-fg">Payment for order flow on your orders</b>{t.pfof.map((p) => <p key={p.broker} className="text-[12px] text-muted">{p.broker}: {p.usd === null ? "not in its 606 report" : usd(p.usd)}. {p.basis}</p>)}</div>}
          {t.missingBars.length > 0 && <p className="mt-2 text-[11px] text-muted">No daily bars for {t.missingBars.slice(0, 8).join(", ")}.</p>}
          <Disclosures items={t.disclosures} />
        </Card>
      ) : <Card><p className="text-[12.5px] text-muted">Import a broker export, then Analyse: each trade is compared with that day&apos;s open, close and typical price, and the total projected to a year.</p></Card>}
    </div>
  );
}
