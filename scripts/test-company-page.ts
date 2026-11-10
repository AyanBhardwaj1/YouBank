/** Public company pages (src/lib/public/company-page.ts): pnpm exec tsx scripts/test-company-page.ts */
import { publicFacts, publicPeers, publicSummary, publicTicker, sitemapTickers } from "@/lib/public/company-page";
import type { CompanyData } from "@/lib/types";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const c = {
  ticker: "SNOW", name: "Snowflake Inc.", sicLabel: "Services-Prepackaged Software", hq: "Bozeman, MT",
  ltm: { periodEnd: "2026-07-31", revenue: 4520.5, priorRevenue: 3626.4, grossProfit: 3020, operatingIncome: -1250, da: 0, sbc: 0, ebitda: null, adjEbitda: null, operatingCashFlow: 1100, capex: -90, netIncome: -1200 },
} as unknown as CompanyData;

console.log("tickers in URLs");
ok("upper-cased, class suffix kept", [publicTicker("snow"), publicTicker("BRK.B"), publicTicker("brk-b")], ["SNOW", "BRK.B", "BRK-B"]);
ok("nothing else", [publicTicker("../etc"), publicTicker("A B"), publicTicker("%3Cx%3E"), publicTicker("")], [null, null, null, null]);
console.log("facts");
ok("formatted LTM lines", publicFacts(c).map((f) => f.value), ["$4.5B", "24.7%", "66.8%", "-27.7%", "$1.0B", "-$1.2B"]);
ok("missing data reads n/a, never NaN", publicFacts({ ...c, ltm: { ...c.ltm, revenue: null, operatingCashFlow: null } } as CompanyData).map((f) => f.value), ["n/a", "n/a", "n/a", "n/a", "n/a", "-$1.2B"]);
ok("a one-line summary from the data", publicSummary(c), "Snowflake Inc. (SNOW), Services-Prepackaged Software, Bozeman, MT: LTM revenue $4.5B to 2026-07-31, growth 24.7%, operating margin -27.7%. From SEC filings, with its latest 10-K, 10-Q and 8-K.");
console.log("peers and the sitemap");
ok("peers exclude the company", publicPeers("SNOW").includes("SNOW"), false);
ok("peers come from the saved groups", publicPeers("SNOW").includes("MDB"), true);
ok("a company in no group has none", publicPeers("ZZZZ"), []);
ok("sitemap tickers are unique and valid", sitemapTickers().every((t, i, a) => a.indexOf(t) === i && publicTicker(t) === t), true);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
