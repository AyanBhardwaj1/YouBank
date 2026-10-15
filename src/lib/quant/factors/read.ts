/**
 * QF4 readers: the factor returns a feature uses for a window, the stored exposures and crowding. YouBank's own
 * factors when they cover the window; otherwise the ETF-proxy tier, labelled. Server only.
 */
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getJson, r2Ready } from "@/lib/edge/infra/r2";
import { UNIVERSE } from "../pit/universe";
import { crowdingNow, type CrowdingNow, type CrowdingPoint } from "./crowding";
import { ENGINE_VERSION, FACTOR_KEYS, SORTS, type Exposures } from "./engine";
import { etfFactorPanel, ETF_FACTORS, type FactorPanel } from "./etf";

export const YB_LABELS: Record<string, string> = { MKT: "Market", SMB: "Size (small minus big)", ...Object.fromEntries(SORTS.map((s) => [s.key, s.label])) };
export const ETF_LABELS: Record<string, string> = Object.fromEntries(ETF_FACTORS.map((f) => [f.key, f.label]));

/** YouBank's stored factor returns between two dates (inclusive), as a panel. */
export async function ybFactorPanel(from: string, to?: string): Promise<FactorPanel | null> {
  const rows = await requireDb().select({ date: schema.quantFactorReturns.date, factor: schema.quantFactorReturns.factor, ret: schema.quantFactorReturns.ret })
    .from(schema.quantFactorReturns).where(and(eq(schema.quantFactorReturns.universe, UNIVERSE), eq(schema.quantFactorReturns.version, ENGINE_VERSION), gte(schema.quantFactorReturns.date, from), to ? lte(schema.quantFactorReturns.date, to) : undefined))
    .orderBy(asc(schema.quantFactorReturns.date)).limit(80_000);
  if (!rows.length) return null;
  const by = new Map<string, Record<string, number>>();
  for (const r of rows) { const d = String(r.date); by.set(d, { ...(by.get(d) ?? {}), [r.factor]: r.ret }); }
  const names = [...FACTOR_KEYS];
  const dates = [...by.keys()].filter((d) => names.every((n) => Number.isFinite(by.get(d)![n])));
  return { dates, names, rows: dates.map((d) => names.map((n) => by.get(d)![n])), source: `YouBank factors (${UNIVERSE}, ${ENGINE_VERSION}): 2x3 value-weighted sorts on SEC fundamentals as known then and daily prices; survivorship-biased beta universe`, version: ENGINE_VERSION, missing: [] };
}

/**
 * Factor returns for [from, today]: YouBank's when they cover at least 90% of the sessions the ETF tier has,
 * else the ETF proxies. Both are labelled with their source.
 */
export async function factorPanel(from: string): Promise<FactorPanel & { tier: "youbank" | "etf" }> {
  const [yb, etf] = await Promise.all([ybFactorPanel(from).catch(() => null), etfFactorPanel(from)]);
  if (yb && etf.dates.length && yb.dates.length >= 0.9 * etf.dates.length) return { ...yb, tier: "youbank" };
  return { ...etf, tier: "etf" };
}

/** The cross-sectional model's latest exposures (R2), or null before the first build. */
export async function storedExposures(): Promise<Exposures | null> {
  if (!r2Ready()) return null;
  return getJson<Exposures>(`quant/exposures/${UNIVERSE}/latest.json`).catch(() => null);
}

/** The latest crowding readings with percentiles of their own history. */
export async function crowding(): Promise<CrowdingNow[]> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, "quant.crowding"));
  const points = ((r?.state as { points?: CrowdingPoint[] } | undefined)?.points ?? []);
  return crowdingNow(points);
}

/** When YouBank's factors were last built and how much history they hold. */
export async function factorStatus(): Promise<{ youbank: { from: string | null; to: string | null; days: number }; version: string }> {
  const r = (await requireDb().execute(sql`select min(date)::text as a, max(date)::text as b, count(distinct date)::int as n from quant_factor_returns where universe = ${UNIVERSE} and version = ${ENGINE_VERSION}`)).rows[0] as { a: string | null; b: string | null; n: number } | undefined;
  return { youbank: { from: r?.a ?? null, to: r?.b ?? null, days: Number(r?.n ?? 0) }, version: ENGINE_VERSION };
}
