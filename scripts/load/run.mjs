/**
 * The load test. Signed-in virtual users (from setup.mjs) browse a LOCAL production build with a
 * realistic mix: page loads, the Newsroom feed and bell, company data, deals and briefs, their Studio
 * documents, and a small share of AI chat (answered by the sandbox's mock). Meanwhile some users hold
 * live-update streams open on their documents while a writer edits them, which measures how fast an
 * edit reaches everyone. With --mode idle-streams it holds streams open and does nothing else: the
 * database cost of an open-but-quiet tab.
 *
 * Reports p50/p95/p99 latency, error rate and requests/s per scenario, and database queries/s from the
 * server sandbox's counter (--stats, the LOADTEST_STATS file of the server).
 *
 *   node scripts/load/run.mjs --base http://localhost:3999 --users /tmp/loadtest-users.json \
 *     --vus 60 --streams 20 --duration 60 --stats /tmp/server-stats.json --label after --out /tmp/after.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { guardTarget, parseArgs, percentile } from "./common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://localhost:3999", users: "", vus: "60", streams: "20", duration: "60", stats: "", out: "", label: "run", mode: "mixed", think: "1000-3000", sessions: "fresh" });
const base = guardTarget(args.base);
const users = JSON.parse(readFileSync(args.users, "utf8"));
const durationMs = Number(args.duration) * 1000;
const [thinkMin, thinkMax] = args.think.split("-").map(Number);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readStats = () => { try { return JSON.parse(readFileSync(args.stats, "utf8")); } catch { return null; } };

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
  { name: "page /app", weight: 20, run: get("/app") },
  { name: "page /app/news", weight: 10, run: get("/app/news") },
  { name: "news feed", weight: 20, run: get("/api/news/feed") },
  { name: "notification bell", weight: 15, run: get("/api/news/notifications") },
  { name: "companies", weight: 15, run: get("/api/companies?tickers=AAPL,NVDA,XOM,JPM,KO") },
  { name: "deals", weight: 5, run: get("/api/news/deals") },
  { name: "brief", weight: 5, run: get("/api/news/brief") },
  { name: "studio document", weight: 5, run: (u) => (u.docId ? as(u, `/api/studio/${u.docId}`) : null) },
  { name: "ai chat (mock)", weight: 5, run: (u) => as(u, "/api/ai/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "What moved oil prices this week?" }], context: { ticker: "XOM", panels: [] } }) }) },
];
const total = MIX.reduce((n, s) => n + s.weight, 0);
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
    } catch (e) {
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

// Sessions carry a short-lived signed cookie. --sessions fresh (the default) mints everyone a new one
// first, the way the browser's auth client does (/api/auth/get-session), slowly enough for the auth
// service's rate limit, so the run measures the app. --sessions stale drops it instead: people whose
// cookie expired while they kept a page open, which is how a real crowd looks after a few minutes.
const dropSessionData = (u) => { u.cookie = u.cookie.split("; ").filter((c) => !c.split("=")[0].includes("session_data")).join("; "); };
if (args.sessions === "stale") users.forEach(dropSessionData);
else {
  process.stdout.write("refreshing sessions");
  for (const u of users) {
    dropSessionData(u);
    for (let attempt = 0; attempt < 12; attempt++) {
      const r = await as(u, "/api/auth/get-session").catch(() => null);
      await r?.arrayBuffer().catch(() => undefined);
      if (r?.status === 200 && u.cookie.includes("session_data")) break;
      await sleep(3_000 * (attempt + 1));
    }
    process.stdout.write(".");
    await sleep(400);
  }
  console.log(" done");
}

const streams = { connections: 0, events: 0, errors: 0, writes: 0, writeErrors: 0, propagation: [] };
const before = readStats();
const t0 = Date.now();
const until = t0 + durationMs;
const followers = withDocs.length ? Array.from({ length: Number(args.streams) }, (_, i) => follower(withDocs[i % withDocs.length], until, streams)) : [];
const writers = args.mode === "mixed" ? withDocs.slice(0, Math.min(withDocs.length, Number(args.streams))).map((u) => writer(u, until, streams)) : [];
const vus = args.mode === "mixed" ? Array.from({ length: Number(args.vus) }, (_, i) => virtualUser(users[i % users.length], until)) : [];
const ticker = setInterval(() => process.stdout.write(`\r${Math.round((Date.now() - t0) / 1000)}s / ${args.duration}s`), 1_000);
await Promise.all([...vus, ...followers, ...writers]);
clearInterval(ticker);
await sleep(1_500); // let the server's counter flush
const after = readStats();
const seconds = (Date.now() - t0) / 1000;

const scenarios = [...results.entries()].map(([name, r]) => {
  const lat = [...r.lat].sort((a, b) => a - b);
  return { name, requests: lat.length, errors: r.errors, errorRate: lat.length ? r.errors / lat.length : 0, p50: percentile(lat, 50), p95: percentile(lat, 95), p99: percentile(lat, 99), statuses: r.statuses };
}).sort((a, b) => b.requests - a.requests);
const all = [...results.values()].flatMap((r) => r.lat).sort((a, b) => a - b);
const errors = [...results.values()].reduce((n, r) => n + r.errors, 0);
const prop = [...streams.propagation].sort((a, b) => a - b);
const sql = before && after ? after.counts.sql - before.counts.sql : null;
const auth = before && after ? after.counts.auth - before.counts.auth : null;
const summary = {
  label: args.label, mode: args.mode, sessions: args.sessions, seconds: Math.round(seconds), vus: Number(args.vus), streams: Number(args.streams),
  requests: all.length, rps: all.length / seconds, errors, errorRate: all.length ? errors / all.length : 0,
  p50: percentile(all, 50), p95: percentile(all, 95), p99: percentile(all, 99),
  db: { queries: sql, perSecond: sql === null ? null : sql / seconds, perRequest: sql === null || !all.length ? null : sql / all.length, authCalls: auth, blocked: after?.counts.blocked ?? null, blockedHosts: after?.blockedHosts ?? null },
  streams: { ...streams, propagation: undefined, propagationP50: percentile(prop, 50), propagationP95: percentile(prop, 95) },
  scenarios,
};
if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 2));

const f = (v, d = 0) => (v === null || v === undefined ? "-" : Number(v).toFixed(d));
console.log(`\n\n${summary.label} (${summary.mode}, ${args.sessions} sessions): ${summary.requests} requests in ${summary.seconds}s = ${f(summary.rps, 1)}/s, errors ${f(summary.errorRate * 100, 2)}%, p50 ${f(summary.p50)} ms, p95 ${f(summary.p95)} ms`);
console.log(`database: ${f(sql)} queries = ${f(summary.db.perSecond, 1)}/s, ${f(summary.db.perRequest, 2)} per request; auth calls ${f(auth)}`);
console.log(`streams: ${streams.connections} connections, ${streams.events} events, ${streams.errors} errors; writes ${streams.writes} (${streams.writeErrors} failed); edit to screen p50 ${f(summary.streams.propagationP50)} ms, p95 ${f(summary.streams.propagationP95)} ms`);
for (const s of scenarios) console.log(`  ${s.name.padEnd(20)} ${String(s.requests).padStart(5)} req  p50 ${f(s.p50).padStart(6)}  p95 ${f(s.p95).padStart(6)}  p99 ${f(s.p99).padStart(6)} ms  errors ${s.errors}`);
