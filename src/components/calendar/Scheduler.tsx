"use client";

/**
 * Create a meeting, or move one. Opens from the calendar, a contact or a deal.
 *
 * Times come from free/busy across every connected calendar (the server asks each provider live), on
 * the person's own clock and within their working hours; any other time can be typed in. Invitations
 * are sent by the person's own calendar provider, from their own address, and only when "Send
 * invitations" stays ticked. A video link can be pasted (their personal room is offered), or Google
 * Meet / Teams can add one.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { wallToUtc } from "@/lib/calendar/tz";
import { browserTz, btn, calApi, fmt, input, zoneFor, type Meeting, type Overview } from "./shared";

export type SchedulePrefill = { title?: string; attendees?: { email: string; name?: string }[]; description?: string };
type Slot = { start: string; end: string; label: string };

const DURATIONS = [15, 30, 45, 60, 90];

function fromLocalInput(v: string, tz: string): number | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!m) return null;
  return wallToUtc(zoneFor(tz), Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
}

const parseEmails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter((x) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x));

/** Mount it when it should show (the parent renders it conditionally); it loads what it needs. */
export function Scheduler({ open, onClose, onDone, prefill, reschedule }: {
  open: boolean; onClose: () => void; onDone: (message: string) => void; prefill?: SchedulePrefill; reschedule?: Meeting | null;
}) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [title, setTitle] = useState(reschedule?.title ?? prefill?.title ?? "");
  const [people, setPeople] = useState((prefill?.attendees ?? []).map((a) => a.email).join(", "));
  const [names] = useState<Record<string, string>>(() => Object.fromEntries((prefill?.attendees ?? []).filter((a) => a.name).map((a) => [a.email.toLowerCase(), a.name!])));
  const [description, setDescription] = useState(prefill?.description ?? "");
  const [duration, setDuration] = useState(reschedule ? Math.max(5, Math.round((Date.parse(reschedule.end) - Date.parse(reschedule.start)) / 60_000)) : 30);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [live, setLive] = useState(true);
  const [picked, setPicked] = useState<string>("");
  const [custom, setCustom] = useState("");
  const [video, setVideo] = useState("");
  const [conference, setConference] = useState(false);
  const [calendarId, setCalendarId] = useState<number | null>(null);
  const [notify, setNotify] = useState(true);
  const [scope, setScope] = useState<"instance" | "series">("instance");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tz = ov?.prefs.timezone || browserTz();
  const writable = useMemo(() => (ov?.calendars ?? []).filter((c) => c.canWrite), [ov]);
  const providerOf = (calId: number | null) => ov?.accounts.find((a) => a.id === writable.find((c) => c.id === calId)?.accountId)?.provider;

  const findTimes = useCallback(async (minutes: number) => {
    setBusy("slots"); setError(null);
    try {
      const r = await calApi<{ slots: Slot[]; live: boolean }>("/api/calendar/slots", { method: "POST", body: JSON.stringify({ durationMin: minutes, days: 10, max: 8 }) });
      setSlots(r.slots); setLive(r.live);
      setPicked((p) => (p && r.slots.some((s) => s.start === p) ? p : r.slots[0]?.start ?? ""));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  // Load the calendars and preferences, then ask for free times.
  useEffect(() => {
    let alive = true;
    calApi<Overview>("/api/calendar").then((o) => {
      if (!alive) return;
      setOv(o);
      let minutes = duration;
      if (!reschedule) {
        minutes = o.prefs.defaultDuration || 30;
        setDuration(minutes);
        setVideo(o.prefs.videoUrl || "");
        const w = o.calendars.filter((c) => c.canWrite);
        setCalendarId(w.find((c) => c.id === o.prefs.defaultCalendarId)?.id ?? w.find((c) => c.primary)?.id ?? w[0]?.id ?? null);
      }
      if (o.calendars.some((c) => c.canWrite)) void findTimes(minutes);
      else setSlots([]);
    }, (e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
    // Once per opening: the parent mounts this component afresh each time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const startMs = custom ? fromLocalInput(custom, tz) : picked ? Date.parse(picked) : null;
  const attendees = parseEmails(people).map((email) => ({ email, name: names[email.toLowerCase()] }));
  const noCalendar = ov && writable.length === 0;
  const canConference = !video && (providerOf(calendarId) === "google" || providerOf(calendarId) === "microsoft");

  const submit = async () => {
    if (startMs === null) { setError("Pick a time."); return; }
    const start = new Date(startMs).toISOString(), end = new Date(startMs + duration * 60_000).toISOString();
    setBusy("save"); setError(null);
    try {
      if (reschedule) {
        await calApi(`/api/calendar/events/${reschedule.id}`, { method: "PATCH", body: JSON.stringify({ start, end, scope, sendInvites: notify }) });
        onDone(`Moved to ${fmt.day(startMs, tz)}, ${fmt.time(startMs, tz)}.${notify && reschedule.attendees.length ? " Attendees were told." : ""}`);
      } else {
        await calApi("/api/calendar/events", {
          method: "POST",
          body: JSON.stringify({ calendarId, title, description, start, end, attendees, videoUrl: video.trim() || undefined, addConference: canConference && conference, sendInvites: notify }),
        });
        onDone(`Booked ${fmt.day(startMs, tz)}, ${fmt.time(startMs, tz)}.${notify && attendees.length ? ` Invitations sent to ${attendees.length} ${attendees.length === 1 ? "person" : "people"}.` : ""}`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={reschedule ? "Move meeting" : "New meeting"} className="panel max-h-[92vh] w-full max-w-[560px] overflow-auto rounded-t-xl border border-line bg-panel p-4 shadow-xl sm:rounded-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Icon name="Calendar" className="h-4 w-4 text-accent" />{reschedule ? `Move "${reschedule.title}"` : "New meeting"}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-muted hover:text-fg"><Icon name="X" className="h-4 w-4" /></button>
        </div>

        {noCalendar && (
          <p className="mt-3 ctl border border-info/40 bg-info/5 px-3 py-2 text-[12px]">Connect a calendar you can write to first, in <a href="/app/settings?tab=calendar" className="text-accent hover:underline">Settings, Calendar</a>.</p>
        )}

        {!reschedule && (
          <div className="mt-3 grid gap-2">
            <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Intro call" className={input} /></label>
            <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">People to invite</span>
              <input value={people} onChange={(e) => setPeople(e.target.value)} placeholder="maya@ledgerline.io, sam@acme.com" className={input} />
              <span className="text-[10.5px] text-muted">{attendees.length ? `${attendees.length} ${attendees.length === 1 ? "address" : "addresses"}` : "Separate addresses with commas."}</span></label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold">Length</span>
          {DURATIONS.map((d) => (
            <button key={d} type="button" disabled={!!busy || (!!reschedule && scope === "series")} onClick={() => { setDuration(d); void findTimes(d); }} className={`ctl px-2 py-0.5 text-[11.5px] ${duration === d ? "bg-accent-soft text-accent" : "border border-line text-muted hover:text-fg"}`}>{d < 60 ? `${d} min` : `${d / 60}h`.replace(".5h", "½h")}</button>
          ))}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold">When you are free <span className="font-normal text-muted">({tz})</span></span>
            <button type="button" onClick={() => findTimes(duration)} disabled={!!busy} className={btn.link}><Icon name="RefreshCw" className="mr-1 inline h-3 w-3" />{busy === "slots" ? "Checking…" : "Check again"}</button>
          </div>
          {slots === null ? <p className="mt-2 text-[11.5px] text-muted">Checking your calendars…</p>
            : slots.length === 0 ? <p className="mt-2 text-[11.5px] text-muted">No free time in your working hours over the next ten days. Type a time below.</p>
            : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slots.map((s) => (
                  <button key={s.start} type="button" onClick={() => { setPicked(s.start); setCustom(""); }}
                    className={`ctl px-2 py-1 text-[11.5px] ${!custom && picked === s.start ? "bg-accent text-accent-fg" : "border border-line hover:border-accent/50"}`}>{s.label}</button>
                ))}
              </div>
            )}
          {!live && slots && <p className="mt-1 text-[10.5px] text-muted">One calendar did not answer, so its last synced events were used.</p>}
          <label className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]"><span className="text-muted">Or another time:</span>
            <input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} className={input} />
            {custom && <button type="button" onClick={() => setCustom("")} className={btn.link}>Use a suggestion</button>}</label>
        </div>

        {reschedule?.recurring && (
          <div className="mt-3 flex flex-wrap gap-3 text-[11.5px]">
            <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "instance"} onChange={() => setScope("instance")} /> Only this meeting</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={scope === "series"} onChange={() => setScope("series")} /> Every meeting in the series</label>
          </div>
        )}

        {!reschedule && (
          <div className="mt-3 grid gap-2">
            <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Video link</span>
              <input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://zoom.us/j/… (optional)" className={input} /></label>
            {canConference && (
              <label className="flex items-center gap-1.5 text-[11.5px]"><input type="checkbox" checked={conference} onChange={(e) => setConference(e.target.checked)} />
                Add a {providerOf(calendarId) === "google" ? "Google Meet" : "Teams"} link</label>
            )}
            {writable.length > 1 && (
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Calendar</span>
                <Select value={calendarId ?? ""} onChange={(v) => setCalendarId(Number(v))} className={input}>
                  {writable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select></label>
            )}
            <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Notes for the invitation</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={input} /></label>
          </div>
        )}

        <label className="mt-3 flex items-center gap-1.5 text-[11.5px]"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          {reschedule ? "Tell the attendees" : "Send invitations"} <span className="text-muted">(from your own calendar)</span></label>

        {error && <p className="mt-3 ctl border border-neg/40 bg-neg/5 px-3 py-2 text-[12px] text-neg">{error}</p>}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={submit} disabled={!!busy || !!noCalendar || startMs === null || (!reschedule && !title.trim())} className={btn.accent}>
            {busy === "save" ? "Saving…" : reschedule ? "Move it" : "Book it"}
          </button>
          <button type="button" onClick={onClose} className={btn.link}>Cancel</button>
          {startMs !== null && <span className="text-[11px] text-muted">{fmt.long(startMs, tz)}, {fmt.time(startMs, tz)} to {fmt.time(startMs + duration * 60_000, tz)}</span>}
        </div>
      </div>
    </div>
  );
}
