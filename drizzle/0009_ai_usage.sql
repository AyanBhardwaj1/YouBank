-- The AI usage ledger: one row per model call (or per agent run), with tokens and list-price cost,
-- so cost per feature and the prompt-cache hit rate can be seen and managed.
--
-- One new table. No existing table is altered.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0009_ai_usage.sql

CREATE TABLE IF NOT EXISTS "ai_usage" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "user_id"            text,
  "feature"            text NOT NULL,
  "provider"           text NOT NULL,
  "model"              text NOT NULL,
  "effort"             text DEFAULT '' NOT NULL,
  "input_tokens"       integer DEFAULT 0 NOT NULL,
  "cached_tokens"      integer DEFAULT 0 NOT NULL,
  "cache_write_tokens" integer DEFAULT 0 NOT NULL,
  "output_tokens"      integer DEFAULT 0 NOT NULL,
  "reasoning_tokens"   integer DEFAULT 0 NOT NULL,
  "cost_usd"           double precision DEFAULT 0 NOT NULL,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "ai_usage_user_idx" ON "ai_usage" ("user_id","created_at");
