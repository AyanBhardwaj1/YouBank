/**
 * The tech radar: what builders and researchers are paying attention to this week, before it is news.
 * Hugging Face's daily papers (ranked by researchers' upvotes) and trending models, GitHub repositories
 * gaining stars fastest, and Show HN launches the community lifted. All public APIs, no keys.
 */
import { canonicalUrl, keyOf } from "../normalize";
import { NEWS_UA, type FetchResult, type RawItem } from "../types";

const get = async <T,>(url: string, headers: Record<string, string> = {}): Promise<T | null> => {
  const res = await fetch(url, { headers: { "User-Agent": NEWS_UA, Accept: "application/json", ...headers }, cache: "no-store", signal: AbortSignal.timeout(15_000) }).catch(() => null);
  return res?.ok ? ((await res.json().catch(() => null)) as T | null) : null;
};

type HfPaper = { paper: { id: string; title: string; summary?: string; upvotes?: number; publishedAt?: string; ai_keywords?: string[] }; publishedAt?: string; numComments?: number };
type HfModel = { id: string; likes?: number; downloads?: number; trendingScore?: number; pipeline_tag?: string; createdAt?: string; lastModified?: string };
type GhRepo = { full_name: string; html_url: string; description: string | null; stargazers_count: number; language: string | null; created_at: string; topics?: string[] };
type HnHit = { objectID: string; title: string; url: string | null; points: number; num_comments: number; created_at: string };

export function paperItems(papers: HfPaper[]): RawItem[] {
  return papers.filter((p) => (p.paper.upvotes ?? 0) >= 10).map((p) => {
    const url = `https://huggingface.co/papers/${p.paper.id}`;
    return {
      key: keyOf(url), url, title: p.paper.title.replace(/\s+/g, " ").trim(), snippet: (p.paper.summary ?? "").replace(/\s+/g, " ").slice(0, 420),
      source: "Hugging Face Papers", domain: "huggingface.co", kind: "paper" as const, publishedAt: new Date(p.publishedAt ?? p.paper.publishedAt ?? Date.now()),
      tags: ["radar", "tech"], tickers: [], tier: 2 as const, meta: { upvotes: p.paper.upvotes ?? 0, comments: p.numComments ?? 0, arxiv: p.paper.id, keywords: (p.paper.ai_keywords ?? []).slice(0, 6), weight: Math.min(0.7, 0.2 + (p.paper.upvotes ?? 0) / 200), category: "research" },
    };
  });
}

export function modelItems(models: HfModel[], now = new Date()): RawItem[] {
  return models.slice(0, 20).map((m) => {
    const url = `https://huggingface.co/${m.id}`;
    return {
      key: keyOf(`${url}#trending-${now.toISOString().slice(0, 10)}`), url, title: `Trending model: ${m.id}`, snippet: [m.pipeline_tag, m.likes ? `${m.likes.toLocaleString("en-US")} likes` : "", m.downloads ? `${m.downloads.toLocaleString("en-US")} downloads` : ""].filter(Boolean).join(" · "),
      source: "Hugging Face", domain: "huggingface.co", kind: "model" as const, publishedAt: now, tags: ["radar", "tech"], tickers: [], tier: 2 as const,
      meta: { likes: m.likes ?? 0, downloads: m.downloads ?? 0, trending: m.trendingScore ?? 0, task: m.pipeline_tag ?? "", weight: Math.min(0.55, 0.15 + (m.trendingScore ?? 0) / 4000), category: "research" },
    };
  });
}

export function repoItems(repos: GhRepo[], now = new Date()): RawItem[] {
  return repos.filter((r) => r.stargazers_count >= 300).map((r) => {
    const url = canonicalUrl(r.html_url);
    return {
      key: keyOf(`${url}#rising-${now.toISOString().slice(0, 10)}`), url, title: `${r.full_name}: ${r.description ? r.description.replace(/\s+/g, " ").slice(0, 140) : "rising on GitHub"}`,
      snippet: `${r.stargazers_count.toLocaleString("en-US")} stars since ${r.created_at.slice(0, 10)}${r.language ? ` · ${r.language}` : ""}${r.topics?.length ? ` · ${r.topics.slice(0, 4).join(", ")}` : ""}`,
      source: "GitHub", domain: "github.com", kind: "repo" as const, publishedAt: new Date(r.created_at), tags: ["radar", "tech", "vc"], tickers: [], tier: 2 as const,
      meta: { stars: r.stargazers_count, language: r.language ?? "", repo: r.full_name, weight: Math.min(0.6, 0.15 + r.stargazers_count / 10_000), category: "research" },
    };
  });
}

export function showHnItems(hits: HnHit[]): RawItem[] {
  return hits.filter((h) => h.points >= 80).map((h) => {
    const url = canonicalUrl(h.url || `https://news.ycombinator.com/item?id=${h.objectID}`);
    return {
      key: keyOf(url), url, title: h.title.replace(/^Show HN:\s*/i, ""), snippet: `Show HN · ${h.points} points · ${h.num_comments} comments`,
      source: "Hacker News", domain: "news.ycombinator.com", kind: "launch" as const, publishedAt: new Date(h.created_at), tags: ["radar", "vc", "tech"], tickers: [], tier: 2 as const,
      meta: { points: h.points, comments: h.num_comments, hn: `https://news.ycombinator.com/item?id=${h.objectID}`, weight: Math.min(0.55, 0.15 + h.points / 1500), category: "product" },
    };
  });
}

export async function fetchRadar(now = new Date()): Promise<FetchResult> {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const threeDays = Math.floor((now.getTime() - 3 * 86_400_000) / 1000);
  const [papers, models, repos, hn] = await Promise.all([
    get<HfPaper[]>("https://huggingface.co/api/daily_papers?limit=50"),
    get<HfModel[]>("https://huggingface.co/api/models?sort=trendingScore&limit=20"),
    get<{ items?: GhRepo[] }>(`https://api.github.com/search/repositories?q=created:%3E${weekAgo}&sort=stars&order=desc&per_page=25`, { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }),
    get<{ hits?: HnHit[] }>(`https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=created_at_i>${threeDays},points>80&hitsPerPage=30`),
  ]);
  const items = [...paperItems(papers ?? []), ...modelItems(models ?? [], now), ...repoItems(repos?.items ?? [], now), ...showHnItems(hn?.hits ?? [])];
  if (!papers && !models && !repos && !hn) return { status: "error", items: [], error: "no radar source answered" };
  return { status: "ok", items };
}
