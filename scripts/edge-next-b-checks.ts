/**
 * Checks for the second half of Edge's next round, run by scripts/test-edge-next.ts: Call Desk (E5), the LBO
 * Stress Lab (E6) and the Thesis Agent (E7), plus the Voice Analyst's router (E13). No network, no database:
 * parsers on the fixtures under scripts/fixtures/calls and scripts/fixtures/lbo, models on synthetic data with
 * known answers, the agent's runtime on an in-memory store with recorded tool outputs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { argmax, calibrated, fitCalibrator, macroF1, multiclassEce, pooled, probRose, ratePosterior, roseSentence, softmaxFit, softmaxLogits } from "@/lib/edge/calls/calibrate";
import { daysWindow, extractCommitments, guidanceQuestion, guidanceRule, hitProbability, outcomeOf, periodEnd, periodOf, POINT_TOLERANCE, valuesOf, withdrawsGuidance } from "@/lib/edge/calls/commitments";
import { classifyPair, dodgeQuote, ensemble, evasionModel, pairFeatures, scorecardLine, TAG_LABEL, tagsOf, topicOf } from "@/lib/edge/calls/evasion";
import { analystIntro, joinOverlap, looksLikeTranscript, pairQa, qaStart, speakerLine, turnsFromChunks, turnsFromText } from "@/lib/edge/calls/qa";
import { reportedFrom } from "@/lib/edge/calls/store";
import { derivedEbitda, pickReported, resolveXbrl } from "@/lib/edge/forecasts/rules";
import { calculatorStructure, irrOf, lboSchedule, steadyPath, type Structure } from "@/lib/edge/scen/lbo";
import { cleanRequest, defaultCovenants, defaultTranches, DEFAULT_SPREAD, macroFrom, monthlyFactors, operatingFrom } from "@/lib/edge/scen/lab";
import { DEFAULT_RATES, fitRates, monthEnds, rateStep, stationary } from "@/lib/edge/scen/rates";
import { floorKl, reverseStress } from "@/lib/edge/scen/reverse";
import { maxEntry, outcomesOf, probAbove, runStress, simulatePaths, spreadAt, summarise, type StressSpec } from "@/lib/edge/scen/stress";
import { normals, rng, std } from "@/lib/edge/scen/stats";
import { BANKER_PACK } from "@/lib/workflows/packs/banker";
import { buildMemo, whatChanged } from "@/lib/edge/agent/memo";
import { evalMonitor } from "@/lib/edge/agent/monitors";
import { cleanKills, monitorOk, scaleOdds, validatePlan, withPriors } from "@/lib/edge/agent/plan";
import { due, ESTIMATE, runTick, type AgentRow, type AgentStore, type Deps, type Step } from "@/lib/edge/agent/runtime";
import { callTool, type ToolDef } from "@/lib/edge/agent/tools";
import { emptyState, type AgentState, type ClaimState, type Plan } from "@/lib/edge/agent/types";
import { applyLadder, canSpend, combine, LADDER, nextTick, overall, recomputeTree, TICK_CAP } from "@/lib/edge/agent/update";
import { withFeatures } from "@/lib/billing/use";

type Check = (label: string, cond: boolean, detail?: unknown) => void;
const fx = (...p: string[]) => readFileSync(path.join(__dirname, "fixtures", ...p), "utf8");
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

export async function checksB(check: Check) {
  /* ======================= E5 Call Desk ======================= */
  console.log("E5 Call Desk: Q&A segmentation on the two fixture transcripts");
  {
    check("speaker lines: 'Name -- Title: text', 'Name, Title: text', 'Operator', ALL CAPS", speakerLine("Maria Chen -- Chief Financial Officer: Thank you.")?.speaker === "Maria Chen" && speakerLine("Maria Chen -- Chief Financial Officer: Thank you.")?.rest === "Thank you." && speakerLine("Sam Lee, Morgan Stanley: Thanks.")?.title === "Morgan Stanley" && speakerLine("Operator: Welcome")?.speaker === "Operator" && speakerLine("JANE DOE")?.speaker === "Jane Doe");
    check("not speaker lines: figures and headings with colons", speakerLine("Revenue: $4.2 billion") === null && speakerLine("Note: forward-looking statements") === null && speakerLine("This sentence is just a long line of prepared remarks that goes on and on without any speaker label at all, and it is longer than any name.") === null);
    check("the operator's introduction names the analyst and the firm", JSON.stringify(analystIntro("Our next question comes from Sam Lee with Morgan Stanley. Please go ahead.")) === JSON.stringify({ name: "Sam Lee", firm: "Morgan Stanley" }) && analystIntro("Our first question comes from the line of Priya Nair from Goldman Sachs.")?.firm === "Goldman Sachs");
    const filed = fx("calls", "transcript-filed.txt");
    const turns = turnsFromText(filed);
    check("a filed transcript becomes speaker turns", turns.length >= 15 && turns.some((t) => t.speaker === "Operator") && turns.some((t) => t.speaker === "Maria Chen"));
    check("the Q&A starts at the operator's cue", qaStart(turns) > 3 && /question-and-answer/.test(turns[qaStart(turns)].text));
    const pairs = pairQa(turns);
    check("four pairs: each analyst question with management's answer", pairs.length === 4 && pairs.map((p) => p.analyst).join(",") === "Sam Lee,Sam Lee,Priya Nair,Tom Baker", pairs.map((p) => p.analyst));
    check("firms come from the operator's introductions", pairs[0].firm === "Morgan Stanley" && pairs[2].firm === "Goldman Sachs");
    check("a second question by the same analyst is a follow-up", !pairs[0].followUp && pairs[1].followUp);
    check("answers are management's words, and the pair names who answered", pairs[0].answer.startsWith("Sure.") && pairs[0].answerers.join() === "Maria Chen" && pairs.every((p) => p.clear));
    const diar = JSON.parse(fx("calls", "transcript-diarized.json")) as { speaker: string; text: string; tStart: number }[];
    const dp = pairQa(turnsFromChunks(diar));
    check("a recording's turns keep the second each question starts", dp.length === 2 && dp[0].t === 101.2 && dp[0].analyst === "Lena Park" && dp[0].firm === "JPMorgan");
    check("an answer by an unnamed speaker makes the pair unclear (not scored)", dp[1].clear === false && dp[0].clear === true);
    check("a transcript is told from a press release", looksLikeTranscript(filed) && !looksLikeTranscript(fx("calls", "release.txt")));
    check("overlapping passages join without repeating words", joinOverlap("the plant came online on schedule and ahead", "on schedule and ahead of budget") === "the plant came online on schedule and ahead of budget");
  }

  console.log("E5 Call Desk: the evasion classifier, its calibration and the call's posterior");
  {
    const direct = classifyPair("Can you quantify how much margin expansion you expect next year, in basis points?", "Sure. We expect about 120 basis points of margin expansion next year, roughly half in the first quarter.");
    const dodge = classifyPair("What capex range are you assuming for 2027, in dollars?", "We don't provide guidance on that. We'll share more at our investor day. What I'd say is we remain focused on our long-term strategy.");
    check("a specific numeric answer to a numeric question scores direct", direct.cls === "direct" && direct.p.direct > 0.6, direct.p);
    check("a refusal with a deferral scores fully evasive", dodge.cls === "evasive" && dodge.p.evasive > 0.6, dodge.p);
    check("probabilities sum to one", near(dodge.p.direct + dodge.p.intermediate + dodge.p.evasive, 1, 1e-9));
    check("sub-tags: refused, deferred, no number given when one was asked", ["refused", "deferred", "no_number"].every((t) => dodge.tags.includes(t as never)), dodge.tags);
    check("the dodging phrase is a verbatim sentence of the answer", dodge.quote === "We don't provide guidance on that." && dodgeQuote("As I mentioned in my prepared remarks, we had a strong quarter. Thanks.").startsWith("As I mentioned"));
    check("a pivot to prepared remarks is tagged", tagsOf("How much did pricing add?", "As I said earlier on the call, we're pleased with pricing.").includes("prepared_remarks"));
    check("the words never say 'lie'", !Object.values(TAG_LABEL).some((l) => /\blie|lying|dishonest/i.test(l)) && !/\blie\b/i.test(scorecardLine()));
    check("features: a number asked and given; overlap with the question", pairFeatures("What is the margin target in percent?", "The margin target is 38% for next year.")[2] === 1 && pairFeatures("What is the margin target?", "Thanks for the question.")[7] < 0.2);
    check("topics for what was avoided", topicOf("What capex range are you assuming?") === "capital spending" && topicOf("Any M&A in the pipeline?") === "acquisitions");
    const m = evasionModel();
    check("the shipped classifier states its record and that its labels are a template set", m.features.length === 12 && m.metrics.n > 0 && m.metrics.macroF1 > 0.5 && /template set/.test(scorecardLine(m)), m.metrics);
    const eva = ensemble(direct, [0.1, 0.2, 0.7], "q", "a");
    check("the Eva-4B ensemble averages calibrated probabilities (and ignores a bad vector)", near(eva.p.evasive, (direct.p.evasive + 0.7) / 2, 1e-9) && /Eva-4B/.test(eva.engine) && ensemble(direct, [NaN, 0, 1], "q", "a") === direct);
    // Softmax regression and calibration on synthetic three-class data with known structure.
    const u = rng(5), n = normals(u);
    const X: number[][] = [], y: number[] = [];
    for (let i = 0; i < 600; i++) { const k = i % 3; X.push([k === 0 ? 2.5 + n() : k === 1 ? -1.5 + n() : n(), k === 2 ? 2.5 + n() : k === 1 ? -1.5 + n() : n()]); y.push(k); }
    const sm = softmaxFit(X.slice(0, 400), y.slice(0, 400), ["a", "b"], { iters: 400 });
    const pred = X.slice(400).map((x) => argmax(softmaxLogits(sm, x)));
    check("softmax regression separates three classes it can see", macroF1(pred, y.slice(400)) > 0.6, macroF1(pred, y.slice(400)));
    const over = X.slice(400).map((x) => softmaxLogits(sm, x).map((v) => v * 4));
    const cal = fitCalibrator(over, y.slice(400), { isotonic: false });
    check("temperature scaling cools overconfident logits (T > 1)", cal.temperature > 1.5, cal.temperature);
    const P = over.map((l) => calibrated(cal, l));
    const ll = (Q: number[][]) => -Q.reduce((a, p, k) => a + Math.log(Math.max(1e-12, p[y[400 + k]])), 0) / Q.length;
    const raw = over.map((l) => { const e = l.map((x) => Math.exp(x - Math.max(...l))); const t = e.reduce((a, b) => a + b, 0); return e.map((x) => x / t); });
    check("calibrated probabilities sum to one and lower the log loss of overconfident ones", P.every((p) => near(p.reduce((a, b) => a + b, 0), 1, 1e-9)) && ll(P) < ll(raw) && multiclassEce(P, y.slice(400)) < 0.2, { cal: ll(P), raw: ll(raw) });
    check("macro-F1 on a known case", near(macroF1([0, 0, 1, 2], [0, 1, 1, 2]), (2 / 3 + 2 / 3 + 1) / 3, 1e-9));
    const post = ratePosterior(new Array(10).fill(0.5));
    check("the call's Beta-binomial posterior: Beta(1,4) prior plus 5 expected evasive of 10", near(post.a, 6, 1e-9) && near(post.b, 9, 1e-9) && post.low < post.mean && post.mean < post.high);
    check("P(rate rose) is a half for equal posteriors, near one for a clear rise", near(probRose({ a: 6, b: 9 }, { a: 6, b: 9 }), 0.5, 0.01) && probRose({ a: 20, b: 10 }, { a: 5, b: 25 }) > 0.99 && probRose({ a: 5, b: 25 }, { a: 20, b: 10 }) < 0.01);
    const before = pooled([{ expected: 2, n: 20 }, { expected: 3, n: 20 }]);
    check("earlier calls pool into one posterior", before.a === 6 && before.b === 39);
    check("'rose' is said only at a probability of 0.9 or more", /probability that the rate rose is 0\.95/.test(roseSentence(0.95, post, before, 2)) && /not a clear rise/.test(roseSentence(0.7, post, before, 2)));
  }

  console.log("E5 Call Desk: the commitments ledger, parsed and settled against XBRL");
  {
    const c = extractCommitments(fx("calls", "transcript-filed.txt"), "2026-11-04");
    const rev = c.find((x) => x.metric === "revenue"), ebitda = c.find((x) => x.metric === "ebitda"), capex = c.find((x) => x.metric === "capex"), eps = c.find((x) => x.metric === "eps"), prod = c.find((x) => x.metric === "production");
    check("revenue guidance '$4.2 billion to $4.4 billion' for full-year 2026", rev?.low === 4.2e9 && rev.high === 4.4e9 && rev.period?.fy === 2026 && !rev.period.q && rev.mapped);
    check("two metrics in one sentence are both read (EBITDA $1.10-1.20 billion)", ebitda?.low === 1.1e9 && ebitda.high === 1.2e9);
    check("'approximately $650 million' is a point read with a stated 2% tolerance", near(capex!.low!, 650e6 * (1 - POINT_TOLERANCE), 1) && near(capex!.high!, 650e6 * (1 + POINT_TOLERANCE), 1));
    check("EPS per share for the fourth quarter of 2026", eps?.unit === "usd_per_share" && eps.low === 0.52 && eps.high === 0.58 && eps.period?.q === 4 && eps.period.fy === 2026);
    check("production is listed but not scored (no standard XBRL concept)", prod?.mapped === false && prod.low === 550_000 && prod.period?.fy === 2027);
    check("'mid-single-digit growth' has no number: unmapped", extractCommitments("We expect mid-single-digit revenue growth in 2027.", "2026-11-04")[0]?.mapped === false);
    check("past results are not promises", extractCommitments(fx("calls", "release.txt"), "2026-08-05").every((x) => x.low === 1.8e9));
    check("periods: quarters, fiscal years, next year", JSON.stringify(periodOf("For the second quarter of 2027, we expect", "2026-11-04")) === JSON.stringify({ fy: 2027, q: 2 }) && periodOf("FY26 guidance", "2025-11-01")?.fy === 2026 && periodOf("next year we expect", "2026-03-01")?.fy === 2027);
    check("growth ranges are read as fractions", JSON.stringify(valuesOf("revenue growth of 5% to 7%", "revenue")) === JSON.stringify({ low: 0.05, high: 0.07, unit: "pct_growth", point: false }));
    check("period ends from the fiscal year end", periodEnd({ fy: 2026 }) === "2026-12-31" && periodEnd({ fy: 2026, q: 2 }) === "2026-06-30" && periodEnd({ fy: 2026 }, "0630") === "2026-06-30" && periodEnd({ fy: 2026, q: 1 }, "0630") === "2025-09-30" && periodEnd({ fy: 2026, q: 4 }, "0928") === "2026-09-30");
    const rule = guidanceRule(rev!, "1234", "Revenues", "USD", "1231")!;
    check("the ledger rule names the concept, period, window and range", rule.type === "xbrl" && rule.op === "between" && rule.value === 4.2e9 && rule.high === 4.4e9 && rule.period === "2026-12-31" && JSON.stringify(rule.days) === JSON.stringify(daysWindow({ fy: 2026 })));
    const rows = [{ end: "2026-12-31", val: 1.1e9, filed: "2027-02-01", days: 92 }, { end: "2026-12-31", val: 4.31e9, filed: "2027-02-20", days: 365 }, { end: "2025-12-31", val: 3.9e9, filed: "2026-02-20", days: 365 }];
    const got = pickReported(rows, rule);
    check("the reported value is the fiscal year's, not the fourth quarter ending the same day", got?.value === 4.31e9 && resolveXbrl(rule, got.value) === 1);
    check("a 52/53-week year ending a few days off still settles", pickReported([{ end: "2026-12-27", val: 4.1e9, filed: "2027-02-20", days: 364 }], rule)?.value === 4.1e9 && resolveXbrl(rule, 4.1e9) === 0);
    check("a miss is measured outside the range", JSON.stringify(outcomeOf(rule, 3.99e9)) === JSON.stringify({ status: "missed_low", missPct: (4.2e9 - 3.99e9) / 4.2e9 }) && outcomeOf(rule, 4.3e9).status === "hit" && outcomeOf(rule, 4.62e9).status === "missed_high");
    check("EBITDA is derived from operating income plus D&A for the same period", derivedEbitda({ value: 800, end: "2026-12-31" }, { value: 350, end: "2026-12-31" })?.value === 1150 && derivedEbitda({ value: 800, end: "2026-12-31" }, { value: 350, end: "2026-09-30" }) === null);
    const hp = hitProbability(8, 2);
    check("the hit probability starts at the 60% prior and learns from the record", near(hitProbability(0, 0).p, 0.6, 1e-9) && near(hp.p, 14 / 20, 1e-9) && hp.low < hp.p && hp.p < hp.high);
    check("the question in words, and the resolver's value read back", guidanceQuestion("Acme Midstream", "ACME", rev!) === "Acme Midstream (ACME) reports FY2026 revenue between $4.20bn and $4.40bn" && reportedFrom("SEC XBRL Revenues for the period ending 2026-12-31: 4310000000") === 4.31e9);
    check("withdrawn guidance is recognised", withdrawsGuidance("The company is withdrawing its full-year guidance given the uncertainty.") && !withdrawsGuidance("We reaffirm our full-year guidance."));
  }

  /* ======================= E6 LBO Stress Lab ======================= */
  console.log("E6 LBO Stress Lab: the shared LBO engine");
  {
    const tool = BANKER_PACK.find((t) => t.id === "lbo-returns") as unknown as { compute: (i: Record<string, unknown>) => unknown };
    const cases = JSON.parse(fx("lbo", "calculator.json")) as { input: Record<string, unknown>; output: unknown }[];
    check("the Tools LBO calculator, now on the shared engine, gives exactly its outputs from before the refactor", cases.every((c) => JSON.stringify(tool.compute(c.input)) === JSON.stringify(c.output)));
    const i = cases[0].input as Record<string, number>;
    const st = calculatorStructure({ ebitda: i.ebitda, entryMultiple: i.entryMultiple, tlbTurns: i.tlbTurns, secondTurns: i.secondTurns, tlbSpread: i.tlbSpread, secondRate: i.secondRate, oid: i.oid, financeFeePct: i.financeFeePct, txnFeePct: i.txnFeePct, minCash: i.minCash, daPct: i.daPct, capexPct: i.capexPct, nwcPct: i.nwcPct, tax: i.tax, amortPct: i.amortPct, sweep: i.sweep, years: i.years });
    const r = lboSchedule(st, steadyPath(i.ebitda, i.growth / 100, i.sofr, i.exitMultiple, i.years));
    // The calculator's own loop, written out, to the cent.
    const e0 = i.ebitda, tlbRate = i.sofr / 100 + i.tlbSpread / 1e4 + (100 - i.oid) / 4 / 100;
    let tlb = i.tlbTurns * e0, sl = i.secondTurns * e0, cash = i.minCash, prev = e0;
    for (let yr = 1; yr <= i.years; yr++) {
      const e = e0 * Math.pow(1 + i.growth / 100, yr), int = tlb * tlbRate + sl * i.secondRate / 100, taxes = Math.max(0, e * (1 - i.daPct / 100) - int) * i.tax / 100;
      const fcf = e - int - taxes - e * i.capexPct / 100 - (e - prev) * i.nwcPct / 100, am = Math.min(tlb, i.tlbTurns * e0 * i.amortPct / 100);
      let pay = Math.max(0, fcf - am) * i.sweep / 100; tlb -= am; const a = Math.min(tlb, pay); tlb -= a; pay -= a; const b = Math.min(sl, pay); sl -= b; cash += fcf - am - a - b; prev = e;
    }
    check("on a zero-volatility yearly path the engine agrees with the calculator to the cent", near(r.rows.at(-1)!.balances[0], tlb, 0.005) && near(r.rows.at(-1)!.balances[1], sl, 0.005) && near(r.rows.at(-1)!.cash, cash, 0.005));
    const eng = JSON.parse(fx("lbo", "engine.json")) as { structure: Structure; path: { ebitda: number[]; sofr: number[]; exitMultiple: number; revolverSpreadBps?: number[] }; result: { irr: number; moic: number; firstBreach: number; defaulted: number } }[];
    check("the engine still gives the cross-language fixture's numbers (ml/lbo_core.py is checked against the same)", eng.every((c) => { const x = lboSchedule(c.structure, c.path); return near(x.irr, c.result.irr, 1e-12) && x.firstBreach === c.result.firstBreach && x.defaulted === c.result.defaulted; }));
    check("a springing covenant is tested only once the revolver is drawn past 35%", eng[2].result.firstBreach === 8 && lboSchedule({ ...eng[2].structure, covenants: { ...eng[2].structure.covenants, springing: false } }, eng[2].path).firstBreach < 8);
    check("a maintenance test breaches on the shocked path; the steady path never does", eng[1].result.firstBreach === 6 && eng[0].result.firstBreach === -1);
    check("a revolver draws to keep minimum cash; without capacity cash running out is a default", (() => { const deep = { ...eng[2].path, ebitda: eng[2].path.ebitda.map((v) => v * 0.3) }; const tiny = { ...eng[2].structure, tranches: eng[2].structure.tranches.map((t) => (t.kind === "revolver" ? { ...t, turns: 0.05 } : t)) }; return lboSchedule(tiny, deep).defaulted > 0; })());
    check("leverage beyond price plus fees is refused with a plain message", (() => { try { lboSchedule({ ...st, tranches: st.tranches.map((t) => ({ ...t, turns: 20 })) }, steadyPath(e0, 0, 4, 10, 5)); return false; } catch (e) { return /reduce the debt turns/.test((e as Error).message); } })());
    check("the IRR solver on known cash flows (10% a year over five years)", near(irrOf([-100, 0, 0, 0, 0, 161.051], [0, 1, 2, 3, 4, 5])!, 0.1, 1e-6) && irrOf([100, 50], [0, 1]) === null);
  }

  console.log("E6 LBO Stress Lab: rates, paths, the reverse stress test and the max price");
  {
    // A known two-regime AR(1), simulated, then fitted.
    const u = rng(11), n = normals(u);
    const levels: number[] = [];
    let r = 3, s = 0;
    for (let t = 0; t < 360; t++) { const g = s === 0 ? { mu: 3, phi: 0.05, sigma: 0.1 } : { mu: 2, phi: 0.1, sigma: 0.4 }; r = Math.max(0, r + g.phi * (g.mu - r) + g.sigma * n()); levels.push(r); s = u() < (s === 0 ? 0.04 : 0.8) ? 1 : 0; }
    const fit = fitRates(levels)!;
    check("the rate model fits two regimes, the stressed one more volatile, and both mean-revert", !!fit && stationary(fit) && fit.regimes[1].sigma > fit.regimes[0].sigma && near(fit.regimes[0].mu, 3, 1.2), fit?.regimes);
    const step = rateStep({ ...DEFAULT_RATES, start: 0.05, regimes: [{ mu: 0, phi: 0.5, sigma: 0.5 }, { mu: 0, phi: 0.5, sigma: 0.5 }] });
    const ur = rng(2), nr = normals(ur);
    check("simulated rates never go below zero", Array.from({ length: 500 }, () => step(nr(), ur, nr)).every((v) => v >= 0));
    // Realism: simulated monthly changes against a block-bootstrap band of the history's.
    const hist = levels.slice(1).map((v, i) => v - levels[i]);
    const bands = Array.from({ length: 200 }, (_, b) => { const ub = rng(100 + b); const out: number[] = []; while (out.length < hist.length) { let at = Math.floor(ub() * hist.length); for (let k = 0; k < 12 && out.length < hist.length; k++) out.push(hist[(at++) % hist.length]); } return std(out); }).sort((a, b) => a - b);
    const sim = rateStep({ ...fit, start: levels.at(-1)! }), us = rng(9), ns = normals(us);
    const path = Array.from({ length: 360 }, () => sim(ns(), us, ns));
    const simSd = std(path.slice(1).map((v, i) => v - path[i]));
    check("simulated rate changes are as volatile as history's (inside the block-bootstrap band, widened by half)", simSd > bands[5] * 0.5 && simSd < bands[194] * 1.5, { simSd, lo: bands[5], hi: bands[194] });
    check("month-end bill yields from the Treasury's CSV", JSON.stringify(monthEnds('Date,"1 Mo","3 Mo","10 Yr"\n01/31/2025,4.3,4.31,4.5\n01/30/2025,4.3,4.29,4.6\n02/28/2025,4.3,4.32,')) === JSON.stringify([{ month: "2025-01", y3m: 4.31, y10: 4.5 }, { month: "2025-02", y3m: 4.32, y10: null }]));
    check("the refinancing spread widens with the drawdown and is capped", spreadAt(DEFAULT_SPREAD, 0) === 350 && spreadAt(DEFAULT_SPREAD, 0.2) === 850 && spreadAt(DEFAULT_SPREAD, 0.9) === 1500);
    // Reverse stress on a toy case whose answer is known: breach comes from EBITDA alone.
    const J = 2000, ue = rng(4), ne = normals(ue);
    const rates = new Float64Array(J), ebitda = new Float64Array(J), event = new Uint8Array(J);
    for (let k = 0; k < J; k++) { rates[k] = 50 * ne(); ebitda[k] = 0.1 * ne(); event[k] = ebitda[k] < -0.15 ? 1 : 0; }
    const rv = reverseStress({ rates, ebitda }, event, { target: 0.5, covenant: "the test", year: 2 });
    check("the gentlest breaching scenario leans on EBITDA, not rates (the known answer)", rv.ok && rv.direction !== null && rv.direction.ebitda < -0.9 && Math.abs(rv.direction.rates) < 0.35, rv.direction);
    check("its relative entropy is at least the floor no scenario can beat, and its plausibility is stated", rv.kl! >= rv.floorKl! - 1e-9 && rv.effective! > 0 && rv.effective! < 1 && /effective probability/.test(rv.sentence) && rv.scenario!.ebitda < rv.baseMeans.ebitda);
    check("the floor: tilting only breaching paths (c ln c/p + (1-c) ln (1-c)/(1-p))", near(floorKl(0.1, 0.5), 0.5 * Math.log(5) + 0.5 * Math.log(0.5 / 0.9), 1e-12) && floorKl(0.6, 0.5) === 0);
    check("a deal the base case already breaches says so", reverseStress({ rates, ebitda }, Uint8Array.from(event, () => 1), {}).kl === 0);
    // The full simulation on a synthetic macro history.
    const months = Array.from({ length: 300 }, (_, k) => `${2000 + Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`);
    const um = rng(3), nm = normals(um);
    let v = 0.0016;
    const H = months.map(() => { const z = nm(); const e = Math.sqrt(v) * z; v = 0.0001 + 0.1 * e * e + 0.85 * v; return [0.006 + e, 0.1 * nm()]; });
    const macro = macroFrom(months, H, ["market", "rates"]);
    const tr = defaultTranches();
    const op = operatingFrom({ name: "X", ticker: "X", sic: "", revenue: 1000e6, ebitda: 200e6, capexPct: 40, daPct: 30, growth: 0.05, growthVol: 0.08, marginVol: 0.02, quarters: [], fy: "", source: "test" }, new Map(), []);
    const spec: StressSpec = { structure: { ebitda0: 200e6, entryMultiple: 11, tranches: tr, financeFeePct: 2, txnFeePct: 2, minCash: 20e6, daPct: 30, capexPct: 40, nwcPct: 10, tax: 25, sweep: 75, years: 5, periodsPerYear: 4, covenants: defaultCovenants(tr) }, macro, rates: DEFAULT_RATES, op, exit: { base: 10, sigma: 0.2, elasticity: 0.5, n: 0, source: "x" }, spread: DEFAULT_SPREAD, paths: 400, seed: 7, hurdle: 0.2, confidence: 0.6, breakYear: 3 };
    const a = simulatePaths(spec), b = simulatePaths(spec), c = simulatePaths({ ...spec, seed: 8 });
    check("seeds reproduce: the same seed gives the same paths, another seed others", a.paths[17].ebitda[9] === b.paths[17].ebitda[9] && a.paths[17].exitMultiple === b.paths[17].exitMultiple && a.paths[17].ebitda[9] !== c.paths[17].ebitda[9]);
    const res = runStress(spec, a);
    check("outputs: IRR and MOIC distributions, breach by year rising, odds between 0 and 1", res.irr.p10 < res.irr.p50 && res.irr.p50 < res.irr.p90 && res.breachByYear.every((x, k) => k === 0 || x >= res.breachByYear[k - 1]) && Object.values(res.odds).every((x) => x >= 0 && x <= 1));
    const mp = maxEntry(spec.structure, a.paths, 0.2, 0.6);
    check("the max price clears the confidence line, and a higher price does not", mp.multiple === null || (probAbove(spec.structure, a.paths, mp.multiple, 0.2) >= 0.6 && probAbove(spec.structure, a.paths, mp.multiple + 0.5, 0.2) < 0.6), mp.multiple);
    const heavy = runStress({ ...spec, structure: { ...spec.structure, tranches: tr.map((t) => (t.kind === "tlb" ? { ...t, turns: 5.5 } : t)) } }, a);
    check("more leverage never lowers the breach odds on the same paths", heavy.odds.breachAny >= res.odds.breachAny);
    const o = outcomesOf(spec, a);
    check("the summary of per-path outcomes (what the ML service's refine returns) equals the preview's", JSON.stringify(summarise(spec, o, mp).breachByYear) === JSON.stringify(res.breachByYear) && summarise(spec, o, mp).irr.p50 === res.irr.p50);
    check("monthly factors add up the days of each month", JSON.stringify(monthlyFactors([{ date: "2020-01-02", market: 0.01, energy: 0, oil: 0, gas: 0, rates: 0.02 }, { date: "2020-01-03", market: -0.005, energy: 0, oil: 0, gas: 0, rates: 0.01 }, { date: "2020-02-03", market: 0.02, energy: 0, oil: 0, gas: 0, rates: 0 }], ["market", "rates"]).H) === JSON.stringify([[0.005, 0.03], [0.02, 0]]));
    const cr = cleanRequest({ ticker: "et", entryMultiple: 99, tranches: [{ kind: "tlb", turns: 50, floating: true }, { kind: "bogus" }], years: 12 });
    check("requests are cleaned: tickers upper-cased, numbers clamped, unknown tranches dropped", cr.ticker === "ET" && cr.entryMultiple === 40 && cr.tranches!.length === 1 && cr.tranches![0].turns === 10 && cr.years === 7);
  }

  /* ======================= E7 Thesis Agent ======================= */
  console.log("E7 Thesis Agent: the plan, the ladder, monitors and the memo");
  const plan: Plan = {
    title: "ET buys a Permian gatherer", companies: ["ET", "TRGP"], model: "test", madeAt: "2026-10-14T00:00:00Z",
    claims: [
      { n: 1, text: "Energy Transfer announces a Permian gathering acquisition", parent: null, logic: "any", rule: { type: "manual" }, closes: "2026-10-28", prior: 0.3, priorBasis: "subjective", priorNote: "", evidence: [{ tool: "precedents", args: { ticker: "ET" }, why: "deal flow" }] },
      { n: 2, text: "Targa agrees to be acquired", parent: 1, rule: { type: "deal", role: "target", ticker: "TRGP" }, closes: "2026-10-28", prior: 0.1, priorBasis: "subjective", priorNote: "", evidence: [{ tool: "deal_odds", args: { ticker: "TRGP" }, why: "sale odds" }] },
      { n: 3, text: "Permian hiring at ET keeps growing", parent: null, rule: { type: "manual" }, closes: "2026-10-28", prior: 0.6, priorBasis: "subjective", priorNote: "", evidence: [{ tool: "pulse", args: { ticker: "ET" }, why: "hiring" }] },
    ],
    kills: [{ n: 1, text: "TRGP's sale odds fall below 3%", monitor: { tool: "deal_odds", ticker: "TRGP", op: "<=", value: 0.03 } }, { n: 2, text: "TRGP sale odds above 40% (someone else buys it)", monitor: { tool: "deal_odds", ticker: "TRGP", op: ">=", value: 0.4 } }],
  };
  {
    check("a good plan passes", validatePlan(plan, { horizonEnd: "2026-10-28", today: "2026-10-14" }).length === 0, validatePlan(plan, { horizonEnd: "2026-10-28", today: "2026-10-14" }));
    const bad = { ...plan, claims: [{ ...plan.claims[0], prior: 1, evidence: [] }, { ...plan.claims[1], parent: 3 }, { ...plan.claims[2], parent: 2, closes: "2027-05-01" }] };
    const errs = validatePlan(bad, { horizonEnd: "2026-10-28", today: "2026-10-14" });
    check("a bad plan says what is wrong: prior, evidence, cycle, horizon", errs.some((e) => /prior strictly/.test(e)) && errs.some((e) => /evidence plan/.test(e)) && errs.some((e) => /cycle/.test(e)) && errs.some((e) => /inside the horizon/.test(e)), errs);
    check("too few claims or kill criteria is refused", validatePlan({ ...plan, claims: plan.claims.slice(0, 2), kills: plan.kills.slice(0, 1) }, { horizonEnd: "2026-10-28", today: "2026-10-14" }).length >= 2);
    check("monitors are typed and checked", monitorOk(plan.kills[0].monitor) && !monitorOk({ tool: "deal_odds", ticker: "TRGP", op: ">=", value: 3 }) && !monitorOk({ tool: "series", ticker: "ET", metric: "jobs.open", op: "drop", value: 0.3, weeks: 1 }) && cleanKills([...plan.kills, plan.kills[0]]).length === 2);
    const pr = withPriors(plan, { TRGP: { p: 0.2, base: 0.03 } }, "2026-10-14");
    const c2 = pr.claims.find((c) => c.n === 2)!;
    check("a target-deal claim takes the Deal Radar's odds over its window as a reference prior", c2.priorBasis === "reference" && near(c2.prior, Math.max(0.01, scaleOdds(0.2, Math.max(0.5, (Date.parse("2026-10-28") - Date.parse("2026-10-14")) / (30.44 * 86_400_000)))), 1e-9) && /Deal Radar/.test(c2.priorNote));
    check("other claims keep a clamped, subjective prior", pr.claims[0].priorBasis === "subjective" && withPriors({ ...plan, claims: [{ ...plan.claims[0], prior: 0.999 }] }, {}, "2026-10-14").claims[0].prior === 0.97);
    check("scaling 12-month odds to six months (constant hazard)", near(scaleOdds(0.2, 6), 1 - Math.sqrt(0.8), 1e-12));
    check("the ladder: one strong item for takes 50% to 8/9", near(applyLadder(0.5, [{ direction: "for", strength: "strong", kept: true }]).p, 8 / 9, 1e-9));
    check("the ladder is capped per tick (three strong items move no more than one)", near(applyLadder(0.5, [1, 2, 3].map(() => ({ direction: "for" as const, strength: "strong" as const, kept: true }))).p, 8 / 9, 1e-9) && TICK_CAP === Math.log(LADDER.strong));
    check("weak against takes even odds to 1/1.5; held-back items do not count", near(applyLadder(0.5, [{ direction: "against", strength: "weak", kept: true }]).p, 0.4, 1e-9) && applyLadder(0.5, [{ direction: "for", strength: "strong", kept: false }]).p === 0.5);
    check("parents combine their claims: all, any, weighted", near(combine([{ p: 0.5 }, { p: 0.4 }], "all"), 0.2, 1e-9) && near(combine([{ p: 0.5 }, { p: 0.4 }], "any"), 0.7, 1e-9) && near(combine([{ p: 0.5, weight: 3 }, { p: 0.1, weight: 1 }], "weighted"), 0.4, 1e-9));
    const tree = recomputeTree([{ n: 1, parent: null, p: 0.9, logic: "any" as const }, { n: 2, parent: 1, p: 0.2 }, { n: 3, parent: 1, p: 0.5 }, { n: 4, parent: null, p: 0.6 }]);
    check("a parent is recomputed from its claims; leaves keep theirs; overall is the roots together", near(tree[0].p, 0.6, 1e-9) && tree[1].p === 0.2 && near(overall(tree)!, 0.36, 1e-9));
    check("the budget refuses a step that would pass it", canSpend(0.5, 0.49, 0.004) && !canSpend(0.5, 0.499, 0.004) && canSpend(0, 0, 0));
    check("ticks are due at 13:00 UTC daily, or 13:00 and 21:00 twice daily", nextTick(new Date("2026-10-14T10:00:00Z"), "daily").toISOString() === "2026-10-14T13:00:00.000Z" && nextTick(new Date("2026-10-14T14:00:00Z"), "daily").toISOString() === "2026-10-15T13:00:00.000Z" && nextTick(new Date("2026-10-14T14:00:00Z"), "twice-daily").toISOString() === "2026-10-14T21:00:00.000Z");
    check("monitors: odds crossing a line, a series falling, a new finding, a deal", evalMonitor({ tool: "deal_odds", ticker: "T", op: ">=", value: 0.4 }, { tool: "deal_odds", p: 0.45 }, "2026-10-01").status === "fired"
      && evalMonitor({ tool: "series", ticker: "T", metric: "jobs.open", op: "drop", value: 0.3, weeks: 2 }, { tool: "series", points: [{ period: "a", value: 100 }, { period: "b", value: 90 }, { period: "c", value: 65 }] }, "2026-10-01").status === "fired"
      && evalMonitor({ tool: "pulse", ticker: "T", kind: "layoff_notice" }, { tool: "pulse", findings: [{ kind: "layoff_notice", title: "WARN", observedAt: "2026-09-01" }] }, "2026-10-01").status === "watching"
      && evalMonitor({ tool: "deal", ticker: "T", role: "target" }, { tool: "deal", events: [{ role: "target", announced: "2026-10-05", counterparty: "X" }] }, "2026-10-01").status === "fired"
      && evalMonitor({ tool: "deal_odds", ticker: "T", op: ">=", value: 0.4 }, null, "2026-10-01").status === "unavailable");
  }

  console.log("E7 Thesis Agent: the runtime, replayed over three ticks");
  {
    const steps = new Map<string, Step>();
    const db: { row: AgentRow; state: AgentState } = {
      row: { id: 5, ownerId: "u1", title: plan.title, thesis: "ET buys a Permian gatherer within 12 months", status: "running", horizonEnd: "2026-10-28", budgetUsd: 0.5, spentUsd: 0, cadence: "daily" },
      state: { ...emptyState("free", plan.companies), plan, approvedAt: "2026-10-14T13:00:00.000Z", nextTickAt: "2026-10-14T13:00:00.000Z",
        claims: plan.claims.map((c) => ({ ...c, p: c.prior, forecastId: c.n * 10, history: [{ at: "2026-10-14T13:00:00.000Z", p: c.prior, why: "prior" }], resolved: null, override: null })),
        kills: plan.kills.map((k) => ({ ...k, status: "watching" as const, value: null, detail: "", checkedAt: null, firedAt: null })) },
    };
    const store: AgentStore = {
      load: async () => ({ row: { ...db.row }, state: structuredClone(db.state) }),
      save: async (_id, s, patch = {}) => { db.state = structuredClone(s); if (patch.status) db.row.status = patch.status; if (patch.spent !== undefined) db.row.spentUsd = patch.spent; },
      findStep: async (_id, key) => steps.get(key) ?? null,
      addStep: async (_id, _day, s) => { steps.set(s.key, s); },
    };
    let day = 0;
    const clock = () => new Date(Date.parse("2026-10-14T13:00:30Z") + day * 86_400_000);
    const oddsByDay = [0.12, 0.2, 0.45];
    const tools: Record<string, ToolDef> = {
      precedents: { name: "precedents", description: "", costUsd: 0, run: async (args) => ({ tool: "precedents", args, header: "ET · Edge deal database", text: `Day ${day}: 4 deals like ET in the last 8 years: EV/EBITDA median 9.5x.`, data: {} }) },
      deal_odds: { name: "deal_odds", description: "", costUsd: 0, run: async (args) => ({ tool: "deal_odds", args, header: "TRGP · Edge Deal Radar", text: `Targa (TRGP): model probability ${Math.round(oddsByDay[day] * 100)}% of an announced agreement to be acquired within 12 months.`, data: { p: oddsByDay[day] } }) },
      pulse: { name: "pulse", description: "", costUsd: 0, run: async (args) => ({ tool: "pulse", args, header: "ET · Edge Alt-Data Pulse", text: "Energy Transfer: open postings 410 (+12% over six weeks).", data: {} }) },
    };
    const recorded = [
      [{ claim: 2, direction: "for" as const, strength: "moderate" as const, statement: "Targa's sale odds are 12%", quote: "model probability 12%", source: "T2" }, { claim: 3, direction: "for" as const, strength: "weak" as const, statement: "ET hiring grows", quote: "open postings 410 (+12% over six weeks)", source: "T3" }, { claim: 1, direction: "for" as const, strength: "strong" as const, statement: "ET signed a deal", quote: "ET signed a definitive agreement", source: "T1" }],
      [{ claim: 2, direction: "for" as const, strength: "strong" as const, statement: "Targa's sale odds rose to 20%", quote: "model probability 20%", source: "T2" }],
      [{ claim: 3, direction: "against" as const, strength: "moderate" as const, statement: "hiring is flat", quote: "open postings 410", source: "T3" }],
    ];
    const cards: { fired: number[]; moved: number }[] = [];
    let extractCalls = 0;
    const deps: Deps = {
      store, tools,
      brain: {
        extract: async () => { extractCalls++; return recorded[day] ?? []; },
        redteam: async (_s, moved) => moved.includes(2) ? [{ claim: 2, text: "Targa says it is not for sale", quote: "nothing like this", source: "T2" }] : [],
        premortem: async () => "If it fails, Targa stays independent.",
        synthesis: async () => ({ text: "Synthesis.", model: "test" }),
      },
      verify: async (items) => items.map((x) => ({ p: 0.9, quoteFound: x.passage.text.includes(x.quote) })),
      monitor: async (m) => (m.tool === "deal_odds" ? { tool: "deal_odds", p: oddsByDay[day] } : null),
      ledger: { log: async (_r, c) => c.n * 10 + day, resolved: async () => new Map() },
      meter: async (fn) => ({ value: await fn(), usd: 0.001 }),
      deepAllowed: async () => false,
      card: async (_r, _s, w) => { cards.push({ fired: w.fired, moved: w.moved.length }); },
      now: clock,
    };
    const snap: number[][] = [];
    for (day = 0; day < 3; day++) {
      const r = await runTick(deps, 5, Date.now() + 60_000);
      check(`tick ${day + 1} runs to the end`, r.ran && r.done, r);
      snap.push(db.state.claims.map((c) => Math.round(c.p * 1e4) / 1e4));
      db.state.nextTickAt = clock().toISOString();
      if (day < 2) { const again = await runTick(deps, 5, Date.now() + 60_000); void again; }
    }
    const c2a = applyLadder(0.1, [{ direction: "for", strength: "moderate", kept: true }]).p;
    check("tick 1: only verified evidence moves claims (the made-up quote is held back)", snap[0][1] === Math.round(c2a * 1e4) / 1e4 && db.state.evidence.some((e) => !e.kept && /quote is not in the source/.test(e.why)), snap[0]);
    check("parents recombine from their claims (claim 1 = any of its children)", snap[0][0] === snap[0][1]);
    check("the replay's probabilities match the snapshot", JSON.stringify(snap) === JSON.stringify([[0.25, 0.25, 0.6923], [0.7273, 0.7273, 0.6923], [0.7273, 0.7273, 0.4286]]), snap);
    check("a 10-point move calls the red team; its unsupported point is not counted", db.state.redteam !== null && db.state.redteam.points.every((p) => !p.kept));
    check("the kill criterion fires on tick 3 and makes a card", db.state.kills.find((k) => k.n === 2)?.status === "fired" && cards.some((c) => c.fired.includes(2)));
    check("tick idempotence: a tick re-run after it finished does nothing twice", extractCalls === 3 && [...steps.keys()].filter((k) => k.endsWith(":extract-call")).length === 3);
    check("the memo says what changed and labels agent estimates", /What changed since/.test(db.state.memo?.markdown ?? "") && /agent estimate/.test(db.state.memo?.markdown ?? "") && whatChanged(db.state, "2026-10-14T00:00:00Z").length > 0);
    check("every step is logged, with its cost", [...steps.values()].some((s) => s.kind === "tool") && [...steps.values()].some((s) => s.kind === "update") && db.row.spentUsd > 0);
    check("the memo builds without a model", buildMemo(db.state, "T", "thesis", "2026-10-14T00:00:00Z", "2026-10-20T00:00:00Z").markdown.startsWith("# T"));
    // A tick cut short by its deadline resumes without repeating anything.
    steps.clear(); extractCalls = 0;
    day = 0;
    db.row.status = "running"; db.row.spentUsd = 0; db.state = { ...db.state, ticks: 0, tickKey: null, nextTickAt: clock().toISOString(), evidence: [], redteam: null };
    const cut = await runTick(deps, 5, Date.now() + 4_000);
    const resumed = await runTick(deps, 5, Date.now() + 60_000);
    check("a tick cut short by its deadline resumes and finishes, with one model call", !cut.done && resumed.done && extractCalls === 1, { cut, resumed, extractCalls });
    // The budget.
    steps.clear(); extractCalls = 0;
    db.row.budgetUsd = 0.001; db.row.spentUsd = 0.0009; db.state = { ...db.state, tickKey: null, nextTickAt: clock().toISOString() };
    await runTick(deps, 5, Date.now() + 60_000);
    check("a model step that would pass the budget is refused before it runs (and the agent stops)", extractCalls === 0 && [...steps.values()].some((s) => s.kind === "approval" && /budget/.test(String(s.output.refused))) && db.row.status === "done" && ESTIMATE.extract > 0.0001);
    check("a stopped agent is not due", !due({ status: "done" }, { nextTickAt: "2000-01-01", tickKey: null }, new Date()));
    // Premium tools.
    const premiumTool: Record<string, ToolDef> = { deep: { name: "series", description: "", costUsd: 0, premium: "edge.thesis-deep", run: async (args) => ({ tool: "deep", args, header: "", text: "ok", data: {} }) } };
    const refused = await callTool(premiumTool, "deep", {}).then(() => false, (e) => (e as { status?: number }).status === 402);
    const allowed = await withFeatures(["edge.thesis-deep"], () => callTool(premiumTool, "deep", {})).then((r) => r.text === "ok", () => false);
    check("a premium tool is refused outside a scope that holds it, and runs inside one", refused && allowed);
    void ({} as ClaimState);
  }
}
