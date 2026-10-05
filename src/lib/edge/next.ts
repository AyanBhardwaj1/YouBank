/**
 * Edge's next features in the daily pass (/api/cron/edge): settle the forecasts whose questions can be
 * answered now (F3), prune the signal store to its retention (F2, on Sundays), and the features' own daily
 * slices, added by each feature below. Each part runs within its share of the pass's time and reports
 * what it did; one part failing never stops the others. Background work here never opens a premium scope.
 */
import { describeFailure } from "@/lib/errors";
import { resolveDue } from "./forecasts/ledger";
import { pruneSeries } from "./series/store";

export type NextDaily = Record<string, unknown> & { created: number[] };

async function part<T>(name: string, out: Record<string, unknown>, fn: () => Promise<T>): Promise<T | null> {
  try { const r = await fn(); out[name] = r; return r; }
  catch (e) { out[name] = { error: describeFailure(e, 500, `edge-next-${name}`).message }; return null; }
}

export async function dailyNext(deadline: number, now = new Date()): Promise<NextDaily> {
  const out: NextDaily = { created: [] };
  await part("forecasts", out, () => resolveDue(Math.min(deadline, Date.now() + 40_000), now));
  if (now.getUTCDay() === 0) await part("prune", out, async () => ({ series: await pruneSeries(now) }));
  return out;
}
