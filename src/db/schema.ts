import { boolean, doublePrecision, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("crm_messages_thread_idx").on(t.threadId, t.sentAt), index("crm_messages_rfc_idx").on(t.rfcMessageId)]);

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
  meta: jsonb("meta").$type<{ step?: number; ruleId?: number; signalId?: number; actionId?: number; audience?: string; category?: string }>().notNull().default({}),
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
