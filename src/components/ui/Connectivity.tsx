"use client";

/**
 * Connectivity, quietly: one slim banner at the bottom of the screen, only when there is something to say.
 *
 * - Offline (the browser says so, or a request to YouBank failed on the network): "You're offline" or
 *   "Couldn't reach YouBank, retrying", cleared by the browser's `online` event or the next request that
 *   gets through. While unreachable it checks /api/health/live (no database) every few seconds.
 * - Session ended: a request inside the workspace got a 401 and a session check confirms it; the banner
 *   links to sign-in with `next` set to this page, so nothing typed on the page is thrown away by a
 *   sudden redirect.
 * - A deploy removed the scripts this tab was using (a chunk failed to load): the page reloads once, by
 *   itself. If it happens again within a minute the error screen's "Reload" takes over.
 *
 * Requests are observed, never changed: window.fetch is wrapped to look at same-origin answers only (a map
 * tile server being down is not YouBank being down).
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isStaleBuild } from "@/components/ui/ErrorScreen";
import { signInHref, watchesSession } from "@/lib/client/net";

type State = "online" | "offline" | "unreachable";

const RELOAD_KEY = "youbank:chunk-reload";

let installed = false;
const listeners = new Set<(e: { kind: "reachable" | "unreachable" | "unauthorized" }) => void>();
const emit = (kind: "reachable" | "unreachable" | "unauthorized") => listeners.forEach((l) => l({ kind }));

function install() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url: URL | null = null;
    try { url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, window.location.href); } catch { url = null; }
    const ours = !!url && url.origin === window.location.origin;
    try {
      const res = await original(input, init);
      if (ours && url) {
        emit("reachable");
        if (res.status === 401 && watchesSession(url.pathname)) emit("unauthorized");
      }
      return res;
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
      if (ours && name !== "AbortError" && name !== "TimeoutError") emit("unreachable");
      throw e;
    }
  };
}

export function Connectivity() {
  const pathname = usePathname();
  const [net, setNet] = useState<State>("online");
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    install();
    const sync = () => setNet(navigator.onLine ? "online" : "offline");
    sync();
    let checking = false;
    const onEvent = ({ kind }: { kind: "reachable" | "unreachable" | "unauthorized" }) => {
      if (kind === "reachable") setNet((s) => (s === "unreachable" ? "online" : s));
      else if (kind === "unreachable") setNet(navigator.onLine ? "unreachable" : "offline");
      else if (!checking && window.location.pathname.startsWith("/app")) {
        // Confirm before saying anything: one 401 from a route is not proof the session ended.
        checking = true;
        // Only a clear answer counts: a 5xx, a 429 or a body that will not parse (sign-in itself is down)
        // is not "signed out", so it says nothing.
        fetch("/api/auth/get-session", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : undefined))
          .then((s: { session?: unknown } | null | undefined) => { if (s !== undefined && !s?.session) setExpired(true); })
          .catch(() => undefined)
          .finally(() => { checking = false; });
      }
    };
    listeners.add(onEvent);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);

    // A chunk from a previous deploy is gone: reload once (not in a loop).
    const stale = (err: unknown) => {
      if (!err || !isStaleBuild(err as { name?: string; message?: string })) return;
      let last = 0;
      try { last = Number(sessionStorage.getItem(RELOAD_KEY)) || 0; } catch { /* storage blocked */ }
      if (Date.now() - last < 60_000) return;
      try { sessionStorage.setItem(RELOAD_KEY, String(Date.now())); } catch { /* storage blocked */ }
      window.location.reload();
    };
    const onError = (e: ErrorEvent) => stale(e.error ?? { message: e.message });
    const onRejection = (e: PromiseRejectionEvent) => stale(e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      listeners.delete(onEvent);
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  // While YouBank cannot be reached, a cheap check every few seconds clears the banner as soon as it can.
  useEffect(() => {
    if (net !== "unreachable") return;
    let delay = 3_000;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      fetch("/api/health/live", { method: "HEAD", cache: "no-store" }).catch(() => undefined);
      delay = Math.min(delay * 2, 30_000);
      timer = setTimeout(tick, delay);
    };
    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [net]);

  if (expired && pathname?.startsWith("/app")) {
    return (
      <Bar tone="warn">
        Your session has ended.{" "}
        <a className="font-semibold underline underline-offset-2" href={signInHref(`${window.location.pathname}${window.location.search}`)}>Sign in again</a>{" "}
        to continue; this page stays as it is until you do.
      </Bar>
    );
  }
  if (net === "offline") return <Bar tone="muted">You&apos;re offline. YouBank will catch up when you reconnect.</Bar>;
  if (net === "unreachable") return <Bar tone="muted">Couldn&apos;t reach YouBank. Retrying…</Bar>;
  return null;
}

function Bar({ children, tone }: { children: React.ReactNode; tone: "warn" | "muted" }) {
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center px-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <div className={`pointer-events-auto ctl border px-3 py-1.5 text-[12px] shadow-lg ${tone === "warn" ? "border-accent/50 bg-elevated text-fg" : "border-line bg-elevated text-muted"}`}>
        {children}
      </div>
    </div>
  );
}
