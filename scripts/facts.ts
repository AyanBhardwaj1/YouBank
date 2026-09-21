/** Dump XBRL rows for a concept: pnpm exec tsx --env-file=.env.local scripts/facts.ts XOM Revenues */
import { resolveTicker } from "@/lib/edgar/tickers";
import { getCompanyFacts, normalize } from "@/lib/edgar/facts";

(async () => {
  const [t, concept = "Revenues", since = "2024-06-01"] = process.argv.slice(2);
  const row = await resolveTicker(t);
  if (!row) throw new Error("unknown ticker");
  const cf = await getCompanyFacts(row.cik);
  const raw = cf.facts["us-gaap"]?.[concept]?.units?.["USD"] ?? [];
  const rows = normalize(raw).filter((r) => r.end >= since);
  console.log(`${t} ${concept}: ${raw.length} raw rows, ${rows.length} normalized since ${since}`);
  for (const r of rows) console.log(`  ${r.start ?? "instant  "} -> ${r.end}  days=${String(r.days).padStart(3)}  ${r.form.padEnd(6)} filed ${r.filed}  fp=${r.fp} fy=${r.fy}  ${(r.val / 1e6).toFixed(0)}`);
  const all = Object.keys(cf.facts["us-gaap"] ?? {}).filter((k) => /Revenue|Sales/.test(k));
  console.log("revenue-ish concepts:", all.join(", "));
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
