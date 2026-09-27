-- Outreach: next-best actions, funding signals, nurture, campaigns, and the agent's standing orders.
--
-- Seven new tables, plus nullable or defaulted columns on two existing ones (crm_contacts,
-- crm_drafts). Existing rows keep working unchanged: every old draft becomes kind 'reply', which
-- is what it was.
--
-- Apply with:  ( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )

ALTER TABLE "crm_contacts" ADD COLUMN IF NOT EXISTS "opted_out_at" timestamp with time zone;

ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "kind"             text DEFAULT 'reply' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "contact_id"       integer;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "campaign_lead_id" integer;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "meta"             jsonb DEFAULT '{}'::jsonb NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_drafts_lead_idx" ON "crm_drafts" ("campaign_lead_id");

CREATE TABLE IF NOT EXISTS "crm_settings" (
  "user_id"         text PRIMARY KEY NOT NULL,
  "instructions"    text DEFAULT '' NOT NULL,
  "knowledge"       text DEFAULT '' NOT NULL,
  "voice"           text DEFAULT '' NOT NULL,
  "follow_up_days"  integer DEFAULT 5 NOT NULL,
  "stale_deal_days" integer DEFAULT 21 NOT NULL,
  "nightly"         boolean DEFAULT true NOT NULL,
  "last_run_at"     timestamp with time zone,
  "updated_at"      timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "crm_actions" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       text NOT NULL,
  "kind"          text NOT NULL,
  "status"        text DEFAULT 'pending' NOT NULL,
  "title"         text NOT NULL,
  "reasoning"     text DEFAULT '' NOT NULL,
  "uncertainties" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "payload"       jsonb DEFAULT '{}'::jsonb NOT NULL,
  "dedupe_key"    text NOT NULL,
  "contact_id"    integer,
  "deal_id"       integer,
  "thread_id"     integer,
  "draft_id"      integer,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at"    timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_actions_user_dedupe_uidx" ON "crm_actions" ("user_id","dedupe_key");
CREATE INDEX IF NOT EXISTS "crm_actions_user_status_idx" ON "crm_actions" ("user_id","status");

CREATE TABLE IF NOT EXISTS "crm_signals" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "contact_id"  integer,
  "deal_id"     integer,
  "kind"        text DEFAULT 'funding' NOT NULL,
  "source_key"  text NOT NULL,
  "title"       text NOT NULL,
  "detail"      text DEFAULT '' NOT NULL,
  "url"         text DEFAULT '' NOT NULL,
  "strength"    text DEFAULT 'name' NOT NULL,
  "occurred_at" timestamp with time zone,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_signals_user_contact_source_uidx" ON "crm_signals" ("user_id","contact_id","source_key");
CREATE INDEX IF NOT EXISTS "crm_signals_user_idx" ON "crm_signals" ("user_id","created_at");

CREATE TABLE IF NOT EXISTS "crm_nurture_rules" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       text NOT NULL,
  "name"          text NOT NULL,
  "enabled"       boolean DEFAULT true NOT NULL,
  "cadence_days"  integer DEFAULT 180 NOT NULL,
  "anchor"        text DEFAULT 'last_sent' NOT NULL,
  "kinds"         jsonb DEFAULT '[]'::jsonb NOT NULL,
  "min_exchanges" integer DEFAULT 2 NOT NULL,
  "daily_cap"     integer DEFAULT 5 NOT NULL,
  "instructions"  text DEFAULT '' NOT NULL,
  "last_run_at"   timestamp with time zone,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_nurture_rules_user_idx" ON "crm_nurture_rules" ("user_id");

CREATE TABLE IF NOT EXISTS "crm_nurture_log" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "rule_id"    integer NOT NULL CONSTRAINT "crm_nurture_log_rule_id_crm_nurture_rules_id_fk" REFERENCES "crm_nurture_rules"("id") ON DELETE CASCADE,
  "contact_id" integer NOT NULL,
  "outcome"    text NOT NULL,
  "reason"     text DEFAULT '' NOT NULL,
  "draft_id"   integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_nurture_log_rule_idx" ON "crm_nurture_log" ("rule_id","created_at");
CREATE INDEX IF NOT EXISTS "crm_nurture_log_contact_idx" ON "crm_nurture_log" ("user_id","contact_id");

CREATE TABLE IF NOT EXISTS "crm_campaigns" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "name"         text NOT NULL,
  "status"       text DEFAULT 'draft' NOT NULL,
  "goal"         text DEFAULT '' NOT NULL,
  "icp"          text DEFAULT '' NOT NULL,
  "instructions" text DEFAULT '' NOT NULL,
  "steps"        jsonb DEFAULT '[]'::jsonb NOT NULL,
  "daily_cap"    integer DEFAULT 10 NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_campaigns_user_idx" ON "crm_campaigns" ("user_id");

CREATE TABLE IF NOT EXISTS "crm_campaign_leads" (
  "id"              serial PRIMARY KEY NOT NULL,
  "campaign_id"     integer NOT NULL CONSTRAINT "crm_campaign_leads_campaign_id_crm_campaigns_id_fk" REFERENCES "crm_campaigns"("id") ON DELETE CASCADE,
  "user_id"         text NOT NULL,
  "contact_id"      integer,
  "startup_id"      integer,
  "email"           text DEFAULT '' NOT NULL,
  "name"            text DEFAULT '' NOT NULL,
  "company"         text DEFAULT '' NOT NULL,
  "notes"           text DEFAULT '' NOT NULL,
  "status"          text DEFAULT 'sourced' NOT NULL,
  "fit"             integer,
  "fit_reason"      text DEFAULT '' NOT NULL,
  "step"            integer DEFAULT 0 NOT NULL,
  "next_due_at"     timestamp with time zone,
  "last_sent_at"    timestamp with time zone,
  "replied_at"      timestamp with time zone,
  "replied_at_step" integer,
  "thread_id"       integer,
  "created_at"      timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_campaign_leads_campaign_idx" ON "crm_campaign_leads" ("campaign_id","status");
CREATE INDEX IF NOT EXISTS "crm_campaign_leads_user_email_idx" ON "crm_campaign_leads" ("user_id","email");
