/**
 * The plans, in order from least to most. Pure data, safe to import on the client.
 *
 * Prices come from what each plan costs to serve (docs/pricing.md, src/lib/billing/costs.ts): at typical
 * use every paid plan keeps at least 70% of its monthly price after Stripe's fees and every cost we pay
 * for that person, and at least 65% of its yearly price. `scripts/test-billing.ts` fails if a price or a
 * cost change breaks that. Stripe price ids live in the environment (STRIPE_PRICE_<PLAN>_<INTERVAL>),
 * never here.
 *
 * The AI allowance is what keeps the worst case bounded: model calls are most of the cost, and
 * `src/lib/ai/limits.ts` stops a person's AI spend at their plan's daily and monthly amounts, so even a
 * person who uses all of it leaves the plan above water. People who need more buy AI credit packs
 * (src/lib/billing/packs.ts), which are priced to keep their own margin when fully used.
 */

export type PlanId = "free" | "campus" | "pro" | "team" | "enterprise";

export const PLAN_ORDER: PlanId[] = ["free", "campus", "pro", "team", "enterprise"];

export type Plan = {
  id: PlanId;
  name: string;
  /** List price in US dollars per seat per month, billed monthly; null when not sold monthly. */
  monthlyUsd: number | null;
  /** Per seat per month when billed yearly; null when not offered. */
  yearlyMonthlyUsd: number | null;
  minSeats: number;
  /** Whether people can buy it themselves through Checkout (Free and Campus are never bought). */
  selfServe: boolean;
  /** One line on who it is for. */
  blurb: string;
  /** What the plan adds, in a few short lines, for the plan page and the site. */
  points: string[];
  /**
   * Model spend allowed per person, in US dollars at list price: per UTC day (so one runaway run cannot
   * use a month) and per allowance month, which starts on the billing anniversary for people with a
   * subscription (or a seat on one) and on the 1st (UTC) otherwise. Enforced in src/lib/ai/limits.ts;
   * AI_USER_DAILY_USD and AI_USER_MONTHLY_USD override them for everyone, and administrators have no cap.
   */
  ai: { dailyUsd: number; monthlyUsd: number };
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free", name: "Free", monthlyUsd: 0, yearlyMonthlyUsd: 0, minSeats: 1, selfServe: false,
    blurb: "The terminal and public data, with a small AI allowance to try the assistant.",
    points: ["The terminal, filings, comps and the Newsroom", "Calculators and the tool gallery", "A small AI allowance to try the assistant"],
    ai: { dailyUsd: 0.75, monthlyUsd: 3 },
  },
  campus: {
    id: "campus", name: "Campus", monthlyUsd: 0, yearlyMonthlyUsd: 0, minSeats: 1, selfServe: false,
    blurb: "Students with a .edu address: the full terminal, a monthly AI allowance and a recruiting pack.",
    points: ["The full terminal and data", "AI workflows with a monthly allowance", "Recruiting pack: practice comps, deal walk-throughs"],
    ai: { dailyUsd: 2, monthlyUsd: 10 },
  },
  pro: {
    id: "pro", name: "Pro", monthlyUsd: 59, yearlyMonthlyUsd: 49, minSeats: 1, selfServe: true,
    blurb: "Individuals: a working AI allowance, the relationships agent and one mailbox.",
    points: ["Everything in Campus, with a larger AI allowance", "Relationships agent and one mailbox", "Nurture, signals and compose", "Top up with AI credit packs when you need more"],
    ai: { dailyUsd: 6, monthlyUsd: 25 },
  },
  team: {
    id: "team", name: "Deal Team", monthlyUsd: 149, yearlyMonthlyUsd: 125, minSeats: 3, selfServe: true,
    blurb: "Teams: autopilot and campaigns, the adaptive engine across the team, shared workspaces.",
    points: ["Autopilot and campaigns", "The adaptive engine across the team", "Shared workspaces and live collaboration", "Assign seats to people on your team"],
    ai: { dailyUsd: 12, monthlyUsd: 60 },
  },
  enterprise: {
    id: "enterprise", name: "Enterprise", monthlyUsd: null, yearlyMonthlyUsd: 299, minSeats: 5, selfServe: true,
    blurb: "Firms: regulated mode, SSO and admin controls, data residency, bring-your-own data licences.",
    points: ["Regulated mode and audit exports", "SSO, admin controls, data residency options", "Bring your own data licences"],
    ai: { dailyUsd: 30, monthlyUsd: 130 },
  },
};

/** The largest yearly saving any plan offers against its monthly price, as a whole percentage. */
export function yearlySavingPct(): number {
  const cuts = PLAN_ORDER.map((p) => PLANS[p]).filter((p) => p.monthlyUsd && p.yearlyMonthlyUsd).map((p) => 1 - p.yearlyMonthlyUsd! / p.monthlyUsd!);
  return cuts.length ? Math.round(Math.max(...cuts) * 100) : 0;
}

/** Whether `plan` includes everything in `min`. */
export function planAtLeast(plan: PlanId, min: PlanId): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(min);
}

export function isPlanId(v: unknown): v is PlanId {
  return typeof v === "string" && (PLAN_ORDER as string[]).includes(v);
}

/** Subscription states that keep a paid plan on (the same set entitlements.ts reads). */
export const LIVE_STATUSES = ["active", "trialing", "past_due"];

export type BillingInterval = "monthly" | "yearly";

/** The intervals a plan is sold on, cheapest commitment first. */
export function intervalsFor(plan: PlanId): BillingInterval[] {
  const p = PLANS[plan];
  if (!p.selfServe) return [];
  return [...(p.monthlyUsd ? ["monthly" as const] : []), ...(p.yearlyMonthlyUsd ? ["yearly" as const] : [])];
}

/** "$59", or "$1.50": whole dollars without cents. */
export const usd = (n: number) => `$${Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2)}`;
