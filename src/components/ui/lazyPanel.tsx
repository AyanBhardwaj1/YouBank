"use client";

import { useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import { isStaleBuild } from "@/components/ui/ErrorScreen";

/**
 * A component whose code loads on first use, for tabs, panels and dialogs that are not on screen when the
 * page opens. Unlike next/dynamic it does not suspend: React holds a resolved Suspense boundary's reveal
 * back for about 300 ms after its fallback showed, so a lazily loaded tab took a third of a second to
 * appear even when its code arrived in ten milliseconds. Here the fallback shows until the code is in, and
 * once loaded every later render is synchronous.
 *
 * `preload()` fetches the code ahead of time; `useIdlePreload` calls it for a page's panels a few seconds
 * after the page settles, so switching tabs never waits. The server renders the fallback.
 *
 * When the code cannot be fetched (offline, or a deploy removed this tab's scripts) the panel says so with
 * a way to try again instead of showing its fallback forever; a failed load is not remembered, so the next
 * attempt fetches afresh. A removed script is reported like an uncaught one, so Connectivity's reload-once
 * logic applies to it too.
 */
export type LazyPanel<P> = ComponentType<P> & { preload: () => Promise<unknown> };

const NOTHING = () => null;
const SERVER = () => false;

export function lazyPanel<P extends object>(load: () => Promise<ComponentType<P>>, fallback: () => ReactNode = NOTHING): LazyPanel<P> {
  let Loaded: ComponentType<P> | null = null;
  let loading: Promise<ComponentType<P>> | null = null;
  const listeners = new Set<() => void>();
  const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
  const snapshot = () => Loaded !== null;
  const preload = () => (loading ??= load().then(
    (c) => { Loaded = c; listeners.forEach((l) => l()); return c; },
    (e: unknown) => { loading = null; throw e; },
  ));
  function Panel(props: P) {
    // Hydration always renders the fallback, as the server did (the server snapshot), even if the code
    // came in before this part of the page hydrated; a panel mounted later with its code in renders it at once.
    const ready = useSyncExternalStore(subscribe, snapshot, SERVER);
    const [failed, setFailed] = useState<{ error: unknown } | null>(null);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      if (ready) return;
      let live = true;
      preload().catch((error: unknown) => {
        if (!live) return;
        setFailed({ error });
        if (navigator.onLine && isStaleBuild((error ?? {}) as { name?: string; message?: string }) && typeof window.reportError === "function") window.reportError(error);
      });
      return () => { live = false; };
    }, [ready, attempt]);
    if (ready && Loaded) return <Loaded {...props} />;
    if (failed) return <LoadFailed error={failed.error} floating={fallback === NOTHING} retry={() => { setFailed(null); setAttempt((n) => n + 1); }} />;
    return <>{fallback()}</>;
  }
  return Object.assign(Panel, { preload });
}

/** What a panel shows when its code did not load: inline in its place, or as a toast for a panel with no placeholder (a dialog). */
function LoadFailed({ error, retry, floating }: { error: unknown; retry: () => void; floating: boolean }) {
  const [hidden, setHidden] = useState(false);
  // Back online: try again by itself.
  useEffect(() => {
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, [retry]);
  if (hidden) return null;
  const stale = navigator.onLine && isStaleBuild((error ?? {}) as { name?: string; message?: string });
  const text = stale ? "YouBank was updated. Reload to continue." : navigator.onLine ? "This part of the page didn't load." : "You're offline, so this part of the page didn't load.";
  const box = (
    <div role="alert" className={`ctl flex items-center gap-3 border border-line bg-elevated px-3 py-2 text-[12px] text-muted ${floating ? "pointer-events-auto shadow-lg" : "my-3"}`}>
      <span>{text}</span>
      <button type="button" onClick={stale ? () => window.location.reload() : retry} className="ctl border border-line px-2 py-0.5 text-fg hover:border-accent/50">{stale ? "Reload" : "Try again"}</button>
      {floating && <button type="button" onClick={() => setHidden(true)} aria-label="Dismiss" className="text-faint hover:text-fg">×</button>}
    </div>
  );
  return floating ? <div className="pointer-events-none fixed inset-x-0 bottom-16 z-[95] flex justify-center px-3">{box}</div> : box;
}

/**
 * Fetch these panels' code once the page has settled: after `delayMs`, one panel per idle period of the
 * main thread (requestIdleCallback where there is one), so warming them never competes with a tap or a
 * keystroke for long. Skipped when the browser asks to save data: each panel then loads when opened.
 */
export function useIdlePreload(panels: { preload: () => Promise<unknown> }[], delayMs = 2500) {
  useEffect(() => {
    if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return;
    const queue = [...panels];
    let idle = 0;
    const ric = (f: () => void): number => (typeof window.requestIdleCallback === "function" ? window.requestIdleCallback(f, { timeout: 5000 }) : window.setTimeout(f, 50));
    const cic = typeof window.cancelIdleCallback === "function" ? window.cancelIdleCallback.bind(window) : (id: number) => window.clearTimeout(id);
    let live = true;
    const next = () => {
      const p = queue.shift();
      if (!p || !live) return;
      void p.preload().catch(() => undefined).finally(() => { if (live) idle = ric(next); });
    };
    const t = window.setTimeout(() => { idle = ric(next); }, delayMs);
    return () => { live = false; window.clearTimeout(t); cic(idle); queue.length = 0; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
