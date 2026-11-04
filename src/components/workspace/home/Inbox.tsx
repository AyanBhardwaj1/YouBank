"use client";

/**
 * Home's "Waiting for you": the desk inbox. Everything the agents left for the person to decide, most
 * pressing first, each decided right here: answer the agent's question, read a draft and send or discard
 * it (or stop autopilot sending it), approve or dismiss a suggested follow-up, open or clear an alert.
 * Each decision goes to the endpoint that owns the item (src/lib/desk/inbox.ts), so sending still teaches
 * the agent and approving a suggestion still only makes a draft. The item leaves the list at once and
 * comes back, with the reason, if the server says no.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { confirmDialog } from "@/components/ui/Dialog";
import { fetchJson, errorMessage } from "@/lib/client/errors";
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { inboxHref, inboxOrder, inboxRequest, verbsFor, type InboxItem, type InboxKind, type InboxVerb } from "@/lib/desk/inbox";

type Data = { items: InboxItem[]; counts: Record<InboxKind, number> };

const KIND: Record<InboxKind, { icon: string; one: string; many: string }> = {
  question: { icon: "HelpCircle", one: "question", many: "questions" },
  draft: { icon: "Mail", one: "draft", many: "drafts" },
  action: { icon: "Lightbulb", one: "follow-up", many: "follow-ups" },
  alert: { icon: "Bell", one: "alert", many: "alerts" },
};
const VERB: Record<InboxVerb, string> = { send: "Send", discard: "Discard", unschedule: "Stop autopilot", answer: "Answer", dismiss: "Dismiss", approve: "Approve", read: "Mark read" };
const DONE: Partial<Record<InboxVerb, string>> = { send: "Sent.", discard: "Discarded.", unschedule: "Autopilot will not send it. It is waiting for you in Relationships.", answer: "Answered. The agent will use it from now on.", dismiss: "Dismissed.", read: "Marked read." };

function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 90) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
const at = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function InboxWidget({ roomy }: { roomy?: boolean }) {
  const [d, setD] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [all, setAll] = useState(false);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "err" } | null>(null);

  const load = useCallback(() => {
    fetchJson<Data>("/api/desk/inbox").then((x) => { setD(x); setFailed(false); }).catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (item: InboxItem, verb: InboxVerb, input: { answer?: string; email?: string } = {}) => {
    const req = inboxRequest(item, verb, input);
    if (!req) return;
    if (verb === "send" && item.sensitive && !(await confirmDialog({ title: "Send this sensitive email?", body: "The agent marked it sensitive. Read it once more before it goes.", confirmLabel: "Send" }))) return;
    if (verb === "discard" && !(await confirmDialog({ title: "Discard this draft?", body: "It will not be sent, and the agent learns you did not want it.", confirmLabel: "Discard", tone: "danger" }))) return;
    // Leaves the list at once; comes back (alone: other decisions made meanwhile stand) if the server says no.
    setD((cur) => cur && { items: cur.items.filter((x) => x.key !== item.key), counts: { ...cur.counts, [item.kind]: Math.max(0, cur.counts[item.kind] - 1) } });
    setNote(null);
    try {
      const res = await fetchJson<{ message?: string }>(req.url, { method: req.method, headers: req.body ? { "content-type": "application/json" } : undefined, body: req.body ? JSON.stringify(req.body) : undefined });
      setNote({ text: (verb === "approve" && typeof res?.message === "string" && res.message) || DONE[verb] || "Done.", tone: "ok" });
    } catch (e) {
      setD((cur) => cur && (cur.items.some((x) => x.key === item.key) ? cur : { items: inboxOrder([...cur.items, item]), counts: { ...cur.counts, [item.kind]: cur.counts[item.kind] + 1 } }));
      setNote({ text: errorMessage(e), tone: "err" });
    }
  };

  const items = d?.items ?? [];
  const shown = all ? items : items.slice(0, roomy ? 4 : 5);
  const counts = d ? (Object.keys(KIND) as InboxKind[]).filter((k) => d.counts[k] > 0) : [];
  const text = roomy ? "text-[13px]" : "text-[12px]";

  return (
    <section className={roomy ? "home-card p-5" : "panel p-3"} aria-label={WIDGET_LABEL.waiting}>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className={roomy ? "text-[14px] font-semibold text-fg" : "text-[11px] uppercase tracking-wider text-muted"}>{WIDGET_LABEL.waiting}</h2>
        {counts.length > 0 && (
          <span className="flex flex-wrap gap-x-2 text-[11px] text-muted">
            {counts.map((k) => <span key={k}><span className="num font-semibold text-fg">{d!.counts[k]}</span> {d!.counts[k] === 1 ? KIND[k].one : KIND[k].many}</span>)}
          </span>
        )}
      </div>
      {!d && !failed && <div className="shimmer h-14 ctl" />}
      {failed && !d && <p className="text-[11.5px] text-muted">This could not be loaded just now. <button type="button" onClick={load} className="text-fg underline-offset-2 hover:underline">Try again</button></p>}
      {note && <p role="status" className={`mb-2 ctl px-2 py-1.5 text-[11.5px] ${note.tone === "ok" ? "bg-pos/10 text-pos" : "bg-neg/10 text-neg"}`}>{note.text}</p>}
      {d && items.length === 0 && (
        <div className={`flex items-center gap-2.5 ${text} text-muted`}>
          <Icon name="Check" className="h-4 w-4 text-pos" />
          <span>Nothing is waiting for you. When the agents need a decision, it lands here.</span>
        </div>
      )}
      <ul className="space-y-1.5">
        {shown.map((i) => <Row key={i.key} item={i} roomy={roomy} onAct={act} />)}
      </ul>
      {items.length > shown.length && <button type="button" onClick={() => setAll(true)} className="mt-2 text-[11.5px] text-muted hover:text-fg">Show {items.length - shown.length} more</button>}
    </section>
  );
}

function Row({ item: i, roomy, onAct }: { item: InboxItem; roomy?: boolean; onAct: (i: InboxItem, v: InboxVerb, input?: { answer?: string; email?: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState("");
  const [email, setEmail] = useState("");
  const verbs = verbsFor(i);
  const soon = i.kind === "draft" && i.scheduledFor;
  const btn = "ctl px-2 py-1 text-[11.5px] transition disabled:opacity-40";
  const primary = `${btn} bg-accent font-semibold text-accent-fg hover:brightness-110`;
  const quiet = `${btn} border border-line text-muted hover:text-fg`;
  return (
    <li className={`ctl border ${soon ? "border-accent/60" : "border-line"} bg-bg/40 px-2.5 py-2`}>
      <div className="flex items-start gap-2.5">
        <Icon name={KIND[i.kind].icon} className={`mt-0.5 h-4 w-4 shrink-0 ${i.urgent || soon ? "text-accent" : "text-muted"}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className={`min-w-0 flex-1 truncate text-left font-medium text-fg ${roomy ? "text-[13.5px]" : "text-[12.5px]"}`}>{i.title}</button>
            <span className="shrink-0 text-[10.5px] text-faint">{ago(i.at)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
            {i.kind === "draft" && i.to && <span className="truncate">to {i.to}</span>}
            {soon && <span className="text-accent">Autopilot sends it at {at(i.scheduledFor!)}</span>}
            {i.held && <span className="rounded bg-accent-soft px-1 text-accent">held by autopilot</span>}
            {i.sensitive && <span className="rounded bg-neg/10 px-1 text-neg">sensitive</span>}
            {i.detail && !open && <span className="min-w-0 truncate">{i.detail}</span>}
          </div>

          {open && i.detail && <p className="mt-1.5 text-[11.5px] text-muted">{i.detail}</p>}
          {open && i.kind === "draft" && i.body && <div className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap ctl border border-line bg-panel px-2.5 py-2 text-[12px] leading-relaxed text-fg">{i.body}</div>}

          {i.kind === "question" && (
            <form className="mt-2 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); onAct(i, "answer", { answer }); }}>
              <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer. The agent remembers it." aria-label={`Answer: ${i.title}`}
                className="ctl min-w-0 flex-1 border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent" />
              <button type="submit" disabled={!answer.trim()} className={primary}>{VERB.answer}</button>
              <button type="button" onClick={() => onAct(i, "dismiss")} className={quiet}>{VERB.dismiss}</button>
            </form>
          )}

          {i.kind === "action" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {i.needsEmail && <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder={`${i.name ? `${i.name}'s` : "Their"} email`} aria-label="Email address"
                className="ctl min-w-0 flex-1 border border-line bg-panel px-2 py-1 text-[12px] text-fg outline-none placeholder:text-faint focus:border-accent" />}
              <button type="button" disabled={!inboxRequest(i, "approve", { email })} onClick={() => onAct(i, "approve", { email })} className={primary}>{VERB.approve}</button>
              <button type="button" onClick={() => onAct(i, "dismiss")} className={quiet}>{VERB.dismiss}</button>
            </div>
          )}

          {i.kind === "draft" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {verbs.includes("unschedule") && <button type="button" onClick={() => onAct(i, "unschedule")} className={`${btn} border border-accent/60 text-accent hover:bg-accent-soft`}><Icon name="Hand" className="mr-1 inline h-3 w-3" />{VERB.unschedule}</button>}
              {open
                ? <button type="button" onClick={() => onAct(i, "send")} className={primary}><Icon name="Send" className="mr-1 inline h-3 w-3" />{VERB.send}</button>
                : <button type="button" onClick={() => setOpen(true)} className={primary}>Read it</button>}
              <Link href={inboxHref(i)} className={quiet}>Edit</Link>
              <button type="button" onClick={() => onAct(i, "discard")} className={quiet}>{VERB.discard}</button>
            </div>
          )}

          {i.kind === "alert" && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Link href={inboxHref(i)} onClick={() => onAct(i, "read")} className={primary}>Open</Link>
              <button type="button" onClick={() => onAct(i, "read")} className={quiet}>{VERB.read}</button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
