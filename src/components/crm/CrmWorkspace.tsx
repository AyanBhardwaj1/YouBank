"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import {
  CATEGORY_LABEL, STAGES, STAGE_BLURB, STAGE_LABEL,
  type Category, type Stage,
} from "@/lib/crm/model";

type Thread = {
  id: number; subject: string; snippet: string; summary: string; category: string; priority: string;
  needsReply: boolean; triagedAt: string | null; lastMessageAt: string | null; dealId: number | null;
};
type Deal = {
  id: number; name: string; stage: string; sector: string; round: string;
  amountUsd: number | null; valuationUsd: number | null; nextStep: string; contactId: number | null;
  startupId: number | null; source: string;
};
type Contact = { id: number; email: string; name: string; title: string; company: string; kind: string; startupId: number | null };
type Draft = {
  id: number; threadId: number | null; subject: string; body: string; rationale: string;
  citations: { label: string }[]; toAddresses: { name: string; address: string }[]; model: string; createdAt: string;
};
type Counts = { threads: number; pendingDrafts: number; needsReply: number; byStage: Record<string, number> };

const TABS = [
  { id: "pipeline", label: "Pipeline", icon: "Layers" },
  { id: "inbox", label: "Inbox", icon: "Mail" },
  { id: "drafts", label: "Review queue", icon: "FileText" },
] as const;
type Tab = (typeof TABS)[number]["id"];

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

const money = (n: number | null) => (n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`);

export function CrmWorkspace({ needsMigration, aiConfigured }: { needsMigration: boolean; aiConfigured: boolean }) {
  const [tab, setTab] = useState<Tab>("pipeline");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paste, setPaste] = useState({ open: false, from: "", subject: "", body: "" });
  const [editing, setEditing] = useState<{ id: number; subject: string; body: string } | null>(null);

  const say = (m: string) => { setNotice(m); setError(null); window.setTimeout(() => setNotice((n) => (n === m ? null : n)), 5000); };

  // Everything reloads together; `tick` is how an action asks for a fresh read.
  const [tick, setTick] = useState(0);
  const refresh = useCallback(async () => { setTick((n) => n + 1); }, []);

  useEffect(() => {
    if (needsMigration) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [t, d, q] = await Promise.all([
          api<Thread[]>("/api/crm/threads"),
          api<{ deals: Deal[]; contacts: Contact[]; counts: Counts }>("/api/crm/deals"),
          api<Draft[]>("/api/crm/drafts"),
        ]);
        if (cancelled) return;
        setThreads(t); setDeals(d.deals); setContacts(d.contacts); setCounts(d.counts); setDrafts(q);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    return () => { cancelled = true; };
  }, [needsMigration, tick]);

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); }
  };

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
    await refresh(); setTab("drafts"); say("Draft written. Nothing has been sent — review it below.");
  });

  const reprocess = (threadId: number) => run(`proc-${threadId}`, async () => {
    await api(`/api/crm/threads/${threadId}`, { method: "POST", body: JSON.stringify({ action: "process" }) });
    await refresh(); say("Re-read and filed");
  });

  const move = (dealId: number, stage: Stage) => run(`move-${dealId}`, async () => {
    await api(`/api/crm/deals/${dealId}`, { method: "PATCH", body: JSON.stringify({ stage }) });
    await refresh();
  });

  const saveDraft = () => run("save", async () => {
    if (!editing) return;
    await api(`/api/crm/drafts/${editing.id}`, { method: "PATCH", body: JSON.stringify({ subject: editing.subject, body: editing.body }) });
    setEditing(null); await refresh(); say("Saved. Still not sent.");
  });

  const discard = (id: number) => run(`discard-${id}`, async () => {
    await api(`/api/crm/drafts/${id}`, { method: "DELETE" });
    await refresh(); say("Draft discarded");
  });

  const contactFor = (id: number | null) => contacts.find((c) => c.id === id) ?? null;

  if (needsMigration) {
    return (
      <Shell counts={null}>
        <div className="mt-6 ctl border border-warn/40 bg-warn/5 p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="AlertTriangle" className="h-4 w-4" /> Not set up yet</h2>
          <p className="mt-2 max-w-[70ch] text-[12px] text-muted">The CRM tables have not been created. Apply the migration and reload:</p>
          <pre className="num mt-3 overflow-auto ctl border border-line bg-elevated/60 p-3 text-[11.5px]">( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )</pre>
          <p className="mt-2 text-[11.5px] text-muted">The statements are in <span className="num">drizzle/0002_crm.sql</span> — six new tables, nothing existing is touched.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell counts={counts}>
      {!aiConfigured && (
        <div className="mt-4 ctl border border-warn/40 bg-warn/5 px-3 py-2 text-[12px]">
          No AI provider is configured, so the agent cannot read or draft. Add a key in <Link href="/app/settings" className="text-accent hover:underline">Settings</Link>.
        </div>
      )}
      {(error || notice) && (
        <div className={`mt-4 ctl border px-3 py-2 text-[12px] ${error ? "border-neg/40 bg-neg/5 text-neg" : "border-pos/40 bg-pos/5 text-pos"}`}>{error ?? notice}</div>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`ctl flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition ${tab === t.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" /> {t.label}
              {t.id === "drafts" && counts?.pendingDrafts ? <span className="num ctl bg-accent/20 px-1 text-[10px]">{counts.pendingDrafts}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setPaste((p) => ({ ...p, open: !p.open }))}
          className="ctl border border-line px-2.5 py-1.5 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg">
          <Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />Feed the agent an email
        </button>
      </div>

      {paste.open && (
        <div className="mt-4 ctl border border-line bg-elevated/40 p-3.5">
          <h3 className="text-[13px] font-semibold">Paste an email</h3>
          <p className="mt-1 max-w-[70ch] text-[11.5px] text-muted">The agent reads it, files the sender and any company, and puts it in your pipeline. Use this to try the agent before connecting a mailbox.</p>
          <div className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
            <input value={paste.from} onChange={(e) => setPaste({ ...paste, from: e.target.value })} placeholder="maya@ledgerline.io"
              className="ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
            <input value={paste.subject} onChange={(e) => setPaste({ ...paste, subject: e.target.value })} placeholder="Subject"
              className="ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
          </div>
          <textarea value={paste.body} onChange={(e) => setPaste({ ...paste, body: e.target.value })} rows={7} placeholder="Paste the email body…"
            className="mt-1.5 w-full ctl border border-line bg-bg/60 px-2.5 py-2 text-[12px] outline-none focus:border-accent/60" />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={ingest} disabled={!!busy || !paste.from.trim() || !paste.body.trim()}
              className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">
              {busy === "ingest" ? "Reading…" : "Read and file"}
            </button>
            <button type="button" onClick={() => setPaste({ open: false, from: "", subject: "", body: "" })} className="text-[11.5px] text-muted hover:text-fg">Cancel</button>
          </div>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {STAGES.map((stage) => {
            const inStage = deals.filter((d) => d.stage === stage);
            if (stage === "passed" && inStage.length === 0) return null;
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
                          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
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
          {threads.length === 0 && <p className="text-[12px] text-muted">No threads yet. Paste one in above to see what the agent does with it.</p>}
          {threads.map((t) => (
            <article key={t.id} className="ctl border border-line bg-elevated/30 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold">{t.subject || "(no subject)"}</h3>
                  <p className="mt-0.5 text-[11.5px] text-muted">{t.summary || t.snippet}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {t.needsReply && <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">Needs reply</span>}
                  <span className={`ctl px-1.5 py-0.5 text-[10px] ${t.priority === "high" ? "bg-neg/15 text-neg" : t.priority === "low" ? "bg-elevated text-muted" : "bg-elevated text-fg"}`}>{t.priority}</span>
                  <span className="ctl bg-elevated px-1.5 py-0.5 text-[10px] text-muted">{CATEGORY_LABEL[t.category as Category] ?? t.category}</span>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={!!busy} onClick={() => draftFor(t.id)}
                  className="ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">
                  {busy === `draft-${t.id}` ? "Writing…" : "Draft a reply"}
                </button>
                <button type="button" disabled={!!busy} onClick={() => { const i = window.prompt("What should the reply do? e.g. \"pass, too early\" or \"ask for the deck and metrics\""); if (i) draftFor(t.id, i); }}
                  className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50">Draft with an instruction</button>
                <button type="button" disabled={!!busy} onClick={() => reprocess(t.id)}
                  className="text-[11.5px] text-muted transition hover:text-fg disabled:opacity-50">{busy === `proc-${t.id}` ? "Reading…" : "Re-read"}</button>
              </div>
            </article>
          ))}
        </div>
      )}

      {tab === "drafts" && (
        <div className="mt-5 flex flex-col gap-3">
          <p className="text-[11.5px] text-muted">
            Every draft here was written by the agent and <strong className="text-fg">has not been sent</strong>. Sending happens from your own mail client until a mailbox is connected.
          </p>
          {drafts.length === 0 && <p className="text-[12px] text-muted">Nothing waiting. Draft a reply from the Inbox tab.</p>}
          {drafts.map((d) => {
            const isEditing = editing?.id === d.id;
            return (
              <article key={d.id} className="ctl border border-line bg-elevated/30 p-3.5">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">{isEditing ? "Editing draft" : d.subject}</h3>
                  <span className="num text-[10.5px] text-muted">to {d.toAddresses.map((a) => a.address).join(", ") || "—"} · {d.model}</span>
                </header>
                {isEditing ? (
                  <>
                    <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
                      className="mt-2 w-full ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
                    <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={9}
                      className="mt-1.5 w-full ctl border border-line bg-bg/60 px-2.5 py-2 text-[12px] outline-none focus:border-accent/60" />
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={saveDraft} disabled={!!busy} className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setEditing(null)} className="text-[11.5px] text-muted hover:text-fg">Cancel</button>
                    </div>
                  </>
                ) : (
                  <>
                    <pre className="mt-2 whitespace-pre-wrap ctl border border-line bg-bg/60 p-2.5 font-sans text-[12px] leading-relaxed">{d.body}</pre>
                    {d.rationale && <p className="mt-2 text-[11px] text-muted"><span className="font-semibold">Why this reply:</span> {d.rationale}</p>}
                    {d.citations.length > 0 && (
                      <div className="mt-1.5 ctl border border-warn/40 bg-warn/5 px-2.5 py-1.5">
                        <div className="text-[10.5px] font-semibold text-warn">Decide before sending</div>
                        <ul className="mt-0.5 list-inside list-disc text-[11px] text-muted">{d.citations.map((c, i) => <li key={i}>{c.label}</li>)}</ul>
                      </div>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => { void navigator.clipboard?.writeText(`Subject: ${d.subject}\n\n${d.body}`).then(() => say("Copied. Paste it into your mail client to send.")); }}
                        className="ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg transition hover:bg-white">Copy to send</button>
                      <button type="button" onClick={() => setEditing({ id: d.id, subject: d.subject, body: d.body })}
                        className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg">Edit</button>
                      <button type="button" disabled={!!busy} onClick={() => discard(d.id)}
                        className="text-[11.5px] text-muted transition hover:text-neg disabled:opacity-50">Discard</button>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function Shell({ counts, children }: { counts: Counts | null; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1240px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Relationships</h1>
            <p className="mt-1 max-w-[74ch] text-[12px] text-muted">
              An agent that reads your inbox, files who wrote and what they want, keeps your pipeline current, and drafts replies for you to review. It never sends anything on its own.
            </p>
          </div>
          {counts && (
            <div className="flex gap-4 text-[11.5px] text-muted">
              <span><span className="num text-fg">{counts.threads}</span> threads</span>
              <span><span className="num text-fg">{counts.needsReply}</span> need a reply</span>
              <span><span className="num text-fg">{counts.pendingDrafts}</span> drafts waiting</span>
            </div>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
