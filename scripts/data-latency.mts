/**
 * Real latency per data source and per command, measured against a running YouBank (production, a
 * preview, or a local server with network access). docs/data-layer.md explains how to read it.
 *
 *   pnpm exec tsx scripts/data-latency.mts --base https://youbank.example --cookie "$YB_COOKIE"
 *   pnpm exec tsx scripts/data-latency.mts --base http://localhost:3000 --cookie "$YB_COOKIE" --runs 10 --tickers AAPL,MSFT,BRK.B
 *
 * Options (each also as an environment variable):
 *   --base URL       YB_BASE      the deployment to measure (required)
 *   --cookie STR     YB_COOKIE    a signed-in session's Cookie header (copy it from the browser's devtools);
 *                                 the terminal routes need a signed-in person
 *   --secret STR     CRON_SECRET  optional: also read /api/market/health (server-side p50/p95 per source over
 *                                 the last hour, every instance's calls, and each breaker)
 *   --runs N         YB_RUNS      requests per command (default 5); the first is reported apart (it may be cold)
 *   --tickers LIST   YB_TICKERS   company commands' tickers (default AAPL,MSFT,BRK.B)
 *   --fns LIST       YB_FNS       commands to measure (default: every one below)
 *   --gap MS         YB_GAP       pause between requests (default 1000; requests are sent one at a time)
 *   --json FILE                   also write the raw samples and summaries as JSON
 *
 * It measures; it is not a load test. Against anything but localhost it refuses more than 20 runs per
 * command, more than 5 tickers, or a gap under 500 ms, so a run costs production at most a couple of
 * requests a second (each may reach FMP's, Nasdaq's or SEC's shared quotas behind the cache).
 *
 * Per command it reports wall time (p50, p95, max) as the browser would see it, plus HTTP statuses. Per
 * source it reads each answer's Server-Timing header (the server's own time for each upstream source,
 * e.g. `fmp;dur=412`), so the numbers are the upstream's latency from where the app runs (cle1), not
 * this machine's. Warm answers come from the server's caches; to see upstream latency, read the per-source
 * table and the health page's rollups, not the warm command times.
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith("--")) { const v = process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[++i] : "1"; args.set(a.slice(2), v); }
}
const opt = (k: string, env: string, d = "") => args.get(k) ?? process.env[env] ?? d;
const base = opt("base", "YB_BASE").replace(/\/$/, "");
if (!base) { console.error("Give --base (or YB_BASE): the deployment to measure."); process.exit(2); }
const cookie = opt("cookie", "YB_COOKIE");
const secret = opt("secret", "CRON_SECRET");
const runs = Math.max(1, Math.min(100, Number(opt("runs", "YB_RUNS", "5")) || 5));
const tickers = opt("tickers", "YB_TICKERS", "AAPL,MSFT,BRK.B").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
const gapMs = Math.max(0, Number(opt("gap", "YB_GAP", "1000")) || 0);
// Not a load test: anything but this machine gets a gentle run, or none.
const local = (() => { try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(base).hostname); } catch { return false; } })();
if (!local) {
  const why = runs > 20 ? `--runs ${runs} (at most 20)` : tickers.length > 5 ? `${tickers.length} tickers (at most 5)` : gapMs < 500 ? `--gap ${gapMs} (at least 500 ms)` : "";
  if (why) { console.error(`Refusing ${why} against ${base}: this script measures latency, it is not a load test. Use a local server for more.`); process.exit(2); }
}
const COMPANY_FNS = ["price", "credit", "quality", "forecast", "debt", "earnings", "analysts", "dividends", "wacc", "snapshot"];
const MARKET_FNS = ["indices", "fx", "commodities", "movers", "sectors", "deals", "curve", "macro"];
const ALL = [...COMPANY_FNS, ...MARKET_FNS, "companies"];
const fns = opt("fns", "YB_FNS", ALL.join(",")).split(",").map((f) => f.trim()).filter((f) => ALL.includes(f));

type Sample = { command: string; target: string; run: number; ms: number; status: number; timing: { name: string; dur: number | null; desc: string | null }[]; stale: boolean; sources: string[] };

/** Server-Timing into entries, commas and semicolons inside quotes kept (as src/lib/market/provenance.ts writes it). */
function parseServerTiming(header: string | null): Sample["timing"] {
  if (!header) return [];
  const split = (s: string, sep: string) => {
    const out: string[] = []; let cur = "", quoted = false;
    for (const ch of s) { if (ch === '"') quoted = !quoted; if (ch === sep && !quoted) { out.push(cur); cur = ""; } else cur += ch; }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  return split(header, ",").map((p) => {
    const [name, ...params] = split(p, ";");
    let dur: number | null = null, desc: string | null = null;
    for (const q of params) { const i = q.indexOf("="); const k = i < 0 ? q : q.slice(0, i), v = i < 0 ? "" : q.slice(i + 1); if (k === "dur") dur = Number(v); if (k === "desc") desc = v.replace(/^"|"$/g, ""); }
    return { name, dur: dur !== null && Number.isFinite(dur) ? dur : null, desc };
  });
}

const q = (xs: number[], p: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))]; };
const fmt = (v: number | null) => (v === null ? "-" : `${Math.round(v)}`);

function urlFor(fn: string, ticker: string): string {
  if (fn === "companies") return `${base}/api/companies?tickers=${encodeURIComponent(ticker)}`;
  if (fn === "snapshot") return `${base}/api/terminal/snapshot?ticker=${encodeURIComponent(ticker)}&need=quote,profile`;
  return COMPANY_FNS.includes(fn) ? `${base}/api/terminal/${fn}?ticker=${encodeURIComponent(ticker)}` : `${base}/api/terminal/${fn}`;
}

async function one(command: string, target: string, run: number): Promise<Sample> {
  const t0 = performance.now();
  try {
    const res = await fetch(urlFor(command, target), { headers: { ...(cookie ? { cookie } : {}), accept: "application/json", "cache-control": "no-cache" }, signal: AbortSignal.timeout(90_000) });
    await res.arrayBuffer();
    const ms = performance.now() - t0;
    let stale = false, sources: string[] = [];
    try { const x = JSON.parse(res.headers.get("x-data-sources") ?? "{}") as { stale?: boolean; providers?: string[] }; stale = !!x.stale; sources = x.providers ?? []; } catch { /* none */ }
    return { command, target, run, ms, status: res.status, timing: parseServerTiming(res.headers.get("server-timing")), stale, sources };
  } catch (e) {
    return { command, target, run, ms: performance.now() - t0, status: 0, timing: [], stale: false, sources: [(e as Error).name] };
  }
}

const samples: Sample[] = [];
console.log(`Measuring ${base}: ${fns.length} commands × ${runs} runs${tickers.length ? `, tickers ${tickers.join(", ")}` : ""}${cookie ? "" : " (no --cookie: signed-in routes will answer 401)"}\n`);
for (const fn of fns) {
  const targets = COMPANY_FNS.includes(fn) || fn === "companies" ? tickers : ["-"];
  for (const t of targets) for (let r = 0; r < runs; r++) {
    if (samples.length && gapMs) await new Promise((res) => setTimeout(res, gapMs));
    samples.push(await one(fn, t, r));
  }
}

// Per command: wall time, first run apart.
console.log("Per command (wall ms as the browser sees it; first = the first run, possibly cold)");
console.log(`${"command".padEnd(12)} ${"n".padStart(3)} ${"first".padStart(7)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)}  statuses        stale  sources`);
const commands: Record<string, unknown> = {};
for (const fn of fns) {
  const xs = samples.filter((s) => s.command === fn);
  const warm = xs.filter((s) => s.run > 0).map((s) => s.ms), first = xs.filter((s) => s.run === 0).map((s) => s.ms);
  const all = xs.map((s) => s.ms);
  const statuses = [...xs.reduce((m, s) => m.set(s.status, (m.get(s.status) ?? 0) + 1), new Map<number, number>())].map(([k, v]) => `${k}×${v}`).join(" ");
  const srcs = [...new Set(xs.flatMap((s) => s.sources))].join(",");
  const summary = { n: xs.length, first: q(first, 0.5), p50: q(warm.length ? warm : all, 0.5), p95: q(all, 0.95), max: q(all, 1), statuses, stale: xs.filter((s) => s.stale).length, sources: srcs };
  commands[fn] = summary;
  console.log(`${fn.padEnd(12)} ${String(xs.length).padStart(3)} ${fmt(summary.first).padStart(7)} ${fmt(summary.p50).padStart(7)} ${fmt(summary.p95).padStart(7)} ${fmt(summary.max).padStart(7)}  ${statuses.padEnd(15)} ${String(summary.stale).padStart(5)}  ${srcs}`);
}

// Per source: the server's own time per upstream source, from Server-Timing.
const bySource = new Map<string, number[]>();
for (const s of samples) for (const t of s.timing) if (t.name !== "total" && t.name !== "cache" && t.dur !== null) bySource.set(t.name, [...(bySource.get(t.name) ?? []), t.dur]);
console.log("\nPer source (server-side ms per answer, from Server-Timing: the slowest call to that source in the answer)");
console.log(`${"source".padEnd(12)} ${"n".padStart(4)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"max".padStart(7)}`);
const sources: Record<string, unknown> = {};
for (const [name, xs] of [...bySource].sort()) {
  sources[name] = { n: xs.length, p50: q(xs, 0.5), p95: q(xs, 0.95), max: q(xs, 1) };
  console.log(`${name.padEnd(12)} ${String(xs.length).padStart(4)} ${fmt(q(xs, 0.5)).padStart(7)} ${fmt(q(xs, 0.95)).padStart(7)} ${fmt(q(xs, 1)).padStart(7)}`);
}
if (!bySource.size) console.log("(no Server-Timing entries: every answer came from cache, or the deployment predates the header)");

let health: unknown = null;
if (secret) {
  const res = await fetch(`${base}/api/market/health`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) }).catch(() => null);
  if (res?.ok) {
    health = await res.json();
    const rows = (health as { sources?: { source: string; breaker: string; calls: number; p50?: number | null; p95?: number | null; errorRate?: number; fallbacks?: number }[] }).sources ?? [];
    console.log("\nServer rollups, last hour, every instance (/api/market/health)");
    console.log(`${"source".padEnd(12)} ${"breaker".padEnd(10)} ${"calls".padStart(6)} ${"p50".padStart(7)} ${"p95".padStart(7)} ${"errors".padStart(7)} ${"fallbacks".padStart(9)}`);
    for (const r of rows) console.log(`${r.source.padEnd(12)} ${r.breaker.padEnd(10)} ${String(r.calls).padStart(6)} ${fmt(r.p50 ?? null).padStart(7)} ${fmt(r.p95 ?? null).padStart(7)} ${r.errorRate !== undefined ? `${(r.errorRate * 100).toFixed(1)}%` : "-"}`.padEnd(54) + ` ${String(r.fallbacks ?? 0).padStart(9)}`);
  } else console.log(`\nHealth page: ${res ? `HTTP ${res.status}` : "no answer"} (check --secret)`);
}

const out = args.get("json");
if (out) { writeFileSync(out, JSON.stringify({ base, runs, tickers, at: new Date().toISOString(), commands, sources, health, samples }, null, 2)); console.log(`\nWrote ${out}`); }
