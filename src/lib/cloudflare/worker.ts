/**
 * YouBank's Cloudflare Worker (cloudflare/), seen from the app. The Worker hosts what runs best on Cloudflare:
 * - the Thesis Agent as an Agents SDK agent per thesis (a Durable Object with its own SQLite) that schedules its
 *   own check-ins and sleeps in between (`thesis`);
 * - the research ledger's sequencer, a Durable Object per person that appends one entry at a time (`ledger`);
 * - the nightly kill-criteria check as a Workflow, each book its own retried step (`workflow`);
 * - a hosted MCP server in front of YouBank's own (`mcp`, nothing to call from here).
 * The two sides trust each other through one shared secret (CF_WORKER_SECRET here, APP_SECRET in the Worker).
 *
 * Every part is optional: without CF_WORKER_URL and CF_WORKER_SECRET, or with a part named in CF_DISABLE
 * (comma-separated), the app does that job itself as before, and a call to a Worker that does not answer
 * falls back the same way. Server only.
 */
import { secretsMatch } from "@/lib/crm/crypto";
import { logError } from "@/lib/errors";

type Env = Record<string, string | undefined>;
export type CfPart = "thesis" | "ledger" | "workflow" | "mcp";
export const CF_PARTS: CfPart[] = ["thesis", "ledger", "workflow", "mcp"];

/** The Worker's address and secret, or null when not set up (or set up wrongly). Pure. */
export function workerConfig(env: Env = process.env): { url: string; secret: string } | null {
  const url = env.CF_WORKER_URL?.trim().replace(/\/+$/, "") ?? "";
  const secret = env.CF_WORKER_SECRET?.trim() ?? "";
  if (!url || secret.length < 32) return null;
  try {
    const u = new URL(url);
    // https only, except a local `wrangler dev` while developing.
    if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname) && env.NODE_ENV !== "production")) return null;
  } catch { return null; }
  return { url, secret };
}

/** Whether a part runs on Cloudflare. Pure. */
export function cfOn(part: CfPart, env: Env = process.env): boolean {
  if (!workerConfig(env)) return false;
  const off = (env.CF_DISABLE ?? "").split(",").map((s) => s.trim().toLowerCase());
  return !off.includes(part) && !off.includes("all");
}

/** A request from the Worker: the shared secret as a bearer token. */
export function fromWorker(req: Request, env: Env = process.env): boolean {
  const c = workerConfig(env);
  return !!c && secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${c.secret}`);
}

/**
 * A call to the Worker. Null when it is not set up, did not answer in time, or answered with an error (logged),
 * so the caller falls back to doing the job itself.
 */
export async function callWorker<T>(path: string, body?: unknown, opts: { timeoutMs?: number; method?: "GET" | "POST" | "DELETE" } = {}): Promise<T | null> {
  const c = workerConfig();
  if (!c) return null;
  try {
    const res = await fetch(`${c.url}${path}`, {
      method: opts.method ?? (body === undefined ? "GET" : "POST"),
      headers: { authorization: `Bearer ${c.secret}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8_000),
    });
    if (!res.ok) { logError(Object.assign(new Error(`Cloudflare Worker answered ${res.status} for ${path.split("?")[0]}`), { status: res.status }), { where: "cf-worker" }); return null; }
    return (await res.json()) as T;
  } catch (e) {
    logError(e, { where: "cf-worker" });
    return null;
  }
}

/** For /api/health: which parts run on Cloudflare, and whether the Worker answers. No secret values. */
export async function workerHealth(probe: boolean): Promise<{ configured: boolean; parts: Record<CfPart, boolean>; reachable?: boolean; version?: string }> {
  const parts = Object.fromEntries(CF_PARTS.map((p) => [p, cfOn(p)])) as Record<CfPart, boolean>;
  const configured = !!workerConfig();
  if (!configured || !probe) return { configured, parts };
  const h = await callWorker<{ ok: boolean; version?: string }>("/health", undefined, { timeoutMs: 5_000 });
  return { configured, parts, reachable: !!h?.ok, ...(h?.version ? { version: h.version } : {}) };
}
