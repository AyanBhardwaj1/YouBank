# Fund copies: copying hedge-fund 13F portfolios

People see what well-known funds disclose in their 13F filings, test how copying them would have gone,
follow them on paper for free, and with Pro place the matching orders in their own brokerage account,
approving each batch themselves. This page is the design: data, rules, money, safety and what has to be
reviewed before real trading is switched on.

**The promise, and its limits.** YouBank builds the exact orders; the person approves every batch.
Nothing trades without that click, nothing trades from a schedule, and YouBank never holds or moves
money. A 13F arrives once a quarter, up to 45 days after the quarter ends, so "real time" means: the
moment a new 13F or 13F/A is filed, we turn it into orders for you to review. The product says this on
every screen that matters, and every backtest shows the filing lag.

## What is free and what is paid

| What | Plan | Why |
|---|---|---|
| Browsing funds, 13F holdings, changes, statistics, filings | Free | SEC EDGAR is free and public |
| Clone backtests | Free | SEC data and the free price sources already in the app |
| Paper copies (up to 10) and alerts on new filings | Free | Our own database and the existing bell and push |
| Connecting a broker and placing copy orders (`copytrade.broker`) | Pro | SnapTrade charges per connected user per month |
| Blends of several funds (`copytrade.blends`) | Deal Team | A plan perk |
| More than 2 live copies, up to 10 (`copytrade.multi`) | Deal Team | A plan perk |

The features are registered in `src/lib/billing/features/copytrade.ts` and checked on the server
(`requireFeature`) before any brokerage call. Administrators (`ADMIN_EMAILS`) may use everything.

**SnapTrade's cost in the pricing model.** SnapTrade's pay-as-you-go plan with trading costs about $2 per
connected user per month (list price, October 2026; volume plans are lower). It is a flat monthly fee,
charged while the connection exists, whether the person trades or not. The shared cost model
(`src/lib/billing/costs.ts`) multiplies `costPerUseUsd` by uses a month (4 at typical use, 20 at heavy),
so the fee is entered as $0.50 a "use" with a `perUse` note saying so: $2 a month at typical use, exact.
At heavy use the model counts $10, which overstates a flat fee. **Owner decision needed:** with the fee
counted honestly, `scripts/test-billing.ts` reports Pro at 69.6% of list price at typical use (target
70%) and Pro yearly below its worst-case margin at heavy use; see "Open items" below.

## Data: 13F filings from SEC EDGAR

Code: `src/lib/copytrade/edgar13f.ts` (network), `thirteenf.ts` (pure parsing and rules).

- **Finding filings.** Three ways in, fastest first: EDGAR's latest-filings Atom feed for 13F-HR and
  13F-HR/A (polled by the cron), each day's form index (`daily-index/…/form.YYYYMMDD.idx`, read the next
  morning to catch anything the feed's last hundred entries missed), and a filer's submissions record
  (`data.sec.gov/submissions/CIK….json`, plus its numbered older files) for full history when someone
  opens a fund. Once a quarter the full form index (`full-index/YYYY/QTRn/form.idx`) is streamed only as
  far as its 13F section, to fill the directory of every 13F filer for search.
- **Reading a filing.** The filing's `index.json` names its documents: the primary document
  (`primary_doc.xml`) and the information table (the other XML). The primary document gives the period,
  whether it is an amendment and of which kind, whether it is a holdings report or a notice that another
  manager reports for this one, and whether holdings were omitted under confidential treatment. The
  information table gives CUSIP, value, shares or principal, put/call, investment discretion, other
  managers and voting authority, line by line. Lines are summed per security (CUSIP, put/call, share
  type) across discretion types and managers.
- **Values.** Filings made from 3 January 2023 report dollars; earlier ones thousands of dollars. Some
  filers kept the old unit for a while (and a few used dollars early), so the median implied price per
  share decides when the date and the numbers disagree (under $1 a share in a "dollars" filing, or over
  $20,000 in a "thousands" one). Corrected filings are marked on the fund page.
- **Amendments.** A quarter's portfolio, as publicly known on a date, is the original report, replaced by
  any RESTATEMENT filed by then, plus every NEW HOLDINGS amendment filed by then. Holdings first kept
  confidential therefore appear on the day they were disclosed, never before: the backtest cannot
  look ahead.
- **Confidential treatment** is flagged on the fund page (`isConfidentialOmitted`).
- **Options and principal amounts** (puts, calls, convertible notes) are shown on the fund page and never
  copied: a 13F gives an option's underlying value, not its strike, expiry or premium.
- **Share classes** of one company (Alphabet's GOOGL and GOOG; Berkshire's A and B shares) share a CUSIP
  issuer prefix and count as one idea, merged into the class the fund holds most of.
- **Stock splits between filings** are detected per position: the share count changed by a split ratio
  while the implied price per share moved by about its inverse. Changes are compared on the new basis,
  so a split is not reported as "added".
- **Polling.** Every cron pass in the weeks around the 45-day deadlines (from 15 days before to 5 days
  after 14 February, 15 May, 14 August and 14 November, rolled past weekends), otherwise every three
  hours. All of it is free; SEC's fair-access limit is respected through `lib/edgar/client` (a
  descriptive User-Agent from `EDGAR_USER_AGENT`, eight requests a second shared by every instance, and
  a minute's back-off when SEC asks).
- **Curated managers** (`src/lib/copytrade/funds.ts`): Berkshire Hathaway, Pershing Square, Appaloosa,
  Baupost, Greenlight, Third Point, Scion, Lone Pine, Tiger Global, Duquesne Family Office, Soros,
  Himalaya, Dalal Street (Pabrai), Akre, Icahn, Coatue, Viking, ValueAct, Trian, Starboard, D1, Fundsmith,
  Ruane Cunniff, the Gates Foundation Trust, Bridgewater and Renaissance. Each entry carries a word its
  EDGAR name must contain; a mismatched CIK is refused rather than shown under the wrong name. Notes on
  the page say where a 13F misleads (large shorts at Greenlight, puts at Scion, a macro book at
  Bridgewater).

## CUSIP to ticker

Code: `src/lib/copytrade/cusip.ts` (pure), `securities.ts` (stored and reused). In order, the first that
answers wins, and the source is stored with the answer:

1. **The owner's overrides** (`copy_cusip_overrides`, set by administrators through
   `POST /api/copy/overrides`), then a short built-in list of common CUSIPs (with verified check digits).
2. **A stored answer** (`copy_securities`); misses are asked again after 30 days.
3. **OpenFIGI**, by CUSIP, for the US composite listing. It works without a key (10 jobs a request, 25
   requests a minute); `OPENFIGI_API_KEY` (free) raises that to 100 jobs and 25 requests per 6 seconds.
4. **SEC names**: the issuer's name from SEC's quarterly Official List of Section 13(f) Securities
   (falling back to the filer's spelling) matched against SEC's `company_tickers.json`, only when exactly
   one listed company has that name and the share class is unambiguous.

Sectors come from each issuer's SIC code in its SEC submissions record, a few new companies per call.
**Coverage is reported honestly on every fund page**: the share of reported value with a ticker, by
source, the share on SEC's current 13(f) list, and the largest holdings left without a ticker (which are
left out of copies and counted against them).

## Fund pages and the backtest

Code: `src/lib/copytrade/analytics.ts`, `backtest.ts`; UI in `src/components/copy/`.

Each fund page shows holdings and weights (a treemap: area is weight, colour is the quarter's change),
quarter-over-quarter changes (new, added, trimmed, exited, as diverging bars of weight change),
concentration (top-10 share, Herfindahl and the effective number of positions), turnover (half the sum
of absolute weight changes), the sector mix, top ideas (largest weights and biggest increases), every
quarter, and every filing with its lag in days, linked to EDGAR.

**The clone backtest** (free, cached for half a day per filing set):
- On each filing date, the latest quarter as then known (amendments included on the day they were filed)
  becomes clone weights under the default rules (top N by value, share classes merged, rescaled to 100%).
- It buys at the **close of the first trading day after the filing date** (a filing accepted after 4 pm
  cannot be traded that day, and EDGAR's index does not say which were) and holds until the next filing,
  letting positions drift.
- A **"quarter end, no lag" line** buys the same holdings at the quarter-end close, which nobody could
  do; the gap between the two lines is the cost of the lag. A third line is SPY.
- Statistics over the same window for all three: CAGR, annualised volatility, maximum drawdown, Sharpe
  (0% risk-free rate for every line) and beta to SPY's daily returns. The average filing lag and the
  share of target weight that had a price on each rebalance day are shown.
- Assumptions printed beside the result: price return on split-adjusted daily closes (dividends not
  reinvested); no fees, commissions, spreads, slippage or taxes; long-only; options and unmapped holdings
  left out; a ticker with no price on the rebalance day is left out and the rest scaled up; today's
  ticker map applied to old CUSIPs (survivorship can flatter old periods).
- Prices come from the market data layer (`src/lib/market/data.ts`): FMP where the plan covers a symbol,
  then Nasdaq's public quote API. The result names which answered.
- The hypothetical-performance disclosure (`HYPOTHETICAL` in `src/lib/copytrade/disclosures.ts`) sits
  directly above every backtest chart and table.

## Copies

Code: `src/lib/copytrade/portfolios.ts`, `paper.ts`, `targets.ts`.

A copy has: a fund (or a blend, Deal Team), paper or live, a size (dollars, or for live copies a
percentage of the account), the clone rules (top N, a minimum weight, excluded tickers and sectors) and,
for live copies, the account and the order settings.

- **Paper copies** start with their size in cash and buy the targets at the latest prices (fractional,
  no fees). When the fund files, the cron rebalances them at that day's prices and tells the owner. A
  holding with no price that day is kept, not sold at zero. Their record is shown against SPY with the
  same money.
- **Live copies** never trade on their own. When the fund files, the owner gets a notice that orders are
  ready to review; nothing is built or sent until they open it.
- **Alerts.** Following a fund puts a notice in the bell (`news_notifications`) and sends it through the
  person's Newsroom alert channels (web push through `web-push`, Slack where set) within their quiet
  hours. Email is used by those channels only for urgent alerts; 13F alerts are not urgent.

## Brokerage connection and orders (Pro)

Code: `src/lib/copytrade/snaptrade.ts` (client), `live.ts` (flows), `rebalance.ts` (the diff),
`orders.ts` (approval), `markethours.ts`.

**SnapTrade.** A small typed client rather than the 2 MB generated SDK. Signing was checked against the
SDK (`snaptrade-typescript-sdk` 12.2.17, `requestAfterHook`) and the tests compare our signatures with
ones the SDK's own code computed: every request carries `clientId` and `timestamp` in the query (and
`userId`/`userSecret` for user calls); the `Signature` header is base64 HMAC-SHA256, keyed by
`encodeURI(consumerKey)`, of JSON `{content, path, query}` with every key sorted. Paths are SnapTrade's
canonical root paths (the `/api/v1` prefix is deprecated). Calls used: register and delete user, the
connection portal link, accounts, authorizations (for the broker's trading and fractional-share
support), holdings (positions and balances), symbol search, order impact, place checked order, place
order (with our client order id), order detail and recent orders.

- Each person's SnapTrade user id is an opaque hash, never their email. Its secret is stored encrypted at
  rest (AES-256-GCM, `src/lib/crm/crypto.ts`, keyed by `EMAIL_TOKEN_SECRET`).
- A SnapTrade user is created only when a Pro person clicks Connect (which starts SnapTrade's monthly
  charge for them) and deleted when they disconnect (which stops it); disconnecting pauses live copies
  and cancels unsent proposals.
- Without `SNAPTRADE_CLIENT_ID` and `SNAPTRADE_CONSUMER_KEY` (or without `EMAIL_TOKEN_SECRET`), the
  Connect button reads "Not set up yet".

**The proposal** (`proposeOrders`, pure and tested):
- Each target gets size × weight. The copy's current holding is what its own filled orders bought,
  capped at what the account still holds. **Positions held outside the copy are protected**: never
  counted and never sold. With the opt-in "count shares I already own", outside shares in tickers the
  copy targets or holds count toward the target (so it does not buy a second stake) and can be trimmed;
  unrelated holdings are never touched either way.
- Whole shares unless the broker supports fractional ones (then 1/10,000 of a share). A share too
  expensive for its slice is skipped with the reason.
- Orders under the minimum order size are skipped; orders over the per-order limit are cut.
- Sells first. Buys are paid from cash less a buffer plus, by default, the sells' estimated proceeds,
  checked at the limit price (the most they could cost); when they do not fit, every buy is scaled by the
  same factor. A caution explains good-faith violations in cash accounts when sale proceeds are used.
- **Limit orders by default** at the last price plus a band for buys (minus for sells), rounded to the
  cent; market orders are an option.
- Each ticker is resolved to the broker's own symbol id; a ticker it cannot find is left out with the
  reason.
- The review shows every order, the estimate, buys, sells and cash after, skipped lines with reasons, the
  market's state, and a tax-lot caution on any sell. A proposal expires after 15 minutes.

**One-tap approve** (`approveBatch`, tested with in-memory fakes and run against the database in the app):
- The person ticks that they checked the orders and approves. Batches of $10,000 or more, or 15 orders or
  more, need the typed confirmation "PLACE n ORDERS".
- **Idempotency.** The batch moves from proposed to placing in one conditional update only one request
  can win; a second tap or a retry places nothing and gets the batch's state back (the same answer with
  the same key, a 409 with another). Each order then moves from pending to submitting the same way before
  its broker call, and carries a client order id derived from the batch and its position (a canonical
  UUID SnapTrade passes to brokers that de-duplicate on it; `copy_orders.client_order_id` is unique).
- Each order is checked with SnapTrade's order impact and then placed as that checked trade; if the check
  does not answer, it is placed directly with the client order id. A broker's refusal is recorded with
  its reason. A placement with no answer is marked "unknown" and **never retried automatically**: it may
  have reached the broker, so the person is told to check before trying again.
- **Market hours**: US regular hours with holidays and early closes worked out from the exchanges' rules.
  Market orders are refused while the market is closed; limit orders placed then are Day orders the
  broker holds for the open, and the review says so.
- **Broker permissions**: an account whose broker does not allow trading through SnapTrade cannot be used
  for a live copy.
- **Fills**: the status refresh (on demand, and by the cron for orders sent in the last four days) reads
  each order's detail, records fills, and recounts the copy's own holdings from filled orders.

**Safety rails**
- `COPYTRADE_TRADING_ENABLED=1` must be set, or approval refuses with a plain message. Off by default.
  Paper copies, connecting and viewing positions keep working.
- Per-order and per-day limits per copy, under server ceilings (`COPYTRADE_MAX_ORDER_USD`, default
  $25,000; `COPYTRADE_MAX_DAY_USD`, default $50,000, counted across a person's copies).
- Two consents, stored with the text's version and hash and audited: "how copies work" before the first
  copy or connection, "the risks of real orders" before the first approval.
- An **append-only audit log** (`copy_audit`; SQL rules turn UPDATE and DELETE into nothing): every
  consent with its text, connection, copy change, proposal, approval (who, when, IP, browser, the key, the
  confirmation method, the orders), each order's exact request and the broker's answer, each status
  change. People can read their own and download it as CSV (`/api/copy/audit?format=csv`).
- Users never see raw errors: every route runs inside `guarded()`, the cron inside `handled()`, and broker
  refusals are passed on only when short and plain.

## The cron

`/api/cron/copytrade` (`src/lib/copytrade/ingest.ts`), free work only, never trades:
- once a day from Vercel Cron (`vercel.json`, 12:40 UTC), and every 15 minutes from any scheduler that
  calls it with the bearer secret (`neon/copytrade.ts` is a ready relay for a Neon Functions schedule, the
  same pattern as the Newsroom's heartbeat; a GitHub Actions schedule or any cron service works too);
- authorised by `CRON_SECRET` or `AUTOPILOT_SECRET`, one pass at a time (a lease);
- polls for new filings, notes filers for search, reads filings of followed, copied and curated funds,
  alerts followers, rebalances paper copies, notifies live copies' owners, refreshes order statuses, and
  once a quarter fills the filer directory from the full index.

## Setup

1. Apply the migration: new databases get it from `scripts/db-setup.mts` (which replays every
   `drizzle/*.sql`); an existing one with `DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0023_copytrade.sql`.
   It is plain Postgres (tables, indexes and two rules), nothing provider-specific.
2. Make sure `EDGAR_USER_AGENT` names a real contact address (SEC's requirement).
3. Optional: `OPENFIGI_API_KEY` (free, openfigi.com) for faster CUSIP mapping.
4. Schedule the 15-minute pass. With the included Neon Functions relay:
   ```bash
   neon functions deploy copytrade --src neon/copytrade.ts \
     --env YOUBANK_URL=https://<your-domain> --env AUTOPILOT_SECRET=<secret>
   neon triggers create --function-slug copytrade --name copytrade-heartbeat --cron '*/15 * * * *'
   ```
   Or have any scheduler `POST https://<your-domain>/api/cron/copytrade` with
   `Authorization: Bearer <CRON_SECRET or AUTOPILOT_SECRET>` every 15 minutes. Without it the daily
   Vercel Cron still runs, so new 13Fs arrive within a day instead of within minutes.
5. For live copies, in the SnapTrade dashboard: create an organisation and API keys, choose a plan that
   includes trading (the free tier allows a handful of connections for testing), add the app's domain to
   the allowed redirect URLs if the dashboard asks (the portal returns to
   `/app/copy?tab=broker&connected=1`), and decide which brokers to enable. Then set
   `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` and `EMAIL_TOKEN_SECRET`.
6. Test with a broker's paper account (several brokers offer one through SnapTrade) and
   `COPYTRADE_TRADING_ENABLED=1` on a preview deployment only.
7. **Only after counsel's review** (below): set `COPYTRADE_TRADING_ENABLED=1` in production.

## Compliance

Executing trades built from third-party strategy data raises regulatory questions even when every trade
is approved by the person. The product is built the way a cautious product would be, but **none of this
is legal advice, and real trading must stay off until counsel has reviewed the items below.**

**What the product does to stay on the safe side**
- Impersonal, rule-based output: the same filing and the same rules give everyone the same orders; the
  person chooses the fund, the size and every rule. The product never says a fund, stock or copy is
  suitable for anyone, and its words describe what a filing says and what a rule does ("largest by
  reported weight", "what a fund held, not a view on whether anyone should hold it").
- "Not investment advice; you decide every trade" consent at first use, stored with its version.
- The hypothetical-performance disclosure beside every backtest, the no-lag line labelled impossible,
  and the assumptions printed with the result.
- No discretion: no automatic execution, no trading from a schedule, an approval per batch, typed
  confirmation for large batches, limits, and a kill switch that is off by default.
- No custody: orders go to the person's own broker through SnapTrade; YouBank never holds funds or
  securities.
- An append-only audit log per person.

**What the owner must have counsel review before enabling real trading**
1. **Investment adviser status.** Whether building orders from a fund's 13F for a paying subscriber,
   with sizing and rules, makes YouBank an investment adviser under the Advisers Act (and state law), or
   fits the publisher's exclusion (*Lowe v. SEC*: impersonal, bona fide, of general and regular
   circulation). The order-building and one-tap execution, the per-person sizing against their account,
   and the subscription price are the features most likely to matter. If registration is needed:
   federal or state, Form ADV, a compliance programme and a chief compliance officer.
2. **Broker-dealer status.** Whether routing orders to brokers through SnapTrade, or being paid in
   connection with trading, needs broker-dealer registration or a FINRA member partner; and that
   YouBank takes no payment per trade or per order.
3. **SnapTrade's terms.** The partner agreement's permitted uses (a copy-trading product in particular),
   end-user disclosures it requires, data retention and deletion, the per-user charges, and each enabled
   broker's own API terms for third-party order entry.
4. **The SEC Marketing Rule (206(4)-1)**, if YouBank is or may be an adviser: hypothetical performance may
   only be shown with policies and procedures reasonably designed to make it relevant to the audience's
   financial situation and objectives, plus the criteria and assumptions behind it. Whether the free,
   public backtests (to everyone, including non-subscribers) are compatible, and whether the disclosure
   text in `src/lib/copytrade/disclosures.ts` is enough. FINRA Rule 2210 if a broker-dealer partner is
   involved.
5. **The consent and disclosure texts** (`CONSENTS` in `disclosures.ts`): their wording, where they
   appear, whether the Terms of Service need a section on copy trading, and the record kept.
6. **Using 13F data commercially.** 13F filings are public records; confirm nothing restricts building a
   product on them, and the fund names and descriptions on the curated list (no endorsement implied).
7. **Marketing and naming.** "Copy hedge-fund strategies" and similar copy on the site and in emails:
   whether it implies performance, endorsement by the funds, or real-time data.
8. **Record keeping and privacy.** Retention of the audit log, consents and order payloads; what is
   deleted when a person deletes their account (the audit log is append-only by design); data residency
   for Enterprise customers.
9. **Market and operational risk.** Liability for an order that fails, fills badly or is duplicated by a
   broker that ignores client order ids; the "unknown outcome" handling; the default limits.
10. **Plans and pricing.** That charging for the broker connection (Pro) does not turn the subscription
    into compensation for advice, or the analysis above changes.

## Verified, and how

- `pnpm exec tsx scripts/test-copytrade.ts`: 121 checks, no network or database (13F parsing, amendments,
  options, units, CUSIP mapping, clone rules, backtest arithmetic with the lag, the rebalance diff,
  idempotent approval with simultaneous taps, market hours, SnapTrade signatures against SDK-computed
  fixtures, paper copies, polling).
- `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build` pass.
- Live network checks were not possible from the build environment: SEC EDGAR, SnapTrade and OpenFIGI
  were unreachable from it (the proxy refused the connections), so the EDGAR document shapes are covered
  by fixtures written to SEC's published 13F XML schema, and the 13(f) list's URL
  (`https://www.sec.gov/files/investment/13flist{YYYY}q{N}.txt`) and text layout are from SEC's
  description, not a download. The SnapTrade signing was verified against the SDK's code, not a live call.

## Open items

- **Pricing.** SnapTrade's honest $2 a month per connected user puts `scripts/test-billing.ts` at 3
  failures (Pro typical margin 69.6% against 70%, and the heavy-use worst case, where the model counts a
  flat fee 20 times). Options: raise Pro's price or allowance math, negotiate SnapTrade volume pricing,
  or teach `costs.ts` a flat monthly cost (owned by the pricing work).
- **First live run.** Check the 13(f) list URL, the daily index and a few large filers' information tables
  against EDGAR once the server can reach it, and place a test order through a broker's paper account.
- **The backtest's price coverage** depends on the free price sources; tickers they lack are reported and
  left out.
- **Re-authentication.** Large batches need a typed confirmation; a password or passkey re-check before
  approving would be stronger once the auth layer offers one through `currentUser()`.
