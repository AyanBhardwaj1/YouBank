/**
 * Edge's next features in the daily pass (/api/cron/edge): settle the forecasts whose questions can be
 * answered now (F3), prune the signal store to its retention (F2, on Sundays), and the features' own daily
 * slices, added by each feature below. Each part runs within its share of the pass's time and reports
 * what it did; one part failing never stops the others. Background work here never opens a premium scope.
 */
import { describeFailure } from "@/lib/errors";
import { dealsDaily } from "./deals/jobs";
import { resolveDue } from "./forecasts/ledger";
import { jobsReady } from "./infra/jobs";
import { pulseDaily } from "./pulse/jobs";
import { oddsDaily } from "./odds/score";
import { pruneSeries } from "./series/store";
import { callsDaily } from "./calls/store";
import { ticksDue } from "./agent/store";

export type NextDaily = Record<string, unknown> & { created: number[] };

async function part<T>(name: string, out: Record<string, unknown>, fn: () => Promise<T>): Promise<T | null> {
  try { const r = await fn(); out[name] = r; return r; }
  catch (e) { out[name] = { error: describeFailure(e, 500, `edge-next-${name}`).message }; return null; }
}

export async function dailyNext(deadline: number, now = new Date()): Promise<NextDaily> {
  const out: NextDaily = { created: [] };
  await part("forecasts", out, () => resolveDue(Math.min(deadline, Date.now() + 40_000), now));
  // E1: the day's new merger documents (free); read them too when reading is on and Inngest is not there to.
  await part("deals", out, () => dealsDaily(Math.min(deadline, Date.now() + 70_000), { slice: !jobsReady() }));
  // E3: daily lists (premium perk, plan re-checked) and watched companies not read for a week; free sources only.
  const pulse = await part("pulse", out, () => pulseDaily(Math.min(deadline, Date.now() + 60_000)));
  if (pulse) out.created.push(...pulse.created);
  // E4: watched companies' filings re-read and their sale odds re-scored (cards and forecasts follow).
  const odds = await part("odds", out, () => oddsDaily(Math.min(deadline, Date.now() + 50_000)));
  if (odds) out.created.push(...odds.created);
  // E5: watched companies' filed releases and transcripts read for Call Desk; promises due within 30 days and those just settled carded.
  const calls = await part("calls", out, () => callsDaily(Math.min(deadline, Date.now() + 50_000)));
  if (calls) out.created.push(...calls.created);
  // E7: theses whose tick is due, here only when Inngest is not there to run them hourly.
  if (!jobsReady()) await part("agents", out, () => ticksDue(Math.min(deadline, Date.now() + 60_000)));
  if (now.getUTCDay() === 0) await part("prune", out, async () => ({ series: await pruneSeries(now) }));
  return out;
}
