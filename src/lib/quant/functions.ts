/**
 * Quant Edge's Inngest functions (served at /api/inngest beside Edge's): the nightly pass in resumable steps,
 * and the insider feed every ten minutes of EDGAR's filing day. Scheduled functions never open a premium scope,
 * so they only ever use free data and methods. Each step counts toward Inngest's executions (infra/jobs).
 */
import { inngest, metered, type Steps } from "@/lib/edge/infra/jobs";
import { flushUsage } from "@/lib/edge/infra/usage";
import { publishOddsSignals, publishPulseSignals } from "./adapters/edge";
import { buildFactors, refreshFactsSlice } from "./factors/build";
import { pollInsiders, publishInsiderSignals } from "./insiders/store";
import { QUANT_EVENTS } from "./jobs";
import { barsSlice, baseRatesPass, targetsPass } from "./nightly";
import { members, refreshUniverse } from "./pit/universe";

const asSteps = (step: unknown) => step as Steps;

export const quantNightly = inngest.createFunction(
  { id: "quant-nightly", triggers: [{ cron: "TZ=America/New_York 30 18 * * 1-5" }, { event: QUANT_EVENTS.nightly }], concurrency: 1, retries: 1 },
  async ({ step }) => {
    const s = metered(asSteps(step));
    const empty = await s.run("universe-check", async () => !(await members(1)).length);
    if (empty || new Date().getUTCDay() === 1) await s.run("universe", () => refreshUniverse(Date.now() + 200_000));
    let next = -1, refreshed = 0;
    for (let i = 0; i < 25 && next !== 0; i++) {
      const r = await s.run(`bars-${i}`, async () => { const x = await barsSlice(80, Date.now() + 200_000); await flushUsage(); return x; });
      refreshed += r.refreshed; next = r.next;
      if (r.reason) break;
    }
    const facts = await s.run("facts", () => refreshFactsSlice(40, Date.now() + 200_000));
    const factors = await s.run("factors", () => buildFactors(Date.now() + 220_000));
    const rates = new Date().getUTCDay() === 5 ? await s.run("base-rates", () => baseRatesPass(Date.now() + 220_000)) : null;
    const targets = await s.run("targets", () => targetsPass(Date.now() + 200_000));
    const signals = await s.run("signals", async () => ({ insiders: (await publishInsiderSignals(Date.now() + 100_000)).stored, pulse: (await publishPulseSignals()).stored, odds: (await publishOddsSignals()).stored }));
    return { refreshed, facts, factors, rates, targets, signals };
  },
);

/** EDGAR's latest Form 4 and 13D filings, every ten minutes from 6 am to 10 pm New York time on weekdays. */
export const quantInsidersPoll = inngest.createFunction(
  { id: "quant-insiders-poll", triggers: [{ cron: "TZ=America/New_York */10 6-22 * * 1-5" }, { event: QUANT_EVENTS.insidersPoll }], concurrency: 1, retries: 0 },
  async ({ step }) => metered(asSteps(step)).run("poll", () => pollInsiders(Date.now() + 200_000)),
);

export const quantFunctions = [quantNightly, quantInsidersPoll];
