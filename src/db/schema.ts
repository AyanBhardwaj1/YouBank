import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, customType, date, doublePrecision, halfvec, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export type MemberJson = { ticker: string; tier: "core" | "adjacent"; rationale: string };

/* ---------------- Sign-in (Better Auth, src/lib/auth/server.ts) ---------------- */

/** People who have signed in. Every `user_id` in the app is one of these ids. */
export const authUsers = pgTable("auth_users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
}, (t) => [index("auth_sessions_user_idx").on(t.userId)]);

/** How each person signs in (Google today). OAuth tokens are stored encrypted. */
export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_accounts_user_idx").on(t.userId)]);

/** Short-lived values: the OAuth state while someone is away at Google. */
export const authVerifications = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_verifications_identifier_idx").on(t.identifier)]);

/** Saved peer groups (user-created or saved from an AI proposal). */
export const peerGroups = pgTable("peer_groups", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull().default("analyst"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("peer_groups_user_idx").on(t.userId)]);

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
}, (t) => [index("kv_cache_expires_idx").on(t.expiresAt)]);

/**
 * Per-minute rollups of upstream data-source calls (drizzle/0028_source_stats.sql, src/lib/market/stats.ts):
 * counts, a latency histogram (b100 … b_inf, in ms) and failures by kind, per source and operation.
 */
export const sourceStats = pgTable("source_stats", {
  minute: timestamp("minute", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  op: text("op").notNull(),
  calls: integer("calls").notNull().default(0),
  failures: integer("failures").notNull().default(0),
  fallbacks: integer("fallbacks").notNull().default(0),
  hedges: integer("hedges").notNull().default(0),
  sumMs: bigint("sum_ms", { mode: "number" }).notNull().default(0),
  maxMs: integer("max_ms").notNull().default(0),
  b100: integer("b100").notNull().default(0),
  b250: integer("b250").notNull().default(0),
  b500: integer("b500").notNull().default(0),
  b1000: integer("b1000").notNull().default(0),
  b2500: integer("b2500").notNull().default(0),
  b5000: integer("b5000").notNull().default(0),
  b10000: integer("b10000").notNull().default(0),
  bInf: integer("b_inf").notNull().default(0),
  kTimeout: integer("k_timeout").notNull().default(0),
  kNetwork: integer("k_network").notNull().default(0),
  kHttp: integer("k_http").notNull().default(0),
  kRateLimit: integer("k_rate_limit").notNull().default(0),
  kSchema: integer("k_schema").notNull().default(0),
  kEmpty: integer("k_empty").notNull().default(0),
  kSkipped: integer("k_skipped").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.minute, t.source, t.op], name: "source_stats_minute_source_op_pk" }), index("source_stats_minute_idx").on(t.minute)]);

/** Per-provider key facts the settings page shows without decrypting (drizzle/0029_data_sources.sql). */
export type DataKeyMeta = { last4: string; plan: "individual" | "business"; addedAt: string; lastTest?: { ok: boolean; at: string; ms: number } };

/**
 * A person's data sources (drizzle/0029_data_sources.sql, src/lib/market/byo/store.ts): their order per
 * dataset, and their own provider keys as one encrypted blob (never in the clear), with what may be shown.
 */
export const userDataSources = pgTable("user_data_sources", {
  userId: text("user_id").primaryKey(),
  prefs: jsonb("prefs").$type<{ order?: Record<string, string[]> }>().notNull().default({}),
  keysEnc: text("keys_enc").notNull().default(""),
  keyMeta: jsonb("key_meta").$type<Record<string, DataKeyMeta>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("user_data_sources_updated_idx").on(t.updatedAt)]);

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

/* ---------------- CRM and the email agent ---------------- */

export type EmailAddress = { name: string; address: string };

/**
 * A connected mailbox.
 *
 * Tokens are stored encrypted (see src/lib/crm/crypto.ts); nothing here is readable from a database
 * dump alone. `teamId` null means the mailbox is personal, which is the only supported case today:
 * a shared mailbox would let one member read another's mail, so it is deliberately not offered yet.
 */
export const emailAccounts = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  provider: text("provider").notNull().default("gmail"),
  address: text("address").notNull(),
  displayName: text("display_name").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  cursor: text("cursor").notNull().default(""),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("connected"), // connected | needs_reauth | disconnected
  /** For IMAP/SMTP mailboxes: hosts, ports and user name. Never the password. */
  settings: jsonb("settings").$type<{ imapHost?: string; imapPort?: number; imapSecure?: boolean; smtpHost?: string; smtpPort?: number; smtpSecure?: boolean; username?: string; preset?: string }>().notNull().default({}),
  /** For IMAP/SMTP mailboxes: the app password, encrypted like the OAuth tokens. */
  secret: text("secret").notNull().default(""),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastError: text("last_error").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("email_accounts_user_address_uidx").on(t.userId, t.address), index("email_accounts_user_idx").on(t.userId)]);

/** A person. Linked to the startup directory when the agent can identify their company. */
export const crmContacts = pgTable("crm_contacts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  title: text("title").notNull().default(""),
  company: text("company").notNull().default(""),
  domain: text("domain").notNull().default(""),
  startupId: integer("startup_id"),
  kind: text("kind").notNull().default("unknown"), // founder | investor | lp | banker | operator | other
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  /** Set when they asked not to be contacted. Nurture and campaigns never write to them again. */
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crm_contacts_user_email_uidx").on(t.userId, t.email),
  index("crm_contacts_team_idx").on(t.teamId),
  index("crm_contacts_domain_idx").on(t.domain),
  // drizzle/0027_scale.sql: contacts most recently seen first.
  index("crm_contacts_user_seen_idx").on(t.userId, t.lastSeenAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
]);

/** A pipeline item: one company moving through the stages of a desk's process. */
export const crmDeals = pgTable("crm_deals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  name: text("name").notNull(),
  stage: text("stage").notNull().default("inbox"),
  startupId: integer("startup_id"),
  contactId: integer("contact_id"),
  sector: text("sector").notNull().default(""),
  round: text("round").notNull().default(""),
  amountUsd: doublePrecision("amount_usd"),
  valuationUsd: doublePrecision("valuation_usd"),
  source: text("source").notNull().default("manual"), // inbound_email | directory | manual
  nextStep: text("next_step").notNull().default(""),
  nextStepDue: timestamp("next_step_due", { withTimezone: true }),
  status: text("status").notNull().default("open"), // open | won | lost | parked
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("crm_deals_user_stage_idx").on(t.userId, t.stage),
  index("crm_deals_team_idx").on(t.teamId),
  index("crm_deals_contact_idx").on(t.contactId),
  // drizzle/0027_scale.sql: the pipeline newest first, paged by (updated_at, id).
  index("crm_deals_user_updated_idx").on(t.userId, t.updatedAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
]);

/** An email thread the agent has read, with its triage verdict. */
export const crmThreads = pgTable("crm_threads", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  accountId: integer("account_id"),
  providerThreadId: text("provider_thread_id").notNull(),
  subject: text("subject").notNull().default(""),
  snippet: text("snippet").notNull().default(""),
  participants: jsonb("participants").$type<EmailAddress[]>().notNull().default([]),
  contactId: integer("contact_id"),
  dealId: integer("deal_id"),
  category: text("category").notNull().default("other"),
  priority: text("priority").notNull().default("medium"), // high | medium | low
  summary: text("summary").notNull().default(""),
  needsReply: boolean("needs_reply").notNull().default(false),
  triagedAt: timestamp("triaged_at", { withTimezone: true }),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crm_threads_user_provider_uidx").on(t.userId, t.providerThreadId),
  index("crm_threads_user_recent_idx").on(t.userId, t.lastMessageAt),
  index("crm_threads_deal_idx").on(t.dealId),
  // drizzle/0027_scale.sql: the "needs a reply" count.
  index("crm_threads_user_needs_reply_idx").on(t.userId).where(sql`needs_reply`),
]);

/** One message within a thread. Bodies are stored as plain text. */
export const crmMessages = pgTable("crm_messages", {
  id: serial("id").primaryKey(),
  threadId: integer("thread_id").notNull().references(() => crmThreads.id, { onDelete: "cascade" }),
  providerMessageId: text("provider_message_id").notNull().default(""),
  direction: text("direction").notNull().default("inbound"), // inbound | outbound
  fromName: text("from_name").notNull().default(""),
  fromAddress: text("from_address").notNull().default(""),
  toAddresses: jsonb("to_addresses").$type<EmailAddress[]>().notNull().default([]),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  /** The RFC 5322 Message-ID and In-Reply-To, which is how replies are threaded across providers. */
  rfcMessageId: text("rfc_message_id").notNull().default(""),
  inReplyTo: text("in_reply_to").notNull().default(""),
  /** Machine-sent: an auto-reply, a mailing list, a no-reply sender. Never answered automatically. */
  automated: boolean("automated").notNull().default(false),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  /** Topics the email raised (and, for inbound, what the sender showed they know or asked about); null until tagged. */
  topics: jsonb("topics").$type<MessageTopics>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_messages_thread_idx").on(t.threadId, t.sentAt), index("crm_messages_rfc_idx").on(t.rfcMessageId)]);

export type MessageTopics = { topics: string[]; knows?: string[]; asks?: string[] };

/**
 * A reply the agent has written, waiting for a person.
 *
 * Nothing in this table is ever sent automatically. A draft leaves here only when someone approves
 * it, and the body that goes out is whatever the reviewer last saved.
 */
export const crmDrafts = pgTable("crm_drafts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  threadId: integer("thread_id").references(() => crmThreads.id, { onDelete: "cascade" }),
  dealId: integer("deal_id"),
  toAddresses: jsonb("to_addresses").$type<EmailAddress[]>().notNull().default([]),
  subject: text("subject").notNull().default(""),
  body: text("body").notNull().default(""),
  rationale: text("rationale").notNull().default(""),
  citations: jsonb("citations").$type<{ label: string; url: string }[]>().notNull().default([]),
  status: text("status").notNull().default("pending"), // pending | sent | discarded
  kind: text("kind").notNull().default("reply"), // reply | follow_up | nurture | campaign
  contactId: integer("contact_id"),
  campaignLeadId: integer("campaign_lead_id"),
  /** Which step of a campaign, which nurture rule, which signal: whatever produced it. */
  meta: jsonb("meta").$type<{ step?: number; ruleId?: number; signalId?: number; actionId?: number; audience?: string; category?: string; ticker?: string; path?: string[]; meetingId?: number }>().notNull().default({}),
  /** Set when autopilot will send it: the time it goes, unless someone stops it first. */
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
  /** Why autopilot handed it to a person instead of sending, in plain words. */
  holdReason: text("hold_reason").notNull().default(""),
  confidence: text("confidence").notNull().default(""), // high | medium | low
  sensitive: boolean("sensitive").notNull().default(false),
  /** The message this answers, so a newer one arriving first can be noticed before sending. */
  replyToMessageId: integer("reply_to_message_id"),
  sentBy: text("sent_by").notNull().default(""), // you | autopilot
  lastError: text("last_error").notNull().default(""),
  attempts: integer("attempts").notNull().default(0),
  /** The text as the agent wrote it, before anyone edited it. What the engine learns from. */
  originalBody: text("original_body").notNull().default(""),
  /** The outreach choices the engine made for this email, e.g. "angle:question;hour:morning". */
  variant: text("variant").notNull().default(""),
  /** Its outcome has been counted by the adaptive engine, so it is never counted twice. */
  learned: boolean("learned").notNull().default(false),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
}, (t) => [
  index("crm_drafts_user_status_idx").on(t.userId, t.status),
  index("crm_drafts_thread_idx").on(t.threadId),
  index("crm_drafts_lead_idx").on(t.campaignLeadId),
  index("crm_drafts_scheduled_idx").on(t.userId, t.scheduledFor),
  // The platform-wide "contacted in the last 30 days" check on campaign first touches.
  index("crm_drafts_campaign_sent_idx").on(t.sentAt).where(sql`kind = 'campaign' and status = 'sent'`),
]);

/**
 * Something the agent could not answer on its own: a price, a date, whether to agree. It waits here
 * for the person, and the answer is used to finish the draft (and, if asked, remembered).
 */
export const crmQuestions = pgTable("crm_questions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  draftId: integer("draft_id"),
  threadId: integer("thread_id"),
  question: text("question").notNull(),
  context: text("context").notNull().default(""),
  answer: text("answer").notNull().default(""),
  status: text("status").notNull().default("open"), // open | answered | dismissed
  remember: boolean("remember").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
}, (t) => [index("crm_questions_user_status_idx").on(t.userId, t.status)]);

/* ---------------- The adaptive engine ---------------- */

/**
 * Earned autonomy: for each kind of email (bucket, e.g. "reply:external:high"), a Beta posterior over
 * the chance the person sends the agent's draft unchanged. Autopilot is held where it is low and
 * suggested where it is proven.
 */
export const crmTrust = pgTable("crm_trust", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  bucket: text("bucket").notNull(),
  /** Good and bad labels, decayed with a 90-day half-life. Certification uses a flat prior on these. */
  good: doublePrecision("good").notNull().default(0),
  bad: doublePrecision("bad").notNull().default(0),
  observations: integer("observations").notNull().default(0),
  unchanged: integer("unchanged").notNull().default(0),
  /** Anytime-valid evidence that the bad rate exceeds 10%; demotes at 20. */
  eprocess: doublePrecision("eprocess").notNull().default(1),
  /** Consecutive automatic sends the person stopped during the hold. */
  cancelStreak: integer("cancel_streak").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_trust_user_bucket_uidx").on(t.userId, t.bucket)]);

/** Outreach experiments: one Beta-Bernoulli arm per choice (an opening angle, a send hour), rewarded by replies. */
export const crmArms = pgTable("crm_arms", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  dimension: text("dimension").notNull(), // angle | hour
  arm: text("arm").notNull(),
  /** Settled sends, positive replies and negative replies (opt-outs), decayed with a 90-day half-life. */
  pulls: doublePrecision("pulls").notNull().default(0),
  rewards: doublePrecision("rewards").notNull().default(0),
  negatives: doublePrecision("negatives").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("crm_arms_user_dim_arm_uidx").on(t.userId, t.dimension, t.arm)]);

/** Rules inferred from how the person edits drafts. Applied to every later draft in the same context. */
export const crmLessons = pgTable("crm_lessons", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  context: text("context").notNull().default("any"), // e.g. reply:external, campaign, any
  rule: text("rule").notNull(),
  evidence: integer("evidence").notNull().default(1),
  /** A lesson applies once seen twice, or once the person confirms it. */
  confirmed: boolean("confirmed").notNull().default(false),
  active: boolean("active").notNull().default(true),
  sourceDraftId: integer("source_draft_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_lessons_user_idx").on(t.userId, t.active)]);

/** Every signal the engine learned from, for audit and offline evaluation. */
export const crmLearningEvents = pgTable("crm_learning_events", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  draftId: integer("draft_id"),
  loop: text("loop").notNull(), // trust | arm | lesson
  key: text("key").notNull().default(""), // the bucket, arm or lesson it touched
  outcome: text("outcome").notNull(), // unchanged | edited | rewritten | discarded | replied | no_reply | learned
  editRatio: doublePrecision("edit_ratio"),
  reward: doublePrecision("reward"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_learning_events_user_idx").on(t.userId, t.createdAt)]);

/** What the agent has been taught: questions it will meet again, and the person's answers. */
export const crmPlaybook = pgTable("crm_playbook", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  question: text("question").notNull(),
  answer: text("answer").notNull(),
  source: text("source").notNull().default("you"), // you | answered
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_playbook_user_idx").on(t.userId)]);

/* ---------------- The agent's standing orders, nurture, campaigns ---------------- */

/**
 * How the agent should work for this person: standing instructions, reference knowledge about their
 * firm, and a description of their writing voice. All three go into every prompt that writes.
 */
export const crmSettings = pgTable("crm_settings", {
  userId: text("user_id").primaryKey(),
  instructions: text("instructions").notNull().default(""),
  knowledge: text("knowledge").notNull().default(""),
  voice: text("voice").notNull().default(""),
  followUpDays: integer("follow_up_days").notNull().default(5),
  staleDealDays: integer("stale_deal_days").notNull().default(21),
  /** Let the nightly run prepare drafts and suggestions. It never sends. */
  nightly: boolean("nightly").notNull().default(true),
  /** deals | sales, or "" to follow the person's profile. */
  mode: text("mode").notNull().default(""),
  /** Who the reader is and what they are selling or doing, in their words. Beats the profile persona. */
  about: text("about").notNull().default(""),
  /** Added to every email sent from YouBank. Mail sent through an API gets no client signature. */
  signature: text("signature").notNull().default(""),
  /** Email domains that count as coworkers. Empty means the connected mailbox's own domain. */
  internalDomains: jsonb("internal_domains").$type<string[]>().notNull().default([]),
  /** See AutopilotSettings. Normalized on every read. */
  autopilot: jsonb("autopilot").$type<Record<string, unknown>>().notNull().default({}),
  /** Held while a scheduled pass works on this person's mail, so two passes never overlap. */
  lockUntil: timestamp("lock_until", { withTimezone: true }),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A suggested change for a person to approve: move a deal, follow up, check in, reconnect.
 *
 * `dedupeKey` is unique per user, so re-scanning never repeats a suggestion, including one that was
 * dismissed.
 */
export const crmActions = pgTable("crm_actions", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // move_stage | follow_up | check_in | reconnect
  status: text("status").notNull().default("pending"), // pending | done | dismissed
  title: text("title").notNull(),
  reasoning: text("reasoning").notNull().default(""),
  uncertainties: jsonb("uncertainties").$type<string[]>().notNull().default([]),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  dedupeKey: text("dedupe_key").notNull(),
  contactId: integer("contact_id"),
  dealId: integer("deal_id"),
  threadId: integer("thread_id"),
  draftId: integer("draft_id"),
  /** The meeting a suggestion came from (a change a participant stated, a new person to add). */
  meetingId: integer("meeting_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("crm_actions_user_dedupe_uidx").on(t.userId, t.dedupeKey),
  index("crm_actions_user_status_idx").on(t.userId, t.status),
  index("crm_actions_meeting_idx").on(t.meetingId),
]);

/** Something that happened to a contact's company, found in YouBank's own data (a Form D, for now). */
export const crmSignals = pgTable("crm_signals", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  contactId: integer("contact_id"),
  dealId: integer("deal_id"),
  kind: text("kind").notNull().default("funding"),
  sourceKey: text("source_key").notNull(), // e.g. the Form D accession
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  url: text("url").notNull().default(""),
  strength: text("strength").notNull().default("name"), // officer | name
  occurredAt: timestamp("occurred_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("crm_signals_user_contact_source_uidx").on(t.userId, t.contactId, t.sourceKey),
  // drizzle/0027_scale.sql: a deal's signal (no contact) once per source.
  uniqueIndex("crm_signals_user_deal_source_uidx").on(t.userId, t.dealId, t.sourceKey).where(sql`contact_id is null and deal_id is not null`),
  index("crm_signals_user_idx").on(t.userId, t.createdAt),
]);

/** Reactivate relationships that have gone quiet. */
export const crmNurtureRules = pgTable("crm_nurture_rules", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  cadenceDays: integer("cadence_days").notNull().default(180),
  anchor: text("anchor").notNull().default("last_sent"), // last_sent | last_contact
  kinds: jsonb("kinds").$type<string[]>().notNull().default([]), // contact kinds; empty is everyone
  minExchanges: integer("min_exchanges").notNull().default(2),
  dailyCap: integer("daily_cap").notNull().default(5),
  instructions: text("instructions").notNull().default(""),
  sendMode: text("send_mode").notNull().default("default"), // default | approve | auto
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_nurture_rules_user_idx").on(t.userId)]);

/** Every nurture decision, drafted or skipped, with the reason. Also what enforces cadence and the daily cap. */
export const crmNurtureLog = pgTable("crm_nurture_log", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  ruleId: integer("rule_id").notNull().references(() => crmNurtureRules.id, { onDelete: "cascade" }),
  contactId: integer("contact_id").notNull(),
  outcome: text("outcome").notNull(), // drafted | skipped
  reason: text("reason").notNull().default(""),
  draftId: integer("draft_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_nurture_log_rule_idx").on(t.ruleId, t.createdAt), index("crm_nurture_log_contact_idx").on(t.userId, t.contactId)]);

/** An outbound sequence to a qualified list. */
export const crmCampaigns = pgTable("crm_campaigns", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft | active | paused | done
  goal: text("goal").notNull().default(""),
  icp: text("icp").notNull().default(""),
  instructions: text("instructions").notNull().default(""),
  steps: jsonb("steps").$type<{ dayOffset: number; instruction: string }[]>().notNull().default([]),
  dailyCap: integer("daily_cap").notNull().default(10),
  sendMode: text("send_mode").notNull().default("default"), // default | approve | auto
  /** The person confirms they have consent or another lawful basis to cold-email EU and Canadian recipients. */
  consentRegions: boolean("consent_regions").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_campaigns_user_idx").on(t.userId)]);

/** A person in a campaign and where they are in it. */
export const crmCampaignLeads = pgTable("crm_campaign_leads", {
  id: serial("id").primaryKey(),
  campaignId: integer("campaign_id").notNull().references(() => crmCampaigns.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  contactId: integer("contact_id"),
  startupId: integer("startup_id"),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  company: text("company").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("sourced"),
  fit: integer("fit"),
  fitReason: text("fit_reason").notNull().default(""),
  step: integer("step").notNull().default(0), // the next step to send
  nextDueAt: timestamp("next_due_at", { withTimezone: true }),
  lastSentAt: timestamp("last_sent_at", { withTimezone: true }),
  repliedAt: timestamp("replied_at", { withTimezone: true }),
  repliedAtStep: integer("replied_at_step"),
  threadId: integer("thread_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("crm_campaign_leads_campaign_idx").on(t.campaignId, t.status),
  index("crm_campaign_leads_user_email_idx").on(t.userId, t.email),
]);

/* ---------------- Live collaboration ---------------- */

/**
 * A shared working session: two or more people on the same tool run.
 *
 * `state` is the shared input set. Vercel cannot hold a WebSocket open, so clients poll an
 * append-only event log over SSE and resume from the last id they saw.
 */
export const collabSessions = pgTable("collab_sessions", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id"),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull().default("tool"),
  refId: text("ref_id").notNull().default(""),
  title: text("title").notNull().default(""),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("open"), // open | closed
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("collab_sessions_team_idx").on(t.teamId), index("collab_sessions_owner_idx").on(t.ownerId)]);

/**
 * Append-only log. The serial id doubles as the sequence number a reconnecting client resumes from,
 * which is what makes an SSE connection that Vercel cuts off after a minute survivable.
 */
export const collabEvents = pgTable("collab_events", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => collabSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull().default(""),
  kind: text("kind").notNull(), // patch | join | leave | note | output
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("collab_events_session_idx").on(t.sessionId, t.id)]);

/** Who is in a session right now. A row older than the liveness window counts as gone. */
export const collabPresence = pgTable("collab_presence", {
  id: serial("id").primaryKey(),
  sessionId: integer("session_id").notNull().references(() => collabSessions.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  name: text("name").notNull().default(""),
  field: text("field").notNull().default(""),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("collab_presence_session_user_uidx").on(t.sessionId, t.userId)]);

/* ---------------- Studio: live models and decks ---------------- */

/**
 * A workbook and its deck, edited live by people and the agent. Stored whole as JSON: edits are
 * patches applied with single atomic jsonb updates, and every patch is also appended to studio_events.
 */
export const studioDocs = pgTable("studio_docs", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  teamId: integer("team_id"),
  title: text("title").notNull().default("Untitled model"),
  kind: text("kind").notNull().default("blank"),
  ticker: text("ticker").notNull().default(""),
  workbook: jsonb("workbook").$type<import("@/lib/studio/types").Workbook>().notNull(),
  deck: jsonb("deck").$type<import("@/lib/studio/types").Deck>().notNull(),
  comments: jsonb("comments").$type<import("@/lib/studio/types").StudioComment[]>().notNull().default([]),
  /** What an uploaded file contained and what could not be kept (macros, charts, unsupported functions). */
  intake: jsonb("intake").$type<Record<string, unknown> | null>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("studio_docs_owner_idx").on(t.ownerId, t.updatedAt), index("studio_docs_team_idx").on(t.teamId)]);

/** Every change, in order, with the patches that undo it. The serial id is the stream cursor. */
export const studioEvents = pgTable("studio_events", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => studioDocs.id, { onDelete: "cascade" }),
  actor: text("actor").notNull(),
  actorName: text("actor_name").notNull().default(""),
  runId: text("run_id").notNull().default(""),
  label: text("label").notNull().default(""),
  patches: jsonb("patches").$type<unknown[]>().notNull(),
  undo: jsonb("undo").$type<unknown[]>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("studio_events_doc_idx").on(t.docId, t.id)]);

/** One agent run: what it was asked, what it did, and whether it finished. */
export const studioRuns = pgTable("studio_runs", {
  id: text("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => studioDocs.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  instruction: text("instruction").notNull(),
  status: text("status").notNull().default("running"), // running | done | error | stopped | undone
  summary: text("summary").notNull().default(""),
  model: text("model").notNull().default(""),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (t) => [index("studio_runs_doc_idx").on(t.docId, t.startedAt)]);

/* ---------------- YouBank for Excel and PowerPoint ---------------- */

/**
 * A pairing in progress: the add-in shows `code`, the person approves it in YouBank, and the add-in
 * collects its device token (held encrypted here until collected) with the poll secret it kept.
 */
export const officePairings = pgTable("office_pairings", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  pollHash: text("poll_hash").notNull(),
  host: text("host").notNull().default(""),
  userId: text("user_id"),
  token: text("token"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("office_pairings_code_uidx").on(t.code), uniqueIndex("office_pairings_poll_uidx").on(t.pollHash)]);

/** A connected Excel or PowerPoint install. Only the token's hash is stored; revoking cuts it off at once. */
export const officeDevices = pgTable("office_devices", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull().default(""),
  host: text("host").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("office_devices_token_uidx").on(t.tokenHash), index("office_devices_user_idx").on(t.userId)]);

/** A named snapshot of a Studio document ("Sent to MD"), to compare against or go back to. */
export const studioCheckpoints = pgTable("studio_checkpoints", {
  id: serial("id").primaryKey(),
  docId: integer("doc_id").notNull().references(() => studioDocs.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdByName: text("created_by_name").notNull().default(""),
  workbook: jsonb("workbook").$type<import("@/lib/studio/types").Workbook>().notNull(),
  deck: jsonb("deck").$type<import("@/lib/studio/types").Deck>().notNull(),
  eventId: integer("event_id").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("studio_checkpoints_doc_idx").on(t.docId, t.createdAt)]);

/** One row per model call or agent run: tokens and list-price cost, for cost per feature and cache hit rates. */
export const aiUsage = pgTable("ai_usage", {
  id: serial("id").primaryKey(),
  userId: text("user_id"),
  feature: text("feature").notNull(),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  effort: text("effort").notNull().default(""),
  inputTokens: integer("input_tokens").notNull().default(0),
  cachedTokens: integer("cached_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  reasoningTokens: integer("reasoning_tokens").notNull().default(0),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("ai_usage_user_idx").on(t.userId, t.createdAt), index("ai_usage_created_idx").on(t.createdAt)]);

/**
 * Running AI spend per UTC day, for one person (`scope` = their id) or everyone ('*'), added to atomically
 * as each call is recorded, so every instance sees it at once (src/lib/ai/spend.ts; drizzle/0027_scale.sql).
 */
export const aiSpend = pgTable("ai_spend", {
  scope: text("scope").notNull(),
  day: date("day").notNull(),
  usd: doublePrecision("usd").notNull().default(0),
  calls: integer("calls").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.scope, t.day] }), index("ai_spend_day_idx").on(t.day)]);


/* ---------------- Newsroom ---------------- */

/** Polite polling state for each feed or query: conditional-request validators and backoff. */
export const newsFeeds = pgTable("news_feeds", {
  url: text("url").primaryKey(),
  kind: text("kind").notNull(),
  etag: text("etag").notNull().default(""),
  lastModified: text("last_modified").notNull().default(""),
  lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
  nextFetchAt: timestamp("next_fetch_at", { withTimezone: true }).notNull().defaultNow(),
  failCount: integer("fail_count").notNull().default(0),
  lastError: text("last_error").notNull().default(""),
  itemsSeen: integer("items_seen").notNull().default(0),
}, (t) => [index("news_feeds_next_idx").on(t.nextFetchAt)]);

export type NewsItemMeta = Record<string, unknown>;

/** Every article, filing, release, paper, model or launch seen. `key` is the canonical URL or the accession. */
export const newsItems = pgTable("news_items", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  snippet: text("snippet").notNull().default(""),
  source: text("source").notNull(),
  domain: text("domain").notNull().default(""),
  kind: text("kind").notNull(), // article | filing | release | gov | paper | repo | model | launch | research
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  desks: jsonb("desks").$type<string[]>().notNull().default([]),
  tickers: jsonb("tickers").$type<string[]>().notNull().default([]),
  meta: jsonb("meta").$type<NewsItemMeta>().notNull().default({}),
  clusterId: integer("cluster_id"),
  /** Title embedding, 256 dimensions quantized to int8, base64. Cleared after a few days. */
  embedding: text("embedding"),
}, (t) => [
  uniqueIndex("news_items_key_uidx").on(t.key),
  index("news_items_published_idx").on(t.publishedAt),
  index("news_items_cluster_idx").on(t.clusterId),
]);

export type NewsEntity = { name: string; ticker?: string; kind: "company" | "investor" | "person" | "agency" | "fund"; role?: string };
export type NewsSummary = { bullets: string[]; numbers: { label: string; value: string }[]; why: string; watch?: string; model?: string; fromText?: boolean };

/** A story: one or more items about the same event, with its summary and the desks it matters to. */
export const newsClusters = pgTable("news_clusters", {
  id: serial("id").primaryKey(),
  headline: text("headline").notNull(),
  category: text("category").notNull().default("general"),
  importance: doublePrecision("importance").notNull().default(0),
  desks: jsonb("desks").$type<string[]>().notNull().default([]),
  tickers: jsonb("tickers").$type<string[]>().notNull().default([]),
  entities: jsonb("entities").$type<NewsEntity[]>().notNull().default([]),
  summary: jsonb("summary").$type<NewsSummary | null>(),
  sourceCount: integer("source_count").notNull().default(1),
  kinds: jsonb("kinds").$type<string[]>().notNull().default([]),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }),
  centroid: text("centroid"),
}, (t) => [index("news_clusters_first_seen_idx").on(t.firstSeenAt), index("news_clusters_updated_idx").on(t.updatedAt)]);

export type DealAdvisor = { firm: string; side: string; role: string };

/** Announced deals and raises parsed from stories and filings: YouBank's own deal database. */
export const newsDeals = pgTable("news_deals", {
  id: serial("id").primaryKey(),
  clusterId: integer("cluster_id").notNull(),
  kind: text("kind").notNull(), // acquisition | merger | take_private | ipo | raise | debt | bankruptcy | spin_off | tender
  acquirer: text("acquirer").notNull().default(""),
  acquirerTicker: text("acquirer_ticker").notNull().default(""),
  target: text("target").notNull().default(""),
  targetTicker: text("target_ticker").notNull().default(""),
  valueUsd: doublePrecision("value_usd"),
  perShare: doublePrecision("per_share"),
  consideration: text("consideration").notNull().default(""),
  premium: doublePrecision("premium"),
  unaffectedPrice: doublePrecision("unaffected_price"),
  evEbitda: doublePrecision("ev_ebitda"),
  evRevenue: doublePrecision("ev_revenue"),
  round: text("round").notNull().default(""),
  investors: jsonb("investors").$type<string[]>().notNull().default([]),
  advisors: jsonb("advisors").$type<DealAdvisor[]>().notNull().default([]),
  sector: text("sector").notNull().default(""),
  status: text("status").notNull().default("announced"),
  announcedAt: timestamp("announced_at", { withTimezone: true }).notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("news_deals_cluster_uidx").on(t.clusterId), index("news_deals_announced_idx").on(t.announcedAt)]);

/** The morning brief per desk per day, research briefs per desk per slot, and the weekly tech radar. */
export const newsBriefs = pgTable("news_briefs", {
  id: serial("id").primaryKey(),
  desk: text("desk").notNull(),
  kind: text("kind").notNull(), // morning | research | radar
  slot: text("slot").notNull(),
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  model: text("model").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("news_briefs_desk_kind_slot_uidx").on(t.desk, t.kind, t.slot)]);

/** What each person did with a story, and the "why it matters to you" note written for them. */
export const newsUserItems = pgTable("news_user_items", {
  userId: text("user_id").notNull(),
  clusterId: integer("cluster_id").notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  why: jsonb("why").$type<{ text: string; model: string; at: string } | null>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.userId, t.clusterId] }), index("news_user_items_saved_idx").on(t.userId, t.savedAt),
  // drizzle/0027_scale.sql: hidden stories, and the affinity model's recent window.
  index("news_user_items_hidden_idx").on(t.userId).where(sql`hidden_at is not null`),
  index("news_user_items_user_updated_idx").on(t.userId, t.updatedAt),
]);

/** Alerts and briefs for the bell, with where each was delivered. `key` dedupes per person. */
export const newsNotifications = pgTable("news_notifications", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  key: text("key").notNull(),
  kind: text("kind").notNull(), // alert | brief | radar | system
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  url: text("url").notNull().default(""),
  clusterId: integer("cluster_id"),
  urgent: boolean("urgent").notNull().default(false),
  delivered: jsonb("delivered").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("news_notifications_user_key_uidx").on(t.userId, t.key), index("news_notifications_user_idx").on(t.userId, t.createdAt),
  // drizzle/0027_scale.sql: the unread count reads only unread rows.
  index("news_notifications_user_unread_idx").on(t.userId, t.createdAt).where(sql`read_at is null`),
]);

/** Browser push subscriptions, one per device. */
export const newsPushSubs = pgTable("news_push_subs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  keys: jsonb("keys").$type<{ p256dh: string; auth: string }>().notNull(),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
}, (t) => [uniqueIndex("news_push_subs_endpoint_uidx").on(t.endpoint), index("news_push_subs_user_idx").on(t.userId)]);

/** A developing story someone follows: what they last heard about it, so each update alerts once. */
export const newsFollows = pgTable("news_follows", {
  userId: text("user_id").notNull(),
  clusterId: integer("cluster_id").notNull(),
  /** The story's source count when last told (or when followed). */
  seenSources: integer("seen_sources").notNull().default(1),
  /** The story's last update when last told. */
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  updates: integer("updates").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.clusterId] }), index("news_follows_cluster_idx").on(t.clusterId)]);

export type BriefingChapter = { id: string; title: string; text: string; clusterId?: number; tickers?: string[]; seconds: number };
export type BriefingAudio = { key: string; bytes: number; seconds: number }[];

/** A personal audio briefing: chapters with their scripts, and storage keys for a neural voice's audio. */
export const newsBriefings = pgTable("news_briefings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  slot: text("slot").notNull(),
  kind: text("kind").notNull(), // ai | daily
  desk: text("desk").notNull().default(""),
  chapters: jsonb("chapters").$type<BriefingChapter[]>().notNull().default([]),
  audio: jsonb("audio").$type<BriefingAudio | null>(),
  voice: text("voice").notNull().default(""),
  model: text("model").notNull().default(""),
  costUsd: doublePrecision("cost_usd").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("news_briefings_user_slot_kind_uidx").on(t.userId, t.slot, t.kind)]);

/* ---------------- Edge ---------------- */

/** A PostGIS geometry (WGS84). Written and read as GeoJSON through SQL (ST_GeomFromGeoJSON, ST_AsGeoJSON). */
const geometry = customType<{ data: string; driverData: string }>({ dataType: () => "geometry(Geometry, 4326)" });

/** Pipelines, plants and sites. Public maps are shared (ownerId null); uploaded or drawn assets are private. */
export const edgeAssets = pgTable("edge_assets", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),
  sourceId: text("source_id").notNull(),
  kind: text("kind").notNull(), // pipeline | processing_plant | site | ...
  name: text("name").notNull().default(""),
  operator: text("operator").notNull().default(""),
  company: text("company").notNull().default(""),
  ticker: text("ticker").notNull().default(""),
  status: text("status").notNull().default(""),
  attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
  geom: geometry("geom").notNull(),
  ownerId: text("owner_id"),
  teamId: integer("team_id"),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
  /** When Edge last compared this site's imagery; sites are checked least recently first. */
  checkedAt: timestamp("checked_at", { withTimezone: true }),
}, (t) => [uniqueIndex("edge_assets_source_uq").on(t.source, t.sourceId), index("edge_assets_ticker_idx").on(t.ticker), index("edge_assets_owner_idx").on(t.ownerId)]);

export type EdgeWatchTarget = { ticker?: string; company?: string; bbox?: [number, number, number, number]; place?: string; name?: string; query?: string };

/** What a person (or their team) follows. */
export const edgeWatches = pgTable("edge_watches", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  kind: text("kind").notNull(), // company | place | person | theme
  label: text("label").notNull(),
  target: jsonb("target").$type<EdgeWatchTarget>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
}, (t) => [index("edge_watches_user_idx").on(t.userId), index("edge_watches_team_idx").on(t.teamId)]);

export type EdgeSource = { name: string; url: string; license: string; retrievedAt: string; method: string; modelVersion?: string };

/** One finding: a card in the Edge feed. From public data it is shared; from a person's own data it is theirs. */
export const edgeDetections = pgTable("edge_detections", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  kind: text("kind").notNull(), // ground_change | deal_proforma | ...
  module: text("module").notNull(), // earth | networks | documents | scenarios
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  why: text("why").notNull().default(""),
  confidence: real("confidence").notNull().default(0.5),
  magnitude: real("magnitude").notNull().default(0),
  tickers: jsonb("tickers").$type<string[]>().notNull().default([]),
  assetIds: jsonb("asset_ids").$type<number[]>().notNull().default([]),
  bbox: jsonb("bbox").$type<[number, number, number, number] | null>(),
  visual: jsonb("visual").$type<Record<string, unknown>>().notNull().default({}),
  ownerId: text("owner_id"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_detections_key_uq").on(t.key), index("edge_detections_detected_idx").on(t.detectedAt)]);

/** The audit trail: where every datum came from, under what license, when, and by what method. */
export const edgeProvenance = pgTable("edge_provenance", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  subject: text("subject").notNull(), // asset:12 | detection:5
  sourceName: text("source_name").notNull(),
  sourceUrl: text("source_url").notNull().default(""),
  license: text("license").notNull().default(""),
  method: text("method").notNull().default(""),
  modelVersion: text("model_version").notNull().default(""),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("edge_provenance_subject_idx").on(t.subject)]);

/* ---------------- Edge platform (0014): canvas, runs, documents, graph, scenarios ---------------- */

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

/** Files in Cloudflare R2. Uploads arrive in 4 MB parts under r2_key/p/<n>; `parts` counts them. */
export const edgeFiles = pgTable("edge_files", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id"),
  teamId: integer("team_id"),
  kind: text("kind").notNull(), // upload | imagery | artifact | transcript | model | export
  name: text("name").notNull().default(""),
  mime: text("mime").notNull().default(""),
  bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  r2Key: text("r2_key").notNull(),
  parts: integer("parts").notNull().default(0),
  status: text("status").notNull().default("uploading"), // uploading | stored | processing | ready | failed
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_files_key_uq").on(t.r2Key), index("edge_files_owner_idx").on(t.ownerId, t.kind)]);

/** Monthly use of the free tiers (service modal | inngest | r2; metric usd | executions | bytes | class_a | class_b). */
export const edgeUsage = pgTable("edge_usage", {
  month: text("month").notNull(),
  service: text("service").notNull(),
  metric: text("metric").notNull(),
  value: doublePrecision("value").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.month, t.service, t.metric] })]);

export type CanvasGraph = { nodes: unknown[]; edges: unknown[]; viewport?: { x: number; y: number; zoom: number } };

export const edgeCanvases = pgTable("edge_canvases", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  teamId: integer("team_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  graph: jsonb("graph").$type<CanvasGraph>().notNull().default({ nodes: [], edges: [] }),
  template: text("template").notNull().default(""),
  parentId: integer("parent_id"),
  branch: text("branch").notNull().default(""),
  version: integer("version").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
}, (t) => [index("edge_canvases_owner_idx").on(t.ownerId, t.updatedAt), index("edge_canvases_team_idx").on(t.teamId)]);

export const edgeCanvasEvents = pgTable("edge_canvas_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  canvasId: integer("canvas_id").notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // patch | checkpoint | restore | run
  version: integer("version").notNull().default(0),
  label: text("label").notNull().default(""),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("edge_canvas_events_canvas_idx").on(t.canvasId, t.id)]);

export const edgeRuns = pgTable("edge_runs", {
  id: serial("id").primaryKey(),
  canvasId: integer("canvas_id").notNull(),
  ownerId: text("owner_id").notNull(),
  trigger: text("trigger").notNull().default("manual"), // manual | monitor | onboarding
  status: text("status").notNull().default("queued"), // queued | running | done | failed | cancelled
  graph: jsonb("graph").$type<CanvasGraph>().notNull(),
  outputs: jsonb("outputs").$type<Record<string, unknown>>().notNull().default({}),
  cost: jsonb("cost").$type<Record<string, number>>().notNull().default({}),
  error: text("error").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
}, (t) => [index("edge_runs_canvas_idx").on(t.canvasId, t.createdAt), index("edge_runs_owner_idx").on(t.ownerId, t.createdAt)]);

export const edgeRunSteps = pgTable("edge_run_steps", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  runId: integer("run_id").notNull(),
  nodeId: text("node_id").notNull(),
  step: text("step").notNull().default(""),
  status: text("status").notNull().default("queued"),
  summary: text("summary").notNull().default(""),
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<unknown>(),
  artifactKey: text("artifact_key").notNull().default(""),
  cost: jsonb("cost").$type<Record<string, number>>().notNull().default({}),
  error: text("error").notNull().default(""),
  startedAt: ts("started_at"),
  finishedAt: ts("finished_at"),
}, (t) => [index("edge_run_steps_run_idx").on(t.runId, t.id)]);

export const edgeMonitors = pgTable("edge_monitors", {
  id: serial("id").primaryKey(),
  canvasId: integer("canvas_id").notNull(),
  ownerId: text("owner_id").notNull(),
  schedule: text("schedule").notNull().default("daily"), // daily | weekly
  alert: text("alert").notNull().default("digest"), // immediate | digest
  active: boolean("active").notNull().default(true),
  nextRunAt: ts("next_run_at").notNull().defaultNow(),
  lastRunId: integer("last_run_id"),
  lastSignal: jsonb("last_signal").$type<Record<string, unknown> | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_monitors_canvas_uq").on(t.canvasId), index("edge_monitors_due_idx").on(t.active, t.nextRunAt)]);

export const edgeStories = pgTable("edge_stories", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  teamId: integer("team_id"),
  runId: integer("run_id"),
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  sections: jsonb("sections").$type<unknown[]>().notNull().default([]),
  visibility: text("visibility").notNull().default("private"), // private | team | link
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_stories_slug_uq").on(t.slug), index("edge_stories_owner_idx").on(t.ownerId, t.createdAt)]);

/** A document. ownerId "" is the shared public corpus (filings); otherwise private to that person (or their team). */
export const edgeDocs = pgTable("edge_docs", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull().default(""),
  teamId: integer("team_id"),
  source: text("source").notNull(), // sec | upload | audio | web | workspace | newsroom
  externalId: text("external_id").notNull(),
  title: text("title").notNull().default(""),
  url: text("url").notNull().default(""),
  fileId: integer("file_id"),
  mime: text("mime").notNull().default(""),
  lang: text("lang").notNull().default(""),
  pages: integer("pages").notNull().default(0),
  durationSec: real("duration_sec").notNull().default(0),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("queued"), // queued | parsing | indexing | ready | failed
  error: text("error").notNull().default(""),
  chunks: integer("chunks").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
  indexedAt: ts("indexed_at"),
}, (t) => [uniqueIndex("edge_docs_ext_uq").on(t.source, t.externalId, t.ownerId), index("edge_docs_owner_idx").on(t.ownerId, t.createdAt)]);

export const edgeChunks = pgTable("edge_chunks", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  docId: integer("doc_id").notNull(),
  ord: integer("ord").notNull(),
  page: integer("page").notNull().default(0),
  tStart: real("t_start"),
  tEnd: real("t_end"),
  speaker: text("speaker").notNull().default(""),
  section: text("section").notNull().default(""),
  text: text("text").notNull(),
  embedding: halfvec("embedding", { dimensions: 512 }),
  tsv: tsvector("tsv"),
}, (t) => [uniqueIndex("edge_chunks_doc_ord_uq").on(t.docId, t.ord)]);

export const edgeAnswers = pgTable("edge_answers", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  question: text("question").notNull(),
  mode: text("mode").notNull().default("strict"),
  scope: jsonb("scope").$type<Record<string, unknown>>().notNull().default({}),
  answer: jsonb("answer").$type<Record<string, unknown>>().notNull().default({}),
  cost: jsonb("cost").$type<Record<string, number>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("edge_answers_owner_idx").on(t.ownerId, t.createdAt)]);

export const edgeNodes = pgTable("edge_nodes", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // company | person | fund | subsidiary | firm
  name: text("name").notNull(),
  norm: text("norm").notNull(),
  ticker: text("ticker").notNull().default(""),
  cik: text("cik").notNull().default(""),
  attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("edge_nodes_norm_idx").on(t.norm)]);

export const edgeLinks = pgTable("edge_links", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  src: integer("src").notNull(),
  dst: integer("dst").notNull(),
  kind: text("kind").notNull(), // director | officer | holder | subsidiary | customer | supplier | acquired | invested | advised | lent
  weight: real("weight").notNull().default(1),
  attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
  sourceName: text("source_name").notNull().default(""),
  sourceUrl: text("source_url").notNull().default(""),
  asOf: date("as_of"),
  ended: date("ended"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_links_uq").on(t.src, t.dst, t.kind), index("edge_links_src_idx").on(t.src, t.kind), index("edge_links_dst_idx").on(t.dst, t.kind)]);

export const edgeModels = pgTable("edge_models", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // gnn-deals
  version: text("version").notNull(),
  status: text("status").notNull().default("training"), // training | ready | failed
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
  artifactKey: text("artifact_key").notNull().default(""),
  trainedAt: ts("trained_at").notNull().defaultNow(),
});

export const edgePredictions = pgTable("edge_predictions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  modelId: integer("model_id").notNull(),
  kind: text("kind").notNull(), // acquirer | target
  subject: integer("subject").notNull(),
  candidate: integer("candidate").notNull(),
  score: real("score").notNull(),
  rank: integer("rank").notNull(),
  reasons: jsonb("reasons").$type<unknown[]>().notNull().default([]),
}, (t) => [index("edge_predictions_subject_idx").on(t.subject, t.kind, t.modelId)]);

export const edgeScenarios = pgTable("edge_scenarios", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  teamId: integer("team_id"),
  title: text("title").notNull(),
  kind: text("kind").notNull(), // market | company | gap | practice
  driver: text("driver").notNull().default("none"), // replay | event | shock | tail | none
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("draft"), // draft | preview | refining | ready | failed
  preview: jsonb("preview").$type<Record<string, unknown>>().notNull().default({}),
  resultKey: text("result_key").notNull().default(""),
  realism: jsonb("realism").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("edge_scenarios_owner_idx").on(t.ownerId, t.updatedAt)]);

export const edgeAlerts = pgTable("edge_alerts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(), // detection:12 | run:5
  kind: text("kind").notNull(), // immediate | digest
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_alerts_uq").on(t.userId, t.subject, t.kind)]);

export const edgePushes = pgTable("edge_pushes", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  target: text("target").notNull(), // studio:12 | office
  source: text("source").notNull(), // run:5:node-3 | scenario:4 | answer:9
  kind: text("kind").notNull(), // map | network | scenario | memo | table
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"), // pending | accepted | dismissed | superseded
  createdAt: ts("created_at").notNull().defaultNow(),
  decidedAt: ts("decided_at"),
}, (t) => [index("edge_pushes_target_idx").on(t.target, t.status)]);

/* ---------------- Edge next (0020): crosswalk, signal store, forecast ledger, deals, agents ---------------- */

/** F1: a company's id in one scheme (cik, ticker, lei, domain, wikidata, wikipedia, greenhouse, lever, ashby, uei, patentsview, ...). */
export const edgeEntityIds = pgTable("edge_entity_ids", {
  id: serial("id").primaryKey(),
  nodeId: integer("node_id").notNull(),
  scheme: text("scheme").notNull(),
  value: text("value").notNull(),
  confidence: real("confidence").notNull().default(1),
  method: text("method").notNull().default(""),
  evidenceUrl: text("evidence_url").notNull().default(""),
  status: text("status").notNull().default("active"), // active | review | rejected
  verifiedBy: text("verified_by").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_entity_ids_uq").on(t.scheme, t.value), index("edge_entity_ids_node_idx").on(t.nodeId, t.scheme)]);

/** F2: one weekly (or monthly) point of a signal for a company. */
export const edgeSeries = pgTable("edge_series", {
  nodeId: integer("node_id").notNull(),
  metric: text("metric").notNull(),
  period: date("period").notNull(),
  value: doublePrecision("value").notNull(),
  source: text("source").notNull().default(""),
  retrievedAt: ts("retrieved_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.nodeId, t.metric, t.period] }), index("edge_series_period_idx").on(t.period)]);

export type ForecastRule =
  | { type: "deal"; role: "target" | "acquirer"; node: number; minStakePct?: number }
  | { type: "xbrl"; cik: string; concept: string; period: string; op: ">=" | "<=" | "between"; value: number; high?: number; unit?: string; days?: [number, number]; endWithinDays?: number }
  | { type: "manual"; note?: string; parent?: number }
  /** Quant Edge: a symbol's total return from `from` to `to` (closes) against a benchmark's, compared with `value` (excess return). */
  | { type: "return"; symbol: string; benchmark: string; from: string; to: string; op: ">" | ">=" | "<" | "<="; value: number };

/** F3: a probability Edge stated, when it was stated, and how it turned out. Append-only. */
export const edgeForecasts = pgTable("edge_forecasts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  kind: text("kind").notNull(), // deal_target | deal_acquirer | thesis_claim | guidance | ...
  subject: text("subject").notNull(), // node:123 | thesis:5:claim:3 | doc:88:commitment:4
  question: text("question").notNull(),
  probability: real("probability").notNull(),
  low: real("low"),
  high: real("high"),
  baseRate: real("base_rate"),
  opensAt: ts("opens_at").notNull(),
  closesAt: ts("closes_at").notNull(),
  rule: jsonb("rule").$type<ForecastRule>().notNull(),
  model: text("model").notNull(),
  modelVersion: text("model_version").notNull(),
  ownerId: text("owner_id"),
  supersedes: bigint("supersedes", { mode: "number" }),
  resolvedAt: ts("resolved_at"),
  outcome: real("outcome"),
  resolutionSource: text("resolution_source").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("edge_forecasts_subject_idx").on(t.subject, t.createdAt)]);

export type DealSource = { form: string; url: string; filed: string; role?: string; press?: string };

/** F4: one deal (E1). Public deals have no owner; private precedents (later) carry one. */
export const edgeDeals = pgTable("edge_deals", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  kind: text("kind").notNull().default("acquisition"), // acquisition | merger | tender | take_private
  status: text("status").notNull().default("announced"), // announced | completed | terminated
  announcedAt: date("announced_at"),
  signedAt: date("signed_at"),
  closedAt: date("closed_at"),
  acquirerNode: integer("acquirer_node"),
  targetNode: integer("target_node"),
  acquirerName: text("acquirer_name").notNull().default(""),
  targetName: text("target_name").notNull().default(""),
  acquirerCik: text("acquirer_cik").notNull().default(""),
  targetCik: text("target_cik").notNull().default(""),
  targetTicker: text("target_ticker").notNull().default(""),
  buyerType: text("buyer_type").notNull().default(""), // strategic | sponsor | sponsor_backed
  sic: text("sic").notNull().default(""),
  naics: text("naics").notNull().default(""),
  country: text("country").notNull().default("US"),
  equityUsdMm: real("equity_usd_mm"),
  evUsdMm: real("ev_usd_mm"),
  evRevenue: real("ev_revenue"),
  evEbitda: real("ev_ebitda"),
  premium1d: real("premium_1d"),
  premiumUnaffected: real("premium_unaffected"),
  consideration: text("consideration").notNull().default(""), // cash | stock | mixed
  outcome: text("outcome").notNull().default(""), // completed | terminated | topped | pending
  newsClusterId: integer("news_cluster_id"),
  sources: jsonb("sources").$type<DealSource[]>().notNull().default([]),
  embedding: halfvec("embedding", { dimensions: 512 }),
  ownerId: text("owner_id"),
  teamId: integer("team_id"),
  extractedAt: ts("extracted_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("edge_deals_key_uq").on(t.key), index("edge_deals_target_idx").on(t.targetNode, t.announcedAt), index("edge_deals_sic_idx").on(t.sic, t.announcedAt)]);

/** One extracted deal term with its quote, document, checks and calibrated confidence. */
export const edgeDealFields = pgTable("edge_deal_fields", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  dealId: integer("deal_id").notNull(),
  field: text("field").notNull(),
  value: jsonb("value").$type<unknown>().notNull(),
  quote: text("quote").notNull().default(""),
  docUrl: text("doc_url").notNull().default(""),
  section: text("section").notNull().default(""),
  confidence: real("confidence").notNull().default(0.5),
  checks: jsonb("checks").$type<Record<string, unknown>>().notNull().default({}),
  method: text("method").notNull().default(""),
  modelVersion: text("model_version").notNull().default(""),
  verifiedBy: text("verified_by").notNull().default(""),
  active: boolean("active").notNull().default(true),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("edge_deal_fields_deal_idx").on(t.dealId, t.field)]);

/** F5: a Thesis Agent (E7, next round). */
export const edgeAgents = pgTable("edge_agents", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  teamId: integer("team_id"),
  title: text("title").notNull(),
  thesis: text("thesis").notNull(),
  status: text("status").notNull().default("planning"), // planning | running | paused | done | stopped
  horizonEnd: date("horizon_end"),
  budgetUsd: real("budget_usd").notNull().default(0),
  spentUsd: real("spent_usd").notNull().default(0),
  model: text("model").notNull().default(""),
  cadence: text("cadence").notNull().default("daily"),
  canvasIds: jsonb("canvas_ids").$type<number[]>().notNull().default([]),
  memo: jsonb("memo").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("edge_agents_owner_idx").on(t.ownerId, t.status)]);

export const edgeAgentSteps = pgTable("edge_agent_steps", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  agentId: integer("agent_id").notNull(),
  day: date("day").notNull(),
  kind: text("kind").notNull(), // plan | tool | evidence | update | redteam | memo | approval
  tool: text("tool").notNull().default(""),
  input: jsonb("input").$type<Record<string, unknown>>().notNull().default({}),
  output: jsonb("output").$type<Record<string, unknown>>().notNull().default({}),
  cost: jsonb("cost").$type<Record<string, number>>().notNull().default({}),
  error: text("error").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("edge_agent_steps_agent_idx").on(t.agentId, t.id)]);

/** Where a long background job has got to (a cursor, a switch, the last run), by job name. */
export const edgeJobState = pgTable("edge_job_state", {
  name: text("name").primaryKey(),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});


/* ---------------- Plans and subscriptions ---------------- */

/**
 * Each person's plan. No row means the free plan (or Campus, for a .edu address). Written by the
 * billing webhook; administrators (ADMIN_EMAILS) are treated as Enterprise whatever this says.
 */
export const subscriptions = pgTable("subscriptions", {
  userId: text("user_id").primaryKey(),
  plan: text("plan").notNull().default("free"), // free | campus | pro | team | enterprise
  status: text("status").notNull().default("active"), // active | trialing | past_due | canceled
  seats: integer("seats").notNull().default(1),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  currentPeriodEnd: ts("current_period_end"),
  /** drizzle/0022_credits.sql: the billing dates allowances reset on, and a cancellation at period end. */
  currentPeriodStart: ts("current_period_start"),
  billingAnchor: ts("billing_anchor"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  cancelAt: ts("cancel_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId), index("subscriptions_stripe_subscription_idx").on(t.stripeSubscriptionId)]);

/**
 * AI credit packs bought (or granted). `usd` is AI use at list price; the unique payment intent makes the
 * Stripe webhook idempotent. drizzle/0022_credits.sql.
 */
export const aiCreditGrants = pgTable("ai_credit_grants", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  pack: text("pack").notNull(),
  usd: doublePrecision("usd").notNull(),
  refundedUsd: doublePrecision("refunded_usd").notNull().default(0),
  paidCents: integer("paid_cents").notNull().default(0),
  currency: text("currency").notNull().default("usd"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id"),
  note: text("note").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("ai_credit_grants_payment_intent_uidx").on(t.stripePaymentIntentId), index("ai_credit_grants_user_idx").on(t.userId, t.createdAt)]);

/** Credits used per allowance period (spend beyond the plan's allowance), settled from the ledger when the period ends. */
export const aiCreditDraws = pgTable("ai_credit_draws", {
  userId: text("user_id").notNull(),
  periodStart: ts("period_start").notNull(),
  periodEnd: ts("period_end").notNull(),
  capUsd: doublePrecision("cap_usd").notNull(),
  availableUsd: doublePrecision("available_usd").notNull(),
  usedUsd: doublePrecision("used_usd").notNull().default(0),
  settled: boolean("settled").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.periodStart] })]);

/** Deal Team and Enterprise seats the subscription's owner has given to members of their teams. */
export const seatAssignments = pgTable("seat_assignments", {
  id: serial("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  assignedAt: ts("assigned_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("seat_assignments_user_uidx").on(t.userId), index("seat_assignments_owner_idx").on(t.ownerUserId, t.assignedAt)]);

/**
 * Every seat given (drizzle/0024_seat_cooldown.sql), kept after the seat is freed, for the 30-day
 * reassignment cooldown in lib/billing/seats.ts. No foreign key to the team, so deleting a team does not
 * erase the history. `trimmedAt` marks seats taken back because the paid seat count went down: those do
 * not cool.
 */
export const seatHistory = pgTable("seat_history", {
  id: serial("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull(),
  userId: text("user_id").notNull(),
  teamId: integer("team_id"),
  email: text("email").notNull().default(""),
  name: text("name").notNull().default(""),
  assignedAt: ts("assigned_at").notNull().defaultNow(),
  trimmedAt: ts("trimmed_at"),
}, (t) => [index("seat_history_owner_idx").on(t.ownerUserId, t.assignedAt)]);

/* ---------------- Crypto: watched addresses, cost basis, notarizations ---------------- */

/**
 * Public blockchain addresses a person reads: their own wallets (connected or pasted) and wallets they
 * watch (a fund, a treasury, a whale). Addresses only; YouBank never stores or asks for a key.
 */
export const cryptoAddresses = pgTable("crypto_addresses", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  address: text("address").notNull(), // checksummed 0x…, a bc1…/1…/3… address, a Solana key, or an ENS name
  kind: text("kind").notNull(), // evm | bitcoin | solana | ens
  label: text("label").notNull().default(""),
  role: text("role").notNull().default("own"), // own | watch
  source: text("source").notNull().default("pasted"), // pasted | connected
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("crypto_addresses_user_addr_uq").on(t.userId, t.address)]);

/** What a person says they paid for an asset in total (USD), for profit and loss. Keyed by CoinGecko id. */
export const cryptoCostBasis = pgTable("crypto_cost_basis", {
  userId: text("user_id").notNull(),
  asset: text("asset").notNull(),
  costUsd: doublePrecision("cost_usd").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.asset] })]);

/**
 * Documents and Studio audit trails notarized on chain: the SHA-256 of the content, recorded by the
 * person's own wallet in a zero-value transaction to itself (Base by default). Confirmed only after
 * the server has read the transaction back and checked its calldata.
 */
export const cryptoNotarizations = pgTable("crypto_notarizations", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  sha256: text("sha256").notNull(),
  subject: text("subject").notNull().default(""), // file name or "Studio: <title>"
  kind: text("kind").notNull().default("document"), // document | studio
  studioDocId: integer("studio_doc_id"),
  studioEventId: bigint("studio_event_id", { mode: "number" }),
  chain: text("chain").notNull().default("base"),
  txHash: text("tx_hash").notNull(),
  fromAddress: text("from_address").notNull(),
  status: text("status").notNull().default("pending"), // pending | confirmed | failed
  reason: text("reason").notNull().default(""),
  blockNumber: bigint("block_number", { mode: "number" }),
  confirmedAt: ts("confirmed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("crypto_notarizations_user_tx_uq").on(t.userId, t.chain, t.txHash), index("crypto_notarizations_user_idx").on(t.userId, t.createdAt), index("crypto_notarizations_sha_idx").on(t.sha256)]);

/* ---------------- The desktop app ---------------- */

/**
 * A desktop app asking to connect, the same device-code flow as the Office add-in: the app shows the
 * code, the signed-in person approves it, and the app (holding the poll secret) collects its token once.
 */
export const desktopPairings = pgTable("desktop_pairings", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  pollHash: text("poll_hash").notNull(),
  platform: text("platform").notNull().default(""), // windows | macos | linux
  name: text("name").notNull().default(""),
  userId: text("user_id"),
  token: text("token"),
  approvedAt: ts("approved_at"),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("desktop_pairings_code_uidx").on(t.code), uniqueIndex("desktop_pairings_poll_uidx").on(t.pollHash)]);

/**
 * A connected desktop app. Only the token's hash is stored; revoking cuts it off at once. `settings`
 * holds which scheduled tasks the person turned on for this computer: the server refuses a scheduled
 * task that spends AI money unless it is switched on here, whatever the app sends.
 */
export const desktopDevices = pgTable("desktop_devices", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  name: text("name").notNull().default(""),
  platform: text("platform").notNull().default(""),
  appVersion: text("app_version").notNull().default(""),
  settings: jsonb("settings").$type<{ tasks?: Record<string, boolean> }>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
}, (t) => [uniqueIndex("desktop_devices_token_uidx").on(t.tokenHash), index("desktop_devices_user_idx").on(t.userId)]);

/**
 * Local files a desktop app indexed into Edge documents. The path never leaves the computer: `pathKey`
 * is a hash of it, so the server can tell "this file changed" from "a new file" without knowing where
 * it lives. `sha256` is the content hash; an unchanged file is never uploaded twice.
 */
export const desktopFiles = pgTable("desktop_files", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  deviceId: integer("device_id").notNull(),
  pathKey: text("path_key").notNull(),
  name: text("name").notNull().default(""),
  sha256: text("sha256").notNull(),
  bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  docId: integer("doc_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("desktop_files_path_uidx").on(t.userId, t.deviceId, t.pathKey), index("desktop_files_user_sha_idx").on(t.userId, t.sha256)]);


/* ---------------- Calendar ---------------- */

/** Settings for a connected calendar account. Never the password or tokens. */
export type CalendarAccountSettings = { serverUrl?: string; homeUrl?: string; username?: string; preset?: string; url?: string };
/** A push channel (Google watch) or subscription (Microsoft Graph). The secret is encrypted. */
export type CalendarPush = { kind: "google" | "microsoft"; id: string; resourceId: string; expiresAt: string; secret: string };
export type CalendarAttendee = { email: string; name: string; response: string; optional?: boolean; organizer?: boolean; self?: boolean };

/**
 * A connected calendar account: Google or Microsoft (OAuth), CalDAV (app password) or an ICS link.
 * Tokens and the app password are encrypted like mailbox tokens (src/lib/crm/crypto.ts).
 */
export const calendarAccounts = pgTable("calendar_accounts", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider").notNull(), // google | microsoft | caldav | ics
  address: text("address").notNull(),
  displayName: text("display_name").notNull().default(""),
  accessToken: text("access_token").notNull().default(""),
  refreshToken: text("refresh_token").notNull().default(""),
  tokenExpiresAt: ts("token_expires_at"),
  secret: text("secret").notNull().default(""),
  settings: jsonb("settings").$type<CalendarAccountSettings>().notNull().default({}),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("connected"), // connected | needs_reauth | error
  lastError: text("last_error").notNull().default(""),
  lastSyncAt: ts("last_sync_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("calendar_accounts_user_provider_address_uidx").on(t.userId, t.provider, t.address)]);

/** A calendar inside an account: shown or hidden, and where its sync and push notifications stand. */
export const calendarCalendars = pgTable("calendar_calendars", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().references(() => calendarAccounts.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  remoteId: text("remote_id").notNull(),
  name: text("name").notNull().default(""),
  color: text("color").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
  canWrite: boolean("can_write").notNull().default(false),
  isPrimary: boolean("is_primary").notNull().default(false),
  visible: boolean("visible").notNull().default(true),
  syncToken: text("sync_token").notNull().default(""),
  /** When the current incremental window began; Microsoft's delta windows are restarted daily. */
  windowStart: ts("window_start"),
  lastSyncedAt: ts("last_synced_at"),
  pushId: text("push_id"),
  push: jsonb("push").$type<CalendarPush | null>(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("calendar_calendars_account_remote_uidx").on(t.accountId, t.remoteId),
  index("calendar_calendars_user_idx").on(t.userId),
  index("calendar_calendars_push_idx").on(t.pushId),
]);

/** One occurrence of an event in the sync window, with the Relationships contacts and deals it involves. */
export const calendarEvents = pgTable("calendar_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  calendarId: integer("calendar_id").notNull().references(() => calendarCalendars.id, { onDelete: "cascade" }),
  remoteId: text("remote_id").notNull(),
  groupKey: text("group_key").notNull().default(""),
  icalUid: text("ical_uid").notNull().default(""),
  recurrenceId: text("recurrence_id"),
  seriesId: text("series_id"),
  title: text("title").notNull().default(""),
  description: text("description").notNull().default(""),
  location: text("location").notNull().default(""),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  allDay: boolean("all_day").notNull().default(false),
  timezone: text("timezone").notNull().default(""),
  status: text("status").notNull().default("confirmed"), // confirmed | tentative | cancelled
  busy: boolean("busy").notNull().default(true),
  organizer: jsonb("organizer").$type<CalendarAttendee | null>(),
  attendees: jsonb("attendees").$type<CalendarAttendee[]>().notNull().default([]),
  videoUrl: text("video_url").notNull().default(""),
  htmlLink: text("html_link").notNull().default(""),
  etag: text("etag").notNull().default(""),
  href: text("href").notNull().default(""),
  contactIds: jsonb("contact_ids").$type<number[]>().notNull().default([]),
  dealIds: jsonb("deal_ids").$type<number[]>().notNull().default([]),
  external: boolean("external").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("calendar_events_calendar_remote_uidx").on(t.calendarId, t.remoteId),
  index("calendar_events_user_start_idx").on(t.userId, t.startsAt),
  index("calendar_events_group_idx").on(t.calendarId, t.groupKey),
  index("calendar_events_contacts_idx").using("gin", sql`${t.contactIds} jsonb_path_ops`),
  index("calendar_events_deals_idx").using("gin", sql`${t.dealIds} jsonb_path_ops`),
]);

/** Each person's scheduling preferences, and whether their external meetings are briefed each morning. */
export const calendarPrefs = pgTable("calendar_prefs", {
  userId: text("user_id").primaryKey(),
  /** Kept so background work (the morning briefs) can check the plan, which administrators bypass by email. */
  email: text("email").notNull().default(""),
  timezone: text("timezone").notNull().default(""),
  workHours: jsonb("work_hours").$type<{ start?: string; end?: string; days?: number[] }>().notNull().default({}),
  defaultCalendarId: integer("default_calendar_id"),
  defaultDuration: integer("default_duration").notNull().default(30),
  /** A personal meeting room link, offered when creating a meeting. */
  videoUrl: text("video_url").notNull().default(""),
  autoBrief: boolean("auto_brief").notNull().default(false),
  /** The local date of the last morning run, YYYY-MM-DD. */
  autoBriefLast: text("auto_brief_last").notNull().default(""),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** An AI meeting brief. Made only on a click, or by the morning run the person switched on. */
export const calendarBriefs = pgTable("calendar_briefs", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  eventId: bigint("event_id", { mode: "number" }).notNull().references(() => calendarEvents.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull().default("click"), // click | morning
  content: jsonb("content").$type<Record<string, unknown>>().notNull(),
  provider: text("provider").notNull().default(""),
  model: text("model").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("calendar_briefs_event_uidx").on(t.eventId), index("calendar_briefs_user_idx").on(t.userId, t.createdAt)]);
/* ---------------- The meeting copilot ---------------- */

/**
 * A meeting the copilot listened to: captured by the desktop app (microphone and system audio, after a
 * consent prompt) or by a notetaker bot sent to the meeting link. `participants` is who was there and
 * which contact each became; `notes` is what was produced after the meeting (summary, decisions, action
 * items, per-person signals, follow-ups). Audio is never kept here: each chunk is transcribed and
 * dropped. `purgedAt` marks a transcript removed under the person's retention setting.
 */
export const meetings = pgTable("meetings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  deviceId: integer("device_id"),
  source: text("source").notNull().default("desktop"), // desktop | bot
  platform: text("platform").notNull().default(""), // zoom | teams | meet | webex | slack | other
  title: text("title").notNull().default(""),
  status: text("status").notNull().default("live"), // joining | live | processing | ready | failed | cancelled
  meetingUrl: text("meeting_url").notNull().default(""),
  botId: text("bot_id"),
  bot: jsonb("bot").$type<{ provider?: string; status?: string; statusAt?: string; joinedAt?: string; endedAt?: string; error?: string; polledAt?: string; hours?: number; costUsd?: number }>().notNull().default({}),
  context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  participants: jsonb("participants").$type<MeetingParticipantJson[]>().notNull().default([]),
  consent: jsonb("consent").$type<{ at?: string; by?: string; noticeCopied?: boolean; auto?: boolean }>().notNull().default({}),
  live: jsonb("live").$type<{ on?: boolean; since?: string; minutes?: number; lastAt?: string; brief?: unknown }>().notNull().default({}),
  notes: jsonb("notes").$type<Record<string, unknown>>(),
  notesAt: ts("notes_at"),
  transcriber: text("transcriber").notNull().default(""),
  durationSec: integer("duration_sec").notNull().default(0),
  error: text("error").notNull().default(""),
  startedAt: ts("started_at").notNull().defaultNow(),
  endedAt: ts("ended_at"),
  purgedAt: ts("purged_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("meetings_user_started_idx").on(t.userId, t.startedAt), uniqueIndex("meetings_bot_uidx").on(t.botId)]);

export type MeetingParticipantJson = { name: string; email?: string; contactId?: number | null; how?: string; self?: boolean };

/** One piece of a meeting's transcript: the segments of one audio chunk (or a bot's whole transcript), times relative to `startSec`. */
export const meetingChunks = pgTable("meeting_chunks", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  startSec: doublePrecision("start_sec").notNull().default(0),
  durationSec: doublePrecision("duration_sec").notNull().default(0),
  segments: jsonb("segments").$type<{ start: number; end: number; text: string; speaker?: string }[]>().notNull().default([]),
  engine: text("engine").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("meeting_chunks_seq_uidx").on(t.meetingId, t.seq)]);

/** Which contacts and deals a meeting is about, and how each was linked (email, name, new, manual, bot). */
export const meetingLinks = pgTable("meeting_links", {
  id: serial("id").primaryKey(),
  meetingId: integer("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(), // contact | deal
  refId: integer("ref_id").notNull(),
  how: text("how").notNull().default("manual"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("meeting_links_uidx").on(t.meetingId, t.kind, t.refId), index("meeting_links_ref_idx").on(t.userId, t.kind, t.refId)]);

/** Each person's copilot settings (see MeetingSettings in lib/meetings/model); normalized on every read. */
export const meetingSettings = pgTable("meeting_settings", {
  userId: text("user_id").primaryKey(),
  settings: jsonb("settings").$type<Record<string, unknown>>().notNull().default({}),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});
/* ---------------- Copy trading (drizzle/0023_copytrade.sql) ---------------- */

/** Every 13F filer seen in EDGAR's indexes, for search by name or CIK; curated managers marked. */
export const copyFilers = pgTable("copy_filers", {
  cik: text("cik").primaryKey(),
  name: text("name").notNull(),
  latestFiled: date("latest_filed"),
  latestPeriod: date("latest_period"),
  curated: boolean("curated").notNull().default(false),
  checkedAt: ts("checked_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("copy_filers_latest_idx").on(t.latestFiled)]);

/** A 13F-HR or 13F-HR/A as read, its holdings summed per security. */
export const copyFilings = pgTable("copy_filings", {
  accession: text("accession").primaryKey(),
  cik: text("cik").notNull(),
  form: text("form").notNull(),
  filedOn: date("filed_on").notNull(),
  period: date("period").notNull(),
  reportType: text("report_type").notNull().default("HOLDINGS"), // HOLDINGS | NOTICE | COMBINATION
  amendmentType: text("amendment_type"), // RESTATEMENT | NEW HOLDINGS
  confidentialOmitted: boolean("confidential_omitted").notNull().default(false),
  unitCorrected: boolean("unit_corrected").notNull().default(false),
  entryTotal: integer("entry_total"),
  valueTotal: doublePrecision("value_total"),
  holdings: jsonb("holdings").$type<import("@/lib/copytrade/thirteenf").Holding[]>().notNull().default([]),
  lines: integer("lines").notNull().default(0),
  docUrl: text("doc_url").notNull().default(""),
  tableUrl: text("table_url").notNull().default(""),
  status: text("status").notNull().default("ok"), // ok | error
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("copy_filings_cik_idx").on(t.cik, t.filedOn)]);

/** CUSIP to ticker and where the answer came from (manual | builtin | openfigi | name | none). */
export const copySecurities = pgTable("copy_securities", {
  cusip: text("cusip").primaryKey(),
  ticker: text("ticker"),
  issuer: text("issuer").notNull().default(""),
  title: text("title").notNull().default(""),
  cik: text("cik"),
  figi: text("figi"),
  sic: integer("sic"),
  sector: text("sector"),
  source: text("source").notNull().default("none"),
  hasOptions: boolean("has_options"),
  on13fList: text("on_13f_list"),
  checkedAt: ts("checked_at").notNull().defaultNow(),
}, (t) => [index("copy_securities_ticker_idx").on(t.ticker)]);

/** The owner's CUSIP corrections, which always win. */
export const copyCusipOverrides = pgTable("copy_cusip_overrides", {
  cusip: text("cusip").primaryKey(),
  ticker: text("ticker").notNull(),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull().default(""),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Funds a person follows (alerts on a new 13F). */
export const copyFollows = pgTable("copy_follows", {
  userId: text("user_id").notNull(),
  cik: text("cik").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.cik] }), index("copy_follows_cik_idx").on(t.cik)]);

/** A copy of one fund or a blend: paper (free) or live (a brokerage account). */
export const copyPortfolios = pgTable("copy_portfolios", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  mode: text("mode").notNull().default("paper"), // paper | live
  status: text("status").notNull().default("active"), // active | paused | closed
  funds: jsonb("funds").$type<{ cik: string; name: string; weight: number }[]>().notNull().default([]),
  rules: jsonb("rules").$type<Record<string, unknown>>().notNull().default({}),
  sizing: jsonb("sizing").$type<Record<string, unknown>>().notNull().default({}),
  trading: jsonb("trading").$type<Record<string, unknown>>().notNull().default({}),
  accountId: text("account_id"),
  managed: jsonb("managed").$type<Record<string, number>>().notNull().default({}),
  paper: jsonb("paper").$type<Record<string, unknown>>().notNull().default({}),
  lastAccession: text("last_accession"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("copy_portfolios_user_idx").on(t.userId, t.status)]);

/** A person's SnapTrade user; the secret encrypted at rest. */
export const copyBrokers = pgTable("copy_brokers", {
  userId: text("user_id").primaryKey(),
  snaptradeUser: text("snaptrade_user").notNull(),
  secretEnc: text("secret_enc").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSyncedAt: ts("last_synced_at"),
}, (t) => [uniqueIndex("copy_brokers_snap_uq").on(t.snaptradeUser)]);

/** Consents as given (kind and version of the text, when, from where). */
export const copyConsents = pgTable("copy_consents", {
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  textHash: text("text_hash").notNull().default(""),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.version] })]);

/** A reviewed set of orders for one copy. */
export const copyBatches = pgTable("copy_batches", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  portfolioId: integer("portfolio_id").notNull(),
  accountId: text("account_id").notNull(),
  status: text("status").notNull().default("proposed"), // proposed | placing | placed | partial | failed | canceled | expired
  idemKey: text("idem_key"),
  buyValue: doublePrecision("buy_value").notNull().default(0),
  sellValue: doublePrecision("sell_value").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull().default({}),
  accession: text("accession"),
  expiresAt: ts("expires_at").notNull(),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("copy_batches_user_idx").on(t.userId, t.createdAt)]);

/** One order of a batch; client_order_id is unique. */
export const copyOrders = pgTable("copy_orders", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  userId: text("user_id").notNull(),
  portfolioId: integer("portfolio_id").notNull(),
  seq: integer("seq").notNull(),
  clientOrderId: text("client_order_id").notNull(),
  ticker: text("ticker").notNull(),
  symbolId: text("symbol_id"),
  action: text("action").notNull(), // BUY | SELL
  units: doublePrecision("units").notNull(),
  orderType: text("order_type").notNull().default("Limit"),
  limitPrice: doublePrecision("limit_price"),
  estValue: doublePrecision("est_value").notNull().default(0),
  status: text("status").notNull().default("pending"), // pending | submitting | unknown | rejected | the broker's status
  brokerageOrderId: text("brokerage_order_id"),
  filledUnits: doublePrecision("filled_units").notNull().default(0),
  fillPrice: doublePrecision("fill_price"),
  error: text("error"),
  impact: jsonb("impact"),
  response: jsonb("response"),
  sentAt: ts("sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("copy_orders_client_uq").on(t.clientOrderId), index("copy_orders_batch_idx").on(t.batchId, t.seq), index("copy_orders_user_idx").on(t.userId, t.sentAt)]);

/** Append-only log of consents, connections, proposals, approvals and orders (UPDATE and DELETE are ruled out in SQL). */
export const copyAudit = pgTable("copy_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  portfolioId: integer("portfolio_id"),
  batchId: integer("batch_id"),
  orderId: integer("order_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("copy_audit_user_idx").on(t.userId, t.createdAt)]);

/* ---------------- Algorithmic and agentic trading (drizzle/0025_algo.sql) ---------------- */

/** Kill switches: one row per person; the administrators' global switch is user_id "__global__". */
export const algoSettings = pgTable("algo_settings", {
  userId: text("user_id").primaryKey(),
  kill: boolean("kill").notNull().default(false),
  killReason: text("kill_reason"),
  killBy: text("kill_by"),
  killAt: ts("kill_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Broker connections other than SnapTrade; credentials encrypted (lib/crm/crypto). */
export const algoConnections = pgTable("algo_connections", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  broker: text("broker").notNull(), // alpaca | webull | robinhood_crypto
  env: text("env").notNull().default("paper"), // paper | live
  label: text("label").notNull().default(""),
  secretEnc: text("secret_enc").notNull(),
  status: text("status").notNull().default("active"), // active | revoked | error
  lastError: text("last_error"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
}, (t) => [index("algo_connections_user_idx").on(t.userId, t.status)]);

/** A strategy: spec, mode, state, its paper account and its own live holdings. */
export const algoStrategies = pgTable("algo_strategies", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  spec: jsonb("spec").$type<Record<string, unknown>>().notNull(),
  mode: text("mode").notNull().default("paper"), // backtest | paper | live_approval | live_auto
  status: text("status").notNull().default("active"), // active | paused | archived
  kill: boolean("kill").notNull().default(false),
  killReason: text("kill_reason"),
  connection: text("connection"), // "paper" | "snaptrade" | "conn:<id>"
  accountId: text("account_id"),
  managed: jsonb("managed").$type<Record<string, number>>().notNull().default({}),
  paper: jsonb("paper").$type<import("@/lib/algo/brokers/paper").PaperState | null>(),
  paperStartedAt: ts("paper_started_at"),
  riskConfirmedAt: ts("risk_confirmed_at"),
  state: jsonb("state").$type<Record<string, unknown>>().notNull().default({}),
  equityPeak: doublePrecision("equity_peak"),
  equityDayStart: doublePrecision("equity_day_start"),
  equityDay: date("equity_day"),
  backtests: integer("backtests").notNull().default(0),
  lastDecision: jsonb("last_decision").$type<Record<string, unknown> | null>(),
  lastTickAt: ts("last_tick_at"),
  nextTickAt: ts("next_tick_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("algo_strategies_user_idx").on(t.userId, t.status), index("algo_strategies_due_idx").on(t.status, t.nextTickAt)]);

/** One equity mark per strategy per day. */
export const algoEquity = pgTable("algo_equity", {
  strategyId: integer("strategy_id").notNull(),
  date: date("date").notNull(),
  equity: doublePrecision("equity").notNull(),
  benchmark: doublePrecision("benchmark"),
}, (t) => [primaryKey({ columns: [t.strategyId, t.date] })]);

/** Each decision: the target, the signals and the reasons. */
export const algoDecisions = pgTable("algo_decisions", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  strategyId: integer("strategy_id").notNull(),
  userId: text("user_id").notNull(),
  source: text("source").notNull().default("engine"), // engine | agent | user
  mode: text("mode").notNull(),
  target: jsonb("target").$type<Record<string, number>>().notNull().default({}),
  signals: jsonb("signals").$type<unknown[]>().notNull().default([]),
  notes: text("notes").notNull().default(""),
  orders: integer("orders").notNull().default(0),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("algo_decisions_strategy_idx").on(t.strategyId, t.createdAt)]);

/** A set of orders for one strategy (proposed -> placing once). */
export const algoBatches = pgTable("algo_batches", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  strategyId: integer("strategy_id").notNull(),
  decisionId: bigint("decision_id", { mode: "number" }),
  source: text("source").notNull().default("engine"),
  accountId: text("account_id").notNull(),
  status: text("status").notNull().default("proposed"),
  idemKey: text("idem_key"),
  buyValue: doublePrecision("buy_value").notNull().default(0),
  sellValue: doublePrecision("sell_value").notNull().default(0),
  orderCount: integer("order_count").notNull().default(0),
  proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull().default({}),
  expiresAt: ts("expires_at").notNull(),
  approvedAt: ts("approved_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("algo_batches_user_idx").on(t.userId, t.createdAt), index("algo_batches_strategy_idx").on(t.strategyId, t.status)]);

/** One order (or TWAP slice); client_order_id unique. */
export const algoOrders = pgTable("algo_orders", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id").notNull(),
  userId: text("user_id").notNull(),
  strategyId: integer("strategy_id").notNull(),
  seq: integer("seq").notNull(),
  slice: integer("slice").notNull().default(0),
  slices: integer("slices").notNull().default(1),
  clientOrderId: text("client_order_id").notNull(),
  symbol: text("symbol").notNull(),
  assetClass: text("asset_class").notNull().default("equity"),
  symbolId: text("symbol_id"),
  action: text("action").notNull(), // BUY | SELL
  units: doublePrecision("units").notNull(),
  orderType: text("order_type").notNull().default("Limit"),
  limitPrice: doublePrecision("limit_price"),
  estValue: doublePrecision("est_value").notNull().default(0),
  status: text("status").notNull().default("pending"),
  brokerOrderId: text("broker_order_id"),
  filledUnits: doublePrecision("filled_units").notNull().default(0),
  fillPrice: doublePrecision("fill_price"),
  error: text("error"),
  impact: jsonb("impact"),
  response: jsonb("response"),
  notBefore: ts("not_before"),
  sentAt: ts("sent_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("algo_orders_client_uq").on(t.clientOrderId), index("algo_orders_batch_idx").on(t.batchId, t.seq, t.slice), index("algo_orders_strategy_idx").on(t.strategyId, t.sentAt), index("algo_orders_user_idx").on(t.userId, t.sentAt)]);

/** Consents as given, per strategy for autonomous trading (0 for account-wide), with the typed words. */
export const algoConsents = pgTable("algo_consents", {
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  strategyId: integer("strategy_id").notNull().default(0),
  version: text("version").notNull(),
  textHash: text("text_hash").notNull().default(""),
  typed: text("typed"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.strategyId, t.version] })]);

/** The agent's conversation. */
export const algoAgentMessages = pgTable("algo_agent_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(), // user | agent
  content: text("content").notNull(),
  calls: jsonb("calls").$type<unknown[]>().notNull().default([]),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("algo_agent_user_idx").on(t.userId, t.createdAt)]);

/** Saved backtest results. */
export const algoBacktests = pgTable("algo_backtests", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  strategyId: integer("strategy_id"),
  specHash: text("spec_hash").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("algo_backtests_user_idx").on(t.userId, t.strategyId, t.createdAt)]);

/** Append-only log (UPDATE and DELETE are ruled out in SQL). */
export const algoAudit = pgTable("algo_audit", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  userId: text("user_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  strategyId: integer("strategy_id"),
  batchId: integer("batch_id"),
  orderId: integer("order_id"),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("algo_audit_user_idx").on(t.userId, t.createdAt)]);

/* ---------------- Quant Edge (docs/quant-edge.md; drizzle/0026_quant.sql) ---------------- */

/** QF1: one QuantSignal (src/lib/quant/contracts.ts) per row; the id is deterministic, so re-runs upsert. */
export const quantSignals = pgTable("quant_signals", {
  id: text("id").primaryKey(),
  producer: text("producer").notNull(),
  producerVersion: text("producer_version").notNull(),
  symbol: text("symbol").notNull(),
  cik: text("cik"),
  assetClass: text("asset_class").notNull().default("equity"),
  asOf: ts("as_of").notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
  reconstructed: boolean("reconstructed").notNull().default(false),
  validUntil: ts("valid_until").notNull(),
  horizonDays: integer("horizon_days").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  forecastId: bigint("forecast_id", { mode: "number" }),
}, (t) => [index("quant_signals_producer_idx").on(t.producer, t.asOf), index("quant_signals_symbol_idx").on(t.symbol, t.asOf)]);

/** QF1: TargetPortfolio versions per definition key ('copy:34', 'sleeve:12', 'algo:strategy:56'). */
export const quantTargets = pgTable("quant_targets", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  targetKey: text("target_key").notNull(),
  ownerId: text("owner_id"),
  version: integer("version").notNull(),
  asOf: ts("as_of").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("quant_targets_key_version_uq").on(t.targetKey, t.version), index("quant_targets_key_idx").on(t.targetKey, t.asOf)]);

/** QF2/Q3: every backtest run is a trial of its family. Append-only (UPDATE and DELETE are ruled out in SQL). */
export const quantTrials = pgTable("quant_trials", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ownerId: text("owner_id"),
  family: text("family").notNull(),
  params: jsonb("params").$type<Record<string, unknown>>().notNull(),
  paramsHash: text("params_hash").notNull().default(""),
  returnsRef: text("returns_ref").notNull(),
  returns: jsonb("returns").$type<number[] | null>(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  periodsPerYear: integer("periods_per_year").notNull().default(252),
  sharpe: real("sharpe"),
  nObs: integer("n_obs"),
  skew: real("skew"),
  kurt: real("kurt"),
  hygiene: jsonb("hygiene").$type<Record<string, unknown>>().notNull().default({}),
  source: text("source").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("quant_trials_family_idx").on(t.family), index("quant_trials_owner_idx").on(t.ownerId, t.createdAt)]);

/** Saved analyses (integrity reports, factor, risk and TCA runs, risk budgets, drills, overrides), owner-scoped. */
export const quantRuns = pgTable("quant_runs", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ownerId: text("owner_id").notNull(),
  kind: text("kind").notNull(),
  input: jsonb("input").$type<Record<string, unknown>>().notNull(),
  output: jsonb("output").$type<Record<string, unknown>>().notNull(),
  sources: jsonb("sources").$type<unknown[]>().notNull().default([]),
  modelVersion: text("model_version").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("quant_runs_owner_idx").on(t.ownerId, t.kind, t.createdAt)]);

/** Q5: a person's own executions; owner-scoped, deletable, never pooled. */
export const quantFills = pgTable("quant_fills", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  ownerId: text("owner_id").notNull(),
  source: text("source").notNull(),
  accountRef: text("account_ref").notNull(),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  qty: doublePrecision("qty").notNull(),
  price: doublePrecision("price").notNull(),
  executedAt: ts("executed_at").notNull(),
  placedAt: ts("placed_at"),
  orderType: text("order_type"),
  limitPrice: doublePrecision("limit_price"),
  broker: text("broker"),
  fees: doublePrecision("fees"),
  extId: text("ext_id").notNull(),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("quant_fills_ext_uq").on(t.ownerId, t.source, t.extId), index("quant_fills_owner_idx").on(t.ownerId, t.executedAt)]);

/** QF4: daily factor returns by universe and version. */
export const quantFactorReturns = pgTable("quant_factor_returns", {
  date: date("date").notNull(),
  factor: text("factor").notNull(),
  universe: text("universe").notNull(),
  version: text("version").notNull(),
  ret: doublePrecision("ret").notNull(),
}, (t) => [primaryKey({ columns: [t.date, t.factor, t.universe, t.version] }), index("quant_factor_returns_factor_idx").on(t.factor, t.universe, t.version, t.date)]);

/** QF3: the point-in-time universe. */
export const quantUniverse = pgTable("quant_universe", {
  symbol: text("symbol").notNull(),
  cik: text("cik"),
  name: text("name").notNull(),
  exchange: text("exchange"),
  shareClass: text("share_class"),
  securityType: text("security_type").notNull(),
  firstDate: date("first_date").notNull(),
  lastDate: date("last_date"),
  successor: text("successor"),
  rank: integer("rank"),
  marketCap: doublePrecision("market_cap"),
  hasPrices: boolean("has_prices").notNull().default(false),
  source: text("source").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.symbol, t.firstDate] }), index("quant_universe_cik_idx").on(t.cik), index("quant_universe_rank_idx").on(t.rank)]);

/** Q7: open-market insider transaction lines from Form 4, timed from EDGAR acceptance. */
export const quantInsiderTx = pgTable("quant_insider_tx", {
  accession: text("accession").notNull(),
  line: integer("line").notNull(),
  issuerCik: text("issuer_cik").notNull(),
  symbol: text("symbol").notNull().default(""),
  ownerCik: text("owner_cik").notNull().default(""),
  ownerName: text("owner_name").notNull(),
  isDirector: boolean("is_director").notNull().default(false),
  isOfficer: boolean("is_officer").notNull().default(false),
  isTenPct: boolean("is_ten_pct").notNull().default(false),
  officerTitle: text("officer_title").notNull().default(""),
  code: text("code").notNull(),
  acquired: boolean("acquired").notNull().default(true),
  shares: doublePrecision("shares").notNull().default(0),
  price: doublePrecision("price"),
  ownedAfter: doublePrecision("owned_after"),
  tradeDate: date("trade_date").notNull(),
  acceptedAt: ts("accepted_at").notNull(),
  plan10b51: boolean("plan_10b5_1").notNull().default(false),
  form: text("form").notNull().default("4"),
  source: text("source").notNull().default("live"),
  url: text("url").notNull().default(""),
}, (t) => [primaryKey({ columns: [t.accession, t.line] }), index("quant_insider_tx_issuer_idx").on(t.issuerCik, t.tradeDate), index("quant_insider_tx_accepted_idx").on(t.acceptedAt), index("quant_insider_tx_owner_idx").on(t.ownerCik, t.tradeDate)]);

/** The Quant hub's consent (quant.terms), as given. */
export const quantConsents = pgTable("quant_consents", {
  userId: text("user_id").notNull(),
  kind: text("kind").notNull(),
  version: text("version").notNull(),
  textHash: text("text_hash").notNull().default(""),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.userId, t.kind, t.version] })]);

/** QF5/Q7: detected market events (insider clusters, new 13Ds), timed from EDGAR acceptance. */
export const quantEvents = pgTable("quant_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  issuerCik: text("issuer_cik").notNull(),
  symbol: text("symbol").notNull().default(""),
  occurredAt: date("occurred_at").notNull(),
  acceptedAt: ts("accepted_at").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts("created_at").notNull().defaultNow(),
}, (t) => [index("quant_events_type_idx").on(t.type, t.acceptedAt), index("quant_events_issuer_idx").on(t.issuerCik, t.acceptedAt)]);

/** QF5: base rates per event definition and version. */
export const quantBaseRates = pgTable("quant_base_rates", {
  key: text("key").primaryKey(),
  eventType: text("event_type").notNull(),
  version: text("version").notNull(),
  body: jsonb("body").$type<Record<string, unknown>>().notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
});
