/**
 * Algo trading's background work on Inngest (served at /api/inngest with Edge's functions).
 *
 * `algo-tick`: every 15 minutes (and on the "algo/tick" event), the strategies whose tick is due, oldest
 * first, twelve to a step, step after step until none is due (at most 40 steps, 480 strategies, a run).
 * Within a step, different people's strategies tick side by side (four people at a time) and one
 * person's strategies one after another, so nothing about one account (its cash, its risk limits, its
 * broker) is ever ticked twice at once, while hundreds of people's paper strategies at the open no longer
 * wait hours in a queue of four a step. Each step reads the due list itself (a tick moves its strategy's
 * next time on, so no step repeats another's) and works to a deadline well inside the function's time,
 * so a run holds at most four of the instance's postgres.js connections (DB_POOL_MAX) at a time and every
 * query is short (well under the 30-second statement timeout). A retried step ticks only what is still
 * due. A tick does nothing outside its schedule (schedule.ts: market hours for equities), so most runs
 * only read the due list. Nothing here calls a model, and free strategies never open a premium scope.
 */
import { inngest, metered, type Steps } from "@/lib/edge/infra/jobs";
import { pool } from "@/lib/pool";
import { dueStrategyOwners, tickStrategy, type TickResult } from "./tick";

const PER_STEP = 12, MAX_STEPS = 40, PEOPLE_AT_ONCE = 4;

/** Due strategies grouped by owner, in the order they came (oldest due first). Pure. */
export function byOwner(due: { id: number; userId: string }[]): number[][] {
  const groups = new Map<string, number[]>();
  for (const d of due) groups.set(d.userId, [...(groups.get(d.userId) ?? []), d.id]);
  return [...groups.values()];
}

export const algoTick = inngest.createFunction(
  { id: "algo-tick", triggers: [{ cron: "*/15 * * * *" }, { event: "algo/tick" }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(step as unknown as Steps);
    const results: TickResult[] = [];
    // The loop depends only on the steps' recorded results, so Inngest's replays take the same path.
    for (let i = 0; i < MAX_STEPS; i++) {
      const r = await s.run(`tick-${i}`, async () => {
        const deadline = Date.now() + 200_000;
        const groups = byOwner(await dueStrategyOwners(PER_STEP));
        const perOwner = await pool(groups, PEOPLE_AT_ONCE, async (ids) => {
          const out: TickResult[] = [];
          for (const id of ids) {
            if (Date.now() > deadline - 30_000) break;
            out.push(await tickStrategy(id, Math.min(deadline, Date.now() + 90_000)));
          }
          return out;
        }, deadline - 30_000);
        return perOwner.flat();
      });
      results.push(...r);
      // Nothing more is due (or what is due is being ticked elsewhere): the run is done.
      if (r.length < PER_STEP || r.every((x) => x.skipped === "already ticking" || x.skipped === "not due")) break;
    }
    return { ticked: results.length, sent: results.reduce((n, r) => n + r.sent, 0), proposed: results.filter((r) => r.proposed).length };
  },
);

export const algoFunctions = [algoTick];
