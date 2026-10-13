"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PremiumBadge } from "@/components/billing/Premium";
import { DEFAULT_STEPS, LEAD_STATUS_LABEL, type CampaignStep, type LeadStatus } from "@/lib/crm/model";
import { Empty, Field, api, btn, input, type PanelCtx } from "./shared";
import { Select } from "@/components/ui/Select";
import { confirmDialog } from "@/components/ui/Dialog";

type Stats = {
  leads: number; byStatus: Record<string, number>; contacted: number; replied: number; replyRate: number | null;
  emailsSent: number; pendingDrafts: number; dealsOpened: number; repliesByStep: number[]; needsEmail: number;
};
type Campaign = {
  id: number; name: string; status: string; goal: string; icp: string; instructions: string; steps: CampaignStep[]; dailyCap: number; sendMode: string; consentRegions: boolean; stats: Stats;
};
type Lead = {
  id: number; email: string; name: string; company: string; notes: string; status: string; fit: number | null; fitReason: string;
  step: number; nextDueAt: string | null; lastSentAt: string | null; repliedAt: string | null; startupId: number | null;
};
type Startup = { id: number; name: string; oneLiner: string; founders: string; program: string; location: string; website: string };

const STATUS_TONE: Record<string, string> = {
  qualified: "bg-pos/15 text-pos", active: "bg-accent-soft text-accent", replied: "bg-pos/25 text-pos",
  review: "bg-info/15 text-info", disqualified: "bg-elevated text-muted", opted_out: "bg-neg/15 text-neg",
};

const NEW_CAMPAIGN = {
  name: "", goal: "", icp: "", instructions: "", steps: DEFAULT_STEPS, dailyCap: 10, sendMode: "default", consentRegions: false,
};

const SEND_MODE_LABEL: Record<string, string> = {
  default: "Use my autopilot setting for campaigns", approve: "Ask me before each email", auto: "Autopilot: send confident emails on schedule",
};

const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

/** Outbound sequences: source a list, qualify it against a profile, and work through personalised steps, every one reviewed. */
export function CampaignsPanel({ ctx, onDrafted }: { ctx: PanelCtx; onDrafted: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState<typeof NEW_CAMPAIGN | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Campaign[]>("/api/crm/campaigns").then((c) => { if (!cancelled) setCampaigns(c); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);

  const create = () => ctx.run("create-campaign", async () => {
    if (!creating) return;
    const c = await api<Campaign>("/api/crm/campaigns", { method: "POST", body: JSON.stringify(creating) });
    setCreating(null); setOpen(c.id); ctx.say("Campaign created. Add leads next."); ctx.refresh();
  });

  if (open != null) return <CampaignDetail id={open} ctx={ctx} onBack={() => setOpen(null)} onDrafted={onDrafted} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[78ch] text-[11.5px] text-muted">
          Build a list from YouBank&apos;s startup directory or paste your own, have the agent qualify it against your ideal profile, then work through a short sequence. Each email is written for that lead from what YouBank knows about their company, and waits for you to review and send. A reply or an opt-out stops the sequence for that person.
        </p>
        <span className="flex items-center gap-1.5"><button type="button" onClick={() => setCreating(creating ? null : NEW_CAMPAIGN)} className={btn.ghost}><Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />New campaign</button><PremiumBadge feature="relationships.campaigns" /></span>
      </div>

      {creating && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <CampaignForm value={creating} onChange={setCreating} />
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={create} disabled={!!ctx.busy || !creating.name.trim()} className={btn.primary}>{ctx.busy === "create-campaign" ? "Creating…" : "Create"}</button>
            <button type="button" onClick={() => setCreating(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      {campaigns.length === 0 && !creating && <Empty>No campaigns yet.</Empty>}

      <div className="grid gap-2 md:grid-cols-2">
        {campaigns.map((c) => (
          <button key={c.id} type="button" onClick={() => setOpen(c.id)} className="ctl border border-line bg-elevated/30 p-3 text-left transition hover:border-accent/50">
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="truncate text-[12.5px] font-semibold">{c.name}</h4>
              <span className={`ctl px-1.5 py-0.5 text-[10px] ${c.status === "active" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{c.status}</span>
            </div>
            {c.goal && <p className="mt-0.5 truncate text-[11px] text-muted">{c.goal}</p>}
            <p className="num mt-1.5 text-[11px] text-muted">
              {c.stats.leads} leads · {(c.stats.byStatus.qualified ?? 0) + c.stats.contacted} qualified · {c.stats.contacted} contacted · {c.stats.replied} replied ({pct(c.stats.replyRate)}) · {c.stats.dealsOpened} {c.stats.dealsOpened === 1 ? "deal" : "deals"} opened
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function CampaignForm({ value, onChange }: { value: typeof NEW_CAMPAIGN; onChange: (v: typeof NEW_CAMPAIGN) => void }) {
  const setStep = (i: number, patch: Partial<CampaignStep>) => onChange({ ...value, steps: value.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid gap-2.5 sm:grid-cols-[2fr_1fr]">
        <Field label="Name"><input value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} placeholder="Seed fintech founders, Q4" className={input} /></Field>
        <Field label="Drafts per day, at most"><input type="number" min={1} max={50} value={value.dailyCap} onChange={(e) => onChange({ ...value, dailyCap: Number(e.target.value) })} className={input} /></Field>
      </div>
      <Field label="Sending" hint="Autopilot still holds anything it is unsure about, and only sends inside your sending hours and daily limit.">
        <Select value={value.sendMode} onChange={(v) => onChange({ ...value, sendMode: v })} className={input}>
          {Object.entries(SEND_MODE_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <label className="flex items-start gap-2 text-[11.5px]">
        <input type="checkbox" checked={value.consentRegions} onChange={(e) => onChange({ ...value, consentRegions: e.target.checked })} className="mt-0.5" />
        <span>I have consent or another lawful basis to email recipients in the EU and Canada
          <span className="block text-[10.5px] text-muted">Otherwise leads at those countries&apos; domains are skipped: cold email there usually needs prior consent (GDPR and national ePrivacy rules, CASL). Every first email already offers an easy way to say no, and opt-outs are honoured at once.</span>
        </span>
      </label>
      <Field label="Goal" hint="What a good outcome is. The agent writes every email toward it.">
        <input value={value.goal} onChange={(e) => onChange({ ...value, goal: e.target.value })} placeholder="A first call with founders raising a seed round in B2B fintech" className={input} />
      </Field>
      <Field label="Ideal profile" hint="Who qualifies and who does not. Leads are scored against this, on the evidence in their record.">
        <textarea value={value.icp} onChange={(e) => onChange({ ...value, icp: e.target.value })} rows={3} placeholder="US-based B2B fintech or infrastructure, pre-seed to seed, technical founders, fewer than 20 people. Not consumer lending, not crypto." className={input} />
      </Field>
      <Field label="Instructions" hint="Tone, what to mention, what never to say.">
        <textarea value={value.instructions} onChange={(e) => onChange({ ...value, instructions: e.target.value })} rows={2} className={input} />
      </Field>
      <div>
        <span className="text-[11px] font-semibold">Sequence</span>
        <div className="mt-1 flex flex-col gap-1.5">
          {value.steps.map((s, i) => (
            <div key={i} className="grid items-start gap-1.5 sm:grid-cols-[90px_1fr_auto]">
              <label className="flex items-center gap-1 text-[11px] text-muted">
                Day <input type="number" min={0} disabled={i === 0} value={s.dayOffset} onChange={(e) => setStep(i, { dayOffset: Number(e.target.value) })} className={`${input} w-[56px] py-1`} />
              </label>
              <textarea value={s.instruction} onChange={(e) => setStep(i, { instruction: e.target.value })} rows={2} className={input} />
              <button type="button" disabled={value.steps.length <= 1} onClick={() => onChange({ ...value, steps: value.steps.filter((_, j) => j !== i) })} className={btn.danger}>Remove</button>
            </div>
          ))}
          {value.steps.length < 6 && (
            <button type="button" onClick={() => onChange({ ...value, steps: [...value.steps, { dayOffset: (value.steps[value.steps.length - 1]?.dayOffset ?? 0) + 5, instruction: "" }] })} className={`${btn.link} self-start`}>
              + Add a step
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CampaignDetail({ id, ctx, onBack, onDrafted }: { id: number; ctx: PanelCtx; onBack: () => void; onDrafted: () => void }) {
  const [data, setData] = useState<{ campaign: Campaign; leads: Lead[]; stats: Stats } | null>(null);
  const [editing, setEditing] = useState<typeof NEW_CAMPAIGN | null>(null);
  const [source, setSource] = useState<"directory" | "paste" | null>(null);
  const [paste, setPaste] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Startup[]>([]);
  const [picked, setPicked] = useState<Record<number, string>>({});
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    api<{ campaign: Campaign; leads: Lead[]; stats: Stats }>(`/api/crm/campaigns/${id}`).then((d) => { if (!cancelled) setData(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [id, ctx.tick]);

  if (!data) return <p className="text-[12px] text-muted">Loading…</p>;
  const { campaign: c, leads, stats } = data;

  const act = (label: string, body: Record<string, unknown>, done: (r: Record<string, unknown>) => string) => ctx.run(label, async () => {
    const r = await api<Record<string, unknown>>(`/api/crm/campaigns/${id}`, { method: "POST", body: JSON.stringify(body) });
    ctx.say(done(r)); ctx.refresh();
  });
  const patch = (body: Record<string, unknown>, message: string) => ctx.run("patch-campaign", async () => {
    await api(`/api/crm/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setEditing(null); ctx.say(message); ctx.refresh();
  });
  const patchLead = (leadId: number, body: Record<string, unknown>, message: string) => ctx.run(`lead-${leadId}`, async () => {
    await api(`/api/crm/leads/${leadId}`, { method: "PATCH", body: JSON.stringify(body) });
    ctx.say(message); ctx.refresh();
  });
  const removeLead = (leadId: number) => ctx.run(`lead-${leadId}`, async () => {
    await api(`/api/crm/leads/${leadId}`, { method: "DELETE" });
    ctx.refresh();
  });
  const search = () => ctx.run("dir-search", async () => {
    const r = await api<{ rows: Startup[] }>(`/api/vc/startups?q=${encodeURIComponent(q)}&pageSize=25`);
    setResults(r.rows);
  });
  const addPicked = () => act("add-leads", {
    action: "add_leads",
    leads: Object.entries(picked).map(([sid, email]) => {
      const s = results.find((r) => r.id === Number(sid));
      return { startupId: Number(sid), email, name: s?.founders.split(",")[0]?.trim() ?? "" };
    }),
  }, (r) => { setPicked({}); setSource(null); return `Added ${r.added}${r.skipped ? `, skipped ${r.skipped} already in the list` : ""}.`; });
  const addPasted = () => act("add-leads", { action: "add_leads", text: paste },
    (r) => { setPaste(""); setSource(null); return `Added ${r.added}${r.skipped ? `, skipped ${r.skipped} (duplicates or invalid addresses)` : ""}.`; });
  const prepare = () => act("prepare", { action: "prepare" }, (r) => {
    if (Number(r.drafted)) onDrafted();
    const errors = (r.errors as string[]) ?? [];
    return errors.length && !Number(r.drafted) ? errors[0] : `Drafted ${r.drafted} for review.${Number(r.waitingForEmail) ? ` ${r.waitingForEmail} due but missing an address.` : ""}${r.capped ? " Hit today's cap; the rest are drafted tomorrow." : ""}`;
  });

  const funnel = [
    { label: "Leads", n: stats.leads },
    { label: "Qualified", n: (stats.byStatus.qualified ?? 0) + stats.contacted },
    { label: "Contacted", n: stats.contacted },
    { label: "Replied", n: stats.replied },
    { label: "Deals opened", n: stats.dealsOpened },
  ];
  const top = Math.max(...funnel.map((f) => f.n), 1);
  const shown = filter === "all" ? leads : leads.filter((l) => l.status === filter);
  const statuses = [...new Set(leads.map((l) => l.status))];

  return (
    <div className="flex flex-col gap-4">
      <button type="button" onClick={onBack} className={`${btn.link} self-start`}>← All campaigns</button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold">{c.name} <span className="ml-1 text-[11px] font-normal text-muted">{c.status}{c.sendMode === "auto" ? " · autopilot" : c.sendMode === "approve" ? " · asks you first" : ""}</span></h3>
          {c.goal && <p className="text-[11.5px] text-muted">{c.goal}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.status !== "active"
            ? <button type="button" disabled={!!ctx.busy} onClick={() => patch({ status: "active" }, "Live. Due steps are drafted by the nightly run, or now with Draft due steps.")} className={btn.accent}>{c.status === "paused" ? "Resume" : "Launch"}</button>
            : <button type="button" disabled={!!ctx.busy} onClick={() => patch({ status: "paused" }, "Paused. Nothing more is drafted until you resume.")} className={btn.ghost}>Pause</button>}
          <button type="button" disabled={!!ctx.busy || c.status !== "active"} onClick={prepare} className={btn.primary}>{ctx.busy === "prepare" ? "Writing…" : "Draft due steps"}</button>
          <button type="button" disabled={!!ctx.busy} onClick={() => setEditing(editing ? null : { name: c.name, goal: c.goal, icp: c.icp, instructions: c.instructions, steps: c.steps, dailyCap: c.dailyCap, sendMode: c.sendMode, consentRegions: c.consentRegions })} className={btn.link}>Edit</button>
          <button type="button" disabled={!!ctx.busy} onClick={async () => {
            if (!(await confirmDialog({ title: `Delete "${c.name}"?`, body: "Its unsent drafts are withdrawn. Emails already sent stay in your inbox.", confirmLabel: "Delete campaign", tone: "danger" }))) return;
            await ctx.run("del-campaign", async () => { await api(`/api/crm/campaigns/${id}`, { method: "DELETE" }); onBack(); ctx.refresh(); });
          }} className={btn.danger}>Delete</button>
        </div>
      </div>

      {editing && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <CampaignForm value={editing} onChange={setEditing} />
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={() => patch(editing, "Saved.")} disabled={!!ctx.busy} className={btn.primary}>Save</button>
            <button type="button" onClick={() => setEditing(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <section className="ctl border border-line bg-elevated/30 p-3">
          <h4 className="text-[12px] font-semibold">Funnel</h4>
          <div className="mt-2 flex flex-col gap-1.5">
            {funnel.map((f, i) => (
              <div key={f.label} className="grid grid-cols-[92px_1fr_40px] items-center gap-2 text-[11px]">
                <span className="text-muted">{f.label}</span>
                <span className="h-3 overflow-hidden rounded-sm bg-elevated">
                  <span className="block h-full rounded-r-[4px]" style={{ width: `${(f.n / top) * 100}%`, background: i === 3 ? "var(--chart-emphasis, var(--accent))" : "var(--chart-1, var(--accent))" }} />
                </span>
                <span className="num text-right">{f.n}</span>
              </div>
            ))}
          </div>
          <p className="num mt-2 text-[11px] text-muted">
            Reply rate {pct(stats.replyRate)} · {stats.emailsSent} emails sent · {stats.pendingDrafts} waiting in review
          </p>
        </section>
        <section className="ctl border border-line bg-elevated/30 p-3">
          <h4 className="text-[12px] font-semibold">Replies by step</h4>
          <ul className="mt-2 flex flex-col gap-1 text-[11px]">
            {c.steps.map((s, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="truncate text-muted">Step {i + 1}, day {s.dayOffset}</span>
                <span className="num">{stats.repliesByStep[i] ?? 0}</span>
              </li>
            ))}
          </ul>
          {c.icp && <p className="mt-2 line-clamp-3 text-[10.5px] text-muted"><span className="font-semibold">Profile:</span> {c.icp}</p>}
        </section>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[12.5px] font-semibold">Leads <span className="num font-normal text-muted">{leads.length}</span></h4>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setSource(source === "directory" ? null : "directory")} className={btn.ghost}><Icon name="Search" className="mr-1 inline h-3.5 w-3.5" />From the directory</button>
            <button type="button" onClick={() => setSource(source === "paste" ? null : "paste")} className={btn.ghost}><Icon name="ClipboardList" className="mr-1 inline h-3.5 w-3.5" />Paste a list</button>
            <button type="button" disabled={!!ctx.busy || !(stats.byStatus.sourced ?? 0)} onClick={() => act("qualify", { action: "qualify" }, (r) => `Scored ${r.scored}: ${r.qualified} qualified, ${r.disqualified} out, ${r.review} need your call.`)} className={btn.primary}>
              {ctx.busy === "qualify" ? "Qualifying…" : `Qualify ${stats.byStatus.sourced ?? 0} new`}
            </button>
          </div>
        </div>

        {source === "directory" && (
          <div className="ctl border border-line bg-elevated/40 p-3">
            <p className="text-[11px] text-muted">Search 18,000+ startups from YC, a16z, Show HN, Thiel and SEC Form D. The directory has no email addresses and YouBank does not guess them: add the address where you have it, or add the company now and fill it in later.</p>
            <div className="mt-2 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void search(); }} placeholder="fintech, payroll, vector database…" className={`${input} flex-1`} />
              <button type="button" onClick={search} disabled={!!ctx.busy || !q.trim()} className={btn.primary}>{ctx.busy === "dir-search" ? "Searching…" : "Search"}</button>
            </div>
            <ul className="mt-2 flex max-h-[360px] flex-col gap-1 overflow-auto">
              {results.map((s) => {
                const on = s.id in picked;
                return (
                  <li key={s.id} className="grid items-center gap-2 text-[11.5px] sm:grid-cols-[auto_1fr_220px]">
                    <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => { const n = { ...p }; if (e.target.checked) n[s.id] = ""; else delete n[s.id]; return n; })} />
                    <span className="min-w-0"><span className="font-semibold">{s.name}</span> <span className="text-muted">— {s.oneLiner || s.program}{s.founders ? ` · ${s.founders}` : ""}</span></span>
                    {on && <input value={picked[s.id]} onChange={(e) => setPicked((p) => ({ ...p, [s.id]: e.target.value }))} placeholder="founder@company.com (optional)" className={`${input} py-1`} />}
                  </li>
                );
              })}
            </ul>
            {Object.keys(picked).length > 0 && (
              <button type="button" onClick={addPicked} disabled={!!ctx.busy} className={`${btn.primary} mt-2`}>Add {Object.keys(picked).length} to the campaign</button>
            )}
          </div>
        )}

        {source === "paste" && (
          <div className="ctl border border-line bg-elevated/40 p-3">
            <p className="text-[11px] text-muted">One per line: <span className="num">email, name, company, notes</span>. Only the address is required. Anyone who has opted out is added as opted out and never written to.</p>
            <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} placeholder={"maya@ledgerline.io, Maya Ruiz, Ledgerline\njo@acme.dev, Jo Park, Acme, met at the Stripe dinner"} className={`${input} mt-2 w-full`} />
            <button type="button" onClick={addPasted} disabled={!!ctx.busy || !paste.trim()} className={`${btn.primary} mt-2`}>Add</button>
          </div>
        )}

        {statuses.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            {["all", ...statuses].map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)} className={`ctl px-2 py-0.5 text-[11px] ${filter === s ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
                {s === "all" ? "All" : LEAD_STATUS_LABEL[s as LeadStatus] ?? s} <span className="num">{s === "all" ? leads.length : stats.byStatus[s] ?? 0}</span>
              </button>
            ))}
          </div>
        )}

        {leads.length === 0 && <Empty>No leads yet. Add some from the directory or paste a list.</Empty>}

        <div className="flex flex-col gap-1.5">
          {shown.map((l) => (
            <article key={l.id} className="ctl border border-line bg-elevated/30 p-2.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h5 className="text-[12px] font-semibold">
                    {l.name || l.email || l.company}
                    {l.company && (l.name || l.email) ? <span className="font-normal text-muted"> · {l.company}</span> : null}
                  </h5>
                  <p className="truncate text-[11px] text-muted">{l.email || "No address yet"}{l.lastSentAt ? ` · step ${l.step} of ${c.steps.length} sent` : ""}{l.nextDueAt && l.status === "active" ? ` · next due ${new Date(l.nextDueAt).toLocaleDateString()}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {l.fit != null && <span className="num text-[10.5px] text-muted" title="Fit against the profile">{l.fit}</span>}
                  <span className={`ctl px-1.5 py-0.5 text-[10px] ${STATUS_TONE[l.status] ?? "bg-elevated text-fg"}`}>{LEAD_STATUS_LABEL[l.status as LeadStatus] ?? l.status}</span>
                </div>
              </div>
              {l.fitReason && <p className="mt-1 text-[11px] text-muted">{l.fitReason}</p>}
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {!l.email && !["disqualified", "opted_out"].includes(l.status) && (
                  <>
                    <input value={emails[l.id] ?? ""} onChange={(e) => setEmails({ ...emails, [l.id]: e.target.value })} placeholder="Add their email" className={`${input} w-[220px] py-1 max-md:w-full`} />
                    <button type="button" disabled={!!ctx.busy || !(emails[l.id] ?? "").trim()} onClick={() => patchLead(l.id, { email: emails[l.id] }, "Address added.")} className={btn.ghost}>Save</button>
                  </>
                )}
                {!l.lastSentAt && (l.status === "review" || l.status === "disqualified" || l.status === "sourced") && (
                  <button type="button" disabled={!!ctx.busy} onClick={() => patchLead(l.id, { status: "qualified" }, "Qualified.")} className={btn.link}>Qualify</button>
                )}
                {!l.lastSentAt && (l.status === "review" || l.status === "qualified" || l.status === "sourced") && (
                  <button type="button" disabled={!!ctx.busy} onClick={() => patchLead(l.id, { status: "disqualified" }, "Taken off the list.")} className={btn.link}>Disqualify</button>
                )}
                <button type="button" disabled={!!ctx.busy} onClick={() => removeLead(l.id)} className={btn.danger}>Remove</button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
