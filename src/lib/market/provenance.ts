/**
 * Which data source answered. The terminal's data layer tries FMP first, then free sources (Nasdaq,
 * the ECB's reference rates, CoinGecko, SEC EDGAR), then AI web research. Each fetch notes the source it
 * used into the request's collector, so a screen can say where its numbers came from.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type Provider = "FMP" | "Nasdaq" | "ECB" | "CoinGecko" | "SEC EDGAR" | "AI research";

/** Sources that are backups for FMP (a screen shows a badge when it used any of them). */
export const BACKUP_PROVIDERS: Provider[] = ["Nasdaq", "ECB", "CoinGecko", "SEC EDGAR", "AI research"];

type Collector = { providers: Set<Provider>; notes: Set<string> };
const store = new AsyncLocalStorage<Collector>();

/** Record that `provider` supplied data for the current request, with an optional note ("S&P 500 via SPY"). */
export function noteSource(provider: Provider, note?: string) {
  const c = store.getStore();
  if (!c) return;
  c.providers.add(provider);
  if (note) c.notes.add(note);
}

/** Run `fn` and report every source it used. */
export async function withProvenance<T>(fn: () => Promise<T>): Promise<{ value: T; providers: Provider[]; notes: string[] }> {
  const c: Collector = { providers: new Set(), notes: new Set() };
  const value = await store.run(c, fn);
  return { value, providers: [...c.providers], notes: [...c.notes] };
}

/** For a failure path: the sources tried so far, when the caller wants to report them with the error. */
export function currentProviders(): Provider[] {
  return [...(store.getStore()?.providers ?? [])];
}
