/**
 * Per-source call telemetry (docs/data-layer.md): every upstream call the data layer makes is recorded
 * here with its time and outcome, and
 * - added to this request's timings (the Server-Timing header, provenance.ts);
 * - kept in a short in-memory window per source (the hedge decision, chain.ts);
 * - summed into per-minute rollups that are written to `source_stats` in one batched upsert at most every
 *   STATS_FLUSH_MS per instance (and at the end of a route, in the background). Never a row per call;
 *   a failed write is logged and dropped, never thrown.
 * /api/market/health reads the rollups back as p50/p95, error rate and fallback use per source.
 */
import { gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { inBackground } from "@/lib/cache";
import { shared } from "@/lib/shared";
import { RECENT_WINDOW_MS, STATS_FLUSH_MS } from "./budgets";
import { noteTiming } from "./provenance";
import type { SourceFailureKind } from "./source-error";

/** Upper bounds (ms) of the histogram buckets; one more bucket holds everything slower. */
export const BUCKETS = [100, 250, 500, 1_000, 2_500, 5_000, 10_000] as const;
const KINDS = ["timeout", "network", "http", "rate-limit", "schema", "empty", "breaker-open"] as const satisfies readonly SourceFailureKind[];

export type Outcome = "ok" | "fail" | "skip";
export type SourceCall = {
  source: string; op: string; ms: number; outcome: Outcome; kind?: SourceFailureKind;
  /** This call answered (or tried to) for another source that failed or was slow. */
  fallback?: boolean;
  /** It was started as a hedge while the primary was still running. */
  hedge?: boolean;
};

export type Rollup = { calls: number; failures: number; fallbacks: number; hedges: number; sumMs: number; maxMs: number; buckets: number[]; kinds: Partial<Record<SourceFailureKind, number>> };

export const emptyRollup = (): Rollup => ({ calls: 0, failures: 0, fallbacks: 0, hedges: 0, sumMs: 0, maxMs: 0, buckets: Array(BUCKETS.length + 1).fill(0), kinds: {} });

/** The histogram bucket for a latency. Pure. */
export const bucketOf = (ms: number) => { const i = BUCKETS.findIndex((b) => ms <= b); return i < 0 ? BUCKETS.length : i; };

/** Add one call to a rollup (in place). Pure apart from `r`. */
export function addCall(r: Rollup, c: Pick<SourceCall, "ms" | "outcome" | "kind" | "fallback" | "hedge">) {
  const ms = Math.max(0, Math.round(c.ms));
  r.calls++;
  if (c.outcome !== "ok") r.failures++;
  if (c.fallback) r.fallbacks++;
  if (c.hedge) r.hedges++;
  if (c.kind && c.outcome !== "ok") r.kinds[c.kind] = (r.kinds[c.kind] ?? 0) + 1;
  // A refused call (open breaker) took no time upstream: it counts, but not in the latency histogram.
  if (c.outcome === "skip") return;
  r.sumMs += ms;
  r.maxMs = Math.max(r.maxMs, ms);
  r.buckets[bucketOf(ms)]++;
}

/** Several rollups as one. Pure. */
export function mergeRollups(rs: Rollup[]): Rollup {
  const out = emptyRollup();
  for (const r of rs) {
    out.calls += r.calls; out.failures += r.failures; out.fallbacks += r.fallbacks; out.hedges += r.hedges; out.sumMs += r.sumMs; out.maxMs = Math.max(out.maxMs, r.maxMs);
    r.buckets.forEach((n, i) => { out.buckets[i] += n; });
    for (const [k, n] of Object.entries(r.kinds)) out.kinds[k as SourceFailureKind] = (out.kinds[k as SourceFailureKind] ?? 0) + (n ?? 0);
  }
  return out;
}

/** The q-quantile latency (0.5, 0.95) from the histogram, interpolated within its bucket; null with no timed calls. Pure. */
export function percentile(r: Rollup, q: number): number | null {
  const n = r.buckets.reduce((a, b) => a + b, 0);
  if (!n) return null;
  const target = q * n;
  let seen = 0;
  for (let i = 0; i < r.buckets.length; i++) {
    const c = r.buckets[i];
    if (c && seen + c >= target) {
      const lo = i === 0 ? 0 : BUCKETS[i - 1], hi = i < BUCKETS.length ? Math.min(BUCKETS[i], Math.max(r.maxMs, lo)) : Math.max(r.maxMs, lo);
      return Math.round(lo + ((target - seen) / c) * (hi - lo));
    }
    seen += c;
  }
  return r.maxMs;
}

/* ---------------- Recording ---------------- */

/**
 * Ops starting with "chain:" are the chain's own outcome per dataset (chain.ts): which source answered
 * when it was not the first (fallbacks, hedges) and which failed or had nothing. Upstream calls carry the
 * endpoint as their op. Health reports latency and errors from upstream calls, fallbacks from the chain.
 */
export const CHAIN = "chain:";

type Buffer = { since: number; rows: Map<string, { minute: number; source: string; op: string; r: Rollup }>; recent: Map<string, { at: number; ms: number; ok: boolean }[]>; warnedAt: number };
const buf = shared<Buffer>("market:stats", () => ({ since: Date.now(), rows: new Map(), recent: new Map(), warnedAt: 0 }));

/** Record one upstream call. Cheap: memory only; the rollups are written later in a batch. */
export function recordSourceCall(c: SourceCall) {
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  const k = `${minute}|${c.source}|${c.op}`;
  let e = buf.rows.get(k);
  if (!e) { e = { minute, source: c.source, op: c.op, r: emptyRollup() }; buf.rows.set(k, e); }
  addCall(e.r, c);
  // The recent window (the hedge decision) holds upstream calls only, not the chain's own outcomes.
  if (c.outcome !== "skip" && !c.op.startsWith(CHAIN)) {
    const list = buf.recent.get(c.source) ?? [];
    list.push({ at: Date.now(), ms: c.ms, ok: c.outcome === "ok" });
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    while (list.length && (list[0].at < cutoff || list.length > 500)) list.shift();
    buf.recent.set(c.source, list);
  }
  if (!c.op.startsWith(CHAIN)) noteTiming({ source: c.source, ms: c.ms, ok: c.outcome === "ok", hedge: c.hedge });
  if (Date.now() - buf.since >= STATS_FLUSH_MS) inBackground(flushSourceStats());
}

/** This instance's recent calls to `source`: how many, the p95 and the error rate (the hedge decision). */
export function recentStats(source: string): { n: number; p95: number | null; errorRate: number } {
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const xs = (buf.recent.get(source) ?? []).filter((x) => x.at >= cutoff);
  if (!xs.length) return { n: 0, p95: null, errorRate: 0 };
  const ms = xs.map((x) => x.ms).sort((a, b) => a - b);
  return { n: xs.length, p95: ms[Math.min(ms.length - 1, Math.ceil(0.95 * ms.length) - 1)], errorRate: xs.filter((x) => !x.ok).length / xs.length };
}

const KIND_COLUMN: Record<(typeof KINDS)[number], keyof typeof schema.sourceStats.$inferInsert> = {
  timeout: "kTimeout", network: "kNetwork", http: "kHttp", "rate-limit": "kRateLimit", schema: "kSchema", empty: "kEmpty", "breaker-open": "kSkipped",
};
const BUCKET_COLUMNS = ["b100", "b250", "b500", "b1000", "b2500", "b5000", "b10000", "bInf"] as const;

/** Write the buffered rollups in one statement (adding to rows other instances wrote). Never throws. */
export async function flushSourceStats(): Promise<void> {
  const rows = [...buf.rows.values()];
  buf.rows = new Map();
  buf.since = Date.now();
  if (!rows.length || !db) return;
  const t = schema.sourceStats;
  const values = rows.map(({ minute, source, op, r }) => {
    const v: typeof t.$inferInsert = { minute: new Date(minute), source, op, calls: r.calls, failures: r.failures, fallbacks: r.fallbacks, hedges: r.hedges, sumMs: r.sumMs, maxMs: r.maxMs };
    BUCKET_COLUMNS.forEach((c, i) => { (v as Record<string, unknown>)[c] = r.buckets[i]; });
    for (const k of KINDS) (v as Record<string, unknown>)[KIND_COLUMN[k]] = r.kinds[k] ?? 0;
    return v;
  });
  const add = (c: string) => sql.raw(`"source_stats"."${c}" + excluded."${c}"`);
  try {
    await db.insert(t).values(values).onConflictDoUpdate({
      target: [t.minute, t.source, t.op],
      set: {
        calls: add("calls"), failures: add("failures"), fallbacks: add("fallbacks"), hedges: add("hedges"), sumMs: add("sum_ms"),
        maxMs: sql.raw(`greatest("source_stats"."max_ms", excluded."max_ms")`),
        b100: add("b100"), b250: add("b250"), b500: add("b500"), b1000: add("b1000"), b2500: add("b2500"), b5000: add("b5000"), b10000: add("b10000"), bInf: add("b_inf"),
        kTimeout: add("k_timeout"), kNetwork: add("k_network"), kHttp: add("k_http"), kRateLimit: add("k_rate_limit"), kSchema: add("k_schema"), kEmpty: add("k_empty"), kSkipped: add("k_skipped"),
      },
    });
  } catch (e) {
    // Telemetry never breaks a request: one log line a minute at most (a missing table means 0028 is not applied).
    if (Date.now() - buf.warnedAt > 60_000) {
      buf.warnedAt = Date.now();
      // The error's name and database code only (a missing table is 42P01): its text can hold the SQL.
      console.warn(JSON.stringify({ level: "warn", where: "source-stats", error: (e as { name?: string } | null)?.name ?? "Error", code: (e as { code?: unknown } | null)?.code ?? null, dropped: rows.length }));
    }
  }
}

/* ---------------- Reading ---------------- */

/** Rollups for the last `minutes`, per minute, source and op. */
export async function readRollups(minutes: number): Promise<{ minute: Date; source: string; op: string; rollup: Rollup }[]> {
  if (!db) return [];
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await db.select().from(schema.sourceStats).where(gte(schema.sourceStats.minute, since));
  return rows.map((x) => {
    const r = emptyRollup();
    r.calls = x.calls; r.failures = x.failures; r.fallbacks = x.fallbacks; r.hedges = x.hedges; r.sumMs = Number(x.sumMs); r.maxMs = x.maxMs;
    r.buckets = BUCKET_COLUMNS.map((c) => x[c]);
    for (const k of KINDS) { const n = x[KIND_COLUMN[k] as keyof typeof x] as number; if (n) r.kinds[k] = n; }
    return { minute: x.minute, source: x.source, op: x.op, rollup: r };
  });
}

export type SourceHealth = {
  source: string; calls: number; errorRate: number; p50: number | null; p95: number | null; maxMs: number; kinds: Rollup["kinds"]; ops: string[];
  /** Answers this source gave when an earlier source in the chain failed or was slow (hedges among them). */
  fallbacks: number; hedges: number;
  /** Times the chain moved past this source because it had nothing for the request (not an outage). */
  empty: number;
};

/** Per source over the last `minutes`: calls, error rate, fallback use and p50/p95 latency. */
export async function sourceHealth(minutes = 60): Promise<SourceHealth[]> {
  const rows = await readRollups(minutes);
  const by = new Map<string, { rs: Rollup[]; chain: boolean[]; ops: Set<string> }>();
  for (const r of rows) { const e = by.get(r.source) ?? { rs: [], chain: [], ops: new Set() }; e.rs.push(r.rollup); e.chain.push(r.op.startsWith(CHAIN)); e.ops.add(r.op); by.set(r.source, e); }
  return [...by.entries()].map(([source, e]) => {
    const up = mergeRollups(e.rs.filter((_, i) => !e.chain[i]));
    const ch = mergeRollups(e.rs.filter((_, i) => e.chain[i]));
    return {
      source, calls: up.calls, errorRate: up.calls ? up.failures / up.calls : 0, p50: percentile(up, 0.5), p95: percentile(up, 0.95), maxMs: up.maxMs, kinds: up.kinds,
      ops: [...e.ops].filter((o) => !o.startsWith(CHAIN)).sort(), fallbacks: ch.fallbacks, hedges: ch.hedges, empty: ch.kinds.empty ?? 0,
    };
  }).sort((a, b) => a.source.localeCompare(b.source));
}

/** This instance's rollups not yet written (tests, and the health page's view of the last seconds). */
export function bufferedRollups(): { minute: number; source: string; op: string; rollup: Rollup }[] {
  return [...buf.rows.values()].map((x) => ({ minute: x.minute, source: x.source, op: x.op, rollup: x.r }));
}
