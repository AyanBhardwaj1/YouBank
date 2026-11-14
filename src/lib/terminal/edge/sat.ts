/**
 * SAT <TICKER>: a company's geospatial signal monitor. Every satellite, flaring, radar, permit and methane
 * signal Edge holds for its sites over the last year, one row per signal with its z-score against the
 * site's own history, the history itself, when it was observed and a picture; the sites Edge watches for
 * it (its mapped plants and the curated satellite sites that name it) for the mini map, signals or not;
 * and how fresh each source is. Server only.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { SAT_SITES } from "@/lib/edge/sat/sites";
import { flareFreshness } from "@/lib/edge/passes";
import { SITE_KINDS, siteSignal, type SiteSignal } from "../edge-signals";
import { attempt, newest, nodeFor, stateOf, trailSources, type SourceState } from "./common";

export type SatSite = { name: string; kind: string; lon: number; lat: number; capacity: number | null; signals: number };
export type SatView = {
  ticker: string; name: string;
  signals: (SiteSignal & { confidence: number; magnitude: number })[];
  sites: SatSite[];
  bbox: [number, number, number, number] | null;
  sources: SourceState[];
  trail: { name: string; url: string; license: string; retrievedAt: string }[];
  flares: { checkedAt: string | null; newestSpot: string | null; ok: boolean } | null;
  /** Companies with geospatial signals in the last 90 days, for an empty screen to point at. */
  suggest: { ticker: string; n: number }[];
  asOf: string;
};

const KIND_SOURCE: Record<string, string> = {
  flaring: "NASA FIRMS (VIIRS)", crop_vigour: "Copernicus Sentinel-2", water_extent: "Copernicus Sentinel-2", vessel_traffic: "Copernicus Sentinel-1",
  radar_change: "Copernicus Sentinel-1", ground_change: "Copernicus Sentinel-2", permits: "Texas RRC and New Mexico OCD", methane_plume: "Carbon Mapper",
};

/** The box around a set of points, padded, or null. Pure. */
export function boxOf(points: { lon: number; lat: number }[], padDeg = 0.15): [number, number, number, number] | null {
  if (!points.length) return null;
  const lons = points.map((p) => p.lon), lats = points.map((p) => p.lat);
  return [Math.min(...lons) - padDeg, Math.min(...lats) - padDeg, Math.max(...lons) + padDeg, Math.max(...lats) + padDeg];
}

async function cardsFor(userId: string, ticker: string) {
  const rows = await requireDb().select({
    id: schema.edgeDetections.id, kind: schema.edgeDetections.kind, title: schema.edgeDetections.title, magnitude: schema.edgeDetections.magnitude, confidence: schema.edgeDetections.confidence,
    observedAt: schema.edgeDetections.observedAt, detectedAt: schema.edgeDetections.detectedAt,
    // The visual without its inline overlays (radar and ground change keep a base64 PNG there).
    visual: sql<Record<string, unknown>>`${schema.edgeDetections.visual} - 'overlay' - 'hits' - 'objects' - 'permits' - 'plumes'`,
  }).from(schema.edgeDetections)
    .where(sql`${schema.edgeDetections.tickers} ? ${ticker} and ${schema.edgeDetections.kind} in (${sql.join(SITE_KINDS.map((k) => sql`${k}`), sql`, `)}) and (${schema.edgeDetections.ownerId} is null or ${schema.edgeDetections.ownerId} = ${userId}) and ${schema.edgeDetections.detectedAt} > now() - interval '400 days'`)
    .orderBy(sql`coalesce(${schema.edgeDetections.observedAt}, ${schema.edgeDetections.detectedAt}) desc`).limit(150);
  return rows;
}

async function plantsFor(ticker: string) {
  const rows = (await requireDb().execute(sql`
    select name, kind, ST_X(ST_Centroid(geom)) as lon, ST_Y(ST_Centroid(geom)) as lat, (attrs->>'capacityMMcfd')::float as cap
    from edge_assets where ticker = ${ticker} and owner_id is null and kind = 'processing_plant' order by (attrs->>'capacityMMcfd')::float desc nulls last limit 40`)).rows as { name: string; kind: string; lon: number; lat: number; cap: number | null }[];
  return rows.map((r) => ({ name: r.name, kind: r.kind, lon: Number(r.lon), lat: Number(r.lat), capacity: r.cap === null ? null : Number(r.cap) }));
}

async function busiest(): Promise<{ ticker: string; n: number }[]> {
  const rows = (await requireDb().execute(sql`
    select t as ticker, count(*)::int as n from edge_detections, jsonb_array_elements_text(tickers) t
    where owner_id is null and detected_at > now() - interval '90 days' and kind in (${sql.join(SITE_KINDS.map((k) => sql`${k}`), sql`, `)})
    group by t order by n desc limit 8`)).rows as { ticker: string; n: number }[];
  return rows.map((r) => ({ ticker: r.ticker, n: Number(r.n) }));
}

export async function satView(userId: string, ticker: string): Promise<SatView> {
  const [cards, plants, node, flares] = await Promise.all([
    attempt("sat-cards", [] as Awaited<ReturnType<typeof cardsFor>>, () => cardsFor(userId, ticker)),
    attempt("sat-plants", [] as Awaited<ReturnType<typeof plantsFor>>, () => plantsFor(ticker)),
    attempt("sat-node", null as Awaited<ReturnType<typeof nodeFor>>, () => nodeFor(ticker)),
    attempt("sat-flares", null as Awaited<ReturnType<typeof flareFreshness>> | null, () => flareFreshness()),
  ]);
  const signals = cards.value.flatMap((c) => {
    const s = siteSignal({ ...c, observedAt: c.observedAt?.toISOString() ?? null, detectedAt: c.detectedAt.toISOString() });
    return s ? [{ ...s, confidence: c.confidence, magnitude: c.magnitude }] : [];
  });
  const [trail, suggest] = await Promise.all([
    attempt("sat-trail", [] as Awaited<ReturnType<typeof trailSources>>, () => trailSources(signals.map((s) => s.id))),
    attempt("sat-suggest", [] as { ticker: string; n: number }[], () => (signals.length ? Promise.resolve([]) : busiest())),
  ]);
  // The sites: its mapped plants and the curated satellite sites naming it, each with how many signals it has.
  const count = (name: string) => signals.filter((s) => s.site === name).length;
  const curated = SAT_SITES.filter((s) => s.tickers.includes(ticker)).map((s) => ({ name: s.name, kind: s.analysis, lon: s.lon, lat: s.lat, capacity: null, signals: count(s.name) }));
  const mapped = plants.value.map((p) => ({ ...p, signals: count(p.name) }));
  const elsewhere = [...new Map(signals.filter((s) => !mapped.some((p) => p.name === s.site) && !curated.some((c) => c.name === s.site)).map((s) => [s.site, { name: s.site, kind: s.kind, lon: s.lon, lat: s.lat, capacity: null, signals: count(s.site) }])).values()];
  const sites = [...mapped, ...curated, ...elsewhere];

  const now = Date.now();
  const byKind = (kinds: string[]) => signals.filter((s) => kinds.includes(s.kind));
  const sources: SourceState[] = [
    stateOf("cards", "Edge findings", cards.ok, signals.length, newest(signals.map((s) => s.at))),
    ...[["flaring"], ["crop_vigour", "water_extent", "ground_change"], ["vessel_traffic", "radar_change"], ["permits"], ["methane_plume"]].map((kinds) => {
      const list = byKind(kinds);
      const name = KIND_SOURCE[kinds[0]];
      if (kinds[0] === "flaring" && flares.value) return stateOf("firms", name, flares.ok && flares.value.ok, flares.value.checkedAt ? 1 : 0, flares.value.checkedAt, { note: flares.value.ok ? `hourly passes; newest detection ${flares.value.newestSpot ?? "none"}` : "the last pass did not complete: showing the last good record", staleAfterMs: 3 * 3_600_000, now });
      return stateOf(kinds.join("+"), name, cards.ok, list.length, newest(list.map((s) => s.at)));
    }),
    stateOf("eia", "EIA plant locations", plants.ok, plants.value.length, null, { note: "Permian processing plants (2017 vintage)" }),
  ];
  return {
    ticker, name: node.value?.name ?? ticker, signals, sites, bbox: boxOf(sites.length ? sites : signals), sources, trail: trail.value,
    flares: flares.value, suggest: suggest.value.filter((x) => x.ticker !== ticker), asOf: new Date(now).toISOString(),
  };
}
