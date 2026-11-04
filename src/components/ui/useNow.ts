"use client";

import { useSyncExternalStore } from "react";

/**
 * The time, for anything shown that depends on it (a greeting, today's date, which markets are open).
 * Null while the server renders and while the page hydrates, so the server's clock and time zone never
 * meet the browser's (that mismatch is React error 418); then the browser's time, to the `every`
 * milliseconds (default 30 s), updating on that beat.
 */
export function useNow(every = 30_000): number | null {
  return useSyncExternalStore(
    (onChange) => { const id = window.setInterval(onChange, every); return () => window.clearInterval(id); },
    () => Math.floor(Date.now() / every) * every,
    () => null,
  );
}
