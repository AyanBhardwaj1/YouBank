"use client";

/**
 * The Newsroom's client plumbing: typed fetches, a polling feed that knows which stories arrived since
 * you opened it (so they can animate in), batched sparklines for the data art, relative times, and the
 * motion level (the person's setting, overridden by the system's reduce-motion).
 */
import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useReducedMotion } from "motion/react";
import type { FeedView } from "@/lib/news/views";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${r.status}`);
  return j;
}
export const post = <T,>(url: string, body: unknown) => api<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const qs = (p: Record<string, string | undefined | null>) => Object.entries(p).filter(([, v]) => v !== undefined && v !== null && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");

/** How long to wait before the next poll after `failures` failures in a row: doubling, up to ten minutes. Pure, for tests. */
export const pollBackoff = (pollMs: number, failures: number) => Math.min(pollMs * 2 ** Math.min(failures, 6), Math.max(pollMs, 600_000));

/**
 * A fetch that re-runs when `url` changes, keeping the last answer while the next loads. With `pollMs`
 * it refreshes on that interval while the tab is in view: a hidden tab skips its polls and refreshes
 * once when shown again, and failures (an outage, a rate limit) back off instead of hammering.
 */
export function useApi<T>(url: string | null, pollMs = 0) {
  const [state, setState] = useState<{ url: string | null; data: T | null; error: string | null }>({ url: null, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) return;
    let live = true;
    let failures = 0;
    let due = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (!live || !pollMs) return;
      timer = setTimeout(() => {
        if (document.visibilityState === "hidden") due = true;
        else void load();
      }, pollBackoff(pollMs, failures));
    };
    const load = () => api<T>(url)
      .then((data) => { failures = 0; if (live) setState({ url, data, error: null }); })
      .catch((e) => { failures++; if (live) setState((s) => ({ url, data: s.data, error: e instanceof Error ? e.message : String(e) })); })
      .finally(schedule);
    const onVisibility = () => { if (document.visibilityState !== "hidden" && due) { due = false; void load(); } };
    void load();
    document.addEventListener("visibilitychange", onVisibility);
    return () => { live = false; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [url, pollMs, nonce]);
  return { data: state.data, error: state.error, loading: state.url !== url, reload: () => setNonce((n) => n + 1) };
}

/** The ranked feed, polled every minute. `fresh` holds stories that arrived after the first load. */
export function useFeed(params: Record<string, string | undefined | null>) {
  const url = `/api/news/feed?${qs(params)}`;
  const { data, error, loading, reload } = useApi<FeedView>(url, 60_000);
  const seen = useRef<{ url: string; ids: Set<number> } | null>(null);
  const [fresh, setFresh] = useState<{ url: string; ids: Set<number> }>({ url: "", ids: new Set() });
  useEffect(() => {
    if (!data) return;
    const ids = data.stories.map((s) => s.id);
    if (!seen.current || seen.current.url !== url) { seen.current = { url, ids: new Set(ids) }; return; }
    const novel = ids.filter((id) => !seen.current!.ids.has(id));
    for (const id of novel) seen.current.ids.add(id);
    if (novel.length) queueMicrotask(() => setFresh({ url, ids: new Set(novel) }));
  }, [data, url]);
  return { data, error, loading, reload, fresh: fresh.url === url ? fresh.ids : new Set<number>() };
}

/* ---------------- Sparklines ---------------- */

export type Spark = { closes: number[]; change: number | null; month: number | null };
const sparks = new Map<string, Spark | null>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const notify = () => { version++; for (const l of listeners) l(); };

function request(symbols: string[]) {
  const missing = [...new Set(symbols)].filter((s) => !sparks.has(s) && !inflight.has(s)).slice(0, 24);
  if (!missing.length) return;
  for (const s of missing) inflight.add(s);
  void api<Record<string, Spark>>(`/api/news/sparks?symbols=${missing.join(",")}`).then((r) => {
    for (const s of missing) sparks.set(s, r[s]?.closes?.length ? r[s] : null);
  }).catch(() => { for (const s of missing) sparks.set(s, null); }).finally(() => { for (const s of missing) inflight.delete(s); notify(); });
}

/** Thirty-day closes for the symbols on screen, fetched in one batch and shared across cards. */
export function useSparks(symbols: string[]): Map<string, Spark | null> {
  useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => version, () => 0);
  const key = [...new Set(symbols)].sort().join(",");
  useEffect(() => { if (key) request(key.split(",")); }, [key]);
  return sparks;
}

/* ---------------- Time ---------------- */

/** "just now", "4m", "2h", "Yesterday", "Sep 26". `now` is passed in so renders stay pure. */
export function ago(iso: string, now: number): string {
  const t = Date.parse(iso);
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  if (h < 48) return "Yesterday";
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The current time, refreshed every half minute (kept out of render so the React Compiler is happy). */
export function useNow(stepMs = 30_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, stepMs);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [stepMs]);
  return now;
}

/* ---------------- Motion ---------------- */

export type MotionLevel = "rich" | "subtle" | "off";
export const MotionContext = createContext<MotionLevel>("rich");
export const useMotionLevel = () => useContext(MotionContext);

/** The person's motion setting, turned off when the system asks for reduced motion. */
export function useEffectiveMotion(pref: MotionLevel): MotionLevel {
  const reduce = useReducedMotion();
  return reduce ? "off" : pref;
}

export const fmtUsd = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(v >= 1e10 ? 0 : 1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v.toLocaleString("en-US")}`);
export const fmtPct = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
