-- Edge next (docs/edge-next.md, section 3): the entity crosswalk (F1), the weekly signal store (F2), the
-- forecast ledger (F3), the deal database (F4) and the agent runtime's two tables (F5, used by the Thesis
-- Agent, built next). New tables only: nothing existing changes. Numbered 0020 because 0016 is taken on
-- another branch. Every statement is IF NOT EXISTS, so applying it twice is harmless.
--
-- Size in year one (docs/edge-next.md 5.3): deals and fields about 40 MB, series about 50 MB (kept compact
-- and pruned by series/store.ts), forecasts under 10 MB.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0020_edge_next.sql
-- (first on a Neon branch, then on production with the owner's approval, as 0013 and 0014 were)

-- F1. One company's ids in every scheme Edge reads: SEC CIK and ticker, LEI, domain, Wikidata, Wikipedia,
-- job boards, patent assignee, award recipient. A link below 0.9 confidence waits in review (status
-- 'review') and is not used. A person's confirmation or correction (verified_by) wins over automatic links.
CREATE TABLE IF NOT EXISTS "edge_entity_ids" (
  "id"            serial PRIMARY KEY,
  "node_id"       integer NOT NULL,
  "scheme"        text NOT NULL,
  "value"         text NOT NULL,
  "confidence"    real NOT NULL DEFAULT 1,
  "method"        text NOT NULL DEFAULT '',
  "evidence_url"  text NOT NULL DEFAULT '',
  "status"        text NOT NULL DEFAULT 'active',
  "verified_by"   text NOT NULL DEFAULT '',
  "created_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"    timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "edge_entity_ids_uq" ON "edge_entity_ids" ("scheme", "value");
CREATE INDEX IF NOT EXISTS "edge_entity_ids_node_idx" ON "edge_entity_ids" ("node_id", "scheme");
CREATE INDEX IF NOT EXISTS "edge_entity_ids_review_idx" ON "edge_entity_ids" ("status", "updated_at") WHERE "status" = 'review';

-- F2. Weekly points per company and metric (the period is the week's Monday, or the month's first day for
-- monthly metrics). Rows are kept small: a short source code, no text.
CREATE TABLE IF NOT EXISTS "edge_series" (
  "node_id"       integer NOT NULL,
  "metric"        text NOT NULL,
  "period"        date NOT NULL,
  "value"         double precision NOT NULL,
  "source"        text NOT NULL DEFAULT '',
  "retrieved_at"  timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("node_id", "metric", "period")
);
CREATE INDEX IF NOT EXISTS "edge_series_period_idx" ON "edge_series" ("period");

-- F3. Every probability Edge states about the future, append-only. A new estimate of the same question is
-- a new row that supersedes the old one, and nothing is edited except the resolution columns.
CREATE TABLE IF NOT EXISTS "edge_forecasts" (
  "id"                 bigserial PRIMARY KEY,
  "kind"               text NOT NULL,
  "subject"            text NOT NULL,
  "question"           text NOT NULL,
  "probability"        real NOT NULL,
  "low"                real,
  "high"               real,
  "base_rate"          real,
  "opens_at"           timestamp with time zone NOT NULL,
  "closes_at"          timestamp with time zone NOT NULL,
  "rule"               jsonb NOT NULL,
  "model"              text NOT NULL,
  "model_version"      text NOT NULL,
  "owner_id"           text,
  "supersedes"         bigint,
  "resolved_at"        timestamp with time zone,
  "outcome"            real,
  "resolution_source"  text NOT NULL DEFAULT '',
  "created_at"         timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "edge_forecasts_due_idx" ON "edge_forecasts" ("kind", "closes_at") WHERE "resolved_at" IS NULL;
CREATE INDEX IF NOT EXISTS "edge_forecasts_subject_idx" ON "edge_forecasts" ("subject", "created_at");
CREATE INDEX IF NOT EXISTS "edge_forecasts_resolved_idx" ON "edge_forecasts" ("kind", "resolved_at") WHERE "resolved_at" IS NOT NULL;

-- F4. The deal database (E1, the Precedent Engine). `key` deduplicates (the target's CIK, or its name for a
-- private target, with the announcement month). owner_id and team_id stay null for public deals: they are
-- there for the private precedent library (premium, later).
CREATE TABLE IF NOT EXISTS "edge_deals" (
  "id"                  serial PRIMARY KEY,
  "key"                 text NOT NULL,
  "kind"                text NOT NULL DEFAULT 'acquisition',
  "status"              text NOT NULL DEFAULT 'announced',
  "announced_at"        date,
  "signed_at"           date,
  "closed_at"           date,
  "acquirer_node"       integer,
  "target_node"         integer,
  "acquirer_name"       text NOT NULL DEFAULT '',
  "target_name"         text NOT NULL DEFAULT '',
  "acquirer_cik"        text NOT NULL DEFAULT '',
  "target_cik"          text NOT NULL DEFAULT '',
  "target_ticker"       text NOT NULL DEFAULT '',
  "buyer_type"          text NOT NULL DEFAULT '',
  "sic"                 text NOT NULL DEFAULT '',
  "naics"               text NOT NULL DEFAULT '',
  "country"             text NOT NULL DEFAULT 'US',
  "equity_usd_mm"       real,
  "ev_usd_mm"           real,
  "ev_revenue"          real,
  "ev_ebitda"           real,
  "premium_1d"          real,
  "premium_unaffected"  real,
  "consideration"       text NOT NULL DEFAULT '',
  "outcome"             text NOT NULL DEFAULT '',
  "news_cluster_id"     integer,
  "sources"             jsonb NOT NULL DEFAULT '[]'::jsonb,
  "embedding"           halfvec(512),
  "owner_id"            text,
  "team_id"             integer,
  "extracted_at"        timestamp with time zone,
  "created_at"          timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"          timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "edge_deals_key_uq" ON "edge_deals" ("key");
CREATE INDEX IF NOT EXISTS "edge_deals_target_idx" ON "edge_deals" ("target_node", "announced_at");
CREATE INDEX IF NOT EXISTS "edge_deals_acquirer_idx" ON "edge_deals" ("acquirer_node", "announced_at");
CREATE INDEX IF NOT EXISTS "edge_deals_sic_idx" ON "edge_deals" ("sic", "announced_at");

-- Each extracted field with its verbatim quote, document, section, checks and calibrated confidence. A
-- re-read adds rows and retires the old ones (active = false), so the audit trail keeps both.
CREATE TABLE IF NOT EXISTS "edge_deal_fields" (
  "id"             bigserial PRIMARY KEY,
  "deal_id"        integer NOT NULL,
  "field"          text NOT NULL,
  "value"          jsonb NOT NULL,
  "quote"          text NOT NULL DEFAULT '',
  "doc_url"        text NOT NULL DEFAULT '',
  "section"        text NOT NULL DEFAULT '',
  "confidence"     real NOT NULL DEFAULT 0.5,
  "checks"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "method"         text NOT NULL DEFAULT '',
  "model_version"  text NOT NULL DEFAULT '',
  "verified_by"    text NOT NULL DEFAULT '',
  "active"         boolean NOT NULL DEFAULT true,
  "created_at"     timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "edge_deal_fields_deal_idx" ON "edge_deal_fields" ("deal_id", "field") WHERE "active";

-- F5. The agent runtime (E7, the Thesis Agent, built by the next round of work on this branch).
CREATE TABLE IF NOT EXISTS "edge_agents" (
  "id"           serial PRIMARY KEY,
  "owner_id"     text NOT NULL,
  "team_id"      integer,
  "title"        text NOT NULL,
  "thesis"       text NOT NULL,
  "status"       text NOT NULL DEFAULT 'planning',
  "horizon_end"  date,
  "budget_usd"   real NOT NULL DEFAULT 0,
  "spent_usd"    real NOT NULL DEFAULT 0,
  "model"        text NOT NULL DEFAULT '',
  "cadence"      text NOT NULL DEFAULT 'daily',
  "canvas_ids"   jsonb NOT NULL DEFAULT '[]'::jsonb,
  "memo"         jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at"   timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at"   timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "edge_agents_owner_idx" ON "edge_agents" ("owner_id", "status");

CREATE TABLE IF NOT EXISTS "edge_agent_steps" (
  "id"          bigserial PRIMARY KEY,
  "agent_id"    integer NOT NULL,
  "day"         date NOT NULL,
  "kind"        text NOT NULL,
  "tool"        text NOT NULL DEFAULT '',
  "input"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "output"      jsonb NOT NULL DEFAULT '{}'::jsonb,
  "cost"        jsonb NOT NULL DEFAULT '{}'::jsonb,
  "error"       text NOT NULL DEFAULT '',
  "created_at"  timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "edge_agent_steps_agent_idx" ON "edge_agent_steps" ("agent_id", "id");

-- Where long background jobs have got to (the deal backfill's cursor, the weekly Pulse's position, the
-- Deal Radar's last scoring), so a job resumes where it stopped and an administrator can switch it.
CREATE TABLE IF NOT EXISTS "edge_job_state" (
  "name"        text PRIMARY KEY,
  "state"       jsonb NOT NULL DEFAULT '{}'::jsonb,
  "updated_at"  timestamp with time zone NOT NULL DEFAULT now()
);
