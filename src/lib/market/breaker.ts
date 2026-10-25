/**
 * One circuit breaker per data source, shared by every instance through a kv_cache row
 * (`breaker:<source>`), so a source that is failing for everyone is skipped at once instead of costing
 * each request a timeout (docs/data-layer.md).
 *
 * - Closed: calls go through. Failures that mean an outage (timeout, network, 5xx, rate limit, schema
 *   drift; not "this symbol is not covered") are counted in a window; BREAKER_FAILURES of them open it.
 * - Open: calls are refused at once with SourceError("breaker-open"), so callers fall back without waiting.
 * - Half-open, after the cooldown: one probe at a time across instances (a lease). Its success closes the
 *   breaker; its failure opens it again for another cooldown.
 *
 * The state machine is pure (nextOnFailure/nextOnSuccess). Writes are compare-and-set on the row
 * (INSERT … ON CONFLICT … DO UPDATE … WHERE value = old … RETURNING), retried on a lost race, so two
 * instances' failures add up. Each instance keeps its copy for BREAKER_MEMORY_MS. A breaker that cannot
 * be read fails open: the source is tried.
 */
import { sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { lease, type Release } from "@/lib/locks";
import { shared } from "@/lib/shared";
import {
  BREAKER_COOLDOWN_MS, BREAKER_FAILURES, BREAKER_MEMORY_MS, BREAKER_PROBE_LEASE_MS, BREAKER_WINDOW_MS,
} from "./budgets";
import type { SourceError } from "./source-error";

export type BreakerState = { state: "closed" | "open"; failures: number; windowStart: number; openedAt: number };
export type BreakerView = "closed" | "open" | "half-open";
export type BreakerConfig = { failures: number; windowMs: number; cooldownMs: number; probeLeaseMs: number; memoryMs: number };

export const DEFAULT_BREAKER: BreakerConfig = {
  failures: BREAKER_FAILURES, windowMs: BREAKER_WINDOW_MS, cooldownMs: BREAKER_COOLDOWN_MS, probeLeaseMs: BREAKER_PROBE_LEASE_MS, memoryMs: BREAKER_MEMORY_MS,
};
export const CLOSED: BreakerState = { state: "closed", failures: 0, windowStart: 0, openedAt: 0 };

/** Whether a failure says the source is down, rather than that it does not have this one thing. Pure. */
export function isOutage(e: SourceError): boolean {
  if (e.kind === "empty" || e.kind === "breaker-open") return false;
  if (e.kind === "http") return e.status === undefined || e.status >= 500;
  return true;
}

/** Pure. */
export function viewOf(s: BreakerState, now: number, cfg: BreakerConfig): BreakerView {
  if (s.state === "closed") return "closed";
  return now - s.openedAt >= cfg.cooldownMs ? "half-open" : "open";
}

/** The state after an outage-type failure at `now`. Pure. */
export function nextOnFailure(s: BreakerState, now: number, cfg: BreakerConfig): BreakerState {
  if (s.state === "open") return viewOf(s, now, cfg) === "half-open" ? { ...s, openedAt: now } : s; // a failed probe opens it again
  const fresh = now - s.windowStart > cfg.windowMs;
  const failures = fresh ? 1 : s.failures + 1;
  const windowStart = fresh ? now : s.windowStart;
  return failures >= cfg.failures ? { state: "open", failures, windowStart, openedAt: now } : { state: "closed", failures, windowStart, openedAt: 0 };
}

/** The state after a success at `now`: a half-open probe's success closes it; otherwise unchanged (null). Pure. */
export function nextOnSuccess(s: BreakerState, now: number, cfg: BreakerConfig): BreakerState | null {
  return s.state === "open" && viewOf(s, now, cfg) === "half-open" ? CLOSED : null;
}

/** Where breaker rows live. `cas` writes `next` only when the row still holds `old` (null: absent or expired). */
export type BreakerStore = {
  read(source: string): Promise<BreakerState | null>;
  cas(source: string, old: BreakerState | null, next: BreakerState): Promise<boolean>;
  probe(source: string, ttlMs: number): Promise<Release | null>;
};

const ROW_TTL_MS = 24 * 3_600_000;
const keyOf = (source: string) => `breaker:${source}`;
const parse = (v: string | null | undefined): BreakerState | null => { try { return v ? (JSON.parse(v) as BreakerState) : null; } catch { return null; } };

/** The shared store: kv_cache rows, compare-and-set in one statement. */
export function dbBreakerStore(): BreakerStore {
  return {
    async read(source) {
      if (!db) return null;
      const r = await db.execute<{ value: string }>(sql`select value from ${schema.kvCache} where key = ${keyOf(source)} and expires_at > now()`);
      return parse(r.rows?.[0]?.value ?? (r as unknown as { value: string }[])[0]?.value);
    },
    async cas(source, old, next) {
      if (!db) return true;
      const k = keyOf(source), value = JSON.stringify(next), exp = new Date(Date.now() + ROW_TTL_MS);
      const guard = old ? sql`${schema.kvCache.value} = ${JSON.stringify(old)} and ${schema.kvCache.expiresAt} > now()` : sql`${schema.kvCache.expiresAt} <= now()`;
      const rows = await db.insert(schema.kvCache).values({ key: k, value, expiresAt: exp })
        .onConflictDoUpdate({ target: schema.kvCache.key, set: { value, expiresAt: exp }, setWhere: guard })
        .returning({ value: schema.kvCache.value });
      return rows[0]?.value === value;
    },
    probe: (source, ttlMs) => lease(`breaker-probe:${source}`, ttlMs),
  };
}

/** A store in one process (tests, and the app when there is no database). */
export function memoryBreakerStore(now: () => number = Date.now): BreakerStore {
  const rows = new Map<string, string>(), probes = new Map<string, number>();
  return {
    async read(source) { return parse(rows.get(source)); },
    async cas(source, old, next) {
      const cur = rows.get(source) ?? null;
      if ((old ? JSON.stringify(old) : null) !== cur) return false;
      rows.set(source, JSON.stringify(next));
      return true;
    },
    async probe(source, ttlMs) {
      if ((probes.get(source) ?? 0) > now()) return null;
      probes.set(source, now() + ttlMs);
      return async () => { probes.delete(source); };
    },
  };
}

export type Gate = { allowed: boolean; view: BreakerView; release?: Release };

/** Breakers over a store, with this instance's short-lived copy of each state. */
export function createBreakers(opts: { store: BreakerStore; now?: () => number; cfg?: BreakerConfig }) {
  const { store, now = Date.now, cfg = DEFAULT_BREAKER } = opts;
  const copies = new Map<string, { s: BreakerState; at: number }>();

  async function current(source: string, fresh = false): Promise<BreakerState> {
    const c = copies.get(source);
    if (!fresh && c && now() - c.at < cfg.memoryMs) return c.s;
    try {
      const s = (await store.read(source)) ?? CLOSED;
      copies.set(source, { s, at: now() });
      return s;
    } catch {
      return c?.s ?? CLOSED; // unreadable: fail open (closed), or keep the last copy
    }
  }

  async function apply(source: string, step: (s: BreakerState) => BreakerState | null) {
    for (let i = 0; i < 4; i++) {
      let old: BreakerState | null;
      try { old = await store.read(source); } catch { return; }
      const next = step(old ?? CLOSED);
      if (!next || JSON.stringify(next) === JSON.stringify(old ?? CLOSED)) { copies.set(source, { s: old ?? CLOSED, at: now() }); return; }
      try {
        if (await store.cas(source, old, next)) { copies.set(source, { s: next, at: now() }); return; }
      } catch { return; }
    }
  }

  return {
    async view(source: string): Promise<BreakerView> { return viewOf(await current(source), now(), cfg); },
    /** Whether a call may go to `source` now. A half-open probe must call `release` when done. */
    async gate(source: string): Promise<Gate> {
      const view = viewOf(await current(source), now(), cfg);
      if (view === "closed") return { allowed: true, view };
      if (view === "open") return { allowed: false, view };
      try {
        const release = await store.probe(source, cfg.probeLeaseMs);
        return release ? { allowed: true, view, release } : { allowed: false, view };
      } catch {
        return { allowed: true, view };
      }
    },
    /** Count a failure (only outages count). */
    async failure(source: string, e: SourceError) {
      if (!isOutage(e)) return;
      await apply(source, (s) => nextOnFailure(s, now(), cfg));
    },
    /** A success: closes the breaker when it was a half-open probe. Costs nothing while closed. */
    async success(source: string) {
      const c = copies.get(source);
      if (!c || c.s.state === "closed") return;
      await apply(source, (s) => nextOnSuccess(s, now(), cfg));
    },
    /** Close it now (an operator after an incident; tests between cases). */
    async reset(source: string) {
      await apply(source, (s) => (s.state === "closed" && s.failures === 0 ? null : CLOSED));
    },
    /** This instance's copy (health page). */
    snapshot(source: string): BreakerState | null { return copies.get(source)?.s ?? null; },
  };
}

export type Breakers = ReturnType<typeof createBreakers>;

/** The app's breakers: shared through Postgres when there is one, per process otherwise. */
export const breakers: Breakers = shared("market:breakers", () => createBreakers({ store: db ? dbBreakerStore() : memoryBreakerStore() }));
