"use client";

import { useEffect, useState } from "react";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { PLATFORM_LABEL, STATUS_LABEL, durationLabel, isPlatform, type MeetingSettings, type MeetingStatus } from "@/lib/meetings/model";
import { MeetingDetail } from "./MeetingDetail";
import { MeetingSettingsForm } from "./MeetingSettings";
import { Empty, ago, api, btn, input, type PanelCtx } from "./shared";

type Row = {
  id: number; title: string; platform: string; source: string; status: string; startedAt: string; durationSec: number;
  participants: { name: string; contactId?: number | null; self?: boolean }[]; notesAt: string | null; error: string; summary: string | null;
};
export type MeetingAccess = {
  settings: MeetingSettings;
  features: Record<string, boolean>;
  notes: { allowed: boolean; used: number; free: number; unlimited: boolean };
  capture: boolean; bot: boolean; speakers: boolean;
};
type List = MeetingAccess & { meetings: Row[] };

const TONE: Record<string, string> = {
  ready: "bg-pos/15 text-pos", processing: "bg-info/15 text-info", live: "bg-neg/15 text-neg", joining: "bg-info/15 text-info", failed: "bg-neg/15 text-neg", cancelled: "bg-elevated text-muted",
};

/** Keep the open meeting in the address, so the page can be shared and the desktop app can link to it. */
function remember(id: number | null) {
  const u = new URL(window.location.href);
  u.searchParams.set("tab", "meetings");
  if (id) u.searchParams.set("meeting", String(id)); else u.searchParams.delete("meeting");
  window.history.replaceState(null, "", u.toString());
}

/**
 * Meetings the copilot listened to, with their notes. A meeting is captured by the desktop app (free)
 * or by the notetaker bot sent here (premium); either way its notes and proposed CRM changes land here.
 */
export function MeetingsPanel({ ctx, initialMeeting, onDrafted }: { ctx: PanelCtx; initialMeeting: number | null; onDrafted: () => void }) {
  const [list, setList] = useState<List | null>(null);
  const [open, setOpen] = useState<number | null>(initialMeeting);
  const [sending, setSending] = useState<{ url: string; title: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<List>("/api/meetings").then((l) => { if (!cancelled) setList(l); }).catch((e) => { if (!cancelled) ctx.say(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.tick]);

  // While something is happening (a notetaker in a call, notes being written), keep the list current.
  const busyMeeting = list?.meetings.some((m) => ["joining", "live", "processing"].includes(m.status));
  useEffect(() => {
    if (!busyMeeting || open) return;
    const id = window.setInterval(() => { if (document.visibilityState === "visible") api<List>("/api/meetings").then(setList).catch(() => {}); }, 20_000);
    return () => window.clearInterval(id);
  }, [busyMeeting, open]);

  const show = (id: number | null) => { setOpen(id); remember(id); };

  const send = () => ctx.run("send-bot", async () => {
    if (!sending) return;
    const r = await api<{ meeting: { id: number } }>("/api/meetings", { method: "POST", body: JSON.stringify({ meetingUrl: sending.url, title: sending.title }) });
    setSending(null);
    ctx.say("The notetaker is on its way. It asks to join; admit it from the meeting's waiting room if asked.");
    ctx.refresh();
    show(r.meeting.id);
  });

  if (open) return <MeetingDetail ctx={ctx} id={open} access={list} onBack={() => { show(null); ctx.refresh(); }} onDrafted={onDrafted} />;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-[78ch] text-[12px] text-muted">
          The meeting copilot listens to your calls, from the YouBank desktop app or a notetaker you send, and files what it learns here: a summary,
          decisions, action items, how each person came across, and follow-ups. Changes to deals and contacts wait for you to accept them.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setSending(sending ? null : { url: "", title: "" })} className={btn.ghost}>
            <Icon name="Bot" className="mr-1 inline h-3.5 w-3.5" />Send the notetaker to a meeting
          </button>
          <button type="button" onClick={() => setSettingsOpen(!settingsOpen)} className={btn.ghost}>
            <Icon name="Settings" className="mr-1 inline h-3.5 w-3.5" />Copilot settings
          </button>
        </div>
      </div>

      {list && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted">
          <span>{list.capture ? `Desktop capture is free${list.speakers ? ", with speaker labels" : ""}.` : "Transcription is not set up on this YouBank yet."}</span>
          <span>
            {list.notes.unlimited ? "Notes for every meeting on your plan." : `${Math.max(0, list.notes.free - list.notes.used)} of ${list.notes.free} free meeting notes left this month.`}{" "}
            {!list.notes.unlimited && <PremiumBadge feature="meetings.notes" />}
          </span>
        </div>
      )}

      {settingsOpen && list && <MeetingSettingsForm ctx={ctx} settings={list.settings} botUnlocked={!!list.features["meetings.bot"]} onSaved={(s) => setList({ ...list, settings: s })} />}

      {sending && (
        <div className="ctl border border-line bg-elevated/40 p-3.5">
          <h3 className="flex items-center gap-2 text-[13px] font-semibold">Send the notetaker <PremiumBadge feature="meetings.bot" /></h3>
          <PremiumGate feature="meetings.bot">
            <p className="mt-1 max-w-[75ch] text-[11.5px] text-muted">
              It joins as a participant named “{list?.settings.botName ?? "YouBank Notetaker"}”, so everyone sees it, records, and transcribes with each speaker&apos;s name.
              It is billed per hour of meeting. Tell the others it is there: some places require everyone&apos;s consent to record.
            </p>
            {list && !list.bot && <p className="mt-1 text-[11.5px] text-neg">The notetaker service is not set up on this YouBank yet.</p>}
            <div className="mt-2.5 grid gap-1.5 sm:grid-cols-[2fr_1fr]">
              <input value={sending.url} onChange={(e) => setSending({ ...sending, url: e.target.value })} placeholder="https://zoom.us/j/… or a Teams, Meet or Webex link" className={input} />
              <input value={sending.title} onChange={(e) => setSending({ ...sending, title: e.target.value })} placeholder="Title (optional)" className={input} />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={send} disabled={!!ctx.busy || !sending.url.trim() || !list?.bot} className={btn.primary}>{ctx.busy === "send-bot" ? "Sending…" : "Send the notetaker to this meeting"}</button>
              <button type="button" onClick={() => setSending(null)} className={btn.link}>Cancel</button>
            </div>
          </PremiumGate>
        </div>
      )}

      {!list && <p className="text-[12px] text-muted">Loading…</p>}
      {list && list.meetings.length === 0 && (
        <Empty>No meetings yet. Start the copilot from the YouBank desktop app when a call begins (it offers to when it notices Zoom, Teams, Meet, Webex or a Slack huddle), or send the notetaker to a meeting link.</Empty>
      )}
      <div className="flex flex-col gap-2">
        {list?.meetings.map((m) => {
          const people = m.participants.filter((p) => !p.self).map((p) => p.name).filter(Boolean);
          return (
            <button key={m.id} type="button" onClick={() => show(m.id)} className="ctl border border-line bg-elevated/30 p-3 text-left transition hover:border-accent/50">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate text-[13px] font-semibold">{m.title || "Untitled meeting"}</h3>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {[isPlatform(m.platform) ? PLATFORM_LABEL[m.platform] : "", ago(m.startedAt), m.durationSec ? durationLabel(m.durationSec) : "", m.source === "bot" ? "notetaker" : "desktop"].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span className={`ctl px-1.5 py-0.5 text-[10px] ${TONE[m.status] ?? "bg-elevated text-muted"}`}>{STATUS_LABEL[m.status as MeetingStatus] ?? m.status}</span>
              </div>
              {people.length > 0 && <p className="mt-1 truncate text-[11.5px]"><span className="text-muted">With</span> {people.slice(0, 6).join(", ")}{people.length > 6 ? ` and ${people.length - 6} more` : ""}</p>}
              {m.summary && <p className="mt-1 line-clamp-2 text-[11.5px] text-muted">{m.summary}</p>}
              {!m.summary && m.error && <p className="mt-1 text-[11.5px] text-muted">{m.error}</p>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
