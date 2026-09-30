/**
 * Where a company sits on the map: its headquarters address from EDGAR, located with the U.S. Census
 * geocoder (free, no key), or the middle of its state when the address will not resolve.
 */
import { logError } from "@/lib/errors";

const STATE_CENTER: Record<string, [number, number]> = {
  AL: [-86.8, 32.8], AK: [-152.3, 64.2], AZ: [-111.7, 34.3], AR: [-92.4, 34.9], CA: [-119.4, 37.2], CO: [-105.5, 39.0], CT: [-72.7, 41.6], DE: [-75.5, 39.0], DC: [-77.0, 38.9],
  FL: [-81.7, 28.6], GA: [-83.4, 32.7], HI: [-157.5, 20.8], ID: [-114.6, 44.4], IL: [-89.2, 40.0], IN: [-86.3, 39.9], IA: [-93.5, 42.1], KS: [-98.4, 38.5], KY: [-85.3, 37.5],
  LA: [-91.9, 31.1], ME: [-69.2, 45.4], MD: [-76.8, 39.0], MA: [-71.8, 42.3], MI: [-85.4, 44.3], MN: [-94.3, 46.3], MS: [-89.7, 32.7], MO: [-92.5, 38.4], MT: [-109.6, 47.0],
  NE: [-99.8, 41.5], NV: [-116.6, 39.3], NH: [-71.6, 43.7], NJ: [-74.7, 40.2], NM: [-106.1, 34.4], NY: [-75.5, 42.9], NC: [-79.4, 35.6], ND: [-100.5, 47.5], OH: [-82.8, 40.3],
  OK: [-97.5, 35.6], OR: [-120.6, 43.9], PA: [-77.8, 40.9], RI: [-71.5, 41.7], SC: [-80.9, 33.9], SD: [-100.2, 44.4], TN: [-86.3, 35.9], TX: [-99.3, 31.5], UT: [-111.7, 39.3],
  VT: [-72.7, 44.1], VA: [-78.8, 37.5], WA: [-120.4, 47.4], WV: [-80.6, 38.6], WI: [-89.9, 44.6], WY: [-107.6, 43.0],
};

export type Address = { street1?: string; city?: string; stateOrCountry?: string; zipCode?: string };

/** A state's middle, for when an address will not resolve. Pure. */
export function stateCenter(state: string | undefined): [number, number] | null {
  return state ? STATE_CENTER[state.toUpperCase()] ?? null : null;
}

/** Longitude and latitude of an address, and how it was found. */
export async function geocode(a: Address): Promise<{ lon: number; lat: number; how: "address" | "state" } | null> {
  const state = a.stateOrCountry ?? "";
  if (a.street1 && a.city && /^[A-Z]{2}$/.test(state)) {
    try {
      const p = new URLSearchParams({ street: a.street1, city: a.city, state, zip: (a.zipCode ?? "").slice(0, 5), benchmark: "Public_AR_Current", format: "json" });
      const res = await fetch(`https://geocoding.geo.census.gov/geocoder/locations/address?${p}`, { signal: AbortSignal.timeout(12_000) });
      if (res.ok) {
        const j = (await res.json()) as { result?: { addressMatches?: { coordinates: { x: number; y: number } }[] } };
        const c = j.result?.addressMatches?.[0]?.coordinates;
        if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return { lon: Math.round(c.x * 1e4) / 1e4, lat: Math.round(c.y * 1e4) / 1e4, how: "address" };
      }
    } catch (e) { logError(e, { where: "edge-geocode" }); }
  }
  const s = stateCenter(state);
  return s ? { lon: s[0], lat: s[1], how: "state" } : null;
}
