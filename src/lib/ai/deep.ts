/**
 * Deep research (premium: ai.deep-research). The same assistant and tools as the terminal's chat, run
 * the way a careful associate would on a question that matters: a short plan first, more tool steps
 * (30 against 10), maximum reasoning effort on the flagship model, every material figure checked in a
 * second source, and an explicit list of what could not be verified. It runs only when the person ticks
 * it for a question, after the route checks their plan; the daily AI limits apply as to any run.
 */
import { modelAllowed } from "./config";
import { modelById, type AiPrefs, type Effort } from "./models";

export const DEEP_MAX_TURNS = 30;
export const DEEP_EFFORT: Effort = "xhigh";

/**
 * The model for a deep run: AI_DEEP_MODEL when set (and allowed), else the flagship of the provider the
 * person uses. Pure apart from the environment.
 */
export function deepModel(prefs: AiPrefs | null | undefined): string {
  const env = process.env.AI_DEEP_MODEL?.trim();
  if (env && modelAllowed(env)) return env;
  const provider = (prefs?.model && modelById(prefs.model)?.provider) || prefs?.provider || ((process.env.AI_PROVIDER ?? "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai");
  return provider === "anthropic" ? "claude-fable-5-1" : "gpt-6-astra";
}

/** How a deep run works, added to the per-request context (after the cached system prompt). */
export const DEEP_PROTOCOL = `DEEP RESEARCH MODE. The person asked for a thorough, verified answer and accepts that it takes longer.
1. Start with a plan of three to six steps in one short paragraph: what you need to find and where.
2. Work the plan with the tools. Prefer primary sources (filings, XBRL facts, company releases) over summaries. For every figure that drives the conclusion, find a second source or the filing that states it, and note any disagreement with both values.
3. Where sources conflict or are stale, say which you rely on and why.
4. Finish with: the answer (one paragraph), the supporting evidence as cited bullets, a short "Not verified" list of anything you could not confirm, and the date of the most recent source you used.`;
