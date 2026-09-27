-- YouBank for Excel and PowerPoint (the Office add-in), and Studio checkpoints.
--
-- Three new tables. No existing table is altered.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0008_office.sql

CREATE TABLE IF NOT EXISTS "office_pairings" (
  "id"          serial PRIMARY KEY NOT NULL,
  "code"        text NOT NULL,
  "poll_hash"   text NOT NULL,
  "host"        text DEFAULT '' NOT NULL,
  "user_id"     text,
  "token"       text,
  "approved_at" timestamp with time zone,
  "expires_at"  timestamp with time zone NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "office_pairings_code_uidx" ON "office_pairings" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "office_pairings_poll_uidx" ON "office_pairings" ("poll_hash");

CREATE TABLE IF NOT EXISTS "office_devices" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "token_hash"   text NOT NULL,
  "name"         text DEFAULT '' NOT NULL,
  "host"         text DEFAULT '' NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at"   timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "office_devices_token_uidx" ON "office_devices" ("token_hash");
CREATE INDEX IF NOT EXISTS "office_devices_user_idx" ON "office_devices" ("user_id");

CREATE TABLE IF NOT EXISTS "studio_checkpoints" (
  "id"              serial PRIMARY KEY NOT NULL,
  "doc_id"          integer NOT NULL,
  "name"            text NOT NULL,
  "created_by"      text NOT NULL,
  "created_by_name" text DEFAULT '' NOT NULL,
  "workbook"        jsonb NOT NULL,
  "deck"            jsonb NOT NULL,
  "event_id"        integer DEFAULT 0 NOT NULL,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "studio_checkpoints_doc_id_studio_docs_id_fk" FOREIGN KEY ("doc_id") REFERENCES "studio_docs"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "studio_checkpoints_doc_idx" ON "studio_checkpoints" ("doc_id","created_at");
