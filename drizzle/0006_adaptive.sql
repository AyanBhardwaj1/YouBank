-- The adaptive engine: earned autonomy, lessons from edits, and outreach experiments.
--
-- Additive only. Existing drafts get an empty original_body and are simply not learned from.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0006_adaptive.sql

ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "original_body" text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "variant"       text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "learned"       boolean DEFAULT false NOT NULL;

CREATE TABLE IF NOT EXISTS "crm_trust" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       text NOT NULL,
  "bucket"        text NOT NULL,
  "good"          double precision DEFAULT 0 NOT NULL,
  "bad"           double precision DEFAULT 0 NOT NULL,
  "observations"  integer DEFAULT 0 NOT NULL,
  "unchanged"     integer DEFAULT 0 NOT NULL,
  "eprocess"      double precision DEFAULT 1 NOT NULL,
  "cancel_streak" integer DEFAULT 0 NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now() NOT NULL
);
-- Brings a test database that ran an earlier draft of this migration to the same shape.
ALTER TABLE "crm_trust" ADD COLUMN IF NOT EXISTS "good" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "crm_trust" ADD COLUMN IF NOT EXISTS "bad" double precision DEFAULT 0 NOT NULL;
ALTER TABLE "crm_trust" ADD COLUMN IF NOT EXISTS "eprocess" double precision DEFAULT 1 NOT NULL;
ALTER TABLE "crm_trust" ADD COLUMN IF NOT EXISTS "cancel_streak" integer DEFAULT 0 NOT NULL;
ALTER TABLE "crm_trust" DROP COLUMN IF EXISTS "alpha";
ALTER TABLE "crm_trust" DROP COLUMN IF EXISTS "beta";
CREATE UNIQUE INDEX IF NOT EXISTS "crm_trust_user_bucket_uidx" ON "crm_trust" ("user_id","bucket");

CREATE TABLE IF NOT EXISTS "crm_arms" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "dimension"  text NOT NULL,
  "arm"        text NOT NULL,
  "pulls"      double precision DEFAULT 0 NOT NULL,
  "rewards"    double precision DEFAULT 0 NOT NULL,
  "negatives"  double precision DEFAULT 0 NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "crm_arms" ALTER COLUMN "pulls" TYPE double precision;
ALTER TABLE "crm_arms" ALTER COLUMN "rewards" TYPE double precision;
ALTER TABLE "crm_arms" ADD COLUMN IF NOT EXISTS "negatives" double precision DEFAULT 0 NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "crm_arms_user_dim_arm_uidx" ON "crm_arms" ("user_id","dimension","arm");

CREATE TABLE IF NOT EXISTS "crm_lessons" (
  "id"              serial PRIMARY KEY NOT NULL,
  "user_id"         text NOT NULL,
  "context"         text DEFAULT 'any' NOT NULL,
  "rule"            text NOT NULL,
  "evidence"        integer DEFAULT 1 NOT NULL,
  "confirmed"       boolean DEFAULT false NOT NULL,
  "active"          boolean DEFAULT true NOT NULL,
  "source_draft_id" integer,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"      timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "crm_lessons" ADD COLUMN IF NOT EXISTS "confirmed" boolean DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_lessons_user_idx" ON "crm_lessons" ("user_id","active");

CREATE TABLE IF NOT EXISTS "crm_learning_events" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "draft_id"   integer,
  "loop"       text NOT NULL,
  "key"        text DEFAULT '' NOT NULL,
  "outcome"    text NOT NULL,
  "edit_ratio" double precision,
  "reward"     double precision,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_learning_events_user_idx" ON "crm_learning_events" ("user_id","created_at");

-- Campaigns skip EU and Canadian recipients unless the person confirms consent or another lawful basis.
ALTER TABLE "crm_campaigns" ADD COLUMN IF NOT EXISTS "consent_regions" boolean DEFAULT false NOT NULL;
