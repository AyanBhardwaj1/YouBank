/**
 * The LBO Stress Lab (E6) wired to its data: the company's last fiscal year and quarters from XBRL (or typed
 * in for a private target), the entry and exit multiples from the deal database (E1: similar sponsor deals and
 * their tested band, else sponsor deals in the SIC, else a stated default), the factor history (Scenarios'
 * daily factors summed to months), and the fitted short-rate model. `buildSpec` turns a request into the pure
 * simulation's parameters; `runLab` runs the 1,000-path preview with its realism check and recipe;
 * `refineLab` runs 20,000 paths (on the ML service when it is configured, else here in the background job).
 * Saved as `edge_scenarios` kind `lbo`, synthetic everywhere.
 */
import { getCompanyFactsFull, normalize, type CompanyFacts, type Fact } from "@/lib/edgar/facts";
import { getSubmissions } from "@/lib/edgar/submissions";
import { resolveTicker } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { getJson, putJson, r2Ready } from "../infra/r2";
import { mlReady, mlStart, type MlDone } from "../infra/ml";
import { buildQuery } from "../deals/query";
import { bandSentence } from "../deals/range";
import { exitMultiples, similarDeals } from "../deals/store";
import { annual } from "./company";
import { factorHistory, type FactorRow } from "./data";
import { sourcesUses, type Covenants, type Structure, type Tranche } from "./lbo";
import { fitGjr, gjrResiduals } from "./models";
import { rateModel, type RateModel } from "./rates";
import { stylisedRealism } from "./realism";
import { getScenario, updateScenario } from "./store";
import { mean, ols, std } from "./stats";
import { runStress, simulatePaths, summarise, type ExitParams, type MacroParams, type OperatingParams, type Outcomes, type SpreadParams, type StressResult, type StressSpec } from "./stress";

export type LabRequest = {
  ticker?: string;
  manual?: { name: string; revenue: number; ebitda: number; capexPct?: number; daPct?: number; growth?: number; sic?: string };
  entryMultiple?: number; exitMultiple?: number; exitElasticity?: number;
  tranches?: Tranche[]; covenants?: Covenants;
  sweep?: number; years?: number; minCash?: number; financeFeePct?: number; txnFeePct?: number; tax?: number; nwcPct?: number;
  spread?: Partial<SpreadParams>; hurdle?: number; confidence?: number; breakYear?: number; seed?: number;
};

export type LabInputs = { name: string; ticker: string; sic: string; revenue: number; ebitda: number; capexPct: number; daPct: number; growth: number; growthVol: number; marginVol: number; quarters: number[]; fy: string; source: string };

/** The default capital structure for an entry EBITDA: a term loan B, senior notes and a springing revolver. Pure. */
export function defaultTranches(): Tranche[] {
  return [
    { name: "Term loan B", kind: "tlb", turns: 4, floating: true, spreadBps: 350, floorPct: 0.5, oid: 99, amortPct: 1, prepayable: true },
    { name: "Senior notes", kind: "notes", turns: 1.5, floating: false, fixedPct: 8.5, amortPct: 0, prepayable: false },
    { name: "Revolver", kind: "revolver", turns: 1, floating: true, spreadBps: 325, floorPct: 0, amortPct: 0, prepayable: true },
  ];
}

/** A maintenance net leverage test 1.5 turns above entry leverage and a 1.75x interest cover test. Pure. */
export const defaultCovenants = (tranches: Tranche[]): Covenants => ({ maxNetLeverage: Math.round((tranches.filter((t) => t.kind !== "revolver").reduce((s, t) => s + t.turns, 0) + 1.5) * 4) / 4, minInterestCover: 1.75, springing: false, springAt: 0.35 });

/** Default refinancing spread: 350bp calm, plus 25bp for each 1% the market is below its peak, capped at 1,500bp. */
export const DEFAULT_SPREAD: SpreadParams = {
  baseBps: 350, slopeBpsPerPct: 25, capBps: 1500,
  source: "an assumption, not a fitted model: US high-yield spreads have ranged from under 300bp (2021) to about 2,000bp (late 2008) in published index histories, widest when equities had fallen furthest; free spread histories may not feed a model under their terms (FRED is excluded), so the slope is stated and can be changed",
};

/** Daily factor rows summed to calendar months (log returns add; yield changes add). Pure. */
export function monthlyFactors(rows: FactorRow[], names: (keyof Omit<FactorRow, "date">)[]): { months: string[]; H: number[][] } {
  const by = new Map<string, number[]>();
  for (const r of rows) {
    const m = r.date.slice(0, 7);
    const cur = by.get(m) ?? names.map(() => 0);
    names.forEach((n, j) => { cur[j] += r[n]; });
    by.set(m, cur);
  }
  const months = [...by.keys()].sort();
  // The current month is not over yet.
  if (months.length && months[months.length - 1] === new Date().toISOString().slice(0, 7)) months.pop();
  return { months, H: months.map((m) => by.get(m)!) };
}

/** Fit the monthly macro engine: GJR-GARCH(1,1)-t per factor and the standardised residual months. Pure. */
export function macroFrom(months: string[], H: number[][], names: string[]): MacroParams {
  const F = names.length;
  const fits = Array.from({ length: F }, (_, j) => fitGjr(H.map((r) => r[j])));
  const raw = fits.map((g, j) => gjrResiduals(H.map((r) => r[j]), g));
  const ms = raw.map((z) => ({ m: mean(z), s: std(z) || 1 }));
  const Z = H.map((_, t) => raw.map((z, j) => (z[t] - ms[j].m) / ms[j].s));
  return { names, fits: fits.map((g) => ({ mu: g.mu, omega: g.omega, alpha: g.alpha, gamma: g.gamma, beta: g.beta, lastVar: g.lastVar })), Z, market: names.indexOf("market"), rates: names.indexOf("rates"), sector: names.indexOf("energy"), months: months.length, from: months[0] ?? "", to: months[months.length - 1] ?? "" };
}

/** Operating parameters from the company's history and its quarters' revenue against the market. Pure. */
export function operatingFrom(c: LabInputs, marketByQuarter: Map<string, number>, quarterEnds: string[]): OperatingParams {
  const growthQ = Math.log(1 + Math.max(-0.05, Math.min(0.15, c.growth))) / 4;
  const pairs: { g: number; m: number }[] = [];
  for (let k = 1; k < c.quarters.length; k++) {
    const m = marketByQuarter.get(quarterEnds[k]?.slice(0, 7) ?? "");
    if (c.quarters[k] > 0 && c.quarters[k - 1] > 0 && m !== undefined) pairs.push({ g: Math.log(c.quarters[k] / c.quarters[k - 1]), m });
  }
  let beta = 0.5, residuals: number[] = [], residSd = Math.max(0.02, c.growthVol / 2);
  if (pairs.length >= 8) {
    const f = ols(pairs.map((p) => p.g), pairs.map((p) => [p.m]));
    const n = pairs.length;
    // Shrunk toward 0.5 (a typical revenue beta) by the number of quarters: few quarters say little.
    beta = Math.max(-0.5, Math.min(2, f.beta[1] * (n / (n + 8)) + 0.5 * (8 / (n + 8))));
    residuals = f.resid.map((r) => r - mean(f.resid));
    residSd = Math.max(0.01, std(residuals));
  }
  return {
    revenue0: c.revenue, ebitda0: c.ebitda, growthQ, betaMarket: beta, betaSector: 0, residSd, residuals, fixedShare: 0.3, costInflQ: Math.log(1.025) / 4, marginKappa: 0.25, marginSd: Math.max(0.003, c.marginVol / 2),
    source: `${c.source}: revenue grows ${(c.growth * 100).toFixed(1)}% a year at the median, with a market beta of ${beta.toFixed(2)}${pairs.length >= 8 ? ` from ${pairs.length} quarters (shrunk toward 0.5)` : " (a stated default: too few quarters to estimate)"} and ${residuals.length >= 8 ? "its own quarters' residuals resampled" : `idiosyncratic quarters of ${(residSd * 100).toFixed(1)}%`}; costs are 30% fixed (fixed costs rise 2.5% a year); margins carry a mean-reverting shock`,
  };
}

/** The company's inputs from XBRL: the last fiscal year, its ratios, its growth and margin history, and its quarters' revenue. */
async function companyInputs(ticker: string): Promise<LabInputs & { quarterEnds: string[] }> {
  const t = await resolveTicker(ticker);
  if (!t) throw Object.assign(new Error(`No SEC filer has the ticker ${ticker}.`), { status: 404 });
  const cf: CompanyFacts = await getCompanyFactsFull(t.cik);
  const subs = await getSubmissions(String(t.cik)).catch(() => null);
  const rev = annual(cf, ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense"]);
  const oi = annual(cf, ["OperatingIncomeLoss"]);
  const da = annual(cf, ["DepreciationDepletionAndAmortization", "DepreciationAndAmortization", "DepreciationAmortizationAndAccretionNet"]);
  const capex = annual(cf, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]);
  const ends = [...rev.keys()].sort().slice(-7);
  if (ends.length < 2) throw Object.assign(new Error(`${t.name} does not have enough annual revenue in its XBRL filings; type the figures in instead.`), { status: 422 });
  const last = ends[ends.length - 1];
  const E = (e: string) => (oi.has(e) && da.has(e) ? oi.get(e)! + da.get(e)! : null);
  const ebitda = E(last);
  if (!ebitda || ebitda <= 0) throw Object.assign(new Error(`${t.name}'s EBITDA (operating income plus D&A) is not positive in its last fiscal year; type an adjusted figure in instead.`), { status: 422 });
  const growths = ends.slice(1).map((e, i) => rev.get(e)! / rev.get(ends[i])! - 1).filter(Number.isFinite);
  const margins = ends.map((e) => (E(e) !== null ? E(e)! / rev.get(e)! : NaN)).filter(Number.isFinite);
  const qRows = (() => {
    for (const c of ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "SalesRevenueNet"]) {
      const raw = cf.facts["us-gaap"]?.[c]?.units?.USD;
      if (!raw?.length) continue;
      const rows = normalize(raw).filter((r: Fact) => r.start && r.days >= 80 && r.days <= 100);
      const byEnd = new Map<string, number>();
      for (const r of rows.sort((a, b) => a.filed.localeCompare(b.filed))) if (!byEnd.has(r.end)) byEnd.set(r.end, r.val);
      if (byEnd.size >= 6) return [...byEnd.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-28);
    }
    return [] as [string, number][];
  })();
  const sorted = [...growths].sort((a, b) => a - b);
  return {
    name: t.name, ticker: t.ticker, sic: subs?.sic ?? "", revenue: rev.get(last)!, ebitda, fy: last,
    capexPct: capex.has(last) ? (capex.get(last)! / ebitda) * 100 : 40, daPct: da.has(last) ? (da.get(last)! / ebitda) * 100 : 30,
    growth: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0.03, growthVol: growths.length >= 2 ? std(growths) : 0.08, marginVol: margins.length >= 3 ? std(margins) : 0.03,
    quarters: qRows.map(([, v]) => v), quarterEnds: qRows.map(([e]) => e),
    source: `${t.name}'s XBRL filings (fiscal year to ${last})`,
  };
}

const ENERGY_SIC = /^(13|29|46|49)/;
const clampN = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };

export type LabMeta = {
  title: string; name: string; ticker: string; synthetic: true; recipe: string; seed: number; paths: number;
  inputs: LabInputs & { sourcesUses: ReturnType<typeof sourcesUses> }; entry: { multiple: number; source: string; band: string | null };
  exit: ExitParams; rates: Pick<RateModel, "source" | "start" | "basis" | "rho">; spread: SpreadParams; macro: { names: string[]; months: number; from: string; to: string };
  assumptions: string[]; realism: { score: number; warnings: string[] } | null; structure: Structure;
};

/** Turn a request into the simulation's parameters and the run's labels. */
export async function buildSpec(req: LabRequest, paths: number): Promise<{ spec: StressSpec; meta: Omit<LabMeta, "realism" | "paths"> }> {
  const c: LabInputs & { quarterEnds: string[] } = req.ticker ? await companyInputs(req.ticker.toUpperCase()) : (() => {
    const m = req.manual;
    if (!m || !(m.revenue > 0) || !(m.ebitda > 0) || m.ebitda >= m.revenue) throw Object.assign(new Error("Give a ticker, or the target's revenue and EBITDA (EBITDA positive and below revenue)."), { status: 400 });
    return { name: m.name || "Private target", ticker: "", sic: m.sic ?? "", revenue: m.revenue, ebitda: m.ebitda, capexPct: m.capexPct ?? 40, daPct: m.daPct ?? 30, growth: m.growth ?? 0.04, growthVol: 0.08, marginVol: 0.03, quarters: [], quarterEnds: [], fy: "", source: "figures typed in for a private target" };
  })();
  const years = Math.round(clampN(req.years, 5, 2, 7));
  // Entry and exit multiples from the deal database: similar sponsor deals first, then sponsor deals in the SIC.
  let entrySource = "a stated default of 10.0x (the deal database has no comparable sponsor deals yet)", entry = 10, band: string | null = null;
  let exit: ExitParams = { base: 10, sigma: 0.2, elasticity: 0.5, n: 0, source: "a stated default (no comparable sponsor deals in the deal database yet): 10.0x with a 20% log spread" };
  try {
    const q = req.ticker ? await buildQuery({ ticker: req.ticker.toUpperCase(), buyerType: "sponsor" }) : null;
    const sim = q ? await similarDeals(q, { buyer: "sponsor" }, 20) : null;
    const ev = sim?.range.evEbitda;
    if (ev && ev.n >= 3) { entry = ev.median; entrySource = `the median EV/EBITDA of ${ev.n} similar sponsor deals in the deal database (interquartile ${ev.p25.toFixed(1)}x to ${ev.p75.toFixed(1)}x)`; band = bandSentence(sim!.range.band); }
    const xm = await exitMultiples({ sic: c.sic.slice(0, 2) || undefined, buyerType: "sponsor", years: 10 });
    const st = xm.stats;
    if (st && xm.n >= 3) exit = { base: st.median, sigma: Math.max(0.08, Math.min(0.5, (Math.log(st.p75) - Math.log(st.p25)) / 1.349)), elasticity: 0.5, n: xm.n, source: `sponsor deals in the deal database${c.sic ? ` (SIC ${c.sic.slice(0, 2)}xx)` : ""} over ten years: median ${st.median.toFixed(1)}x EV/EBITDA, interquartile ${st.p25.toFixed(1)}x to ${st.p75.toFixed(1)}x (${xm.n} deals)` };
    else if (ev && ev.n >= 3) exit = { base: ev.median, sigma: Math.max(0.08, Math.min(0.5, (Math.log(ev.p75) - Math.log(ev.p25)) / 1.349)), elasticity: 0.5, n: ev.n, source: `the similar sponsor deals' EV/EBITDA (median ${ev.median.toFixed(1)}x, ${ev.n} deals)` };
  } catch (e) { logError(e, { where: "edge-lbo-multiples" }); }
  if (req.entryMultiple) { entry = clampN(req.entryMultiple, entry, 2, 40); entrySource = "the entry multiple you set"; }
  if (req.exitMultiple) exit = { ...exit, base: clampN(req.exitMultiple, exit.base, 2, 40), source: `the exit multiple you set (spread from ${exit.n ? "the deal database" : "the default"})` };
  if (req.exitElasticity !== undefined) exit = { ...exit, elasticity: clampN(req.exitElasticity, 0.5, 0, 2) };
  const tranches = (req.tranches?.length ? req.tranches : defaultTranches()).slice(0, 6).map((t) => ({ ...t, turns: clampN(t.turns, 0, 0, 10) }));
  const structure: Structure = {
    ebitda0: c.ebitda, entryMultiple: entry, tranches, financeFeePct: clampN(req.financeFeePct, 2, 0, 6), txnFeePct: clampN(req.txnFeePct, 2, 0, 6), minCash: clampN(req.minCash, Math.round(c.ebitda * 0.1), 0, c.ebitda * 5),
    daPct: clampN(c.daPct, 30, 0, 90), capexPct: clampN(c.capexPct, 40, 0, 150), nwcPct: clampN(req.nwcPct, 10, 0, 100), tax: clampN(req.tax, 25, 0, 40), sweep: clampN(req.sweep, 75, 0, 100),
    years, periodsPerYear: 4, covenants: req.covenants ?? defaultCovenants(tranches),
  };
  const su = sourcesUses(structure);
  const energy = ENERGY_SIC.test(c.sic);
  const names: ("market" | "rates" | "energy")[] = energy ? ["market", "rates", "energy"] : ["market", "rates"];
  const { months, H } = monthlyFactors(await factorHistory(), names);
  if (H.length < 60) throw Object.assign(new Error("The factor history is not available right now; try again shortly."), { status: 503 });
  const macro = macroFrom(months, H, names);
  const mByQ = new Map<string, number>();
  for (let k = 2; k < months.length; k++) mByQ.set(months[k], H[k][0] + H[k - 1][0] + H[k - 2][0]);
  const op = operatingFrom(c, mByQ, c.quarterEnds);
  const rates = await rateModel();
  const spread: SpreadParams = { ...DEFAULT_SPREAD, ...(req.spread ?? {}) };
  const seed = Math.floor(clampN(req.seed, Math.floor(Math.random() * 900_000) + 1, 1, 999_999));
  const spec: StressSpec = { structure, macro, rates, op, exit, spread, paths, seed, hurdle: clampN(req.hurdle, 0.2, 0, 0.6), confidence: clampN(req.confidence, 0.6, 0.5, 0.95), breakYear: Math.round(clampN(req.breakYear, Math.min(3, years), 1, years)) };
  const assumptions = [
    `Macro: ${names.join(", ")} factors, GJR-GARCH(1,1)-t per factor with filtered historical simulation on ${macro.months} months (${macro.from} to ${macro.to}).`,
    `Rates: ${rates.source}.`, `Operating: ${op.source}.`, `Exit multiple: ${exit.source}; it moves with the market over the hold at an elasticity of ${exit.elasticity.toFixed(2)} (an assumption you can change).`,
    `Refinancing spread on revolver draws: ${spread.baseBps}bp plus ${spread.slopeBpsPerPct}bp per 1% equity drawdown, capped at ${spread.capBps}bp; ${spread.source}.`,
    `Entry multiple: ${entrySource}.`,
  ];
  const recipe = `${paths.toLocaleString("en-US")} SYNTHETIC paths, quarterly over ${years} years, seed ${seed}. ${assumptions.join(" ")}`;
  return {
    spec,
    meta: {
      title: `LBO stress: ${c.name}`, name: c.name, ticker: c.ticker, synthetic: true, recipe, seed, inputs: { ...c, sourcesUses: su }, entry: { multiple: entry, source: entrySource, band },
      exit, rates: { source: rates.source, start: rates.start, basis: rates.basis, rho: rates.rho }, spread, macro: { names, months: macro.months, from: macro.from, to: macro.to }, assumptions, structure,
    },
  };
}

export type LabResult = LabMeta & { kind: "lbo"; result: StressResult; refined: boolean; ranOn: string };

/** The 1,000-path preview (free): simulate, run, summarise, and check the macro paths' realism against history. */
export async function runLab(req: LabRequest): Promise<LabResult> {
  const { spec, meta } = await buildSpec(req, 1000);
  const set = simulatePaths(spec);
  const result = runStress(spec, set);
  let realism: LabMeta["realism"] = null;
  try {
    const H = spec.macro.Z.length ? await monthlyH(spec) : null;
    if (H) { const r = stylisedRealism(spec.macro.names, H, set.sample.slice(0, 120), { resamples: 60 }); realism = { score: r.score, warnings: r.warnings.slice(0, 3) }; }
  } catch (e) { logError(e, { where: "edge-lbo-realism" }); }
  return { ...meta, kind: "lbo", paths: spec.paths, realism, result, refined: false, ranOn: "the app (preview)" };
}

async function monthlyH(spec: StressSpec): Promise<number[][]> {
  return monthlyFactors(await factorHistory(), spec.macro.names as ("market" | "rates" | "energy")[]).H;
}

/** The refine's per-path outcomes summarised the same way as the preview (from the ML service or the job). Pure. */
export function refinedResult(spec: StressSpec, o: Outcomes, maxPrice: StressResult["maxPrice"]): StressResult {
  return summarise(spec, o, maxPrice);
}

/* ---------------- Refine (premium edge.lbo-refine): 20,000 paths, up to seven years ---------------- */

const REFINE_PATHS = 20_000;

/**
 * Start a refine of a saved LBO scenario: 20,000 paths on the ML service (lbo.refine) when it and R2 are set
 * up, returning its call to wait on; otherwise run here and finish. The person's plan was checked by the
 * route; background callers re-check it (canUseById) before calling.
 */
export async function startLabRefine(userId: string, id: number, opts: { inline?: boolean } = {}): Promise<{ done: true } | { callId: string; specKey: string }> {
  const s = await getScenario(userId, id);
  if (!s || s.kind !== "lbo") throw Object.assign(new Error("Only LBO stress tests can be refined this way."), { status: 400 });
  const req = s.spec as unknown as LabRequest & { seed: number };
  await updateScenario(id, { status: "refining" });
  const { spec, meta } = await buildSpec({ ...req, seed: req.seed }, REFINE_PATHS);
  if (!opts.inline && mlReady() && r2Ready()) {
    const specKey = `scen/lbo/spec-${id}-${Date.now()}.json`;
    await putJson(specKey, { spec, meta });
    const callId = await mlStart("lbo.refine", { ...spec, outKey: `ml/lbo/refine-${id}-${Date.now()}` }, `scenario:${id}`);
    return { callId, specKey };
  }
  const set = simulatePaths(spec);
  const result = runStress(spec, set);
  const prev = (s.result ?? {}) as Partial<LabResult>;
  await updateScenario(id, { status: "ready", result: { ...meta, kind: "lbo", paths: spec.paths, realism: prev.realism ?? null, result, refined: true, ranOn: "the background job (the ML service is not set up)" } });
  return { done: true };
}

/** Finish an ML-service refine: the per-path outcomes summarised exactly as the preview's. */
export async function finishLabRefine(userId: string, id: number, specKey: string, done: MlDone | null): Promise<void> {
  const s = await getScenario(userId, id);
  if (!s) return;
  try {
    if (!done?.ok || !done.result) throw new Error(done?.error ?? "The ML service did not answer in time.");
    const saved = await getJson<{ spec: StressSpec; meta: Omit<LabMeta, "realism" | "paths"> }>(specKey);
    const out = await getJson<{ paths: number; outcomes: Outcomes; maxPrice: StressResult["maxPrice"] }>(String((done.result as { key?: string }).key ?? ""));
    if (!saved || !out?.outcomes?.irr?.length) throw new Error("The refine returned no paths.");
    const result = refinedResult(saved.spec, out.outcomes, out.maxPrice);
    const prev = (s.result ?? {}) as Partial<LabResult>;
    await updateScenario(id, { status: "ready", result: { ...saved.meta, recipe: saved.meta.recipe.replace(/^[\d,]+ SYNTHETIC paths/, `${out.paths.toLocaleString("en-US")} SYNTHETIC paths`), kind: "lbo", paths: out.paths, realism: prev.realism ?? null, result, refined: true, ranOn: "the ML service (lbo.refine)" } });
  } catch (e) {
    logError(e, { where: "edge-lbo-refine" });
    await updateScenario(id, { status: "preview" });
  }
}

/** A request from the page or a canvas, cleaned: numbers clamped, tranches checked. Pure. */
export function cleanRequest(b: Record<string, unknown>): LabRequest {
  const n = (v: unknown, lo: number, hi: number) => { const x = Number(v); return Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined; };
  const kinds = new Set(["tlb", "notes", "second", "revolver"]);
  const tranches = Array.isArray(b.tranches) ? (b.tranches as Record<string, unknown>[]).slice(0, 6).filter((t) => t && kinds.has(String(t.kind))).map((t): Tranche => ({
    name: String(t.name ?? t.kind).slice(0, 40), kind: String(t.kind) as Tranche["kind"], turns: n(t.turns, 0, 10) ?? 0, floating: t.floating === true,
    spreadBps: n(t.spreadBps, 0, 2000), floorPct: n(t.floorPct, 0, 5), oid: n(t.oid, 90, 100), fixedPct: n(t.fixedPct, 0, 25), amortPct: n(t.amortPct, 0, 20), prepayable: t.prepayable !== false,
  })) : undefined;
  const c = b.covenants as Record<string, unknown> | undefined;
  const covenants: Covenants | undefined = c ? { maxNetLeverage: c.maxNetLeverage === null ? null : n(c.maxNetLeverage, 1, 15) ?? null, minInterestCover: c.minInterestCover === null ? null : n(c.minInterestCover, 0.5, 10) ?? null, springing: c.springing === true, springAt: n(c.springAt, 0, 1) ?? 0.35 } : undefined;
  const m = b.manual as Record<string, unknown> | undefined;
  const ticker = typeof b.ticker === "string" && /^[A-Za-z][A-Za-z0-9.\-]{0,9}$/.test(b.ticker) ? b.ticker.toUpperCase() : undefined;
  return {
    ...(ticker ? { ticker } : {}),
    ...(!ticker && m ? { manual: { name: String(m.name ?? "Private target").slice(0, 80), revenue: n(m.revenue, 0, 1e7) ?? 0, ebitda: n(m.ebitda, 0, 1e7) ?? 0, capexPct: n(m.capexPct, 0, 150), daPct: n(m.daPct, 0, 90), growth: n(m.growth, -0.2, 0.4), sic: typeof m.sic === "string" ? m.sic.slice(0, 4) : undefined } } : {}),
    entryMultiple: n(b.entryMultiple, 2, 40), exitMultiple: n(b.exitMultiple, 2, 40), exitElasticity: n(b.exitElasticity, 0, 2), tranches, covenants,
    sweep: n(b.sweep, 0, 100), years: n(b.years, 2, 7), minCash: n(b.minCash, 0, 1e6), financeFeePct: n(b.financeFeePct, 0, 6), txnFeePct: n(b.txnFeePct, 0, 6), tax: n(b.tax, 0, 40), nwcPct: n(b.nwcPct, 0, 100),
    spread: b.spread && typeof b.spread === "object" ? { baseBps: n((b.spread as Record<string, unknown>).baseBps, 0, 2000), slopeBpsPerPct: n((b.spread as Record<string, unknown>).slopeBpsPerPct, 0, 200), capBps: n((b.spread as Record<string, unknown>).capBps, 0, 4000) } as Partial<SpreadParams> : undefined,
    hurdle: n(b.hurdle, 0, 0.6), confidence: n(b.confidence, 0.5, 0.95), breakYear: n(b.breakYear, 1, 7), seed: n(b.seed, 1, 999_999),
  };
}
