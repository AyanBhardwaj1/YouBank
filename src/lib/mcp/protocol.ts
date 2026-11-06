/**
 * The Model Context Protocol, as YouBank's server speaks it: JSON-RPC 2.0 over Streamable HTTP, one
 * request per POST answered with one JSON body (no server-initiated stream), stateless. Methods:
 * initialize (version negotiated: the client's when we support it, else our newest), ping, tools/list and
 * tools/call; notifications are accepted without a reply. A tool that fails answers a result with
 * `isError: true` and a message, so the model can read it and recover; only a malformed request or an
 * unknown method is a JSON-RPC error. Spec: https://modelcontextprotocol.io/specification. Pure, given the
 * server it is handed; tested in scripts/test-mcp.ts.
 */

export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;
export const LATEST_PROTOCOL = PROTOCOL_VERSIONS[0];

export type McpToolInfo = { name: string; title: string; description: string; inputSchema: Record<string, unknown>; /** Set on a tool that writes; others are read-only. */ annotations?: { readOnlyHint: boolean; destructiveHint?: boolean; idempotentHint?: boolean; openWorldHint?: boolean } };
export type McpCallResult = { text: string; data?: unknown; isError?: boolean };
/** A ready-made request an AI app shows in its slash menu; `build` writes the message from the arguments. */
export type McpPrompt = {
  name: string; title: string; description: string;
  arguments: { name: string; description: string; required?: boolean }[];
  build: (args: Record<string, string>) => string;
};

export type McpServer = {
  name: string; title: string; version: string; instructions: string;
  tools: McpToolInfo[];
  call: (name: string, args: Record<string, unknown>) => Promise<McpCallResult>;
  /** What a tool that threw may tell the model: screened and logged by the server (src/lib/errors failureMessage). */
  describeError?: (e: unknown) => string;
  prompts?: McpPrompt[];
};

type Id = string | number | null;
export type RpcResponse = { jsonrpc: "2.0"; id: Id; result?: unknown; error?: { code: number; message: string; data?: unknown } };

export const ERR = { parse: -32700, invalidRequest: -32600, methodNotFound: -32601, invalidParams: -32602, internal: -32603 } as const;
const fail = (id: Id, code: number, message: string): RpcResponse => ({ jsonrpc: "2.0", id, error: { code, message } });
const ok = (id: Id, result: unknown): RpcResponse => ({ jsonrpc: "2.0", id, result });

/** One JSON-RPC message handled. Null for a notification or a response (nothing to send back). */
export async function dispatch(msg: unknown, server: McpServer): Promise<RpcResponse | null> {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return fail(null, ERR.invalidRequest, "Send one JSON-RPC 2.0 message per request.");
  const m = msg as Record<string, unknown>;
  const hasId = "id" in m && (typeof m.id === "string" || typeof m.id === "number");
  const id: Id = hasId ? (m.id as string | number) : null;
  if (m.jsonrpc !== "2.0") return fail(id, ERR.invalidRequest, "jsonrpc must be \"2.0\".");
  // A response to something we never sent, or a notification: accepted, no reply.
  if (typeof m.method !== "string") return hasId && ("result" in m || "error" in m) ? null : fail(id, ERR.invalidRequest, "A request needs a method.");
  if (!hasId) return null;
  const params = (m.params && typeof m.params === "object" ? m.params : {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize": {
      const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
      return ok(id, {
        protocolVersion: (PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false }, ...(server.prompts?.length ? { prompts: { listChanged: false } } : {}) },
        serverInfo: { name: server.name, title: server.title, version: server.version },
        instructions: server.instructions,
      });
    }
    case "ping": return ok(id, {});
    case "prompts/list": return ok(id, { prompts: (server.prompts ?? []).map((p) => ({ name: p.name, title: p.title, description: p.description, arguments: p.arguments })) });
    case "prompts/get": {
      const p = (server.prompts ?? []).find((x) => x.name === params.name);
      if (!p) return fail(id, ERR.invalidParams, `Unknown prompt: ${typeof params.name === "string" ? params.name : "(none)"}. Call prompts/list for the prompts.`);
      const raw = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      const args: Record<string, string> = {};
      for (const a of p.arguments) {
        const v = typeof raw[a.name] === "string" ? (raw[a.name] as string).trim().slice(0, 200) : "";
        if (!v && a.required) return fail(id, ERR.invalidParams, `The prompt ${p.name} needs ${a.name}.`);
        if (v) args[a.name] = v;
      }
      return ok(id, { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.build(args) } }] });
    }
    case "tools/list": return ok(id, { tools: server.tools.map((t) => ({ ...t, annotations: t.annotations ?? { readOnlyHint: true, openWorldHint: true } })) });
    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!server.tools.some((t) => t.name === name)) return fail(id, ERR.invalidParams, `Unknown tool: ${name || "(none)"}. Call tools/list for the tools.`);
      const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? (params.arguments as Record<string, unknown>) : {};
      try {
        const r = await server.call(name, args);
        return ok(id, {
          content: [{ type: "text", text: r.text }],
          ...(r.data && typeof r.data === "object" && !Array.isArray(r.data) ? { structuredContent: r.data } : {}),
          isError: !!r.isError,
        });
      } catch (e) {
        return ok(id, { content: [{ type: "text", text: server.describeError?.(e) ?? "The tool failed. Try again." }], isError: true });
      }
    }
    default: return fail(id, ERR.methodNotFound, `Method not found: ${m.method}`);
  }
}

/**
 * A tool's result as an AI app should read it: the JSON the tool returned, then the sources it cited (the
 * `[S1]` ids in the result) with their links, so the app can show and check them.
 */
export function withSources(json: string, sources: { id: string; label: string; url: string }[]): McpCallResult {
  let data: unknown = null;
  try { data = JSON.parse(json); } catch { /* plain text */ }
  const err = data && typeof data === "object" && !Array.isArray(data) && typeof (data as { error?: unknown }).error === "string";
  const cites = sources.length ? `\n\nSources (cite by id):\n${sources.map((s) => `[${s.id}] ${s.label}: ${s.url}`).join("\n")}` : "";
  return {
    text: `${json}${cites}`,
    data: data && typeof data === "object" && !Array.isArray(data) ? { result: data, sources } : undefined,
    isError: !!err,
  };
}
