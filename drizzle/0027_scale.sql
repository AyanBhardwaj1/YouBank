-- Scale (docs/scale.md): indexes for the queries every signed-in page runs, a unique index that closes a
-- double-insert race, and the AI spend counters the limits read.
--
-- Indexes on tables that exist, one new table, and a de-duplication that removes only exact repeats (the
-- race the new unique index closes). Safe to run twice. New databases get it from the replay of
-- drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0027_scale.sql
-- As in 0012, each index is built CONCURRENTLY, so reads and writes never wait on it, and each statement
-- runs on its own, outside a transaction (apply-sql.mts sends them one at a time). In a migration flow that
-- wraps everything in a transaction, drop CONCURRENTLY: at hundreds of users each build takes seconds.

-- The bell's unread count on every page: an index of the unread rows only, so the count reads a handful
-- of index entries instead of every notification the person ever had.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "news_notifications_user_unread_idx" ON "news_notifications" ("user_id", "created_at") WHERE "read_at" IS NULL;

-- The Newsroom feed: stories the person hid (read on every feed load), and their recent reading, saving
-- and hiding (the affinity model's 60-day window).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "news_user_items_hidden_idx" ON "news_user_items" ("user_id") WHERE "hidden_at" IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS "news_user_items_user_updated_idx" ON "news_user_items" ("user_id", "updated_at");

-- The CRM pipeline (newest first, paged by a keyset cursor), contacts (most recently seen first) and the
-- "needs a reply" count in its header.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "crm_deals_user_updated_idx" ON "crm_deals" ("user_id", "updated_at" DESC, "id" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "crm_contacts_user_seen_idx" ON "crm_contacts" ("user_id", "last_seen_at" DESC, "id" DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS "crm_threads_user_needs_reply_idx" ON "crm_threads" ("user_id") WHERE "needs_reply";

-- The home page counts the person's peer groups; without this it read the whole table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "peer_groups_user_idx" ON "peer_groups" ("user_id");

-- An Edge finding about a pipeline deal is recorded once per deal: the existing unique index includes the
-- contact, which a deal's signal does not have, so two passes at once could both insert. Remove repeats
-- (keeping the first), then let the database refuse them.
DELETE FROM "crm_signals" a USING "crm_signals" b
WHERE a."contact_id" IS NULL AND b."contact_id" IS NULL AND a."deal_id" IS NOT NULL
  AND a."user_id" = b."user_id" AND a."deal_id" = b."deal_id" AND a."source_key" = b."source_key" AND a."id" > b."id";
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "crm_signals_user_deal_source_uidx" ON "crm_signals" ("user_id", "deal_id", "source_key") WHERE "contact_id" IS NULL AND "deal_id" IS NOT NULL;

-- AI spend per UTC day, for one person (`scope` = their id) and for everyone (`scope` = '*'), added to
-- atomically as each model call is recorded (INSERT ... ON CONFLICT DO UPDATE ... RETURNING), so every
-- instance sees a call's cost at once and the daily caps read one row instead of summing the ledger.
-- The ledger (ai_usage) stays the record; these are running totals beside it (src/lib/ai/spend.ts).
CREATE TABLE IF NOT EXISTS "ai_spend" (
  "scope"       text NOT NULL,
  "day"         date NOT NULL,
  "usd"         double precision NOT NULL DEFAULT 0,
  "calls"       integer NOT NULL DEFAULT 0,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "ai_spend_scope_day_pk" PRIMARY KEY ("scope", "day")
);
CREATE INDEX IF NOT EXISTS "ai_spend_day_idx" ON "ai_spend" ("day");
