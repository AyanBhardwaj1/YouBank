"use client";

/**
 * One meeting: when and where, the video link, who is coming (linked to their Relationships record),
 * the deals it touches, the prep brief, and Move / Cancel.
 *
 * The brief has two layers. What YouBank already knows (recent emails, deal stage, company and news)
 * loads with the panel and costs nothing. The AI brief is written only when the person presses the
 * button, and only on a plan that includes it.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import type { AiBrief, AssembledBrief } from "@/lib/calendar/briefs";
import { useFeature } from "@/lib/client/plan";
import { btn, calApi, fmt, relative, type Meeting } from "./shared";

type BriefResponse = { assembled: AssembledBrief; ai: { content: AiBrief; createdAt: string; trigger: string } | null };

const RESPONSE_LABEL: Record<string, string> = { accepted: "accepted", declined: "declined", tentative: "maybe", needsAction: "no reply yet" };

export function EventPanel({ meeting, tz, color, onClose, onMove, onChanged }: {
  meeting: Meeting; tz: string; color: string; onClose: () => void; onMove: (m: Meeting) => void; onChanged: (message: string) => void;
}) {
  const [brief, setBrief] = useState<BriefResponse | null>(null);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const aiUnlocked = useFeature("calendar.ai_brief");
  const start = Date.parse(meeting.start), end = Date.parse(meeting.end);

  useEffect(() => {
    // Keyed on the meeting by the parent, so a different meeting starts from fresh state.
    let live = true;
    calApi<BriefResponse>(`/api/calendar/events/${meeting.id}/brief`).then((b) => { if (live) setBrief(b); }, (e: Error) => { if (live) setBriefError(e.message); });
    return () => { live = false; };
  }, [meeting.id]);

  const writeBrief = async () => {
    setBusy("brief"); setBriefError(null);
    try {
      const r = await calApi<{ ai: BriefResponse["ai"] }>(`/api/calendar/events/${meeting.id}/brief`, { method: "POST" });
      setBrief((b) => (b ? { ...b, ai: r.ai } : b));
    } catch (e) {
      setBriefError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    const series = meeting.recurring && await confirmDialog({ title: "Cancel the whole series?", body: "This meeting repeats. Choose Cancel series to remove every occurrence, or Just this one.", confirmLabel: "Cancel series", cancelLabel: "Just this one", tone: "danger" });
    const others = meeting.attendees.filter((a) => !a.self).length;
    const ok = await confirmDialog({
      title: `Cancel "${meeting.title}"${series ? " and every meeting in its series" : ""}?`,
      body: others ? "Attendees are sent a cancellation from your calendar." : "It is removed from your calendar.",
      confirmLabel: "Cancel meeting", cancelLabel: "Keep it", tone: "danger",
    });
    if (!ok) return;
    setBusy("cancel"); setError(null);
    try {
      await calApi(`/api/calendar/events/${meeting.id}?scope=${series ? "series" : "instance"}&notify=1`, { method: "DELETE" });
      onChanged("Cancelled."); onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const ai = brief?.ai?.content;
  const a = brief?.assembled;
  return (
    <aside className="fixed inset-x-0 bottom-0 z-40 max-h-[85vh] overflow-auto rounded-t-xl border border-line bg-panel p-4 shadow-xl sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:border-y-0 sm:border-r-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-start gap-2 text-[15px] font-semibold leading-snug"><span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />{meeting.title}</h2>
          <p className="mt-1 text-[12px] text-muted">
            {meeting.allDay ? fmt.long(start, "UTC") : <>{fmt.long(start, tz)} · {fmt.time(start, tz)} to {fmt.time(end, tz)} <span className="text-faint">({relative(start)})</span></>}
          </p>
          <p className="text-[11px] text-muted">{meeting.calendarName}{meeting.recurring ? " · repeats" : ""}{meeting.status === "tentative" ? " · tentative" : ""}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-fg"><Icon name="X" className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {meeting.videoUrl && <a href={meeting.videoUrl} target="_blank" rel="noreferrer" className={btn.accent}><Icon name="Video" className="mr-1 inline h-3.5 w-3.5" />Join {meeting.videoProvider}</a>}
        {meeting.canWrite && <button type="button" onClick={() => onMove(meeting)} disabled={!!busy} className={btn.ghost}>Move</button>}
        {meeting.canWrite && <button type="button" onClick={cancel} disabled={!!busy} className={btn.danger}>{busy === "cancel" ? "Cancelling…" : "Cancel meeting"}</button>}
        {meeting.htmlLink && <a href={meeting.htmlLink} target="_blank" rel="noreferrer" className={btn.link}><Icon name="ExternalLink" className="mr-1 inline h-3 w-3" />Open in {meeting.provider === "google" ? "Google" : meeting.provider === "microsoft" ? "Outlook" : "calendar"}</a>}
      </div>
      {error && <p className="mt-2 ctl border border-neg/40 bg-neg/5 px-3 py-2 text-[12px] text-neg">{error}</p>}

      {meeting.location && !meeting.location.startsWith("http") && <p className="mt-3 flex items-start gap-1.5 text-[12px]"><Icon name="MapPin" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />{meeting.location}</p>}

      {meeting.deals.length > 0 && (
        <section className="mt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Deals</h3>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {meeting.deals.map((d) => <Link key={d.id} href="/app/crm?tab=pipeline" className="ctl bg-accent-soft px-2 py-0.5 text-[11.5px] text-accent">{d.name} · {a?.deals.find((x) => x.id === d.id)?.stage ?? d.stage}</Link>)}
          </div>
        </section>
      )}

      <section className="mt-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">People</h3>
        <ul className="mt-1.5 space-y-1">
          {[...(meeting.organizer && !meeting.attendees.some((x) => x.email === meeting.organizer?.email) ? [{ ...meeting.organizer, contactId: null as number | null }] : []), ...meeting.attendees].slice(0, 30).map((p) => (
            <li key={p.email} className="flex flex-wrap items-baseline gap-1.5 text-[12px]">
              <span className={p.self ? "text-muted" : ""}>{p.name || p.email}</span>
              {p.name && <span className="text-[10.5px] text-faint">{p.email}</span>}
              {p.organizer && <span className="text-[10.5px] text-muted">organiser</span>}
              {!p.organizer && RESPONSE_LABEL[p.response] && <span className={`text-[10.5px] ${p.response === "declined" ? "text-neg" : p.response === "accepted" ? "text-pos" : "text-muted"}`}>{RESPONSE_LABEL[p.response]}</span>}
              {p.contactId && <Link href="/app/crm?tab=contacts" className="text-[10.5px] text-accent hover:underline">in Relationships</Link>}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-5 border-t border-line pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Prep brief</h3>
          <span className="flex items-center gap-2">
            <PremiumBadge feature="calendar.ai_brief" />
            <button type="button" onClick={writeBrief} disabled={!!busy || !a || aiUnlocked === false} className={btn.primary} title={aiUnlocked === false ? "AI briefs are part of the Pro plan" : undefined}>
              <Icon name="Sparkles" className="mr-1 inline h-3 w-3" />{busy === "brief" ? "Writing…" : ai ? "Write it again" : "Write the AI brief"}
            </button>
          </span>
        </div>
        {aiUnlocked === false && <p className="mt-1 text-[11px] text-muted">The AI brief is part of the Pro plan. What YouBank already knows is below, free. <Link href="/app/settings?tab=plan" className="text-accent hover:underline">See plans</Link></p>}
        {briefError && <p className="mt-2 text-[12px] text-neg">{briefError}</p>}

        {ai && (
          <div className="mt-3 ctl border border-accent/30 bg-accent-soft/40 p-3 text-[12px] leading-relaxed">
            <p>{ai.summary}</p>
            {([["Aim for", ai.objectives], ["Raise", ai.talkingPoints], ["Ask", ai.questions], ["Watch for", ai.watchOuts]] as const).map(([label, items]) => items.length ? (
              <div key={label} className="mt-2"><div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted">{label}</div>
                <ul className="mt-0.5 list-disc space-y-0.5 pl-4">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            ) : null)}
            {brief?.ai && <p className="mt-2 text-[10.5px] text-muted">Written {brief.ai.trigger === "morning" ? "by your morning run" : "on request"}, {fmt.day(Date.parse(brief.ai.createdAt), tz)} {fmt.time(Date.parse(brief.ai.createdAt), tz)}. Check anything that matters.</p>}
          </div>
        )}

        {!a && !briefError && <p className="mt-2 text-[11.5px] text-muted">Gathering what YouBank knows…</p>}
        {a && (
          <div className="mt-3 space-y-3 text-[12px]">
            {a.people.length === 0 && <p className="text-muted">No one outside your organisation is invited.</p>}
            {a.people.map((p) => (
              <div key={p.email}>
                <div className="font-semibold">{p.name}{p.title || p.company ? <span className="font-normal text-muted">, {[p.title, p.company].filter(Boolean).join(" at ")}</span> : null}</div>
                {p.notes && <p className="text-[11.5px] text-muted">Notes: {p.notes}</p>}
                {p.recentEmails.length > 0
                  ? <ul className="mt-1 space-y-0.5">{p.recentEmails.slice(0, 3).map((e, i) => <li key={i} className="text-[11.5px]"><span className="text-faint">{e.date} {e.direction === "outbound" ? "you wrote" : "they wrote"}:</span> {e.subject || "(no subject)"}<span className="text-muted"> — {e.snippet.slice(0, 140)}</span></li>)}</ul>
                  : <p className="text-[11.5px] text-muted">No emails with them in Relationships.</p>}
                {p.talkingPoints.length > 0 && <p className="mt-0.5 text-[11.5px]"><span className="text-muted">They engage with:</span> {p.talkingPoints.slice(0, 3).join("; ")}</p>}
                {p.signals.map((s, i) => <p key={i} className="text-[11.5px]"><Icon name="TrendingUp" className="mr-1 inline h-3 w-3 text-pos" />{s.title}</p>)}
              </div>
            ))}
            {a.companies.map((c) => (
              <div key={c.domain}>
                <div className="font-semibold">{c.name} <span className="font-normal text-faint">{c.domain}</span></div>
                {c.directory && <p className="text-[11.5px] text-muted">{[c.directory.oneLiner, c.directory.stage, c.directory.raised && `raised ${c.directory.raised}`, c.directory.location].filter(Boolean).join(" · ")}</p>}
                {c.listing && <Link href={c.listing.terminalUrl} className="text-[11.5px] text-accent hover:underline">{c.listing.ticker} in the terminal</Link>}
                {c.news.map((n, i) => <p key={i} className="text-[11.5px]"><Link href={n.url} className="hover:underline"><Icon name="Newspaper" className="mr-1 inline h-3 w-3 text-muted" />{n.headline}</Link> <span className="text-faint">{n.date}</span></p>)}
              </div>
            ))}
            {a.deals.map((d) => <p key={d.id} className="text-[11.5px]"><span className="font-semibold">{d.name}</span>: {d.stage}{d.nextStep ? `. Next: ${d.nextStep}` : ""}{d.nextStepDue ? ` (due ${d.nextStepDue})` : ""}</p>)}
            {a.previousMeetings.length > 0 && <p className="text-[11.5px] text-muted">Last met: {a.previousMeetings.map((p) => `${p.title} (${p.date})`).join("; ")}</p>}
          </div>
        )}
      </section>

      {meeting.description && (
        <section className="mt-5 border-t border-line pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Invitation</h3>
          <p className="mt-1 whitespace-pre-wrap break-words text-[11.5px] text-muted">{meeting.description.slice(0, 2000)}</p>
        </section>
      )}
    </aside>
  );
}
