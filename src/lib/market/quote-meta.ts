/**
 * A quote's freshness for provenance: its as-of, stale when it is behind the NYSE session (calendar.ts),
 * delayed when the feed says so. Off-session quotes are not judged, and their as-of is left out of the
 * answer's oldest as-of. Pure but for the clock.
 */
import { isStaleQuote } from "./calendar";
import type { SourceMeta } from "./provenance";

export const quoteMeta = (asOf: string | null, delayed: boolean | undefined, session: boolean): SourceMeta => ({ ...(asOf && session ? { asOf, stale: isStaleQuote(asOf) } : {}), ...(delayed ? { delayed } : {}) });
