/**
 * Checks for the Newsroom's pure logic: cleaning, feed and filing parsing, robots.txt, extraction,
 * classification, clustering, ranking, desks, preferences, the budget, deals, alerts, the calendar,
 * research acceptance and the email; and the Newsroom's newer parts: the learned front page and its
 * explanations, diversity, "why this matters to you", timelines, relationship maps and charts, the
 * globe, the audio briefing's script, the recap's slides, follows, public pages and the premium
 * registry. No network, no database.   pnpm exec tsx scripts/test-news.ts
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
import { rankEntries } from "@/lib/news/radar";
import { countryId, placesIn, stateId } from "@/lib/news/radar/places";
import { approvalEntries, bankApplications, energyNotice, recallEntries, tradeCase, trialEntries, type FrDoc } from "@/lib/news/radar/sources";
import { radarMap } from "@/lib/news/radar/view";
import { diversify, learnAffinity, learnedScore, reasonFor, topFeatures, type Signal } from "@/lib/news/affinity";
import { briefingChapters, mergeScript, MAX_CHAPTER_CHARS, speakable, ttsCostUsd } from "@/lib/news/briefing";
import { canFollowMore, FREE_FOLLOWS, followUpdate } from "@/lib/news/follow";
import { filterPoints, globePoints, markerRadius, significance, storyPlaces } from "@/lib/news/geo";
import { mattersToYou } from "@/lib/news/matters";
import { isPublicStory } from "@/lib/news/public";
import { recapMs, recapSlides, RECAP_TARGET_MS, slideAt, wrapText } from "@/lib/news/recap";
import { idFromSlug, slugFor, slugWords } from "@/lib/news/slug";
import { briefCard, chartFor, eventIndex, figureBars, layoutGraph, parseFigure, storyGraph, storyTimeline } from "@/lib/news/storyviz";
import { FEATURES, featureById } from "@/lib/billing/features";

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
  check("editions follow the role", defaultNewsPrefs({ role: "markets" }).edition === "terminal" && defaultNewsPrefs({ role: "vc" }).edition === "front" && defaultNewsPrefs({ role: "vc" }).layout === "front" && defaultNewsPrefs({ role: "pe" }).layout === "dashboard");
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

  console.log("sector radars");
  const doc = (title: string, extra: Partial<FrDoc> = {}): FrDoc => ({ title, abstract: null, html_url: `https://www.federalregister.gov/d/${title.length}`, publication_date: "2026-09-29", type: "Notice", ...extra });
  const gp = energyNotice(doc("Guardian Pipeline, LLC; Notice of Schedule for the Preparation of an Environmental Assessment for the Guardian 3 Expansion Project"), "FERC");
  const rg = energyNotice(doc("Rio Grande LNG, LLC, Rio Grande LNG Train 4, LLC; Notice of Schedule for the Preparation of an Environmental Assessment for the Proposed Rio Grande LNG Train 4 Expansion Project"), "FERC");
  const nrc = energyNotice(doc("Constellation Energy Generation, LLC; Christopher M. Crane Clean Energy Center; Environmental Assessment and Finding of No Significant Impact"), "NRC");
  check("FERC, DOE and NRC notices become project milestones; paperwork does not", gp?.title === "Guardian Pipeline: Guardian 3 Expansion Project" && gp.tags.join() === "Gas pipeline,Environmental review"
    && rg?.title === "Rio Grande LNG: Rio Grande LNG Train 4 Expansion Project" && rg.tags[0] === "LNG" && rg.places.includes("us:TX")
    && nrc?.title === "Constellation Energy Generation: Christopher M. Crane Clean Energy Center" && nrc.tags.join() === "Nuclear,Environmental review done"
    && energyNotice(doc("Great River Hydro, LLC; Notice of Application for Temporary Variance Accepted for Filing"), "FERC") === null
    && energyNotice(doc("Natural Gas Pipeline Company of America, LLC; Horizon Pipeline Company, L.L.C.; Notice of Scoping Period"), "FERC")?.title === "Natural Gas Pipeline Company of America", [gp, rg, nrc]);
  const fed = `A. Federal Reserve Bank of Chicago (Jane Doe) 230 South LaSalle Street, Chicago, Illinois 60690-1414. Comments ... not later than October 28, 2026.
    1. 1870 Holdings, Inc., Monmouth, Illinois; to merge with Rushville Bancshares, Inc., and thereby indirectly acquire Rushville State Bank, both of Rushville, Illinois.
    B. Federal Reserve Bank of Richmond (John Roe) 701 East Byrd Street, Richmond, Virginia 23219.
    1. First Bancorp, Southern Pines, North Carolina; to acquire First Carolina Bancshares Corporation, and thereby indirectly acquire First Carolina Bank, both of Rock Hill, South Carolina.
    2. Hometown Financial Group, Inc., Easthampton, Massachusetts (\`\`Applicant''); a newly-formed Maryland corporation, to become a bank holding company by acquiring TruNorth Bank, Easthampton, Massachusetts (\`\`Bank''), in connection with the conversion.
    Board of Governors of the Federal Reserve System.`;
  const apps = bankApplications(fed, "https://fr/x", "2026-09-28");
  check("Fed notices become bank deals: acquirer, target, states, district and comment deadline", apps.length === 3
    && apps[0].title === "1870 Holdings, Inc. to merge with Rushville Bancshares, Inc." && apps[0].tags.join() === "Merger,Comments by October 28" && apps[0].snippet.includes("Federal Reserve Bank of Chicago")
    && apps[1].title === "First Bancorp to acquire First Carolina Bancshares Corporation" && apps[1].flow?.from[0] === "us:NC" && apps[1].flow?.to === "us:SC" && apps[1].snippet.includes("Richmond")
    && apps[2].title === "Hometown Financial Group, Inc. to form a holding company for TruNorth Bank" && apps[2].places.join() === "us:MA", apps);
  const itc = tradeCase(doc("Methionine From France, Japan, and Spain; Institution of Antidumping Duty Investigations and Scheduling of Preliminary Phase Investigations"));
  check("ITC cases name the product and the exporting countries, flowing to the US", itc?.title === "Methionine from France, Japan and Spain" && itc.tags[0] === "New trade case" && itc.flow?.from.join() === "c:FR,c:JP,c:ES" && itc.flow?.to === "c:US"
    && tradeCase(doc("Certain Dynamic Random Access Memory (DRAM) Devices; Notice of Institution of Investigation"))?.tags[0] === "Patent import case"
    && tradeCase(doc("Wooden Fence Pickets From China; Scheduling of the Final Phase Hearing Meeting")) === null, itc);
  const study = { protocolSection: { identificationModule: { nctId: "NCT1", briefTitle: "A Trial of X-1 Versus Placebo" }, sponsorCollaboratorsModule: { leadSponsor: { name: "Acme Bio, Inc." } }, designModule: { phases: ["PHASE3"], enrollmentInfo: { count: 450 } }, statusModule: { studyFirstPostDateStruct: { date: "2026-09-29" } }, conditionsModule: { conditions: ["Ulcerative Colitis (UC)"] }, armsInterventionsModule: { interventions: [{ name: "Placebo", type: "DRUG" }, { name: "X-1", type: "DRUG" }] }, contactsLocationsModule: { locations: [{ country: "United States" }, { country: "Korea, Republic of" }, { country: "Georgia" }] } } };
  const [tr] = trialEntries([study]);
  check("new trials: sponsor, drug (not the placebo), condition, phase, enrollment and countries", tr.title === "Acme Bio: X-1 in Ulcerative Colitis" && tr.tags[0] === "Phase 3" && tr.metric === "450 patients" && tr.places.join() === "c:US,c:KR,c:GE" && tr.url === "https://clinicaltrials.gov/study/NCT1", tr);
  const fda = approvalEntries([
    { application_number: "NDA220185", sponsor_name: "NUVALENT", products: [{ brand_name: "JIDEYTRO", active_ingredients: [{ name: "ZIDESAMTINIB" }] }], submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20260722", review_priority: "PRIORITY", submission_class_code_description: "Type 1 - New Molecular Entity" }] },
    { application_number: "ANDA078905", sponsor_name: "ZYDUS", submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20260801" }] },
    { application_number: "NDA000001", sponsor_name: "OLD", submissions: [{ submission_type: "ORIG", submission_status: "AP", submission_status_date: "20110131" }] },
  ], "20260701", "20260929");
  check("FDA approvals: original NDAs and BLAs in the window only, with priority and NMEs marked", fda.length === 1 && fda[0].title === "Jideytro (Nuvalent)" && fda[0].tags.join() === "New drug,New molecular entity,Priority review" && fda[0].at.startsWith("2026-07-22"), fda);
  const [rc] = recallEntries([{ RecallID: 1, RecallDate: "2026-09-24T00:00:00", Title: "ABC Trading Recalls Light-Up Toys Due to Risk of Burns", Products: [{ NumberOfUnits: "About 43,674" }], Retailers: [{ Name: "Sold Online At:\nAmazon.com in May 2026 for $25." }], ManufacturerCountries: [{ Country: "China" }] }]);
  check("recalls: units, where sold, and where made, flowing to the US", rc.title === "ABC Trading Recalls Light-Up Toys" && rc.metric === "43,674 units" && rc.snippet.startsWith("Sold at Amazon.com") && rc.flow?.from[0] === "c:CN", rc);
  check("places: longest names first, set-aside phrases, acronyms by case", placesIn("New Mexico and Texas output rose; Mexico imports fell").join() === "us:NM,us:TX,c:MX"
    && placesIn("prices in British thermal units across the Indian Ocean").length === 0 && placesIn("North Korea tested; Korea exports grew").join() === "c:KP,c:KR"
    && placesIn("the eu said").length === 0 && placesIn("the EU said").join() === "eu" && placesIn("Rio Grande LNG and Cushing").join() === "us:TX,us:OK", placesIn("New Mexico and Texas output rose; Mexico imports fell"));
  check("structured country and state names", countryId("Korea, Republic of") === "c:KR" && countryId("Georgia") === "c:GE" && countryId("United States") === "c:US" && stateId("IL") === "us:IL" && stateId("Georgia") === "us:GA");
  const lanes = [{ id: "banks", title: "", blurb: "", icon: "", sources: "", status: "ok" as const, entries: apps }];
  const rm = radarMap(lanes, [{ id: 7, headline: "Texas bank deal", text: "A Texas lender agreed to buy a bank in Illinois" }]);
  check("the map counts places from lanes and stories, and keeps flows", rm.points.find((p) => p.id === "us:IL")?.count === 2 && rm.points.find((p) => p.id === "us:TX")?.items[0].clusterId === 7 && rm.flows.length === 1 && rm.flows[0].from === "us:NC", rm);
  const t0 = Date.parse("2026-09-29T12:00:00Z");
  const ranked = rankEntries([{ ...apps[2], weight: 0.36, at: "2026-09-29T12:00:00Z" }, { ...apps[0], weight: 0.62, at: "2026-09-20T12:00:00Z" }], t0);
  check("radar ranking: weight first, freshness second", ranked[0].weight === 0.62, ranked.map((r) => r.weight));


  console.log("the learned front page");
  const sig = (kind: Signal["kind"], daysAgo: number, f: Partial<Signal>): Signal => ({ kind, at: new Date(now - daysAgo * 86_400_000), tags: [], tickers: [], companies: [], category: "general", ...f });
  const learned = learnAffinity([
    sig("read", 1, { tags: ["energy"], tickers: ["XOM"] }), sig("read", 2, { tags: ["energy"] }), sig("read", 3, { tags: ["energy"] }), sig("save", 1, { tickers: ["XOM"], companies: ["Exxon Mobil Corp"] }),
    sig("hide", 1, { tags: ["consumer"], companies: ["Acme Toys Inc"] }), sig("hide", 2, { companies: ["Acme Toys"] }), sig("read", 90, { tags: ["tech"] }),
  ], new Date(now));
  const fx = learned.features;
  check("reads, saves and hides become affinities; old actions are ignored", (fx.get("tag:energy")?.affinity ?? 0) > 0.4 && (fx.get("co:acme toys")?.affinity ?? 0) < -0.7 && !fx.has("tag:tech") && learned.signals === 6, [...fx.values()].map((f) => [f.key, f.affinity.toFixed(2)]));
  const decayed = learnAffinity([sig("read", 28, { tags: ["energy"] })], new Date(now)).features.get("tag:energy")!.affinity, fresh = learnAffinity([sig("read", 0, { tags: ["energy"] })], new Date(now)).features.get("tag:energy")!.affinity;
  check("votes fade with a two-week half-life", Math.abs(decayed - Math.tanh(0.25 / 4)) < 1e-6 && Math.abs(fresh - Math.tanh(1 / 4)) < 1e-6, { decayed, fresh });
  const liked = learnedScore(learned, { tags: ["energy"], tickers: ["XOM"], companies: [], category: "deals" });
  const disliked = learnedScore(learned, { tags: ["consumer"], tickers: [], companies: ["ACME TOYS, INC."], category: "deals" });
  check("a story like the ones read rises, with the evidence in words", liked.score > 0.3 && /^You (saved|read)/.test(liked.reason ?? ""), liked);
  check("a story like the ones hidden sinks, and says so", disliked.score < -0.4 && (disliked.reason ?? "").startsWith("Fewer like this: you hid 2 stories on"), disliked);
  check("reasons read naturally", reasonFor({ key: "tag:energy", label: "Energy & power", affinity: 0.6, evidence: { read: 6, save: 0, follow: 0, hide: 0 } }) === "You read 6 Energy & power stories lately" && reasonFor({ key: "tk:NVDA", label: "NVDA", affinity: 0.5, evidence: { read: 0, save: 2, follow: 0, hide: 0 } }) === "You saved 2 stories on NVDA");
  check("what the page learned, strongest first", topFeatures(learned).liked[0].affinity >= topFeatures(learned).liked.at(-1)!.affinity && topFeatures(learned).avoided.some((f) => f.label.startsWith("Acme")));
  const lr: Reader = { ...reader, follows: { tickers: [], topics: [] }, watch: new Set(), network: new Map(), affinity: learned };
  const sx = score(lr, { ...base, id: 9, headline: "Exxon weighs a deal", tickers: ["XOM"] });
  check("the ranking shows its parts and adds the learned reason", sx.explain.learned > 0 && sx.explain.fit > 0 && sx.explain.freshness > 0.99 && sx.reasons.some((r) => r.startsWith("You ")), sx);
  check("a disliked story never scores below zero (it sinks, it is not muted)", score(lr, { ...base, id: 10, headline: "Acme Toys recall", desks: ["consumer"], entities: [{ name: "Acme Toys", kind: "company" }] }).score >= 0);
  const dv = diversify([
    { id: 1, score: 1, category: "deals", tickers: ["XOM"], desks: ["energy"] }, { id: 2, score: 0.99, category: "deals", tickers: ["XOM"], desks: ["energy"] },
    { id: 3, score: 0.98, category: "deals", tickers: ["CVX"], desks: ["energy"] }, { id: 4, score: 0.9, category: "policy", tickers: [], desks: ["energy"] },
  ]);
  check("diversity: a second story on the same company gives way to a different one", dv.map((x) => x.id).join() === "1,3,4,2", dv.map((x) => x.id));

  console.log("why this matters to you");
  const mm = mattersToYou({ headline: "Chevron to buy Hess Midstream; Permian assets in Texas", tickers: ["CVX", "HESM"], entities: [{ name: "Chevron Corporation", ticker: "CVX", kind: "company" }, { name: "Hess Midstream", kind: "company" }], places: ["us:TX", "r:permian"] }, {
    watch: new Set(["CVX"]), network: new Map([[normCompany("Hess Midstream"), [{ contactId: 3, name: "Ann Lee", company: "Hess Midstream" }]]]),
    deals: [{ id: 1, name: "Hess Midstream", stage: "diligence", status: "open" }, { id: 2, name: "Hess Midstream", stage: "closed", status: "lost" }, { id: 3, name: "AB", stage: "x", status: "open" }],
    edge: [{ id: 5, kind: "place", label: "Permian Basin", bbox: [-105, 30, -100, 34] }, { id: 6, kind: "company", label: "Chevron", ticker: "CVX" }],
  });
  check("watchlist, pipeline, contacts and Edge watches each match, most specific first", mm.map((m) => m.kind).join() === "watchlist,pipeline,contact,edge,edge" && mm[1].detail.startsWith("Stage: diligence") && mm[2].label === "Ann Lee works at Hess Midstream" && mm[0].href.includes("ticker=CVX"), mm);
  check("nothing matches when nothing is shared", mattersToYou({ headline: "Fed holds rates", tickers: [], entities: [] }, { watch: new Set(["CVX"]), network: new Map(), deals: [], edge: [] }).length === 0);

  console.log("timelines, maps and charts");
  const tl = storyTimeline([
    { title: "Acme to buy Widget", source: "Reuters", kind: "article", url: "u1", at: "2026-10-01T12:00:00Z" },
    { title: "Acme agrees deal", source: "Bloomberg", kind: "article", url: "u2", at: "2026-10-01T12:30:00Z" },
    { title: "Acme deal update", source: "Reuters", kind: "article", url: "u3", at: "2026-10-01T13:00:00Z" },
    { title: "Acme Corp 8-K", source: "SEC EDGAR", kind: "filing", url: "u4", at: "2026-10-01T14:00:00Z", form: "8-K" },
  ], [{ id: 77, headline: "Acme explores sale", at: "2026-09-20T12:00:00Z" }, { id: 78, headline: "Too old", at: "2026-08-01T00:00:00Z" }]);
  check("timeline: earlier stories, the first report, one entry per outlet, filings named", tl.map((e) => e.kind).join() === "earlier,first,source,filing" && tl[1].label === "First reported by Reuters" && tl[3].label === "8-K current report" && tl[0].clusterId === 77, tl);
  const sg = storyGraph("Acme to buy Widget for $4B", [{ name: "Acme Corp", ticker: "ACME", kind: "company", role: "acquirer" }, { name: "Widget Inc", kind: "company" }, { name: "Jane Smith", kind: "person", role: "CEO of Widget" }, { name: "FTC", kind: "agency" }],
    { kind: "acquisition", acquirer: "Acme Corporation", target: "Widget", investors: [], advisors: [{ firm: "Goldman Sachs", side: "buyer", role: "financial" }] }, [{ name: "Bob Ray", company: "Widget Inc." }]);
  const label = (id: string) => sg.nodes.find((n) => n.id === id)?.label;
  check("relationship map: the deal joins buyer and target, names merge, people tie to their company, contacts appear", sg.edges.some((e) => e.kind === "deal" && label(e.from) === "Acme Corporation" && label(e.to) === "Widget") && sg.nodes.filter((n) => n.kind !== "story" && /acme/i.test(n.label)).length === 1 && sg.nodes.find((n) => n.label === "Acme Corporation")?.ticker === "ACME"
    && sg.edges.some((e) => e.kind === "role" && label(e.from) === "Jane Smith" && label(e.to) === "Widget") && sg.edges.some((e) => e.kind === "works" && label(e.from) === "Bob Ray") && sg.edges.some((e) => e.kind === "advise" && label(e.from) === "Goldman Sachs" && label(e.to) === "Acme Corporation") && sg.edges.some((e) => e.from === "story" && label(e.to) === "FTC"), sg);
  check("the public map never has contacts", !storyGraph("x", [{ name: "Widget", kind: "company" }], null).nodes.some((n) => n.kind === "contact"));
  const pos = layoutGraph(sg);
  check("layout: the story at the centre, everything inside the frame, nothing on top of anything else", pos.get("story")!.x === 0.5 && [...pos.values()].every((p) => p.x > 0.02 && p.x < 0.98 && p.y > 0.02 && p.y < 0.98) && [...pos.values()].every((a, i, all) => all.every((b, j) => i === j || Math.hypot(a.x - b.x, a.y - b.y) > 0.05)), [...pos.entries()]);
  check("figures read as numbers", parseFigure("$4.1 billion")?.n === 4.1e9 && parseFigure("$4.1 billion")?.unit === "$" && parseFigure("18%")?.unit === "%" && parseFigure("12.5x")?.unit === "x" && parseFigure("1.2m shares")?.n === 1.2e6 && parseFigure("no number") === null);
  check("figure bars: same unit, two or more, largest first", figureBars([{ label: "Deal value", value: "$4.1 billion" }, { label: "Debt", value: "$900 million" }, { label: "Premium", value: "18%" }]).map((b) => b.label).join() === "Deal value,Debt" && figureBars([{ label: "Premium", value: "18%" }]).length === 0);
  const cs = { tickers: ["ACME"], deal: null, summary: null, sources: [{ at: "a" }, { at: "b" }], sourceCount: 2, filing: null };
  check("one chart per card: deal, then price, then figures, filing, coverage", chartFor({ ...cs, deal: { valueUsd: 1e9, premium: null } }, () => true) === "deal" && chartFor(cs, () => true) === "price" && chartFor(cs, () => false) === "coverage" && chartFor({ ...cs, sourceCount: 1, filing: { form: "8-K" } }, () => false) === "filing");
  check("the story's moment on a 30-day line", eventIndex(30, new Date(now - 7 * 86_400_000).toISOString(), now) === 24 && eventIndex(30, new Date(now - 2 * 3_600_000).toISOString(), now) === 28 && eventIndex(30, new Date(now - 90 * 86_400_000).toISOString(), now) === null);
  const bc = briefCard({ headline: "Acme agrees to buy Widget for $4.1 billion in cash", summary: { bullets: ["Acme will pay $40 a share, an 18% premium to Friday's close.", "The deal is expected to close in the first half of next year, subject to regulators.", "A third bullet that should not fit."], numbers: [], why: "It is the largest industrial deal this year." } });
  check("Brief mode: a 20-second card of at most two bullets", bc.lines.length === 2 && bc.seconds <= 22 && bc.seconds >= 10, bc);

  console.log("the globe");
  check("stories are placed by the places they name; listed companies with none sit in the US, inferred", storyPlaces({ headline: "Saudi Aramco and TotalEnergies plan Qatar LNG venture", tickers: [] }).ids.join() === "c:SA,c:QA" && storyPlaces({ headline: "Acme beats estimates", tickers: ["ACME"] }).inferred && storyPlaces({ headline: "A thought piece", tickers: [] }).ids.length === 0);
  const gpts = globePoints([
    { id: 1, headline: "Exxon expands in Guyana", importance: 0.8, sourceCount: 4, tags: ["energy"], category: "deals", updatedAt: "2026-10-01T10:00:00Z", tickers: ["XOM"] },
    { id: 2, headline: "Guyana oil output rises", importance: 0.4, sourceCount: 1, tags: ["energy", "macro"], category: "macro", updatedAt: "2026-10-01T12:00:00Z", tickers: [] },
    { id: 3, headline: "Japan and Korea chip pact", importance: 0.6, sourceCount: 2, tags: ["tech"], category: "policy", updatedAt: "2026-10-01T11:00:00Z", tickers: [] },
    { id: 4, headline: "Acme beats", importance: 0.5, sourceCount: 1, tags: ["tech"], category: "earnings", updatedAt: "2026-10-01T09:00:00Z", tickers: ["ACME"] },
  ]);
  const guyana = gpts.find((p) => p.id === "c:GY")!;
  check("places gather their stories, weighted by significance, and split a multi-place story", gpts[0].id === "c:GY" && guyana.stories.length === 2 && Math.abs(guyana.weight - (significance(0.8, 4) + significance(0.4, 1))) < 0.002 && Math.abs(gpts.find((p) => p.id === "c:JP")!.weight - significance(0.6, 2) / 2) < 0.002 && gpts.find((p) => p.id === "c:US")?.inferred === true && guyana.latest === "2026-10-01T12:00:00Z", gpts);
  check("the desk filter keeps matching stories and reweights", filterPoints(gpts, ["tech"]).map((p) => p.id).sort().join() === "c:JP,c:KR,c:US" && filterPoints(gpts, null).length === gpts.length && filterPoints(gpts, ["macro"])[0].stories.length === 1);
  check("marker size grows with the square root of weight", markerRadius(1, 1) === 22 && markerRadius(0.25, 1) === 13 && markerRadius(0, 1) === 4);

  console.log("the audio briefing");
  check("finance text is made speakable", speakable("Acme raised $4.1bn at a 12.5x multiple, up 18% in Q3 — $40 a share") === "Acme raised 4.1 billion dollars at a 12.5 times multiple, up 18 percent in the third quarter, 40 dollars a share");
  const ch = briefingChapters({ name: "Ada Lovelace", deskLabel: "Energy", date: new Date("2026-10-02T12:00:00Z"), stories: [
    { id: 1, headline: "Exxon buys a shale driller", bullets: ["A $5bn all-stock deal."], why: "Consolidation continues.", tickers: ["XOM"], category: "deals", reasons: ["On your watchlist: XOM"] },
    { id: 2, headline: "OPEC holds output", bullets: [], why: "", tickers: [], category: "macro" },
  ], watch: [{ label: "WTI crude", last: 71.2, change: -0.012 }] });
  check("chapters: an opening, one per story, the markets, a close", ch.map((c) => c.id).join() === "intro,s1,s2,markets,outro" && ch[0].text.startsWith("Good morning, Ada. This is your Energy briefing for Friday, October 2: 2 stories") && ch[1].text.includes("5 billion dollars") && ch[1].text.includes("on your watchlist") && ch[2].text.startsWith("Finally: OPEC holds output.") && ch[3].text.includes("WTI crude down 1.2 percent") && ch[1].clusterId === 1, ch);
  const merged = mergeScript(ch, [{ id: "s1", text: "Exxon is buying a shale driller for five billion dollars in stock. It's the latest in a run of consolidation." }, { id: "s2", text: "" }, { id: "nope", text: "ignored text here" }]);
  check("the AI script keeps the chapters; anything dropped keeps its free text", merged.length === ch.length && merged[1].text.startsWith("Exxon is buying") && merged[2].text === ch[2].text && merged.every((c) => c.text.length <= MAX_CHAPTER_CHARS));
  check("voice cost is about $0.015 a minute", Math.abs(ttsCostUsd([{ id: "a", title: "", text: "", seconds: 240 }]) - 0.06) < 1e-9);

  console.log("the 60-second recap");
  const rs = (id: number) => ({ id, headline: `Story ${id}`, category: "deals", categoryLabel: "Deals", tags: ["energy"], tickers: [], sourceCount: 2, bullet: "", figure: null, change: null, closes: [] });
  const slides = recapSlides({ desk: "Energy", date: "Friday", stories: [1, 2, 3, 4, 5, 6].map(rs), deals: [{ label: "A", valueUsd: 2e9, kind: "acquisition" }, { label: "B", valueUsd: 5e9, kind: "merger" }, { label: "C", valueUsd: null, kind: "raise" }], movers: [{ symbol: "XOM", change: 0.01 }, { symbol: "CVX", change: -0.03 }, { symbol: "OXY", change: 0.02 }], storyCount: 40, sourceCount: 22, url: "https://x/news" });
  check("slides: title, five stories, deals, movers, close, in about a minute", slides.map((x) => x.kind).join() === "title,story,story,story,story,story,deals,movers,outro" && Math.abs(recapMs(slides) - RECAP_TARGET_MS) <= 5_000 && slides[6].kind === "deals" && slides[6].deals[0].label === "B" && slides[7].kind === "movers" && slides[7].movers[0].symbol === "CVX", slides.map((x) => [x.kind, x.ms]));
  check("the clock finds the slide and how far through it", slideAt(slides, 0).index === 0 && slideAt(slides, 5_000).index === 1 && slideAt(slides, 2_500).progress === 0.5 && slideAt(slides, 10e6).progress === 1);
  check("text wraps at words and marks a cut", wrapText("one two three four five six", 9, 2).join("|") === "one two|three…" && wrapText("short", 20, 3).join() === "short");

  console.log("follows");
  const fu = (seen: number, seenAgoH: number, notifiedAgoH: number | null, sources: number, updatedAgoH: number) => followUpdate({ seenSources: seen, seenAt: new Date(now - seenAgoH * 3_600_000), notifiedAt: notifiedAgoH === null ? null : new Date(now - notifiedAgoH * 3_600_000) }, { sourceCount: sources, updatedAt: new Date(now - updatedAgoH * 3_600_000) }, new Date(now));
  check("a followed story alerts when another outlet joins or it moves hours later, not twice in two hours", fu(2, 5, null, 3, 1).due && fu(2, 5, null, 3, 1).newSources === 1 && !fu(3, 1, null, 3, 0.5).due && fu(3, 5, null, 3, 1).due && !fu(2, 5, 1, 4, 0.2).due);
  check("five follows free, more with the plan", canFollowMore(FREE_FOLLOWS - 1, false) && !canFollowMore(FREE_FOLLOWS, false) && canFollowMore(500, true));

  console.log("public pages and premium");
  check("slugs: id first, words from the headline", slugFor(42, "Acme's $4.1B deal for Widget & Co. — what's next?") === "42-acmes-4-1b-deal-for-widget-and-co-whats-next" && idFromSlug("42-acmes-deal") === 42 && idFromSlug("42") === 42 && idFromSlug("x-42") === null && idFromSlug("0") === null && slugWords("Café société") === "cafe-societe");
  check("only stories built wholly from public sources get a page", isPublicStory({ headline: "Acme agrees to buy Widget" }, [{ kind: "article", url: "https://a" }, { kind: "filing", url: "https://sec" }]) && !isPublicStory({ headline: "Acme agrees to buy Widget" }, [{ kind: "upload", url: "https://a" }]) && !isPublicStory({ headline: "Acme agrees to buy Widget" }, []) && !isPublicStory({ headline: "Short" }, [{ kind: "article", url: "https://a" }]));
  const nf = FEATURES.filter((f) => f.id.startsWith("news."));
  check("the Newsroom's premium features are registered with honest costs", nf.length === 4 && nf.filter((f) => f.metered).every((f) => (f.costPerUseUsd ?? 0) > 0) && featureById("news.follows")?.metered === false && (featureById("news.audio")?.costPerUseUsd ?? 0) >= 0.05 && new Set(FEATURES.map((f) => f.id)).size === FEATURES.length, nf);
  const audioPrefs = normalizeNewsPrefs({ audio: { daily: true, voice: "nope", speed: 9 } }, { role: "banker" });
  check("audio preferences: daily only when asked, unknown voices and speeds fall back", audioPrefs.audio.daily && audioPrefs.audio.voice === "marin" && audioPrefs.audio.speed === 1 && !defaultNewsPrefs({ role: "vc" }).audio.daily);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
void main();
