"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";

type Device = { id: number; name: string; host: string; createdAt: string; lastUsedAt: string | null };

const ago = (iso: string | null) => { if (!iso) return "never"; const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; };

const STEPS: Record<string, { label: string; steps: React.ReactNode[] }> = {
  web: {
    label: "On the web",
    steps: [
      <>Download the add-in file with the button above.</>,
      <>Open a workbook in Excel on the web (or a presentation in PowerPoint on the web).</>,
      <>Go to <b>Home → Add-ins → More Add-ins</b>, open the <b>My Add-ins</b> tab and choose <b>Upload My Add-in</b>.</>,
      <>Pick the file and upload. <b>YouBank</b> appears on the Home tab.</>,
    ],
  },
  windows: {
    label: "Windows",
    steps: [
      <>Download the add-in file and put it in a shared network folder (for example <code>{"\\\\your-pc\\addins"}</code>).</>,
      <>In Excel go to <b>File → Options → Trust Center → Trust Center Settings → Trusted Add-in Catalogs</b>, add the folder&apos;s path, tick <b>Show in Menu</b>, and restart Excel.</>,
      <>Go to <b>Home → Add-ins → More Add-ins → Shared Folder</b>, choose YouBank and add it. The same folder works for PowerPoint.</>,
    ],
  },
  mac: {
    label: "Mac",
    steps: [
      <>Download the add-in file with the button above.</>,
      <>In Finder, press <b>⌘⇧G</b> and go to <code>~/Library/Containers/com.microsoft.Excel/Data/Documents/wef</code> (create the <code>wef</code> folder if it is missing). For PowerPoint use <code>com.microsoft.Powerpoint</code>.</>,
      <>Copy the file there, restart Excel, then open <b>Home → Add-ins</b> and choose YouBank.</>,
    ],
  },
  team: {
    label: "Your whole team",
    steps: [
      <>In the Microsoft 365 admin center go to <b>Settings → Integrated apps → Upload custom apps</b> and choose <b>Office Add-in</b>.</>,
      <>Upload the add-in file (or give it this link: the file&apos;s address below), then assign it to people or groups.</>,
      <>It reaches everyone&apos;s Excel and PowerPoint, on the web, Windows and Mac, usually within hours.</>,
    ],
  },
};

/** Enter the code Excel or PowerPoint shows. Used in the app and on the standalone connect page. */
export function ApproveCode({ initialCode, onApproved }: { initialCode: string; onApproved?: () => void }) {
  const [code, setCode] = useState(initialCode);
  const [state, setState] = useState<{ ok?: string; error?: string; busy?: boolean }>({});
  const approve = async () => {
    setState({ busy: true });
    try {
      const res = await fetch("/api/office/pair/approve", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "That code did not work");
      setState({ ok: `Connected ${body.host || "the add-in"}. Go back to it: it finishes connecting within a few seconds.` });
      setCode("");
      onApproved?.();
    } catch (e) { setState({ error: e instanceof Error ? e.message : String(e) }); }
  };
  return (
    <>
      <div className="mt-3 flex gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} onKeyDown={(e) => { if (e.key === "Enter" && code.trim()) void approve(); }} placeholder="ABCD-2345" className="w-[170px] ctl border border-line bg-bg px-3 py-2 font-mono text-[15px] tracking-[0.15em] outline-none focus:border-accent/60" />
        <button type="button" disabled={!code.trim() || state.busy} onClick={() => void approve()} className="ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-bg disabled:opacity-40">{state.busy ? "Connecting…" : "Connect"}</button>
      </div>
      <p className="mt-2 text-[11px] text-muted">Only enter a code you see in your own Excel or PowerPoint. It gives that add-in access to your YouBank models until you disconnect it.</p>
      {state.ok && <p className="mt-2 text-[12px] text-pos">{state.ok}</p>}
      {state.error && <p className="mt-2 text-[12px] text-neg">{state.error}</p>}
    </>
  );
}

export function OfficeConnect({ initialCode }: { initialCode: string }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [how, setHow] = useState<keyof typeof STEPS>("web");
  const [origin, setOrigin] = useState("");

  const load = () => fetch("/api/office/devices").then((r) => r.json()).then((d) => setDevices(d.devices ?? [])).catch(() => setDevices([]));
  useEffect(() => {
    void load();
    queueMicrotask(() => setOrigin(window.location.origin));
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[980px] px-5 py-6">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold tracking-tight"><Icon name="FileSpreadsheet" className="h-5 w-5 text-accent" />Excel and PowerPoint</h1>
        <p className="mt-1 max-w-[75ch] text-[12.5px] text-muted">
          YouBank runs inside Excel and PowerPoint. Ask the agent for a DCF, an LBO or a fix, and watch it write into your own workbook, cell by cell. Your edits in Excel sync back to <Link href="/app/studio" className="underline">Studio</Link>, decks come into PowerPoint with native tables and charts tied to the model, and one click refreshes them when the numbers move.
        </p>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1fr]">
          <section className="ctl border border-accent/40 bg-accent-soft/30 p-4">
            <h2 className="text-[13.5px] font-semibold">Connect Excel or PowerPoint</h2>
            <p className="mt-1 text-[12px] text-muted">Open YouBank in Excel or PowerPoint, choose <b>Get a connection code</b>, and enter the code here.</p>
            <ApproveCode initialCode={initialCode} onApproved={() => void load()} />
          </section>

          <section className="ctl border border-line bg-panel p-4">
            <h2 className="text-[13.5px] font-semibold">Connected installs</h2>
            {devices === null ? <p className="mt-2 text-[12px] text-muted">Loading…</p> : devices.length === 0 ? <p className="mt-2 text-[12px] text-muted">None yet.</p> : (
              <ul className="mt-2 divide-y divide-line">
                {devices.map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2 text-[12px]">
                    <Icon name={d.host === "PowerPoint" ? "Presentation" : "FileSpreadsheet"} className="h-4 w-4 text-muted" />
                    <span className="min-w-0 flex-1"><span className="font-medium">{d.name}</span><span className="block text-[11px] text-muted">Connected {ago(d.createdAt)} · last used {ago(d.lastUsedAt)}</span></span>
                    <button type="button" onClick={async () => { await fetch(`/api/office/devices?id=${d.id}`, { method: "DELETE" }); void load(); }} className="text-[11.5px] text-muted underline hover:text-neg">Disconnect</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="mt-5 ctl border border-line bg-panel p-4">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-[13.5px] font-semibold">Install the add-in</h2>
            <a href="/office/manifest.xml?download=1" className="ctl bg-accent px-3 py-1.5 text-[12px] font-semibold text-bg"><Icon name="Download" className="mr-1 inline h-3.5 w-3.5" />Download the add-in file</a>
            {origin && <span className="text-[11px] text-muted">File address: <code className="text-fg">{origin}/office/manifest.xml</code></span>}
          </div>
          <div className="mt-3 flex flex-wrap gap-1 text-[12px]">
            {(Object.keys(STEPS) as (keyof typeof STEPS)[]).map((k) => (
              <button key={k} type="button" onClick={() => setHow(k)} className={`ctl px-2.5 py-1 ${how === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{STEPS[k].label}</button>
            ))}
          </div>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-[12.5px]">
            {STEPS[how].steps.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
          <p className="mt-3 text-[11.5px] text-muted">Then open a workbook, click <b>YouBank</b> on the Home tab, and connect with a code. Needs Microsoft 365 or Office 2021 or later; Excel and PowerPoint on the web always work.</p>
        </section>

        <section className="mt-5 grid gap-3 text-[12px] sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Live in your workbook", "The agent's edits land in Excel as it makes them, with the selection following along. Every run can be undone."],
            ["Your edits sync back", "Type in Excel and Studio has it within seconds, so the agent, your team and your decks all see the same numbers."],
            ["Decks that stay tied", "Insert a deck into PowerPoint; when the model moves, refresh replaces YouBank's slides in place and leaves yours alone."],
            ["Checks before it goes out", "Model audit, banker formatting, the deck brand check and tie-out, and named checkpoints you can compare against."],
          ].map(([t, d]) => (
            <div key={t} className="ctl border border-line bg-panel p-3"><p className="font-semibold">{t}</p><p className="mt-1 text-muted">{d}</p></div>
          ))}
        </section>
      </div>
    </div>
  );
}
