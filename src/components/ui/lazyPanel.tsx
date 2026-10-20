"use client";

import { useEffect, useState, type ComponentType, type ReactNode } from "react";

/**
 * A component whose code loads on first use, for tabs, panels and dialogs that are not on screen when the
 * page opens. Unlike next/dynamic it does not suspend: React holds a resolved Suspense boundary's reveal
 * back for about 300 ms after its fallback showed, so a lazily loaded tab took a third of a second to
 * appear even when its code arrived in ten milliseconds. Here the fallback shows until the code is in, and
 * once loaded every later render is synchronous.
 *
 * `preload()` fetches the code ahead of time; `useIdlePreload` calls it for a page's panels a few seconds
 * after the page settles, so switching tabs never waits. The server renders the fallback.
 */
export type LazyPanel<P> = ComponentType<P> & { preload: () => Promise<unknown> };

export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>, fallback: () => ReactNode = () => null): LazyPanel<P> {
  let Loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const preload = () => (loading ??= load().then((c) => (Loaded = c)));
  function Panel(props: P) {
    // The code is never in yet when a page hydrates (preloading starts after), so server and client agree;
    // a panel mounted later with its code in renders it at once.
    const [C, setC] = useState<ComponentType<P> | null>(() => Loaded);
    useEffect(() => {
      if (C) return;
      let live = true;
      preload().then((c) => { if (live) setC(() => c); }, () => { loading = null; });
      return () => { live = false; };
    }, [C]);
    return C ? <C {...props} /> : <>{fallback()}</>;
  }
  return Object.assign(Panel, { preload });
}

/** Fetch these panels' code once the page has been idle for `delayMs`. */
export function useIdlePreload(panels: { preload: () => Promise<unknown> }[], delayMs = 2500) {
  useEffect(() => {
    const t = setTimeout(() => { for (const p of panels) void p.preload().catch(() => undefined); }, delayMs);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
