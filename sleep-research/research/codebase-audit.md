# Codebase capability and gap map (read-only audit, 2026-10-31)

Source: Explore subagent audit of /home/user/YouBank. Paths relative to repo root.

## Key facts
- Pages in src/app/app/* are thin; logic lives in src/lib/<area> and src/components/<area>. Almost no TODO markers; debt is in docs.
- Largest modules: src/lib/edge (206 files / 28k LOC, 10 test scripts), src/lib/workflows (328 tools: 230 AI workflows + 98 calculators, 14k LOC, structure-only tests), quant 7.1k, studio 6.4k, crm 5.5k, market 5.4k, news 5.3k, algo 4.6k.
- Untested: src/lib/collab, src/lib/desktop, src/lib/demo. Thin tests: vc, teams, news (2 scripts / 5.3k LOC), market.

## AI layer
- Models (src/lib/ai/models.ts): OpenAI 17 models (default gpt-6-astra), Anthropic 4 (claude-opus-5 default, claude-fable-5-1 top). Routing small models for classify/extract/summarize (src/lib/ai/route.ts). Neon AI Gateway commented out (neon.ts).
- Chat sends all 39 tools every turn (src/lib/ai/agent.ts:12, :94): 14 core (src/lib/ai/tools.ts) + 7 inference + 11 crypto + 7 quant. No tool search / dynamic selection / defer_loading. Workflows use static whitelist (src/app/api/tools/run/route.ts:71).
- Retrieval only inside Edge: src/lib/edge/docs/retrieve.ts (LLM query planning, pgvector halfvec 512d text-embedding-3-small, Postgres FTS, RRF, optional cross-encoder rerank src/lib/edge/premium/rerank.ts, small-model filter). News clustering uses 256d embeddings. Main chat/terminal/workflows: no retrieval over user documents (email, Studio data rooms, meeting notes not indexed).
- Evals: Edge-only offline scripts (scripts/eval-docs.ts recall@k, eval-claims.ts AUROC/ECE, eval-precedents.ts, eval-calls.ts F1, eval-odds.ts out-of-time, eval-lbo.ts). No eval of chat/workflow answer quality; no golden set, no LLM-as-judge.
- Citations: chat tools add sources S1.. (agent.ts:68-79,219), prices carry as-of/stale flags. Nothing checks final chat text. Edge "Calibrated Claims" (src/lib/edge/claims/numbers.ts deterministic number check incl. derived arithmetic, features/combine calibrated combiner, conformal.ts strict mode, verify.ts cross-provider check) is used only in edge/docs/answer.ts, edge/agent/store.ts, edge/canvas/executors/outputs.ts — NOT chat, workflows, Studio, desktop.

## Data layer
- src/lib/market/registry.ts ordered adapter chains per dataset with licence/delay metadata (sources-meta.ts), breakers, budgets, provenance; BYO keys (Tiingo, Alpha Vantage, Finnhub, Twelve Data, FMP). EDGAR throttle <10 rps with 429 backoff. News: EDGAR, GDELT, gov, RSS.
- Cache: memory → disk(dev) → Neon kv_cache; single-flight, SWR, stale-if-error (src/lib/cache.ts).
- Point-in-time only in quant (pit/fundamentals.ts knownAt by filing date), algo, edge odds. Terminal/chat use latest. Copytrade backtest has known look-ahead/survivorship bias (src/lib/copytrade/backtest.ts:17). Not built: security master, cross-source reconciliation, nightly SEC bulk, intraday, FINRA short data (docs/data-layer.md:344).

## Infra
- 7 Vercel daily crons (cle1); 4 Neon Function heartbeat relays (autopilot 5 min, news 10, calendar/copytrade 15) because Hobby cron is daily-only. Inngest: 18 functions (15 edge, 1 algo, 2 quant).
- Realtime: SSE fed by polling append-only log (src/lib/realtime/feed.ts), 1-5 s, 120 s streams; Office add-in 4 s poll. Collab presence 40 s window.
- Observability: JSON log + Sentry only if SENTRY_DSN (not configured). No OpenTelemetry, no LLM tracing. AI usage ledger exists.
- Rate limit: DB-backed (src/lib/locks.ts), AI spend caps, 2 concurrent long runs. No edge/IP limiter.

## MCP / agent protocols
- None in code. Only roadmap (README.md:2103-2105) and a comment in src/lib/algo/brokers/robinhood.ts:4.

## Gaps
1. Verification stops at Edge (reuse claims/numbers.ts + verify.ts in chat, workflows, Studio).
2. No output-quality evals for the largest surface (328 tools).
3. No tool selection; 39 tools every turn.
4. No RAG over user documents outside Edge.
5. Untested collab/desktop/demo; thin news/market/vc/teams.
6. No point-in-time "as of" in terminal/comps.
7. Licensing unresolved (FMP display, FRED, hosted BYO keys, crypto) — docs/data-layer.md:327-342.
8. README roadmap: List-Unsubscribe compliance, MCP connector, M365 mailboxes, Gmail CASA, Office SSO/AppSource/push, >4 MB data room files (src/lib/desktop/office.ts:41), engine items.
9. docs/launch-readiness.md "Left" (296-312): plan upgrades, preview DB, paid FMP, email verification, Sentry; P2 items (pagination, migration journal, unauthenticated /api/ai/status, zod on bodies, error boundaries).
10. Autopilot and long synchronous runs hold functions; "a queue later" (docs/launch-readiness.md:78-80).
11. Eval data thin (Eva-4B off pending licence; LBO backtest waits for 10 deals).
