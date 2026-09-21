import { DEFAULT_ANTHROPIC_MODEL, DEFAULT_EFFORT, DEFAULT_OPENAI_MODEL, modelById, type AiPrefs, type Effort, type Provider } from "./models";

export type { Provider, Effort };
export type AiConfig = { provider: Provider; model: string; apiKey: string; effort: Effort; researchModel: string };
export type AiOverride = { model?: string; effort?: Effort };

const keyFor = (p: Provider) => (p === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY)?.trim() || "";
const providerOf = (model: string): Provider => modelById(model)?.provider ?? (model.startsWith("claude") ? "anthropic" : "openai");

function envEffort(): Effort | undefined {
  const e = process.env.OPENAI_REASONING_EFFORT?.trim();
  return e === "low" || e === "medium" || e === "high" || e === "xhigh" ? e : undefined;
}

/**
 * Resolve which provider/model/effort to use: request override > account preference > environment > catalogue default.
 * A model whose provider has no API key falls back to the other provider's default, so a missing Anthropic key
 * never breaks a user who picked a Claude model.
 */
export function resolveAi(prefs?: AiPrefs | null, override?: AiOverride): AiConfig | { provider: "none"; reason: string } {
  const envPref = (process.env.AI_PROVIDER ?? "openai").toLowerCase() === "anthropic" ? "anthropic" : "openai";
  const envModel = { openai: process.env.OPENAI_MODEL?.trim(), anthropic: process.env.ANTHROPIC_MODEL?.trim() };
  const candidates = [override?.model, prefs?.model, prefs?.provider ? envModel[prefs.provider] : undefined, envModel[envPref], envPref === "openai" ? DEFAULT_OPENAI_MODEL : DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL, DEFAULT_ANTHROPIC_MODEL]
    .filter((m): m is string => !!m);
  for (const model of candidates) {
    const provider = providerOf(model);
    const apiKey = keyFor(provider);
    if (!apiKey) continue;
    const effort = override?.effort ?? prefs?.effort ?? envEffort() ?? DEFAULT_EFFORT;
    const researchModel = prefs?.researchModel ?? process.env.OPENAI_RESEARCH_MODEL?.trim() ?? "gpt-5.4-mini";
    return { provider, model, apiKey, effort, researchModel };
  }
  return { provider: "none", reason: "set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env.local" };
}

/** Environment-only resolution, for background jobs with no user context. */
export const aiConfig = () => resolveAi(null);

export function aiStatus(prefs?: AiPrefs | null) {
  const c = resolveAi(prefs);
  return c.provider === "none"
    ? { configured: false as const, provider: "none" as const, model: "", effort: "medium" as Effort, reason: c.reason }
    : { configured: true as const, provider: c.provider, model: c.model, effort: c.effort, label: modelById(c.model)?.label ?? c.model };
}

export const availableProviders = (): Provider[] => (["openai", "anthropic"] as Provider[]).filter((p) => !!keyFor(p));
