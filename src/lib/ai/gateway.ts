/**
 * Cloudflare AI Gateway in front of every OpenAI and Anthropic call, when it is set up.
 *
 * With CF_AI_GATEWAY_URL (https://gateway.ai.cloudflare.com/v1/{account}/{gateway}), or CF_ACCOUNT_ID with
 * CF_AI_GATEWAY_ID, each SDK client is pointed at the gateway's provider endpoint instead of the provider,
 * and every request carries:
 * - `cf-aig-metadata` with the YouBank feature that made it (chat, edge-thesis-plan, committee…), so the
 *   gateway's analytics and logs split cost, latency and errors by feature;
 * - `cf-aig-cache-ttl` when caching is on for that call (CF_AI_GATEWAY_CACHE_TTL, seconds; only calls that
 *   ask for it, the structured extractions, where the same prompt should give the same answer);
 * - `cf-aig-authorization` when the gateway is authenticated (CF_AI_GATEWAY_TOKEN).
 *
 * The gateway is never a single point of failure: a request the gateway itself cannot carry (no answer, or
 * a Cloudflare 502/504/52x) is sent again straight to the provider, so AI keeps working if the gateway is
 * down or misconfigured. Without the settings, clients talk to the providers directly, exactly as before.
 * Server only.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

type Env = Record<string, string | undefined>;
export type Provider = "openai" | "anthropic";
export const DIRECT: Record<Provider, string> = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com" };

const GATEWAY_RE = /^https:\/\/gateway\.ai\.cloudflare\.com\/v1\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** The gateway's base URL, or null when it is not set up (or set up wrongly). Pure. */
export function gatewayBase(env: Env = process.env): string | null {
  const url = env.CF_AI_GATEWAY_URL?.trim().replace(/\/+$/, "");
  if (url) return GATEWAY_RE.test(url) ? url : null;
  const account = env.CF_ACCOUNT_ID?.trim(), id = env.CF_AI_GATEWAY_ID?.trim();
  return account && id && ID_RE.test(account) && ID_RE.test(id) ? `https://gateway.ai.cloudflare.com/v1/${account}/${id}` : null;
}

/** Where a provider's SDK should send requests. Pure. */
export function baseFor(provider: Provider, env: Env = process.env): string {
  const gw = gatewayBase(env);
  return gw ? `${gw}/${provider}` : DIRECT[provider];
}

/** How long the gateway may cache this call's answer, in seconds (0: not cached). Pure. */
export function cacheTtl(wanted: boolean, env: Env = process.env): number {
  if (!wanted) return 0;
  const n = Number(env.CF_AI_GATEWAY_CACHE_TTL);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 30 * 86_400) : 0;
}

/** The gateway headers for one client: the feature that made the calls, caching, and the gateway's token. Pure. */
export function gatewayHeaders(o: { feature: string; cache?: boolean }, env: Env = process.env): Record<string, string> {
  if (!gatewayBase(env)) return {};
  const feature = o.feature.replace(/[^\w.:-]/g, "_").slice(0, 60) || "ai";
  const h: Record<string, string> = { "cf-aig-metadata": JSON.stringify({ app: "youbank", feature }) };
  const ttl = cacheTtl(!!o.cache, env);
  if (ttl) h["cf-aig-cache-ttl"] = String(ttl);
  const token = env.CF_AI_GATEWAY_TOKEN?.trim();
  if (token) h["cf-aig-authorization"] = `Bearer ${token}`;
  return h;
}

/** Statuses that mean the gateway, not the provider, could not carry the request. Pure. */
export const gatewayFailed = (status: number) => status === 502 || status === 504 || (status >= 520 && status <= 527);

/** A body that can be sent a second time (a stream cannot). Pure. */
const replayable = (b: unknown) => b == null || typeof b === "string" || b instanceof ArrayBuffer || ArrayBuffer.isView(b) || (typeof FormData !== "undefined" && b instanceof FormData) || (typeof URLSearchParams !== "undefined" && b instanceof URLSearchParams) || (typeof Blob !== "undefined" && b instanceof Blob);

/**
 * fetch for an SDK pointed at the gateway: when the gateway does not answer, or answers that it could not
 * reach the provider, the same request goes straight to the provider (without the gateway's headers).
 */
export function failover(provider: Provider, env: Env = process.env, base: typeof fetch = fetch): typeof fetch {
  const gw = gatewayBase(env);
  if (!gw) return base;
  const from = `${gw}/${provider}`, to = DIRECT[provider];
  const direct = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.startsWith(from)) return null;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    for (const k of [...headers.keys()]) if (k.startsWith("cf-aig-")) headers.delete(k);
    return base(to + url.slice(from.length), { ...init, headers });
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const canRetry = !(input instanceof Request) && replayable(init?.body);
    try {
      const res = await base(input, init);
      if (canRetry && gatewayFailed(res.status)) {
        const again = direct(input, init);
        if (again) { await res.body?.cancel().catch(() => undefined); return again; }
      }
      return res;
    } catch (e) {
      // Aborted by the caller (a timeout or a cancelled stream): not the gateway's fault, nothing to retry.
      if ((e as { name?: string })?.name === "AbortError" || init?.signal?.aborted || !canRetry) throw e;
      const again = direct(input, init);
      if (!again) throw e;
      return again;
    }
  }) as typeof fetch;
}

type ClientOpts = { apiKey: string | undefined; feature: string; timeout?: number; maxRetries?: number; cache?: boolean };

/** An OpenAI client, through the gateway when it is set up. */
export function openaiClient(o: ClientOpts): OpenAI {
  return new OpenAI({ apiKey: o.apiKey, timeout: o.timeout, maxRetries: o.maxRetries, baseURL: baseFor("openai"), defaultHeaders: gatewayHeaders(o), fetch: failover("openai") });
}

/** An Anthropic client, through the gateway when it is set up. */
export function anthropicClient(o: ClientOpts): Anthropic {
  return new Anthropic({ apiKey: o.apiKey, timeout: o.timeout, maxRetries: o.maxRetries, baseURL: baseFor("anthropic"), defaultHeaders: gatewayHeaders(o), fetch: failover("anthropic") });
}

/** For /api/health: whether the gateway is on and how it is set up (no secret values). Pure. */
export function gatewayStatus(env: Env = process.env) {
  const gw = gatewayBase(env);
  const misconfigured = !gw && !!(env.CF_AI_GATEWAY_URL?.trim() || env.CF_AI_GATEWAY_ID?.trim());
  return { on: !!gw, misconfigured, authenticated: !!env.CF_AI_GATEWAY_TOKEN?.trim(), cacheTtlSeconds: cacheTtl(true, env) };
}
