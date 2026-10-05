/**
 * List prices in USD per million tokens (standard tier, checked 27 September 2026), for the cost
 * ledger. Cached input is what a prompt-cache hit costs; cache writes are what a new cache entry
 * costs. Catalogue models without a list price here are costed by their cost band at a deliberately
 * high estimate, so the spend limits still count them; other unknown models are logged with tokens
 * and no cost.
 */
import { modelById } from "./models";

export type Price = { input: number; cached: number; cacheWrite: number; output: number };

const P = (input: number, cached: number, cacheWrite: number, output: number): Price => ({ input, cached, cacheWrite, output });

export const PRICES: Record<string, Price> = {
  "gpt-6-astra": P(10, 1, 12.5, 50),
  "gpt-5.6-sol": P(4, 0.4, 5, 20),
  "gpt-5.6-terra": P(2, 0.2, 2.5, 12),
  "gpt-5.6-luna": P(0.2, 0.02, 0.25, 1.2),
  "gpt-6-luna": P(0.1, 0.01, 0.125, 0.5),
  "gpt-5.4-mini": P(0.75, 0.075, 0.75, 4.5),
  "gpt-5.4-nano": P(0.2, 0.02, 0.2, 1.25),
  "claude-fable-5-1": P(10, 0.25, 12.5, 50),
  "claude-opus-5": P(5, 0.5, 6.25, 25),
  "claude-opus-5-5": P(4, 0.2, 5, 20),
  "claude-sonnet-5": P(2, 0.2, 2.5, 10),
  "claude-sonnet-5-5": P(2, 0.2, 2.5, 10),
  "claude-haiku-4-5": P(1, 0.1, 1.25, 5),
  "claude-haiku-4-5-20251001": P(1, 0.1, 1.25, 5),
};

/** Stand-ins for catalogue models with no list price above, by the picker's cost band (1 cheap to 5 priciest). High on purpose. */
const BAND_ESTIMATE: Record<1 | 2 | 3 | 4 | 5, Price> = {
  1: P(1, 0.1, 1.25, 5),
  2: P(2.5, 0.25, 3.125, 10),
  3: P(2.5, 0.25, 3.125, 15),
  4: P(5, 0.5, 6.25, 30),
  5: P(30, 3, 37.5, 180),
};

export function priceOf(model: string): Price | undefined {
  const band = modelById(model)?.cost;
  return PRICES[model] ?? (band ? BAND_ESTIMATE[band] : undefined);
}

export type Usage = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number };
export const emptyUsage = (): Usage => ({ input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 });
export const addUsage = (a: Usage, b: Usage): Usage => ({ input: a.input + b.input, cached: a.cached + b.cached, cacheWrite: a.cacheWrite + b.cacheWrite, output: a.output + b.output, reasoning: a.reasoning + b.reasoning });

/**
 * Cost of a call. `input` counts every input token including cached and newly cached ones (OpenAI's
 * convention); reasoning tokens are already inside `output` on both vendors.
 */
export function costOf(model: string, u: Usage): number | null {
  const p = priceOf(model);
  if (!p) return null;
  const fresh = Math.max(0, u.input - u.cached - u.cacheWrite);
  return (fresh * p.input + u.cached * p.cached + u.cacheWrite * p.cacheWrite + u.output * p.output) / 1e6;
}
