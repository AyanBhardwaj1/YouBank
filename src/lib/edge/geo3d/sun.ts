/**
 * The sun over a place at a time, and what the 3D map does with it: where the light on buildings and
 * models comes from, which way the hills cast shade, and the colour of the sky (day, the warm hour
 * either side of sunset, night). The position is the standard low-precision solar formula (as in
 * SunCalc and NOAA's tables): good to a fraction of a degree, which is all shading needs. Pure, so the
 * same numbers drive MapLibre's light, its hillshade, deck.gl's sun and the tests.
 */

const RAD = Math.PI / 180;
const DAY_MS = 86_400_000;
const J1970 = 2_440_588, J2000 = 2_451_545;
const OBLIQUITY = RAD * 23.4397;

export type Sun = {
  /** Compass bearing of the sun, degrees clockwise from north (90 east, 180 south, 270 west). */
  azimuth: number;
  /** Height above the horizon in degrees; negative once it has set. */
  altitude: number;
};

/** Where the sun stands over a point at a moment. Pure. */
export function sunPosition(at: Date | number, lat: number, lon: number): Sun {
  const d = (typeof at === "number" ? at : at.getTime()) / DAY_MS - 0.5 + J1970 - J2000;
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBLIQUITY) * Math.sin(L));
  const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
  const phi = RAD * lat;
  const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
  const altitude = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // Measured from south towards west, then turned into a compass bearing.
  const fromSouth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { azimuth: (((fromSouth / RAD + 180) % 360) + 360) % 360, altitude: altitude / RAD };
}

/** A moment on the same UTC day as `base` at a local solar hour (0 to 24) for a longitude: noon is when the sun is due south, near enough. Pure. */
export function atSolarHour(base: Date | number, lon: number, hour: number): number {
  const t = typeof base === "number" ? base : base.getTime();
  const midnightUtc = Math.floor(t / DAY_MS) * DAY_MS;
  return midnightUtc + (hour - lon / 15) * 3_600_000;
}

/** The local solar hour (0 to 24) of a moment at a longitude. Pure. */
export function solarHour(at: Date | number, lon: number): number {
  const t = typeof at === "number" ? at : at.getTime();
  const h = ((t % DAY_MS) / 3_600_000 + lon / 15) % 24;
  return h < 0 ? h + 24 : h;
}

type Rgb = [number, number, number];
const hex = (c: string): Rgb => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const toHex = (c: Rgb) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b), k = Math.max(0, Math.min(1, t)); return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]); };
/** 0 at or below `lo`, 1 at or above `hi`, smooth between. */
const ramp = (v: number, lo: number, hi: number) => { const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo))); return t * t * (3 - 2 * t); };

/** Sky palettes for each part of the day, in the theme's light and dark. */
const SKY = {
  light: { day: ["#8fc3ee", "#e9f1f8", "#eef2f6"], golden: ["#7d9fcf", "#f3c088", "#f1d7b8"], night: ["#0b1426", "#1e2a40", "#141c2c"] },
  dark: { day: ["#14304f", "#2e4a66", "#0f1c2c"], golden: ["#1f2747", "#7a4a35", "#2a2230"], night: ["#04070f", "#0d1522", "#060a12"] },
} as const;

export type SkyColors = { sky: string; horizon: string; fog: string };

/** The sky's colours for a sun height, in the light or dark theme: day above 10°, warm from 10° down to the horizon, night below 6° under it. Pure. */
export function skyFor(altitude: number, dark: boolean): SkyColors {
  const p = dark ? SKY.dark : SKY.light;
  const day = ramp(altitude, 2, 12), dusk = ramp(altitude, -8, 0);
  const pick = (i: 0 | 1 | 2) => mix(mix(p.night[i], p.golden[i], dusk), p.day[i], day);
  return { sky: pick(0), horizon: pick(1), fog: pick(2) };
}

export type MapLight = {
  /** MapLibre's light position: [radial, azimuth (north = 0, clockwise, anchored to the map), polar (0 overhead, 90 on the horizon)]. */
  position: [number, number, number];
  color: string;
  intensity: number;
};

/** MapLibre's light on extruded buildings for a sun: from the sun's bearing, warmer and weaker as it sinks; a dim moonlight at night. Pure. */
export function lightFor(sun: Sun): MapLight {
  const up = Math.max(0, sun.altitude);
  const polar = Math.max(8, Math.min(85, 90 - up));
  const night = sun.altitude < -4;
  const warm = 1 - ramp(sun.altitude, 0, 25);
  return {
    position: [1.5, night ? 200 : sun.azimuth, night ? 40 : polar],
    color: night ? "#9fb3d9" : mix("#ffffff", "#ffb36b", warm * 0.8),
    intensity: night ? 0.18 : 0.25 + 0.35 * ramp(sun.altitude, -2, 40),
  };
}

/** Hillshade lit from the sun: its bearing, its height (at least 5°, so low sun still reads as shade not black), and how strong. Pure. */
export function hillshadeFor(sun: Sun): { direction: number; altitude: number; exaggeration: number } {
  if (sun.altitude < -4) return { direction: 315, altitude: 35, exaggeration: 0.35 };
  return { direction: Math.round(sun.azimuth), altitude: Math.max(5, Math.min(80, Math.round(sun.altitude))), exaggeration: 0.45 + 0.25 * (1 - ramp(sun.altitude, 5, 50)) };
}
