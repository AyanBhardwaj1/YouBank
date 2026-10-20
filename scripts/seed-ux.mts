/**
 * Seed a local database with a little realistic content for the UX crawl (scripts/e2e-ux.ts), so the
 * Newsroom, its deal tracker and a fund's 13F pages have something to show on a machine without the
 * news feeds or SEC EDGAR: eight Newsroom stories with two parsed deals, and two 13F-HR filings
 * from a fictional manager (CIK 9999999) with their CUSIP-to-ticker rows. Re-runnable. Refuses anything but a local database.
 *
 *   DATABASE_URL_UNPOOLED=postgres://postgres:postgres@localhost:5432/yb_ux pnpm exec tsx scripts/seed-ux.mts
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) throw new Error("seed-ux only writes to a local database (localhost)");
const sql = postgres(url, { max: 1, onnotice: () => undefined });
const now = Date.now();
// Fictional companies throughout: this is test content, never to be mistaken for news.
const stories = [
  { h: "Northwind Data agrees to buy observability startup Grepline for $1.2 billion", cat: "deals", tk: [], desks: ["tech", "ma"], src: "Example Wire", deal: { kind: "acquisition", acquirer: "Northwind Data", acquirerTicker: "", target: "Grepline", valueUsd: 1.2e9, consideration: "cash and stock" } },
  { h: "Contoso Cloud beats on product revenue, raises full-year guidance", cat: "earnings", tk: [], desks: ["tech", "markets"], src: "Example Business News" },
  { h: "Central bank holds rates steady, signals one more cut this year", cat: "macro", tk: [], desks: ["macro", "markets"], src: "Example Markets" },
  { h: "Fabrikam Networks prices $1.5 billion convertible notes due 2031", cat: "capital", tk: [], desks: ["tech", "dcm", "ecm"], src: "Example Wire" },
  { h: "Ledgerline raises $40 million Series B", cat: "funding", tk: [], desks: ["tech", "vc"], src: "Example Tech News", deal: { kind: "raise", target: "Ledgerline", valueUsd: 4e7, round: "Series B" } },
  { h: "Regulator finalises disclosure phase-in for smaller filers", cat: "policy", tk: [], desks: ["policy", "accounting"], src: "Example Regulator" },
  { h: "Tailspin Analytics wins $480 million data platform contract", cat: "product", tk: [], desks: ["tech", "markets"], src: "Example Trade Press" },
  { h: "Adatum files 10-Q: subscriptions now 72% of revenue", cat: "filings", tk: [], desks: ["tech", "markets"], src: "Example Filings" },
];
// Earlier seed rows are replaced, never duplicated.
await sql`delete from news_deals where source_url like 'https://example.com/ux-seed/%'`;
await sql`delete from news_clusters where id in (select cluster_id from news_items where key like 'ux-seed:%')`;
await sql`delete from news_items where key like 'ux-seed:%'`;
let i = 0;
for (const s of stories) {
  const at = new Date(now - (i + 1) * 47 * 60_000);
  const summary = { bullets: [`${s.h}.`, "The company confirmed the figures in a statement.", "Analysts expect the move to be modestly accretive."], numbers: [{ label: "Value", value: s.deal?.valueUsd ? `$${(s.deal.valueUsd / 1e9).toFixed(2)}B` : "n/a" }], why: "It changes the competitive set for companies on your watchlist." };
  const [c] = await sql`insert into news_clusters (headline, category, importance, desks, tickers, entities, summary, source_count, kinds, first_seen_at, updated_at, enriched_at)
    values (${s.h}, ${s.cat}, ${0.9 - i * 0.07}, ${sql.json(s.desks)}, ${sql.json(s.tk)}, ${sql.json([])}, ${sql.json(summary)}, ${2 + (i % 3)}, ${sql.json(["article"])}, ${at}, ${at}, ${at}) returning id`;
  for (let k = 0; k < 2; k++) {
    await sql`insert into news_items (key, url, title, snippet, source, domain, kind, published_at, desks, tickers, cluster_id)
      values (${`ux-seed:${i}:${k}`}, ${`https://example.com/ux-seed/${i}/${k}`}, ${s.h}, ${"A short snippet of the article, as the feed gave it."}, ${k ? "Wire" : s.src}, ${"example.com"}, ${"article"}, ${at}, ${sql.json(s.desks)}, ${sql.json(s.tk)}, ${c.id})`;
  }
  if (s.deal) await sql`insert into news_deals (cluster_id, kind, acquirer, acquirer_ticker, target, value_usd, consideration, round, sector, announced_at, source_url)
    values (${c.id}, ${s.deal.kind}, ${s.deal.acquirer ?? ""}, ${s.deal.acquirerTicker ?? ""}, ${s.deal.target}, ${s.deal.valueUsd}, ${s.deal.consideration ?? ""}, ${s.deal.round ?? ""}, ${"Technology"}, ${at}, ${`https://example.com/ux-seed/${i}`})`;
  i++;
}
console.log(`seeded ${stories.length} stories`);

const cik = "0009999999"; // a fictional filer: /app/copy/fund/9999999
const secs = [
  ["037833100", "AAPL", "APPLE INC"], ["060505104", "BAC", "BANK AMER CORP"], ["025816109", "AXP", "AMERICAN EXPRESS CO"],
  ["191216100", "KO", "COCA COLA CO"], ["166764100", "CVX", "CHEVRON CORP NEW"], ["674599105", "OXY", "OCCIDENTAL PETE CORP"],
  ["615369105", "MCO", "MOODYS CORP"], ["500754106", "KHC", "KRAFT HEINZ CO"],
];
const h = (q: number) => secs.map(([cusip, , name], i) => ({ cusip, issuer6: cusip.slice(0, 6), name, titleOfClass: "COM", value: Math.round((90 - i * 9) * 1e9 * (1 + q * 0.03)), shares: Math.round((900 - i * 80) * 1e6 * (1 + q * 0.02)), shareType: "SH", putCall: null, lines: 1 }));
for (const [cusip, ticker, issuer] of secs) await sql`insert into copy_securities (cusip, ticker, issuer, title, source) values (${cusip}, ${ticker}, ${issuer}, ${"COM"}, ${"builtin"}) on conflict (cusip) do update set ticker = excluded.ticker`;
await sql`insert into copy_filers (cik, name, latest_filed, latest_period, curated) values (${cik}, ${"EXAMPLE CAPITAL MANAGEMENT LLC"}, ${"2026-08-14"}, ${"2026-06-30"}, false) on conflict (cik) do update set latest_filed = excluded.latest_filed, latest_period = excluded.latest_period`;
const filings = [["0009999999-26-000001", "2026-05-15", "2026-03-31", 0], ["0009999999-26-000002", "2026-08-14", "2026-06-30", 1]] as const;
for (const [acc, filed, period, q] of filings) {
  const hold = h(q);
  await sql`insert into copy_filings (accession, cik, form, filed_on, period, holdings, lines, entry_total, value_total, status)
    values (${acc}, ${cik}, ${"13F-HR"}, ${filed}, ${period}, ${sql.json(hold)}, ${hold.length}, ${hold.length}, ${hold.reduce((s, x) => s + x.value, 0)}, ${"ok"}) on conflict (accession) do nothing`;
}
console.log("seeded 13F filings");
await sql.end();
