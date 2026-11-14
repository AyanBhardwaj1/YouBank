/**
 * One category scheme across venues. Each venue labels its markets its own way (Kalshi's series category,
 * Polymarket's event tags, Gemini's category, Manifold's groups); the title decides when the label is
 * missing or too broad ("Economics" holds both the Fed and CPI). Pure.
 */
import type { Category } from "./types";

/** The title's words first: specific beats broad. Order matters (a Fed market mentions the economy). */
const BY_TITLE: [RegExp, Category][] = [
  [/\b(fed|fomc|federal reserve|rate (cut|hike)s?|interest rates?|fed funds|powell|warsh|basis points|bps)\b/i, "fed"],
  [/\b(tariffs?|trade (deal|war)|import (tax|duties)|export controls?|section 232|section 301|reciprocal)\b/i, "tariffs"],
  [/\b(cpi|inflation|pce|gdp|recession|unemployment|jobless|payrolls|nonfarm|jobs report|treasury yields?|10-year|debt ceiling|shutdown|deficit|housing starts)\b/i, "economy"],
  [/\b(fda|approv(al|e|ed)|merger|acquisition|acquire|acquires|ftc|antitrust|doj sues|earnings|eps|revenue|ipo|bankrupt|ceo|layoffs|buyback|stock split|market cap)\b/i, "corporate"],
  [/\b(bitcoin|btc|ethereum|eth|solana|crypto|stablecoin|xrp|dogecoin)\b/i, "crypto"],
  [/\b(oil|wti|brent|opec|gas prices?|natural gas|gasoline)\b/i, "energy"],
  [/\b(openai|chatgpt|anthropic|gemini 3|gpt-\d|ai model|nvidia|apple|google|tesla|spacex|semiconductor|chips?)\b/i, "tech"],
  [/\b(election|president|presidential|senate|house|congress|governor|mayor|primary|nominee|democrat|republican|gop|impeach|supreme court|cabinet|approval rating|parliament|prime minister)\b/i, "politics"],
  [/\b(war|ceasefire|invasion|nato|ukraine|russia|china|taiwan|israel|iran|gaza|sanctions)\b/i, "world"],
  [/\b(hurricane|temperature|snow|rain|heat|climate|weather|earthquake)\b/i, "climate"],
  [/\b(nfl|nba|mlb|nhl|super bowl|world series|world cup|champions league|premier league|ufc|tennis|golf|f1|formula 1|olympics|match|game \d|vs\.?)\b/i, "sports"],
  [/\b(oscar|grammy|emmy|box office|album|movie|tv show|spotify|taylor swift|time person of the year)\b/i, "culture"],
];

/** Venue labels, lower-cased, to ours. */
const BY_LABEL: [RegExp, Category][] = [
  [/^(fed|federal reserve|interest rates?|rates)$/, "fed"],
  [/(econom|financial|inflation|macro|jobs)/, "economy"],
  [/(trade|tariff)/, "tariffs"],
  [/(compan|business|earnings|finance|stocks?|mergers?)/, "corporate"],
  [/(crypto|bitcoin|ethereum)/, "crypto"],
  [/(tech|science|ai)/, "tech"],
  [/(energy|commodit|oil)/, "energy"],
  [/(politic|election|elections|government|congress|world elections)/, "politics"],
  [/(world|geopolitic|global)/, "world"],
  [/(climate|weather)/, "climate"],
  [/(sport|nfl|nba|mlb|nhl|soccer|football|basketball|baseball|hockey|tennis|golf|mma)/, "sports"],
  [/(culture|entertainment|pop|music|movies|awards|mentions|social)/, "culture"],
];

/** The category for a market: its title when the title is specific, else the venue's label(s), else other. */
export function categorize(title: string, labels: (string | null | undefined)[] = []): Category {
  for (const [re, c] of BY_TITLE.slice(0, 4)) if (re.test(title)) return c;
  for (const raw of labels) {
    const l = (raw ?? "").trim().toLowerCase();
    if (!l) continue;
    for (const [re, c] of BY_LABEL) if (re.test(l)) return c;
  }
  for (const [re, c] of BY_TITLE.slice(4)) if (re.test(title)) return c;
  return "other";
}

/** Categories a fund reads as macro or company risk (the default view leaves sports and culture out). */
export const FINANCE_CATEGORIES: Category[] = ["fed", "economy", "tariffs", "corporate", "politics", "crypto", "tech", "energy", "world"];
