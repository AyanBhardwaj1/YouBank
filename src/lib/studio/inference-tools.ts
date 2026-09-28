/**
 * Studio's inference tools: the terminal's models, bound to the live workbook.
 *
 * - monte_carlo: draw the uncertain inputs (optionally correlated, through a Gaussian copula), recompute
 *   the model for each draw with nothing in the workbook changing, and write the distribution of the
 *   outputs, a tornado and each input's share of the variance to a sheet the deck can link to.
 * - forecast_series: extend a row of history with the M4-style combination and conformal intervals.
 * - suggest_assumptions: ranges for revenue growth, margin, WACC and terminal growth from the company's
 *   own data, ready to feed monte_carlo.
 * - risk_check: the implied credit rating and the earnings-quality flags, for the notes a reviewer
 *   would want next to the debt and earnings rows.
 */
import { z } from "zod";
import { def, type ToolDef } from "@/lib/ai/tools";
import { forecast } from "@/lib/inference/forecast";
import { drawInputs, quantileOf, spearman, summarize, type Dist } from "@/lib/inference/montecarlo";
import { annualPanel } from "@/lib/inference/fundamentals";
import { getCompanyData } from "@/lib/company";
import { getCompanyFacts } from "@/lib/edgar/facts";
import { creditView, forecastView, qualityView } from "@/lib/terminal/fundamentals";
import { waccView } from "@/lib/terminal/wacc";
import type { Engine } from "./engine";
import { addSheet, clearRange, requireSheet, sheetByName, writeRange, type Patch } from "./ops";
import type { Scalar, StudioDocData } from "./types";

export type StudioCtx = {
  engine: Engine; doc: StudioDocData;
  commit: (patches: Patch[], label: string, focus?: { sheet: string; range: string }) => Promise<void>;
  guard: <T>(fn: () => Promise<T>) => Promise<T>;
};

const InputSpec = z.object({
  cell: z.string().describe("the input cell, e.g. DCF!C6 or C6 on the given sheet"),
  label: z.string().optional(),
  dist: z.enum(["normal", "lognormal", "triangular", "uniform", "pert"]),
  mean: z.number().optional(), sd: z.number().optional(), min: z.number().optional(), max: z.number().optional(),
  median: z.number().optional(), sigma: z.number().optional(),
  low: z.number().optional(), mode: z.number().optional(), high: z.number().optional(),
});
type InputSpec = z.infer<typeof InputSpec>;

function toDist(i: InputSpec): Dist {
  const need = (...keys: (keyof InputSpec)[]) => { for (const k of keys) if (typeof i[k] !== "number") throw new Error(`${i.cell}: a ${i.dist} input needs ${keys.join(", ")}`); };
  switch (i.dist) {
    case "normal": need("mean", "sd"); return { kind: "normal", mean: i.mean!, sd: Math.abs(i.sd!), min: i.min, max: i.max };
    case "lognormal": need("median", "sigma"); return { kind: "lognormal", median: i.median!, sigma: Math.abs(i.sigma!) };
    case "uniform": need("low", "high"); return { kind: "uniform", low: Math.min(i.low!, i.high!), high: Math.max(i.low!, i.high!) };
    case "triangular": need("low", "mode", "high"); return { kind: "triangular", low: i.low!, mode: i.mode!, high: i.high! };
    case "pert": need("low", "mode", "high"); return { kind: "pert", low: i.low!, mode: i.mode!, high: i.high! };
  }
}

const describe = (d: Dist) => (d.kind === "normal" ? `Normal(${d.mean}, ${d.sd})` : d.kind === "lognormal" ? `Lognormal(median ${d.median}, σ ${d.sigma})` : d.kind === "uniform" ? `Uniform(${d.low}, ${d.high})` : `${d.kind === "pert" ? "PERT" : "Triangular"}(${d.low}, ${d.mode}, ${d.high})`);
const round = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(6)) : v);
/** A number for a cell: six significant figures, and blank rather than NaN. */
const cellNum = (v: number): Scalar => (Number.isFinite(v) ? Number(v.toPrecision(6)) : null);

export function inferenceTools(s: StudioCtx): ToolDef[] {
  const J = (x: unknown) => JSON.stringify(x);
  return [
    def({
      name: "monte_carlo",
      description: "Monte Carlo over the live model: give distributions for the uncertain input cells (and optionally correlations between them), and the output cells to watch (e.g. value per share, IRR). Each draw recomputes the whole workbook with the inputs replaced; nothing in the workbook changes. Returns percentiles, the chance the first output beats compare_to, a tornado (each input at its 10th and 90th percentile) and each input's share of the variance (Spearman). Writes a 'Monte Carlo' sheet (percentiles, input table, histogram bins) that slides can link to. Use suggest_assumptions first when the inputs come from a public company.",
      schema: z.object({
        sheet: z.string().describe("the sheet unqualified cell references are on"),
        outputs: z.array(z.string()).min(1).max(3),
        inputs: z.array(InputSpec).min(1).max(10),
        correlations: z.array(z.object({ a: z.string(), b: z.string(), rho: z.number().min(-0.95).max(0.95) })).optional().describe("rank correlations between input cells, e.g. revenue growth and margin +0.3, WACC and terminal growth +0.5"),
        draws: z.number().int().min(200).max(5000).optional(),
        compare_to: z.number().optional().describe("a threshold for the first output, e.g. today's share price"),
        write_sheet: z.boolean().optional(),
        add_slide: z.boolean().optional(),
      }),
      run: (i) => s.guard(async () => {
        const home = requireSheet(s.doc, i.sheet);
        const n = i.draws ?? 2000;
        const dists = i.inputs.map(toDist);
        const keyOf = (ref: string) => { const r = s.engine.resolve(ref, home.id); return `${r.sheet}!${r.a}`; };
        const keys = i.inputs.map((x) => keyOf(x.cell));
        let corr: number[][] | null = null;
        if (i.correlations?.length) {
          corr = keys.map((_, a) => keys.map((__, b) => (a === b ? 1 : 0)));
          for (const c of i.correlations) {
            const a = keys.indexOf(keyOf(c.a)), b = keys.indexOf(keyOf(c.b));
            if (a < 0 || b < 0) throw new Error(`Correlation ${c.a}/${c.b}: both must be inputs`);
            corr[a][b] = corr[b][a] = c.rho;
          }
        }
        const draws = drawInputs(dists, corr, n, 7);
        const outs: number[][] = i.outputs.map(() => []);
        let invalid = 0;
        const kept: number[][] = [];
        for (const d of draws) {
          const r = s.engine.whatIf(home.id, i.outputs, i.inputs.map((x, j) => ({ ref: x.cell, value: d[j] })));
          if (r.every((v) => typeof v === "number" && Number.isFinite(v))) { r.forEach((v, k) => outs[k].push(v as number)); kept.push(d); } else invalid++;
        }
        if (!outs[0].length) throw new Error("Every draw produced an error in the outputs: check the input ranges");
        const sums = outs.map((o) => summarize(o));
        const sdErr = (o: number[]) => { const m = o.reduce((a, b) => a + b, 0) / o.length; return Math.sqrt(o.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, o.length - 1) / o.length); };
        // Tornado: each input at its 10th and 90th percentile, the others at their medians.
        const medians = dists.map((d) => quantileOf(d, 0.5));
        const at = (j: number, v: number) => s.engine.whatIf(home.id, [i.outputs[0]], i.inputs.map((x, k) => ({ ref: x.cell, value: k === j ? v : medians[k] })))[0];
        const base = s.engine.whatIf(home.id, [i.outputs[0]], i.inputs.map((x, k) => ({ ref: x.cell, value: medians[k] })))[0];
        const tornado = i.inputs.map((x, j) => {
          const lo = at(j, quantileOf(dists[j], 0.1)), hi = at(j, quantileOf(dists[j], 0.9));
          return { input: x.label ?? x.cell, low: typeof lo === "number" ? lo : NaN, high: typeof hi === "number" ? hi : NaN };
        }).map((t) => ({ ...t, swing: Math.abs(t.high - t.low) })).sort((a, b) => (b.swing || 0) - (a.swing || 0));
        // Share of variance: squared rank correlations with the first output, normalized.
        const rho = i.inputs.map((_, j) => spearman(kept.map((d) => d[j]), outs[0]));
        const r2 = rho.map((r) => r * r), total = r2.reduce((a, b) => a + b, 0) || 1;
        const pAbove = i.compare_to !== undefined ? outs[0].filter((v) => v > i.compare_to!).length / outs[0].length : null;

        let where = "";
        if (i.write_sheet !== false) {
          let sheet = sheetByName(s.doc, "Monte Carlo");
          const patches: Patch[] = [];
          if (!sheet) { const r = addSheet(s.doc, "Monte Carlo"); patches.push(r.patch); sheet = r.sheet; await s.commit(patches, "Added the Monte Carlo sheet"); }
          const rows: Scalar[][] = [
            [`Monte Carlo: ${outs[0].length} valid draws of ${n}${invalid ? ` (${invalid} produced errors)` : ""}${corr ? ", correlated inputs" : ""}`],
            [],
            ["Output", "Mean", "P5", "P10", "P25", "P50", "P75", "P90", "P95", "Std error of mean"],
            ...i.outputs.map((o, k) => [o, cellNum(sums[k].mean), cellNum(sums[k].p5), cellNum(sums[k].p10), cellNum(sums[k].p25), cellNum(sums[k].p50), cellNum(sums[k].p75), cellNum(sums[k].p90), cellNum(sums[k].p95), cellNum(sdErr(outs[k]))] as Scalar[]),
            ...(pAbove !== null ? [[`P(${i.outputs[0]} > ${i.compare_to})`, cellNum(pAbove)] as Scalar[]] : []),
            [],
            ["Input", "Label", "Distribution", "P10", "P50", "P90", "Rank correlation", "Share of variance", "Tornado low", "Tornado high"],
            ...i.inputs.map((x, j) => { const t = tornado.find((q) => q.input === (x.label ?? x.cell)); return [x.cell, x.label ?? "", describe(dists[j]), cellNum(quantileOf(dists[j], 0.1)), cellNum(medians[j]), cellNum(quantileOf(dists[j], 0.9)), cellNum(rho[j]), cellNum(r2[j] / total), cellNum(t?.low ?? NaN), cellNum(t?.high ?? NaN)] as Scalar[]; }),
            [],
            [`Histogram of ${i.outputs[0]}`],
            ["Bin low", "Bin high", "Draws"],
            ...sums[0].histogram.map((h) => [cellNum(h.lo), cellNum(h.hi), h.count] as Scalar[]),
          ];
          await s.commit([clearRange(s.doc, "Monte Carlo", "A1:J200", "contents"), writeRange(s.doc, "Monte Carlo", "A1", rows)], "Wrote the Monte Carlo results", { sheet: sheet.id, range: `A1:J${rows.length}` });
          const histStart = rows.length - sums[0].histogram.length + 1;
          where = ` Results on 'Monte Carlo'!A1:J${rows.length}; histogram counts in 'Monte Carlo'!C${histStart}:C${rows.length} with bin lows in A${histStart}:A${rows.length}.`;
          if (i.add_slide) where += " Add a slide with a column chart linked to the histogram counts and metrics linked to the P10, P50 and P90 cells in row 4.";
        }
        return J({
          draws: n, valid: outs[0].length, invalid, correlated: !!corr,
          outputs: i.outputs.map((o, k) => ({ cell: o, mean: round(sums[k].mean), p5: round(sums[k].p5), p10: round(sums[k].p10), p50: round(sums[k].p50), p90: round(sums[k].p90), p95: round(sums[k].p95), stdErrorOfMean: round(sdErr(outs[k])) })),
          probabilityAbove: pAbove, base: typeof base === "number" ? round(base) : null,
          tornado: tornado.map((t) => ({ input: t.input, low: round(t.low), high: round(t.high) })),
          shareOfVariance: i.inputs.map((x, j) => ({ input: x.label ?? x.cell, rankCorrelation: round(rho[j]), share: round(r2[j] / total) })).sort((a, b) => b.share - a.share),
          note: `Seeded, so the same inputs give the same answer.${where}`,
        });
      }),
    }),
    def({
      name: "forecast_series",
      description: "Forecast a row or column of history already in the model (oldest first), e.g. quarterly revenue, with the combination of exponential smoothing, damped trend and Theta that won the M4 competition, and conformal 80%/95% intervals sized from its own backtest errors. Optionally write the forecast, low and high rows at write_to.",
      schema: z.object({ sheet: z.string(), range: z.string(), horizon: z.number().int().min(1).max(12), period: z.number().int().min(1).max(12).optional().describe("4 for quarterly, 12 for monthly, 1 for annual"), write_to: z.string().optional().describe("top-left cell for a 3-row block: forecast, low (80%), high (80%)") }),
      run: (i) => s.guard(async () => {
        const sh = requireSheet(s.doc, i.sheet);
        const y = s.engine.read(sh.id, i.range).flat().filter((v): v is number => typeof v === "number" && Number.isFinite(v));
        if (y.length < 6) throw new Error(`Only ${y.length} numbers in ${i.range}; a forecast needs at least 6`);
        const f = forecast(y, i.horizon, { period: i.period ?? 1 });
        if (i.write_to) {
          const rows: Scalar[][] = [["Forecast", ...f.point.map(cellNum)], ["Low (80%)", ...f.lower80.map(cellNum)], ["High (80%)", ...f.upper80.map(cellNum)]];
          await s.commit([writeRange(s.doc, i.sheet, i.write_to, rows)], "Wrote the forecast", { sheet: sh.id, range: i.write_to });
        }
        return J({ model: f.model, seasonal: f.seasonal, point: f.point.map(round), lower80: f.lower80.map(round), upper80: f.upper80.map(round), lower95: f.lower95.map(round), upper95: f.upper95.map(round), backtest: f.backtest, note: f.note || undefined });
      }),
    }),
    def({
      name: "suggest_assumptions",
      description: "Data-driven ranges for a public company's key valuation assumptions, each as a distribution ready for monte_carlo: next-year revenue growth (from a statistical forecast of its quarterly revenue with conformal intervals), EBIT margin (PERT over its own history), WACC (its cost-of-capital build with a Monte Carlo range) and terminal growth (bounded by the risk-free rate), plus its implied credit rating. Cite the sources given.",
      schema: z.object({ ticker: z.string() }),
      run: ({ ticker }) => s.guard(async () => {
        const t = ticker.toUpperCase();
        const [company, fc, w] = await Promise.all([getCompanyData(t), forecastView(t).catch(() => null), waccView(t).catch(() => null)]);
        if (!company) return J({ error: `No SEC data for ${t}` });
        const panel = annualPanel(await getCompanyFacts(company.cik), 6);
        const margins = panel.map((a) => (a.revenue && a.ebit !== null ? a.ebit / a.revenue : null)).filter((m): m is number => m !== null);
        const sorted = [...margins].sort((a, b) => a - b);
        const med = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : null;
        const growth = fc ? (() => {
          const last4 = fc.history.slice(-4).reduce((a, h) => a + h.revenue, 0);
          const next = (arr: number[]) => arr.slice(0, 4).reduce((a, v) => a + v, 0);
          return last4 ? { mode: next(fc.forecast.point) / last4 - 1, low: next(fc.forecast.lower80) / last4 - 1, high: next(fc.forecast.upper80) / last4 - 1 } : null;
        })() : null;
        const rf = w?.riskFree.value ?? 0.0425;
        const gHigh = Math.min(rf, 0.04), gMode = Math.min(0.025, gHigh - 0.005);
        return J({
          ticker: t, name: company.name,
          revenueGrowthNextYear: growth ? { dist: "triangular", low: round(growth.low), mode: round(growth.mode), high: round(growth.high), source: `Model forecast of ${t}'s quarterly revenue (SEC XBRL), next four quarters vs last four; 80% conformal band as the range. Backtest MAPE ${fc?.forecast.backtest.mape !== null && fc?.forecast.backtest.mape !== undefined ? (fc.forecast.backtest.mape * 100).toFixed(1) + "%" : "n/a"}.` } : null,
          ebitMargin: sorted.length >= 3 ? { dist: "pert", low: round(sorted[0]), mode: round(med!), high: round(sorted[sorted.length - 1]), source: `EBIT margin over FY${panel[0].fy}-FY${panel[panel.length - 1].fy} (SEC XBRL): lowest, median and highest year.` } : null,
          wacc: w ? { dist: "normal", mean: round(w.wacc), sd: round((w.range.p90 - w.range.p10) / 2.563), source: `Cost of capital build: 10y Treasury ${(rf * 100).toFixed(2)}%, beta ${w.beta.adjusted.toFixed(2)} (${w.beta.window}), ERP ${(w.erp * 100).toFixed(1)}%, cost of debt ${(w.debt.cost * 100).toFixed(2)}% (${w.debt.method}); sd from its 80% range.` } : null,
          terminalGrowth: { dist: "triangular", low: 0.01, mode: round(gMode), high: round(gHigh), source: "Bounded above by the risk-free rate (and 4%): a business cannot outgrow the economy forever." },
          taxRate: { effective: panel.length && panel[panel.length - 1].pretax && panel[panel.length - 1].incomeTax !== null ? round((panel[panel.length - 1].incomeTax as number) / (panel[panel.length - 1].pretax as number)) : null, marginal: 0.25 },
          impliedRating: w?.debt.rating ?? null,
          correlations: "Suggested: revenue growth with EBIT margin +0.3; WACC with terminal growth +0.5 (both follow rates).",
        });
      }),
    }),
    def({
      name: "risk_check",
      description: "Credit and earnings-quality checks for a public company: implied rating from Altman Z'', Ohlson O-score and Merton distance to default, with default odds; Beneish M-score, Piotroski F-score, accruals and red flags. Use the results as notes next to the debt and earnings rows, and to sanity-check the cost of debt.",
      schema: z.object({ ticker: z.string() }),
      run: ({ ticker }) => s.guard(async () => {
        const t = ticker.toUpperCase();
        const [c, q] = await Promise.all([creditView(t).catch((e: Error) => ({ error: e.message })), qualityView(t).catch((e: Error) => ({ error: e.message }))]);
        return J({
          credit: "error" in c ? c : { rating: c.rating.rating, grade: c.rating.grade, views: c.rating.views, mortality: c.rating.mortality, coverage: c.coverage, caveat: c.caveat },
          quality: "error" in q ? q : { fy: q.fy, beneishM: q.beneish?.m ?? null, beneishFlag: q.beneish?.flag ?? null, piotroski: q.piotroski?.score ?? null, accruals: q.accruals, flags: q.flags },
          sources: ["SEC XBRL company facts", "Prices: Financial Modeling Prep (when on the plan)"],
        });
      }),
    }),
  ] as unknown as ToolDef[];
}
