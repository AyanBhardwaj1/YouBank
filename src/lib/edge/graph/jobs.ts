/**
 * Keeping the graph current and its findings in the feed:
 * - ingesting companies in slices that fit a function's time (so a week's refresh of the whole universe
 *   is a chain of short steps);
 * - after ingesting, posting new red flags for watched companies as feed cards;
 * - after training, posting a watched company's likely buyers when the top three change.
 */
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { record } from "../provenance";
import { BETA_ON } from "../watches";
import { sendJob } from "../infra/jobs";
import { dealsSince, newsroomDeals } from "./deals";
import { redFlags } from "./findings";
import { ingestMany } from "./ingest";
import { companyByTicker, nodesById } from "./store";
import { latestModels, scorecardText, type ModelMetrics } from "./train";
import { watchedCompanies } from "./universe";

/** Tickers people with the beta on watch. */
async function watchedTickers(): Promise<string[]> {
  const rows = await requireDb().selectDistinct({ ticker: sql<string>`${schema.edgeWatches.target}->>'ticker'` }).from(schema.edgeWatches)
    .innerJoin(schema.profiles, eq(schema.profiles.userId, schema.edgeWatches.userId)).where(and(BETA_ON, eq(schema.edgeWatches.kind, "company")));
  return rows.map((r) => String(r.ticker ?? "").toUpperCase()).filter(Boolean);
}

const FLAG_TITLE: Record<string, string> = { restatement: "a restatement warning", auditor_change: "an auditor change", bankruptcy: "a bankruptcy filing", delisting: "a listing notice", impairment: "an impairment", leadership_turnover: "leadership turnover", insider_exit: "an insider exit", insider_cluster: "insider selling", circular_ownership: "circular ownership", shared_director: "a shared director", related_party: "a related-party link" };

/** New red flags (from the last two weeks) of watched companies, as feed cards; returns the new cards' ids. */
export async function flagCards(nodeIds: number[]): Promise<number[]> {
  const watched = new Set(await watchedTickers());
  const nodes = [...(await nodesById(nodeIds)).values()].filter((n) => n.kind === "company" && watched.has(n.ticker));
  const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
  const out: number[] = [];
  for (const n of nodes) {
    for (const f of (await redFlags(n)).filter((x) => x.date >= since && x.kind !== "shared_director")) {
      const [row] = await requireDb().insert(schema.edgeDetections).values({
        key: `flag:${n.id}:${f.kind}:${f.date}`, kind: "graph_flag", module: "networks",
        title: `${n.name}: ${f.title}`.slice(0, 200), summary: f.detail.slice(0, 1200),
        why: `Edge reads ${n.name}'s filings on EDGAR every week: 8-K items (auditor changes, restatements, departures), insider filings (Form 4) and ownership filings (Schedule 13D/13G). This card is ${FLAG_TITLE[f.kind] ?? "a flag"} found there; the filings are linked below.`,
        confidence: 0.9, magnitude: f.severity === "high" ? 0.9 : 0.5, tickers: [n.ticker], bbox: null,
        visual: { type: "flag", company: { id: n.id, name: n.name, ticker: n.ticker }, flag: f }, observedAt: new Date(f.date),
      }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
      if (!row) continue;
      await record(`detection:${row.id}`, (f.urls ?? []).map((u) => ({ sourceName: "SEC EDGAR filing", sourceUrl: u, license: "Public filing (SEC EDGAR)", method: "read from the filing's structured data", modelVersion: "", retrievedAt: new Date() })));
      out.push(row.id);
    }
  }
  return out;
}

/** After training: a card for each watched company whose top-three likely buyers changed. */
export async function predictionCards(): Promise<number[]> {
  const [cur, prev] = await latestModels();
  if (!cur) return [];
  const metrics = cur.metrics as ModelMetrics;
  const out: number[] = [];
  for (const t of await watchedTickers()) {
    const n = await companyByTicker(t);
    if (!n) continue;
    const top = async (modelId: number) => (await requireDb().select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.modelId, modelId), eq(schema.edgePredictions.subject, n.id), eq(schema.edgePredictions.kind, "acquirer"))).orderBy(schema.edgePredictions.rank).limit(5));
    const now = await top(cur.id);
    if (!now.length) continue;
    const before = prev ? new Set((await top(prev.id)).slice(0, 3).map((p) => p.candidate)) : new Set<number>();
    const fresh = now.slice(0, 3).filter((p) => !before.has(p.candidate));
    if (prev && !fresh.length) continue;
    const names = await nodesById(now.map((p) => p.candidate));
    const list = now.map((p) => ({ id: p.candidate, name: names.get(p.candidate)?.name ?? "?", ticker: names.get(p.candidate)?.ticker ?? "", score: p.score, rank: p.rank, fresh: fresh.some((f) => f.candidate === p.candidate) }));
    const hits = metrics.gnn?.asTarget?.hits5 ?? null;
    const [row] = await requireDb().insert(schema.edgeDetections).values({
      key: `pred:${cur.id}:${n.id}:acquirer`, kind: "graph_prediction", module: "networks",
      title: `Likely buyers of ${n.name}: ${list.slice(0, 3).map((x) => x.name).join(", ")}`.slice(0, 200),
      summary: `${prev ? `New in the top three since the last model: ${fresh.map((f) => names.get(f.candidate)?.name ?? "?").join(", ")}. ` : ""}${scorecardText(metrics, "acquirers")}`.slice(0, 1200),
      why: "A graph neural network trained on the relationship graph (boards, insiders, 5% holders, subsidiaries and joint ventures, customers and suppliers, and every deal Edge has read from EDGAR and the Newsroom) ranks each company's likely buyers. It is backtested on the most recent deals it never saw; each name comes with the paths that connect the two companies.",
      confidence: hits !== null ? Math.min(0.85, 0.3 + hits) : 0.4, magnitude: prev ? fresh.length / 3 : 0.5, tickers: [n.ticker, ...list.map((x) => x.ticker).filter(Boolean)].slice(0, 8), bbox: null,
      visual: { type: "prediction", subject: { id: n.id, name: n.name, ticker: n.ticker }, direction: "acquirers", items: list, scorecard: scorecardText(metrics, "acquirers"), version: cur.version },
      observedAt: cur.trainedAt,
    }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
    if (row) {
      await record(`detection:${row.id}`, [{ sourceName: "Edge deal model (graph neural network)", sourceUrl: "", license: "YouBank", method: "relational GraphSAGE link prediction, backtested", modelVersion: `gnn-deals ${cur.version}`, retrievedAt: new Date() }]);
      out.push(row.id);
    }
  }
  return out;
}

/** Ingest a list of companies in one slice of time, then post flags for any watched ones. */
export async function ingestSlice(ciks: string[], deadline: number): Promise<{ left: string[]; done: number; cards: number }> {
  const r = await ingestMany(ciks, deadline - 20_000);
  let cards: number[] = [];
  try { cards = await flagCards(r.results.map((x) => x.nodeId).filter(Boolean)); } catch (e) { logError(e, { where: "edge-graph-flags" }); }
  return { left: r.left, done: r.results.length, cards: cards.length };
}

/**
 * The daily pass (from Edge's cron): watched companies are re-read (new insider filings, 8-K items),
 * the Newsroom's latest deals are folded in, and the deal model retrains when a deal was announced
 * since it last trained. Without Inngest only the Newsroom step runs here; the rest waits for it.
 */
export async function graphDaily(): Promise<{ watched: number; queued: boolean; newsroom: number; retrain: boolean }> {
  const today = new Date().toISOString().slice(0, 10);
  const watched = await watchedCompanies();
  const queued = watched.length ? (await sendJob("edge/graph.ingest", { ciks: watched.map((w) => w.cik) }, { id: `edge-graph-daily-${today}` })).sent : false;
  const newsroom = await newsroomDeals(45).catch((e) => { logError(e, { where: "edge-graph-newsroom" }); return 0; });
  const [model] = await latestModels();
  const fresh = model ? await dealsSince(new Date(model.trainedAt.getTime() - 3 * 86_400_000).toISOString()) : 1;
  const retrain = fresh > 0 ? (await sendJob("edge/graph.train", { reason: model ? "new deals" : "first model" }, { id: `edge-graph-train-${today}` })).sent : false;
  return { watched: watched.length, queued, newsroom, retrain };
}
