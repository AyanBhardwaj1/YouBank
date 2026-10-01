/**
 * Checks for Edge: satellite change detection on synthetic scenes, the deal screen, party matching,
 * watches, feed ranking, the audit trail, the beta gate, the canvas, the free tiers, and Documents
 * (quote checking, highlighting, diffs, chunking, retrieval fusion, topics, tone). No network, no database.
 *   pnpm exec tsx scripts/test-edge.ts
 */
import { changeBetween, changeConfidence, classesFrom, normalize, seasonGap } from "@/lib/edge/change";
import { parentOf } from "@/lib/edge/companies";
import { countyConcentration, haversineKm, hhi, partyFor, screen, type Proforma } from "@/lib/edge/proforma";
import { defaultBlend, edgePrefs } from "@/lib/edge/access";
import { parseWatch, starterWatches } from "@/lib/edge/watches";
import { matches, noveltyOf, score, sizeOf } from "@/lib/edge/feed";
import { describeProforma, proformaWeight } from "@/lib/edge/dealwatch";
import { trailCsv } from "@/lib/edge/provenance";
import { featuresFor, normalizeNavPrefs } from "@/lib/nav";
import { hasCycle, layout, makeNode, suggestions, TEMPLATES, validate, waves, wire, type Graph } from "@/lib/edge/canvas/catalog";
import { assemble, cleanConfig } from "@/lib/edge/canvas/build";
import { crossed, evidenceOf, kindOfValue, metricOf, rowsOf, toCsv, type Findings, type Table } from "@/lib/edge/canvas/values";
import { memoMarkdown } from "@/lib/edge/canvas/executors/outputs";
import { allowance, resetsOn } from "@/lib/edge/infra/usage";
import { partsForRange, PART_BYTES, signingTime } from "@/lib/edge/infra/r2";
import { statusUrl } from "@/lib/edge/infra/ml";
import { judge } from "@/lib/edge/refine";
import { clockOf, locateQuote, normText, quoteFound, wordDiff } from "@/lib/edge/docs/text";
import { answerModel, blockLabel, checkFound, quoteFound as answerQuoteFound, rereadBudget } from "@/lib/edge/docs/answer";
import { chunkParts, cleanRow, docLabel, dropPageNumber, filingHeading, gridRows, rowLines, headingOf, longDate, looksLikeHeading, P_MAX, passageHeader, partsFromText, passagesFromFiling, passagesFromPages, passagesFromParts, passagesFromTranscript, sectionText, splitText, tableParts, tableText, type Part } from "@/lib/edge/docs/chunk";
import { anyTermsQuery, expand, fuse, joinOverlap, mergeForSelection, parseTerms, quoteChunk, type Hit } from "@/lib/edge/docs/retrieve";
import { PgDialect } from "drizzle-orm/pg-core";
import { decodeEntities, partsFromHtml, tableRows } from "@/lib/edge/docs/html";
import { COHERE_URL, cohereRequest, ML_CHARS, ML_PASSAGES, ML_TIMEOUT_MS, mlInput, orderByScores, parseCohere, parseMl, parseVoyage, rerankProvider, shortModel, VOYAGE_URL, voyageRequest } from "@/lib/edge/premium/rerank";
import { recallAt, reciprocalRank, squash } from "./eval-docs";
import { diffSections, paragraphs } from "@/lib/edge/docs/changes";
import { kmeans, pca2 } from "@/lib/edge/docs/topics";
import { keepNarrative } from "@/lib/edge/docs/sources";
import { mimeOf, PARAKEET_CREDIT, transcriptionOf } from "@/lib/edge/docs/uploads";
import { bySpeaker, toneOf, toneShift, turnAt, type Turn } from "@/lib/edge/docs/tone";
import { filingMagnitude, filingTitle } from "@/lib/edge/docs/filingwatch";
import { fitToSchema } from "@/lib/ai/fit";
import { exhibit21Href, holdingPercent, isDealVehicle, normName, parseExhibit21, parseForm4, parseHeader, personName, relationParagraphs, titleCase, xmlText } from "@/lib/edge/graph/parse";
import { eventFlags, exposure as exposureRank, insiderFlags, integratedOwnership, interlocks, loopThrough, ownershipCycles, ownershipRings, reasonPaths, section8Flag, section8Screen, SECTION_8, servedTogether, strongestChain, stronglyConnected } from "@/lib/edge/graph/algo";
import { companyFeatures, scorecardText, splitDateFor } from "@/lib/edge/graph/train";
import { pairsFromHits, sameGroup } from "@/lib/edge/graph/deals";
import { linkCounts, linkSentence, officerTitle, ringFlag, sentence, stakeShare } from "@/lib/edge/graph/findings";
import { adamicAdarFrom, adjacencyByKind, baselineBacktest, bootstrapInterval, midRank, summarize } from "@/lib/edge/graph/backtest";
import { entityList } from "@/components/edge/net/ForceGraph";
import { UPGRADES, upgradeOn, upgradesReport } from "@/lib/edge/premium";
import { poll, pollDelay } from "@/components/edge/docs/client";
import { applySelect, going, mergeRun, sameData } from "@/lib/edge/canvas/view";
import type { RunView, StepView } from "@/lib/edge/canvas/engine";
import { autocorr, chi2Cdf, cholesky, correlation, gammaDraw, ibeta, kendall, kurtosis, ks, lgamma, mean as smean, nearPd, normCdf, normInv, normals, ols, pseudoObs, quantile, realism, rng, solveSpd, std as sstd, tCdf, tInv } from "@/lib/edge/scen/stats";
import { bootstrapGen, fitGarch, fitGjr, fitRegimes, fitTCopula, garchGen, gjrGen, gjrResiduals, runPaths, samplePaths, simulate, summarise, weightedRisk } from "@/lib/edge/scen/models";
import { describeShock, describeViews, parseShock } from "@/lib/edge/scen/drivers";
import { cartSynth, copulaSynth, fillGaps, identifiers, privacyChecks, splitHoldout, tableRealism, type Cell, type TableIn } from "@/lib/edge/scen/tables";
import { parseCsv } from "@/lib/edge/scen/run";
import { eiaDaily, frenchColumns, type FactorRow } from "@/lib/edge/scen/data";
import { copyCheck, facts, stationaryIndex, stylisedRealism } from "@/lib/edge/scen/realism";
import { anchorViews, cleanView, conditionalFill, covarianceOf, effectiveScenarios, entropyPool, factorScenarios, fromLog, namedEpisode, pathSeed, plausibility, resample, retrieveAnalogs, stressedDays, toLog, viewConstraints, viewPrior } from "@/lib/edge/scen/views";
import { isBig } from "@/lib/edge/notify";
import { digestDue, digestEmail, digestItem } from "@/lib/edge/digest";
import { parseCommand } from "@/lib/functions";
import { simRequest, whatIfFrom, whatIfUrl } from "@/lib/edge/links";
import { pushPatches } from "@/lib/edge/push";
import { studioTarget } from "@/lib/edge/canvas/executors/studio";
import type { StudioDocData } from "@/lib/studio/types";
import { peopleAt, plainRegistrant } from "@/lib/edge/crm";
import { introBrief } from "@/lib/edge/intros";
import { cellSize, components, densify, levelling, maskFromOverlay, parseNpy, profileStats, quantileSorted, rankBelow, readSite, sampleGrid, slopeDegrees, type Grid } from "@/lib/edge/terrain";
import { hexagon, positionWords } from "@/lib/edge/terrain-view";
import { decodePng, overlayPng, type ChangeResult } from "@/lib/edge/change";
import { convexHull, findStructures, polygonStats } from "@/lib/edge/site3d";
import { monthly } from "@/lib/edge/timelapse";
import { briefCards } from "@/lib/edge/brief";
import { archiveWindows, byDay, flareConfidence, flareMagnitude, flares, flareStats, hotPixels, isoWeek, repeats, spotsNear, weeksFrom, withWeek } from "@/lib/edge/flares";
import { parseFirmsCsv } from "@/lib/edge/sources/firms";
import { summariseReports } from "@/lib/edge/sources/nmocd";
import { BRIGHT, bearingWords, comparable, counts, levelOf, majority, pickStacks, pixelArea, radarChange, radarConfidence, radarMagnitude, radarOverlayPng, radarWorthy, ringBright, toDb, unreported } from "@/lib/edge/radar";
import { cornersIn, radarUrl, scenesFrom, type RadarScene } from "@/lib/edge/sources/s1";
import { boxKm, judged, operatorsOf, paceRatio, permitConfidence, permitJump, permitMagnitude, permitRepeats, statesNear, trackSeen, windowsOf } from "@/lib/edge/permits";
import { txPermitsFrom } from "@/lib/edge/sources/rrc";
import { nmPermitsFrom } from "@/lib/edge/sources/nmwells";
import { planetAuth, planetScenesFrom, planetSearchBody, thumbPath, validScene } from "@/lib/edge/premium/planet";
import { licensed, methaneConfidence, methaneMagnitude, newestPass, plumesFrom, plumesNear, plumesUrl, totalRate } from "@/lib/edge/premium/carbonmapper";
import type { EdgeCard as EdgeCardT } from "@/lib/edge/feed";
import { composeSections, sectionTitle } from "@/lib/edge/story";
import { starterTemplate } from "@/lib/edge/onboard";
import { z } from "zod";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

/* A synthetic 64 x 64 scene at 10 m: sandy ground with a speckle of shrubs, deterministic. */
const W = 64, H = 64, AREA = (W * 10 / 1000) * (H * 10 / 1000);
function scene(paint?: (x: number, y: number) => [number, number, number] | null): Uint8Array {
  const d = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, shrub = (x * 7 + y * 13) % 17 === 0;
    const base: [number, number, number] = shrub ? [120, 110, 80] : [205, 175, 140];
    const [r, g, b] = paint?.(x, y) ?? base;
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  return d;
}
const inBox = (x: number, y: number, x0: number, y0: number, s: number) => x >= x0 && x < x0 + s && y >= y0 && y < y0 + s;
const classes = (f: (x: number, y: number) => number) => { const c = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c[y * W + x] = f(x, y); return c; };

async function main() {
  console.log("ground change");
  const before = scene();
  const pad = scene((x, y) => (inBox(x, y, 20, 20, 10) ? [250, 248, 240] : null));
  const r1 = changeBetween(before, pad, W, H, AREA);
  check("a new 10 x 10 pad is found as new bare ground", r1.cleared.pixels >= 80 && r1.cleared.pixels <= 100 && r1.darkened.pixels === 0, r1.cleared);
  check("its area is about a hectare", Math.abs(r1.cleared.hectares - 1) < 0.25, r1.cleared.hectares);
  check("a pad is compact", r1.shape > 0.8, r1.shape);
  check("the largest change is the pad", r1.largest.pixels === r1.cleared.pixels);

  const tilled = scene((x, y) => (inBox(x, y, 20, 20, 12) ? [250, 175, 115] : null));
  const rt = changeBetween(scene((x, y) => (inBox(x, y, 20, 20, 12) ? [165, 118, 82] : null)), tilled, W, H, AREA);
  check("soil turning tan (a ploughed field, a dry year) is not new bare ground", rt.cleared.pixels === 0, rt.cleared.pixels);

  const crop = changeBetween(before, scene((x, y) => (inBox(x, y, 40, 10, 8) ? [60, 110, 55] : null)), W, H, AREA);
  check("a field turning green is not a new dark surface", crop.darkened.pixels === 0, crop.darkened.pixels);
  const algae = changeBetween(before, scene((x, y) => (inBox(x, y, 40, 10, 8) ? [40, 120, 110] : null)), W, H, AREA);
  check("a turquoise pond still is", algae.darkened.pixels >= 48, algae.darkened.pixels);

  const pond = scene((x, y) => (inBox(x, y, 40, 10, 8) ? [30, 40, 45] : null));
  const r2 = changeBetween(before, pond, W, H, AREA);
  check("a new pond is found as a new dark surface", r2.darkened.pixels >= 48 && r2.cleared.pixels === 0, r2.darkened);

  const hazy = scene((x, y) => { const shrub = (x * 7 + y * 13) % 17 === 0; return shrub ? [150, 140, 110] : [235, 215, 185]; });
  const r3 = changeBetween(before, hazy, W, H, AREA);
  check("haze or a brighter sun over everything is not change", r3.cleared.pixels === 0 && r3.darkened.pixels === 0, { c: r3.cleared.pixels, d: r3.darkened.pixels });

  const speckle = scene((x, y) => ((x * 31 + y * 17) % 97 === 0 ? [255, 255, 255] : null));
  const r4 = changeBetween(before, speckle, W, H, AREA);
  check("scattered single pixels are not change", r4.cleared.pixels === 0, r4.cleared.pixels);

  const vegetated = changeBetween(before, pond, W, H, AREA, { classesBefore: classes(() => 5), classesAfter: classes((x, y) => (inBox(x, y, 40, 10, 8) ? 4 : 5)) });
  check("darkening Sentinel-2 classes as vegetation is not reported", vegetated.darkened.pixels === 0, vegetated.darkened.pixels);
  const clouded = changeBetween(before, pad, W, H, AREA, { classesBefore: classes(() => 5), classesAfter: classes((x, y) => (y < 32 ? 9 : 5)) });
  check("cloud in either scene is left out", clouded.validFraction === 0.5 && clouded.cleared.pixels === 0, { valid: clouded.validFraction, cleared: clouded.cleared.pixels });

  const flooded = scene((x, y) => (inBox(x, y, 0, 0, 40) ? [40, 50, 60] : null));
  const r5 = changeBetween(before, flooded, W, H, AREA);
  check("when much of the box differs, nothing is reported", r5.sceneWide && r5.darkened.pixels === 0 && r5.mask.every((m) => m === 0), { sceneWide: r5.sceneWide, d: r5.darkened.pixels });
  const n1 = normalize([0.2, 0.4, 0.6, 0.8, 0.5, 0.3], [0.3, 0.5, 0.7, 0.9, 0.6, 0.4]);
  check("normalization removes a uniform brightening", Math.abs(n1.gain - 1) < 1e-6 && Math.abs(n1.offset + 0.1) < 1e-6, n1);
  const b2 = Array.from({ length: 100 }, (_, i) => 0.3 + (i % 10) * 0.05), a2 = b2.map((v, i) => (i < 10 ? 0.98 : v * 1.2 + 0.02));
  const n2 = normalize(b2, a2);
  check("normalization fits the unchanged pixels, not the changed ones", Math.abs(n2.gain - 1 / 1.2) < 0.02 && Math.abs(n2.offset + 0.02 / 1.2) < 0.02, n2);

  const rgba = new Uint8Array([4, 0, 0, 255, 9, 0, 0, 255, 6, 0, 0, 0]);
  check("scene classes read from the first channel, 0 where there is no data", classesFrom(rgba, 3, 1).join(",") === "4,9,0");

  const calm = { ...r1, largest: { pixels: 200, hectares: 2 }, shape: 0.9, noise: 0.005, validFraction: 1 };
  const restless = { ...calm, noise: 0.1 };
  check("a compact change in a calm scene is high confidence", changeConfidence(calm, 10) >= 0.7, changeConfidence(calm, 10));
  check("the same change in a restless scene is low", changeConfidence(restless, 10) < 0.45, changeConfidence(restless, 10));
  check("scenes from different seasons lower confidence", changeConfidence(calm, 120) < changeConfidence(calm, 10));
  check("season gap wraps the year", seasonGap("2025-12-30", "2026-01-02") === 3 && Math.round(seasonGap("2025-01-01", "2025-07-02")) === 182, [seasonGap("2025-12-30", "2026-01-02"), seasonGap("2025-01-01", "2025-07-02")]);

  console.log("deal screen");
  check("HHI of two equal owners is 5,000", hhi({ a: 50, b: 50 }) === 5000);
  check("HHI with no capacity is unknown", hhi({}) === null && hhi({ a: 0 }) === null);
  check("above 1,800 and up more than 100 screens high", screen(1500, 1900) === "high");
  check("above 1,000 and up more than 100 is worth a look", screen(900, 1050) === "watch");
  check("a small change does not screen", screen(2000, 2050) === "" && screen(null, 3000) === "");
  const cc = countyConcentration([{ owner: "ET", party: "a", capacity: 100 }, { owner: "TRGP", party: "b", capacity: 100 }, { owner: "EPD", party: null, capacity: 200 }]);
  check("combining two quarter owners raises the county's HHI by 1,250", cc.before === 3750 && cc.after === 5000, cc);
  check("a ticker is a party", partyFor("ET")?.label === "Energy Transfer" && partyFor("et")?.tickers[0] === "ET");
  check("a parent's name is a party", partyFor("Kinder Morgan")?.tickers[0] === "KMI");
  check("an acquired operator maps to its buyer", partyFor("WTG Midstream")?.tickers[0] === "ET" && parentOf("EnLink Midstream Services")?.ticker === "OKE");
  check("an unknown operator is matched by name", partyFor("Durango Midstream")?.companies[0] === "Durango Midstream" && partyFor("Durango Midstream")?.tickers.length === 0);
  check("too short to match is refused", partyFor("xy") === null && partyFor("  ") === null);
  check("distance between Midland and Odessa is about 30 km", Math.abs(haversineKm(-102.0779, 31.9973, -102.3676, 31.8457) - 32) < 3, haversineKm(-102.0779, 31.9973, -102.3676, 31.8457));

  const pf = {
    place: { name: "Permian Basin", bbox: [-104.6, 30.4, -100.4, 33.9] },
    parties: [{ key: "a", label: "Energy Transfer", ticker: "ET", color: "#E69F00", pipelineKm: 3361, plants: 18, capacityMMcfd: 2796 }, { key: "b", label: "Targa Resources", ticker: "TRGP", color: "#56B4E9", pipelineKm: 0, plants: 11, capacityMMcfd: 1152 }],
    combined: { pipelineKm: 3361, plants: 29, capacityMMcfd: 3948, capacityShare: 0.383 },
    overlap: { counties: 7, adjacentCounties: 15, parallelKm: 0, nearbyPlants: [] },
    counties: [{ geoid: "35025", name: "Lea, NM", parties: ["a", "b"], adjacentTo: [], pipelineKm: {}, capacity: { a: 110, b: 270 }, totalCapacity: 1517, hhiBefore: 2342, hhiAfter: 2600, delta: 258, flag: "high" as const }],
    divestitures: [{ plant: { id: 1, name: "Jal #3 Plant", company: "Energy Transfer", ticker: "ET", capacityMMcfd: 110, lon: 0, lat: 0, party: "a" }, county: "Lea, NM", reason: "" }],
    method: "", sources: [],
  } as unknown as Proforma;
  const words = describeProforma(pf, { kind: "acquisition" });
  check("a deal card names both sides", words.title === "Pro-forma map: Energy Transfer plus Targa Resources", words.title);
  check("its summary gives share, counties and divestitures", /38%/.test(words.summary) && /7 counties/.test(words.summary) && /Lea, NM screens high/.test(words.summary) && /Jal #3 Plant/.test(words.summary), words.summary);
  check("a flagged county weighs more than none", proformaWeight(pf) > proformaWeight({ ...pf, counties: [] }) && proformaWeight(pf) <= 1);

  console.log("watches and preferences");
  check("a company watch takes a ticker", JSON.stringify(parseWatch({ kind: "company", ticker: " kmi " })) === JSON.stringify({ kind: "company", label: "Kinder Morgan", target: { ticker: "KMI", company: "Kinder Morgan" } }));
  check("a bad ticker is refused", typeof parseWatch({ kind: "company", ticker: "not a ticker!" }) === "string");
  check("a named place is watchable", (parseWatch({ kind: "place", place: "permian" }) as { label: string }).label === "Permian Basin");
  check("a drawn area must be small", typeof parseWatch({ kind: "place", bbox: [-110, 25, -95, 40] }) === "string" && typeof parseWatch({ kind: "place", bbox: [-103, 31, -102.5, 31.5] }) === "object");
  check("an upside-down box is refused", typeof parseWatch({ kind: "place", bbox: [-102, 31, -103, 32] }) === "string");
  check("other kinds wait for their modules", typeof parseWatch({ kind: "person" }) === "string");
  const starters = starterWatches({ firmTicker: "KMI", watchlist: ["AAPL", "ET", "MSFT"] });
  check("starter watches: the Permian, then the firm and watchlist names with maps", JSON.stringify(starters) === JSON.stringify([{ kind: "place", place: "permian" }, { kind: "company", ticker: "KMI" }, { kind: "company", ticker: "ET" }]), starters);
  check("with no mapped names, starters fall back to the big Permian operators", JSON.stringify(starterWatches({ firmTicker: "", watchlist: ["AAPL"] }).slice(1)) === JSON.stringify([{ kind: "company", ticker: "ET" }, { kind: "company", ticker: "KMI" }]));
  check("Edge is off until turned on", edgePrefs({}, "banker").beta === false && edgePrefs({ edge: { beta: true } }, "banker").beta === true);
  check("stored blend values are clamped, missing ones take the role's", edgePrefs({ edge: { blend: { relevance: 3, size: -1 } } }, "markets").blend.relevance === 1 && edgePrefs({ edge: { blend: { relevance: 3, size: -1 } } }, "markets").blend.size === 0 && edgePrefs({}, "markets").blend.novelty === defaultBlend("markets").novelty);

  console.log("feed ranking");
  const watches = [
    { kind: "company" as const, label: "Energy Transfer", target: { ticker: "ET" }, mine: true },
    { kind: "place" as const, label: "Waha hub", target: { bbox: [-103.35, 30.95, -102.85, 31.4] as [number, number, number, number] }, mine: false },
  ];
  check("a finding matches a watched company", matches({ tickers: ["ET"], bbox: null }, watches).length === 1);
  check("a finding matches a watched place it lies in", matches({ tickers: [], bbox: [-103.2, 31.2, -103.1, 31.3] }, watches)[0]?.label === "Waha hub");
  check("a finding elsewhere matches nothing", matches({ tickers: ["KMI"], bbox: [-101, 32, -100.9, 32.1] }, watches).length === 0);
  check("size: five hectares is full, a pro-forma uses its score", sizeOf("ground_change", 10) === 1 && sizeOf("ground_change", 1) === 0.2 && sizeOf("deal_proforma", 0.4) === 0.4);
  check("novelty fades with age", noveltyOf("ground_change", 0) > noveltyOf("ground_change", 60) && noveltyOf("ground_change", 0) > noveltyOf("deal_proforma", 0));
  const s = { relevance: 1, size: 0.2, novelty: 0.9, confidence: 0.5 };
  check("more weight on a strong signal raises the score", score(s, { relevance: 1, size: 0, novelty: 0, confidence: 0 }, 0) > score(s, { relevance: 0, size: 1, novelty: 0, confidence: 0 }, 0));
  check("older findings score lower", score(s, defaultBlend("banker"), 0) > score(s, defaultBlend("banker"), 90));
  check("all-zero weights do not divide by zero", Number.isFinite(score(s, { relevance: 0, size: 0, novelty: 0, confidence: 0 }, 0)));

  console.log("audit trail");
  const csv = trailCsv([{ subject: "detection:1", sourceName: "EIA, plants", sourceUrl: "https://x", license: "Public domain", method: 'said "hi"', modelVersion: "", retrievedAt: new Date("2026-09-30T00:00:00Z") }]);
  check("the audit CSV has a header and quotes commas and quotes", csv.split("\n")[0] === "subject,source,url,license,method,model_version,retrieved_at" && csv.includes('"EIA, plants"') && csv.includes('"said ""hi"""'), csv);

  console.log("beta gate");
  check("Edge is not in the nav until turned on", !featuresFor("banker").some((f) => f.id === "edge") && featuresFor("banker", { edge: true }).some((f) => f.id === "edge"));
  check("a pinned Edge tab drops out when the beta is off", !normalizeNavPrefs({ pinned: ["home", "edge"] }, "banker").pinned.includes("edge") && normalizeNavPrefs({ pinned: ["home", "edge"] }, "banker", { edge: true }).pinned.includes("edge"));

  console.log("canvas");
  const all = new Set(["source.companies", "earth.watch", "earth.proforma", "out.memo", "out.signal", "out.export"]);
  const hero = TEMPLATES.find((t) => t.id === "asset-watch")!.build({ tickers: ["ET", "TRGP"] });
  check("the hero template is valid with Earth and outputs available", validate(hero, all).filter((i) => i.level === "error").length === 0, validate(hero, all));
  check("a block without its module is reported", validate(TEMPLATES.find((t) => t.id === "buyer-finder")!.build({ tickers: ["ET"] }), all).some((i) => /not available/.test(i.message)));
  const g: Graph = { nodes: [makeNode("source.companies", { tickers: ["ET"] }, "a"), makeNode("out.memo", {}, "m")], edges: [] };
  check("an unwired required input is an error", validate(g, all).some((i) => i.nodeId === "m" && /Connect/.test(i.message)));
  const bad: Graph = { nodes: [makeNode("source.companies", {}, "a"), makeNode("earth.proforma", {}, "p"), makeNode("out.export", {}, "x")], edges: [wire("a", "companies", "x", "in")] };
  check("a wire into an input that cannot use its kind is an error", validate(bad, all).some((i) => i.nodeId === "x" && /cannot use/.test(i.message)));
  const loop: Graph = { nodes: [makeNode("out.memo", {}, "m1"), makeNode("out.memo", {}, "m2")], edges: [wire("m1", "memo", "m2", "in"), wire("m2", "memo", "m1", "in")] };
  check("a loop is found", hasCycle(loop) && validate(loop, new Set(["out.memo"])).some((i) => /loop/.test(i.message)));
  const w = waves(hero);
  check("waves run sources first and the memo last", w[0].includes("companies") && w[w.length - 1].includes("memo") && w.flat().length === hero.nodes.length, w);
  const tip = suggestions({ nodes: [makeNode("source.companies", {}, "a")], edges: [] }, all);
  check("an unused output suggests blocks that accept it", tip[0]?.types.includes("earth.watch") && tip[0]?.types.includes("earth.proforma"), tip);
  const laid = layout(hero);
  check("layout puts later waves further right", laid.nodes.find((n) => n.id === "memo")!.position.x > laid.nodes.find((n) => n.id === "companies")!.position.x);
  const built = assemble({ title: "t", explanation: "", nodes: [{ key: "c", type: "source.companies", config: { tickers: "et, kmi", junk: 1 } }, { key: "e", type: "earth.watch", config: { sites: 99 } }, { key: "z", type: "made.up" }], wires: [{ from: "c", fromPort: "companies", to: "e", toPort: "in" }, { from: "e", fromPort: "findings", to: "c", toPort: "nothing" }] }, all);
  check("the builder keeps known blocks and fitting wires, drops the rest", built.graph.nodes.length === 2 && built.graph.edges.length === 1 && built.dropped.length === 2, built);
  check("the builder cleans settings", JSON.stringify(cleanConfig("source.companies", { tickers: "et, kmi", junk: 1 })) === JSON.stringify({ tickers: ["ET", "KMI"] }) && cleanConfig("earth.watch", { sites: 99 }).sites === 8);
  const md = memoMarkdown({ title: "t", paragraphs: [{ text: "Capacity rose [1, 2].", cites: [2, 1, 9] }, { text: "A view.", cites: [] }], caveats: ["Old data."] }, 2, true);
  check("memo citations are checked and inline ones removed", md.startsWith("Capacity rose. [1][2]") && md.includes("A view. *(analysis)*") && md.includes("synthetic"), md);
  const findings: Findings = { items: [{ id: 1, title: "New pad", kind: "ground_change", confidence: 0.8, tickers: ["ET"], site: "Orla", observedAt: "2026-09-11T00:00:00Z", hectares: 2, summary: "s", sources: [] }] };
  check("values know their kind", kindOfValue(findings) === "findings" && kindOfValue({ columns: [], rows: [] }) === "table" && kindOfValue({ metric: "x", value: 1, triggered: false, detail: "" }) === "signal");
  check("findings become evidence, rows and a metric", evidenceOf("findings", findings).length === 1 && rowsOf("findings", findings)!.rows.length === 1 && metricOf("findings", findings)!.value === 1);
  const synth: Table = { columns: [{ name: "a", type: "num" }], rows: [[1], [2]], synthetic: { recipe: "ctgan", seed: 7 } };
  check("a synthetic export says so on its first line", toCsv(synth).startsWith("# SYNTHETIC DATA: ctgan, seed 7\na\n1\n2"));
  check("signals cross lines", crossed("above", 5, 3, null) && !crossed("below", 5, 3, null) && crossed("changes", 2, 0, 1) && !crossed("changes", 2, 0, null) && !crossed("changes", 2, 0, 2));

  console.log("free tiers and storage");
  const lim = { modalUsd: 25, inngestExecutions: 45000, r2Bytes: 9e9, r2ClassA: 900000, r2ClassB: 9000000, docsDbBytes: 1.8e8 };
  const when = new Date("2026-10-15T12:00:00Z");
  check("under the ceilings everything runs", allowance("modal", { usd: 3 }, lim, when).ok && allowance("inngest", { executions: 10 }, lim, when).ok && allowance("r2", { bytes: 1e6 }, lim, when).ok);
  check("at a ceiling the service pauses until next month", !allowance("modal", { usd: 25 }, lim, when).ok && /resumes 2026-11-01/.test(allowance("inngest", { executions: 45000 }, lim, when).reason ?? ""));
  check("storage stops when full or out of operations", !allowance("r2", { bytes: 9e9 }, lim, when).ok && !allowance("r2", { class_b: 9e6 }, lim, when).ok);
  check("months reset at the turn of the year", resetsOn(new Date("2026-12-20T00:00:00Z")) === "2027-01-01");
  check("signed links stay the same within the hour", signingTime(Date.parse("2026-10-01T10:05:00Z"), 3600) === signingTime(Date.parse("2026-10-01T10:59:59Z"), 3600) && signingTime(Date.parse("2026-10-01T10:05:00Z"), 3600) === "20261001T100000Z");
  const r = partsForRange(PART_BYTES * 2 + 10, PART_BYTES - 5, PART_BYTES + 4);
  check("a byte range across two parts reads the end of one and the start of the next", r.length === 2 && r[0].n === 0 && r[0].from === PART_BYTES - 5 && r[1].n === 1 && r[1].to === 4, r);
  check("a range past the end is clipped", partsForRange(100, 50, 1000).length === 1 && partsForRange(100, 50, 1000)[0].to === 99);
  check("the ML status address follows Modal's naming", statusUrl("https://ws--youbank-edge-ml-api.modal.run") === "https://ws--youbank-edge-ml-status.modal.run" && statusUrl("https://x-api.modal.run", "https://explicit") === "https://explicit");

  console.log("foundation-model check");
  const yes = judge({ prithvi: { model: "P", blobs: [{ z: 3 }] }, sam: { model: "S", blobs: [{ iou: 0.1, areaPx: 400, polygon: [[1, 2]] }] } }, [{ pixels: 100 }], 0.5);
  check("agreement confirms and raises confidence", yes.refinement.verdict === "confirmed" && yes.confidence > 0.5 && yes.refinement.models.join() === "P,S", yes);
  const no = judge({ prithvi: { blobs: [{ z: -0.5 }] }, sam: { blobs: [{ iou: 0.95 }] } }, [{ pixels: 100 }], 0.5);
  check("disagreement doubts and lowers confidence", no.refinement.verdict === "doubtful" && no.confidence < 0.5, no);
  check("missing model answers leave confidence alone", judge({}, [{ pixels: 10 }], 0.4).confidence === 0.4);

  {
  console.log("documents: quotes");
  const passage = "Volumes on our Permian gathering systems rose 12% year over year, driven by new well connections in the Delaware Basin. We expect 2026 growth capital of $1.1 billion.";
  check("an exact quote is found", quoteFound("rose 12% year over year, driven by new well connections", passage));
  check("quote marks, case and spacing do not matter", quoteFound("“We  EXPECT 2026 growth capital of $1.1 billion”", passage));
  check("a sentence-ending full stop does not block a match", quoteFound("in the Delaware Basin.", passage) && normText("$1.1 billion.") === "$1.1 billion");
  check("an invented quote is rejected", !quoteFound("volumes fell 12% on weaker drilling activity", passage));
  check("a changed number is rejected", !quoteFound("rose 15% year over year, driven by new well connections", passage));
  check("a quote too short to mean anything is rejected", !quoteFound("rose", passage));
  const long = "Volumes on our Permian gathering systems rose 12% year over year driven by the new well connections in the Delaware Basin";
  check("a long quote with a word off still counts", quoteFound(long, passage));
  check("answers use the same checker", answerQuoteFound === quoteFound);
  check("an omission marked with an ellipsis still counts", quoteFound("Volumes on our Permian gathering systems rose 12% … We expect 2026 growth capital of $1.1 billion", passage));
  check("a dropped negation is never forgiven", !quoteFound("we do expect to raise the dividend this year", "We do not expect to raise the dividend this year.") && quoteFound("we do not expect to raise the dividend", "We do not expect to raise the dividend this year."));
  check("a word hyphenated across a line still matches", quoteFound("rely on midstream infrastructure owned by third parties", "We rely on midstream infra-\nstructure owned by third parties.") && quoteFound("infrastructure owned by third parties", "We rely on midstream infra-\nstructure owned by third parties."));
  check("the pieces around an ellipsis must come in order", !quoteFound("We expect 2026 growth capital … Volumes on our Permian gathering systems rose", passage));
  check("a Japanese quote is checked in the original", quoteFound("当社のパーミアン盆地での生産量は前年比12%増加しました", "第3四半期において、当社のパーミアン盆地での生産量は前年比12%増加しました。") && !quoteFound("当社の生産量は減少しました", "第3四半期において、当社のパーミアン盆地での生産量は前年比12%増加しました。"));
  check("accented Spanish is checked in the original", quoteFound("los volúmenes aumentaron un 12% interanual", "En el trimestre, los volúmenes aumentaron un 12% interanual gracias a nuevas conexiones."));
  check("full-width digits match ordinary ones", normText("１２％") === "12%");

  console.log("documents: highlighting");
  const items = ["Item 1A. Risk Factors", "Our business depends on", "natural gas production in the Permian", "Basin, which may decline.", "Other text"];
  const at = locateQuote(items, "depends on natural gas production in the Permian Basin");
  check("a quote spanning PDF text items marks exactly those items", at.join() === "1,2,3", at);
  const hy = locateQuote(["We rely on midstream infra-", "structure owned by third parties to move our", "products to market."], "We rely on midstream infrastructure owned by third parties to move our products to market");
  check("a hyphenated line break still finds the quote", hy.includes(1) && hy.includes(2), hy);
  check("nothing is marked when the quote is absent", locateQuote(items, "the weather in Norway was unusually warm this year").length === 0);
  const words = "The company expects capital spending of about $2 billion next year".split(/(\s+)/);
  const w = locateQuote(words, "capital spending of about $2 billion");
  check("a quote inside a passage marks its words", w.length > 0 && words.slice(Math.min(...w), Math.max(...w) + 1).join("") === "capital spending of about $2 billion", w);

  console.log("documents: diffs");
  const d = wordDiff("We may be unable to obtain financing on acceptable terms", "We may be unable to obtain additional financing on favorable terms");
  check("a word diff keeps shared words and marks edits", d.some((p) => p.t === "add" && p.s.includes("additional")) && d.some((p) => p.t === "del" && p.s === "acceptable") && d.some((p) => p.t === "add" && p.s === "favorable") && d.filter((p) => p.t === "same").map((p) => p.s).join(" ").startsWith("We may be unable to obtain"), d);
  check("identical text is one unchanged run", JSON.stringify(wordDiff("a b c", "a b c")) === JSON.stringify([{ t: "same", s: "a b c" }]));
  check("an empty side is all added", wordDiff("", "new words")[0].t === "add");
  const prior = ["Cybersecurity incidents could disrupt our operations, damage our systems and harm our reputation with customers.", "Our pipelines are subject to extensive federal and state regulation, which could limit the rates we charge.", "We depend on a small number of customers for a large share of our revenue and cash flow each year."].join("\n");
  const current = ["Cybersecurity incidents, including ransomware attacks, could disrupt our operations, damage our systems and harm our reputation with customers.", "Our pipelines are subject to extensive federal and state regulation, which could limit the rates we charge.", "Tariffs on imported steel and other materials could raise the cost of our growth projects materially."].join("\n");
  const r = diffSections(prior, current);
  check("the radar finds one added, one removed, one reworded and one unchanged paragraph", r.counts.added === 1 && r.counts.removed === 1 && r.counts.changed === 1 && r.counts.unchanged === 1, r.counts);
  check("a reworded paragraph carries its earlier version", r.rows.find((x) => x.status === "changed")?.before?.startsWith("Cybersecurity incidents could") === true);
  check("added paragraphs are listed first", r.rows[0].status === "added" && /Tariffs/.test(r.rows[0].text));
  check("headings and scraps are not paragraphs", paragraphs("ITEM 1A\nShort line\nA real paragraph about risk that is long enough to be compared with the same paragraph a year before.").length === 1);

  console.log("documents: passages");
  const longText = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} explains one more fact about the company's operations in some detail.`).join(" ");
  const parts = splitText(`${longText}\n\nA short closing paragraph.`);
  check("long text is cut near a thousand characters", parts.length >= 2 && parts.every((p) => p.length <= 1400), parts.map((p) => p.length));
  check("cuts overlap so a fact split across them lands whole", parts.length >= 2 && parts[1].includes(parts[0].slice(-40).trim().split(" ").slice(-2).join(" ")));
  const vocab = new Set(`${longText} A short closing paragraph.`.split(/\s+/));
  check("every passage starts at a whole word", parts.every((p) => vocab.has(p.split(/\s+/)[0])), parts.map((p) => p.slice(0, 12)));
  const runOn = splitText(Array.from({ length: 400 }, (_, i) => `word${i}`).join(" "));
  check("a run-on without full stops is cut between words", runOn.length >= 2 && runOn.every((p) => p.length <= 1400 && /^word\d+/.test(p) && /word\d+$/.test(p)), runOn.map((p) => [p.slice(0, 8), p.slice(-8)]));
  const pages = passagesFromPages([{ n: 3, text: "Revenue grew.", tables: [[["Year", "Revenue"], ["2025", "1,200"]]] }, { n: 4, text: "Costs fell." }]);
  check("page passages keep their page numbers and tables become rows", pages[0].page === 3 && pages[0].text.includes("Year | Revenue") && pages[1].page === 4, pages);
  check("empty table rows are dropped", tableText([["", " "], ["a", "b"]]) === "a | b");
  const filing = "Table of contents\nItem 1A. Risk Factors 12\nItem 7. Management's Discussion 40\n\nItem 1A. Risk Factors\nWe face many risks in our business that could hurt results.\n\nItem 7. Management's Discussion and Analysis\nRevenue rose on higher volumes.";
  check("a section is read past the table of contents", sectionText(filing, "Risk factors").startsWith("We face many risks"));
  const q10 = "Part II\nItem 1A. Risk Factors\nThere have been no material changes to our risk factors except the following new risk about tariffs.\n\nItem 2. Unregistered Sales of Equity Securities and Use of Proceeds\nNone.\n\nItem 6. Exhibits\n31.1 Certification";
  check("a 10-Q's risk factors end at the next item, whatever it is", sectionText(q10, "Risk factors") === "There have been no material changes to our risk factors except the following new risk about tariffs.", sectionText(q10, "Risk factors"));
  const fp = passagesFromFiling(filing);
  check("filing passages know their section", fp.some((p) => p.section === "Risk factors" && p.text.includes("many risks")) && fp.some((p) => p.section === "MD&A" && p.text.includes("higher volumes")), fp.map((p) => p.section));
  const tp = passagesFromTranscript([{ start: 0, end: 5, text: "Good morning and welcome.", speaker: "Operator" }, { start: 5, end: 9, text: "Thanks.", speaker: "Jane Doe, CFO" }, { start: 9, end: 20, text: "Volumes were strong.", speaker: "Jane Doe, CFO" }]);
  check("transcripts become speaker turns with times", tp.length === 2 && tp[1].speaker === "Jane Doe, CFO" && tp[1].tStart === 5 && tp[1].tEnd === 20 && tp[1].text === "Thanks. Volumes were strong.", tp);
  const many = [...Array.from({ length: 5 }, (_, i) => ({ ord: i, section: "Financial statements" })), { ord: 5, section: "Risk factors" }, { ord: 6, section: "MD&A" }];
  const kept = keepNarrative(many, 3);
  check("big filings keep their narrative sections first, in order", kept.length === 3 && kept.map((p) => p.section).join() === "Financial statements,Risk factors,MD&A" && kept[0].ord === 0, kept);

  console.log("documents: retrieval, topics, files, tone");
  const f = fuse([[1, 2, 3], [3, 1, 4], [1]]);
  check("rank fusion favours what several searches agree on", f[0].id === 1 && f[1].id === 3 && f[f.length - 1].id === 4, f);
  const pts: number[][] = [];
  for (let i = 0; i < 20; i++) pts.push([10 + (i % 3) * 0.1, 0, 0, i % 2 ? 0.1 : 0]);
  for (let i = 0; i < 20; i++) pts.push([0, 10 + (i % 3) * 0.1, 0, i % 2 ? 0.1 : 0]);
  const xy = pca2(pts);
  const km = kmeans(xy, 2);
  check("two groups of passages land in two clusters", new Set(km.slice(0, 20)).size === 1 && new Set(km.slice(20)).size === 1 && km[0] !== km[39], km);
  check("files are typed by name when the browser gives no type", mimeOf("deck.pptx", "").includes("presentationml") && mimeOf("call.m4a", "application/octet-stream") === "audio/mp4" && mimeOf("scan.TIF", "") === "image/tiff" && mimeOf("x.pdf", "application/pdf") === "application/pdf" && mimeOf("note.msg", "") === "application/vnd.ms-outlook");
  const turns: Turn[] = [{ from: 0, t: 0, speaker: "Operator", hedging: 0, tone: 0.2, note: "" }, { from: 3, t: 30, speaker: "CFO", hedging: 0.6, tone: 0.1, note: "cautious on guidance" }, { from: 9, t: 95, speaker: "CFO", hedging: 0.2, tone: 0.5, note: "" }];
  check("the turn under a moment is the last one started", turnAt(turns, 40)?.note === "cautious on guidance" && turnAt(turns, 95)?.hedging === 0.2 && turnAt(turns, null) === null);
  const sp = bySpeaker(turns);
  check("speakers are averaged, the busiest first", sp[0].speaker === "CFO" && sp[0].turns === 2 && sp[0].hedging === 0.4, sp);
  const later: Turn[] = [{ from: 0, t: 0, speaker: "cfo", hedging: 0.7, tone: -0.2, note: "" }];
  const shift = toneShift(turns, later);
  check("a speaker's hedging and tone shift between calls", shift.length === 1 && shift[0].hedging === 0.3 && shift[0].tone === -0.5, shift);
  check("the viewer's tone summary has the turn and the averages", toneOf(turns, 31).turn?.speaker === "CFO" && toneOf(turns, 31).overall.hedging === 0.27);
  check("clocks read as m:ss and h:mm:ss", clockOf(65) === "1:05" && clockOf(3725) === "1:02:05");

  console.log("structured answers");
  const Lines = z.object({ lines: z.array(z.object({ text: z.string(), tags: z.array(z.string()).max(2) })).max(3), note: z.string().nullable(), table: z.object({ rows: z.array(z.array(z.string())).max(2) }).nullable().optional() });
  const js = z.toJSONSchema(Lines) as Record<string, unknown>;
  const raw = { lines: Array.from({ length: 5 }, (_, i) => ({ text: `l${i}`, tags: ["a", "b", "c"] })), note: null, table: { rows: [["1"], ["2"], ["3"]] } };
  const fitted = Lines.safeParse(fitToSchema(raw, js));
  check("over-long lists are trimmed to the schema instead of failing", fitted.success && fitted.data.lines.length === 3 && fitted.data.lines[0].tags.length === 2 && fitted.data.table?.rows.length === 2, fitted.success ? fitted.data : fitted.error.issues);
  check("everything else is still validated", !Lines.safeParse(fitToSchema({ lines: [{ text: 1, tags: [] }], note: null }, js)).success);
  check("trimming leaves the model's answer untouched", raw.lines.length === 5 && raw.table.rows.length === 3);

  console.log("documents: feed cards");
  check("a filing's size grows with its edits and caps at one", filingMagnitude({ added: 2, removed: 1, changed: 2, unchanged: 40 }) === 0.2 && filingMagnitude({ added: 30, removed: 0, changed: 0, unchanged: 0 }) === 1);
  check("the card title counts the edits", filingTitle("Energy Transfer", "10-K", { added: 3, removed: 1, changed: 0, unchanged: 9 }) === "Energy Transfer's new 10-K: 3 risk factors added, 1 dropped" && filingTitle("X", "10-Q", { added: 1, removed: 0, changed: 2, unchanged: 0 }) === "X's new 10-Q: 1 risk factor added, 2 reworded");
  check("a filing change is fresher news than a deal and less than a satellite change", noveltyOf("filing_change", 0) < noveltyOf("ground_change", 0) && noveltyOf("filing_change", 0) > noveltyOf("deal_proforma", 0));
  }

  {
    console.log("networks: reading filings");
    check("names compare without suffixes and punctuation", normName("Kinder Morgan, Inc.") === "kinder morgan" && normName("Energy Transfer LP") === "energy transfer" && normName("AT&T Inc.") === "at and t" && normName("Sunoco L.P.") === "sunoco");
    check("upper-case names read naturally", titleCase("ENERGY TRANSFER LP") === "Energy Transfer LP" && titleCase("MCREYNOLDS") === "McReynolds");
    check("Form 4 names turn around", personName("WARREN KELCY L") === "Kelcy L. Warren" && personName("DAVIS WATERS S IV") === "Waters S. Davis IV" && personName("SMITH JOHN JR") === "John Smith Jr.", [personName("WARREN KELCY L"), personName("DAVIS WATERS S IV"), personName("SMITH JOHN JR")]);
    const f4 = parseForm4(`<ownershipDocument><issuer><issuerCik>0001276187</issuerCik><issuerName>Energy Transfer LP</issuerName><issuerTradingSymbol>ET</issuerTradingSymbol></issuer><reportingOwner><reportingOwnerId><rptOwnerCik>0001276191</rptOwnerCik><rptOwnerName>WARREN KELCY L</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>true</isDirector><isOfficer>1</isOfficer><officerTitle>Chairman</officerTitle><isTenPercentOwner>false</isTenPercentOwner></reportingOwnerRelationship></reportingOwner><nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>2026-08-18</value></transactionDate><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>100,000</value></transactionShares><transactionPricePerShare><value>18.5</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts><postTransactionAmounts><sharesOwnedFollowingTransaction><value>2500000</value></sharesOwnedFollowingTransaction></postTransactionAmounts></nonDerivativeTransaction></nonDerivativeTable></ownershipDocument>`);
    check("an insider filing gives the person, their roles and the trade", !!f4 && f4.issuerCik === "1276187" && f4.ticker === "ET" && f4.owners[0].cik === "1276191" && f4.owners[0].director && f4.owners[0].officer && f4.owners[0].title === "Chairman" && f4.txns[0].code === "P" && f4.txns[0].shares === 100000 && f4.txns[0].acquired && f4.txns[0].owned === 2500000, f4);
    const head = parseHeader("<SEC-HEADER>\n<TYPE>SC 13G/A\n<FILING-DATE>20240209\n<GROUP-MEMBERS>BLACKSTONE INC.\n<SUBJECT-COMPANY>\n<COMPANY-DATA>\n<CONFORMED-NAME>Energy Transfer LP\n<CIK>0001276187\n<ASSIGNED-SIC>4922\n</COMPANY-DATA>\n<BUSINESS-ADDRESS>\n<STATE>TX\n</BUSINESS-ADDRESS>\n</SUBJECT-COMPANY>\n<FILED-BY>\n<COMPANY-DATA>\n<CONFORMED-NAME>Blackstone Holdings I/II GP L.L.C.\n<CIK>0001464695\n</COMPANY-DATA>\n</FILED-BY>");
    check("a filing header gives the subject, the filer and the date", head.type === "SC 13G/A" && head.filed === "2024-02-09" && head.subject?.cik === "1276187" && head.subject?.sic === "4922" && head.subject?.state === "TX" && head.filers[0].cik === "1464695" && head.members[0] === "BLACKSTONE INC.", head);
    check("the new 13G XML gives the stake", holdingPercent("<classPercent>7.2</classPercent>").percent === 7.2 && !holdingPercent("<classPercent>7.2</classPercent>").exited);
    const old = holdingPercent("<p>11. Percent of Class Represented by Amount in Row (9): 4.7%</p>");
    check("old 13G text gives the stake, and under 5% is an exit", old.percent === 4.7 && old.exited, old);
    check("a filing saying 5% or less is an exit", holdingPercent("<classPercent>0</classPercent><classOwnership5PercentOrLess>Y</classOwnership5PercentOrLess>").exited);
    check("Exhibit 21 is found in the filing index", exhibit21Href(`<table><tr><td scope="row">1</td><td>10-K</td><td><a href="/Archives/edgar/data/1/0001/et-20251231.htm">et</a></td><td>10-K</td><td>1</td></tr><tr><td>2</td><td>SUBSIDIARIES</td><td><a href="/Archives/edgar/data/1/0001/ex211.htm">ex</a></td><td>EX-21.1</td><td>9</td></tr></table>`) === "/Archives/edgar/data/1/0001/ex211.htm");
    const subs = parseExhibit21("<table><tr><td>Entity Name</td><td>State or Other Jurisdiction</td></tr><tr><td>Bayou Bridge Pipeline, LLC</td><td>Delaware</td></tr><tr><td>Arguelles Pipeline, S. De R.L. De C.V.</td><td>Mexico</td></tr><tr><td>Bayou Bridge Pipeline LLC</td><td>Delaware</td></tr></table>");
    check("subsidiaries come with jurisdictions, headers and duplicates dropped", subs.length === 2 && subs[0].name === "Bayou Bridge Pipeline, LLC" && subs[0].jurisdiction === "Delaware" && subs[1].jurisdiction === "Mexico", subs);
    const lines = parseExhibit21("<p>Subsidiaries of the Registrant</p><p>Acme Midstream LLC (Texas)</p><br>Beta Pipeline Co., Delaware<br>");
    check("a list without a table still yields names", lines.some((x) => x.name === "Acme Midstream LLC" && x.jurisdiction === "Texas") && lines.some((x) => /Beta Pipeline/.test(x.name)), lines);
    const rel = relationParagraphs("Our business is gathering and processing natural gas in the Permian Basin for many producers across several counties.\n\nFor the year ended December 31, 2025, Puget Sound Energy, Inc. accounted for 31% of our consolidated revenues, and no other customer represented 10% or more.");
    check("the paragraph naming a major customer is picked", rel.length === 1 && /Puget Sound/.test(rel[0]), rel);

    console.log("networks: findings");
    // 1 and 2 are companies; 10 a director on both boards; 20 an index fund holding everyone.
    const links = [{ id: 1, s: 10, d: 1, kind: "director", w: 1 }, { id: 2, s: 10, d: 2, kind: "director", w: 1 }, ...Array.from({ length: 200 }, (_, i) => ({ id: 100 + i, s: 20, d: 1000 + i, kind: "holder", w: 0.05 })), { id: 3, s: 20, d: 1, kind: "holder", w: 0.07 }, { id: 4, s: 20, d: 2, kind: "holder", w: 0.07 }];
    const paths = reasonPaths(links, 1, 2, { maxHops: 3, k: 3 });
    check("a shared director explains a pair; an index fund holding everyone does not", paths.length === 1 && paths[0].nodes.join() === "1,10,2" && paths[0].links.join() === "1,2", paths);
    check("ownership that loops is found once", ownershipCycles([{ s: 1, d: 2 }, { s: 2, d: 3 }, { s: 3, d: 1 }, { s: 3, d: 4 }]).length === 1 && ownershipCycles([{ s: 1, d: 2 }, { s: 2, d: 3 }]).length === 0);
    const ex = exposureRank([{ s: 1, d: 2, w: 0.31 }, { s: 1, d: 3, w: 0.02 }, { s: 3, d: 4, w: 1 }], 1);
    check("a big customer is more exposed than a small one", (ex.get(2) ?? 0) > (ex.get(3) ?? 0) && (ex.get(4) ?? 0) > 0 && !ex.has(1), [...ex.entries()]);
    const sale = (date: string, shares: number, owned: number) => ({ date, code: "S", shares, price: 20, acquired: false, owned, derivative: false });
    const flags = insiderFlags([
      { name: "A", title: "CEO", txns: [sale("2026-09-01", 300_000, 100_000)] },
      { name: "B", title: "CFO", txns: [sale("2026-09-05", 1000, 50_000)] },
      { name: "C", title: "Director", txns: [sale("2026-09-10", 1000, 50_000), { ...sale("2026-09-10", 500, 0), code: "F" }] },
    ], "2026-09-30");
    check("an insider selling most of their stake is flagged", flags.some((f) => f.kind === "insider_exit" && f.title.startsWith("A sold 75%")), flags);
    check("three insiders selling within a month is flagged", flags.some((f) => f.kind === "insider_cluster" && f.people?.length === 3));
    check("tax withholding and small sales alone raise nothing", insiderFlags([{ name: "D", title: "", txns: [{ ...sale("2026-09-10", 500, 10_000), code: "F" }, sale("2026-09-11", 100, 10_000)] }], "2026-09-30").length === 0);
    const ev = eventFlags([{ date: "2026-05-01", items: ["4.02"], url: "u1" }, { date: "2026-01-01", items: ["5.02"], url: "u2" }, { date: "2026-03-01", items: ["5.02"], url: "u3" }, { date: "2026-06-01", items: ["5.02", "9.01"], url: "u4" }, { date: "2019-01-01", items: ["4.01"], url: "old" }], "2026-09-30");
    check("a restatement warning is a high flag; three departures in a year are turnover; old items are ignored", ev.some((f) => f.kind === "restatement" && f.severity === "high") && ev.some((f) => f.kind === "leadership_turnover") && !ev.some((f) => f.kind === "auditor_change"), ev.map((f) => f.kind));
    check("interlocks are directors on two or more boards", interlocks([{ person: 10, name: "X", company: 1 }, { person: 10, name: "X", company: 2 }, { person: 11, name: "Y", company: 1 }]).length === 1);
    check("links read as sentences", linkSentence("holder", "Energy Transfer LP", "Sunoco LP", { percent: 33.7 }) === "Energy Transfer LP owns 33.7% of Sunoco LP" && linkSentence("supplies", "Williams", "Puget Sound Energy", { share: 31 }) === "Puget Sound Energy is a customer of Williams (31% of revenue)" && linkSentence("acquired", "ONEOK", "EnLink", { asOf: "2024-12-09" }) === "ONEOK acquired EnLink (2024)");

    console.log("networks: the deal model");
    const feat = companyFeatures({ sic: "4922", state: "TX", assets: 1e11, revenue: 8e10, ticker: "ET" }, { subsidiaries: 392, directors: 9, holders: 3, deals: 4 });
    const feat2 = companyFeatures({}, { subsidiaries: 0, directors: 0, holders: 0, deals: 0 });
    check("every company has the same features, industry and state one-hot", feat.length === feat2.length && feat.length === 33 && feat[5 + 6] === 1 && feat[5 + 13 + 0] === 1 && feat2.every((x) => x === 0), feat);
    const dates = Array.from({ length: 50 }, (_, i) => `20${String(10 + Math.floor(i / 4)).padStart(2, "0")}-0${1 + (i % 4)}-15`);
    check("the backtest holds out the last twenty deals when there are forty or more", splitDateFor(dates) === [...dates].sort()[30] && splitDateFor(dates.slice(0, 10)) === [...dates.slice(0, 10)].sort()[8]);
    const pairs = pairsFromHits("1276187", [
      { _id: "0001276187-23-000068:et425.htm", _source: { display_names: ["Crestwood Equity Partners LP  (CIK 0001136352)", "Energy Transfer LP  (ET, ET-PI)  (CIK 0001276187)"], ciks: ["0001136352", "0001276187"], form: "425", file_date: "2023-08-16" } },
      { _id: "0001276187-23-000090:et425b.htm", _source: { display_names: ["Crestwood Equity Partners LP  (CIK 0001136352)", "Energy Transfer LP  (ET, ET-PI)  (CIK 0001276187)"], ciks: ["0001136352", "0001276187"], form: "425", file_date: "2023-11-01" } },
    ]);
    check("merger filings give each counterparty once, from the first filing", pairs.length === 1 && pairs[0].otherCik === "1136352" && pairs[0].otherName === "Crestwood Equity Partners LP" && pairs[0].first === "2023-08-16" && pairs[0].last === "2023-11-01", pairs);
    check("deal vehicles and descriptions are not companies", isDealVehicle("MLP Acquiror") && isDealVehicle("ENLC Acquiror LLC") && isDealVehicle("a subsidiary of EQT Corporation") && isDealVehicle("Rattler Merger Sub, Inc.") && !isDealVehicle("Crestwood Equity Partners LP") && !isDealVehicle("Acquire Energy Inc"));
    check("one corporate family is not a deal counterparty", sameGroup("Energy Transfer LP", "Energy Transfer Partners") && !sameGroup("Energy Transfer LP", "Enable Midstream Partners") && !sameGroup("Targa Resources Corp", "Atlas Energy"));
  }

  {
    console.log("scenarios: statistics");
    const u = rng(42), n = normals(u);
    check("the random source repeats with its seed", rng(7)() === rng(7)() && rng(7)() !== rng(8)());
    const z = Array.from({ length: 20000 }, () => n());
    check("normal draws have mean 0 and deviation 1", Math.abs(smean(z)) < 0.03 && Math.abs(sstd(z) - 1) < 0.03, [smean(z), sstd(z)]);
    check("the normal distribution function and its inverse agree", Math.abs(normCdf(1.6449) - 0.95) < 1e-3 && Math.abs(normInv(0.975) - 1.96) < 1e-3 && Math.abs(normCdf(normInv(0.3)) - 0.3) < 1e-6);
    check("quantiles interpolate", quantile([1, 2, 3, 4], 0.5) === 2.5 && quantile([5], 0.9) === 5);
    const L = cholesky([[1, 0.6], [0.6, 1]]);
    check("a Cholesky factor rebuilds its matrix", Math.abs(L[1][0] * L[0][0] - 0.6) < 1e-9 && Math.abs(L[1][0] ** 2 + L[1][1] ** 2 - 1) < 1e-6);
    const X = Array.from({ length: 500 }, () => [n(), n()]), y = X.map(([a, b]) => 0.5 + 2 * a - b + 0.1 * n());
    const fit = ols(y, X);
    check("least squares recovers coefficients", Math.abs(fit.beta[0] - 0.5) < 0.03 && Math.abs(fit.beta[1] - 2) < 0.03 && Math.abs(fit.beta[2] + 1) < 0.03 && fit.r2 > 0.99, fit.beta);
    check("the KS distance is small for the same distribution and large for a shifted one", ks(z.slice(0, 5000), z.slice(5000, 10000)) < 0.04 && ks(z.slice(0, 5000), z.slice(5000, 10000).map((v) => v + 1)) > 0.3);
    const same = realism(["a"], z.slice(0, 3000).map((v) => [v * 0.01]), z.slice(3000, 6000).map((v) => [v * 0.01]));
    const off = realism(["a"], z.slice(0, 3000).map((v) => [v * 0.01]), z.slice(3000, 6000).map((v) => [v * 0.03]));
    check("realism scores a faithful copy high and a wrong one low, with a warning", same.score >= 85 && off.score < same.score - 20 && off.warnings.some((w) => /volatility/.test(w)), [same.score, off.score, off.warnings]);

    console.log("scenarios: models");
    // A series with volatility clustering: calm and wild spells.
    const series: number[] = []; let vol = 0.01;
    for (let t = 0; t < 1500; t++) { vol = Math.sqrt(0.000002 + 0.1 * (series[t - 1] ?? 0) ** 2 + 0.88 * vol * vol); series.push(vol * n()); }
    const g = fitGarch(series);
    check("GARCH finds the persistence it was made with", g.alpha + g.beta > 0.85 && g.alpha > 0.03 && g.alpha < 0.25, g);
    const H = series.map((v, t) => [v, 0.7 * v + 0.005 * Math.sin(t)]);
    const sim = simulate(garchGen(H).gen, ["A", "B"], [1, 1], 20, 400, 5);
    check("simulated paths give fans that widen with time and a portfolio", sim.fans.length === 3 && sim.fans[2].p95[sim.fans[2].p95.length - 1] - sim.fans[2].p5[sim.fans[2].p5.length - 1] > sim.fans[2].p95[0] - sim.fans[2].p5[0] && sim.finals[2].probLoss > 0.2 && sim.finals[2].probLoss < 0.8, sim.finals[2]);
    check("the same seed gives the same scenario", JSON.stringify(simulate(bootstrapGen(H), ["A", "B"], [1, 1], 10, 50, 9).finals) === JSON.stringify(simulate(bootstrapGen(H), ["A", "B"], [1, 1], 10, 50, 9).finals));
    const calmWild = [...Array.from({ length: 600 }, () => [0.005 * n()]), ...Array.from({ length: 200 }, () => [0.03 * n()]), ...Array.from({ length: 600 }, () => [0.005 * n()])];
    const R = fitRegimes(calmWild);
    check("two regimes are told apart, the stressed one far more volatile", Math.sqrt(R.covs[1][0][0]) > 3 * Math.sqrt(R.covs[0][0][0]) && R.share[1] > 0.08 && R.share[1] < 0.25 && R.label[R.last] === "calm", { share: R.share, vol: R.covs.map((c) => Math.sqrt(c[0][0])) });
    check("volatility clustering survives the bootstrap", autocorr(simulate(bootstrapGen(series.map((v) => [v]), 20), ["A"], [1], 700, 2, 3).sampleDaily.map((r) => Math.abs(r[0])), 1) > 0.05);
    check("excess kurtosis of fat tails is positive", kurtosis(series) > 0.5);

    console.log("scenarios: drivers");
    const sh = parseShock("oil -30%, rates +150bp, KMI down 10%, gas up 20%", ["KMI", "ET"]);
    check("a written shock is read into factor and company moves", sh.shock.factors.oil === -0.3 && sh.shock.factors.rates === 1.5 && sh.shock.factors.gas === 0.2 && sh.shock.tickers.KMI === -0.1 && sh.leftover === "", sh);
    check("words it cannot read are left for the model", parseShock("a supplier outage cuts revenue", ["ET"]).leftover === "a supplier outage cuts revenue");
    check("shocks read back in words", describeShock(sh.shock) === "WTI crude -30%, Henry Hub gas +20%, 10-year Treasury yield +150bp, KMI -10%", describeShock(sh.shock));

    console.log("scenarios: tables and sources");
    const tbl = parseCsv('name,sector,assets,revenue\n"Acme, Inc.",Midstream,"1,200",300\nBeta,Upstream,800,\nGamma,Midstream,1000,260\nDelta,Upstream,900,180\nEpsilon,Midstream,1100,280\nZeta,Upstream,700,150\n');
    check("a CSV is read with quoted commas, thousands separators and blanks", tbl.columns.map((c) => c.type).join() === "text,cat,num,num" && tbl.rows[0][0] === "Acme, Inc." && tbl.rows[0][2] === 1200 && tbl.rows[1][3] === null && tbl.rows.length === 6, tbl);
    const gf = fillGaps(tbl);
    check("a missing number is estimated from similar rows, with a range", gf.filled.length === 1 && gf.filled[0].row === 1 && (gf.filled[0].value as number) > 140 && (gf.filled[0].value as number) < 280 && gf.filled[0].low !== null, gf.filled);
    const rr = rng(3), nn = normals(rr);
    const big: TableIn = { columns: [{ name: "id", type: "text" }, { name: "sector", type: "cat" }, { name: "x", type: "num" }, { name: "y", type: "num" }], rows: Array.from({ length: 300 }, (_, i) => { const x = nn(); const sector = x > 0 ? "A" : "B"; return [`row-${i}`, sector, x, 2 * x + 0.3 * nn()]; }) };
    check("identifying columns are found", identifiers(big).has(0) && !identifiers(big).has(1));
    const cop = copulaSynth(big, 600, 4);
    const cx = cop.rows.map((r) => r[2] as number), cy = cop.rows.map((r) => r[3] as number);
    check("the copula keeps each column's spread and their correlation, and never copies identifiers", Math.abs(sstd(cx) - sstd(big.rows.map((r) => r[2] as number))) < 0.15 && correlation(cx.map((v, i) => [v, cy[i]]))[0][1] > 0.85 && cop.rows.every((r) => String(r[0]).startsWith("Synthetic")) && tableRealism(big, cop).score >= 70, { corr: correlation(cx.map((v, i) => [v, cy[i]]))[0][1], realism: tableRealism(big, cop).score });
    check("categories follow the numbers they went with", cop.rows.filter((r) => (r[2] as number) > 1).every((r) => r[1] === "A"));
    const fr = frenchColumns(" This file...\n\n,Mkt-RF,SMB,HML,RF\n20080915,  -4.84,  0.20, -0.44,  0.01\n20080916,   1.61, -0.30,  0.10,  0.01\n\n Copyright", ["Mkt-RF", "RF"]);
    check("Kenneth French's daily file is read by date", fr.get("2008-09-15")?.[0] === -4.84 && fr.get("2008-09-16")?.[1] === 0.01 && fr.size === 2);
    const eia = eiaDaily("<tr> <td class='B6'>&nbsp;&nbsp;2008 Sep-15 to Sep-19</td> <td class='B3'>95.71</td> <td class='B3'>91.15</td> <td class='B3'></td> <td class='B3'>97.16</td> <td class='B3'>104.55</td> </tr>");
    check("EIA's weekly rows give dated daily prices, skipping holidays", eia.get("2008-09-15") === 95.71 && eia.get("2008-09-16") === 91.15 && !eia.has("2008-09-17") && eia.get("2008-09-19") === 104.55);
  }

  {
    console.log("scenarios: distributions and ranks");
    check("log gamma matches known values", Math.abs(lgamma(5) - Math.log(24)) < 1e-12 && Math.abs(lgamma(0.5) - 0.5 * Math.log(Math.PI)) < 1e-12 && Math.abs(lgamma(0.1) - 2.252712651734206) < 1e-10);
    check("the incomplete beta function matches a known value", Math.abs(ibeta(0.3, 2, 3) - 0.3483) < 1e-4 && ibeta(0, 2, 3) === 0 && ibeta(1, 2, 3) === 1);
    check("Student's t matches its tables", Math.abs(tCdf(2, 5) - 0.9490302605850709) < 1e-9 && Math.abs(tInv(0.975, 10) - 2.228138851986274) < 1e-8 && Math.abs(tInv(0.025, 3) + 3.182446305284263) < 1e-8 && tInv(0.5, 7) === 0);
    const trips = [2.5, 4, 8, 30].flatMap((df) => [1e-6, 0.01, 0.3, 0.7, 0.999].map((p) => Math.abs(tCdf(tInv(p, df), df) - p) / p));
    check("the t quantile inverts the distribution function, deep tails included", Math.max(...trips) < 1e-6, Math.max(...trips));
    check("chi-squared matches its 95% points", Math.abs(chi2Cdf(3.841458820694124, 1) - 0.95) < 1e-9 && Math.abs(chi2Cdf(11.070497693516351, 5) - 0.95) < 1e-9);
    const gu = rng(1), gn = normals(gu);
    const gs = Array.from({ length: 20000 }, () => gammaDraw(gu, gn, 2.5));
    check("Gamma draws have the right mean and variance", Math.abs(smean(gs) - 2.5) < 0.06 && Math.abs(sstd(gs) ** 2 - 2.5) < 0.15, [smean(gs), sstd(gs) ** 2]);
    const ka = Array.from({ length: 800 }, () => gn()), kb = ka.map((x) => 0.7 * x + Math.sqrt(0.51) * gn());
    check("Kendall's tau of a normal pair is 2/π·asin(ρ)", Math.abs(kendall(ka, kb) - (2 / Math.PI) * Math.asin(0.7)) < 0.04, kendall(ka, kb));
    check("pseudo-observations are ranks over n + 1", pseudoObs([3, 1, 2]).join() === "0.75,0.25,0.5");
    const pd = nearPd([[1, 0.9, -0.9], [0.9, 1, 0.9], [-0.9, 0.9, 1]]);
    check("an impossible correlation matrix is shrunk until it has a Cholesky factor", pd.R[0][1] < 0.9 && pd.L.every((row, i) => row[i] > 0));
    const sx = solveSpd([[4, 1], [1, 3]], [1, 2]);
    check("a small positive definite system is solved", Math.abs(sx[0] - 1 / 11) < 1e-8 && Math.abs(sx[1] - 7 / 11) < 1e-8, sx);

    console.log("scenarios: GJR-GARCH-t, the t-copula and filtered historical simulation");
    // A GJR series with Student-t(6) shocks: alpha 0.03, gamma 0.12 (falls raise volatility more), beta 0.88.
    const t6 = () => (gn() / Math.sqrt((2 * gammaDraw(gu, gn, 3)) / 6)) * Math.sqrt(4 / 6);
    const gr: number[] = [];
    let gv = 2e-6 / (1 - 0.03 - 0.06 - 0.88), ge = 0;
    for (let t = 0; t < 3000; t++) { if (t) gv = 2e-6 + (0.03 + (ge < 0 ? 0.12 : 0)) * ge * ge + 0.88 * gv; ge = Math.sqrt(gv) * t6(); gr.push(ge); }
    const gj = fitGjr(gr);
    check("GJR-GARCH-t finds the leverage effect, persistence and fat tails it was made with", gj.gamma > 0.05 && gj.gamma > gj.alpha && Math.abs(gj.persistence - 0.97) < 0.03 && gj.nu > 4 && gj.nu < 12, { a: gj.alpha, g: gj.gamma, p: gj.persistence, nu: gj.nu });
    check("its standardised residuals have about unit variance", Math.abs(sstd(gjrResiduals(gr, gj)) - 1) < 0.1);
    const mvt = (nu: number) => Array.from({ length: 1500 }, () => { const z = [gn(), gn(), gn()], w = nu ? Math.sqrt((2 * gammaDraw(gu, gn, nu / 2)) / nu) : 1; return [z[0], 0.6 * z[0] + 0.8 * z[1], 0.6 * z[0] + 0.3 * z[1] + Math.sqrt(0.55) * z[2]].map((v) => v / w); });
    const c4 = fitTCopula(mvt(4)), cg = fitTCopula(mvt(0));
    check("the t-copula finds few degrees of freedom when assets crash together, many when they do not", c4.nu <= 6 && cg.nu >= 20 && Math.abs(c4.R[0][1] - 0.6) < 0.07 && c4.loglik > c4.gaussian + 30 && c4.tailDependence > 0.15, { t: c4.nu, g: cg.nu, r: c4.R[0][1], ll: [c4.loglik, c4.gaussian] });
    const GH = gr.map((v) => [v, 0.8 * v + 0.004 * gn()]);
    for (const dep of ["t", "fhs"] as const) {
      const m = gjrGen(GH, dep), P = samplePaths(m.gen, 1500, 4, 3), F = P.map(facts), real = facts(GH);
      check(`GJR with ${dep === "t" ? "a t-copula" : "historical shocks"} keeps the volatility, the correlation and the leverage effect`, Math.abs(smean(F.map((f) => f.vol)) / real.vol - 1) < 0.3 && smean(F.map((f) => f.corr)) > 0.7 && smean(F.map((f) => f.lev)) < 0, { vol: [smean(F.map((f) => f.vol)), real.vol], corr: smean(F.map((f) => f.corr)), lev: smean(F.map((f) => f.lev)) });
      check(`the same seed gives the same ${dep} paths`, JSON.stringify(samplePaths(m.gen, 30, 2, 9)) === JSON.stringify(samplePaths(m.gen, 30, 2, 9)));
    }

    console.log("scenarios: weighted summaries");
    const wraw = runPaths(bootstrapGen(GH), ["A", "B"], [1, 1], 20, 2000, 4);
    const eq = summarise(wraw), ew = summarise(wraw, new Float64Array(2000).fill(1 / 2000));
    check("equal weights give the plain summary", Math.abs(eq.finals[2].p50 - ew.finals[2].p50) < 1e-3 && Math.abs(eq.finals[2].cvar95 - ew.finals[2].cvar95) < 1e-3 && Math.abs(eq.drawdown.p95 - ew.drawdown.p95) < 1e-3, [eq.finals[2], ew.finals[2]]);
    const one = new Float64Array(2000); one[7] = 1;
    const fin = wraw.store[wraw.store.length - 1][2][7], so = summarise(wraw, one);
    check("all the weight on one path makes it the outcome", so.finals[2].p5 === fin && so.finals[2].p95 === fin && so.finals[2].mean === fin);
    const wr = weightedRisk(Float64Array.from([-0.3, -0.1, 0, 0.1, 0.2]), Float64Array.from([0.05, 0.05, 0.3, 0.3, 0.3]), 0.08);
    check("weighted value at risk and expected shortfall read the worst share of the probability", Math.abs(wr.var - 0.1) < 1e-12 && Math.abs(wr.es - 0.225) < 1e-12, wr);

    console.log("scenarios: realism v2");
    const fx = facts(gr.map((v) => [v]));
    check("the facts of a GJR series: clustering, fat tails that fade with horizon", fx.acf[0] > 0.05 && fx.kurt[0] > fx.kurt[3] && fx.esvar > 1.1, fx);
    const pair = facts(gr.map((v) => [v, v])), indep = facts(gr.map((v) => [v, gn()]));
    check("joint crashes: always for a copy, about one in twenty for an independent pair", pair.ltd === 1 && indep.ltd < 0.15, [pair.ltd, indep.ltd]);
    const si = stationaryIndex(5000, 10, rng(5));
    let runs = 1;
    for (let t = 1; t < si.length; t++) if (si[t] !== (si[t - 1] + 1) % 5000) runs++;
    check("a stationary bootstrap resamples in runs of about the block length", si.length === 5000 && si.every((t) => t >= 0 && t < 5000) && Math.abs(5000 / runs - 10) < 1.5, 5000 / runs);
    const RH = GH.slice(-750);
    const copied = copyCheck(RH, samplePaths(bootstrapGen(RH, 10), 750, 4, 6)), fresh = copyCheck(RH, samplePaths(gjrGen(RH, "fhs").gen, 750, 4, 6));
    check("the copy check catches a bootstrap replaying history and passes a model", copied.share > 0.3 && fresh.share < 0.15 && copied.ratio < fresh.ratio, { copied, fresh });
    const vbs = stylisedRealism(["A", "B"], RH, samplePaths(bootstrapGen(RH, 10), 750, 6, 7), { seed: 3, resamples: 100 }), vgs = stylisedRealism(["A", "B"], RH, samplePaths(gjrGen(RH, "fhs").gen, 750, 6, 7), { seed: 3, resamples: 100 });
    check("realism v2: every band holds the real value, and the bootstrap loses on copying", [...vbs.checks, ...vgs.checks].every((c) => c.lo <= c.real + 1e-12 && c.real <= c.hi + 1e-12) && !vbs.checks.find((c) => c.key === "copy")!.pass && vgs.checks.find((c) => c.key === "copy")!.pass && vgs.score > vbs.score, { boot: vbs.score, gjr: vgs.score });
    check("realism v2 checks every listed fact", ["vol", "corr", "acf", "lev", "tail", "kurt", "ltd", "esvar", "copy"].every((k) => vgs.checks.some((c) => c.key === k)) && vgs.checks.find((c) => c.key === "acf")!.curve!.x.length === 20);

    console.log("scenarios: narrative views and entropy pooling");
    // Four thousand synthetic factor days with a 2008-like spell (days 2000 to 2119) of falling, volatile markets.
    const fd: FactorRow[] = [];
    for (let day = Date.UTC(2005, 0, 3); fd.length < 4000; day += 86_400_000) {
      const wd = new Date(day).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const crisis = fd.length >= 2000 && fd.length < 2120, s = crisis ? 3 : 1, m = s * 0.01 * gn() + (crisis ? -0.004 : 0.0003);
      fd.push({ date: new Date(day).toISOString().slice(0, 10), market: m, energy: 0.9 * m + s * 0.008 * gn(), oil: 0.6 * m + s * 0.02 * gn() + (crisis ? -0.004 : 0), gas: s * 0.03 * gn(), rates: (crisis ? -0.01 : 0) + 0.05 * gn() + 0.5 * m });
    }
    check("moves convert to the factors' own units and back", Math.abs(fromLog("oil", toLog("oil", -0.3)) + 0.3) < 1e-12 && toLog("rates", 1.5) === 1.5);
    const cv = cleanView({ factor: "market", median: -0.1, low: -0.05, high: -0.3, probability: 5, horizon: 999, analog: null });
    check("a view is put in order and in range", cv.low === -0.3 && cv.median === -0.1 && cv.high === -0.05 && cv.probability === 1 && cv.horizon === 252, cv);
    const sd = stressedDays(fd);
    check("stressed days are history's most volatile fifth, the crisis among them", Math.abs(sd.filter(Boolean).length / sd.length - 0.2) < 0.02 && sd.slice(2020, 2120).filter(Boolean).length > 90);
    const scov = covarianceOf(fd, sd), acov = covarianceOf(fd, fd.map(() => true));
    check("the stressed covariance is the more volatile", scov[0][0] > acov[0][0] && scov[2][2] > acov[2][2]);
    const mild = [cleanView({ factor: "market", median: -0.05, low: -0.1, high: 0, probability: 0.3, horizon: 60, analog: null })];
    const wild = [cleanView({ factor: "market", median: -0.9, low: -0.95, high: -0.8, probability: 0.01, horizon: 5, analog: null })];
    check("plausibility: a small move is ordinary under stress, a 90% fall in a week is not", plausibility(mild, scov).verdict === "plausible" && plausibility(wild, scov).verdict === "extreme" && plausibility(wild, scov).radius > plausibility(mild, scov).radius);
    const crash = [cleanView({ factor: "market", median: -0.2, low: -0.3, high: -0.1, probability: 0.05, horizon: 60, analog: { name: "the spell", from: fd[2000].date, to: fd[2119].date } })];
    const fill = conditionalFill(crash, scov, 60);
    check("factors left out are filled with their conditional means: energy falls with the market", fill.length === 4 && fill.find((f) => f.factor === "energy")!.value < -0.1 && fill.every((f) => f.low <= f.value && f.value <= f.high) && conditionalFill([{ ...crash[0], median: 0 }], scov, 60).every((f) => Math.abs(f.value) < 1e-9), fill);
    const an = retrieveAnalogs(fd, crash);
    check("the closest episodes include the crisis spell, one per stretch of history", an.length === 3 && an.some((e) => e.from >= fd[1940].date && e.from <= fd[2100].date) && an.every((e, i) => an.every((o, j) => i === j || Math.abs(fd.findIndex((r) => r.date === e.from) - fd.findIndex((r) => r.date === o.from)) >= 60)), an.map((e) => [e.from, e.severity]));
    const ne = namedEpisode(fd, crash, crash[0].analog);
    check("a named episode is read from history at its worst stretch", !!ne && ne.from >= fd[2000].date && ne.moves.market < -0.25 && ne.severity > 1, ne);
    const anc = anchorViews(crash, ne), kept = anchorViews([{ ...crash[0], median: -0.6, low: -0.7 }], ne);
    check("severity is anchored halfway to a more severe episode, never softened", anc.changed.join() === "market" && Math.abs(anc.views[0].median - (-0.2 + 0.5 * (ne!.moves.market + 0.2))) < 1e-12 && anc.views[0].low <= ne!.moves.market && kept.changed.length === 0 && kept.views[0].median === -0.6);
    check("path seeds repeat and differ", pathSeed(7, 3) === pathSeed(7, 3) && pathSeed(7, 3) !== pathSeed(7, 4) && pathSeed(7, 3) !== pathSeed(8, 3));
    check("systematic resampling draws in proportion", Array.from(resample(Float64Array.from([0.5, 0.25, 0.25]), 4)).join() === "0,0,1,2");
    const ux = Float64Array.from({ length: 20000 }, () => gn()), up = new Float64Array(20000).fill(1 / 20000);
    const em = entropyPool(up, [ux], [1]);
    let emm = 0;
    for (let i = 0; i < ux.length; i++) emm += em.q[i] * ux[i];
    check("entropy pooling meets a mean view with the least information (a normal shifts, keeping e^-1/2 of its scenarios)", em.ok && Math.abs(emm - 1) < 1e-6 && Math.abs(effectiveScenarios(em.q) / 20000 - Math.exp(-0.5)) < 0.03, [emm, effectiveScenarios(em.q)]);
    const eqv = entropyPool(up, [Float64Array.from(ux, (v) => (v <= 0 ? 1 : 0)), Float64Array.from(ux, (v) => (v <= 1 ? 1 : 0))], [0.1, 0.5]);
    let b0 = 0, b1 = 0;
    for (let i = 0; i < ux.length; i++) { if (ux[i] <= 0) b0 += eqv.q[i]; if (ux[i] <= 1) b1 += eqv.q[i]; }
    check("percentile views are met exactly, and an impossible view is refused", eqv.ok && Math.abs(b0 - 0.1) < 1e-6 && Math.abs(b1 - 0.5) < 1e-6 && !entropyPool(up, [ux], [9]).ok);
    check("effective scenarios: n for equal weights, 1 for one path", Math.abs(effectiveScenarios(new Float64Array(50).fill(0.02)) - 50) < 1e-9 && effectiveScenarios(Float64Array.from([1, 0, 0])) === 1);
    const pr0 = viewPrior(fd, sd, crash, 60, [10, 10], 0), pr5 = viewPrior(fd, sd, crash, 60, [10, 10], 0.5);
    const s0 = factorScenarios(pr0, 6000, [60], 11), s5 = factorScenarios(pr5, 6000, [60], 11);
    const plain = smean(Array.from(s0.moves[0].get(60)!)), w5 = Float64Array.from(s5.logRatio, pr5.weight), w5t = w5.reduce((a, b) => a + b, 0);
    let lean = 0, weighted = 0;
    for (let i = 0; i < 6000; i++) { lean += s5.moves[0].get(60)![i] / 6000; weighted += (w5[i] / w5t) * s5.moves[0].get(60)![i]; }
    check("leaning paths move the views' way, and their likelihood ratios weigh them back to history's odds", lean < plain - 0.03 && Math.abs(weighted - plain) < 0.02, { plain, lean, weighted });
    check("factor paths repeat with their seed", s5.moves[0].get(60)![123] === factorScenarios(pr5, 200, [60], 11).moves[0].get(60)![123]);
    const vc = viewConstraints(crash, fill, 60, (f, h) => s5.moves[["market", "energy", "oil", "gas", "rates"].indexOf(f)].get(h)!);
    const pooled = entropyPool(new Float64Array(6000).fill(1 / 6000), vc.A, vc.b);
    check("a crisis view is carried by the leaning paths with plenty of scenarios left", vc.A.length === 3 + fill.length && vc.b.slice(0, 3).join() === "0.1,0.5,0.9" && pooled.ok && effectiveScenarios(pooled.q) > 300, effectiveScenarios(pooled.q));
    check("views read back in words", describeViews(crash) === "U.S. stock market -20% (-30% to -10%) over 60 days" && describeViews([cleanView({ factor: "rates", median: 1.5, low: 1, high: 2, probability: 0.1, horizon: 120, analog: null })]) === "10-year Treasury yield +150bp (+100bp to +200bp) over 120 days");

    console.log("scenarios: sequential trees and privacy");
    const tu = rng(2), tn = normals(tu);
    const mixed: TableIn = { columns: [{ name: "id", type: "text" }, { name: "sector", type: "cat" }, { name: "size", type: "num" }, { name: "margin", type: "num" }, { name: "rating", type: "cat" }, { name: "employees", type: "num" }],
      rows: Array.from({ length: 1500 }, (_, i) => { const sector = ["Midstream", "Upstream", "Refining"][Math.floor(tu() * 3)], size = Math.exp(5 + tn()), margin = (sector === "Midstream" ? 0.3 : sector === "Upstream" ? 0.15 : 0.06) + 0.04 * tn(); return [`co-${i}`, sector, Math.round(size * 10) / 10, margin, tu() < 0.03 ? null : margin > 0.25 ? "A" : margin > 0.12 ? "B" : "C", Math.round(size * 20)]; }) };
    const { train, holdout } = splitHoldout(mixed, 0.2, 5);
    check("a holdout split is a fifth, disjoint and repeatable", train.rows.length === 1200 && holdout.rows.length === 300 && new Set([...train.rows, ...holdout.rows].map((r) => r[0])).size === 1500 && splitHoldout(mixed, 0.2, 5).holdout.rows[0][0] === holdout.rows[0][0]);
    const ct = cartSynth(train, 1000, 5);
    const bySector = (rows: Cell[][], s: string) => smean(rows.filter((r) => r[1] === s).map((r) => r[3] as number));
    const rated = ct.rows.filter((r) => r[4] !== null && typeof r[3] === "number"), consistent = rated.filter((r) => ((r[3] as number) > 0.27 ? r[4] === "A" : (r[3] as number) < 0.1 ? r[4] === "C" : true)).length / rated.length;
    check("sequential trees keep each sector's margins and the rating rules, and replace identifiers", ["Midstream", "Upstream", "Refining"].every((s) => Math.abs(bySector(ct.rows, s) - bySector(train.rows, s)) < 0.02) && consistent > 0.95 && ct.rows.every((r) => String(r[0]).startsWith("Synthetic")) && ct.rows.every((r) => r[5] === null || Number.isInteger(r[5])), consistent);
    check("the same seed gives the same synthetic table", JSON.stringify(cartSynth(train, 50, 5).rows) === JSON.stringify(cartSynth(train, 50, 5).rows));
    const pvc = privacyChecks(train, holdout, ct, 5), leak = privacyChecks(train, holdout, { ...train, rows: train.rows.slice(0, 600) }, 5);
    check("privacy: trees sit as near the holdout as the training rows; a copy of the training rows is caught", pvc.dcrShare > 0.4 && pvc.dcrShare < 0.62 && pvc.mia < 0.6 && pvc.exact.synthetic < 0.01 && pvc.warnings.length === 0 && leak.exact.synthetic === 1 && leak.mia > 0.7 && leak.warnings.length >= 3, { pvc, leak: { dcr: leak.dcrShare, mia: leak.mia, n: leak.warnings.length } });
  }

  {
    console.log("alerts and stories");
    check("a large, confident ground change alerts now; a small one waits for the digest", isBig({ kind: "ground_change", confidence: 0.75, magnitude: 3.1, visual: {} }) && !isBig({ kind: "ground_change", confidence: 0.75, magnitude: 0.8, visual: {} }) && !isBig({ kind: "ground_change", confidence: 0.4, magnitude: 5, visual: {} }));
    check("a high red flag alerts now; a medium one waits", isBig({ kind: "graph_flag", confidence: 0.9, magnitude: 0.9, visual: { flag: { severity: "high" } } }) && !isBig({ kind: "graph_flag", confidence: 0.9, magnitude: 0.5, visual: { flag: { severity: "medium" } } }));
    const sections = composeSections([
      { title: "Memo", markdown: "text", sources: [] },
      { question: "Q?", mode: "strict", text: "A", claims: [], citations: [], notFound: false },
      { items: [{ ticker: "ET", name: "Energy Transfer" }] },
      { title: "S", driver: "replay", synthetic: true, recipe: "r", seed: 1, horizon: 5, paths: 10, stats: [] },
      { items: [{ id: 1, title: "Pad", kind: "ground_change", confidence: 0.8, tickers: ["ET"], observedAt: null, summary: "s", sources: [] }] },
    ]);
    check("a story runs from the ground to the memo and leaves out bare lists", sections.map((x) => x.kind).join() === "findings,scenario,answer,memo" && sections[0].title === "What changed on the ground" && sections[3].title === "Memo", sections.map((x) => x.kind));
    const all = new Set(["source.companies", "earth.watch", "earth.proforma", "out.memo", "net.graph", "docs.ask", "scen.simulate", "source.documents", "docs.changes", "out.export"]);
    check("a banker's first canvas is the buyer finder once the model has trained, the asset watch before", starterTemplate("banker", true, all) === "buyer-finder" && starterTemplate("banker", false, all) === "asset-watch" && starterTemplate("student", true, all) === "asset-watch");
    check("a first canvas whose blocks are not ready falls back to the asset watch", starterTemplate("markets", true, new Set(["source.companies", "earth.watch", "earth.proforma", "out.memo"])) === "asset-watch");
    check("section titles read naturally", sectionTitle("ranking", { finding: "Likely acquirers", subject: "Targa", items: [] }) === "Likely acquirers for Targa");
    const mail = digestEmail([
      { id: 1, kind: "ground_change", title: "New pad <west>", summary: "Cleared ground", confidence: 0.7, visual: { before: { url: "https://x/b.png", date: "2026-08-01" }, after: { url: "https://x/a.png", date: "2026-09-01" } } },
      { id: 2, kind: "filing_change", title: "10-Q rewrote risks", summary: "Two new risks", confidence: 0.9, visual: { counts: { added: 2, removed: 1, changed: 3, unchanged: 20 } } },
    ], "https://app.example", "Wednesday, September 30");
    check("the digest shows before and after pictures and a filing's edits, escaped, with one link home", mail.subject === "Edge: 2 findings at what you watch" && mail.html.includes('src="https://x/b.png"') && mail.html.includes("2 new · 3 reworded · 1 dropped") && mail.html.includes("New pad &lt;west&gt;") && !mail.html.includes("<west>") && mail.text.includes("https://app.example/app/edge?view=feed"));
    const at = new Date("2026-09-30T11:35:00Z"); // 7:35 in New York, 12:35 in London
    check("a digest goes out at the hour of the person's brief, in their time zone", digestDue({ enabled: true, time: "07:00", timezone: "America/New_York" }, at) && !digestDue({ enabled: true, time: "07:00", timezone: "Europe/London" }, at) && digestDue({ enabled: true, time: "12:30", timezone: "Europe/London" }, at));
    check("without a brief it goes at 8 in New York", digestDue(undefined, new Date("2026-09-30T12:35:00Z")) && !digestDue(undefined, at));
  }

  {
    console.log("edge across the app");
    const cmd = (s: string, edge: boolean) => { const r = parseCommand(s, "ET", edge); return r.ok ? `${r.command.ticker}|${r.command.fn}|${r.command.arg ?? ""}` : `error:${r.error}`; };
    check("without the beta GEO and NET stay tickers", cmd("NET", false) === "NET|DES|" && cmd("GEO", false) === "GEO|DES|" && cmd("EDGE", false) === "EDGE|DES|");
    check("with the beta they are Edge's functions on the active ticker, and a function after them still makes them tickers", cmd("NET", true) === "ET|NET|" && cmd("NET DES", true) === "NET|DES|" && cmd("KMI EDGE", true) === "KMI|EDGE|");
    check("ASK and SIM take words", cmd("KMI ASK what drove volumes?", true) === "KMI|ASK|what drove volumes?" && cmd("SIM oil -30%", true) === "ET|SIM|oil -30%" && cmd("ET SIM", true) === "ET|SIM|");
    const sr = (a?: string) => simRequest("ET", a) as { driver: string; replay?: string; shockText?: string };
    check("SIM runs the base case, a replay or a written shock", sr().driver === "none" && sr("2008").replay === "2008" && sr("oil 2014").replay === "oil2014" && sr("oil -30%").driver === "shock" && sr("oil -30%").shockText === "oil -30%");
    const model: StudioDocData = { title: "Model", workbook: { order: ["s1"], sheets: { s1: { id: "s1", name: "Edge Ranking", cells: { A1: { v: 1 } } } } }, deck: { order: [], slides: {}, theme: { primary: "#000000", accent: "#111111", font: "Arial" } }, comments: [] };
    const before = JSON.stringify(model);
    const ranking = { finding: "Likely acquirers", subject: "Targa", items: [{ name: "=HYPERLINK(1)", ticker: "ET", score: 0.61, reasons: ["shares a director"] }, { name: "Kinder Morgan", ticker: "KMI", score: 0.4, reasons: [] }] };
    const scen = { title: "Oil -30%", driver: "shock", synthetic: true as const, recipe: "GARCH", seed: 7, horizon: 60, paths: 1000, stats: [{ label: "Median outcome", value: "-4.0%" }], fan: [{ label: "Portfolio", p5: [0, -0.1], p50: [0, -0.02], p95: [0, 0.05] }] };
    const pp = pushPatches(model, [{ kind: "ranking", label: "Ranking", value: ranking }, { kind: "scenario", label: "Oil -30%", value: scen }], "From YouBank Edge.");
    const sheets = pp.flatMap((p) => (p.op === "sheet_add" ? [p.sheet.name] : []));
    const cells = pp.flatMap((p) => (p.op === "cells" ? Object.values(p.cells) : []));
    check("a push adds new sheets and slides only, named apart from existing ones, and leaves the model as it was", sheets.join("|") === "Edge Ranking 2|Edge Oil -30%" && pp.filter((p) => p.op === "slide_upsert").length === 2 && pp.every((p) => p.op !== "cells" || !p.sheet.startsWith("s1")) && JSON.stringify(model) === before, sheets);
    check("pushed text never becomes a formula, and synthetic sheets say so first", cells.some((c) => c?.v === " =HYPERLINK(1)") && !cells.some((c) => c?.f) && cells.some((c) => typeof c?.v === "string" && c.v.startsWith("SYNTHETIC DATA: GARCH, seed 7")));
    const net = new Map([["energy transfer", [{ contactId: 1, name: "Ann Lee", company: "Energy Transfer" }]], ["targa resources", [{ contactId: 2, name: "Bo Diaz", company: "Targa Resources Corp." }]]]);
    check("findings reach contacts at the companies named, matched the way the Newsroom matches, once each", peopleAt(net, ["Energy Transfer LP", "Targa Resources Corp", "Energy Transfer", "XY"]).map((p) => p.contactId).join() === "1,2");
    check("SEC registrant names are cleaned before matching", plainRegistrant("ONEOK INC /NEW/") === "ONEOK INC" && plainRegistrant("ENTERPRISE PRODUCTS PARTNERS L.P.") === "ENTERPRISE PRODUCTS PARTNERS LP" && peopleAt(new Map([["enterprise products partners", [{ contactId: 9, name: "Cy", company: "Enterprise Products Partners" }]]]), [plainRegistrant("ENTERPRISE PRODUCTS PARTNERS L.P.")]).length === 1);
    const intro = { contact: { name: "Ann Lee", email: "ann@x.com", company: "Acme", title: "", via: "your contact" }, steps: [{ text: "You know Ann Lee", url: "", asOf: null }, { text: "Ann Lee is a director of Targa", url: "", asOf: null }], hops: 1, strength: 1 };
    check("an intro request asks the contact, or the teammate who knows them, and gives the path", introBrief(intro, "Targa", null).startsWith("Ask Ann whether") && introBrief(intro, "Targa", null).includes("Ann Lee is a director of Targa") && introBrief(intro, "Targa", "Sam").startsWith("Ask Sam, a teammate, to introduce me to Ann Lee (Acme)"));
    check("a Studio target is an id or a Studio link", studioTarget("12") === 12 && studioTarget("https://youbank.app/app/studio/45") === 45 && studioTarget("") === null && studioTarget("new") === null);
    check("a deal's what-if link round-trips and keeps to known places", whatIfFrom("ET, TRGP", "mars")?.parties.join() === "ET,TRGP" && whatIfFrom("ET, TRGP", "mars")?.place === "permian" && whatIfFrom("ET", "permian") === null && whatIfUrl(["ET", "Targa Resources"], "delaware") === "/app/edge?view=whatif&parties=ET%2CTarga%20Resources&place=delaware");
  }

  {
    console.log("terrain and 3D");
    const npy = (shape: number[], values: number[]) => {
      let header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${shape.join(", ")}), }`;
      header += " ".repeat((64 - ((10 + header.length + 1) % 64)) % 64) + "\n";
      const buf = new Uint8Array(10 + header.length + values.length * 4);
      buf.set([0x93, ...Buffer.from("NUMPY"), 1, 0], 0);
      const dv = new DataView(buf.buffer);
      dv.setUint16(8, header.length, true);
      buf.set(Buffer.from(header), 10);
      values.forEach((v, i) => dv.setFloat32(10 + header.length + i * 4, v, true));
      return buf;
    };
    const arr = parseNpy(npy([2, 1, 3], [871.5, 872, 873.25, 255, 0, 255]));
    check("the elevation API's NumPy arrays are read with their shape and mask band", arr.shape.join() === "2,1,3" && arr.data[2] === 873.25 && arr.data[4] === 0);
    const c = cellSize([0, 0, 0.01, 0.01], 10, 10);
    check("cells are measured in metres at the box's latitude", Math.abs(c.x - 111.32) < 0.1 && Math.abs(c.y - 110.574) < 0.1);
    const W = 8, tilt = Math.tan((10 * Math.PI) / 180);
    const plane = { width: W, height: W, cell: { x: 10, y: 10 }, valid: new Uint8Array(W * W).fill(1), z: Float32Array.from({ length: W * W }, (_, i) => (i % W) * 10 * tilt) };
    const sl = slopeDegrees(plane);
    check("slope on a plane tilted 10° reads 10° inside and nothing at the edge", Math.abs(sl[3 * W + 3] - 10) < 0.01 && Number.isNaN(sl[0]));
    const lv = levelling([0, 2, 4, 6], 2);
    check("levelling balances cut and fill at the mean ground level", lv.level === 3 && lv.cut === 8 && lv.fill === 8);
    const m5 = new Uint8Array(25); m5[0] = 1; m5[6] = 1; m5[12] = 1; m5[24] = 1; m5[4] = 2;
    check("change outlines group by touching cells (corners count), largest first", components(m5, 5, 5, 1, 1).map((b) => b.length).join() === "3,1" && components(m5, 5, 5, 1, 2).length === 1);
    const back = maskFromOverlay(`data:image/png;base64,${overlayPng({ width: 4, height: 1, mask: Uint8Array.from([0, 1, 2, 1]) } as unknown as ChangeResult).toString("base64")}`);
    check("a ground change's overlay reads back as its mask", Array.from(back.mask).join() === "0,1,2,1" && back.width === 4);
    const pts = densify([[[0, 0], [0.01, 0]]], 100);
    check("a line is sampled every 100 m to its end", pts.length === 13 && Math.abs(pts[1].km - 0.1) < 1e-9 && Math.abs(pts[pts.length - 1].km - 1.11195) < 0.001, pts.map((p) => p.km));
    const ps = profileStats([0, 1, 2, 3, 4], [100, 110, 105, 105.5, 104.6], 1);
    check("a profile's climb and descent ignore wiggles under the noise", ps.climb === 10 && ps.descent === 5 && ps.steepest.gradePct === 1, ps);
    const g4 = { bbox: [0, 0, 2, 2] as [number, number, number, number], width: 2, height: 2, z: Float32Array.from([0, 10, 20, 30]), valid: new Uint8Array(4).fill(1) };
    check("elevation between cells is interpolated", sampleGrid(g4, 1, 1) === 15 && sampleGrid(g4, 5, 5) === null);
    check("quantiles and ranks on sorted values", quantileSorted([1, 2, 3, 4, 5], 0.5) === 3 && rankBelow([1, 2, 3, 4], 3) === 0.5);
    const G = 48;
    const grid: Grid = {
      bbox: [-103.9, 31.8, -103.89, 31.81], width: G, height: G, cell: { x: 10, y: 10 }, valid: new Uint8Array(G * G).fill(1), z: Float32Array.from({ length: G * G }, (_, i) => (i % G) * 10 * tilt), coverage: 1,
      source: { key: "lidar", name: "USGS 3DEP lidar", resolutionM: 2, vintage: "flown 2018 (TX_Test_2018)", accuracy: "about ±0.2 m", license: "Public domain", url: "", items: ["x"] },
    };
    const mask24 = new Uint8Array(24 * 24);
    for (let y = 8; y < 13; y++) for (let x = 8; x < 13; x++) mask24[y * 24 + x] = 1;
    const site = readSite(grid, { mask: mask24, width: 24, height: 24 }, { lon: -103.895, lat: 31.805 }, { changedAfter: "2025-03-01", image: false });
    const pad = site.pads[0];
    check("a site's new pad on a slope: its ground, slope, cut equal to fill, and where it sits", site.pads.length === 1 && pad.kind === "cleared" && pad.cutM3 === pad.fillM3 && (pad.cutM3 ?? 0) > 0 && Math.abs(pad.slopeDeg - 10) < 0.5 && pad.position > 0.3 && pad.position < 0.7 && site.earthwork?.hectares === pad.hectares, pad);
    check("a survey older than the change raises no warning; a newer one does", !site.notes.some((n) => n.includes("may be after")) && readSite(grid, null, null, { changedAfter: "2017-01-01", image: false }).notes.some((n) => n.includes("may be after")));
    const hx = hexagon(-103.9, 31.8, 1000);
    const dx = (hx[0][0] + 103.9) * 111_320 * Math.cos((31.8 * Math.PI) / 180), dy = (hx[0][1] - 31.8) * 110_574;
    check("a plant's column is a closed hexagon of the right radius", hx.length === 7 && hx[0] === hx[6] && Math.abs(Math.hypot(dx, dy) - 1000) < 1);
    check("where a site sits is said in words", positionWords(0.1).startsWith("low-lying") && positionWords(0.9).startsWith("on high ground") && positionWords(0.5).startsWith("mid-slope"));
  }

  {
    console.log("3D sites, months and the brief");
    const hull = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]]);
    const ps = polygonStats(hull);
    check("a hull keeps only the outside corners, with area and perimeter", hull.length === 4 && ps.area === 4 && ps.perimeter === 8);
    // A 40 x 40 grid at 2 m: a 12 m disc 9 m tall (a tank), a 20 x 6 m block 4 m tall, and a green clump.
    const W = 40, z = new Float32Array(W * W), valid = new Uint8Array(W * W).fill(1), green = new Float32Array(W * W);
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (Math.hypot(x - 10 + 0.5, y - 10 + 0.5) <= 3) z[i] = 9;
      if (x >= 25 && x < 35 && y >= 25 && y < 28) z[i] = 4;
      if (Math.hypot(x - 30 + 0.5, y - 8 + 0.5) <= 2.5) { z[i] = 5; green[i] = 0.4; }
    }
    const st = findStructures({ z, valid, width: W, height: W }, { x: 2, y: 2 }, { z: green, valid, width: W, height: W });
    const tank = st.found.find((x) => x.kind === "tank");
    check("lidar heights give a tank (round, flat, tall enough), a block that is not one, and a tree left out", st.found.length === 2 && !!tank && Math.abs((tank.diameterM ?? 0) - 12) < 3 && tank.heightM === 9 && st.found.some((x) => x.kind === "structure") && st.trees === 1, st);
    const m = monthly([
      { id: "a", date: "2026-01-03", cloud: 10, covers: true }, { id: "b", date: "2026-01-20", cloud: 2, covers: true }, { id: "c", date: "2026-01-25", cloud: 0, covers: false },
      { id: "d", date: "2026-02-11", cloud: 5, covers: true },
    ]);
    check("one scene a month: the clearest that covers the whole site", m.map((x) => x.id).join() === "b,d");
    const now = Date.parse("2026-09-30T00:00:00Z");
    const mk = (id: number, d: string) => ({ id, observedAt: d, detectedAt: d }) as unknown as EdgeCardT;
    check("the brief reads only the last fortnight's findings", briefCards([mk(1, "2026-09-25"), mk(2, "2026-09-01"), mk(3, "2026-09-29")], now).map((c) => c.id).join() === "1,3");
  }

  {
    console.log("Networks: counts, keyboard list, upgrades");
    const c = linkCounts([
      { kind: "director", dir: "in", live: 9, n: 11 }, { kind: "officer", dir: "in", live: 6, n: 6 },
      { kind: "holder", dir: "in", live: 1, n: 2 }, { kind: "holder", dir: "out", live: 3, n: 3 },
      { kind: "subsidiary", dir: "out", live: 392, n: 400 }, { kind: "supplies", dir: "out", live: 2, n: 2 }, { kind: "supplies", dir: "in", live: 1, n: 1 },
      { kind: "acquired", dir: "out", live: 2, n: 3 }, { kind: "acquired", dir: "in", live: 0, n: 1 }, { kind: "bought_assets", dir: "out", live: 1, n: 1 },
    ]);
    check("link counts: current links by kind and direction", c.directors === 9 && c.officers === 6 && c.holders === 1 && c.stakes === 3 && c.subsidiaries === 392 && c.customers === 2 && c.suppliers === 1, c);
    check("link counts: every deal, current or ended, either way round", c.deals === 5, c);
    check("link counts: kinds it has none of count zero", Object.values(linkCounts([])).every((v) => v === 0), linkCounts([]));
    check("link counts: neon's numeric strings still add up", linkCounts([{ kind: "acquired", dir: "out", live: "2" as unknown as number, n: "2" as unknown as number }]).deals === 2);
    const node = (id: number, name: string) => ({ id, kind: "company", name, ticker: "" });
    const rows = entityList([node(1, "Zeta"), node(2, "Alpha"), node(3, "Focus Co"), node(4, "Beta"), node(5, "Alone")], [{ s: 3, d: 1 }, { s: 3, d: 2 }, { s: 1, d: 4 }, { s: 2, d: 4 }, { s: 1, d: 2 }], 3);
    check("keyboard list: the company in focus comes first even when others have more links", rows[0].n.id === 3, rows.map((r) => r.n.name));
    check("keyboard list: then by links touching each, ties by name", rows.map((r) => `${r.n.name}:${r.c}`).join(",") === "Focus Co:2,Alpha:3,Zeta:3,Beta:2,Alone:0", rows.map((r) => `${r.n.name}:${r.c}`));
    const saved = { v: process.env.VOYAGE_API_KEY, m: process.env.EDGE_ANSWER_MODEL, o: process.env.OPENAI_API_KEY };
    delete process.env.VOYAGE_API_KEY; delete process.env.EDGE_ANSWER_MODEL; process.env.OPENAI_API_KEY = "x";
    const offAll = UPGRADES.every((u) => !upgradeOn(u.id) || u.id === "modal-budget" || u.id === "docs-storage");
    process.env.VOYAGE_API_KEY = "k"; process.env.EDGE_ANSWER_MODEL = "gpt-5.6-sol";
    const report = upgradesReport();
    check("upgrades stay off until their key is set, then a built one turns on (a switch with any value too)", offAll && upgradeOn("rerank-voyage") && upgradeOn("answer-model") && !upgradeOn("transcribe-openai") && report.find((r) => r.id === "rerank-voyage")!.needs[0].set && !JSON.stringify(report).includes("\"k\""));
    for (const [k, v] of [["VOYAGE_API_KEY", saved.v], ["EDGE_ANSWER_MODEL", saved.m], ["OPENAI_API_KEY", saved.o]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }

  {
    console.log("Documents: polling");
    check("poll backoff: 5 s, 10 s, 20 s, 40 s, then a minute", [0, 1, 2, 3, 4, 9].map((f) => pollDelay(5000, f)).join() === "5000,10000,20000,40000,60000,60000");
    check("a slow interval is never shortened by the cap", pollDelay(120_000, 0) === 120_000 && pollDelay(120_000, 3) === 120_000);
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as string });
    (globalThis as { document?: unknown }).document = doc;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let n = 0;
    const stop = poll(async () => ++n, () => true, { ms: 20 });
    await sleep(5);
    doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
    const before = n; await sleep(100);
    check("no checks while the tab is hidden", n === before, { before, n });
    doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); await sleep(2);
    check("one check as soon as it is shown again", n === before + 1, { before, n });
    stop();
    let errs = 0; const at: number[] = []; const t0 = Date.now();
    const stop2 = poll(async () => { at.push(Date.now() - t0); if (at.length <= 3) throw new Error("down"); return 1; }, () => false, { ms: 20, onError: () => errs++ });
    await sleep(400); stop2();
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    check("failures back off and are retried rather than ending the polling", at.length === 4 && errs === 3 && gaps[0] >= 18 && gaps[1] >= 38 && gaps[2] >= 78, { at, errs });
    delete (globalThis as { document?: unknown }).document;
  }

  {
    console.log("Canvas page");
    const step = (nodeId: string, status: string, extra: Partial<StepView> = {}): StepView => ({ nodeId, type: "out.memo", status, step: "", summary: "", error: "", preview: null, output: null, downloads: [], startedAt: null, finishedAt: null, ...extra });
    const runOf = (status: string, steps: StepView[], id = 7): RunView => ({ id, canvasId: 1, status, trigger: "manual", createdAt: "2026-09-30T00:00:00Z", startedAt: null, finishedAt: null, cost: {}, error: "", graph: { nodes: [], edges: [] }, steps });
    const fullRun = runOf("running", [step("a", "done", { output: { memo: 1 }, downloads: [{ name: "f.csv", url: "https://x/1" }], preview: { kind: "text", text: "hi" } }), step("b", "running")]);
    const liteRun = () => runOf("running", [step("a", "done", { preview: { kind: "text", text: "hi" } }), step("b", "running", { step: "draft" })]);
    const merged = mergeRun(fullRun, liteRun());
    check("a light run view keeps the outputs and links a full view brought for done blocks", merged.steps[0].output === fullRun.steps[0].output && merged.steps[0].downloads === fullRun.steps[0].downloads);
    check("an unchanged block keeps its old object; a changed one gets the new view", merged.steps[0] === fullRun.steps[0] && merged.steps[1].step === "draft");
    check("a poll that changes nothing gives back the same run", mergeRun(merged, liteRun()) === merged);
    check("another run, or none before, is taken as it comes", mergeRun(fullRun, runOf("running", [], 8)).id === 8 && mergeRun(null, fullRun) === fullRun);
    const doneRun = runOf("done", [step("a", "done", { output: { memo: 2 } }), step("b", "done", { output: {} })]);
    const end = mergeRun(merged, doneRun);
    check("the full view at the end replaces the kept outputs", end.steps[0].output === doneRun.steps[0].output && end.steps[1].output === doneRun.steps[1].output && end.status === "done");
    check("a run is going while queued or running", going("queued") && going("running") && !going("done") && !going("failed"));
    const s0: ReadonlySet<string> = new Set(["a"]);
    check("select changes add and drop picked ids", [...applySelect(s0, [{ id: "a", selected: false }, { id: "b", selected: true }])].join() === "b");
    check("select changes that change nothing keep the same set", applySelect(s0, [{ id: "a", selected: true }, { id: "c", selected: false }]) === s0);
    const fn = () => undefined;
    check("block data equal field by field (lists by their items) count as the same", sameData({ a: 1, issues: ["x"], f: fn }, { a: 1, issues: ["x"], f: fn }));
    check("block data differ when a field, a list item or a key changes", !sameData({ a: 1, issues: ["x"] }, { a: 1, issues: ["y"] }) && !sameData({ a: 1 }, { a: 2 }) && !sameData({ a: undefined }, { b: 1 }));
  }

  // Networks: ownership rings of any length (Tarjan), each once.
  {
    console.log("Networks: rings, ultimate owners, section 8, fair baselines");
    check("rings: strongly connected components of two or more, self-loops ignored", JSON.stringify(stronglyConnected([{ s: 1, d: 2 }, { s: 2, d: 3 }, { s: 3, d: 1 }, { s: 3, d: 4 }, { s: 4, d: 5 }, { s: 5, d: 4 }, { s: 6, d: 6 }])) === "[[1,2,3],[4,5]]", stronglyConnected([{ s: 1, d: 2 }, { s: 2, d: 3 }, { s: 3, d: 1 }, { s: 3, d: 4 }, { s: 4, d: 5 }, { s: 5, d: 4 }]));
    const long = Array.from({ length: 20_000 }, (_, i) => ({ s: i, d: (i + 1) % 20_000 }));
    check("rings: a loop of 20,000 owners is one ring (no recursion to overflow)", stronglyConnected(long).length === 1 && stronglyConnected(long)[0].length === 20_000);
    const six = [1, 2, 3, 4, 5, 6].map((n) => ({ s: n, d: (n % 6) + 1, kind: "holder" }));
    check("rings: a six-step loop the old four-step search missed is found, once", ownershipCycles(six, 4).length === 0 && ownershipRings(six).length === 1 && ownershipRings(six)[0].links.length === 6);
    const rs = ownershipRings([{ s: 1, d: 2 }, { s: 2, d: 3 }, { s: 3, d: 1 }, { s: 3, d: 9 }, { s: 2, d: 4 }, { s: 4, d: 1 }]);
    check("rings: one ring per component with only the links inside it", rs.length === 1 && rs[0].members.join() === "1,2,3,4" && rs[0].links.length === 5, rs);
    const loop = loopThrough([{ s: 1, d: 2 }, { s: 2, d: 3 }, { s: 3, d: 1 }, { s: 2, d: 4 }, { s: 4, d: 1 }], 4);
    check("rings: the shortest loop through a member, in order from it", loop.map((l) => `${l.s}>${l.d}`).join(" ") === "4>1 1>2 2>4", loop);
    const ring = { members: [1, 2, 3, 7], names: { 1: "Alpha", 2: "Beta", 3: "Gamma", 7: "Delta" }, links: [
      { s: 1, d: 2, kind: "holder", percent: 12.345, url: "https://sec.gov/a", asOf: "2025-03-01" }, { s: 2, d: 3, kind: "subsidiary", percent: null, url: "https://sec.gov/b", asOf: "2026-02-01" },
      { s: 3, d: 1, kind: "holder", percent: null, url: "https://sec.gov/c", asOf: null }, { s: 3, d: 7, kind: "holder", percent: 30, url: "", asOf: null }, { s: 7, d: 3, kind: "holder", percent: 5, url: "", asOf: null },
    ] };
    const rf = ringFlag(ring, 1, "2026-09-30");
    check("rings: the flag walks the loop with each stake, names the other members and keeps the card's shape", rf.kind === "circular_ownership" && rf.severity === "medium" && rf.title === "Ownership loops back on itself in 3 steps"
      && rf.detail.startsWith("Alpha owns 12.3% of Beta; Beta lists Gamma as a subsidiary; Gamma holds a stake in Alpha.") && rf.detail.includes("4 owners in all, with 5 stakes") && rf.detail.includes("the others are Delta") && rf.date === "2026-02-01" && rf.urls?.length === 3, rf);
  }

  // Networks: integrated (ultimate) ownership, Vitali, Glattfelder and Battiston (2011).
  {
    const io = integratedOwnership([{ s: 10, d: 2, share: 0.1 }, { s: 2, d: 1, share: 0.5 }, { s: 10, d: 1, share: 0.08 }], 1);
    check("ownership: a fund's direct stake plus what it holds through the parent (8% + 10% x 50%)", Math.abs((io.get(10) ?? 0) - 0.13) < 1e-9 && io.get(2) === 0.5, [...io]);
    const cyc = integratedOwnership([{ s: 1, d: 2, share: 0.3 }, { s: 2, d: 1, share: 0.2 }, { s: 1, d: 3, share: 0.4 }], 3);
    check("ownership: loops included, as (I - W)^-1 W gives (A = 0.4 / 0.94)", Math.abs((cyc.get(1) ?? 0) - 0.4 / 0.94) < 1e-6 && Math.abs((cyc.get(2) ?? 0) - 0.08 / 0.94) < 1e-6 && !cyc.has(3), [...cyc]);
    const over = integratedOwnership([{ s: 1, d: 3, share: 0.7 }, { s: 2, d: 3, share: 0.5 }], 3);
    check("ownership: stakes filed past 100% of a company are scaled down to it", Math.abs((over.get(1) ?? 0) - 0.7 / 1.2) < 1e-9 && Math.abs((over.get(2) ?? 0) - 0.5 / 1.2) < 1e-9);
    const viaParent = strongestChain([{ s: 10, d: 2, share: 0.1 }, { s: 2, d: 1, share: 0.5 }, { s: 10, d: 1, share: 0.03 }], 10, 1);
    const direct = strongestChain([{ s: 10, d: 2, share: 0.1 }, { s: 2, d: 1, share: 0.5 }, { s: 10, d: 1, share: 0.08 }], 10, 1);
    check("ownership: the chain behind a stake is the one carrying the most", viaParent.map((c) => `${c.s}>${c.d}`).join(" ") === "10>2 2>1" && direct.map((c) => `${c.s}>${c.d}`).join(" ") === "10>1" && strongestChain([{ s: 1, d: 2, share: 0.5 }], 2, 1).length === 0);
    check("ownership: a filing with no figure counts at its floor (5% for 13D/13G, 10% for a Form 4 ten-percent owner)", stakeShare({ percent: 12.5 }).share === 0.125 && !stakeShare({ percent: 12.5 }).floor && stakeShare({ percent: null, tenPct: true }).share === 0.1 && stakeShare({}).share === 0.05 && stakeShare({}).floor);
  }

  // Networks: a Clayton Act section 8 screen of shared directors and officers.
  {
    const big = (over: object) => ({ name: "A", sic: "4922", industry: "Natural Gas Transmission", equity: 2e9, revenue: 5e9, ...over });
    const hit = section8Screen(big({}), big({ name: "B", equity: 9e8 }));
    check("section 8: the same SIC and both above the 2026 threshold by equity screens in", !!hit && hit.industry === "SIC 4922 (Natural Gas Transmission)" && hit.sizes.every((x) => x.measure === "equity") && SECTION_8.capital === 54_402_000 && SECTION_8.competitiveSales === 5_440_200, hit);
    check("section 8: revenue stands in where there is no equity, and says so", section8Screen(big({ equity: null }), big({ name: "B" }))?.sizes[0].measure === "revenue");
    check("section 8: a different SIC, a company under the threshold, a bank, or no size does not screen in",
      section8Screen(big({}), big({ sic: "1311" })) === null && section8Screen(big({}), big({ equity: 54_402_000 })) === null && section8Screen(big({ sic: "6021" }), big({ sic: "6021" })) === null && section8Screen(big({}), big({ equity: null, revenue: null })) === null);
    check("section 8: without a SIC code the industry label decides", section8Screen(big({ sic: "" }), big({ sic: null, industry: "natural gas transmission" }))?.industry === "the industry Natural Gas Transmission");
    const f = section8Flag("Jane Roe", { name: "A Corp", role: "a director", url: "https://sec.gov/a", since: "2024-05-01" }, { name: "B Corp", role: "an officer (Chief Financial Officer)", url: "https://sec.gov/b", since: "2025-01-15" }, hit!, "2026-09-30");
    check("section 8: the flag is a medium screen, not legal advice, citing the FTC's 2026 thresholds", f.kind === "interlocking_directorate" && f.severity === "medium" && f.title === "Possible interlocking directorate"
      && f.detail.includes("not legal advice") && f.detail.includes("$54,402,000") && f.detail.includes("$5,440,200") && f.detail.includes("stockholders' equity") && f.refs?.[0].url === SECTION_8.source && f.date === "2025-01-15" && f.urls?.length === 2, f);
    check("section 8: no second full stop after a name that ends in one", section8Flag("J", { name: "A Corp", role: "a director" }, { name: "Targa Resources Corp.", role: "a director" }, hit!, "2026-09-30").detail.includes("of Targa Resources Corp. Both are in"));
    // The test branch's two pairs: one who moved from one company to the other, and one on both boards at once.
    check("shared seats: someone who moved between companies does not sit at both", !servedTogether({ first: "2025-02-19", last: "2025-02-19" }, { first: "2026-09-03", last: "2026-09-03" }, "2026-09-30"));
    check("shared seats: overlapping Form 4s at both, recently, do", servedTogether({ first: "2026-04-16", last: "2026-04-29" }, { first: "2025-05-07", last: "2026-05-06" }, "2026-09-30"));
    check("shared seats: a director who files yearly at one board and joins another counts at once", servedTogether({ first: "2019-05-01", last: "2026-01-15" }, { first: "2026-03-02", last: "2026-03-02" }, "2026-09-30"));
    check("shared seats: two seats with no Form 4 in 18 months, or no dates, do not", !servedTogether({ first: "2020-01-01", last: "2025-01-10" }, { first: "2020-02-01", last: "2025-02-01" }, "2026-09-30") && !servedTogether({ first: null, last: null }, { first: "2026-01-01", last: "2026-01-01" }, "2026-09-30"));
    check("titles: Form 4 entities decoded and \"See Remarks\" dropped", officerTitle("EVP &amp; CHIEF COMMERCIAL OFFICER") === "EVP & CHIEF COMMERCIAL OFFICER" && officerTitle("See Remarks") === "" && officerTitle("see remarks below") === "" && officerTitle(undefined) === "" && xmlText("Caf&#233; &lt;LP&gt; &#x26; Co") === "Café <LP> & Co"
      && linkSentence("officer", "Jo", "Acme", { title: "SVP &amp; CFO" }) === "Jo is SVP & CFO of Acme" && linkSentence("officer", "Jo", "Acme", { title: "See Remarks" }) === "Jo is an officer of Acme" && sentence("Acme Corp.") === "Acme Corp." && sentence("Acme") === "Acme.");
  }

  // Networks: fair baselines for the deal model, on its split, and bootstrap intervals.
  {
    const s = summarize([1, 3, 7, 12]);
    check("baselines: hit rates and MRR as the ML service rounds them", s.hits5 === 0.5 && s.hits10 === 0.75 && s.mrr === 0.3899 && s.n === 4 && summarize([]).hits10 === null, s);
    const scores = new Map([[1, 3], [2, 1], [3, 1], [4, 0]]);
    check("baselines: ranks count ties at their middle and skip the anchor's other deals", midRank(scores, [1, 2, 3, 4, 5], 2, new Set()) === 2.5 && midRank(scores, [1, 2, 3, 4, 5], 2, new Set([1])) === 1.5);
    const aa = adamicAdarFrom(adjacencyByKind([{ s: 10, d: 1, kind: "director" }, { s: 10, d: 2, kind: "director" }, { s: 20, d: 1, kind: "holder" }, { s: 20, d: 2, kind: "holder" }, { s: 20, d: 3, kind: "holder" }]), 1);
    check("baselines: Adamic-Adar per kind of link, summed (1/ln 2 for a shared director, 1/ln 3 for a fund in three)", Math.abs((aa.get(2) ?? 0) - (1 / Math.log(2) + 1 / Math.log(3))) < 1e-12 && Math.abs((aa.get(3) ?? 0) - 1 / Math.log(3)) < 1e-12 && !aa.has(1), [...aa]);
    const g = {
      nodes: [1, 2, 3, 4, 5].map((id) => ({ id, kind: "company" })).concat([{ id: 10, kind: "person" }]),
      edges: [{ s: 10, d: 1, kind: "director", t: "2020-01-01" }, { s: 10, d: 2, kind: "director", t: null }, { s: 10, d: 4, kind: "director", t: "2025-01-01" }],
      deals: [{ acquirer: 1, target: 5, t: "2021-01-01" }, { acquirer: 1, target: 3, t: "2022-06-01" }, { acquirer: 1, target: 2, t: "2024-03-01" }, { acquirer: 4, target: 3, t: "2026-05-01" }],
    };
    const b = baselineBacktest(g, "2024-01-01", { until: "2025-12-31" });
    check("baselines: on the split, links after it unseen, deals after the model's training left out", b.testDeals === 1 && b.adamicAdar.asTarget?.hits10 === 1 && b.adamicAdar.asAcquirer?.mrr === 1 && b.acquisitiveness.asAcquirer?.mrr === 1 && b.adamicAdar.n === 2 && b.acquisitiveness.asTarget === undefined, b);
    const late = baselineBacktest(g, "2024-01-01");
    check("baselines: a buyer with no deals before the split ties with the field", late.testDeals === 2 && late.acquisitiveness.asAcquirer?.n === 2 && late.acquisitiveness.asAcquirer.mrr === 0.75, late.acquisitiveness);
    const [lo, hi] = bootstrapInterval(20, 50);
    check("baselines: the bootstrap's 90% interval for 20 of 50 is 28% to 52% (about 12 points each way)", lo === 0.28 && hi === 0.52, [lo, hi]);
    check("baselines: intervals at the edges and for tiny samples", JSON.stringify(bootstrapInterval(0, 6)) === "[0,0]" && JSON.stringify(bootstrapInterval(6, 6)) === "[1,1]" && JSON.stringify(bootstrapInterval(4, 6)) === JSON.stringify([2 / 6, 1]) && JSON.stringify(bootstrapInterval(0, 0)) === "[0,0]");
    const side = (hits10: number, n = 6) => ({ hits5: hits10, hits10, mrr: 0.2, n });
    const m = { gnn: { ...side(0.6667, 12), asTarget: side(0.5), asAcquirer: side(0.6667) }, baseline: { ...side(0.4167, 12), asTarget: side(0.1667), asAcquirer: side(0.5) },
      fair: { adamicAdar: { ...side(0.25, 12), asTarget: side(0.1667), asAcquirer: side(0.3333) }, acquisitiveness: { ...side(0.8333), asAcquirer: side(0.8333) }, testDeals: 6, splitDate: "2024-08-02", computedAt: "" } };
    const buyers = scorecardText(m, "acquirers"), targets = scorecardText(m, "targets");
    check("scorecard: likely buyers read the service's asAcquirer, with a 90% interval, and say plainly when the model loses", buyers.startsWith("In a backtest on the 6 most recent deals, the actual buyer was among the model's top 10 likely buyers for 4 of 6 (90% bootstrap interval 33% to 100%).")
      && buyers.includes("acquisitiveness (the buyer's deals in the prior 36 months) 5 of 6") && buyers.includes("The model does not beat acquisitiveness") && buyers.includes("Its lead over company features alone and shared connections (Adamic-Adar) is inside its interval"), buyers);
    check("scorecard: likely targets read asTarget, and acquisitiveness is not a baseline for them", targets.includes("the actual target was among the model's top 10 likely targets for 3 of 6") && !targets.includes("acquisitiveness") && targets.includes("company features alone 1 of 6"), targets);
    check("scorecard: a clear win, a top-5 record without top-10 figures, and nothing to show",
      scorecardText({ gnn: { ...side(0.8, 40), asAcquirer: side(0.8, 20) }, baseline: { ...side(0.1, 40), asAcquirer: side(0.1, 20) } }, "acquirers").endsWith("It beats every baseline by more than its interval.")
      && scorecardText({ gnn: { hits5: 0.55, hits10: 0.7, mrr: 0.3, n: 40, asAcquirer: { hits5: 0.55, n: 20 } } }, "acquirers").includes("top 5 likely buyers for 11 of 20") && scorecardText(null, "targets") === "Not backtested yet.");
  }

  {
    console.log("Radar change");
    // Three passes of a 48 x 48 box: open desert with a deterministic speckle (0.03 to 0.05) and a working plant (a 10 x 10 block at 0.6).
    const S = 48, N = S * S;
    const desert = (seed: number) => Float32Array.from({ length: N }, (_, i) => 0.03 + 0.02 * (((i * 7919 + seed * 104729) % 97) / 97));
    const paint = (a: Float32Array, x0: number, y0: number, w: number, h: number, v: number) => { const b = new Float32Array(a); for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) b[y * S + x] = v; return b; };
    const all = new Uint8Array(N).fill(1);
    const stack = (layers: Float32Array[]) => majority(layers, layers.map(() => all), N);
    const withPlant = (a: Float32Array) => paint(a, 30, 30, 10, 10, 0.6);
    const before = stack([1, 2, 3].map((k) => withPlant(desert(k))));
    const m3 = majority([[0.1], [0.5], [0.2]], [[1], [1], [1]], 1), m2 = majority([[0.1], [0.5]], [[1], [1]], 1), m1 = majority([[0.9], [0.5]], [[1], [0]], 1);
    check("per pixel, three passes agree on the median; with two, a bright one alone never makes the pixel bright (or dark); one pass is not enough", m3.floor[0] === Float32Array.of(0.2)[0] && m3.ceil[0] === m3.floor[0] && m2.floor[0] === Float32Array.of(0.1)[0] && m2.ceil[0] === Float32Array.of(0.5)[0] && !m1.valid[0], { m3, m2 });
    check("the ground level is the median pixel", Math.abs(levelOf(before.median, before.valid) - 0.04) < 0.006, levelOf(before.median, before.valid));
    // Now: a new 4 x 4 tank on open ground (hard return 2.0), a speckle seen in one pass only, and a faint 2 x 2 return beside the plant.
    const nowLayers = [4, 5, 6].map((k) => paint(paint(withPlant(desert(k)), 8, 8, 4, 4, 2.0), 28, 33, 2, 2, 0.5));
    nowLayers[0] = paint(nowLayers[0], 20, 5, 3, 3, 3.0);
    const after = stack(nowLayers);
    const c = radarChange(before, after, S, S);
    check("a new tank on open ground is one new object of 16 pixels with its hard return", c.added.length === 1 && c.added[0].pixels === 16 && c.added[0].peak === 2 && c.added[0].ring === 0 && c.mask.filter((v) => v === 1).length === 16, c.added);
    check("a bright speckle in one pass of three is not new", c.mask[5 * S + 20] === 0);
    check("a small faint return beside a working plant does not count (its metal flickers)", c.mask[33 * S + 28] === 0 && c.removed.length === 0, c.removed);
    check("the scene is comparable: the same ground level both times, the whole box seen", comparable(c) && Math.abs(c.ground.ratio - 1) < 0.05 && c.validFraction === 1, c.ground);
    // The plant torn down: a vanished object; a whole box gone damp (ground 1.6 times brighter) keeps only hard returns.
    const razed = radarChange(before, stack([4, 5, 6].map((k) => desert(k))), S, S);
    check("a plant torn down is a bright object gone", razed.added.length === 0 && razed.removed.length === 1 && razed.removed[0].pixels === 100, razed.removed.map((o) => o.pixels));
    const soft = [4, 5, 6].map((k) => paint(desert(k), 8, 8, 3, 3, 0.4));
    const calm = radarChange(stack([1, 2, 3].map(desert)), stack(soft), S, S);
    const damp = radarChange(stack([1, 2, 3].map(desert)), stack(soft.map((a) => a.map((v) => (v < 0.1 ? v * 1.6 : v)))), S, S);
    check("a soft new object of nine pixels counts on dry ground but not when the whole scene is damper", calm.added.length === 1 && damp.added.length === 0 && damp.ground.ratio > 1.25, { calm: calm.added.length, damp: damp.ground });
    check("what counts: on open ground eight pixels or a hard return of three; on busy ground only fifteen strong pixels; never in clutter",
      counts({ pixels: 8, peak: 0.4, ring: 0 }, false) && !counts({ pixels: 8, peak: 0.4, ring: 0 }, true) && counts({ pixels: 3, peak: 1.2, ring: 0.1 }, true) && !counts({ pixels: 7, peak: 0.6, ring: 0 }, false)
      && counts({ pixels: 15, peak: 3, ring: 0.45 }, false) && !counts({ pixels: 14, peak: 9, ring: 0.45 }, false) && !counts({ pixels: 40, peak: 9, ring: 0.6 }, false));
    const blob = [10 * S + 10, 10 * S + 11];
    check("the ring around an object measures how built-up its surroundings were", ringBright(blob, before.median, before.valid, S, S, 0.1) === 0 && ringBright([35 * S + 35], before.median, before.valid, S, S, 0.1) > 0.9);
    check("a card needs 20 pixels between the new objects and one hard return of four or more",
      radarWorthy([{ pixels: 16, peak: 2 }, { pixels: 6, peak: 0.5 }]) && !radarWorthy([{ pixels: 19, peak: 3 }]) && !radarWorthy([{ pixels: 30, peak: 0.8 }]) && !radarWorthy([{ pixels: 3, peak: 1.5 }, { pixels: 18, peak: 0.6 }]));
    const conf = (pixels: number, ratio: number) => radarConfidence({ added: [{ kind: 1, x: 0, y: 0, bbox: [0, 0, 0, 0], pixels, peak: 2, ring: 0 }], ground: { before: 0.04, after: 0.04 * ratio, ratio }, strays: 50 }, { before: 3, after: 3 });
    check("confidence grows with what was found and falls when the ground is damper (not when drier), within 0.2 to 0.95", conf(80, 1) > conf(20, 1) && conf(20, 1.6) < conf(20, 1) && conf(20, 0.7) === conf(20, 1) && conf(500, 1) <= 0.95 && conf(3, 3) >= 0.2, { big: conf(80, 1), small: conf(20, 1), damp: conf(20, 1.6) });
    check("magnitude is the new ground covered, a hectare counting in full", radarMagnitude(5000) === 0.5 && radarMagnitude(25_000) === 1 && radarMagnitude(0) === 0);
    check("objects already reported (within 40 m) are not news again", unreported([{ lon: -103.9, lat: 31.8 }, { lon: -103.89, lat: 31.8 }], [{ lon: -103.9002, lat: 31.8001 }]).length === 1);
    check("a 2.5 km box at 256 pixels is about 95 m² a pixel", Math.abs(pixelArea(boxKm(-103.8965, 31.8107, 1.25), 256) - 95.4) < 1, pixelArea(boxKm(-103.8965, 31.8107, 1.25), 256));
    check("compass words from the box centre (y grows south)", bearingWords(0, -50) === "north of" && bearingWords(40, 40) === "south-east of" && bearingWords(-30, 0) === "west of" && bearingWords(2, 3) === "at");
    check("decibels", toDb(BRIGHT) === -6 && toDb(1) === 0 && toDb(10) === 10);
    const png = decodePng(radarOverlayPng(c));
    const at = (x: number, y: number) => Array.from(png.data.subarray((y * S + x) * 4, (y * S + x) * 4 + 4));
    check("the overlay marks the new object amber, rings it, and leaves the rest clear", png.width === S && at(9, 9).join() === "255,176,32,235" && at(5, 5)[3] === 170 && at(0, 47)[3] === 0, { tank: at(9, 9), ring: at(5, 5) });
    // Scenes: which orbit and passes to compare.
    const sc = (id: string, date: string, orbit: "ascending" | "descending", relOrbit: number, corners = 15): RadarScene => ({ id, date, at: `${date}T00:51:00Z`, orbit, relOrbit, platform: "sentinel-1c", corners });
    const recent = [sc("a1", "2026-09-27", "ascending", 78), sc("a2", "2026-09-21", "ascending", 78), sc("a3", "2026-09-15", "ascending", 78), sc("a4", "2026-09-09", "ascending", 78), sc("d1", "2026-09-21", "descending", 85), sc("d2", "2026-09-09", "descending", 85), sc("d3", "2026-08-28", "descending", 85)];
    const old = [sc("o1", "2025-10-31", "ascending", 78), sc("o2", "2025-10-19", "ascending", 78, 8), sc("o2b", "2025-10-19", "ascending", 78, 3), sc("o3", "2025-10-07", "ascending", 78), sc("o4", "2025-09-25", "ascending", 78), sc("o5", "2025-09-13", "ascending", 78), sc("o6", "2025-09-01", "ascending", 78, 3), sc("e1", "2025-09-19", "descending", 85)];
    const st = pickStacks(recent, old);
    check("the orbit with three passes on both sides wins; its newest three now and the three nearest a year before", !!st && st.relOrbit === 78 && st.after.map((p) => p.date).join() === "2026-09-27,2026-09-21,2026-09-15" && st.before.map((p) => p.date).join() === "2025-10-07,2025-09-25,2025-09-13", st);
    const st2 = pickStacks(recent, old.filter((s) => s.id !== "o3" && s.id !== "o4" && s.id !== "o5"));
    check("slices of one pass are merged, and a pass whose slices hold only two corners of the box is passed over", !!st2 && st2.before.some((p) => p.date === "2025-10-19" && p.ids.join() === "o2,o2b") && !st2.before.some((p) => p.date === "2025-09-01"), st2?.before);
    check("an orbit can be skipped (when what it read covered too little), and with no orbit left there is nothing to compare", pickStacks(recent, old, 3, ["ascending:78"]) === null && pickStacks(recent.slice(0, 1), old) === null);
    const box: [number, number, number, number] = [-104, 31, -103, 32];
    const poly = (w: number, e: number) => ({ type: "Polygon", coordinates: [[[w, 30], [e, 30], [e, 33], [w, 33], [w, 30]]] });
    check("a footprint holds all four corners of the box, or only some", cornersIn(poly(-105, -102), box) === 15 && cornersIn(poly(-105, -103.5), box) === 9 && cornersIn(null, box) === 15);
    const items = [{ id: "S1C_x_rtc", properties: { datetime: "2026-09-27T00:51:25Z", "sat:orbit_state": "ascending", "sat:relative_orbit": 78, platform: "sentinel-1c" }, geometry: poly(-105, -102) }, { id: "bad", properties: { datetime: "2026-09-27T00:51:25Z" } }];
    const parsed = scenesFrom(items, box);
    check("STAC items become scenes with their orbit, and items without one are dropped", parsed.length === 1 && parsed[0].relOrbit === 78 && parsed[0].date === "2026-09-27" && parsed[0].corners === 15, parsed);
    check("a pass renders as VV in decibels", radarUrl("S1C_x_rtc", box).includes("collection=sentinel-1-rtc") && radarUrl("S1C_x_rtc", box).includes(encodeURIComponent("10*log10(vv)")) && radarUrl("S1C_x_rtc", box).includes("rescale=-22,3"));
    check("a large, confident radar change interrupts watchers; a small one waits for the digest", isBig({ kind: "radar_change", confidence: 0.71, magnitude: 1, visual: {} }) && !isBig({ kind: "radar_change", confidence: 0.65, magnitude: 1, visual: {} }) && !isBig({ kind: "radar_change", confidence: 0.8, magnitude: 0.3, visual: {} }));
    check("radar ranks with flaring as rarely reported news", noveltyOf("radar_change", 0) === noveltyOf("flaring", 0) && noveltyOf("radar_change", 0) > noveltyOf("permits", 0));
    const mail = digestItem({ id: 1, kind: "radar_change", title: "Radar shows 5 new structures south-west of Orla Plant", summary: "s", confidence: 0.7, visual: { before: { url: "https://x/b.png", date: "2025-10-07" }, after: { url: "https://x/a.png", date: "2026-09-27" }, stats: { newObjects: 5, newAreaM2: 16_000 } } }, "https://app");
    check("the digest shows radar before and after with the count", mail.includes("https://x/b.png") && mail.includes("https://x/a.png") && mail.includes("5 new, about 16,000 m²"));
  }

  {
    console.log("Drilling permits");
    check("windows of 30 days ending today, oldest first, a day counted in the window it falls in", JSON.stringify(windowsOf(["2026-09-30", "2026-09-01", "2026-08-31", "2026-06-03", "2026-06-02"], "2026-09-30")) === JSON.stringify({ windows: [1, 0, 1, 2], last30: 2, prior90: 2 }), windowsOf(["2026-09-30", "2026-09-01", "2026-08-31", "2026-06-03", "2026-06-02"], "2026-09-30"));
    check("a jump is five or more in 30 days and at least twice the pace before", permitJump({ last30: 5, prior90: 6 }) && !permitJump({ last30: 5, prior90: 9 }) && !permitJump({ last30: 4, prior90: 0 }) && permitJump({ last30: 9, prior90: 0 }));
    check("the pace ratio floors the earlier pace at one a month", paceRatio({ last30: 9, prior90: 0 }) === 9 && Math.abs(paceRatio({ last30: 12, prior90: 89 }) - 0.4) < 0.01);
    const cd = permitConfidence({ last30: 9, prior90: 0 }, true), cu = permitConfidence({ last30: 9, prior90: 0 }, false);
    check("state approval dates make a jump surer than dates Edge recorded itself; within 0.3 to 0.92", cd > cu && cd <= 0.92 && cu >= 0.3 && permitConfidence({ last30: 30, prior90: 3 }, true) > permitConfidence({ last30: 6, prior90: 9 }, true), { cd, cu });
    check("magnitude grows with permits and with the jump, at most 1", permitMagnitude({ last30: 20, prior90: 0 }) === 1 && permitMagnitude({ last30: 6, prior90: 9 }) < permitMagnitude({ last30: 12, prior90: 9 }));
    check("who holds the permits, most first", JSON.stringify(operatorsOf([{ operator: "EOG" }, { operator: "OXY" }, { operator: "EOG" }, { operator: "" }])) === JSON.stringify([{ name: "EOG", n: 2 }, { name: "OXY", n: 1 }]));
    const t1 = trackSeen(null, ["a", "b"], "2026-09-30"), t2 = trackSeen(t1, ["a", "b", "c"], "2026-10-04"), t3 = trackSeen(t2, ["a", "b", "c", "d"], "2026-11-30");
    check("Texas: after a gap of more than a week between reads, what appeared in it is not dated (a gap is not a jump)", t3.seen.d === "" && t3.seen.c === "2026-10-04" && t3.last === "2026-11-30");
    check("Texas: locations there on the first look are not new; one that appears later is dated the day it appeared", t1.since === "2026-09-30" && t1.seen.a === "" && t2.seen.c === "2026-10-04" && t2.seen.a === "" && t2.since === "2026-09-30");
    const nowP = Date.parse("2026-09-30T12:00:00Z");
    check("a jump repeats the last card within 30 days unless half again as many", permitRepeats({ at: "2026-09-10T12:00:00Z", last30: 10 }, 12, nowP) && !permitRepeats({ at: "2026-09-10T12:00:00Z", last30: 10 }, 15, nowP) && !permitRepeats({ at: "2026-08-20T12:00:00Z", last30: 10 }, 12, nowP) && !permitRepeats(null, 12, nowP));
    const nm = { last30: 9, prior90: 0, windows: [0, 0, 0, 9], permits: [], operators: [] };
    const tx = (days: number) => ({ permitted: 300, since: "2026-06-01", trackedDays: days, last30: 4, prior90: 3, windows: [1, 1, 1, 4], newest: [] });
    check("judged on New Mexico's dated permits, and on Texas's only after four months of Edge's own record", JSON.stringify(judged({ nm, tx: tx(30) })) === JSON.stringify({ last30: 9, prior90: 0, windows: [0, 0, 0, 9], dated: true }) && judged({ nm: null, tx: tx(30) }) === null && judged({ nm, tx: tx(121) })!.last30 === 13 && !judged({ nm, tx: tx(121) })!.dated);
    const bk = boxKm(-103.5223, 32.2131, 10);
    check("a 10 km box is 20 km across", Math.abs((bk[3] - bk[1]) * 110.574 - 20) < 0.01);
    check("which states a circle reaches: Red Hills only New Mexico, Orla only Texas, Dollarhide on the line both", JSON.stringify(statesNear(boxKm(-103.5223, 32.2131, 10))) === JSON.stringify({ nm: true, tx: false }) && JSON.stringify(statesNear(boxKm(-103.8965, 31.8107, 10))) === JSON.stringify({ nm: false, tx: true }) && JSON.stringify(statesNear(boxKm(-103.0567, 32.1469, 10))) === JSON.stringify({ nm: true, tx: true }));
    const tp = txPermitsFrom([{ API: "38980497", GIS_LAT83: 31.827, GIS_LONG83: -103.876 }, { API: "38980497", GIS_LAT83: 31.827, GIS_LONG83: -103.876 }, { API: "", GIS_LAT83: 31.8, GIS_LONG83: -103.8 }, { API: "38941806", GIS_LAT83: null, GIS_LONG83: -103.9 }]);
    check("Texas rows become one permitted location per API number, written 42-county-number", tp.length === 1 && tp[0].api === "42-389-80497" && tp[0].lon === -103.876, tp);
    const np = nmPermitsFrom([
      { id: "30-025-56868", name: "LOOSE STONES 18 FEDERAL COM #102H", ogrid_name: "EOG RESOURCES INC", type: "Oil", latitude: 32.13, longitude: -103.47, effective_date: Date.parse("2026-09-03T06:00:00Z"), spud_date: 253402239600000, details: "https://x" },
      { id: "30-025-1", name: "SWD 1", type: "Salt Water Disposal", latitude: 32.1, longitude: -103.4, effective_date: Date.parse("2026-09-03T06:00:00Z") },
      { id: "30-025-2", name: "NO DATE", type: "Gas", latitude: 32.1, longitude: -103.4, effective_date: null },
    ]);
    check("New Mexico rows: oil and gas wells with an approval date; a spud date of 9999 means not yet spudded", np.length === 1 && np[0].approved === "2026-09-03" && np[0].spud === null && np[0].operator === "EOG RESOURCES INC", np);
    check("a permits jump interrupts watchers only when large and sure", isBig({ kind: "permits", confidence: 0.85, magnitude: 0.9, visual: {} }) && !isBig({ kind: "permits", confidence: 0.85, magnitude: 0.73, visual: {} }) && !isBig({ kind: "permits", confidence: 0.6, magnitude: 1, visual: {} }));
    check("permits rank below satellite findings and above filings", noveltyOf("permits", 0) < noveltyOf("radar_change", 0) && noveltyOf("permits", 0) > noveltyOf("filing_change", 0));
    const pmail = digestItem({ id: 2, kind: "permits", title: "9 drilling permits", summary: "s", confidence: 0.85, visual: { windows: [0, 0, 0, 9], last30: 9, prior90: 0, radiusKm: 10 } }, "https://app");
    check("the digest shows the permits by 30 days", pmail.includes("9 permits in the last 30 days · 0.0 a month before") && pmail.includes("Each bar is 30 days"));
  }

  {
    console.log("Planet and Carbon Mapper (ready to switch on)");
    const nowD = new Date("2026-09-30T12:00:00Z");
    const body = planetSearchBody([-103.91, 31.80, -103.88, 31.82], nowD);
    const [geo, dates, cloud] = body.filter.config as { type: string; field_name: string; config: { type?: string; coordinates?: number[][][]; gte?: string; lte?: string | number } }[];
    check("Planet's quick search: both item types, the site's box as a closed polygon, the last 60 days, cloud at most 20%",
      body.item_types.join() === "PSScene,SkySatCollect" && body.filter.type === "AndFilter" && geo.type === "GeometryFilter" && geo.config.coordinates![0].length === 5 && geo.config.coordinates![0][0].join() === geo.config.coordinates![0][4].join()
      && dates.config.gte === "2026-08-01T12:00:00.000Z" && dates.config.lte === "2026-09-30T12:00:00.000Z" && cloud.field_name === "cloud_cover" && cloud.config.lte === 0.2, body);
    const planet = planetScenesFrom({ features: [
      { id: "20260901_171200_10_2486", properties: { item_type: "PSScene", acquired: "2026-09-01T17:12:00Z", cloud_cover: 0.034, gsd: 3.7 } },
      { id: "20260920_180000_ssc1_u0001", properties: { item_type: "SkySatCollect", acquired: "2026-09-20T18:00:00Z", cloud_cover: 0 } },
      { id: "x", properties: { item_type: "PSScene", acquired: "2026-09-10T00:00:00Z" } },
      { id: "20260915_000000_00_0000", properties: { item_type: "REOrthoTile", acquired: "2026-09-15T00:00:00Z" } },
    ] });
    check("Planet's answer: newest first, cloud as a percentage, SkySat at 50 cm when unstated, odd ids and other types dropped, thumbnails through our route",
      planet.length === 2 && planet[0].type === "SkySatCollect" && planet[0].gsdM === 0.5 && planet[1].cloudPct === 3 && planet[1].gsdM === 3.7 && planet[1].thumb === "/api/edge/planet/thumb?type=PSScene&id=20260901_171200_10_2486", planet);
    check("only Planet scene types and plain ids are proxied", validScene("PSScene", "20260901_171200_10_2486") && !validScene("REOrthoTile", "20260901_171200_10_2486") && !validScene("PSScene", "../../etc") && thumbPath("SkySatCollect", "a_b") === "/api/edge/planet/thumb?type=SkySatCollect&id=a_b");
    check("Planet takes the key as the Basic user name with no password", planetAuth("k") === "Basic azo=");
    const url = plumesUrl([-104.5, 31, -101.5, 32.8], new Date("2025-01-01T00:00:00Z"), new Date("2026-09-30T00:00:00Z"));
    check("the Carbon Mapper query: the box as four bbox values, a window without milliseconds, methane, newest first", url.includes("bbox=-104.5000&bbox=31.0000&bbox=-101.5000&bbox=32.8000") && url.includes("datetime=2025-01-01T00:00:00Z/2026-09-30T00:00:00Z") && url.includes("plume_gas=CH4") && url.endsWith("sort=desc"), url);
    const plumes = plumesFrom({ items: [
      { plume_id: "tan20260827t190313c36s4001-A", scene_id: "s1", gas: "CH4", geometry_json: { type: "Point", coordinates: [-103.0970, 31.2749] }, scene_timestamp: "2026-08-27T19:03:13.360Z", platform: "Tanager", emission_auto: 821.72, emission_uncertainty_auto: 115.5, plume_rgb_png: "https://catalog.carbonmapper.org/a.png" },
      { plume_id: "tan20260827t190313c36s4001-B", scene_id: "s1", gas: "CH4", geometry_json: { type: "Point", coordinates: [-103.0900, 31.2700] }, scene_timestamp: "2026-08-27T19:03:13.360Z", platform: "Tanager", emission_auto: 610, emission_uncertainty_auto: 88.8 },
      { plume_id: "emi20260701-A", scene_id: "s0", gas: "CH4", geometry_json: { type: "Point", coordinates: [-103.0950, 31.2760] }, scene_timestamp: "2026-07-01T18:00:00Z", platform: "EMIT", emission_auto: null },
      { plume_id: "co2", gas: "CO2", geometry_json: { type: "Point", coordinates: [-103.09, 31.27] }, scene_timestamp: "2026-08-27T19:00:00Z" },
      { plume_id: "nopoint", gas: "CH4", geometry_json: { type: "Polygon", coordinates: [] }, scene_timestamp: "2026-08-27T19:00:00Z" },
    ] });
    check("plumes: methane points with their rate and uncertainty in kg/h; other gases and shapes dropped", plumes.length === 3 && plumes[0].rateKgH === 822 && plumes[0].uncertaintyKgH === 116 && plumes[0].image.endsWith("a.png") && plumes[2].rateKgH === null, plumes);
    const nearP = plumesNear(plumes, -103.0867, 31.2689);
    const { pass: overpass, earlier } = newestPass(nearP);
    check("plumes within 2 km of the Waha plant, newest overpass together, the rest as history", nearP.length === 3 && overpass.length === 2 && earlier.length === 1 && overpass.every((p) => p.scene === "s1") && nearP.every((p) => p.m <= 2000), nearP.map((p) => [p.id, p.m]));
    const tr = totalRate(overpass);
    check("an overpass's rates add up, uncertainties in quadrature", tr.rate === 1432 && tr.uncertainty === Math.round(Math.hypot(116, 89)) && tr.estimated === 2, tr);
    check("nearer plumes are surer to be the plant's; a rough rate lowers it", methaneConfidence(300, 800, 100) === 0.85 && methaneConfidence(1500, 800, 600) === 0.48 && methaneMagnitude(1000) === 0.5 && methaneMagnitude(5000) === 1);
    const savedL = process.env.CARBON_MAPPER_LICENSED;
    delete process.env.CARBON_MAPPER_LICENSED; const off = licensed();
    process.env.CARBON_MAPPER_LICENSED = "0"; const zero = licensed();
    process.env.CARBON_MAPPER_LICENSED = "1"; const on = licensed();
    if (savedL === undefined) delete process.env.CARBON_MAPPER_LICENSED; else process.env.CARBON_MAPPER_LICENSED = savedL;
    check("Carbon Mapper is read only when CARBON_MAPPER_LICENSED is exactly 1", !off && !zero && on);
    check("a tonne an hour at the plant interrupts watchers; a far or small plume waits", isBig({ kind: "methane_plume", confidence: 0.85, magnitude: 0.6, visual: {} }) && !isBig({ kind: "methane_plume", confidence: 0.58, magnitude: 1, visual: {} }) && !isBig({ kind: "methane_plume", confidence: 0.85, magnitude: 0.3, visual: {} }));
    const mm = digestItem({ id: 3, kind: "methane_plume", title: "Methane", summary: "s", confidence: 0.85, visual: { rateKgH: 1432, uncertaintyKgH: 146, nearestM: 300, platform: "Tanager", date: "2026-08-27", credit: "Data by Carbon Mapper" } }, "https://app");
    check("the digest shows the rate with its uncertainty and the credit", mm.includes("1,432 ± 146 kg/h") && mm.includes("Data by Carbon Mapper"));
  }

  {
    console.log("documents: keyword search");
    const t = parseTerms('Hugh Brinson pipeline "early volumes" OR commissioning -crypto, $21 and Q2!');
    check("search text becomes words, quoted phrases and exclusions; OR and AND are dropped", t.words.join() === "Hugh,Brinson,pipeline,commissioning,$21,Q2" && t.phrases.join() === "early volumes" && t.not.join() === "crypto", t);
    check("each term is kept once, whatever its case", parseTerms("Revenue revenue REVENUE growth").words.join() === "Revenue,growth");
    check("nothing to search for gives no query", anyTermsQuery(parseTerms("  , -- ")) === null);
    const q = new PgDialect().sqlToQuery(anyTermsQuery(parseTerms('pipeline "basis differentials" -crypto'))!);
    check("the keyword query matches any term (each word stemmed alone, the phrase in order) and drops excluded words",
      q.sql === "((plainto_tsquery('english', $1) || phraseto_tsquery('english', $2)) && !!plainto_tsquery('english', $3))" && q.params.join() === "pipeline,basis differentials,crypto", q);

    console.log("documents: headers");
    check("dates read the way questions say them", longDate("2026-06-30") === "June 30, 2026" && longDate("2025-12-31") === "December 31, 2025" && longDate("n/a") === "n/a");
    const tenQ = { title: "Energy Transfer LP 10-Q (2026-08-06)", source: "sec", meta: { ticker: "ET", form: "10-Q", period: "2026-06-30", filed: "2026-08-06" } };
    check("a filing is named by company, ticker, form and period (the company from the title when not stored)", docLabel(tenQ) === "Energy Transfer LP (ET) · 10-Q · quarter ended June 30, 2026", docLabel(tenQ));
    check("a 10-K's period is its year; an 8-K is dated by filing", docLabel({ title: "X Corp 10-K (2026-02-19)", source: "sec", meta: { ticker: "X", form: "10-K", period: "2025-12-31", company: "X Corporation" } }) === "X Corporation (X) · 10-K · year ended December 31, 2025"
      && docLabel({ title: "X Corp 8-K (2026-03-02)", source: "sec", meta: { ticker: "X", form: "8-K", period: "2026-02-27", filed: "2026-03-02" } }) === "X Corp (X) · 8-K · filed March 2, 2026");
    check("an upload is named by its title and ticker", docLabel({ title: "Cinderlake Midstream: overview", source: "upload", meta: { ticker: "CDLK" } }) === "Cinderlake Midstream: overview (CDLK)");
    check("a passage header adds the section, heading and speaker once each", passageHeader(tenQ, { section: "MD&A", heading: "Consolidated Results", speaker: "" }) === "Energy Transfer LP (ET) · 10-Q · quarter ended June 30, 2026 · MD&A · Consolidated Results"
      && passageHeader({ title: "Call", source: "audio" }, { section: "", speaker: "Jane Doe, CFO" }) === "Call · Jane Doe, CFO");

    console.log("documents: passages of about 500 tokens");
    check("a 10-Q's Item 2 is its MD&A and its Item 3 its market risk", headingOf("Item 2. Management's Discussion and Analysis of Financial Condition") === "MD&A" && headingOf("ITEM 3. QUANTITATIVE AND QUALITATIVE DISCLOSURES ABOUT MARKET RISK") === "Market risk" && headingOf("Item 2. Properties") === "Item 2");
    check("contents entries are not headings", filingHeading("ITEM 1A. RISK FACTORS 64") === null && filingHeading("Item 7. Management's Discussion 40") === null);
    const inline = filingHeading("ITEM 10. DIRECTORS, EXECUTIVE OFFICERS AND CORPORATE GOVERNANCE Board of Directors Our general partner manages all of our activities.");
    check("an item heading run into its first paragraph is split from it", inline?.section === "Other item" && inline.heading === "ITEM 10. DIRECTORS, EXECUTIVE OFFICERS AND CORPORATE GOVERNANCE" && inline.rest.startsWith("Board of Directors"), inline);
    check("short title-case or capital lines read as headings; sentences and bullets do not", looksLikeHeading("Results of Operations") && looksLikeHeading("Liquidity and Capital Resources") && looksLikeHeading("CONSOLIDATED BALANCE SHEETS") && !looksLikeHeading("Revenue grew.") && !looksLikeHeading("Revenue grew strongly in the quarter") && !looksLikeHeading("• Lower volumes"));
    check("table cells are tidied: spacing dropped, $ joined to its figure, ) and % to the one before", cleanRow(["Midstream", "", "$", "3,164", "", "( 934", ")", "12", "%"]).join("|") === "Midstream|$3,164|(934)|12%", cleanRow(["Midstream", "", "$", "3,164", "", "( 934", ")", "12", "%"]));
    const [tbl] = tableParts([["", "Three Months Ended June 30,", ""], ["", "2026", "2025"], ["Revenues", "$", "531", "$", "819"], ["Costs", "400", "500"]]);
    check("a table's header rows are found (no label beside figures; years are not figures)", tbl?.kind === "table" && tbl.head === 2 && tbl.rows[2].join("|") === "Revenues|$531|$819", tbl);
    const layout = tableParts([["•", "Increased regulation of hydraulic fracturing could reduce the volumes our customers produce and ship."], ["•", "Cybersecurity breaches could disrupt our operations and harm our reputation with customers and regulators."]]);
    check("a table used for bullets reads as paragraphs", layout.length === 2 && layout.every((p) => p.kind === "text") && (layout[0] as { text: string }).text.startsWith("• Increased"), layout);
    const md = partsFromText("# Overview\n\nWe run pipelines.\n\n| Segment | 2026 |\n|---|---|\n| Midstream | 3,164 |\n\nTable of Contents\n\n41");
    check("Markdown headings and pipe tables become parts; page furniture is dropped", md.map((p) => p.kind).join() === "heading,text,table" && (md[2] as { head: number }).head === 1, md);
    const prose = Array.from({ length: 40 }, (_, i) => `Sentence ${i} says one more thing about the pipeline business and its volumes.`).join(" ");
    const pieces = chunkParts([{ kind: "heading", text: "Liquidity" }, { kind: "text", text: prose }, { kind: "heading", text: "Outlook" }, { kind: "text", text: "Volumes should grow." }]);
    check("passages stay under the cap and start fresh at a heading, which they carry", pieces.length >= 3 && pieces.every((p) => p.text.length <= P_MAX) && pieces[0].text.startsWith("Liquidity\nSentence 0") && pieces[0].heading === "Liquidity" && pieces[pieces.length - 1].text === "Outlook\nVolumes should grow." && pieces[pieces.length - 1].heading === "Outlook", pieces.map((p) => [p.heading, p.text.length]));
    const carried = pieces[1].text.split("\n")[0];
    check("a prose passage that runs over starts the next with its last words (about a tenth)", carried.length >= 100 && carried.length <= 200 && pieces[0].text.endsWith(carried) && pieces[1].heading === "Liquidity", [carried.length, pieces[1].text.slice(0, 60)]);
    const rows = [["Segment", "2026", "2025"], ...Array.from({ length: 120 }, (_, i) => [`Pipeline system number ${i}`, `${1000 + i}`, `${900 + i}`])];
    const big = chunkParts([{ kind: "text", text: "The following table shows volumes by system:" }, { kind: "table", rows, head: 1, units: "(in thousands of barrels per day)" }]);
    check("a big table is split between rows, its units and header repeated in every piece", big.length >= 3 && big.every((p) => p.text.includes("(in thousands of barrels per day)\nSegment | 2026 | 2025") && p.text.length <= P_MAX) && big[0].text.startsWith("The following table shows volumes by system:"), big.map((p) => p.text.slice(0, 70)));
    check("every row lands in exactly one piece", rows.slice(1).every((r) => big.filter((p) => p.text.includes(`${r[0]} | `)).length === 1));
    const segRows = [["Segment", "2026"], ...Array.from({ length: 60 }, (_, i) => [`Segment number ${i}`, `${3000 + i}`])];
    const small = chunkParts([{ kind: "text", text: "Volumes rose. ".repeat(90) }, { kind: "text", text: "Segment results were as follows:" }, { kind: "table", rows: segRows, head: 1 }]);
    check("a table that does not fit starts a fresh passage, with the sentence leading into it", small.length === 2 && small[1].text.startsWith("Segment results were as follows:\nSegment | 2026\nSegment number 0 | 3000") && small[1].text.endsWith("Segment number 59 | 3059") && small[0].text.endsWith("Segment results were as follows:"), small.map((p) => [p.text.length, p.text.slice(0, 40)]));
    const parts: Part[] = [{ kind: "text", text: "Cover page." }, { kind: "heading", text: "ITEM 1A. RISK FACTORS", section: "Risk factors" }, { kind: "text", text: "Risks abound." }, { kind: "heading", text: "Item 2. Management's Discussion and Analysis", section: "MD&A" }, { kind: "text", text: "Volumes rose." }];
    const ps = passagesFromParts(parts, 0, 10);
    check("item headings switch the section; ords continue from where they start", ps.map((p) => `${p.ord}:${p.section}`).join() === "10:,11:Risk factors,12:MD&A" && ps[2].text === "Item 2. Management's Discussion and Analysis\nVolumes rose.", ps);
    check("pages keep their numbers and their tables", passagesFromPages([{ n: 7, text: "Revenue grew.", tables: [[["Year", "Revenue"], ["2025", "1,200"]]] }])[0]?.text === "Revenue grew.\nYear | Revenue\n2025 | 1,200");

    console.log("documents: filing HTML");
    const html = `<html><head><title>x</title></head><body><div>ITEM 2. MANAGEMENT&#8217;S DISCUSSION AND ANALYSIS</div><div>Results of Operations</div><p>Volumes rose&nbsp;sharply.</p><div>(Dollars in millions)</div>
      <table><tr><td></td><td>2026</td><td></td><td>2025</td></tr><tr><td>Midstream</td><td>$</td><td>3,164</td><td>$</td><td>2,910</td></tr><tr><td>Interest</td><td>(</td><td>934</td><td>)</td></tr></table><div>41</div><div>Table of Contents</div>
      <table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table></body></html>`;
    const hp = partsFromHtml(html);
    check("filing HTML keeps its item heading, subheading, paragraphs and tables with their cells", hp.map((p) => p.kind).join() === "heading,heading,text,table,text"
      && (hp[0] as { section?: string }).section === "MD&A" && (hp[2] as { text: string }).text === "Volumes rose sharply.", hp);
    const ht = hp[3] as Extract<Part, { kind: "table" }>;
    check("the units line above a table goes with it, and figure cells are tidied", ht.units === "(Dollars in millions)" && ht.head === 1 && ht.rows[1].join("|") === "Midstream|$3,164|$2,910" && ht.rows[2].join("|") === "Interest|(934)|", ht);
    check("entities are decoded, and a numeric one out of range becomes a space", decodeEntities("AT&amp;T&#8217;s &#x2014; ok") === "AT&T’s — ok" && decodeEntities("a&#99999999;b") === "a b");

    console.log("documents: reading around the chosen passages");
    const hit = (docId: number, ord: number, text: string, section = "MD&A", page = 0): Hit => ({ chunkId: docId * 1000 + ord, docId, ord, page, section, speaker: "", tStart: null, tEnd: null, text, title: `Doc ${docId}`, url: "", source: "sec", lang: "en", mime: "", fileId: null, ticker: "ET", score: 0 });
    check("two passages join without the words the second repeats", joinOverlap("Volumes rose in the quarter on higher demand", "on higher demand. Costs fell.") === "Volumes rose in the quarter on higher demand. Costs fell." && joinOverlap("First part.", "Second part.") === "First part.\nSecond part.");
    const chosen = [hit(1, 10, "A".repeat(500)), hit(2, 5, "B".repeat(500))];
    const around = [hit(1, 9, "a".repeat(400)), hit(1, 11, "c".repeat(400)), hit(1, 12, "d".repeat(400), "Risk factors"), hit(2, 4, "b".repeat(400)), hit(2, 6, "e".repeat(400)), hit(2, 8, "f".repeat(400))];
    const blocks = expand(chosen, around, 100_000);
    check("chosen passages widen through their section into one block each, best first", blocks.length === 2 && blocks[0].docId === 1 && blocks[0].chunks.map((c) => c.ord).join() === "9,10,11" && blocks[1].chunks.map((c) => c.ord).join() === "4,5,6" && blocks.map((b) => b.n).join() === "1,2", blocks.map((b) => [b.docId, b.chunks.map((c) => c.ord)]));
    const tight = expand(chosen, around, 1_500);
    check("widening stops at the budget, nearest neighbours of the best passage first", tight.reduce((s, b) => s + b.chunks.length, 0) === 3 && tight[0].chunks.map((c) => c.ord).join() === "9,10", tight.map((b) => b.chunks.map((c) => c.ord)));
    const blockChunks = [hit(1, 1, "Revenue rose 12% on higher volumes in the quarter."), hit(1, 2, "Margins narrowed as costs rose faster than prices.")];
    check("a quote is credited to the passage that holds it, or the first of two it runs across", quoteChunk("costs rose faster than prices", blockChunks) === 1 && quoteChunk("higher volumes in the quarter. Margins narrowed", blockChunks) === 0 && quoteChunk("revenue fell 12%", blockChunks) === -1);
    check("blocks are labelled with their pages or moment", blockLabel({ title: "Deck", section: "", chunks: [hit(3, 1, "x", "", 4), hit(3, 2, "y", "", 5)] }) === "Deck, pages 4-5" && blockLabel({ title: "Call", section: "", chunks: [{ ...hit(4, 1, "x", ""), tStart: 725, speaker: "Jane Doe, CFO" }] }) === "Call at 12:05, Jane Doe, CFO");
    const src = [hit(1, 1, "Early volumes from the Hugh Brinson Pipeline added $21 million in the quarter."), hit(1, 2, "Storage margin rose $31 million on price volatility.")];
    const ok = checkFound([{ claim: 1, n: 1, quote: "Early volumes from the Hugh Brinson Pipeline added $21 million" }, { claim: 2, n: 1, quote: "Storage margin rose $31 million" }, { claim: 2, n: 2, quote: "Storage margin rose $31 million" }, { claim: 3, n: 1, quote: "added $21 million" }, { claim: 1, n: 1, quote: "in the quarter. Storage margin rose" }], src, 2);
    check("a second reading's quotes are credited to the passage holding them (the next one when the words are there) and count only for claims asked about", ok.map((g) => `${g.claim}:${g.at.ord}`).join() === "1:1,2:2,2:2,1:1", ok.map((g) => [g.claim, g.at.ord, g.quote]));

    console.log("documents: rerankers");
    const docsIn = [{ id: 11, text: "Midstream volumes rose." }, { id: 12, text: "x".repeat(5000) }];
    const v = voyageRequest("What drove volumes?", docsIn, "vk", "rerank-3");
    const vb = JSON.parse(String(v.init.body)) as { query: string; documents: string[]; model: string; top_k: number; truncation: boolean };
    check("the Voyage request names the model, every passage (cut to about 500 tokens) and the key", v.url === VOYAGE_URL && (v.init.headers as Record<string, string>).authorization === "Bearer vk" && vb.model === "rerank-3" && vb.top_k === 2 && vb.truncation === true && vb.documents[1].length === 2000, vb);
    const co = cohereRequest("What drove volumes?", docsIn, "ck", "rerank-v4.0-pro");
    const cb = JSON.parse(String(co.init.body)) as { model: string; top_n: number; max_tokens_per_doc: number; documents: string[] };
    check("the Cohere request uses its v2 endpoint and fields", co.url === COHERE_URL && cb.model === "rerank-v4.0-pro" && cb.top_n === 2 && cb.max_tokens_per_doc === 512 && cb.documents.length === 2, cb);
    check("the ML service gets ids with the passages", JSON.stringify(mlInput("q", docsIn.slice(0, 1))) === '{"query":"q","passages":[{"id":11,"text":"Midstream volumes rose."}]}');
    const pv = parseVoyage({ object: "list", data: [{ relevance_score: 0.2, index: 1 }, { relevance_score: 0.9, index: 0 }, { index: "x" }], model: "rerank-3", usage: { total_tokens: 812 } });
    check("Voyage's answer is read as scores and tokens", pv.tokens === 812 && pv.scores.length === 2 && pv.scores[1].index === 0 && pv.scores[1].score === 0.9, pv);
    const pc = parseCohere({ id: "r", results: [{ index: 1, relevance_score: 0.7 }, { index: 0, relevance_score: 0.1 }], meta: { billed_units: { search_units: 1 } } });
    check("Cohere's answer is read as scores and searches", pc.searches === 1 && pc.scores[0].index === 1 && pc.scores[0].score === 0.7, pc);
    const pm = parseMl({ scores: [{ id: 12, score: 3.1 }, { id: 11, score: -1 }], model: "ettin-reranker-32m" });
    check("the ML service's answer is read as scores by id", pm.model === "ettin-reranker-32m" && pm.scores.map((s) => s.id).join() === "12,11", pm);
    let threw = 0;
    for (const bad of [null, {}, { data: "x" }]) { try { parseVoyage(bad); } catch { threw++; } try { parseCohere(bad); } catch { threw++; } try { parseMl(bad); } catch { threw++; } }
    check("malformed answers are refused, so the search order stands", threw === 9, threw);
    const cand = [1, 2, 3, 4].map((id) => ({ id, text: "" }));
    check("reranked ids go best first; unscored ones keep their search order after them", orderByScores(cand, [{ id: 3, score: 0.9 }, { id: 1, score: 0.2 }, { id: 3, score: 0.1 }, { id: 99, score: 1 }])?.join() === "3,1,2,4" && orderByScores(cand, []) === null);
    check("the selection reads the reranker's best and the search's own best", mergeForSelection([9, 8, 7, 6, 5], [1, 9, 2, 3], 5, 2).join() === "9,8,7,1,6" && mergeForSelection([1, 2], [2, 1], 30).join() === "1,2");
    const env = (vars: Record<string, string | undefined>, fn: () => void) => { const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]])); for (const [k, x] of Object.entries(vars)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; } try { fn(); } finally { for (const [k, x] of Object.entries(old)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; } } };
    env({ VOYAGE_API_KEY: "v", COHERE_API_KEY: "c", EDGE_ML_URL: "https://ml", EDGE_ML_SECRET: "s" }, () => check("a Voyage key wins, then Cohere, then the free reranker", rerankProvider() === "voyage"));
    env({ VOYAGE_API_KEY: undefined, COHERE_API_KEY: "c", EDGE_ML_URL: "https://ml", EDGE_ML_SECRET: "s" }, () => check("Cohere is used when Voyage is not set", rerankProvider() === "cohere"));
    env({ VOYAGE_API_KEY: undefined, COHERE_API_KEY: undefined, EDGE_ML_URL: "https://ml", EDGE_ML_SECRET: "s" }, () => check("the ML service's reranker is the free default", rerankProvider() === "ml"));
    env({ VOYAGE_API_KEY: undefined, COHERE_API_KEY: undefined, EDGE_ML_URL: undefined, EDGE_ML_SECRET: undefined }, () => check("with nothing set there is no reranker", rerankProvider() === null));
    env({ OPENAI_API_KEY: "k", EDGE_ANSWER_MODEL: " gpt-5.6-sol " }, () => check("EDGE_ANSWER_MODEL picks the answer model when that upgrade is on", answerModel() === "gpt-5.6-sol"));
    env({ OPENAI_API_KEY: "k", EDGE_ANSWER_MODEL: undefined }, () => check("without it the default answers", answerModel() === undefined));

    console.log("documents: retrieval eval");
    check("eval needles compare letters and digits only", squash("4.55 % Senior Notes") === squash("4.55% senior notes") && squash("$ 1.00") === squash("$1.00"));
    check("recall counts needles found in the first k passages, alternatives counting once", recallAt(["alpha beta", "gamma", "delta"], ["beta", ["zeta", "gamma"], "delta"], 2) === 2 / 3 && recallAt([], [], 5) === 1);
    check("reciprocal rank is one over the first relevant place", reciprocalRank(["a", "b", "target here"], ["target"]) === 1 / 3 && reciprocalRank(["a"], ["zzz"]) === 0);
  }

  {
    console.log("documents: tables keep their columns");
    const csv = "Metric,2023,2024,2025\nRevenue,,120,140\nCapex,30,,50".split("\n").map((l) => l.split(","));
    const cp = passagesFromPages([{ n: 1, text: "", tables: [csv] }]);
    check("a blank cell keeps its place, so later figures stay under their years", cp.length === 1 && cp[0].text === "Metric | 2023 | 2024 | 2025\nRevenue |  | 120 | 140\nCapex | 30 |  | 50", cp.map((p) => p.text));
    const g = gridRows([["Segment", "", "2026", "", "2025"], ["Midstream", "$", "3,164", "$", "2,910"], ["New segment", "", "", "$", "45"], ["Interest", "(", "934", ")", ""]]);
    check("symbol columns go, symbols join their figures, and a blank 2026 stays blank", g.map((r) => r.join("|")).join(";") === "Segment|2026|2025;Midstream|$3,164|$2,910;New segment||$45;Interest|(934)|", g);
    // Workiva: spacing cells close themselves, labels and figures span columns, headers span groups of them.
    const w = tableRows(`<table><tr><td colspan="3" /><td colspan="9"><span>Three Months Ended<br/>June 30,</span></td></tr><tr><td colspan="3" /><td colspan="3">2026</td><td colspan="3" /><td colspan="3">2025</td></tr>
      <tr><td colspan="3">Revenues</td><td>$</td><td colspan="2">531</td><td colspan="3" /><td>$</td><td colspan="2">819</td></tr><tr><td colspan="3">New line</td><td /><td colspan="2" /><td colspan="3" /><td>$</td><td colspan="2">45</td></tr></table>`);
    check("Workiva's self-closing cells and spans are read", w.length === 4 && w[2].length === 6 && (w[0][0] as { span: number }).span === 3 && (w[2][2] as { text: string }).text === "531", w);
    check("spanning headers sit over the first column of their group", gridRows(w).map((r) => r.join("|")).join(";") === "|Three Months Ended June 30,|;|2026|2025;Revenues|$531|$819;New line||$45", gridRows(w));
    check("one row on its own is still tidied", cleanRow(["Midstream", "", "$", "3,164", "", "( 934", ")", "12", "%"]).join("|") === "Midstream|$3,164|(934)|12%");
    const lab = tableParts([["", "2026", "2025"], ["Revenues:", "", ""], ["Midstream", "531", "819"], ["Costs", "400", "500"]]);
    check("a label row such as 'Revenues:' ends the header, it is not repeated as one", lab[0]?.kind === "table" && lab[0].head === 1, lab);

    console.log("documents: pages of short lines, page numbers, long rows");
    check("a page number is taken off a page's first or last line only", dropPageNumber("Revenue grew.\n\n41", 41).trim() === "Revenue grew." && dropPageNumber("41\nRevenue grew.").trim() === "Revenue grew." && dropPageNumber("Employees\n\n450\n\nCountries").includes("450"));
    check("a last line far from the page's own number is a figure, not a page number", dropPageNumber("Countries\n\n12", 3).includes("12") && !dropPageNumber("Countries\n\n12", 12).includes("12"));
    const slides = passagesFromPages([{ n: 2, text: "2026 Guidance\n\nAdjusted EBITDA $16.1–16.5 Billion\n\nGrowth Capital ~$5.0 Billion" }, { n: 3, text: "Company Snapshot\n\nEmployees\n\n450\n\nCountries\n\n12" }, { n: 4, text: "Project Falcon Management Presentation" }]);
    check("slides and pages of short lines are indexed, figures and all", slides.length === 3 && slides[0].text === "2026 Guidance\nAdjusted EBITDA $16.1–16.5 Billion\nGrowth Capital ~$5.0 Billion" && slides[1].text.includes("450") && slides[1].text.includes("12") && slides[2].text === "Project Falcon Management Presentation" && slides.map((s) => s.page).join() === "2,3,4", slides.map((s) => [s.page, s.text]));
    const items = passagesFromParts([{ kind: "heading", text: "PART I" }, { kind: "heading", text: "ITEM 1B. UNRESOLVED STAFF COMMENTS", section: "Unresolved staff comments" }, { kind: "heading", text: "None" }, { kind: "heading", text: "ITEM 1C. CYBERSECURITY", section: "Other item" }, { kind: "text", text: "We assess risks." }]);
    check("an item that says only 'None' is a passage of its own, and 'PART I' joins the item after it", items.map((p) => `${p.section}=${p.text.replace(/\n/g, "/")}`).join(";") === "Unresolved staff comments=PART I/ITEM 1B. UNRESOLVED STAFF COMMENTS/None;Other item=ITEM 1C. CYBERSECURITY/We assess risks.", items);
    const wide = ["Footnote", ...Array.from({ length: 60 }, (_, i) => `cell ${i} ${"x".repeat(60)}`)];
    const lines = rowLines(wide.join(" | "), 1000);
    check("a row too long for a passage continues on further lines, no cell lost", lines.length >= 4 && lines.every((l) => l.length <= 1000) && wide.every((c) => lines.some((l) => l.includes(c))), lines.map((l) => l.length));
    const longTable = chunkParts([{ kind: "table", rows: [["Name", "Note"], ["Long", "y".repeat(5000)]], head: 1 }]);
    check("a cell longer than a passage is split across passages, every character kept", longTable.every((p) => p.text.length <= P_MAX) && longTable.map((p) => p.text).join("").replace(/[^y]/g, "").length === 5000, longTable.map((p) => p.text.length));

    console.log("documents: filing HTML, odd layouts");
    const smallT = partsFromHtml(`<table><tr><td>Item 1A.</td><td>Risk Factors</td></tr></table><p>We face risks.</p>`);
    check("an item heading set out as a small table starts its section", smallT[0]?.kind === "heading" && (smallT[0] as { section?: string }).section === "Risk factors" && smallT[1]?.kind === "text", smallT);
    check("a table that leaves out its end tags is still read", JSON.stringify(partsFromHtml("<table><tr><td>Revenue<td>$100</tr><tr><td>Costs<td>$40</table>")) === JSON.stringify([{ kind: "table", rows: [["Revenue", "$100"], ["Costs", "$40"]], head: 0 }]), partsFromHtml("<table><tr><td>Revenue<td>$100</tr><tr><td>Costs<td>$40</table>"));
    check("a table with no cells is read as text", JSON.stringify(partsFromHtml("<table>Loose words in a table</table>")) === JSON.stringify([{ kind: "text", text: "Loose words in a table" }]));
    const lay = partsFromHtml(`<p>(in millions)</p><table><tr><td>•</td><td>${"Long bullet text that runs on and on about the business ".repeat(3)}</td></tr></table>`);
    check("a units line is put back when the table turns out to be layout", lay[0]?.kind === "text" && (lay[0] as { text: string }).text === "(in millions)" && lay.length === 2, lay);
    const paged = partsFromHtml(`<p>Revenue rose.</p><p>41</p><hr style="page-break-after:always"/><p><a href="#toc">Table of Contents</a></p><p>Employees</p><p>450</p><p>Countries</p>`);
    check("a page number at a page break goes; a figure standing alone mid-page stays", paged.map((p) => (p as { text: string }).text).join("|") === "Revenue rose.|Employees|450|Countries", paged);

    console.log("documents: reranking on the ML service, the second reading, transcripts");
    const many = Array.from({ length: 100 }, (_, i) => ({ id: i, text: "w".repeat(1800) }));
    const mi = mlInput("What drove volumes?", many);
    check("the free reranker gets the best 40 candidates, about 1,000 characters each, and 8 seconds", ML_PASSAGES === 40 && ML_CHARS === 1000 && ML_TIMEOUT_MS === 8_000 && mi.passages.length === 40 && mi.passages.every((p) => p.text.length === 1000) && mi.passages[39].id === 39);
    const live = parseMl({ scores: [{ id: 2195, score: 7.25 }, { id: 2194, score: -3.5 }], model: "cross-encoder/ettin-reranker-32m-v1", maxLength: 256, truncated: 3 });
    check("the live reranker's answer is read (extra fields ignored) and its model named briefly", live.scores.map((s) => s.id).join() === "2195,2194" && live.model === "cross-encoder/ettin-reranker-32m-v1" && shortModel(live.model) === "ettin-reranker-32m-v1", live);
    const nowR = 1_000_000;
    check("the second reading gets half of what is left after 20 seconds, and is skipped under 15", rereadBudget(nowR + 80_000, nowR) === 30_000 && rereadBudget(nowR + 49_000, nowR) === null && rereadBudget(nowR + 50_000, nowR) === 15_000);
    check("a Parakeet transcript carries NVIDIA's credit", transcriptionOf({ engine: "parakeet", model: "nvidia/parakeet-tdt-0.6b-v2" })?.credit === PARAKEET_CREDIT && PARAKEET_CREDIT === "Speech recognition: NVIDIA Parakeet TDT 0.6B v2 (CC BY 4.0)");
    check("a Whisper transcript names its model, a fallback is kept, and silence is null", transcriptionOf({ engine: "whisper", model: "small", fallback: "parakeet failed" })?.credit === "Speech recognition: Whisper (small)" && transcriptionOf({ engine: "whisper", model: "small", fallback: "parakeet failed" })?.fallback === "parakeet failed" && transcriptionOf({}) === null && transcriptionOf(null) === null);
  }

  {
    console.log("Flaring");
    const csv = [
      "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight",
      "31.8100,-103.9020,330.1,0.4,0.4,2026-09-24,0739,N21,nominal,2.0NRT,290.1,2.5,N",
      "31.8105,-103.9015,331.0,0.4,0.4,2026-09-26,0654,N20,high,2.0NRT,291.0,1.5,N",
      "31.8098,-103.9030,329.0,0.4,0.4,2026-09-26,0820,N,low,2.0NRT,289.0,0.8,N",
      "31.8090,-103.9010,329.0,0.4,0.4,2026-09-28,0739,N21,nominal,2.0NRT,289.0,1.2,N",
      "31.9000,-103.9020,329.0,0.4,0.4,2026-09-28,0739,N21,nominal,2.0NRT,289.0,9.0,N",
      "40.0000,-90.0000,330.0,0.4,0.4,2026-09-28,0739,N21,nominal,2.0NRT,289.0,3.0,N",
    ].join("\n");
    const spots = parseFirmsCsv(csv, [-104.6, 30.4, -100.4, 33.9]);
    check("a FIRMS file is read with satellites and confidence named, and only the mapped box kept", spots.length === 5 && spots[0].sat === "NOAA-21" && spots[1].conf === "high" && spots[2].sat === "Suomi NPP" && spots[0].night, spots.slice(0, 3));
    const near = spotsNear(spots, -103.902, 31.81);
    check("hot spots count when within 1.5 km of the plant, nearest first (one 10 km north is left out)", near.length === 4 && near[0].m <= near[3].m && near.every((x) => x.m < 1500), near.map((x) => x.m));
    const days = byDay(near, "2026-09-30");
    const st = flareStats(near, days);
    check("a week of days, zero-filled, with heat by day", days.length === 7 && days[0].date === "2026-09-24" && days[2].n === 2 && days[2].frp === 2.3 && days[6].n === 0, days);
    check("the week's numbers: four hot spots on three days from three satellites", st.detections === 4 && st.days === 3 && st.satellites === 3 && st.high === 1 && st.frpTotal === 6 && st.frpMax === 2.5, st);
    check("three days of flaring make a card; one day does not; two hot days do", flares(st) && !flares({ ...st, days: 1, frpTotal: 50 }) && flares({ ...st, days: 2, frpTotal: 20 }));
    const c0 = flareConfidence(st, 0), c1 = flareConfidence(st, 6), cFar = flareConfidence({ ...st, nearestM: 1300 }, 0);
    check("a hot Sentinel-2 image raises confidence and heat only at the edge lowers it, within 0.2 to 0.95", c1 > c0 && cFar < c0 && c1 <= 0.95 && cFar >= 0.2, { c0, c1, cFar });
    check("magnitude grows with days and heat, capped at 1", flareMagnitude({ ...st, days: 7, frpTotal: 100 }) === 1 && flareMagnitude(st) < flareMagnitude({ ...st, days: 6 }));
    const nowF = Date.parse("2026-09-30T12:00:00Z");
    check("a chronic flare within two weeks is not news again unless it gets worse", repeats({ at: "2026-09-23T12:00:00Z", days: 3, frp: 6 }, st, nowF) && !repeats({ at: "2026-09-23T12:00:00Z", days: 1, frp: 2 }, st, nowF) && !repeats({ at: "2026-09-01T12:00:00Z", days: 3, frp: 6 }, st, nowF) && !repeats(null, st, nowF));
    check("ISO weeks, across a new year", isoWeek("2026-09-30") === "2026-W40" && isoWeek("2027-01-01") === "2026-W53" && isoWeek("2026-01-01") === "2026-W01", [isoWeek("2026-09-30"), isoWeek("2027-01-01"), isoWeek("2026-01-01")]);
    const h = withWeek(withWeek([{ week: "2026-W38", days: 1, frp: 2 }], { week: "2026-W40", days: 3, frp: 6 }), { week: "2026-W40", days: 4, frp: 7 });
    check("the weekly record keeps one entry a week, in order", h.length === 2 && h[1].days === 4 && h[0].week === "2026-W38");
    // Bands as stored (reflectance x 10000 + 1000): a flare pixel, a bright roof (both bands high), and plain ground.
    check("a hot pixel is band 12 far above band 11; a bright roof or plain ground is not", hotPixels([14000, 9000, 5200], [6000, 8800, 4800]) === 1 && hotPixels([14000], [6000], [0]) === 0);
    const rows = [
      { id: "f1", name: "Gathering A", type: "Natural Gas Gathering System - (GGS)", ogrid_name: "Op A", latitude: 32.010, longitude: -103.300, details: "https://x/1", reporting_period: 202608, waste_type: "F", volume: 1000 },
      { id: "f1", name: "Gathering A", type: "Natural Gas Gathering System - (GGS)", ogrid_name: "Op A", latitude: 32.010, longitude: -103.300, details: "https://x/1", reporting_period: 202608, waste_type: "V", volume: 50 },
      { id: "f1", name: "Gathering A", type: "Natural Gas Gathering System - (GGS)", ogrid_name: "Op A", latitude: 32.010, longitude: -103.300, details: "https://x/1", reporting_period: 202607, waste_type: "F", volume: 9999 },
      { id: "f2", name: "Far away", type: "Tank Battery - (TB)", ogrid_name: "Op B", latitude: 32.200, longitude: -103.300, details: "https://x/2", reporting_period: 202608, waste_type: "F", volume: 500 },
    ];
    const rep = summariseReports(rows, -103.30, 32.0, 3);
    check("New Mexico's reports: the newest month only, summed by facility, within the radius", !!rep && rep.period === "2026-08" && rep.flaredMcf === 1000 && rep.ventedMcf === 50 && rep.facilities.length === 1 && rep.facilities[0].type === "Natural Gas Gathering System", rep);
    check("a week-long confident flare interrupts its watchers; a short one waits for the digest", isBig({ kind: "flaring", confidence: 0.8, magnitude: 0.7, visual: {} }) && !isBig({ kind: "flaring", confidence: 0.8, magnitude: 0.3, visual: {} }));
    const wins = archiveWindows("2026-09-30");
    check("the archive is read in ten-day windows over the twelve weeks before the seven-day files", wins.length === 9 && wins[0][0] === "2026-07-02" && wins[8][0] === "2026-09-20" && wins[8][1] === 4 && wins.every(([, d]) => d >= 1 && d <= 10) && wins.reduce((t, [, d]) => t + d, 0) === 84, wins);
    const wk = weeksFrom(near);
    check("past detections become weeks with days of heat", wk.length === 2 && wk[0].week === "2026-W39" && wk[0].days === 2 && wk[1].week === "2026-W40" && wk[1].days === 1, wk);
    check("flaring ranks as rarely reported news", noveltyOf("flaring", 0) > noveltyOf("deal_proforma", 0) && noveltyOf("flaring", 0) < noveltyOf("ground_change", 0));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
