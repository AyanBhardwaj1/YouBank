/**
 * Checks for Edge: satellite change detection on synthetic scenes, the deal screen, party matching,
 * watches, feed ranking, the audit trail and the beta gate. No network, no database.
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
