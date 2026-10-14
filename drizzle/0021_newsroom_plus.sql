-- Newsroom plus: following a developing story, and personal audio briefings.
--
-- Two new tables. No existing table is altered. What a person reads, saves and hides (the signals the
-- personal front page learns from) is already in news_user_items, so the ranking needs no new table.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0021_newsroom_plus.sql

-- A story someone follows. The pipeline compares the story's source count and last update with what
-- was last sent, so each development alerts once. Removed with the story, or after 30 quiet days.
CREATE TABLE IF NOT EXISTS "news_follows" (
  "user_id"         text NOT NULL,
  "cluster_id"      integer NOT NULL,
  "seen_sources"    integer DEFAULT 1 NOT NULL,
  "seen_at"         timestamp with time zone DEFAULT now() NOT NULL,
  "notified_at"     timestamp with time zone,
  "updates"         integer DEFAULT 0 NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "cluster_id")
);
CREATE INDEX IF NOT EXISTS "news_follows_cluster_idx" ON "news_follows" ("cluster_id");

-- A personal audio briefing: the chapters (one per story, with the script each reads) and, when a
-- neural voice read it, where each chapter's audio is stored (object storage keys, never the audio
-- itself). One per person per day and kind ("ai" on request, "daily" by the morning switch).
CREATE TABLE IF NOT EXISTS "news_briefings" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "slot"        text NOT NULL,
  "kind"        text NOT NULL,
  "desk"        text DEFAULT '' NOT NULL,
  "chapters"    jsonb DEFAULT '[]'::jsonb NOT NULL,
  "audio"       jsonb,
  "voice"       text DEFAULT '' NOT NULL,
  "model"       text DEFAULT '' NOT NULL,
  "cost_usd"    double precision DEFAULT 0 NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_briefings_user_slot_kind_uidx" ON "news_briefings" ("user_id", "slot", "kind");
