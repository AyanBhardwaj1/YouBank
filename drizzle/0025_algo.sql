-- Algorithmic and agentic trading: strategies (backtest, paper, live with approval, live autonomous),
-- broker connections (credentials encrypted at rest), decisions, order batches and orders with their
-- lifecycle, consents (per strategy for autonomous trading), the kill switches, daily equity marks, the
-- agent's conversation, saved backtests, and an append-only audit log. New tables only; nothing existing
-- changes. SnapTrade connections are copy trading's (copy_brokers), shared.
--
-- Plain Postgres: tables, indexes and two rules. New databases get it from the replay of drizzle/*.sql;
-- an existing one with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0025_algo.sql

-- Kill switches: one row per person, and the administrators' global switch under user_id '__global__'.
CREATE TABLE IF NOT EXISTS "algo_settings" (
  "user_id"      text PRIMARY KEY,
  "kill"         boolean NOT NULL DEFAULT false,
  "kill_reason"  text,
  "kill_by"      text,
  "kill_at"      timestamp with time zone,
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);

-- Broker connections other than SnapTrade: Alpaca (OAuth token or API keys), Webull (app key and secret),
-- Robinhood Crypto (API key and Ed25519 seed). `secret_enc` is AES-256-GCM (lib/crm/crypto).
CREATE TABLE IF NOT EXISTS "algo_connections" (
  "id"            serial PRIMARY KEY,
  "user_id"       text NOT NULL,
  "broker"        text NOT NULL,
  "env"           text NOT NULL DEFAULT 'paper',
  "label"         text NOT NULL DEFAULT '',
  "secret_enc"    text NOT NULL,
  "status"        text NOT NULL DEFAULT 'active',
  "last_error"    text,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at"  timestamp with time zone
);

CREATE INDEX IF NOT EXISTS "algo_connections_user_idx" ON "algo_connections" ("user_id", "status");

-- A strategy: its spec (lib/algo/strategy.ts), its mode and state, its paper account, its own holdings
-- in a live account (managed), and its equity peak and day start for the risk engine.
CREATE TABLE IF NOT EXISTS "algo_strategies" (
  "id"                 serial PRIMARY KEY,
  "user_id"            text NOT NULL,
  "name"               text NOT NULL,
  "spec"               jsonb NOT NULL,
  "mode"               text NOT NULL DEFAULT 'paper',
  "status"             text NOT NULL DEFAULT 'active',
  "kill"               boolean NOT NULL DEFAULT false,
  "kill_reason"        text,
  "connection"         text,
  "account_id"         text,
  "managed"            jsonb NOT NULL DEFAULT '{}'::jsonb,
  "paper"              jsonb,
  "paper_started_at"   timestamp with time zone,
  "risk_confirmed_at"  timestamp with time zone,
  "state"              jsonb NOT NULL DEFAULT '{}'::jsonb,
  "equity_peak"        double precision,
  "equity_day_start"   double precision,
  "equity_day"         date,
  "backtests"          integer NOT NULL DEFAULT 0,
  "last_decision"      jsonb,
  "last_tick_at"       timestamp with time zone,
  "next_tick_at"       timestamp with time zone,
  "created_at"         timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"         timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_strategies_user_idx" ON "algo_strategies" ("user_id", "status");
CREATE INDEX IF NOT EXISTS "algo_strategies_due_idx" ON "algo_strategies" ("status", "next_tick_at");

-- One equity mark per strategy per day, for the dashboards.
CREATE TABLE IF NOT EXISTS "algo_equity" (
  "strategy_id"  integer NOT NULL,
  "date"         date NOT NULL,
  "equity"       double precision NOT NULL,
  "benchmark"    double precision,
  PRIMARY KEY ("strategy_id", "date")
);

-- Each decision the engine (or the agent, on the person's instruction) made: target, signals and reasons.
CREATE TABLE IF NOT EXISTS "algo_decisions" (
  "id"           bigserial PRIMARY KEY,
  "strategy_id"  integer NOT NULL,
  "user_id"      text NOT NULL,
  "source"       text NOT NULL DEFAULT 'engine',
  "mode"         text NOT NULL,
  "target"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "signals"      jsonb NOT NULL DEFAULT '[]'::jsonb,
  "notes"        text NOT NULL DEFAULT '',
  "orders"       integer NOT NULL DEFAULT 0,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_decisions_strategy_idx" ON "algo_decisions" ("strategy_id", "created_at");

-- A set of orders for one strategy. Moves proposed -> placing once (the idempotency claim), as copy trading's.
CREATE TABLE IF NOT EXISTS "algo_batches" (
  "id"            serial PRIMARY KEY,
  "user_id"       text NOT NULL,
  "strategy_id"   integer NOT NULL,
  "decision_id"   bigint,
  "source"        text NOT NULL DEFAULT 'engine',
  "account_id"    text NOT NULL,
  "status"        text NOT NULL DEFAULT 'proposed',
  "idem_key"      text,
  "buy_value"     double precision NOT NULL DEFAULT 0,
  "sell_value"    double precision NOT NULL DEFAULT 0,
  "order_count"   integer NOT NULL DEFAULT 0,
  "proposal"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "expires_at"    timestamp with time zone NOT NULL,
  "approved_at"   timestamp with time zone,
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_batches_user_idx" ON "algo_batches" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "algo_batches_strategy_idx" ON "algo_batches" ("strategy_id", "status");

-- One order (or one TWAP slice) of a batch. client_order_id is unique, so the same order cannot be stored twice.
CREATE TABLE IF NOT EXISTS "algo_orders" (
  "id"                serial PRIMARY KEY,
  "batch_id"          integer NOT NULL,
  "user_id"           text NOT NULL,
  "strategy_id"       integer NOT NULL,
  "seq"               integer NOT NULL,
  "slice"             integer NOT NULL DEFAULT 0,
  "slices"            integer NOT NULL DEFAULT 1,
  "client_order_id"   text NOT NULL,
  "symbol"            text NOT NULL,
  "asset_class"       text NOT NULL DEFAULT 'equity',
  "symbol_id"         text,
  "action"            text NOT NULL,
  "units"             double precision NOT NULL,
  "order_type"        text NOT NULL DEFAULT 'Limit',
  "limit_price"       double precision,
  "est_value"         double precision NOT NULL DEFAULT 0,
  "status"            text NOT NULL DEFAULT 'pending',
  "broker_order_id"   text,
  "filled_units"      double precision NOT NULL DEFAULT 0,
  "fill_price"        double precision,
  "error"             text,
  "impact"            jsonb,
  "response"          jsonb,
  "not_before"        timestamp with time zone,
  "sent_at"           timestamp with time zone,
  "created_at"        timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"        timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "algo_orders_client_uq" UNIQUE ("client_order_id")
);

CREATE INDEX IF NOT EXISTS "algo_orders_batch_idx" ON "algo_orders" ("batch_id", "seq", "slice");
CREATE INDEX IF NOT EXISTS "algo_orders_strategy_idx" ON "algo_orders" ("strategy_id", "sent_at");
CREATE INDEX IF NOT EXISTS "algo_orders_user_idx" ON "algo_orders" ("user_id", "sent_at");

-- Consents as given: the text's kind and version, the strategy (0 for account-wide), the typed words.
CREATE TABLE IF NOT EXISTS "algo_consents" (
  "user_id"      text NOT NULL,
  "kind"         text NOT NULL,
  "strategy_id"  integer NOT NULL DEFAULT 0,
  "version"      text NOT NULL,
  "text_hash"    text NOT NULL DEFAULT '',
  "typed"        text,
  "ip"           text,
  "user_agent"   text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "kind", "strategy_id", "version")
);

-- The agent's conversation (the person's messages, its replies and the tool calls with their gates).
CREATE TABLE IF NOT EXISTS "algo_agent_messages" (
  "id"          bigserial PRIMARY KEY,
  "user_id"     text NOT NULL,
  "role"        text NOT NULL,
  "content"     text NOT NULL,
  "calls"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_agent_user_idx" ON "algo_agent_messages" ("user_id", "created_at");

-- The latest backtest of each strategy (and of unsaved specs, by hash), so results reopen without rerunning.
CREATE TABLE IF NOT EXISTS "algo_backtests" (
  "id"           serial PRIMARY KEY,
  "user_id"      text NOT NULL,
  "strategy_id"  integer,
  "spec_hash"    text NOT NULL,
  "result"       jsonb NOT NULL,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_backtests_user_idx" ON "algo_backtests" ("user_id", "strategy_id", "created_at");

-- Every consent, connection, strategy change, decision, order, kill switch and agent call, with payloads.
-- Append-only: the rules turn UPDATE and DELETE into nothing (as copy_audit).
CREATE TABLE IF NOT EXISTS "algo_audit" (
  "id"           bigserial PRIMARY KEY,
  "user_id"      text NOT NULL,
  "actor"        text NOT NULL,
  "action"       text NOT NULL,
  "strategy_id"  integer,
  "batch_id"     integer,
  "order_id"     integer,
  "payload"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "ip"           text,
  "user_agent"   text,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "algo_audit_user_idx" ON "algo_audit" ("user_id", "created_at");

CREATE OR REPLACE RULE "algo_audit_no_update" AS ON UPDATE TO "algo_audit" DO INSTEAD NOTHING;

CREATE OR REPLACE RULE "algo_audit_no_delete" AS ON DELETE TO "algo_audit" DO INSTEAD NOTHING;
