import { searchStartups, startupFacets } from "@/lib/vc/directory";
import { discoverStartups } from "@/lib/vc/sources/web";
import { upsertStartups } from "@/lib/vc/directory";
(async () => {
  const f = await startupFacets();
  console.log("total", f.total, "sources", f.sources, "countries", f.countries.slice(0, 8).map((c) => `${c.country}:${c.n}`).join(" "));
  const r = await searchStartups({ q: "voice", pageSize: 5 });
  console.log("search 'voice':", r.total, r.rows.map((x) => `${x.name} [${x.program}]`));
  const fd = await searchStartups({ source: "formd", pageSize: 5 });
  console.log("formd sample:", fd.total, fd.rows.map((x) => `${x.name} · ${x.raised} · ${x.location} · ${x.founders.slice(0, 40)}`));
  if (process.argv[2] === "discover") {
    const t0 = Date.now();
    const rows = await discoverStartups("fintech startups in Nigeria founded after 2022");
    console.log(`discover: ${rows.length} rows in ${((Date.now() - t0) / 1000).toFixed(0)}s`, rows.slice(0, 6).map((x) => `${x.name} (${x.country}, ${x.fundingStage})`));
    console.log("written", await upsertStartups(rows));
  }
})().catch((e) => { console.error("ERR", e); process.exit(1); });
