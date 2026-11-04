"use client";

/**
 * Home's "Getting started": the steps that make YouBank useful, ticked from what the person has done
 * (src/lib/desk/checklist.ts), with a progress bar and the next step first. Where the browser offers it,
 * "Install the app" installs it right here. Once everything is done the widget leaves Home by itself;
 * "Hide" takes it off sooner.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useWorkspace } from "../WorkspaceProvider";
import { fetchJson } from "@/lib/client/errors";
import { canInstall, isInstalled, onInstallChange, promptInstall } from "@/lib/client/install";
import { checklist, type ChecklistFacts } from "@/lib/desk/checklist";
import { WIDGET_LABEL, toggleWidget } from "@/lib/desk/desk";

export function ChecklistWidget({ roomy }: { roomy?: boolean }) {
  const { desk, setDesk } = useWorkspace();
  const [facts, setFacts] = useState<(Omit<ChecklistFacts, "installed"> & { desktop?: boolean }) | null>(null);
  const [installed, setInstalled] = useState(false);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    fetchJson<Omit<ChecklistFacts, "installed"> & { desktop?: boolean }>("/api/desk/checklist").then(setFacts).catch(() => setFacts(null));
    const sync = () => { setInstalled(isInstalled()); setOffer(canInstall()); };
    sync();
    return onInstallChange(sync);
  }, []);
  if (!facts) return null;
  const c = checklist({ ...facts, installed: installed || !!facts.desktop });
  if (c.done === c.total) return null;
  const pct = Math.round((c.done / c.total) * 100);
  return (
    <section className={roomy ? "home-card p-5" : "panel p-3"} aria-label={WIDGET_LABEL.checklist}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className={roomy ? "text-[14px] font-semibold text-fg" : "text-[11px] uppercase tracking-wider text-muted"}>{WIDGET_LABEL.checklist}</h2>
        <span className="flex items-center gap-2 text-[11px] text-muted">
          <span className="num">{c.done} of {c.total}</span>
          <button type="button" onClick={() => setDesk({ widgets: toggleWidget(desk.widgets, "checklist", false) })} className="hover:text-fg">Hide</button>
        </span>
      </div>
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Getting started progress">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <ul className="space-y-1">
        {[...c.steps.filter((s) => !s.done), ...c.steps.filter((s) => s.done)].map((s) => (
          <li key={s.id} className={`flex items-center gap-2.5 ctl px-2 py-1.5 ${s === c.next ? "bg-accent-soft/50" : ""}`}>
            <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${s.done ? "border-pos bg-pos text-bg" : "border-line-strong"}`}>{s.done && <Icon name="Check" className="h-3 w-3" />}</span>
            <span className={`min-w-0 flex-1 ${s.done ? "text-muted line-through decoration-line-strong" : ""}`}>
              <span className={`block ${roomy ? "text-[13px]" : "text-[12px]"} ${s.done ? "" : "text-fg"}`}>{s.label}</span>
              {!s.done && <span className="block truncate text-[11px] text-muted">{s.hint}</span>}
            </span>
            {!s.done && (s.id === "installed" && offer
              ? <button type="button" onClick={() => void promptInstall()} className="ctl shrink-0 bg-accent px-2 py-1 text-[11px] font-semibold text-accent-fg">Install</button>
              : <Link href={s.href} className={`ctl shrink-0 px-2 py-1 text-[11px] ${s === c.next ? "bg-accent font-semibold text-accent-fg" : "border border-line text-muted hover:text-fg"}`}>{s.cta}</Link>)}
          </li>
        ))}
      </ul>
    </section>
  );
}
