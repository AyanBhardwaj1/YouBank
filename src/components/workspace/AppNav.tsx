"use client";

/**
 * The top bar: the sidebar button, the features this person pinned (in their order, with or without
 * names), the page they are on when it is not pinned (one click pins it), then alerts, style and the
 * account menu. Everything else lives in the sidebar.
 *
 * On a phone the bar slims down to the page's name, alerts, style and the account: the pinned features
 * move to the tab bar at the bottom (MobileTabBar) and the sidebar to its "More" sheet. Controls grow to
 * finger size there, and the bar keeps clear of the notch when the page is drawn edge to edge.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeft, PanelLeftClose, Pin, SlidersHorizontal } from "lucide-react";
import { useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import { featureOf, type NavFeature } from "@/lib/nav";
import { useWorkspace } from "./WorkspaceProvider";
import { useNav } from "./NavContext";
import { ROLES } from "@/lib/roles";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { useAiSettings } from "@/components/ai/ModelPicker";
import { Icon } from "@/components/ui/Icon";
import { LogoMark } from "@/components/brand/Logo";
import { NotificationBell } from "@/components/news/NotificationBell";

function Tab({ f, active, iconsOnly, temporary, onPin }: { f: NavFeature; active: boolean; iconsOnly: boolean; temporary?: boolean; onPin?: () => void }) {
  const link = (
    <Link href={f.href} title={iconsOnly || temporary ? `${f.label}: ${f.blurb}` : f.blurb} aria-current={active ? "page" : undefined}
      className={`relative ctl flex items-center gap-1.5 whitespace-nowrap px-2 py-1 transition-colors ${active ? "text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
      {active && <motion.span layoutId="nav-active" className="absolute inset-0 ctl bg-accent-soft" transition={{ type: "spring", stiffness: 520, damping: 42 }} />}
      <Icon name={f.icon} className="relative h-3.5 w-3.5 shrink-0" />
      {!iconsOnly && <span className="relative hidden sm:inline">{f.label}</span>}
    </Link>
  );
  if (!temporary) return <motion.div layout="position" transition={{ type: "spring", stiffness: 520, damping: 42 }}>{link}</motion.div>;
  return (
    <motion.div layout="position" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}
      className="group ml-0.5 flex items-center ctl border border-dashed border-line-strong">
      {link}
      <button type="button" onClick={onPin} title={`Pin ${f.label} to the top bar`} aria-label={`Pin ${f.label} to the top bar`}
        className="mr-0.5 grid h-5 w-5 place-items-center ctl text-faint transition hover:bg-elevated hover:text-accent">
        <Pin className="h-3 w-3" />
      </button>
    </motion.div>
  );
}

export function AppNav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  const { profile, config } = useWorkspace();
  const { status } = useAiSettings();
  const nav = useNav();
  const [menu, setMenu] = useState(false);
  const byId = new Map(nav.features.map((f) => [f.id, f]));
  const pinned = nav.prefs.pinned.flatMap((id) => byId.get(id) ?? []);
  const current = featureOf(path, nav.features);
  const unpinned = current && !nav.prefs.pinned.includes(current.id) ? current : null;
  const iconsOnly = nav.prefs.labels === "icons";
  const signOut = async () => { await (await getAuthClient()).signOut(); router.push("/"); router.refresh(); };

  return (
    <div className="glass relative z-50 shrink-0 border-b border-line bg-bg/90 pt-safe px-safe">
    <div className="flex h-12 items-center gap-1.5 px-2 text-[11.5px] md:h-10">
      <button type="button" onClick={() => nav.setOpen(!nav.open)} aria-expanded={nav.open} aria-label={nav.open ? "Close the sidebar" : "Open all features and workflows"}
        title={`${nav.open ? "Close" : "All features and workflows"} (⌘\\)`}
        className={`ctl hidden h-7 w-7 shrink-0 place-items-center transition-colors md:grid ${nav.open ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
        {nav.open ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeft className="h-4 w-4" />}
      </button>
      <Link href="/app" className="flex shrink-0 items-center gap-2 pl-0.5 max-md:min-h-11" aria-label="YouBank home">
        <LogoMark size={18} id="nav" />
        <span className={`font-semibold tracking-tight ${current && current.id !== "home" ? "max-md:hidden" : ""}`}><span className="text-fg">You</span><span className="text-accent">Bank</span></span>
      </Link>
      {/* Phones: the page's name, as a native app's title bar has it. */}
      {current && current.id !== "home" && <span className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-fg md:hidden">{current.label}</span>}
      <span className="hidden truncate text-muted 2xl:inline" title={`${ROLES[profile.role].label}: ${config.title}`}>· {config.title}</span>
      <nav aria-label="Pinned features" className="ml-2 hidden min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] md:flex">
        {pinned.map((f) => <Tab key={f.id} f={f} active={current?.id === f.id} iconsOnly={iconsOnly} />)}
        <AnimatePresence>
          {unpinned && <Tab key={`open-${unpinned.id}`} f={unpinned} active iconsOnly={iconsOnly} temporary onPin={() => nav.update({ pinned: [...nav.prefs.pinned, unpinned.id] })} />}
        </AnimatePresence>
        <button type="button" onClick={() => nav.customize()} title="Choose what the top bar shows" aria-label="Customize the top bar"
          className="ml-0.5 grid h-6 w-6 shrink-0 place-items-center ctl text-faint transition-colors hover:bg-elevated hover:text-fg">
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </button>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1 md:gap-1.5">
        {status?.configured && <span className="num hidden text-[10.5px] text-muted 2xl:inline" title={`Model ${status.model}, reasoning ${status.effort}`}>{status.label ?? status.model}</span>}
        <NotificationBell />
        <ThemeMenu nameClass="hidden 2xl:inline" />
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} aria-expanded={menu} aria-haspopup="menu" title={email} aria-label="Account"
            className="ctl flex items-center gap-1.5 border border-line px-1.5 py-1 text-muted hover:border-accent/50 hover:text-fg max-md:h-10 max-md:w-10 max-md:justify-center max-md:border-transparent max-md:px-0">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-accent-soft text-[9px] font-bold text-accent max-md:h-7 max-md:w-7 max-md:text-[12px]">{(profile.name || email || "?").slice(0, 1).toUpperCase()}</span>
            <span className="hidden max-w-[140px] truncate xl:inline">{email}</span>
          </button>
          {menu && (
            <>
              <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} />
              <div role="menu" className="rise float absolute right-0 z-50 mt-1.5 w-60 ctl border border-line-strong bg-raised p-1 text-[12px] max-md:w-[min(280px,calc(100vw-16px))] max-md:text-[14px] [&_[role=menuitem]]:max-md:min-h-11">
                <div className="px-2 py-1.5 text-[10.5px] text-muted">{ROLES[profile.role].label}{profile.specialty ? ` · ${profile.specialty}` : ""}<span className="block truncate text-faint">{email}</span></div>
                <Link role="menuitem" href="/app/settings" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Settings" className="h-3.5 w-3.5" /> Settings and style</Link>
                <button role="menuitem" type="button" onClick={() => { setMenu(false); nav.customize(); }} className="flex w-full items-center gap-2 ctl px-2 py-1.5 text-left hover:bg-elevated"><SlidersHorizontal className="h-3.5 w-3.5" /> Customize the top bar</button>
                <Link role="menuitem" href="/app/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Users" className="h-3.5 w-3.5" /> Change my role</Link>
                <Link role="menuitem" href="/app/library" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Library" className="h-3.5 w-3.5" /> Saved work</Link>
                <button role="menuitem" type="button" onClick={signOut} className="mt-1 flex w-full items-center gap-2 border-t border-line ctl px-2 py-1.5 text-left text-muted hover:bg-elevated hover:text-neg"><Icon name="LogOut" className="h-3.5 w-3.5" /> Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
    </div>
  );
}
