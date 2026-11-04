"use client";

/**
 * The signed-in frame: the top bar, the sidebar and the page. Holds how this person arranges the top
 * bar (which features are pinned, in what order, with or without labels) and the sidebar (open, and
 * docked beside the page or over it), and saves changes to their profile. Cmd/Ctrl+\ toggles the sidebar;
 * Cmd/Ctrl+K opens the command palette.
 *
 * On a phone the same pieces rearrange: the top bar slims to the page's name and the account controls,
 * the pinned features become a tab bar along the bottom, and the sidebar opens as a "More" sheet.
 * The frame clips rather than hides its overflow, so a scrollIntoView inside a page can never scroll
 * the frame itself and push the top bar off screen.
 */
import { useEffect, useMemo, useState } from "react";
import { featuresFor, type NavPrefs } from "@/lib/nav";
import { AppNav } from "./AppNav";
import { NavCtx, type Nav } from "./NavContext";
import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";
import { useWorkspace } from "./WorkspaceProvider";
import { usePhone } from "@/components/ui/useMedia";
import { StepUpHost } from "@/components/security/StepUpHost";
import { CommandPalette } from "./CommandPalette";
import { Shortcuts } from "./Shortcuts";
import { WhatsNew } from "./WhatsNew";
import { SystemTheme } from "@/components/theme/SystemTheme";
import { listenForInstall } from "@/lib/client/install";
import { recordVisit, visitFor } from "@/lib/client/recent";
import { usePathname, useSearchParams } from "next/navigation";

const persist = (nav: NavPrefs) => {
  void fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nav }) }).catch(() => {});
};

export function AppShell({ email, initialNav, children }: { email: string; initialNav: NavPrefs; children: React.ReactNode }) {
  const { profile, desk } = useWorkspace();
  const features = useMemo(() => featuresFor(profile.role, desk.hidden), [profile.role, desk.hidden]);
  const [saved, setPrefs] = useState(initialNav);
  // A feature taken out of the navigation in Settings leaves the top bar at once.
  const prefs = useMemo(() => ({ ...saved, pinned: saved.pinned.filter((id) => !desk.hidden.includes(id)) }), [saved, desk.hidden]);
  const [open, setOpenState] = useState(initialNav.dock);
  const [customizing, setCustomizing] = useState(false);
  // On a phone the sidebar is the "More" sheet: it has its own open state, starts closed whatever the
  // desktop "keep open" setting says, and opening it never changes how the desktop frame is arranged.
  const phone = usePhone();
  const [sheet, setSheet] = useState(false);
  const isOpen = phone ? sheet : open;

  const setOpen = (o: boolean) => { if (phone) setSheet(o); else setOpenState(o); if (!o) setCustomizing(false); };

  // Home's "Jump back in": each page, tool or ticker opened, kept in this browser.
  const path = usePathname();
  const search = useSearchParams().toString();
  const { tools } = useWorkspace();
  useEffect(() => {
    const v = visitFor(path, search ? `?${search}` : "", features, tools, Date.now());
    if (v) recordVisit(v);
  }, [path, search, features, tools]);

  // The browser's offer to install the app can come before Home's checklist is there to show it.
  useEffect(() => listenForInstall(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setOpenState(!open); if (open) setCustomizing(false); }
      else if (e.key === "Escape" && open && !prefs.dock && !e.defaultPrevented) { setOpenState(false); setCustomizing(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prefs.dock]);

  const value: Nav = {
    prefs, features, open: isOpen, setOpen, customizing, phone,
    update: (p, opts) => {
      const next = { ...prefs, ...p };
      setPrefs(next);
      if (opts?.persist !== false) persist(next);
    },
    save: () => persist(prefs),
    customize: (on = true) => { setCustomizing(on); if (on) { if (phone) setSheet(true); else setOpenState(true); } },
  };

  return (
    <NavCtx.Provider value={value}>
      <div className="app-frame flex h-dvh flex-col overflow-clip text-fg">
        <AppNav email={email} />
        <div className="relative flex min-h-0 flex-1">
          <Sidebar />
          <div className="min-h-0 min-w-0 flex-1 px-safe">{children}</div>
        </div>
        <MobileTabBar />
        {/* The authenticator-code dialog before risky actions (src/lib/client/step-up). */}
        <StepUpHost />
        {/* ⌘K: go anywhere, open a ticker, change the look, or ask (CommandPalette). */}
        <CommandPalette />
        {/* G then a letter to go to a feature, ? for the list (Shortcuts). */}
        <Shortcuts />
        {/* Style follows the device's light or dark setting when the person asked for that. */}
        <SystemTheme />
        {/* Once per release: what is new, each tried in one click. */}
        <WhatsNew />
      </div>
    </NavCtx.Provider>
  );
}
