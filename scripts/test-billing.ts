/**
 * Checks for plans, prices and billing: every paid plan meets the margin target at typical use, nobody can
 * cost more than their plan brings in, credit packs keep their margin, the AI caps follow the plan and draw
 * on credits only after the allowance, allowances reset on the billing anniversary, and the Stripe pieces
 * that can be checked without Stripe (webhook signatures, idempotent pack grants, the row a subscription
 * writes, cancellation at period end, checkout requests and the double-checkout guard).
 * No network, no database.
 *   pnpm exec tsx scripts/test-billing.ts
 * With `--table` it also prints the cost and margin table behind docs/pricing.md.
 */
import { readFileSync } from "node:fs";
import { checkEnv, checkSiteUrl, checkStripe } from "@/lib/env";
import Stripe from "stripe";
import { blockedAt, dailyCapWith, monthCapMessage, userDailyUsd, userMonthlyUsd } from "@/lib/ai/limits";
import { effectiveEnd } from "@/lib/billing/credits";
import { assignableSeats, assignError, seatPlan, seatsToTrim } from "@/lib/billing/seats";
import { amountCents, envLines, packPrices, planPrices, portalConfig, webhookEvents, webhookUrl } from "@/lib/billing/setup";
import { DEFAULT_SITE_URL, normaliseSiteUrl, resolveSiteUrl } from "@/lib/site";
import { allowancePeriod, CREDIT_DAILY_USD, CREDIT_PACKS, creditsAvailable, isPackId, PACK_MARGIN_TARGET, packFees, packMargin, remainingByGrant, settledUse, splitSpend } from "@/lib/billing/packs";
import { answersFor, costToServe, fixedMonthlyUsd, LEVELS, margin, MARGIN_TARGET, marginTable, meteredFeatures, PAYING_SEATS, PREMIUM_USES, UNITS, USAGE } from "@/lib/billing/costs";
import { FEATURES } from "@/lib/billing/features";
import { intervalsFor, PLAN_ORDER, PLANS, yearlySavingPct, type PlanId } from "@/lib/billing/plans";
import { CHECKOUT_WINDOW_MS, checkoutKey, checkoutRequest, PACK_WINDOW_MS, grantFromSession, isDuplicate, packCheckoutKey, packPriceEnv, packRequest, planForPrice, planOpenSessions, priceEnv, resolveDuplicate, reversedShare, rowFromSubscription, sessionExpiry, shouldApply, WEBHOOK_EVENTS } from "@/lib/billing/stripe";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};
const throws = (fn: () => unknown, re: RegExp) => { try { fn(); return false; } catch (e) { return re.test((e as Error).message); } };
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const PAID = PLAN_ORDER.filter((p) => PLANS[p].selfServe);

function table() {
  console.log("\nUnit costs (US$)");
  for (const [id, u] of Object.entries(UNITS)) console.log(`  ${id.padEnd(20)} ${u.usd.toFixed(4).padStart(9)} per ${u.per}`);
  console.log(`\nFixed: $${fixedMonthlyUsd().toFixed(2)} a month, $${(fixedMonthlyUsd() / PAYING_SEATS).toFixed(2)} per seat over ${PAYING_SEATS} seats`);
  console.log("\nCost to serve per person-month (AI capped at the allowance)");
  for (const p of PLAN_ORDER) console.log(`  ${PLANS[p].name.padEnd(11)} ${LEVELS.map((l) => { const c = costToServe(p, l); return `${l} $${c.total.toFixed(2)} (AI $${c.ai.toFixed(2)}${c.aiUncapped > c.ai ? ` of $${c.aiUncapped.toFixed(2)} wanted` : ""})`; }).join("  ")}`);
  console.log("\nMargins per seat");
  for (const r of marginTable()) console.log(`  ${PLANS[r.plan].name.padEnd(11)} ${r.interval.padEnd(8)} ${r.level.padEnd(8)} $${String(r.price).padStart(4)}  fees $${r.fees.toFixed(2).padStart(6)}  cost $${r.cost.total.toFixed(2).padStart(7)}  margin ${pct(r.margin)}`);
  console.log("\nAllowances in default-model answers");
  for (const p of PLAN_ORDER) console.log(`  ${PLANS[p].name.padEnd(11)} $${PLANS[p].ai.dailyUsd}/day (~${answersFor(PLANS[p].ai.dailyUsd)} answers), $${PLANS[p].ai.monthlyUsd}/month (~${answersFor(PLANS[p].ai.monthlyUsd)})`);
  console.log("");
}

async function main() {
  if (process.argv.includes("--table")) table();

  console.log("plans");
  check("plans are in order of AI allowance", PLAN_ORDER.every((p, i) => i === 0 || PLANS[p].ai.monthlyUsd >= PLANS[PLAN_ORDER[i - 1]].ai.monthlyUsd));
  check("the daily allowance never exceeds the monthly one", PLAN_ORDER.every((p) => PLANS[p].ai.dailyUsd <= PLANS[p].ai.monthlyUsd));
  check("every paid plan is sold some way", PAID.every((p) => intervalsFor(p).length > 0), PAID.map((p) => [p, intervalsFor(p)]));
  check("yearly billing is never dearer than monthly", PAID.every((p) => !PLANS[p].monthlyUsd || !PLANS[p].yearlyMonthlyUsd || PLANS[p].yearlyMonthlyUsd <= PLANS[p].monthlyUsd));
  check("prices rise with the plan", PAID.every((p, i) => i === 0 || (PLANS[p].yearlyMonthlyUsd ?? 0) > (PLANS[PAID[i - 1]].yearlyMonthlyUsd ?? 0)));
  check("Free and Campus cannot be bought", !PLANS.free.selfServe && !PLANS.campus.selfServe && intervalsFor("free").length === 0);
  check("team plans need at least three seats", PLANS.team.minSeats >= 3 && PLANS.enterprise.minSeats >= 3);
  check("the owner's price points: Pro $49-59, Deal Team about $149, Enterprise about $299", (PLANS.pro.monthlyUsd ?? 0) >= 49 && (PLANS.pro.monthlyUsd ?? 0) <= 59 && PLANS.team.monthlyUsd === 149 && PLANS.enterprise.yearlyMonthlyUsd === 299);
  check("the yearly saving the toggle advertises is real", yearlySavingPct() > 0 && yearlySavingPct() < 30, yearlySavingPct());

  console.log("margins");
  for (const p of PAID) {
    const listInterval = PLANS[p].monthlyUsd ? "monthly" : "yearly";
    const list = margin(p, "typical", listInterval)!;
    check(`${PLANS[p].name}: typical use keeps ${pct(MARGIN_TARGET.monthly)} of the ${listInterval} list price`, list.margin >= MARGIN_TARGET.monthly, pct(list.margin));
    const yearly = margin(p, "typical", "yearly");
    if (yearly) check(`${PLANS[p].name}: typical use keeps ${pct(MARGIN_TARGET.yearly)} of the yearly price`, yearly.margin >= MARGIN_TARGET.yearly, pct(yearly.margin));
    for (const i of intervalsFor(p)) {
      const heavy = margin(p, "heavy", i)!;
      check(`${PLANS[p].name} (${i}): someone using the whole AI allowance still leaves a margin (never negative, at least 25%)`, heavy.margin >= 0.25, pct(heavy.margin));
    }
    check(`${PLANS[p].name}: the heavy persona really reaches the allowance`, costToServe(p, "heavy").aiUncapped >= PLANS[p].ai.monthlyUsd);
    check(`${PLANS[p].name}: typical use fits inside the allowance`, costToServe(p, "typical").aiUncapped <= PLANS[p].ai.monthlyUsd, costToServe(p, "typical").aiUncapped);
  }
  check("light use costs less than typical, typical less than heavy", PLAN_ORDER.every((p) => costToServe(p, "light").total <= costToServe(p, "typical").total && costToServe(p, "typical").total <= costToServe(p, "heavy").total));
  check("a Free person costs at most $6 a month, whatever they do", costToServe("free", "heavy").total <= 6, costToServe("free", "heavy").total);
  check("a typical Free person costs under $2.50 a month", costToServe("free", "typical").total <= 2.5, costToServe("free", "typical").total);
  check("Free still answers about a dozen questions a month", answersFor(PLANS.free.ai.monthlyUsd) >= 10, answersFor(PLANS.free.ai.monthlyUsd));
  check("a Campus person costs at most $14 a month, whatever they do", costToServe("campus", "heavy").total <= 14, costToServe("campus", "heavy").total);
  check("every persona names only known cost units", PLAN_ORDER.every((p) => LEVELS.every((l) => Object.keys(USAGE[p][l]).every((k) => k in UNITS))));
  check("every unit cost is a non-negative number with a source", Object.values(UNITS).every((u) => Number.isFinite(u.usd) && u.usd >= 0 && u.source.length > 0));
  check("a default-model answer costs between 5 and 100 cents", UNITS["ai.answer"].usd > 0.05 && UNITS["ai.answer"].usd < 1, UNITS["ai.answer"].usd);

  console.log("premium features flow into the cost model");
  check("every metered premium feature states its cost per use", FEATURES.every((f) => !f.metered || (typeof f.costPerUseUsd === "number" && f.costPerUseUsd > 0)), FEATURES.filter((f) => f.metered && !f.costPerUseUsd).map((f) => f.id));
  {
    const before = { pro: costToServe("pro", "typical").premium, free: costToServe("free", "typical").premium, ent: costToServe("enterprise", "heavy").premium };
    // Registered the way another area's file would: pushed into the shared list, nothing else edited.
    FEATURES.push({ id: "test.copilot", area: "ai", name: "Meeting copilot (test)", description: "test", minPlan: "pro", metered: true, costPerUseUsd: 0.5 });
    const after = { pro: costToServe("pro", "typical").premium, free: costToServe("free", "typical").premium, ent: costToServe("enterprise", "heavy").premium };
    FEATURES.pop();
    check("a newly registered metered feature is costed at typical use with no edit to costs.ts", Math.abs(after.pro - before.pro - 0.5 * PREMIUM_USES.typical) < 1e-9, { before, after });
    check("it is costed on every plan that unlocks it, at the heavy rate too", Math.abs(after.ent - before.ent - 0.5 * PREMIUM_USES.heavy) < 1e-9);
    check("plans below its minimum never pay for it", after.free === before.free && !meteredFeatures("free").some((f) => f.id === "test.copilot"));
  }

  console.log("AI caps by plan");
  const saved = { d: process.env.AI_USER_DAILY_USD, m: process.env.AI_USER_MONTHLY_USD };
  delete process.env.AI_USER_DAILY_USD; delete process.env.AI_USER_MONTHLY_USD;
  check("each plan's daily cap is its allowance", PLAN_ORDER.every((p) => userDailyUsd(p) === PLANS[p].ai.dailyUsd));
  check("higher plans get higher caps", userDailyUsd("pro") > userDailyUsd("free") && userMonthlyUsd("enterprise") > userMonthlyUsd("team"));
  process.env.AI_USER_DAILY_USD = "7"; process.env.AI_USER_MONTHLY_USD = "70";
  check("AI_USER_DAILY_USD overrides every plan", PLAN_ORDER.every((p) => userDailyUsd(p) === 7));
  check("AI_USER_MONTHLY_USD overrides every plan", PLAN_ORDER.every((p) => userMonthlyUsd(p) === 70));
  process.env.AI_USER_DAILY_USD = "lots";
  check("a malformed override is ignored", userDailyUsd("pro") === PLANS.pro.ai.dailyUsd);
  if (saved.d === undefined) delete process.env.AI_USER_DAILY_USD; else process.env.AI_USER_DAILY_USD = saved.d;
  if (saved.m === undefined) delete process.env.AI_USER_MONTHLY_USD; else process.env.AI_USER_MONTHLY_USD = saved.m;
  const base = { disabled: false, everyone: 10, mine: 1, pending: 0, globalCap: 200, userCap: 12, mineMonth: 30, monthCap: 60, plan: "pro" as PlanId, now: new Date(Date.UTC(2026, 9, 5)) };
  check("under the daily and monthly caps runs", blockedAt(base) === null);
  check("at the monthly allowance stops, naming the plan and the reset", /month's AI allowance on the Pro plan\. It resets on November 1/.test(blockedAt({ ...base, mineMonth: 60 }) ?? ""), blockedAt({ ...base, mineMonth: 60 }));
  check("a run's pending cost counts toward the month", blockedAt({ ...base, mineMonth: 59, pending: 1.5 }) !== null);
  check("the daily cap still applies first", /today's AI limit/.test(blockedAt({ ...base, mine: 12, mineMonth: 60 }) ?? ""));
  check("no person (or an administrator) means no monthly cap", blockedAt({ ...base, mine: null, mineMonth: null }) === null);
  check("an infinite cap never blocks", blockedAt({ ...base, mine: 1e6, userCap: Infinity, mineMonth: 1e6, monthCap: Infinity }) === null);
  check("Enterprise is not told to upgrade, but is told about credit packs", !/larger plan/i.test(monthCapMessage("enterprise")) && /credit pack/.test(monthCapMessage("enterprise")) && /larger plan/i.test(monthCapMessage("free")));
  check("the reset date rolls over the year", /January 1/.test(monthCapMessage("pro", new Date(Date.UTC(2026, 11, 31)))));

  console.log("credit packs");
  check("there are $10, $25 and $50 packs, larger ones worth a little more per dollar", CREDIT_PACKS.map((p) => p.priceUsd).join() === "10,25,50" && CREDIT_PACKS.every((p, i) => i === 0 || p.creditUsd / p.priceUsd >= CREDIT_PACKS[i - 1].creditUsd / CREDIT_PACKS[i - 1].priceUsd));
  for (const pk of CREDIT_PACKS) check(`the ${pk.name.replace("AI credits: ", "")} keeps ${pct(PACK_MARGIN_TARGET)} even when every credit is used`, packMargin(pk) >= PACK_MARGIN_TARGET, { margin: pct(packMargin(pk)), fees: packFees(pk).toFixed(2) });
  check("a pack never gives more AI than it costs", CREDIT_PACKS.every((p) => p.creditUsd < p.priceUsd));
  check("pack ids are checked", isPackId("ai25") && !isPackId("ai1000") && throws(() => packRequest({ pack: "ai1000" }), /Choose a credit pack/) && packRequest({ pack: "ai10" }).creditUsd === 6);
  check("pack price env names follow STRIPE_PRICE_PACK_<ID>", packPriceEnv("ai50") === "STRIPE_PRICE_PACK_AI50");

  console.log("credit drawdown order");
  check("spend comes from the allowance first", JSON.stringify(splitSpend(20, 25, 15)) === JSON.stringify({ allowance: 20, credits: 0, beyond: 0 }));
  check("then from credits once the allowance is used", JSON.stringify(splitSpend(31, 25, 15)) === JSON.stringify({ allowance: 25, credits: 6, beyond: 0 }));
  check("never more credits than there are", JSON.stringify(splitSpend(50, 25, 15)) === JSON.stringify({ allowance: 25, credits: 15, beyond: 10 }));
  const grants = [
    { id: 2, pack: "ai25", usd: 15, refundedUsd: 0, createdAt: new Date("2026-10-02") },
    { id: 1, pack: "ai10", usd: 6, refundedUsd: 0, createdAt: new Date("2026-09-20") },
    { id: 3, pack: "ai10", usd: 6, refundedUsd: 6, createdAt: new Date("2026-09-25") },
  ];
  const left = remainingByGrant(grants, 8);
  check("packs are used oldest first, refunded ones count for nothing", left.map((g) => `${g.id}:${g.leftUsd}`).join() === "1:0,3:0,2:13", left.map((g) => `${g.id}:${g.leftUsd}`));
  check("credits carry over: available = granted less earlier periods' use", creditsAvailable(21, 8) === 13 && creditsAvailable(5, 8) === 0);
  check("a finished period settles from its final spend, up to what was available", settledUse({ capUsd: 25, availableUsd: 6 }, 40) === 6 && settledUse({ capUsd: 25, availableUsd: 6 }, 27.5) === 2.5 && settledUse({ capUsd: 25, availableUsd: 6 }, 10) === 0);
  check("a period cut short by a new subscription ends where the next began", effectiveEnd({ periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-11-01") }, [new Date("2026-10-15"), new Date("2026-10-01")]).toISOString().startsWith("2026-10-15"));
  const cred = { ...base, mineMonth: 25, monthCap: 25, credits: 15 };
  check("at the allowance with credits, AI keeps going", blockedAt(cred) === null);
  check("with credits used up too, AI stops and says both are used", /AI allowance and your AI credits on the Pro plan/.test(blockedAt({ ...cred, mineMonth: 40 }) ?? ""), blockedAt({ ...cred, mineMonth: 40 }));
  check("a run's pending cost counts against credits", blockedAt({ ...cred, mineMonth: 38, pending: 2.5 }) !== null);
  check("without credits the allowance is the end", /It resets on/.test(blockedAt({ ...cred, credits: 0 }) ?? ""));
  check("holding credits raises a small daily cap to the credit floor", dailyCapWith(0.75, 6) === CREDIT_DAILY_USD && dailyCapWith(30, 6) === 30 && dailyCapWith(0.75, 0) === 0.75);
  check("so a Free person with credits is not stuck at $0.75 a day", blockedAt({ ...base, plan: "free", userCap: 0.75, mine: 2, mineMonth: 3, monthCap: 3, credits: 6 }) === null);
  check("but the daily floor goes once the credits are used", /today's AI limit/.test(blockedAt({ ...base, plan: "free", userCap: 0.75, mine: 2, mineMonth: 9.5, monthCap: 3, credits: 6 }) ?? ""));

  console.log("billing anniversaries");
  const anchor = new Date(Date.UTC(2026, 0, 31, 14, 30));
  const iso = (d: Date) => d.toISOString().slice(0, 16);
  const p1 = allowancePeriod(new Date(Date.UTC(2026, 9, 5)), new Date(Date.UTC(2026, 6, 17, 9)));
  check("a subscriber's allowance runs from one billing date to the next", iso(p1.start) === "2026-09-17T09:00" && iso(p1.end) === "2026-10-17T09:00", [iso(p1.start), iso(p1.end)]);
  const p2 = allowancePeriod(new Date(Date.UTC(2026, 1, 15)), anchor);
  check("an anchor on the 31st renews on the last day of shorter months, like Stripe", iso(p2.start) === "2026-01-31T14:30" && iso(p2.end) === "2026-02-28T14:30", [iso(p2.start), iso(p2.end)]);
  const p3 = allowancePeriod(new Date(Date.UTC(2026, 2, 1)), anchor);
  check("and back to the 31st when the month has one", iso(p3.start) === "2026-02-28T14:30" && iso(p3.end) === "2026-03-31T14:30", [iso(p3.start), iso(p3.end)]);
  const p4 = allowancePeriod(new Date(Date.UTC(2027, 0, 3)), new Date(Date.UTC(2025, 11, 10)));
  check("periods roll over the year", iso(p4.start) === "2026-12-10T00:00" && iso(p4.end) === "2027-01-10T00:00", [iso(p4.start), iso(p4.end)]);
  const p5 = allowancePeriod(new Date(Date.UTC(2026, 9, 5, 12)));
  check("without a subscription it is the calendar month", iso(p5.start) === "2026-10-01T00:00" && iso(p5.end) === "2026-11-01T00:00");
  check("on the anniversary itself a new period starts", iso(allowancePeriod(new Date(Date.UTC(2026, 9, 17, 9)), new Date(Date.UTC(2026, 6, 17, 9))).start) === "2026-10-17T09:00");
  check("the cap message names the billing date", /It resets on October 17\./.test(monthCapMessage("pro", new Date(Date.UTC(2026, 9, 5)), p1.end)));
  check("blockedAt passes the period's end through", /resets on October 17/.test(blockedAt({ ...base, mineMonth: 25, monthCap: 25, resetsOn: p1.end }) ?? ""));

  console.log("idempotent payment webhooks");
  {
    // Mirrors the unique index on ai_credit_grants.stripe_payment_intent_id with ON CONFLICT DO NOTHING.
    const byIntent = new Map<string, { userId: string; pack: string }>();
    const fakeGrant = async (g: { userId: string; pack: string; paymentIntentId: string }) => { if (byIntent.has(g.paymentIntentId)) return false; byIntent.set(g.paymentIntentId, g); return true; };
    const session = (o: Partial<Stripe.Checkout.Session>) => ({ id: "cs_1", object: "checkout.session", mode: "payment", payment_status: "paid", payment_intent: "pi_1", client_reference_id: "u1", metadata: { kind: "credits", pack: "ai25", userId: "u1" }, amount_total: 2500, currency: "usd", ...o }) as Stripe.Checkout.Session;
    const first = await grantFromSession(session({}), fakeGrant);
    await grantFromSession(session({}), fakeGrant); // the webhook retried
    await grantFromSession(session({ id: "cs_1" }), fakeGrant); // and the return from Checkout raced it
    check("a pack is granted once however often its payment is reported", first === "u1" && byIntent.size === 1 && byIntent.get("pi_1")?.pack === "ai25");
    await grantFromSession(session({ id: "cs_2", payment_intent: "pi_2" }), fakeGrant);
    check("a second purchase (a new payment intent) is granted again", byIntent.size === 2);
    check("an unpaid session (a slow payment method) grants nothing until paid", (await grantFromSession(session({ payment_intent: "pi_3", payment_status: "unpaid" }), fakeGrant)) === null && !byIntent.has("pi_3"));
    check("a subscription checkout never grants credits", (await grantFromSession(session({ mode: "subscription", payment_intent: "pi_4" }), fakeGrant)) === null);
    check("a session without the credits marker grants nothing", (await grantFromSession(session({ payment_intent: "pi_5", metadata: { pack: "ai25" } }), fakeGrant)) === null);
    check("an unknown pack grants nothing", (await grantFromSession(session({ payment_intent: "pi_6", metadata: { kind: "credits", pack: "ai999" } }), fakeGrant)) === null);
    const sql0022 = readFileSync(new URL("../drizzle/0022_credits.sql", import.meta.url), "utf8");
    check("the database enforces it: a unique index on the payment intent", /CREATE UNIQUE INDEX IF NOT EXISTS "ai_credit_grants_payment_intent_uidx" ON "ai_credit_grants" \("stripe_payment_intent_id"\)/.test(sql0022));
    check("the webhook listens for completed and delayed payments, refunds and disputes", ["checkout.session.completed", "checkout.session.async_payment_succeeded", "charge.refunded", "charge.dispute.created", "charge.dispute.closed"].every((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e)));
    const charge = { amount: 2500, amount_refunded: 0 };
    check("a partial refund takes back that share of the credits", reversedShare({ amount: 2500, amount_refunded: 1000 }) === 0.4);
    check("an open or lost dispute takes back the disputed share", reversedShare(charge, [{ amount: 2500, status: "needs_response" }]) === 1 && reversedShare(charge, [{ amount: 2500, status: "lost" }]) === 1 && reversedShare(charge, [{ amount: 2500, status: "warning_needs_response" }]) === 1);
    check("a won dispute (or a closed inquiry) gives the credits back", reversedShare(charge, [{ amount: 2500, status: "won" }]) === 0 && reversedShare(charge, [{ amount: 2500, status: "warning_closed" }]) === 0);
    check("a refund plus a dispute never takes back more than the pack", reversedShare({ amount: 2500, amount_refunded: 1000 }, [{ amount: 2500, status: "under_review" }]) === 1);
  }

  console.log("double-checkout guard");
  {
    const t = Date.UTC(2026, 9, 5, 12, 1);
    check("the same purchase within ten minutes has the same idempotency key", checkoutKey("u1", "team", "monthly", 4, t) === checkoutKey("u1", "team", "monthly", 4, t + 5 * 60_000));
    check("a different plan, interval or seat count gets its own key", new Set([checkoutKey("u1", "team", "monthly", 4, t), checkoutKey("u1", "team", "yearly", 4, t), checkoutKey("u1", "team", "monthly", 5, t), checkoutKey("u1", "pro", "monthly", 1, t), checkoutKey("u2", "team", "monthly", 4, t)]).size === 5);
    check("keys expire with the window", checkoutKey("u1", "pro", "monthly", 1, t) !== checkoutKey("u1", "pro", "monthly", 1, t + 11 * 60_000));
    check("pack keys only absorb a double click", packCheckoutKey("u1", "ai10", t) === packCheckoutKey("u1", "ai10", t + 10_000) && packCheckoutKey("u1", "ai10", t) !== packCheckoutKey("u1", "ai10", t + 120_000));
    const open = (id: string, mode: "subscription" | "payment", meta: Record<string, string>) => ({ id, url: `https://checkout.stripe.com/${id}`, mode, status: "open" as const, metadata: meta });
    const sessions = [
      open("cs_a", "subscription", { plan: "team", interval: "monthly", seats: "4" }),
      open("cs_b", "subscription", { plan: "pro", interval: "monthly", seats: "1" }),
      open("cs_c", "payment", { pack: "ai10" }),
    ];
    const same = planOpenSessions(sessions, { mode: "subscription", plan: "team", interval: "monthly", seats: 4 });
    check("an open checkout for the same purchase is reused, and other subscription checkouts expire", same.reuse?.id === "cs_a" && same.expire.join() === "cs_b", same);
    const other = planOpenSessions(sessions, { mode: "subscription", plan: "enterprise", interval: "yearly", seats: 5 });
    check("a new purchase expires every open subscription checkout first", other.reuse === null && other.expire.sort().join() === "cs_a,cs_b");
    check("credit pack checkouts are never expired by a plan checkout", !other.expire.includes("cs_c"));
    const pk = planOpenSessions(sessions, { mode: "payment", pack: "ai10" });
    check("an open checkout for the same pack is reused", pk.reuse?.id === "cs_c" && pk.expire.length === 0);
    check("a second live subscription is recognised as a duplicate", isDuplicate({ status: "active", stripeSubscriptionId: "sub_1" }, { status: "active", stripeSubscriptionId: "sub_2" }));
    check("the same subscription, or replacing a lapsed one, is not", !isDuplicate({ status: "active", stripeSubscriptionId: "sub_1" }, { status: "active", stripeSubscriptionId: "sub_1" }) && !isDuplicate({ status: "canceled", stripeSubscriptionId: "sub_1" }, { status: "active", stripeSubscriptionId: "sub_2" }) && !isDuplicate(null, { status: "active", stripeSubscriptionId: "sub_2" }));
    const sub = (id: string, created: number, o: { userId?: string; cancelAtPeriodEnd?: boolean } = {}) => ({ id, created, metadata: (o.userId ? { userId: o.userId } : {}) as Record<string, string>, cancel_at_period_end: !!o.cancelAtPeriodEnd, cancel_at: null });
    const t0 = 1_790_000_000;
    const twice = resolveDuplicate("u1", sub("sub_new", t0 + 600, { userId: "u1" }), sub("sub_old", t0, { userId: "u1" }));
    check("a double checkout cancels the newer subscription and keeps the older, in either order", twice.keep.id === "sub_old" && twice.drop?.id === "sub_new" && resolveDuplicate("u1", sub("sub_old", t0, { userId: "u1" }), sub("sub_new", t0 + 600, { userId: "u1" })).drop?.id === "sub_new");
    const manual = resolveDuplicate("u1", sub("sub_old", t0, { userId: "u1" }), sub("sub_dash", t0 + 600));
    check("a subscription made outside Checkout is never cancelled; the plan follows the newer", manual.drop === null && manual.keep.id === "sub_dash");
    const moved = resolveDuplicate("u1", sub("sub_old", t0, { userId: "u1", cancelAtPeriodEnd: true }), sub("sub_new", t0 + 600, { userId: "u1" }));
    check("a move to a new subscription with the old one set to end cancels nothing and follows the new one", moved.drop === null && moved.keep.id === "sub_new");
    check("two subscriptions started days apart are not a double checkout", resolveDuplicate("u1", sub("a", t0, { userId: "u1" }), sub("b", t0 + 3 * 86_400, { userId: "u1" })).drop === null);
    check("another person's subscription is never cancelled for this one", resolveDuplicate("u1", sub("a", t0, { userId: "u1" }), sub("b", t0 + 60, { userId: "u2" })).drop === null);
    const ahead = (ms: number, now: number) => sessionExpiry(ms, now) - Math.floor(now / 1000);
    check("checkout sessions close after about half an hour (never under Stripe's 30-minute minimum)", [0, 1, 299_999, 599_999].every((d) => ahead(CHECKOUT_WINDOW_MS, t + d) > 30 * 60 && ahead(CHECKOUT_WINDOW_MS, t + d) <= 42 * 60) && ahead(PACK_WINDOW_MS, t + 59_000) > 30 * 60);
    check("a retried create within the window sends the same expiry, so Stripe's idempotency accepts it", sessionExpiry(CHECKOUT_WINDOW_MS, t) === sessionExpiry(CHECKOUT_WINDOW_MS, t + 4 * 60_000) && sessionExpiry(PACK_WINDOW_MS, t) === sessionExpiry(PACK_WINDOW_MS, t + 20_000));
  }

  console.log("team seats");
  {
    const live = { plan: "team", status: "active", seats: 4, member: true };
    check("the owner holds one seat; the rest can be given", assignableSeats(4) === 3 && assignableSeats(1) === 0 && assignableSeats(0) === 0);
    check("an assigned seat grants the subscription's plan", seatPlan({ ...live, rank: 0 }) === "team" && seatPlan({ ...live, plan: "enterprise", rank: 2 }) === "enterprise");
    check("only seats within the count are granted, oldest first", seatPlan({ ...live, rank: 2 }) === "team" && seatPlan({ ...live, rank: 3 }) === null);
    check("a past-due subscription keeps its seats; a cancelled one does not", seatPlan({ ...live, status: "past_due", rank: 0 }) === "team" && seatPlan({ ...live, status: "canceled", rank: 0 }) === null && seatPlan({ ...live, status: "unpaid", rank: 0 }) === null);
    check("someone who left the team loses the seat", seatPlan({ ...live, member: false, rank: 0 }) === null);
    check("Pro has no seats to give", seatPlan({ ...live, plan: "pro", seats: 3, rank: 0 }) === null);
    const ok = { ownerId: "o", targetId: "m", plan: "team", status: "active", seats: 4, assigned: 1, ownerRole: "owner" as const, targetRole: "member" as const, targetSeatOwner: null };
    check("an owner can give a seat to a member of their team", assignError(ok) === null);
    check("an admin of the team can too", assignError({ ...ok, ownerRole: "admin" }) === null);
    check("a plain member of the team cannot", /own or administer/.test(assignError({ ...ok, ownerRole: "member" }) ?? ""));
    check("only to people on that team", /Invite them on the Team page/.test(assignError({ ...ok, targetRole: null }) ?? ""));
    check("never more than the seat count", /All 4 seats are in use/.test(assignError({ ...ok, assigned: 3 }) ?? "") && assignError({ ...ok, assigned: 2 }) === null);
    check("not to someone already seated, here or elsewhere", /already has one of your seats/.test(assignError({ ...ok, targetSeatOwner: "o" }) ?? "") && /someone else's/.test(assignError({ ...ok, targetSeatOwner: "x" }) ?? ""));
    check("not to yourself", /hold one seat yourself/.test(assignError({ ...ok, targetId: "o" }) ?? ""));
    check("not without a live team subscription", /live Deal Team or Enterprise/.test(assignError({ ...ok, plan: "pro" }) ?? "") && /live Deal Team/.test(assignError({ ...ok, status: "canceled" }) ?? "") && /live Deal Team/.test(assignError({ ...ok, plan: null, status: null }) ?? ""));
    const rows = [3, 1, 2, 4].map((id) => ({ id, assignedAt: new Date(Date.UTC(2026, 9, id)) }));
    check("lowering the seat count in the portal takes the newest seats back", seatsToTrim(rows, 3, "team", true).map((r) => r.id).join() === "3,4");
    check("raising it takes nothing back", seatsToTrim(rows, 10, "team", true).length === 0);
    check("moving to a plan without seats frees them all", seatsToTrim(rows, 1, "pro", true).length === 4);
    check("a cancelled subscription keeps its assignments for a resubscribe (they grant nothing meanwhile)", seatsToTrim(rows, 1, "team", false).length === 0);
  }

  console.log("checkout requests");
  check("Pro monthly, one seat", JSON.stringify(checkoutRequest({ plan: "pro", interval: "monthly" })) === JSON.stringify({ plan: "pro", interval: "monthly", seats: 1 }));
  check("Pro ignores a seat count", checkoutRequest({ plan: "pro", interval: "yearly", seats: 9 }).seats === 1);
  check("Deal Team defaults to its minimum seats", checkoutRequest({ plan: "team", interval: "monthly" }).seats === PLANS.team.minSeats);
  check("Deal Team below the minimum is refused in plain words", throws(() => checkoutRequest({ plan: "team", interval: "monthly", seats: 2 }), /starts at 3 seats/));
  check("Enterprise is sold yearly only", throws(() => checkoutRequest({ plan: "enterprise", interval: "monthly", seats: 5 }), /not sold month to month/) && checkoutRequest({ plan: "enterprise", seats: 6 }).interval === "yearly");
  check("Free and Campus cannot be bought", throws(() => checkoutRequest({ plan: "free" }), /Choose Pro/) && throws(() => checkoutRequest({ plan: "campus" }), /Choose Pro/));
  check("nonsense is refused", throws(() => checkoutRequest({ plan: "gold" }), /Choose Pro/) && throws(() => checkoutRequest({ plan: "team", seats: "many" }), /starts at/));
  check("absurd seat counts go to sales", throws(() => checkoutRequest({ plan: "team", seats: 10_000 }), /write to us/));

  console.log("subscriptions from Stripe");
  const prices = { [priceEnv("pro", "monthly")]: "price_pro_m", [priceEnv("team", "yearly")]: "price_team_y", [priceEnv("enterprise", "yearly")]: "price_ent_y" };
  check("the price env names follow STRIPE_PRICE_<PLAN>_<INTERVAL>", priceEnv("team", "yearly") === "STRIPE_PRICE_TEAM_YEARLY");
  check("a price id maps back to its plan", planForPrice("price_team_y", prices) === "team" && planForPrice("price_unknown", prices) === null && planForPrice(null, prices) === null);
  const sub = (o: { id?: string; status?: string; price?: string; quantity?: number; end?: number; meta?: Record<string, string>; customer?: string; cancelAtPeriodEnd?: boolean; cancelAt?: number | null; anchor?: number }) => ({
    id: o.id ?? "sub_1", object: "subscription", status: o.status ?? "active", customer: o.customer ?? "cus_1", metadata: o.meta ?? {},
    cancel_at_period_end: o.cancelAtPeriodEnd ?? false, cancel_at: o.cancelAt ?? null, billing_cycle_anchor: o.anchor ?? 1_790_000_000,
    items: { object: "list", data: [{ id: "si_1", price: { id: o.price ?? "price_team_y" }, quantity: o.quantity ?? 4, current_period_start: (o.end ?? 1_800_000_000) - 2_592_000, current_period_end: o.end ?? 1_800_000_000 }] },
  }) as unknown as Stripe.Subscription;
  const row = rowFromSubscription("u1", sub({}), prices);
  check("a subscription becomes the person's row", row.plan === "team" && row.seats === 4 && row.status === "active" && row.stripeCustomerId === "cus_1" && row.stripeSubscriptionId === "sub_1", row);
  check("the period end comes from the subscription item", row.currentPeriodEnd?.getTime() === 1_800_000_000_000);
  check("an unknown price falls back to the plan in the metadata", rowFromSubscription("u1", sub({ price: "price_x", meta: { plan: "enterprise" } }), prices).plan === "enterprise");
  check("a canceled subscription keeps its plan but not its status", rowFromSubscription("u1", sub({ status: "canceled" }), prices).status === "canceled");
  check("a seat count changed in the portal reaches the row through the webhook", rowFromSubscription("o", sub({ quantity: 7 }), prices).seats === 7);
  check("the billing anchor and period start are stored, for allowance resets", row.billingAnchor?.getTime() === 1_790_000_000_000 && row.currentPeriodStart?.getTime() === (1_800_000_000 - 2_592_000) * 1000);
  check("a live subscription that is not cancelling has no cancel date", !row.cancelAtPeriodEnd && row.cancelAt === null);
  const ending = rowFromSubscription("u1", sub({ cancelAtPeriodEnd: true }), prices);
  check("cancel at period end: still live, cancelling on the period's end", ending.status === "active" && ending.cancelAtPeriodEnd && ending.cancelAt?.getTime() === 1_800_000_000_000);
  const dated = rowFromSubscription("u1", sub({ cancelAt: 1_799_000_000 }), prices);
  check("a set cancellation date (newer portals) counts the same way", dated.cancelAtPeriodEnd && dated.cancelAt?.getTime() === 1_799_000_000_000);
  check("once it has ended there is nothing left to cancel", rowFromSubscription("u1", sub({ status: "canceled", cancelAtPeriodEnd: true }), prices).cancelAt === null);
  check("the same subscription always applies (replays converge)", shouldApply({ status: "active", stripeSubscriptionId: "sub_1" }, { status: "canceled", stripeSubscriptionId: "sub_1" }));
  check("a first subscription applies", shouldApply(undefined, { status: "active", stripeSubscriptionId: "sub_1" }));
  check("an old subscription's cancellation does not undo a newer live one", !shouldApply({ status: "active", stripeSubscriptionId: "sub_2" }, { status: "canceled", stripeSubscriptionId: "sub_1" }));
  check("a new live subscription replaces an ended one", shouldApply({ status: "canceled", stripeSubscriptionId: "sub_1" }, { status: "active", stripeSubscriptionId: "sub_2" }));

  console.log("webhook signatures");
  const stripe = new Stripe("sk_test_dummy");
  const secret = "whsec_test_secret";
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "customer.subscription.updated", data: { object: { id: "sub_1" } } });
  const header = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const ok = await stripe.webhooks.constructEventAsync(payload, header, secret).then((e) => e.id === "evt_1", () => false);
  check("a correctly signed body is accepted", ok);
  const tampered = await stripe.webhooks.constructEventAsync(payload.replace("sub_1", "sub_9"), header, secret).then(() => true, () => false);
  check("a changed body is rejected", !tampered);
  const wrongSecret = await stripe.webhooks.constructEventAsync(payload, header, "whsec_other").then(() => true, () => false);
  check("the wrong secret is rejected", !wrongSecret);
  const stale = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret, timestamp: Math.floor(Date.now() / 1000) - 3600 });
  check("an hour-old signature is rejected (replay window)", !(await stripe.webhooks.constructEventAsync(payload, stale, secret).then(() => true, () => false)));

  console.log("domain and Stripe setup");
  {
    check("NEXT_PUBLIC_SITE_URL wins, then YOUBANK_URL, then Vercel's production domain", resolveSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://youbank.com/", YOUBANK_URL: "https://a.vercel.app" }) === "https://youbank.com" && resolveSiteUrl({ YOUBANK_URL: "https://a.example.com" }) === "https://a.example.com" && resolveSiteUrl({ VERCEL_PROJECT_PRODUCTION_URL: "youbank.com" }) === "https://youbank.com");
    check("with nothing set it is the original address", resolveSiteUrl({}) === DEFAULT_SITE_URL);
    check("addresses are cleaned: scheme added, path and slash dropped, junk refused", normaliseSiteUrl("youbank.com/app/") === "https://youbank.com" && normaliseSiteUrl("http://localhost:3000") === "http://localhost:3000" && normaliseSiteUrl("not a url") === null && normaliseSiteUrl("") === null);
    check("the webhook lives at <domain>/api/billing/webhook", webhookUrl("https://youbank.com/") === "https://youbank.com/api/billing/webhook");
    check("the webhook listens for exactly the events handled", webhookEvents().join() === [...WEBHOOK_EVENTS].join() && new Set(webhookEvents()).size === webhookEvents().length);
    check("Stripe amounts: monthly is the list price, yearly twelve months of the yearly rate", amountCents("pro", "monthly") === 5900 && amountCents("pro", "yearly") === 58800 && amountCents("enterprise", "yearly") === 299 * 1200);
    check("every plan sold online and every pack gets a price", planPrices().length === PAID.reduce((n, p) => n + intervalsFor(p).length, 0) && packPrices().map((p) => p.cents).join() === "1000,2500,5000");
    const priceIds = Object.fromEntries(planPrices().map((p) => [p.env, `price_${p.lookup}`]));
    const cfg = portalConfig("https://youbank.com", priceIds);
    const prods = cfg.features.subscription_update?.products || [];
    check("the portal lets people switch between every plan and interval", prods.map((p) => p.product).join() === "youbank_pro,youbank_team,youbank_enterprise" && prods.flatMap((p) => p.prices).length === planPrices().length);
    check("seat quantities change within each plan's limits; Pro stays one seat", prods.find((p) => p.product === "youbank_team")?.adjustable_quantity?.minimum === PLANS.team.minSeats && prods.find((p) => p.product === "youbank_enterprise")?.adjustable_quantity?.minimum === PLANS.enterprise.minSeats && prods.find((p) => p.product === "youbank_pro")?.adjustable_quantity?.enabled === false);
    check("cancellation is at period end, with a reason", cfg.features.subscription_cancel?.mode === "at_period_end" && cfg.features.subscription_cancel?.cancellation_reason?.enabled === true);
    check("downgrades wait for the period's end", (cfg.features.subscription_update?.schedule_at_period_end?.conditions ?? []).length === 2);
    check("invoices, card and tax id are in the portal", cfg.features.invoice_history?.enabled === true && cfg.features.payment_method_update?.enabled === true && (cfg.features.customer_update?.allowed_updates as string[] | undefined)?.includes("tax_id") === true);
    check("the portal links the terms and privacy pages and returns to the Plan tab", cfg.business_profile?.terms_of_service_url === "https://youbank.com/terms" && cfg.business_profile?.privacy_policy_url === "https://youbank.com/privacy" && cfg.default_return_url === "https://youbank.com/app/settings?tab=plan");
    const lines = envLines({ site: "https://youbank.com", keyPrefix: "sk_live_", webhookSecret: "whsec_1", prices: priceIds, portal: "bpc_1", tax: true }).join("\n");
    check("setup prints every variable billing reads", ["NEXT_PUBLIC_SITE_URL=https://youbank.com", "STRIPE_SECRET_KEY=", "STRIPE_WEBHOOK_SECRET=whsec_1", "STRIPE_PORTAL_CONFIGURATION=bpc_1", "STRIPE_AUTOMATIC_TAX=1", "STRIPE_TERMS_CONSENT=", ...planPrices().map((p) => `${p.env}=`)].every((l) => lines.includes(l)));
  }

  console.log("environment warnings");
  {
    const keyOnly = checkStripe({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_PRO_MONTHLY: "price_1" }, false);
    check("the secret key alone is not called 'off': the warning says billing is on and the webhook is missing", keyOnly.length === 1 && /billing is ON/.test(keyOnly[0]) && !/stays off/.test(keyOnly[0]), keyOnly);
    check("the webhook secret alone says billing stays off", /stays off/.test(checkStripe({ STRIPE_WEBHOOK_SECRET: "whsec_x" }, false)[0] ?? ""));
    check("a complete Stripe setup has no warning", checkStripe({ STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "whsec_x", STRIPE_PRICE_TEAM_YEARLY: "price_1" }, true).length === 0);
    check("billing on with no plan prices is named", checkStripe({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "whsec_x" }, false).some((w) => w.startsWith("STRIPE_PRICE_")));
    check("a test key on the production deployment is named", checkStripe({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "w", STRIPE_PRICE_PRO_MONTHLY: "p", VERCEL_ENV: "production" }, true).some((w) => /test key/.test(w)));
    check("the env check includes the Stripe warnings", checkEnv({ STRIPE_SECRET_KEY: "sk_test_x" }, false).invalid.some((w) => w.startsWith("STRIPE_WEBHOOK_SECRET")));
    check("a malformed site address is named; a good one is not", checkSiteUrl({ NEXT_PUBLIC_SITE_URL: "not a url" }, false).length === 1 && checkSiteUrl({ NEXT_PUBLIC_SITE_URL: "https://youbank.com" }, true).length === 0);
    check("an unset site address on the production deployment says what links use instead", /youbank-nu\.vercel\.app|example\.com/.test(checkSiteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "example.com" }, true)[0] ?? ""));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
