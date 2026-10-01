/**
 * Earth · radar change: what was built at the places people watch, seen through cloud and at night.
 * Sentinel-1 radar sees structure, not colour: open desert scatters the signal away and looks dark, while
 * walls, tanks, pipework and machines bounce it straight back and look bright. For each watched plant the
 * same 2.5 km box as ground change is read from two or three recent passes and two or three passes a year
 * before, all on one orbit (so the viewing angle is the same), and each stack is reduced per pixel to the
 * level most of its passes agree on, which beats radar's speckle. Pixels bright now that were dark a year
 * ago form objects; small or faint ones count only on open ground (inside a working plant, metal flickers
 * from pass to pass), and a site with enough of them becomes a card. A site is read again after the next
 * passes (six days); an object already reported is not news again. Free: Copernicus through Planetary
 * Computer.
 */
import { PNG } from "pngjs";
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { logError } from "@/lib/errors";
import { record, type Provenance } from "./provenance";
import { EIA_PLANTS, type Bbox } from "./sources/eia";
import { radarScenes, radarUrl, readPass, S1, type RadarPass, type RadarScene } from "./sources/s1";
import { boxAround } from "./sources/sentinel";
import { components, pool } from "./terrain";
import { BETA_ON } from "./watches";

export const RADAR_VERSION = "radar v1";
const SITE_KM = 2.5;
const SIZE = 256;
const DAY = 86_400_000;
/** Linear backscatter most recent passes must exceed (about -6 dB: steel, walls, machines). */
export const BRIGHT = 0.25;
/** And most passes a year before must stay under (about -11 dB: open ground). */
export const DARK = 0.08;
/** Smallest object that is considered, in 10 m pixels (about 300 m²: a tank, a compressor, a small building). */
export const MIN_PIXELS = 3;
/** The ground around an object counts as busy when more than this share of it was already above CLUTTER_LEVEL. */
const OPEN_RING = 0.2, BUSY_RING = 0.5, CLUTTER_LEVEL = 0.1, CLUTTER_PAD = 4;
/** The whole scene counts as wetter now when its typical ground is this much brighter than a year ago. */
const WETTER = 1.25;
const RECHECK_DAYS = 6;

export type RadarObject = {
  kind: 1 | 2; x: number; y: number; bbox: [number, number, number, number]; pixels: number;
  /** Strongest return in the object (linear): above 1 (0 dB) is a hard corner of metal or wall. */
  peak: number;
  /** Share of the ground around it already bright on the earlier side of the comparison: 0 open desert, 0.3 and up inside a plant. */
  ring: number;
};
export type Majority = { floor: Float32Array; ceil: Float32Array; median: Float32Array; valid: Uint8Array };
export type RadarChange = {
  width: number; height: number;
  /** Share of the box that both stacks see. */
  validFraction: number;
  /** New bright objects (kind 1) and bright objects that are gone (kind 2) that count, biggest first. */
  added: RadarObject[]; removed: RadarObject[];
  /** Typical ground level in each stack (the median pixel), and now over then: wet ground lifts it. */
  ground: { before: number; after: number; ratio: number };
  /** Pixels that crossed both thresholds but are in no counted object: speckle, flicker, faint changes. */
  strays: number;
  /** 0 nothing, 1 new object, 2 object gone (counted objects only). */
  mask: Uint8Array;
};
export type Stacks = { orbit: "ascending" | "descending"; relOrbit: number; after: RadarPass[]; before: RadarPass[] };

/* ---------------- Pure pieces ---------------- */

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);

/**
 * The passes to compare: on the relative orbit with the most passes in both windows (up to `n` each, at
 * least two), its newest `n` passes now and the `n` passes nearest the same dates a year before. Slices of
 * one acquisition are one pass, and a pass counts only when its footprints hold at least three corners of
 * the box (slice outlines are simplified, so two slices that meet across the box can miss a corner they
 * really cover; what was read is checked after). Orbits in `skip` ("ascending:78") are passed over. Null
 * when no orbit has two such passes in both windows. Pure.
 */
export function pickStacks(recent: RadarScene[], old: RadarScene[], n = 3, skip: string[] = []): Stacks | null {
  type G = { orbit: RadarScene["orbit"]; relOrbit: number; after: Map<string, { ids: string[]; corners: number }>; before: Map<string, { ids: string[]; corners: number }> };
  const groups = new Map<string, G>();
  const add = (s: RadarScene, side: "after" | "before") => {
    const k = `${s.orbit}:${s.relOrbit}`;
    const g = groups.get(k) ?? { orbit: s.orbit, relOrbit: s.relOrbit, after: new Map(), before: new Map() };
    const cur = g[side].get(s.date) ?? { ids: [], corners: 0 };
    if (!cur.ids.includes(s.id)) cur.ids.push(s.id);
    cur.corners |= s.corners;
    g[side].set(s.date, cur);
    groups.set(k, g);
  };
  recent.forEach((s) => add(s, "after"));
  old.forEach((s) => add(s, "before"));
  const bits = (c: number) => (c & 1) + ((c >> 1) & 1) + ((c >> 2) & 1) + ((c >> 3) & 1);
  const whole = (m: G["after"]) => [...m.entries()].filter(([, p]) => bits(p.corners) >= 3).map(([date]) => date);
  const ranked = [...groups.entries()].filter(([k]) => !skip.includes(k)).map(([, g]) => {
    const after = whole(g.after).sort().reverse().slice(0, n);
    const target = after.length ? after.reduce((s, d) => s + dayOf(d), 0) / after.length - 365 * DAY : 0;
    const before = whole(g.before).sort((a, b) => Math.abs(dayOf(a) - target) - Math.abs(dayOf(b) - target) || b.localeCompare(a)).slice(0, n).sort().reverse();
    return { g, after, before, score: after.length + before.length };
  }).filter((r) => r.after.length >= 2 && r.before.length >= 2).sort((a, b) => b.score - a.score || b.after[0].localeCompare(a.after[0]));
  const best = ranked[0];
  if (!best) return null;
  return {
    orbit: best.g.orbit, relOrbit: best.g.relOrbit,
    after: best.after.map((date) => ({ date, ids: best.g.after.get(date)!.ids })), before: best.before.map((date) => ({ date, ids: best.g.before.get(date)!.ids })),
  };
}

/**
 * Per pixel, over the passes that see it: the level most of them reach (floor), the level most stay
 * under (ceil) and the median. With three passes floor and ceil are both the median; with two, floor is
 * the lower and ceil the higher, so one bright speckle never makes a pixel bright or dark. Valid where at
 * least two passes see the pixel. Pure.
 */
export function majority(layers: ArrayLike<number>[], valids: ArrayLike<number>[], n: number): Majority {
  const floor = new Float32Array(n), ceil = new Float32Array(n), median = new Float32Array(n), valid = new Uint8Array(n);
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    vals.length = 0;
    for (let k = 0; k < layers.length; k++) if (valids[k][i]) vals.push(layers[k][i]);
    const m = vals.length;
    if (m < 2) continue;
    vals.sort((a, b) => a - b);
    const need = Math.floor(m / 2) + 1;
    floor[i] = vals[m - need]; ceil[i] = vals[need - 1];
    median[i] = m % 2 ? vals[(m - 1) / 2] : (vals[m / 2 - 1] + vals[m / 2]) / 2;
    valid[i] = 1;
  }
  return { floor, ceil, median, valid };
}

/** The median of a layer's valid values. Pure. */
export function levelOf(values: ArrayLike<number>, valid: ArrayLike<number>): number {
  const kept: number[] = [];
  for (let i = 0; i < values.length; i++) if (valid[i]) kept.push(values[i]);
  if (!kept.length) return 0;
  kept.sort((a, b) => a - b);
  return kept[Math.floor((kept.length - 1) / 2)];
}

/**
 * The share of the ring of pixels around a blob (its bounding box grown by `pad`, less the blob) that was
 * already brighter than `level` in `layer`: near 0 on open desert, 0.3 and up inside a plant. Pure.
 */
export function ringBright(blob: number[], layer: ArrayLike<number>, valid: ArrayLike<number>, width: number, height: number, level: number, pad = 3): number {
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  const inBlob = new Set(blob);
  for (const p of blob) { const x = p % width, y = (p - x) / width; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  let ring = 0, lit = 0;
  for (let y = Math.max(0, y0 - pad); y <= Math.min(height - 1, y1 + pad); y++) {
    for (let x = Math.max(0, x0 - pad); x <= Math.min(width - 1, x1 + pad); x++) {
      const p = y * width + x;
      if (inBlob.has(p) || !valid[p]) continue;
      ring++;
      if (layer[p] > level) lit++;
    }
  }
  return ring ? lit / ring : 0;
}

/**
 * Whether an object counts. On open ground: eight pixels or more, or a hard return (above 1, 0 dB) of at
 * least three; when the whole scene is wetter than a year ago only hard returns count (damp soil and
 * growing crops brighten broadly but softly). On busy ground, beside or inside a plant whose metal
 * flickers from pass to pass: only large, strong objects (fifteen pixels, above 3, about +5 dB). Never
 * where half the ground around was bright already. Pure.
 */
export function counts(o: Pick<RadarObject, "pixels" | "peak" | "ring">, wetter: boolean): boolean {
  if (o.ring <= OPEN_RING) return o.peak >= 1 ? o.pixels >= MIN_PIXELS : !wetter && o.pixels >= 8;
  return o.ring <= BUSY_RING && o.pixels >= 15 && o.peak >= 3;
}

/**
 * New and vanished bright objects between two stacks of the same box: a pixel is new when most recent
 * passes return more than `bright` and most earlier ones less than `dark` (gone, the other way round);
 * neighbouring pixels (eight ways) form objects of at least three pixels, kept when they count (above).
 * A new object is judged against the ground around it a year ago, a vanished one against it now. Pure.
 */
export function radarChange(before: Majority, after: Majority, width: number, height: number, opts: { bright?: number; dark?: number } = {}): RadarChange {
  const bright = opts.bright ?? BRIGHT, dark = opts.dark ?? DARK;
  const n = width * height;
  const raw = new Uint8Array(n);
  let both = 0, candidates = 0;
  for (let i = 0; i < n; i++) {
    if (!before.valid[i] || !after.valid[i]) continue;
    both++;
    if (after.floor[i] > bright && before.ceil[i] < dark) raw[i] = 1;
    else if (before.floor[i] > bright && after.ceil[i] < dark) raw[i] = 2;
    if (raw[i]) candidates++;
  }
  const gb = levelOf(before.median, before.valid), ga = levelOf(after.median, after.valid);
  const ratio = gb > 0 ? Math.round((ga / gb) * 100) / 100 : 1;
  const mask = new Uint8Array(n);
  let kept = 0;
  const objects = (kind: 1 | 2) => components(raw, width, height, kind, MIN_PIXELS).flatMap((blob): RadarObject[] => {
    const side = kind === 1 ? before : after, level = kind === 1 ? after.floor : before.floor;
    const ring = Math.round(ringBright(blob, side.median, side.valid, width, height, CLUTTER_LEVEL, CLUTTER_PAD) * 100) / 100;
    let sx = 0, sy = 0, peak = 0, x0 = width, y0 = height, x1 = 0, y1 = 0;
    for (const p of blob) {
      const x = p % width, y = (p - x) / width;
      sx += x; sy += y; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      peak = Math.max(peak, level[p]);
    }
    const o: RadarObject = { kind, x: Math.round((sx / blob.length) * 10) / 10, y: Math.round((sy / blob.length) * 10) / 10, bbox: [x0, y0, x1, y1], pixels: blob.length, peak: Math.round(peak * 1000) / 1000, ring };
    // Gone objects are judged as new ones are, with "wetter" the other way round (a drier scene now dims softly).
    if (!counts(o, kind === 1 ? ratio > WETTER : ratio < 1 / WETTER)) return [];
    for (const p of blob) mask[p] = kind;
    kept += blob.length;
    return [o];
  });
  const added = objects(1), removed = objects(2);
  return { width, height, validFraction: both / n, added, removed, ground: { before: gb, after: ga, ratio }, strays: candidates - kept, mask };
}

/** Objects not already reported: none within `metres` of a reported one. Pure. */
export function unreported<T extends { lon: number; lat: number }>(found: T[], reported: { lon: number; lat: number }[], metres = 40): T[] {
  const near = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => {
    const dy = (a.lat - b.lat) * 110_574, dx = (a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dx, dy) <= metres;
  };
  return found.filter((f) => !reported.some((r) => near(f, r)));
}

/** Square metres of ground per pixel for a box split into `size` by `size` pixels. Pure. */
export function pixelArea(bbox: Bbox, size: number): number {
  const lat = (bbox[1] + bbox[3]) / 2;
  return (((bbox[2] - bbox[0]) * 111_320 * Math.cos((lat * Math.PI) / 180)) / size) * (((bbox[3] - bbox[1]) * 110_574) / size);
}

/** Whether a scene is fit to compare: most of the box seen both times, and the ground neither far wetter nor far drier than a year ago. Pure. */
export const comparable = (c: Pick<RadarChange, "validFraction" | "ground">) => c.validFraction >= 0.8 && c.ground.ratio <= 2 && c.ground.ratio >= 0.5;

/** Whether new objects make a card: at least 20 pixels between them (about 1,900 m²), one of them a hard return of four pixels or more. Pure. */
export function radarWorthy(objects: Pick<RadarObject, "pixels" | "peak">[]): boolean {
  return objects.reduce((s, o) => s + o.pixels, 0) >= 20 && objects.some((o) => o.peak >= 1 && o.pixels >= 4);
}

/**
 * How sure Edge is that something was built: more and bigger objects, hard returns, three passes on each
 * side raise it; a scene wetter than a year ago (damp ground brightens, a drier one only hides change)
 * and change that got through without forming objects lower it. 0.2 to 0.95. Pure.
 */
export function radarConfidence(c: Pick<RadarChange, "added" | "ground" | "strays">, passes: { before: number; after: number }): number {
  const pixels = c.added.reduce((s, o) => s + o.pixels, 0);
  const strong = c.added.filter((o) => o.peak >= 1 && o.pixels >= 4).length;
  const wet = Math.max(0, Math.log2(Math.max(0.01, c.ground.ratio)));
  let v = 0.4 + 0.08 * Math.min(1, c.added.length / 4) + 0.14 * Math.min(1, pixels / 80) + 0.12 * Math.min(1, strong / 3);
  v += passes.before >= 3 && passes.after >= 3 ? 0.08 : 0;
  v -= Math.min(0.25, wet * 0.35) + Math.min(0.1, c.strays / 1000);
  return Math.round(Math.max(0.2, Math.min(0.95, v)) * 100) / 100;
}

/** How big, 0 to 1: the ground the new objects cover, a hectare or more counting in full. Pure. */
export const radarMagnitude = (areaM2: number) => Math.round(Math.max(0, Math.min(1, areaM2 / 10_000)) * 100) / 100;

/** Compass words for an offset from the box centre in pixels (y down): "north-east of", or "at" near the middle. Pure. */
export function bearingWords(dx: number, dy: number, near = 12): string {
  if (Math.hypot(dx, dy) < near) return "at";
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  const names = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
  return `${names[Math.round(((deg + 360) % 360) / 45) % 8]} of`;
}

/** Decibels of a linear return, one decimal. Pure. */
export const toDb = (v: number) => Math.round(10 * Math.log10(Math.max(1e-6, v)) * 10) / 10;

/** The objects as a transparent overlay: new ones amber, gone ones blue, each ringed so a small one is easy to find. */
export function radarOverlayPng(c: Pick<RadarChange, "width" | "height" | "mask" | "added" | "removed">): Buffer {
  const { width: w, height: h } = c;
  const png = new PNG({ width: w, height: h });
  const paint = (p: number, rgb: number[], a: number) => { const i = p * 4; if (png.data[i + 3] >= a) return; png.data[i] = rgb[0]; png.data[i + 1] = rgb[1]; png.data[i + 2] = rgb[2]; png.data[i + 3] = a; };
  for (const o of [...c.added, ...c.removed]) {
    const rgb = o.kind === 1 ? [255, 176, 32] : [56, 189, 248], pad = 3;
    const [x0, y0, x1, y1] = [o.bbox[0] - pad, o.bbox[1] - pad, o.bbox[2] + pad, o.bbox[3] + pad];
    for (let x = x0; x <= x1; x++) for (const y of [y0, y1]) if (x >= 0 && y >= 0 && x < w && y < h) paint(y * w + x, rgb, 170);
    for (let y = y0; y <= y1; y++) for (const x of [x0, x1]) if (x >= 0 && y >= 0 && x < w && y < h) paint(y * w + x, rgb, 170);
  }
  for (let p = 0; p < c.mask.length; p++) if (c.mask[p]) paint(p, c.mask[p] === 1 ? [255, 176, 32] : [56, 189, 248], 235);
  return PNG.sync.write(png);
}

/* ---------------- Reading the passes ---------------- */

export type Plant = { id: number; name: string; company: string; ticker: string; lon: number; lat: number; cap: number };
type SiteState = { checked: string; reported: [number, number][]; card?: string };
const STATE = "edge:radar:sites:v1";

/** Plants inside what people with the beta on watch (their companies' plants, the plants in their places). */
export async function watchedPlants(): Promise<Plant[]> {
  const rows = await requireDb().execute(sql`
    select distinct a.id, a.name, a.company, a.ticker, ST_X(a.geom) as lon, ST_Y(a.geom) as lat, coalesce((a.attrs->>'capacityMMcfd')::float, 0) as cap
    from edge_assets a
    join edge_watches w on (w.kind = 'company' and w.target->>'ticker' = a.ticker)
      or (w.kind = 'place' and jsonb_typeof(w.target->'bbox') = 'array' and a.geom && ST_MakeEnvelope((w.target->'bbox'->>0)::float, (w.target->'bbox'->>1)::float, (w.target->'bbox'->>2)::float, (w.target->'bbox'->>3)::float, 4326))
    join profiles on profiles.user_id = w.user_id
    where a.kind = 'processing_plant' and a.owner_id is null and ${BETA_ON}`);
  return (rows.rows as { id: number; name: string; company: string | null; ticker: string | null; lon: number; lat: number; cap: number }[])
    .map((r) => ({ id: Number(r.id), name: r.name, company: r.company ?? "", ticker: r.ticker ?? "", lon: Number(r.lon), lat: Number(r.lat), cap: Number(r.cap) || 0 }));
}

/** Read a box's two stacks and compare them; null when an orbit lacks two clear passes on either side. */
export async function radarAt(box: Bbox, now = Date.now()) {
  const [recent, old] = await Promise.all([
    radarScenes(box, new Date(now - 40 * DAY), new Date(now)),
    radarScenes(box, new Date(now - 405 * DAY), new Date(now - 325 * DAY)),
  ]);
  // A pass that turns out to cover too little of the box is dropped; an orbit left short is passed over once.
  const skip: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const picked = pickStacks(recent, old, 3, skip);
    if (!picked) return null;
    const wins = await pool([...picked.after, ...picked.before], 3, (p) => readPass(p, box, SIZE));
    const keep = (passes: RadarPass[], from: number) => passes.map((p, k) => ({ p, w: wins[from + k] })).filter((x) => x.w.coverage >= 0.9);
    const A = keep(picked.after, 0), B = keep(picked.before, picked.after.length);
    if (A.length < 2 || B.length < 2) { skip.push(`${picked.orbit}:${picked.relOrbit}`); continue; }
    const n = SIZE * SIZE;
    const after = majority(A.map((x) => x.w.vv), A.map((x) => x.w.valid), n), before = majority(B.map((x) => x.w.vv), B.map((x) => x.w.valid), n);
    const stacks: Stacks = { ...picked, after: A.map((x) => x.p), before: B.map((x) => x.p) };
    return { stacks, change: radarChange(before, after, SIZE, SIZE) };
  }
  return null;
}

const fmt = (v: number) => Math.round(v).toLocaleString("en-US");
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dates = (passes: RadarPass[]) => { const d = passes.map((p) => p.date).sort(); return d.length > 1 ? `${d[0]} to ${d[d.length - 1]}` : d[0]; };

/** Compare one plant now with a year ago. Returns the new card's id (or null) and the plant's record. */
export async function checkRadar(p: Plant, state: SiteState | undefined, now = Date.now()): Promise<{ id: number | null; state: SiteState }> {
  const box = boxAround(p.lon, p.lat, SITE_KM);
  const next: SiteState = { checked: new Date(now).toISOString(), reported: state?.reported ?? [], ...(state?.card ? { card: state.card } : {}) };
  const got = await radarAt(box, now);
  if (!got || !comparable(got.change)) return { id: null, state: next };
  const { stacks, change: c } = got;
  const area = pixelArea(box, SIZE);
  const where = (o: RadarObject) => ({ lon: box[0] + ((o.x + 0.5) / SIZE) * (box[2] - box[0]), lat: box[3] - ((o.y + 0.5) / SIZE) * (box[3] - box[1]) });
  const objects = c.added.map((o) => ({ ...o, ...where(o), areaM2: o.pixels * area }));
  const fresh = unreported(objects, (state?.reported ?? []).map(([lon, lat]) => ({ lon, lat })));
  if (!radarWorthy(fresh)) return { id: null, state: next };
  const key = `radar:v1:asset:${p.id}:${stacks.orbit}${stacks.relOrbit}:${stacks.after[0].date}`;
  const [existing] = await requireDb().select({ id: schema.edgeDetections.id }).from(schema.edgeDetections).where(sql`${schema.edgeDetections.key} = ${key}`);
  if (existing) return { id: null, state: next };

  const total = objects.reduce((s, o) => s + o.areaM2, 0), largest = objects[0];
  const strong = objects.filter((o) => o.peak >= 1 && o.pixels >= 4).length;
  const gone = c.removed.reduce((s, o) => s + o.pixels, 0) * area;
  const confidence = radarConfidence(c, { before: stacks.before.length, after: stacks.after.length });
  const owner = p.company || "an unmapped operator";
  const known = objects.length - fresh.length;
  const off = c.ground.ratio > 1.25 ? ` The ground as a whole returns ${Math.round((c.ground.ratio - 1) * 100)}% more than a year ago (likely damp), so only hard returns were counted.` : c.ground.ratio < 0.8 ? ` The ground as a whole returns ${Math.round((1 - c.ground.ratio) * 100)}% less than a year ago (likely drier).` : "";
  const n = objects.length;
  const title = `Radar shows ${n === 1 ? "a new structure" : `${n} new structures`} ${bearingWords(largest.x - SIZE / 2, largest.y - SIZE / 2)} ${p.name}`;
  const summary = `Sentinel-1 radar, which sees through cloud and at night, shows ${plural(n, "bright object")} within ${SITE_KM / 2} km of ${p.name} (${owner}${p.cap ? `, ${fmt(p.cap)} MMcfd` : ""}) that ${n === 1 ? "was" : "were"} not there a year ago: about ${fmt(total)} m² in all, the largest about ${fmt(largest.areaM2)} m² ${bearingWords(largest.x - SIZE / 2, largest.y - SIZE / 2)} the plant, ${plural(strong, "hard return")} of steel or walls.${known ? ` ${known} of them ${known === 1 ? "was" : "were"} in an earlier radar card.` : ""}${c.removed.length ? ` ${plural(c.removed.length, "bright object")} from a year ago (about ${fmt(gone)} m²) ${c.removed.length === 1 ? "is" : "are"} gone.` : ""} Compared: ${plural(stacks.after.length, "pass", "passes")} from ${dates(stacks.after)} against ${stacks.before.length} from ${dates(stacks.before)}, on the same orbit. A new tank, compressor, building, or a rig parked for weeks shows this way.`;
  const why = `Radar sees structure and steel, not colour: open ground scatters the signal away and looks dark, while walls, tanks, pipework and machines bounce it straight back and look bright. Each stack of passes is reduced pixel by pixel to the level most of its passes agree on, which removes radar's speckle; a 10 m pixel counts as new when most recent passes return more than ${BRIGHT} (about ${toDb(BRIGHT)} dB) and most passes a year earlier less than ${DARK} (about ${toDb(DARK)} dB). Neighbouring pixels form objects; small or faint ones count only on open ground, and beside or inside a working plant only large, strong ones, because metal there flickers from pass to pass. Both stacks are on one orbit (${stacks.orbit}, relative orbit ${stacks.relOrbit}), so the viewing angle is the same. Wet ground and a vehicle or rig parked for weeks can mislead; a passing vehicle cannot, as it is gone in the other passes.${off}`;
  const visual = {
    type: "radar_change", site: { name: p.name, kind: "processing_plant", company: p.company, ticker: p.ticker, lon: p.lon, lat: p.lat, capacityMMcfd: p.cap }, bbox: box,
    before: { url: radarUrl(stacks.before[0].ids[0], box), date: stacks.before[0].date, scene: stacks.before[0].ids[0], dates: stacks.before.map((x) => x.date) },
    after: { url: radarUrl(stacks.after[0].ids[0], box), date: stacks.after[0].date, scene: stacks.after[0].ids[0], dates: stacks.after.map((x) => x.date) },
    overlay: `data:image/png;base64,${radarOverlayPng(c).toString("base64")}`,
    orbit: { direction: stacks.orbit, relative: stacks.relOrbit },
    stats: { newObjects: n, newAreaM2: Math.round(total), largestM2: Math.round(largest.areaM2), strong, known, goneObjects: c.removed.length, goneAreaM2: Math.round(gone), groundRatio: c.ground.ratio, clearPct: Math.round(c.validFraction * 100), passes: { before: stacks.before.length, after: stacks.after.length } },
    objects: objects.slice(0, 10).map((o) => ({ lon: Math.round(o.lon * 1e5) / 1e5, lat: Math.round(o.lat * 1e5) / 1e5, areaM2: Math.round(o.areaM2), peakDb: toDb(o.peak), where: bearingWords(o.x - SIZE / 2, o.y - SIZE / 2), fresh: fresh.includes(o) })),
    size: SIZE,
  };
  const [row] = await requireDb().insert(schema.edgeDetections).values({
    key, kind: "radar_change", module: "earth", title: title.slice(0, 200), summary: summary.slice(0, 1200), why, confidence, magnitude: radarMagnitude(total),
    tickers: p.ticker ? [p.ticker] : [], assetIds: [p.id], bbox: box, visual, observedAt: new Date(`${stacks.after[0].date}T12:00:00Z`),
  }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
  if (!row) return { id: null, state: next };
  const retrieved = new Date();
  const sources: Provenance[] = [
    { sourceName: S1.name, sourceUrl: `${S1.url} (passes ${[...stacks.after, ...stacks.before].flatMap((x) => x.ids).join(", ")})`, license: S1.license, method: `${RADAR_VERSION}: per-pixel majority of ${stacks.after.length} recent and ${stacks.before.length} year-old VV passes on one orbit; new where above ${BRIGHT} now and below ${DARK} then, objects of ${MIN_PIXELS}+ pixels`, modelVersion: "", retrievedAt: retrieved },
    { sourceName: EIA_PLANTS.name, sourceUrl: EIA_PLANTS.url, license: EIA_PLANTS.license, method: `site location (${EIA_PLANTS.vintage})`, modelVersion: "", retrievedAt: retrieved },
  ];
  await record(`detection:${row.id}`, sources);
  next.reported = [...next.reported, ...fresh.map((o): [number, number] => [Math.round(o.lon * 1e5) / 1e5, Math.round(o.lat * 1e5) / 1e5])].slice(-120);
  next.card = next.checked;
  return { id: row.id, state: next };
}

const readState = async (): Promise<Record<string, SiteState>> => { try { const v = await cacheGet(STATE); return v ? (JSON.parse(v) as Record<string, SiteState>) : {}; } catch { return {}; } };

/**
 * The daily radar pass: the watched plants not read in the last six days (never-read first, then the
 * longest ago, then the biggest), two at a time, until the deadline or `maxSites`. Returns the new cards.
 */
export async function scanRadar(deadline: number, maxSites = 12): Promise<{ watched: number; due: number; checked: number; created: number[] }> {
  const plants = await watchedPlants();
  const state = await readState();
  const now = Date.now();
  const due = plants.filter((p) => !state[p.id] || now - Date.parse(state[p.id].checked) >= RECHECK_DAYS * DAY - 3_600_000)
    .sort((a, b) => (state[a.id]?.checked ?? "").localeCompare(state[b.id]?.checked ?? "") || b.cap - a.cap).slice(0, maxSites);
  const out = { watched: plants.length, due: due.length, checked: 0, created: [] as number[] };
  let next = 0;
  await Promise.all([0, 1].map(async () => {
    while (next < due.length && Date.now() < deadline) {
      const p = due[next++];
      try {
        const r = await checkRadar(p, state[p.id]);
        state[p.id] = r.state;
        out.checked++;
        if (r.id) out.created.push(r.id);
      } catch (e) {
        logError(e, { where: "edge-radar" });
      }
    }
  }));
  if (out.checked) await cacheSet(STATE, JSON.stringify(state), 400 * DAY);
  return out;
}
