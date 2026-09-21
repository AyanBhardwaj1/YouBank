/** Debug helper: pnpm exec tsx --env-file=.env.local scripts/company.ts XOM */
import { getCompanyData } from "@/lib/company";

const t = process.argv[2] ?? "SNOW";
getCompanyData(t).then((c) => {
  if (!c) { console.log("unknown ticker"); return; }
  console.log(c.name, "| LTM end", c.ltm.periodEnd, "| rev", c.ltm.revenue, "prior", c.ltm.priorRevenue, "| GP", c.ltm.grossProfit, "OpInc", c.ltm.operatingIncome, "NI", c.ltm.netIncome, "| debt", c.balance.debt, "cash", c.balance.cash);
  console.log("quarters", c.quarters.map((q) => `${q.label}:${q.revenue}`).join(" "));
  console.log("concepts", c.sources.concepts);
  console.log("notes", c.sources.notes.slice(0, 3));
}).catch((e) => { console.error("ERR", e); process.exit(1); });
