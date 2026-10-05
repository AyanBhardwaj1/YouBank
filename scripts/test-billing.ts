/**
 * Checks for plans, prices and billing: every paid plan meets the margin target at typical use, nobody can
 * cost more than their plan brings in, the AI caps follow the plan, and the Stripe pieces that can be
 * checked without Stripe (the webhook signature, the row a subscription writes, checkout requests).
 * No network, no database.
 *   pnpm exec tsx scripts/test-billing.ts
 * With `--table` it also prints the cost and margin table behind docs/pricing.md.
 */
import Stripe from "stripe";
import { blockedAt, monthCapMessage, userDailyUsd, userMonthlyUsd } from "@/lib/ai/limits";
import { answersFor, costToServe, fixedMonthlyUsd, LEVELS, margin, MARGIN_TARGET, marginTable, PAYING_SEATS, UNITS, USAGE } from "@/lib/billing/costs";
import { intervalsFor, PLAN_ORDER, PLANS, type PlanId } from "@/lib/billing/plans";
import { checkoutRequest, planForPrice, priceEnv, rowFromSubscription, shouldApply } from "@/lib/billing/stripe";

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

  console.log("margins");
  for (const p of PAID) {
    const listInterval = PLANS[p].monthlyUsd ? "monthly" : "yearly";
    const list = margin(p, "typical", listInterval)!;
    check(`${PLANS[p].name}: typical use keeps ${pct(MARGIN_TARGET.monthly)} of the ${listInterval} list price`, list.margin >= MARGIN_TARGET.monthly, pct(list.margin));
    const yearly = margin(p, "typical", "yearly");
    if (yearly) check(`${PLANS[p].name}: typical use keeps ${pct(MARGIN_TARGET.yearly)} of the yearly price`, yearly.margin >= MARGIN_TARGET.yearly, pct(yearly.margin));
    for (const i of intervalsFor(p)) {
      const heavy = margin(p, "heavy", i)!;
      check(`${PLANS[p].name} (${i}): someone using the whole AI allowance still leaves a margin`, heavy.margin > 0.1, pct(heavy.margin));
    }
    check(`${PLANS[p].name}: the heavy persona really reaches the allowance`, costToServe(p, "heavy").aiUncapped >= PLANS[p].ai.monthlyUsd);
    check(`${PLANS[p].name}: typical use fits inside the allowance`, costToServe(p, "typical").aiUncapped <= PLANS[p].ai.monthlyUsd, costToServe(p, "typical").aiUncapped);
  }
  check("light use costs less than typical, typical less than heavy", PLAN_ORDER.every((p) => costToServe(p, "light").total <= costToServe(p, "typical").total && costToServe(p, "typical").total <= costToServe(p, "heavy").total));
  check("a Free person costs at most $10 a month, whatever they do", costToServe("free", "heavy").total <= 10, costToServe("free", "heavy").total);
  check("a Campus person costs at most $20 a month, whatever they do", costToServe("campus", "heavy").total <= 20, costToServe("campus", "heavy").total);
  check("every persona names only known cost units", PLAN_ORDER.every((p) => LEVELS.every((l) => Object.keys(USAGE[p][l]).every((k) => k in UNITS))));
  check("every unit cost is a non-negative number with a source", Object.values(UNITS).every((u) => Number.isFinite(u.usd) && u.usd >= 0 && u.source.length > 0));
  check("a default-model answer costs between 5 and 100 cents", UNITS["ai.answer"].usd > 0.05 && UNITS["ai.answer"].usd < 1, UNITS["ai.answer"].usd);

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
  check("Enterprise is not told to upgrade", !/Larger plans/.test(monthCapMessage("enterprise")) && /Larger plans/.test(monthCapMessage("free")));
  check("the reset date rolls over the year", /January 1/.test(monthCapMessage("pro", new Date(Date.UTC(2026, 11, 31)))));

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
  const sub = (o: { id?: string; status?: string; price?: string; quantity?: number; end?: number; meta?: Record<string, string>; customer?: string }) => ({
    id: o.id ?? "sub_1", object: "subscription", status: o.status ?? "active", customer: o.customer ?? "cus_1", metadata: o.meta ?? {},
    items: { object: "list", data: [{ id: "si_1", price: { id: o.price ?? "price_team_y" }, quantity: o.quantity ?? 4, current_period_end: o.end ?? 1_800_000_000 }] },
  }) as unknown as Stripe.Subscription;
  const row = rowFromSubscription("u1", sub({}), prices);
  check("a subscription becomes the person's row", row.plan === "team" && row.seats === 4 && row.status === "active" && row.stripeCustomerId === "cus_1" && row.stripeSubscriptionId === "sub_1", row);
  check("the period end comes from the subscription item", row.currentPeriodEnd?.getTime() === 1_800_000_000_000);
  check("an unknown price falls back to the plan in the metadata", rowFromSubscription("u1", sub({ price: "price_x", meta: { plan: "enterprise" } }), prices).plan === "enterprise");
  check("a canceled subscription keeps its plan but not its status", rowFromSubscription("u1", sub({ status: "canceled" }), prices).status === "canceled");
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

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
