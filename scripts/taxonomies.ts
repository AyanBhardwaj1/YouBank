import { resolveTicker } from "@/lib/edgar/tickers";
import { getCompanyFacts, normalize } from "@/lib/edgar/facts";
(async () => {
  const row = await resolveTicker(process.argv[2] ?? "XOM");
  const cf = await getCompanyFacts(row!.cik);
  for (const [tax, concepts] of Object.entries(cf.facts)) {
    const names = Object.keys(concepts);
    console.log(`taxonomy ${tax}: ${names.length} concepts`);
    if (tax !== "us-gaap" && tax !== "dei") console.log("  ", names.join(", "));
  }
  // us-gaap concepts with the most recent duration coverage, USD, days ~90/180/270/365
  const scored = Object.entries(cf.facts["us-gaap"] ?? {}).map(([k, v]) => {
    const rows = normalize(v.units?.["USD"] ?? []).filter((r) => r.start && r.end >= "2024-06-01");
    return { k, n: rows.length, max: rows.reduce((m, r) => Math.max(m, r.val), 0) };
  }).filter((x) => x.n >= 6).sort((a, b) => b.max - a.max).slice(0, 12);
  console.log("largest recent duration concepts:", scored.map((x) => `${x.k}(${x.n}, ${(x.max / 1e9).toFixed(0)}B)`).join("; "));
})();
