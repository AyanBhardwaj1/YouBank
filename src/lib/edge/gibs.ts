/**
 * NASA's Global Imagery Browse Services (GIBS): the whole Earth as map tiles, free and without a key, most
 * layers new each day within hours of the satellites' passes. Edge's globe offers a few: true colour from
 * VIIRS and MODIS, the Earth at night, fires and thermal anomalies, and nitrogen dioxide. Tiles come from
 * the Web Mercator ("epsg3857") endpoint, which MapLibre draws on the globe too. Pure, for the client and
 * the tests (scripts/test-edge-globe.ts).
 *
 * Layer names and zoom levels follow GIBS's published capabilities; they were not fetched from this
 * sandbox, so a layer that stops answering simply shows no tiles (the map says so).
 */

export type GibsLayer = {
  id: string; label: string; layer: string; format: "jpg" | "png"; maxzoom: number;
  /** "daily" layers take a date; "static" ones have one fixed date. */
  cadence: "daily" | "static"; fixedDate?: string;
  /** Days behind today the newest full day usually is. */
  lagDays: number;
  /** Shown over a basemap (transparent where there is nothing) rather than as the ground itself. */
  overlay: boolean;
  credit: string; blurb: string;
};

const NASA = "Imagery: NASA EOSDIS GIBS";

export const GIBS_LAYERS: GibsLayer[] = [
  { id: "viirs-truecolor", label: "True colour (VIIRS, daily)", layer: "VIIRS_SNPP_CorrectedReflectance_TrueColor", format: "jpg", maxzoom: 9, cadence: "daily", lagDays: 1, overlay: false, credit: `${NASA}, VIIRS on Suomi NPP`, blurb: "The whole Earth as the satellite saw it that day, 250 to 500 m across: smoke, floods, snow, cloud." },
  { id: "viirs20-truecolor", label: "True colour (NOAA-20, daily)", layer: "VIIRS_NOAA20_CorrectedReflectance_TrueColor", format: "jpg", maxzoom: 9, cadence: "daily", lagDays: 1, overlay: false, credit: `${NASA}, VIIRS on NOAA-20`, blurb: "The same view from NOAA-20, about 50 minutes later in the day: a second chance past clouds." },
  { id: "modis-truecolor", label: "True colour (MODIS Terra, daily)", layer: "MODIS_Terra_CorrectedReflectance_TrueColor", format: "jpg", maxzoom: 9, cadence: "daily", lagDays: 1, overlay: false, credit: `${NASA}, MODIS on Terra`, blurb: "The morning view from MODIS on Terra, the longest daily record." },
  { id: "night", label: "Earth at night (VIIRS, daily)", layer: "VIIRS_SNPP_DayNightBand_ENCC", format: "png", maxzoom: 8, cadence: "daily", lagDays: 1, overlay: false, credit: `${NASA}, VIIRS day/night band`, blurb: "Lights at night that day: cities, gas flares, fishing fleets and blackouts. Moonlight and cloud change it from night to night." },
  { id: "black-marble", label: "Night lights (Black Marble, cloud-free)", layer: "VIIRS_Black_Marble", format: "png", maxzoom: 8, cadence: "static", fixedDate: "2016-01-01", lagDays: 0, overlay: false, credit: `${NASA}, Black Marble`, blurb: "A cloud-free composite of lights at night: where people and industry are, to compare a night's view against." },
  { id: "fires", label: "Fires and flares (VIIRS, daily)", layer: "VIIRS_NOAA20_Thermal_Anomalies_375m_All", format: "png", maxzoom: 8, cadence: "daily", lagDays: 0, overlay: true, credit: `${NASA}, FIRMS VIIRS thermal anomalies`, blurb: "Every hot spot VIIRS saw that day: wildfires, gas flares, steel works. The same detections Edge's flaring cards count." },
  { id: "no2", label: "Nitrogen dioxide (OMI, daily)", layer: "OMI_Nitrogen_Dioxide_Tropo_Column", format: "png", maxzoom: 6, cadence: "daily", lagDays: 2, overlay: true, credit: `${NASA}, OMI on Aura`, blurb: "Nitrogen dioxide near the ground, mostly from burning fuel: power plants, refineries, traffic, shipping lanes. Coarse (13 by 24 km) and gappy under cloud." },
];

export const gibsLayer = (id: string) => GIBS_LAYERS.find((l) => l.id === id) ?? null;

/** The newest date worth asking a daily layer for, as YYYY-MM-DD (UTC). Pure. */
export function latestDate(layer: Pick<GibsLayer, "cadence" | "fixedDate" | "lagDays">, now: number): string {
  if (layer.cadence === "static") return layer.fixedDate ?? "2016-01-01";
  return new Date(now - layer.lagDays * 86_400_000).toISOString().slice(0, 10);
}

/** A date kept within the layer's range (no later than its newest, no earlier than 2012). Pure. */
export function clampDate(layer: Pick<GibsLayer, "cadence" | "fixedDate" | "lagDays">, date: string, now: number): string {
  if (layer.cadence === "static") return latestDate(layer, now);
  const max = latestDate(layer, now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return max;
  return date > max ? max : date < "2012-01-20" ? "2012-01-20" : date;
}

/** A date moved by whole days. Pure. */
export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The XYZ tile template for a layer on a date (MapLibre fills z, y and x). Pure. */
export function gibsTiles(layer: Pick<GibsLayer, "layer" | "format" | "maxzoom">, date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${layer.layer}/default/${date}/GoogleMapsCompatible_Level${layer.maxzoom}/{z}/{y}/{x}.${layer.format}`;
}
