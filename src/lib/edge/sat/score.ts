/**
 * The scoring every satellite analysis shares, pure and tested (scripts/test-edge-sat.ts): a reading now
 * against a baseline of earlier readings of the same place (the same weeks of earlier years for crops and
 * water, earlier passes for ships), as a z-score and a percent change, with a minimum of evidence before
 * anything is called a signal. Also the pixel arithmetic: NDVI, MNDWI, the Sentinel-2 offset, and bright
 * targets on water in radar.
 */

export type Baseline = { label: string; value: number }[];
export type Assessment = {
  current: number; mean: number; sd: number; n: number; z: number; pct: number;
  /** Enough evidence: at least `minN` baseline readings and a valid share of the scene. */
  enough: boolean;
  /** A signal: enough evidence, and both the z-score and the percent change past their thresholds. */
  signal: boolean;
  direction: "up" | "down" | "flat";
};

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
/** Sample standard deviation (n - 1). Pure. */
export function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/**
 * A reading against its baseline. The standard deviation has a floor (`sdFloor`) so a baseline of years
 * that happened to agree closely cannot turn a small change into a huge z-score. Pure.
 */
export function assess(current: number, baseline: Baseline, opts: { minN?: number; zMin?: number; pctMin?: number; sdFloor?: number; validShare?: number; minValid?: number } = {}): Assessment {
  const { minN = 3, zMin = 2, pctMin = 0.08, sdFloor = 0, validShare = 1, minValid = 0.4 } = opts;
  const vals = baseline.map((b) => b.value).filter(Number.isFinite);
  const m = mean(vals), sd = Math.max(stdev(vals), sdFloor);
  const n = vals.length;
  const z = n >= 2 && sd > 0 ? (current - m) / sd : 0;
  const pct = n && Math.abs(m) > 1e-9 ? (current - m) / Math.abs(m) : 0;
  const enough = Number.isFinite(current) && n >= minN && validShare >= minValid;
  const signal = enough && Math.abs(z) >= zMin && Math.abs(pct) >= pctMin;
  const round = (v: number, dp = 3) => Math.round(v * 10 ** dp) / 10 ** dp;
  return { current: round(current), mean: round(m), sd: round(sd), n, z: round(z, 2), pct: round(pct), enough, signal, direction: !signal ? "flat" : current > m ? "up" : "down" };
}

/** How sure, 0.2 to 0.92: more baseline readings, a clearer scene and a larger z raise it. Pure. */
export function satConfidence(a: Pick<Assessment, "n" | "z">, validShare: number): number {
  const c = 0.4 + 0.05 * Math.min(4, Math.max(0, a.n - 2)) + 0.06 * Math.min(4, Math.max(0, Math.abs(a.z) - 2)) + 0.2 * Math.max(0, Math.min(1, (validShare - 0.4) / 0.5));
  return Math.round(Math.max(0.2, Math.min(0.92, c)) * 100) / 100;
}

/** How big, 0 to 1, from the z-score and the percent change. Pure. */
export const satMagnitude = (a: Pick<Assessment, "z" | "pct">) => Math.round(Math.min(1, 0.5 * Math.min(1, Math.abs(a.z) / 5) + 0.5 * Math.min(1, Math.abs(a.pct) / 0.4)) * 100) / 100;

/**
 * Sentinel-2 L2A stores reflectance with an offset of 1000 from processing baseline 04.00 (25 January
 * 2022); scenes before it have none. The offset for a scene's date. Pure.
 */
export const s2Offset = (date: string) => (date >= "2022-01-25" ? 1000 : 0);

/** Scene classes (SCL) that are clear land: vegetation (4) and bare soil (5). Clouds, shadow, water and snow are left out. */
const LAND = new Set([4, 5]);
/** Clear classes for water: vegetation, bare, water (6) and unclassified (7). */
const CLEAR = new Set([4, 5, 6, 7]);

/** A normalised difference (a - b) / (a + b) of two bands as reflectance. Pure. */
const nd = (a: number, b: number, off: number) => { const x = (a - off) / 10_000, y = (b - off) / 10_000; return x + y > 0.01 ? (x - y) / (x + y) : NaN; };

/** Mean NDVI over clear land pixels (bands as stored, SCL as classes), with the share of the box that was clear land. Pure. */
export function ndviStats(b04: ArrayLike<number>, b08: ArrayLike<number>, scl: ArrayLike<number>, date: string): { value: number; valid: number } {
  const off = s2Offset(date);
  let sum = 0, n = 0;
  for (let i = 0; i < b04.length; i++) {
    if (!LAND.has(Math.round(scl[i]))) continue;
    const v = nd(b08[i], b04[i], off);
    if (!Number.isFinite(v)) continue;
    sum += v; n++;
  }
  return { value: n ? sum / n : NaN, valid: b04.length ? n / b04.length : 0 };
}

/** The share of clear pixels that are open water (MNDWI from green B03 and shortwave infrared B11 above zero), with the clear share. Pure. */
export function waterShare(b03: ArrayLike<number>, b11: ArrayLike<number>, scl: ArrayLike<number>, date: string): { value: number; valid: number } {
  const off = s2Offset(date);
  let wet = 0, n = 0;
  for (let i = 0; i < b03.length; i++) {
    if (!CLEAR.has(Math.round(scl[i]))) continue;
    const v = nd(b03[i], b11[i], off);
    if (!Number.isFinite(v)) continue;
    n++; if (v > 0) wet++;
  }
  return { value: n ? wet / n : NaN, valid: b03.length ? n / b03.length : 0 };
}

export const db = (linear: number) => 10 * Math.log10(Math.max(linear, 1e-6));

/**
 * Open water in radar: pixels dark (below `maxDb`, about -15 dB in VV) in the median of several passes.
 * Ships come and go, so the median of a handful of passes shows the water under them. Pure.
 */
export function waterMask(passes: { vv: ArrayLike<number>; valid: ArrayLike<number> }[], maxDb = -15): Uint8Array {
  const n = passes[0]?.vv.length ?? 0, out = new Uint8Array(n);
  const vals: number[] = [];
  for (let i = 0; i < n; i++) {
    vals.length = 0;
    for (const p of passes) if (p.valid[i]) vals.push(p.vv[i]);
    if (vals.length < Math.min(3, passes.length)) continue;
    vals.sort((a, b) => a - b);
    out[i] = db(vals[Math.floor(vals.length / 2)]) < maxDb ? 1 : 0;
  }
  return out;
}

/**
 * Ships on water in one radar pass: groups of bright pixels (above `minDb`, about -5 dB in VV: steel)
 * over the water mask, touching side by side, of between `minPx` and `maxPx` pixels (smaller is
 * speckle, larger is a structure or the shore). Returns the count and each ship's centre pixel. Pure.
 */
export function brightTargets(vv: ArrayLike<number>, valid: ArrayLike<number>, water: ArrayLike<number>, size: number, opts: { minDb?: number; minPx?: number; maxPx?: number } = {}): { count: number; centres: [number, number][] } {
  const { minDb = -5, minPx = 2, maxPx = 2000 } = opts;
  const n = size * size, seen = new Uint8Array(n);
  const bright = (i: number) => !!valid[i] && !!water[i] && db(vv[i]) > minDb;
  const centres: [number, number][] = [];
  const stack: number[] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || !bright(i)) continue;
    let px = 0, sx = 0, sy = 0;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const k = stack.pop()!, x = k % size, y = (k - x) / size;
      px++; sx += x; sy += y;
      for (const j of [x > 0 ? k - 1 : -1, x < size - 1 ? k + 1 : -1, y > 0 ? k - size : -1, y < size - 1 ? k + size : -1]) {
        if (j >= 0 && !seen[j] && bright(j)) { seen[j] = 1; stack.push(j); }
      }
    }
    if (px >= minPx && px <= maxPx) centres.push([Math.round(sx / px), Math.round(sy / px)]);
  }
  return { count: centres.length, centres };
}

/** The same weeks in earlier years: [from, to] dates `years` back from a window ending `to`, `days` long. Pure. */
export function sameWindowEarlier(to: Date, days: number, years: number): { year: number; from: Date; to: Date }[] {
  return Array.from({ length: years }, (_, k) => {
    const end = new Date(to); end.setUTCFullYear(to.getUTCFullYear() - (k + 1));
    return { year: end.getUTCFullYear(), from: new Date(end.getTime() - days * 86_400_000), to: end };
  });
}

/** Whether a month (1 to 12) is in a site's season (no season means always). Pure. */
export const inSeason = (month: number, season?: number[]) => !season?.length || season.includes(month);
