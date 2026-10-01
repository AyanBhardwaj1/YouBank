/**
 * One company across Edge, for the Terminal's EDGE function: what Edge found about it (on the ground,
 * in its filings, in deals and in the graph), the deal model's likely buyers and targets for it, its red
 * flags, what of it is on the map, and whether the person watches it. The public parts are shared per
 * instance for ten minutes; the person's own (their findings and watches) are read fresh.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { resolveTicker } from "@/lib/edgar/tickers";
import { memo } from "@/lib/memo";
import { WATCH_LIMIT, type Blend } from "./access";
import { companyCards, type EdgeCard } from "./feed";
import type { Flag } from "./graph/algo";
import { overview, predictions, redFlags, type Prediction } from "./graph/findings";
import { companyByTicker } from "./graph/store";
import { listWatches } from "./watches";

export type RankedPick = { name: string; ticker: string; score: number; rank: number; why: string };
export type CompanyGraph = {
  industry: string; place: string; revenue: number | null;
  counts: { directors: number; officers: number; holders: number; stakes: number; subsidiaries: number; customers: number; suppliers: number; deals: number };
  flags: Flag[]; buyers: RankedPick[]; targets: RankedPick[]; version: string | null; scorecard: string;
};
export type CompanyOverview = {
  ticker: string; name: string;
  watch: { id: number } | null; canWatch: boolean;
  cards: EdgeCard[];
  graph: CompanyGraph | null;
  assets: { plants: number; pipelines: number; capacityMMcfd: number; pipelineKm: number };
};

/** A pick in a line: the company and the first reason path, in words. Pure. */
export function rankedPick(p: Pick<Prediction, "node" | "score" | "rank" | "paths">): RankedPick {
  return { name: p.node.name, ticker: p.node.ticker, score: p.score, rank: p.rank, why: (p.paths[0] ?? []).map((s) => s.text).join("; ") };
}

const graphOf = (ticker: string) => memo(`edge:overview:graph:${ticker}`, 10 * 60_000, async (): Promise<(CompanyGraph & { name: string }) | null> => {
  const node = await companyByTicker(ticker);
  if (!node) return null;
  const [ov, flags, buyers, targets] = await Promise.all([overview(node), redFlags(node), predictions(node, "acquirer", 5), predictions(node, "target", 5)]);
  return {
    name: node.name, industry: ov.industry, place: ov.place, revenue: ov.revenue, counts: ov.counts,
    flags: [...flags].sort((a, b) => (a.severity === b.severity ? b.date.localeCompare(a.date) : a.severity === "high" ? -1 : 1)).slice(0, 5),
    buyers: buyers.items.slice(0, 5).map(rankedPick), targets: targets.items.slice(0, 5).map(rankedPick), version: buyers.version, scorecard: buyers.scorecard,
  };
});

const assetsOf = (ticker: string) => memo(`edge:overview:assets:${ticker}`, 10 * 60_000, async () => {
  const rows = (await requireDb().execute(sql`
    select kind, count(*)::int as n, coalesce(sum(nullif(attrs->>'capacityMMcfd', '')::float), 0)::float as cap,
      case when kind = 'pipeline' then coalesce(sum(ST_Length(geom::geography)), 0)::float / 1000 else 0 end as km
    from edge_assets where ticker = ${ticker} and kind in ('pipeline', 'processing_plant') and owner_id is null group by kind`)).rows as { kind: string; n: number; cap: number; km: number }[];
  const plant = rows.find((r) => r.kind === "processing_plant"), pipe = rows.find((r) => r.kind === "pipeline");
  return { plants: plant?.n ?? 0, pipelines: pipe?.n ?? 0, capacityMMcfd: Math.round(plant?.cap ?? 0), pipelineKm: Math.round(pipe?.km ?? 0) };
});

export async function companyOverview(userId: string, blend: Blend, ticker: string): Promise<CompanyOverview> {
  const watches = await listWatches(userId);
  const [graph, assets, cards, listed] = await Promise.all([graphOf(ticker), assetsOf(ticker), companyCards(userId, ticker, watches, blend, 8), resolveTicker(ticker)]);
  const w = watches.find((x) => x.mine && x.kind === "company" && x.target.ticker === ticker);
  const { name, ...rest } = graph ?? { name: "" };
  return {
    ticker, name: name || listed?.name || ticker,
    watch: w ? { id: w.id } : null, canWatch: !w && watches.filter((x) => x.mine).length < WATCH_LIMIT,
    cards, graph: graph ? (rest as CompanyGraph) : null, assets,
  };
}
