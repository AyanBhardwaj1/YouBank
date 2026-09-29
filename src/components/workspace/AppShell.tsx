"use client";

/**
 * The signed-in frame: the top bar, the sidebar and the page. Holds how this person arranges the top
 * bar (which features are pinned, in what order, with or without labels) and the sidebar (open, and
 * docked beside the page or over it), and saves changes to their profile. Cmd/Ctrl+\ toggles the sidebar.
 */
import { useEffect, useMemo, useState } from "react";
import { featuresFor, type NavPrefs } from "@/lib/nav";
import { AppNav } from "./AppNav";
import { NavCtx, type Nav } from "./NavContext";
import { Sidebar } from "./Sidebar";
import { useWorkspace } from "./WorkspaceProvider";

const persist = (nav: NavPrefs) => {
  void fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nav }) }).catch(() => {});
};

export function AppShell({ email, initialNav, children }: { email: string; initialNav: NavPrefs; children: React.ReactNode }) {
  const { profile } = useWorkspace();
  const features = useMemo(() => featuresFor(profile.role), [profile.role]);
  const [prefs, setPrefs] = useState(initialNav);
  const [open, setOpenState] = useState(initialNav.dock);
  const [customizing, setCustomizing] = useState(false);

  const setOpen = (o: boolean) => { setOpenState(o); if (!o) setCustomizing(false); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") { e.preventDefault(); setOpenState(!open); if (open) setCustomizing(false); }
      else if (e.key === "Escape" && open && !prefs.dock && !e.defaultPrevented) { setOpenState(false); setCustomizing(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, prefs.dock]);

  const value: Nav = {
    prefs, features, open, setOpen, customizing,
    update: (p, opts) => {
      const next = { ...prefs, ...p };
      setPrefs(next);
      if (opts?.persist !== false) persist(next);
    },
    save: () => persist(prefs),
    customize: (on = true) => { setCustomizing(on); if (on) setOpenState(true); },
  };

  return (
    <NavCtx.Provider value={value}>
      <div className="flex h-dvh flex-col overflow-hidden text-fg">
        <AppNav email={email} />
        <div className="relative flex min-h-0 flex-1">
          <Sidebar />
          <div className="min-h-0 min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </NavCtx.Provider>
  );
}
