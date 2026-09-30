# Load test

Signed-in users driving a **local production build** that runs on a **Neon test branch**, with every
outside service switched off. Never point it at production: the scripts refuse any host that is not
localhost, or a Vercel preview when `LOADTEST_ALLOW_PREVIEW=1` is set (and only a preview with its own
database).

## Pieces

| File | What it does |
|---|---|
| `offline.mjs` | Sandbox preloaded into `next start` (`NODE_OPTIONS=--import`). Outbound requests may reach only localhost and the test branch's own database and auth. Neon's regional API host is allowed only when the connection string names the test branch. FMP, SEC, Nasdaq and the government sources are refused. OpenAI answers with a canned streamed reply. It counts database queries and auth calls per second into `LOADTEST_STATS`. It refuses to load on Vercel. |
| `setup.mjs` | Signs up N users through the app's own auth route (waiting out the auth rate limit), onboards each with a role, and gives every third one a blank Studio document. It writes users and session cookies to a file **outside the repo**. |
| `run.mjs` | The load. `--mode mixed` runs virtual users with think time over page loads, the Newsroom feed and bell, company data, deals, the brief, Studio documents and 5% AI chat. Streams follow documents while a writer edits them, which measures edit-to-screen time. `--mode idle-streams` holds streams open and does nothing else. `--sessions stale` starts everyone with an expired signed session cookie. It reports p50/p95/p99, error rate and requests/s per scenario, and DB queries/s from the sandbox counter. |
| `common.mjs` | Argument parsing, the production guard, percentiles. |

## Running it

1. **Test branch.** Pick a Neon branch (not production) with Neon Auth enabled. Put its
   `DATABASE_URL`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL` and a 32+ character
   `NEON_AUTH_COOKIE_SECRET` into an env file outside the repo, along with:
   - `OPENAI_API_KEY=sk-loadtest-mock`, `OPENAI_MODEL=gpt-5.6-luna`, `ANTHROPIC_API_KEY=`;
   - `FMP_API_KEY=`, `MARKET_BACKUP=off`;
   - `YOUBANK_NO_DISK_CACHE=1`, as on Vercel.

   Set every key the server reads explicitly: `next start` also loads `.env.local`, and a key set in
   the environment wins.
2. **Build.** Run `pnpm build`. To compare with an older commit, check it out and run
   `NEXT_DIST_DIR=.next-before pnpm build`.
3. **Serve** inside the sandbox:
   ```sh
   set -a; . /path/to/loadtest.env; set +a
   LOADTEST_STATS=/tmp/stats.json NODE_OPTIONS="--import $PWD/scripts/load/offline.mjs" \
     node node_modules/next/dist/bin/next start -p 3999
   ```
   Start `next` directly: through `pnpm exec`, the preload also runs in the pnpm process and
   overwrites the stats file.
4. **Users:** `node scripts/load/setup.mjs --base http://localhost:3999 --users 60 --out /tmp/users.json`
5. **Load:**
   ```sh
   node scripts/load/run.mjs --base http://localhost:3999 --users /tmp/users.json --vus 60 --streams 20 --duration 60 --stats /tmp/stats.json --out /tmp/result.json
   node scripts/load/run.mjs ... --mode idle-streams --streams 20
   node scripts/load/run.mjs ... --sessions stale --streams 0 --duration 30
   ```

Run a short warm-up first (a 15-second run with fewer users) so cold module loads are not counted.
Latencies include the round trip from this machine to Neon, so compare builds with each other rather
than with production, where functions run next to the database.
