/**
 * Keyboard for Edge's tab rows (the WAI-ARIA tabs pattern): only the chosen tab sits in the Tab order,
 * and Left, Right, Home and End move to another tab and choose it.
 */
import type { KeyboardEvent } from "react";

/** Put on the element with role="tablist". */
export function onTabKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
  const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])')];
  if (!tabs.length) return;
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (Math.max(0, at) + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault();
  tabs[next].focus();
  tabs[next].click();
}

/** Spread on each tab. */
export const tabProps = (selected: boolean) => ({ role: "tab" as const, "aria-selected": selected, tabIndex: selected ? 0 : -1 });
