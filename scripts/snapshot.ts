/** Build the landing-page demo snapshot from real data: pnpm exec tsx --env-file=.env.local scripts/snapshot.ts */
import { writeFileSync } from "node:fs";
import { getCompanies } from "../src/lib/company";
import { derive } from "../src/lib/metrics";
import { searchStartups } from "../src/lib/vc/directory";

async function main() {
  const tickers = ["SNOW", "DDOG", "MDB", "NET", "CRWD", "GTLB", "PLTR", "NOW", "ESTC", "CCL", "AAL", "LUMN"];
  const res = await getCompanies(tickers, 3);
  const comps = tickers.map((t) => { const c = res[t]; if (!c || "error" in c) return null; const d = derive(c); return { ticker: c.ticker, name: c.name, price: c.price?.last ?? null, changePct: c.price?.changePct ?? null, marketCap: d.marketCap, ev: d.ev, evRevLtm: d.evRevLtm, evEbitdaLtm: d.evEbitdaLtm, growth: d.revenueGrowth, gm: d.grossMargin, fcfm: d.fcfMargin, r40: d.ruleOf40, revenue: c.ltm.revenue, debt: c.balance.debt, cash: c.balance.cash, ltmEnd: c.ltm.periodEnd, quarters: c.quarters.map((q) => ({ label: q.label, revenue: q.revenue })), fye: c.fye }; }).filter(Boolean);
  const startups = await searchStartups({ q: "", pageSize: 12, source: "yc" });
  const formd = await searchStartups({ q: "", pageSize: 6, source: "formd" });
  const hn = await searchStartups({ q: "", pageSize: 6, source: "hn" });
  const pick = (r: typeof startups.rows) => r.map((s) => ({ name: s.name, oneLiner: s.oneLiner.slice(0, 120), program: s.program, country: s.country, industries: s.industries.slice(0, 3), founders: s.founders.slice(0, 80), stage: s.fundingStage, raised: s.raised, source: s.source, website: s.website }));
  const out = { asOf: new Date().toISOString().slice(0, 10), comps, startups: [...pick(startups.rows), ...pick(formd.rows), ...pick(hn.rows)], directoryTotal: (await searchStartups({ q: "", pageSize: 1 })).total };
  writeFileSync("src/lib/demo/snapshot.json", JSON.stringify(out, null, 1));
  console.log(`wrote snapshot: ${comps.length} companies, ${out.startups.length} startups, directory ${out.directoryTotal}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
