/**
 * The nightly kill-criteria check as a Cloudflare Workflow. YouBank's evening cron starts one instance; it
 * asks YouBank for tonight's plan, fetches insider selling and new filings once for everyone, then checks each
 * book's kill criteria as its own durable step. A step that fails is retried on its own with backoff (a
 * slow SEC answer for one book never re-runs the books already done), and a book that keeps failing is
 * counted and skipped so the rest still get checked. What changed lands in each person's Needs you queue,
 * written by YouBank inside the `check` step (POST /api/cf/book), which also warms that book's risk.
 */
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { AppError, callApp } from "./app";
import type { Env } from "./env";

type Plan = { users: string[]; insiderTickers: string[]; heldTickers: string[] };
/**
 * Books per instance: one step each plus three, under the 1,024 steps an instance may take. The plan is least
 * recently checked first, so any beyond this go first tomorrow.
 */
export const MAX_BOOKS = 1_000;
const RETRY = { retries: { limit: 3, delay: "30 seconds", backoff: "exponential" }, timeout: "5 minutes" } as const;

/** Run one step's call; a refusal that cannot change (4xx) stops retrying at once. */
async function step<T>(env: Env, body: unknown, timeoutMs = 280_000): Promise<T> {
  try { return await callApp<T>(env, "/api/cf/book", body, timeoutMs); }
  catch (e) { if (e instanceof AppError && e.permanent) throw new NonRetryableError(e.message); throw e; }
}

export class KillCriteriaWorkflow extends WorkflowEntrypoint<Env, { at?: string }> {
  async run(_event: Readonly<WorkflowEvent<{ at?: string }>>, s: WorkflowStep) {
    const plan = await s.do("plan", RETRY, () => step<Plan>(this.env, { action: "plan" }, 60_000));
    if (plan.insiderTickers.length) await s.do("insider selling", RETRY, () => step<{ done: number }>(this.env, { action: "insiders", tickers: plan.insiderTickers }));
    if (plan.heldTickers.length) await s.do("new filings", RETRY, () => step<{ done: number }>(this.env, { action: "filings", tickers: plan.heldTickers }));
    const users = plan.users.slice(0, MAX_BOOKS);
    let alerts = 0, failed = 0;
    for (const userId of users) {
      try { alerts += (await s.do(`check ${userId}`, RETRY, () => step<{ alerts: number }>(this.env, { action: "check", userId }, 120_000))).alerts; }
      catch { failed++; }
    }
    return { people: plan.users.length, checked: users.length - failed, alerts, failed, deferred: plan.users.length - users.length };
  }
}
