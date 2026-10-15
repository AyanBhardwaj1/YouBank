/**
 * Q3 on the server: grade a strategy family from every trial in quant_trials, grade an uploaded return series,
 * and the live gate (docs/quant-edge.md, section 5.3 rule 6) with its typed, logged override.
 *
 *   integrityCheck(family, { ownerId, trialId?, pro? })  the algo engine's call before a strategy goes live
 *   liveGate(report)                                     whether live trading needs a typed override (D or F)
 *   logOverride(...)                                      records the override in quant_runs (the algo engine
 *                                                         also logs it in its own audit trail)
 */
import { createHash } from "node:crypto";
import type { IntegrityReport } from "../contracts";
import { trySaveRun, saveRun } from "../runs";
import { familyTrials, loadReturns, type TrialHygiene, type TrialRow } from "../trials";
import { assess, INTEGRITY_VERSION, type Assessment } from "./assess";

/** Supplies factor returns aligned with a list of dates (Q1's factors), or null when there are none. */
export type FactorProvider = (dates: string[]) => Promise<{ names: string[]; rows: number[][]; source: string } | null>;

let factorProvider: FactorProvider | null = null;
/** The factor lab registers its provider here, so this module does not import the factor engine. */
export const setFactorProvider = (p: FactorProvider) => { factorProvider = p; };

export type FamilyCheck = Assessment & { family: string; trialId: number; runId: number | null; trialsUsed: number; matrixColumns: number };

/** Load up to `max` trials' returns of the same length as the assessed one, six at a time. */
async function matrixOf(rows: TrialRow[], selected: TrialRow, max: number): Promise<{ M: number[][]; column: number; used: TrialRow[] }> {
  const same = rows.filter((r) => r.nObs === selected.nObs);
  const pick = [selected, ...same.filter((r) => r.id !== selected.id).slice(-(max - 1))];
  const series: (number[] | null)[] = new Array(pick.length).fill(null);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(6, pick.length) }, async () => { while (i < pick.length) { const k = i++; series[k] = await loadReturns(pick[k]).catch(() => null); } }));
  const ok = pick.map((r, k) => ({ r, s: series[k] })).filter((x): x is { r: TrialRow; s: number[] } => !!x.s && x.s.length === selected.nObs);
  const T = selected.nObs ?? 0;
  return { M: Array.from({ length: T }, (_, t) => ok.map((x) => x.s[t])), column: 0, used: ok.map((x) => x.r) };
}

/**
 * Grade a family. The assessed trial is `trialId`, else the family's best Sharpe ratio (the one a person would
 * pick; the DSR deflates it by every trial). Free: trial matrices up to 100 for the grade; Pro: up to 500,
 * with the Reality Check and the placebo.
 */
export async function integrityCheck(family: string, opts: { ownerId?: string | null; trialId?: number; pro?: boolean; save?: boolean } = {}): Promise<FamilyCheck> {
  const rows = await familyTrials(family, { ownerId: opts.ownerId });
  if (!rows.length) throw Object.assign(new Error("No trials are logged for that strategy family yet."), { status: 404 });
  const selected = opts.trialId ? rows.find((r) => r.id === opts.trialId) : [...rows].sort((a, b) => (b.sharpe ?? -Infinity) - (a.sharpe ?? -Infinity))[0];
  if (!selected) throw Object.assign(new Error("That trial is not in this family."), { status: 404 });
  const returns = await loadReturns(selected);
  if (!returns) throw Object.assign(new Error("That trial's returns could not be read."), { status: 503 });
  const { M, used } = await matrixOf(rows, selected, opts.pro ? 500 : 100);
  const hygiene = (selected.hygiene ?? {}) as TrialHygiene;
  const dates = hygiene.dates?.length === returns.length ? hygiene.dates : undefined;
  const factors = dates && factorProvider ? await factorProvider(dates).catch(() => null) : null;
  const a = assess({
    returns, periodsPerYear: selected.periodsPerYear, dates, hygiene, pro: !!opts.pro,
    trialSharpes: rows.map((r) => r.sharpe ?? NaN), matrix: used.length >= 2 ? M : undefined, matrixColumn: 0,
    trialParams: rows.map((r) => r.params), assessedIndex: rows.indexOf(selected), factors: factors ?? undefined,
  });
  const runId = opts.save !== false && opts.ownerId ? await trySaveRun(opts.ownerId, "integrity", { family, trialId: selected.id, trials: rows.length, pro: !!opts.pro }, { report: a.report, rule: a.rule }, [{ label: `quant_trials: ${rows.length} trials of ${family}` }], INTEGRITY_VERSION) : null;
  return { ...a, family, trialId: selected.id, runId, trialsUsed: rows.length, matrixColumns: used.length };
}

/** Grade an uploaded series (free: one series; Pro adds a trial matrix of up to 500 columns). */
export function checkUpload(input: { returns: number[]; dates?: string[]; periodsPerYear: number; matrix?: number[][]; declaredTrials?: number; hygiene: TrialHygiene; pro: boolean; loggedSharpes: number[] }): Assessment {
  const M = input.pro && input.matrix && input.matrix.length === input.returns.length ? input.matrix : undefined;
  const sharpes = M ? Array.from({ length: M[0].length }, (_, j) => { const col = M.map((r) => r[j]); const mu = col.reduce((s, v) => s + v, 0) / col.length; const sd = Math.sqrt(col.reduce((s, v) => s + (v - mu) ** 2, 0) / (col.length - 1)); return sd > 0 ? mu / sd : NaN; }) : input.loggedSharpes;
  return assess({ returns: input.returns, dates: input.dates, periodsPerYear: input.periodsPerYear, trialSharpes: sharpes.length ? sharpes : [NaN], matrix: M, declaredTrials: input.declaredTrials, hygiene: input.hygiene, pro: input.pro });
}

/* ---------------- The live gate ---------------- */

export type Gate = { allowed: boolean; needsOverride: boolean; phrase: string | null; reason: string };

/** The phrase a person types to run a D or F strategy live (not on paper). */
export const overridePhrase = (family: string, grade: IntegrityReport["grade"]) => `I accept grade ${grade} for ${family}`;

/** Rule 6: live trading on a D or F grade needs a typed override that is logged. Paper trading never does. */
export function liveGate(report: Pick<IntegrityReport, "grade">, family: string): Gate {
  if (report.grade === "D" || report.grade === "F") return { allowed: false, needsOverride: true, phrase: overridePhrase(family, report.grade), reason: `Grade ${report.grade}: live trading needs a typed override, which is logged.` };
  return { allowed: true, needsOverride: false, phrase: null, reason: `Grade ${report.grade}.` };
}

/** Record a typed override. Throws 400 unless the typed text is exactly the phrase. Returns the audit row id. */
export async function logOverride(o: { ownerId: string; actor: string; family: string; report: IntegrityReport; typed: string; accountRef?: string | null; ip?: string | null; userAgent?: string | null }): Promise<{ id: number; hash: string }> {
  const phrase = overridePhrase(o.family, o.report.grade);
  if (o.report.grade !== "D" && o.report.grade !== "F") throw Object.assign(new Error("Only a D or F grade needs an override."), { status: 400 });
  if (o.typed.trim() !== phrase) throw Object.assign(new Error(`Type exactly: ${phrase}`), { status: 400 });
  const hash = createHash("sha256").update(JSON.stringify([o.ownerId, o.family, o.report.grade, o.report.checkedAt, phrase])).digest("hex").slice(0, 32);
  const id = await saveRun(o.ownerId, "integrity_override", { family: o.family, grade: o.report.grade, checkedAt: o.report.checkedAt, typed: o.typed.trim(), accountRef: o.accountRef ?? null, actor: o.actor, ip: o.ip ?? null, userAgent: o.userAgent ?? null }, { hash, report: o.report }, [], INTEGRITY_VERSION);
  return { id, hash };
}
