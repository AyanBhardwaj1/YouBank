-- CRM and the email agent.
--
-- Six new tables and nothing else. No existing table is altered, so the app behaves identically
-- before and after this runs.
--
-- Apply with:  ( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )

CREATE TABLE IF NOT EXISTS "email_accounts" (
  "id"               serial PRIMARY KEY NOT NULL,
  "user_id"          text NOT NULL,
  "team_id"          integer,
  "provider"         text DEFAULT 'gmail' NOT NULL,
  "address"          text NOT NULL,
  "display_name"     text DEFAULT '' NOT NULL,
  "access_token"     text DEFAULT '' NOT NULL,
  "refresh_token"    text DEFAULT '' NOT NULL,
  "token_expires_at" timestamp with time zone,
  "cursor"           text DEFAULT '' NOT NULL,
  "scopes"           jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status"           text DEFAULT 'connected' NOT NULL,
  "last_sync_at"     timestamp with time zone,
  "last_error"       text DEFAULT '' NOT NULL,
  "created_at"       timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "email_accounts_user_address_uidx" ON "email_accounts" ("user_id","address");
CREATE INDEX IF NOT EXISTS "email_accounts_user_idx" ON "email_accounts" ("user_id");

CREATE TABLE IF NOT EXISTS "crm_contacts" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "team_id"      integer,
  "email"        text NOT NULL,
  "name"         text DEFAULT '' NOT NULL,
  "title"        text DEFAULT '' NOT NULL,
  "company"      text DEFAULT '' NOT NULL,
  "domain"       text DEFAULT '' NOT NULL,
  "startup_id"   integer,
  "kind"         text DEFAULT 'unknown' NOT NULL,
  "tags"         jsonb DEFAULT '[]'::jsonb NOT NULL,
  "notes"        text DEFAULT '' NOT NULL,
  "last_seen_at" timestamp with time zone,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"   timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_contacts_user_email_uidx" ON "crm_contacts" ("user_id","email");
CREATE INDEX IF NOT EXISTS "crm_contacts_team_idx" ON "crm_contacts" ("team_id");
CREATE INDEX IF NOT EXISTS "crm_contacts_domain_idx" ON "crm_contacts" ("domain");

CREATE TABLE IF NOT EXISTS "crm_deals" (
  "id"            serial PRIMARY KEY NOT NULL,
  "user_id"       text NOT NULL,
  "team_id"       integer,
  "name"          text NOT NULL,
  "stage"         text DEFAULT 'inbox' NOT NULL,
  "startup_id"    integer,
  "contact_id"    integer,
  "sector"        text DEFAULT '' NOT NULL,
  "round"         text DEFAULT '' NOT NULL,
  "amount_usd"    double precision,
  "valuation_usd" double precision,
  "source"        text DEFAULT 'manual' NOT NULL,
  "next_step"     text DEFAULT '' NOT NULL,
  "next_step_due" timestamp with time zone,
  "status"        text DEFAULT 'open' NOT NULL,
  "notes"         text DEFAULT '' NOT NULL,
  "created_at"    timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at"    timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_deals_user_stage_idx" ON "crm_deals" ("user_id","stage");
CREATE INDEX IF NOT EXISTS "crm_deals_team_idx" ON "crm_deals" ("team_id");
CREATE INDEX IF NOT EXISTS "crm_deals_contact_idx" ON "crm_deals" ("contact_id");

CREATE TABLE IF NOT EXISTS "crm_threads" (
  "id"                 serial PRIMARY KEY NOT NULL,
  "user_id"            text NOT NULL,
  "team_id"            integer,
  "account_id"         integer,
  "provider_thread_id" text NOT NULL,
  "subject"            text DEFAULT '' NOT NULL,
  "snippet"            text DEFAULT '' NOT NULL,
  "participants"       jsonb DEFAULT '[]'::jsonb NOT NULL,
  "contact_id"         integer,
  "deal_id"            integer,
  "category"           text DEFAULT 'other' NOT NULL,
  "priority"           text DEFAULT 'medium' NOT NULL,
  "summary"            text DEFAULT '' NOT NULL,
  "needs_reply"        boolean DEFAULT false NOT NULL,
  "triaged_at"         timestamp with time zone,
  "last_message_at"    timestamp with time zone,
  "created_at"         timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "crm_threads_user_provider_uidx" ON "crm_threads" ("user_id","provider_thread_id");
CREATE INDEX IF NOT EXISTS "crm_threads_user_recent_idx" ON "crm_threads" ("user_id","last_message_at");
CREATE INDEX IF NOT EXISTS "crm_threads_deal_idx" ON "crm_threads" ("deal_id");

CREATE TABLE IF NOT EXISTS "crm_messages" (
  "id"                  serial PRIMARY KEY NOT NULL,
  "thread_id"           integer NOT NULL REFERENCES "crm_threads"("id") ON DELETE CASCADE,
  "provider_message_id" text DEFAULT '' NOT NULL,
  "direction"           text DEFAULT 'inbound' NOT NULL,
  "from_name"           text DEFAULT '' NOT NULL,
  "from_address"        text DEFAULT '' NOT NULL,
  "to_addresses"        jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subject"             text DEFAULT '' NOT NULL,
  "body"                text DEFAULT '' NOT NULL,
  "sent_at"             timestamp with time zone,
  "created_at"          timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_messages_thread_idx" ON "crm_messages" ("thread_id","sent_at");

CREATE TABLE IF NOT EXISTS "crm_drafts" (
  "id"           serial PRIMARY KEY NOT NULL,
  "user_id"      text NOT NULL,
  "team_id"      integer,
  "thread_id"    integer REFERENCES "crm_threads"("id") ON DELETE CASCADE,
  "deal_id"      integer,
  "to_addresses" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "subject"      text DEFAULT '' NOT NULL,
  "body"         text DEFAULT '' NOT NULL,
  "rationale"    text DEFAULT '' NOT NULL,
  "citations"    jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status"       text DEFAULT 'pending' NOT NULL,
  "provider"     text DEFAULT '' NOT NULL,
  "model"        text DEFAULT '' NOT NULL,
  "created_at"   timestamp with time zone DEFAULT now() NOT NULL,
  "decided_at"   timestamp with time zone,
  "sent_at"      timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "crm_drafts_user_status_idx" ON "crm_drafts" ("user_id","status");
CREATE INDEX IF NOT EXISTS "crm_drafts_thread_idx" ON "crm_drafts" ("thread_id");
