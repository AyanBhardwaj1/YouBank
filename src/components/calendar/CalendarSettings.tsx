"use client";

/**
 * Settings, Calendar: connect and disconnect calendar accounts, choose which calendars show and which
 * one new meetings go to, set working hours and zone for scheduling, a personal meeting link, and
 * the morning auto-brief switch.
 *
 * Each way of connecting shows "Not set up yet" with the reason when this server lacks what it needs
 * (an OAuth client, or EMAIL_TOKEN_SECRET), and nothing else breaks.
 */
import { useCallback, useEffect, useState } from "react";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { Select } from "@/components/ui/Select";
import { useFeature } from "@/lib/client/plan";
import { browserTz, btn, calApi, colorOf, input, PROVIDER_LABEL, type Account, type Overview, type ProviderId } from "./shared";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const BLANK_DAV = { preset: "icloud", serverUrl: "", username: "", password: "" };

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)} days ago`;
}

export function CalendarSettings() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dav, setDav] = useState<typeof BLANK_DAV | null>(null);
  const [ics, setIcs] = useState<{ url: string; name: string } | null>(null);
  const [video, setVideo] = useState("");
  const multi = useFeature("calendar.multi_account");

  const load = useCallback(() => calApi<Overview>("/api/calendar").then((o) => { setOv(o); setVideo(o.prefs.videoUrl); }, (e: Error) => setError(e.message)), []);
  useEffect(() => {
    void load().then(() => {
      // The OAuth callback comes back here with ?connected= or ?error=.
      const q = new URLSearchParams(window.location.search);
      if (q.get("connected")) setNotice(`Connected ${q.get("connected")}. Your calendars are syncing now.`);
      if (q.get("error")) setError(q.get("error"));
    });
  }, [load]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label); setError(null); setNotice(null);
    try {
      const msg = await fn();
      if (msg) setNotice(msg);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (!ov) return <section className="mt-5 text-[12px] text-muted">{error ?? "Loading…"}</section>;
  const { accounts, calendars, prefs, setup, presets } = ov;
  const tz = prefs.timezone || browserTz();
  const lockedForMore = accounts.length >= 1 && multi === false;
  const writable = calendars.filter((c) => c.canWrite && c.visible);
  const zones = (() => { try { return Intl.supportedValuesOf("timeZone"); } catch { return [tz]; } })();

  const savePrefs = (body: Record<string, unknown>, message = "Saved.") => run("prefs", async () => { await calApi("/api/calendar/prefs", { method: "PATCH", body: JSON.stringify(body) }); return message; });
  const connectDav = () => run("dav", async () => {
    if (!dav) return;
    const a = await calApi<Account>("/api/calendar/accounts", { method: "POST", body: JSON.stringify({ kind: "caldav", ...dav, serverUrl: dav.preset === "custom" || dav.preset === "nextcloud" ? dav.serverUrl : undefined }) });
    setDav(null);
    return `Connected ${a.address}. Your calendars are syncing now.`;
  });
  const connectIcs = () => run("ics", async () => {
    if (!ics) return;
    const a = await calApi<Account>("/api/calendar/accounts", { method: "POST", body: JSON.stringify({ kind: "ics", ...ics }) });
    setIcs(null);
    return `Subscribed to ${a.displayName || a.address}.`;
  });
  const disconnect = async (a: Account) => {
    if (!(await confirmDialog({ title: `Disconnect ${a.displayName || a.address}?`, body: "Its stored sign-in is deleted, and its events leave YouBank. Nothing changes in the calendar itself.", confirmLabel: "Disconnect", tone: "danger" }))) return;
    await run(`dc-${a.id}`, async () => { await calApi(`/api/calendar/accounts/${a.id}`, { method: "DELETE" }); return "Disconnected."; });
  };
  const sync = (a: Account) => run(`sync-${a.id}`, async () => {
    const r = await calApi<{ results: { written: number; error?: string }[] }>("/api/calendar/sync", { method: "POST", body: JSON.stringify({ accountId: a.id }) });
    if (r.results[0]?.error) throw new Error(r.results[0].error);
    return "Up to date.";
  });

  const connectButton = (p: ProviderId, onClick: () => void, href?: string) => {
    const s = setup[p];
    if (!s.ready) return <span key={p} className="ctl border border-dashed border-line px-2.5 py-1 text-[11.5px] text-muted" title={s.reason}>{PROVIDER_LABEL[p]}: not set up yet</span>;
    if (lockedForMore) return <span key={p} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted"><Icon name="Lock" className="mr-1 inline h-3 w-3" />{PROVIDER_LABEL[p]}</span>;
    return href ? <a key={p} href={href} className={btn.ghost}>{PROVIDER_LABEL[p]}</a> : <button key={p} type="button" onClick={onClick} className={btn.ghost}>{PROVIDER_LABEL[p]}</button>;
  };

  return (
    <section className="mt-5 rise space-y-6">
      <div>
        <h2 className="text-[14px] font-semibold">Calendar</h2>
        <p className="mt-1 max-w-[75ch] text-[12px] text-muted">Connect the calendars you use. YouBank reads 30 days back and 90 ahead, links meetings to your Relationships contacts and deals, and books new meetings in the calendar you choose. Sign-ins and passwords are encrypted; disconnecting deletes them.</p>
      </div>

      {(error || notice) && <div className={`ctl border px-3 py-2 text-[12px] ${error ? "border-neg/40 bg-neg/5 text-neg" : "border-pos/40 bg-pos/5 text-pos"}`}>{error ?? notice}</div>}

      <div className="space-y-2">
        <h3 className="text-[12.5px] font-semibold">Accounts</h3>
        {accounts.length === 0 && <p className="text-[12px] text-muted">No calendar connected yet.</p>}
        {accounts.map((a) => (
          <div key={a.id} className="ctl border border-line bg-elevated/30 p-3">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <Icon name="Calendar" className="h-3.5 w-3.5" />
              <span className="font-semibold">{a.displayName || a.address}</span>
              <span className="text-muted">{PROVIDER_LABEL[a.provider]}{a.host && a.provider !== "google" && a.provider !== "microsoft" ? ` · ${a.host}` : ""} · {a.status === "needs_reauth" ? <span className="text-neg">needs reconnecting</span> : `synced ${ago(a.lastSyncAt)}`}</span>
              <span className="ml-auto flex items-center gap-2">
                {a.status === "needs_reauth"
                  ? (a.provider === "google" || a.provider === "microsoft"
                    ? <a href={`/api/calendar/oauth/${a.provider}/connect?reconnect=${a.id}`} className={btn.primary}>Reconnect</a>
                    : <button type="button" onClick={() => a.provider === "ics" ? setIcs({ url: "", name: a.displayName }) : setDav({ ...BLANK_DAV, preset: "custom", username: a.address })} className={btn.primary}>Reconnect</button>)
                  : <button type="button" onClick={() => sync(a)} disabled={!!busy} className={btn.ghost}>{busy === `sync-${a.id}` ? "Syncing…" : "Sync now"}</button>}
                <button type="button" onClick={() => disconnect(a)} disabled={!!busy} className={btn.danger}>Disconnect</button>
              </span>
            </div>
            {a.lastError && <p className="mt-1 text-[11px] text-neg">{a.lastError.slice(0, 300)}</p>}
            <div className="mt-2 flex flex-col gap-1">
              {calendars.filter((c) => c.accountId === a.id).map((c) => (
                <div key={c.id} className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={c.visible} disabled={!!busy} onChange={(e) => run(`cal-${c.id}`, async () => { await calApi(`/api/calendar/calendars/${c.id}`, { method: "PATCH", body: JSON.stringify({ visible: e.target.checked }) }); })} />
                    <span className="h-2 w-2 rounded-full" style={{ background: colorOf(c) }} />{c.name}
                  </label>
                  {!c.canWrite && <span className="text-faint">read only</span>}
                  {c.canWrite && c.visible && (prefs.defaultCalendarId === c.id
                    ? <span className="text-accent">default for new meetings</span>
                    : <button type="button" disabled={!!busy} onClick={() => run(`def-${c.id}`, async () => { await calApi(`/api/calendar/calendars/${c.id}`, { method: "PATCH", body: JSON.stringify({ default: true }) }); return `New meetings go to ${c.name}.`; })} className={btn.link}>Make default</button>)}
                  {c.push && <span className="text-faint" title="Changes arrive within seconds">live</span>}
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11.5px] text-muted">{accounts.length ? "Add another:" : "Connect:"}</span>
          {connectButton("google", () => undefined, "/api/calendar/oauth/google/connect")}
          {connectButton("microsoft", () => undefined, "/api/calendar/oauth/microsoft/connect")}
          {connectButton("caldav", () => { setDav(dav ? null : BLANK_DAV); setIcs(null); })}
          {connectButton("ics", () => { setIcs(ics ? null : { url: "", name: "" }); setDav(null); })}
          {accounts.length >= 1 && <PremiumBadge feature="calendar.multi_account" />}
        </div>
        {lockedForMore && <p className="text-[11px] text-muted">One calendar account is free. Connecting more is part of the Pro plan.</p>}

        {dav && (
          <div className="ctl border border-line bg-elevated/30 p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Service</span>
                <Select value={dav.preset} onChange={(v) => setDav({ ...dav, preset: v })} className={input}>
                  {Object.entries(presets).map(([k, p]) => <option key={k} value={k}>{p.label}</option>)}
                  <option value="custom">Other CalDAV server</option>
                </Select></label>
              {(dav.preset === "custom" || dav.preset === "nextcloud") && (
                <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Server address</span>
                  <input value={dav.serverUrl} onChange={(e) => setDav({ ...dav, serverUrl: e.target.value })} placeholder="https://cloud.example.com/remote.php/dav" className={input} /></label>
              )}
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">User name or email</span>
                <input value={dav.username} onChange={(e) => setDav({ ...dav, username: e.target.value })} placeholder="you@icloud.com" className={input} /></label>
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">App-specific password</span>
                <input type="password" autoComplete="off" value={dav.password} onChange={(e) => setDav({ ...dav, password: e.target.value })} placeholder="abcd-efgh-ijkl-mnop" className={input} />
                <span className="text-[10.5px] text-muted">Not your normal password.</span></label>
            </div>
            {presets[dav.preset] && <p className="mt-2 text-[11px] text-muted">{presets[dav.preset].note} {presets[dav.preset].appPasswordUrl && <a href={presets[dav.preset].appPasswordUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">Create one</a>}</p>}
            <p className="mt-1 text-[10.5px] text-muted">YouBank signs in and lists your calendars before saving anything. The password is encrypted and never shown again.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={connectDav} disabled={!!busy || !dav.username.trim() || !dav.password.trim()} className={btn.primary}>{busy === "dav" ? "Signing in…" : "Connect"}</button>
              <button type="button" onClick={() => setDav(null)} className={btn.link}>Cancel</button>
            </div>
          </div>
        )}
        {ics && (
          <div className="ctl border border-line bg-elevated/30 p-3">
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Calendar link (.ics or webcal://)</span>
                <input value={ics.url} onChange={(e) => setIcs({ ...ics, url: e.target.value })} placeholder="webcal://p01-calendars.icloud.com/published/…" className={input} /></label>
              <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Name (optional)</span>
                <input value={ics.name} onChange={(e) => setIcs({ ...ics, name: e.target.value })} placeholder="Team holidays" className={input} /></label>
            </div>
            <p className="mt-1 text-[10.5px] text-muted">Read only. Private links carry a key, so the link is stored encrypted.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={connectIcs} disabled={!!busy || !ics.url.trim()} className={btn.primary}>{busy === "ics" ? "Checking…" : "Subscribe"}</button>
              <button type="button" onClick={() => setIcs(null)} className={btn.link}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h3 className="text-[12.5px] font-semibold">Scheduling</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Time zone</span>
            <Select value={prefs.timezone || ""} onChange={(v) => savePrefs({ timezone: v })} className={input} searchable>
              <option value="">Follow this browser ({browserTz()})</option>
              {zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </Select></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Default meeting length</span>
            <Select value={String(prefs.defaultDuration)} onChange={(v) => savePrefs({ defaultDuration: Number(v) })} className={input}>
              {[15, 20, 25, 30, 45, 50, 60, 90].map((d) => <option key={d} value={String(d)}>{d} minutes</option>)}
            </Select></label>
          <div className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Working hours</span>
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <input type="time" value={prefs.workHours.start} onChange={(e) => savePrefs({ workHours: { ...prefs.workHours, start: e.target.value } })} className={input} />
              <span className="text-muted">to</span>
              <input type="time" value={prefs.workHours.end} onChange={(e) => savePrefs({ workHours: { ...prefs.workHours, end: e.target.value } })} className={input} />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = prefs.workHours.days.includes(i);
                return <button key={d} type="button" onClick={() => savePrefs({ workHours: { ...prefs.workHours, days: on ? prefs.workHours.days.filter((x) => x !== i) : [...prefs.workHours.days, i] } })}
                  className={`ctl px-1.5 py-0.5 text-[11px] ${on ? "bg-accent-soft text-accent" : "border border-line text-muted"}`}>{d}</button>;
              })}
            </div>
            <span className="text-[10.5px] text-muted">Suggested times stay inside these hours.</span>
          </div>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">Your meeting room link</span>
            <input value={video} onChange={(e) => setVideo(e.target.value)} onBlur={() => video !== prefs.videoUrl && savePrefs({ videoUrl: video }, "Meeting link saved.")} placeholder="https://zoom.us/my/yourname" className={input} />
            <span className="text-[10.5px] text-muted">Offered when you book a meeting. Leave empty to add one each time, or let Google Meet or Teams add it.</span></label>
          <label className="flex flex-col gap-1"><span className="text-[11px] font-semibold">New meetings go to</span>
            <Select value={String(prefs.defaultCalendarId ?? "")} onChange={(v) => v && run("def", async () => { await calApi(`/api/calendar/calendars/${v}`, { method: "PATCH", body: JSON.stringify({ default: true }) }); return "Saved."; })} className={input}>
              <option value="">{writable.length ? "Your main calendar" : "No writable calendar yet"}</option>
              {writable.map((c) => <option key={c.id} value={String(c.id)}>{c.name}</option>)}
            </Select></label>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="flex items-center gap-2 text-[12.5px] font-semibold">Meeting briefs <PremiumBadge feature="calendar.auto_brief" /></h3>
        <p className="max-w-[75ch] text-[12px] text-muted">Open any meeting for what YouBank already knows about its people, companies and deals (free). The AI brief is written when you ask for it. Switch this on to have every external meeting briefed each morning, after 06:00 your time; it uses AI on your behalf for up to eight meetings a day.</p>
        <PremiumGate feature="calendar.auto_brief">
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={prefs.autoBrief} disabled={!!busy} onChange={(e) => savePrefs({ autoBrief: e.target.checked }, e.target.checked ? "Your external meetings will be briefed each morning." : "Morning briefs are off.")} />
            Auto-brief my external meetings each morning
          </label>
        </PremiumGate>
      </div>
    </section>
  );
}
