-- Edge, milestones 2 to 6: the canvas and its runs, documents and their passages, the relationship
-- graph and its models, scenarios, stories, alerts and pushes into Studio, plus the ledgers that keep
-- Edge inside the free tiers of Cloudflare R2, Inngest and Modal. New tables only; nothing existing
-- changes. PostGIS and pgvector arrived in 0013.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0014_edge_platform.sql

-- Files in Cloudflare R2 (uploads arrive in 4 MB parts), for quotas, parsing and deletion.
CREATE TABLE IF NOT EXISTS "edge_files" (
  "id"          serial PRIMARY KEY,
  "owner_id"    text,
  "team_id"     integer,
  "kind"        text NOT NULL,
  "name"        text NOT NULL DEFAULT '',
  "mime"        text NOT NULL DEFAULT '',
  "bytes"       bigint NOT NULL DEFAULT 0,
  "r2_key"      text NOT NULL,
  "parts"       integer NOT NULL DEFAULT 0,
  "status"      text NOT NULL DEFAULT 'uploading',
  "meta"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_files_key_uq" UNIQUE ("r2_key")
);

CREATE INDEX IF NOT EXISTS "edge_files_owner_idx" ON "edge_files" ("owner_id", "kind");

-- Monthly use of the free tiers: Modal dollars, Inngest executions, R2 bytes and operations.
CREATE TABLE IF NOT EXISTS "edge_usage" (
  "month"       text NOT NULL,
  "service"     text NOT NULL,
  "metric"      text NOT NULL,
  "value"       double precision NOT NULL DEFAULT 0,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("month", "service", "metric")
);

-- Canvases: module nodes and the wires between them. A branch points at the canvas it forked from.
CREATE TABLE IF NOT EXISTS "edge_canvases" (
  "id"           serial PRIMARY KEY,
  "owner_id"     text NOT NULL,
  "team_id"      integer,
  "title"        text NOT NULL,
  "description"  text NOT NULL DEFAULT '',
  "graph"        jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  "template"     text NOT NULL DEFAULT '',
  "parent_id"    integer,
  "branch"       text NOT NULL DEFAULT '',
  "version"      integer NOT NULL DEFAULT 0,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at"   timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "edge_canvases_owner_idx" ON "edge_canvases" ("owner_id", "updated_at");

CREATE INDEX IF NOT EXISTS "edge_canvases_team_idx" ON "edge_canvases" ("team_id");

-- Every change to a canvas (for co-editing and undo) and its named checkpoints.
CREATE TABLE IF NOT EXISTS "edge_canvas_events" (
  "id"          bigserial PRIMARY KEY,
  "canvas_id"   integer NOT NULL,
  "user_id"     text NOT NULL,
  "kind"        text NOT NULL,
  "version"     integer NOT NULL DEFAULT 0,
  "label"       text NOT NULL DEFAULT '',
  "payload"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "edge_canvas_events_canvas_idx" ON "edge_canvas_events" ("canvas_id", "id");

-- Runs of a canvas: the graph as it ran, what each node produced, and what it cost.
CREATE TABLE IF NOT EXISTS "edge_runs" (
  "id"           serial PRIMARY KEY,
  "canvas_id"    integer NOT NULL,
  "owner_id"     text NOT NULL,
  "trigger"      text NOT NULL DEFAULT 'manual',
  "status"       text NOT NULL DEFAULT 'queued',
  "graph"        jsonb NOT NULL,
  "outputs"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cost"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error"        text NOT NULL DEFAULT '',
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "started_at"   timestamp with time zone,
  "finished_at"  timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "edge_runs_canvas_idx" ON "edge_runs" ("canvas_id", "created_at");

CREATE INDEX IF NOT EXISTS "edge_runs_owner_idx" ON "edge_runs" ("owner_id", "created_at");

CREATE TABLE IF NOT EXISTS "edge_run_steps" (
  "id"            bigserial PRIMARY KEY,
  "run_id"        integer NOT NULL,
  "node_id"       text NOT NULL,
  "step"          text NOT NULL DEFAULT '',
  "status"        text NOT NULL DEFAULT 'queued',
  "summary"       text NOT NULL DEFAULT '',
  "preview"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output"        jsonb,
  "artifact_key"  text NOT NULL DEFAULT '',
  "cost"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error"         text NOT NULL DEFAULT '',
  "started_at"    timestamp with time zone,
  "finished_at"   timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "edge_run_steps_run_idx" ON "edge_run_steps" ("run_id", "id");

-- Deployed canvases: re-run on a schedule and alert when their signal changes.
CREATE TABLE IF NOT EXISTS "edge_monitors" (
  "id"           serial PRIMARY KEY,
  "canvas_id"    integer NOT NULL,
  "owner_id"     text NOT NULL,
  "schedule"     text NOT NULL DEFAULT 'daily',
  "alert"        text NOT NULL DEFAULT 'digest',
  "active"       boolean NOT NULL DEFAULT true,
  "next_run_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "last_run_id"  integer,
  "last_signal"  jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_monitors_canvas_uq" UNIQUE ("canvas_id")
);

CREATE INDEX IF NOT EXISTS "edge_monitors_due_idx" ON "edge_monitors" ("active", "next_run_at");

-- Published stories: a run as a scrolling visual report.
CREATE TABLE IF NOT EXISTS "edge_stories" (
  "id"          serial PRIMARY KEY,
  "owner_id"    text NOT NULL,
  "team_id"     integer,
  "run_id"      integer,
  "title"       text NOT NULL,
  "slug"        text NOT NULL,
  "sections"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "visibility"  text NOT NULL DEFAULT 'private',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_stories_slug_uq" UNIQUE ("slug")
);

CREATE INDEX IF NOT EXISTS "edge_stories_owner_idx" ON "edge_stories" ("owner_id", "created_at");

-- Documents: filings, call transcripts, uploads, workspace items and pages. owner_id '' is the shared
-- public corpus (filings), anything else is private to that person (and their team when team_id is set).
CREATE TABLE IF NOT EXISTS "edge_docs" (
  "id"            serial PRIMARY KEY,
  "owner_id"      text NOT NULL DEFAULT '',
  "team_id"       integer,
  "source"        text NOT NULL,
  "external_id"   text NOT NULL,
  "title"         text NOT NULL DEFAULT '',
  "url"           text NOT NULL DEFAULT '',
  "file_id"       integer,
  "mime"          text NOT NULL DEFAULT '',
  "lang"          text NOT NULL DEFAULT '',
  "pages"         integer NOT NULL DEFAULT 0,
  "duration_sec"  real NOT NULL DEFAULT 0,
  "meta"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"        text NOT NULL DEFAULT 'queued',
  "error"         text NOT NULL DEFAULT '',
  "chunks"        integer NOT NULL DEFAULT 0,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "indexed_at"    timestamp with time zone,
  CONSTRAINT "edge_docs_ext_uq" UNIQUE ("source", "external_id", "owner_id")
);

CREATE INDEX IF NOT EXISTS "edge_docs_owner_idx" ON "edge_docs" ("owner_id", "created_at");

CREATE INDEX IF NOT EXISTS "edge_docs_ticker_idx" ON "edge_docs" (("meta"->>'ticker'));

-- Passages with their embeddings (half precision, 512 dimensions) and full-text vectors, for hybrid search.
CREATE TABLE IF NOT EXISTS "edge_chunks" (
  "id"         bigserial PRIMARY KEY,
  "doc_id"     integer NOT NULL,
  "ord"        integer NOT NULL,
  "page"       integer NOT NULL DEFAULT 0,
  "t_start"    real,
  "t_end"      real,
  "speaker"    text NOT NULL DEFAULT '',
  "section"    text NOT NULL DEFAULT '',
  "text"       text NOT NULL,
  "embedding"  halfvec(512),
  "tsv"        tsvector,
  CONSTRAINT "edge_chunks_doc_ord_uq" UNIQUE ("doc_id", "ord")
);

CREATE INDEX IF NOT EXISTS "edge_chunks_embedding_idx" ON "edge_chunks" USING hnsw ("embedding" halfvec_cosine_ops);

CREATE INDEX IF NOT EXISTS "edge_chunks_tsv_idx" ON "edge_chunks" USING gin ("tsv");

-- Questions asked of documents, with the cited answer and its evidence board.
CREATE TABLE IF NOT EXISTS "edge_answers" (
  "id"          serial PRIMARY KEY,
  "owner_id"    text NOT NULL,
  "question"    text NOT NULL,
  "mode"        text NOT NULL DEFAULT 'strict',
  "scope"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "answer"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cost"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "edge_answers_owner_idx" ON "edge_answers" ("owner_id", "created_at");

-- The relationship graph: companies, people, funds, subsidiaries and firms, and the public links between them.
CREATE TABLE IF NOT EXISTS "edge_nodes" (
  "id"          serial PRIMARY KEY,
  "kind"        text NOT NULL,
  "name"        text NOT NULL,
  "norm"        text NOT NULL,
  "ticker"      text NOT NULL DEFAULT '',
  "cik"         text NOT NULL DEFAULT '',
  "attrs"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "edge_nodes_kind_cik_uq" ON "edge_nodes" ("kind", "cik") WHERE "cik" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "edge_nodes_kind_norm_uq" ON "edge_nodes" ("kind", "norm") WHERE "cik" = '';

CREATE INDEX IF NOT EXISTS "edge_nodes_norm_idx" ON "edge_nodes" ("norm");

CREATE INDEX IF NOT EXISTS "edge_nodes_ticker_idx" ON "edge_nodes" ("ticker") WHERE "ticker" <> '';

CREATE TABLE IF NOT EXISTS "edge_links" (
  "id"           bigserial PRIMARY KEY,
  "src"          integer NOT NULL,
  "dst"          integer NOT NULL,
  "kind"         text NOT NULL,
  "weight"       real NOT NULL DEFAULT 1,
  "attrs"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source_name"  text NOT NULL DEFAULT '',
  "source_url"   text NOT NULL DEFAULT '',
  "as_of"        date,
  "ended"        date,
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_links_uq" UNIQUE ("src", "dst", "kind")
);

CREATE INDEX IF NOT EXISTS "edge_links_src_idx" ON "edge_links" ("src", "kind");

CREATE INDEX IF NOT EXISTS "edge_links_dst_idx" ON "edge_links" ("dst", "kind");

-- Trained graph models with their backtest scorecards, and their ranked predictions with reason paths.
CREATE TABLE IF NOT EXISTS "edge_models" (
  "id"            serial PRIMARY KEY,
  "kind"          text NOT NULL,
  "version"       text NOT NULL,
  "status"        text NOT NULL DEFAULT 'training',
  "metrics"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "artifact_key"  text NOT NULL DEFAULT '',
  "trained_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "edge_predictions" (
  "id"         bigserial PRIMARY KEY,
  "model_id"   integer NOT NULL,
  "kind"       text NOT NULL,
  "subject"    integer NOT NULL,
  "candidate"  integer NOT NULL,
  "score"      real NOT NULL,
  "rank"       integer NOT NULL,
  "reasons"    jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS "edge_predictions_subject_idx" ON "edge_predictions" ("subject", "kind", "model_id");

-- Scenarios and synthetic data: the recipe (driver, method, seed), the preview and the refined run.
CREATE TABLE IF NOT EXISTS "edge_scenarios" (
  "id"          serial PRIMARY KEY,
  "owner_id"    text NOT NULL,
  "team_id"     integer,
  "title"       text NOT NULL,
  "kind"        text NOT NULL,
  "driver"      text NOT NULL DEFAULT 'none',
  "spec"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"      text NOT NULL DEFAULT 'draft',
  "preview"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result_key"  text NOT NULL DEFAULT '',
  "realism"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "edge_scenarios_owner_idx" ON "edge_scenarios" ("owner_id", "updated_at");

-- Alerts Edge has sent (straight away or in the daily digest), so nothing goes out twice.
CREATE TABLE IF NOT EXISTS "edge_alerts" (
  "id"          bigserial PRIMARY KEY,
  "user_id"     text NOT NULL,
  "subject"     text NOT NULL,
  "kind"        text NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "edge_alerts_uq" UNIQUE ("user_id", "subject", "kind")
);

-- Maps, networks, scenario sheets and memos pushed into Studio or the Office add-in, reviewed there.
CREATE TABLE IF NOT EXISTS "edge_pushes" (
  "id"          serial PRIMARY KEY,
  "owner_id"    text NOT NULL,
  "target"      text NOT NULL,
  "source"      text NOT NULL,
  "kind"        text NOT NULL,
  "payload"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "status"      text NOT NULL DEFAULT 'pending',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  "decided_at"  timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "edge_pushes_target_idx" ON "edge_pushes" ("target", "status");
