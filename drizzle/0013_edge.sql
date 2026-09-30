-- Edge: the alternative-data tab. The first piece: physical assets (from public maps, and later a
-- person's uploads and drawings), what people watch, what Edge detects, and where every datum came
-- from. Canvases, documents, the graph and scenarios arrive in later migrations.
--
-- Two extensions: PostGIS for geometry (overlaps, distances, lengths of pipelines) and pgvector for the
-- document embeddings that come next. New tables only; nothing existing changes.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0013_edge.sql

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE EXTENSION IF NOT EXISTS vector;

-- Pipelines, plants, sites: public maps are shared (owner_id null); uploaded or drawn ones are private.
CREATE TABLE IF NOT EXISTS "edge_assets" (
  "id"            serial PRIMARY KEY,
  "source"        text NOT NULL,
  "source_id"     text NOT NULL,
  "kind"          text NOT NULL,
  "name"          text NOT NULL DEFAULT '',
  "operator"      text NOT NULL DEFAULT '',
  "company"       text NOT NULL DEFAULT '',
  "ticker"        text NOT NULL DEFAULT '',
  "status"        text NOT NULL DEFAULT '',
  "attrs"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "geom"          geometry(Geometry, 4326) NOT NULL,
  "owner_id"      text,
  "team_id"       integer,
  "retrieved_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "checked_at"    timestamp with time zone,
  CONSTRAINT "edge_assets_source_uq" UNIQUE ("source", "source_id")
);

CREATE INDEX IF NOT EXISTS "edge_assets_geom_idx" ON "edge_assets" USING gist ("geom");

CREATE INDEX IF NOT EXISTS "edge_assets_ticker_idx" ON "edge_assets" ("ticker");

CREATE INDEX IF NOT EXISTS "edge_assets_owner_idx" ON "edge_assets" ("owner_id");

-- What a person (or their team) follows: a company, a place, a person, a theme.
CREATE TABLE IF NOT EXISTS "edge_watches" (
  "id"               serial PRIMARY KEY,
  "user_id"          text NOT NULL,
  "team_id"          integer,
  "kind"             text NOT NULL,
  "label"            text NOT NULL,
  "target"           jsonb NOT NULL,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "last_checked_at"  timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "edge_watches_user_idx" ON "edge_watches" ("user_id");

CREATE INDEX IF NOT EXISTS "edge_watches_team_idx" ON "edge_watches" ("team_id");

-- What Edge found: one card in the feed. Findings from public data are shared by everyone watching
-- them (owner_id null); findings from a person's own data are theirs.
CREATE TABLE IF NOT EXISTS "edge_detections" (
  "id"           serial PRIMARY KEY,
  "key"          text NOT NULL,
  "kind"         text NOT NULL,
  "module"       text NOT NULL,
  "title"        text NOT NULL,
  "summary"      text NOT NULL DEFAULT '',
  "why"          text NOT NULL DEFAULT '',
  "confidence"   real NOT NULL DEFAULT 0.5,
  "magnitude"    real NOT NULL DEFAULT 0,
  "tickers"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "asset_ids"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "bbox"         jsonb,
  "visual"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "owner_id"     text,
  "observed_at"  timestamp with time zone,
  "detected_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_detections_key_uq" UNIQUE ("key")
);

CREATE INDEX IF NOT EXISTS "edge_detections_detected_idx" ON "edge_detections" ("detected_at");

CREATE INDEX IF NOT EXISTS "edge_detections_tickers_idx" ON "edge_detections" USING gin ("tickers");

-- The audit trail: every datum's source, license, retrieval time and method (with model version).
CREATE TABLE IF NOT EXISTS "edge_provenance" (
  "id"             bigserial PRIMARY KEY,
  "subject"        text NOT NULL,
  "source_name"    text NOT NULL,
  "source_url"     text NOT NULL DEFAULT '',
  "license"        text NOT NULL DEFAULT '',
  "method"         text NOT NULL DEFAULT '',
  "model_version"  text NOT NULL DEFAULT '',
  "retrieved_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "edge_provenance_subject_idx" ON "edge_provenance" ("subject");
