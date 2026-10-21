/**
 * Is the database ready for the app? Configured (DATABASE_URL), reachable, and with the schema and every
 * migration in drizzle/ applied. Server only.
 *
 * Pages use `setupState()` to show a calm "YouBank is being set up" screen instead of crashing while a
 * deploy is ahead of its database; /api/health uses `schemaStatus()` to name what is missing. Each
 * migration is checked by the tables it creates and its last index (a replay that stopped half way
 * leaves those out). `pnpm exec tsx scripts/db-setup.mts finish` applies them all.
 */
import { sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { shared } from "./shared";

/** Tables the schema push creates and every page needs. */
export const CORE_TABLES = ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "profiles", "kv_cache"];

/** drizzle/NNNN_*.sql: the tables each creates and its last index ("" when it creates none). */
export const MIGRATIONS: [string, string[], string][] = [
  ["0001_teams", ["teams", "team_members", "team_invites"], "team_invites_email_idx"],
  ["0002_crm", ["email_accounts", "crm_contacts", "crm_deals", "crm_threads", "crm_messages", "crm_drafts"], "crm_drafts_thread_idx"],
  ["0003_collab", ["collab_sessions", "collab_events", "collab_presence"], "collab_presence_session_user_uidx"],
  ["0004_outreach", ["crm_settings", "crm_actions", "crm_signals", "crm_nurture_rules", "crm_nurture_log", "crm_campaigns", "crm_campaign_leads"], "crm_campaign_leads_user_email_idx"],
  ["0005_autopilot", ["crm_questions", "crm_playbook"], "crm_playbook_user_idx"],
  ["0006_adaptive", ["crm_trust", "crm_arms", "crm_lessons", "crm_learning_events"], "crm_learning_events_user_idx"],
  ["0007_studio", ["studio_docs", "studio_events", "studio_runs"], "studio_runs_doc_idx"],
  ["0008_office", ["office_pairings", "office_devices", "studio_checkpoints"], "studio_checkpoints_doc_idx"],
  ["0009_ai_usage", ["ai_usage"], "ai_usage_user_idx"],
  ["0010_contact_knowledge", [], ""],
  ["0011_newsroom", ["news_feeds", "news_items", "news_clusters", "news_deals", "news_briefs", "news_user_items", "news_notifications", "news_push_subs"], "news_push_subs_user_idx"],
  ["0012_launch", [], "crm_drafts_campaign_sent_idx"],
  ["0013_edge", ["edge_assets", "edge_watches", "edge_detections", "edge_provenance"], "edge_provenance_subject_idx"],
  ["0014_edge_platform", ["edge_files", "edge_usage", "edge_canvases", "edge_canvas_events", "edge_runs", "edge_run_steps", "edge_monitors", "edge_stories", "edge_docs", "edge_chunks", "edge_answers", "edge_nodes", "edge_links", "edge_models", "edge_predictions", "edge_scenarios", "edge_alerts", "edge_pushes"], "edge_pushes_target_idx"],
  ["0015_plans", ["subscriptions"], "subscriptions_stripe_customer_idx"],
  ["0016_crypto", ["crypto_addresses", "crypto_cost_basis", "crypto_notarizations"], "crypto_notarizations_sha_idx"],
  ["0017_desktop", ["desktop_pairings", "desktop_devices", "desktop_files"], "desktop_files_user_sha_idx"],
  ["0018_calendar", ["calendar_accounts", "calendar_calendars", "calendar_events", "calendar_prefs", "calendar_briefs"], "calendar_briefs_user_idx"],
  ["0019_meetings", ["meetings", "meeting_chunks", "meeting_links", "meeting_settings"], "crm_actions_meeting_idx"],
  ["0020_edge_next", ["edge_entity_ids", "edge_series", "edge_forecasts", "edge_deals", "edge_deal_fields", "edge_agents", "edge_agent_steps", "edge_job_state"], "edge_agents_due_idx"],
  ["0021_newsroom_plus", ["news_follows", "news_briefings"], "news_briefings_user_slot_kind_uidx"],
  ["0022_credits", ["ai_credit_grants", "ai_credit_draws", "seat_assignments"], "seat_assignments_owner_idx"],
  ["0023_copytrade", ["copy_filers", "copy_filings", "copy_securities", "copy_cusip_overrides", "copy_follows", "copy_portfolios", "copy_brokers", "copy_consents", "copy_batches", "copy_orders", "copy_audit"], "copy_audit_user_idx"],
  ["0024_seat_cooldown", ["seat_history"], "seat_history_owner_idx"],
  ["0025_algo", ["algo_settings", "algo_connections", "algo_strategies", "algo_equity", "algo_decisions", "algo_batches", "algo_orders", "algo_consents", "algo_agent_messages", "algo_backtests", "algo_audit"], "algo_audit_user_idx"],
  ["0026_quant", ["quant_signals", "quant_targets", "quant_trials", "quant_runs", "quant_fills", "quant_factor_returns", "quant_universe", "quant_insider_tx", "quant_consents", "quant_events", "quant_base_rates"], "quant_events_issuer_idx"],
  ["0027_scale", ["ai_spend"], "ai_spend_day_idx"],
  ["0028_source_stats", ["source_stats"], "source_stats_minute_idx"],
  ["0029_data_sources", ["user_data_sources"], "user_data_sources_updated_idx"],
];

/** Columns a migration adds to an existing table, checked separately (to_regclass cannot see them). */
const COLUMNS: [string, string, string][] = [["0010_contact_knowledge", "crm_messages", "topics"]];

export type SchemaStatus = { core: string[]; migrations: { name: string; missing: string[] }[] };

/** Every relation (table or index) the schema and migrations should have. Pure. */
export function expectedRelations(): string[] {
  return [...CORE_TABLES, ...MIGRATIONS.flatMap(([, tables, index]) => (index ? [...tables, index] : tables))];
}

/** Group what is missing by migration. Pure: `absent` is relation names, `absentColumns` "table.column". */
export function summarize(absent: Iterable<string>, absentColumns: Iterable<string> = []): SchemaStatus {
  const gone = new Set(absent), cols = new Set(absentColumns);
  const core = CORE_TABLES.filter((t) => gone.has(t));
  const migrations = MIGRATIONS.map(([name, tables, index]) => ({
    name,
    missing: [...tables.filter((t) => gone.has(t)), ...(index && gone.has(index) ? [index] : []), ...COLUMNS.filter(([m, t, c]) => m === name && cols.has(`${t}.${c}`)).map(([, t, c]) => `${t}.${c}`)],
  })).filter((m) => m.missing.length);
  return { core, migrations };
}

/** One round trip: which expected relations and columns do not exist. */
export async function schemaStatus(d: Db): Promise<SchemaStatus> {
  const names = expectedRelations();
  const list = sql.join(names.map((n) => sql`${n}`), sql`, `);
  const r = await d.execute<{ name: string }>(sql`select n as name from unnest(array[${list}]::text[]) as n where to_regclass('public.' || quote_ident(n)) is null`);
  const colChecks = sql.join(COLUMNS.map(([, t, c]) => sql`(${`${t}.${c}`}, ${t}, ${c})`), sql`, `);
  const c = await d.execute<{ name: string }>(sql`select v.name from (values ${colChecks}) as v(name, t, c)
    where not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = v.t and column_name = v.c)`);
  return summarize(r.rows.map((x) => x.name), c.rows.map((x) => x.name));
}

export type SetupState = { ready: true } | { ready: false; reason: "database" | "schema" | "auth" };

/** Per process (src/lib/shared): the layout, pages and routes are separate build layers with their own module copies. */
const ready = shared("setup:ready", () => ({ until: 0 }));

/**
 * For pages: whether to render the app or the "being set up" screen. Only configuration and the core
 * tables decide it (a missing feature migration leaves that feature's own message, not the whole app);
 * a database that cannot be reached is an outage, not setup, so a failed check answers ready and the
 * error pages handle what follows. A ready answer is
 * remembered for five minutes per instance, so this costs a query at most that often.
 */
export async function setupState(): Promise<SetupState> {
  if (!db) return { ready: false, reason: "database" };
  // The development sign-in (YOUBANK_DEV_USER, never in production builds) needs no auth secret.
  const devUser = process.env.NODE_ENV !== "production" && !!process.env.YOUBANK_DEV_USER;
  if (!devUser && !process.env.BETTER_AUTH_SECRET?.trim()) return { ready: false, reason: "auth" };
  if (Date.now() < ready.until) return { ready: true };
  let missing: number;
  try {
    const r = await db.execute<{ name: string }>(sql`select n as name from unnest(array[${sql.join(CORE_TABLES.map((n) => sql`${n}`), sql`, `)}]::text[]) as n where to_regclass('public.' || quote_ident(n)) is null`);
    missing = r.rows.length;
  } catch {
    // The check itself failed (a slow or unreachable database): serve the app, not "being set up". The
    // page's own queries then succeed or reach the error screen; nothing is remembered, so the next
    // request checks again.
    return { ready: true };
  }
  if (missing) return { ready: false, reason: "schema" };
  ready.until = Date.now() + 5 * 60_000;
  return { ready: true };
}
