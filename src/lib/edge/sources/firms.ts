/**
 * Heat seen from space: NASA FIRMS active-fire detections from the VIIRS instruments on Suomi NPP,
 * NOAA-20 and NOAA-21 (375 m pixels, each satellite passing by night and by day, within about three hours
 * of the pass). In an oil field the steadiest hot spots are gas flares. The rolling seven-day and 24-hour
 * files for the contiguous US need no key; the 24-hour files are read every hour (the flare pass), the
 * seven-day ones once a day, and only the boxes Edge maps are kept.
 */
import { cacheJson } from "@/lib/cache";
import type { Bbox, SourceInfo } from "./eia";
import { fetchRetry } from "@/lib/net";

export const FIRMS: SourceInfo = {
  key: "nasa-firms-viirs",
  name: "NASA FIRMS VIIRS 375 m active fire detections (Suomi NPP, NOAA-20, NOAA-21)",
  url: "https://firms.modaps.eosdis.nasa.gov/active_fire/",
  license: "NASA open data, no restrictions (cite NASA FIRMS, doi 10.5067/FIRMS/VIIRS/VNP14IMGT_NRT.002)",
  vintage: "near real time, rolling seven days",
};

const FILES: { dir: string; file: string; sat: string }[] = [
  { dir: "suomi-npp-viirs-c2", file: "SUOMI_VIIRS_C2", sat: "Suomi NPP" },
  { dir: "noaa-20-viirs-c2", file: "J1_VIIRS_C2", sat: "NOAA-20" },
  { dir: "noaa-21-viirs-c2", file: "J2_VIIRS_C2", sat: "NOAA-21" },
];

export type Hotspot = {
  lon: number; lat: number; date: string; time: string; sat: string;
  /** VIIRS confidence: low, nominal or high. */
  conf: "low" | "nominal" | "high";
  /** Fire radiative power, megawatts. */
  frp: number;
  night: boolean;
};

const CONF: Record<string, Hotspot["conf"]> = { l: "low", low: "low", n: "nominal", nominal: "nominal", h: "high", high: "high" };
const SAT: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21", "1": "NOAA-20", "2": "NOAA-21" };

/** A FIRMS VIIRS CSV as hot spots, optionally only those inside a box. Pure. */
export function parseFirmsCsv(text: string, bbox?: Bbox): Hotspot[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const col = (name: string) => head.indexOf(name);
  const [iLat, iLon, iDate, iTime, iSat, iConf, iFrp, iDn] = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "confidence", "frp", "daynight"].map(col);
  if (iLat < 0 || iLon < 0 || iDate < 0) return [];
  const out: Hotspot[] = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(",");
    const lat = Number(c[iLat]), lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (bbox && (lon < bbox[0] || lon > bbox[2] || lat < bbox[1] || lat > bbox[3])) continue;
    const time = String(c[iTime] ?? "").padStart(4, "0");
    out.push({
      lon, lat, date: c[iDate], time, sat: SAT[c[iSat]] ?? c[iSat] ?? "", conf: CONF[(c[iConf] ?? "").toLowerCase()] ?? "nominal",
      frp: Math.max(0, Number(c[iFrp]) || 0), night: (c[iDn] ?? "").toUpperCase() === "N",
    });
  }
  return out;
}

/** The FIRMS file for one satellite and window ("24h" for the hourly pass, "7d" for the daily one). Pure. */
export const firmsFileUrl = (f: { dir: string; file: string }, window: "24h" | "7d") =>
  `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${f.dir}/csv/${f.file}_USA_contiguous_and_Hawaii_${window}.csv`;

/**
 * Hot spots in a box from all three satellites (a file that fails is skipped): the last seven days, shared
 * for three hours, or the last 24 hours, shared for half an hour (the hourly flare pass reads these: new
 * passes land in them within about three hours of the overpass, and they are a seventh of the size).
 */
export async function hotspots(bbox: Bbox, window: "24h" | "7d" = "7d"): Promise<{ spots: Hotspot[]; satellites: string[] }> {
  const ttl = window === "24h" ? 30 * 60_000 : 3 * 3_600_000;
  const bucket = Math.floor(Date.now() / ttl);
  return cacheJson(`edge:firms:v1:${window}:${bbox.map((v) => v.toFixed(2)).join(",")}:${bucket}`, ttl, async () => {
    const got = await Promise.all(FILES.map(async (f) => {
      try {
        const res = await fetchRetry(firmsFileUrl(f, window), { cache: "no-store", timeoutMs: window === "24h" ? 25_000 : 40_000 });
        if (!res.ok) return null;
        return { sat: f.sat, spots: parseFirmsCsv(await res.text(), bbox) };
      } catch { return null; }
    }));
    const ok = got.filter((g): g is { sat: string; spots: Hotspot[] } => !!g);
    if (!ok.length) throw new Error("NASA FIRMS did not answer");
    return { spots: ok.flatMap((g) => g.spots), satellites: ok.map((g) => g.sat) };
  });
}
