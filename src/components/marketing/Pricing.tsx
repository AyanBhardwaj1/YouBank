"use client";

/**
 * The public pricing page. Every number comes from the same sources the app bills with: PLANS
 * (src/lib/billing/plans.ts), CREDIT_PACKS (src/lib/billing/packs.ts) and the premium feature registry,
 * so the page, the Plan tab and Stripe cannot disagree. Buying happens in the app (Settings, under Plan),
 * after sign-in; this page only links there.
 */
import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { answersFor } from "@/lib/billing/costs";
import { FEATURES } from "@/lib/billing/features";
import { CREDIT_DAILY_USD, CREDIT_PACKS } from "@/lib/billing/packs";
import { intervalsFor, PLAN_ORDER, PLANS, planAtLeast, usd, yearlySavingPct, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { LEGAL } from "@/lib/site";
import { SiteFooter, SiteHeader } from "./SiteChrome";

const PLAN_PAGE = "/app/settings?tab=plan";

/** What each plan's price reads as for a billing period, or null when it is not sold that way. */
function priceFor(id: PlanId, period: BillingInterval): { amount: string; unit: string; note: string } {
  const p = PLANS[id];
  if (!p.selfServe) return { amount: "Free", unit: id === "campus" ? "with a .edu address" : "for everyone", note: "" };
  const sold = intervalsFor(id);
  const shown = sold.includes(period) ? period : sold[0];
  const per = shown === "monthly" ? p.monthlyUsd! : p.yearlyMonthlyUsd!;
  const seat = p.minSeats > 1 ? "per seat per month" : "per month";
  const note = shown === "yearly"
    ? `billed yearly, ${usd(per * 12)} ${p.minSeats > 1 ? "per seat " : ""}a year${!sold.includes("monthly") ? "; yearly only" : ""}`
    : p.yearlyMonthlyUsd ? `or ${usd(p.yearlyMonthlyUsd)} billed yearly` : "billed monthly";
  return { amount: usd(per), unit: seat, note: `${note}${p.minSeats > 1 ? `; ${p.minSeats} seats minimum` : ""}` };
}

/** The comparison rows: what each plan has, plan by plan. `true` is a tick; a string is shown as it is. */
const ROWS: { label: string; get: (id: PlanId) => string | boolean }[] = [
  { label: "Monthly price", get: (id) => (PLANS[id].selfServe ? (PLANS[id].monthlyUsd ? `${usd(PLANS[id].monthlyUsd!)}${PLANS[id].minSeats > 1 ? " / seat" : ""}` : "yearly only") : "Free") },
  { label: "Yearly price, per month", get: (id) => (PLANS[id].selfServe ? `${usd(PLANS[id].yearlyMonthlyUsd!)}${PLANS[id].minSeats > 1 ? " / seat" : ""}` : "Free") },
  { label: "Seats", get: (id) => (PLANS[id].minSeats > 1 ? `${PLANS[id].minSeats} or more, assignable` : "1") },
  { label: "AI allowance a month", get: (id) => `${usd(PLANS[id].ai.monthlyUsd)}${PLANS[id].minSeats > 1 ? " / seat" : ""}` },
  { label: "AI allowance a day", get: (id) => usd(PLANS[id].ai.dailyUsd) },
  { label: "About this many assistant answers a month", get: (id) => answersFor(PLANS[id].ai.monthlyUsd).toLocaleString("en-US") },
  { label: "AI credit packs when you need more", get: () => true },
  { label: "Terminal, filings, comps, Newsroom, calculators", get: () => true },
  { label: "Full terminal and data, AI workflows", get: (id) => planAtLeast(id, "campus") },
  { label: "Relationships agent, one mailbox, nurture and signals", get: (id) => planAtLeast(id, "pro") },
  { label: "Autopilot and campaigns", get: (id) => planAtLeast(id, "team") },
  { label: "Shared workspaces, the adaptive engine across the team", get: (id) => planAtLeast(id, "team") },
  { label: "Regulated mode and audit exports", get: (id) => planAtLeast(id, "enterprise") },
  { label: "SSO, admin controls, data residency options", get: (id) => planAtLeast(id, "enterprise") },
  ...FEATURES.map((f) => ({ label: f.name, get: (id: PlanId) => planAtLeast(id, f.minPlan) })),
];

const FAQ = [
  { q: "What counts as AI use?", a: "Every model call the assistant, agents, Studio, Edge and the relationships agent make for you, measured in US dollars at the AI providers' list prices. The answer counts are estimates for the default model; a larger model or a long agent run uses more. Settings, under Plan, shows exactly what you have used." },
  { q: "What happens when I reach my allowance?", a: `AI pauses until the allowance resets, and everything else keeps working. If you would rather keep going, buy an AI credit pack: credits are used only after the month's allowance, and while you hold them your daily AI limit is at least ${usd(CREDIT_DAILY_USD)}.` },
  { q: "When does my allowance reset?", a: "On your billing date each month if you pay for a plan (yearly plans too, monthly on the same date), and on the 1st of the month (UTC) on Free and Campus. The daily limit resets at midnight UTC." },
  { q: "Do credit packs expire?", a: "No. Unused credits stay on your account, on any plan, and carry over from month to month. They are personal: they are not shared with your team." },
  { q: "How do team seats work?", a: "The person who buys Deal Team or Enterprise holds one seat and gives the others to people on their team, in Settings under Plan. Each seat has its own AI allowance. Add or remove seats at any time under Manage billing; added seats are charged pro rata, and removed seats come off at the end of the period." },
  { q: "Can I change or cancel my plan?", a: "Yes, under Manage billing in Settings. Upgrades take effect at once and are charged pro rata; downgrades and cancellations take effect at the end of the period you have paid for, and the plan page shows the date." },
  { q: "Do you offer refunds?", a: "Plans can be cancelled at any time and stay on until the end of the paid period. Unused credit packs can be refunded within 14 days of purchase, and a duplicate charge is refunded automatically. The refund policy has the details." },
  { q: "Is tax included?", a: "Prices are in US dollars and exclude tax. Where we are registered to collect sales tax or VAT, Stripe adds it at checkout, and you can add a tax ID for business invoices." },
  { q: "I am a student. Is there a discount?", a: "Campus is free with a .edu address: the full terminal and data, AI workflows with a monthly allowance, and a recruiting pack. Sign in with your school address." },
];

export function Pricing() {
  const [period, setPeriod] = useState<BillingInterval>("monthly");
  const saving = yearlySavingPct();
  return (
    <main className="overflow-x-hidden">
      <SiteHeader />

      <section className="mx-auto max-w-[1240px] px-5 pb-6 pt-12">
        <h1 className="text-[30px] font-semibold leading-tight tracking-tight sm:text-[36px]">Start free. Pay for the AI you need.</h1>
        <p className="mt-3 max-w-[80ch] text-[13px] leading-relaxed text-muted">Every plan has the terminal and the public data. Paid plans add a larger monthly AI allowance and the premium features; credit packs cover the months you need more. Model time is most of what YouBank costs to run, so the allowance is what keeps the prices low. Prices are in US dollars, before tax.</p>
        <div className="mt-6 inline-flex rounded-lg border border-line p-0.5" role="group" aria-label="Billing period">
          {(["monthly", "yearly"] as const).map((i) => (
            <button key={i} type="button" onClick={() => setPeriod(i)} aria-pressed={period === i} className={`ctl px-3.5 py-1.5 text-[12.5px] ${period === i ? "bg-accent-soft font-semibold text-accent" : "text-muted hover:text-fg"}`}>
              {i === "monthly" ? "Monthly" : `Yearly, save up to ${saving}%`}
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto grid max-w-[1240px] gap-3 px-5 sm:grid-cols-2 lg:grid-cols-5">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const price = priceFor(id, period);
          const highlight = id === "pro";
          return (
            <div key={id} className={`panel flex h-full flex-col p-5 ${highlight ? "glow border-accent/50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14px] font-semibold">{p.name}</h2>
                {highlight && <span className="text-[10px] font-semibold uppercase tracking-wider text-accent">Most popular</span>}
              </div>
              <p className="mt-3"><span className="num text-[28px] font-semibold">{price.amount}</span></p>
              <p className="text-[11px] text-muted">{price.unit}</p>
              {price.note && <p className="text-[11px] text-faint">{price.note}</p>}
              <p className="mt-3 text-[12px] leading-relaxed text-muted">{p.blurb}</p>
              <div className="mt-3 rounded-md border border-line bg-elevated/40 px-2.5 py-2 text-[11.5px]">
                <div className="font-medium">AI: {usd(p.ai.monthlyUsd)} a month{p.minSeats > 1 ? " per seat" : ""}</div>
                <div className="text-muted">up to {usd(p.ai.dailyUsd)} a day; about {answersFor(p.ai.monthlyUsd).toLocaleString("en-US")} answers</div>
              </div>
              <ul className="mt-3 flex-1 space-y-1.5 text-[12px]">
                {p.points.map((x) => <li key={x} className="flex gap-1.5"><Icon name="Check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{x}</li>)}
              </ul>
              <Link href={p.selfServe ? PLAN_PAGE : "/sign-in"} className={`ctl mt-4 block px-3 py-2 text-center text-[12.5px] font-semibold ${highlight ? "bg-accent text-accent-fg" : "border border-line hover:border-accent/50"}`}>
                {p.selfServe ? `Choose ${p.name}` : id === "campus" ? "Sign in with your .edu address" : "Start free"}
              </Link>
            </div>
          );
        })}
      </section>

      <section className="mx-auto max-w-[1240px] px-5 py-12">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">AI credit packs</h2>
        <p className="mt-2 max-w-[80ch] text-[13px] text-muted">For the months you need more than your plan includes, on any plan. Credits are used after the month&apos;s allowance, never expire, and are measured like the allowance, at the AI providers&apos; list prices.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKS.map((pk) => (
            <div key={pk.id} className="panel p-5">
              <div className="num text-[24px] font-semibold">{usd(pk.priceUsd)}</div>
              <p className="text-[12px] text-muted">adds {usd(pk.creditUsd)} of AI use, about {answersFor(pk.creditUsd).toLocaleString("en-US")} assistant answers</p>
              <Link href={PLAN_PAGE} className="ctl mt-3 block border border-line px-3 py-1.5 text-center text-[12px] hover:border-accent/50">Buy in Settings</Link>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 pb-12">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Compare plans</h2>
        <div className="mt-5 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="bg-elevated/50 text-left">
                <th scope="col" className="px-3 py-2 font-medium text-muted">Plan</th>
                {PLAN_ORDER.map((id) => <th key={id} scope="col" className="px-3 py-2 font-semibold">{PLANS[id].name}</th>)}
              </tr>
            </thead>
            <tbody>
              {ROWS.map((r) => (
                  <tr key={r.label} className="border-t border-line">
                    <th scope="row" className="px-3 py-2 text-left font-normal text-muted">{r.label}</th>
                    {PLAN_ORDER.map((id) => {
                      const v = r.get(id);
                      return (
                        <td key={id} className="px-3 py-2">
                          {v === true ? <Icon name="Check" className="h-3.5 w-3.5 text-accent" /> : v === false ? <span className="text-faint" aria-label="Not included">·</span> : <span className="num">{v}</span>}
                        </td>
                      );
                    })}
                  </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 pb-16">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Questions</h2>
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {FAQ.map((f) => (
            <details key={f.q} className="panel px-4 py-3">
              <summary className="cursor-pointer text-[13px] font-semibold marker:text-accent">{f.q}</summary>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{f.a}{f.q.startsWith("Do you offer refunds") && <> <Link href={LEGAL.refunds} className="underline hover:text-fg">Read the refund policy</Link>.</>}</p>
            </details>
          ))}
        </div>
      </section>

      <SiteFooter />
    </main>
  );
}
