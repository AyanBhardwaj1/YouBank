/**
 * One failure taxonomy for every data source (FMP, Nasdaq, SEC EDGAR, Treasury, FRED, BLS, CoinGecko,
 * DefiLlama, map services). Whatever went wrong upstream, the data layer sees a SourceError, and any
 * SourceError means "try the next source or serve the last good copy". MarketDataError stays for the
 * words people read; it is not what decides whether to fall back.
 */
import { isAbortLike, isNetworkError } from "@/lib/net";

export type SourceFailureKind =
  | "timeout" // no answer within the budget
  | "network" // DNS, refused, reset
  | "http" // a non-2xx answer other than a rate limit
  | "rate-limit" // 429, or the provider's own "limit reached" message
  | "schema" // the answer did not match the shape we read (provider drift)
  | "empty" // a well-formed answer with nothing in it where data was expected
  | "breaker-open"; // skipped: the source has been failing for everyone

export class SourceError extends Error {
  readonly name = "SourceError";
  constructor(
    readonly source: string,
    readonly kind: SourceFailureKind,
    message: string,
    readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Turn whatever a source call threw into a SourceError, keeping one already classified. */
export function toSourceError(source: string, e: unknown): SourceError {
  if (e instanceof SourceError) return e;
  if (isAbortLike(e)) return new SourceError(source, "timeout", `${source} did not answer in time`, undefined, { cause: e });
  if (isNetworkError(e)) return new SourceError(source, "network", `${source} could not be reached`, undefined, { cause: e });
  const status = (e as { status?: unknown } | null)?.status;
  if (typeof status === "number") {
    const kind: SourceFailureKind = status === 429 ? "rate-limit" : "http";
    return new SourceError(source, kind, `${source} answered ${status}`, status, { cause: e });
  }
  return new SourceError(source, "http", `${source} failed`, undefined, { cause: e });
}

/** Whether `e` is a source failure that a fallback (another source, or a stale copy) may answer for. */
export function isSourceFailure(e: unknown): boolean {
  return e instanceof SourceError || isAbortLike(e) || isNetworkError(e);
}
