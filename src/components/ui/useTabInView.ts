"use client";

import { useEffect, useRef } from "react";

/**
 * For a row of tabs that scrolls sideways on a phone: keeps the active tab (marked aria-current,
 * aria-selected or data-active) inside the row, so a deep link to the seventh tab does not open with
 * it scrolled out of sight. Scrolls only the row itself, never the page. Pass the active tab's id.
 */
export function useTabInView<T extends HTMLElement = HTMLElement>(active: unknown) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const row = ref.current;
    const el = row?.querySelector<HTMLElement>('[aria-current="page"], [aria-selected="true"], [data-active="true"]');
    if (!row || !el || row.scrollWidth <= row.clientWidth) return;
    const r = row.getBoundingClientRect(), e = el.getBoundingClientRect();
    if (e.left < r.left) row.scrollLeft -= r.left - e.left + 16;
    else if (e.right > r.right) row.scrollLeft += e.right - r.right + 16;
  }, [active]);
  return ref;
}
