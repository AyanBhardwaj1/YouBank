/**
 * New-filing facts on the server (src/lib/book/filings.ts has the shapes and the pure parts): reading a held
 * company's newly filed 10-Q or 10-K with Edge's change radar, and the cache the Book reads.
 */
import type { CompanyData } from "@/lib/types";
import { FILING_DAYS, latestPeriodic, type FilingFact } from "./filings";

const key = (ticker: string) => `book-filing:${ticker}`;

export async function cachedFilingFact(ticker: string): Promise<FilingFact | null> {
  const { cacheGet } = await import("@/lib/cache");
  const raw = await cacheGet(key(ticker)).catch(() => null);
  try { return raw ? (JSON.parse(raw) as FilingFact) : null; } catch { return null; }
}

/** Read a newly filed 10-Q or 10-K for this company, if there is one the cache has not seen. */
export async function noteNewFiling(ticker: string, company: CompanyData, now = new Date()): Promise<FilingFact | null> {
  const latest = latestPeriodic(company);
  if (!latest || Date.parse(`${latest.filed}T00:00:00Z`) < now.getTime() - FILING_DAYS * 86_400_000) return null;
  const seen = await cachedFilingFact(ticker);
  if (seen?.url === latest.url) return seen;
  const [{ changeRadar }, { cacheSet }] = await Promise.all([import("@/lib/edge/docs/changes"), import("@/lib/cache")]);
  const r = await changeRadar(ticker, latest.form, "risk");
  if (!r.current) return null;
  const fact: FilingFact = { form: r.form, filed: r.current.filed, url: r.current.url, counts: r.counts, summary: r.summary.slice(0, 2).map((x) => x.slice(0, 300)), prior: r.prior?.filed ?? null, asOf: now.toISOString() };
  await cacheSet(key(ticker), JSON.stringify(fact), (FILING_DAYS + 2) * 86_400_000);
  return fact;
}
