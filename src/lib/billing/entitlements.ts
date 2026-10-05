/**
 * Who may use what. Server only.
 *
 * A person's plan comes from their `subscriptions` row (written by billing) or a Deal Team or Enterprise
 * seat someone else's subscription gives them (./seats), whichever is higher; without either it is Campus
 * for a .edu address and Free otherwise. Administrators (ADMIN_EMAILS) are treated as Enterprise. A
 * subscription that has lapsed (canceled, unpaid) falls back to the free plan, for its seat holders too.
 *
 * Routes that start a premium feature call `requireFeature` before doing any paid work; the error it
 * throws carries status 402 and a plain message, so `guarded()` shows it to the person as written.
 */
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { isAdmin } from "@/lib/auth/admin";
import type { CurrentUser } from "@/lib/auth/user";
import { featureById, FEATURES } from "./features";
import { isPlanId, LIVE_STATUSES, planAtLeast, PLANS, type PlanId } from "./plans";
import { heldSeat } from "./seats";

export type Entitlements = {
  plan: PlanId;
  admin: boolean;
  status: string;
  /** Ids of the premium features this person may use. */
  features: string[];
  /**
   * The billing anchor (ISO) the AI allowance resets on, monthly: the person's own live subscription's,
   * or the owner's for an assigned seat. Null means the calendar month.
   */
  anchor: string | null;
  /** Set when the plan comes from a seat on someone else's subscription. */
  seat: { owner: string | null; team: string | null } | null;
};

const LIVE = new Set(LIVE_STATUSES);

const isCampusEmail = (email: string) => /\.edu$/i.test(email.trim().split("@")[1] ?? "");

type OwnRow = { plan: string; status: string; billingAnchor?: Date | null };

/**
 * The person's own subscription row. Reads the billing anchor too, but falls back to the columns from
 * drizzle/0015 when 0022 has not been applied yet, so a deploy that lands before the migration keeps
 * everyone's plan.
 */
async function ownRow(userId: string): Promise<OwnRow | null> {
  if (!db) return null;
  const t = schema.subscriptions;
  const where = eq(t.userId, userId);
  const [row] = await db.select({ plan: t.plan, status: t.status, billingAnchor: t.billingAnchor }).from(t).where(where)
    .catch(() => db!.select({ plan: t.plan, status: t.status }).from(t).where(where))
    .catch(() => []);
  return row ?? null;
}

/** This person's plan and what it unlocks; one lookup per request. */
export const entitlements = cache(async (user: Pick<CurrentUser, "id" | "email">): Promise<Entitlements> => {
  const admin = isAdmin(user);
  let plan: PlanId = isCampusEmail(user.email) ? "campus" : "free";
  let status = "none";
  let anchor: Date | null = null;
  const row = await ownRow(user.id);
  if (row) {
    status = row.status;
    if (LIVE.has(row.status) && isPlanId(row.plan) && planAtLeast(row.plan, plan)) {
      plan = row.plan;
      anchor = row.billingAnchor ?? null;
    }
  }
  let seat: Entitlements["seat"] = null;
  if (db && !planAtLeast(plan, "enterprise")) {
    const held = await heldSeat(user.id).catch(() => null);
    if (held && planAtLeast(held.plan, plan) && held.plan !== plan) {
      plan = held.plan;
      anchor = held.anchor;
      seat = { owner: held.ownerEmail, team: held.teamName };
    }
  }
  if (admin) plan = "enterprise";
  const features = FEATURES.filter((f) => admin || planAtLeast(plan, f.minPlan)).map((f) => f.id);
  return { plan, admin, status, features, anchor: anchor ? anchor.toISOString() : null, seat };
});

export async function canUse(user: Pick<CurrentUser, "id" | "email">, featureId: string): Promise<boolean> {
  return (await entitlements(user)).features.includes(featureId);
}

export class PremiumRequiredError extends Error {
  /** Read by `guarded()`: below 500, so the message reaches the person as written. */
  readonly status = 402;
  constructor(readonly featureId: string, readonly minPlan: PlanId) {
    const f = featureById(featureId);
    super(`${f?.name ?? "This feature"} is part of the ${PLANS[minPlan].name} plan. Upgrade in Settings, under Plan, to use it.`);
    this.name = "PremiumRequiredError";
  }
}

/** Throw unless this person may use the feature. Call before any paid work starts. */
export async function requireFeature(user: Pick<CurrentUser, "id" | "email">, featureId: string): Promise<void> {
  const f = featureById(featureId);
  if (!f) throw new Error(`Unknown premium feature: ${featureId}`);
  if (!(await canUse(user, featureId))) throw new PremiumRequiredError(featureId, f.minPlan);
}
