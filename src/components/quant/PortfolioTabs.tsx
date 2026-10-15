"use client";

/**
 * Q1 FACT (Factor Lab) and Q2 (portfolio risk and stress tests) on the same holdings: typed, or from a copy.
 * Connected-broker holdings, ten years and 200 holdings are Pro. Holdings are remembered in this browser only.
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { HBar } from "@/components/charts/HBar";
import { LineChart } from "@/components/charts/LineChart";
import { PremiumBadge } from "@/components/billing/Premium";
import type { CrowdingNow } from "@/lib/quant/factors/crowding";
import type { LabResult } from "@/lib/quant/factors/lab";
import type { RiskResult } from "@/lib/quant/risk/run";
import { Button, Card, Disclosures, ErrorNote, Field, HoldingsBox, inputCls, json, num, parseHoldings, pct, Stat, Table, useQuantCall, useRun } from "./ui";

const KEY = "quant.holdings";
const DEFAULT = "AAPL 20, MSFT 20, JPM 15, XOM 15, SPY 30";

/** The holdings text, remembered per browser (a convenience; never needed for the page to work). */
const noSubscribe = () => () => {};
const readStored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export function useHoldingsText(initial?: string): [string, (v: string) => void] {
  const stored = useSyncExternalStore(noSubscribe, readStored, () => null);
  const [edited, setEdited] = useState<string | null>(initial ?? null);
  return [edited ?? stored ?? DEFAULT, (v: string) => { setEdited(v); if (!initial) try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } }];
}

type Lab = LabResult & { runId: number | null; plan: { pro: boolean; maxHoldings: number; maxYears: number } };
type Dash = { tier: "youbank" | "etf"; source: string; names: string[]; dates: string[]; cumulative: number[][]; crowding: CrowdingNow[]; status: { youbank: { from: string | null; to: string | null; days: number }; version: string } | null };

export function FactorsTab({ initialHoldings }: { initialHoldings?: string }) {
  const [text, setText] = useHoldingsText(initialHoldings);
  const [years, setYears] = useState(3);
  const call = useQuantCall();
  const lab = useRun<Lab>();
  const dash = useRun<Dash>();
  useEffect(() => { void dash.run(() => call("/api/quant/factors")); }, [call]); // eslint-disable-line react-hooks/exhaustive-deps
  const go = () => lab.run(() => call("/api/quant/factors", json("POST", { holdings: parseHoldings(text), years })));
  const l = lab.data;
  const w = l?.windows.y3 ?? l?.windows.y1;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Card title="Your portfolio">
          <HoldingsBox value={text} onChange={setText} max={l?.plan.maxHoldings ?? 30} />
          <div className="mt-2 flex items-end gap-2">
            <Field label="Years"><select value={years} onChange={(e) => setYears(Number(e.target.value))} className={inputCls}>{[1, 3, 5, 10].map((y) => <option key={y} value={y}>{y}</option>)}</select></Field>
            <Button onClick={() => void go()} busy={lab.busy}>Measure</Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">Five and ten years, 200 holdings and a connected broker&apos;s holdings: <PremiumBadge feature="quant.factorlab-pro" /></p>
          <ErrorNote error={lab.error} />
        </Card>
        {l && w ? (
          <Card title="What drives it" right={<span className="text-[11px] text-muted">{l.tier === "youbank" ? "YouBank's own factors" : "ETF-proxy factors"}</span>}>
            <p className="text-[13px] text-fg">{l.summary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Alpha a year" value={pct(w.alphaAnnual, 1, true)} hint={`t = ${num(w.alphaT, 2)}`} />
              <Stat label="Explained (R²)" value={pct(w.r2, 0)} hint={`${w.n} days, ${w.from} to ${w.to}`} />
              {l.riskSplit && <Stat label="Factor risk" value={pct(l.riskSplit.factor, 0)} hint={l.riskSplit.explained} />}
              {l.tracking && <Stat label="Index-fund twin" value={pct(l.tracking.r2, 0)} hint={l.tracking.weights.slice(0, 3).map((x) => `${x.fund} ${pct(x.weight, 0)}`).join(", ")} />}
            </div>
            <p className="mt-2 text-[12px] text-muted">{w.luck}</p>
            <div className="mt-3"><Table head={["Factor", "Beta", "95% interval", "t"]} rows={w.betas.map((b) => [b.label, num(b.beta, 2), `${num(b.low, 2)} to ${num(b.high, 2)}`, num(b.t, 1)])} minWidth={340} /></div>
            {l.outside.length > 0 && <p className="mt-2 text-[11.5px] text-muted">Left out: {l.outside.map((o) => `${o.symbol} (${o.reason})`).join("; ")}</p>}
            {l.crowding.length > 0 && <ul className="mt-2 space-y-0.5 text-[12px] text-muted">{l.crowding.map((c) => <li key={c.factor}>{c.sentence}</li>)}</ul>}
            <Disclosures items={l.disclosures} />
          </Card>
        ) : <Card><p className="text-[12.5px] text-muted">Factor Lab measures how much of a portfolio&apos;s return came from market, size, value, momentum, quality and low-volatility tilts, and how much is left over, with intervals so luck is visible.</p></Card>}
      </div>
      {dash.data && dash.data.names.length > 0 && (
        <Card title="The factors" right={<span className="text-[11px] text-muted">{dash.data.source}</span>}>
          <LineChart title="Growth of 1, five years" series={dash.data.names.map((n, k) => ({ name: n, points: dash.data!.dates.map((d, i) => ({ x: d, y: dash.data!.cumulative[k][i] ?? null })) }))} format={(v) => v.toFixed(2)} height={220} />
          {dash.data.crowding.length > 0 && <Table head={["Factor", "Valuation spread", "Comovement", "Ownership", "Crowded"]} rows={dash.data.crowding.map((c) => [c.factor, pct(c.spread.pct, 0), pct(c.comove.pct, 0), pct(c.ownership.pct, 0), c.crowded ? "Yes" : "No"])} minWidth={420} />}
          <p className="mt-1 text-[11px] text-muted">Crowding columns are percentiles of each measure&apos;s own history.</p>
        </Card>
      )}
      <ErrorNote error={dash.error} />
    </div>
  );
}

type Risk = RiskResult & { runId: number | null; plan: { pro: boolean } };

export function RiskTab({ initialHoldings, initialShock }: { initialHoldings?: string; initialShock?: string }) {
  const [text, setText] = useHoldingsText(initialHoldings);
  const [shocks, setShocks] = useState(initialShock ?? "market -20");
  const [value, setValue] = useState("100000");
  const [reverse, setReverse] = useState("");
  const call = useQuantCall();
  const r = useRun<Risk>();
  const go = () => r.run(() => call("/api/quant/risk", json("POST", { holdings: parseHoldings(text), shocks: shocks.split(/[\n;]+/).map((s) => s.trim()).filter(Boolean), portfolioUsd: Number(value) || undefined, reverseLoss: reverse ? Number(reverse) / 100 : undefined })));
  const v = r.data;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-[320px_1fr]">
        <Card title="Your portfolio">
          <HoldingsBox value={text} onChange={setText} max={v?.plan.pro ? 200 : 30} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Field label="Value ($)" hint="For days to exit"><input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls} /></Field>
            <Field label="Reverse stress: loss %" hint="Pro"><input inputMode="decimal" value={reverse} onChange={(e) => setReverse(e.target.value)} className={inputCls} placeholder="25" /></Field>
          </div>
          <Field label="Shocks" hint={'One per line: "market -20", "rates +1", "momentum -10". Two free.'}><textarea value={shocks} onChange={(e) => setShocks(e.target.value)} rows={2} className={`${inputCls} font-mono text-[12px]`} /></Field>
          <div className="mt-2"><Button onClick={() => void go()} busy={r.busy}>Run</Button></div>
          <p className="mt-2 text-[11px] text-muted">200 holdings, 10,000 paths, every VaR, reverse stress and unlimited shocks: <PremiumBadge feature="quant.risk-pro" /></p>
          <ErrorNote error={r.error} />
        </Card>
        {v ? (
          <Card title="Where the risk is">
            <p className="text-[13px] text-fg">{v.summary}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Volatility a year" value={pct(v.decomposition.volAnnual, 1)} hint={v.covarianceMethod} />
              <Stat label="Top 3 holdings" value={pct(v.decomposition.top3Share, 0)} hint="of the variance" />
              <Stat label="Specific risk" value={pct(v.decomposition.specificShare, 0)} hint="not explained by factors" />
              <Stat label="VaR backtest" value={v.var.backtest.pass ? "Passes" : "Fails"} hint={`${v.var.backtest.exceptions} breaches in ${v.var.backtest.days} days (expected ${num(v.var.backtest.expected, 0)})`} tone={v.var.backtest.pass ? "pos" : "neg"} />
            </div>
            <p className="mt-2 text-[12px] text-muted">{v.varSentence}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <HBar title="Share of risk by holding" data={v.decomposition.holdings.slice(0, 10).map((h) => ({ key: h.symbol, label: h.symbol, value: h.share }))} format={(x) => pct(x, 0)} />
              <HBar title="Share of risk by factor" data={v.decomposition.factors.map((f) => ({ key: f.factor, label: f.factor, value: f.share }))} format={(x) => pct(x, 0)} />
            </div>
            <Disclosures items={v.disclosures} />
          </Card>
        ) : <Card><p className="text-[12.5px] text-muted">See which holdings and factors the risk comes from, how the portfolio would have fared in 2000, 2008, 2020 and 2022, what a shock you describe would do, and how long each position takes to sell down.</p></Card>}
      </div>
      {v && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Value at risk">
            <Table head={["Horizon", "Level", "VaR", "Expected shortfall", "Cornish-Fisher"]} rows={v.var.rows.map((x) => [`${x.horizon} day${x.horizon > 1 ? "s" : ""}`, pct(x.level, 0), pct(x.varFhs, 1), pct(x.esFhs, 1), pct(x.varCf, 1)])} />
            <p className="mt-1 text-[11px] text-muted">Filtered historical simulation, {v.var.paths} paths, seed {v.var.seed}; Kupiec p {num(v.var.backtest.kupiecP, 2)}, Christoffersen p {num(v.var.backtest.christoffersenP, 2)}.</p>
          </Card>
          <Card title="Replays and shocks">
            <Table head={["Scenario", "Loss", "Range"]} rows={[...v.stress.map((s) => [`${s.label}${s.proxied.length ? " *" : ""}`, pct(s.mid, 1), `${pct(s.low, 0)} to ${pct(s.high, 0)}`]), ...v.shocks.map((s) => [s.text, pct(s.mid, 1), `${pct(s.low, 0)} to ${pct(s.high, 0)}`])]} minWidth={300} />
            {v.stress.some((s) => s.proxied.length) && <p className="mt-1 text-[11px] text-muted">* Some holdings had no prices then and are replayed through their factor exposures.</p>}
            {v.reverse && <p className="mt-2 text-[12px] text-fg">{v.reverse.note}</p>}
          </Card>
          <Card title="Days to exit">
            {v.liquidity.length ? <Table head={["Holding", "Position", "Daily volume", "Days"]} rows={v.liquidity.map((x) => [x.symbol, `$${Math.round(x.positionUsd).toLocaleString()}`, x.advUsd ? `$${(x.advUsd / 1e6).toFixed(1)}M` : "–", x.days === null ? "–" : num(x.days, 1)])} minWidth={320} /> : <p className="text-[12px] text-muted">Enter a portfolio value to see this.</p>}
          </Card>
          <Card title="Drawdown odds over a year">
            <Table head={["Fall from peak", "Chance under the model"]} rows={v.drawdowns.map((d) => [pct(d.level, 0), pct(d.probability, 0)])} minWidth={240} />
          </Card>
        </div>
      )}
    </div>
  );
}
