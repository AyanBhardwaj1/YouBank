"use client";

/**
 * Settings, under Plan: the person's plan and AI allowance, every plan side by side with its price and
 * allowance, the premium features each plan unlocks (straight from the feature registry, so features
 * added later appear here by themselves), and the buttons that start Stripe Checkout or open the billing
 * portal. Loading this page never calls Stripe or spends anything; only the buttons do.
 *
 * Back from Checkout (`?checkout=done&session_id=...`) it confirms the session with the server, which
 * stores the subscription (or adds the credit pack) at once instead of waiting for the webhook, and drops
 * the cached plan (`refreshPlan`) so badges elsewhere read the new one.
 *
 * Also here: AI credit packs (bought with a one-time Checkout), the renewal or cancellation date, and the
 * person's Stripe-hosted invoices and receipts, read only when asked for.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PremiumBadge } from "@/components/billing/Premium";
import { answersFor } from "@/lib/billing/costs";
import { CREDIT_PACKS, packById } from "@/lib/billing/packs";
import { FEATURES, type FeatureArea } from "@/lib/billing/features";
import { intervalsFor, LIVE_STATUSES, PLAN_ORDER, PLANS, planAtLeast, usd, yearlySavingPct, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { refreshPlan, type ClientEntitlements } from "@/lib/client/plan";

type Status = ClientEntitlements & {
  billing: { enabled: boolean; purchasable: Record<PlanId, BillingInterval[]>; packs: boolean };
  subscription: { plan: string; status: string; seats: number; currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; cancelAt: string | null; manageable: boolean } | null;
  ai: {
    plan: PlanId; admin: boolean; dailyUsd: number | null; dailyNowUsd: number | null; monthlyUsd: number | null; todayUsd: number; monthUsd: number;
    periodStart: string; periodEnd: string;
    credits: { availableUsd: number; usedUsd: number; leftUsd: number; packs: { pack: string; usd: number; leftUsd: number; boughtAt: string }[] };
  };
};

type Confirmed = ClientEntitlements & { kind: "plan" | "credits"; paid: boolean; pack: string | null };
type Bills = {
  invoices: { id: string; number: string | null; status: string | null; created: string; amount: number; currency: string; url: string | null; pdf: string | null }[];
  receipts: { id: string; description: string; created: string; amount: number; refunded: number; currency: string; url: string | null }[];
};

const AREA_LABEL: Record<FeatureArea, string> = {
  ai: "AI", edge: "Edge", maps: "3D maps and geospatial AI", crypto: "Blockchain and crypto", studio: "Studio",
  relationships: "Relationships", desktop: "Desktop app", platform: "Platform",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment overdue: update your card under Manage billing to keep the plan",
  canceled: "Cancelled", unpaid: "Unpaid", incomplete: "Waiting for the first payment", incomplete_expired: "Checkout expired", paused: "Paused",
};

const dateOf = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : null);
const shortDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", timeZone: "UTC" });
const cash = (n: number, currency = "usd") => n.toLocaleString("en-US", { style: "currency", currency: currency.toUpperCase() });
const money = (n: number) => (n < 10 ? `$${n.toFixed(2)}` : `$${Math.round(n).toLocaleString("en-US")}`);

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? "Something went wrong on our side. Try again in a moment.");
  return j;
}

/** The plan page's data; null when it could not be read. Reads only, never calls Stripe. */
const fetchStatus = (): Promise<Status | null> =>
  fetch("/api/billing/status", { cache: "no-store" }).then((r) => (r.ok ? (r.json() as Promise<Status>) : null), () => null);

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const share = cap ? Math.min(1, used / cap) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="text-muted">{label}</span>
        <span className="num">{money(used)}{cap !== null ? <span className="text-muted"> of {money(cap)}</span> : <span className="text-muted"> · no cap</span>}</span>
      </div>
      {cap !== null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
          <div className={`h-full rounded-full ${share >= 0.9 ? "bg-neg" : "bg-accent"}`} style={{ width: `${Math.max(2, share * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

/** Stripe-hosted invoices (subscriptions) and receipts (credit packs), fetched only when asked for. */
function Bills() {
  const [bills, setBills] = useState<Bills | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const load = () => {
    setState("loading");
    fetch("/api/billing/invoices", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Bills>) : Promise.reject(new Error("failed"))))
      .then((b) => { setBills(b); setState("idle"); }, () => setState("error"));
  };
  if (!bills) {
    return (
      <button type="button" onClick={load} disabled={state === "loading"} className="ctl inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50">
        <Icon name="Receipt" className="h-3.5 w-3.5" /> {state === "loading" ? "Loading…" : state === "error" ? "Could not load; try again" : "Invoices and receipts"}
      </button>
    );
  }
  const rows = [
    ...bills.invoices.map((i) => ({ id: i.id, when: i.created, what: `Invoice ${i.number ?? ""}`.trim(), amount: cash(i.amount, i.currency), note: i.status === "paid" ? "" : i.status ?? "", url: i.url, pdf: i.pdf })),
    ...bills.receipts.filter((r) => /credit/i.test(r.description)).map((r) => ({ id: r.id, when: r.created, what: r.description, amount: cash(r.amount, r.currency), note: r.refunded ? `refunded ${cash(r.refunded, r.currency)}` : "", url: r.url, pdf: null as string | null })),
  ].sort((a, b) => b.when.localeCompare(a.when));
  return (
    <div className="w-full">
      {rows.length === 0 ? <p className="text-[11.5px] text-muted">No invoices or receipts yet.</p> : (
        <ul className="divide-y divide-line rounded-lg border border-line text-[11.5px]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-1.5">
              <span className="text-muted">{dateOf(r.when)}</span>
              <span className="min-w-0 flex-1 truncate">{r.what}{r.note && <span className="text-muted"> · {r.note}</span>}</span>
              <span className="num">{r.amount}</span>
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">View</a>}
              {r.pdf && <a href={r.pdf} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">PDF</a>}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10.5px] text-faint">Hosted by Stripe. Every past invoice, your card and your tax details are under Manage billing.</p>
    </div>
  );
}

export function PlanSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<BillingInterval>("monthly");
  // Kept as typed, so "12" can be entered for a three-seat minimum; clamped on blur and when sent.
  const [seats, setSeats] = useState<Record<PlanId, string>>(() => Object.fromEntries(PLAN_ORDER.map((p) => [p, String(PLANS[p].minSeats)])) as Record<PlanId, string>);
  // Only the minimum is applied here; above the online maximum the server says to write to us.
  const seatCount = (id: PlanId) => Math.max(PLANS[id].minSeats, Math.floor(Number(seats[id])) || PLANS[id].minSeats);
  const [busy, setBusy] = useState<string | null>(null);
  // Back from Checkout: read once, from the address this page opened with.
  const params = useSearchParams();
  const [back] = useState(() => ({ outcome: params.get("checkout"), sessionId: params.get("session_id") }));
  const [note, setNote] = useState<{ tone: "ok" | "error" | "info"; text: string } | null>(() =>
    back.outcome === "done" && back.sessionId ? { tone: "info", text: "Confirming your payment with Stripe…" }
      : back.outcome === "canceled" ? { tone: "info", text: "Checkout was cancelled. Nothing was charged." } : null);

  const show = useCallback((v: Status | null) => {
    setStatus((old) => v ?? old);
    setLoadError(v ? null : "Your plan could not be loaded. Reload the page to try again.");
  }, []);

  useEffect(() => {
    const clean = () => window.history.replaceState(null, "", "/app/settings?tab=plan");
    if (back.outcome === "done" && back.sessionId) {
      void post<Confirmed>("/api/billing/confirm", { sessionId: back.sessionId })
        .then((e) => setNote(e.kind === "credits"
          ? e.paid
            ? { tone: "ok", text: `Thank you. ${usd(packById(e.pack ?? "")?.creditUsd ?? 0)} of AI credits were added to your account.` }
            : { tone: "info", text: "Stripe is still confirming your payment. Your credits appear here as soon as it does." }
          : PLANS[e.plan]?.selfServe
            ? { tone: "ok", text: `Thank you. You are on ${PLANS[e.plan].name} now.` }
            : { tone: "info", text: "Stripe is still confirming your payment. Your plan changes here as soon as it does." }))
        .catch((e: Error) => setNote({ tone: "error", text: e.message }))
        .finally(() => { refreshPlan(); clean(); void fetchStatus().then(show); });
      return;
    }
    if (back.outcome) clean();
    void fetchStatus().then(show);
  }, [back, show]);

  const go = async (key: string, url: string, body: unknown) => {
    setBusy(key); setNote(null);
    try {
      const { url: to } = await post<{ url: string }>(url, body);
      window.location.assign(to);
    } catch (e) {
      setNote({ tone: "error", text: (e as Error).message });
      setBusy(null);
    }
  };

  // Unknown until the status loads, so no card claims to be "Current" before then.
  const current: PlanId | null = status?.plan ?? null;
  const enabled = status?.billing.enabled ?? false;
  // Someone with a live subscription changes plan in the portal; a lapsed one buys anew.
  const paying = !!status?.subscription?.manageable && LIVE_STATUSES.includes(status.subscription.status);
  const unlocked = new Set(status?.features ?? []);
  const areas = [...new Set(FEATURES.map((f) => f.area))];
  const anyYearlyOnly = PLAN_ORDER.some((p) => PLANS[p].selfServe && !PLANS[p].monthlyUsd);

  return (
    <section className="mt-5 rise space-y-4">
      <div>
        <h2 className="text-[14px] font-semibold">Plan</h2>
        <p className="mt-1 max-w-[72ch] text-[12px] text-muted">What your plan includes, how much of its AI allowance you have used, and what each plan adds. AI use is measured in dollars of model time at the providers&apos; list prices; the answer counts are estimates for the default model.</p>
      </div>

      {note && (
        <div role="status" className={`ctl border px-3 py-2 text-[12px] ${note.tone === "error" ? "border-neg/40 text-neg" : note.tone === "ok" ? "border-pos/40 text-pos" : "border-line text-muted"}`}>{note.text}</div>
      )}
      {loadError && <div className="ctl border border-neg/40 px-3 py-2 text-[12px] text-neg">{loadError}</div>}
      {status && !enabled && (
        <div className="ctl flex items-start gap-2 border border-line bg-elevated/60 px-3 py-2 text-[12px]">
          <Icon name="CreditCard" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
          <span><span className="font-semibold">Billing isn&apos;t switched on yet.</span> <span className="text-muted">The prices below are what each plan costs; nothing can be bought or charged today.</span></span>
        </div>
      )}

      {status && (
        <div className="panel grid gap-4 p-4 md:grid-cols-[1fr_1fr]">
          <div className="min-w-0">
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Your plan</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[16px] font-semibold">
              {PLANS[status.plan].name}
              {status.admin && <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">Administrator</span>}
            </div>
            <p className="mt-1 text-[12px] text-muted">
              {status.admin ? "As an administrator you can use everything, with no AI cap." : PLANS[status.plan].blurb}
            </p>
            {status.subscription && status.subscription.status !== "none" && (
              <p className="mt-1.5 text-[12px]">
                <span className={status.subscription.status === "past_due" ? "text-neg" : ""}>{STATUS_LABEL[status.subscription.status] ?? status.subscription.status}</span>
                {status.subscription.seats > 1 && <span className="text-muted"> · <span className="num">{status.subscription.seats}</span> seats</span>}
                {LIVE_STATUSES.includes(status.subscription.status) && (status.subscription.cancelAtPeriodEnd && dateOf(status.subscription.cancelAt ?? status.subscription.currentPeriodEnd)
                  ? <span className="font-medium text-neg"> · Cancels on {dateOf(status.subscription.cancelAt ?? status.subscription.currentPeriodEnd)}</span>
                  : dateOf(status.subscription.currentPeriodEnd) && <span className="text-muted"> · renews on {dateOf(status.subscription.currentPeriodEnd)}</span>)}
              </p>
            )}
            {status.subscription?.cancelAtPeriodEnd && LIVE_STATUSES.includes(status.subscription.status) && (
              <p className="mt-1 text-[11.5px] text-muted">Your plan stays on until then, then moves to the free plan (Campus with a .edu address). Your AI credits stay. To keep the plan, choose Manage billing and renew it.</p>
            )}
            {status.subscription?.manageable && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} onClick={() => go("portal", "/api/billing/portal", {})} className="ctl inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50">
                  <Icon name="CreditCard" className="h-3.5 w-3.5" /> {busy === "portal" ? "Opening…" : "Manage billing"}
                </button>
                <Bills />
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="text-[10.5px] uppercase tracking-wider text-muted">AI allowance</div>
            <Meter label="Today (resets at midnight UTC)" used={status.ai.todayUsd} cap={status.ai.dailyNowUsd ?? status.ai.dailyUsd} />
            <Meter label={`This allowance month (resets on ${shortDate(status.ai.periodEnd)}${status.anchor ? ", your billing date" : ""})`} used={Math.min(status.ai.monthUsd, status.ai.monthlyUsd ?? status.ai.monthUsd)} cap={status.ai.monthlyUsd} />
            {status.ai.credits.availableUsd > 0 && (
              <Meter label={`AI credits: ${money(status.ai.credits.leftUsd)} left, used after the allowance`} used={status.ai.credits.usedUsd} cap={status.ai.credits.availableUsd} />
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Plans</h3>
        <div className="flex gap-1" role="group" aria-label="Billing period">
          {(["monthly", "yearly"] as const).map((i) => (
            <button key={i} type="button" onClick={() => setPeriod(i)} aria-pressed={period === i} className={`ctl px-3 py-1 text-[12px] ${period === i ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              {i === "monthly" ? "Monthly" : `Yearly, save up to ${yearlySavingPct()}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {PLAN_ORDER.map((id) => {
          const p = PLANS[id];
          const sold = intervalsFor(id);
          const shown: BillingInterval | null = sold.includes(period) ? period : sold[0] ?? null;
          const perMonth = shown === "monthly" ? p.monthlyUsd : shown === "yearly" ? p.yearlyMonthlyUsd : 0;
          const isCurrent = id === current;
          const below = !!current && !isCurrent && planAtLeast(current, id);
          const buyable = !!shown && (status?.billing.purchasable[id] ?? []).includes(shown);
          const featureCount = FEATURES.filter((f) => planAtLeast(id, f.minPlan) && !planAtLeast("free", f.minPlan)).length;
          return (
            <div key={id} className={`panel flex h-full flex-col p-4 ${isCurrent ? "border-accent/50" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-[13.5px] font-semibold">{p.name}</h4>
                {isCurrent && <span className="text-[10.5px] font-semibold uppercase tracking-wider text-accent">Current</span>}
              </div>
              <p className="mt-2">
                <span className="num text-[22px] font-semibold">{perMonth ? usd(perMonth) : "Free"}</span>
              </p>
              <p className="text-[11px] text-muted">
                {id === "campus" ? "with a .edu address" : !perMonth ? "for everyone" : `per ${p.minSeats > 1 ? "seat per " : ""}month${shown === "yearly" ? `, billed yearly (${usd(perMonth * 12)} a ${p.minSeats > 1 ? "seat a " : ""}year)` : ""}`}
                {p.minSeats > 1 && perMonth ? `, ${p.minSeats} seats minimum` : ""}
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">{p.blurb}</p>
              <div className="mt-3 rounded-md border border-line bg-elevated/40 px-2.5 py-2 text-[11.5px]">
                <div className="font-medium">AI: {usd(p.ai.monthlyUsd)} a month{p.minSeats > 1 ? " per seat" : ""}</div>
                <div className="text-muted">up to {usd(p.ai.dailyUsd)} a day; about {answersFor(p.ai.monthlyUsd).toLocaleString("en-US")} assistant answers a month</div>
              </div>
              <ul className="mt-3 flex-1 space-y-1.5 text-[11.5px]">
                {p.points.map((x) => <li key={x} className="flex gap-1.5"><Icon name="Check" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{x}</li>)}
                {featureCount > 0 && <li className="flex gap-1.5"><Icon name="Sparkles" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />{featureCount} premium feature{featureCount === 1 ? "" : "s"}</li>}
              </ul>
              <div className="mt-4">
                {isCurrent ? (
                  <div className="text-[11.5px] text-muted">Your plan</div>
                ) : below ? (
                  <div className="text-[11.5px] text-muted">Included in your plan</div>
                ) : !p.selfServe ? (
                  <div className="text-[11.5px] text-muted">{id === "campus" ? "Sign in with your .edu address" : "No card needed"}</div>
                ) : (
                  <div className="space-y-2">
                    {p.minSeats > 1 && (
                      <label className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
                        Seats
                        <input type="number" min={p.minSeats} max={500} value={seats[id]} onChange={(e) => setSeats({ ...seats, [id]: e.target.value })} onBlur={() => setSeats({ ...seats, [id]: String(seatCount(id)) })} className="num ctl w-16 border border-line bg-transparent px-2 py-0.5 text-right text-[12px] text-fg" />
                      </label>
                    )}
                    <button
                      type="button"
                      disabled={!buyable || !!busy}
                      onClick={() => shown && go(id, "/api/billing/checkout", { plan: id, interval: shown, seats: seatCount(id) })}
                      title={!enabled ? "Billing isn't switched on yet" : !buyable ? "Not on sale online yet" : undefined}
                      className="ctl w-full bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy === id ? "Opening checkout…" : paying && current && planAtLeast(id, current) ? `Switch to ${p.name}` : `Choose ${p.name}`}
                    </button>
                    {status && !enabled && <p className="text-[10.5px] text-faint">Billing isn&apos;t switched on yet.</p>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {anyYearlyOnly && <p className="text-[11px] text-faint">Enterprise is billed yearly. Prices are in US dollars and exclude tax.</p>}

      <div className="panel p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13.5px] font-semibold">AI credit packs</h3>
          {status && status.ai.credits.leftUsd > 0 && <span className="text-[11.5px] text-muted"><span className="num font-medium text-fg">{money(status.ai.credits.leftUsd)}</span> of credits left</span>}
        </div>
        <p className="mt-1 max-w-[72ch] text-[12px] text-muted">Need more AI than your plan includes? A pack keeps AI going once this month&apos;s allowance is used, until its credits run out. Credits never expire, work on any plan, and are measured like the allowance, at the providers&apos; list prices. While you hold credits your daily AI limit is at least $10.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {CREDIT_PACKS.map((pk) => (
            <div key={pk.id} className="rounded-lg border border-line p-3">
              <div className="num text-[18px] font-semibold">{usd(pk.priceUsd)}</div>
              <div className="text-[11.5px] text-muted">adds {usd(pk.creditUsd)} of AI, about {answersFor(pk.creditUsd).toLocaleString("en-US")} assistant answers</div>
              <button
                type="button"
                disabled={!status?.billing.packs || !!busy}
                onClick={() => go(`pack:${pk.id}`, "/api/billing/credits", { pack: pk.id })}
                title={status && !status.billing.packs ? "Billing isn't switched on yet" : undefined}
                className="ctl mt-2 w-full border border-accent/50 px-3 py-1.5 text-[12px] font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === `pack:${pk.id}` ? "Opening checkout…" : `Buy ${usd(pk.priceUsd)} pack`}
              </button>
            </div>
          ))}
        </div>
        {status && status.ai.credits.packs.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-lg border border-line text-[11.5px]">
            {status.ai.credits.packs.map((pk, i) => (
              <li key={`${pk.boughtAt}-${i}`} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span>{usd(pk.usd)} of credits, bought {dateOf(pk.boughtAt)}</span>
                <span className="num text-muted">{pk.leftUsd > 0 ? `${money(pk.leftUsd)} left` : "used up"}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[10.5px] text-faint">One-time payments in US dollars, before tax. Unused packs can be refunded within 14 days; see the <a href="/refunds" className="underline hover:text-fg">refund policy</a>.</p>
      </div>

      <div className="panel p-4">
        <h3 className="text-[13.5px] font-semibold">Premium features</h3>
        <p className="mt-1 max-w-[72ch] text-[12px] text-muted">Each is fully built; your plan decides whether you can use it. Ones that cost us money per use (large models, paid data) run only when you start them.</p>
        {!status ? null : FEATURES.length === 0 ? (
          <p className="mt-3 text-[12px] text-muted">Premium features appear here as they are added.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {areas.map((a) => (
              <div key={a}>
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{AREA_LABEL[a] ?? a}</div>
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {FEATURES.filter((f) => f.area === a).map((f) => (
                    <li key={f.id} className="flex items-start gap-2 px-3 py-2">
                      <Icon name={unlocked.has(f.id) ? "Check" : "Lock"} className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${unlocked.has(f.id) ? "text-pos" : "text-faint"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-medium">{f.name}</div>
                        <div className="text-[11.5px] text-muted">{f.description}</div>
                      </div>
                      <PremiumBadge feature={f.id} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
