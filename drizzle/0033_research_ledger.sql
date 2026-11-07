-- The research ledger (src/lib/ledger): an append-only, hash-chained record of what the AI was asked and
-- answered for a person (chat, workflows, red teams, calls from their AI apps over MCP), with the sources,
-- the model and human sign-offs. Kept only for people who turn it on (Settings → Research ledger). Each
-- row's hash is SHA-256 over its content and the previous row's hash, so changing, removing or reordering
-- an entry breaks every hash after it; exports carry the recipe to check that without YouBank.
--
-- One new table; the app treats it as off until it exists. Safe to run twice. New databases get it from
-- the replay of drizzle/*.sql; an existing one with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0033_research_ledger.sql
CREATE TABLE IF NOT EXISTS "research_ledger" (
  "id" bigserial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL CONSTRAINT "research_ledger_user_id_auth_users_id_fk" REFERENCES "auth_users"("id") ON DELETE CASCADE,
  "seq" integer NOT NULL,
  "at" timestamp with time zone NOT NULL,
  "kind" text NOT NULL,
  "subject" text DEFAULT '' NOT NULL,
  "model" text DEFAULT '' NOT NULL,
  "prompt" text DEFAULT '' NOT NULL,
  "output" text DEFAULT '' NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "prev" text DEFAULT '' NOT NULL,
  "hash" text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "research_ledger_user_seq_uidx" ON "research_ledger" ("user_id", "seq");
