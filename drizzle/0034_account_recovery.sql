-- Account recovery without email (src/lib/auth/recovery.ts): one recovery key per person, shown once when it
-- is made, kept only as an HMAC under BETTER_AUTH_SECRET. "Forgot your password?" takes the email and the key
-- and sets a new password; the key is then replaced by a new one, shown once.
--
-- One new table. Safe to run twice. Applied by the app itself on its first request after a deploy
-- (src/lib/db/automigrate.ts), or by hand with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0034_account_recovery.sql
CREATE TABLE IF NOT EXISTS "auth_recovery" (
  "user_id" text PRIMARY KEY NOT NULL CONSTRAINT "auth_recovery_user_id_auth_users_id_fk" REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "key_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "used_at" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "auth_recovery_created_idx" ON "auth_recovery" ("created_at");
