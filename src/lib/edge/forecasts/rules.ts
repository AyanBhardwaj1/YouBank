/**
 * The forecast ledger's pure rules (F3): how a forecast is resolved from its machine-checkable rule, which
 * forecast of a question counts for the record, and how forecasts are chosen for scoring. Kept apart from
 * the database code so every rule is tested (scripts/test-edge-next.ts).
 *
 * The record counts one forecast per question: the one standing at a fixed horizon before the close (for a
 * 12-month question, the estimate made about 12 months ahead). Re-scoring a question every week therefore
 * cannot flatter the record by counting the late, easy estimates. Manual rules are scored apart.
 */
import type { ForecastRule } from "@/db/schema";

export type ForecastRow = { id: number; kind: string; subject: string; probability: number; low: number | null; high: number | null; baseRate: number | null; opensAt: Date; closesAt: Date; rule: ForecastRule; model: string; modelVersion: string; supersedes: number | null; resolvedAt: Date | null; outcome: number | null; createdAt: Date; question?: string; ownerId?: string | null };

/** A deal event that might settle a deal question: who was bought or bought, and when it was announced. */
export type DealEvent = { target: number | null; acquirer: number | null; announced: string; source: string; stakePct?: number | null; relation?: string };

/**
 * A deal rule against known deals: 1 when the company was announced as the target (or as the buyer) inside
 * the window, with the deal that settled it; null while the window is open and nothing has happened; 0 once
 * it has closed with nothing. Affiliate roll-ups and internal reorganisations never count. Pure.
 */
export function resolveDeal(rule: Extract<ForecastRule, { type: "deal" }>, opens: Date, closes: Date, events: DealEvent[], now: Date): { outcome: number; source: string; at: string } | null {
  const from = opens.toISOString().slice(0, 10), to = closes.toISOString().slice(0, 10);
  const hit = events
    .filter((e) => (rule.role === "target" ? e.target === rule.node : e.acquirer === rule.node))
    .filter((e) => e.relation !== "affiliate_rollup" && e.relation !== "internal")
    .filter((e) => rule.minStakePct === undefined || e.stakePct === null || e.stakePct === undefined || e.stakePct >= rule.minStakePct)
    .filter((e) => e.announced >= from && e.announced <= to)
    .sort((a, b) => a.announced.localeCompare(b.announced))[0];
  if (hit) return { outcome: 1, source: hit.source, at: hit.announced };
  if (now.getTime() >= closes.getTime()) return { outcome: 0, source: "no qualifying announcement in the window (Edge deal database, merger filings, Newsroom tracker)", at: to };
  return null;
}

/** An XBRL rule against the reported value: 1 when it holds, 0 when not; a range rule holds inside [value, high]. Pure. */
export function resolveXbrl(rule: Extract<ForecastRule, { type: "xbrl" }>, reported: number | null): number | null {
  if (reported === null || !Number.isFinite(reported)) return null;
  if (rule.op === ">=") return reported >= rule.value ? 1 : 0;
  if (rule.op === "<=") return reported <= rule.value ? 1 : 0;
  return reported >= rule.value && reported <= (rule.high ?? rule.value) ? 1 : 0;
}

/**
 * For each question (kind, subject, close), the forecast that counts: the latest one made at least
 * `horizonDays` before the close, or the earliest one when none was made that early. Pure.
 */
export function standingAtHorizon<T extends Pick<ForecastRow, "kind" | "subject" | "closesAt" | "createdAt">>(rows: T[], horizonDays: number): T[] {
  const byQ = new Map<string, T[]>();
  for (const r of rows) { const k = `${r.kind}|${r.subject}|${r.closesAt.toISOString().slice(0, 10)}`; const l = byQ.get(k) ?? []; l.push(r); byQ.set(k, l); }
  const out: T[] = [];
  for (const list of byQ.values()) {
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const cutoff = list[0].closesAt.getTime() - horizonDays * 86_400_000;
    const early = list.filter((r) => r.createdAt.getTime() <= cutoff);
    out.push(early.length ? early[early.length - 1] : list[0]);
  }
  return out;
}

/** Whether a new estimate differs enough from the standing one to be worth a new row (half a point, or a moved interval). Pure. */
export function worthLogging(prev: Pick<ForecastRow, "probability" | "low" | "high"> | null, next: { probability: number; low?: number | null; high?: number | null }): boolean {
  if (!prev) return true;
  const moved = (a: number | null | undefined, b: number | null | undefined) => Math.abs((a ?? 0) - (b ?? 0)) >= 0.005;
  return moved(prev.probability, next.probability) || moved(prev.low, next.low) || moved(prev.high, next.high);
}

/** The first day of the month `months` after the month `d` falls in: the close of a monthly rolling question. Pure. */
export function closeAfter(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
}
