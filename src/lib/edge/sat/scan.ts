/**
 * Edge's new satellite analyses, read from free, current imagery through Microsoft's Planetary Computer:
 *
 * - crop vigour: Sentinel-2 NDVI over cropland in its growing season, against the same three weeks of
 *   the four years before (ag names: ADM, Bunge, Corteva, Deere, Nutrien, Mosaic);
 * - water extent: the share of a box that is open water (Sentinel-2 MNDWI), against the same weeks of
 *   earlier years (the Panama Canal's Gatun Lake, lithium brine ponds, hydro reservoirs);
 * - vessel traffic: ships counted as bright targets on water in Sentinel-1 radar at LNG terminals and a
 *   container anchorage, against the passes of the last four months.
 *
 * Each site is looked at on its own cadence (least recently looked at first, within a deadline); a
 * reading that clears its minimum of evidence and thresholds becomes a feed card, with its method,
 * baseline and caveats, and its sources in the audit trail. Scoring is in ./score.ts.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { fetchRetry } from "@/lib/net";
import { isoWeek } from "../flares";
import { record } from "../provenance";
import type { Bbox } from "../sources/eia";
import { radarScenes, radarUrl, readPass, S1, type RadarScene } from "../sources/s1";
import { boxAround, scenes, SENTINEL, type Scene } from "../sources/sentinel";
import { parseNpy } from "../terrain";
import { assess, brightTargets, inSeason, ndviStats, sameWindowEarlier, satConfidence, satMagnitude, waterMask, waterShare, type Assessment, type Baseline } from "./score";
import { SAT_SITES, type SatAnalysis, type SatSite } from "./sites";

export const SAT_VERSION = "sat v1";
const DATA = "https://planetarycomputer.microsoft.com/api/data/v1";
const DAY = 86_400_000;
const WINDOW_DAYS = 21;
const SIZE = 128;

export type SatReading = { date: string; scene: string; value: number; valid: number };
export type SatVisual = {
  type: "sat_analysis"; analysis: SatAnalysis;
  site: { id: string; name: string; region: string; lon: number; lat: number; km: number };
  metric: { label: string; unit: "ndvi" | "share" | "ships"; current: number; date: string; baseline: Baseline; mean: number; sd: number; z: number; pct: number; n: number; direction: Assessment["direction"] };
  image: { url: string; date: string; caption: string } | null;
  thesis: string; method: string; caveats: string;
  firstSeenAt?: string; updatedAt?: string;
};

/* ---------------- Pure pieces ---------------- */

/** One radar acquisition per date and orbit, its slices merged, kept when together they cover the box. Pure. */
export function passesFrom(scenesIn: RadarScene[]): { key: string; date: string; ids: string[] }[] {
  const by = new Map<string, { key: string; date: string; ids: string[]; corners: number }>();
  for (const s of scenesIn) {
    const key = `${s.date}:${s.orbit}:${s.relOrbit}`;
    const cur = by.get(key) ?? { key, date: s.date, ids: [], corners: 0 };
    cur.ids.push(s.id); cur.corners |= s.corners; by.set(key, cur);
  }
  return [...by.values()].filter((p) => p.corners === 15).sort((a, b) => b.date.localeCompare(a.date)).map(({ key, date, ids }) => ({ key, date, ids }));
}

/** A mask as base64 bits, and back. Pure. */
export const packMask = (m: Uint8Array) => { const out = new Uint8Array(Math.ceil(m.length / 8)); m.forEach((v, i) => { if (v) out[i >> 3] |= 1 << (i & 7); }); return Buffer.from(out).toString("base64"); };
export const unpackMask = (b64: string, n: number) => { const bits = Buffer.from(b64, "base64"); const out = new Uint8Array(n); for (let i = 0; i < n; i++) out[i] = (bits[i >> 3] >> (i & 7)) & 1; return out; };

/** Whether a reading only repeats the site's last card: within two weeks, the same direction and no stronger. Pure. */
export function satRepeats(last: { at: string; direction: string; z: number } | null | undefined, a: Pick<Assessment, "direction" | "z">, now: number): boolean {
  if (!last) return false;
  if (now - Date.parse(last.at) > 14 * DAY) return false;
  return last.direction === a.direction && Math.abs(a.z) < Math.abs(last.z) + 1;
}

const pct = (x: number) => `${x >= 0 ? "+" : ""}${Math.round(x * 100)}%`;
const fmt = (v: number, dp = 2) => v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

/** A finding's words: title, summary, why. Pure. */
export function describeSat(site: Pick<SatSite, "name" | "analysis" | "companies">, a: Assessment, date: string, baseline: Baseline): { title: string; summary: string } {
  const up = a.direction === "up";
  const base = baseline.map((b) => b.label).join(", ");
  if (site.analysis === "crop_vigour") {
    return {
      title: `${up ? "Greener" : "Less green"} than usual: ${site.name}`,
      summary: `Sentinel-2 on ${date} puts the average NDVI of clear cropland at ${fmt(a.current)}, against ${fmt(a.mean)} in the same weeks of ${base} (${pct(a.pct)}, ${fmt(Math.abs(a.z), 1)} standard deviations ${up ? "above" : "below"}). ${up ? "A greener canopy than in those years points to a crop in good condition" : "A thinner canopy than in those years can mean drought or heat stress, late planting or an early harvest"}. Companies exposed: ${site.companies.join(", ")}.`,
    };
  }
  if (site.analysis === "water_extent") {
    return {
      title: `${up ? "More" : "Less"} open water than usual: ${site.name}`,
      summary: `Sentinel-2 on ${date} shows ${Math.round(a.current * 100)}% of the clear box as open water, against ${Math.round(a.mean * 100)}% in the same weeks of ${base} (${pct(a.pct)}, ${fmt(Math.abs(a.z), 1)} standard deviations ${up ? "above" : "below"}). Companies exposed: ${site.companies.join(", ")}.`,
    };
  }
  return {
    title: `${up ? "More" : "Fewer"} ships than usual: ${site.name}`,
    summary: `Sentinel-1 radar on ${date} counts ${Math.round(a.current)} ship-sized bright targets on the water, against ${fmt(a.mean, 1)} on average over the ${a.n} passes before (${pct(a.pct)}, ${fmt(Math.abs(a.z), 1)} standard deviations ${up ? "above" : "below"}). Companies exposed: ${site.companies.join(", ")}.`,
  };
}

export const METHOD: Record<SatAnalysis, { method: string; caveats: string; label: string; unit: SatVisual["metric"]["unit"] }> = {
  crop_vigour: {
    label: "NDVI of clear cropland", unit: "ndvi",
    method: `${SAT_VERSION}: mean NDVI (near infrared B08 against red B04) over pixels Sentinel-2's scene classification calls vegetation or bare soil, in the clearest scene of the last ${WINDOW_DAYS} days; the same for the same weeks of each of the four years before; a z-score (standard deviation floored at 0.03) and a percent change; a signal needs three earlier years, 40% of the box clear, at least 2 standard deviations and 8%.`,
    caveats: "One box is a sample of a region, not the whole crop. Planting dates move NDVI from year to year (a late spring looks like a weak crop for a few weeks), irrigation masks drought, and NDVI saturates in a dense canopy. Check it against USDA's crop progress and condition reports.",
  },
  water_extent: {
    label: "Share of the box that is open water", unit: "share",
    method: `${SAT_VERSION}: the share of clear pixels with a positive modified normalised difference water index (green B03 against shortwave infrared B11) in the clearest Sentinel-2 scene of the last ${WINDOW_DAYS} days, against the same weeks of each of the four years before; a signal needs three earlier years, 40% of the box clear, at least 2 standard deviations and 10%.`,
    caveats: "Area is not volume: a steep shore hides a large fall in level, and a shallow one exaggerates it. Wind, algae and sediment change how water looks in the infrared; brine ponds are drained and refilled on schedules of their own.",
  },
  vessel_traffic: {
    label: "Ships on the water", unit: "ships",
    method: `${SAT_VERSION}: in each Sentinel-1 radar pass (VV, 10 m RTC) of the last four months, groups of bright pixels (above -5 dB) on water (below -15 dB in the median of several passes), 2 to 2,000 pixels, counted as ships; the newest pass against the ones before; a signal needs six earlier passes, at least 2 standard deviations and 30%.`,
    caveats: "A pass is a snapshot every six to twelve days, so a busy morning can look like a trend. Tugs, barges and buoys can count as ships, ships alongside a berth can merge with the quay, and a pass from another orbit sees the anchorage at another angle.",
  },
};

/* ---------------- Reading the imagery ---------------- */

/** Some Sentinel-2 bands of a scene over a box, as stored, size by size. */
async function readS2(scene: Scene, box: Bbox, assets: string[]): Promise<Float32Array[]> {
  const url = `${DATA}/item/bbox/${box.map((v) => v.toFixed(5)).join(",")}/${SIZE}x${SIZE}.npy?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&${assets.map((a) => `assets=${a}`).join("&")}&resampling=nearest`;
  const res = await fetchRetry(url, { cache: "no-store", timeoutMs: 30_000 });
  if (!res.ok) throw new Error(`Sentinel-2 read answered ${res.status}`);
  const { data } = parseNpy(new Uint8Array(await res.arrayBuffer()));
  const n = SIZE * SIZE;
  return assets.map((_, k) => data.slice(k * n, (k + 1) * n));
}

const indexUrl = (scene: Scene, box: Bbox, analysis: SatAnalysis) => {
  const expr = analysis === "crop_vigour" ? "(B08-B04)/(B08+B04)" : "(B03-B11)/(B03+B11)";
  const style = analysis === "crop_vigour" ? "rescale=0,0.9&colormap_name=rdylgn" : "rescale=-0.6,0.6&colormap_name=rdbu";
  return `${DATA}/item/bbox/${box.map((v) => v.toFixed(5)).join(",")}/512x512.png?collection=sentinel-2-l2a&item=${encodeURIComponent(scene.id)}&expression=${encodeURIComponent(expr)}&asset_as_band=true&${style}&nodata=0`;
};

/** The clearest scene in a window whose reading has enough clear pixels (the two clearest tried). */
async function readingIn(box: Bbox, from: Date, to: Date, analysis: "crop_vigour" | "water_extent"): Promise<(SatReading & { sceneObj: Scene }) | null> {
  const found = (await scenes(box, from, to, 40, 12)).sort((a, b) => a.cloud - b.cloud).slice(0, 2);
  for (const sc of found) {
    const bands = await readS2(sc, box, analysis === "crop_vigour" ? ["B04", "B08", "SCL"] : ["B03", "B11", "SCL"]).catch(() => null);
    if (!bands) continue;
    const r = analysis === "crop_vigour" ? ndviStats(bands[0], bands[1], bands[2], sc.date) : waterShare(bands[0], bands[1], bands[2], sc.date);
    if (Number.isFinite(r.value) && r.valid >= 0.3) return { date: sc.date, scene: sc.id, value: r.value, valid: r.valid, sceneObj: sc };
  }
  return null;
}

type Outcome = { reading: SatReading; baseline: Baseline; a: Assessment; image: SatVisual["image"]; source: { name: string; url: string; license: string } } | { skip: string };

async function opticalAt(site: SatSite, now: Date): Promise<Outcome> {
  if (site.analysis !== "crop_vigour" && site.analysis !== "water_extent") return { skip: "not optical" };
  if (!inSeason(now.getUTCMonth() + 1, site.season)) return { skip: "out of season" };
  const box = boxAround(site.lon, site.lat, site.km);
  const cur = await readingIn(box, new Date(now.getTime() - WINDOW_DAYS * DAY), now, site.analysis);
  if (!cur) return { skip: "no clear scene in the last three weeks" };
  const years = sameWindowEarlier(now, WINDOW_DAYS, 4);
  const past = await Promise.all(years.map((y) => readingIn(box, y.from, y.to, site.analysis as "crop_vigour" | "water_extent").catch(() => null)));
  const baseline: Baseline = past.flatMap((p, k) => (p ? [{ label: String(years[k].year), value: Math.round(p.value * 1000) / 1000 }] : []));
  const a = site.analysis === "crop_vigour"
    ? assess(cur.value, baseline, { minN: 3, zMin: 2, pctMin: 0.08, sdFloor: 0.03, validShare: cur.valid })
    : assess(cur.value, baseline, { minN: 3, zMin: 2, pctMin: 0.1, sdFloor: 0.01, validShare: cur.valid });
  return {
    reading: { date: cur.date, scene: cur.scene, value: cur.value, valid: cur.valid }, baseline, a,
    image: { url: indexUrl(cur.sceneObj, box, site.analysis), date: cur.date, caption: site.analysis === "crop_vigour" ? "NDVI: green is dense, healthy canopy; red is bare or stressed" : "Water index: blue is open water" },
    source: { name: SENTINEL.name, url: `${SENTINEL.url} (scene ${cur.scene})`, license: SENTINEL.license },
  };
}

type VesselState = { mask?: string; counts: Record<string, { date: string; n: number }> };
const VESSELS = "edge:sat:vessels:v1";
const RADAR_SIZE = (km: number) => Math.min(384, Math.max(256, Math.round(km * 32)));

async function vesselsAt(site: SatSite, now: Date, store: Record<string, VesselState>): Promise<Outcome> {
  const box = boxAround(site.lon, site.lat, site.km), size = RADAR_SIZE(site.km);
  const passes = passesFrom(await radarScenes(box, new Date(now.getTime() - 120 * DAY), now, 80)).slice(0, 16);
  if (passes.length < 4) return { skip: "too few radar passes" };
  const st: VesselState = store[site.id] ?? { counts: {} };
  let mask: Uint8Array = st.mask ? unpackMask(st.mask, size * size) : new Uint8Array(0);
  if (!mask.length) {
    const first = passes.slice(0, 5);
    const reads = await Promise.all(first.map((p) => readPass({ date: p.date, ids: p.ids }, box, size).catch(() => null)));
    const good = first.flatMap((p, k) => { const r = reads[k]; return r && r.coverage > 0.8 ? [{ p, r }] : []; });
    if (good.length < 3) return { skip: "radar passes did not read" };
    const m = waterMask(good.map((g) => g.r));
    mask = m;
    st.mask = packMask(m);
    for (const { p, r } of good) st.counts[p.key] = { date: p.date, n: brightTargets(r.vv, r.valid, m, size).count };
  }
  for (const p of passes) {
    if (st.counts[p.key]) continue;
    const r = await readPass({ date: p.date, ids: p.ids }, box, size).catch(() => null);
    if (r && r.coverage > 0.8) st.counts[p.key] = { date: p.date, n: brightTargets(r.vv, r.valid, mask, size).count };
  }
  // Keep four months of counts.
  const cutoff = new Date(now.getTime() - 130 * DAY).toISOString().slice(0, 10);
  st.counts = Object.fromEntries(Object.entries(st.counts).filter(([, v]) => v.date >= cutoff));
  store[site.id] = st;
  const ordered = Object.entries(st.counts).sort(([, a], [, b]) => b.date.localeCompare(a.date));
  if (!ordered.length) return { skip: "no counted pass" };
  const [latestKey, latest] = ordered[0];
  const baseline: Baseline = ordered.slice(1).reverse().map(([, v]) => ({ label: v.date, value: v.n }));
  const water = mask.reduce((t, v) => t + v, 0) / mask.length;
  const a = assess(latest.n, baseline, { minN: 6, zMin: 2, pctMin: 0.3, sdFloor: 1, validShare: water, minValid: 0.15 });
  const ids = passes.find((p) => p.key === latestKey)?.ids ?? [];
  return {
    reading: { date: latest.date, scene: ids.join(", "), value: latest.n, valid: water }, baseline, a,
    image: ids[0] ? { url: radarUrl(ids[0], box, 512), date: latest.date, caption: "Radar: ships are the bright points on the dark water" } : null,
    source: { name: S1.name, url: `${S1.url} (${ids.join(", ")})`, license: S1.license },
  };
}

/* ---------------- The pass ---------------- */

const LAST = "edge:sat:last:v1", CARDS = "edge:sat:cards:v1";
const readJson = async <T,>(key: string, fallback: T): Promise<T> => { try { const v = await cacheGet(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; } };

/** Sites due for a look, least recently looked at first. Pure. */
export function dueSites(sites: SatSite[], last: Record<string, string>, now: number): SatSite[] {
  return sites.filter((s) => !last[s.id] || now - Date.parse(last[s.id]) >= s.everyDays * DAY - 2 * 3_600_000)
    .sort((a, b) => (last[a.id] ?? "").localeCompare(last[b.id] ?? ""));
}

export type SatScan = { due: number; checked: number; skipped: Record<string, string>; created: number[]; updated: number };

/** The daily pass over the analysis sites, within the deadline. Returns new cards' ids (for alerts and deal checks). */
export async function scanSatellite(deadline: number, maxSites = 8): Promise<SatScan> {
  const now = new Date();
  const last = await readJson<Record<string, string>>(LAST, {});
  const cards = await readJson<Record<string, { at: string; direction: string; z: number }>>(CARDS, {});
  const vessels = await readJson<Record<string, VesselState>>(VESSELS, {});
  const due = dueSites(SAT_SITES, last, now.getTime());
  const out: SatScan = { due: due.length, checked: 0, skipped: {}, created: [], updated: 0 };
  for (const site of due.slice(0, maxSites)) {
    if (Date.now() > deadline - 20_000) break;
    try {
      const r = site.analysis === "vessel_traffic" ? await vesselsAt(site, now, vessels) : await opticalAt(site, now);
      last[site.id] = now.toISOString();
      out.checked++;
      if ("skip" in r) { out.skipped[site.id] = r.skip; continue; }
      if (!r.a.signal) continue;
      const key = `${site.analysis}:v1:${site.id}:${isoWeek(r.reading.date)}`;
      const [existing] = await requireDb().select({ id: schema.edgeDetections.id, visual: schema.edgeDetections.visual }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${key}`);
      if (!existing && satRepeats(cards[site.id], r.a, now.getTime())) continue;
      const words = describeSat(site, r.a, r.reading.date, r.baseline);
      const m = METHOD[site.analysis];
      const stamp = now.toISOString();
      const visual: SatVisual = {
        type: "sat_analysis", analysis: site.analysis, site: { id: site.id, name: site.name, region: site.region, lon: site.lon, lat: site.lat, km: site.km },
        metric: { label: m.label, unit: m.unit, current: r.a.current, date: r.reading.date, baseline: r.baseline, mean: r.a.mean, sd: r.a.sd, z: r.a.z, pct: r.a.pct, n: r.a.n, direction: r.a.direction },
        image: r.image, thesis: site.thesis, method: m.method, caveats: m.caveats,
        firstSeenAt: (existing?.visual as SatVisual | undefined)?.firstSeenAt ?? stamp, updatedAt: stamp,
      };
      const fields = {
        title: words.title.slice(0, 200), summary: `${words.summary} ${site.thesis}`.slice(0, 1400), why: `${m.method} ${m.caveats}`,
        confidence: satConfidence(r.a, r.reading.valid), magnitude: satMagnitude(r.a), visual: visual as unknown as Record<string, unknown>, observedAt: new Date(`${r.reading.date}T12:00:00Z`),
      };
      if (existing) {
        await requireDb().update(schema.edgeDetections).set(fields).where(sql`${schema.edgeDetections.id} = ${existing.id}`);
        out.updated++;
        continue;
      }
      const [row] = await requireDb().insert(schema.edgeDetections).values({ key, kind: site.analysis, module: "earth", tickers: site.tickers, assetIds: [], bbox: boxAround(site.lon, site.lat, site.km), ...fields }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
      if (!row) continue;
      await record(`detection:${row.id}`, [{ sourceName: r.source.name, sourceUrl: r.source.url, license: r.source.license, method: m.method.slice(0, 300), modelVersion: "", retrievedAt: now }]);
      cards[site.id] = { at: stamp, direction: r.a.direction, z: r.a.z };
      out.created.push(row.id);
    } catch (e) {
      logError(e, { where: `edge-sat:${site.id}` });
    }
  }
  await Promise.all([cacheSet(LAST, JSON.stringify(last), 400 * DAY), cacheSet(CARDS, JSON.stringify(cards), 400 * DAY), cacheSet(VESSELS, JSON.stringify(vessels), 60 * DAY)]).catch((e) => logError(e, { where: "edge-sat-state" }));
  return out;
}
