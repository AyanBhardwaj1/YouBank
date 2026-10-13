/**
 * A site month by month: the clearest Sentinel-2 scene of each month over the last two years, as
 * true-colour crops of the same box, so a change can be watched as it happens. Free (Copernicus data
 * through Planetary Computer, rendered on request); the list of scenes is kept a day.
 */
import type { Bbox } from "./sources/eia";
import { cropUrl } from "./sources/sentinel";

const STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search";

/** One month: its clearest scene's date, cloud, crop URL and Sentinel-2 item id (the 3D change stack reads the scene again). */
export type Frame = { date: string; month: string; cloud: number; url: string; scene: string };
type Item = { id: string; bbox: number[]; properties: { datetime: string; "eo:cloud_cover"?: number } };

/** One scene per month: the least cloudy of those that cover the whole box. Pure. */
export function monthly(items: { id: string; date: string; cloud: number; covers: boolean }[]): { id: string; date: string; cloud: number }[] {
  const best = new Map<string, { id: string; date: string; cloud: number }>();
  for (const it of items) {
    if (!it.covers) continue;
    const m = it.date.slice(0, 7), cur = best.get(m);
    if (!cur || it.cloud < cur.cloud) best.set(m, { id: it.id, date: it.date, cloud: it.cloud });
  }
  return [...best.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export async function timelapse(bbox: Bbox, months = 24, size = 384): Promise<Frame[]> {
  const to = new Date(), from = new Date(Date.now() - months * 30.44 * 86_400_000);
  const res = await fetch(STAC, {
    method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(25_000),
    // Only the fields the choice needs (a list of 100 scenes is then ~15 KB rather than a megabyte of asset links).
    body: JSON.stringify({
      collections: ["sentinel-2-l2a"], bbox, datetime: `${from.toISOString()}/${to.toISOString()}`, query: { "eo:cloud_cover": { lt: 30 } },
      fields: { include: ["id", "bbox", "properties.datetime", "properties.eo:cloud_cover"], exclude: ["assets", "links", "geometry"] }, sortby: [{ field: "properties.eo:cloud_cover", direction: "asc" }], limit: 500,
    }),
  });
  if (!res.ok) throw new Error(`Sentinel-2 search answered ${res.status}`);
  const items = ((await res.json()) as { features?: Item[] }).features ?? [];
  const picked = monthly(items.map((i) => ({
    id: i.id, date: i.properties.datetime.slice(0, 10), cloud: Number(i.properties["eo:cloud_cover"] ?? 100),
    covers: i.bbox[0] <= bbox[0] && i.bbox[1] <= bbox[1] && i.bbox[2] >= bbox[2] && i.bbox[3] >= bbox[3],
  })));
  return picked.map((p) => ({ date: p.date, month: p.date.slice(0, 7), cloud: Math.round(p.cloud), url: cropUrl({ id: p.id, date: p.date, cloud: p.cloud }, bbox, size), scene: p.id }));
}
