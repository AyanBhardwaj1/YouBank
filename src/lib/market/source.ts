/**
 * One upstream call to a data source, wrapped: the source's circuit breaker is asked first (an open one
 * refuses at once with SourceError("breaker-open")), the call is timed and its outcome recorded
 * (stats.ts: rollups, the recent window and Server-Timing), and an outage-type failure is counted toward
 * the breaker. The call's own error is rethrown unchanged, so callers keep their messages; its
 * classification (SourceError) is remembered beside it for the chain (sourceErrorOf).
 *
 * Wrap the upstream request itself, inside the cache's load, so cache hits are neither counted nor
 * refused by a breaker.
 */
import { performance } from "node:perf_hooks";
import { inBackground } from "@/lib/cache";
import { breakers } from "./breaker";
import { recordSourceCall } from "./stats";
import { SourceError, toSourceError } from "./source-error";

const classified = new WeakMap<object, SourceError>();

/** The classification recorded for an error a source call threw, or a fresh one. */
export function sourceErrorOf(source: string, e: unknown): SourceError {
  return (e && typeof e === "object" ? classified.get(e) : undefined) ?? toSourceError(source, e);
}

/** Record how an error thrown outside callSource should be read (a source's own short-circuit, such as FMP's daily-limit flag). Returns it. */
export function classifyAs<E>(e: E, se: SourceError): E {
  if (e && typeof e === "object") classified.set(e, se);
  return e;
}

/** A JSON body that would not parse (provider drift, an HTML error page) is a schema failure. Pure. */
export const isParseError = (e: unknown) => e instanceof SyntaxError;

export type CallOptions<T> = {
  /** An answer that holds nothing where data was expected (counts as "empty", which never opens the breaker). */
  empty?: (v: T) => boolean;
  /** Classify a source-specific error ("Limit Reach" → rate-limit); default toSourceError, and parse errors as schema. */
  classify?: (e: unknown) => SourceError | undefined;
  /** Ask the breaker first and count failures toward it. Default true. */
  breaker?: boolean;
  /** Who people read about when the breaker refuses ("FMP"). */
  label?: string;
  fallback?: boolean;
  hedge?: boolean;
};

export async function callSource<T>(source: string, op: string, fn: () => Promise<T>, o: CallOptions<T> = {}): Promise<T> {
  const useBreaker = o.breaker !== false;
  let release: (() => Promise<void>) | undefined;
  if (useBreaker) {
    const gate = await breakers.gate(source).catch(() => ({ allowed: true, release: undefined }));
    if (!gate.allowed) {
      recordSourceCall({ source, op, ms: 0, outcome: "skip", kind: "breaker-open", fallback: o.fallback, hedge: o.hedge });
      throw new SourceError(source, "breaker-open", `${o.label ?? source} is not answering right now. Try again shortly.`, 503);
    }
    release = gate.release;
  }
  const t0 = performance.now();
  try {
    const v = await fn();
    if (o.empty?.(v)) throw new SourceError(source, "empty", `${o.label ?? source} had no data for this`);
    recordSourceCall({ source, op, ms: performance.now() - t0, outcome: "ok", fallback: o.fallback, hedge: o.hedge });
    if (useBreaker) inBackground(breakers.success(source));
    return v;
  } catch (e) {
    const se = o.classify?.(e) ?? (isParseError(e) ? new SourceError(source, "schema", `${o.label ?? source} sent something we could not read`, undefined, { cause: e }) : toSourceError(source, e));
    if (e && typeof e === "object") classified.set(e, se);
    recordSourceCall({ source, op, ms: performance.now() - t0, outcome: "fail", kind: se.kind, fallback: o.fallback, hedge: o.hedge });
    if (useBreaker) inBackground(breakers.failure(source, se));
    throw e;
  } finally {
    if (release) inBackground(release());
  }
}
