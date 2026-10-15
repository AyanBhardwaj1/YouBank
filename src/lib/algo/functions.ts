/**
 * Algo trading's background work on Inngest (served at /api/inngest with Edge's functions).
 *
 * `algo-tick`: every 15 minutes (and on the "algo/tick" event), the strategies whose tick is due, oldest
 * first, four to a step, step after step until none is due (at most 30 steps, 120 strategies, a run).
 * Each step reads the due list itself (a tick moves its strategy's next time on, so no step repeats
 * another's) and works to a deadline well inside the function's time, ticking its strategies one after
 * another, so a run holds at most one or two of the instance's six postgres.js connections at a time and
 * every query is short (well under the 30-second statement timeout). A retried step ticks only what is
 * still due. A tick does nothing outside its schedule (schedule.ts: market hours for equities), so most
 * runs only read the due list. Nothing here calls a model, and free strategies never open a premium scope.
 */
import { inngest, metered, type Steps } from "@/lib/edge/infra/jobs";
import { dueStrategies, tickStrategy, type TickResult } from "./tick";

const PER_STEP = 4, MAX_STEPS = 30;

export const algoTick = inngest.createFunction(
  { id: "algo-tick", triggers: [{ cron: "*/15 * * * *" }, { event: "algo/tick" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(step as unknown as Steps);
    const results: TickResult[] = [];
    // The loop depends only on the steps' recorded results, so Inngest's replays take the same path.
    for (let i = 0; i < MAX_STEPS; i++) {
      const r = await s.run(`tick-${i}`, async () => {
        const deadline = Date.now() + 200_000;
        const out: TickResult[] = [];
        for (const id of await dueStrategies(PER_STEP)) {
          if (Date.now() > deadline - 30_000) break;
          out.push(await tickStrategy(id, Math.min(deadline, Date.now() + 90_000)));
        }
        return out;
      });
      results.push(...r);
      // Nothing more is due (or what is due is being ticked elsewhere): the run is done.
      if (r.length < PER_STEP || r.every((x) => x.skipped === "already ticking" || x.skipped === "not due")) break;
    }
    return { ticked: results.length, sent: results.reduce((n, r) => n + r.sent, 0), proposed: results.filter((r) => r.proposed).length };
  },
);

export const algoFunctions = [algoTick];
