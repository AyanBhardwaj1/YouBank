/**
 * Checks for the premium features: the registry (every feature priced, every keyed upgrade tied to one,
 * nothing left unbuilt), the premium scope (background work gets the free method, a locked feature is a
 * 402 before anything is spent), and the pure pieces behind each upgrade: Citations' spans, audio
 * cutting for speaker labels, LlamaParse's Markdown, diarized transcripts, Nightfire's volumes, TimesFM's
 * query and the free forecast. No network, no database.
 *   pnpm exec tsx scripts/test-premium.ts
 */
import { FEATURES, featureById } from "@/lib/billing/features";
import { PREMIUM_FEATURES } from "@/lib/billing/features/premium";
import { PremiumRequiredError } from "@/lib/billing/entitlements";
import { PLAN_ORDER, isPlanId } from "@/lib/billing/plans";
import { allowedOf, premiumInScope, premiumOn, withFeatures } from "@/lib/billing/use";
import { deepModel, DEEP_MAX_TURNS, DEEP_PROTOCOL } from "@/lib/ai/deep";
import { askWants } from "@/lib/edge/docs/answer";
import { paidOn, UPGRADES, upgradesView } from "@/lib/edge/premium";
import { firstMp3Frame, mp3FrameLength, pieceBytes, planPieces, wavHeader, wavInfo, WHOLE_MAX_BYTES, PIECE_BYTES } from "@/lib/edge/premium/audio";
import { citationSystem, claimsOf, NOT_FOUND, piecesOf } from "@/lib/edge/premium/citations";
import { mergePieces, parseDiarized, turnsOf } from "@/lib/edge/premium/diarize";
import { llamaCost, parseLlamaJob, partsFromMarkdown } from "@/lib/edge/premium/llamaparse";
import { lastNights, mwToMmcfd, nightOf, parseVnf, volumesNear } from "@/lib/edge/premium/nightfire";
import { readMismatch } from "@/lib/edge/premium/reading";
import { driftForecast, forecastSql, parseForecastRows, weeklyLevel } from "@/lib/edge/premium/timesfm";
import type { FactorRow } from "@/lib/edge/scen/data";
import { isPlanError } from "@/components/billing/PlanNotice";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const env = (vars: Record<string, string | undefined>, fn: () => void) => {
  const old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, x] of Object.entries(vars)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; }
  try { fn(); } finally { for (const [k, x] of Object.entries(old)) { if (x === undefined) delete process.env[k]; else process.env[k] = x; } }
};

async function main() {
  console.log("the registry");
  const ids = PREMIUM_FEATURES.map((f) => f.id);
  check("feature ids are unique across every area", new Set(FEATURES.map((f) => f.id)).size === FEATURES.length, ids);
  check("each id is area.name and names its area", PREMIUM_FEATURES.every((f) => /^[a-z]+\.[a-z0-9-]+$/.test(f.id) && f.id.split(".")[0] === f.area), ids.filter((id) => !/^[a-z]+\./.test(id)));
  check("each needs a real plan above Free", PREMIUM_FEATURES.every((f) => isPlanId(f.minPlan) && PLAN_ORDER.indexOf(f.minPlan) > 0));
  check("metered features carry a cost per use and what a use is; perks cost nothing", PREMIUM_FEATURES.every((f) => (f.metered ? (f.costPerUseUsd ?? 0) > 0 && !!f.perUse : f.costPerUseUsd === 0)), PREMIUM_FEATURES.filter((f) => f.metered && !f.costPerUseUsd).map((f) => f.id));
  check("descriptions are one plain sentence", PREMIUM_FEATURES.every((f) => f.description.length < 200 && /\.$/.test(f.description)));
  check("every keyed upgrade is built", UPGRADES.every((u) => u.built), UPGRADES.filter((u) => !u.built).map((u) => u.id));
  check("every upgrade's feature is registered", UPGRADES.every((u) => !u.feature || !!featureById(u.feature)), UPGRADES.filter((u) => u.feature && !featureById(u.feature)).map((u) => u.id));
  check("the paid documents upgrades all name a feature", ["rerank-voyage", "rerank-cohere", "answer-model", "transcribe-openai", "parse-llamaparse", "citations-anthropic"].every((id) => UPGRADES.find((u) => u.id === id)?.feature));
  check("free keys and budgets stay platform settings", ["firms-archive", "modal-budget", "docs-storage"].every((id) => !UPGRADES.find((u) => u.id === id)?.feature));

  console.log("the premium scope");
  check("outside a scope nothing premium is on (crons, monitors, prefetches)", !premiumOn("edge.rerank") && premiumInScope().length === 0);
  check("inside one, exactly its features", withFeatures(["edge.rerank"], () => premiumOn("edge.rerank") && !premiumOn("edge.citations")));
  const later = await withFeatures(["ai.deep-research"], async () => { await new Promise((r) => setTimeout(r, 5)); return premiumOn("ai.deep-research"); });
  check("the scope follows async work across awaits", later && !premiumOn("ai.deep-research"));
  const pro = { features: PREMIUM_FEATURES.filter((f) => f.minPlan === "pro").map((f) => f.id) };
  check("automatic features are kept when the plan has them, dropped when not", allowedOf(pro, { auto: ["edge.rerank", "relationships.autopilot"] }).join() === "edge.rerank");
  let refused: unknown = null;
  try { allowedOf({ features: [] }, { auto: ["edge.rerank"], require: ["edge.citations"] }); } catch (e) { refused = e; }
  check("a feature asked for that the plan lacks is a 402 naming the plan, before any work", refused instanceof PremiumRequiredError && refused.status === 402 && /Exact-span citations is part of the Pro plan\. Upgrade in Settings/.test(refused.message), (refused as Error)?.message);
  check("the client recognises that message as a plan refusal, not a crash", isPlanError(refused) && isPlanError((refused as Error).message) && !isPlanError(new Error("Something went wrong on our side (ref 1a2b)")));
  check("an unknown feature is a programming error, not a plan message", (() => { try { allowedOf({ features: [] }, { require: ["edge.nope"] }); return false; } catch (e) { return !(e instanceof PremiumRequiredError); } })());
  check("a question asks for reranking on its own and the rest only when ticked", JSON.stringify(askWants(undefined)) === JSON.stringify({ auto: ["edge.rerank"], require: [] }) && askWants({ model: true, citations: true }).require.join() === "edge.answer-model,edge.citations");

  console.log("upgrades by plan");
  env({ VOYAGE_API_KEY: "secret-v", ANTHROPIC_API_KEY: "secret-a", EDGE_CITATIONS: "anthropic" }, () => {
    check("a keyed upgrade runs only inside a scope that holds its feature", !paidOn("rerank-voyage") && withFeatures(["edge.rerank"], () => paidOn("rerank-voyage")) && withFeatures(["edge.citations"], () => paidOn("citations-anthropic")));
    check("a platform setting needs no plan", !UPGRADES.find((u) => u.id === "docs-storage")?.feature);
    const person = upgradesView({ features: ["edge.rerank"], admin: false });
    const admin = upgradesView({ features: FEATURES.map((f) => f.id), admin: true });
    const voyage = person.find((u) => u.id === "rerank-voyage")!;
    check("a person sees plan status per upgrade and never its settings or steps", voyage.plan?.unlocked === true && voyage.ready && person.every((u) => !u.setup) && !JSON.stringify(person).includes("VOYAGE_API_KEY"));
    check("a locked upgrade names the plan that includes it", person.find((u) => u.id === "citations-anthropic")?.plan?.planName === "Pro" && person.find((u) => u.id === "citations-anthropic")?.plan?.unlocked === false);
    check("administrators get the settings by name, never their values", admin.every((u) => !!u.setup) && JSON.stringify(admin).includes("VOYAGE_API_KEY") && !JSON.stringify(admin).includes("secret-v"));
  });

  console.log("deep research");
  env({ AI_DEEP_MODEL: undefined, AI_PROVIDER: undefined, AI_ALLOWED_MODELS: undefined }, () => {
    check("deep runs use the flagship of the person's provider", deepModel({ model: "gpt-5.6-luna" }) === "gpt-6-astra" && deepModel({ model: "claude-sonnet-5" }) === "claude-fable-5-1" && deepModel(null) === "gpt-6-astra");
  });
  env({ AI_DEEP_MODEL: "gpt-5.5-pro", AI_ALLOWED_MODELS: undefined }, () => check("AI_DEEP_MODEL overrides it", deepModel(null) === "gpt-5.5-pro"));
  env({ AI_DEEP_MODEL: undefined, AI_PROVIDER: undefined, AI_ALLOWED_MODELS: "gpt-5.6-luna" }, () => check("a flagship outside AI_ALLOWED_MODELS is not used", deepModel({ model: "gpt-5.6-luna" }) === undefined));
  check("more steps and a verification protocol", DEEP_MAX_TURNS === 30 && /second source/.test(DEEP_PROTOCOL) && /Not verified/.test(DEEP_PROTOCOL));

  console.log("Anthropic Citations");
  const pieces = piecesOf([
    { type: "text", text: "Volumes rose 12% on the year. ", citations: null },
    { type: "text", text: "Gathering volumes reached 2.1 Bcf/d", citations: [{ type: "char_location", cited_text: "gathering volumes of 2.1 Bcf/d", document_index: 1, start_char_index: 40, end_char_index: 70 }] },
    { type: "text", text: ".", citations: null },
    { type: "text", text: "Management expects further growth next year.", citations: [{ type: "page_location", cited_text: "x", document_index: 0 }] },
    { type: "thinking", text: "ignored" },
  ]);
  check("text blocks become pieces; only plain-text spans are kept", pieces.length === 4 && pieces[1].spans[0].passage === 1 && pieces[1].spans[0].quote === "gathering volumes of 2.1 Bcf/d" && pieces[3].spans.length === 0, pieces);
  const strict = claimsOf(pieces, "strict"), balanced = claimsOf(pieces, "balanced");
  check("the uncited opening is the direct answer; a stray full stop joins the claim before it", strict.direct === "Volumes rose 12% on the year." && strict.claims[0].text === "Gathering volumes reached 2.1 Bcf/d.", strict);
  check("strict drops uncited statements; balanced keeps them as analysis", strict.claims.length === 1 && balanced.claims.length === 2 && balanced.claims[1].analysis && balanced.claims[1].spans.length === 0, balanced);
  check("the instructions say how to say not found", citationSystem("strict").includes(NOT_FOUND) && /Analysis:/.test(citationSystem("balanced")));

  console.log("speaker labels: cutting audio");
  const frame = (len: number) => { const f = new Uint8Array(len); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; f[3] = 0x00; return f; };
  check("an MPEG-1 Layer III frame at 128 kbps and 44.1 kHz is 417 bytes", mp3FrameLength(frame(417), 0) === 417 && mp3FrameLength(new Uint8Array([0xff, 0xfb, 0xf0, 0]), 0) === 0);
  const junk = new Uint8Array([1, 2, 0xff, 0xfb, 7, 9]);
  const stream = new Uint8Array(junk.length + 417 * 2);
  stream.set(junk); stream.set(frame(417), junk.length); stream.set(frame(417), junk.length + 417);
  check("a piece starting mid-frame skips to the first whole frame (a false sync is not taken)", firstMp3Frame(stream) === junk.length && pieceBytes({ index: 1, start: 0, end: stream.length, kind: "mp3" }, stream).length === 834);
  check("the first piece keeps its start (ID3 tags and all)", pieceBytes({ index: 0, start: 0, end: stream.length, kind: "mp3" }, stream).length === stream.length);
  const fmt = new Uint8Array(16); new DataView(fmt.buffer).setUint16(0, 1, true); new DataView(fmt.buffer).setUint16(2, 1, true); new DataView(fmt.buffer).setUint32(4, 16000, true); new DataView(fmt.buffer).setUint32(8, 32000, true); new DataView(fmt.buffer).setUint16(12, 2, true); new DataView(fmt.buffer).setUint16(14, 16, true);
  const head = wavHeader(fmt, 30 * 1024 * 1024);
  const w = wavInfo(head, head.length + 30 * 1024 * 1024);
  check("a WAV header is read back: format, where samples start, sample size", !!w && w.dataStart === 44 && w.blockAlign === 2 && w.dataBytes === 30 * 1024 * 1024, w);
  const wp = planPieces(head.length + 30 * 1024 * 1024, "audio/wav", "call.wav", head)!;
  check("a long WAV is cut on whole samples, each piece under the limit", wp.length === 3 && wp.every((p) => p.end - p.start <= PIECE_BYTES && (p.start - 44) % 2 === 0) && wp[2].end === head.length + 30 * 1024 * 1024, wp);
  const wav = pieceBytes(wp[1], new Uint8Array(100), w);
  check("each WAV piece gets its own header", wavInfo(wav, wav.length)?.dataBytes === 100);
  check("a long MP3 is cut into pieces; a small file of any kind goes whole", planPieces(50 * 1024 * 1024, "audio/mpeg", "a.mp3", new Uint8Array())!.length === 5 && planPieces(10 * 1024 * 1024, "audio/mp4", "a.m4a", new Uint8Array())![0].kind === "whole");
  check("a long M4A cannot be cut, so it stays on the free path", planPieces(WHOLE_MAX_BYTES + 1, "audio/mp4", "a.m4a", new Uint8Array()) === null);
  check("readers refuse files they do not suit, in plain words", !!readMismatch("llamaparse", { mime: "audio/mpeg", name: "a.mp3", bytes: 10 }) && !!readMismatch("diarize", { mime: "application/pdf", name: "a.pdf", bytes: 10 }) && readMismatch("llamaparse", { mime: "application/pdf", name: "cim.pdf", bytes: 10 }) === null && !!readMismatch("diarize", { mime: "audio/mp4", name: "a.m4a", bytes: 90 * 1024 * 1024 }));

  console.log("speaker labels: transcripts");
  const p1 = parseDiarized({ duration: 600, segments: [{ start: 0, end: 4, text: "Good morning.", speaker: "A" }, { start: 4, end: 9, text: "Thanks, operator.", speaker: "B" }, { start: 9, end: 12, text: " ", speaker: "B" }] });
  const p2 = parseDiarized({ duration: 300, segments: [{ start: 1, end: 5, text: "Next question.", speaker: "A" }] });
  const merged = mergePieces([p1, p2]);
  check("empty segments are dropped and later pieces run on in time", p1.segments.length === 2 && merged[2].start === 601 && merged[2].label === "1:A" && merged[0].label === "0:A", merged);
  check("consecutive segments of one voice are one turn", turnsOf([...merged, { ...merged[2], start: 700 }]).map((t) => t.label).join() === "0:A,0:B,1:A");

  console.log("LlamaParse");
  check("a job is read whether its fields are on top or under job", parseLlamaJob({ id: "j1", status: "pending" }).status === "PENDING" && parseLlamaJob({ job: { id: "j2", status: "COMPLETED" }, markdown: { pages: [{ page_number: 3, markdown: "# Hi" }, { page_number: 4, markdown: "x", success: false }] } }).pages.map((p) => p.n).join() === "3");
  check("an answer without a job id is refused", (() => { try { parseLlamaJob({}); return false; } catch { return true; } })());
  const md = partsFromMarkdown("# Summary of terms\n\nThe **purchase price** is $1.2 billion.\n\n| Item | 2025 | 2024 |\n|---|---:|---:|\n| Revenue | 410 | 380 |\n| EBITDA | 120 | 101 |\n\n- First risk\n- Second risk\n\n<table><tr><th>A</th><th>B</th></tr><tr><td>Rev</td><td>1</td></tr></table>");
  const kinds = md.map((p) => p.kind).join();
  const table = md.find((p) => p.kind === "table") as { rows: string[][]; head: number } | undefined;
  check("Markdown becomes headings, paragraphs, tables and list items", kinds.startsWith("heading,text,table,text,text") && md.filter((p) => p.kind === "table").length === 2, kinds);
  check("a pipe table keeps its rows and header, with emphasis dropped from the text", !!table && table.rows.length === 3 && table.rows[1].join("|") === "Revenue|410|380" && table.head >= 1 && md[1].kind === "text" && !("text" in md[1] && md[1].text.includes("**")), table);
  check("LlamaParse cost: 50 pages on the agentic tier is $0.625", Math.abs(llamaCost(50, "agentic") - 0.625) < 1e-9 && llamaCost(10, "fast") < llamaCost(10, "agentic"));

  console.log("Nightfire");
  const csv = "id_Key,Date_Mscan,Lat_GMTCO,Lon_GMTCO,Temp_BB,RH\n1,20261001-0830,31.900,-103.500,1800,5.2\n2,20261001-0831,31.901,-103.501,1750,4.8\n3,20261001-0832,31.95,-103.5,900,9\n4,20261001-0833,45,-100,1800,3\n";
  const dets = parseVnf(csv, "npp", [[-104.5, 31, -101, 33]]);
  check("ez CSV rows are read by column name; cool fires and places outside the regions are dropped", dets.length === 2 && dets[0].tempK === 1800, dets);
  check("EOG's calibration: 1 MW is about 2.65 MMcf/d", Math.abs(mwToMmcfd(1) - 2.651) < 0.01);
  const v = volumesNear([...dets, { lon: -103.5, lat: 31.9, tempK: 1700, rhMw: 6, at: "20261002-0830", sat: "j01" }], -103.5, 31.9, 7);
  check("passes on one night are averaged, then over every night read; a flare is one group", v.flares.length === 1 && v.nightsSeen === 2 && Math.abs(v.avgRhMw - (5 + 6) / 7) < 0.001 && v.mmcfd > 0, v);
  {
    // EOG's files write Date_Mscan with separators; nights must still be told apart.
    const at = (day: string) => ({ lon: -103.5, lat: 31.9, tempK: 1700, rhMw: 7, at: `2026/10/${day} 08:30:12.345`, sat: "npp" });
    const s = volumesNear([at("01"), at("02"), at("03")], -103.5, 31.9, 7);
    check("nights are told apart whatever the date's separators", nightOf("2026/10/01 08:30:12.345") === "20261001" && nightOf("20261001-0830") === "20261001" && s.nightsSeen === 3 && Math.abs(s.avgRhMw - 3) < 0.001, s);
  }
  check("nothing near is no volume", volumesNear(dets, -100, 40, 7).detections === 0 && volumesNear(dets, -100, 40, 7).mmcfd === 0);
  check("the nights looked at end yesterday", lastNights(2, new Date("2026-10-05T12:00:00Z")).join() === "20261004,20261003");

  console.log("TimesFM and the free forecast");
  const rows: FactorRow[] = [];
  for (let i = 0; i < 900; i++) { const d = new Date(Date.UTC(2023, 0, 2) + i * 86_400_000); if (d.getUTCDay() % 6 === 0) continue; rows.push({ date: d.toISOString().slice(0, 10), market: 0.0004, energy: 0, oil: i % 2 ? 0.01 : -0.009, gas: 0, rates: 0.001 }); }
  const weeks = weeklyLevel(rows, "oil");
  check("daily moves become one level a week, on the week's last trading day", weeks.length > 120 && weeks.every((w) => [1, 2, 3, 4, 5].includes(new Date(`${w.date}T00:00:00Z`).getUTCDay())) && new Date(`${weeks[5].date}T00:00:00Z`).getUTCDay() === 5, weeks.slice(0, 3));
  const free = driftForecast("market", weeklyLevel(rows, "market"), 26);
  check("the free forecast's band widens with time around the drift", free.length === 26 && free[25].p90 - free[25].p10 >= free[0].p90 - free[0].p10 && free[25].p50 > 0 && free.every((p) => p.p10 <= p.p50 && p.p50 <= p.p90), free[25]);
  check("the yield is forecast in points, not percent", Math.abs(driftForecast("rates", weeklyLevel(rows, "rates"), 4)[3].p50 - 0.02) < 0.002);
  const q = forecastSql(weeks.slice(-60), 13, "TimesFM 2.5");
  check("the query forecasts the inline series with TimesFM at an 80% interval", q.includes("AI.FORECAST") && q.includes("model => 'TimesFM 2.5'") && q.includes("horizon => 13") && q.includes("confidence_level => 0.8") && (q.match(/STRUCT\(/g) ?? []).length === 60);
  check("a short series is refused rather than sent", (() => { try { forecastSql(weeks.slice(0, 5), 4); return false; } catch { return true; } })());
  const parsed = parseForecastRows("oil", { schema: { fields: [{ name: "forecast_timestamp" }, { name: "forecast_value" }, { name: "prediction_interval_lower_bound" }, { name: "prediction_interval_upper_bound" }] }, rows: [{ f: [{ v: "1.7916E9" }, { v: "0.1" }, { v: "0" }, { v: "0.2" }] }] }, 0);
  check("BigQuery's rows become changes from the last level, dates from epoch seconds", parsed.length === 1 && parsed[0].date === "2026-10-10" && Math.abs(parsed[0].p50 - (Math.exp(0.1) - 1)) < 1e-9 && parsed[0].p10 === 0 && parsed[0].p90 > parsed[0].p50, parsed);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();
