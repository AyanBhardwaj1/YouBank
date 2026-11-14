/**
 * Prediction markets (docs/prediction-markets.md): the shapes every venue is normalised into. Pure data,
 * safe to import on the client.
 *
 * A market is one binary question (yes or no). A venue's multi-outcome event (who wins, which band CPI lands
 * in) becomes one market per outcome, each with its own yes price, as the venues themselves list them.
 * Prices are the yes side's price in dollars per $1 contract, which is the market's implied probability
 * (before fees, and without adjusting for the favourite-longshot bias).
 */

export type Venue = "kalshi" | "polymarket" | "gemini" | "manifold";
export const VENUES: Venue[] = ["kalshi", "polymarket", "gemini", "manifold"];
export const VENUE_LABEL: Record<Venue, string> = { kalshi: "Kalshi", polymarket: "Polymarket", gemini: "Gemini", manifold: "Manifold" };
/** What each venue is, in one line, for the filters and the detail page. */
export const VENUE_NOTE: Record<Venue, string> = {
  kalshi: "CFTC-regulated exchange (US).",
  polymarket: "Crypto-settled order book (international; a separate CFTC-regulated US venue exists).",
  gemini: "Gemini Predictions, CFTC-regulated event contracts.",
  manifold: "Play money: a calibration reference, not a tradable price.",
};

export type Category = "fed" | "economy" | "politics" | "tariffs" | "corporate" | "crypto" | "tech" | "energy" | "world" | "climate" | "culture" | "sports" | "other";
export const CATEGORIES: Category[] = ["fed", "economy", "politics", "tariffs", "corporate", "crypto", "tech", "energy", "world", "climate", "culture", "sports", "other"];
export const CATEGORY_LABEL: Record<Category, string> = {
  fed: "Fed and rates", economy: "Economy", politics: "Politics", tariffs: "Trade and tariffs", corporate: "Companies and deals", crypto: "Crypto",
  tech: "Tech and AI", energy: "Energy", world: "World", climate: "Weather and climate", culture: "Culture", sports: "Sports", other: "Other",
};

export type MarketStatus = "open" | "closed" | "resolved";

export type Market = {
  /** `venue:id`, stable across fetches: the key the app stores (watches, forecasts). */
  key: string;
  venue: Venue;
  /** The venue's own id for the market (Kalshi ticker, Polymarket market id, Gemini instrument symbol, Manifold id). */
  id: string;
  /** The event it belongs to on the venue (Kalshi event ticker, Polymarket event id). */
  eventId: string;
  /** The event's title. */
  title: string;
  /** For a multi-outcome event, which outcome this market is ("25 bps cut", "Above 3.0%"); empty for a single question. */
  outcome: string;
  /** The market's own question as the venue words it (often the clearest statement of what resolves it). */
  question: string;
  category: Category;
  /** Yes price = implied probability, 0 to 1; null when the venue has no price yet. */
  prob: number | null;
  /** Change in the yes price over the last 24 hours, in probability (0.05 = 5 points). Null when unknown. */
  change24h: number | null;
  /** Best yes bid and ask (0 to 1), when the venue gives them. */
  bid: number | null;
  ask: number | null;
  /** Traded in the last 24 hours, in US dollars (Kalshi contracts are converted at the yes price). */
  volume24h: number | null;
  /** Traded since listing, in US dollars. */
  volume: number | null;
  /** Resting liquidity in US dollars, when the venue reports it. */
  liquidity: number | null;
  /** Open interest in contracts ($1 each at settlement), when the venue reports it. */
  openInterest: number | null;
  /** When trading closes (ISO), when known. */
  closeTime: string | null;
  status: MarketStatus;
  /** Once resolved: how. */
  result: "yes" | "no" | null;
  /** Where to trade it, on the venue. */
  url: string;
  /** The resolution rules, as the venue writes them (trimmed). */
  rules: string;
  /** Whether the price is real money (false for Manifold's play money). */
  realMoney: boolean;
  /** Venue-specific ids needed for history and the order book. */
  seriesId?: string;
  tokenId?: string;
};

export type PricePoint = { t: number; p: number };
/** An order book on the yes side: price and size (contracts or shares), best first. */
export type Book = { bids: [number, number][]; asks: [number, number][] };

/** What the page shows when a venue could not be read. */
export type VenueState = { venue: Venue; ok: boolean; count: number; stale: boolean; fetchedAt: string | null };

/** One line under every screen of the feature. */
export const DISCLAIMER = "Information, not advice. Prices are what traders on each venue pay for a $1 contract, not YouBank's forecast; YouBank does not place trades.";
