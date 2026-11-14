"use client";

/**
 * What the interfaces' navigation pieces share (InterfaceChrome and src/components/workspace/interfaces):
 * the pinned features in the person's order, and a clock that exists only once the page is live.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { featureOf, type NavFeature } from "@/lib/nav";
import { useNav } from "../NavContext";

/** The pinned features, in the person's order, topped up from the rest so a piece is never near empty. */
export function usePinned(min = 3, max = 8): { items: NavFeature[]; current: NavFeature | undefined; all: NavFeature[] } {
  const nav = useNav();
  const path = usePathname();
  const byId = new Map(nav.features.map((f) => [f.id, f]));
  const pinned = nav.prefs.pinned.flatMap((id) => byId.get(id) ?? []);
  const items = pinned.length >= min ? pinned : [...pinned, ...nav.features.filter((f) => !pinned.includes(f))].slice(0, max);
  return { items, current: featureOf(path, nav.features), all: nav.features };
}

/** A clock that ticks every `every` ms once mounted (null on the server and the first render). */
export function useClock(every = 20_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const id = setInterval(tick, every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

/** Whether motion should be kept to a minimum: the system setting or Settings → Style (html[data-motion]). */
export function reducedMotion(): boolean {
  if (typeof window === "undefined") return true;
  return document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether a key press belongs to something being typed into (so a shortcut must leave it alone). */
export function typingIn(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || !!t.closest("[role=dialog], [role=combobox], [role=listbox]"));
}

/** reducedMotion() as a hook that follows changes (true on the server, so nothing moves before the page is live). */
export function useStill(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      mq.addEventListener("change", onChange);
      const mo = new MutationObserver(onChange);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
      return () => { mq.removeEventListener("change", onChange); mo.disconnect(); };
    },
    reducedMotion,
    () => true,
  );
}
