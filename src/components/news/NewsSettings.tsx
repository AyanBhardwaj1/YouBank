"use client";

/**
 * Settings, News and alerts: how the Newsroom looks (four editions, previewed in their own type, or any
 * look with any layout), how stories open, how much motion, which desk, when the morning brief comes and
 * where, what alerts and where, the delivery channels (mailbox, this browser, Slack), follows and mutes,
 * and this month's AI spend against the cap.
 */
import Link from "next/link";
import { Bell, Check, Hash, Mail, MonitorSmartphone } from "lucide-react";
import { useState } from "react";
import type { Channel, EditionId, LayoutId, LookId, NewsPrefs } from "@/lib/news/prefs";
import { post, useApi } from "./client";
import { Select } from "@/components/ui/Select";

type PrefsResponse = {
  prefs: Omit<NewsPrefs, "slack"> & { slackConnected: boolean };
  editions: Record<EditionId, { label: string; look: LookId; layout: LayoutId; inspired: string; blurb: string }>;
  looks: Record<LookId, string>; layouts: Record<LayoutId, { label: string; blurb: string }>;
  desks: { id: string; label: string }[]; ownDesk: { id: string; label: string };
  channels: { email: { address: string; provider: string } | null; push: { ready: boolean; key: string; devices: number }; slack: { ready: boolean } };
  budget: { spentUsd: number; budgetUsd: number; paused: string[] };
};

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Toronto", "America/Sao_Paulo", "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Zurich", "Asia/Dubai", "Asia/Kolkata", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney"];

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="grid gap-2 border-t border-line py-4 md:grid-cols-[240px_1fr]"><div><div className="text-[12.5px] font-semibold text-fg">{title}</div>{hint && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>}</div><div className="min-w-0">{children}</div></div>;
}
function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className="flex items-center gap-2 text-[12px] text-fg">
      <span className={`relative h-4 w-7 rounded-full transition ${on ? "bg-accent" : "bg-line-strong"}`}><span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all ${on ? "left-3.5" : "left-0.5"}`} /></span>{label}
    </button>
  );
}
function Choice<T extends string>({ value, options, onChange }: { value: T; options: { id: T; label: string; hint?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">{options.map((o) => (
      <button key={o.id} type="button" onClick={() => onChange(o.id)} className={`rounded-[var(--radius-sm)] border px-3 py-1.5 text-left text-[12px] transition ${value === o.id ? "border-accent bg-accent-soft text-fg" : "border-line text-muted hover:text-fg"}`}>
        <div className="flex items-center gap-1.5">{value === o.id && <Check className="h-3.5 w-3.5 text-accent" />}{o.label}</div>{o.hint && <div className="mt-0.5 text-[10.5px] text-muted">{o.hint}</div>}
      </button>
    ))}</div>
  );
}

/** A miniature of an edition, set in its own look. */
function EditionPreview({ id, e, selected, onPick }: { id: EditionId; e: PrefsResponse["editions"][EditionId]; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" onClick={onPick} className={`group overflow-hidden rounded-[var(--radius)] border text-left transition ${selected ? "border-accent ring-2 ring-accent/30" : "border-line hover:border-line-strong"}`}>
      <div className="nr bg-bg p-3" data-look={e.look} data-motion="off">
        <div className="nr-kicker">Deals · 2h · Bloomberg +3</div>
        <div className="nr-head mt-1 text-fg" style={{ fontSize: id === "editorial" ? 22 : id === "terminal" ? 12.5 : 16 }}>Acme agrees to buy Widget for $4.1 billion</div>
        {id !== "terminal" && <p className="nr-body mt-1 line-clamp-2 text-fg/75">An 18% premium to the unaffected close, all cash.{id === "brief" ? " Why it matters: the third deal this quarter." : ""}</p>}
        <div className="mt-2 flex gap-1">{[0, 1, 2].map((k) => <div key={k} className="nr-card h-5 flex-1" />)}</div>
      </div>
      <div className="border-t border-line bg-panel px-3 py-2">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-fg">{selected && <Check className="h-3.5 w-3.5 text-accent" />}{e.label}</div>
        <div className="text-[10.5px] text-muted">Like {e.inspired}. {e.blurb}</div>
      </div>
    </button>
  );
}

const urlB64 = (b64: string) => { const pad = "=".repeat((4 - (b64.length % 4)) % 4); const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };

export function NewsSettings() {
  const { data, reload } = useApi<PrefsResponse>("/api/news/prefs");
  const [draft, setDraft] = useState<Partial<NewsPrefs> | null>(null);
  const [msg, setMsg] = useState("");
  const [slackUrl, setSlackUrl] = useState("");
  const [follow, setFollow] = useState<{ tickers?: string; topics?: string; mutedSources?: string; mutedTopics?: string }>({});
  if (!data) return <div className="mt-5 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-10 rounded" />)}</div>;
  const p = { ...data.prefs, ...(draft ?? {}) } as PrefsResponse["prefs"];
  const save = async (patch: Partial<NewsPrefs>) => {
    const merged = { ...p, ...patch };
    setDraft(merged);
    const r = await post<{ prefs: PrefsResponse["prefs"] }>("/api/news/prefs", { prefs: merged }).catch((e) => { setMsg(e instanceof Error ? e.message : String(e)); return null; });
    if (r) { setDraft(r.prefs); setMsg("Saved."); }
  };
  const setChannels = (list: Channel[], c: Channel, on: boolean) => (on ? [...new Set([...list, c])] : list.filter((x) => x !== c));
  const test = async (kind: Channel) => { setMsg("Sending…"); const r = await post<{ ok?: boolean; message?: string }>("/api/news/prefs", { test: kind }).catch((e) => ({ message: e instanceof Error ? e.message : String(e) })); setMsg(r.message ?? ""); };
  const enablePush = async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) { setMsg("This browser does not support push notifications."); return; }
      if ((await Notification.requestPermission()) !== "granted") { setMsg("Notifications are blocked for this site in the browser's settings."); return; }
      const reg = await navigator.serviceWorker.register("/news-sw.js", { scope: "/" });
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(data.channels.push.key) }));
      await post("/api/news/push", { subscription: sub.toJSON() });
      await save({ alerts: { ...p.alerts, channels: setChannels(p.alerts.channels, "push", true) } });
      setMsg("Push is on for this browser."); reload();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const saveSlack = async (clear = false) => {
    const r = await post<{ prefs?: unknown; error?: string }>("/api/news/prefs", { prefs: p, slackWebhook: clear ? "" : slackUrl }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
    setMsg("error" in r && r.error ? r.error : clear ? "Slack disconnected." : "Slack connected."); setSlackUrl(""); setDraft(null); reload();
  };
  const listOf = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
  const pct = data.budget.budgetUsd ? Math.min(1, data.budget.spentUsd / data.budget.budgetUsd) : 0;

  return (
    <section className="mt-5 rise">
      <h2 className="text-[14px] font-semibold">News and alerts</h2>
      <p className="mt-1 max-w-[72ch] text-[12px] text-muted">The Newsroom reads public feeds, press-release wires, regulators and SEC filings every ten minutes, clusters them into stories, and ranks them for your desk, your watchlist and the people in Relationships. Everything here applies to your account on every device.</p>
      {msg && <p className="mt-3 rounded-[var(--radius-sm)] bg-accent-soft px-3 py-1.5 text-[11.5px] text-fg">{msg}</p>}

      <Row title="Edition" hint="A look paired with its layout. You can also switch from the top of the Newsroom.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(Object.keys(data.editions) as EditionId[]).map((id) => <EditionPreview key={id} id={id} e={data.editions[id]} selected={!p.advanced && p.edition === id} onPick={() => save({ edition: id, advanced: false, look: data.editions[id].look, layout: data.editions[id].layout })} />)}
        </div>
        <div className="mt-3"><Toggle on={p.advanced} label="Advanced: choose the look and the layout separately" onChange={(v) => save({ advanced: v })} /></div>
        {p.advanced && (
          <div className="mt-3 flex flex-wrap gap-6">
            <label className="text-[12px] text-muted">Look <Select value={p.look} onChange={(v) => save({ look: v as LookId })} className="ml-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-fg">{(Object.keys(data.looks) as LookId[]).map((l) => <option key={l} value={l}>{data.looks[l]}</option>)}</Select></label>
            <label className="text-[12px] text-muted">Layout <Select value={p.layout} onChange={(v) => save({ layout: v as LayoutId })} className="ml-1.5 rounded-md border border-line bg-elevated px-2 py-1 text-fg">{(Object.keys(data.layouts) as LayoutId[]).map((l) => <option key={l} value={l}>{data.layouts[l].label}: {data.layouts[l].blurb}</option>)}</Select></label>
          </div>
        )}
      </Row>

      <Row title="Opening a story" hint="The side peek keeps the feed beside the story; arrow keys step through stories.">
        <Choice value={p.reading} onChange={(v) => save({ reading: v })} options={[{ id: "peek", label: "Side peek", hint: "Slides in from the right" }, { id: "page", label: "Full page", hint: "A page of its own, more room" }]} />
      </Row>

      <Row title="Motion" hint="Rich: layouts morph, cards spring and flip, numbers tick, the tape scrolls. Switched off automatically if your system asks for reduced motion.">
        <Choice value={p.motion} onChange={(v) => save({ motion: v })} options={[{ id: "rich", label: "Rich" }, { id: "subtle", label: "Subtle" }, { id: "off", label: "Off" }]} />
      </Row>

      <Row title="Desk" hint={`Your desk comes from your profile (${data.ownDesk.label}). Read another group's news here or from the Newsroom's header.`}>
        <Select value={p.desk || data.ownDesk.id} onChange={(v) => save({ desk: v === data.ownDesk.id ? "" : v })} className="rounded-md border border-line bg-elevated px-2 py-1 text-[12px]">
          {data.desks.map((d) => <option key={d.id} value={d.id}>{d.label}{d.id === data.ownDesk.id ? " (your desk)" : ""}</option>)}
        </Select>
      </Row>

      <Row title="Morning brief" hint="Written once a day for your desk, with a section for your watchlist and network. Always in the app; also where you choose.">
        <div className="flex flex-wrap items-center gap-4">
          <Toggle on={p.brief.enabled} label="Send me the morning brief" onChange={(v) => save({ brief: { ...p.brief, enabled: v } })} />
          <label className="text-[12px] text-muted">at <input type="time" value={p.brief.time} onChange={(e) => save({ brief: { ...p.brief, time: e.target.value } })} className="ml-1 rounded-md border border-line bg-elevated px-1.5 py-0.5 text-fg" /></label>
          <Select value={p.brief.timezone} onChange={(v) => save({ brief: { ...p.brief, timezone: v } })} className="rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[12px]">{[...new Set([p.brief.timezone, ...ZONES])].map((z) => <option key={z} value={z}>{z.replace("_", " ")}</option>)}</Select>
        </div>
        <div className="mt-3 flex flex-wrap gap-4">
          {(["email", "push", "slack"] as Channel[]).map((c) => <Toggle key={c} on={p.brief.channels.includes(c)} label={c === "email" ? "Email" : c === "push" ? "Browser push" : "Slack"} onChange={(v) => save({ brief: { ...p.brief, channels: setChannels(p.brief.channels, c, v) } })} />)}
        </div>
      </Row>

      <Row title="Alerts" hint="A story alerts once, at most five a run. Email is used only for urgent alerts (a watchlist company's bankruptcy, restatement, takeover), so your inbox stays quiet.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Toggle on={p.alerts.enabled} label="Alerts on" onChange={(v) => save({ alerts: { ...p.alerts, enabled: v } })} />
          <Toggle on={p.alerts.watchlist} label="My watchlist in the news or a filing" onChange={(v) => save({ alerts: { ...p.alerts, watchlist: v } })} />
          <Toggle on={p.alerts.network} label="Companies where my contacts work" onChange={(v) => save({ alerts: { ...p.alerts, network: v } })} />
          <Toggle on={p.alerts.filings} label="Significant filings for my desk" onChange={(v) => save({ alerts: { ...p.alerts, filings: v } })} />
          <Toggle on={p.alerts.bigDeals} label="$1B+ deals in my sectors" onChange={(v) => save({ alerts: { ...p.alerts, bigDeals: v } })} />
        </div>
        <label className="mt-3 flex items-center gap-3 text-[12px] text-muted">Top stories for my desk: <span>more</span><input type="range" min={0.5} max={1} step={0.05} value={p.alerts.threshold} onChange={(e) => save({ alerts: { ...p.alerts, threshold: Number(e.target.value) } })} className="accent-[var(--accent)]" /><span>only the biggest</span></label>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          {(["push", "slack", "email"] as Channel[]).map((c) => <Toggle key={c} on={p.alerts.channels.includes(c)} label={c === "email" ? "Email (urgent only)" : c === "push" ? "Browser push" : "Slack"} onChange={(v) => save({ alerts: { ...p.alerts, channels: setChannels(p.alerts.channels, c, v) } })} />)}
        </div>
        <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
          <Toggle on={!!p.alerts.quiet} label="Quiet hours" onChange={(v) => save({ alerts: { ...p.alerts, quiet: v ? { from: 22, to: 7 } : null } })} />
          {p.alerts.quiet && <><Select value={p.alerts.quiet.from} onChange={(v) => save({ alerts: { ...p.alerts, quiet: { ...p.alerts.quiet!, from: Number(v) } } })} className="rounded-md border border-line bg-elevated px-1 py-0.5">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select> to <Select value={p.alerts.quiet.to} onChange={(v) => save({ alerts: { ...p.alerts, quiet: { ...p.alerts.quiet!, to: Number(v) } } })} className="rounded-md border border-line bg-elevated px-1 py-0.5">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</Select><span className="text-faint">urgent alerts still come through</span></>}
        </div>
      </Row>

      <Row title="Where they reach you" hint="All free: your own mailbox sends to you, the browser needs one click, Slack takes an incoming-webhook URL.">
        <div className="grid gap-3 lg:grid-cols-3">
          <div className="panel p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Mail className="h-3.5 w-3.5" /> Email</div>
            {data.channels.email ? <p className="mt-1 text-[11.5px] text-muted">From and to {data.channels.email.address}.</p> : <p className="mt-1 text-[11.5px] text-muted">Connect a mailbox in <Link href="/app/crm" className="text-accent">Relationships</Link> to get email.</p>}
            <button type="button" disabled={!data.channels.email} onClick={() => test("email")} className="mt-2 rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg disabled:opacity-40">Send a test</button>
          </div>
          <div className="panel p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><MonitorSmartphone className="h-3.5 w-3.5" /> Browser push</div>
            <p className="mt-1 text-[11.5px] text-muted">{data.channels.push.ready ? `${data.channels.push.devices} device${data.channels.push.devices === 1 ? "" : "s"} on.` : "Not set up on this server yet."}</p>
            <div className="mt-2 flex gap-2"><button type="button" disabled={!data.channels.push.ready} onClick={enablePush} className="rounded-md border border-accent/40 px-2 py-0.5 text-[11px] text-accent hover:bg-accent-soft disabled:opacity-40"><Bell className="mr-1 inline h-3 w-3" />Turn on for this browser</button><button type="button" disabled={!data.channels.push.devices} onClick={() => test("push")} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg disabled:opacity-40">Test</button></div>
          </div>
          <div className="panel p-3">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold"><Hash className="h-3.5 w-3.5" /> Slack</div>
            {p.slackConnected ? (
              <div className="mt-1 flex items-center gap-2 text-[11.5px] text-muted">Connected. <button type="button" onClick={() => test("slack")} className="rounded-md border border-line px-2 py-0.5 text-[11px] hover:text-fg">Test</button><button type="button" onClick={() => saveSlack(true)} className="text-[11px] hover:text-neg">Disconnect</button></div>
            ) : (
              <div className="mt-1.5 flex gap-1.5"><input value={slackUrl} onChange={(e) => setSlackUrl(e.target.value)} placeholder="https://hooks.slack.com/services/…" className="min-w-0 flex-1 rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px]" /><button type="button" disabled={!slackUrl} onClick={() => saveSlack(false)} className="rounded-md border border-line px-2 py-0.5 text-[11px] disabled:opacity-40">Save</button></div>
            )}
            <p className="mt-1.5 text-[10.5px] text-faint">In Slack: Apps, Incoming Webhooks, add to a channel, copy the URL.</p>
          </div>
        </div>
      </Row>

      <Row title="Follow and mute" hint="Followed tickers count as your watchlist; muted sources and topics never show.">
        <div className="grid gap-3 sm:grid-cols-2">
          {([["tickers", "Follow tickers", p.follows.tickers, "XOM, CVX"], ["topics", "Follow topics", p.follows.topics, "LNG, private credit"], ["mutedSources", "Mute sources", p.mutes.sources, "Techmeme"], ["mutedTopics", "Mute topics", p.mutes.topics, "crypto"]] as const).map(([k, label, list, ph]) => (
            <label key={k} className="text-[11.5px] text-muted">{label}
              <input value={follow[k] ?? list.join(", ")} onChange={(e) => setFollow((f) => ({ ...f, [k]: e.target.value }))} onBlur={() => { const v = follow[k]; if (v === undefined) return; if (k === "tickers") save({ follows: { ...p.follows, tickers: listOf(v).map((t) => t.toUpperCase()) } }); else if (k === "topics") save({ follows: { ...p.follows, topics: listOf(v) } }); else if (k === "mutedSources") save({ mutes: { ...p.mutes, sources: listOf(v) } }); else save({ mutes: { ...p.mutes, topics: listOf(v) } }); }} placeholder={ph} className="mt-1 block w-full rounded-md border border-line bg-elevated px-2 py-1 text-[12px] text-fg" />
            </label>
          ))}
        </div>
      </Row>

      <Row title="AI budget" hint="Summaries, briefs, research and your personal notes, with a monthly cap. Past it the Newsroom keeps working on headlines, sources, filings and ranking.">
        <div className="max-w-[420px]">
          <div className="flex justify-between text-[11.5px]"><span className="text-muted">This month</span><span className="num text-fg">${data.budget.spentUsd.toFixed(2)} of ${data.budget.budgetUsd.toFixed(0)}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${pct > 0.9 ? "bg-neg" : pct > 0.7 ? "bg-chart-emphasis" : "bg-accent"}`} style={{ width: `${pct * 100}%` }} /></div>
          {data.budget.paused.length > 0 && <p className="mt-1.5 text-[11px] text-muted">Paused until next month: {data.budget.paused.join(", ")}.</p>}
        </div>
      </Row>
    </section>
  );
}
