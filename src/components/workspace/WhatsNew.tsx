"use client";

/**
 * "New in YouBank": a small card, bottom right, once per release (src/lib/whats-new.ts), so new features
 * are found rather than stumbled on. Each line tries the thing in one click. Dismissed per browser; also
 * in the command palette as "What's new".
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { RELEASE, WHATS_NEW, type NewThing } from "@/lib/whats-new";
import { openPalette } from "./CommandPalette";
import { openShortcuts } from "./Shortcuts";
import { requestArrange } from "@/lib/client/arrange";

/** Also set by onboarding (OnboardingWizard.tsx), so a new account does not get the card. */
const KEY = "yb-whats-new-seen";
export const openWhatsNew = () => window.dispatchEvent(new Event("yb:whats-new"));

export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();
  useEffect(() => {
    let seen = RELEASE;
    try { seen = localStorage.getItem(KEY) ?? ""; } catch { /* no storage: do not nag */ }
    // Not over onboarding, and a moment after the page settles.
    const id = seen !== RELEASE && path.startsWith("/app") ? window.setTimeout(() => setOpen(true), 1500) : undefined;
    const onOpen = () => setOpen(true);
    window.addEventListener("yb:whats-new", onOpen);
    return () => { if (id) window.clearTimeout(id); window.removeEventListener("yb:whats-new", onOpen); };
    // Once per mount: navigating does not re-open it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, RELEASE); } catch { /* fine */ } };
  const run = (n: NewThing) => {
    close();
    if (n.action === "palette") openPalette();
    else if (n.action === "shortcuts") openShortcuts();
    // Home picks the request up when it mounts, however long its data takes (src/lib/client/arrange.ts).
    else if (n.action === "arrange") { requestArrange(); if (path !== "/app") router.push("/app"); }
  };
  if (!open) return null;
  return (
    <div role="dialog" aria-label="New in YouBank" className="rise float fixed bottom-4 right-4 z-[70] w-[min(380px,calc(100vw-2rem))] ctl border border-line-strong bg-raised p-3.5 shadow-2xl max-md:bottom-[calc(72px+var(--safe-b,0px))]">
      <div className="flex items-center gap-2">
        <Icon name="Sparkles" className="h-4 w-4 text-accent" />
        <h2 className="text-[13.5px] font-semibold">New in YouBank</h2>
        <button type="button" onClick={close} aria-label="Close" className="ml-auto grid h-6 w-6 place-items-center ctl text-muted hover:bg-elevated hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
      </div>
      <ul className="mt-2 max-h-[min(420px,60vh)] space-y-2 overflow-y-auto overscroll-contain pr-1 max-md:max-h-[36vh]">
        {WHATS_NEW.map((n) => (
          <li key={n.title} className="flex items-start gap-2 max-md:flex-col max-md:gap-0.5">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-medium text-fg">{n.title}</div>
              <div className="text-[11.5px] leading-snug text-muted max-md:line-clamp-2">{n.body}</div>
            </div>
            {n.href
              ? <Link href={n.href} onClick={close} className="ctl mt-0.5 shrink-0 border border-line px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-fg max-md:border-0 max-md:p-0 max-md:text-accent">{n.cta}</Link>
              : <button type="button" onClick={() => run(n)} className="ctl mt-0.5 shrink-0 border border-line px-2 py-1 text-[11px] text-muted hover:border-accent/50 hover:text-fg max-md:border-0 max-md:p-0 max-md:text-accent">{n.cta}</button>}
          </li>
        ))}
      </ul>
      <button type="button" onClick={close} className="mt-3 w-full ctl bg-accent py-1.5 text-[12px] font-semibold text-accent-fg">Got it</button>
    </div>
  );
}
