/**
 * YouBank's Cloudflare Worker. Routes:
 * - GET  /health                          — up, and which build.
 * - POST /thesis/{id}/wake | /stop        — YouBank → the thesis's agent (shared secret).
 * - GET  /thesis/{id}                     — the agent's schedule and recent ticks (shared secret).
 * - POST /ledger/{userId}/append          — YouBank → the person's ledger sequencer (shared secret).
 * - GET  /ledger/{userId}?after=          — its head and entries, for a check against YouBank's copy (shared secret).
 * - DELETE /ledger/{userId}               — forget that person's copy (account deleted; shared secret).
 * - POST /workflows/book                  — YouBank's evening cron → a new kill-criteria Workflow (shared secret).
 * - GET  /workflows/book/{instance}       — that instance's status (shared secret).
 * - *    /mcp                             — the hosted MCP server (the person's YouBank API key as a bearer token).
 * See docs/cloudflare.md in the repository for set-up.
 */
import { getAgentByName } from "agents";
import { authorized } from "./app";
import type { Env } from "./env";
import { LedgerSequencer } from "./ledger";
import { YouBankMcp } from "./mcp";
import { bearer } from "./mcp-logic";
import { ThesisAgent } from "./thesis";
import { KillCriteriaWorkflow } from "./workflow";

export { LedgerSequencer, ThesisAgent, YouBankMcp, KillCriteriaWorkflow };

// Not exported: a Worker's main module may export only handlers and classes.
const VERSION = "youbank-cf 1.0.0";
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const mcp = YouBankMcp.serve("/mcp", { binding: "MCP" });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (path === "/health") return json({ ok: true, version: VERSION });

    if (path === "/mcp" || path.startsWith("/mcp/")) {
      const token = bearer(req);
      if (!token && req.method !== "OPTIONS") return json({ error: "Connect with a YouBank API key as a bearer token (Settings → Connect AI apps)." }, 401);
      // The key travels to the session as its props (the Agents SDK reads ctx.props), never into a log.
      const withProps = { waitUntil: (p: Promise<unknown>) => ctx.waitUntil(p), passThroughOnException: () => ctx.passThroughOnException(), props: { token } } as unknown as ExecutionContext;
      return mcp.fetch(req, env, withProps);
    }

    if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);

    let m = /^\/thesis\/(\d{1,10})(?:\/(wake|stop))?$/.exec(path);
    if (m) {
      const id = Number(m[1]);
      const agent = await getAgentByName(env.THESIS, `thesis-${id}`);
      if (m[2] === "wake" && req.method === "POST") return json(await agent.wake(id));
      if (m[2] === "stop" && req.method === "POST") return json(await agent.stop());
      if (!m[2] && req.method === "GET") return json(await agent.status());
      return json({ error: "Not found." }, 404);
    }

    m = /^\/ledger\/([\w-]{1,80})(\/append)?$/.exec(path);
    if (m) {
      const stub = env.LEDGER.get(env.LEDGER.idFromName(m[1]));
      if (m[2] && req.method === "POST") {
        const b = (await req.json().catch(() => null)) as { content?: unknown; base?: unknown } | null;
        if (!b || !b.content || typeof b.content !== "object") return json({ error: "What to append?" }, 400);
        const base = b.base && typeof b.base === "object" && Number.isInteger((b.base as { seq?: unknown }).seq) && typeof (b.base as { hash?: unknown }).hash === "string" ? (b.base as { seq: number; hash: string }) : null;
        return new Response(await stub.append(b.content as never, base), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
      if (!m[2] && req.method === "DELETE") return json(await stub.purge());
      if (!m[2] && req.method === "GET") return new Response(await stub.read(Number(url.searchParams.get("after") ?? 0) || 0, Number(url.searchParams.get("limit") ?? 200) || 200), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
      return json({ error: "Not found." }, 404);
    }

    if (path === "/workflows/book" && req.method === "POST") {
      const b = (await req.json().catch(() => ({}))) as { at?: unknown };
      const at = typeof b.at === "string" ? b.at.slice(0, 40) : new Date().toISOString();
      const instance = await env.BOOK_CHECK.create({ params: { at } });
      return json({ id: instance.id });
    }
    m = /^\/workflows\/book\/([\w-]{1,100})$/.exec(path);
    if (m && req.method === "GET") return json(await (await env.BOOK_CHECK.get(m[1])).status());

    return json({ error: "Not found." }, 404);
  },
} satisfies ExportedHandler<Env>;
