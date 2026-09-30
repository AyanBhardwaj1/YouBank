import OpenAI from "openai";
import { z } from "zod";
import { aiConfig } from "@/lib/ai/config";
import { guardAi } from "@/lib/ai/limits";
import { WEB_SEARCH_FEE_USD, webResearch } from "@/lib/ai/research";
import { aiUser, recordUsage } from "@/lib/ai/usage";
import type { NewStartup } from "../directory";
import { slugify } from "../directory";

const Found = z.object({
  startups: z.array(z.object({
    name: z.string(), website: z.string().default(""), one_liner: z.string().default(""), country: z.string().default(""), city: z.string().default(""),
    founded_year: z.number().nullable().default(null), funding_stage: z.string().default(""), investors: z.array(z.string()).default([]), founders: z.string().default(""), program: z.string().default(""), source_url: z.string().default(""),
  })),
});

/** Find startups on the open web for a query (e.g. "fintech startups in Nigeria founded after 2022", "Thiel Fellows 2024 companies"). */
export async function discoverStartups(query: string, program = ""): Promise<NewStartup[]> {
  const cfg = aiConfig();
  if (cfg.provider === "none") throw new Error(cfg.reason);
  await guardAi(aiUser());
  const instructions = `You research startups. Use web search. Return 10-25 distinct real companies matching the request with accurate fields; leave fields empty when unknown. Never invent companies.`;
  const prompt = `Find startups: ${query}${program ? ` (program: ${program})` : ""}. Include website, one-line description, country, city, founded year, funding stage, known investors, founders, and the URL you got it from.`;
  let parsed: z.infer<typeof Found>;
  if (cfg.provider === "openai") {
    const client = new OpenAI({ apiKey: cfg.apiKey });
    const model = process.env.OPENAI_RESEARCH_MODEL?.trim() || "gpt-5.4-mini";
    const res = await client.responses.create({
      model, tools: [{ type: "web_search" }], instructions, input: prompt,
      text: { format: { type: "json_schema", name: "found_startups", schema: z.toJSONSchema(Found) as Record<string, unknown> } },
    });
    const u = res.usage;
    recordUsage({ feature: "vc-discover", provider: "openai", model, usage: { input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0 }, extraCostUsd: res.output.filter((i) => i.type === "web_search_call").length * WEB_SEARCH_FEE_USD });
    parsed = Found.parse(JSON.parse(res.output_text));
  } else {
    // Anthropic path: research, then ask for JSON in a second pass without tools.
    const r = await webResearch(prompt);
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: cfg.apiKey });
    const res = await client.messages.create({ model: cfg.model, max_tokens: 6000, messages: [{ role: "user", content: `Extract the startups from these notes as JSON.\n\n${r.text}\n\nSources: ${r.citations.map((c) => c.url).join(", ")}` }], output_config: { format: { type: "json_schema", schema: z.toJSONSchema(Found) as Record<string, unknown> } } });
    const mu = res.usage;
    recordUsage({ feature: "vc-discover", provider: "anthropic", model: cfg.model, usage: { input: (mu.input_tokens ?? 0) + (mu.cache_read_input_tokens ?? 0) + (mu.cache_creation_input_tokens ?? 0), cached: mu.cache_read_input_tokens ?? 0, cacheWrite: mu.cache_creation_input_tokens ?? 0, output: mu.output_tokens ?? 0, reasoning: 0 } });
    parsed = Found.parse(JSON.parse(res.content.filter((b): b is import("@anthropic-ai/sdk").default.TextBlock => b.type === "text").map((b) => b.text).join("")));
  }
  return parsed.startups.filter((s) => s.name.trim()).map((s) => {
    let host = ""; try { host = s.website ? new URL(s.website.startsWith("http") ? s.website : `https://${s.website}`).hostname.replace(/^www\./, "") : ""; } catch { /* ignore */ }
    return {
      source: "web", sourceId: host || slugify(s.name), name: s.name.trim(), oneLiner: s.one_liner, description: s.one_liner, website: s.website && !s.website.startsWith("http") ? `https://${s.website}` : s.website, url: s.source_url, logo: "",
      program: s.program || program || "Web discovery", status: "", foundedYear: s.founded_year, founders: s.founders, location: s.city, country: s.country, industries: [], tags: [], teamSize: null, fundingStage: s.funding_stage,
      investors: s.investors, raised: "", raisedUsd: null, isHiring: 0, sourceDate: new Date().toISOString().slice(0, 10), data: { query },
    };
  });
}
