-- Crypto: addresses a person reads (their own wallets and wallets they watch), the cost they entered
-- for profit and loss, and documents notarized on chain. New tables only; nothing existing changes.
-- Addresses only: YouBank never stores a private key.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0016_crypto.sql

CREATE TABLE IF NOT EXISTS "crypto_addresses" (
  "id"          serial PRIMARY KEY,
  "user_id"     text NOT NULL,
  "address"     text NOT NULL,
  "kind"        text NOT NULL,
  "label"       text NOT NULL DEFAULT '',
  "role"        text NOT NULL DEFAULT 'own',
  "source"      text NOT NULL DEFAULT 'pasted',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "crypto_addresses_user_addr_uq" ON "crypto_addresses" ("user_id", "address");

CREATE TABLE IF NOT EXISTS "crypto_cost_basis" (
  "user_id"     text NOT NULL,
  "asset"       text NOT NULL,
  "cost_usd"    double precision NOT NULL,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "asset")
);

CREATE TABLE IF NOT EXISTS "crypto_notarizations" (
  "id"               serial PRIMARY KEY,
  "user_id"          text NOT NULL,
  "sha256"           text NOT NULL,
  "subject"          text NOT NULL DEFAULT '',
  "kind"             text NOT NULL DEFAULT 'document',
  "studio_doc_id"    integer,
  "studio_event_id"  bigint,
  "chain"            text NOT NULL DEFAULT 'base',
  "tx_hash"          text NOT NULL,
  "from_address"     text NOT NULL,
  "status"           text NOT NULL DEFAULT 'pending',
  "reason"           text NOT NULL DEFAULT '',
  "block_number"     bigint,
  "confirmed_at"     timestamp with time zone,
  "created_at"       timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "crypto_notarizations_tx_uq" ON "crypto_notarizations" ("chain", "tx_hash");
CREATE INDEX IF NOT EXISTS "crypto_notarizations_user_idx" ON "crypto_notarizations" ("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "crypto_notarizations_sha_idx" ON "crypto_notarizations" ("sha256");
