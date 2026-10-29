/**
 * Scoring with the Deal Radar (E4): every in-scope listed company's 12-month odds from the current model,
 * its interval, sector base rate, reasons (each linked to its filing) and what would move it. Scores go to
 * edge_predictions (kind odds_target_12m), a weekly point in the signal store (odds.target12, the boards'
 * sparklines), and, after a full pass, into the forecast ledger (F3) for watched companies and the top 200,
 * and onto the feed as deal_odds cards when they pass the card rules. Weekly for the universe, daily for
 * watched companies (their filings re-read first). Free: public data and stored models; no premium scope.
 *
 * Interface for other features (the Thesis Agent's tools, the Buyer Simulator's participation priors):
 *   oddsFor(nodeId)        the stored odds of one company, with reasons, interval and base rate
 *   board(scope, userId)   watched companies, the week's movers, or the screener's rows
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { companyNode } from "../entities/resolve";
import { logForecast } from "../forecasts/ledger";
import { closeAfter } from "../forecasts/rules";
import { mlRun } from "../infra/ml";
import { record } from "../provenance";
import { weekOf } from "../series/change";
import { putPoints, seriesFor } from "../series/store";
import { cardReason, oddsCard, oddsQuestion, type OddsScore } from "./cards";
import { loadUniverse, refreshRaw, rawKey } from "./data";
import { evidenceFor, FEATURE, featureRow, newSignals, type RawCompany } from "./features";
import { dedupeEvents, monthsFrom, sectorOf, waveContext, type TargetEvent } from "./labels";
import { calibrationNote, DISCLAIMER, reasonsOf, scoreTs, type Move, type Reason } from "./model";
import { currentModel, EVENTS_KEY, PANEL_FROM, type ReadyModel } from "./train";
import { getJson } from "../infra/r2";

export const PRED_KIND = "odds_target_12m";
const DAY = 86_400_000;

export type Scored = { p: number; low: number | null; high: number | null; reasons: Reason[]; contribs?: Reason[]; moves: Move[] };
export type StoredOdds = { ticker: string; name: string; sector: string; sic: string; p: number; low: number | null; high: number | null; base: number; reasons: (Reason & { url?: string; date?: string })[]; contribs: Reason[]; moves: Move[]; signals: string[]; at: string };

/** What odds.score returns for a row (ml/odds_core.py score_odds). */
export type MlScore = { id: string; p: number; low: number; high: number; contribs: { feature: string; contrib: number; value: number | null }[]; moves: { key: string; to: number; up: boolean }[] };

/** An ML service score as the Radar's own: TreeSHAP contributions as worded reasons, moves with their words. Pure. */
export function fromMl(s: MlScore): Scored {
  const contribs = reasonsOf(s.contribs.filter((c) => c.feature in FEATURE).map((c) => ({ feature: c.feature, contrib: c.contrib, value: c.value ?? NaN })), 8);
  return { p: s.p, low: s.low, high: s.high, reasons: contribs.slice(0, 3), contribs, moves: s.moves.filter((m) => m.key in FEATURE).map((m) => ({ key: m.key, label: m.up ? FEATURE[m.key].up : FEATURE[m.key].down, to: m.to })) };
}

/** Score feature rows with the current model: here for the TypeScript model, on the ML service for LightGBM. */
export async function scoreRows(model: ReadyModel, rows: { id: string; x: number[] }[]): Promise<Map<string, Scored>> {
  const out = new Map<string, Scored>();
  if (model.engine === "logit" && model.ts) { for (const r of rows) out.set(r.id, scoreTs(model.ts, r.x)); return out; }
  for (let i = 0; i < rows.length; i += 400) {
    const res = await mlRun<{ scores: MlScore[] }>("odds.score", { modelKey: model.artifactKey, calibrationKey: model.metrics.calibrationKey, rows: rows.slice(i, i + 400).map((r) => ({ id: r.id, x: r.x.map((v) => (Number.isFinite(v) ? v : null)) })) }, 150_000);
    for (const s of res.scores) out.set(s.id, fromMl(s));
  }
  return out;
}

/** The wave context for today's rows: the events the panel was built from (as in training), else the cached months. */
async function waveNow(): Promise<ReturnType<typeof waveContext>> {
  const months = monthsFrom(`${PANEL_FROM}-01`, new Date().toISOString().slice(0, 10)).map((d) => d.slice(0, 7));
  const saved = await getJson<TargetEvent[]>(EVENTS_KEY).catch(() => null);
  if (saved?.length) return waveContext(saved, months.length);
  const events: TargetEvent[] = [];
  for (const m of months) events.push(...((await getJson<TargetEvent[]>(`odds/events/${m}.json`).catch(() => null)) ?? []));
  return waveContext(dedupeEvents(events), months.length);
}

/**
 * Score a slice of companies (by CIK) now and store the results; `refresh` re-reads their filings first
 * (watched companies daily). Returns how many were scored.
 */
export async function scoreCompanies(ciks: string[], deadline: number, opts: { refresh?: boolean } = {}): Promise<{ scored: number; model: string | null }> {
  const model = await currentModel();
  if (!model) return { scored: 0, model: null };
  const today = new Date().toISOString().slice(0, 10), week = weekOf(today);
  const ctx = await waveNow();
  const raws: RawCompany[] = [];
  for (const cik of ciks) {
    if (Date.now() > deadline - 20_000) break;
    const r = opts.refresh ? await refreshRaw(cik).catch(() => null) : await getJson<RawCompany>(rawKey(cik)).catch(() => null);
    if (r?.listed && r.ticker) raws.push(r);
  }
  if (!raws.length) return { scored: 0, model: model.version };
  const scores = await scoreRows(model, raws.map((r) => ({ id: r.cik, x: featureRow(r, today, ctx) })));
  const rates = model.metrics.sectorRates ?? {};
  const db = requireDb();
  const points = [], preds: (typeof schema.edgePredictions.$inferInsert)[] = [];
  for (const r of raws) {
    const s = scores.get(r.cik);
    if (!s || !Number.isFinite(s.p)) continue;
    const node = await companyNode(r.ticker).catch(() => null);
    if (!node) continue;
    const reasons = s.reasons.map((x) => { const ev = evidenceFor(r, x.key, today); return { ...x, ...(ev?.u ? { url: ev.u } : {}), ...(ev ? { date: ev.d } : {}) }; });
    const stored: StoredOdds = { ticker: r.ticker, name: r.name, sector: sectorOf(r.sic), sic: r.sic, p: s.p, low: s.low, high: s.high, base: rates[sectorOf(r.sic)] ?? 0.02, reasons, contribs: s.contribs ?? s.reasons, moves: s.moves, signals: newSignals(r, today), at: new Date().toISOString() };
    preds.push({ modelId: model.id, kind: PRED_KIND, subject: node.id, candidate: node.id, score: s.p, rank: 0, reasons: [stored] });
    points.push({ nodeId: node.id, metric: "odds.target12", period: week, value: Math.round(s.p * 10000) / 10000, source: "odds" });
  }
  if (preds.length) {
    await db.delete(schema.edgePredictions).where(and(eq(schema.edgePredictions.kind, PRED_KIND), inArray(schema.edgePredictions.subject, preds.map((p) => p.subject))));
    for (let i = 0; i < preds.length; i += 500) await db.insert(schema.edgePredictions).values(preds.slice(i, i + 500));
    await putPoints(points);
  }
  return { scored: preds.length, model: model.version };
}

/** The universe's scoring slice from a cursor (in-scope, listed companies in CIK order). Returns the next cursor (0 when done). */
export async function scoreSlice(cursor: number, deadline: number, opts: { refresh?: boolean } = {}): Promise<{ next: number; scored: number }> {
  const u = await loadUniverse();
  const ciks = Object.entries(u.entries).filter(([, e]) => e.scope && e.listed).map(([c]) => c).sort((a, b) => Number(a) - Number(b));
  const batch = ciks.slice(cursor, cursor + (opts.refresh ? 80 : 150));
  if (!batch.length) return { next: 0, scored: 0 };
  const r = await scoreCompanies(batch, deadline, { refresh: opts.refresh });
  return { next: cursor + batch.length >= ciks.length ? 0 : cursor + batch.length, scored: r.scored };
}

/** Watched companies' CIKs (with the beta on). */
async function watchedCiks(): Promise<{ cik: string; nodeId: number; ticker: string }[]> {
  const rows = (await requireDb().execute(sql`select distinct n.id, n.cik, n.ticker from edge_watches w join profiles p on p.user_id = w.user_id join edge_nodes n on n.kind = 'company' and n.ticker = w.target->>'ticker' where w.kind = 'company' and n.cik <> '' limit 400`)).rows as { id: number; cik: string; ticker: string }[];
  return rows.map((r) => ({ cik: r.cik.replace(/^0+/, ""), nodeId: Number(r.id), ticker: r.ticker }));
}

/** The daily pass's part: watched companies' filings re-read and re-scored. */
export async function oddsDaily(deadline: number): Promise<{ scored: number; created: number[] }> {
  const w = await watchedCiks();
  const u = await loadUniverse();
  const inScope = w.filter((x) => u.entries[x.cik]?.scope);
  const r = await scoreCompanies(inScope.map((x) => x.cik), deadline - 15_000, { refresh: true });
  const created = r.scored ? await finalize({ nodes: inScope.map((x) => x.nodeId), top: 0 }) : [];
  return { scored: r.scored, created };
}

/**
 * After scoring: log forecasts (watched companies and the top `top` by odds) into the ledger, and post
 * deal_odds cards for scores that pass the card rules. Returns the new card ids.
 */
export async function finalize(opts: { nodes?: number[]; top?: number } = {}): Promise<number[]> {
  const db = requireDb();
  const model = await currentModel();
  if (!model) return [];
  const watched = opts.nodes ?? (await watchedCiks()).map((x) => x.nodeId);
  const topRows = opts.top ? await db.select({ subject: schema.edgePredictions.subject }).from(schema.edgePredictions).where(and(eq(schema.edgePredictions.kind, PRED_KIND), eq(schema.edgePredictions.modelId, model.id))).orderBy(desc(schema.edgePredictions.score)).limit(opts.top) : [];
  const nodes = [...new Set([...watched, ...topRows.map((r) => r.subject)])];
  if (!nodes.length) return [];
  const preds = await db.select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.kind, PRED_KIND), inArray(schema.edgePredictions.subject, nodes.slice(0, 1000))));
  const history = await seriesFor(preds.map((p) => p.subject), "odds.target12", new Date(Date.now() - 200 * DAY).toISOString().slice(0, 10));
  const now = new Date(), closes = closeAfter(now, 12), week = weekOf(now);
  const created: number[] = [];
  for (const p of preds) {
    const s = (p.reasons as StoredOdds[])[0];
    if (!s) continue;
    try {
      await logForecast({ kind: "deal_target", subject: `node:${p.subject}`, question: oddsQuestion(s.name, s.ticker, closes), probability: s.p, low: s.low, high: s.high, baseRate: s.base, opensAt: now, closesAt: closes, rule: { type: "deal", role: "target", node: p.subject }, model: "deal-radar", modelVersion: model.version });
      const h = (history.get(p.subject) ?? []).filter((x) => x.period < week);
      const previous = h.length ? h[h.length - 1].value : null;
      const score: OddsScore = { nodeId: p.subject, ticker: s.ticker, name: s.name, p: s.p, low: s.low, high: s.high, base: s.base, previous, reasons: s.reasons, signals: s.signals, history: [...h.map((x) => x.value), s.p], version: model.version, week };
      const why = cardReason(score);
      if (!why) continue;
      const c = oddsCard(score, why);
      const [row] = await db.insert(schema.edgeDetections).values({ key: c.key, kind: "deal_odds", module: "signals", title: c.title.slice(0, 200), summary: c.summary.slice(0, 1200), why: c.why, confidence: c.confidence, magnitude: c.magnitude, tickers: [s.ticker], bbox: null, visual: c.visual, observedAt: now }).onConflictDoNothing().returning({ id: schema.edgeDetections.id });
      if (!row) continue;
      await record(`detection:${row.id}`, [
        { sourceName: `Edge Deal Radar ${model.version} (${model.engine === "lightgbm" ? "LightGBM hazard model" : "logistic hazard model"})`, sourceUrl: "", license: "YouBank model output on public data", method: model.metrics.calibration ? calibrationNote(model.metrics.calibration) : "calibrated with Venn-Abers", modelVersion: model.version, retrievedAt: now },
        ...s.reasons.filter((r) => r.url).map((r) => ({ sourceName: `SEC EDGAR filing behind "${r.label}"${r.date ? ` (${r.date})` : ""}`, sourceUrl: r.url!, license: "US government work (SEC EDGAR)", method: "a reason's evidence", modelVersion: "", retrievedAt: now })),
      ]);
      created.push(row.id);
    } catch (e) { logError(e, { where: "edge-odds-finalize" }); }
  }
  return created;
}

export type OddsView = StoredOdds & { nodeId: number; version: string; engine: string; history: { period: string; value: number }[]; scorecard: string; calibration: string; disclaimer: string; buyers: { name: string; ticker: string; score: number }[]; trainedThrough: string };

/** One company's stored odds, with its history, likely buyers from the deal model, and the model's record. */
export async function oddsFor(nodeId: number): Promise<OddsView | null> {
  const db = requireDb();
  const model = await currentModel();
  if (!model) return null;
  const [p] = await db.select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.kind, PRED_KIND), eq(schema.edgePredictions.subject, nodeId))).orderBy(desc(schema.edgePredictions.id)).limit(1);
  if (!p) return null;
  const s = (p.reasons as StoredOdds[])[0];
  const history = (await seriesFor([nodeId], "odds.target12", new Date(Date.now() - 400 * DAY).toISOString().slice(0, 10))).get(nodeId) ?? [];
  const buyers = (await db.execute(sql`select n.name, n.ticker, p.score from edge_predictions p join edge_nodes n on n.id = p.candidate where p.kind = 'acquirer' and p.subject = ${nodeId} and p.model_id = (select max(id) from edge_models where kind = 'gnn-deals' and status = 'ready') order by p.rank limit 5`)).rows as { name: string; ticker: string; score: number }[];
  return { ...s, nodeId, version: model.version, engine: model.engine, history, scorecard: model.metrics.scorecard?.text ?? "Not backtested yet.", calibration: model.metrics.calibration ? calibrationNote(model.metrics.calibration) : "", disclaimer: DISCLAIMER, buyers, trainedThrough: model.metrics.trainedThrough ?? "" };
}

export type BoardRow = { nodeId: number; ticker: string; name: string; sector: string; p: number; low: number | null; high: number | null; base: number; rise: number | null; reasons: StoredOdds["reasons"]; history: number[] };

/** Board rows for some predictions: the stored odds with each company's last 26 weekly points and its weekly change. */
async function rowsOf(preds: (typeof schema.edgePredictions.$inferSelect)[]): Promise<BoardRow[]> {
  const hist = await seriesFor(preds.map((p) => p.subject), "odds.target12", new Date(Date.now() - 190 * DAY).toISOString().slice(0, 10));
  return preds.map((p) => {
    const s = (p.reasons as StoredOdds[])[0];
    const h = (hist.get(p.subject) ?? []).map((x) => x.value);
    return { nodeId: p.subject, ticker: s.ticker, name: s.name, sector: s.sector, p: s.p, low: s.low, high: s.high, base: s.base, rise: h.length >= 2 ? h[h.length - 1] - h[h.length - 2] : null, reasons: s.reasons, history: h.slice(-26) };
  });
}

/** The board: the person's watched companies, the week's movers (top 25 by weekly change), or the screener's rows. */
export async function board(scope: "watched" | "movers" | "screen", userId: string, filters: { sector?: string; min?: number; limit?: number } = {}): Promise<BoardRow[]> {
  const db = requireDb();
  if (scope === "watched") {
    const nodes = (await db.execute(sql`select distinct n.id from edge_watches w join edge_nodes n on n.kind = 'company' and n.ticker = w.target->>'ticker' where w.user_id = ${userId} and w.kind = 'company'`)).rows as { id: number }[];
    if (!nodes.length) return [];
    const preds = await db.select().from(schema.edgePredictions).where(and(eq(schema.edgePredictions.kind, PRED_KIND), inArray(schema.edgePredictions.subject, nodes.map((n) => Number(n.id)))));
    return (await rowsOf(preds)).sort((a, b) => b.p - a.p);
  }
  const preds = await db.select().from(schema.edgePredictions).where(eq(schema.edgePredictions.kind, PRED_KIND)).orderBy(desc(schema.edgePredictions.score)).limit(scope === "screen" ? 5000 : 2000);
  const rows = await rowsOf(preds);
  if (scope === "movers") return rows.filter((r) => r.rise !== null).sort((a, b) => (b.rise ?? 0) - (a.rise ?? 0)).slice(0, 25);
  return rows.filter((r) => (!filters.sector || r.sector === filters.sector) && (filters.min === undefined || r.p >= filters.min)).slice(0, Math.max(1, Math.min(5000, filters.limit ?? 500)));
}
