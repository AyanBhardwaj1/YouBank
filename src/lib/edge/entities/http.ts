/**
 * Polite fetching for the public sources the crosswalk and the Pulse read (Wikidata, company websites,
 * job-board APIs, Wikimedia, USAspending, PatentsView, state WARN pages): a declared User-Agent that names
 * YouBank (never a person), a timeout, a size cap so one huge page cannot exhaust a function, and a small
 * gap between requests to the same host. SEC requests keep going through `edgarFetch`, which has SEC's own
 * shared rate limit. Server only.
 *
 * Some addresses come from data rather than code (a company website from SEC or Wikidata, a careers link
 * found on that site), so every request and every redirect is checked first: http(s) only, no credentials,
 * and a host that resolves only to public addresses (no loopback, private, link-local or metadata ranges).
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

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

/** Whether an IP address is loopback, private, link-local, CGNAT, multicast or unspecified. Pure. */
export function privateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (v.startsWith("::ffff:")) return privateAddress(v.slice(7));
  if (isIP(v) === 4) {
    const [a, b] = v.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(v) === 6) return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v) || v.startsWith("ff");
  return true;
}

/** Throw unless `url` is an http(s) address on a host that resolves only to public addresses. */
export async function assertPublicUrl(url: string): Promise<URL> {
  let u: URL;
  try { u = new URL(url); } catch { throw new SourceError("not a web address", 400); }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) throw new SourceError("only plain http(s) addresses are read", 400);
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host || /(^|\.)(localhost|local|internal|localdomain)$/i.test(host)) throw new SourceError(`${host || "that host"} is not a public address`, 400);
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true, verbatim: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length || addrs.some(privateAddress)) throw new SourceError(`${host} is not a public address`, 400);
  return u;
}

export async function fetchText(url: string, opts: { timeoutMs?: number; gapMs?: number; headers?: Record<string, string>; method?: string; body?: string } = {}): Promise<string> {
  await pace(url, opts.gapMs ?? 250);
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 20_000);
  let method = opts.method ?? "GET", body = opts.body, at = url, extra = opts.headers ?? {};
  let res: Response;
  // Redirects are followed by hand, at most five, so each hop's host is checked like the first.
  for (let hop = 0; ; hop++) {
    await assertPublicUrl(at);
    res = await fetch(at, {
      method, cache: "no-store", redirect: "manual", signal,
      headers: { "User-Agent": UA, Accept: "application/json, text/html;q=0.9, */*;q=0.5", ...(body ? { "content-type": "application/json" } : {}), ...extra },
      ...(body ? { body } : {}),
    });
    const next = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!next) break;
    if (hop >= 5) throw new SourceError(`${new URL(url).host} redirected too many times`, 508);
    const to = new URL(next, at);
    // A source's own headers (an API key) never follow a redirect to another site.
    if (to.origin !== new URL(at).origin) extra = {};
    at = to.toString();
    if (res.status !== 307 && res.status !== 308) { method = "GET"; body = undefined; }
  }
  if (!res.ok) throw new SourceError(`${new URL(url).host} answered ${res.status}`, res.status);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new SourceError(`${new URL(url).host} sent a page too large to read`, 413);
  const text = await res.text();
  return text.length > MAX_BYTES ? text.slice(0, MAX_BYTES) : text;
}

export async function fetchJson<T>(url: string, opts: Parameters<typeof fetchText>[1] = {}): Promise<T> {
  return JSON.parse(await fetchText(url, opts)) as T;
}
