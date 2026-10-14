/**
 * The AI usage ledger. Each model call records its tokens and list-price cost against the person it
 * ran for (carried in async context, so no call site has to pass it) and the feature that made it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { after } from "next/server";
import { requireDb, schema } from "@/db";
import { aiUser, runAsUser } from "./context";
import { noteAiSpend } from "./limits";
import { costOf, type Usage } from "./pricing";

export { aiUser, runAsUser };

const meters = new AsyncLocalStorage<{ usd: number }>();

/**
 * Run `fn` and add up the list-price cost of every model call it records, for work that keeps its own
 * budget (a Thesis Agent's steps). The calls are recorded in the ledger as usual; this only counts them.
 */
export async function meterSpend<T>(fn: () => Promise<T>): Promise<{ value: T; usd: number }> {
  const box = { usd: 0 };
  const value = await meters.run(box, fn);
  return { value, usd: box.usd };
}

/**
 * Record a call; never throws and never delays the caller's result. `extraCostUsd` carries fees that
 * are not tokens, such as the provider's charge per web search. The spend limits see the cost at once;
 * the ledger row is written after the response (`after`), so a function frozen at the end of a
 * request still records it.
 */
export function recordUsage(r: { feature: string; provider: string; model: string; effort?: string; usage: Usage; extraCostUsd?: number }) {
  const u = r.usage;
  if (!u.input && !u.output && !r.extraCostUsd) return;
  const cost = (costOf(r.model, u) ?? 0) + (r.extraCostUsd ?? 0);
  const userId = aiUser();
  noteAiSpend(userId, cost);
  const m = meters.getStore();
  if (m) m.usd += cost;
  const write = () => requireDb().insert(schema.aiUsage).values({
    userId, feature: r.feature.slice(0, 80), provider: r.provider, model: r.model, effort: r.effort ?? "",
    inputTokens: u.input, cachedTokens: u.cached, cacheWriteTokens: u.cacheWrite, outputTokens: u.output, reasoningTokens: u.reasoning, costUsd: cost,
  }).then(() => undefined, () => undefined);
  try {
    after(write);
  } catch {
    // Outside a request (scripts): write now.
    void write();
  }
}
