/**
 * Planet imagery, ready to switch on (premium.ts, "planet"): the PlanetScope (3 m, near daily) and SkySat
 * (50 cm, tasked) scenes of a site from the last 60 days with little cloud, found with the Data API's
 * quick search, and their thumbnails. Thumbnails need the key, so the browser reads them through
 * YouBank's own route and the key never leaves the server. Off (no request is made) until PLANET_API_KEY
 * is set.
 */
import { cacheJson } from "@/lib/cache";
import type { Bbox, SourceInfo } from "../sources/eia";

export const PLANET: SourceInfo = {
  key: "planet",
  name: "Planet Labs PlanetScope and SkySat scenes (Data API)",
  url: "https://api.planet.com/data/v1",
  license: "Planet Labs PBC, under the account's licence (search and thumbnails; full scenes are bought separately)",
  vintage: "last 60 days, under 20% cloud",
};

export const PLANET_TYPES = ["PSScene", "SkySatCollect"] as const;
export type PlanetType = (typeof PLANET_TYPES)[number];
export type PlanetScene = { id: string; type: PlanetType; acquired: string; cloudPct: number; gsdM: number; thumb: string };

const SEARCH = "https://api.planet.com/data/v1/quick-search";
const TILES = "https://tiles.planet.com/data/v1/item-types";
/** Planet's XYZ tile service for one item: {XYZ}/{item_type}/{item_id}/{z}/{x}/{y}.png. */
const XYZ = "https://tiles.planet.com/data/v1";

/** The quick-search body for a box: both item types, acquired in the `days` before `now`, cloud cover at most `maxCloud` (0 to 1). Pure. */
export function planetSearchBody(bbox: Bbox, now: Date, days = 60, maxCloud = 0.2) {
  const [w, s, e, n] = bbox;
  return {
    item_types: [...PLANET_TYPES],
    filter: {
      type: "AndFilter",
      config: [
        { type: "GeometryFilter", field_name: "geometry", config: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        { type: "DateRangeFilter", field_name: "acquired", config: { gte: new Date(now.getTime() - days * 86_400_000).toISOString(), lte: now.toISOString() } },
        { type: "RangeFilter", field_name: "cloud_cover", config: { lte: maxCloud } },
      ],
    },
  };
}

/** Whether a scene reference is one Edge may ask Planet about (a known item type, an id of letters, digits, _ and -). Pure. */
export const validScene = (type: string, id: string): type is PlanetType => (PLANET_TYPES as readonly string[]).includes(type) && /^[A-Za-z0-9_-]{6,96}$/.test(id);

/** Our proxy's address for a scene's thumbnail. Pure. */
export const thumbPath = (type: PlanetType, id: string) => `/api/edge/planet/thumb?type=${type}&id=${encodeURIComponent(id)}`;

type Feature = { id?: string; properties?: { item_type?: string; acquired?: string; cloud_cover?: number; gsd?: number; pixel_resolution?: number } };

/** A quick-search answer as scenes, newest first, at most `limit`. Pure. */
export function planetScenesFrom(json: { features?: Feature[] } | null | undefined, limit = 24): PlanetScene[] {
  return (json?.features ?? []).flatMap((f): PlanetScene[] => {
    const p = f.properties ?? {}, type = p.item_type ?? "", id = f.id ?? "";
    if (!validScene(type, id) || !p.acquired) return [];
    const gsd = Number(p.gsd ?? p.pixel_resolution);
    return [{ id, type, acquired: p.acquired, cloudPct: Math.round(Math.max(0, Math.min(1, Number(p.cloud_cover) || 0)) * 100), gsdM: Number.isFinite(gsd) ? Math.round(gsd * 100) / 100 : type === "SkySatCollect" ? 0.5 : 3, thumb: thumbPath(type, id) }];
  }).sort((a, b) => b.acquired.localeCompare(a.acquired)).slice(0, limit);
}

/** The Basic authorization Planet takes: the key as the user name and no password. Pure. */
export const planetAuth = (key: string) => `Basic ${Buffer.from(`${key}:`).toString("base64")}`;

function key(): string {
  const k = process.env.PLANET_API_KEY?.trim();
  if (!k) throw Object.assign(new Error("Planet is not set up."), { status: 404 });
  return k;
}

/** The Planet scenes of a box from the last 60 days under 20% cloud, newest first. Kept six hours. */
export async function planetScenes(bbox: Bbox): Promise<PlanetScene[]> {
  const bucket = Math.floor(Date.now() / (6 * 3_600_000));
  return cacheJson(`edge:planet:v1:${bbox.map((v) => v.toFixed(4)).join(",")}:${bucket}`, 6 * 3_600_000, async () => {
    const res = await fetch(`${SEARCH}?_sort=${encodeURIComponent("acquired desc")}&_page_size=50`, {
      method: "POST", headers: { authorization: planetAuth(key()), "content-type": "application/json" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
      body: JSON.stringify(planetSearchBody(bbox, new Date())),
    });
    if (!res.ok) throw Object.assign(new Error(res.status === 401 || res.status === 403 ? "Planet did not accept the key." : `Planet search answered ${res.status}`), { status: 502 });
    return planetScenesFrom((await res.json()) as { features?: Feature[] });
  });
}

/**
 * Whether an XYZ tile address is one the 3D drape may ask for: whole numbers, zoom 12 to 18 (the drape's
 * own source range, so a wide low-zoom tile never spends the area quota), inside the zoom's grid. Pure.
 */
export function validTile(z: number, x: number, y: number): boolean {
  return [z, x, y].every(Number.isInteger) && z >= 12 && z <= 18 && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z;
}

/** One 256 px XYZ tile of a scene (Planet's tile service), for draping it in 3D. Counts against the account's quota. */
export async function planetTile(type: PlanetType, id: string, z: number, x: number, y: number): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${XYZ}/${type}/${encodeURIComponent(id)}/${z}/${x}/${y}.png`, { headers: { authorization: planetAuth(key()) }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw Object.assign(new Error(`Planet tile answered ${res.status}`), { status: res.status === 404 ? 404 : 502 });
  return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png" };
}

/** A scene's thumbnail (512 px), as bytes and type. */
export async function planetThumb(type: PlanetType, id: string): Promise<{ body: ArrayBuffer; contentType: string }> {
  const res = await fetch(`${TILES}/${type}/items/${encodeURIComponent(id)}/thumb?width=512`, { headers: { authorization: planetAuth(key()) }, cache: "no-store", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw Object.assign(new Error(`Planet thumbnail answered ${res.status}`), { status: res.status === 404 ? 404 : 502 });
  return { body: await res.arrayBuffer(), contentType: res.headers.get("content-type") ?? "image/png" };
}
