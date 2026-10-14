"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ACTION_KIND_LABEL, type ActionKind } from "@/lib/crm/model";
import { api, btn, type PanelCtx } from "./shared";

type Action = {
  id: number; kind: string; title: string; reasoning: string; uncertainties: string[];
  payload: { url?: string; meetingId?: number }; meetingId?: number | null; createdAt: string;
};

const ICON: Record<ActionKind, string> = {
  move_stage: "ArrowRight", follow_up: "Mail", check_in: "Timer", reconnect: "TrendingUp",
  update_deal: "Handshake", update_contact: "Users", review_contact: "Users", add_contact: "Plus",
};

/** What the approve button says for each kind. */
const APPROVE: Partial<Record<ActionKind, string>> = {
  move_stage: "Move it", update_deal: "Accept change", update_contact: "Accept change", review_contact: "Keep", add_contact: "Add",
};

/** The agent's suggestions, each with its reasoning and whatever it was unsure of. Nothing happens until approved. */
export function Suggestions({ ctx, onDrafted }: { ctx: PanelCtx; onDrafted: () => void }) {
  const [actions, setActions] = useState<Action[] | null>(null);
  const [emails, setEmails] = useState<Record<number, string>>({});

  useEffect(() => {
    let cancelled = false;
    api<Action[]>("/api/crm/actions").then((a) => { if (!cancelled) setActions(a); }).catch(() => { if (!cancelled) setActions([]); });
    return () => { cancelled = true; };
  }, [ctx.tick]);

  if (!actions || actions.length === 0) return null;

  const approve = (a: Action) => ctx.run(`act-${a.id}`, async () => {
    const r = await api<{ message: string; draftId: number | null }>(`/api/crm/actions/${a.id}`, { method: "POST", body: JSON.stringify(a.kind === "add_contact" ? { email: emails[a.id] ?? "" } : {}) });
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
                {a.kind === "add_contact" && (
                  <input type="email" value={emails[a.id] ?? ""} onChange={(e) => setEmails({ ...emails, [a.id]: e.target.value })} placeholder="their@email.com"
                    className="ctl border border-line bg-bg/60 px-2 py-1 text-[11.5px] outline-none focus:border-accent/60" />
                )}
                <button type="button" disabled={!!ctx.busy || (a.kind === "add_contact" && !(emails[a.id] ?? "").includes("@"))} onClick={() => approve(a)} className={btn.primary}>
                  {ctx.busy === `act-${a.id}` ? "Working…" : APPROVE[a.kind as ActionKind] ?? "Draft it"}
                </button>
                <button type="button" disabled={!!ctx.busy} onClick={() => dismiss(a)} className={btn.link}>{a.kind === "review_contact" ? "Remove them" : a.meetingId ? "Reject" : "Dismiss"}</button>
                {a.payload.url && <a href={a.payload.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">Filing</a>}
                {a.meetingId ? <a href={`/app/crm?tab=meetings&meeting=${a.meetingId}`} className="text-[11px] text-accent hover:underline">From a meeting</a> : null}
              </div>
            </div>
          </div>
        </article>
      ))}
    </section>
  );
}
