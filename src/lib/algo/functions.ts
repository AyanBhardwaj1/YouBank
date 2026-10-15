/**
 * Algo trading's background work on Inngest (served at /api/inngest with Edge's functions).
 *
 * `algo-tick`: every 15 minutes (and on the "algo/tick" event), the strategies whose tick is due, oldest
 * first, at most 24 a run, four to a step. Each step works to a deadline well inside the function's time
 * and ticks its strategies one after another, so a run holds at most one or two of the instance's six
 * postgres.js connections at a time and every query is short (well under the 30-second statement
 * timeout). A tick does nothing outside its schedule (schedule.ts: market hours for equities), so most
 * runs only read the due list. Nothing here calls a model, and free strategies never open a premium scope.
 */
import { inngest, metered, type Steps } from "@/lib/edge/infra/jobs";
import { dueStrategies, tickStrategy, type TickResult } from "./tick";

const PER_RUN = 24, PER_STEP = 4;

export const algoTick = inngest.createFunction(
  { id: "algo-tick", triggers: [{ cron: "*/15 * * * *" }, { event: "algo/tick" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(step as unknown as Steps);
    const ids = await s.run("due", () => dueStrategies(PER_RUN));
    const results: TickResult[] = [];
    for (let i = 0; i < ids.length; i += PER_STEP) {
      const part = ids.slice(i, i + PER_STEP);
      const r = await s.run(`tick-${i / PER_STEP}`, async () => {
        const deadline = Date.now() + 200_000;
        const out: TickResult[] = [];
        for (const id of part) {
          if (Date.now() > deadline - 30_000) break;
          out.push(await tickStrategy(id, Math.min(deadline, Date.now() + 90_000)));
        }
        return out;
      });
      results.push(...r);
    }
    return { due: ids.length, ticked: results.length, sent: results.reduce((n, r) => n + r.sent, 0), proposed: results.filter((r) => r.proposed).length };
  },
);

export const algoFunctions = [algoTick];
