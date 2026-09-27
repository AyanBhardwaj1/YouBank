-- Studio: live models and decks edited by people and the agent.
--
-- Three new tables. No existing table is altered.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0007_studio.sql

CREATE TABLE IF NOT EXISTS "studio_docs" (
  "id"         serial PRIMARY KEY NOT NULL,
  "owner_id"   text NOT NULL,
  "team_id"    integer,
  "title"      text DEFAULT 'Untitled model' NOT NULL,
  "kind"       text DEFAULT 'blank' NOT NULL,
  "ticker"     text DEFAULT '' NOT NULL,
  "workbook"   jsonb NOT NULL,
  "deck"       jsonb NOT NULL,
  "comments"   jsonb DEFAULT '[]'::jsonb NOT NULL,
  "intake"     jsonb,
  "version"    integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "studio_docs_owner_idx" ON "studio_docs" ("owner_id","updated_at");
CREATE INDEX IF NOT EXISTS "studio_docs_team_idx"  ON "studio_docs" ("team_id");

CREATE TABLE IF NOT EXISTS "studio_events" (
  "id"         serial PRIMARY KEY NOT NULL,
  "doc_id"     integer NOT NULL,
  "actor"      text NOT NULL,
  "actor_name" text DEFAULT '' NOT NULL,
  "run_id"     text DEFAULT '' NOT NULL,
  "label"      text DEFAULT '' NOT NULL,
  "patches"    jsonb NOT NULL,
  "undo"       jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_events_doc_id_studio_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "studio_docs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "studio_events_doc_idx" ON "studio_events" ("doc_id","id");

CREATE TABLE IF NOT EXISTS "studio_runs" (
  "id"          text PRIMARY KEY NOT NULL,
  "doc_id"      integer NOT NULL,
  "user_id"     text NOT NULL,
  "instruction" text NOT NULL,
  "status"      text DEFAULT 'running' NOT NULL,
  "summary"     text DEFAULT '' NOT NULL,
  "model"       text DEFAULT '' NOT NULL,
  "stats"       jsonb DEFAULT '{}'::jsonb NOT NULL,
  "started_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "finished_at" timestamp with time zone,
  CONSTRAINT "studio_runs_doc_id_studio_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "studio_docs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "studio_runs_doc_idx" ON "studio_runs" ("doc_id","started_at");
