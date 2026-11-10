/**
 * A held company's new 10-Q or 10-K, read for what changed in its risk factors against the one before
 * (Edge's change radar, src/lib/edge/docs/changes.ts): new, dropped and reworded paragraphs. The Book's
 * daily check looks for a periodic filing newer than the last one it read for each name held, runs the
 * radar once per new filing (two documents, cached), and keeps the result for two weeks; the position then
 * shows it and its holders get one alert. Page loads only read the cache. Pure (safe on the client); the
 * fetching is in ./filings-store.ts.
 */
import type { CompanyData } from "@/lib/types";

export type FilingFact = {
  form: string; filed: string; url: string;
  counts: { added: number; removed: number; changed: number; unchanged: number };
  summary: string[]; prior: string | null; asOf: string;
};

export const FILING_DAYS = 14;

/** The newest 10-K or 10-Q in a company record. */
export function latestPeriodic(c: Pick<CompanyData, "filings">): { form: "10-K" | "10-Q"; filed: string; url: string } | null {
  const f = c.filings.find((x) => x.form === "10-K" || x.form === "10-Q");
  return f ? { form: f.form as "10-K" | "10-Q", filed: f.filed, url: f.url } : null;
}

/** One line for a person: what moved in the risk factors. */
export function filingLine(f: FilingFact): string {
  const { added, removed, changed } = f.counts;
  if (!added && !removed && !changed) return `Risk factors unchanged from the ${f.prior ? `${f.form} filed ${f.prior}` : "previous filing"}.`;
  const parts = [added ? `${added} added` : "", removed ? `${removed} removed` : "", changed ? `${changed} reworded` : ""].filter(Boolean);
  return `Risk factors: ${parts.join(", ")} paragraph${added + removed + changed === 1 ? "" : "s"} against the ${f.prior ? `${f.form} filed ${f.prior}` : "previous one"}.`;
}

/** Whether a filing is recent enough to show and alert on. */
export const isFresh = (f: FilingFact | null, now: Date) => !!f && Date.parse(`${f.filed}T00:00:00Z`) >= now.getTime() - FILING_DAYS * 86_400_000;
