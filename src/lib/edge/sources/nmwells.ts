/**
 * Wells permitted in New Mexico: the Oil Conservation Division's public well layer (no key; public
 * records). A well whose drilling permit has been approved and that has not yet been completed has the
 * status "New", and the date that status took effect is the approval date; its API number, operator,
 * well name and a link to its record come with it.
 */
import type { Bbox, SourceInfo } from "./eia";

export const NM_WELLS: SourceInfo = {
  key: "nm-ocd-wells",
  name: "New Mexico Oil Conservation Division, wells (public map service)",
  url: "https://gis.emnrd.nm.gov/arcgis/rest/services/OCDView/Wells/FeatureServer/0",
  license: "Public record of the State of New Mexico",
  vintage: "as maintained by the OCD; a new well's status date is its permit approval",
};

export type NmPermit = { api: string; name: string; operator: string; type: string; lon: number; lat: number; approved: string; spud: string | null; url: string };
type Row = { id?: string; name?: string; ogrid_name?: string; type?: string; latitude?: number; longitude?: number; effective_date?: number | null; spud_date?: number | null; details?: string };

const day = (ms: number | null | undefined) => (typeof ms === "number" && ms > 0 && ms < Date.UTC(2100, 0, 1) ? new Date(ms).toISOString().slice(0, 10) : null);

/** The layer's rows as permits: oil and gas wells only (not disposal or injection), with an approval date and a place. Pure. */
export function nmPermitsFrom(rows: Row[]): NmPermit[] {
  return rows.flatMap((r) => {
    const approved = day(r.effective_date), lat = Number(r.latitude), lon = Number(r.longitude);
    if (!r.id || !approved || !Number.isFinite(lat) || !Number.isFinite(lon) || !/^(oil|gas)$/i.test(r.type ?? "")) return [];
    return [{ api: r.id, name: r.name ?? "", operator: r.ogrid_name ?? "", type: r.type ?? "", lon, lat, approved, spud: day(r.spud_date), url: r.details ?? "" }];
  });
}

/** Wells permitted in a box since a date (status "New", approved on or after `since`), newest first. */
export async function nmPermitted(bbox: Bbox, since: string): Promise<NmPermit[]> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("Bad date");
  const q = new URLSearchParams({
    where: `status = 'New' AND effective_date >= DATE '${since}'`, geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
    outFields: "id,name,ogrid_name,type,latitude,longitude,effective_date,spud_date,details", returnGeometry: "false", orderByFields: "effective_date DESC", resultRecordCount: "2000", f: "json",
  });
  const res = await fetch(`${NM_WELLS.url}/query?${q}`, { cache: "no-store", signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`New Mexico OCD answered ${res.status}`);
  const j = (await res.json()) as { features?: { attributes: Row }[]; error?: { message?: string } };
  if (j.error) throw new Error(`New Mexico OCD: ${j.error.message ?? "error"}`);
  return nmPermitsFrom((j.features ?? []).map((f) => f.attributes));
}
