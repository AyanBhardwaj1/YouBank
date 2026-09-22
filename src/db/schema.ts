import { doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type MemberJson = { ticker: string; tier: "core" | "adjacent"; rationale: string };

/** Saved peer groups (user-created or saved from an AI proposal). */
export const peerGroups = pgTable("peer_groups", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull().default("analyst"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const peerGroupMembers = pgTable("peer_group_members", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => peerGroups.id, { onDelete: "cascade" }),
  ticker: text("ticker").notNull(),
  tier: text("tier").notNull().default("core"),
  rationale: text("rationale").notNull().default(""),
  position: integer("position").notNull().default(0),
}, (t) => [index("peer_group_members_group_idx").on(t.groupId)]);

/** A saved comps sheet: target, member snapshot, view state, and the computed rows at save time for audit. */
export const compsSheets = pgTable("comps_sheets", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  targetTicker: text("target_ticker").notNull(),
  members: jsonb("members").$type<MemberJson[]>().notNull(),
  excluded: jsonb("excluded").$type<string[]>().notNull().default([]),
  columnSet: text("column_set").notNull().default("all"),
  sort: jsonb("sort").$type<{ key: string; dir: 1 | -1 } | null>(),
  snapshot: jsonb("snapshot").$type<unknown>(),
  createdBy: text("created_by").notNull().default("analyst"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("comps_sheets_target_idx").on(t.targetTicker), index("comps_sheets_user_idx").on(t.userId)]);

/** Manual overrides (NTM estimates etc.). Append-only; latest row per (ticker, field) wins. USD millions. */
export const manualInputs = pgTable("manual_inputs", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  ticker: text("ticker").notNull(),
  field: text("field").notNull(), // ntm_revenue | ntm_ebitda
  value: doublePrecision("value"),
  note: text("note").notNull().default(""),
  enteredBy: text("entered_by").notNull().default("analyst"),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("manual_inputs_ticker_field_idx").on(t.ticker, t.field)]);

/** Footnotes attached to a sheet (AI-drafted or user-written), with an optional citation. */
export const footnotes = pgTable("footnotes", {
  id: serial("id").primaryKey(),
  sheetId: integer("sheet_id").notNull().references(() => compsSheets.id, { onDelete: "cascade" }),
  ticker: text("ticker"),
  column: text("column"),
  text: text("text").notNull(),
  source: text("source").notNull().default("user"), // user | ai
  citation: text("citation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ---------------- Users, profiles, and caches ---------------- */

/** Onboarding survey answers, one row per Neon Auth user. */
export const profiles = pgTable("profiles", {
  userId: text("user_id").primaryKey(),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  role: text("role").notNull(), // banker | corpfin | consultant | accountant | student | vc
  specialty: text("specialty").notNull().default(""),
  seniority: text("seniority").notNull().default(""),
  firmType: text("firm_type").notNull().default(""),
  firmName: text("firm_name").notNull().default(""),
  firmTicker: text("firm_ticker").notNull().default(""),
  sectors: jsonb("sectors").$type<string[]>().notNull().default([]),
  goals: text("goals").notNull().default(""),
  extra: jsonb("extra").$type<Record<string, unknown>>().notNull().default({}),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Generic JSON cache for serverless hosts where the filesystem is not writable (ticker map, filing text, FMP profiles). */
export const kvCache = pgTable("kv_cache", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/** Assembled company records, cached to avoid re-parsing multi-megabyte XBRL facts on every request. */
export const companyCache = pgTable("company_cache", {
  ticker: text("ticker").primaryKey(),
  data: jsonb("data").$type<unknown>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Unified startup directory across sources: yc | a16z | thiel | hn | formd | web | user. */
export const startups = pgTable("startups", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  name: text("name").notNull(),
  oneLiner: text("one_liner").notNull().default(""),
  description: text("description").notNull().default(""),
  website: text("website").notNull().default(""),
  url: text("url").notNull().default(""),
  logo: text("logo").notNull().default(""),
  program: text("program").notNull().default(""),
  status: text("status").notNull().default(""),
  foundedYear: integer("founded_year"),
  founders: text("founders").notNull().default(""),
  location: text("location").notNull().default(""),
  country: text("country").notNull().default(""),
  industries: jsonb("industries").$type<string[]>().notNull().default([]),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  teamSize: integer("team_size"),
  fundingStage: text("funding_stage").notNull().default(""),
  investors: jsonb("investors").$type<string[]>().notNull().default([]),
  raised: text("raised").notNull().default(""),
  raisedUsd: doublePrecision("raised_usd"),
  isHiring: integer("is_hiring").notNull().default(0),
  sourceDate: text("source_date").notNull().default(""),
  data: jsonb("data").$type<unknown>(),
  syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("startups_source_uidx").on(t.source, t.sourceId),
  index("startups_name_idx").on(t.name), index("startups_source_idx").on(t.source), index("startups_country_idx").on(t.country),
  index("startups_program_idx").on(t.program), index("startups_date_idx").on(t.sourceDate),
]);


/* ---------------- Workflow runs and uploaded documents ---------------- */

/** One execution of an AI workflow or calculator: inputs, structured output, sources, and the model used. */
export const workflowRuns = pgTable("workflow_runs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  toolId: text("tool_id").notNull(),
  title: text("title").notNull().default(""),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<unknown>(),
  sources: jsonb("sources").$type<{ id: string; label: string; url: string }[]>().notNull().default([]),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  status: text("status").notNull().default("done"), // done | error
  error: text("error").notNull().default(""),
  durationMs: integer("duration_ms").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("workflow_runs_user_idx").on(t.userId, t.createdAt), index("workflow_runs_tool_idx").on(t.toolId)]);

/** Pasted or uploaded text data (CSV exports, trial balances, budgets) reused across workflows. */
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("csv"),
  content: text("content").notNull(),
  bytes: integer("bytes").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("documents_user_idx").on(t.userId, t.createdAt)]);

/* ---------------- Teams ---------------- */

/**
 * A team is a shared workspace: membership, roles and invitations.
 *
 * These are all new tables, so the feature can ship without altering any existing one. Sharing a
 * specific resource with a team adds a nullable `team_id` to that resource's table when the feature
 * that shares it lands.
 */
export const teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("teams_slug_uidx").on(t.slug)]);

/** Membership and role. Email and name are denormalized so a member list renders without an auth lookup. */
export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("member"), // owner | admin | member | viewer
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("team_members_team_user_uidx").on(t.teamId, t.userId),
  index("team_members_user_idx").on(t.userId),
]);

/** Pending invitations, addressed to an email and redeemed with a single-use token. */
export const teamInvites = pgTable("team_invites", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: text("role").notNull().default("member"),
  token: text("token").notNull(),
  invitedBy: text("invited_by").notNull().default(""),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("team_invites_token_uidx").on(t.token),
  uniqueIndex("team_invites_team_email_uidx").on(t.teamId, t.email),
  index("team_invites_email_idx").on(t.email),
]);
