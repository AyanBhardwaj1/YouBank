"use client";

/**
 * Settings, under Plan: the person's plan and AI allowance, every plan side by side with its price and
 * allowance, the premium features each plan unlocks (straight from the feature registry, so features
 * added later appear here by themselves), and the buttons that start Stripe Checkout or open the billing
 * portal. Loading this page never calls Stripe or spends anything; only the buttons do.
 *
 * Back from Checkout (`?checkout=done&session_id=...`) it confirms the session with the server, which
 * stores the subscription at once instead of waiting for the webhook, and drops the cached plan
 * (`refreshPlan`) so badges elsewhere read the new one.
 */
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PremiumBadge } from "@/components/billing/Premium";
import { answersFor } from "@/lib/billing/costs";
import { FEATURES, type FeatureArea } from "@/lib/billing/features";
import { intervalsFor, LIVE_STATUSES, PLAN_ORDER, PLANS, planAtLeast, usd, type BillingInterval, type PlanId } from "@/lib/billing/plans";
import { refreshPlan, type ClientEntitlements } from "@/lib/client/plan";

type Status = ClientEntitlements & {
  billing: { enabled: boolean; purchasable: Record<PlanId, BillingInterval[]> };
  subscription: { plan: string; status: string; seats: number; currentPeriodEnd: string | null; manageable: boolean } | null;
  ai: { plan: PlanId; admin: boolean; dailyUsd: number | null; monthlyUsd: number | null; todayUsd: number; monthUsd: number };
};

const AREA_LABEL: Record<FeatureArea, string> = {
  ai: "AI", edge: "Edge", maps: "3D maps and geospatial AI", crypto: "Blockchain and crypto", studio: "Studio",
  relationships: "Relationships", desktop: "Desktop app", platform: "Platform",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active", trialing: "Trial", past_due: "Payment overdue: update your card under Manage billing to keep the plan",
  canceled: "Cancelled", unpaid: "Unpaid", incomplete: "Waiting for the first payment", incomplete_expired: "Checkout expired", paused: "Paused",
};

const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }) : null);
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
      void post<ClientEntitlements>("/api/billing/confirm", { sessionId: back.sessionId })
        .then((e) => setNote(PLANS[e.plan]?.selfServe
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
                {dateOf(status.subscription.currentPeriodEnd) && <span className="text-muted"> · current period ends {dateOf(status.subscription.currentPeriodEnd)}</span>}
              </p>
            )}
            {status.subscription?.manageable && (
              <button type="button" disabled={!!busy} onClick={() => go("portal", "/api/billing/portal", {})} className="ctl mt-3 inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg disabled:opacity-50">
                <Icon name="CreditCard" className="h-3.5 w-3.5" /> {busy === "portal" ? "Opening…" : "Manage billing"}
              </button>
            )}
          </div>
          <div className="space-y-3">
            <div className="text-[10.5px] uppercase tracking-wider text-muted">AI allowance</div>
            <Meter label="Today (resets at midnight UTC)" used={status.ai.todayUsd} cap={status.ai.dailyUsd} />
            <Meter label="This month (resets on the 1st, UTC)" used={status.ai.monthUsd} cap={status.ai.monthlyUsd} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Plans</h3>
        <div className="flex gap-1" role="group" aria-label="Billing period">
          {(["monthly", "yearly"] as const).map((i) => (
            <button key={i} type="button" onClick={() => setPeriod(i)} aria-pressed={period === i} className={`ctl px-3 py-1 text-[12px] ${period === i ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              {i === "monthly" ? "Monthly" : "Yearly, about 17% less"}
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
