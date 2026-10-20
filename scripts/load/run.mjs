/**
 * The load test. Signed-in virtual users (from setup.mjs) browse a LOCAL production build with a
 * realistic mix: page loads, the Newsroom feed and bell, company data, the CRM inbox and pipeline,
 * Studio documents, the plan page (entitlements and AI allowance), copy trading, algo, quant, calendar,
 * Edge, deals and briefs, and a small share of AI chat (answered by the sandbox's mock). Meanwhile some
 * users hold live-update streams open on their documents while a writer edits them, which measures how
 * fast an edit reaches everyone. With --mode idle-streams it holds streams open and does nothing else.
 *
 * Reports p50/p95/p99 latency, error rate and requests/s per scenario; from Postgres (--db, the test
 * database): statements run (pg_stat_statements when installed, else transactions), statements per
 * request, the app's connections in use (sampled every second: open and active), and the slowest
 * statements by total time; from the server sandbox (--stats, its LOADTEST_STATS file): event-loop delay
 * and memory.
 *
 *   node scripts/load/run.mjs --base http://localhost:3301 --users /tmp/loadtest-users.json --db $DATABASE_URL \
 *     --vus 100 --streams 20 --duration 60 --stats /tmp/server-stats.json --label after --out /tmp/after.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { guardTarget, parseArgs, percentile } from "./common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://localhost:3301", users: "", vus: "60", streams: "20", duration: "60", stats: "", out: "", label: "run", mode: "mixed", think: "1000-3000", sessions: "fresh", db: "", top: "15" });
const base = guardTarget(args.base);
const users = JSON.parse(readFileSync(args.users, "utf8"));
const durationMs = Number(args.duration) * 1000;
const [thinkMin, thinkMax] = args.think.split("-").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readStats = () => { try { return JSON.parse(readFileSync(args.stats, "utf8")); } catch { return null; } };

/* Postgres-side measurements: read-only views, on a local database (or the confirmed test branch). */
const pg = (() => {
  if (!args.db) return null;
  const host = new URL(args.db.replace(/^postgres(ql)?:/, "http:")).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host) && process.env.LOADTEST_DB_CONFIRM !== host) throw new Error(`--db must be the local test database, or the test branch named in LOADTEST_DB_CONFIRM (got ${host})`);
  return postgres(args.db, { max: 1, prepare: false, onnotice: () => undefined, connection: { application_name: "loadtest-probe" } });
})();
const statementsView = pg ? await pg`select n.nspname as schema from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'`.then((r) => (r[0] ? `"${r[0].schema}".pg_stat_statements` : null)).catch(() => null) : null;
async function dbCounters() {
  if (!pg) return null;
  const [d] = await pg`select xact_commit + xact_rollback as xacts from pg_stat_database where datname = current_database()`;
  let statements = null;
  if (statementsView) {
    const [s] = await pg.unsafe(`select coalesce(sum(calls), 0)::bigint as calls from ${statementsView} s join pg_roles r on r.oid = s.userid where s.dbid = (select oid from pg_database where datname = current_database()) and s.query not ilike '%pg_stat%' and s.query not ilike '%pg_extension%'`);
    statements = Number(s.calls);
  }
  return { xacts: Number(d.xacts), statements };
}
const connSamples = [];
async function sampleConnections() {
  const [c] = await pg`select count(*)::int as open, count(*) filter (where state = 'active')::int as active, count(*) filter (where state = 'idle in transaction')::int as idle_tx
    from pg_stat_activity where datname = current_database() and application_name = 'youbank'`;
  connSamples.push(c);
}
const results = new Map();
const record = (name, ms, ok, status) => {
  const r = results.get(name) ?? { lat: [], errors: 0, statuses: {} };
  r.lat.push(ms);
  if (!ok) r.errors++;
  r.statuses[status] = (r.statuses[status] ?? 0) + 1;
  results.set(name, r);
};

const withDocs = users.filter((u) => u.docId);

/** A browser-like cookie jar per user: every response's Set-Cookie (a re-minted session, say) is kept. */
function keepCookies(u, res) {
  const set = res.headers.getSetCookie?.() ?? [];
  if (!set.length) return;
  const jar = new Map(u.cookie.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
  for (const c of set) { const pair = c.split(";")[0]; jar.set(pair.split("=")[0], pair); }
  u.cookie = [...jar.values()].join("; ");
}
/** fetch as this user: their cookies on the request, and any new ones kept. */
async function as(u, path, init = {}) {
  // A request that hangs counts as a failure after 30 seconds instead of stalling its virtual user (streams pass their own signal).
  const res = await fetch(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(30_000), ...init, headers: { ...(init.headers ?? {}), cookie: u.cookie } });
  keepCookies(u, res);
  return res;
}
const get = (path) => (u) => as(u, typeof path === "function" ? path(u) : path);
const MIX = [
  { name: "page /app", weight: 10, run: get("/app") },
  { name: "page /app/news", weight: 5, run: get("/app/news") },
  { name: "news feed", weight: 12, run: get("/api/news/feed") },
  { name: "notification bell", weight: 12, run: get("/api/news/notifications") },
  { name: "companies", weight: 7, run: get("/api/companies?tickers=AAPL,NVDA,XOM,JPM,KO") },
  { name: "deals", weight: 3, run: get("/api/news/deals") },
  { name: "brief", weight: 4, run: get("/api/news/brief") },
  { name: "crm inbox", weight: 5, run: get("/api/crm/threads") },
  { name: "crm pipeline", weight: 5, run: get("/api/crm/deals") },
  { name: "studio list", weight: 3, run: get("/api/studio") },
  { name: "studio document", weight: 4, run: (u) => (u.docId ? as(u, `/api/studio/${u.docId}`) : null) },
  { name: "plan + ai allowance", weight: 4, run: get("/api/billing/status") },
  { name: "edge", weight: 2, run: get("/api/edge") },
  { name: "copy follows", weight: 3, run: get("/api/copy/follows") },
  { name: "algo hub", weight: 3, run: get("/api/algo/strategies") },
  { name: "quant status", weight: 2, run: get("/api/quant/status") },
  { name: "calendar upcoming", weight: 3, run: get("/api/calendar/upcoming?hours=72") },
  { name: "ai chat (mock)", weight: 4, run: (u) => as(u, "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "What moved oil prices this week?" }], context: { ticker: "XOM", panels: [] } }) }) },
];
const total = MIX.reduce((n, s) => n + s.weight, 0);
const STREAMED = new Set(["ai chat (mock)"]);
const pick = () => { let r = Math.random() * total; for (const s of MIX) if ((r -= s.weight) < 0) return s; return MIX[0]; };

async function virtualUser(u, until) {
  await sleep(Math.random() * 2_000); // stagger the start
  while (Date.now() < until) {
    const s = pick();
    const t0 = performance.now();
    let status = 0, ok = false;
    try {
      const res = await s.run(u);
      if (!res) continue;
      status = res.status;
      const body = await res.arrayBuffer(); // the whole body, streamed chat included
      ok = status < 400;
      // A 200 can still carry per-ticker failures; count those as failures too.
      if (ok && s.name === "companies") {
        const data = JSON.parse(new TextDecoder().decode(body));
        if (Object.values(data).some((c) => c && typeof c === "object" && "error" in c)) { ok = false; status = "200 with ticker errors"; }
      }
    } catch { status = -1; }
    record(s.name, performance.now() - t0, ok, status);
    await sleep(thinkMin + Math.random() * (thinkMax - thinkMin));
  }
}

/**
 * One browser tab following a document: like the Studio page, it loads the document (and its stream
 * cursor) first, then follows from there, reconnecting like EventSource after each planned close.
 */
async function follower(u, until, st) {
  let last = 0;
  try { last = Number((await (await as(u, `/api/studio/${u.docId}`)).json()).cursor) || 0; } catch { /* start from the beginning */ }
  while (Date.now() < until) {
    const ctrl = new AbortController();
    const stop = setTimeout(() => ctrl.abort(), Math.max(0, until - Date.now()));
    try {
      const res = await as(u, `/api/studio/${u.docId}/stream?since=${last}`, { headers: last ? { "last-event-id": String(last) } : {}, signal: ctrl.signal });
      if (!res.ok) { st.errors++; await sleep(1_000); continue; }
      st.connections++;
      const dec = new TextDecoder();
      let buf = "";
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2);
          const type = /^event: (.*)$/m.exec(frame)?.[1];
          const id = Number(/^id: (.*)$/m.exec(frame)?.[1]);
          if (Number.isFinite(id) && id > last) last = id;
          if (type !== "change") continue;
          st.events++;
          const data = JSON.parse(/^data: (.*)$/m.exec(frame)?.[1] ?? "{}");
          const sent = /^lt:(\d+)$/.exec(data.label ?? "")?.[1];
          if (sent && Number(sent) >= t0) st.propagation.push(Date.now() - Number(sent));
        }
      }
    } catch {
      if (ctrl.signal.aborted) break;
      st.errors++;
    } finally { clearTimeout(stop); }
    await sleep(1_000); // the stream's retry
  }
}

/** A teammate editing: one cell every few seconds, labeled with the send time. */
async function writer(u, until, st) {
  let n = 0;
  await sleep(Math.random() * 3_000);
  while (Date.now() < until) {
    const cell = `A${(n++ % 50) + 1}`;
    const res = await as(u, `/api/studio/${u.docId}`, {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ patches: [{ op: "cells", sheet: u.sheetId, cells: { [cell]: { v: n } } }], undo: [{ op: "cells", sheet: u.sheetId, cells: { [cell]: null } }], label: `lt:${Date.now()}` }),
    }).catch(() => null);
    st.writes++;
    if (!res?.ok) st.writeErrors++;
    else await res.arrayBuffer();
    await sleep(4_000 + Math.random() * 2_000);
  }
}

// Sessions carry a short-lived signed cookie (Better Auth's session_data cookie cache). --sessions fresh
// (the default) mints everyone a new one first, the way the browser's auth client does
// (/api/auth/get-session, which the auth rate limit does not count), so the run measures the app.
// --sessions stale drops it instead: people whose cookie expired while they kept a page open, so their
// first request reads the session from the database, which is how a real crowd looks after a while.
const dropSessionData = (u) => { u.cookie = u.cookie.split("; ").filter((c) => !c.split("=")[0].includes("session_data")).join("; "); };
if (args.sessions === "stale") users.forEach(dropSessionData);
else {
  process.stdout.write("refreshing sessions");
  let i = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (i < users.length) {
      const u = users[i++];
      dropSessionData(u);
      for (let attempt = 0; attempt < 6; attempt++) {
        const r = await as(u, "/api/auth/get-session").catch(() => null);
        await r?.arrayBuffer().catch(() => undefined);
        if (r?.status === 200 && u.cookie.includes("session_data")) break;
        await sleep(1_000 * (attempt + 1));
      }
      if (i % 20 === 0) process.stdout.write(".");
    }
  }));
  console.log(" done");
}

const streams = { connections: 0, events: 0, errors: 0, writes: 0, writeErrors: 0, propagation: [] };
const dbBefore = await dbCounters();
const statsBefore = readStats();
if (pg && statementsView) await pg.unsafe(`select ${statementsView.replace(/pg_stat_statements$/, "pg_stat_statements_reset")}()`).catch(() => undefined);
const t0 = Date.now();
const sampler = pg ? setInterval(() => void sampleConnections().catch(() => undefined), 1_000) : null;
const until = t0 + durationMs;
const followers = withDocs.length ? Array.from({ length: Number(args.streams) }, (_, i) => follower(withDocs[i % withDocs.length], until, streams)) : [];
const writers = args.mode === "mixed" ? withDocs.slice(0, Math.min(withDocs.length, Number(args.streams))).map((u) => writer(u, until, streams)) : [];
const vus = args.mode === "mixed" ? Array.from({ length: Number(args.vus) }, (_, i) => virtualUser(users[i % users.length], until)) : [];
const ticker = setInterval(() => process.stdout.write(`\r${Math.round((Date.now() - t0) / 1000)}s / ${args.duration}s`), 1_000);
await Promise.all([...vus, ...followers, ...writers]);
clearInterval(ticker);
if (sampler) clearInterval(sampler);
await sleep(1_500); // let the server's counter flush
const after = readStats();
const dbAfter = await dbCounters();
const topStatements = pg && statementsView ? await pg.unsafe(`select calls::int, round(total_exec_time::numeric, 1)::float as total_ms, round(mean_exec_time::numeric, 2)::float as mean_ms, round(max_exec_time::numeric, 1)::float as max_ms, rows::int, left(regexp_replace(query, '\\s+', ' ', 'g'), 220) as query
  from ${statementsView} where dbid = (select oid from pg_database where datname = current_database()) and query not ilike '%pg_stat%' order by total_exec_time desc limit ${Number(args.top) || 15}`).catch(() => []) : [];
if (pg) await pg.end();
const seconds = (Date.now() - t0) / 1000;

const scenarios = [...results.entries()].map(([name, r]) => {
  const lat = [...r.lat].sort((a, b) => a - b);
  return { name, requests: lat.length, errors: r.errors, errorRate: lat.length ? r.errors / lat.length : 0, p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), statuses: r.statuses };
}).sort((a, b) => b.requests - a.requests);
const all = [...results.values()].flatMap((r) => r.lat).sort((a, b) => a - b);
// The mock AI chat streams for about a second by design and makes up ~4% of requests, so it sits right on
// the overall p95 and swings it between tens of milliseconds and a second. The headline percentiles leave
// it out; its own row shows it.
const app = [...results.entries()].filter(([name]) => !STREAMED.has(name)).flatMap(([, r]) => r.lat).sort((a, b) => a - b);
const errors = [...results.values()].reduce((n, r) => n + r.errors, 0);
const prop = [...streams.propagation].sort((a, b) => a - b);
const sql = dbBefore && dbAfter ? (dbAfter.statements ?? dbAfter.xacts) - (statementsView ? 0 : dbBefore.xacts) : null;
const lag = (after?.lag ?? []).filter((l) => l.at >= t0 && l.at <= t0 + durationMs + 1_000);
const lagP99 = lag.map((l) => l.p99).sort((a, b) => a - b);
const conn = { openMax: Math.max(0, ...connSamples.map((c) => c.open)), activeMax: Math.max(0, ...connSamples.map((c) => c.active)), activeAvg: connSamples.length ? connSamples.reduce((n, c) => n + c.active, 0) / connSamples.length : null, idleInTxMax: Math.max(0, ...connSamples.map((c) => c.idle_tx)) };
const summary = {
  label: args.label, mode: args.mode, sessions: args.sessions, seconds: Math.round(seconds), vus: Number(args.vus), streams: Number(args.streams),
  requests: all.length, rps: all.length / seconds, errors, errorRate: all.length ? errors / all.length : 0,
  p50: percentile(app, 50), p95: percentile(app, 95), p99: percentile(app, 99),
  withChat: { p50: percentile(all, 50), p95: percentile(all, 95), p99: percentile(all, 99) },
  db: { statements: sql, counted: statementsView ? "pg_stat_statements" : "transactions", perSecond: sql === null ? null : sql / seconds, perRequest: sql === null || !all.length ? null : sql / all.length, connections: conn, top: topStatements },
  server: { cpuMsPerRequest: statsBefore?.cpuMs != null && after?.cpuMs != null && all.length ? (after.cpuMs - statsBefore.cpuMs) / all.length : null, cpuShare: statsBefore?.cpuMs != null && after?.cpuMs != null ? (after.cpuMs - statsBefore.cpuMs) / (seconds * 1000) : null, eventLoopP99Median: percentile(lagP99, 50), eventLoopP99Max: lagP99.length ? lagP99[lagP99.length - 1] : null, eventLoopMax: Math.max(0, ...lag.map((l) => l.max)), heapMB: after?.heapMB ?? null, rssMB: after?.rssMB ?? null, blocked: after?.counts.blocked ?? null, blockedHosts: after?.blockedHosts ?? null },
  streams: { ...streams, propagation: undefined, propagationP50: percentile(prop, 50), propagationP95: percentile(prop, 95) },
  scenarios,
};
if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 2));

const f = (v, d = 0) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
console.log(`\n\n${summary.label} (${summary.mode}, ${args.sessions} sessions): ${summary.requests} requests in ${summary.seconds}s = ${f(summary.rps, 1)}/s, errors ${f(summary.errorRate * 100, 2)}%, p50 ${f(summary.p50)} ms, p95 ${f(summary.p95)} ms, p99 ${f(summary.p99)} ms (without the streamed AI chat)`);
console.log(`database: ${f(sql)} ${summary.db.counted} = ${f(summary.db.perSecond, 1)}/s, ${f(summary.db.perRequest, 2)} per request; connections open max ${conn.openMax}, active max ${conn.activeMax} (avg ${f(conn.activeAvg, 1)}), idle in transaction max ${conn.idleInTxMax}`);
console.log(`server: CPU ${f(summary.server.cpuMsPerRequest, 1)} ms per request (${f((summary.server.cpuShare ?? 0) * 100)}% of a core); event loop delay p99 median ${f(summary.server.eventLoopP99Median, 1)} ms, worst p99 ${f(summary.server.eventLoopP99Max, 1)} ms, max ${f(summary.server.eventLoopMax, 1)} ms; heap ${f(summary.server.heapMB)} MB, rss ${f(summary.server.rssMB)} MB; blocked outbound ${f(summary.server.blocked)}`);
console.log(`streams: ${streams.connections} connections, ${streams.events} events, ${streams.errors} errors; writes ${streams.writes} (${streams.writeErrors} failed); edit to screen p50 ${f(summary.streams.propagationP50)} ms, p95 ${f(summary.streams.propagationP95)} ms`);
for (const s of scenarios) console.log(`  ${s.name.padEnd(22)} ${String(s.requests).padStart(5)} req  p50 ${f(s.p50).padStart(6)}  p95 ${f(s.p95).padStart(6)}  p99 ${f(s.p99).padStart(6)} ms  errors ${s.errors}`);
if (topStatements.length) {
  console.log("slowest statements by total time:");
  for (const t of topStatements) console.log(`  ${String(t.total_ms).padStart(9)} ms total  ${String(t.calls).padStart(6)} calls  mean ${String(t.mean_ms).padStart(7)} ms  ${t.query.slice(0, 140)}`);
}
