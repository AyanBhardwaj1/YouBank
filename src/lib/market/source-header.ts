/**
 * The response headers every market-data route sends (the terminal's functions and /api/companies), in
 * one builder, so a screen can name the sources that answered and badge the answer: "Backup source" (a
 * backup answered), "Delayed" and "Stale · as of HH:MM ET".
 *
 * `x-data-sources` is JSON: the providers, their notes ("S&P 500 via SPY"), the registry adapters that
 * answered (`sources: [{ id, label, provider }]`, registry.ts), and the freshness summary from provenance.ts:
 * `stale` (a value served past its fresh lifetime, or behind the market), `delayed`, the oldest `asOf`
 * (when the value is true for) and `oldestFetchedAt`. Flags are sent only when set. Its size is bounded:
 * at most eight notes and eight sources, each cut short. `Server-Timing` carries each source's time.
 *
 * Delayed: a value a provider marked as not real time (Nasdaq's isRealTime: false), or, when the
 * operator sets MARKET_DATA_DELAYED_MINUTES (no default: whether the feed is delayed depends on the
 * plan and licence, which is the owner's call), every price from a quote feed, labelled "Delayed N min".
 */
import { serverTiming, type AnsweredBy, type ProvenanceRun, type SourceMeta } from "./provenance";

/** Providers whose answers are exchange prices (a filing or a central-bank fixing is not "delayed"). */
const PRICE_FEEDS = new Set(["FMP", "Nasdaq"]);
const MAX_NOTES = 8;
const MAX_SOURCES = 8;
const MAX_TEXT = 120;

/** The operator's declared delay of the quote feed, in minutes, or null when not set. */
export function delayedMinutes(): number | null {
  const n = Math.round(Number(process.env.MARKET_DATA_DELAYED_MINUTES));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type SourcesHeader = {
  providers: string[]; notes: string[];
  /** The registry adapters that answered, by id and by their name for people (with the provider each reports as). */
  sources?: AnsweredBy[];
  asOf?: string; oldestFetchedAt?: string; stale?: boolean; delayed?: boolean; delayedMinutes?: number;
};

/** What the builder reads: a provenance run (withProvenance), or just its providers and notes with a freshness summary. */
export type HeaderInput = Pick<ProvenanceRun<unknown>, "providers" | "notes"> & Partial<Omit<ProvenanceRun<unknown>, "providers" | "notes" | "meta">> & { meta?: SourceMeta };

const cut = (s: string) => (s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT - 1)}…` : s);

/** The x-data-sources body for an answer, or null when no source was noted. Pure (but for the operator's delay setting). */
export function sourcesBody(run: HeaderInput): SourcesHeader | null {
  const providers = [...new Set(run.providers)];
  if (!providers.length) return null;
  const m = run.meta ?? {};
  const asOf = run.asOf ?? m.asOf, fetchedAt = run.oldestFetchedAt ?? m.fetchedAt;
  const stale = run.stale || m.stale, delayed = run.delayed || m.delayed;
  const minutes = providers.some((p) => PRICE_FEEDS.has(p)) ? delayedMinutes() : null;
  const sources = [...new Map((run.sources ?? []).map((s) => [s.id, s])).values()].slice(0, MAX_SOURCES).map((s) => ({ id: cut(s.id), label: cut(s.label), ...(s.provider ? { provider: s.provider } : {}) }));
  return {
    providers, notes: [...new Set(run.notes)].slice(0, MAX_NOTES).map(cut),
    ...(sources.length ? { sources } : {}),
    ...(asOf ? { asOf } : {}), ...(fetchedAt ? { oldestFetchedAt: fetchedAt } : {}), ...(stale ? { stale: true } : {}),
    ...(delayed || minutes ? { delayed: true } : {}), ...(minutes ? { delayedMinutes: minutes } : {}),
  };
}

/**
 * Both headers for a route's answer: `x-data-sources` (nothing when no source was noted) and
 * `Server-Timing` from the run's per-source timings (with `total` when `totalMs` is given).
 */
export function sourceHeaders(run: HeaderInput, totalMs?: number): Record<string, string> {
  const body = sourcesBody(run);
  const stale = !!(run.stale || run.meta?.stale);
  const timing = run.timings || totalMs !== undefined ? serverTiming(run.timings ?? [], totalMs, stale) : "";
  return { ...(body ? { "x-data-sources": JSON.stringify(body) } : {}), ...(timing ? { "Server-Timing": timing } : {}) };
}
