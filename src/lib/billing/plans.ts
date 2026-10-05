/**
 * The plans, in order from least to most. Pure data, safe to import on the client.
 *
 * Prices here are placeholders from the README's planned table; the pricing work replaces them with
 * prices worked out from what each plan costs to serve (docs/pricing.md). Stripe price ids live in the
 * environment, never here.
 */

export type PlanId = "free" | "campus" | "pro" | "team" | "enterprise";

export const PLAN_ORDER: PlanId[] = ["free", "campus", "pro", "team", "enterprise"];

export type Plan = {
  id: PlanId;
  name: string;
  /** List price in US dollars per seat per month, billed monthly; null when there is no list price. */
  monthlyUsd: number | null;
  /** Per seat per month when billed yearly; null when not offered. */
  yearlyMonthlyUsd: number | null;
  minSeats: number;
  /** One line on who it is for. */
  blurb: string;
};

export const PLANS: Record<PlanId, Plan> = {
  free: { id: "free", name: "Free", monthlyUsd: 0, yearlyMonthlyUsd: 0, minSeats: 1, blurb: "The terminal and public data, with a daily AI allowance." },
  campus: { id: "campus", name: "Campus", monthlyUsd: 0, yearlyMonthlyUsd: 0, minSeats: 1, blurb: "Students with a .edu address: the full terminal, a monthly AI allowance and a recruiting pack." },
  pro: { id: "pro", name: "Pro", monthlyUsd: 39, yearlyMonthlyUsd: 29, minSeats: 1, blurb: "Individuals: higher limits, the relationships agent and one mailbox." },
  team: { id: "team", name: "Deal Team", monthlyUsd: 149, yearlyMonthlyUsd: null, minSeats: 3, blurb: "Teams: autopilot and campaigns, the adaptive engine across the team, shared workspaces." },
  enterprise: { id: "enterprise", name: "Enterprise", monthlyUsd: 249, yearlyMonthlyUsd: 249, minSeats: 3, blurb: "Firms: regulated mode, SSO and admin controls, data residency, bring-your-own data licences." },
};

/** Whether `plan` includes everything in `min`. */
export function planAtLeast(plan: PlanId, min: PlanId): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_ORDER as string[]).includes(v);
}
