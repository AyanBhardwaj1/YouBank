"use client";

/**
 * The 3D map's buttons, stacked under MapLibre's zoom and compass: 3D (with the relief beneath it),
 * the globe, the sun (a time-of-day slider in local solar time), and an orbit around the centre. Icon
 * buttons with labels for screen readers, 36 px tall so they work under a thumb; the sun's panel opens
 * to the left and fits a phone.
 */
import { Icon } from "@/components/ui/Icon";
import type { Sun } from "@/lib/edge/geo3d/sun";

const COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
const compass = (deg: number) => COMPASS[Math.round(deg / 45) % 8];
const clock = (h: number) => `${String(Math.floor(h) % 24).padStart(2, "0")}:${String(Math.round((h % 1) * 60) % 60).padStart(2, "0")}`;

export function sunWords(sun: Sun): string {
  if (sun.altitude < -6) return "Night";
  if (sun.altitude < 0) return `Twilight, the sun just below the ${compass(sun.azimuth)}ern horizon`;
  return `Sun ${Math.round(sun.altitude)}° high in the ${compass(sun.azimuth)}`;
}

type Props = {
  threeD: boolean; onThreeD: () => void;
  relief: number; reliefOptions: number[]; onRelief: (r: number) => void;
  globe: boolean; onGlobe: () => void;
  sunOpen: boolean; onSunOpen: () => void; sun: Sun; hour: number; live: boolean; onHour: (h: number | null) => void;
  orbiting: boolean; canOrbit: boolean; onOrbit: () => void;
  lite: boolean;
};

const btn = (on: boolean) => `glass flex h-9 min-w-9 items-center justify-center gap-1 rounded-full border px-2 text-[11px] font-semibold shadow ${on ? "border-accent/60 bg-bg/90 text-accent" : "border-line bg-bg/85 text-muted hover:text-fg"}`;

export function Controls(p: Props) {
  return (
    <div className="absolute right-2.5 top-[108px] z-10 flex flex-col items-end gap-1.5">
      <button type="button" onClick={p.onThreeD} aria-pressed={p.threeD} className={btn(p.threeD)}
        title={p.threeD ? "Back to the flat map" : p.lite ? "Tilt the map: buildings, plants and site models in 3D (2.5D on this screen; add the terrain under Relief)" : "Tilt over the terrain with buildings, plants and site models in 3D (drag with the right button or two fingers to turn)"}>
        <Icon name="Box" className="h-3.5 w-3.5" /> 3D
      </button>
      {p.threeD && (
        <div className="glass flex items-center gap-0.5 rounded-full border border-line bg-bg/85 p-0.5 text-[10.5px] shadow" role="radiogroup" aria-label="Relief">
          {p.reliefOptions.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={p.relief === r} onClick={() => p.onRelief(r)} title={r === 0 ? "No terrain (lighter on this device)" : r === 1 ? "True relief" : `Relief exaggerated ${r} times`}
              className={`rounded-full px-1.5 py-1 ${p.relief === r ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{r === 0 ? "Flat" : `×${r}`}</button>
          ))}
        </div>
      )}
      <button type="button" onClick={p.onGlobe} aria-pressed={p.globe} aria-label={p.globe ? "Flat map" : "Globe"} title={p.globe ? "Back to the flat map" : "The whole Earth as a globe, with its atmosphere"} className={btn(p.globe)}>
        <Icon name="Globe" className="h-4 w-4" />
      </button>
      {p.threeD && (
        <div className="relative">
          <button type="button" onClick={p.onSunOpen} aria-expanded={p.sunOpen} aria-label="Sun and time of day" title="Light the map by the sun at a time of day" className={btn(p.sunOpen || !p.live)}>
            <Icon name="Sun" className="h-4 w-4" />
          </button>
          {p.sunOpen && (
            <div className="glass absolute right-11 top-0 w-[min(270px,calc(100vw-84px))] rounded-lg border border-line bg-bg/95 p-2.5 text-[11.5px] shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{clock(p.hour)} <span className="font-normal text-muted">local solar time</span></span>
                <button type="button" onClick={() => p.onHour(null)} disabled={p.live} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted hover:text-fg disabled:opacity-50">Now</button>
              </div>
              <input type="range" min={0} max={24} step={0.25} value={p.hour} onChange={(e) => p.onHour(Number(e.target.value))} aria-label="Hour of the day" className="mt-2 w-full accent-[var(--accent)]" />
              <p className="mt-1 text-[10.5px] leading-snug text-muted">{sunWords(p.sun)}. Buildings, hills and models are lit from there; the sky follows.</p>
            </div>
          )}
        </div>
      )}
      {p.threeD && (
        <button type="button" onClick={p.onOrbit} disabled={!p.canOrbit} aria-pressed={p.orbiting} aria-label={p.orbiting ? "Stop turning" : "Orbit"}
          title={p.canOrbit ? (p.orbiting ? "Stop turning (or touch the map)" : "Turn slowly around the centre") : "Orbiting is off because this device asks for less motion"} className={`${btn(p.orbiting)} disabled:opacity-40`}>
          <Icon name="Orbit" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
