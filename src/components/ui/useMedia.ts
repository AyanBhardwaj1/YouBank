"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches, kept live. The server (and the first client render, so hydration
 * matches) answers `fallback`; the real answer follows a moment later. Use CSS (`md:hidden`) for what
 * only looks different on a phone, and this only for what behaves differently there, like a panel that
 * becomes a bottom sheet.
 */
export function useMedia(query: string, fallback = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", onChange);
      return () => m.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => fallback,
  );
}

/** Phone-sized: below Tailwind's `md` (768px), where side panels become sheets and the tab bar shows. */
export const PHONE_QUERY = "(max-width: 767.98px)";
export const usePhone = () => useMedia(PHONE_QUERY);

/** A finger rather than a mouse: no hover, bigger targets, the on-screen keyboard. */
export const useCoarsePointer = () => useMedia("(pointer: coarse)");
