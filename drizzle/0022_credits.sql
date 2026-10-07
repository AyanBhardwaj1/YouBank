-- AI credit packs, team seats and billing dates. New tables, plus four nullable or defaulted columns on
-- `subscriptions`; nothing existing is rewritten. Safe to run twice.
--
-- Apply before the deploy that turns billing on (docs/launch-billing.md, step 6):
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0022_credits.sql

-- Billing dates and cancellation, read from the Stripe subscription by the webhook.
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "current_period_start" timestamp with time zone;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "billing_anchor" timestamp with time zone;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancel_at_period_end" boolean NOT NULL DEFAULT false;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "cancel_at" timestamp with time zone;
CREATE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_idx" ON "subscriptions" ("stripe_subscription_id");

-- One row per credit pack bought (or granted by an operator). `usd` is the AI value at list price;
-- `refunded_usd` the part taken back by a refund. The payment intent id is unique, so a webhook that
-- arrives twice (or races the return from Checkout) grants the pack once.
CREATE TABLE IF NOT EXISTS "ai_credit_grants" (
  "id"                          serial PRIMARY KEY,
  "user_id"                     text NOT NULL,
  "pack"                        text NOT NULL,
  "usd"                         double precision NOT NULL,
  "refunded_usd"                double precision NOT NULL DEFAULT 0,
  "paid_cents"                  integer NOT NULL DEFAULT 0,
  "currency"                    text NOT NULL DEFAULT 'usd',
  "stripe_payment_intent_id"    text,
  "stripe_checkout_session_id"  text,
  "note"                        text NOT NULL DEFAULT '',
  "created_at"                  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "ai_credit_grants_payment_intent_uidx" ON "ai_credit_grants" ("stripe_payment_intent_id");
CREATE INDEX IF NOT EXISTS "ai_credit_grants_user_idx" ON "ai_credit_grants" ("user_id", "created_at");

-- Credits used per allowance period: spend beyond the plan's allowance in that period, up to the credits
-- that were available. Settled from the usage ledger once the period ends.
CREATE TABLE IF NOT EXISTS "ai_credit_draws" (
  "user_id"        text NOT NULL,
  "period_start"   timestamp with time zone NOT NULL,
  "period_end"     timestamp with time zone NOT NULL,
  "cap_usd"        double precision NOT NULL,
  "available_usd"  double precision NOT NULL,
  "used_usd"       double precision NOT NULL DEFAULT 0,
  "settled"        boolean NOT NULL DEFAULT false,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "period_start")
);

-- Deal Team and Enterprise seats: the subscription's owner gives one to a member of a team they own or
-- administer. A person holds at most one assigned seat. Removing the team removes its seats.
CREATE TABLE IF NOT EXISTS "seat_assignments" (
  "id"             serial PRIMARY KEY,
  "owner_user_id"  text NOT NULL,
  "user_id"        text NOT NULL,
  "team_id"        integer NOT NULL REFERENCES "teams"("id") ON DELETE CASCADE,
  "email"          text NOT NULL DEFAULT '',
  "name"           text NOT NULL DEFAULT '',
  "assigned_at"    timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "seat_assignments_user_uidx" ON "seat_assignments" ("user_id");
CREATE INDEX IF NOT EXISTS "seat_assignments_owner_idx" ON "seat_assignments" ("owner_user_id", "assigned_at");
