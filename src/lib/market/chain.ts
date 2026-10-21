/**
 * Running an ordered list of sources for one answer (registry.ts builds the list from a dataset's
 * adapters and a caller's preferences):
 * - the first source starts; any failure (timeout, network, 5xx, rate limit, schema, an empty answer,
 *   an open breaker) starts the next one at once;
 * - interactive requests also hedge: when the first source has not answered after the hedge delay, the
 *   second starts while the first keeps running, and whichever brings a valid answer first wins. The
 *   loser is not aborted: its answer still fills the cache for the next request, and its own timeout
 *   bounds it;
 * - hedging needs a reason: none when the first source's breaker is closed and this instance's recent
 *   record of it is healthy (p95 under the delay, few errors), and never in background mode.
 */
import { performance } from "node:perf_hooks";
import { breakers, DEFAULT_BREAKER, viewOf } from "./breaker";
import { budget, HEDGE_HEALTHY_ERROR_RATE, HEDGE_MIN_SAMPLES } from "./budgets";
import { callSource, sourceErrorOf } from "./source";
import { SourceError } from "./source-error";
import { recentStats, recordSourceCall } from "./stats";

export type Attempt<R> = {
  id: string;
  /** Breaker and stats key ("fmp"). */
  source: string;
  /** What is asked of it, for the stats ("daily-bars"). */
  op: string;
  run: () => Promise<R>;
  /** A valid answer; anything else is "empty" and the next source is asked. */
  valid?: (r: R) => boolean;
  /** Wrap `run` in callSource here (breaker, timing). Off for adapters that wrap their own upstream call inside the cache. Default true. */
  wrap?: boolean;
  label?: string;
};

export type ChainResult<R> = { value: R; index: number; hedged: boolean; errors: unknown[]; ms: number };

/** The hedge delay for a chain whose first source is `source`, or null for no hedge. */
export function hedgeDelayFor(source: string): number | null {
  const b = budget();
  if (b.hedgeDelayMs === null) return null;
  const snap = breakers.snapshot(source);
  const view = snap ? viewOf(snap, Date.now(), DEFAULT_BREAKER) : "closed";
  const s = recentStats(source);
  if (view === "closed" && s.n >= HEDGE_MIN_SAMPLES && s.p95 !== null && s.p95 < b.hedgeDelayMs && s.errorRate < HEDGE_HEALTHY_ERROR_RATE) return null;
  return b.hedgeDelayMs;
}

class EmptyAnswer extends Error { constructor() { super("empty answer"); this.name = "EmptyAnswer"; } }

/** First valid answer from `attempts`, in order, hedged after `hedgeDelayMs` (null: no hedge). Rejects with the first source's error when all fail. */
export function runChain<R>(attempts: Attempt<R>[], opts: { hedgeDelayMs?: number | null } = {}): Promise<ChainResult<R>> {
  if (!attempts.length) return Promise.reject(new Error("No source covers this"));
  const delay = opts.hedgeDelayMs === undefined ? hedgeDelayFor(attempts[0].source) : opts.hedgeDelayMs;
  const t0 = performance.now();
  return new Promise((resolve, reject) => {
    const errors: unknown[] = [];
    let next = 0, running = 0, done = false, hedged = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => { done = true; if (timer) clearTimeout(timer); };
    const launch = (hedge: boolean): boolean => {
      if (done || next >= attempts.length) return false;
      const i = next++, a = attempts[i];
      running++;
      const checked = async () => {
        const v = await a.run();
        if (a.valid && !a.valid(v)) throw new EmptyAnswer();
        return v;
      };
      const p = a.wrap === false ? checked() : callSource(a.source, a.op, checked, { fallback: i > 0, hedge, label: a.label, classify: (e) => (e instanceof EmptyAnswer ? new SourceError(a.source, "empty", "empty answer") : undefined) });
      p.then((v) => {
        running--;
        if (done) return;
        finish();
        if (i > 0) recordSourceCall({ source: a.source, op: `chain:${a.op}`, ms: performance.now() - t0, outcome: "ok", fallback: true, hedge });
        resolve({ value: v, index: i, hedged, errors, ms: performance.now() - t0 });
      }, (e) => {
        running--;
        errors[i] = e;
        const kind = e instanceof EmptyAnswer ? "empty" : sourceErrorOf(a.source, e).kind;
        recordSourceCall({ source: a.source, op: `chain:${a.op}`, ms: performance.now() - t0, outcome: "fail", kind, fallback: i > 0, hedge });
        if (done) return;
        if (!launch(false) && running === 0) {
          finish();
          // The first real failure (not "nothing here", not a plan that lacks it), else the first error at all.
          const real = errors.findIndex((x, j) => x !== undefined && !(x instanceof EmptyAnswer) && sourceErrorOf(attempts[j].source, x).kind !== "empty");
          const any = errors.findIndex((x) => x !== undefined && !(x instanceof EmptyAnswer));
          reject(errors[real >= 0 ? real : any >= 0 ? any : 0]);
        }
      });
      return true;
    };
    launch(false);
    if (delay !== null && delay !== undefined && attempts.length > 1) {
      timer = setTimeout(() => { if (!done && next === 1) { hedged = true; launch(true); } }, delay);
    }
  });
}

/** Whether a chain failed only because nothing had data (every source empty), not because sources failed. */
export const isEmptyAnswer = (e: unknown) => e instanceof EmptyAnswer;

/** Map with at most `limit` running at once, results in input order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let k = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (let i = k++; i < items.length; i = k++) out[i] = await fn(items[i], i);
  }));
  return out;
}
