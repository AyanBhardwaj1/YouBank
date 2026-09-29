/**
 * In-page navigation from the sidebar: when a workflow's page is already open (the terminal, the
 * Newsroom, Relationships, Settings), the sidebar asks it to switch views instead of reloading it, so
 * open panels and unsaved work stay put. Pages that read their view from the URL on first load
 * subscribe with useSubNav.
 */
import { useEffect, useRef } from "react";

export const SUBNAV_EVENT = "yb:subnav";
export type SubNav = { path: string; value: string };

export function emitSubNav(d: SubNav) {
  window.dispatchEvent(new CustomEvent<SubNav>(SUBNAV_EVENT, { detail: d }));
}

/** Call `onValue` when the sidebar asks the page at `path` to switch to a view. */
export function useSubNav(path: string, onValue: (value: string) => void) {
  const handler = useRef(onValue);
  useEffect(() => { handler.current = onValue; });
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<SubNav>).detail;
      if (d?.path === path) handler.current(d.value);
    };
    window.addEventListener(SUBNAV_EVENT, on);
    return () => window.removeEventListener(SUBNAV_EVENT, on);
  }, [path]);
}
