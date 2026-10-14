"use client";

/**
 * Meetings inside Relationships: "next meeting" and "last met" on contacts and deals, and a Schedule
 * button that opens the scheduler with the person already invited. One request serves a whole list.
 */
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Scheduler, type SchedulePrefill } from "./Scheduler";
import { browserTz, calApi, fmt } from "./shared";

export type MeetingSummary = { lastMet: string | null; nextMeeting: { id: number; title: string; start: string } | null; upcoming: number };
type Summaries = { contacts: Record<number, MeetingSummary>; deals: Record<number, MeetingSummary> };

/** Last-met and next-meeting for every linked contact and deal; reloads when `tick` changes. */
export function useMeetingSummaries(tick = 0): Summaries | null {
  const [s, setS] = useState<Summaries | null>(null);
  useEffect(() => {
    let live = true;
    calApi<Summaries>("/api/calendar/people").then((r) => { if (live) setS(r); }, () => { if (live) setS({ contacts: {}, deals: {} }); });
    return () => { live = false; };
  }, [tick]);
  return s;
}

/** "Next: Tue 7 Oct 10:00 (Intro call) · last met 12 Sep". Nothing when there is nothing to say. */
export function MeetingLine({ summary }: { summary: MeetingSummary | undefined }) {
  if (!summary || (!summary.lastMet && !summary.nextMeeting)) return null;
  const tz = browserTz();
  const next = summary.nextMeeting;
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
      <Icon name="Calendar" className="h-3 w-3" />
      {next && <a href="/app/calendar?view=agenda" className="text-fg hover:underline">Next: {fmt.day(Date.parse(next.start), tz)} {fmt.time(Date.parse(next.start), tz)} <span className="text-muted">({next.title})</span></a>}
      {summary.upcoming > 1 && <span>+{summary.upcoming - 1} more</span>}
      {summary.lastMet && <span>last met {fmt.day(Date.parse(summary.lastMet), tz)}</span>}
    </p>
  );
}

/** A Schedule button with its own scheduler; `prefill` invites the contact and names the meeting. */
export function ScheduleButton({ prefill, className, label = "Schedule a meeting", onBooked }: { prefill: SchedulePrefill; className?: string; label?: string; onBooked?: (message: string) => void }) {
  // Frozen when opened: the parent re-renders with a fresh object, which must not reset the form.
  const [open, setOpen] = useState<SchedulePrefill | null>(null);
  return (
    <>
      <button type="button" onClick={() => setOpen(prefill)} className={className ?? "text-[11.5px] text-muted transition hover:text-fg"}>
        <Icon name="Calendar" className="mr-1 inline h-3 w-3" />{label}
      </button>
      {open && <Scheduler open prefill={open} onClose={() => setOpen(null)} onDone={(m) => onBooked?.(m)} />}
    </>
  );
}
