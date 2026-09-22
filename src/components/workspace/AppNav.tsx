"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { getAuthClient } from "@/lib/auth/client";
import { useWorkspace } from "./WorkspaceProvider";
import { ROLES } from "@/lib/roles";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { useAiSettings } from "@/components/ai/ModelPicker";
import { Icon } from "@/components/ui/Icon";
import { LogoMark } from "@/components/brand/Logo";

export function AppNav({ email }: { email: string }) {
  const path = usePathname();
  const router = useRouter();
  const { profile, config } = useWorkspace();
  const { status } = useAiSettings();
  const [menu, setMenu] = useState(false);
  const items = [
    { href: "/app", label: "Home", icon: "Home" },
    { href: "/app/terminal", label: "Terminal", icon: "Terminal" },
    { href: "/app/tools", label: "Tools", icon: "Wand2" },
    ...(profile.role === "vc" || profile.role === "pe" ? [{ href: "/app/vc", label: "Private markets", icon: "Rocket" }] : []),
    { href: "/app/library", label: "Library", icon: "Library" },
  ];
  const signOut = async () => { await (await getAuthClient()).signOut(); router.push("/"); router.refresh(); };
  const active = (href: string) => (href === "/app" ? path === "/app" : path.startsWith(href));

  return (
    <div className="glass flex h-10 shrink-0 items-center gap-2 border-b border-line bg-bg/90 px-3 text-[11.5px]">
      <Link href="/app" className="flex items-center gap-2">
        <LogoMark size={18} id="nav" />
        <span className="font-semibold tracking-tight"><span className="text-fg">You</span><span className="text-accent">Bank</span></span>
      </Link>
      <span className="hidden truncate text-muted lg:inline" title={`${ROLES[profile.role].label}: ${config.title}`}>· {config.title}</span>
      <nav className="ml-3 flex items-center gap-0.5 overflow-x-auto">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className={`ctl flex items-center gap-1.5 whitespace-nowrap px-2 py-1 transition ${active(i.href) ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
            <Icon name={i.icon} className="h-3.5 w-3.5" /><span className="hidden sm:inline">{i.label}</span>
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex items-center gap-1.5">
        {status?.configured && <span className="num hidden text-[10.5px] text-muted xl:inline" title={`Model ${status.model}, reasoning ${status.effort}`}>{status.label ?? status.model}</span>}
        <ThemeMenu />
        <div className="relative">
          <button type="button" onClick={() => setMenu((m) => !m)} className="ctl flex items-center gap-1.5 border border-line px-2 py-1 text-muted hover:border-accent/50 hover:text-fg">
            <span className="grid h-4 w-4 place-items-center rounded-full bg-accent-soft text-[9px] font-bold text-accent">{(profile.name || email || "?").slice(0, 1).toUpperCase()}</span>
            <span className="hidden max-w-[140px] truncate sm:inline">{email}</span>
          </button>
          {menu && (
            <>
              <button type="button" aria-label="Close menu" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenu(false)} />
              <div className="rise float absolute right-0 z-50 mt-1.5 w-56 ctl border border-line-strong bg-raised p-1 text-[12px]">
                <div className="px-2 py-1.5 text-[10.5px] text-muted">{ROLES[profile.role].label}{profile.specialty ? ` · ${profile.specialty}` : ""}</div>
                <Link href="/app/settings" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Settings" className="h-3.5 w-3.5" /> Settings and style</Link>
                <Link href="/app/profile" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Users" className="h-3.5 w-3.5" /> Change my role</Link>
                <Link href="/app/library" onClick={() => setMenu(false)} className="flex items-center gap-2 ctl px-2 py-1.5 hover:bg-elevated"><Icon name="Library" className="h-3.5 w-3.5" /> Saved work</Link>
                <button type="button" onClick={signOut} className="mt-1 flex w-full items-center gap-2 border-t border-line ctl px-2 py-1.5 text-left text-muted hover:bg-elevated hover:text-neg"><Icon name="LogOut" className="h-3.5 w-3.5" /> Sign out</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
