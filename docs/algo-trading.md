# Algo trading: rule-based and agentic trading on a person's own broker account

The owner asked for "agentic and algorithmic trading … connected to a Webull or Robinhood to trade for you".
This page is the research behind what was built, the design, and the list counsel must review before any
real money moves on its own. Research checked on 15 October 2026 by web search; the broker and regulator
pages themselves could not be fetched from the build environment (the proxy refused the hosts), so every
broker fact below cites the page the search surfaced and should be confirmed on that page before launch.

**The short version.**
- **Webull:** an official OpenAPI exists. Individuals apply (reviewed in one to two working days), then
  generate an App Key and Secret to trade *their own* account. Third-party platforms like YouBank use the
  separate **Connect API** (OAuth 2.0, PKCE, registration through Webull's application form). Webull US also
  trades through SnapTrade, which works today.
- **Robinhood:** the only public developer API is the **Crypto Trading API** (crypto only). For stocks and
  options there is no REST API for third-party apps. Since May 2026 Robinhood offers **Agentic Trading**:
  a person connects *their own* AI agent (Claude, ChatGPT, Codex…) to Robinhood's Trading MCP server
  (`agent.robinhood.com/mcp/trading`) with OAuth, and the agent may trade only a separately funded
  "Agentic account". That is a consumer feature for a person's own agent, not an API for apps like YouBank.
  SnapTrade lists Robinhood as read-only. Unofficial reverse-engineered APIs break Robinhood's terms and are
  not used.
- **Built:** a broker layer with five adapters (paper, Alpaca, SnapTrade, Webull, Robinhood Crypto), a
  declarative strategy engine with eight template families plus Quant's signals and targets, an
  event-driven point-in-time backtester with walk-forward, deflated Sharpe and PBO, execution with limit
  bands, TWAP and idempotent client ids, an always-on server-side risk engine, four run modes with strict
  gates for live and autonomous trading, an AI agent whose order calls are gated in code, Inngest ticks,
  the `/app/algo` page, premium features, migration `0025_algo.sql`, and `scripts/test-algo.ts` (200 checks).
- **Off by default:** `ALGO_LIVE_ENABLED` is unset, so nothing real trades until the owner switches it on
  after counsel's review.

## 1. Brokers: what is officially possible (October 2026)

### Webull

| | |
|---|---|
| Programme | Webull OpenAPI (developer.webull.com and regional sites: .hk, .co.jp, .com.au, .com.sg, .co.th, .com.br) |
| Who | Individuals for their own accounts ("Trading API Application"); institutions through an administrator; third-party platforms through the **Connect API** |
| Access steps (individual) | Open a Webull account → apply for OpenAPI in the developer centre (reviewed, "1 to 2 working days at the earliest") → register an app → generate App Key and App Secret (shown once; SMS and trading-password checks) → reset generates a new key (global site: old key invalidated at once; HK: after 10 days) |
| Auth | Digest signature: HMAC (SHA-1 on the US docs, SHA-256 on some regional docs) keyed by the App Secret + "&", over the path, the sorted query and signing headers (`x-app-key`, `x-signature-algorithm`, `x-signature-version`, `x-signature-nonce`, `x-timestamp`, `host`) and the body's MD5; HK additionally needs a token step |
| Connect API (third parties) | OAuth 2.0 (with PKCE per Webull's Connect page): register the platform (company name, callback URL; originally by email to connect.api@webull-us.com, now an online application form), receive client id, client secret and scopes; production and sandbox login paths differ (`/oauth2/authenticate/login` vs `/oauth2/sandbox/authenticate/login`). Same account, asset and order functions as the Trading API |
| Orders | Place, preview, replace, cancel, order detail and history; v3 "new_orders" payloads with `client_order_id` (≤ 32 chars, unique per account), `symbol`, `instrument_type`, `market`, `side`, `order_type`, `time_in_force`, `quantity`, `entrust_type` (QTY, fractional; or AMOUNT), `support_trading_session` (CORE, ALL, NIGHT); combo and bracket orders |
| Assets | US stocks and ETFs, options, futures and crypto (pages differ on the exact list by region) |
| Market data | A separate Market Data API (quotes, bars, snapshots); the sandbox serves delayed data |
| Paper / sandbox | A sandbox environment exists (changelog of 14 August 2026 documents sandbox and production rate limits); no consumer-style paper account was documented |
| Rate limits | Global Trading API overview: place 600 per 60 s, batch place 150/60 s, preview 150/10 s, replace and cancel 600/60 s, order history/open/detail 2 per 2 s (regional pages give different per-second figures) |
| Individual developers | Yes, for their own accounts. A SaaS acting for many people should use the Connect API |

Sources: [Trading API application](https://developer.webull.com/apis/docs/authentication/IndividualApplicationAPI/),
[Trading API overview](https://developer.webull.com/apis/docs/trade-api/overview/),
[Getting started](https://developer.webull.com/apis/docs/trade-api/getting-started/),
[Stock trading](https://developer.webull.com/apis/docs/trade-api/stock/),
[Changelog](https://developer.webull.com/apis/docs/changelog/),
[Connect API](https://developer.webull.com/apis/docs/connect-api/about-connect-api),
[OAuth integration guide](https://developer.webull.com/apis/docs/connect-api/authentication/),
[Webull Pay authentication (signing)](https://www.webullpay.com/api-doc/develop/auth/),
[HK token page](https://developer.webull.hk/apis/docs/authentication/token/).

### Robinhood

| | |
|---|---|
| Stocks and options API for apps | **None.** Robinhood has never offered a public brokerage API like Alpaca, Tradier or Tastytrade. Unofficial clients (robin_stocks, fast_arrow and others) reverse-engineer its private API and risk breaching its terms; **not used** |
| Crypto Trading API | Official. A person creates API credentials in Robinhood's web app (crypto account settings), registering an Ed25519 public key and choosing the permitted actions. Requests carry `x-api-key`, `x-timestamp` (Unix seconds, valid about 30 s) and `x-signature` = Ed25519 over `api_key + timestamp + path + method + body`. Base `https://trading.robinhood.com`; endpoints under `/api/v1/crypto/trading/` (accounts, holdings, orders, cancel) and `/api/v1/crypto/marketdata/` (best bid/ask, estimated price). Order types market, limit, stop-loss, stop-limit. Two versions (v2 adds fee-tier orders). No published per-minute limit was found |
| Agentic Trading (May 2026) | Customers connect **their own** AI agent to Robinhood's Trading MCP (`https://agent.robinhood.com/mcp/trading`) through Robinhood's OAuth login. The agent can read all accounts but trade only a separately funded **Agentic account** (opened on desktop; a primary account in good standing required); notifications per trade; disconnect any time. Launched for equities, later extended to crypto; "Robinhood Agents" and third-party "Agent Apps" were announced at HOOD Summit (29 September 2026) |
| SnapTrade | Read-only for Robinhood (positions, no orders) |

What this means for YouBank: crypto through the official API (built); stocks and options only if Robinhood
admits YouBank as an Agent App or an approved MCP client (a partnership question, listed for counsel and the
owner). A person can already point their *own* agent at Robinhood's MCP server; YouBank cannot do it for them.

Sources: [Robinhood is now open to agents](https://robinhood.com/newsroom/robinhood-is-now-open-to-agents/),
[Agentic Trading overview](https://www.robinhood.com/us/en/support/articles/agentic-trading-overview/),
[Onboarding an external agent](https://robinhood.com/us/en/support/articles/onboarding-an-external-agent/),
[HOOD Summit 2026](https://robinhood.com/newsroom/hood-summit-2026/),
[Crypto Trading API](https://robinhood.com/us/en/support/articles/crypto-api/),
[SnapTrade broker access guide](https://docs.snaptrade.com/docs/broker-access-guide).

### SnapTrade

The aggregator copy trading already uses (one connection and one ~$2/month per-user fee shared with algo
trading). Its broker access guide lists **Webull US: read and trade**, **Schwab: trading with Schwab's own
API approval** (keys from Schwab's developer portal, case by case), **Robinhood: read-only**, and trading for
Fidelity, E*TRADE, Tradier, Alpaca, Interactive Brokers, Public, tastytrade and others, each subject to the
broker's own API terms. Order impact (preview), place, cancel and order detail are supported; options and
crypto trading vary by broker. Sources: [broker access guide](https://docs.snaptrade.com/docs/broker-access-guide),
[integrations](https://docs.snaptrade.com/docs/integrations), [SnapTrade partners with Webull](https://www.newswire.com/news/snaptrade-partners-with-webull-22678081).

### Alpaca

An API-first broker with free paper trading. Trading API v2 (`/v2/account`, `/v2/positions`, `/v2/orders`
with `client_order_id`, by-client-id lookup, cancel), market data API, stocks, ETFs, options and crypto,
fractional shares, extended hours (limit, DAY). 200 requests a minute per key (older docs). **Alpaca
Connect** (OAuth) lets non-registered firms build apps that trade other people's accounts: paper accounts
work as soon as the app is registered; trading other users' live accounts needs Alpaca's approval, and a
revenue-generating app must say so in the registration and get written approval. Sources:
[Alpaca Connect](https://alpaca.markets/connect), [OAuth with the Trading API](https://docs.alpaca.markets/docs/using-oauth2-and-trading-api),
[About Connect](https://docs.alpaca.markets/docs/about-connect-api).

### Interactive Brokers, Tradier, Schwab

- **IBKR:** individuals use the Web API through the Client Portal Gateway (a local Java process) with their
  username and password (IBKR Pro, funded). Third-party vendors may only seek **OAuth 1.0a** approval: an
  established platform or a full proof of concept, compliance approval of the product, then a Web API
  agreement (api-solutions@interactivebrokers.com). OAuth 2.0 is for licensed organisations and advisers.
  Practical route for YouBank: SnapTrade now, a vendor application later.
  ([third-party OAuth](https://www.interactivebrokers.com/docs/web-api/authentication/oauth-1a/third-party-oauth/registration-process))
- **Tradier:** brokerage APIs are for personal use unless the developer becomes a Tradier Partner; OAuth is
  for partners; a sandbox paper account with delayed data exists. ([docs](https://docs.tradier.com/docs), [FAQ](https://docs.tradier.com/docs/faq))
- **Schwab:** Trader API with OAuth 2.0; "Individual" developer access for one's own accounts, "Commercial"
  for apps distributed to other account holders; refresh tokens last 7 days, then a manual login.

### Recommended integration set

| Priority | Integration | Why | Status |
|---|---|---|---|
| 1 | **Built-in paper broker** | Every strategy starts here; required before autonomy | Built |
| 2 | **Alpaca** (Connect OAuth; paper API keys) | Free paper and live, the cleanest official API, options and crypto | Built; live for other users needs Alpaca's app approval |
| 3 | **SnapTrade** (existing) | Webull, Schwab, Fidelity, E*TRADE, Tradier, IBKR… with one connection already paid for | Built (reused) |
| 4 | **Robinhood Crypto API** | The only official Robinhood trading API | Built (crypto only) |
| 5 | **Webull Connect API** (OAuth) | The official third-party route to Webull | Adapter built against the individual App Key route (`ALGO_WEBULL_ENABLED`); Connect needs Webull's registration |
| later | Robinhood Agent Apps / MCP, IBKR vendor OAuth, Tradier partner | Partnerships | Not built |

## 2. How algorithmic trading is done well

**Strategy families (all shipped as templates).**
- *Trend following:* moving-average crossovers per asset (Faber 2007's 10-month rule is the classic timing
  model); works in persistent trends, whipsaws in ranges.
- *Momentum rotation:* 12-month return skipping the last month (Jegadeesh and Titman 1993); with an absolute
  filter ("dual momentum", Antonacci 2014). Known failure: momentum crashes at sharp reversals (Daniel and
  Moskowitz 2016).
- *Mean reversion:* short-horizon oversold signals (RSI(2), z-scores) inside a longer uptrend; small
  frequent wins, rare large losses; very sensitive to costs and to the thresholds.
- *Pairs:* Engle and Granger (1987) cointegration with MacKinnon (2010) critical values, z-score entries,
  half-life check (Gatev, Goetzmann and Rouwenhorst 2006 for the distance method). Relationships break.
- *Volatility targeting:* scaling exposure by recent volatility improves risk-adjusted returns for many
  factors (Moreira and Muir 2017) and caps risk for everyone.
- *DCA and threshold rebalancing:* no timing; discipline and risk control.
- *Event-driven / 13F copy:* trade only after the event is public (13F lag up to 45 days).
- *Options income:* covered calls and cash-secured puts collect the volatility risk premium in exchange for
  capped upside and full downside (Israelov and Nielsen 2015 decompose the covered call's risks).

**Signal → target → orders.** Signals (with their time of knowledge) → a target portfolio (sizing,
caps) → a diff against what the strategy itself holds → orders (limit bands, whole or fractional shares,
sells first, cash checks) → the risk engine → the broker → fills reconciled back into holdings.

**Backtesting pitfalls and what the backtester does.**

| Pitfall | Here |
|---|---|
| Look-ahead | `decide` slices every series at the decision index; Quant signals are usable only from the first session open after `asOf` and targets after `notBefore`; fills at the next open (or next close) |
| Survivorship | The universe is chosen today; stated in the assumptions; Quant's integrity report flags it (`survivorshipSafe`) |
| Costs and slippage | Spread, square-root impact, commissions, SEC and FINRA fees on sells, option contract fees |
| Overfitting | Every run is a trial (Quant's `logTrial` and a local count); deflated Sharpe (Bailey and López de Prado 2014); probability of backtest overfitting by CSCV (Bailey, Borwein, López de Prado and Zhu 2015); out-of-sample vs in-sample warnings; Harvey, Liu and Zhu (2016) on multiple testing |
| Single-path luck | Stationary block bootstrap intervals for CAGR, Sharpe and drawdown |
| Walk-forward | Rolling train/test folds, the best variant chosen in-sample and run unseen; stitched OOS curve |
| Hypothetical presentation | The SEC Marketing Rule's hypothetical-performance concerns: a disclosure above every result, assumptions listed |

**Execution.** Limit orders with a band around the last price by default (bounded cost, may not fill);
TWAP slicing above a size threshold (Almgren and Chriss 2000 for the trade-off between impact and risk; VWAP
needs intraday volume profiles, noted as a gap); deterministic client order ids so a broker that
de-duplicates rejects a repeat; market-hours and holiday handling from copy trading's exchange calendar;
unknown outcomes never resent.

**Risk management.** Per-order, per-day and per-strategy notional caps; position, gross and net exposure;
daily loss stop; drawdown kill switch; order throttles; fat-finger price band against an independent
reference; short-sale prevention; PDT awareness; wash-sale warnings; user and global kill switches. These
mirror the pre-trade controls SEC Rule 15c3-5 requires of broker-dealers with market access (credit and
capital thresholds, erroneous-order checks), applied here on the client side as well.

**Monitoring.** Every decision, order, block and agent action in an append-only audit log (CSV export);
daily equity marks against the benchmark; risk-usage gauges; notifications for batches to approve and for
autonomous strategies that stop.

## 3. An AI agent that trades for someone: what it should and should not do

- **Should:** draft strategies from plain language, run backtests and say how much to trust them, explain
  any trade from the strategy's own logged reasoning, tighten limits, pause and stop things, and summarise
  news *as information*.
- **Should not:** decide trades on its own judgment, act on text it read, loosen limits, switch on live or
  autonomous trading, or describe anything as advice.
- **Human-in-the-loop modes:** backtest → paper → live with approval (a tap per batch) → live autonomous
  (only for rule-based strategies, after 14 days on paper, with typed consent per strategy). The agent never
  gets autonomy: its orders always need the person's tap in live modes.
- **Prompt injection** (OWASP LLM01; Greshake et al. 2023 on indirect injection through retrieved content):
  news, filings and web text can carry instructions. Defences here, in code: (1) the plan step sees only the
  person's message and YouBank's own records, and decides every tool call before any outside text is read;
  (2) outside text is fetched afterwards, wrapped as data, and given only to an answering step that has no
  tools (the "dual LLM" pattern, Willison 2023; Google DeepMind's CaMeL, 2025, formalises the separation);
  (3) an order call must match an instruction parsed deterministically from the person's own words (side,
  symbol, quantity or amount), so neither a hallucinated nor an injected order passes; (4) the risk engine
  and the live gate apply to every agent order; (5) every call, its reason and its gate are audited.
- **Model failure modes:** hallucinated tickers or parameters (the strategy schema validates; the backtest
  shows the result), overconfident language (the answering prompt requires caveats; DSR and intervals are
  shown), drift between plan and execution (tools are typed, gates are code), cost runaway (calls go through
  `recordUsage` against the AI allowance; ten turns a minute).

## 4. Regulation and compliance

None of this is legal advice. The design leans conservative, but **counsel must review the items in
section 6 before `ALGO_LIVE_ENABLED=1` in production, and before live autonomous trading in particular.**

- **Investment adviser status.** Under the Advisers Act (s. 202(a)(11)) a person who, for compensation,
  advises others on securities is an adviser unless excluded. Software that trades a person's account on
  rules *the person chose and can see* is closer to a tool; a paid service whose AI *chooses* strategies or
  trades, or that tailors them to a person, looks like personalised advice and possibly discretion. The
  publisher's exclusion (*Lowe v. SEC*, 1985) needs impersonal, bona fide, regularly circulated content.
  The SEC's 2017 robo-adviser guidance (IM Guidance Update 2017-02) treats robo-advisers as registered
  advisers with disclosure duties about the algorithm, its limits and overrides. The internet-adviser
  exemption was narrowed in 2024. Templates, the agent's strategy proposals and Quant's targets are the
  features most likely to matter.
- **Rules versus discretion.** Autonomous mode executes only the person's own saved rules within their
  limits, with typed consent per strategy; the agent cannot trade on its own judgment. Whether that keeps
  YouBank outside "discretionary authority" (and Form ADV implications) is for counsel.
- **Broker-dealer status.** Routing orders through broker APIs on a person's behalf, and being paid in
  connection with trading, can raise Exchange Act s. 15(a) questions; YouBank takes no per-trade pay and
  never holds money or securities.
- **Pattern day trading.** The SEC approved FINRA's amendments to Rule 4210 on 14 April 2026
  (SR-FINRA-2025-017, Regulatory Notice 26-10), removing the PDT designation and the $25,000 minimum in
  favour of intraday margin monitoring, effective 4 June 2026 with a phase-in to 20 October 2027. Brokers may
  still apply the old rule during the phase-in, so the risk engine enforces it by default (`pdtMode: legacy`)
  and can warn instead (`intraday`). ([ACA Group](https://www.acaglobal.com/industry-insights/finra-ends-the-pattern-day-trader-rule/), [E*TRADE](https://us.etrade.com/knowledge/library/margin/pattern-day-trading-rule-change))
- **Wash sales** (IRC s. 1091): losses on sales followed by a repurchase within 30 days can be disallowed;
  the engine warns before such buys; it does not track lots across a person's other accounts.
- **Broker terms.** Robinhood's terms forbid unofficial automated access (we use only its Crypto API);
  Webull separates individual keys from the Connect API for platforms; Alpaca requires approval for live
  third-party trading and disclosure of commercial apps; Schwab separates individual and commercial use;
  Tradier is personal-use unless a partner; IBKR vets third-party vendors; SnapTrade's partner agreement
  governs copy and algo trading alike.
- **FINRA and SEC.** FINRA's 2026 Regulatory Oversight Report adds AI-agent risks (supervision, audit
  trails) for member firms; the SEC Marketing Rule (206(4)-1) applies to hypothetical performance if YouBank is
  an adviser; Regulation S-P (amended 2024: incident response, notification) applies to advisers and
  broker-dealers holding customer information; manipulation rules (spoofing, layering, wash trading) apply to
  anyone. The SEC's 2023 predictive data analytics proposal was withdrawn in June 2025 (from memory; verify).
- **Options and crypto.** Options need the broker's options approval level and the person's options
  agreement; crypto spot through Robinhood is under its own (state) licensing.

## 5. What was built

### Code map

| Piece | Where |
|---|---|
| Quant contract (types only, owned by Quant) | `src/lib/quant/contracts.ts` (unchanged copy of Quant's file) |
| Adapter over it: timing, values, targets, budgets, ports | `src/lib/algo/signals.ts` |
| Strategy schema and templates | `src/lib/algo/strategy.ts` |
| Indicators and cointegration | `src/lib/algo/indicators.ts` |
| Decisions | `src/lib/algo/evaluate.ts` |
| Backtester, walk-forward, variants | `src/lib/algo/backtest.ts` |
| Metrics, PSR, DSR, PBO, bootstrap | `src/lib/algo/metrics.ts` |
| Costs, Black–Scholes, OCC symbols | `src/lib/algo/costs.ts` |
| Risk engine | `src/lib/algo/risk.ts` |
| Orders, TWAP, client ids, lifecycle | `src/lib/algo/execution.ts`, `orders.ts` (copy trading's `approveBatch`, generalised) |
| Broker interface and adapters | `src/lib/algo/brokers/{types,http,paper,alpaca,snaptrade,webull,robinhood}.ts` |
| Live gate | `src/lib/algo/live-gate.ts` |
| Agent gates and the agent | `src/lib/algo/agent-gate.ts`, `agent.ts` |
| Server: access, connections, store, ticks, actions, views | `src/lib/algo/{access,connections,store,tick,live,views,data,schedule,disclosures}.ts` |
| Inngest | `src/lib/algo/functions.ts` (served by `/api/inngest`) |
| Routes | `src/app/api/algo/**` |
| Page | `src/app/app/algo/page.tsx`, `src/components/algo/*` |
| Premium | `src/lib/billing/features/algo.ts`; a fixed line in `costs.ts` |
| Migration | `drizzle/0025_algo.sql`, `src/db/schema.ts` |
| Tests | `scripts/test-algo.ts` |

Copy trading was generalised, not duplicated: `approveBatch` takes an optional `confirm` and `noun` (its own
behaviour unchanged), the SnapTrade client gained `cancelOrder`, `snapUser` and `symbolId` are exported,
`cloneEvents` exposes the lag-aware 13F events, and both audit CSVs now neutralise formula-leading cells
(`src/lib/csv.ts`).

### The Quant contract

Strategies read Quant's `QuantSignal`s (`signal: { type: "external", producer }`) and `TargetPortfolio`s
(`signal: { type: "target", key }`) through ports with local defaults, wired after the merge with
`wireQuant({ signals, targets, trials, costs, integrity, budgets })`:
- rule 1: a signal is used only from the first session open after `asOf` (crypto: from `asOf`); a target only
  after `rebalance.notBefore`; rule 2: dropped at `validUntil` (backtests too);
- rule 3: every backtest calls `logTrial({ family, params, returns })` and increments the strategy's own
  trial count, which the deflated Sharpe uses;
- rule 4: `tightenWithBudget` adopts a `RiskBudget` only where it is tighter;
- rule 5: `explain` texts are shown as written;
- rule 6: an `IntegrityReport` graded D or F blocks live modes unless the person types `OVERRIDE GRADE F`
  (or D), which is audited.
The engine's own readings are emitted as `QuantSignal`s (producer `algo.<rule>`, `calibration.method: none`).
Paper and live fills can be handed to Quant's cost work as contract `Fill`s (`contractFill`).

### Run modes and their gates

| Mode | What happens | Requirements |
|---|---|---|
| Backtest | Nothing on a schedule | none |
| Paper (default) | Paper broker fills on real prices, same risk engine | none (Free: 3 strategies, decisions at most daily) |
| Live with approval | Batches proposed; sent only on the person's tap (typed phrase for ≥ $10,000 or ≥ 15 orders) | `ALGO_LIVE_ENABLED=1`; `algo.live` (Pro); consents; a trading-capable account; every risk limit saved; long-only; no kill switch; integrity not D/F without override |
| Live autonomous | Sent on schedule within limits | All the above, plus `algo.autonomous` (Deal Team), ≥ 14 days on paper (`ALGO_MIN_PAPER_DAYS`), per-strategy consent with the typed phrase "TRADE <NAME> AUTOMATICALLY"; loosening a limit drops it back to approval and withdraws the consent; the gate is re-run with fresh state before every autonomous batch |

### Scheduling

`algo-tick` runs every 15 minutes (and on `algo/tick`) and ticks due strategies four per step, step after
step until none is due (at most 30 steps, 120 strategies, a run), each step to a 200-second deadline and
each tick holding a lease; a retried step ticks only what is still due. Equity ticks only on their schedule
inside the session (9:35 ET, or 15:45 ET and 12:45 on early closes, on the cron's quarter hours so the
close decision runs while the market is open; hourly or 15-minute intraday on Pro / Deal Team, the last at
close − 15); crypto daily at 20:00 UTC or intraday around the clock. A close tick that runs late (more due
strategies than one run reaches before 16:00) is skipped for the day: past about a hundred strategies
deciding at the same close, the tick needs fanning out across parallel steps. Queries are short and sequential, so a run uses one or two of the six pooled
connections and stays far inside the 30-second statement timeout.

### Premium and costs

| Feature | Plan | Cost entered | Why |
|---|---|---|---|
| Backtests, paper trading, builder, templates | Free | Fixed line "Algo trading: paper strategy ticks" ($2/month) | Free data and a little compute |
| `algo.live` | Pro | `flatMonthlyUsd` $0.10 | Live ticks and order calls; broker APIs are free; SnapTrade's fee is `copytrade.broker`'s, shared |
| `algo.agent` | Pro | $0.24 a turn, `inAiAllowance` | Two structured calls through `recordUsage` |
| `algo.autonomous` | Deal Team | perk | Same ticks as `algo.live` |
| `algo.more` (25 strategies, 15-minute decisions) | Deal Team | perk | Ticks counted in `algo.live` |

`scripts/test-billing.ts` passes: Pro 71.4% monthly / 67.0% yearly typical, Deal Team's yearly full-allowance
margin 25.0% (it was 25.1%; algo adds $0.11 there, inside the $0.15 of room).

### Setup

1. Migration: new databases replay `drizzle/*.sql`; existing ones
   `DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0025_algo.sql`.
2. `EMAIL_TOKEN_SECRET` (already used for copy trading) encrypts broker credentials.
3. Inngest (`INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY`) for the ticks; without it, "Run now" still works.
4. Alpaca: create an OAuth app in the Alpaca dashboard (Connect tab), redirect URI
   `https://<domain>/api/algo/connections/alpaca/callback`, set `ALPACA_OAUTH_CLIENT_ID` and
   `ALPACA_OAUTH_CLIENT_SECRET`; disclose the commercial app and apply for live approval. Paper keys work
   without any of this. `ALGO_ALPACA_LIVE_KEYS=1` allows pasted live keys (off by default).
5. Webull: register for the Connect API (application form) for the platform route; the individual App Key
   route is behind `ALGO_WEBULL_ENABLED=1`; check `WEBULL_API_BASE` and the paths in `brokers/webull.ts`
   against developer.webull.com for the account's region first.
6. Robinhood Crypto: nothing server-side; people create their own keys.
7. SnapTrade: as copy trading (docs/copy-trading.md).
8. Limits: `ALGO_MAX_ORDER_USD` (25,000), `ALGO_MAX_DAY_USD` (50,000), `ALGO_MIN_PAPER_DAYS` (14).
9. Kill switches: `ALGO_KILL=1` (server-wide, immediate), or an administrator's `POST /api/algo/admin/kill`.
10. **Only after counsel's review:** `ALGO_LIVE_ENABLED=1`.

### Verified, and how

- `pnpm exec tsx scripts/test-algo.ts`: 200 checks, no network or database (listed at the top of the file),
  including the deflated Sharpe against Bailey and López de Prado's worked example (SR0 0.1132, DSR 0.9004),
  backtests with known answers, every risk rule, five concurrent sends of one batch placing each order once,
  Robinhood's Ed25519 signature verified with the public key, Webull's string-to-sign rebuilt independently,
  Alpaca's request shapes and error mapping, the paper fill model, and the agent's gates against injected
  instructions.
- `scripts/test-copytrade.ts`, `test-billing.ts`, `test-premium.ts`, `test-errors.ts`, `tsc`, `lint` and
  `pnpm build` pass.
- Not verified live: no broker could be reached from the build environment. Webull's paths and its regional
  signing differences, Robinhood's exact signing message and host, and Alpaca's current OAuth details come
  from documentation as summarised by search and must be checked with a sandbox or paper account first.

### Known gaps

- Webull Connect (OAuth) is documented but not built: it needs Webull's registration and its exact endpoints.
- Robinhood equities: no official route for apps; depends on Robinhood admitting YouBank as an Agent App.
- Options: priced in backtests with Black–Scholes on realised volatility plus a premium (no historical option
  quotes); live option orders are wired for Alpaca only and need the person's options approval; assignment
  and exercise handling at the broker are not modelled in live state.
- No VWAP (needs intraday volume profiles); TWAP slices are re-priced but not adaptive.
- The paper broker fills whole orders (no partial fills or queue position); quotes come from the market data
  layer (no live bid/ask for most symbols, so it applies a modelled spread).
- Wash-sale and PDT counts see only orders placed through YouBank (and the broker's own count where reported).
- Quant's functions are ports with local defaults until the branches merge (`wireQuant`).
- Re-authentication (password or passkey) before switching to autonomous would be stronger than typed
  confirmation once the auth layer offers it.

## 6. What counsel must review before live autonomous trading is enabled

1. **Investment adviser status** (federal and state): templates, the agent's strategy proposals, Quant's
   targets and signals, per-person sizing and the subscription price; publisher's exclusion; whether
   autonomous mode is "discretionary authority"; Form ADV, a compliance programme and a CCO if registration
   is needed; the robo-adviser guidance's disclosures.
2. **Broker-dealer status**: order routing through broker APIs for people, no transaction-based pay, and
   whether a broker-dealer partner is needed.
3. **Each broker's terms and approvals**: Alpaca Connect commercial disclosure and live approval; Webull
   Connect registration; Robinhood (Crypto API terms for a third-party app holding a person's key; Agentic
   Trading as a future partnership); SnapTrade's partner agreement for automated trading; Schwab commercial
   access; IBKR and Tradier routes if added.
4. **Holding people's API keys** (Alpaca keys, Webull App Keys, Robinhood Ed25519 private keys): whether the
   brokers allow it, security obligations (Regulation S-P if applicable, state law), breach response.
5. **Autonomous consent**: the texts in `src/lib/algo/disclosures.ts`, the typed phrase, the 14-day paper
   period, re-consent on loosening limits, and whether stronger re-authentication is needed.
6. **The AI agent**: descriptions of what it does (no overstated claims, per FINRA's 2026 report), its
   order-from-instruction rule, record keeping of its decisions, and liability for its errors.
7. **Hypothetical performance** (SEC Marketing Rule if an adviser; FINRA 2210 with a BD partner): backtests
   shown to Free users, the disclosure text, walk-forward and deflated Sharpe presentation.
8. **Pattern day trading and margin** during FINRA's phase-in (to 20 October 2027): defaults and messages.
9. **Tax features**: wash-sale warnings and their limits (other accounts, lots); no tax advice.
10. **Market conduct**: throttles, fat-finger checks and intraday frequency against manipulation concerns;
    order types allowed.
11. **Options and crypto**: suitability gates at the broker, assignment risk messaging, crypto state
    licensing questions for a third-party interface.
12. **Record keeping and privacy**: retention of the append-only audit log, consents and agent transcripts;
    deletion requests; data residency.
13. **Operational liability**: unknown outcomes (never retried), broker outages, duplicate orders at brokers
    that ignore client ids, the kill switches, and the server ceilings' defaults.
14. **Plans and pricing**: charging for live and autonomous trading (Pro, Deal Team) and whether that is
    compensation for advice.
15. **Marketing**: "trades for you", "AI agent", Webull and Robinhood names (no endorsement implied).
