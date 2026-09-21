/** Role definitions that drive onboarding, the tailored workspace, tool packs, and the AI persona. */

export type RoleId = "banker" | "pe" | "vc" | "markets" | "corpfin" | "consultant" | "accountant" | "student";

export type RoleDef = {
  id: RoleId;
  label: string;
  short: string;
  blurb: string;
  /** Longer marketing copy for the landing and /for pages. */
  pitch: string;
  specialtyLabel: string;
  specialties: string[];
  seniorities: string[];
  firmTypes: string[];
  askFirmTicker?: boolean;
  askSectors?: boolean;
  defaultTheme: string;
  /** Example jobs-to-be-done, shown on the landing page and the home dashboard. */
  jobs: string[];
};

export const SENIORITY_BANK = ["Analyst", "Associate", "Vice President", "Director / ED", "Managing Director"];
export const SENIORITY_GENERIC = ["Junior", "Mid-level", "Senior", "Lead / Head", "Partner / Executive"];

export const SECTORS = ["Technology", "Healthcare", "Energy & power", "Financials", "Consumer & retail", "Industrials", "Media & telecom", "Real estate"] as const;
export type Sector = (typeof SECTORS)[number];

export const ROLES: Record<RoleId, RoleDef> = {
  banker: {
    id: "banker", label: "Investment banker", short: "Banking", blurb: "Pitches, comps, process management, and deal execution.",
    pitch: "Trading comps from live SEC data, precedent transactions pulled from merger proxies, DCF and LBO models prefilled from filings, pitch pages and CIM sections drafted with citations. Restructuring gets capital structure tables, liquidity runways, and recovery waterfalls; capital markets gets IPO comps, bond math, and debt capacity.",
    specialtyLabel: "Group",
    specialties: ["Technology M&A", "M&A (generalist)", "Healthcare", "Energy & power", "FIG", "Consumer & retail", "Industrials", "Media & telecom", "Real estate & gaming", "Restructuring", "Leveraged finance", "ECM", "DCM", "Financial sponsors"],
    seniorities: SENIORITY_BANK, firmTypes: ["Bulge bracket", "Elite boutique", "Middle market", "Regional / independent"], defaultTheme: "terminal",
    jobs: ["Turn a comps sheet in minutes, footnoted", "Build a precedent transactions table from EDGAR", "Draft the pitch page and the buyer list", "Size a DIP and run the recovery waterfall"],
  },
  pe: {
    id: "pe", label: "Private equity", short: "PE", blurb: "Buyouts, growth equity, and private credit: screening, LBOs, diligence, portfolio value creation.",
    pitch: "Screen targets on public comps, run LBO returns with sources and uses, turn a CIM into a first-read memo, coordinate quality-of-earnings findings, track covenants and the 100-day plan, and prepare IC materials with every number cited.",
    specialtyLabel: "Strategy",
    specialties: ["Large-cap buyout", "Middle-market buyout", "Growth equity", "Private credit / direct lending", "Secondaries", "Infrastructure & real assets", "Fund of funds / LP"],
    seniorities: ["Analyst", "Associate", "Senior associate", "Vice President", "Principal", "Partner / MD"], firmTypes: ["Mega-fund", "Upper middle market", "Lower middle market", "Family office", "Sovereign / pension"], askSectors: true, defaultTheme: "graphite",
    jobs: ["LBO with returns attribution and sensitivities", "CIM first read and red flags", "Public comps for a private target", "Covenant and leverage tracking for the portfolio"],
  },
  vc: {
    id: "vc", label: "Venture capitalist", short: "VC", blurb: "Sourcing, diligence, and portfolio work across stages.",
    pitch: "A startup directory that spans YC, a16z, Thiel Fellows, Show HN launches, and every SEC Form D private raise, plus AI discovery for anything else. Thesis-driven sourcing, founder outreach drafts, cap table and dilution math, term sheet analysis, investment memos, and public comps for late-stage rounds.",
    specialtyLabel: "Stage focus",
    specialties: ["Pre-seed / seed", "Series A-B", "Growth / late stage", "Corporate VC", "Angel / syndicate", "Secondaries"],
    seniorities: ["Analyst", "Associate", "Principal", "Partner", "GP / Managing partner"], firmTypes: ["Institutional VC", "Corporate VC", "Angel / solo GP", "Accelerator", "Family office"], askSectors: true, defaultTheme: "aurora",
    jobs: ["Map a market and find every startup in it", "Draft the cold email that gets a founder reply", "Run the cap table through the next round", "Write the investment memo for Monday's partner meeting"],
  },
  markets: {
    id: "markets", label: "Public markets investor", short: "Markets", blurb: "Equity research, hedge funds, credit, and asset management.",
    pitch: "Earnings previews and recaps from filings, thesis and variant-perception drafting, insider and 13D activity, capital structure and relative value for credit, catalyst calendars, and position notes with cited numbers.",
    specialtyLabel: "Seat",
    specialties: ["Equity research (sell-side)", "Long/short equity", "Event-driven / merger arbitrage", "Distressed & credit", "Multi-manager pod", "Long-only / asset management", "Quant / systematic"],
    seniorities: ["Associate", "Analyst", "Senior analyst", "Portfolio manager", "Partner / CIO"], firmTypes: ["Bulge bracket research", "Boutique research", "Multi-manager", "Single-manager fund", "Asset manager", "Family office"], askSectors: true, defaultTheme: "midnight",
    jobs: ["Earnings preview with what matters and where consensus is wrong", "Initiation-style company teardown", "Merger arb spread and timeline", "Credit relative value across the capital structure"],
  },
  corpfin: {
    id: "corpfin", label: "Corporate finance", short: "Corp fin", blurb: "FP&A, corporate development, treasury, and investor relations inside a company.",
    pitch: "Peer benchmarking straight from XBRL, variance and price-volume-mix bridges from your exports, driver-based forecasts, 13-week cash, covenant calculators, guidance versus consensus, earnings scripts and Q&A banks, and target screens for corporate development.",
    specialtyLabel: "Function",
    specialties: ["FP&A", "Corporate development / M&A", "Strategic finance", "Treasury", "Investor relations", "Controller / accounting ops"],
    seniorities: SENIORITY_GENERIC, firmTypes: ["Public company", "Private company", "PE-backed company", "Startup"], askFirmTicker: true, askSectors: true, defaultTheme: "daylight",
    jobs: ["Benchmark margins and growth against peers", "Explain the variance in one page", "Build the 13-week cash forecast", "Prep the earnings call Q&A"],
  },
  consultant: {
    id: "consultant", label: "Consultant", short: "Consulting", blurb: "Strategy, diligence, and operations work for clients.",
    pitch: "Issue trees and workplans, market sizing with reconciled top-down and bottom-up, competitor profiles from filings, commercial due diligence storylines, quality-of-earnings add-back testing, NWC pegs, and ghost decks with action titles.",
    specialtyLabel: "Practice",
    specialties: ["Strategy", "Commercial due diligence", "Financial due diligence (TAS)", "Operations & performance", "Restructuring / turnaround", "Economic & valuation advisory", "Technology & digital"],
    seniorities: ["Analyst / BA", "Consultant / Associate", "Engagement manager", "Principal", "Partner"], firmTypes: ["MBB", "Big 4 advisory", "Boutique", "Independent"], askSectors: true, defaultTheme: "nordic",
    jobs: ["Size the market both ways and reconcile", "Profile the competitors from their 10-Ks", "Test the seller's EBITDA add-backs", "Write the ghost deck for the steerco"],
  },
  accountant: {
    id: "accountant", label: "Accountant", short: "Accounting", blurb: "Audit, tax, transaction services, and technical accounting.",
    pitch: "Technical accounting memos under ASC 606, 842, 805, 350, 718, and 740 with codification cites, disclosure benchmarking against peer 10-Ks, comment-letter search, journal entry testing on your exports, flux analysis, materiality, lease and revenue schedules, and quality-of-earnings databooks.",
    specialtyLabel: "Service line",
    specialties: ["Audit", "Tax", "Technical accounting / SEC reporting", "Transaction advisory (FDD)", "Valuation", "Forensic", "Controllership"],
    seniorities: ["Staff", "Senior", "Manager", "Senior manager", "Partner / Director"], firmTypes: ["Big 4", "National firm", "Regional firm", "In-house"], askSectors: true, defaultTheme: "paper",
    jobs: ["Draft the ASC 606 memo with citations", "Benchmark a disclosure against peers", "Test a journal entry population", "Explain the flux for the close"],
  },
  student: {
    id: "student", label: "Student", short: "Student", blurb: "Learning the tools and preparing for recruiting.",
    pitch: "A real terminal to learn on, with a coach that runs mock technical interviews, grades your answers, builds stock pitches from live data, walks through models line by line, and tracks your recruiting.",
    specialtyLabel: "Target path",
    specialties: ["Investment banking", "Consulting", "Private equity / VC", "Equity research / hedge funds", "Corporate finance", "Accounting", "Undecided"],
    seniorities: ["Undergraduate", "Master's", "MBA", "PhD / other"], firmTypes: ["Target school", "Non-target", "International"], askSectors: true, defaultTheme: "lavender",
    jobs: ["Mock technical interview with grading", "Build a stock pitch from real filings", "Learn a 3-statement model on a real company", "Track recruiting and networking"],
  },
};

export const ROLE_IDS = Object.keys(ROLES) as RoleId[];

export const SECTOR_WATCHLISTS: Record<Sector, string[]> = {
  "Technology": ["SNOW", "MDB", "DDOG", "CRWD", "NET", "PLTR", "GTLB", "NOW"],
  "Healthcare": ["LLY", "UNH", "JNJ", "PFE", "MRK", "ABBV", "ISRG", "VRTX"],
  "Energy & power": ["XOM", "CVX", "COP", "EOG", "DVN", "OXY", "SLB", "NEE"],
  "Financials": ["JPM", "GS", "MS", "BAC", "C", "WFC", "BLK", "SCHW"],
  "Consumer & retail": ["NKE", "SBUX", "COST", "WMT", "TGT", "LULU", "CMG", "MCD"],
  "Industrials": ["CAT", "DE", "HON", "GE", "ETN", "EMR", "PH", "URI"],
  "Media & telecom": ["NFLX", "DIS", "WBD", "CMCSA", "T", "VZ", "CHTR", "SPOT"],
  "Real estate": ["PLD", "AMT", "EQIX", "SPG", "O", "WELL", "DLR", "PSA"],
};

const SPECIALTY_WATCHLISTS: Record<string, string[]> = {
  "Technology M&A": SECTOR_WATCHLISTS["Technology"],
  "M&A (generalist)": ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "JPM", "XOM"],
  "Healthcare": SECTOR_WATCHLISTS["Healthcare"],
  "Energy & power": SECTOR_WATCHLISTS["Energy & power"],
  "FIG": SECTOR_WATCHLISTS["Financials"],
  "Consumer & retail": SECTOR_WATCHLISTS["Consumer & retail"],
  "Industrials": SECTOR_WATCHLISTS["Industrials"],
  "Media & telecom": SECTOR_WATCHLISTS["Media & telecom"],
  "Real estate & gaming": ["PLD", "EQIX", "SPG", "LVS", "MGM", "WYNN", "HLT", "MAR"],
  "Restructuring": ["CCL", "AAL", "RIG", "LUMN", "WBA", "CHTR", "PARA", "VFC"],
  "Leveraged finance": ["CHTR", "WBD", "CCL", "AAL", "SATS", "LUMN", "RIG", "VFC"],
  "ECM": ["RDDT", "ARM", "CRCL", "CRWV", "FIG", "CHYM", "ETOR", "KVYO"],
  "DCM": ["AAPL", "MSFT", "VZ", "T", "ORCL", "AMZN", "JPM", "BAC"],
  "Financial sponsors": ["KKR", "BX", "APO", "CG", "ARES", "TPG", "OWL", "BAM"],
  "Distressed & credit": ["CCL", "AAL", "RIG", "LUMN", "WBA", "CHTR", "PARA", "VFC"],
  "Event-driven / merger arbitrage": ["HES", "CHX", "JNPR", "ANSS", "K", "DFS", "CTLT", "ALB"],
};

const VC_WATCHLIST = ["RDDT", "ARM", "CRCL", "CRWV", "FIG", "KVYO", "RBRK", "TEM"];
const SPONSOR_WATCHLIST = ["KKR", "BX", "APO", "CG", "ARES", "TPG", "OWL", "BAM"];

export type Profile = {
  role: RoleId; specialty: string; seniority: string; firmType: string; firmName: string; firmTicker: string; sectors: string[]; goals: string; name?: string;
};

export type WorkspaceConfig = {
  role: RoleId;
  title: string;
  subtitle: string;
  watchlist: string[];
  initialPanels: { ticker: string; fn: string }[];
  suggestedPrompts: (ticker: string) => string[];
  persona: string;
  home: "terminal" | "vc";
};

function sectorWatchlist(sectors: string[], fallback: string[]): string[] {
  const picked = sectors.filter((s): s is Sector => (SECTORS as readonly string[]).includes(s));
  if (picked.length === 0) return fallback;
  const out: string[] = [];
  for (const s of picked) for (const t of SECTOR_WATCHLISTS[s]) if (out.length < 12 && !out.includes(t)) out.push(t);
  return out;
}

/** Build the workspace configuration for a profile. */
export function workspaceFor(p: Profile): WorkspaceConfig {
  const first = (l: string[]) => l[0] ?? "SNOW";
  const sectorText = p.sectors.length ? p.sectors.join(", ") : "";
  switch (p.role) {
    case "banker": {
      const watchlist = SPECIALTY_WATCHLISTS[p.specialty] ?? SECTOR_WATCHLISTS["Technology"];
      const rx = p.specialty === "Restructuring";
      const cm = p.specialty === "ECM" || p.specialty === "DCM" || p.specialty === "Leveraged finance";
      return {
        role: p.role, title: `${p.specialty || "M&A"} · ${p.seniority || "Banker"}`, subtitle: p.firmType || "Investment banking", watchlist,
        initialPanels: rx ? [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "CAP" }] : [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "COMPS" }],
        suggestedPrompts: (t) => rx
          ? [`Build ${t}'s capital structure table from the latest 10-Q debt footnote with maturities and coupons`, `What is ${t}'s liquidity runway: cash, revolver availability, and burn?`, `Which of ${t}'s tranches is the fulcrum security at 6x, 7x, and 8x EBITDA?`, `Summarize any 8-K Item 1.03, 2.04, or going-concern language for ${t}`]
          : cm
            ? [`What has ${t} issued recently and how has it traded since pricing?`, `Debt capacity for ${t} at 4x, 5x, and 6x leverage with interest coverage`, `Comparable recent IPOs for a company like ${t}: size, range, pricing vs range`, `Draft the ratings-agency talking points for ${t}`]
            : [`Propose a tiered peer set for ${t} with one-line rationale each`, `Draft footnotes for a ${t} trading comps sheet`, `Summarize ${t}'s latest 10-Q for a pitch page: growth, margins, guidance, notable items`, `Find precedent acquisitions of companies like ${t} in EDGAR merger proxies`],
        persona: `The user is a ${p.seniority || ""} in ${p.specialty || "M&A"} at a ${p.firmType || "bank"}${p.firmName ? ` (${p.firmName})` : ""}. Write like a sharp associate: pitch-ready phrasing, precise numbers, comparability caveats.${rx ? " Emphasize leverage, liquidity, maturities, covenant headroom, and recovery." : ""}${cm ? " Emphasize capital markets context: recent issuance, trading since pricing, windows, ratings." : ""}`,
        home: "terminal",
      };
    }
    case "pe": {
      const watchlist = sectorWatchlist(p.sectors, SPONSOR_WATCHLIST);
      return {
        role: p.role, title: `${p.specialty || "Private equity"} · ${p.seniority || ""}`, subtitle: p.firmType || "Private equity", watchlist,
        initialPanels: [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "COMPS" }],
        suggestedPrompts: (t) => [`Public comps for a private target that looks like ${t}: EV/EBITDA and EV/Revenue ranges`, `Run a quick LBO on ${t} at 6x leverage and a 5-year hold: IRR and MOIC`, `What did ${t} disclose about customer concentration and churn in its 10-K?`, `Find recent take-privates in ${sectorText || "software"} with premiums and multiples from EDGAR`],
        persona: `The user is a ${p.seniority || ""} in ${p.specialty || "private equity"} at a ${p.firmType || "fund"}${p.firmName ? ` (${p.firmName})` : ""}${sectorText ? ` focused on ${sectorText}` : ""}. Think like an investor: entry multiple, leverage, returns, downside, value creation levers. Be precise about sources and uses.`,
        home: "terminal",
      };
    }
    case "vc": {
      return {
        role: p.role, title: `${p.specialty || "Venture"} · ${p.seniority || ""}`, subtitle: p.firmType || "Venture capital", watchlist: VC_WATCHLIST,
        initialPanels: [{ ticker: "RDDT", fn: "DES" }, { ticker: "RDDT", fn: "COMPS" }],
        suggestedPrompts: (t) => [`Which recent IPOs are the best public comps for a growth-stage software company like ${t}?`, `What multiples are growth-stage public comps trading at, and what does that imply for a late-stage private round?`, `Summarize ${t}'s S-1 or latest 10-K risk factors relevant to a late-stage investor`, `Find recent Form D filings for companies in my sectors`],
        persona: `The user is a ${p.seniority || ""} at a ${p.firmType || "venture firm"} focused on ${p.specialty || "early stage"}${sectorText ? ` in ${sectorText}` : ""}. Think like an investor: market, team, traction, round dynamics, ownership math, and comparables. Use web research for private companies and cite links.`,
        home: "vc",
      };
    }
    case "markets": {
      const watchlist = SPECIALTY_WATCHLISTS[p.specialty] ?? sectorWatchlist(p.sectors, ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "NFLX"]);
      return {
        role: p.role, title: `${p.specialty || "Public markets"} · ${p.seniority || ""}`, subtitle: p.firmType || "Investing", watchlist,
        initialPanels: [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "FA" }],
        suggestedPrompts: (t) => [`Earnings preview for ${t}: what matters, last quarter's trends, and what the 10-Q flags`, `Insider transactions and 13D activity in ${t} over the last year`, `Where is the variant view on ${t} versus what the filings show?`, `Capital structure and relative value across ${t}'s debt tranches`],
        persona: `The user is a ${p.seniority || ""} in ${p.specialty || "public markets"} at a ${p.firmType || "fund"}. Think like an investor with a thesis: what is priced in, what the filings show, catalysts, and risk. Numbers precise, opinions labeled.`,
        home: "terminal",
      };
    }
    case "corpfin": {
      const own = p.firmTicker ? [p.firmTicker.toUpperCase()] : [];
      const watchlist = [...own, ...sectorWatchlist(p.sectors, SECTOR_WATCHLISTS["Technology"]).filter((t) => !own.includes(t))].slice(0, 10);
      return {
        role: p.role, title: `${p.specialty || "Corporate finance"} · ${p.firmName || "your company"}`, subtitle: p.firmType || "Corporate finance", watchlist,
        initialPanels: own.length ? [{ ticker: own[0], fn: "FA" }, { ticker: own[0], fn: "COMPS" }] : [{ ticker: first(watchlist), fn: "FA" }, { ticker: first(watchlist), fn: "AI" }],
        suggestedPrompts: (t) => [`How does ${t}'s margin structure compare with peers, and where is the gap?`, `Build a peer benchmarking table for ${t} on growth, margins, FCF conversion, and leverage`, `What did ${t}'s peers say about guidance and demand in their latest 10-Q?`, `Draft board-deck bullets on ${t}'s relative valuation`],
        persona: `The user works in ${p.specialty || "corporate finance"} at ${p.firmName || "a company"}${p.firmTicker ? ` (ticker ${p.firmTicker.toUpperCase()})` : ""}. Frame answers for internal audiences: CFO, board, FP&A. Emphasize benchmarking, variance drivers, cash, and capital allocation.`,
        home: "terminal",
      };
    }
    case "consultant": {
      const watchlist = sectorWatchlist(p.sectors, ["AAPL", "MSFT", "AMZN", "GOOGL", "META", "NVDA", "TSLA", "NFLX"]);
      return {
        role: p.role, title: `${p.specialty || "Consulting"} · ${p.seniority || ""}`, subtitle: p.firmType || "Consulting", watchlist,
        initialPanels: [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "AI" }],
        suggestedPrompts: (t) => [`Give me a one-page company profile of ${t} for a client meeting`, `What are ${t}'s stated strategic priorities and risks in its latest 10-K?`, `Compare unit economics and margin structure across ${t} and its peers`, `Size ${t}'s addressable market from segment disclosures and peer data`],
        persona: `The user is a ${p.seniority || ""} consultant in ${p.specialty || "strategy"} at a ${p.firmType || "firm"}. Structure answers MECE with a headline takeaway, then supporting evidence. Be explicit about data sources and what is inferred.`,
        home: "terminal",
      };
    }
    case "accountant": {
      const watchlist = sectorWatchlist(p.sectors, SECTOR_WATCHLISTS["Technology"]);
      return {
        role: p.role, title: `${p.specialty || "Accounting"} · ${p.seniority || ""}`, subtitle: p.firmType || "Accounting", watchlist,
        initialPanels: [{ ticker: first(watchlist), fn: "FA" }, { ticker: first(watchlist), fn: "FIL" }],
        suggestedPrompts: (t) => [`Summarize ${t}'s revenue recognition policy from its latest 10-K with the ASC 606 judgments`, `What non-GAAP adjustments does ${t} make, and how large are they versus GAAP?`, `List ${t}'s critical audit matters and significant estimates`, `Find SEC comment letters to ${t} and what they asked about`],
        persona: `The user is a ${p.seniority || ""} in ${p.specialty || "accounting"} at a ${p.firmType || "firm"}. Cite the filing section and the ASC paragraph for accounting answers, distinguish GAAP from non-GAAP, and flag judgment areas (ASC 606, 842, 350, 718, 740, 805) precisely.`,
        home: "terminal",
      };
    }
    case "student":
    default: {
      const watchlist = sectorWatchlist(p.sectors, SECTOR_WATCHLISTS["Technology"]);
      return {
        role: "student", title: `${p.specialty || "Finance"} track · ${p.seniority || "Student"}`, subtitle: "Learning mode", watchlist,
        initialPanels: [{ ticker: first(watchlist), fn: "DES" }, { ticker: first(watchlist), fn: "AI" }],
        suggestedPrompts: (t) => [`Walk me through how to read ${t}'s comps sheet line by line`, `Explain enterprise value vs. market cap using ${t}'s actual numbers`, `Interview-style: why might ${t} trade at a premium to its peers?`, `Quiz me on accounting and valuation, one question at a time`],
        persona: `The user is a ${p.seniority || "student"} targeting ${p.specialty || "finance"} roles. Teach while answering: define terms on first use, show the arithmetic, and add a short interview-prep angle when relevant.`,
        home: "terminal",
      };
    }
  }
}
