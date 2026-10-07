import { and, eq, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { scanFollowUps, scanSignals, scanStaleDeals } from "./actions";
import { considerDraft } from "./autopilot";
import { settleOutreach } from "./engine";
import { getSettings } from "./settings";
import { prepareCampaign } from "./campaigns";
import { runRule } from "./nurture";
import { markRun } from "./settings";
import { describeFailure } from "@/lib/errors";
import { CAMPAIGNS, planAllows } from "./plan";

export type AgentRunResult = {
  signals: number; followUps: number; checkIns: number;
  nurture: { drafted: number; skipped: number };
  campaigns: { drafted: number; waitingForEmail: number };
  /** Of everything drafted, how many autopilot scheduled to send on its own. */
  scheduled: number;
  errors: string[]; stoppedEarly: boolean;
};

/**
 * One pass of the agent over a person's CRM.
 *
 * Scans first (free: they only read), then the work that calls the model (nurture rules and due
 * campaign steps), each bounded by its own daily cap and all of it by `deadline`. Everything it
 * writes lands in the review queue or the suggestions list; drafts of a kind the person set to
 * autopilot are scheduled, and the send queue sends them in their sending hours. Nothing is sent here.
 */
export async function runAgent(userId: string, deadline = Date.now() + 240_000): Promise<AgentRunResult> {
  const db = requireDb();
  const out: AgentRunResult = { signals: 0, followUps: 0, checkIns: 0, nurture: { drafted: 0, skipped: 0 }, campaigns: { drafted: 0, waitingForEmail: 0 }, scheduled: 0, errors: [], stoppedEarly: false };
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try { return await fn(); } catch (e) { out.errors.push(`${label}: ${describeFailure(e, 502, `agent:${label}`).message}`); return null; }
  };

  out.signals = (await attempt("signals", () => scanSignals(userId))) ?? 0;
  out.followUps = (await attempt("follow-ups", () => scanFollowUps(userId))) ?? 0;
  out.checkIns = (await attempt("stale deals", () => scanStaleDeals(userId))) ?? 0;

  const rules = await db.select().from(schema.crmNurtureRules).where(and(eq(schema.crmNurtureRules.userId, userId), eq(schema.crmNurtureRules.enabled, true)));
  for (const rule of rules) {
    if (Date.now() > deadline) { out.stoppedEarly = true; break; }
    const r = await attempt(`nurture "${rule.name}"`, () => runRule(userId, rule, deadline));
    if (r) {
      out.nurture.drafted += r.drafted; out.nurture.skipped += r.skipped; out.errors.push(...r.errors);
      for (const id of r.draftIds) if ((await considerDraft(userId, id)).scheduled) out.scheduled++;
    }
  }

  // Campaigns are premium: their steps are drafted overnight only for plans that include them.
  const active = await db.select().from(schema.crmCampaigns).where(and(eq(schema.crmCampaigns.userId, userId), eq(schema.crmCampaigns.status, "active")));
  const campaigns = active.length && (await planAllows(userId, CAMPAIGNS)) ? active : [];
  for (const c of campaigns) {
    if (Date.now() > deadline) { out.stoppedEarly = true; break; }
    const r = await attempt(`campaign "${c.name}"`, () => prepareCampaign(userId, c.id, deadline));
    if (r) {
      out.campaigns.drafted += r.drafted; out.campaigns.waitingForEmail += r.waitingForEmail; out.errors.push(...r.errors);
      for (const id of r.draftIds) if ((await considerDraft(userId, id)).scheduled) out.scheduled++;
    }
  }

  // Outreach experiments: first emails that have waited out the reply window count against their angle.
  await attempt("outreach learning", async () => settleOutreach(userId, (await getSettings(userId)).autopilot.window.tz));

  await markRun(userId);
  return out;
}

/**
 * Everyone the nightly run should visit: people with a CRM who have not turned the nightly run off,
 * least recently run first, so a run that hits the time limit picks up where the last one stopped.
 */
export async function nightlyUsers(): Promise<string[]> {
  const db = requireDb();
  const rows = await db.execute(sql`
    select u.user_id as "userId"
    from (select distinct user_id from ${schema.crmContacts}
          union select distinct user_id from ${schema.crmCampaigns}
          union select distinct user_id from ${schema.crmNurtureRules}) u
    left join ${schema.crmSettings} s on s.user_id = u.user_id
    where s.user_id is null or s.nightly
    order by s.last_run_at asc nulls first`);
  return (rows.rows as { userId: string }[]).map((r) => r.userId);
}
