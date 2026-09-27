"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { CONTACT_KINDS, KIND_LABEL } from "@/lib/crm/model";
import { Empty, Field, ago, api, btn, input, type PanelCtx } from "./shared";

type Rule = {
  id: number; name: string; enabled: boolean; cadenceDays: number; anchor: string; kinds: string[];
  minExchanges: number; dailyCap: number; instructions: string; sendMode: string; lastRunAt: string | null;
};
type LogEntry = { id: number; ruleId: number; contact: string; outcome: string; reason: string; createdAt: string };
type Preview = { total: number; sample: { contactId: number; name: string; email: string; company: string; quiet: number; exchanges: number }[] };
type RunResult = { considered: number; drafted: number; skipped: number; scheduled?: number; errors: string[] };

const NEW_RULE: Omit<Rule, "id" | "lastRunAt"> = {
  name: "Reconnect with people gone quiet", enabled: true, cadenceDays: 180, anchor: "last_sent", kinds: [], minExchanges: 3, dailyCap: 5, sendMode: "default",
  instructions: "Only people we had a real conversation with. Skip anyone who passed on us or said they were not raising. Pick up where we left off and ask how the business is going.",
};

/** Rules that bring quiet relationships back, the people each would reach today, and why each was or was not written to. */
export function NurturePanel({ ctx, onDrafted }: { ctx: PanelCtx; onDrafted: () => void }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [editing, setEditing] = useState<(Omit<Rule, "id" | "lastRunAt"> & { id?: number }) | null>(null);
  const [preview, setPreview] = useState<{ ruleId: number; data: Preview } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<{ rules: Rule[]; log: LogEntry[] }>("/api/crm/nurture").then((r) => { if (!cancelled) { setRules(r.rules); setLog(r.log); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);

  const save = () => ctx.run("save-rule", async () => {
    if (!editing) return;
    const { id, ...body } = editing;
    await api(id ? `/api/crm/nurture/${id}` : "/api/crm/nurture", { method: id ? "PATCH" : "POST", body: JSON.stringify(body) });
    setEditing(null); ctx.say(id ? "Rule saved." : "Rule created. Preview it to see who it would reach."); ctx.refresh();
  });
  const toggle = (r: Rule) => ctx.run(`tog-${r.id}`, async () => {
    await api(`/api/crm/nurture/${r.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !r.enabled }) });
    ctx.refresh();
  });
  const remove = (r: Rule) => ctx.run(`del-${r.id}`, async () => {
    if (!window.confirm(`Delete "${r.name}"? Drafts it already wrote stay in the review queue.`)) return;
    await api(`/api/crm/nurture/${r.id}`, { method: "DELETE" });
    ctx.refresh();
  });
  const look = (r: Rule) => ctx.run(`prev-${r.id}`, async () => {
    setPreview({ ruleId: r.id, data: await api<Preview>(`/api/crm/nurture/${r.id}`, { method: "POST", body: JSON.stringify({ action: "preview" }) }) });
  });
  const runNow = (r: Rule) => ctx.run(`run-${r.id}`, async () => {
    const x = await api<RunResult>(`/api/crm/nurture/${r.id}`, { method: "POST", body: JSON.stringify({ action: "run" }) });
    ctx.say(x.considered === 0 ? "Nobody is due under this rule today." : `Looked at ${x.considered}: drafted ${x.drafted}${x.scheduled ? ` (${x.scheduled} on autopilot)` : ""}, left ${x.skipped} alone.${x.errors.length ? ` ${x.errors.length} failed.` : ""}`);
    setPreview(null); ctx.refresh();
    if (x.drafted) onDrafted();
  });

  const setKinds = (kind: string, on: boolean) => editing && setEditing({ ...editing, kinds: on ? [...editing.kinds, kind] : editing.kinds.filter((k) => k !== kind) });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[78ch] text-[11.5px] text-muted">
          A rule finds people you have gone quiet with and has the agent decide, one by one, whether there is an honest reason to write. When there is, it drafts a note that picks up your actual history with them, leading with any news from their SEC filings. When there is not, it says why and leaves them alone. Drafts go to the review queue.
        </p>
        <button type="button" onClick={() => setEditing(editing ? null : NEW_RULE)} className={btn.ghost}><Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />New rule</button>
      </div>

      {editing && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name"><input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className={input} /></Field>
            <Field label="Quiet for at least (days)"><input type="number" min={14} value={editing.cadenceDays} onChange={(e) => setEditing({ ...editing, cadenceDays: Number(e.target.value) })} className={input} /></Field>
            <Field label="Counting from">
              <select value={editing.anchor} onChange={(e) => setEditing({ ...editing, anchor: e.target.value })} className={input}>
                <option value="last_sent">Your last email to them</option>
                <option value="last_contact">The last email either way</option>
              </select>
            </Field>
            <Field label="Drafts per day, at most"><input type="number" min={1} max={25} value={editing.dailyCap} onChange={(e) => setEditing({ ...editing, dailyCap: Number(e.target.value) })} className={input} /></Field>
            <Field label="At least this many emails exchanged" hint="Filters out one-off contacts."><input type="number" min={1} value={editing.minExchanges} onChange={(e) => setEditing({ ...editing, minExchanges: Number(e.target.value) })} className={input} /></Field>
            <Field label="Sending">
              <select value={editing.sendMode} onChange={(e) => setEditing({ ...editing, sendMode: e.target.value })} className={input}>
                <option value="default">Use my autopilot setting</option>
                <option value="approve">Ask me before each note</option>
                <option value="auto">Autopilot when confident</option>
              </select>
            </Field>
            <div className="sm:col-span-1 lg:col-span-3">
              <span className="text-[11px] font-semibold">Applies to</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {CONTACT_KINDS.filter((k) => k !== "unknown").map((k) => (
                  <label key={k} className="flex items-center gap-1 text-[11.5px]">
                    <input type="checkbox" checked={editing.kinds.includes(k)} onChange={(e) => setKinds(k, e.target.checked)} /> {KIND_LABEL[k]}
                  </label>
                ))}
                <span className="text-[10.5px] text-muted">None ticked means everyone.</span>
              </div>
            </div>
          </div>
          <div className="mt-2.5">
            <Field label="Instructions" hint="Plain language. Say who to include or skip, what tone to take, and what the note should aim for.">
              <textarea value={editing.instructions} onChange={(e) => setEditing({ ...editing, instructions: e.target.value })} rows={3} className={input} />
            </Field>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={save} disabled={!!ctx.busy} className={btn.primary}>{ctx.busy === "save-rule" ? "Saving…" : "Save rule"}</button>
            <button type="button" onClick={() => setEditing(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      {rules.length === 0 && !editing && <Empty>No rules yet. A good first one: founders you had three or more emails with and have not written to in six months.</Empty>}

      {rules.map((r) => (
        <article key={r.id} className="ctl border border-line bg-elevated/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="text-[12.5px] font-semibold">{r.name} {!r.enabled && <span className="text-[10.5px] font-normal text-muted">(paused)</span>}</h4>
              <p className="text-[11px] text-muted">
                {r.sendMode === "auto" ? "Autopilot · " : r.sendMode === "approve" ? "Asks you first · " : ""}{r.kinds.length ? r.kinds.map((k) => KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k).join(", ") : "Everyone"} · quiet {r.cadenceDays}+ days since {r.anchor === "last_sent" ? "your last email" : "the last email"} · {r.minExchanges}+ emails exchanged · up to {r.dailyCap}/day · last ran {ago(r.lastRunAt)}
              </p>
              {r.instructions && <p className="mt-1 text-[11px]"><span className="text-muted">Instructions:</span> {r.instructions}</p>}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" disabled={!!ctx.busy} onClick={() => look(r)} className={btn.ghost}>{ctx.busy === `prev-${r.id}` ? "Looking…" : "Who is due?"}</button>
            <button type="button" disabled={!!ctx.busy || !r.enabled} onClick={() => runNow(r)} className={btn.primary}>{ctx.busy === `run-${r.id}` ? "Deciding and drafting…" : "Run now"}</button>
            <button type="button" disabled={!!ctx.busy} onClick={() => setEditing({ ...r })} className={btn.link}>Edit</button>
            <button type="button" disabled={!!ctx.busy} onClick={() => toggle(r)} className={btn.link}>{r.enabled ? "Pause" : "Resume"}</button>
            <button type="button" disabled={!!ctx.busy} onClick={() => remove(r)} className={btn.danger}>Delete</button>
          </div>
          {preview?.ruleId === r.id && (
            <div className="mt-2.5 ctl border border-line bg-bg/60 p-2.5">
              <p className="text-[11px] text-muted">
                <span className="num text-fg">{preview.data.total}</span> {preview.data.total === 1 ? "person is" : "people are"} due. A run looks at up to {r.dailyCap} of them today, most engaged first. Nothing has been written yet.
              </p>
              {preview.data.sample.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5 text-[11px]">
                  {preview.data.sample.slice(0, 12).map((c) => (
                    <li key={c.contactId}>{c.name || c.email}{c.company ? `, ${c.company}` : ""} <span className="text-muted">· quiet {c.quiet} days · {c.exchanges} emails</span></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </article>
      ))}

      {log.length > 0 && (
        <section>
          <h3 className="text-[12.5px] font-semibold">Recent decisions</h3>
          <p className="text-[11px] text-muted">Every person a rule looked at, and the agent&apos;s reason. Someone it skipped is not asked about again until the rule&apos;s cadence has passed.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {log.slice(0, 25).map((l) => (
              <li key={l.id} className="flex items-start gap-2 text-[11.5px]">
                <span className={`ctl mt-0.5 shrink-0 px-1.5 py-0.5 text-[10px] ${l.outcome === "drafted" ? "bg-pos/15 text-pos" : "bg-elevated text-muted"}`}>{l.outcome === "drafted" ? "Drafted" : "Skipped"}</span>
                <span><span className="font-semibold">{l.contact || "Someone"}</span> <span className="text-muted">— {l.reason} · {ago(l.createdAt)}</span></span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
