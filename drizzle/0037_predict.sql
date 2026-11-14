-- Prediction markets (src/lib/predict, docs/prediction-markets.md): markets a person watches for a move,
-- and paper forecasts they record on a market, scored with the Brier score when the market resolves.
-- No market data is stored here: venues are read live through the shared cache.
--
-- Two new tables. Safe to run twice. Applied by the app itself, or by hand with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0037_predict.sql
CREATE TABLE IF NOT EXISTS "predict_watches" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "predict_watches_user_id_auth_users_id_fk" REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "market_key" text NOT NULL,
  "event_id" text DEFAULT '' NOT NULL,
  "venue" text NOT NULL,
  "title" text NOT NULL,
  "url" text DEFAULT '' NOT NULL,
  "threshold" real DEFAULT 0.05 NOT NULL,
  "base_prob" real,
  "last_prob" real,
  "resolved_sent" boolean DEFAULT false NOT NULL,
  "checked_at" timestamp with time zone,
  "alerted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "predict_watches_user_market_uidx" ON "predict_watches" ("user_id", "market_key");
CREATE INDEX IF NOT EXISTS "predict_watches_checked_idx" ON "predict_watches" ("checked_at");

CREATE TABLE IF NOT EXISTS "predict_forecasts" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "predict_forecasts_user_id_auth_users_id_fk" REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "market_key" text NOT NULL,
  "event_id" text DEFAULT '' NOT NULL,
  "venue" text NOT NULL,
  "title" text NOT NULL,
  "url" text DEFAULT '' NOT NULL,
  "p" real NOT NULL,
  "market_p" real,
  "day" date NOT NULL,
  "close_time" timestamp with time zone,
  "outcome" integer,
  "brier" real,
  "market_brier" real,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "predict_forecasts_user_market_day_uidx" ON "predict_forecasts" ("user_id", "market_key", "day");
CREATE INDEX IF NOT EXISTS "predict_forecasts_open_idx" ON "predict_forecasts" ("resolved_at", "market_key");
