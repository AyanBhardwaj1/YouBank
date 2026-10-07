-- The desktop app: device pairing, connected devices (with their scheduled-task switches) and the
-- local files each one indexed into Edge documents.
--
-- Three new tables. No existing table is altered.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0017_desktop.sql

CREATE TABLE IF NOT EXISTS "desktop_pairings" (
  "id"          serial PRIMARY KEY NOT NULL,
  "code"        text NOT NULL,
  "poll_hash"   text NOT NULL,
  "platform"    text DEFAULT '' NOT NULL,
  "name"        text DEFAULT '' NOT NULL,
  "user_id"     text,
  "token"       text,
  "approved_at" timestamp with time zone,
  "expires_at"  timestamp with time zone NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_pairings_code_uidx" ON "desktop_pairings" ("code");
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_pairings_poll_uidx" ON "desktop_pairings" ("poll_hash");

CREATE TABLE IF NOT EXISTS "desktop_devices" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "token_hash"   text NOT NULL,
  "name"         text DEFAULT '' NOT NULL,
  "platform"     text DEFAULT '' NOT NULL,
  "app_version"  text DEFAULT '' NOT NULL,
  "settings"     jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "last_used_at" timestamp with time zone,
  "revoked_at"   timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_devices_token_uidx" ON "desktop_devices" ("token_hash");
CREATE INDEX IF NOT EXISTS "desktop_devices_user_idx" ON "desktop_devices" ("user_id");

CREATE TABLE IF NOT EXISTS "desktop_files" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "device_id"  integer NOT NULL,
  "path_key"   text NOT NULL,
  "name"       text DEFAULT '' NOT NULL,
  "sha256"     text NOT NULL,
  "bytes"      bigint DEFAULT 0 NOT NULL,
  "doc_id"     integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "desktop_files_path_uidx" ON "desktop_files" ("user_id","device_id","path_key");
CREATE INDEX IF NOT EXISTS "desktop_files_user_sha_idx" ON "desktop_files" ("user_id","sha256");
