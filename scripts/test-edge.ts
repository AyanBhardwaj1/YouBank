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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
