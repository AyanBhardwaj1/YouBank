/**
 * Prediction markets for the person's own AI apps (src/lib/mcp/server.ts): two read-only tools. Each answer
 * cites the venue page it came from, says how fresh it is, and carries the one-line disclaimer.
 */
import { z } from "zod";
import { def } from "@/lib/ai/tools";
import { siteLink } from "@/lib/site";
import { predictSignalsFor } from "./exposure";
import { marketLabel } from "./normalize";
import { filterMarkets, DEFAULT_FILTERS } from "./query";
import { loadMarkets } from "./store";
import { CATEGORIES, DISCLAIMER, VENUE_LABEL, VENUES, type Category, type Venue } from "./types";

const pct = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

export const predictSearchTool = def({
  name: "prediction_markets_search",
  description: "Search open prediction markets on Kalshi, Polymarket, Gemini and Manifold (play money). Returns each market's implied probability (its yes price, in %), 24-hour change in points, 24-hour volume in USD, close time and a link to the venue. Use for 'what are the odds of a Fed cut', 'markets on tariffs', 'what is Polymarket pricing for X'. Information, not advice.",
  schema: z.object({
    query: z.string().max(80).default("").describe("Words to search in titles, e.g. 'fed december' or 'tariff china'"),
    category: z.enum(["all", "finance", ...CATEGORIES] as [string, ...string[]]).default("finance").describe("finance (default: macro, policy, companies, crypto, tech, energy, world), all, or one category"),
    venue: z.enum(VENUES as [string, ...string[]]).optional(),
    sort: z.enum(["volume", "change", "closing", "prob"]).default("volume"),
    limit: z.number().int().min(1).max(25).default(10),
  }),
  run: async ({ query, category, venue, sort, limit }, ctx) => {
    const { markets, venues } = await loadMarkets();
    const list = filterMarkets(markets, { ...DEFAULT_FILTERS, q: query, cat: category as Category | "finance" | "all", venues: venue ? [venue as Venue] : [], sort }).slice(0, limit);
    return JSON.stringify({
      markets: list.map((m) => ({
        market: marketLabel(m), venue: VENUE_LABEL[m.venue], probability_pct: pct(m.prob), change_24h_pts: m.change24h === null ? null : Math.round(m.change24h * 1000) / 10,
        volume_24h_usd: m.volume24h, closes: m.closeTime, play_money: !m.realMoney, source: ctx.addSource(`${VENUE_LABEL[m.venue]}: ${marketLabel(m)}`.slice(0, 200), m.url),
        youbank: siteLink(`/app/predict?market=${encodeURIComponent(m.key)}`),
      })),
      venues_unavailable: venues.filter((v) => !v.ok).map((v) => VENUE_LABEL[v.venue]),
      stale: venues.filter((v) => v.stale).map((v) => VENUE_LABEL[v.venue]),
      note: list.length ? DISCLAIMER : `No open markets match. ${DISCLAIMER}`,
    });
  },
});

export const predictExposureTool = def({
  name: "prediction_event_exposure",
  description: "For a list of tickers, the open prediction markets whose outcome historically moves each one (named in the question, or through a rule such as a Fed cut moving homebuilders and REITs, tariffs moving importers, an FDA decision moving the company), with the market's probability, its 24-hour move, and which way the stock has tended to move if the event happens (up, down or mixed). Rules-based and explainable; not a forecast of the stock. Information, not advice.",
  schema: z.object({ tickers: z.array(z.string().min(1).max(12)).min(1).max(25), per_ticker: z.number().int().min(1).max(10).default(5) }),
  run: async ({ tickers, per_ticker }, ctx) => {
    const { markets } = await loadMarkets(["kalshi", "polymarket", "gemini"]);
    const by = predictSignalsFor(tickers, markets, { perTicker: per_ticker });
    const word = { 1: "up", [-1]: "down", 0: "mixed" } as Record<number, string>;
    return JSON.stringify({
      exposure: Object.fromEntries(Object.entries(by).map(([t, es]) => [t, es.map((e) => ({
        market: e.label, venue: VENUE_LABEL[e.venue], probability_pct: pct(e.prob), change_24h_pts: e.change24h === null ? null : Math.round(e.change24h * 1000) / 10,
        if_yes_stock_tends_to_move: word[e.dir], why: e.why, link: e.via, closes: e.closeTime, source: ctx.addSource(`${VENUE_LABEL[e.venue]}: ${e.label}`.slice(0, 200), e.url),
      }))])),
      note: `${DISCLAIMER} Directions are the historical sensitivities the rules encode, not estimates of size.`,
    });
  },
});
