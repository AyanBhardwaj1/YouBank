# The market-data layer

How YouBank gets prices, fundamentals and macro data, what happens when a source fails, and how to see
it. Code: `src/lib/market/` (registry, chain, budgets, breaker, stats, provenance), `src/lib/cache.ts`,
`src/lib/edgar/client.ts`. Tests: `scripts/test-datalayer.ts`.

## Sources and fallbacks

Every source is listed once, in `src/lib/market/registry.ts`, by dataset. Each dataset has an ordered
chain of adapters; the default order is below. Adding a source is one entry there.

| Dataset | Default chain (first answers; the next on any failure) | Notes |
|---|---|---|
| `daily-bars` (stocks, ETFs, indices) | FMP → Nasdaq | Indices use a tracking ETF on Nasdaq (S&P 500 via SPY), labelled `via` |
| `fx` | FMP → ECB reference rates (Frankfurter, then the ECB's own API) → Fed H.10 (via FRED) | ECB is a daily fixing, labelled "ECB fixing"; H.10 is the noon New York rate |
| `commodity` (CMDTY) | FMP → EIA spot → Nasdaq ETF stand-ins → World Bank Pink Sheet (monthly) | EIA covers WTI, Brent, Henry Hub; monthly rows show no daily move |
| `cot` (CMDTY positioning) | CFTC Commitments of Traders | Weekly, Tuesday positions |
| `crypto` (BTC, ETH, SOL bars) | FMP → CoinGecko | |
| `quote` | FMP → Nasdaq | Not for FX, crypto or proxied symbols (boards use the last close) |
| `profile` (DES/FA/COMPS price, cap, range) | FMP → Nasdaq → SEC EDGAR | SEC fills name, exchange and a SIC-based sector; never a price |
| `fundamentals`, `filings` | SEC EDGAR | A stale copy stands in when SEC fails |
| `earnings` (EE) | FMP → Nasdaq → SEC filings → AI research | SEC: reported EPS and revenue, dated by the 8-K Item 2.02; no estimates |
| `analysts` (ANR) | FMP → Nasdaq → AI research | No free licensed source |
| `dividends` (DVD) | FMP → Nasdaq → SEC filings → AI research | SEC: per share by fiscal quarter; no ex or pay dates |
| `deals` (MA) | FMP → SEC full-text search (merger forms) | |
| `movers` (MOST) | FMP → Nasdaq | No free licensed source |
| `sectors` (SECT) | FMP → SPDR sector ETFs on Nasdaq | |
| `curve` (GC, WACC) | US Treasury → Fed H.15 (via FRED) | A stale copy stands in; WACC reads the Treasury only |
| `macro` (ECO) | per series: BLS, BEA, EIA or the Treasury → FRED | FRED only where no original answers; never cached |
| `estimates` | FMP → Nasdaq → AI research | Staged: `terminal/street.ts` (FCST) |
| `crypto-market`, `defi`, `news` | CoinGecko; DefiLlama; EDGAR, Federal Register, GDELT | Staged: `crypto/*`, the news pipeline |
| `intraday` | none | No free licensed source |

The unverified backups (Nasdaq, CoinGecko, AI research) are off with `MARKET_BACKUP=off`. Public sources
(SEC, the Treasury, BLS, BEA, the EIA, the ECB, the World Bank, the CFTC) are not affected by it.

**Per-request order.** `resolveChain(dataset, { prefer, exclude, append })` puts preferred adapter ids
first, then the default order, then appended ones, and removes excluded ones; `fromChain(dataset, args,
opts)`, `historyFrom(…, opts)`, `quotes(…, opts)` and `quoteProfile(symbol, opts)` take the same options.
A request made for a person (`withDataUser`, see "Free sources & your own keys") uses that person's
saved order. Without either the default order applies. The adapter that answered is in the response's `x-data-sources`
(`sources: [{ id, label, provider }]`). Both routes build that header and Server-Timing with one
function, `sourceHeaders()` in `src/lib/market/source-header.ts`: providers, notes (an ETF stand-in's
label, "S&P 500 via SPY", which the registry also returns as the data's `label`), sources, the oldest
`asOf` and `oldestFetchedAt`, and `stale`/`delayed` when set; at most eight notes and eight sources.

**What counts as a failure.** Any `SourceError` kind (`src/lib/market/source-error.ts`): timeout,
network, a 5xx, a rate limit (FMP's "Limit Reach", our own FMP budget being full), a schema failure (an
unreadable body), an empty answer, or an open breaker. Any of them moves to the next source.

## Budgets

All numbers are in `src/lib/market/budgets.ts`, with the reason for each. Two modes:

| | Interactive (a route a person waits on) | Background (crons, Inngest, scripts) |
|---|---|---|
| Hedge: start the next source if the first has not answered | 2.5 s | never |
| FMP per attempt | 6 s, no retry | 10 s, one retry |
| Nasdaq, ECB, CoinGecko per attempt | 6 s, no retry | 12 s, one retry |
| SEC per attempt | 12 s | 25 s |
| Treasury, FRED, BLS per attempt | 8 s | 15 s |
| FMP budget slot wait before "busy" | up to ~3 s | up to ~7 s |
| AI research (both lookups) | 25 s, aborted | 25 s, aborted |

`/api/terminal/*` and `/api/companies` run interactive (`withMode("interactive", …)`). Everything else
is background unless it opts in.

**Hedging needs a reason.** No hedge when the first source's breaker is closed and this instance's last
5 minutes of calls to it (at least 20) have a p95 under 2.5 s and fewer than 5 % errors: then a slow call
waits for its own timeout. A hedge never aborts the first source, and each source caches under its own
key, so a late answer never overwrites the one that was served. A late answer usually fills its own
cache for the next request, but on serverless the instance may be frozen once the response is sent, so
that is not guaranteed.

**Worst case before a person sees an answer** (first source hangs, the backup answers; derived from the
budgets, and checked with stubbed sources in `scripts/test-datalayer.ts`):

| Command | Before | After |
|---|---|---|
| GP/HP/BETA/RISK (history) | 10 s, then a 504 (no fallback on a timeout) | 2.5 s + Nasdaq (two rounds) |
| DES/FA/COMPS price | 10 s + Nasdaq, per ticker | 2.5 s + Nasdaq |
| WEI/FXC/CMDTY | ~40 s and a blank board (quotes, then histories) | ≤ 6 s (quotes and histories at once; rows with no backup quote wait for FMP's timeout and use the last close) |
| SECT | 60 s, the route's limit; the ETF fallback never ran | 2.5 s + the ETF histories |
| MA | 10 s, then a 504 | 2.5 s + EDGAR full-text search |
| EE/ANR/DVD | 10 s, then a 504 | 6 s (FMP's timeout) + Nasdaq, + research ≤ 25 s |
| PULSE, first request of the day | 6 × 30 s = 180 s (route limit 120 s) | 2 × 30 s = 60 s (three states at once) |
| An SEC request behind a slow one | waits for it (2,982 ms measured behind a 3 s one) | ≤ 125 ms (starts paced at 8/s per process after the shared budget's slot, requests run at once) |
| AI research | up to ~360 s | ≤ 25 s |
| Any source whose breaker is open | its full timeout, every request | 0 s (skipped) |

## Stale-while-revalidate and stale-if-error

`cacheEntry()` / `cacheJson()` in `src/lib/cache.ts` keep `fetchedAt`, `freshUntil` and `staleUntil`
per entry:
- before `freshUntil`: the cached value;
- within `staleMs` after it: the cached value at once, **flagged stale**, while one refresh runs in the
  background (one per key per instance, and with `shared`, one across instances via the fill lease);
- within `staleIfErrorMs` after it: a refresh first; if it fails, the cached value, **flagged stale**;
- past `staleUntil`: never served (the row expires); the error comes through.

| Data | Fresh | Served stale while refreshing | Served stale when the source fails |
|---|---|---|---|
| FMP answers | per endpoint (quotes 1 min in US hours, bars 3 h, …) | as long again, up to 1 h | 1 day |
| Nasdaq, ECB, CoinGecko | per endpoint | as long again | 1 day |
| SEC documents, compact companyfacts | 6–12 h | as long again | 7 days |
| Company record (`company_cache`) | 6 h | up to 7 days (rebuilt in the background) | 7 days |
| Treasury curve (per year: this one 2 h, past ones 7 days), BLS, BEA, EIA, CFTC, World Bank | 2 h to 24 h | as long again | 3 days |
| FRED (H.15, H.10 and the ECO fallback) | never cached: one request at most (FRED's terms) | no | no |

Stale answers are flagged in `x-data-sources` (`stale: true`, `oldestFetchedAt`) and in Server-Timing
(`cache;desc="stale"`), so screens can show "Stale · as of …". A failed source is retried at most every
30 s per instance.

companyfacts goes through the shared cache in compact form (`src/lib/edgar/compact.ts`: the concepts the
app reads; 126 KB of 5 MB on the synthetic test document, real filers vary), so a new instance makes no SEC call for a company another
instance loaded. **Reading a new XBRL concept on an interactive path? Add it to `FACT_CONCEPTS`.** The cache key carries
a fingerprint of the list (`compactVersion()`), so entries compacted without the new concept are not read. The
XBRL concept browser and background jobs use `getCompanyFactsFull()`.

## Circuit breakers

One per source (`fmp`, `nasdaq`, `sec`, `treasury`, `fred`, `bls`, `bea`, `eia`, `ecb`, `worldbank`, `cftc`, `coingecko`; not the person-key sources, whose failures are one person's key), shared by every
instance in a `kv_cache` row `breaker:<source>` (`src/lib/market/breaker.ts`):
- **closed**: 10 outage-type failures within a minute open it (timeouts, network, 5xx, rate limits,
  schema; not "this symbol is not covered");
- **open**: calls are refused at once (`breaker-open`) and the chain moves on, for 30 s;
- **half-open**: one probe at a time across instances; success closes it, failure opens it for another 30 s.

A breaker that cannot be read fails open (the source is tried). A Nasdaq failure (or its open breaker)
while finding a symbol's asset class is not remembered as "not on Nasdaq"; only two well-formed empty
answers are. To close one by hand:
`breakers.reset("fmp")`, or delete its `kv_cache` row.

## Reading the stats and the health page

Every upstream call is recorded (source, endpoint, time, outcome, failure kind) and written per minute
to `source_stats` (migration `drizzle/0028_source_stats.sql`), in one batched upsert per instance at most
every 10 s, and after each terminal and `/api/companies` answer (`after()`). Calls still buffered when a
serverless instance is frozen or recycled are lost: it is telemetry, not a ledger. Rows with `op` starting `chain:` are the chain's own outcomes (which source answered when it
was not the first: fallbacks and hedges, and "nothing here" moves).

`GET /api/market/health` with `Authorization: Bearer $CRON_SECRET` returns:
- `results`: a live probe of each source from this deployment (FMP, Nasdaq, SEC data and full-text
  search, Treasury, FRED, BLS, ECB, CoinGecko, DefiLlama). The BLS probe spends one of its keyless 25
  daily requests;
- `sources`: per source, the last hour across all instances: `calls`, `p50`, `p95`, `maxMs`,
  `errorRate`, `kinds` (failures by kind), `fallbacks`, `hedges`, `empty`, and `breaker`;
- `chains`, `budgets`, `fmpDailyLimitHit`, `secUserAgentSet`, research settings.

What to watch: a breaker `open` for more than a couple of minutes; an `errorRate` above 5 % or
`fallbacks` climbing for FMP (users are on backups); `p95` near the timeouts above; `kinds.schema` above
zero (a provider changed its format); `secUserAgentSet: false` in production.

A quick SQL view (Neon console):

```sql
select source, sum(calls) calls, sum(failures)::float / nullif(sum(calls), 0) error_rate,
       sum(fallbacks) fallbacks, sum(k_timeout) timeouts, sum(k_schema) schema
from source_stats where minute > now() - interval '1 hour' and op not like 'chain:%'
group by source order by calls desc;
```

Rows older than 30 days are pruned automatically (now and then, by a flush, 5,000 at a time).

## Measuring real latency: `scripts/data-latency.mts`

The sandbox numbers in tests are synthetic. Real per-source latency comes from production:

```bash
# A signed-in session's Cookie header (devtools → Network → any /api request → Request headers → cookie)
export YB_COOKIE='better-auth.session_token=…'
pnpm exec tsx scripts/data-latency.mts --base https://<your-domain> --runs 10 \
  --tickers AAPL,MSFT,BRK.B --secret "$CRON_SECRET" --json latency.json
```

It calls each terminal command and `/api/companies`, and prints per command the wall time (first run
apart, then p50/p95/max) and statuses, and per source the server's own time from each answer's
Server-Timing (so it is the upstream's latency from `cle1`, not your laptop's). With `--secret` it also
prints the health page's hourly rollups. `--fns price,indices` limits the commands. Requests go one at a
time, 1 s apart (`--gap`); against anything but localhost it refuses more than 20 runs, more than 5
tickers or a gap under 500 ms. It measures, it is not a load test. Run it once at the
US open and once after the close; repeated runs mostly hit the cache, so read the per-source table and the
rollups for upstream latency.

## Licensing (owner notes)

From the research behind this work (`research.md`; vendor terms change, so confirm before signing):
- **FMP**: individual plans are for personal, non-commercial use. Showing FMP data to other people needs
  FMP's separate Data Display and Licensing Agreement (price not published; ask FMP). Until then, showing
  FMP prices to paying users is a terms risk.
- **Nasdaq.com backup**: an undocumented site API reached with browser-like headers. Nasdaq's site terms
  bar automated access for copying, and imitating a browser weakens any "public page" argument. It is the
  highest-risk source; `MARKET_BACKUP=off` turns it (and AI research) off. Recommended off in production
  until a licensed backup exists.
- **CoinGecko**: the free/demo API is non-commercial and requires attribution ("Data provided by
  CoinGecko" with a link). Commercial use needs a paid plan.
- **Delayed data notice**: exchange plans (UTP) treat 15-minute delayed display as mostly fee-free but
  require a visible "Delayed Data" notice. Screens should show the `delayed` flag from `x-data-sources`.
- SEC, Treasury, BLS and FRED's public-domain series are free to display; some FRED series carry
  third-party copyright (see `src/lib/market/fred.ts`). FRED's terms also bar caching and AI use: see
  "Free sources & your own keys" below.


## Free sources & your own keys

Code: `src/lib/market/sources-meta.ts` (what each source is and its licence), `registry.ts` (which source
serves what, in which order), `user-context.ts` (whose request), `byo/` (keys, their cache, the providers),
`fields.ts` (field-level fallthrough), `badges.ts` (what a screen says). Tests: `scripts/test-datasources.ts`
(stubbed providers built from their documented answers; no live data was fetched in writing them).

### Licences

Every adapter declares its licence, the credit it requires, its delay and the fields it fills; a test
fails if one does not, or if a dataset has no public, attribution or owner-licensed source and no
"no free source" note. Classes from the research (`free-sources.md`): (a) public, (a\*) public with
restrictions, (b) free with attribution, (b?) unconfirmed, (c) personal only.

| Licence in the registry | Class | Sources | Shown to |
|---|---|---|---|
| `public` | (a) | SEC EDGAR, US Treasury, BLS, BEA, EIA, CFTC, Federal Register | everyone; credit shown |
| `attribution` | (a), (a\*), (b) | ECB (cross rates "derived by YouBank", for information only), World Bank Pink Sheet (CC BY 4.0), FRED and the Fed's H.15/H.10 via FRED (a\*: no caching, no AI), GDELT (cite and link) | everyone; credit shown word for word |
| `owner-licensed` | per contract | FMP (YouBank's account) | everyone, subject to the owner's FMP display terms |
| `unverified` | (b?), (?) | Nasdaq.com, CoinGecko, DefiLlama, AI web research | everyone today; badged "Terms unverified"; Nasdaq, CoinGecko and research are off with `MARKET_BACKUP=off` |
| `user-key` | (c) | Tiingo, Twelve Data, Alpha Vantage, Finnhub, FMP with the person's own key | the key's owner only |

**Default chains by command, after this change** (first answers; licence class in brackets):

| Command | Chain |
|---|---|
| GP, HP, BETA, RISK, PORT, WEI | FMP (owner) → Nasdaq.com (unverified). No class a/b free source for prices (IEX HIST is next-day pcap; not built) |
| DES, COMPS (price, profile) | FMP (owner) → Nasdaq.com (unverified) → SEC submissions + SIC sector (a; never a price) |
| FA, CAP, DDIS, QUAL, XBRL, EQS, IRAT | SEC companyfacts and frames (a) |
| FIL, EVT, INS | SEC submissions and Form 4 (a) |
| EE | FMP (owner) → Nasdaq.com (unverified) → SEC XBRL EPS + 8-K 2.02 dates (a) → AI research (unverified) |
| ANR | FMP (owner) → Nasdaq.com (unverified) → AI research (unverified); no free source |
| DVD | FMP (owner) → Nasdaq.com (unverified) → SEC XBRL dividends per share (a) → AI research (unverified) |
| FCST (estimates) | FMP (owner) → Nasdaq.com → AI research; no free source |
| MA | FMP (owner) → SEC full-text search on merger forms (a) |
| MOST | FMP (owner) → Nasdaq.com (unverified); no free source |
| SECT | FMP (owner) → SPDR ETFs on Nasdaq.com (unverified) |
| GC | US Treasury par curve (a) → Fed H.15 via FRED (a\*, uncached) |
| ECO | per series: BLS (a) for CPI, core CPI, unemployment, payrolls; BEA (a) for real GDP, core PCE prices; EIA (a) for WTI; Treasury (a) for the 10-year and its spreads → FRED (a\*, uncached) for the rest (claims, IP, retail sales, housing starts, fed funds, Moody's spread, the broad dollar) |
| FXC | FMP (owner) → ECB via Frankfurter, then the ECB's API (a) → Fed H.10 via FRED (a\*, uncached) |
| CMDTY | FMP (owner) → EIA spot for WTI, Brent, Henry Hub (a) → ETF stand-ins on Nasdaq.com (unverified) → World Bank Pink Sheet, monthly (a, CC BY 4.0); CFTC COT positioning (a); crypto rows FMP → CoinGecko (unverified) |
| CRYP, TOKEN, DEFI, STBL, YLD, RWA | CoinGecko, DefiLlama (unverified) |
| TOP, NI, CN | EDGAR (a), Federal Register (a), GDELT (b) |

**What changed in the defaults** (all class-a data the app already relied on, or new fallbacks after the
existing ones):
- ECO: each series comes from its original publisher first; FRED, which was first for all 17 tiles, is now
  the fallback, and is never cached (it was cached 12 hours in kv_cache, against its June 2024 terms).
- EE: SEC filings answer before AI research when FMP and Nasdaq fail (actuals only; estimates say why
  they are empty).
- CMDTY: the EIA's spot prices answer before the ETF stand-ins for WTI, Brent and Henry Hub.
- FX and GC gain the Fed's H.10 and H.15 (via FRED) after the ECB and the Treasury.
- DES gains SEC as a last source, which can fill a missing name, exchange or sector, never a price.
- `MARKET_BACKUP=off` now switches off only the unverified backups; the ECB stays on.

### FRED, FINRA and crypto caveats

- **FRED.** The API terms (June 2024) bar "storing, caching, or archiving" FRED content, AI or ML use, and
  passing third-party series on. So FRED is a fallback only, kept for one request at most
  (`requestMemo`; a terminal answer that used it is sent `private, no-store`, so the browser does not keep
  it either, and the nightly bar store never saves it), shown with "Source: FRED, Federal Reserve Bank of
  St. Louis", and never sent to a model:
  every AI tool and the terminal's AI read run inside `forModel(…)` (user-context.ts), where FRED and the
  Fed's series read through it are not eligible (and no one's own keys are used either); the AI read also
  leaves out any ECO tile FRED answered. With the owner's BEA and EIA keys set, seven ECO tiles still come
  from FRED alone (claims, industrial production, retail sales, housing starts, fed funds, Moody's spread,
  the broad dollar), fetched on every uncached ECO request: watch FRED's rate limits. The Fed's own download program (DDP) is being retired (Build-Your-Package removal
  planned for the week of 9 November 2026), so H.15 and H.10 are read from FRED's copies.
- **FINRA** short interest and short-sale volume: not built. FINRA's terms allow only non-commercial use.
- **Crypto.** CoinGecko's free API and DefiLlama's terms are unconfirmed for a commercial product (marked
  `unverified`, badged on screen). Exchange APIs (Coinbase, Kraken, Binance) are personal-use and not used.
  CoinMarketCap Basic is the candidate to confirm.

### Your own keys (bring your own key)

A person may add a key for Tiingo, Twelve Data, Alpha Vantage, Finnhub or FMP in Settings → Data
sources. Massive is not offered (its individual terms forbid sharing a key). Alpaca is not offered:
Alpaca's documentation does not confirm that its OAuth tokens (which YouBank already holds for algo
trading) may call the market-data API, so reusing them is left until Alpaca confirms.

Rules, as built (each has a test):
- **Stored encrypted.** One AES-256-GCM blob per person (`user_data_sources.keys_enc`, migration 0029,
  `lib/crm/crypto` with `EMAIL_TOKEN_SECRET`); decrypted only on the server when a keyed source fetches.
  The page sees the last four characters, the plan type and the last test; a key is never sent back.
- **Plan type.** Each key records "individual" or "business". A team member adding an individual-plan
  FMP, Alpha Vantage or Finnhub key is warned (those terms say "not on behalf of a company").
- **Only for its owner.** Keyed answers are cached under `byo:v1:<hash of the person>:<provider>:…` in
  kv_cache, nowhere else; never in the shared `cj1:` entries, `company_cache`, R2 bars or news sparks.
  Shared code runs `publicOnly(…)` (the company record, R2 bar refreshes, news sparks), which sees the
  default order and no keys.
- **Never in jobs.** Keyed sources answer only inside `withDataUser` on an interactive request; background
  mode (crons, Inngest, scripts) skips them with "never in background jobs". Only the terminal route and
  the settings test set a data user (a test checks the source tree).
- **Never shared or exported.** Keyed data appears only in the person's own terminal answers, sent
  `private, no-store`. The AI read, exports, shared and collab views fetch their own data through the
  shared path, so they show the public value or "—" with the reason.
- **Purged on removal.** Removing (or replacing) a key deletes that person's cached data from that
  provider (Finnhub's terms require deletion when a subscription ends).
- **No key in logs, errors, headers or stats.** Keys go in headers where the provider allows (Tiingo,
  Twelve Data, Finnhub) and in the query only for Alpha Vantage and FMP; errors are rebuilt from the
  status and scrubbed; stats record the source id and dataset only; one person's refused key never opens a
  breaker for others.
- **Tests are rate-limited**: 10 key or chain tests a minute per person; checks of a pasted (new) key also
  stop at 20 a day per person and 30 an hour per address, so the check cannot be used to try stolen keys.
- **Changed under a lock.** Saving or removing a key, a key test and an order each change the person's row
  as stored, locked for the change: two saves at once keep both keys. A fetch in flight when its key is
  removed does not cache its answer after the purge.

### Choosing sources

- Settings → Data sources: per dataset, the person's order (up/down buttons), with licence badges,
  freshness, "Needs key" and the reason; Save, Reset, and Test (which source answered and how fast).
- In the terminal: `AAPL GP @tiingo`, or the "Source ▾" chip on a screen's badge, sets the source for that
  panel's main dataset only; "Make default" saves it first in the person's order.
- A source the person named that cannot answer (no key, a background job, switched off, not for this
  data) is skipped and the reason travels in `x-data-sources.skipped`.
- **Field-level fallthrough.** When the source that answered leaves a field empty (SEC has no price or
  estimates), the next eligible source that can fill it is asked (at most two, never AI research), and
  `x-data-sources.fields` says where each filled field came from, or why it is empty ("—", never a zero).
- **Badges** name the sources, show each one's required credit word for word (`attributions`), "Your key",
  "Backup source", "Delayed", "Stale · as of" and "Terms unverified". `x-data-sources` is ASCII-escaped so
  any text survives as a header value.

### Owner decisions

1. **FMP display licence** (unchanged): showing FMP data to paying users needs FMP's display agreement.
2. **Turn the Nasdaq backup off in production** (`MARKET_BACKUP=off`): it now leaves the public sources on.
3. **Register the free owner keys** so the originals answer instead of FRED: `BLS_API_KEY` (v2: 500 a
   day, 20 years), `BEA_API_KEY`, `EIA_API_KEY`. Without them those series fall back to FRED.
4. **FRED**: keep it as an uncached fallback, ask the St. Louis Fed for permission, or drop it.
5. **Hosted BYO keys**: get written confirmation from FMP, Alpha Vantage and Finnhub that a tool fetching
   with a person's own key on YouBank's server is not "permitting others access"; firms need business
   plans. A browser-only mode (the key never leaves the device) is not built.
6. **Crypto**: confirm CoinMarketCap Basic or a paid CoinGecko plan; ask DefiLlama for written consent.
7. **World Bank Pink Sheet link**: the Bank republishes the workbook at new addresses; set
   `WORLD_BANK_PINK_SHEET_URL` (it must stay on thedocs.worldbank.org) if the default stops answering.
8. **Alpaca market data via OAuth**: ask Alpaca; if confirmed, it is the cleanest BYO pattern.
9. Apply migration `drizzle/0029_data_sources.sql`. `EMAIL_TOKEN_SECRET` must be set to save keys;
   rotating it makes saved keys unreadable (people add them again).

## Not built yet

A security master, reconciliation between sources, nightly SEC bulk files, IEX HIST ingestion, FINRA
short data, a browser-only key mode, intraday sources, and converting the staged crypto datasets into
single-request adapters.
