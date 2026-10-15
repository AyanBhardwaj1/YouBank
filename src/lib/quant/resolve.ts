/**
 * The forecast ledger's `return` rule, resolved from the bar store (no ledger import, so the ledger can import
 * this without a cycle). A return rule asks whether a symbol's total price return from `from` to `to` (closes)
 * beat a benchmark's by `value`.
 */
import type { ForecastRule } from "@/db/schema";
import { loadBars } from "./pit/bars";

export type ReturnRule = Extract<ForecastRule, { type: "return" }>;

/** Total return between two dates from closes (the last close on or before each date). Pure. */
export function returnBetween(dates: string[], closes: number[], from: string, to: string): number | null {
  const at = (d: string) => { let k = -1; for (let i = 0; i < dates.length; i++) { if (dates[i] <= d) k = i; else break; } return k; };
  const a = at(from), b = at(to);
  if (a < 0 || b < 0 || b <= a || dates[dates.length - 1] < to) return null;
  return closes[b] / closes[a] - 1;
}

/** Whether the rule's comparison holds. Pure. */
export function judge(rule: ReturnRule, excess: number): number {
  const v = rule.value;
  return (rule.op === ">" ? excess > v : rule.op === ">=" ? excess >= v : rule.op === "<" ? excess < v : excess <= v) ? 1 : 0;
}

/** Settle a return rule: null while `to` has no close yet (or prices are missing). */
export async function resolveReturn(rule: ReturnRule, now = new Date()): Promise<{ outcome: number; source: string } | null> {
  if (now.toISOString().slice(0, 10) <= rule.to) return null;
  const from = new Date(Date.parse(rule.from) - 10 * 86_400_000).toISOString().slice(0, 10);
  const [s, b] = await Promise.all([loadBars(rule.symbol, from), loadBars(rule.benchmark, from)]);
  if (!s || !b) return null;
  if ((s.bars.d.at(-1) ?? "") < rule.to || (b.bars.d.at(-1) ?? "") < rule.to) return null;
  const rs = returnBetween(s.bars.d, s.bars.c, rule.from, rule.to), rb = returnBetween(b.bars.d, b.bars.c, rule.from, rule.to);
  if (rs === null || rb === null) return null;
  const excess = rs - rb;
  return { outcome: judge(rule, excess), source: `${rule.symbol} ${(rs * 100).toFixed(2)}% against ${rule.benchmark} ${(rb * 100).toFixed(2)}% from ${rule.from} to ${rule.to} (daily closes, ${s.provider})` };
}

