-- Calendar: connected calendar accounts (Google, Microsoft 365, CalDAV, ICS links), their calendars,
-- the events in a sliding window (30 days back, 90 ahead) with their links to Relationships contacts
-- and deals, each person's scheduling preferences, and AI meeting briefs. New tables only; nothing
-- existing changes.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0018_calendar.sql

-- One row per connected account. OAuth tokens and CalDAV app passwords are encrypted
-- (src/lib/crm/crypto.ts); a disconnect deletes the row, and with it every calendar and event.
CREATE TABLE IF NOT EXISTS "calendar_accounts" (
  "id"                serial PRIMARY KEY,
  "user_id"           text NOT NULL,
  "provider"          text NOT NULL,
  "address"           text NOT NULL,
  "display_name"      text NOT NULL DEFAULT '',
  "access_token"      text NOT NULL DEFAULT '',
  "refresh_token"     text NOT NULL DEFAULT '',
  "token_expires_at"  timestamp with time zone,
  "secret"            text NOT NULL DEFAULT '',
  "settings"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "scopes"            jsonb NOT NULL DEFAULT '[]'::jsonb,
  "status"            text NOT NULL DEFAULT 'connected',
  "last_error"        text NOT NULL DEFAULT '',
  "last_sync_at"      timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_accounts_user_provider_address_uidx" ON "calendar_accounts" ("user_id", "provider", "address");

-- Calendars within an account, whether each is shown, and its sync and push state.
CREATE TABLE IF NOT EXISTS "calendar_calendars" (
  "id"              serial PRIMARY KEY,
  "account_id"      integer NOT NULL REFERENCES "calendar_accounts"("id") ON DELETE CASCADE,
  "user_id"         text NOT NULL,
  "remote_id"       text NOT NULL,
  "name"            text NOT NULL DEFAULT '',
  "color"           text NOT NULL DEFAULT '',
  "timezone"        text NOT NULL DEFAULT '',
  "can_write"       boolean NOT NULL DEFAULT false,
  "is_primary"      boolean NOT NULL DEFAULT false,
  "visible"         boolean NOT NULL DEFAULT true,
  "sync_token"      text NOT NULL DEFAULT '',
  "window_start"    timestamp with time zone,
  "last_synced_at"  timestamp with time zone,
  "push_id"         text,
  "push"            jsonb,
  "created_at"      timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_calendars_account_remote_uidx" ON "calendar_calendars" ("account_id", "remote_id");
CREATE INDEX IF NOT EXISTS "calendar_calendars_user_idx" ON "calendar_calendars" ("user_id");
CREATE INDEX IF NOT EXISTS "calendar_calendars_push_idx" ON "calendar_calendars" ("push_id");

-- Event occurrences in the window. A series is stored as its occurrences.
CREATE TABLE IF NOT EXISTS "calendar_events" (
  "id"             bigserial PRIMARY KEY,
  "user_id"        text NOT NULL,
  "calendar_id"    integer NOT NULL REFERENCES "calendar_calendars"("id") ON DELETE CASCADE,
  "remote_id"      text NOT NULL,
  "group_key"      text NOT NULL DEFAULT '',
  "ical_uid"       text NOT NULL DEFAULT '',
  "recurrence_id"  text,
  "series_id"      text,
  "title"          text NOT NULL DEFAULT '',
  "description"    text NOT NULL DEFAULT '',
  "location"       text NOT NULL DEFAULT '',
  "starts_at"      timestamp with time zone NOT NULL,
  "ends_at"        timestamp with time zone NOT NULL,
  "all_day"        boolean NOT NULL DEFAULT false,
  "timezone"       text NOT NULL DEFAULT '',
  "status"         text NOT NULL DEFAULT 'confirmed',
  "busy"           boolean NOT NULL DEFAULT true,
  "organizer"      jsonb,
  "attendees"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "video_url"      text NOT NULL DEFAULT '',
  "html_link"      text NOT NULL DEFAULT '',
  "etag"           text NOT NULL DEFAULT '',
  "href"           text NOT NULL DEFAULT '',
  "contact_ids"    jsonb NOT NULL DEFAULT '[]'::jsonb,
  "deal_ids"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "external"       boolean NOT NULL DEFAULT false,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_events_calendar_remote_uidx" ON "calendar_events" ("calendar_id", "remote_id");
CREATE INDEX IF NOT EXISTS "calendar_events_user_start_idx" ON "calendar_events" ("user_id", "starts_at");
CREATE INDEX IF NOT EXISTS "calendar_events_group_idx" ON "calendar_events" ("calendar_id", "group_key");
CREATE INDEX IF NOT EXISTS "calendar_events_contacts_idx" ON "calendar_events" USING gin ("contact_ids" jsonb_path_ops);
CREATE INDEX IF NOT EXISTS "calendar_events_deals_idx" ON "calendar_events" USING gin ("deal_ids" jsonb_path_ops);

-- Each person's scheduling preferences and the morning auto-brief switch.
CREATE TABLE IF NOT EXISTS "calendar_prefs" (
  "user_id"              text PRIMARY KEY,
  "email"                text NOT NULL DEFAULT '',
  "timezone"             text NOT NULL DEFAULT '',
  "work_hours"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "default_calendar_id"  integer,
  "default_duration"     integer NOT NULL DEFAULT 30,
  "video_url"            text NOT NULL DEFAULT '',
  "auto_brief"           boolean NOT NULL DEFAULT false,
  "auto_brief_last"      text NOT NULL DEFAULT '',
  "updated_at"           timestamp with time zone NOT NULL DEFAULT now()
);

-- AI meeting briefs, one per event (regenerating replaces it).
CREATE TABLE IF NOT EXISTS "calendar_briefs" (
  "id"          serial PRIMARY KEY,
  "user_id"     text NOT NULL,
  "event_id"    bigint NOT NULL REFERENCES "calendar_events"("id") ON DELETE CASCADE,
  "trigger"     text NOT NULL DEFAULT 'click',
  "content"     jsonb NOT NULL,
  "provider"    text NOT NULL DEFAULT '',
  "model"       text NOT NULL DEFAULT '',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "calendar_briefs_event_uidx" ON "calendar_briefs" ("event_id");
CREATE INDEX IF NOT EXISTS "calendar_briefs_user_idx" ON "calendar_briefs" ("user_id", "created_at");
