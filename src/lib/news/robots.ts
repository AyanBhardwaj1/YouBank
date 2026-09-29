/**
 * robots.txt, read the way Google reads it (RFC 9309): the group for our user agent, else "*"; the
 * longest matching rule wins, "allow" wins a tie; "*" matches anything and "$" anchors the end. A
 * missing file (4xx) allows everything; an unreachable one (5xx, timeout) allows nothing.
 */
import { cacheGet, cacheSet } from "@/lib/cache";
import { NEWS_UA } from "./types";

export const ROBOTS_AGENT = "youbanknews";
type Rule = { allow: boolean; path: string };
type Group = { agents: string[]; rules: Rule[] };

export function parseRobots(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null, lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && current) {
      if (value || field === "allow") current.rules.push({ allow: field === "allow", path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern).split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** Whether `path` (with query) may be fetched under these rules. Pure, for tests. */
export function robotsAllows(groups: Group[], path: string, agent = ROBOTS_AGENT): boolean {
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const rules = (mine.length ? mine : groups.filter((g) => g.agents.includes("*"))).flatMap((g) => g.rules);
  let best: Rule | null = null;
  for (const r of rules) {
    if (!r.path) continue;
    if (!toRegex(r.path).test(path)) continue;
    const len = r.path.replace(/\*/g, "").length;
    const bestLen = best ? best.path.replace(/\*/g, "").length : -1;
    if (len > bestLen || (len === bestLen && r.allow)) best = r;
  }
  return best ? best.allow : true;
}

/** Whether YouBank may fetch this URL, per its site's robots.txt (cached a day per host). */
export async function allowedToFetch(url: string): Promise<boolean> {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const key = `news:robots:${u.host}`;
  let text = await cacheGet(key);
  if (text === null) {
    try {
      const res = await fetch(`${u.protocol}//${u.host}/robots.txt`, { headers: { "User-Agent": NEWS_UA }, cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(8_000) });
      text = res.ok ? (await res.text()).slice(0, 200_000) : res.status >= 400 && res.status < 500 ? "" : "User-agent: *\nDisallow: /";
    } catch {
      text = "User-agent: *\nDisallow: /";
    }
    await cacheSet(key, text, 86_400_000);
  }
  return robotsAllows(parseRobots(text), `${u.pathname}${u.search}`);
}
