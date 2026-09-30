import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { aiConfig } from "./config";
import { guardAi } from "./limits";
import { aiUser, recordUsage } from "./usage";

/** What the providers charge per web search, on top of tokens. */
export const WEB_SEARCH_FEE_USD = 0.01;

export type ResearchResult = { text: string; citations: { url: string; title: string }[] };

/** One-shot web research via the provider's built-in web search. Used as a tool by the chat agent. */
export async function webResearch(query: string): Promise<ResearchResult> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.reason);
  await guardAi(aiUser());
  const instructions = "Research the query using web search. Reply with a compact factual summary (under 250 words) and include the URLs you relied on.";
  if (cfg.provider === "openai") {
    const client = new OpenAI({ apiKey: cfg.apiKey });
    const res = await client.responses.create({ model: cfg.researchModel, tools: [{ type: "web_search" }], instructions, input: query });
    const u = res.usage;
    const searches = res.output.filter((i) => i.type === "web_search_call").length;
    recordUsage({ feature: "web-research", provider: "openai", model: cfg.researchModel, usage: { input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0 }, extraCostUsd: searches * WEB_SEARCH_FEE_USD });
    const citations: { url: string; title: string }[] = [];
    let text = "";
    for (const item of res.output) {
      if (item.type !== "message") continue;
      for (const c of item.content) {
        if (c.type !== "output_text") continue;
        text += c.text;
        for (const a of c.annotations ?? []) if (a.type === "url_citation" && !citations.some((x) => x.url === a.url)) citations.push({ url: a.url, title: a.title });
      }
    }
    return { text, citations };
  }
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const res = await client.messages.create({
    model: cfg.model, max_tokens: 4000, system: instructions,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
    messages: [{ role: "user", content: query }],
  });
  const mu = res.usage;
  recordUsage({ feature: "web-research", provider: "anthropic", model: cfg.model, usage: { input: (mu.input_tokens ?? 0) + (mu.cache_read_input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0), cached: mu.cache_read_input_tokens ?? 0, cacheWrite: mu.cache_creation_input_tokens ?? 0, output: mu.output_tokens ?? 0, reasoning: 0 }, extraCostUsd: (mu.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_FEE_USD });
  const citations: { url: string; title: string }[] = [];
  let text = "";
  for (const b of res.content) {
    if (b.type === "text") {
      text += b.text;
      for (const c of b.citations ?? []) if (c.type === "web_search_result_location" && !citations.some((x) => x.url === c.url)) citations.push({ url: c.url, title: c.title ?? c.url });
    }
  }
  return { text, citations };
}
