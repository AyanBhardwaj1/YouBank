/**
 * The hosted MCP server end to end, against a local Worker (`wrangler dev`) in front of a local YouBank:
 *   npx tsx test/mcp-local.ts <YouBank API key>
 * Lists YouBank's tools through it, calls a reading tool, and checks the approval gate on the writing one:
 * an AI app that can ask its person is asked first, and a "no" sends nothing.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const key = process.argv[2];
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); } };
const url = new URL("http://localhost:8787/mcp");

async function connect(answer?: "accept" | "decline") {
  const c = new Client({ name: "mcp-local-check", version: "1.0.0" }, { capabilities: answer ? { elicitation: {} } : {} });
  let asked = "";
  if (answer) c.setRequestHandler(ElicitRequestSchema, async (req) => { asked = req.params.message; return answer === "accept" ? { action: "accept", content: { confirm: true } } : { action: "decline" }; });
  await c.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${key}` } } }));
  return { c, asked: () => asked };
}

(async () => {
  const unauth = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  ok("without a key the hosted server refuses", unauth.status === 401);
  const { c } = await connect();
  const tools = (await c.listTools()).tools;
  ok("YouBank's tools come through", tools.length >= 10 && tools.some((t) => t.name === "book_status") && tools.some((t) => t.name === "propose_position"), tools.map((t) => t.name));
  ok("YouBank's prompts come through", (await c.listPrompts()).prompts.length >= 3);
  const status = await c.callTool({ name: "book_status", arguments: {} });
  ok("a reading tool answers from YouBank", !status.isError && JSON.stringify(status.content).length > 20, status);
  const args = { ticker: "MSFT", side: "long", thesis: "cf local check: hosted MCP gate", criteria: [] };
  const asker = await connect("decline");
  const no = await asker.c.callTool({ name: "propose_position", arguments: args });
  ok("an AI app that can ask is asked before a proposal is sent", asker.asked().includes("Needs you"), asker.asked());
  ok("…and a no sends nothing", JSON.stringify(no.content).includes("Not sent"), no);
  const yes = await connect("accept");
  const sent = await yes.c.callTool({ name: "propose_position", arguments: args });
  ok("…a yes sends it to YouBank", yes.asked().length > 0 && !JSON.stringify(sent.content).includes("Not sent"), sent);
  await Promise.all([c.close(), asker.c.close(), yes.c.close()]);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
