"use client";

import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PLATFORMS, PLATFORM_LABEL, type MeetingSettings, type Platform } from "@/lib/meetings/model";
import { Field, api, btn, input, type PanelCtx } from "./shared";

const APPS = PLATFORMS.filter((p) => p !== "other");

/**
 * The copilot's settings, shared by every computer: consent defaults (the notice to paste, apps and
 * words never to record, apps that start on their own), retention, notes and follow-ups, the notetaker.
 * What happens on one computer (listening for meetings, system audio, a local copy of the audio) is set
 * in that computer's desktop app.
 */
export function MeetingSettingsForm({ ctx, settings, botUnlocked, onSaved }: { ctx: PanelCtx; settings: MeetingSettings; botUnlocked: boolean; onSaved: (s: MeetingSettings) => void }) {
  const [s, setS] = useState<MeetingSettings>(settings);
  const [keywords, setKeywords] = useState(settings.neverKeywords.join(", "));
  const toggleApp = (list: Platform[], app: Platform) => (list.includes(app) ? list.filter((a) => a !== app) : [...list, app]);

  const save = () => ctx.run("meeting-settings", async () => {
    const next = await api<MeetingSettings>("/api/meetings/settings", { method: "PUT", body: JSON.stringify({ ...s, neverKeywords: keywords.split(",").map((k) => k.trim()).filter(Boolean) }) });
    setS(next); setKeywords(next.neverKeywords.join(", ")); onSaved(next); ctx.say("Copilot settings saved.");
  });

  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string, extra?: React.ReactNode) => (
    <label className="flex items-start gap-2 text-[12px]">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="mt-0.5" />
      <span>{label} {extra}{hint && <span className="block text-[10.5px] text-muted">{hint}</span>}</span>
    </label>
  );

  return (
    <div className="ctl border border-line bg-elevated/40 p-3.5">
      <h3 className="text-[13px] font-semibold">Copilot settings</h3>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Consent</h4>
          <p className="text-[11px] text-muted">Before each recording the desktop app asks you to confirm, and reminds you that some places require everyone&apos;s consent to record a call.</p>
          <Field label="Notice to paste in the meeting chat" hint="The desktop app offers to copy it when you start.">
            <textarea value={s.noticeText} onChange={(e) => setS({ ...s, noticeText: e.target.value })} rows={3} className={input} />
          </Field>
          <Field label="Never record these apps">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {APPS.map((a) => <label key={a} className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={s.neverApps.includes(a)} onChange={() => setS({ ...s, neverApps: toggleApp(s.neverApps, a), autoStartApps: s.autoStartApps.filter((x) => x !== a) })} />{PLATFORM_LABEL[a]}</label>)}
            </div>
          </Field>
          <Field label="Never record meetings that mention" hint="Words in the meeting's title or window, separated by commas: “board, HR, interview”.">
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className={input} />
          </Field>
          <Field label="Start without asking for these apps" hint="Off by default. The recording indicator still shows, and the Stop button works as always. Only use it where you always have consent.">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {APPS.filter((a) => !s.neverApps.includes(a)).map((a) => <label key={a} className="flex items-center gap-1 text-[12px]"><input type="checkbox" checked={s.autoStartApps.includes(a)} onChange={() => setS({ ...s, autoStartApps: toggleApp(s.autoStartApps, a) })} />{PLATFORM_LABEL[a]}</label>)}
            </div>
          </Field>
        </div>
        <div className="flex flex-col gap-3">
          <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">After the meeting</h4>
          {check("Write notes when a meeting ends", s.autoNotes, (v) => setS({ ...s, autoNotes: v }), "Summary, decisions, action items, signals per person and proposed CRM updates. A few meetings a month are free.", <PremiumBadge feature="meetings.notes" />)}
          {check("Draft follow-up emails", s.followUps, (v) => setS({ ...s, followUps: v }), "Into your review queue, addressed to the people you met. Never sent without you.")}
          <Field label="Delete transcripts after" hint="Notes, links and timeline entries stay. Audio is never kept on YouBank.">
            <select value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: Number(e.target.value) })} className={input}>
              {[0, 7, 30, 90, 365].map((d) => <option key={d} value={d}>{d === 0 ? "Keep them" : `${d} days`}</option>)}
            </select>
          </Field>
          <h4 className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">The notetaker</h4>
          <Field label="Name it joins with"><input value={s.botName} onChange={(e) => setS({ ...s, botName: e.target.value })} className={input} /></Field>
          {check("Send it to calendar meetings on its own", s.autoJoin, (v) => setS({ ...s, autoJoin: v }),
            "Needs a connected calendar. It joins meetings with a link a few minutes before they start, except those your never-record settings cover. Billed per hour.",
            <PremiumBadge feature="meetings.bot" />)}
          {s.autoJoin && !botUnlocked && <p className="text-[11px] text-neg">The notetaker is part of the Pro plan; saving this needs it.</p>}
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={save} disabled={!!ctx.busy} className={btn.primary}>{ctx.busy === "meeting-settings" ? "Saving…" : "Save"}</button>
      </div>
    </div>
  );
}
