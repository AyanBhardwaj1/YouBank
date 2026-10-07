"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { DESKTOP_FREE_FILES } from "@/lib/billing/features/desktop";
import { desktopInfo, detectOs, type DesktopInfo, type Os } from "@/lib/client/desktop";
import type { DesktopRelease, Installer, InstallerKind } from "@/lib/desktop/release";

const OS_LABEL: Record<Exclude<Os, "other">, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

/** Which installers each system gets, best first, and how each one is described. */
const OFFER: Record<Exclude<Os, "other">, { kind: InstallerKind; label: string; hint: string }[]> = {
  windows: [
    { kind: "exe", label: "Installer (.exe)", hint: "Windows 10 and 11. Installs for you only; no administrator needed." },
    { kind: "msi", label: "MSI package (.msi)", hint: "For IT teams deploying to many computers." },
  ],
  macos: [{ kind: "dmg", label: "Disk image (.dmg)", hint: "macOS 11 or later. One app for both Apple silicon and Intel Macs." }],
  linux: [
    { kind: "appimage", label: "AppImage", hint: "Runs on most distributions. Make it executable, then open it." },
    { kind: "deb", label: "Debian package (.deb)", hint: "Ubuntu, Debian, Mint and Pop!_OS." },
  ],
};

const mb = (b: number) => (b ? `${Math.max(1, Math.round(b / 1048576))} MB` : "");

function pick(release: DesktopRelease | null, kind: InstallerKind): Installer | null {
  const all = release?.installers.filter((i) => i.kind === kind) ?? [];
  // A universal Mac build first; otherwise x64, the common case on Windows and Linux.
  return all.find((i) => i.arch === "universal") ?? all.find((i) => i.arch === "x64") ?? all[0] ?? null;
}

const FEATURES: { icon: string; title: string; body: string; premium?: string }[] = [
  { icon: "Layout", title: "YouBank in its own window", body: "The whole site, signed in, in a window that remembers its size and place. Starts with your computer if you like, and waits in the tray (the menu bar on a Mac)." },
  { icon: "Sparkles", title: "Quick ask, from anywhere", body: "Press Ctrl+Shift+Space (⌘⇧Space on a Mac) in any app and a small window opens to ask YouBank anything. Same assistant, same daily AI allowance as on the site." },
  { icon: "Bell", title: "Alerts that reach you", body: "Native notifications for Edge findings at what you watch, questions from your email agent, and news about deals in your pipeline, even with the browser closed." },
  { icon: "ArrowRight", title: "Links that open in the app", body: "youbank:// links open a ticker, a deal or a Studio model straight in the app, from email, Slack or your notes." },
  { icon: "FileSearch", title: "Your local files, searchable", body: `Pick folders of CIMs, models and memos. PDFs, Word, Excel and PowerPoint files are read into Edge documents, so cited answers and Studio can use them. Only new or changed files are sent. The first ${DESKTOP_FREE_FILES} files are free.`, premium: "desktop.folders" },
  { icon: "FileSpreadsheet", title: "Studio files on your computer", body: "Pull a Studio model to a real .xlsx (or a deck to .pptx), open it in Excel, and your saved edits sync back to Studio as one change you can undo." },
  { icon: "Wand2", title: "AI edits to local files", body: "Tell the agent what to change in a local model; it works on the Studio copy and writes the result into your file, keeping a backup first.", premium: "desktop.office_agent" },
  { icon: "Timer", title: "Scheduled briefs and checks", body: "Your morning brief and the email agent's status on a schedule, free. The Edge brief and watch checks can run on a schedule too, once you switch each one on.", premium: "desktop.background_ai" },
];

/** What the app may touch, said plainly: when it does it and how to stop it. */
const PERMISSIONS: [string, string, string][] = [
  ["Your YouBank account", "When you choose Connect, the app shows a code and you approve it on YouBank. Its key is kept in your computer's keychain (Keychain on a Mac, Credential Manager on Windows, the Secret Service on Linux).", "Disconnect it in the app, or in Settings → Desktop app on the site, at any time."],
  ["Folders you pick", "Only folders you add, and only PDF, Word, Excel and PowerPoint files in them. Files are fingerprinted on your computer; only new or changed ones are uploaded, under your Edge document quota. Where a file lives on your computer is never sent, only its name.", "Remove a folder to stop watching it; tick “remove its documents” to delete what was uploaded."],
  ["Excel and PowerPoint files", "Only files you pull from Studio or link yourself, in a YouBank folder you choose. A pull or an AI edit keeps a backup of the file first.", "Unlink a file, or switch off Office sync."],
  ["Notifications", "The app checks for new alerts every few minutes while it runs. You choose which kinds.", "Switch each kind off in the app, or block notifications in your system settings."],
  ["Work while you are away", "Free scheduled tasks (morning brief, email agent status) only read what YouBank already has. Tasks that run AI never start unless you switch them on for this computer, and the server checks that switch too.", "Switch any task off in the app; quitting the app stops them all."],
  ["The website inside the app", "The site can ask the app for exactly three things: its version, opening quick ask, and opening these settings. It cannot read your files or run programs.", "Nothing to switch: this is fixed in the app."],
];

/** The download page: the right installer for this computer first, then what the app does and may touch. */
export function DesktopDownload({ release, releasesUrl }: { release: DesktopRelease | null; releasesUrl: string }) {
  const [os, setOs] = useState<Os>("other");
  const [inApp, setInApp] = useState<DesktopInfo | null>(null);
  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    queueMicrotask(() => setOs(detectOs(navigator.userAgent, nav.userAgentData?.platform ?? "")));
    void desktopInfo().then(setInApp);
  }, []);

  const mine = os === "other" ? null : OFFER[os].map((o) => ({ ...o, file: pick(release, o.kind) })).find((o) => o.file) ?? null;
  const published = release?.publishedAt ? new Date(release.publishedAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "";

  return (
    <div className="mx-auto max-w-[1040px] px-5 py-10">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-[60ch]">
          <h1 className="flex items-center gap-2 text-[26px] font-semibold tracking-tight"><Icon name="Download" className="h-6 w-6 text-accent" />Download YouBank for desktop</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            Everything on the site, in its own window, plus what a browser cannot do: quick ask from any app, alerts that reach you with the browser closed, your local files in your research, and Studio models you edit in Excel on your own computer. Free for Windows, macOS and Linux.
          </p>
          {inApp && <p className="mt-3 ctl border border-accent/40 bg-accent-soft/40 px-3 py-2 text-[12.5px]">You are using YouBank for desktop {inApp.version}. It keeps itself up to date.</p>}
        </div>

        <div className="w-full max-w-[340px] ctl border border-line bg-panel p-4">
          {release ? (
            mine?.file ? (
              <>
                <p className="text-[11px] uppercase tracking-wider text-muted">For your {OS_LABEL[os as Exclude<Os, "other">]} computer</p>
                <a href={mine.file.url} className="mt-2 flex items-center justify-center gap-2 ctl bg-accent px-4 py-2.5 text-[13.5px] font-semibold text-bg"><Icon name="Download" className="h-4 w-4" />Download {mine.label}</a>
                <p className="mt-2 text-[11.5px] text-muted">Version {release.version}{published ? `, ${published}` : ""}{mine.file.bytes ? ` · ${mb(mine.file.bytes)}` : ""}. {mine.hint}</p>
              </>
            ) : (
              <p className="text-[12.5px] text-muted">Pick your system below. Version {release.version}{published ? `, ${published}` : ""}.</p>
            )
          ) : (
            <>
              <p className="text-[13px] font-semibold">The first release is on its way</p>
              <p className="mt-1 text-[12px] text-muted">Installers appear here as soon as they are published. Watch the <a href={releasesUrl} className="text-accent hover:underline">releases page</a> meanwhile.</p>
            </>
          )}
        </div>
      </div>

      {release && (
        <section className="mt-8 grid gap-3 md:grid-cols-3">
          {(Object.keys(OFFER) as Exclude<Os, "other">[]).map((k) => (
            <div key={k} className={`ctl border p-4 ${k === os ? "border-accent/50 bg-accent-soft/20" : "border-line bg-panel"}`}>
              <p className="text-[13.5px] font-semibold">{OS_LABEL[k]}</p>
              <ul className="mt-2 space-y-2">
                {OFFER[k].map((o) => {
                  const f = pick(release, o.kind);
                  return (
                    <li key={o.kind} className="text-[12px]">
                      {f ? <a href={f.url} className="font-medium text-accent hover:underline">{o.label}</a> : <span className="text-muted">{o.label}: not in this release</span>}
                      {f?.bytes ? <span className="text-muted"> · {mb(f.bytes)}</span> : null}
                      <span className="block text-[11px] text-muted">{o.hint}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <p className="text-[11.5px] text-muted md:col-span-3">
            All files and release notes: <a href={release.url} className="text-accent hover:underline">version {release.version} on GitHub</a>. If Windows SmartScreen or macOS says the app is from an unidentified developer, choose <b>More info → Run anyway</b> (Windows) or right-click the app and choose <b>Open</b> (Mac); installers are signed once our signing certificates are in place.
          </p>
        </section>
      )}

      <section className="mt-10">
        <h2 className="text-[16px] font-semibold">What it adds</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="ctl border border-line bg-panel p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold"><Icon name={f.icon} className="h-4 w-4 text-accent" />{f.title}{f.premium && <PremiumBadge feature={f.premium} />}</p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold"><Icon name="Shield" className="h-4 w-4 text-accent" />What it can touch, and when</h2>
        <p className="mt-1 max-w-[75ch] text-[12.5px] text-muted">Everything that reads your files, sends alerts or works while you are away is off until you turn it on. Here is all of it.</p>
        <dl className="mt-3 divide-y divide-line border-y border-line">
          {PERMISSIONS.map(([what, how, off]) => (
            <div key={what} className="grid gap-1 py-3 text-[12.5px] md:grid-cols-[200px_1fr_1fr] md:gap-4">
              <dt className="font-semibold">{what}</dt>
              <dd className="text-muted">{how}</dd>
              <dd className="text-muted"><span className="text-fg">To stop it: </span>{off}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-10 grid gap-3 text-[12.5px] md:grid-cols-3">
        <div className="ctl border border-line bg-panel p-4">
          <p className="font-semibold">1. Install and open it</p>
          <p className="mt-1 text-muted">It opens YouBank. Sign in as you do on the web.</p>
        </div>
        <div className="ctl border border-line bg-panel p-4">
          <p className="font-semibold">2. Connect this computer</p>
          <p className="mt-1 text-muted">Choose <b>Connect</b> in the app and approve the code it shows. That lets alerts, quick ask and your files work with the window closed.</p>
        </div>
        <div className="ctl border border-line bg-panel p-4">
          <p className="font-semibold">3. Turn on what you want</p>
          <p className="mt-1 text-muted">Folders, Office files, alerts and scheduled tasks are each off until you switch them on. Manage connected computers in <Link href="/app/settings?tab=desktop" className="text-accent hover:underline">Settings</Link>.</p>
        </div>
      </section>
    </div>
  );
}
