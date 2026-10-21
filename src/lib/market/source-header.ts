/**
 * The `x-data-sources` header every market-data route sends (the terminal's functions and
 * /api/companies), so a screen can name the sources that answered and badge the answer: "Backup
 * source" (a backup answered), "Delayed" and "Stale · as of HH:MM ET".
 *
 * Delayed: a value a provider marked as not real time (Nasdaq's isRealTime: false), or, when the
 * operator sets MARKET_DATA_DELAYED_MINUTES (no default: whether the feed is delayed depends on the
 * plan and licence, which is the owner's call), every price from a quote feed, labelled "Delayed N min".
 */
import type { SourceMeta } from "./provenance";

/** Providers whose answers are exchange prices (a filing or a central-bank fixing is not "delayed"). */
const PRICE_FEEDS = new Set(["FMP", "Nasdaq"]);
const MAX_NOTES = 8;

/** The operator's declared delay of the quote feed, in minutes, or null when not set. */
export function delayedMinutes(): number | null {
  const n = Math.round(Number(process.env.MARKET_DATA_DELAYED_MINUTES));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export type SourcesHeader = { providers: string[]; notes: string[]; asOf?: string; fetchedAt?: string; stale?: boolean; delayed?: boolean; delayedMinutes?: number };

/** The header for an answer: nothing when no source was noted. */
export function sourceHeaders(run: { providers: string[]; notes: string[]; meta?: SourceMeta }): Record<string, string> {
  const providers = [...new Set(run.providers)];
  if (!providers.length) return {};
  const m = run.meta ?? {};
  const minutes = providers.some((p) => PRICE_FEEDS.has(p)) ? delayedMinutes() : null;
  const body: SourcesHeader = {
    providers, notes: [...new Set(run.notes)].slice(0, MAX_NOTES),
    ...(m.asOf ? { asOf: m.asOf } : {}), ...(m.fetchedAt ? { fetchedAt: m.fetchedAt } : {}), ...(m.stale ? { stale: true } : {}),
    ...(m.delayed || minutes ? { delayed: true } : {}), ...(minutes ? { delayedMinutes: minutes } : {}),
  };
  return { "x-data-sources": JSON.stringify(body) };
}
