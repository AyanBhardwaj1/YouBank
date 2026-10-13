"use client";

import { errorMessage } from "@/lib/client/errors";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { DESKTOP_FEATURES } from "@/lib/billing/features/desktop";
import { inDesktopApp, openDesktopAgent } from "@/lib/client/desktop";

type Device = { id: number; name: string; platform: string; appVersion: string; settings: { tasks?: Record<string, boolean> }; createdAt: string; lastUsedAt: string | null };

const PLATFORM: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };
const TASK_LABEL: Record<string, string> = { "edge-brief": "Edge brief", "watch-check": "Watch checks", "morning-brief": "Morning brief", "autopilot-status": "Email agent status" };
const ago = (iso: string | null) => { if (!iso) return "never"; const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

/** Approve the code the desktop app shows. On the standalone connect page, and in Settings. */
export function ApproveDesktop({ initialCode, onApproved }: { initialCode: string; onApproved?: () => void }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<{ ok?: string; error?: string; busy?: boolean }>({});
  const [here, setHere] = useState(false);
  useEffect(() => { queueMicrotask(() => setHere(inDesktopApp())); }, []);
  const approve = async () => {
    setState({ busy: true });
    try {
      const res = await fetch("/api/desktop/pair/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "That code did not work");
      const what = body.name ? `${body.name}${PLATFORM[body.platform] ? ` (${PLATFORM[body.platform]})` : ""}` : "the desktop app";
      setState({ ok: here ? `Connected ${what}. You can carry on; alerts and quick ask are ready.` : `Connected ${what}. Go back to the app: it finishes connecting within a few seconds.` });
      setCode("");
      onApproved?.();
    } catch (e) { setState({ error: errorMessage(e) }); }
  };
  return (
    <>
      <div className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) void approve(); }} placeholder="ABCD-2345" className="w-[170px] ctl border border-line bg-bg px-3 py-2 font-mono text-[15px] tracking-[0.15em] outline-none focus:border-accent/60" />
        <button type="button" disabled={!code.trim() || state.busy} onClick={() => void approve()} className="ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-bg disabled:opacity-40">{state.busy ? "Connecting…" : "Connect"}</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Only enter a code you see in your own YouBank desktop app. It lets that computer read your alerts, ask the assistant and sync your files as you, until you disconnect it.</p>
      {state.ok && <p className="mt-2 text-[12px] text-pos">{state.ok}</p>}
      {state.ok && here && <button type="button" onClick={() => void openDesktopAgent("files")} className="mt-2 text-[12px] text-accent hover:underline">Choose what the app may do →</button>}
      {state.error && <p className="mt-2 text-[12px] text-neg">{state.error}</p>}
    </>
  );
}

/** Settings → Desktop app: get the app, approve a code, and see or disconnect connected computers. */
export function DesktopSettings() {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const load = () => fetch("/api/desktop/devices").then((r) => r.json()).then((d) => setDevices(d.devices ?? [])).catch(() => setDevices([]));
  useEffect(() => { void load(); }, []);

  return (
    <section className="mt-5 rise space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[70ch]">
          <h2 className="text-[14px] font-semibold">Desktop app</h2>
          <p className="mt-1 text-[12px] text-muted">YouBank for Windows, macOS and Linux: quick ask from any app, native alerts, your local files in your research, and Studio models you edit in Excel on your own computer.</p>
        </div>
        <Link href="/download" className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-bg"><Icon name="Download" className="mr-1 inline h-3.5 w-3.5" />Download</Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="ctl border border-line bg-panel p-4">
          <h3 className="text-[13px] font-semibold">Connect a computer</h3>
          <p className="mt-1 text-[12px] text-muted">In the app choose <b>Connect</b>; it opens this step for you. If it shows a code instead, enter it here.</p>
          <ApproveDesktop initialCode="" onApproved={() => void load()} />
        </div>
        <div className="ctl border border-line bg-panel p-4">
          <h3 className="text-[13px] font-semibold">Connected computers</h3>
          {devices === null ? <p className="mt-2 text-[12px] text-muted">Loading…</p> : devices.length === 0 ? <p className="mt-2 text-[12px] text-muted">None yet.</p> : (
            <ul className="mt-2 divide-y divide-line">
              {devices.map((d) => {
                const on = Object.entries(d.settings?.tasks ?? {}).filter(([, v]) => v).map(([k]) => TASK_LABEL[k] ?? k);
                return (
                  <li key={d.id} className="flex items-center gap-3 py-2 text-[12px]">
                    <Icon name="Layout" className="h-4 w-4 text-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{d.name || "Desktop app"}</span>{PLATFORM[d.platform] ? <span className="text-muted"> · {PLATFORM[d.platform]}</span> : null}{d.appVersion ? <span className="text-muted"> · {d.appVersion}</span> : null}
                      <span className="block text-[11px] text-muted">Connected {ago(d.createdAt)} · last used {ago(d.lastUsedAt)}{on.length ? ` · scheduled: ${on.join(", ")}` : ""}</span>
                    </span>
                    <button type="button" onClick={async () => { await fetch(`/api/desktop/devices?id=${d.id}`, { method: "DELETE" }); void load(); }} className="text-[11.5px] text-muted underline hover:text-neg">Disconnect</button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="ctl border border-line bg-panel p-4">
        <h3 className="text-[13px] font-semibold">On paid plans</h3>
        <ul className="mt-2 space-y-2">
          {DESKTOP_FEATURES.map((f) => (
            <li key={f.id} className="text-[12px]"><span className="flex items-center gap-2 font-medium">{f.name} <PremiumBadge feature={f.id} /></span><span className="text-muted">{f.description}</span></li>
          ))}
        </ul>
      </div>
    </section>
  );
}
