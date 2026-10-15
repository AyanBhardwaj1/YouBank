-- Quant Edge (docs/quant-edge.md): the signal and target stores the algo engine reads (QF1), the trial log
-- behind the deflated Sharpe ratio (QF2, Q3), saved analyses, a person's own fills (Q5), factor returns
-- (QF4), the point-in-time universe (QF3), insider transactions (Q7) and the Quant consent. New tables
-- only; nothing existing changes.
--
-- Numbered 0026 because the algo branch's migration is 0025. Plain Postgres: tables, indexes and two rules.
-- New databases get it from the replay of drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0026_quant.sql

-- QF1. One row per signal; the body is the full QuantSignal (src/lib/quant/contracts.ts). The id is a hash
-- of producer, version, instrument, as-of time and horizon, so a re-run of the same producer upserts.
CREATE TABLE IF NOT EXISTS "quant_signals" (
  "id"                text PRIMARY KEY,
  "producer"          text NOT NULL,
  "producer_version"  text NOT NULL,
  "symbol"            text NOT NULL,
  "cik"               text,
  "asset_class"       text NOT NULL DEFAULT 'equity',
  "as_of"             timestamp with time zone NOT NULL,
  "computed_at"       timestamp with time zone NOT NULL DEFAULT now(),
  "reconstructed"     boolean NOT NULL DEFAULT false,
  "valid_until"       timestamp with time zone NOT NULL,
  "horizon_days"      integer NOT NULL,
  "body"              jsonb NOT NULL,
  "forecast_id"       bigint
);

CREATE INDEX IF NOT EXISTS "quant_signals_producer_idx" ON "quant_signals" ("producer", "as_of");
CREATE INDEX IF NOT EXISTS "quant_signals_symbol_idx" ON "quant_signals" ("symbol", "as_of");

-- QF1. Target portfolios, versioned per definition ('copy:34', 'sleeve:12', 'algo:strategy:56').
CREATE TABLE IF NOT EXISTS "quant_targets" (
  "id"          bigserial PRIMARY KEY,
  "target_key"  text NOT NULL,
  "owner_id"    text,
  "version"     integer NOT NULL,
  "as_of"       timestamp with time zone NOT NULL,
  "body"        jsonb NOT NULL,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "quant_targets_key_version_uq" UNIQUE ("target_key", "version")
);

CREATE INDEX IF NOT EXISTS "quant_targets_key_idx" ON "quant_targets" ("target_key", "as_of");

-- QF2 and Q3. Every backtest run counts as a trial of its family. Returns live in R2 (returns_ref) or, when
-- R2 is not configured, inline. Hygiene holds the point-in-time read log summary the algo engine sends.
-- Append-only: the rules below turn UPDATE and DELETE into nothing, so nobody lowers their trial count.
CREATE TABLE IF NOT EXISTS "quant_trials" (
  "id"           bigserial PRIMARY KEY,
  "owner_id"     text,
  "family"       text NOT NULL,
  "params"       jsonb NOT NULL,
  "params_hash"  text NOT NULL DEFAULT '',
  "returns_ref"  text NOT NULL,
  "returns"      jsonb,
  "start_date"   date,
  "end_date"     date,
  "periods_per_year" integer NOT NULL DEFAULT 252,
  "sharpe"       real,
  "n_obs"        integer,
  "skew"         real,
  "kurt"         real,
  "hygiene"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "source"       text NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "quant_trials_family_idx" ON "quant_trials" ("family");
CREATE INDEX IF NOT EXISTS "quant_trials_owner_idx" ON "quant_trials" ("owner_id", "created_at");

CREATE OR REPLACE RULE "quant_trials_no_update" AS ON UPDATE TO "quant_trials" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE "quant_trials_no_delete" AS ON DELETE TO "quant_trials" DO INSTEAD NOTHING;

-- Saved analyses: integrity reports, factor and risk runs, TCA reports, risk budgets, drills, overrides.
CREATE TABLE IF NOT EXISTS "quant_runs" (
  "id"             bigserial PRIMARY KEY,
  "owner_id"       text NOT NULL,
  "kind"           text NOT NULL,
  "input"          jsonb NOT NULL,
  "output"         jsonb NOT NULL,
  "sources"        jsonb NOT NULL DEFAULT '[]'::jsonb,
  "model_version"  text NOT NULL,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "quant_runs_owner_idx" ON "quant_runs" ("owner_id", "kind", "created_at");

-- Q5. A person's own executions. Owner-scoped, deletable, never pooled across people.
CREATE TABLE IF NOT EXISTS "quant_fills" (
  "id"           bigserial PRIMARY KEY,
  "owner_id"     text NOT NULL,
  "source"       text NOT NULL,
  "account_ref"  text NOT NULL,
  "symbol"       text NOT NULL,
  "side"         text NOT NULL,
  "qty"          double precision NOT NULL,
  "price"        double precision NOT NULL,
  "executed_at"  timestamp with time zone NOT NULL,
  "placed_at"    timestamp with time zone,
  "order_type"   text,
  "limit_price"  double precision,
  "broker"       text,
  "fees"         double precision,
  "ext_id"       text NOT NULL,
  "raw"          jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "quant_fills_ext_uq" UNIQUE ("owner_id", "source", "ext_id")
);

CREATE INDEX IF NOT EXISTS "quant_fills_owner_idx" ON "quant_fills" ("owner_id", "executed_at");

-- QF4. Daily factor returns, keyed by universe and version (YouBank's own factors and the ETF proxies).
CREATE TABLE IF NOT EXISTS "quant_factor_returns" (
  "date"      date NOT NULL,
  "factor"    text NOT NULL,
  "universe"  text NOT NULL,
  "version"   text NOT NULL,
  "ret"       double precision NOT NULL,
  PRIMARY KEY ("date", "factor", "universe", "version")
);

CREATE INDEX IF NOT EXISTS "quant_factor_returns_factor_idx" ON "quant_factor_returns" ("factor", "universe", "version", "date");

-- QF3. The point-in-time universe: which securities existed when, and where each row came from.
CREATE TABLE IF NOT EXISTS "quant_universe" (
  "symbol"         text NOT NULL,
  "cik"            text,
  "name"           text NOT NULL,
  "exchange"       text,
  "share_class"    text,
  "security_type"  text NOT NULL,
  "first_date"     date NOT NULL,
  "last_date"      date,
  "successor"      text,
  "rank"           integer,
  "market_cap"     double precision,
  "has_prices"     boolean NOT NULL DEFAULT false,
  "source"         text NOT NULL,
  "updated_at"     timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("symbol", "first_date")
);

CREATE INDEX IF NOT EXISTS "quant_universe_cik_idx" ON "quant_universe" ("cik");
CREATE INDEX IF NOT EXISTS "quant_universe_rank_idx" ON "quant_universe" ("rank");

-- Q7. Open-market insider transactions from Form 4 (live feed and the SEC's quarterly data sets), one row
-- per transaction line, timed from the filing's EDGAR acceptance.
CREATE TABLE IF NOT EXISTS "quant_insider_tx" (
  "accession"      text NOT NULL,
  "line"           integer NOT NULL,
  "issuer_cik"     text NOT NULL,
  "symbol"         text NOT NULL DEFAULT '',
  "owner_cik"      text NOT NULL DEFAULT '',
  "owner_name"     text NOT NULL,
  "is_director"    boolean NOT NULL DEFAULT false,
  "is_officer"     boolean NOT NULL DEFAULT false,
  "is_ten_pct"     boolean NOT NULL DEFAULT false,
  "officer_title"  text NOT NULL DEFAULT '',
  "code"           text NOT NULL,
  "acquired"       boolean NOT NULL DEFAULT true,
  "shares"         double precision NOT NULL DEFAULT 0,
  "price"          double precision,
  "owned_after"    double precision,
  "trade_date"     date NOT NULL,
  "accepted_at"    timestamp with time zone NOT NULL,
  "plan_10b5_1"    boolean NOT NULL DEFAULT false,
  "form"           text NOT NULL DEFAULT '4',
  "source"         text NOT NULL DEFAULT 'live',
  "url"            text NOT NULL DEFAULT '',
  PRIMARY KEY ("accession", "line")
);

CREATE INDEX IF NOT EXISTS "quant_insider_tx_issuer_idx" ON "quant_insider_tx" ("issuer_cik", "trade_date");
CREATE INDEX IF NOT EXISTS "quant_insider_tx_accepted_idx" ON "quant_insider_tx" ("accepted_at");
CREATE INDEX IF NOT EXISTS "quant_insider_tx_owner_idx" ON "quant_insider_tx" ("owner_cik", "trade_date");

-- The Quant hub's one consent (quant.terms), as given: kind and version of the text, when, from where.
CREATE TABLE IF NOT EXISTS "quant_consents" (
  "user_id"     text NOT NULL,
  "kind"        text NOT NULL,
  "version"     text NOT NULL,
  "text_hash"   text NOT NULL DEFAULT '',
  "ip"          text,
  "user_agent"  text,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "kind", "version")
);

-- QF5 and Q7. Market events a signal producer detected (an insider cluster, a new 13D), timed from the
-- EDGAR acceptance of the filing that completed them, with the filings behind them in the body.
CREATE TABLE IF NOT EXISTS "quant_events" (
  "id"           text PRIMARY KEY,
  "type"         text NOT NULL,
  "issuer_cik"   text NOT NULL,
  "symbol"       text NOT NULL DEFAULT '',
  "occurred_at"  date NOT NULL,
  "accepted_at"  timestamp with time zone NOT NULL,
  "body"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "quant_events_type_idx" ON "quant_events" ("type", "accepted_at");
CREATE INDEX IF NOT EXISTS "quant_events_issuer_idx" ON "quant_events" ("issuer_cik", "accepted_at");

-- QF5. Base rates per event definition and version (cumulative abnormal returns, hit rates, era and size
-- splits), computed by the event-study engine and read by every signal that cites one.
CREATE TABLE IF NOT EXISTS "quant_base_rates" (
  "key"          text PRIMARY KEY,
  "event_type"   text NOT NULL,
  "version"      text NOT NULL,
  "body"         jsonb NOT NULL,
  "computed_at"  timestamp with time zone NOT NULL DEFAULT now()
);
