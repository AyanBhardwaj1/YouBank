/**
 * Checks for the inference library behind the terminal, the CRM and Studio: statistics, forecasting,
 * credit, knowledge tracing, survival, relationship and pipeline models, Monte Carlo with correlated
 * inputs, and the terminal's command parser. No network.   pnpm exec tsx scripts/test-inference.ts
 */
import { parseCommand } from "@/lib/functions";
import { impliedRating, emsRating, mortalityFor, ohlsonO, pdRating } from "@/lib/inference/credit";
import type { Annual } from "@/lib/inference/fundamentals";
import { calibratedPriors, dealWinProbability, engagement, interestMean, relationshipStrength, simulatePipeline, talkingPoints, traceTopics } from "@/lib/inference/crm";
import { forecast } from "@/lib/inference/forecast";
import { recessionProbability, sahmRule } from "@/lib/inference/macro";
import { cholesky, drawInputs, quantileOf, spearman } from "@/lib/inference/montecarlo";
import { kupiec, normalSampler, parkinsonVol, rng, welchBeta } from "@/lib/inference/stats";
import { conditionalHazard, kaplanMeier, nudgeDay, poissonBinomial, survivalAt } from "@/lib/inference/survival";
import { ASSISTED_BKT, bktUpdate, DEFAULT_BKT, hintLevel, nextSkills, type SkillState } from "@/lib/inference/tracing";
import { Engine } from "@/lib/studio/engine";
import { inferenceTools } from "@/lib/studio/inference-tools";
import { applyPatch, type Patch } from "@/lib/studio/ops";
import type { StudioDocData } from "@/lib/studio/types";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

async function main() {
  console.log("terminal commands");
  const cmd = (s: string) => { const r = parseCommand(s, "SNOW"); return r.ok ? r.command : { error: r.error }; };
  check("ticker and function", JSON.stringify(cmd("ddog comps")) === JSON.stringify({ ticker: "DDOG", fn: "COMPS" }));
  check("market function drops the ticker", JSON.stringify(cmd("SNOW WEI")) === JSON.stringify({ ticker: "", fn: "WEI" }));
  check("screen in words keeps its case", (cmd("EQS growing over 20%") as { arg?: string }).arg === "growing over 20%");
  check("a ticker that is also a code works before a function", JSON.stringify(cmd("PG DES")) === JSON.stringify({ ticker: "PG", fn: "DES" }));
  check("PORT keeps MA as a holding", (cmd("PORT MA 40 V 30") as { fn?: string }).fn === "PORT");
  check("unknown function is an error", "error" in cmd("SNOW FOO"));

  console.log("statistics");
  const u = rng(3), z = normalSampler(u);
  const mkt = Array.from({ length: 260 }, () => 0.01 * z());
  const stock = mkt.map((m) => 1.4 * m + 0.008 * z());
  const wb = welchBeta(mkt, stock)!;
  check("Welch beta recovers a clean beta of 1.4", near(wb.beta, 1.4, 0.15), wb);
  const jumpy = stock.map((s, i) => (i === 200 ? s + 0.25 : s));
  check("a single 25% jump barely moves the Welch beta", near(welchBeta(mkt, jumpy)!.beta, wb.beta, 0.1));
  check("Kupiec: the expected count is not rejected", kupiec(12, 250, 0.95).pValue > 0.5);
  check("Kupiec: triple the expected count is rejected", kupiec(38, 250, 0.95).pValue < 0.01);
  check("Parkinson volatility of a 2x range is about 42%", near(parkinsonVol(200, 100)!, Math.log(2) / Math.sqrt(4 * Math.LN2), 1e-9) && near(parkinsonVol(200, 100)!, 0.416, 0.01));

  console.log("forecasting");
  const season = [1.1, 0.9, 1.0, 1.3];
  const y = Array.from({ length: 28 }, (_, t) => (100 + 3 * t) * season[t % 4] * (1 + 0.02 * z()));
  const f = forecast(y, 4, { period: 4 });
  check("seasonality found in a quarterly series", f.seasonal);
  check("the forecast keeps the Q4 peak", f.point[3] > f.point[2] && f.point[3] > f.point[1]);
  check("80% band nests inside the 95% band", f.point.every((p, i) => f.lower95[i] <= f.lower80[i] && f.lower80[i] <= p && p <= f.upper80[i] && f.upper80[i] <= f.upper95[i]));
  check("the backtest ran", f.backtest.origins >= 8 && f.backtest.mape !== null && f.backtest.mape < 0.1, f.backtest);

  console.log("credit");
  check("EMS at the AA/AA- median rates AA", emsRating(7.16 - 3.25) === "AA");
  check("EMS just above the midpoint to A+ rates AA", emsRating((7.16 + 6.85) / 2 + 0.01 - 3.25) === "AA");
  check("EMS just below it rates A+", emsRating((7.16 + 6.85) / 2 - 0.01 - 3.25) === "A+");
  check("a deeply negative Z'' is D", emsRating(-5) === "D");
  check("PD bands: 0.15% is BBB, 3% is B", pdRating(0.0015) === "BBB" && pdRating(0.03) === "B");
  check("mortality for BB+ uses the BB row", mortalityFor("BB+")?.year1 === 0.0092);
  const mega: Annual = { end: "2025-09-30", fy: 2025, revenue: 400e9, cogs: 220e9, grossProfit: 180e9, sga: 27e9, da: 11e9, ebit: 130e9, netIncome: 110e9, cfo: 120e9, capex: 12e9, interest: 3e9, pretax: 130e9, incomeTax: 20e9, totalAssets: 360e9, currentAssets: 150e9, currentLiabilities: 160e9, totalLiabilities: 285e9, retainedEarnings: -15e9, equity: 75e9, receivables: 60e9, inventory: 7e9, ppe: 45e9, ltDebt: 80e9, stDebt: 10e9, cash: 30e9, shares: 15e9 };
  const o = ohlsonO(mega, { ...mega, netIncome: 95e9 })!;
  check("Ohlson: a profitable mega-cap is well under 1% (SIZE in dollars over the price index)", o.pd < 0.01, o.pd);
  const r = impliedRating(mega, { ...mega, netIncome: 95e9 }, { marketCapUsd: 3e12, equityVol: 0.25, pastReturn: 0.1 });
  check("Z'' is left out when retained earnings are negative after buybacks", r.views.find((v) => v.method === "Altman Z''")?.excluded !== undefined);
  check("the implied rating is investment grade", r.grade === "investment", r.rating);
  const noDebt = impliedRating({ ...mega, ltDebt: null, stDebt: null }, null, { marketCapUsd: 1e11, equityVol: 0.4, pastReturn: 0, debtUsd: 0 });
  check("no borrowings: Merton gives the floor view", noDebt.views.some((v) => v.method.startsWith("Merton") && /No borrowings/.test(v.detail)));

  console.log("knowledge tracing");
  const t0 = new Date("2026-01-01T00:00:00Z");
  let st: SkillState | null = null;
  for (let i = 0; i < 3; i++) st = bktUpdate(st, true, new Date(t0.getTime() + i * 60_000));
  check("three typed uses master a function", st!.p >= 0.95, st);
  let clicked: SkillState | null = null;
  for (let i = 0; i < 3; i++) clicked = bktUpdate(clicked, true, new Date(t0.getTime() + i * 60_000), ASSISTED_BKT);
  check("clicking is weaker evidence than typing", clicked!.p < st!.p);
  const later = bktUpdate(st, false, new Date(t0.getTime() + 90 * 86_400_000));
  check("an error after months away drops mastery", later.p < 0.6, later);
  check("hints: full for a newcomer, none at mastery", hintLevel(DEFAULT_BKT.pInit) === "full" && hintLevel(0.97) === "none");
  const skills = [{ key: "A", weight: 1 }, { key: "B", weight: 1, requires: ["A"] }, { key: "C", weight: 1, requires: ["B"] }];
  check("next skills unlock only after prerequisites", JSON.stringify(nextSkills(skills, { A: { p: 0.97, n: 5, last: t0.toISOString() } }, t0, 3)) === JSON.stringify(["B"]));

  console.log("survival");
  const km = kaplanMeier([1, 2, 2, 3, 5, 8], [true, true, false, true, false, false]);
  // Day 2: five still at risk (one event, one censored there); day 3: three at risk.
  check("Kaplan-Meier steps", near(survivalAt(km, 1), 5 / 6, 1e-12) && near(survivalAt(km, 2), (5 / 6) * (4 / 5), 1e-12) && near(survivalAt(km, 3), (5 / 6) * (4 / 5) * (2 / 3), 1e-12), km);
  check("conditional hazard is zero past the last event", conditionalHazard(km, 5, 3) === 0);
  check("a nudge day exists", nudgeDay(km) !== null);
  const pb = poissonBinomial([0.1, 0.5, 0.9]);
  check("Poisson-binomial sums to one", near(pb.reduce((a, b) => a + b, 0), 1, 1e-12));
  check("Poisson-binomial mean is the sum of p", near(pb.reduce((a, p, k) => a + k * p, 0), 1.5, 1e-12));

  console.log("relationships and pipeline");
  const now = new Date("2026-09-01T00:00:00Z");
  const recent = engagement([{ at: new Date("2026-08-30T00:00:00Z"), kind: "two-way" }], now), old = engagement([{ at: new Date("2026-03-01T00:00:00Z"), kind: "two-way" }], now);
  check("recent contact counts more than old", recent > old * 5);
  const rs = relationshipStrength(2, 1, 5, 5), lopsided = relationshipStrength(2, 1, 0, 10);
  check("reciprocity lifts strength", rs.score > lopsided.score && rs.score <= 100);
  const topics = traceTopics([
    { at: new Date("2026-06-01"), direction: "outbound", topics: ["fund iii"], reply: { topics: ["fund iii"] } },
    { at: new Date("2026-06-03"), direction: "inbound", topics: ["pricing"], asks: ["pricing"] },
  ], new Date("2026-06-10"));
  check("told and replied about: they know it", topics.get("fund iii")!.awareness > 0.85);
  check("asked about it: they do not", topics.get("pricing")!.awareness < 0.05);
  check("interest shrinks toward the base rate", near(interestMean({ a: 0, b: 0 }, 0.3), 0.3, 1e-12));
  const tp = talkingPoints([...topics.values()], new Map([["pricing", 1]]), 0.3, new Date("2026-06-10"), 1);
  check("talking points prefer what they do not know yet", tp[0].topic === "pricing", tp);
  const strong = dealWinProbability(0.4, { daysIdle: 5, overdue: false, strength: 90, recentInbound: true }), weak = dealWinProbability(0.4, { daysIdle: 90, overdue: true, strength: 10, recentInbound: false });
  check("engagement moves deal odds both ways", strong.p > 0.4 && weak.p < 0.4);
  check("calibration pulls priors toward the record", calibratedPriors({ a: 0.2, b: 0.4 }, 0, 30).priors.a < 0.2);
  const sim = simulatePipeline([{ id: 1, p: 0.5, amount: 10 }, { id: 2, p: 0.2, amount: 30 }, { id: 3, p: 0.9, amount: null }], 20_000);
  check("pipeline percentiles are ordered", !!sim.value && sim.value.p10 <= sim.value.p50 && sim.value.p50 <= sim.value.p90);
  check("simulated mean matches the weighted total", !!sim.value && near(sim.value.mean, 0.5 * 10 + 0.2 * 30, 0.3));
  check("expected wins is the sum of p", near(sim.wins.expected, 1.6, 1e-12));

  console.log("macro");
  check("New York Fed probit at a flat curve", near(recessionProbability(0), 0.2968, 1e-3));
  const unrate = [...Array(12).fill(3.6), 3.7, 3.9, 4.2, 4.4];
  check("Sahm rule triggers on a sharp rise", sahmRule(unrate)!.triggered);

  console.log("Monte Carlo");
  const draws = drawInputs([{ kind: "normal", mean: 0, sd: 1 }, { kind: "triangular", low: 0, mode: 1, high: 4 }], [[1, 0.8], [0.8, 1]], 20_000, 5);
  const rhoS = spearman(draws.map((d) => d[0]), draws.map((d) => d[1]));
  check("copula keeps the rank correlation (6/π asin(ρ/2))", near(rhoS, (6 / Math.PI) * Math.asin(0.4), 0.02), rhoS);
  check("marginals survive the copula", near(draws.reduce((a, d) => a + d[1], 0) / draws.length, 5 / 3, 0.03));
  check("PERT quantiles are monotone", quantileOf({ kind: "pert", low: 0, mode: 2, high: 10 }, 0.1) < quantileOf({ kind: "pert", low: 0, mode: 2, high: 10 }, 0.9));
  check("an impossible correlation matrix is refused", cholesky([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]]) === null);

  console.log("Studio Monte Carlo on a live model");
  const doc: StudioDocData = { workbook: { order: ["s1"], sheets: { s1: { id: "s1", name: "DCF", cells: { A1: { v: "FCF" }, B1: { v: 100 }, A2: { v: "WACC" }, B2: { v: 0.09 }, A3: { v: "g" }, B3: { v: 0.025 }, A4: { v: "Value" }, B4: { f: "B1*(1+B3)/(B2-B3)" } } } } }, deck: { order: [], slides: {} }, comments: [] } as unknown as StudioDocData;
  const engine = new Engine(doc.workbook);
  const committed: Patch[] = [];
  const tools = inferenceTools({ engine, doc, commit: async (ps) => { for (const p of ps) { applyPatch(doc, p, engine); committed.push(p); } }, guard: (fn) => fn() });
  const mc = tools.find((t) => t.name === "monte_carlo")!;
  const out = JSON.parse(await mc.run({ sheet: "DCF", outputs: ["B4"], inputs: [{ cell: "B2", label: "WACC", dist: "normal", mean: 0.09, sd: 0.01 }, { cell: "B3", label: "g", dist: "triangular", low: 0.01, mode: 0.025, high: 0.035 }], correlations: [{ a: "B2", b: "B3", rho: 0.5 }], draws: 2000, compare_to: 1500 }, { addSource: () => "" }) as string);
  check("outputs are ordered", out.outputs[0].p10 < out.outputs[0].p50 && out.outputs[0].p50 < out.outputs[0].p90, out.outputs[0]);
  // The base case is every input at its median; the triangular's median is not its mode.
  const gMedian = 0.01 + Math.sqrt(0.5 * 0.025 * 0.015);
  check("the base case is the model at the inputs' medians", near(out.base, (100 * (1 + gMedian)) / (0.09 - gMedian), 0.05), out.base);
  check("the inputs were not changed", engine.get("s1", "B2") === 0.09 && engine.get("s1", "B3") === 0.025);
  check("a Monte Carlo sheet was written", doc.workbook.order.some((id) => doc.workbook.sheets[id].name === "Monte Carlo"));
  check("WACC drives more of the spread than g", out.shareOfVariance[0].input === "WACC", out.shareOfVariance);
  const fcTool = tools.find((t) => t.name === "forecast_series")!;
  doc.workbook.sheets.s1.cells = { ...doc.workbook.sheets.s1.cells, ...Object.fromEntries(y.map((v, i) => [`C${i + 1}`, { v }])) };
  const e2 = new Engine(doc.workbook);
  const tools2 = inferenceTools({ engine: e2, doc, commit: async (ps) => { for (const p of ps) applyPatch(doc, p, e2); }, guard: (fn) => fn() });
  const fs = JSON.parse(await tools2.find((t) => t.name === "forecast_series")!.run({ sheet: "DCF", range: "C1:C28", horizon: 4, period: 4, write_to: "E1" }, { addSource: () => "" }) as string);
  check("forecast_series reads the model and writes a band", fs.point.length === 4 && typeof doc.workbook.sheets.s1.cells.F1?.v === "number" && !!fcTool);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
