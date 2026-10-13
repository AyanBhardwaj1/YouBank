/**
 * Heights from the same free elevation tiles the 3D map draws its terrain with (AWS Open Data's Terrain
 * Tiles, Terrarium encoding: USGS 3DEP in the United States, SRTM and others elsewhere). Models and
 * point clouds are stood on these heights, so they sit on the ground the map shows rather than on a
 * different survey's idea of it. Reading and decoding tiles needs Node (pngjs); the pure maths is in
 * ./heights.ts and re-exported here.
 */
import { PNG } from "pngjs";
import type { Bbox } from "../sources/eia";
import { fillGaps, TERRARIUM_TILES, terrariumHeight, tileXY, type GroundGrid } from "./heights";

export * from "./heights";

/** A tile's heights (256 by 256) from its PNG bytes. */
export function decodeTerrarium(png: Buffer): Float32Array {
  const img = PNG.sync.read(png);
  const out = new Float32Array(img.width * img.height);
  for (let i = 0; i < out.length; i++) out[i] = terrariumHeight(img.data[i * 4], img.data[i * 4 + 1], img.data[i * 4 + 2]);
  return out;
}

/**
 * The ground over a box as a `size` by `size` grid of heights, read from the zoom-`zoom` tiles that
 * cover it (at most nine; a site box needs one to four). Missing tiles read as the nearest known height.
 */
export async function groundGrid(bbox: Bbox, size = 64, zoom = 14): Promise<GroundGrid> {
  const [ax, ay] = tileXY(bbox[0], bbox[3], zoom), [bx, by] = tileXY(bbox[2], bbox[1], zoom);
  const tx0 = Math.floor(ax), ty0 = Math.floor(ay), tx1 = Math.floor(bx), ty1 = Math.floor(by);
  if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > 9) throw new Error("The box is too large for one ground grid.");
  const tiles = new Map<string, Float32Array | null>();
  await Promise.all(
    Array.from({ length: (tx1 - tx0 + 1) * (ty1 - ty0 + 1) }, (_, i) => [tx0 + (i % (tx1 - tx0 + 1)), ty0 + Math.floor(i / (tx1 - tx0 + 1))]).map(async ([x, y]) => {
      const url = TERRARIUM_TILES.replace("{z}", String(zoom)).replace("{x}", String(x)).replace("{y}", String(y));
      // A tile that does not arrive (or arrives broken) is a gap, not a failed twin.
      const heights = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(15_000) })
        .then(async (res) => (res.ok ? decodeTerrarium(Buffer.from(await res.arrayBuffer())) : null))
        .catch(() => null);
      tiles.set(`${x}/${y}`, heights);
    }),
  );
  const z: number[] = new Array(size * size).fill(Number.NaN);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const lon = bbox[0] + ((i + 0.5) / size) * (bbox[2] - bbox[0]), lat = bbox[3] - ((j + 0.5) / size) * (bbox[3] - bbox[1]);
      const [fx, fy] = tileXY(lon, lat, zoom);
      const t = tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
      if (!t) continue;
      const px = Math.min(255, Math.max(0, Math.floor((fx - Math.floor(fx)) * 256))), py = Math.min(255, Math.max(0, Math.floor((fy - Math.floor(fy)) * 256)));
      z[j * size + i] = Math.round(t[py * 256 + px] * 10) / 10;
    }
  }
  fillGaps(z);
  const missing = [...tiles.values()].filter((t) => !t).length;
  return { bbox, width: size, height: size, z, zoom, ...(missing ? { missing } : {}) };
}

