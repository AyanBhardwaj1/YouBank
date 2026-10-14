/**
 * Training the Deal Radar (E4). A monthly pipeline, resumable stage by stage (edge_job_state 'odds.pipeline'):
 *   scan    the universe scan fills the raw store (data.ts), a slice per step;
 *   events  target events since 2012 (EDGAR month by month, cached), past targets added to the raw store;
 *   panel   the monthly panel built from the raw store and written to R2 as JSON lines;
 *   train   LightGBM on the ML service (odds.train: monotone constraints, rolling-origin validation with a
 *           one-horizon embargo, the baselines, Venn-Abers calibration, TreeSHAP) when it is set up, else
 *           the TypeScript logistic hazard model (odds/model.ts) with the same validation and calibration;
 *   score   the universe scored (odds/score.ts).
 * Each version is an edge_models row (kind odds-target-12m) with its scorecard; the artifact sits in R2.
 */
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { failureMessage, logError, storedMessage } from "@/lib/errors";
import { mlReady, mlStart, mlStatus, noteMlCost, type MlDone } from "../infra/ml";
import { getBytes, getJson, putObject, r2Ready } from "../infra/r2";
import { addPastTargets, loadEvents, loadRaws, scanSlice } from "./data";
import { FEATURES } from "./features";
import { buildPanel, universeMode, type PanelRow } from "./labels";
import { scorecardText, trainTs, type Scorecard, type TsModel } from "./model";

export const MODEL_KIND = "odds-target-12m";
export const PANEL_FROM = "2012-01";
export const EVENTS_KEY = "odds/events-all.json";
export type Stage = "scan" | "events" | "panel" | "train" | "score" | "idle";
export type Pipeline = { stage: Stage; version?: string; panelKey?: string; modelId?: number; callId?: string; startedAt?: string; lastError?: string; finishedAt?: string; rows?: number; positives?: number; companies?: number; scanDone?: boolean; scoreCursor?: number };

export async function getPipeline(): Promise<Pipeline> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "odds.pipeline"));
  return (r?.state ?? { stage: "idle" }) as Pipeline;
}
export async function setPipeline(p: Pipeline): Promise<Pipeline> {
  await requireDb().insert(schema.edgeJobState).values({ name: "odds.pipeline", state: p }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: p, updatedAt: new Date() } });
  return p;
}

/** Panel rows as JSON lines: [cik, t, sic, y, listed, ...x], NaN as null. Pure. */
export function panelLines(rows: PanelRow[]): string {
  return rows.map((r) => JSON.stringify([r.cik, r.t, r.sic, r.y, r.listed ? 1 : 0, ...r.x.map((v) => (Number.isFinite(v) ? Math.round(v * 1e5) / 1e5 : null))])).join("\n");
}
/** JSON lines back to panel rows. Pure. */
export function parsePanel(text: string): PanelRow[] {
  return text.split("\n").filter(Boolean).map((l) => { const a = JSON.parse(l) as (string | number | null)[]; return { cik: String(a[0]), t: String(a[1]), sic: String(a[2]), y: a[3] === null ? null : (Number(a[3]) as 0 | 1), listed: a[4] === 1, x: a.slice(5).map((v) => (v === null ? NaN : Number(v))) }; });
}

export async function loadPanel(key: string): Promise<PanelRow[]> {
  const b = await getBytes(key);
  return b ? parsePanel(new TextDecoder().decode(b)) : [];
}

const version = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

/** Start a monthly run (an administrator, or the monthly cron). */
export async function startPipeline(): Promise<Pipeline> {
  return setPipeline({ stage: "scan", version: version(), startedAt: new Date().toISOString() });
}

/**
 * Advance the pipeline one step within the deadline. Returns the pipeline after the step; "idle" when there
 * is nothing to do, or a step to wait on (an ML call id) for the trainer.
 */
export async function pipelineStep(deadline: number): Promise<Pipeline & { wait?: string }> {
  const p = await getPipeline();
  if (!r2Ready()) return setPipeline({ ...p, stage: "idle", lastError: "Deal Radar needs file storage (R2) for its raw store and panel." });
  const mode = universeMode();
  try {
    if (p.stage === "scan") {
      const r = await scanSlice(deadline, { mode });
      return setPipeline({ ...p, stage: r.done ? "events" : "scan", scanDone: r.done });
    }
    if (p.stage === "events") {
      const { events, complete } = await loadEvents(PANEL_FROM, deadline - 60_000);
      if (complete) await addPastTargets(events, deadline, mode);
      return setPipeline({ ...p, stage: complete ? "panel" : "events" });
    }
    if (p.stage === "panel") {
      const { events } = await loadEvents(PANEL_FROM, deadline - 120_000);
      const { raws, complete } = await loadRaws(deadline - 60_000);
      if (!complete) return setPipeline({ ...p, lastError: "Reading the raw store took longer than a step; it continues next step." });
      const rows = buildPanel(raws, events, { from: `${PANEL_FROM}-01`, today: new Date().toISOString().slice(0, 10) });
      const key = `odds/panel-${p.version}.jsonl`;
      await putObject(key, panelLines(rows), "application/x-ndjson");
      // The events the panel used, so scoring computes the industry wave exactly as training did.
      await putObject(EVENTS_KEY, JSON.stringify(events), "application/json");
      return setPipeline({ ...p, stage: "train", panelKey: key, rows: rows.length, positives: rows.filter((r) => r.y === 1).length, companies: raws.length });
    }
    if (p.stage === "train") {
      if (p.callId && p.modelId) {
        // Training on the ML service: ask whether it has finished (the job sleeps between asks).
        const st = await mlStatus(p.callId);
        if (!st.done) return { ...p, wait: p.callId };
        noteMlCost(st.costUsd);
        const r = await finishTraining(p.modelId, { callId: p.callId, task: "odds.train", correlation: `odds:${p.modelId}`, ok: !!st.ok, result: st.result, error: st.error, costUsd: st.costUsd });
        return setPipeline({ ...p, callId: undefined, stage: r.ok ? "score" : "idle", ...(r.ok ? {} : { lastError: "Training failed on the ML service; the previous model stays in use." }) });
      }
      const r = await startTraining(p);
      return setPipeline({ ...p, ...r, stage: "callId" in r && r.callId ? "train" : "score" }).then((x) => ("callId" in r && r.callId ? { ...x, wait: r.callId } : x));
    }
  } catch (e) {
    return setPipeline({ ...p, lastError: failureMessage(e, "edge-odds-pipeline").slice(0, 300) });
  }
  return p;
}

/** Start training this version: on the ML service when set up (returns its call id), else here, now. */
export async function startTraining(p: Pipeline): Promise<{ modelId: number; callId?: string; lastError?: string }> {
  const db = requireDb();
  const [row] = await db.insert(schema.edgeModels).values({ kind: MODEL_KIND, version: p.version!, status: "training", metrics: { panel: { rows: p.rows, positives: p.positives, companies: p.companies, from: PANEL_FROM, universe: universeMode() } } }).returning({ id: schema.edgeModels.id });
  if (mlReady()) {
    try {
      const callId = await mlStart("odds.train", { panelKey: p.panelKey, version: p.version, features: FEATURES.map((f) => ({ key: f.key, monotone: f.monotone })), horizon: 12, outKey: `ml/odds/lgbm-${p.version}` }, `odds:${row.id}`);
      return { modelId: row.id, callId };
    } catch (e) { logError(e, { where: "edge-odds-ml-start" }); }
  }
  const rows = await loadPanel(p.panelKey!);
  const m = trainTs(rows, p.version!);
  if ("error" in m) {
    await db.update(schema.edgeModels).set({ status: "failed", metrics: { error: m.error } }).where(eq(schema.edgeModels.id, row.id));
    return { modelId: row.id, lastError: m.error };
  }
  const key = `odds/model-${p.version}.json`;
  await putObject(key, JSON.stringify(m), "application/json");
  await db.update(schema.edgeModels).set({ status: "ready", artifactKey: key, trainedAt: new Date(), metrics: { engine: "logit", scorecard: m.scorecard, calibration: { year: m.calibration.year, n: m.calibration.n, positives: m.calibration.positives }, sectorRates: m.sectorRates, trainedThrough: m.trainedThrough, panel: { rows: p.rows, positives: p.positives, companies: p.companies, universe: universeMode() } } }).where(eq(schema.edgeModels.id, row.id));
  return { modelId: row.id };
}

/** What odds.train returns (ml/edge_ml.py): the model's keys in R2, its scorecard and calibration summary. */
export type LgbmResult = { modelKey: string; calibrationKey: string; scorecard: Scorecard; calibration: { year: number; n: number; positives: number }; sectorRates: Record<string, number>; trainedThrough: string; info?: Record<string, unknown> };

/** Store a finished ML training run. */
export async function finishTraining(modelId: number, done: MlDone | null): Promise<{ ok: boolean }> {
  const db = requireDb();
  const [model] = await db.select().from(schema.edgeModels).where(eq(schema.edgeModels.id, modelId));
  if (!model) return { ok: false };
  const prior = (model.metrics ?? {}) as Record<string, unknown>;
  if (!done?.ok || !done.result) {
    await db.update(schema.edgeModels).set({ status: "failed", metrics: { ...prior, error: storedMessage(done?.error ?? "The ML service did not answer in time.", "Training failed on the ML service.").slice(0, 300) } }).where(eq(schema.edgeModels.id, modelId));
    return { ok: false };
  }
  const r = done.result as unknown as LgbmResult;
  // The ML service returns the scorecard's numbers; its words are written here, the same way for both engines.
  const scorecard = { ...r.scorecard, text: scorecardText(r.scorecard) };
  await db.update(schema.edgeModels).set({ status: "ready", artifactKey: r.modelKey, trainedAt: new Date(), metrics: { ...prior, engine: "lightgbm", scorecard, calibration: r.calibration, sectorRates: r.sectorRates, trainedThrough: r.trainedThrough, calibrationKey: r.calibrationKey, info: r.info ?? {} } }).where(eq(schema.edgeModels.id, modelId));
  return { ok: true };
}

export type ReadyModel = { id: number; version: string; engine: "logit" | "lightgbm"; artifactKey: string; metrics: { scorecard?: Scorecard; calibration?: { year: number; n: number; positives: number }; sectorRates?: Record<string, number>; trainedThrough?: string; calibrationKey?: string; panel?: Record<string, unknown> }; ts?: TsModel | null; trainedAt: Date };

/** The latest ready Deal Radar model, with the TypeScript artifact loaded when it is one. */
export async function currentModel(): Promise<ReadyModel | null> {
  const [m] = await requireDb().select().from(schema.edgeModels).where(and(eq(schema.edgeModels.kind, MODEL_KIND), eq(schema.edgeModels.status, "ready"))).orderBy(desc(schema.edgeModels.id)).limit(1);
  if (!m) return null;
  const metrics = (m.metrics ?? {}) as ReadyModel["metrics"] & { engine?: string };
  const engine = metrics.engine === "lightgbm" ? "lightgbm" : "logit";
  const ts = engine === "logit" && m.artifactKey ? await getJson<TsModel>(m.artifactKey).catch(() => null) : null;
  return { id: m.id, version: m.version, engine, artifactKey: m.artifactKey, metrics, ts, trainedAt: m.trainedAt };
}

