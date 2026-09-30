/**
 * Ground change between two aligned true-colour crops (method "pixel-change v2"). The newer image's
 * brightness is put on the older one's scale by relative radiometric normalization: a line fitted
 * through the pixels that look unchanged (pseudo-invariant features), so haze, sun angle and a
 * washed-out scene shift the whole picture without counting as change, while what really changed keeps
 * its contrast (matching whole distributions would erase a new pad that is the brightest thing in view).
 * New bare ground (well pads, plant pads, roads, a drained pit) shows as pixels that became much brighter,
 * brighter than most of the box, and pale: caliche, gravel and concrete are near white or grey, while soil
 * that dried out or a field that was ploughed turns tan or red. New dark surfaces (ponds, tanks, fresh asphalt) as pixels that
 * lost at least 40% of their brightness, are now among the darkest and are not plant green (shrubs
 * filling in after a wet year and damp creek beds lose 10 to 30%; an irrigated field turns green, a pond
 * dark grey, blue or turquoise). Sentinel-2's own scene classification removes what
 * it cannot be: cloud, cirrus or shadow in either image, and anything classed as vegetation now (shrubs
 * greening after rain, not construction). Brightness alone would also throw away bright caliche pads,
 * which are what this looks for. What is kept must form compact blobs, as construction does; creek beds,
 * drying playas and scrub are long or ragged. When more than an eighth of the box differs, the scenes
 * themselves differ (a smoke plume, a flooded season) and nothing is reported. Pure, for tests; the PNG
 * wrappers are at the bottom.
 */
import { PNG } from "pngjs";

/** Bumped when the method changes, so sites are read again with the better method. */
export const CHANGE_VERSION = "v2";
export const CHANGE_METHOD = "pixel-change v2 (brightness normalized on unchanged pixels, scene-classification mask without cloud, shadow or vegetation, compact blobs, pale new ground, no plant-green darkening, 10 m)";

export type ChangeResult = {
  width: number; height: number;
  /** Share of pixels usable in both images (clear in both scenes). */
  validFraction: number;
  cleared: { pixels: number; fraction: number; hectares: number };
  darkened: { pixels: number; fraction: number; hectares: number };
  /** The biggest single change, which decides whether there is anything to report. */
  largest: { pixels: number; hectares: number };
  /** How compact the kept changes are, 0 to 1 (area-weighted share of each blob's bounding box it fills). */
  shape: number;
  /** Share of usable pixels that crossed the threshold before the shape filters: how restless the scene is. */
  noise: number;
  /** True when too much of the area differs to call anything a local change. */
  sceneWide: boolean;
  /** 0 unchanged or unusable, 1 cleared (brighter), 2 darkened. */
  mask: Uint8Array;
};

/**
 * Sentinel-2 scene classes a comparison can trust: dark areas, vegetation, bare ground, water and
 * unclassified. Left out: no data (0), defective (1), cloud shadow (3), clouds (8, 9), cirrus (10), snow (11).
 */
const USABLE_CLASSES = new Set([2, 4, 5, 6, 7]);
const VEGETATION = 4;
/** Smallest blob that counts, in pixels (about 0.12 ha at 10 m: a tank or a small pad). */
const MIN_BLOB = 12;
/** Least share of its bounding box a blob must fill; a square turned 45 degrees fills half. */
const MIN_SOLIDITY = 0.4;
/** How pale new bare ground must be: its average colour's weakest channel over its strongest. Caliche pads and roads are 0.65 to 0.98; dried soil and ploughed fields 0.45 to 0.6. */
const MIN_PALENESS = 0.62;

const lum = (d: Uint8Array | Buffer, i: number) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;

const quantile = (sorted: ArrayLike<number>, q: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0);

/**
 * Put `after` brightness on `before`'s scale. Start from the median difference (gain 1), keep the pixels
 * that then agree closely, which are most likely unchanged, and fit a straight line through them (least
 * squares); twice, so the second pass picks its unchanged pixels with the better line. Returns gain and
 * offset (after' = gain * after + offset). Pure.
 */
export function normalize(before: ArrayLike<number>, after: ArrayLike<number>): { gain: number; offset: number } {
  const n = before.length;
  if (!n) return { gain: 1, offset: 0 };
  let gain = 1;
  let offset = quantile(Float64Array.from({ length: n }, (_, i) => before[i] - after[i]).sort(), 0.5);
  const resid = new Float64Array(n);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) resid[i] = gain * after[i] + offset - before[i];
    const med = quantile(Float64Array.from(resid).sort(), 0.5);
    const tol = Math.max(0.05, 3 * quantile(Float64Array.from(resid, (r) => Math.abs(r - med)).sort(), 0.5));
    let k = 0, mx = 0, my = 0;
    for (let i = 0; i < n; i++) if (Math.abs(resid[i] - med) <= tol) { k++; mx += after[i]; my += before[i]; }
    if (k < Math.max(20, n * 0.2)) break;
    mx /= k; my /= k;
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) if (Math.abs(resid[i] - med) <= tol) { const dx = after[i] - mx; sxx += dx * dx; sxy += dx * (before[i] - my); }
    // With too little range among the unchanged pixels to fit a slope, keep the gain and fit the offset.
    if (sxx / k > 1e-4) gain = Math.max(0.5, Math.min(2, sxy / sxx));
    offset = my - gain * mx;
  }
  return { gain, offset };
}

/**
 * Compare two RGBA images of the same box (same size). `areaKm2` is the ground area the box covers.
 * `classesBefore`/`classesAfter` are each scene's classification per pixel (see classesFrom; without
 * them every pixel counts as usable). `threshold` is the brightness change (0 to 1, after matching) a
 * pixel must make to count.
 */
export function changeBetween(before: Uint8Array | Buffer, after: Uint8Array | Buffer, width: number, height: number, areaKm2: number, opts: { classesBefore?: Uint8Array; classesAfter?: Uint8Array; threshold?: number } = {}): ChangeResult {
  const threshold = opts.threshold ?? 0.15;
  const n = width * height;
  const { classesBefore: cb, classesAfter: ca } = opts;
  const valid = new Uint8Array(n);
  const lb = new Float32Array(n), la = new Float32Array(n);
  const valsB: number[] = [], valsA: number[] = [];
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (before[i + 3] === 0 || after[i + 3] === 0) continue;
    if ((cb && !USABLE_CLASSES.has(cb[p])) || (ca && !USABLE_CLASSES.has(ca[p]))) continue;
    const b = lum(before, i), a = lum(after, i);
    if (b < 0.02 && a < 0.02) continue; // empty
    valid[p] = 1; lb[p] = b; la[p] = a;
    valsB.push(b); valsA.push(a);
  }
  const usable = valsB.length;
  const { gain, offset } = normalize(valsB, valsA);
  const sortedB = Float64Array.from(valsB).sort();
  const brightFloor = quantile(sortedB, 0.6), darkCeiling = quantile(sortedB, 0.2);
  const raw = new Uint8Array(n);
  let restless = 0;
  for (let p = 0; p < n; p++) {
    if (!valid[p]) continue;
    const a = gain * la[p] + offset, d = a - lb[p];
    if (Math.abs(d) > threshold) restless++;
    if (ca && ca[p] === VEGETATION) continue;
    if (d > threshold && a > brightFloor && a > 1.25 * lb[p]) raw[p] = 1;
    else if (d < -threshold && a < darkCeiling && a < 0.6 * lb[p]) raw[p] = 2;
  }
  // Keep a changed pixel only when at least four of its eight neighbours changed the same way.
  const kept = new Uint8Array(n);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = y * width + x, k = raw[p];
    if (!k) continue;
    let same = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < width && yy < height && raw[yy * width + xx] === k) same++;
    }
    if (same >= 4) kept[p] = k;
  }
  // Keep compact blobs: construction is compact, creek beds, playas and scrub are not.
  const mask = new Uint8Array(n), seen = new Uint8Array(n);
  let cleared = 0, darkened = 0, solidSum = 0, largest = 0;
  for (let start = 0; start < n; start++) {
    if (!kept[start] || seen[start]) continue;
    const k = kept[start], stack = [start], blob: number[] = [];
    seen[start] = 1;
    let minX = width, maxX = 0, minY = height, maxY = 0;
    while (stack.length) {
      const p = stack.pop()!, x = p % width, y = (p - x) / width;
      blob.push(p); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= n || seen[q] || kept[q] !== k || Math.abs((q % width) - x) > 1) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    const solidity = blob.length / ((maxX - minX + 1) * (maxY - minY + 1));
    if (blob.length < MIN_BLOB || solidity < MIN_SOLIDITY) continue;
    if (k === 1 && palenessOf(after, blob) < MIN_PALENESS) continue;
    if (k === 2 && plantGreen(after, blob)) continue;
    for (const p of blob) mask[p] = k;
    solidSum += solidity * blob.length;
    largest = Math.max(largest, blob.length);
    if (k === 1) cleared += blob.length; else darkened += blob.length;
  }
  const pxHa = (areaKm2 * 100) / n;
  const frac = (c: number) => (usable ? c / usable : 0);
  const sceneWide = frac(cleared + darkened) > 0.125;
  if (sceneWide) { mask.fill(0); cleared = 0; darkened = 0; largest = 0; }
  return {
    width, height, validFraction: usable / n, mask, sceneWide,
    largest: { pixels: largest, hectares: largest * pxHa },
    shape: cleared + darkened ? solidSum / (cleared + darkened) : 0,
    noise: frac(restless),
    cleared: { pixels: cleared, fraction: frac(cleared), hectares: cleared * pxHa },
    darkened: { pixels: darkened, fraction: frac(darkened), hectares: darkened * pxHa },
  };
}

/** The weakest channel of a set of pixels' average colour over the strongest: 1 for grey or white, lower for tan and red. */
function palenessOf(img: Uint8Array | Buffer, pixels: number[]): number {
  let r = 0, g = 0, b = 0;
  for (const p of pixels) { r += img[p * 4]; g += img[p * 4 + 1]; b += img[p * 4 + 2]; }
  const hi = Math.max(r, g, b);
  return hi ? Math.min(r, g, b) / hi : 0;
}

/** Whether a set of pixels' average colour is plant green: green well above red, with little blue (water that looks green is turquoise, blue close to green). */
function plantGreen(img: Uint8Array | Buffer, pixels: number[]): boolean {
  let r = 0, g = 0, b = 0;
  for (const p of pixels) { r += img[p * 4]; g += img[p * 4 + 1]; b += img[p * 4 + 2]; }
  return g > 1.2 * r && b < 0.8 * g;
}

/**
 * How sure to be that a change is real and man-made, 0.05 to 0.95: a bigger single change and more
 * compact changes in a calm scene score higher; a restless scene (a wet year against a dry one), a partly
 * clouded box and scenes from different seasons score lower.
 */
export function changeConfidence(r: ChangeResult, seasonGapDays: number): number {
  const size = Math.min(1, r.largest.hectares / 2);
  const compact = Math.max(0, Math.min(1, (r.shape - MIN_SOLIDITY) / 0.45));
  const calm = Math.max(0, 1 - r.noise / 0.08);
  const season = seasonGapDays <= 30 ? 1 : seasonGapDays <= 60 ? 0.85 : 0.65;
  return Math.max(0.05, Math.min(0.95, (0.25 + 0.3 * size + 0.4 * compact) * (0.4 + 0.6 * calm) * Math.min(1, r.validFraction / 0.9) * season));
}

/** Days between two dates' positions in the year (0 to 182): how far apart the seasons are. */
export function seasonGap(a: string, b: string): number {
  const doy = (s: string) => { const d = new Date(`${s}T00:00:00Z`); return (d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000; };
  const g = Math.abs(doy(a) - doy(b));
  return Math.min(g, 365 - g);
}

/* ---------------- PNG ---------------- */

/** Per-pixel scene classes from a scene-classification crop (class values in the first channel; 0 where there is no data). */
export function classesFrom(scl: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const m = new Uint8Array(width * height);
  for (let p = 0; p < m.length; p++) m[p] = scl[p * 4 + 3] !== 0 ? scl[p * 4] : 0;
  return m;
}

export function decodePng(buf: Buffer): { data: Buffer; width: number; height: number } {
  const png = PNG.sync.read(buf);
  return { data: png.data, width: png.width, height: png.height };
}

/** The change mask as a transparent overlay: amber for new bare ground, blue for new dark surfaces. */
export function overlayPng(r: ChangeResult): Buffer {
  const png = new PNG({ width: r.width, height: r.height });
  for (let p = 0; p < r.mask.length; p++) {
    const i = p * 4, k = r.mask[p];
    if (k === 1) { png.data[i] = 255; png.data[i + 1] = 176; png.data[i + 2] = 32; png.data[i + 3] = 210; }
    else if (k === 2) { png.data[i] = 56; png.data[i + 1] = 189; png.data[i + 2] = 248; png.data[i + 3] = 200; }
    else png.data[i + 3] = 0;
  }
  return PNG.sync.write(png);
}
