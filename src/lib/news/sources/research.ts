/**
 * Research briefs: a small model with web search looks for a desk's most important stories of the
 * last day, including outlets with no public feed. It returns each story with its page, publisher and
 * date in its own words; a story is kept only if its page is one the search actually retrieved, it is
 * not a forum or social network, and it is recent. Runs a few times a day for desks people use, inside
 * the research tier of the news budget.
 */
import OpenAI from "openai";
import { resolveAi } from "@/lib/ai/config";
import { aiBlocked } from "@/lib/ai/limits";
import { recordUsage } from "@/lib/ai/usage";
import { allow, noteSpend } from "../budget";
import type { Desk, Tier } from "../desks";
import { canonicalUrl, cleanTitle, domainOf, keyOf, tickersIn } from "../normalize";
import type { RawItem } from "../types";

const MODEL = () => process.env.NEWS_RESEARCH_MODEL?.trim() || process.env.MARKET_RESEARCH_MODEL?.trim() || "gpt-5.6-luna";
const SEARCH_FEE_USD = 0.01;
const DENY = /(^|\.)(reddit|stocktwits|twitter|x|facebook|instagram|tiktok|youtube|quora|medium|substack|wikipedia|threads|discord|telegram|linkedin)\./i;
const TIER1 = /(^|\.)(reuters\.com|apnews\.com|bloomberg\.com|wsj\.com|ft\.com|nytimes\.com|cnbc\.com|axios\.com|semafor\.com|theinformation\.com|techcrunch\.com|statnews\.com|sec\.gov|federalreserve\.gov|fda\.gov|eia\.gov|barrons\.com|economist\.com)$/i;

const SCHEMA = {
  type: "object", additionalProperties: false, required: ["stories"],
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["headline", "summary", "url", "publisher", "published"],
        properties: { headline: { type: "string" }, summary: { type: "string" }, url: { type: "string" }, publisher: { type: "string" }, published: { type: "string" } },
      },
    },
  },
};

type Story = { headline: string; summary: string; url: string; publisher: string; published: string };

/** Keep a researched story only if it checks out. Pure, for tests. */
export function acceptStory(s: Story, retrieved: Set<string>, now: Date): { ok: true; host: string; at: Date } | { ok: false; reason: string } {
  if (!/^https?:\/\//.test(s.url) || !s.headline.trim()) return { ok: false, reason: "no link" };
  const host = domainOf(s.url);
  if (!host || DENY.test(`.${host}`)) return { ok: false, reason: "unreliable source" };
  if (![...retrieved].some((h) => h === host || h.endsWith(`.${host}`) || host.endsWith(`.${h}`))) return { ok: false, reason: "page was not retrieved by the search" };
  const at = new Date(/^\d{4}-\d{2}-\d{2}/.test(s.published) ? `${s.published.slice(0, 10)}T12:00:00Z` : NaN);
  if (Number.isNaN(at.getTime())) return { ok: false, reason: "no date" };
  const ageDays = (now.getTime() - at.getTime()) / 86_400_000;
  if (ageDays > 3 || ageDays < -1.5) return { ok: false, reason: "not recent" };
  return { ok: true, host, at };
}

export async function researchDesk(desk: Desk, now = new Date()): Promise<RawItem[]> {
  if (!(await allow("research")) || (await aiBlocked(null))) return [];
  const model = MODEL();
  const cfg = resolveAi(null, { model });
  if (cfg.provider !== "openai") return [];
  const client = new OpenAI({ apiKey: cfg.apiKey, timeout: 120_000, maxRetries: 0 });
  const today = now.toISOString().slice(0, 10);
  const res = await client.responses.create({
    model, reasoning: { effort: "low" }, tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"],
    instructions: `You research news for ${desk.focus}. Today is ${today}. Use web search to find the 8 most important stories of the last 24 hours for them: announced or reported deals, financings, rulings and regulatory decisions, and major company news. Prefer original reporting (Reuters, Bloomberg, the Wall Street Journal, the Financial Times, CNBC, AP, trade press), company press releases and regulators. For each story give the headline as published, one neutral sentence in your own words, the article's URL, the publisher and the publication date (YYYY-MM-DD). Only include pages you found in the search. No forums, social media or aggregator pages.`,
    input: `Desk: ${desk.label}. Lenses: ${desk.lenses.join(", ")}.${desk.sectors.length ? ` Sectors: ${desk.sectors.join(", ")}.` : ""}`,
    text: { format: { type: "json_schema", name: "desk_news", schema: SCHEMA, strict: true } },
  });
  const retrieved = new Set<string>();
  let searches = 0;
  for (const item of res.output) {
    if (item.type === "web_search_call") {
      searches++;
      const a = item.action as { sources?: { url: string }[]; url?: string | null };
      for (const s of a.sources ?? []) retrieved.add(domainOf(s.url));
      if (a.url) retrieved.add(domainOf(a.url));
    }
    if (item.type === "message") for (const c of item.content) if (c.type === "output_text") for (const an of c.annotations ?? []) if (an.type === "url_citation") retrieved.add(domainOf(an.url));
  }
  retrieved.delete("");
  const u = res.usage;
  const fee = searches * SEARCH_FEE_USD;
  recordUsage({ feature: "news-research", provider: "openai", model, effort: "low", usage: { input: u?.input_tokens ?? 0, cached: u?.input_tokens_details?.cached_tokens ?? 0, cacheWrite: 0, output: u?.output_tokens ?? 0, reasoning: u?.output_tokens_details?.reasoning_tokens ?? 0 }, extraCostUsd: fee });
  noteSpend(fee + ((u?.input_tokens ?? 0) * 0.2 + (u?.output_tokens ?? 0) * 1.2) / 1e6);
  let stories: Story[] = [];
  try { stories = (JSON.parse(res.output_text) as { stories: Story[] }).stories ?? []; } catch { return []; }
  const out: RawItem[] = [];
  for (const s of stories) {
    const v = acceptStory(s, retrieved, now);
    if (!v.ok) continue;
    const url = canonicalUrl(s.url), title = cleanTitle(s.headline);
    out.push({
      key: keyOf(url), url, title, snippet: s.summary.trim().slice(0, 400), source: s.publisher.trim().slice(0, 60) || v.host, domain: v.host, kind: "article",
      publishedAt: v.at, tags: [...desk.lenses, ...desk.sectors], tickers: tickersIn(`${title} ${s.summary}`), tier: (TIER1.test(v.host) ? 1 : 2) as Tier,
      meta: { via: "research", desk: desk.id, model },
    });
  }
  return out;
}
