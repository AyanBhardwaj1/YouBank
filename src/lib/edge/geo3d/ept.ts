/**
 * The arithmetic of reading USGS 3DEP lidar from its public Entwine Point Tile (EPT) copies on AWS,
 * kept apart from the network so it can be tested. An EPT dataset is an octree: the root cube holds a
 * thin sample of the whole survey, and each of its children holds a sample as dense again over an
 * eighth of the space, down to the full density. Reading a site therefore means taking every node that
 * touches the site's box, shallowest first, until the point budget is spent: the result is the whole
 * site at an even density, as fine as the budget allows, never more points than it allows.
 *
 * USGS's copies are in Web Mercator (EPSG:3857) metres, which are stretched by 1 / cos(latitude); the
 * points sent to the browser are true metres east, north and up from the site's centre.
 */

export type Bounds3 = [number, number, number, number, number, number];
export type Box2 = [number, number, number, number];

const R = 6_378_137;

/** Longitude and latitude to Web Mercator metres. Pure. */
export function toMercator(lon: number, lat: number): [number, number] {
  const y = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 360)) * R;
  return [(lon * Math.PI * R) / 180, y];
}

/** Web Mercator metres to longitude and latitude. Pure. */
export function fromMercator(x: number, y: number): [number, number] {
  return [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
}

/** A lon/lat box in Web Mercator metres. Pure. */
export function boxToMercator(b: Box2): Box2 {
  const [x0, y0] = toMercator(b[0], b[1]), [x1, y1] = toMercator(b[2], b[3]);
  return [x0, y0, x1, y1];
}

/** The cube of a node ("depth-x-y-z") inside the dataset's root cube. Pure. */
export function nodeBounds(root: Bounds3, key: string): Bounds3 {
  const [d, x, y, z] = key.split("-").map(Number);
  const n = 2 ** d;
  const sx = (root[3] - root[0]) / n, sy = (root[4] - root[1]) / n, sz = (root[5] - root[2]) / n;
  return [root[0] + x * sx, root[1] + y * sy, root[2] + z * sz, root[0] + (x + 1) * sx, root[1] + (y + 1) * sy, root[2] + (z + 1) * sz];
}

/** The share (0 to 1) of a node's footprint that lies inside a box (Mercator metres). Pure. */
export function overlapShare(node: Bounds3, box: Box2): number {
  const w = Math.max(0, Math.min(node[3], box[2]) - Math.max(node[0], box[0]));
  const h = Math.max(0, Math.min(node[4], box[3]) - Math.max(node[1], box[1]));
  const area = (node[3] - node[0]) * (node[4] - node[1]);
  return area > 0 ? (w * h) / area : 0;
}

/** The eight children of a node. Pure. */
export function children(key: string): string[] {
  const [d, x, y, z] = key.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 8; i++) out.push(`${d + 1}-${2 * x + (i & 1)}-${2 * y + ((i >> 1) & 1)}-${2 * z + ((i >> 2) & 1)}`);
  return out;
}

export type Selection = {
  /** Nodes to read, shallowest first, each with its expected points inside the box. */
  nodes: { key: string; depth: number; expected: number }[];
  expected: number;
  /** The deepest level read in full; deeper levels exist but did not fit the budget. */
  depth: number;
  /** Whether the budget stopped the descent (more detail exists). */
  truncated: boolean;
  /** Sub-hierarchy files the descent needs before it can go further (count -1 in the hierarchy). */
  pending: string[];
};

/**
 * The nodes to read for a box under a point budget: level by level from the root, every node touching
 * the box, its points counted by the share of it inside the box. The last level that does not fit
 * whole is taken from the centre outwards. Nodes whose hierarchy lives in another file are reported in `pending`
 * (fetch those files, merge them in and select again). Pure.
 */
export function selectNodes(hierarchy: Record<string, number>, root: Bounds3, box: Box2, budget: number, maxDepth = 14): Selection {
  const nodes: Selection["nodes"] = [];
  let level = ["0-0-0-0"], expected = 0, depth = -1, truncated = false;
  const pending: string[] = [];
  for (let d = 0; d <= maxDepth && level.length; d++) {
    const here: Selection["nodes"] = [];
    const next: string[] = [];
    let waiting = false;
    for (const key of level) {
      const count = hierarchy[key];
      if (count === undefined) continue;
      const share = overlapShare(nodeBounds(root, key), box);
      if (share <= 0) continue;
      if (count === -1) { pending.push(key); waiting = true; continue; }
      if (count > 0) here.push({ key, depth: d, expected: Math.ceil(count * share) });
      next.push(...children(key));
    }
    if (waiting || !here.length) break;
    const add = here.reduce((s, n) => s + n.expected, 0);
    if (expected + add > budget && nodes.length) {
      // The level does not fit whole: take its nodes nearest the centre while they fit, so the middle
      // of the site (where the plant is) gets the finer detail.
      const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      const dist = (k: string) => { const b = nodeBounds(root, k); return Math.hypot((b[0] + b[3]) / 2 - cx, (b[1] + b[4]) / 2 - cy); };
      for (const n of here.sort((a, b) => dist(a.key) - dist(b.key))) {
        if (expected + n.expected > budget) break;
        nodes.push(n); expected += n.expected;
      }
      truncated = true;
      break;
    }
    nodes.push(...here);
    expected += add;
    depth = d;
    level = next;
  }
  // Reaching the deepest level allowed with deeper nodes still in the hierarchy also leaves detail unread.
  return { nodes, expected, depth, truncated: truncated || (depth === maxDepth && level.some((k) => hierarchy[k] !== undefined)), pending };
}

/** Split selected nodes into passes of about `perPass` expected points, shallow levels first, so a browser can draw a coarse site at once and refine it. Pure. */
export function passes(nodes: Selection["nodes"], perPass: number): Selection["nodes"][] {
  const out: Selection["nodes"][] = [];
  let cur: Selection["nodes"] = [], n = 0;
  for (const node of nodes) {
    if (cur.length && n + node.expected > perPass) { out.push(cur); cur = []; n = 0; }
    cur.push(node); n += node.expected;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** The survey year in a USGS dataset name ("NM_SouthEast_B3_2018" -> 2018), or 0. Pure. */
export function surveyYear(name: string): number {
  const m = [...name.matchAll(/(?:^|[_-])((?:19|20)\d{2})(?=$|[_-])/g)].map((x) => Number(x[1]));
  return m.length ? Math.max(...m) : 0;
}

/** ASPRS point classes the point cloud keeps and how it names them; noise (7, 18) is dropped. */
export const LIDAR_CLASSES: Record<number, { name: string; color: [number, number, number] }> = {
  1: { name: "Unclassified", color: [176, 176, 168] },
  2: { name: "Ground", color: [168, 128, 86] },
  3: { name: "Low vegetation", color: [150, 200, 110] },
  4: { name: "Medium vegetation", color: [92, 170, 80] },
  5: { name: "High vegetation", color: [40, 130, 60] },
  6: { name: "Building", color: [238, 108, 77] },
  9: { name: "Water", color: [70, 140, 230] },
  13: { name: "Wire guard", color: [255, 220, 90] },
  14: { name: "Wire conductor", color: [255, 220, 90] },
  15: { name: "Transmission tower", color: [255, 190, 60] },
  17: { name: "Bridge deck", color: [200, 160, 230] },
};
export const NOISE_CLASSES = new Set([7, 18]);

/** Point cloud wire format: "YBPC", a version byte, three spare bytes, a JSON header's length, the header, then the arrays. */
export const PC_MAGIC = 0x43504259; // "YBPC" little-endian

export type PointCloudHeader = {
  n: number;
  /** Positions are int16 multiples of `q` metres east, north and up from the origin. */
  q: number;
  origin: { lon: number; lat: number; z: number };
  /** Median height of ground returns within 60 m of the centre (for lining the cloud up with the terrain), or null. */
  groundZ: number | null;
  survey: string; year: number;
  pass: number; passes: number; depth: number; truncated: boolean;
  classes: Record<string, number>;
  bbox: Box2;
};

/** Encode points: positions in metres from the origin, a class and an 8-bit intensity each. Pure. */
export function encodePoints(header: PointCloudHeader, xyz: Float32Array, cls: Uint8Array, intensity: Uint8Array): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify(header));
  const jsonLen = (json.length + 3) & ~3;
  const n = header.n;
  const posBytes = n * 6, tail = (2 * n + 3) & ~3;
  const out = new Uint8Array(12 + jsonLen + posBytes + ((posBytes & 3) ? 4 - (posBytes & 3) : 0) + tail);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, PC_MAGIC, true);
  out[4] = 1;
  dv.setUint32(8, jsonLen, true);
  out.set(json, 12);
  out.fill(0x20, 12 + json.length, 12 + jsonLen);
  let o = 12 + jsonLen;
  const lim = 32767;
  for (let i = 0; i < n * 3; i++) { dv.setInt16(o, Math.max(-lim, Math.min(lim, Math.round(xyz[i] / header.q))), true); o += 2; }
  o = (o + 3) & ~3;
  out.set(cls.subarray(0, n), o);
  out.set(intensity.subarray(0, n), o + n);
  return out;
}

/** Decode what encodePoints wrote: header, positions in metres (Float32, x y z per point), classes and intensities. Pure. */
export function decodePoints(buf: ArrayBuffer | Uint8Array): { header: PointCloudHeader; positions: Float32Array; classes: Uint8Array; intensity: Uint8Array } {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== PC_MAGIC) throw new Error("Not a point cloud");
  const jsonLen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(12, 12 + jsonLen)).trim()) as PointCloudHeader;
  const n = header.n;
  const positions = new Float32Array(n * 3);
  let o = 12 + jsonLen;
  for (let i = 0; i < n * 3; i++) { positions[i] = dv.getInt16(o, true) * header.q; o += 2; }
  o = (o + 3) & ~3;
  return { header, positions, classes: u8.slice(o, o + n), intensity: u8.slice(o + n, o + 2 * n) };
}
