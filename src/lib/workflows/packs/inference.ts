/**
 * The inference pack: calculators built on YouBank's statistical models, for anyone who wants the
 * method as well as the number. A Monte Carlo DCF with correlated inputs, a credit scorecard, a
 * forecast with calibrated intervals, a beta estimator with standard errors, a pipeline forecast,
 * an earnings-quality check and a VaR backtest. Every one is seeded, so the same inputs give the same
 * answer, and every one shows its working.
 */
import { altmanZ, altmanZpp, impliedRating, mortalityFor, ohlsonO } from "@/lib/inference/credit";
import { simulatePipeline } from "@/lib/inference/crm";
import { forecast } from "@/lib/inference/forecast";
import type { Annual } from "@/lib/inference/fundamentals";
import { drawInputs, quantileOf, spearman, summarize, type Dist } from "@/lib/inference/montecarlo";
import { beneish, sloanAccruals } from "@/lib/inference/quality";
import { garch11, garchForecast, kupiec, ols, quantile, returns, rng, valueAtRisk, welchBeta } from "@/lib/inference/stats";
import { poissonBinomial } from "@/lib/inference/survival";
import { fmt, num, parseCsv, str, type CalculatorDef, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

const pct = (i: Inputs, k: string) => num(i, k) / 100;
const numbers = (text: string) => text.split(/[\s,;]+/).map((t) => Number(t.replace(/[$%]/g, ""))).filter((v) => Number.isFinite(v));

/* ---------------- Monte Carlo DCF ---------------- */

type DcfDraw = { g1: number; margin: number; wacc: number; gT: number };

function dcfValue(i: Inputs, x: DcfDraw): number | null {
  const n = Math.max(3, Math.min(10, Math.round(num(i, "years", 5))));
  const tax = pct(i, "taxRate"), s2c = Math.max(0.1, num(i, "salesToCapital", 1.5)), m0 = pct(i, "currentMargin");
  if (x.gT >= x.wacc - 0.01) return null;
  let rev = num(i, "revenue"), pv = 0;
  for (let t = 1; t <= n; t++) {
    const g = x.g1 + ((x.gT - x.g1) * (t - 1)) / (n - 1);
    const prev = rev;
    rev *= 1 + g;
    const m = m0 + ((x.margin - m0) * t) / n;
    const fcff = rev * m * (1 - tax) - (rev - prev) / s2c;
    pv += fcff / Math.pow(1 + x.wacc, t);
  }
  // Terminal value with return on new capital equal to WACC: growth creates no value beyond it.
  const nopat = rev * (1 + x.gT) * x.margin * (1 - tax);
  pv += (nopat * (1 - x.gT / x.wacc)) / (x.wacc - x.gT) / Math.pow(1 + x.wacc, n);
  return (pv - num(i, "netDebt")) / Math.max(1e-9, num(i, "shares"));
}

const monteCarloDcf: CalculatorDef = {
  id: "monte-carlo-dcf", kind: "calc", title: "Monte Carlo DCF",
  tagline: "A DCF as a distribution: correlated inputs, P10/P50/P90 per share, and what drives the spread",
  description: "A Damodaran-style DCF (free cash flow to the firm from growth, margin and reinvestment) run thousands of times with the uncertain inputs drawn from distributions: growth normal, target margin PERT, WACC normal, terminal growth triangular, with growth and margin, and WACC and terminal growth, correlated through a Gaussian copula. Returns the distribution of value per share, the chance it beats the price, a tornado and each input's share of the variance.",
  roles: ["banker", "pe", "corpfin", "markets", "consultant", "student"], category: "Valuation", icon: "BarChart3", savesMinutes: 90,
  tags: ["DCF", "Monte Carlo", "valuation range", "probabilistic"],
  fields: [
    { key: "revenue", label: "LTM revenue", type: "number", unit: "$mm", required: true, default: 5000 },
    { key: "currentMargin", label: "Current EBIT margin", type: "number", unit: "%", default: 10 },
    { key: "growthMean", label: "Revenue growth, year 1 (expected)", type: "number", unit: "%", default: 18 },
    { key: "growthSd", label: "Growth uncertainty (1 sd)", type: "number", unit: "%", default: 6, help: "The Revenue forecast (FCST) interval is a good guide" },
    { key: "marginLow", label: "Target EBIT margin, low", type: "number", unit: "%", default: 14 },
    { key: "marginMode", label: "Target EBIT margin, most likely", type: "number", unit: "%", default: 20 },
    { key: "marginHigh", label: "Target EBIT margin, high", type: "number", unit: "%", default: 26 },
    { key: "years", label: "Years to steady state", type: "number", unit: "years", default: 5, min: 3, max: 10 },
    { key: "taxRate", label: "Tax rate", type: "number", unit: "%", default: 24 },
    { key: "salesToCapital", label: "Sales to capital", type: "number", unit: "x", default: 1.5, help: "Revenue added per dollar reinvested" },
    { key: "waccMean", label: "WACC", type: "number", unit: "%", default: 9 },
    { key: "waccSd", label: "WACC uncertainty (1 sd)", type: "number", unit: "%", default: 0.75 },
    { key: "gLow", label: "Terminal growth, low", type: "number", unit: "%", default: 1 },
    { key: "gMode", label: "Terminal growth, most likely", type: "number", unit: "%", default: 2.5 },
    { key: "gHigh", label: "Terminal growth, high", type: "number", unit: "%", default: 3.5, help: "Keep it under the risk-free rate" },
    { key: "netDebt", label: "Net debt", type: "number", unit: "$mm", default: -500 },
    { key: "shares", label: "Diluted shares", type: "number", unit: "shares mm", default: 300 },
    { key: "price", label: "Current share price", type: "number", default: 36 },
    { key: "rhoGM", label: "Correlation, growth and margin", type: "number", default: 0.3, min: -0.9, max: 0.9, step: 0.1 },
    { key: "rhoWG", label: "Correlation, WACC and terminal growth", type: "number", default: 0.5, min: -0.9, max: 0.9, step: 0.1 },
    { key: "draws", label: "Draws", type: "number", default: 10000, min: 1000, max: 20000 },
  ],
  example: { revenue: 5000, currentMargin: 10, growthMean: 18, growthSd: 6, marginLow: 14, marginMode: 20, marginHigh: 26, years: 5, taxRate: 24, salesToCapital: 1.5, waccMean: 9, waccSd: 0.75, gLow: 1, gMode: 2.5, gHigh: 3.5, netDebt: -500, shares: 300, price: 36, rhoGM: 0.3, rhoWG: 0.5, draws: 10000 },
  prefill: (c) => ({
    revenue: c.ltm.revenue ?? undefined, currentMargin: c.ltm.revenue && c.ltm.operatingIncome !== null ? +((c.ltm.operatingIncome / c.ltm.revenue) * 100).toFixed(1) : undefined,
    growthMean: c.ltm.revenue && c.ltm.priorRevenue ? +((c.ltm.revenue / c.ltm.priorRevenue - 1) * 100).toFixed(1) : undefined,
    netDebt: c.balance.debt !== null || c.balance.cash !== null ? +((c.balance.debt ?? 0) - (c.balance.cash ?? 0)).toFixed(0) : undefined,
    shares: c.balance.sharesOut ?? undefined, price: c.price?.last ?? undefined,
  }),
  compute: (i: Inputs): WorkflowOutput => {
    if (!(num(i, "revenue") > 0)) throw new Error("Revenue must be positive.");
    if (!(num(i, "shares") > 0)) throw new Error("Shares must be positive.");
    const mLow = pct(i, "marginLow"), mMode = pct(i, "marginMode"), mHigh = pct(i, "marginHigh");
    const gLow = pct(i, "gLow"), gMode = pct(i, "gMode"), gHigh = pct(i, "gHigh");
    if (!(mLow <= mMode && mMode <= mHigh)) throw new Error("Target margins must run low ≤ most likely ≤ high.");
    if (!(gLow <= gMode && gMode <= gHigh)) throw new Error("Terminal growth must run low ≤ most likely ≤ high.");
    const n = Math.max(1000, Math.min(20000, Math.round(num(i, "draws", 10000))));
    const labels = ["Revenue growth", "Target margin", "WACC", "Terminal growth"] as const;
    const dists: Dist[] = [
      { kind: "normal", mean: pct(i, "growthMean"), sd: Math.abs(pct(i, "growthSd")), min: -0.5, max: 1.5 },
      { kind: "pert", low: mLow, mode: mMode, high: mHigh },
      { kind: "normal", mean: pct(i, "waccMean"), sd: Math.abs(pct(i, "waccSd")), min: 0.03, max: 0.25 },
      { kind: "triangular", low: gLow, mode: gMode, high: gHigh },
    ];
    const rGM = Math.max(-0.9, Math.min(0.9, num(i, "rhoGM", 0.3))), rWG = Math.max(-0.9, Math.min(0.9, num(i, "rhoWG", 0.5)));
    const corr = [[1, rGM, 0, 0], [rGM, 1, 0, 0], [0, 0, 1, rWG], [0, 0, rWG, 1]];
    const draws = drawInputs(dists, corr, n, 2026);
    const asDraw = (d: number[]): DcfDraw => ({ g1: d[0], margin: d[1], wacc: d[2], gT: d[3] });
    const values: number[] = [], kept: number[][] = [];
    for (const d of draws) { const v = dcfValue(i, asDraw(d)); if (v !== null && Number.isFinite(v)) { values.push(v); kept.push(d); } }
    if (values.length < n * 0.5) throw new Error("Most draws had terminal growth within a point of WACC. Lower terminal growth or raise WACC.");
    const s = summarize(values, 24);
    const price = num(i, "price");
    const pAbove = price > 0 ? values.filter((v) => v > price).length / values.length : null;
    const sd = Math.sqrt(values.reduce((a, v) => a + (v - s.mean) ** 2, 0) / (values.length - 1));
    const medians = dists.map((d) => quantileOf(d, 0.5));
    const base = dcfValue(i, asDraw(medians));
    const tornado = dists.map((d, j) => {
      const at = (q: number) => dcfValue(i, asDraw(medians.map((m, k) => (k === j ? quantileOf(d, q) : m))));
      const lo = at(0.1), hi = at(0.9);
      return { input: labels[j], low: lo, high: hi, swing: lo !== null && hi !== null ? Math.abs(hi - lo) : 0 };
    }).sort((a, b) => b.swing - a.swing);
    const rho = labels.map((_, j) => spearman(kept.map((d) => d[j]), values));
    const r2 = rho.map((r) => r * r), tot = r2.reduce((a, b) => a + b, 0) || 1;
    // What a bear, base and bull outcome looked like: average inputs of draws near each percentile.
    const sorted = values.map((v, k) => ({ v, d: kept[k] })).sort((a, b) => a.v - b.v);
    const around = (q: number) => { const c = Math.floor(q * (sorted.length - 1)), w = Math.max(20, Math.floor(sorted.length * 0.025)); const sl = sorted.slice(Math.max(0, c - w), c + w); return labels.map((_, j) => sl.reduce((a, x) => a + x.d[j], 0) / sl.length); };
    const scen = [["Bear (P10)", s.p10, around(0.1)], ["Base (P50)", s.p50, around(0.5)], ["Bull (P90)", s.p90, around(0.9)]] as const;
    const money = (v: number | null) => (v === null ? "n/a" : `$${v.toFixed(2)}`);
    return {
      title: "Monte Carlo DCF",
      summary: `Across ${values.length.toLocaleString("en-US")} valid draws, value per share has a median of ${money(s.p50)} with an 80% range of ${money(s.p10)} to ${money(s.p90)}${pAbove !== null ? `; ${fmt.pct(pAbove, 0)} of outcomes exceed today's ${money(price)}` : ""}. ${tornado[0].input} moves the answer most, and explains about ${fmt.pct(r2[labels.indexOf(tornado[0].input)] / tot, 0)} of the spread.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Median value / share", value: money(s.p50) },
          { label: "80% range", value: `${money(s.p10)} – ${money(s.p90)}` },
          { label: "Mean", value: money(s.mean), hint: `Monte Carlo standard error ${money(sd / Math.sqrt(values.length))}` },
          ...(pAbove !== null ? [{ label: "P(value > price)", value: fmt.pct(pAbove, 0), tone: (pAbove >= 0.5 ? "pos" : "neg") as "pos" | "neg" }] : []),
          { label: "Base case (inputs at medians)", value: money(base) },
          { label: "Draws rejected", value: fmt.pct(1 - values.length / n, 1), hint: "Terminal growth within a point of WACC" },
        ] },
        { type: "columns", title: "Distribution of value per share", format: "num", data: s.histogram.map((h) => ({ label: `$${((h.lo + h.hi) / 2).toFixed(0)}`, value: h.count })) },
        { type: "table", title: "Tornado: each input at its 10th and 90th percentile, the rest at their medians", columns: ["Input", "Value at P10 of input", "Value at P90 of input", "Swing"],
          rows: tornado.map((t) => [t.input, money(t.low), money(t.high), money(t.swing)]) },
        { type: "table", title: "What drives the spread (Spearman rank correlation)", columns: ["Input", "Distribution", "Rank correlation", "Share of variance"],
          rows: labels.map((l, j) => [l, j === 0 ? `Normal(${fmt.pct(pct(i, "growthMean"))}, ${fmt.pct(pct(i, "growthSd"))})` : j === 1 ? `PERT(${fmt.pct(mLow)}, ${fmt.pct(mMode)}, ${fmt.pct(mHigh)})` : j === 2 ? `Normal(${fmt.pct(pct(i, "waccMean"), 2)}, ${fmt.pct(pct(i, "waccSd"), 2)})` : `Triangular(${fmt.pct(gLow)}, ${fmt.pct(gMode)}, ${fmt.pct(gHigh)})`, rho[j].toFixed(2), fmt.pct(r2[j] / tot, 0)]) },
        { type: "table", title: "What each outcome looked like (average inputs of the draws near it)", columns: ["Outcome", "Value / share", "Revenue growth", "Target margin", "WACC", "Terminal growth"],
          rows: scen.map(([name, v, d]) => [name, money(v), fmt.pct(d[0]), fmt.pct(d[1]), fmt.pct(d[2], 2), fmt.pct(d[3], 2)]), emphasisRow: 1 },
      ],
      caveats: [
        "Running a simulation is not a risk adjustment: the draws are discounted at WACC, which already prices the risk (Damodaran).",
        "Garbage in, garbage out: the output is only as good as the distributions, and correlations between inputs are estimated loosely.",
        "Terminal value assumes new capital earns exactly WACC in steady state, so growth there neither creates nor destroys value.",
        "Draws with terminal growth within one point of WACC are rejected rather than allowed to explode the terminal value.",
      ],
      nextSteps: ["Take growth uncertainty from the terminal's FCST interval and WACC from WACC's Monte Carlo range", "Tighten the input driving the spread before refining the others", "Put the P10/P50/P90 on the football field next to comps and precedents"],
    };
  },
};

/* ---------------- Credit scorecard ---------------- */

const creditScorecard: CalculatorDef = {
  id: "credit-scorecard", kind: "calc", title: "Credit scorecard",
  tagline: "Altman Z and Z'', Ohlson O-score and Merton distance to default, as one implied rating",
  description: "Scores a borrower three ways: Altman's Z (and Z'' for non-manufacturers) mapped to Altman's rating medians, Ohlson's O-score as a probability of failure, and a naive Merton distance to default from market value and equity volatility. The implied rating is the median of the views that apply, with historical default rates for that rating.",
  roles: ["banker", "pe", "markets", "corpfin", "accountant", "student"], category: "Credit & restructuring", icon: "Shield", savesMinutes: 45,
  tags: ["credit", "Altman", "Z-score", "O-score", "Merton", "default probability"],
  fields: [
    { key: "revenue", label: "Revenue", type: "number", unit: "$mm", required: true, default: 2400 },
    { key: "ebit", label: "EBIT", type: "number", unit: "$mm", default: 210 },
    { key: "netIncome", label: "Net income", type: "number", unit: "$mm", default: 95 },
    { key: "priorNetIncome", label: "Net income, prior year", type: "number", unit: "$mm", default: 120 },
    { key: "cfo", label: "Operating cash flow", type: "number", unit: "$mm", default: 240 },
    { key: "totalAssets", label: "Total assets", type: "number", unit: "$mm", required: true, default: 3100 },
    { key: "currentAssets", label: "Current assets", type: "number", unit: "$mm", default: 900 },
    { key: "currentLiabilities", label: "Current liabilities", type: "number", unit: "$mm", default: 600 },
    { key: "totalLiabilities", label: "Total liabilities", type: "number", unit: "$mm", default: 2000 },
    { key: "retainedEarnings", label: "Retained earnings", type: "number", unit: "$mm", default: 700 },
    { key: "stDebt", label: "Short-term debt", type: "number", unit: "$mm", default: 150 },
    { key: "ltDebt", label: "Long-term debt", type: "number", unit: "$mm", default: 1100 },
    { key: "marketCap", label: "Market capitalization (optional)", type: "number", unit: "$mm", default: 1800 },
    { key: "equityVol", label: "Equity volatility (optional)", type: "number", unit: "%", default: 38 },
    { key: "pastReturn", label: "Stock return, last year", type: "number", unit: "%", default: -12 },
  ],
  example: { revenue: 2400, ebit: 210, netIncome: 95, priorNetIncome: 120, cfo: 240, totalAssets: 3100, currentAssets: 900, currentLiabilities: 600, totalLiabilities: 2000, retainedEarnings: 700, stDebt: 150, ltDebt: 1100, marketCap: 1800, equityVol: 38, pastReturn: -12 },
  prefill: (c) => ({ revenue: c.ltm.revenue ?? undefined, ebit: c.ltm.operatingIncome ?? undefined, netIncome: c.ltm.netIncome ?? undefined, cfo: c.ltm.operatingCashFlow ?? undefined, marketCap: c.price?.marketCap ?? undefined, ltDebt: c.balance.debt ?? undefined }),
  compute: (i: Inputs): WorkflowOutput => {
    const M = 1e6, v = (k: string) => num(i, k) * M;
    if (!(v("totalAssets") > 0)) throw new Error("Total assets must be positive.");
    const a: Annual = {
      end: "", fy: 0, revenue: v("revenue"), cogs: null, grossProfit: null, sga: null, da: null, ebit: v("ebit"), netIncome: v("netIncome"), cfo: v("cfo"), capex: null, interest: null, pretax: null, incomeTax: null,
      totalAssets: v("totalAssets"), currentAssets: v("currentAssets"), currentLiabilities: v("currentLiabilities"), totalLiabilities: v("totalLiabilities"), retainedEarnings: v("retainedEarnings"),
      equity: v("totalAssets") - v("totalLiabilities"), receivables: null, inventory: null, ppe: null, ltDebt: v("ltDebt"), stDebt: v("stDebt"), cash: null, shares: null,
    };
    const prior: Annual = { ...a, netIncome: v("priorNetIncome") };
    const mc = num(i, "marketCap") > 0 ? v("marketCap") : null, vol = num(i, "equityVol") > 0 ? pct(i, "equityVol") : null;
    const r = impliedRating(a, prior, { marketCapUsd: mc, equityVol: vol, pastReturn: pct(i, "pastReturn") });
    const z = altmanZ(a, mc), zpp = altmanZpp(a), o = ohlsonO(a, prior), mort = mortalityFor(r.rating);
    return {
      title: "Credit scorecard",
      summary: `The median of the applicable views implies ${r.rating} (${r.grade} grade).${mort ? ` Bonds first rated in that band have defaulted at ${fmt.pct(mort.year1, 2)} in year one and ${fmt.pct(mort.year5, 1)} within five years.` : ""} ${r.views.map((x) => `${x.method}: ${x.rating}${x.excluded ? " (left out)" : ""}`).join("; ")}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Implied rating", value: r.rating, tone: r.grade === "investment" ? "pos" : "warn" },
          ...(zpp ? [{ label: "Altman Z''", value: zpp.value.toFixed(2), delta: zpp.zone, tone: (zpp.zone === "safe" ? "pos" : zpp.zone === "grey" ? "warn" : "neg") as "pos" | "warn" | "neg" }] : []),
          ...(z ? [{ label: "Altman Z (manufacturers)", value: z.value.toFixed(2), delta: z.zone }] : []),
          ...(o ? [{ label: "Ohlson P(failure, 1y)", value: fmt.pct(o.pd, 2), tone: (o.pd < 0.01 ? "pos" : o.pd < 0.038 ? "warn" : "neg") as "pos" | "warn" | "neg" }] : []),
          ...(r.merton ? [{ label: "Merton distance to default", value: `${r.merton.dd.toFixed(1)} σ`, delta: `PD ${r.merton.pd < 1e-4 ? "<0.01%" : fmt.pct(r.merton.pd, 2)}` }] : []),
        ] },
        { type: "table", title: "Views", columns: ["Model", "Rating", "Reading", "Note"], rows: r.views.map((x) => [x.method, x.rating, x.detail, x.excluded ?? ""]) },
        ...(zpp ? [{ type: "table" as const, title: "Altman Z'' inputs", columns: ["Ratio", "Value", "Weight"], rows: [["X1 working capital / assets", zpp.inputs.X1.toFixed(3), "6.56"], ["X2 retained earnings / assets", zpp.inputs.X2.toFixed(3), "3.26"], ["X3 EBIT / assets", zpp.inputs.X3.toFixed(3), "6.72"], ["X4 book equity / liabilities", zpp.inputs.X4.toFixed(3), "1.05"]] }] : []),
        ...(o ? [{ type: "table" as const, title: "Ohlson O-score inputs", columns: ["Variable", "Value"], rows: Object.entries(o.inputs).map(([k, x]) => [k, x.toFixed(3)]) }] : []),
      ],
      caveats: ["All three models were fitted on industrial companies decades ago; none suits banks or insurers.", "Z'' reads negative retained earnings from buybacks as losses; such a view is left out.", "Naive Merton is generous to leveraged but stable companies; accounting models are harsh on loss-making growth companies."],
      nextSteps: ["Compare the implied rating's spread with the company's actual borrowing cost", "Run the terminal's IRAT on a listed peer for context"],
    };
  },
};

/* ---------------- Forecast with calibrated intervals ---------------- */

const forecastSeries: CalculatorDef = {
  id: "forecast-with-intervals", kind: "calc", title: "Forecast with honest intervals",
  tagline: "Paste a series, get the M4-style forecast and conformal 80%/95% bands with a backtest",
  description: "Forecasts any series (revenue, units, a KPI) with the combination of simple exponential smoothing, damped trend and Theta that performed best among simple methods in the M4 competition, after a seasonality test. The intervals are conformal: sized from the method's own rolling backtest errors, with the realized coverage reported.",
  roles: "all", category: "Planning & forecasting", icon: "LineChart", savesMinutes: 40,
  tags: ["forecast", "conformal", "M4", "Theta", "time series"],
  fields: [
    { key: "series", label: "Series, oldest first", type: "textarea", required: true, help: "Numbers separated by commas, spaces or new lines", default: "812, 845, 790, 1020, 868, 902, 851, 1098, 925, 971, 904, 1185, 988, 1034, 965, 1262" },
    { key: "period", label: "Seasonality", type: "select", options: ["Quarterly (4)", "Monthly (12)", "None (1)"], default: "Quarterly (4)" },
    { key: "horizon", label: "Periods ahead", type: "number", default: 4, min: 1, max: 12 },
  ],
  example: { series: "812, 845, 790, 1020, 868, 902, 851, 1098, 925, 971, 904, 1185, 988, 1034, 965, 1262", period: "Quarterly (4)", horizon: 4 },
  compute: (i: Inputs): WorkflowOutput => {
    const y = numbers(str(i, "series"));
    if (y.length < 8) throw new Error("Give at least 8 values.");
    const period = /12/.test(str(i, "period")) ? 12 : /4/.test(str(i, "period")) ? 4 : 1;
    const h = Math.max(1, Math.min(12, Math.round(num(i, "horizon", 4))));
    const f = forecast(y, h, { period });
    const xs = [...y.map((_, k) => `t${k + 1}`), ...f.point.map((_, k) => `+${k + 1}`)];
    const pad = (a: number[]) => [...y.map(() => null), ...a];
    return {
      title: "Forecast with honest intervals",
      summary: `The next value is forecast at ${fmt.num(f.point[0])} with an 80% interval of ${fmt.num(f.lower80[0])} to ${fmt.num(f.upper80[0])}. In the rolling backtest the one-step error averaged ${fmt.pct(f.backtest.mape)}, and ${f.backtest.coverage80 !== null ? `${fmt.pct(f.backtest.coverage80, 0)} of actuals fell inside the 80% band` : "there were too few origins to check coverage"}.${f.seasonal ? ` The series is seasonal (period ${period}).` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Next value", value: fmt.num(f.point[0]) }, { label: "80% interval", value: `${fmt.num(f.lower80[0])} – ${fmt.num(f.upper80[0])}` },
          { label: "Backtest MAPE", value: fmt.pct(f.backtest.mape) }, { label: "80% band coverage", value: fmt.pct(f.backtest.coverage80, 0), tone: f.backtest.coverage80 !== null && Math.abs(f.backtest.coverage80 - 0.8) <= 0.15 ? "pos" : "warn" },
          { label: "Model", value: f.model }, { label: "Seasonal", value: f.seasonal ? `yes (${period})` : "no" },
        ] },
        { type: "line", title: "History and forecast", format: "num", series: [
          { name: "History", points: xs.map((x, k) => ({ x, y: k < y.length ? y[k] : null })) },
          { name: "Forecast", points: xs.map((x, k) => ({ x, y: k === y.length - 1 ? y[k] : k >= y.length ? f.point[k - y.length] : null })) },
          { name: "Low (80%)", points: xs.map((x, k) => ({ x, y: pad(f.lower80)[k] })) },
          { name: "High (80%)", points: xs.map((x, k) => ({ x, y: pad(f.upper80)[k] })) },
        ] },
        { type: "table", title: "Forecast", columns: ["Period", "Forecast", "80% low", "80% high", "95% low", "95% high"], rows: f.point.map((p, k) => [`+${k + 1}`, fmt.num(p), fmt.num(f.lower80[k]), fmt.num(f.upper80[k]), fmt.num(f.lower95[k]), fmt.num(f.upper95[k])]) },
      ],
      caveats: [f.note || "A statistical forecast knows only the series' own history: nothing about launches, pricing or the economy.", "Intervals widen with the horizon as the square root of the step; they assume the future errs the way the past did."],
    };
  },
};

/* ---------------- Beta ---------------- */

const betaEstimator: CalculatorDef = {
  id: "beta-estimator", kind: "calc", title: "Beta estimator",
  tagline: "Raw, Blume-adjusted and Welch betas with standard errors, and the cost of equity",
  description: "Regresses a stock's returns on an index's from pasted prices: raw OLS beta with its standard error and 95% interval, the Blume adjustment (0.67 x raw + 0.33), and Welch's slope-winsorized, recency-weighted beta, which forecast future betas better in his tests. Then CAPM at your risk-free rate and premium.",
  roles: ["banker", "corpfin", "markets", "pe", "student"], category: "Valuation", icon: "TrendingUp", savesMinutes: 30,
  tags: ["beta", "CAPM", "regression", "cost of equity"],
  fields: [
    { key: "prices", label: "Prices", type: "csv", required: true, columns: "date,stock,index", help: "Oldest or newest first; daily, weekly or monthly closes" },
    { key: "rf", label: "Risk-free rate", type: "number", unit: "%", default: 4.3 },
    { key: "erp", label: "Equity risk premium", type: "number", unit: "%", default: 5 },
  ],
  example: { prices: (() => { const u = rng(8); let s = 100, x = 100; const rows = ["date,stock,index"]; for (let k = 0; k < 104; k++) { const m = 0.02 * (u() - 0.5); x *= 1 + m; s *= 1 + 1.3 * m + 0.02 * (u() - 0.5); const d = new Date(Date.UTC(2024, 0, 5 + 7 * k)).toISOString().slice(0, 10); rows.push(`${d},${s.toFixed(2)},${x.toFixed(2)}`); } return rows.join("\n"); })(), rf: 4.3, erp: 5 },
  compute: (i: Inputs): WorkflowOutput => {
    const { header, rows } = parseCsv(str(i, "prices"));
    const all = [...(Number.isFinite(Number(header[1])) ? [header] : []), ...rows].map((r) => ({ d: r[0], s: Number(r[1]), x: Number(r[2]) })).filter((r) => r.s > 0 && r.x > 0);
    if (all.length < 20) throw new Error("Give at least 20 rows of date,stock,index prices.");
    const data = all[0].d > all[all.length - 1].d ? [...all].reverse() : all;
    const rs = returns(data.map((r) => r.s)), rx = returns(data.map((r) => r.x));
    const gap = data.length > 1 ? Math.abs(new Date(data[data.length - 1].d).getTime() - new Date(data[0].d).getTime()) / 86_400_000 / (data.length - 1) : 7;
    const freq = gap < 3 ? "daily" : gap < 12 ? "weekly" : "monthly";
    const f = ols(rx, rs);
    const blume = 0.67 * f.beta + 0.33;
    const w = freq === "daily" ? welchBeta(rx, rs) : null;
    const rf = pct(i, "rf"), erp = pct(i, "erp");
    const ke = (b: number) => rf + b * erp;
    return {
      title: "Beta estimator",
      summary: `On ${rs.length} ${freq} returns the raw beta is ${f.beta.toFixed(2)} (95% interval ${(f.beta - 1.96 * f.seBeta).toFixed(2)} to ${(f.beta + 1.96 * f.seBeta).toFixed(2)}, R² ${fmt.pct(f.r2, 0)}); Blume-adjusted it is ${blume.toFixed(2)}, which gives a cost of equity of ${fmt.pct(ke(blume), 2)} at a ${fmt.pct(rf, 2)} risk-free rate and ${fmt.pct(erp, 1)} premium.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Raw beta", value: f.beta.toFixed(2), hint: `standard error ${f.seBeta.toFixed(2)}` },
          { label: "Blume-adjusted", value: blume.toFixed(2) },
          ...(w ? [{ label: "Welch beta", value: w.beta.toFixed(2), hint: "slope-winsorized, recency-weighted" }] : []),
          { label: "R²", value: fmt.pct(f.r2, 0) }, { label: "Cost of equity (Blume)", value: fmt.pct(ke(blume), 2) },
        ] },
        { type: "table", title: "Estimates", columns: ["Method", "Beta", "Cost of equity", "Note"], rows: [
          ["OLS", f.beta.toFixed(2), fmt.pct(ke(f.beta), 2), `95% interval ${(f.beta - 1.96 * f.seBeta).toFixed(2)}–${(f.beta + 1.96 * f.seBeta).toFixed(2)}`],
          ["Blume (0.67 raw + 0.33)", blume.toFixed(2), fmt.pct(ke(blume), 2), "Market convention for cost of capital"],
          ...(w ? [["Welch (2022)", w.beta.toFixed(2), fmt.pct(ke(w.beta), 2), "Returns clipped to -2x..+4x the market's, half-life ~87 days"]] : []),
        ] },
        { type: "scatter", title: "Stock vs index returns", xLabel: "Index return", yLabel: "Stock return", xFormat: "pct", yFormat: "pct", points: rs.map((y, k) => ({ label: data[k + 1].d, x: rx[k], y })) },
      ],
      caveats: ["Betas drift: two years of weekly returns is the usual compromise between noise and staleness.", "A low R² means the market explains little of the stock's moves; the beta is then imprecise even if it looks reasonable."],
    };
  },
};

/* ---------------- Pipeline forecast ---------------- */

const pipelineForecast: CalculatorDef = {
  id: "pipeline-forecast", kind: "calc", title: "Pipeline forecast",
  tagline: "How many deals close and what they are worth, as a range, not a weighted total",
  description: "Each deal closes with its own probability; the number of wins is computed exactly (a Poisson-binomial distribution) and the value by simulation, with each amount varying around what was entered. Returns P10/P50/P90, the chance of no wins, and the chance of reaching a target.",
  roles: ["banker", "pe", "vc", "corpfin", "consultant"], category: "Sourcing & deals", icon: "Target", savesMinutes: 25,
  tags: ["pipeline", "forecast", "probability", "Monte Carlo"],
  fields: [
    { key: "deals", label: "Deals", type: "csv", required: true, columns: "deal,probability_pct,amount", default: "deal,probability_pct,amount\nProject Atlas,70,12\nProject Birch,40,8\nProject Cedar,25,20\nProject Delta,60,5\nProject Elm,15,30\nProject Fir,50,9" },
    { key: "target", label: "Target", type: "number", default: 30, help: "Same units as the amounts" },
    { key: "sigma", label: "Amount uncertainty (lognormal sigma)", type: "number", default: 0.35, step: 0.05 },
  ],
  example: { deals: "deal,probability_pct,amount\nProject Atlas,70,12\nProject Birch,40,8\nProject Cedar,25,20\nProject Delta,60,5\nProject Elm,15,30\nProject Fir,50,9", target: 30, sigma: 0.35 },
  compute: (i: Inputs): WorkflowOutput => {
    const { header, rows } = parseCsv(str(i, "deals"));
    const all = [...(Number.isFinite(Number(header[1])) ? [header] : []), ...rows].map((r) => ({ name: r[0], p: Number(r[1]) / 100, amount: Number(r[2]) })).filter((d) => d.name && d.p >= 0 && d.p <= 1);
    if (!all.length) throw new Error("Enter rows of deal,probability_pct,amount.");
    const target = num(i, "target");
    const sim = simulatePipeline(all.map((d, k) => ({ id: k, p: d.p, amount: Number.isFinite(d.amount) && d.amount > 0 ? d.amount : null })), 20_000, 11, Math.max(0, num(i, "sigma", 0.35)), target > 0 ? target : undefined);
    const dist = poissonBinomial(all.map((d) => d.p));
    const v = sim.value;
    return {
      title: "Pipeline forecast",
      summary: `Expect ${sim.wins.expected.toFixed(1)} of ${all.length} deals to close (80% range ${sim.wins.p10}–${sim.wins.p90}; ${fmt.pct(sim.wins.none, 0)} chance of none).${v ? ` Value: median ${fmt.num(v.p50)}, 80% range ${fmt.num(v.p10)}–${fmt.num(v.p90)} against a probability-weighted ${fmt.num(v.weighted)}.${v.pAtLeastTarget !== null ? ` The chance of reaching ${fmt.num(target)} is ${fmt.pct(v.pAtLeastTarget, 0)}.` : ""}` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "Expected wins", value: sim.wins.expected.toFixed(1) }, { label: "80% range of wins", value: `${sim.wins.p10}–${sim.wins.p90}` },
          ...(v ? [{ label: "Median value", value: fmt.num(v.p50) }, { label: "80% range", value: `${fmt.num(v.p10)}–${fmt.num(v.p90)}` }, ...(v.pAtLeastTarget !== null ? [{ label: `P(≥ ${fmt.num(target)})`, value: fmt.pct(v.pAtLeastTarget, 0), tone: (v.pAtLeastTarget >= 0.5 ? "pos" : "warn") as "pos" | "warn" }] : [])] : []),
        ] },
        { type: "columns", title: "Chance of each number of wins", format: "pct", data: dist.map((p, k) => ({ label: String(k), value: p })) },
        { type: "table", title: "Deals", columns: ["Deal", "Probability", "Amount", "Expected value"], rows: all.map((d) => [d.name, fmt.pct(d.p, 0), Number.isFinite(d.amount) ? fmt.num(d.amount) : "", Number.isFinite(d.amount) ? fmt.num(d.p * d.amount) : ""]) },
      ],
      caveats: ["Deals are treated as independent; a market-wide shock that sinks several at once makes the downside worse than shown.", "Probabilities are only as good as the stage odds behind them: calibrate them against deals you have closed."],
    };
  },
};

/* ---------------- Earnings quality ---------------- */

const qualityFields = (suffix: string, label: string, d: Record<string, number>) => [
  ["revenue", "Revenue"], ["cogs", "Cost of revenue"], ["sga", "SG&A"], ["da", "Depreciation"], ["receivables", "Receivables"], ["currentAssets", "Current assets"], ["ppe", "Net PP&E"], ["totalAssets", "Total assets"], ["currentLiabilities", "Current liabilities"], ["ltDebt", "Long-term debt"], ["netIncome", "Net income"], ["cfo", "Operating cash flow"],
].map(([k, l]) => ({ key: `${k}${suffix}`, label: `${l}, ${label}`, type: "number" as const, unit: "$mm", default: d[k] }));

const THIS = { revenue: 1200, cogs: 700, sga: 180, da: 45, receivables: 260, currentAssets: 520, ppe: 400, totalAssets: 1500, currentLiabilities: 300, ltDebt: 350, netIncome: 110, cfo: 60 };
const LAST = { revenue: 1000, cogs: 560, sga: 165, da: 44, receivables: 170, currentAssets: 430, ppe: 380, totalAssets: 1300, currentLiabilities: 260, ltDebt: 330, netIncome: 90, cfo: 95 };

const earningsQuality: CalculatorDef = {
  id: "earnings-quality-check", kind: "calc", title: "Earnings-quality check",
  tagline: "Beneish M-score with its probability, and accruals, from two years of statements",
  description: "Computes Beneish's eight ratios and M-score (with his probit probability of manipulation), Sloan's accruals and the cash conversion of earnings from two consecutive years, and names the ratios that drive a flag. A screen for where to read the footnotes, not a verdict.",
  roles: ["accountant", "markets", "pe", "banker", "student"], category: "Accounting & audit", icon: "FileSearch", savesMinutes: 40,
  tags: ["Beneish", "accruals", "forensic accounting", "earnings quality"],
  fields: [...qualityFields("", "this year", THIS), ...qualityFields("P", "prior year", LAST)],
  example: { ...Object.fromEntries(Object.entries(THIS)), ...Object.fromEntries(Object.entries(LAST).map(([k, x]) => [`${k}P`, x])) },
  compute: (i: Inputs): WorkflowOutput => {
    const M = 1e6;
    const yr = (s: string): Annual => ({
      end: "", fy: 0, revenue: num(i, `revenue${s}`) * M, cogs: num(i, `cogs${s}`) * M, grossProfit: null, sga: num(i, `sga${s}`) * M, da: num(i, `da${s}`) * M, ebit: null, netIncome: num(i, `netIncome${s}`) * M, cfo: num(i, `cfo${s}`) * M, capex: null, interest: null, pretax: null, incomeTax: null,
      totalAssets: num(i, `totalAssets${s}`) * M, currentAssets: num(i, `currentAssets${s}`) * M, currentLiabilities: num(i, `currentLiabilities${s}`) * M, totalLiabilities: null, retainedEarnings: null, equity: null,
      receivables: num(i, `receivables${s}`) * M, inventory: null, ppe: num(i, `ppe${s}`) * M, ltDebt: num(i, `ltDebt${s}`) * M, stDebt: null, cash: null, shares: null,
    });
    const t = yr(""), p = yr("P");
    const b = beneish(t, p);
    if (!b) throw new Error("Revenue and total assets are needed for both years.");
    const acc = sloanAccruals(t, p);
    const conv = t.netIncome ? (t.cfo ?? 0) / t.netIncome : null;
    const hot = Object.entries(b.vars).filter(([k, v]) => (k === "TATA" ? v > 0.03 : k !== "SGAI" && k !== "LVGI" && v > 1.2)).map(([k]) => k);
    const names: Record<string, string> = { DSRI: "receivables growing faster than sales", GMI: "gross margin shrinking", AQI: "more assets of doubtful value", SGI: "fast sales growth", DEPI: "depreciation slowing", SGAI: "SG&A vs sales", LVGI: "leverage rising", TATA: "accruals high relative to assets" };
    return {
      title: "Earnings-quality check",
      summary: `Beneish M-score ${b.m.toFixed(2)} is ${b.flag ? "above" : "below"} his -1.78 cut-off (probit probability ${fmt.pct(b.p, 1)}).${hot.length ? ` ${b.flag ? "It is driven by" : "Still worth a look:"} ${hot.map((k) => names[k]).join(", ")}.` : ""} Accruals are ${fmt.pct(acc, 1)} of average assets and operating cash flow is ${conv !== null ? fmt.pct(conv, 0) : "n/a"} of net income.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Beneish M", value: b.m.toFixed(2), tone: b.flag ? "neg" : "pos", delta: b.flag ? "flagged" : "clear" },
          { label: "P(manipulator)", value: fmt.pct(b.p, 1) }, { label: "Accruals / assets", value: fmt.pct(acc, 1), tone: acc !== null && acc > 0.1 ? "neg" : "neutral" },
          { label: "Cash conversion", value: conv !== null ? fmt.pct(conv, 0) : "n/a", tone: conv !== null && conv < 0.8 ? "warn" : "neutral" },
        ] },
        { type: "table", title: "Beneish's ratios (1.0 = no change)", columns: ["Ratio", "Value", "What a high value means", "Weight"], rows: Object.entries(b.vars).map(([k, v]) => [k, v.toFixed(3), names[k], { DSRI: "0.920", GMI: "0.528", AQI: "0.404", SGI: "0.892", DEPI: "0.115", SGAI: "-0.172", TATA: "4.679", LVGI: "-0.327" }[k] ?? ""]) },
      ],
      caveats: ["The M-score was fitted on 1982-1992 manufacturers; fast-growing and acquisitive companies trip SGI and AQI innocently.", "A flag is a reason to read the revenue recognition, receivables and capitalization footnotes, not evidence of fraud."],
    };
  },
};

/* ---------------- VaR and backtest ---------------- */

const varBacktest: CalculatorDef = {
  id: "var-backtest", kind: "calc", title: "Value at risk with a backtest",
  tagline: "One-day VaR and expected shortfall three ways, a GARCH forecast, and a Kupiec test",
  description: "From a series of daily prices (or returns): historical, normal and Cornish-Fisher value at risk and expected shortfall at 95% and 99%, a GARCH(1,1) volatility forecast, and a Kupiec proportion-of-failures backtest of the rolling historical VaR over the last year.",
  roles: ["markets", "corpfin", "pe", "student"], category: "Portfolio", icon: "Gauge", savesMinutes: 35,
  tags: ["VaR", "expected shortfall", "GARCH", "Kupiec", "risk"],
  fields: [
    { key: "series", label: "Daily prices or returns, oldest first", type: "textarea", required: true, help: "Numbers separated by commas, spaces or new lines. Returns may be decimals (0.012) or percents (1.2%)." },
    { key: "kind", label: "The series is", type: "select", options: ["Prices", "Returns"], default: "Prices" },
    { key: "position", label: "Position size", type: "number", unit: "$mm", default: 10 },
  ],
  example: { series: (() => { const u = rng(5); let p = 100; const out: string[] = []; let v = 0.012; for (let k = 0; k < 800; k++) { const z = Math.sqrt(-2 * Math.log(1 - u())) * Math.cos(2 * Math.PI * u()); v = Math.sqrt(0.000004 + 0.08 * (v * z) ** 2 + 0.9 * v * v); p *= 1 + v * z; out.push(p.toFixed(2)); } return out.join(", "); })(), kind: "Prices", position: 10 },
  compute: (i: Inputs): WorkflowOutput => {
    const xs = str(i, "series").split(/[\s,;]+/).filter(Boolean).map((t) => (t.endsWith("%") ? Number(t.slice(0, -1)) / 100 : Number(t))).filter(Number.isFinite);
    const rets = /return/i.test(str(i, "kind")) ? xs : returns(xs);
    if (rets.length < 100) throw new Error("Give at least 100 daily observations.");
    const pos = num(i, "position", 10);
    const v95 = valueAtRisk(rets.slice(-500), 0.95), v99 = valueAtRisk(rets.slice(-500), 0.99);
    const g = garch11(rets.slice(-1000));
    const days = Math.min(250, rets.length - 250);
    const test = (level: number) => {
      const win = Math.min(500, rets.length - days);
      let ex = 0;
      for (let t = rets.length - days; t < rets.length; t++) if (rets[t] < quantile(rets.slice(t - win, t), 1 - level)) ex++;
      return { level, ex, ...kupiec(ex, days, level) };
    };
    const bt = days >= 60 ? [test(0.95), test(0.99)] : [];
    return {
      title: "Value at risk with a backtest",
      summary: `One-day historical VaR is ${fmt.pct(v95.historical, 2)} at 95% and ${fmt.pct(v99.historical, 2)} at 99% (${fmt.money(v95.historical * pos, 2)} and ${fmt.money(v99.historical * pos, 2)} on ${fmt.money(pos, 1)}). ${g ? `GARCH puts tomorrow's volatility at ${fmt.pct(Math.sqrt(garchForecast(g, 1) * 252), 1)} annualized against a long-run ${fmt.pct(Math.sqrt(g.longRunVariance * 252), 1)}.` : ""}${bt.length ? ` Backtest: ${bt.map((b) => `${b.ex} breaches at ${fmt.pct(b.level, 0)} against ${b.expected.toFixed(1)} expected (Kupiec p = ${b.pValue.toFixed(2)})`).join("; ")}.` : ""}`,
      blocks: [
        { type: "kpis", items: [
          { label: "VaR 95%", value: fmt.pct(v95.historical, 2), delta: fmt.money(v95.historical * pos, 2) }, { label: "ES 95%", value: fmt.pct(v95.historicalEs, 2) },
          { label: "VaR 99%", value: fmt.pct(v99.historical, 2), delta: fmt.money(v99.historical * pos, 2) },
          ...(g ? [{ label: "GARCH vol, next day", value: fmt.pct(Math.sqrt(garchForecast(g, 1) * 252), 1), hint: `persistence ${g.persistence.toFixed(3)}` }] : []),
        ] },
        { type: "table", title: "One-day VaR by method", columns: ["Method", "95%", "99%"], rows: [["Historical", fmt.pct(v95.historical, 2), fmt.pct(v99.historical, 2)], ["Normal", fmt.pct(v95.parametric, 2), fmt.pct(v99.parametric, 2)], ["Cornish-Fisher", fmt.pct(v95.cornishFisher, 2), fmt.pct(v99.cornishFisher, 2)], ["Expected shortfall (historical)", fmt.pct(v95.historicalEs, 2), fmt.pct(v99.historicalEs, 2)]] },
        ...(bt.length ? [{ type: "table" as const, title: `Kupiec backtest, last ${days} days`, columns: ["Level", "Breaches", "Expected", "p-value", "Verdict"], rows: bt.map((b) => [fmt.pct(b.level, 0), String(b.ex), b.expected.toFixed(1), b.pValue.toFixed(3), b.pValue < 0.05 ? (b.ex > b.expected ? "Understates risk" : "Conservative") : "Consistent"]) }] : []),
      ],
      caveats: [`Skew ${v95.skew.toFixed(2)}, excess kurtosis ${v95.kurtosis.toFixed(2)}: with fat tails the normal VaR understates the risk.`, "Historical VaR assumes the next day resembles the last two years; the GARCH forecast says whether today is calmer or rougher than that."],
    };
  },
};

export const INFERENCE_PACK: ToolDef[] = [monteCarloDcf, creditScorecard, forecastSeries, betaEstimator, pipelineForecast, earningsQuality, varBacktest];
