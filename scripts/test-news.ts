/**
 * Checks for the Newsroom's pure logic: cleaning, feed and filing parsing, robots.txt, extraction,
 * classification, clustering, ranking, desks, preferences, the budget, deals, alerts, the calendar,
 * research acceptance and the email. No network, no database.   pnpm exec tsx scripts/test-news.ts
 */
import { allowedAt } from "@/lib/news/budget";
import { nyToUtc, recurringEvents } from "@/lib/news/calendar";
import { amountIn, importanceOf, readWords } from "@/lib/news/classify";
import { bestCluster, cosine, figures, nearFigure, packVector, unpackVector, type ClusterCand } from "@/lib/news/cluster";
import { impliedMultiples, leagueTable, premiumOf } from "@/lib/news/deals";
import { briefEmail, isSlackWebhook } from "@/lib/news/deliver";
import { deskAffinity, deskFor, sectorOfSic } from "@/lib/news/desks";
import { tidy, type Reading } from "@/lib/news/enrich";
import { mainText, markedPaywalled } from "@/lib/news/extract";
import { canonicalUrl, cleanTitle, jaccard, parseFeedDate, stripHtml, tickersIn, tokens } from "@/lib/news/normalize";
import { briefDue, defaultNewsPrefs, inQuietHours, normalizeNewsPrefs } from "@/lib/news/prefs";
import { normCompany, rank, score, type Reader } from "@/lib/news/rank";
import { parseRobots, robotsAllows } from "@/lib/news/robots";
import { decideAlert } from "@/lib/news/alerts";
import { filingsToItems, parseCurrentFeed, prettyName } from "@/lib/news/sources/edgar";
import { gdeltDate, gdeltItems } from "@/lib/news/sources/gdelt";
import { federalRegisterItems } from "@/lib/news/sources/gov";
import { paperItems, repoItems } from "@/lib/news/sources/radar";
import { acceptStory } from "@/lib/news/sources/research";
import { parseFeed } from "@/lib/news/sources/rss";
import { monogramOf } from "@/components/news/DataArt";
import { nameKey } from "@/lib/edgar/tickers";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

async function main() {
  console.log("cleaning");
  check("tracking parameters, fragments and amp paths go", canonicalUrl("https://AMP.Example.com/news/deal/amp/?utm_source=x&id=7&fbclid=y#top") === "https://www.example.com/news/deal?id=7", canonicalUrl("https://AMP.Example.com/news/deal/amp/?utm_source=x&id=7&fbclid=y#top"));
  check("HTML to text, entities decoded", stripHtml("<p>AT&amp;T&#8217;s <b>deal</b></p><script>x()</script>") === "AT&T’s deal");
  check("publisher suffixes come off headlines", cleanTitle("Acme to buy Widget - Reuters") === "Acme to buy Widget");
  check("tickers in parentheses, with exchange names, and cashtags", JSON.stringify(tickersIn("Exxon (NYSE: XOM) and Snowflake (Nasdaq: SNOW) rise; $NVDA too, not $5B")) === JSON.stringify(["XOM", "SNOW", "NVDA"]), tickersIn("Exxon (NYSE: XOM) and Snowflake (Nasdaq: SNOW) rise; $NVDA too, not $5B"));
  check("headline words ignore filler and plurals", jaccard(tokens("AMD to Acquire World Labs"), tokens("AMD acquires World Labs")) > 0.5);
  check("a feed date in the future falls back", parseFeedDate("2099-01-01T00:00:00Z", new Date(0)).getTime() === 0 && parseFeedDate("Mon, 28 Sep 2026 20:05:00 GMT", new Date(0)).getUTCHours() === 20);

  console.log("feeds");
  const rss = parseFeed(`<?xml version="1.0"?><rss><channel><item><title><![CDATA[Acme &amp; Co. raises $50M]]></title><link>https://x.com/a?utm_medium=rss</link><description>&lt;p&gt;Series B&lt;/p&gt;</description><pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate><category>Funding</category></item></channel></rss>`);
  check("RSS 2.0 (entities inside CDATA are decoded when the title is cleaned)", rss.length === 1 && cleanTitle(rss[0].title) === "Acme & Co. raises $50M" && rss[0].link.startsWith("https://x.com/a") && rss[0].categories[0] === "Funding", rss);
  const atom = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><title type="html">Deal done</title><link rel="alternate" href="https://y.com/d"/><updated>2026-09-28T10:00:00Z</updated><summary>Closed.</summary></entry></feed>`);
  check("Atom", atom.length === 1 && atom[0].link === "https://y.com/d" && atom[0].summary === "Closed.", atom);
  const rdf = parseFeed(`<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/"><item><title>Old format</title><link>https://z.com/o</link><dc:date>2026-09-28</dc:date></item></rdf:RDF>`);
  check("RSS 1.0 (RDF)", rdf.length === 1 && rdf[0].title === "Old format", rdf);

  console.log("filings");
  const atomFeed = `<?xml version="1.0" encoding="ISO-8859-1" ?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><title>8-K - VOYAGER TECHNOLOGIES, INC./TX (0001788060) (Filer)</title><link rel="alternate" type="text/html" href="https://www.sec.gov/Archives/edgar/data/1788060/000162828026063717/0001628280-26-063717-index.htm"/><summary type="html"> &lt;b&gt;Filed:&lt;/b&gt; 2026-09-28 &lt;b&gt;AccNo:&lt;/b&gt; 0001628280-26-063717 &lt;br&gt;Item 1.01: Entry into a Material Definitive Agreement &lt;br&gt;Item 9.01: Financial Statements</summary><updated>2026-09-28T16:08:32-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0001628280-26-063717</id></entry>
<entry><title>8-K - PEOPLES BANCORP INC (0000318300) (Filer)</title><link href="https://www.sec.gov/x-index.htm"/><summary type="html">&lt;b&gt;AccNo:&lt;/b&gt; 0000318300-26-000202 &lt;br&gt;Item 8.01: Other Events</summary><updated>2026-09-28T16:11:22-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000318300-26-000202</id></entry>
<entry><title>SC 13D - TARGET CO (0000000001) (Subject)</title><link href="https://www.sec.gov/t-index.htm"/><summary type="html">&lt;b&gt;AccNo:&lt;/b&gt; 0000000009-26-000001</summary><updated>2026-09-28T12:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000009-26-000001</id></entry>
<entry><title>SC 13D - ACTIVIST PARTNERS LP (0000000002) (Filed by)</title><link href="https://www.sec.gov/t-index.htm"/><summary type="html">&lt;b&gt;AccNo:&lt;/b&gt; 0000000009-26-000001</summary><updated>2026-09-28T12:00:00-04:00</updated><id>urn:tag:sec.gov,2008:accession-number=0000000009-26-000001</id></entry></feed>`;
  const filings = parseCurrentFeed(atomFeed);
  check("the latest-filings feed parses form, company, CIK, role and 8-K items", filings.length === 4 && filings[0].items.join() === "1.01,9.01" && filings[0].cik === "0001788060" && filings[3].role === "Filed by", filings.map((f) => [f.form, f.role, f.items]));
  const items = filingsToItems(filings, new Map([["0001788060", "VOYG"]]), new Map([["0001788060", "industrials"]]));
  check("routine 8-Ks are dropped; a material agreement becomes a story with its ticker and sector", items.length === 2 && items[0].title === "Voyager Technologies, Inc.: Material agreement" && items[0].tickers[0] === "VOYG" && items[0].tags.includes("industrials") && items[0].tags.includes("ma"), items.map((i) => [i.title, i.tickers, i.tags]));
  check("a 13D names the filer and the company", items[1].title === "Activist Partners LP discloses a stake in Target Co.", items[1].title);
  check("names in capitals read normally; acronyms stay", prettyName("KIMBERLY CLARK CORP") === "Kimberly Clark Corp." && prettyName("BGC GROUP INC") === "BGC Group Inc.");
  check("SIC codes to sectors", sectorOfSic(1311) === "energy" && sectorOfSic(2834) === "healthcare" && sectorOfSic(7372) === "tech" && sectorOfSic(6022) === "financials" && sectorOfSic(6798) === "realestate");
  const fr = federalRegisterItems([{ title: "Transmission Planning", abstract: "<p>The rule…</p>", html_url: "https://www.federalregister.gov/d/2026-1", publication_date: "2026-09-28", type: "Rule", significant: true, agencies: [{ slug: "federal-energy-regulatory-commission" }] }]);
  check("Federal Register rules name their agency and desk", fr.length === 1 && fr[0].title.startsWith("FERC issues rule:") && fr[0].tags.includes("energy"), fr);
  check("GDELT dates and publisher filter", gdeltDate("20260928T181500Z").toISOString() === "2026-09-28T18:15:00.000Z" && gdeltItems([{ url: "https://www.reuters.com/a", title: "A - Reuters", seendate: "20260928T181500Z", domain: "reuters.com" }, { url: "https://spam.example/a", title: "B", seendate: "20260928T181500Z", domain: "spam.example" }], ["ma"]).map((i) => i.source).join() === "Reuters");
  check("radar thresholds keep the notable only", paperItems([{ paper: { id: "1", title: "A", upvotes: 34 } }, { paper: { id: "2", title: "B", upvotes: 2 } }]).length === 1 && repoItems([{ full_name: "a/b", html_url: "https://github.com/a/b", description: "x", stargazers_count: 2244, language: "Go", created_at: "2026-09-22T00:00:00Z" }, { full_name: "c/d", html_url: "https://github.com/c/d", description: null, stargazers_count: 12, language: null, created_at: "2026-09-22T00:00:00Z" }]).length === 1);

  console.log("robots.txt and open pages");
  const g = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$\n\nUser-agent: YouBankNews\nDisallow: /members");
  check("our own group wins over *", !robotsAllows(g, "/members/a") && robotsAllows(g, "/private/x"));
  const star = parseRobots("User-agent: *\nDisallow: /private\nAllow: /private/ok\nDisallow: /*.pdf$");
  check("longest match wins, allow on ties, wildcards and $", !robotsAllows(star, "/private/x") && robotsAllows(star, "/private/ok/1") && !robotsAllows(star, "/a/b.pdf") && robotsAllows(star, "/a/b.pdf?x=1") && robotsAllows(star, "/news"));
  const html = `<html><nav>Menu stuff that is long enough to be a paragraph if it were one</nav><article><p>${"Acme agreed to buy Widget for four billion dollars in cash, the companies said on Monday. ".repeat(3)}</p><p>Subscribe to our newsletter</p><p>${"The deal is expected to close next year subject to approvals from regulators. ".repeat(3)}</p></article></html>`;
  check("main text keeps article paragraphs and drops boilerplate", mainText(html).split("\n").length === 2 && !mainText(html).includes("Subscribe"));
  check("pages that say they are not free are respected", markedPaywalled('{"isAccessibleForFree": false}') && !markedPaywalled('{"isAccessibleForFree": true}'));

  console.log("classification");
  check("a takeover headline is a deal for M&A", readWords("Gold Fields makes $27bn takeover bid for Northern Star").category === "deals" && readWords("Gold Fields makes $27bn takeover bid for Northern Star").tags.includes("ma"));
  check("bankruptcy is distress for restructuring", readWords("Retailer files for Chapter 11 bankruptcy").category === "legal" && readWords("Retailer files for Chapter 11 bankruptcy").tags.includes("rx"));
  check("buybacks are capital markets", readWords("Nvidia launches record $150bn share buyback").category === "capital");
  check("sector words tag the story", readWords("Pipeline operator expands LNG export terminal").tags.includes("energy"));
  check("amounts in headlines", Math.abs((amountIn("AMD to buy World Labs for $8.2 billion") ?? 0) - 8.2e9) < 1 && amountIn("raises $750M") === 7.5e8 && amountIn("no money") === null, [amountIn("AMD to buy World Labs for $8.2 billion"), amountIn("raises $750M")]);
  check("importance: national press, many outlets and size rank higher", importanceOf({ tiers: [1], sourceCount: 5, category: "deals", amountUsd: 8e9, filingWeight: null }) > importanceOf({ tiers: [3], sourceCount: 1, category: "general", amountUsd: null, filingWeight: null }));

  console.log("clustering");
  const v = (xs: number[]) => Float32Array.from(xs);
  check("quantized vectors keep their direction", cosine(unpackVector(packVector(v([0.1, -0.5, 0.3, 0.8])))!, v([0.1, -0.5, 0.3, 0.8])) > 0.999);
  check("figures normalize units", [...figures("Gold miner rejects $27bn bid")][0] === "$27b" && figures("Northern Star rejects $27 Billion proposal").has("$27b") && figures("up 12%").has("12%"));
  check("rounded figures match, other amounts and percentages do not", nearFigure("$8b", "$8.2b") && nearFigure("$27b", "$27.4b") && !nearFigure("$8b", "$8m") && !nearFigure("$8b", "$9b") && !nearFigure("12%", "12.3%") && !nearFigure("$100m", "100m"));
  const now = Date.now();
  const cands: ClusterCand[] = [{ id: 1, headline: "AMD to Buy Fei-Fei Li’s World Labs AI Startup for $8.2 Billion", centroid: v([1, 0, 0]), tickers: [], category: "deals", kinds: ["article"], lastAt: now, titles: ["AMD agrees to acquire World Labs for $8.2B"] }];
  const cos = (c: number) => v([c, Math.sqrt(1 - c * c), 0]);
  check("same meaning joins (cosine 0.83)", bestCluster({ title: "Chipmaker strikes AI deal", vec: cos(0.83), tickers: [], kind: "article", category: "deals", at: now }, cands)?.id === 1);
  check("cosine 0.74 joins only with a second signal (a shared figure)", bestCluster({ title: "AMD to Acquire World Labs for $8.2 Billion", vec: cos(0.74), tickers: [], kind: "article", category: "deals", at: now }, cands)?.id === 1 && bestCluster({ title: "Chipmaker strikes AI deal", vec: cos(0.74), tickers: [], kind: "article", category: "deals", at: now }, cands) === null);
  check("a rounded figure is a second signal too ($8 billion and $8.2 billion)", bestCluster({ title: "One of AI's most influential researchers is joining AMD in an $8 billion deal", vec: cos(0.79), tickers: [], kind: "article", category: "deals", at: now }, cands)?.reason === "same meaning and figure");
  check("headline words alone can match any of the story's headlines", bestCluster({ title: "AMD agrees to acquire World Labs for $8.2B", vec: null, tickers: [], kind: "article", category: "deals", at: now }, cands)?.reason === "same words");
  check("stories older than two days are closed", bestCluster({ title: "AMD to Acquire World Labs for $8.2 Billion", vec: cos(0.95), tickers: [], kind: "article", category: "deals", at: now + 49 * 3_600_000 }, cands) === null);
  const filingCand: ClusterCand[] = [{ id: 2, headline: "Acme to buy Widget", centroid: null, tickers: ["ACME"], category: "deals", kinds: ["article"], lastAt: now }];
  check("a filing joins only on the same ticker and a deal-like event", bestCluster({ title: "Acme Inc.: Material agreement", vec: null, tickers: ["ACME"], kind: "filing", category: "deals", at: now }, filingCand)?.id === 2 && bestCluster({ title: "Acme Inc.: Executive change", vec: null, tickers: ["ACME"], kind: "filing", category: "people", at: now }, filingCand) === null);
  check("models and repositories never merge on similarity", bestCluster({ title: "Trending model: Qwen/Qwen-Image-2.1", vec: cos(0.99), tickers: [], kind: "model", category: "research", at: now }, cands) === null);

  console.log("ranking and desks");
  const energy = deskFor({ role: "banker", specialty: "Energy & power", sectors: [] });
  check("an energy banker's desk: energy sector, M&A and capital markets, crude on the market watch", energy.id === "bank:energy" && energy.sectors.includes("energy") && energy.lenses.includes("ma") && energy.watch.some((w) => w.symbol === "CLUSD"), energy);
  check("a VC's desk covers the tech radar", deskFor({ role: "vc", specialty: "Series A-B", sectors: [] }).lenses.includes("radar"));
  check("desk fit: energy M&A fits the energy desk more than a retail story", deskAffinity(energy, ["energy", "ma"]) > deskAffinity(energy, ["consumer"]));
  const reader: Reader = { desk: energy, watch: new Set(["XOM"]), follows: { tickers: [], topics: ["LNG"] }, mutes: { sources: ["Techmeme"], topics: ["crypto"] }, network: new Map([[normCompany("Chevron Corporation"), [{ contactId: 7, name: "Jane Doe", company: "Chevron" }]]]) };
  const base = { desks: ["energy"], tickers: [] as string[], entities: [], importance: 0.5, updatedAt: new Date(now), firstSeenAt: new Date(now), category: "deals" };
  check("watchlist, network and follows each give a reason", score(reader, { ...base, id: 1, headline: "Exxon buys a shale driller", tickers: ["XOM"] }).reasons[0] === "On your watchlist: XOM" && score(reader, { ...base, id: 2, headline: "Chevron sells assets", entities: [{ name: "Chevron Corp.", kind: "company" }] }).reasons[0].startsWith("In your network: Jane Doe") && score(reader, { ...base, id: 3, headline: "New LNG terminal approved" }).reasons[0] === 'You follow "LNG"');
  check("muted topics disappear; fresher ranks first", rank(reader, [{ ...base, id: 4, headline: "crypto exchange news" }]).length === 0 && rank(reader, [{ ...base, id: 5, headline: "Old", updatedAt: new Date(now - 40 * 3_600_000) }, { ...base, id: 6, headline: "New" }])[0].id === 6);

  console.log("preferences");
  check("editions follow the role", defaultNewsPrefs({ role: "markets" }).edition === "terminal" && defaultNewsPrefs({ role: "vc" }).edition === "editorial" && defaultNewsPrefs({ role: "pe" }).layout === "dashboard");
  const adv = normalizeNewsPrefs({ edition: "brief", advanced: true, look: "editorial", layout: "wire", motion: "subtle", reading: "page", brief: { time: "25:00", timezone: "Not/AZone" } }, { role: "banker" });
  check("advanced mixes look and layout; bad times and zones fall back", adv.look === "editorial" && adv.layout === "wire" && adv.motion === "subtle" && adv.reading === "page" && adv.brief.time === "07:00" && adv.brief.timezone === "America/New_York", adv);
  const simple = normalizeNewsPrefs({ edition: "modern", advanced: false, look: "terminal" }, { role: "banker" });
  check("without advanced, the look follows the edition", simple.look === "modern" && simple.layout === "dashboard");
  const p = defaultNewsPrefs({ role: "banker" });
  check("quiet hours wrap midnight", inQuietHours(new Date("2026-09-29T03:00:00Z"), p) && !inQuietHours(new Date("2026-09-28T16:00:00Z"), p));
  check("the brief is due after its local time", briefDue(new Date("2026-09-28T11:05:00Z"), p).due && !briefDue(new Date("2026-09-28T10:55:00Z"), p).due);

  console.log("budget");
  check("personal notes pause first, research next, essentials last", !allowedAt("research", 18, 25) && allowedAt("personal", 18, 25) && !allowedAt("personal", 21, 25) && allowedAt("essential", 24.9, 25) && !allowedAt("essential", 25, 25));

  console.log("deals");
  const bars = [{ date: "2026-09-24", close: 40 }, { date: "2026-09-25", close: 41 }, { date: "2026-09-28", close: 48 }];
  const prem = premiumOf(49.2, bars, new Date("2026-09-28T13:00:00Z"));
  check("premium is to the last close before the news", prem !== null && prem.unaffected === 41 && Math.abs(prem.premium - 0.2) < 1e-9, prem);
  check("implausible premiums are refused", premiumOf(500, bars, new Date("2026-09-28T13:00:00Z")) === null);
  const m = impliedMultiples({ perShare: 50, valueUsd: null, sharesMm: 100, debtMm: 1000, cashMm: 500, ebitdaMm: 550, revenueMm: 2750 });
  check("implied EV/EBITDA and EV/revenue from the offer and SEC figures", m !== null && m.ev === 5500 && Math.abs((m.evEbitda ?? 0) - 10) < 1e-9 && Math.abs((m.evRevenue ?? 0) - 2) < 1e-9, m);
  const lt = leagueTable([{ kind: "acquisition", valueUsd: 5e9, advisors: [{ firm: "Goldman Sachs & Co. LLC", side: "seller", role: "financial" }, { firm: "Wachtell", side: "buyer", role: "legal" }] }, { kind: "merger", valueUsd: 2e9, advisors: [{ firm: "Goldman Sachs & Co.", side: "buyer", role: "financial" }] }]);
  check("league table counts firms once per deal and sums value", lt[0]?.firm === "Goldman Sachs" && lt[0].deals === 2 && lt[0].valueUsd === 7e9, lt);

  console.log("alerts");
  const ctx = { prefs: defaultNewsPrefs({ role: "banker" }), reader, desk: energy };
  const cl = { headline: "Exxon files for Chapter 11", tickers: ["XOM"], entities: [], importance: 0.6, category: "legal", desks: ["energy", "rx"], kinds: ["filing"] };
  check("a watchlist bankruptcy filing is urgent", decideAlert(ctx, cl, { weight: 0.95, items: ["1.03"], form: "8-K" }).urgent);
  check("a big deal for the desk alerts but is not urgent", (() => { const d = decideAlert(ctx, { ...cl, headline: "Chevron agrees to buy Hess for $53 billion", tickers: [], category: "deals", desks: ["energy", "ma"] }, null); return d.alert && !d.urgent && d.why !== ""; })());
  check("an off-desk routine story does not alert", !decideAlert(ctx, { ...cl, headline: "Retailer opens store", tickers: [], category: "general", desks: ["consumer"], importance: 0.3, kinds: ["article"] }, null).alert);

  console.log("calendar and research");
  check("New York times through daylight saving", nyToUtc("2026-07-01", 10, 30).toISOString() === "2026-07-01T14:30:00.000Z" && nyToUtc("2026-12-01", 10, 30).toISOString() === "2026-12-01T15:30:00.000Z");
  check("an energy desk gets the EIA and rig-count releases", recurringEvents(energy, new Date("2026-09-28T12:00:00Z")).map((e) => e.label).join("|").includes("EIA weekly petroleum status report") && recurringEvents(energy, new Date("2026-09-28T12:00:00Z")).some((e) => e.label === "Baker Hughes rig count"));
  const retrieved = new Set(["reuters.com"]);
  const at = new Date("2026-09-28T12:00:00Z");
  check("research keeps only retrieved, recent, non-forum pages", acceptStory({ headline: "A", summary: "", url: "https://www.reuters.com/x", publisher: "Reuters", published: "2026-09-28" }, retrieved, at).ok && !acceptStory({ headline: "A", summary: "", url: "https://www.reddit.com/x", publisher: "r", published: "2026-09-28" }, new Set(["reddit.com"]), at).ok && !acceptStory({ headline: "A", summary: "", url: "https://ft.com/x", publisher: "FT", published: "2026-09-28" }, retrieved, at).ok && !acceptStory({ headline: "A", summary: "", url: "https://www.reuters.com/x", publisher: "Reuters", published: "2026-09-01" }, retrieved, at).ok);

  console.log("AI output and the email");
  const raw: Reading = { bullets: ["a", "b", "c", "d"], numbers: [], why: "w", watch: null, category: "Deals", importance: 9, sectors: ["tech", "materials"], lenses: ["ma", "nonsense"], entities: [{ name: "AMD", ticker: "AMD", kind: "Company", role: null }], deal: { kind: "take private", acquirer: "X", target: "Y", valueUsd: 1, perShare: null, consideration: null, round: null, investors: [], advisors: [] } };
  const t = tidy(raw);
  check("a fourth bullet is trimmed, not fatal; unknown values dropped; kinds normalized", t.bullets.length === 3 && t.category === "deals" && t.importance === 5 && t.sectors.join() === "tech" && t.lenses.join() === "ma" && t.entities[0].kind === "company" && t.deal?.kind === "take_private", t);
  check("company names match SEC's listing names", nameKey("KKR & Co. Inc.", false) === nameKey("KKR", false) && nameKey("Exxon Mobil", true) === nameKey("ExxonMobil Holdings Corp", true) && nameKey("TARGET CORP", false) === nameKey("Target", false) && nameKey("Target Group Inc.", false) !== nameKey("Target", false) && nameKey("The Home Depot", true) === nameKey("HOME DEPOT, INC.", true));
  check("monograms", monogramOf("AMD") === "AMD" && monogramOf("World Labs") === "WL" && monogramOf("Nvidia") === "NV");
  check("Slack webhooks only", isSlackWebhook("https://hooks.slack.com/services/T0/B0/xyz") && !isSlackWebhook("https://evil.example/hooks.slack.com/services/x"));
  const email = briefEmail({ desk: "bank:energy", deskLabel: "Energy & power", slot: "2026-09-28", title: "Oil <spikes> & gas", intro: "Intro", items: [{ clusterId: 9, headline: "A & B", lines: ["line"], why: "why", category: "deals", sources: 2, tickers: [] }], watch: [], calendar: [], generatedAt: "", model: "m" }, [], "https://app.example", "Monday");
  check("the brief email escapes HTML and links stories", email.html.includes("Oil &lt;spikes&gt; &amp; gas") && email.html.includes("https://app.example/app/news/story/9") && email.subject === "Energy & power brief: Oil <spikes> & gas");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
