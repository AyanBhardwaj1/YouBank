/**
 * Which data source answered, and how fresh it was. The terminal's data layer tries each dataset's
 * sources in the registry's order (registry.ts: FMP first, then free sources such as Nasdaq, the ECB's
 * reference rates, CoinGecko and SEC EDGAR, then AI web research). Each answer notes the source it used
 * into the request's collector, so a screen can say where its numbers came from, whether any of them was
 * served stale (from cache, past its fresh lifetime), and as of when.
 *
 * The same collector gathers per-source timings for the Server-Timing header (stats.ts records them).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { FieldProvenance } from "./fields";
import type { Licence } from "./sources-meta";

export type Provider =
  | "FMP" | "Nasdaq" | "ECB" | "CoinGecko" | "SEC EDGAR" | "AI research" | "US Treasury" | "FRED" | "BLS" | "DefiLlama"
  | "BEA" | "EIA" | "World Bank" | "CFTC" | "Federal Register" | "GDELT" | "Tiingo" | "Twelve Data" | "Alpha Vantage" | "Finnhub" | "FMP (your key)";

/** Sources that are backups for FMP (a screen shows a badge when it used any of them). */
export const BACKUP_PROVIDERS: Provider[] = ["Nasdaq", "ECB", "CoinGecko", "SEC EDGAR", "AI research"];

/** When a source's value is true for and how it reached us: the oldest as-of wins; any stale or delayed value marks the answer. */
export type SourceMeta = { asOf?: string; fetchedAt?: string; stale?: boolean; delayed?: boolean };

/**
 * A registry adapter that answered (registry.ts): its id and its name for people (and the provider it
 * reports as, so a badge can name it), its licence and the credit it requires, and `yourKey` when the
 * person's own key fetched it.
 */
export type AnsweredBy = { id: string; label: string; provider?: Provider; licence?: Licence; attribution?: string; yourKey?: boolean };

/** A source the person's order (or this view's choice) named that could not answer here, and why. */
export type Skipped = { dataset: string; id: string; label: string; reason: string };

/** One upstream call's time, for Server-Timing. */
export type Timing = { source: string; ms: number; ok: boolean; hedge?: boolean };

type Collector = {
  providers: Set<Provider>; notes: Set<string>; adapters: Map<string, AnsweredBy>; timings: Timing[];
  stale: boolean; delayed: boolean; oldestFetchedAt?: string; asOf?: string;
  skipped: Map<string, Skipped>; fields: Map<string, FieldProvenance>;
  /** Answers kept for this request only (FRED: its terms bar storing or caching its content). */
  memo: Map<string, Promise<unknown>>;
};
const MAX_SKIPPED = 20;
const MAX_FIELDS = 40;
const store = new AsyncLocalStorage<Collector>();

const older = (a: string | undefined, b: string | undefined) => (!a ? b : !b ? a : Date.parse(b) < Date.parse(a) ? b : a);

/** Fold freshness into the collector: any stale or delayed answer marks the response; the oldest times win. */
function fold(c: Collector, meta?: SourceMeta) {
  if (!meta) return;
  if (meta.stale) c.stale = true;
  if (meta.delayed) c.delayed = true;
  if (meta.fetchedAt && Number.isFinite(Date.parse(meta.fetchedAt))) c.oldestFetchedAt = older(c.oldestFetchedAt, meta.fetchedAt);
  if (meta.asOf && Number.isFinite(Date.parse(meta.asOf))) c.asOf = older(c.asOf, meta.asOf);
}

/** Record that `provider` supplied data for the current request, with an optional note ("S&P 500 via SPY") and its freshness. */
export function noteSource(provider: Provider, note?: string, meta?: SourceMeta) {
  const c = store.getStore();
  if (!c) return;
  c.providers.add(provider);
  if (note) c.notes.add(note);
  fold(c, meta);
}

/** Freshness without naming a provider (a cached copy served stale, wherever it came from). */
export function noteFreshness(meta: SourceMeta) {
  const c = store.getStore();
  if (c) fold(c, meta);
}

/** The registry adapter that answered (its id, label, licence, credit and whether it was the person's key). */
export function noteAdapter(a: AnsweredBy) {
  const c = store.getStore();
  if (c && !c.adapters.has(a.id)) {
    c.adapters.set(a.id, { id: a.id, label: a.label, ...(a.provider ? { provider: a.provider } : {}), ...(a.licence ? { licence: a.licence } : {}), ...(a.attribution ? { attribution: a.attribution } : {}), ...(a.yourKey ? { yourKey: true } : {}) });
  }
}

/** A source that was asked for but could not answer (no key, switched off, not for this data), once per dataset and id. */
export function noteSkipped(s: Skipped) {
  const c = store.getStore();
  const k = `${s.dataset}:${s.id}`;
  if (c && !c.skipped.has(k) && c.skipped.size < MAX_SKIPPED) c.skipped.set(k, s);
}

/** Per-field provenance for a dataset's answer: fields filled from another source, and empty fields with their reason. */
export function noteFields(dataset: string, fields: Record<string, FieldProvenance>) {
  const c = store.getStore();
  if (!c) return;
  for (const [f, p] of Object.entries(fields)) if (c.fields.size < MAX_FIELDS) c.fields.set(`${dataset}.${f}`, p);
}

/** One upstream call's time (stats.ts calls this for every call it records). */
export function noteTiming(t: Timing) {
  const c = store.getStore();
  if (c && c.timings.length < 200) c.timings.push(t);
}

export type ProvenanceRun<T> = {
  value: T; providers: Provider[]; notes: string[];
  /** The registry adapters that answered, in order. */
  sources: AnsweredBy[];
  /** Any answer was served past its fresh lifetime (from cache, while refreshing or because the source failed). */
  stale: boolean;
  /** Any answer is delayed data (exchange delay). */
  delayed: boolean;
  /** The oldest fetch time among the answers that reported one. */
  oldestFetchedAt?: string;
  /** The oldest "true as of" time among the answers that reported one. */
  asOf?: string;
  timings: Timing[];
  /** The same freshness summary as one value (oldest as-of and fetch time, stale, delayed), for callers that pass it along. */
  meta: SourceMeta;
  /** Sources asked for that could not answer, with the reason. */
  skipped: Skipped[];
  /** Per field ("profile.price"): the source that filled it, or why it is empty. */
  fields: Record<string, FieldProvenance>;
};

/** Run `fn` and report every source it used. */
export async function withProvenance<T>(fn: () => Promise<T>): Promise<ProvenanceRun<T>> {
  const c: Collector = { providers: new Set(), notes: new Set(), adapters: new Map(), timings: [], stale: false, delayed: false, skipped: new Map(), fields: new Map(), memo: new Map() };
  const value = await store.run(c, fn);
  const meta: SourceMeta = { ...(c.asOf ? { asOf: c.asOf } : {}), ...(c.oldestFetchedAt ? { fetchedAt: c.oldestFetchedAt } : {}), ...(c.stale ? { stale: true } : {}), ...(c.delayed ? { delayed: true } : {}) };
  return {
    value, providers: [...c.providers], notes: [...c.notes], sources: [...c.adapters.values()], stale: c.stale, delayed: c.delayed,
    ...(c.oldestFetchedAt ? { oldestFetchedAt: c.oldestFetchedAt } : {}), ...(c.asOf ? { asOf: c.asOf } : {}), timings: c.timings, meta,
    skipped: [...c.skipped.values()], fields: Object.fromEntries(c.fields),
  };
}

/**
 * `load()` once per request: the same key asked twice while one request is answered (twelve FRED series
 * of one curve, the same series for two screens' parts) is fetched once, and forgotten when the request
 * ends. Outside a request (jobs, scripts) every call loads. Nothing is written anywhere.
 */
export function requestMemo<T>(key: string, load: () => Promise<T>): Promise<T> {
  const c = store.getStore();
  if (!c) return load();
  const hit = c.memo.get(key) as Promise<T> | undefined;
  if (hit) return hit;
  const p = load();
  c.memo.set(key, p);
  p.catch(() => c.memo.delete(key));
  return p;
}

/** For a failure path: the sources tried so far, when the caller wants to report them with the error. */
export function currentProviders(): Provider[] {
  return [...(store.getStore()?.providers ?? [])];
}

/* ---------------- Server-Timing ---------------- */

const token = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "source";

/**
 * Server-Timing (RFC: comma-separated `name;dur=ms;desc="…"`): one entry per source with its slowest call
 * and how many calls it took, `cache;desc="stale"` when a stale copy answered, and `total`. Names are the
 * sources' short ids only (already disclosed in x-data-sources), never URLs. Pure.
 */
export function serverTiming(timings: Timing[], totalMs?: number, stale = false): string {
  const by = new Map<string, { max: number; n: number; failed: number; hedged: number }>();
  for (const t of timings) {
    const k = token(t.source), e = by.get(k) ?? { max: 0, n: 0, failed: 0, hedged: 0 };
    e.max = Math.max(e.max, t.ms); e.n++; if (!t.ok) e.failed++; if (t.hedge) e.hedged++;
    by.set(k, e);
  }
  const parts = [...by.entries()].map(([k, e]) => {
    const desc = [`${e.n} call${e.n === 1 ? "" : "s"}`, e.failed ? `${e.failed} failed` : "", e.hedged ? `${e.hedged} hedged` : ""].filter(Boolean).join(", ");
    return `${k};dur=${e.max.toFixed(1)};desc="${desc}"`;
  });
  if (stale) parts.push(`cache;desc="stale"`);
  if (totalMs !== undefined) parts.push(`total;dur=${totalMs.toFixed(1)}`);
  return parts.join(", ");
}

/** Server-Timing back into entries (scripts/data-latency.mts reads production's headers with it). Pure. */
export function parseServerTiming(header: string | null | undefined): { name: string; dur: number | null; desc: string | null }[] {
  if (!header) return [];
  // Split on commas and semicolons outside quotes (a desc may hold either).
  const split = (s: string, sep: string) => {
    const out: string[] = []; let cur = "", quoted = false;
    for (const ch of s) {
      if (ch === '"') quoted = !quoted;
      if (ch === sep && !quoted) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  return split(header, ",").map((p) => {
    const [name, ...params] = split(p, ";");
    let dur: number | null = null, desc: string | null = null;
    for (const q of params) {
      const i = q.indexOf("="), k = i < 0 ? q : q.slice(0, i), val = i < 0 ? "" : q.slice(i + 1);
      if (k === "dur") dur = Number(val);
      if (k === "desc") desc = val.replace(/^"|"$/g, "");
    }
    return { name, dur: dur !== null && Number.isFinite(dur) ? dur : null, desc };
  });
}
