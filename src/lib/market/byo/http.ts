/**
 * One request to a provider with a person's own key. Hosts are fixed constants in each provider module
 * (never a URL anyone supplies). The key goes in a header where the provider accepts one (Tiingo,
 * Twelve Data, Finnhub) and in the query only where it must (Alpha Vantage, FMP); either way it never
 * reaches a log, an error message, a response header or the stats table:
 * - errors are built from the status alone, and anything else thrown is scrubbed of the key;
 * - stats record the provider and dataset only (stats.ts), never the URL or the person;
 * - no breaker: one person's refused key is not an outage for anyone else.
 */
import { fetchRetry } from "@/lib/net";
import { budget } from "../budgets";
import { callSource } from "../source";
import { SourceError } from "../source-error";
import { KEY_PROVIDER_INFO, type KeyProvider } from "../sources-meta";

/** `text` with every occurrence of `secret` replaced. Pure. */
export function scrub(text: string, secret: string): string {
  return secret && secret.length >= 4 ? text.split(secret).join("•••") : text;
}

/** An error with the key removed from its message, cause and stack (kept as the same kind of error). */
export function scrubError(e: unknown, secret: string): unknown {
  if (!(e instanceof Error)) return typeof e === "string" ? scrub(e, secret) : e;
  // A classified failure stays classified (the chain falls back on its kind).
  const clean = e instanceof SourceError ? new SourceError(e.source, e.kind, scrub(e.message, secret), e.status) : Object.assign(new Error(scrub(e.message, secret)), { name: e.name });
  if (e.stack) clean.stack = scrub(e.stack, secret);
  const status = (e as { status?: unknown }).status;
  if (typeof status === "number") Object.assign(clean, { status });
  const code = (e as { code?: unknown }).code;
  if (typeof code === "string") Object.assign(clean, { code });
  if (e.cause instanceof Error) clean.cause = scrubError(e.cause, secret);
  return clean;
}

export const keyRefused = (p: KeyProvider) => `${KEY_PROVIDER_INFO[p].label} refused your key. Check it in Settings → Data sources.`;

export type KeyedRequest = { provider: KeyProvider; op: string; url: string; key: string; headers?: Record<string, string> };

/** GET JSON with the person's key: timed and recorded as the provider (no breaker), the key never in an error. */
export async function keyedJson(r: KeyedRequest): Promise<unknown> {
  // Recorded under the adapter's id ("fmp-key"), so a person's own FMP calls never mix with YouBank's FMP account's stats.
  const { label, sourceId: source } = KEY_PROVIDER_INFO[r.provider];
  try {
    return await callSource(source, r.op, async () => {
      const res = await fetchRetry(r.url, { headers: { Accept: "application/json", ...r.headers }, cache: "no-store", timeoutMs: budget().freeTimeoutMs, retries: 0 });
      if (res.status === 401 || res.status === 403) throw new SourceError(source, "http", keyRefused(r.provider), res.status);
      if (res.status === 429) throw new SourceError(source, "rate-limit", `${label} says your key's request limit is reached.`, 429);
      if (!res.ok) throw new SourceError(source, "http", `${label} answered ${res.status}.`, res.status);
      return await res.json();
    }, { breaker: false, label });
  } catch (e) {
    throw scrubError(e, r.key);
  }
}
