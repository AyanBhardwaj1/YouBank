"use client";

/**
 * The calendar: every connected calendar merged and colour-coded, as a day, a week or an agenda.
 *
 * Times are drawn on the person's own clock (their saved zone, else the browser's). On a phone the
 * week view becomes the agenda by default and the time grid scrolls sideways, so nothing is squeezed
 * into columns too narrow to read. Events come from the stored sync window (30 days back, 90 ahead);
 * Sync asks every provider for changes now.
 */
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { useSubNav } from "@/lib/subnav";
import { EventPanel } from "./EventPanel";
import { Scheduler, type SchedulePrefill } from "./Scheduler";
import { browserTz, btn, calApi, colorOf, dayStart, fmt, isoDay, localIsoDay, minutesOfDay, relative, zoneFor, type Meeting, type Overview } from "./shared";

type View = "day" | "week" | "agenda";
const VIEWS: { id: View; label: string }[] = [{ id: "day", label: "Day" }, { id: "week", label: "Week" }, { id: "agenda", label: "Agenda" }];
const HOUR_PX = 44;
const DAY_MS = 86_400_000;

const PHONE = "(max-width: 640px)";
const subscribePhone = (cb: () => void) => { const mq = window.matchMedia(PHONE); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); };
const isPhone = () => window.matchMedia(PHONE).matches;

/** Side-by-side lanes for overlapping meetings in one day column. */
function layout(items: Meeting[]): Map<number, { lane: number; lanes: number }> {
  const sorted = [...items].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || Date.parse(b.end) - Date.parse(a.end));
  const out = new Map<number, { lane: number; lanes: number }>();
  let cluster: Meeting[] = [], laneEnds: number[] = [], clusterEnd = -Infinity;
  const flush = () => { for (const m of cluster) out.get(m.id)!.lanes = laneEnds.length; cluster = []; laneEnds = []; };
  for (const m of sorted) {
    const s = Date.parse(m.start), e = Math.max(Date.parse(m.end), s + 15 * 60_000);
    if (s >= clusterEnd) { flush(); clusterEnd = -Infinity; }
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane < 0) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    out.set(m.id, { lane, lanes: 1 });
    cluster.push(m);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

export function CalendarWorkspace({ needsMigration, initialView }: { needsMigration: boolean; initialView?: string | null }) {
  const [ov, setOv] = useState<Overview | null>(null);
  // Null until the person picks: then phones get the agenda (a seven-column grid is unreadable at
  // 375px) and wider screens the week.
  const [picked, setView] = useState<View | null>(() => (VIEWS.some((v) => v.id === initialView) ? (initialView as View) : null));
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const view: View = picked ?? (phone ? "agenda" : "week");
  const [anchor, setAnchor] = useState(() => Date.now());
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [selected, setSelected] = useState<Meeting | null>(null);
  const [scheduler, setScheduler] = useState<{ prefill?: SchedulePrefill; reschedule?: Meeting | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useSubNav("/app/calendar", (v) => { if (VIEWS.some((x) => x.id === v)) setView(v as View); });

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const tz = ov?.prefs.timezone || browserTz();
  const zone = useMemo(() => zoneFor(tz), [tz]);
  const calColor = useMemo(() => new Map((ov?.calendars ?? []).map((c) => [c.id, colorOf(c)])), [ov]);

  const range = useMemo(() => {
    const today = dayStart(zone, anchor);
    if (view === "day") return { from: today, to: dayStart(zone, anchor, 1), days: 1 };
    if (view === "agenda") return { from: today, to: dayStart(zone, anchor, 14), days: 14 };
    // Weeks start on Monday.
    const dow = new Date(today + zone.offsetAt(today) * 60_000).getUTCDay();
    const monday = dayStart(zone, today, -((dow + 6) % 7));
    return { from: monday, to: dayStart(zone, monday, 7), days: 7 };
  }, [view, anchor, zone]);

  const loadOverview = useCallback(() => calApi<Overview>("/api/calendar").then(setOv, (e: Error) => setError(e.message)), []);
  useEffect(() => { if (!needsMigration) void loadOverview(); }, [needsMigration, loadOverview, tick]);

  const rangeKey = `${range.from}:${range.to}:${tick}`;
  const loading = loadedKey !== rangeKey;
  useEffect(() => {
    if (needsMigration) return;
    let live = true;
    calApi<{ meetings: Meeting[] }>(`/api/calendar/events?from=${new Date(range.from).toISOString()}&to=${new Date(range.to).toISOString()}`)
      .then((r) => { if (live) setMeetings(r.meetings); }, (e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoadedKey(rangeKey); });
    return () => { live = false; };
  }, [range.from, range.to, needsMigration, rangeKey]);

  const refresh = () => setTick((t) => t + 1);
  const say = (m: string) => { setNotice(m); setError(null); refresh(); };

  const syncNow = async () => {
    setBusy("sync"); setError(null);
    try {
      const r = await calApi<{ results: { written: number; error?: string }[] }>("/api/calendar/sync", { method: "POST", body: "{}" });
      const failed = r.results.filter((x) => x.error);
      say(failed.length ? `Synced, but ${failed.length} ${failed.length === 1 ? "account" : "accounts"} had a problem: ${failed[0].error}` : "Up to date.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const step = (dir: -1 | 1) => setAnchor((a) => a + dir * (view === "day" ? 1 : view === "week" ? 7 : 14) * DAY_MS);
  const days = Array.from({ length: range.days }, (_, i) => dayStart(zone, range.from, i));
  const timed = meetings.filter((m) => !m.allDay);
  const allDay = meetings.filter((m) => m.allDay);
  const next = timed.find((m) => Date.parse(m.end) > now && Date.parse(m.start) > now - 5 * 60_000);
  const noAccounts = ov && ov.accounts.length === 0;
  const reauth = ov?.accounts.filter((a) => a.status === "needs_reauth") ?? [];

  if (needsMigration) {
    return (
      <Shell>
        <div className="mt-6 ctl border border-info/40 bg-info/5 p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="AlertTriangle" className="h-4 w-4" /> Not set up yet</h2>
          <p className="mt-2 max-w-[70ch] text-[12px] text-muted">The calendar tables have not been created. Apply the migration and reload:</p>
          <pre className="num mt-3 overflow-auto ctl border border-line bg-elevated/60 p-3 text-[11.5px]">DATABASE_URL=… pnpm exec tsx scripts/apply-sql.mts drizzle/0018_calendar.sql</pre>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {(error || notice) && <div className={`mt-4 ctl border px-3 py-2 text-[12px] ${error ? "border-neg/40 bg-neg/5 text-neg" : "border-pos/40 bg-pos/5 text-pos"}`}>{error ?? notice}</div>}
      {reauth.map((a) => (
        <div key={a.id} className="mt-3 flex flex-wrap items-center gap-2 ctl border border-neg/40 bg-neg/5 px-3 py-2 text-[12px]">
          <Icon name="AlertTriangle" className="h-3.5 w-3.5 text-neg" /> {a.address} needs reconnecting{a.lastError ? `: ${a.lastError.slice(0, 120)}` : "."}
          <Link href="/app/settings?tab=calendar" className={btn.primary}>Reconnect</Link>
        </div>
      ))}
      {noAccounts && (
        <div className="mt-4 ctl border border-line bg-elevated/30 p-4">
          <h2 className="text-[14px] font-semibold">Connect your calendar</h2>
          <p className="mt-1 max-w-[70ch] text-[12px] text-muted">Google Calendar, Microsoft 365 or Outlook.com, iCloud and any CalDAV server (Fastmail, Nextcloud, Yahoo), or any calendar link. Meetings are linked to your Relationships contacts and deals, and you can book from free times across all of them.</p>
          <Link href="/app/settings?tab=calendar" className={`mt-3 inline-block ${btn.accent}`}>Connect a calendar</Link>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => setAnchor(Date.now())} className={btn.ghost}>Today</button>
          <button type="button" onClick={() => step(-1)} aria-label="Earlier" className={btn.ghost}><Icon name="ChevronLeft" className="h-3.5 w-3.5" /></button>
          <button type="button" onClick={() => step(1)} aria-label="Later" className={btn.ghost}><Icon name="ChevronRight" className="h-3.5 w-3.5" /></button>
          <span className="ml-1 text-[13px] font-semibold">{view === "day" ? fmt.long(range.from, tz) : fmt.month(range.from + DAY_MS, tz)}</span>
          {loading && <span className="text-[11px] text-muted">Loading…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" onClick={() => setView(v.id)} className={`ctl px-2.5 py-1 text-[11.5px] ${view === v.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{v.label}</button>
          ))}
          <button type="button" onClick={syncNow} disabled={!!busy || !!noAccounts} className={btn.ghost}><Icon name="RefreshCw" className="mr-1 inline h-3 w-3" />{busy === "sync" ? "Syncing…" : "Sync"}</button>
          <button type="button" onClick={() => setScheduler({ prefill: {} })} disabled={!!noAccounts} className={btn.accent}><Icon name="Plus" className="mr-1 inline h-3 w-3" />New meeting</button>
        </div>
      </div>

      {ov && ov.calendars.some((c) => c.visible) && (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
          {ov.calendars.filter((c) => c.visible).map((c) => <span key={c.id} className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: calColor.get(c.id) }} />{c.name}</span>)}
          <Link href="/app/settings?tab=calendar" className="hover:text-fg">Choose calendars</Link>
        </div>
      )}

      {next && (
        <button type="button" onClick={() => setSelected(next)} className="mt-3 flex w-full flex-wrap items-center gap-2 ctl border border-line bg-elevated/30 px-3 py-2 text-left text-[12px] hover:border-accent/50">
          <span className="text-muted">Next:</span><span className="font-semibold">{next.title}</span>
          <span className="text-muted">{fmt.day(Date.parse(next.start), tz)} {fmt.time(Date.parse(next.start), tz)} ({relative(Date.parse(next.start), now)})</span>
          {next.contacts.length > 0 && <span className="text-muted">with {next.contacts.map((c) => c.name || c.email).slice(0, 3).join(", ")}</span>}
          {next.videoUrl && <span className="text-accent"><Icon name="Video" className="mr-1 inline h-3 w-3" />{next.videoProvider}</span>}
        </button>
      )}

      {view === "agenda" ? (
        <div className="mt-4 space-y-4">
          {days.map((d) => {
            const key = localIsoDay(zone, d);
            const items = [...allDay.filter((m) => isoDay(m.start) <= key && isoDay(new Date(Date.parse(m.end) - 1).toISOString()) >= key), ...timed.filter((m) => localIsoDay(zone, Date.parse(m.start)) === key)];
            if (!items.length) return null;
            return (
              <section key={d}>
                <h3 className={`text-[12px] font-semibold ${localIsoDay(zone, now) === key ? "text-accent" : ""}`}>{fmt.long(d, tz)}</h3>
                <div className="mt-1.5 space-y-1">
                  {items.map((m) => <AgendaRow key={m.id} m={m} tz={tz} color={calColor.get(m.calendarId) ?? "#888"} onOpen={() => setSelected(m)} />)}
                </div>
              </section>
            );
          })}
          {!loading && meetings.length === 0 && <p className="ctl border border-dashed border-line px-3 py-4 text-[12px] text-muted">Nothing in the next two weeks.</p>}
        </div>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <div style={{ minWidth: view === "week" ? 720 : undefined }}>
            <div className="grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
              <div />
              {days.map((d) => (
                <div key={d} className={`border-b border-line px-1 pb-1 text-center text-[11px] ${localIsoDay(zone, now) === localIsoDay(zone, d) ? "font-semibold text-accent" : "text-muted"}`}>
                  {fmt.weekday(d, tz)} <span className="num">{fmt.date(d, tz)}</span>
                </div>
              ))}
              <div className="text-[10px] text-faint">all day</div>
              {days.map((d) => {
                const key = localIsoDay(zone, d);
                const items = allDay.filter((m) => isoDay(m.start) <= key && isoDay(new Date(Date.parse(m.end) - 1).toISOString()) >= key);
                return (
                  <div key={d} className="min-h-[22px] space-y-0.5 border-b border-l border-line p-0.5">
                    {items.map((m) => (
                      <button key={m.id} type="button" onClick={() => setSelected(m)} className="block w-full truncate rounded px-1 text-left text-[10.5px]" style={{ background: `${calColor.get(m.calendarId)}33` }}>{m.title}</button>
                    ))}
                  </div>
                );
              })}
            </div>
            <TimeGrid days={days} zone={zone} tz={tz} meetings={timed} colors={calColor} now={now} onOpen={setSelected} />
          </div>
        </div>
      )}

      {selected && (
        <EventPanel key={selected.id} meeting={selected} tz={tz} color={calColor.get(selected.calendarId) ?? "#888"} onClose={() => setSelected(null)}
          onMove={(m) => setScheduler({ reschedule: m })} onChanged={(msg) => { setSelected(null); say(msg); }} />
      )}
      {scheduler && <Scheduler open prefill={scheduler.prefill} reschedule={scheduler.reschedule ?? null} onClose={() => setScheduler(null)} onDone={(msg) => { setSelected(null); say(msg); }} />}
    </Shell>
  );
}

function AgendaRow({ m, tz, color, onOpen }: { m: Meeting; tz: string; color: string; onOpen: () => void }) {
  const s = Date.parse(m.start), e = Date.parse(m.end);
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 ctl border border-line bg-elevated/20 px-3 py-2 text-left hover:border-accent/50">
      <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="w-[92px] shrink-0 text-[11.5px] text-muted">{m.allDay ? "All day" : `${fmt.time(s, tz)}–${fmt.time(e, tz)}`}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{m.title}</span>
        <span className="block truncate text-[11px] text-muted">
          {[m.contacts.map((c) => c.name || c.email).slice(0, 3).join(", "), m.deals.map((d) => d.name).join(", "), m.location && !m.location.startsWith("http") ? m.location : ""].filter(Boolean).join(" · ")}
        </span>
      </span>
      {m.videoUrl && <Icon name="Video" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />}
    </button>
  );
}

function TimeGrid({ days, zone, tz, meetings, colors, now, onOpen }: {
  days: number[]; zone: ReturnType<typeof zoneFor>; tz: string; meetings: Meeting[]; colors: Map<number, string>; now: number; onOpen: (m: Meeting) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  // Open at 07:00 rather than midnight.
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX; }, []);
  return (
    <div ref={scroller} className="relative max-h-[68vh] overflow-y-auto border-b border-line">
      <div className="grid" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))`, height: 24 * HOUR_PX }}>
        <div className="relative">
          {Array.from({ length: 24 }, (_, h) => <div key={h} className="absolute right-1 -translate-y-1/2 text-[10px] text-faint" style={{ top: h * HOUR_PX }}>{h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</div>)}
        </div>
        {days.map((d) => {
          const key = localIsoDay(zone, d);
          const items = meetings.filter((m) => localIsoDay(zone, Date.parse(m.start)) === key || (Date.parse(m.start) < d && Date.parse(m.end) > d));
          const lanes = layout(items);
          const isToday = localIsoDay(zone, now) === key;
          return (
            <div key={d} className="relative border-l border-line" style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--line) ${HOUR_PX - 1}px, var(--line) ${HOUR_PX}px)` }}>
              {isToday && <div className="absolute inset-x-0 z-10 h-px bg-neg" style={{ top: (minutesOfDay(zone, now) / 60) * HOUR_PX }} />}
              {items.map((m) => {
                const s = Math.max(Date.parse(m.start), d), e = Math.min(Date.parse(m.end), d + 25 * 3_600_000);
                const top = (Math.max(0, (s - d) / 60_000) / 60) * HOUR_PX;
                const height = Math.max(18, ((e - s) / 3_600_000) * HOUR_PX - 2);
                const l = lanes.get(m.id) ?? { lane: 0, lanes: 1 };
                const c = colors.get(m.calendarId) ?? "#888";
                return (
                  <button key={m.id} type="button" onClick={() => onOpen(m)} title={m.title}
                    className={`absolute overflow-hidden rounded border-l-[3px] px-1 py-0.5 text-left text-[10.5px] leading-tight hover:z-20 hover:shadow ${m.status === "tentative" ? "opacity-70" : ""}`}
                    style={{ top, height, left: `calc(${(l.lane / l.lanes) * 100}% + 1px)`, width: `calc(${100 / l.lanes}% - 2px)`, borderColor: c, background: `${c}26` }}>
                    <span className="block truncate font-semibold">{m.title}</span>
                    {height > 30 && <span className="block truncate text-muted">{fmt.time(Date.parse(m.start), tz)}{m.videoUrl ? " · video" : ""}</span>}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1240px] px-4 py-6 sm:px-5">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Icon name="Calendar" className="h-5 w-5 text-accent" />Calendar</h1>
        <p className="mt-1 max-w-[80ch] text-[12px] text-muted">All your calendars in one place, linked to the people and deals in Relationships, with a prep brief for every meeting.</p>
        {children}
      </div>
    </div>
  );
}
