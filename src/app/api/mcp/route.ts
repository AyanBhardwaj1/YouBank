import { NextResponse } from "next/server";
import { db } from "@/db";
import { runAsUser } from "@/lib/ai/usage";
import { callerIp } from "@/lib/desktop/auth";
import { logError } from "@/lib/errors";
import { withinRate } from "@/lib/locks";
import { dispatch, ERR, type RpcResponse } from "@/lib/mcp/protocol";
import { mcpServer } from "@/lib/mcp/server";
import { authenticate } from "@/lib/mcp/store";
import { CORS, originOf, preflight } from "@/lib/mcp/http";
import { record } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * YouBank's MCP server (Streamable HTTP, stateless): POST one JSON-RPC message with
 * `Authorization: Bearer ybm_…` (a key from Settings → Connect AI apps) and get one JSON answer back.
 * The protocol is in src/lib/mcp/protocol.ts and the tools in src/lib/mcp/server.ts. GET is 405: this
 * server never opens a stream of its own. Limits: 600 calls an hour per person; repeated bad keys from
 * one address are slowed down.
 */
const json = (body: RpcResponse, status = 200, headers: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...CORS, "Access-Control-Expose-Headers": "WWW-Authenticate", ...headers } });
const rpcError = (code: number, message: string, status: number, headers: Record<string, string> = {}) => json({ jsonrpc: "2.0", id: null, error: { code, message } }, status, headers);

export async function POST(req: Request) {
  if (!db) return rpcError(ERR.internal, "YouBank is not configured on this server.", 503);
  const ip = callerIp(req);
  const who = await authenticate(req.headers.get("authorization")).catch(() => null);
  if (!who) {
    if (!(await withinRate(`mcp-bad-key:${ip}`, 30, 600_000).catch(() => true))) await new Promise((r) => setTimeout(r, 1500));
    // RFC 9728: say where to sign in, so an app that only has this URL can connect with OAuth.
    const meta = `${originOf(req.headers, req.url)}/.well-known/oauth-protected-resource/api/mcp`;
    return rpcError(ERR.invalidRequest, "Sign in to YouBank to connect, or send a key from Settings → Connect AI apps as Authorization: Bearer <key>.", 401, { "WWW-Authenticate": `Bearer realm="YouBank MCP", resource_metadata="${meta}"`, ...CORS });
  }
  if (!(await withinRate(`mcp:${who.userId}`, 600, 3_600_000))) return rpcError(ERR.internal, "This key has made many calls this hour. Try again later.", 429, { "Retry-After": "600" });
  let msg: unknown;
  try { msg = await req.json(); } catch { return rpcError(ERR.parse, "The body is not valid JSON.", 400); }
  try {
    const res = await runAsUser(who.userId, () => dispatch(msg, mcpServer(who.userId, who.keyName)));
    // Calls from the person's AI apps go in their research ledger too, when they keep one.
    const m = msg as { method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    if (m?.method === "tools/call" && res?.result) {
      const r = res.result as { content?: { text?: string }[]; structuredContent?: { sources?: { id: string; label: string; url: string }[] }; isError?: boolean };
      await record(who.userId, { kind: "mcp", subject: `${String(m.params?.name ?? "")} via ${who.keyName}`, model: "", prompt: JSON.stringify(m.params?.arguments ?? {}), output: r.content?.[0]?.text ?? "", sources: r.structuredContent?.sources ?? [], meta: { tool: m.params?.name, key: who.keyId, isError: !!r.isError } });
    }
    // A notification or a response: accepted, nothing to say.
    if (!res) return new Response(null, { status: 202 });
    return json(res);
  } catch (e) {
    logError(e, { where: "mcp" });
    return rpcError(ERR.internal, "The request could not be completed. Try again.", 500);
  }
}

export function GET() {
  return new Response("This MCP server answers POST requests only (no server-sent stream).", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  // Stateless: there is no session to end.
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

export const OPTIONS = preflight;
