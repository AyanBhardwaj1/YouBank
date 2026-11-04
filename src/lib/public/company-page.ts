/**
 * What a public company page (/c/TICKER) shows, from the shared SEC record: identity, LTM fundamentals,
 * quarterly revenue, recent filings and peers. Public-domain SEC data only: prices, market value and
 * multiples stay inside the app, where the price feed's terms apply. Pure, tested in scripts/test-company-page.ts.
 */
import type { CompanyData } from "@/lib/types";
import { PEER_GROUPS, DEFAULT_WATCHLIST } from "@/lib/static-data";

/** A ticker as it appears in a public URL: upper case, letters and digits, one class suffix. */
export const publicTicker = (raw: string) => {
  const t = decodeURIComponent(raw).trim().toUpperCase();
  return /^[A-Z][A-Z0-9]{0,9}([.-][A-Z0-9]{1,3})?$/.test(t) ? t : null;
};

const money = (mm: number | null) => {
  if (mm === null || !Number.isFinite(mm)) return "n/a";
  const a = Math.abs(mm), sign = mm < 0 ? "-" : "";
  return a >= 1000 ? `${sign}$${(a / 1000).toFixed(1)}B` : `${sign}$${Math.round(a).toLocaleString("en-US")}M`;
};
const pct = (f: number | null) => (f === null || !Number.isFinite(f) ? "n/a" : `${(f * 100).toFixed(1)}%`);

export type PublicFacts = { label: string; value: string }[];

/** The LTM lines a reader scans first, formatted, with n/a where SEC data lacks one. */
export function publicFacts(c: CompanyData): PublicFacts {
  const l = c.ltm;
  const ratio = (x: number | null) => (x !== null && l.revenue ? x / l.revenue : null);
  const fcf = l.operatingCashFlow !== null && l.capex !== null ? l.operatingCashFlow - Math.abs(l.capex) : null;
  return [
    { label: "Revenue", value: money(l.revenue) },
    { label: "Growth", value: l.revenue !== null && l.priorRevenue ? pct(l.revenue / l.priorRevenue - 1) : "n/a" },
    { label: "Gross margin", value: pct(ratio(l.grossProfit)) },
    { label: "Operating margin", value: pct(ratio(l.operatingIncome)) },
    { label: "Free cash flow", value: money(fcf) },
    { label: "Net income", value: money(l.netIncome) },
  ];
}

/** Peers from YouBank's saved peer groups, without the company itself, at most `max`. */
export function publicPeers(ticker: string, max = 8): string[] {
  const out: string[] = [];
  for (const g of PEER_GROUPS) if (g.members.some((m) => m.ticker === ticker)) for (const m of g.members) if (m.ticker !== ticker && !out.includes(m.ticker)) out.push(m.ticker);
  return out.slice(0, max);
}

/** The tickers the sitemap lists: the saved peer groups and the default watchlist. */
export function sitemapTickers(): string[] {
  return [...new Set([...DEFAULT_WATCHLIST, ...PEER_GROUPS.flatMap((g) => g.members.map((m) => m.ticker))])].sort();
}

/** One sentence for the page's description, from the data alone. */
export function publicSummary(c: CompanyData): string {
  const f = Object.fromEntries(publicFacts(c).map((x) => [x.label, x.value]));
  const where = [c.sicLabel, c.hq].filter(Boolean).join(", ");
  return `${c.name} (${c.ticker})${where ? `, ${where}` : ""}: LTM revenue ${f["Revenue"]}${c.ltm.periodEnd ? ` to ${c.ltm.periodEnd}` : ""}${f["Growth"] !== "n/a" ? `, growth ${f["Growth"]}` : ""}${f["Operating margin"] !== "n/a" ? `, operating margin ${f["Operating margin"]}` : ""}. From SEC filings, with its latest 10-K, 10-Q and 8-K.`;
}
