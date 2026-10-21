"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { STAGE_LABEL, type Stage } from "@/lib/crm/model";
import { Field, api, btn, input, type PanelCtx } from "./shared";

type ContactLite = { id: number; email: string; name: string };
const BLANK = { name: "", stage: "", contactId: "", amount: "", nextStep: "" };

/**
 * Add a deal to the pipeline by hand. The agent adds deals as it reads mail; this is for the ones that
 * started elsewhere (a call, a conference), and the only way in while no mailbox or AI is set up.
 */
export function AddDeal({ ctx, stages, contacts }: { ctx: PanelCtx; stages: readonly Stage[]; contacts: ContactLite[] }) {
  const [d, setD] = useState<typeof BLANK | null>(null);
  const busy = ctx.busy === "add-deal";
  const add = () => ctx.run("add-deal", async () => {
    if (!d) return;
    const amount = Number(d.amount.replace(/[$,\s]/g, ""));
    await api("/api/crm/deals", {
      method: "POST",
      body: JSON.stringify({ name: d.name, stage: d.stage || stages[0], contactId: d.contactId ? Number(d.contactId) : null, amountUsd: d.amount && Number.isFinite(amount) ? amount : null, nextStep: d.nextStep }),
    });
    setD(null); ctx.say("Deal added."); ctx.refresh();
  });

  if (!d) {
    return (
      <button type="button" onClick={() => setD({ ...BLANK, stage: stages[0] ?? "" })} className={btn.ghost}>
        <Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />Add a deal
      </button>
    );
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!busy && d.name.trim()) void add(); }} onKeyDown={(e) => { if (e.key === "Escape") setD(null); }}
      className="ctl w-full border border-line bg-elevated/40 p-3.5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Deal"><input autoFocus required value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="Ledgerline seed round" className={input} /></Field>
        <Field label="Stage">
          <Select value={d.stage} onChange={(v) => setD({ ...d, stage: v })} className={input}>
            {stages.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </Select>
        </Field>
        <Field label="Contact">
          <Select value={d.contactId} onChange={(v) => setD({ ...d, contactId: v })} className={input}>
            <option value="">No one yet</option>
            {contacts.map((c) => <option key={c.id} value={String(c.id)}>{c.name || c.email}</option>)}
          </Select>
        </Field>
        <Field label="Amount (USD)"><input inputMode="decimal" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} placeholder="2,000,000" className={input} /></Field>
      </div>
      <div className="mt-2"><Field label="Next step"><input value={d.nextStep} onChange={(e) => setD({ ...d, nextStep: e.target.value })} placeholder="Send the deck by Friday" className={input} /></Field></div>
      <div className="mt-2.5 flex gap-2">
        <button type="submit" disabled={busy || !d.name.trim()} className={btn.primary}>{busy ? "Adding…" : "Add deal"}</button>
        <button type="button" onClick={() => setD(null)} className={btn.link}>Cancel</button>
      </div>
    </form>
  );
}
