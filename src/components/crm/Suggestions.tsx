"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ACTION_KIND_LABEL, type ActionKind } from "@/lib/crm/model";
import { api, btn, type PanelCtx } from "./shared";

type Action = {
  id: number; kind: string; title: string; reasoning: string; uncertainties: string[];
  payload: { url?: string }; createdAt: string;
};

const ICON: Record<ActionKind, string> = { move_stage: "ArrowRight", follow_up: "Mail", check_in: "Timer", reconnect: "TrendingUp" };

/** The agent's suggestions, each with its reasoning and whatever it was unsure of. Nothing happens until approved. */
export function Suggestions({ ctx, onDrafted }: { ctx: PanelCtx; onDrafted: () => void }) {
  const [actions, setActions] = useState<Action[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Action[]>("/api/crm/actions").then((a) => { if (!cancelled) setActions(a); }).catch(() => { if (!cancelled) setActions([]); });
    return () => { cancelled = true; };
  }, [ctx.tick]);

  if (!actions || actions.length === 0) return null;

  const approve = (a: Action) => ctx.run(`act-${a.id}`, async () => {
    const r = await api<{ message: string; draftId: number | null }>(`/api/crm/actions/${a.id}`, { method: "POST" });
    ctx.say(r.message);
    if (r.draftId) onDrafted();
    ctx.refresh();
  });
  const dismiss = (a: Action) => ctx.run(`dis-${a.id}`, async () => {
    await api(`/api/crm/actions/${a.id}`, { method: "DELETE" });
    ctx.refresh();
  });

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12.5px] font-semibold">Suggested next steps <span className="num font-normal text-muted">{actions.length}</span></h3>
      {actions.map((a) => (
        <article key={a.id} className="ctl border border-line bg-elevated/30 p-3">
          <div className="flex items-start gap-2">
            <Icon name={ICON[a.kind as ActionKind] ?? "Lightbulb"} className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h4 className="text-[12.5px] font-semibold">{a.title}</h4>
                <span className="text-[10.5px] text-muted">{ACTION_KIND_LABEL[a.kind as ActionKind] ?? a.kind}</span>
              </div>
              {a.reasoning && <p className="mt-0.5 text-[11.5px] text-muted"><span className="font-semibold">Why:</span> {a.reasoning}</p>}
              {a.uncertainties.length > 0 && (
                <ul className="mt-1 list-inside list-disc text-[11px] text-info">{a.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={!!ctx.busy} onClick={() => approve(a)} className={btn.primary}>
                  {ctx.busy === `act-${a.id}` ? "Working…" : a.kind === "move_stage" ? "Move it" : "Draft it"}
                </button>
                <button type="button" disabled={!!ctx.busy} onClick={() => dismiss(a)} className={btn.link}>Dismiss</button>
                {a.payload.url && <a href={a.payload.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">Filing</a>}
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
