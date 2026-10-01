/**
 * Passage embeddings: OpenAI text-embedding-3-small shortened to 512 dimensions (stored as half
 * precision, about 1 KB a passage), counted against the AI spend caps like every other model call.
 */
import OpenAI from "openai";
import { resolveAi } from "@/lib/ai/config";
import { guardAi } from "@/lib/ai/limits";
import { aiUser, recordUsage } from "@/lib/ai/usage";

export const EMBED_MODEL = "text-embedding-3-small";
export const EMBED_DIMS = 512;
const USD_PER_TOKEN = 0.02 / 1e6;

/** The OpenAI key (embeddings are OpenAI's whatever model writes the answers). */
export const embeddingsReady = () => resolveAi(null, { model: EMBED_MODEL }).provider === "openai";

/** Embeddings for texts (in batches), or a clear error when there is no OpenAI key or the AI limit is reached. */
export async function embedTexts(texts: string[], feature = "edge-embed"): Promise<number[][]> {
  if (!texts.length) return [];
  const cfg = resolveAi(null, { model: EMBED_MODEL });
  if (cfg.provider !== "openai") throw Object.assign(new Error("Document search needs an OpenAI key for embeddings."), { status: 503 });
  await guardAi(aiUser());
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: 60_000, maxRetries: 1 });
  const out: number[][] = [];
  let tokens = 0;
  for (let i = 0; i < texts.length; i += 128) {
    const res = await client.embeddings.create({ model: EMBED_MODEL, input: texts.slice(i, i + 128).map((t) => t.slice(0, 6000)), dimensions: EMBED_DIMS });
    for (const d of res.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
    tokens += res.usage?.prompt_tokens ?? 0;
  }
  recordUsage({ feature, provider: "openai", model: EMBED_MODEL, usage: { input: tokens, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: tokens * USD_PER_TOKEN });
  return out;
}

/** A vector as a pgvector literal. Pure. */
export const vectorLiteral = (v: number[]) => `[${v.map((x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0)).join(",")}]`;
