/**
 * YouBank's MCP server, hosted on Cloudflare (`/mcp` on this Worker) with the Agents SDK. Each MCP session is
 * its own Durable Object: it connects to YouBank's MCP endpoint (/api/mcp) with the person's API key, offers
 * exactly YouBank's tools, prompts and resources (so they are written and permission-checked in one place),
 * and adds what a stateful edge server is good at:
 * - an approval gate: a tool that writes (propose_position today) is shown to the person first through MCP
 *   elicitation when their AI app supports it, and only sent once they confirm; YouBank's own Needs you
 *   queue stays the second gate, because a proposal never becomes a position without the PM;
 * - a per-session log of every tool call (name, outcome, time taken; never the arguments) in the session's
 *   SQLite, readable by the session.
 *
 * Why McpAgent and not the stateless handler: the gate waits on the person mid-call and the log lives with the
 * session, which needs a session that persists. The person's key arrives as a bearer token and is kept only as
 * the session's props, never logged.
 */
import { McpAgent } from "agents/mcp";
// McpAgent serves MCP SDK v1 servers (the agents package says so at runtime); @modelcontextprotocol/server
// (v2) is installed only because the agents package imports it.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema, ListToolsRequestSchema, ReadResourceRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import type { Env } from "./env";
import { gateFor } from "./mcp-logic";

type Props = { token: string };

export class YouBankMcp extends McpAgent<Env, unknown, Props> {
  server = new Server({ name: "YouBank", version: "1.0.0" }, { capabilities: { tools: { listChanged: false }, prompts: {}, resources: {} } });
  private upstream: Client | null = null;
  private tools: Tool[] = [];

  private async yb(): Promise<Client> {
    if (this.upstream) return this.upstream;
    const token = this.props?.token;
    if (!token) throw new Error("Connect with a YouBank API key (Settings → Connect AI apps) as a bearer token.");
    const c = new Client({ name: "youbank-cloudflare-mcp", version: "1.0.0" });
    await c.connect(new StreamableHTTPClientTransport(new URL("/api/mcp", this.env.APP_URL), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    this.upstream = c;
    return c;
  }

  async init() {
    this.sql`create table if not exists calls (at text not null, tool text not null, outcome text not null, ms integer not null)`;
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const r = await (await this.yb()).listTools();
      this.tools = r.tools;
      return r;
    });
    this.server.setRequestHandler(CallToolRequestSchema, async (req) => {
      const t0 = Date.now();
      const name = req.params.name;
      if (!this.tools.length) this.tools = (await (await this.yb()).listTools()).tools;
      const gate = gateFor(this.tools.find((t) => t.name === name), !!this.server.getClientCapabilities()?.elicitation);
      if (gate) {
        const answer = await this.elicitInput({ message: gate.message, requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: gate.confirmTitle } }, required: ["confirm"] } }).catch(() => null);
        if (answer?.action !== "accept" || answer.content?.confirm !== true) {
          this.log(name, "declined", t0);
          return { content: [{ type: "text", text: "Not sent: you did not confirm it. Nothing was changed in YouBank." }] };
        }
      }
      try {
        const r = await (await this.yb()).callTool({ name, arguments: req.params.arguments ?? {} });
        this.log(name, r.isError ? "error" : "ok", t0);
        return r;
      } catch (e) {
        this.log(name, "failed", t0);
        throw e;
      }
    });
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => (await this.yb()).listPrompts());
    this.server.setRequestHandler(GetPromptRequestSchema, async (req) => (await this.yb()).getPrompt(req.params));
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => (await this.yb()).listResources());
    this.server.setRequestHandler(ReadResourceRequestSchema, async (req) => (await this.yb()).readResource(req.params));
  }

  private log(tool: string, outcome: string, t0: number) {
    this.sql`insert into calls (at, tool, outcome, ms) values (${new Date().toISOString()}, ${tool.slice(0, 80)}, ${outcome}, ${Date.now() - t0})`;
    this.sql`delete from calls where rowid not in (select rowid from calls order by rowid desc limit 1000)`;
  }
}
