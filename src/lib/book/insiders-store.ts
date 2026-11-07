/**
 * Insider selling on the server (src/lib/book/insiders.ts has the rules): reading a company's Form 4s in the
 * window from EDGAR, and the 30-hour cache the Book reads.
 */
import type { InsiderTx } from "@/lib/edgar/insiders";
import { INSIDER_DAYS, insiderUrl, netSelling, windowFilings, type InsiderFact } from "./insiders";

const CACHE_MS = 30 * 3_600_000;
const key = (ticker: string) => `book-insiders:${ticker}`;

/** Read the Form 4s in the window from EDGAR and work out the figure; cached for the page loads that follow. */
export async function fetchInsiderFact(ticker: string, cik: string, now = new Date()): Promise<InsiderFact> {
  const [{ getSubmissions, listFilings }, { form4Xml }, { parseInsiderXml }, { cacheSet }] = await Promise.all([import("@/lib/edgar/submissions"), import("@/lib/edgar/form4"), import("@/lib/edgar/insiders"), import("@/lib/cache")]);
  const since = new Date(now.getTime() - INSIDER_DAYS * 86_400_000).toISOString().slice(0, 10);
  const sub = await getSubmissions(cik.padStart(10, "0"));
  const recent = sub.filings.recent;
  const { indexes, complete } = windowFilings(recent, recent.form.length >= 1000, since);
  // listFilings matches form prefixes ("4" also takes 424B2, 425, 40-F), so read the whole list and filter here;
  // a cap applied before the filter would let a bank's prospectuses crowd out its Form 4s.
  const filings = listFilings(sub, ["4"], recent.form.length).filter((f) => (f.form === "4" || f.form === "4/A") && f.filed >= since).slice(0, indexes.length);
  const txs: (InsiderTx & { amendment: boolean })[] = [];
  let failures = 0;
  for (let i = 0; i < filings.length; i += 8) {
    await Promise.all(filings.slice(i, i + 8).map(async (f) => {
      try { txs.push(...parseInsiderXml(await form4Xml(f.url.replace(/\/xsl[^/]*\//, "/"), f.accession), f).map((t) => ({ ...t, amendment: f.form === "4/A" }))); } catch { failures++; }
    }));
  }
  const ns = netSelling(txs, since);
  const ok = complete && failures === 0 && ns.priced && filings.length === indexes.length;
  const fact: InsiderFact = {
    value: ok ? ns.value : null, complete: ok, filings: filings.length, trades: ns.trades, since, asOf: now.toISOString(), url: insiderUrl(cik),
    note: ok ? "" : failures ? `${failures} of ${filings.length} Form 4 filings could not be read` : !ns.priced ? "a sale or purchase was filed without a price" : "EDGAR's list did not reach back over the whole 90 days",
  };
  await cacheSet(key(ticker), JSON.stringify(fact), CACHE_MS);
  return fact;
}

/** The cached figure, or null when it has not been worked out in the last 30 hours. */
export async function cachedInsiderFact(ticker: string): Promise<InsiderFact | null> {
  const { cacheGet } = await import("@/lib/cache");
  const raw = await cacheGet(key(ticker)).catch(() => null);
  try { return raw ? (JSON.parse(raw) as InsiderFact) : null; } catch { return null; }
}
