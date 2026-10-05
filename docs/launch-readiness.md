# Launch readiness

A pass over YouBank before it opens to thousands of concurrent users: what breaks, slows down or runs
up cost at that scale, and what was done about it. Written as the on-call engineer would want it the
night of launch.

- **Scope:** the whole codebase at `58415e9` (Next.js 16.3 on Vercel, Neon Postgres over `neon-http`,
  Neon Auth), plus the live project settings on Vercel and Neon (read-only).
- **Method:** reading the code, the built `.next` output and the platform settings; load figures are
  estimates from the code (queries per request times request rates) unless marked as measured. "Unverified"
  marks anything that was not measured or confirmed.
- **Severity:** **P0** outage, data leak or runaway cost. **P1** bad degradation. **P2** polish.
- **Status** of each finding is in [What is fixed and what is left](#what-is-fixed-and-what-is-left).

## The environment, as found

| Item | Finding | Evidence |
|---|---|---|
| Neon plan | **Free (`free_v3`)**, `aws-us-east-2`, autoscaling 0.25 to 2 CU, **512 MB storage cap per branch** (98 MB used). Free also caps monthly compute hours and egress (Neon's published Free terms; confirm on the billing page). | Neon API: project and computes |
| Vercel plan | Hobby (personal scope). Functions run in `iad1` (the default), a region away from the database. | `vercel project inspect` |
| Routes | 107 route handlers. 41 set `maxDuration`: 15 at 300 s, 1 at 180, 8 at 120, 17 at 60. `guarded(` has 120 call sites in 78 files; `guardedFor(` has 17 in 11. | grep |
| Database driver | Drizzle 0.45.2 over `neon-http`: every query is its own HTTPS round trip, no interactive transactions, no fetch timeout set. | `src/db/index.ts` |
| Auth | Neon Auth. `currentUser()` is `cache()`d per request, and a signed session-data cookie (300 s) avoids most upstream checks. Cookies are `SameSite=Lax` (the SDK default). Studio and Office routes use `guardedFor()` (device token or session). | `src/lib/auth/user.ts`, `@neondatabase/auth` |
| Dev bypass | `YOUBANK_DEV_USER` is honoured only when `NODE_ENV !== "production"`. Every Vercel build, previews included, is production, so it cannot activate there. | `src/proxy.ts:8`, `src/lib/auth/user.ts:24` |
| Crons | Vercel runs `/api/cron/sync` at 06:00 and `/api/cron/agent` at 11:00 daily. Neon Functions run autopilot every 5 min and news every 10 min. All check `CRON_SECRET` or `AUTOPILOT_SECRET`. | `vercel.json`, route files |
| Env (names only) | **Production:** `DATABASE_URL`, Neon Auth ×3, `OPENAI_API_KEY`, the model defaults, `FMP_API_KEY`, `EDGAR_USER_AGENT`, `CRON_SECRET`, `AUTOPILOT_SECRET`, `EMAIL_TOKEN_SECRET`, VAPID ×3. No `ANTHROPIC_API_KEY`, no Google OAuth. **Preview:** the same database, auth, OpenAI, FMP and EDGAR names, without the cron, autopilot, email-token or VAPID secrets. | `vercel env ls` |

## Findings

### 1. Database under concurrency

| # | Sev | Finding | Where | Breaks at | Fix |
|---|---|---|---|---|---|
| D1 | P0 | **Neon Free plan.** 512 MB cap per branch (writes fail when full), a 2 CU ceiling, and monthly compute-hour and egress allowances. `kv_cache`, `ai_usage`, `crm_messages` (email bodies), `news_items` and `studio_events` all grow with users. | Neon project | Storage: weeks at a few thousand users with mail sync. Compute: days of sustained 2 CU. | Upgrade to Launch or Scale before launch; max 4 to 8 CU ([Infra](#infrastructure-you-set-up)). |
| D2 | P0 | **The Newsroom feed is the heaviest request.** Each call reads the profile, all of the user's CRM contacts, up to 800 full `news_clusters` rows (with the base64 `centroid`), the items of 120 clusters (with `embedding`) and the reader's states: 6 to 7 queries and about 0.5 to 1 MB out of Postgres. It also writes `news:seen:<user>` to `kv_cache` on every call. Every open Newsroom tab polls it every 60 s. Deals (a 2,000-row scan per call, every 5 min) and the radar (250 stories) are recomputed per request too. | `src/lib/news/views.ts:67-92,126`, `src/lib/news/reader.ts:15-41`, `src/lib/news/store.ts:160-169`, `src/lib/news/radar/view.ts:89` | 1,000 open Newsroom tabs: about 17 feed calls/s, about 17 MB/s of database egress, 17 cache writes/s. | Share the candidate stories across users (one read per instance per minute, only the columns needed); cache each person's network for 5 min; write `news:seen` only when it changes; memoize deals and radar stories per instance for a few minutes. |
| D3 | P1 | **`kv_cache` has no index on `expires_at`**, yet 2% of writes run `delete … where expires_at < now()` over the whole table. It is already the biggest table (23 MB on a copy of production). | `src/lib/cache.ts:47`, `src/db/schema.ts:86` | A full scan on 2% of cache writes. | Additive index; batch-limited cleanup. |
| D4 | P1 | **No in-flight dedup.** `cacheJson` lets every concurrent miss run the loader (FMP, EDGAR, BLS at 25 requests a day, radar builds, company data). The per-instance memory map never evicts. | `src/lib/cache.ts:10,50-56` | A popular ticker at the open: N identical upstream calls; instance memory grows with every distinct key. | Single-flight; a bounded map. |
| D5 | P1 | **Studio access checks read the whole document** (`select *`, including the workbook and deck JSON) just to check the owner or team, on every edit, every load and every stream reconnect. | `src/lib/studio/db.ts:21-30` | About 4 MB/s at 1,000 streams on 200 KB models. | Read two columns for the check; the body only where it is used. |
| D6 | P1 | **Functions (`iad1`) and database (`us-east-2`) are in different regions**, and routes chain several queries. | Vercel and Neon settings | Every query pays the cross-region round trip. | `"regions": ["cle1"]` (Cleveland is `us-east-2`). |
| D10 | P1 | The campaign "contacted recently" check scans every user's `crm_drafts` with a JSON containment test on `to_addresses`; no index serves `kind`, `status` and `sent_at`. | `src/lib/crm/campaigns.ts:212-219` | Grows with all sent drafts. | Additive partial index. |
| D7 | P2 | Per-user lists without `LIMIT`: contacts, deals, drafts, playbook, campaigns; a global Form D scan per run. | `src/lib/crm/db.ts:387`, `src/lib/crm/actions.ts:74,105,111`, `src/lib/crm/knowledge.ts:22` | Heavy users. | Limits and pagination. |
| D8 | P2 | Each Studio patch rewrites the whole stored document (one atomic `jsonb_set` per patch). | `src/lib/studio/db.ts:89-165` | Big models edited fast. | One statement per commit. |
| D9 | P2 | Migrations are applied by hand with no journal, and the SQL is split on `;`. | `scripts/apply-sql.mts` | Drift between environments. | A `schema_migrations` table. |
| D11 | P1 | **No query timeout.** Each query is an HTTPS request to Neon and the driver sets none, so a stalled connection holds its request, and on Vercel its function, until the platform kills it. Found by the load test: during a network blip one request hung for fifteen minutes. | `src/db/index.ts` | Any network stall between the functions and Neon. | A 30-second timeout on every query. |

**Connections:** `neon-http` goes through Neon's proxy, which pools on its side, so the limit is
compute CPU, not the connection count. **Transactions:** Studio edits are atomic per patch, and the
other multi-step writes are idempotent (`src/lib/news/store.ts`), so no driver switch is needed.

### 2. Live-update streams (SSE polling)

| Stream | Poll | Queries per 45 s connection | Per tab per second | Reconnect cost |
|---|---|---|---|---|
| Studio `api/studio/[id]/stream` | every 600 ms | 75 event reads | 1.67 | session check plus a full-document read |
| Collab `api/collab/[id]/stream` | every 1.2 s | 37.5 event reads plus 37.5 presence reads or writes | 1.67 | session check plus an access read |

At **1,000 open sessions** that is about **1,670 queries/s** from polling alone, about **80,000
invocations an hour** with 1,000 functions held open, and about 4 MB/s of document reads on
reconnect. Neither client paused in hidden tabs (`src/components/studio/useStudio.ts:126`,
`src/lib/client/collab.ts:51`), and on shared documents every remote change also triggered a full
reload (K1). Hobby's monthly invocation allowance (about 1M; unverified for this account) lasts about
half a day at that rate.

| Design | DB queries/s at 1,000 tabs | Invocations/hour | New infra | Cost vs today |
|---|---|---|---|---|
| Before | about 1,670 | about 80,000 | none | baseline |
| **A. Adaptive polling (built)**: pause in hidden tabs; poll 1 s after activity, backing off to 5 s when idle; 120 s connections; a two-column access check; one shared poll per document per instance | about 150 to 300 (half the tabs hidden) | about 15,000 | none | 5 to 10× cheaper |
| B. Postgres LISTEN/NOTIFY | near 0 from polling | same as A | a WebSocket connection per instance (the pooler cannot LISTEN) | cheapest on the database, most moving parts |
| C. Hosted realtime (Ably, Pusher, Liveblocks) | 0 | near 0 (clients hold the socket) | an account and keys | tens to low hundreds of dollars a month at 1k to 5k connections (list prices, unverified) |

Design C is the next step when the streams dominate again; see [Infra](#infrastructure-you-set-up).

### 3. Vercel function limits and background work

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| V1 | P0 | **Hobby is for non-commercial use**, and its allowances (invocations, active CPU, memory-hours, transfer) are sized for hobby traffic. The streams alone used about 80,000 invocations an hour at 1,000 tabs. | plan; section 2 | Pro before launch. |
| V2 | P1 | **Autopilot runs users one at a time** in one 270 s window (up to 120 s each). Idle users are cheap; busy mailboxes take seconds to tens of seconds (mail sync, triage, drafting). The order is random, so nobody starves forever. | `src/app/api/cron/autopilot/route.ts:26-37`, `src/lib/crm/autopilot.ts:318-381` | A bounded pool; a queue later. At 1,000 busy mailboxes each gets a pass every few hours, not every 5 min. |
| V3 | P1 | **The nightly agent** has the same sequential loop; its rotation is fair. | `src/app/api/cron/agent/route.ts:22-31`, `src/lib/crm/run.ts:70-80` | Same pool. |
| V4 | P1 | **Long synchronous runs hold functions**: Gmail sync, the CRM agent, drafting, Studio extract, markup and agent (300 s each), VC discover (180 s). | route files | Per-user concurrency limits (section 5); a queue later. |
| V5 | P2 | Two cron routes compare the secret with `!==`. | `src/app/api/cron/sync/route.ts:10`, `src/app/api/health/duration/route.ts:10` | `secretsMatch`. |
| V6 | P2 | Heavy SDKs load at module top level on light routes: the news feed, the CRM lists and the terminal GET import both AI SDKs; `/api/crm/accounts` imports the mail stack for a constant; Studio export loads both exceljs and pptxgenjs. The cost is cold starts. | route imports | Lazy imports. |

Crons overlap safely: autopilot has a per-person lock (`src/lib/crm/autopilot.ts:320`), the news pass
has its own lock, and sends claim the draft atomically (`src/lib/crm/send.ts:36`), so an overlapping
run cannot send twice.

### 4. Auth and multi-tenant isolation

All 107 routes authenticate: `guarded()` or `currentUser()` for user routes, `guardedFor()` for
Studio and Office (device token or session), a bearer secret for cron and health routes, or they are
intentionally public (the Neon Auth handler, Office pairing start and poll, the Office manifest, and
`/api/ai/status`, A12). Every lookup keyed by an id from the URL or body also filters on `user_id` or
checks team membership: CRM, sheets, peer groups, tool runs, Office devices, profile, prefs,
notifications, and Studio (owner or team role). Gmail OAuth checks `state` against an httpOnly
cookie.

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| A1 | P0 | **Manual inputs were shared by all users.** Any user's estimate for a ticker became everyone's (newest wins), `value: null` erased it for everyone, the writer's name or email was shown to all, and the unbounded note went into other users' AI context as `derivation_notes`: a cross-customer prompt-injection path. The shared company cache itself is clean (inputs are applied to a copy). | `src/db/manual.ts`, `src/app/api/manual-inputs/route.ts`, `src/lib/company.ts:130`, `src/lib/ai/tools.ts:46` | Scope reads and writes to the author; cap the note; one batched query per request. |
| A2 | P0 | A global admin job open to any user: VC sync (C3). | `src/app/api/vc/sync/route.ts` | Admin or secret only. |
| A3 | P1 | **Collab ignored team roles**: a team *viewer* ("cannot change anything") could edit shared sessions and create team sessions. Studio checks roles correctly. | `src/lib/collab/db.ts:22-23`, `src/app/api/collab/[id]/route.ts:29-34` | Check `can(role, "edit")` for writes. |
| A5 | P1 | **The peer-groups list loaded every user's group members** (no WHERE) and filtered in JavaScript. Nothing leaked, but it scans a shared, growing table on every call, and one filter bug would leak. | `src/app/api/peer-groups/route.ts:14-17` | Query only the caller's groups' members. |
| A4 | P2 | The campaign "already contacted" check reads all customers' sent drafts **by design** (one cold first touch per recipient per month across YouBank, an anti-spam rule). Its cost is D10. | `src/lib/crm/campaigns.ts:208-219` | Keep. |
| A6 | P2 | **No framing protection.** `/office/connect?code=…` approves an Office pairing in one click. It is safe today only because the session cookie is `SameSite=Lax`, so a cross-site frame is signed out; switching the cookie to `None` for Office would open it. | `next.config.ts`, `src/components/office/OfficeConnect.tsx:48-54` | `frame-ancestors 'none'` everywhere except `/office/taskpane` and `/office/commands`, which Office frames. The add-in opens `/office/connect` in a real browser window (`src/lib/office/client.ts:97`). |
| A7 | P2 | A removed team member keeps the sessions and documents they created, their invites stay valid, and open streams re-check access only per connection. | `src/lib/collab/db.ts:22`, `src/lib/studio/db.ts:24`, `src/lib/teams/db.ts:172` | Revoke invites on removal; document owner semantics. |
| A8 | P2 | Invite redemption is not atomic (two parallel accepts both succeed) and skips the email check when the session has no email. | `src/lib/teams/db.ts:133,139` | `where accepted_at is null`; require an email. |
| A9 | P2 | Registering a push endpoint that already exists moves it to the caller. | `src/app/api/news/push/route.ts:23-24` | Only update the caller's row. |
| A10 | P2 | Office pairing start has one global limit (60 a minute), so anyone can block pairing for everyone. | `src/lib/office/auth.ts:22-23` | A per-IP limit. |
| A11 | P2 | The mailbox form accepts any IMAP/SMTP host and port and the server connects there. The mail clients wait for a server greeting, so internal HTTP services cannot be driven, but it works as a port scanner from your IPs. | `src/app/api/crm/accounts/route.ts:23-29`, `src/lib/crm/imap.ts:57-80` | Reject private, loopback and link-local addresses after the DNS lookup. |
| A13 | P1 | **Sessions refresh only on page loads.** The short-lived signed session cookie (five minutes by default) was re-minted only by the page proxy and the auth routes. So someone who kept a page open (the bell, the feed and the terminal poll every minute) made every poll after it expired ask Neon Auth for their session, from our servers' addresses. Neon Auth rate-limits those calls and does not see the person's own address: in the load test, from one address, about 17 a second drew 429s and those people were signed out. | `src/proxy.ts`, `src/lib/auth/server.ts` | A few thousand people keeping pages open. | Re-mint in the proxy for API routes too; trust the cookie for 15 minutes. Never rotate `NEON_AUTH_COOKIE_SECRET` under traffic (everyone would re-mint at once). |
| A12 | P2 | `/api/ai/status` needs no sign-in and returns the provider and model (and setup hints when no key is set). `/api/prefs` and `/api/profile` return `profiles.extra` as stored, including the owner's own encrypted Slack webhook. | `src/app/api/ai/status/route.ts`, `src/app/api/prefs/route.ts:16,40`, `src/app/api/profile/route.ts:12` | Guard it; filter `extra`. |

### 5. Abuse and cost controls

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| C1 | P0 | **No per-user rate limit or spend cap on any AI route.** About 15 routes call models on your keys (chat, tools, the Studio agent, extract and markup, the CRM agent, compose, insights, threads, questions, nurture, campaigns, voice, peers, VC discover, terminal AI). Usage was recorded after the fact but never checked. Only the Newsroom has a budget (`NEWS_AI_BUDGET_USD`, monthly). | `src/lib/ai/config.ts`, `src/lib/ai/usage.ts`, `src/lib/news/budget.ts` | A per-user daily cap, a global daily cap, an off switch and concurrency limits, enforced where models are called. |
| C2 | P0 | **Chat accepted any model and effort from the request body**, including the priciest at maximum reasoning, and **message length was unbounded**: 40 messages of any size, up to the ~4.5 MB body limit, re-sent on each of up to 10 turns. | `src/app/api/ai/chat/route.ts:18-25` | Cap each message and the total; `AI_ALLOWED_MODELS`; the spend cap bounds the rest. |
| C3 | P0 | **Any signed-in user could run the global VC sync**: a 300 s job scraping YC, a16z and HN and reading up to 60 days of SEC Form D into the shared `startups` table. Nothing in the UI calls it. Looped, it risks SEC blocking your IPs, which would break filings for everyone. | `src/app/api/vc/sync/route.ts` | `CRON_SECRET` or `ADMIN_EMAILS`. |
| C4 | P1 | **VC discover** (180 s of AI web search) had no limit and writes into the shared directory. | `src/app/api/vc/discover/route.ts` | The C1 caps plus a per-user hourly limit. |
| C5 | P1 | **The Studio agent had no lock**: several 300 s runs could work on one document at once. | `src/app/api/studio/[id]/agent/route.ts` | One run per document; a per-user limit. |
| C6 | P1 | **Usage was recorded fire-and-forget**, so a function could freeze before the insert landed and spend was under-counted (and the caps depend on it). | `src/lib/ai/usage.ts` | `after()`. |
| C7 | P1 | **EDGAR**: the limit (8 requests/s) is per instance and fully serial, with no handling of 429 or 403; on Vercel company facts and submissions are cached in memory per instance only; the SEC press-release RSS uses a User-Agent without a contact address. | `src/lib/edgar/client.ts`, `src/lib/news/desks.ts:110` | A shared limiter; a global back-off on 429 or 403; the EDGAR User-Agent on the SEC feed. |
| C8 | P1 | **Timeouts and cancellation.** AI calls on request paths used the SDK default of 10 minutes with 2 retries, longer than every `maxDuration`, so the platform killed the function and the client got no error. The user's cancel signal was never passed to the SDK, so the current turn kept generating billed tokens after they left. 14 plain HTTP call sites had no timeout: FMP, Treasury, FRED, BLS, the Gmail API and token refresh, web-push, the VC sources, both Neon heartbeats. | `src/lib/ai/agent.ts`, `src/lib/market/*`, `src/lib/crm/gmail.ts`, `src/lib/news/deliver.ts`, `src/lib/vc/sources/*`, `neon/*.ts` | SDK timeouts and one retry; pass the abort signal; `AbortSignal.timeout` on every fetch. |
| C9 | P1 | **Sign-ups are open**, so per-user caps can be multiplied with many accounts. | Neon Auth settings | The global cap bounds the total; turn on email verification (your setting). |
| C10 | P1 | **The market-data plan will not survive launch day.** FMP is on the free plan, a small daily quota shared by development and production; once it is used, the code pauses FMP for 30 minutes at a time. The fallback is Nasdaq's keyless API, whose terms are personal-use only and which will likely throttle Vercel's IPs under load (unverified); paid AI research is the last fallback for price screens. | `src/lib/market/fmp.ts`, `src/lib/market/nasdaq.ts`, `src/app/api/terminal/[fn]/route.ts:92-94` | Your decision: FMP Starter or higher plus its display licence. |
| C11 | P2 | **No request body is validated with zod**; checks are hand-written and good where they exist. Gaps: collab `state` and `patch` JSON of any size (re-streamed to every participant); profile fields of any length (they go into that user's AI prompts); sheets, tool-run `inputs` and peer-group members of any size; the news "send a test" action has no rate limit. | `src/app/api/collab/route.ts`, `src/app/api/profile/route.ts`, `src/app/api/sheets/route.ts`, `src/app/api/news/prefs/route.ts` | zod schemas with size caps. |

### 6. Error handling and resilience

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| E1 | P1 | **Internal error text went to the browser at 27 sites.** A failed query's message is Drizzle's `Failed query: <SQL> params: <values>` (`node_modules/drizzle-orm/errors.js:12-13`), so any database hiccup showed the SQL and its values. The sites: the shared wrappers `guarded()` and `guardedFor()`; the public `/api/office/pair/start`; the Gmail callback, which wrote the text into a redirect URL (browser history and request logs; on a database error it included the encrypted tokens); `/api/crm/accounts` (raw IMAP/SMTP replies, values with the encrypted password); terminal, company, precedents, Form D, VC sync and discover, AI peers, news prefs, sheets, peer groups, manual inputs; the Studio stream, agent and export and the collab stream (which also say whether a document exists); the cron summaries. No stack traces or API keys were found in any message. | `src/lib/auth/user.ts:61`, `src/lib/office/auth.ts:104`, the routes above | Keep messages written for people; replace the rest with a reference; log the real error. |
| E4 | P1 | **Failures were never cached**: `cacheJson` stores only successes, so while FMP, Treasury, FRED or BLS is down every request goes upstream again, and without timeouts each can hold a function until its `maxDuration`. | `src/lib/cache.ts:50-56` | A short in-memory failure memo, plus the C8 timeouts. |
| E2 | P1 | **Polling never backed off.** `useApi` (the notification bell on every page, the Newsroom, the terminal news screens) polled at a fixed rate in hidden tabs and through 500s and 429s. Only 2 of 16 pollers paused when hidden (CRM and the Office task pane). | `src/components/news/client.ts:23-34` | Skip when hidden, refresh on return, exponential back-off on errors. |
| E3 | P2 | One error boundary (`src/app/error.tsx`) and no `global-error.tsx`. If the database or Neon Auth is down, the app layout's profile query throws and the whole shell is replaced by the error card, whose "Back to home" link goes to `/app`, which fails the same way. A crash in one terminal panel unmounts every panel, the chat and Studio's undo stack. | `src/app/app/layout.tsx:14-17`, `src/components/terminal/Panel.tsx` | Catch in the layout and show the shell with a banner; panel-level boundaries. |
| E5 | P2 | The Studio agent runs `requireDoc`, `loadUserContext` and `startRun` before its `try`, so on failure the stream dies with no final event. | `src/lib/studio/agent.ts:655-661`, `src/app/api/studio/[id]/agent/route.ts:24-32` | Move them inside the `try`. |

### 7. Caching and performance

Checked against the built `.next` output (sizes raw / gzip).

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| K1 | P1 | **Studio reloaded the whole document on every remote change**: the body, 20 full runs, 60 events and the teams, once per viewer for each change another person or the agent makes, and again after each run. A 40-commit agent run watched by 3 people meant about 120 full reloads. | `src/components/studio/useStudio.ts:75-78,131`, `src/app/api/studio/[id]/route.ts:13-24` | Debounce, and a metadata-only GET. The UI is unchanged. |
| K2 | P1 | **Data that is the same for every user was recomputed per request**: Newsroom deals (2,000 rows), radar stories, startup facets (5 aggregates), the home page's count of startups, and the feed candidates (D2). | `src/lib/news/views.ts:126`, `src/lib/news/radar/view.ts:86-92`, `src/lib/vc/directory.ts:53-57`, `src/app/app/page.tsx:15` | A per-instance memo with single-flight, 1 to 5 minutes. |
| K3 | P2 | **Bundles.** Every `/app` page ships the full tool catalog (29 KB gz) and `motion` (46 KB gz). Tool and collab pages ship all of Zod (a 97 KB gz chunk) to re-check a saved run. Opening a tool downloads its whole pack (51 to 75 KB gz) **including the AI prompts**, readable by anyone. Four font files (83 KB) are preloaded everywhere. Server-only SDKs never reach the browser (checked in the build). | `src/components/workspace/Sidebar.tsx:16`, `src/components/ui/Dialog.tsx:10`, `src/components/workflows/ToolRunner.tsx:77`, `src/lib/workflows/load.ts` | Pass the six sidebar tools as props; `LazyMotion`; drop the client re-check; split packs into client fields and server prompts. |
| K4 | P2 | **Re-render hot spots.** The terminal's 1 s clock re-renders the whole terminal (including a sort of 328 tools and animated layouts); Studio runs a 40 ms interval all the time; the Newsroom re-renders 120 animated cards every 30 s. | `src/components/terminal/Terminal.tsx:89-94`, `src/components/studio/useStudio.ts:106-117`, `src/components/news/client.ts:95-103` | A clock component, `memo`, the interval only while cells flash. |
| K5 | P2 | **Waterfalls.** Newsroom: the feed, then the brief. Tool page: route, then pack, then runs. The DES panel waits for the whole watchlist. `/api/companies` made one manual-inputs query per ticker. | `src/components/news/Newsroom.tsx:47-69`, `src/components/workflows/useTool.ts:12`, `src/components/terminal/Panel.tsx:75,115`, `src/lib/company.ts:130` | Parallel fetches; batch the manual inputs (A1). |
| K6 | P2 | **Edge caching is not possible as built**: every data route requires sign-in, so a CDN cannot share responses without making that data public (a product decision). A few routes set browser `private, max-age`. | `src/app/api/terminal/[fn]/route.ts:26,89` | The shared server caches (K2, D4); `stale-while-revalidate` on the private headers. |
| K7 | P2 | **Images.** No `next/image`; the VC directory loads 50 to 100 third-party logos eagerly; unused brand PNGs sit in `public/`. | `src/components/vc/VcWorkspace.tsx:133` | `loading="lazy"`. |
| K8 | P2 | **Bug: Newsroom sparklines** request at most 24 symbols and never fetch the rest. | `src/components/news/client.ts:64,76` | Fetch in batches. |
| K9 | P2 | **Newsroom layout shift** is 0.144 (Google's "needs improvement" band is 0.1 to 0.25), measured on a local build: the feed's cards shift as they load. The other main pages score 0.000 to 0.011. | `src/components/news/Newsroom.tsx` | Reserve the feed's space while it loads. |

### 8. Config and deploy hygiene

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| G1 | P1 | **Preview probably shares production's database and quotas.** Preview has its own `DATABASE_URL`, `FMP_API_KEY` and `OPENAI_API_KEY` entries, created alongside production's (values not read). If they match, previews read and write production data and spend the same FMP quota and OpenAI budget. | `vercel env ls` | A Preview database branch and separate keys. Until then, a preview is not a safe load-test target. |
| G2 | P2 | **No startup validation.** A missing or short `NEON_AUTH_COOKIE_SECRET` throws when the module loads and takes down every page; `EDGAR_USER_AGENT` silently falls back to a placeholder; a non-numeric `CHAT_BUDGET_MS` or `WORKFLOW_BUDGET_MS` becomes NaN and silently disables the time budget. `@neon/env` is a dependency but unused. | `src/lib/auth/server.ts:5-6`, `src/lib/edgar/client.ts:9`, `src/app/api/ai/chat/route.ts:12` | Check the variables below at startup and log clearly. |
| G6 | P2 | **No security headers**, and `X-Powered-By: Next.js` is sent: no CSP, HSTS, nosniff, referrer policy, permissions policy or frame-ancestors. There is no `dangerouslySetInnerHTML` anywhere. | `next.config.ts` | Headers in `next.config.ts`. |
| G3 | P2 | Migrations applied by hand (D9). | | |
| G4 | P2 | `stripe` is a dependency with no imports: there is no payment surface to audit. | `package.json` | Remove. |
| G5 | P2 | Secrets stay out of the client bundle: no `NEXT_PUBLIC_*` variables, and no client file imports a server module. The `server-only` guard is not used. | imports and built chunks | `import "server-only"` in the database, AI and mail modules. |

Environment variables the code reads (P = set in Production, V = set in Preview; names only, from `vercel env ls`):

| Variable | Purpose | P | V | If missing |
|---|---|---|---|---|
| `DATABASE_URL` | database | yes | yes | the first query throws |
| `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` | sign-in | yes | yes | **every page returns 500** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | AI | OpenAI only | OpenAI only | the AI features say AI is off |
| `OPENAI_MODEL`, `ANTHROPIC_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_RESEARCH_MODEL` | AI defaults | yes | yes | built-in defaults |
| `AI_PROVIDER`, `MARKET_RESEARCH_MODEL`, `MARKET_RESEARCH_ESCALATION_MODEL`, `NEWS_RESEARCH_MODEL`, `NEWS_AI_BUDGET_USD` | optional | no | no | defaults (the news budget is $25 a month) |
| `FMP_API_KEY`, `MARKET_BACKUP` | market data | key yes | key yes | backups only; backups on |
| `EDGAR_USER_AGENT` | SEC contact | yes | yes | a placeholder (risk of an SEC block) |
| `CRON_SECRET` | crons, health probes | yes | **no** | cron routes refuse |
| `AUTOPILOT_SECRET` (and `YOUBANK_URL` in the Neon functions) | the heartbeat | yes | **no** | autopilot and news refuse |
| `EMAIL_TOKEN_SECRET` | mailbox and Slack encryption | yes | **no** | mail features off |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Gmail OAuth | no | no | Gmail connect hidden (app passwords still work) |
| `NEWS_VAPID_PUBLIC_KEY`, `NEWS_VAPID_PRIVATE_KEY`, `NEWS_VAPID_SUBJECT` | web push | yes | **no** | push off |
| `CHAT_BUDGET_MS`, `WORKFLOW_BUDGET_MS`, `GITHUB_TOKEN`, `AUTOPILOT_SPOT_CHECK_RATE`, `YOUBANK_NO_DISK_CACHE` | optional | no | no | defaults |
| `YOUBANK_DEV_USER` | local development only | must never be set | | ignored in production builds |

### 9. Observability

| # | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| O1 | P1 | **No server error was logged.** `guarded()` and `guardedFor()` turned exceptions into responses silently; `src/` had no server-side `console.*` call and 289 silent catches; no request IDs, no error tracking, no metrics. What exists lives in the database: the `ai_usage` ledger, news source health, `last_error` columns, `workflow_runs`, and two cron-gated health probes. On launch night you would have seen 500s in Vercel with no cause. | `src/lib/auth/user.ts`, `src/lib/office/auth.ts` | One JSON log line per failed request with a reference that is also in the response; Sentry behind `SENTRY_DSN`. |

## Top 10

1. **Neon Free plan** (D1): 512 MB cap, 2 CU, compute and egress allowances. Upgrade first.
2. **Vercel Hobby** (V1): not for commercial use; its allowances run out in about a day. Upgrade first.
3. **No AI spend caps** (C1, C2, C5, C9): one script could run up the OpenAI bill.
4. **Manual inputs shared across customers** (A1): anyone could overwrite others' estimates; names shown; notes could inject prompts.
5. **Any user could run the global VC sync** (C3): 300 s jobs and a risk of an SEC ban for everyone.
6. **Live-update streams** (section 2, K1, D5): 1.67 queries/s per tab, no hidden-tab pause, full-document reloads.
7. **Newsroom feed** (D2, K2, E2): about 1 MB and 7 queries per poll per tab every minute, never pausing.
8. **Errors leaked SQL at 27 sites and nothing was logged** (E1, O1): blind on launch night.
9. **Upstream calls** (C8, E4, D4, C7): AI calls could wait 10 minutes and kept billing after the user left; 14 call sites had no timeout; failures were not cached and concurrent loads were not deduplicated; the EDGAR limiter was per instance.
10. **Market data** (C10): the FMP free quota runs out within minutes of launch traffic, and the fallback is personal-use only.

## Concurrent-user ceiling (estimates; see the load test for measurements)

Assumed mix per active user: 30% have the Newsroom open, 20% a Studio or collab session, everyone
has the notification bell, some browse the terminal. That is about **0.45 database queries/s and 1.5
function invocations a minute per active user**, plus about 0.3 MB a minute of database egress from
the feed alone.

- **Before the fixes:** a few hundred concurrent users run fine for hours. At about 1,000, the Free
  plan's egress allowance is gone in roughly an hour and Hobby's invocation allowance in about half a
  day, after which the database or the functions are cut off; market data falls back to Nasdaq within
  minutes. On raw capacity, the 2 CU database saturates at about 1,000 to 2,000 concurrent users,
  mostly from stream polling.
- **After the fixes and the plan upgrades** (Neon at 4 to 8 CU, Vercel Pro, a paid FMP plan): about
  0.05 to 0.1 queries/s per user, feed egress down about 90%, AI spend bounded by the caps. Estimated
  ceiling **5,000 to 10,000 concurrent users**; the next limit is database CPU, which is a slider (more
  CU) plus design C for the streams.

## Infrastructure you set up

These need your accounts or your decision; nothing here was done for you.

1. **Neon: Free to Launch (or Scale).** Console → Billing → Change plan. Then Branches → `production`
   → Edit compute: autoscaling maximum 4 CU to start (8 if the load test or launch traffic says so).
   `DATABASE_URL` does not change.
2. **Vercel: Hobby to Pro.** Team settings → Billing. Then Project → Settings → Functions → Region:
   `cle1` (Cleveland, next to Neon's `us-east-2`). `vercel.json` sets the same region.
3. **Preview isolation (G1).** Create a Neon branch `preview` from `production`, then in Vercel set
   Preview's `DATABASE_URL` to that branch's pooled connection string. Give Preview its own
   `FMP_API_KEY` and `OPENAI_API_KEY` (or remove them from Preview).
4. **Market data (C10).** Upgrade FMP to Starter or higher and buy its display licence before showing
   prices to paying users; replace `FMP_API_KEY` in Production. Once licensed, `MARKET_BACKUP=off`
   stops the Nasdaq fallback.
5. **Neon Auth.** Turn on email verification for sign-ups (Console → Auth → Settings), so the per-user
   caps cannot be multiplied with throwaway accounts.
6. **Sentry (recommended).** Create a Next.js project in Sentry and set `SENTRY_DSN` in Vercel
   (Production and Preview). The code sends errors only when it is set.
7. **Realtime (later).** When the streams dominate database load again, move them to Ably or Pusher
   (design C): create an app, set its server key and publishable key in Vercel, and publish Studio and
   collab events from the commit path instead of polling.
8. **Migration `drizzle/0012_launch.sql`.** Additive, indexes only, each created `CONCURRENTLY`:
   `kv_cache(expires_at)`, `ai_usage(created_at)` and a partial index for campaign drafts. No drops, no
   renames, no new tables. Apply it with `pnpm exec tsx scripts/apply-sql.mts drizzle/0012_launch.sql`
   against production, or ask for it to be applied. Everything works before it is applied, only
   slower.

New environment variables (all optional, with safe defaults):

| Variable | Default | What it does |
|---|---|---|
| `AI_USER_DAILY_USD` | the plan's (Free $0.75 to Enterprise $30) | Each person's AI spend per UTC day; when set, replaces every plan's amount. |
| `AI_USER_MONTHLY_USD` | the plan's (Free $3 to Enterprise $130) | Each person's AI spend per allowance month (the billing anniversary for subscribers, the 1st otherwise); when set, replaces every plan's amount. |
| `AI_GLOBAL_DAILY_USD` | `200` | Everyone's AI spend per UTC day, background work included. |
| `AI_DISABLED` | off | `1` turns off every model call; the app keeps working without AI. |
| `AI_ALLOWED_MODELS` | all | Comma-separated model ids people may pick. |
| `ADMIN_EMAILS` | none | Comma-separated emails that may run global jobs (VC sync). |
| `STREAM_MODE` | `adaptive` | `slow` stretches every live-update interval 5×: the lever if database load spikes. |
| `SENTRY_DSN` | none | Error tracking. |

## What is fixed and what is left

All P0s and P1s that code can fix are fixed and deployed. What is left needs an account owner, or
is P2.

### Fixed

| Finding | Commit | What changed |
|---|---|---|
| C1 AI spend | `5bf7168` | Checked before every model call: per-person and global daily caps, and `AI_DISABLED`. Two long runs at once per person. Runs stop between turns at the cap. Usage is written with `after()`. Unpriced models are costed by a high estimate. Web research and VC discovery are now recorded. |
| C5 Studio agent | `85c8fb4` | One run per document (a lease), 409 otherwise. |
| C4, V4, A10 limits | `fb82625` | Per-person rate limits on the CRM agent, drafting, mail sync and connect, VC discovery, SEC searches, Studio reading and export, and news tests. Office pairing is limited per caller. |
| C2 chat input | `a68d8e0` | Message and history caps, `AI_ALLOWED_MODELS`, and cancel-on-close for chat and tools. |
| C3/A2 VC sync | `6d51149` | Needs `CRON_SECRET` or `ADMIN_EMAILS`; one run per source at a time. |
| V5 | `089dafc` | Constant-time secret checks on the last two cron routes. |
| A1 manual inputs | `28a1d4b` | Private to the author, the note is capped, and inputs are read in one query per company batch. |
| Section 2, D5, K1 streams | `a9afe80` | One shared, activity-paced poll per document per instance, and `STREAM_MODE=slow`. Connections last two minutes. Access checks read two columns. Hidden tabs pause after 30 s. Collab starts from its loaded state. Metadata refreshes are light and debounced. |
| D2, K2, E2 Newsroom | `8ad32d6` | Shared, lean candidate stories. Cached networks. The unread `news:seen` write is removed. Deals, radar, facets and counts are memoized. Polling pauses when hidden and backs off. |
| K8 | `def6469` | All sparklines load, not just the first 24. |
| E1, O1 errors | `9626f03` | Internal errors become a reference and one JSON log line (Sentry when `SENTRY_DSN` is set). Messages written for people pass through. |
| C8 timeouts | `175448b` | AI calls: 120 s per turn (240 s for structured calls), one retry, and cancel reaches the SDK. Upstream fetches: 10–30 s timeouts. |
| D3, D4, E4, D10 cache and indexes | `630b9c7` | Single-flight loads, a bounded memory layer, 30 s failure memory, and batched cleanup. Migration 0012 (three indexes) is **applied to production**. |
| C7 EDGAR | `4651173` | A per-second budget shared across instances, a global back-off on 429/403, and the SEC feed's User-Agent. |
| A3, A5 access | `50316bf` | Collab honours team roles. Peer groups read only the caller's members. |
| V2, V3 background | `7e56297` | Autopilot (6) and the nightly agent (4) run in bounded pools. |
| G6, A6 headers | `7a76665` | HSTS, nosniff, referrer and permissions policies, and no `X-Powered-By`. Framing is denied except for the add-in's two pages. |
| D6, G2 region and env | `a292d01` | Functions run in `cle1` next to the database. The environment is checked at startup. Uncaught server errors are logged. |
| A13 sessions (found by the load test) | `e1474c0`, `26060d7` | The session cookie is trusted for 15 minutes (`NEON_AUTH_SESSION_DATA_TTL`). API routes pass through the proxy, which re-mints it once and hands it back; they still answer 401 themselves. |
| D11 query timeout (found by the load test) | `96ad81d` | Every database query gives up after 30 seconds. |

Production also got `ADMIN_EMAILS` (the founder), so the personal AI cap does not apply to the
owner.

### Left, needing an account owner (see [Infra](#infrastructure-you-set-up))

- D1/V1: Neon Launch or Scale, and Vercel Pro. These are the two things most likely to cut the site
  off under launch traffic.
- G1: a separate Preview database and keys.
- C10: a paid FMP plan with a display licence.
- C9: email verification in Neon Auth.
- Sentry: create a project and set `SENTRY_DSN`.

### Left, P2 (after launch)

D7 limits and pagination on per-user lists; D8 batched Studio writes; D9/G3 a migration journal;
V6 lazy imports; A4 wording; A7 removed members' invites; A8 atomic invite redemption; A9 push
endpoint ownership; A11 private-address block for mail servers; A12 guard `/api/ai/status` and
filter `profiles.extra`; C11 zod schemas on the remaining bodies; E3 layout fallback and panel error
boundaries; E5 is fixed in the agent route; K3–K7 bundles, re-renders, waterfalls, edge caching and
images; K9 the Newsroom's layout shift; G4 remove `stripe`; G5 `server-only` guards.

## Load test

### How it ran

- **Builds.** Two local production builds (`next start`): the code before this pass (`58415e9`) and after it. They ran one at a time against the same copy of production: the Neon `office-test` branch, with migration 0012 added for the "after" runs.
- **Sandbox.** Everything ran inside `scripts/load/offline.mjs`. Outbound requests could reach only the branch's own database and auth. OpenAI answered with a canned, streamed reply, and FMP, SEC, Nasdaq and every other service were refused, so no real quota or account was touched.
- **Load.** 60 signed-in users (created through the app's own sign-up and onboarding) with 1 to 3 seconds of think time. The mix:
  - page loads;
  - the Newsroom feed and the notification bell;
  - company data for five tickers;
  - deals, the brief and Studio documents;
  - 5% AI chat.

  Meanwhile 20 open Studio documents each had a teammate editing a cell every 5 seconds. Each run lasted 60 seconds after a warm-up.
- **Sessions.** Each run started with freshly minted session cookies, the way a browser has them.
- **Latency.** Latency includes the round trip from this machine to Neon; production functions sit next to the database (`cle1`). Compare the two columns with each other, not with production.

The test measures what each request and open tab costs at a fixed load. It does not find the breaking point; the ceiling below comes from those costs multiplied out.

### Results

| | Before | After |
|---|---|---|
| Requests a second / errors | 23.8 / 0% | 25.4 / 0% |
| Latency p50 / p95 (all requests) | 101 / 935 ms | **71** / 1,050 ms |
| Database queries a second | 162.7 | **122.2** (−25%) |
| Database queries per request | 6.85 | **4.80** (−30%) |
| Newsroom feed p50 / p95 | 589 / 810 ms | **165 / 305 ms** |
| Deal tracker p50 | 102 ms | **5 ms** |
| Morning brief p50 | 298 ms | **197 ms** |
| Company data (5 tickers) p50 | 194 ms | **145 ms** |
| Page loads (`/app`, `/app/news`) p50 | 61 to 65 ms | 60 to 61 ms |
| An edit reaching another open tab, p50 / p95 | 472 / 785 ms | **194 / 222 ms** |
| An open, quiet Studio tab: database queries a second | 1.56 | **0.63** in its first minute, **0.2** after (the pace eases off); **0** when the tab is hidden |
| Stream reconnections | every 45 s | every 120 s |
| People whose session cookie expired: Neon Auth calls | about one per API request (327 for 60 people in 30 s) | about three per person per 15 minutes (180 for 60 people) |

Notes:
- **p95.** p95 is set by the mock AI chat (about a second of streaming by design) in both builds. After the pass, a chat run also checks the spend limits and takes a run slot, which is three or four more database round trips. That is about 140 ms from this machine, and a few milliseconds next to the database.
- **Studio documents.** The document load now reads the stream cursor before the document, one sequential round trip more (see section 2), for correctness.
- **Everyone's cookie expiring at once.** In the stale-session test all 60 cookies had expired at the same moment. The burst of re-mints from one address pushed p95 to 7.9 s while Neon Auth caught up. Real cookies expire at different times; this is why the runbook says never to rotate `NEON_AUTH_COOKIE_SECRET` under traffic.
- **What the test itself found.** Two P1s:
  - A13: the session refresh signed people out;
  - D11: a query hung for fifteen minutes.

  Both are fixed above.

### Core Web Vitals (after, desktop, local build, cold cache, median of 3)

| Page | Time to first byte | First paint | Largest paint | Layout shift | JavaScript |
|---|---|---|---|---|---|
| `/app` | 76 ms | 116 ms | 452 ms | 0.011 | 271 KB |
| `/app/news` | 68 ms | 120 ms | 960 ms | **0.144** (K9) | 289 KB |
| `/app/terminal` | 66 ms | 128 ms | 868 ms | 0.002 | 301 KB |
| `/app/studio/[id]` | 69 ms | 116 ms | 364 ms | 0.000 | 306 KB |

These are good on a fast desktop connection. On a slow phone network, largest paint grows with the 270 to 306 KB of JavaScript (K3). Interaction latency (INP) needs a person clicking and was not measured.

### Ceiling, revisited

Measured per unit, after the pass:
- 4.8 queries per request (was 6.85);
- about 0.2 queries a second per open, quiet document (was 1.56), and none for hidden tabs;
- a Newsroom feed that reads shared, lean candidates (egress down about 90% by column choice alone).

The estimate stands at **5,000 to 10,000 concurrent users** once Neon (4 to 8 CU) and Vercel Pro are in place. Past that, the next limits are:
- database CPU: a slider in Neon, plus design C for the streams;
- Neon Auth's rate limit on session refreshes: about N / 900 a second for N people. Ask Neon for the limit on your plan before a big launch.

## Launch-day runbook

### Before opening the doors

1. **Plans.** Neon on Launch or Scale with a 4 CU maximum or more; Vercel on Pro. Both are in [Infra](#infrastructure-you-set-up).
2. **Environment.** After the deploy, open Vercel → Logs and search for `environment check`. It should say nothing is missing.
3. **Smoke test.** The home page loads, and `/app` redirects to sign-in. `curl -sI https://youbank-nu.vercel.app/` shows `strict-transport-security` and `x-frame-options`, and `x-vercel-id` starts with `cle1`.
4. **Secrets.** Do not rotate `NEON_AUTH_COOKIE_SECRET`, or any other secret, on launch day.

### What to watch

| Signal | Where | Healthy | Act when |
|---|---|---|---|
| 5xx rate | Vercel → Observability → Functions | under 0.5% | over 1% for five minutes |
| p95 latency | Vercel Observability, per route | pages under 1 s; API under 1.5 s (chat and runs are longer) | doubles |
| Failures | Vercel Logs, search `"level":"error"` | a trickle | one `ref` or `message` repeating |
| Signed-out bursts | Vercel Logs, search `429 Too Many Requests` (Neon Auth session refresh) | none | any |
| Database | Neon → Monitoring: CPU, compute size, connections | under 70% of the maximum CU | pinned at the maximum |
| Database storage and egress | Neon → Billing | within plan | nearing plan |
| AI spend today | the query below | under `AI_GLOBAL_DAILY_USD` | over 70% of it by midday |
| Market data | kv row `fmp:daily-limit` present | absent | present: FMP is out and Nasdaq is serving |
| SEC | kv row `edgar:backoff` present | absent | present: SEC asked us to slow down |

AI spend so far today (UTC), and the top spenders:

```sql
select round(sum(cost_usd)::numeric, 2) as usd_today from ai_usage where created_at >= date_trunc('day', now() at time zone 'utc');
select user_id, round(sum(cost_usd)::numeric, 2) as usd from ai_usage where created_at >= date_trunc('day', now() at time zone 'utc') group by 1 order by 2 desc limit 10;
```

### Levers

Change a value in Vercel → Settings → Environment Variables (Production), then redeploy: environment
changes reach only new deployments. Run `vercel --prod`, or use "Redeploy" on the current
deployment. Neon compute changes apply at once.

| Problem | Lever, in order |
|---|---|
| AI spend climbing | Lower `AI_GLOBAL_DAILY_USD` (for example to 50); lower `AI_USER_DAILY_USD`; set `AI_ALLOWED_MODELS=gpt-5.6-luna,gpt-5.6-terra` to stop the expensive models; set `AI_DISABLED=1` to stop all AI (the app keeps working). Lower `NEWS_AI_BUDGET_USD` for the Newsroom's own spend. |
| Database CPU or load | Raise the Neon maximum CU (immediate). Set `STREAM_MODE=slow` (live updates poll five times less). Set `AUTOPILOT_POOL=2` and `AGENT_POOL=1` to slow the background passes. |
| Neon Auth 429s, people signed out | Raise `NEON_AUTH_SESSION_DATA_TTL` (seconds; up to 3600) and ask Neon about the rate limit. |
| Market data blocked or wrong | `MARKET_BACKUP=off` stops the Nasdaq fallback (prices fall back to what is cached). |
| SEC throttling (`edgar:backoff`) | Nothing to flip: every instance waits a minute. If it repeats, check `EDGAR_USER_AGENT` has a real contact email. |

### Rolling back

- **Code.** Vercel → Deployments → the previous production deployment → **Promote to Production** (instant). The CLI equivalent is `vercel rollback`.
- **Database.** Migration 0012 only added indexes; nothing to undo. No other schema changed in this pass.
- **Environment levers.** Set them back and redeploy.
