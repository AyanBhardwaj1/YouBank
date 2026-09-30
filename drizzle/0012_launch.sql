-- Launch readiness: three indexes the busiest queries were missing. Nothing else changes.
--
-- kv_cache_expires_idx          the cache's cleanup of expired rows (it scanned the whole table)
-- ai_usage_created_idx          today's spend for everyone, checked before model calls, and the
--                               Newsroom's monthly budget (the per-person index already exists)
-- crm_drafts_campaign_sent_idx  the platform-wide "contacted in the last 30 days" check on campaign
--                               first touches (it scanned every user's drafts)
--
-- By hand, each index is built CONCURRENTLY, so reads and writes never wait on it. That also means
-- each statement must run on its own, outside a transaction (apply-sql.mts sends them one at a time).
-- Neon's migration flow runs in a transaction, so there the same statements go without CONCURRENTLY:
-- at today's sizes (under 100 kB of index each, checked on a copy of production) the build is instant.
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0012_launch.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS "kv_cache_expires_idx" ON "kv_cache" ("expires_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_usage_created_idx" ON "ai_usage" ("created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "crm_drafts_campaign_sent_idx" ON "crm_drafts" ("sent_at") WHERE "kind" = 'campaign' AND "status" = 'sent';
