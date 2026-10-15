/**
 * Quant's use of the forecast ledger (src/lib/edge/forecasts/ledger.ts): people's own calls (kind user_call),
 * settled by the `return` rule (resolve.ts) once the end date has a close.
 */
import { logForecast } from "@/lib/edge/forecasts/ledger";
import { addSessions, nextSession } from "./pit/calendar";
import type { ReturnRule } from "./resolve";

export { resolveReturn, returnBetween, judge, type ReturnRule } from "./resolve";

/** A person's own call: "NVDA beats SPY over the next 3 months: 60%". Logged as kind user_call, owner-scoped. */
export async function logUserCall(ownerId: string, c: { symbol: string; benchmark?: string; months: number; probability: number; direction: "beats" | "trails" }): Promise<{ id: number; question: string; closes: string }> {
  const symbol = c.symbol.toUpperCase().replace(/\./g, "-"), bench = (c.benchmark || "SPY").toUpperCase();
  if (!/^[A-Z][A-Z0-9-]{0,9}$/.test(symbol) || !/^[A-Z][A-Z0-9-]{0,9}$/.test(bench)) throw Object.assign(new Error("Give tickers like NVDA and SPY."), { status: 400 });
  if (!(c.probability >= 0.01 && c.probability <= 0.99)) throw Object.assign(new Error("A probability is between 1% and 99%."), { status: 400 });
  const months = Math.min(Math.max(Math.round(c.months), 1), 24);
  const today = new Date().toISOString().slice(0, 10);
  const from = nextSession(today);
  const to = addSessions(from, Math.round(months * 21));
  const question = `${symbol} ${c.direction === "beats" ? "beats" : "trails"} ${bench} from ${from} to ${to} (total price return)`;
  const rule: ReturnRule = { type: "return", symbol, benchmark: bench, from, to, op: c.direction === "beats" ? ">" : "<", value: 0 };
  const f = await logForecast({ kind: "user_call", subject: `user:${symbol}:${c.direction}:${bench}:${to}`, question, probability: c.probability, opensAt: new Date(), closesAt: new Date(`${to}T21:00:00Z`), rule, model: "own call", modelVersion: "user", ownerId });
  return { id: f.id, question, closes: to };
}
