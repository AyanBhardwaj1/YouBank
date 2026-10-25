-- Data-source telemetry (docs/data-layer.md): per-minute rollups of every upstream call the data layer
-- makes (FMP, Nasdaq, SEC EDGAR, Treasury, FRED, BLS, the ECB, CoinGecko, DefiLlama, AI research), so an
-- operator can read p50/p95 latency, error rate, failure kinds and fallback use per source on
-- /api/market/health. Instances add their calls in batches (one INSERT ... ON CONFLICT DO UPDATE per flush,
-- at most every ten seconds per instance), never a row per call.
--
-- One new table and an index. Safe to run twice. New databases get it from the replay of drizzle/*.sql;
-- an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0028_source_stats.sql
-- Rows older than 30 days can be deleted at will (the health page reads the last hour).
CREATE TABLE IF NOT EXISTS "source_stats" (
  "minute"      timestamp with time zone NOT NULL,
  "source"      text NOT NULL,
  "op"          text NOT NULL,
  "calls"       integer NOT NULL DEFAULT 0,
  "failures"    integer NOT NULL DEFAULT 0,
  "fallbacks"   integer NOT NULL DEFAULT 0,
  "hedges"      integer NOT NULL DEFAULT 0,
  "sum_ms"      bigint NOT NULL DEFAULT 0,
  "max_ms"      integer NOT NULL DEFAULT 0,
  -- Latency histogram: calls that took at most 100, 250, 500, 1000, 2500, 5000, 10000 ms, and longer.
  "b100"        integer NOT NULL DEFAULT 0,
  "b250"        integer NOT NULL DEFAULT 0,
  "b500"        integer NOT NULL DEFAULT 0,
  "b1000"       integer NOT NULL DEFAULT 0,
  "b2500"       integer NOT NULL DEFAULT 0,
  "b5000"       integer NOT NULL DEFAULT 0,
  "b10000"      integer NOT NULL DEFAULT 0,
  "b_inf"       integer NOT NULL DEFAULT 0,
  -- Failures by kind (src/lib/market/source-error.ts); "skipped" counts calls an open breaker refused.
  "k_timeout"   integer NOT NULL DEFAULT 0,
  "k_network"   integer NOT NULL DEFAULT 0,
  "k_http"      integer NOT NULL DEFAULT 0,
  "k_rate_limit" integer NOT NULL DEFAULT 0,
  "k_schema"    integer NOT NULL DEFAULT 0,
  "k_empty"     integer NOT NULL DEFAULT 0,
  "k_skipped"   integer NOT NULL DEFAULT 0,
  CONSTRAINT "source_stats_minute_source_op_pk" PRIMARY KEY ("minute", "source", "op")
);
CREATE INDEX IF NOT EXISTS "source_stats_minute_idx" ON "source_stats" ("minute");
