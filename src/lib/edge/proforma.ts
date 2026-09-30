/**
 * The deal pro-forma picture on the map: what two or more companies would own together in a region.
 * Each side's footprint (pipeline kilometres, plants, processing capacity), where they overlap (counties
 * both operate in, counties that touch, plants within 25 km of each other, pipelines running within a
 * kilometre of each other), and an antitrust screen: each county's processing concentration (HHI on
 * capacity) before and after, flagged against the 2023 Merger Guidelines thresholds, with the plants a
 * regulator would most likely ask to be sold. A county is a crude market and EIA capacity is from 2017,
 * so this is a screen for where to look, and every card says so.
 */
import { sql, type SQL } from "drizzle-orm";
import { requireDb } from "@/db";
import { MAPPED_COMPANIES, parentOf } from "./companies";
import { CENSUS_COUNTIES } from "./sources/census";
import { EIA_PIPELINES, EIA_PLANTS, type Bbox, type SourceInfo } from "./sources/eia";

export type PartyInput = { label: string; tickers: string[]; companies: string[] };
export type PlantRef = { id: number; name: string; company: string; ticker: string; capacityMMcfd: number; lon: number; lat: number; party: string };
export type ProformaParty = { key: string; label: string; ticker: string; color: string; pipelineKm: number; plants: number; capacityMMcfd: number };
export type CountyRow = {
  geoid: string; name: string; parties: string[]; adjacentTo: string[];
  pipelineKm: Record<string, number>; capacity: Record<string, number>; totalCapacity: number;
  hhiBefore: number | null; hhiAfter: number | null; delta: number | null; flag: "high" | "watch" | "";
};
export type Proforma = {
  place: { name: string; bbox: Bbox };
  parties: ProformaParty[];
  combined: { pipelineKm: number; plants: number; capacityMMcfd: number; capacityShare: number };
  overlap: { counties: number; adjacentCounties: number; parallelKm: number; nearbyPlants: { a: PlantRef; b: PlantRef; km: number }[] };
  counties: CountyRow[];
  divestitures: { plant: PlantRef; county: string; reason: string }[];
  method: string;
  sources: SourceInfo[];
};

/** Distinct, colour-blind-safe party colours (Okabe-Ito), used on the map and in the tables. */
export const PARTY_COLORS = ["#E69F00", "#56B4E9", "#CC79A7", "#009E73"];
export const PROFORMA_METHOD = "PostGIS overlay of EIA assets on Census counties; HHI on 2017 processing capacity per county, screened at 1,800 with a +100 change (2023 Merger Guidelines)";

const KEYS = ["a", "b", "c", "d"];

/** A company as a person types it (a ticker, a parent name or an operator name) as a party. */
export function partyFor(input: string): PartyInput | null {
  const raw = input.trim();
  if (!raw) return null;
  const byTicker = MAPPED_COMPANIES.find((c) => c.ticker.toLowerCase() === raw.toLowerCase());
  if (byTicker) return { label: byTicker.company, tickers: [byTicker.ticker], companies: [] };
  const byName = MAPPED_COMPANIES.find((c) => c.company.toLowerCase() === raw.toLowerCase());
  if (byName) return { label: byName.company, tickers: [byName.ticker], companies: [] };
  const parent = parentOf(raw);
  if (parent) return { label: parent.company, tickers: [parent.ticker], companies: [] };
  if (/^[A-Z.]{1,6}$/.test(raw)) return { label: raw, tickers: [raw], companies: [] };
  return raw.length >= 4 ? { label: raw, tickers: [], companies: [raw] } : null;
}

/** Rows of edge_assets (under `alias`, a constant) that belong to a party. */
function partyCond(p: PartyInput, alias: "" | "p" = ""): SQL {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  const parts: SQL[] = [];
  if (p.tickers.length) parts.push(sql`${col("ticker")} in (${sql.join(p.tickers.map((t) => sql`${t}`), sql`, `)})`);
  for (const c of p.companies) {
    const like = `%${c.replace(/[%_\\]/g, "")}%`;
    parts.push(sql`(${col("company")} ilike ${like} or ${col("operator")} ilike ${like})`);
  }
  return parts.length ? sql`(${sql.join(parts, sql` or `)})` : sql`false`;
}

/** Herfindahl-Hirschman index of capacity shares (0 to 10,000). Pure, for tests. */
export function hhi(capacityByOwner: Record<string, number>): number | null {
  const total = Object.values(capacityByOwner).reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  return Math.round(Object.values(capacityByOwner).reduce((s, c) => s + (100 * c / total) ** 2, 0));
}

/** The 2023 Merger Guidelines screen: above 1,800 after and up by more than 100 is presumed to lessen competition. Pure. */
export function screen(before: number | null, after: number | null): CountyRow["flag"] {
  if (before === null || after === null) return "";
  const delta = after - before;
  if (after > 1800 && delta > 100) return "high";
  if (after > 1000 && delta > 100) return "watch";
  return "";
}

/** County concentration before and after combining the parties. `plants` are every plant in the county, by owner. Pure. */
export function countyConcentration(plants: { owner: string; party: string | null; capacity: number }[]): { before: number | null; after: number | null } {
  const before: Record<string, number> = {}, after: Record<string, number> = {};
  for (const p of plants) {
    if (p.capacity <= 0) continue;
    before[p.owner] = (before[p.owner] ?? 0) + p.capacity;
    const merged = p.party ? "deal" : p.owner;
    after[merged] = (after[merged] ?? 0) + p.capacity;
  }
  return { before: hhi(before), after: hhi(after) };
}

export async function proforma(inputs: PartyInput[], place: { name: string; bbox: Bbox }): Promise<Proforma> {
  const parties = inputs.slice(0, 4);
  if (parties.length < 2) throw Object.assign(new Error("A pro-forma needs at least two companies."), { status: 400 });
  const db = requireDb();
  const [x0, y0, x1, y1] = place.bbox;
  const env = sql`ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 4326)`;
  const partyCase = (alias: "" | "p" = "") => sql`case ${sql.join(parties.map((p, i) => sql`when ${partyCond(p, alias)} then ${KEYS[i]}`), sql` `)} end`;
  const anyParty = sql`(${sql.join(parties.map((p) => partyCond(p)), sql` or `)})`;

  const [feet, plantRows, countyRows, parallel] = await Promise.all([
    db.execute(sql`
      select party, coalesce(sum(case when kind = 'pipeline' then ST_Length(ST_Intersection(geom, ${env})::geography) end), 0) / 1000 as km,
        count(*) filter (where kind = 'processing_plant') as plants,
        coalesce(sum(case when kind = 'processing_plant' then (attrs->>'capacityMMcfd')::float end), 0) as capacity
      from (select kind, geom, attrs, ${partyCase()} as party from edge_assets where owner_id is null and kind in ('pipeline', 'processing_plant') and geom && ${env} and ${anyParty}) t
      where party is not null group by party`),
    db.execute(sql`
      select p.id, p.name, p.company, p.ticker, coalesce((p.attrs->>'capacityMMcfd')::float, 0) as capacity, ST_X(p.geom) as lon, ST_Y(p.geom) as lat, ${partyCase("p")} as party, c.attrs->>'geoid' as geoid
      from edge_assets p left join edge_assets c on c.kind = 'county' and ST_Intersects(c.geom, p.geom)
      where p.owner_id is null and p.kind = 'processing_plant' and p.geom && ${env}`),
    db.execute(sql`
      with c as (select id, name, attrs->>'geoid' as geoid, geom from edge_assets where kind = 'county' and geom && ${env}),
      pipes as (select geom, ${partyCase()} as party from edge_assets where owner_id is null and kind = 'pipeline' and geom && ${env} and ${anyParty})
      select c.geoid, c.name,
        (select json_object_agg(party, km) from (select party, sum(ST_Length(ST_Intersection(pp.geom, c.geom)::geography)) / 1000 as km from pipes pp where ST_Intersects(pp.geom, c.geom) group by party) x) as pipe_km,
        (select array_agg(n.geoid) from c n where n.geoid <> c.geoid and ST_DWithin(n.geom, c.geom, 0.01)) as neighbours
      from c`),
    parties.length === 2
      ? db.execute(sql`
          with a as (select ST_Union(ST_Intersection(geom, ${env})) g from edge_assets where owner_id is null and kind = 'pipeline' and geom && ${env} and ${partyCond(parties[0])}),
               b as (select ST_Union(ST_Intersection(geom, ${env})) g from edge_assets where owner_id is null and kind = 'pipeline' and geom && ${env} and ${partyCond(parties[1])})
          select coalesce(ST_Length(ST_Intersection(a.g, ST_Buffer(b.g, 0.009))::geography), 0) / 1000 as km from a, b`)
      : Promise.resolve({ rows: [{ km: 0 }] }),
  ]);

  const foot = new Map((feet.rows as { party: string; km: number; plants: number; capacity: number }[]).map((r) => [r.party, r]));
  const out: ProformaParty[] = parties.map((p, i) => {
    const f = foot.get(KEYS[i]);
    return { key: KEYS[i], label: p.label, ticker: p.tickers[0] ?? "", color: PARTY_COLORS[i], pipelineKm: round(Number(f?.km ?? 0)), plants: Number(f?.plants ?? 0), capacityMMcfd: round(Number(f?.capacity ?? 0)) };
  });

  const plants = (plantRows.rows as { id: number; name: string; company: string; ticker: string; capacity: number; lon: number; lat: number; party: string | null; geoid: string | null }[])
    .map((r) => ({ id: r.id, name: r.name, company: r.company, ticker: r.ticker, capacityMMcfd: Number(r.capacity), lon: Number(r.lon), lat: Number(r.lat), party: r.party ?? "", geoid: r.geoid ?? "" }));
  const regionCapacity = plants.reduce((s, p) => s + p.capacityMMcfd, 0);

  const counties: CountyRow[] = (countyRows.rows as { geoid: string; name: string; pipe_km: Record<string, number> | null; neighbours: string[] | null }[]).map((c) => {
    const here = plants.filter((p) => p.geoid === c.geoid);
    const capacity: Record<string, number> = {};
    for (const p of here) if (p.party) capacity[p.party] = round((capacity[p.party] ?? 0) + p.capacityMMcfd);
    const pipelineKm = Object.fromEntries(Object.entries(c.pipe_km ?? {}).map(([k, v]) => [k, round(Number(v))]));
    const present = [...new Set([...Object.keys(capacity), ...Object.keys(pipelineKm).filter((k) => pipelineKm[k] >= 1)])].sort();
    const { before, after } = countyConcentration(here.map((p) => ({ owner: p.ticker || p.company, party: p.party || null, capacity: p.capacityMMcfd })));
    // Only a combination of two or more parties in the county changes its concentration.
    const combines = Object.keys(capacity).length >= 2;
    return {
      geoid: c.geoid, name: c.name, parties: present, adjacentTo: c.neighbours ?? [], pipelineKm, capacity,
      totalCapacity: round(here.reduce((s, p) => s + p.capacityMMcfd, 0)),
      hhiBefore: before, hhiAfter: combines ? after : before, delta: combines && before !== null && after !== null ? after - before : 0,
      flag: combines ? screen(before, after) : "",
    };
  });
  const byGeoid = new Map(counties.map((c) => [c.geoid, c]));
  const adjacent = counties.filter((c) => c.parties.length === 1 && c.adjacentTo.some((g) => { const n = byGeoid.get(g); return !!n && n.parties.some((p) => p !== c.parties[0]); })).length;

  const partyPlants = plants.filter((p) => p.party);
  const nearbyPlants: Proforma["overlap"]["nearbyPlants"] = [];
  for (const a of partyPlants) for (const b of partyPlants) {
    if (a.party >= b.party) continue;
    const km = haversineKm(a.lon, a.lat, b.lon, b.lat);
    if (km <= 25) nearbyPlants.push({ a: ref(a), b: ref(b), km: round(km) });
  }
  nearbyPlants.sort((p, q) => p.km - q.km);

  const divestitures: Proforma["divestitures"] = [];
  for (const c of counties.filter((x) => x.flag === "high")) {
    // The smaller side's plants in the county are what a remedy usually carves out.
    const sides = Object.entries(c.capacity).sort((p, q) => p[1] - q[1]);
    const smaller = sides[0]?.[0];
    for (const p of partyPlants.filter((x) => x.geoid === c.geoid && x.party === smaller)) {
      divestitures.push({ plant: ref(p), county: c.name, reason: `${c.name}: processing HHI ${fmt(c.hhiBefore)} to ${fmt(c.hhiAfter)} (+${fmt(c.delta)}), above the 1,800 and +100 screen` });
    }
  }

  const combinedCapacity = out.reduce((s, p) => s + p.capacityMMcfd, 0);
  return {
    place,
    parties: out,
    combined: { pipelineKm: round(out.reduce((s, p) => s + p.pipelineKm, 0)), plants: out.reduce((s, p) => s + p.plants, 0), capacityMMcfd: round(combinedCapacity), capacityShare: regionCapacity ? round(combinedCapacity / regionCapacity, 3) : 0 },
    overlap: { counties: counties.filter((c) => c.parties.length >= 2).length, adjacentCounties: adjacent, parallelKm: round(Number((parallel.rows[0] as { km: number } | undefined)?.km ?? 0)), nearbyPlants: nearbyPlants.slice(0, 20) },
    counties: counties.filter((c) => c.parties.length || c.totalCapacity).sort((p, q) => (q.delta ?? 0) - (p.delta ?? 0) || q.parties.length - p.parties.length),
    divestitures,
    method: PROFORMA_METHOD,
    sources: [EIA_PIPELINES, EIA_PLANTS, CENSUS_COUNTIES],
  };
}

const ref = (p: PlantRef & { geoid?: string }): PlantRef => ({ id: p.id, name: p.name, company: p.company, ticker: p.ticker, capacityMMcfd: p.capacityMMcfd, lon: p.lon, lat: p.lat, party: p.party });
const round = (v: number, dp = 1) => Math.round(v * 10 ** dp) / 10 ** dp;
const fmt = (v: number | null) => (v === null ? "n/a" : v.toLocaleString("en-US"));

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}
