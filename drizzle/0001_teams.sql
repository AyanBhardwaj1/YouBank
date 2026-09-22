-- Teams: shared workspaces.
--
-- Three new tables and nothing else. No existing table is altered, so the application keeps
-- working normally both before and after this runs -- until the tables exist, the Team page says
-- so instead of erroring, and every other page is unaffected.
--
-- Apply with:  pnpm exec drizzle-kit push
-- or:          psql "$DATABASE_URL_UNPOOLED" -f drizzle/0001_teams.sql

CREATE TABLE IF NOT EXISTS "teams" (
  "id"         serial PRIMARY KEY NOT NULL,
  "name"       text NOT NULL,
  "slug"       text NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "teams_slug_uidx" ON "teams" ("slug");

CREATE TABLE IF NOT EXISTS "team_members" (
  "id"        serial PRIMARY KEY NOT NULL,
  "team_id"   integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "user_id"   text NOT NULL,
  "email"     text DEFAULT '' NOT NULL,
  "name"      text DEFAULT '' NOT NULL,
  "role"      text DEFAULT 'member' NOT NULL,
  "joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "team_members_team_user_uidx" ON "team_members" ("team_id","user_id");
CREATE INDEX IF NOT EXISTS "team_members_user_idx" ON "team_members" ("user_id");

CREATE TABLE IF NOT EXISTS "team_invites" (
  "id"          serial PRIMARY KEY NOT NULL,
  "team_id"     integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "email"       text NOT NULL,
  "role"        text DEFAULT 'member' NOT NULL,
  "token"       text NOT NULL,
  "invited_by"  text DEFAULT '' NOT NULL,
  "expires_at"  timestamp with time zone NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "team_invites_token_uidx" ON "team_invites" ("token");
CREATE UNIQUE INDEX IF NOT EXISTS "team_invites_team_email_uidx" ON "team_invites" ("team_id","email");
CREATE INDEX IF NOT EXISTS "team_invites_email_idx" ON "team_invites" ("email");
