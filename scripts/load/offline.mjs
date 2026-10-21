/**
 * The load test's sandbox for the app server, loaded with NODE_OPTIONS="--import ./scripts/load/offline.mjs"
 * into `next start` only. It changes no app code:
 * - outbound HTTP may reach only this machine; FMP, SEC, Nasdaq, OpenFIGI, the government sources and
 *   everything else are refused, so a load test never spends a real quota or bothers a real service.
 *   The database is a postgres:// connection (not fetch), so it is unaffected; sign-in is Better Auth,
 *   served by the app itself on its own database;
 * - OpenAI answers with a canned, streamed reply (about 1.5 s, like a short real one), so the chat
 *   scenario exercises the whole path without a key or a bill;
 * - it writes, every second, to LOADTEST_STATS: the event loop's delay (p50/p99/max since the last
 *   write, from perf_hooks), the process's CPU time so far, heap and RSS, and counts of blocked and
 *   mocked calls. CPU per request is the steadiest number on a shared machine: latency moves with
 *   whatever else is running, CPU spent per request much less. Database queries and
 *   connections are measured from Postgres itself by run.mjs (--db).
 * It refuses to load on Vercel.
 */
import { renameSync, writeFileSync } from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";

if (process.env.VERCEL) throw new Error("scripts/load/offline.mjs is for local load tests only");
const dbHost = (() => { try { return new URL((process.env.DATABASE_URL ?? "").replace(/^postgres(ql)?:/, "http:")).hostname; } catch { return ""; } })();
if (!dbHost) throw new Error("Start the load-test server with DATABASE_URL set to the test database");
if (!["localhost", "127.0.0.1", "::1"].includes(dbHost) && process.env.LOADTEST_DB_CONFIRM !== dbHost) {
  throw new Error(`The load-test server runs on a local database, or on a test branch named exactly in LOADTEST_DB_CONFIRM (got ${dbHost})`);
}

const real = globalThis.fetch;
const started = Date.now();
const counts = { openai: 0, blocked: 0 };
const blockedHosts = new Map();
const RESOLUTION_MS = 10;
const loop = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
loop.enable();
const lagSeconds = [];

const statsFile = process.env.LOADTEST_STATS;
const flush = () => {
  // The histogram counts the sampling interval itself (RESOLUTION_MS) as delay; only the excess is lag.
  const ms = (ns) => Math.max(0, Math.round(ns / 1e4) / 100 - RESOLUTION_MS);
  lagSeconds.push({ at: Date.now(), p50: ms(loop.percentile(50)), p99: ms(loop.percentile(99)), max: ms(loop.max) });
  if (lagSeconds.length > 3_600) lagSeconds.shift();
  loop.reset();
  if (!statsFile) return;
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  try {
    // Written whole, then renamed into place, so a reader never sees half a file.
    writeFileSync(`${statsFile}.tmp`, JSON.stringify({ startedAt: started, at: Date.now(), counts, blockedHosts: Object.fromEntries(blockedHosts), lag: lagSeconds, cpuMs: Math.round((cpu.user + cpu.system) / 1000), heapMB: Math.round(mem.heapUsed / 1048576), rssMB: Math.round(mem.rss / 1048576) }));
    renameSync(`${statsFile}.tmp`, statsFile);
  } catch { /* ignore */ }
};
setInterval(flush, 1_000).unref();
process.on("exit", flush);

const allowed = (host) => host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
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
  if (url.hostname === "api.openai.com") { counts.openai++; return openaiResponse(url, init ?? (typeof input === "object" && !(input instanceof URL) ? { body: await input.clone().text() } : undefined)); }
  if (!allowed(url.hostname)) {
    counts.blocked++;
    blockedHosts.set(url.hostname, (blockedHosts.get(url.hostname) ?? 0) + 1);
    throw new TypeError(`fetch failed (blocked by the load-test sandbox: ${url.hostname})`);
  }
  return real(input, init);
};
