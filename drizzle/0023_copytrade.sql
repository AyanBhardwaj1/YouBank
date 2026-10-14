-- Copy trading: 13F filers and filings from SEC EDGAR, the CUSIP-to-ticker map and the owner's overrides,
-- follows (alerts on a new 13F), copies (paper or live), brokerage connections through SnapTrade, the
-- stored consents, order batches and their orders, and an append-only audit log. New tables only; nothing
-- existing changes.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0023_copytrade.sql

-- Every 13F filer seen in EDGAR's indexes, for search by name or CIK. Curated managers are marked.
CREATE TABLE IF NOT EXISTS "copy_filers" (
  "cik"            text PRIMARY KEY,
  "name"           text NOT NULL,
  "latest_filed"   date,
  "latest_period"  date,
  "curated"        boolean NOT NULL DEFAULT false,
  "checked_at"     timestamp with time zone,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_filers_name_idx" ON "copy_filers" (lower("name"));
CREATE INDEX IF NOT EXISTS "copy_filers_latest_idx" ON "copy_filers" ("latest_filed");

-- One row per 13F-HR or 13F-HR/A read, with its holdings (summed per security) as JSON.
CREATE TABLE IF NOT EXISTS "copy_filings" (
  "accession"             text PRIMARY KEY,
  "cik"                   text NOT NULL,
  "form"                  text NOT NULL,
  "filed_on"              date NOT NULL,
  "period"                date NOT NULL,
  "report_type"           text NOT NULL DEFAULT 'HOLDINGS',
  "amendment_type"        text,
  "confidential_omitted"  boolean NOT NULL DEFAULT false,
  "unit_corrected"        boolean NOT NULL DEFAULT false,
  "entry_total"           integer,
  "value_total"           double precision,
  "holdings"              jsonb NOT NULL DEFAULT '[]'::jsonb,
  "lines"                 integer NOT NULL DEFAULT 0,
  "doc_url"               text NOT NULL DEFAULT '',
  "table_url"             text NOT NULL DEFAULT '',
  "status"                text NOT NULL DEFAULT 'ok',
  "created_at"            timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_filings_cik_idx" ON "copy_filings" ("cik", "filed_on");

-- CUSIP to ticker, with where each answer came from. A null ticker is a remembered miss, retried later.
CREATE TABLE IF NOT EXISTS "copy_securities" (
  "cusip"        text PRIMARY KEY,
  "ticker"       text,
  "issuer"       text NOT NULL DEFAULT '',
  "title"        text NOT NULL DEFAULT '',
  "cik"          text,
  "figi"         text,
  "sic"          integer,
  "sector"       text,
  "source"       text NOT NULL DEFAULT 'none',
  "has_options"  boolean,
  "on_13f_list"  text,
  "checked_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_securities_ticker_idx" ON "copy_securities" ("ticker");

-- The owner's corrections, which always win. Never written by the jobs.
CREATE TABLE IF NOT EXISTS "copy_cusip_overrides" (
  "cusip"       text PRIMARY KEY,
  "ticker"      text NOT NULL,
  "note"        text NOT NULL DEFAULT '',
  "created_by"  text NOT NULL DEFAULT '',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

-- Funds a person follows: an alert (bell, push) when a new 13F or 13F/A is filed.
CREATE TABLE IF NOT EXISTS "copy_follows" (
  "user_id"     text NOT NULL,
  "cik"         text NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "cik")
);

CREATE INDEX IF NOT EXISTS "copy_follows_cik_idx" ON "copy_follows" ("cik");

-- A copy: one fund (or a blend), its sizing and rules, paper or live. Paper copies keep their own ledger;
-- live copies record the shares their filled orders hold (managed), so outside positions stay protected.
CREATE TABLE IF NOT EXISTS "copy_portfolios" (
  "id"                serial PRIMARY KEY,
  "user_id"           text NOT NULL,
  "name"              text NOT NULL,
  "mode"              text NOT NULL DEFAULT 'paper',
  "status"            text NOT NULL DEFAULT 'active',
  "funds"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "rules"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sizing"            jsonb NOT NULL DEFAULT '{}'::jsonb,
  "trading"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "account_id"        text,
  "managed"           jsonb NOT NULL DEFAULT '{}'::jsonb,
  "paper"             jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_accession"    text,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_portfolios_user_idx" ON "copy_portfolios" ("user_id", "status");

-- A person's SnapTrade user. The secret is encrypted at rest (AES-256-GCM, lib/crm/crypto).
CREATE TABLE IF NOT EXISTS "copy_brokers" (
  "user_id"           text PRIMARY KEY,
  "snaptrade_user"    text NOT NULL,
  "secret_enc"        text NOT NULL,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "last_synced_at"    timestamp with time zone,
  CONSTRAINT "copy_brokers_snap_uq" UNIQUE ("snaptrade_user")
);

-- Consents as given: which text (kind and version), when, from where.
CREATE TABLE IF NOT EXISTS "copy_consents" (
  "user_id"     text NOT NULL,
  "kind"        text NOT NULL,
  "version"     text NOT NULL,
  "text_hash"   text NOT NULL DEFAULT '',
  "ip"          text,
  "user_agent"  text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "kind", "version")
);

-- A reviewed set of orders for one copy. Moves proposed -> placing once (the idempotency claim).
CREATE TABLE IF NOT EXISTS "copy_batches" (
  "id"            serial PRIMARY KEY,
  "user_id"       text NOT NULL,
  "portfolio_id"  integer NOT NULL,
  "account_id"    text NOT NULL,
  "status"        text NOT NULL DEFAULT 'proposed',
  "idem_key"      text,
  "buy_value"     double precision NOT NULL DEFAULT 0,
  "sell_value"    double precision NOT NULL DEFAULT 0,
  "order_count"   integer NOT NULL DEFAULT 0,
  "proposal"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "accession"     text,
  "expires_at"    timestamp with time zone NOT NULL,
  "approved_at"   timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_batches_user_idx" ON "copy_batches" ("user_id", "created_at");

-- One order of a batch. client_order_id is unique, so the same order cannot be stored twice.
CREATE TABLE IF NOT EXISTS "copy_orders" (
  "id"                  serial PRIMARY KEY,
  "batch_id"            integer NOT NULL,
  "user_id"             text NOT NULL,
  "portfolio_id"        integer NOT NULL,
  "seq"                 integer NOT NULL,
  "client_order_id"     text NOT NULL,
  "ticker"              text NOT NULL,
  "symbol_id"           text,
  "action"              text NOT NULL,
  "units"               double precision NOT NULL,
  "order_type"          text NOT NULL DEFAULT 'Limit',
  "limit_price"         double precision,
  "est_value"           double precision NOT NULL DEFAULT 0,
  "status"              text NOT NULL DEFAULT 'pending',
  "brokerage_order_id"  text,
  "filled_units"        double precision NOT NULL DEFAULT 0,
  "fill_price"          double precision,
  "error"               text,
  "impact"              jsonb,
  "response"            jsonb,
  "sent_at"             timestamp with time zone,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "copy_orders_client_uq" UNIQUE ("client_order_id")
);

CREATE INDEX IF NOT EXISTS "copy_orders_batch_idx" ON "copy_orders" ("batch_id", "seq");
CREATE INDEX IF NOT EXISTS "copy_orders_user_idx" ON "copy_orders" ("user_id", "sent_at");

-- Every consent, connection, proposal, approval and order, with the exact payloads. Append-only: the
-- rules below turn any UPDATE or DELETE into nothing, so a row cannot be changed or removed through SQL
-- short of dropping the rules (which the owner's database role can do, and an audit would show).
CREATE TABLE IF NOT EXISTS "copy_audit" (
  "id"            bigserial PRIMARY KEY,
  "user_id"       text NOT NULL,
  "actor"         text NOT NULL,
  "action"        text NOT NULL,
  "portfolio_id"  integer,
  "batch_id"      integer,
  "order_id"      integer,
  "payload"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip"            text,
  "user_agent"    text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "copy_audit_user_idx" ON "copy_audit" ("user_id", "created_at");

CREATE OR REPLACE RULE "copy_audit_no_update" AS ON UPDATE TO "copy_audit" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE "copy_audit_no_delete" AS ON DELETE TO "copy_audit" DO INSTEAD NOTHING;
