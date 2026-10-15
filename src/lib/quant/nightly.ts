/**
 * The nightly quant pass (Inngest `quant/nightly`, weekdays after the US close; /api/cron/quant runs the same
 * slices inline when Inngest is not set up): the universe (Mondays, or when empty), bars for the universe and
 * the factor funds in slices, fundamentals for 40 members, YouBank's factor build, the 13F targets and the
 * signal producers; base rates once a week. Free data only; background work never opens a premium scope.
 * Every part runs within its share of the time and reports what it did; one failing never stops the others.
 */
import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { r2Ready } from "@/lib/edge/infra/r2";
import { describeFailure } from "@/lib/errors";
import { CURATED } from "@/lib/copytrade/funds";
import { publishOddsSignals, publishPulseSignals } from "./adapters/edge";
import { syncCopyTarget, syncFundTarget } from "./adapters/copy13f";
import { CATALOG, computeBaseRate, storedEvents } from "./events/rates";
import { buildFactors, refreshFactsSlice } from "./factors/build";
import { publishEventCards } from "./insiders/cards";
import { pollInsiders, publishInsiderSignals } from "./insiders/store";
import { refreshBars } from "./pit/bars";
import { members, refreshUniverse } from "./pit/universe";

export const FACTOR_FUNDS = ["SPY", "BIL", "IWM", "IWB", "IWD", "IWF", "MTUM", "QUAL", "USMV", "IEF"];
const BACKFILL_FROM = "2005-01-01";

async function part<T>(name: string, out: Record<string, unknown>, fn: () => Promise<T>): Promise<T | null> {
  try { const r = await fn(); out[name] = r; return r; }
  catch (e) { out[name] = { error: describeFailure(e, 500, `quant-nightly-${name}`).message }; return null; }
}

async function cursor(name: string): Promise<number> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, name));
  return Number((r?.state as { at?: number } | undefined)?.at ?? 0);
}
async function setCursor(name: string, at: number) {
  await requireDb().insert(schema.edgeJobState).values({ name, state: { at } }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state: { at }, updatedAt: new Date() } });
}

/** One slice of bar refreshes: `n` symbols from the cursor (factor funds first), six at a time. */
export async function barsSlice(n: number, deadline: number): Promise<{ refreshed: number; next: number; total: number; reason?: string }> {
  if (!r2Ready()) return { refreshed: 0, next: 0, total: 0, reason: "R2 is not configured: bars are read live instead of stored." };
  const list = [...FACTOR_FUNDS, ...(await members()).map((m) => m.symbol)];
  const total = list.length;
  let at = await cursor("quant.bars");
  if (at >= total) at = 0;
  const slice = list.slice(at, at + n);
  let i = 0, refreshed = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < slice.length && Date.now() < deadline) { const s = slice[i++]; if ((await refreshBars(s, BACKFILL_FROM).catch(() => null)) !== null) refreshed++; }
  }));
  const next = at + i >= total ? 0 : at + i;
  await setCursor("quant.bars", next);
  return { refreshed, next, total };
}

/** Base rates for every event type with enough stored events. */
export async function baseRatesPass(deadline: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const type of Object.keys(CATALOG)) {
    if (Date.now() > deadline) break;
    const events = await storedEvents(type).catch(() => []);
    const r = events.length >= 10 ? await computeBaseRate(type, events, Math.min(deadline, Date.now() + 60_000)).catch((e) => ({ error: describeFailure(e, 500, "quant-base-rate").message })) : { error: `${events.length} events` };
    out[type] = "error" in r ? r.error : { n: r.primary.n, car: r.primary.car };
  }
  return out;
}

/** The 13F targets: curated funds (impersonal) and every active copy (owner-scoped), at most `max`. */
export async function targetsPass(deadline: number, max = 200): Promise<{ funds: number; copies: number }> {
  let funds = 0, copies = 0;
  for (const f of CURATED) { if (Date.now() > deadline) break; if ((await syncFundTarget(f.cik).catch(() => null))?.saved) funds++; }
  const rows = await requireDb().select({ id: schema.copyPortfolios.id, userId: schema.copyPortfolios.userId }).from(schema.copyPortfolios).where(and(eq(schema.copyPortfolios.status, "active"), sql`true`)).limit(max);
  for (const r of rows) { if (Date.now() > deadline) break; if ((await syncCopyTarget(r.userId, r.id).catch(() => null))?.saved) copies++; }
  return { funds, copies };
}

/** The whole pass inline, within `deadline` (the cron route without Inngest). */
export async function nightlyInline(deadline: number, now = new Date()): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const left = () => deadline - Date.now();
  const universeEmpty = !(await members(1).catch(() => [])).length;
  if (universeEmpty || now.getUTCDay() === 1) await part("universe", out, () => refreshUniverse(Date.now() + Math.min(60_000, left() / 4)));
  await part("bars", out, () => barsSlice(300, Date.now() + Math.min(90_000, left() / 3)));
  await part("facts", out, () => refreshFactsSlice(40, Date.now() + Math.min(40_000, left() / 4)));
  if (left() > 60_000) await part("factors", out, () => buildFactors(Date.now() + Math.min(90_000, left() - 30_000)));
  if (now.getUTCDay() === 0 && left() > 30_000) await part("baseRates", out, () => baseRatesPass(Date.now() + Math.min(60_000, left() - 20_000)));
  if (left() > 20_000) await part("targets", out, () => targetsPass(Date.now() + Math.min(40_000, left() - 15_000)));
  if (left() > 10_000) await part("insiders", out, () => pollInsiders(Date.now() + Math.min(30_000, left() - 8_000)));
  if (left() > 8_000) await part("cards", out, () => publishEventCards(Date.now() + Math.min(15_000, left() - 6_000)));
  if (left() > 5_000) await part("signals", out, async () => ({ insiders: await publishInsiderSignals(Date.now() + 20_000).catch(() => null), pulse: await publishPulseSignals().catch(() => null), odds: await publishOddsSignals().catch(() => null) }));
  return out;
}
