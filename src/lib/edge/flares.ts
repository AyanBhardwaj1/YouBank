/**
 * Earth · flaring: heat at the processing plants on the map. NASA's VIIRS instruments (three satellites,
 * 375 m pixels, passing each night and day) see a gas flare as a hot spot. A plant that flares on several
 * days in a week is burning gas it cannot take in or send on (an upset, maintenance, a full pipeline),
 * which an analyst covering its owner wants to know before the quarter's numbers say so. Each such week
 * becomes a card: the days it flared and how hot, a Sentinel-2 shortwave-infrared image where the flare
 * glows, a record of the weeks before, and in New Mexico what operators nearby reported flaring that
 * month. Free: NASA FIRMS, Copernicus through Planetary Computer, the New Mexico OCD.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { COVERED } from "./assets";
import { record, type Provenance } from "./provenance";
import { EIA_PLANTS, type Bbox } from "./sources/eia";
import { FIRMS, hotspots, parseFirmsCsv, type Hotspot } from "./sources/firms";
import { NM_OCD, reportedNear, type Reported } from "./sources/nmocd";
import { upgradeOn } from "./premium";
import { boxAround, cropUrl, scenes, SENTINEL, type Scene } from "./sources/sentinel";
import { parseNpy, pool } from "./terrain";

export const FLARE_VERSION = "flares v1";
const RADIUS_KM = 1.5;
const BOX_KM = 3;
const DAYS = 7;
const DAY = 86_400_000;
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";

export type FlareDay = { date: string; n: number; frp: number; sats: string[] };
export type FlareStats = { detections: number; days: number; frpTotal: number; frpMax: number; nearestM: number; satellites: number; high: number };
export type FlareWeek = { week: string; days: number; frp: number };
type Plant = { id: number; name: string; company: string; ticker: string; lon: number; lat: number; cap: number };

/* ---------------- Pure pieces ---------------- */

/** Metres between two points. Pure. */
export function metres(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12_742_000 * Math.asin(Math.sqrt(h));
}

/** Hot spots within `radiusKm` of a site, nearest first, with their distance. Pure. */
export function spotsNear(spots: Hotspot[], lon: number, lat: number, radiusKm = RADIUS_KM): (Hotspot & { m: number })[] {
  // A cheap box test first (a degree of latitude is 111 km), then the true distance.
  const dLat = radiusKm / 110, dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));
  return spots.filter((s) => Math.abs(s.lat - lat) <= dLat && Math.abs(s.lon - lon) <= dLon)
    .map((s) => ({ ...s, m: Math.round(metres(lon, lat, s.lon, s.lat)) })).filter((s) => s.m <= radiusKm * 1000).sort((a, b) => a.m - b.m);
}

/** The window's days, oldest first and zero-filled, with what was seen on each (dates are the satellites' UTC dates). Pure. */
export function byDay(near: Hotspot[], to: string, days = DAYS): FlareDay[] {
  const end = Date.parse(`${to}T00:00:00Z`);
  return Array.from({ length: days }, (_, k) => {
    const date = new Date(end - (days - 1 - k) * DAY).toISOString().slice(0, 10);
    const on = near.filter((s) => s.date === date);
    return { date, n: on.length, frp: Math.round(on.reduce((t, s) => t + s.frp, 0) * 10) / 10, sats: [...new Set(on.map((s) => s.sat))] };
  });
}

export function flareStats(near: (Hotspot & { m: number })[], days: FlareDay[]): FlareStats {
  const inWindow = near.filter((s) => days.some((d) => d.date === s.date));
  return {
    detections: inWindow.length, days: days.filter((d) => d.n > 0).length,
    frpTotal: Math.round(inWindow.reduce((t, s) => t + s.frp, 0) * 10) / 10, frpMax: Math.round(Math.max(0, ...inWindow.map((s) => s.frp)) * 10) / 10,
    nearestM: inWindow.length ? Math.min(...inWindow.map((s) => s.m)) : 0, satellites: new Set(inWindow.map((s) => s.sat)).size, high: inWindow.filter((s) => s.conf === "high").length,
  };
}

/** Whether a week makes a card: flaring on three days or more, or on two days with real heat. Pure. */
export const flares = (s: FlareStats) => s.days >= 3 || (s.days >= 2 && s.frpTotal >= 15);

/** How sure Edge is that the plant flared: more days, more satellites agreeing, high-confidence pixels and a hot Sentinel-2 image raise it; heat seen only at the edge of the circle lowers it. Pure. */
export function flareConfidence(s: FlareStats, hotPixels: number): number {
  const c = 0.42 + 0.07 * Math.min(5, Math.max(0, s.days - 1)) + (s.satellites >= 2 ? 0.08 : 0) + (s.high ? 0.05 : 0) + (hotPixels >= 3 ? 0.12 : 0) - (s.nearestM > 1000 ? 0.1 : 0);
  return Math.round(Math.max(0.2, Math.min(0.95, c)) * 100) / 100;
}

/** How big, 0 to 1: the share of the week it flared and the heat it gave off. Pure. */
export const flareMagnitude = (s: FlareStats) => Math.round(Math.min(1, (0.6 * s.days) / DAYS + 0.4 * Math.min(1, s.frpTotal / 40)) * 100) / 100;

/** Whether this week only repeats the plant's last card (within two weeks and no worse), so a chronic flare is not news every week. Pure. */
export function repeats(last: { at: string; days: number; frp: number } | null, s: FlareStats, now: number): boolean {
  if (!last) return false;
  if (now - Date.parse(last.at) > 14 * DAY) return false;
  return s.days < last.days + 2 && s.frpTotal < Math.max(15, last.frp * 2);
}

/** "2026-W39" for a date. Pure. */
export function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const year = d.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - first.getTime()) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

/** The weeks on record with this week set (newest last, half a year kept). Pure. */
export function withWeek(hist: FlareWeek[], w: FlareWeek, keep = 26): FlareWeek[] {
  return [...hist.filter((h) => h.week !== w.week), w].sort((a, b) => a.week.localeCompare(b.week)).slice(-keep);
}

/** Each ISO week's days with heat at a site, from a run of past detections (for filling the record from the archive). Pure. */
export function weeksFrom(near: Hotspot[]): FlareWeek[] {
  const by = new Map<string, { days: Set<string>; frp: number }>();
  for (const s of near) {
    const w = isoWeek(s.date), cur = by.get(w) ?? { days: new Set<string>(), frp: 0 };
    cur.days.add(s.date); cur.frp += s.frp; by.set(w, cur);
  }
  return [...by.entries()].map(([week, v]) => ({ week, days: v.days.size, frp: Math.round(v.frp * 10) / 10 })).sort((a, b) => a.week.localeCompare(b.week));
}

/** The archive windows to read, ten days each, ending where the seven-day files begin: [start date, days]. Pure. */
export function archiveWindows(to: string, weeks = 12): [string, number][] {
  // The seven-day files start DAYS - 1 days before `to`; the archive runs up to the day before that.
  const end = Date.parse(`${to}T00:00:00Z`) - (DAYS - 1) * DAY;
  const out: [string, number][] = [];
  for (let start = end - weeks * 7 * DAY; start < end; start += 10 * DAY) out.push([new Date(start).toISOString().slice(0, 10), Math.min(10, Math.round((end - start) / DAY))]);
  return out;
}

/**
 * With a FIRMS MAP_KEY (free), fill every plant's weekly record back twelve weeks from the archive, once,
 * so the first cards already know whether a flare is new. Near-real-time files first, the standard
 * (reprocessed) ones where those have aged out.
 */
async function backfill(all: Plant[], to: string, hist: Record<string, FlareWeek[]>, deadline: number): Promise<boolean> {
  const key = process.env.FIRMS_MAP_KEY!.trim();
  const jobs = COVERED.flatMap((c) => archiveWindows(to).flatMap(([start, days]) => ["VIIRS_NOAA20", "VIIRS_SNPP", "VIIRS_NOAA21"].map((sat) => ({ c, start, days, sat }))));
  // Four requests at a time, each short; past the deadline the rest are skipped and the backfill tries again on another day.
  let complete = true;
  const got = await pool(jobs, 4, async ({ c, start, days, sat }) => {
    for (const kind of ["NRT", "SP"]) {
      if (Date.now() > deadline) { complete = false; return []; }
      const res = await fetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${sat}_${kind}/${c.bbox.map((v) => v.toFixed(2)).join(",")}/${days}/${start}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) }).catch(() => null);
      const text = res?.ok ? await res.text() : "";
      if (/^latitude/.test(text)) return parseFirmsCsv(text, c.bbox);
    }
    return [];
  });
  const spots = got.flat();
  if (!complete || !spots.length) return false;
  for (const p of all) {
    const past = weeksFrom(spotsNear(spots, p.lon, p.lat));
    if (!past.length && !hist[p.id]) continue;
    let h = hist[p.id] ?? [];
    for (const w of past) if (!h.some((x) => x.week === w.week)) h = withWeek(h, w);
    hist[p.id] = h;
  }
  return true;
}

/** Pixels where shortwave infrared runs hot: band 12 well above band 11 and far above the ground around it (bands as stored, with L2A's offset of 1000). Pure. */
export function hotPixels(b12: ArrayLike<number>, b11: ArrayLike<number>, valid?: ArrayLike<number>): number {
  let hot = 0;
  for (let i = 0; i < b12.length; i++) {
    if (valid && !valid[i]) continue;
    const r12 = (b12[i] - 1000) / 10_000, r11 = (b11[i] - 1000) / 10_000;
    if (r12 > 0.6 && r12 + r11 > 0 && (r12 - r11) / (r12 + r11) > 0.15) hot++;
  }
  return hot;
}

/* ---------------- Reading the sources ---------------- */

/** The shortwave-infrared heat of a box as an image: flares glow yellow on dark ground. */
const heatUrl = (scene: Scene, bbox: Bbox, size = 512) =>
  `${DATA}/item/bbox/${bbox.map((v) => v.toFixed(5)).join(",")}/${size}x${size}.png?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&expression=${encodeURIComponent("(B12-B11)/(B12+B11-2000)")}&asset_as_band=true&rescale=-0.1,0.3&colormap_name=inferno&nodata=0`;

/** A Sentinel-2 look at a site: the newest clear scene of the last three weeks (the flare as it is now), its hot pixels counted. */
async function heatAt(box: Bbox): Promise<{ scene: Scene; hot: number } | null> {
  const scene = (await scenes(box, new Date(Date.now() - 21 * DAY), new Date(), 10, 6).catch(() => []))[0];
  if (!scene) return null;
  const n = 128;
  const res = await fetch(`${DATA}/item/bbox/${box.map((v) => v.toFixed(5)).join(",")}/${n}x${n}.npy?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&assets=B12&assets=B11&resampling=nearest`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return { scene, hot: 0 };
  const { shape, data } = parseNpy(new Uint8Array(await res.arrayBuffer()));
  const cells = n * n;
  return { scene, hot: hotPixels(data.subarray(0, cells), data.subarray(cells, 2 * cells), shape[0] >= 3 ? data.subarray(2 * cells, 3 * cells) : undefined) };
}

async function plants(): Promise<Plant[]> {
  const boxes = COVERED.map((c) => sql`geom && ST_MakeEnvelope(${c.bbox[0]}, ${c.bbox[1]}, ${c.bbox[2]}, ${c.bbox[3]}, 4326)`);
  const rows = await requireDb().execute(sql`
    select id, name, company, ticker, ST_X(geom) as lon, ST_Y(geom) as lat, coalesce((attrs->>'capacityMMcfd')::float, 0) as cap
    from edge_assets where kind = 'processing_plant' and owner_id is null and (${sql.join(boxes, sql` or `)})`);
  return (rows.rows as { id: number; name: string; company: string; ticker: string; lon: number; lat: number; cap: number }[])
    .map((r) => ({ id: r.id, name: r.name, company: r.company ?? "", ticker: r.ticker ?? "", lon: Number(r.lon), lat: Number(r.lat), cap: Number(r.cap) || 0 }));
}

const HIST = "edge:flares:hist:v1", LAST = "edge:flares:cards:v1", FILLED = "edge:flares:backfilled:v1";
const readJson = async <T,>(key: string, fallback: T): Promise<T> => { try { const v = await cacheGet(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };

const fmt = (v: number, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

/**
 * The daily pass: every mapped plant against the last seven days of hot spots. Plants that flared get a
 * card (one per plant per week, refreshed while the week runs); the weekly record is kept for every
 * plant. Returns the ids of new cards (for alerts).
 */
export async function scanFlares(deadline: number): Promise<{ plants: number; flaring: number; created: number[]; updated: number }> {
  const all = await plants();
  if (!all.length) return { plants: 0, flaring: 0, created: [], updated: 0 };
  const seen = (await Promise.all(COVERED.map((c) => hotspots(c.bbox)))).reduce<{ spots: Hotspot[]; satellites: Set<string> }>((acc, r) => { acc.spots.push(...r.spots); r.satellites.forEach((s) => acc.satellites.add(s)); return acc; }, { spots: [], satellites: new Set() });
  const to = seen.spots.reduce((m, s) => (s.date > m ? s.date : m), new Date(Date.now() - DAY).toISOString().slice(0, 10));
  const week = isoWeek(to);
  const hist = await readJson<Record<string, FlareWeek[]>>(HIST, {});
  const last = await readJson<Record<string, { at: string; days: number; frp: number }>>(LAST, {});
  // Once, with the free archive key: the twelve weeks before, so the record starts full.
  if (upgradeOn("firms-archive") && !(await cacheGet(FILLED)) && (await backfill(all, to, hist, Math.min(deadline, Date.now() + 60_000)).catch((e) => { logError(e, { where: "edge-flares-backfill" }); return false; }))) await cacheSet(FILLED, new Date().toISOString(), 400 * DAY);
  const out = { plants: all.length, flaring: 0, created: [] as number[], updated: 0 };
  const now = Date.now();
  // The plants that flared, the hottest weeks first (so a short deadline still reaches the biggest).
  const found = all.map((p) => { const near = spotsNear(seen.spots, p.lon, p.lat); const days = byDay(near, to); return { p, near, days, s: flareStats(near, days) }; });
  for (const f of found) if (f.s.detections || hist[f.p.id]) hist[f.p.id] = withWeek(hist[f.p.id] ?? [], { week, days: f.s.days, frp: f.s.frpTotal });
  const hot = found.filter((f) => flares(f.s)).sort((a, b) => b.s.frpTotal - a.s.frpTotal);
  out.flaring = hot.length;
  for (const f of hot) {
    if (Date.now() > deadline) break;
    try {
      const key = `flaring:v1:asset:${f.p.id}:${week}`;
      const [existing] = await requireDb().select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${key}`);
      if (!existing && repeats(last[f.p.id] ?? null, f.s, now)) continue;
      const box = boxAround(f.p.lon, f.p.lat, BOX_KM);
      const [heat, reported] = await Promise.all([heatAt(box).catch(() => null), reportedNear(f.p.lon, f.p.lat).catch(() => null)]);
      const card = cardFor(f.p, f.s, f.days, f.near, box, heat, reported, hist[f.p.id] ?? [], to);
      if (existing) {
        await requireDb().update(schema.edgeDetections).set({ title: card.title, summary: card.summary, why: card.why, confidence: card.confidence, magnitude: card.magnitude, visual: card.visual, observedAt: card.observedAt }).where(sql`${schema.edgeDetections.id} = ${existing.id}`);
        out.updated++;
      } else {
        const [row] = await requireDb().insert(schema.edgeDetections).values({ key, kind: "flaring", module: "earth", tickers: f.p.ticker ? [f.p.ticker] : [], assetIds: [f.p.id], bbox: box, ...card }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
        if (!row) continue;
        const retrieved = new Date();
        const sources: Provenance[] = [
          { sourceName: FIRMS.name, sourceUrl: `${FIRMS.url} (${[...seen.satellites].join(", ")}, seven-day files to ${to})`, license: FIRMS.license, method: `${FLARE_VERSION}: detections within ${RADIUS_KM} km of the plant, counted by day`, modelVersion: "", retrievedAt: retrieved },
          ...(heat ? [{ sourceName: SENTINEL.name, sourceUrl: `${SENTINEL.url} (scene ${heat.scene.id})`, license: SENTINEL.license, method: "shortwave-infrared heat: band 12 against band 11", modelVersion: "", retrievedAt: retrieved }] : []),
          ...(reported ? [{ sourceName: NM_OCD.name, sourceUrl: NM_OCD.url, license: NM_OCD.license, method: `reports within ${reported.radiusKm} km for ${reported.period}`, modelVersion: "", retrievedAt: retrieved }] : []),
          { sourceName: EIA_PLANTS.name, sourceUrl: EIA_PLANTS.url, license: EIA_PLANTS.license, method: `site location (${EIA_PLANTS.vintage})`, modelVersion: "", retrievedAt: retrieved },
        ];
        await record(`detection:${row.id}`, sources);
        last[f.p.id] = { at: new Date(now).toISOString(), days: f.s.days, frp: f.s.frpTotal };
        out.created.push(row.id);
      }
    } catch (e) {
      logError(e, { where: "edge-flares" });
    }
  }
  await cacheSet(HIST, JSON.stringify(hist), 400 * DAY);
  await cacheSet(LAST, JSON.stringify(last), 400 * DAY);
  return out;
}

/** A flaring week as a card's fields. */
function cardFor(p: Plant, s: FlareStats, days: FlareDay[], near: (Hotspot & { m: number })[], box: Bbox, heat: { scene: Scene; hot: number } | null, reported: Reported | null, history: FlareWeek[], to: string) {
  const owner = p.company || "an unmapped operator";
  const confidence = flareConfidence(s, heat?.hot ?? 0);
  const from = days[0].date;
  const glow = heat && heat.hot >= 3 ? ` Sentinel-2 caught the flare glowing in shortwave infrared on ${heat.scene.date} (${heat.hot} hot pixels).` : "";
  const rep = reported ? ` Operators within ${reported.radiusKm} km reported ${fmt(reported.flaredMcf)} Mcf flared and ${fmt(reported.ventedMcf)} Mcf vented to New Mexico for ${reported.period}.` : "";
  const before = history.filter((h) => h.week < isoWeek(to) && h.days > 0).length;
  const onRecord = history.length >= 3 ? ` It flared in ${before} of the ${history.length - 1} weeks before this one on Edge's record.` : "";
  return {
    title: `Flaring at ${p.name} on ${s.days} of the last ${DAYS} days`,
    summary: `NASA's VIIRS satellites saw ${s.detections} hot spot${s.detections === 1 ? "" : "s"} within ${RADIUS_KM} km of ${p.name} (${owner}${p.cap ? `, ${fmt(p.cap)} MMcfd` : ""}) between ${from} and ${to}, ${fmt(s.frpTotal, 1)} MW of radiant heat in all (the strongest ${fmt(s.frpMax, 1)} MW).${glow}${rep}${onRecord} A plant flares when it takes in gas it cannot process or send on: an upset, maintenance, or a full pipeline.`.slice(0, 1200),
    why: `Active-fire detections from VIIRS on ${s.satellites} satellite${s.satellites === 1 ? "" : "s"} (375 m pixels, by night and day) through NASA FIRMS, kept when within ${RADIUS_KM} km of the plant's mapped location; a day counts when at least one is seen. Gas flares are the steadiest heat in an oil field, but a detection can also be a neighbouring facility or a grass fire, and radiant heat tracks the gas burned only roughly.${heat ? " The Sentinel-2 image shows where the heat sits: band 12 against band 11 of its shortwave infrared, bright where something burns." : ""}${reported ? " New Mexico's numbers are what operators reported for the nearest facilities, not a measurement at this plant." : ""}`,
    confidence, magnitude: flareMagnitude(s), observedAt: new Date(`${to}T12:00:00Z`),
    visual: {
      type: "flaring", site: { name: p.name, kind: "processing_plant", company: p.company, ticker: p.ticker, lon: p.lon, lat: p.lat, capacityMMcfd: p.cap }, bbox: box,
      radiusKm: RADIUS_KM, days, stats: s,
      hits: near.filter((h) => days.some((d) => d.date === h.date)).slice(0, 40).map((h) => ({ lon: h.lon, lat: h.lat, frp: h.frp, date: h.date, time: h.time, sat: h.sat, conf: h.conf, night: h.night, m: h.m })),
      heat: heat ? { url: heatUrl(heat.scene, box), photo: cropUrl(heat.scene, box, 512), date: heat.scene.date, scene: heat.scene.id, hot: heat.hot } : null,
      reported, history,
    },
  };
}
