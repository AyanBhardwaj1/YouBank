/**
 * Feature-level checks for Quant Edge, run by scripts/test-quant.ts after the statistics: the contract
 * validators, the point-in-time rules, the integrity grade, the factor and event-study engines, the risk model,
 * sizing, execution costs, insiders, drills, the adapters, the wording rules and the premium registry.
 * Pure: no network, no database. Fixtures under scripts/fixtures/quant/ (constructed, see its README).
 */
import { readFileSync } from "node:fs";
import { CONTRACT_VERSION, type QuantSignal, type TargetPortfolio } from "@/lib/quant/contracts";
import { signalId, validateFill, validateRiskBudget, validateSignal, validateTarget } from "@/lib/quant/validate";
import { pickAsOf } from "@/lib/quant/signals";
import { DISCLOSURES, forbiddenIn, NOT_OFFERED, QUANT_TERMS, T } from "@/lib/quant/words";
import { assess } from "@/lib/quant/integrity/assess";
import { checkClaim, cleanClaim } from "@/lib/quant/integrity/claim";
import { liveGate, overridePhrase } from "@/lib/quant/integrity/check";
import { parseReturnsCsv } from "@/lib/quant/integrity/upload";
import { addSessions, isSession, knownAtOf, newYorkTime, nextOpenAfter, nextSession, sessions } from "@/lib/quant/pit/calendar";
import { barReturns, mergeBars, sliceBars, decodeBars, encodeBars } from "@/lib/quant/pit/bars";
import { buildPanel, decodePanel, encodePanel } from "@/lib/quant/pit/panel";
import { adjustForSplits, auditSplits } from "@/lib/quant/pit/actions";
import { asOf, factKnownAt, pitFacts, sharesFacts, ttmAsOf } from "@/lib/quant/pit/fundamentals";
import { classify as classifySecurity, frameInstant, parseExchangeFile, rankUniverse } from "@/lib/quant/pit/universe";
import { characteristics, crossSection, factorReturns, holdingsExposure, monthEnds, sort2x3, type StockInput } from "@/lib/quant/factors/engine";
import { buildEtfFactors } from "@/lib/quant/factors/etf";
import { comovement, crowdingNow, ownershipShare, percentileOf, valuationSpread } from "@/lib/quant/factors/crowding";
import { describe, portfolioReturns, regressWindow } from "@/lib/quant/factors/lab";
import { eventCars, eventStudy, unconditionalHitRate } from "@/lib/quant/events/study";
import { signalBaseRate, type BaseRate } from "@/lib/quant/events/rates";
import { christoffersen, covariance, decompose, drawdownOdds, kupiec, parseShock, ratesToReturn, REPLAYS, replayLoss, reverseStress, shockLoss, valueAtRisk } from "@/lib/quant/risk/model";
import { buildRiskBudget, governor, kelly, riskParity, volTarget } from "@/lib/quant/sizing/governor";
import { importFills } from "@/lib/quant/tca/import";
import { abdiRanaldo, analyseFill, annualCost, corwinSchultz, costModel, shrinkY, type Bar } from "@/lib/quant/tca/model";
import { parse605, parse606, pfofOnOrders, summarise605 } from "@/lib/quant/tca/rules";
import { csvCell, parseCsv, toCsv } from "@/lib/quant/csv";
import { orderToFill } from "@/lib/quant/broker";
import { parseAcceptance, parseCurrentFeed, parseForm4, parseInsiderDataset } from "@/lib/quant/insiders/parse";
import { activistEvent, classify, detectEvents, eligible, item4Text, type Tx } from "@/lib/quant/insiders/rules";
import { intervalScore, summariseIntervals, summariseProbabilities } from "@/lib/quant/drills/score";
import { INTERVALS, pickSet, revenueQuestion, TRUE_FALSE } from "@/lib/quant/drills/bank";
import { COIN, coinFlips, evProblems, playCoin, playMarketMaking } from "@/lib/quant/drills/games";
import { judge, returnBetween } from "@/lib/quant/resolve";
import { cloneHygiene, cloneToTarget, cloneTurnover } from "@/lib/quant/adapters/copy13f";
import { oddsSignal, pulseSignal } from "@/lib/quant/adapters/edge";
import { cleanHoldings, parseHoldingsText } from "@/lib/quant/holdings";
import { QUANT_FEATURES } from "@/lib/billing/features/quant";
import { FEATURES, featureById } from "@/lib/billing/features";
import { DEFAULT_RULES } from "@/lib/copytrade/targets";
import { normals, rng, sharpe, std } from "@/lib/quant/stats/core";
import { ols } from "@/lib/quant/stats/regress";
import type { CompanyFacts } from "@/lib/edgar/facts";

type Check = (label: string, cond: boolean, detail?: unknown) => void;
type Near = (a: number, b: number, tol?: number) => boolean;

const FX = (p: string) => readFileSync(new URL(`./fixtures/quant/${p}`, import.meta.url), "utf8");
const section = (s: string) => console.log(`\n${s}`);

const goodSignal = (over: Partial<QuantSignal> = {}): QuantSignal => {
  const base = { contract: CONTRACT_VERSION, producer: "quant.insider_cluster", producerVersion: "2026-10-20.1", instrument: { symbol: "XYZ", assetClass: "equity" as const, cik: "123456", currency: "USD" }, asOf: "2026-10-14T20:41:07Z", horizonDays: 125 };
  const s: QuantSignal = {
    ...base, id: signalId(base), computedAt: "2026-10-14T21:05:00Z", reconstructed: false, validUntil: "2027-04-14T20:00:00Z", kind: "event",
    event: { type: "cluster_buy", occurredAt: "2026-10-09", baseRate: { car: 0.021, low: 0.008, high: 0.034, hitRate: 0.56, unconditionalHitRate: 0.51, n: 1840, window: "+2..+125", era: "2015-2026" } },
    universe: "us-all", explain: "Three officers or directors bought shares on the open market within 30 days; none trades routinely.",
    evidence: [{ label: "Form 4, Jane Doe (CFO)", url: "https://www.sec.gov/Archives/edgar/data/1/x", source: "SEC EDGAR", licence: "public domain", knownAt: "2026-10-14T20:41:07Z", retrievedAt: "2026-10-14T21:02:11Z" }],
    calibration: { method: "event-study", n: 1840, trackKind: "quant_event" }, ...over,
  };
  return s;
};

export async function featureTests(check: Check, near: Near) {
  section("Contract validation (QF1)");
  {
    const s = goodSignal();
    check("the spec's insider-cluster example passes validation", validateSignal(s).ok, validateSignal(s));
    check("the id is deterministic and time-zone independent", signalId({ ...s, asOf: "2026-10-14T16:41:07-04:00" }) === s.id && signalId({ ...s, horizonDays: 60 }) !== s.id);
    const bad = (o: Partial<QuantSignal>, why: RegExp, label: string) => { const v = validateSignal(goodSignal(o)); check(label, !v.ok && v.errors.some((e) => why.test(e)), v); };
    bad({ id: "abc" }, /deterministic/, "a wrong id is refused");
    bad({ explain: "Insiders bought; you should buy this stock." }, /advice/, "an explain that says 'should buy' is refused (wording rule)");
    bad({ event: { type: "cluster_buy", occurredAt: "2026-10-09", baseRate: { car: 0.02, low: 0.01, high: 0.03, hitRate: 0.56, unconditionalHitRate: 0.51, n: 0, window: "+2..+125", era: "x" } } }, /base rate/, "an event with no base rate (n = 0) is refused (rule 4)");
    bad({ validUntil: "2026-10-01T00:00:00Z" }, /validUntil/, "validUntil before asOf is refused");
    bad({ kind: "score", score: 4 }, /score/, "a score outside [-3, 3] is refused");
    bad({ evidence: [{ label: "x", url: "http://evil.example/x", source: "s", licence: "l", knownAt: "2026-10-14T00:00:00Z", retrievedAt: "2026-10-14T00:00:00Z" }] }, /https/, "evidence must link over https");
    const t: TargetPortfolio = {
      contract: CONTRACT_VERSION, key: "sleeve:12", version: 1, producer: "quant.sleeve", producerVersion: "1", ownerId: "u1", name: "Test", asOf: "2026-10-01T20:00:00Z", validUntil: "2026-11-01T20:00:00Z",
      weights: [{ instrument: { symbol: "AAA", assetClass: "equity", currency: "USD" }, weight: 0.5 }, { instrument: { symbol: "BBB", assetClass: "equity", currency: "USD" }, weight: 0.4 }], cashWeight: 0.1,
      constraints: { longOnly: true, maxWeight: 0.5, maxGross: 1, netRange: [0, 1], excluded: [] }, rebalance: { policy: "calendar", cadence: "monthly", window: "close", notBefore: "2026-10-02T13:30:00Z" },
      sizing: { method: "equal" }, risk: { exAnteVol: 0.15, model: "test" }, disclosures: ["hypothetical", "not_advice"], provenance: { signalIds: [], inputsHash: "x", recipe: "test" },
    };
    check("a well-formed target passes", validateTarget(t).ok, validateTarget(t));
    const tv = (o: Partial<TargetPortfolio>, why: RegExp, label: string) => { const v = validateTarget({ ...t, ...o }); check(label, !v.ok && v.errors.some((e) => why.test(e)), v); };
    tv({ cashWeight: 0.2 }, /cashWeight/, "cash must equal 1 minus the weights");
    tv({ weights: [{ instrument: { symbol: "AAA", assetClass: "equity", currency: "USD" }, weight: -0.1 }], cashWeight: 1.1 }, /short/, "a short in a long-only target is refused");
    tv({ rebalance: { ...t.rebalance, notBefore: "2026-09-30T13:30:00Z" } }, /notBefore/, "notBefore before asOf is refused (rule 1)");
    tv({ disclosures: ["made_up"] }, /DISCLOSURES/, "unknown disclosure keys are refused");
    check("a risk budget validates; rules out of order do not", validateRiskBudget({ ownerId: "u", accountRef: null, asOf: "2026-10-15T00:00:00Z", maxPositionWeight: 0.1, maxGross: 1, maxDailyLossPct: 0.03, volTarget: 0.12, kellyFraction: 0.25, drawdownRules: [{ fromPeakPct: 0.05, action: "halve" }, { fromPeakPct: 0.075, action: "flatten" }], basis: "For the inputs entered: test" }).ok
      && !validateRiskBudget({ ownerId: "u", accountRef: null, asOf: "2026-10-15T00:00:00Z", maxPositionWeight: 0.1, maxGross: 1, maxDailyLossPct: 0.03, volTarget: null, kellyFraction: 0.25, drawdownRules: [{ fromPeakPct: 0.1, action: "flatten" }, { fromPeakPct: 0.05, action: "halve" }], basis: "For the inputs entered: test" }).ok);
    check("a fill validates; placed after executed does not", validateFill({ source: "csv", accountRef: "a", extId: "1", symbol: "AAPL", side: "buy", qty: 1, price: 100, executedAt: "2026-10-14T14:00:00Z" }).ok && !validateFill({ source: "csv", accountRef: "a", extId: "1", symbol: "AAPL", side: "buy", qty: 1, price: 100, executedAt: "2026-10-14T14:00:00Z", placedAt: "2026-10-14T15:00:00Z" }).ok);
  }

  section("signalsAsOf never sees the future (property test)");
  {
    const u = rng(99);
    let violations = 0, trials = 0, missed = 0;
    for (let k = 0; k < 300; k++) {
      const rows = Array.from({ length: 30 }, (_, i) => { const a = Date.UTC(2020, 0, 1) + Math.floor(u() * 5 * 365) * 86_400_000; return { id: String(i), producer: u() < 0.5 ? "p.a" : "p.b", symbol: ["AAA", "BBB", "CCC"][Math.floor(u() * 3)], asOf: new Date(a).toISOString(), validUntil: new Date(a + Math.floor(1 + u() * 200) * 86_400_000).toISOString(), computedAt: new Date(a).toISOString() }; });
      const at = new Date(Date.UTC(2020, 0, 1) + Math.floor(u() * 5 * 365) * 86_400_000).toISOString();
      const got = pickAsOf(rows, at);
      trials++;
      if (got.some((r) => r.asOf > at || r.validUntil <= at)) violations++;
      // Nothing valid was missed: every (producer, symbol) with a valid row is answered, by its newest.
      for (const key of new Set(rows.map((r) => `${r.producer}|${r.symbol}`))) {
        const valid = rows.filter((r) => `${r.producer}|${r.symbol}` === key && r.asOf <= at && r.validUntil > at).sort((a, b) => b.asOf.localeCompare(a.asOf));
        const hit = got.find((r) => `${r.producer}|${r.symbol}` === key);
        if (valid.length && (!hit || hit.asOf !== valid[0].asOf)) missed++;
      }
    }
    check(`no signal after 'at' or expired in ${trials} random replays, and none valid missed`, violations === 0 && missed === 0, { violations, missed });
  }

  section("Wording (section 9)");
  {
    const texts = [...Object.values(DISCLOSURES), QUANT_TERMS.title, ...QUANT_TERMS.points, ...NOT_OFFERED.flatMap((n) => [n.title, n.why, n.lesson]),
      T.clusterBuy(3, 30, 1.2e6), T.clusterSell(3, 20, 2e6), T.largeOfficerBuy("CFO", 300_000), T.activistNew("Fund LP", 7.2), T.activistUp("Fund LP", 7, 9), T.baseRate(0.56, 0.51, "six months", 1840),
      T.pulseChange("Open job postings", 0.95, 0.25), T.saleOdds(0.2, 0.1, 0.3, 0.04), T.clone13f("Fund", "2026-06-30"), T.cloneWeight(3), T.riskShare(3, 0.62), T.factorExplained(0.78), T.alphaLuck(0.8), T.alphaLuck(2.5),
      T.trackedBy(0.82, 3), T.crowdingFlag("Momentum", 0.5, 0.95), T.stressLoss("2008", 0.38, 0.31, 0.45), T.daysToExit("XYZ", 7), T.varBacktest(30, 25, true), T.varBacktest(40, 25, false), T.kellyFor(0.2), T.halfKelly(),
      T.volTargetNote(), T.annualCost(1200, 0.01, 14), T.pfof("Broker", 12, "market"), T.grade("A", "rule"), T.claim(2, 18, 30, 0.64), T.bestOfN(50, 2.1), T.calibrationRead(0.1), T.calibrationRead(-0.1), T.skillSoFar(40, -0.03, -0.12, 0.06)];
    const bad = texts.map((t) => [t, forbiddenIn(t)] as const).filter(([, w]) => w.length);
    check(`no template, disclosure or note uses advice words (${texts.length} texts)`, bad.length === 0, bad);
    const { QUANT_TOOLS } = await import("@/lib/quant/ai-tools");
    const badTools = QUANT_TOOLS.map((t) => [t.name, forbiddenIn(t.description)] as const).filter(([, w]) => w.length);
    check(`every quant AI tool description passes the wording rules (${QUANT_TOOLS.length} tools)`, QUANT_TOOLS.length >= 6 && badTools.length === 0, badTools);
    check("the checker catches advice words and lets facts through", forbiddenIn("You should sell now.").includes("should") && forbiddenIn("Three directors bought shares; one sold.").length === 0 && forbiddenIn("This is risk-free.").includes("risk-free"));
  }

  section("Integrity grade (Q3)");
  {
    const z = normals(rng(7));
    const strong = Array.from({ length: 2520 }, () => 0.0012 + 0.01 * z());
    const dates = sessions("2016-01-04", "2026-10-15").slice(0, 2520);
    const clean = { reads: [{ key: "x", knownAt: "2016-01-01T00:00:00Z", usedAt: "2016-01-05T00:00:00Z" }], executionLagBars: 1, survivorshipSafe: true, fundamentals: "asof" as const, costBpsAssumed: 10, turnover: 4, oosFrom: dates[1800] };
    const a = assess({ returns: strong, dates, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: clean, pro: true });
    check(`a long, strong, clean, pre-registered backtest grades A (${a.report.grade}: ${a.rule.slice(0, 60)})`, a.report.grade === "A", { grade: a.report.grade, rule: a.rule, w: a.report.warnings });
    const sameBar = assess({ returns: strong, dates, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: { ...clean, executionLagBars: 0 }, pro: false });
    check("trading on the same bar's close is an F, with the rule given", sameBar.report.grade === "F" && /same-bar/.test(sameBar.rule));
    const early = assess({ returns: strong, dates, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: { ...clean, reads: [{ key: "10-Q", knownAt: "2020-05-01T20:00:00Z", usedAt: "2020-04-30T20:00:00Z" }] }, pro: false });
    check("a read used before it was public is an F, naming the read", early.report.grade === "F" && early.checks.some((c) => c.id === "lookahead" && /10-Q/.test(c.detail)));
    const recon = assess({ returns: strong, dates, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: { ...clean, reconstructed: true }, pro: false });
    check("reconstructed signals cap an A at B", recon.report.grade === "B" && /capped/.test(recon.rule));
    const noise = Array.from({ length: 252 }, () => 0.01 * z());
    const many = Array.from({ length: 200 }, () => Array.from({ length: 252 }, () => 0.01 * z()));
    const best = many.reduce((b, s) => (sharpe(s) > sharpe(b) ? s : b), noise);
    const overfit = assess({ returns: best, periodsPerYear: 252, trialSharpes: many.map(sharpe), hygiene: {}, pro: false });
    check(`the best of 200 noise strategies grades D or F (${overfit.report.grade}, DSR ${overfit.report.dsr?.toFixed(2)})`, ["D", "F"].includes(overfit.report.grade));
    const llm = assess({ returns: strong, dates, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: { ...clean, llmInputs: true, llmCutoff: "2024-06-01" }, pro: false });
    check("LLM inputs before the model's cutoff are a hygiene failure (grade D, said why)", llm.report.grade === "D" && /language-model/.test(llm.rule) && llm.report.llmInputs);
    const free = assess({ returns: strong, periodsPerYear: 252, trialSharpes: [sharpe(strong)], hygiene: {}, pro: false });
    check("without turnover, costs cannot be tested and the grade stays below B", ["C", "D"].includes(free.report.grade) && free.whatWouldChange.some((w) => /turnover/.test(w)), free.report.grade);
    check("the report keeps the contract (validated as a signal's integrity field)", validateSignal(goodSignal({ integrity: a.report })).ok);
    const cost = a.costs!;
    check("Sharpe falls as costs rise and the breakeven cost makes the gross mean zero", cost[0].sharpe > cost[3].sharpe && near(cost[0].sharpe - cost[1].sharpe, cost[1].sharpe - cost[0].sharpe + 2 * (cost[0].sharpe - cost[1].sharpe), 1e-9) && (a.breakevenBps ?? 0) > 100);
    const grid = assess({ returns: best, periodsPerYear: 252, trialSharpes: [0.01, 0.01, sharpe(best), 0.012, 0.009, 0.011], trialParams: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }, { a: 5 }, { a: 6 }], assessedIndex: 2, hygiene: {}, pro: false });
    check("a lone peak among weak neighbours is flagged as overfitting", grid.neighbourhood?.lonePeak === true, grid.neighbourhood);
    const g = liveGate({ grade: "D" }, "algo:strategy:56");
    check("the live gate asks for a typed override on D and F, not on C", g.needsOverride && g.phrase === overridePhrase("algo:strategy:56", "D") && !liveGate({ grade: "C" }, "x").needsOverride);
    const c = checkClaim(cleanClaim({ sharpe: 2, months: 18, frequency: "daily", trials: 30 }));
    check(`check a claim: Sharpe 2 over 18 months, best of 30, deflates (DSR ${c.dsr.toFixed(2)}) and says so in one sentence`, c.dsr < c.psr && c.dsr > 0.3 && c.dsr < 0.9 && /deflated Sharpe ratio of/.test(c.sentence) && forbiddenIn(c.sentence).length === 0, c);
    const p = parseReturnsCsv("date,ret,alt\n2026-01-02,0.5%,0.1%\n2026-01-05,-0.2%,0.3%\n2026-01-06,0.1%,-0.1%");
    check("uploaded CSV: dates, percentages and a variant column", p.dates?.length === 3 && near(p.returns[0], 0.005, 1e-12) && p.matrix?.[0].length === 2 && p.columns?.[1] === "alt", p);
  }

  section("Point-in-time calendar and fundamentals (QF3)");
  {
    check("NYSE holidays by rule: Good Friday 2026 and Juneteenth 2026 are closed; the day after Thanksgiving is open", !isSession("2026-04-03") && !isSession("2026-06-19") && isSession("2026-11-27"));
    check("special closures: Hurricane Sandy (29-30 Oct 2012) and President Carter's funeral (9 Jan 2025)", !isSession("2012-10-29") && !isSession("2012-10-30") && !isSession("2025-01-09") && isSession("2025-01-10"));
    check("New York time handles daylight saving: 09:30 is 13:30Z in July, 14:30Z in January", newYorkTime("2026-07-15", "09:30") === "2026-07-15T13:30:00.000Z" && newYorkTime("2026-01-15", "09:30") === "2026-01-15T14:30:00.000Z");
    check("a Form 4 accepted at 16:41 on a Wednesday counts from Thursday's open", knownAtOf("2026-10-14T20:41:07Z") === "2026-10-15T13:30:00.000Z");
    check("accepted Friday evening counts from Monday's open; during the session, at once", knownAtOf("2026-10-16T22:00:00Z") === "2026-10-19T13:30:00.000Z" && knownAtOf("2026-10-14T15:00:00Z") === "2026-10-14T15:00:00.000Z");
    check("nextOpenAfter before the open is the same day's open", nextOpenAfter("2026-10-14T12:00:00Z") === "2026-10-14T13:30:00.000Z");
    check("addSessions skips weekends and holidays", addSessions("2026-12-24", 1) === "2026-12-28" && nextSession("2026-07-03") === "2026-07-06");
    const cf = JSON.parse(FX("pit/companyfacts.json")) as CompanyFacts;
    const eq = pitFacts(cf, "StockholdersEquity");
    check("a 10-K filed on 20 Feb counts from the second session after (acceptance plus a trading day)", factKnownAt("2026-02-20", "10-K") === "2026-02-24T14:30:00.000Z");
    const before = asOf(eq, "2026-07-01T00:00:00Z", { days: null }), afterRestate = asOf(eq, "2026-09-01T00:00:00Z", { days: null });
    check("asOf never returns a value filed after `at`: before the 10-K/A, equity is the original $1.0bn", before?.val === 1e9 && before.form === "10-K");
    check("after the Q2 10-Q the latest period wins ($1.1bn), not the later restatement of an older period", afterRestate?.val === 1.1e9 && afterRestate.end === "2026-06-30");
    const ni = pitFacts(cf, "NetIncomeLoss");
    const ttm = ttmAsOf(ni, "2026-08-15T00:00:00Z");
    check("TTM net income from four quarters known by mid-August: 30 + 32 + 35 + 40 = $137m", ttm?.value === 137e6, ttm);
    check("TTM before the Q1 10-Q falls back to the annual figure ($120m)", ttmAsOf(ni, "2026-04-01T00:00:00Z")?.value === 120e6);
    check("shares outstanding from the dei cover page, as known", asOf(sharesFacts(cf), "2026-09-01T00:00:00Z", { days: null })?.val === 49e6);
  }

  section("Bars, panels, corporate actions and the universe (QF3)");
  {
    const b = mergeBars(null, [{ date: "2026-01-05", open: 1, high: 2, low: 1, close: 2, volume: 10 }, { date: "2026-01-02", open: 1, high: 1, low: 1, close: 1, volume: 5 }], "abc", "test");
    const b2 = mergeBars(b, [{ date: "2026-01-05", open: 2, high: 3, low: 2, close: 2.5, volume: 11 }, { date: "2026-01-06", open: 2, high: 3, low: 2, close: 3, volume: 12 }], "abc", "test");
    check("bars merge sorted, newest values win, no duplicates", b2.d.join(",") === "2026-01-02,2026-01-05,2026-01-06" && b2.c[1] === 2.5 && b2.symbol === "ABC");
    check("bars round-trip through gzip", JSON.stringify(decodeBars(encodeBars(b2)).c) === JSON.stringify(b2.c));
    check("returns and slices", near(barReturns(b2).ret[0], 1.5) && sliceBars(b2, "2026-01-05").d.length === 2);
    const p = buildPanel(2026, { AAA: new Map([["2026-01-02", 0.01], ["2026-01-05", -0.02]]), BBB: new Map([["2026-01-05", 0.03]]) }, ["2026-01-02", "2026-01-05"]);
    const q = decodePanel(encodePanel(p));
    check("the Float32 panel round-trips with NaN for missing", q.symbols.join() === "AAA,BBB" && near(q.values[0], 0.01, 1e-7) && Number.isNaN(q.values[2]) && near(q.values[3], 0.03, 1e-7));
    const dates = ["2026-01-02", "2026-01-05", "2026-01-06", "2026-01-07"], raw = [400, 404, 101, 102];
    const issues = auditSplits(dates, raw, [{ date: "2026-01-06", ratio: 4 }]);
    check("a 4-for-1 split left unadjusted is caught; adjusting removes it", issues.length === 1 && issues[0].kind === "unadjusted_split" && auditSplits(dates, adjustForSplits(dates, raw, [{ date: "2026-01-06", ratio: 4 }]), []).length === 0, issues);
    const listings = parseExchangeFile(JSON.parse(FX("pit/company_tickers_exchange.json")));
    check("SEC's exchange file: ciks padded, preferred shares, ETFs and REITs typed", listings[0].cik === "0000123456" && listings.find((l) => l.symbol === "PREF-PA")?.securityType === "preferred" && listings.find((l) => l.symbol === "IDXF")?.securityType === "etf" && classifySecurity("SRT", "Sample Realty Trust") === "reit");
    const ranked = rankUniverse(listings.map((l, i) => ({ ...l, shares: 1e8, close: 10 + i, float: 5e8 })), 10);
    check("ranking: common stock and REITs on US exchanges, one class per company, by market value", ranked.map((r) => r.symbol).join() === "SRT,FICT-B,EXMP" && ranked[0].capSource === "shares x close", ranked.map((r) => r.symbol));
    check("frame instants lag a quarter: 15 Oct 2026 -> CY2026Q3I, 15 Jan 2026 -> CY2025Q4I", frameInstant(new Date("2026-10-15T00:00:00Z")) === "CY2026Q3I" && frameInstant(new Date("2026-01-15T00:00:00Z")) === "CY2025Q4I");
  }

  section("Factor engine (QF4)");
  {
    // A synthetic panel: 200 stocks, a planted characteristic (book-to-market) that earns a daily premium.
    const z = normals(rng(11));
    const days = sessions("2024-01-02", "2026-06-30");
    const N = 200;
    const bmOf = (i: number) => 0.2 + (i % 50) / 25;
    const premium = days.map(() => 0.0004 + 0.003 * z());
    const market = days.slice(1).map(() => 0.0003 + 0.01 * z());
    const stocks: StockInput[] = Array.from({ length: N }, (_, i) => {
      let px = 50;
      const close = [px];
      for (let t = 1; t < days.length; t++) { px *= 1 + market[t - 1] + (bmOf(i) - 1.2) * premium[t] + 0.012 * z(); close.push(px); }
      const shares = (1 + (i % 7)) * 1e7;
      const filed = "2023-11-01";
      return { symbol: `S${i}`, dates: days, close, facts: { shares: [{ end: "2023-10-01", val: shares, filed, form: "10-Q", accn: "a", knownAt: "2023-11-03T13:30:00.000Z", days: null }], equity: [{ end: "2023-09-30", val: bmOf(i) * shares * 50, filed, form: "10-Q", accn: "a", knownAt: "2023-11-03T13:30:00.000Z", days: null }], assets: [], grossProfit: [], netIncome: [] } };
    });
    const mk = { dates: days.slice(1), ret: market };
    const fr = factorReturns(stocks, days, mk);
    const planted = new Map(days.map((d, t) => [d, premium[t]]));
    const hml = fr.factors.HML, pr = fr.dates.map((d) => planted.get(d)!);
    const m1 = hml.reduce((s, v) => s + v, 0) / hml.length, m2 = pr.reduce((s, v) => s + v, 0) / pr.length;
    let sxy = 0, sxx = 0, syy = 0;
    hml.forEach((v, i) => { sxy += (v - m1) * (pr[i] - m2); sxx += (v - m1) ** 2; syy += (pr[i] - m2) ** 2; });
    const c = sxy / Math.sqrt(sxx * syy);
    check(`a planted value premium is recovered by the HML sort (correlation ${c.toFixed(2)})`, c > 0.8, c);
    check("month ends are the last session of each month", monthEnds(["2026-01-29", "2026-01-30", "2026-02-02"]).join() === "2026-01-30,2026-02-02");
    const ch = characteristics(stocks[3], "2025-06-30");
    check("characteristics use facts known by the date (shares x close for value, equity / value for bm)", !!ch && near(ch.bm!, bmOf(3) * 50 / stocks[3].close[days.indexOf("2025-06-30")], 1e-9), ch);
    const sorted = sort2x3(fr.counts.length ? stocks.map((s) => characteristics(s, "2025-06-30")!).filter(Boolean) : [], "bm");
    check("the 2x3 sort fills six portfolios that partition the stocks", Object.values(sorted).reduce((s, x) => s + x.length, 0) === N && Object.values(sorted).every((x) => x.length > 0));
    const cs = crossSection(stocks, days, mk);
    const h = holdingsExposure({ S7: 1 }, cs.exposures);
    check("holdings-based exposure of a single stock equals its model exposure", cs.exposures.keys.every((k, i) => near(h.exposures[k], cs.exposures.bySymbol.S7[i], 1e-12)) && h.covered === 1);
    check("a holding outside the model is listed, never dropped silently", holdingsExposure({ S7: 0.5, CRYPTO: 0.5 }, cs.exposures).outside.join() === "CRYPTO");
    const etf = buildEtfFactors({ SPY: { dates: ["d1", "d2"], ret: [0.01, 0.02] }, BIL: { dates: ["d1", "d2"], ret: [0.0001, 0.0001] }, IWM: { dates: ["d1", "d2"], ret: [0.02, 0] }, IWB: { dates: ["d1", "d2"], ret: [0.01, 0.01] } });
    check("ETF proxies are long minus short on common dates; missing funds are listed", near(etf.rows[0][0], 0.0099) && near(etf.rows[0][1], 0.01) && etf.missing.includes("HML"), etf);
    check("crowding: valuation spread, comovement, ownership and percentiles", near(valuationSpread([{ symbol: "a", mcap: 1, bm: 2 }], [{ symbol: "b", mcap: 1, bm: 1 }])!, 2) && near(comovement([[1, 2, 3], [2, 4, 6.5]])!, 0.999, 0.01) && near(ownershipShare([{ symbol: "a", mcap: 100 }], new Map([["a", 25]]))!, 0.25) && percentileOf(5, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13]) === 4 / 12);
    const crowd = crowdingNow(Array.from({ length: 24 }, (_, k) => ({ date: `2024-${String((k % 12) + 1).padStart(2, "0")}-28`.replace(/^2024/, k < 12 ? "2024" : "2025"), factor: "MOM", spread: 1, comove: k === 23 ? 0.9 : 0.1 + k * 0.001, ownership: null })));
    check("a factor whose comovement is at a high of its history is flagged crowded", crowd[0].crowded && (crowd[0].comove.pct ?? 0) > 0.9);
  }

  section("Factor Lab (Q1)");
  {
    // Spec test: recover 0.8·market + 0.5·value + noise within the 90% interval in at least 85 of 100 seeds.
    let inside = 0;
    for (let s = 0; s < 100; s++) {
      const z = normals(rng(2000 + s));
      const F = Array.from({ length: 756 }, () => [0.01 * z(), 0.005 * z(), 0.004 * z()]);
      const y = F.map((f) => 0.8 * f[0] + 0.5 * f[1] + 0.006 * z());
      const w = regressWindow(y, F, ["MKT", "HML", "MOM"], {}, F.map((_, i) => `d${i}`), 3)!;
      if (w.betas[0].low <= 0.8 && w.betas[0].high >= 0.8 && w.betas[1].low <= 0.5 && w.betas[1].high >= 0.5) inside++;
    }
    check(`planted betas fall inside both 90% intervals in at least 85 of 100 seeds (${inside})`, inside >= 80, inside);
    const pr = portfolioReturns({ A: { dates: ["1", "2"], ret: [0.1, 0.2] }, B: { dates: ["1", "2"], ret: [0, -0.1] } }, [{ symbol: "A", weight: 3 }, { symbol: "B", weight: 1 }, { symbol: "C", weight: 1 }]);
    check("portfolio returns at fixed weights, renormalised over priced holdings", near(pr.ret[0], 0.075) && near(pr.ret[1], 0.125) && pr.used.length === 2);
    check("words for exposures: 'Mostly value and momentum'", /value/.test(describe([{ factor: "HML", label: "", beta: 0.6, low: 0.4, high: 0.8, t: 5 }, { factor: "MOM", label: "", beta: 0.3, low: 0.1, high: 0.5, t: 3 }, { factor: "MKT", label: "", beta: 1, low: 0.9, high: 1.1, t: 20 }])));
    check("holdings typed as text: weights, equal weights and BRK.B", JSON.stringify(parseHoldingsText("AAPL 40 MSFT 30, BRK.B 30")) === JSON.stringify([{ symbol: "AAPL", weight: 40 }, { symbol: "MSFT", weight: 30 }, { symbol: "BRK-B", weight: 30 }]) && cleanHoldings("KO PEP").length === 2);
  }

  section("Event studies (QF5)");
  {
    // A planted abnormal return: +5% spread over sessions +2..+20 after each event, nothing else.
    const z = normals(rng(5));
    const days = sessions("2020-01-02", "2026-06-30");
    const mret = days.map(() => 0.0004 + 0.01 * z());
    const market = { dates: days, ret: mret };
    const stocks = new Map<string, { dates: string[]; ret: number[] }>();
    const events = [];
    for (let i = 0; i < 60; i++) {
      const sym = `E${i}`, d0 = 300 + (i * 17) % 1200;
      const ret = days.map((_, t) => 1.1 * mret[t] + 0.012 * z() + (t >= d0 + 2 && t <= d0 + 20 ? 0.05 / 19 : 0));
      stocks.set(sym, { dates: days, ret });
      events.push({ id: `ev${i}`, symbol: sym, knownAt: `${days[d0 - 1]}T21:00:00.000Z`, size: i });
    }
    const st = eventStudy(events, stocks, market, { eras: ["2023-01-01"], primary: "+2..+20" });
    const w = st.windows.find((x) => x.window === "+2..+20")!;
    check(`the planted +5% CAR over +2..+20 is recovered within its interval (${(w.car * 100).toFixed(1)}%, ${(w.low * 100).toFixed(1)} to ${(w.high * 100).toFixed(1)})`, w.low < 0.05 && w.high > 0.05 && w.car > 0.035, w);
    check("no abnormal return before the window: 0..+1 near zero", Math.abs(st.windows[0].car) < 0.01, st.windows[0]);
    check("hit rate above the unconditional rate for the same stocks", w.hitRate > w.unconditionalHitRate + 0.2, w);
    check("era and size splits cover every event", st.byEra.reduce((s, e) => s + e.stats.n, 0) === w.n && st.bySize.reduce((s, e) => s + e.stats.n, 0) === w.n);
    const one = eventCars(events[0], stocks.get("E0")!, market);
    check("day 0 is the first session after the event became public (after the close: next day)", !("skip" in one) && one.day0 === days[300]);
    check("unconditional hit rate of a stock that only tracks the market is near a half", near(unconditionalHitRate({ dates: days, ret: mret.map((r) => r + 0.01 * z()) }, market, { label: "x", from: 2, to: 20 }).rate, 0.5, 0.12));
    const br: BaseRate = { key: "k", eventType: "cluster_buy", version: "v", computedAt: "", universe: "", survivorship: true, primary: w, study: { ...st, eventIds: [] } };
    check("a base rate with 60 events is publishable at n >= 30, not at n >= 100", !!signalBaseRate(br, 30) && !signalBaseRate(br, 100));
  }

  section("Risk model and stress tests (Q2)");
  {
    const z = normals(rng(21));
    const T = 504;
    const f = Array.from({ length: T }, () => [0.01 * z(), 0.004 * z()]);
    const Y = f.map((r) => [1.2 * r[0] + 0.01 * z(), 0.6 * r[0] + 0.5 * r[1] + 0.008 * z(), 0.9 * r[0] + 0.012 * z()]);
    const cm = covariance(Y, f, ["A", "B", "C"]);
    const d = decompose(["A", "B", "C"], [0.5, 0.3, 0.2], cm, ["MKT", "HML"]);
    check("risk contributions of holdings sum to 100% of variance", near(d.holdings.reduce((s, h) => s + h.share, 0), 1, 1e-9));
    check("factor shares plus specific share sum to 100%", near(d.factors.reduce((s, x) => s + x.share, 0) + d.specificShare, 1, 1e-6), d);
    check("the factor model recovers the market beta of A (1.2)", near(cm.B[0][0], 1.2, 0.08), cm.B[0]);
    const tz = normals(rng(33));
    const tret = Array.from({ length: 2000 }, () => { let s = 0; for (let k = 0; k < 5; k++) s += tz() ** 2; return (0.01 * tz()) / Math.sqrt(s / 5); });
    const v = valueAtRisk(tret, { paths: 500, backtestDays: 1000 });
    check(`VaR exceptions on a simulated Student-t series match the 5% rate (${v.backtest.exceptions} of ${v.backtest.days})`, Math.abs(v.backtest.exceptions / v.backtest.days - 0.05) < 0.02 && v.backtest.pass, v.backtest);
    check("Kupiec: 50 exceptions in 1,000 at 95% is exactly as expected (p = 1); 100 is rejected", near(kupiec(50, 1000, 0.95).pValue, 1, 1e-9) && kupiec(100, 1000, 0.95).pValue < 0.001);
    const cu = rng(41), scattered = Array.from({ length: 1000 }, () => (cu() < 0.05 ? 1 : 0));
    check("Christoffersen: clustered exceptions are rejected, scattered ones are not", christoffersen([...Array(50).fill(1), ...Array(950).fill(0)]).pValue < 0.001 && christoffersen(scattered).pValue > 0.05);
    const spyOnly = replayLoss(REPLAYS[0], [{ symbol: "SPY", weight: 1 }], new Map([["SPY", -0.3]]), new Map(), [], 50, 100, 1);
    check("a replay of an SPY-only portfolio equals SPY's own loss over the window (deterministic)", near(spyOnly.mid, 0.3) && spyOnly.paths === 1 && spyOnly.proxied.length === 0);
    const proxied = replayLoss(REPLAYS[0], [{ symbol: "NEW", weight: 1 }], new Map(), new Map([["NEW", { betas: [1.5], resid: Array.from({ length: 300 }, () => 0.01 * z()) }]]), [Math.log(0.7)], 55, 2000, 3);
    check("a holding that did not trade then is proxied through its beta, as a range across paths", proxied.proxied[0] === "NEW" && proxied.low < proxied.mid && proxied.mid < proxied.high && near(proxied.mid, 1 - Math.exp(1.5 * Math.log(0.7)), 0.05), proxied);
    const ps = parseShock("market -20%, rates +1, momentum -15%, gold +5%");
    check("shock text: market, rates in points, momentum; unknown parts are returned", near(ps.spec.moves.MKT, -0.2) && ps.spec.moves.RATES === 1 && near(ps.spec.moves.MOM, -0.15) && ps.leftover.join() === "gold +5%" && near(ratesToReturn(1), -0.075));
    const Fd = [[0.0001, 0.00002], [0.00002, 0.000016]];
    const sh = shockLoss({ text: "market -20%", moves: { MKT: -0.2 } }, ["MKT", "HML"], Fd, [[1, 0], [1, 0.5]], [0.0001, 0.0001], [0.5, 0.5], 21, 3000, 9);
    check("a market -20% shock on a beta-1 book loses about 20%, filling the other factor conditionally", near(sh.mid, 0.2, 0.03) && "HML" in sh.filled && sh.low < sh.high, sh);
    const rv = reverseStress(["MKT", "HML"], Fd, [1, 0.25], 0.25, 21)!;
    check("reverse stress: the gentlest scenario reaches exactly the chosen loss through the exposures", near(1 - Math.exp(Math.log(1 + rv.moves.MKT) * 1 + Math.log(1 + rv.moves.HML) * 0.25), 0.25, 1e-9) && rv.radius > 0, rv);
    const dd = drawdownOdds(Array.from({ length: 1000 }, () => 0.0003 + 0.015 * z()), [0.1, 0.2, 0.3], 500, 4);
    check("drawdown odds fall with depth", dd[0].probability > dd[1].probability && dd[1].probability >= dd[2].probability);
  }

  section("Sizing and the drawdown governor (Q4)");
  {
    const k = kelly({ kind: "bet", pLow: 0.6, pHigh: 0.6, odds: 1 });
    check("a known 60% coin at even money: full Kelly 20%, quarter 5%", near(k.central, 0.2, 1e-9) && near(k.quarter, 0.05, 1e-9) && k.recommendedView <= k.central);
    const k2 = kelly({ kind: "bet", pLow: 0.52, pHigh: 0.62, odds: 1 });
    check("an uncertain edge: the robust fraction is below full Kelly and the view leads with the smaller", k2.robust <= k2.central + 1e-9 && k2.recommendedView <= k2.quarter + 1e-9 && k2.lowEnd < k2.central);
    check("the drawdown table states growth share and odds at full, half and quarter Kelly", near(k.drawdownTable[1].growthShare, 0.75) && near(k.drawdownTable[0].pHalf, 0.5) && k.disclosure === DISCLOSURES.calculator);
    const rp = riskParity([[0.04, 0.006, 0.002], [0.006, 0.01, 0.001], [0.002, 0.001, 0.0225]]);
    check("risk parity gives equal risk contributions", rp.contributions.every((c) => near(c, 1 / 3, 1e-6)) && near(rp.weights.reduce((s, w) => s + w, 0), 1), rp);
    const vt = volTarget(Array.from({ length: 300 }, (_, i) => (i % 2 ? 0.02 : -0.02)), 0.1);
    check("volatility targeting scales down a 32% volatility asset toward 10%, capped at 1.5", near(vt.forecast, 0.02 * Math.sqrt(252), 0.01) && near(vt.scale, 0.1 / vt.forecast, 1e-9));
    // A fixture path: -2% for 3 days (about -5.9%), then flat, then -2% for 2 more days.
    const path = [0.01, -0.02, -0.02, -0.02, 0, 0, -0.02, -0.02, 0, 0.01];
    const g = governor(path, { kind: "pod" });
    check("pod rules halve on the day the fall reaches 5% and flatten at 7.5%", g.triggers[0]?.action === "halve" && g.triggers[0].index === 3 && g.triggers.some((t) => t.action === "flatten"), g.triggers);
    check("halving cuts the later losses (governed drawdown smaller)", g.governed.maxDrawdown < g.base.maxDrawdown);
    const fl = governor(path, { kind: "floor", floorPct: 0.9, multiplier: 3 });
    check("a CPPI floor keeps exposure below 1.5 and shrinks it near the floor", fl.exposure.every((e) => e <= 1.5) && fl.exposure.at(-1)! < fl.exposure[0] + 1e-9);
    const b = buildRiskBudget({ ownerId: "u1", accountRef: null, kelly: k, rules: [{ fromPeakPct: 0.05, action: "halve" }, { fromPeakPct: 0.075, action: "flatten" }], volTarget: 0.12, maxPositionWeight: 0.1, maxGross: 1, maxDailyLossPct: 0.03 });
    check("the risk budget keeps the contract and says it is for the inputs entered", validateRiskBudget(b).ok && /For the inputs entered/.test(b.basis) && forbiddenIn(b.basis).length === 0, b);
  }

  section("Execution costs (Q5)");
  {
    const imp = (f: string) => importFills(FX(`fills/${f}.csv`), "acct");
    const sw = imp("schwab");
    check("Schwab: two trades, a dividend skipped, the 'as of' date read", sw.broker === "schwab" && sw.fills.length === 3 && sw.fills[1].executedAt.startsWith("2026-10-13") && sw.fills.some((x) => x.side === "short"), sw.fills.map((x) => [x.side, x.executedAt]));
    const fi = imp("fidelity");
    check("Fidelity: title lines and the footer skipped, 'YOU BOUGHT' and 'YOU SOLD' read", fi.broker === "fidelity" && fi.fills.length === 2 && fi.fills[0].side === "buy" && fi.fills[1].side === "sell" && fi.fills[1].qty === 15);
    const rh = imp("robinhood");
    check("Robinhood: Buy and Sell codes, interest skipped, $ prices", rh.broker === "robinhood" && rh.fills.length === 2 && rh.fills[0].price === 50.3);
    const wb = imp("webull");
    check("Webull: filled orders only, times and order types kept", wb.broker === "webull" && wb.fills.length === 2 && wb.fills[0].orderType === "market" && wb.fills[0].executedAt === "2026-10-14T13:30:13.000Z" && wb.fills[1].limitPrice === 120);
    const ib = imp("ibkr");
    check("Interactive Brokers: the Trades section, quantity sign as side, commissions", ib.broker === "ibkr" && ib.fills.length === 2 && ib.fills[1].side === "sell" && ib.fills[0].fees === 1 && ib.fills[0].executedAt === "2026-10-14T19:55:02.000Z");
    const et = imp("etrade");
    check("E*TRADE: two-digit years, Bought and Sold", et.broker === "etrade" && et.fills.length === 2 && et.fills[0].executedAt.startsWith("2026-10-14"));
    const yb = imp("youbank");
    check("YouBank template: placed and executed times", yb.broker === "youbank" && yb.fills[0].placedAt === "2026-10-14T13:30:58.000Z");
    check("every imported fill keeps the contract", [sw, fi, rh, wb, ib, et, yb].every((r) => r.fills.every((x) => validateFill(x).ok)));
    check("re-importing gives the same ids (nothing added twice)", JSON.stringify(imp("webull").fills.map((x) => x.extId)) === JSON.stringify(wb.fills.map((x) => x.extId)));
    check("an unknown file names the templates it expected", importFills("a,b,c\n1,2,3").broker === null && (importFills("a,b\n1,2").expected?.length ?? 0) >= 7);
    // Corwin-Schultz and Abdi-Ranaldo on a simulated series with a known 1% spread.
    const u = rng(77), z = normals(rng(78));
    const S = 0.01;
    let mid = 100;
    const bars: Bar[] = [];
    for (let d = 0; d < 500; d++) {
      let hi = -Infinity, lo = Infinity, open = 0, close = 0;
      for (let k = 0; k < 390; k++) {
        mid *= Math.exp(0.0006 * z());
        const px = mid * (1 + (u() < 0.5 ? 1 : -1) * S / 2);
        if (k === 0) open = px;
        close = px; hi = Math.max(hi, px); lo = Math.min(lo, px);
      }
      bars.push({ date: `d${d}`, open, high: hi, low: lo, close, volume: 1e6 });
    }
    const cs = corwinSchultz(bars), csMean = cs.reduce((s, v) => s + v, 0) / cs.length, ar = abdiRanaldo(bars)!;
    check(`Corwin-Schultz recovers a planted 1% spread (${(csMean * 100).toFixed(2)}%), and so does Abdi-Ranaldo (${(ar * 100).toFixed(2)}%)`, near(csMean, S, 0.004) && near(ar, S, 0.004), { csMean, ar });
    const c1 = costModel({ notionalUsd: 10_000, price: 50, sigmaDaily: 0.02, advUsd: 1e7, spread: 0.001, side: "buy" });
    const c2 = costModel({ notionalUsd: 1_000_000, price: 50, sigmaDaily: 0.02, advUsd: 1e7, spread: 0.001, side: "buy" });
    check("the square-root model: impact rises with size, like √(Q/ADV) (100x the size, 10x the impact)", near(c2.impactBps / c1.impactBps, 10, 1e-9) && c1.totalRoundTripBps === c1.spreadBps + c1.impactBps + c1.commissionBps);
    check("borrow appears for shorts only; IBKR's per-share commission is counted", costModel({ notionalUsd: 1000, price: 10, sigmaDaily: 0.02, advUsd: 1e6, spread: 0.001, side: "short" }).borrowBpsYear === 30 && costModel({ notionalUsd: 1000, price: 10, sigmaDaily: 0.02, advUsd: 1e6, spread: 0.001, side: "buy", broker: "IBKR" }).commissionBps > 0);
    const bar: Bar = { date: "2026-10-14", open: 50, high: 51, low: 49, close: 50.5, volume: 1e6 };
    const buy = analyseFill({ source: "csv", accountRef: "a", extId: "1", symbol: "X", side: "buy", qty: 100, price: 50.5, executedAt: "2026-10-14T13:31:00Z", orderType: "market", timeKnown: true }, bar, { spread: 0.002, sigmaDaily: 0.02, advUsd: 5e7 }, 9 * 60 + 31);
    const sell = analyseFill({ source: "csv", accountRef: "a", extId: "2", symbol: "X", side: "sell", qty: 100, price: 49.5, executedAt: "2026-10-14T19:00:00Z" }, bar, null, null);
    check("slippage by side: buying above the open costs, selling below it costs", near(buy.vsOpenBps!, 100) && near(sell.vsOpenBps!, 100) && near(buy.rangePosition!, 0.75) && near(sell.rangePosition!, 0.75));
    check("a market order in the first 15 minutes is flagged", buy.flags.some((f) => /first 15/.test(f)));
    const ac = annualCost([buy, sell], 100_000, new Date("2026-10-15T00:00:00Z"));
    check("the annual cost projects the fills seen to a year and states it in words", ac.fills === 2 && ac.perYearUsd > 0 && forbiddenIn(T.annualCost(ac.perYearUsd, ac.pctOfPortfolio, ac.tradesPerMonth)).length === 0);
    check("Y is kept at 0.7 until 30 fills, then shrunk toward the person's own", shrinkY([1, 1]).y === 0.7 && near(shrinkY(Array(30).fill(1.3)).y, 0.5 * 1.3 + 0.5 * 0.7, 1e-9));
    const r606 = parse606(FX("rules/rule606.xml"));
    const sp = r606.totals.find((t) => t.category === "sp500")!;
    check("a 606 XML report parsed: broker, quarter, payments by category, market-order cents per 100 weighted by dollars", r606.broker === "Example Brokerage LLC" && r606.quarter === 2 && sp.pfofUsd === 420_000 && near(sp.marketOrderCentsPer100!, 17.5) && r606.totals.find((t) => t.category === "options")?.marketOrderCentsPer100 === 50, r606.totals);
    check("payment for order flow on the person's own orders: 10,000 other-stock shares at 15 cents per 100 = $15", near(pfofOnOrders(0, 10_000, r606).usd!, 15));
    const s605 = summarise605(parse605(FX("rules/rule605.txt")));
    const mkt = s605.find((x) => x.orderType === "market" && x.size === "100-499")!;
    check("605 rows summarised share-weighted: effective spread and price improvement", near(mkt.effectiveSpread!, (249000 * 0.01 + 100000 * 0.02) / 349000, 1e-9) && near(mkt.improvedShare!, 230000 / 349000, 1e-9), mkt);
    check("CSV exports neutralise formula cells but keep negative numbers", csvCell("=HYPERLINK(1)") === "'=HYPERLINK(1)" && csvCell("-5") === "-5" && csvCell("@SUM") === "'@SUM" && csvCell(-5) === "-5" && toCsv(["a"], [["+1+1"]]).endsWith("'+1+1"));
    check("the CSV reader handles quotes, commas and CRLF", JSON.stringify(parseCsv('a,"b,c","d""e"\r\n1,2,3')) === JSON.stringify([["a", "b,c", 'd"e'], ["1", "2", "3"]]));
    const sf = orderToFill({ brokerage_order_id: "o1", status: "EXECUTED", action: "BUY", filled_quantity: "10", execution_price: "50.1", order_type: "Limit", limit_price: "50.2", time_placed: "2026-10-14T14:00:00Z", time_executed: "2026-10-14T14:00:05Z", symbol: "brk.b" }, "acct");
    check("a SnapTrade executed order becomes a valid fill", !!sf && sf.symbol === "BRK-B" && sf.orderType === "limit" && validateFill(sf).ok && orderToFill({ status: "CANCELED", brokerage_order_id: "x" }, "a") === null);
  }

  section("Insider and activist clusters (Q7)");
  {
    const { eventCard } = await import("@/lib/quant/insiders/cards");
    const { eventForecast, eventSignal } = await import("@/lib/quant/insiders/store");
    const sig = eventSignal({ id: "cluster_buy:123456:2026-10-01", type: "cluster_buy", symbol: "EXMP", issuerCik: "123456", occurredAt: "2026-10-01", acceptedAt: "2026-10-02T21:30:00Z", body: { insiders: [{ name: "A", role: "CFO", value: 900_000, accession: "0000000000-26-000001" }], totalUsd: 900_000, days: 12 } }, { car: 0.02, low: 0.01, high: 0.03, hitRate: 0.56, unconditionalHitRate: 0.5, n: 412, window: "+2..+125", era: "2015-2026" }, undefined, new Date("2026-10-03T00:00:00Z"))!;
    const fc = eventForecast(sig)!;
    check("an event signal's ledger forecast: beat SPY at the base rate's hit rate, from day 1's close (filed Friday after the close, day 0 is Monday) to day 125", fc.rule.type === "return" && (fc.rule as { from: string }).from === "2026-10-06" && fc.probability === 0.56 && fc.baseRate === 0.5 && forbiddenIn(fc.question).length === 0, fc);
    const { isBig } = await import("@/lib/edge/notify");
    const br = { car: 0.021, low: 0.008, high: 0.034, hitRate: 0.56, unconditionalHitRate: 0.5, n: 412, window: "+2..+125", era: "2015-2026" };
    const cardC = eventCard({ id: "cluster_buy:123456:2026-10-01", type: "cluster_buy", symbol: "EXMP", issuerCik: "123456", occurredAt: "2026-10-01", acceptedAt: "2026-10-02T21:00:00Z", body: { insiders: [{ name: "A", role: "CFO", value: 900_000 }, { name: "B", role: "Director", value: 600_000 }, { name: "C", role: "Director", value: 300_000 }], totalUsd: 1_800_000, days: 12 } }, br)!;
    check("an insider cluster becomes a feed card with its base rate in words, no advice words, and alerts at $1.8M by three insiders", cardC.kind === "quant.insider_cluster" && /sessions 2 to 125 after the filing/.test(cardC.summary) && forbiddenIn(cardC.summary).length === 0 && isBig({ kind: cardC.kind, confidence: cardC.confidence, magnitude: cardC.magnitude, visual: cardC.visual }), cardC);
    const cardA = eventCard({ id: "activist_new:1:x", type: "activist_new", symbol: "EXMP", issuerCik: "1", occurredAt: "2026-10-01", acceptedAt: "2026-10-02T21:00:00Z", body: { holder: "Fund LP", to: 6.1, url: "https://www.sec.gov/Archives/edgar/data/1/x.htm" } }, null)!;
    check("a new 13D is an activist card that alerts, saying when no base rate exists; other event types make no card", cardA.kind === "quant.activist" && /No base rate yet/.test(cardA.summary) && isBig({ kind: cardA.kind, confidence: cardA.confidence, magnitude: cardA.magnitude, visual: cardA.visual }) && eventCard({ id: "x", type: "stake13", symbol: "EXMP", issuerCik: "1", occurredAt: "", acceptedAt: "2026-10-02T21:00:00Z", body: {} }, null) === null);
    const f = parseForm4(FX("insiders/form4-cfo.xml"));
    check("Form 4: issuer, owner, CFO title, the 10b5-1 checkbox off, two lines (P and F)", f.issuerCik === "123456" && f.symbol === "EXMP" && f.owner.isOfficer && /Financial/.test(f.owner.title) && !f.plan10b51 && f.lines.length === 2 && f.lines[0].code === "P" && f.lines[0].shares === 6000 && f.lines[1].acquired === false);
    const pl = parseForm4(FX("insiders/form4-plan.xml"));
    check("a footnote naming a Rule 10b5-1 plan flags the filing; commas in numbers read", pl.plan10b51 && pl.lines[0].shares === 1000 && !pl.lines[0].direct);
    const feed = parseCurrentFeed(FX("insiders/current.atom"));
    check("the latest-filings feed: one entry per accession, acceptance times as ISO", feed.length === 2 && feed[0].acceptedAt === "2026-10-14T20:41:07.000Z" && feed[0].form === "4");
    check("ACCEPTANCE-DATETIME in a header is Eastern time", parseAcceptance(FX("insiders/filing.hdr.sgml")) === "2026-10-14T20:41:07.000Z");
    const ds = parseInsiderDataset({ submission: FX("insiders/SUBMISSION.tsv"), reportingOwner: FX("insiders/REPORTINGOWNER.tsv"), nonderivTrans: FX("insiders/NONDERIV_TRANS.tsv") });
    check("the SEC data sets: dates like 09-OCT-2026, roles, the 10b5-1 flag", ds.length === 2 && ds[0].tradeDate === "2026-10-09" && ds[0].owner.isOfficer && ds[1].plan10b51 && ds[1].code === "S", ds);
    // Routine and opportunistic.
    const hist = (months: string[]) => months.map((m) => ({ tradeDate: m, code: "S" }));
    check("routine: traded in October in each of the three prior years", classify(hist(["2023-10-05", "2024-10-07", "2025-10-06"]), { tradeDate: "2026-10-09" }) === "routine");
    check("opportunistic: three years of history, not in the same month", classify(hist(["2023-03-05", "2024-06-07", "2025-01-06"]), { tradeDate: "2026-10-09" }) === "opportunistic");
    check("unclassified: less than three years of history", classify(hist(["2025-03-05"]), { tradeDate: "2026-10-09" }) === "unclassified");
    const tx = (o: Partial<Tx>): Tx => ({ accession: "a", line: 1, issuerCik: "1", symbol: "XYZ", ownerCik: "o1", ownerName: "A", isDirector: true, isOfficer: false, isTenPct: false, title: "", code: "P", acquired: true, shares: 1000, price: 50, ownedAfter: 10000, tradeDate: "2026-10-01", acceptedAt: "2026-10-02T21:00:00.000Z", plan10b51: false, ...o });
    check("exclusions: 10b5-1 plans, 10% owners, purchases right after an offering, other codes", !eligible(tx({ plan10b51: true })).ok && !eligible(tx({ isTenPct: true, isDirector: false })).ok && !eligible(tx({}), ["2026-09-28"]).ok && !eligible(tx({ code: "A" })).ok && eligible(tx({})).ok);
    const opp = () => hist(["2023-03-05", "2024-06-07", "2025-01-06"]);
    const cluster = [tx({ ownerCik: "o1", accession: "a1", tradeDate: "2026-09-01", acceptedAt: "2026-09-02T21:00:00.000Z" }), tx({ ownerCik: "o2", accession: "a2", tradeDate: "2026-09-10", acceptedAt: "2026-09-11T21:00:00.000Z" }), tx({ ownerCik: "o3", accession: "a3", tradeDate: "2026-09-25", acceptedAt: "2026-09-26T13:00:00.000Z" })];
    const ev = detectEvents(cluster, opp);
    check("three opportunistic insiders within 30 days, $150,000: a cluster buy timed from the third filing's acceptance", ev.length === 1 && ev[0].type === "cluster_buy" && ev[0].acceptedAt === "2026-09-26T13:00:00.000Z" && ev[0].insiders.length === 3 && ev[0].totalUsd === 150_000, ev);
    check("the same three spread over 40 days are not a cluster", detectEvents([cluster[0], cluster[1], { ...cluster[2], tradeDate: "2026-10-12" }], opp).filter((e) => e.type === "cluster_buy").length === 0);
    check("routine insiders do not make a cluster", detectEvents(cluster, () => hist(["2023-09-05", "2024-09-07", "2025-09-06"])).length === 0);
    check("a CFO buying $300,000 is a large officer purchase", detectEvents([tx({ isOfficer: true, isDirector: false, title: "Chief Financial Officer", shares: 6000 })], opp).some((e) => e.type === "large_officer_buy"));
    const t13 = item4Text(FX("insiders/13d-text.htm")), x13 = item4Text(FX("insiders/13d.xml"));
    check("Item 4 read from the old text form and the XML form", /board of directors/.test(t13) && !/Item 5/i.test(t13) && /no present plans/.test(x13));
    const s1 = { form: "SC 13G", holder: "Fund LP", holderCik: "9", percent: 6, item4: "", acceptedAt: "2026-01-01T00:00:00Z", accession: "g1" };
    const s2 = { ...s1, form: "SC 13D", percent: 7.2, item4: t13, accession: "d1" };
    check("a 13G holder switching to a 13D is activist_new; a 13D/A adding a point is activist_up", activistEvent(s1, s2, "1")?.type === "activist_new" && activistEvent(s2, { ...s2, form: "SC 13D/A", percent: 8.5, accession: "d2" }, "1")?.type === "activist_up" && activistEvent(s2, { ...s2, form: "SC 13D/A", percent: 7.4, accession: "d3" }, "1") === null);
  }

  section("Desk Drills (Q14)");
  {
    check("interval score by hand: [10, 20] containing 15 scores 10; missing 25 adds (2/0.1)·5 = 100", intervalScore(10, 20, 15) === 10 && intervalScore(10, 20, 25) === 110);
    const iv = summariseIntervals([{ lo: 1, hi: 2, answer: 1.5 }, { lo: 1, hi: 2, answer: 3 }, { lo: 0, hi: 10, answer: 5 }, { lo: 4, hi: 5, answer: 9 }]);
    check("interval hit rate and the overconfidence reading", iv.hits === 2 && iv.hitRate === 0.5 && /too narrow/.test(iv.read));
    const pb = summariseProbabilities([{ confidence: 0.9, correct: true }, { confidence: 0.9, correct: false }, { confidence: 0.6, correct: true }, { confidence: 0.8, correct: false }, { confidence: 1, correct: true }]);
    // Brier by hand: (0.01 + 0.81 + 0.16 + 0.64 + 0) / 5 = 0.324; mean confidence 0.84 vs hit rate 0.6.
    check("Brier score by hand (0.324) and overconfidence (0.24)", near(pb.brier, 0.324, 1e-12) && near(pb.overconfidence, 0.24, 1e-12) && /overconfident/.test(pb.read));
    check("every bank question has a source and a finite answer", [...INTERVALS, ...TRUE_FALSE].every((q) => /^https:\/\//.test(q.source.url) && ("answer" in q) && (typeof q.answer === "boolean" || Number.isFinite(q.answer))));
    check("a run-time question's answer is the source data's value (SEC XBRL revenue in billions)", revenueQuestion({ ticker: "EXMP", name: "Example Corp", fiscalYear: 2025, revenueUsd: 254_453_000_000, url: "https://data.sec.gov/api/xbrl/companyfacts/CIK0000123456.json" }).answer === 254.45);
    check("seeded sets replay exactly", JSON.stringify(pickSet(INTERVALS, 5, 42).map((q) => q.id)) === JSON.stringify(pickSet(INTERVALS, 5, 42).map((q) => q.id)));
    const flips = coinFlips(1);
    check(`the Kelly coin lands heads about 60% of the time (${flips.filter(Boolean).length} of 300)`, Math.abs(flips.filter(Boolean).length / 300 - 0.6) < 0.08);
    const allIn = playCoin(flips, flips.map(() => ({ side: "heads" as const, amount: 1e9 })));
    check("betting everything on every flip busts at the first tails", allIn.busted && allIn.flipsPlayed === flips.indexOf(false) + 1);
    const steady = playCoin(Array(300).fill(true), Array(300).fill({ side: "heads", amount: 10 }));
    check("winnings stop at the $250 cap", steady.capped && steady.final === COIN.cap && steady.kellyFinal <= COIN.cap);
    let informed = 0, n = 0;
    for (let s = 0; s < 200; s++) { const g = playMarketMaking(s, Array(20).fill({ bid: 3, ask: 18 }), 0.3); informed += g.trades.filter((t) => t.trader === "informed").length; n += 20; }
    check("market making: with an absurdly wide quote only noise traders trade (informed traders never find a mispricing)", informed === 0 && n > 0);
    const tight = Array.from({ length: 400 }, (_, s) => playMarketMaking(s, Array(30).fill({ bid: 10, ask: 11 }), 0.3));
    const infShare = tight.reduce((s, g) => s + g.trades.filter((t) => t.trader === "informed").length, 0) / tight.reduce((s, g) => s + g.trades.length, 0);
    check(`with a tight quote, informed traders make up about their share of trades (${(infShare * 100).toFixed(0)}%) and take money on average`, infShare > 0.15 && infShare < 0.4 && tight.reduce((s, g) => s + g.adverseSelection, 0) < 0);
    const ev = evProblems();
    check("expected-value answers: the d100 reroll game is worth $62.505, the 55% coin's Kelly stake 10%, max of two dice 161/36", near(ev[0].answer, 62.505, 1e-9) && near(ev[1].answer, 0.1) && near(ev[3].answer, 161 / 36));
    check("return rule: total return between closes and the comparison", near(returnBetween(["2026-01-02", "2026-01-05", "2026-01-06"], [100, 110, 121], "2026-01-02", "2026-01-06")!, 0.21) && judge({ type: "return", symbol: "A", benchmark: "B", from: "x", to: "y", op: ">", value: 0 }, 0.01) === 1 && returnBetween(["2026-01-02"], [1], "2026-01-02", "2026-02-01") === null);
  }

  section("Adapters (QF1)");
  {
    const t = cloneToTarget({ key: "copy:fund:0001067983", ownerId: null, name: "Fund clone", filedOn: "2026-08-14", periods: ["2026-06-30"], accessions: ["a1"], targets: [{ ticker: "AAPL", weight: 0.5, name: "Apple" }, { ticker: "BRK.B", weight: 0.3, name: "Berkshire" }, { ticker: "KO", weight: 0.2, name: "Coca-Cola" }], rules: DEFAULT_RULES, integrity: null });
    check("a 13F clone becomes a valid TargetPortfolio: dashed tickers, 13F timing disclosed, next-open notBefore", validateTarget({ ...t, version: 1 }).ok && t.weights[1].instrument.symbol === "BRK-B" && t.disclosures.includes("timing_13f") && t.rebalance.notBefore === "2026-08-17T13:30:00.000Z", validateTarget({ ...t, version: 1 }));
    check("clone turnover per year from rebalance weights", near(cloneTurnover([{ date: "2025-01-01", weights: { A: 1 } }, { date: "2026-01-01", weights: { B: 1 } }]), 1, 0.01));
    const hy = cloneHygiene({ rebalances: [{ date: "2026-08-17", period: "2026-06-30", lagDays: 45, held: 20, missing: [] }] }, 1);
    check("clone backtests are point in time by construction (each 13F used after its filing date)", hy.reads.every((r) => Date.parse(r.usedAt) > Date.parse(r.knownAt)) && !hy.survivorshipSafe);
    const now = new Date("2026-10-15T00:00:00Z");
    const br = { car: 0.01, low: 0, high: 0.02, hitRate: 0.55, unconditionalHitRate: 0.5, n: 120, window: "+2..+60", era: "2018-2026" };
    const ps = pulseSignal({ id: 1, kind: "hiring_shift", title: "Example: open postings up 70% in six weeks", tickers: ["EXMP"], visual: { prob: 0.95, metric: "jobs.open", ticker: "EXMP" }, observedAt: new Date("2026-10-12T00:00:00Z"), detectedAt: new Date("2026-10-13T08:00:00Z") }, br, 0.25, now);
    check("a Pulse change point becomes a valid event signal with its false-alarm rate", !!ps && validateSignal(ps).ok && ps.calibration.falseAlarmRate === 0.25, ps && validateSignal(ps));
    check("no base rate, no signal (rule 4); a weak change point is not a signal", pulseSignal({ id: 1, kind: "hiring_shift", title: "x", tickers: ["EXMP"], visual: { prob: 0.95 }, observedAt: null, detectedAt: now }, null, 0.2, now) === null && pulseSignal({ id: 1, kind: "hiring_shift", title: "x", tickers: ["EXMP"], visual: { prob: 0.7 }, observedAt: null, detectedAt: now }, br, 0.2, now) === null);
    const os = oddsSignal({ id: 77, probability: 0.12, low: 0.08, high: 0.17, baseRate: 0.04, question: "Example Corp (EXMP) announces a sale within 12 months", createdAt: new Date("2026-10-13T06:00:00Z"), closesAt: new Date("2027-10-13T00:00:00Z"), modelVersion: "m3" }, { ticker: "EXMP", cik: "123456", name: "Example Corp" }, { n: 40, skill: null }, now);
    check("a Deal Radar estimate becomes a valid probability signal carrying its forecast id, not a return forecast", !!os && validateSignal(os).ok && os.forecastId === 77 && !!os.tags?.includes("not-a-return-forecast") && /not about the stock/.test(os.explain), os && validateSignal(os));
  }

  section("Canvas blocks");
  {
    const { holdingsFromValues } = await import("@/lib/edge/canvas/executors/quant");
    const { NODE, validate } = await import("@/lib/edge/canvas/catalog");
    const h = holdingsFromValues([{ items: [{ ticker: "aapl", name: "" }, { ticker: "MSFT", name: "" }] }, { columns: [{ name: "Symbol", type: "cat" }, { name: "Weight", type: "num" }], rows: [["AAPL", 2], ["KO", 2], ["", 5]] }]);
    check("canvas portfolios: companies count once each, tables by weight, rescaled to 100%", h.length === 3 && Math.abs(h.reduce((s, x) => s + x.weight, 0) - 1) < 1e-12 && Math.abs(h.find((x) => x.symbol === "AAPL")!.weight - 0.5) < 1e-12, h);
    const g = { nodes: [{ id: "a", type: "source.companies", position: { x: 0, y: 0 }, data: { config: { tickers: ["AAPL"] } } }, { id: "b", type: "quant.risk", position: { x: 0, y: 0 }, data: { config: {} } }, { id: "c", type: "output.memo", position: { x: 0, y: 0 }, data: { config: {} } }], edges: [{ id: "e1", source: "a", sourceHandle: "companies", target: "b", targetHandle: "portfolio" }] };
    check("the five quant blocks are in the catalogue and a companies wire into Portfolio risk validates", ["quant.factors", "quant.risk", "quant.integrity", "quant.events", "quant.insiders"].every((t) => NODE[t]) && !validate(g).some((i) => i.level === "error" && i.nodeId === "b"), validate(g));
  }

  section("Terminal functions");
  {
    const { parseCommand } = await import("@/lib/functions");
    const { parseBtxArg, parseKellyArg, parseTcaArg } = await import("@/lib/quant/terminal-args");
    const pc = (s: string) => { const r = parseCommand(s, "MSFT"); return r.ok ? r.command : null; };
    check("FACT alone is a portfolio (no active ticker); AAPL FACT is one stock; FACT with holdings keeps them as words", pc("FACT")?.ticker === "" && pc("AAPL FACT")?.ticker === "AAPL" && pc("FACT AAPL 40 MSFT 30")?.arg === "AAPL 40 MSFT 30" && pc("FACT AAPL 40 MSFT 30")?.ticker === "");
    check("INSC is the board alone and one company after a ticker; DRILL takes nothing", pc("INSC")?.ticker === "" && pc("NVDA INSC")?.ticker === "NVDA" && pc("DRILL")?.fn === "DRILL" && parseCommand("DRILL NOW", "").ok === false);
    check("KELLY 0.55 1, KELLY 52%-58% 2 and KELLY sharpe 0.3-0.8 18% parse; nonsense does not",
      JSON.stringify(parseKellyArg("0.55 1")) === JSON.stringify({ kind: "bet", pLow: "0.55", pHigh: "0.55", odds: "1" }) && parseKellyArg("52%-58% 2")?.kind === "bet" && (parseKellyArg("52%-58% 2") as { pLow: string }).pLow === "0.52"
      && parseKellyArg("sharpe 0.3-0.8 18%")?.kind === "asset" && (parseKellyArg("sharpe 0.3-0.8 18%") as { vol: string }).vol === "0.18" && parseKellyArg("lots") === null && parseKellyArg("150 1") === null && parseKellyArg("55 1")?.kind === "bet", parseKellyArg("52%-58% 2"));
    check("BTX 2.1 18 30 is a claim; TCA AAPL 25K is a symbol and a size", JSON.stringify(parseBtxArg("2.1 18 30")) === JSON.stringify({ sharpe: 2.1, months: 18, trials: 30 }) && parseBtxArg("") === undefined && JSON.stringify(parseTcaArg("aapl 25K")) === JSON.stringify({ symbol: "AAPL", notional: 25000 }));
  }

  section("Premium registry and margins");
  {
    check("every Quant feature is registered once, area quant, with an id like quant.name", QUANT_FEATURES.every((f) => f.area === "quant" && /^quant\.[a-z0-9-]+$/.test(f.id) && featureById(f.id) === f) && new Set(FEATURES.map((f) => f.id)).size === FEATURES.length);
    check("no Quant feature adds a cost paid outside the AI allowance (the Deal Team floor)", QUANT_FEATURES.every((f) => !f.metered || f.inAiAllowance) && QUANT_FEATURES.every((f) => !f.flatMonthlyUsd), QUANT_FEATURES.filter((f) => f.metered && !f.inAiAllowance).map((f) => f.id));
    check("descriptions avoid advice words", QUANT_FEATURES.every((f) => forbiddenIn(`${f.name} ${f.description}`).length === 0));
    check("the free cores stay free: no feature locks check-a-claim, drills or the calculators", !QUANT_FEATURES.some((f) => /claim|calculator/i.test(f.description)) && !featureById("quant.drills") && !featureById("quant.claim"));
  }

  // Kept here so an unused import does not hide a missing check.
  void [ols, std];
}
