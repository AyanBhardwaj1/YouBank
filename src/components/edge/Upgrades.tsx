"use client";

/**
 * Edge's premium upgrades, for everyone with Edge: each with what it improves, whether YouBank has it
 * switched on, and whether this person's plan includes it (with the plan's badge when it does not).
 * Administrators also see what each costs us, the settings that switch it on (names only, never values)
 * and the steps, plus the platform settings that are not plan features. Nothing is bought here: an
 * upgrade runs only when someone whose plan includes it uses it.
 */
import { useState } from "react";
import Link from "next/link";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import type { UpgradeView } from "@/lib/edge/premium";
import { useApi } from "./client";

const MODULE_LABEL: Record<string, string> = { documents: "Documents", earth: "Earth", networks: "Networks", scenarios: "Scenarios", deals: "Deals", pulse: "Pulse", platform: "Platform" };

function Status({ u, admin }: { u: UpgradeView; admin: boolean }) {
  const [label, cls] = !u.ready
    ? [admin ? (u.built ? "Not set up" : "Planned") : "Coming soon", "bg-elevated text-muted"]
    : !u.plan ? ["On", "bg-pos/15 text-pos"]
      : u.plan.unlocked ? ["In your plan", "bg-pos/15 text-pos"] : ["Locked", "bg-accent-soft text-accent"];
  return <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${cls}`}>{label}</span>;
}

export function EdgeUpgrades() {
  const { data } = useApi<{ admin: boolean; plan: string; upgrades: UpgradeView[] }>("/api/edge/upgrades");
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const { admin, upgrades } = data;
  const yours = upgrades.filter((u) => u.plan?.unlocked && u.ready).length;
  const groups = [...new Set(upgrades.map((u) => u.module))];
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Edge premium upgrades</h3>
        <span className="text-[11px] text-muted"><span className="num">{yours}</span> of <span className="num">{upgrades.filter((u) => u.plan).length}</span> available to you{admin ? " · administrator view" : ""}</span>
      </div>
      <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-muted">
        Paid data and models beyond the free methods. Each runs only when you use it, never in the background, and only if your plan includes it; otherwise Edge keeps using its free method. <Link href="/app/settings?tab=plan" className="text-accent hover:underline">See plans</Link>.
        {admin && " As an administrator you can use all of them; an upgrade also needs its settings in Vercel before anyone can."}
      </p>
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{MODULE_LABEL[g] ?? g}</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {upgrades.filter((u) => u.module === g).map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-elevated/40">
                    <Status u={u} admin={admin} />
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{u.plan?.name ?? u.name}</span>
                    {u.plan && <PremiumBadge feature={u.plan.feature} />}
                    <Icon name="ChevronRight" className={`h-3.5 w-3.5 shrink-0 text-muted transition ${open === u.id ? "rotate-90" : ""}`} />
                  </button>
                  {open === u.id && (
                    <div className="space-y-1.5 px-3 pb-3 text-[12px] leading-relaxed">
                      <p>{u.improves}</p>
                      {u.plan && <p className="text-muted">{u.plan.unlocked ? "Included in your plan." : `Part of the ${u.plan.planName} plan.`}{!u.ready && " Not switched on yet."}</p>}
                      {admin && u.setup && (
                        <>
                          <p className="text-muted"><span className="font-medium text-fg">What it costs us. </span>{u.cost}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {[...u.setup.needs.map((n) => ({ name: n.name, set: n.set, value: null as string | null })), ...(u.setup.flag ? [{ name: u.setup.flag.name, set: u.setup.flag.set, value: u.setup.flag.value }] : [])].map((n) => (
                              <span key={n.name} className={`num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${n.set ? "border-pos/40 text-pos" : "border-line text-muted"}`}>
                                <Icon name={n.set ? "Check" : "X"} className="h-3 w-3" />{n.name}{n.value ? `=${n.value}` : ""}
                              </span>
                            ))}
                          </div>
                          <ol className="list-decimal space-y-0.5 pl-4 text-muted">{u.setup.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
                        </>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
