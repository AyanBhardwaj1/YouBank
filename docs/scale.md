# Scale: hundreds of people at once

What one server instance and the database handle, what to set on Neon, Vercel and Inngest for a few
hundred concurrent users, and how to measure it again. Measured locally (October 2026) with the load
test in `scripts/load/` (its README has every option). **Local Postgres is not Neon**: a statement's
round trip here is about 0.1 ms, on Neon from `cle1` about 1 to 2 ms, so sequential queries cost more
there and the database numbers below are a floor. Compare the columns with each other.

## How it was measured

- **Machine:** 4 cores shared by the server (one Node process, which is roughly one Fluid instance's one
  vCPU), the load generator, Postgres 16 and other work. Latencies moved with whatever else ran; **CPU
  per request** and **statements per request** are the steady numbers.
- **Data:** 300 users signed up through Better Auth, with per-user volumes seeded by
  `scripts/load/setup.mjs` (200 contacts, 150 threads, 40 deals, 150 notifications, 120 Newsroom reads,
  200 calendar events, strategies, 13F follows, AI usage, plans and seats) and 6,000 shared stories.
- **Load:** 50, 100, 200 and 300 virtual users, each a request every 1 to 3 seconds (a real person
  polls every 20 to 60 seconds, so 300 virtual users is the traffic of a few thousand people), for 60
  seconds after a warm-up, over 18 endpoints; 20 open Studio documents being edited meanwhile; AI chat
  answered by a mock that streams for about a second (left out of the headline percentiles, which it
  would otherwise sit on).
- **Before and after** ran back to back per level, each on a fresh server: the code before this pass
  on the database without migration 0027's indexes, then the code after it with them.

## Results

| VUs | build | req/s | errors | p50 ms | p95 ms | p99 ms | DB statements / request | DB statements / s | connections: open / active max / active avg | CPU ms / request | event-loop delay p99 (ms, median second) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 50 | before | 21.5 | 0.00% | 15 | 50 | 113 | 6.23 | 134 | 12 / 4 / 0.3 | 13.9 | 5.6 |
| 50 | after | 22.0 | 0.00% | 12 | 44 | 78 | 4.95 | 109 | 10 / 3 / 0.2 | 12.7 | 6.9 |
| 100 | before | 42.8 | 0.00% | 31 | 290 | 866 | 5.62 | 240 | 12 / 5 / 0.8 | 12.2 | 12.0 |
| 100 | after | 43.4 | 0.00% | 23 | 107 | 231 | 4.21 | 183 | 10 / 9 / 0.6 | 10.2 | 13.1 |
| 200 | before | 78.9 | 0.00% | 100 | 888 | 1828 | 5.15 | 407 | 12 / 6 / 2.1 | 10.9 | 15.5 |
| 200 | after | 82.0 | 0.00% | 43 | 632 | 1383 | 3.85 | 316 | 10 / 9 / 2.2 | 9.2 | 16.7 |
| 300 | before | 86.3 | 0.00% | 819 | 2700 | 3639 | 5.26 | 454 | 12 / 9 / 2.9 | 11.0 | 19.9 |
| 300 | after | 116.3 | 0.00% | 144 | 909 | 2290 | 3.76 | 438 | 10 / 10 / 4.5 | 8.8 | 16.0 |

Latency percentiles leave out the mock AI chat (its own row shows it). Errors were 0% at every level, before
and after. Pages (`/app`, `/app/news`) now share the instance's one pool with the API (10 connections
instead of a private 6 beside the API's 6) and were slower at 200 and 300 in this run; repeated runs at 300
moved by more than that either way (machine noise), so treat the page rows as unchanged.

Per endpoint at 100 virtual users (ms, before → after):

| endpoint | p50 | p95 | p99 | errors |
|---|---|---|---|---|
| notification bell | 15 → 11 | 184 → 58 | 540 → 134 | 0 → 0 |
| news feed | 46 → 37 | 554 → 121 | 1013 → 209 | 0 → 0 |
| page /app | 53 → 41 | 201 → 155 | 415 → 318 | 0 → 0 |
| companies | 27 → 13 | 479 → 69 | 866 → 134 | 0 → 0 |
| crm pipeline | 32 → 24 | 1105 → 96 | 1276 → 212 | 0 → 0 |
| page /app/news | 41 → 38 | 223 → 196 | 451 → 348 | 0 → 0 |
| crm inbox | 20 → 19 | 181 → 85 | 643 → 231 | 0 → 0 |
| ai chat (mock) | 961 → 966 | 1451 → 1095 | 2212 → 1202 | 0 → 0 |
| brief | 39 → 28 | 678 → 93 | 905 → 287 | 0 → 0 |
| plan + ai allowance | 29 → 19 | 608 → 91 | 1100 → 111 | 0 → 0 |
| copy follows | 15 → 10 | 268 → 63 | 544 → 114 | 0 → 0 |
| algo hub | 30 → 13 | 491 → 64 | 962 → 137 | 0 → 0 |
| deals | 10 → 6 | 72 → 48 | 260 → 94 | 0 → 0 |
| calendar upcoming | 14 → 11 | 125 → 40 | 497 → 75 | 0 → 0 |
| studio list | 17 → 13 | 316 → 220 | 620 → 260 | 0 → 0 |
| quant status | 33 → 12 | 294 → 85 | 401 → 226 | 0 → 0 |
| edge | 10 → 9 | 164 → 67 | 549 → 170 | 0 → 0 |
| studio document | 22 → 22 | 230 → 95 | 378 → 148 | 0 → 0 |

Per endpoint at 300 virtual users, where one process saturates (ms, before → after):

| endpoint | p50 | p95 | p99 | errors |
|---|---|---|---|---|
| news feed | 1396 → 204 | 3074 → 1131 | 3843 → 2350 | 0 → 0 |
| notification bell | 448 → 98 | 907 → 620 | 1317 → 1795 | 0 → 0 |
| page /app | 111 → 193 | 394 → 732 | 536 → 1877 | 0 → 0 |
| companies | 1301 → 85 | 2430 → 485 | 2857 → 1216 | 0 → 0 |
| crm pipeline | 2498 → 220 | 3705 → 1232 | 4934 → 2586 | 0 → 0 |
| page /app/news | 110 → 203 | 335 → 680 | 491 → 1492 | 0 → 0 |
| crm inbox | 1285 → 160 | 2628 → 1094 | 2888 → 2534 | 0 → 0 |
| plan + ai allowance | 1506 → 167 | 3297 → 1540 | 4089 → 2776 | 0 → 0 |
| ai chat (mock) | 3599 → 1359 | 5506 → 4294 | 6266 → 5314 | 0 → 0 |
| brief | 1825 → 281 | 3729 → 2574 | 4582 → 3164 | 0 → 0 |
| algo hub | 1658 → 145 | 2739 → 1039 | 3465 → 2550 | 0 → 0 |
| calendar upcoming | 444 → 90 | 1104 → 719 | 1328 → 1961 | 0 → 0 |
| deals | 22 → 13 | 143 → 72 | 359 → 747 | 0 → 0 |
| studio list | 872 → 214 | 1468 → 804 | 1908 → 2204 | 0 → 0 |
| copy follows | 436 → 96 | 1006 → 606 | 1458 → 987 | 0 → 0 |
| edge | 421 → 102 | 1287 → 868 | 1622 → 1811 | 0 → 0 |
| quant status | 841 → 114 | 1442 → 823 | 1840 → 2454 | 0 → 0 |
| studio document | 1239 → 249 | 2448 → 1006 | 3353 → 2083 | 0 → 0 |

## Capacity, from these numbers

- **One instance (one vCPU)** serves about **45 requests a second** of this mix with p95 near 100 ms,
  and 80 to 115 a second with its CPU full (200 to 300 virtual users: latency then grows with the
  queue; nothing failed). After this pass a request costs about **9 to 10 ms of CPU** under load
  (before: 11 to 14). Vercel adds instances as CPU fills, so the platform is not the limit at hundreds
  of people.
- **The database** ran **3.8 to 4.9 statements per request** (before: 5.2 to 6.2), about 320 a second
  at 200 virtual users, with at most 10 connections active at once even at 300. Every hot statement
  takes well under a millisecond on the seeded data (the heaviest, the feed's articles, about 1 ms).
- **Rule of thumb:** a few hundred people online is about 10 to 30 requests a second, a tenth of what
  one instance handled here. The next limits are Neon's compute (CPU, a slider) and, for live Studio
  documents, the polling of open streams (docs/launch-readiness.md, section 2).

## Settings for hundreds of users

### Neon

| Setting | Value | Why |
|---|---|---|
| Plan | Launch or Scale (not Free) | Free caps storage at 512 MB a branch and compute hours a month. |
| Compute | Autoscaling 0.5 to 4 CU on the production branch | 1 CU handled this whole test's database load with room to spare; 4 CU is headroom for the nightly passes and spikes. |
| Scale to zero | Off on production (where the plan allows) | A waking compute adds a second or two to the first request. |
| Connection | `DATABASE_URL` = the **pooled** address (`-pooler` in the host); `DATABASE_URL_UNPOOLED` = the direct one, for migrations only | The pooler (PgBouncer, transaction mode) takes up to 10,000 client connections and runs them on a server-side pool of about 0.9 × `max_connections`. |
| `max_connections` | Set by compute size: about 450 per CU (roughly 225 at 0.5 CU, 900 at 2 CU, 1,800 at 4 CU; Neon's docs have the table) | Only the pooler's server-side pool uses these. |
| Statement timeout | 30 s on the app's role (`scripts/db-setup.mts finish`) | A stuck query cannot hold a connection for long. |
| `pg_stat_statements` | `create extension pg_stat_statements` | The slow-query list in the console and the load test's statement counts. |
| Migration 0027 | `scripts/apply-sql.mts drizzle/0027_scale.sql` (direct address) | The indexes and the AI spend totals; `/api/health` names it until applied. |

### Vercel

| Setting | Value | Why |
|---|---|---|
| Plan | Pro before charging anyone (Hobby forbids commercial use) | Also longer logs and higher limits. |
| Region | `cle1` (already in `vercel.json`) | Next to Neon's `aws-us-east-2`: each query is a 1 to 2 ms round trip. |
| Fluid compute | On (Settings → Functions) | One instance serves many requests at once, so connections and caches are shared. |
| Function CPU | Standard (1 vCPU) | About 85 requests a second an instance here; choose Performance only if p95 climbs while the database is idle. |
| `DB_POOL_MAX` | 10 (the default) | Statements one instance runs at once. At 300 virtual users at most 10 were active; instances × 10 stays far under the pooler's 10,000. Raising it on a busy instance only queues more work on its one CPU (measured: 20 was slower at 300). |
| `FMP_CALLS_PER_MINUTE` | Your FMP plan's per-minute limit minus a margin (250 for Starter's 300) | Every instance shares this budget. |
| `EDGAR_USER_AGENT` | A real contact address | SEC's rule; the 8-a-second budget is shared by every instance. |
| `AGENT_POOL`, `CALENDAR_POOL`, `AUTOPILOT_POOL` | 4 to 8 | People visited at once by the daily passes, each least recently served first within a 270 s budget; raise them before the passes stop reaching everyone in a day. |

### Inngest

- Paid plan once background work passes the free tier (`EDGE_INNGEST_MONTHLY` keeps YouBank under it).
- Concurrency is set in code (`src/lib/edge/functions.ts`, `src/lib/algo/functions.ts`): two runs per
  person for canvases and document reads, one per person for refinements, four at once across the
  account for anything that calls the ML service (match it to the Modal app's concurrency), and one run
  at a time for each cron, which works through everyone in steps (algo ticks: 12 a step, different
  people side by side; thesis ticks: up to 40 an hour).

## Running it again on a Neon test branch

1. Branch production in the Neon console (or `neonctl branches create --name loadtest`) and apply any
   missing migration to it.
2. Write an env file outside the repo with the branch's pooled `DATABASE_URL`, `BETTER_AUTH_SECRET`,
   `BETTER_AUTH_URL` and `NEXT_PUBLIC_SITE_URL` set to `http://localhost:3301`, and the mock and
   offline keys from `scripts/load/README.md`; set `LOADTEST_DB_CONFIRM` to the branch's host.
3. `pnpm build`, then serve inside the sandbox and run setup and the levels:
   ```sh
   set -a; . /path/to/loadtest.env; set +a
   LOADTEST_STATS=/tmp/stats.json node --import ./scripts/load/offline.mjs node_modules/next/dist/bin/next start -p 3301 &
   node scripts/load/setup.mjs --base http://localhost:3301 --users 300 --out /tmp/users.json --db "$DATABASE_URL"
   for v in 50 100 200 300; do
     node scripts/load/run.mjs --base http://localhost:3301 --users /tmp/users.json --db "$DATABASE_URL" \
       --vus $v --streams 20 --duration 60 --stats /tmp/stats.json --label neon-$v --out /tmp/neon-$v.json
   done
   ```
4. Read statements per request, active connections and the slowest statements from the output; latency
   includes this machine's round trip to Neon. Delete the branch afterwards.

## What changed in this pass

| Area | Change | Files |
|---|---|---|
| Connections | One postgres.js pool per process, not one per build layer (12 connections from one instance at `DB_POOL_MAX=6` before); the same for every in-memory cache | `src/lib/shared.ts`, `src/db/index.ts` |
| Indexes | Unread bell count, hidden and recent Newsroom reads, the pipeline, contacts, needs-reply, peer groups | `drizzle/0027_scale.sql` |
| Round trips | CRM counts in one statement; feed, brief and reader reads in parallel; thread activity in parallel | `src/lib/crm/db.ts`, `src/lib/news/*.ts` |
| Pagination | Keyset cursors for the pipeline, inbox and bell | `src/lib/cursor.ts` |
| Per request | Entitlements reused (React cache was keyed on a fresh object, so it never hit); verified sessions reused for 30 s; company records and quant aggregates memoized | `src/lib/billing/entitlements.ts`, `src/lib/auth/user.ts`, `src/lib/company.ts` |
| Stampedes | The desk brief built once across instances; market data refilled once across instances; SEC documents fetched once per instance | `src/lib/news/brief.ts`, `src/lib/cache.ts`, `src/lib/edgar/client.ts` |
| Correctness | Atomic AI spend totals (sharded, so no hot row); seats locked per owner; a unique index for Edge deal signals | `src/lib/ai/spend.ts`, `src/lib/billing/seats.ts` |
| Providers | Shared FMP per-minute budget; SEC never goes over its shared budget | `src/lib/market/fmp.ts` |
| Jobs | Per-person and ML-service concurrency keys; bigger, per-owner algo and thesis batches | `src/lib/edge/functions.ts`, `src/lib/algo/functions.ts` |

Checked and left as they were: Stripe's webhook (idempotent by construction: rows rewritten from
Stripe's current state, packs unique per payment intent), Recall's (a lease per message id), order
placement (a one-way `proposed → placing` claim and a unique client order id), outbound timeouts (every
fetch has one), transactions (none spans an outside call), and `Promise.all` fan-outs (all bounded).

## Remaining risks

- The app's pages (`src/app/app/*`) still read the profile and the home counts directly; they are cheap
  with the new indexes but not shared with the API's caches.
- Sessions: a verified cookie is reused for up to 30 seconds per instance (never past the session's or
  the signed cookie's own expiry). Signing out, revoking a session, signing other sessions out (or a
  password change that does) and account changes take effect at once on the instance that handled them,
  even for a copied cookie. On other instances a revoked cookie keeps working for up to those 30 seconds
  from this cache and, as before this pass, for up to `AUTH_SESSION_DATA_TTL` (15 minutes by default)
  from Better Auth's own signed cookie cache, which does not ask the database while fresh. Lower
  `AUTH_SESSION_DATA_TTL` (60 seconds at least) to shorten that window at the cost of a session read per
  request.
- A plan change reaches other instances within 15 seconds (entitlements, AI caps); this month's AI spend
  still comes from the ledger, so a person running two AI runs on two instances can pass the monthly cap
  by about one call's cost.
- The Newsroom feed is the largest response (about 150 KB of JSON for 120 stories; Vercel compresses it
  to about a fifth).
- FMP's "Limit Reach" answer stops market data for 30 minutes whether the per-minute or the daily limit
  was hit; the shared budget keeps the per-minute one from being reached.
- `auth_accounts` has no unique index on the provider's account id: two simultaneous first sign-ins
  with Google could create two rows. Add one after checking production for duplicates.
- Open Studio documents poll their event log (shared per document per instance); thousands of open
  documents need design B or C in docs/launch-readiness.md.
