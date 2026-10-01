/**
 * What operators report flaring and venting in New Mexico: the Oil Conservation Division's C-115B
 * natural gas waste reports, by facility and month (gathering systems, tank batteries and other
 * facilities), from its public map service. No key. Texas has no comparable map service, so this side
 * of the basin only.
 */
import { cacheJson } from "@/lib/cache";
import type { SourceInfo } from "./eia";

export const NM_OCD: SourceInfo = {
  key: "nm-ocd-c115b",
  name: "New Mexico Oil Conservation Division, C-115B natural gas waste reports",
  url: "https://gis.emnrd.nm.gov/arcgis/rest/services/OCDPUB/C115B_NaturalGasWaste/FeatureServer",
  license: "Public record of the State of New Mexico",
  vintage: "monthly, as reported by operators",
};

const LAYERS = [{ id: 6, what: "midstream" }, { id: 1, what: "upstream" }];

export type ReportedFacility = { id: string; name: string; operator: string; type: string; km: number; flaredMcf: number; ventedMcf: number; url: string };
export type Reported = { period: string; flaredMcf: number; ventedMcf: number; facilities: ReportedFacility[]; radiusKm: number };

type Row = { id: string; name: string; type: string; ogrid_name: string; latitude: number; longitude: number; details: string; reporting_period: number; waste_type: string; volume: number };

const km = (aLon: number, aLat: number, bLon: number, bLat: number) => {
  const r = Math.PI / 180, dLat = (bLat - aLat) * r, dLon = (bLon - aLon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
};

/** Reports for the newest month in the rows, summed by facility, nearest first. Pure. */
export function summariseReports(rows: Row[], lon: number, lat: number, radiusKm: number): Reported | null {
  const newest = Math.max(0, ...rows.map((r) => r.reporting_period || 0));
  if (!newest) return null;
  const by = new Map<string, ReportedFacility>();
  for (const r of rows) {
    if (r.reporting_period !== newest) continue;
    const d = km(lon, lat, r.longitude, r.latitude);
    if (d > radiusKm) continue;
    const f = by.get(r.id) ?? { id: r.id, name: r.name, operator: r.ogrid_name, type: r.type.replace(/\s*-\s*\(.*\)$/, ""), km: Math.round(d * 10) / 10, flaredMcf: 0, ventedMcf: 0, url: r.details };
    if (r.waste_type === "F") f.flaredMcf += Math.max(0, r.volume || 0);
    else if (r.waste_type === "V") f.ventedMcf += Math.max(0, r.volume || 0);
    by.set(r.id, f);
  }
  const facilities = [...by.values()].filter((f) => f.flaredMcf + f.ventedMcf > 0).sort((a, b) => b.flaredMcf + b.ventedMcf - (a.flaredMcf + a.ventedMcf));
  if (!facilities.length) return null;
  const p = String(newest);
  return { period: `${p.slice(0, 4)}-${p.slice(4, 6)}`, flaredMcf: facilities.reduce((s, f) => s + f.flaredMcf, 0), ventedMcf: facilities.reduce((s, f) => s + f.ventedMcf, 0), facilities: facilities.slice(0, 5), radiusKm };
}

/** Flaring and venting reported within `radiusKm` of a point in the newest month on file (null outside New Mexico or when none). Kept a day. */
export async function reportedNear(lon: number, lat: number, radiusKm = 3): Promise<Reported | null> {
  // New Mexico only: north of 32°N and west of the Texas line at about 103.06°W.
  if (lat < 31.99 || lon > -103.0) return null;
  return cacheJson(`edge:nmocd:v1:${lon.toFixed(3)},${lat.toFixed(3)}:${radiusKm}:${new Date().toISOString().slice(0, 10)}`, 86_400_000, async () => {
    const dLat = radiusKm / 110.6, dLon = radiusKm / (111.3 * Math.cos((lat * Math.PI) / 180));
    const envelope = [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(5)).join(",");
    const rows = (await Promise.all(LAYERS.map(async (l) => {
      const q = new URLSearchParams({ where: "1=1", geometry: envelope, geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects", outFields: "id,name,type,ogrid_name,latitude,longitude,details,reporting_period,waste_type,volume", returnGeometry: "false", orderByFields: "reporting_period DESC", resultRecordCount: "400", f: "json" });
      const res = await fetch(`${NM_OCD.url}/${l.id}/query?${q}`, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`New Mexico OCD answered ${res.status}`);
      const j = (await res.json()) as { features?: { attributes: Row }[]; error?: { message?: string } };
      if (j.error) throw new Error(`New Mexico OCD: ${j.error.message ?? "error"}`);
      return (j.features ?? []).map((f) => f.attributes);
    }))).flat();
    return summariseReports(rows, lon, lat, radiusKm);
  });
}
