/**
 * Public job boards (E3): Greenhouse, Lever and Ashby, through the unauthenticated APIs they publish for
 * embedding a company's board. Only what the Pulse needs is kept: each posting's id, title, department,
 * location, when it was published and its link back. Descriptions are never fetched. Workday and
 * SuccessFactors have no public API and their terms forbid scraping, so they are not read (the crosswalk
 * notes them and the Pulse says coverage is thin). Parsers are pure, tested on saved responses.
 */
import { fetchJson } from "../../entities/http";

export type Board = "greenhouse" | "lever" | "ashby";
export type Posting = { id: string; title: string; department: string; location: string; publishedAt: string | null; url: string; board: Board; token: string };

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const isoOf = (v: unknown): string | null => {
  if (typeof v === "number" && v > 1e11) return new Date(v).toISOString();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  return null;
};

/** Greenhouse's /departments response: departments with their jobs nested (no descriptions). Pure. */
export function parseGreenhouseDepartments(json: unknown, token: string): Posting[] {
  const out = new Map<string, Posting>();
  const walk = (deps: unknown[]) => {
    for (const d of deps as Record<string, unknown>[]) {
      const dept = str(d.name);
      for (const j of (d.jobs ?? []) as Record<string, unknown>[]) {
        const id = str(j.id);
        if (!id || out.has(id)) continue;
        out.set(id, { id, title: str(j.title), department: dept === "No Department" ? "" : dept, location: str((j.location as { name?: string } | undefined)?.name), publishedAt: isoOf(j.first_published) ?? isoOf(j.updated_at), url: str(j.absolute_url) || `https://boards.greenhouse.io/${token}/jobs/${id}`, board: "greenhouse", token });
      }
      if (Array.isArray(d.children)) walk(d.children);
    }
  };
  walk(((json as { departments?: unknown[] })?.departments ?? []));
  return [...out.values()].filter((p) => p.title);
}

/** Greenhouse's /jobs response (no departments without content), the fallback. Pure. */
export function parseGreenhouseJobs(json: unknown, token: string): Posting[] {
  return (((json as { jobs?: unknown[] })?.jobs ?? []) as Record<string, unknown>[]).map((j) => ({
    id: str(j.id), title: str(j.title), department: str(((j.departments as { name?: string }[] | undefined) ?? [])[0]?.name), location: str((j.location as { name?: string } | undefined)?.name),
    publishedAt: isoOf(j.first_published) ?? isoOf(j.updated_at), url: str(j.absolute_url), board: "greenhouse" as const, token,
  })).filter((p) => p.id && p.title);
}

/** Lever's postings (mode=json): an array with categories for team, department and location. Pure. */
export function parseLever(json: unknown, token: string): Posting[] {
  return ((Array.isArray(json) ? json : []) as Record<string, unknown>[]).map((p) => {
    const c = (p.categories ?? {}) as Record<string, unknown>;
    return { id: str(p.id), title: str(p.text), department: str(c.department) || str(c.team), location: str(c.location) || ((c.allLocations as string[] | undefined) ?? [])[0] || "", publishedAt: isoOf(p.createdAt), url: str(p.hostedUrl), board: "lever" as const, token };
  }).filter((p) => p.id && p.title);
}

/** Ashby's posting API: { jobs: [...] }, listed jobs only. Pure. */
export function parseAshby(json: unknown, token: string): Posting[] {
  return (((json as { jobs?: unknown[] })?.jobs ?? []) as Record<string, unknown>[]).filter((j) => j.isListed !== false).map((j) => ({
    id: str(j.id), title: str(j.title), department: str(j.department) || str(j.team), location: str(j.location) || str((j.address as { postalAddress?: { addressLocality?: string } } | undefined)?.postalAddress?.addressLocality),
    publishedAt: isoOf(j.publishedAt), url: str(j.jobUrl), board: "ashby" as const, token,
  })).filter((p) => p.id && p.title);
}

/** A board's endpoint and its own page (for the link back). Pure. */
export function boardUrls(board: Board, token: string): { api: string; page: string } {
  const t = encodeURIComponent(token);
  if (board === "greenhouse") return { api: `https://boards-api.greenhouse.io/v1/boards/${t}/departments`, page: `https://boards.greenhouse.io/${t}` };
  if (board === "lever") return { api: `https://api.lever.co/v0/postings/${t}?mode=json`, page: `https://jobs.lever.co/${t}` };
  return { api: `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=false`, page: `https://jobs.ashbyhq.com/${t}` };
}

/** Every open posting on a board. A board that no longer exists answers 404, reported as null (the board may have moved). */
export async function readBoard(board: Board, token: string): Promise<{ postings: Posting[]; raw: unknown } | null> {
  const { api } = boardUrls(board, token);
  try {
    const raw = await fetchJson<unknown>(api, { timeoutMs: 20_000, gapMs: 400 });
    const postings = board === "greenhouse" ? parseGreenhouseDepartments(raw, token) : board === "lever" ? parseLever(raw, token) : parseAshby(raw, token);
    return { postings, raw };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}
