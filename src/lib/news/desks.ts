/**
 * Desks: who a story matters to. A story is tagged with sectors (what industry) and lenses (what kind
 * of work it bears on: M&A, IPOs, restructuring, venture...). A person's desk is the lenses of their
 * role and group plus the sectors they cover, so an energy banker sees energy M&A and capital markets,
 * a VC sees funding and the tech radar, an accountant sees restatements and standard setters.
 *
 * The feeds were each checked live on 2026-09-28; the dead, blocked and stale ones were left out.
 * Every source is free: publisher RSS headlines (linked, never republished), press-release wires,
 * regulators, SEC filings and open research sites.
 */
import type { Profile } from "@/lib/roles";
import { CRYPTO_FEEDS } from "@/lib/crypto/news-feeds";

export type SectorKey = "tech" | "healthcare" | "energy" | "financials" | "consumer" | "industrials" | "media" | "realestate";
export type Lens =
  | "ma" | "ecm" | "dcm" | "levfin" | "rx" | "sponsors" | "pe" | "privcredit" | "infra" | "vc" | "radar"
  | "markets" | "event" | "credit" | "corpfin" | "consulting" | "accounting" | "careers" | "macro" | "policy" | "crypto";
export type Tag = SectorKey | Lens;

export const SECTOR_LABEL: Record<SectorKey, string> = {
  tech: "Technology", healthcare: "Healthcare", energy: "Energy & power", financials: "Financials", consumer: "Consumer & retail",
  industrials: "Industrials", media: "Media & telecom", realestate: "Real estate",
};
export const LENS_LABEL: Record<Lens, string> = {
  ma: "M&A", ecm: "Equity capital markets", dcm: "Debt capital markets", levfin: "Leveraged finance", rx: "Restructuring", sponsors: "Sponsors",
  pe: "Private equity", privcredit: "Private credit", infra: "Infrastructure", vc: "Venture", radar: "Tech radar", markets: "Markets",
  event: "Event-driven", credit: "Credit", corpfin: "Corporate finance", consulting: "Strategy", accounting: "Accounting & reporting",
  careers: "Careers", macro: "Economy", policy: "Policy & regulation", crypto: "Crypto & digital assets",
};
/** The profile's sector names (roles.ts) to sector keys. */
export const SECTOR_OF: Record<string, SectorKey> = {
  "Technology": "tech", "Healthcare": "healthcare", "Energy & power": "energy", "Financials": "financials", "Consumer & retail": "consumer",
  "Industrials": "industrials", "Media & telecom": "media", "Real estate": "realestate",
};
export const SECTOR_KEYS = Object.keys(SECTOR_LABEL) as SectorKey[];

/** Source quality: 1 national business press and regulators, 2 trade press, 3 wires and aggregators. */
export type Tier = 1 | 2 | 3;
export type ItemKind = "article" | "filing" | "release" | "gov" | "paper" | "repo" | "model" | "launch" | "research";
export type Feed = { id: string; name: string; url: string; tags: Tag[]; tier: Tier; kind: ItemKind; everyMin: number; paywalled?: boolean };

const cnbc = (id: string) => `https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=${id}`;
const dive = (d: string) => `https://www.${d}.com/feeds/news/`;

export const FEEDS: Feed[] = [
  // National business press (headlines and links only; several are paywalled, so never fetched for text)
  { id: "cnbc-top", name: "CNBC", url: cnbc("100003114"), tags: ["markets", "macro"], tier: 1, kind: "article", everyMin: 10 },
  { id: "cnbc-finance", name: "CNBC", url: cnbc("10000664"), tags: ["financials", "markets"], tier: 1, kind: "article", everyMin: 20 },
  { id: "cnbc-tech", name: "CNBC", url: cnbc("19854910"), tags: ["tech"], tier: 1, kind: "article", everyMin: 20 },
  { id: "cnbc-energy", name: "CNBC", url: cnbc("19836768"), tags: ["energy"], tier: 1, kind: "article", everyMin: 30 },
  { id: "cnbc-health", name: "CNBC", url: cnbc("10000108"), tags: ["healthcare"], tier: 1, kind: "article", everyMin: 30 },
  { id: "cnbc-realestate", name: "CNBC", url: cnbc("10000115"), tags: ["realestate"], tier: 1, kind: "article", everyMin: 30 },
  { id: "cnbc-earnings", name: "CNBC", url: cnbc("15839135"), tags: ["markets", "corpfin"], tier: 1, kind: "article", everyMin: 30 },
  { id: "cnbc-retail", name: "CNBC", url: cnbc("10000116"), tags: ["consumer"], tier: 1, kind: "article", everyMin: 30 },
  { id: "cnbc-media", name: "CNBC", url: cnbc("10000110"), tags: ["media"], tier: 1, kind: "article", everyMin: 45 },
  { id: "mw-top", name: "MarketWatch", url: "https://feeds.content.dowjones.io/public/rss/mw_topstories", tags: ["markets"], tier: 1, kind: "article", everyMin: 15 },
  { id: "wsj-markets", name: "The Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSMarketsMain", tags: ["markets", "credit"], tier: 1, kind: "article", everyMin: 10, paywalled: true },
  { id: "wsj-business", name: "The Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/WSJcomUSBusiness", tags: ["ma", "corpfin"], tier: 1, kind: "article", everyMin: 10, paywalled: true },
  { id: "wsj-tech", name: "The Wall Street Journal", url: "https://feeds.content.dowjones.io/public/rss/RSSWSJD", tags: ["tech"], tier: 1, kind: "article", everyMin: 20, paywalled: true },
  { id: "ft-home", name: "Financial Times", url: "https://www.ft.com/rss/home", tags: ["markets", "macro"], tier: 1, kind: "article", everyMin: 15, paywalled: true },
  { id: "ft-companies", name: "Financial Times", url: "https://www.ft.com/companies?format=rss", tags: ["ma", "corpfin"], tier: 1, kind: "article", everyMin: 15, paywalled: true },
  { id: "ft-markets", name: "Financial Times", url: "https://www.ft.com/markets?format=rss", tags: ["markets", "credit"], tier: 1, kind: "article", everyMin: 15, paywalled: true },
  { id: "bbg-markets", name: "Bloomberg", url: "https://feeds.bloomberg.com/markets/news.rss", tags: ["markets", "credit"], tier: 1, kind: "article", everyMin: 10, paywalled: true },
  { id: "bbg-tech", name: "Bloomberg", url: "https://feeds.bloomberg.com/technology/news.rss", tags: ["tech"], tier: 1, kind: "article", everyMin: 15, paywalled: true },
  { id: "bbg-industries", name: "Bloomberg", url: "https://feeds.bloomberg.com/industries/news.rss", tags: ["ma", "industrials", "consumer"], tier: 1, kind: "article", everyMin: 15, paywalled: true },
  { id: "bbg-economics", name: "Bloomberg", url: "https://feeds.bloomberg.com/economics/news.rss", tags: ["macro"], tier: 1, kind: "article", everyMin: 20, paywalled: true },
  { id: "nyt-dealbook", name: "The New York Times DealBook", url: "https://rss.nytimes.com/services/xml/rss/nyt/Dealbook.xml", tags: ["ma", "sponsors", "pe"], tier: 1, kind: "article", everyMin: 20, paywalled: true },
  { id: "nyt-business", name: "The New York Times", url: "https://rss.nytimes.com/services/xml/rss/nyt/Business.xml", tags: ["corpfin", "macro"], tier: 1, kind: "article", everyMin: 20, paywalled: true },
  { id: "axios", name: "Axios", url: "https://api.axios.com/feed/", tags: ["macro", "policy", "markets"], tier: 1, kind: "article", everyMin: 15 },
  { id: "semafor", name: "Semafor", url: "https://www.semafor.com/rss.xml", tags: ["macro", "markets"], tier: 1, kind: "article", everyMin: 20 },
  { id: "theinformation", name: "The Information", url: "https://www.theinformation.com/feed", tags: ["tech", "vc"], tier: 1, kind: "article", everyMin: 20, paywalled: true },
  { id: "bi-all", name: "Business Insider", url: "https://feeds.businessinsider.com/custom/all", tags: ["markets", "careers"], tier: 2, kind: "article", everyMin: 20, paywalled: true },
  { id: "fortune", name: "Fortune", url: "https://fortune.com/feed/fortune-feeds/?id=3230629", tags: ["corpfin", "vc"], tier: 2, kind: "article", everyMin: 30, paywalled: true },
  // Venture and technology
  { id: "techcrunch", name: "TechCrunch", url: "https://techcrunch.com/feed/", tags: ["tech", "vc"], tier: 1, kind: "article", everyMin: 15 },
  { id: "tc-venture", name: "TechCrunch", url: "https://techcrunch.com/category/venture/feed/", tags: ["vc"], tier: 1, kind: "article", everyMin: 20 },
  { id: "tc-ai", name: "TechCrunch", url: "https://techcrunch.com/category/artificial-intelligence/feed/", tags: ["tech", "radar", "vc"], tier: 1, kind: "article", everyMin: 20 },
  { id: "crunchbase", name: "Crunchbase News", url: "https://news.crunchbase.com/feed/", tags: ["vc"], tier: 2, kind: "article", everyMin: 30 },
  { id: "sifted", name: "Sifted", url: "https://sifted.eu/feed", tags: ["vc"], tier: 2, kind: "article", everyMin: 45 },
  { id: "techmeme", name: "Techmeme", url: "https://www.techmeme.com/feed.xml", tags: ["tech", "vc"], tier: 2, kind: "article", everyMin: 15 },
  { id: "geekwire", name: "GeekWire", url: "https://www.geekwire.com/feed/", tags: ["tech", "vc"], tier: 2, kind: "article", everyMin: 30 },
  { id: "verge", name: "The Verge", url: "https://www.theverge.com/rss/index.xml", tags: ["tech"], tier: 2, kind: "article", everyMin: 30 },
  { id: "ars", name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", tags: ["tech", "radar"], tier: 2, kind: "article", everyMin: 30 },
  { id: "mittr", name: "MIT Technology Review", url: "https://www.technologyreview.com/feed/", tags: ["tech", "radar"], tier: 2, kind: "article", everyMin: 60 },
  { id: "producthunt", name: "Product Hunt", url: "https://www.producthunt.com/feed", tags: ["radar", "vc"], tier: 3, kind: "launch", everyMin: 60 },
  // Private equity and credit
  { id: "pehub", name: "PE Hub", url: "https://www.pehub.com/feed/", tags: ["pe", "sponsors", "ma", "privcredit"], tier: 2, kind: "article", everyMin: 30 },
  { id: "pewire", name: "Private Equity Wire", url: "https://www.privateequitywire.co.uk/feed", tags: ["pe", "privcredit"], tier: 2, kind: "article", everyMin: 60 },
  // Energy and power
  { id: "eia-today", name: "U.S. EIA", url: "https://www.eia.gov/rss/todayinenergy.xml", tags: ["energy", "policy"], tier: 1, kind: "gov", everyMin: 120 },
  { id: "eia-press", name: "U.S. EIA", url: "https://www.eia.gov/rss/press_rss.xml", tags: ["energy"], tier: 1, kind: "gov", everyMin: 120 },
  { id: "oilprice", name: "OilPrice.com", url: "https://oilprice.com/rss/main", tags: ["energy"], tier: 3, kind: "article", everyMin: 30 },
  { id: "rigzone", name: "Rigzone", url: "https://www.rigzone.com/news/rss/rigzone_latest.aspx", tags: ["energy"], tier: 2, kind: "article", everyMin: 30 },
  { id: "utilitydive", name: "Utility Dive", url: dive("utilitydive"), tags: ["energy", "infra"], tier: 2, kind: "article", everyMin: 45 },
  { id: "powermag", name: "POWER Magazine", url: "https://www.powermag.com/feed/", tags: ["energy", "infra"], tier: 2, kind: "article", everyMin: 60 },
  { id: "canary", name: "Canary Media", url: "https://www.canarymedia.com/rss.rss", tags: ["energy", "infra"], tier: 2, kind: "article", everyMin: 60 },
  // Healthcare and life sciences
  { id: "fda-press", name: "U.S. FDA", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml", tags: ["healthcare", "policy"], tier: 1, kind: "gov", everyMin: 60 },
  { id: "fda-drugs", name: "U.S. FDA", url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml", tags: ["healthcare", "policy"], tier: 1, kind: "gov", everyMin: 60 },
  { id: "stat", name: "STAT", url: "https://www.statnews.com/feed/", tags: ["healthcare"], tier: 1, kind: "article", everyMin: 30 },
  { id: "endpoints", name: "Endpoints News", url: "https://endpts.com/feed/", tags: ["healthcare", "vc"], tier: 1, kind: "article", everyMin: 30 },
  { id: "fiercehc", name: "Fierce Healthcare", url: "https://www.fiercehealthcare.com/rss/xml", tags: ["healthcare"], tier: 2, kind: "article", everyMin: 45 },
  { id: "biopharmadive", name: "BioPharma Dive", url: dive("biopharmadive"), tags: ["healthcare"], tier: 2, kind: "article", everyMin: 45 },
  { id: "medtechdive", name: "MedTech Dive", url: dive("medtechdive"), tags: ["healthcare"], tier: 2, kind: "article", everyMin: 60 },
  { id: "healthcaredive", name: "Healthcare Dive", url: dive("healthcaredive"), tags: ["healthcare"], tier: 2, kind: "article", everyMin: 60 },
  // Financial institutions and regulators
  { id: "bankingdive", name: "Banking Dive", url: dive("bankingdive"), tags: ["financials"], tier: 2, kind: "article", everyMin: 45 },
  { id: "paymentsdive", name: "Payments Dive", url: dive("paymentsdive"), tags: ["financials", "tech"], tier: 2, kind: "article", everyMin: 60 },
  { id: "insurancejournal", name: "Insurance Journal", url: "https://www.insurancejournal.com/rss/news/", tags: ["financials"], tier: 2, kind: "article", everyMin: 60 },
  { id: "fed-press", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", tags: ["financials", "macro", "policy"], tier: 1, kind: "gov", everyMin: 30 },
  { id: "sec-press", name: "SEC", url: "https://www.sec.gov/news/pressreleases.rss", tags: ["accounting", "markets", "policy"], tier: 1, kind: "gov", everyMin: 30 },
  { id: "cfpb", name: "CFPB", url: "https://www.consumerfinance.gov/about-us/newsroom/feed/", tags: ["financials", "policy"], tier: 1, kind: "gov", everyMin: 180 },
  // Consumer, industrials, media, real estate
  { id: "retaildive", name: "Retail Dive", url: dive("retaildive"), tags: ["consumer"], tier: 2, kind: "article", everyMin: 45 },
  { id: "fooddive", name: "Food Dive", url: dive("fooddive"), tags: ["consumer"], tier: 2, kind: "article", everyMin: 60 },
  { id: "restaurantdive", name: "Restaurant Dive", url: dive("restaurantdive"), tags: ["consumer"], tier: 2, kind: "article", everyMin: 60 },
  { id: "modernretail", name: "Modern Retail", url: "https://www.modernretail.co/feed/", tags: ["consumer"], tier: 2, kind: "article", everyMin: 60 },
  { id: "mfgdive", name: "Manufacturing Dive", url: dive("manufacturingdive"), tags: ["industrials"], tier: 2, kind: "article", everyMin: 60 },
  { id: "supplychaindive", name: "Supply Chain Dive", url: dive("supplychaindive"), tags: ["industrials", "consumer"], tier: 2, kind: "article", everyMin: 60 },
  { id: "constructiondive", name: "Construction Dive", url: dive("constructiondive"), tags: ["industrials", "realestate"], tier: 2, kind: "article", everyMin: 60 },
  { id: "freightwaves", name: "FreightWaves", url: "https://www.freightwaves.com/news/feed", tags: ["industrials"], tier: 2, kind: "article", everyMin: 45 },
  { id: "defensenews", name: "Defense News", url: "https://www.defensenews.com/arc/outboundfeeds/rss/", tags: ["industrials", "policy"], tier: 2, kind: "article", everyMin: 60 },
  { id: "deadline", name: "Deadline", url: "https://deadline.com/feed/", tags: ["media"], tier: 2, kind: "article", everyMin: 45 },
  { id: "variety", name: "Variety", url: "https://variety.com/feed/", tags: ["media"], tier: 2, kind: "article", everyMin: 45 },
  { id: "fiercenetwork", name: "Fierce Network", url: "https://www.fierce-network.com/rss/xml", tags: ["media", "tech"], tier: 2, kind: "article", everyMin: 60 },
  { id: "lightreading", name: "Light Reading", url: "https://www.lightreading.com/rss.xml", tags: ["media"], tier: 2, kind: "article", everyMin: 60 },
  { id: "commobserver", name: "Commercial Observer", url: "https://commercialobserver.com/feed/", tags: ["realestate"], tier: 2, kind: "article", everyMin: 60 },
  { id: "multifamilydive", name: "Multifamily Dive", url: dive("multifamilydive"), tags: ["realestate"], tier: 2, kind: "article", everyMin: 60 },
  // Corporate finance, accounting, strategy, the economy
  { id: "cfodive", name: "CFO Dive", url: dive("cfodive"), tags: ["corpfin", "accounting"], tier: 2, kind: "article", everyMin: 60 },
  { id: "sloan", name: "MIT Sloan Management Review", url: "https://sloanreview.mit.edu/feed/", tags: ["consulting"], tier: 2, kind: "article", everyMin: 180 },
  { id: "mckinsey", name: "McKinsey & Company", url: "https://www.mckinsey.com/insights/rss", tags: ["consulting"], tier: 2, kind: "article", everyMin: 180 },
  { id: "bls", name: "Bureau of Labor Statistics", url: "https://www.bls.gov/feed/bls_latest.rss", tags: ["macro"], tier: 1, kind: "gov", everyMin: 60 },
  { id: "bea", name: "Bureau of Economic Analysis", url: "https://apps.bea.gov/rss/rss.xml", tags: ["macro"], tier: 1, kind: "gov", everyMin: 120 },
  // Press-release wires: companies' own announcements, meant for redistribution
  { id: "prn-ma", name: "PR Newswire", url: "https://www.prnewswire.com/rss/financial-services-latest-news/acquisitions-mergers-and-takeovers-list.rss", tags: ["ma", "sponsors"], tier: 3, kind: "release", everyMin: 10 },
  { id: "prn-fin", name: "PR Newswire", url: "https://www.prnewswire.com/rss/financial-services-latest-news/financial-services-latest-news-list.rss", tags: ["financials", "dcm", "ecm"], tier: 3, kind: "release", everyMin: 20 },
  { id: "prn-energy", name: "PR Newswire", url: "https://www.prnewswire.com/rss/energy-latest-news/energy-latest-news-list.rss", tags: ["energy"], tier: 3, kind: "release", everyMin: 30 },
  { id: "prn-health", name: "PR Newswire", url: "https://www.prnewswire.com/rss/health-latest-news/health-latest-news-list.rss", tags: ["healthcare"], tier: 3, kind: "release", everyMin: 30 },
  { id: "prn-tech", name: "PR Newswire", url: "https://www.prnewswire.com/rss/technology-latest-news/technology-latest-news-list.rss", tags: ["tech", "vc"], tier: 3, kind: "release", everyMin: 30 },
  { id: "gnw-ma", name: "GlobeNewswire", url: "https://www.globenewswire.com/RssFeed/subjectcode/27-Mergers%20and%20Acquisitions/feedTitle/GlobeNewswire%20-%20Mergers%20and%20Acquisitions", tags: ["ma"], tier: 3, kind: "release", everyMin: 15 },
  { id: "bw-home", name: "Business Wire", url: "https://feed.businesswire.com/rss/home/?rss=G1QFDERJXkJeGVtRWA==", tags: ["markets", "ma"], tier: 3, kind: "release", everyMin: 15 },
  // Crypto publishers (src/lib/crypto/news-feeds.ts)
  ...CRYPTO_FEEDS,
];

/** Domains whose articles sit behind a paywall or metering: headlines and links only, never fetched for text. */
export const PAYWALLED = /(^|\.)(wsj\.com|ft\.com|bloomberg\.com|nytimes\.com|theinformation\.com|barrons\.com|economist\.com|businessinsider\.com|fortune\.com|marketwatch\.com)$/i;

/* ---------------- Desks ---------------- */

export type DeskId = string;
export type Desk = {
  id: DeskId; label: string; lenses: Lens[]; sectors: SectorKey[];
  /** Market watch: symbols the data layer can price (tickers, ETFs, index and commodity codes). */
  watch: { symbol: string; label: string }[];
  /** What a research brief looks for, in words. */
  focus: string;
};

const WATCH: Record<SectorKey | "core" | "credit" | "ecm" | "vc", { symbol: string; label: string }[]> = {
  core: [{ symbol: "^GSPC", label: "S&P 500" }, { symbol: "^IXIC", label: "Nasdaq" }, { symbol: "^RUT", label: "Russell 2000" }],
  tech: [{ symbol: "XLK", label: "Tech (XLK)" }, { symbol: "IGV", label: "Software (IGV)" }, { symbol: "SMH", label: "Semis (SMH)" }],
  healthcare: [{ symbol: "XLV", label: "Health care (XLV)" }, { symbol: "XBI", label: "Biotech (XBI)" }, { symbol: "IHI", label: "Med devices (IHI)" }],
  energy: [{ symbol: "CLUSD", label: "WTI crude" }, { symbol: "BZUSD", label: "Brent" }, { symbol: "NGUSD", label: "Natural gas" }, { symbol: "XLE", label: "Energy (XLE)" }, { symbol: "XLU", label: "Utilities (XLU)" }],
  financials: [{ symbol: "XLF", label: "Financials (XLF)" }, { symbol: "KRE", label: "Regional banks (KRE)" }, { symbol: "KBE", label: "Banks (KBE)" }],
  consumer: [{ symbol: "XLY", label: "Discretionary (XLY)" }, { symbol: "XLP", label: "Staples (XLP)" }, { symbol: "XRT", label: "Retail (XRT)" }],
  industrials: [{ symbol: "XLI", label: "Industrials (XLI)" }, { symbol: "ITA", label: "Aerospace & defense (ITA)" }, { symbol: "IYT", label: "Transports (IYT)" }],
  media: [{ symbol: "XLC", label: "Communications (XLC)" }, { symbol: "IYZ", label: "Telecom (IYZ)" }],
  realestate: [{ symbol: "XLRE", label: "Real estate (XLRE)" }, { symbol: "VNQ", label: "REITs (VNQ)" }],
  credit: [{ symbol: "HYG", label: "High yield (HYG)" }, { symbol: "LQD", label: "Investment grade (LQD)" }, { symbol: "BKLN", label: "Leveraged loans (BKLN)" }],
  ecm: [{ symbol: "IPO", label: "IPO index (IPO)" }, { symbol: "^RUT", label: "Russell 2000" }],
  vc: [{ symbol: "ARKK", label: "Innovation (ARKK)" }, { symbol: "IGV", label: "Software (IGV)" }, { symbol: "IPO", label: "IPO index (IPO)" }],
};

const GROUP: Record<string, { lenses: Lens[]; sectors: SectorKey[]; id: string; label: string }> = {
  "Technology M&A": { id: "bank:tech", label: "Technology banking", lenses: ["ma", "ecm", "sponsors"], sectors: ["tech"] },
  "M&A (generalist)": { id: "bank:ma", label: "M&A", lenses: ["ma", "sponsors", "event"], sectors: [] },
  "Healthcare": { id: "bank:healthcare", label: "Healthcare banking", lenses: ["ma", "ecm"], sectors: ["healthcare"] },
  "Energy & power": { id: "bank:energy", label: "Energy & power", lenses: ["ma", "ecm", "dcm", "infra"], sectors: ["energy"] },
  "FIG": { id: "bank:fig", label: "Financial institutions", lenses: ["ma", "dcm", "policy"], sectors: ["financials"] },
  "Consumer & retail": { id: "bank:consumer", label: "Consumer & retail banking", lenses: ["ma", "sponsors"], sectors: ["consumer"] },
  "Industrials": { id: "bank:industrials", label: "Industrials banking", lenses: ["ma", "sponsors"], sectors: ["industrials"] },
  "Media & telecom": { id: "bank:media", label: "Media & telecom banking", lenses: ["ma", "dcm"], sectors: ["media"] },
  "Real estate & gaming": { id: "bank:realestate", label: "Real estate & gaming", lenses: ["ma", "dcm"], sectors: ["realestate"] },
  "Restructuring": { id: "bank:rx", label: "Restructuring", lenses: ["rx", "credit", "levfin"], sectors: [] },
  "Leveraged finance": { id: "bank:levfin", label: "Leveraged finance", lenses: ["levfin", "credit", "sponsors"], sectors: [] },
  "ECM": { id: "bank:ecm", label: "Equity capital markets", lenses: ["ecm", "vc"], sectors: [] },
  "DCM": { id: "bank:dcm", label: "Debt capital markets", lenses: ["dcm", "credit", "macro"], sectors: [] },
  "Financial sponsors": { id: "bank:sponsors", label: "Financial sponsors", lenses: ["sponsors", "pe", "levfin", "ma"], sectors: [] },
};

const sectorsOf = (p: Pick<Profile, "sectors">): SectorKey[] => [...new Set(p.sectors.map((s) => SECTOR_OF[s]).filter(Boolean))] as SectorKey[];

/** A person's desk from their profile: the lenses of their role and group, the sectors they cover. */
export function deskFor(p: Pick<Profile, "role" | "specialty" | "sectors">): Desk {
  const own = sectorsOf(p);
  const make = (id: string, label: string, lenses: Lens[], sectors: SectorKey[], extra: (keyof typeof WATCH)[], focus: string): Desk => ({
    id, label, lenses, sectors,
    watch: dedupeWatch([...WATCH.core.slice(0, 1), ...sectors.flatMap((s) => WATCH[s]), ...extra.flatMap((k) => WATCH[k])]).slice(0, 8),
    focus,
  });
  switch (p.role) {
    case "banker": {
      const g = GROUP[p.specialty] ?? GROUP["M&A (generalist)"];
      const sectors = g.sectors.length ? g.sectors : own;
      const extra: (keyof typeof WATCH)[] = g.lenses.includes("credit") || g.lenses.includes("dcm") ? ["credit"] : g.lenses.includes("ecm") && !g.sectors.length ? ["ecm"] : [];
      return make(g.id, g.label, g.lenses, sectors, extra.length ? extra : sectors.length ? [] : ["core"],
        `${g.label} bankers: announced and rumored deals, sponsor activity, capital markets issuance, regulatory decisions and company news${sectors.length ? ` in ${sectors.map((s) => SECTOR_LABEL[s]).join(", ")}` : ""}`);
    }
    case "pe": {
      const s = p.specialty;
      const lenses: Lens[] = s === "Private credit / direct lending" ? ["privcredit", "levfin", "credit", "pe"] : s === "Infrastructure & real assets" ? ["infra", "pe", "ma"] : s === "Growth equity" ? ["pe", "vc", "ma"] : ["pe", "sponsors", "ma", "levfin"];
      const id = s === "Private credit / direct lending" ? "pe:credit" : s === "Infrastructure & real assets" ? "pe:infra" : s === "Growth equity" ? "pe:growth" : "pe";
      return make(id, s || "Private equity", lenses, own, lenses.includes("credit") ? ["credit"] : own.length ? [] : ["core"],
        "Private equity investors: take-privates, sponsor-backed deals and exits, fund raises, private credit, secondaries, and portfolio-company news");
    }
    case "vc": {
      const sectors = own.length ? own : ["tech" as SectorKey];
      return make("vc", "Venture", ["vc", "radar", "ecm"], sectors, ["vc"],
        "Venture investors: funding rounds, new funds, startup acquisitions and shutdowns, IPO filings, AI and developer-tool breakthroughs, and notable launches");
    }
    case "markets": {
      const s = p.specialty;
      const lenses: Lens[] = s === "Event-driven / merger arbitrage" ? ["event", "ma", "markets"] : s === "Distressed & credit" ? ["rx", "credit", "levfin"] : ["markets", "macro", "event"];
      const id = s === "Event-driven / merger arbitrage" ? "markets:event" : s === "Distressed & credit" ? "markets:credit" : "markets";
      return make(id, s || "Public markets", lenses, own, lenses.includes("credit") ? ["credit"] : ["core"],
        "Public markets investors: earnings and guidance, activist stakes, deal spreads, analyst moves, macro releases and market-moving news");
    }
    case "corpfin":
      return make("corpfin", p.specialty || "Corporate finance", ["corpfin", "ma", "markets"], own, own.length ? [] : ["core"],
        "Corporate finance teams: peer results and guidance, capital allocation, activist campaigns, M&A in the sector, and CFO-relevant policy");
    case "consultant":
      return make("consulting", p.specialty || "Consulting", ["consulting", "ma", "corpfin"], own, own.length ? [] : ["core"],
        "Consultants: strategy moves, industry shifts, M&A and restructurings, and policy changes in client sectors");
    case "accountant":
      return make("accounting", p.specialty || "Accounting", ["accounting", "policy", "corpfin"], own, ["core"],
        "Accountants: SEC, FASB and PCAOB actions, restatements, auditor changes, enforcement, tax policy, and reporting news");
    case "student":
    default:
      return make("student", "Markets for students", ["markets", "ma", "macro", "careers"], own, ["core"],
        "Finance students: the biggest deals and market moves explained, the economy, and recruiting news");
  }
}

function dedupeWatch(xs: { symbol: string; label: string }[]) {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(x.symbol) ? false : (seen.add(x.symbol), true)));
}

/** Every desk id that can exist (for research briefs and the desk switcher). */
export function allDesks(): Desk[] {
  const out: Desk[] = [];
  for (const specialty of Object.keys(GROUP)) out.push(deskFor({ role: "banker", specialty, sectors: [] }));
  for (const specialty of ["Middle-market buyout", "Private credit / direct lending", "Infrastructure & real assets", "Growth equity"]) out.push(deskFor({ role: "pe", specialty, sectors: [] }));
  out.push(deskFor({ role: "vc", specialty: "", sectors: [] }));
  for (const specialty of ["Long/short equity", "Event-driven / merger arbitrage", "Distressed & credit"]) out.push(deskFor({ role: "markets", specialty, sectors: [] }));
  for (const role of ["corpfin", "consultant", "accountant", "student"] as const) out.push(deskFor({ role, specialty: "", sectors: [] }));
  const seen = new Set<string>();
  return out.filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

/** How much a story tagged `tags` matters to a desk: lenses count most, sectors next. 0 to 1. */
export function deskAffinity(desk: Pick<Desk, "lenses" | "sectors">, tags: string[]): number {
  if (!tags.length) return 0;
  const lens = desk.lenses.filter((l) => tags.includes(l)).length;
  const sector = desk.sectors.filter((s) => tags.includes(s)).length;
  const lensScore = lens ? Math.min(1, 0.55 + 0.2 * (lens - 1)) : 0;
  const sectorScore = sector ? 0.45 : 0;
  // A desk with no sectors (a generalist or product desk) takes lens matches at full weight.
  return Math.min(1, desk.sectors.length ? lensScore * 0.6 + sectorScore + (lens && sector ? 0.15 : 0) : lensScore);
}

/* ---------------- Filings ---------------- */

/** The SEC form types polled from EDGAR's latest-filings feed, and what each means. */
export const FILING_FORMS: { form: string; label: string; tags: Tag[]; weight: number }[] = [
  { form: "8-K", label: "Current report", tags: [], weight: 0.25 },
  { form: "S-1", label: "IPO registration", tags: ["ecm", "vc"], weight: 0.7 },
  { form: "F-1", label: "IPO registration (foreign issuer)", tags: ["ecm", "vc"], weight: 0.65 },
  { form: "424B4", label: "IPO priced", tags: ["ecm"], weight: 0.6 },
  { form: "SC 13D", label: "Activist or control stake", tags: ["event", "sponsors", "corpfin"], weight: 0.45 },
  { form: "SCHEDULE 13D", label: "Activist or control stake", tags: ["event", "sponsors", "corpfin"], weight: 0.45 },
  { form: "SC TO-T", label: "Tender offer", tags: ["ma", "event"], weight: 0.75 },
  { form: "SC 13E3", label: "Going-private transaction", tags: ["pe", "sponsors", "ma"], weight: 0.75 },
  { form: "DEFM14A", label: "Definitive merger proxy", tags: ["ma", "event"], weight: 0.5 },
  { form: "PREM14A", label: "Preliminary merger proxy", tags: ["ma", "event"], weight: 0.55 },
  { form: "S-4", label: "Shares registered for a merger", tags: ["ma"], weight: 0.45 },
  { form: "NT 10-K", label: "Late annual report", tags: ["rx", "accounting", "credit"], weight: 0.5 },
  { form: "NT 10-Q", label: "Late quarterly report", tags: ["rx", "accounting"], weight: 0.4 },
  { form: "D", label: "Private raise (Form D)", tags: ["vc", "pe"], weight: 0.35 },
];

/** 8-K items worth a story, what they mean, their tags and weight. Items not listed are routine. */
export const EIGHT_K_ITEMS: Record<string, { label: string; tags: Tag[]; weight: number; category: string }> = {
  "1.01": { label: "Material agreement", tags: ["ma", "levfin", "dcm"], weight: 0.45, category: "deals" },
  "1.02": { label: "Agreement terminated", tags: ["ma", "event"], weight: 0.5, category: "deals" },
  "1.03": { label: "Bankruptcy or receivership", tags: ["rx", "credit", "levfin"], weight: 0.95, category: "legal" },
  "2.01": { label: "Acquisition or disposition completed", tags: ["ma"], weight: 0.45, category: "deals" },
  "2.02": { label: "Results of operations", tags: ["markets", "corpfin"], weight: 0.2, category: "earnings" },
  "2.04": { label: "Debt acceleration or default trigger", tags: ["rx", "credit", "levfin"], weight: 0.85, category: "legal" },
  "2.05": { label: "Exit or restructuring costs", tags: ["rx", "corpfin"], weight: 0.45, category: "people" },
  "2.06": { label: "Material impairment", tags: ["accounting", "rx"], weight: 0.5, category: "filings" },
  "3.01": { label: "Delisting notice", tags: ["rx", "markets"], weight: 0.6, category: "markets" },
  "4.01": { label: "Auditor changed", tags: ["accounting"], weight: 0.6, category: "filings" },
  "4.02": { label: "Prior financials can no longer be relied on", tags: ["accounting", "markets", "event"], weight: 0.9, category: "filings" },
  "5.01": { label: "Change in control", tags: ["ma", "event"], weight: 0.8, category: "deals" },
  "5.02": { label: "Executive or director change", tags: ["corpfin", "markets"], weight: 0.3, category: "people" },
};

/** SIC code ranges to sectors, for filings (EDGAR tags each filer with its SIC code). */
export function sectorOfSic(sic: number): SectorKey | null {
  if (!Number.isFinite(sic) || sic <= 0) return null;
  if ((sic >= 1300 && sic <= 1399) || (sic >= 2900 && sic <= 2999) || (sic >= 4900 && sic <= 4991) || sic === 4922 || sic === 4923 || sic === 4924 || sic === 4932) return "energy";
  if ((sic >= 2830 && sic <= 2836) || (sic >= 3840 && sic <= 3851) || (sic >= 8000 && sic <= 8099) || sic === 5122 || sic === 6324) return "healthcare";
  if ((sic >= 3570 && sic <= 3579) || (sic >= 3660 && sic <= 3679) || (sic >= 7370 && sic <= 7379) || sic === 3825 || sic === 3826) return "tech";
  if (sic >= 6000 && sic <= 6411) return "financials";
  if ((sic >= 6500 && sic <= 6553) || sic === 6798) return "realestate";
  if ((sic >= 4800 && sic <= 4899) || (sic >= 7800 && sic <= 7849) || (sic >= 2710 && sic <= 2741)) return "media";
  if ((sic >= 2000 && sic <= 2399) || (sic >= 5000 && sic <= 5999) || (sic >= 7000 && sic <= 7299) || sic === 5812) return "consumer";
  if ((sic >= 1000 && sic <= 1299) || (sic >= 1400 && sic <= 1799) || (sic >= 2400 && sic <= 2829) || (sic >= 3000 && sic <= 3569) || (sic >= 3580 && sic <= 3659) || (sic >= 3680 && sic <= 3839) || (sic >= 4000 && sic <= 4799)) return "industrials";
  return null;
}

/* ---------------- GDELT (best effort) ---------------- */

/** Reuters and AP have no public RSS; GDELT's index finds their stories. Rotated one query per run, and skipped when GDELT is throttling. */
export const GDELT_QUERIES: { id: string; q: string; tags: Tag[] }[] = [
  { id: "ma", q: "(acquire OR acquisition OR merger OR takeover OR buyout)", tags: ["ma", "sponsors"] },
  { id: "rx", q: "(bankruptcy OR \"chapter 11\" OR restructuring OR default)", tags: ["rx", "credit"] },
  { id: "ecm", q: "(IPO OR \"initial public offering\" OR \"share sale\")", tags: ["ecm"] },
  { id: "energy", q: "(oil OR \"natural gas\" OR LNG OR pipeline OR OPEC OR refinery OR utility)", tags: ["energy"] },
  { id: "health", q: "(FDA OR biotech OR pharmaceutical OR drugmaker OR hospital)", tags: ["healthcare"] },
  { id: "banks", q: "(bank OR lender OR \"private credit\" OR insurer)", tags: ["financials", "privcredit"] },
  { id: "tech", q: "(startup OR \"artificial intelligence\" OR chipmaker OR software OR \"funding round\")", tags: ["tech", "vc"] },
];
export const GDELT_DOMAINS = ["reuters.com", "apnews.com"];
