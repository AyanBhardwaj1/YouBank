-- Product analytics (docs/production.md, "Product metrics"): read-only views over tables the app already
-- writes, so activation, retention and per-module use can be measured without an analytics vendor.
-- Nothing new is collected. Read them with `pnpm exec tsx --env-file=.env.local scripts/analytics.mts`.
--
-- analytics_activity:  one row per person, UTC day and module they used themselves: interactive AI
--                      (chat, deep research, desktop ask, tools, Studio), saved tool runs, Studio runs,
--                      email they sent, meetings they started. Background jobs that run as them do not count.
-- analytics_cohorts:   per sign-up week: sign-ups, activated (a saved tool run or Studio run within 24
--                      hours of sign-up), active in days 7–13 (D7) and in days 30–36 (D30) after sign-up.
-- analytics_modules:   per ISO week and module: distinct people.
--
-- Views only. Safe to run twice (CREATE OR REPLACE). Apply with:
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0032_analytics.sql

CREATE OR REPLACE VIEW "analytics_activity" AS
SELECT DISTINCT user_id, day, module FROM (
  -- AI the person asked for. Background work also runs as the person (the nightly agent, autopilot,
  -- newsroom and Edge jobs, transcription), so only interactive features count.
  SELECT user_id, (created_at AT TIME ZONE 'UTC')::date AS day,
    CASE
      WHEN feature LIKE 'tool:%' THEN 'tools'
      WHEN feature LIKE 'studio%' THEN 'studio'
      WHEN feature = 'desktop-ask' THEN 'desktop'
      ELSE 'assistant'
    END AS module
  FROM ai_usage
  WHERE user_id IS NOT NULL
    AND (feature IN ('chat', 'terminal-ai', 'ai.deep-research', 'desktop-ask') OR feature LIKE 'tool:%' OR feature LIKE 'studio%')
  UNION ALL
  SELECT user_id, (created_at AT TIME ZONE 'UTC')::date, 'tools' FROM workflow_runs
  UNION ALL
  SELECT user_id, (started_at AT TIME ZONE 'UTC')::date, 'studio' FROM studio_runs
  UNION ALL
  -- Email the person sent themselves (not autopilot, and not drafts the system set aside).
  SELECT user_id, (sent_at AT TIME ZONE 'UTC')::date, 'relationships' FROM crm_drafts WHERE status = 'sent' AND sent_by = 'you' AND sent_at IS NOT NULL
  UNION ALL
  -- Meetings the person started (an auto-join rule's bot is not them showing up).
  SELECT user_id, (started_at AT TIME ZONE 'UTC')::date, 'meetings' FROM meetings
  WHERE started_at IS NOT NULL AND coalesce(consent->>'auto', 'false') <> 'true'
) a;

CREATE OR REPLACE VIEW "analytics_cohorts" AS
WITH people AS (
  SELECT id AS user_id, created_at, (created_at AT TIME ZONE 'UTC')::date AS signup_day FROM auth_users
),
first_artifact AS (
  SELECT user_id, min(at) AS at FROM (
    SELECT user_id, created_at AS at FROM workflow_runs
    UNION ALL SELECT user_id, started_at FROM studio_runs
  ) x GROUP BY user_id
)
SELECT
  date_trunc('week', p.signup_day)::date AS signup_week,
  count(*)::int AS signups,
  count(*) FILTER (WHERE f.at IS NOT NULL AND f.at <= p.created_at + interval '24 hours')::int AS activated_24h,
  count(*) FILTER (WHERE p.signup_day + 14 <= current_date)::int AS d7_eligible,
  count(*) FILTER (WHERE p.signup_day + 14 <= current_date AND EXISTS (
    SELECT 1 FROM analytics_activity a WHERE a.user_id = p.user_id AND a.day BETWEEN p.signup_day + 7 AND p.signup_day + 13))::int AS d7_active,
  count(*) FILTER (WHERE p.signup_day + 37 <= current_date)::int AS d30_eligible,
  count(*) FILTER (WHERE p.signup_day + 37 <= current_date AND EXISTS (
    SELECT 1 FROM analytics_activity a WHERE a.user_id = p.user_id AND a.day BETWEEN p.signup_day + 30 AND p.signup_day + 36))::int AS d30_active
FROM people p LEFT JOIN first_artifact f ON f.user_id = p.user_id
GROUP BY 1;

CREATE OR REPLACE VIEW "analytics_modules" AS
SELECT date_trunc('week', day)::date AS week, module, count(DISTINCT user_id)::int AS people
FROM analytics_activity GROUP BY 1, 2;
