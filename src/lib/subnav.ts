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

/**
 * Keep a page's current view in its address (?tab=pipeline), so a refresh stays on it and a copied
 * link opens it. Replaces the history entry rather than adding one (as Edge does), and keeps every
 * other parameter. `value` null leaves the address alone; the default view drops the parameter.
 */
export function useViewInUrl(path: string, param: string, value: string | null, defaultValue?: string) {
  useEffect(() => {
    if (value === null || typeof window === "undefined" || window.location.pathname !== path) return;
    try {
      const url = new URL(window.location.href);
      if (value === defaultValue) url.searchParams.delete(param); else url.searchParams.set(param, value);
      const next = `${url.pathname}${url.search}${url.hash}`;
      // null state, so Next's router takes the new address as its own (it copies its own state over);
      // passing its state back would skip that, and its next render would put the old address back.
      if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(null, "", next);
    } catch { /* the view still changes */ }
  }, [path, param, value, defaultValue]);
}
