/**
 * The load test's sandbox for the app server, loaded with NODE_OPTIONS="--import ./scripts/load/offline.mjs"
 * into `next start` only. It changes no app code:
 * - outbound requests may reach only localhost and Neon (the test branch's database and auth); FMP,
 *   SEC, Nasdaq, the government sources and everything else are refused, so a load test never
 *   spends a real quota or bothers a real service;
 * - OpenAI answers with a canned, streamed reply (about 1.5 s, like a short real one), so the chat
 *   scenario exercises the whole path without a key or a bill;
 * - it counts database queries (Neon's HTTP /sql calls) and auth calls per second into
 *   LOADTEST_STATS, which is how the load test reports database queries per second.
 * It refuses to load on Vercel.
 */
import { writeFileSync } from "node:fs";

if (process.env.VERCEL) throw new Error("scripts/load/offline.mjs is for local load tests only");

const real = globalThis.fetch;
const started = Date.now();
const counts = { sql: 0, auth: 0, openai: 0, blocked: 0 };
const perSecond = new Map();
const blockedHosts = new Map();
const tick = (kind) => {
  counts[kind]++;
  if (kind !== "sql") return;
  const s = Math.floor((Date.now() - started) / 1000);
  perSecond.set(s, (perSecond.get(s) ?? 0) + 1);
};

const statsFile = process.env.LOADTEST_STATS;
if (statsFile) {
  const flush = () => {
    try { writeFileSync(statsFile, JSON.stringify({ startedAt: started, at: Date.now(), counts, perSecond: Object.fromEntries(perSecond), blockedHosts: Object.fromEntries(blockedHosts) })); } catch { /* ignore */ }
  };
  setInterval(flush, 1_000).unref();
  process.on("exit", flush);
}

// Only the test branch's own database and auth hosts, taken from the environment the server was started
// with; any other Neon host (production's, say) is refused like every other outside service.
const hostOf = (v) => { try { return new URL(v.replace(/^postgres(ql)?:/, "https:")).hostname; } catch { return ""; } };
const dbHost = hostOf(process.env.DATABASE_URL ?? "");
const authHost = hostOf(process.env.NEON_AUTH_BASE_URL ?? "");
if (!dbHost || !authHost) throw new Error("Start the load-test server with DATABASE_URL and NEON_AUTH_BASE_URL set to the test branch");
const neonHosts = new Set([dbHost, dbHost.replace("-pooler.", "."), authHost]);
// The HTTP driver sends every query to the region's API host (api.<region>.neon.tech) with the
// connection string in a header; production uses the same host, so the header must name this branch.
const apiHost = dbHost.replace(/^[^.]+\./, "api.");
const endpointId = dbHost.split(".")[0].replace(/-pooler$/, "");
const allowed = (host) => host === "localhost" || host === "127.0.0.1" || host === "::1" || neonHosts.has(host) || host === apiHost;
const headerOf = (input, init, name) => new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get(name) ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REPLY = "Here is a short answer from the load-test model. It stands in for a real reply so the whole chat path runs: streaming, usage, the ledger and the limits.".split(" ");

function openaiResponse(url, init) {
  if (url.pathname.endsWith("/models")) {
    return new Response(JSON.stringify({ object: "list", data: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini"].map((id) => ({ id, object: "model", created: 0, owned_by: "openai" })) }), { headers: { "content-type": "application/json" } });
  }
  let body = {};
  try { body = JSON.parse(typeof init?.body === "string" ? init.body : "{}"); } catch { /* not JSON */ }
  const model = body.model ?? "gpt-5.6-luna";
  const usage = { input_tokens: 1200, input_tokens_details: { cached_tokens: 0 }, output_tokens: 90, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 1290 };
  const text = REPLY.join(" ");
  const done = { id: `resp_${Math.random().toString(36).slice(2)}`, object: "response", created_at: Math.floor(Date.now() / 1000), status: "completed", model,
    output: [{ id: "msg_1", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] }], output_text: text, usage };
  if (!body.stream) return new Response(JSON.stringify(done), { headers: { "content-type": "application/json" } });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let seq = 0;
      const send = (type, data) => controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: seq++, ...data })}\n\n`));
      send("response.created", { response: { ...done, status: "in_progress", output: [], usage: null } });
      for (let i = 0; i < REPLY.length; i += 3) {
        await sleep(90);
        send("response.output_text.delta", { item_id: "msg_1", output_index: 0, content_index: 0, delta: `${REPLY.slice(i, i + 3).join(" ")} ` });
      }
      send("response.completed", { response: done });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream" } });
}

globalThis.fetch = async function sandboxedFetch(input, init) {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(href);
  if (url.hostname === "api.openai.com") { tick("openai"); return openaiResponse(url, init ?? (typeof input === "object" && !(input instanceof URL) ? { body: await input.clone().text() } : undefined)); }
  if (!allowed(url.hostname)) {
    tick("blocked");
    blockedHosts.set(url.hostname, (blockedHosts.get(url.hostname) ?? 0) + 1);
    throw new TypeError(`fetch failed (blocked by the load-test sandbox: ${url.hostname})`);
  }
  if (url.hostname === apiHost && !headerOf(input, init, "neon-connection-string").includes(endpointId)) {
    tick("blocked");
    blockedHosts.set("another Neon database", (blockedHosts.get("another Neon database") ?? 0) + 1);
    throw new TypeError("fetch failed (blocked by the load-test sandbox: not the test branch)");
  }
  if (url.hostname === authHost) tick("auth");
  else if (url.pathname.endsWith("/sql")) tick("sql");
  return real(input, init);
};
