/**
 * Polite fetching for the public sources the crosswalk and the Pulse read (Wikidata, company websites,
 * job-board APIs, Wikimedia, USAspending, PatentsView, state WARN pages): a declared User-Agent that names
 * YouBank (never a person), a timeout, a size cap so one huge page cannot exhaust a function, and a small
 * gap between requests to the same host. SEC requests keep going through `edgarFetch`, which has SEC's own
 * shared rate limit. Server only.
 */
const UA = "YouBank research (Edge; +https://youbank-nu.vercel.app)";
const MAX_BYTES = 4_000_000;
const lastAt = new Map<string, number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait so requests to one host are at least `gapMs` apart within this instance. */
async function pace(url: string, gapMs: number) {
  let host = "";
  try { host = new URL(url).host; } catch { return; }
  const wait = (lastAt.get(host) ?? 0) + gapMs - Date.now();
  lastAt.set(host, Math.max(Date.now(), (lastAt.get(host) ?? 0) + gapMs));
  if (wait > 0) await sleep(wait);
}

export class SourceError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function fetchText(url: string, opts: { timeoutMs?: number; gapMs?: number; headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<string> {
  await pace(url, opts.gapMs ?? 250);
  const res = await fetch(url, {
    method: opts.method ?? "GET", cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    headers: { "User-Agent": UA, Accept: "application/json, text/html;q=0.9, */*;q=0.5", ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.headers ?? {}) },
    ...(opts.body ? { body: opts.body } : {}),
  });
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`, res.status);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new SourceError(`${new URL(url).host} sent a page too large to read`, 413);
  const text = await res.text();
  return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

export async function fetchJson<T>(url: string, opts: Parameters<typeof fetchText>[1] = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
