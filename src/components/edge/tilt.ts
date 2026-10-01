import type { Map as MLMap } from "maplibre-gl";

/**
 * Tilt and turn a map's camera as a short tween of instant moves, one per frame, easing in and out.
 * Shared by Edge's maps (the Earth map and the Networks map) when they switch to and from 3D.
 */
export function tilt(m: MLMap, pitch: number, bearing: number, ms = 700) {
  const p0 = m.getPitch(), b0 = m.getBearing(), t0 = performance.now();
  const step = (now: number) => {
    const t = ms > 0 ? Math.min(1, (now - t0) / ms) : 1, e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    m.jumpTo({ pitch: p0 + (pitch - p0) * e, bearing: b0 + (bearing - b0) * e });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
