-- Plans: one row per person with a paid (or granted) plan. No row means the free plan. New table only;
-- nothing existing changes.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0015_plans.sql

CREATE TABLE IF NOT EXISTS "subscriptions" (
  "user_id"                 text PRIMARY KEY,
  "plan"                    text NOT NULL DEFAULT 'free',
  "status"                  text NOT NULL DEFAULT 'active',
  "seats"                   integer NOT NULL DEFAULT 1,
  "stripe_customer_id"      text,
  "stripe_subscription_id"  text,
  "current_period_end"      timestamp with time zone,
  "created_at"              timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"              timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "subscriptions_stripe_customer_idx" ON "subscriptions" ("stripe_customer_id");
