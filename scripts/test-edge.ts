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
import { quoteFound as answerQuoteFound } from "@/lib/edge/docs/answer";
import { passagesFromFiling, passagesFromPages, passagesFromTranscript, sectionText, splitText, tableText } from "@/lib/edge/docs/chunk";
import { fuse } from "@/lib/edge/docs/retrieve";
import { diffSections, paragraphs } from "@/lib/edge/docs/changes";
import { kmeans, pca2 } from "@/lib/edge/docs/topics";
import { keepNarrative } from "@/lib/edge/docs/sources";
import { mimeOf } from "@/lib/edge/docs/uploads";
import { bySpeaker, toneOf, toneShift, turnAt, type Turn } from "@/lib/edge/docs/tone";
import { filingMagnitude, filingTitle } from "@/lib/edge/docs/filingwatch";
import { fitToSchema } from "@/lib/ai/fit";
import { exhibit21Href, holdingPercent, isDealVehicle, normName, parseExhibit21, parseForm4, parseHeader, personName, relationParagraphs, titleCase } from "@/lib/edge/graph/parse";
import { eventFlags, exposure as exposureRank, insiderFlags, interlocks, ownershipCycles, reasonPaths } from "@/lib/edge/graph/algo";
import { companyFeatures, scorecardText, splitDateFor } from "@/lib/edge/graph/train";
import { pairsFromHits, sameGroup } from "@/lib/edge/graph/deals";
import { linkSentence } from "@/lib/edge/graph/findings";
import { autocorr, cholesky, correlation, kurtosis, ks, mean as smean, normCdf, normInv, normals, ols, quantile, realism, rng, std as sstd } from "@/lib/edge/scen/stats";
import { bootstrapGen, fitGarch, fitRegimes, garchGen, simulate } from "@/lib/edge/scen/models";
import { describeShock, parseShock } from "@/lib/edge/scen/drivers";
import { copulaSynth, fillGaps, identifiers, tableRealism, type TableIn } from "@/lib/edge/scen/tables";
import { parseCsv } from "@/lib/edge/scen/run";
import { eiaDaily, frenchColumns } from "@/lib/edge/scen/data";
import { isBig } from "@/lib/edge/notify";
import { digestDue, digestEmail } from "@/lib/edge/digest";
import { parseCommand } from "@/lib/functions";
import { simRequest, whatIfFrom, whatIfUrl } from "@/lib/edge/links";
import { pushPatches } from "@/lib/edge/push";
import { studioTarget } from "@/lib/edge/canvas/executors/studio";
import type { StudioDocData } from "@/lib/studio/types";
import { peopleAt, plainRegistrant } from "@/lib/edge/crm";
import { introBrief } from "@/lib/edge/intros";
import { cellSize, components, densify, levelling, maskFromOverlay, parseNpy, profileStats, quantileSorted, rankBelow, readSite, sampleGrid, slopeDegrees, type Grid } from "@/lib/edge/terrain";
import { hexagon, positionWords } from "@/lib/edge/terrain-view";
import { overlayPng, type ChangeResult } from "@/lib/edge/change";
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
    check("the scorecard says how often the real buyer was in the top five", scorecardText({ gnn: { hits5: 0.55, hits10: 0.7, mrr: 0.3, n: 40, asTarget: { hits5: 0.55, n: 20 } }, baseline: { hits5: 0.2, hits10: 0.3, mrr: 0.1, n: 40, asTarget: { hits5: 0.2, n: 20 } } }, "acquirers") === "In a backtest on the 20 most recent deals, the actual buyer was among its top 5 likely buyers for 11 of 20 (a simple baseline: 4 of 20)." && scorecardText(null, "targets") === "Not backtested yet.");
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
