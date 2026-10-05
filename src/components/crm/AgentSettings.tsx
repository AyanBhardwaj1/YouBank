"use client";

import { useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  AUTONOMY_LABEL, AUTONOMY_LEVELS, AUTONOMY_SCOPES, SCOPE_HINT, SCOPE_LABEL,
  type AutopilotSettings, type AutonomyScope,
} from "@/lib/crm/autopilot-rules";
import { MODE_LABEL, MODES, type Mode } from "@/lib/crm/model";
import { EngineInsights } from "./EngineInsights";
import { Field, ago, api, btn, input, type PanelCtx } from "./shared";
import { Select } from "@/components/ui/Select";

type Settings = {
  mode: Mode; modeChosen: boolean; about: string; signature: string; internalDomains: string[]; effectiveInternalDomains: string[];
  instructions: string; knowledge: string; voice: string; followUpDays: number; staleDealDays: number; nightly: boolean;
  lastRunAt: string | null; autopilot: AutopilotSettings;
};
type Entry = { id: number; question: string; answer: string; source: string; updatedAt: string };

const zones = (): string[] => {
  try { return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone"); } catch { return ["UTC"]; }
};

function Section({ title, icon, children, hint }: { title: string; icon: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="ctl border border-line bg-elevated/30 p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon name={icon} className="h-4 w-4 text-accent" />{title}</h3>
      {hint && <p className="mt-0.5 max-w-[90ch] text-[11px] text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** How the agent works for you: what it is for, what it may do on its own, what it knows, and how you write. */
export function AgentSettings({ ctx }: { ctx: PanelCtx }) {
  const [s, setS] = useState<Settings | null>(null);
  const [domains, setDomains] = useState("");
  const [playbook, setPlaybook] = useState<Entry[]>([]);
  const [entry, setEntry] = useState<{ id?: number; question: string; answer: string } | null>(null);
  const tzList = useMemo(() => zones(), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Settings>("/api/crm/settings"), api<Entry[]>("/api/crm/playbook")]).then(([x, p]) => {
      if (cancelled) return;
      // Sending hours default to UTC until set; start from the browser's own zone instead.
      const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (x.autopilot.window.tz === "UTC" && local && local !== "UTC") x = { ...x, autopilot: { ...x.autopilot, window: { ...x.autopilot.window, tz: local } } };
      setS(x); setDomains(x.internalDomains.join(", ")); setPlaybook(p);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);

  if (!s) return <p className="text-[12px] text-muted">Loading…</p>;
  const ap = s.autopilot;
  const setAp = (patch: Partial<AutopilotSettings>) => setS({ ...s, autopilot: { ...ap, ...patch } });

  const save = () => ctx.run("save-settings", async () => {
    const next = await api<Settings>("/api/crm/settings", { method: "PUT", body: JSON.stringify({ ...s, internalDomains: domains }) });
    setS({ ...s, ...next }); setDomains(next.internalDomains.join(", "));
    ctx.say(ap.enabled ? "Saved. Autopilot follows these settings from its next pass, within a few minutes." : "Saved.");
    ctx.refresh();
  });
  const learn = () => ctx.run("learn-voice", async () => {
    const r = await api<{ voice: string; samples: number }>("/api/crm/settings/voice", { method: "POST" });
    setS({ ...s, voice: r.voice });
    ctx.say(`Learned from ${r.samples} emails you sent. Edit it if it is off, then Save.`);
  });
  const addFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 400_000) { ctx.say("That file is too large; paste the relevant part instead."); return; }
    const text = await file.text();
    setS({ ...s, knowledge: `${s.knowledge.trim()}\n\n--- ${file.name} ---\n${text.trim()}`.trim().slice(0, 20_000) });
    ctx.say(`Added ${file.name}. Save to keep it.`);
  };
  const saveEntry = () => ctx.run("save-entry", async () => {
    if (!entry) return;
    await api(entry.id ? `/api/crm/playbook/${entry.id}` : "/api/crm/playbook", { method: entry.id ? "PATCH" : "POST", body: JSON.stringify(entry) });
    setEntry(null); ctx.say("Playbook updated. The agent uses it from its next draft."); ctx.refresh();
  });
  const removeEntry = (id: number) => ctx.run(`del-${id}`, async () => { await api(`/api/crm/playbook/${id}`, { method: "DELETE" }); ctx.refresh(); });

  return (
    <div className="flex flex-col gap-4">
      <EngineInsights ctx={ctx} />
      <Section title="What you use this for" icon="Compass" hint="This sets the pipeline and how the agent reads and writes. A founder's prospect reply and an investor's pitch email need very different answers.">
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m) => (
            <label key={m} className={`ctl flex cursor-pointer items-start gap-2 border p-2.5 text-[12px] ${s.mode === m ? "border-accent/60 bg-accent-soft/40" : "border-line"}`}>
              <input type="radio" name="mode" checked={s.mode === m} onChange={() => setS({ ...s, mode: m })} className="mt-0.5" />
              <span>{MODE_LABEL[m]}<span className="block text-[10.5px] text-muted">{m === "sales" ? "Pipeline: lead → contacted → engaged → meeting → proposal → won" : "Pipeline: inbox → screening → diligence → partner review → term sheet → portfolio"}</span></span>
            </label>
          ))}
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="About you" hint="Who you are, what you sell or do, and for whom. Every email is written as this person.">
            <textarea value={s.about} onChange={(e) => setS({ ...s, about: e.target.value })} rows={4} className={input}
              placeholder={"Ayan, founder of Ledgerline. We automate month-end reconciliation for mid-market finance teams (50–500 employees). Pilots are free for 30 days; paid plans start at $1,500/month."} />
          </Field>
          <Field label="Signature" hint="Added to every email sent from YouBank. Mail sent through Gmail's API or SMTP gets no signature otherwise.">
            <textarea value={s.signature} onChange={(e) => setS({ ...s, signature: e.target.value })} rows={4} className={input} placeholder={"Ayan Bhardwaj\nFounder, Ledgerline\nledgerline.io"} />
          </Field>
        </div>
      </Section>

      <Section title="Autopilot" icon="Bot" hint="Decide what the agent may send on its own. Even on autopilot, anything it is not confident about, anything sensitive, and anything that needs your input comes to you instead, with the reason.">
        <label className={`mb-2 ctl flex items-start gap-3 border p-3 ${ap.regulated ? "border-info/60 bg-info/5" : "border-line"}`}>
          <input type="checkbox" checked={ap.regulated} onChange={(e) => setAp({ regulated: e.target.checked, enabled: e.target.checked ? false : ap.enabled })} className="mt-1" />
          <span className="text-[12.5px]">
            <span className="font-semibold">Regulated mode</span>
            <span className="block text-[11px] text-muted">
              For FINRA and SEC registrants. Autopilot cannot be switched on and every email is sent by a person, from your own mailbox, so your firm&apos;s archive captures it.{" "}
              <a href="/api/crm/audit" className="text-accent hover:underline">Download the audit log (CSV)</a> of every email the agent drafted, who sent it and how much it was edited.
            </span>
          </span>
        </label>
        <label className={`ctl flex items-start gap-3 border p-3 ${ap.enabled ? "border-accent/60 bg-accent-soft/40" : "border-line"} ${ap.regulated ? "opacity-50" : ""}`}>
          <input type="checkbox" checked={ap.enabled} disabled={ap.regulated} onChange={(e) => setAp({ enabled: e.target.checked })} className="mt-1" />
          <span className="text-[12.5px]">
            <span className="font-semibold">{ap.enabled ? "Autopilot is on" : "Autopilot is off"}</span>
            <span className="block text-[11px] text-muted">
              {ap.enabled
                ? "Emails set to Autopilot below are sent from your mailbox automatically, after the hold time and inside your sending hours. Switching this off stops everything at once."
                : "Nothing is sent without you pressing Send, whatever the rows below say. The agent still reads, drafts and asks."}
            </span>
          </span>
        </label>

        <div className="table-scroll mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] font-sans text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] text-muted">
                <th className="pb-1.5 font-normal">Kind of email</th>
                {AUTONOMY_LEVELS.map((l) => <th key={l} className="pb-1.5 text-center font-normal">{AUTONOMY_LABEL[l]}</th>)}
              </tr>
            </thead>
            <tbody>
              {AUTONOMY_SCOPES.map((scope: AutonomyScope) => (
                <tr key={scope} className="border-t border-line">
                  <td className="py-2 pr-3">
                    {SCOPE_LABEL[scope]}
                    <span className="block text-[10.5px] text-muted">{SCOPE_HINT[scope][ap.autonomy[scope]]}</span>
                  </td>
                  {AUTONOMY_LEVELS.map((l) => (
                    <td key={l} className="py-2 text-center">
                      <input type="radio" name={`a-${scope}`} aria-label={`${SCOPE_LABEL[scope]}: ${AUTONOMY_LABEL[l]}`} checked={ap.autonomy[scope] === l}
                        onChange={() => setAp({ autonomy: { ...ap.autonomy, [scope]: l } })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Hold before sending (minutes)" hint="Time to stop an automatic email.">
            <input type="number" min={0} max={240} value={ap.holdMinutes} onChange={(e) => setAp({ holdMinutes: Number(e.target.value) })} className={input} />
          </Field>
          <Field label="Automatic sends per day, at most" hint="Across everything. Gmail allows about 500.">
            <input type="number" min={1} max={400} value={ap.dailyCap} onChange={(e) => setAp({ dailyCap: Number(e.target.value) })} className={input} />
          </Field>
          <Field label="Sending hours" hint="Local time, in the zone below.">
            <span className="flex items-center gap-1">
              <input type="number" min={0} max={23} value={ap.window.start} onChange={(e) => setAp({ window: { ...ap.window, start: Number(e.target.value) } })} className={`${input} w-[64px]`} />
              <span className="text-muted">to</span>
              <input type="number" min={1} max={24} value={ap.window.end} onChange={(e) => setAp({ window: { ...ap.window, end: Number(e.target.value) } })} className={`${input} w-[64px]`} />
            </span>
          </Field>
          <Field label="Time zone">
            <Select value={ap.window.tz} onChange={(v) => setAp({ window: { ...ap.window, tz: v } })} className={input}>
              {(tzList.includes(ap.window.tz) ? tzList : [ap.window.tz, ...tzList]).map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          </Field>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-4 text-[12px]">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={ap.window.weekdays} onChange={(e) => setAp({ window: { ...ap.window, weekdays: e.target.checked } })} /> Weekdays only</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={ap.autoSync} onChange={(e) => setAp({ autoSync: e.target.checked })} /> Read my mailbox every few minutes</label>
        </div>
        <div className="mt-3">
          <Field label="Your company's email domains" hint={`People at these domains count as coworkers. ${s.internalDomains.length ? "" : s.effectiveInternalDomains.length ? `Right now: ${s.effectiveInternalDomains.join(", ")} (from your mailbox).` : "None yet: connect a company mailbox or add a domain."}`}>
            <input value={domains} onChange={(e) => setDomains(e.target.value)} placeholder="ledgerline.io, ledgerline.com" className={input} />
          </Field>
        </div>
      </Section>

      <Section title="What the agent knows" icon="BookOpen" hint="Everything here goes into every draft. The more specific it is, the fewer questions the agent needs to ask you.">
        <div className="grid gap-3 lg:grid-cols-2">
          <Field label="Standing instructions" hint="Rules for every triage and draft. Because you wrote them, they can authorise what the agent would otherwise ask about, such as offering meeting times.">
            <textarea value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })} rows={7} className={input}
              placeholder={"Offer Tuesday or Thursday afternoons (Pacific) for calls, or my link cal.com/ayan/20min.\nNever discuss discounts; say I'll follow up personally.\nIf someone asks for a reference customer, ask me first."} />
          </Field>
          <Field label="Knowledge: your company, product, pricing, FAQs" hint="Paste, or add a text or Markdown file.">
            <textarea value={s.knowledge} onChange={(e) => setS({ ...s, knowledge: e.target.value })} rows={7} className={input}
              placeholder={"Ledgerline connects to NetSuite and QuickBooks. SOC 2 Type II. Typical setup: two weeks.\nPricing: Starter $1,500/mo up to 5 entities; Growth $4,000/mo…"} />
            <label className={`${btn.link} mt-1 cursor-pointer self-start`}>
              + Add a file (.txt, .md, .csv)
              <input type="file" accept=".txt,.md,.csv,text/plain,text/markdown,text/csv" className="hidden" onChange={(e) => { void addFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </Field>
        </div>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <Field label="Your writing voice" hint="A description, not examples. Learning reads only emails you sent, and keeps no details about the people you wrote to.">
            <textarea value={s.voice} onChange={(e) => setS({ ...s, voice: e.target.value })} rows={4} className={input} placeholder={"Short: three to five sentences.\nFirst name greeting, no pleasantries.\nSigns off with just a first name."} />
          </Field>
          <div className="flex flex-col gap-2.5">
            <button type="button" onClick={learn} disabled={!!ctx.busy} className={`${btn.ghost} self-start`}>{ctx.busy === "learn-voice" ? "Reading your sent mail…" : "Learn my voice from sent mail"}</button>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="Suggest a follow-up after (days)"><input type="number" min={1} max={60} value={s.followUpDays} onChange={(e) => setS({ ...s, followUpDays: Number(e.target.value) })} className={input} /></Field>
              <Field label="Flag a quiet deal after (days)"><input type="number" min={3} max={180} value={s.staleDealDays} onChange={(e) => setS({ ...s, staleDealDays: Number(e.target.value) })} className={input} /></Field>
            </div>
            <label className="flex items-start gap-2 text-[12px]">
              <input type="checkbox" checked={s.nightly} onChange={(e) => setS({ ...s, nightly: e.target.checked })} className="mt-0.5" />
              <span>Morning run<span className="block text-[10.5px] text-muted">Funding signals, quiet deals and nurture, ready when you log in. Last ran {ago(s.lastRunAt)}.</span></span>
            </label>
          </div>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <button type="button" onClick={save} disabled={!!ctx.busy} className={btn.primary}>{ctx.busy === "save-settings" ? "Saving…" : "Save settings"}</button>
        {ap.enabled && <span className="text-[11px] text-accent">Autopilot will be on after you save.</span>}
      </div>

      <Section title="Playbook" icon="ListChecks" hint="Answers the agent reuses. When it asks you something and you tick “remember”, the answer lands here. Add the questions people ask you most, and the agent stops needing to ask.">
        <div className="flex flex-col gap-1.5">
          {playbook.length === 0 && !entry && <p className="text-[11.5px] text-muted">Empty so far. Good first entries: pricing, what a pilot involves, security/compliance, your availability, what you do not do.</p>}
          {playbook.map((p) => (
            <article key={p.id} className="ctl border border-line bg-bg/50 p-2.5">
              <p className="text-[12px] font-semibold">{p.question}</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[11.5px] text-muted">{p.answer}</p>
              <div className="mt-1 flex gap-3">
                <span className="text-[10px] text-muted">{p.source === "answered" ? "From your answer" : "Added by you"} · {ago(p.updatedAt)}</span>
                <button type="button" onClick={() => setEntry({ id: p.id, question: p.question, answer: p.answer })} className={btn.link}>Edit</button>
                <button type="button" onClick={() => removeEntry(p.id)} disabled={!!ctx.busy} className={btn.danger}>Delete</button>
              </div>
            </article>
          ))}
          {entry ? (
            <div className="ctl border border-line bg-elevated/40 p-3">
              <Field label="When someone asks"><input value={entry.question} onChange={(e) => setEntry({ ...entry, question: e.target.value })} placeholder="How much does it cost for 10 entities?" className={input} /></Field>
              <div className="mt-2">
                <Field label="Answer with"><textarea value={entry.answer} onChange={(e) => setEntry({ ...entry, answer: e.target.value })} rows={3} className={input} placeholder="Growth plan, $4,000 a month, billed annually; month-to-month is $4,800." /></Field>
              </div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={saveEntry} disabled={!!ctx.busy || !entry.question.trim() || !entry.answer.trim()} className={btn.primary}>Save</button>
                <button type="button" onClick={() => setEntry(null)} className={btn.link}>Cancel</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setEntry({ question: "", answer: "" })} className={`${btn.ghost} self-start`}><Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />Add an answer</button>
          )}
        </div>
      </Section>
    </div>
  );
}
