/**
 * Build the machine slice of the finance eval set (B1) from SEC XBRL company facts, pinned to each
 * company's latest 10-K by period and accession. Reads SEC directly, not the app's getCompanyData.
 *   EDGAR_USER_AGENT="YourCo you@yourco.com" pnpm exec tsx --env-file=.env.local scripts/eval-agent-build.mts [TICKER ...]
 * Writes scripts/fixtures/eval-agent/xbrl-<date>.json. Re-freeze quarterly; keep old sets for the trend.
 */
import { writeFileSync } from "node:fs";
import { annualQuestions, type CompanyFactsJson } from "../src/lib/ai/evals/golden";

const UA = process.env.EDGAR_USER_AGENT;
if (!UA) throw new Error("Set EDGAR_USER_AGENT (SEC requires a company name and a contact address)");
const DEFAULT = ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "JPM", "XOM", "JNJ", "WMT", "PG", "KO", "PEP", "CSCO", "ORCL", "CRM", "ADBE", "INTC", "AMD", "NFLX", "SNOW", "DDOG", "NET", "CRWD", "ZS", "MDB", "TEAM", "SHOP", "UBER", "ABNB", "CAT", "DE", "BA", "GE", "HON", "UNH", "PFE", "MRK", "CVX", "NEE"];
const tickers = (process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT).map((t) => t.toUpperCase());

const get = async (url: string) => {
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
};
const map = (await get("https://www.sec.gov/files/company_tickers.json")) as Record<string, { cik_str: number; ticker: string }>;
const cikOf = new Map(Object.values(map).map((r) => [r.ticker.toUpperCase(), r.cik_str]));

const questions = [];
for (const t of tickers) {
  const cik = cikOf.get(t);
  if (!cik) { console.log(`${t}: not in SEC's ticker list, skipped`); continue; }
  try {
    const cf = (await get(`https://data.sec.gov/api/xbrl/companyfacts/CIK${String(cik).padStart(10, "0")}.json`)) as CompanyFactsJson;
    const qs = annualQuestions(cf, t);
    questions.push(...qs);
    console.log(`${t}: ${qs.length} questions${qs[0] ? ` (${qs[0].period})` : ""}`);
  } catch (e) { console.log(`${t}: ${(e as Error).message}`); }
  await new Promise((r) => setTimeout(r, 150)); // well under SEC's 10 requests a second
}
const out = `scripts/fixtures/eval-agent/xbrl-${new Date().toISOString().slice(0, 10)}.json`;
writeFileSync(out, JSON.stringify({ frozenAt: new Date().toISOString(), source: "SEC XBRL company facts, latest 10-K per company", questions }, null, 2));
console.log(`\n${questions.length} questions written to ${out}`);
