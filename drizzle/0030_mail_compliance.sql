-- Commercial email compliance (src/lib/crm/compliance.ts): the sender's postal address, which CAN-SPAM
-- requires in every campaign and nurture email, alongside the unsubscribe line and the RFC 8058
-- one-click headers added at send time.
--
-- One new column on crm_settings. Safe to run twice. New databases get it from the replay of
-- drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0030_mail_compliance.sql
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "postal_address" text NOT NULL DEFAULT '';
