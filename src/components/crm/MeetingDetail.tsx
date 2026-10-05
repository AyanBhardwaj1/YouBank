"use client";

import { useCallback, useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { confirmDialog, promptDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { STAGE_LABEL, type Stage } from "@/lib/crm/model";
import { INTEREST_LABEL, PLATFORM_LABEL, STATUS_LABEL, clock, durationLabel, isPlatform, type MeetingNotes, type MeetingStatus, type Segment } from "@/lib/meetings/model";
import type { MeetingAccess } from "./MeetingsPanel";
import { Empty, api, btn, input, type PanelCtx } from "./shared";

type Update = { id: number; kind: string; status: string; title: string; reasoning: string; uncertainties: string[]; payload: Record<string, unknown>; decidedAt: string | null };
type Detail = {
  meeting: {
    id: number; title: string; platform: string; source: string; status: string; meetingUrl: string; bot: { status: string | null; error: string | null };
    participants: { name: string; email?: string; contactId?: number | null; how?: string; self?: boolean }[];
    consent: { at?: string; noticeCopied?: boolean; auto?: boolean }; live: { on: boolean; minutes: number };
    notes: MeetingNotes | null; notesAt: string | null; transcriber: string; durationSec: number; error: string; startedAt: string; purgedAt: string | null;
  };
  transcript: Segment[];
  contacts: { id: number; name: string; email: string; company: string; how: string; needsReview: boolean }[];
  deals: { id: number; name: string; stage: string }[];
  updates: Update[];
  drafts: { id: number; subject: string; body: string; status: string; toAddresses: { name: string; address: string }[] }[];
};
type Ref = { contacts: { id: number; name: string; email: string; company: string }[]; deals: { id: number; name: string; stage: string }[] };

const sentimentWord = (s: number) => (s >= 0.4 ? "positive" : s <= -0.4 ? "negative" : s >= 0.15 ? "warm" : s <= -0.15 ? "cool" : "neutral");
const HOW: Record<string, string> = { email: "matched by email", name: "matched by name", new: "new contact", manual: "added by you", matched: "matched" };
const APPROVE: Record<string, string> = { update_deal: "Accept", move_stage: "Move it", update_contact: "Accept", review_contact: "Keep", add_contact: "Add" };

/** One meeting: notes, proposed CRM updates as accept or reject cards, the people and deals, the transcript. */
export function MeetingDetail({ ctx, id, access, onBack, onDrafted }: { ctx: PanelCtx; id: number; access: MeetingAccess | null; onBack: () => void; onDrafted: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [emails, setEmails] = useState<Record<number, string>>({});
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ answer: string; quotes: { at: string; speaker: string; text: string }[] } | null>(null);
  const [picking, setPicking] = useState<{ q: string; found: Ref | null } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(() => api<Detail>(`/api/meetings/${id}`).then((x) => { setD(x); setFailed(null); }).catch((e) => setFailed(e instanceof Error ? e.message : String(e))), [id]);
  useEffect(() => { void load(); }, [load, ctx.tick]);

  // A meeting still in progress (a notetaker in the call, notes being written) refreshes itself.
  const pending = d && ["joining", "live", "processing"].includes(d.meeting.status);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 15_000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  useEffect(() => {
    if (!picking) return;
    const t = window.setTimeout(() => api<Ref>(`/api/meetings/search?q=${encodeURIComponent(picking.q)}`).then((found) => setPicking((p) => (p ? { ...p, found } : p))).catch(() => {}), 250);
    return () => window.clearTimeout(t);
  }, [picking?.q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <div className="flex flex-col gap-2"><BackLink onBack={onBack} /><Empty>{failed}</Empty></div>;
  if (!d) return <div className="flex flex-col gap-2"><BackLink onBack={onBack} /><p className="text-[12px] text-muted">Loading…</p></div>;
  const m = d.meeting, n = m.notes;

  const act = (u: Update, approve: boolean) => ctx.run(`upd-${u.id}`, async () => {
    if (approve) {
      const r = await api<{ message: string; draftId: number | null }>(`/api/crm/actions/${u.id}`, { method: "POST", body: JSON.stringify(u.kind === "add_contact" ? { email: emails[u.id] ?? "" } : {}) });
      ctx.say(r.message);
    } else {
      await api(`/api/crm/actions/${u.id}`, { method: "DELETE" });
      ctx.say(u.kind === "review_contact" ? "Removed again." : "Rejected. Nothing was changed.");
    }
    await load();
  });
  const notesNow = () => ctx.run("notes", async () => {
    await api(`/api/meetings/${id}/notes`, { method: "POST" });
    await load(); ctx.say("Notes written and filed into Relationships."); onDrafted();
  });
  const rename = () => ctx.run("rename", async () => {
    const title = (await promptDialog({ title: "Rename this meeting", label: "Title", defaultValue: m.title, confirmLabel: "Save" }))?.trim();
    if (title === undefined || title === m.title) return;
    await api(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify({ title }) });
    await load();
  });
  const link = (body: Record<string, unknown>, message: string) => ctx.run("link", async () => {
    await api(`/api/meetings/${id}`, { method: "PATCH", body: JSON.stringify(body) });
    setPicking(null); await load(); ctx.say(message);
  });
  const stopBot = () => ctx.run("stop-bot", async () => { await api(`/api/meetings/${id}/bot`, { method: "DELETE" }); await load(); ctx.say("The notetaker left the call."); });
  const remove = async () => {
    if (!(await confirmDialog({ title: "Delete this meeting?", body: "Its transcript, notes and the entries on contacts' timelines are deleted. Contacts it added stay.", confirmLabel: "Delete", tone: "danger" }))) return;
    await ctx.run("delete", async () => { await api(`/api/meetings/${id}`, { method: "DELETE" }); onBack(); });
  };
  const ask = () => ctx.run("ask", async () => {
    setAnswer(await api(`/api/meetings/${id}/ask`, { method: "POST", body: JSON.stringify({ question }) }));
  });

  const pendingUpdates = d.updates.filter((u) => u.status === "pending");
  const decided = d.updates.filter((u) => u.status !== "pending");
  const transcript = showAll ? d.transcript : d.transcript.slice(0, 60);
  const canWrite = !!access && (access.notes.allowed || access.notes.unlimited);

  return (
    <div className="flex flex-col gap-4">
      <BackLink onBack={onBack} />
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 text-[16px] font-semibold">
            {m.title || "Untitled meeting"}
            <button type="button" onClick={rename} className={btn.link} title="Rename"><Icon name="Wand2" className="h-3.5 w-3.5" /></button>
          </h2>
          <p className="mt-0.5 text-[11.5px] text-muted">
            {[isPlatform(m.platform) ? PLATFORM_LABEL[m.platform] : "", new Date(m.startedAt).toLocaleString(), m.durationSec ? durationLabel(m.durationSec) : "", m.source === "bot" ? "notetaker" : "desktop app", m.transcriber ? `transcribed by ${m.transcriber}` : ""].filter(Boolean).join(" · ")}
          </p>
          {m.consent.at && <p className="mt-0.5 text-[10.5px] text-muted">Recording agreed {new Date(m.consent.at).toLocaleTimeString()}{m.consent.auto ? " (auto-start)" : ""}{m.consent.noticeCopied ? "; notice copied for the chat" : ""}.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="ctl bg-elevated px-1.5 py-0.5 text-[10.5px]">{STATUS_LABEL[m.status as MeetingStatus] ?? m.status}</span>
          {m.source === "bot" && (m.status === "joining" || m.status === "live") && <button type="button" onClick={stopBot} disabled={!!ctx.busy} className={btn.ghost}>Remove the notetaker</button>}
          {m.status === "ready" && d.transcript.length > 0 && (
            <button type="button" onClick={notesNow} disabled={!!ctx.busy || !canWrite} className={btn.ghost} title={canWrite ? "" : "Past this month's free notes; part of the Pro plan"}>
              {ctx.busy === "notes" ? "Writing…" : n ? "Rewrite notes" : "Write notes"}
            </button>
          )}
          {!canWrite && m.status === "ready" && <PremiumBadge feature="meetings.notes" />}
          <button type="button" onClick={remove} disabled={!!ctx.busy} className={btn.danger}>Delete</button>
        </div>
      </header>

      {m.error && <p className="ctl border border-info/40 bg-info/5 px-3 py-2 text-[12px]">{m.error}</p>}
      {m.status === "processing" && <p className="text-[12px] text-muted">Writing the notes. This takes a minute or two; the page updates on its own.</p>}
      {m.status === "joining" && <p className="text-[12px] text-muted">The notetaker is joining. If the meeting has a waiting room, admit “{access?.settings.botName ?? "YouBank Notetaker"}”.</p>}

      {n && (
        <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
          <div className="flex flex-col gap-4">
            <Section title="Summary"><p className="text-[12.5px] leading-relaxed">{n.summary || "No summary."}</p></Section>
            {n.decisions.length > 0 && <Section title="Decisions"><ul className="list-disc pl-4 text-[12px]">{n.decisions.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}
            <Section title="Action items">
              {n.actionItems.length === 0 ? <p className="text-[12px] text-muted">No commitments were made.</p> : (
                <table className="w-full text-[12px]">
                  <thead><tr className="text-left text-[10.5px] uppercase tracking-wide text-muted"><th className="pb-1 font-semibold">What</th><th className="pb-1 font-semibold">Who</th><th className="pb-1 font-semibold">By</th></tr></thead>
                  <tbody>{n.actionItems.map((a, i) => (
                    <tr key={i} className="border-t border-line align-top"><td className="py-1 pr-2">{a.text}</td><td className={`py-1 pr-2 ${a.mine ? "font-semibold text-accent" : ""}`}>{a.owner || "Nobody yet"}</td><td className="num py-1">{a.due ?? (a.dueText || "")}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </Section>
            {n.openQuestions.length > 0 && <Section title="Open questions"><ul className="list-disc pl-4 text-[12px]">{n.openQuestions.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>}
          </div>
          <div className="flex flex-col gap-4">
            <Section title="People">
              {n.participants.length === 0 ? <p className="text-[12px] text-muted">Nobody else was identified.</p> : n.participants.map((p, i) => (
                <div key={i} className="border-t border-line py-2 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-semibold">{p.name}{p.title || p.company ? <span className="font-normal text-muted">, {[p.title, p.company].filter(Boolean).join(" at ")}</span> : null}</span>
                    <span className="text-[10.5px] text-muted">{INTEREST_LABEL[p.interest]} · {sentimentWord(p.sentiment)}</span>
                  </div>
                  {p.signals.length > 0 && <ul className="mt-1 list-disc pl-4 text-[11.5px]">{p.signals.map((s, j) => <li key={j}>{s}</li>)}</ul>}
                  {p.facts.length > 0 && <p className="mt-1 text-[11px] text-muted"><span className="font-semibold">New facts:</span> {p.facts.join("; ")}</p>}
                </div>
              ))}
            </Section>
          </div>
        </div>
      )}

      <Section title={`Proposed updates${pendingUpdates.length ? ` (${pendingUpdates.length})` : ""}`}>
        <p className="mb-2 text-[11px] text-muted">Nothing here changes your deals or contacts until you accept it. Accepted and rejected ones stay listed below.</p>
        {pendingUpdates.length === 0 && <p className="text-[12px] text-muted">{n ? "Nothing to review." : "Updates are proposed when the notes are written."}</p>}
        <div className="flex flex-col gap-2">
          {pendingUpdates.map((u) => (
            <article key={u.id} className="ctl border border-line bg-bg/50 p-2.5">
              <h4 className="text-[12.5px] font-semibold">{u.title}</h4>
              {u.reasoning && <p className="mt-0.5 text-[11.5px] text-muted">{u.reasoning}</p>}
              {u.uncertainties.length > 0 && <ul className="mt-1 list-inside list-disc text-[11px] text-info">{u.uncertainties.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {u.kind === "add_contact" && <input type="email" value={emails[u.id] ?? ""} onChange={(e) => setEmails({ ...emails, [u.id]: e.target.value })} placeholder="their@email.com" className={input} />}
                <button type="button" onClick={() => act(u, true)} disabled={!!ctx.busy || (u.kind === "add_contact" && !(emails[u.id] ?? "").includes("@"))} className={btn.primary}>{ctx.busy === `upd-${u.id}` ? "Working…" : APPROVE[u.kind] ?? "Accept"}</button>
                <button type="button" onClick={() => act(u, false)} disabled={!!ctx.busy} className={btn.link}>{u.kind === "review_contact" ? "Remove them" : "Reject"}</button>
              </div>
            </article>
          ))}
          {decided.length > 0 && <ul className="mt-1 text-[11px] text-muted">{decided.map((u) => <li key={u.id}>{u.status === "done" ? "Accepted" : "Rejected"}: {u.title}</li>)}</ul>}
        </div>
      </Section>

      {d.drafts.length > 0 && (
        <Section title="Follow-ups">
          <p className="mb-2 text-[11px] text-muted">Drafts in your review queue. They are never sent on their own; check names, numbers and dates against the transcript first.</p>
          {d.drafts.map((x) => (
            <div key={x.id} className="border-t border-line py-2 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><span className="text-[12px] font-semibold">{x.subject}</span><span className="text-[10.5px] text-muted">to {x.toAddresses.map((a) => a.name || a.address).join(", ")} · {x.status}</span></div>
              <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[11.5px] text-muted">{x.body}</p>
            </div>
          ))}
          <button type="button" onClick={onDrafted} className={`${btn.ghost} mt-1`}>Open the review queue</button>
        </Section>
      )}

      <Section title="Who and what it was about">
        <div className="flex flex-wrap gap-1.5">
          {d.contacts.map((c) => (
            <span key={c.id} className="ctl inline-flex items-center gap-1.5 border border-line px-2 py-1 text-[11.5px]" title={HOW[c.how] ?? c.how}>
              <Icon name="Users" className="h-3 w-3 text-muted" />{c.name || c.email}{c.needsReview && <span className="text-[10px] text-info">needs review</span>}
              <button type="button" onClick={() => link({ removeContactId: c.id }, "Unlinked.")} className="text-muted hover:text-neg" aria-label={`Unlink ${c.name || c.email}`}><Icon name="X" className="h-3 w-3" /></button>
            </span>
          ))}
          {d.deals.map((x) => <span key={x.id} className="ctl inline-flex items-center gap-1.5 border border-line px-2 py-1 text-[11.5px]"><Icon name="Handshake" className="h-3 w-3 text-muted" />{x.name} <span className="text-muted">· {STAGE_LABEL[x.stage as Stage] ?? x.stage}</span></span>)}
          {d.contacts.length + d.deals.length === 0 && <span className="text-[12px] text-muted">Nobody linked yet.</span>}
          <button type="button" onClick={() => setPicking(picking ? null : { q: "", found: null })} className={btn.ghost}><Icon name="Plus" className="mr-1 inline h-3 w-3" />Add a contact or deal</button>
        </div>
        {m.participants.filter((p) => !p.self && !p.contactId).length > 0 && (
          <p className="mt-2 text-[11px] text-muted">Not linked: {m.participants.filter((p) => !p.self && !p.contactId).map((p) => p.name || p.email).join(", ")}.</p>
        )}
        {picking && (
          <div className="mt-2 ctl border border-line bg-bg/50 p-2.5">
            <input autoFocus value={picking.q} onChange={(e) => setPicking({ ...picking, q: e.target.value })} placeholder="Search contacts and deals" className={`${input} w-full max-w-[320px]`} />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {picking.found?.contacts.map((c) => <button key={`c${c.id}`} type="button" onClick={() => link({ contactIds: [c.id] }, "Linked.")} className={btn.ghost}>{c.name || c.email}{c.company ? ` · ${c.company}` : ""}</button>)}
              {picking.found?.deals.map((x) => <button key={`d${x.id}`} type="button" onClick={() => link({ dealIds: [x.id] }, "Linked.")} className={btn.ghost}><Icon name="Handshake" className="mr-1 inline h-3 w-3" />{x.name}</button>)}
            </div>
          </div>
        )}
      </Section>

      <Section title="Ask about this meeting">
        <div className="flex flex-wrap gap-2">
          <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && question.trim()) ask(); }} placeholder="What did they say about pricing?" className={`${input} min-w-[260px] flex-1`} />
          <button type="button" onClick={ask} disabled={!!ctx.busy || !question.trim() || !d.transcript.length} className={btn.primary}>{ctx.busy === "ask" ? "Reading…" : "Ask"}</button>
        </div>
        {answer && (
          <div className="mt-2 text-[12px]">
            <p>{answer.answer}</p>
            {answer.quotes.map((q, i) => <p key={i} className="mt-1 border-l-2 border-accent/50 pl-2 text-[11.5px] text-muted">[{q.at}] {q.speaker}: “{q.text}”</p>)}
          </div>
        )}
      </Section>

      <Section title="Transcript">
        {m.purgedAt ? <p className="text-[12px] text-muted">Deleted under your retention setting. The notes stay.</p>
          : d.transcript.length === 0 ? <p className="text-[12px] text-muted">{m.status === "live" || m.status === "joining" ? "Nothing yet." : "Nothing was transcribed."}</p>
            : (
              <div className="flex flex-col gap-1.5">
                {transcript.map((s, i) => (
                  <p key={i} className="text-[12px] leading-relaxed">
                    <span className="num mr-2 text-[10.5px] text-muted">{clock(s.start)}</span>
                    <span className={`mr-1.5 font-semibold ${s.speaker === "You" ? "text-accent" : ""}`}>{s.speaker || "Speaker"}</span>{s.text}
                  </p>
                ))}
                {d.transcript.length > transcript.length && <button type="button" onClick={() => setShowAll(true)} className={btn.link}>Show all {d.transcript.length} turns</button>}
              </div>
            )}
      </Section>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return <button type="button" onClick={onBack} className={`${btn.link} self-start`}>← All meetings</button>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="ctl border border-line bg-elevated/30 p-3.5">
      <h3 className="mb-2 text-[12.5px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}
