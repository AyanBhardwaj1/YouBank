"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  CATEGORY_LABEL, LOST_STAGES, STAGE_BLURB, STAGE_LABEL, isStage, stagesFor,
  type Category, type Mode, type Stage,
} from "@/lib/crm/model";
import { AgentSettings } from "./AgentSettings";
import { CampaignsPanel } from "./CampaignsPanel";
import { ContactsPanel } from "./ContactsPanel";
import { InsightsPanel } from "./InsightsPanel";
import { MailboxBar, type MailboxInfo } from "./MailboxBar";
import { NurturePanel } from "./NurturePanel";
import { ReviewQueue, type Draft } from "./ReviewQueue";
import { api, btn, money, type PanelCtx } from "./shared";

type Activity = {
  draft: { status: string; scheduledFor: string | null; sentBy: string; holdReason: string } | null;
  questions: number;
} | null;
type Thread = {
  id: number; subject: string; snippet: string; summary: string; category: string; priority: string;
  needsReply: boolean; triagedAt: string | null; lastMessageAt: string | null; dealId: number | null; activity: Activity;
};
type Deal = {
  id: number; name: string; stage: string; sector: string; round: string;
  amountUsd: number | null; valuationUsd: number | null; nextStep: string; contactId: number | null;
  startupId: number | null; source: string;
};
type Contact = { id: number; email: string; name: string; title: string; company: string; kind: string; startupId: number | null };
type Counts = { threads: number; pendingDrafts: number; needsReply: number; pendingActions: number; byStage: Record<string, number> };
type AgentRun = {
  signals: number; followUps: number; checkIns: number; nurture: { drafted: number; skipped: number };
  campaigns: { drafted: number; waitingForEmail: number }; scheduled: number; errors: string[]; stoppedEarly: boolean;
};
type Settings = { mode: Mode; autopilot: { enabled: boolean; autoSync: boolean } };

const TABS = [
  { id: "drafts", label: "Queue", icon: "FileText" },
  { id: "inbox", label: "Inbox", icon: "Mail" },
  { id: "pipeline", label: "Pipeline", icon: "Layers" },
  { id: "contacts", label: "Contacts", icon: "Users" },
  { id: "insights", label: "Insights", icon: "Activity" },
  { id: "campaigns", label: "Campaigns", icon: "Target" },
  { id: "nurture", label: "Nurture", icon: "RefreshCw" },
  { id: "agent", label: "Agent & autopilot", icon: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** What the agent run found and wrote, in one sentence. */
function describeRun(r: AgentRun): string {
  const suggestions = r.signals + r.followUps + r.checkIns;
  const drafted = r.nurture.drafted + r.campaigns.drafted;
  const parts = [
    suggestions ? `${suggestions} new ${suggestions === 1 ? "suggestion" : "suggestions"}` : "no new suggestions",
    `${drafted} ${drafted === 1 ? "draft" : "drafts"} written`,
    r.scheduled ? `${r.scheduled} scheduled on autopilot` : "",
    r.nurture.skipped ? `${r.nurture.skipped} quiet ${r.nurture.skipped === 1 ? "contact" : "contacts"} deliberately left alone` : "",
    r.campaigns.waitingForEmail ? `${r.campaigns.waitingForEmail} campaign ${r.campaigns.waitingForEmail === 1 ? "lead needs" : "leads need"} an address` : "",
  ].filter(Boolean);
  return `Agent run: ${parts.join(", ")}.${r.stoppedEarly ? " Stopped at the time limit; run again for the rest." : ""}${r.errors.length ? ` ${r.errors.length} failed: ${r.errors[0]}` : ""}`;
}

/** One short status per thread: what the agent did about it. */
function threadStatus(t: Thread): { label: string; tone: string } | null {
  const a = t.activity;
  if (a?.questions) return { label: "Needs your input", tone: "bg-accent-soft text-accent font-semibold" };
  const d = a?.draft;
  if (d?.status === "pending" && d.scheduledFor) return { label: "Autopilot sending", tone: "bg-accent-soft text-accent" };
  if (d?.status === "pending") return { label: "Draft waiting", tone: "bg-info/15 text-info" };
  if (d?.status === "sent") return { label: d.sentBy === "autopilot" ? "Answered by autopilot" : "You replied", tone: "bg-pos/15 text-pos" };
  if (t.needsReply) return { label: "Needs reply", tone: "bg-accent-soft text-accent font-semibold" };
  return null;
}

export function CrmWorkspace({ needsMigration, aiConfigured, connected, oauthError, initialTab }: {
  needsMigration: boolean; aiConfigured: boolean; connected: string | null; oauthError: string | null; initialTab: string | null;
}) {
  const [tab, setTab] = useState<Tab>(TABS.find((t) => t.id === initialTab)?.id ?? "drafts");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [mailbox, setMailbox] = useState<MailboxInfo | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(oauthError);
  const [notice, setNotice] = useState<string | null>(connected ? `Connected ${connected}. The agent will read recent threads.` : null);
  const [paste, setPaste] = useState({ open: false, from: "", subject: "", body: "" });

  const say = (m: string) => { setNotice(m); setError(null); window.setTimeout(() => setNotice((n) => (n === m ? null : n)), 7000); };

  // Everything reloads together; `tick` is how an action asks for a fresh read.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(async () => { setTick((n) => n + 1); }, []);
  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };
  const ctx: PanelCtx = { busy, run, say, refresh: () => { void refresh(); }, tick };

  useEffect(() => {
    if (needsMigration) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [t, d, q, a, s] = await Promise.all([
          api<Thread[]>("/api/crm/threads"),
          api<{ deals: Deal[]; contacts: Contact[]; counts: Counts }>("/api/crm/deals"),
          api<Draft[]>("/api/crm/drafts"),
          api<MailboxInfo>("/api/crm/accounts"),
          api<Settings>("/api/crm/settings"),
        ]);
        if (cancelled) return;
        setThreads(t); setDeals(d.deals); setContacts(d.contacts); setCounts(d.counts); setDrafts(q); setMailbox(a); setSettings(s);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    return () => { cancelled = true; };
  }, [needsMigration, tick]);

  // While autopilot is on, keep the page current with what the heartbeat does in the background.
  useEffect(() => {
    if (!settings?.autopilot.enabled) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") setTick((n) => n + 1); }, 60_000);
    return () => window.clearInterval(id);
  }, [settings?.autopilot.enabled]);

  const ingest = () => run("ingest", async () => {
    const r = await api<{ triage?: { summary: string }; thread?: unknown }>("/api/crm/threads", {
      method: "POST",
      body: JSON.stringify({ subject: paste.subject, messages: [{ fromAddress: paste.from, body: paste.body }] }),
    });
    setPaste({ open: false, from: "", subject: "", body: "" });
    await refresh();
    setTab("inbox");
    say(r.triage ? `Read and filed: ${r.triage.summary}` : "Thread added");
  });

  const draftFor = (threadId: number, instruction?: string) => run(`draft-${threadId}`, async () => {
    await api(`/api/crm/threads/${threadId}`, { method: "POST", body: JSON.stringify({ action: "draft", instruction }) });
    await refresh(); setTab("drafts"); say("Draft written. It is in the queue, waiting for you.");
  });

  const reprocess = (threadId: number) => run(`proc-${threadId}`, async () => {
    await api(`/api/crm/threads/${threadId}`, { method: "POST", body: JSON.stringify({ action: "process" }) });
    await refresh(); say("Re-read and filed");
  });

  const move = (dealId: number, stage: Stage) => run(`move-${dealId}`, async () => {
    await api(`/api/crm/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    await refresh();
  });

  const runAgent = () => run("agent", async () => {
    const r = await api<AgentRun>("/api/crm/agent", { method: "POST" });
    await refresh();
    say(describeRun(r));
    if (r.nurture.drafted + r.campaigns.drafted + r.signals + r.followUps + r.checkIns > 0) setTab("drafts");
  });

  const contactFor = (id: number | null) => contacts.find((c) => c.id === id) ?? null;
  const canSend = (mailbox?.accounts ?? []).some((a) => a.status === "connected");
  const mode = settings?.mode ?? "sales";
  const pipeline = [...stagesFor(mode), ...deals.map((d) => d.stage).filter((s): s is Stage => isStage(s) && !stagesFor(mode).includes(s))]
    .filter((s, i, all) => all.indexOf(s) === i);

  if (needsMigration) {
    return (
      <Shell counts={null} autopilot={null} onAutopilot={() => undefined}>
        <div className="mt-6 ctl border border-info/40 bg-info/5 p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="AlertTriangle" className="h-4 w-4" /> Not set up yet</h2>
          <p className="mt-2 max-w-[70ch] text-[12px] text-muted">The CRM tables have not been created. Apply the migrations and reload:</p>
          <pre className="num mt-3 overflow-auto ctl border border-line bg-elevated/60 p-3 text-[11.5px]">( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )</pre>
          <p className="mt-2 text-[11.5px] text-muted">The statements are in <span className="num">drizzle/0002_crm.sql</span>, <span className="num">0004_outreach.sql</span> and <span className="num">0005_autopilot.sql</span>. They only add tables and columns.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell counts={counts} autopilot={settings?.autopilot.enabled ?? null} onAutopilot={() => setTab("agent")}>
      {!aiConfigured && (
        <div className="mt-4 ctl border border-info/40 bg-info/5 px-3 py-2 text-[12px]">
          No AI provider is configured, so the agent cannot read or draft. Add a key in <Link href="/app/settings" className="text-accent hover:underline">Settings</Link>.
        </div>
      )}
      {(error || notice) && (
        <div className={`mt-4 ctl border px-3 py-2 text-[12px] ${error ? "border-neg/40 bg-neg/5 text-neg" : "border-pos/40 bg-pos/5 text-pos"}`}>{error ?? notice}</div>
      )}

      <MailboxBar ctx={ctx} info={mailbox} autoSync={settings?.autopilot.autoSync ?? true} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`ctl flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition ${tab === t.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" /> {t.label}
              {t.id === "drafts" && (counts?.pendingDrafts || counts?.pendingActions) ? <span className="num ctl bg-accent/20 px-1 text-[10px]">{(counts.pendingDrafts ?? 0) + (counts.pendingActions ?? 0)}</span> : null}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setPaste((p) => ({ ...p, open: !p.open }))} className={btn.ghost}>
            <Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />Paste an email
          </button>
          <button type="button" onClick={runAgent} disabled={!!busy || !aiConfigured}
            title="Scan for follow-ups, quiet deals and funding news, and draft what nurture rules and live campaigns have due."
            className={btn.primary}>
            <Icon name="Bot" className="mr-1 inline h-3.5 w-3.5" />{busy === "agent" ? "Agent working…" : "Run agent"}
          </button>
        </div>
      </div>

      {paste.open && (
        <div className="mt-4 ctl border border-line bg-elevated/40 p-3.5">
          <h3 className="text-[13px] font-semibold">Paste an email</h3>
          <p className="mt-1 max-w-[70ch] text-[11.5px] text-muted">The agent reads it, files the sender and any company, and puts it in your pipeline. Useful for trying the agent before connecting a mailbox.</p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            <input value={paste.from} onChange={(e) => setPaste({ ...paste, from: e.target.value })} placeholder="maya@ledgerline.io"
              className="ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
            <input value={paste.subject} onChange={(e) => setPaste({ ...paste, subject: e.target.value })} placeholder="Subject"
              className="ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
          </div>
          <textarea value={paste.body} onChange={(e) => setPaste({ ...paste, body: e.target.value })} rows={7} placeholder="Paste the email body…"
            className="mt-1.5 w-full ctl border border-line bg-bg/60 px-2.5 py-2 text-[12px] outline-none focus:border-accent/60" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={ingest} disabled={!!busy || !paste.from.trim() || !paste.body.trim()} className={btn.primary}>
              {busy === "ingest" ? "Reading…" : "Read and file"}
            </button>
            <button type="button" onClick={() => setPaste({ open: false, from: "", subject: "", body: "" })} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      {tab === "drafts" && <div className="mt-5"><ReviewQueue ctx={ctx} drafts={drafts} canSend={canSend} autopilotOn={!!settings?.autopilot.enabled} /></div>}

      {tab === "pipeline" && (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {pipeline.map((stage) => {
            const inStage = deals.filter((d) => d.stage === stage);
            if (LOST_STAGES.includes(stage) && inStage.length === 0) return null;
            return (
              <section key={stage} className="ctl border border-line bg-elevated/30 p-3">
                <header className="flex items-baseline justify-between">
                  <h3 className="text-[12.5px] font-semibold">{STAGE_LABEL[stage]}</h3>
                  <span className="num text-[11px] text-muted">{inStage.length}</span>
                </header>
                <p className="mt-0.5 text-[10.5px] text-muted">{STAGE_BLURB[stage]}</p>
                <div className="mt-2.5 flex flex-col gap-1.5">
                  {inStage.length === 0 && <p className="text-[11px] text-muted opacity-70">Nothing here.</p>}
                  {inStage.map((d) => {
                    const c = contactFor(d.contactId);
                    return (
                      <article key={d.id} className="ctl border border-line bg-bg/60 p-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <h4 className="truncate text-[12.5px] font-semibold">{d.name}</h4>
                          {d.startupId ? <span title="Matched in YouBank's startup directory"><Icon name="Check" className="h-3.5 w-3.5 shrink-0 text-pos" /></span> : null}
                        </div>
                        <p className="mt-0.5 text-[11px] text-muted">
                          {[d.round, money(d.amountUsd), d.valuationUsd ? `at ${money(d.valuationUsd)}` : "", d.sector].filter(Boolean).join(" · ") || "No terms stated"}
                        </p>
                        {c && <p className="mt-0.5 truncate text-[11px] text-muted">{c.name || c.email}{c.title ? `, ${c.title}` : ""}</p>}
                        {d.nextStep && <p className="mt-1.5 text-[11px]"><span className="text-muted">Next:</span> {d.nextStep}</p>}
                        <select value={d.stage} disabled={!!busy} onChange={(e) => move(d.id, e.target.value as Stage)}
                          className="mt-2 w-full ctl border border-line bg-elevated/60 px-1.5 py-1 text-[11px] outline-none focus:border-accent/60">
                          {pipeline.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                        </select>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {tab === "inbox" && (
        <div className="mt-5 flex flex-col gap-2">
          {threads.length === 0 && <p className="text-[12px] text-muted">No threads yet. Connect a mailbox above, or paste an email to see what the agent does with it.</p>}
          {threads.map((t) => {
            const status = threadStatus(t);
            return (
              <article key={t.id} className="ctl border border-line bg-elevated/30 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate text-[13px] font-semibold">{t.subject || "(no subject)"}</h3>
                    <p className="mt-0.5 text-[11.5px] text-muted">{t.summary || t.snippet}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {status && <span className={`ctl px-1.5 py-0.5 text-[10px] ${status.tone}`}>{status.label}</span>}
                    <span className={`ctl px-1.5 py-0.5 text-[10px] ${t.priority === "high" ? "bg-neg/15 text-neg" : t.priority === "low" ? "bg-elevated text-muted" : "bg-elevated text-fg"}`}>{t.priority}</span>
                    <span className="ctl bg-elevated px-1.5 py-0.5 text-[10px] text-muted">{CATEGORY_LABEL[t.category as Category] ?? t.category}</span>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" disabled={!!busy} onClick={() => draftFor(t.id)} className={btn.primary}>
                    {busy === `draft-${t.id}` ? "Writing…" : "Draft a reply"}
                  </button>
                  <button type="button" disabled={!!busy} onClick={() => { const i = window.prompt("What should the reply do? e.g. \"propose Tuesday at 2pm\" or \"decline politely, not a fit\""); if (i) draftFor(t.id, i); }}
                    className={btn.ghost}>Draft with an instruction</button>
                  <button type="button" disabled={!!busy} onClick={() => reprocess(t.id)} className={btn.link}>{busy === `proc-${t.id}` ? "Reading…" : "Re-read"}</button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {tab === "contacts" && <div className="mt-5"><ContactsPanel ctx={ctx} /></div>}
      {tab === "insights" && <div className="mt-5"><InsightsPanel ctx={ctx} /></div>}
      {tab === "nurture" && <div className="mt-5"><NurturePanel ctx={ctx} onDrafted={() => setTab("drafts")} /></div>}
      {tab === "campaigns" && <div className="mt-5"><CampaignsPanel ctx={ctx} onDrafted={() => undefined} /></div>}
      {tab === "agent" && <div className="mt-5"><AgentSettings ctx={ctx} /></div>}
    </Shell>
  );
}

function Shell({ counts, autopilot, onAutopilot, children }: { counts: Counts | null; autopilot: boolean | null; onAutopilot: () => void; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight">
              Relationships
              {autopilot !== null && (
                <button type="button" onClick={onAutopilot}
                  className={`ctl px-2 py-0.5 text-[10.5px] font-semibold ${autopilot ? "bg-accent text-bg" : "border border-line text-muted hover:text-fg"}`}>
                  {autopilot ? "Autopilot on" : "Autopilot off"}
                </button>
              )}
            </h1>
            <p className="mt-1 max-w-[80ch] text-[12px] text-muted">
              An agent that tracks your inbox, answers what it can, asks you what it cannot and remembers the answer, keeps your pipeline current, and runs outreach. It sends on its own only for the kinds of email you put on autopilot.
            </p>
          </div>
          {counts && (
            <div className="flex gap-4 text-[11.5px] text-muted">
              <span><span className="num text-fg">{counts.threads}</span> threads</span>
              <span><span className="num text-fg">{counts.needsReply}</span> need a reply</span>
              <span><span className="num text-fg">{counts.pendingDrafts}</span> drafts</span>
              {counts.pendingActions ? <span><span className="num text-fg">{counts.pendingActions}</span> suggestions</span> : null}
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
