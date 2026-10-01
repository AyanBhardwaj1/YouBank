/**
 * Earth · drilling permits near plants, the leading indicator of gas into a plant: a well permitted
 * today is drilled and completed over the next six to twelve months, and its gas goes to the plants
 * nearby. For every watched plant, the permits within 10 km, read once a day: New Mexico's carry their
 * approval dates (the OCD's well layer); Texas's public map marks permitted, undrilled locations without
 * dates, so Edge records the day each first appears and counts from there. A plant whose last 30 days
 * bring at least five permits and twice its pace of the 90 days before becomes a card. Free: the New
 * Mexico OCD and the Railroad Commission of Texas.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheJson, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { isoWeek, metres } from "./flares";
import { record, type Provenance } from "./provenance";
import { watchedPlants, type Plant } from "./radar";
import { EIA_PLANTS, type Bbox } from "./sources/eia";
import { nmPermitted, NM_WELLS } from "./sources/nmwells";
import { RRC_WELLS, txPermitted } from "./sources/rrc";
import { pool } from "./terrain";

export const PERMITS_VERSION = "permits v1";
export const RADIUS_KM = 10;
const DAY = 86_400_000;
/** Texas counts need this many days of Edge's own record before a jump can be judged (30 now, 90 before). */
const TX_TRACKED_DAYS = 120;

export type Permit = { api: string; name: string; operator: string; lon: number; lat: number; km: number; date: string; url: string; state: "NM" | "TX" };
export type PermitsNear = {
  version: string; asOf: string; radiusKm: number;
  /** New Mexico, dated by approval: counts in the last 30 days and the 90 before, the four 30-day windows (oldest first), the newest permits and who holds them. */
  nm: { last30: number; prior90: number; windows: number[]; permits: Permit[]; operators: { name: string; n: number }[] } | null;
  /** Texas: permitted, undrilled locations now; since Edge began tracking, those it first saw in each window. */
  tx: { permitted: number; since: string; trackedDays: number; last30: number; prior90: number; windows: number[]; newest: Permit[] } | null;
};
type Seen = { since: string; seen: Record<string, string>; last?: string };

/* ---------------- Pure pieces ---------------- */

/** A box of `km` around a point, as west, south, east, north. Pure. */
export function boxKm(lon: number, lat: number, km: number): Bbox {
  const dLat = km / 110.574, dLon = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return [lon - dLon, lat - dLat, lon + dLon, lat + dLat];
}

/** Which states' records a circle may reach: New Mexico lies north of 32°N and west of about 103.06°W. Pure. */
export function statesNear(box: Bbox): { nm: boolean; tx: boolean } {
  return { nm: box[3] >= 31.99 && box[0] <= -103.0, tx: box[1] < 32.01 || box[2] > -103.08 };
}

/** Counts of dates in four 30-day windows ending today, oldest first, and the last 30 days against the 90 before. Pure. */
export function windowsOf(dates: string[], today: string): { windows: number[]; last30: number; prior90: number } {
  const end = Date.parse(`${today}T00:00:00Z`) + DAY;
  const windows = [0, 0, 0, 0];
  for (const d of dates) {
    const age = (end - Date.parse(`${d}T00:00:00Z`)) / DAY;
    if (!(age > 0) || age > 120) continue;
    windows[3 - Math.min(3, Math.floor((age - 1e-9) / 30))]++;
  }
  return { windows, last30: windows[3], prior90: windows[0] + windows[1] + windows[2] };
}

/** Whether permitting jumped: at least five in the last 30 days and at least twice the pace of the 90 days before. Pure. */
export const permitJump = (c: { last30: number; prior90: number }) => c.last30 >= 5 && c.last30 >= 2 * (c.prior90 / 3);

/** The pace now over the pace before (per 30 days), the earlier pace floored at one permit. Pure. */
export const paceRatio = (c: { last30: number; prior90: number }) => c.last30 / Math.max(1, c.prior90 / 3);

/** How sure Edge is: approval dates from the state are records (higher); Texas dates are the day Edge first saw a location (lower); a bigger jump on more permits raises it. Pure. */
export function permitConfidence(c: { last30: number; prior90: number }, dated: boolean): number {
  const v = (dated ? 0.72 : 0.55) + 0.06 * Math.min(3, Math.max(0, Math.log2(paceRatio(c)) - 1)) + (c.last30 >= 10 ? 0.05 : 0);
  return Math.round(Math.max(0.3, Math.min(0.92, v)) * 100) / 100;
}

/** How big, 0 to 1: how many permits (twenty counts in full) and how far above the usual pace (five times counts in full). Pure. */
export const permitMagnitude = (c: { last30: number; prior90: number }) => Math.round(Math.min(1, 0.5 * Math.min(1, c.last30 / 20) + 0.5 * Math.min(1, (paceRatio(c) - 1) / 4)) * 100) / 100;

/** Who holds the permits, most first. Pure. */
export function operatorsOf(permits: Pick<Permit, "operator">[], top = 5): { name: string; n: number }[] {
  const by = new Map<string, number>();
  for (const p of permits) if (p.operator) by.set(p.operator, (by.get(p.operator) ?? 0) + 1);
  return [...by.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, top);
}

/**
 * Edge's record of Texas locations: the first time it sees a plant all are marked as already there (""); later, each
 * new one gets the day it appeared. After a gap of more than a week between reads, what appeared in the gap cannot be
 * dated, so it too counts as already there (else a gap would read as a jump). Pure.
 */
export function trackSeen(prev: Seen | null, apis: string[], today: string, maxGapDays = 7): Seen {
  if (!prev) return { since: today, last: today, seen: Object.fromEntries(apis.map((a) => [a, ""])) };
  const gap = prev.last ? (Date.parse(today) - Date.parse(prev.last)) / DAY : 0;
  const mark = gap > maxGapDays ? "" : today;
  const seen = { ...prev.seen };
  for (const a of apis) if (!(a in seen)) seen[a] = mark;
  return { since: prev.since, last: today, seen };
}

/** Whether this jump only repeats the plant's last card (within 30 days and not at least half again as many). Pure. */
export function permitRepeats(last: { at: string; last30: number } | null, last30: number, now: number): boolean {
  return !!last && now - Date.parse(last.at) <= 30 * DAY && last30 < last.last30 * 1.5;
}

/* ---------------- Reading the records ---------------- */

const today = () => new Date().toISOString().slice(0, 10);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** The permits within 10 km of a plant, read once a day (Texas's record of first sightings is kept as it goes). */
export async function permitsNear(p: Pick<Plant, "id" | "lon" | "lat">): Promise<PermitsNear> {
  const day = today();
  return cacheJson(`edge:permits:v1:${p.id}:${day}`, DAY, async () => {
    const box = boxKm(p.lon, p.lat, RADIUS_KM), where = statesNear(box);
    const km = (lon: number, lat: number) => metres(p.lon, p.lat, lon, lat) / 1000;
    const since = new Date(Date.parse(`${day}T00:00:00Z`) - 120 * DAY).toISOString().slice(0, 10);
    const [nmRaw, txRaw] = await Promise.all([where.nm ? nmPermitted(box, since) : Promise.resolve(null), where.tx ? txPermitted(box) : Promise.resolve(null)]);
    let nm: PermitsNear["nm"] = null, tx: PermitsNear["tx"] = null;
    if (nmRaw) {
      const near = nmRaw.map((x) => ({ ...x, km: km(x.lon, x.lat) })).filter((x) => x.km <= RADIUS_KM).sort((a, b) => b.approved.localeCompare(a.approved) || a.km - b.km);
      const w = windowsOf(near.map((x) => x.approved), day);
      nm = { ...w, operators: operatorsOf(near.filter((x) => (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${x.approved}T00:00:00Z`)) / DAY < 30)),
        permits: near.slice(0, 12).map((x) => ({ api: x.api, name: x.name, operator: x.operator, lon: x.lon, lat: x.lat, km: r1(x.km), date: x.approved, url: x.url, state: "NM" as const })) };
    }
    if (txRaw) {
      const near = txRaw.map((x) => ({ ...x, km: km(x.lon, x.lat) })).filter((x) => x.km <= RADIUS_KM);
      const key = `edge:permits:tx:v1:${p.id}`;
      let prev: Seen | null = null;
      try { const v = await cacheGet(key); prev = v ? (JSON.parse(v) as Seen) : null; } catch { prev = null; }
      const seen = trackSeen(prev, near.map((x) => x.api), day);
      await cacheSet(key, JSON.stringify(seen), 400 * DAY);
      const dated = near.filter((x) => seen.seen[x.api]);
      const w = windowsOf(Object.values(seen.seen).filter(Boolean), day);
      tx = { permitted: near.length, since: seen.since, trackedDays: Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${seen.since}T00:00:00Z`)) / DAY), ...w,
        newest: dated.sort((a, b) => seen.seen[b.api].localeCompare(seen.seen[a.api]) || a.km - b.km).slice(0, 8).map((x) => ({ api: x.api, name: "", operator: "", lon: x.lon, lat: x.lat, km: r1(x.km), date: seen.seen[x.api], url: "", state: "TX" as const })) };
    }
    return { version: PERMITS_VERSION, asOf: day, radiusKm: RADIUS_KM, nm, tx };
  });
}

/** The counts a card is judged on: New Mexico's always, Texas's once Edge has tracked them long enough. */
export function judged(n: Pick<PermitsNear, "nm" | "tx">): { last30: number; prior90: number; windows: number[]; dated: boolean } | null {
  const txOk = !!n.tx && n.tx.trackedDays >= TX_TRACKED_DAYS;
  if (!n.nm && !txOk) return null;
  const parts = [n.nm, txOk ? n.tx : null].filter((x): x is NonNullable<typeof x> => !!x);
  return { last30: parts.reduce((s, x) => s + x.last30, 0), prior90: parts.reduce((s, x) => s + x.prior90, 0), windows: [0, 1, 2, 3].map((i) => parts.reduce((s, x) => s + x.windows[i], 0)), dated: !txOk };
}

const LAST = "edge:permits:cards:v1", READ = "edge:permits:read:v1";
const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const readJson = async <T,>(key: string, fallback: T): Promise<T> => { try { const v = await cacheGet(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };

/**
 * The daily pass: the watched plants' permits, least recently read first (Texas's service is read one
 * request at a time, so a short deadline reaches the rest on the following days), and a card for each
 * plant whose permitting jumped, unless it repeats the plant's last card. Returns the new cards.
 */
export async function scanPermits(deadline: number): Promise<{ plants: number; read: number; jumps: number; created: number[] }> {
  const read = await readJson<Record<string, string>>(READ, {});
  const plants = (await watchedPlants()).sort((a, b) => (read[a.id] ?? "").localeCompare(read[b.id] ?? "") || b.cap - a.cap);
  const out = { plants: plants.length, read: 0, jumps: 0, created: [] as number[] };
  const last = await readJson<Record<string, { at: string; last30: number }>>(LAST, {});
  const now = Date.now();
  await pool(plants, 4, async (p) => {
    if (Date.now() > deadline) return;
    try {
      const n = await permitsNear(p);
      read[p.id] = new Date().toISOString();
      out.read++;
      const c = judged(n);
      if (!c || !permitJump(c)) return;
      out.jumps++;
      if (permitRepeats(last[p.id] ?? null, c.last30, now)) return;
      const id = await permitCard(p, n, c);
      if (id) { out.created.push(id); last[p.id] = { at: new Date(now).toISOString(), last30: c.last30 }; }
    } catch (e) {
      logError(e, { where: "edge-permits" });
    }
  });
  if (out.created.length) await cacheSet(LAST, JSON.stringify(last), 400 * DAY);
  if (out.read) await cacheSet(READ, JSON.stringify(read), 400 * DAY);
  return out;
}

/** A jump in permitting as a card. */
async function permitCard(p: Plant, n: PermitsNear, c: NonNullable<ReturnType<typeof judged>>): Promise<number | null> {
  const key = `permits:v1:asset:${p.id}:${isoWeek(n.asOf)}`;
  const [existing] = await requireDb().select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${key}`);
  if (existing) return null;
  const owner = p.company || "an unmapped operator";
  const pace = c.prior90 / 3, ratio = paceRatio(c);
  const from = new Date(Date.parse(`${n.asOf}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
  const permits = [...(n.nm?.permits ?? []), ...(c.dated ? [] : n.tx?.newest ?? [])].sort((a, b) => b.date.localeCompare(a.date) || a.km - b.km).slice(0, 12);
  const ops = n.nm?.operators ?? [];
  const who = !ops.length ? "" : ops[0].n === c.last30 ? ` All are ${ops[0].name}'s.` : ` ${ops[0].n} of them are ${ops[0].name}'s${ops[1] ? ` and ${ops[1].n} ${ops[1].name}'s` : ""}.`;
  const nearest = permits.length ? Math.min(...permits.map((x) => x.km)) : null;
  const source = c.dated ? "New Mexico approved" : n.nm ? "New Mexico approved and Texas's map first showed" : "Texas's map first showed";
  const title = `${c.last30} drilling permits within ${RADIUS_KM} km of ${p.name} in 30 days, ${!c.prior90 ? "after none in the 90 days before" : ratio >= 10 ? "far above its recent pace" : `${ratio.toFixed(1)} times its recent pace`}`;
  const summary = `${source} ${c.last30} new well permits within ${RADIUS_KM} km of ${p.name} (${owner}${p.cap ? `, ${fmt(p.cap)} MMcfd` : ""}) between ${from} and ${n.asOf}, against ${c.prior90 ? `${c.prior90} in the 90 days before (about ${pace.toFixed(1)} a month)` : "none in the 90 days before"}.${who}${nearest !== null ? ` The nearest is ${nearest} km from the plant.` : ""} New wells are drilled and completed over the next six to twelve months, and their gas goes to the plants nearby; a permit is not a well, and some are never drilled.`;
  const why = `${c.dated ? "New Mexico's Oil Conservation Division marks a well whose drilling permit is approved, and not yet completed, as \"New\", dated the day the status took effect; these are counted by that date." : "Texas's public map shows permitted, undrilled locations without dates, so Edge records the day each first appears and counts by that day (after at least four months of its own record)."} Only oil and gas wells within ${RADIUS_KM} km of the plant's mapped location count. A jump is at least five in 30 days and at least twice the pace of the 90 days before. Permits show intent, not production: operators permit more than they drill, and a well can feed a different plant than the nearest.`;
  const confidence = permitConfidence(c, c.dated);
  const visual = {
    type: "permits", site: { name: p.name, kind: "processing_plant", company: p.company, ticker: p.ticker, lon: p.lon, lat: p.lat, capacityMMcfd: p.cap }, radiusKm: RADIUS_KM,
    asOf: n.asOf, from, dated: c.dated, last30: c.last30, prior90: c.prior90, windows: c.windows, operators: ops, permits,
    tx: n.tx ? { permitted: n.tx.permitted, since: n.tx.since } : null,
  };
  const box = boxKm(p.lon, p.lat, RADIUS_KM);
  const [row] = await requireDb().insert(schema.edgeDetections).values({
    key, kind: "permits", module: "earth", title: title.slice(0, 200), summary: summary.slice(0, 1200), why, confidence, magnitude: permitMagnitude(c),
    tickers: p.ticker ? [p.ticker] : [], assetIds: [p.id], bbox: box, visual, observedAt: new Date(`${n.asOf}T12:00:00Z`),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return null;
  const retrieved = new Date();
  const sources: Provenance[] = [
    ...(n.nm ? [{ sourceName: NM_WELLS.name, sourceUrl: NM_WELLS.url, license: NM_WELLS.license, method: `${PERMITS_VERSION}: oil and gas wells with status New, by approval date, within ${RADIUS_KM} km`, modelVersion: "", retrievedAt: retrieved }] : []),
    ...(n.tx ? [{ sourceName: RRC_WELLS.name, sourceUrl: RRC_WELLS.url, license: RRC_WELLS.license, method: `${PERMITS_VERSION}: permitted locations within ${RADIUS_KM} km${c.dated ? " (shown, not counted: no dates)" : ", dated by the day Edge first saw them"}`, modelVersion: "", retrievedAt: retrieved }] : []),
    { sourceName: EIA_PLANTS.name, sourceUrl: EIA_PLANTS.url, license: EIA_PLANTS.license, method: `site location (${EIA_PLANTS.vintage})`, modelVersion: "", retrievedAt: retrieved },
  ];
  await record(`detection:${row.id}`, sources);
  return row.id;
}
