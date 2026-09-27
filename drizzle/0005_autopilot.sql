-- Autopilot: mail the agent sends on its own, when and only when the person has turned that on.
-- Also: IMAP/SMTP mailboxes (app passwords), the agent's questions, the playbook of learned
-- answers, and business-development mode.
--
-- Additive only: new tables, and new columns with defaults. Nothing existing changes meaning, and
-- autopilot starts switched off for everyone.
--
-- Apply with:  ( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )

ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "email_accounts" ADD COLUMN IF NOT EXISTS "secret"   text DEFAULT '' NOT NULL;

ALTER TABLE "crm_messages" ADD COLUMN IF NOT EXISTS "rfc_message_id" text DEFAULT '' NOT NULL;
ALTER TABLE "crm_messages" ADD COLUMN IF NOT EXISTS "in_reply_to"    text DEFAULT '' NOT NULL;
ALTER TABLE "crm_messages" ADD COLUMN IF NOT EXISTS "automated"      boolean DEFAULT false NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_messages_rfc_idx" ON "crm_messages" ("rfc_message_id");

ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "scheduled_for"       timestamp with time zone;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "hold_reason"         text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "confidence"          text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "sensitive"           boolean DEFAULT false NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "reply_to_message_id" integer;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "sent_by"             text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "last_error"          text DEFAULT '' NOT NULL;
ALTER TABLE "crm_drafts" ADD COLUMN IF NOT EXISTS "attempts"            integer DEFAULT 0 NOT NULL;
CREATE INDEX IF NOT EXISTS "crm_drafts_scheduled_idx" ON "crm_drafts" ("user_id","scheduled_for");

ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "mode"             text DEFAULT '' NOT NULL;
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "about"            text DEFAULT '' NOT NULL;
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "signature"        text DEFAULT '' NOT NULL;
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "internal_domains" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "autopilot"        jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE "crm_settings" ADD COLUMN IF NOT EXISTS "lock_until"       timestamp with time zone;

ALTER TABLE "crm_campaigns"     ADD COLUMN IF NOT EXISTS "send_mode" text DEFAULT 'default' NOT NULL;
ALTER TABLE "crm_nurture_rules" ADD COLUMN IF NOT EXISTS "send_mode" text DEFAULT 'default' NOT NULL;

CREATE TABLE IF NOT EXISTS "crm_questions" (
  "id"          serial PRIMARY KEY NOT NULL,
  "user_id"     text NOT NULL,
  "draft_id"    integer,
  "thread_id"   integer,
  "question"    text NOT NULL,
  "context"     text DEFAULT '' NOT NULL,
  "answer"      text DEFAULT '' NOT NULL,
  "status"      text DEFAULT 'open' NOT NULL,
  "remember"    boolean DEFAULT false NOT NULL,
  "created_at"  timestamp with time zone DEFAULT now() NOT NULL,
  "answered_at" timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "crm_questions_user_status_idx" ON "crm_questions" ("user_id","status");

CREATE TABLE IF NOT EXISTS "crm_playbook" (
  "id"         serial PRIMARY KEY NOT NULL,
  "user_id"    text NOT NULL,
  "question"   text NOT NULL,
  "answer"     text NOT NULL,
  "source"     text DEFAULT 'you' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "crm_playbook_user_idx" ON "crm_playbook" ("user_id");
