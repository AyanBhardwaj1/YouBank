"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { DRAFT_KIND_LABEL, type DraftKind } from "@/lib/crm/model";
import { Graduations } from "./EngineInsights";
import { Suggestions } from "./Suggestions";
import { Empty, Field, ago, api, btn, input, type PanelCtx } from "./shared";

export type Draft = {
  id: number; threadId: number | null; subject: string; body: string; rationale: string;
  citations: { label: string }[]; toAddresses: { name: string; address: string }[]; model: string; createdAt: string;
  kind: string; meta: { step?: number; audience?: string }; scheduledFor: string | null; holdReason: string;
  confidence: string; sensitive: boolean; sentBy: string; sentAt: string | null; lastError: string; status: string;
};
type Question = {
  id: number; question: string; context: string; createdAt: string;
  thread: { id: number; subject: string; summary: string; participants: { name: string; address: string }[] } | null;
};

const until = (iso: string) => {
  const mins = Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
  if (mins <= 0) return "any moment";
  if (mins < 60) return `in ${mins} min`;
  const h = Math.round(mins / 60);
  return h < 24 ? `in ${h} h` : new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
};

const CONFIDENCE_TONE: Record<string, string> = { high: "bg-pos/15 text-pos", medium: "bg-info/15 text-info", low: "bg-neg/15 text-neg" };

/**
 * Everything waiting on the person, in the order it needs them: questions only they can answer,
 * suggestions, what autopilot is about to send (still stoppable), what waits for approval, and a
 * record of what went out and who sent it.
 */
export function ReviewQueue({ ctx, drafts, canSend, autopilotOn }: { ctx: PanelCtx; drafts: Draft[]; canSend: boolean; autopilotOn: boolean }) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<number, { text: string; remember: boolean }>>({});
  const [sent, setSent] = useState<Draft[]>([]);
  const [editing, setEditing] = useState<{ id: number; subject: string; body: string } | null>(null);
  const [compose, setCompose] = useState<{ to: string; name: string; brief: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api<Question[]>("/api/crm/questions"), api<Draft[]>("/api/crm/drafts?status=sent")])
      .then(([q, s]) => { if (!cancelled) { setQuestions(q); setSent(s); } }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);

  const scheduled = drafts.filter((d) => d.scheduledFor).sort((a, b) => a.scheduledFor!.localeCompare(b.scheduledFor!));
  const waiting = drafts.filter((d) => !d.scheduledFor);

  const answer = (q: Question) => ctx.run(`q-${q.id}`, async () => {
    const a = answers[q.id] ?? { text: "", remember: true };
    const r = await api<{ remaining: number; scheduled: boolean; draft: unknown }>(`/api/crm/questions/${q.id}`, { method: "POST", body: JSON.stringify({ answer: a.text, remember: a.remember }) });
    setAnswers((x) => { const n = { ...x }; delete n[q.id]; return n; });
    ctx.say(r.remaining ? `Saved. ${r.remaining} more question${r.remaining === 1 ? "" : "s"} on this email.` : r.draft
      ? r.scheduled ? "Rewritten with your answer and scheduled; autopilot sends it in your sending hours." : "Rewritten with your answer. It is below, waiting for you."
      : "Saved.");
    ctx.refresh();
  });
  const skip = (q: Question) => ctx.run(`q-${q.id}`, async () => { await api(`/api/crm/questions/${q.id}`, { method: "DELETE" }); ctx.refresh(); });

  const send = (d: Draft) => ctx.run(`send-${d.id}`, async () => {
    const current = editing?.id === d.id ? editing : { subject: d.subject, body: d.body };
    if (!window.confirm(`Send this to ${d.toAddresses.map((a) => a.address).join(", ")} now?\n\nThis cannot be undone.`)) return;
    const r = await api<{ to: string[]; from: string }>(`/api/crm/drafts/${d.id}/send`, { method: "POST", body: JSON.stringify({ subject: current.subject, body: current.body }) });
    setEditing(null); ctx.say(`Sent to ${r.to.join(", ")} from ${r.from}`); ctx.refresh();
  });
  const stop = (d: Draft) => ctx.run(`stop-${d.id}`, async () => {
    await api(`/api/crm/drafts/${d.id}`, { method: "PATCH", body: JSON.stringify({ action: "unschedule" }) });
    ctx.say("Stopped. It waits for you now."); ctx.refresh();
  });
  const save = () => ctx.run("save", async () => {
    if (!editing) return;
    await api(`/api/crm/drafts/${editing.id}`, { method: "PATCH", body: JSON.stringify({ subject: editing.subject, body: editing.body }) });
    setEditing(null); ctx.say("Saved. Edited drafts wait for you to send them."); ctx.refresh();
  });
  const discard = (d: Draft) => ctx.run(`discard-${d.id}`, async () => {
    if (d.kind === "campaign" && !window.confirm("Discarding a campaign email takes this lead out of the sequence. Continue?")) return;
    await api(`/api/crm/drafts/${d.id}`, { method: "DELETE" });
    ctx.say(d.kind === "campaign" ? "Discarded, and the lead is out of the sequence." : "Draft discarded"); ctx.refresh();
  });
  const write = () => ctx.run("compose", async () => {
    if (!compose) return;
    await api("/api/crm/compose", { method: "POST", body: JSON.stringify(compose) });
    setCompose(null); ctx.say("Written. It is below, waiting for you."); ctx.refresh();
  });

  const card = (d: Draft, mode: "scheduled" | "waiting") => {
    const isEditing = editing?.id === d.id;
    return (
      <article key={d.id} className={`ctl border bg-elevated/30 p-3.5 ${mode === "scheduled" ? "border-accent/40" : "border-line"}`}>
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold">
            <span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
              {d.kind === "reply" && d.meta.audience === "internal" ? "Reply to coworker" : DRAFT_KIND_LABEL[d.kind as DraftKind] ?? d.kind}
              {d.kind === "campaign" && d.meta.step != null ? ` · step ${d.meta.step + 1}` : ""}
            </span>
            {d.confidence && <span className={`ctl px-1.5 py-0.5 text-[10px] ${CONFIDENCE_TONE[d.confidence] ?? "bg-elevated text-muted"}`}>{d.confidence} confidence</span>}
            {d.sensitive && <span className="ctl bg-neg/10 px-1.5 py-0.5 text-[10px] text-neg">sensitive</span>}
            {isEditing ? "Editing draft" : d.subject}
          </h3>
          <span className="num text-[10.5px] text-muted">to {d.toAddresses.map((a) => a.address).join(", ") || "—"} · {d.model}</span>
        </header>
        {mode === "scheduled" && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-accent">
            <Icon name="Timer" className="h-3.5 w-3.5" /> Autopilot sends this {until(d.scheduledFor!)} unless you stop it.
          </p>
        )}
        {mode === "waiting" && d.holdReason && (
          <p className="mt-1.5 ctl border border-info/30 bg-info/5 px-2.5 py-1.5 text-[11px] text-info">{d.holdReason}</p>
        )}
        {d.lastError && <p className="mt-1.5 text-[11px] text-neg">Last attempt failed: {d.lastError}</p>}
        {isEditing ? (
          <>
            <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} className={`mt-2 w-full ${input}`} />
            <textarea value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} rows={9} className={`mt-1.5 w-full ${input}`} />
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={save} disabled={!!ctx.busy} className={btn.primary}>Save</button>
              <button type="button" onClick={() => setEditing(null)} className={btn.link}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <pre className="mt-2 whitespace-pre-wrap ctl border border-line bg-bg/60 p-2.5 font-sans text-[12px] leading-relaxed">{d.body}</pre>
            {d.rationale && <p className="mt-2 text-[11px] text-muted"><span className="font-semibold">{d.kind === "campaign" ? "Personalisation:" : d.kind === "reply" ? "Why this reply:" : "Why:"}</span> {d.rationale}</p>}
            {d.citations.length > 0 && (
              <div className="mt-1.5 ctl border border-info/40 bg-info/5 px-2.5 py-1.5">
                <div className="text-[10.5px] font-semibold text-info">Decide before sending</div>
                <ul className="mt-0.5 list-inside list-disc text-[11px] text-muted">{d.citations.map((c, i) => <li key={i}>{c.label}</li>)}</ul>
              </div>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {canSend && <button type="button" disabled={!!ctx.busy} onClick={() => send(d)} className={btn.accent}>{ctx.busy === `send-${d.id}` ? "Sending…" : mode === "scheduled" ? "Send now" : "Send"}</button>}
              {mode === "scheduled" && <button type="button" disabled={!!ctx.busy} onClick={() => stop(d)} className={btn.ghost}>Stop autopilot</button>}
              {!canSend && (
                <button type="button" onClick={() => { void navigator.clipboard?.writeText(`Subject: ${d.subject}\n\n${d.body}`).then(() => ctx.say("Copied. Paste it into your mail client to send.")); }} className={btn.primary}>Copy to send</button>
              )}
              <button type="button" onClick={() => setEditing({ id: d.id, subject: d.subject, body: d.body })} className={btn.ghost}>Edit</button>
              <button type="button" disabled={!!ctx.busy} onClick={() => discard(d)} className={btn.danger}>{d.kind === "campaign" ? "Discard and skip lead" : "Discard"}</button>
            </div>
          </>
        )}
      </article>
    );
  };

  return (
    <div className="flex flex-col gap-5">
      {questions.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Icon name="MessageSquare" className="h-3.5 w-3.5 text-accent" /> The agent needs your input <span className="num font-normal text-muted">{questions.length}</span></h3>
          <p className="text-[11px] text-muted">It could not answer these on its own. Your answer finishes the email; keep “remember” ticked and it will know next time.</p>
          {questions.map((q) => {
            const a = answers[q.id] ?? { text: "", remember: true };
            return (
              <article key={q.id} className="ctl border border-accent/30 bg-accent-soft/40 p-3">
                <p className="text-[12.5px] font-semibold">{q.question}</p>
                {q.context && <p className="mt-0.5 text-[11px] text-muted">{q.context}</p>}
                {q.thread && <p className="mt-0.5 text-[10.5px] text-muted">In “{q.thread.subject || "(no subject)"}” with {q.thread.participants.slice(0, 2).map((p) => p.name || p.address).join(", ")}</p>}
                <textarea value={a.text} onChange={(e) => setAnswers({ ...answers, [q.id]: { ...a, text: e.target.value } })} rows={2} placeholder="Your answer, in a sentence or two" className={`mt-2 w-full ${input}`} />
                <div className="mt-1.5 flex flex-wrap items-center gap-3">
                  <button type="button" disabled={!!ctx.busy || !a.text.trim()} onClick={() => answer(q)} className={btn.primary}>{ctx.busy === `q-${q.id}` ? "Rewriting…" : "Answer"}</button>
                  <label className="flex items-center gap-1 text-[11px] text-muted">
                    <input type="checkbox" checked={a.remember} onChange={(e) => setAnswers({ ...answers, [q.id]: { ...a, remember: e.target.checked } })} /> Remember for next time
                  </label>
                  <button type="button" disabled={!!ctx.busy} onClick={() => skip(q)} className={btn.link}>Skip</button>
                </div>
              </article>
            );
          })}
        </section>
      )}

      <Graduations ctx={ctx} />
      <Suggestions ctx={ctx} onDrafted={() => undefined} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-[80ch] text-[11.5px] text-muted">
          {autopilotOn
            ? "Autopilot is on: emails it is confident about are scheduled below and go out in your sending hours unless you stop them. Everything else waits for you."
            : <>Autopilot is off, so <strong className="text-fg">nothing here has been sent</strong>. {canSend ? "Sending happens when you press Send." : "Connect a mailbox to send from here."}</>}
        </p>
        <button type="button" onClick={() => setCompose(compose ? null : { to: "", name: "", brief: "" })} className={btn.ghost}><Icon name="Plus" className="mr-1 inline h-3.5 w-3.5" />New email</button>
      </div>

      {compose && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="To"><input value={compose.to} onChange={(e) => setCompose({ ...compose, to: e.target.value })} placeholder="maya@ledgerline.io" className={input} /></Field>
            <Field label="Name (optional)"><input value={compose.name} onChange={(e) => setCompose({ ...compose, name: e.target.value })} className={input} /></Field>
          </div>
          <div className="mt-2">
            <Field label="What should it say?" hint="One or two sentences. The agent uses what YouBank knows about them, your playbook and your voice.">
              <textarea value={compose.brief} onChange={(e) => setCompose({ ...compose, brief: e.target.value })} rows={2} placeholder="Ask for a 20-minute call next week about piloting our reconciliation API with their finance team" className={input} />
            </Field>
          </div>
          <div className="mt-2.5 flex gap-2">
            <button type="button" onClick={write} disabled={!!ctx.busy || !compose.to.trim() || !compose.brief.trim()} className={btn.primary}>{ctx.busy === "compose" ? "Writing…" : "Write it"}</button>
            <button type="button" onClick={() => setCompose(null)} className={btn.link}>Cancel</button>
          </div>
        </div>
      )}

      {scheduled.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[12.5px] font-semibold">Going out on autopilot <span className="num font-normal text-muted">{scheduled.length}</span></h3>
          {scheduled.map((d) => card(d, "scheduled"))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[12.5px] font-semibold">Waiting for you <span className="num font-normal text-muted">{waiting.length}</span></h3>
        {waiting.length === 0 && <Empty>Nothing waiting. New drafts appear here as mail arrives, or press Run agent.</Empty>}
        {waiting.map((d) => card(d, "waiting"))}
      </section>

      {sent.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h3 className="text-[12.5px] font-semibold">Recently sent</h3>
          <ul className="flex flex-col gap-1">
            {sent.slice(0, 15).map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className={`ctl px-1.5 py-0.5 text-[10px] ${d.sentBy === "autopilot" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{d.sentBy === "autopilot" ? "Autopilot" : "You"}</span>
                <span className="min-w-0 flex-1 truncate">{d.subject}</span>
                <span className="text-muted">to {d.toAddresses[0]?.address} · {ago(d.sentAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
