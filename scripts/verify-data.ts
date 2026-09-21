/** Smoke-test the new data paths: pnpm exec tsx --env-file=.env.local scripts/verify-data.ts */
import { resolveTicker } from "../src/lib/edgar/tickers";
import { conceptSeries, findConcepts } from "../src/lib/edgar/series";
import { insiderTransactions } from "../src/lib/edgar/insiders";
import { fullTextSearch } from "../src/lib/edgar/fulltext";
import { getSubmissions, listFilings } from "../src/lib/edgar/submissions";
import { evaluateScript } from "../src/lib/calc";

async function main() {
  const ccl = await resolveTicker("CCL");
  if (!ccl) throw new Error("CCL not resolved");
  const series = await conceptSeries(ccl.cik, ["LongTermDebt", "InterestExpense", "OperatingLeaseLiability"], 6);
  for (const s of series) console.log(`series ${s.concept}: unit=${s.unit} annual=${s.annual.length} quarterly=${s.quarterly.length} instants=${s.instants.length} latest=${(s.instants.at(-1) ?? s.annual.at(-1))?.value ?? s.error}`);
  const found = await findConcepts(ccl.cik, "Maturit", 8);
  console.log(`findConcepts Maturit -> ${found.length}: ${found.slice(0, 4).map((f) => f.concept).join(", ")}`);

  const sub = await getSubmissions(ccl.cik);
  const eightKs = listFilings(sub, ["8-K"], 6);
  console.log(`8-Ks: ${eightKs.map((f) => `${f.filed}[${f.items || "-"}]`).join(" ")}`);

  const nvda = await resolveTicker("NVDA");
  const tx = nvda ? await insiderTransactions(nvda.ticker, nvda.cik, 6) : [];
  console.log(`insiders NVDA: ${tx.length} rows; first=${tx[0] ? `${tx[0].date} ${tx[0].owner} ${tx[0].codeLabel} ${tx[0].shares}@${tx[0].price}` : "none"}`);

  const fts = await fullTextSearch({ q: '"agreement and plan of merger" software', forms: ["DEFM14A", "8-K"], from: "2026-01-01", limit: 5 });
  console.log(`fulltext: total=${fts.total} first=${fts.hits.slice(0, 3).map((h) => `${h.entity} ${h.form} ${h.filed}`).join(" | ")}`);

  const calc = evaluateScript("ev = 115.2b + 2.28b - 2.34b\nrev = 5.4346b\nev / rev\nirr(-100, 20, 30, 40, 55)\n1,234,567 + 1000");
  console.log(`calc: ${calc.results.map((r) => `${r.line.split("=")[0].trim()}=${r.value.toPrecision(6)}`).join(" | ")}`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
