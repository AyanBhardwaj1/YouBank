/** YouBank's MCP server: keys (src/lib/mcp/keys.ts) and the protocol (src/lib/mcp/protocol.ts). pnpm exec tsx scripts/test-mcp.ts */
import { KEYS_MAX, makeKey, matchKey, normalizeKeys, parseKey, viewOf } from "@/lib/mcp/keys";
import { dispatch, LATEST_PROTOCOL, withSources, type McpServer } from "@/lib/mcp/protocol";
import { mcpServer, PROMPTS } from "@/lib/mcp/server";
import { authServerMetadata, clientFrom, isMetadataClientId, parseAuthorize, pkceOk, redirectOk, redirectWith, resourceMetadata, secretFrom, secretMatches } from "@/lib/mcp/oauth";
import { createHash } from "node:crypto";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

async function main() {
  console.log("keys");
  const { key, stored } = makeKey("user_AbC-123:x", "  Claude\non my laptop  ", "2026-11-06T00:00:00Z");
  ok("a key starts ybm_ and names its account", [key.startsWith("ybm_"), parseKey(`Bearer ${key}`)?.userId], [true, "user_AbC-123:x"]);
  ok("only the hash is stored, and the name is cleaned", [JSON.stringify(stored).includes(key.split(".")[1]), stored.hash.length, stored.name], [false, 64, "Claude on my laptop"]);
  ok("the hint shows the last four characters only", stored.hint, `ybm_…${key.slice(-4)}`);
  ok("the secret matches its stored key", matchKey([stored], parseKey(key)!.secret)?.id, stored.id);
  ok("another secret does not", matchKey([stored], "x".repeat(43)), null);
  ok("junk is not a key", [parseKey(""), parseKey("Bearer ybd_abc"), parseKey("ybm_abc"), parseKey(`ybm_${"a".repeat(10)}.short`)], [null, null, null, null]);
  ok("a tampered account part is refused", parseKey(key.replace(/^ybm_./, "ybm_~")), null);
  ok("stored keys: well-formed, one per id, at most KEYS_MAX", normalizeKeys([...Array.from({ length: 12 }, () => makeKey("u", "k").stored), stored, stored, { id: "zz", hash: "x" }]).length, KEYS_MAX);
  ok("Settings never sees the hash", Object.keys(viewOf(stored)).includes("hash"), false);

  console.log("the protocol");
  const calls: string[] = [];
  const server: McpServer = {
    name: "youbank", title: "YouBank research", version: "1.0.0", instructions: "Cite sources.",
    tools: [{ name: "get_company_financials", title: "Fundamentals", description: "d", inputSchema: { type: "object" } }, { name: "boom", title: "Boom", description: "d", inputSchema: { type: "object" } }],
    call: async (name, args) => { calls.push(`${name}:${JSON.stringify(args)}`); if (name === "boom") throw new Error("It broke."); return withSources(JSON.stringify({ revenue: 4520.5, source: "S1" }), [{ id: "S1", label: "SNOW XBRL", url: "https://data.sec.gov/x" }]); },
  };
  const init = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }, server) as { result: { protocolVersion: string; capabilities: unknown; serverInfo: { name: string } } };
  ok("initialize echoes a version we support", [init.result.protocolVersion, init.result.serverInfo.name, init.result.capabilities], ["2025-06-18", "youbank", { tools: { listChanged: false } }]);
  const initNew = await dispatch({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }, server) as { result: { protocolVersion: string } };
  ok("an unknown version gets our newest", initNew.result.protocolVersion, LATEST_PROTOCOL);
  ok("a notification gets no reply", await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }, server), null);
  ok("ping", await dispatch({ jsonrpc: "2.0", id: "p", method: "ping" }, server), { jsonrpc: "2.0", id: "p", result: {} });
  const list = await dispatch({ jsonrpc: "2.0", id: 3, method: "tools/list" }, server) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  ok("tools/list: every tool, marked read-only", list.result.tools.map((t) => [t.name, t.annotations.readOnlyHint]), [["get_company_financials", true], ["boom", true]]);
  const call = await dispatch({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_company_financials", arguments: { ticker: "SNOW" } } }, server) as { result: { content: { type: string; text: string }[]; structuredContent: { result: unknown; sources: unknown[] }; isError: boolean } };
  ok("tools/call: text with its sources, and structured content", [call.result.isError, call.result.content[0].text.includes("[S1] SNOW XBRL: https://data.sec.gov/x"), call.result.structuredContent.result], [false, true, { revenue: 4520.5, source: "S1" }]);
  ok("the arguments reach the tool", calls[0], 'get_company_financials:{"ticker":"SNOW"}');
  const boom = await dispatch({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "boom" } }, server) as { result: { isError: boolean; content: { text: string }[] } };
  ok("a tool that throws is a result with isError, with no raw error text by default", [boom.result.isError, boom.result.content[0].text], [true, "The tool failed. Try again."]);
  const screened = await dispatch({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "boom" } }, { ...server, describeError: () => "Screened." }) as { result: { content: { text: string }[] } };
  ok("the server's screen decides what a failure says", screened.result.content[0].text, "Screened.");
  ok("a tool's own error JSON is isError too", withSources(JSON.stringify({ error: "Unknown ticker" }), []).isError, true);
  const unknown = await dispatch({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "rm_rf" } }, server) as { error: { code: number } };
  ok("an unknown tool is invalid params", unknown.error.code, -32602);
  ok("an unknown method", ((await dispatch({ jsonrpc: "2.0", id: 7, method: "resources/list" }, server)) as { error: { code: number } }).error.code, -32601);
  ok("not JSON-RPC 2.0", ((await dispatch({ id: 8, method: "ping" }, server)) as { error: { code: number } }).error.code, -32600);
  ok("a batch is refused (removed from the protocol in 2025-06-18)", ((await dispatch([{ jsonrpc: "2.0", id: 9, method: "ping" }], server)) as { error: { code: number } }).error.code, -32600);
  ok("a response from the client is accepted quietly", await dispatch({ jsonrpc: "2.0", id: 10, result: {} }, server), null);

  console.log("prompts");
  const withPrompts: McpServer = { ...server, prompts: [{ name: "red_team", title: "Red team", description: "d", arguments: [{ name: "ticker", description: "t", required: true }], build: (a) => `against ${a.ticker}` }] };
  const init2 = await dispatch({ jsonrpc: "2.0", id: 20, method: "initialize", params: {} }, withPrompts) as { result: { capabilities: Record<string, unknown> } };
  ok("prompts are announced only when there are some", [Object.keys(init2.result.capabilities), Object.keys(init.result.capabilities as object)], [["tools", "prompts"], ["tools"]]);
  const pl = await dispatch({ jsonrpc: "2.0", id: 21, method: "prompts/list" }, withPrompts) as { result: { prompts: Record<string, unknown>[] } };
  ok("prompts/list has no code in it", pl.result.prompts, [{ name: "red_team", title: "Red team", description: "d", arguments: [{ name: "ticker", description: "t", required: true }] }]);
  const pg = await dispatch({ jsonrpc: "2.0", id: 22, method: "prompts/get", params: { name: "red_team", arguments: { ticker: " snow " } } }, withPrompts) as { result: { messages: { role: string; content: { text: string } }[] } };
  ok("prompts/get writes the message from the arguments", [pg.result.messages[0].role, pg.result.messages[0].content.text], ["user", "against snow"]);
  ok("a missing required argument and an unknown prompt are invalid params", [((await dispatch({ jsonrpc: "2.0", id: 23, method: "prompts/get", params: { name: "red_team" } }, withPrompts)) as { error: { code: number } }).error.code, ((await dispatch({ jsonrpc: "2.0", id: 24, method: "prompts/get", params: { name: "nope" } }, withPrompts)) as { error: { code: number } }).error.code], [-32602, -32602]);
  const real = mcpServer("u");
  const names = new Set(real.tools.map((t) => t.name));
  const named = PROMPTS.flatMap((p) => (p.build({ ticker: "SNOW", form: "10-Q" }).match(/\b[a-z]+_[a-z_]+\b/g) ?? []).filter((w) => /^(get|book|ticker|filing|search|read|edgar|form)_/.test(w)));
  ok("every tool a prompt names is one the server offers", named.filter((n) => !names.has(n)), []);
  ok("the server offers four prompts, each asking for citations", PROMPTS.map((p) => [p.name, p.build({ ticker: "snow" }).includes("source id")]), [["book_review", true], ["red_team", true], ["what_changed", true], ["earnings_prep", true]]);
  ok("a ticker argument is cleaned", PROMPTS[1].build({ ticker: "$snow" }).includes("position in SNOW."), true);

  console.log("oauth");
  const O = "https://youbank.example";
  ok("resource metadata points at this server as its authorization server", [resourceMetadata(O).resource, resourceMetadata(O).authorization_servers], ["https://youbank.example/api/mcp", [O]]);
  const as = authServerMetadata(O);
  ok("authorization server: code flow, S256 only, public or confidential clients, registration and metadata documents", [as.response_types_supported, as.code_challenge_methods_supported, as.token_endpoint_auth_methods_supported, !!as.registration_endpoint, as.client_id_metadata_document_supported], [["code"], ["S256"], ["none", "client_secret_post", "client_secret_basic"], true, true]);
  ok("redirects: https, or http on localhost; nothing else", [redirectOk("https://claude.ai/api/mcp/auth_callback"), redirectOk("http://localhost:6274/cb"), redirectOk("http://127.0.0.1:9/x"), redirectOk("http://evil.example/cb"), redirectOk("javascript:alert(1)"), redirectOk("https://a.example/cb#frag")], [true, true, true, false, false, false]);
  ok("a client needs valid redirect URIs; public or confidential, nothing else", [("client" in clientFrom({ redirect_uris: ["https://claude.ai/cb"], client_name: "Claude" }, "ybc_x")), ("error" in clientFrom({ redirect_uris: [] }, "x")), (clientFrom({ redirect_uris: ["https://a/cb"], token_endpoint_auth_method: "client_secret_basic" }, "x") as { client: { auth_method: string } }).client.auth_method, ("error" in clientFrom({ redirect_uris: ["https://a/cb"], token_endpoint_auth_method: "private_key_jwt" }, "x"))], [true, true, "client_secret_basic", true]);
  const secretHash = createHash("sha256").update("s3cret").digest("hex");
  ok("HTTP Basic: split at the first colon, form-decoded, malformed input refused", [secretFrom({}, `Basic ${Buffer.from("c1:a:b").toString("base64")}`), secretFrom({}, `Basic ${Buffer.from("c%201:p+q%3A").toString("base64")}`), secretFrom({}, `Basic ${Buffer.from("nocolon").toString("base64")}`), secretFrom({}, `Basic ${Buffer.from("c1:%E0%A4%A").toString("base64")}`)], [{ id: "c1", secret: "a:b" }, { id: "c 1", secret: "p q:" }, { id: null, secret: null }, { id: "c1", secret: "%E0%A4%A" }]);
  ok("client secrets: form field or HTTP Basic, compared to the stored hash", [secretFrom({ client_id: "c1", client_secret: "s3cret" }, null), secretFrom({}, `Basic ${Buffer.from("c1:s3cret").toString("base64")}`), secretMatches("s3cret", secretHash), secretMatches("nope", secretHash), secretMatches(null, secretHash), secretMatches(null, undefined)], [{ id: "c1", secret: "s3cret" }, { id: "c1", secret: "s3cret" }, true, false, false, true]);
  ok("metadata-document client ids are https URLs with a path", [isMetadataClientId("https://claude.ai/oauth/client.json"), isMetadataClientId("https://claude.ai"), isMetadataClientId("ybc_abc")], [true, false, false]);
  const verifier = "a".repeat(20) + "B".repeat(23);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const q = { response_type: "code", client_id: "ybc_x", redirect_uri: "https://claude.ai/cb", code_challenge: challenge, code_challenge_method: "S256", state: "s1", resource: `${O}/api/mcp` };
  ok("a good authorization request parses", "req" in parseAuthorize(q, O), true);
  ok("PKCE must be S256; the resource must be this server", [("error" in parseAuthorize({ ...q, code_challenge_method: "plain" }, O)), ("error" in parseAuthorize({ ...q, resource: "https://other.example/api/mcp" }, O)), ("error" in parseAuthorize({ ...q, response_type: "token" }, O))], [true, true, true]);
  ok("PKCE: the verifier must hash to the challenge", [pkceOk(verifier, challenge), pkceOk(verifier + "x", challenge), pkceOk("short", challenge)], [true, false, false]);
  ok("the redirect carries the code, state and issuer, keeping its own query", redirectWith("https://a.example/cb?x=1", { code: "c", state: "s", iss: O }), "https://a.example/cb?x=1&code=c&state=s&iss=https%3A%2F%2Fyoubank.example");

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();
