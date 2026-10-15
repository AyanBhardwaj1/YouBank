/**
 * QF5 on the server: event definitions (the catalog), running a study over stored events and the bar store,
 * and the base-rate store every signal cites (quant_base_rates). A signal never appears without its base rate
 * (rule 4), so producers look one up here and publish nothing until it exists.
 */
import { eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { barReturns, loadBars } from "../pit/bars";
import { eventStudy, type Series, type Study, type StudyEvent, type WindowStats } from "./study";

export const STUDY_VERSION = "qf5-2026-10-15.1";
export const MARKET = "SPY";

/** Event definitions: what each event is, its primary window and the era breaks its base rates are split by. */
export const CATALOG: Record<string, { label: string; primary: string; eras: string[]; horizonDays: number; source: string }> = {
  cluster_buy: { label: "Insider cluster purchase", primary: "+2..+125", eras: ["2015-01-01", "2020-01-01"], horizonDays: 125, source: "SEC Form 4 (open-market purchases, code P)" },
  large_officer_buy: { label: "Large CEO or CFO purchase", primary: "+2..+125", eras: ["2015-01-01", "2020-01-01"], horizonDays: 125, source: "SEC Form 4 (open-market purchases, code P)" },
  cluster_sell: { label: "Insider cluster sale", primary: "+2..+125", eras: ["2015-01-01", "2020-01-01"], horizonDays: 125, source: "SEC Form 4 (open-market sales, code S)" },
  activist_new: { label: "New Schedule 13D", primary: "+2..+125", eras: ["2015-01-01", "2024-02-05"], horizonDays: 125, source: "SEC Schedule 13D (the 2024 deadline change splits the eras)" },
  activist_up: { label: "Schedule 13D amendment adding a stake", primary: "+2..+60", eras: ["2015-01-01", "2024-02-05"], horizonDays: 60, source: "SEC Schedule 13D/A" },
  hiring_shift: { label: "Pulse: hiring change point", primary: "+2..+60", eras: [], horizonDays: 60, source: "Edge Pulse (job postings)" },
  attention_spike: { label: "Pulse: attention change point", primary: "+2..+60", eras: [], horizonDays: 60, source: "Edge Pulse (Wikipedia page views)" },
  patent_shift: { label: "Pulse: patent grants change point", primary: "+2..+60", eras: [], horizonDays: 60, source: "Edge Pulse (patent grants)" },
};

export type BaseRate = { key: string; eventType: string; version: string; computedAt: string; universe: string; survivorship: boolean; primary: WindowStats; study: Omit<Study, "events"> & { eventIds: string[] } };

export const baseRateKey = (eventType: string) => `${eventType}:${STUDY_VERSION}`;

export async function baseRateFor(eventType: string): Promise<BaseRate | null> {
  const [row] = await requireDb().select().from(schema.quantBaseRates).where(eq(schema.quantBaseRates.key, baseRateKey(eventType)));
  return row ? (row.body as unknown as BaseRate) : null;
}

/** The QuantSignal `event.baseRate` from a stored base rate, or null when it is not usable (too few events). */
export function signalBaseRate(b: BaseRate | null, minN = 30): { car: number; low: number; high: number; hitRate: number; unconditionalHitRate: number; n: number; window: string; era: string } | null {
  if (!b) return null;
  const p = b.primary;
  if (!(p.n >= minN) || ![p.car, p.low, p.high, p.hitRate, p.unconditionalHitRate].every(Number.isFinite)) return null;
  return { car: p.car, low: Math.min(p.low, p.car), high: Math.max(p.high, p.car), hitRate: p.hitRate, unconditionalHitRate: p.unconditionalHitRate, n: p.n, window: p.window, era: b.study.era };
}

/** Daily returns for symbols, from the bar store (or a live read), six at a time, within a deadline. */
export async function returnsFor(symbols: string[], from: string, deadline: number): Promise<Map<string, Series>> {
  const out = new Map<string, Series>();
  const list = [...new Set(symbols)];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, async () => {
    while (i < list.length && Date.now() < deadline) {
      const s = list[i++];
      const b = await loadBars(s, from).catch(() => null);
      if (b?.bars.c.length) out.set(s, barReturns(b.bars));
    }
  }));
  return out;
}

/** Run and store the study for one event type over the given events. */
export async function computeBaseRate(eventType: string, events: StudyEvent[], deadline: number): Promise<BaseRate | { error: string }> {
  const def = CATALOG[eventType];
  if (!def) return { error: `Unknown event type ${eventType}` };
  if (events.length < 10) return { error: `Only ${events.length} ${def.label.toLowerCase()} events are stored; base rates wait for at least 10 (30 to publish).` };
  const from = new Date(Date.parse(events.map((e) => e.knownAt).sort()[0]) - 400 * 86_400_000).toISOString().slice(0, 10);
  const stocks = await returnsFor([MARKET, ...events.map((e) => e.symbol)], from, deadline);
  const market = stocks.get(MARKET);
  if (!market) return { error: "No market series (SPY) is available right now." };
  const study = eventStudy(events, stocks, market, { eras: def.eras, primary: def.primary });
  const primary = study.windows.find((w) => w.window === study.primary)!;
  const { events: rs, ...rest } = study;
  const body: BaseRate = { key: baseRateKey(eventType), eventType, version: STUDY_VERSION, computedAt: new Date().toISOString(), universe: "events on stored filings; prices from the beta store", survivorship: true, primary, study: { ...rest, eventIds: rs.map((r) => r.id).slice(0, 5_000) } };
  await requireDb().insert(schema.quantBaseRates).values({ key: body.key, eventType, version: STUDY_VERSION, body: body as unknown as Record<string, unknown>, computedAt: new Date() })
    .onConflictDoUpdate({ target: schema.quantBaseRates.key, set: { body: body as unknown as Record<string, unknown>, computedAt: new Date() } });
  return body;
}

/** Stored events of a type as study inputs (most recent first, bounded). */
export async function storedEvents(type: string, limit = 3_000): Promise<StudyEvent[]> {
  const rows = (await requireDb().execute(sql`select id, symbol, accepted_at, body from quant_events where type = ${type} and symbol <> '' order by accepted_at desc limit ${limit}`)).rows as { id: string; symbol: string; accepted_at: Date | string; body: Record<string, unknown> }[];
  return rows.map((r) => ({ id: r.id, symbol: r.symbol, knownAt: new Date(r.accepted_at).toISOString(), size: typeof r.body?.marketCap === "number" ? (r.body.marketCap as number) : null, costBps: typeof r.body?.costBps === "number" ? (r.body.costBps as number) : null }));
}
