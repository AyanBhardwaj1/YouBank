-- The seat reassignment cooldown (src/lib/billing/seats.ts). A seat freed on a Deal Team or Enterprise
-- subscription cannot go to a different person for 30 days after it was last given, so one seat cannot hand
-- a fresh AI allowance to a new person every few days. Giving it back to the same person is always allowed.
--
-- `seat_history` keeps one row per seat given, and outlives the assignment: freeing a seat, a member
-- leaving the team and deleting the team (which cascades on `seat_assignments`) all leave it in place, so
-- the cooldown holds however the seat was freed. Rows the webhook trims because the paid seat count went
-- down get `trimmed_at`: those seats stopped being paid for, so they do not cool. New table only; nothing
-- existing is rewritten. Safe to run twice.
--
--   DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0024_seat_cooldown.sql

CREATE TABLE IF NOT EXISTS "seat_history" (
  "id"             serial PRIMARY KEY,
  "owner_user_id"  text NOT NULL,
  "user_id"        text NOT NULL,
  "team_id"        integer,
  "email"          text NOT NULL DEFAULT '',
  "name"           text NOT NULL DEFAULT '',
  "assigned_at"    timestamp with time zone NOT NULL DEFAULT now(),
  "trimmed_at"     timestamp with time zone
);
CREATE INDEX IF NOT EXISTS "seat_history_owner_idx" ON "seat_history" ("owner_user_id", "assigned_at");

-- Seats already given before this migration start their window from when they were given.
INSERT INTO "seat_history" ("owner_user_id", "user_id", "team_id", "email", "name", "assigned_at")
SELECT a."owner_user_id", a."user_id", a."team_id", a."email", a."name", a."assigned_at"
FROM "seat_assignments" a
WHERE NOT EXISTS (
  SELECT 1 FROM "seat_history" h
  WHERE h."owner_user_id" = a."owner_user_id" AND h."user_id" = a."user_id" AND h."assigned_at" = a."assigned_at"
);
