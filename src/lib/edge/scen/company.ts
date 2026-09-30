/**
 * Company what-ifs: a company's own history (revenue, EBITDA, capital spending and depreciation from
 * its XBRL filings) run forward under a shock to volumes, prices and costs that fades at a chosen pace,
 * with uncertainty set by how much its growth and margins moved before. Every figure is a synthetic
 * range with its recipe and seed, ready to go to Studio as a labeled sheet.
 */
import { getCompanyFacts, normalize, type CompanyFacts, type Fact } from "@/lib/edgar/facts";
import { resolveTicker } from "@/lib/edgar/tickers";
import { mean, normals, quantile, rng, std } from "./stats";

export type CompanySpec = { ticker: string; years: number; volume: number; price: number; cost: number; persistence: number; uncertainty: "low" | "base" | "high"; paths: number; seed: number };
export type Band = { p5: number; p50: number; p95: number };
export type CompanyResult = {
  kind: "company"; synthetic: true; title: string; ticker: string; name: string; recipe: string; seed: number; paths: number;
  history: { year: string; revenue: number; ebitda: number | null; capex: number | null }[];
  base: { year: string; revenue: number; ebitdaMargin: number | null; growth: number; growthVol: number; marginVol: number; capexRatio: number; daRatio: number; passThrough: number };
  years: { year: string; revenue: Band; ebitda: Band | null; margin: Band | null; fcf: Band | null }[];
  odds: { label: string; value: number }[];
  table: { title: string; columns: { name: string; type: "num" | "cat" | "text" }[]; rows: (string | number | null)[][]; synthetic: { recipe: string; seed: number } };
};

/** Annual values (full fiscal years from 10-Ks) of the first concept that has them, by fiscal year end. Pure. */
export function annual(cf: CompanyFacts, concepts: string[]): Map<string, number> {
  for (const c of concepts) {
    const raw = cf.facts["us-gaap"]?.[c]?.units?.USD;
    if (!raw?.length) continue;
    const rows = normalize(raw).filter((r: Fact) => r.start && r.days >= 350 && r.days <= 380 && /^10-K/.test(r.form));
    if (rows.length >= 2) return new Map(rows.map((r) => [r.end, r.val]));
  }
  return new Map();
}

const UNC = { low: 0.6, base: 1, high: 1.6 };

/** Run a company what-if. */
export async function runCompany(spec: CompanySpec): Promise<CompanyResult> {
  const t = await resolveTicker(spec.ticker);
  if (!t) throw Object.assign(new Error(`No SEC filer has the ticker ${spec.ticker}.`), { status: 404 });
  const cf = await getCompanyFacts(t.cik);
  const rev = annual(cf, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense"]);
  const oi = annual(cf, ["OperatingIncomeLoss"]);
  const da = annual(cf, ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"]);
  const capex = annual(cf, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]);
  const ends = [...rev.keys()].sort().slice(-7);
  if (ends.length < 3) throw Object.assign(new Error(`${t.name} does not have enough annual revenue in its XBRL filings.`), { status: 422 });
  const history = ends.map((e) => ({ year: e.slice(0, 4), revenue: rev.get(e)!, ebitda: oi.has(e) && da.has(e) ? oi.get(e)! + da.get(e)! : null, capex: capex.get(e) ?? null }));
  const growths = ends.slice(1).map((e, i) => rev.get(e)! / rev.get(ends[i])! - 1).filter(Number.isFinite);
  const withE = history.filter((h) => h.ebitda !== null && h.ebitda > 0);
  const eGrowths = withE.slice(1).map((h, i) => h.ebitda! / withE[i].ebitda! - 1).filter(Number.isFinite);
  const margins = withE.map((h) => h.ebitda! / h.revenue);
  const last = history[history.length - 1];
  const growth = Math.max(-0.1, Math.min(0.2, quantile(growths, 0.5)));
  const growthVol = Math.max(0.03, Math.min(0.4, std(growths)));
  const eGrowth = eGrowths.length >= 2 ? Math.max(-0.1, Math.min(0.2, quantile(eGrowths, 0.5))) : growth;
  const eVol = eGrowths.length >= 2 ? Math.max(0.03, Math.min(0.35, std(eGrowths))) : growthVol;
  const m0 = last.ebitda !== null && last.ebitda > 0 ? last.ebitda / last.revenue : null;
  const marginVol = margins.length >= 3 ? Math.max(0.01, Math.min(0.1, std(margins))) : 0.03;
  // How much of a price move passes through to costs (a processor buying the product it sells passes most;
  // a fee-based pipeline little), from how costs moved with revenue year to year.
  const costs = withE.map((h) => h.revenue - h.ebitda!);
  const dR = withE.slice(1).map((h, i) => h.revenue - withE[i].revenue), dC = costs.slice(1).map((c, i) => c - costs[i]);
  const passThrough = dR.length >= 2 ? Math.max(0, Math.min(0.95, dR.reduce((s, x, i) => s + x * dC[i], 0) / (dR.reduce((s, x) => s + x * x, 0) || 1))) : 0.5;
  const capexRatio = mean(history.filter((h) => h.capex !== null).map((h) => h.capex! / h.revenue)) || 0.08;
  const daRatio = mean(ends.filter((e) => da.has(e)).map((e) => da.get(e)! / rev.get(e)!)) || 0.05;
  const u = UNC[spec.uncertainty] ?? 1;
  const years = Math.max(1, Math.min(5, spec.years));
  const P = Math.max(500, Math.min(20_000, spec.paths));
  const r = rng(spec.seed), n = normals(r);
  const out = { revenue: [] as number[][], ebitda: [] as number[][], margin: [] as number[][], fcf: [] as number[][] };
  for (let y = 0; y < years; y++) { out.revenue.push([]); out.ebitda.push([]); out.margin.push([]); out.fcf.push([]); }
  for (let p = 0; p < P; p++) {
    let baseR = last.revenue, baseE = m0 !== null ? last.ebitda! : 0;
    for (let y = 0; y < years; y++) {
      const fade = Math.pow(Math.max(0, Math.min(1, spec.persistence)), y);
      const zR = n(), zE = 0.5 * zR + Math.sqrt(0.75) * n();
      baseR *= 1 + growth + growthVol * u * zR;
      if (m0 !== null) baseE *= 1 + eGrowth + eVol * u * zE;
      // Revenue is volume times price; costs are 30% fixed, move with volume otherwise, take their share of the
      // price move, and rise with the cost shock.
      const rMult = 1 + ((1 + spec.volume) * (1 + spec.price) - 1) * fade;
      const cMult = 1 + ((0.3 + 0.7 * (1 + spec.volume)) * (1 + passThrough * spec.price) * (1 + spec.cost) - 1) * fade;
      const revenue = baseR * rMult;
      out.revenue[y].push(revenue);
      if (m0 !== null) {
        const ebitda = baseR * rMult - Math.max(0, baseR - baseE) * cMult;
        const capexY = revenue * capexRatio, tax = 0.21 * Math.max(0, ebitda - revenue * daRatio);
        out.ebitda[y].push(ebitda); out.margin[y].push(ebitda / revenue); out.fcf[y].push(ebitda - capexY - tax);
      }
    }
  }
  const band = (x: number[]): Band => ({ p5: quantile(x, 0.05), p50: quantile(x, 0.5), p95: quantile(x, 0.95) });
  const lastYear = Number(last.year);
  const rows: (string | number | null)[][] = [];
  const yearsOut = out.revenue.map((_, y) => {
    const year = String(lastYear + y + 1);
    const res = { year, revenue: band(out.revenue[y]), ebitda: m0 !== null ? band(out.ebitda[y]) : null, margin: m0 !== null ? band(out.margin[y]) : null, fcf: m0 !== null ? band(out.fcf[y]) : null };
    for (const [metric, b] of [["Revenue", res.revenue], ["EBITDA", res.ebitda], ["EBITDA margin", res.margin], ["Free cash flow (before interest)", res.fcf]] as const) if (b) rows.push([year, metric, b.p5, b.p50, b.p95]);
    return res;
  });
  const shockWords = [spec.volume && `volumes ${spec.volume > 0 ? "+" : ""}${Math.round(spec.volume * 100)}%`, spec.price && `prices ${spec.price > 0 ? "+" : ""}${Math.round(spec.price * 100)}%`, spec.cost && `costs ${spec.cost > 0 ? "+" : ""}${Math.round(spec.cost * 100)}%`].filter(Boolean).join(", ") || "no shock";
  const recipe = `${P.toLocaleString("en-US")} simulated paths from ${t.name}'s ${history.length} fiscal years of XBRL data to FY${last.year}. Revenue and EBITDA each follow their own median growth (${(growth * 100).toFixed(1)}% and ${(eGrowth * 100).toFixed(1)}%) and historical volatility (${(growthVol * 100).toFixed(0)}% and ${(eVol * 100).toFixed(0)}%${u !== 1 ? `, both ×${u}` : ""}). The shock (${shockWords}) hits in the first year and keeps ${Math.round(spec.persistence * 100)}% of its size each year after: revenue is volume times price; costs are 30% fixed, move with volume otherwise, and take ${Math.round(passThrough * 100)}% of a price move (estimated from how its costs moved with revenue). Free cash flow is EBITDA less capital spending (${(capexRatio * 100).toFixed(1)}% of revenue) and 21% tax on EBIT, before interest and working capital.`;
  const odds = m0 !== null ? [
    { label: `Revenue in ${lastYear + 1} below FY${last.year}`, value: out.revenue[0].filter((v) => v < last.revenue).length / P },
    ...(last.ebitda !== null ? [{ label: `EBITDA in ${lastYear + 1} below FY${last.year}`, value: out.ebitda[0].filter((v) => v < last.ebitda!).length / P }] : []),
    { label: `Negative free cash flow in ${lastYear + 1}`, value: out.fcf[0].filter((v) => v < 0).length / P },
  ] : [{ label: `Revenue in ${lastYear + 1} below FY${last.year}`, value: out.revenue[0].filter((v) => v < last.revenue).length / P }];
  return {
    kind: "company", synthetic: true, title: `${t.name}: ${shockWords}`, ticker: t.ticker, name: t.name, recipe, seed: spec.seed, paths: P, history,
    base: { year: last.year, revenue: last.revenue, ebitdaMargin: m0, growth, growthVol, marginVol, capexRatio, daRatio, passThrough }, years: yearsOut, odds,
    table: { title: `${t.ticker} what-if (synthetic)`, columns: [{ name: "Fiscal year", type: "cat" }, { name: "Metric", type: "cat" }, { name: "Low (5th percentile)", type: "num" }, { name: "Median", type: "num" }, { name: "High (95th percentile)", type: "num" }], rows, synthetic: { recipe, seed: spec.seed } },
  };
}
