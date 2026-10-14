/**
 * Checks for Edge's next round (docs/edge-next.md): the entity crosswalk (F1), the change library and its
 * false-alarm rate (F2), the calibration library and the forecast ledger's rules (F3), Calibrated Claims
 * (E2), the Precedent Engine (E1), the Alt-Data Pulse (E3) and the Deal Radar (E4), plus the premium
 * registry for these features. No network, no database: parsers run on saved fixtures under
 * scripts/fixtures/, models on synthetic data with known answers.
 *   pnpm exec tsx scripts/test-edge-next.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ACCEPT, atsBoardsIn, boardMoved, careersLinks, domainOf, jaroWinkler, nameScore, normEntity, statusFor, tokenGuess } from "@/lib/edge/entities/crosswalk";
import { cleanValue } from "@/lib/edge/entities/resolve";
import { parseWikidata, wikidataQuery } from "@/lib/edge/entities/sources/wikidata";
import { parseAssignees, parseRecipients } from "@/lib/edge/entities/sources/registries";
import { alarmsOver, blockShuffle, bocpd, changeVerdict, falseAlarmSentence, monthStart, placeboRate, robustZ, seasonalBeats, seasonalNaive, weekOf, weeksBetween } from "@/lib/edge/series/change";
import { metricDef } from "@/lib/edge/series/metrics";
import { auroc, bootstrapCi, brier, brierSkill, coverage, ece, isotonicAt, isotonicFit, jeffreys, logisticAt, logisticContrib, logisticFit, logLoss, murphy, plattAt, plattFit, prAuc, reliabilityBins, softmax, splitConformal, temperatureFit, topLift, vennAbers, vennAbersSet } from "@/lib/edge/calib";
import { closeAfter, resolveDeal, resolveXbrl, standingAtHorizon, worthLogging } from "@/lib/edge/forecasts/rules";
import { MIN_SCORED, trackSummary } from "@/lib/edge/forecasts/track";
import { anonymise } from "@/lib/edge/forecasts/ledger";
import { normals, rng } from "@/lib/edge/scen/stats";
import { checkNumbers, extractNumbers, sameNumber } from "@/lib/edge/claims/numbers";
import { claimFeatures, entityAgreement, headerCompany, periodAgreement, periodsIn, reasonsOf } from "@/lib/edge/claims/features";
import { rateAbove, strictThreshold, upperBound } from "@/lib/edge/claims/conformal";
import { dotOf, fitCombiner, lineFor, strictFooter, supportOf, type Labelled } from "@/lib/edge/claims/combine";
import { combiner, crosscheckModel } from "@/lib/edge/claims/verify";
import { askWants } from "@/lib/edge/docs/answer";
import { loadFixture } from "./eval-claims";
import { buyerTypeOf, considerationOf, fmtMoney, moneyAll, parseCount, parseDate, parseDays, parseMoney, parsePercent, parseRange, parseRatio, wordsToNumber } from "@/lib/edge/deals/parse";
import { docKindOf, headingKey, locateSections, SECTIONS_BY_KIND } from "@/lib/edge/deals/sections";
import { checkField, crossChecks, feeShare, readValue } from "@/lib/edge/deals/checks";
import { confidenceOf, fitConfidence, MIN_LABELLED, priorAt, rawScore } from "@/lib/edge/deals/confidence";
import { FIELD, FIELDS, fieldsFor } from "@/lib/edge/deals/fields";
import { cosine, kernel, recallAtK, sicMatch, similarity, whyChips, type DealLite } from "@/lib/edge/deals/similar";
import { bandSentence, conformalBand, knnPredict, trimmedStats } from "@/lib/edge/deals/range";
import { docsFromHits, cleanName, monthEnd, nextMonth, type EftsHit } from "@/lib/edge/deals/discover";
import { dealsLeft, readingPolicy } from "@/lib/edge/deals/jobs";
import { byFamily, confidenceLine, footballField, shownFields, timeline, valueText } from "@/lib/edge/deals/view";
import { factsAsOf } from "@/lib/edge/deals/facts";
import { dealCsv } from "@/lib/edge/deals/export";
import { partsFromHtml } from "@/lib/edge/docs/html";
import { premiumOf } from "@/lib/news/deals";
import { EDGE_NEXT_FEATURES } from "@/lib/billing/features/edge-next";
import { FEATURES } from "@/lib/billing/features";
import { isPlanId, PLAN_ORDER } from "@/lib/billing/plans";

let pass = 0, fail = 0;
export const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const fixture = (...p: string[]) => readFileSync(path.join(__dirname, "fixtures", ...p), "utf8");
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

/** Synthetic binary outcomes with known probabilities: score s, truth p = sigmoid(2s - 1). */
function synthetic(n: number, seed: number) {
  const u = rng(seed), z = normals(u);
  const s: number[] = [], p: number[] = [], y: number[] = [];
  for (let i = 0; i < n; i++) { const x = z(); const pi = 1 / (1 + Math.exp(-(2 * x - 1))); s.push(x); p.push(pi); y.push(u() < pi ? 1 : 0); }
  return { s, p, y };
}

async function main() {
  console.log("premium registry for these features");
  {
    const ids = EDGE_NEXT_FEATURES.map((f) => f.id);
    check("every id is edge.<name>, unique across all areas", EDGE_NEXT_FEATURES.every((f) => /^edge\.[a-z0-9-]+$/.test(f.id) && f.area === "edge") && new Set(FEATURES.map((f) => f.id)).size === FEATURES.length, ids);
    check("section 6's fifteen ids are all registered", ["edge.deals-reread", "edge.deals-export", "edge.deals-private", "edge.claims-crosscheck", "edge.pulse-daily", "edge.pulse-licensed", "edge.odds-screener", "edge.odds-pairs", "edge.calls-eva", "edge.calls-peers", "edge.lbo-refine", "edge.thesis-plus", "edge.thesis-deep", "edge.thesis-team", "edge.voice-realtime"].every((id) => ids.includes(id)));
    check("each needs a plan above Free", EDGE_NEXT_FEATURES.every((f) => isPlanId(f.minPlan) && PLAN_ORDER.indexOf(f.minPlan) > 0));
    check("metered features carry a cost and what a use is; perks cost nothing", EDGE_NEXT_FEATURES.every((f) => (f.metered ? (f.costPerUseUsd ?? 0) > 0 && !!f.perUse : f.costPerUseUsd === 0 && !!f.perUse)));
    check("descriptions are one plain sentence", EDGE_NEXT_FEATURES.every((f) => f.description.length < 200 && /\.$/.test(f.description)));
    check("what this round built is not marked planned; the next round's is", ["edge.deals-reread", "edge.deals-export", "edge.claims-crosscheck", "edge.pulse-daily", "edge.odds-screener"].every((id) => !EDGE_NEXT_FEATURES.find((f) => f.id === id)?.planned) && ["edge.calls-eva", "edge.lbo-refine", "edge.thesis-plus", "edge.voice-realtime", "edge.odds-pairs", "edge.deals-private"].every((id) => EDGE_NEXT_FEATURES.find((f) => f.id === id)?.planned));
    check("the costs are section 6's", EDGE_NEXT_FEATURES.find((f) => f.id === "edge.deals-reread")?.costPerUseUsd === 0.24 && EDGE_NEXT_FEATURES.find((f) => f.id === "edge.claims-crosscheck")?.costPerUseUsd === 0.03 && EDGE_NEXT_FEATURES.find((f) => f.id === "edge.thesis-deep")?.costPerUseUsd === 2.5);
  }

  console.log("F1 entity crosswalk: names");
  {
    check("Jaro-Winkler: the textbook pairs", near(jaroWinkler("martha", "marhta"), 0.961, 0.001) && near(jaroWinkler("dixon", "dicksonx"), 0.813, 0.001) && jaroWinkler("abc", "abc") === 1 && jaroWinkler("", "a") === 0);
    check("normalisation drops legal words, SEC suffixes and punctuation", normEntity("KINDER MORGAN INC /DE/") === "kinder morgan" && normEntity("The Procter & Gamble Company") === "procter gamble" && normEntity("Énergie Société S.A.") === "energie societe" && normEntity("ONEOK INC /NEW/") === "oneok");
    const same: [string, string][] = [
      ["ENERGY TRANSFER LP", "Energy Transfer L.P."], ["Apple Inc.", "APPLE INC"], ["Exxon Mobil Corporation", "EXXON MOBIL CORP"], ["ExxonMobil", "Exxon Mobil Corp"],
      ["Targa Resources Corp.", "TARGA RESOURCES CORP"], ["Lockheed Martin Corporation", "LOCKHEED MARTIN CORP"], ["The Boeing Company", "BOEING CO"], ["Kinder Morgan, Inc.", "KINDER MORGAN INC /DE/"],
      ["ONEOK INC /NEW/", "ONEOK, Inc."], ["General Dynamics Corp", "GENERAL DYNAMICS CORPORATION"], ["Raytheon Technologies Corporation", "RAYTHEON TECHNOLOGIES CORP"], ["International Business Machines Corporation", "INTERNATIONAL BUSINESS MACHINES CORP"],
      ["Alphabet Inc.", "ALPHABET INC."], ["Johnson & Johnson", "JOHNSON AND JOHNSON"], ["AT&T Inc.", "AT&T INC"], ["3M Company", "3M CO"],
      ["Procter & Gamble Co", "PROCTER & GAMBLE COMPANY, THE"], ["Palantir Technologies Inc.", "PALANTIR TECHNOLOGIES INC."], ["Stripe, Inc.", "Stripe"], ["Williams Companies Inc", "WILLIAMS COMPANIES, INC., THE"],
      ["Halliburton Company", "Haliburton Company"], ["Chesapeake Energy Corp", "Chesapeak Energy Corporation"], ["Schlumberger Limited", "SCHLUMBERGER LTD"], ["Cheniere Energy, Inc.", "CHENIERE ENERGY INC"],
    ];
    const traps: [string, string][] = [
      ["Energy Transfer", "Energy Transfer Equity"], ["Apple", "Apple Hospitality REIT"], ["Energy Transfer LP", "Sunoco LP"], ["Kinder Morgan Inc", "Kinder Morgan Energy Partners"],
      ["Delta Air Lines", "Delta Apparel"], ["Southern Company", "Southern Copper Corp"], ["Plains All American Pipeline", "Plains GP Holdings"], ["General Electric", "General Motors"],
      ["American Airlines Group", "American Express"], ["Targa Resources", "Tellurian Resources"], ["Oracle Corporation", "Oracle Energy Corp"], ["Ford Motor Co", "Ford Foundation"],
      ["Shell plc", "Shell Midstream Partners"], ["Marathon Oil", "Marathon Petroleum"], ["Northrop Grumman Corp", "Northrop Grumman Systems Corporation"], ["Enterprise Products Partners", "Enterprise Holdings"],
    ];
    const missesSame = same.filter(([a, b]) => nameScore(a, b).score < ACCEPT).map(([a, b]) => [a, b, nameScore(a, b).score]);
    const passesTrap = traps.filter(([a, b]) => nameScore(a, b).score >= ACCEPT).map(([a, b]) => [a, b, nameScore(a, b).score]);
    check(`all ${same.length} true pairs reach the ${ACCEPT} line`, missesSame.length === 0, missesSame);
    check(`all ${traps.length} traps stay below it (namesakes, affiliates, subsidiaries wait for a person)`, passesTrap.length === 0, passesTrap);
    check("40 fixture pairs in all", same.length + traps.length === 40);
    const eq = nameScore("Energy Transfer", "Energy Transfer Equity");
    check("an extra distinctive word is named in the method", eq.extra.join() === "equity" && /extra word "equity"/.test(eq.method));
    check("below the line a link waits for review; at it, it is used", statusFor(0.89) === "review" && statusFor(0.9) === "active");
    check("a name as a board token", tokenGuess("Energy Transfer LP") === "energytransfer" && tokenGuess("Rotor Labs, Inc.") === "rotorlabs");
    check("values are compared case-blind, Wikipedia titles kept", cleanValue("greenhouse", " AcmeMidstream ") === "acmemidstream" && cleanValue("wikipedia", "Energy Transfer Partners") === "Energy_Transfer_Partners");
  }

  console.log("F1 entity crosswalk: domains and careers pages");
  {
    check("registrable domains", domainOf("https://careers.energytransfer.com/jobs") === "energytransfer.com" && domainOf("www.bp.co.uk") === "bp.co.uk" && domainOf("http://localhost") === null && domainOf("acme.com") === "acme.com");
    const home = fixture("entities", "home.html");
    const links = careersLinks(home, "https://acme.example/");
    check("careers links are found and made absolute, careers before jobs, mail links skipped", links[0] === "https://acme.example/careers" && links.includes("https://acme.example/join-us") && !links.some((l) => l.startsWith("mailto")), links);
    const gh = atsBoardsIn(fixture("entities", "careers-greenhouse.html"), "https://acme.example/careers");
    check("a Greenhouse link and its script embed are one board", gh.length === 1 && gh[0].scheme === "greenhouse" && gh[0].value === "acmemidstream" && gh[0].evidence === "https://acme.example/careers", gh);
    const la = atsBoardsIn(fixture("entities", "careers-lever-ashby.html"), "https://rotor.example/jobs");
    check("Lever in an escaped JSON config and a link, Ashby beside it, an empty embed ignored", la.some((b) => b.scheme === "lever" && b.value === "rotorlabs") && la.some((b) => b.scheme === "ashby" && b.value === "rotor-labs") && !la.some((b) => b.scheme === "greenhouse") && la.length === 2, la);
    const wd = atsBoardsIn(fixture("entities", "careers-workday.html"), "https://bigoil.example/careers");
    check("a Workday site is noted (to explain thin coverage), never read", wd.length === 1 && wd[0].scheme === "workday" && wd[0].value === "bigoil", wd);
    check("a board that went quiet while the page links another one has moved", boardMoved({ scheme: "greenhouse", value: "acme" }, 40, 0, [{ scheme: "lever", value: "acme", evidence: "x" }])?.scheme === "lever" && boardMoved({ scheme: "greenhouse", value: "acme" }, 40, 0, [{ scheme: "greenhouse", value: "acme", evidence: "x" }]) === null && boardMoved({ scheme: "greenhouse", value: "acme" }, 40, 12, [{ scheme: "lever", value: "x", evidence: "" }]) === null);
    const wq = wikidataQuery("0001276187");
    check("the Wikidata query asks for both CIK spellings and the four properties", wq.includes('"0001276187" "1276187"') && /P5531/.test(wq) && /P856/.test(wq) && /P1278/.test(wq) && /en\.wikipedia/.test(wq));
    const wd2 = parseWikidata({ results: { bindings: [
      { item: { value: "http://www.wikidata.org/entity/Q1340823" }, site: { value: "https://www.energytransfer.com/" }, lei: { value: "5493008K5LH3UC3X4F11" }, article: { value: "https://en.wikipedia.org/wiki/Energy_Transfer_Partners" } },
      { item: { value: "http://www.wikidata.org/entity/Q1340823" }, site: { value: "https://ir.energytransfer.com/" } },
      { item: { value: "http://www.wikidata.org/entity/Q999" }, site: { value: "https://other.example/" } },
    ] } });
    check("Wikidata results: one item, its sites, LEI and article title", wd2?.qid === "Q1340823" && wd2.sites.length === 2 && wd2.lei === "5493008K5LH3UC3X4F11" && wd2.wikipedia === "Energy_Transfer_Partners", wd2);
    check("no results is no company", parseWikidata({ results: { bindings: [] } }) === null);
    const rec = parseRecipients({ results: [{ name: "LOCKHEED MARTIN CORPORATION", uei: "zfn2jgpjhzk7", id: "abc-P", recipient_level: "P" }, { recipient_name: "X", uei: "short" }, { name: "LOCKHEED MARTIN CORPORATION", uei: "ZFN2JGPJHZK7" }] });
    check("USAspending recipients: valid UEIs only, upper-cased, deduplicated", rec.length === 1 && rec[0].value === "ZFN2JGPJHZK7" && /recipient\/abc-P/.test(rec[0].url), rec);
    const asg = parseAssignees({ assignees: [{ assignee_id: "a1b2", assignee_organization: "Apple Inc." }, { assignee_id: "", assignee_organization: "x" }] });
    check("PatentsView assignees", asg.length === 1 && asg[0].value === "a1b2" && asg[0].name === "Apple Inc.");
  }

  console.log("F2 change library");
  {
    check("weeks start on Monday (UTC), across a year end", weekOf("2026-10-05") === "2026-10-05" && weekOf("2026-10-11") === "2026-10-05" && weekOf("2027-01-01") === "2026-12-28" && monthStart("2026-10-17") === "2026-10-01");
    check("the Mondays between two dates", weeksBetween("2026-09-30", "2026-10-14").join() === "2026-09-28,2026-10-05,2026-10-12");
    const u = rng(21), z = normals(u);
    const noise = (n: number, level: number, sd = 0.1) => Array.from({ length: n }, () => Math.round(level * Math.exp(sd * z())));
    const flat = noise(156, 40);
    const rz = robustZ(flat);
    check("robust z is NaN until there is history, then mostly within 3", Number.isNaN(rz[3]) && rz.slice(30).filter((v) => Math.abs(v) > 3).length / rz.slice(30).length < 0.05);
    const outlier = [...flat.slice(0, 40), 400];
    check("one huge week stands out by robust z", robustZ(outlier)[40] > 6);
    // Detection within three weeks of a step, on twenty synthetic series.
    let caught = 0;
    const late: number[] = [];
    for (let k = 0; k < 20; k++) {
      const s = [...noise(80, 40), ...noise(6, 70)];
      const run = bocpd(s);
      const at = [80, 81, 82].findIndex((t) => run.changeProb(4, t) >= 0.9);
      if (at >= 0) caught++; else late.push(k);
    }
    check("BOCPD finds a +75% step within 3 weeks on at least 19 of 20 series", caught >= 19, { caught, late });
    let falseRuns = 0, years = 0;
    for (let k = 0; k < 20; k++) { const s = noise(156, 40); falseRuns += alarmsOver(s, 0.9); years += (156 - 12) / 52; }
    check("on stationary noise it raises under one false alarm per 4 series-years at 0.9", falseRuns / years < 0.25, { alarms: falseRuns, years: Math.round(years) });
    const pr = placeboRate(flat, { copies: 12 });
    check("the placebo rate is measured on block-shuffled copies and is small on noise", pr.years > 20 && pr.perYear < 0.3, pr);
    const sh = blockShuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], 3, 5);
    check("block shuffles keep blocks whole and every value once", sh.length === 9 && [...sh].sort((a, b) => a - b).join() === "1,2,3,4,5,6,7,8,9" && [0, 3, 6].every((i) => sh[i + 1] === sh[i] + 1 && sh[i + 2] === sh[i] + 2), sh);
    check("block shuffles reproduce with their seed", blockShuffle(flat, 4, 9).join() === blockShuffle(flat, 4, 9).join());
    const seas = Array.from({ length: 156 }, (_, t) => Math.round(50 + 30 * Math.sin((2 * Math.PI * t) / 52) + 2 * z()));
    check("seasonality is used only when it beats the last value", seasonalBeats(seas) && !seasonalBeats(flat) && Number.isNaN(seasonalNaive(seas)[10]) && Number.isFinite(seasonalNaive(seas)[60]));
    const step = [...noise(80, 40), ...noise(6, 80)];
    const v = changeVerdict(step);
    check("a doubled series is an alarm with its probability, z and move", v.alarm && v.prob >= 0.9 && v.z > 3 && v.move > 0.6, v);
    check("a quiet series is not", !changeVerdict(flat).alarm);
    check("a dip that is likely but small is not an alarm (the move must matter)", !changeVerdict([...noise(80, 40, 0.02), ...noise(6, 36, 0.02)]).alarm);
    check("the stated error in words", falseAlarmSentence(0.25, "hiring series") === "At this threshold the detector raises about one false alarm every 4 company-years on hiring series." && /not measured/.test(falseAlarmSentence(NaN)) && /under the run's resolution/.test(falseAlarmSentence(0)));
    check("metric families resolve", metricDef("jobs.tell.ipo")?.label === "IPO readiness postings" && metricDef("jobs.dept.engineering")?.cadence === "weekly" && metricDef("usasp.obligated")?.cadence === "monthly" && metricDef("nope") === null);
  }

  console.log("F3 calibration library");
  {
    const { s, p, y } = synthetic(4000, 5);
    const iso = isotonicFit(s, y);
    const mono = iso.y.every((v, i) => i === 0 || v >= iso.y[i - 1]);
    check("isotonic is monotone and between 0 and 1", mono && iso.y.every((v) => v >= 0 && v <= 1));
    const err = s.slice(0, 500).reduce((m, x, i) => m + Math.abs(isotonicAt(iso, x) - p[i]), 0) / 500;
    check("isotonic recovers known probabilities (mean error under 0.05)", err < 0.05, err);
    check("isotonic pools ties and reads between knots", isotonicFit([1, 1, 2], [0, 1, 1]).y[0] === 0.5 && near(isotonicAt({ x: [0, 1], y: [0.2, 0.6], n: 2 }, 0.5), 0.4, 1e-9));
    const pl = plattFit(s, y);
    check("Platt recovers the true slope and intercept (2 and -1)", near(pl.a, 2, 0.25) && near(pl.b, -1, 0.2), pl);
    check("Platt is finite on separable data", Number.isFinite(plattAt(plattFit([0, 1, 2, 3], [0, 0, 1, 1]), 1.5)));
    const logits = Array.from({ length: 600 }, (_, i) => { const c = i % 3; const l = [0, 0, 0]; l[c] = 3; return l.map((v) => v + (rng(i)() - 0.5)); });
    const labels = logits.map((_, i) => (rng(i + 99)() < 0.7 ? i % 3 : (i + 1) % 3));
    const T = temperatureFit(logits, labels);
    check("temperature scaling softens overconfident logits (T > 1)", T > 1.2 && near(softmax([1, 2, 3]).reduce((a, b) => a + b, 0), 1, 1e-12), T);
    const set = vennAbersSet(s.slice(0, 1500), y.slice(0, 1500));
    const vas = [0.5, -1, 1.5].map((x) => vennAbers(set, x));
    check("Venn-Abers gives an interval around the truth's neighbourhood, narrow with 1,500 cases", vas.every((v, i) => v.low <= v.high && v.p >= v.low - 1e-9 && v.p <= v.high + 1e-9 && v.high - v.low < 0.06 && near(v.p, 1 / (1 + Math.exp(-(2 * [0.5, -1, 1.5][i] - 1))), 0.08)), vas);
    const small = vennAbersSet(s.slice(0, 30), y.slice(0, 30));
    check("with 30 cases the interval is wider: the calibration set vouches for less", vennAbers(small, 0.5).high - vennAbers(small, 0.5).low > vas[0].high - vas[0].low);
    // Venn-Abers validity: across many held-out cases, outcomes fall about where the point estimates say.
    const test = synthetic(3000, 6);
    const vp = test.s.map((x) => vennAbers(set, x).p);
    const isoOnSet = isotonicFit(s.slice(0, 1500), y.slice(0, 1500));
    const ip = test.s.map((x) => isotonicAt(isoOnSet, x));
    check("Venn-Abers is calibrated on held-out data: ECE under 0.05 and no worse than isotonic on the same 1,500 cases", ece(vp, test.y) < 0.05 && ece(vp, test.y) <= ece(ip, test.y) + 0.005, [ece(vp, test.y), ece(ip, test.y), ece(test.p, test.y)]);
    check("Brier of the true probabilities beats a constant; skill is positive", brier(p, y) < brier(p.map(() => 0.4), y) && brierSkill(p, y) > 0.1);
    check("log loss is finite even for a confident miss", Number.isFinite(logLoss([1, 0], [0, 1])) && logLoss([0.9], [1]) < logLoss([0.6], [1]));
    const m = murphy(p, y);
    check("Murphy: reliability - resolution + uncertainty is close to Brier", near(m.reliability - m.resolution + m.uncertainty, m.brier, 0.01) && m.reliability < 0.005, m);
    const big = synthetic(20000, 12);
    const bins = reliabilityBins(big.p, big.y, 10, 0.95);
    check("reliability bins hold every case; each rate's 95% Jeffreys interval mostly covers its mean probability", bins.reduce((a, b) => a + b.n, 0) === 20000 && bins.filter((b) => b.meanP >= b.low && b.meanP <= b.high).length >= bins.length - 1, bins.map((b) => [b.meanP.toFixed(3), b.rate.toFixed(3), b.low.toFixed(3), b.high.toFixed(3)]));
    const [jl, jh] = jeffreys(3, 20);
    check("Jeffreys 90% interval for 3 of 20 (Beta(3.5, 17.5) quantiles)", near(jl, 0.0562, 0.001) && near(jh, 0.3137, 0.001) && jeffreys(0, 10)[0] === 0 && jeffreys(10, 10)[1] === 1, [jl, jh]);
    check("AUROC: perfect, all ties, and the synthetic set's known discrimination", auroc([1, 2, 3, 4], [0, 0, 1, 1]) === 1 && auroc([1, 1, 1, 1], [0, 1, 0, 1]) === 0.5 && auroc([4, 3, 2, 1], [0, 0, 1, 1]) === 0 && near(auroc(s, y), auroc(p, y), 1e-9), [auroc(s, y)]);
    check("average precision: perfect ranking is 1", prAuc([0.9, 0.8, 0.1], [1, 1, 0]) === 1 && prAuc([0.9, 0.8, 0.1], [0, 1, 1]) < 0.7);
    const lift = topLift(s, y, 0.05);
    check("top-share lift over the base rate", lift.lift > 1.8 && lift.n === 200, lift);
    const ci = bootstrapCi(brier, p, y, { seed: 3 });
    check("bootstrap intervals contain the estimate and reproduce", ci[0] <= brier(p, y) && ci[1] >= brier(p, y) && bootstrapCi(brier, p, y, { seed: 3 }).join() === ci.join());
    // Split conformal: coverage at least the nominal level on held-out data.
    const uu = rng(8), zz = normals(uu);
    const errs = Array.from({ length: 400 }, () => zz() * 2), fresh = Array.from({ length: 4000 }, () => zz() * 2);
    const q = splitConformal(errs, 0.2)!;
    const cov = coverage(fresh.map(() => [-q, q] as [number, number]), fresh);
    check("split conformal covers at least 80% of new cases (within sampling error)", cov >= 0.78 && cov < 0.86, { q, cov });
    check("too few calibration cases for a level gives no interval", splitConformal([1, 2, 3], 0.1) === null);
    const lg = logisticFit(s.map((x) => [x, uu()]), y, ["signal", "noise"], { l2: 0.1 });
    check("logistic regression recovers a real feature and ignores noise", near(lg.w[0] / lg.sd[0], 2, 0.3) && Math.abs(lg.w[1]) < 0.15, lg.w);
    check("its contributions sum to the log odds less the intercept", near(logisticContrib(lg, [1, 0.5]).reduce((a, c) => a + c.contrib, 0) + lg.intercept, Math.log(logisticAt(lg, [1, 0.5]) / (1 - logisticAt(lg, [1, 0.5]))), 1e-9));
    check("missing values sit at the mean", logisticAt(lg, [NaN, NaN]) === logisticAt(lg, [lg.mean[0], lg.mean[1]]));
  }

  console.log("F3 forecast ledger rules");
  {
    const opens = new Date("2026-01-01T00:00:00Z"), closes = new Date("2027-01-01T00:00:00Z");
    const rule = { type: "deal" as const, role: "target" as const, node: 7 };
    const ev = [{ target: 7, acquirer: 9, announced: "2026-06-02", source: "DEFM14A" }, { target: 7, acquirer: 7, announced: "2026-03-01", source: "roll-up", relation: "affiliate_rollup" }, { target: 8, acquirer: 9, announced: "2026-02-01", source: "other" }];
    check("a deal announced in the window settles yes at once, with its source", resolveDeal(rule, opens, closes, ev, new Date("2026-07-01"))?.outcome === 1 && resolveDeal(rule, opens, closes, ev, new Date("2026-07-01"))?.source === "DEFM14A");
    check("an affiliate roll-up never counts", resolveDeal(rule, opens, closes, [ev[1]], new Date("2026-07-01")) === null);
    check("nothing by the close settles no; before it, stays open", resolveDeal(rule, opens, closes, [ev[2]], new Date("2027-01-02"))?.outcome === 0 && resolveDeal(rule, opens, closes, [], new Date("2026-12-01")) === null);
    check("the acquirer role reads the buyer", resolveDeal({ type: "deal", role: "acquirer", node: 9 }, opens, closes, ev, new Date("2026-07-01"))?.outcome === 1);
    check("XBRL rules: at least, at most, inside a range, unreported", resolveXbrl({ type: "xbrl", cik: "1", concept: "Revenues", period: "2026-06-30", op: ">=", value: 10 }, 12) === 1 && resolveXbrl({ type: "xbrl", cik: "1", concept: "Revenues", period: "2026-06-30", op: "<=", value: 10 }, 12) === 0 && resolveXbrl({ type: "xbrl", cik: "1", concept: "Revenues", period: "2026-06-30", op: "between", value: 10, high: 12 }, 11) === 1 && resolveXbrl({ type: "xbrl", cik: "1", concept: "Revenues", period: "2026-06-30", op: ">=", value: 10 }, null) === null);
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const chain = [
      { kind: "deal_target", subject: "node:7", closesAt: d("2027-10-01"), createdAt: d("2026-10-03"), id: 1 },
      { kind: "deal_target", subject: "node:7", closesAt: d("2027-10-01"), createdAt: d("2026-10-20"), id: 2 },
      { kind: "deal_target", subject: "node:7", closesAt: d("2027-10-01"), createdAt: d("2027-09-01"), id: 3 },
      { kind: "deal_target", subject: "node:8", closesAt: d("2027-10-01"), createdAt: d("2027-06-01"), id: 4 },
    ];
    const st = standingAtHorizon(chain, 330);
    check("the record counts the estimate standing at the horizon, not the late easy one", st.find((r) => r.subject === "node:7")?.id === 2 && st.find((r) => r.subject === "node:8")?.id === 4 && st.length === 2, st.map((r) => r.id));
    check("re-scores under half a point are not logged again", !worthLogging({ probability: 0.141, low: 0.1, high: 0.2 }, { probability: 0.143, low: 0.1, high: 0.2 }) && worthLogging({ probability: 0.14, low: 0.1, high: 0.2 }, { probability: 0.15, low: 0.1, high: 0.2 }) && worthLogging(null, { probability: 0.1 }));
    check("monthly rolling questions close on the first of a month", closeAfter(d("2026-10-17"), 12).toISOString().slice(0, 10) === "2027-10-01");
    const few = trackSummary([{ probability: 0.2, baseRate: 0.1, outcome: 0 }]);
    check("under the minimum, the record says so instead of a skill figure", few.n === 1 && new RegExp(`from ${MIN_SCORED}`).test(few.verdict));
    const { p, y } = synthetic(800, 9);
    const good = trackSummary(p.map((pi, i) => ({ probability: pi, baseRate: 0.4, outcome: y[i] })));
    check("a skilful model's record: positive skill whose interval excludes zero, in words", good.skill! > 0.1 && good.skillCi![0] > 0 && /^Better than the base rate/.test(good.verdict), good.verdict);
    const bad = trackSummary(p.map((pi, i) => ({ probability: 1 - pi, baseRate: 0.4, outcome: y[i] })));
    check("a model worse than the base rate is told so", /^Worse than simply stating the base rate/.test(bad.verdict), bad.verdict);
    check("the public record hides the company's name", anonymise("Energy Transfer LP (ET) announces an agreement to be acquired by 2027-10-01") === "A company announces an agreement to be acquired by 2027-10-01");
  }

  console.log("E2 Calibrated Claims: numbers, periods, companies");
  {
    const ns = extractNumbers("Revenue rose 12% to $1.2 billion in Q3 2025 from $1,071 million on March 4, 2024; margin up 150 bps; 3.5x leverage; 2,100 employees.");
    check("numbers with units and scale; years, quarters and dates are not numbers", ns.map((n) => `${n.unit}:${n.value}`).join() === "pct:12,usd:1200000000,usd:1071000000,pct:1.5,x:3.5,count:2100", ns.map((n) => `${n.unit}:${n.value}`));
    check("rounding as written: $1.2 billion is backed by $1,213 million, not by $1,300 million", sameNumber(extractNumbers("$1.2 billion")[0], { value: 1213e6, unit: "usd" }) && !sameNumber(extractNumbers("$1.2 billion")[0], { value: 1300e6, unit: "usd" }));
    check("a table figure in millions backs a dollar claim", sameNumber(extractNumbers("$950 million")[0], { value: 950, unit: "count" }));
    const up = checkNumbers("Volumes were up 12% on the year", ["Volumes were 112 MMcf/d against 100 MMcf/d a year ago."]);
    check("\"up 12%\" is derived from 100 to 112", up.share === 1 && up.derived[0]?.how === "growth from 100 to 112", up);
    const down = checkNumbers("Volumes fell 8% to 2.3 Bcf/d", ["Volumes were 2.3 Bcf/d, against 2.5 Bcf/d"]);
    check("a fall is derived with its sign from the words", down.share === 1 && down.found === 1 && down.derived.length === 1, down);
    const wrong = checkNumbers("Net debt was $4.4 billion", ["Net debt of $4.1 billion at year end."]);
    check("a changed number is missing, named", wrong.share === 0 && wrong.missing[0] === "$4.4 billion");
    check("a claim without numbers passes the number check", checkNumbers("The board approved the merger", ["x"]).share === 1 && checkNumbers("The board approved the merger", ["x"]).checked === 0);
    check("periods: quarters by code and name, months ended, fiscal years", [...periodsIn("Q3 2025 and the second quarter of 2024; three months ended June 30, 2023; FY2022")].sort().join() === "2022,2023,2023Q2,2024,2024Q2,2025,2025Q3");
    const hdr = "Halcyon Midstream LP (HLMS) · 10-Q · quarter ended June 30, 2025 · Management's discussion";
    check("period agreement: same, different, none named, and a calendar quarter against a fiscal header", periodAgreement("revenue in the second quarter of 2025", [{ header: hdr, text: "" }]) === 1 && periodAgreement("revenue in 2024", [{ header: hdr, text: "" }]) === 0 && periodAgreement("revenue grew", [{ header: hdr, text: "" }]) === 0.5 && periodAgreement("in Q3 2025", [{ header: "X (X) · 10-K · year ended December 31, 2025", text: "" }]) === 1);
    check("the header names its company and ticker", headerCompany(hdr).name === "Halcyon Midstream LP" && headerCompany(hdr).ticker === "HLMS");
    const scope = [{ name: "Halcyon Midstream LP", ticker: "HLMS" }, { name: "Pecos Gathering Inc.", ticker: "PCGI" }];
    check("entity agreement: the right company, another company, none named", entityAgreement("Halcyon Midstream's revenue", [{ header: hdr, text: "" }], scope) === 1 && entityAgreement("Pecos Gathering's revenue", [{ header: hdr, text: "" }], scope) === 0 && entityAgreement("Revenue grew", [{ header: hdr, text: "" }], scope) === 0.5 && entityAgreement("HLMS reported", [{ header: hdr, text: "" }], scope) === 1);
    const f = claimFeatures({ text: "Halcyon Midstream's revenue was $1.2 billion in the second quarter of 2025.", cites: [{ text: "Revenue for the quarter was $1,213 million.", header: hdr, quote: "exact", rank: 1 }] }, scope);
    check("a claim's features and reasons", f.features.quote === 1 && f.features.numbers === 1 && f.features.period === 1 && f.features.entity === 1 && Number.isNaN(f.features.nli) && reasonsOf(f.features, f.numbers)[0] === "quote exact", f.features);
  }

  console.log("E2 Calibrated Claims: the conformal line and the combiner");
  {
    check("Clopper-Pearson upper bounds: 0 of 59 is under 5%, 0 of 50 is not", upperBound(0, 59) < 0.05 && upperBound(0, 50) > 0.05 && upperBound(3, 3) === 1);
    // Synthetic scores with known labels: support probability q drawn uniformly, label ~ Bernoulli(q).
    let held = 0, trials = 0;
    const alpha = 0.1;
    for (let t = 0; t < 1000; t++) {
      const u = rng(1000 + t);
      // Most claims are supported, as in answers after the quote check: q skewed towards 1.
      const draw = (n: number) => { const sc: number[] = [], lb: number[] = []; for (let i = 0; i < n; i++) { const q = Math.pow(u(), 0.25); sc.push(q); lb.push(u() < q ? 1 : 0); } return { sc, lb }; };
      const cal = draw(400), test = draw(2000);
      const tau = strictThreshold(cal.sc, cal.lb, alpha);
      if (tau === null) continue;
      trials++;
      if (rateAbove(test.sc, test.lb, tau).rate <= alpha) held++;
    }
    check("on 1,000 resamples the unsupported share above the line is at most alpha in at least 95%", trials >= 700 && held / trials >= 0.95, { held, trials });
    const tau = strictThreshold([0.99, 0.98, 0.97, 0.96, 0.95, 0.94, 0.93, 0.92, 0.6, 0.5, 0.4], [1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1], 0.4);
    check("the walk starts once a line can pass and stops at the first failure", tau === 0.92, tau);
    check("tied scores share one line: one failure among them blocks it, none does not", strictThreshold(Array(10).fill(0.9), [1, 1, 1, 1, 1, 1, 1, 1, 1, 0], 0.3) === null && strictThreshold(Array(10).fill(0.9), Array(10).fill(1), 0.3) === 0.9);
    check("with too few claims there is no line", strictThreshold([0.9, 0.8], [1, 1], 0.05) === null);
    const rows = loadFixture();
    check("the calibration fixture has at least 300 labelled claims, both halves, both labels", rows.length >= 300 && rows.some((r) => r.split === "held") && rows.some((r) => !r.supported), rows.length);
    const labelled: Labelled[] = rows.map((r) => ({ features: claimFeatures({ text: r.claim, analysis: r.analysis, cites: r.cites }, r.scope).features, supported: r.supported, split: r.split }));
    const m = fitCombiner(labelled, ["quote", "rank", "numbers", "hasNumbers", "entity", "period", "agree", "analysis"], { name: "template", version: "test", claims: rows.length, supported: 0, fittedAt: "2026-10-07T00:00:00Z", note: "" }, "claims-test");
    check("the combiner separates supported from unsupported on held-out claims (AUROC above 0.85)", m.quality.auroc > 0.85, m.quality);
    check("isotonic keeps support monotone in the raw score", m.isotonic.y.every((v, i) => i === 0 || v >= m.isotonic.y[i - 1]));
    const l5 = lineFor(m, 0.05);
    check("the 5% line exists and its held-out rate is reported with an interval", !!l5 && l5.heldOut.n > 50 && l5.heldOut.ci !== null, l5);
    const shipped = combiner();
    check("the shipped combiner is the fixture's, without NLI until it has been fitted with it", shipped.set.claims === rows.length && !shipped.features.includes("nli") && /template/.test(shipped.set.name));
    const p = supportOf(shipped, labelled[0].features);
    check("a support probability is between 0 and 1, and the filter holds back exactly what is under the line", p >= 0 && p <= 1 && labelled.filter((r) => supportOf(shipped, r.features) >= (lineFor(shipped, 0.05)?.tau ?? 2)).every((r) => supportOf(shipped, r.features) >= lineFor(shipped, 0.05)!.tau!));
    check("the Strict footer states the target, the held-out rate and the set", /^Shown claims meet a 5% unsupported-claim target\. On \d+ held-out claims, [\d.]+% \(90% CI/.test(strictFooter(shipped, 0.05)) && /template v1/.test(strictFooter(shipped, 0.05)), strictFooter(shipped, 0.05));
    check("dots: green from 0.9, amber from 0.6, red below", dotOf(0.92) === "high" && dotOf(0.7) === "mid" && dotOf(0.3) === "low");
    check("the cross-check is asked for only when ticked, after the other premium options", askWants({ crosscheck: true }).require.join() === "edge.claims-crosscheck" && askWants({ model: true, citations: true }).require.join() === "edge.answer-model,edge.citations");
    const keep = { o: process.env.OPENAI_API_KEY, a: process.env.ANTHROPIC_API_KEY };
    process.env.OPENAI_API_KEY = "x"; process.env.ANTHROPIC_API_KEY = "y";
    check("the second provider is the other one", /^claude/.test(crosscheckModel("gpt-5.6-luna") ?? "") && /^gpt/.test(crosscheckModel("claude-sonnet-5-5") ?? ""));
    delete process.env.ANTHROPIC_API_KEY;
    check("without the other provider's key there is no cross-check", crosscheckModel("gpt-5.6-luna") === null);
    if (keep.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = keep.o;
    if (keep.a !== undefined) process.env.ANTHROPIC_API_KEY = keep.a;
  }

  console.log("E1 Precedent Engine: number readers");
  {
    check("parseMoney: $1.2 billion is 1,200 (USD millions)", parseMoney("approximately $1.2 billion")?.value === 1200 && parseMoney("$1.2 billion")?.unit === "usd_mm");
    check("parseMoney: $950 million is 950", parseMoney("a total of $950 million in cash")?.value === 950);
    check("parseMoney: approximately $3.10 per share is USD per share", parseMoney("approximately $3.10 per share")?.value === 3.1 && parseMoney("approximately $3.10 per share")?.unit === "usd_per_share");
    check("parseMoney: $42.50 in cash per share and 'for each share' read as per share", parseMoney("$42.50 in cash per share")?.unit === "usd_per_share" && parseMoney("$18.00 for each share")?.unit === "usd_per_share");
    check("parseMoney: a plain figure in dollars becomes millions", near(parseMoney("$1,234,567")!.value, 1.234567, 1e-9));
    check("parseMoney: $68 million and $2.1bn and $750m", parseMoney("$68 million")?.value === 68 && parseMoney("$2.1bn")?.value === 2100 && parseMoney("$750m")?.value === 750);
    check("moneyAll finds every amount in order", moneyAll("between $36.00 and $41.00 per share, or $1.2 billion").map((m) => m.value).join() === "36,41,1200", moneyAll("between $36.00 and $41.00 per share, or $1.2 billion"));
    check("parseMoney: no dollar sign, no money", parseMoney("1.2 billion shares") === null);
    check("parsePercent: 31.4% and 31 percent and per cent", near(parsePercent("approximately 31.4%")!, 0.314, 1e-9) && parsePercent("31 percent") === 0.31 && parsePercent("3.5 per cent") === 0.035);
    check("parseDays: 45 days, forty-five (45) days, thirty days", parseDays("within 45 days") === 45 && parseDays("forty-five (45) days after") === 45 && parseDays("a period of thirty days") === 30 && parseDays("35 calendar days") === 35);
    check("parseDays: words and figures that disagree are not a number", parseDays("thirty (45) days") === null);
    check("words to numbers", wordsToNumber("forty-five") === 45 && wordsToNumber("one hundred twenty") === 120 && wordsToNumber("twelve") === 12 && wordsToNumber("many") === null);
    check("parseCount: digits, words and both, years and money ignored", parseCount("contacted 25 potential counterparties") === 25 && parseCount("nine parties entered into") === 9 && parseCount("twelve (12) parties") === 12 && parseCount("On October 3, 2023, five parties submitted bids of $36.00") === 5);
    check("parseRatio: 0.4125 shares of Corvane common stock", parseRatio("and 0.4125 shares of Corvane common stock") === 0.4125 && parseRatio("an exchange ratio of 0.725") === 0.725);
    check("parseDate: month day, year; day month year; ISO", parseDate("On March 3, 2024, the Company") === "2024-03-03" && parseDate("3 March 2024") === "2024-03-03" && parseDate("2024-03-03") === "2024-03-03" && parseDate("in March") === null);
    const r = parseRange("an implied per share equity value reference range of $38.10 to $47.60");
    check("parseRange: a per-share range, low first", !!r && r.low === 38.1 && r.high === 47.6 && r.unit === "usd_per_share", r);
    check("consideration words: cash, stock, mixed", considerationOf("$42.50 in cash, without interest") === "cash" && considerationOf("an exchange ratio of 0.725 shares") === "stock" && considerationOf("$18.00 in cash, without interest, and 0.4125 shares of Corvane common stock") === "mixed");
    check("buyer type from how the buyer is described", buyerTypeOf("formed by investment funds managed by Lantern Infrastructure Partners") === "sponsor" && buyerTypeOf("a portfolio company of Blue Ridge Capital") === "sponsor_backed" && buyerTypeOf("a publicly traded provider listed on the Nasdaq") === "strategic");
    check("money in words: $1.2bn, $950m, $3.10/share", fmtMoney({ value: 1200, unit: "usd_mm" }) === "$1.20bn" && fmtMoney({ value: 950, unit: "usd_mm" }) === "$950m" && fmtMoney({ value: 3.1, unit: "usd_per_share" }) === "$3.10/share");
  }

  console.log("E1 Precedent Engine: finding sections in saved proxies");
  {
    const docs = ["proxy-workiva.html", "proxy-caps.html", "sc14d9.html"].map((f) => ({ f, parts: partsFromHtml(fixture("deals", f)) }));
    const w = locateSections(docs[0].parts, SECTIONS_BY_KIND.proxy);
    const keys = new Set(w.map((x) => x.key));
    check("the Workiva-style proxy: every section found by its heading", ["summary", "parties", "background", "reasons", "opinion", "projections", "termination", "approvals"].every((k) => keys.has(k as never) && w.find((x) => x.key === k)!.via === "heading"), w.map((x) => `${x.key}:${x.via}:${x.chars}`));
    check("contents entries and the summary's page references never start a section", headingKey("Opinion of Northgate Partners LLC (page 41)", ["opinion"]) === null && headingKey("Background of the Merger 24", ["background"]) === null && headingKey("Opinion of Northgate Partners LLC", ["opinion"]) === "opinion");
    const bg = w.find((x) => x.key === "background")!;
    check("the background section runs to the next section, no further", /executed the merger agreement/.test(bg.text) && !/In reaching its determination/.test(bg.text));
    const op = w.find((x) => x.key === "opinion")!;
    check("the opinion section keeps the selected transactions table whole", /Calder Energy \| Westbrook Gathering \| 9\.8x/.test(op.text), op.text.slice(0, 300));
    const pj = w.find((x) => x.key === "projections")!;
    check("the projections table keeps its units line and columns", /\(in millions\)/.test(pj.text) && /Adjusted EBITDA \| \$405 \| \$462 \| \$515/.test(pj.text), pj.text.slice(0, 300));
    const c = locateSections(docs[1].parts, SECTIONS_BY_KIND.proxy);
    check("the capitalised-heading proxy: consideration, background, opinion, termination and approvals found", ["consideration", "background", "opinion", "termination", "approvals"].every((k) => c.some((x) => x.key === k)), c.map((x) => `${x.key}:${x.via}`));
    const t = locateSections(docs[2].parts, SECTIONS_BY_KIND.tender);
    check("the 14D-9: the background of the offer, the reasons, the opinion and the fee", ["background", "reasons", "opinion", "termination"].every((k) => t.some((x) => x.key === k && x.via === "heading")), t.map((x) => `${x.key}:${x.via}`));
    const none = locateSections(partsFromHtml("<p>The parties signed a confidentiality agreement and a non-binding proposal followed; the first contacted party declined.</p><p>Nothing else here at all, just filler words for the document body that go on.</p>"), ["background"], { minChars: 40 });
    check("with no heading, keyword windows stand in and say so", none.length === 1 && none[0].via === "keywords");
    check("forms map to document kinds", docKindOf("DEFM14A") === "proxy" && docKindOf("SC 14D9") === "tender" && docKindOf("S-4/A") === "s4" && docKindOf("8-K", "EX-2.1") === "agreement" && docKindOf("8-K", "EX-99.1") === "press" && docKindOf("10-K") === null);
    check("every field is looked for in at least one section, and fields per section exist", FIELDS.every((f) => f.sections.length > 0) && fieldsFor("background").some((f) => f.field === "ndas") && fieldsFor("termination").some((f) => f.field === "go_shop_days"));
  }

  console.log("E1 Precedent Engine: checks and confidence on labelled fields");
  {
    const docs = Object.fromEntries(["proxy-workiva", "proxy-caps", "sc14d9"].map((d) => [d, locateSections(partsFromHtml(fixture("deals", `${d}.html`)), [...SECTIONS_BY_KIND.proxy, "reasons"])]));
    const labels = fixture("deals", "labels.jsonl").trim().split("\n").map((l) => JSON.parse(l) as { deal: string; section: string; field: string; value: string; quote: string; truth: unknown });
    let right = 0, stored = 0, wrongKept = 0, falseDrop = 0;
    const labelled: { deal: string; field: string; raw: number; correct: boolean }[] = [];
    for (const l of labels) {
      const sec = docs[l.deal].find((x) => x.key === l.section) ?? docs[l.deal].find((x) => x.text.includes(l.quote.slice(0, 30)));
      const c = checkField({ field: l.field, value: l.value, quote: l.quote }, sec?.text ?? "");
      const ok = c.value !== null && JSON.stringify(c.value) === JSON.stringify(l.truth);
      if (c.value !== null) { stored++; if (ok) right++; else wrongKept++; labelled.push({ deal: l.deal, field: l.field, raw: rawScore(c.checks, sec?.via ?? "keywords"), correct: ok }); }
      else if (l.truth !== null) falseDrop++;
    }
    check("every stored value equals the hand-checked value (the quote's reading wins over a model's misreading)", wrongKept === 0 && right === stored, { right, stored, wrongKept });
    check("quotes that are not in the document are dropped (an invented count, invented synergies, an invented go-shop)", labels.filter((l) => l.truth === null).length === 3 && labels.filter((l) => l.truth !== null).length - falseDrop === stored, { falseDrop, stored });
    check("no true field is dropped by the checks", falseDrop === 0, falseDrop);
    const misread = checkField({ field: "termination_fee", value: "$86 million", quote: "The Company will be required to pay Parent a termination fee of $68 million under specified circumstances" }, docs["proxy-workiva"].find((x) => x.key === "summary")!.text);
    check("a model value the quote contradicts is noted, and the quote's value kept", misread.value === 68 && misread.checks.some((x) => x.name === "model" && x.ok === false));
    check("a numeric field with no number in its quote is dropped", checkField({ field: "termination_fee", value: "$68 million", quote: "The Company will be required to pay Parent a termination fee" }, "The Company will be required to pay Parent a termination fee under specified circumstances.").dropped === "no number in the quote");
    const fields = [
      { field: "equity_value", value: 2100, quote: "", checks: [] }, { field: "enterprise_value", value: 3400, quote: "", checks: [] }, { field: "premium_unaffected", value: 0.314, quote: "", checks: [] },
      { field: "termination_fee", value: 68, quote: "", checks: [] }, { field: "reverse_termination_fee", value: 136, quote: "", checks: [] }, { field: "per_share", value: 42.5, quote: "", checks: [] },
    ];
    const x = crossChecks(fields, { netDebtMm: 1290, sharesMm: 49.4, computedPremium: 0.31 });
    const got = (f: string, n: string) => x.find((y) => y.field === f)!.checks.find((c) => c.name === n)?.ok;
    check("EV against equity plus XBRL net debt within 5%", got("enterprise_value", "ev_bridge") === true && crossChecks([{ field: "equity_value", value: 2100, quote: "", checks: [] }, { field: "enterprise_value", value: 4000, quote: "", checks: [] }], { netDebtMm: 1290 })[1].checks[0].ok === false);
    check("stated against computed premium within 2 points", got("premium_unaffected", "premium_prices") === true && crossChecks([{ field: "premium_unaffected", value: 0.4, quote: "", checks: [] }], { computedPremium: 0.31 })[0].checks[0].ok === false);
    check("termination fee as a share of equity value (68 of 2,100 is 3.2%)", got("termination_fee", "fee_share") === true && near(feeShare(68, 2100)!, 0.0324, 0.0001) && crossChecks([{ field: "equity_value", value: 1000, quote: "", checks: [] }, { field: "termination_fee", value: 120, quote: "", checks: [] }], {})[1].checks[0].ok === false);
    check("price per share times shares against equity value within 10%", got("equity_value", "per_share_x_shares") === true);
    check("the premium arithmetic matches premiumOf", near(premiumOf(42.5, [{ date: "2024-02-29", close: 32.1 }, { date: "2024-03-01", close: 32.35 }, { date: "2024-03-04", close: 41.9 }], new Date("2024-03-04T00:00:00Z"))!.premium, 42.5 / 32.35 - 1, 1e-9));
    check("raw score rises with cross-checks and a heading, falls with a conflict", rawScore([{ name: "quote", ok: true, detail: "" }, { name: "reparse", ok: true, detail: "" }, { name: "ev_bridge", ok: true, detail: "" }], "heading") > rawScore([{ name: "quote", ok: true, detail: "" }, { name: "reparse", ok: true, detail: "" }], "keywords") && rawScore([{ name: "quote", ok: true, detail: "" }, { name: "ev_bridge", ok: false, detail: "" }], "heading") < rawScore([{ name: "quote", ok: true, detail: "" }], "heading"));
    const conf = confidenceOf("termination_fee", 0.8);
    check("before a family has its labelled fields, confidence is a stated prior, never a measured rate", !conf.calibrated && conf.p === priorAt(0.8) && /prior estimate/.test(conf.note), conf);
    const m = fitConfidence([...Array.from({ length: 40 }, (_, i) => ({ deal: `d${i}`, field: "termination_fee", raw: 0.9, correct: i % 20 !== 0 })), ...Array.from({ length: 40 }, (_, i) => ({ deal: `e${i}`, field: "go_shop_days", raw: 0.5, correct: i % 3 !== 0 }))], "test");
    check("fitted per family: monotone, calibrated once a family reaches its labelled count", m.families.protection!.n === 80 && m.families.protection!.iso !== null && confidenceOf("termination_fee", 0.9, m).calibrated === (80 >= MIN_LABELLED) && confidenceOf("termination_fee", 0.9, m).p > confidenceOf("go_shop_days", 0.5, m).p && /were right \d+% of the time on 80 labelled protection fields \(80 deals\)/.test(confidenceOf("termination_fee", 0.9, m).note), confidenceOf("termination_fee", 0.9, m));
    check("the labelled fixture yields its first calibration set (below the line, so still shown as a prior)", fitConfidence(labelled, "fixture").labelledDeals === 3 && labelled.length >= 30, labelled.length);
    check("readValue by kind", readValue("per_share", "$27.00 per share in cash") === 27 && readValue("money_mm", "$52 million") === 52 && readValue("percent", "approximately 64%") === 0.64);
  }

  console.log("E1 Precedent Engine: similar deals and the multiple range");
  {
    const v = (seed: number) => Array.from({ length: 16 }, (_, i) => Math.sin(seed * 7.3 + i));
    const a: DealLite = { id: 1, sic: "4922", evUsdMm: 3400, equityUsdMm: 2100, buyerType: "sponsor", year: 2024, country: "US", consideration: "cash", embedding: v(1) };
    const b: DealLite = { id: 2, sic: "4922", evUsdMm: 2600, equityUsdMm: 1800, buyerType: "sponsor", year: 2023, country: "US", consideration: "cash", embedding: v(1.05) };
    const c: DealLite = { id: 3, sic: "7372", evUsdMm: 900, equityUsdMm: 900, buyerType: "strategic", year: 2018, country: "US", consideration: "stock", embedding: v(9) };
    check("the kernel and the score are symmetric", near(kernel(a, b).score, kernel(b, a).score, 1e-12) && near(similarity(a, c), similarity(c, a), 1e-12));
    check("a same-industry, same-buyer, similar-size deal outranks a distant one", similarity(a, b) > similarity(a, c) && kernel(a, a).score > 0.95);
    check("score is 0.6 cosine + 0.4 kernel with vectors; the kernel alone without", near(similarity(a, b), 0.6 * Math.max(0, cosine(a.embedding, b.embedding)) + 0.4 * kernel(a, b).score, 1e-12) && near(similarity({ ...a, embedding: null }, b), kernel(a, b).score, 1e-12));
    check("SIC match: four digits 1, three 0.7, two 0.4", sicMatch("4922", "4922") === 1 && sicMatch("4922", "4923") === 0.7 && sicMatch("4922", "4911") === 0.4 && sicMatch("4922", "7372") === 0);
    const why = whyChips(a, b);
    check("why it matched, in chips", why.includes("same SIC 4922") && why.includes("sponsor buyer") && why.includes("cash deal"), why);
    check("recall@10 of the bankers' choices", recallAtK([5, 6, 7, 8], [6, 8, 9], 10) === 2 / 3 && recallAtK([1], [], 10) === null);
    const st = trimmedStats([8, 9, 10, 11, 12, 100]);
    check("trimmed median and IQR resist one outlier", !!st && st.median >= 9.5 && st.median <= 11.5 && st.high < 100, st);
    check("kNN needs three neighbours", knnPredict([{ score: 1, multiple: 10 }, { score: 1, multiple: 10 }]) === null && near(Math.exp(knnPredict([{ score: 1, multiple: 10 }, { score: 1, multiple: 10 }, { score: 1, multiple: 10 }])!), 10, 1e-9));
    // Synthetic deals whose log multiple is a smooth function of a latent position plus noise: the 80% band must cover about 80%.
    const R = rng(29), Z = normals(R), noise = Array.from({ length: 800 }, () => Z());
    const pool = Array.from({ length: 400 }, (_, i) => ({ id: i + 1, year: 2014 + (i % 12), x: R(), e: noise[i] * 0.25 }));
    const mult = (d: { x: number; e: number }) => Math.exp(Math.log(8) + 0.8 * d.x + d.e);
    const deals = pool.map((d) => ({ id: d.id, year: d.year, multiple: mult(d) }));
    const pos = new Map(pool.map((d) => [d.id, d.x]));
    const score = (i: number, j: number) => 1 - Math.abs((pos.get(i) ?? 0) - (pos.get(j) ?? 0));
    let covered = 0, n = 0, band: ReturnType<typeof conformalBand> = null;
    for (let t = 0; t < 80; t++) {
      const x = R(), truth = Math.exp(Math.log(8) + 0.8 * x + noise[400 + t] * 0.25);
      const neigh = deals.map((d) => ({ score: 1 - Math.abs(x - pos.get(d.id)!), multiple: d.multiple }));
      band = conformalBand(neigh, deals, score, { alpha: 0.2 });
      if (!band) continue;
      n++; if (truth >= band.low && truth <= band.high) covered++;
    }
    check("split-conformal 80% band covers at least the nominal level within its sampling error", n === 80 && covered / n >= 0.8 - 2 * Math.sqrt(0.16 / 80), { covered, n });
    check("the band states the coverage it achieved on held-out recent deals", !!band && band.coverage !== null && /On \d+ deals from 2025 held out, it covered \d+%/.test(bandSentence(band)), band && bandSentence(band));
    check("with too few years there is no band, and the sentence says so", conformalBand([], deals.filter((d) => d.year <= 2015), score) === null && /Not enough comparable deals/.test(bandSentence(null)));
  }

  console.log("E1 Precedent Engine: discovery, the backfill's switch, presentation");
  {
    const hits = JSON.parse(fixture("deals", "efts-hits.json")) as EftsHit[];
    const docs = docsFromHits(hits);
    check("one document per filing: the proxy's main document, not its exhibit", docs.filter((d) => d.accession === "0001193125-24-061234").length === 1 && docs.find((d) => d.accession === "0001193125-24-061234")!.url.endsWith("d712345ddefm14a.htm"));
    const k = docs.find((d) => d.kind === "agreement");
    check("an 8-K under Item 1.01 gives its merger agreement with the press release beside it", !!k && k.url.endsWith("ex2-1.htm") && !!k.press?.endsWith("ex99-1.htm"), k);
    check("an 8-K without Item 1.01 is left out", !docs.some((d) => d.accession === "0000950170-25-011111"));
    check("the filer is the target for proxies and 14D-9s; a joint proxy names both parties", docs.find((d) => d.kind === "tender")!.filerIsTarget && docs.find((d) => d.accession === "0001104659-24-099876")!.parties.length === 2);
    check("SEC display names are cleaned", cleanName("Harbor Ridge Midstream, Inc.  (HRMI)  (CIK 0001700001)") === "Harbor Ridge Midstream, Inc.");
    check("months for the backfill's cursor", nextMonth("2015-12") === "2016-01" && nextMonth("2024-02") === "2024-03" && monthEnd("2024-02") === "2024-02-29");
    check("reading is off until an administrator switches it or sets the ceiling; a switch-off wins", !readingPolicy({}, null).on && readingPolicy({}, 5).on && readingPolicy({}, 5).dailyUsd === 5 && readingPolicy({ on: true }, null).dailyUsd === 0.5 && !readingPolicy({ on: false }, 5).on);
    check("deals the day's budget still pays for", dealsLeft(0.5, 0) === 50 && dealsLeft(0.5, 0.45) === 5 && dealsLeft(0.5, 0.6) === 0 && dealsLeft(100, 0) === 500);
    const rows = [
      { field: "termination_fee", value: 68, quote: "a termination fee of $68 million", docUrl: "u", section: "Termination Fees", confidence: 0.86, checks: { list: [{ name: "quote", ok: true, detail: "found" }, { name: "fee_share", ok: true, detail: "3.2% of equity value" }], calibrated: false, note: "prior estimate: 0 labelled protection fields so far, calibration from 60" }, method: "m", modelVersion: "v" },
      { field: "ndas", value: 9, quote: "nine parties", docUrl: "u", section: "Background", confidence: 0.8, checks: {}, method: "m", modelVersion: "v" },
      { field: "sign_date", value: "2024-03-03", quote: "On March 3, 2024", docUrl: "u", section: "Background", confidence: 0.8, checks: {}, method: "m", modelVersion: "v" },
      { field: "fairness_dcf", value: { low: 38.1, high: 47.6, unit: "usd_per_share" }, quote: "q", docUrl: "u", section: "Opinion", confidence: 0.8, checks: {}, method: "m", modelVersion: "v" },
      { field: "per_share", value: 42.5, quote: "q", docUrl: "u", section: "Summary", confidence: 0.8, checks: {}, method: "m", modelVersion: "v" },
    ];
    const shown = shownFields(rows);
    check("values in words", valueText("termination_fee", 68) === "$68.0m" && valueText("premium_unaffected", 0.314) === "31.4%" && valueText("go_shop_days", 45) === "45 days" && valueText("fairness_dcf", { low: 38.1, high: 47.6, unit: "usd_per_share" }) === "$38.10 to $47.60");
    check("fields grouped by family in order", byFamily(shown).map((g) => g.family).join() === "price,protection,fairness,process");
    check("the timeline runs first contact to signing with counts", timeline(shown, { signedAt: null }).map((t) => t.key).join() === "ndas,sign");
    check("the football field takes per-share ranges and the offer", footballField(shown).bars.length === 1 && footballField(shown).offer === 42.5);
    check("the confidence line names the cross-check and says it is a prior", /^cross-checked · 86% · prior estimate/.test(confidenceLine(shown[0])), confidenceLine(shown[0]));
    const csv = dealCsv([{ id: 7, announcedAt: "2024-03-04", targetName: "Harbor Ridge, Inc.", targetTicker: "HRMI", acquirerName: "Lantern", buyerType: "sponsor", sic: "4922", consideration: "cash", equityUsdMm: 2100, evUsdMm: 3400, evEbitda: 8.4, evRevenue: 2.7, premiumUnaffected: 0.314, sources: [{ form: "DEFM14A", url: "https://x", filed: "2024-04-26", role: "proxy" }] } as never], new Map([[7, [{ field: "termination_fee", value: 68, quote: "a fee of $68 million, payable" }]]]));
    check("exports carry the quote and the source", csv.split("\n").length === 2 && /"Harbor Ridge, Inc\."/.test(csv) && /"a fee of \$68 million, payable"/.test(csv) && csv.endsWith("https://x"), csv);
    const cf = { cik: 1, entityName: "X", facts: { "us-gaap": {
      Revenues: { units: { USD: [{ start: "2023-01-01", end: "2023-12-31", val: 1_200_000_000, accn: "a", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-20" }, { start: "2023-01-01", end: "2023-12-31", val: 1_300_000_000, accn: "b", fy: 2023, fp: "FY", form: "10-K/A", filed: "2024-06-01" }] } },
      OperatingIncomeLoss: { units: { USD: [{ start: "2023-01-01", end: "2023-12-31", val: 250_000_000, accn: "a", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-20" }] } },
      DepreciationDepletionAndAmortization: { units: { USD: [{ start: "2023-01-01", end: "2023-12-31", val: 150_000_000, accn: "a", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-20" }] } },
      LongTermDebt: { units: { USD: [{ end: "2023-12-31", val: 1_400_000_000, accn: "a", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-20" }] } },
      CashAndCashEquivalentsAtCarryingValue: { units: { USD: [{ end: "2023-12-31", val: 110_000_000, accn: "a", fy: 2023, fp: "FY", form: "10-K", filed: "2024-02-20" }] } },
    } } };
    const tf = factsAsOf(cf as never, "2024-03-04");
    check("the target's figures as filed by the announcement: no later restatement leaks in", tf.revenueMm === 1200 && tf.ebitdaMm === 400 && tf.netDebtMm === 1290, tf);
    check("the registry's field kinds are all readable", FIELDS.every((f) => FIELD[f.field] === f));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
