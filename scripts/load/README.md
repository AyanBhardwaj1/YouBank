# Load test

Signed-in users driving a **local production build** on a **test database** (a local Postgres, or a
Neon test branch), with every outside service switched off. Never point it at production: the scripts
refuse any host that is not localhost, or a Vercel preview whose hostname `LOADTEST_ALLOW_PREVIEW` names
exactly (and only a preview with its own database; never the production site, its aliases or the main
branch's preview). The database side refuses anything but a local database, unless
`LOADTEST_DB_CONFIRM` names the test branch's host exactly, and seeding refuses a database whose users
are mostly not load-test users. docs/scale.md has the latest numbers and what to set at hundreds of users.

## Pieces

| File | What it does |
|---|---|
| `offline.mjs` | Sandbox preloaded into `next start` (`--import`). Outbound HTTP may reach only this machine: FMP, SEC, Nasdaq, OpenFIGI and the government sources are refused (the database is a `postgres://` connection, and sign-in is Better Auth on that database, so neither needs the network). OpenAI answers with a canned streamed reply. Every second it writes to `LOADTEST_STATS` the event loop's delay, the process's CPU time, heap and RSS, and counts of blocked calls. It refuses to load on Vercel. |
| `setup.mjs` | Signs up N users through the app's own Better Auth route (locally each from its own `x-real-ip`, so the 50-an-hour sign-up limit per address does not throttle it), onboards each with a role, and gives every third one a blank Studio document. Then it seeds realistic volumes with SQL (`--seed`, on by default): per user 200 contacts, 150 mail threads with 3 messages each, 40 pipeline deals, 20 drafts, 4 Studio models, 120 Newsroom reads and saves, 150 bell notifications, 5 followed stories, 3 algo strategies with 30 decisions each, 5 followed 13F funds, 200 calendar events, 60 AI usage rows, 5 Edge watches, peer groups and comps; one in three on Pro and one in thirty owning a Deal Team with four seats given; shared: 6,000 Newsroom stories with 18,000 articles, 600 deals, 5,000 quant signals, 200 13F filers with 600 filings, and company records for the tickers the load asks for. Re-running replaces only the seeded rows. It writes users and session cookies to a file **outside the repo**. |
| `run.mjs` | The load. `--mode mixed` runs virtual users with 1 to 3 s of think time over page loads, the Newsroom feed and bell, company data, the CRM inbox and pipeline, Studio lists and documents, the plan page (entitlements and the AI allowance), Edge, copy trading, algo, quant, calendar, deals, the brief and 4% AI chat. Streams follow documents while a writer edits them (edit-to-screen time). `--mode idle-streams` holds streams open and does nothing else. `--sessions stale` starts everyone with the signed session cookie dropped (their first request reads the session from the database). It reports p50/p95/p99, error rate and requests/s per scenario; from Postgres (`--db`): statements run (pg_stat_statements when installed, else transactions), statements per request, the app's connections (open, active, idle in transaction, sampled every second) and the slowest statements; from the sandbox (`--stats`): server CPU per request, event-loop delay and memory. |
| `vitals.mjs` | Core Web Vitals for the main pages from a headless Chrome. |
| `common.mjs` | Argument parsing, the production guard, percentiles. |

## Running it locally

1. **Database.** Postgres 16 with pgvector and PostGIS. Set up the schema as `scripts/db-setup.mts` says
   (`extensions`, `drizzle-kit push --force`, `finish`). For per-statement numbers, load
   `pg_stat_statements` (`shared_preload_libraries`, a restart, then
   `create extension pg_stat_statements schema monitor`: its own schema keeps `drizzle-kit push` from
   trying to drop its views).
2. **Env file** outside the repo, with every key the server reads set explicitly (`next start` also
   loads `.env.local`, and a key set in the environment wins):
   ```sh
   DATABASE_URL=postgres://postgres:postgres@localhost:5432/yb_scale
   BETTER_AUTH_SECRET=<32+ characters>
   BETTER_AUTH_URL=http://localhost:3301
   NEXT_PUBLIC_SITE_URL=http://localhost:3301
   OPENAI_API_KEY=sk-loadtest-mock
   OPENAI_MODEL=gpt-5.6-luna
   ANTHROPIC_API_KEY=
   FMP_API_KEY=
   MARKET_BACKUP=off
   YOUBANK_NO_DISK_CACHE=1
   ```
3. **Build.** `pnpm build`. To compare with an older commit, check it out and run
   `NEXT_DIST_DIR=.next-before pnpm build` (then `git checkout tsconfig.json`: the build adds the extra
   directory to it).
4. **Serve** inside the sandbox (start `node` directly: through `pnpm exec` the preload also runs in
   pnpm's process and overwrites the stats file):
   ```sh
   set -a; . /path/to/loadtest.env; set +a
   LOADTEST_STATS=/tmp/stats.json node --import ./scripts/load/offline.mjs node_modules/next/dist/bin/next start -p 3301
   ```
5. **Users and data:** `node scripts/load/setup.mjs --base http://localhost:3301 --users 300 --out /tmp/users.json --db $DATABASE_URL`
6. **Load**, after a short warm-up (15 s, 20 users) so cold module loads are not counted:
   ```sh
   for v in 50 100 200 300; do
     node scripts/load/run.mjs --base http://localhost:3301 --users /tmp/users.json --db $DATABASE_URL \
       --vus $v --streams 20 --duration 60 --stats /tmp/stats.json --label run-$v --out /tmp/run-$v.json
   done
   node scripts/load/run.mjs ... --mode idle-streams --streams 100
   node scripts/load/run.mjs ... --sessions stale --streams 0 --duration 30
   ```

## Against a Neon test branch

1. Create a branch from production in the Neon console (or `neonctl branches create --name loadtest`);
   it is a copy, so seeding it touches nothing real. Take its **pooled** connection string for
   `DATABASE_URL` and its direct one for migrations, and apply any migration the branch lacks
   (`scripts/apply-sql.mts`).
2. Put the branch's host in `LOADTEST_DB_CONFIRM` (exactly, e.g.
   `ep-cool-name-123456-pooler.us-east-2.aws.neon.tech`), so the sandbox, setup and run accept it.
3. Build, serve, set up and run as above. `pg_stat_statements` is available on Neon
   (`create extension pg_stat_statements`); without it `run.mjs` counts transactions instead.
4. Latencies include the round trip from this machine to Neon: compare builds with each other, not with
   production, where functions run next to the database. Delete the branch afterwards.
