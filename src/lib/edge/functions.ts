/**
 * Edge's background functions on Inngest (served at /api/inngest): canvas runs, the hourly monitor
 * tick, and the foundation-model check of every new ground change. Each step counts toward the free
 * tier's executions (see infra/jobs).
 */
import { executeRun } from "./canvas/engine";
import { inngest, metered, type Steps } from "./infra/jobs";
import { doneFor, noteMlCost, type MlDone } from "./infra/ml";
import { flushUsage } from "./infra/usage";
import { tickMonitors } from "./monitors";
import { applyRefinement, startRefine } from "./refine";
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

export const functions = [canvasRun, monitorsTick, detectionRefine];
