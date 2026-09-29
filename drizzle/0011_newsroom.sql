-- The Newsroom: stories gathered from public feeds, filings and government sources, clustered into
-- one card per event, summarized, and ranked for each person's desk; the morning brief; the deal
-- tracker built from announcements; alerts and where they were delivered; browser push devices.
--
-- Eight new tables. No existing table is altered.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0011_newsroom.sql

-- Polite polling: one row per feed or query, with the validators for conditional requests.
CREATE TABLE IF NOT EXISTS "news_feeds" (
  "url"             text PRIMARY KEY NOT NULL,
  "kind"            text NOT NULL,
  "etag"            text DEFAULT '' NOT NULL,
  "last_modified"   text DEFAULT '' NOT NULL,
  "last_fetched_at" timestamp with time zone,
  "next_fetch_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "fail_count"      integer DEFAULT 0 NOT NULL,
  "last_error"      text DEFAULT '' NOT NULL,
  "items_seen"      integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS "news_feeds_next_idx" ON "news_feeds" ("next_fetch_at");

-- Every article, filing, release, paper, model or launch seen. Pruned after 30 days.
CREATE TABLE IF NOT EXISTS "news_items" (
  "id"           serial PRIMARY KEY NOT NULL,
  "key"          text NOT NULL,
  "url"          text NOT NULL,
  "title"        text NOT NULL,
  "snippet"      text DEFAULT '' NOT NULL,
  "source"       text NOT NULL,
  "domain"       text DEFAULT '' NOT NULL,
  "kind"         text NOT NULL,
  "published_at" timestamp with time zone NOT NULL,
  "fetched_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "desks"        jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tickers"      jsonb DEFAULT '[]'::jsonb NOT NULL,
  "meta"         jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cluster_id"   integer,
  "embedding"    text
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_items_key_uidx" ON "news_items" ("key");
CREATE INDEX IF NOT EXISTS "news_items_published_idx" ON "news_items" ("published_at");
CREATE INDEX IF NOT EXISTS "news_items_cluster_idx" ON "news_items" ("cluster_id");
CREATE INDEX IF NOT EXISTS "news_items_unclustered_idx" ON "news_items" ("fetched_at") WHERE "cluster_id" IS NULL;

-- A story: one or more items about the same event, with its summary and who it matters to.
CREATE TABLE IF NOT EXISTS "news_clusters" (
  "id"            serial PRIMARY KEY NOT NULL,
  "headline"      text NOT NULL,
  "category"      text DEFAULT 'general' NOT NULL,
  "importance"    double precision DEFAULT 0 NOT NULL,
  "desks"         jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tickers"       jsonb DEFAULT '[]'::jsonb NOT NULL,
  "entities"      jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary"       jsonb,
  "source_count"  integer DEFAULT 1 NOT NULL,
  "kinds"         jsonb DEFAULT '[]'::jsonb NOT NULL,
  "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "enriched_at"   timestamp with time zone,
  "centroid"      text
);
CREATE INDEX IF NOT EXISTS "news_clusters_first_seen_idx" ON "news_clusters" ("first_seen_at");
CREATE INDEX IF NOT EXISTS "news_clusters_updated_idx" ON "news_clusters" ("updated_at");

-- Announced deals and raises, parsed from stories and filings: YouBank's own deal database.
CREATE TABLE IF NOT EXISTS "news_deals" (
  "id"               serial PRIMARY KEY NOT NULL,
  "cluster_id"       integer NOT NULL,
  "kind"             text NOT NULL,
  "acquirer"         text DEFAULT '' NOT NULL,
  "acquirer_ticker"  text DEFAULT '' NOT NULL,
  "target"           text DEFAULT '' NOT NULL,
  "target_ticker"    text DEFAULT '' NOT NULL,
  "value_usd"        double precision,
  "per_share"        double precision,
  "consideration"    text DEFAULT '' NOT NULL,
  "premium"          double precision,
  "unaffected_price" double precision,
  "ev_ebitda"        double precision,
  "ev_revenue"       double precision,
  "round"            text DEFAULT '' NOT NULL,
  "investors"        jsonb DEFAULT '[]'::jsonb NOT NULL,
  "advisors"         jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sector"           text DEFAULT '' NOT NULL,
  "status"           text DEFAULT 'announced' NOT NULL,
  "announced_at"     timestamp with time zone NOT NULL,
  "source_url"       text DEFAULT '' NOT NULL,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_deals_cluster_uidx" ON "news_deals" ("cluster_id");
CREATE INDEX IF NOT EXISTS "news_deals_announced_idx" ON "news_deals" ("announced_at");

-- The morning brief per desk per day, research briefs per desk per slot, the weekly tech radar.
CREATE TABLE IF NOT EXISTS "news_briefs" (
  "id"         serial PRIMARY KEY NOT NULL,
  "desk"       text NOT NULL,
  "kind"       text NOT NULL,
  "slot"       text NOT NULL,
  "content"    jsonb NOT NULL,
  "model"      text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_briefs_desk_kind_slot_uidx" ON "news_briefs" ("desk","kind","slot");

-- What each person did with a story, and the "why it matters to you" note written for them.
CREATE TABLE IF NOT EXISTS "news_user_items" (
  "user_id"    text NOT NULL,
  "cluster_id" integer NOT NULL,
  "read_at"    timestamp with time zone,
  "saved_at"   timestamp with time zone,
  "hidden_at"  timestamp with time zone,
  "why"        jsonb,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id","cluster_id")
);
CREATE INDEX IF NOT EXISTS "news_user_items_saved_idx" ON "news_user_items" ("user_id","saved_at");

-- Alerts and briefs for the bell, with where each was delivered (email, push, Slack).
CREATE TABLE IF NOT EXISTS "news_notifications" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "key"        text NOT NULL,
  "kind"       text NOT NULL,
  "title"      text NOT NULL,
  "body"       text DEFAULT '' NOT NULL,
  "url"        text DEFAULT '' NOT NULL,
  "cluster_id" integer,
  "urgent"     boolean DEFAULT false NOT NULL,
  "delivered"  jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "read_at"    timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_notifications_user_key_uidx" ON "news_notifications" ("user_id","key");
CREATE INDEX IF NOT EXISTS "news_notifications_user_idx" ON "news_notifications" ("user_id","created_at");

-- Browser push subscriptions, one per device.
CREATE TABLE IF NOT EXISTS "news_push_subs" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "endpoint"   text NOT NULL,
  "keys"       jsonb NOT NULL,
  "user_agent" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_ok_at" timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "news_push_subs_endpoint_uidx" ON "news_push_subs" ("endpoint");
CREATE INDEX IF NOT EXISTS "news_push_subs_user_idx" ON "news_push_subs" ("user_id");
