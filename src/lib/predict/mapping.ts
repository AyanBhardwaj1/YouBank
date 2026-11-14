/**
 * Which stocks, sectors and factors a prediction market's question moves: rules first, so every link can be
 * read and tested. Pure. scripts/test-predict.ts checks each rule on real-world wordings.
 *
 * Three kinds of link, in order of strength:
 * 1. explicit: the title names a listed company ("$NVDA", "(NVDA)", "NASDAQ: NVDA") or a company in the
 *    name table (Nvidia, Pfizer). FDA, earnings, merger and price questions are about that company.
 * 2. rule: a theme the question belongs to (a Fed cut, a CPI print, tariffs, an election's control) and the
 *    sectors, ETFs and factors that theme has historically moved, each with the sign of the move if the
 *    question resolves yes. These are the textbook sensitivities (rates and duration, tariffs and importers),
 *    not a model's estimate: their size is unknown and they can fail on any given day.
 * 3. ai (optional, ./ai-map.ts): a model may add names through the app's AI layer; it never removes a rule's,
 *    and its tickers pass the same checks.
 *
 * `dir` is how the name tends to move as YES becomes more likely: 1 up, -1 down, 0 mixed (it moves, but
 * which way depends on the details).
 */
import type { Category, Market } from "./types";

export type Dir = 1 | -1 | 0;
export type TickerLink = { ticker: string; dir: Dir; why: string; source: "explicit" | "rule" | "ai" };
export type SectorLink = { name: string; etf: string; dir: Dir; members: string[] };
export type FactorLink = { name: string; dir: Dir };
export type Mapping = { tickers: TickerLink[]; sectors: SectorLink[]; factors: FactorLink[]; rules: string[]; source: "rules" | "rules+ai" };

/* ---------------- Validation ---------------- */

/** Upper-case words that look like tickers in titles but are not ones. */
const NOT_TICKERS = new Set(["CPI", "GDP", "PCE", "PPI", "FED", "FOMC", "USA", "US", "UK", "EU", "UN", "AI", "ETF", "IPO", "CEO", "CFO", "EPS", "BTC", "ETH", "SOL", "XRP", "NBA", "NFL", "MLB", "NHL", "GOP", "TV", "NATO", "OPEC", "FDA", "FTC", "DOJ", "SEC", "BLS", "BEA", "NBER", "YES", "NO", "AM", "PM", "ET", "PT", "UTC", "Q1", "Q2", "Q3", "Q4", "FY", "YOY", "WTI", "OK", "VS", "API", "GPT", "LLM", "AGI", "DC", "NY", "CA", "TX", "FL", "EV", "EVS", "ATH", "THE", "WILL", "AND", "OR", "OF", "BY", "IN", "ON", "AT", "TO", "A", "I"]);

/** A ticker as US listings write them: one to five letters, an optional class ("BRK.B"). Pure. */
export function validTicker(raw: string): string | null {
  const t = raw.trim().toUpperCase().replace(/^\$/, "").replace(/-/g, ".");
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(t) || NOT_TICKERS.has(t)) return null;
  return t;
}

/* ---------------- Names ---------------- */

/** Company names (as titles write them) to tickers. Lower-case keys, matched as whole words. */
export const COMPANIES: Record<string, string> = {
  apple: "AAPL", microsoft: "MSFT", nvidia: "NVDA", amazon: "AMZN", alphabet: "GOOGL", google: "GOOGL", meta: "META", facebook: "META", tesla: "TSLA",
  netflix: "NFLX", "berkshire hathaway": "BRK.B", berkshire: "BRK.B", jpmorgan: "JPM", "jp morgan": "JPM", "goldman sachs": "GS", goldman: "GS", "morgan stanley": "MS",
  "bank of america": "BAC", "wells fargo": "WFC", citigroup: "C", citi: "C", exxon: "XOM", exxonmobil: "XOM", chevron: "CVX", boeing: "BA", intel: "INTC", amd: "AMD",
  broadcom: "AVGO", tsmc: "TSM", "taiwan semiconductor": "TSM", coinbase: "COIN", microstrategy: "MSTR", robinhood: "HOOD", palantir: "PLTR", disney: "DIS",
  walmart: "WMT", target: "TGT", costco: "COST", nike: "NKE", ford: "F", "general motors": "GM", pfizer: "PFE", moderna: "MRNA", "eli lilly": "LLY", lilly: "LLY",
  "novo nordisk": "NVO", merck: "MRK", "johnson & johnson": "JNJ", "johnson and johnson": "JNJ", unitedhealth: "UNH", vertex: "VRTX", biogen: "BIIB", regeneron: "REGN",
  gilead: "GILD", amgen: "AMGN", oracle: "ORCL", salesforce: "CRM", adobe: "ADBE", ibm: "IBM", uber: "UBER", airbnb: "ABNB", starbucks: "SBUX", "mcdonald's": "MCD",
  mcdonalds: "MCD", "coca-cola": "KO", pepsico: "PEP", kroger: "KR", albertsons: "ACI", visa: "V", mastercard: "MA", paypal: "PYPL", "delta air lines": "DAL",
  delta: "DAL", "united airlines": "UAL", "american airlines": "AAL", southwest: "LUV", "lockheed martin": "LMT", lockheed: "LMT", northrop: "NOC", "northrop grumman": "NOC",
  raytheon: "RTX", rtx: "RTX", "general dynamics": "GD", "warner bros": "WBD", "warner bros. discovery": "WBD", comcast: "CMCSA", "t-mobile": "TMUS", verizon: "VZ",
  "at&t": "T", gamestop: "GME", "home depot": "HD", lowes: "LOW", "lowe's": "LOW", caterpillar: "CAT", deere: "DE", "john deere": "DE", "3m": "MMM", "general electric": "GE",
  "ge aerospace": "GE", "super micro": "SMCI", supermicro: "SMCI", micron: "MU", qualcomm: "QCOM", "arm holdings": "ARM", snowflake: "SNOW", crowdstrike: "CRWD", shopify: "SHOP",
  spotify: "SPOT", "unitedhealth group": "UNH", cvs: "CVS", humana: "HUM", "bristol myers": "BMY", abbvie: "ABBV", "novavax": "NVAX", "rivian": "RIVN", lucid: "LCID",
  // Private companies: the listed names most tied to them.
  openai: "MSFT", anthropic: "AMZN", spacex: "TSLA", xai: "TSLA",
};
const PRIVATE_NOTE: Record<string, string> = { openai: "OpenAI is private; Microsoft is its largest listed backer", anthropic: "Anthropic is private; Amazon and Alphabet are large listed backers", spacex: "SpaceX is private; Tesla shares its chief executive", xai: "xAI is private; Tesla shares its chief executive" };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\&]/g, "\\$&");
const NAME_RE = new RegExp(`(^|[^a-z0-9])(${Object.keys(COMPANIES).sort((a, b) => b.length - a.length).map(escape).join("|")})(?=$|[^a-z0-9])`, "gi");

/** Tickers a title names: "$NVDA", "(NVDA)", "NYSE: X", and companies in the name table. Pure. */
export function explicitTickers(text: string): { ticker: string; name: string; note?: string }[] {
  const out = new Map<string, { ticker: string; name: string; note?: string }>();
  const add = (raw: string, name: string, note?: string) => { const t = validTicker(raw); if (t && !out.has(t)) out.set(t, { ticker: t, name, ...(note ? { note } : {}) }); };
  for (const m of text.matchAll(/\$([A-Za-z]{1,5}(?:\.[A-Za-z])?)\b/g)) add(m[1], m[1].toUpperCase());
  for (const m of text.matchAll(/\b(?:NYSE|NASDAQ|Nasdaq|AMEX|NYSEARCA)\s*:\s*([A-Z]{1,5}(?:\.[A-Z])?)\b/g)) add(m[1], m[1]);
  for (const m of text.matchAll(/\(([A-Z]{1,5}(?:\.[A-Z])?)\)/g)) add(m[1], m[1]);
  for (const m of text.matchAll(NAME_RE)) {
    const key = m[2].toLowerCase();
    // "Target" and "Delta" are ordinary words: only with a capital and not as "target rate"/"delta variant".
    if ((key === "target" || key === "delta" || key === "visa" || key === "meta" || key === "ford") && !/^[A-Z]/.test(m[2])) continue;
    if (key === "target" && /target (rate|range|price)/i.test(text)) continue;
    add(COMPANIES[key], m[2], PRIVATE_NOTE[key]);
  }
  return [...out.values()];
}

/* ---------------- Themes ---------------- */

const S = (name: string, etf: string, dir: Dir, members: string[]): SectorLink => ({ name, etf, dir, members });
const F = (name: string, dir: Dir): FactorLink => ({ name, dir });
const T = (ticker: string, dir: Dir, why: string): TickerLink => ({ ticker, dir, why, source: "rule" });

type Rule = {
  id: string; label: string;
  /** The question belongs to the theme. */
  when: RegExp;
  /** ...unless this also matches. */
  unless?: RegExp;
  categories?: Category[];
  /** The theme's effects if YES. */
  sectors: SectorLink[]; factors: FactorLink[]; tickers?: TickerLink[];
  /** When the question is the other side of the theme ("below", "no cut"), every sign flips. */
  flip?: RegExp;
};

const RATE_SENSITIVE = (d: Dir): SectorLink[] => [
  S("Homebuilders", "ITB", d, ["DHI", "LEN", "PHM", "NVR", "TOL"]), S("Real estate (REITs)", "VNQ", d, ["PLD", "O", "AMT", "SPG", "EQIX"]),
  S("Utilities", "XLU", d, ["NEE", "DUK", "SO", "D"]), S("Small caps", "IWM", d, []), S("Long Treasuries", "TLT", d, []),
  S("Regional banks", "KRE", 0, ["USB", "PNC", "TFC", "KEY", "CFG", "ZION"]), S("Large banks", "XLF", 0, ["JPM", "BAC", "WFC", "C", "GS", "MS"]),
  S("US dollar", "UUP", (d === 0 ? 0 : -d) as Dir, []),
];

export const RULES: Rule[] = [
  {
    id: "fed-cut", label: "A Fed rate cut", categories: ["fed", "economy"],
    when: /\b(cut|cuts|decrease[sd]?|lower(s|ed)?|reduce[sd]?)\b[^.?]*\b(rates?|bps|basis points|fed funds)\b|\brate cuts?\b|\bcut\s*\d+\s*bps\b/i,
    unless: /\b(no cut|hike|increase|raise|hold|no change|unchanged|pause)\b/i,
    sectors: RATE_SENSITIVE(1), factors: [F("Duration (rate sensitivity)", 1), F("Size (small over large)", 1), F("Growth over value", 1)],
    tickers: [T("JPM", 0, "Banks: lower rates trim net interest income but help loan demand and credit"), T("BAC", 0, "Banks: lower rates trim net interest income but help loan demand and credit")],
  },
  {
    id: "fed-hike", label: "A Fed rate hike", categories: ["fed", "economy"],
    when: /\b(hike|hikes|increase[sd]?|raise[sd]?)\b[^.?]*\b(rates?|bps|basis points|fed funds)\b|\brate hikes?\b/i,
    unless: /\b(no hike|cut|decrease|hold|no change|unchanged|pause)\b/i,
    sectors: RATE_SENSITIVE(-1), factors: [F("Duration (rate sensitivity)", -1), F("Size (small over large)", -1), F("Growth over value", -1)],
  },
  {
    id: "fed-hold", label: "The Fed holding rates (against a cut)", categories: ["fed"],
    when: /\b(hold|holds|no change|unchanged|pause[sd]?|maintain[s]?)\b/i,
    sectors: RATE_SENSITIVE(-1), factors: [F("Duration (rate sensitivity)", -1)],
  },
  {
    id: "inflation-hot", label: "Inflation above a level", categories: ["economy", "fed"],
    when: /\b(cpi|inflation|pce|core prices)\b/i,
    flip: /\b(below|under|less than|lower than|at or below|cool(s|er)?)\b/i,
    sectors: [S("Long Treasuries", "TLT", -1, []), S("Inflation-protected Treasuries", "TIP", 1, []), S("Nasdaq 100 (long-duration growth)", "QQQ", -1, []), S("Energy", "XLE", 1, ["XOM", "CVX", "COP"]), S("Gold", "GLD", 1, []), S("Homebuilders", "ITB", -1, ["DHI", "LEN", "PHM"])],
    factors: [F("Duration (rate sensitivity)", -1), F("Value over growth", 1)],
  },
  {
    id: "recession", label: "A recession", categories: ["economy"],
    when: /\brecession\b|\bnegative gdp\b|\bgdp (growth )?(below|under) 0\b|\bcontraction\b/i,
    sectors: [S("Consumer discretionary", "XLY", -1, ["AMZN", "HD", "NKE", "SBUX", "MCD"]), S("Industrials", "XLI", -1, ["CAT", "DE", "GE", "UNP"]), S("Financials", "XLF", -1, ["JPM", "BAC", "WFC", "C"]),
      S("Consumer staples", "XLP", 1, ["PG", "KO", "PEP", "WMT", "COST"]), S("Utilities", "XLU", 1, ["NEE", "DUK", "SO"]), S("Long Treasuries", "TLT", 1, [])],
    factors: [F("Market beta", -1), F("Quality", 1), F("Low volatility", 1)],
  },
  {
    id: "jobs-weak", label: "A weak jobs market", categories: ["economy"],
    when: /\bunemployment (rate )?(above|over|higher|at or above|rise)|\bjobless claims (above|over)|\bpayrolls? (below|under|negative)|\bjob losses\b/i,
    sectors: [S("Long Treasuries", "TLT", 1, []), S("Consumer discretionary", "XLY", -1, ["AMZN", "HD", "NKE"]), S("Staffing", "", -1, ["RHI", "MAN", "KFY"])],
    factors: [F("Market beta", -1), F("Duration (rate sensitivity)", 1)],
  },
  {
    id: "growth-strong", label: "Strong growth or jobs", categories: ["economy"],
    when: /\bgdp (growth )?(above|over|at least)\b|\bpayrolls? (above|over)\b|\bunemployment (rate )?(below|under)\b/i,
    sectors: [S("Industrials", "XLI", 1, ["CAT", "DE", "GE"]), S("Consumer discretionary", "XLY", 1, ["AMZN", "HD"]), S("Long Treasuries", "TLT", -1, [])],
    factors: [F("Market beta", 1), F("Value over growth", 1)],
  },
  {
    id: "yields-up", label: "Higher Treasury yields", categories: ["economy", "fed"],
    when: /\b(10[- ]year|2[- ]year|30[- ]year|treasury) (yield|note)s?\b/i,
    flip: /\b(below|under|less than|lower than)\b/i,
    sectors: [S("Long Treasuries", "TLT", -1, []), S("Regional banks", "KRE", 1, ["USB", "PNC", "TFC"]), S("Homebuilders", "ITB", -1, ["DHI", "LEN", "PHM"]), S("Utilities", "XLU", -1, ["NEE", "DUK"])],
    factors: [F("Duration (rate sensitivity)", -1)],
  },
  {
    id: "tariffs-up", label: "New or higher tariffs", categories: ["tariffs", "politics", "economy", "world"],
    when: /\btariffs?\b|\bimport (tax|duties)\b|\bsection (232|301)\b|\btrade war\b/i,
    flip: /\b(below|under|less than|lower(ed)?|cut|reduce[sd]?|remove[sd]?|lift(ed)?|pause[sd]?|exempt(ion)?s?|trade deal|deal with|suspend(ed)?|struck down|strike down|unlawful|illegal)\b/i,
    sectors: [S("Retailers (importers)", "XRT", -1, ["WMT", "TGT", "BBY", "DG", "DLTR", "COST"]), S("Apparel and footwear", "", -1, ["NKE", "LULU", "DECK", "VFC"]),
      S("Autos", "CARZ", -1, ["GM", "F", "STLA", "TM"]), S("Domestic steel and aluminium", "SLX", 1, ["NUE", "STLD", "CLF", "AA"]), S("Farm exporters (retaliation)", "", -1, ["ADM", "BG", "DE"])],
    tickers: [T("AAPL", -1, "Assembles most iPhones in China and India")],
    factors: [F("Size (small over large)", 0), F("Momentum", 0)],
  },
  {
    id: "china-tariffs", label: "Tariffs on China", categories: ["tariffs", "politics", "world"],
    when: /\btariffs?\b[^.?]*\bchin(a|ese)\b|\bchin(a|ese)\b[^.?]*\btariffs?\b/i,
    flip: /\b(below|under|less than|lower(ed)?|cut|reduce[sd]?|remove[sd]?|lift(ed)?|pause[sd]?|trade deal|deal with|suspend(ed)?)\b/i,
    sectors: [S("China ADRs", "KWEB", -1, ["BABA", "PDD", "JD", "BIDU"]), S("Semiconductors", "SMH", -1, ["NVDA", "AMD", "QCOM", "AVGO"])],
    tickers: [T("TSLA", -1, "Large China sales and supply chain"), T("NKE", -1, "Sources heavily from Asia")],
    factors: [],
  },
  {
    id: "fda-approval", label: "An FDA approval", categories: ["corporate", "other"],
    when: /\bfda\b[^.?]*\b(approv|clear|authori[sz]|accept)|\b(approv|clear)\w*\b[^.?]*\bfda\b/i,
    flip: /\b(reject|complete response|crl|den(y|ied|ies)|delay|not approve)\b/i,
    sectors: [S("Biotech", "XBI", 0, [])], factors: [],
  },
  {
    id: "merger-blocked", label: "A merger challenged or blocked", categories: ["corporate", "politics"],
    when: /\b(ftc|doj|antitrust|competition (authority|commission)|cma|european commission)\b[^.?]*\b(sue|sues|block|blocks|challenge|challenges|lawsuit|oppose)\b|\b(block|blocks|challenge)\b[^.?]*\b(merger|acquisition|deal|takeover)\b/i,
    unless: /\b(approve|approves|clear|clears|close|closes|completed?)\b/i,
    sectors: [S("Merger arbitrage", "MNA", -1, [])], factors: [],
  },
  {
    id: "merger-closes", label: "A merger closing or approved", categories: ["corporate"],
    when: /\b(merger|acquisition|acquire|acquires|takeover|buyout|deal)\b[^.?]*\b(close|closes|complete[sd]?|approve[sd]?|clear(s|ed)?)\b|\b(approve[sd]?|clear(s|ed)?|complete[sd]?)\b[^.?]*\b(merger|acquisition|takeover|deal)\b/i,
    sectors: [S("Merger arbitrage", "MNA", 1, [])], factors: [],
  },
  {
    id: "gop-win", label: "Republicans winning control", categories: ["politics"],
    when: /\b(republicans?|gop)\b[^.?]*\b(win|wins|control|keep|hold|majority|flip)\b|\b(win|control|majority)\b[^.?]*\b(republicans?|gop)\b/i,
    unless: /\bdemocrat/i,
    sectors: [S("Energy", "XLE", 1, ["XOM", "CVX", "COP", "OXY"]), S("Defense", "ITA", 1, ["LMT", "NOC", "GD", "RTX"]), S("Banks", "XLF", 1, ["JPM", "BAC", "WFC"]),
      S("Clean energy", "ICLN", -1, ["ENPH", "FSLR", "SEDG", "RUN"]), S("Private prisons", "", 1, ["GEO", "CXW"])],
    factors: [F("Value over growth", 1), F("Size (small over large)", 1)],
  },
  {
    id: "dem-win", label: "Democrats winning control", categories: ["politics"],
    when: /\bdemocrats?\b[^.?]*\b(win|wins|control|keep|hold|majority|flip)\b|\b(win|control|majority)\b[^.?]*\bdemocrats?\b/i,
    unless: /\brepublican|\bgop\b/i,
    sectors: [S("Clean energy", "ICLN", 1, ["ENPH", "FSLR", "SEDG", "RUN"]), S("Managed care (exchanges)", "", 1, ["CNC", "MOH", "OSCR"]), S("Energy", "XLE", -1, ["XOM", "CVX", "COP"]),
      S("Defense", "ITA", -1, ["LMT", "NOC", "GD"]), S("Private prisons", "", -1, ["GEO", "CXW"])],
    factors: [F("Growth over value", 1)],
  },
  {
    id: "shutdown", label: "A government shutdown", categories: ["politics", "economy"],
    when: /\b(government )?shut ?down\b/i,
    sectors: [S("Government services contractors", "", -1, ["BAH", "LDOS", "SAIC", "CACI"]), S("Long Treasuries", "TLT", 1, [])], factors: [F("Market beta", -1)],
  },
  {
    id: "debt-default", label: "A US debt-ceiling breach", categories: ["politics", "economy"],
    when: /\bdebt (ceiling|limit)\b|\b(us|treasury) default\b|\bx[- ]date\b/i,
    flip: /\b(raise[sd]?|suspend(ed)?|deal|lift(ed)?|increase[sd]?)\b/i,
    sectors: [S("Short-dated Treasuries", "SHV", -1, []), S("Financials", "XLF", -1, ["JPM", "BAC"]), S("Gold", "GLD", 1, [])], factors: [F("Market beta", -1), F("Low volatility", 1)],
  },
  {
    id: "oil-up", label: "Higher oil prices", categories: ["energy", "world", "economy"],
    when: /\b(oil|wti|brent|crude)\b|\bopec\b[^.?]*\b(cut|reduce)/i,
    flip: /\b(below|under|less than|lower than|fall|drop)\b|\bopec\b[^.?]*\b(increase|raise|boost)/i,
    sectors: [S("Energy", "XLE", 1, ["XOM", "CVX", "COP", "OXY"]), S("Airlines", "JETS", -1, ["DAL", "UAL", "AAL", "LUV"]), S("Cruise lines", "", -1, ["CCL", "RCL", "NCLH"])],
    factors: [F("Value over growth", 1)],
  },
  {
    id: "bitcoin-up", label: "A higher bitcoin price", categories: ["crypto"],
    when: /\bbitcoin\b|\bbtc\b/i,
    flip: /\b(below|under|less than|lower than|fall|drop|dip)\b/i,
    sectors: [S("Bitcoin ETFs", "IBIT", 1, []), S("Crypto equities", "", 1, ["COIN", "MSTR", "MARA", "RIOT", "HOOD", "CLSK"])], factors: [F("Momentum", 1)],
  },
  {
    id: "ether-up", label: "A higher ether price", categories: ["crypto"],
    when: /\bethereum\b|\beth\b|\bether\b/i,
    flip: /\b(below|under|less than|lower than|fall|drop|dip)\b/i,
    sectors: [S("Ether ETFs", "ETHA", 1, []), S("Crypto equities", "", 1, ["COIN", "HOOD"])], factors: [],
  },
  {
    id: "taiwan", label: "A China–Taiwan conflict", categories: ["world", "politics"],
    when: /\b(china|chinese)\b[^.?]*\b(invade|invasion|blockade|attack)\b[^.?]*\btaiwan\b|\btaiwan\b[^.?]*\b(invasion|blockade)\b/i,
    sectors: [S("Semiconductors", "SMH", -1, ["TSM", "NVDA", "AMD", "AAPL", "QCOM"]), S("Defense", "ITA", 1, ["LMT", "NOC", "RTX", "GD"])], factors: [F("Market beta", -1)],
  },
  {
    id: "mideast", label: "A wider Middle East war", categories: ["world"],
    when: /\b(iran|israel|hezbollah|strait of hormuz)\b[^.?]*\b(war|strike|attack|invade|close|closure)\b/i,
    unless: /\bceasefire|peace\b/i,
    sectors: [S("Energy", "XLE", 1, ["XOM", "CVX", "OXY"]), S("Defense", "ITA", 1, ["LMT", "NOC", "RTX"]), S("Airlines", "JETS", -1, ["DAL", "UAL"])], factors: [F("Market beta", -1)],
  },
  {
    id: "ceasefire", label: "A ceasefire or peace deal", categories: ["world"],
    when: /\b(ceasefire|peace (deal|agreement|talks))\b/i,
    sectors: [S("Defense", "ITA", -1, ["LMT", "NOC", "RTX", "GD"]), S("Energy", "XLE", -1, ["XOM", "CVX"]), S("Europe", "VGK", 1, [])], factors: [F("Market beta", 1)],
  },
  {
    id: "hurricane", label: "A damaging hurricane", categories: ["climate"],
    when: /\bhurricane\b|\bcategory [345]\b|\blandfall\b/i,
    sectors: [S("Property insurers", "KIE", -1, ["ALL", "TRV", "PGR", "CB"]), S("Home improvement", "", 1, ["HD", "LOW"])], factors: [],
  },
];

/* ---------------- Company questions ---------------- */

/** How a question about a named company moves it if YES. */
function companyDir(text: string): { dir: Dir; why: string } {
  const t = text.toLowerCase();
  if (/\b(fda|approv|clear(ed|ance)?)\b/.test(t) && !/\b(reject|crl|complete response|den(y|ied))\b/.test(t)) return { dir: 1, why: "An approval adds to the company's expected revenue" };
  if (/\b(reject|crl|complete response|den(y|ied)|recall|bankrupt|chapter 11|delist|layoffs?|fined?|probe|investigation|indict|sued|lawsuit)\b/.test(t)) return { dir: -1, why: "A setback the market prices against the company" };
  if (/\b(block|blocks|challenge|sue|sues)\b/.test(t) && /\b(merger|acquisition|deal|takeover)\b/.test(t)) return { dir: -1, why: "A blocked deal removes the takeover premium (for the target)" };
  if (/\b(beat|beats|above|exceed|exceeds|higher than|top|tops|surpass|largest|biggest|record|all[- ]time high|ath)\b/.test(t) && !/\b(below|under|miss|misses|less than)\b/.test(t)) return { dir: 1, why: "Resolves yes on strength in the company's own numbers or price" };
  if (/\b(miss|misses|below|under|less than|fall|drop)\b/.test(t)) return { dir: -1, why: "Resolves yes on weakness in the company's own numbers or price" };
  if (/\b(merger|acquisition|acquire|acquires|takeover|buyout)\b/.test(t)) return { dir: 0, why: "Party to the deal: the target usually rises, the acquirer can fall" };
  if (/\b(ipo|split|buyback|dividend|launch|release|announce)\b/.test(t)) return { dir: 1, why: "A company event in the question" };
  return { dir: 0, why: "Named in the question" };
}

/** The whole mapping for a market: explicit names, then themes. Pure. */
export function mapMarket(m: Pick<Market, "title" | "outcome" | "question" | "category">): Mapping {
  const text = [m.title, m.outcome, m.question].filter(Boolean).join(". ");
  const tickers = new Map<string, TickerLink>();
  const sectors = new Map<string, SectorLink>();
  const factors = new Map<string, FactorLink>();
  const rules: string[] = [];
  const named = explicitTickers(text);
  if (named.length) {
    const d = companyDir(text);
    for (const n of named) tickers.set(n.ticker, { ticker: n.ticker, dir: n.note ? 0 : d.dir, why: n.note ?? `${d.why} (${n.name} is named)`, source: "explicit" });
  }
  for (const r of RULES) {
    if (r.categories && !r.categories.includes(m.category)) continue;
    if (!r.when.test(text) || (r.unless && r.unless.test(text))) continue;
    const sign = (r.flip && r.flip.test(text) ? -1 : 1) as 1 | -1;
    const s = (d: Dir) => (d * sign || 0) as Dir;
    rules.push(sign === 1 ? r.label : `The opposite of ${r.label.charAt(0).toLowerCase()}${r.label.slice(1)}`);
    for (const x of r.sectors) if (!sectors.has(x.name)) sectors.set(x.name, { ...x, dir: s(x.dir) });
    for (const x of r.factors) if (!factors.has(x.name)) factors.set(x.name, { ...x, dir: s(x.dir) });
    for (const x of r.tickers ?? []) if (!tickers.has(x.ticker)) tickers.set(x.ticker, { ...x, dir: s(x.dir) });
  }
  return { tickers: [...tickers.values()], sectors: [...sectors.values()], factors: [...factors.values()], rules, source: "rules" };
}

/** Every ticker a mapping touches (named, or a member of a sector it moves) with its direction. Pure. */
export function touched(map: Mapping): Map<string, { dir: Dir; why: string; via: string }> {
  const out = new Map<string, { dir: Dir; why: string; via: string }>();
  for (const t of map.tickers) out.set(t.ticker, { dir: t.dir, why: t.why, via: t.source === "explicit" ? "named in the question" : t.source === "ai" ? "suggested by the AI" : "rule" });
  for (const s of map.sectors) {
    if (s.etf && validTicker(s.etf) && !out.has(s.etf)) out.set(s.etf, { dir: s.dir, why: `${s.name} ETF`, via: s.name });
    for (const t of s.members) if (!out.has(t)) out.set(t, { dir: s.dir, why: s.name, via: s.name });
  }
  return out;
}

/** Merge a model's suggestions into the rules' mapping: rules win on any ticker both name; bad tickers drop. Pure. */
export function mergeAi(base: Mapping, ai: { ticker: string; direction: "up" | "down" | "mixed"; why: string }[]): Mapping {
  const have = new Set(touched(base).keys());
  const extra: TickerLink[] = [];
  for (const x of ai.slice(0, 8)) {
    const t = validTicker(x.ticker);
    if (!t || have.has(t) || extra.some((e) => e.ticker === t)) continue;
    extra.push({ ticker: t, dir: x.direction === "up" ? 1 : x.direction === "down" ? -1 : 0, why: String(x.why ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || "Suggested by the AI", source: "ai" });
  }
  return extra.length ? { ...base, tickers: [...base.tickers, ...extra], source: "rules+ai" } : base;
}
