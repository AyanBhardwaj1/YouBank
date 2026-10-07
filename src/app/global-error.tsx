"use client";

import "./globals.css";
import { useSyncExternalStore } from "react";
import { ErrorScreen } from "@/components/ui/ErrorScreen";
import { THEME_COOKIE } from "@/lib/themes";

/**
 * The last resort: the root layout itself failed (the theme cookie, the session lookup), so this
 * replaces it and brings its own document. The person's theme is read from its cookie in the browser;
 * the server render uses the default, and the attribute is allowed to differ on hydration.
 */
const THEME_RE = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=([\\w-]+)`);
const themeFromCookie = () => THEME_RE.exec(document.cookie)?.[1] ?? "terminal";
const noSubscribe = () => () => undefined;

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const theme = useSyncExternalStore(noSubscribe, themeFromCookie, () => "terminal");
  return (
    <html lang="en" data-theme={theme} suppressHydrationWarning>
      <body className="min-h-full bg-bg text-fg antialiased">
        <title>Something went wrong · YouBank</title>
        <ErrorScreen error={error} retry={retry} home={{ href: "/", label: "Home" }} what="YouBank" full />
      </body>
    </html>
  );
}
