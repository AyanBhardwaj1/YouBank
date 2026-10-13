/**
 * deck.gl for the 3D map, loaded the first time a 3D layer has something to draw (it is large) and
 * drawn inside MapLibre's own WebGL2 context ("interleaved"), so the page keeps a single graphics
 * context, models hide behind hills, and the globe works. Browsers whose map fell back to WebGL1 get no
 * deck.gl layers (MapLibre's own 3D still works) and are told so.
 */
import type { Layer } from "@deck.gl/core";
import type { Map as MLMap } from "maplibre-gl";
import type { Sun } from "@/lib/edge/geo3d/sun";
import type { DeckModules } from "./layers";

export type Loaded = { mods: DeckModules; MapboxOverlay: typeof import("@deck.gl/mapbox").MapboxOverlay };
let loading: Promise<Loaded> | null = null;

/** The deck.gl modules, imported once per page. */
export function loadDeck(): Promise<Loaded> {
  loading ??= Promise.all([import("@deck.gl/core"), import("@deck.gl/layers"), import("@deck.gl/mesh-layers"), import("@deck.gl/mapbox")])
    .then(([core, layers, mesh, mapbox]) => ({ mods: { core, layers, mesh }, MapboxOverlay: mapbox.MapboxOverlay }))
    .catch((e) => { loading = null; throw e; });
  return loading;
}

/** Whether MapLibre drew this map with WebGL2 (asking a canvas for the kind of context it already has returns that one; another kind returns null). */
export function hasWebGL2(m: MLMap): boolean {
  try {
    return !!m.getCanvas().getContext("webgl2");
  } catch {
    return false;
  }
}

/** The light on deck.gl's models: soft ambient light and the sun at the map's time, dimmer at night. */
export function lighting(mods: DeckModules, at: number, sun: Sun) {
  const { core } = mods;
  const day = sun.altitude > 0;
  return new core.LightingEffect({
    ambient: new core.AmbientLight({ color: [255, 255, 255], intensity: day ? 0.75 : 0.45 }),
    sun: new core._SunLight({ timestamp: at, color: day && sun.altitude < 12 ? [255, 214, 170] : [255, 255, 255], intensity: day ? 1.6 : 0.35 }),
  });
}

export type Overlay = { setProps(p: Record<string, unknown>): void; finalize(): void };

/** Create the interleaved overlay on a map. */
export function createOverlay(m: MLMap, loaded: Loaded, props: { layers: Layer[]; effects: unknown[]; onClick: (info: { object?: unknown; layer?: { id: string } | null; coordinate?: number[] }) => void }): Overlay {
  const make = (effects: unknown[]) => new loaded.MapboxOverlay({ interleaved: true, layers: props.layers, effects: effects as never, onClick: props.onClick as never, pickingRadius: 6 });
  let overlay: ReturnType<typeof make>;
  // Without its sun if the lighting cannot be set up: models lit by deck.gl's default light beat none.
  try { overlay = make(props.effects); } catch { overlay = make([]); }
  m.addControl(overlay as never);
  return {
    setProps: (p) => overlay.setProps(p as never),
    finalize: () => { try { m.removeControl(overlay as never); } catch { /* the map is already gone */ } },
  };
}
