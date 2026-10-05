/**
 * Flare volumes from EOG's VIIRS Nightfire (premium: edge.nightfire). Nightfire fits a Planck curve to
 * each hot spot the VIIRS instruments see at night and reports its temperature and radiant heat (RH,
 * in megawatts); gas flares burn at 1,400 to 2,000 K, well apart from wildfires. EOG's published
 * calibration turns a flare's average radiant heat into a flared volume: 0.0274 billion cubic metres a
 * year per MW (Elvidge et al. 2016, used for the World Bank's flaring estimates). Here a plant's flares
 * over the last nights are averaged over every night looked at (a night without a detection counts as
 * no heat, which understates flares hidden by cloud), and the volume is given in million cubic feet a
 * day, labelled an estimate.
 *
 * Access is licensed: the nightly "ez" CSV files need an EOG account (NIGHTFIRE_USER and
 * NIGHTFIRE_PASSWORD) signed in through EOG's OpenID service. Nothing is read until someone whose plan
 * includes it presses the button on a plant's panel; each night's file, cut down to the regions Edge
 * covers, is then kept a week, so other plants and people reuse it.
 */
import { gunzipSync } from "node:zlib";
import { cacheJson } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { COVERED } from "../assets";
import type { Bbox } from "../sources/eia";

export const NIGHTFIRE = { name: "VIIRS Nightfire (Earth Observation Group, Colorado School of Mines)", url: "https://eogdata.mines.edu/products/vnf/", license: "VIIRS Nightfire Data Use License" };
/** EOG's calibration: billion cubic metres a year per MW of average radiant heat. */
export const BCM_PER_MW_YEAR = 0.0274;
/** 1 bcm = 35,314.67 million cubic feet. */
const MMCF_PER_BCM = 35_314.67;
export const RADIUS_KM = 2;
export const NIGHTS = 7;

const TOKEN_URL = () => process.env.NIGHTFIRE_TOKEN_URL?.trim() || "https://eogauth.mines.edu/auth/realms/master/protocol/openid-connect/token";
/** EOG's download client, as its published download script uses; NIGHTFIRE_CLIENT_SECRET overrides it. */
const CLIENT_ID = () => process.env.NIGHTFIRE_CLIENT_ID?.trim() || "eogdata_oidc";
const CLIENT_SECRET = () => process.env.NIGHTFIRE_CLIENT_SECRET?.trim() || "2677ad81-521b-4869-8480-6d05b9e57d48";
/** One night's file for one satellite: {sat} is npp or j01, {date} YYYYMMDD. */
const URL_TEMPLATE = () => process.env.NIGHTFIRE_URL_TEMPLATE?.trim() || "https://eogdata.mines.edu/wwwdata/viirs_products/vnf/v30//VNF_{sat}_d{date}_noaa_v30-ez.csv.gz";
const SATS = ["npp", "j01"];

export type Detection = { lon: number; lat: number; tempK: number; rhMw: number; at: string; sat: string };
export type FlareVolume = {
  nights: number; nightsRead: number; radiusKm: number; detections: number; nightsSeen: number;
  avgRhMw: number; peakTempK: number; mmcfd: number; bcmYear: number;
  flares: { lon: number; lat: number; km: number; detections: number; avgRhMw: number; tempK: number; mmcfd: number }[];
  source: typeof NIGHTFIRE; method: string;
};

/* ---------------- Pure pieces ---------------- */

/** Average radiant heat (MW) as million cubic feet a day, by EOG's calibration. Pure. */
export const mwToMmcfd = (mw: number) => (mw * BCM_PER_MW_YEAR * MMCF_PER_BCM) / 365;

const col = (head: string[], ...names: RegExp[]) => { for (const n of names) { const i = head.findIndex((h) => n.test(h)); if (i >= 0) return i; } return -1; };

/**
 * A night's ez CSV as detections, keeping only those inside the boxes and hot enough to be a gas flare
 * (over 1,200 K; wildfires and industrial heat burn cooler). Columns are found by name. Pure.
 */
export function parseVnf(csv: string, sat: string, boxes: Bbox[]): Detection[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const head = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const iLat = col(head, /^lat_gmtco$/i, /^lat/i), iLon = col(head, /^lon_gmtco$/i, /^lon/i);
  const iRh = col(head, /^rh$/i, /^rh_/i), iT = col(head, /^temp_bb$/i, /^temp/i), iDate = col(head, /^date_mscan$/i, /^date/i);
  if (iLat < 0 || iLon < 0 || iRh < 0 || iT < 0) throw new Error("A Nightfire file is missing its location, heat or temperature columns");
  const inside = (lon: number, lat: number) => boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
  const out: Detection[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const lat = Number(c[iLat]), lon = Number(c[iLon]), rh = Number(c[iRh]), t = Number(c[iT]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(rh) || !Number.isFinite(t) || rh <= 0 || t < 1200 || t > 3000) continue;
    if (!inside(lon, lat)) continue;
    out.push({ lon, lat, tempK: Math.round(t), rhMw: rh, at: iDate >= 0 ? String(c[iDate] ?? "").trim() : "", sat });
  }
  return out;
}

const kmBetween = (aLon: number, aLat: number, bLon: number, bLat: number) => {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
};

/**
 * The flares near a plant over the nights read: detections within the radius grouped into flares
 * (within 750 m of each other), each flare's radiant heat averaged per night over every night read,
 * and the volumes by EOG's calibration. Pure.
 */
export function volumesNear(dets: Detection[], lon: number, lat: number, nightsRead: number, radiusKm = RADIUS_KM): Omit<FlareVolume, "nights" | "source" | "method"> {
  const near = dets.map((d) => ({ ...d, km: kmBetween(lon, lat, d.lon, d.lat) })).filter((d) => d.km <= radiusKm);
  const groups: (typeof near)[] = [];
  for (const d of near.sort((a, b) => b.rhMw - a.rhMw)) {
    const g = groups.find((x) => kmBetween(x[0].lon, x[0].lat, d.lon, d.lat) <= 0.75);
    if (g) g.push(d); else groups.push([d]);
  }
  const n = Math.max(1, nightsRead);
  // A night's heat is the mean of that night's passes (two satellites can both see a flare).
  const perNight = (ds: typeof near) => {
    const nights = new Map<string, number[]>();
    for (const d of ds) { const k = d.at.slice(0, 8) || d.at; nights.set(k, [...(nights.get(k) ?? []), d.rhMw]); }
    return [...nights.values()].reduce((s, v) => s + v.reduce((a, b) => a + b, 0) / v.length, 0) / n;
  };
  const flares = groups.map((g) => {
    const avg = perNight(g);
    return { lon: g[0].lon, lat: g[0].lat, km: Math.round(g[0].km * 100) / 100, detections: g.length, avgRhMw: Math.round(avg * 1000) / 1000, tempK: Math.max(...g.map((d) => d.tempK)), mmcfd: Math.round(mwToMmcfd(avg) * 100) / 100 };
  });
  const avgRhMw = flares.reduce((s, f) => s + f.avgRhMw, 0);
  return {
    nightsRead, radiusKm, detections: near.length, nightsSeen: new Set(near.map((d) => d.at.slice(0, 8) || d.at)).size,
    avgRhMw: Math.round(avgRhMw * 1000) / 1000, peakTempK: near.length ? Math.max(...near.map((d) => d.tempK)) : 0,
    mmcfd: Math.round(mwToMmcfd(avgRhMw) * 100) / 100, bcmYear: Math.round(avgRhMw * BCM_PER_MW_YEAR * 10_000) / 10_000, flares,
  };
}

/** The last `n` UTC dates before today, as YYYYMMDD (today's file is still being written). Pure. */
export function lastNights(n: number, now = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => new Date(now.getTime() - (i + 1) * 86_400_000).toISOString().slice(0, 10).replace(/-/g, ""));
}

/* ---------------- Reading ---------------- */

let token: { value: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  if (token && token.until > Date.now() + 30_000) return token.value;
  const user = process.env.NIGHTFIRE_USER?.trim(), password = process.env.NIGHTFIRE_PASSWORD?.trim();
  if (!user || !password) throw new Error("Nightfire is not set up.");
  const res = await fetch(TOKEN_URL(), {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ client_id: CLIENT_ID(), client_secret: CLIENT_SECRET(), username: user, password, grant_type: "password" }),
  });
  if (!res.ok) throw new Error(`EOG sign-in answered ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("EOG sign-in gave no token");
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 300) * 1000 };
  return token.value;
}

/** One night's detections in the covered regions (both satellites), kept a week. Null when the night's files are not there (or could not be read). */
async function night(date: string): Promise<Detection[] | null> {
  return cacheJson(`edge:nightfire:${date}`, 7 * 86_400_000, async () => {
    const boxes = COVERED.map((c) => c.bbox);
    let found = false;
    const out: Detection[] = [];
    for (const sat of SATS) {
      const url = URL_TEMPLATE().replace("{sat}", sat).replace("{date}", date);
      const res = await fetch(url, { headers: { authorization: `Bearer ${await accessToken()}` }, cache: "no-store", signal: AbortSignal.timeout(60_000) });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`Nightfire answered ${res.status} for ${date}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : new TextDecoder().decode(buf);
      out.push(...parseVnf(text, sat, boxes));
      found = true;
    }
    // A night not posted yet is not cached, so it is looked for again next time.
    if (!found) throw Object.assign(new Error(`No Nightfire file for ${date} yet`), { missing: true });
    return out;
  }).catch((e) => { if (!(e as { missing?: boolean }).missing) logError(e, { where: "edge-nightfire-night" }); return null; });
}

/** A plant's flare volumes over the last nights. Reads (and caches) each night's file. */
export async function flareVolumes(lon: number, lat: number, nights = NIGHTS): Promise<FlareVolume> {
  const dates = lastNights(nights + 1);
  const read: Detection[][] = [];
  for (const d of dates) {
    if (read.length >= nights) break;
    const x = await night(d);
    if (x) read.push(x);
  }
  if (!read.length) throw Object.assign(new Error("Nightfire's recent files could not be read; try again later."), { status: 502 });
  return {
    nights, ...volumesNear(read.flat(), lon, lat, read.length), source: NIGHTFIRE,
    method: `VIIRS Nightfire v3.0 detections over 1,200 K within ${RADIUS_KM} km, radiant heat averaged over ${read.length} night${read.length === 1 ? "" : "s"} (no detection counts as none), volume by EOG's calibration of ${BCM_PER_MW_YEAR} bcm a year per MW. An estimate: cloud hides flares, and the calibration is a global fit.`,
  };
}
