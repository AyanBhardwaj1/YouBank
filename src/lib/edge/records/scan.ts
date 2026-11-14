/**
 * Public records as Edge cards: nuclear units offline or derated (the NRC's daily status), bursts of FDA
 * recalls (openFDA) and large vehicle recalls (NHTSA), each mapped to listed companies. Free, keyless
 * sources few investors read every day. Each source is read and posted independently, so one that is
 * down never stops the others; what each did goes in the pass's notes (no raw error text).
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { isoWeek } from "../flares";
import { record } from "../provenance";
import { boxAround } from "../sources/sentinel";
import { NHTSA, readVehicleRecalls } from "../sources/nhtsa";
import { NRC, NRC_FILE, readReactorStatus } from "../sources/nrc";
import { OPENFDA, readFirmCounts, readRecalls } from "../sources/openfda";
import { lostMwh, reactorEvents, recallBursts, refuelSeason, vehicleBursts, vehicleMagnitude, type ReactorEvent, type RecallBurst, type VehicleBurst } from "./logic";
import { FDA_FIRMS, NHTSA_MAKERS } from "./names";
import { plantOf, type Plant } from "./reactors";

export const RECORDS_VERSION = "records v1";
export type RecordsScan = { created: number[]; updated: number; notes: string[] };

type Card = { key: string; kind: string; title: string; summary: string; why: string; confidence: number; magnitude: number; tickers: string[]; bbox: [number, number, number, number] | null; visual: Record<string, unknown>; observedAt: Date; sources: { sourceName: string; sourceUrl: string; license: string; method: string }[] };

/** Insert a card, or refresh the one already under its key when its numbers moved. */
async function upsert(c: Card, moved: (before: Record<string, unknown>) => boolean): Promise<{ id: number; created: boolean } | null> {
  const db = requireDb();
  const [existing] = await db.select({ id: schema.edgeDetections.id, visual: schema.edgeDetections.visual }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${c.key}`);
  const stamp = new Date().toISOString();
  if (existing) {
    if (!moved(existing.visual)) return null;
    await db.update(schema.edgeDetections).set({ title: c.title, summary: c.summary, why: c.why, confidence: c.confidence, magnitude: c.magnitude, visual: { ...c.visual, firstSeenAt: (existing.visual as { firstSeenAt?: string }).firstSeenAt ?? stamp, updatedAt: stamp }, observedAt: c.observedAt }).where(sql`${schema.edgeDetections.id} = ${existing.id}`);
    return { id: existing.id, created: false };
  }
  const [row] = await db.insert(schema.edgeDetections).values({ key: c.key, kind: c.kind, module: "records", title: c.title.slice(0, 200), summary: c.summary.slice(0, 1400), why: c.why, confidence: c.confidence, magnitude: c.magnitude, tickers: c.tickers, assetIds: [], bbox: c.bbox, visual: { ...c.visual, firstSeenAt: stamp, updatedAt: stamp }, observedAt: c.observedAt }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return null;
  const at = new Date();
  await record(`detection:${row.id}`, c.sources.map((s) => ({ ...s, modelVersion: "", retrievedAt: at })));
  return { id: row.id, created: true };
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ---------------- Nuclear units ---------------- */

/** A unit's run below normal as a card's fields. Pure. */
export function reactorCard(e: ReactorEvent, p: Plant): Card {
  const mw = p.mwPerUnit, mwh = lostMwh(e, mw);
  const planned = refuelSeason(e.start);
  const what = e.kind === "outage" ? `${e.unit} has been offline for ${e.days} day${e.days === 1 ? "" : "s"}` : `${e.unit} is running at ${Math.round(e.power)}% of power`;
  const owner = `${p.owner}${p.tickers.length ? ` (${p.tickers.join(", ")})` : ""}`;
  const effect = p.merchant
    ? "It sells its power into the wholesale market, so lost output is lost revenue (and, if the owner sold the power forward, replacement power bought at market prices)."
    : "As a regulated utility it mostly recovers replacement-power costs from customers through its fuel clause, so the earnings effect is usually small unless the outage runs long or regulators question it.";
  return {
    key: `reactor_outage:v1:${slug(e.unit)}:${e.start}`, kind: "reactor_outage",
    title: `${what} (${p.plant}, ${p.owner})`,
    summary: `The NRC's daily status puts ${e.unit} at ${Math.round(e.power)}% on ${e.latest}, down from a usual ${Math.round(e.before)}% in the month before ${e.start}. At about ${fmt(mw)} MW, that is roughly ${fmt(mwh)} MWh not generated so far. Owner: ${owner}. ${effect} ${planned ? "The run began in a usual refuelling season, so it may be a planned outage; refuellings last about a month, and one that runs long is the news." : "It began outside the usual spring and autumn refuelling seasons, which makes an unplanned outage or a forced derate more likely."}`,
    why: `${RECORDS_VERSION}: licensees report each unit's power to the NRC every morning; Edge compares the newest report with the median of the month before the run (an outage is 20% or less after a month averaging 80% or more; a derate is 15 points or more under a normal of 90% or more for two days). The report gives no reason in this file, capacity is approximate, and a planned refuelling looks the same as a trip until the NRC's event reports or the owner say which.`,
    confidence: e.kind === "outage" ? 0.9 : 0.8,
    // Size of the loss, how long, whether the owner sells into the market, and whether it began outside the refuelling seasons.
    magnitude: Math.round(Math.min(1, 0.4 * Math.min(1, mwh / 200_000) + 0.2 * Math.min(1, e.days / 14) + (p.merchant ? 0.25 : 0.05) + (planned ? 0 : 0.15)) * 100) / 100,
    tickers: p.tickers, bbox: boxAround(p.lon, p.lat, 4),
    visual: { type: "reactor", unit: e.unit, plant: p.plant, owner: p.owner, tickers: p.tickers, merchant: p.merchant, event: e.kind, start: e.start, latest: e.latest, days: e.days, power: e.power, before: e.before, mw, lostMwh: mwh, refuelSeason: planned, series: e.series, site: { name: p.plant, lon: p.lon, lat: p.lat }, url: NRC.url },
    observedAt: new Date(`${e.latest}T09:00:00Z`),
    sources: [{ sourceName: NRC.name, sourceUrl: NRC_FILE, license: NRC.license, method: `${RECORDS_VERSION}: newest report against the month before the run` }],
  };
}

async function scanReactors(out: RecordsScan) {
  const events = reactorEvents(await readReactorStatus());
  let posted = 0;
  for (const e of events) {
    const p = plantOf(e.unit);
    if (!p || !p.tickers.length) continue;
    const r = await upsert(reactorCard(e, p), (v) => v.latest !== e.latest).catch((err) => { logError(err, { where: "edge-records-reactor" }); return null; });
    if (r?.created) { out.created.push(r.id); posted++; } else if (r) out.updated++;
  }
  out.notes.push(`reactors: ${events.length} below normal, ${posted} new`);
}

/* ---------------- FDA recalls ---------------- */

/** A burst of a company's FDA recalls as a card's fields. Pure. */
export function recallCard(b: RecallBurst, week: string): Card {
  const top = b.recalls[0];
  const classes = b.classI ? `${b.classI} Class I (the most serious)` : `${b.k} recall${b.k === 1 ? "" : "s"}`;
  return {
    key: `fda_recall:v1:${b.ticker}:${week}`, kind: "fda_recall",
    title: b.classI ? `Class I FDA recall at ${b.name}: ${top.product.slice(0, 80)}` : `${b.name}: ${b.k} FDA recalls in two weeks, against about ${b.lambda.toFixed(1)} usually`,
    summary: `FDA's enforcement reports list ${classes} for ${b.name} in the last two weeks${b.lambda ? `, against about ${b.lambda.toFixed(1)} in a usual two weeks over the year before` : ", and none in the year before"}. The first: ${top.classification || "unclassified"} ${top.category} recall ${top.number}, ${top.reason.slice(0, 220)}${top.quantity ? ` (${top.quantity})` : ""}. Recalls cost money directly (returns, write-offs, remediation) and, for devices and drugs, can lead to warning letters, import alerts or lost share; a Class I device recall often draws product-liability suits.`,
    why: `${RECORDS_VERSION}: openFDA's drug, device and food enforcement reports by report date, matched to listed parents by the recalling firm's filed name (a curated list; subsidiaries filing under other names can be missed). A card needs any Class I recall, or three or more recalls when the parent's own pace over the year before makes that less than 1% likely (Poisson). FDA posts classified recalls weekly, often weeks after the firm began the recall.`,
    confidence: b.classI ? 0.85 : 0.75,
    magnitude: Math.round(Math.min(1, 0.35 * Math.min(1, b.classI / 2) + 0.35 * Math.min(1, b.k / 8) + 0.3 * (1 - Math.min(1, b.p * 50))) * 100) / 100,
    tickers: [b.ticker], bbox: null,
    visual: { type: "recall", source: "fda", ticker: b.ticker, name: b.name, k: b.k, classI: b.classI, lambda: b.lambda, p: b.p, items: b.recalls.slice(0, 6).map((r) => ({ id: r.number, cls: r.classification, category: r.category, product: r.product.slice(0, 160), reason: r.reason.slice(0, 200), date: r.reportDate, quantity: r.quantity, url: `https://www.accessdata.fda.gov/scripts/ires/index.cfm` })) },
    observedAt: new Date(`${b.recalls.reduce((m, r) => (r.reportDate > m ? r.reportDate : m), "")}T12:00:00Z`),
    sources: [{ sourceName: OPENFDA.name, sourceUrl: "https://api.fda.gov/drug/enforcement.json (and device, food)", license: OPENFDA.license, method: `${RECORDS_VERSION}: two weeks of recalls against the parent's year (Poisson)` }],
  };
}

async function scanFda(out: RecordsScan) {
  const [recent, base] = await Promise.all([readRecalls(14), readFirmCounts(365, 15)]);
  const bursts = recallBursts(recent, base, FDA_FIRMS).filter((b) => b.signal);
  const week = isoWeek(new Date().toISOString().slice(0, 10));
  for (const b of bursts) {
    const r = await upsert(recallCard(b, week), (v) => Number(v.k) !== b.k).catch((err) => { logError(err, { where: "edge-records-fda" }); return null; });
    if (r?.created) out.created.push(r.id); else if (r) out.updated++;
  }
  out.notes.push(`FDA: ${recent.length} recalls in two weeks, ${bursts.length} bursts`);
}

/* ---------------- Vehicle recalls ---------------- */

/** A maker's large recalls as a card's fields. Pure. */
export function vehicleCard(b: VehicleBurst, week: string): Card {
  const top = b.recalls[0];
  return {
    key: `vehicle_recall:v1:${b.ticker}:${week}`, kind: "vehicle_recall",
    title: b.parkIt ? `${b.name} recall comes with a do-not-drive or park-outside warning` : `${b.name} recalls ${fmt(b.units)} vehicles in two weeks`,
    summary: `NHTSA received ${b.recalls.length} recall report${b.recalls.length === 1 ? "" : "s"} from ${b.name} in the last two weeks covering ${fmt(b.units)} vehicles, against about ${fmt(b.usual)} in a usual two weeks over the year before. The largest: ${top.id}, ${fmt(top.units)} vehicles, ${top.component || "component not given"}${top.subject ? `: ${top.subject.slice(0, 200)}` : ""}. A recall's cost depends on the fix (a software update over the air costs little; replacing parts across hundreds of thousands of vehicles can cost hundreds of millions and go into warranty reserves), and repeated large recalls draw NHTSA investigations.`,
    why: `${RECORDS_VERSION}: NHTSA's recalls dataset by the date NHTSA received the report, matched to listed makers by the filed manufacturer name (a curated list). A card needs 100,000 vehicles or more and three times the maker's usual two weeks, any single recall of 250,000 or more, or a do-not-drive or park-outside warning. "Potentially affected" counts vehicles that may have the defect, not confirmed failures.`,
    confidence: 0.85, magnitude: vehicleMagnitude(b.units, b.parkIt),
    tickers: [b.ticker], bbox: null,
    visual: { type: "recall", source: "nhtsa", ticker: b.ticker, name: b.name, units: b.units, usual: b.usual, parkIt: b.parkIt, items: b.recalls.slice(0, 6).map((r) => ({ id: r.id, product: r.component, reason: r.subject.slice(0, 200), date: r.received, units: r.units, parkIt: r.parkIt, url: r.url })) },
    observedAt: new Date(`${b.recalls.reduce((m, r) => (r.received > m ? r.received : m), "")}T12:00:00Z`),
    sources: [{ sourceName: NHTSA.name, sourceUrl: NHTSA.url, license: NHTSA.license, method: `${RECORDS_VERSION}: two weeks of recalls against the maker's year` }],
  };
}

async function scanVehicles(out: RecordsScan) {
  const year = await readVehicleRecalls(380);
  const bursts = vehicleBursts(year, NHTSA_MAKERS, Date.now()).filter((b) => b.signal);
  const week = isoWeek(new Date().toISOString().slice(0, 10));
  for (const b of bursts) {
    const r = await upsert(vehicleCard(b, week), (v) => Number(v.units) !== b.units).catch((err) => { logError(err, { where: "edge-records-nhtsa" }); return null; });
    if (r?.created) out.created.push(r.id); else if (r) out.updated++;
  }
  out.notes.push(`NHTSA: ${year.length} recalls in the year, ${bursts.length} large`);
}

/** Every records source, side by side, each on its own (a source that fails is noted and skipped). */
export async function scanRecords(deadline: number): Promise<RecordsScan> {
  const out: RecordsScan = { created: [], updated: 0, notes: [] };
  const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("past the deadline")), Math.max(1_000, deadline - Date.now())))]);
  const runs: [string, (o: RecordsScan) => Promise<void>][] = [["reactors", scanReactors], ["FDA", scanFda], ["NHTSA", scanVehicles]];
  await Promise.all(runs.map(([name, fn]) => within(fn(out)).catch((e) => { logError(e, { where: `edge-records-${name}` }); out.notes.push(`${name}: did not answer`); })));
  return out;
}
