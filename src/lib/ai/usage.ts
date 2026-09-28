/**
 * The AI usage ledger. Each model call records its tokens and list-price cost against the person it
 * ran for (carried in async context, so no call site has to pass it) and the feature that made it.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { requireDb, schema } from "@/db";
import { costOf, type Usage } from "./pricing";

const store = new AsyncLocalStorage<{ userId: string }>();

/** Run `fn` with AI calls attributed to this person. */
export function runAsUser<T>(userId: string, fn: () => T): T {
  return store.run({ userId }, fn);
}

export const aiUser = () => store.getStore()?.userId ?? null;

/**
 * Record a call; never throws and never delays the caller's result. `extraCostUsd` carries fees that
 * are not tokens, such as the provider's charge per web search.
 */
export function recordUsage(r: { feature: string; provider: string; model: string; effort?: string; usage: Usage; extraCostUsd?: number }) {
  const u = r.usage;
  if (!u.input && !u.output) return;
  const cost = (costOf(r.model, u) ?? 0) + (r.extraCostUsd ?? 0);
  void Promise.resolve().then(() => requireDb().insert(schema.aiUsage).values({
    userId: aiUser(), feature: r.feature.slice(0, 80), provider: r.provider, model: r.model, effort: r.effort ?? "",
    inputTokens: u.input, cachedTokens: u.cached, cacheWriteTokens: u.cacheWrite, outputTokens: u.output, reasoningTokens: u.reasoning, costUsd: cost,
  })).catch(() => undefined);
}
