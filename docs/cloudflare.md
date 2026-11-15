# Cloudflare

YouBank's frontend and API stay on Vercel. Cloudflare runs the pieces it does best. Every piece is optional and
fails back to the app's own way of doing the job, so nothing breaks when a setting is missing or Cloudflare is
down.

| Piece | What it does | Where | Turned on by |
|---|---|---|---|
| AI Gateway | Routes every OpenAI and Anthropic call; per-feature cost, latency and error analytics; optional caching of repeated structured extractions; falls back to the provider directly if the gateway cannot carry a request | `src/lib/ai/gateway.ts` | `CF_AI_GATEWAY_URL` (or `CF_ACCOUNT_ID` + `CF_AI_GATEWAY_ID`) |
| R2 | Satellite crops and EDGAR filed documents are kept after the first fetch (immutable, no egress fees); joins Edge's existing R2 use | `src/app/api/edge/img`, `src/lib/edge/imgsrc.ts`, `src/lib/edgar/client.ts` | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (already used by Edge) |
| Thesis Agent | One Agents SDK agent (a Durable Object with SQLite) per thesis; wakes itself at the thesis's next check-in, runs the tick in YouBank, logs it, sleeps (free while idle) | `cloudflare/src/thesis.ts` | `CF_WORKER_URL` + `CF_WORKER_SECRET` |
| Research ledger | One Durable Object per person places each entry (one request at a time) and keeps an independent copy of the chain; YouBank verifies every hash it returns | `cloudflare/src/ledger.ts`, `src/lib/ledger/store.ts` | same |
| Kill-criteria Workflow | The nightly check: plan, insider selling, new filings, then each book as its own retried step | `cloudflare/src/workflow.ts`, `src/app/api/cf/book` | same (Vercel's evening cron starts it) |
| Hosted MCP | YouBank's MCP tools, prompts and resources at the Worker's `/mcp`, one stateful session per connection, with an approval gate on tools that write and a per-session call log | `cloudflare/src/mcp.ts` | deploy the Worker; connect with a YouBank API key |

**Turnstile** (bot protection on sign-up and the reset-link form, `src/lib/auth/bot.ts`): in the dashboard go to
Turnstile → Add widget, hostname `youbank.dev`, mode Managed. In Vercel set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and
`TURNSTILE_SECRET_KEY`, then redeploy. A token that does not verify, or no answer from Cloudflare, refuses the sign-up.

`CF_DISABLE=ledger` (or `thesis`, `workflow`, `mcp`, `all`) keeps a part in the app even with the Worker set up.

## Set up

1. **AI Gateway.** In the Cloudflare dashboard go to AI → AI Gateway → Create gateway (e.g. `youbank`). In Vercel set
   `CF_AI_GATEWAY_URL=https://gateway.ai.cloudflare.com/v1/<account id>/youbank` and redeploy. If you turned on
   authentication for the gateway, also set `CF_AI_GATEWAY_TOKEN`. To let the gateway answer repeated
   structured extractions itself, set `CF_AI_GATEWAY_CACHE_TTL=3600`. Costs per feature show under the
   gateway's Logs, filtered by metadata `feature`.
2. **The Worker.**
   ```sh
   cd cloudflare && npm install
   npx wrangler login
   # Make one shared secret (at least 32 characters) and keep it for step 3.
   openssl rand -hex 24
   npx wrangler secret put APP_SECRET            # paste the secret
   # APP_URL in wrangler.jsonc is https://youbank.dev; change it for another domain.
   npx wrangler deploy                            # prints https://youbank-cf.<you>.workers.dev
   ```
3. **Point YouBank at it.** In Vercel set `CF_WORKER_URL=https://youbank-cf.<you>.workers.dev` and
   `CF_WORKER_SECRET=<the same secret>`, then redeploy. `/api/health?probe=keys` (as an admin) shows
   `cloudflare.worker.reachable: true` and which parts run there.
4. **Hosted MCP (optional).** In an AI app, add the MCP server `https://youbank-cf.<you>.workers.dev/mcp` with the
   header `Authorization: Bearer <a YouBank API key>` (Settings → Connect AI apps). Claude.ai's one-click
   connector keeps using `https://youbank.dev/api/mcp`, which has YouBank's OAuth sign-in.

## How each part works, and what happens when it fails

- **Thesis Agent.** Approving or resuming a thesis wakes its agent (`POST /thesis/{id}/wake`); pausing or stopping
  it stops the agent. On each alarm the agent calls `POST /api/cf/thesis/tick` and schedules itself: at once for
  the next slice of a long tick, at the thesis's next check-in when done, or never once the thesis is no longer
  running. Failures back off 2, 4, 8 minutes up to an hour. YouBank's hourly job still runs any thesis more than
  two hours overdue (a safety net), and a lease on each thesis means two runners never tick the same one at once.
- **Ledger.** YouBank holds its per-person lock and sends the stored head with each append. The Durable Object
  follows YouBank's head when it is behind or differs, starts afresh when YouBank holds nothing for the person
  (deleted entries never come back), and hands back entries whose insert was lost, which are written first.
  Anything that does not verify is refused, and the entry is placed by YouBank as before. When accounts can be
  deleted, call `purgeLedgerCopy(userId)` to forget the person's copy on Cloudflare too.
- **Workflow.** Vercel's evening cron (`/api/cron/book`) starts an instance. Each step calls
  `POST /api/cf/book` and is retried on its own (3 times, exponential backoff); a 4xx is not retried; a book that
  keeps failing is counted and skipped. Up to 1,000 books per night, least recently checked first. If the Worker
  does not answer, the cron runs the check inline as before.
- **Hosted MCP.** Each session connects to YouBank's `/api/mcp` with the person's key, so every tool is the same
  code with the same permissions. A tool YouBank marks as writing (`propose_position`) is shown to the person
  first through MCP elicitation when their app supports it; a "no" sends nothing. Proposals still wait in Needs
  you. The session logs each call's tool, outcome and time (never the arguments). It uses the Agents SDK's
  `McpAgent`, which is feature-frozen upstream but is still the recommended choice for sessionful servers: the
  gate waits on the person mid-call and the log lives with the session.

## Checks

- `cd cloudflare && npm test`: the Worker's logic (agent scheduling, ledger reconciliation, the MCP gate, the shared secret).
- `cd cloudflare && npx tsc --noEmit -p .` and `npx wrangler deploy --dry-run --outdir dist`: types and the bundle.
- End to end against a local Worker and a local YouBank:
  ```sh
  cd cloudflare && printf 'APP_SECRET=<secret>\nAPP_URL=http://localhost:3000\n' > .dev.vars && npx wrangler dev --port 8787
  CF_WORKER_URL=http://localhost:8787 CF_WORKER_SECRET=<secret> pnpm dev
  CF_WORKER_URL=http://localhost:8787 CF_WORKER_SECRET=<secret> DATABASE_URL=… pnpm exec tsx scripts/e2e-cloudflare.ts <userId>
  cd cloudflare && npx tsx test/mcp-local.ts <YouBank API key>
  ```
- `pnpm exec tsx scripts/test-prod.ts` covers the gateway, the Worker settings and the R2 picture and filing rules.
