"use client";

/**
 * What a crashed screen shows, for every error.tsx and global-error.tsx: a plain line, the reference
 * that finds the server's log entry (Next's digest), and two ways out (try again, go home).
 *
 * The error's own message is never shown. In production a server error's message is already replaced
 * by Next, and a browser error's message is a bug's text ("Cannot read properties of undefined"), which
 * helps nobody reading it. Two cases get their own line because the fix is different: the browser is
 * offline, and a new deploy removed the code this tab was still using (a reload fixes that, a retry
 * does not).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/Icon";
import { OFFLINE } from "@/lib/client/errors";

type Props = {
  error: Error & { digest?: string };
  retry: () => void;
  /** Where "home" goes: the workspace's own start page when the crash is inside one. */
  home?: { href: string; label: string };
  /** What crashed, in a few words ("This canvas"), for the heading. */
  what?: string;
  /** Fill the viewport (the root boundaries) instead of the workspace pane. */
  full?: boolean;
};

/** A deploy replaced the scripts this tab was loaded with. Pure, for tests. */
export const isStaleBuild = (e: { name?: string; message?: string }) =>
  e.name === "ChunkLoadError" || /Loading (CSS )?chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(e.message ?? "");

/** The browser's online flag, read after hydration (the server has no navigator, so it renders "online"). */
const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => { window.removeEventListener("online", cb); window.removeEventListener("offline", cb); };
};
const useOffline = () => useSyncExternalStore(subscribeOnline, () => !navigator.onLine, () => false);

export function ErrorScreen({ error, retry, home = { href: "/app", label: "Home" }, what = "This screen", full = false }: Props) {
  // The details stay in the browser console for whoever is debugging; the page shows none of them.
  useEffect(() => { console.error(error); }, [error]);
  const stale = isStaleBuild(error);
  const offline = useOffline();
  const title = stale ? "YouBank was updated" : offline ? "You seem to be offline" : `${what} ran into a problem`;
  const body = stale
    ? "A newer version was released while this tab was open. Reload to continue; nothing you saved is lost."
    : offline
      ? OFFLINE
      : error.digest
        ? "Something went wrong on our side. Try again; if it keeps happening, send us the reference below and we can find what happened."
        : "Something went wrong on our side. Try again; if it keeps happening, reload the page.";
  const again = stale ? () => window.location.reload() : retry;
  return (
    <main role="alert" className={`flex items-center justify-center px-4 py-12 ${full ? "min-h-dvh" : "h-full min-h-[320px]"}`}>
      <div className="rise panel float w-full max-w-md p-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center ctl bg-accent-soft text-accent"><Icon name="AlertTriangle" className="h-4 w-4" /></span>
          <h1 className="text-[16px] font-semibold">{title}</h1>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{body}</p>
        {error.digest && !stale && (
          <p className="mt-3 text-[11.5px] text-muted">
            Reference <span className="num select-all ctl border border-line bg-elevated px-1.5 py-0.5 text-fg">{error.digest}</span>
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={again} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg">
            <Icon name="RefreshCw" className="h-3.5 w-3.5" />{stale ? "Reload" : "Try again"}
          </button>
          <Link href={home.href} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">
            <Icon name="Home" className="h-3.5 w-3.5" />{home.label}
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * A workspace's error.tsx: the crash stays inside the app shell, and "home" is the workspace's start
 * page, or the app's home when the start page itself is what crashed.
 */
export function workspaceBoundary(href: string, label: string, what = "This page") {
  return function WorkspaceBoundary({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
    const path = usePathname();
    const home = path === href ? { href: "/app", label: "Home" } : { href, label: `Back to ${label}` };
    return <ErrorScreen error={error} retry={retry} home={home} what={what} />;
  };
}
