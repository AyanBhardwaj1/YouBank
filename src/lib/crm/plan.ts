/**
 * Which parts of the relationships agent a person's plan includes. Server only.
 *
 * Reading mail, triage and drafts that wait for a person stay open to everyone. Three things are
 * premium (lib/billing/features/premium.ts):
 * - more than one mailbox (relationships.extra-mailboxes);
 * - Autopilot, sending on its own (relationships.autopilot): switching it on is checked here, and the
 *   scheduler re-checks the plan before every automatic send, so a plan that lapses stops autopilot
 *   without anyone changing a setting (drafts then wait for the person, as with autopilot off);
 * - campaigns (relationships.campaigns): creating, launching and drafting them, by hand or on schedule.
 * The scheduler asks by person id; answers are kept a minute so a busy pass reads the plan once.
 */
import { requireFeature } from "@/lib/billing/entitlements";
import { canUseById } from "@/lib/billing/use";
import type { CurrentUser } from "@/lib/auth/user";
import { listAccounts } from "./accounts";

export const MAILBOXES = "relationships.extra-mailboxes";
export const AUTOPILOT = "relationships.autopilot";
export const CAMPAIGNS = "relationships.campaigns";

const memo = new Map<string, { at: number; ok: boolean }>();

/** Whether a person's plan includes a relationships feature, for the scheduler (no request, no email at hand). */
export async function planAllows(userId: string, feature: string): Promise<boolean> {
  const key = `${userId}:${feature}`;
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const ok = await canUseById(userId, feature).catch(() => false);
  if (memo.size > 5_000) memo.clear();
  memo.set(key, { at: Date.now(), ok });
  return ok;
}

/** Before connecting a mailbox: a second (different) address needs the plan that includes more mailboxes. */
export async function requireMailboxRoom(user: Pick<CurrentUser, "id" | "email">, address: string): Promise<void> {
  const others = (await listAccounts(user.id)).filter((a) => a.address !== address.trim().toLowerCase());
  if (others.length) await requireFeature(user, MAILBOXES);
}
