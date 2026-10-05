-- The meeting copilot: meetings captured by the desktop app or a notetaker bot, their transcripts (one
-- row per audio chunk, so a chunk sent twice replaces itself), which contacts and deals each meeting is
-- linked to, and each person's copilot settings. Proposed CRM changes from a meeting are ordinary
-- suggestions in crm_actions, tagged with the meeting they came from.
--
-- Four new tables and one nullable column on crm_actions. No data is changed.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0019_meetings.sql

CREATE TABLE IF NOT EXISTS "meetings" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "device_id"    integer,
  "source"       text DEFAULT 'desktop' NOT NULL,
  "platform"     text DEFAULT '' NOT NULL,
  "title"        text DEFAULT '' NOT NULL,
  "status"       text DEFAULT 'live' NOT NULL,
  "meeting_url"  text DEFAULT '' NOT NULL,
  "bot_id"       text,
  "bot"          jsonb DEFAULT '{}'::jsonb NOT NULL,
  "context"      jsonb DEFAULT '{}'::jsonb NOT NULL,
  "participants" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "consent"      jsonb DEFAULT '{}'::jsonb NOT NULL,
  "live"         jsonb DEFAULT '{}'::jsonb NOT NULL,
  "notes"        jsonb,
  "notes_at"     timestamp with time zone,
  "transcriber"  text DEFAULT '' NOT NULL,
  "duration_sec" integer DEFAULT 0 NOT NULL,
  "error"        text DEFAULT '' NOT NULL,
  "started_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "ended_at"     timestamp with time zone,
  "purged_at"    timestamp with time zone,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "meetings_user_started_idx" ON "meetings" ("user_id", "started_at");
CREATE UNIQUE INDEX IF NOT EXISTS "meetings_bot_uidx" ON "meetings" ("bot_id");

CREATE TABLE IF NOT EXISTS "meeting_chunks" (
  "id"           serial PRIMARY KEY NOT NULL,
  "meeting_id"   integer NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "seq"          integer NOT NULL,
  "start_sec"    double precision DEFAULT 0 NOT NULL,
  "duration_sec" double precision DEFAULT 0 NOT NULL,
  "segments"     jsonb DEFAULT '[]'::jsonb NOT NULL,
  "engine"       text DEFAULT '' NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_chunks_seq_uidx" ON "meeting_chunks" ("meeting_id", "seq");

CREATE TABLE IF NOT EXISTS "meeting_links" (
  "id"         serial PRIMARY KEY NOT NULL,
  "meeting_id" integer NOT NULL REFERENCES "meetings"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL,
  "kind"       text NOT NULL,
  "ref_id"     integer NOT NULL,
  "how"        text DEFAULT 'manual' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "meeting_links_uidx" ON "meeting_links" ("meeting_id", "kind", "ref_id");
CREATE INDEX IF NOT EXISTS "meeting_links_ref_idx" ON "meeting_links" ("user_id", "kind", "ref_id");

CREATE TABLE IF NOT EXISTS "meeting_settings" (
  "user_id"    text PRIMARY KEY NOT NULL,
  "settings"   jsonb DEFAULT '{}'::jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "crm_actions" ADD COLUMN IF NOT EXISTS "meeting_id" integer;
CREATE INDEX IF NOT EXISTS "crm_actions_meeting_idx" ON "crm_actions" ("meeting_id");
