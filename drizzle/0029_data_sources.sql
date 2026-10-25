-- Per-person data sources (docs/data-layer.md, "Free sources & your own keys"): the order a person wants
-- each dataset's sources in, and their own provider keys (Tiingo, Twelve Data, Alpha Vantage, Finnhub,
-- FMP), one row per person.
--
-- `keys_enc` is the person's keys as one AES-256-GCM blob (lib/crm/crypto, keyed by EMAIL_TOKEN_SECRET):
-- never in the clear, decrypted only on the server when a keyed source fetches. `key_meta` holds what the
-- settings page may show without decrypting: per provider the last four characters, the plan type
-- ("individual" | "business"), when it was added and the last test. Data fetched with a key is cached only
-- under the person's own kv_cache partition (byo:v1:<hash>:<provider>:...) and purged with the key.
--
-- One new table, keyed by the person. Safe to run twice. New databases get it from the replay of
-- drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0029_data_sources.sql
CREATE TABLE IF NOT EXISTS "user_data_sources" (
  "user_id"     text PRIMARY KEY NOT NULL,
  "prefs"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "keys_enc"    text NOT NULL DEFAULT '',
  "key_meta"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "user_data_sources_updated_idx" ON "user_data_sources" ("updated_at");
