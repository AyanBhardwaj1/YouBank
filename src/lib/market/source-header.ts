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
import type { FieldProvenance } from "./fields";
import { serverTiming, type AnsweredBy, type ProvenanceRun, type Skipped, type SourceMeta } from "./provenance";

/** Providers whose answers are exchange prices (a filing or a central-bank fixing is not "delayed"). */
const PRICE_FEEDS = new Set(["FMP", "Nasdaq"]);
const MAX_NOTES = 8;
const MAX_SOURCES = 8;
const MAX_TEXT = 120;
/** Attribution lines are longer (some sources ask for exact wording), and there are few. */
const MAX_ATTRIBUTION = 220;
const MAX_ATTRIBUTIONS = 6;
const MAX_SKIPPED = 6;
const MAX_FIELDS = 16;

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
  /** The credit each answering source requires, word for word ("Source: U.S. Energy Information Administration"). */
  attributions?: string[];
  /** Some of this came from the person's own key: never shown to anyone else. */
  yourKey?: boolean;
  /** Sources the person's order or this view named that could not answer, with the reason. */
  skipped?: Skipped[];
  /** Per field ("profile.price"): the source that filled it, or why it is empty ("—"). */
  fields?: Record<string, FieldProvenance>;
};

/** What the builder reads: a provenance run (withProvenance), or just its providers and notes with a freshness summary. */
export type HeaderInput = Pick<ProvenanceRun<unknown>, "providers" | "notes"> & Partial<Omit<ProvenanceRun<unknown>, "providers" | "notes" | "meta">> & { meta?: SourceMeta };

const cut = (s: string, max = MAX_TEXT) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** One answering adapter as the header carries it: id, label, provider, licence, and "your key". */
const sourceEntry = (s: AnsweredBy): AnsweredBy => ({ id: cut(s.id), label: cut(s.label), ...(s.provider ? { provider: s.provider } : {}), ...(s.licence ? { licence: s.licence } : {}), ...(s.yourKey ? { yourKey: true } : {}) });

/** What the header says about licences: required credits, "your key", skipped sources and per-field provenance. */
function licencePart(run: HeaderInput, sources: AnsweredBy[]) {
  const attributions = [...new Set(sources.map((s) => s.attribution).filter((a): a is string => !!a))].slice(0, MAX_ATTRIBUTIONS).map((a) => cut(a, MAX_ATTRIBUTION));
  const skipped = (run.skipped ?? []).slice(0, MAX_SKIPPED).map((k) => ({ dataset: cut(k.dataset), id: cut(k.id), label: cut(k.label), reason: cut(k.reason, MAX_ATTRIBUTION) }));
  const fieldEntries = Object.entries(run.fields ?? {}).slice(0, MAX_FIELDS).map(([f, p]): [string, FieldProvenance] => [cut(f), "reason" in p ? { reason: cut(p.reason, MAX_ATTRIBUTION) } : sourceEntry(p as AnsweredBy)]);
  return {
    ...(attributions.length ? { attributions } : {}), ...(sources.some((s) => s.yourKey) ? { yourKey: true } : {}),
    ...(skipped.length ? { skipped } : {}), ...(fieldEntries.length ? { fields: Object.fromEntries(fieldEntries) } : {}),
  };
}

/** The x-data-sources body for an answer, or null when no source was noted. Pure (but for the operator's delay setting). */
export function sourcesBody(run: HeaderInput): SourcesHeader | null {
  const providers = [...new Set(run.providers)];
  if (!providers.length) return null;
  const m = run.meta ?? {};
  const asOf = run.asOf ?? m.asOf, fetchedAt = run.oldestFetchedAt ?? m.fetchedAt;
  const stale = run.stale || m.stale, delayed = run.delayed || m.delayed;
  const minutes = providers.some((p) => PRICE_FEEDS.has(p)) ? delayedMinutes() : null;
  const answered = [...new Map((run.sources ?? []).map((s) => [s.id, s])).values()].slice(0, MAX_SOURCES);
  const sources = answered.map(sourceEntry);
  return {
    providers, notes: [...new Set(run.notes)].slice(0, MAX_NOTES).map((n) => cut(n)),
    ...(sources.length ? { sources } : {}), ...licencePart(run, answered),
    ...(asOf ? { asOf } : {}), ...(fetchedAt ? { oldestFetchedAt: fetchedAt } : {}), ...(stale ? { stale: true } : {}),
    ...(delayed || minutes ? { delayed: true } : {}), ...(minutes ? { delayedMinutes: minutes } : {}),
  };
}

/** JSON with every non-ASCII character escaped (\\u2014), so it is a valid header value; JSON.parse restores it. Pure. */
export const asciiJson = (v: unknown): string => JSON.stringify(v).replace(/[\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/**
 * Both headers for a route's answer: `x-data-sources` (nothing when no source was noted) and
 * `Server-Timing` from the run's per-source timings (with `total` when `totalMs` is given).
 */
export function sourceHeaders(run: HeaderInput, totalMs?: number): Record<string, string> {
  const body = sourcesBody(run);
  const stale = !!(run.stale || run.meta?.stale);
  const timing = run.timings || totalMs !== undefined ? serverTiming(run.timings ?? [], totalMs, stale) : "";
  return { ...(body ? { "x-data-sources": asciiJson(body) } : {}), ...(timing ? { "Server-Timing": timing } : {}) };
}
