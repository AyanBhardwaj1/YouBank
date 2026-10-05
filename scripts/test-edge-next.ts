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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
