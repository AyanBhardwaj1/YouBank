/**
 * Which data source answered. The terminal's data layer tries FMP first, then free sources (Nasdaq,
 * the ECB's reference rates, CoinGecko, SEC EDGAR), then AI web research. Each fetch notes the source it
 * used into the request's collector, so a screen can say where its numbers came from.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Provider = "FMP" | "Nasdaq" | "ECB" | "CoinGecko" | "SEC EDGAR" | "AI research";

/** Sources that are backups for FMP (a screen shows a badge when it used any of them). */
export const BACKUP_PROVIDERS: Provider[] = ["Nasdaq", "ECB", "CoinGecko", "SEC EDGAR", "AI research"];

/** When a source's value is true for and how it reached us: the oldest as-of wins; any stale or delayed value marks the answer. */
export type SourceMeta = { asOf?: string; fetchedAt?: string; stale?: boolean; delayed?: boolean };

type Collector = { providers: Set<Provider>; notes: Set<string>; meta: SourceMeta };
const store = new AsyncLocalStorage<Collector>();

/** Record that `provider` supplied data for the current request, with an optional note ("S&P 500 via SPY"). */
export function noteSource(provider: Provider, note?: string, meta?: SourceMeta) {
  const c = store.getStore();
  if (!c) return;
  c.providers.add(provider);
  if (note) c.notes.add(note);
  if (meta) mergeMeta(c.meta, meta);
}

function mergeMeta(into: SourceMeta, m: SourceMeta) {
  if (m.asOf && (!into.asOf || m.asOf < into.asOf)) into.asOf = m.asOf;
  if (m.fetchedAt && (!into.fetchedAt || m.fetchedAt < into.fetchedAt)) into.fetchedAt = m.fetchedAt;
  if (m.stale) into.stale = true;
  if (m.delayed) into.delayed = true;
}

/** Run `fn` and report every source it used. */
export async function withProvenance<T>(fn: () => Promise<T>): Promise<{ value: T; providers: Provider[]; notes: string[]; meta: SourceMeta }> {
  const c: Collector = { providers: new Set(), notes: new Set(), meta: {} };
  const value = await store.run(c, fn);
  return { value, providers: [...c.providers], notes: [...c.notes], meta: c.meta };
}

/** For a failure path: the sources tried so far, when the caller wants to report them with the error. */
export function currentProviders(): Provider[] {
  return [...(store.getStore()?.providers ?? [])];
}
