/**
 * QF1: the target store. Producers save TargetPortfolios (13F clones now; sleeves, risk-parity mixes and the
 * algo engine's strategies later); the algo engine rebalances toward them.
 *
 *   saveTarget(target)          validate, store as the next version of its key (unless nothing changed),
 *                               emit quant/target.updated
 *   getTarget(key, { at? })     the version in force at `at` (as_of <= at), else the latest
 *   targetHistory(key)          every version, newest first
 *
 * Owner-scoped targets (ownerId set) are only readable by that owner; impersonal ones by anyone signed in.
 */
import { createHash } from "node:crypto";
import { and, desc, eq, lte } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { TargetPortfolio } from "./contracts";
import { emit, QUANT_EVENTS } from "./jobs";
import { validateTarget } from "./validate";

/** A stable hash of what a target holds, to tell a real change from a re-run. */
export function targetSignature(t: Pick<TargetPortfolio, "weights" | "cashWeight" | "provenance">): string {
  const w = [...t.weights].map((x) => [x.instrument.symbol, Math.round(x.weight * 1e6) / 1e6]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  return createHash("sha256").update(JSON.stringify([w, Math.round(t.cashWeight * 1e6) / 1e6, t.provenance.inputsHash])).digest("hex").slice(0, 32);
}

export type SaveResult = { key: string; version: number; saved: boolean; target: TargetPortfolio };

/** Store a target as the next version of its key. `version` on the input is ignored and assigned here. */
export async function saveTarget(input: Omit<TargetPortfolio, "version"> & { version?: number }): Promise<SaveResult> {
  const db = requireDb();
  const [last] = await db.select().from(schema.quantTargets).where(eq(schema.quantTargets.targetKey, input.key)).orderBy(desc(schema.quantTargets.version)).limit(1);
  const version = (last?.version ?? 0) + 1;
  const target = { ...input, version } as TargetPortfolio;
  const v = validateTarget(target);
  if (!v.ok) throw Object.assign(new Error(`Target ${input.key} breaks the contract: ${v.errors.slice(0, 5).join("; ")}`), { status: 422 });
  if (last) {
    const prev = last.body as unknown as TargetPortfolio;
    if (targetSignature(prev) === targetSignature(target)) return { key: input.key, version: last.version, saved: false, target: prev };
  }
  await db.insert(schema.quantTargets).values({ targetKey: target.key, ownerId: target.ownerId, version, asOf: new Date(target.asOf), body: target as unknown as Record<string, unknown> }).onConflictDoNothing();
  await emit(QUANT_EVENTS.targetUpdated, { key: target.key, version, ownerId: target.ownerId, producer: target.producer, notBefore: target.rebalance.notBefore }, `quant-target-${target.key}-${version}`);
  return { key: target.key, version, saved: true, target };
}

/** The version in force at `at` (the newest whose as_of is not after it); without `at`, the newest. */
export async function getTarget(key: string, opts: { at?: Date | string } = {}): Promise<TargetPortfolio | null> {
  const at = opts.at ? new Date(opts.at) : null;
  const [row] = await requireDb().select({ body: schema.quantTargets.body }).from(schema.quantTargets)
    .where(and(eq(schema.quantTargets.targetKey, key), at ? lte(schema.quantTargets.asOf, at) : undefined))
    .orderBy(desc(schema.quantTargets.asOf), desc(schema.quantTargets.version)).limit(1);
  return row ? (row.body as unknown as TargetPortfolio) : null;
}

export async function targetHistory(key: string, limit = 100): Promise<{ version: number; asOf: string; createdAt: string; names: number; target: TargetPortfolio }[]> {
  const rows = await requireDb().select().from(schema.quantTargets).where(eq(schema.quantTargets.targetKey, key)).orderBy(desc(schema.quantTargets.version)).limit(Math.min(limit, 500));
  return rows.map((r) => ({ version: r.version, asOf: r.asOf.toISOString(), createdAt: r.createdAt.toISOString(), names: (r.body as unknown as TargetPortfolio).weights.length, target: r.body as unknown as TargetPortfolio }));
}

/** Who owns a key's targets (null = impersonal), for the routes' access check. */
export async function targetOwner(key: string): Promise<{ exists: boolean; ownerId: string | null }> {
  const [row] = await requireDb().select({ ownerId: schema.quantTargets.ownerId }).from(schema.quantTargets).where(eq(schema.quantTargets.targetKey, key)).limit(1);
  return { exists: !!row, ownerId: row?.ownerId ?? null };
}
