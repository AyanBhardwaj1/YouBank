/**
 * ALT <TICKER>: a company's alternative data in one dense board, each row against the company's own
 * history (a percentile and a z-score of the latest reading among its earlier ones) with a sparkline:
 * the Pulse series (open postings, new postings, Wikipedia attention, federal awards, WARN layoffs,
 * patents), the Deal Radar's 12-month sale odds, public records (FDA and NHTSA recalls, nuclear units
 * offline) as monthly counts, and the prediction markets that move the stock with their month of prices.
 * Each family says where it came from and how fresh it is; a family with nothing says so. Server only.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { readSeries, type SeriesPoint } from "@/lib/edge/series/store";
import { metricDef, SOURCES } from "@/lib/edge/series/metrics";
import { FDA_FIRMS, NHTSA_MAKERS } from "@/lib/edge/records/names";
import { PLANTS } from "@/lib/edge/records/reactors";
import { loadMarkets, priceHistory } from "@/lib/predict/store";
import { predictSignalsFor } from "@/lib/predict/exposure";
import { VENUE_LABEL, type Market, type VenueState } from "@/lib/predict/types";
import { monthlyCounts, percentileRank, zScore } from "../edge-math";
import { attempt, newest, nodeFor, stateOf, type SourceState } from "./common";

const DAY = 86_400_000;
export type AltFamily = "jobs" | "attention" | "contracts" | "layoffs" | "patents" | "odds" | "records" | "markets";
export type AltRow = {
  key: string; family: AltFamily; label: string; unit: string;
  latest: number | null; period: string | null; prev: number | null;
  /** The latest among the company's own earlier readings: 0 its lowest, 1 its highest. */
  pctile: number | null; z: number | null; n: number;
  spark: number[]; /** The sparkline's periods (dates or months), when it has them. */ x: string[]; source: string; url?: string; note?: string;
};
export type AltView = {
  ticker: string; name: string; inGraph: boolean; pulseAt: string | null;
  rows: AltRow[]; sources: SourceState[]; asOf: string;
};

/** The Pulse metrics in board order. */
const PULSE: string[] = ["jobs.open", "jobs.new", "wiki.views", "usasp.awards", "usasp.obligated", "warn.employees", "patents.grants", "patents.apps", "odds.target12"];
const FAMILY: Record<string, AltFamily> = { jobs: "jobs", attention: "attention", contracts: "contracts", layoffs: "layoffs", patents: "patents", odds: "odds" };

/** A series as a row: the latest point against the earlier ones. Pure. */
export function seriesRow(metric: string, points: SeriesPoint[]): AltRow | null {
  const def = metricDef(metric);
  if (!def || !points.length) return null;
  const vals = points.map((p) => p.value), last = vals[vals.length - 1], earlier = vals.slice(0, -1);
  const src = SOURCES[def.source] ?? (def.source === "ats" ? { name: "Company job boards (Greenhouse, Lever, Ashby)", url: "" } : { name: def.source, url: "" });
  return {
    key: metric, family: FAMILY[def.family] ?? "jobs", label: def.label, unit: def.unit, latest: last, period: points[points.length - 1].period, prev: earlier.length ? earlier[earlier.length - 1] : null,
    pctile: percentileRank(earlier, last), z: zScore(earlier, last), n: points.length, spark: vals.slice(-26), x: points.slice(-26).map((p) => p.period), source: src.name, url: src.url || undefined,
  };
}

const RECORDS: { kind: string; label: string; source: string; url: string; covers: (t: string) => boolean }[] = [
  { kind: "fda_recall", label: "FDA recall bursts", source: "openFDA enforcement reports", url: "https://open.fda.gov/apis/", covers: (t) => FDA_FIRMS.some((r) => r.ticker === t) },
  { kind: "vehicle_recall", label: "NHTSA vehicle recall bursts", source: "NHTSA recalls", url: "https://www.nhtsa.gov/recalls", covers: (t) => NHTSA_MAKERS.some((r) => r.ticker === t) },
  { kind: "reactor_outage", label: "Nuclear units offline or derated", source: "NRC power reactor status", url: "https://www.nrc.gov/reading-rm/doc-collections/event-status/reactor-status/", covers: (t) => PLANTS.some((p) => p.tickers.includes(t)) },
];

async function recordCards(ticker: string) {
  return requireDb().select({ kind: schema.edgeDetections.kind, title: schema.edgeDetections.title, at: sql<Date>`coalesce(${schema.edgeDetections.observedAt}, ${schema.edgeDetections.detectedAt})` })
    .from(schema.edgeDetections).where(sql`${schema.edgeDetections.tickers} ? ${ticker} and ${schema.edgeDetections.kind} in ('fda_recall', 'vehicle_recall', 'reactor_outage') and ${schema.edgeDetections.ownerId} is null and ${schema.edgeDetections.detectedAt} > now() - interval '730 days'`)
    .orderBy(sql`coalesce(${schema.edgeDetections.observedAt}, ${schema.edgeDetections.detectedAt}) desc`).limit(400);
}

/** The month of prices of the prediction markets that move this stock (the three strongest). */
async function marketRows(ticker: string): Promise<{ rows: AltRow[]; venues: VenueState[] }> {
  const { markets, venues } = await loadMarkets(["kalshi", "polymarket", "gemini"]);
  const events = predictSignalsFor([ticker], markets, { perTicker: 4 })[ticker] ?? [];
  const byKey = new Map<string, Market>(markets.map((m) => [m.key, m]));
  const rows = await Promise.all(events.slice(0, 4).map(async (e): Promise<AltRow> => {
    const m = byKey.get(e.key);
    const hist = m ? (await priceHistory(m, "1m")).map((p) => p.p) : [];
    const earlier = hist.length > 1 ? hist.slice(0, -1) : [];
    return {
      key: `pm:${e.key}`, family: "markets", label: e.label, unit: "probability", latest: e.prob, period: null, prev: e.change24h === null ? null : e.prob - e.change24h,
      pctile: percentileRank(earlier, e.prob), z: zScore(earlier, e.prob), n: hist.length, spark: hist.length ? hist.slice(-30) : [], x: [], source: VENUE_LABEL[e.venue], url: e.url,
      note: `${e.dir === 1 ? "YES tends to lift the stock" : e.dir === -1 ? "YES tends to weigh on the stock" : "mixed effect"} (${e.via})`,
    };
  }));
  return { rows, venues };
}

export async function altView(ticker: string, now = Date.now()): Promise<AltView> {
  const node = await attempt("alt-node", null as Awaited<ReturnType<typeof nodeFor>>, () => nodeFor(ticker));
  const since = new Date(now - 3 * 365 * DAY).toISOString().slice(0, 10);
  const [series, records, pm] = await Promise.all([
    attempt<Record<string, SeriesPoint[]>>("alt-series", {}, () => (node.value ? readSeries(node.value.id, { metrics: PULSE, since }) : Promise.resolve({}))),
    attempt("alt-records", [] as Awaited<ReturnType<typeof recordCards>>, () => recordCards(ticker)),
    attempt("alt-markets", { rows: [] as AltRow[], venues: [] as VenueState[] }, () => marketRows(ticker)),
  ]);
  const pulseRows = PULSE.flatMap((m) => { const r = seriesRow(m, series.value[m] ?? []); return r ? [r] : []; });
  const recordRows: AltRow[] = RECORDS.filter((r) => r.covers(ticker) || records.value.some((c) => c.kind === r.kind)).map((r) => {
    const mine = records.value.filter((c) => c.kind === r.kind);
    const counts = monthlyCounts(mine.map((c) => new Date(c.at).toISOString()), 24, now);
    const last = counts[counts.length - 1], earlier = counts.slice(0, -1);
    return {
      key: `rec:${r.kind}`, family: "records", label: r.label, unit: "a month", latest: last, period: new Date(now).toISOString().slice(0, 7), prev: earlier[earlier.length - 1] ?? null,
      pctile: percentileRank(earlier, last), z: zScore(earlier, last), n: counts.length, spark: counts, x: counts.map((_, i) => new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - (counts.length - 1 - i), 1)).toISOString().slice(0, 7)), source: r.source, url: r.url,
      note: mine[0] ? `Latest: ${mine[0].title} (${new Date(mine[0].at).toISOString().slice(0, 10)})` : "Covered; nothing in two years",
    };
  });
  const rows = [...pulseRows, ...recordRows, ...pm.value.rows];
  const pulseAt = typeof node.value?.attrs.pulseAt === "string" ? node.value.attrs.pulseAt : null;
  const fam = (f: AltFamily) => rows.filter((r) => r.family === f);
  const sources: SourceState[] = [
    stateOf("graph", "Edge relationship graph", node.ok, node.value ? 1 : 0, null, { note: node.value ? undefined : `${ticker} is not in the graph yet: open NET to read its filings in` }),
    stateOf("pulse", "Edge Pulse (job boards, Wikimedia, USAspending, WARN, PatentsView)", series.ok, pulseRows.filter((r) => r.family !== "odds").length, pulseAt ?? newest(pulseRows.map((r) => r.period)), { staleAfterMs: 10 * DAY, now }),
    stateOf("odds", "Edge Deal Radar", series.ok, fam("odds").length, newest(fam("odds").map((r) => r.period))),
    stateOf("records", "Public records (openFDA, NHTSA, NRC)", records.ok, recordRows.length, newest(records.value.map((c) => new Date(c.at).toISOString()))),
    ...(pm.value.venues.length ? pm.value.venues.map((v) => stateOf(`predict-${v.venue}`, `${VENUE_LABEL[v.venue]} prediction markets`, pm.ok && v.ok, v.count, v.fetchedAt, { note: v.stale ? "last good list" : undefined })) : [stateOf("predict", "Prediction markets", pm.ok, 0, null)]),
  ];
  return { ticker, name: node.value?.name ?? ticker, inGraph: !!node.value, pulseAt, rows, sources, asOf: new Date(now).toISOString() };
}
