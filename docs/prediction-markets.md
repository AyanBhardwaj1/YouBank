# Prediction markets

The **Prediction markets** tab (`/app/predict`) reads event contracts on Kalshi, Polymarket and Gemini Predictions (with Manifold as a play-money calibration reference), normalises them into one list, and connects them to the rest of YouBank: the Book (event exposure), Quant (signals), Edge and Home (`predictSignalsFor`), alerts and calibration. It never trades. Every screen links to the venue and carries one line: *Information, not advice.*

Code: `src/lib/predict/**`, `src/app/app/predict/**`, `src/app/api/predict/**`, `src/components/predict/**`, `src/lib/quant/adapters/predict.ts`. Tests: `scripts/test-predict.ts` with fixtures in `scripts/fixtures/predict/`.

## 1. Why a fund looks at these prices

A yes/no contract that pays $1 trades at the market's implied probability of the event. For a fund this is useful in five ways:

- **Event-risk hedging.** A rate-sensitive book can hedge a specific FOMC outcome, a CPI print or an election result with a contract that pays on exactly that outcome. This is cleaner than a futures or options proxy with basis risk. Kalshi said its institutional volume rose about 800% in six months to May 2026.
- **Implied probabilities as macro and factor signals.** Kalshi's Fed and CPI markets are continuous, distribution-rich forecasts. The Federal Reserve Board's FEDS 2026-010 paper ("Kalshi and the Rise of Macro Markets", Diercks, Katz and Wright) finds them competitive with fed funds futures and surveys, with noisier tails in thin markets. A 24-hour move in "Fed cuts in December" is a direct read on the rates factor that drives homebuilders, REITs, utilities and small caps.
- **Event studies.** Snowberg, Wolfers and Zitzewitz used election-market prices to measure which sectors move with a party's chances. Treating the probability change as the shock, rather than the result day, is the textbook method. The same applies to tariffs, merger approvals (FTC or DOJ challenges and the deal spread), FDA decisions and earnings.
- **Cross-venue disagreement.** The same question can trade at different prices on Kalshi, Polymarket and Gemini. The gap is information about who is trading and where. It is not free money: rules, settlement sources and deadlines can differ, money is tied up until settlement, and moving it between a US-regulated exchange and a crypto venue costs more than the fees.
- **Time decay and calibration.** A binary contract's price converges to 0 or 1 as the event approaches. Its volatility is highest when the outcome is most uncertain (near 50%) and close to resolution. Long-dated markets show a favourite-longshot bias, so cheap contracts are overpriced (Page and Clemen 2013; Rothschild and Sethi). Prices near expiry are better calibrated. YouBank shows days to close and annualises any spread over the time the capital is tied up.

Sports are the largest share of volume on both big venues, but the default view leaves them out and shows macro, policy, company, crypto, tech, energy and world markets.

## 2. Venues, endpoints, auth and caching

All reads are public market data. No API keys or accounts are needed, and nothing is sent to the venues except plain GETs. Every read uses `fetchRetry` (src/lib/net.ts) with an 8 s timeout per attempt, one retry, and a cap on total time. Results go into the shared cache (src/lib/cache.ts) with stale-while-revalidate and **stale-if-error for a week**: when a venue is down, its last good snapshot answers, flagged with its time. A venue that has never answered is listed as unavailable. `loadMarkets()` never throws, and the page shows a note instead of an error.

| Venue | Endpoint | Auth | Fresh for |
|---|---|---|---|
| Kalshi | `GET https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=200` (3 pages) | none | 3 min |
| Kalshi | `GET …/markets/{ticker}` | none | 2 min |
| Kalshi | `GET …/series/{series}/markets/{ticker}/candlesticks?start_ts&end_ts&period_interval=60|1440` | none | 10 min |
| Kalshi | `GET …/markets/{ticker}/orderbook?depth=10` | the official SDK marks it signed; tried unsigned, falls back to the market's best bid and ask | 30 s |
| Polymarket | `GET https://gamma-api.polymarket.com/events?active=true&closed=false&archived=false&order=volume24hr&ascending=false&limit=100&offset=0,100` | none | 3 min |
| Polymarket | `GET https://gamma-api.polymarket.com/markets/{id}` | none | 2 min |
| Polymarket | `GET https://clob.polymarket.com/prices-history?market={yes token}&startTs&endTs&fidelity=60|360|1440` | none | 10 min |
| Polymarket | `GET https://clob.polymarket.com/book?token_id={yes token}` | none | 30 s |
| Gemini | `GET https://api.gemini.com/v1/prediction-markets/events?status=active&limit=100` | none for market data | 5 min |
| Gemini | `GET https://api.gemini.com/v1/prediction-markets/events/{eventTicker}` | none | 2 min |
| Manifold | `GET https://api.manifold.markets/v0/search-markets?term=&filter=open&contractType=BINARY&sort=liquidity&limit=200` | none | 10 min |
| Manifold | `GET https://api.manifold.markets/v0/market/{id}` | none | 2 min |

Each venue's list is capped at the 1,500 most-traded markets, with rules cut to a preview, so the cached row stays well under the cache's 3 MB row limit. The detail page reads the market itself for the full rules.

**Normalisation** (`normalize.ts`): one `Market` shape with key `venue:id`, title, outcome, question, category, yes price as probability, 24h change, bid and ask, 24h and total volume in USD, liquidity, open interest, close time, status, result, rules and URL.
- **Kalshi.** Prices are fixed-point dollar strings and counts are fixed-point contract strings. The 24h change is `last_price − previous_price`. Contract volume is converted to dollars at the yes price.
- **Polymarket.** `outcomes`, `outcomePrices` and `clobTokenIds` are JSON strings. Only binary markets are read, and the first outcome is the yes side. A closed market priced at 1/0 is resolved.
- **Gemini.** One market per contract, keyed by `instrumentSymbol`, with prices from `contract.prices.bestBid/bestAsk/lastTradePrice`. The parser accepts the documented field-name variants, because the sample could not be captured live (see section 9).
- **Manifold.** Binary markets only, marked play money. They are never part of a spread, a signal or an exposure.

## 3. Matching the same event across venues (`match.ts`)

The matcher is deliberately conservative. Two markets are rejected outright when:
- their thresholds differ (2.9% is not 3.0%; "$100k" equals "$100,000"; a day of the month is a date, not a threshold);
- their outcome words differ (cut, hike, hold, above, below);
- they name different years or months;
- each names a person or company the other does not mention (Newsom is not Shapiro);
- they close more than 90 days apart;
- their categories are incompatible.

Otherwise the confidence starts from the overlap of the remaining words. Agreeing thresholds, outcomes, years and months add to it. A detail on only one side, or closing dates more than 2 or 14 days apart, takes from it, and each deduction is listed as a reason ("they close 59 days apart, so the windows differ"). A pair is shown at 60% confidence or more, one to one per venue pair, most confident first.

## 4. Spreads net of fees (`spread.ts`)

Buying yes on venue A at its ask and no on venue B (cost `1 − B's yes bid`) pays $1 whichever way it resolves, if both venues resolve the same way. The gross edge is `B's yes bid − A's yes ask`. Fees come off that, and the better of the two directions is shown. Without real quotes, mids stand in and the figure is marked rough. A positive net is also annualised over the time to the later close.

Taker fees per $1 contract at price p (check each venue's schedule before relying on them):
- **Kalshi:** `0.07 × p × (1 − p)`, rounded up to the cent per order (computed on 100 contracts).
- **Polymarket:** `0.04 × p × (1 − p)`. This is conservative: many markets charge nothing, and the category rates introduced in March 2026 are at or below it.
- **Gemini:** Kalshi's formula stands in, because Gemini's per-contract amount could not be confirmed.

The screen says plainly that this is not risk-free arbitrage.

## 5. From events to stocks (`mapping.ts`, `ai-map.ts`)

The mapping uses rules first. Every link can be read and is tested.

- **Explicit names:** `$NVDA`, `(NVDA)`, `NASDAQ: NVDA`, or a company in the name table (about 120 names; private companies map to their main listed backer and are marked mixed). Upper-case words that are not tickers (CPI, GDP, FED, AI, ETF and others) are refused. The question decides the sign: an approval or a beat is up, a rejection, block or miss is down, and a deal is mixed for the parties.
- **Themes:** about 25 rules. Each gives sectors (with an ETF and member tickers), factors and named tickers, and the sign each has had if the question resolves yes. Phrasing on the other side ("below", "trade deal lowering tariffs", "debt ceiling raised") flips every sign.
  - **Fed:** cut, hike or hold, which moves homebuilders, REITs, utilities, small caps, long Treasuries, banks (mixed) and the dollar, plus the duration, size and growth factors.
  - **Economic data:** CPI and inflation, recession, weak or strong jobs and GDP, and Treasury yields.
  - **Trade:** tariffs (importers, retailers, apparel, autos, domestic steel, farm exporters, Apple) and China tariffs (China ADRs, semiconductors).
  - **Companies:** FDA approval, a merger challenged or blocked, and a merger closing.
  - **Politics:** Republican or Democratic control (energy, defense, banks, clean energy, managed care, private prisons), a government shutdown, and the debt ceiling.
  - **Prices:** oil, bitcoin and ether.
  - **Geopolitics and weather:** a China–Taiwan conflict, a Middle East war, a ceasefire, and hurricanes.
- **AI (optional, `predict.ai-map`, Pro):** up to eight further tickers from the small model through `structured()` in src/lib/ai/agent.ts. That function checks the person's AI budget and records the spend in the usage ledger as that person. Suggestions are checked (valid tickers, not already linked) and merged without overriding a rule. They are cached per market for a week and limited to 30 a day. On any failure the rules' mapping stands and the page says so.

The signs are textbook sensitivities, not estimates of size.

## 6. Integration with the rest of the app

- **Book: event exposure** (`exposure.ts bookExposure`, `/api/predict/exposure`, the Event exposure tab, and a "Your book" card on each market). For each open market, it shows which positions it touches and whether yes helps, hurts or moves each one either way (a long helped by an up-move, a short by a down-move), with the book weight on each side.
- **Quant: signals in the QuantSignal contract** (`src/lib/quant/adapters/predict.ts`).
  - `predict.prob` is a `probability` signal on each mapped stock or ETF: p is the venue's price, the interval is its bid and ask, the base rate is the price a day earlier, and the question says it is the event's probability, not the stock's return.
  - `predict.moves` is a cross-sectional `score`: the z-score, clipped to ±3, of Σ direction × 24h move over the markets touching each name. It needs at least five names and three markets.
  - Both are uncalibrated (`method: "none"`). They are published by the quant nightly and by `/api/predict/cron`, and validated by `validateSignal`.
- **Edge and Home: `predictSignalsFor`.** This is a pure function, so it can be called with any list of markets:

  ```ts
  import { predictSignalsFor } from "@/lib/predict/exposure";   // pure: pass the markets
  import { loadPredictSignals } from "@/lib/predict/store";     // server: loads today's markets, never throws
  const byTicker = await loadPredictSignals(["JPM", "NVDA"]);    // { JPM: TickerEvent[], NVDA: TickerEvent[] }
  // TickerEvent: { ticker, key, venue, label, url, prob, change24h, closeTime, dir (1|-1|0), why, via, pressure, volume24h }
  ```
  Each ticker gets at most five events (configurable): named-in-the-question links first, then the biggest 24h move and volume. The same question listed on two venues counts once. Over HTTP: `GET /api/predict/signals?tickers=JPM,NVDA`.
- **Alerts** (`watch.ts`, `watch-rules.ts`). A person watches a market with a threshold of 3, 5, 10, 15 or 20 points. The watch keeps the price last alerted on. When the market moves the threshold from there, a row goes into the bell (`news_notifications`, unique per person and key) and `deliverAlert` sends it to the person's channels with their quiet hours, the same path as the Book's alerts. A slow drift alerts once per threshold, and a swing inside the band never alerts. A resolution alerts once. Free plans can watch five markets; `predict.watch-pro` raises that to 100.
- **Calibration** (`watch-rules.ts`, `watch.ts`). A person records a paper forecast (1–99%) on an open market: one per market a day, closed an hour before the market. A forecast can be removed only on the day it was made. When the market resolves, the forecast is scored with the Brier score `(p − outcome)²`, beside the market's own price at that moment. The Book's `calibration()` and `calibrationLine()` from src/lib/book/forecast.ts produce the table and the line, with "You" and "Market price" as sources.
- **MCP** (`mcp-tools.ts`, registered in src/lib/mcp/server.ts). There are two read-only tools: `prediction_markets_search` and `prediction_event_exposure`. Each answer cites the venue page.

## 7. Plans

Browsing, detail, spreads, the rule mapping, exposure, five watches, forecasts and the MCP tools are **free**: they read free public data through a shared cache. Two features are in `src/lib/billing/features/predict.ts`:
- `predict.watch-pro` (Pro): up to 100 watches. It is a perk with no cost of its own.
- `predict.ai-map` (Pro): the metered AI mapping, which counts against the person's AI allowance.

## 8. Operations

- **Migration `drizzle/0037_predict.sql`** adds the `predict_watches` and `predict_forecasts` tables. It is idempotent, embedded by `scripts/gen-migrations.mts`, applied by the app itself, and checked by `src/lib/setup.ts`.
- **Cron:** `/api/predict/cron` uses the `CRON_SECRET` or `AUTOPILOT_SECRET` bearer token. It checks watches, scores resolved forecasts and publishes signals. To run it hourly, add `{ "path": "/api/predict/cron", "schedule": "7 * * * *" }` to `vercel.json`. The quant nightly (inline and Inngest) also runs the pass and the signals once a day.
- **Rate limits:**

  | Request | Limit |
  |---|---|
  | List | 600 an hour |
  | Detail, spreads, exposure | 240 an hour each |
  | Signals | 300 an hour |
  | Watch changes | 120 an hour |
  | Forecasts | 100 a day |
  | AI mapping | 30 a day |

  Requests that change something must come from YouBank's own pages (`Sec-Fetch-Site`).
- **Environment variables:** none.

## 9. What is verified, and what is not

- The sandbox this was built in could not reach any venue host. The proxy refused api.elections.kalshi.com, gamma-api.polymarket.com, clob.polymarket.com, api.gemini.com, api.manifold.markets, and the doc mirrors. So:
  - The fixtures are synthetic samples shaped to each venue's documented schema, and `SOURCES.json` says so. Kalshi's schema comes from its official SDK (`kalshi-typescript@3.11.0`, generated from Kalshi's OpenAPI spec). Polymarket's comes from its documentation. **Gemini's is reconstructed from its documentation and is the least certain.**
  - Run `pnpm exec tsx scripts/test-predict.ts --live` once the hosts are reachable to check the parsers on live answers. Replace the fixtures with captured ones.
- The fees for Polymarket and Gemini, and Gemini's link format (`https://www.gemini.com/predictions/{eventTicker}`), are unconfirmed.
- Kalshi's order book may require a signed request. The detail page then shows the best bid and ask.
