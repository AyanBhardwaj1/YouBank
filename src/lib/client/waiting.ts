"use client";

/**
 * How many decisions wait for the person (the agent's questions, drafts, suggested follow-ups), for the
 * badge on Home's tab. One shared count for the whole page: fetched when the first badge mounts, again
 * when the window regains focus and every three minutes while it is visible, and right after a decision
 * in the desk inbox (refreshWaiting). Alerts are left to the bell.
 */
import { useSyncExternalStore } from "react";

let value: number | null = null;
let users = 0;
let timer: number | undefined;
let inflight = false;
const subs = new Set<() => void>();
const set = (v: number | null) => { if (v !== value) { value = v; subs.forEach((f) => f()); } };

export async function refreshWaiting(): Promise<void> {
  if (inflight || typeof document === "undefined" || document.visibilityState === "hidden") return;
  inflight = true;
  try {
    const r = await fetch("/api/desk/inbox?counts=1", { cache: "no-store" });
    if (r.ok) { const d = (await r.json()) as { counts?: Record<string, number> }; set(Object.values(d.counts ?? {}).reduce((a, b) => a + (Number(b) || 0), 0)); }
  } catch { /* the badge simply stays as it was */ }
  finally { inflight = false; }
}

function subscribe(on: () => void) {
  subs.add(on);
  if (users++ === 0) {
    void refreshWaiting();
    timer = window.setInterval(() => void refreshWaiting(), 180_000);
    window.addEventListener("focus", refreshWaiting);
  }
  return () => {
    subs.delete(on);
    if (--users === 0) { window.clearInterval(timer); window.removeEventListener("focus", refreshWaiting); }
  };
}

export const useWaiting = () => useSyncExternalStore(subscribe, () => value, () => null);
