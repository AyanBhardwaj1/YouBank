"use client";

import { useEffect, useMemo, useState } from "react";
import type { CompanyData } from "@/lib/types";
import type { Command } from "@/lib/functions";
import { derive, fmtMoney, fmtX, fmtPct } from "@/lib/metrics";
import type { ConceptSeries } from "@/lib/edgar/series";
import { StatTile } from "../StatTile";
import { LineChart } from "@/components/charts/LineChart";
import { findToolId } from "./ToolPanels";

const CONCEPTS = ["LongTermDebt", "LongTermDebtNoncurrent", "LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "ConvertibleNotesPayable", "ConvertibleDebtNoncurrent", "OperatingLeaseLiability", "FinanceLeaseLiability", "InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestPaidNet", "CashAndCashEquivalentsAtCarryingValue", "LineOfCreditFacilityRemainingBorrowingCapacity", "LineOfCreditFacilityMaximumBorrowingCapacity", "DebtInstrumentCarryingAmount", "LongTermDebtMaturitiesRepaymentsOfPrincipalInNextTwelveMonths", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearTwo", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearThree", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFour", "LongTermDebtMaturitiesRepaymentsOfPrincipalInYearFive", "LongTermDebtMaturitiesRepaymentsOfPrincipalAfterYearFive"];

const mm = (v: number) => v / 1e6;
const latest = (s?: ConceptSeries) => (s && s.instants.length ? s.instants[s.instants.length - 1] : null);
const ltm = (s?: ConceptSeries) => { if (!s) return null; const q = s.quarterly.slice(-4); if (q.length === 4) return { value: q.reduce((a, p) => a + p.value, 0), end: q[3].end, method: "4Q sum" }; const a = s.annual[s.annual.length - 1]; return a ? { value: a.value, end: a.end, method: "FY" } : null; };

/** Capital structure: debt, cash, leases, interest, leverage and coverage from XBRL, with a maturity ladder where reported. */
export function CapScreen({ company: c, onRun }: { company: CompanyData; onRun: (cmd: Command) => void }) {
  const [series, setSeries] = useState<Record<string, ConceptSeries> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/company/${c.ticker}/series?concepts=${CONCEPTS.join(",")}&periods=10`, { signal: ctrl.signal }).then((r) => r.json())
      .then((r: { series?: ConceptSeries[]; error?: string }) => { if (r.error) setError(r.error); else setSeries(Object.fromEntries((r.series ?? []).map((s) => [s.concept, s]))); })
      .catch(() => {});
    return () => ctrl.abort();
  }, [c.ticker]);

  const d = derive(c);
  const view = useMemo(() => {
    if (!series) return null;
    const pick = (...names: string[]) => names.map((n) => series[n]).find((s) => s && !s.error && (s.instants.length || s.quarterly.length || s.annual.length));
    const debtS = pick("LongTermDebt", "DebtInstrumentCarryingAmount");
    const nc = pick("LongTermDebtNoncurrent", "ConvertibleDebtNoncurrent"), cur = pick("LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings");
    const cashS = pick("CashAndCashEquivalentsAtCarryingValue");
    const interestS = pick("InterestExpense", "InterestExpenseDebt", "InterestExpenseNonoperating", "InterestPaidNet");
    const opLease = latest(pick("OperatingLeaseLiability")), finLease = latest(pick("FinanceLeaseLiability"));
    const revolverAvail = latest(pick("LineOfCreditFacilityRemainingBorrowingCapacity")), revolverMax = latest(pick("LineOfCreditFacilityMaximumBorrowingCapacity"));
    // Debt history: LongTermDebt instants, else noncurrent + current matched by date.
    let debtHist: { end: string; value: number }[] = debtS ? debtS.instants.map((p) => ({ end: p.end, value: mm(p.value) })) : [];
    if (!debtHist.length && nc) debtHist = nc.instants.map((p) => ({ end: p.end, value: mm(p.value + (cur?.instants.find((q) => q.end === p.end)?.value ?? 0)) }));
    const cashHist = cashS ? cashS.instants.map((p) => ({ end: p.end, value: mm(p.value) })) : [];
    const interest = ltm(interestS);
    const interestMm = interest ? mm(interest.value) : null;
    const ebitda = c.ltm.ebitda, adj = c.ltm.adjEbitda;
    const debt = c.balance.debt ?? (debtHist.length ? debtHist[debtHist.length - 1].value : null);
    const leverage = debt !== null && ebitda ? debt / ebitda : null;
    const netLev = d.netDebt !== null && ebitda ? d.netDebt / ebitda : null;
    const coverage = interestMm && ebitda ? ebitda / interestMm : null;
    const fcfDebt = d.fcf !== null && debt ? d.fcf / debt : null;
    const maturities = ["InNextTwelveMonths", "InYearTwo", "InYearThree", "InYearFour", "InYearFive", "AfterYearFive"].map((k, i) => ({ label: ["Yr 1", "Yr 2", "Yr 3", "Yr 4", "Yr 5", "5+"][i], v: latest(series[`LongTermDebtMaturitiesRepaymentsOfPrincipal${k}`]) })).filter((m) => m.v).map((m) => ({ label: m.label, value: mm(m.v!.value), end: m.v!.end }));
    const dates = [...new Set([...debtHist.map((p) => p.end), ...cashHist.map((p) => p.end)])].sort().slice(-10);
    return { debt, debtHist, cashHist, dates, interestMm, interest, leverage, netLev, coverage, fcfDebt, adj, opLease, finLease, revolverAvail, revolverMax, maturities };
  }, [series, c, d]);

  const capTool = findToolId(["capital-structure", "cap-table", "capital structure", "debt-schedule"]);
  const liqTool = findToolId(["13-week", "liquidity", "runway"]);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
        <StatTile label="Total debt" value={view?.debt !== null && view?.debt !== undefined ? `$${fmtMoney(view.debt)}` : c.balance.debt !== null ? `$${fmtMoney(c.balance.debt)}` : "n/a"} hint="Balance sheet debt from XBRL (excludes leases)" />
        <StatTile label="Cash & ST inv." value={c.balance.cash !== null ? `$${fmtMoney(c.balance.cash)}` : "n/a"} delta={d.netDebt !== null ? (d.netDebt < 0 ? `net cash $${fmtMoney(-d.netDebt)}` : `net debt $${fmtMoney(d.netDebt)}`) : undefined} />
        <StatTile label="Debt / EBITDA" value={fmtX(view?.leverage ?? null)} delta={view?.netLev !== null && view?.netLev !== undefined ? `${fmtX(view.netLev)} net` : undefined} deltaGood={view?.leverage !== null && view?.leverage !== undefined ? view.leverage < 4 : undefined} hint="LTM reported EBITDA (op. income + D&A)" />
        <StatTile label="EBITDA / interest" value={fmtX(view?.coverage ?? null)} delta={view?.interestMm ? `interest $${fmtMoney(view.interestMm)} (${view.interest?.method})` : undefined} deltaGood={view?.coverage !== null && view?.coverage !== undefined ? view.coverage > 3 : undefined} />
        <StatTile label="FCF / debt" value={fmtPct(view?.fcfDebt ?? null)} deltaGood={view?.fcfDebt !== null && view?.fcfDebt !== undefined ? view.fcfDebt > 0.1 : undefined} />
        <StatTile label="Revolver availability" value={view?.revolverAvail ? `$${fmtMoney(mm(view.revolverAvail.value))}` : "n/a"} delta={view?.revolverMax ? `of $${fmtMoney(mm(view.revolverMax.value))} facility` : undefined} hint="LineOfCreditFacilityRemainingBorrowingCapacity" />
      </div>

      {!series && !error && <div className="shimmer h-40 ctl" />}
      {error && <div className="text-[11px] text-neg">{error}</div>}
      {view && (
        <div className="grid gap-4 lg:grid-cols-2">
          {view.dates.length > 1 ? (
            <LineChart title="Debt vs. cash, USD millions (balance sheet instants)" format={(v) => `$${fmtMoney(v)}`}
              series={[{ name: "Debt", points: view.dates.map((dt) => ({ x: dt.slice(0, 7), y: view.debtHist.find((p) => p.end === dt)?.value ?? null })) }, { name: "Cash", points: view.dates.map((dt) => ({ x: dt.slice(0, 7), y: view.cashHist.find((p) => p.end === dt)?.value ?? null })) }]} />
          ) : <div className="text-[11px] text-muted">No debt time series in XBRL for this filer.</div>}
          <div>
            <div className="mb-1 text-[11px] text-muted">Maturity ladder, USD millions{view.maturities[0] ? ` (as of ${view.maturities[0].end})` : ""}</div>
            {view.maturities.length ? (
              <div className="flex h-28 items-end gap-2">
                {view.maturities.map((m, i) => { const max = Math.max(...view.maturities.map((x) => x.value), 1); return (
                  <div key={m.label} className="flex flex-1 flex-col items-center gap-1">
                    <span className="num text-[10px] text-fg">${fmtMoney(m.value)}</span>
                    <div className="grow-y w-full rounded-t-sm bg-chart-1" style={{ height: `${(m.value / max) * 80}px`, animationDelay: `${i * 70}ms` }} />
                    <span className="text-[10px] text-muted">{m.label}</span>
                  </div>); })}
              </div>
            ) : <div className="text-[11px] text-muted">No principal maturity schedule tagged. Ask the AI to read the debt footnote.</div>}
            <table className="num mt-3 w-full text-[11px]">
              <tbody>
                <tr className="border-b border-line/60"><td className="py-1 font-sans text-muted">Operating lease liability</td><td className="py-1 text-right">{view.opLease ? `$${fmtMoney(mm(view.opLease.value))}` : "n/a"}</td><td className="py-1 pl-3 text-right text-faint">{view.opLease?.end ?? ""}</td></tr>
                <tr className="border-b border-line/60"><td className="py-1 font-sans text-muted">Finance lease liability</td><td className="py-1 text-right">{view.finLease ? `$${fmtMoney(mm(view.finLease.value))}` : "n/a"}</td><td className="py-1 pl-3 text-right text-faint">{view.finLease?.end ?? ""}</td></tr>
                <tr className="border-b border-line/60"><td className="py-1 font-sans text-muted">Adj. EBITDA (ex-SBC)</td><td className="py-1 text-right">{view.adj !== null ? `$${fmtMoney(view.adj)}` : "n/a"}</td><td className="py-1 pl-3 text-right text-faint">LTM {c.ltm.periodEnd}</td></tr>
                <tr><td className="py-1 font-sans text-muted">Free cash flow</td><td className="py-1 text-right">{d.fcf !== null ? `$${fmtMoney(d.fcf)}` : "n/a"}</td><td className="py-1 pl-3 text-right text-faint">LTM</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2 text-[11px]">
        {capTool && <button type="button" onClick={() => onRun({ ticker: c.ticker, fn: "TOOL", arg: capTool })} className="ctl border border-accent/50 px-2 py-1 text-accent hover:bg-accent-soft">✦ Build the tranche-level cap table with AI</button>}
        {liqTool && <button type="button" onClick={() => onRun({ ticker: c.ticker, fn: "TOOL", arg: liqTool })} className="ctl border border-line px-2 py-1 text-muted hover:border-accent/50 hover:text-accent">Liquidity runway</button>}
        <button type="button" onClick={() => onRun({ ticker: c.ticker, fn: "XBRL" })} className="ctl border border-line px-2 py-1 text-muted hover:border-accent/50 hover:text-accent">Explore debt tags</button>
        <span className="ml-auto text-[10px] text-muted">XBRL instants and durations; leverage uses reported EBITDA. Leases excluded from debt.</span>
      </div>
    </div>
  );
}
