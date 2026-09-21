/**
 * Model catalogue. The app default is gpt-6-astra (the "Astra" model the user asked for; there is no
 * "gpt-5.6-astra" on the account, the 5.6 family ships as Sol, Luna, and Terra). Every entry is user-selectable
 * from Settings or the AI panel; selection is stored per account in profiles.extra.ai.
 */
export type Provider = "openai" | "anthropic";
export type Effort = "low" | "medium" | "high" | "xhigh";

export type ModelDef = {
  id: string;
  provider: Provider;
  label: string;
  family: string;
  tier: "flagship" | "pro" | "balanced" | "fast" | "reasoning" | "legacy";
  description: string;
  /** Accepts a reasoning effort setting. */
  effort: boolean;
  /** Relative cost band shown in the picker: 1 (cheap) to 5 (expensive). */
  cost: 1 | 2 | 3 | 4 | 5;
  recommended?: boolean;
};

export const DEFAULT_OPENAI_MODEL = "gpt-6-astra";
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";
export const DEFAULT_EFFORT: Effort = "medium";

export const MODELS: ModelDef[] = [
  { id: "gpt-6-astra", provider: "openai", label: "GPT-6 Astra", family: "GPT-6", tier: "flagship", description: "OpenAI's newest flagship. Strongest multi-step analysis and long-document reasoning. Slower and priciest.", effort: true, cost: 5, recommended: true },
  { id: "gpt-5.6-sol", provider: "openai", label: "GPT-5.6 Sol", family: "GPT-5.6", tier: "pro", description: "5.6 family, tuned for depth. Excellent for memos, models, and multi-tool research.", effort: true, cost: 4, recommended: true },
  { id: "gpt-5.6-terra", provider: "openai", label: "GPT-5.6 Terra", family: "GPT-5.6", tier: "balanced", description: "5.6 family, balanced speed and quality. Good default for day-to-day desk work.", effort: true, cost: 3 },
  { id: "gpt-5.6-luna", provider: "openai", label: "GPT-5.6 Luna", family: "GPT-5.6", tier: "fast", description: "5.6 family, fastest. Best for quick lookups, footnotes, and reformatting.", effort: true, cost: 2 },
  { id: "gpt-5.5", provider: "openai", label: "GPT-5.5", family: "GPT-5.5", tier: "pro", description: "Previous flagship. Proven on tool-heavy workflows.", effort: true, cost: 4 },
  { id: "gpt-5.5-pro", provider: "openai", label: "GPT-5.5 Pro", family: "GPT-5.5", tier: "reasoning", description: "Extended thinking variant of 5.5 for the hardest analyses. Very slow.", effort: true, cost: 5 },
  { id: "gpt-5.4", provider: "openai", label: "GPT-5.4", family: "GPT-5.4", tier: "balanced", description: "Solid general model at a lower price.", effort: true, cost: 3 },
  { id: "gpt-5.4-mini", provider: "openai", label: "GPT-5.4 mini", family: "GPT-5.4", tier: "fast", description: "Small, fast, cheap. Used by default for web research summaries.", effort: true, cost: 1 },
  { id: "gpt-5.4-nano", provider: "openai", label: "GPT-5.4 nano", family: "GPT-5.4", tier: "fast", description: "Smallest model. Classification and extraction only.", effort: true, cost: 1 },
  { id: "gpt-5.2", provider: "openai", label: "GPT-5.2", family: "GPT-5.2", tier: "legacy", description: "Older generation, kept for comparison.", effort: true, cost: 3 },
  { id: "gpt-5.1", provider: "openai", label: "GPT-5.1", family: "GPT-5.1", tier: "legacy", description: "Older generation.", effort: true, cost: 3 },
  { id: "gpt-5", provider: "openai", label: "GPT-5", family: "GPT-5", tier: "legacy", description: "First GPT-5 release.", effort: true, cost: 3 },
  { id: "o3", provider: "openai", label: "o3", family: "o-series", tier: "reasoning", description: "Reasoning model. Deliberate, good at math-heavy checks.", effort: true, cost: 4 },
  { id: "o4-mini", provider: "openai", label: "o4-mini", family: "o-series", tier: "reasoning", description: "Small reasoning model. Fast chain-of-thought for calculations.", effort: true, cost: 2 },
  { id: "gpt-4.1", provider: "openai", label: "GPT-4.1", family: "GPT-4.1", tier: "legacy", description: "Long-context non-reasoning model.", effort: false, cost: 2 },
  { id: "gpt-4.1-mini", provider: "openai", label: "GPT-4.1 mini", family: "GPT-4.1", tier: "legacy", description: "Cheap, fast, non-reasoning.", effort: false, cost: 1 },
  { id: "gpt-4o", provider: "openai", label: "GPT-4o", family: "GPT-4o", tier: "legacy", description: "Older multimodal model.", effort: false, cost: 2 },
  { id: "claude-fable-5-1", provider: "anthropic", label: "Claude Fable 5.1", family: "Claude 5", tier: "flagship", description: "Anthropic's most capable model. Requires ANTHROPIC_API_KEY.", effort: true, cost: 5 },
  { id: "claude-opus-5", provider: "anthropic", label: "Claude Opus 5", family: "Claude 5", tier: "pro", description: "Strong long-form reasoning and writing.", effort: true, cost: 4 },
  { id: "claude-sonnet-5", provider: "anthropic", label: "Claude Sonnet 5", family: "Claude 5", tier: "balanced", description: "Balanced speed and quality.", effort: true, cost: 3 },
  { id: "claude-haiku-4-5-20251001", provider: "anthropic", label: "Claude Haiku 4.5", family: "Claude 4.5", tier: "fast", description: "Fast and inexpensive.", effort: false, cost: 1 },
];

export const modelById = (id: string) => MODELS.find((m) => m.id === id);

export const EFFORTS: { id: Effort; label: string; hint: string }[] = [
  { id: "low", label: "Quick", hint: "Light reasoning. Good for lookups and formatting." },
  { id: "medium", label: "Standard", hint: "Balanced reasoning for most desk work." },
  { id: "high", label: "Deep", hint: "Heavy reasoning for models, memos, and audits. Slower." },
  { id: "xhigh", label: "Max", hint: "Maximum reasoning. Only for the hardest analyses. Slowest and priciest." },
];

/** Per-user AI preferences stored in profiles.extra.ai. */
export type AiPrefs = { provider?: Provider; model?: string; effort?: Effort; researchModel?: string };

export function normalizePrefs(raw: unknown): AiPrefs {
  const p = (raw ?? {}) as Record<string, unknown>;
  const out: AiPrefs = {};
  if (p.provider === "openai" || p.provider === "anthropic") out.provider = p.provider;
  if (typeof p.model === "string" && p.model.length <= 64) out.model = p.model;
  if (p.effort === "low" || p.effort === "medium" || p.effort === "high" || p.effort === "xhigh") out.effort = p.effort;
  if (typeof p.researchModel === "string" && p.researchModel.length <= 64) out.researchModel = p.researchModel;
  return out;
}
