/**
 * Wells permitted in Texas: the Railroad Commission's public map service (no key; public records). Its
 * well layer marks a well that has a drilling permit but has not been drilled as a "Permitted Location",
 * with its API number and surface location. The map carries no permit dates, so Edge dates them itself:
 * the day a location first appears (permits.ts keeps that record).
 */
import type { Bbox, SourceInfo } from "./eia";

export const RRC_WELLS: SourceInfo = {
  key: "tx-rrc-wells",
  name: "Railroad Commission of Texas, well locations (public map service)",
  url: "https://gis.rrc.texas.gov/server/rest/services/rrc_public/RRC_Public_Viewer_Srvs/MapServer/1",
  license: "Public record of the State of Texas (Railroad Commission of Texas)",
  vintage: "permitted, undrilled locations as mapped; no permit dates",
};

/** The layer's symbol for a well permitted but not yet drilled. */
const PERMITTED = 2;
const PAGE = 1000;

export type TxPermit = { api: string; lon: number; lat: number };
type Row = { API?: string | null; GIS_LAT83?: number | null; GIS_LONG83?: number | null };

/** The service's rows as permitted locations, one per API number, dropping rows without one or a place. Pure. */
export function txPermitsFrom(rows: Row[]): TxPermit[] {
  const by = new Map<string, TxPermit>();
  for (const r of rows) {
    const api = String(r.API ?? "").trim(), lat = Number(r.GIS_LAT83), lon = Number(r.GIS_LONG83);
    if (!/^\d{8}$/.test(api) || !Number.isFinite(lat) || !Number.isFinite(lon) || !lat || !lon) continue;
    by.set(api, { api: `42-${api.slice(0, 3)}-${api.slice(3)}`, lon, lat });
  }
  return [...by.values()];
}

// The service slows to a stall when asked several things at once, so requests from this process go one at a time.
let queue: Promise<unknown> = Promise.resolve();

/** Permitted, undrilled well locations in a box, a page of a thousand at a time (at most five pages); one request at a time. */
export function txPermitted(bbox: Bbox): Promise<TxPermit[]> {
  const run = queue.then(() => readPermitted(bbox));
  queue = run.catch(() => undefined);
  return run;
}

async function readPermitted(bbox: Bbox): Promise<TxPermit[]> {
  const rows: Row[] = [];
  for (let page = 0; page < 5; page++) {
    const q = new URLSearchParams({
      where: `SYMNUM = ${PERMITTED}`, geometry: bbox.map((v) => v.toFixed(5)).join(","), geometryType: "esriGeometryEnvelope", inSR: "4326", spatialRel: "esriSpatialRelIntersects",
      outFields: "API,GIS_LAT83,GIS_LONG83", returnGeometry: "false", orderByFields: "OBJECTID", resultOffset: String(page * PAGE), resultRecordCount: String(PAGE), f: "json",
    });
    const res = await fetch(`${RRC_WELLS.url}/query?${q}`, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Texas RRC answered ${res.status}`);
    const j = (await res.json()) as { features?: { attributes: Row }[]; exceededTransferLimit?: boolean; error?: { message?: string } };
    if (j.error) throw new Error(`Texas RRC: ${j.error.message ?? "error"}`);
    rows.push(...(j.features ?? []).map((f) => f.attributes));
    if (!j.exceededTransferLimit && (j.features?.length ?? 0) < PAGE) break;
  }
  return txPermitsFrom(rows);
}
