# Platform and software frontier for YouBank (late October 2026)

Run `youbank-frontier-20261031`, track: cutting-edge software and platform technology for YouBank's stack
(Next.js 16.3.5, React 19.2.8, Vercel `cle1`, Neon Postgres + Drizzle, Better Auth 1.6.23, Inngest 4.21,
OpenAI + Anthropic SDKs, Neon Functions schedule triggers).

**How this was researched, and its limits.** Evidence comes from three places: (a) web searches (11 distinct
queries ran before the session's shared search budget ran out; the brief asked for 15+), (b) the version-matched
Next.js docs in `node_modules/next/dist/docs/` and other installed packages, and (c) the Neon skill references
checked into `.claude/skills/` (they state they were checked against neon.com docs on 2026-09-17). Page fetches
of `nextjs.org` and `vercel.com` were blocked by the session's network allow-list, so Vercel and Next.js claims
rest on search-result summaries. Topics 4 (MCP/agent protocols), 5 (CRDTs/sync engines), parts of 6 (SOC 2
tooling) and 7 (eval frameworks) could not be searched at all: everything said about their external state is
tagged **[UNVERIFIED]**, and the recommendations there lean on what is provably installed in `node_modules`.
A follow-up session with search budget should verify those sections first.

---

## Executive summary

1. **YouBank uses none of Next.js 16's caching model.** `grep` over `src/` finds zero `"use cache"`,
   `cacheTag`, `cacheLife`, `updateTag`, `revalidateTag` or `"use server"`, and 345 `export const dynamic`
   (343 `force-dynamic`). `cacheComponents` is the switch for PPR, `use cache`, Activity-preserved navigation
   and (new in 16.3) Partial Prefetching (`node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md`).
2. **Next.js 16.3 (stable 3 Aug 2026) is "Instant Navigations"**: dev server up to 90% less RAM, cached
   repeat builds, stable `catchError`, `next/root-params` ([nextjs.org/blog/next-16-3](https://nextjs.org/blog/next-16-3)).
   YouBank is already on 16.3.5, past the 16.3.3 security patch ([nitter mirror of @nextjs](https://nitter-canary.kareem.one/nextjs)).
3. **React Compiler is off.** Compiler 1.0 is reported stable ([besthub.dev](https://www.besthub.dev/articles/react-goes-independent-new-foundation-compiler-1-0-and-react-19-2-highlights-187009cf3ad7));
   16.3 adds an experimental native Rust port (`experimental.turbopackRustReactCompiler`, no Babel plugin
   needed). For a client-heavy terminal/Studio UI this is the cheapest measurable win.
4. **Vercel Workflow is GA (April 2026) and Vercel Queues is in public beta (Feb 2026)**
   ([Vercel weekly 2026-04-20](https://community.vercel.com/t/vercel-weekly-2026-04-20/38580),
   [News Cache 2026-03-02](https://community.vercel.com/t/news-cache-2026-03-02/34687)). Together they are a
   credible single replacement for YouBank's three schedulers (Vercel cron, Inngest, Neon Function relays), but
   Inngest already works; treat it as a spike, not a rewrite.
5. **Fluid compute bills Active CPU only while code runs; I/O waits (LLM calls, DB) do not count**
   ([Fluid compute pricing](https://vercel.com/docs/fluid-compute/pricing)). YouBank's request mix is
   I/O-bound (about 9 to 10 ms CPU per request, `docs/scale.md`), so Pro is cheap per request; Hobby's
   commercial-use ban, one-hour logs and daily crons are the real reasons to move.
6. **Neon's whole backend went GA on 17 Sept 2026**: Lakebase Postgres, Object Storage, Functions, Managed
   Better Auth, AI Gateway ([neon.com/blog/neon-backend-is-ga](https://neon.com/blog/neon-backend-is-ga),
   [Digg](https://digg.com/ai/djpmpnnz)). Managed Auth does not expose passkeys, SSO/SAML or API keys
   (`.claude/skills/neon-auth/SKILL.md`, plugin matrix), so YouBank should keep self-hosted Better Auth.
7. **Lakebase Search gives Neon a first-party BM25 index** (`lakebase_text` + `lakebase_bm25`, with
   `lakebase_vector`/`lakebase_ann` over pgvector types, Postgres 16+) (`.claude/skills/neon-postgres/references/full-text-search.md`).
   YouBank's Edge retrieval already does vector + full-text + RRF (`src/lib/edge/docs/retrieve.ts`) with
   `ts_rank_cd`; swapping in BM25 is a contained upgrade. Third-party `pg_search` on Neon is contested
   ([pghybrid on PyPI](https://pypi.org/project/pghybrid/0.1.3/) says removed for new projects in March 2026).
8. **The MCP connector can be built on what is already installed.** Better Auth 1.6.23 ships an `mcp` plugin
   with OAuth protected-resource metadata (`node_modules/better-auth/dist/plugins/mcp/index.d.mts`); its
   `oidc-provider` base is deprecated in favour of `@better-auth/oauth-provider`
   (`node_modules/better-auth/dist/plugins/oidc-provider/index.d.mts:32`). The spec revision and MCP Apps
   status named in the README roadmap could not be re-verified this session [UNVERIFIED].
9. **Vercel Ship 2026 (15 Oct, SF) was about agents**: Sandbox Drives GA (persistent agent workspaces), AI
   Gateway budgets per key/project/person/team, "MCP Events" beta, Vercel Connect short-lived OIDC credentials
   for agents ([Vercel recap](https://vercel.com/blog/vercel-ship-2026-recap), [Roboto Studio](https://robotostudio.com/blog/vercel-ship-2026-san-francisco),
   [Qovery](https://www.qovery.com/blog/vercel-ship-2026-takeaways-byoc-own-cloud)).
10. **Quality tooling gap**: no test runner config exists (only `scripts/e2e-*.ts`, `scripts/eval-*.ts`).
    Next 16.3 ships `@next/playwright` with an `instant()` helper for navigation regressions
    (`node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`), and `@vercel/otel` is the
    documented OTel path (`.../02-guides/open-telemetry.md`); YouBank uses neither.

---

## 1. Next.js 16.x and React 19.2+

### What shipped

| Feature | Status in installed Next 16.3.5 | Source |
|---|---|---|
| Cache Components (`cacheComponents: true`) | Stable flag since 16.0; unifies `ppr`, `useCache`, `dynamicIO`; PPR is the default App Router behaviour with it | `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/cacheComponents.md` |
| `"use cache"`, `"use cache: remote"`, `"use cache: private"` | Need `cacheComponents`. `remote` = durable cache shared across instances via `cacheHandlers` (hosting providers usually supply it); `private` = may read `cookies()`/`headers()`, never stored server-side, kept in browser memory for the `cacheLife` stale time | `.../01-directives/use-cache-remote.md`, `.../use-cache-private.md` |
| `updateTag` vs `revalidateTag` | `updateTag` = read-your-own-writes, **Server Actions only**; `revalidateTag` works in Route Handlers | `.../04-functions/updateTag.md` |
| `io()` | 16.3: marks `new Date()`/`Math.random()` as request-time so it stays out of the static shell | `.../04-functions/io.md` |
| Activity-preserved navigation | With `cacheComponents`, previous routes are set to `<Activity mode="hidden">`: state kept, effects cleaned up | `cacheComponents.md`, "Navigation with Activity" |
| Partial Prefetching | `<Link>` prefetches a per-route App Shell; requires `cacheComponents`; adoption skill `next-partial-prefetching-adoption` | `.../02-guides/adopting-partial-prefetching.md` |
| Instant-navigation validation | Dev overlay flags routes that block navigation; `instant = false` opt-out; codemod `cache-components-instant-false` | `.../02-guides/migrating-to-cache-components.md` |
| React Compiler | `reactCompiler: true` (Babel plugin) or 16.3's experimental `turbopackRustReactCompiler` (native, no plugin) | `.../reactCompiler.md`, `.../turbopackRustReactCompiler.md` |
| `<ViewTransition>` | Works in App Router with no config (App Router bundles React canary); `<Link transitionTypes>` since 16.2 | `.../02-guides/view-transitions.md`, `.../02-components/link.md` |
| `after()` | Runs after the response for the route's `maxDuration`; on Vercel via `waitUntil` | `.../04-functions/after.md` |
| Proxy (was middleware) | Renamed in 16.0, Node runtime by default, `runtime` option not allowed | `.../03-file-conventions/proxy.md` |
| `catchError`, `error.tsx` `retry` | Stable in 16.3 | `.../04-functions/catchError.md`, `.../03-file-conventions/error.md` |
| `useOffline` | Experimental (`experimental.useOffline`) | `.../04-functions/use-offline.md` |
| Strict CSP via SRI | Experimental `experimental.sri`: hash-based CSP that keeps static generation | `.../02-guides/content-security-policy.md` (line ~456) |

Release context: 16.3 stable on 3 Aug 2026, headline "Instant Navigations", dev memory up to 90% lower, repeat
builds read unchanged artefacts from cache ([nextjs.org/blog/next-16-3](https://nextjs.org/blog/next-16-3);
date corroborated by [lilting.ch](https://lilting.ch/en/articles/nextjs-16-3-astro-nuxt-benchmark)).
React 19.2 brought `<Activity>` and `useEffectEvent`; React Compiler 1.0 announced at React Conf 2025 with the
React Foundation ([dev.to deep-dive](https://dev.to/webtoolshub/react-192-activity-useeffectevent-react-compiler-a-practical-deep-dive-2026-glp),
[besthub.dev](https://www.besthub.dev/articles/react-goes-independent-new-foundation-compiler-1-0-and-react-19-2-highlights-187009cf3ad7),
[certificates.dev](https://certificates.dev/blog/whats-new-in-react-192)). These are secondary sources; no
react.dev post was in the results. **Measured benefits**: I found no independent benchmark numbers for Cache
Components or the Compiler on an app like YouBank [UNVERIFIED]; measure with `scripts/perf/budget.mjs`.

### What YouBank uses today (grep of `src/`, 2026-10-31)

| Feature | Use |
|---|---|
| `"use cache"` / `cacheTag` / `cacheLife` / `updateTag` / `revalidateTag` / `unstable_cache` | 0 files |
| `"use server"` (Server Functions) | 0 files. All mutations go through 324 Route Handlers (`src/app/api/**/route.ts`) |
| `export const dynamic` | 345 (343 `force-dynamic`, 2 `force-static`); 24 of 41 `page.tsx`/`layout.tsx` files |
| `after()` from `next/server` | 22 files (already adopted), plus a `waitUntil` helper in `src/lib/cache.ts:190` |
| `<ViewTransition>` | 0. Theme switching calls `document.startViewTransition` directly (`src/components/theme/ThemeProvider.tsx:26`) |
| React `<Activity>` | 0 (the `Activity` hits in `AlgoHub.tsx`/`CopyHub.tsx` are a local component named Activity) |
| `useOptimistic` / `useActionState` / `useEffectEvent` | 0 |
| `reactCompiler` | not set in `next.config.ts` |
| Proxy | `src/proxy.ts` exists |
| OpenTelemetry | not wired (`src/instrumentation.ts` logs env and errors only) |

**Implication for YouBank.** The highest-leverage moves are (a) React Compiler, nearly free; (b) incremental
Cache Components adoption starting with the public, mostly-shared pages (`/news`, `/story`, `/for`, `/pricing`,
`/`) where a static shell plus `use cache` with `cacheTag` gives instant loads and lower DB reads; the 324
Route Handlers do not need to change (`revalidateTag` works there). The migration guide says segments still
exporting `dynamic`/`revalidate`/`fetchCache` error once the flag is on, so the first PR is: enable the flag, run
the `cache-components-instant-false` codemod, delete the `force-dynamic` exports, get green, then convert one
route at a time. Activity-preserved navigation interacts with YouBank's SSE streams (`src/lib/client/sse.ts`):
hidden routes' effects are cleaned up, so streams close as they do for hidden tabs today, but terminal screens
would keep their state on back-navigation, which is a user-visible improvement for a Bloomberg-style workflow.

---

## 2. Vercel platform in 2026

| Capability | Status and facts found | Source |
|---|---|---|
| Fluid compute / Active CPU | Active CPU billed only while code runs; waiting on I/O (AI calls, DB) excluded; Provisioned Memory billed until last in-flight request finishes; Hobby includes 4 h Active CPU and 360 GB-hrs memory; Pro on demand, varies by region (doc updated 2026-06-16) | [Fluid compute pricing](https://vercel.com/docs/fluid-compute/pricing) |
| Function duration | Hobby 300 s max; Pro and Enterprise 800 s max (wall clock) | [Vercel services guide](https://vercel.com/kb/guide/vercel-services-fluid-compute) (seen via mirror summaries; check the limits page) |
| Cron jobs | 100 per project (with a footnote I could not read); YouBank's own docs say Hobby crons run once a day | [Vercel limits](https://vercel.com/docs/limits); `neon/autopilot.ts` header |
| Workflow (Workflow DevKit) | Open-sourced as public beta 2025-10-23; `"use workflow"` / `"use step"` directives; `sleep` pauses without holding compute; GA in the week of 10 to 17 April 2026; billed on Events, Data Written, Data Retained; runs on Queues, billed separately | [changelog: WDK beta](https://vercel.com/changelog/open-source-workflow-dev-kit-is-now-in-public-beta), [Vercel weekly 2026-04-20](https://community.vercel.com/t/vercel-weekly-2026-04-20/38580), [Workflow pricing](https://vercel.com/docs/workflows/pricing), [landscape](https://landscape.jimmysong.io/projects/vercel-workflow/) |
| Queues | Public beta (27 Feb 2026 per a third-party page), "durable event streaming built with Fluid compute", all plans; Python SDK beta 19 Aug 2026 | [News Cache 2026-03-02](https://community.vercel.com/t/news-cache-2026-03-02/34687), [skills.sh vercel-queues](https://skills.sh/vercel/vercel-plugin/vercel-queues), [Python Queues changelog](https://vercel.com/changelog/vercel-python-queues-sdk-is-now-available-in-beta) |
| Ship 2026 (SF, 15 Oct) | Drives GA for Sandbox (persistent agent workspaces; Drives public beta 22 Sept with up to 16 TiB); AI Gateway budgets per API key, project, person, team; MCP Events beta | [Vercel Ship 2026 recap](https://vercel.com/blog/vercel-ship-2026-recap), [Roboto Studio](https://robotostudio.com/blog/vercel-ship-2026-san-francisco) |
| Ship London/NYC (June) | `eve` open-source TS agent framework; Vercel Agent (private beta) for production investigation; Vercel Connect: short-lived scoped OIDC tokens for agents; Vercel says agents went from under 3% to over half of deployments in six months (vendor metric) | [Qovery](https://www.qovery.com/blog/vercel-ship-2026-takeaways-byoc-own-cloud), [Digital Applied](https://www.digitalapplied.com/blog/vercel-ship-2026-agents-half-of-deployments-enterprise-stack) |
| AI Gateway | 400+ models through one endpoint, fallbacks, usage monitoring, budgets | [Vercel Ship 2026 recap](https://vercel.com/blog/vercel-ship-2026-recap) |
| BotID | Invisible bot check instead of CAPTCHA for sensitive routes; no 2026-specific announcement found | same search; material dates from Ship 2025 [UNVERIFIED for 2026 changes] |
| Edge Config, observability | Not covered by any search that ran [UNVERIFIED] | — |

### What would replace hand-rolled crons, Neon Function relays and Inngest?

Today YouBank has three schedulers: 7 daily Vercel crons (`vercel.json`), 4 Neon Function relays that POST to
`/api/cron/*` every few minutes because Hobby crons are daily (`neon/autopilot.ts`, `news.ts`, `calendar.ts`,
`copytrade.ts`), and Inngest functions with hourly crons, per-person concurrency keys and steps
(`src/lib/edge/functions.ts`, `src/lib/algo/functions.ts`).

- **Vercel Workflow + Queues** could absorb all three: workflows for multi-step durable runs (canvas runs,
  document ingest, LBO refinement), `sleep` for long waits without compute, Queues for fan-out. Missing
  evidence: whether Workflow offers per-key concurrency equivalent to Inngest's `concurrency: { key }` that
  `docs/scale.md` relies on, and cron-triggered workflows [UNVERIFIED].
- **Neon Function Triggers** remain schedule-only, with the same 15-minute time-to-first-byte limit
  (`.claude/skills/neon-functions/SKILL.md`, "Function Triggers").
- **Recommendation**: move to Vercel Pro first (required anyway before charging; `docs/production.md` §7),
  which removes the reason for the Neon relays if Pro crons can run at sub-hourly frequency [UNVERIFIED; check
  vercel.com/docs/cron-jobs/usage-and-pricing]. Keep Inngest for concurrency-keyed work; run a one-function
  Workflow spike (e.g. `edge/doc.ingest`) before deciding on consolidation.

**Implication for YouBank.** Files: `vercel.json`, `neon/*.ts`, `src/app/api/cron/*`, `src/lib/edge/functions.ts`,
`src/lib/algo/functions.ts`, `src/app/api/inngest/route.ts`, `docs/production.md`. AI Gateway budgets overlap
YouBank's own spend ledger (`src/lib/ai/spend.ts`, `src/lib/ai/limits.ts`); the ledger is more granular
(per person, per plan), so the Gateway is only worth it for provider failover.

---

## 3. Neon in 2026, Postgres 18, search, replication

- **Neon backend GA (17 Sept 2026)**: Lakebase Postgres, Object Storage (S3-compatible, branches with the
  data; 5 GB per project on Free), Functions (long-running Node.js next to Postgres), Managed Better Auth (free up
  to 60,000 MAU), AI Gateway. "One product, reached two ways: through Neon ... or through Databricks"
  ([neon.com/blog/neon-backend-is-ga](https://neon.com/blog/neon-backend-is-ga), [Digg](https://digg.com/ai/djpmpnnz)).
  No separate Databricks-branded 2026 Lakebase announcement turned up in search.
- **Managed Auth limits** (checked 2026-09-17): Organization is "Partial, Beta" (no teams, custom roles);
  Passkey, API Key, Generic OAuth, Multi Session "not exposed"; SSO/SAML "not listed"; MCP OAuth is in the plugin
  check list (`.claude/skills/neon-auth/SKILL.md`, "Plugin support"). YouBank's self-hosted Better Auth must stay.
- **Lakebase Search** (`.claude/skills/neon-postgres/references/`):
  - `lakebase_text` + `CREATE INDEX ... USING lakebase_bm25 (body_tsv)`; query with
    `body_tsv <@> to_bm25query(...)` (negative score, sort ascending); `lakebase_bm25.default_limit` (default
    1000) and `lakebase_bm25.prefilter` GUCs; requires Postgres 16+.
  - `lakebase_vector` installs pgvector via `CASCADE`, index method `lakebase_ann`, same operators
    ([neon.com/docs/extensions/lakebase-vector](https://neon.com/docs/extensions/lakebase-vector), cited by the skill).
  - No built-in hybrid function: run both retrievers, fuse (RRF) yourself, which is what YouBank already does.
- **pg_search (ParadeDB) on Neon is contested**: one page says BM25 extensions were removed for new Neon
  projects in March 2026 ([pghybrid](https://pypi.org/project/pghybrid/0.1.3/)); an April 2026 article calls it
  production-ready on Neon ([SoftwareSeni](https://www.softwareseni.com/replacing-elasticsearch-with-postgres-using-bm25-hybrid-search-and-rrf/)).
  Use Lakebase's own `lakebase_text` instead of betting on it. TigerData's `pg_textsearch` is prerelease
  ([TigerData docs](https://www.tigerdata.com/docs/use-timescale/latest/extensions/pg-textsearch)).
- **Postgres 18** (released 25 Sept 2025): asynchronous I/O (claims of 2 to 3x faster reads in scans and
  vacuum), built-in `uuidv7()`, virtual generated columns by default (not indexable), OAuth 2.0 client
  authentication, MD5 passwords deprecated ([Crunchy Data](https://crunchydata.com/blog/get-excited-about-postgres-18),
  [Neon PG18 page](https://neon.com/postgresql/postgresql-18-new-features),
  [AlternativeTo](https://alternativeto.net/news/2025/9/postgresql-18-released-with-async-i-o-subsystem-performance-improvements-and-oauth-support)).
  Whether YouBank's Neon project can be moved to PG18 in place [UNVERIFIED].
- **Read replicas and logical replication** are covered by the `neon-postgres` skill (its description lists
  both); no 2026 changes surfaced in search [UNVERIFIED].
- **Branching for previews**: `docs/production.md` tells the owner to hand-make one `preview` branch shared by
  every preview deployment. The `neon-postgres-branches` skill covers branch-per-PR, expiry and schema-only
  branches; a branch per preview (via Neon's Vercel integration [UNVERIFIED in this session]) would let every
  migration in `drizzle/` be tested on production-shaped data.

**Implication for YouBank.** (1) Swap `ts_rank_cd` for `lakebase_bm25` in `src/lib/edge/docs/retrieve.ts`
(lines ~86 to 91) with a new `drizzle/00NN_bm25.sql`, keeping the existing RRF `fuse()`. Same for Newsroom
search if it uses `tsvector` (`src/db/schema.ts:1321`). (2) Evaluate Neon Object Storage against R2
(`R2_*` in `docs/production.md`) only for the branching benefit; no migration is needed otherwise.
(3) `uuidv7()` for new high-insert tables (Studio event log, notifications) once on PG18.

---

## 4. Agent-facing distribution (MCP, Apps, A2A, agentic payments)

Search budget ran out before this topic. What follows separates installed facts from unverified context.

**Installed, verifiable today**
- Better Auth 1.6.23 exports `better-auth/plugins/mcp` with `mcp({ loginPage, resource, oidcConfig })`, an
  OAuth consent endpoint, `getMCPProviderMetadata` and `getMCPProtectedResourceMetadata` (returns `resource`,
  `authorization_servers`, `jwks_uri`, `scopes_supported`, `bearer_methods_supported`)
  (`node_modules/better-auth/dist/plugins/mcp/index.d.mts`). It sits on `oidc-provider`, which is marked
  "@deprecated Use `@better-auth/oauth-provider` instead. This plugin will be removed in the next major version"
  (`node_modules/better-auth/dist/plugins/oidc-provider/index.d.mts:32`). Also installed: `jwt`,
  `device-authorization`, `organization`, `two-factor`, `bearer`, `haveibeenpwned` plugins.
- OpenAI's SDK (7.20) has a remote `mcp` tool type in the Responses API
  (`node_modules/openai/resources/responses/responses.d.ts`); Anthropic's SDK (0.127) has MCP server params in
  beta Messages (`node_modules/@anthropic-ai/sdk/resources/beta/messages/index.d.ts`). YouBank's own assistant
  could consume third-party MCP servers with no new dependency.
- Next.js 16 ships `next-devtools-mcp` for coding agents (dev only, not a product feature)
  (`node_modules/next/dist/docs/01-app/02-guides/mcp.md`).
- Vercel launched "MCP Events" (beta) at Ship SF 2026, letting agents act when something happens in a connected
  tool ([Roboto Studio](https://robotostudio.com/blog/vercel-ship-2026-san-francisco)).

**Unverified this session (re-check before building)**
- The README roadmap (line ~2104) cites a "stateless 2026-07-28 MCP specification, with MCP Apps for rendered
  results" and says `mcp-handler` needs its own OAuth 2.1 authorization server [UNVERIFIED: spec date, stateless
  transport details, MCP Apps status, `mcp-handler` version and its `withMcpAuth` helper were not re-checked].
- OpenAI Apps SDK / ChatGPT app directory submission rules, Claude connectors directory requirements, the MCP
  registry, A2A protocol status, AP2, Agentic Commerce Protocol, and Stripe's agent toolkit [all UNVERIFIED].

**Implication for YouBank.** The connector is buildable on installed parts: an MCP route
(`src/app/api/mcp/[transport]/route.ts`, new) exposing a curated slice of the terminal tools (`src/lib/terminal/*`,
Form D x directory x XBRL as the README says), with `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server` served from Better Auth (`src/lib/auth/server.ts`, which today has only
`plugins: [nextCookies()]`). Prefer `@better-auth/oauth-provider` over the deprecated `oidc-provider` base so the
next Better Auth major does not force a rewrite. Bill MCP tool calls through the existing usage ledger
(`src/lib/ai/usage.ts`) and entitlements (`src/lib/billing/entitlements.ts`). Agentic payments are not a fit
until the plans are live in Stripe.

---

## 5. Real-time and collaboration

**Installed, verifiable today**
- YouBank's live layer is SSE over an append-only Postgres log, polled once per log per instance (1 s while
  active, easing to 5 s; 120 s stream lifetime with `Last-Event-ID` resume) (`src/lib/realtime/feed.ts`,
  `src/lib/client/sse.ts`). `docs/scale.md` names this polling as the next limit for thousands of open Studio
  documents.
- The Office add-in still polls every four seconds (README roadmap: "pushing changes to the add-in over a stream,
  instead of a four-second poll").
- Neon Functions are positioned for "a WebSocket or server-sent-events (SSE) server" that does not time out like
  lambda-style functions (`.claude/skills/neon-functions/SKILL.md`, description). That is an option for a
  long-lived socket tier next to the database, branching with it.
- No CRDT library is a dependency (`package.json`).

**Unverified this session**: current status of Yjs, Automerge 3, Loro, Zero, ElectricSQL, LiveStore, and
Vercel's WebSocket support [all UNVERIFIED].

**Implication for YouBank.** A CRDT is not needed: Studio edits are agent- and cell-granular operations already
serialised through an event log (`src/lib/studio/ops.ts`, `sync.ts`). The cheap win is reusing `feed.ts` for the
add-in (`src/app/api/office/*`, the taskpane under `src/app/office/`), replacing the four-second poll. If open
documents reach thousands, replace per-instance polling with `LISTEN/NOTIFY` on a direct (unpooled) connection
from a single Neon Function that fans out over SSE; note PgBouncer transaction pooling does not carry
`LISTEN` (general Postgres behaviour; verify on Neon [UNVERIFIED]).

---

## 6. Security and compliance engineering

- **Auth today**: Better Auth 1.6.23 with only `nextCookies()` (`src/lib/auth/server.ts:51`); email/password and
  Google; no 2FA, passkeys, organizations, SSO or SCIM (`grep` finds no use).
- **Available without new packages**: `two-factor` (TOTP/OTP), `organization`, `haveibeenpwned`, `jwt`,
  `bearer`, `device-authorization` (useful for the Office add-in and desktop pairing that today uses a custom
  poll-secret flow in `src/lib/office/auth.ts`) (`node_modules/better-auth/package.json` exports).
- **Not installed**: passkeys, SSO/SAML and SCIM are separate Better Auth packages; names and 1.6-era feature
  sets [UNVERIFIED this session].
- **CSP**: `next.config.ts` allows `'unsafe-inline'` for scripts because "a nonce would need a proxy on every
  page". Next's docs offer two routes: nonces from Proxy (forces dynamic rendering, conflicts with static shells)
  or experimental SRI, "hash-based CSP ... allows you to maintain static generation while still having a strict
  CSP" (`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`). SRI is the one compatible
  with Cache Components. Inline scripts YouBank writes itself (e.g. the `dangerouslySetInnerHTML` block in `src/app/news/[slug]/page.tsx`) need checking against the SRI policy.
- **SOC 2 automation** (Vanta, Drata, Comp AI) pricing and 2026 features [UNVERIFIED]. The README lists SOC 2
  Type I on the roadmap.
- **Secrets**: Vercel Connect (short-lived OIDC credentials for agents) was announced in June 2026
  ([Qovery](https://www.qovery.com/blog/vercel-ship-2026-takeaways-byoc-own-cloud)); YouBank's long-lived secrets
  (`EMAIL_TOKEN_SECRET`, `CRON_SECRET`, `AUTOPILOT_SECRET`) cannot rotate without breakage (`docs/production.md`).

**Implication for YouBank.** Add `twoFactor` now (financial data, broker connections, SOC 2 evidence); add
passkeys and SSO/SAML when Deal Team/Enterprise seats sell. Files: `src/lib/auth/server.ts`, the auth client,
`src/db/schema.ts` + a migration, settings UI. Make `EMAIL_TOKEN_SECRET` rotatable (key id prefix on ciphertext)
before SOC 2.

---

## 7. Testing and quality

- **`@next/playwright` `instant()`** asserts what is on screen immediately on navigation, both for `page.goto()`
  and client `<Link>` clicks; install with `@playwright/test`
  (`node_modules/next/dist/docs/01-app/02-guides/instant-navigation.md`, "Prevent regressions with e2e tests";
  `.../02-guides/testing/playwright.md`).
- **OpenTelemetry**: `@vercel/otel` with `@opentelemetry/sdk-logs`, `api-logs`, `instrumentation`
  (`.../02-guides/open-telemetry.md`). Many `@opentelemetry/*` packages are already in the pnpm store
  transitively (`node_modules/.pnpm/@opentelemetry+*`), so the dependency cost is small.
- **YouBank today**: no test runner config; scripted e2e (`scripts/e2e-*.ts`) and offline evals with fixtures
  (`scripts/eval-calls.ts`, `eval-claims.ts`, `eval-lbo.ts`, `eval-odds.ts`, `eval-precedents.ts`,
  `eval-docs.ts`); the load test in `scripts/load/`.
- **Unverified this session**: Playwright's agent features, Braintrust, Langfuse, promptfoo, OpenAI Evals, and
  the state of OpenTelemetry GenAI semantic conventions [all UNVERIFIED].

**Implication for YouBank.** Wire `@vercel/otel` in `src/instrumentation.ts` and emit one span per model call
from `src/lib/ai/agent.ts`/`usage.ts` with model, tokens, cost and cache hits (attribute names to follow the OTel
GenAI conventions once verified). Promote the eval scripts into a CI job that fails on regression, and add
`instant()` tests for the five busiest routes before the Cache Components migration so its effect is measured.

---

## Engineering moves for YouBank

Ranked by value divided by effort. "Evidence" points to the section above.

| # | Move | Value | Effort | Evidence | Files |
|---|---|---|---|---|---|
| 1 | **Turn on React Compiler** (`reactCompiler: true`, try `experimental.turbopackRustReactCompiler`); compare `pnpm perf:budget` and interaction latency on Terminal, Studio, Edge canvases before and after | Medium-high | Low | §1; `reactCompiler.md`, `turbopackRustReactCompiler.md` | `next.config.ts`, `package.json` (only if using the Babel path) |
| 2 | **Add `twoFactor` (and `haveibeenpwned`) to Better Auth**; require 2FA for real-money switches and broker connections | High (trust, SOC 2) | Low-medium | §6; installed plugin exports | `src/lib/auth/server.ts`, auth client, `src/db/schema.ts`, `drizzle/00NN_*.sql`, settings UI |
| 3 | **BM25 for Edge retrieval via `lakebase_text`/`lakebase_bm25`**, keeping RRF; A/B with `scripts/eval-docs.ts` | Medium-high | Low-medium | §3; `.claude/skills/neon-postgres/references/full-text-search.md` | `src/lib/edge/docs/retrieve.ts`, `store.ts`, new `drizzle/00NN_bm25.sql`, `scripts/db-setup.mts` |
| 4 | **Remote MCP server (the roadmap connector)** on Better Auth's `mcp` plugin, migrating to `@better-auth/oauth-provider`; curated read-only tools first (Form D, XBRL, directory), metered through the usage ledger | High (distribution) | Medium | §4 (spec details [UNVERIFIED]) | new `src/app/api/mcp/[transport]/route.ts`, `.well-known` routes, `src/lib/auth/server.ts`, `src/lib/terminal/*`, `src/lib/ai/usage.ts`, `src/lib/billing/entitlements.ts`, `src/proxy.ts` (CORS) |
| 5 | **Move to Vercel Pro** and retire the Neon heartbeat relays if Pro cron frequency allows; keep log drains | High (legal + ops) | Low | §2; `docs/production.md` §7 | `vercel.json`, `neon/*.ts`, `docs/production.md` |
| 6 | **OpenTelemetry with `@vercel/otel`**, one span per model call and per tool call | Medium-high | Low-medium | §7; `open-telemetry.md` | `src/instrumentation.ts`, `src/lib/ai/agent.ts`, `src/lib/ai/usage.ts`, `package.json` |
| 7 | **Office add-in push over the existing SSE feed**, replacing the 4 s poll | Medium | Low-medium | §5; README roadmap | `src/lib/realtime/feed.ts`, `src/app/api/office/*`, `src/app/office/*` |
| 8 | **Playwright + `@next/playwright` `instant()` tests in CI** for the busiest routes; fold `scripts/e2e-*.ts` in over time | Medium | Medium | §7 | new `e2e/`, `playwright.config.ts`, `package.json`, `.github/workflows/` |
| 9 | **Cache Components, phase 1**: enable flag, `cache-components-instant-false` codemod, drop 345 `dynamic` exports, convert public pages (`/`, `/news`, `/story`, `/for`, `/pricing`) to `use cache` + `cacheTag`, invalidate with `revalidateTag` from Route Handlers | High (instant loads, fewer DB reads, Activity state) | Medium-high | §1; `migrating-to-cache-components.md` | `next.config.ts`, all `page.tsx`/`layout.tsx`, `src/lib/news/*`, `src/lib/cache.ts` |
| 10 | **Neon branch per preview deployment** with expiry | Medium (safe migrations) | Low-medium | §3; `neon-postgres-branches` skill | Vercel/Neon integration settings, `docs/production.md`, CI |
| 11 | **Strict script CSP via experimental SRI** (drop `'unsafe-inline'` for scripts outside the Office pages) | Medium (security review) | Medium | §6; `content-security-policy.md` SRI section | `next.config.ts`, `src/app/news/[slug]/page.tsx` (inline block) |
| 12 | **Workflow spike**: port one Inngest function (`edge/doc.ingest`) to Vercel Workflow; decide consolidation on concurrency-key support and cost | Medium (fewer schedulers) | Medium | §2 | `src/lib/edge/functions.ts`, `src/app/api/inngest/route.ts`, `package.json` |
| 13 | **SSO/SAML and passkeys** for Deal Team/Enterprise (separate Better Auth packages) | High once seats sell | Medium | §6 [package details UNVERIFIED] | `src/lib/auth/server.ts`, `src/lib/teams/*`, `src/lib/billing/seats.ts`, schema |
| 14 | **`<ViewTransition>` and `<Link transitionTypes>`** for terminal screen changes and Studio panels (theme already uses the raw API) | Low-medium (polish) | Low | §1; `view-transitions.md` | `src/components/terminal/*`, `src/components/theme/ThemeProvider.tsx` |
| 15 | **Postgres 18 on Neon** (`uuidv7`, async I/O) when Neon offers an upgrade path | Low-medium | Medium | §3 [Neon availability UNVERIFIED] | `drizzle/`, `src/db/schema.ts`, `docs/scale.md` re-run |

### Verify next (with search budget)
MCP spec revision and stateless transport, MCP Apps status, `mcp-handler` auth helpers, ChatGPT app and Claude
connector directory rules, A2A/AP2/ACP status, Vercel Pro cron frequency, Workflow concurrency keys, BotID 2026
changes, Yjs/Automerge/Loro/Zero/Electric status, Better Auth passkey/SSO/SCIM package versions, Vanta/Drata/Comp
AI, OTel GenAI semantic-convention status, Playwright agents, and eval platforms.
