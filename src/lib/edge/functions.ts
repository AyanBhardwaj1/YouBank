/**
 * Edge's background functions on Inngest (served at /api/inngest): canvas runs, the hourly monitor
 * tick, the foundation-model check of every new ground change, reading uploaded documents, and the
 * relationship graph (the weekly refresh, on-demand builds, and training the deal model). Each step
 * counts toward the free tier's executions (see infra/jobs).
 */
import { executeRun } from "./canvas/engine";
import { newsroomDeals } from "./graph/deals";
import { ingestSlice, predictionCards } from "./graph/jobs";
import { finishTraining, startTraining } from "./graph/train";
import { graphUniverse } from "./graph/universe";
import { finishRefine as finishScenario, startRefine as startScenario } from "./scen/run";
import { notifyWatchers } from "./notify";
import { inngest, metered, sendJob, type Steps } from "./infra/jobs";
import { doneFor, noteMlCost, type MlDone } from "./infra/ml";
import { flushUsage } from "./infra/usage";
import { tickMonitors } from "./monitors";
import { applyRefinement, startRefine } from "./refine";
import { finishIngest, startIngest } from "./docs/uploads";
import { setDoc } from "./docs/store";
import "./runtime";

const asSteps = (step: unknown) => step as Steps;

export const canvasRun = inngest.createFunction(
  { id: "edge-canvas-run", triggers: { event: "edge/canvas.run" }, concurrency: 3, retries: 2 },
  async ({ event, step }) => {
    await executeRun(Number((event.data as { runId: number }).runId), asSteps(step), "inngest");
    return { runId: (event.data as { runId: number }).runId };
  },
);

export const monitorsTick = inngest.createFunction(
  { id: "edge-monitors-tick", triggers: { cron: "20 * * * *" }, concurrency: 1, retries: 1 },
  async ({ step }) => metered(asSteps(step)).run("tick", () => tickMonitors(Date.now() + 200_000)),
);

export const detectionRefine = inngest.createFunction(
  { id: "edge-detection-refine", triggers: { event: "edge/detection.created" }, concurrency: 2, retries: 1 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const started = await s.run("start", () => startRefine(Number((event.data as { id: number }).id)));
    if (!started) return { skipped: true };
    const ev = await s.waitForEvent("wait-ml", { event: "edge/ml.done", timeout: "20m", if: doneFor(started.callId) });
    if (!ev) return { timedOut: true };
    return s.run("apply", async () => {
      const done = ev.data as MlDone;
      noteMlCost(done.costUsd);
      const r = await applyRefinement(started.id, done);
      await flushUsage();
      return r;
    });
  },
);

/** Read an uploaded document or recording: parse or transcribe on the ML service, then embed the passages. */
export const docIngest = inngest.createFunction(
  { id: "edge-doc-ingest", triggers: { event: "edge/doc.uploaded" }, concurrency: 2, retries: 1 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const docId = Number((event.data as { docId: number }).docId);
    const first = await s.run("start", async () => {
      try { return await startIngest(docId); }
      catch (e) { await setDoc(docId, { status: "failed", error: String((e as Error).message ?? e).slice(0, 300) }); return { done: true as const }; }
    });
    if ("done" in first) return { docId, done: true };
    const ev = await s.waitForEvent("wait-ml", { event: "edge/ml.done", timeout: first.wait.task === "audio.transcribe" ? "60m" : "20m", if: doneFor(first.wait.callId) });
    return s.run("finish", async () => {
      const done = (ev?.data as MlDone | undefined) ?? null;
      noteMlCost(done?.costUsd);
      await finishIngest(docId, done);
      await flushUsage();
      return { docId };
    });
  },
);

/** Ingest companies a slice at a time (each slice fits one function call), until done or stuck. */
async function ingestLoop(s: Steps, ciks: string[], maxSlices: number) {
  let left = ciks, done = 0, cards = 0;
  for (let i = 0; left.length && i < maxSlices; i++) {
    const r = await s.run(`ingest-${i}`, async () => { const x = await ingestSlice(left, Date.now() + 230_000); await flushUsage(); return x; });
    left = r.left; done += r.done; cards += r.cards;
    if (!r.done) break;
  }
  return { done, left: left.length, cards };
}

/** Sundays (or on request): re-read what is new for every company in the universe, fold in the Newsroom's deals, then retrain. */
export const graphRefresh = inngest.createFunction(
  { id: "edge-graph-refresh", triggers: [{ cron: "0 4 * * 0" }, { event: "edge/graph.refresh" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(asSteps(step));
    const ciks = await s.run("universe", async () => (await graphUniverse()).map((m) => m.cik));
    const res = await ingestLoop(s, ciks, 150);
    await s.run("newsroom-deals", () => newsroomDeals());
    await s.run("train", () => sendJob("edge/graph.train", { reason: "weekly" }, { id: `edge-graph-train-${new Date().toISOString().slice(0, 10)}` }));
    return res;
  },
);

/** A company someone asked about (or newly watches): build its corner of the graph now. */
export const graphIngest = inngest.createFunction(
  { id: "edge-graph-ingest", triggers: { event: "edge/graph.ingest" }, concurrency: 2, retries: 1 },
  async ({ event, step }) => ingestLoop(metered(asSteps(step)), ((event.data as { ciks?: string[] }).ciks ?? []).map(String).slice(0, 60), 30),
);

/** Train the deal model on the ML service and store its scorecard and predictions. */
export const graphTrain = inngest.createFunction(
  { id: "edge-graph-train", triggers: { event: "edge/graph.train" }, concurrency: 1, retries: 0 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const started = await s.run("start", () => startTraining(String((event.data as { reason?: string }).reason ?? "")));
    if ("skipped" in started) return started;
    const ev = await s.waitForEvent("wait-ml", { event: "edge/ml.done", timeout: "45m", if: doneFor(started.callId) });
    return s.run("finish", async () => {
      const done = (ev?.data as MlDone | undefined) ?? null;
      noteMlCost(done?.costUsd);
      const r = await finishTraining(started.modelId, done);
      const cards = r.ok ? await predictionCards() : [];
      if (cards.length) await notifyWatchers(cards).catch(() => undefined);
      await flushUsage();
      return { ...r, cards: cards.length };
    });
  },
);

/** Refine a scenario: ten thousand statistical paths, or two thousand from the diffusion model on the ML service. */
export const scenarioRefine = inngest.createFunction(
  { id: "edge-scenario-refine", triggers: { event: "edge/scenario.refine" }, concurrency: 2, retries: 1 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const { id, userId } = event.data as { id: number; userId: string };
    const started = await s.run("start", () => startScenario(userId, Number(id)));
    if ("done" in started) return { id, done: true };
    const ev = await s.waitForEvent("wait-ml", { event: "edge/ml.done", timeout: "20m", if: doneFor(started.callId) });
    return s.run("finish", async () => { const done = (ev?.data as MlDone | undefined) ?? null; noteMlCost(done?.costUsd); await finishScenario(userId, Number(id), done); await flushUsage(); return { id }; });
  },
);

export const functions = [canvasRun, monitorsTick, detectionRefine, docIngest, graphRefresh, graphIngest, graphTrain, scenarioRefine];
