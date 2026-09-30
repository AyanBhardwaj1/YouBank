/**
 * Which companies the graph covers: every listed company in the energy industries (oil and gas
 * producers, services, refiners, pipelines, gas utilities, marketers), found by SEC industry code,
 * plus any company someone on Edge watches. The model trains on this universe; watched companies from
 * other industries are mapped for their own findings.
 */
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { edgarFetch } from "@/lib/edgar/client";
import { tickerMap } from "@/lib/edgar/tickers";
import { BETA_ON } from "../watches";

export const ENERGY_SICS: Record<string, string> = {
  "1311": "Crude petroleum and natural gas", "1381": "Drilling oil and gas wells", "1382": "Oil and gas field exploration services", "1389": "Oil and gas field services",
  "2911": "Petroleum refining", "4610": "Pipelines (except natural gas)", "4922": "Natural gas transmission", "4923": "Natural gas transmission and distribution",
  "4924": "Natural gas distribution", "5171": "Petroleum bulk stations and terminals", "5172": "Petroleum products wholesale", "6792": "Oil royalty traders",
};

export type Member = { cik: string; ticker: string; sic: string };

/** CIKs EDGAR lists under an industry code (companies that have filed 10-Ks), from its Atom feed. */
async function ciksForSic(sic: string): Promise<string[]> {
  const out: string[] = [];
  for (let start = 0; start < 2000; start += 100) {
    const res = await edgarFetch(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&SIC=${sic}&type=10-K&owner=include&count=100&start=${start}&output=atom`);
    if (!res.ok) break;
    const ciks = [...(await res.text()).matchAll(/<cik>(\d+)<\/cik>/g)].map((m) => m[1].replace(/^0+/, ""));
    out.push(...ciks);
    if (ciks.length < 100) break;
  }
  return out;
}

/** The listed energy companies (cached for a month; EDGAR's industry lists change slowly). */
export async function energyUniverse(): Promise<Member[]> {
  const hit = await cacheGet("edge:graph:universe:v1");
  if (hit) return JSON.parse(hit) as Member[];
  const byCik = new Map<string, string>();
  for (const row of (await tickerMap()).values()) { const c = row.cik.replace(/^0+/, ""); if (!byCik.has(c)) byCik.set(c, row.ticker); }
  const out = new Map<string, Member>();
  for (const sic of Object.keys(ENERGY_SICS)) {
    for (const cik of await ciksForSic(sic)) { const t = byCik.get(cik); if (t && !out.has(cik)) out.set(cik, { cik, ticker: t, sic }); }
  }
  const list = [...out.values()];
  if (list.length) await cacheSet("edge:graph:universe:v1", JSON.stringify(list), 30 * 86_400_000);
  return list;
}

/** Companies people with the beta on watch, as CIKs (any industry). */
export async function watchedCompanies(): Promise<Member[]> {
  const rows = await requireDb().selectDistinct({ ticker: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId)).where(and(BETA_ON, eq(schema.edgeWatches.kind, "company")));
  const map = await tickerMap();
  return rows.map((r) => map.get(String(r.ticker ?? "").toUpperCase())).filter((t): t is NonNullable<typeof t> => !!t).map((t) => ({ cik: t.cik.replace(/^0+/, ""), ticker: t.ticker, sic: "" }));
}

/** Everything the weekly refresh covers: watched companies first (they matter most), then the energy universe. */
export async function graphUniverse(): Promise<Member[]> {
  const [watched, energy] = await Promise.all([watchedCompanies(), energyUniverse()]);
  const seen = new Set<string>();
  return [...watched, ...energy].filter((m) => (seen.has(m.cik) ? false : (seen.add(m.cik), true)));
}
