/**
 * Which model does which job. Interactive work (terminal chat, tools, Studio) uses the model the person
 * chose. High-volume background work goes to small models at low effort, which is where most of the
 * cost is: a fixed model per task type captured most of the gain from routing in a 2026 study
 * (arXiv:2608.23023), and small models at low effort hold quality on classification and extraction.
 */
import { availableProviders, type AiOverride } from "./config";
import { modelById, type AiPrefs, type Effort, type Provider } from "./models";

export type AiTask = "classify" | "extract" | "summarize" | "draft" | "chat" | "workflow" | "studio" | "vision";

const ROUTES: Partial<Record<AiTask, Record<Provider, { model: string; effort: Effort }>>> = {
  classify: { openai: { model: "gpt-5.6-luna", effort: "low" }, anthropic: { model: "claude-haiku-4-5-20251001", effort: "low" } },
  extract: { openai: { model: "gpt-5.6-luna", effort: "low" }, anthropic: { model: "claude-haiku-4-5-20251001", effort: "low" } },
  summarize: { openai: { model: "gpt-5.6-luna", effort: "low" }, anthropic: { model: "claude-haiku-4-5-20251001", effort: "low" } },
  draft: { openai: { model: "gpt-5.6-terra", effort: "low" }, anthropic: { model: "claude-sonnet-5", effort: "low" } },
};

/**
 * The override for a task: an explicit override wins, then routing (unless the person turned it off),
 * on the same provider as the person's chosen model so one vendor key is enough.
 */
export function routeFor(task: AiTask | undefined, prefs: AiPrefs | null | undefined, override?: AiOverride): AiOverride | undefined {
  if (override?.model || !task || prefs?.routing === false) return override;
  const route = ROUTES[task];
  if (!route) return override;
  const preferred: Provider = (prefs?.model && modelById(prefs.model)?.provider) || prefs?.provider || ((process.env.AI_PROVIDER ?? "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai");
  // Route within the vendor that has a key, so a missing key never sends a small task to a flagship.
  const keyed = availableProviders();
  const provider = keyed.includes(preferred) ? preferred : keyed[0];
  const r = provider ? route[provider] : undefined;
  return r ? { model: r.model, effort: override?.effort ?? r.effort } : override;
}

export const ROUTE_TABLE = ROUTES;
