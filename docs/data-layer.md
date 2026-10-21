# The market-data layer

How YouBank gets prices, fundamentals and macro data, what happens when a source fails, and how to see
it. Code: `src/lib/market/` (registry, chain, budgets, breaker, stats, provenance), `src/lib/cache.ts`,
`src/lib/edgar/client.ts`. Tests: `scripts/test-datalayer.ts`.

## Sources and fallbacks

Every source is listed once, in `src/lib/market/registry.ts`, by dataset. Each dataset has an ordered
chain of adapters; the default order is below. Adding a source is one entry there.

| Dataset | Default chain (first answers; the next on any failure) | Notes |
|---|---|---|
| `daily-bars` (stocks, ETFs, indices, commodities) | FMP → Nasdaq | Indices and commodities use a tracking ETF on Nasdaq (S&P 500 via SPY), labelled `via` |
| `fx` | FMP → ECB reference rates | ECB is a daily fixing, labelled "ECB fixing" |
| `crypto` (BTC, ETH, SOL bars) | FMP → CoinGecko | |
| `quote` | FMP → Nasdaq | Not for FX, crypto or proxied symbols (boards use the last close) |
| `profile` (DES/FA/COMPS price, cap, range) | FMP → Nasdaq | |
| `fundamentals`, `filings` | SEC EDGAR | A stale copy stands in when SEC fails |
| `deals` (MA) | FMP → SEC full-text search | |
| `movers` (MOST) | FMP → Nasdaq | |
| `sectors` (SECT) | FMP → SPDR sector ETFs on Nasdaq | |
| `curve` (GC, WACC) | US Treasury | A stale copy stands in |
| `macro` (ECO) | FRED, BLS (each covers its own series) | A stale copy stands in |
| `earnings`, `estimates`, `analysts`, `dividends` | FMP → Nasdaq → (SEC for dividends) → AI research | Staged: `terminal/street.ts` runs them in this order |
| `crypto-market`, `defi` | CoinGecko; DefiLlama | Staged: `crypto/*` |
| `intraday` | none yet | |

Backups (Nasdaq, the ECB, CoinGecko, AI research) are off with `MARKET_BACKUP=off`.

**Per-request order.** `resolveChain(dataset, { prefer, exclude })` puts preferred adapter ids first and
removes excluded ones; `fromChain(dataset, args, opts)`, `historyFrom(…, opts)`, `quotes(…, opts)` and
`quoteProfile(symbol, opts)` take the same options. Without options the default order applies. Nothing
is stored per person yet. The adapter that answered is in the response's `x-data-sources`
(`sources: [{ id, label }]`).

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
| Treasury curve, FRED, BLS | 2 h, 12 h | as long again | 3 days |

Stale answers are flagged in `x-data-sources` (`stale: true`, `oldestFetchedAt`) and in Server-Timing
(`cache;desc="stale"`), so screens can show "Stale · as of …". A failed source is retried at most every
30 s per instance.

companyfacts goes through the shared cache in compact form (`src/lib/edgar/compact.ts`: the concepts the
app reads; 126 KB of 5 MB on the synthetic test document, real filers vary), so a new instance makes no SEC call for a company another
instance loaded. **Reading a new XBRL concept on an interactive path? Add it to `FACT_CONCEPTS`.** The cache key carries
a fingerprint of the list (`compactVersion()`), so entries compacted without the new concept are not read. The
XBRL concept browser and background jobs use `getCompanyFactsFull()`.

## Circuit breakers

One per source (`fmp`, `nasdaq`, `sec`, `treasury`, `fred`, `bls`, `ecb`, `coingecko`), shared by every
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
  third-party copyright (see `src/lib/market/fred.ts`).

## Not built yet

Per-person source preferences and their storage (the registry takes them per request), new providers,
converting the staged Street and crypto datasets into single-request adapters, a security master,
reconciliation between sources, and nightly SEC bulk files.
