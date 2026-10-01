/**
 * Carbon Mapper methane plumes, ready to switch on (premium.ts, "methane-carbonmapper"): plumes seen by
 * the Tanager and EMIT imaging spectrometers (and Carbon Mapper's aircraft) within 2 km of watched plants
 * in the last 90 days, each with the emission rate Carbon Mapper estimates (kg/h) and its uncertainty.
 * The catalogue is free to read but its terms allow non-commercial use only, so nothing is fetched
 * unless CARBON_MAPPER_LICENSED=1 says YouBank has a commercial agreement. A plant with plumes on one
 * overpass becomes one card, with the plume picture kept on the card (Carbon Mapper's links expire).
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { COVERED } from "../assets";
import { metres } from "../flares";
import { upgradeOn } from "../premium";
import { record, type Provenance } from "../provenance";
import { watchedPlants, type Plant } from "../radar";
import { EIA_PLANTS, type Bbox, type SourceInfo } from "../sources/eia";
import { boxAround } from "../sources/sentinel";

export const CARBON_MAPPER: SourceInfo = {
  key: "carbon-mapper",
  name: "Carbon Mapper methane plumes (Tanager, EMIT and airborne imaging spectrometers)",
  url: "https://data.carbonmapper.org",
  license: "Data by Carbon Mapper, used under YouBank's commercial agreement (the public terms are non-commercial)",
  vintage: "plumes as published, with Carbon Mapper's automated emission estimates",
};

export const METHANE_VERSION = "methane v1";
const API = "https://api.carbonmapper.org/api/v1/catalog/plumes/annotated";
export const RADIUS_KM = 2;
const DAYS = 90;
const DAY = 86_400_000;
/** Largest plume picture kept on a card. */
const MAX_IMAGE = 200_000;

export type Plume = { id: string; scene: string; lon: number; lat: number; at: string; platform: string; rateKgH: number | null; uncertaintyKgH: number | null; image: string; gsdM: number | null };

/* ---------------- Pure pieces ---------------- */

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The catalogue query for methane plumes in a box and window, newest first. Pure. */
export const plumesUrl = (bbox: Bbox, from: Date, to: Date, limit = 500, offset = 0) =>
  `${API}?${bbox.map((v) => `bbox=${v.toFixed(4)}`).join("&")}&datetime=${iso(from)}/${iso(to)}&plume_gas=CH4&limit=${limit}&offset=${offset}&sort=desc`;

type Item = { plume_id?: string; scene_id?: string; gas?: string; geometry_json?: { type?: string; coordinates?: number[] } | null; scene_timestamp?: string; platform?: string; emission_auto?: number | null; emission_uncertainty_auto?: number | null; plume_rgb_png?: string; plume_png?: string; gsd?: number | null };

/** The catalogue's answer as plumes: methane, with a point and a time. Pure. */
export function plumesFrom(json: { items?: Item[] } | null | undefined): Plume[] {
  return (json?.items ?? []).flatMap((i): Plume[] => {
    const c = i.geometry_json?.type === "Point" ? i.geometry_json.coordinates : null;
    if (!i.plume_id || !c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || !i.scene_timestamp || (i.gas && i.gas !== "CH4")) return [];
    const num = (v: number | null | undefined) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
    return [{ id: i.plume_id, scene: i.scene_id ?? i.scene_timestamp, lon: c[0], lat: c[1], at: i.scene_timestamp, platform: i.platform ?? "", rateKgH: num(i.emission_auto), uncertaintyKgH: num(i.emission_uncertainty_auto), image: i.plume_rgb_png ?? i.plume_png ?? "", gsdM: typeof i.gsd === "number" ? Math.round(i.gsd) : null }];
  });
}

/** Plumes within `km` of a point, with their distance in metres, newest first. Pure. */
export function plumesNear(plumes: Plume[], lon: number, lat: number, km = RADIUS_KM): (Plume & { m: number })[] {
  return plumes.map((p) => ({ ...p, m: Math.round(metres(lon, lat, p.lon, p.lat)) })).filter((p) => p.m <= km * 1000).sort((a, b) => b.at.localeCompare(a.at) || a.m - b.m);
}

/** One overpass's plumes at a plant: the newest overpass's plumes, the rest as history. Pure. */
export function newestPass<T extends Plume>(near: T[]): { pass: T[]; earlier: T[] } {
  if (!near.length) return { pass: [], earlier: [] };
  const scene = near[0].scene;
  return { pass: near.filter((p) => p.scene === scene), earlier: near.filter((p) => p.scene !== scene) };
}

/** Summed emission rate and uncertainty (uncertainties added in quadrature) of plumes with estimates. Pure. */
export function totalRate(plumes: Pick<Plume, "rateKgH" | "uncertaintyKgH">[]): { rate: number; uncertainty: number; estimated: number } {
  const est = plumes.filter((p) => p.rateKgH !== null);
  return { rate: est.reduce((s, p) => s + (p.rateKgH ?? 0), 0), uncertainty: Math.round(Math.sqrt(est.reduce((s, p) => s + (p.uncertaintyKgH ?? 0) ** 2, 0))), estimated: est.length };
}

/** How sure Edge is the plant is the source: closer is surer; a rate known only roughly lowers it. Pure. */
export function methaneConfidence(nearestM: number, rate: number, uncertainty: number): number {
  const v = (nearestM <= 500 ? 0.85 : nearestM <= 1000 ? 0.72 : 0.58) - (rate > 0 && uncertainty / rate > 0.5 ? 0.1 : 0);
  return Math.round(Math.max(0.3, Math.min(0.95, v)) * 100) / 100;
}

/** How big, 0 to 1: two tonnes an hour or more counts in full. Pure. */
export const methaneMagnitude = (rateKgH: number) => Math.round(Math.max(0, Math.min(1, rateKgH / 2000)) * 100) / 100;

/* ---------------- Reading the catalogue ---------------- */

/** Whether YouBank may use the catalogue: a commercial agreement is in place and the switch says exactly 1 (not merely set). */
export const licensed = () => upgradeOn("methane-carbonmapper") && process.env.CARBON_MAPPER_LICENSED?.trim() === "1";

/** Methane plumes in a box over the last 90 days (up to three pages). Never called unless licensed. Kept six hours. */
export async function plumesIn(bbox: Bbox): Promise<Plume[]> {
  if (!licensed()) throw Object.assign(new Error("Carbon Mapper is not licensed."), { status: 404 });
  const bucket = Math.floor(Date.now() / (6 * 3_600_000));
  return cacheJson(`edge:carbonmapper:v1:${bbox.map((v) => v.toFixed(2)).join(",")}:${bucket}`, 6 * 3_600_000, async () => {
    const token = process.env.CARBON_MAPPER_TOKEN?.trim();
    const to = new Date(), from = new Date(to.getTime() - DAYS * DAY);
    const out: Plume[] = [];
    for (let page = 0; page < 3; page++) {
      const res = await fetch(plumesUrl(bbox, from, to, 500, page * 500), { headers: token ? { authorization: `Bearer ${token}` } : {}, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Carbon Mapper answered ${res.status}`);
      const j = (await res.json()) as { items?: Item[]; bbox_count?: number };
      const got = plumesFrom(j);
      out.push(...got);
      if ((j.items?.length ?? 0) < 500) break;
    }
    return out;
  });
}

/** A plume picture as a data URI, or "" when it cannot be had or is too big to keep. */
async function keepImage(url: string): Promise<string> {
  if (!/^https:\/\/[a-z0-9.-]*carbonmapper\.org\//i.test(url)) return "";
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return "";
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= MAX_IMAGE ? `data:${type.split(";")[0]};base64,${buf.toString("base64")}` : "";
  } catch { return ""; }
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");

/** One plant's newest overpass with methane as a card (the picture fetched once and kept). Exported for tests with fixtures. */
export async function plumeCard(p: Plant, near: (Plume & { m: number })[], getImage: (url: string) => Promise<string> = keepImage): Promise<number | null> {
  const { pass, earlier } = newestPass(near);
  if (!pass.length) return null;
  const date = pass[0].at.slice(0, 10);
  const key = `methane:v1:asset:${p.id}:${date}:${pass[0].scene}`.slice(0, 200);
  const [existing] = await requireDb().select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${key}`);
  if (existing) return null;
  const t = totalRate(pass), nearest = Math.min(...pass.map((x) => x.m));
  const owner = p.company || "an unmapped operator";
  const rateText = t.estimated ? `about ${fmt(t.rate)} kg of methane an hour (± ${fmt(t.uncertainty)})` : "methane, with no emission estimate yet";
  const image = pass[0].image ? await getImage(pass[0].image) : "";
  const title = t.estimated ? `Methane plume of about ${fmt(t.rate)} kg/h ${nearest <= 500 ? "at" : `${(nearest / 1000).toFixed(1)} km from`} ${p.name}` : `Methane plume seen ${nearest <= 500 ? "at" : "near"} ${p.name}`;
  const summary = `${pass[0].platform || "A Carbon Mapper instrument"} saw ${pass.length === 1 ? "a plume" : `${pass.length} plumes`} within ${RADIUS_KM} km of ${p.name} (${owner}${p.cap ? `, ${fmt(p.cap)} MMcfd` : ""}) on ${date}: ${rateText}, the nearest ${fmt(nearest)} m from the plant's mapped location.${earlier.length ? ` ${earlier.length} other plume${earlier.length === 1 ? " was" : "s were"} seen within ${RADIUS_KM} km in the ${DAYS} days before.` : ""} A plume is a snapshot of one overpass: leaks and venting come and go, and the source may be a neighbouring well pad or compressor rather than the plant. Data by Carbon Mapper.`;
  const why = `Imaging spectrometers see methane by the sunlight it absorbs in the shortwave infrared; Carbon Mapper finds plumes in each overpass, reviews them, and estimates the emission rate from the plume's mass and the wind (its automated estimate, with its uncertainty). Kept here when within ${RADIUS_KM} km of the plant; the nearer the plume, the likelier the plant is its source.`;
  const confidence = methaneConfidence(nearest, t.rate, t.uncertainty);
  const box = boxAround(p.lon, p.lat, RADIUS_KM * 2);
  const visual = {
    type: "methane_plume", site: { name: p.name, kind: "processing_plant", company: p.company, ticker: p.ticker, lon: p.lon, lat: p.lat, capacityMMcfd: p.cap }, radiusKm: RADIUS_KM, bbox: box,
    date, platform: pass[0].platform, rateKgH: t.estimated ? t.rate : null, uncertaintyKgH: t.estimated ? t.uncertainty : null, nearestM: nearest, image,
    plumes: pass.slice(0, 8).map((x) => ({ id: x.id, lon: x.lon, lat: x.lat, m: x.m, rateKgH: x.rateKgH, uncertaintyKgH: x.uncertaintyKgH })),
    earlier: earlier.slice(0, 12).map((x) => ({ id: x.id, date: x.at.slice(0, 10), m: x.m, rateKgH: x.rateKgH, platform: x.platform })),
    credit: "Data by Carbon Mapper",
  };
  const [row] = await requireDb().insert(schema.edgeDetections).values({
    key, kind: "methane_plume", module: "earth", title: title.slice(0, 200), summary: summary.slice(0, 1200), why, confidence, magnitude: methaneMagnitude(t.rate),
    tickers: p.ticker ? [p.ticker] : [], assetIds: [p.id], bbox: box, visual, observedAt: new Date(pass[0].at),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return null;
  const retrieved = new Date();
  const sources: Provenance[] = [
    { sourceName: CARBON_MAPPER.name, sourceUrl: `${CARBON_MAPPER.url} (plumes ${pass.map((x) => x.id).join(", ")})`, license: CARBON_MAPPER.license, method: `${METHANE_VERSION}: plumes within ${RADIUS_KM} km of the plant, Carbon Mapper's automated emission estimate`, modelVersion: "", retrievedAt: retrieved },
    { sourceName: EIA_PLANTS.name, sourceUrl: EIA_PLANTS.url, license: EIA_PLANTS.license, method: `site location (${EIA_PLANTS.vintage})`, modelVersion: "", retrievedAt: retrieved },
  ];
  await record(`detection:${row.id}`, sources);
  return row.id;
}

/** The daily methane pass: off (and nothing fetched) unless licensed; else every watched plant against the region's plumes of the last 90 days. */
export async function scanMethane(deadline: number): Promise<{ off: true } | { plumes: number; plants: number; created: number[] }> {
  if (!licensed()) return { off: true };
  const plumes = (await Promise.all(COVERED.map((c) => plumesIn(c.bbox)))).flat();
  const plants = await watchedPlants();
  const out = { plumes: plumes.length, plants: 0, created: [] as number[] };
  for (const p of plants) {
    if (Date.now() > deadline) break;
    const near = plumesNear(plumes, p.lon, p.lat);
    if (!near.length) continue;
    out.plants++;
    try { const id = await plumeCard(p, near); if (id) out.created.push(id); } catch (e) { logError(e, { where: "edge-methane" }); }
  }
  return out;
}
