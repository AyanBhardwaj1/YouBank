import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { aiConfig } from "./config";

export type ResearchResult = { text: string; citations: { url: string; title: string }[] };

/** One-shot web research via the provider's built-in web search. Used as a tool by the chat agent. */
export async function webResearch(query: string): Promise<ResearchResult> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.reason);
  const instructions = "Research the query using web search. Reply with a compact factual summary (under 250 words) and include the URLs you relied on.";
  if (cfg.provider === "openai") {
    const client = new OpenAI({ apiKey: cfg.apiKey });
    const res = await client.responses.create({ model: cfg.researchModel, tools: [{ type: "web_search" }], instructions, input: query });
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
