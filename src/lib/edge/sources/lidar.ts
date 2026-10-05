/**
 * USGS 3DEP lidar as points, for the digital twin: the public Entwine Point Tile copies of every 3DEP
 * survey on AWS Open Data (s3://usgs-lidar-public, no key, no bill), read node by node for the site's
 * box only, under a point budget (../geo3d/ept.ts), and sent to the browser in passes so a coarse site
 * appears at once and fills in. LAZ is decompressed with laz-perf (LASzip compiled to WebAssembly).
 *
 * Which survey covers a place comes from Hobu's index of the bucket (one outline per survey); the
 * newest survey that covers the point and has points there wins. The index and each survey's metadata
 * and hierarchy are kept a month; the points themselves are not stored (a pass is a second or two).
 */
import { cacheJson } from "@/lib/cache";
import { boxToMercator, encodePoints, NOISE_CLASSES, passes, selectNodes, surveyYear, toMercator, type Bounds3, type Box2, type PointCloudHeader } from "../geo3d/ept";
import type { Bbox, SourceInfo } from "./eia";
import { boxAround } from "./sentinel";
import { pool } from "../terrain";

export const LIDAR_POINTS: SourceInfo = {
  key: "usgs-3dep-ept",
  name: "USGS 3D Elevation Program lidar point clouds (Entwine Point Tiles on AWS Open Data)",
  url: "https://registry.opendata.aws/usgs-lidar/",
  license: "Public domain (U.S. Geological Survey); index of surveys by Hobu, Inc.",
  vintage: "as flown, survey by survey (mostly 2015 onwards)",
};

const BUCKET = "https://s3-us-west-2.amazonaws.com/usgs-lidar-public";
const INDEX_URL = () => process.env.USGS_LIDAR_INDEX_URL?.trim() || "https://raw.githubusercontent.com/hobuinc/usgs-lidar/master/boundaries/resources.geojson";
const MONTH = 30 * 86_400_000;
const UA = { "User-Agent": "YouBank research (Edge digital twin)" };

/** The most points one request may ask for, and the most one pass carries (each pass stays well under a megabyte or two). */
export const MAX_BUDGET = 800_000;
export const PER_PASS = 200_000;

type Survey = { name: string; bbox: Box2; count: number; year: number };

/** Survey names are dataset folder names: letters, digits, _ and -. */
const validName = (s: string) => /^[A-Za-z0-9_-]{3,120}$/.test(s);

/** The index of surveys: name, outline's box, point count and year. 2,300 surveys, ~150 KB once compacted. */
async function surveyIndex(): Promise<Survey[]> {
  return cacheJson("edge:lidar:index:v1", MONTH, async () => {
    const res = await fetch(INDEX_URL(), { headers: UA, cache: "no-store", signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error(`The lidar survey index answered ${res.status}`);
    const j = (await res.json()) as { features?: { properties?: { name?: string; count?: number }; geometry?: { coordinates?: unknown } }[] };
    const out: Survey[] = [];
    for (const f of j.features ?? []) {
      const name = f.properties?.name ?? "";
      if (!validName(name)) continue;
      const b: Box2 = [Infinity, Infinity, -Infinity, -Infinity];
      const walk = (c: unknown): void => {
        if (Array.isArray(c) && typeof c[0] === "number") { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1] as number); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1] as number); }
        else if (Array.isArray(c)) c.forEach(walk);
      };
      walk(f.geometry?.coordinates);
      if (!Number.isFinite(b[0])) continue;
      out.push({ name, bbox: b.map((v) => Math.round(v * 1e4) / 1e4) as Box2, count: Number(f.properties?.count) || 0, year: surveyYear(name) });
    }
    return out;
  });
}

/** Surveys whose outline's box holds a point, newest first. */
export async function surveysAt(lon: number, lat: number): Promise<Survey[]> {
  return (await surveyIndex()).filter((s) => s.bbox[0] <= lon && lon <= s.bbox[2] && s.bbox[1] <= lat && lat <= s.bbox[3]).sort((a, b) => b.year - a.year || b.count - a.count);
}

type EptMeta = { bounds: Bounds3; dataType: string; srs: string; points: number };

async function eptMeta(name: string): Promise<EptMeta> {
  return cacheJson(`edge:lidar:ept:v1:${name}`, MONTH, async () => {
    const res = await fetch(`${BUCKET}/${name}/ept.json`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`The lidar survey ${name} answered ${res.status}`);
    const j = (await res.json()) as { bounds: number[]; dataType: string; srs?: { horizontal?: string }; points: number };
    return { bounds: j.bounds as Bounds3, dataType: j.dataType, srs: j.srs?.horizontal ?? "", points: j.points };
  });
}

async function hierarchyFile(name: string, key: string): Promise<Record<string, number>> {
  return cacheJson(`edge:lidar:hier:v1:${name}:${key}`, MONTH, async () => {
    const res = await fetch(`${BUCKET}/${name}/ept-hierarchy/${key}.json`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`The lidar hierarchy answered ${res.status}`);
    return (await res.json()) as Record<string, number>;
  });
}

/** Select nodes for a box, fetching the sub-hierarchies the descent needs (a few at most for a site). */
async function selectFor(name: string, meta: EptMeta, box: Box2, budget: number) {
  const hier = { ...(await hierarchyFile(name, "0-0-0-0")) };
  for (let round = 0; round < 4; round++) {
    const sel = selectNodes(hier, meta.bounds, box, budget);
    if (!sel.pending.length) return sel;
    const subs = await pool(sel.pending.slice(0, 16), 4, (k) => hierarchyFile(name, k).catch(() => ({} as Record<string, number>)));
    for (const s of subs) Object.assign(hier, s);
    // A sub-hierarchy that failed to load would otherwise be asked for forever.
    for (const k of sel.pending) if (hier[k] === -1) hier[k] = 0;
  }
  return selectNodes(hier, meta.bounds, box, budget);
}

/* ---------------- LAZ ---------------- */

type LazModule = {
  HEAPU8: Uint8Array; _malloc(n: number): number; _free(p: number): void;
  LASZip: new () => { open(p: number, n: number): void; getPoint(p: number): void; getCount(): number; getPointLength(): number; getPointFormat(): number; delete(): void };
};
let laz: Promise<LazModule> | null = null;

/**
 * laz-perf's WebAssembly, loaded once per instance. The package stays outside the bundle
 * (serverExternalPackages) and finds its .wasm beside itself; next.config.ts traces both into the
 * point cloud route.
 */
function lazPerf(): Promise<LazModule> {
  laz ??= import("laz-perf")
    .then(({ createLazPerf }) => createLazPerf() as unknown as Promise<LazModule>)
    .catch((e) => { laz = null; throw e; });
  return laz;
}

type Points = { x: Float64Array; y: Float64Array; z: Float64Array; cls: Uint8Array; intensity: Uint16Array; n: number };

/** Decode one LAZ node into Mercator x, y, height, class and intensity. LAS 1.2 to 1.4, point formats 0 to 10. */
export async function decodeLaz(bytes: Uint8Array): Promise<Points> {
  const L = await lazPerf();
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fmt = bytes[104] & 0x3f;
  const sx = dv.getFloat64(131, true), sy = dv.getFloat64(139, true), sz = dv.getFloat64(147, true);
  const ox = dv.getFloat64(155, true), oy = dv.getFloat64(163, true), oz = dv.getFloat64(171, true);
  const filePtr = L._malloc(bytes.length);
  L.HEAPU8.set(bytes, filePtr);
  const zip = new L.LASZip();
  try {
    zip.open(filePtr, bytes.length);
    const n = zip.getCount(), len = zip.getPointLength();
    const pt = L._malloc(len);
    const out: Points = { x: new Float64Array(n), y: new Float64Array(n), z: new Float64Array(n), cls: new Uint8Array(n), intensity: new Uint16Array(n), n };
    try {
      for (let i = 0; i < n; i++) {
        zip.getPoint(pt);
        // The heap can grow (and move) while decoding; take a fresh view per point.
        const p = new DataView(L.HEAPU8.buffer, pt, len);
        out.x[i] = p.getInt32(0, true) * sx + ox;
        out.y[i] = p.getInt32(4, true) * sy + oy;
        out.z[i] = p.getInt32(8, true) * sz + oz;
        out.intensity[i] = p.getUint16(12, true);
        out.cls[i] = fmt >= 6 ? p.getUint8(16) : p.getUint8(15) & 31;
      }
    } finally {
      L._free(pt);
    }
    return out;
  } finally {
    zip.delete();
    L._free(filePtr);
  }
}

async function fetchNode(name: string, key: string): Promise<Uint8Array> {
  const res = await fetch(`${BUCKET}/${name}/ept-data/${key}.laz`, { headers: UA, cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`A lidar tile answered ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

export type CloudRequest = { lon: number; lat: number; km: number; budget: number; pass: number; survey?: string };

/**
 * Decoding is the memory-hungry step (a node's points as doubles before they are cut to the box), so an
 * instance runs a few point cloud passes at a time and queues the rest, however many requests arrive.
 */
const MAX_RUNNING = 2;
let running = 0;
const queued: (() => void)[] = [];
async function decodeSlot(): Promise<() => void> {
  if (running < MAX_RUNNING) running++;
  else await new Promise<void>((go) => queued.push(go));
  let freed = false;
  return () => {
    if (freed) return;
    freed = true;
    const next = queued.shift();
    if (next) next(); else running--;
  };
}

type Kept = { xyz: Float32Array; cls: Uint8Array; inten: Uint8Array; n: number; zSum: number; ground: number[]; classes: Record<string, number> };

/** One decoded node cut to the box, noise dropped, as true metres from the centre: only what is kept stays in memory. */
function keep(d: Points, box: Box2, cx: number, cy: number, k: number): Kept {
  const xyz = new Float32Array(d.n * 3), cls = new Uint8Array(d.n), inten = new Uint8Array(d.n);
  const classes: Record<string, number> = {};
  const ground: number[] = [];
  let n = 0, zSum = 0;
  for (let i = 0; i < d.n; i++) {
    const c = d.cls[i];
    if (NOISE_CLASSES.has(c)) continue;
    if (d.x[i] < box[0] || d.x[i] > box[2] || d.y[i] < box[1] || d.y[i] > box[3]) continue;
    const ex = (d.x[i] - cx) * k, ny = (d.y[i] - cy) * k;
    xyz[n * 3] = ex; xyz[n * 3 + 1] = ny; xyz[n * 3 + 2] = d.z[i];
    cls[n] = c;
    inten[n] = Math.min(255, d.intensity[i] >> 4);
    classes[c] = (classes[c] ?? 0) + 1;
    if (c === 2 && ex * ex + ny * ny < 3600) ground.push(d.z[i]);
    zSum += d.z[i];
    n++;
  }
  return { xyz: xyz.slice(0, n * 3), cls: cls.slice(0, n), inten: inten.slice(0, n), n, zSum, ground, classes };
}

/**
 * One pass of a site's point cloud: the survey (newest that has points here), the nodes for the box
 * under the budget, this pass's share of them decoded, cut to the box, noise dropped, and written as
 * int16 centimetre-ish offsets from the site's centre. Null when no survey covers the place.
 */
export async function pointCloud(r: CloudRequest): Promise<{ bytes: Uint8Array; header: PointCloudHeader } | null> {
  const bbox: Bbox = boxAround(r.lon, r.lat, r.km);
  const box = boxToMercator(bbox);
  const budget = Math.max(20_000, Math.min(MAX_BUDGET, Math.round(r.budget)));
  const candidates = r.survey && validName(r.survey) ? [{ name: r.survey, year: surveyYear(r.survey) }] : (await surveysAt(r.lon, r.lat)).slice(0, 4);
  const [cx, cy] = toMercator(r.lon, r.lat);
  const k = Math.cos((r.lat * Math.PI) / 180); // Mercator metres to true metres at this latitude
  for (const s of candidates) {
    const meta = await eptMeta(s.name).catch(() => null);
    if (!meta || meta.dataType !== "laszip" || meta.srs !== "3857") continue;
    const sel = await selectFor(s.name, meta, box, budget).catch(() => null);
    if (!sel || sel.expected < 500) continue;
    const groups = passes(sel.nodes, PER_PASS);
    const pass = Math.max(0, Math.min(groups.length - 1, r.pass));
    const free = await decodeSlot();
    let kept: (Kept | null)[];
    try {
      kept = await pool(groups[pass], 4, async (node) => { try { return keep(await decodeLaz(await fetchNode(s.name, node.key)), box, cx, cy, k); } catch { return null; } });
    } finally {
      free();
    }
    let n = 0, zSum = 0;
    for (const d of kept) if (d) { n += d.n; zSum += d.zSum; }
    if (!n) continue;
    const xyz = new Float32Array(n * 3), cls = new Uint8Array(n), inten = new Uint8Array(n);
    const classes: Record<string, number> = {};
    const ground: number[] = [];
    let at = 0;
    for (const d of kept) {
      if (!d) continue;
      xyz.set(d.xyz, at * 3); cls.set(d.cls, at); inten.set(d.inten, at);
      at += d.n;
      for (const [c, v] of Object.entries(d.classes)) classes[c] = (classes[c] ?? 0) + v;
      for (const g of d.ground) ground.push(g);
    }
    // Heights are sent relative to the cloud's mean, so int16 offsets reach a kilometre and a half either way.
    const z0 = Math.round(zSum / n);
    for (let i = 0; i < n; i++) xyz[i * 3 + 2] -= z0;
    ground.sort((a, b) => a - b);
    const header: PointCloudHeader = {
      n, q: 0.05, origin: { lon: r.lon, lat: r.lat, z: z0 },
      groundZ: ground.length >= 5 ? Math.round(ground[Math.floor(ground.length / 2)] * 100) / 100 : null,
      survey: s.name, year: s.year, pass, passes: groups.length, depth: sel.depth, truncated: sel.truncated, classes, bbox,
    };
    return { bytes: encodePoints(header, xyz, cls, inten), header };
  }
  return null;
}
