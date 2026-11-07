-- Two-factor authentication (Better Auth's twoFactor plugin, src/lib/auth/server.ts): an authenticator
-- app's TOTP secret and ten backup codes per person, both encrypted with BETTER_AUTH_SECRET, and a flag
-- on the person once their first code is verified. Password sign-in then asks for a code; risky actions
-- (broker keys, live trading, mailbox connections) ask for a fresh one whatever the sign-in method
-- (src/lib/auth/step-up.ts).
--
-- One new column on auth_users and one new table. Apply it BEFORE deploying the code that enables the
-- plugin: Better Auth reads two_factor_enabled with every session, so without it nobody can sign in.
-- Safe to run twice. New databases get it from the replay of drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0031_two_factor.sql
ALTER TABLE "auth_users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "auth_two_factor" (
  "id" text PRIMARY KEY NOT NULL,
  "secret" text NOT NULL,
  "backup_codes" text NOT NULL,
  -- Named as drizzle-kit names it, so `drizzle-kit push --strict` sees no drift.
  "user_id" text NOT NULL CONSTRAINT "auth_two_factor_user_id_auth_users_id_fk" REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "verified" boolean DEFAULT true,
  "failed_verification_count" integer DEFAULT 0,
  "locked_until" timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "auth_two_factor_user_idx" ON "auth_two_factor" ("user_id");
