"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { CONTACT_KINDS, KIND_LABEL, type ContactKind } from "@/lib/crm/model";
import { Empty, Field, ago, api, btn, input, type PanelCtx } from "./shared";
import { Select } from "@/components/ui/Select";
import { confirmDialog } from "@/components/ui/Dialog";

type Signal = { id: number; title: string; url: string; strength: string };
type Contact = {
  id: number; email: string; name: string; title: string; company: string; kind: string; notes: string; startupId: number | null;
  optedOutAt: string | null; lastContactAt: string | null; lastSentAt: string | null; exchanges: number; signals: Signal[];
};

const BLANK = { email: "", name: "", company: "", kind: "unknown", notes: "" };

/** Everyone the agent knows, when you last spoke, what is new about them, and whether they can be written to. */
export function ContactsPanel({ ctx }: { ctx: PanelCtx }) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState<typeof BLANK | null>(null);
  const [notes, setNotes] = useState<{ id: number; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Contact[]>("/api/crm/contacts").then((c) => { if (!cancelled) setContacts(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? contacts.filter((c) => `${c.name} ${c.email} ${c.company} ${c.title}`.toLowerCase().includes(needle)) : contacts;
  }, [contacts, q]);

  const add = () => ctx.run("add-contact", async () => {
    if (!adding) return;
    await api("/api/crm/contacts", { method: "POST", body: JSON.stringify(adding) });
    setAdding(null); ctx.say("Added."); ctx.refresh();
  });
  const patch = (id: number, body: Record<string, unknown>, message: string) => ctx.run(`c-${id}`, async () => {
    await api(`/api/crm/contacts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    ctx.say(message); ctx.refresh();
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people and companies" className={`${input} w-full max-w-[320px]`} />
        <button type="button" onClick={() => setAdding(adding ? null : BLANK)} className={btn.ghost}>
          <Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />Add a contact
        </button>
      </div>

      {adding && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="Email"><input value={adding.email} onChange={(e) => setAdding({ ...adding, email: e.target.value })} placeholder="maya@ledgerline.io" className={input} /></Field>
            <Field label="Name"><input value={adding.name} onChange={(e) => setAdding({ ...adding, name: e.target.value })} className={input} /></Field>
            <Field label="Company" hint="Matched against the startup directory when it can be."><input value={adding.company} onChange={(e) => setAdding({ ...adding, company: e.target.value })} className={input} /></Field>
            <Field label="Who they are">
              <Select value={adding.kind} onChange={(v) => setAdding({ ...adding, kind: v })} className={input}>
                {CONTACT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
            </Field>
          </div>
          <div className="mt-2">
            <Field label="Notes" hint="The agent reads these when it writes to them: how you met, what you promised, what they care about.">
              <textarea value={adding.notes} onChange={(e) => setAdding({ ...adding, notes: e.target.value })} rows={3} className={input} />
            </Field>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={add} disabled={!!ctx.busy || !adding.email.trim()} className={btn.primary}>{ctx.busy === "add-contact" ? "Adding…" : "Add"}</button>
            <button type="button" onClick={() => setAdding(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      {shown.length === 0 && <Empty>{contacts.length === 0 ? "No contacts yet. Everyone who writes to you is added as the agent reads their email, or add someone by hand." : "Nobody matches that search."}</Empty>}

      <div className="flex flex-col gap-1.5">
        {shown.map((c) => (
          <article key={c.id} className={`ctl border border-line bg-elevated/30 p-3 ${c.optedOutAt ? "opacity-70" : ""}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="flex items-center gap-1.5 text-[12.5px] font-semibold">
                  {c.name || c.email}
                  {c.startupId ? <span title="Matched in YouBank's startup directory"><Icon name="Check" className="h-3.5 w-3.5 text-pos" /></span> : null}
                </h4>
                <p className="truncate text-[11px] text-muted">{[c.title, c.company, c.name ? c.email : ""].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10.5px]">
                <span className="ctl bg-elevated px-1.5 py-0.5 text-muted">{KIND_LABEL[c.kind as ContactKind] ?? c.kind}</span>
                <span className="text-muted">last email {ago(c.lastContactAt)} · <span className="num">{c.exchanges}</span> exchanged</span>
                {c.optedOutAt && <span className="ctl bg-neg/15 px-1.5 py-0.5 text-neg">Do not contact</span>}
              </div>
            </div>
            {c.signals.map((s) => (
              <p key={s.id} className="mt-1.5 flex items-start gap-1.5 text-[11px]">
                <Icon name="TrendingUp" className="mt-0.5 h-3 w-3 shrink-0 text-pos" />
                <span>{s.title}{s.strength === "name" ? <span className="text-muted"> (matched on company name)</span> : null}</span>
                {s.url && <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">filing</a>}
              </p>
            ))}
            {notes?.id === c.id ? (
              <div className="mt-2">
                <textarea value={notes.text} onChange={(e) => setNotes({ ...notes, text: e.target.value })} rows={3} className={`${input} w-full`} />
                <div className="mt-1.5 flex gap-2">
                  <button type="button" disabled={!!ctx.busy} onClick={() => { void patch(c.id, { notes: notes.text }, "Notes saved."); setNotes(null); }} className={btn.primary}>Save notes</button>
                  <button type="button" onClick={() => setNotes(null)} className={btn.link}>Cancel</button>
                </div>
              </div>
            ) : c.notes ? <p className="mt-1.5 whitespace-pre-wrap text-[11px] text-muted"><span className="font-semibold">Notes:</span> {c.notes}</p> : null}
            <div className="mt-2 flex flex-wrap gap-3">
              {notes?.id !== c.id && <button type="button" onClick={() => setNotes({ id: c.id, text: c.notes })} className={btn.link}>{c.notes ? "Edit notes" : "Add notes"}</button>}
              {c.optedOutAt
                ? <button type="button" disabled={!!ctx.busy} onClick={async () => { if (await confirmDialog({ title: `Allow outreach to ${c.name || c.email} again?`, body: "They asked not to be contacted. Only continue if they have told you otherwise.", confirmLabel: "Allow contact", tone: "danger" })) void patch(c.id, { optedOut: false }, "They can be contacted again."); }} className={btn.link}>Allow contact again</button>
                : <button type="button" disabled={!!ctx.busy} onClick={() => patch(c.id, { optedOut: true }, "Marked do not contact. Pending outreach to them was withdrawn.")} className={btn.danger}>Do not contact</button>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
