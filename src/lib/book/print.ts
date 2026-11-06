/**
 * What the next report must show: for a kill criterion on revenue (LTM growth, or LTM revenue), the revenue
 * the coming quarter needs for the criterion to hold once that quarter enters the twelve months, worked out
 * from the company's last eight quarters on SEC XBRL. "SNOW needs at least $1,182M next quarter (+21.4% y/y
 * against Q3 FY2026; last quarter grew +24.1%)" turns a criterion into the number to watch on the print.
 *
 * Said only when the data supports it: eight consecutive quarters whose last four add up to the company's
 * LTM revenue (within 2%). Otherwise nothing, never a guess. Pure (safe on the client); tested in
 * scripts/test-book.ts.
 */
import type { CompanyData } from "@/lib/types";

export type PrintBar = {
  criterionId: string; metric: "revenue_growth" | "revenue"; op: ">=" | "<=";
  /** Revenue the next quarter needs, US$ millions (at least, or at most, by op). */
  need: number;
  /** That revenue against the same quarter a year before, as a fraction. */
  yoy: number | null;
  /** The last reported quarter's growth on its year-ago quarter, for comparison. */
  lastYoy: number | null;
  yearAgo: string;
  /** Already settled whatever the quarter brings (the need is zero or below for "at least"). */
  settled: boolean;
  line: string;
};

type Crit = { id: string; metric: string; op: ">=" | "<="; value: number };

const sum = (xs: { revenue: number }[]) => xs.reduce((a, b) => a + b.revenue, 0);
const money = (x: number) => `$${Math.round(x).toLocaleString("en-US")}M`;
const pctS = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%`;

export function nextPrint(criteria: Crit[], company: Pick<CompanyData, "quarters" | "ltm" | "ticker">): PrintBar[] {
  const wanted = criteria.filter((c) => c.metric === "revenue_growth" || c.metric === "revenue");
  if (!wanted.length) return [];
  const q = [...(company.quarters ?? [])].filter((x) => Number.isFinite(x.revenue) && x.revenue > 0 && /^\d{4}-\d{2}-\d{2}/.test(x.end)).sort((a, b) => (a.end < b.end ? -1 : 1));
  if (q.length < 8) return [];
  const last8 = q.slice(-8);
  for (let i = 1; i < 8; i++) {
    const gap = (Date.parse(last8[i].end) - Date.parse(last8[i - 1].end)) / 86_400_000;
    if (gap < 70 || gap > 110) return [];
  }
  const ltm = sum(last8.slice(4));
  if (company.ltm?.revenue && Math.abs(ltm / company.ltm.revenue - 1) > 0.02) return [];
  const stays = sum(last8.slice(5)); // the three quarters that stay in the twelve months
  const priorAfter = sum(last8.slice(1, 5)); // the year-before twelve months once the new quarter is in
  const yearAgo = last8[4];
  const lastYoy = last8[7].revenue / last8[3].revenue - 1;
  return wanted.map((c) => {
    const metric = c.metric as PrintBar["metric"];
    const raw = metric === "revenue_growth" ? (1 + c.value / 100) * priorAfter - stays : c.value - stays;
    const settled = c.op === ">=" ? raw <= 0 : false;
    const need = Math.max(0, raw);
    const yoy = need > 0 ? need / yearAgo.revenue - 1 : null;
    const what = metric === "revenue_growth" ? `LTM revenue growth ${c.op === ">=" ? "at or above" : "at or below"} ${c.value}%` : `LTM revenue ${c.op === ">=" ? "at or above" : "at or below"} ${money(c.value)}`;
    const line = settled
      ? `${what} holds whatever next quarter's revenue is.`
      : c.op === "<=" && raw < 0
        ? `${what} cannot hold after next quarter: the three quarters that stay already exceed it.`
        : `${c.op === ">=" ? "At least" : "At most"} ${money(need)} of revenue next quarter (${yoy === null ? "" : `${pctS(yoy)} y/y against ${yearAgo.label}; `}last quarter ${pctS(lastYoy)}) keeps ${what}.`;
    return { criterionId: c.id, metric, op: c.op, need: Math.round(need * 10) / 10, yoy: yoy === null ? null : Math.round(yoy * 10_000) / 10_000, lastYoy: Math.round(lastYoy * 10_000) / 10_000, yearAgo: yearAgo.label, settled, line };
  });
}
