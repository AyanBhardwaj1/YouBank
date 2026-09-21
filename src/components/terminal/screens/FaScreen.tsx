import type { CompanyData } from "@/lib/types";
import { derive, fmtMoney, fmtNum, fmtPct } from "@/lib/metrics";
import { Columns } from "@/components/charts/Columns";
import { StatTile } from "../StatTile";

export function FaScreen({ company: c }: { company: CompanyData }) {
  const d = derive(c);
  const l = c.ltm;
  const tone = (v: number | null) => (v === null ? undefined : v < 0 ? "neg" : "pos");
  const rows: { label: string; value: number | null; sub?: string; tone?: "pos" | "neg"; concept?: string }[] = [
    { label: "Revenue", value: l.revenue, sub: d.revenueGrowth !== null ? `${fmtPct(d.revenueGrowth)} y/y` : "", concept: c.sources.concepts.revenue },
    { label: "Gross profit", value: l.grossProfit, sub: `${fmtPct(d.grossMargin)} margin`, concept: c.sources.concepts.grossProfit ?? c.sources.concepts.costOfRevenue },
    { label: "Operating income", value: l.operatingIncome, sub: `${fmtPct(d.opMargin)} margin`, tone: tone(l.operatingIncome), concept: c.sources.concepts.operatingIncome },
    { label: "D&A", value: l.da, concept: c.sources.concepts.da },
    { label: "EBITDA (reported)", value: l.ebitda, sub: `${fmtPct(d.ebitdaMargin)} margin`, tone: tone(l.ebitda) },
    { label: "Stock-based comp", value: l.sbc, concept: c.sources.concepts.sbc },
    { label: "Adj. EBITDA (ex-SBC)", value: l.adjEbitda, sub: l.adjEbitda !== null && l.revenue ? `${fmtPct(l.adjEbitda / l.revenue)} margin` : "", tone: tone(l.adjEbitda) },
    { label: "Net income", value: l.netIncome, tone: tone(l.netIncome), concept: c.sources.concepts.netIncome },
    { label: "Operating cash flow", value: l.operatingCashFlow, concept: c.sources.concepts.ocf },
    { label: "Capex", value: l.capex !== null ? -l.capex : null, concept: c.sources.concepts.capex },
    { label: "Free cash flow", value: d.fcf, sub: `${fmtPct(d.fcfMargin)} margin`, tone: tone(d.fcf) },
  ];
  const r40 = d.ruleOf40 !== null ? Math.max(0, Math.min(d.ruleOf40, 80)) : 0;

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
        <StatTile label="LTM revenue" value={l.revenue !== null ? `$${fmtMoney(l.revenue)}` : "n/a"} delta={d.revenueGrowth !== null ? `${fmtPct(d.revenueGrowth)} y/y` : undefined} deltaGood={d.revenueGrowth !== null ? d.revenueGrowth >= 0 : undefined} />
        <StatTile label="Gross margin" value={fmtPct(d.grossMargin)} />
        <StatTile label="Operating margin" value={fmtPct(d.opMargin)} deltaGood={d.opMargin !== null ? d.opMargin >= 0 : undefined} delta={d.opMargin === null ? undefined : d.opMargin >= 0 ? "profitable" : "loss-making"} />
        <StatTile label="FCF margin" value={fmtPct(d.fcfMargin)} deltaGood={d.fcfMargin !== null ? d.fcfMargin >= 0 : undefined} delta={d.fcf !== null ? `$${fmtMoney(d.fcf)}` : undefined} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {c.quarters.length > 0 ? (
          <Columns data={c.quarters.map((q) => ({ label: q.label, value: q.revenue }))} format={(v) => `$${fmtMoney(v)}`} title="Quarterly revenue, USD millions" height={150} />
        ) : <div className="text-[11px] text-muted">No quarterly series.</div>}
        <div>
          <div className="mb-1 text-[11px] text-muted">Rule of 40 (revenue growth % + FCF margin %)</div>
          <div className="relative h-3 w-full max-w-[420px] rounded-sm bg-chart-1/20">
            <div className={`h-full rounded-sm ${d.ruleOf40 !== null && d.ruleOf40 >= 40 ? "bg-chart-1" : "bg-chart-1/60"}`} style={{ width: `${(r40 / 80) * 100}%` }} />
            <div className="absolute top-[-3px] h-[18px] w-px bg-fg/70" style={{ left: "50%" }} title="40" />
            <span className="absolute left-1/2 top-4 -translate-x-1/2 text-[9px] text-muted">40</span>
          </div>
          <div className="num mt-5 text-[13px] font-semibold">
            {d.ruleOf40 !== null ? d.ruleOf40.toFixed(0) : "n/a"}{" "}
            <span className="text-[11px] font-normal text-muted">= {fmtPct(d.revenueGrowth)} growth + {fmtPct(d.fcfMargin)} FCF margin</span>
          </div>
          <p className="mt-3 text-[11px] text-muted">LTM ended {l.periodEnd} · USD millions · FYE {c.fye} · balance sheet as of {c.balance.asOf}</p>
        </div>
      </div>

      <table className="w-full text-[11.5px]">
        <thead className="text-[10.5px] uppercase tracking-wider text-muted">
          <tr className="border-b border-line">
            <th className="py-1 text-left font-normal">LTM summary</th>
            <th className="py-1 text-right font-normal">USD mm</th>
            <th className="py-1 text-right font-normal">Margin / growth</th>
            <th className="py-1 pl-4 text-left font-normal">XBRL concept</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-b border-line/60 last:border-0 hover:bg-elevated/60">
              <td className="py-1 font-sans text-muted">{r.label}</td>
              <td className={`py-1 text-right ${r.value === null ? "text-faint" : r.tone === "neg" ? "text-neg" : r.tone === "pos" ? "text-pos" : ""}`}>{fmtNum(r.value)}</td>
              <td className="py-1 text-right text-muted">{r.sub ?? ""}</td>
              <td className="max-w-[220px] truncate py-1 pl-4 text-[10px] text-faint" title={r.concept}>{r.concept ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="list-disc pl-4 text-[10px] text-muted">
        {c.sources.notes.map((n) => <li key={n}>{n}</li>)}
      </ul>
    </div>
  );
}
