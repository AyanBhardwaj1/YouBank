import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, customType, date, doublePrecision, halfvec, index, integer, jsonb, pgTable, primaryKey, real, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
}, (t) => [index("kv_cache_expires_idx").on(t.expiresAt)]);

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
  meta: jsonb("meta").$type<{ step?: number; ruleId?: number; signalId?: number; actionId?: number; audience?: string; category?: string; ticker?: string; path?: string[] }>().notNull().default({}),
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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("crm_actions_user_dedupe_uidx").on(t.userId, t.dedupeKey),
  index("crm_actions_user_status_idx").on(t.userId, t.status),
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
}, (t) => [primaryKey({ columns: [t.userId, t.clusterId] }), index("news_user_items_saved_idx").on(t.userId, t.savedAt)]);

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
}, (t) => [uniqueIndex("news_notifications_user_key_uidx").on(t.userId, t.key), index("news_notifications_user_idx").on(t.userId, t.createdAt)]);

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
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
}, (t) => [index("subscriptions_stripe_customer_idx").on(t.stripeCustomerId)]);


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
