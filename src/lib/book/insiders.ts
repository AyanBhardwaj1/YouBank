/**
 * Insider selling as a kill criterion: open-market sales (Form 4 code S) less open-market purchases (code P)
 * by a company's officers, directors and 10% owners over the last 90 days, in US$ millions, from the Form 4
 * filings on EDGAR. Grants, option exercises, tax withholding and gifts are not counted; 10b5-1 plan sales
 * cannot be told apart in this data, so they count as sales.
 *
 * A figure is given only when it is complete: every Form 4 filed in the window was read and parsed, and
 * every counted trade has a price. Anything less reads as no data, never as "no selling" (a missing filing
 * would otherwise pass a "selling at most $X" criterion it should fail).
 *
 * Fetching is costly (one request per filing), so it happens only for names whose criteria use it: in the
 * Book's daily check and once when such a position is saved. Page loads read the cached result (30 hours).
 * Pure (safe on the client), tested in scripts/test-book.ts; fetching and caching are in ./insiders-store.ts.
 */
import type { InsiderTx } from "@/lib/edgar/insiders";

export const INSIDER_DAYS = 90;
export type InsiderFact = { value: number | null; complete: boolean; filings: number; trades: number; since: string; asOf: string; url: string; note: string };

type Recent = { filingDate: string[]; form: string[] };

/** The Form 4 filings filed since `since` (newest first, as EDGAR lists them), and whether the list can be complete. */
export function windowFilings(recent: Recent, hasOlderPages: boolean, since: string, cap = 200): { indexes: number[]; complete: boolean } {
  const indexes: number[] = [];
  for (let i = 0; i < recent.form.length; i++) {
    if (recent.filingDate[i] < since) break;
    if (recent.form[i] === "4" || recent.form[i] === "4/A") indexes.push(i);
  }
  // Complete only when EDGAR's recent list reaches back before the window (or holds every filing there is),
  // and the window did not hold more Form 4s than we read.
  const last = recent.filingDate[recent.filingDate.length - 1];
  const reachesBack = !hasOlderPages || (last !== undefined && last < since);
  return { indexes: indexes.slice(0, cap), complete: reachesBack && indexes.length <= cap };
}

/**
 * Net open-market selling ($M) from parsed Form 4 lines on or after `since`; incomplete when a counted trade
 * has no price. A Form 4/A restates the lines it amends, so where an amendment reports an owner's trades of
 * one kind on one day, those lines replace the original filing's for that owner, day and kind (counting
 * both would double the sale). An amendment with no trades (a footnote fix) changes nothing.
 */
export function netSelling(txs: (InsiderTx & { amendment?: boolean })[], since: string): { value: number; trades: number; priced: boolean } {
  let net = 0, trades = 0, priced = true;
  const group = (t: InsiderTx) => `${t.owner}|${t.date}|${t.code}`;
  const amended = new Set(txs.filter((t) => t.amendment && !t.derivative).map(group));
  for (const t of txs) {
    if (t.derivative || t.date < since || (t.code !== "S" && t.code !== "P")) continue;
    if (!t.amendment && amended.has(group(t))) continue;
    trades++;
    if (t.price === null || t.shares === null) { priced = false; continue; }
    net += (t.code === "S" ? 1 : -1) * t.shares * t.price;
  }
  return { value: Math.round((net / 1e6) * 100) / 100, trades, priced };
}

export const insiderUrl = (cik: string) => `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik.padStart(10, "0")}&type=4&dateb=&owner=include&count=40`;
