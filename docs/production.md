# Running YouBank in production

The owner's runbook: what has to be set where, how to ship the first time, how to move to a custom
domain, how to tell whether the site is healthy, and what to do when something it depends on is down.
It describes the code as it is now (Vercel Hobby, region `cle1`; Neon Postgres; self-hosted Better Auth;
Inngest; Stripe; a Modal ML service; Neon Functions heartbeats). The full list of every variable is in the
README's [Environment variables](../README.md#environment-variables); this page covers the ones that
decide whether the site works.

Contents:

1. [Environment variables](#environment-variables)
2. [First deploy](#first-deploy)
3. [Switching to a custom domain](#switching-to-a-custom-domain)
4. [Health and monitoring](#health-and-monitoring)
5. [When something is down](#when-something-is-down)
6. [How the app copes with failure](#how-the-app-copes-with-failure)
7. [Vercel Hobby limits, and when to upgrade](#vercel-hobby-limits-and-when-to-upgrade)
8. [Security settings](#security-settings)
9. [Known risks](#known-risks)

At hundreds of people online at once, see [docs/scale.md](scale.md): measured capacity, the Neon, Vercel
and Inngest settings to use, and how to rerun the load test against a Neon test branch.

---

## Environment variables

Set them in Vercel: Project → Settings → Environment Variables. **A change reaches only new deployments**:
redeploy afterwards (Deployments → the latest → Redeploy). Names only are ever logged or shown; values never.

On startup every instance checks them and logs one line each (Vercel → Logs):
- `"level":"error","msg":"environment check: the app cannot run"`: a required variable is missing. Pages
  show "YouBank is being set up" and `/api/health` answers `down`.
- `"level":"warn","msg":"environment check"`: a production variable is missing or malformed. The feature it
  belongs to is off; `/api/health` answers `degraded`.
- `"msg":"features off"`: optional features without their keys (expected).
- `"msg":"real-money switches off"` (or `ON: …` as a warning): the copy-trading and algo live switches.

Columns: **P** Production, **V** Preview, **D** Development (`vercel env pull`). "Own" means Preview should
get its own value, not production's.

### Required (the app does not run without them)

| Variable | Where to get it | P | V | D | Notes |
|---|---|---|---|---|---|
| `DATABASE_URL` | Neon → project → Dashboard → Connect → **Pooled connection** | yes | own | own | Must be the `-pooler` host. Health flags Neon's direct host. No `channel_binding` parameter. |
| `DATABASE_URL_UNPOOLED` | Same dialog, pooling **off** (direct host) | yes | own | own | Only for migrations and `scripts/db-setup.mts`; the app never uses it. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` | yes | own | own | 32+ characters. Never rotate it under traffic: everyone is signed out. |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | platform.openai.com / console.anthropic.com | yes | own | own | With `AI_PROVIDER` (`openai` or `anthropic`). Without either, AI is off and the rest works. |

### Production settings (a feature is off without each)

| Variable | Where to get it | P | V | Notes |
|---|---|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Your address, e.g. `https://youbank-nu.vercel.app` | yes | no | Inlined at build time. Links in emails, Stripe return pages, the sitemap, OAuth redirect defaults. |
| `CRON_SECRET` | `openssl rand -hex 32` | yes | no | Vercel Cron sends it as a bearer token; `/api/health` operators use it too. |
| `AUTOPILOT_SECRET` | `openssl rand -hex 32` | yes | no | The Neon Functions heartbeats send it. |
| `EDGAR_USER_AGENT` | `YouBank you@yourdomain.com` | yes | yes | SEC asks for a contact email; without one it may block our addresses. |
| `EMAIL_TOKEN_SECRET` | `openssl rand -base64 32` | yes | own | Encrypts mailbox, Slack, calendar and broker tokens. Never rotate it: stored tokens become unreadable. |
| `FMP_API_KEY` | financialmodelingprep.com | yes | own | Without it prices come from the backups (Nasdaq, ECB) and the cache. |
| `ADMIN_EMAILS` | Your email | yes | yes | Operators: health details, admin jobs, no AI cap. |

### Optional features

Each is on when all its keys are set; while off, people see the message in the last column.

| Feature | Variables | Where | While off |
|---|---|---|---|
| Google sign-in | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_SIGNIN=1` | Google Cloud → APIs & Services → Credentials (Web client) | Email and password only |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` | `scripts/stripe-setup.ts` prints them | Plans show; upgrading says billing is not on yet |
| Background jobs | `INNGEST_EVENT_KEY`, `INNGEST_SIGNING_KEY` | Inngest → Manage → Event keys / Signing key (or the Vercel integration) | Long work runs inside the request, within its time limit |
| File storage | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare → R2 → API tokens | Uploads that need storage say so |
| ML service | `EDGE_ML_URL`, `EDGE_ML_SECRET` | `modal deploy ml/…` prints the URL; the secret is yours | Edge uses its built-in methods |
| Web push | `NEWS_VAPID_PUBLIC_KEY`, `NEWS_VAPID_PRIVATE_KEY`, `NEWS_VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | No push; in-app and email alerts work |
| Calendars | `GOOGLE_CALENDAR_*`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | Google Cloud; Microsoft Entra → App registrations | Those providers are not offered; CalDAV and ICS work |
| Notetaker | `RECALL_API_KEY`, `RECALL_WEBHOOK_SECRET` | recall.ai dashboard | Not offered; uploaded recordings work |
| Copy trading brokers | `SNAPTRADE_CLIENT_ID`, `SNAPTRADE_CONSUMER_KEY` | snaptrade.com dashboard | Copies stay on paper |
| Alpaca | `ALPACA_OAUTH_CLIENT_ID`, `ALPACA_OAUTH_CLIENT_SECRET` | Alpaca Connect app | Paper keys still work |
| Error tracking | `SENTRY_DSN` | sentry.io (free Developer plan) → project → Client Keys | Errors are in Vercel's logs only |

### Real-money switches (all off unless exactly `1`)

| Variable | Effect when `1` |
|---|---|
| `COPYTRADE_TRADING_ENABLED` | Approved copy-trading batches are sent to brokers. Only after counsel's review (docs/copy-trading.md). |
| `ALGO_LIVE_ENABLED` | Live algo strategies send orders. |
| `ALGO_WEBULL_ENABLED` | Direct Webull connections. |
| `ALGO_KILL` | Stops every strategy at once (the kill switch; this one is safe to flip any time). |

Each is logged at startup and shown to operators by `/api/health` under `realMoney`. Set them on
**Production only**; never on Preview.

### Levers (set and redeploy)

| Variable | Use |
|---|---|
| `AI_DISABLED=1`, `AI_GLOBAL_DAILY_USD`, `AI_USER_DAILY_USD` | AI spend (see docs/launch-readiness.md) |
| `STREAM_MODE=slow` | Live updates poll five times less (database load) |
| `MARKET_BACKUP=off` | Stop the Nasdaq fallback |
| `DB_POOL_MAX` | Database connections per instance (default 10, max 30; see docs/scale.md) |
| `FMP_CALLS_PER_MINUTE` | Market-data calls a minute across every instance (default 250; your FMP plan's limit minus a margin) |
| `AUTH_SESSION_DATA_TTL` | Seconds the session cookie is trusted before a database read (default 900) |
| `AUTH_TRUSTED_ORIGINS` | Extra addresses allowed to post to sign-in, comma-separated exact origins (an entry with `*` is ignored) |
| `CSP_REPORT_ONLY=1` | Turns the Content-Security-Policy into report-only, if it ever blocks something real |

### Preview deployments

- **Give Preview its own database.** Neon → Branches → create `preview` from `production`; set Preview's
  `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED` to that branch. Otherwise previews read and write
  production data.
- **Sign-in works on previews** on the preview's own address: email and password. Google sign-in needs a
  registered callback, so it works on production (or on a fixed preview domain set as Preview's
  `BETTER_AUTH_URL`). A `BETTER_AUTH_URL` copied from production is ignored on previews.
- Previews disallow indexing (`robots.txt`), allow Vercel's toolbar in the CSP, and run no crons (Vercel
  runs crons on production only).
- Leave `CRON_SECRET`, `AUTOPILOT_SECRET`, VAPID keys and every real-money switch off Preview.

---

## First deploy

1. **Neon.** Create the project in `aws-us-east-2` (next to Vercel's `cle1`). Copy the pooled and direct
   connection strings.
2. **Vercel.** Import the repository. Settings → Functions: confirm **Fluid compute is on** (the default for
   new projects; it is what allows 300-second functions on Hobby) and the region is `cle1` (`vercel.json`
   also sets it). Set the required and production variables above, for Production.
3. **Database setup** against production, from your machine:
   ```bash
   vercel env pull .env.production.local --environment=production
   set -a; . ./.env.production.local; set +a
   pnpm exec tsx scripts/db-setup.mts extensions         # pgvector and PostGIS
   pnpm exec drizzle-kit push --force                     # uses DATABASE_URL_UNPOOLED
   pnpm exec tsx scripts/db-setup.mts finish             # replays drizzle/0001…0026, RLS, 30 s statement timeout
   rm .env.production.local
   ```
   `finish` is safe to re-run; it skips what exists. Run it again after any deploy that adds a
   `drizzle/NNNN_*.sql`. `drizzle-kit push --force` is for this first, empty database only: never re-run
   it (or `push` without `--strict`) against a live one, where it drops indexes the SQL files create that
   `schema.ts` does not list. A drift check is `pnpm exec drizzle-kit push --strict`, answering "No".
4. **Deploy** (push to `main`, or `vercel --prod`).
5. **Check** (see [Health](#health-and-monitoring)):
   ```bash
   curl -s https://youbank-nu.vercel.app/api/health/live
   curl -s -H "Authorization: Bearer $CRON_SECRET" https://youbank-nu.vercel.app/api/health | jq
   ```
   Expect `"status":"ok"`, `checks.migrations.ok: true`, and no `missing` settings you meant to set.
6. **Heartbeats** (Neon Functions; Hobby crons run once a day): deploy `neon/autopilot.ts`, `neon/news.ts`,
   `neon/calendar.ts` and `neon/copytrade.ts` with `YOUBANK_URL` and `AUTOPILOT_SECRET`, and their triggers,
   as in the README's [Deploying](../README.md#deploying) section.
7. **Inngest.** Install the Inngest integration from the Vercel marketplace (it sets both keys and syncs the
   app on every deploy), or in Inngest → Apps → Sync new app, enter `https://<site>/api/inngest`. Never set
   `INNGEST_DEV` on Vercel: it turns off request signing (health flags it).
8. **Stripe**, when billing goes on: run `scripts/stripe-setup.ts --live --webhook https://<site>/api/billing/webhook`
   and set what it prints.
9. **Uptime monitor** (free: UptimeRobot, Better Stack, or Checkly's free tier): one check on
   `/api/health/live` every minute (never wakes the database), and one on `/api/health` every 5–10 minutes
   alerting on HTTP 503. A frequent `/api/health` check keeps Neon awake (compute hours).

---

## Switching to a custom domain

Do these in order, the same hour. The old `youbank-nu.vercel.app` keeps working throughout (sign-in trusts
it), so nothing breaks for people mid-switch.

1. **Vercel** → Settings → Domains: add `youbank.com` (and `www`, redirecting to the apex). Wait for the
   certificate.
2. **Variables** (Production): `NEXT_PUBLIC_SITE_URL=https://youbank.com`. If `BETTER_AUTH_URL` is set,
   set it to the same address or delete it (health flags a mismatch). `YOUBANK_URL`, if set, the same.
3. **Redeploy** (`NEXT_PUBLIC_SITE_URL` is inlined at build time).
4. **Google Cloud** → Credentials → the OAuth client: add these authorised redirect URIs (keep the old ones
   until the switch is done):
   - `https://youbank.com/api/auth/callback/google` (sign-in)
   - `https://youbank.com/api/crm/gmail/callback` (Gmail)
   - `https://youbank.com/api/calendar/oauth/google/callback` (Calendar)
   and add `youbank.com` to the consent screen's authorised domains.
5. **Microsoft Entra** → App registrations → Authentication: add
   `https://youbank.com/api/calendar/oauth/microsoft/callback`.
6. **Alpaca Connect**: add `https://youbank.com/api/algo/connections/alpaca/callback`.
7. **Stripe** → Developers → Webhooks: add an endpoint `https://youbank.com/api/billing/webhook` with the
   same events as the old one, copy its signing secret into `STRIPE_WEBHOOK_SECRET`, redeploy, then disable
   the old endpoint. In Settings → Billing → Customer portal, update the business links.
8. **Recall.ai**: point the webhook at `https://youbank.com/api/meetings/webhook`.
9. **Inngest**: with the integration, the next deploy re-syncs; otherwise Apps → the app → change the URL
   to `https://youbank.com/api/inngest` and resync.
10. **Neon Functions**: redeploy each heartbeat with `YOUBANK_URL=https://youbank.com`.
11. **Calendar push**: channels renew within a day against the new address on their own.
12. **Check**: sign in with email and with Google; `/api/health` is `ok`; a test Checkout in Stripe test
    mode reaches the webhook (Stripe → Webhooks → the endpoint → recent deliveries all 2xx).

---

## Health and monitoring

| Endpoint | Touches | Use |
|---|---|---|
| `GET /api/health/live` | nothing | Uptime monitors, every minute. 200 while the deployment serves. |
| `GET /api/health` | database (8 s timeout), settings | Readiness. `ok` 200, `degraded` 200, `down` 503. |

`/api/health` verdicts:
- **down** (503): no database, the database unreachable or timing out, a required setting missing, or the
  core tables missing (pages show "being set up").
- **degraded** (200): a migration not applied, a production setting missing or malformed, `INNGEST_DEV` on
  a deployment, a half-configured feature.
- **ok**.

Anyone sees the verdict and counts. Operators (`Authorization: Bearer $CRON_SECRET`, or signed in as an
`ADMIN_EMAILS` address) also see the names of missing settings, which migration is missing which tables (and
the command that fixes it), which features are on, and the real-money switches. Values are never included.

**Market data.** `GET /api/market/health` (Bearer `CRON_SECRET`) probes every data source from the
deployment and shows the last hour's p50/p95, error rate, fallbacks and circuit breaker per source.
[data-layer.md](data-layer.md) explains the sources and their fallbacks, latency budgets, stale data,
breakers, and how to measure real latency with `scripts/data-latency.mts`.

**Logs.** Every failure a person sees as "Something went wrong on our side (ref abcd1234)" is one JSON line
in Vercel → Logs: search for the ref, or for `"level":"error"`. Each line has `ref`, `status`, `where`, a
hashed user tag, the error and a short stack; Vercel groups lines under their request (path, status,
region). Crashes during a page render carry Next's `digest`, which the error screen shows as its reference.

**Error tracking.** Optional and free: create a Sentry project (Developer plan), set `SENTRY_DSN` for
Production and Preview, redeploy. The code sends events itself; no SDK, no extra dependency.

**Log retention.** Hobby keeps runtime logs for about an hour. For longer history, either Sentry (above),
or on Pro a log drain (Vercel → Settings → Log Drains) to Better Stack, Axiom or Datadog.

---

## When something is down

| What | What people see | What to do |
|---|---|---|
| **Neon** (database) | Pages show the error screen with a reference; `/api/health` is `down`; the banner does not show (YouBank answers) | Neon status page. If the compute is suspended or at its CU ceiling: Neon → Branches → production → Edit compute. If it is storage (Free plan 512 MB): upgrade. Queries cut off after 30 s; connection drops are retried once. |
| **Vercel** | The offline banner ("Couldn't reach YouBank, retrying") or nothing loads | vercel-status.com. Nothing to do but wait; a bad deploy: Deployments → previous → Promote to Production. |
| **A bad deploy** | Errors after a push | Instant rollback: Deployments → the previous production deployment → Promote. Tabs on the bad build reload on their next navigation. |
| **OpenAI / Anthropic** | AI answers fail with "took too long" or "our side" | Switch `AI_PROVIDER` (if both keys are set) and redeploy, or `AI_DISABLED=1`; everything else works. AI calls time out at 120 s with one retry. |
| **FMP** | Prices from the backups (badge), or cached prices flagged stale | If `fmp:daily-limit` is in `kv_cache`, the plan quota is spent (resets daily; upgrade the plan). After 10 failures in a minute its breaker opens and FMP is skipped for 30 s at a time (`/api/market/health`; [data-layer.md](data-layer.md)). |
| **SEC EDGAR** | Filings slow or "SEC asked us to slow down" | A 429/403 starts a one-minute shared back-off (`edgar:backoff` in `kv_cache`). Check `EDGAR_USER_AGENT` has a real email. |
| **Stripe** | Checkout or the portal fails | status.stripe.com. Payments are confirmed by the webhook later; Stripe retries webhooks for three days. Nothing is lost. |
| **Inngest** | Background runs queue | Work already queued resumes; with jobs off, long work runs in the request. Check Inngest → Apps for a sync error after a domain change. |
| **Modal (ML)** | Edge uses built-in methods | Check the Modal app; nothing breaks without it. |
| **Recall, SnapTrade, Alpaca, Google/Microsoft calendars** | That feature says the service did not answer | Reads are retried once; orders and sends are never repeated. Broker order outcomes after a timeout are reconciled by the next status refresh (client order ids keep them idempotent). |
| **Neon Functions** (heartbeats) | Autopilot, news and calendar sync only run at the daily cron | Neon → Functions → logs. The relays give up after 310 s. |
| **Sign-in rate limit** | "Too many requests" on sign-in | Per address: 30 password sign-ins per 5 minutes, 50 sign-ups per hour. Counts live in `kv_cache` (`rate:auth:*`) and expire on their own. |

---

## How the app copes with failure

**Outbound calls** (src/lib/net.ts). Every upstream fetch has a timeout. GETs, and POSTs that only read
(searches, JSON-RPC reads, OpenFIGI), get one retry on a network failure, 408/425/429 or 5xx, with jittered
back-off, honouring `Retry-After` up to 10 s, and only if the retry can finish inside the request's budget. A
timed-out attempt is not retried (it would only double the wait). FMP, Nasdaq, BLS and SEC retry server
errors only (their 429 is a quota or a block). **Orders, cancels, sends, job starts and payments are never
repeated.** The SDKs have their own: OpenAI and Anthropic 90–240 s with one retry, Stripe 20 s with two
retries and idempotency keys.

**Database** (src/db). Neon's pooler, prepared statements off, 6 connections per instance, 20 s idle
timeout (so Neon can scale to zero), 15 s connect timeout (a waking compute answers in a second or two),
connections renewed every 10 minutes, 30 s statement timeout on the role. A statement that never reached the
server, or a plain read whose connection broke, is tried once more. Without `DATABASE_URL`, or before the
schema is pushed, pages show "YouBank is being set up" and API routes answer 503 with the same words.

**Browser.** `fetchJson` has a timeout safety net, retries a GET once after a network failure or 502–504,
waits out a short 429, and never resends a write (a double click sends once). A bottom banner says "You're
offline" or "Couldn't reach YouBank, retrying" and clears itself. A 401 inside the workspace, confirmed by a
session check, offers "Sign in again" with `next` set to the page. After a deploy, a tab on the old build
reloads on its next navigation (deploymentId), and a lazily loaded chunk that is gone reloads the page once.
A streamed AI answer that drops says it was cut off, keeping what arrived. There is no offline cache: the
only service worker (`/news-sw.js`) handles push notifications and caches nothing.

---

## Vercel Hobby limits, and when to upgrade

Checked against Vercel's documentation (October 2026; confirm on vercel.com/docs/limits before relying on
a number):

| Limit | Hobby | What YouBank does |
|---|---|---|
| Function duration | 300 s default and maximum with Fluid compute (60 s without) | Every route's `maxDuration` is 300 or less; long work goes to Inngest steps (240 s checkpoints). |
| Cron jobs | Once a day each; fire any time within the scheduled hour | All seven crons in `vercel.json` are daily; the frequent passes run from Neon Functions. |
| Commercial use | Not allowed on Hobby | Taking payments is commercial use. |
| Log retention | About an hour | Sentry or a Pro log drain. |
| Skew protection, log drains, more concurrency, spend controls | Pro | |

**Upgrade to Pro before charging anyone** (Hobby's terms), or when any of these show up: invocations or
function duration near the monthly allowance (Vercel → Usage), 429s from the platform, the need for
logs older than an hour, or more than a few hundred people online at once (docs/launch-readiness.md has the
numbers). Pro also allows 800 s functions and per-minute crons, which would let the heartbeats move back from
Neon Functions. **Neon**: move off Free (512 MB, 2 CU, compute-hour cap) to Launch before launch; set the
production branch's autoscaling maximum to 4 CU.
[docs/scale.md](scale.md) has the measured numbers behind these settings and the connection arithmetic
(`DB_POOL_MAX`, the pooler, compute size).

---

## Security settings

- **Headers** (next.config.ts): HSTS (two years, subdomains), `nosniff`, `strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` and a Content-Security-Policy on every page except the Office add-in's two (which
  Excel and PowerPoint frame). The CSP allows scripts only from YouBank (inline allowed, no eval), blob
  workers for the maps and PDF viewer, WebAssembly, https images, media and fetches (map tiles, logos,
  stored files, wallets), no plugins, no `<base>`, forms only to YouBank, no framing. Permissions-Policy
  allows the microphone to YouBank's own pages only (the Voice Analyst; on every page, since a client
  navigation into the workspace keeps the first page's policy); camera, geolocation, payment and USB
  nowhere. `CSP_REPORT_ONLY=1` is the escape hatch.
- **Cookies**: Better Auth's session cookies are httpOnly, `SameSite=Lax`, and `Secure` on every HTTPS
  deployment.
- **Sign-in origins**: only the addresses this deployment answers on may post to sign-in.
- **Rate limits**: sign-in (Better Auth, counted in the database so all instances share them, per address);
  AI (per-person and global daily caps); expensive routes (per-person limits in `kv_cache`); pairing (per
  address). All count in Postgres, so they hold across serverless instances, and fail open on a database
  blip.
- **Links from outside**: a recording link someone pastes, the article and robots.txt links the Newsroom
  finds in feeds, calendar feeds and CalDAV servers, and web push endpoints go only to public addresses
  (`safePublicFetch` and `assertPublicUrl` in `src/lib/net.ts`): no loopback, private, link-local or cloud
  metadata address, each redirect checked again (at most three), time and size capped.
- **Mail servers people type in**: a custom mailbox's IMAP and SMTP hosts follow the same rule
  (`mailEndpoint` in `src/lib/crm/imap.ts`), checked when the mailbox is saved and again before every
  connection. Only mail ports are allowed (IMAP 993 and 143, SMTP 465, 587, 25 and 2525). The connection
  goes to the address that was checked, with the typed name kept for TLS, so the certificate is still
  verified against it and a name cannot switch to a private address in between.
- **Caching**: pages are rendered per request (the theme and session come from cookies), so nothing
  personal is cached by the CDN; API responses are `no-store` or `private`. `/_next/static` assets are
  immutable and fingerprinted. The sitemap regenerates hourly.

### Hardening later

- A nonce-based CSP (script-src without `'unsafe-inline'`) needs the proxy to run on every page; worth doing
  once the CSP has run cleanly for a while.
- Pro's Skew Protection keeps old assets reachable for tabs mid-deploy.
- Vercel Firewall rules (Pro) for rate limiting at the edge.

---

## Known risks

- **Hobby is not for commercial use**, and its allowances are small; see above.
- **Neon Free** caps storage and compute; see docs/launch-readiness.md.
- **Preview sharing production's database** until Preview gets its own `DATABASE_URL`.
- **A few long AI calls can outlast their route** (VC discovery: 150 s with one retry under a 180 s route;
  diarisation: 240 s with one retry): the platform stops the function and the person sees "took too long".
- **Inngest `send` has no timeout of our own** (the SDK's own applies).
- **The CSP is new**: if a browser feature breaks (maps, wallets, PDF viewer, voice), set
  `CSP_REPORT_ONLY=1`, redeploy, and read the browser console's CSP reports.
