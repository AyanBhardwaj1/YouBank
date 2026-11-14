-- Settings the app makes for itself when a deploy has none (src/lib/db/automigrate.ts): today the sign-in
-- signing secret, generated once when BETTER_AUTH_SECRET is not set, so sign-in works on a fresh deploy.
-- Setting BETTER_AUTH_SECRET in the environment always wins; this row is then unused.
--
-- One new table. Safe to run twice. Applied by the app itself, or by hand with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0035_app_secrets.sql
CREATE TABLE IF NOT EXISTS "app_secrets" (
  "name" text PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
