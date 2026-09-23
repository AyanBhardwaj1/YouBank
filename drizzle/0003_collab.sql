-- Live collaboration: shared tool sessions.
--
-- Three new tables and nothing else. No existing table is altered.
--
-- Apply with:  ( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )

CREATE TABLE IF NOT EXISTS "collab_sessions" (
  "id"         serial PRIMARY KEY NOT NULL,
  "team_id"    integer,
  "owner_id"   text NOT NULL,
  "kind"       text DEFAULT 'tool' NOT NULL,
  "ref_id"     text DEFAULT '' NOT NULL,
  "title"      text DEFAULT '' NOT NULL,
  "state"      jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status"     text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "collab_sessions_team_idx"  ON "collab_sessions" ("team_id");
CREATE INDEX IF NOT EXISTS "collab_sessions_owner_idx" ON "collab_sessions" ("owner_id");

CREATE TABLE IF NOT EXISTS "collab_events" (
  "id"         serial PRIMARY KEY NOT NULL,
  "session_id" integer NOT NULL REFERENCES "collab_sessions"("id") ON DELETE CASCADE,
  "user_id"    text NOT NULL,
  "user_name"  text DEFAULT '' NOT NULL,
  "kind"       text NOT NULL,
  "payload"    jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "collab_events_session_idx" ON "collab_events" ("session_id","id");

CREATE TABLE IF NOT EXISTS "collab_presence" (
  "id"           serial PRIMARY KEY NOT NULL,
  "session_id"   integer NOT NULL REFERENCES "collab_sessions"("id") ON DELETE CASCADE,
  "user_id"      text NOT NULL,
  "name"         text DEFAULT '' NOT NULL,
  "field"        text DEFAULT '' NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "collab_presence_session_user_uidx" ON "collab_presence" ("session_id","user_id");
