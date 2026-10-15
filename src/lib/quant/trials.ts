/**
 * QF2/Q3: the trial log. Every backtest anyone runs on a strategy family (a person, the algo engine, an AI
 * agent, a sleeve, a copy-trading clone) is a trial, so the deflated Sharpe ratio counts what was really
 * tried. Nobody types "1". The table is append-only in SQL.
 *
 *   logTrial({ family, params, returns, ... })   store one run (returns in R2, or inline without R2)
 *   familyTrials(family)                        every trial of a family, near-duplicate families included
 *   familyKey(ownerId, codeHash)                the family for a strategy's code and its owner
 *
 * Gaming the count by starting a new family: a new family whose first trial's returns correlate above 0.95
 * with a trial the same owner logged in the last 180 days under another family is marked as an alias of it,
 * and the integrity check reads both.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { getJson, putJson, r2Ready } from "@/lib/edge/infra/r2";
import { corr, moments } from "./stats/core";
import { emit, QUANT_EVENTS } from "./jobs";

export type TrialSource = "algo" | "sleeve" | "upload" | "agent" | "copy";

/** What the producer knows about the backtest's data hygiene (the algo engine sends its read log summary). */
export type TrialHygiene = {
  /** Every signal or fundamental read with when it became public and when the backtest used it. */
  reads?: { key: string; knownAt: string; usedAt: string }[];
  /** Bars between the signal's computation and the trade: 0 means traded on the same bar's close (flagged). */
  executionLagBars?: number;
  /** The universe included securities that later delisted. */
  survivorshipSafe?: boolean;
  universe?: string;
  /** Fundamentals read through the point-in-time asOf ("asof") or the latest restated values ("latest"). */
  fundamentals?: "asof" | "latest" | "none";
  /** Any input from a language model, and that model's training cutoff. */
  llmInputs?: boolean;
  llmCutoff?: string;
  /** Signals backfilled from archives rather than computed live (caps the grade at B). */
  reconstructed?: boolean;
  /** Round-trip cost in basis points the backtest already deducted, and its annual turnover (1 = 100%). */
  costBpsAssumed?: number;
  turnover?: number;
  /** Largest position as a share of 20-day average daily volume at the stated account size. */
  maxAdvShare?: number;
  accountUsd?: number;
  borrowBpsYear?: number;
  /** Walk-forward: the date from which results are out of sample. */
  oosFrom?: string;
  /** Dates of the returns, when given (same length). */
  dates?: string[];
  /** The family this one duplicates (set by logTrial). */
  alias?: string;
};

export type TrialInput = {
  family: string; params: Record<string, unknown>; returns: number[]; ownerId?: string | null; source: TrialSource;
  periodsPerYear?: number; startDate?: string; endDate?: string; hygiene?: TrialHygiene;
};

export type TrialRow = typeof schema.quantTrials.$inferSelect;

/** The family key for a strategy's code (hash) and owner: a renamed copy of the same code stays one family. */
export const familyKey = (ownerId: string | null, codeHash: string) => `strategy:${ownerId ? createHash("sha256").update(ownerId).digest("hex").slice(0, 10) : "shared"}:${codeHash.slice(0, 24)}`;

export const paramsHash = (params: Record<string, unknown>) => createHash("sha256").update(JSON.stringify(params, Object.keys(params).sort())).digest("hex").slice(0, 24);

const MAX_RETURNS = 20_000;

/** Check and clean a trial's input. Pure. */
export function cleanTrial(t: TrialInput): TrialInput {
  if (typeof t.family !== "string" || !/^[A-Za-z0-9:._\-]{3,120}$/.test(t.family)) throw Object.assign(new Error("A trial needs a family like 'algo:strategy:56'."), { status: 400 });
  if (!Array.isArray(t.returns) || t.returns.length < 20) throw Object.assign(new Error("A trial needs at least 20 returns."), { status: 400 });
  if (t.returns.length > MAX_RETURNS) throw Object.assign(new Error(`At most ${MAX_RETURNS.toLocaleString("en-US")} returns per trial.`), { status: 413 });
  if (!t.returns.every((r) => typeof r === "number" && Number.isFinite(r) && r > -1 && r < 10)) throw Object.assign(new Error("Returns must be numbers between -100% and +1,000% per period."), { status: 400 });
  const ppy = t.periodsPerYear ?? 252;
  if (![1, 4, 12, 52, 252, 365].includes(ppy)) throw Object.assign(new Error("periodsPerYear must be 1, 4, 12, 52, 252 or 365."), { status: 400 });
  const h = t.hygiene ?? {};
  return { ...t, periodsPerYear: ppy, params: t.params ?? {}, hygiene: { ...h, reads: h.reads?.slice(0, 5_000), dates: h.dates?.slice(0, MAX_RETURNS) } };
}

export async function logTrial(input: TrialInput): Promise<{ id: number; family: string; alias: string | null; sharpe: number; n: number }> {
  const t = cleanTrial(input);
  const db = requireDb();
  const m = moments(t.returns);
  const sharpe = m.std > 0 ? m.mean / m.std : 0;
  // A brand-new family that duplicates one of the owner's recent families is marked as its alias.
  let alias: string | null = null;
  const [seen] = await db.select({ id: schema.quantTrials.id }).from(schema.quantTrials).where(eq(schema.quantTrials.family, t.family)).limit(1);
  if (!seen) {
    const since = new Date(Date.now() - 180 * 86_400_000);
    const recent = await db.select({ family: schema.quantTrials.family, returnsRef: schema.quantTrials.returnsRef, returns: schema.quantTrials.returns, nObs: schema.quantTrials.nObs })
      .from(schema.quantTrials).where(and(t.ownerId ? eq(schema.quantTrials.ownerId, t.ownerId) : isNull(schema.quantTrials.ownerId), ne(schema.quantTrials.family, t.family), gte(schema.quantTrials.createdAt, since), eq(schema.quantTrials.nObs, t.returns.length)))
      .orderBy(desc(schema.quantTrials.createdAt)).limit(25);
    for (const r of recent) {
      const other = await loadReturns(r);
      if (other && corr(other, t.returns) > 0.95) { alias = r.family; break; }
    }
  }
  const ph = paramsHash(t.params);
  // Re-running the same parameters on the same data is not a new variant: the existing trial stands.
  const [same] = await db.select({ id: schema.quantTrials.id, sharpe: schema.quantTrials.sharpe, alias: sql<string | null>`${schema.quantTrials.hygiene}->>'alias'` }).from(schema.quantTrials)
    .where(and(eq(schema.quantTrials.family, t.family), eq(schema.quantTrials.paramsHash, ph), eq(schema.quantTrials.nObs, m.n), t.ownerId ? eq(schema.quantTrials.ownerId, t.ownerId) : isNull(schema.quantTrials.ownerId))).limit(1);
  if (same && Math.abs((same.sharpe ?? NaN) - sharpe) < 1e-6) return { id: same.id, family: t.family, alias: same.alias, sharpe, n: m.n };
  let returnsRef = "inline";
  let inline: number[] | null = t.returns;
  if (r2Ready()) {
    const key = `quant/trials/${createHash("sha256").update(t.family).digest("hex").slice(0, 16)}/${ph}-${Date.now()}.json`;
    try { await putJson(key, t.returns); returnsRef = `r2:${key}`; inline = null; } catch { /* keep inline */ }
  }
  const [row] = await db.insert(schema.quantTrials).values({
    ownerId: t.ownerId ?? null, family: t.family, params: t.params, paramsHash: ph, returnsRef, returns: inline,
    startDate: t.startDate ?? null, endDate: t.endDate ?? null, periodsPerYear: t.periodsPerYear ?? 252,
    sharpe, nObs: m.n, skew: m.skew, kurt: m.kurt, hygiene: { ...(t.hygiene ?? {}), ...(alias ? { alias } : {}) } as Record<string, unknown>, source: t.source,
  }).returning({ id: schema.quantTrials.id });
  await emit(QUANT_EVENTS.trialLogged, { id: row.id, family: t.family, alias, ownerId: t.ownerId ?? null });
  return { id: row.id, family: t.family, alias, sharpe, n: m.n };
}

/** A trial's returns, from R2 or inline. */
export async function loadReturns(r: Pick<TrialRow, "returnsRef" | "returns">): Promise<number[] | null> {
  if (r.returns && Array.isArray(r.returns)) return r.returns as number[];
  if (r.returnsRef.startsWith("r2:")) return (await getJson<number[]>(r.returnsRef.slice(3)).catch(() => null)) ?? null;
  return null;
}

/**
 * Every trial of a family, plus the families it aliases or that alias it (one level), oldest first, at most
 * `limit` (newest kept). Owner-scoped: a person's family only includes trials they (or a shared producer) logged.
 */
export async function familyTrials(family: string, opts: { ownerId?: string | null; limit?: number } = {}): Promise<TrialRow[]> {
  const db = requireDb();
  const limit = Math.min(opts.limit ?? 2_000, 5_000);
  const own = await db.select({ alias: sql<string | null>`${schema.quantTrials.hygiene}->>'alias'` }).from(schema.quantTrials).where(eq(schema.quantTrials.family, family));
  const families = new Set([family, ...own.map((r) => r.alias).filter((a): a is string => !!a)]);
  const aliasing = await db.selectDistinct({ family: schema.quantTrials.family }).from(schema.quantTrials).where(sql`${schema.quantTrials.hygiene}->>'alias' = ${family}`).limit(50);
  for (const a of aliasing) families.add(a.family);
  const ownerFilter = opts.ownerId === undefined ? undefined : opts.ownerId === null ? isNull(schema.quantTrials.ownerId) : or(eq(schema.quantTrials.ownerId, opts.ownerId), isNull(schema.quantTrials.ownerId));
  const rows = await db.select().from(schema.quantTrials).where(and(inArray(schema.quantTrials.family, [...families]), ownerFilter)).orderBy(desc(schema.quantTrials.id)).limit(limit);
  return rows.reverse();
}

/** A person's families with their trial counts, newest first. */
export async function familiesOf(ownerId: string): Promise<{ family: string; trials: number; lastAt: string; bestSharpe: number | null }[]> {
  const rows = (await requireDb().execute(sql`select family, count(*)::int as trials, max(created_at) as last_at, max(sharpe) as best from quant_trials where owner_id = ${ownerId} group by family order by max(created_at) desc limit 100`)).rows as { family: string; trials: number; last_at: Date | string; best: number | null }[];
  return rows.map((r) => ({ family: r.family, trials: Number(r.trials), lastAt: new Date(r.last_at).toISOString(), bestSharpe: r.best === null ? null : Number(r.best) }));
}
