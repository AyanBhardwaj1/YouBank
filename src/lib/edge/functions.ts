/**
 * Edge's background functions on Inngest (served at /api/inngest): canvas runs, the hourly monitor
 * tick, the foundation-model check of every new ground change, reading uploaded documents, and the
 * relationship graph (the weekly refresh, on-demand builds, and training the deal model). Each step
 * counts toward the free tier's executions (see infra/jobs). Scheduled functions never open a premium
 * scope, so they only ever use the free methods; the paid steps here (a premium reading, a GPU
 * retraining) run only because a person asked, and re-check that person's plan first.
 */
import { executeRun } from "./canvas/engine";
import { backfillSlice } from "./deals/jobs";
import { measurePlacebo, seedStartups, setWeeklyCursor, weeklyCursor, weeklyStep } from "./pulse/jobs";
import { finalize as oddsFinalize, scoreSlice } from "./odds/score";
import { getPipeline, pipelineStep, setPipeline, startPipeline } from "./odds/train";
import { newsroomDeals } from "./graph/deals";
import { ingestSlice, predictionCards } from "./graph/jobs";
import { finishTraining, startTraining } from "./graph/train";
import { graphUniverse } from "./graph/universe";
import { finishRefine as finishScenario, startRefine as startScenario } from "./scen/run";
import { finishLabRefine, startLabRefine } from "./scen/lab";
import { dueAgents, tickAgent } from "./agent/store";
import { updateScenario } from "./scen/store";
import { sendDigests } from "./digest";
import { notifyWatchers } from "./notify";
import { inngest, metered, sendJob, type Steps } from "./infra/jobs";
import { doneFor, noteMlCost, type MlDone } from "./infra/ml";
import { flushUsage } from "./infra/usage";
import { tickMonitors } from "./monitors";
import { applyRefinement, startRefine } from "./refine";
import { finishIngest, startIngest } from "./docs/uploads";
import { setDoc } from "./docs/store";
import { premiumReadFor, runPremiumRead } from "./premium/reading";
import { upgradeOn } from "./premium";
import { canUseById } from "@/lib/billing/use";
import "./runtime";
import { failureMessage } from "@/lib/errors";

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

/** Each person's daily digest, at their morning brief's hour. */
export const digestTick = inngest.createFunction(
  { id: "edge-digest", triggers: { cron: "35 * * * *" }, concurrency: 1, retries: 1 },
  async ({ step }) => metered(asSteps(step)).run("send", () => sendDigests(Date.now() + 200_000)),
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
    // A premium reading the owner chose for this document (LlamaParse, speaker labels), re-checked
    // against their plan first; it falls back to the free reader below when it cannot run.
    const premium = await s.run("premium-check", () => premiumReadFor(docId));
    if (premium && (await runPremiumRead(docId, premium, s)) === "done") return { docId, premium };
    const first = await s.run("start", async () => {
      try { return await startIngest(docId); }
      catch (e) { await setDoc(docId, { status: "failed", error: failureMessage(e, "edge-doc-ingest").slice(0, 300) }); return { done: true as const }; }
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
    const data = event.data as { reason?: string; gpu?: boolean; by?: string };
    // A GPU run only when a person asked (the route checked their plan) and it still holds: their plan, and the setup.
    const gpu = await s.run("gpu-check", async () => data.gpu === true && !!data.by && upgradeOn("graph-gpu") && (await canUseById(data.by, "edge.graph-gpu")));
    const started = await s.run("start", () => startTraining(String(data.reason ?? ""), { gpu }));
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

/**
 * Refine an LBO stress test (E6, premium edge.lbo-refine): the person's plan is re-checked first (they asked
 * when they pressed Refine); 20,000 paths on the ML service, or here when it is not set up.
 */
export const lboRefine = inngest.createFunction(
  { id: "edge-lbo-refine", triggers: { event: "edge/lbo.refine" }, concurrency: 2, retries: 0 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const { id, userId } = event.data as { id: number; userId: string };
    const allowed = await s.run("plan-check", () => canUseById(userId, "edge.lbo-refine"));
    if (!allowed) { await s.run("refused", () => updateScenario(Number(id), { status: "preview" })); return { id, refused: true }; }
    const started = await s.run("start", async () => {
      try { return await startLabRefine(userId, Number(id)); }
      catch (e) { await updateScenario(Number(id), { status: "preview" }); throw e; }
    });
    if ("done" in started) return { id, done: true };
    const ev = await s.waitForEvent("wait-ml", { event: "edge/ml.done", timeout: "20m", if: doneFor(started.callId) });
    return s.run("finish", async () => { const done = (ev?.data as MlDone | undefined) ?? null; noteMlCost(done?.costUsd); await finishLabRefine(userId, Number(id), started.specKey, done); await flushUsage(); return { id }; });
  },
);

/**
 * Thesis Agent ticks (E7): hourly, the theses whose tick is due (four a run), each tick in slices of a few
 * minutes so it fits a step; also on request (a plan just approved, a thesis resumed). A premium thesis
 * re-checks its owner's plan before it ticks; free theses never open a premium scope.
 */
export const agentTick = inngest.createFunction(
  { id: "edge-agent-tick", triggers: [{ cron: "15 * * * *" }, { event: "edge/agent.tick" }], concurrency: 1, retries: 1 },
  async ({ event, step }) => {
    const s = metered(asSteps(step));
    const one = Number((event?.data as { id?: number } | undefined)?.id);
    const ids = Number.isInteger(one) && one > 0 ? [one] : await s.run("due", () => dueAgents(4));
    let ticked = 0;
    for (const id of ids) {
      for (let k = 0; k < 4; k++) {
        const r = await s.run(`tick-${id}-${k}`, async () => { const x = await tickAgent(id, Date.now() + 200_000); await flushUsage(); return x; });
        if (r.done) { ticked++; break; }
      }
    }
    return { ticked };
  },
);

/**
 * The deal database's backfill (E1): daily, and when an administrator asks. Each slice discovers a few months
 * of merger documents (free) and reads unread deals while the day's platform ceiling lasts; it does nothing
 * but discovery while reading is switched off, and stops on the AI caps. Resumes from its cursor.
 */
export const dealsBackfill = inngest.createFunction(
  { id: "edge-deals-backfill", triggers: [{ cron: "40 5 * * *" }, { event: "edge/deals.backfill" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(asSteps(step));
    const slices: Awaited<ReturnType<typeof backfillSlice>>[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await s.run(`slice-${i}`, async () => { const x = await backfillSlice(Date.now() + 230_000); await flushUsage(); return x; });
      slices.push(r);
      if (!r.on || r.error || (!r.read && !r.months.length) || r.budgetLeft < 0.01) break;
    }
    return { slices: slices.length, read: slices.reduce((n, r) => n + r.read, 0), months: slices.flatMap((r) => r.months) };
  },
);

/**
 * The Alt-Data Pulse's weekly pass (E3): new /app/vc startups into the graph, each metric family's placebo
 * false-alarm rate measured, then the universe refreshed 25 companies a step from its cursor. Free sources
 * only; new findings notify their watchers.
 */
export const pulseWeekly = inngest.createFunction(
  { id: "edge-pulse-weekly", triggers: [{ cron: "10 5 * * 0" }, { event: "edge/pulse.weekly" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(asSteps(step));
    await s.run("startups", () => seedStartups(500));
    await s.run("placebo", () => measurePlacebo());
    let cursor = await s.run("cursor", async () => (await weeklyCursor()).after ?? 0);
    let refreshed = 0, created = 0;
    for (let i = 0; i < 60; i++) {
      const r = await s.run(`batch-${i}`, async () => { const x = await weeklyStep(cursor, Date.now() + 230_000); if (x.created.length) await notifyWatchers(x.created).catch(() => undefined); await flushUsage(); return { next: x.next, refreshed: x.refreshed, created: x.created.length }; });
      refreshed += r.refreshed; created += r.created; cursor = r.next;
      await s.run(`save-${i}`, () => setWeeklyCursor(cursor ? { after: cursor } : { after: 0, finishedAt: new Date().toISOString() }));
      if (!cursor) break;
    }
    return { refreshed, created };
  },
);

/** Score the whole universe a slice at a time, then log forecasts for watched companies and the top 200 and post cards. */
async function scoreAll(s: Steps, refresh: boolean) {
  let cursor = 0, scored = 0;
  for (let i = 0; i < 40; i++) {
    const r = await s.run(`score-${i}`, async () => { const x = await scoreSlice(cursor, Date.now() + 230_000, { refresh }); await flushUsage(); return x; });
    scored += r.scored; cursor = r.next;
    if (!cursor) break;
  }
  const cards = await s.run("finalize", async () => { const ids = await oddsFinalize({ top: 200 }); if (ids.length) await notifyWatchers(ids).catch(() => undefined); return ids.length; });
  return { scored, cards };
}

/**
 * The Deal Radar's monthly run (E4): the universe scan, target events, the panel, training (LightGBM on the
 * ML service, or the TypeScript model), then scoring. Resumable: each step advances the pipeline's stage;
 * while the ML service trains, the run sleeps and asks again.
 */
export const oddsRefresh = inngest.createFunction(
  { id: "edge-odds-refresh", triggers: [{ cron: "20 3 2 * *" }, { event: "edge/odds.refresh" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(asSteps(step));
    await s.run("start", async () => { const p = await getPipeline(); return p.stage === "idle" || p.stage === "score" ? startPipeline() : p; });
    for (let i = 0; i < 120; i++) {
      const p = await s.run(`step-${i}`, async () => { const x = await pipelineStep(Date.now() + 230_000); await flushUsage(); return x; });
      if (p.stage === "score" || p.stage === "idle") break;
      if (p.wait) await s.sleep(`wait-${i}`, "2m");
    }
    const p = await s.run("stage", () => getPipeline());
    if (p.stage !== "score") return { stage: p.stage, error: p.lastError ?? null };
    const r = await scoreAll(s, false);
    await s.run("done", () => setPipeline({ ...p, stage: "idle", finishedAt: new Date().toISOString() }));
    return r;
  },
);

/** Weekly re-scoring (E4): every in-scope company's filings re-read (new 13Ds and 8-Ks), scored, forecasts and cards. */
export const oddsWeekly = inngest.createFunction(
  { id: "edge-odds-weekly", triggers: [{ cron: "30 6 * * 1" }, { event: "edge/odds.score" }], concurrency: 1, retries: 1 },
  async ({ step }) => scoreAll(metered(asSteps(step)), true),
);

export const functions = [canvasRun, monitorsTick, digestTick, detectionRefine, docIngest, graphRefresh, graphIngest, graphTrain, scenarioRefine, lboRefine, agentTick, dealsBackfill, pulseWeekly, oddsRefresh, oddsWeekly];
