"use client";

import { useEffect } from "react";
import { DEFAULT_THEME, isThemeId } from "@/lib/themes";
import { normalizeLook } from "@/lib/desk/desk";
import { applyLook } from "@/components/workspace/WorkspaceProvider";
import { useTheme } from "./ThemeProvider";

/** After sign-in, the account's saved theme and look (Settings → Style) win over this browser's cookies. */
export function ThemeSync({ theme, look }: { theme: string | null; look?: unknown }) {
  const { themeId, setTheme } = useTheme();
  useEffect(() => {
    // An account that never chose a style starts on the default, not on whatever this browser showed last.
    const want = theme && isThemeId(theme) ? theme : DEFAULT_THEME;
    if (want !== themeId) setTheme(want, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  // Always: an account with no saved look gets the default, not a look another account left in this browser's cookie.
  useEffect(() => { applyLook(normalizeLook(look)); }, [look]);
  return null;
}
