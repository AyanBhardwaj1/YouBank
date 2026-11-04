"use client";

/**
 * Under Home's greeting: the day in one line, from what Home already knows (src/lib/desk/day-line.ts).
 * "3 decisions waiting · next: Acme diligence call at 2:00 PM · NVDA up 4.1%". Nothing until it has
 * something to say; time-dependent text waits for the browser's clock.
 */
import { useEffect, useMemo, useState } from "react";
import { useNow } from "@/components/ui/useNow";
import { useCompanies } from "@/lib/client/companies";
import { useWaiting } from "@/lib/client/waiting";
import { biggestMover, dayParts, type DayFacts } from "@/lib/desk/day-line";
import { useWorkspace } from "../WorkspaceProvider";

export function DayLine({ className = "" }: { className?: string }) {
  const { config } = useWorkspace();
  const waiting = useWaiting();
  const now = useNow();
  const [meeting, setMeeting] = useState<{ title: string; start: string; end: string } | null>(null);
  useEffect(() => {
    let live = true;
    // Again every five minutes while visible, so it moves on to the next meeting when one ends.
    const load = () => fetch("/api/calendar/upcoming?hours=12&limit=1&ongoing=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { meetings?: { title: string; start: string; end: string }[] } | null) => { if (live && d) setMeeting(d.meetings?.[0] ?? null); })
      .catch(() => undefined);
    void load();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 300_000);
    return () => { live = false; window.clearInterval(id); };
  }, []);
  // A meeting that has ended is not "now", even before the next refresh.
  const next: DayFacts["next"] = meeting && now !== null && Date.parse(meeting.end) > now ? { title: meeting.title, start: meeting.start } : null;
  const { data } = useCompanies(config.watchlist);
  const mover = useMemo(() => biggestMover(config.watchlist.map((t) => ({ ticker: t, changePct: data[t]?.price?.changePct }))), [config.watchlist, data]);
  if (now === null) return null;
  const parts = dayParts({ waiting, next, mover }, now, (iso) => new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
  if (!parts.length) return null;
  return <p className={`text-[12.5px] text-muted ${className}`} aria-live="polite">{parts.join(" · ")}</p>;
}
