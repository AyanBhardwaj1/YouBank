"use client";

/**
 * Edge's paid upgrades, for administrators: each with what it improves, what it costs, whether it is on,
 * and the settings that turn it on (names only). Nothing is bought here; an upgrade turns on when its
 * key is set in the environment. Hidden from everyone else.
 */
import { ChevronDown, Check, Circle } from "lucide-react";
import { useState } from "react";
import type { UpgradeStatus } from "@/lib/edge/premium";
import { useApi } from "./client";

const MODULE_LABEL: Record<string, string> = { documents: "Documents", earth: "Earth", networks: "Networks", scenarios: "Scenarios", platform: "Platform" };

export function EdgeUpgrades() {
  const { data } = useApi<{ upgrades: UpgradeStatus[] }>("/api/edge/upgrades");
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return null;
  const on = data.upgrades.filter((u) => u.on).length;
  const groups = [...new Set(data.upgrades.map((u) => u.module))];
  return (
    <div className="panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13.5px] font-semibold">Edge upgrades</h3>
        <span className="text-[11px] text-muted"><span className="num">{on}</span> of <span className="num">{data.upgrades.length}</span> on · administrators only</span>
      </div>
      <p className="mt-1 max-w-[72ch] text-[12px] leading-relaxed text-muted">Paid or keyed improvements beyond the free tiers. Each stays off, and costs nothing, until its setting is added in Vercel; until then Edge uses its free method. Ready ones need only the key; planned ones are described in docs/edge-roadmap.md.</p>
      <div className="mt-3 space-y-3">
        {groups.map((g) => (
          <div key={g}>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{MODULE_LABEL[g] ?? g}</div>
            <ul className="divide-y divide-line rounded-lg border border-line">
              {data.upgrades.filter((u) => u.module === g).map((u) => (
                <li key={u.id}>
                  <button type="button" onClick={() => setOpen(open === u.id ? null : u.id)} aria-expanded={open === u.id} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-elevated/40">
                    <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wider ${u.on ? "bg-pos/15 text-pos" : u.built ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{u.on ? "On" : u.built ? "Ready" : "Planned"}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{u.name}</span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted transition ${open === u.id ? "rotate-180" : ""}`} />
                  </button>
                  {open === u.id && (
                    <div className="space-y-1.5 px-3 pb-3 text-[12px] leading-relaxed">
                      <p>{u.improves}</p>
                      <p className="text-muted"><span className="font-medium text-fg">Cost. </span>{u.cost}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {[...u.needs.map((n) => ({ name: n.name, set: n.set, value: null as string | null })), ...(u.flag ? [{ name: u.flag.name, set: u.flag.set, value: u.flag.value }] : [])].map((n) => (
                          <span key={n.name} className={`num inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] ${n.set ? "border-pos/40 text-pos" : "border-line text-muted"}`}>
                            {n.set ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}{n.name}{n.value ? `=${n.value}` : ""}
                          </span>
                        ))}
                      </div>
                      <ol className="list-decimal space-y-0.5 pl-4 text-muted">{u.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
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
